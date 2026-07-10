from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from backend.api.dependencies import (
    CurrentPrincipal,
    DatabaseSession,
    require_permission,
)
from backend.schemas.report_schemas import (
    DashboardSummaryResponse,
    ExpenseSummaryResponse,
    InventorySummaryResponse,
    RepairSummaryResponse,
    SalesSummaryResponse,
)
from backend.services import reports as report_service
from backend.services.auth import AuthPrincipal

router = APIRouter(prefix="/reports", tags=["staff-reports"])
SalesReportPrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("reports.sales.view"))
]
InventoryReportPrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("reports.inventory.view"))
]
ExpenseReportPrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("expenses.view"))
]


@router.get("/dashboard", response_model=DashboardSummaryResponse)
def dashboard_report(
    principal: CurrentPrincipal,
    db: DatabaseSession,
    branch_id: UUID | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> DashboardSummaryResponse:
    return report_service.dashboard_summary(
        db,
        principal,
        branch_id=branch_id,
        start_at=start_at,
        end_at=end_at,
    )


@router.get("/sales", response_model=SalesSummaryResponse)
def sales_report(
    principal: SalesReportPrincipal,
    db: DatabaseSession,
    branch_id: UUID | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    top_limit: int = Query(default=10, ge=1, le=50),
) -> SalesSummaryResponse:
    return report_service.sales_summary(
        db,
        principal,
        branch_id=branch_id,
        start_at=start_at,
        end_at=end_at,
        top_limit=top_limit,
    )


@router.get("/inventory", response_model=InventorySummaryResponse)
def inventory_report(
    principal: InventoryReportPrincipal,
    db: DatabaseSession,
    branch_id: UUID | None = None,
    low_stock_limit: int = Query(default=20, ge=1, le=100),
) -> InventorySummaryResponse:
    return report_service.inventory_summary(
        db,
        principal,
        branch_id=branch_id,
        low_stock_limit=low_stock_limit,
    )


@router.get("/repairs", response_model=RepairSummaryResponse)
def repair_report(
    principal: CurrentPrincipal,
    db: DatabaseSession,
    branch_id: UUID | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    technician_id: UUID | None = None,
) -> RepairSummaryResponse:
    return report_service.repair_summary(
        db,
        principal,
        branch_id=branch_id,
        start_at=start_at,
        end_at=end_at,
        technician_id=technician_id,
    )


@router.get("/expenses", response_model=ExpenseSummaryResponse)
def expense_report(
    principal: ExpenseReportPrincipal,
    db: DatabaseSession,
    branch_id: UUID | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> ExpenseSummaryResponse:
    return report_service.expense_summary(
        db,
        principal,
        branch_id=branch_id,
        start_at=start_at,
        end_at=end_at,
    )
