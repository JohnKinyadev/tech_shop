from datetime import datetime
from uuid import UUID as PyUUID

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import BaseModel


class Warranty(BaseModel):
    __tablename__ = "warranties"

    sale_item_id: Mapped[PyUUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sale_items.id"), nullable=False
    )
    serialized_unit_id: Mapped[PyUUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("serialized_units.id"), nullable=True
    )
    customer_id: Mapped[PyUUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customers.id"), nullable=True
    )
    start_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    end_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="active", nullable=False)
