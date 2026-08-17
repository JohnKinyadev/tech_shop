from types import SimpleNamespace
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.api.dependencies import get_current_principal
from backend.core.permissions import CASHIER, INVENTORY_MANAGER, TECHNICIAN
from backend.main import app
from backend.models.database import get_db
from backend.models.enums import RepairStatus
from backend.schemas.repair_schemas import (
    RepairDiagnosisUpdate,
    RepairPartCreate,
    RepairPartView,
    RepairQuoteDecision,
)
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
    assert "/api/v1/staff/repairs/{ticket_id}/available-parts" in paths
    assert "/api/v1/staff/repairs/{ticket_id}/diagnosis" in paths
    assert "/api/v1/staff/repairs/{ticket_id}/parts" in paths
    assert "/api/v1/staff/repairs/{ticket_id}/ready" in paths
    assert "/api/v1/staff/repairs/pickups" in paths
    assert "/api/v1/staff/repairs/technicians" in paths
    assert "/api/v1/staff/repairs/{ticket_id}/invoice" in paths
    assert "/api/v1/staff/repairs/{ticket_id}/payments" in paths
    assert "/api/v1/staff/repairs/{ticket_id}/mpesa/stk-push" in paths
    assert "/api/v1/staff/repairs/{ticket_id}/mpesa/manual-confirm" in paths
    assert "/api/v1/staff/repairs/{ticket_id}/collect" in paths


def test_cashier_can_list_repair_reception_queue(monkeypatch) -> None:
    actor = principal(CASHIER, {"sales.process"})
    use_principal(actor)
    monkeypatch.setattr(repair_service, "list_tickets", lambda *args, **kwargs: ([], 0))
    response = TestClient(app).get(
        "/api/v1/staff/repairs",
        params={"branch_id": str(actor.branch_id)},
    )
    assert response.status_code == 200
    assert response.json()["items"] == []


def test_cashier_can_list_ready_repair_pickups(monkeypatch) -> None:
    actor = principal(CASHIER, {"sales.process"})
    use_principal(actor)
    monkeypatch.setattr(repair_billing, "list_ready_pickups", lambda *args, **kwargs: [])
    response = TestClient(app).get(
        "/api/v1/staff/repairs/pickups",
        params={"branch_id": str(actor.branch_id)},
    )
    assert response.status_code == 200
    assert response.json() == []


def test_cashier_can_list_branch_repair_technicians(monkeypatch) -> None:
    actor = principal(CASHIER, {"sales.process"})
    use_principal(actor)
    monkeypatch.setattr(
        repair_service, "list_branch_technicians", lambda *args, **kwargs: []
    )
    response = TestClient(app).get(
        "/api/v1/staff/repairs/technicians",
        params={"branch_id": str(actor.branch_id)},
    )
    assert response.status_code == 200
    assert response.json() == []


def test_cashier_can_assign_repair_to_technician(monkeypatch) -> None:
    actor = principal(CASHIER, {"sales.process"})
    technician_id = uuid4()
    use_principal(actor)
    app.dependency_overrides[get_db] = lambda: SimpleNamespace(commit=lambda: None)

    def fake_assign(db, principal, ticket_id, payload):
        now = datetime.now(timezone.utc)
        assert principal == actor
        assert payload.technician_id == technician_id
        return {
            "id": ticket_id,
            "created_at": now,
            "updated_at": now,
            "is_deleted": False,
            "ticket_number": "REP-0001",
            "branch_id": actor.branch_id,
            "customer_id": uuid4(),
            "technician_id": technician_id,
            "serialized_unit_id": None,
            "status": "received",
            "device_type": "Phone",
            "device_brand": "Samsung",
            "device_model": "A15",
            "serial_number": None,
            "imei": None,
            "reported_issue": "Screen is cracked",
            "diagnosis": None,
            "intake_condition": "Cracked screen",
            "intake_images": [],
            "accessories_received": [],
            "labor_estimate": "0.00",
            "parts_estimate": "0.00",
            "approved_at": None,
            "booked_for": None,
            "received_at": now,
            "ready_at": None,
            "collected_at": None,
            "parts": [],
            "status_history": [],
        }

    monkeypatch.setattr(repair_service, "assign_technician", fake_assign)
    response = TestClient(app).patch(
        f"/api/v1/staff/repairs/{uuid4()}/assignment",
        json={"technician_id": str(technician_id)},
    )
    assert response.status_code == 200
    assert response.json()["technician_id"] == str(technician_id)


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


def test_technician_can_list_available_parts_for_ticket(monkeypatch) -> None:
    actor = principal(TECHNICIAN, {"repairs.update"})
    ticket_id = uuid4()
    use_principal(actor)

    def fake_parts(db, principal, received_ticket_id, **kwargs):
        assert principal == actor
        assert received_ticket_id == ticket_id
        assert kwargs["page"] == 1
        return (
            [
                {
                    "product_id": uuid4(),
                    "product_name": "Galaxy A15 Screen",
                    "variant_id": uuid4(),
                    "variant_name": "Replacement LCD",
                    "sku": "LCD-A15",
                    "tracking_type": "bulk",
                    "selling_price": "4500.00",
                    "available_quantity": 3,
                    "serialized_units": [],
                }
            ],
            1,
        )

    monkeypatch.setattr(repair_service, "list_available_parts", fake_parts)
    response = TestClient(app).get(
        f"/api/v1/staff/repairs/{ticket_id}/available-parts",
        params={"query": "screen"},
    )
    assert response.status_code == 200
    assert response.json()["items"][0]["available_quantity"] == 3


def test_technician_cannot_access_an_unassigned_ticket() -> None:
    actor = principal(TECHNICIAN, {"repairs.view"})
    ticket = SimpleNamespace(branch_id=actor.branch_id, technician_id=uuid4())
    with pytest.raises(AuthorizationError):
        repair_service._enforce_ticket_scope(actor, ticket)


def test_repair_part_input_does_not_accept_pricing_authority() -> None:
    assert "unit_price" not in RepairPartCreate.model_fields
    assert "unit_cost" not in RepairPartView.model_fields


def test_only_assigned_technician_role_can_submit_repair_quote() -> None:
    actor = principal(CASHIER, {"repairs.update"})
    with pytest.raises(AuthorizationError, match="assigned technician"):
        repair_service.submit_diagnosis(
            SimpleNamespace(),
            actor,
            uuid4(),
            RepairDiagnosisUpdate(
                diagnosis="Needs new screen",
                labor_estimate="1200.00",
                parts_estimate="3500.00",
            ),
        )


def test_technician_cannot_record_customer_quote_decision() -> None:
    actor = principal(
        TECHNICIAN,
        {"repairs.view", "repairs.update", "repairs.quote.approve", "sales.process"},
    )
    with pytest.raises(AuthorizationError, match="technicians cannot approve"):
        repair_service.decide_quote(
            SimpleNamespace(),
            actor,
            uuid4(),
            RepairQuoteDecision(approved=True, note="Customer approved"),
        )


def test_assigned_technician_can_edit_pending_quote(monkeypatch) -> None:
    actor = principal(TECHNICIAN, {"repairs.update"})
    ticket_id = uuid4()
    ticket = SimpleNamespace(
        id=ticket_id,
        branch_id=actor.branch_id,
        technician_id=actor.user_id,
        status=RepairStatus.QUOTE_PENDING,
        diagnosis="Old diagnosis",
        labor_estimate="1000.00",
        parts_estimate="2000.00",
    )
    history = []

    def fake_get_ticket_model(db, principal, received_ticket_id, **kwargs):
        assert principal == actor
        assert received_ticket_id == ticket_id
        return ticket

    monkeypatch.setattr(repair_service, "get_ticket_model", fake_get_ticket_model)
    monkeypatch.setattr(repair_service, "_ticket_response", lambda db, item: item)

    result = repair_service.submit_diagnosis(
        SimpleNamespace(add=history.append, flush=lambda: None),
        actor,
        ticket_id,
        RepairDiagnosisUpdate(
            diagnosis="Updated screen and charging port quote",
            labor_estimate="1800.00",
            parts_estimate="4200.00",
        ),
    )

    assert result is ticket
    assert ticket.status == RepairStatus.QUOTE_PENDING
    assert ticket.diagnosis == "Updated screen and charging port quote"
    assert str(ticket.labor_estimate) == "1800.00"
    assert str(ticket.parts_estimate) == "4200.00"
    assert history[-1].note == "Technician updated diagnosis and quote"


def test_cashier_quote_decision_uses_front_desk_permission(monkeypatch) -> None:
    actor = principal(CASHIER, {"repairs.quote.approve"})
    ticket_id = uuid4()
    ticket = SimpleNamespace(
        id=ticket_id,
        branch_id=actor.branch_id,
        technician_id=uuid4(),
        status=RepairStatus.QUOTE_PENDING,
        approved_at=None,
    )
    calls = {}

    def fake_get_ticket_model(db, principal, received_ticket_id, **kwargs):
        calls["any_permission"] = kwargs.get("any_permission")
        assert principal == actor
        assert received_ticket_id == ticket_id
        return ticket

    monkeypatch.setattr(repair_service, "get_ticket_model", fake_get_ticket_model)
    monkeypatch.setattr(repair_service, "_ticket_response", lambda db, item: item)

    result = repair_service.decide_quote(
        SimpleNamespace(add=lambda item: None, flush=lambda: None),
        actor,
        ticket_id,
        RepairQuoteDecision(approved=True, note="Customer approved by phone"),
    )

    assert result is ticket
    assert ticket.status == RepairStatus.CUSTOMER_APPROVED
    assert ticket.approved_at is not None
    assert calls["any_permission"] == ("repairs.quote.approve", "sales.process")


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
