from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError as PydanticValidationError

from backend.api.dependencies import get_current_principal
from backend.core.permissions import BRANCH_MANAGER, CASHIER, INVENTORY_MANAGER
from backend.main import app
from backend.models.database import get_db
from backend.schemas.approval_schemas import ApprovalDecision
from backend.schemas.inventory_schemas import StockAdjustmentCreate, StockTransferCreate
from backend.services import inventory_control
from backend.services import stocktake as stocktake_service
from backend.services import transfers as transfer_service
from backend.services.auth import AuthPrincipal
from backend.services.authorization import AuthorizationError


def principal(role_code: str, permissions: set[str], branch_id=None) -> AuthPrincipal:
    return AuthPrincipal(
        user_id=uuid4(),
        full_name="Inventory User",
        username="inventory-user",
        email="inventory@example.com",
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


def test_inventory_routes_are_exposed() -> None:
    paths = app.openapi()["paths"]
    assert "/api/v1/staff/inventory/balances" in paths
    assert "/api/v1/staff/inventory/serialized-units" in paths
    assert "/api/v1/staff/inventory/movements" in paths
    assert "/api/v1/staff/inventory/adjustment-requests" in paths
    assert "/api/v1/staff/inventory/transfers" in paths
    assert "/api/v1/staff/inventory/stock-counts" in paths


def test_cashier_can_view_balances_but_not_costed_movements(monkeypatch) -> None:
    actor = principal(CASHIER, {"inventory.view"})
    use_principal(actor)
    monkeypatch.setattr(
        inventory_control, "list_balances", lambda *args, **kwargs: ([], 0)
    )
    client = TestClient(app)
    balances = client.get(
        "/api/v1/staff/inventory/balances",
        params={"branch_id": str(actor.branch_id)},
    )
    assert balances.status_code == 200
    assert balances.json()["items"] == []
    movements = client.get(
        "/api/v1/staff/inventory/movements",
        params={"branch_id": str(actor.branch_id)},
    )
    assert movements.status_code == 403


def test_stock_adjustments_must_change_quantity() -> None:
    with pytest.raises(PydanticValidationError):
        StockAdjustmentCreate(
            branch_id=uuid4(),
            variant_id=uuid4(),
            quantity_delta=0,
            reason="Cycle count correction",
        )


def test_transfer_requires_different_branches_and_items() -> None:
    branch_id = uuid4()
    with pytest.raises(PydanticValidationError):
        StockTransferCreate(
            source_branch_id=branch_id,
            destination_branch_id=branch_id,
            items=[{"variant_id": uuid4(), "quantity": 1}],
        )
    with pytest.raises(PydanticValidationError):
        StockTransferCreate(
            source_branch_id=uuid4(),
            destination_branch_id=uuid4(),
            items=[],
        )


def test_inventory_manager_cannot_approve_controlled_inventory_actions() -> None:
    actor = principal(INVENTORY_MANAGER, {"inventory.adjust", "inventory.transfer"})
    with pytest.raises(AuthorizationError):
        inventory_control.decide_adjustment(
            object(), actor, uuid4(), ApprovalDecision(approved=True)
        )
    with pytest.raises(AuthorizationError):
        transfer_service.approve_transfer(object(), actor, uuid4())
    with pytest.raises(AuthorizationError):
        stocktake_service.approve_stock_count(object(), actor, uuid4())


def test_branch_manager_can_reach_inventory_controls(monkeypatch) -> None:
    actor = principal(BRANCH_MANAGER, {"inventory.adjust", "inventory.transfer"})
    use_principal(actor)
    monkeypatch.setattr(transfer_service, "list_transfers", lambda *args, **kwargs: [])
    monkeypatch.setattr(
        stocktake_service, "list_stock_counts", lambda *args, **kwargs: []
    )
    client = TestClient(app)
    params = {"branch_id": str(actor.branch_id)}
    assert (
        client.get("/api/v1/staff/inventory/transfers", params=params).status_code
        == 200
    )
    assert (
        client.get("/api/v1/staff/inventory/stock-counts", params=params).status_code
        == 200
    )
