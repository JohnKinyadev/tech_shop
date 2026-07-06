from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from backend.models.audit import AuditLog


def record_audit(
    db: Session,
    *,
    actor_id: UUID,
    branch_id: UUID | None,
    action: str,
    resource_type: str,
    resource_id: UUID | None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_id=actor_id,
            branch_id=branch_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            before=before,
            after=after,
        )
    )
