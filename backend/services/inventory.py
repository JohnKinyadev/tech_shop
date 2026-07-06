from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from backend.models.enums import SerializedUnitStatus, StockMovementType, TrackingType
from backend.models.inventory import SerializedUnit, StockBalance
from backend.models.inventory_movement import StockMovement
from backend.models.products import ProductVariant
from backend.models.sales import SaleItem
from backend.services.exceptions import ConflictError, NotFoundError, ValidationError

MONEY_QUANTUM = Decimal("0.01")


def weighted_average_cost(
    current_quantity: int,
    current_average: Decimal,
    incoming_quantity: int,
    incoming_cost: Decimal,
) -> Decimal:
    new_quantity = current_quantity + incoming_quantity
    if new_quantity <= 0:
        raise ValidationError("stock quantity must remain positive")
    total_value = (current_average * current_quantity) + (
        incoming_cost * incoming_quantity
    )
    return (total_value / new_quantity).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def validate_receipt_identifiers(
    tracking_type: TrackingType,
    quantity: int,
    serial_numbers: list[str],
    imeis: list[str],
) -> tuple[list[str], list[str]]:
    serials = [value.strip() for value in serial_numbers if value.strip()]
    normalized_imeis = [value.strip() for value in imeis if value.strip()]
    if quantity <= 0:
        raise ValidationError("received quantity must be positive")
    if len({value.lower() for value in serials}) != len(serials):
        raise ConflictError("serial numbers are duplicated within the receipt")
    if len(set(normalized_imeis)) != len(normalized_imeis):
        raise ConflictError("IMEIs are duplicated within the receipt")
    if any(len(value) > 120 for value in serials):
        raise ValidationError("serial numbers cannot exceed 120 characters")
    if any(len(value) != 15 or not value.isdigit() for value in normalized_imeis):
        raise ValidationError("each IMEI must contain exactly 15 digits")

    if tracking_type == TrackingType.BULK:
        if serials or normalized_imeis:
            raise ValidationError(
                "bulk variants cannot include serial numbers or IMEIs"
            )
    elif tracking_type == TrackingType.SERIAL:
        if len(serials) != quantity:
            raise ValidationError(
                "serialized variants require one serial number per unit"
            )
        if normalized_imeis and len(normalized_imeis) != quantity:
            raise ValidationError(
                "IMEIs must be omitted or supplied once per serialized unit"
            )
    elif tracking_type == TrackingType.IMEI:
        if len(normalized_imeis) != quantity:
            raise ValidationError("IMEI variants require one IMEI per unit")
        if serials and len(serials) != quantity:
            raise ValidationError(
                "serial numbers must be omitted or supplied once per IMEI unit"
            )
    return serials, normalized_imeis


def _ensure_new_identifiers(
    db: Session, serial_numbers: list[str], imeis: list[str]
) -> None:
    checks = []
    if serial_numbers:
        checks.append(
            func.lower(SerializedUnit.serial_number).in_(
                [value.lower() for value in serial_numbers]
            )
        )
    if imeis:
        checks.append(SerializedUnit.imei.in_(imeis))
    if checks and db.scalar(select(SerializedUnit.id).where(or_(*checks)).limit(1)):
        raise ConflictError("a serial number or IMEI already exists")


def receive_stock(
    db: Session,
    *,
    branch_id: UUID,
    variant: ProductVariant,
    quantity: int,
    unit_cost: Decimal,
    receipt_id: UUID,
    performed_by_id: UUID,
    serial_numbers: list[str],
    imeis: list[str],
) -> None:
    serials, normalized_imeis = validate_receipt_identifiers(
        variant.tracking_type, quantity, serial_numbers, imeis
    )
    _ensure_new_identifiers(db, serials, normalized_imeis)

    balance = db.scalar(
        select(StockBalance)
        .where(
            StockBalance.branch_id == branch_id,
            StockBalance.variant_id == variant.id,
        )
        .with_for_update()
    )
    if balance is None:
        balance = StockBalance(
            branch_id=branch_id,
            variant_id=variant.id,
            quantity_on_hand=0,
            reserved_quantity=0,
            reorder_level=0,
            average_unit_cost=Decimal("0.00"),
        )
        db.add(balance)
    balance.average_unit_cost = weighted_average_cost(
        balance.quantity_on_hand,
        balance.average_unit_cost,
        quantity,
        unit_cost,
    )
    balance.quantity_on_hand += quantity

    now = datetime.now(timezone.utc)
    if variant.tracking_type == TrackingType.BULK:
        db.add(
            StockMovement(
                branch_id=branch_id,
                variant_id=variant.id,
                movement_type=StockMovementType.PURCHASE_RECEIPT,
                quantity_delta=quantity,
                unit_cost=unit_cost,
                reference_type="goods_receipt",
                reference_id=receipt_id,
                idempotency_key=f"receipt:{receipt_id}:variant:{variant.id}",
                performed_by_id=performed_by_id,
            )
        )
        return

    units: list[SerializedUnit] = []
    for index in range(quantity):
        unit = SerializedUnit(
            variant_id=variant.id,
            branch_id=branch_id,
            serial_number=serials[index] if serials else None,
            imei=normalized_imeis[index] if normalized_imeis else None,
            unit_cost=unit_cost,
            condition="new",
            received_at=now,
        )
        db.add(unit)
        units.append(unit)
    db.flush()
    for unit in units:
        db.add(
            StockMovement(
                branch_id=branch_id,
                variant_id=variant.id,
                serialized_unit_id=unit.id,
                movement_type=StockMovementType.PURCHASE_RECEIPT,
                quantity_delta=1,
                unit_cost=unit_cost,
                reference_type="goods_receipt",
                reference_id=receipt_id,
                idempotency_key=f"receipt:{receipt_id}:unit:{unit.id}",
                performed_by_id=performed_by_id,
            )
        )


def apply_stock_adjustment(
    db: Session,
    *,
    branch_id: UUID,
    variant: ProductVariant,
    quantity_delta: int,
    performed_by_id: UUID,
    reference_type: str,
    reference_id: UUID,
    reason: str,
    serialized_unit_id: UUID | None = None,
) -> StockMovement:
    if quantity_delta == 0:
        raise ValidationError("stock adjustment cannot be zero")
    balance = db.scalar(
        select(StockBalance)
        .where(
            StockBalance.branch_id == branch_id,
            StockBalance.variant_id == variant.id,
        )
        .with_for_update()
    )
    if balance is None:
        if quantity_delta < 0:
            raise ConflictError("stock balance does not exist")
        balance = StockBalance(
            branch_id=branch_id,
            variant_id=variant.id,
            quantity_on_hand=0,
            reserved_quantity=0,
            reorder_level=0,
            average_unit_cost=variant.cost_price,
        )
        db.add(balance)

    available = balance.quantity_on_hand - balance.reserved_quantity
    if quantity_delta < 0 and available < abs(quantity_delta):
        raise ConflictError("adjustment exceeds available stock")

    unit: SerializedUnit | None = None
    if variant.tracking_type == TrackingType.BULK:
        if serialized_unit_id is not None:
            raise ValidationError("bulk adjustments cannot reference a serialized unit")
    else:
        if serialized_unit_id is None or abs(quantity_delta) != 1:
            raise ValidationError(
                "serialized adjustments require one unit and a quantity of 1 or -1"
            )
        unit = db.scalar(
            select(SerializedUnit)
            .where(
                SerializedUnit.id == serialized_unit_id,
                SerializedUnit.variant_id == variant.id,
                SerializedUnit.branch_id == branch_id,
            )
            .with_for_update()
        )
        if unit is None:
            raise NotFoundError("serialized unit not found")
        if quantity_delta < 0 and unit.status != SerializedUnitStatus.AVAILABLE:
            raise ConflictError("only available serialized units can be adjusted out")
        if quantity_delta > 0 and unit.status not in {
            SerializedUnitStatus.DAMAGED,
            SerializedUnitStatus.QUARANTINED,
            SerializedUnitStatus.RETURNED,
        }:
            raise ConflictError("serialized unit is not eligible to return to stock")
        unit.status = (
            SerializedUnitStatus.DAMAGED
            if quantity_delta < 0
            else SerializedUnitStatus.AVAILABLE
        )

    balance.quantity_on_hand += quantity_delta
    movement = StockMovement(
        branch_id=branch_id,
        variant_id=variant.id,
        serialized_unit_id=serialized_unit_id,
        movement_type=StockMovementType.ADJUSTMENT,
        quantity_delta=quantity_delta,
        unit_cost=unit.unit_cost if unit else balance.average_unit_cost,
        reference_type=reference_type,
        reference_id=reference_id,
        idempotency_key=f"{reference_type}:{reference_id}:adjustment:{variant.id}:{serialized_unit_id or 'bulk'}",
        performed_by_id=performed_by_id,
        note=reason,
    )
    db.add(movement)
    db.flush()
    return movement


def sell_stock(
    db: Session,
    *,
    branch_id: UUID,
    sale_id: UUID,
    items: list[SaleItem],
    performed_by_id: UUID,
) -> None:
    variant_ids = {item.variant_id for item in items}
    variants = {
        variant.id: variant
        for variant in db.scalars(
            select(ProductVariant).where(ProductVariant.id.in_(variant_ids))
        ).all()
    }
    for item in sorted(items, key=lambda value: (str(value.variant_id), str(value.id))):
        variant = variants.get(item.variant_id)
        if variant is None:
            raise NotFoundError("sale item variant no longer exists")
        balance = db.scalar(
            select(StockBalance)
            .where(
                StockBalance.branch_id == branch_id,
                StockBalance.variant_id == item.variant_id,
                StockBalance.is_deleted.is_(False),
            )
            .with_for_update()
        )
        available = (
            balance.quantity_on_hand - balance.reserved_quantity if balance else 0
        )
        if balance is None or available < item.quantity:
            raise ConflictError("sale quantity exceeds available stock")

        unit: SerializedUnit | None = None
        if variant.tracking_type == TrackingType.BULK:
            if item.serialized_unit_id is not None:
                raise ValidationError("bulk sale items cannot reference a unit")
        else:
            if item.serialized_unit_id is None or item.quantity != 1:
                raise ValidationError("serialized sale items require one specific unit")
            unit = db.scalar(
                select(SerializedUnit)
                .where(
                    SerializedUnit.id == item.serialized_unit_id,
                    SerializedUnit.variant_id == item.variant_id,
                    SerializedUnit.branch_id == branch_id,
                )
                .with_for_update()
            )
            if unit is None:
                raise NotFoundError("serialized sale unit was not found")
            if unit.status != SerializedUnitStatus.AVAILABLE:
                raise ConflictError("serialized sale unit is not available")
            unit.status = SerializedUnitStatus.SOLD

        balance.quantity_on_hand -= item.quantity
        db.add(
            StockMovement(
                branch_id=branch_id,
                variant_id=item.variant_id,
                serialized_unit_id=item.serialized_unit_id,
                movement_type=StockMovementType.SALE,
                quantity_delta=-item.quantity,
                unit_cost=item.unit_cost,
                reference_type="sale",
                reference_id=sale_id,
                idempotency_key=f"sale:{sale_id}:item:{item.id}",
                performed_by_id=performed_by_id,
            )
        )


def return_sale_stock(
    db: Session,
    *,
    branch_id: UUID,
    sale_item: SaleItem,
    quantity: int,
    performed_by_id: UUID,
    reference_type: str,
    reference_id: UUID,
    restock: bool,
    condition: str,
) -> None:
    if quantity <= 0 or quantity > sale_item.quantity:
        raise ValidationError("return quantity is invalid")
    variant = db.scalar(
        select(ProductVariant).where(ProductVariant.id == sale_item.variant_id)
    )
    if variant is None:
        raise NotFoundError("returned item variant no longer exists")

    unit: SerializedUnit | None = None
    if variant.tracking_type != TrackingType.BULK:
        if sale_item.serialized_unit_id is None or quantity != 1:
            raise ValidationError("serialized returns require one specific unit")
        unit = db.scalar(
            select(SerializedUnit)
            .where(SerializedUnit.id == sale_item.serialized_unit_id)
            .with_for_update()
        )
        if unit is None:
            raise NotFoundError("returned serialized unit was not found")
        if unit.status != SerializedUnitStatus.SOLD:
            raise ConflictError("serialized unit is not in a sold state")
        if reference_type != "sale_void":
            unit.condition = condition.strip().lower()
        unit.status = (
            SerializedUnitStatus.AVAILABLE if restock else SerializedUnitStatus.RETURNED
        )

    if not restock:
        return

    balance = db.scalar(
        select(StockBalance)
        .where(
            StockBalance.branch_id == branch_id,
            StockBalance.variant_id == sale_item.variant_id,
        )
        .with_for_update()
    )
    if balance is None:
        balance = StockBalance(
            branch_id=branch_id,
            variant_id=sale_item.variant_id,
            quantity_on_hand=0,
            reserved_quantity=0,
            reorder_level=0,
            average_unit_cost=Decimal("0.00"),
        )
        db.add(balance)
    balance.average_unit_cost = weighted_average_cost(
        balance.quantity_on_hand,
        balance.average_unit_cost,
        quantity,
        sale_item.unit_cost,
    )
    balance.quantity_on_hand += quantity
    db.add(
        StockMovement(
            branch_id=branch_id,
            variant_id=sale_item.variant_id,
            serialized_unit_id=sale_item.serialized_unit_id,
            movement_type=StockMovementType.RETURN,
            quantity_delta=quantity,
            unit_cost=sale_item.unit_cost,
            reference_type=reference_type,
            reference_id=reference_id,
            idempotency_key=(f"{reference_type}:{reference_id}:item:{sale_item.id}"),
            performed_by_id=performed_by_id,
            note=condition,
        )
    )
