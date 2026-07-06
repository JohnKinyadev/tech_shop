# Backend foundation

The backend is a modular FastAPI application backed by SQLAlchemy 2 and PostgreSQL.

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

The next implementation slice is branch and staff management followed by catalog routes.
Inventory commands should follow only after those service boundaries are in place.
