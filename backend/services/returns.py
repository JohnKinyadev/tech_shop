from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.core.permissions import ADMIN, BRANCH_MANAGER
from backend.models.approvals import ApprovalRequest
from backend.models.enums import (
    ApprovalStatus,
    FulfillmentStatus,
    PaymentDirection,
    PaymentStatus,
    SaleStatus,
    TillSessionStatus,
    TrackingType,
)
from backend.models.payments import Payment
from backend.models.products import ProductVariant
from backend.models.sales import SaleItem, SaleReturn, SaleReturnItem, Till, TillSession
from backend.models.warranty import Warranty
from backend.schemas.approval_schemas import ApprovalDecision, ApprovalRequestResponse
from backend.schemas.sales_schemas import (
    SaleReturnCreate,
    SaleReturnItemResponse,
    SaleReturnResponse,
    SaleVoidRequest,
)
from backend.services import inventory
from backend.services.audit import record_audit
from backend.services.auth import AuthPrincipal
from backend.services.authorization import (
    AuthorizationError,
    enforce_branch_scope,
    enforce_permission,
)
from backend.services.exceptions import ConflictError, NotFoundError, ValidationError
from backend.services.sales import get_sale_model, money


def _return_number() -> str:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"RTN-{today}-{uuid4().hex[:8].upper()}"


def _refund_session(
    db: Session,
    session_id: UUID,
    branch_id: UUID,
    *,
    cashier_id: UUID | None = None,
) -> TillSession:
    conditions = [
        TillSession.id == session_id,
        TillSession.status == TillSessionStatus.OPEN,
        TillSession.is_deleted.is_(False),
        Till.branch_id == branch_id,
        Till.is_active.is_(True),
        Till.is_deleted.is_(False),
    ]
    if cashier_id is not None:
        conditions.append(TillSession.cashier_id == cashier_id)
    session = db.scalar(
        select(TillSession)
        .join(Till, Till.id == TillSession.till_id)
        .where(*conditions)
    )
    if session is None:
        raise ConflictError("refunds require the requester's open till session")
    return session


def _return_items(
    db: Session, return_id: UUID, *, lock: bool = False
) -> list[SaleReturnItem]:
    statement = (
        select(SaleReturnItem)
        .where(
            SaleReturnItem.return_id == return_id,
            SaleReturnItem.is_deleted.is_(False),
        )
        .order_by(SaleReturnItem.created_at)
    )
    if lock:
        statement = statement.with_for_update()
    return list(db.scalars(statement).all())


def _response(db: Session, item: SaleReturn) -> SaleReturnResponse:
    return SaleReturnResponse.model_validate(item).model_copy(
        update={
            "items": [
                SaleReturnItemResponse.model_validate(line)
                for line in _return_items(db, item.id)
            ]
        }
    )


def list_returns(
    db: Session, principal: AuthPrincipal, sale_id: UUID
) -> list[SaleReturnResponse]:
    sale = get_sale_model(db, principal, sale_id)
    rows = db.scalars(
        select(SaleReturn)
        .where(
            SaleReturn.sale_id == sale.id,
            SaleReturn.is_deleted.is_(False),
        )
        .order_by(SaleReturn.created_at.desc())
    ).all()
    return [_response(db, item) for item in rows]


def request_return(
    db: Session,
    principal: AuthPrincipal,
    sale_id: UUID,
    payload: SaleReturnCreate,
) -> SaleReturnResponse:
    sale = get_sale_model(db, principal, sale_id, lock=True)
    if sale.status != SaleStatus.COMPLETED:
        raise ConflictError("returns can only be requested for a completed sale")
    _refund_session(
        db,
        payload.till_session_id,
        sale.branch_id,
        cashier_id=principal.user_id,
    )
    sale_items = {
        item.id: item
        for item in db.scalars(
            select(SaleItem).where(
                SaleItem.sale_id == sale.id,
                SaleItem.is_deleted.is_(False),
            )
        ).all()
    }
    requested_ids = [item.sale_item_id for item in payload.items]
    if len(set(requested_ids)) != len(requested_ids):
        raise ConflictError("duplicate return item")
    if not set(requested_ids) <= set(sale_items):
        raise NotFoundError("one or more return items do not belong to this sale")

    returned_quantities = dict(
        db.execute(
            select(
                SaleReturnItem.sale_item_id,
                func.coalesce(func.sum(SaleReturnItem.quantity), 0),
            )
            .join(SaleReturn, SaleReturn.id == SaleReturnItem.return_id)
            .where(
                SaleReturn.sale_id == sale.id,
                SaleReturn.status.in_(["pending", "approved"]),
                SaleReturn.is_deleted.is_(False),
                SaleReturnItem.is_deleted.is_(False),
            )
            .group_by(SaleReturnItem.sale_item_id)
        ).all()
    )
    variants = {
        variant.id: variant
        for variant in db.scalars(
            select(ProductVariant).where(
                ProductVariant.id.in_(
                    [sale_items[item_id].variant_id for item_id in requested_ids]
                )
            )
        ).all()
    }
    refund_amount = Decimal("0.00")
    current_quantities: dict[UUID, int] = {}
    for requested in payload.items:
        sold_item = sale_items[requested.sale_item_id]
        already_returned = int(returned_quantities.get(sold_item.id, 0))
        if already_returned + requested.quantity > sold_item.quantity:
            raise ConflictError("return quantity exceeds the remaining sold quantity")
        variant = variants.get(sold_item.variant_id)
        if variant is None:
            raise NotFoundError("returned product variant no longer exists")
        if variant.tracking_type != TrackingType.BULK and requested.quantity != 1:
            raise ValidationError("serialized returns must have a quantity of one")
        if requested.restock and requested.condition.strip().lower() not in {
            "new",
            "good",
            "resellable",
            "sealed",
        }:
            raise ValidationError("only resellable items can be marked for restocking")
        refund_amount += money(
            (sold_item.line_total / sold_item.quantity) * requested.quantity
        )
        current_quantities[sold_item.id] = requested.quantity

    fully_claimed = all(
        int(returned_quantities.get(item.id, 0)) + current_quantities.get(item.id, 0)
        == item.quantity
        for item in sale_items.values()
    )
    if fully_claimed:
        existing_refunds = db.scalar(
            select(func.coalesce(func.sum(SaleReturn.refund_amount), 0)).where(
                SaleReturn.sale_id == sale.id,
                SaleReturn.status.in_(["pending", "approved"]),
                SaleReturn.is_deleted.is_(False),
            )
        ) or Decimal("0.00")
        refund_amount = money(sale.total_amount - existing_refunds)

    sale_return = SaleReturn(
        sale_id=sale.id,
        till_session_id=payload.till_session_id,
        return_number=_return_number(),
        requested_by_id=principal.user_id,
        status="pending",
        reason=payload.reason.strip(),
        refund_amount=money(refund_amount),
    )
    db.add(sale_return)
    db.flush()
    for requested in payload.items:
        db.add(
            SaleReturnItem(
                return_id=sale_return.id,
                sale_item_id=requested.sale_item_id,
                quantity=requested.quantity,
                condition=requested.condition.strip().lower(),
                restock=requested.restock,
            )
        )
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=sale.branch_id,
        action="sale.return_requested",
        resource_type="sale_return",
        resource_id=sale_return.id,
        after={"refund_amount": str(sale_return.refund_amount)},
    )
    return _response(db, sale_return)


def _refund_payments(
    db: Session,
    *,
    sale_id: UUID,
    branch_id: UUID,
    amount: Decimal,
    till_session_id: UUID,
    performed_by_id: UUID,
    reference_key: str,
    note: str,
) -> None:
    incoming = db.scalars(
        select(Payment)
        .where(
            Payment.sale_id == sale_id,
            Payment.direction == PaymentDirection.INCOMING,
            Payment.status == PaymentStatus.COMPLETED,
            Payment.is_deleted.is_(False),
        )
        .order_by(Payment.paid_at, Payment.created_at)
    ).all()
    outgoing = db.scalars(
        select(Payment).where(
            Payment.sale_id == sale_id,
            Payment.direction == PaymentDirection.OUTGOING,
            Payment.status == PaymentStatus.COMPLETED,
            Payment.is_deleted.is_(False),
        )
    ).all()
    refunded_by_source: dict[str, Decimal] = {}
    for payment in outgoing:
        source_id = (payment.provider_payload or {}).get("source_payment_id")
        if source_id:
            refunded_by_source[source_id] = (
                refunded_by_source.get(source_id, Decimal("0.00")) + payment.amount
            )

    remaining = money(amount)
    now = datetime.now(timezone.utc)
    for source in incoming:
        available = source.amount - refunded_by_source.get(
            str(source.id), Decimal("0.00")
        )
        if available <= 0:
            continue
        refund_amount = min(available, remaining)
        db.add(
            Payment(
                branch_id=branch_id,
                sale_id=sale_id,
                till_session_id=till_session_id,
                direction=PaymentDirection.OUTGOING,
                method=source.method,
                status=PaymentStatus.COMPLETED,
                amount=money(refund_amount),
                currency=source.currency,
                idempotency_key=f"{reference_key}:payment:{source.id}",
                paid_at=now,
                provider_payload={"source_payment_id": str(source.id)},
                notes=note,
            )
        )
        remaining = money(remaining - refund_amount)
        if remaining == 0:
            break
    if remaining != 0:
        raise ConflictError("completed payments do not cover this refund")


def decide_return(
    db: Session,
    principal: AuthPrincipal,
    return_id: UUID,
    decision: ApprovalDecision,
) -> SaleReturnResponse:
    enforce_permission(principal, "returns.approve")
    if principal.role_code not in {ADMIN, BRANCH_MANAGER}:
        raise AuthorizationError("only an Admin or Branch Manager can approve returns")
    sale_return = db.scalar(
        select(SaleReturn)
        .where(SaleReturn.id == return_id, SaleReturn.is_deleted.is_(False))
        .with_for_update()
    )
    if sale_return is None:
        raise NotFoundError("sale return not found")
    sale = get_sale_model(db, principal, sale_return.sale_id, lock=True)
    enforce_branch_scope(principal, sale.branch_id)
    if sale_return.status != "pending":
        raise ConflictError("sale return has already been reviewed")
    if not decision.approved:
        sale_return.status = "rejected"
        db.flush()
        return _response(db, sale_return)
    if sale.status != SaleStatus.COMPLETED:
        raise ConflictError("the sale is no longer eligible for a return")
    _refund_session(db, sale_return.till_session_id, sale.branch_id)

    return_items = _return_items(db, sale_return.id, lock=True)
    sold_items = {
        item.id: item
        for item in db.scalars(
            select(SaleItem).where(
                SaleItem.id.in_([line.sale_item_id for line in return_items])
            )
        ).all()
    }
    for line in return_items:
        sold_item = sold_items.get(line.sale_item_id)
        if sold_item is None:
            raise NotFoundError("original sale item no longer exists")
        inventory.return_sale_stock(
            db,
            branch_id=sale.branch_id,
            sale_item=sold_item,
            quantity=line.quantity,
            performed_by_id=principal.user_id,
            reference_type="sale_return",
            reference_id=sale_return.id,
            restock=line.restock,
            condition=line.condition,
        )
        if sold_item.serialized_unit_id is not None:
            warranties = db.scalars(
                select(Warranty).where(
                    Warranty.sale_item_id == sold_item.id,
                    Warranty.is_deleted.is_(False),
                )
            ).all()
            for warranty in warranties:
                warranty.status = "returned"

    _refund_payments(
        db,
        sale_id=sale.id,
        branch_id=sale.branch_id,
        amount=sale_return.refund_amount,
        till_session_id=sale_return.till_session_id,
        performed_by_id=principal.user_id,
        reference_key=f"return:{sale_return.id}",
        note=f"Refund for {sale_return.return_number}",
    )
    sale_return.status = "approved"
    sale_return.approved_by_id = principal.user_id
    db.flush()
    approved_total = db.scalar(
        select(func.coalesce(func.sum(SaleReturn.refund_amount), 0)).where(
            SaleReturn.sale_id == sale.id,
            SaleReturn.status == "approved",
            SaleReturn.is_deleted.is_(False),
        )
    ) or Decimal("0.00")
    if approved_total >= sale.total_amount:
        sale.status = SaleStatus.REFUNDED
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=sale.branch_id,
        action="sale.return_reviewed",
        resource_type="sale_return",
        resource_id=sale_return.id,
        after={"status": sale_return.status},
    )
    return _response(db, sale_return)


def request_void(
    db: Session,
    principal: AuthPrincipal,
    sale_id: UUID,
    payload: SaleVoidRequest,
) -> ApprovalRequestResponse:
    sale = get_sale_model(db, principal, sale_id, lock=True)
    if sale.status not in {SaleStatus.PENDING_PAYMENT, SaleStatus.COMPLETED}:
        raise ConflictError("this sale cannot be voided")
    _refund_session(
        db,
        payload.till_session_id,
        sale.branch_id,
        cashier_id=principal.user_id,
    )
    if db.scalar(
        select(SaleReturn.id).where(
            SaleReturn.sale_id == sale.id,
            SaleReturn.status.in_(["pending", "approved"]),
            SaleReturn.is_deleted.is_(False),
        )
    ):
        raise ConflictError("a sale with returns cannot be voided")
    existing = db.scalar(
        select(ApprovalRequest.id).where(
            ApprovalRequest.action == "sales.void",
            ApprovalRequest.resource_id == sale.id,
            ApprovalRequest.status == ApprovalStatus.PENDING,
            ApprovalRequest.is_deleted.is_(False),
        )
    )
    if existing is not None:
        raise ConflictError("this sale already has a pending void request")
    request = ApprovalRequest(
        branch_id=sale.branch_id,
        action="sales.void",
        resource_type="sale",
        resource_id=sale.id,
        requested_by_id=principal.user_id,
        status=ApprovalStatus.PENDING,
        reason=payload.reason.strip(),
        requested_changes={"till_session_id": str(payload.till_session_id)},
    )
    db.add(request)
    db.flush()
    return ApprovalRequestResponse.model_validate(request)


def list_void_requests(
    db: Session, principal: AuthPrincipal, branch_id: UUID
) -> list[ApprovalRequestResponse]:
    enforce_permission(principal, "sales.void")
    enforce_branch_scope(principal, branch_id)
    requests = db.scalars(
        select(ApprovalRequest)
        .where(
            ApprovalRequest.branch_id == branch_id,
            ApprovalRequest.action == "sales.void",
            ApprovalRequest.is_deleted.is_(False),
        )
        .order_by(ApprovalRequest.created_at.desc())
    ).all()
    return [ApprovalRequestResponse.model_validate(item) for item in requests]


def decide_void(
    db: Session,
    principal: AuthPrincipal,
    request_id: UUID,
    decision: ApprovalDecision,
) -> ApprovalRequestResponse:
    enforce_permission(principal, "sales.void")
    if principal.role_code not in {ADMIN, BRANCH_MANAGER}:
        raise AuthorizationError(
            "only an Admin or Branch Manager can approve sale voids"
        )
    request = db.scalar(
        select(ApprovalRequest)
        .where(
            ApprovalRequest.id == request_id,
            ApprovalRequest.action == "sales.void",
            ApprovalRequest.is_deleted.is_(False),
        )
        .with_for_update()
    )
    if request is None:
        raise NotFoundError("sale void request not found")
    enforce_branch_scope(principal, request.branch_id)
    if request.status != ApprovalStatus.PENDING:
        raise ConflictError("sale void request has already been reviewed")
    request.reviewed_by_id = principal.user_id
    request.decision_note = decision.decision_note
    if not decision.approved:
        request.status = ApprovalStatus.REJECTED
        db.flush()
        return ApprovalRequestResponse.model_validate(request)

    sale = get_sale_model(db, principal, request.resource_id, lock=True)
    if sale.status not in {SaleStatus.PENDING_PAYMENT, SaleStatus.COMPLETED}:
        raise ConflictError("the sale is no longer eligible to be voided")
    if db.scalar(
        select(SaleReturn.id).where(
            SaleReturn.sale_id == sale.id,
            SaleReturn.status.in_(["pending", "approved"]),
            SaleReturn.is_deleted.is_(False),
        )
    ):
        raise ConflictError("a sale with returns cannot be voided")
    changes = request.requested_changes or {}
    try:
        till_session_id = UUID(changes["till_session_id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ConflictError("void request has no valid refund till session") from exc
    _refund_session(db, till_session_id, sale.branch_id)
    if sale.status == SaleStatus.COMPLETED:
        for item in db.scalars(
            select(SaleItem)
            .where(SaleItem.sale_id == sale.id, SaleItem.is_deleted.is_(False))
            .with_for_update()
        ).all():
            inventory.return_sale_stock(
                db,
                branch_id=sale.branch_id,
                sale_item=item,
                quantity=item.quantity,
                performed_by_id=principal.user_id,
                reference_type="sale_void",
                reference_id=request.id,
                restock=True,
                condition="voided sale",
            )
        for warranty in db.scalars(
            select(Warranty)
            .join(SaleItem, SaleItem.id == Warranty.sale_item_id)
            .where(SaleItem.sale_id == sale.id, Warranty.is_deleted.is_(False))
        ).all():
            warranty.status = "voided"
    if sale.paid_amount > 0:
        _refund_payments(
            db,
            sale_id=sale.id,
            branch_id=sale.branch_id,
            amount=sale.paid_amount,
            till_session_id=till_session_id,
            performed_by_id=principal.user_id,
            reference_key=f"void:{request.id}",
            note=f"Void of {sale.invoice_number}",
        )
    sale.status = SaleStatus.VOIDED
    sale.fulfillment_status = FulfillmentStatus.CANCELLED
    request.status = ApprovalStatus.APPROVED
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=sale.branch_id,
        action="sale.void_reviewed",
        resource_type="approval_request",
        resource_id=request.id,
        after={"status": request.status.value, "sale_id": str(sale.id)},
    )
    return ApprovalRequestResponse.model_validate(request)
