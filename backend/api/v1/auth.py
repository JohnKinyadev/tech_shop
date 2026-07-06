from fastapi import APIRouter, HTTPException, Response, status

from backend.api.dependencies import CurrentPrincipal, DatabaseSession
from backend.schemas.auth_schemas import (
    CurrentUserResponse,
    LoginRequest,
    PasswordChangeRequest,
    TokenPairResponse,
    TokenRefreshRequest,
)
from backend.services.auth import (
    AuthenticationError,
    authenticate,
    change_password,
    refresh_tokens,
)

router = APIRouter(prefix="/auth", tags=["staff-auth"])


@router.post("/login", response_model=TokenPairResponse)
def login(payload: LoginRequest, db: DatabaseSession) -> TokenPairResponse:
    try:
        tokens = authenticate(db, payload.username, payload.password)
    except AuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    return TokenPairResponse(**tokens.__dict__)


@router.post("/refresh", response_model=TokenPairResponse)
def refresh(payload: TokenRefreshRequest, db: DatabaseSession) -> TokenPairResponse:
    try:
        tokens = refresh_tokens(db, payload.refresh_token)
    except AuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    return TokenPairResponse(**tokens.__dict__)


@router.get("/me", response_model=CurrentUserResponse)
def me(principal: CurrentPrincipal) -> CurrentUserResponse:
    return CurrentUserResponse(
        id=principal.user_id,
        full_name=principal.full_name,
        username=principal.username,
        email=principal.email,
        branch_id=principal.branch_id,
        role_code=principal.role_code,
        role_name=principal.role_name,
        permissions=sorted(principal.permissions),
        must_change_password=principal.must_change_password,
    )


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def update_password(
    payload: PasswordChangeRequest,
    principal: CurrentPrincipal,
    db: DatabaseSession,
) -> Response:
    try:
        change_password(
            db,
            principal,
            payload.current_password,
            payload.new_password,
        )
        db.commit()
    except AuthenticationError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
