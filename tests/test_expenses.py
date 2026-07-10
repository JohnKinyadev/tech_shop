from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from backend.api.dependencies import get_current_principal
from backend.core.permissions import ACCOUNTANT, BRANCH_MANAGER, CASHIER
from backend.main import app
from backend.models.database import get_db
from backend.models.enums import PaymentMethod
from backend.services import expenses as expense_service
from backend.services.auth import AuthPrincipal
from backend.services.authorization import AuthorizationError, enforce_branch_scope
from backend.services.exceptions import ValidationError


class FakeSession:
    def commit(self) -> None:
        pass


def principal(role_code: str, permissions: set[str], branch_id=None) -> AuthPrincipal:
    return AuthPrincipal(
        user_id=uuid4(),
        full_name="Expense User",
        username="expense-user",
        email="expense@example.com",
        branch_id=branch_id or uuid4(),
        role_id=uuid4(),
        role_code=role_code,
        role_name=role_code.replace("_", " ").title(),
        permissions=frozenset(permissions),
        password_hash="test-hash",
        must_change_password=False,
    )


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    yield
    app.dependency_overrides.clear()


def use_principal(value: AuthPrincipal) -> None:
    app.dependency_overrides[get_current_principal] = lambda: value
    app.dependency_overrides[get_db] = lambda: FakeSession()


def expense_response(branch_id: UUID, submitted_by_id: UUID) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=uuid4(),
        created_at=now,
        updated_at=now,
        is_deleted=False,
        branch_id=branch_id,
        category_id=uuid4(),
        submitted_by_id=submitted_by_id,
        approved_by_id=None,
        description="Shop rent",
        amount="25000.00",
        payment_method=PaymentMethod.CASH,
        status=expense_service.PENDING,
        reference_number=None,
        notes=None,
    )


def test_expense_routes_are_exposed() -> None:
    paths = app.openapi()["paths"]
    assert "/api/v1/staff/expenses" in paths
    assert "/api/v1/staff/expenses/categories" in paths
    assert "/api/v1/staff/expenses/{expense_id}/approve" in paths
    assert "/api/v1/staff/expenses/{expense_id}/reject" in paths
    assert "/api/v1/staff/expenses/{expense_id}/cancel" in paths


def test_cashier_cannot_view_expenses() -> None:
    actor = principal(CASHIER, {"sales.process"})
    use_principal(actor)
    response = TestClient(app).get("/api/v1/staff/expenses")
    assert response.status_code == 403


def test_accountant_can_view_but_not_create_expenses(monkeypatch) -> None:
    actor = principal(ACCOUNTANT, {"expenses.view"})
    use_principal(actor)
    monkeypatch.setattr(expense_service, "list_expenses", lambda *args, **kwargs: ([], 0))

    client = TestClient(app)
    response = client.get("/api/v1/staff/expenses")
    assert response.status_code == 200
    assert response.json()["total"] == 0

    create_response = client.post(
        "/api/v1/staff/expenses",
        json={
            "branch_id": str(actor.branch_id),
            "category_id": str(uuid4()),
            "description": "Shop rent",
            "amount": "25000.00",
            "payment_method": "cash",
        },
    )
    assert create_response.status_code == 403


def test_branch_manager_can_create_expense(monkeypatch) -> None:
    actor = principal(BRANCH_MANAGER, {"expenses.view", "expenses.manage"})
    use_principal(actor)
    monkeypatch.setattr(
        expense_service,
        "create_expense",
        lambda *args, **kwargs: expense_response(actor.branch_id, actor.user_id),
    )

    response = TestClient(app).post(
        "/api/v1/staff/expenses",
        json={
            "branch_id": str(actor.branch_id),
            "category_id": str(uuid4()),
            "description": "Shop rent",
            "amount": "25000.00",
            "payment_method": "cash",
        },
    )
    assert response.status_code == 201
    assert response.json()["status"] == expense_service.PENDING


def test_non_admin_expense_scope_is_branch_limited() -> None:
    actor = principal(BRANCH_MANAGER, {"expenses.view", "expenses.manage"})
    with pytest.raises(AuthorizationError):
        enforce_branch_scope(actor, uuid4())


def test_expense_statuses_are_controlled() -> None:
    assert expense_service.EXPENSE_STATUSES == {
        expense_service.PENDING,
        expense_service.APPROVED,
        expense_service.REJECTED,
        expense_service.CANCELLED,
    }


def test_expense_normalization_rejects_blank_values() -> None:
    with pytest.raises(ValidationError):
        expense_service._normalize_name("   ")
    with pytest.raises(ValidationError):
        expense_service._normalize_description("  x ")
