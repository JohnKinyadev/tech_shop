from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from backend.api.dependencies import DatabaseSession, require_permission
from backend.models.enums import SerializedUnitStatus
from backend.schemas.approval_schemas import ApprovalDecision, ApprovalRequestResponse
from backend.schemas.base_schemas import Page
from backend.schemas.inventory_schemas import (
    InventoryBalanceView,
    SerializedUnitView,
    StockAdjustmentCreate,
    StockMovementResponse,
    StockTransferCreate,
    StockTransferResponse,
)
from backend.schemas.stocktake_schemas import (
    StockCountCreate,
    StockCountItemUpdate,
    StockCountResponse,
)
from backend.services import inventory_control
from backend.services import stocktake as stocktake_service
from backend.services import transfers as transfer_service
from backend.services.auth import AuthPrincipal

router = APIRouter(prefix="/inventory", tags=["staff-inventory"])
InventoryViewPrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("inventory.view"))
]
InventoryAdjustPrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("inventory.adjust"))
]
InventoryTransferPrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("inventory.transfer"))
]


@router.get("/balances", response_model=Page[InventoryBalanceView])
def list_balances(
    branch_id: UUID,
    principal: InventoryViewPrincipal,
    db: DatabaseSession,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    query: str | None = Query(default=None, min_length=1, max_length=150),
    low_stock_only: bool = False,
) -> Page[InventoryBalanceView]:
    items, total = inventory_control.list_balances(
        db,
        principal,
        branch_id=branch_id,
        page=page,
        page_size=page_size,
        query=query,
        low_stock_only=low_stock_only,
    )
    return Page[InventoryBalanceView](
        items=items, total=total, page=page, page_size=page_size
    )


@router.get("/serialized-units", response_model=Page[SerializedUnitView])
def list_serialized_units(
    branch_id: UUID,
    principal: InventoryViewPrincipal,
    db: DatabaseSession,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    query: str | None = Query(default=None, min_length=1, max_length=150),
    unit_status: SerializedUnitStatus | None = Query(default=None, alias="status"),
) -> Page[SerializedUnitView]:
    items, total = inventory_control.list_serialized_units(
        db,
        principal,
        branch_id=branch_id,
        page=page,
        page_size=page_size,
        query=query,
        status=unit_status,
    )
    return Page[SerializedUnitView](
        items=items, total=total, page=page, page_size=page_size
    )


@router.get("/movements", response_model=Page[StockMovementResponse])
def list_movements(
    branch_id: UUID,
    principal: InventoryAdjustPrincipal,
    db: DatabaseSession,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    variant_id: UUID | None = None,
) -> Page[StockMovementResponse]:
    items, total = inventory_control.list_movements(
        db,
        principal,
        branch_id=branch_id,
        page=page,
        page_size=page_size,
        variant_id=variant_id,
    )
    return Page[StockMovementResponse](
        items=items, total=total, page=page, page_size=page_size
    )


@router.get("/adjustment-requests", response_model=list[ApprovalRequestResponse])
def list_adjustment_requests(
    branch_id: UUID,
    principal: InventoryAdjustPrincipal,
    db: DatabaseSession,
) -> list[ApprovalRequestResponse]:
    return inventory_control.list_adjustment_requests(db, principal, branch_id)


@router.post(
    "/adjustment-requests",
    response_model=ApprovalRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
def request_adjustment(
    payload: StockAdjustmentCreate,
    principal: InventoryAdjustPrincipal,
    db: DatabaseSession,
) -> ApprovalRequestResponse:
    request = inventory_control.request_adjustment(db, principal, payload)
    db.commit()
    return ApprovalRequestResponse.model_validate(request)


@router.post(
    "/adjustment-requests/{request_id}/decision",
    response_model=ApprovalRequestResponse,
)
def decide_adjustment(
    request_id: UUID,
    payload: ApprovalDecision,
    principal: InventoryAdjustPrincipal,
    db: DatabaseSession,
) -> ApprovalRequestResponse:
    request = inventory_control.decide_adjustment(db, principal, request_id, payload)
    db.commit()
    return request


@router.get("/transfers", response_model=list[StockTransferResponse])
def list_transfers(
    branch_id: UUID,
    principal: InventoryTransferPrincipal,
    db: DatabaseSession,
) -> list[StockTransferResponse]:
    return transfer_service.list_transfers(db, principal, branch_id)


@router.post(
    "/transfers",
    response_model=StockTransferResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_transfer(
    payload: StockTransferCreate,
    principal: InventoryTransferPrincipal,
    db: DatabaseSession,
) -> StockTransferResponse:
    transfer = transfer_service.create_transfer(db, principal, payload)
    db.commit()
    return transfer


@router.post("/transfers/{transfer_id}/approve", response_model=StockTransferResponse)
def approve_transfer(
    transfer_id: UUID,
    principal: InventoryTransferPrincipal,
    db: DatabaseSession,
) -> StockTransferResponse:
    transfer = transfer_service.approve_transfer(db, principal, transfer_id)
    db.commit()
    return transfer


@router.post("/transfers/{transfer_id}/dispatch", response_model=StockTransferResponse)
def dispatch_transfer(
    transfer_id: UUID,
    principal: InventoryTransferPrincipal,
    db: DatabaseSession,
) -> StockTransferResponse:
    transfer = transfer_service.dispatch_transfer(db, principal, transfer_id)
    db.commit()
    return transfer


@router.post("/transfers/{transfer_id}/receive", response_model=StockTransferResponse)
def receive_transfer(
    transfer_id: UUID,
    principal: InventoryTransferPrincipal,
    db: DatabaseSession,
) -> StockTransferResponse:
    transfer = transfer_service.receive_transfer(db, principal, transfer_id)
    db.commit()
    return transfer


@router.post("/transfers/{transfer_id}/cancel", response_model=StockTransferResponse)
def cancel_transfer(
    transfer_id: UUID,
    principal: InventoryTransferPrincipal,
    db: DatabaseSession,
) -> StockTransferResponse:
    transfer = transfer_service.cancel_transfer(db, principal, transfer_id)
    db.commit()
    return transfer


@router.get("/stock-counts", response_model=list[StockCountResponse])
def list_stock_counts(
    branch_id: UUID,
    principal: InventoryAdjustPrincipal,
    db: DatabaseSession,
) -> list[StockCountResponse]:
    return stocktake_service.list_stock_counts(db, principal, branch_id)


@router.post(
    "/stock-counts",
    response_model=StockCountResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_stock_count(
    payload: StockCountCreate,
    principal: InventoryAdjustPrincipal,
    db: DatabaseSession,
) -> StockCountResponse:
    count = stocktake_service.create_stock_count(db, principal, payload)
    db.commit()
    return count


@router.patch(
    "/stock-counts/{count_id}/items/{item_id}", response_model=StockCountResponse
)
def update_stock_count_item(
    count_id: UUID,
    item_id: UUID,
    payload: StockCountItemUpdate,
    principal: InventoryAdjustPrincipal,
    db: DatabaseSession,
) -> StockCountResponse:
    count = stocktake_service.update_count_item(
        db, principal, count_id, item_id, payload
    )
    db.commit()
    return count


@router.post("/stock-counts/{count_id}/submit", response_model=StockCountResponse)
def submit_stock_count(
    count_id: UUID,
    principal: InventoryAdjustPrincipal,
    db: DatabaseSession,
) -> StockCountResponse:
    count = stocktake_service.submit_stock_count(db, principal, count_id)
    db.commit()
    return count


@router.post("/stock-counts/{count_id}/approve", response_model=StockCountResponse)
def approve_stock_count(
    count_id: UUID,
    principal: InventoryAdjustPrincipal,
    db: DatabaseSession,
) -> StockCountResponse:
    count = stocktake_service.approve_stock_count(db, principal, count_id)
    db.commit()
    return count


@router.post("/stock-counts/{count_id}/cancel", response_model=StockCountResponse)
def cancel_stock_count(
    count_id: UUID,
    principal: InventoryAdjustPrincipal,
    db: DatabaseSession,
) -> StockCountResponse:
    count = stocktake_service.cancel_stock_count(db, principal, count_id)
    db.commit()
    return count
