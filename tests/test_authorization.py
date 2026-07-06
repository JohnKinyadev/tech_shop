from uuid import UUID, uuid4

import pytest

from backend.core.permissions import (
    ADMIN,
    ALL_PERMISSION_CODES,
    BRANCH_MANAGER,
    CASHIER,
    PERMISSIONS,
    ROLE_DEFINITIONS,
    TECHNICIAN,
)
from backend.services.auth import AuthPrincipal
from backend.services.authorization import (
    AuthorizationError,
    enforce_branch_scope,
    enforce_permission,
    enforce_role_assignment,
)


def principal(
    role_code: str, branch_id: UUID | None, permissions: set[str]
) -> AuthPrincipal:
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


def test_permission_catalog_and_role_mappings_are_consistent() -> None:
    assert len({item.code for item in PERMISSIONS}) == len(PERMISSIONS)
    for role in ROLE_DEFINITIONS:
        assert role.permissions <= ALL_PERMISSION_CODES


def test_admin_has_global_permission_and_role_assignment_scope() -> None:
    admin = principal(ADMIN, None, set())
    enforce_permission(admin, "anything.future")
    enforce_branch_scope(admin, uuid4())
    enforce_role_assignment(admin, ADMIN, None)


def test_branch_manager_can_only_assign_cashiers_and_technicians_locally() -> None:
    branch_id = uuid4()
    manager = principal(BRANCH_MANAGER, branch_id, {"staff.manage"})
    enforce_role_assignment(manager, CASHIER, branch_id)
    enforce_role_assignment(manager, TECHNICIAN, branch_id)

    with pytest.raises(AuthorizationError):
        enforce_role_assignment(manager, ADMIN, branch_id)
    with pytest.raises(AuthorizationError):
        enforce_role_assignment(manager, CASHIER, uuid4())


def test_non_admin_cannot_cross_branch_or_invent_permissions() -> None:
    branch_id = uuid4()
    cashier = principal(CASHIER, branch_id, {"sales.process"})
    enforce_branch_scope(cashier, branch_id)
    enforce_permission(cashier, "sales.process")

    with pytest.raises(AuthorizationError):
        enforce_branch_scope(cashier, uuid4())
    with pytest.raises(AuthorizationError):
        enforce_permission(cashier, "sales.void")
