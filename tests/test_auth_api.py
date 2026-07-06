from backend.main import app


def test_auth_routes_are_exposed() -> None:
    paths = app.openapi()["paths"]
    assert "/api/v1/staff/auth/login" in paths
    assert "/api/v1/staff/auth/refresh" in paths
    assert "/api/v1/staff/auth/me" in paths
    assert "/api/v1/staff/auth/change-password" in paths
