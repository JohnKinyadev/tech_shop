from uuid import UUID

from pydantic import Field

from backend.models.enums import ApprovalStatus
from backend.schemas.base_schemas import BaseSchema, ModelResponse


class ApprovalRequestCreate(BaseSchema):
    branch_id: UUID
    action: str = Field(min_length=3, max_length=100)
    resource_type: str = Field(min_length=2, max_length=50)
    resource_id: UUID
    reason: str = Field(min_length=3, max_length=500)
    requested_changes: dict | None = None


class ApprovalDecision(BaseSchema):
    approved: bool
    decision_note: str | None = Field(default=None, max_length=500)


class ApprovalRequestResponse(ModelResponse):
    branch_id: UUID
    action: str
    resource_type: str
    resource_id: UUID
    requested_by_id: UUID
    reviewed_by_id: UUID | None
    status: ApprovalStatus
    reason: str
    decision_note: str | None
    requested_changes: dict | None
