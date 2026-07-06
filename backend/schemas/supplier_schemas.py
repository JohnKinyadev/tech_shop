from pydantic import EmailStr, Field, model_validator

from backend.schemas.base_schemas import BaseSchema, ModelResponse


class SupplierCreate(BaseSchema):
    name: str = Field(min_length=2, max_length=200)
    contact_person: str | None = Field(default=None, max_length=150)
    phone: str | None = Field(default=None, max_length=20)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=255)
    tax_number: str | None = Field(default=None, max_length=100)
    payment_terms_days: int = Field(default=0, ge=0, le=365)


class SupplierUpdate(BaseSchema):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    contact_person: str | None = Field(default=None, max_length=150)
    phone: str | None = Field(default=None, max_length=20)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=255)
    tax_number: str | None = Field(default=None, max_length=100)
    payment_terms_days: int | None = Field(default=None, ge=0, le=365)
    is_active: bool | None = None

    @model_validator(mode="after")
    def reject_null_required_fields(self) -> "SupplierUpdate":
        for field in {
            "name",
            "payment_terms_days",
            "is_active",
        } & self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class SupplierResponse(ModelResponse):
    name: str
    contact_person: str | None
    phone: str | None
    email: EmailStr | None
    address: str | None
    tax_number: str | None
    payment_terms_days: int
    is_active: bool
