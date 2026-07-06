from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.core.permissions import ADMIN, BRANCH_MANAGER
from backend.models.enums import StockCountStatus, TrackingType
from backend.models.inventory import StockBalance
from backend.models.products import ProductVariant
from backend.models.stocktake import StockCount, StockCountItem
from backend.schemas.stocktake_schemas import (
    StockCountCreate,
    StockCountItemResponse,
    StockCountItemUpdate,
    StockCountResponse,
)
from backend.services import inventory
from backend.services.audit import record_audit
from backend.services.auth import AuthPrincipal
from backend.services.authorization import (
    AuthorizationError,
    enforce_branch_scope,
    enforce_permission,
)
from backend.services.exceptions import ConflictError, NotFoundError, ValidationError


def _count_number() -> str:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"SC-{today}-{uuid4().hex[:8].upper()}"


def _get_count(
    db: Session, principal: AuthPrincipal, count_id: UUID, *, lock: bool = False
) -> StockCount:
    statement = select(StockCount).where(
        StockCount.id == count_id,
        StockCount.is_deleted.is_(False),
    )
    if lock:
        statement = statement.with_for_update()
    count = db.scalar(statement)
    if count is None:
        raise NotFoundError("stock count not found")
    enforce_branch_scope(principal, count.branch_id)
    return count


def _count_response(db: Session, count: StockCount) -> StockCountResponse:
    items = db.scalars(
        select(StockCountItem)
        .where(
            StockCountItem.stock_count_id == count.id,
            StockCountItem.is_deleted.is_(False),
        )
        .order_by(StockCountItem.created_at)
    ).all()
    return StockCountResponse.model_validate(count).model_copy(
        update={
            "items": [StockCountItemResponse.model_validate(item) for item in items]
        }
    )


def list_stock_counts(
    db: Session, principal: AuthPrincipal, branch_id: UUID
) -> list[StockCountResponse]:
    enforce_permission(principal, "inventory.adjust")
    enforce_branch_scope(principal, branch_id)
    counts = db.scalars(
        select(StockCount)
        .where(
            StockCount.branch_id == branch_id,
            StockCount.is_deleted.is_(False),
        )
        .order_by(StockCount.created_at.desc())
    ).all()
    return [_count_response(db, count) for count in counts]


def create_stock_count(
    db: Session, principal: AuthPrincipal, payload: StockCountCreate
) -> StockCountResponse:
    enforce_permission(principal, "inventory.adjust")
    enforce_branch_scope(principal, payload.branch_id)
    open_count = db.scalar(
        select(StockCount.id).where(
            StockCount.branch_id == payload.branch_id,
            StockCount.status.in_([StockCountStatus.DRAFT, StockCountStatus.SUBMITTED]),
            StockCount.is_deleted.is_(False),
        )
    )
    if open_count is not None:
        raise ConflictError("this branch already has an open stock count")

    balance_rows = db.scalars(
        select(StockBalance).where(
            StockBalance.branch_id == payload.branch_id,
            StockBalance.is_deleted.is_(False),
        )
    ).all()
    expected_by_variant = {
        item.variant_id: item.quantity_on_hand for item in balance_rows
    }
    if payload.variant_ids is None:
        variant_ids = list(expected_by_variant)
    else:
        variant_ids = list(dict.fromkeys(payload.variant_ids))
        found_ids = set(
            db.scalars(
                select(ProductVariant.id).where(
                    ProductVariant.id.in_(variant_ids),
                    ProductVariant.is_deleted.is_(False),
                )
            ).all()
        )
        if found_ids != set(variant_ids):
            raise NotFoundError("one or more product variants were not found")
    if not variant_ids:
        raise ValidationError("stock count requires at least one product variant")

    count = StockCount(
        branch_id=payload.branch_id,
        count_number=_count_number(),
        status=StockCountStatus.DRAFT,
        created_by_id=principal.user_id,
        notes=payload.notes,
    )
    db.add(count)
    db.flush()
    for variant_id in variant_ids:
        db.add(
            StockCountItem(
                stock_count_id=count.id,
                variant_id=variant_id,
                expected_quantity=expected_by_variant.get(variant_id, 0),
            )
        )
    db.flush()
    return _count_response(db, count)


def update_count_item(
    db: Session,
    principal: AuthPrincipal,
    count_id: UUID,
    item_id: UUID,
    payload: StockCountItemUpdate,
) -> StockCountResponse:
    enforce_permission(principal, "inventory.adjust")
    count = _get_count(db, principal, count_id, lock=True)
    if count.status != StockCountStatus.DRAFT:
        raise ConflictError("only draft stock counts can be edited")
    item = db.scalar(
        select(StockCountItem).where(
            StockCountItem.id == item_id,
            StockCountItem.stock_count_id == count.id,
            StockCountItem.is_deleted.is_(False),
        )
    )
    if item is None:
        raise NotFoundError("stock count item not found")
    item.counted_quantity = payload.counted_quantity
    item.variance = payload.counted_quantity - item.expected_quantity
    item.notes = payload.notes
    db.flush()
    return _count_response(db, count)


def submit_stock_count(
    db: Session, principal: AuthPrincipal, count_id: UUID
) -> StockCountResponse:
    enforce_permission(principal, "inventory.adjust")
    count = _get_count(db, principal, count_id, lock=True)
    if count.status != StockCountStatus.DRAFT:
        raise ConflictError("only draft stock counts can be submitted")
    missing = db.scalar(
        select(StockCountItem.id)
        .where(
            StockCountItem.stock_count_id == count.id,
            StockCountItem.counted_quantity.is_(None),
            StockCountItem.is_deleted.is_(False),
        )
        .limit(1)
    )
    if missing is not None:
        raise ValidationError(
            "every stock count item must be counted before submission"
        )
    count.status = StockCountStatus.SUBMITTED
    count.submitted_at = datetime.now(timezone.utc)
    db.flush()
    return _count_response(db, count)


def approve_stock_count(
    db: Session, principal: AuthPrincipal, count_id: UUID
) -> StockCountResponse:
    if principal.role_code not in {ADMIN, BRANCH_MANAGER}:
        raise AuthorizationError(
            "only an Admin or Branch Manager can approve stock counts"
        )
    count = _get_count(db, principal, count_id, lock=True)
    if count.status != StockCountStatus.SUBMITTED:
        raise ConflictError("only submitted stock counts can be approved")
    items = db.scalars(
        select(StockCountItem)
        .where(
            StockCountItem.stock_count_id == count.id,
            StockCountItem.is_deleted.is_(False),
        )
        .with_for_update()
    ).all()
    variants = {
        item.id: item
        for item in db.scalars(
            select(ProductVariant).where(
                ProductVariant.id.in_([item.variant_id for item in items])
            )
        ).all()
    }
    for item in items:
        variant = variants[item.variant_id]
        variance = item.variance or 0
        if variance and variant.tracking_type != TrackingType.BULK:
            raise ValidationError(
                "serialized stock variances require unit-specific adjustment requests"
            )
    now = datetime.now(timezone.utc)
    for item in items:
        variant = variants[item.variant_id]
        variance = item.variance or 0
        if variance:
            inventory.apply_stock_adjustment(
                db,
                branch_id=count.branch_id,
                variant=variant,
                quantity_delta=variance,
                performed_by_id=principal.user_id,
                reference_type="stock_count",
                reference_id=count.id,
                reason=f"Stock count {count.count_number}",
            )
        balance = db.scalar(
            select(StockBalance).where(
                StockBalance.branch_id == count.branch_id,
                StockBalance.variant_id == item.variant_id,
            )
        )
        if balance is not None:
            balance.last_stock_take_at = now
    count.status = StockCountStatus.APPROVED
    count.approved_by_id = principal.user_id
    count.approved_at = now
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=count.branch_id,
        action="inventory.stock_count_approved",
        resource_type="stock_count",
        resource_id=count.id,
        after={"status": count.status.value},
    )
    return _count_response(db, count)


def cancel_stock_count(
    db: Session, principal: AuthPrincipal, count_id: UUID
) -> StockCountResponse:
    enforce_permission(principal, "inventory.adjust")
    count = _get_count(db, principal, count_id, lock=True)
    if count.status not in {StockCountStatus.DRAFT, StockCountStatus.SUBMITTED}:
        raise ConflictError("this stock count can no longer be cancelled")
    count.status = StockCountStatus.CANCELLED
    db.flush()
    return _count_response(db, count)
