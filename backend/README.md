# Backend foundation

The backend is a modular FastAPI application backed by SQLAlchemy 2 and PostgreSQL.

For the full backend map, endpoint table, seeded users, schema locations, and file-by-file
reference, see [`PROJECT_REFERENCE.md`](./PROJECT_REFERENCE.md).

System health checks:

- `GET /health` checks that the app process is running.
- `GET /health/db` checks that the backend can reach PostgreSQL.

## API structure

Endpoint modules live in `backend/api/v1/routers/`. Shared dependencies and HTTP error
handling remain in `backend/api/`, while business rules and database operations live in
`backend/services/`. Routers should validate HTTP input, call a service, commit successful
commands, and shape the response; they should not contain domain logic.

## Contract rule

Database models describe persisted state. Pydantic schemas describe API contracts:

- `*Create` contains facts a caller is allowed to provide.
- `*Update` contains caller-editable fields only.
- `*Response` contains persisted and server-derived state.
- Workflow transitions use dedicated command schemas instead of generic updates.

Totals, document numbers, approval actors, stock balances, workflow statuses, and audit
timestamps are server-controlled.

## Inventory rule

`StockMovement` is the immutable inventory ledger. `StockBalance` is the current branch
projection. Serialized devices are represented by `SerializedUnit`; bulk accessories are
represented by quantities. Sales, receipts, returns, repair parts, reservations, and
transfers must all pass through one stock service.

## Next implementation slice

Authentication and authorization are available under `/api/v1/staff/auth` with login,
refresh, current-user, and password-change endpoints. Seed system access data with:

```powershell
python -m backend.cli.seed_access
```

Create the first headquarters branch and Admin interactively with:

```powershell
python -m backend.cli.bootstrap_admin --full-name "Owner Name" --username owner `
  --email owner@example.com --branch-name "Main Branch" --branch-code HQ
```

Seed sample data across the staff API with:

```powershell
python -m backend.cli.seed_demo
```

The seed creates reusable branches, users, catalog items, stock, POS, repairs,
expenses, and report data. Default seeded password is `DemoPass123!`.

Run a read-only backend smoke check after seeding with:

```powershell
python -m backend.cli.smoke
```

Branch and staff management are available under `/api/v1/staff/branches`,
`/api/v1/staff/users`, and `/api/v1/staff/roles`. Admins have global scope. Branch Managers
can manage only Cashiers and Technicians within their own branch. Staff mutations create
audit records and protect self-deactivation and the final active Admin account.

Catalog management is available under `/api/v1/staff/catalog`. Read responses expose
selling prices but keep cost prices and minimum-price floors restricted to management
commands. Publishing requires an active variant and at least one product image.

CSV catalog imports can be checked before mutation at
`/api/v1/staff/catalog/products/import/validate`. Required columns are `product_name`,
`product_slug`, `variant_name`, `sku`, `cost_price`, and `selling_price`. Optional columns
include `category`, `brand`, `barcode`, `tracking_type`, `minimum_selling_price`,
`warranty_months`, `description`, and `attributes_json`. Categories and brands referenced
by name must already exist and be active.

Purchasing endpoints are available under `/api/v1/staff/suppliers` and
`/api/v1/staff/purchases`. Purchase orders move through draft, submitted, approved,
partially received, and received states. Receipt quantities cannot exceed the outstanding
order quantity.

All received stock passes through the central inventory service. Bulk items create one
quantity movement; serialized and IMEI-tracked items create an individual unit and ledger
movement for every physical device. IMEIs must contain exactly 15 digits, identifier counts
must match receipt quantities, and branch average cost is recalculated on receipt.

Inventory control is available under `/api/v1/staff/inventory`. The API provides branch
balance and serialized-unit views, movement history, approval-backed adjustments,
inter-branch transfers, and stock counts. Cashiers can view safe stock information but not
costed movement history. Inventory Managers can prepare and process inventory work;
adjustments, transfers, and submitted stock counts require Admin or Branch Manager
approval before stock is changed.

Transfers move through draft, approved, dispatched, and received states. Dispatch records
stock leaving the source branch and places serialized units in transit. Receipt records the
destination movement, updates its weighted average cost, and reassigns serialized units to
the destination branch.

Point of sale is available under `/api/v1/staff/pos`. Branch Managers and Admins configure
tills; a cashier opens one till session at a time with an opening float. POS sales use
server-controlled prices, enforce minimum selling prices, support split cash, M-Pesa,
card, and bank payments, and deduct stock only when fully paid. Completed sales generate
safe receipt and warranty responses without exposing inventory cost.

Unpaid sales can be cancelled by their cashier. Paid voids and product returns are
request-and-approve workflows: Cashiers initiate them, while an Admin or Branch Manager
must approve them. Refunds reverse the original payment methods, returned resellable stock
is restored through the inventory ledger, and each incoming or outgoing payment is tied to
the till session that physically handled it. Till close calculates expected cash from the
opening float, cash sales, and cash refunds.

Repair management is available under `/api/v1/staff/repairs`. Branch Managers and Admins
create bookings, record device intake, and assign technicians from the same branch.
Technicians can only access assigned tickets; they record diagnosis and quotes, capture
customer approval, move repairs through the controlled status pipeline, and log parts at
server-controlled prices. Logged parts are deducted through the central inventory ledger
and can be restored before a repair is closed if an entry was made in error.

Repair invoices are calculated from approved labor and actual parts usage rather than
stored as duplicated totals. Checkout staff can receive repair payments through their own
open till without gaining access to diagnosis or inventory cost. Fully paid, ready repairs
can be marked collected. Moving a ticket to ready-for-pickup writes an auditable
notification-pending event for the later SMS integration.

Expense management is available under `/api/v1/staff/expenses`. Admins and Branch Managers
can maintain shared expense categories, create branch-scoped expense records, edit pending
expenses, and approve, reject, or cancel them. Accountants get read-only access through the
separate `expenses.view` permission, which keeps financial visibility independent from
operational authority.

Operational reports are available under `/api/v1/staff/reports`. The first report slice
provides read-only dashboard, sales, inventory, repair, and expense summaries. Reports are
calculated from live operational records rather than stored totals, remain branch-scoped
for non-Admin staff, and allow technicians to view only their own assigned repair report
scope.

The next implementation slice is hardening: live PostgreSQL smoke checks for the newest
workflows, export-friendly report formats, and then preparation for the customer-facing
website API.
