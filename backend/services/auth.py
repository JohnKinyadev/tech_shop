from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.security import (
    InvalidTokenError,
    TokenType,
    create_token,
    decode_token,
    hash_password,
    password_fingerprint,
    verify_password,
)
from backend.models.audit import AuditLog
from backend.models.permissions import Permission
from backend.models.roles import Role, RolePermission
from backend.models.users import User


class AuthenticationError(ValueError):
    pass


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int


@dataclass(frozen=True)
class AuthPrincipal:
    user_id: UUID
    full_name: str
    username: str
    email: str
    branch_id: UUID | None
    role_id: UUID
    role_code: str
    role_name: str
    permissions: frozenset[str]
    password_hash: str
    must_change_password: bool


def _principal_for_user(db: Session, user: User) -> AuthPrincipal:
    role = db.scalar(
        select(Role).where(
            Role.id == user.role_id,
            Role.is_active.is_(True),
            Role.is_deleted.is_(False),
        )
    )
    if role is None:
        raise AuthenticationError("account role is unavailable")

    permissions = frozenset(
        db.scalars(
            select(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(
                RolePermission.role_id == role.id,
                Permission.is_deleted.is_(False),
            )
        ).all()
    )
    return AuthPrincipal(
        user_id=user.id,
        full_name=user.full_name,
        username=user.username,
        email=user.email,
        branch_id=user.branch_id,
        role_id=role.id,
        role_code=role.code,
        role_name=role.name,
        permissions=permissions,
        password_hash=user.password_hash,
        must_change_password=user.must_change_password,
    )


def get_principal(db: Session, user_id: UUID) -> AuthPrincipal:
    user = db.scalar(
        select(User).where(
            User.id == user_id,
            User.is_active.is_(True),
            User.is_deleted.is_(False),
        )
    )
    if user is None:
        raise AuthenticationError("account is unavailable")
    return _principal_for_user(db, user)


def issue_token_pair(principal: AuthPrincipal) -> TokenPair:
    return TokenPair(
        access_token=create_token(principal.user_id, principal.password_hash, "access"),
        refresh_token=create_token(
            principal.user_id, principal.password_hash, "refresh"
        ),
        expires_in=settings.access_token_minutes * 60,
    )


def authenticate(db: Session, identifier: str, password: str) -> TokenPair:
    normalized = identifier.strip().lower()
    user = db.scalar(
        select(User).where(
            or_(
                func.lower(User.username) == normalized,
                func.lower(User.email) == normalized,
            ),
            User.is_active.is_(True),
            User.is_deleted.is_(False),
        )
    )
    if user is None or not verify_password(password, user.password_hash):
        raise AuthenticationError("invalid username or password")
    return issue_token_pair(_principal_for_user(db, user))


def principal_from_token(
    db: Session, token: str, token_type: TokenType = "access"
) -> AuthPrincipal:
    try:
        claims = decode_token(token, token_type)
    except InvalidTokenError as exc:
        raise AuthenticationError("invalid or expired token") from exc

    principal = get_principal(db, claims.user_id)
    if claims.password_fingerprint != password_fingerprint(principal.password_hash):
        raise AuthenticationError("token has been invalidated")
    return principal


def refresh_tokens(db: Session, refresh_token: str) -> TokenPair:
    return issue_token_pair(principal_from_token(db, refresh_token, "refresh"))


def change_password(
    db: Session,
    principal: AuthPrincipal,
    current_password: str,
    new_password: str,
) -> None:
    user = db.get(User, principal.user_id)
    if user is None or not verify_password(current_password, user.password_hash):
        raise AuthenticationError("current password is incorrect")
    if verify_password(new_password, user.password_hash):
        raise AuthenticationError("new password must be different")

    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    db.add(
        AuditLog(
            actor_id=user.id,
            branch_id=user.branch_id,
            action="auth.password_changed",
            resource_type="user",
            resource_id=user.id,
        )
    )
