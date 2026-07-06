import argparse
from getpass import getpass

from backend.models.database import SessionLocal
from backend.services.bootstrap import BootstrapError, create_initial_admin


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create the headquarters branch and first Admin account."
    )
    parser.add_argument("--full-name", required=True)
    parser.add_argument("--username", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--branch-name", required=True)
    parser.add_argument("--branch-code", required=True)
    parser.add_argument("--country", default="Kenya")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    password = getpass("Admin password: ")
    confirmation = getpass("Confirm password: ")
    if len(password) < 8:
        raise SystemExit("Password must contain at least 8 characters.")
    if password != confirmation:
        raise SystemExit("Passwords do not match.")

    with SessionLocal() as db:
        try:
            user = create_initial_admin(
                db,
                full_name=args.full_name,
                username=args.username,
                email=args.email,
                password=password,
                branch_name=args.branch_name,
                branch_code=args.branch_code,
                country=args.country,
            )
            db.commit()
        except BootstrapError as exc:
            db.rollback()
            raise SystemExit(str(exc)) from exc
    print(f"Created Admin '{user.username}' for branch '{args.branch_code.upper()}'.")


if __name__ == "__main__":
    main()
