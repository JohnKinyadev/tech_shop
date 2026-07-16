import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  ApiError,
  addSalePayment,
  closeTillSession,
  createPosSale,
  currentTillSession,
  getSaleReceipt,
  listCatalogProducts,
  listPosSales,
  listSerializedUnits,
  listTills,
  openTillSession,
} from "../api/client";
import type {
  CatalogProduct,
  PosProduct,
  PosSale,
  Receipt,
  SerializedUnit,
  StatusTone,
  Till,
  TillSession,
} from "../api/types";
import { StatusPill } from "../components/StatusPill";
import { mockProducts } from "../data/mockProducts";
import { useAuth } from "../state/auth";
import { dateLabel } from "../utils/format";

type CartItem = PosProduct & {
  lineId: string;
  quantity: number;
  serializedUnitId: string | null;
};

type PaymentMethod = "cash" | "mpesa" | "card" | "split";

function money(value: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

function idempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function unitLabel(unit?: SerializedUnit) {
  if (!unit) return "No unit selected";
  return unit.imei || unit.serial_number || unit.id;
}

function saleStatusTone(status: string): StatusTone {
  if (status === "completed" || status === "paid") return "success";
  if (status === "pending_payment" || status === "draft") return "warning";
  if (status === "voided" || status === "refunded" || status === "cancelled") {
    return "danger";
  }
  return "neutral";
}

function tillVariance(session: TillSession | null) {
  if (!session?.expected_cash || !session.closing_cash) return null;
  return Number(session.closing_cash) - Number(session.expected_cash);
}

function productsFromApi(products: CatalogProduct[]): PosProduct[] {
  const accents = ["#4e5381", "#0388d2", "#00897b", "#faaa33", "#aa47bd"];

  return products.flatMap((product, index) =>
    product.variants.map((variant) => ({
      id: `${product.id}:${variant.id}`,
      variantId: variant.id,
      name: product.name.replace(/^(Demo|Sample)\s+/i, ""),
      variantName: variant.name,
      sku: variant.sku,
      category: product.warranty_months ? "Devices" : "Accessories",
      price: Number(variant.selling_price),
      trackingType: variant.tracking_type,
      stockHint:
        variant.tracking_type === "bulk"
          ? "Bulk stock"
          : variant.tracking_type.toUpperCase(),
      accent: accents[index % accents.length],
    })),
  );
}

export function PosPage() {
  const { token, isPreview, user } = useAuth();
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [products, setProducts] = useState<PosProduct[]>(mockProducts);
  const [catalogLive, setCatalogLive] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [receiptViewer, setReceiptViewer] = useState<Receipt | null>(null);
  const [recentSales, setRecentSales] = useState<PosSale[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [pendingSale, setPendingSale] = useState<PosSale | null>(null);
  const [tillSession, setTillSession] = useState<TillSession | null>(null);
  const [tills, setTills] = useState<Till[]>([]);
  const [selectedTillId, setSelectedTillId] = useState("");
  const [openingFloat, setOpeningFloat] = useState("1000");
  const [closingCash, setClosingCash] = useState("");
  const [closeTillOpen, setCloseTillOpen] = useState(false);
  const [lastClosedTill, setLastClosedTill] = useState<TillSession | null>(null);
  const [tillBusy, setTillBusy] = useState(false);
  const [serializedUnitsByVariant, setSerializedUnitsByVariant] = useState<
    Record<string, SerializedUnit[]>
  >({});

  useEffect(() => {
    if (!token || isPreview) {
      return;
    }

    let active = true;
    Promise.allSettled([
      listCatalogProducts(token, query || "demo"),
      currentTillSession(token),
      user?.branch_id ? listTills(token, user.branch_id) : Promise.resolve([]),
      user?.branch_id ? listSerializedUnits(token, user.branch_id) : Promise.resolve({ items: [] }),
    ]).then(([catalogResult, tillResult, tillsResult, unitsResult]) => {
      if (!active) return;

      if (catalogResult.status === "fulfilled") {
        const apiProducts = productsFromApi(catalogResult.value.items);
        if (apiProducts.length) {
          setProducts(apiProducts);
        }
        setCatalogLive(true);
      } else {
        setCatalogLive(false);
        setNotice("Catalog unavailable. Showing local sample products.");
      }

      if (tillResult.status === "fulfilled") {
        setTillSession(tillResult.value);
        setSelectedTillId(tillResult.value.till_id);
      } else if (tillResult.reason instanceof ApiError) {
        setTillSession(null);
        setNotice("No open till session found. Select a till and enter opening float to start selling.");
      }

      if (tillsResult.status === "fulfilled") {
        setTills(tillsResult.value);
        setSelectedTillId((current) => current || tillsResult.value[0]?.id || "");
        if (tillResult.status !== "fulfilled" && !tillsResult.value.length) {
          setNotice("No active tills are configured for this branch. Ask a manager/admin to create one.");
        }
      } else if (tillResult.status !== "fulfilled") {
        const message =
          tillsResult.reason instanceof ApiError && tillsResult.reason.status === 403
            ? "This account cannot list tills for the selected branch."
            : "Could not load tills for this branch. Sign out and back in if this persists.";
        setNotice(message);
      }

      if (unitsResult.status === "fulfilled") {
        const grouped = unitsResult.value.items.reduce<Record<string, SerializedUnit[]>>(
          (result, unit) => {
            result[unit.variant_id] = [...(result[unit.variant_id] ?? []), unit];
            return result;
          },
          {},
        );
        setSerializedUnitsByVariant(grouped);
      }
    });

    return () => {
      active = false;
    };
  }, [isPreview, query, token, user?.branch_id]);

  useEffect(() => {
    void refreshRecentSales();
  }, [isPreview, token, user?.branch_id]);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((product) => product.category)))],
    [products],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return products.filter((product) => {
      const categoryMatches =
        activeCategory === "All" || product.category === activeCategory;
      const textMatches =
        !needle ||
        [product.name, product.variantName, product.sku, product.category]
          .join(" ")
          .toLowerCase()
          .includes(needle);

      return categoryMatches && textMatches;
    });
  }, [activeCategory, products, query]);

  const subtotal = cart.reduce(
    (total, item) => total + item.price * item.quantity,
    0,
  );
  const discount = 0;
  const total = Math.max(0, subtotal - discount);

  async function refreshRecentSales() {
    if (!token || isPreview || !user?.branch_id) return;
    setHistoryBusy(true);
    try {
      const page = await listPosSales(token, user.branch_id);
      setRecentSales(page.items);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load recent sales.");
    } finally {
      setHistoryBusy(false);
    }
  }

  async function openReceiptViewer(saleId: string) {
    if (!token || isPreview) {
      if (receipt) setReceiptViewer(receipt);
      return;
    }
    setHistoryBusy(true);
    try {
      const officialReceipt = await getSaleReceipt(token, saleId);
      setReceiptViewer(officialReceipt);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not open receipt.");
    } finally {
      setHistoryBusy(false);
    }
  }

  function printReceipt() {
    window.print();
  }

  function addToCart(product: PosProduct) {
    setPendingSale(null);
    setReceipt(null);

    if (product.trackingType !== "bulk") {
      const usedUnitIds = new Set(
        cart.map((item) => item.serializedUnitId).filter(Boolean),
      );
      const unit = (serializedUnitsByVariant[product.variantId] ?? []).find(
        (candidate) => !usedUnitIds.has(candidate.id),
      );

      if (!unit && token && !isPreview) {
        setNotice(`No available ${product.trackingType.toUpperCase()} unit found for ${product.name}.`);
        return;
      }

      setCart((current) => [
        ...current,
        {
          ...product,
          lineId: `${product.variantId}:${unit?.id ?? Date.now()}`,
          quantity: 1,
          serializedUnitId: unit?.id ?? null,
        },
      ]);
      return;
    }

    setCart((current) => {
      const existing = current.find(
        (item) => item.variantId === product.variantId && !item.serializedUnitId,
      );
      if (existing) {
        return current.map((item) =>
          item.lineId === existing.lineId
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [
        ...current,
        { ...product, lineId: product.variantId, quantity: 1, serializedUnitId: null },
      ];
    });
  }

  function updateQuantity(lineId: string, delta: number) {
    setPendingSale(null);
    setReceipt(null);
    setCart((current) =>
      current
        .map((item) => {
          if (item.lineId !== lineId) return item;
          if (item.trackingType !== "bulk" && delta > 0) {
            setNotice("Serialized/IMEI products are added one physical unit at a time.");
            return item;
          }
          return { ...item, quantity: Math.max(0, item.quantity + delta) };
        })
        .filter((item) => item.quantity > 0),
    );
  }

  function updateSerializedUnit(lineId: string, unitId: string) {
    setPendingSale(null);
    setReceipt(null);
    const duplicate = cart.some(
      (item) => item.lineId !== lineId && item.serializedUnitId === unitId,
    );
    if (duplicate) {
      setNotice("That IMEI/serial unit is already in the cart.");
      return;
    }
    setCart((current) =>
      current.map((item) =>
        item.lineId === lineId ? { ...item, serializedUnitId: unitId || null } : item,
      ),
    );
  }

  function openPayment() {
    if (token && !isPreview && !tillSession) {
      setNotice("Open a till session before taking payment.");
      return;
    }
    if (token && !isPreview && !catalogLive) {
      setNotice("Live catalog is unavailable. Reload products before completing a real sale.");
      return;
    }
    if (!cart.length) {
      setNotice("Add at least one item before payment.");
      return;
    }
    const missingUnit = cart.find(
      (item) => item.trackingType !== "bulk" && !item.serializedUnitId,
    );
    if (missingUnit && token && !isPreview) {
      setNotice(`Select the IMEI/serial unit for ${missingUnit.name} before payment.`);
      return;
    }
    setPaymentOpen(true);
  }

  async function completePayment() {
    if (!token || isPreview) {
      setPaymentOpen(false);
      setCart([]);
      setNotice("Preview sale completed locally. Sign in to record a live POS sale.");
      return;
    }

    if (!user?.branch_id || !tillSession) {
      setNotice("A branch and open till session are required before payment.");
      return;
    }

    if (paymentMethod === "split") {
      setNotice("Split payment will come after single-method checkout is stable.");
      return;
    }

    if (paymentMethod !== "cash" && !paymentReference.trim()) {
      setNotice("Enter the M-Pesa/card reference before confirming payment.");
      return;
    }

    setPaymentBusy(true);
    try {
      const sale =
        pendingSale ??
        (await createPosSale(token, {
          branch_id: user.branch_id,
          till_session_id: tillSession.id,
          channel: "pos",
          notes: "Created from POS terminal",
          items: cart.map((item) => ({
            variant_id: item.variantId,
            serialized_unit_id: item.serializedUnitId,
            quantity: item.quantity,
            discount_amount: 0,
          })),
        }));

      setPendingSale(sale);
      await addSalePayment(token, sale.id, {
        method: paymentMethod,
        amount: sale.total_amount,
        provider_reference:
          paymentMethod === "cash" ? null : paymentReference.trim(),
        idempotency_key: idempotencyKey(),
        notes: `POS ${paymentMethod} payment`,
      });

      const officialReceipt = await getSaleReceipt(token, sale.id);
      setReceipt(officialReceipt);
      setReceiptViewer(officialReceipt);
      setCart([]);
      setPendingSale(null);
      setPaymentReference("");
      setPaymentOpen(false);
      setNotice(`Sale ${officialReceipt.invoice_number} completed successfully.`);
      void refreshRecentSales();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not complete sale.");
    } finally {
      setPaymentBusy(false);
    }
  }

  async function handleOpenTill(event: FormEvent) {
    event.preventDefault();
    if (!token || isPreview) {
      setNotice("Preview mode does not need a live till session.");
      return;
    }
    if (!user?.branch_id) {
      setNotice("This user is not scoped to a branch. Use a branch cashier or manager to open POS.");
      return;
    }
    if (!selectedTillId) {
      setNotice("Select a till before opening a session.");
      return;
    }

    setTillBusy(true);
    try {
      const session = await openTillSession(token, {
        till_id: selectedTillId,
        opening_float: Number(openingFloat) || 0,
      });
      setTillSession(session);
      setNotice(`Till opened with ${money(Number(session.opening_float))} float.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not open till session.");
    } finally {
      setTillBusy(false);
    }
  }

  async function handleCloseTill(event: FormEvent) {
    event.preventDefault();
    if (!token || isPreview || !tillSession) {
      setNotice("No live till session is open.");
      return;
    }
    if (cart.length) {
      setNotice("Clear or complete the current cart before closing the till.");
      return;
    }
    if (closingCash.trim() === "") {
      setNotice("Enter the counted closing cash before closing the till.");
      return;
    }

    setTillBusy(true);
    try {
      const closed = await closeTillSession(token, tillSession.id, {
        closing_cash: Number(closingCash) || 0,
      });
      const variance = tillVariance(closed);
      setLastClosedTill(closed);
      setTillSession(null);
      setCloseTillOpen(false);
      setClosingCash("");
      setNotice(
        `Till closed. Expected ${money(Number(closed.expected_cash ?? 0))}, counted ${money(
          Number(closed.closing_cash ?? 0),
        )}, variance ${money(variance ?? 0)}.`,
      );
      void refreshRecentSales();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not close till session.");
    } finally {
      setTillBusy(false);
    }
  }

  return (
    <section className="pos-terminal">
      <aside className="pos-order-panel">
        <header className="order-tabs">
          <button className="orders-tab is-active">
            <strong>Order 1</strong>
            <span>{cart.length || 0} items</span>
          </button>
          <button className="orders-tab">Held</button>
          <button className="orders-tab orders-tab--add">+</button>
        </header>

        <div className="customer-strip">
          <div>
            <span>Client</span>
            <strong>Walk-in customer</strong>
          </div>
          <button>Search Clients</button>
        </div>

        <div className="order-list">
          {cart.length === 0 && (
            <div className="empty-order">
              <strong>No items selected</strong>
              <span>Search, scan, or choose a category to start selling.</span>
            </div>
          )}

          {cart.map((item) => (
            <article className="order-line" key={item.lineId}>
              <div className="order-line__qty">
                <strong>{item.quantity}</strong>
                <span>
                  {item.trackingType === "bulk" ? "Unit(s)" : item.trackingType.toUpperCase()}
                </span>
              </div>
              <div className="order-line__meta">
                <div>
                  <h3>{item.name}</h3>
                  <strong>{money(item.price * item.quantity)}</strong>
                </div>
                <small>
                  {item.sku} / {item.variantName}
                </small>

                {item.trackingType !== "bulk" && (
                  <label className="serial-select">
                    IMEI / serial
                    <select
                      value={item.serializedUnitId ?? ""}
                      onChange={(event) =>
                        updateSerializedUnit(item.lineId, event.target.value)
                      }
                    >
                      <option value="">Select unit</option>
                      {(serializedUnitsByVariant[item.variantId] ?? []).map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unitLabel(unit)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <div className="order-line__controls">
                  <button onClick={() => updateQuantity(item.lineId, -1)}>
                    -
                  </button>
                  <button onClick={() => updateQuantity(item.lineId, 1)}>
                    +
                  </button>
                  <button onClick={() => updateQuantity(item.lineId, -item.quantity)}>
                    Remove
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        <footer className="order-footer">
          <div className="order-summary">
            <div>
              <span>Subtotal</span>
              <strong>{money(subtotal)}</strong>
            </div>
            <div>
              <span>Discount</span>
              <strong>{money(discount)}</strong>
            </div>
            <div className="order-summary__total">
              <span>Total</span>
              <strong>{money(total)}</strong>
            </div>
          </div>

          <div className="order-keypad-actions">
            <button>Qty</button>
            <button>Price</button>
            <button>Disc %</button>
            <button>Disc KES</button>
          </div>

          <div className="order-actions">
            <button className="danger-button">Void</button>
            <button>Hold</button>
            <button className="success-button" onClick={openPayment}>
              Payment
            </button>
          </div>
        </footer>
      </aside>

      <section className="pos-products-panel">
        <header className="pos-products-header">
          <div className="pos-search-row">
            <label className="pos-search">
              <span>Search</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search products, SKU, barcode"
                autoFocus
              />
            </label>
            <button className="info-button">Product Information</button>
            <StatusPill tone={tillSession ? "success" : "warning"}>
              {tillSession ? "Till open" : "Open till required"}
            </StatusPill>
          </div>

          <div className="category-list">
            {categories.map((category) => (
              <button
                key={category}
                className={activeCategory === category ? "is-active" : ""}
                onClick={() => setActiveCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
        </header>

        {!tillSession && token && !isPreview && (
          <form className="till-open-panel" onSubmit={handleOpenTill}>
            <div>
              <p className="eyebrow">Open till</p>
              <strong>Start cashier session</strong>
              <span>Select a physical till and confirm the opening cash float.</span>
            </div>
            <label>
              Till
              <select
                value={selectedTillId}
                onChange={(event) => setSelectedTillId(event.target.value)}
              >
                <option value="">Select till</option>
                {tills.map((till) => (
                  <option key={till.id} value={till.id}>
                    {till.name} / {till.code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Opening float
              <input
                type="number"
                min="0"
                value={openingFloat}
                onChange={(event) => setOpeningFloat(event.target.value)}
              />
            </label>
            <button className="primary-button" disabled={tillBusy || !tills.length}>
              {tillBusy ? "Opening..." : "Open Till"}
            </button>
          </form>
        )}

        {tillSession && token && !isPreview && (
          <section className="till-close-panel">
            <div>
              <p className="eyebrow">Till session</p>
              <strong>Cashier till is open</strong>
              <span>
                Opened {dateLabel(tillSession.opened_at)} / Float{" "}
                {money(Number(tillSession.opening_float))}
              </span>
            </div>
            {!closeTillOpen ? (
              <button
                className="secondary-button"
                onClick={() => {
                  setCloseTillOpen(true);
                  setClosingCash(tillSession.expected_cash ?? "");
                }}
              >
                Close Till
              </button>
            ) : (
              <form onSubmit={handleCloseTill}>
                <label>
                  Counted closing cash
                  <input
                    type="number"
                    min="0"
                    value={closingCash}
                    onChange={(event) => setClosingCash(event.target.value)}
                    placeholder="Enter counted cash"
                  />
                </label>
                <div className="table-actions">
                  <button className="danger-button" disabled={tillBusy}>
                    {tillBusy ? "Closing..." : "Confirm Close"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCloseTillOpen(false)}
                    disabled={tillBusy}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>
        )}

        {!tillSession && lastClosedTill && (
          <section className="till-close-summary">
            <div>
              <p className="eyebrow">Last till close</p>
              <strong>{dateLabel(lastClosedTill.closed_at)}</strong>
              <span>
                Expected {money(Number(lastClosedTill.expected_cash ?? 0))} / Counted{" "}
                {money(Number(lastClosedTill.closing_cash ?? 0))}
              </span>
            </div>
            <StatusPill tone={(tillVariance(lastClosedTill) ?? 0) === 0 ? "success" : "warning"}>
              Variance {money(tillVariance(lastClosedTill) ?? 0)}
            </StatusPill>
          </section>
        )}

        {notice && (
          <div className="notice">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)}>Dismiss</button>
          </div>
        )}

        {receipt && (
          <section className="receipt-strip">
            <div>
              <p className="eyebrow">Last receipt</p>
              <strong>{receipt.invoice_number}</strong>
              <span>
                {receipt.branch_name} / {receipt.cashier_name ?? user?.full_name} /{" "}
                {receipt.items.length} item(s)
              </span>
              <span>{dateLabel(receipt.completed_at)}</span>
            </div>
            <strong>{money(Number(receipt.total_amount))}</strong>
          </section>
        )}

        <section className="sales-history-panel">
          <header>
            <div>
              <p className="eyebrow">Recent sales</p>
              <strong>Receipts / invoices</strong>
            </div>
            <button onClick={() => void refreshRecentSales()} disabled={historyBusy}>
              {historyBusy ? "Loading..." : "Refresh"}
            </button>
          </header>

          <div className="sales-history-list">
            {recentSales.length === 0 && (
              <div className="sales-history-empty">
                No sales found yet. Completed sales will appear here.
              </div>
            )}

            {recentSales.map((sale) => (
              <article className="sales-history-row" key={sale.id}>
                <div>
                  <strong>{sale.invoice_number}</strong>
                  <span>
                    {sale.items.length} item(s) / Paid {money(Number(sale.paid_amount))}
                  </span>
                  <span>{dateLabel(sale.completed_at ?? sale.created_at)}</span>
                </div>
                <StatusPill tone={saleStatusTone(sale.status)}>
                  {sale.status.replace(/_/g, " ")}
                </StatusPill>
                <strong>{money(Number(sale.total_amount))}</strong>
                <button
                  disabled={sale.status !== "completed" || historyBusy}
                  onClick={() => void openReceiptViewer(sale.id)}
                >
                  Receipt
                </button>
              </article>
            ))}
          </div>
        </section>

        <div className="product-list-scroller">
          <div className="terminal-product-grid">
            {filtered.map((product) => (
              <button
                className="product-tile"
                key={product.id}
                onClick={() => addToCart(product)}
              >
                <span
                  className="product-tile__media"
                  style={{ background: product.accent }}
                >
                  {product.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="product-tile__body">
                  <strong>{product.name}</strong>
                  <small>{product.variantName}</small>
                  <span className="product-tile__meta">
                    <b>{money(product.price)}</b>
                    <em>{product.stockHint}</em>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {receiptViewer && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="receipt-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Receipt"
          >
            <header className="receipt-modal__header">
              <div>
                <p className="eyebrow">Receipt</p>
                <h2>{receiptViewer.invoice_number}</h2>
                <span>
                  {receiptViewer.branch_name} / {receiptViewer.branch_code}
                </span>
              </div>
              <div className="table-actions">
                <button onClick={printReceipt}>Print</button>
                <button onClick={() => setReceiptViewer(null)}>Close</button>
              </div>
            </header>

            <div className="receipt-paper">
              <div className="receipt-brand">
                <div>
                  <p className="eyebrow">Crystal-shop POS</p>
                  <h3>{receiptViewer.branch_name}</h3>
                  <span>
                    {receiptViewer.branch_address ??
                      `${receiptViewer.branch_code} branch`}
                  </span>
                </div>
                <div>
                  <span>Invoice number</span>
                  <strong>{receiptViewer.invoice_number}</strong>
                  <span>{dateLabel(receiptViewer.completed_at)}</span>
                </div>
              </div>

              <div className="receipt-paper__meta">
                <div>
                  <span>Cashier</span>
                  <strong>{receiptViewer.cashier_name ?? "Cashier"}</strong>
                </div>
                <div>
                  <span>Customer</span>
                  <strong>{receiptViewer.customer_name ?? "Walk-in customer"}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{receiptViewer.sale_status.replace(/_/g, " ")}</strong>
                </div>
                <div>
                  <span>Sale date</span>
                  <strong>{dateLabel(receiptViewer.completed_at)}</strong>
                </div>
              </div>

              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {receiptViewer.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.description}</td>
                      <td>{item.quantity}</td>
                      <td>{money(Number(item.unit_price))}</td>
                      <td>{money(Number(item.line_total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="receipt-totals">
                <div>
                  <span>Subtotal</span>
                  <strong>{money(Number(receiptViewer.subtotal))}</strong>
                </div>
                <div>
                  <span>Discount</span>
                  <strong>{money(Number(receiptViewer.discount_amount))}</strong>
                </div>
                <div>
                  <span>Paid</span>
                  <strong>{money(Number(receiptViewer.paid_amount))}</strong>
                </div>
                <div className="receipt-totals__grand">
                  <span>Total</span>
                  <strong>{money(Number(receiptViewer.total_amount))}</strong>
                </div>
              </div>

              <div className="receipt-payments">
                <strong>Payments</strong>
                {receiptViewer.payments.map((payment) => (
                  <span key={`${payment.method}-${payment.paid_at ?? payment.amount}`}>
                    {payment.method.toUpperCase()} / {money(Number(payment.amount))}
                    {payment.provider_reference ? ` / Ref ${payment.provider_reference}` : ""}
                    {` / ${dateLabel(payment.paid_at)}`}
                  </span>
                ))}
              </div>

              <div className="receipt-footer-note">
                <strong>Thank you for shopping with us.</strong>
                <span>
                  Keep this receipt for warranty, returns, and service tracking.
                  Returns, voids, and refunds are subject to manager approval.
                </span>
              </div>
            </div>
          </section>
        </div>
      )}

      {paymentOpen && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="payment-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Payment"
          >
            <header className="payment-modal__header">
              <div>
                <p className="eyebrow">Payment</p>
                <h2>{money(total)}</h2>
                <span>Cashier: {user?.full_name}</span>
              </div>
              <button onClick={() => setPaymentOpen(false)}>Close</button>
            </header>

            <div className="payment-modal__body">
              <section className="payment-method-panel">
                <h3>Payment Method</h3>
                <div className="payment-methods">
                  {(["cash", "mpesa", "card", "split"] as PaymentMethod[]).map((method) => (
                    <button
                      key={method}
                      className={paymentMethod === method ? "is-active" : ""}
                      onClick={() => setPaymentMethod(method)}
                    >
                      {method === "mpesa" ? "M-Pesa" : method}
                    </button>
                  ))}
                </div>
                {paymentMethod !== "cash" && paymentMethod !== "split" && (
                  <label className="payment-reference">
                    Payment reference
                    <input
                      value={paymentReference}
                      onChange={(event) => setPaymentReference(event.target.value)}
                      placeholder="M-Pesa code or card reference"
                    />
                  </label>
                )}
                <table className="payment-table">
                  <tbody>
                    <tr>
                      <th>Subtotal</th>
                      <td>{money(subtotal)}</td>
                    </tr>
                    <tr>
                      <th>Discount</th>
                      <td>{money(discount)}</td>
                    </tr>
                    <tr>
                      <th>Net Payable</th>
                      <td>{money(total)}</td>
                    </tr>
                  </tbody>
                </table>
              </section>

              <section className="numpad-panel">
                <div className="numpad-display">{money(total)}</div>
                <div className="numpad">
                  {["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ".", "Clear"].map(
                    (key) => (
                      <button key={key}>{key}</button>
                    ),
                  )}
                </div>
                <button
                  className="success-button confirm-payment"
                  disabled={paymentBusy}
                  onClick={completePayment}
                >
                  {paymentBusy ? "Completing..." : "Confirm Payment"}
                </button>
              </section>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
