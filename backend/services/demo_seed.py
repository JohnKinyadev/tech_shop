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


def _soft_delete_legacy_demo_users(db: Session) -> None:
    legacy_usernames = {
        "demo_admin",
        "demo_manager",
        "demo_inventory",
        "demo_technician",
        "demo_cashier",
        "demo_accountant",
    }
    users = db.scalars(
        select(User).where(
            func.lower(User.username).in_(legacy_usernames),
            User.is_deleted.is_(False),
        )
    ).all()
    for user in users:
        user.is_active = False
        user.is_deleted = True


def _soft_delete_legacy_demo_catalog(db: Session) -> None:
    legacy_brand_names = {
        "lenovo demo",
        "samsung demo",
        "oraimo demo",
        "kingston demo",
        "generic demo parts",
    }

    for brand in db.scalars(
        select(Brand).where(
            func.lower(Brand.name).in_(legacy_brand_names),
            Brand.is_deleted.is_(False),
        )
    ):
        brand.is_active = False
        brand.is_deleted = True


def _category(
    db: Session, result: DemoSeedResult, principal: AuthPrincipal, name: str, slug: str
) -> Category:
    item = db.scalar(
        select(Category).where(
            (
                (Category.slug == slug)
                | (func.lower(Category.name) == name.strip().lower())
            ),
            Category.is_deleted.is_(False),
        )
    )
    if item is None:
        item = catalog.create_category(
            db,
            principal,
            CategoryCreate(name=name, slug=slug, description=f"Seeded {name.lower()}"),
        )
        result.add("categories")
    else:
        item.name = name
        item.slug = slug
        item.description = f"Seeded {name.lower()}"
        item.is_active = True
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
            db, principal, BrandCreate(name=name, description=f"Seeded {name} brand")
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


def _product_by_slug(db: Session, slug: str) -> Product | None:
    return db.scalar(
        select(Product).where(
            func.lower(Product.slug) == slug.lower(),
            Product.is_deleted.is_(False),
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
    attributes: dict[str, str] | None = None,
) -> ProductVariant:
    normalized_sku = sku.strip().upper()
    variant = _variant_by_sku(db, normalized_sku)
    product: Product | None = None
    variant_payload = ProductVariantCreate(
        name=variant_name,
        sku=normalized_sku,
        tracking_type=tracking_type,
        attributes=attributes or {},
        cost_price=cost_price,
        selling_price=selling_price,
        minimum_selling_price=minimum_selling_price,
    )
    if variant is None:
        product = _product_by_slug(db, slug)
        if product is None:
            response = catalog.create_product(
                db,
                principal,
                ProductCreate(
                    name=name,
                    slug=slug,
                    description=f"Seeded product: {name}",
                    category_id=category_id,
                    brand_id=brand_id,
                    warranty_months=warranty_months,
                    variants=[variant_payload],
                ),
            )
            result.add("products")
            product_id = response.id
            variant = _variant_by_sku(db, normalized_sku)
        else:
            product.name = name
            product.description = f"Seeded product: {name}"
            product.category_id = category_id
            product.brand_id = brand_id
            product.warranty_months = warranty_months
            product.is_active = True
            variant = catalog.create_variant(db, principal, product.id, variant_payload)
            product_id = product.id
            result.add("product_variants")
        if variant is None:
            raise RuntimeError(f"created variant {normalized_sku} could not be loaded")
    else:
        product_id = variant.product_id
        product = db.scalar(
            select(Product).where(
                Product.id == product_id,
                Product.is_deleted.is_(False),
            )
        )
        if product is not None:
            product.name = name
            product.slug = slug
            product.description = f"Seeded product: {name}"
            product.category_id = category_id
            product.brand_id = brand_id
            product.warranty_months = warranty_months
            product.is_active = True
        variant.name = variant_name
        variant.tracking_type = tracking_type
        variant.attributes = attributes or {}
        variant.cost_price = cost_price
        variant.selling_price = selling_price
        variant.minimum_selling_price = minimum_selling_price
        variant.is_active = True

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
    result.ids[normalized_sku] = str(variant.id)
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


def _catalog_logic_purchase_and_stock(
    db: Session,
    result: DemoSeedResult,
    principal: AuthPrincipal,
    branch: Branch,
    supplier: Supplier,
    variants: dict[str, ProductVariant],
) -> None:
    supplier_reference = "DEMO-PO-CATALOG-LOGIC-001"
    existing = db.scalar(
        select(PurchaseOrder).where(
            PurchaseOrder.supplier_reference == supplier_reference,
            PurchaseOrder.is_deleted.is_(False),
        )
    )
    if existing is not None:
        result.ids["catalog_logic_purchase_order"] = str(existing.id)
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
            result.ids["catalog_logic_goods_receipt"] = str(receipt.id)
        return

    opening_stock = {
        "DEMO-LAP-HP840-G6": {
            "quantity": 2,
            "unit_cost": Decimal("38000.00"),
            "serial_numbers": ["DEMO-HP840G6-001", "DEMO-HP840G6-002"],
        },
        "DEMO-LAP-MBA13-2017": {
            "quantity": 1,
            "unit_cost": Decimal("42000.00"),
            "serial_numbers": ["DEMO-MBA13-2017-001"],
        },
        "DEMO-PHN-A15-6-128-BLU": {
            "quantity": 2,
            "unit_cost": Decimal("19500.00"),
            "imeis": ["356000000000101", "356000000000102"],
        },
        "DEMO-PHN-HOT40I-128": {
            "quantity": 3,
            "unit_cost": Decimal("13000.00"),
            "imeis": [
                "352000000000101",
                "352000000000102",
                "352000000000103",
            ],
        },
        "DEMO-PHN-IP11-64": {
            "quantity": 1,
            "unit_cost": Decimal("33000.00"),
            "imeis": ["353000000000101"],
        },
        "DEMO-CBL-TYPEC-1M": {
            "quantity": 40,
            "unit_cost": Decimal("180.00"),
        },
        "DEMO-PBANK-OR20K": {
            "quantity": 10,
            "unit_cost": Decimal("2200.00"),
        },
        "DEMO-MSD-SD128": {
            "quantity": 25,
            "unit_cost": Decimal("700.00"),
        },
        "DEMO-BAT-IP11": {
            "quantity": 12,
            "unit_cost": Decimal("1800.00"),
        },
        "DEMO-PORT-TYPEC": {
            "quantity": 30,
            "unit_cost": Decimal("250.00"),
        },
    }
    order = purchasing.create_purchase_order(
        db,
        principal,
        PurchaseOrderCreate(
            branch_id=branch.id,
            supplier_id=supplier.id,
            supplier_reference=supplier_reference,
            notes=(
                "Demo catalog logic seed: serial, IMEI, and bulk items for "
                "understanding catalog-to-inventory flow"
            ),
            items=[
                PurchaseOrderItemCreate(
                    variant_id=variants[sku].id,
                    ordered_quantity=int(item["quantity"]),
                    unit_cost=item["unit_cost"],
                )
                for sku, item in opening_stock.items()
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
    sku_by_variant_id = {variant.id: sku for sku, variant in variants.items()}
    receipt_items = []
    for item in order_items:
        sku = sku_by_variant_id[item.variant_id]
        stock_item = opening_stock[sku]
        receipt_items.append(
            GoodsReceiptItemCreate(
                purchase_order_item_id=item.id,
                quantity=int(stock_item["quantity"]),
                serial_numbers=stock_item.get("serial_numbers", []),
                imeis=stock_item.get("imeis", []),
            )
        )
    receipt = purchasing.receive_purchase_order(
        db,
        principal,
        order.id,
        GoodsReceiptCreate(
            supplier_delivery_note="DEMO-DN-CATALOG-LOGIC-001",
            notes="Demo receipt showing serial, IMEI, and bulk stock capture",
            items=receipt_items,
        ),
    )
    result.add("purchase_orders")
    result.add("goods_receipts")
    result.ids["catalog_logic_purchase_order"] = str(order.id)
    result.ids["catalog_logic_goods_receipt"] = str(receipt.id)

    reorder_levels = {
        "DEMO-CBL-TYPEC-1M": 12,
        "DEMO-PBANK-OR20K": 4,
        "DEMO-MSD-SD128": 8,
        "DEMO-BAT-IP11": 3,
        "DEMO-PORT-TYPEC": 8,
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
        select(Till).where(
            Till.code.in_(("HQ-POS-01", "DEMO-HQ-01")),
            Till.is_deleted.is_(False),
        )
    )
    if till is None:
        till = tills.create_till(
            db,
            manager,
            TillCreate(branch_id=branch.id, name="Main POS", code="HQ-POS-01"),
        )
        result.add("tills")
    else:
        till.name = "Main POS"
        till.code = "HQ-POS-01"
        till.branch_id = branch.id
        till.is_active = True
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
        select(TillSession).where(
            TillSession.till_id == till.id,
            TillSession.status == TillSessionStatus.OPEN,
            TillSession.is_deleted.is_(False),
        )
    )
    if till_open is not None:
        legacy_cashier = db.get(User, till_open.cashier_id)
        legacy_usernames = {
            "demo_admin",
            "demo_manager",
            "demo_inventory",
            "demo_technician",
            "demo_cashier",
            "demo_accountant",
        }
        if (
            legacy_cashier is not None
            and (
                legacy_cashier.is_deleted
                or not legacy_cashier.is_active
                or legacy_cashier.username in legacy_usernames
            )
        ):
            till_open.status = TillSessionStatus.CLOSED
            till_open.closed_at = datetime.now(timezone.utc)
            till_open.expected_cash = till_open.opening_float
            till_open.closing_cash = till_open.opening_float
            db.flush()
        else:
            result.skip("sample till already has an open session owned by another user")
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
        cashier,
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

    The seed is intentionally idempotent. Re-running it updates sample users and reuses
    existing sample records instead of creating duplicates.
    """

    result = DemoSeedResult()
    seed_system_access(db)

    hq = _branch(
        db,
        result,
        code="HQ",
        name="Main Branch",
        city="Nairobi",
        headquarters=True,
    )
    east = _branch(
        db,
        result,
        code="EAST",
        name="East Branch",
        city="Nairobi",
    )

    admin_user = _user(
        db,
        result,
        username="admin1",
        full_name="Admin 1",
        email="admin1@example.com",
        role_code=ADMIN,
        branch_id=hq.id,
        password=password,
    )
    _user(
        db,
        result,
        username="admin2",
        full_name="Admin 2",
        email="admin2@example.com",
        role_code=ADMIN,
        branch_id=None,
        password=password,
    )
    manager_user = _user(
        db,
        result,
        username="manager1",
        full_name="Manager 1",
        email="manager1@example.com",
        role_code=BRANCH_MANAGER,
        branch_id=hq.id,
        password=password,
    )
    _user(
        db,
        result,
        username="manager2",
        full_name="Manager 2",
        email="manager2@example.com",
        role_code=BRANCH_MANAGER,
        branch_id=east.id,
        password=password,
    )
    _user(
        db,
        result,
        username="inventory1",
        full_name="Inventory 1",
        email="inventory1@example.com",
        role_code=INVENTORY_MANAGER,
        branch_id=hq.id,
        password=password,
    )
    technician_user = _user(
        db,
        result,
        username="technician1",
        full_name="Technician 1",
        email="technician1@example.com",
        role_code=TECHNICIAN,
        branch_id=hq.id,
        password=password,
    )
    cashier_user = _user(
        db,
        result,
        username="cashier1",
        full_name="Cashier 1",
        email="cashier1@example.com",
        role_code=CASHIER,
        branch_id=hq.id,
        password=password,
    )
    _user(
        db,
        result,
        username="cashier2",
        full_name="Cashier 2",
        email="cashier2@example.com",
        role_code=CASHIER,
        branch_id=east.id,
        password=password,
    )
    _user(
        db,
        result,
        username="accountant1",
        full_name="Accountant 1",
        email="accountant1@example.com",
        role_code=ACCOUNTANT,
        branch_id=hq.id,
        password=password,
    )
    _soft_delete_legacy_demo_users(db)
    db.flush()

    admin = _principal(db, admin_user, ADMIN)
    manager = _principal(db, manager_user, BRANCH_MANAGER)
    technician = _principal(db, technician_user, TECHNICIAN)
    cashier = _principal(db, cashier_user, CASHIER)

    _soft_delete_legacy_demo_catalog(db)

    categories = {
        "laptops": _category(db, result, admin, "Laptops", "laptops"),
        "phones": _category(db, result, admin, "Phones", "phones"),
        "accessories": _category(
            db, result, admin, "Accessories", "accessories"
        ),
        "parts": _category(db, result, admin, "Repair Parts", "repair-parts"),
    }
    brands = {
        "apple": _brand(db, result, admin, "Apple"),
        "hp": _brand(db, result, admin, "HP"),
        "infinix": _brand(db, result, admin, "Infinix"),
        "lenovo": _brand(db, result, admin, "Lenovo"),
        "samsung": _brand(db, result, admin, "Samsung"),
        "oraimo": _brand(db, result, admin, "Oraimo"),
        "kingston": _brand(db, result, admin, "Kingston"),
        "sandisk": _brand(db, result, admin, "SanDisk"),
        "generic": _brand(db, result, admin, "Generic Parts"),
    }
    variants = {
        "DEMO-LAP-T480": _product_with_variant(
            db,
            result,
            admin,
            name="Lenovo ThinkPad T480",
            slug="lenovo-thinkpad-t480",
            category_id=categories["laptops"].id,
            brand_id=brands["lenovo"].id,
            warranty_months=6,
            variant_name="Core i5 / 8GB / 256GB",
            sku="DEMO-LAP-T480",
            tracking_type=TrackingType.SERIAL,
            cost_price=Decimal("35000.00"),
            selling_price=Decimal("52000.00"),
            minimum_selling_price=Decimal("48000.00"),
            attributes={
                "processor": "Intel Core i5",
                "ram": "8GB",
                "storage": "256GB SSD",
                "condition": "Ex-UK Grade A",
            },
        ),
        "DEMO-LAP-HP840-G6": _product_with_variant(
            db,
            result,
            admin,
            name="HP EliteBook 840 G6",
            slug="hp-elitebook-840-g6",
            category_id=categories["laptops"].id,
            brand_id=brands["hp"].id,
            warranty_months=6,
            variant_name="Core i5 / 8GB / 256GB SSD",
            sku="DEMO-LAP-HP840-G6",
            tracking_type=TrackingType.SERIAL,
            cost_price=Decimal("38000.00"),
            selling_price=Decimal("56000.00"),
            minimum_selling_price=Decimal("52000.00"),
            attributes={
                "processor": "Intel Core i5",
                "ram": "8GB",
                "storage": "256GB SSD",
                "condition": "Ex-UK Grade A",
            },
        ),
        "DEMO-LAP-MBA13-2017": _product_with_variant(
            db,
            result,
            admin,
            name="Apple MacBook Air 13",
            slug="apple-macbook-air-13-2017",
            category_id=categories["laptops"].id,
            brand_id=brands["apple"].id,
            warranty_months=3,
            variant_name="2017 / Core i5 / 8GB / 128GB",
            sku="DEMO-LAP-MBA13-2017",
            tracking_type=TrackingType.SERIAL,
            cost_price=Decimal("42000.00"),
            selling_price=Decimal("65000.00"),
            minimum_selling_price=Decimal("60000.00"),
            attributes={
                "year": "2017",
                "processor": "Intel Core i5",
                "ram": "8GB",
                "storage": "128GB SSD",
                "condition": "Pre-owned",
            },
        ),
        "DEMO-PHN-A15": _product_with_variant(
            db,
            result,
            admin,
            name="Samsung Galaxy A15",
            slug="samsung-galaxy-a15",
            category_id=categories["phones"].id,
            brand_id=brands["samsung"].id,
            warranty_months=12,
            variant_name="4GB / 128GB / Black",
            sku="DEMO-PHN-A15",
            tracking_type=TrackingType.IMEI,
            cost_price=Decimal("18000.00"),
            selling_price=Decimal("25000.00"),
            minimum_selling_price=Decimal("23500.00"),
            attributes={
                "ram": "4GB",
                "rom": "128GB",
                "color": "Black",
                "sim": "Dual SIM",
            },
        ),
        "DEMO-PHN-A15-6-128-BLU": _product_with_variant(
            db,
            result,
            admin,
            name="Samsung Galaxy A15",
            slug="samsung-galaxy-a15",
            category_id=categories["phones"].id,
            brand_id=brands["samsung"].id,
            warranty_months=12,
            variant_name="6GB / 128GB / Blue",
            sku="DEMO-PHN-A15-6-128-BLU",
            tracking_type=TrackingType.IMEI,
            cost_price=Decimal("19500.00"),
            selling_price=Decimal("27500.00"),
            minimum_selling_price=Decimal("25500.00"),
            attributes={
                "ram": "6GB",
                "rom": "128GB",
                "color": "Blue",
                "sim": "Dual SIM",
            },
        ),
        "DEMO-PHN-HOT40I-128": _product_with_variant(
            db,
            result,
            admin,
            name="Infinix Hot 40i",
            slug="infinix-hot-40i",
            category_id=categories["phones"].id,
            brand_id=brands["infinix"].id,
            warranty_months=12,
            variant_name="4GB / 128GB / Palm Blue",
            sku="DEMO-PHN-HOT40I-128",
            tracking_type=TrackingType.IMEI,
            cost_price=Decimal("13000.00"),
            selling_price=Decimal("17500.00"),
            minimum_selling_price=Decimal("16500.00"),
            attributes={
                "ram": "4GB",
                "rom": "128GB",
                "color": "Palm Blue",
                "sim": "Dual SIM",
            },
        ),
        "DEMO-PHN-IP11-64": _product_with_variant(
            db,
            result,
            admin,
            name="Apple iPhone 11",
            slug="apple-iphone-11",
            category_id=categories["phones"].id,
            brand_id=brands["apple"].id,
            warranty_months=3,
            variant_name="64GB / Black",
            sku="DEMO-PHN-IP11-64",
            tracking_type=TrackingType.IMEI,
            cost_price=Decimal("33000.00"),
            selling_price=Decimal("48000.00"),
            minimum_selling_price=Decimal("45000.00"),
            attributes={
                "rom": "64GB",
                "color": "Black",
                "condition": "Pre-owned",
            },
        ),
        "DEMO-CHG-USBC20": _product_with_variant(
            db,
            result,
            admin,
            name="Oraimo USB-C Charger",
            slug="oraimo-usb-c-charger",
            category_id=categories["accessories"].id,
            brand_id=brands["oraimo"].id,
            warranty_months=3,
            variant_name="20W USB-C",
            sku="DEMO-CHG-USBC20",
            tracking_type=TrackingType.BULK,
            cost_price=Decimal("800.00"),
            selling_price=Decimal("1500.00"),
            minimum_selling_price=Decimal("1200.00"),
            attributes={
                "watts": "20W",
                "connector": "USB-C",
                "tracking": "Quantity only",
            },
        ),
        "DEMO-CBL-TYPEC-1M": _product_with_variant(
            db,
            result,
            admin,
            name="Oraimo Type-C Cable",
            slug="oraimo-type-c-cable",
            category_id=categories["accessories"].id,
            brand_id=brands["oraimo"].id,
            warranty_months=1,
            variant_name="1M Fast Charging Cable",
            sku="DEMO-CBL-TYPEC-1M",
            tracking_type=TrackingType.BULK,
            cost_price=Decimal("180.00"),
            selling_price=Decimal("450.00"),
            minimum_selling_price=Decimal("350.00"),
            attributes={
                "length": "1M",
                "connector": "USB-C",
                "tracking": "Quantity only",
            },
        ),
        "DEMO-PBANK-OR20K": _product_with_variant(
            db,
            result,
            admin,
            name="Oraimo Power Bank",
            slug="oraimo-power-bank-20000mah",
            category_id=categories["accessories"].id,
            brand_id=brands["oraimo"].id,
            warranty_months=6,
            variant_name="20000mAh",
            sku="DEMO-PBANK-OR20K",
            tracking_type=TrackingType.BULK,
            cost_price=Decimal("2200.00"),
            selling_price=Decimal("3800.00"),
            minimum_selling_price=Decimal("3400.00"),
            attributes={
                "capacity": "20000mAh",
                "tracking": "Quantity only",
            },
        ),
        "DEMO-USB-64": _product_with_variant(
            db,
            result,
            admin,
            name="Kingston 64GB Flash Disk",
            slug="kingston-64gb-flash-disk",
            category_id=categories["accessories"].id,
            brand_id=brands["kingston"].id,
            warranty_months=1,
            variant_name="64GB USB 3.0",
            sku="DEMO-USB-64",
            tracking_type=TrackingType.BULK,
            cost_price=Decimal("450.00"),
            selling_price=Decimal("900.00"),
            minimum_selling_price=Decimal("750.00"),
            attributes={
                "capacity": "64GB",
                "interface": "USB 3.0",
                "tracking": "Quantity only",
            },
        ),
        "DEMO-MSD-SD128": _product_with_variant(
            db,
            result,
            admin,
            name="SanDisk Memory Card",
            slug="sandisk-memory-card-128gb",
            category_id=categories["accessories"].id,
            brand_id=brands["sandisk"].id,
            warranty_months=1,
            variant_name="128GB MicroSD",
            sku="DEMO-MSD-SD128",
            tracking_type=TrackingType.BULK,
            cost_price=Decimal("700.00"),
            selling_price=Decimal("1300.00"),
            minimum_selling_price=Decimal("1100.00"),
            attributes={
                "capacity": "128GB",
                "type": "MicroSD",
                "tracking": "Quantity only",
            },
        ),
        "DEMO-LCD-A15": _product_with_variant(
            db,
            result,
            admin,
            name="Galaxy A15 Screen Assembly",
            slug="galaxy-a15-screen-assembly",
            category_id=categories["parts"].id,
            brand_id=brands["generic"].id,
            warranty_months=0,
            variant_name="Replacement LCD",
            sku="DEMO-LCD-A15",
            tracking_type=TrackingType.BULK,
            cost_price=Decimal("2500.00"),
            selling_price=Decimal("4500.00"),
            attributes={
                "compatible_model": "Samsung Galaxy A15",
                "part_type": "Screen",
                "tracking": "Quantity only",
            },
        ),
        "DEMO-BAT-IP11": _product_with_variant(
            db,
            result,
            admin,
            name="iPhone 11 Battery",
            slug="iphone-11-battery",
            category_id=categories["parts"].id,
            brand_id=brands["generic"].id,
            warranty_months=0,
            variant_name="Replacement Battery",
            sku="DEMO-BAT-IP11",
            tracking_type=TrackingType.BULK,
            cost_price=Decimal("1800.00"),
            selling_price=Decimal("3500.00"),
            minimum_selling_price=Decimal("3000.00"),
            attributes={
                "compatible_model": "Apple iPhone 11",
                "part_type": "Battery",
                "tracking": "Quantity only",
            },
        ),
        "DEMO-PORT-TYPEC": _product_with_variant(
            db,
            result,
            admin,
            name="Type-C Charging Port",
            slug="type-c-charging-port",
            category_id=categories["parts"].id,
            brand_id=brands["generic"].id,
            warranty_months=0,
            variant_name="Universal Board Part",
            sku="DEMO-PORT-TYPEC",
            tracking_type=TrackingType.BULK,
            cost_price=Decimal("250.00"),
            selling_price=Decimal("800.00"),
            minimum_selling_price=Decimal("650.00"),
            attributes={
                "part_type": "Charging port",
                "connector": "USB-C",
                "tracking": "Quantity only",
            },
        ),
    }

    supplier = _supplier(db, result, admin)
    _purchase_and_stock(db, result, admin, hq, supplier, variants)
    _catalog_logic_purchase_and_stock(db, result, admin, hq, supplier, variants)
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
