from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from backend.models.suppliers import Supplier
from backend.schemas.supplier_schemas import SupplierCreate, SupplierUpdate
from backend.services.audit import record_audit
from backend.services.auth import AuthPrincipal
from backend.services.authorization import enforce_permission
from backend.services.exceptions import ConflictError, NotFoundError, ValidationError


def supplier_snapshot(supplier: Supplier) -> dict[str, Any]:
    return {
        "id": str(supplier.id),
        "name": supplier.name,
        "contact_person": supplier.contact_person,
        "phone": supplier.phone,
        "email": supplier.email,
        "address": supplier.address,
        "tax_number": supplier.tax_number,
        "payment_terms_days": supplier.payment_terms_days,
        "is_active": supplier.is_active,
    }


def list_suppliers(db: Session, *, include_inactive: bool = False) -> list[Supplier]:
    statement = select(Supplier).where(Supplier.is_deleted.is_(False))
    if not include_inactive:
        statement = statement.where(Supplier.is_active.is_(True))
    return list(db.scalars(statement.order_by(Supplier.name)).all())


def get_supplier(db: Session, supplier_id: UUID) -> Supplier:
    supplier = db.scalar(
        select(Supplier).where(
            Supplier.id == supplier_id,
            Supplier.is_deleted.is_(False),
        )
    )
    if supplier is None:
        raise NotFoundError("supplier not found")
    return supplier


def _ensure_unique_supplier(
    db: Session,
    *,
    name: str,
    tax_number: str | None,
    exclude_id: UUID | None = None,
) -> None:
    checks = [func.lower(Supplier.name) == name.strip().lower()]
    if tax_number:
        checks.append(func.lower(Supplier.tax_number) == tax_number.strip().lower())
    statement = select(Supplier.id).where(or_(*checks), Supplier.is_deleted.is_(False))
    if exclude_id is not None:
        statement = statement.where(Supplier.id != exclude_id)
    if db.scalar(statement.limit(1)) is not None:
        raise ConflictError("supplier name or tax number is already in use")


def create_supplier(
    db: Session, principal: AuthPrincipal, payload: SupplierCreate
) -> Supplier:
    enforce_permission(principal, "purchases.create")
    _ensure_unique_supplier(db, name=payload.name, tax_number=payload.tax_number)
    values = payload.model_dump()
    values["name"] = payload.name.strip()
    if payload.email is not None:
        values["email"] = str(payload.email).lower()
    if payload.tax_number:
        values["tax_number"] = payload.tax_number.strip().upper()
    supplier = Supplier(**values, is_active=True)
    db.add(supplier)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=principal.branch_id,
        action="supplier.created",
        resource_type="supplier",
        resource_id=supplier.id,
        after=supplier_snapshot(supplier),
    )
    return supplier


def update_supplier(
    db: Session,
    principal: AuthPrincipal,
    supplier_id: UUID,
    payload: SupplierUpdate,
) -> Supplier:
    enforce_permission(principal, "purchases.create")
    if not payload.model_fields_set:
        raise ValidationError("at least one field is required")
    supplier = get_supplier(db, supplier_id)
    _ensure_unique_supplier(
        db,
        name=payload.name or supplier.name,
        tax_number=(
            payload.tax_number
            if "tax_number" in payload.model_fields_set
            else supplier.tax_number
        ),
        exclude_id=supplier.id,
    )
    before = supplier_snapshot(supplier)
    values = payload.model_dump(exclude_unset=True)
    if values.get("name"):
        values["name"] = values["name"].strip()
    if values.get("email"):
        values["email"] = str(values["email"]).lower()
    if values.get("tax_number"):
        values["tax_number"] = values["tax_number"].strip().upper()
    for field, value in values.items():
        setattr(supplier, field, value)
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=principal.branch_id,
        action="supplier.updated",
        resource_type="supplier",
        resource_id=supplier.id,
        before=before,
        after=supplier_snapshot(supplier),
    )
    return supplier
