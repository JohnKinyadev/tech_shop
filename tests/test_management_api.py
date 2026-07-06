from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError as PydanticValidationError

from backend.api.dependencies import get_current_principal
from backend.core.permissions import ADMIN, BRANCH_MANAGER, CASHIER
from backend.main import app
from backend.models.database import get_db
from backend.schemas.branch_schemas import BranchUpdate
from backend.schemas.user_schemas import UserUpdate
from backend.services import staff as staff_service
from backend.services.auth import AuthPrincipal
from backend.services.exceptions import ConflictError, NotFoundError


def principal(role_code: str, permissions: set[str], branch_id=None) -> AuthPrincipal:
    return AuthPrincipal(
        user_id=uuid4(),
        full_name="Test User",
        username="test-user",
        email="test@example.com",
        branch_id=branch_id,
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


def test_management_routes_are_exposed_from_versioned_router() -> None:
    paths = app.openapi()["paths"]
    assert "/api/v1/staff/branches" in paths
    assert "/api/v1/staff/branches/{branch_id}" in paths
    assert "/api/v1/staff/roles" in paths
    assert "/api/v1/staff/users" in paths
    assert "/api/v1/staff/users/{user_id}" in paths


def test_cashier_cannot_access_staff_management() -> None:
    use_principal(principal(CASHIER, {"sales.process"}, uuid4()))
    response = TestClient(app).get("/api/v1/staff/users")
    assert response.status_code == 403


def test_branch_manager_cannot_create_branches() -> None:
    use_principal(principal(BRANCH_MANAGER, {"staff.manage"}, uuid4()))
    response = TestClient(app).post(
        "/api/v1/staff/branches",
        json={"name": "Second Branch", "code": "BR2"},
    )
    assert response.status_code == 403


def test_branch_manager_can_list_manageable_staff(monkeypatch) -> None:
    use_principal(principal(BRANCH_MANAGER, {"staff.manage"}, uuid4()))
    monkeypatch.setattr(staff_service, "list_staff", lambda db, actor: [])
    response = TestClient(app).get("/api/v1/staff/users")
    assert response.status_code == 200
    assert response.json() == []


def test_service_errors_are_mapped_to_http_responses(monkeypatch) -> None:
    use_principal(principal(ADMIN, set()))

    def missing_user(db, actor, user_id):
        raise NotFoundError("staff user not found")

    monkeypatch.setattr(staff_service, "get_staff_user", missing_user)
    response = TestClient(app).get(f"/api/v1/staff/users/{uuid4()}")
    assert response.status_code == 404
    assert response.json() == {"detail": "staff user not found"}


def test_update_schemas_reject_null_for_non_nullable_columns() -> None:
    with pytest.raises(PydanticValidationError):
        UserUpdate(role_id=None)
    with pytest.raises(PydanticValidationError):
        BranchUpdate(status=None)


def test_final_active_admin_is_protected() -> None:
    user = SimpleNamespace(is_active=True)
    role = SimpleNamespace(code=ADMIN)
    db = SimpleNamespace(scalar=lambda statement: 1)
    with pytest.raises(ConflictError):
        staff_service._ensure_not_final_admin(db, user, role)
