# Crystal-shop frontend

This is the internal React/Vite frontend for the tech shop system. The brand
placeholder is `Crystal-shop`; later we can change `VITE_BRAND_NAME` to the
client's final business name.

## Run locally

From the project root:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Backend expected at:

```text
http://127.0.0.1:8000/api/v1/staff
```

Copy `.env.example` to `.env` if you want to override:

```text
VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1/staff
VITE_BRAND_NAME=Crystal-shop
```

## Current frontend structure

- ERP-style management shell with top blue header and horizontal modules.
- Dashboard with quick actions, operational stats, recent activity, 30-second
  auto-refresh, manual refresh, and pending approval queues.
- Full POS terminal view with fixed order panel, product browser, live till
  detection, and an open-till form for cashier sessions.
- Catalog, Inventory, Repairs, Purchases, Reports, and Staff/Roles pages wired to the
  existing backend APIs with sample/preview fallbacks.
- Catalog workflow can create categories, brands, products with initial variants,
  auto-generate category-aware SKUs, add more variants/SKUs, update variant
  names/prices/barcodes/status, add image URLs, activate/deactivate products,
  and publish/unpublish products for the future website.
- Inventory workflow can request stock adjustments, approve/reject adjustment
  requests, create branch transfers, move transfers through approval/dispatch/
  receipt, create stock counts, update count lines, and submit/approve counts.
- Repair desk workflow can create repair tickets, quick-add a customer during
  intake, assign a technician, and update ticket status.
- Purchasing workflow can quick-add suppliers, create purchase orders, submit
  and approve orders, and receive delivered stock with serial/IMEI capture for
  tracked items.
- Staff workflow can create staff accounts, assign available roles, scope users
  to branches, update role/branch/contact/status fields, and show the backend
  assignable-role rules.
- Staff and role studio can list permissions, create custom roles, update role
  permission sets, and manage branch-scoped staff assignment rules.
- API client foundation for auth, catalog products, current/open till session,
  repairs, purchasing, inventory, reporting, staff, branches, and customers.

## Design direction

The target is practical business software, not a decorative SaaS mockup:

- compact 13-15px typography;
- white panels over a pale grey-blue workspace;
- blue navigation/header areas;
- green reserved for payment/save/complete actions;
- red reserved for void/delete/refund risk;
- tables, filters, tabs, action buttons, and dense POS controls;
- POS behaves like a cashier terminal, not a dashboard card layout.

## Current project track

Active internal-system work:

1. Continue module-by-module usability tightening without doing a full visual redesign.
2. Improve reports with clearer filters, export-friendly layouts, and optional charts.
3. Upgrade the dashboard from polling to push updates later if the client needs
   instant alerts instead of the current 30-second refresh cycle.

Parked for later client review:

- customer-facing website;
- Vercel/production deployment;
- Cloudinary or other permanent image storage;
- full theme/redesign exploration beyond small usability fixes.
