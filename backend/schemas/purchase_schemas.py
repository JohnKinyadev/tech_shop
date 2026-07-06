from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import Field

from backend.models.enums import PurchaseStatus
from backend.schemas.base_schemas import BaseSchema, ModelResponse


class PurchaseOrderItemCreate(BaseSchema):
    variant_id: UUID
    ordered_quantity: int = Field(gt=0)
    unit_cost: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    tax_rate: Decimal = Field(default=Decimal("0.00"), ge=0, le=100)


class PurchaseOrderItemResponse(ModelResponse):
    purchase_order_id: UUID
    variant_id: UUID
    ordered_quantity: int
    received_quantity: int
    unit_cost: Decimal
    tax_rate: Decimal
    line_total: Decimal


class PurchaseOrderCreate(BaseSchema):
    branch_id: UUID
    supplier_id: UUID
    supplier_reference: str | None = Field(default=None, max_length=100)
    expected_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=500)
    items: list[PurchaseOrderItemCreate] = Field(min_length=1)


class PurchaseOrderUpdate(BaseSchema):
    supplier_reference: str | None = Field(default=None, max_length=100)
    expected_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=500)


class PurchaseOrderResponse(ModelResponse):
    branch_id: UUID
    supplier_id: UUID
    order_number: str
    supplier_reference: str | None
    status: PurchaseStatus
    ordered_at: datetime | None
    expected_at: datetime | None
    created_by_id: UUID
    approved_by_id: UUID | None
    subtotal: Decimal
    tax_amount: Decimal
    discount_amount: Decimal
    total_amount: Decimal
    notes: str | None
    items: list[PurchaseOrderItemResponse] = Field(default_factory=list)


class GoodsReceiptItemCreate(BaseSchema):
    purchase_order_item_id: UUID
    quantity: int = Field(gt=0)
    serial_numbers: list[str] = Field(default_factory=list)
    imeis: list[str] = Field(default_factory=list)


class GoodsReceiptItemResponse(ModelResponse):
    receipt_id: UUID
    purchase_order_item_id: UUID
    quantity: int
    unit_cost: Decimal


class GoodsReceiptCreate(BaseSchema):
    supplier_delivery_note: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=500)
    items: list[GoodsReceiptItemCreate] = Field(min_length=1)


class GoodsReceiptResponse(ModelResponse):
    purchase_order_id: UUID
    receipt_number: str
    received_by_id: UUID
    received_at: datetime
    supplier_delivery_note: str | None
    notes: str | None
    items: list[GoodsReceiptItemResponse] = Field(default_factory=list)
