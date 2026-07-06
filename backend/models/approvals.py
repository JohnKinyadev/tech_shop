from uuid import UUID

from sqlalchemy import Enum, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import BaseModel
from backend.models.enums import ApprovalStatus, enum_values


class ApprovalRequest(BaseModel):
    __tablename__ = "approval_requests"

    branch_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False)
    resource_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    requested_by_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reviewed_by_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    status: Mapped[ApprovalStatus] = mapped_column(
        Enum(ApprovalStatus, values_callable=enum_values, native_enum=False, name="approval_status"),
        default=ApprovalStatus.PENDING,
        nullable=False,
    )
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    decision_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    requested_changes: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
