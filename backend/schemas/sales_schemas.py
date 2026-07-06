from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import Field

from backend.models.enums import (
    FulfillmentStatus,
    SaleChannel,
    SaleStatus,
    TillSessionStatus,
)
from backend.schemas.base_schemas import BaseSchema, ModelResponse


class TillCreate(BaseSchema):
    branch_id: UUID
    name: str = Field(min_length=2, max_length=100)
    code: str = Field(min_length=2, max_length=30)


class TillUpdate(BaseSchema):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    is_active: bool | None = None


class TillResponse(ModelResponse):
    branch_id: UUID
    name: str
    code: str
    is_active: bool


class TillSessionOpen(BaseSchema):
    till_id: UUID
    opening_float: Decimal = Field(default=Decimal("0.00"), ge=0)


class TillSessionClose(BaseSchema):
    closing_cash: Decimal = Field(ge=0)


class TillSessionResponse(ModelResponse):
    till_id: UUID
    cashier_id: UUID
    status: TillSessionStatus
    opened_at: datetime
    closed_at: datetime | None
    opening_float: Decimal
    expected_cash: Decimal | None
    closing_cash: Decimal | None


class SaleItemCreate(BaseSchema):
    variant_id: UUID
    serialized_unit_id: UUID | None = None
    quantity: int = Field(gt=0)
    discount_amount: Decimal = Field(default=Decimal("0.00"), ge=0)


class SaleCreate(BaseSchema):
    branch_id: UUID
    customer_id: UUID | None = None
    till_session_id: UUID | None = None
    channel: SaleChannel
    notes: str | None = Field(default=None, max_length=500)
    items: list[SaleItemCreate] = Field(min_length=1)


class SaleItemResponse(ModelResponse):
    sale_id: UUID
    variant_id: UUID
    serialized_unit_id: UUID | None
    description: str
    quantity: int
    unit_price: Decimal
    unit_cost: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    line_total: Decimal


class SaleResponse(ModelResponse):
    branch_id: UUID
    customer_id: UUID | None
    cashier_id: UUID | None
    till_session_id: UUID | None
    invoice_number: str
    channel: SaleChannel
    status: SaleStatus
    fulfillment_status: FulfillmentStatus
    subtotal: Decimal
    tax_amount: Decimal
    discount_amount: Decimal
    total_amount: Decimal
    paid_amount: Decimal
    notes: str | None
    completed_at: datetime | None
    items: list[SaleItemResponse] = Field(default_factory=list)


class SaleReturnItemCreate(BaseSchema):
    sale_item_id: UUID
    quantity: int = Field(gt=0)
    condition: str = Field(min_length=2, max_length=30)


class SaleReturnCreate(BaseSchema):
    reason: str = Field(min_length=3, max_length=500)
    items: list[SaleReturnItemCreate] = Field(min_length=1)


class SaleReturnItemResponse(ModelResponse):
    return_id: UUID
    sale_item_id: UUID
    quantity: int
    condition: str
    restock: bool


class SaleReturnResponse(ModelResponse):
    sale_id: UUID
    return_number: str
    requested_by_id: UUID
    approved_by_id: UUID | None
    status: str
    reason: str
    refund_amount: Decimal
    items: list[SaleReturnItemResponse] = Field(default_factory=list)
