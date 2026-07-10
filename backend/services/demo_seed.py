from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.core.permissions import (
    ACCOUNTANT,
    ADMIN,
    BRANCH_MANAGER,
    CASHIER,
    INVENTORY_MANAGER,
    TECHNICIAN,
)
from backend.core.security import hash_password
from backend.models.approvals import ApprovalRequest
from backend.models.branch import Branch
from backend.models.brand import Brand
from backend.models.customer import Customer
from backend.models.enums import (
    ApprovalStatus,
    BranchStatus,
    PaymentMethod,
    RepairStatus,
    SaleChannel,
    SerializedUnitStatus,
    StockCountStatus,
    TillSessionStatus,
    TrackingType,
)
from backend.models.expenses import Expense, ExpenseCategory
from backend.models.inventory import SerializedUnit, StockBalance
from backend.models.inventory_movement import StockTransfer
from backend.models.permissions import Permission
from backend.models.products import Category, Product, ProductImage, ProductVariant
from backend.models.purchase import GoodsReceipt, PurchaseOrder, PurchaseOrderItem
from backend.models.repairs import RepairTicket
from backend.models.roles import Role, RolePermission
from backend.models.sales import Sale, Till, TillSession
from backend.models.stocktake import StockCount
from backend.models.suppliers import Supplier
from backend.models.users import User
from backend.schemas.approval_schemas import ApprovalDecision
from backend.schemas.customer_schemas import CustomerCreate
from backend.schemas.expense_schemas import (
    ExpenseCategoryCreate,
    ExpenseCreate,
    ExpenseDecision,
)
from backend.schemas.inventory_schemas import (
    StockAdjustmentCreate,
    StockTransferCreate,
    StockTransferItemCreate,
)
from backend.schemas.payments_schemas import SalePaymentCreate
from backend.schemas.products_schemas import (
    BrandCreate,
    CategoryCreate,
    ProductCreate,
    ProductImageCreate,
    ProductVariantCreate,
)
from backend.schemas.purchase_schemas import (
    GoodsReceiptCreate,
    GoodsReceiptItemCreate,
    PurchaseOrderCreate,
    PurchaseOrderItemCreate,
)
from backend.schemas.repair_schemas import (
    RepairAssignmentUpdate,
    RepairBookingCreate,
    RepairDiagnosisUpdate,
    RepairIntakeUpdate,
    RepairNote,
    RepairPartCreate,
    RepairPaymentCreate,
    RepairQuoteDecision,
    RepairStatusUpdate,
)
from backend.schemas.sales_schemas import SaleCreate, SaleItemCreate, TillCreate, TillSessionOpen
from backend.schemas.stocktake_schemas import StockCountCreate
from backend.schemas.supplier_schemas import SupplierCreate
from backend.services import (
    catalog,
    customers,
    expenses,
    inventory_control,
    purchasing,
    repair_billing,
    repairs,
    sales,
    stocktake,
    suppliers,
    tills,
    transfers,
)
from backend.services.auth import AuthPrincipal
from backend.services.bootstrap import seed_system_access
from backend.services.exceptions import ConflictError, ServiceError


DEMO_PASSWORD = "DemoPass123!"


@dataclass
class DemoSeedResult:
    created: dict[str, int] = field(default_factory=dict)
    users: dict[str, str] = field(default_factory=dict)
    branches: dict[str, str] = field(default_factory=dict)
    ids: dict[str, str] = field(default_factory=dict)
    skipped: list[str] = field(default_factory=list)

    def add(self, key: str, count: int = 1) -> None:
        self.created[key] = self.created.get(key, 0) + count

    def skip(self, message: str) -> None:
        self.skipped.append(message)


def _role(db: Session, code: str) -> Role:
    role = db.scalar(select(Role).where(Role.code == code, Role.is_deleted.is_(False)))
    if role is None:
        raise RuntimeError(f"role {code!r} was not seeded")
    return role


def _principal(db: Session, user: User, role_code: str) -> AuthPrincipal:
    role = _role(db, role_code)
    permissions = frozenset(
        db.scalars(
            select(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(
                RolePermission.role_id == role.id,
                Permission.is_deleted.is_(False),
            )
        ).all()
    )
    return AuthPrincipal(
        user_id=user.id,
        full_name=user.full_name,
        username=user.username,
        email=user.email,
        branch_id=user.branch_id,
        role_id=role.id,
        role_code=role.code,
        role_name=role.name,
        permissions=permissions,
        password_hash=user.password_hash,
        must_change_password=user.must_change_password,
    )


def _branch(
    db: Session,
    result: DemoSeedResult,
    *,
    code: str,
    name: str,
    city: str,
    headquarters: bool = False,
) -> Branch:
    normalized_code = code.strip().upper()
    branch = db.scalar(
        select(Branch).where(
            func.lower(Branch.code) == normalized_code.lower(),
            Branch.is_deleted.is_(False),
        )
    )
    if branch is None:
        branch = Branch(
            name=name,
            code=normalized_code,
            city=city,
            country="Kenya",
            is_headquarters=headquarters,
            status=BranchStatus.ACTIVE,
        )
        db.add(branch)
        db.flush()
        result.add("branches")
    else:
        branch.city = branch.city or city
        branch.country = branch.country or "Kenya"
        branch.status = BranchStatus.ACTIVE
        if headquarters:
            branch.is_headquarters = True
    result.branches[normalized_code] = str(branch.id)
    return branch


def _user(
    db: Session,
    result: DemoSeedResult,
    *,
    username: str,
    full_name: str,
    email: str,
    role_code: str,
    branch_id: UUID | None,
    password: str,
) -> User:
    normalized_username = username.strip().lower()
    normalized_email = email.strip().lower()
    user = db.scalar(
        select(User).where(
            func.lower(User.username) == normalized_username,
            User.is_deleted.is_(False),
        )
    )
    role = _role(db, role_code)
    password_hash = hash_password(password)
    if user is None:
        user = User(
            full_name=full_name,
            username=normalized_username,
            email=normalized_email,
            phone=None,
            password_hash=password_hash,
            branch_id=branch_id,
            role_id=role.id,
            is_active=True,
            is_verified=True,
            must_change_password=False,
        )
        db.add(user)
        db.flush()
        result.add("users")
    else:
        user.full_name = full_name
        user.email = normalized_email
        user.password_hash = password_hash
        user.branch_id = branch_id
        user.role_id = role.id
        user.is_active = True
        user.is_verified = True
        user.must_change_password = False
    result.users[role_code] = user.username
    return user


def _category(
    db: Session, result: DemoSeedResult, principal: AuthPrincipal, name: str, slug: str
) -> Category:
    item = db.scalar(
        select(Category).where(Category.slug == slug, Category.is_deleted.is_(False))
    )
    if item is None:
        item = catalog.create_category(
            db,
            principal,
            CategoryCreate(name=name, slug=slug, description=f"Demo {name.lower()}"),
        )
        result.add("categories")
    return item


def _brand(
    db: Session, result: DemoSeedResult, principal: AuthPrincipal, name: str
) -> Brand:
    item = db.scalar(
        select(Brand).where(
            func.lower(Brand.name) == name.lower(), Brand.is_deleted.is_(False)
        )
    )
    if item is None:
        item = catalog.create_brand(
            db, principal, BrandCreate(name=name, description=f"Demo {name} brand")
        )
        result.add("brands")
    return item


def _variant_by_sku(db: Session, sku: str) -> ProductVariant | None:
    return db.scalar(
        select(ProductVariant).where(
            func.lower(ProductVariant.sku) == sku.lower(),
            ProductVariant.is_deleted.is_(False),
        )
    )


def _product_with_variant(
    db: Session,
    result: DemoSeedResult,
    principal: AuthPrincipal,
    *,
    name: str,
    slug: str,
    category_id: UUID,
    brand_id: UUID,
    warranty_months: int,
    variant_name: str,
    sku: str,
    tracking_type: TrackingType,
    cost_price: Decimal,
    selling_price: Decimal,
    minimum_selling_price: Decimal | None = None,
) -> ProductVariant:
    variant = _variant_by_sku(db, sku)
    if variant is None:
        response = catalog.create_product(
            db,
            principal,
            ProductCreate(
                name=name,
                slug=slug,
                description=f"Demo product: {name}",
                category_id=category_id,
                brand_id=brand_id,
                warranty_months=warranty_months,
                variants=[
                    ProductVariantCreate(
                        name=variant_name,
                        sku=sku,
                        tracking_type=tracking_type,
                        cost_price=cost_price,
                        selling_price=selling_price,
                        minimum_selling_price=minimum_selling_price,
                    )
                ],
            ),
        )
        result.add("products")
        product_id = response.id
        variant = _variant_by_sku(db, sku)
        if variant is None:
            raise RuntimeError(f"created variant {sku} could not be loaded")
    else:
        product_id = variant.product_id

    image_count = db.scalar(
        select(func.count())
        .select_from(ProductImage)
        .where(ProductImage.product_id == product_id, ProductImage.is_deleted.is_(False))
    )
    if not image_count:
        catalog.create_image(
            db,
            principal,
            product_id,
            ProductImageCreate(
                url=f"https://example.com/demo/{slug}.jpg",
                alt_text=name,
                position=0,
            ),
        )
        result.add("product_images")
    product = db.get(Product, product_id)
    if product is not None and not product.is_published:
        catalog.set_publication(db, principal, product.id, True)
    result.ids[sku] = str(variant.id)
    return variant


def _supplier(
    db: Session, result: DemoSeedResult, principal: AuthPrincipal
) -> Supplier:
    item = db.scalar(
        select(Supplier).where(
            func.lower(Supplier.name) == "demo electronics supplier",
            Supplier.is_deleted.is_(False),
        )
    )
    if item is None:
        item = suppliers.create_supplier(
            db,
            principal,
            SupplierCreate(
                name="Demo Electronics Supplier",
                contact_person="Amina Mwangi",
                phone="+254700100200",
                email="supplier@example.com",
                address="Luthuli Avenue, Nairobi",
                tax_number="DEMO-SUPPLIER-001",
                payment_terms_days=14,
            ),
        )
        result.add("suppliers")
    result.ids["supplier"] = str(item.id)
    return item


def _purchase_and_stock(
    db: Session,
    result: DemoSeedResult,
    principal: AuthPrincipal,
    branch: Branch,
    supplier: Supplier,
    variants: dict[str, ProductVariant],
) -> None:
    existing = db.scalar(
        select(PurchaseOrder).where(
            PurchaseOrder.supplier_reference == "DEMO-PO-001",
            PurchaseOrder.is_deleted.is_(False),
        )
    )
    if existing is not None:
        result.ids["purchase_order"] = str(existing.id)
        receipt = db.scalar(
            select(GoodsReceipt)
            .where(
                GoodsReceipt.purchase_order_id == existing.id,
                GoodsReceipt.is_deleted.is_(False),
            )
            .order_by(GoodsReceipt.created_at.desc())
            .limit(1)
        )
        if receipt is not None:
            result.ids["goods_receipt"] = str(receipt.id)
    else:
        order = purchasing.create_purchase_order(
            db,
            principal,
            PurchaseOrderCreate(
                branch_id=branch.id,
                supplier_id=supplier.id,
                supplier_reference="DEMO-PO-001",
                notes="Demo seed opening stock",
                items=[
                    PurchaseOrderItemCreate(
                        variant_id=variants["DEMO-LAP-T480"].id,
                        ordered_quantity=2,
                        unit_cost=Decimal("35000.00"),
                    ),
                    PurchaseOrderItemCreate(
                        variant_id=variants["DEMO-PHN-A15"].id,
                        ordered_quantity=3,
                        unit_cost=Decimal("18000.00"),
                    ),
                    PurchaseOrderItemCreate(
                        variant_id=variants["DEMO-CHG-USBC20"].id,
                        ordered_quantity=20,
                        unit_cost=Decimal("800.00"),
                    ),
                    PurchaseOrderItemCreate(
                        variant_id=variants["DEMO-USB-64"].id,
                        ordered_quantity=30,
                        unit_cost=Decimal("450.00"),
                    ),
                    PurchaseOrderItemCreate(
                        variant_id=variants["DEMO-LCD-A15"].id,
                        ordered_quantity=8,
                        unit_cost=Decimal("2500.00"),
                    ),
                ],
            ),
        )
        purchasing.submit_purchase_order(db, principal, order.id)
        purchasing.approve_purchase_order(db, principal, order.id)
        order_items = list(
            db.scalars(
                select(PurchaseOrderItem).where(
                    PurchaseOrderItem.purchase_order_id == order.id,
                    PurchaseOrderItem.is_deleted.is_(False),
                )
            ).all()
        )
        receipt_items: list[GoodsReceiptItemCreate] = []
        for item in order_items:
            if item.variant_id == variants["DEMO-LAP-T480"].id:
                receipt_items.append(
                    GoodsReceiptItemCreate(
                        purchase_order_item_id=item.id,
                        quantity=item.ordered_quantity,
                        serial_numbers=["DEMO-T480-001", "DEMO-T480-002"],
                    )
                )
            elif item.variant_id == variants["DEMO-PHN-A15"].id:
                receipt_items.append(
                    GoodsReceiptItemCreate(
                        purchase_order_item_id=item.id,
                        quantity=item.ordered_quantity,
                        imeis=[
                            "356000000000001",
                            "356000000000002",
                            "356000000000003",
                        ],
                    )
                )
            else:
                receipt_items.append(
                    GoodsReceiptItemCreate(
                        purchase_order_item_id=item.id,
                        quantity=item.ordered_quantity,
                    )
                )
        receipt = purchasing.receive_purchase_order(
            db,
            principal,
            order.id,
            GoodsReceiptCreate(
                supplier_delivery_note="DEMO-DN-001",
                notes="Demo seed receipt",
                items=receipt_items,
            ),
        )
        result.add("purchase_orders")
        result.add("goods_receipts")
        result.ids["purchase_order"] = str(order.id)
        result.ids["goods_receipt"] = str(receipt.id)

    reorder_levels = {
        "DEMO-CHG-USBC20": 5,
        "DEMO-USB-64": 10,
        "DEMO-LCD-A15": 3,
    }
    for sku, reorder_level in reorder_levels.items():
        balance = db.scalar(
            select(StockBalance).where(
                StockBalance.branch_id == branch.id,
                StockBalance.variant_id == variants[sku].id,
                StockBalance.is_deleted.is_(False),
            )
        )
        if balance is not None:
            balance.reorder_level = reorder_level


def _till_and_session(
    db: Session,
    result: DemoSeedResult,
    manager: AuthPrincipal,
    cashier: AuthPrincipal,
    branch: Branch,
) -> TillSession | None:
    till = db.scalar(
        select(Till).where(Till.code == "DEMO-HQ-01", Till.is_deleted.is_(False))
    )
    if till is None:
        till = tills.create_till(
            db,
            manager,
            TillCreate(branch_id=branch.id, name="Demo Main POS", code="DEMO-HQ-01"),
        )
        result.add("tills")
    result.ids["till"] = str(till.id)

    session = db.scalar(
        select(TillSession).where(
            TillSession.cashier_id == cashier.user_id,
            TillSession.status == TillSessionStatus.OPEN,
            TillSession.is_deleted.is_(False),
        )
    )
    if session is not None:
        result.ids["till_session"] = str(session.id)
        return session

    till_open = db.scalar(
        select(TillSession.id).where(
            TillSession.till_id == till.id,
            TillSession.status == TillSessionStatus.OPEN,
            TillSession.is_deleted.is_(False),
        )
    )
    if till_open is not None:
        result.skip("demo till already has an open session owned by another user")
        return None

    session = tills.open_session(
        db,
        cashier,
        TillSessionOpen(till_id=till.id, opening_float=Decimal("1000.00")),
    )
    result.add("till_sessions")
    result.ids["till_session"] = str(session.id)
    return session


def _customer(
    db: Session, result: DemoSeedResult, principal: AuthPrincipal, branch: Branch
) -> Customer:
    customer = db.scalar(
        select(Customer).where(
            Customer.phone == "+254711000111",
            Customer.is_deleted.is_(False),
        )
    )
    if customer is None:
        customer = customers.create_customer(
            db,
            principal,
            CustomerCreate(
                full_name="Demo Customer",
                phone="+254711000111",
                email="customer@example.com",
                address="Nairobi CBD",
                home_branch_id=branch.id,
            ),
        )
        result.add("customers")
    result.ids["customer"] = str(customer.id)
    return customer


def _available_unit(
    db: Session, branch_id: UUID, variant_id: UUID
) -> SerializedUnit | None:
    return db.scalar(
        select(SerializedUnit)
        .where(
            SerializedUnit.branch_id == branch_id,
            SerializedUnit.variant_id == variant_id,
            SerializedUnit.status == SerializedUnitStatus.AVAILABLE,
            SerializedUnit.is_deleted.is_(False),
        )
        .order_by(SerializedUnit.created_at)
        .limit(1)
    )


def _pos_sale(
    db: Session,
    result: DemoSeedResult,
    cashier: AuthPrincipal,
    branch: Branch,
    customer: Customer,
    session: TillSession | None,
    variants: dict[str, ProductVariant],
) -> SerializedUnit | None:
    existing = db.scalar(
        select(Sale).where(
            Sale.notes == "DEMO-SEED-SALE",
            Sale.is_deleted.is_(False),
        )
    )
    if existing is not None:
        result.ids["sale"] = str(existing.id)
        return db.scalar(
            select(SerializedUnit)
            .where(
                SerializedUnit.id.in_(
                    select(SerializedUnit.id)
                    .where(SerializedUnit.variant_id == variants["DEMO-PHN-A15"].id)
                ),
                SerializedUnit.status == SerializedUnitStatus.SOLD,
                SerializedUnit.is_deleted.is_(False),
            )
            .limit(1)
        )
    if session is None:
        result.skip("POS sale skipped because no demo till session is available")
        return None

    phone_unit = _available_unit(db, branch.id, variants["DEMO-PHN-A15"].id)
    items = [
        SaleItemCreate(
            variant_id=variants["DEMO-CHG-USBC20"].id,
            quantity=2,
        )
    ]
    if phone_unit is not None:
        items.insert(
            0,
            SaleItemCreate(
                variant_id=variants["DEMO-PHN-A15"].id,
                serialized_unit_id=phone_unit.id,
                quantity=1,
            ),
        )
    sale = sales.create_sale(
        db,
        cashier,
        SaleCreate(
            branch_id=branch.id,
            customer_id=customer.id,
            till_session_id=session.id,
            channel=SaleChannel.POS,
            notes="DEMO-SEED-SALE",
            items=items,
        ),
    )
    sales.add_payment(
        db,
        cashier,
        sale.id,
        SalePaymentCreate(
            method=PaymentMethod.CASH,
            amount=sale.total_amount,
            idempotency_key="demo-sale-payment-001",
            notes="Demo seed sale payment",
        ),
    )
    result.add("sales")
    result.add("sale_payments")
    result.ids["sale"] = str(sale.id)
    return phone_unit


def _inventory_workflows(
    db: Session,
    result: DemoSeedResult,
    manager: AuthPrincipal,
    source_branch: Branch,
    destination_branch: Branch,
    variants: dict[str, ProductVariant],
) -> None:
    existing_adjustment = db.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.action == "inventory.adjust",
            ApprovalRequest.reason == "DEMO-SEED-ADJUSTMENT",
            ApprovalRequest.is_deleted.is_(False),
        )
    )
    if existing_adjustment is None:
        request = inventory_control.request_adjustment(
            db,
            manager,
            StockAdjustmentCreate(
                branch_id=source_branch.id,
                variant_id=variants["DEMO-USB-64"].id,
                quantity_delta=1,
                reason="DEMO-SEED-ADJUSTMENT",
            ),
        )
        result.add("adjustment_requests")
        result.ids["adjustment_request"] = str(request.id)
    else:
        result.ids["adjustment_request"] = str(existing_adjustment.id)

    existing_transfer = db.scalar(
        select(StockTransfer).where(
            StockTransfer.notes == "DEMO-SEED-TRANSFER",
            StockTransfer.is_deleted.is_(False),
        )
    )
    if existing_transfer is None:
        try:
            transfer = transfers.create_transfer(
                db,
                manager,
                StockTransferCreate(
                    source_branch_id=source_branch.id,
                    destination_branch_id=destination_branch.id,
                    notes="DEMO-SEED-TRANSFER",
                    items=[
                        StockTransferItemCreate(
                            variant_id=variants["DEMO-USB-64"].id,
                            quantity=1,
                        )
                    ],
                ),
            )
            result.add("stock_transfers")
            result.ids["stock_transfer"] = str(transfer.id)
        except ServiceError as exc:
            result.skip(f"stock transfer skipped: {exc}")
    else:
        result.ids["stock_transfer"] = str(existing_transfer.id)

    existing_count = db.scalar(
        select(StockCount).where(
            StockCount.notes == "DEMO-SEED-STOCK-COUNT",
            StockCount.is_deleted.is_(False),
        )
    )
    if existing_count is None:
        open_count = db.scalar(
            select(StockCount.id).where(
                StockCount.branch_id == source_branch.id,
                StockCount.status.in_(
                    [StockCountStatus.DRAFT, StockCountStatus.SUBMITTED]
                ),
                StockCount.is_deleted.is_(False),
            )
        )
        if open_count is None:
            count = stocktake.create_stock_count(
                db,
                manager,
                StockCountCreate(
                    branch_id=source_branch.id,
                    variant_ids=[
                        variants["DEMO-CHG-USBC20"].id,
                        variants["DEMO-USB-64"].id,
                    ],
                    notes="DEMO-SEED-STOCK-COUNT",
                ),
            )
            result.add("stock_counts")
            result.ids["stock_count"] = str(count.id)
        else:
            result.skip("stock count skipped because branch already has an open count")
    else:
        result.ids["stock_count"] = str(existing_count.id)


def _repair_workflow(
    db: Session,
    result: DemoSeedResult,
    manager: AuthPrincipal,
    technician: AuthPrincipal,
    cashier: AuthPrincipal,
    branch: Branch,
    customer: Customer,
    session: TillSession | None,
    customer_device_unit: SerializedUnit | None,
    variants: dict[str, ProductVariant],
) -> None:
    existing = db.scalar(
        select(RepairTicket).where(
            RepairTicket.reported_issue == "DEMO-SEED-REPAIR",
            RepairTicket.is_deleted.is_(False),
        )
    )
    if existing is not None:
        result.ids["repair_ticket"] = str(existing.id)
        return
    if session is None:
        result.skip("repair payment skipped because no demo till session is available")

    ticket = repairs.create_booking(
        db,
        manager,
        RepairBookingCreate(
            branch_id=branch.id,
            customer_id=customer.id,
            device_type="phone",
            device_brand="Samsung",
            device_model="Galaxy A15",
            imei=customer_device_unit.imei if customer_device_unit else None,
            serial_number=(
                customer_device_unit.serial_number if customer_device_unit else None
            ),
            reported_issue="DEMO-SEED-REPAIR",
        ),
    )
    repairs.record_intake(
        db,
        manager,
        ticket.id,
        RepairIntakeUpdate(
            serialized_unit_id=customer_device_unit.id if customer_device_unit else None,
            intake_condition="Screen cracked; device powers on.",
            accessories_received=["protective case"],
        ),
    )
    repairs.assign_technician(
        db,
        manager,
        ticket.id,
        RepairAssignmentUpdate(technician_id=technician.user_id),
    )
    repairs.submit_diagnosis(
        db,
        technician,
        ticket.id,
        RepairDiagnosisUpdate(
            diagnosis="Screen assembly replacement required.",
            labor_estimate=Decimal("1500.00"),
            parts_estimate=Decimal("4500.00"),
        ),
    )
    repairs.decide_quote(
        db,
        technician,
        ticket.id,
        RepairQuoteDecision(approved=True, note="Demo customer approved quote"),
    )
    repairs.update_status(
        db,
        technician,
        ticket.id,
        RepairStatusUpdate(status=RepairStatus.REPAIRING, note="Repair started"),
    )
    try:
        repairs.add_part(
            db,
            technician,
            ticket.id,
            RepairPartCreate(
                variant_id=variants["DEMO-LCD-A15"].id,
                quantity=1,
            ),
        )
    except ServiceError as exc:
        result.skip(f"repair part skipped: {exc}")
    repairs.mark_ready(
        db,
        technician,
        ticket.id,
        "Demo repair completed and ready",
    )
    result.add("repair_tickets")
    result.ids["repair_ticket"] = str(ticket.id)

    if session is not None:
        invoice = repair_billing.invoice(db, cashier, ticket.id)
        if invoice.balance_due > 0:
            repair_billing.add_payment(
                db,
                cashier,
                ticket.id,
                RepairPaymentCreate(
                    till_session_id=session.id,
                    method=PaymentMethod.CASH,
                    amount=invoice.balance_due,
                    idempotency_key="demo-repair-payment-001",
                    notes="Demo repair payment",
                ),
            )
            result.add("repair_payments")


def _expenses(
    db: Session,
    result: DemoSeedResult,
    manager: AuthPrincipal,
    branch: Branch,
) -> None:
    category = db.scalar(
        select(ExpenseCategory).where(
            func.lower(ExpenseCategory.name) == "rent",
            ExpenseCategory.is_deleted.is_(False),
        )
    )
    if category is None:
        category = expenses.create_category(
            db,
            manager,
            ExpenseCategoryCreate(name="Rent", description="Branch rent expenses"),
        )
        result.add("expense_categories")
    result.ids["expense_category"] = str(category.id)

    expense = db.scalar(
        select(Expense).where(
            Expense.description == "DEMO-SEED-EXPENSE",
            Expense.is_deleted.is_(False),
        )
    )
    if expense is None:
        expense = expenses.create_expense(
            db,
            manager,
            ExpenseCreate(
                branch_id=branch.id,
                category_id=category.id,
                description="DEMO-SEED-EXPENSE",
                amount=Decimal("25000.00"),
                payment_method=PaymentMethod.BANK_TRANSFER,
                reference_number="DEMO-EXP-001",
                notes="Demo monthly rent",
            ),
        )
        expenses.approve_expense(
            db,
            manager,
            expense.id,
            ExpenseDecision(notes="Demo approved expense"),
        )
        result.add("expenses")
    result.ids["expense"] = str(expense.id)


def seed_demo_data(db: Session, *, password: str = DEMO_PASSWORD) -> DemoSeedResult:
    """Seed a coherent demo dataset for the staff API.

    The seed is intentionally idempotent. Re-running it updates demo users and reuses
    existing demo records instead of creating duplicates.
    """

    result = DemoSeedResult()
    seed_system_access(db)

    hq = _branch(
        db,
        result,
        code="HQ",
        name="Demo Main Branch",
        city="Nairobi",
        headquarters=True,
    )
    east = _branch(
        db,
        result,
        code="EAST",
        name="Demo East Branch",
        city="Nairobi",
    )

    admin_user = _user(
        db,
        result,
        username="demo_admin",
        full_name="Demo Admin",
        email="demo.admin@example.com",
        role_code=ADMIN,
        branch_id=hq.id,
        password=password,
    )
    manager_user = _user(
        db,
        result,
        username="demo_manager",
        full_name="Demo Branch Manager",
        email="demo.manager@example.com",
        role_code=BRANCH_MANAGER,
        branch_id=hq.id,
        password=password,
    )
    _user(
        db,
        result,
        username="demo_inventory",
        full_name="Demo Inventory Manager",
        email="demo.inventory@example.com",
        role_code=INVENTORY_MANAGER,
        branch_id=hq.id,
        password=password,
    )
    technician_user = _user(
        db,
        result,
        username="demo_technician",
        full_name="Demo Technician",
        email="demo.technician@example.com",
        role_code=TECHNICIAN,
        branch_id=hq.id,
        password=password,
    )
    cashier_user = _user(
        db,
        result,
        username="demo_cashier",
        full_name="Demo Cashier",
        email="demo.cashier@example.com",
        role_code=CASHIER,
        branch_id=hq.id,
        password=password,
    )
    _user(
        db,
        result,
        username="demo_accountant",
        full_name="Demo Accountant",
        email="demo.accountant@example.com",
        role_code=ACCOUNTANT,
        branch_id=hq.id,
        password=password,
    )
    db.flush()

    admin = _principal(db, admin_user, ADMIN)
    manager = _principal(db, manager_user, BRANCH_MANAGER)
    technician = _principal(db, technician_user, TECHNICIAN)
    cashier = _principal(db, cashier_user, CASHIER)

    categories = {
        "laptops": _category(db, result, admin, "Laptops", "demo-laptops"),
        "phones": _category(db, result, admin, "Phones", "demo-phones"),
        "accessories": _category(
            db, result, admin, "Accessories", "demo-accessories"
        ),
        "parts": _category(db, result, admin, "Repair Parts", "demo-repair-parts"),
    }
    brands = {
        "lenovo": _brand(db, result, admin, "Lenovo Demo"),
        "samsung": _brand(db, result, admin, "Samsung Demo"),
        "oraimo": _brand(db, result, admin, "Oraimo Demo"),
        "kingston": _brand(db, result, admin, "Kingston Demo"),
        "generic": _brand(db, result, admin, "Generic Demo Parts"),
    }
    variants = {
        "DEMO-LAP-T480": _product_with_variant(
            db,
            result,
            admin,
            name="Demo Lenovo ThinkPad T480",
            slug="demo-lenovo-thinkpad-t480",
            category_id=categories["laptops"].id,
            brand_id=brands["lenovo"].id,
            warranty_months=6,
            variant_name="Core i5 / 8GB / 256GB",
            sku="DEMO-LAP-T480",
            tracking_type=TrackingType.SERIAL,
            cost_price=Decimal("35000.00"),
            selling_price=Decimal("52000.00"),
            minimum_selling_price=Decimal("48000.00"),
        ),
        "DEMO-PHN-A15": _product_with_variant(
            db,
            result,
            admin,
            name="Demo Samsung Galaxy A15",
            slug="demo-samsung-galaxy-a15",
            category_id=categories["phones"].id,
            brand_id=brands["samsung"].id,
            warranty_months=12,
            variant_name="128GB Dual SIM",
            sku="DEMO-PHN-A15",
            tracking_type=TrackingType.IMEI,
            cost_price=Decimal("18000.00"),
            selling_price=Decimal("25000.00"),
            minimum_selling_price=Decimal("23500.00"),
        ),
        "DEMO-CHG-USBC20": _product_with_variant(
            db,
            result,
            admin,
            name="Demo Oraimo USB-C Charger",
            slug="demo-oraimo-usb-c-charger",
            category_id=categories["accessories"].id,
            brand_id=brands["oraimo"].id,
            warranty_months=3,
            variant_name="20W USB-C",
            sku="DEMO-CHG-USBC20",
            tracking_type=TrackingType.BULK,
            cost_price=Decimal("800.00"),
            selling_price=Decimal("1500.00"),
            minimum_selling_price=Decimal("1200.00"),
        ),
        "DEMO-USB-64": _product_with_variant(
            db,
            result,
            admin,
            name="Demo Kingston 64GB Flash Disk",
            slug="demo-kingston-64gb-flash-disk",
            category_id=categories["accessories"].id,
            brand_id=brands["kingston"].id,
            warranty_months=1,
            variant_name="64GB USB 3.0",
            sku="DEMO-USB-64",
            tracking_type=TrackingType.BULK,
            cost_price=Decimal("450.00"),
            selling_price=Decimal("900.00"),
            minimum_selling_price=Decimal("750.00"),
        ),
        "DEMO-LCD-A15": _product_with_variant(
            db,
            result,
            admin,
            name="Demo Galaxy A15 Screen Assembly",
            slug="demo-galaxy-a15-screen-assembly",
            category_id=categories["parts"].id,
            brand_id=brands["generic"].id,
            warranty_months=0,
            variant_name="Replacement LCD",
            sku="DEMO-LCD-A15",
            tracking_type=TrackingType.BULK,
            cost_price=Decimal("2500.00"),
            selling_price=Decimal("4500.00"),
        ),
    }

    supplier = _supplier(db, result, admin)
    _purchase_and_stock(db, result, admin, hq, supplier, variants)
    session = _till_and_session(db, result, manager, cashier, hq)
    customer = _customer(db, result, cashier, hq)
    sold_unit = _pos_sale(db, result, cashier, hq, customer, session, variants)
    _inventory_workflows(db, result, manager, hq, east, variants)
    _repair_workflow(
        db,
        result,
        manager,
        technician,
        cashier,
        hq,
        customer,
        session,
        sold_unit,
        variants,
    )
    _expenses(db, result, manager, hq)
    db.flush()
    return result
