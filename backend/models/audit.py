from uuid import UUID

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import BaseModel


class AuditLog(BaseModel):
    __tablename__ = "audit_logs"

    actor_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True, index=True)
    branch_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    before: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
