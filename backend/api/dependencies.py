from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from backend.models.database import get_db
from backend.services.auth import (
    AuthenticationError,
    AuthPrincipal,
    principal_from_token,
)
from backend.services.authorization import AuthorizationError, enforce_permission

bearer_scheme = HTTPBearer(auto_error=False)
DatabaseSession = Annotated[Session, Depends(get_db)]


def get_current_principal(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: DatabaseSession,
) -> AuthPrincipal:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return principal_from_token(db, credentials.credentials)
    except AuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


CurrentPrincipal = Annotated[AuthPrincipal, Depends(get_current_principal)]


def require_permission(
    permission_code: str,
) -> Callable[[CurrentPrincipal], AuthPrincipal]:
    def dependency(principal: CurrentPrincipal) -> AuthPrincipal:
        try:
            enforce_permission(principal, permission_code)
        except AuthorizationError as exc:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)
            ) from exc
        return principal

    return dependency
