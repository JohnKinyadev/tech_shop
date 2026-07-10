from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.core.permissions import ADMIN, BRANCH_MANAGER, TECHNICIAN
from backend.models.customer import Customer
from backend.models.enums import (
    PaymentDirection,
    PaymentStatus,
    RepairStatus,
    SerializedUnitStatus,
    TrackingType,
)
from backend.models.inventory import SerializedUnit, StockBalance
from backend.models.payments import Payment
from backend.models.products import ProductVariant
from backend.models.repairs import RepairPart, RepairStatusHistory, RepairTicket
from backend.models.roles import Role
from backend.models.users import User
from backend.schemas.repair_schemas import (
    RepairAssignmentUpdate,
    RepairBookingCreate,
    RepairDiagnosisUpdate,
    RepairIntakeUpdate,
    RepairPartCreate,
    RepairPartView,
    RepairQuoteDecision,
    RepairStatusHistoryResponse,
    RepairStatusUpdate,
    RepairTicketView,
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


def _ticket_number() -> str:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"REP-{today}-{uuid4().hex[:8].upper()}"


def _history(
    db: Session,
    ticket: RepairTicket,
    principal: AuthPrincipal,
    to_status: RepairStatus,
    note: str | None = None,
) -> None:
    previous = ticket.status
    ticket.status = to_status
    db.add(
        RepairStatusHistory(
            repair_ticket_id=ticket.id,
            from_status=previous,
            to_status=to_status,
            changed_by_id=principal.user_id,
            note=note,
        )
    )


def _ticket_response(db: Session, ticket: RepairTicket) -> RepairTicketView:
    parts = db.scalars(
        select(RepairPart)
        .where(
            RepairPart.repair_ticket_id == ticket.id,
            RepairPart.is_deleted.is_(False),
        )
        .order_by(RepairPart.created_at)
    ).all()
    history = db.scalars(
        select(RepairStatusHistory)
        .where(
            RepairStatusHistory.repair_ticket_id == ticket.id,
            RepairStatusHistory.is_deleted.is_(False),
        )
        .order_by(RepairStatusHistory.created_at)
    ).all()
    return RepairTicketView.model_validate(ticket).model_copy(
        update={
            "parts": [RepairPartView.model_validate(item) for item in parts],
            "status_history": [
                RepairStatusHistoryResponse.model_validate(item) for item in history
            ],
        }
    )


def _enforce_ticket_scope(principal: AuthPrincipal, ticket: RepairTicket) -> None:
    enforce_branch_scope(principal, ticket.branch_id)
    if principal.role_code == TECHNICIAN and ticket.technician_id != principal.user_id:
        raise AuthorizationError("technicians can only access assigned repair tickets")


def get_ticket_model(
    db: Session,
    principal: AuthPrincipal,
    ticket_id: UUID,
    *,
    permission: str = "repairs.view",
    lock: bool = False,
) -> RepairTicket:
    enforce_permission(principal, permission)
    statement = select(RepairTicket).where(
        RepairTicket.id == ticket_id,
        RepairTicket.is_deleted.is_(False),
    )
    if lock:
        statement = statement.with_for_update()
    ticket = db.scalar(statement)
    if ticket is None:
        raise NotFoundError("repair ticket not found")
    _enforce_ticket_scope(principal, ticket)
    return ticket


def list_tickets(
    db: Session,
    principal: AuthPrincipal,
    *,
    branch_id: UUID,
    page: int,
    page_size: int,
    status: RepairStatus | None = None,
    technician_id: UUID | None = None,
) -> tuple[list[RepairTicketView], int]:
    enforce_permission(principal, "repairs.view")
    enforce_branch_scope(principal, branch_id)
    conditions = [
        RepairTicket.branch_id == branch_id,
        RepairTicket.is_deleted.is_(False),
    ]
    if principal.role_code == TECHNICIAN:
        conditions.append(RepairTicket.technician_id == principal.user_id)
    elif technician_id is not None:
        conditions.append(RepairTicket.technician_id == technician_id)
    if status is not None:
        conditions.append(RepairTicket.status == status)
    total = (
        db.scalar(select(func.count()).select_from(RepairTicket).where(*conditions))
        or 0
    )
    tickets = db.scalars(
        select(RepairTicket)
        .where(*conditions)
        .order_by(RepairTicket.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [_ticket_response(db, ticket) for ticket in tickets], total


def get_ticket(
    db: Session, principal: AuthPrincipal, ticket_id: UUID
) -> RepairTicketView:
    return _ticket_response(db, get_ticket_model(db, principal, ticket_id))


def create_booking(
    db: Session, principal: AuthPrincipal, payload: RepairBookingCreate
) -> RepairTicketView:
    enforce_permission(principal, "repairs.assign")
    enforce_branch_scope(principal, payload.branch_id)
    customer = db.scalar(
        select(Customer).where(
            Customer.id == payload.customer_id,
            Customer.is_active.is_(True),
            Customer.is_deleted.is_(False),
        )
    )
    if customer is None:
        raise NotFoundError("active customer not found")
    if payload.imei and (len(payload.imei) != 15 or not payload.imei.isdigit()):
        raise ValidationError("IMEI must contain exactly 15 digits")
    ticket = RepairTicket(
        ticket_number=_ticket_number(),
        branch_id=payload.branch_id,
        customer_id=payload.customer_id,
        status=RepairStatus.BOOKED,
        device_type=payload.device_type.strip(),
        device_brand=payload.device_brand.strip(),
        device_model=payload.device_model.strip(),
        serial_number=payload.serial_number.strip() if payload.serial_number else None,
        imei=payload.imei,
        reported_issue=payload.reported_issue.strip(),
        booked_for=payload.booked_for,
    )
    db.add(ticket)
    db.flush()
    db.add(
        RepairStatusHistory(
            repair_ticket_id=ticket.id,
            from_status=None,
            to_status=RepairStatus.BOOKED,
            changed_by_id=principal.user_id,
            note="Repair booking created",
        )
    )
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=ticket.branch_id,
        action="repair.booked",
        resource_type="repair_ticket",
        resource_id=ticket.id,
        after={"ticket_number": ticket.ticket_number},
    )
    db.flush()
    return _ticket_response(db, ticket)


def record_intake(
    db: Session,
    principal: AuthPrincipal,
    ticket_id: UUID,
    payload: RepairIntakeUpdate,
) -> RepairTicketView:
    ticket = get_ticket_model(
        db, principal, ticket_id, permission="repairs.assign", lock=True
    )
    if ticket.status not in {RepairStatus.BOOKED, RepairStatus.AWAITING_DROPOFF}:
        raise ConflictError("only booked repairs can be received")
    if payload.serialized_unit_id is not None:
        unit = db.scalar(
            select(SerializedUnit).where(
                SerializedUnit.id == payload.serialized_unit_id,
                SerializedUnit.branch_id == ticket.branch_id,
                SerializedUnit.status.in_(
                    [SerializedUnitStatus.SOLD, SerializedUnitStatus.RETURNED]
                ),
                SerializedUnit.is_deleted.is_(False),
            )
        )
        if unit is None:
            raise NotFoundError("customer device was not found in serialized sales")
        ticket.serialized_unit_id = unit.id
        ticket.serial_number = unit.serial_number or ticket.serial_number
        ticket.imei = unit.imei or ticket.imei
    ticket.intake_condition = payload.intake_condition.strip()
    ticket.intake_images = payload.intake_images
    ticket.accessories_received = payload.accessories_received
    ticket.received_at = datetime.now(timezone.utc)
    _history(db, ticket, principal, RepairStatus.RECEIVED, "Device received")
    db.flush()
    return _ticket_response(db, ticket)


def assign_technician(
    db: Session,
    principal: AuthPrincipal,
    ticket_id: UUID,
    payload: RepairAssignmentUpdate,
) -> RepairTicketView:
    ticket = get_ticket_model(
        db, principal, ticket_id, permission="repairs.assign", lock=True
    )
    if ticket.status in {
        RepairStatus.READY_FOR_PICKUP,
        RepairStatus.COLLECTED,
        RepairStatus.CANCELLED,
    }:
        raise ConflictError("this repair can no longer be assigned")
    technician = db.scalar(
        select(User)
        .join(Role, Role.id == User.role_id)
        .where(
            User.id == payload.technician_id,
            User.branch_id == ticket.branch_id,
            User.is_active.is_(True),
            User.is_deleted.is_(False),
            Role.code == TECHNICIAN,
            Role.is_active.is_(True),
        )
    )
    if technician is None:
        raise NotFoundError("active technician was not found at this branch")
    ticket.technician_id = technician.id
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=ticket.branch_id,
        action="repair.assigned",
        resource_type="repair_ticket",
        resource_id=ticket.id,
        after={"technician_id": str(technician.id)},
    )
    return _ticket_response(db, ticket)


def submit_diagnosis(
    db: Session,
    principal: AuthPrincipal,
    ticket_id: UUID,
    payload: RepairDiagnosisUpdate,
) -> RepairTicketView:
    ticket = get_ticket_model(
        db, principal, ticket_id, permission="repairs.update", lock=True
    )
    if ticket.technician_id is None:
        raise ConflictError("repair must be assigned before diagnosis")
    if ticket.status not in {RepairStatus.RECEIVED, RepairStatus.DIAGNOSING}:
        raise ConflictError("repair is not ready for diagnosis")
    ticket.diagnosis = payload.diagnosis.strip()
    ticket.labor_estimate = payload.labor_estimate
    ticket.parts_estimate = payload.parts_estimate
    _history(db, ticket, principal, RepairStatus.QUOTE_PENDING, "Diagnosis submitted")
    db.flush()
    return _ticket_response(db, ticket)


def decide_quote(
    db: Session,
    principal: AuthPrincipal,
    ticket_id: UUID,
    payload: RepairQuoteDecision,
) -> RepairTicketView:
    ticket = get_ticket_model(
        db, principal, ticket_id, permission="repairs.update", lock=True
    )
    if ticket.status != RepairStatus.QUOTE_PENDING:
        raise ConflictError("repair quote is not awaiting a decision")
    if payload.approved:
        ticket.approved_at = datetime.now(timezone.utc)
        _history(
            db,
            ticket,
            principal,
            RepairStatus.CUSTOMER_APPROVED,
            payload.note or "Customer approved quote",
        )
    else:
        _history(
            db,
            ticket,
            principal,
            RepairStatus.CANCELLED,
            payload.note or "Customer declined quote",
        )
    db.flush()
    return _ticket_response(db, ticket)


ALLOWED_TRANSITIONS = {
    RepairStatus.RECEIVED: {RepairStatus.DIAGNOSING},
    RepairStatus.CUSTOMER_APPROVED: {
        RepairStatus.AWAITING_PARTS,
        RepairStatus.REPAIRING,
    },
    RepairStatus.AWAITING_PARTS: {RepairStatus.REPAIRING},
}


def update_status(
    db: Session,
    principal: AuthPrincipal,
    ticket_id: UUID,
    payload: RepairStatusUpdate,
) -> RepairTicketView:
    ticket = get_ticket_model(
        db, principal, ticket_id, permission="repairs.update", lock=True
    )
    allowed = ALLOWED_TRANSITIONS.get(ticket.status, set())
    if payload.status not in allowed:
        raise ConflictError(
            f"cannot move repair from {ticket.status.value} to {payload.status.value}"
        )
    _history(db, ticket, principal, payload.status, payload.note)
    db.flush()
    return _ticket_response(db, ticket)


def add_part(
    db: Session,
    principal: AuthPrincipal,
    ticket_id: UUID,
    payload: RepairPartCreate,
) -> RepairTicketView:
    ticket = get_ticket_model(
        db, principal, ticket_id, permission="repairs.update", lock=True
    )
    if ticket.status not in {
        RepairStatus.CUSTOMER_APPROVED,
        RepairStatus.AWAITING_PARTS,
        RepairStatus.REPAIRING,
    }:
        raise ConflictError("parts can only be logged after quote approval")
    variant = db.scalar(
        select(ProductVariant).where(
            ProductVariant.id == payload.variant_id,
            ProductVariant.is_active.is_(True),
            ProductVariant.is_deleted.is_(False),
        )
    )
    if variant is None:
        raise NotFoundError("active repair part variant not found")
    balance = db.scalar(
        select(StockBalance).where(
            StockBalance.branch_id == ticket.branch_id,
            StockBalance.variant_id == variant.id,
            StockBalance.is_deleted.is_(False),
        )
    )
    if balance is None:
        raise ConflictError("repair part is out of stock")
    if variant.tracking_type == TrackingType.BULK:
        if payload.serialized_unit_id is not None:
            raise ValidationError("bulk repair parts cannot reference a unit")
        unit_cost = balance.average_unit_cost
    else:
        if payload.serialized_unit_id is None or payload.quantity != 1:
            raise ValidationError("serialized repair parts require one specific unit")
        unit = db.scalar(
            select(SerializedUnit).where(
                SerializedUnit.id == payload.serialized_unit_id,
                SerializedUnit.variant_id == variant.id,
                SerializedUnit.branch_id == ticket.branch_id,
                SerializedUnit.status == SerializedUnitStatus.AVAILABLE,
                SerializedUnit.is_deleted.is_(False),
            )
        )
        if unit is None:
            raise NotFoundError("available serialized repair part not found")
        unit_cost = unit.unit_cost
    part = RepairPart(
        repair_ticket_id=ticket.id,
        variant_id=variant.id,
        serialized_unit_id=payload.serialized_unit_id,
        quantity=payload.quantity,
        unit_cost=unit_cost,
        unit_price=variant.selling_price,
    )
    db.add(part)
    db.flush()
    inventory.consume_repair_part(
        db,
        branch_id=ticket.branch_id,
        repair_ticket_id=ticket.id,
        part=part,
        variant=variant,
        performed_by_id=principal.user_id,
    )
    db.flush()
    return _ticket_response(db, ticket)


def remove_part(
    db: Session, principal: AuthPrincipal, ticket_id: UUID, part_id: UUID
) -> RepairTicketView:
    ticket = get_ticket_model(
        db, principal, ticket_id, permission="repairs.update", lock=True
    )
    if ticket.status in {
        RepairStatus.READY_FOR_PICKUP,
        RepairStatus.COLLECTED,
        RepairStatus.CANCELLED,
    }:
        raise ConflictError("parts cannot be removed from a closed repair")
    part = db.scalar(
        select(RepairPart)
        .where(
            RepairPart.id == part_id,
            RepairPart.repair_ticket_id == ticket.id,
            RepairPart.is_deleted.is_(False),
        )
        .with_for_update()
    )
    if part is None:
        raise NotFoundError("repair part not found")
    variant = db.get(ProductVariant, part.variant_id)
    if variant is None:
        raise NotFoundError("repair part variant no longer exists")
    inventory.restore_repair_part(
        db,
        branch_id=ticket.branch_id,
        repair_ticket_id=ticket.id,
        part=part,
        variant=variant,
        performed_by_id=principal.user_id,
    )
    part.is_deleted = True
    db.flush()
    return _ticket_response(db, ticket)


def mark_ready(
    db: Session,
    principal: AuthPrincipal,
    ticket_id: UUID,
    note: str | None = None,
) -> RepairTicketView:
    ticket = get_ticket_model(
        db, principal, ticket_id, permission="repairs.close", lock=True
    )
    if ticket.status != RepairStatus.REPAIRING:
        raise ConflictError("only repairs in progress can be marked ready")
    if not ticket.diagnosis or ticket.approved_at is None:
        raise ConflictError("diagnosis and customer approval are required")
    ticket.ready_at = datetime.now(timezone.utc)
    _history(
        db,
        ticket,
        principal,
        RepairStatus.READY_FOR_PICKUP,
        note or "Repair ready for pickup",
    )
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=ticket.branch_id,
        action="repair.ready_for_pickup",
        resource_type="repair_ticket",
        resource_id=ticket.id,
        after={"notification_pending": True},
    )
    db.flush()
    return _ticket_response(db, ticket)


def cancel_repair(
    db: Session,
    principal: AuthPrincipal,
    ticket_id: UUID,
    note: str | None = None,
) -> RepairTicketView:
    if principal.role_code not in {ADMIN, BRANCH_MANAGER}:
        raise AuthorizationError("only an Admin or Branch Manager can cancel repairs")
    ticket = get_ticket_model(
        db, principal, ticket_id, permission="repairs.assign", lock=True
    )
    if ticket.status in {
        RepairStatus.READY_FOR_PICKUP,
        RepairStatus.COLLECTED,
        RepairStatus.CANCELLED,
    }:
        raise ConflictError("this repair cannot be cancelled")
    if db.scalar(
        select(RepairPart.id).where(
            RepairPart.repair_ticket_id == ticket.id,
            RepairPart.is_deleted.is_(False),
        )
    ):
        raise ConflictError("remove logged parts before cancelling the repair")
    if db.scalar(
        select(Payment.id).where(
            Payment.repair_ticket_id == ticket.id,
            Payment.direction == PaymentDirection.INCOMING,
            Payment.status == PaymentStatus.COMPLETED,
            Payment.is_deleted.is_(False),
        )
    ):
        raise ConflictError("a paid repair cannot be cancelled without a refund")
    _history(
        db,
        ticket,
        principal,
        RepairStatus.CANCELLED,
        note or "Repair cancelled",
    )
    db.flush()
    return _ticket_response(db, ticket)
