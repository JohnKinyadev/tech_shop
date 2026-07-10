from fastapi.testclient import TestClient

from backend.main import app


def test_health_endpoint_reports_environment() -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_db_health_endpoint_uses_database_session(monkeypatch) -> None:
    executed: list[str] = []

    class FakeSession:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, statement):
            executed.append(str(statement))

    monkeypatch.setattr("backend.main.SessionLocal", lambda: FakeSession())
    response = TestClient(app).get("/health/db")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "reachable"}
    assert executed == ["SELECT 1"]
