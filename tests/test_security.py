from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from backend.core.security import (
    InvalidTokenError,
    create_token,
    decode_token,
    hash_password,
    password_fingerprint,
    verify_password,
)


def test_password_hashing_and_verification() -> None:
    hashed = hash_password("Strong-password-1977")
    assert hashed != "Strong-password-1977"
    assert verify_password("Strong-password-1977", hashed)
    assert not verify_password("wrong-password", hashed)


def test_access_and_refresh_tokens_are_not_interchangeable() -> None:
    user_id = uuid4()
    hashed = hash_password("Strong-password-1977")
    access_token = create_token(user_id, hashed, "access")

    claims = decode_token(access_token, "access")
    assert claims.user_id == user_id
    assert claims.password_fingerprint == password_fingerprint(hashed)
    with pytest.raises(InvalidTokenError):
        decode_token(access_token, "refresh")


def test_expired_token_is_rejected() -> None:
    issued_at = datetime.now(timezone.utc) - timedelta(days=1)
    token = create_token(
        uuid4(), hash_password("Strong-password-1977"), "access", now=issued_at
    )
    with pytest.raises(InvalidTokenError):
        decode_token(token, "access")
