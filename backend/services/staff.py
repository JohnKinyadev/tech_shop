from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from backend.core.permissions import ADMIN, ASSIGNABLE_ROLES
from backend.core.security import hash_password
from backend.models.branch import Branch
from backend.models.roles import Role
from backend.models.users import User
from backend.schemas.user_schemas import UserCreate, UserUpdate
from backend.services.audit import record_audit
from backend.services.auth import AuthPrincipal
from backend.services.authorization import enforce_permission, enforce_role_assignment
from backend.services.exceptions import ConflictError, NotFoundError, ValidationError


def user_snapshot(user: User) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "full_name": user.full_name,
        "username": user.username,
        "email": user.email,
        "phone": user.phone,
        "branch_id": str(user.branch_id) if user.branch_id else None,
        "role_id": str(user.role_id),
        "is_active": user.is_active,
        "is_verified": user.is_verified,
        "must_change_password": user.must_change_password,
    }


def _get_role(db: Session, role_id: UUID) -> Role:
    role = db.scalar(
        select(Role).where(
            Role.id == role_id,
            Role.is_active.is_(True),
            Role.is_deleted.is_(False),
        )
    )
    if role is None:
        raise NotFoundError("role not found")
    return role


def _ensure_branch_exists(db: Session, branch_id: UUID) -> None:
    branch = db.scalar(
        select(Branch.id).where(
            Branch.id == branch_id,
            Branch.is_deleted.is_(False),
        )
    )
    if branch is None:
        raise NotFoundError("branch not found")


def _ensure_unique_identity(
    db: Session,
    *,
    username: str,
    email: str,
    exclude_id: UUID | None = None,
) -> None:
    statement = select(User.id).where(
        or_(
            func.lower(User.username) == username.strip().lower(),
            func.lower(User.email) == email.strip().lower(),
        ),
        User.is_deleted.is_(False),
    )
    if exclude_id is not None:
        statement = statement.where(User.id != exclude_id)
    if db.scalar(statement.limit(1)) is not None:
        raise ConflictError("username or email is already in use")


def _enforce_manageable_user(db: Session, principal: AuthPrincipal, user: User) -> Role:
    role = _get_role(db, user.role_id)
    enforce_role_assignment(principal, role.code, user.branch_id)
    return role


def list_assignable_roles(db: Session, principal: AuthPrincipal) -> list[Role]:
    enforce_permission(principal, "staff.manage")
    allowed_codes = ASSIGNABLE_ROLES.get(principal.role_code, frozenset())
    return list(
        db.scalars(
            select(Role)
            .where(
                Role.code.in_(allowed_codes),
                Role.is_active.is_(True),
                Role.is_deleted.is_(False),
            )
            .order_by(Role.name)
        ).all()
    )


def list_staff(db: Session, principal: AuthPrincipal) -> list[User]:
    enforce_permission(principal, "staff.manage")
    statement = (
        select(User)
        .join(Role, Role.id == User.role_id)
        .where(User.is_deleted.is_(False))
    )
    if principal.role_code != ADMIN:
        allowed_codes = ASSIGNABLE_ROLES.get(principal.role_code, frozenset())
        statement = statement.where(
            User.branch_id == principal.branch_id,
            Role.code.in_(allowed_codes),
        )
    return list(db.scalars(statement.order_by(User.full_name)).all())


def get_staff_user(db: Session, principal: AuthPrincipal, user_id: UUID) -> User:
    enforce_permission(principal, "staff.manage")
    user = db.scalar(select(User).where(User.id == user_id, User.is_deleted.is_(False)))
    if user is None:
        raise NotFoundError("staff user not found")
    _enforce_manageable_user(db, principal, user)
    return user


def create_staff_user(
    db: Session, principal: AuthPrincipal, payload: UserCreate
) -> User:
    enforce_permission(principal, "staff.manage")
    role = _get_role(db, payload.role_id)
    enforce_role_assignment(principal, role.code, payload.branch_id)
    if payload.branch_id is not None:
        _ensure_branch_exists(db, payload.branch_id)

    username = payload.username.strip().lower()
    email = str(payload.email).strip().lower()
    _ensure_unique_identity(db, username=username, email=email)

    user = User(
        full_name=payload.full_name.strip(),
        username=username,
        email=email,
        phone=payload.phone,
        password_hash=hash_password(payload.password),
        branch_id=payload.branch_id,
        role_id=role.id,
        is_active=True,
        is_verified=True,
        must_change_password=True,
    )
    db.add(user)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=user.branch_id,
        action="staff.created",
        resource_type="user",
        resource_id=user.id,
        after=user_snapshot(user),
    )
    return user


def _ensure_not_final_admin(db: Session, user: User, current_role: Role) -> None:
    if current_role.code != ADMIN or not user.is_active:
        return
    active_admins = db.scalar(
        select(func.count())
        .select_from(User)
        .join(Role, Role.id == User.role_id)
        .where(
            Role.code == ADMIN,
            User.is_active.is_(True),
            User.is_deleted.is_(False),
        )
    )
    if active_admins is not None and active_admins <= 1:
        raise ConflictError("the final active Admin cannot be removed or deactivated")


def update_staff_user(
    db: Session,
    principal: AuthPrincipal,
    user_id: UUID,
    payload: UserUpdate,
) -> User:
    enforce_permission(principal, "staff.manage")
    if not payload.model_fields_set:
        raise ValidationError("at least one field is required")

    user = db.scalar(select(User).where(User.id == user_id, User.is_deleted.is_(False)))
    if user is None:
        raise NotFoundError("staff user not found")
    current_role = _enforce_manageable_user(db, principal, user)

    effective_role = (
        _get_role(db, payload.role_id)
        if "role_id" in payload.model_fields_set and payload.role_id is not None
        else current_role
    )
    effective_branch_id = (
        payload.branch_id if "branch_id" in payload.model_fields_set else user.branch_id
    )
    enforce_role_assignment(principal, effective_role.code, effective_branch_id)
    if effective_branch_id is not None and (
        "branch_id" in payload.model_fields_set or "role_id" in payload.model_fields_set
    ):
        _ensure_branch_exists(db, effective_branch_id)

    deactivating = payload.is_active is False and user.is_active
    removing_admin = current_role.code == ADMIN and effective_role.code != ADMIN
    if deactivating and user.id == principal.user_id:
        raise ConflictError("users cannot deactivate their own account")
    if deactivating or removing_admin:
        _ensure_not_final_admin(db, user, current_role)

    if payload.email is not None:
        _ensure_unique_identity(
            db,
            username=user.username,
            email=str(payload.email),
            exclude_id=user.id,
        )

    before = user_snapshot(user)
    values = payload.model_dump(exclude_unset=True)
    if "full_name" in values and values["full_name"] is not None:
        values["full_name"] = values["full_name"].strip()
    if "email" in values and values["email"] is not None:
        values["email"] = str(values["email"]).strip().lower()
    for field, value in values.items():
        setattr(user, field, value)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=user.branch_id,
        action="staff.updated",
        resource_type="user",
        resource_id=user.id,
        before=before,
        after=user_snapshot(user),
    )
    return user
