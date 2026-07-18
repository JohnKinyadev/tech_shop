import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  approvePurchaseOrder,
  createPurchaseOrder,
  createSupplier,
  listBranches,
  listCatalogProducts,
  listPurchaseOrderReceipts,
  listPurchaseOrders,
  listSuppliers,
  receivePurchaseOrder,
  submitPurchaseOrder,
} from "../api/client";
import type {
  Branch,
  CatalogProduct,
  GoodsReceipt,
  PurchaseOrder,
  Supplier,
} from "../api/types";
import { StatusPill } from "../components/StatusPill";
import {
  demoBranches,
  demoPurchaseOrders,
  demoSuppliers,
} from "../data/demoManagement";
import { mockProducts } from "../data/mockProducts";
import { useAuth } from "../state/auth";
import { dateLabel, integer, money, titleize, toneForStatus } from "../utils/format";

type VariantOption = {
  id: string;
  label: string;
  sku: string;
  trackingType: "bulk" | "serial" | "imei";
  price: number;
};

type PurchaseDraftLine = {
  variantId: string;
  label: string;
  sku: string;
  trackingType: VariantOption["trackingType"];
  orderedQuantity: number;
  unitCost: number;
  taxRate: number;
};

type PurchaseStatusFilter =
  | "all"
  | "draft"
  | "submitted"
  | "approved"
  | "partially_received"
  | "received"
  | "cancelled";

const purchaseStatusOptions: Array<{
  value: PurchaseStatusFilter;
  label: string;
}> = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "partially_received", label: "Partially received" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
];

const emptySupplierForm = {
  name: "",
  contact_person: "",
  phone: "",
  email: "",
  payment_terms_days: "7",
};

const emptyPurchaseForm = {
  supplier_id: demoSuppliers[0]?.id ?? "",
  variant_id: mockProducts[0]?.variantId ?? "",
  ordered_quantity: "1",
  unit_cost: "",
  tax_rate: "0",
  supplier_reference: "",
  expected_at: "",
  notes: "",
};

const emptyReceiptForm = {
  purchase_order_item_id: "",
  quantity: "1",
  supplier_delivery_note: "",
  serial_numbers: "",
  imeis: "",
  notes: "",
};

function optionalDateTime(date: string) {
  return date ? `${date}T09:00:00` : null;
}

function splitIdentifiers(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function catalogToVariantOptions(products: CatalogProduct[]): VariantOption[] {
  return products.flatMap((product) =>
    product.variants.map((variant) => ({
      id: variant.id,
      label: `${product.name} / ${variant.name}`,
      sku: variant.sku,
      trackingType: variant.tracking_type,
      price: Number(variant.selling_price),
    })),
  );
}

function estimateUnitCost(option?: VariantOption) {
  if (!option) return "";
  return String(Math.max(1, Math.round(option.price * 0.65)));
}

function orderUnits(order: PurchaseOrder) {
  return order.items.reduce(
    (totals, item) => ({
      ordered: totals.ordered + item.ordered_quantity,
      received: totals.received + item.received_quantity,
    }),
    { ordered: 0, received: 0 },
  );
}

function orderProgress(order?: PurchaseOrder) {
  if (!order) return { ordered: 0, received: 0, remaining: 0, percent: 0 };
  const units = orderUnits(order);
  const remaining = Math.max(0, units.ordered - units.received);
  return {
    ...units,
    remaining,
    percent: units.ordered
      ? Math.min(100, Math.round((units.received / units.ordered) * 100))
      : 0,
  };
}

function lineTotal(quantity: number, unitCost: number, taxRate: number) {
  const subtotal = quantity * unitCost;
  return subtotal + subtotal * (taxRate / 100);
}

function duplicateIdentifier(values: string[], caseSensitive = false) {
  const normalized = values.map((value) =>
    caseSensitive ? value : value.toLowerCase(),
  );
  return new Set(normalized).size !== normalized.length;
}

function receiptIdentifierIssue(
  trackingType: VariantOption["trackingType"] | undefined,
  quantity: number,
  serialNumbers: string[],
  imeis: string[],
) {
  if (!trackingType || !quantity || quantity <= 0) return null;
  if (duplicateIdentifier(serialNumbers)) {
    return "Serial numbers cannot be repeated in the same receipt.";
  }
  if (duplicateIdentifier(imeis, true)) {
    return "IMEI numbers cannot be repeated in the same receipt.";
  }
  if (imeis.some((imei) => !/^\d{15}$/.test(imei))) {
    return "Every IMEI must contain exactly 15 digits.";
  }
  if (trackingType === "bulk" && (serialNumbers.length || imeis.length)) {
    return "Bulk items should be received by quantity only. Remove serial or IMEI values.";
  }
  if (trackingType === "serial") {
    if (serialNumbers.length !== quantity) {
      return `Serialized stock needs ${quantity} serial number(s).`;
    }
    if (imeis.length && imeis.length !== quantity) {
      return `Optional IMEIs must also be ${quantity} value(s), or left blank.`;
    }
  }
  if (trackingType === "imei") {
    if (imeis.length !== quantity) {
      return `Phone/IMEI stock needs ${quantity} IMEI number(s).`;
    }
    if (serialNumbers.length && serialNumbers.length !== quantity) {
      return `Optional serial numbers must also be ${quantity} value(s), or left blank.`;
    }
  }
  return null;
}

export function PurchasesPage() {
  const { token, isPreview, user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>(demoBranches);
  const [orders, setOrders] = useState<PurchaseOrder[]>(demoPurchaseOrders);
  const [suppliers, setSuppliers] = useState<Supplier[]>(demoSuppliers);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState(
    user?.branch_id ?? demoBranches[0]?.id ?? "",
  );
  const [selectedOrderId, setSelectedOrderId] = useState(
    demoPurchaseOrders[0]?.id ?? "",
  );
  const [orderQuery, setOrderQuery] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] =
    useState<PurchaseStatusFilter>("all");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [purchaseForm, setPurchaseForm] = useState(emptyPurchaseForm);
  const [purchaseLines, setPurchaseLines] = useState<PurchaseDraftLine[]>([]);
  const [receiptForm, setReceiptForm] = useState(emptyReceiptForm);
  const [receiptHistory, setReceiptHistory] = useState<GoodsReceipt[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const supplierById = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])),
    [suppliers],
  );

  const previewVariantOptions = useMemo(() => {
    const needle = productSearch.trim().toLowerCase();
    return mockProducts
      .filter((product) =>
        !needle
          ? true
          : [product.name, product.variantName, product.sku, product.category]
              .join(" ")
              .toLowerCase()
              .includes(needle),
      )
      .map((product) => ({
        id: product.variantId,
        label: `${product.name} / ${product.variantName}`,
        sku: product.sku,
        trackingType: product.trackingType,
        price: product.price,
      }));
  }, [productSearch]);

  const variantOptions = useMemo(
    () =>
      !token || isPreview
        ? previewVariantOptions
        : catalogToVariantOptions(catalogProducts),
    [catalogProducts, isPreview, previewVariantOptions, token],
  );

  const variantById = useMemo(
    () => new Map(variantOptions.map((variant) => [variant.id, variant])),
    [variantOptions],
  );
  const selectedPurchaseVariant = variantById.get(purchaseForm.variant_id);

  const branchOrders = useMemo(
    () =>
      orders.filter((order) =>
        selectedBranchId ? order.branch_id === selectedBranchId : true,
      ),
    [orders, selectedBranchId],
  );

  const visibleOrders = useMemo(() => {
    const needle = orderQuery.trim().toLowerCase();
    return branchOrders.filter((order) => {
      const supplierName = supplierById.get(order.supplier_id) ?? "";
      const matchesQuery =
        !needle ||
        [
          order.order_number,
          order.supplier_reference ?? "",
          supplierName,
          order.notes ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      const matchesStatus =
        orderStatusFilter === "all" || order.status === orderStatusFilter;
      const matchesSupplier =
        !supplierFilter || order.supplier_id === supplierFilter;
      return matchesQuery && matchesStatus && matchesSupplier;
    });
  }, [branchOrders, orderQuery, orderStatusFilter, supplierById, supplierFilter]);

  const selectedOrder = useMemo(
    () =>
      branchOrders.find((order) => order.id === selectedOrderId) ??
      branchOrders[0],
    [branchOrders, selectedOrderId],
  );
  const selectedOrderProgress = useMemo(
    () => orderProgress(selectedOrder),
    [selectedOrder],
  );

  const receivableItems = useMemo(
    () =>
      selectedOrder?.items.filter(
        (item) => item.ordered_quantity > item.received_quantity,
      ) ?? [],
    [selectedOrder],
  );
  const selectedReceiptItem = useMemo(
    () =>
      receivableItems.find(
        (item) => item.id === receiptForm.purchase_order_item_id,
      ),
    [receivableItems, receiptForm.purchase_order_item_id],
  );
  const selectedReceiptVariant = selectedReceiptItem
    ? variantById.get(selectedReceiptItem.variant_id)
    : undefined;
  const receiptQuantity = Number(receiptForm.quantity);
  const receiptSerialNumbers = useMemo(
    () => splitIdentifiers(receiptForm.serial_numbers),
    [receiptForm.serial_numbers],
  );
  const receiptImeis = useMemo(
    () => splitIdentifiers(receiptForm.imeis),
    [receiptForm.imeis],
  );
  const receiptIssue = receiptIdentifierIssue(
    selectedReceiptVariant?.trackingType,
    receiptQuantity,
    receiptSerialNumbers,
    receiptImeis,
  );
  const draftSubtotal = purchaseLines.reduce(
    (sum, line) => sum + line.orderedQuantity * line.unitCost,
    0,
  );
  const draftTotal = purchaseLines.reduce(
    (sum, line) =>
      sum + lineTotal(line.orderedQuantity, line.unitCost, line.taxRate),
    0,
  );

  const totalOrdered = branchOrders.reduce(
    (sum, order) => sum + Number(order.total_amount),
    0,
  );
  const awaiting = branchOrders.filter((order) =>
    ["submitted", "approved", "partially_received"].includes(order.status),
  ).length;
  const receivedUnits = branchOrders.reduce(
    (sum, order) => sum + orderUnits(order).received,
    0,
  );

  useEffect(() => {
    if (!token || isPreview) return;

    let active = true;
    Promise.allSettled([
      listBranches(token),
      listPurchaseOrders(token, { pageSize: 100 }),
      listSuppliers(token),
    ]).then(([branchesResult, ordersResult, suppliersResult]) => {
      if (!active) return;
      let failed = false;

      if (branchesResult.status === "fulfilled" && branchesResult.value.length) {
        setBranches(branchesResult.value);
        setSelectedBranchId((current) => {
          if (current && branchesResult.value.some((branch) => branch.id === current)) {
            return current;
          }
          return user?.branch_id ?? branchesResult.value[0].id;
        });
      } else {
        failed = true;
      }

      if (ordersResult.status === "fulfilled") {
        setOrders(ordersResult.value.items);
        setSelectedOrderId((current) => current || ordersResult.value.items[0]?.id || "");
      } else {
        failed = true;
      }

      if (suppliersResult.status === "fulfilled") {
        setSuppliers(suppliersResult.value);
        setPurchaseForm((current) => ({
          ...current,
          supplier_id: current.supplier_id || suppliersResult.value[0]?.id || "",
        }));
      } else {
        failed = true;
      }

      setNotice(
        failed
          ? "Purchasing API unavailable or not permitted. Showing sample data where needed."
          : null,
      );
    });

    return () => {
      active = false;
    };
  }, [isPreview, token, user?.branch_id]);

  useEffect(() => {
    if (!branchOrders.length) {
      setSelectedOrderId("");
      return;
    }

    const selectedOrderStillInBranch = branchOrders.some(
      (order) => order.id === selectedOrderId,
    );
    if (!selectedOrderStillInBranch) {
      setSelectedOrderId(branchOrders[0].id);
    }
  }, [branchOrders, selectedOrderId]);

  useEffect(() => {
    if (!token || isPreview) return;

    let active = true;
    listCatalogProducts(token, productSearch)
      .then((result) => {
        if (!active) return;
        setCatalogProducts(result.items);
      })
      .catch(() => {
        if (!active) return;
        setCatalogProducts([]);
        setNotice("Catalog search is unavailable. Product choices will appear once the API responds.");
      });

    return () => {
      active = false;
    };
  }, [isPreview, productSearch, token]);

  useEffect(() => {
    if (!selectedOrder) {
      setReceiptHistory([]);
      return;
    }

    if (!token || isPreview) {
      setReceiptHistory([]);
      return;
    }

    let active = true;
    listPurchaseOrderReceipts(token, selectedOrder.id)
      .then((receipts) => {
        if (!active) return;
        setReceiptHistory(receipts);
      })
      .catch(() => {
        if (!active) return;
        setReceiptHistory([]);
      });

    return () => {
      active = false;
    };
  }, [isPreview, selectedOrder, token]);

  useEffect(() => {
    if (!variantOptions.length) return;

    setPurchaseForm((current) => {
      const stillValid = variantOptions.some(
        (variant) => variant.id === current.variant_id,
      );
      if (stillValid) return current;

      const firstVariant = variantOptions[0];
      return {
        ...current,
        variant_id: firstVariant.id,
        unit_cost: current.unit_cost || estimateUnitCost(firstVariant),
      };
    });
  }, [variantOptions]);

  useEffect(() => {
    const firstItem = receivableItems[0];

    setReceiptForm((current) => {
      const stillValid = receivableItems.some(
        (item) => item.id === current.purchase_order_item_id,
      );
      if (stillValid || !firstItem) return current;

      return {
        ...current,
        purchase_order_item_id: firstItem.id,
        quantity: "1",
      };
    });
  }, [receivableItems]);

  function variantLabel(variantId: string) {
    const variant = variantById.get(variantId);
    return variant ? `${variant.label} (${variant.sku})` : variantId;
  }

  function selectOrder(orderId: string) {
    setSelectedOrderId(orderId);
    const order = orders.find((item) => item.id === orderId);
    const firstReceivable = order?.items.find(
      (item) => item.ordered_quantity > item.received_quantity,
    );
    setReceiptForm((current) => ({
      ...current,
      purchase_order_item_id: firstReceivable?.id ?? "",
      quantity: "1",
      serial_numbers: "",
      imeis: "",
    }));
  }

  async function refreshPurchaseOrders(preferredOrderId?: string) {
    if (!token || isPreview) return;
    const result = await listPurchaseOrders(token, { pageSize: 100 });
    setOrders(result.items);
    setSelectedOrderId(
      preferredOrderId || selectedOrderId || result.items[0]?.id || "",
    );
  }

  async function handleCreateSupplier(event: FormEvent) {
    event.preventDefault();
    if (!supplierForm.name.trim()) {
      setNotice("Supplier name is required.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const supplier: Supplier = {
          id: `preview-supplier-${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          name: supplierForm.name.trim(),
          contact_person: supplierForm.contact_person || null,
          phone: supplierForm.phone || null,
          email: supplierForm.email || null,
          payment_terms_days: Number(supplierForm.payment_terms_days) || 0,
          is_active: true,
        };
        setSuppliers((current) => [supplier, ...current]);
        setPurchaseForm((current) => ({ ...current, supplier_id: supplier.id }));
        setSupplierForm(emptySupplierForm);
        setNotice("Preview supplier added locally.");
        return;
      }

      const supplier = await createSupplier(token, {
        name: supplierForm.name.trim(),
        contact_person: supplierForm.contact_person || null,
        phone: supplierForm.phone || null,
        email: supplierForm.email || null,
        payment_terms_days: Number(supplierForm.payment_terms_days) || 0,
      });
      setSuppliers((current) => [supplier, ...current]);
      setPurchaseForm((current) => ({ ...current, supplier_id: supplier.id }));
      setSupplierForm(emptySupplierForm);
      setNotice(`Created supplier ${supplier.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create supplier.");
    } finally {
      setBusy(false);
    }
  }

  function buildDraftLineFromForm() {
    const selectedVariant = variantById.get(purchaseForm.variant_id);
    const orderedQuantity = Number(purchaseForm.ordered_quantity);
    const unitCost = Number(purchaseForm.unit_cost);
    const taxRate = Number(purchaseForm.tax_rate || 0);

    if (!purchaseForm.variant_id || !selectedVariant) {
      return { error: "Select a product variant for this purchase order." };
    }
    if (!orderedQuantity || orderedQuantity <= 0) {
      return { error: "Quantity must be at least 1." };
    }
    if (Number.isNaN(unitCost) || unitCost < 0) {
      return { error: "Unit cost must be a valid number." };
    }
    if (Number.isNaN(taxRate) || taxRate < 0 || taxRate > 100) {
      return { error: "Tax rate must be between 0 and 100." };
    }

    return {
      line: {
        variantId: selectedVariant.id,
        label: selectedVariant.label,
        sku: selectedVariant.sku,
        trackingType: selectedVariant.trackingType,
        orderedQuantity,
        unitCost,
        taxRate,
      } satisfies PurchaseDraftLine,
    };
  }

  function handleAddPurchaseLine() {
    const draft = buildDraftLineFromForm();
    if (draft.error || !draft.line) {
      setNotice(draft.error ?? "Could not add item line.");
      return;
    }

    const addedVariant = variantById.get(draft.line.variantId);

    setPurchaseLines((current) => {
      const existing = current.find(
        (line) => line.variantId === draft.line.variantId,
      );
      if (!existing) return [...current, draft.line];

      return current.map((line) =>
        line.variantId === draft.line.variantId
          ? {
              ...draft.line,
              orderedQuantity: line.orderedQuantity + draft.line.orderedQuantity,
            }
          : line,
      );
    });
    setPurchaseForm((current) => ({
      ...current,
      ordered_quantity: "1",
      unit_cost: current.unit_cost || estimateUnitCost(addedVariant),
    }));
    setNotice(`${draft.line.label} added to this order.`);
  }

  function removePurchaseLine(variantId: string) {
    setPurchaseLines((current) =>
      current.filter((line) => line.variantId !== variantId),
    );
  }

  async function handleCreatePurchaseOrder(event: FormEvent) {
    event.preventDefault();

    if (!selectedBranchId) {
      setNotice("Select a branch before creating a purchase order.");
      return;
    }
    if (!purchaseForm.supplier_id) {
      setNotice("Select or create a supplier first.");
      return;
    }

    let orderLines = purchaseLines;
    if (!orderLines.length) {
      const draft = buildDraftLineFromForm();
      if (draft.error || !draft.line) {
        setNotice(draft.error ?? "Add at least one item to this purchase order.");
        return;
      }
      orderLines = [draft.line];
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const subtotal = orderLines.reduce(
          (sum, line) => sum + line.orderedQuantity * line.unitCost,
          0,
        );
        const total = orderLines.reduce(
          (sum, line) =>
            sum + lineTotal(line.orderedQuantity, line.unitCost, line.taxRate),
          0,
        );
        const taxAmount = total - subtotal;
        const order: PurchaseOrder = {
          id: `preview-po-${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          branch_id: selectedBranchId,
          supplier_id: purchaseForm.supplier_id,
          order_number: `PO-PREVIEW-${orders.length + 1}`,
          supplier_reference: purchaseForm.supplier_reference || null,
          status: "draft",
          ordered_at: null,
          expected_at: optionalDateTime(purchaseForm.expected_at),
          subtotal: String(subtotal),
          tax_amount: String(taxAmount),
          discount_amount: "0",
          total_amount: String(total),
          notes: purchaseForm.notes || null,
          items: orderLines.map((line, index) => ({
            id: `preview-po-item-${Date.now()}-${index}`,
            variant_id: line.variantId,
            ordered_quantity: line.orderedQuantity,
            received_quantity: 0,
            unit_cost: String(line.unitCost),
            tax_rate: String(line.taxRate),
            line_total: String(
              lineTotal(line.orderedQuantity, line.unitCost, line.taxRate),
            ),
          })),
        };
        setOrders((current) => [order, ...current]);
        setSelectedOrderId(order.id);
        setPurchaseLines([]);
        setPurchaseForm((current) => ({
          ...emptyPurchaseForm,
          supplier_id: current.supplier_id,
          variant_id: current.variant_id,
          unit_cost: current.unit_cost,
        }));
        setNotice("Preview purchase order created locally.");
        return;
      }

      const order = await createPurchaseOrder(token, {
        branch_id: selectedBranchId,
        supplier_id: purchaseForm.supplier_id,
        supplier_reference: purchaseForm.supplier_reference || null,
        expected_at: optionalDateTime(purchaseForm.expected_at),
        notes: purchaseForm.notes || null,
        items: orderLines.map((line) => ({
          variant_id: line.variantId,
          ordered_quantity: line.orderedQuantity,
          unit_cost: line.unitCost,
          tax_rate: line.taxRate,
        })),
      });
      setOrders((current) => [order, ...current]);
      setSelectedOrderId(order.id);
      setPurchaseLines([]);
      setPurchaseForm((current) => ({
        ...emptyPurchaseForm,
        supplier_id: current.supplier_id,
        variant_id: current.variant_id,
        unit_cost: current.unit_cost,
      }));
      setNotice(`Created purchase order ${order.order_number}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create purchase order.");
    } finally {
      setBusy(false);
    }
  }

  async function handleOrderAction(action: "submit" | "approve") {
    if (!selectedOrder) {
      setNotice("Select a purchase order first.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const nextStatus = action === "submit" ? "submitted" : "approved";
        setOrders((current) =>
          current.map((order) =>
            order.id === selectedOrder.id
              ? {
                  ...order,
                  status: nextStatus,
                  ordered_at:
                    action === "submit"
                      ? order.ordered_at ?? new Date().toISOString()
                      : order.ordered_at,
                  updated_at: new Date().toISOString(),
                }
              : order,
          ),
        );
        setNotice(`Preview order marked ${titleize(nextStatus)}.`);
        return;
      }

      const order =
        action === "submit"
          ? await submitPurchaseOrder(token, selectedOrder.id)
          : await approvePurchaseOrder(token, selectedOrder.id);

      setOrders((current) =>
        current.map((item) => (item.id === order.id ? order : item)),
      );
      setSelectedOrderId(order.id);
      setNotice(`${order.order_number} is now ${titleize(order.status)}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Could not ${action} order.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleReceiveStock(event: FormEvent) {
    event.preventDefault();
    if (!selectedOrder) {
      setNotice("Select a purchase order first.");
      return;
    }

    const selectedItem = receivableItems.find(
      (item) => item.id === receiptForm.purchase_order_item_id,
    );
    const quantity = Number(receiptForm.quantity);

    if (!selectedItem) {
      setNotice("Select an order item that still has stock awaiting receipt.");
      return;
    }
    const remaining = selectedItem.ordered_quantity - selectedItem.received_quantity;
    if (!quantity || quantity <= 0 || quantity > remaining) {
      setNotice(`Receipt quantity must be between 1 and ${remaining}.`);
      return;
    }
    if (receiptIssue) {
      setNotice(receiptIssue);
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const now = new Date().toISOString();
        const receiptId = `preview-receipt-${Date.now()}`;
        const receipt: GoodsReceipt = {
          id: receiptId,
          created_at: now,
          updated_at: now,
          is_deleted: false,
          purchase_order_id: selectedOrder.id,
          receipt_number: `GRN-PREVIEW-${receiptHistory.length + 1}`,
          received_by_id: user?.id ?? "preview-user",
          received_at: now,
          supplier_delivery_note: receiptForm.supplier_delivery_note || null,
          notes: receiptForm.notes || null,
          items: [
            {
              id: `preview-receipt-item-${Date.now()}`,
              receipt_id: receiptId,
              purchase_order_item_id: selectedItem.id,
              quantity,
              unit_cost: selectedItem.unit_cost,
            },
          ],
        };
        setOrders((current) =>
          current.map((order) => {
            if (order.id !== selectedOrder.id) return order;

            const items = order.items.map((item) =>
              item.id === selectedItem.id
                ? { ...item, received_quantity: item.received_quantity + quantity }
                : item,
            );
            const fullyReceived = items.every(
              (item) => item.received_quantity >= item.ordered_quantity,
            );
            return {
              ...order,
              items,
              status: fullyReceived ? "received" : "partially_received",
              updated_at: now,
            };
          }),
        );
        setReceiptHistory((current) => [receipt, ...current]);
        setReceiptForm(emptyReceiptForm);
        setNotice("Preview receipt posted locally and stock receipt progress updated.");
        return;
      }

      const receipt = await receivePurchaseOrder(token, selectedOrder.id, {
        supplier_delivery_note: receiptForm.supplier_delivery_note || null,
        notes: receiptForm.notes || null,
        items: [
          {
            purchase_order_item_id: selectedItem.id,
            quantity,
            serial_numbers: splitIdentifiers(receiptForm.serial_numbers),
            imeis: splitIdentifiers(receiptForm.imeis),
          },
        ],
      });
      setReceiptHistory((current) => [receipt, ...current]);
      await refreshPurchaseOrders(selectedOrder.id);
      setReceiptForm(emptyReceiptForm);
      setNotice(`Received ${quantity} unit(s) against ${selectedOrder.order_number}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not receive stock.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="module-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Purchasing</p>
          <h1>Purchases</h1>
          <p>
            Create purchase orders, submit them for approval, receive delivered
            stock, and keep supplier records tidy.
          </p>
        </div>
        <label className="branch-selector">
          <span>Branch</span>
          <select
            value={selectedBranchId}
            onChange={(event) => setSelectedBranchId(event.target.value)}
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {notice && <div className="notice notice--page">{notice}</div>}

      <section className="purchase-filter-bar">
        <label>
          Find purchase order
          <input
            value={orderQuery}
            onChange={(event) => setOrderQuery(event.target.value)}
            placeholder="PO number, supplier ref, supplier, or notes"
          />
        </label>
        <label>
          Status
          <select
            value={orderStatusFilter}
            onChange={(event) =>
              setOrderStatusFilter(event.target.value as PurchaseStatusFilter)
            }
          >
            {purchaseStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Supplier
          <select
            value={supplierFilter}
            onChange={(event) => setSupplierFilter(event.target.value)}
          >
            <option value="">All suppliers</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>
        <div className="purchase-filter-bar__result">
          <span>Showing</span>
          <strong>{integer(visibleOrders.length)} order(s)</strong>
        </div>
      </section>

      <div className="stats-grid">
        <article className="metric-card">
          <span>Purchase orders</span>
          <strong>{integer(branchOrders.length)}</strong>
          <StatusPill tone="info">Total</StatusPill>
        </article>
        <article className="metric-card">
          <span>Awaiting receipt</span>
          <strong>{integer(awaiting)}</strong>
          <StatusPill tone="warning">Open</StatusPill>
        </article>
        <article className="metric-card">
          <span>Ordered value</span>
          <strong>{money(totalOrdered)}</strong>
          <StatusPill tone="neutral">Cost</StatusPill>
        </article>
        <article className="metric-card">
          <span>Received units</span>
          <strong>{integer(receivedUnits)}</strong>
          <StatusPill tone="success">Stocked</StatusPill>
        </article>
      </div>

      <div className="repair-workspace m-t">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">New order</p>
              <h2>Purchase order</h2>
            </div>
          </header>

          <form className="form-panel" onSubmit={handleCreatePurchaseOrder}>
            <div className="form-grid form-grid--two">
              <label>
                Supplier
                <select
                  value={purchaseForm.supplier_id}
                  onChange={(event) =>
                    setPurchaseForm((current) => ({
                      ...current,
                      supplier_id: event.target.value,
                    }))
                  }
                >
                  <option value="">Select supplier</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Supplier reference
                <input
                  value={purchaseForm.supplier_reference}
                  onChange={(event) =>
                    setPurchaseForm((current) => ({
                      ...current,
                      supplier_reference: event.target.value,
                    }))
                  }
                  placeholder="Invoice or quote number"
                />
              </label>
            </div>

            <div className="form-grid form-grid--two">
              <label>
                Find product
                <input
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                  placeholder="Search SKU, phone, charger..."
                />
              </label>
              <label>
                Expected date
                <input
                  type="date"
                  value={purchaseForm.expected_at}
                  onChange={(event) =>
                    setPurchaseForm((current) => ({
                      ...current,
                      expected_at: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <label>
              Product variant
              <select
                value={purchaseForm.variant_id}
                onChange={(event) => {
                  const nextVariant = variantById.get(event.target.value);
                  setPurchaseForm((current) => ({
                    ...current,
                    variant_id: event.target.value,
                    unit_cost: current.unit_cost || estimateUnitCost(nextVariant),
                  }));
                }}
              >
                <option value="">Select product variant</option>
                {variantOptions.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.label} / {variant.sku} / {titleize(variant.trackingType)}
                  </option>
                ))}
              </select>
            </label>

            <div className="form-grid form-grid--three">
              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  value={purchaseForm.ordered_quantity}
                  onChange={(event) =>
                    setPurchaseForm((current) => ({
                      ...current,
                      ordered_quantity: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Unit cost
                <input
                  type="number"
                  min="0"
                  value={purchaseForm.unit_cost}
                  onChange={(event) =>
                    setPurchaseForm((current) => ({
                      ...current,
                      unit_cost: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Tax %
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={purchaseForm.tax_rate}
                  onChange={(event) =>
                    setPurchaseForm((current) => ({
                      ...current,
                      tax_rate: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <div className="purchase-line-builder">
              <div>
                <strong>
                  {selectedPurchaseVariant
                    ? titleize(selectedPurchaseVariant.trackingType)
                    : "No"}{" "}
                  tracking
                </strong>
                <span>
                  Add each product line to this order before creating the PO.
                  Serialized and IMEI items will ask for identifiers during receiving.
                </span>
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={busy || !purchaseForm.variant_id}
                onClick={handleAddPurchaseLine}
              >
                Add Item to Order
              </button>
            </div>

            {purchaseLines.length ? (
              <div className="purchase-draft-card">
                <div className="purchase-draft-card__summary">
                  <strong>{purchaseLines.length} line(s) ready</strong>
                  <span>
                    Subtotal {money(draftSubtotal)} · Estimated total{" "}
                    {money(draftTotal)}
                  </span>
                </div>
                <table className="data-table data-table--compact">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Tracking</th>
                      <th>Qty</th>
                      <th>Cost</th>
                      <th>Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseLines.map((line) => (
                      <tr key={line.variantId}>
                        <td>
                          <strong>{line.label}</strong>
                          <span>{line.sku}</span>
                        </td>
                        <td>{titleize(line.trackingType)}</td>
                        <td>{integer(line.orderedQuantity)}</td>
                        <td>{money(line.unitCost)}</td>
                        <td>
                          {money(
                            lineTotal(
                              line.orderedQuantity,
                              line.unitCost,
                              line.taxRate,
                            ),
                          )}
                        </td>
                        <td>
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={() => removePurchaseLine(line.variantId)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted purchase-empty-note">
                No lines added yet. If you click Create Purchase Order now, the
                currently selected product will be used as the first line.
              </p>
            )}

            <label>
              Notes
              <textarea
                value={purchaseForm.notes}
                onChange={(event) =>
                  setPurchaseForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                placeholder="Restock reason, supplier terms, delivery notes"
              />
            </label>

            <div className="form-footer">
              <button className="primary-button" disabled={busy}>
                Create Purchase Order
              </button>
            </div>
          </form>

          <form className="form-panel form-panel--bordered" onSubmit={handleCreateSupplier}>
            <strong>Quick supplier</strong>
            <div className="form-grid form-grid--two">
              <label>
                Supplier name
                <input
                  value={supplierForm.name}
                  onChange={(event) =>
                    setSupplierForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Contact person
                <input
                  value={supplierForm.contact_person}
                  onChange={(event) =>
                    setSupplierForm((current) => ({
                      ...current,
                      contact_person: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Phone
                <input
                  value={supplierForm.phone}
                  onChange={(event) =>
                    setSupplierForm((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Email
                <input
                  value={supplierForm.email}
                  onChange={(event) =>
                    setSupplierForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="form-grid form-grid--two">
              <label>
                Terms days
                <input
                  type="number"
                  min="0"
                  value={supplierForm.payment_terms_days}
                  onChange={(event) =>
                    setSupplierForm((current) => ({
                      ...current,
                      payment_terms_days: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="form-footer form-footer--align-end">
                <button className="secondary-button" disabled={busy}>
                  Add Supplier
                </button>
              </div>
            </div>
          </form>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Selected order</p>
              <h2>{selectedOrder?.order_number ?? "No order selected"}</h2>
            </div>
          </header>

          <div className="ticket-action-panel">
            {selectedOrder ? (
              <>
                <div className="selected-ticket-card">
                  <strong>
                    {supplierById.get(selectedOrder.supplier_id) ??
                      selectedOrder.supplier_id}
                  </strong>
                  <span>
                    {selectedOrder.notes || "No notes"} · Expected{" "}
                    {dateLabel(selectedOrder.expected_at)}
                  </span>
                  <StatusPill tone={toneForStatus(selectedOrder.status)}>
                    {titleize(selectedOrder.status)}
                  </StatusPill>
                  <div className="purchase-progress">
                    <div>
                      <span>Receiving progress</span>
                      <strong>
                        {integer(selectedOrderProgress.received)} /{" "}
                        {integer(selectedOrderProgress.ordered)} units
                      </strong>
                    </div>
                    <div className="purchase-progress__bar">
                      <span
                        style={{ width: `${selectedOrderProgress.percent}%` }}
                      />
                    </div>
                    <small>
                      {integer(selectedOrderProgress.remaining)} unit(s) still
                      awaiting delivery.
                    </small>
                  </div>
                </div>

                <div className="action-form">
                  <label>Approval flow</label>
                  <div className="table-actions">
                    <button
                      className="secondary-button"
                      disabled={busy || selectedOrder.status !== "draft"}
                      onClick={() => void handleOrderAction("submit")}
                      type="button"
                    >
                      Submit
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy || selectedOrder.status !== "submitted"}
                      onClick={() => void handleOrderAction("approve")}
                      type="button"
                    >
                      Approve
                    </button>
                  </div>
                </div>

                <div className="purchase-line-progress">
                  <div className="purchase-line-progress__header">
                    <strong>Line receiving progress</strong>
                    <span>
                      {integer(receivableItems.length)} line(s) still open
                    </span>
                  </div>
                  <table className="data-table data-table--compact">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Ordered</th>
                        <th>Received</th>
                        <th>Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.items.map((item) => {
                        const remaining = Math.max(
                          0,
                          item.ordered_quantity - item.received_quantity,
                        );
                        return (
                          <tr key={item.id}>
                            <td>
                              <strong>{variantLabel(item.variant_id)}</strong>
                              <span>{money(item.unit_cost)} unit cost</span>
                            </td>
                            <td>{integer(item.ordered_quantity)}</td>
                            <td>{integer(item.received_quantity)}</td>
                            <td>
                              <StatusPill
                                tone={remaining ? "warning" : "success"}
                              >
                                {remaining ? `${integer(remaining)} left` : "Done"}
                              </StatusPill>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <form onSubmit={handleReceiveStock} className="action-form">
                  <label>
                    Receive item
                    <select
                      value={receiptForm.purchase_order_item_id}
                      onChange={(event) =>
                        setReceiptForm((current) => ({
                          ...current,
                          purchase_order_item_id: event.target.value,
                          serial_numbers: "",
                          imeis: "",
                        }))
                      }
                    >
                      <option value="">Select pending line</option>
                      {receivableItems.map((item) => {
                        const remaining =
                          item.ordered_quantity - item.received_quantity;
                        return (
                          <option key={item.id} value={item.id}>
                            {variantLabel(item.variant_id)} · {remaining} remaining
                          </option>
                        );
                      })}
                    </select>
                  </label>

                  {selectedReceiptItem && (
                    <div className="receipt-tracking-card">
                      <div>
                        <span>Selected line</span>
                        <strong>
                          {variantLabel(selectedReceiptItem.variant_id)}
                        </strong>
                      </div>
                      <div>
                        <span>Tracking</span>
                        <strong>
                          {selectedReceiptVariant
                            ? titleize(selectedReceiptVariant.trackingType)
                            : "Unknown"}
                        </strong>
                      </div>
                      <div>
                        <span>Remaining</span>
                        <strong>
                          {integer(
                            selectedReceiptItem.ordered_quantity -
                              selectedReceiptItem.received_quantity,
                          )}
                        </strong>
                      </div>
                      <button
                        className="secondary-button receipt-fill-button"
                        type="button"
                        onClick={() =>
                          setReceiptForm((current) => ({
                            ...current,
                            quantity: String(
                              selectedReceiptItem.ordered_quantity -
                                selectedReceiptItem.received_quantity,
                            ),
                          }))
                        }
                      >
                        Fill Remaining
                      </button>
                    </div>
                  )}

                  <div className="form-grid form-grid--two">
                    <label>
                      Quantity
                      <input
                        type="number"
                        min="1"
                        max={
                          selectedReceiptItem
                            ? selectedReceiptItem.ordered_quantity -
                              selectedReceiptItem.received_quantity
                            : undefined
                        }
                        value={receiptForm.quantity}
                        onChange={(event) =>
                          setReceiptForm((current) => ({
                            ...current,
                            quantity: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Delivery note
                      <input
                        value={receiptForm.supplier_delivery_note}
                        onChange={(event) =>
                          setReceiptForm((current) => ({
                            ...current,
                            supplier_delivery_note: event.target.value,
                          }))
                        }
                        placeholder="DN-0001"
                      />
                    </label>
                  </div>

                  <div className="receipt-helper-card">
                    {selectedReceiptVariant?.trackingType === "bulk" ? (
                      <span>
                        Bulk stock only needs the received quantity. Serial and
                        IMEI fields stay hidden so accessories remain quick to
                        receive.
                      </span>
                    ) : selectedReceiptVariant?.trackingType === "serial" ? (
                      <span>
                        Enter one serial number per unit. IMEIs are optional
                        here, but if entered they must also match the quantity.
                      </span>
                    ) : selectedReceiptVariant?.trackingType === "imei" ? (
                      <span>
                        Enter one 15-digit IMEI per phone. Serial numbers are
                        optional if the supplier also provides them.
                      </span>
                    ) : (
                      <span>
                        Select a pending line to see the exact receiving fields
                        required for that product.
                      </span>
                    )}
                  </div>

                  {selectedReceiptVariant &&
                    selectedReceiptVariant.trackingType !== "bulk" && (
                    <div
                      className={
                        selectedReceiptVariant?.trackingType === "serial" ||
                        selectedReceiptVariant?.trackingType === "imei"
                          ? "receipt-identifier-grid"
                          : "receipt-identifier-grid receipt-identifier-grid--single"
                      }
                    >
                      {(selectedReceiptVariant?.trackingType === "serial" ||
                        selectedReceiptVariant?.trackingType === "imei") && (
                        <label>
                          Serial numbers
                          <textarea
                            value={receiptForm.serial_numbers}
                            onChange={(event) =>
                              setReceiptForm((current) => ({
                                ...current,
                                serial_numbers: event.target.value,
                              }))
                            }
                            placeholder={
                              selectedReceiptVariant?.trackingType === "serial"
                                ? "Required · one per line"
                                : "Optional · one per line"
                            }
                          />
                          <span>
                            {integer(receiptSerialNumbers.length)} /{" "}
                            {integer(receiptQuantity || 0)} captured
                          </span>
                        </label>
                      )}

                      {(selectedReceiptVariant?.trackingType === "serial" ||
                        selectedReceiptVariant?.trackingType === "imei") && (
                        <label>
                          IMEIs
                          <textarea
                            value={receiptForm.imeis}
                            onChange={(event) =>
                              setReceiptForm((current) => ({
                                ...current,
                                imeis: event.target.value,
                              }))
                            }
                            placeholder={
                              selectedReceiptVariant?.trackingType === "imei"
                                ? "Required · 15 digits each"
                                : "Optional · 15 digits each"
                            }
                          />
                          <span>
                            {integer(receiptImeis.length)} /{" "}
                            {integer(receiptQuantity || 0)} captured
                          </span>
                        </label>
                      )}
                    </div>
                    )}

                  {receiptIssue && (
                    <div className="notice receipt-inline-notice">
                      {receiptIssue}
                    </div>
                  )}

                  <label>
                    Receipt notes
                    <textarea
                      value={receiptForm.notes}
                      onChange={(event) =>
                        setReceiptForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="Condition, missing items, batch notes"
                    />
                  </label>
                  <button
                    className="primary-button"
                    disabled={
                      busy ||
                      Boolean(receiptIssue) ||
                      !selectedReceiptItem ||
                      !["approved", "partially_received"].includes(selectedOrder.status)
                    }
                  >
                    Receive Stock
                  </button>
                </form>

                <div className="purchase-receipt-history">
                  <div className="purchase-line-progress__header">
                    <strong>Receipt history</strong>
                    <span>{integer(receiptHistory.length)} receipt(s)</span>
                  </div>
                  {receiptHistory.length ? (
                    <div className="receipt-history-list">
                      {receiptHistory.map((receipt) => (
                        <article key={receipt.id}>
                          <div>
                            <strong>{receipt.receipt_number}</strong>
                            <span>
                              {dateLabel(receipt.received_at)} · Delivery note{" "}
                              {receipt.supplier_delivery_note || "-"}
                            </span>
                          </div>
                          <div className="receipt-history-list__items">
                            {receipt.items.map((item) => {
                              const orderItem = selectedOrder.items.find(
                                (line) => line.id === item.purchase_order_item_id,
                              );
                              return (
                                <span key={item.id}>
                                  {orderItem
                                    ? variantLabel(orderItem.variant_id)
                                    : item.purchase_order_item_id}{" "}
                                  · {integer(item.quantity)} unit(s)
                                </span>
                              );
                            })}
                          </div>
                          {receipt.notes && <p>{receipt.notes}</p>}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-panel-message">
                      No receipts recorded for this purchase order yet.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="muted">Select a purchase order from the table.</p>
            )}
          </div>
        </section>
      </div>

      <div className="dashboard-grid m-t">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Purchase orders</p>
              <h2>Orders</h2>
            </div>
            <StatusPill tone="neutral">
              {integer(visibleOrders.length)} shown
            </StatusPill>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Supplier</th>
                <th>Status</th>
                <th>Received</th>
                <th>Expected</th>
                <th>Total</th>
              </tr>
          </thead>
          <tbody>
              {visibleOrders.length ? (
                visibleOrders.map((order) => {
                const units = orderUnits(order);
                return (
                  <tr
                    key={order.id}
                    className={selectedOrder?.id === order.id ? "is-selected" : ""}
                    onClick={() => selectOrder(order.id)}
                  >
                    <td>{order.order_number}</td>
                    <td>{supplierById.get(order.supplier_id) ?? order.supplier_id}</td>
                    <td>
                      <StatusPill tone={toneForStatus(order.status)}>
                        {titleize(order.status)}
                      </StatusPill>
                    </td>
                    <td>
                      {integer(units.received)} / {integer(units.ordered)}
                    </td>
                    <td>{dateLabel(order.expected_at)}</td>
                    <td>{money(order.total_amount)}</td>
                  </tr>
                );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="empty-table-cell">
                    No purchase orders match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Suppliers</p>
              <h2>Supplier list</h2>
            </div>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Terms</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <td>{supplier.name}</td>
                  <td>{supplier.phone ?? "-"}</td>
                  <td>{supplier.payment_terms_days} days</td>
                  <td>
                    <StatusPill tone={toneForStatus(supplier.is_active)}>
                      {supplier.is_active ? "Active" : "Inactive"}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </section>
  );
}
