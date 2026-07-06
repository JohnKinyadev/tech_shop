from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.api.dependencies import get_current_principal
from backend.core.permissions import CASHIER, INVENTORY_MANAGER
from backend.main import app
from backend.models.database import get_db
from backend.models.enums import TrackingType
from backend.services import purchasing as purchasing_service
from backend.services import suppliers as supplier_service
from backend.services.auth import AuthPrincipal
from backend.services.exceptions import ConflictError, ValidationError
from backend.services.inventory import (
    validate_receipt_identifiers,
    weighted_average_cost,
)
from backend.services.purchasing import calculate_item_amounts


def principal(role_code: str, permissions: set[str]) -> AuthPrincipal:
    return AuthPrincipal(
        user_id=uuid4(),
        full_name="Purchasing User",
        username="purchasing-user",
        email="purchasing@example.com",
        branch_id=uuid4(),
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


def test_purchase_item_amounts_are_calculated_with_tax() -> None:
    subtotal, tax, total = calculate_item_amounts(
        2, Decimal("100.00"), Decimal("16.00")
    )
    assert subtotal == Decimal("200.00")
    assert tax == Decimal("32.00")
    assert total == Decimal("232.00")


def test_weighted_average_cost_uses_existing_and_incoming_stock() -> None:
    result = weighted_average_cost(10, Decimal("100.00"), 5, Decimal("130.00"))
    assert result == Decimal("110.00")


def test_bulk_receipts_reject_serial_identifiers() -> None:
    with pytest.raises(ValidationError):
        validate_receipt_identifiers(TrackingType.BULK, 1, ["SER-1"], [])


def test_serial_receipts_require_one_serial_per_unit() -> None:
    with pytest.raises(ValidationError):
        validate_receipt_identifiers(TrackingType.SERIAL, 2, ["SER-1"], [])
    serials, imeis = validate_receipt_identifiers(
        TrackingType.SERIAL, 2, ["SER-1", "SER-2"], []
    )
    assert serials == ["SER-1", "SER-2"]
    assert imeis == []


def test_imei_receipts_require_unique_fifteen_digit_values() -> None:
    with pytest.raises(ValidationError):
        validate_receipt_identifiers(TrackingType.IMEI, 1, [], ["123"])
    with pytest.raises(ConflictError):
        validate_receipt_identifiers(
            TrackingType.IMEI,
            2,
            [],
            ["123456789012345", "123456789012345"],
        )


def test_purchasing_routes_are_exposed() -> None:
    paths = app.openapi()["paths"]
    assert "/api/v1/staff/suppliers" in paths
    assert "/api/v1/staff/purchases" in paths
    assert "/api/v1/staff/purchases/{order_id}/submit" in paths
    assert "/api/v1/staff/purchases/{order_id}/approve" in paths
    assert "/api/v1/staff/purchases/{order_id}/receipts" in paths


def test_cashier_cannot_access_purchasing() -> None:
    use_principal(principal(CASHIER, {"sales.process"}))
    assert TestClient(app).get("/api/v1/staff/purchases").status_code == 403


def test_inventory_manager_can_read_suppliers_and_orders(monkeypatch) -> None:
    use_principal(
        principal(
            INVENTORY_MANAGER,
            {"purchases.create", "purchases.approve", "purchases.receive"},
        )
    )
    monkeypatch.setattr(supplier_service, "list_suppliers", lambda *args, **kwargs: [])
    monkeypatch.setattr(
        purchasing_service, "list_purchase_orders", lambda *args, **kwargs: ([], 0)
    )
    client = TestClient(app)
    assert client.get("/api/v1/staff/suppliers").status_code == 200
    orders = client.get("/api/v1/staff/purchases")
    assert orders.status_code == 200
    assert orders.json()["total"] == 0
