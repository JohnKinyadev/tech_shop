from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import BaseModel
from backend.models.enums import SerializedUnitStatus, enum_values


class StockBalance(BaseModel):
    __tablename__ = "stock_balances"
    __table_args__ = (
        UniqueConstraint("branch_id", "variant_id", name="stock_balance_branch_variant"),
        CheckConstraint("quantity_on_hand >= 0", name="stock_on_hand_nonnegative"),
        CheckConstraint("reserved_quantity >= 0", name="stock_reserved_nonnegative"),
        CheckConstraint("reserved_quantity <= quantity_on_hand", name="stock_reserved_within_on_hand"),
    )

    branch_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False, index=True)
    variant_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("product_variants.id"), nullable=False)
    quantity_on_hand: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reserved_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reorder_level: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    average_unit_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    last_stock_take_at: Mapped[datetime | None] = mapped_column(nullable=True)


class SerializedUnit(BaseModel):
    __tablename__ = "serialized_units"

    variant_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("product_variants.id"), nullable=False)
    branch_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False, index=True)
    serial_number: Mapped[str | None] = mapped_column(String(120), unique=True, nullable=True)
    imei: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    status: Mapped[SerializedUnitStatus] = mapped_column(
        Enum(SerializedUnitStatus, values_callable=enum_values, native_enum=False, name="serialized_unit_status"),
        default=SerializedUnitStatus.AVAILABLE,
        nullable=False,
    )
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    condition: Mapped[str] = mapped_column(String(30), default="new", nullable=False)
    received_at: Mapped[datetime] = mapped_column(nullable=False)


class StockReservation(BaseModel):
    __tablename__ = "stock_reservations"

    branch_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False)
    variant_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("product_variants.id"), nullable=False)
    serialized_unit_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("serialized_units.id"), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    reference_type: Mapped[str] = mapped_column(String(50), nullable=False)
    reference_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False, index=True)
