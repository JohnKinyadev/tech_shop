from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from backend.core.permissions import ADMIN
from backend.models.branch import Branch
from backend.schemas.branch_schemas import BranchCreate, BranchUpdate
from backend.services.audit import record_audit
from backend.services.auth import AuthPrincipal
from backend.services.authorization import enforce_branch_scope, enforce_permission
from backend.services.exceptions import ConflictError, NotFoundError, ValidationError


def branch_snapshot(branch: Branch) -> dict[str, Any]:
    return {
        "id": str(branch.id),
        "name": branch.name,
        "code": branch.code,
        "phone": branch.phone,
        "email": branch.email,
        "address": branch.address,
        "city": branch.city,
        "country": branch.country,
        "is_headquarters": branch.is_headquarters,
        "status": branch.status.value,
    }


def list_branches(db: Session, principal: AuthPrincipal) -> list[Branch]:
    statement = select(Branch).where(Branch.is_deleted.is_(False))
    if principal.role_code != ADMIN:
        if principal.branch_id is None:
            return []
        statement = statement.where(Branch.id == principal.branch_id)
    return list(db.scalars(statement.order_by(Branch.name)).all())


def get_branch(db: Session, principal: AuthPrincipal, branch_id: UUID) -> Branch:
    branch = db.scalar(
        select(Branch).where(
            Branch.id == branch_id,
            Branch.is_deleted.is_(False),
        )
    )
    if branch is None:
        raise NotFoundError("branch not found")
    enforce_branch_scope(principal, branch.id)
    return branch


def _ensure_unique_branch(
    db: Session,
    *,
    name: str,
    code: str,
    exclude_id: UUID | None = None,
) -> None:
    statement = select(Branch.id).where(
        or_(
            func.lower(Branch.name) == name.strip().lower(),
            func.lower(Branch.code) == code.strip().lower(),
        ),
        Branch.is_deleted.is_(False),
    )
    if exclude_id is not None:
        statement = statement.where(Branch.id != exclude_id)
    if db.scalar(statement.limit(1)) is not None:
        raise ConflictError("branch name or code is already in use")


def create_branch(
    db: Session, principal: AuthPrincipal, payload: BranchCreate
) -> Branch:
    enforce_permission(principal, "branches.manage")
    code = payload.code.strip().upper()
    _ensure_unique_branch(db, name=payload.name, code=code)
    if payload.is_headquarters:
        existing_hq = db.scalar(
            select(Branch.id).where(
                Branch.is_headquarters.is_(True),
                Branch.is_deleted.is_(False),
            )
        )
        if existing_hq is not None:
            raise ConflictError("a headquarters branch already exists")

    values = payload.model_dump()
    values["name"] = payload.name.strip()
    values["code"] = code
    branch = Branch(**values)
    db.add(branch)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=branch.id,
        action="branch.created",
        resource_type="branch",
        resource_id=branch.id,
        after=branch_snapshot(branch),
    )
    return branch


def update_branch(
    db: Session,
    principal: AuthPrincipal,
    branch_id: UUID,
    payload: BranchUpdate,
) -> Branch:
    enforce_permission(principal, "branches.manage")
    if not payload.model_fields_set:
        raise ValidationError("at least one field is required")
    branch = db.scalar(
        select(Branch).where(
            Branch.id == branch_id,
            Branch.is_deleted.is_(False),
        )
    )
    if branch is None:
        raise NotFoundError("branch not found")

    before = branch_snapshot(branch)
    if payload.name is not None:
        _ensure_unique_branch(
            db,
            name=payload.name,
            code=branch.code,
            exclude_id=branch.id,
        )
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "name" and value is not None:
            value = value.strip()
        setattr(branch, field, value)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=branch.id,
        action="branch.updated",
        resource_type="branch",
        resource_id=branch.id,
        before=before,
        after=branch_snapshot(branch),
    )
    return branch
