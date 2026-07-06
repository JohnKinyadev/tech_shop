from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Enum, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import BaseModel
from backend.models.enums import (
    FulfillmentStatus,
    SaleChannel,
    SaleStatus,
    TillSessionStatus,
    enum_values,
)


class Till(BaseModel):
    __tablename__ = "tills"

    branch_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)


class TillSession(BaseModel):
    __tablename__ = "till_sessions"

    till_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tills.id"), nullable=False
    )
    cashier_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    status: Mapped[TillSessionStatus] = mapped_column(
        Enum(
            TillSessionStatus,
            values_callable=enum_values,
            native_enum=False,
            name="till_session_status",
        ),
        default=TillSessionStatus.OPEN,
        nullable=False,
    )
    opened_at: Mapped[datetime] = mapped_column(nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    opening_float: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), default=Decimal("0.00"), nullable=False
    )
    expected_cash: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    closing_cash: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)


class Sale(BaseModel):
    __tablename__ = "sales"

    branch_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False, index=True
    )
    customer_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("customers.id"), nullable=True
    )
    cashier_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    till_session_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("till_sessions.id"), nullable=True
    )
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    channel: Mapped[SaleChannel] = mapped_column(
        Enum(
            SaleChannel,
            values_callable=enum_values,
            native_enum=False,
            name="sale_channel",
        ),
        nullable=False,
    )
    status: Mapped[SaleStatus] = mapped_column(
        Enum(
            SaleStatus,
            values_callable=enum_values,
            native_enum=False,
            name="sale_status",
        ),
        default=SaleStatus.DRAFT,
        nullable=False,
    )
    fulfillment_status: Mapped[FulfillmentStatus] = mapped_column(
        Enum(
            FulfillmentStatus,
            values_callable=enum_values,
            native_enum=False,
            name="fulfillment_status",
        ),
        default=FulfillmentStatus.NOT_REQUIRED,
        nullable=False,
    )
    subtotal: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), default=Decimal("0.00"), nullable=False
    )
    tax_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), default=Decimal("0.00"), nullable=False
    )
    discount_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), default=Decimal("0.00"), nullable=False
    )
    total_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), default=Decimal("0.00"), nullable=False
    )
    paid_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), default=Decimal("0.00"), nullable=False
    )
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class SaleItem(BaseModel):
    __tablename__ = "sale_items"

    sale_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sales.id", ondelete="CASCADE"),
        nullable=False,
    )
    variant_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("product_variants.id"), nullable=False
    )
    serialized_unit_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("serialized_units.id"), nullable=True
    )
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), default=Decimal("0.00"), nullable=False
    )
    tax_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), default=Decimal("0.00"), nullable=False
    )
    line_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)


class SaleReturn(BaseModel):
    __tablename__ = "sale_returns"

    sale_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("sales.id"), nullable=False
    )
    return_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    requested_by_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    approved_by_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    refund_amount: Mapped[Decimal] = mapped_column(
        Numeric(14, 2), default=Decimal("0.00"), nullable=False
    )


class SaleReturnItem(BaseModel):
    __tablename__ = "sale_return_items"

    return_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("sale_returns.id", ondelete="CASCADE"),
        nullable=False,
    )
    sale_item_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("sale_items.id"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    condition: Mapped[str] = mapped_column(String(30), nullable=False)
    restock: Mapped[bool] = mapped_column(default=False, nullable=False)
