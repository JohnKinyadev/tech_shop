from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status

from backend.api.dependencies import DatabaseSession, require_permission
from backend.schemas.base_schemas import Page
from backend.schemas.expense_schemas import (
    ExpenseCategoryCreate,
    ExpenseCategoryResponse,
    ExpenseCategoryUpdate,
    ExpenseCreate,
    ExpenseDecision,
    ExpenseResponse,
    ExpenseUpdate,
)
from backend.services import expenses as expense_service
from backend.services.auth import AuthPrincipal

router = APIRouter(prefix="/expenses", tags=["staff-expenses"])
ExpenseViewPrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("expenses.view"))
]
ExpenseManagePrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("expenses.manage"))
]


@router.get("/categories", response_model=list[ExpenseCategoryResponse])
def list_expense_categories(
    principal: ExpenseViewPrincipal,
    db: DatabaseSession,
) -> list[ExpenseCategoryResponse]:
    return [
        ExpenseCategoryResponse.model_validate(item)
        for item in expense_service.list_categories(db, principal)
    ]


@router.post(
    "/categories",
    response_model=ExpenseCategoryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_expense_category(
    payload: ExpenseCategoryCreate,
    principal: ExpenseManagePrincipal,
    db: DatabaseSession,
) -> ExpenseCategoryResponse:
    item = expense_service.create_category(db, principal, payload)
    db.commit()
    return ExpenseCategoryResponse.model_validate(item)


@router.patch("/categories/{category_id}", response_model=ExpenseCategoryResponse)
def update_expense_category(
    category_id: UUID,
    payload: ExpenseCategoryUpdate,
    principal: ExpenseManagePrincipal,
    db: DatabaseSession,
) -> ExpenseCategoryResponse:
    item = expense_service.update_category(db, principal, category_id, payload)
    db.commit()
    return ExpenseCategoryResponse.model_validate(item)


@router.get("", response_model=Page[ExpenseResponse])
def list_expenses(
    principal: ExpenseViewPrincipal,
    db: DatabaseSession,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    branch_id: UUID | None = None,
    expense_status: str | None = Query(default=None, alias="status"),
    category_id: UUID | None = None,
) -> Page[ExpenseResponse]:
    items, total = expense_service.list_expenses(
        db,
        principal,
        page=page,
        page_size=page_size,
        branch_id=branch_id,
        status=expense_status,
        category_id=category_id,
    )
    return Page[ExpenseResponse](
        items=[ExpenseResponse.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=ExpenseResponse, status_code=status.HTTP_201_CREATED)
def create_expense(
    payload: ExpenseCreate,
    principal: ExpenseManagePrincipal,
    db: DatabaseSession,
) -> ExpenseResponse:
    item = expense_service.create_expense(db, principal, payload)
    db.commit()
    return ExpenseResponse.model_validate(item)


@router.get("/{expense_id}", response_model=ExpenseResponse)
def get_expense(
    expense_id: UUID,
    principal: ExpenseViewPrincipal,
    db: DatabaseSession,
) -> ExpenseResponse:
    return ExpenseResponse.model_validate(
        expense_service.get_expense(db, principal, expense_id)
    )


@router.patch("/{expense_id}", response_model=ExpenseResponse)
def update_expense(
    expense_id: UUID,
    payload: ExpenseUpdate,
    principal: ExpenseManagePrincipal,
    db: DatabaseSession,
) -> ExpenseResponse:
    item = expense_service.update_expense(db, principal, expense_id, payload)
    db.commit()
    return ExpenseResponse.model_validate(item)


@router.post("/{expense_id}/approve", response_model=ExpenseResponse)
def approve_expense(
    expense_id: UUID,
    payload: ExpenseDecision,
    principal: ExpenseManagePrincipal,
    db: DatabaseSession,
) -> ExpenseResponse:
    item = expense_service.approve_expense(db, principal, expense_id, payload)
    db.commit()
    return ExpenseResponse.model_validate(item)


@router.post("/{expense_id}/reject", response_model=ExpenseResponse)
def reject_expense(
    expense_id: UUID,
    payload: ExpenseDecision,
    principal: ExpenseManagePrincipal,
    db: DatabaseSession,
) -> ExpenseResponse:
    item = expense_service.reject_expense(db, principal, expense_id, payload)
    db.commit()
    return ExpenseResponse.model_validate(item)


@router.post("/{expense_id}/cancel", response_model=ExpenseResponse)
def cancel_expense(
    expense_id: UUID,
    payload: ExpenseDecision,
    principal: ExpenseManagePrincipal,
    db: DatabaseSession,
) -> ExpenseResponse:
    item = expense_service.cancel_expense(db, principal, expense_id, payload)
    db.commit()
    return ExpenseResponse.model_validate(item)
