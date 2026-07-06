from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Enum, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import BaseModel
from backend.models.enums import (
    PaymentDirection,
    PaymentMethod,
    PaymentStatus,
    enum_values,
)


class Payment(BaseModel):
    __tablename__ = "payments"

    branch_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False, index=True
    )
    sale_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("sales.id"), nullable=True
    )
    repair_ticket_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("repair_tickets.id"), nullable=True
    )
    purchase_order_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("purchase_orders.id"), nullable=True
    )
    direction: Mapped[PaymentDirection] = mapped_column(
        Enum(
            PaymentDirection,
            values_callable=enum_values,
            native_enum=False,
            name="payment_direction",
        ),
        nullable=False,
    )
    method: Mapped[PaymentMethod] = mapped_column(
        Enum(
            PaymentMethod,
            values_callable=enum_values,
            native_enum=False,
            name="payment_method",
        ),
        nullable=False,
    )
    status: Mapped[PaymentStatus] = mapped_column(
        Enum(
            PaymentStatus,
            values_callable=enum_values,
            native_enum=False,
            name="payment_status",
        ),
        default=PaymentStatus.PENDING,
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="KES", nullable=False)
    provider_reference: Mapped[str | None] = mapped_column(
        String(150), unique=True, nullable=True
    )
    idempotency_key: Mapped[str] = mapped_column(
        String(150), unique=True, nullable=False
    )
    paid_at: Mapped[datetime | None] = mapped_column(nullable=True)
    provider_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
