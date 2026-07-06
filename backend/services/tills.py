from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from backend.core.permissions import ADMIN, BRANCH_MANAGER
from backend.models.enums import (
    PaymentDirection,
    PaymentMethod,
    PaymentStatus,
    TillSessionStatus,
)
from backend.models.payments import Payment
from backend.models.sales import Till, TillSession
from backend.schemas.sales_schemas import (
    TillCreate,
    TillSessionClose,
    TillSessionOpen,
    TillUpdate,
)
from backend.services.audit import record_audit
from backend.services.auth import AuthPrincipal
from backend.services.authorization import (
    AuthorizationError,
    enforce_branch_scope,
    enforce_permission,
)
from backend.services.exceptions import ConflictError, NotFoundError, ValidationError


def _require_till_manager(principal: AuthPrincipal) -> None:
    enforce_permission(principal, "tills.manage")
    if principal.role_code not in {ADMIN, BRANCH_MANAGER}:
        raise AuthorizationError("only an Admin or Branch Manager can configure tills")


def list_tills(
    db: Session,
    principal: AuthPrincipal,
    branch_id: UUID,
    *,
    include_inactive: bool = False
) -> list[Till]:
    enforce_permission(principal, "sales.process")
    enforce_branch_scope(principal, branch_id)
    conditions = [Till.branch_id == branch_id, Till.is_deleted.is_(False)]
    if not include_inactive:
        conditions.append(Till.is_active.is_(True))
    return list(db.scalars(select(Till).where(*conditions).order_by(Till.name)).all())


def create_till(db: Session, principal: AuthPrincipal, payload: TillCreate) -> Till:
    _require_till_manager(principal)
    enforce_branch_scope(principal, payload.branch_id)
    code = payload.code.strip().upper()
    duplicate = db.scalar(
        select(Till.id).where(
            or_(
                func.lower(Till.code) == code.lower(),
                (
                    (Till.branch_id == payload.branch_id)
                    & (func.lower(Till.name) == payload.name.strip().lower())
                ),
            ),
            Till.is_deleted.is_(False),
        )
    )
    if duplicate is not None:
        raise ConflictError("till name or code is already in use")
    till = Till(
        branch_id=payload.branch_id,
        name=payload.name.strip(),
        code=code,
        is_active=True,
    )
    db.add(till)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=till.branch_id,
        action="till.created",
        resource_type="till",
        resource_id=till.id,
        after={"name": till.name, "code": till.code},
    )
    return till


def update_till(
    db: Session,
    principal: AuthPrincipal,
    till_id: UUID,
    payload: TillUpdate,
) -> Till:
    _require_till_manager(principal)
    if not payload.model_fields_set:
        raise ValidationError("at least one field is required")
    till = db.scalar(select(Till).where(Till.id == till_id, Till.is_deleted.is_(False)))
    if till is None:
        raise NotFoundError("till not found")
    enforce_branch_scope(principal, till.branch_id)
    if payload.name is not None:
        duplicate = db.scalar(
            select(Till.id).where(
                Till.branch_id == till.branch_id,
                func.lower(Till.name) == payload.name.strip().lower(),
                Till.id != till.id,
                Till.is_deleted.is_(False),
            )
        )
        if duplicate is not None:
            raise ConflictError("till name is already in use at this branch")
        till.name = payload.name.strip()
    if payload.is_active is not None:
        if not payload.is_active:
            open_session = db.scalar(
                select(TillSession.id).where(
                    TillSession.till_id == till.id,
                    TillSession.status == TillSessionStatus.OPEN,
                    TillSession.is_deleted.is_(False),
                )
            )
            if open_session is not None:
                raise ConflictError("a till with an open session cannot be deactivated")
        till.is_active = payload.is_active
    db.flush()
    return till


def get_current_session(db: Session, principal: AuthPrincipal) -> TillSession:
    enforce_permission(principal, "tills.own.view")
    session = db.scalar(
        select(TillSession).where(
            TillSession.cashier_id == principal.user_id,
            TillSession.status == TillSessionStatus.OPEN,
            TillSession.is_deleted.is_(False),
        )
    )
    if session is None:
        raise NotFoundError("no open till session")
    return session


def open_session(
    db: Session, principal: AuthPrincipal, payload: TillSessionOpen
) -> TillSession:
    enforce_permission(principal, "sales.process")
    till = db.scalar(
        select(Till)
        .where(Till.id == payload.till_id, Till.is_deleted.is_(False))
        .with_for_update()
    )
    if till is None or not till.is_active:
        raise NotFoundError("active till not found")
    enforce_branch_scope(principal, till.branch_id)
    open_session_id = db.scalar(
        select(TillSession.id).where(
            or_(
                TillSession.till_id == till.id,
                TillSession.cashier_id == principal.user_id,
            ),
            TillSession.status == TillSessionStatus.OPEN,
            TillSession.is_deleted.is_(False),
        )
    )
    if open_session_id is not None:
        raise ConflictError("the cashier or till already has an open session")
    session = TillSession(
        till_id=till.id,
        cashier_id=principal.user_id,
        status=TillSessionStatus.OPEN,
        opened_at=datetime.now(timezone.utc),
        opening_float=payload.opening_float,
    )
    db.add(session)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=till.branch_id,
        action="till.session_opened",
        resource_type="till_session",
        resource_id=session.id,
        after={"opening_float": str(session.opening_float)},
    )
    return session


def close_session(
    db: Session,
    principal: AuthPrincipal,
    session_id: UUID,
    payload: TillSessionClose,
) -> TillSession:
    enforce_permission(principal, "sales.process")
    session = db.scalar(
        select(TillSession)
        .where(TillSession.id == session_id, TillSession.is_deleted.is_(False))
        .with_for_update()
    )
    if session is None:
        raise NotFoundError("till session not found")
    if session.cashier_id != principal.user_id:
        raise AuthorizationError("cashiers can only close their own till session")
    if session.status != TillSessionStatus.OPEN:
        raise ConflictError("till session is already closed")
    cash_net = db.scalar(
        select(
            func.coalesce(
                func.sum(
                    case(
                        (
                            Payment.direction == PaymentDirection.INCOMING,
                            Payment.amount,
                        ),
                        else_=-Payment.amount,
                    )
                ),
                Decimal("0.00"),
            )
        ).where(
            Payment.till_session_id == session.id,
            Payment.method == PaymentMethod.CASH,
            Payment.status == PaymentStatus.COMPLETED,
            Payment.is_deleted.is_(False),
        )
    ) or Decimal("0.00")
    session.expected_cash = session.opening_float + cash_net
    session.closing_cash = payload.closing_cash
    session.status = TillSessionStatus.CLOSED
    session.closed_at = datetime.now(timezone.utc)
    db.flush()
    till = db.get(Till, session.till_id)
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=till.branch_id if till else principal.branch_id,
        action="till.session_closed",
        resource_type="till_session",
        resource_id=session.id,
        after={
            "expected_cash": str(session.expected_cash),
            "closing_cash": str(session.closing_cash),
            "variance": str(session.closing_cash - session.expected_cash),
        },
    )
    return session
