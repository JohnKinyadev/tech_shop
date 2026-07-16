from uuid import UUID

from backend.core.permissions import ADMIN, ASSIGNABLE_ROLES, BRANCH_MANAGER
from backend.services.auth import AuthPrincipal


class AuthorizationError(PermissionError):
    pass


def enforce_permission(principal: AuthPrincipal, permission_code: str) -> None:
    if principal.role_code != ADMIN and permission_code not in principal.permissions:
        raise AuthorizationError(f"missing permission: {permission_code}")


def enforce_branch_scope(principal: AuthPrincipal, branch_id: UUID) -> None:
    if principal.role_code == ADMIN:
        return
    if principal.branch_id is None or principal.branch_id != branch_id:
        raise AuthorizationError("resource is outside the user's branch")


def enforce_role_assignment(
    principal: AuthPrincipal,
    target_role_code: str,
    target_branch_id: UUID | None,
) -> None:
    if principal.role_code == ADMIN:
        if target_role_code != ADMIN and target_branch_id is None:
            raise AuthorizationError("branch-scoped staff require a branch")
        return

    allowed_roles = ASSIGNABLE_ROLES.get(principal.role_code, frozenset())
    if target_role_code not in allowed_roles:
        raise AuthorizationError("this role cannot assign the requested role")

    if target_role_code != ADMIN and target_branch_id is None:
        raise AuthorizationError("branch-scoped staff require a branch")

    if principal.role_code == BRANCH_MANAGER:
        if principal.branch_id is None or target_branch_id != principal.branch_id:
            raise AuthorizationError("branch managers can only manage their own branch")
