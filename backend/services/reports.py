from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.core.permissions import ADMIN, TECHNICIAN
from backend.models.branch import Branch
from backend.models.enums import (
    PaymentDirection,
    PaymentStatus,
    RepairStatus,
    SaleStatus,
)
from backend.models.expenses import Expense, ExpenseCategory
from backend.models.inventory import StockBalance
from backend.models.payments import Payment
from backend.models.products import Product, ProductVariant
from backend.models.repairs import RepairPart, RepairTicket
from backend.models.sales import Sale, SaleItem, SaleReturn
from backend.schemas.report_schemas import (
    DashboardSummaryResponse,
    ExpenseCategoryBreakdown,
    ExpenseSummaryResponse,
    InventorySummaryResponse,
    LowStockItem,
    RepairStatusBreakdown,
    RepairSummaryResponse,
    SalesPaymentBreakdown,
    SalesSummaryResponse,
    TopSellingItem,
)
from backend.services.auth import AuthPrincipal
from backend.services.authorization import AuthorizationError, enforce_permission
from backend.services.exceptions import NotFoundError, ValidationError
from backend.services.sales import money


def _money(value: Any) -> Decimal:
    if value is None:
        value = Decimal("0.00")
    if not isinstance(value, Decimal):
        value = Decimal(str(value))
    return money(value)


def _int(value: Any) -> int:
    return int(value or 0)


def _validate_period(start_at: datetime | None, end_at: datetime | None) -> None:
    if start_at is not None and end_at is not None and start_at > end_at:
        raise ValidationError("start_at cannot be later than end_at")


def _date_conditions(column, start_at: datetime | None, end_at: datetime | None) -> list:
    conditions = []
    if start_at is not None:
        conditions.append(column >= start_at)
    if end_at is not None:
        conditions.append(column <= end_at)
    return conditions


def _branch_id(
    db: Session, principal: AuthPrincipal, branch_id: UUID | None
) -> UUID | None:
    if principal.role_code != ADMIN:
        if principal.branch_id is None:
            raise AuthorizationError("branch-scoped reports require a branch")
        if branch_id is not None and branch_id != principal.branch_id:
            raise AuthorizationError("report is outside the user's branch")
        return principal.branch_id

    if branch_id is not None:
        exists = db.scalar(
            select(Branch.id).where(
                Branch.id == branch_id,
                Branch.is_deleted.is_(False),
            )
        )
        if exists is None:
            raise NotFoundError("branch not found")
    return branch_id


def _require_any(principal: AuthPrincipal, *permission_codes: str) -> None:
    if principal.role_code == ADMIN:
        return
    if not principal.permissions.intersection(permission_codes):
        raise AuthorizationError(
            f"missing one of permissions: {', '.join(permission_codes)}"
        )


def sales_summary(
    db: Session,
    principal: AuthPrincipal,
    *,
    branch_id: UUID | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    top_limit: int = 10,
) -> SalesSummaryResponse:
    enforce_permission(principal, "reports.sales.view")
    _validate_period(start_at, end_at)
    scoped_branch_id = _branch_id(db, principal, branch_id)

    sale_date = func.coalesce(Sale.completed_at, Sale.created_at)
    sale_conditions = [
        Sale.is_deleted.is_(False),
        Sale.status.in_([SaleStatus.COMPLETED, SaleStatus.REFUNDED]),
        *_date_conditions(sale_date, start_at, end_at),
    ]
    if scoped_branch_id is not None:
        sale_conditions.append(Sale.branch_id == scoped_branch_id)

    summary = db.execute(
        select(
            func.count(Sale.id).label("sale_count"),
            func.coalesce(func.sum(Sale.total_amount), 0).label("gross_sales"),
            func.coalesce(func.sum(Sale.paid_amount), 0).label("paid_amount"),
            func.coalesce(func.sum(Sale.discount_amount), 0).label("discount_amount"),
        ).where(*sale_conditions)
    ).mappings().one()

    item_count = (
        db.scalar(
            select(func.coalesce(func.sum(SaleItem.quantity), 0))
            .join(Sale, Sale.id == SaleItem.sale_id)
            .where(SaleItem.is_deleted.is_(False), *sale_conditions)
        )
        or 0
    )

    refund_conditions = [
        SaleReturn.is_deleted.is_(False),
        SaleReturn.status == "approved",
        *_date_conditions(SaleReturn.created_at, start_at, end_at),
    ]
    if scoped_branch_id is not None:
        refund_conditions.append(Sale.branch_id == scoped_branch_id)
    refund_amount = db.scalar(
        select(func.coalesce(func.sum(SaleReturn.refund_amount), 0))
        .join(Sale, Sale.id == SaleReturn.sale_id)
        .where(*refund_conditions)
    )

    payment_conditions = [
        Payment.is_deleted.is_(False),
        Payment.sale_id.is_not(None),
        Payment.direction == PaymentDirection.INCOMING,
        Payment.status == PaymentStatus.COMPLETED,
        *_date_conditions(func.coalesce(Payment.paid_at, Payment.created_at), start_at, end_at),
    ]
    if scoped_branch_id is not None:
        payment_conditions.append(Payment.branch_id == scoped_branch_id)
    payment_rows = db.execute(
        select(
            Payment.method.label("method"),
            func.count(Payment.id).label("transaction_count"),
            func.coalesce(func.sum(Payment.amount), 0).label("amount"),
        )
        .where(*payment_conditions)
        .group_by(Payment.method)
        .order_by(Payment.method)
    ).mappings().all()

    item_rows = db.execute(
        select(
            ProductVariant.id.label("variant_id"),
            ProductVariant.sku.label("sku"),
            Product.name.label("product_name"),
            ProductVariant.name.label("variant_name"),
            func.coalesce(func.sum(SaleItem.quantity), 0).label("quantity_sold"),
            func.coalesce(func.sum(SaleItem.line_total), 0).label("revenue"),
            func.coalesce(
                func.sum(
                    SaleItem.line_total - (SaleItem.unit_cost * SaleItem.quantity)
                ),
                0,
            ).label("gross_profit"),
        )
        .join(Sale, Sale.id == SaleItem.sale_id)
        .join(ProductVariant, ProductVariant.id == SaleItem.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(SaleItem.is_deleted.is_(False), *sale_conditions)
        .group_by(ProductVariant.id, ProductVariant.sku, Product.name, ProductVariant.name)
        .order_by(func.coalesce(func.sum(SaleItem.quantity), 0).desc())
        .limit(top_limit)
    ).mappings().all()

    sale_count = _int(summary["sale_count"])
    gross_sales = _money(summary["gross_sales"])
    refunds = _money(refund_amount)
    net_sales = _money(max(gross_sales - refunds, Decimal("0.00")))
    average_sale = (
        _money(net_sales / Decimal(sale_count)) if sale_count else Decimal("0.00")
    )

    return SalesSummaryResponse(
        branch_id=scoped_branch_id,
        start_at=start_at,
        end_at=end_at,
        sale_count=sale_count,
        item_count=_int(item_count),
        gross_sales=gross_sales,
        paid_amount=_money(summary["paid_amount"]),
        discount_amount=_money(summary["discount_amount"]),
        refund_amount=refunds,
        net_sales=net_sales,
        average_sale=average_sale,
        payments=[
            SalesPaymentBreakdown(
                method=row["method"],
                transaction_count=_int(row["transaction_count"]),
                amount=_money(row["amount"]),
            )
            for row in payment_rows
        ],
        top_items=[
            TopSellingItem(
                variant_id=row["variant_id"],
                sku=row["sku"],
                product_name=row["product_name"],
                variant_name=row["variant_name"],
                quantity_sold=_int(row["quantity_sold"]),
                revenue=_money(row["revenue"]),
                gross_profit=_money(row["gross_profit"]),
            )
            for row in item_rows
        ],
    )


def inventory_summary(
    db: Session,
    principal: AuthPrincipal,
    *,
    branch_id: UUID | None = None,
    low_stock_limit: int = 20,
) -> InventorySummaryResponse:
    enforce_permission(principal, "reports.inventory.view")
    scoped_branch_id = _branch_id(db, principal, branch_id)

    conditions = [StockBalance.is_deleted.is_(False)]
    if scoped_branch_id is not None:
        conditions.append(StockBalance.branch_id == scoped_branch_id)

    summary = db.execute(
        select(
            func.count(StockBalance.id).label("stock_balance_count"),
            func.coalesce(func.sum(StockBalance.quantity_on_hand), 0).label(
                "total_on_hand"
            ),
            func.coalesce(func.sum(StockBalance.reserved_quantity), 0).label(
                "total_reserved"
            ),
            func.coalesce(
                func.sum(
                    StockBalance.quantity_on_hand * StockBalance.average_unit_cost
                ),
                0,
            ).label("stock_value"),
        ).where(*conditions)
    ).mappings().one()

    low_stock_conditions = [
        *conditions,
        StockBalance.reorder_level > 0,
        StockBalance.quantity_on_hand <= StockBalance.reorder_level,
    ]
    low_stock_count = (
        db.scalar(
            select(func.count())
            .select_from(StockBalance)
            .where(*low_stock_conditions)
        )
        or 0
    )
    low_stock_rows = db.execute(
        select(
            StockBalance.branch_id.label("branch_id"),
            ProductVariant.id.label("variant_id"),
            ProductVariant.sku.label("sku"),
            Product.name.label("product_name"),
            ProductVariant.name.label("variant_name"),
            StockBalance.quantity_on_hand.label("quantity_on_hand"),
            StockBalance.reserved_quantity.label("reserved_quantity"),
            StockBalance.reorder_level.label("reorder_level"),
            (
                StockBalance.quantity_on_hand * StockBalance.average_unit_cost
            ).label("stock_value"),
        )
        .join(ProductVariant, ProductVariant.id == StockBalance.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(*low_stock_conditions)
        .order_by(StockBalance.quantity_on_hand.asc(), Product.name.asc())
        .limit(low_stock_limit)
    ).mappings().all()

    total_on_hand = _int(summary["total_on_hand"])
    total_reserved = _int(summary["total_reserved"])
    return InventorySummaryResponse(
        branch_id=scoped_branch_id,
        stock_balance_count=_int(summary["stock_balance_count"]),
        total_on_hand=total_on_hand,
        total_reserved=total_reserved,
        total_available=max(total_on_hand - total_reserved, 0),
        stock_value=_money(summary["stock_value"]),
        low_stock_count=_int(low_stock_count),
        low_stock_items=[
            LowStockItem(
                branch_id=row["branch_id"],
                variant_id=row["variant_id"],
                sku=row["sku"],
                product_name=row["product_name"],
                variant_name=row["variant_name"],
                quantity_on_hand=_int(row["quantity_on_hand"]),
                reserved_quantity=_int(row["reserved_quantity"]),
                available_quantity=max(
                    _int(row["quantity_on_hand"]) - _int(row["reserved_quantity"]), 0
                ),
                reorder_level=_int(row["reorder_level"]),
                stock_value=_money(row["stock_value"]),
            )
            for row in low_stock_rows
        ],
    )


def _repair_scope_conditions(
    principal: AuthPrincipal,
    *,
    technician_id: UUID | None,
) -> list:
    if principal.role_code == ADMIN or "reports.repairs.view" in principal.permissions:
        return [RepairTicket.technician_id == technician_id] if technician_id else []
    if "reports.own_repairs.view" not in principal.permissions:
        raise AuthorizationError(
            "missing one of permissions: reports.repairs.view, reports.own_repairs.view"
        )
    if principal.role_code != TECHNICIAN:
        raise AuthorizationError("own repair reports are available to technicians only")
    if technician_id is not None and technician_id != principal.user_id:
        raise AuthorizationError("technicians can only report on assigned tickets")
    return [RepairTicket.technician_id == principal.user_id]


def repair_summary(
    db: Session,
    principal: AuthPrincipal,
    *,
    branch_id: UUID | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    technician_id: UUID | None = None,
) -> RepairSummaryResponse:
    _require_any(principal, "reports.repairs.view", "reports.own_repairs.view")
    _validate_period(start_at, end_at)
    scoped_branch_id = _branch_id(db, principal, branch_id)

    ticket_conditions = [
        RepairTicket.is_deleted.is_(False),
        *_date_conditions(RepairTicket.created_at, start_at, end_at),
        *_repair_scope_conditions(principal, technician_id=technician_id),
    ]
    if scoped_branch_id is not None:
        ticket_conditions.append(RepairTicket.branch_id == scoped_branch_id)

    rows = db.execute(
        select(
            RepairTicket.status.label("status"),
            func.count(RepairTicket.id).label("ticket_count"),
            func.coalesce(func.sum(RepairTicket.labor_estimate), 0).label(
                "labor_estimate"
            ),
        )
        .where(*ticket_conditions)
        .group_by(RepairTicket.status)
    ).mappings().all()
    status_counts = {row["status"]: _int(row["ticket_count"]) for row in rows}
    labor_total = _money(sum((_money(row["labor_estimate"]) for row in rows), Decimal("0.00")))

    part_rows = db.execute(
        select(
            func.coalesce(func.sum(RepairPart.unit_price * RepairPart.quantity), 0)
        )
        .join(RepairTicket, RepairTicket.id == RepairPart.repair_ticket_id)
        .where(RepairPart.is_deleted.is_(False), *ticket_conditions)
    ).scalar()

    payment_conditions = [
        Payment.is_deleted.is_(False),
        Payment.repair_ticket_id.is_not(None),
        Payment.direction == PaymentDirection.INCOMING,
        Payment.status == PaymentStatus.COMPLETED,
        *_date_conditions(func.coalesce(Payment.paid_at, Payment.created_at), start_at, end_at),
    ]
    if scoped_branch_id is not None:
        payment_conditions.append(Payment.branch_id == scoped_branch_id)
    payment_scope = _repair_scope_conditions(principal, technician_id=technician_id)
    payment_total = db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0))
        .join(RepairTicket, RepairTicket.id == Payment.repair_ticket_id)
        .where(RepairTicket.is_deleted.is_(False), *payment_scope, *payment_conditions)
    )

    terminal_statuses = {RepairStatus.COLLECTED, RepairStatus.CANCELLED}
    ready_count = status_counts.get(RepairStatus.READY_FOR_PICKUP, 0)
    collected_count = status_counts.get(RepairStatus.COLLECTED, 0)
    cancelled_count = status_counts.get(RepairStatus.CANCELLED, 0)
    ticket_count = sum(status_counts.values())
    open_count = sum(
        count for status, count in status_counts.items() if status not in terminal_statuses
    )

    return RepairSummaryResponse(
        branch_id=scoped_branch_id,
        start_at=start_at,
        end_at=end_at,
        ticket_count=ticket_count,
        open_ticket_count=open_count,
        ready_ticket_count=ready_count,
        collected_ticket_count=collected_count,
        cancelled_ticket_count=cancelled_count,
        labor_estimate_total=labor_total,
        parts_revenue_total=_money(part_rows),
        payment_total=_money(payment_total),
        status_breakdown=[
            RepairStatusBreakdown(status=status, ticket_count=count)
            for status, count in sorted(
                status_counts.items(), key=lambda item: item[0].value
            )
        ],
    )


def expense_summary(
    db: Session,
    principal: AuthPrincipal,
    *,
    branch_id: UUID | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> ExpenseSummaryResponse:
    enforce_permission(principal, "expenses.view")
    _validate_period(start_at, end_at)
    scoped_branch_id = _branch_id(db, principal, branch_id)

    conditions = [
        Expense.is_deleted.is_(False),
        *_date_conditions(Expense.created_at, start_at, end_at),
    ]
    if scoped_branch_id is not None:
        conditions.append(Expense.branch_id == scoped_branch_id)

    rows = db.execute(
        select(Expense.status.label("status"), func.count(Expense.id).label("count"))
        .where(*conditions)
        .group_by(Expense.status)
    ).mappings().all()
    status_counts = {row["status"]: _int(row["count"]) for row in rows}
    approved_conditions = [*conditions, Expense.status == "approved"]
    total = db.scalar(
        select(func.coalesce(func.sum(Expense.amount), 0)).where(*approved_conditions)
    )
    category_rows = db.execute(
        select(
            ExpenseCategory.id.label("category_id"),
            ExpenseCategory.name.label("category_name"),
            func.count(Expense.id).label("expense_count"),
            func.coalesce(func.sum(Expense.amount), 0).label("amount"),
        )
        .join(ExpenseCategory, ExpenseCategory.id == Expense.category_id)
        .where(*approved_conditions, ExpenseCategory.is_deleted.is_(False))
        .group_by(ExpenseCategory.id, ExpenseCategory.name)
        .order_by(func.coalesce(func.sum(Expense.amount), 0).desc())
    ).mappings().all()

    return ExpenseSummaryResponse(
        branch_id=scoped_branch_id,
        start_at=start_at,
        end_at=end_at,
        approved_expense_count=status_counts.get("approved", 0),
        pending_expense_count=status_counts.get("pending", 0),
        rejected_expense_count=status_counts.get("rejected", 0),
        cancelled_expense_count=status_counts.get("cancelled", 0),
        total_approved_expenses=_money(total),
        by_category=[
            ExpenseCategoryBreakdown(
                category_id=row["category_id"],
                category_name=row["category_name"],
                expense_count=_int(row["expense_count"]),
                amount=_money(row["amount"]),
            )
            for row in category_rows
        ],
    )


def dashboard_summary(
    db: Session,
    principal: AuthPrincipal,
    *,
    branch_id: UUID | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
) -> DashboardSummaryResponse:
    enforce_permission(principal, "reports.sales.view")
    enforce_permission(principal, "reports.inventory.view")
    enforce_permission(principal, "reports.repairs.view")
    enforce_permission(principal, "expenses.view")
    _validate_period(start_at, end_at)
    scoped_branch_id = _branch_id(db, principal, branch_id)
    return DashboardSummaryResponse(
        branch_id=scoped_branch_id,
        start_at=start_at,
        end_at=end_at,
        sales=sales_summary(
            db,
            principal,
            branch_id=scoped_branch_id,
            start_at=start_at,
            end_at=end_at,
            top_limit=5,
        ),
        inventory=inventory_summary(db, principal, branch_id=scoped_branch_id),
        repairs=repair_summary(
            db,
            principal,
            branch_id=scoped_branch_id,
            start_at=start_at,
            end_at=end_at,
        ),
        expenses=expense_summary(
            db,
            principal,
            branch_id=scoped_branch_id,
            start_at=start_at,
            end_at=end_at,
        ),
    )
