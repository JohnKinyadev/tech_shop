from datetime import date
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field

from backend.schemas.base_schemas import BaseSchema


class DailySalesReportRequest(BaseSchema):
    branch_id: UUID | None = None
    report_date: date = Field(default_factory=date.today)


class DailySalesReportResponse(BaseSchema):
    branch_id: UUID | None = None
    report_date: date
    total_sales: Decimal
    total_profit: Decimal
    total_orders: int
    average_ticket: Decimal
