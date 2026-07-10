from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.core.permissions import ADMIN
from backend.models.branch import Branch
from backend.models.expenses import Expense, ExpenseCategory
from backend.schemas.expense_schemas import (
    ExpenseCategoryCreate,
    ExpenseCategoryUpdate,
    ExpenseCreate,
    ExpenseDecision,
    ExpenseUpdate,
)
from backend.services.audit import record_audit
from backend.services.auth import AuthPrincipal
from backend.services.authorization import enforce_branch_scope, enforce_permission
from backend.services.exceptions import ConflictError, NotFoundError, ValidationError

PENDING = "pending"
APPROVED = "approved"
REJECTED = "rejected"
CANCELLED = "cancelled"
EXPENSE_STATUSES = frozenset({PENDING, APPROVED, REJECTED, CANCELLED})


def category_snapshot(category: ExpenseCategory) -> dict[str, Any]:
    return {
        "id": str(category.id),
        "name": category.name,
        "description": category.description,
    }


def expense_snapshot(expense: Expense) -> dict[str, Any]:
    return {
        "id": str(expense.id),
        "branch_id": str(expense.branch_id),
        "category_id": str(expense.category_id),
        "submitted_by_id": str(expense.submitted_by_id),
        "approved_by_id": (
            str(expense.approved_by_id) if expense.approved_by_id else None
        ),
        "description": expense.description,
        "amount": str(expense.amount),
        "payment_method": expense.payment_method.value,
        "status": expense.status,
        "reference_number": expense.reference_number,
        "notes": expense.notes,
    }


def _normalize_name(value: str) -> str:
    normalized = " ".join(value.strip().split())
    if len(normalized) < 2:
        raise ValidationError("expense category name must contain at least 2 characters")
    return normalized


def _normalize_description(value: str) -> str:
    normalized = value.strip()
    if len(normalized) < 3:
        raise ValidationError("expense description must contain at least 3 characters")
    return normalized


def _ensure_unique_category_name(
    db: Session, name: str, *, exclude_id: UUID | None = None
) -> None:
    statement = select(ExpenseCategory.id).where(
        func.lower(ExpenseCategory.name) == name.lower(),
        ExpenseCategory.is_deleted.is_(False),
    )
    if exclude_id is not None:
        statement = statement.where(ExpenseCategory.id != exclude_id)
    if db.scalar(statement.limit(1)) is not None:
        raise ConflictError("expense category name is already in use")


def _get_category(db: Session, category_id: UUID) -> ExpenseCategory:
    category = db.scalar(
        select(ExpenseCategory).where(
            ExpenseCategory.id == category_id,
            ExpenseCategory.is_deleted.is_(False),
        )
    )
    if category is None:
        raise NotFoundError("expense category not found")
    return category


def _validate_branch(db: Session, branch_id: UUID) -> None:
    exists = db.scalar(
        select(Branch.id).where(Branch.id == branch_id, Branch.is_deleted.is_(False))
    )
    if exists is None:
        raise NotFoundError("branch not found")


def _get_expense(
    db: Session, principal: AuthPrincipal, expense_id: UUID, *, lock: bool = False
) -> Expense:
    statement = select(Expense).where(
        Expense.id == expense_id,
        Expense.is_deleted.is_(False),
    )
    if lock:
        statement = statement.with_for_update()
    expense = db.scalar(statement)
    if expense is None:
        raise NotFoundError("expense not found")
    enforce_branch_scope(principal, expense.branch_id)
    return expense


def list_categories(db: Session, principal: AuthPrincipal) -> list[ExpenseCategory]:
    enforce_permission(principal, "expenses.view")
    return list(
        db.scalars(
            select(ExpenseCategory)
            .where(ExpenseCategory.is_deleted.is_(False))
            .order_by(ExpenseCategory.name)
        ).all()
    )


def create_category(
    db: Session, principal: AuthPrincipal, payload: ExpenseCategoryCreate
) -> ExpenseCategory:
    enforce_permission(principal, "expenses.manage")
    name = _normalize_name(payload.name)
    _ensure_unique_category_name(db, name)
    category = ExpenseCategory(name=name, description=payload.description)
    db.add(category)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=principal.branch_id,
        action="expense_category.created",
        resource_type="expense_category",
        resource_id=category.id,
        after=category_snapshot(category),
    )
    return category


def update_category(
    db: Session,
    principal: AuthPrincipal,
    category_id: UUID,
    payload: ExpenseCategoryUpdate,
) -> ExpenseCategory:
    enforce_permission(principal, "expenses.manage")
    if not payload.model_fields_set:
        raise ValidationError("at least one field is required")
    category = _get_category(db, category_id)
    before = category_snapshot(category)
    if payload.name is not None:
        name = _normalize_name(payload.name)
        _ensure_unique_category_name(db, name, exclude_id=category.id)
        category.name = name
    if "description" in payload.model_fields_set:
        category.description = payload.description
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=principal.branch_id,
        action="expense_category.updated",
        resource_type="expense_category",
        resource_id=category.id,
        before=before,
        after=category_snapshot(category),
    )
    return category


def list_expenses(
    db: Session,
    principal: AuthPrincipal,
    *,
    page: int,
    page_size: int,
    branch_id: UUID | None = None,
    status: str | None = None,
    category_id: UUID | None = None,
) -> tuple[list[Expense], int]:
    enforce_permission(principal, "expenses.view")
    if status is not None and status not in EXPENSE_STATUSES:
        raise ValidationError("unknown expense status")

    conditions = [Expense.is_deleted.is_(False)]
    if principal.role_code != ADMIN:
        if principal.branch_id is None:
            return [], 0
        conditions.append(Expense.branch_id == principal.branch_id)
        if branch_id is not None:
            enforce_branch_scope(principal, branch_id)
    elif branch_id is not None:
        _validate_branch(db, branch_id)
        conditions.append(Expense.branch_id == branch_id)

    if status is not None:
        conditions.append(Expense.status == status)
    if category_id is not None:
        _get_category(db, category_id)
        conditions.append(Expense.category_id == category_id)

    total = db.scalar(select(func.count()).select_from(Expense).where(*conditions)) or 0
    items = list(
        db.scalars(
            select(Expense)
            .where(*conditions)
            .order_by(Expense.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
    )
    return items, total


def get_expense(db: Session, principal: AuthPrincipal, expense_id: UUID) -> Expense:
    enforce_permission(principal, "expenses.view")
    return _get_expense(db, principal, expense_id)


def create_expense(
    db: Session, principal: AuthPrincipal, payload: ExpenseCreate
) -> Expense:
    enforce_permission(principal, "expenses.manage")
    enforce_branch_scope(principal, payload.branch_id)
    _validate_branch(db, payload.branch_id)
    _get_category(db, payload.category_id)

    expense = Expense(
        branch_id=payload.branch_id,
        category_id=payload.category_id,
        submitted_by_id=principal.user_id,
        description=_normalize_description(payload.description),
        amount=payload.amount,
        payment_method=payload.payment_method,
        status=PENDING,
        reference_number=payload.reference_number,
        notes=payload.notes,
    )
    db.add(expense)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=expense.branch_id,
        action="expense.created",
        resource_type="expense",
        resource_id=expense.id,
        after=expense_snapshot(expense),
    )
    return expense


def update_expense(
    db: Session,
    principal: AuthPrincipal,
    expense_id: UUID,
    payload: ExpenseUpdate,
) -> Expense:
    enforce_permission(principal, "expenses.manage")
    if not payload.model_fields_set:
        raise ValidationError("at least one field is required")
    expense = _get_expense(db, principal, expense_id, lock=True)
    if expense.status != PENDING:
        raise ConflictError("only pending expenses can be edited")

    before = expense_snapshot(expense)
    values = payload.model_dump(exclude_unset=True)
    if "category_id" in values and values["category_id"] is not None:
        _get_category(db, values["category_id"])
    if "description" in values and values["description"] is not None:
        values["description"] = _normalize_description(values["description"])
    for field, value in values.items():
        setattr(expense, field, value)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=expense.branch_id,
        action="expense.updated",
        resource_type="expense",
        resource_id=expense.id,
        before=before,
        after=expense_snapshot(expense),
    )
    return expense


def approve_expense(
    db: Session,
    principal: AuthPrincipal,
    expense_id: UUID,
    payload: ExpenseDecision,
) -> Expense:
    enforce_permission(principal, "expenses.manage")
    expense = _get_expense(db, principal, expense_id, lock=True)
    if expense.status != PENDING:
        raise ConflictError("only pending expenses can be approved")
    before = expense_snapshot(expense)
    expense.status = APPROVED
    expense.approved_by_id = principal.user_id
    if payload.notes is not None:
        expense.notes = payload.notes
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=expense.branch_id,
        action="expense.approved",
        resource_type="expense",
        resource_id=expense.id,
        before=before,
        after=expense_snapshot(expense),
    )
    return expense


def reject_expense(
    db: Session,
    principal: AuthPrincipal,
    expense_id: UUID,
    payload: ExpenseDecision,
) -> Expense:
    enforce_permission(principal, "expenses.manage")
    expense = _get_expense(db, principal, expense_id, lock=True)
    if expense.status != PENDING:
        raise ConflictError("only pending expenses can be rejected")
    before = expense_snapshot(expense)
    expense.status = REJECTED
    if payload.notes is not None:
        expense.notes = payload.notes
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=expense.branch_id,
        action="expense.rejected",
        resource_type="expense",
        resource_id=expense.id,
        before=before,
        after=expense_snapshot(expense),
    )
    return expense


def cancel_expense(
    db: Session,
    principal: AuthPrincipal,
    expense_id: UUID,
    payload: ExpenseDecision,
) -> Expense:
    enforce_permission(principal, "expenses.manage")
    expense = _get_expense(db, principal, expense_id, lock=True)
    if expense.status != PENDING:
        raise ConflictError("only pending expenses can be cancelled")
    before = expense_snapshot(expense)
    expense.status = CANCELLED
    if payload.notes is not None:
        expense.notes = payload.notes
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=expense.branch_id,
        action="expense.cancelled",
        resource_type="expense",
        resource_id=expense.id,
        before=before,
        after=expense_snapshot(expense),
    )
    return expense
