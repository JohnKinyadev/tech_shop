from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.api.dependencies import get_current_principal
from backend.core.permissions import BRANCH_MANAGER, CASHIER, INVENTORY_MANAGER
from backend.main import app
from backend.models.database import get_db
from backend.models.enums import SaleChannel
from backend.schemas.sales_schemas import POSSaleItemResponse, SaleCreate
from backend.services import returns as return_service
from backend.services import sales as sale_service
from backend.services.auth import AuthPrincipal
from backend.services.authorization import AuthorizationError
from backend.services.exceptions import ValidationError


def principal(role_code: str, permissions: set[str], branch_id=None) -> AuthPrincipal:
    return AuthPrincipal(
        user_id=uuid4(),
        full_name="POS User",
        username="pos-user",
        email="pos@example.com",
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
    app.dependency_overrides[get_db] = lambda: object()


def test_pos_routes_are_exposed() -> None:
    paths = app.openapi()["paths"]
    assert "/api/v1/staff/pos/tills" in paths
    assert "/api/v1/staff/pos/till-sessions/open" in paths
    assert "/api/v1/staff/pos/customers" in paths
    assert "/api/v1/staff/pos/sales" in paths
    assert "/api/v1/staff/pos/sales/{sale_id}/payments" in paths
    assert "/api/v1/staff/pos/sales/{sale_id}/receipt" in paths
    assert "/api/v1/staff/pos/sales/{sale_id}/void-requests" in paths
    assert "/api/v1/staff/pos/sales/{sale_id}/returns" in paths
    assert "/api/v1/staff/pos/warranties/lookup" in paths


def test_cashier_can_list_own_branch_sales(monkeypatch) -> None:
    actor = principal(CASHIER, {"sales.process", "tills.own.view"})
    use_principal(actor)
    monkeypatch.setattr(sale_service, "list_sales", lambda *args, **kwargs: ([], 0))
    response = TestClient(app).get(
        "/api/v1/staff/pos/sales",
        params={"branch_id": str(actor.branch_id)},
    )
    assert response.status_code == 200
    assert response.json()["total"] == 0


def test_cashier_cannot_configure_tills() -> None:
    actor = principal(CASHIER, {"sales.process", "tills.own.view"})
    use_principal(actor)
    response = TestClient(app).post(
        "/api/v1/staff/pos/tills",
        json={"branch_id": str(actor.branch_id), "name": "Front", "code": "POS1"},
    )
    assert response.status_code == 403


def test_inventory_manager_cannot_access_pos() -> None:
    actor = principal(INVENTORY_MANAGER, {"inventory.view"})
    use_principal(actor)
    response = TestClient(app).get(
        "/api/v1/staff/pos/sales",
        params={"branch_id": str(actor.branch_id)},
    )
    assert response.status_code == 403


def test_cashier_facing_sale_items_do_not_expose_unit_cost() -> None:
    assert "unit_cost" not in POSSaleItemResponse.model_fields


def test_pos_service_rejects_non_pos_channels_before_database_work() -> None:
    actor = principal(CASHIER, {"sales.process"})
    payload = SaleCreate(
        branch_id=actor.branch_id,
        till_session_id=uuid4(),
        channel=SaleChannel.ONLINE,
        items=[{"variant_id": uuid4(), "quantity": 1}],
    )
    with pytest.raises(ValidationError):
        sale_service.create_sale(object(), actor, payload)


def test_inventory_manager_cannot_approve_returns() -> None:
    actor = principal(INVENTORY_MANAGER, {"inventory.adjust"})
    from backend.schemas.approval_schemas import ApprovalDecision

    with pytest.raises(AuthorizationError):
        return_service.decide_return(
            object(), actor, uuid4(), ApprovalDecision(approved=True)
        )


def test_money_rounds_to_currency_precision() -> None:
    assert sale_service.money(Decimal("10.005")) == Decimal("10.01")


def test_branch_manager_permission_set_includes_till_management() -> None:
    from backend.core.permissions import ROLE_DEFINITIONS

    definition = next(item for item in ROLE_DEFINITIONS if item.code == BRANCH_MANAGER)
    assert "tills.manage" in definition.permissions
