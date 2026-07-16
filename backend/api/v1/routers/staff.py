from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status

from backend.api.dependencies import DatabaseSession, require_permission
from backend.schemas.user_schemas import (
    AssignableRoleResponse,
    PermissionResponse,
    RoleCreate,
    RoleResponse,
    RoleUpdate,
    UserCreate,
    UserResponse,
    UserUpdate,
)
from backend.services import staff as staff_service
from backend.services.auth import AuthPrincipal

router = APIRouter(tags=["staff-management"])
ManageStaffPrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("staff.manage"))
]


@router.get("/roles", response_model=list[AssignableRoleResponse])
def list_assignable_roles(
    principal: ManageStaffPrincipal, db: DatabaseSession
) -> list[AssignableRoleResponse]:
    return [
        AssignableRoleResponse.model_validate(role)
        for role in staff_service.list_assignable_roles(db, principal)
    ]


@router.get("/permissions", response_model=list[PermissionResponse])
def list_permissions(
    principal: ManageStaffPrincipal, db: DatabaseSession
) -> list[PermissionResponse]:
    return [
        PermissionResponse.model_validate(permission)
        for permission in staff_service.list_permissions(db, principal)
    ]


@router.get("/roles/manage", response_model=list[RoleResponse])
def list_roles(
    principal: ManageStaffPrincipal, db: DatabaseSession
) -> list[RoleResponse]:
    return staff_service.list_roles(db, principal)


@router.post("/roles", response_model=RoleResponse, status_code=status.HTTP_201_CREATED)
def create_role(
    payload: RoleCreate,
    principal: ManageStaffPrincipal,
    db: DatabaseSession,
) -> RoleResponse:
    role = staff_service.create_role(db, principal, payload)
    db.commit()
    return role


@router.patch("/roles/{role_id}", response_model=RoleResponse)
def update_role(
    role_id: UUID,
    payload: RoleUpdate,
    principal: ManageStaffPrincipal,
    db: DatabaseSession,
) -> RoleResponse:
    role = staff_service.update_role(db, principal, role_id, payload)
    db.commit()
    return role


@router.get("/users", response_model=list[UserResponse])
def list_staff_users(
    principal: ManageStaffPrincipal, db: DatabaseSession
) -> list[UserResponse]:
    return [
        UserResponse.model_validate(user)
        for user in staff_service.list_staff(db, principal)
    ]


@router.get("/users/{user_id}", response_model=UserResponse)
def get_staff_user(
    user_id: UUID,
    principal: ManageStaffPrincipal,
    db: DatabaseSession,
) -> UserResponse:
    return UserResponse.model_validate(
        staff_service.get_staff_user(db, principal, user_id)
    )


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_staff_user(
    payload: UserCreate,
    principal: ManageStaffPrincipal,
    db: DatabaseSession,
) -> UserResponse:
    user = staff_service.create_staff_user(db, principal, payload)
    db.commit()
    return UserResponse.model_validate(user)


@router.patch("/users/{user_id}", response_model=UserResponse)
def update_staff_user(
    user_id: UUID,
    payload: UserUpdate,
    principal: ManageStaffPrincipal,
    db: DatabaseSession,
) -> UserResponse:
    user = staff_service.update_staff_user(db, principal, user_id, payload)
    db.commit()
    return UserResponse.model_validate(user)
