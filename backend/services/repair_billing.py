from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.core.permissions import ADMIN, TECHNICIAN
from backend.models.customer import Customer
from backend.models.enums import (
    PaymentDirection,
    PaymentMethod,
    PaymentStatus,
    RepairStatus,
    TillSessionStatus,
)
from backend.models.payments import Payment
from backend.models.repairs import RepairPart, RepairStatusHistory, RepairTicket
from backend.models.sales import Till, TillSession
from backend.schemas.payments_schemas import PaymentResponse
from backend.schemas.repair_schemas import (
    RepairCollectionResponse,
    RepairInvoicePayment,
    RepairInvoiceResponse,
    RepairPaymentCreate,
)
from backend.services.audit import record_audit
from backend.services.auth import AuthPrincipal
from backend.services.authorization import AuthorizationError, enforce_branch_scope
from backend.services.exceptions import ConflictError, NotFoundError, ValidationError
from backend.services.sales import money


def _can_access_billing(principal: AuthPrincipal) -> bool:
    return principal.role_code == ADMIN or bool(
        {"sales.process", "repairs.view", "repairs.close"} & principal.permissions
    )


def _billing_ticket(
    db: Session, principal: AuthPrincipal, ticket_id: UUID, *, lock: bool = False
) -> RepairTicket:
    if not _can_access_billing(principal):
        raise AuthorizationError("missing repair billing permission")
    statement = select(RepairTicket).where(
        RepairTicket.id == ticket_id,
        RepairTicket.is_deleted.is_(False),
    )
    if lock:
        statement = statement.with_for_update()
    ticket = db.scalar(statement)
    if ticket is None:
        raise NotFoundError("repair ticket not found")
    enforce_branch_scope(principal, ticket.branch_id)
    if principal.role_code == TECHNICIAN and ticket.technician_id != principal.user_id:
        raise AuthorizationError("technicians can only access assigned repair tickets")
    return ticket


def _invoice_values(
    db: Session, ticket: RepairTicket
) -> tuple[Decimal, Decimal, Decimal, Decimal, Decimal, list[Payment]]:
    parts_amount = db.scalar(
        select(
            func.coalesce(func.sum(RepairPart.unit_price * RepairPart.quantity), 0)
        ).where(
            RepairPart.repair_ticket_id == ticket.id,
            RepairPart.is_deleted.is_(False),
        )
    ) or Decimal("0.00")
    payments = list(
        db.scalars(
            select(Payment)
            .where(
                Payment.repair_ticket_id == ticket.id,
                Payment.direction == PaymentDirection.INCOMING,
                Payment.status == PaymentStatus.COMPLETED,
                Payment.is_deleted.is_(False),
            )
            .order_by(Payment.paid_at, Payment.created_at)
        ).all()
    )
    labor = money(ticket.labor_estimate)
    parts = money(parts_amount)
    total = money(labor + parts)
    paid = money(sum((payment.amount for payment in payments), Decimal("0.00")))
    due = money(max(total - paid, Decimal("0.00")))
    return labor, parts, total, paid, due, payments


def invoice(
    db: Session, principal: AuthPrincipal, ticket_id: UUID
) -> RepairInvoiceResponse:
    ticket = _billing_ticket(db, principal, ticket_id)
    if ticket.status in {
        RepairStatus.BOOKED,
        RepairStatus.AWAITING_DROPOFF,
        RepairStatus.RECEIVED,
        RepairStatus.DIAGNOSING,
        RepairStatus.QUOTE_PENDING,
        RepairStatus.CANCELLED,
    }:
        raise ConflictError("repair invoice is not available yet")
    customer = db.get(Customer, ticket.customer_id)
    if customer is None:
        raise NotFoundError("repair customer no longer exists")
    labor, parts, total, paid, due, payments = _invoice_values(db, ticket)
    if due == 0:
        payment_status = "paid"
    elif paid > 0:
        payment_status = "partially_paid"
    else:
        payment_status = "unpaid"
    return RepairInvoiceResponse(
        ticket_id=ticket.id,
        ticket_number=ticket.ticket_number,
        branch_id=ticket.branch_id,
        customer_id=customer.id,
        customer_name=customer.full_name,
        customer_phone=customer.phone,
        device_description=(
            f"{ticket.device_brand} {ticket.device_model} ({ticket.device_type})"
        ),
        labor_amount=labor,
        parts_amount=parts,
        total_amount=total,
        paid_amount=paid,
        balance_due=due,
        payment_status=payment_status,
        payments=[
            RepairInvoicePayment(
                method=payment.method,
                amount=payment.amount,
                provider_reference=payment.provider_reference,
                paid_at=payment.paid_at,
            )
            for payment in payments
        ],
    )


def _open_payment_session(
    db: Session, principal: AuthPrincipal, session_id: UUID, branch_id: UUID
) -> TillSession:
    session = db.scalar(
        select(TillSession)
        .join(Till, Till.id == TillSession.till_id)
        .where(
            TillSession.id == session_id,
            TillSession.cashier_id == principal.user_id,
            TillSession.status == TillSessionStatus.OPEN,
            TillSession.is_deleted.is_(False),
            Till.branch_id == branch_id,
            Till.is_active.is_(True),
            Till.is_deleted.is_(False),
        )
    )
    if session is None:
        raise ConflictError("repair payment requires the user's open till session")
    return session


def add_payment(
    db: Session,
    principal: AuthPrincipal,
    ticket_id: UUID,
    payload: RepairPaymentCreate,
) -> PaymentResponse:
    ticket = _billing_ticket(db, principal, ticket_id, lock=True)
    if principal.role_code != ADMIN and "sales.process" not in principal.permissions:
        raise AuthorizationError("only checkout staff can receive repair payments")
    if ticket.status in {
        RepairStatus.BOOKED,
        RepairStatus.AWAITING_DROPOFF,
        RepairStatus.RECEIVED,
        RepairStatus.DIAGNOSING,
        RepairStatus.QUOTE_PENDING,
        RepairStatus.CANCELLED,
        RepairStatus.COLLECTED,
    }:
        raise ConflictError("repair is not eligible for payment")
    _open_payment_session(db, principal, payload.till_session_id, ticket.branch_id)
    existing = db.scalar(
        select(Payment).where(Payment.idempotency_key == payload.idempotency_key)
    )
    if existing is not None:
        if existing.repair_ticket_id != ticket.id:
            raise ConflictError("payment idempotency key is already in use")
        return PaymentResponse.model_validate(existing)
    if payload.method == PaymentMethod.STORE_CREDIT:
        raise ValidationError("store credit is not available yet")
    if payload.method != PaymentMethod.CASH and not payload.provider_reference:
        raise ValidationError("non-cash payments require a provider reference")
    if payload.provider_reference and db.scalar(
        select(Payment.id).where(
            Payment.provider_reference == payload.provider_reference
        )
    ):
        raise ConflictError("payment provider reference is already in use")
    _, _, _, _, due, _ = _invoice_values(db, ticket)
    if payload.amount > due:
        raise ValidationError("payment exceeds the repair balance")
    now = datetime.now(timezone.utc)
    payment = Payment(
        branch_id=ticket.branch_id,
        till_session_id=payload.till_session_id,
        repair_ticket_id=ticket.id,
        direction=PaymentDirection.INCOMING,
        method=payload.method,
        status=PaymentStatus.COMPLETED,
        amount=money(payload.amount),
        currency="KES",
        provider_reference=payload.provider_reference,
        idempotency_key=payload.idempotency_key,
        paid_at=now,
        notes=payload.notes,
    )
    db.add(payment)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=ticket.branch_id,
        action="repair.payment_recorded",
        resource_type="repair_ticket",
        resource_id=ticket.id,
        after={"amount": str(payment.amount), "method": payment.method.value},
    )
    return PaymentResponse.model_validate(payment)


def collect_repair(
    db: Session, principal: AuthPrincipal, ticket_id: UUID
) -> RepairCollectionResponse:
    ticket = _billing_ticket(db, principal, ticket_id, lock=True)
    if principal.role_code != ADMIN and not (
        {"sales.process", "repairs.close"} & principal.permissions
    ):
        raise AuthorizationError("missing repair collection permission")
    if ticket.status != RepairStatus.READY_FOR_PICKUP:
        raise ConflictError("only ready repairs can be collected")
    _, _, _, _, due, _ = _invoice_values(db, ticket)
    if due != 0:
        raise ConflictError("repair invoice must be fully paid before collection")
    ticket.collected_at = datetime.now(timezone.utc)
    previous = ticket.status
    ticket.status = RepairStatus.COLLECTED
    db.add(
        RepairStatusHistory(
            repair_ticket_id=ticket.id,
            from_status=previous,
            to_status=RepairStatus.COLLECTED,
            changed_by_id=principal.user_id,
            note="Device collected by customer",
        )
    )
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=ticket.branch_id,
        action="repair.collected",
        resource_type="repair_ticket",
        resource_id=ticket.id,
    )
    return RepairCollectionResponse(
        ticket_id=ticket.id,
        ticket_number=ticket.ticket_number,
        status=ticket.status,
        collected_at=ticket.collected_at,
    )
