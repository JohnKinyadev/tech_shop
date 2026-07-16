import { useEffect, useState } from "react";

import { inventorySummary, repairSummary, salesSummary } from "../api/client";
import type { InventorySummary, RepairSummary, SalesSummary } from "../api/types";
import { StatusPill } from "../components/StatusPill";
import { demoDashboard } from "../data/demoManagement";
import { useAuth } from "../state/auth";
import { integer, money, titleize } from "../utils/format";

export function ReportsPage() {
  const { token, isPreview } = useAuth();
  const [sales, setSales] = useState<SalesSummary>(demoDashboard.sales);
  const [inventory, setInventory] = useState<InventorySummary>(
    demoDashboard.inventory,
  );
  const [repairs, setRepairs] = useState<RepairSummary>(demoDashboard.repairs);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!token || isPreview) return;

    let active = true;
    Promise.allSettled([
      salesSummary(token),
      inventorySummary(token),
      repairSummary(token),
    ]).then(([salesResult, inventoryResult, repairResult]) => {
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

      setNotice(failed ? "Some reports are unavailable or not permitted. Showing sample data where needed." : null);
    });

    return () => {
      active = false;
    };
  }, [isPreview, token]);

  return (
    <section className="module-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Reports</p>
          <h1>Reports</h1>
          <p>
            Review sales, inventory value, repair throughput, payment breakdown,
            low-stock pressure, and operating totals.
          </p>
        </div>
        <button className="primary-button">Export Report</button>
      </div>

      {notice && <div className="notice notice--page">{notice}</div>}

      <div className="stats-grid">
        <article className="metric-card">
          <span>Net sales</span>
          <strong>{money(sales.net_sales)}</strong>
          <StatusPill tone="success">{integer(sales.sale_count)} sales</StatusPill>
        </article>
        <article className="metric-card">
          <span>Average sale</span>
          <strong>{money(sales.average_sale)}</strong>
          <StatusPill tone="info">{integer(sales.item_count)} items</StatusPill>
        </article>
        <article className="metric-card">
          <span>Stock value</span>
          <strong>{money(inventory.stock_value)}</strong>
          <StatusPill tone="warning">
            {integer(inventory.low_stock_count)} low
          </StatusPill>
        </article>
        <article className="metric-card">
          <span>Repair payments</span>
          <strong>{money(repairs.payment_total)}</strong>
          <StatusPill tone="neutral">
            {integer(repairs.ticket_count)} tickets
          </StatusPill>
        </article>
      </div>

      <div className="dashboard-grid">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Sales</p>
              <h2>Payment breakdown</h2>
            </div>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Transactions</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {sales.payments.map((payment) => (
                <tr key={payment.method}>
                  <td>{titleize(payment.method)}</td>
                  <td>{integer(payment.transaction_count)}</td>
                  <td>{money(payment.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Inventory</p>
              <h2>Low-stock watch</h2>
            </div>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product</th>
                <th>Available</th>
                <th>Reorder</th>
              </tr>
            </thead>
            <tbody>
              {inventory.low_stock_items.map((item) => (
                <tr key={item.sku}>
                  <td>{item.sku}</td>
                  <td>{item.product_name}</td>
                  <td>{integer(item.available_quantity)}</td>
                  <td>{integer(item.reorder_level)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </section>
  );
}
