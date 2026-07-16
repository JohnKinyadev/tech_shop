import { useEffect, useMemo, useState } from "react";

import {
  expenseSummary,
  inventorySummary,
  listBranches,
  repairSummary,
  salesSummary,
} from "../api/client";
import type {
  Branch,
  ExpenseSummary,
  InventorySummary,
  RepairSummary,
  SalesSummary,
  StatusTone,
} from "../api/types";
import { StatusPill } from "../components/StatusPill";
import { demoBranches, demoDashboard } from "../data/demoManagement";
import { useAuth } from "../state/auth";
import { integer, money, titleize } from "../utils/format";

function numberValue(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function dateStart(value: string) {
  return value ? `${value}T00:00:00` : null;
}

function dateEnd(value: string) {
  return value ? `${value}T23:59:59` : null;
}

function percentage(part: number | string, total: number | string) {
  const totalValue = numberValue(total);
  if (!totalValue) return 0;
  return Math.max(0, Math.min(100, Math.round((numberValue(part) / totalValue) * 100)));
}

function marginPercent(profit: string, revenue: string) {
  return percentage(profit, revenue);
}

export function ReportsPage() {
  const { token, isPreview, user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>(demoBranches);
  const [selectedBranchId, setSelectedBranchId] = useState(user?.branch_id ?? "all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sales, setSales] = useState<SalesSummary>(demoDashboard.sales);
  const [inventory, setInventory] = useState<InventorySummary>(
    demoDashboard.inventory,
  );
  const [repairs, setRepairs] = useState<RepairSummary>(demoDashboard.repairs);
  const [expenses, setExpenses] = useState<ExpenseSummary>(demoDashboard.expenses);
  const [notice, setNotice] = useState<string | null>(null);

  const reportBranchId = selectedBranchId === "all" ? undefined : selectedBranchId;
  const startAt = dateStart(startDate);
  const endAt = dateEnd(endDate);

  const grossProfit = useMemo(
    () =>
      sales.top_items.reduce(
        (sum, item) => sum + numberValue(item.gross_profit),
        0,
      ),
    [sales.top_items],
  );

  const cashAfterExpenses =
    numberValue(sales.net_sales) +
    numberValue(repairs.payment_total) -
    numberValue(expenses.total_approved_expenses);

  const averageRepairValue = repairs.ticket_count
    ? (numberValue(repairs.labor_estimate_total) +
        numberValue(repairs.parts_revenue_total)) /
      repairs.ticket_count
    : 0;

  const insights: Array<{
    label: string;
    value: string;
    detail: string;
    tone: StatusTone;
  }> = [
    {
      label: "Cash after expenses",
      value: money(cashAfterExpenses),
      detail: "Sales + repair payments - approved expenses",
      tone: cashAfterExpenses >= 0 ? "success" : "danger",
    },
    {
      label: "Top-item gross profit",
      value: money(grossProfit),
      detail: "Profit visible from currently ranked items",
      tone: grossProfit > 0 ? "success" : "neutral",
    },
    {
      label: "Reserved stock pressure",
      value: `${percentage(inventory.total_reserved, inventory.total_on_hand)}%`,
      detail: `${integer(inventory.total_reserved)} of ${integer(
        inventory.total_on_hand,
      )} units are reserved`,
      tone: inventory.total_reserved ? "warning" : "success",
    },
    {
      label: "Average repair value",
      value: money(averageRepairValue),
      detail: "Labor + parts estimates per ticket",
      tone: "info",
    },
  ];

  useEffect(() => {
    if (!token || isPreview) return;

    let active = true;
    listBranches(token)
      .then((result) => {
        if (!active) return;
        setBranches(result);
        setSelectedBranchId((current) => {
          if (current === "all") return current;
          if (current && result.some((branch) => branch.id === current)) return current;
          return user?.branch_id ?? "all";
        });
      })
      .catch(() => {
        if (!active) return;
        setNotice("Branches are unavailable. Report filters will use sample branches.");
      });

    return () => {
      active = false;
    };
  }, [isPreview, token, user?.branch_id]);

  useEffect(() => {
    if (!token || isPreview) return;

    let active = true;
    const options = {
      branchId: reportBranchId,
      startAt,
      endAt,
      topLimit: 10,
    };

    Promise.allSettled([
      salesSummary(token, options),
      inventorySummary(token, options),
      repairSummary(token, options),
      expenseSummary(token, options),
    ]).then(([salesResult, inventoryResult, repairResult, expenseResult]) => {
      if (!active) return;
      let failed = false;

      if (salesResult.status === "fulfilled") {
        setSales(salesResult.value);
      } else {
        failed = true;
      }

      if (inventoryResult.status === "fulfilled") {
        setInventory(inventoryResult.value);
      } else {
        failed = true;
      }

      if (repairResult.status === "fulfilled") {
        setRepairs(repairResult.value);
      } else {
        failed = true;
      }

      if (expenseResult.status === "fulfilled") {
        setExpenses(expenseResult.value);
      } else {
        failed = true;
      }

      setNotice(
        failed
          ? "Some reports are unavailable or not permitted. Showing sample data where needed."
          : null,
      );
    });

    return () => {
      active = false;
    };
  }, [endAt, isPreview, reportBranchId, startAt, token]);

  return (
    <section className="module-page reports-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Reports</p>
          <h1>Owner reports</h1>
          <p>
            Review sales, payments, inventory pressure, repair throughput, and
            expenses from one branch-aware business view.
          </p>
        </div>
        <button className="primary-button" onClick={() => window.print()}>
          Print / Export
        </button>
      </div>

      <section className="panel-card report-filter-bar">
        <label>
          Branch
          <select
            value={selectedBranchId}
            onChange={(event) => setSelectedBranchId(event.target.value)}
          >
            <option value="all">All branches</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setStartDate("");
            setEndDate("");
            setSelectedBranchId(user?.branch_id ?? "all");
          }}
        >
          Reset Filters
        </button>
      </section>

      {notice && <div className="notice notice--page">{notice}</div>}

      <div className="stats-grid">
        <article className="metric-card">
          <span>Net sales</span>
          <strong>{money(sales.net_sales)}</strong>
          <StatusPill tone="success">{integer(sales.sale_count)} sales</StatusPill>
        </article>
        <article className="metric-card">
          <span>Repair payments</span>
          <strong>{money(repairs.payment_total)}</strong>
          <StatusPill tone="info">
            {integer(repairs.ready_ticket_count)} ready
          </StatusPill>
        </article>
        <article className="metric-card">
          <span>Stock value</span>
          <strong>{money(inventory.stock_value)}</strong>
          <StatusPill tone={inventory.low_stock_count ? "warning" : "success"}>
            {integer(inventory.low_stock_count)} low
          </StatusPill>
        </article>
        <article className="metric-card">
          <span>Approved expenses</span>
          <strong>{money(expenses.total_approved_expenses)}</strong>
          <StatusPill tone={expenses.pending_expense_count ? "warning" : "success"}>
            {integer(expenses.pending_expense_count)} pending
          </StatusPill>
        </article>
      </div>

      <section className="report-insight-grid">
        {insights.map((insight) => (
          <article className="report-insight-card" key={insight.label}>
            <div>
              <span>{insight.label}</span>
              <strong>{insight.value}</strong>
            </div>
            <StatusPill tone={insight.tone}>{insight.detail}</StatusPill>
          </article>
        ))}
      </section>

      <div className="dashboard-grid m-t">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Sales</p>
              <h2>Payment mix</h2>
            </div>
          </header>
          <div className="report-payment-list">
            {sales.payments.length ? (
              sales.payments.map((payment) => {
                const share = percentage(payment.amount, sales.paid_amount);
                return (
                  <article key={payment.method}>
                    <div>
                      <strong>{titleize(payment.method)}</strong>
                      <span>
                        {integer(payment.transaction_count)} transaction(s) ·{" "}
                        {share}% of paid amount
                      </span>
                    </div>
                    <b>{money(payment.amount)}</b>
                    <div className="report-bar">
                      <span style={{ width: `${share}%` }} />
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="empty-panel-message">No payments in this period.</p>
            )}
          </div>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Sales</p>
              <h2>Top-selling items</h2>
            </div>
          </header>
          <table className="data-table report-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Revenue</th>
                <th>Margin</th>
              </tr>
            </thead>
            <tbody>
              {sales.top_items.length ? (
                sales.top_items.map((item) => (
                  <tr key={item.sku}>
                    <td>{item.sku}</td>
                    <td>
                      {item.product_name}
                      <span>{item.variant_name}</span>
                    </td>
                    <td>{integer(item.quantity_sold)}</td>
                    <td>{money(item.revenue)}</td>
                    <td>
                      {money(item.gross_profit)}
                      <span>{marginPercent(item.gross_profit, item.revenue)}%</span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="empty-table-cell">
                    No ranked sales items in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>

      <div className="dashboard-grid m-t">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Inventory</p>
              <h2>Low-stock watch</h2>
            </div>
          </header>
          <table className="data-table report-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>On hand</th>
                <th>Available</th>
                <th>Reorder</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {inventory.low_stock_items.length ? (
                inventory.low_stock_items.map((item) => (
                  <tr key={item.sku}>
                    <td>{item.sku}</td>
                    <td>
                      {item.product_name}
                      <span>{item.variant_name}</span>
                    </td>
                    <td>{integer(item.quantity_on_hand)}</td>
                    <td>{integer(item.available_quantity)}</td>
                    <td>{integer(item.reorder_level)}</td>
                    <td>{money(item.stock_value)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="empty-table-cell">
                    No low-stock pressure right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Repairs</p>
              <h2>Repair pipeline</h2>
            </div>
          </header>
          <div className="report-status-list">
            {repairs.status_breakdown.length ? (
              repairs.status_breakdown.map((item) => {
                const share = percentage(item.ticket_count, repairs.ticket_count);
                return (
                  <article key={item.status}>
                    <div>
                      <strong>{titleize(item.status)}</strong>
                      <span>{integer(item.ticket_count)} ticket(s)</span>
                    </div>
                    <div className="report-bar">
                      <span style={{ width: `${share}%` }} />
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="empty-panel-message">No repair tickets in this period.</p>
            )}
          </div>
        </section>
      </div>

      <div className="dashboard-grid m-t">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Expenses</p>
              <h2>Expense categories</h2>
            </div>
          </header>
          <table className="data-table report-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Entries</th>
                <th>Amount</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {expenses.by_category.length ? (
                expenses.by_category.map((category) => (
                  <tr key={category.category_name}>
                    <td>{category.category_name}</td>
                    <td>{integer(category.expense_count)}</td>
                    <td>{money(category.amount)}</td>
                    <td>
                      {percentage(category.amount, expenses.total_approved_expenses)}%
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="empty-table-cell">
                    No approved expenses in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Owner snapshot</p>
              <h2>Operating notes</h2>
            </div>
          </header>
          <div className="report-notes-list">
            <article>
              <strong>{money(sales.refund_amount)}</strong>
              <span>Refunds recorded against {integer(sales.sale_count)} sale(s).</span>
            </article>
            <article>
              <strong>{money(sales.discount_amount)}</strong>
              <span>Discounts given during the selected period.</span>
            </article>
            <article>
              <strong>{integer(repairs.open_ticket_count)}</strong>
              <span>Open repair ticket(s) still on the bench.</span>
            </article>
            <article>
              <strong>{integer(inventory.total_available)}</strong>
              <span>Available sellable units across tracked stock balances.</span>
            </article>
          </div>
        </section>
      </div>
    </section>
  );
}
