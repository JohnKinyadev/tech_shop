from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Literal
from uuid import UUID, uuid4

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from jose import JWTError, jwt

from backend.core.config import settings

TokenType = Literal["access", "refresh"]
password_hasher = PasswordHasher()


class InvalidTokenError(ValueError):
    pass


@dataclass(frozen=True)
class TokenClaims:
    user_id: UUID
    token_type: TokenType
    password_fingerprint: str


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (InvalidHashError, VerificationError):
        return False


def password_fingerprint(password_hash: str) -> str:
    return sha256(password_hash.encode("utf-8")).hexdigest()[:16]


def create_token(
    user_id: UUID,
    password_hash: str,
    token_type: TokenType,
    *,
    now: datetime | None = None,
) -> str:
    issued_at = now or datetime.now(timezone.utc)
    lifetime = (
        timedelta(minutes=settings.access_token_minutes)
        if token_type == "access"
        else timedelta(days=settings.refresh_token_days)
    )
    payload = {
        "sub": str(user_id),
        "type": token_type,
        "pwd": password_fingerprint(password_hash),
        "iat": issued_at,
        "exp": issued_at + lifetime,
        "jti": str(uuid4()),
    }
    return jwt.encode(
        payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
    )


def decode_token(token: str, expected_type: TokenType) -> TokenClaims:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
        token_type = payload.get("type")
        if token_type != expected_type:
            raise InvalidTokenError(f"expected a {expected_type} token")
        return TokenClaims(
            user_id=UUID(payload["sub"]),
            token_type=token_type,
            password_fingerprint=payload["pwd"],
        )
    except InvalidTokenError:
        raise
    except (JWTError, KeyError, TypeError, ValueError) as exc:
        raise InvalidTokenError("invalid or expired token") from exc
