from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import Field, model_validator

from backend.models.enums import PaymentDirection, PaymentMethod, PaymentStatus
from backend.schemas.base_schemas import BaseSchema, ModelResponse


class PaymentCreate(BaseSchema):
    branch_id: UUID
    sale_id: UUID | None = None
    repair_ticket_id: UUID | None = None
    purchase_order_id: UUID | None = None
    direction: PaymentDirection
    method: PaymentMethod
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    currency: str = Field(default="KES", min_length=3, max_length=3)
    idempotency_key: str = Field(min_length=8, max_length=150)
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def has_parent(self) -> "PaymentCreate":
        parents = [self.sale_id, self.repair_ticket_id, self.purchase_order_id]
        if sum(value is not None for value in parents) != 1:
            raise ValueError("payment must reference exactly one business document")
        return self


class PaymentResponse(ModelResponse):
    branch_id: UUID
    sale_id: UUID | None
    repair_ticket_id: UUID | None
    purchase_order_id: UUID | None
    direction: PaymentDirection
    method: PaymentMethod
    status: PaymentStatus
    amount: Decimal
    currency: str
    provider_reference: str | None
    paid_at: datetime | None
    notes: str | None
