from datetime import datetime
from uuid import UUID

from pydantic import Field

from backend.models.enums import StockCountStatus
from backend.schemas.base_schemas import BaseSchema, ModelResponse


class StockCountCreate(BaseSchema):
    branch_id: UUID
    variant_ids: list[UUID] | None = None
    notes: str | None = Field(default=None, max_length=500)


class StockCountItemUpdate(BaseSchema):
    counted_quantity: int = Field(ge=0)
    notes: str | None = Field(default=None, max_length=500)


class StockCountItemResponse(ModelResponse):
    stock_count_id: UUID
    variant_id: UUID
    expected_quantity: int
    counted_quantity: int | None
    variance: int | None
    notes: str | None


class StockCountResponse(ModelResponse):
    branch_id: UUID
    count_number: str
    status: StockCountStatus
    created_by_id: UUID
    approved_by_id: UUID | None
    submitted_at: datetime | None
    approved_at: datetime | None
    notes: str | None
    items: list[StockCountItemResponse] = Field(default_factory=list)
