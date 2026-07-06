from uuid import UUID

from backend.schemas.base_schemas import ModelResponse


class AuditLogResponse(ModelResponse):
    actor_id: UUID | None
    branch_id: UUID | None
    action: str
    resource_type: str
    resource_id: UUID | None
    before: dict | None
    after: dict | None
    ip_address: str | None
    user_agent: str | None
