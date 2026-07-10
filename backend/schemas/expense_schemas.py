from decimal import Decimal
from uuid import UUID

from pydantic import Field

from backend.models.enums import PaymentMethod
from backend.schemas.base_schemas import BaseSchema, ModelResponse


class ExpenseCategoryCreate(BaseSchema):
    name: str = Field(min_length=2, max_length=150)
    description: str | None = Field(default=None, max_length=500)


class ExpenseCategoryUpdate(BaseSchema):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    description: str | None = Field(default=None, max_length=500)


class ExpenseCategoryResponse(ModelResponse):
    name: str
    description: str | None


class ExpenseCreate(BaseSchema):
    branch_id: UUID
    category_id: UUID
    description: str = Field(min_length=3, max_length=500)
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    payment_method: PaymentMethod = PaymentMethod.CASH
    reference_number: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=500)


class ExpenseUpdate(BaseSchema):
    category_id: UUID | None = None
    description: str | None = Field(default=None, min_length=3, max_length=500)
    amount: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    payment_method: PaymentMethod | None = None
    reference_number: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=500)


class ExpenseDecision(BaseSchema):
    notes: str | None = Field(default=None, max_length=500)


class ExpenseResponse(ModelResponse):
    branch_id: UUID
    category_id: UUID
    submitted_by_id: UUID
    approved_by_id: UUID | None
    description: str
    amount: Decimal
    payment_method: PaymentMethod
    status: str
    reference_number: str | None
    notes: str | None
