from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from backend.core.permissions import ADMIN, BRANCH_MANAGER
from backend.models.branch import Branch
from backend.models.enums import (
    BranchStatus,
    SerializedUnitStatus,
    StockMovementType,
    TrackingType,
    TransferStatus,
)
from backend.models.inventory import SerializedUnit, StockBalance
from backend.models.inventory_movement import (
    StockMovement,
    StockTransfer,
    StockTransferItem,
)
from backend.models.products import ProductVariant
from backend.schemas.inventory_schemas import (
    StockTransferCreate,
    StockTransferItemResponse,
    StockTransferResponse,
)
from backend.services.audit import record_audit
from backend.services.auth import AuthPrincipal
from backend.services.authorization import (
    AuthorizationError,
    enforce_branch_scope,
    enforce_permission,
)
from backend.services.exceptions import ConflictError, NotFoundError, ValidationError
from backend.services.inventory import weighted_average_cost


def _transfer_number() -> str:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"TR-{today}-{uuid4().hex[:8].upper()}"


def _get_transfer(
    db: Session, transfer_id: UUID, *, lock: bool = False
) -> StockTransfer:
    statement = select(StockTransfer).where(
        StockTransfer.id == transfer_id,
        StockTransfer.is_deleted.is_(False),
    )
    if lock:
        statement = statement.with_for_update()
    transfer = db.scalar(statement)
    if transfer is None:
        raise NotFoundError("stock transfer not found")
    return transfer


def _items(
    db: Session, transfer_id: UUID, *, lock: bool = False
) -> list[StockTransferItem]:
    statement = (
        select(StockTransferItem)
        .where(
            StockTransferItem.transfer_id == transfer_id,
            StockTransferItem.is_deleted.is_(False),
        )
        .order_by(StockTransferItem.created_at)
    )
    if lock:
        statement = statement.with_for_update()
    return list(db.scalars(statement).all())


def _response(db: Session, transfer: StockTransfer) -> StockTransferResponse:
    return StockTransferResponse.model_validate(transfer).model_copy(
        update={
            "items": [
                StockTransferItemResponse.model_validate(item)
                for item in _items(db, transfer.id)
            ]
        }
    )


def list_transfers(
    db: Session, principal: AuthPrincipal, branch_id: UUID
) -> list[StockTransferResponse]:
    enforce_permission(principal, "inventory.transfer")
    enforce_branch_scope(principal, branch_id)
    transfers = db.scalars(
        select(StockTransfer)
        .where(
            or_(
                StockTransfer.source_branch_id == branch_id,
                StockTransfer.destination_branch_id == branch_id,
            ),
            StockTransfer.is_deleted.is_(False),
        )
        .order_by(StockTransfer.created_at.desc())
    ).all()
    return [_response(db, transfer) for transfer in transfers]


def create_transfer(
    db: Session, principal: AuthPrincipal, payload: StockTransferCreate
) -> StockTransferResponse:
    enforce_permission(principal, "inventory.transfer")
    enforce_branch_scope(principal, payload.source_branch_id)
    branch_ids = set(
        db.scalars(
            select(Branch.id).where(
                Branch.id.in_(
                    [payload.source_branch_id, payload.destination_branch_id]
                ),
                Branch.status == BranchStatus.ACTIVE,
                Branch.is_deleted.is_(False),
            )
        ).all()
    )
    if branch_ids != {payload.source_branch_id, payload.destination_branch_id}:
        raise NotFoundError("source or destination branch is unavailable")

    variant_ids = {item.variant_id for item in payload.items}
    variants = {
        variant.id: variant
        for variant in db.scalars(
            select(ProductVariant).where(
                ProductVariant.id.in_(variant_ids),
                ProductVariant.is_active.is_(True),
                ProductVariant.is_deleted.is_(False),
            )
        ).all()
    }
    if set(variants) != variant_ids:
        raise NotFoundError("one or more product variants were not found")

    balances = {
        balance.variant_id: balance
        for balance in db.scalars(
            select(StockBalance).where(
                StockBalance.branch_id == payload.source_branch_id,
                StockBalance.variant_id.in_(variant_ids),
                StockBalance.is_deleted.is_(False),
            )
        ).all()
    }
    seen: set[tuple[UUID, UUID | None]] = set()
    bulk_variants: set[UUID] = set()
    serialized_unit_ids = {
        item.serialized_unit_id
        for item in payload.items
        if item.serialized_unit_id is not None
    }
    units = {
        unit.id: unit
        for unit in db.scalars(
            select(SerializedUnit).where(
                SerializedUnit.id.in_(serialized_unit_ids),
                SerializedUnit.is_deleted.is_(False),
            )
        ).all()
    }
    requested_by_variant: dict[UUID, int] = {}
    for item in payload.items:
        variant = variants[item.variant_id]
        key = (item.variant_id, item.serialized_unit_id)
        if key in seen:
            raise ConflictError("duplicate transfer item")
        seen.add(key)
        requested_by_variant[item.variant_id] = (
            requested_by_variant.get(item.variant_id, 0) + item.quantity
        )
        balance = balances.get(item.variant_id)
        available = (
            balance.quantity_on_hand - balance.reserved_quantity if balance else 0
        )
        if variant.tracking_type == TrackingType.BULK:
            if item.serialized_unit_id is not None:
                raise ValidationError("bulk transfer items cannot reference a unit")
            if item.variant_id in bulk_variants:
                raise ConflictError("bulk variants can only appear once per transfer")
            bulk_variants.add(item.variant_id)
            if available < item.quantity:
                raise ConflictError("transfer quantity exceeds available stock")
            continue
        if item.serialized_unit_id is None or item.quantity != 1:
            raise ValidationError("serialized transfer items require one specific unit")
        unit = units.get(item.serialized_unit_id)
        if (
            unit is None
            or unit.variant_id != item.variant_id
            or unit.branch_id != payload.source_branch_id
        ):
            raise NotFoundError("serialized unit was not found at the source branch")
        if unit.status != SerializedUnitStatus.AVAILABLE:
            raise ConflictError("serialized unit is not available for transfer")

    for variant_id, requested_quantity in requested_by_variant.items():
        balance = balances.get(variant_id)
        available = (
            balance.quantity_on_hand - balance.reserved_quantity if balance else 0
        )
        if requested_quantity > available:
            raise ConflictError("transfer quantity exceeds available stock")

    transfer = StockTransfer(
        transfer_number=_transfer_number(),
        source_branch_id=payload.source_branch_id,
        destination_branch_id=payload.destination_branch_id,
        status=TransferStatus.DRAFT,
        requested_by_id=principal.user_id,
        notes=payload.notes,
    )
    db.add(transfer)
    db.flush()
    for item in payload.items:
        db.add(
            StockTransferItem(
                transfer_id=transfer.id,
                variant_id=item.variant_id,
                serialized_unit_id=item.serialized_unit_id,
                quantity=item.quantity,
            )
        )
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=transfer.source_branch_id,
        action="inventory.transfer_created",
        resource_type="stock_transfer",
        resource_id=transfer.id,
        after={"status": transfer.status.value},
    )
    return _response(db, transfer)


def approve_transfer(
    db: Session, principal: AuthPrincipal, transfer_id: UUID
) -> StockTransferResponse:
    if principal.role_code not in {ADMIN, BRANCH_MANAGER}:
        raise AuthorizationError(
            "only an Admin or Branch Manager can approve transfers"
        )
    transfer = _get_transfer(db, transfer_id, lock=True)
    enforce_branch_scope(principal, transfer.source_branch_id)
    if transfer.status != TransferStatus.DRAFT:
        raise ConflictError("only draft transfers can be approved")
    transfer.status = TransferStatus.APPROVED
    transfer.approved_by_id = principal.user_id
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=transfer.source_branch_id,
        action="inventory.transfer_approved",
        resource_type="stock_transfer",
        resource_id=transfer.id,
        after={"status": transfer.status.value},
    )
    return _response(db, transfer)


def _locked_balance(
    db: Session, branch_id: UUID, variant_id: UUID
) -> StockBalance | None:
    return db.scalar(
        select(StockBalance)
        .where(
            StockBalance.branch_id == branch_id,
            StockBalance.variant_id == variant_id,
            StockBalance.is_deleted.is_(False),
        )
        .with_for_update()
    )


def dispatch_transfer(
    db: Session, principal: AuthPrincipal, transfer_id: UUID
) -> StockTransferResponse:
    enforce_permission(principal, "inventory.transfer")
    transfer = _get_transfer(db, transfer_id, lock=True)
    enforce_branch_scope(principal, transfer.source_branch_id)
    if transfer.status != TransferStatus.APPROVED:
        raise ConflictError("only approved transfers can be dispatched")
    items = _items(db, transfer.id, lock=True)
    variants = {
        variant.id: variant
        for variant in db.scalars(
            select(ProductVariant).where(
                ProductVariant.id.in_([item.variant_id for item in items])
            )
        ).all()
    }
    for item in items:
        variant = variants.get(item.variant_id)
        if variant is None:
            raise NotFoundError("product variant no longer exists")
        balance = _locked_balance(db, transfer.source_branch_id, item.variant_id)
        available = (
            balance.quantity_on_hand - balance.reserved_quantity if balance else 0
        )
        if balance is None or available < item.quantity:
            raise ConflictError("transfer quantity exceeds available stock")

        unit: SerializedUnit | None = None
        unit_cost = balance.average_unit_cost
        if variant.tracking_type != TrackingType.BULK:
            unit = db.scalar(
                select(SerializedUnit)
                .where(
                    SerializedUnit.id == item.serialized_unit_id,
                    SerializedUnit.variant_id == item.variant_id,
                    SerializedUnit.branch_id == transfer.source_branch_id,
                )
                .with_for_update()
            )
            if unit is None:
                raise NotFoundError("serialized transfer unit was not found")
            if unit.status != SerializedUnitStatus.AVAILABLE:
                raise ConflictError("serialized transfer unit is no longer available")
            unit.status = SerializedUnitStatus.IN_TRANSFER
            unit_cost = unit.unit_cost

        balance.quantity_on_hand -= item.quantity
        db.add(
            StockMovement(
                branch_id=transfer.source_branch_id,
                variant_id=item.variant_id,
                serialized_unit_id=item.serialized_unit_id,
                movement_type=StockMovementType.TRANSFER_OUT,
                quantity_delta=-item.quantity,
                unit_cost=unit_cost,
                reference_type="stock_transfer",
                reference_id=transfer.id,
                idempotency_key=(
                    f"transfer:{transfer.id}:out:{item.variant_id}:"
                    f"{item.serialized_unit_id or 'bulk'}"
                ),
                performed_by_id=principal.user_id,
                note=transfer.notes,
            )
        )
    transfer.status = TransferStatus.DISPATCHED
    transfer.dispatched_at = datetime.now(timezone.utc)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=transfer.source_branch_id,
        action="inventory.transfer_dispatched",
        resource_type="stock_transfer",
        resource_id=transfer.id,
        after={"status": transfer.status.value},
    )
    return _response(db, transfer)


def receive_transfer(
    db: Session, principal: AuthPrincipal, transfer_id: UUID
) -> StockTransferResponse:
    enforce_permission(principal, "inventory.transfer")
    transfer = _get_transfer(db, transfer_id, lock=True)
    enforce_branch_scope(principal, transfer.destination_branch_id)
    if transfer.status != TransferStatus.DISPATCHED:
        raise ConflictError("only dispatched transfers can be received")
    items = _items(db, transfer.id, lock=True)
    for item in items:
        outbound = db.scalar(
            select(StockMovement).where(
                StockMovement.reference_type == "stock_transfer",
                StockMovement.reference_id == transfer.id,
                StockMovement.movement_type == StockMovementType.TRANSFER_OUT,
                StockMovement.variant_id == item.variant_id,
                StockMovement.serialized_unit_id == item.serialized_unit_id,
            )
        )
        if outbound is None:
            raise ConflictError("transfer dispatch movement is missing")
        unit_cost = outbound.unit_cost or Decimal("0.00")
        balance = _locked_balance(db, transfer.destination_branch_id, item.variant_id)
        if balance is None:
            balance = StockBalance(
                branch_id=transfer.destination_branch_id,
                variant_id=item.variant_id,
                quantity_on_hand=0,
                reserved_quantity=0,
                reorder_level=0,
                average_unit_cost=Decimal("0.00"),
            )
            db.add(balance)
        balance.average_unit_cost = weighted_average_cost(
            balance.quantity_on_hand,
            balance.average_unit_cost,
            item.quantity,
            unit_cost,
        )
        balance.quantity_on_hand += item.quantity
        if item.serialized_unit_id is not None:
            unit = db.scalar(
                select(SerializedUnit)
                .where(SerializedUnit.id == item.serialized_unit_id)
                .with_for_update()
            )
            if unit is None or unit.status != SerializedUnitStatus.IN_TRANSFER:
                raise ConflictError("serialized unit is not awaiting transfer receipt")
            unit.branch_id = transfer.destination_branch_id
            unit.status = SerializedUnitStatus.AVAILABLE
        db.add(
            StockMovement(
                branch_id=transfer.destination_branch_id,
                variant_id=item.variant_id,
                serialized_unit_id=item.serialized_unit_id,
                movement_type=StockMovementType.TRANSFER_IN,
                quantity_delta=item.quantity,
                unit_cost=unit_cost,
                reference_type="stock_transfer",
                reference_id=transfer.id,
                idempotency_key=(
                    f"transfer:{transfer.id}:in:{item.variant_id}:"
                    f"{item.serialized_unit_id or 'bulk'}"
                ),
                performed_by_id=principal.user_id,
                note=transfer.notes,
            )
        )
    transfer.status = TransferStatus.RECEIVED
    transfer.received_at = datetime.now(timezone.utc)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=transfer.destination_branch_id,
        action="inventory.transfer_received",
        resource_type="stock_transfer",
        resource_id=transfer.id,
        after={"status": transfer.status.value},
    )
    return _response(db, transfer)


def cancel_transfer(
    db: Session, principal: AuthPrincipal, transfer_id: UUID
) -> StockTransferResponse:
    enforce_permission(principal, "inventory.transfer")
    transfer = _get_transfer(db, transfer_id, lock=True)
    enforce_branch_scope(principal, transfer.source_branch_id)
    if transfer.status not in {TransferStatus.DRAFT, TransferStatus.APPROVED}:
        raise ConflictError("this transfer can no longer be cancelled")
    transfer.status = TransferStatus.CANCELLED
    db.flush()
    return _response(db, transfer)
