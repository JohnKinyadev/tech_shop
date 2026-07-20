import { useEffect, useMemo, useState } from "react";

import {
  ApiError,
  currentTillSession,
  dashboardSummary,
  expenseSummary,
  inventorySummary,
  repairSummary,
  salesSummary,
} from "../api/client";
import type { CurrentUser, DashboardSummary, StatusTone, TillSession } from "../api/types";
import { canAccessView, type AppView } from "../components/AppShell";
import { StatusPill } from "../components/StatusPill";
import { demoDashboard } from "../data/demoManagement";
import { useAuth } from "../state/auth";
import { integer, money, titleize } from "../utils/format";

type DashboardPageProps = {
  onNavigate?: (view: AppView) => void;
};

type Metric = {
  label: string;
  value: string;
  tone: StatusTone;
  caption: string;
};

type Action = {
  label: string;
  description: string;
  view: AppView;
};

type ReportResult =
  | { key: "sales"; data: DashboardSummary["sales"] }
  | { key: "inventory"; data: DashboardSummary["inventory"] }
  | { key: "repairs"; data: DashboardSummary["repairs"] }
  | { key: "expenses"; data: DashboardSummary["expenses"] };

const emptySummary: DashboardSummary = {
  sales: {
    sale_count: 0,
    item_count: 0,
    gross_sales: "0",
    paid_amount: "0",
    discount_amount: "0",
    refund_amount: "0",
    net_sales: "0",
    average_sale: "0",
    payments: [],
    top_items: [],
  },
  inventory: {
    stock_balance_count: 0,
    total_on_hand: 0,
    total_reserved: 0,
    total_available: 0,
    stock_value: "0",
    low_stock_count: 0,
    low_stock_items: [],
  },
  repairs: {
    ticket_count: 0,
    open_ticket_count: 0,
    ready_ticket_count: 0,
    collected_ticket_count: 0,
    cancelled_ticket_count: 0,
    labor_estimate_total: "0",
    parts_revenue_total: "0",
    payment_total: "0",
    status_breakdown: [],
  },
  expenses: {
    approved_expense_count: 0,
    pending_expense_count: 0,
    rejected_expense_count: 0,
    cancelled_expense_count: 0,
    total_approved_expenses: "0",
    by_category: [],
  },
};

function roleIs(user: CurrentUser | null, ...roles: string[]) {
  return Boolean(user && roles.includes(user.role_code));
}

function hasAny(user: CurrentUser | null, permissions: string[]) {
  return permissions.some((permission) =>
    Boolean(user?.permissions.includes(permission) || user?.permissions.includes("*")),
  );
}

function hasAll(user: CurrentUser | null, permissions: string[]) {
  return permissions.every((permission) =>
    Boolean(user?.permissions.includes(permission) || user?.permissions.includes("*")),
  );
}

function canLoadFull(user: CurrentUser | null) {
  return (
    roleIs(user, "admin", "branch_manager") ||
    hasAll(user, [
      "reports.sales.view",
      "reports.inventory.view",
      "reports.repairs.view",
      "expenses.view",
    ])
  );
}

function canLoadSales(user: CurrentUser | null) {
  return roleIs(user, "admin", "branch_manager") || hasAny(user, ["reports.sales.view"]);
}

function canLoadInventory(user: CurrentUser | null) {
  return (
    roleIs(user, "admin", "branch_manager", "inventory_manager") ||
    hasAny(user, ["reports.inventory.view", "inventory.view"])
  );
}

function canLoadRepairs(user: CurrentUser | null) {
  return (
    roleIs(user, "admin", "branch_manager", "technician") ||
    hasAny(user, ["reports.repairs.view", "repairs.view", "repairs.assigned.view"])
  );
}

function canLoadExpenses(user: CurrentUser | null) {
  return roleIs(user, "admin", "branch_manager", "accountant") || hasAny(user, ["expenses.view"]);
}

function canLoadTill(user: CurrentUser | null) {
  return roleIs(user, "cashier") || hasAny(user, ["sales.process", "tills.own.view"]);
}

function roleProfile(user: CurrentUser | null) {
  if (roleIs(user, "cashier")) {
    return {
      eyebrow: "Cashier desk",
      title: "Ready for sales",
      description:
        "Open the till, search products, process receipts, and escalate returns or voids to a manager.",
      action: "Start POS",
      view: "pos" as AppView,
    };
  }
  if (roleIs(user, "technician")) {
    return {
      eyebrow: "Repair bench",
      title: "Your repair workload",
      description:
        "Track assigned devices, update repair status, log parts used, and close ready jobs.",
      action: "Open Repairs",
      view: "repairs" as AppView,
    };
  }
  if (roleIs(user, "inventory_manager")) {
    return {
      eyebrow: "Stock control",
      title: "Inventory operating desk",
      description:
        "Watch low stock, receive purchase orders, run counts, and keep branch stock clean.",
      action: "Open Inventory",
      view: "inventory" as AppView,
    };
  }
  if (roleIs(user, "branch_manager")) {
    return {
      eyebrow: "Branch command",
      title: "Today at your branch",
      description:
        "Review branch sales, tills, stock warnings, repair flow, and approvals.",
      action: "Start Selling",
      view: "pos" as AppView,
    };
  }
  if (roleIs(user, "accountant")) {
    return {
      eyebrow: "Finance review",
      title: "Reports and expense desk",
      description:
        "Review sales, expense movement, stock valuation, and repair revenue without touching operational workflows.",
      action: "Open Reports",
      view: "reports" as AppView,
    };
  }
  return {
    eyebrow: "Owner workspace",
    title: "Business dashboard",
    description:
      "A compact operating desk for sales, stock, repairs, purchases, expenses, and staff activity.",
    action: "Start Selling",
    view: "pos" as AppView,
  };
}

function metricsFor(
  user: CurrentUser | null,
  summary: DashboardSummary,
  tillSession: TillSession | null,
): Metric[] {
  if (roleIs(user, "cashier")) {
    const tillIsOpen = tillSession?.status === "open";
    return [
      {
        label: "Till session",
        value: tillIsOpen ? "Open" : "Not open",
        tone: tillIsOpen ? "success" : "warning",
        caption: tillIsOpen ? "Ready to sell" : "Open till first",
      },
      { label: "POS access", value: "Ready", tone: "info", caption: "Search and checkout" },
      { label: "Returns / voids", value: "Manager", tone: "warning", caption: "Approval required" },
      { label: "Receipts", value: integer(summary.sales.sale_count), tone: "neutral", caption: "If report access exists" },
    ];
  }
  if (roleIs(user, "technician")) {
    return [
      { label: "Open repairs", value: integer(summary.repairs.open_ticket_count), tone: "warning", caption: "In progress" },
      { label: "Ready pickup", value: integer(summary.repairs.ready_ticket_count), tone: "success", caption: "Customer collection" },
      { label: "Repair income", value: money(summary.repairs.payment_total), tone: "info", caption: "Collected payments" },
      { label: "Parts revenue", value: money(summary.repairs.parts_revenue_total), tone: "neutral", caption: "Parts used" },
    ];
  }
  if (roleIs(user, "inventory_manager")) {
    return [
      { label: "Low stock", value: integer(summary.inventory.low_stock_count), tone: summary.inventory.low_stock_count ? "danger" : "success", caption: "Needs attention" },
      { label: "Available units", value: integer(summary.inventory.total_available), tone: "info", caption: "Ready to sell" },
      { label: "Reserved units", value: integer(summary.inventory.total_reserved), tone: "warning", caption: "Held stock" },
      { label: "Stock records", value: integer(summary.inventory.stock_balance_count), tone: "neutral", caption: "Tracked balances" },
    ];
  }
  if (roleIs(user, "accountant")) {
    return [
      { label: "Net sales", value: money(summary.sales.net_sales), tone: "success", caption: `${integer(summary.sales.sale_count)} receipts` },
      { label: "Approved expenses", value: money(summary.expenses.total_approved_expenses), tone: "warning", caption: `${integer(summary.expenses.approved_expense_count)} records` },
      { label: "Pending expenses", value: integer(summary.expenses.pending_expense_count), tone: summary.expenses.pending_expense_count ? "warning" : "success", caption: "Awaiting manager action" },
      { label: "Repair payments", value: money(summary.repairs.payment_total), tone: "info", caption: "Collected repair income" },
    ];
  }
  return [
    { label: "Net sales", value: money(summary.sales.net_sales), tone: "success", caption: `${integer(summary.sales.sale_count)} receipts` },
    { label: "Stock value", value: money(summary.inventory.stock_value), tone: "info", caption: `${integer(summary.inventory.total_available)} available` },
    { label: "Open repairs", value: integer(summary.repairs.open_ticket_count), tone: "warning", caption: `${integer(summary.repairs.ready_ticket_count)} ready` },
    { label: "Pending expenses", value: integer(summary.expenses.pending_expense_count), tone: summary.expenses.pending_expense_count ? "warning" : "success", caption: "Awaiting review" },
  ];
}

function focusFor(user: CurrentUser | null, summary: DashboardSummary) {
  if (roleIs(user, "cashier")) {
    return [
      ["Confirm your till is open", "Sales should pass through an active till session.", "warning"],
      ["Use barcode or product search", "Pick serialized phones and laptops carefully.", "info"],
      ["Escalate returns and voids", "Manager approval protects cash and stock records.", "neutral"],
    ] as const;
  }
  if (roleIs(user, "technician")) {
    return [
      ["Update ticket status", "Move devices through diagnosis, parts, repair, and pickup.", "info"],
      ["Log parts used", "Parts should deduct from stock through the repair flow.", "warning"],
      ["Close ready jobs", `${integer(summary.repairs.ready_ticket_count)} ticket(s) are ready for pickup.`, "success"],
    ] as const;
  }
  if (roleIs(user, "inventory_manager")) {
    return [
      ["Review low stock", `${integer(summary.inventory.low_stock_count)} item(s) are below reorder level.`, summary.inventory.low_stock_count ? "danger" : "success"],
      ["Receive pending stock", "Purchase order receipts should update stock immediately.", "info"],
      ["Keep counts moving", "Counts and transfers explain branch quantity differences.", "neutral"],
    ] as const;
  }
  if (roleIs(user, "accountant")) {
    return [
      ["Reconcile daily figures", `${money(summary.sales.net_sales)} net sales against ${money(summary.expenses.total_approved_expenses)} approved expenses.`, "info"],
      ["Watch pending expenses", `${integer(summary.expenses.pending_expense_count)} expense(s) still need review by a manager.`, summary.expenses.pending_expense_count ? "warning" : "success"],
      ["Review category spend", `${integer(summary.expenses.by_category.length)} expense category group(s) have approved spending.`, "neutral"],
    ] as const;
  }
  return [
    ["Review sales performance", `${integer(summary.sales.sale_count)} sale(s), ${money(summary.sales.net_sales)} net sales.`, "success"],
    ["Control stock risk", `${integer(summary.inventory.low_stock_count)} item(s) are below reorder level.`, summary.inventory.low_stock_count ? "danger" : "success"],
    ["Monitor repair flow", `${integer(summary.repairs.open_ticket_count)} ticket(s) still open.`, "info"],
  ] as const;
}

function actionsFor(user: CurrentUser | null): Action[] {
  if (roleIs(user, "cashier")) {
    return [
      { label: "Start POS", description: "Open the sales screen", view: "pos" },
      { label: "Find item", description: "Search catalog and prices", view: "catalog" },
      { label: "Check stock", description: "View branch availability", view: "inventory" },
      { label: "New repair", description: "Book a customer device", view: "repairs" },
    ];
  }
  if (roleIs(user, "technician")) {
    return [
      { label: "Repair tickets", description: "Open assigned jobs", view: "repairs" },
      { label: "Parts stock", description: "Check repair parts", view: "inventory" },
      { label: "Customer lookup", description: "Review device history", view: "repairs" },
      { label: "Catalog lookup", description: "Confirm item details", view: "catalog" },
    ];
  }
  if (roleIs(user, "inventory_manager")) {
    return [
      { label: "Inventory", description: "Check stock balances", view: "inventory" },
      { label: "Purchases", description: "Create or receive POs", view: "purchases" },
      { label: "Catalog", description: "View item setup", view: "catalog" },
      { label: "Reports", description: "Inventory summaries", view: "reports" },
    ];
  }
  if (roleIs(user, "accountant")) {
    return [
      { label: "Reports", description: "Sales, stock, repair, and expense summaries", view: "reports" },
      { label: "Expenses", description: "Review submitted spending records", view: "expenses" },
    ];
  }
  return [
    { label: "Start POS", description: "Sell from a till", view: "pos" },
    { label: "Add item", description: "Create catalog products", view: "catalog" },
    { label: "Receive stock", description: "Purchase and stock flow", view: "purchases" },
    { label: "New repair", description: "Book a repair ticket", view: "repairs" },
    { label: "Reports", description: "Business performance", view: "reports" },
    { label: "Staff & roles", description: "Users and permissions", view: "roles" },
  ];
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td className="empty-table-cell" colSpan={colSpan}>
        {message}
      </td>
    </tr>
  );
}

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  const { token, user, isPreview } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary>(isPreview ? demoDashboard : emptySummary);
  const [loaded, setLoaded] = useState({ sales: false, inventory: false, repairs: false, expenses: false });
  const [tillSession, setTillSession] = useState<TillSession | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (isPreview) {
      setSummary(demoDashboard);
      setLoaded({ sales: true, inventory: true, repairs: true, expenses: true });
      setNotice("Preview mode is using sample dashboard data.");
      return;
    }
    if (!token) return;

    const authToken = token;
    let active = true;

    async function loadDashboard() {
      let next = emptySummary;
      let nextLoaded = { sales: false, inventory: false, repairs: false, expenses: false };
      let attempts = 0;
      let failures = 0;
      let fullLoaded = false;

      if (canLoadFull(user)) {
        attempts += 1;
        try {
          next = await dashboardSummary(authToken);
          nextLoaded = { sales: true, inventory: true, repairs: true, expenses: true };
          fullLoaded = true;
        } catch {
          failures += 1;
        }
      }

      if (!fullLoaded) {
        const reports: Array<Promise<ReportResult>> = [];
        if (canLoadSales(user)) {
          attempts += 1;
          reports.push(salesSummary(authToken).then((data) => ({ key: "sales", data })));
        }
        if (canLoadInventory(user)) {
          attempts += 1;
          reports.push(inventorySummary(authToken).then((data) => ({ key: "inventory", data })));
        }
        if (canLoadRepairs(user)) {
          attempts += 1;
          reports.push(repairSummary(authToken).then((data) => ({ key: "repairs", data })));
        }
        if (canLoadExpenses(user)) {
          attempts += 1;
          reports.push(expenseSummary(authToken).then((data) => ({ key: "expenses", data })));
        }

        const results = await Promise.allSettled(reports);
        results.forEach((result) => {
          if (result.status === "rejected") {
            failures += 1;
            return;
          }
          const { key, data } = result.value;
          next = { ...next, [key]: data };
          nextLoaded = { ...nextLoaded, [key]: true };
        });
      }

      if (canLoadTill(user)) {
        try {
          const current = await currentTillSession(authToken);
          if (active) setTillSession(current);
        } catch (error) {
          if (active && error instanceof ApiError && error.status === 404) {
            setTillSession(null);
          }
        }
      }

      if (!active) return;
      setSummary(next);
      setLoaded(nextLoaded);
      setNotice(
        failures > 0 && attempts > 0
          ? "Some live dashboard widgets are unavailable for this role. Showing only the sections this account can access."
          : null,
      );
    }

    setSummary(emptySummary);
    setLoaded({ sales: false, inventory: false, repairs: false, expenses: false });
    setNotice(null);
    void loadDashboard();

    return () => {
      active = false;
    };
  }, [isPreview, token, user]);

  const profile = useMemo(() => roleProfile(user), [user]);
  const metrics = useMemo(() => metricsFor(user, summary, tillSession), [summary, tillSession, user]);
  const focus = useMemo(() => focusFor(user, summary), [summary, user]);
  const actions = useMemo(
    () => actionsFor(user).filter((action) => canAccessView(user, action.view)),
    [user],
  );

  const showSales = canLoadSales(user) || loaded.sales;
  const showInventory = canLoadInventory(user) || loaded.inventory;
  const showRepairs = canLoadRepairs(user) || loaded.repairs;
  const showExpenses = canLoadExpenses(user) || loaded.expenses;

  return (
    <section className="dashboard-page module-page">
      <div className="dashboard-hero">
        <div className="dashboard-hero__copy">
          <p className="eyebrow">{profile.eyebrow}</p>
          <h1>{profile.title}</h1>
          <p>{profile.description}</p>
        </div>
        <div className="dashboard-role-card">
          <span>Signed in as</span>
          <strong>{user?.full_name ?? "Staff user"}</strong>
          <small>
            {user?.role_name ?? "Staff"} {user?.branch_id ? "| Branch scoped" : "| All branches"}
          </small>
          <button className="primary-button" onClick={() => onNavigate?.(profile.view)}>
            {profile.action}
          </button>
        </div>
      </div>

      {notice && <div className="notice notice--page">{notice}</div>}

      <div className="stats-grid stats-grid--compact">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <StatusPill tone={metric.tone}>{metric.caption}</StatusPill>
          </article>
        ))}
      </div>

      <div className="dashboard-grid">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Today&apos;s focus</p>
              <h2>What needs attention</h2>
            </div>
          </header>
          <div className="focus-list">
            {focus.map(([title, description, tone]) => (
              <article className="focus-item" key={title}>
                <StatusPill tone={tone as StatusTone}>{titleize(tone)}</StatusPill>
                <div>
                  <strong>{title}</strong>
                  <span>{description}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Quick actions</p>
              <h2>Open a workflow</h2>
            </div>
          </header>
          <div className="quick-actions-grid quick-actions-grid--cards">
            {actions.map((action) => (
              <button
                className="quick-action-card"
                key={action.label}
                onClick={() => onNavigate?.(action.view)}
              >
                <strong>{action.label}</strong>
                <span>{action.description}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="dashboard-section-grid">
        {showRepairs && (
          <section className="panel-card">
            <header className="panel-card__header">
              <div>
                <p className="eyebrow">Repairs</p>
                <h2>Status breakdown</h2>
              </div>
            </header>
            <div className="activity-list">
              {summary.repairs.status_breakdown.length ? (
                summary.repairs.status_breakdown.map((item) => (
                  <div className="activity-row" key={item.status}>
                    <span>{integer(item.ticket_count)}</span>
                    <div>
                      <strong>{titleize(item.status)}</strong>
                      <small>Repair tickets</small>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-panel-message">No repair report loaded for this account yet.</div>
              )}
            </div>
          </section>
        )}

        {showInventory && (
          <section className="panel-card">
            <header className="panel-card__header">
              <div>
                <p className="eyebrow">Inventory</p>
                <h2>Low stock watch</h2>
              </div>
            </header>
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Item</th>
                  <th>Available</th>
                  <th>Reorder</th>
                </tr>
              </thead>
              <tbody>
                {summary.inventory.low_stock_items.length ? (
                  summary.inventory.low_stock_items.map((item) => (
                    <tr key={`${item.sku}-${item.variant_name}`}>
                      <td>{item.sku}</td>
                      <td>
                        {item.product_name} / {item.variant_name}
                      </td>
                      <td>{integer(item.available_quantity)}</td>
                      <td>{integer(item.reorder_level)}</td>
                    </tr>
                  ))
                ) : (
                  <EmptyRow colSpan={4} message="No low stock items loaded for this account." />
                )}
              </tbody>
            </table>
          </section>
        )}

        {showExpenses && (
          <section className="panel-card">
            <header className="panel-card__header">
              <div>
                <p className="eyebrow">Expenses</p>
                <h2>Approved spend by category</h2>
              </div>
            </header>
            <div className="activity-list">
              {summary.expenses.by_category.length ? (
                summary.expenses.by_category.map((item) => (
                  <div className="activity-row" key={item.category_name}>
                    <span>{money(item.amount)}</span>
                    <div>
                      <strong>{item.category_name}</strong>
                      <small>{integer(item.expense_count)} expense record(s)</small>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-panel-message">No expense report loaded for this account yet.</div>
              )}
            </div>
          </section>
        )}
      </div>

      {showSales && (
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Sales</p>
              <h2>Top selling items</h2>
            </div>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Revenue</th>
                <th>Profit</th>
              </tr>
            </thead>
            <tbody>
              {summary.sales.top_items.length ? (
                summary.sales.top_items.map((item) => (
                  <tr key={`${item.sku}-${item.variant_name}`}>
                    <td>{item.sku}</td>
                    <td>
                      {item.product_name} / {item.variant_name}
                    </td>
                    <td>{integer(item.quantity_sold)}</td>
                    <td>{money(item.revenue)}</td>
                    <td>{money(item.gross_profit)}</td>
                  </tr>
                ))
              ) : (
                <EmptyRow colSpan={5} message="No sales report loaded for this account yet." />
              )}
            </tbody>
          </table>
        </section>
      )}
    </section>
  );
}
