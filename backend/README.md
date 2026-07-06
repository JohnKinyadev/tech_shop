# Backend foundation

The backend is a modular FastAPI application backed by SQLAlchemy 2 and PostgreSQL.

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

The next implementation slice is the repair pipeline: customer intake, diagnosis, quotes,
technician assignment, parts usage, status history, repair invoicing, collection, and
ready-for-pickup notifications.
