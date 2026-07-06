from backend.models import Base, BaseModel
from backend.models.approvals import ApprovalRequest
from backend.models.audit import AuditLog
from backend.models.branch import Branch
from backend.models.brand import Brand
from backend.models.customer import Customer
from backend.models.expenses import Expense, ExpenseCategory
from backend.models.inventory import SerializedUnit, StockBalance, StockReservation
from backend.models.inventory_movement import (
    StockMovement,
    StockTransfer,
    StockTransferItem,
)
from backend.models.payments import Payment
from backend.models.permissions import Permission
from backend.models.products import Category, Product, ProductImage, ProductVariant
from backend.models.purchase import (
    GoodsReceipt,
    GoodsReceiptItem,
    PurchaseOrder,
    PurchaseOrderItem,
)
from backend.models.repairs import RepairPart, RepairStatusHistory, RepairTicket
from backend.models.roles import Role, RolePermission
from backend.models.sales import (
    Sale,
    SaleItem,
    SaleReturn,
    SaleReturnItem,
    Till,
    TillSession,
)
from backend.models.suppliers import Supplier
from backend.models.users import User
from backend.models.warranty import Warranty
from backend.schemas.approval_schemas import ApprovalRequestResponse
from backend.schemas.audit_schemas import AuditLogResponse
from backend.schemas.branch_schemas import BranchResponse
from backend.schemas.customer_schemas import CustomerResponse
from backend.schemas.expense_schemas import ExpenseCategoryResponse, ExpenseResponse
from backend.schemas.inventory_schemas import (
    SerializedUnitResponse,
    StockBalanceResponse,
    StockMovementResponse,
    StockReservationResponse,
    StockTransferItemResponse,
    StockTransferResponse,
)
from backend.schemas.payments_schemas import PaymentResponse
from backend.schemas.products_schemas import (
    BrandResponse,
    CategoryResponse,
    ProductImageResponse,
    ProductResponse,
    ProductVariantResponse,
)
from backend.schemas.purchase_schemas import (
    GoodsReceiptItemResponse,
    GoodsReceiptResponse,
    PurchaseOrderItemResponse,
    PurchaseOrderResponse,
)
from backend.schemas.repair_schemas import (
    RepairPartResponse,
    RepairStatusHistoryResponse,
    RepairTicketResponse,
)
from backend.schemas.sales_schemas import (
    SaleItemResponse,
    SaleResponse,
    SaleReturnItemResponse,
    SaleReturnResponse,
    TillResponse,
    TillSessionResponse,
)
from backend.schemas.supplier_schemas import SupplierResponse
from backend.schemas.user_schemas import (
    PermissionResponse,
    RolePermissionResponse,
    RoleResponse,
    UserResponse,
)
from backend.schemas.warranty_schemas import WarrantyResponse

PAIRS = [
    (ApprovalRequest, ApprovalRequestResponse, set()),
    (AuditLog, AuditLogResponse, set()),
    (Branch, BranchResponse, set()),
    (Brand, BrandResponse, set()),
    (Customer, CustomerResponse, set()),
    (ExpenseCategory, ExpenseCategoryResponse, set()),
    (Expense, ExpenseResponse, set()),
    (StockBalance, StockBalanceResponse, set()),
    (SerializedUnit, SerializedUnitResponse, set()),
    (StockReservation, StockReservationResponse, set()),
    (StockMovement, StockMovementResponse, set()),
    (StockTransfer, StockTransferResponse, {"items"}),
    (StockTransferItem, StockTransferItemResponse, set()),
    (Payment, PaymentResponse, set()),
    (Permission, PermissionResponse, set()),
    (Category, CategoryResponse, set()),
    (Product, ProductResponse, {"variants", "images"}),
    (ProductVariant, ProductVariantResponse, set()),
    (ProductImage, ProductImageResponse, set()),
    (PurchaseOrder, PurchaseOrderResponse, {"items"}),
    (PurchaseOrderItem, PurchaseOrderItemResponse, set()),
    (GoodsReceipt, GoodsReceiptResponse, {"items"}),
    (GoodsReceiptItem, GoodsReceiptItemResponse, set()),
    (RepairTicket, RepairTicketResponse, {"parts", "status_history"}),
    (RepairPart, RepairPartResponse, set()),
    (RepairStatusHistory, RepairStatusHistoryResponse, set()),
    (Role, RoleResponse, {"permissions"}),
    (Till, TillResponse, set()),
    (TillSession, TillSessionResponse, set()),
    (Sale, SaleResponse, {"items"}),
    (SaleItem, SaleItemResponse, set()),
    (SaleReturn, SaleReturnResponse, {"items"}),
    (SaleReturnItem, SaleReturnItemResponse, set()),
    (Supplier, SupplierResponse, set()),
    (User, UserResponse, set()),
    (Warranty, WarrantyResponse, set()),
]


def test_every_model_has_a_response_schema() -> None:
    paired_models = {model for model, _, _ in PAIRS}
    assert paired_models == set(BaseModel.__subclasses__())
    assert len(PAIRS) + 1 == len(
        Base.metadata.tables
    )  # RolePermission is the join table.


def test_response_fields_are_backed_by_model_columns() -> None:
    for model, schema, virtual_fields in PAIRS:
        model_fields = set(model.__table__.columns.keys())
        schema_fields = set(schema.model_fields) - virtual_fields
        assert schema_fields <= model_fields, (
            f"{schema.__name__} has fields absent from {model.__name__}: "
            f"{schema_fields - model_fields}"
        )


def test_role_permission_schema_matches_join_table() -> None:
    assert set(RolePermissionResponse.model_fields) == set(
        RolePermission.__table__.columns.keys()
    )
