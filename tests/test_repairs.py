from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.api.dependencies import get_current_principal
from backend.core.permissions import CASHIER, INVENTORY_MANAGER, TECHNICIAN
from backend.main import app
from backend.models.database import get_db
from backend.models.enums import RepairStatus
from backend.schemas.repair_schemas import RepairPartCreate, RepairPartView
from backend.services import repair_billing
from backend.services import repairs as repair_service
from backend.services.auth import AuthPrincipal
from backend.services.authorization import AuthorizationError


def principal(role_code: str, permissions: set[str], branch_id=None) -> AuthPrincipal:
    return AuthPrincipal(
        user_id=uuid4(),
        full_name="Repair User",
        username="repair-user",
        email="repair@example.com",
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


def test_repair_routes_are_exposed() -> None:
    paths = app.openapi()["paths"]
    assert "/api/v1/staff/repairs" in paths
    assert "/api/v1/staff/repairs/{ticket_id}/intake" in paths
    assert "/api/v1/staff/repairs/{ticket_id}/assignment" in paths
    assert "/api/v1/staff/repairs/{ticket_id}/diagnosis" in paths
    assert "/api/v1/staff/repairs/{ticket_id}/parts" in paths
    assert "/api/v1/staff/repairs/{ticket_id}/ready" in paths
    assert "/api/v1/staff/repairs/{ticket_id}/invoice" in paths
    assert "/api/v1/staff/repairs/{ticket_id}/payments" in paths
    assert "/api/v1/staff/repairs/{ticket_id}/collect" in paths


def test_cashier_cannot_list_repair_tickets() -> None:
    actor = principal(CASHIER, {"sales.process"})
    use_principal(actor)
    response = TestClient(app).get(
        "/api/v1/staff/repairs",
        params={"branch_id": str(actor.branch_id)},
    )
    assert response.status_code == 403


def test_inventory_manager_cannot_access_repairs() -> None:
    actor = principal(INVENTORY_MANAGER, {"inventory.view"})
    use_principal(actor)
    response = TestClient(app).get(
        "/api/v1/staff/repairs",
        params={"branch_id": str(actor.branch_id)},
    )
    assert response.status_code == 403


def test_technician_can_list_assigned_repair_scope(monkeypatch) -> None:
    actor = principal(TECHNICIAN, {"repairs.view", "repairs.update"})
    use_principal(actor)
    monkeypatch.setattr(repair_service, "list_tickets", lambda *args, **kwargs: ([], 0))
    response = TestClient(app).get(
        "/api/v1/staff/repairs",
        params={"branch_id": str(actor.branch_id)},
    )
    assert response.status_code == 200
    assert response.json()["items"] == []


def test_technician_cannot_access_an_unassigned_ticket() -> None:
    actor = principal(TECHNICIAN, {"repairs.view"})
    ticket = SimpleNamespace(branch_id=actor.branch_id, technician_id=uuid4())
    with pytest.raises(AuthorizationError):
        repair_service._enforce_ticket_scope(actor, ticket)


def test_repair_part_input_does_not_accept_pricing_authority() -> None:
    assert "unit_price" not in RepairPartCreate.model_fields
    assert "unit_cost" not in RepairPartView.model_fields


def test_repair_status_transitions_are_explicit() -> None:
    assert repair_service.ALLOWED_TRANSITIONS[RepairStatus.RECEIVED] == {
        RepairStatus.DIAGNOSING
    }
    assert RepairStatus.READY_FOR_PICKUP not in repair_service.ALLOWED_TRANSITIONS.get(
        RepairStatus.RECEIVED, set()
    )


def test_checkout_staff_can_access_repair_billing_only() -> None:
    cashier = principal(CASHIER, {"sales.process"})
    technician = principal(TECHNICIAN, {"repairs.view", "repairs.close"})
    inventory_manager = principal(INVENTORY_MANAGER, {"inventory.view"})
    assert repair_billing._can_access_billing(cashier)
    assert repair_billing._can_access_billing(technician)
    assert not repair_billing._can_access_billing(inventory_manager)
