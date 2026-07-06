from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import BaseModel
from backend.models.enums import StockMovementType, TransferStatus, enum_values


class StockMovement(BaseModel):
    __tablename__ = "stock_movements"
    __table_args__ = (
        CheckConstraint("quantity_delta <> 0", name="movement_quantity_nonzero"),
    )

    branch_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False, index=True
    )
    variant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("product_variants.id"), nullable=False
    )
    serialized_unit_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("serialized_units.id"), nullable=True
    )
    movement_type: Mapped[StockMovementType] = mapped_column(
        Enum(
            StockMovementType,
            values_callable=enum_values,
            native_enum=False,
            name="stock_movement_type",
        ),
        nullable=False,
    )
    quantity_delta: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    reference_type: Mapped[str] = mapped_column(String(50), nullable=False)
    reference_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(
        String(150), unique=True, nullable=False
    )
    performed_by_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)


class StockTransfer(BaseModel):
    __tablename__ = "stock_transfers"

    transfer_number: Mapped[str] = mapped_column(
        String(50), unique=True, nullable=False
    )
    source_branch_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False
    )
    destination_branch_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False
    )
    status: Mapped[TransferStatus] = mapped_column(
        Enum(
            TransferStatus,
            values_callable=enum_values,
            native_enum=False,
            name="transfer_status",
        ),
        default=TransferStatus.DRAFT,
        nullable=False,
    )
    requested_by_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    approved_by_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    dispatched_at: Mapped[datetime | None] = mapped_column(nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)


class StockTransferItem(BaseModel):
    __tablename__ = "stock_transfer_items"

    transfer_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("stock_transfers.id", ondelete="CASCADE"),
        nullable=False,
    )
    variant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("product_variants.id"), nullable=False
    )
    serialized_unit_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("serialized_units.id"), nullable=True
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
