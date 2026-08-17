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


def _invoice_payment_status(due: Decimal, paid: Decimal) -> str:
    if due == 0:
        return "paid"
    if paid > 0:
        return "partially_paid"
    return "unpaid"


def _invoice_response(
    db: Session, ticket: RepairTicket, customer: Customer
) -> RepairInvoiceResponse:
    labor, parts, total, paid, due, payments = _invoice_values(db, ticket)
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
        service_description=ticket.diagnosis or ticket.reported_issue,
        labor_amount=labor,
        parts_amount=parts,
        total_amount=total,
        paid_amount=paid,
        balance_due=due,
        payment_status=_invoice_payment_status(due, paid),
        payments=[
            RepairInvoicePayment(
                method=payment.method,
                amount=payment.amount,
                provider_reference=payment.provider_reference,
                payer_phone=payment.payer_phone,
                payer_name=payment.payer_name,
                payer_account_reference=payment.payer_account_reference,
                paid_at=payment.paid_at,
            )
            for payment in payments
        ],
    )


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
    return _invoice_response(db, ticket, customer)


def list_ready_pickups(
    db: Session, principal: AuthPrincipal, branch_id: UUID
) -> list[RepairInvoiceResponse]:
    if principal.role_code != ADMIN and "sales.process" not in principal.permissions:
        raise AuthorizationError("only checkout staff can view repair pickups")
    enforce_branch_scope(principal, branch_id)

    rows = db.execute(
        select(RepairTicket, Customer)
        .join(Customer, Customer.id == RepairTicket.customer_id)
        .where(
            RepairTicket.branch_id == branch_id,
            RepairTicket.status == RepairStatus.READY_FOR_PICKUP,
            RepairTicket.is_deleted.is_(False),
            Customer.is_deleted.is_(False),
        )
        .order_by(
            RepairTicket.ready_at.is_(None),
            RepairTicket.ready_at,
            RepairTicket.created_at,
        )
    ).all()
    return [_invoice_response(db, ticket, customer) for ticket, customer in rows]


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


def payment_context(
    db: Session,
    principal: AuthPrincipal,
    ticket_id: UUID,
    till_session_id: UUID,
    *,
    lock: bool = False,
) -> tuple[RepairTicket, TillSession, Decimal]:
    ticket = _billing_ticket(db, principal, ticket_id, lock=lock)
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
    session = _open_payment_session(db, principal, till_session_id, ticket.branch_id)
    _, _, _, _, due, _ = _invoice_values(db, ticket)
    return ticket, session, due


def balance_due(db: Session, ticket: RepairTicket) -> Decimal:
    _, _, _, _, due, _ = _invoice_values(db, ticket)
    return due


def complete_pending_payment(
    db: Session,
    payment: Payment,
    *,
    provider_reference: str | None,
    provider_payload: dict | None,
    paid_at: datetime | None = None,
) -> PaymentResponse:
    if payment.status == PaymentStatus.COMPLETED:
        if provider_reference and provider_reference != payment.provider_reference:
            duplicate = db.scalar(
                select(Payment.id).where(
                    Payment.provider_reference == provider_reference,
                    Payment.id != payment.id,
                    Payment.is_deleted.is_(False),
                )
            )
            if duplicate is not None:
                raise ConflictError("payment provider reference is already in use")
            payment.provider_reference = provider_reference
        if provider_payload:
            payment.provider_payload = {
                **(payment.provider_payload or {}),
                **provider_payload,
            }
            if not payment.payer_phone and provider_payload.get("phone_number"):
                payment.payer_phone = str(provider_payload["phone_number"])
            if (
                not payment.payer_account_reference
                and provider_payload.get("account_reference")
            ):
                payment.payer_account_reference = str(
                    provider_payload["account_reference"]
                )
        if paid_at and payment.paid_at is None:
            payment.paid_at = paid_at
        db.flush()
        return PaymentResponse.model_validate(payment)

    if payment.status != PaymentStatus.PENDING:
        raise ConflictError("only pending payments can be completed")
    if payment.repair_ticket_id is None:
        raise ConflictError("payment is not linked to a repair ticket")

    ticket = db.scalar(
        select(RepairTicket)
        .where(
            RepairTicket.id == payment.repair_ticket_id,
            RepairTicket.is_deleted.is_(False),
        )
        .with_for_update()
    )
    if ticket is None:
        raise NotFoundError("repair ticket not found")
    due = balance_due(db, ticket)
    if payment.amount > due:
        raise ValidationError("payment exceeds the repair balance")
    if provider_reference and provider_reference != payment.provider_reference:
        duplicate = db.scalar(
            select(Payment.id).where(
                Payment.provider_reference == provider_reference,
                Payment.id != payment.id,
                Payment.is_deleted.is_(False),
            )
        )
        if duplicate is not None:
            raise ConflictError("payment provider reference is already in use")

    now = paid_at or datetime.now(timezone.utc)
    payment.status = PaymentStatus.COMPLETED
    payment.provider_reference = provider_reference or payment.provider_reference
    payment.provider_payload = {
        **(payment.provider_payload or {}),
        **(provider_payload or {}),
    }
    if provider_payload:
        if not payment.payer_phone and provider_payload.get("phone_number"):
            payment.payer_phone = str(provider_payload["phone_number"])
        if (
            not payment.payer_account_reference
            and provider_payload.get("account_reference")
        ):
            payment.payer_account_reference = str(
                provider_payload["account_reference"]
            )
    payment.paid_at = now
    db.flush()

    cashier_id = None
    if payment.till_session_id is not None:
        session = db.get(TillSession, payment.till_session_id)
        cashier_id = session.cashier_id if session else None
    record_audit(
        db,
        actor_id=cashier_id,
        branch_id=ticket.branch_id,
        action="repair.payment_recorded",
        resource_type="repair_ticket",
        resource_id=ticket.id,
        after={"amount": str(payment.amount), "method": payment.method.value},
    )
    return PaymentResponse.model_validate(payment)


def add_payment(
    db: Session,
    principal: AuthPrincipal,
    ticket_id: UUID,
    payload: RepairPaymentCreate,
) -> PaymentResponse:
    ticket, _, due = payment_context(
        db, principal, ticket_id, payload.till_session_id, lock=True
    )
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
        payer_phone=payload.payer_phone,
        payer_name=payload.payer_name,
        payer_account_reference=payload.payer_account_reference,
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
