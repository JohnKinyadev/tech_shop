from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from backend.models.customer import Customer
from backend.schemas.customer_schemas import CustomerCreate
from backend.services.audit import record_audit
from backend.services.auth import AuthPrincipal
from backend.services.authorization import enforce_branch_scope, enforce_permission
from backend.services.exceptions import ConflictError, NotFoundError


def list_customers(
    db: Session, principal: AuthPrincipal, *, query: str | None = None, limit: int = 50
) -> list[Customer]:
    enforce_permission(principal, "sales.process")
    conditions = [Customer.is_active.is_(True), Customer.is_deleted.is_(False)]
    if query:
        value = f"%{query.strip()}%"
        conditions.append(
            or_(
                Customer.full_name.ilike(value),
                Customer.phone.ilike(value),
                Customer.email.ilike(value),
            )
        )
    return list(
        db.scalars(
            select(Customer)
            .where(*conditions)
            .order_by(Customer.full_name)
            .limit(limit)
        ).all()
    )


def get_customer(db: Session, principal: AuthPrincipal, customer_id: UUID) -> Customer:
    enforce_permission(principal, "sales.process")
    customer = db.scalar(
        select(Customer).where(
            Customer.id == customer_id,
            Customer.is_deleted.is_(False),
        )
    )
    if customer is None:
        raise NotFoundError("customer not found")
    return customer


def create_customer(
    db: Session, principal: AuthPrincipal, payload: CustomerCreate
) -> Customer:
    enforce_permission(principal, "sales.process")
    home_branch_id = payload.home_branch_id or principal.branch_id
    if home_branch_id is not None:
        enforce_branch_scope(principal, home_branch_id)
    phone = payload.phone.strip()
    if db.scalar(
        select(Customer.id).where(
            func.lower(Customer.phone) == phone.lower(),
            Customer.is_deleted.is_(False),
        )
    ):
        raise ConflictError("customer phone number is already in use")
    customer = Customer(
        full_name=payload.full_name.strip(),
        phone=phone,
        email=str(payload.email).strip().lower() if payload.email else None,
        address=payload.address.strip() if payload.address else None,
        home_branch_id=home_branch_id,
        is_active=True,
    )
    db.add(customer)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=home_branch_id,
        action="customer.created",
        resource_type="customer",
        resource_id=customer.id,
        after={"full_name": customer.full_name, "phone": customer.phone},
    )
    return customer
