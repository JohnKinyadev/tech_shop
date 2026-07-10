from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.api.dependencies import get_current_principal
from backend.core.permissions import (
    ACCOUNTANT,
    BRANCH_MANAGER,
    CASHIER,
    INVENTORY_MANAGER,
    TECHNICIAN,
)
from backend.main import app
from backend.models.database import get_db
from backend.services import reports as report_service
from backend.services.auth import AuthPrincipal
from backend.services.authorization import AuthorizationError
from backend.services.exceptions import ValidationError


class FakeSession:
    pass


def principal(role_code: str, permissions: set[str], branch_id=None) -> AuthPrincipal:
    return AuthPrincipal(
        user_id=uuid4(),
        full_name="Report User",
        username="report-user",
        email="report@example.com",
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


def empty_sales(branch_id):
    return {
        "branch_id": str(branch_id) if branch_id else None,
        "start_at": None,
        "end_at": None,
        "sale_count": 0,
        "item_count": 0,
        "gross_sales": "0.00",
        "paid_amount": "0.00",
        "discount_amount": "0.00",
        "refund_amount": "0.00",
        "net_sales": "0.00",
        "average_sale": "0.00",
        "payments": [],
        "top_items": [],
    }


def empty_inventory(branch_id):
    return {
        "branch_id": str(branch_id) if branch_id else None,
        "stock_balance_count": 0,
        "total_on_hand": 0,
        "total_reserved": 0,
        "total_available": 0,
        "stock_value": "0.00",
        "low_stock_count": 0,
        "low_stock_items": [],
    }


def empty_repairs(branch_id):
    return {
        "branch_id": str(branch_id) if branch_id else None,
        "start_at": None,
        "end_at": None,
        "ticket_count": 0,
        "open_ticket_count": 0,
        "ready_ticket_count": 0,
        "collected_ticket_count": 0,
        "cancelled_ticket_count": 0,
        "labor_estimate_total": "0.00",
        "parts_revenue_total": "0.00",
        "payment_total": "0.00",
        "status_breakdown": [],
    }


def empty_expenses(branch_id):
    return {
        "branch_id": str(branch_id) if branch_id else None,
        "start_at": None,
        "end_at": None,
        "approved_expense_count": 0,
        "pending_expense_count": 0,
        "rejected_expense_count": 0,
        "cancelled_expense_count": 0,
        "total_approved_expenses": "0.00",
        "by_category": [],
    }


def test_report_routes_are_exposed() -> None:
    paths = app.openapi()["paths"]
    assert "/api/v1/staff/reports/dashboard" in paths
    assert "/api/v1/staff/reports/sales" in paths
    assert "/api/v1/staff/reports/inventory" in paths
    assert "/api/v1/staff/reports/repairs" in paths
    assert "/api/v1/staff/reports/expenses" in paths


def test_cashier_cannot_access_sales_reports() -> None:
    use_principal(principal(CASHIER, {"sales.process"}))
    response = TestClient(app).get("/api/v1/staff/reports/sales")
    assert response.status_code == 403


def test_inventory_manager_can_access_inventory_report(monkeypatch) -> None:
    actor = principal(INVENTORY_MANAGER, {"reports.inventory.view"})
    use_principal(actor)
    monkeypatch.setattr(
        report_service,
        "inventory_summary",
        lambda *args, **kwargs: empty_inventory(actor.branch_id),
    )
    response = TestClient(app).get("/api/v1/staff/reports/inventory")
    assert response.status_code == 200
    assert response.json()["total_on_hand"] == 0


def test_technician_can_access_own_repair_report(monkeypatch) -> None:
    actor = principal(TECHNICIAN, {"reports.own_repairs.view"})
    use_principal(actor)
    monkeypatch.setattr(
        report_service,
        "repair_summary",
        lambda *args, **kwargs: empty_repairs(actor.branch_id),
    )
    response = TestClient(app).get("/api/v1/staff/reports/repairs")
    assert response.status_code == 200
    assert response.json()["ticket_count"] == 0


def test_accountant_can_access_dashboard(monkeypatch) -> None:
    actor = principal(
        ACCOUNTANT,
        {
            "reports.sales.view",
            "reports.inventory.view",
            "reports.repairs.view",
            "expenses.view",
        },
    )
    use_principal(actor)
    monkeypatch.setattr(
        report_service,
        "dashboard_summary",
        lambda *args, **kwargs: {
            "branch_id": str(actor.branch_id),
            "start_at": None,
            "end_at": None,
            "sales": empty_sales(actor.branch_id),
            "inventory": empty_inventory(actor.branch_id),
            "repairs": empty_repairs(actor.branch_id),
            "expenses": empty_expenses(actor.branch_id),
        },
    )
    response = TestClient(app).get("/api/v1/staff/reports/dashboard")
    assert response.status_code == 200
    assert response.json()["sales"]["sale_count"] == 0


def test_branch_report_scope_rejects_other_branch() -> None:
    actor = principal(BRANCH_MANAGER, {"reports.sales.view"})
    with pytest.raises(AuthorizationError):
        report_service._branch_id(FakeSession(), actor, uuid4())


def test_report_period_rejects_inverted_dates() -> None:
    with pytest.raises(ValidationError):
        report_service._validate_period(
            datetime(2026, 1, 2, tzinfo=timezone.utc),
            datetime(2026, 1, 1, tzinfo=timezone.utc),
        )


def test_report_money_values_are_quantized() -> None:
    assert report_service._money(Decimal("10.005")) == Decimal("10.01")
