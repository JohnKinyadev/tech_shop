from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, status

from backend.api.dependencies import (
    CurrentPrincipal,
    DatabaseSession,
    require_permission,
)
from backend.schemas.branch_schemas import BranchCreate, BranchResponse, BranchUpdate
from backend.services import branches as branch_service
from backend.services.auth import AuthPrincipal

router = APIRouter(prefix="/branches", tags=["staff-branches"])
ManageBranchesPrincipal = Annotated[
    AuthPrincipal, Depends(require_permission("branches.manage"))
]


@router.get("", response_model=list[BranchResponse])
def list_branches(
    principal: CurrentPrincipal, db: DatabaseSession
) -> list[BranchResponse]:
    return [
        BranchResponse.model_validate(branch)
        for branch in branch_service.list_branches(db, principal)
    ]


@router.get("/{branch_id}", response_model=BranchResponse)
def get_branch(
    branch_id: UUID,
    principal: CurrentPrincipal,
    db: DatabaseSession,
) -> BranchResponse:
    return BranchResponse.model_validate(
        branch_service.get_branch(db, principal, branch_id)
    )


@router.post("", response_model=BranchResponse, status_code=status.HTTP_201_CREATED)
def create_branch(
    payload: BranchCreate,
    principal: ManageBranchesPrincipal,
    db: DatabaseSession,
) -> BranchResponse:
    branch = branch_service.create_branch(db, principal, payload)
    db.commit()
    return BranchResponse.model_validate(branch)


@router.patch("/{branch_id}", response_model=BranchResponse)
def update_branch(
    branch_id: UUID,
    payload: BranchUpdate,
    principal: ManageBranchesPrincipal,
    db: DatabaseSession,
) -> BranchResponse:
    branch = branch_service.update_branch(db, principal, branch_id, payload)
    db.commit()
    return BranchResponse.model_validate(branch)
