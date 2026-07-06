from decimal import Decimal
from uuid import UUID

from pydantic import EmailStr, Field

from backend.schemas.base_schemas import BaseSchema, ModelResponse


class CustomerCreate(BaseSchema):
    full_name: str = Field(min_length=2, max_length=150)
    phone: str = Field(min_length=7, max_length=20)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=255)
    home_branch_id: UUID | None = None


class CustomerUpdate(BaseSchema):
    full_name: str | None = Field(default=None, min_length=2, max_length=150)
    phone: str | None = Field(default=None, min_length=7, max_length=20)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=255)
    home_branch_id: UUID | None = None
    is_active: bool | None = None


class CustomerResponse(ModelResponse):
    full_name: str
    phone: str
    email: EmailStr | None
    address: str | None
    loyalty_points: int
    credit_limit: Decimal
    home_branch_id: UUID | None
    is_active: bool
