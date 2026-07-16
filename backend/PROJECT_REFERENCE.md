# Tech Shop System backend reference

This document is the working map for the backend. Keep the short run instructions in
`backend/README.md`; use this file when you need to know where a feature lives, which
endpoint to call, and which schema/body parameters belong to it.

## Quick start

Run these from the project root:

```powershell
.\.venv\Scripts\alembic.exe upgrade head
.\.venv\Scripts\python.exe -m backend.cli.seed_access
.\.venv\Scripts\python.exe -m backend.cli.seed_demo
.\.venv\Scripts\python.exe -m backend.cli.smoke
uvicorn.exe backend.main:app --reload
```

Swagger UI is available at:

```text
http://127.0.0.1:8000/docs
```

The OpenAPI schema is the exact source of truth for request/response field constraints:

```text
http://127.0.0.1:8000/openapi.json
```

## Sample data

The sample seed command is idempotent. It creates/reuses sample data across branches, staff,
catalog, purchasing, stock, POS, repairs, expenses, and reports.

```powershell
.\.venv\Scripts\python.exe -m backend.cli.seed_demo
```

Default password for all seeded users:

```text
DemoPass123!
```

Seeded staff users:

| Role | Username | Main use |
| --- | --- | --- |
| Admin | `admin1` | Full access across branches |
| Admin | `admin2` | Second owner/admin account |
| Branch Manager | `manager1` | HQ branch operations, approvals, expenses |
| Branch Manager | `manager2` | East branch operations, approvals, expenses |
| Inventory Manager | `inventory1` | Purchasing, receiving, inventory work |
| Technician | `technician1` | Assigned repair tickets |
| Cashier | `cashier1` | HQ POS sales, till, repair payments |
| Cashier | `cashier2` | East branch POS sales, till, repair payments |
| Accountant | `accountant1` | Read-only financial/reporting access |

Seeded records include:

- Branches: `HQ`, `EAST`
- Products/SKUs: `DEMO-LAP-T480`, `DEMO-PHN-A15`, `DEMO-CHG-USBC20`,
  `DEMO-USB-64`, `DEMO-LCD-A15`
- Supplier, purchase order, goods receipt, stock balances/movements
- Open cashier till session
- Customer, completed POS sale, payment, warranty data
- Pending inventory adjustment request, draft stock transfer, draft stock count
- Ready and paid repair ticket
- Approved expense

## Architecture rule

The backend is intentionally split by responsibility:

| Layer | Location | What belongs there |
| --- | --- | --- |
| App entry | `backend/main.py` | FastAPI app creation, CORS setup, health checks, error handler registration, router mounting |
| HTTP routers | `backend/api/v1/routers/` | URL paths, dependencies, response models, commit after successful commands |
| API dependencies/errors | `backend/api/` | Shared auth dependency, DB session dependency, HTTP error mapping |
| Schemas | `backend/schemas/` | Pydantic request/response contracts |
| Services | `backend/services/` | Business rules, permissions, workflow transitions, database operations |
| Models | `backend/models/` | SQLAlchemy persisted state only |
| CLI | `backend/cli/` | One-off commands for setup/seeding |
| Migrations | `backend/migrations/` | Alembic schema history |

Routers should not contain business logic. If a rule matters, put it in a service.

## File map

### Runtime and API shell

| File | Purpose |
| --- | --- |
| `backend/__init__.py` | Marks `backend` as an importable package |
| `backend/main.py` | Builds the FastAPI app, configures CORS, exposes health checks, and mounts `/api/v1/staff` |
| `backend/api/__init__.py` | API package marker |
| `backend/api/dependencies.py` | DB session, bearer auth, permission dependency helpers |
| `backend/api/errors.py` | Converts service exceptions to HTTP responses |
| `backend/api/v1/__init__.py` | Adds the `/api/v1/staff` prefix |
| `backend/api/v1/routers/__init__.py` | Registers every staff router |

### Routers

| File | Purpose |
| --- | --- |
| `backend/api/v1/routers/auth.py` | Login, refresh, current user, password change |
| `backend/api/v1/routers/branches.py` | Branch listing and branch setup |
| `backend/api/v1/routers/staff.py` | Staff users and assignable roles |
| `backend/api/v1/routers/catalog.py` | Categories, brands, products, variants, images, CSV import |
| `backend/api/v1/routers/purchasing.py` | Suppliers, purchase orders, goods receipts |
| `backend/api/v1/routers/inventory.py` | Balances, units, movements, adjustments, transfers, stock counts |
| `backend/api/v1/routers/pos.py` | Tills, customers, POS sales, payments, returns, warranties |
| `backend/api/v1/routers/repairs.py` | Repair booking, intake, assignment, diagnosis, parts, billing |
| `backend/api/v1/routers/expenses.py` | Expense categories and expense approval workflow |
| `backend/api/v1/routers/reports.py` | Dashboard, sales, inventory, repair, expense summaries |

### Core

| File | Purpose |
| --- | --- |
| `backend/core/__init__.py` | Core package marker |
| `backend/core/config.py` | Environment/settings loading, including JWT and frontend CORS origins |
| `backend/core/permissions.py` | Role codes, permission codes, role-permission matrix |
| `backend/core/security.py` | Password hashing and JWT helpers |

### Models

| File | Purpose |
| --- | --- |
| `backend/models/__init__.py` | Imports all SQLAlchemy models for metadata/Alembic discovery |
| `backend/models/base.py` | Base model with UUID, timestamps, soft-delete flag |
| `backend/models/database.py` | SQLAlchemy engine/session configuration |
| `backend/models/enums.py` | Shared enum values persisted in the database |
| `backend/models/branch.py` | Business branches |
| `backend/models/roles.py` | Roles and role-permission join table |
| `backend/models/permissions.py` | Permission records |
| `backend/models/users.py` | Staff accounts |
| `backend/models/audit.py` | Audit log |
| `backend/models/approvals.py` | Generic approval request workflow |
| `backend/models/customer.py` | Customers |
| `backend/models/brand.py` | Product brands |
| `backend/models/products.py` | Categories, products, variants, images |
| `backend/models/suppliers.py` | Suppliers |
| `backend/models/purchase.py` | Purchase orders and goods receipts |
| `backend/models/inventory.py` | Stock balances, serialized units, reservations |
| `backend/models/inventory_movement.py` | Stock movement ledger and stock transfers |
| `backend/models/stocktake.py` | Stock counts and stock count items |
| `backend/models/sales.py` | Tills, till sessions, sales, sale items, returns |
| `backend/models/payments.py` | Incoming/outgoing payments |
| `backend/models/warranty.py` | Product warranties |
| `backend/models/repairs.py` | Repair tickets, repair parts, status history |
| `backend/models/expenses.py` | Expense categories and expense records |

### Schemas

| File | Purpose |
| --- | --- |
| `backend/schemas/base_schemas.py` | Base Pydantic schema, `ModelResponse`, `Page` |
| `backend/schemas/auth_schemas.py` | Login, refresh, password-change responses/requests |
| `backend/schemas/branch_schemas.py` | Branch create/update/response |
| `backend/schemas/user_schemas.py` | Staff user, role, permission schemas |
| `backend/schemas/products_schemas.py` | Catalog categories, brands, products, variants, images, import |
| `backend/schemas/supplier_schemas.py` | Supplier create/update/response |
| `backend/schemas/purchase_schemas.py` | Purchase orders and goods receipts |
| `backend/schemas/inventory_schemas.py` | Balances, units, movements, adjustments, transfers |
| `backend/schemas/stocktake_schemas.py` | Stock count workflow |
| `backend/schemas/customer_schemas.py` | POS customer contracts |
| `backend/schemas/sales_schemas.py` | Tills, sales, payments, receipts, returns |
| `backend/schemas/payments_schemas.py` | Payment contracts |
| `backend/schemas/warranty_schemas.py` | Warranty lookup response |
| `backend/schemas/approval_schemas.py` | Approval decision/request response |
| `backend/schemas/repair_schemas.py` | Repair tickets, parts, diagnosis, billing |
| `backend/schemas/expense_schemas.py` | Expense categories, records, decisions |
| `backend/schemas/report_schemas.py` | Dashboard and report responses |
| `backend/schemas/audit_schemas.py` | Audit log response |

### Services

| File | Purpose |
| --- | --- |
| `backend/services/__init__.py` | Services package marker |
| `backend/services/exceptions.py` | Expected service exceptions |
| `backend/services/authorization.py` | Permission, branch-scope, role-assignment enforcement |
| `backend/services/audit.py` | Audit-log writer |
| `backend/services/bootstrap.py` | Role/permission seeding and first Admin creation |
| `backend/services/demo_seed.py` | Idempotent demo-data seeding |
| `backend/services/auth.py` | Authentication, token issue/refresh, password change |
| `backend/services/branches.py` | Branch management |
| `backend/services/staff.py` | Staff management and assignment limits |
| `backend/services/catalog.py` | Catalog CRUD/publication rules |
| `backend/services/catalog_import.py` | CSV catalog import validation/import |
| `backend/services/suppliers.py` | Supplier CRUD |
| `backend/services/purchasing.py` | Purchase order workflow and receiving |
| `backend/services/inventory.py` | Central stock ledger operations |
| `backend/services/inventory_control.py` | Balance/unit views and adjustment requests |
| `backend/services/transfers.py` | Inter-branch transfer workflow |
| `backend/services/stocktake.py` | Stock count workflow |
| `backend/services/tills.py` | Tills and till sessions |
| `backend/services/customers.py` | POS customer creation/listing |
| `backend/services/sales.py` | POS sales, payments, stock deduction, warranties |
| `backend/services/returns.py` | Voids, returns, refunds |
| `backend/services/repairs.py` | Repair workflow and parts usage |
| `backend/services/repair_billing.py` | Repair invoices, payments, collection |
| `backend/services/expenses.py` | Expense workflow |
| `backend/services/reports.py` | Read-only report aggregations |

### CLI and migrations

| File | Purpose |
| --- | --- |
| `backend/cli/__init__.py` | CLI package marker |
| `backend/cli/seed_access.py` | Seeds/updates permissions and system roles |
| `backend/cli/bootstrap_admin.py` | Creates the first headquarters branch and Admin |
| `backend/cli/seed_demo.py` | Seeds demo data across the whole backend |
| `backend/cli/smoke.py` | Runs read-only DB/API smoke checks against seeded demo data |
| `backend/migrations/env.py` | Alembic environment and metadata import |
| `backend/migrations/script.py.mako` | Alembic migration template |
| `backend/migrations/versions/777154bd1cf1_initial_tables.py` | Initial database schema |
| `backend/migrations/versions/0980f07fde03_link_pos_refunds_to_till_sessions.py` | Links POS refunds to till sessions |
| `backend/migrations/versions/9c276b0ab9f0_add_stock_count_tables.py` | Adds stock count tables |
| `backend/migrations/versions/dfa7c89665b8_create_stocktake_tables.py` | Current no-op checkpoint retained for DB revision continuity |

## Role and permission model

| Role | Scope | Main permissions |
| --- | --- | --- |
| Admin | All branches | Everything |
| Branch Manager | Own branch | Branch operations, approvals, staff below manager |
| Inventory Manager | Own branch | Catalog view, inventory, purchasing, fulfillment |
| Technician | Assigned repair tickets | Repair view/update/close, own repair reports |
| Cashier | Own branch / own till | POS, warranty lookup, own till |
| Accountant | Own branch reports | Read-only sales/inventory/repair reports and expenses |

Important rules:

- Only Admin can create another Admin or Branch Manager.
- Branch Managers can create/edit Cashiers and Technicians only in their own branch.
- Non-Admin staff are branch-scoped.
- Voids, refunds, stock adjustments, submitted stock counts, and sensitive inventory
  actions need manager/admin approval.

## Endpoint reference

All staff API endpoints are prefixed with:

```text
/api/v1/staff
```

All protected routes require:

```text
Authorization: Bearer <access_token>
```

Request bodies are named by schema class. Look up the exact field constraints in the
matching `backend/schemas/*_schemas.py` file or in Swagger.

### Auth

| Method | Path | Params | Body | What it does |
| --- | --- | --- | --- | --- |
| POST | `/auth/login` | - | `LoginRequest` | Authenticates staff and returns access/refresh tokens |
| POST | `/auth/refresh` | - | `TokenRefreshRequest` | Issues a new token pair from a refresh token |
| GET | `/auth/me` | - | - | Returns the current staff principal |
| POST | `/auth/change-password` | - | `PasswordChangeRequest` | Changes the current user's password |

### Branches and staff

| Method | Path | Params | Body | What it does |
| --- | --- | --- | --- | --- |
| GET | `/branches` | - | - | Lists visible branches |
| POST | `/branches` | - | `BranchCreate` | Creates a branch |
| GET | `/branches/{branch_id}` | `branch_id` path | - | Gets one branch |
| PATCH | `/branches/{branch_id}` | `branch_id` path | `BranchUpdate` | Updates a branch |
| GET | `/roles` | - | - | Lists roles the current user can assign |
| GET | `/users` | - | - | Lists manageable staff users |
| POST | `/users` | - | `UserCreate` | Creates staff within assignment scope |
| GET | `/users/{user_id}` | `user_id` path | - | Gets one manageable staff user |
| PATCH | `/users/{user_id}` | `user_id` path | `UserUpdate` | Updates staff within assignment scope |

### Catalog

| Method | Path | Params | Body | What it does |
| --- | --- | --- | --- | --- |
| GET | `/catalog/categories` | - | - | Lists product categories |
| POST | `/catalog/categories` | - | `CategoryCreate` | Creates a category |
| GET | `/catalog/categories/{category_id}` | `category_id` path | - | Gets one category |
| PATCH | `/catalog/categories/{category_id}` | `category_id` path | `CategoryUpdate` | Updates a category |
| GET | `/catalog/brands` | - | - | Lists brands |
| POST | `/catalog/brands` | - | `BrandCreate` | Creates a brand |
| GET | `/catalog/brands/{brand_id}` | `brand_id` path | - | Gets one brand |
| PATCH | `/catalog/brands/{brand_id}` | `brand_id` path | `BrandUpdate` | Updates a brand |
| POST | `/catalog/products/import/validate` | - | CSV upload/body | Validates catalog CSV without mutating data |
| POST | `/catalog/products/import` | - | CSV upload/body | Imports valid catalog CSV rows |
| GET | `/catalog/products` | `page`, `page_size`, `q`, `category_id`, `brand_id`, `is_active`, `is_published` query | - | Lists products |
| POST | `/catalog/products` | - | `ProductCreate` | Creates product with at least one variant |
| GET | `/catalog/products/{product_id}` | `product_id` path | - | Gets one product |
| PATCH | `/catalog/products/{product_id}` | `product_id` path | `ProductUpdate` | Updates product metadata |
| PATCH | `/catalog/products/{product_id}/publication` | `product_id` path | `ProductPublicationUpdate` | Publishes/unpublishes product |
| POST | `/catalog/products/{product_id}/variants` | `product_id` path | `ProductVariantCreate` | Adds a variant |
| PATCH | `/catalog/variants/{variant_id}` | `variant_id` path | `ProductVariantUpdate` | Updates a variant |
| POST | `/catalog/products/{product_id}/images` | `product_id` path | `ProductImageCreate` | Adds product image |
| PATCH | `/catalog/images/{image_id}` | `image_id` path | `ProductImageUpdate` | Updates image |
| DELETE | `/catalog/images/{image_id}` | `image_id` path | - | Deletes image |

### Purchasing

| Method | Path | Params | Body | What it does |
| --- | --- | --- | --- | --- |
| GET | `/suppliers` | `include_inactive` query | - | Lists suppliers |
| POST | `/suppliers` | - | `SupplierCreate` | Creates supplier |
| GET | `/suppliers/{supplier_id}` | `supplier_id` path | - | Gets supplier |
| PATCH | `/suppliers/{supplier_id}` | `supplier_id` path | `SupplierUpdate` | Updates supplier |
| GET | `/purchases` | `page`, `page_size`, `status`, `supplier_id` query | - | Lists purchase orders |
| POST | `/purchases` | - | `PurchaseOrderCreate` | Creates draft purchase order |
| GET | `/purchases/{order_id}` | `order_id` path | - | Gets purchase order |
| PATCH | `/purchases/{order_id}` | `order_id` path | `PurchaseOrderUpdate` | Updates draft purchase order |
| POST | `/purchases/{order_id}/submit` | `order_id` path | - | Submits purchase order |
| POST | `/purchases/{order_id}/approve` | `order_id` path | - | Approves submitted order |
| POST | `/purchases/{order_id}/cancel` | `order_id` path | - | Cancels eligible order |
| GET | `/purchases/{order_id}/receipts` | `order_id` path | - | Lists receipts for order |
| POST | `/purchases/{order_id}/receipts` | `order_id` path | `GoodsReceiptCreate` | Receives stock into inventory |

### Inventory

| Method | Path | Params | Body | What it does |
| --- | --- | --- | --- | --- |
| GET | `/inventory/balances` | `branch_id`, `page`, `page_size`, `query`, `low_stock_only` query | - | Lists branch stock balances |
| GET | `/inventory/serialized-units` | `branch_id`, `page`, `page_size`, `query`, `status` query | - | Lists serialized/IMEI units |
| GET | `/inventory/movements` | `branch_id`, `page`, `page_size`, `variant_id` query | - | Lists costed movement ledger |
| GET | `/inventory/adjustment-requests` | `branch_id` query | - | Lists stock adjustment approvals |
| POST | `/inventory/adjustment-requests` | - | `StockAdjustmentCreate` | Requests stock adjustment |
| POST | `/inventory/adjustment-requests/{request_id}/decision` | `request_id` path | `ApprovalDecision` | Approves/rejects adjustment |
| GET | `/inventory/transfers` | `branch_id` query | - | Lists transfers involving branch |
| POST | `/inventory/transfers` | - | `StockTransferCreate` | Creates draft transfer |
| POST | `/inventory/transfers/{transfer_id}/approve` | `transfer_id` path | - | Approves draft transfer |
| POST | `/inventory/transfers/{transfer_id}/dispatch` | `transfer_id` path | - | Dispatches approved transfer |
| POST | `/inventory/transfers/{transfer_id}/receive` | `transfer_id` path | - | Receives dispatched transfer |
| POST | `/inventory/transfers/{transfer_id}/cancel` | `transfer_id` path | - | Cancels draft/approved transfer |
| GET | `/inventory/stock-counts` | `branch_id` query | - | Lists stock counts |
| POST | `/inventory/stock-counts` | - | `StockCountCreate` | Opens stock count |
| PATCH | `/inventory/stock-counts/{count_id}/items/{item_id}` | `count_id`, `item_id` path | `StockCountItemUpdate` | Records counted quantity |
| POST | `/inventory/stock-counts/{count_id}/submit` | `count_id` path | - | Submits stock count |
| POST | `/inventory/stock-counts/{count_id}/approve` | `count_id` path | - | Approves stock count and applies bulk variances |
| POST | `/inventory/stock-counts/{count_id}/cancel` | `count_id` path | - | Cancels open stock count |

### POS

| Method | Path | Params | Body | What it does |
| --- | --- | --- | --- | --- |
| GET | `/pos/tills` | `branch_id`, `include_inactive` query | - | Lists branch tills |
| POST | `/pos/tills` | - | `TillCreate` | Creates till |
| PATCH | `/pos/tills/{till_id}` | `till_id` path | `TillUpdate` | Updates till |
| GET | `/pos/till-sessions/current` | - | - | Gets current cashier open till session |
| POST | `/pos/till-sessions/open` | - | `TillSessionOpen` | Opens till session |
| POST | `/pos/till-sessions/{session_id}/close` | `session_id` path | `TillSessionClose` | Closes till session |
| GET | `/pos/customers` | `query`, `limit` query | - | Searches customers |
| POST | `/pos/customers` | - | `CustomerCreate` | Creates customer |
| GET | `/pos/customers/{customer_id}` | `customer_id` path | - | Gets customer |
| GET | `/pos/sales` | `branch_id`, `page`, `page_size`, `status` query | - | Lists sales |
| POST | `/pos/sales` | - | `SaleCreate` | Creates pending POS sale |
| GET | `/pos/sales/{sale_id}` | `sale_id` path | - | Gets sale |
| POST | `/pos/sales/{sale_id}/payments` | `sale_id` path | `SalePaymentCreate` | Adds sale payment; fully paid sale deducts stock |
| POST | `/pos/sales/{sale_id}/cancel` | `sale_id` path | - | Cancels unpaid sale |
| GET | `/pos/sales/{sale_id}/receipt` | `sale_id` path | - | Gets printable receipt data |
| GET | `/pos/sales/void-requests` | `branch_id` query | - | Lists sale void approvals |
| POST | `/pos/sales/{sale_id}/void-requests` | `sale_id` path | `SaleVoidRequest` | Requests sale void |
| POST | `/pos/sales/void-requests/{request_id}/decision` | `request_id` path | `ApprovalDecision` | Approves/rejects void |
| GET | `/pos/sales/{sale_id}/returns` | `sale_id` path | - | Lists returns for sale |
| POST | `/pos/sales/{sale_id}/returns` | `sale_id` path | `SaleReturnCreate` | Requests product return |
| POST | `/pos/returns/{return_id}/decision` | `return_id` path | `ApprovalDecision` | Approves/rejects return and refund |
| GET | `/pos/warranties/lookup` | `identifier` query | - | Looks up warranty by serial/IMEI |

### Repairs

| Method | Path | Params | Body | What it does |
| --- | --- | --- | --- | --- |
| GET | `/repairs` | `branch_id`, `page`, `page_size`, `status`, `technician_id` query | - | Lists repair tickets |
| POST | `/repairs` | - | `RepairBookingCreate` | Creates repair booking |
| GET | `/repairs/{ticket_id}` | `ticket_id` path | - | Gets repair ticket |
| POST | `/repairs/{ticket_id}/intake` | `ticket_id` path | `RepairIntakeUpdate` | Records device intake |
| PATCH | `/repairs/{ticket_id}/assignment` | `ticket_id` path | `RepairAssignmentUpdate` | Assigns technician |
| POST | `/repairs/{ticket_id}/diagnosis` | `ticket_id` path | `RepairDiagnosisUpdate` | Submits diagnosis/quote |
| POST | `/repairs/{ticket_id}/quote-decision` | `ticket_id` path | `RepairQuoteDecision` | Records customer approval/decline |
| POST | `/repairs/{ticket_id}/status` | `ticket_id` path | `RepairStatusUpdate` | Moves through allowed repair statuses |
| POST | `/repairs/{ticket_id}/parts` | `ticket_id` path | `RepairPartCreate` | Logs part usage and deducts stock |
| DELETE | `/repairs/{ticket_id}/parts/{part_id}` | `ticket_id`, `part_id` path | - | Removes part before close and restores stock |
| POST | `/repairs/{ticket_id}/ready` | `ticket_id` path | `RepairNote` | Marks repair ready for pickup |
| POST | `/repairs/{ticket_id}/cancel` | `ticket_id` path | `RepairNote` | Cancels eligible repair |
| GET | `/repairs/{ticket_id}/invoice` | `ticket_id` path | - | Calculates repair invoice |
| POST | `/repairs/{ticket_id}/payments` | `ticket_id` path | `RepairPaymentCreate` | Records repair payment through till |
| POST | `/repairs/{ticket_id}/collect` | `ticket_id` path | - | Marks fully paid ready repair collected |

### Expenses

| Method | Path | Params | Body | What it does |
| --- | --- | --- | --- | --- |
| GET | `/expenses/categories` | - | - | Lists expense categories |
| POST | `/expenses/categories` | - | `ExpenseCategoryCreate` | Creates expense category |
| PATCH | `/expenses/categories/{category_id}` | `category_id` path | `ExpenseCategoryUpdate` | Updates expense category |
| GET | `/expenses` | `page`, `page_size`, `branch_id`, `status`, `category_id` query | - | Lists expenses |
| POST | `/expenses` | - | `ExpenseCreate` | Creates pending expense |
| GET | `/expenses/{expense_id}` | `expense_id` path | - | Gets expense |
| PATCH | `/expenses/{expense_id}` | `expense_id` path | `ExpenseUpdate` | Edits pending expense |
| POST | `/expenses/{expense_id}/approve` | `expense_id` path | `ExpenseDecision` | Approves pending expense |
| POST | `/expenses/{expense_id}/reject` | `expense_id` path | `ExpenseDecision` | Rejects pending expense |
| POST | `/expenses/{expense_id}/cancel` | `expense_id` path | `ExpenseDecision` | Cancels pending expense |

### Reports

| Method | Path | Params | Body | What it does |
| --- | --- | --- | --- | --- |
| GET | `/reports/dashboard` | `branch_id`, `start_at`, `end_at` query | - | Combined sales/inventory/repair/expense summary |
| GET | `/reports/sales` | `branch_id`, `start_at`, `end_at`, `top_limit` query | - | Sales totals, payments, top items |
| GET | `/reports/inventory` | `branch_id`, `low_stock_limit` query | - | Stock value, totals, low-stock items |
| GET | `/reports/repairs` | `branch_id`, `start_at`, `end_at`, `technician_id` query | - | Repair status and revenue summary |
| GET | `/reports/expenses` | `branch_id`, `start_at`, `end_at` query | - | Expense totals and category breakdown |

## Common request schema locations

| Body schema prefix | File |
| --- | --- |
| `Login*`, `Token*`, `Password*` | `backend/schemas/auth_schemas.py` |
| `Branch*` | `backend/schemas/branch_schemas.py` |
| `User*`, `Role*`, `Permission*` | `backend/schemas/user_schemas.py` |
| `Category*`, `Brand*`, `Product*` | `backend/schemas/products_schemas.py` |
| `Supplier*` | `backend/schemas/supplier_schemas.py` |
| `PurchaseOrder*`, `GoodsReceipt*` | `backend/schemas/purchase_schemas.py` |
| `Stock*`, `Serialized*` | `backend/schemas/inventory_schemas.py`, `backend/schemas/stocktake_schemas.py` |
| `Till*`, `Sale*`, `Receipt*` | `backend/schemas/sales_schemas.py` |
| `Payment*` | `backend/schemas/payments_schemas.py` |
| `Repair*` | `backend/schemas/repair_schemas.py` |
| `Expense*` | `backend/schemas/expense_schemas.py` |
| `*Report*`, `*Summary*` | `backend/schemas/report_schemas.py` |

## Development checks

Use these before committing:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\alembic.exe check
.\.venv\Scripts\python.exe -m backend.cli.seed_demo
.\.venv\Scripts\python.exe -m backend.cli.smoke
```

If models changed and Alembic reports new operations, create a migration before pushing.

## System health and frontend access

| Method | Path | What it checks |
| --- | --- | --- |
| GET | `/health` | App process is running and returns the configured environment |
| GET | `/health/db` | App can open a DB session and execute `SELECT 1` |

Frontend origins are controlled with `TECH_SHOP_CORS_ORIGINS` as a comma-separated list.
The default development origins include Vite (`localhost:5173`) and common React
dev-server ports (`localhost:3000`).
