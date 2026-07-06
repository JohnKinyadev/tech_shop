from uuid import UUID

from pydantic import EmailStr, Field, model_validator

from backend.schemas.base_schemas import BaseSchema, ModelResponse


class PermissionResponse(ModelResponse):
    code: str
    resource: str
    action: str
    description: str | None


class RolePermissionResponse(BaseSchema):
    role_id: UUID
    permission_id: UUID


class RoleCreate(BaseSchema):
    code: str = Field(min_length=2, max_length=50)
    name: str = Field(min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    permission_ids: list[UUID] = Field(default_factory=list)


class RoleUpdate(BaseSchema):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    permission_ids: list[UUID] | None = None
    is_active: bool | None = None


class RoleResponse(ModelResponse):
    code: str
    name: str
    description: str | None
    is_system: bool
    is_active: bool
    permissions: list[PermissionResponse] = Field(default_factory=list)


class AssignableRoleResponse(BaseSchema):
    id: UUID
    code: str
    name: str
    description: str | None


class UserCreate(BaseSchema):
    full_name: str = Field(min_length=2, max_length=150)
    username: str = Field(min_length=3, max_length=100)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=20)
    password: str = Field(min_length=8, max_length=128)
    role_id: UUID
    branch_id: UUID | None = None


class UserUpdate(BaseSchema):
    full_name: str | None = Field(default=None, min_length=2, max_length=150)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=20)
    role_id: UUID | None = None
    branch_id: UUID | None = None
    is_active: bool | None = None
    is_verified: bool | None = None

    @model_validator(mode="after")
    def reject_null_required_fields(self) -> "UserUpdate":
        required = {"full_name", "email", "role_id", "is_active", "is_verified"}
        for field in required & self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class UserResponse(ModelResponse):
    full_name: str
    username: str
    email: EmailStr
    phone: str | None
    branch_id: UUID | None
    role_id: UUID
    is_active: bool
    is_verified: bool
    must_change_password: bool
