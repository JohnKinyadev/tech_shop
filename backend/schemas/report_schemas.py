from datetime import datetime
from decimal import Decimal
from uuid import UUID

from backend.models.enums import PaymentMethod, RepairStatus
from backend.schemas.base_schemas import BaseSchema


class ReportPeriod(BaseSchema):
    branch_id: UUID | None
    start_at: datetime | None
    end_at: datetime | None


class SalesPaymentBreakdown(BaseSchema):
    method: PaymentMethod
    transaction_count: int
    amount: Decimal


class TopSellingItem(BaseSchema):
    variant_id: UUID
    sku: str
    product_name: str
    variant_name: str
    quantity_sold: int
    revenue: Decimal
    gross_profit: Decimal


class SalesSummaryResponse(ReportPeriod):
    sale_count: int
    item_count: int
    gross_sales: Decimal
    paid_amount: Decimal
    discount_amount: Decimal
    refund_amount: Decimal
    net_sales: Decimal
    average_sale: Decimal
    payments: list[SalesPaymentBreakdown]
    top_items: list[TopSellingItem]


class LowStockItem(BaseSchema):
    branch_id: UUID
    variant_id: UUID
    sku: str
    product_name: str
    variant_name: str
    quantity_on_hand: int
    reserved_quantity: int
    available_quantity: int
    reorder_level: int
    stock_value: Decimal


class InventorySummaryResponse(BaseSchema):
    branch_id: UUID | None
    stock_balance_count: int
    total_on_hand: int
    total_reserved: int
    total_available: int
    stock_value: Decimal
    low_stock_count: int
    low_stock_items: list[LowStockItem]


class RepairStatusBreakdown(BaseSchema):
    status: RepairStatus
    ticket_count: int


class RepairSummaryResponse(ReportPeriod):
    ticket_count: int
    open_ticket_count: int
    ready_ticket_count: int
    collected_ticket_count: int
    cancelled_ticket_count: int
    labor_estimate_total: Decimal
    parts_revenue_total: Decimal
    payment_total: Decimal
    status_breakdown: list[RepairStatusBreakdown]


class ExpenseCategoryBreakdown(BaseSchema):
    category_id: UUID
    category_name: str
    expense_count: int
    amount: Decimal


class ExpenseSummaryResponse(ReportPeriod):
    approved_expense_count: int
    pending_expense_count: int
    rejected_expense_count: int
    cancelled_expense_count: int
    total_approved_expenses: Decimal
    by_category: list[ExpenseCategoryBreakdown]


class DashboardSummaryResponse(ReportPeriod):
    sales: SalesSummaryResponse
    inventory: InventorySummaryResponse
    repairs: RepairSummaryResponse
    expenses: ExpenseSummaryResponse
