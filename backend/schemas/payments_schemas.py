from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import Field, model_validator

from backend.models.enums import PaymentDirection, PaymentMethod, PaymentStatus
from backend.schemas.base_schemas import BaseSchema, ModelResponse


class PaymentCreate(BaseSchema):
    branch_id: UUID
    sale_id: UUID | None = None
    till_session_id: UUID | None = None
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


class SalePaymentCreate(BaseSchema):
    method: PaymentMethod
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    provider_reference: str | None = Field(default=None, max_length=150)
    idempotency_key: str = Field(min_length=8, max_length=150)
    notes: str | None = Field(default=None, max_length=500)


class FailedPaymentAttemptCreate(BaseSchema):
    method: PaymentMethod
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    status: PaymentStatus = PaymentStatus.FAILED
    provider_reference: str | None = Field(default=None, max_length=150)
    idempotency_key: str = Field(min_length=8, max_length=150)
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def valid_failed_attempt(self) -> "FailedPaymentAttemptCreate":
        if self.status not in {PaymentStatus.FAILED, PaymentStatus.CANCELLED}:
            raise ValueError("failed attempts can only be failed or cancelled")
        if self.method == PaymentMethod.CASH:
            raise ValueError("cash should not be recorded as a failed payment attempt")
        return self


class PaymentAttemptOutcomeUpdate(BaseSchema):
    status: PaymentStatus
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def valid_outcome(self) -> "PaymentAttemptOutcomeUpdate":
        if self.status not in {PaymentStatus.FAILED, PaymentStatus.CANCELLED}:
            raise ValueError("payment outcome can only be failed or cancelled")
        return self


class PaymentResponse(ModelResponse):
    branch_id: UUID
    sale_id: UUID | None
    till_session_id: UUID | None
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


class MpesaStkPushCreate(BaseSchema):
    phone_number: str = Field(min_length=9, max_length=15)
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    idempotency_key: str = Field(min_length=8, max_length=150)
    notes: str | None = Field(default=None, max_length=500)


class MpesaStkPushResponse(BaseSchema):
    payment: PaymentResponse
    merchant_request_id: str
    checkout_request_id: str
    customer_message: str


class MpesaManualConfirmCreate(BaseSchema):
    provider_reference: str = Field(min_length=5, max_length=150)
    notes: str | None = Field(default=None, max_length=500)


class MpesaStkQueryResponse(BaseSchema):
    payment: PaymentResponse
    checkout_request_id: str
    result_code: int | None
    result_description: str
    customer_message: str
