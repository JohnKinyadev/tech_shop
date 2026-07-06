from backend.models.database import SessionLocal
from backend.services.bootstrap import seed_system_access


def main() -> None:
    with SessionLocal() as db:
        result = seed_system_access(db)
        db.commit()
    print(f"Seeded {result.permissions} permissions and {result.roles} roles.")


if __name__ == "__main__":
    main()
