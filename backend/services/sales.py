import calendar
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.core.permissions import CASHIER
from backend.models.branch import Branch
from backend.models.customer import Customer
from backend.models.enums import (
    FulfillmentStatus,
    PaymentDirection,
    PaymentMethod,
    PaymentStatus,
    SaleChannel,
    SaleStatus,
    SerializedUnitStatus,
    TillSessionStatus,
    TrackingType,
)
from backend.models.inventory import SerializedUnit, StockBalance
from backend.models.payments import Payment
from backend.models.products import Product, ProductVariant
from backend.models.sales import Sale, SaleItem, Till, TillSession
from backend.models.users import User
from backend.models.warranty import Warranty
from backend.schemas.payments_schemas import PaymentResponse, SalePaymentCreate
from backend.schemas.sales_schemas import (
    POSSaleItemResponse,
    POSSaleResponse,
    ReceiptPaymentLine,
    ReceiptResponse,
    SaleCreate,
)
from backend.schemas.warranty_schemas import WarrantyResponse
from backend.services import inventory
from backend.services.audit import record_audit
from backend.services.auth import AuthPrincipal
from backend.services.authorization import (
    AuthorizationError,
    enforce_branch_scope,
    enforce_permission,
)
from backend.services.exceptions import ConflictError, NotFoundError, ValidationError

MONEY_QUANTUM = Decimal("0.01")


def money(value: Decimal) -> Decimal:
    return value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def _invoice_number() -> str:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"INV-{today}-{uuid4().hex[:8].upper()}"


def _items(db: Session, sale_id: UUID, *, lock: bool = False) -> list[SaleItem]:
    statement = (
        select(SaleItem)
        .where(SaleItem.sale_id == sale_id, SaleItem.is_deleted.is_(False))
        .order_by(SaleItem.created_at)
    )
    if lock:
        statement = statement.with_for_update()
    return list(db.scalars(statement).all())


def sale_response(db: Session, sale: Sale) -> POSSaleResponse:
    return POSSaleResponse.model_validate(sale).model_copy(
        update={
            "items": [
                POSSaleItemResponse.model_validate(item) for item in _items(db, sale.id)
            ]
        }
    )


def get_sale_model(
    db: Session,
    principal: AuthPrincipal,
    sale_id: UUID,
    *,
    lock: bool = False,
) -> Sale:
    enforce_permission(principal, "sales.process")
    statement = select(Sale).where(Sale.id == sale_id, Sale.is_deleted.is_(False))
    if lock:
        statement = statement.with_for_update()
    sale = db.scalar(statement)
    if sale is None:
        raise NotFoundError("sale not found")
    enforce_branch_scope(principal, sale.branch_id)
    if principal.role_code == CASHIER and sale.cashier_id != principal.user_id:
        raise AuthorizationError("cashiers can only access their own sales")
    return sale


def list_sales(
    db: Session,
    principal: AuthPrincipal,
    *,
    branch_id: UUID,
    page: int,
    page_size: int,
    status: SaleStatus | None = None,
) -> tuple[list[POSSaleResponse], int]:
    enforce_permission(principal, "sales.process")
    enforce_branch_scope(principal, branch_id)
    conditions = [Sale.branch_id == branch_id, Sale.is_deleted.is_(False)]
    if principal.role_code == CASHIER:
        conditions.append(Sale.cashier_id == principal.user_id)
    if status is not None:
        conditions.append(Sale.status == status)
    total = db.scalar(select(func.count()).select_from(Sale).where(*conditions)) or 0
    rows = db.scalars(
        select(Sale)
        .where(*conditions)
        .order_by(Sale.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return [sale_response(db, sale) for sale in rows], total


def get_sale(db: Session, principal: AuthPrincipal, sale_id: UUID) -> POSSaleResponse:
    return sale_response(db, get_sale_model(db, principal, sale_id))


def create_sale(
    db: Session, principal: AuthPrincipal, payload: SaleCreate
) -> POSSaleResponse:
    enforce_permission(principal, "sales.process")
    enforce_branch_scope(principal, payload.branch_id)
    if payload.channel != SaleChannel.POS:
        raise ValidationError("the POS endpoint only creates POS sales")
    if payload.till_session_id is None:
        raise ValidationError("POS sales require an open till session")
    till_session = db.scalar(
        select(TillSession)
        .where(
            TillSession.id == payload.till_session_id,
            TillSession.cashier_id == principal.user_id,
            TillSession.status == TillSessionStatus.OPEN,
            TillSession.is_deleted.is_(False),
        )
        .with_for_update()
    )
    if till_session is None:
        raise ConflictError("the cashier does not have this open till session")
    till = db.scalar(
        select(Till).where(
            Till.id == till_session.till_id,
            Till.branch_id == payload.branch_id,
            Till.is_active.is_(True),
            Till.is_deleted.is_(False),
        )
    )
    if till is None:
        raise ConflictError("till session does not belong to the sale branch")
    if payload.customer_id is not None:
        customer = db.scalar(
            select(Customer).where(
                Customer.id == payload.customer_id,
                Customer.is_active.is_(True),
                Customer.is_deleted.is_(False),
            )
        )
        if customer is None:
            raise NotFoundError("active customer not found")

    variant_ids = {item.variant_id for item in payload.items}
    rows = db.execute(
        select(ProductVariant, Product)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(
            ProductVariant.id.in_(variant_ids),
            ProductVariant.is_active.is_(True),
            ProductVariant.is_deleted.is_(False),
            Product.is_active.is_(True),
            Product.is_deleted.is_(False),
        )
    ).all()
    products = {variant.id: (variant, product) for variant, product in rows}
    if set(products) != variant_ids:
        raise NotFoundError("one or more sale variants are unavailable")
    balances = {
        balance.variant_id: balance
        for balance in db.scalars(
            select(StockBalance).where(
                StockBalance.branch_id == payload.branch_id,
                StockBalance.variant_id.in_(variant_ids),
                StockBalance.is_deleted.is_(False),
            )
        ).all()
    }
    serialized_ids = {
        item.serialized_unit_id
        for item in payload.items
        if item.serialized_unit_id is not None
    }
    units = {
        unit.id: unit
        for unit in db.scalars(
            select(SerializedUnit).where(
                SerializedUnit.id.in_(serialized_ids),
                SerializedUnit.is_deleted.is_(False),
            )
        ).all()
    }

    requested_by_variant: dict[UUID, int] = {}
    seen_lines: set[tuple[UUID, UUID | None]] = set()
    prepared: list[dict] = []
    subtotal = Decimal("0.00")
    discount_total = Decimal("0.00")
    total = Decimal("0.00")
    for requested in payload.items:
        variant, product = products[requested.variant_id]
        key = (requested.variant_id, requested.serialized_unit_id)
        if key in seen_lines:
            raise ConflictError("duplicate sale item")
        seen_lines.add(key)
        requested_by_variant[requested.variant_id] = (
            requested_by_variant.get(requested.variant_id, 0) + requested.quantity
        )
        balance = balances.get(requested.variant_id)
        if balance is None:
            raise ConflictError("sale item is out of stock")
        unit_cost = balance.average_unit_cost
        if variant.tracking_type == TrackingType.BULK:
            if requested.serialized_unit_id is not None:
                raise ValidationError("bulk sale items cannot reference a unit")
        else:
            if requested.serialized_unit_id is None or requested.quantity != 1:
                raise ValidationError("serialized sale items require one specific unit")
            unit = units.get(requested.serialized_unit_id)
            if (
                unit is None
                or unit.variant_id != variant.id
                or unit.branch_id != payload.branch_id
            ):
                raise NotFoundError("serialized sale unit was not found at this branch")
            if unit.status != SerializedUnitStatus.AVAILABLE:
                raise ConflictError("serialized sale unit is unavailable")
            unit_cost = unit.unit_cost

        gross = money(variant.selling_price * requested.quantity)
        discount = money(requested.discount_amount)
        if discount > gross:
            raise ValidationError("line discount cannot exceed the line subtotal")
        effective_unit_price = money((gross - discount) / requested.quantity)
        if (
            variant.minimum_selling_price is not None
            and effective_unit_price < variant.minimum_selling_price
        ):
            raise ValidationError("line discount falls below the minimum selling price")
        line_total = money(gross - discount)
        subtotal += gross
        discount_total += discount
        total += line_total
        prepared.append(
            {
                "variant_id": variant.id,
                "serialized_unit_id": requested.serialized_unit_id,
                "description": f"{product.name} - {variant.name}",
                "quantity": requested.quantity,
                "unit_price": variant.selling_price,
                "unit_cost": unit_cost,
                "discount_amount": discount,
                "tax_amount": Decimal("0.00"),
                "line_total": line_total,
            }
        )

    for variant_id, requested_quantity in requested_by_variant.items():
        balance = balances[variant_id]
        if requested_quantity > balance.quantity_on_hand - balance.reserved_quantity:
            raise ConflictError("sale quantity exceeds available stock")
    if total <= 0:
        raise ValidationError("sale total must be greater than zero")

    sale = Sale(
        branch_id=payload.branch_id,
        customer_id=payload.customer_id,
        cashier_id=principal.user_id,
        till_session_id=till_session.id,
        invoice_number=_invoice_number(),
        channel=SaleChannel.POS,
        status=SaleStatus.PENDING_PAYMENT,
        fulfillment_status=FulfillmentStatus.NOT_REQUIRED,
        subtotal=money(subtotal),
        tax_amount=Decimal("0.00"),
        discount_amount=money(discount_total),
        total_amount=money(total),
        paid_amount=Decimal("0.00"),
        notes=payload.notes,
    )
    db.add(sale)
    db.flush()
    for values in prepared:
        db.add(SaleItem(sale_id=sale.id, **values))
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=sale.branch_id,
        action="sale.created",
        resource_type="sale",
        resource_id=sale.id,
        after={"invoice_number": sale.invoice_number, "total": str(sale.total_amount)},
    )
    return sale_response(db, sale)


def _add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def _create_warranties(
    db: Session, sale: Sale, items: list[SaleItem], now: datetime
) -> None:
    warranty_months = dict(
        db.execute(
            select(ProductVariant.id, Product.warranty_months)
            .join(Product, Product.id == ProductVariant.product_id)
            .where(ProductVariant.id.in_([item.variant_id for item in items]))
        ).all()
    )
    for item in items:
        months = warranty_months.get(item.variant_id, 0)
        if months <= 0:
            continue
        db.add(
            Warranty(
                sale_item_id=item.id,
                serialized_unit_id=item.serialized_unit_id,
                customer_id=sale.customer_id,
                start_date=now,
                end_date=_add_months(now, months),
                status="active",
            )
        )


def _complete_sale_if_fully_paid(
    db: Session,
    *,
    sale: Sale,
    actor_id: UUID,
    now: datetime,
) -> None:
    if sale.paid_amount != sale.total_amount:
        return

    items = _items(db, sale.id, lock=True)
    inventory.sell_stock(
        db,
        branch_id=sale.branch_id,
        sale_id=sale.id,
        items=items,
        performed_by_id=actor_id,
    )
    _create_warranties(db, sale, items, now)
    sale.status = SaleStatus.COMPLETED
    sale.fulfillment_status = FulfillmentStatus.FULFILLED
    sale.completed_at = now


def complete_pending_payment(
    db: Session,
    payment: Payment,
    *,
    provider_reference: str | None,
    provider_payload: dict | None,
    paid_at: datetime | None = None,
) -> PaymentResponse:
    if payment.status == PaymentStatus.COMPLETED:
        return PaymentResponse.model_validate(payment)
    if payment.status != PaymentStatus.PENDING:
        raise ConflictError("only pending payments can be completed")
    if payment.sale_id is None:
        raise ConflictError("payment is not linked to a sale")

    sale = db.scalar(
        select(Sale)
        .where(Sale.id == payment.sale_id, Sale.is_deleted.is_(False))
        .with_for_update()
    )
    if sale is None:
        raise NotFoundError("sale not found")
    if sale.status != SaleStatus.PENDING_PAYMENT:
        raise ConflictError("this sale is not awaiting payment")
    if provider_reference and provider_reference != payment.provider_reference:
        duplicate = db.scalar(
            select(Payment.id).where(
                Payment.provider_reference == provider_reference,
                Payment.id != payment.id,
            )
        )
        if duplicate is not None:
            raise ConflictError("payment provider reference is already in use")

    now = paid_at or datetime.now(timezone.utc)
    payment.status = PaymentStatus.COMPLETED
    payment.provider_reference = provider_reference or payment.provider_reference
    payment.provider_payload = {
        **(payment.provider_payload or {}),
        **(provider_payload or {}),
    }
    payment.paid_at = now

    sale.paid_amount = money(sale.paid_amount + payment.amount)
    if sale.paid_amount > sale.total_amount:
        raise ValidationError("payment exceeds the outstanding sale amount")
    if sale.cashier_id is None:
        raise ConflictError("sale has no cashier to complete payment")
    _complete_sale_if_fully_paid(
        db,
        sale=sale,
        actor_id=sale.cashier_id,
        now=now,
    )
    db.flush()
    record_audit(
        db,
        actor_id=sale.cashier_id,
        branch_id=sale.branch_id,
        action="sale.payment_recorded",
        resource_type="sale",
        resource_id=sale.id,
        after={"paid_amount": str(sale.paid_amount), "status": sale.status.value},
    )
    return PaymentResponse.model_validate(payment)


def add_payment(
    db: Session,
    principal: AuthPrincipal,
    sale_id: UUID,
    payload: SalePaymentCreate,
) -> PaymentResponse:
    sale = get_sale_model(db, principal, sale_id, lock=True)
    existing = db.scalar(
        select(Payment).where(Payment.idempotency_key == payload.idempotency_key)
    )
    if existing is not None:
        if existing.sale_id != sale.id:
            raise ConflictError("payment idempotency key is already in use")
        return PaymentResponse.model_validate(existing)
    if sale.status != SaleStatus.PENDING_PAYMENT:
        raise ConflictError("this sale is not awaiting payment")
    if payload.method == PaymentMethod.STORE_CREDIT:
        raise ValidationError("store credit is not available yet")
    if payload.method != PaymentMethod.CASH and not payload.provider_reference:
        raise ValidationError("non-cash payments require a provider reference")
    outstanding = money(sale.total_amount - sale.paid_amount)
    if payload.amount > outstanding:
        raise ValidationError("payment exceeds the outstanding sale amount")
    if payload.provider_reference and db.scalar(
        select(Payment.id).where(
            Payment.provider_reference == payload.provider_reference
        )
    ):
        raise ConflictError("payment provider reference is already in use")

    now = datetime.now(timezone.utc)
    payment = Payment(
        branch_id=sale.branch_id,
        sale_id=sale.id,
        till_session_id=sale.till_session_id,
        direction=PaymentDirection.INCOMING,
        method=payload.method,
        status=PaymentStatus.COMPLETED,
        amount=money(payload.amount),
        currency="KES",
        provider_reference=payload.provider_reference,
        idempotency_key=payload.idempotency_key,
        paid_at=now,
        notes=payload.notes,
    )
    db.add(payment)
    sale.paid_amount = money(sale.paid_amount + payment.amount)
    _complete_sale_if_fully_paid(
        db,
        sale=sale,
        actor_id=principal.user_id,
        now=now,
    )
    db.flush()
    record_audit(
        db,
        actor_id=principal.user_id,
        branch_id=sale.branch_id,
        action="sale.payment_recorded",
        resource_type="sale",
        resource_id=sale.id,
        after={"paid_amount": str(sale.paid_amount), "status": sale.status.value},
    )
    return PaymentResponse.model_validate(payment)


def cancel_unpaid_sale(
    db: Session, principal: AuthPrincipal, sale_id: UUID
) -> POSSaleResponse:
    sale = get_sale_model(db, principal, sale_id, lock=True)
    if sale.status != SaleStatus.PENDING_PAYMENT or sale.paid_amount != 0:
        raise ConflictError("only an unpaid pending sale can be cancelled")
    sale.status = SaleStatus.CANCELLED
    sale.fulfillment_status = FulfillmentStatus.CANCELLED
    db.flush()
    return sale_response(db, sale)


def receipt(db: Session, principal: AuthPrincipal, sale_id: UUID) -> ReceiptResponse:
    sale = get_sale_model(db, principal, sale_id)
    if sale.status in {
        SaleStatus.DRAFT,
        SaleStatus.PENDING_PAYMENT,
        SaleStatus.CANCELLED,
    }:
        raise ConflictError("a receipt is only available for a completed sale")
    branch = db.get(Branch, sale.branch_id)
    customer = db.get(Customer, sale.customer_id) if sale.customer_id else None
    cashier = db.get(User, sale.cashier_id) if sale.cashier_id else None
    payments = db.scalars(
        select(Payment)
        .where(
            Payment.sale_id == sale.id,
            Payment.direction == PaymentDirection.INCOMING,
            Payment.status == PaymentStatus.COMPLETED,
            Payment.is_deleted.is_(False),
        )
        .order_by(Payment.paid_at)
    ).all()
    return ReceiptResponse(
        invoice_number=sale.invoice_number,
        sale_status=sale.status,
        branch_name=branch.name if branch else "",
        branch_code=branch.code if branch else "",
        branch_address=branch.address if branch else None,
        customer_name=customer.full_name if customer else None,
        customer_phone=customer.phone if customer else None,
        cashier_name=cashier.full_name if cashier else None,
        items=[
            POSSaleItemResponse.model_validate(item) for item in _items(db, sale.id)
        ],
        payments=[
            ReceiptPaymentLine(
                method=payment.method,
                amount=payment.amount,
                provider_reference=payment.provider_reference,
                paid_at=payment.paid_at,
            )
            for payment in payments
        ],
        subtotal=sale.subtotal,
        tax_amount=sale.tax_amount,
        discount_amount=sale.discount_amount,
        total_amount=sale.total_amount,
        paid_amount=sale.paid_amount,
        completed_at=sale.completed_at,
    )


def lookup_warranty(
    db: Session, principal: AuthPrincipal, identifier: str
) -> WarrantyResponse:
    enforce_permission(principal, "sales.process")
    row = db.execute(
        select(Warranty, Sale)
        .join(SerializedUnit, SerializedUnit.id == Warranty.serialized_unit_id)
        .join(SaleItem, SaleItem.id == Warranty.sale_item_id)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(
            (func.lower(SerializedUnit.serial_number) == identifier.strip().lower())
            | (SerializedUnit.imei == identifier.strip()),
            Warranty.is_deleted.is_(False),
        )
    ).first()
    if row is None:
        raise NotFoundError("warranty not found")
    warranty, sale = row
    enforce_branch_scope(principal, sale.branch_id)
    return WarrantyResponse.model_validate(warranty)
