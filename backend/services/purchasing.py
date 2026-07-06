from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.core.permissions import ADMIN
from backend.models.branch import Branch
from backend.models.enums import PurchaseStatus
from backend.models.products import ProductVariant
from backend.models.purchase import (
    GoodsReceipt,
    GoodsReceiptItem,
    PurchaseOrder,
    PurchaseOrderItem,
)
from backend.models.suppliers import Supplier
from backend.schemas.purchase_schemas import (
    GoodsReceiptCreate,
    GoodsReceiptItemResponse,
    GoodsReceiptResponse,
    PurchaseOrderCreate,
    PurchaseOrderItemResponse,
    PurchaseOrderResponse,
    PurchaseOrderUpdate,
)
from backend.services import inventory
from backend.services.audit import record_audit
from backend.services.auth import AuthPrincipal
from backend.services.authorization import enforce_branch_scope, enforce_permission
from backend.services.exceptions import ConflictError, NotFoundError, ValidationError

MONEY_QUANTUM = Decimal("0.01")


def calculate_item_amounts(
    quantity: int, unit_cost: Decimal, tax_rate: Decimal
) -> tuple[Decimal, Decimal, Decimal]:
    subtotal = (unit_cost * quantity).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)
    tax = (subtotal * tax_rate / Decimal("100")).quantize(
        MONEY_QUANTUM, rounding=ROUND_HALF_UP
    )
    return subtotal, tax, subtotal + tax


def _order_number() -> str:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"PO-{today}-{uuid4().hex[:8].upper()}"


def _receipt_number() -> str:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"GRN-{today}-{uuid4().hex[:8].upper()}"


def order_snapshot(order: PurchaseOrder) -> dict[str, Any]:
    return {
        "id": str(order.id),
        "branch_id": str(order.branch_id),
        "supplier_id": str(order.supplier_id),
        "order_number": order.order_number,
        "status": order.status.value,
        "subtotal": str(order.subtotal),
        "tax_amount": str(order.tax_amount),
        "total_amount": str(order.total_amount),
        "approved_by_id": str(order.approved_by_id) if order.approved_by_id else None,
    }


def _get_order(
    db: Session, principal: AuthPrincipal, order_id: UUID, *, lock: bool = False
) -> PurchaseOrder:
    statement = select(PurchaseOrder).where(
        PurchaseOrder.id == order_id,
        PurchaseOrder.is_deleted.is_(False),
    )
    if lock:
        statement = statement.with_for_update()
    order = db.scalar(statement)
    if order is None:
        raise NotFoundError("purchase order not found")
    enforce_branch_scope(principal, order.branch_id)
    return order


def _order_response(db: Session, order: PurchaseOrder) -> PurchaseOrderResponse:
    items = db.scalars(
        select(PurchaseOrderItem)
        .where(
            PurchaseOrderItem.purchase_order_id == order.id,
            PurchaseOrderItem.is_deleted.is_(False),
        )
        .order_by(PurchaseOrderItem.created_at)
    ).all()
    return PurchaseOrderResponse.model_validate(order).model_copy(
        update={
            "items": [PurchaseOrderItemResponse.model_validate(item) for item in items]
        }
    )


def list_purchase_orders(
    db: Session,
    principal: AuthPrincipal,
    *,
    page: int,
    page_size: int,
    status: PurchaseStatus | None = None,
    supplier_id: UUID | None = None,
) -> tuple[list[PurchaseOrderResponse], int]:
    enforce_permission(principal, "purchases.create")
    conditions = [PurchaseOrder.is_deleted.is_(False)]
    if principal.branch_id is not None and principal.role_code != ADMIN:
        conditions.append(PurchaseOrder.branch_id == principal.branch_id)
    if status is not None:
        conditions.append(PurchaseOrder.status == status)
    if supplier_id is not None:
        conditions.append(PurchaseOrder.supplier_id == supplier_id)
    total = (
        db.scalar(select(func.count()).select_from(PurchaseOrder).where(*conditions))
        or 0
    )
    orders = list(
        db.scalars(
            select(PurchaseOrder)
            .where(*conditions)
            .order_by(PurchaseOrder.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return [_order_response(db, order) for order in orders], total


def get_purchase_order(
    db: Session, principal: AuthPrincipal, order_id: UUID
) -> PurchaseOrderResponse:
    enforce_permission(principal, "purchases.create")
    return _order_response(db, _get_order(db, principal, order_id))


def _validate_branch(db: Session, branch_id: UUID) -> None:
    exists = db.scalar(
        select(Branch.id).where(Branch.id == branch_id, Branch.is_deleted.is_(False))
    )
    if exists is None:
        raise NotFoundError("branch not found")


def _get_active_supplier(db: Session, supplier_id: UUID) -> Supplier:
    supplier = db.scalar(
        select(Supplier).where(
            Supplier.id == supplier_id,
            Supplier.is_active.is_(True),
            Supplier.is_deleted.is_(False),
        )
    )
    if supplier is None:
        raise NotFoundError("active supplier not found")
    return supplier


def create_purchase_order(
    db: Session, principal: AuthPrincipal, payload: PurchaseOrderCreate
) -> PurchaseOrderResponse:
    enforce_permission(principal, "purchases.create")
    enforce_branch_scope(principal, payload.branch_id)
    _validate_branch(db, payload.branch_id)
    _get_active_supplier(db, payload.supplier_id)

    variant_ids = [item.variant_id for item in payload.items]
    if len(set(variant_ids)) != len(variant_ids):
        raise ConflictError("a product variant can appear only once per purchase order")
    variants = {
        item.id: item
        for item in db.scalars(
            select(ProductVariant).where(
                ProductVariant.id.in_(variant_ids),
                ProductVariant.is_active.is_(True),
                ProductVariant.is_deleted.is_(False),
            )
        ).all()
    }
    if len(variants) != len(variant_ids):
        raise NotFoundError("one or more active product variants were not found")

    calculated_items = []
    subtotal = Decimal("0.00")
    tax_amount = Decimal("0.00")
    total_amount = Decimal("0.00")
    for item in payload.items:
        line_subtotal, line_tax, line_total = calculate_item_amounts(
            item.ordered_quantity, item.unit_cost, item.tax_rate
        )
        calculated_items.append((item, line_total))
        subtotal += line_subtotal
        tax_amount += line_tax
        total_amount += line_total

    order = PurchaseOrder(
        branch_id=payload.branch_id,
        supplier_id=payload.supplier_id,
        order_number=_order_number(),
        supplier_reference=payload.supplier_reference,
        status=PurchaseStatus.DRAFT,
        expected_at=payload.expected_at,
        created_by_id=principal.user_id,
        subtotal=subtotal,
        tax_amount=tax_amount,
        discount_amount=Decimal("0.00"),
        total_amount=total_amount,
        notes=payload.notes,
    )
    db.add(order)
    db.flush()
    for item, line_total in calculated_items:
        db.add(
            PurchaseOrderItem(
                purchase_order_id=order.id,
                variant_id=item.variant_id,
                ordered_quantity=item.ordered_quantity,
                received_quantity=0,
                unit_cost=item.unit_cost,
                tax_rate=item.tax_rate,
                line_total=line_total,
            )
        )
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=order.branch_id,
        action="purchase_order.created",
        resource_type="purchase_order",
        resource_id=order.id,
        after=order_snapshot(order),
    )
    return _order_response(db, order)


def update_purchase_order(
    db: Session,
    principal: AuthPrincipal,
    order_id: UUID,
    payload: PurchaseOrderUpdate,
) -> PurchaseOrderResponse:
    enforce_permission(principal, "purchases.create")
    if not payload.model_fields_set:
        raise ValidationError("at least one field is required")
    order = _get_order(db, principal, order_id, lock=True)
    if order.status != PurchaseStatus.DRAFT:
        raise ConflictError("only draft purchase orders can be edited")
    before = order_snapshot(order)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(order, field, value)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=order.branch_id,
        action="purchase_order.updated",
        resource_type="purchase_order",
        resource_id=order.id,
        before=before,
        after=order_snapshot(order),
    )
    return _order_response(db, order)


def submit_purchase_order(
    db: Session, principal: AuthPrincipal, order_id: UUID
) -> PurchaseOrderResponse:
    enforce_permission(principal, "purchases.create")
    order = _get_order(db, principal, order_id, lock=True)
    if order.status != PurchaseStatus.DRAFT:
        raise ConflictError("only draft purchase orders can be submitted")
    before = order_snapshot(order)
    order.status = PurchaseStatus.SUBMITTED
    order.ordered_at = datetime.now(timezone.utc)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=order.branch_id,
        action="purchase_order.submitted",
        resource_type="purchase_order",
        resource_id=order.id,
        before=before,
        after=order_snapshot(order),
    )
    return _order_response(db, order)


def approve_purchase_order(
    db: Session, principal: AuthPrincipal, order_id: UUID
) -> PurchaseOrderResponse:
    enforce_permission(principal, "purchases.approve")
    order = _get_order(db, principal, order_id, lock=True)
    if order.status != PurchaseStatus.SUBMITTED:
        raise ConflictError("only submitted purchase orders can be approved")
    before = order_snapshot(order)
    order.status = PurchaseStatus.APPROVED
    order.approved_by_id = principal.user_id
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=order.branch_id,
        action="purchase_order.approved",
        resource_type="purchase_order",
        resource_id=order.id,
        before=before,
        after=order_snapshot(order),
    )
    return _order_response(db, order)


def cancel_purchase_order(
    db: Session, principal: AuthPrincipal, order_id: UUID
) -> PurchaseOrderResponse:
    enforce_permission(principal, "purchases.approve")
    order = _get_order(db, principal, order_id, lock=True)
    if order.status not in {
        PurchaseStatus.DRAFT,
        PurchaseStatus.SUBMITTED,
        PurchaseStatus.APPROVED,
    }:
        raise ConflictError("this purchase order can no longer be cancelled")
    before = order_snapshot(order)
    order.status = PurchaseStatus.CANCELLED
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=order.branch_id,
        action="purchase_order.cancelled",
        resource_type="purchase_order",
        resource_id=order.id,
        before=before,
        after=order_snapshot(order),
    )
    return _order_response(db, order)


def _receipt_response(db: Session, receipt: GoodsReceipt) -> GoodsReceiptResponse:
    items = db.scalars(
        select(GoodsReceiptItem)
        .where(
            GoodsReceiptItem.receipt_id == receipt.id,
            GoodsReceiptItem.is_deleted.is_(False),
        )
        .order_by(GoodsReceiptItem.created_at)
    ).all()
    return GoodsReceiptResponse.model_validate(receipt).model_copy(
        update={
            "items": [GoodsReceiptItemResponse.model_validate(item) for item in items]
        }
    )


def receive_purchase_order(
    db: Session,
    principal: AuthPrincipal,
    order_id: UUID,
    payload: GoodsReceiptCreate,
) -> GoodsReceiptResponse:
    enforce_permission(principal, "purchases.receive")
    order = _get_order(db, principal, order_id, lock=True)
    if order.status not in {
        PurchaseStatus.APPROVED,
        PurchaseStatus.PARTIALLY_RECEIVED,
    }:
        raise ConflictError("only approved purchase orders can receive stock")

    item_ids = [item.purchase_order_item_id for item in payload.items]
    if len(set(item_ids)) != len(item_ids):
        raise ConflictError("a purchase-order item can appear only once per receipt")
    order_items = {
        item.id: item
        for item in db.scalars(
            select(PurchaseOrderItem)
            .where(
                PurchaseOrderItem.id.in_(item_ids),
                PurchaseOrderItem.purchase_order_id == order.id,
                PurchaseOrderItem.is_deleted.is_(False),
            )
            .with_for_update()
        ).all()
    }
    if len(order_items) != len(item_ids):
        raise NotFoundError("one or more purchase-order items were not found")
    variants = {
        item.id: item
        for item in db.scalars(
            select(ProductVariant).where(
                ProductVariant.id.in_(
                    [order_items[item_id].variant_id for item_id in item_ids]
                ),
                ProductVariant.is_deleted.is_(False),
            )
        ).all()
    }
    for payload_item in payload.items:
        order_item = order_items[payload_item.purchase_order_item_id]
        remaining = order_item.ordered_quantity - order_item.received_quantity
        if payload_item.quantity > remaining:
            raise ValidationError(
                f"receipt quantity exceeds the remaining {remaining} units"
            )
        variant = variants.get(order_item.variant_id)
        if variant is None:
            raise NotFoundError("product variant not found")
        inventory.validate_receipt_identifiers(
            variant.tracking_type,
            payload_item.quantity,
            payload_item.serial_numbers,
            payload_item.imeis,
        )

    now = datetime.now(timezone.utc)
    receipt = GoodsReceipt(
        purchase_order_id=order.id,
        receipt_number=_receipt_number(),
        received_by_id=principal.user_id,
        received_at=now,
        supplier_delivery_note=payload.supplier_delivery_note,
        notes=payload.notes,
    )
    db.add(receipt)
    db.flush()
    for payload_item in payload.items:
        order_item = order_items[payload_item.purchase_order_item_id]
        variant = variants[order_item.variant_id]
        receipt_item = GoodsReceiptItem(
            receipt_id=receipt.id,
            purchase_order_item_id=order_item.id,
            quantity=payload_item.quantity,
            unit_cost=order_item.unit_cost,
        )
        db.add(receipt_item)
        order_item.received_quantity += payload_item.quantity
        inventory.receive_stock(
            db,
            branch_id=order.branch_id,
            variant=variant,
            quantity=payload_item.quantity,
            unit_cost=order_item.unit_cost,
            receipt_id=receipt.id,
            performed_by_id=principal.user_id,
            serial_numbers=payload_item.serial_numbers,
            imeis=payload_item.imeis,
        )
    db.flush()
    all_received = all(
        item.received_quantity == item.ordered_quantity
        for item in db.scalars(
            select(PurchaseOrderItem).where(
                PurchaseOrderItem.purchase_order_id == order.id,
                PurchaseOrderItem.is_deleted.is_(False),
            )
        ).all()
    )
    order.status = (
        PurchaseStatus.RECEIVED if all_received else PurchaseStatus.PARTIALLY_RECEIVED
    )
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=order.branch_id,
        action="purchase_order.received",
        resource_type="goods_receipt",
        resource_id=receipt.id,
        after={
            "receipt_number": receipt.receipt_number,
            "purchase_order_id": str(order.id),
            "status": order.status.value,
        },
    )
    return _receipt_response(db, receipt)


def list_goods_receipts(
    db: Session, principal: AuthPrincipal, order_id: UUID
) -> list[GoodsReceiptResponse]:
    enforce_permission(principal, "purchases.create")
    order = _get_order(db, principal, order_id)
    receipts = db.scalars(
        select(GoodsReceipt)
        .where(
            GoodsReceipt.purchase_order_id == order.id,
            GoodsReceipt.is_deleted.is_(False),
        )
        .order_by(GoodsReceipt.received_at.desc())
    ).all()
    return [_receipt_response(db, receipt) for receipt in receipts]
