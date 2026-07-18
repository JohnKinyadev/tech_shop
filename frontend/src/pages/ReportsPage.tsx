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

type DatePreset = "today" | "last_7" | "last_30" | "this_month" | "custom";

const datePresets: Array<{ value: DatePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "last_7", label: "Last 7 days" },
  { value: "last_30", label: "Last 30 days" },
  { value: "this_month", label: "This month" },
  { value: "custom", label: "Custom" },
];

function inputDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function presetRange(preset: DatePreset) {
  const today = new Date();
  if (preset === "custom") return { start: "", end: "" };
  if (preset === "today") return { start: inputDate(today), end: inputDate(today) };
  if (preset === "this_month") {
    return {
      start: inputDate(new Date(today.getFullYear(), today.getMonth(), 1)),
      end: inputDate(today),
    };
  }
  const days = preset === "last_7" ? 6 : 29;
  const start = new Date(today);
  start.setDate(today.getDate() - days);
  return { start: inputDate(start), end: inputDate(today) };
}

function readableDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium" }).format(date);
}

export function ReportsPage() {
  const { token, isPreview, user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>(demoBranches);
  const [selectedBranchId, setSelectedBranchId] = useState(user?.branch_id ?? "all");
  const [datePreset, setDatePreset] = useState<DatePreset>("this_month");
  const [startDate, setStartDate] = useState(
    () => presetRange("this_month").start,
  );
  const [endDate, setEndDate] = useState(() => presetRange("this_month").end);
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
  const operatingRevenue =
    numberValue(sales.net_sales) + numberValue(repairs.payment_total);
  const expenseRatio = percentage(expenses.total_approved_expenses, operatingRevenue);
  const repairCollectionRate = percentage(
    repairs.collected_ticket_count,
    repairs.ticket_count,
  );
  const stockAvailability = percentage(
    inventory.total_available,
    inventory.total_on_hand,
  );
  const refundRate = percentage(sales.refund_amount, sales.gross_sales);
  const discountRate = percentage(sales.discount_amount, sales.gross_sales);
  const branchLabel =
    selectedBranchId === "all"
      ? "All branches"
      : branches.find((branch) => branch.id === selectedBranchId)?.name ??
        "Selected branch";
  const periodLabel =
    startDate && endDate
      ? `${readableDate(startDate)} — ${readableDate(endDate)}`
      : startDate
        ? `From ${readableDate(startDate)}`
        : endDate
          ? `Until ${readableDate(endDate)}`
          : "All available dates";
  const inventoryContext =
    selectedBranchId === "all"
      ? "Inventory is current across accessible branches"
      : `Inventory is current for ${branchLabel}`;

  const attentionItems: Array<{
    label: string;
    value: string;
    detail: string;
    tone: StatusTone;
  }> = [
    {
      label: "Low-stock items",
      value: integer(inventory.low_stock_count),
      detail:
        inventory.low_stock_count > 0
          ? "Review purchasing and reorder levels"
          : "No urgent reorder pressure",
      tone: inventory.low_stock_count ? "warning" : "success",
    },
    {
      label: "Pending expenses",
      value: integer(expenses.pending_expense_count),
      detail:
        expenses.pending_expense_count > 0
          ? "Approvals still affect profit clarity"
          : "Expense queue is clear",
      tone: expenses.pending_expense_count ? "warning" : "success",
    },
    {
      label: "Ready repairs",
      value: integer(repairs.ready_ticket_count),
      detail:
        repairs.ready_ticket_count > 0
          ? "Call customers and collect balances"
          : "No pickup pile-up",
      tone: repairs.ready_ticket_count ? "info" : "success",
    },
    {
      label: "Refund pressure",
      value: `${refundRate}%`,
      detail:
        refundRate > 5
          ? "Refunds are material for this period"
          : "Refunds are under control",
      tone: refundRate > 5 ? "warning" : "success",
    },
  ];

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
      label: "Operating revenue",
      value: money(operatingRevenue),
      detail: "Net sales + repair payments",
      tone: operatingRevenue > 0 ? "success" : "neutral",
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
    {
      label: "Expense ratio",
      value: `${expenseRatio}%`,
      detail: "Approved expenses vs operating revenue",
      tone: expenseRatio > 35 ? "warning" : "success",
    },
  ];

  function applyDatePreset(preset: DatePreset) {
    setDatePreset(preset);
    if (preset === "custom") return;
    const range = presetRange(preset);
    setStartDate(range.start);
    setEndDate(range.end);
  }

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
          Date preset
          <select
            value={datePreset}
            onChange={(event) => applyDatePreset(event.target.value as DatePreset)}
          >
            {datePresets.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
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
            onChange={(event) => {
              setDatePreset("custom");
              setStartDate(event.target.value);
            }}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={endDate}
            onChange={(event) => {
              setDatePreset("custom");
              setEndDate(event.target.value);
            }}
          />
        </label>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            const range = presetRange("this_month");
            setDatePreset("this_month");
            setStartDate(range.start);
            setEndDate(range.end);
            setSelectedBranchId(user?.branch_id ?? "all");
          }}
        >
          Reset Month
        </button>
      </section>

      <section className="report-context-strip">
        <article>
          <span>Branch scope</span>
          <strong>{branchLabel}</strong>
        </article>
        <article>
          <span>Report period</span>
          <strong>{periodLabel}</strong>
        </article>
        <article>
          <span>Inventory context</span>
          <strong>{inventoryContext}</strong>
        </article>
        <article>
          <span>Generated view</span>
          <strong>{new Intl.DateTimeFormat("en-KE", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date())}</strong>
        </article>
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

      <section className="report-attention-grid">
        {attentionItems.map((item) => (
          <article key={item.label}>
            <div>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
            <StatusPill tone={item.tone}>{item.detail}</StatusPill>
          </article>
        ))}
      </section>

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
                <th>Pressure</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {inventory.low_stock_items.length ? (
                inventory.low_stock_items.map((item) => {
                  const shortage = Math.max(
                    0,
                    item.reorder_level - item.available_quantity,
                  );
                  return (
                    <tr key={item.sku}>
                      <td>{item.sku}</td>
                      <td>
                        {item.product_name}
                        <span>{item.variant_name}</span>
                      </td>
                      <td>{integer(item.quantity_on_hand)}</td>
                      <td>{integer(item.available_quantity)}</td>
                      <td>{integer(item.reorder_level)}</td>
                      <td>
                        <StatusPill tone={shortage > 5 ? "danger" : "warning"}>
                          {integer(shortage)} short
                        </StatusPill>
                      </td>
                      <td>{money(item.stock_value)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="empty-table-cell">
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
                      <span>
                        {integer(item.ticket_count)} ticket(s) · {share}% of queue
                      </span>
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
                expenses.by_category.map((category) => {
                  const share = percentage(
                    category.amount,
                    expenses.total_approved_expenses,
                  );
                  return (
                    <tr key={category.category_name}>
                      <td>{category.category_name}</td>
                      <td>{integer(category.expense_count)}</td>
                      <td>{money(category.amount)}</td>
                      <td>
                        <div className="report-table-share">
                          <strong>{share}%</strong>
                          <div className="report-bar">
                            <span style={{ width: `${share}%` }} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
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
              <strong>{discountRate}%</strong>
              <span>{money(sales.discount_amount)} given as discounts.</span>
            </article>
            <article>
              <strong>{repairCollectionRate}%</strong>
              <span>Repair collection rate in the selected period.</span>
            </article>
            <article>
              <strong>{stockAvailability}%</strong>
              <span>
                Stock availability across {integer(inventory.stock_balance_count)} balances.
              </span>
            </article>
            <article>
              <strong>{integer(repairs.open_ticket_count)}</strong>
              <span>Open repair ticket(s) still on the bench.</span>
            </article>
            <article>
              <strong>{expenseRatio}%</strong>
              <span>Expense ratio against operating revenue.</span>
            </article>
          </div>
        </section>
      </div>
    </section>
  );
}
