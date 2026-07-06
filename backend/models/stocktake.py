from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import BaseModel
from backend.models.enums import StockCountStatus, enum_values


class StockCount(BaseModel):
    __tablename__ = "stock_counts"

    branch_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False, index=True
    )
    count_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    status: Mapped[StockCountStatus] = mapped_column(
        Enum(
            StockCountStatus,
            values_callable=enum_values,
            native_enum=False,
            name="stock_count_status",
        ),
        default=StockCountStatus.DRAFT,
        nullable=False,
    )
    created_by_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    approved_by_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)


class StockCountItem(BaseModel):
    __tablename__ = "stock_count_items"
    __table_args__ = (
        CheckConstraint("expected_quantity >= 0", name="count_expected_nonnegative"),
        CheckConstraint(
            "counted_quantity IS NULL OR counted_quantity >= 0",
            name="counted_quantity_nonnegative",
        ),
    )

    stock_count_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("stock_counts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    variant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("product_variants.id"), nullable=False
    )
    expected_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    counted_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    variance: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
