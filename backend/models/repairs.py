from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Enum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import BaseModel
from backend.models.enums import RepairStatus, enum_values


class RepairTicket(BaseModel):
    __tablename__ = "repair_tickets"

    ticket_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    branch_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False, index=True
    )
    customer_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("customers.id"), nullable=False
    )
    technician_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    serialized_unit_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("serialized_units.id"), nullable=True
    )
    status: Mapped[RepairStatus] = mapped_column(
        Enum(
            RepairStatus,
            values_callable=enum_values,
            native_enum=False,
            name="repair_status",
        ),
        default=RepairStatus.BOOKED,
        nullable=False,
    )
    device_type: Mapped[str] = mapped_column(String(50), nullable=False)
    device_brand: Mapped[str] = mapped_column(String(100), nullable=False)
    device_model: Mapped[str] = mapped_column(String(150), nullable=False)
    serial_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    imei: Mapped[str | None] = mapped_column(String(20), nullable=True)
    reported_issue: Mapped[str] = mapped_column(Text, nullable=False)
    diagnosis: Mapped[str | None] = mapped_column(Text, nullable=True)
    intake_condition: Mapped[str | None] = mapped_column(Text, nullable=True)
    intake_images: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    accessories_received: Mapped[list] = mapped_column(
        JSONB, default=list, nullable=False
    )
    labor_estimate: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), default=Decimal("0.00"), nullable=False
    )
    parts_estimate: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), default=Decimal("0.00"), nullable=False
    )
    approved_at: Mapped[datetime | None] = mapped_column(nullable=True)
    booked_for: Mapped[datetime | None] = mapped_column(nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(nullable=True)
    ready_at: Mapped[datetime | None] = mapped_column(nullable=True)
    collected_at: Mapped[datetime | None] = mapped_column(nullable=True)


class RepairPart(BaseModel):
    __tablename__ = "repair_parts"

    repair_ticket_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("repair_tickets.id", ondelete="CASCADE"),
        nullable=False,
    )
    variant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("product_variants.id"), nullable=False
    )
    serialized_unit_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("serialized_units.id"), nullable=True
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)


class RepairStatusHistory(BaseModel):
    __tablename__ = "repair_status_history"

    repair_ticket_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("repair_tickets.id", ondelete="CASCADE"),
        nullable=False,
    )
    from_status: Mapped[RepairStatus | None] = mapped_column(
        Enum(
            RepairStatus,
            values_callable=enum_values,
            native_enum=False,
            name="repair_history_from_status",
        ),
        nullable=True,
    )
    to_status: Mapped[RepairStatus] = mapped_column(
        Enum(
            RepairStatus,
            values_callable=enum_values,
            native_enum=False,
            name="repair_history_to_status",
        ),
        nullable=False,
    )
    changed_by_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
