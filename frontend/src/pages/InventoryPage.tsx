import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  approveStockCount,
  approveStockTransfer,
  cancelStockCount,
  cancelStockTransfer,
  createStockCount,
  createStockTransfer,
  decideAdjustmentRequest,
  dispatchStockTransfer,
  listAdjustmentRequests,
  listBranches,
  listInventoryBalances,
  listSerializedUnits,
  listStockCounts,
  listStockMovements,
  listStockTransfers,
  receiveStockTransfer,
  requestStockAdjustment,
  submitStockCount,
  updateStockCountItem,
} from "../api/client";
import type {
  ApprovalRequest,
  Branch,
  InventoryBalance,
  SerializedUnit,
  StockCount,
  StockMovement,
  StockTransfer,
} from "../api/types";
import { StatusPill } from "../components/StatusPill";
import {
  demoAdjustmentRequests,
  demoBranches,
  demoInventoryBalances,
  demoSerializedUnits,
  demoStockCounts,
  demoStockMovements,
  demoStockTransfers,
} from "../data/demoManagement";
import { useAuth } from "../state/auth";
import { dateLabel, integer, money, titleize, toneForStatus } from "../utils/format";

const emptyAdjustmentForm = {
  stock_balance_id: demoInventoryBalances[0]?.stock_balance_id ?? "",
  quantity_delta: "-1",
  reason: "",
};

const emptyTransferForm = {
  stock_balance_id: demoInventoryBalances[0]?.stock_balance_id ?? "",
  destination_branch_id:
    demoBranches.find((branch) => branch.id !== demoBranches[0]?.id)?.id ?? "",
  quantity: "1",
  notes: "",
};

const emptyCountForm = {
  stock_balance_id: demoInventoryBalances[0]?.stock_balance_id ?? "",
  notes: "",
};

const emptyCountItemForm = {
  item_id: demoStockCounts[0]?.items[0]?.id ?? "",
  counted_quantity: "",
  notes: "",
};

type BalanceFilter = "all" | "low" | "out";
type SerializedStatusFilter =
  | "all"
  | "available"
  | "reserved"
  | "in_transfer"
  | "sold"
  | "returned"
  | "damaged"
  | "quarantined";
type MovementScope = "selected" | "all";

const serializedStatusOptions: Array<{
  value: SerializedStatusFilter;
  label: string;
}> = [
  { value: "all", label: "All statuses" },
  { value: "available", label: "Available" },
  { value: "reserved", label: "Reserved" },
  { value: "in_transfer", label: "In transfer" },
  { value: "sold", label: "Sold" },
  { value: "returned", label: "Returned" },
  { value: "damaged", label: "Damaged" },
  { value: "quarantined", label: "Quarantined" },
];

function updateTransferStatus(
  transfer: StockTransfer,
  status: string,
): StockTransfer {
  const now = new Date().toISOString();
  return {
    ...transfer,
    status,
    updated_at: now,
    dispatched_at: status === "dispatched" ? now : transfer.dispatched_at,
    received_at: status === "received" ? now : transfer.received_at,
  };
}

function updateCountStatus(count: StockCount, status: string): StockCount {
  const now = new Date().toISOString();
  return {
    ...count,
    status,
    updated_at: now,
    submitted_at: status === "submitted" ? now : count.submitted_at,
    approved_at: status === "approved" ? now : count.approved_at,
  };
}

export function InventoryPage() {
  const { token, isPreview, user } = useAuth();
  const [query, setQuery] = useState("");
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>("all");
  const [serializedStatus, setSerializedStatus] =
    useState<SerializedStatusFilter>("all");
  const [movementScope, setMovementScope] = useState<MovementScope>("selected");
  const [branches, setBranches] = useState<Branch[]>(demoBranches);
  const [selectedBranchId, setSelectedBranchId] = useState(
    user?.branch_id ?? demoBranches[0]?.id ?? "",
  );
  const [balances, setBalances] = useState<InventoryBalance[]>(demoInventoryBalances);
  const [serializedUnits, setSerializedUnits] =
    useState<SerializedUnit[]>(demoSerializedUnits);
  const [movements, setMovements] = useState<StockMovement[]>(demoStockMovements);
  const [adjustments, setAdjustments] =
    useState<ApprovalRequest[]>(demoAdjustmentRequests);
  const [transfers, setTransfers] = useState<StockTransfer[]>(demoStockTransfers);
  const [stockCounts, setStockCounts] = useState<StockCount[]>(demoStockCounts);
  const [selectedTransferId, setSelectedTransferId] = useState(
    demoStockTransfers[0]?.id ?? "",
  );
  const [selectedCountId, setSelectedCountId] = useState(demoStockCounts[0]?.id ?? "");
  const [adjustmentForm, setAdjustmentForm] = useState(emptyAdjustmentForm);
  const [transferForm, setTransferForm] = useState(emptyTransferForm);
  const [countForm, setCountForm] = useState(emptyCountForm);
  const [countItemForm, setCountItemForm] = useState(emptyCountItemForm);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedAdjustmentBalance = useMemo(
    () =>
      balances.find(
        (item) => item.stock_balance_id === adjustmentForm.stock_balance_id,
      ),
    [adjustmentForm.stock_balance_id, balances],
  );

  const selectedTransferBalance = useMemo(
    () =>
      balances.find((item) => item.stock_balance_id === transferForm.stock_balance_id),
    [balances, transferForm.stock_balance_id],
  );

  const selectedCountBalance = useMemo(
    () => balances.find((item) => item.stock_balance_id === countForm.stock_balance_id),
    [balances, countForm.stock_balance_id],
  );

  const selectedStockBalance = useMemo(
    () =>
      balances.find(
        (item) => item.stock_balance_id === adjustmentForm.stock_balance_id,
      ) ??
      selectedAdjustmentBalance ??
      balances[0],
    [adjustmentForm.stock_balance_id, balances, selectedAdjustmentBalance],
  );

  const selectedTransfer = useMemo(
    () =>
      transfers.find((transfer) => transfer.id === selectedTransferId) ??
      transfers[0],
    [selectedTransferId, transfers],
  );

  const selectedCount = useMemo(
    () => stockCounts.find((count) => count.id === selectedCountId) ?? stockCounts[0],
    [selectedCountId, stockCounts],
  );

  const branchOptions = useMemo(
    () => branches.filter((branch) => branch.status !== "closed"),
    [branches],
  );
  const destinationBranches = useMemo(
    () => branchOptions.filter((branch) => branch.id !== selectedBranchId),
    [branchOptions, selectedBranchId],
  );

  const totals = useMemo(() => {
    const onHand = balances.reduce((sum, item) => sum + item.quantity_on_hand, 0);
    const available = balances.reduce((sum, item) => sum + item.available_quantity, 0);
    const lowStock = balances.filter((item) => item.is_low_stock).length;
    const pendingAdjustments = adjustments.filter(
      (request) => request.status === "pending",
    ).length;
    return { onHand, available, lowStock, pendingAdjustments };
  }, [adjustments, balances]);

  const lowStockBalances = useMemo(
    () =>
      balances
        .filter((item) => item.is_low_stock || item.available_quantity <= item.reorder_level)
        .slice(0, 5),
    [balances],
  );

  const visibleBalances = useMemo(() => {
    return balances.filter((item) => {
      if (balanceFilter === "low") {
        return item.is_low_stock || item.available_quantity <= item.reorder_level;
      }
      if (balanceFilter === "out") return item.available_quantity <= 0;
      return true;
    });
  }, [balanceFilter, balances]);

  const serializedForSelectedItem = useMemo(() => {
    if (query.trim()) return serializedUnits.slice(0, 10);
    if (!selectedStockBalance) return serializedUnits.slice(0, 6);
    return serializedUnits
      .filter((unit) => unit.variant_id === selectedStockBalance.variant_id)
      .slice(0, 6);
  }, [query, selectedStockBalance, serializedUnits]);

  const selectedMovements = useMemo(() => {
    if (movementScope === "all") return movements.slice(0, 12);
    if (!selectedStockBalance) return movements.slice(0, 8);
    return movements
      .filter((movement) => movement.variant_id === selectedStockBalance.variant_id)
      .slice(0, 8);
  }, [movementScope, movements, selectedStockBalance]);

  useEffect(() => {
    if (!token || isPreview) return;

    let active = true;
    listBranches(token)
      .then((result) => {
        if (!active) return;
        setBranches(result);
        setSelectedBranchId((current) => {
          if (current && result.some((branch) => branch.id === current)) {
            return current;
          }
          return user?.branch_id ?? result[0]?.id ?? "";
        });
      })
      .catch(() => {
        if (!active) return;
        setNotice("Branches are unavailable. Sample branch data remains visible.");
      });

    return () => {
      active = false;
    };
  }, [isPreview, token, user?.branch_id]);

  useEffect(() => {
    if (!token || isPreview || !selectedBranchId) return;

    let active = true;
    Promise.allSettled([
      listInventoryBalances(token, selectedBranchId, query, {
        lowStockOnly: balanceFilter === "low",
        pageSize: 100,
      }),
      listSerializedUnits(token, selectedBranchId, query, {
        status: serializedStatus === "all" ? undefined : serializedStatus,
        pageSize: 200,
      }),
      listStockMovements(token, selectedBranchId, {
        variantId:
          movementScope === "selected" ? selectedStockBalance?.variant_id : undefined,
        pageSize: 50,
      }),
      listAdjustmentRequests(token, selectedBranchId),
      listStockTransfers(token, selectedBranchId),
      listStockCounts(token, selectedBranchId),
    ]).then(
      ([
        balancesResult,
        serializedUnitsResult,
        movementsResult,
        adjustmentsResult,
        transfersResult,
        countsResult,
      ]) => {
        if (!active) return;
        let failed = false;

        if (balancesResult.status === "fulfilled") {
          const nextBalances = balancesResult.value.items;
          setBalances(nextBalances);
          const firstBalanceId = nextBalances[0]?.stock_balance_id ?? "";
          setAdjustmentForm((current) => ({
            ...current,
            stock_balance_id:
              current.stock_balance_id &&
              nextBalances.some(
                (balance) => balance.stock_balance_id === current.stock_balance_id,
              )
                ? current.stock_balance_id
                : firstBalanceId,
          }));
          setTransferForm((current) => ({
            ...current,
            stock_balance_id:
              current.stock_balance_id &&
              nextBalances.some(
                (balance) => balance.stock_balance_id === current.stock_balance_id,
              )
                ? current.stock_balance_id
                : firstBalanceId,
          }));
          setCountForm((current) => ({
            ...current,
            stock_balance_id:
              current.stock_balance_id &&
              nextBalances.some(
                (balance) => balance.stock_balance_id === current.stock_balance_id,
              )
                ? current.stock_balance_id
                : firstBalanceId,
          }));
        } else {
          failed = true;
        }

        if (serializedUnitsResult.status === "fulfilled") {
          setSerializedUnits(serializedUnitsResult.value.items);
        } else {
          failed = true;
        }

        if (movementsResult.status === "fulfilled") {
          setMovements(movementsResult.value.items);
        } else {
          failed = true;
        }

        if (adjustmentsResult.status === "fulfilled") {
          setAdjustments(adjustmentsResult.value);
        } else {
          failed = true;
        }

        if (transfersResult.status === "fulfilled") {
          setTransfers(transfersResult.value);
          setSelectedTransferId(
            (current) => current || transfersResult.value[0]?.id || "",
          );
        } else {
          failed = true;
        }

        if (countsResult.status === "fulfilled") {
          setStockCounts(countsResult.value);
          setSelectedCountId((current) => current || countsResult.value[0]?.id || "");
        } else {
          failed = true;
        }

        setNotice(
          failed
            ? "Some inventory operations are unavailable or not permitted. Sample data remains visible where needed."
            : null,
        );
      },
    );

    return () => {
      active = false;
    };
  }, [
    balanceFilter,
    isPreview,
    movementScope,
    query,
    selectedBranchId,
    selectedStockBalance?.variant_id,
    serializedStatus,
    token,
  ]);

  useEffect(() => {
    const destinationStillValid = destinationBranches.some(
      (branch) => branch.id === transferForm.destination_branch_id,
    );
    if (destinationStillValid) return;
    const nextDestinationId = destinationBranches[0]?.id ?? "";
    setTransferForm((current) =>
      current.destination_branch_id === nextDestinationId
        ? current
        : { ...current, destination_branch_id: nextDestinationId },
    );
  }, [destinationBranches, transferForm.destination_branch_id]);

  useEffect(() => {
    const firstItem = selectedCount?.items[0];
    if (!firstItem) return;
    setCountItemForm((current) => {
      const stillValid = selectedCount.items.some((item) => item.id === current.item_id);
      if (stillValid) return current;
      return {
        ...current,
        item_id: firstItem.id,
        counted_quantity: firstItem.counted_quantity?.toString() ?? "",
      };
    });
  }, [selectedCount]);

  function branchName(branchId: string) {
    return branches.find((branch) => branch.id === branchId)?.name ?? branchId;
  }

  function variantLabel(variantId: string) {
    const balance = balances.find((item) => item.variant_id === variantId);
    return balance
      ? `${balance.sku} / ${balance.product_name} / ${balance.variant_name}`
      : variantId;
  }

  function balanceLabel(balance: InventoryBalance) {
    return `${balance.sku} / ${balance.product_name} / ${balance.variant_name}`;
  }

  function balanceHealth(balance: InventoryBalance) {
    if (balance.available_quantity <= 0) return "out";
    if (balance.is_low_stock || balance.available_quantity <= balance.reorder_level) {
      return "low";
    }
    return "healthy";
  }

  function balanceHealthTone(balance: InventoryBalance) {
    return balanceHealth(balance) === "healthy" ? "success" : "danger";
  }

  function selectBalance(balance: InventoryBalance) {
    setAdjustmentForm((current) => ({
      ...current,
      stock_balance_id: balance.stock_balance_id,
    }));
    setTransferForm((current) => ({
      ...current,
      stock_balance_id: balance.stock_balance_id,
    }));
    setCountForm((current) => ({
      ...current,
      stock_balance_id: balance.stock_balance_id,
    }));
  }

  function signedQuantity(value: number) {
    return `${value > 0 ? "+" : ""}${integer(value)}`;
  }

  function movementTone(movement: StockMovement) {
    if (movement.quantity_delta > 0) return "success";
    if (movement.quantity_delta < 0) return "warning";
    return "neutral";
  }

  function requestChangeSummary(request: ApprovalRequest) {
    const change = request.requested_changes ?? {};
    const sku = typeof change.sku === "string" ? change.sku : request.resource_type;
    const delta =
      typeof change.quantity_delta === "number"
        ? change.quantity_delta
        : Number(change.quantity_delta ?? 0);
    return `${sku} · ${delta > 0 ? "+" : ""}${delta}`;
  }

  function updateAdjustment(request: ApprovalRequest) {
    setAdjustments((current) =>
      current.map((item) => (item.id === request.id ? request : item)),
    );
  }

  function updateTransfer(transfer: StockTransfer) {
    setTransfers((current) =>
      current.map((item) => (item.id === transfer.id ? transfer : item)),
    );
    setSelectedTransferId(transfer.id);
  }

  function updateCount(count: StockCount) {
    setStockCounts((current) =>
      current.map((item) => (item.id === count.id ? count : item)),
    );
    setSelectedCountId(count.id);
  }

  async function handleRequestAdjustment(event: FormEvent) {
    event.preventDefault();
    const quantityDelta = Number(adjustmentForm.quantity_delta);

    if (!selectedBranchId || !selectedAdjustmentBalance) {
      setNotice("Select a stock item before requesting an adjustment.");
      return;
    }
    if (!quantityDelta) {
      setNotice("Adjustment quantity cannot be zero.");
      return;
    }
    if (!adjustmentForm.reason.trim()) {
      setNotice("Adjustment reason is required.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const request: ApprovalRequest = {
          id: `preview-adjustment-${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          branch_id: selectedBranchId,
          action: "stock_adjustment",
          resource_type: "stock_balance",
          resource_id: selectedAdjustmentBalance.stock_balance_id,
          requested_by_id: "preview-user",
          reviewed_by_id: null,
          status: "pending",
          reason: adjustmentForm.reason,
          decision_note: null,
          requested_changes: {
            variant_id: selectedAdjustmentBalance.variant_id,
            sku: selectedAdjustmentBalance.sku,
            quantity_delta: quantityDelta,
          },
        };
        setAdjustments((current) => [request, ...current]);
        setAdjustmentForm((current) => ({ ...current, reason: "" }));
        setNotice("Preview adjustment request created locally.");
        return;
      }

      const request = await requestStockAdjustment(token, {
        branch_id: selectedBranchId,
        variant_id: selectedAdjustmentBalance.variant_id,
        serialized_unit_id: null,
        quantity_delta: quantityDelta,
        reason: adjustmentForm.reason,
      });
      setAdjustments((current) => [request, ...current]);
      setAdjustmentForm((current) => ({ ...current, reason: "" }));
      setNotice("Stock adjustment request created.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not request stock adjustment.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleAdjustmentDecision(
    request: ApprovalRequest,
    approved: boolean,
  ) {
    setBusy(true);
    try {
      if (!token || isPreview) {
        updateAdjustment({
          ...request,
          status: approved ? "approved" : "rejected",
          reviewed_by_id: "preview-manager",
          decision_note: approved ? "Approved in preview." : "Rejected in preview.",
          updated_at: new Date().toISOString(),
        });
        setNotice(`Preview adjustment ${approved ? "approved" : "rejected"}.`);
        return;
      }

      const decided = await decideAdjustmentRequest(token, request.id, {
        approved,
        decision_note: approved ? "Approved from inventory screen." : "Rejected.",
      });
      updateAdjustment(decided);
      setNotice(`Adjustment request ${titleize(decided.status)}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not decide adjustment.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateTransfer(event: FormEvent) {
    event.preventDefault();
    const quantity = Number(transferForm.quantity);

    if (!selectedBranchId || !selectedTransferBalance) {
      setNotice("Select source branch stock before creating a transfer.");
      return;
    }
    if (!transferForm.destination_branch_id) {
      setNotice("Select a destination branch.");
      return;
    }
    if (transferForm.destination_branch_id === selectedBranchId) {
      setNotice("Source and destination branches must be different.");
      return;
    }
    if (!quantity || quantity <= 0) {
      setNotice("Transfer quantity must be greater than zero.");
      return;
    }
    if (quantity > selectedTransferBalance.available_quantity) {
      setNotice(
        `Only ${integer(selectedTransferBalance.available_quantity)} unit(s) are available to transfer.`,
      );
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const transferId = `preview-transfer-${Date.now()}`;
        const transfer: StockTransfer = {
          id: transferId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          transfer_number: `TR-PREVIEW-${transfers.length + 1}`,
          source_branch_id: selectedBranchId,
          destination_branch_id: transferForm.destination_branch_id,
          status: "draft",
          requested_by_id: "preview-user",
          approved_by_id: null,
          dispatched_at: null,
          received_at: null,
          notes: transferForm.notes || null,
          items: [
            {
              id: `preview-transfer-item-${Date.now()}`,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              is_deleted: false,
              transfer_id: transferId,
              variant_id: selectedTransferBalance.variant_id,
              serialized_unit_id: null,
              quantity,
            },
          ],
        };
        setTransfers((current) => [transfer, ...current]);
        setSelectedTransferId(transfer.id);
        setTransferForm((current) => ({ ...current, notes: "" }));
        setNotice("Preview transfer created locally.");
        return;
      }

      const transfer = await createStockTransfer(token, {
        source_branch_id: selectedBranchId,
        destination_branch_id: transferForm.destination_branch_id,
        notes: transferForm.notes || null,
        items: [
          {
            variant_id: selectedTransferBalance.variant_id,
            serialized_unit_id: null,
            quantity,
          },
        ],
      });
      setTransfers((current) => [transfer, ...current]);
      setSelectedTransferId(transfer.id);
      setTransferForm((current) => ({ ...current, notes: "" }));
      setNotice(`Created transfer ${transfer.transfer_number}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create transfer.");
    } finally {
      setBusy(false);
    }
  }

  async function handleTransferAction(
    action: "approve" | "dispatch" | "receive" | "cancel",
  ) {
    if (!selectedTransfer) {
      setNotice("Select a transfer first.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const nextStatus =
          action === "approve"
            ? "approved"
            : action === "dispatch"
              ? "dispatched"
              : action === "receive"
                ? "received"
                : "cancelled";
        updateTransfer(updateTransferStatus(selectedTransfer, nextStatus));
        setNotice(`Preview transfer marked ${titleize(nextStatus)}.`);
        return;
      }

      const updated =
        action === "approve"
          ? await approveStockTransfer(token, selectedTransfer.id)
          : action === "dispatch"
            ? await dispatchStockTransfer(token, selectedTransfer.id)
            : action === "receive"
              ? await receiveStockTransfer(token, selectedTransfer.id)
              : await cancelStockTransfer(token, selectedTransfer.id);
      updateTransfer(updated);
      setNotice(`${updated.transfer_number} is now ${titleize(updated.status)}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Could not ${action} transfer.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateStockCount(event: FormEvent) {
    event.preventDefault();

    if (!selectedBranchId || !selectedCountBalance) {
      setNotice("Select a stock item before creating a count.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const countId = `preview-count-${Date.now()}`;
        const count: StockCount = {
          id: countId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          branch_id: selectedBranchId,
          count_number: `SC-PREVIEW-${stockCounts.length + 1}`,
          status: "draft",
          created_by_id: "preview-user",
          approved_by_id: null,
          submitted_at: null,
          approved_at: null,
          notes: countForm.notes || null,
          items: [
            {
              id: `preview-count-item-${Date.now()}`,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              is_deleted: false,
              stock_count_id: countId,
              variant_id: selectedCountBalance.variant_id,
              expected_quantity: selectedCountBalance.quantity_on_hand,
              counted_quantity: null,
              variance: null,
              notes: null,
            },
          ],
        };
        setStockCounts((current) => [count, ...current]);
        setSelectedCountId(count.id);
        setCountForm((current) => ({ ...current, notes: "" }));
        setNotice("Preview stock count created locally.");
        return;
      }

      const count = await createStockCount(token, {
        branch_id: selectedBranchId,
        variant_ids: [selectedCountBalance.variant_id],
        notes: countForm.notes || null,
      });
      setStockCounts((current) => [count, ...current]);
      setSelectedCountId(count.id);
      setCountForm((current) => ({ ...current, notes: "" }));
      setNotice(`Created stock count ${count.count_number}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create stock count.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateCountItem(event: FormEvent) {
    event.preventDefault();
    if (!selectedCount) {
      setNotice("Select a stock count first.");
      return;
    }
    const selectedItem = selectedCount.items.find(
      (item) => item.id === countItemForm.item_id,
    );
    const countedQuantity = Number(countItemForm.counted_quantity);

    if (!selectedItem) {
      setNotice("Select a count line first.");
      return;
    }
    if (Number.isNaN(countedQuantity) || countedQuantity < 0) {
      setNotice("Counted quantity must be zero or higher.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        updateCount({
          ...selectedCount,
          updated_at: new Date().toISOString(),
          items: selectedCount.items.map((item) =>
            item.id === selectedItem.id
              ? {
                  ...item,
                  counted_quantity: countedQuantity,
                  variance: countedQuantity - item.expected_quantity,
                  notes: countItemForm.notes || null,
                  updated_at: new Date().toISOString(),
                }
              : item,
          ),
        });
        setNotice("Preview count line updated locally.");
        return;
      }

      const count = await updateStockCountItem(
        token,
        selectedCount.id,
        selectedItem.id,
        {
          counted_quantity: countedQuantity,
          notes: countItemForm.notes || null,
        },
      );
      updateCount(count);
      setNotice("Stock count line updated.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update count line.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCountAction(action: "submit" | "approve" | "cancel") {
    if (!selectedCount) {
      setNotice("Select a stock count first.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const nextStatus =
          action === "submit"
            ? "submitted"
            : action === "approve"
              ? "approved"
              : "cancelled";
        updateCount(updateCountStatus(selectedCount, nextStatus));
        setNotice(`Preview stock count marked ${titleize(nextStatus)}.`);
        return;
      }

      const updated =
        action === "submit"
          ? await submitStockCount(token, selectedCount.id)
          : action === "approve"
            ? await approveStockCount(token, selectedCount.id)
            : await cancelStockCount(token, selectedCount.id);
      updateCount(updated);
      setNotice(`${updated.count_number} is now ${titleize(updated.status)}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Could not ${action} count.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="module-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Inventory & stock</p>
          <h1>Inventory</h1>
          <p>
            Track stock levels, request corrections, transfer stock between
            branches, and run controlled stock counts.
          </p>
        </div>
        <label className="branch-selector">
          <span>Branch</span>
          <select
            value={selectedBranchId}
            onChange={(event) => setSelectedBranchId(event.target.value)}
          >
            {branchOptions.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {notice && <div className="notice notice--page">{notice}</div>}

      <section className="inventory-filter-bar">
        <label>
          Search stock / IMEI
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="SKU, product, serial number, or IMEI"
          />
        </label>
        <label>
          Stock focus
          <select
            value={balanceFilter}
            onChange={(event) => setBalanceFilter(event.target.value as BalanceFilter)}
          >
            <option value="all">All stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
        </label>
        <label>
          Serialized status
          <select
            value={serializedStatus}
            onChange={(event) =>
              setSerializedStatus(event.target.value as SerializedStatusFilter)
            }
          >
            {serializedStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Movement history
          <select
            value={movementScope}
            onChange={(event) => setMovementScope(event.target.value as MovementScope)}
          >
            <option value="selected">Selected item</option>
            <option value="all">All recent movement</option>
          </select>
        </label>
      </section>

      <div className="stats-grid">
        <article className="metric-card">
          <span>Total on hand</span>
          <strong>{integer(totals.onHand)}</strong>
          <StatusPill tone="info">Units</StatusPill>
        </article>
        <article className="metric-card">
          <span>Available</span>
          <strong>{integer(totals.available)}</strong>
          <StatusPill tone="success">Sellable</StatusPill>
        </article>
        <article className="metric-card">
          <span>Low stock</span>
          <strong>{integer(totals.lowStock)}</strong>
          <StatusPill tone={totals.lowStock ? "danger" : "success"}>
            Reorder
          </StatusPill>
        </article>
        <article className="metric-card">
          <span>Pending adjustments</span>
          <strong>{integer(totals.pendingAdjustments)}</strong>
          <StatusPill tone={totals.pendingAdjustments ? "warning" : "success"}>
            Approval
          </StatusPill>
        </article>
      </div>

      <div className="inventory-desk m-t">
        <section className="panel-card inventory-focus-card">
          <header className="panel-card__header panel-card__header--compact">
            <div>
              <p className="eyebrow">Selected stock</p>
              <h2>{selectedStockBalance?.sku ?? "No item selected"}</h2>
            </div>
            {selectedStockBalance && (
              <StatusPill tone={balanceHealthTone(selectedStockBalance)}>
                {titleize(balanceHealth(selectedStockBalance))}
              </StatusPill>
            )}
          </header>

          {selectedStockBalance ? (
            <div className="inventory-focus-card__body">
              <div>
                <strong>
                  {selectedStockBalance.product_name} /{" "}
                  {selectedStockBalance.variant_name}
                </strong>
                <span>
                  Reorder at {integer(selectedStockBalance.reorder_level)} ·{" "}
                  {integer(selectedStockBalance.reserved_quantity)} reserved
                </span>
              </div>
              <div className="inventory-mini-stats">
                <span>
                  <b>{integer(selectedStockBalance.quantity_on_hand)}</b>
                  On hand
                </span>
                <span>
                  <b>{integer(selectedStockBalance.available_quantity)}</b>
                  Available
                </span>
                <span>
                  <b>{integer(selectedMovements.length)}</b>
                  Recent moves
                </span>
              </div>
            </div>
          ) : (
            <p className="empty-panel-message">
              Select a stock balance to see its controls, devices, and recent
              movement history.
            </p>
          )}
        </section>

        <section className="panel-card">
          <header className="panel-card__header panel-card__header--compact">
            <div>
              <p className="eyebrow">Attention</p>
              <h2>Low-stock watchlist</h2>
            </div>
          </header>
          <div className="inventory-watchlist">
            {lowStockBalances.length ? (
              lowStockBalances.map((balance) => (
                <button
                  key={balance.stock_balance_id}
                  type="button"
                  onClick={() => selectBalance(balance)}
                >
                  <strong>{balance.sku}</strong>
                  <span>
                    {integer(balance.available_quantity)} available · reorder{" "}
                    {integer(balance.reorder_level)}
                  </span>
                </button>
              ))
            ) : (
              <p className="empty-panel-message">
                No low-stock items for this branch.
              </p>
            )}
          </div>
        </section>

        <section className="panel-card">
          <header className="panel-card__header panel-card__header--compact">
            <div>
              <p className="eyebrow">Serialized stock</p>
              <h2>Trackable devices</h2>
            </div>
            <StatusPill tone="neutral">
              {integer(serializedForSelectedItem.length)} shown
            </StatusPill>
          </header>
          <div className="serialized-unit-list">
            {serializedForSelectedItem.length ? (
              serializedForSelectedItem.map((unit) => (
                <article key={unit.id}>
                  <strong>{unit.serial_number ?? unit.imei ?? unit.sku}</strong>
                  <span>
                    {unit.product_name} / {unit.variant_name}
                  </span>
                  <div>
                    <StatusPill tone={toneForStatus(unit.status)}>
                      {titleize(unit.status)}
                    </StatusPill>
                    <small>
                      {unit.imei ? `IMEI ${unit.imei}` : titleize(unit.condition)}
                    </small>
                  </div>
                </article>
              ))
            ) : (
              <p className="empty-panel-message">
                No serial or IMEI units match the selected stock item and filters.
              </p>
            )}
          </div>
        </section>
      </div>

      <div className="repair-workspace m-t">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Controls</p>
              <h2>Stock operations</h2>
            </div>
          </header>

          <form className="form-panel" onSubmit={handleRequestAdjustment}>
            <strong>Adjustment request</strong>
            {selectedAdjustmentBalance && (
              <div className="stock-action-context">
                <span>{balanceLabel(selectedAdjustmentBalance)}</span>
                <strong>
                  {integer(selectedAdjustmentBalance.quantity_on_hand)} on hand ·{" "}
                  {integer(selectedAdjustmentBalance.available_quantity)} available
                </strong>
              </div>
            )}
            <div className="form-grid form-grid--two">
              <label>
                Stock item
                <select
                  value={adjustmentForm.stock_balance_id}
                  onChange={(event) =>
                    setAdjustmentForm((current) => ({
                      ...current,
                      stock_balance_id: event.target.value,
                    }))
                  }
                >
                  {balances.map((balance) => (
                    <option key={balance.stock_balance_id} value={balance.stock_balance_id}>
                      {balanceLabel(balance)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quantity delta
                <input
                  type="number"
                  value={adjustmentForm.quantity_delta}
                  onChange={(event) =>
                    setAdjustmentForm((current) => ({
                      ...current,
                      quantity_delta: event.target.value,
                    }))
                  }
                  placeholder="-1 or 3"
                />
              </label>
            </div>
            <label>
              Reason
              <textarea
                value={adjustmentForm.reason}
                onChange={(event) =>
                  setAdjustmentForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                placeholder="Explain the physical count, damage, correction, or audit reason"
              />
            </label>
            <div className="form-footer">
              <button className="primary-button" disabled={busy}>
                Request Adjustment
              </button>
            </div>
          </form>

          <form className="form-panel form-panel--bordered" onSubmit={handleCreateTransfer}>
            <strong>Branch transfer</strong>
            {selectedTransferBalance && (
              <div className="stock-action-context">
                <span>{balanceLabel(selectedTransferBalance)}</span>
                <strong>
                  {integer(selectedTransferBalance.available_quantity)} available to move
                </strong>
              </div>
            )}
            <div className="form-grid form-grid--two">
              <label>
                Stock item
                <select
                  value={transferForm.stock_balance_id}
                  onChange={(event) =>
                    setTransferForm((current) => ({
                      ...current,
                      stock_balance_id: event.target.value,
                    }))
                  }
                >
                  {balances.map((balance) => (
                    <option key={balance.stock_balance_id} value={balance.stock_balance_id}>
                      {balanceLabel(balance)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Destination
                <select
                  value={transferForm.destination_branch_id}
                  onChange={(event) =>
                    setTransferForm((current) => ({
                      ...current,
                      destination_branch_id: event.target.value,
                    }))
                  }
                >
                  <option value="">Select branch</option>
                  {destinationBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-grid form-grid--two">
              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  max={selectedTransferBalance?.available_quantity}
                  value={transferForm.quantity}
                  onChange={(event) =>
                    setTransferForm((current) => ({
                      ...current,
                      quantity: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Notes
                <input
                  value={transferForm.notes}
                  onChange={(event) =>
                    setTransferForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  placeholder="Why is this moving?"
                />
              </label>
            </div>
            <div className="form-footer">
              <button className="secondary-button" disabled={busy}>
                Create Transfer
              </button>
            </div>
          </form>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Counts & workflow</p>
              <h2>{selectedCount?.count_number ?? "Stock count"}</h2>
            </div>
          </header>

          <div className="ticket-action-panel">
            <form className="action-form" onSubmit={handleCreateStockCount}>
              {selectedCountBalance && (
                <div className="stock-action-context">
                  <span>{balanceLabel(selectedCountBalance)}</span>
                  <strong>
                    Expected quantity: {integer(selectedCountBalance.quantity_on_hand)}
                  </strong>
                </div>
              )}
              <label>
                Count item
                <select
                  value={countForm.stock_balance_id}
                  onChange={(event) =>
                    setCountForm((current) => ({
                      ...current,
                      stock_balance_id: event.target.value,
                    }))
                  }
                >
                  {balances.map((balance) => (
                    <option key={balance.stock_balance_id} value={balance.stock_balance_id}>
                      {balanceLabel(balance)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Count notes
                <textarea
                  value={countForm.notes}
                  onChange={(event) =>
                    setCountForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  placeholder="Spot count, weekly count, audit count..."
                />
              </label>
              <button className="primary-button" disabled={busy}>
                Create Stock Count
              </button>
            </form>

            {selectedCount && (
              <>
                <div className="selected-ticket-card">
                  <strong>{selectedCount.count_number}</strong>
                  <span>{selectedCount.notes || "No notes"}</span>
                  <StatusPill tone={toneForStatus(selectedCount.status)}>
                    {titleize(selectedCount.status)}
                  </StatusPill>
                </div>

                <form className="action-form" onSubmit={handleUpdateCountItem}>
                  <label>
                    Count line
                    <select
                      value={countItemForm.item_id}
                      onChange={(event) => {
                        const item = selectedCount.items.find(
                          (entry) => entry.id === event.target.value,
                        );
                        setCountItemForm((current) => ({
                          ...current,
                          item_id: event.target.value,
                          counted_quantity: item?.counted_quantity?.toString() ?? "",
                        }));
                      }}
                    >
                      {selectedCount.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {variantLabel(item.variant_id)} · expected{" "}
                          {integer(item.expected_quantity)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="form-grid form-grid--two">
                    <label>
                      Counted quantity
                      <input
                        type="number"
                        min="0"
                        value={countItemForm.counted_quantity}
                        onChange={(event) =>
                          setCountItemForm((current) => ({
                            ...current,
                            counted_quantity: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Line note
                      <input
                        value={countItemForm.notes}
                        onChange={(event) =>
                          setCountItemForm((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <button className="secondary-button" disabled={busy}>
                    Save Count Line
                  </button>
                </form>

                <div className="action-form">
                  <label>Count approval flow</label>
                  <div className="table-actions">
                    <button
                      className="secondary-button"
                      disabled={busy || selectedCount.status !== "draft"}
                      onClick={() => void handleCountAction("submit")}
                      type="button"
                    >
                      Submit
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy || selectedCount.status !== "submitted"}
                      onClick={() => void handleCountAction("approve")}
                      type="button"
                    >
                      Approve
                    </button>
                    <button
                      className="secondary-button"
                      disabled={
                        busy ||
                        ["approved", "cancelled"].includes(selectedCount.status)
                      }
                      onClick={() => void handleCountAction("cancel")}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            )}

            {selectedTransfer && (
              <div className="action-form">
                <label>Selected transfer</label>
                <div className="selected-ticket-card">
                  <strong>{selectedTransfer.transfer_number}</strong>
                  <span>
                    {branchName(selectedTransfer.source_branch_id)} →{" "}
                    {branchName(selectedTransfer.destination_branch_id)}
                  </span>
                  <StatusPill tone={toneForStatus(selectedTransfer.status)}>
                    {titleize(selectedTransfer.status)}
                  </StatusPill>
                </div>
                <div className="table-actions">
                  <button
                    className="secondary-button"
                    disabled={busy || selectedTransfer.status !== "draft"}
                    onClick={() => void handleTransferAction("approve")}
                    type="button"
                  >
                    Approve
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy || selectedTransfer.status !== "approved"}
                    onClick={() => void handleTransferAction("dispatch")}
                    type="button"
                  >
                    Dispatch
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy || selectedTransfer.status !== "dispatched"}
                    onClick={() => void handleTransferAction("receive")}
                    type="button"
                  >
                    Receive
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="panel-card m-t">
        <header className="panel-card__header">
          <div>
            <p className="eyebrow">Stock balances</p>
            <h2>Products in branch stock</h2>
          </div>
          <StatusPill tone="neutral">{integer(visibleBalances.length)} shown</StatusPill>
        </header>
        <table className="data-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product</th>
              <th>On hand</th>
              <th>Reserved</th>
              <th>Available</th>
              <th>Reorder</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleBalances.length ? (
              visibleBalances.map((item) => (
                <tr
                  key={item.stock_balance_id}
                  className={
                    adjustmentForm.stock_balance_id === item.stock_balance_id
                      ? "is-selected"
                      : ""
                  }
                  onClick={() => selectBalance(item)}
                >
                  <td>{item.sku}</td>
                  <td>
                    {item.product_name} / {item.variant_name}
                  </td>
                  <td>{integer(item.quantity_on_hand)}</td>
                  <td>{integer(item.reserved_quantity)}</td>
                  <td>{integer(item.available_quantity)}</td>
                  <td>{integer(item.reorder_level)}</td>
                  <td>
                    <StatusPill tone={balanceHealthTone(item)}>
                      {titleize(balanceHealth(item))}
                    </StatusPill>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="empty-table-cell">
                  No stock balances match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="dashboard-grid m-t">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Adjustments</p>
              <h2>Approval queue</h2>
            </div>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>Change</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {adjustments.map((request) => (
                <tr key={request.id}>
                  <td>{requestChangeSummary(request)}</td>
                  <td>{request.reason}</td>
                  <td>
                    <StatusPill tone={toneForStatus(request.status)}>
                      {titleize(request.status)}
                    </StatusPill>
                  </td>
                  <td>
                    {request.status === "pending" ? (
                      <div className="table-actions">
                        <button
                          disabled={busy}
                          onClick={() =>
                            void handleAdjustmentDecision(request, true)
                          }
                          type="button"
                        >
                          Approve
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void handleAdjustmentDecision(request, false)
                          }
                          type="button"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      request.decision_note ?? "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Transfers</p>
              <h2>Branch movement</h2>
            </div>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>Transfer</th>
                <th>Route</th>
                <th>Items</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((transfer) => (
                <tr
                  key={transfer.id}
                  className={selectedTransfer?.id === transfer.id ? "is-selected" : ""}
                  onClick={() => setSelectedTransferId(transfer.id)}
                >
                  <td>{transfer.transfer_number}</td>
                  <td>
                    {branchName(transfer.source_branch_id)} →{" "}
                    {branchName(transfer.destination_branch_id)}
                  </td>
                  <td>
                    {integer(
                      transfer.items.reduce((sum, item) => sum + item.quantity, 0),
                    )}
                  </td>
                  <td>
                    <StatusPill tone={toneForStatus(transfer.status)}>
                      {titleize(transfer.status)}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="dashboard-grid m-t">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Stock counts</p>
              <h2>Count sessions</h2>
            </div>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>Count</th>
                <th>Status</th>
                <th>Lines</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {stockCounts.map((count) => (
                <tr
                  key={count.id}
                  className={selectedCount?.id === count.id ? "is-selected" : ""}
                  onClick={() => setSelectedCountId(count.id)}
                >
                  <td>{count.count_number}</td>
                  <td>
                    <StatusPill tone={toneForStatus(count.status)}>
                      {titleize(count.status)}
                    </StatusPill>
                  </td>
                  <td>{integer(count.items.length)}</td>
                  <td>{dateLabel(count.submitted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Movements</p>
              <h2>
                {movementScope === "all"
                  ? "All recent stock movement"
                  : "Selected item movement"}
              </h2>
            </div>
            <StatusPill tone="neutral">
              {integer(selectedMovements.length)} moves
            </StatusPill>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Unit cost</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {selectedMovements.length ? (
                selectedMovements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{dateLabel(movement.created_at)}</td>
                    <td>
                      <StatusPill tone={movementTone(movement)}>
                        {titleize(movement.movement_type)}
                      </StatusPill>
                    </td>
                    <td>{signedQuantity(movement.quantity_delta)}</td>
                    <td>{movement.unit_cost ? money(movement.unit_cost) : "-"}</td>
                    <td>
                      {titleize(movement.reference_type)}
                      {movement.note ? <span>{movement.note}</span> : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="empty-table-cell">
                    {movementScope === "all"
                      ? "No recent stock movement for this branch yet."
                      : "No movement history for the selected stock item yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </section>
  );
}
