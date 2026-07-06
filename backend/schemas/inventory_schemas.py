from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import Field, model_validator

from backend.models.enums import SerializedUnitStatus, StockMovementType, TransferStatus
from backend.schemas.base_schemas import BaseSchema, ModelResponse


class StockBalanceResponse(ModelResponse):
    branch_id: UUID
    variant_id: UUID
    quantity_on_hand: int
    reserved_quantity: int
    reorder_level: int
    average_unit_cost: Decimal
    last_stock_take_at: datetime | None


class InventoryBalanceView(BaseSchema):
    stock_balance_id: UUID
    branch_id: UUID
    product_id: UUID
    product_name: str
    variant_id: UUID
    variant_name: str
    sku: str
    quantity_on_hand: int
    reserved_quantity: int
    available_quantity: int
    reorder_level: int
    is_low_stock: bool


class SerializedUnitCreate(BaseSchema):
    variant_id: UUID
    branch_id: UUID
    serial_number: str | None = Field(default=None, max_length=120)
    imei: str | None = Field(default=None, max_length=20)
    unit_cost: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    condition: str = Field(default="new", max_length=30)
    received_at: datetime

    @model_validator(mode="after")
    def has_identifier(self) -> "SerializedUnitCreate":
        if not self.serial_number and not self.imei:
            raise ValueError("a serialized unit requires a serial number or IMEI")
        return self


class SerializedUnitResponse(ModelResponse):
    variant_id: UUID
    branch_id: UUID
    serial_number: str | None
    imei: str | None
    status: SerializedUnitStatus
    unit_cost: Decimal
    condition: str
    received_at: datetime


class SerializedUnitView(BaseSchema):
    id: UUID
    branch_id: UUID
    product_id: UUID
    product_name: str
    variant_id: UUID
    variant_name: str
    sku: str
    serial_number: str | None
    imei: str | None
    status: SerializedUnitStatus
    condition: str
    received_at: datetime


class SerializedUnitUpdate(BaseSchema):
    condition: str | None = Field(default=None, min_length=2, max_length=30)


class StockReservationResponse(ModelResponse):
    branch_id: UUID
    variant_id: UUID
    serialized_unit_id: UUID | None
    quantity: int
    reference_type: str
    reference_id: UUID
    status: str
    expires_at: datetime


class StockAdjustmentCreate(BaseSchema):
    branch_id: UUID
    variant_id: UUID
    serialized_unit_id: UUID | None = None
    quantity_delta: int
    reason: str = Field(min_length=3, max_length=500)

    @model_validator(mode="after")
    def quantity_must_change(self) -> "StockAdjustmentCreate":
        if self.quantity_delta == 0:
            raise ValueError("quantity_delta cannot be zero")
        return self


class StockMovementResponse(ModelResponse):
    branch_id: UUID
    variant_id: UUID
    serialized_unit_id: UUID | None
    movement_type: StockMovementType
    quantity_delta: int
    unit_cost: Decimal | None
    reference_type: str
    reference_id: UUID
    performed_by_id: UUID
    note: str | None


class StockTransferItemCreate(BaseSchema):
    variant_id: UUID
    serialized_unit_id: UUID | None = None
    quantity: int = Field(gt=0)


class StockTransferItemResponse(ModelResponse):
    transfer_id: UUID
    variant_id: UUID
    serialized_unit_id: UUID | None
    quantity: int


class StockTransferCreate(BaseSchema):
    source_branch_id: UUID
    destination_branch_id: UUID
    notes: str | None = Field(default=None, max_length=500)
    items: list[StockTransferItemCreate] = Field(min_length=1)

    @model_validator(mode="after")
    def different_branches(self) -> "StockTransferCreate":
        if self.source_branch_id == self.destination_branch_id:
            raise ValueError("source and destination branches must differ")
        return self


class StockTransferResponse(ModelResponse):
    transfer_number: str
    source_branch_id: UUID
    destination_branch_id: UUID
    status: TransferStatus
    requested_by_id: UUID
    approved_by_id: UUID | None
    dispatched_at: datetime | None
    received_at: datetime | None
    notes: str | None
    items: list[StockTransferItemResponse] = Field(default_factory=list)
