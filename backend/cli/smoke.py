import argparse
from collections.abc import Callable
from dataclasses import dataclass
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select, text

from backend.main import app
from backend.models.branch import Branch
from backend.models.database import SessionLocal
from backend.services.demo_seed import DEMO_PASSWORD


@dataclass(frozen=True)
class SmokeStep:
    name: str
    check: Callable[[], None]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a read-only smoke check against the configured backend DB."
    )
    parser.add_argument("--password", default=DEMO_PASSWORD)
    parser.add_argument("--admin-username", default="admin1")
    parser.add_argument("--cashier-username", default="cashier1")
    return parser


def _token(client: TestClient, username: str, password: str) -> str:
    response = client.post(
        "/api/v1/staff/auth/login",
        json={"username": username, "password": password},
    )
    if response.status_code != 200:
        raise RuntimeError(
            f"login failed for {username!r}; run `python -m backend.cli.seed_demo` "
            "or check the seeded password"
        )
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _hq_branch_id() -> UUID:
    with SessionLocal() as db:
        branch_id = db.scalar(
            select(Branch.id).where(Branch.code == "HQ", Branch.is_deleted.is_(False))
        )
    if branch_id is None:
        raise RuntimeError("HQ branch was not found; run `python -m backend.cli.seed_demo`")
    return branch_id


def _expect_ok(response, label: str) -> None:
    if response.status_code != 200:
        raise RuntimeError(f"{label} returned HTTP {response.status_code}: {response.text}")


def main() -> None:
    args = build_parser().parse_args()
    client = TestClient(app)
    state: dict[str, str | UUID] = {}

    def db_ping() -> None:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))

    def public_health() -> None:
        _expect_ok(client.get("/health"), "GET /health")
        _expect_ok(client.get("/health/db"), "GET /health/db")

    def login_admin() -> None:
        state["admin_token"] = _token(client, args.admin_username, args.password)
        _expect_ok(
            client.get("/api/v1/staff/auth/me", headers=_auth(state["admin_token"])),
            "GET /auth/me",
        )

    def login_cashier() -> None:
        state["cashier_token"] = _token(client, args.cashier_username, args.password)

    def branch_and_catalog() -> None:
        state["branch_id"] = _hq_branch_id()
        headers = _auth(state["admin_token"])
        _expect_ok(client.get("/api/v1/staff/branches", headers=headers), "branches")
        _expect_ok(
            client.get(
                "/api/v1/staff/catalog/products",
                headers=headers,
                params={"q": "demo", "page": 1, "page_size": 10},
            ),
            "catalog products",
        )

    def inventory_and_pos() -> None:
        admin_headers = _auth(state["admin_token"])
        cashier_headers = _auth(state["cashier_token"])
        branch_id = state["branch_id"]
        _expect_ok(
            client.get(
                "/api/v1/staff/inventory/balances",
                headers=admin_headers,
                params={"branch_id": str(branch_id)},
            ),
            "inventory balances",
        )
        _expect_ok(
            client.get(
                "/api/v1/staff/pos/sales",
                headers=cashier_headers,
                params={"branch_id": str(branch_id)},
            ),
            "POS sales",
        )

    def repairs_expenses_reports() -> None:
        headers = _auth(state["admin_token"])
        branch_id = state["branch_id"]
        _expect_ok(
            client.get(
                "/api/v1/staff/repairs",
                headers=headers,
                params={"branch_id": str(branch_id)},
            ),
            "repairs",
        )
        _expect_ok(
            client.get(
                "/api/v1/staff/expenses",
                headers=headers,
                params={"branch_id": str(branch_id)},
            ),
            "expenses",
        )
        _expect_ok(
            client.get(
                "/api/v1/staff/reports/dashboard",
                headers=headers,
                params={"branch_id": str(branch_id)},
            ),
            "dashboard report",
        )

    steps = [
        SmokeStep("database ping", db_ping),
        SmokeStep("public health", public_health),
        SmokeStep("admin login", login_admin),
        SmokeStep("cashier login", login_cashier),
        SmokeStep("branch and catalog reads", branch_and_catalog),
        SmokeStep("inventory and POS reads", inventory_and_pos),
        SmokeStep("repairs, expenses, and reports reads", repairs_expenses_reports),
    ]

    for step in steps:
        step.check()
        print(f"OK: {step.name}")
    print("Backend smoke check passed.")


if __name__ == "__main__":
    main()
