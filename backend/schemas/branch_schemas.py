from typing import Annotated

from pydantic import EmailStr, Field, model_validator

from backend.models.enums import BranchStatus
from backend.schemas.base_schemas import BaseSchema, ModelResponse

Name = Annotated[str, Field(min_length=2, max_length=150)]


class BranchCreate(BaseSchema):
    name: Name
    code: str = Field(min_length=2, max_length=30)
    phone: str | None = Field(default=None, max_length=20)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=100)
    country: str = Field(default="Kenya", max_length=100)
    is_headquarters: bool = False


class BranchUpdate(BaseSchema):
    name: Name | None = None
    phone: str | None = Field(default=None, max_length=20)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=100)
    country: str | None = Field(default=None, max_length=100)
    status: BranchStatus | None = None

    @model_validator(mode="after")
    def reject_null_required_fields(self) -> "BranchUpdate":
        for field in {"name", "country", "status"} & self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class BranchResponse(ModelResponse):
    name: str
    code: str
    phone: str | None
    email: str | None
    address: str | None
    city: str | None
    country: str
    is_headquarters: bool
    status: BranchStatus
