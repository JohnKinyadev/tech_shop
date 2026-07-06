from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from backend.schemas.base_schemas import BaseSchema


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=150)
    password: str = Field(..., min_length=8)


class TokenRefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=10)


class PasswordChangeRequest(BaseSchema):
    current_password: str = Field(..., min_length=8, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


class TokenPairResponse(BaseSchema):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class CurrentUserResponse(BaseSchema):
    id: UUID
    full_name: str
    username: str
    email: str
    branch_id: UUID | None
    role_code: str
    role_name: str
    permissions: list[str]
    must_change_password: bool


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirmRequest(BaseModel):
    token: str = Field(..., min_length=10)
    new_password: str = Field(..., min_length=8)
