import argparse

from backend.models.database import SessionLocal
from backend.services.demo_seed import DEMO_PASSWORD, seed_demo_data


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Seed sample data across the staff API modules."
    )
    parser.add_argument(
        "--password",
        default=DEMO_PASSWORD,
        help="Password to set for all seeded staff users.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if len(args.password) < 8:
        raise SystemExit("Seeded password must contain at least 8 characters.")

    with SessionLocal() as db:
        try:
            result = seed_demo_data(db, password=args.password)
            db.commit()
        except Exception:
            db.rollback()
            raise

    print("Sample data seed complete.")
    print(f"Seeded password: {args.password}")
    print("Users:")
    for role, username in sorted(result.users.items()):
        print(f"  {role}: {username}")
    print("Branches:")
    for code, branch_id in sorted(result.branches.items()):
        print(f"  {code}: {branch_id}")
    if result.ids:
        print("Useful IDs:")
        for key, value in sorted(result.ids.items()):
            print(f"  {key}: {value}")
    if result.created:
        print("Created:")
        for key, value in sorted(result.created.items()):
            print(f"  {key}: {value}")
    if result.skipped:
        print("Skipped:")
        for item in result.skipped:
            print(f"  - {item}")


if __name__ == "__main__":
    main()
