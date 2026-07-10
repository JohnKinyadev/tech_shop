from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from backend.api.dependencies import (
    CurrentPrincipal,
    DatabaseSession,
    require_permission,
)
from backend.models.enums import RepairStatus
from backend.schemas.base_schemas import Page
from backend.schemas.payments_schemas import PaymentResponse
from backend.schemas.repair_schemas import (
    RepairAssignmentUpdate,
    RepairBookingCreate,
    RepairCollectionResponse,
    RepairDiagnosisUpdate,
    RepairIntakeUpdate,
    RepairInvoiceResponse,
    RepairNote,
    RepairPartCreate,
    RepairPaymentCreate,
    RepairQuoteDecision,
    RepairStatusUpdate,
    RepairTicketView,
)
from backend.services import repair_billing
from backend.services import repairs as repair_service
from backend.services.auth import AuthPrincipal

router = APIRouter(prefix="/repairs", tags=["staff-repairs"])
RepairViewPrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("repairs.view"))
]
RepairAssignPrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("repairs.assign"))
]
RepairUpdatePrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("repairs.update"))
]
RepairClosePrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("repairs.close"))
]


@router.get("", response_model=Page[RepairTicketView])
def list_repairs(
    branch_id: UUID,
    principal: RepairViewPrincipal,
    db: DatabaseSession,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    repair_status: RepairStatus | None = Query(default=None, alias="status"),
    technician_id: UUID | None = None,
) -> Page[RepairTicketView]:
    items, total = repair_service.list_tickets(
        db,
        principal,
        branch_id=branch_id,
        page=page,
        page_size=page_size,
        status=repair_status,
        technician_id=technician_id,
    )
    return Page[RepairTicketView](
        items=items, total=total, page=page, page_size=page_size
    )


@router.post(
    "",
    response_model=RepairTicketView,
    status_code=status.HTTP_201_CREATED,
)
def create_repair_booking(
    payload: RepairBookingCreate,
    principal: RepairAssignPrincipal,
    db: DatabaseSession,
) -> RepairTicketView:
    item = repair_service.create_booking(db, principal, payload)
    db.commit()
    return item


@router.get("/{ticket_id}", response_model=RepairTicketView)
def get_repair(
    ticket_id: UUID,
    principal: RepairViewPrincipal,
    db: DatabaseSession,
) -> RepairTicketView:
    return repair_service.get_ticket(db, principal, ticket_id)


@router.post("/{ticket_id}/intake", response_model=RepairTicketView)
def record_repair_intake(
    ticket_id: UUID,
    payload: RepairIntakeUpdate,
    principal: RepairAssignPrincipal,
    db: DatabaseSession,
) -> RepairTicketView:
    item = repair_service.record_intake(db, principal, ticket_id, payload)
    db.commit()
    return item


@router.patch("/{ticket_id}/assignment", response_model=RepairTicketView)
def assign_repair(
    ticket_id: UUID,
    payload: RepairAssignmentUpdate,
    principal: RepairAssignPrincipal,
    db: DatabaseSession,
) -> RepairTicketView:
    item = repair_service.assign_technician(db, principal, ticket_id, payload)
    db.commit()
    return item


@router.post("/{ticket_id}/diagnosis", response_model=RepairTicketView)
def submit_repair_diagnosis(
    ticket_id: UUID,
    payload: RepairDiagnosisUpdate,
    principal: RepairUpdatePrincipal,
    db: DatabaseSession,
) -> RepairTicketView:
    item = repair_service.submit_diagnosis(db, principal, ticket_id, payload)
    db.commit()
    return item


@router.post("/{ticket_id}/quote-decision", response_model=RepairTicketView)
def decide_repair_quote(
    ticket_id: UUID,
    payload: RepairQuoteDecision,
    principal: RepairUpdatePrincipal,
    db: DatabaseSession,
) -> RepairTicketView:
    item = repair_service.decide_quote(db, principal, ticket_id, payload)
    db.commit()
    return item


@router.post("/{ticket_id}/status", response_model=RepairTicketView)
def update_repair_status(
    ticket_id: UUID,
    payload: RepairStatusUpdate,
    principal: RepairUpdatePrincipal,
    db: DatabaseSession,
) -> RepairTicketView:
    item = repair_service.update_status(db, principal, ticket_id, payload)
    db.commit()
    return item


@router.post(
    "/{ticket_id}/parts",
    response_model=RepairTicketView,
    status_code=status.HTTP_201_CREATED,
)
def add_repair_part(
    ticket_id: UUID,
    payload: RepairPartCreate,
    principal: RepairUpdatePrincipal,
    db: DatabaseSession,
) -> RepairTicketView:
    item = repair_service.add_part(db, principal, ticket_id, payload)
    db.commit()
    return item


@router.delete(
    "/{ticket_id}/parts/{part_id}",
    response_model=RepairTicketView,
)
def remove_repair_part(
    ticket_id: UUID,
    part_id: UUID,
    principal: RepairUpdatePrincipal,
    db: DatabaseSession,
) -> RepairTicketView:
    item = repair_service.remove_part(db, principal, ticket_id, part_id)
    db.commit()
    return item


@router.post("/{ticket_id}/ready", response_model=RepairTicketView)
def mark_repair_ready(
    ticket_id: UUID,
    payload: RepairNote,
    principal: RepairClosePrincipal,
    db: DatabaseSession,
) -> RepairTicketView:
    item = repair_service.mark_ready(db, principal, ticket_id, payload.note)
    db.commit()
    return item


@router.post("/{ticket_id}/cancel", response_model=RepairTicketView)
def cancel_repair(
    ticket_id: UUID,
    payload: RepairNote,
    principal: RepairAssignPrincipal,
    db: DatabaseSession,
) -> RepairTicketView:
    item = repair_service.cancel_repair(db, principal, ticket_id, payload.note)
    db.commit()
    return item


@router.get("/{ticket_id}/invoice", response_model=RepairInvoiceResponse)
def get_repair_invoice(
    ticket_id: UUID,
    principal: CurrentPrincipal,
    db: DatabaseSession,
) -> RepairInvoiceResponse:
    return repair_billing.invoice(db, principal, ticket_id)


@router.post("/{ticket_id}/payments", response_model=PaymentResponse)
def add_repair_payment(
    ticket_id: UUID,
    payload: RepairPaymentCreate,
    principal: CurrentPrincipal,
    db: DatabaseSession,
) -> PaymentResponse:
    item = repair_billing.add_payment(db, principal, ticket_id, payload)
    db.commit()
    return item


@router.post("/{ticket_id}/collect", response_model=RepairCollectionResponse)
def collect_repair(
    ticket_id: UUID,
    principal: CurrentPrincipal,
    db: DatabaseSession,
) -> RepairCollectionResponse:
    item = repair_billing.collect_repair(db, principal, ticket_id)
    db.commit()
    return item
