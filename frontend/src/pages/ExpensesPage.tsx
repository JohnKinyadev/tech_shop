import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  createExpense,
  createExpenseCategory,
  decideExpense,
  listBranches,
  listExpenseCategories,
  listExpenses,
  updateExpense,
} from "../api/client";
import type { Branch, Expense, ExpenseCategory, ExpenseCreatePayload } from "../api/types";
import { StatusPill } from "../components/StatusPill";
import {
  demoBranches,
  demoExpenseCategories,
  demoExpenses,
} from "../data/demoManagement";
import { useAuth } from "../state/auth";
import { dateLabel, integer, money, titleize, toneForStatus } from "../utils/format";

type ExpensePaymentMethod = NonNullable<ExpenseCreatePayload["payment_method"]>;

const paymentMethods: ExpensePaymentMethod[] = [
  "cash",
  "mpesa",
  "card",
  "bank_transfer",
  "store_credit",
];

const expenseStatuses = ["all", "pending", "approved", "rejected", "cancelled"];

const emptyExpenseForm = {
  branch_id: demoBranches[0]?.id ?? "",
  category_id: demoExpenseCategories[0]?.id ?? "",
  description: "",
  amount: "",
  payment_method: "cash" as ExpensePaymentMethod,
  reference_number: "",
  notes: "",
};

const emptyCategoryForm = {
  name: "",
  description: "",
};

function amountTotal(expenses: Expense[], status?: string) {
  return expenses
    .filter((expense) => (status ? expense.status === status : true))
    .reduce((sum, expense) => sum + Number(expense.amount), 0);
}

function numberValue(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function needsReference(method: ExpensePaymentMethod) {
  return ["mpesa", "card", "bank_transfer"].includes(method);
}

function referenceLabel(method: ExpensePaymentMethod) {
  if (method === "mpesa") return "M-Pesa transaction code";
  if (method === "card") return "card authorization/reference";
  if (method === "bank_transfer") return "bank transfer reference";
  return "receipt reference";
}

function paymentMethodHelp(method: ExpensePaymentMethod) {
  if (method === "cash") return "Cash payments can be submitted with an optional receipt number.";
  if (method === "store_credit") return "Store credit entries should include enough notes for audit context.";
  return `Add the ${referenceLabel(method)} before approval.`;
}

function amountBand(amount: number) {
  if (amount <= 0) return "Waiting for amount";
  if (amount >= 50000) return "Owner visibility";
  if (amount >= 10000) return "Manager review";
  return "Routine cost";
}

function expenseFormIssue(
  form: typeof emptyExpenseForm,
  branches: Branch[],
  categories: ExpenseCategory[],
) {
  const amount = numberValue(form.amount);
  if (!form.branch_id) return "Choose the branch that incurred this cost.";
  if (!branches.some((branch) => branch.id === form.branch_id)) {
    return "Choose a valid branch for this expense.";
  }
  if (!form.category_id) return "Choose the expense category.";
  if (!categories.some((category) => category.id === form.category_id)) {
    return "Choose a valid category for this expense.";
  }
  if (form.description.trim().length < 3) {
    return "Describe the expense clearly enough for approval.";
  }
  if (!amount || amount <= 0) return "Expense amount must be greater than zero.";
  if (needsReference(form.payment_method) && !form.reference_number.trim()) {
    return `${referenceLabel(form.payment_method)} is required for ${titleize(
      form.payment_method,
    )} expenses.`;
  }
  return null;
}

function categoryFormIssue(
  form: typeof emptyCategoryForm,
  categories: ExpenseCategory[],
) {
  const name = form.name.trim();
  if (!name) return "Category name is required.";
  if (
    categories.some(
      (category) => category.name.trim().toLowerCase() === name.toLowerCase(),
    )
  ) {
    return "A category with this name already exists.";
  }
  return null;
}

function expenseDecisionIssue(
  expense: Expense | undefined,
  action: "approve" | "reject" | "cancel",
  notes: string,
) {
  if (!expense) return "Select an expense first.";
  if (expense.status !== "pending") {
    return "Only pending expenses can be approved, rejected, or cancelled.";
  }
  if (
    action === "approve" &&
    needsReference(expense.payment_method) &&
    !expense.reference_number?.trim()
  ) {
    return `Add the ${referenceLabel(expense.payment_method)} before approval.`;
  }
  if (action !== "approve" && notes.trim().length < 3) {
    return "Rejecting or cancelling needs a short reason for the audit trail.";
  }
  return null;
}

export function ExpensesPage() {
  const { token, isPreview, user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>(demoBranches);
  const [categories, setCategories] =
    useState<ExpenseCategory[]>(demoExpenseCategories);
  const [expenses, setExpenses] = useState<Expense[]>(demoExpenses);
  const [selectedBranchId, setSelectedBranchId] = useState(
    user?.branch_id ?? demoBranches[0]?.id ?? "all",
  );
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedExpenseId, setSelectedExpenseId] = useState(
    demoExpenses[0]?.id ?? "",
  );
  const [expenseForm, setExpenseForm] = useState(emptyExpenseForm);
  const [editForm, setEditForm] = useState(emptyExpenseForm);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedExpense = useMemo(
    () => expenses.find((expense) => expense.id === selectedExpenseId) ?? expenses[0],
    [expenses, selectedExpenseId],
  );

  const branchNameById = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  );

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  const visibleExpenses = useMemo(
    () =>
      expenses.filter((expense) => {
        const matchesBranch =
          selectedBranchId === "all" || expense.branch_id === selectedBranchId;
        const matchesStatus =
          statusFilter === "all" || expense.status === statusFilter;
        const matchesCategory =
          categoryFilter === "all" || expense.category_id === categoryFilter;
        return matchesBranch && matchesStatus && matchesCategory;
      }),
    [categoryFilter, expenses, selectedBranchId, statusFilter],
  );

  const pendingExpenses = useMemo(
    () => visibleExpenses.filter((expense) => expense.status === "pending"),
    [visibleExpenses],
  );

  const totals = useMemo(
    () => ({
      total: amountTotal(visibleExpenses),
      approved: amountTotal(visibleExpenses, "approved"),
      pending: amountTotal(visibleExpenses, "pending"),
      rejected: visibleExpenses.filter((expense) => expense.status === "rejected").length,
      cancelled: visibleExpenses.filter((expense) => expense.status === "cancelled")
        .length,
    }),
    [visibleExpenses],
  );

  const categoryTotals = useMemo(
    () =>
      categories
        .map((category) => ({
          category,
          amount: amountTotal(
            visibleExpenses.filter((expense) => expense.category_id === category.id),
          ),
          count: visibleExpenses.filter((expense) => expense.category_id === category.id)
            .length,
        }))
        .filter((item) => item.count > 0)
        .sort((left, right) => right.amount - left.amount),
    [categories, visibleExpenses],
  );

  const highestCategory = categoryTotals[0];
  const pendingCount = pendingExpenses.length;
  const pendingAverage = pendingCount ? totals.pending / pendingCount : 0;
  const selectedExpenseAmount = numberValue(selectedExpense?.amount);
  const createAmount = numberValue(expenseForm.amount);
  const createExpenseIssue = expenseFormIssue(expenseForm, branches, categories);
  const editExpenseIssue = selectedExpense
    ? expenseFormIssue(editForm, branches, categories)
    : "Select an expense first.";
  const quickCategoryIssue = categoryFormIssue(categoryForm, categories);
  const approveIssue = expenseDecisionIssue(selectedExpense, "approve", decisionNotes);
  const rejectIssue = expenseDecisionIssue(selectedExpense, "reject", decisionNotes);
  const cancelIssue = expenseDecisionIssue(selectedExpense, "cancel", decisionNotes);
  const selectedExpenseCanEdit = selectedExpense?.status === "pending";
  const selectedReferenceIssue =
    selectedExpense &&
    needsReference(selectedExpense.payment_method) &&
    !selectedExpense.reference_number?.trim()
      ? `Missing ${referenceLabel(selectedExpense.payment_method)}`
      : null;

  useEffect(() => {
    if (!token || isPreview) return;

    let active = true;
    Promise.allSettled([listBranches(token), listExpenseCategories(token)]).then(
      ([branchesResult, categoriesResult]) => {
        if (!active) return;
        let failed = false;

        if (branchesResult.status === "fulfilled") {
          setBranches(branchesResult.value);
          setSelectedBranchId((current) => {
            if (current === "all") return current;
            if (current && branchesResult.value.some((branch) => branch.id === current)) {
              return current;
            }
            return user?.branch_id ?? branchesResult.value[0]?.id ?? "all";
          });
          setExpenseForm((current) => ({
            ...current,
            branch_id: current.branch_id || user?.branch_id || branchesResult.value[0]?.id || "",
          }));
        } else {
          failed = true;
        }

        if (categoriesResult.status === "fulfilled") {
          setCategories(categoriesResult.value);
          setExpenseForm((current) => ({
            ...current,
            category_id: current.category_id || categoriesResult.value[0]?.id || "",
          }));
        } else {
          failed = true;
        }

        setNotice(
          failed
            ? "Some expense setup data is unavailable or not permitted. Local preview data remains visible."
            : null,
        );
      },
    );

    return () => {
      active = false;
    };
  }, [isPreview, token, user?.branch_id]);

  useEffect(() => {
    if (!token || isPreview) return;

    let active = true;
    listExpenses(token, {
      branchId: selectedBranchId === "all" ? undefined : selectedBranchId,
      status: statusFilter,
      categoryId: categoryFilter,
      pageSize: 100,
    })
      .then((result) => {
        if (!active) return;
        setExpenses(result.items);
        setSelectedExpenseId((current) => current || result.items[0]?.id || "");
        setNotice(null);
      })
      .catch(() => {
        if (!active) return;
        setNotice("Expenses are unavailable or not permitted. Local preview data remains visible.");
      });

    return () => {
      active = false;
    };
  }, [categoryFilter, isPreview, selectedBranchId, statusFilter, token]);

  useEffect(() => {
    if (!selectedExpense) {
      setEditForm(emptyExpenseForm);
      return;
    }
    setEditForm({
      branch_id: selectedExpense.branch_id,
      category_id: selectedExpense.category_id,
      description: selectedExpense.description,
      amount: selectedExpense.amount,
      payment_method: selectedExpense.payment_method,
      reference_number: selectedExpense.reference_number ?? "",
      notes: selectedExpense.notes ?? "",
    });
    setDecisionNotes(selectedExpense.notes ?? "");
  }, [selectedExpense]);

  function categoryName(categoryId: string) {
    return categoryById.get(categoryId)?.name ?? categoryId;
  }

  function branchName(branchId: string) {
    return branchNameById.get(branchId) ?? branchId;
  }

  function upsertExpense(expense: Expense) {
    setExpenses((current) =>
      current.some((item) => item.id === expense.id)
        ? current.map((item) => (item.id === expense.id ? expense : item))
        : [expense, ...current],
    );
    setSelectedExpenseId(expense.id);
  }

  async function handleCreateCategory(event: FormEvent) {
    event.preventDefault();
    if (quickCategoryIssue) {
      setNotice(quickCategoryIssue);
      return;
    }
    const name = categoryForm.name.trim();
    const description = optionalText(categoryForm.description);

    setBusy(true);
    try {
      if (!token || isPreview) {
        const category: ExpenseCategory = {
          id: `preview-expense-category-${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          name,
          description,
        };
        setCategories((current) => [category, ...current]);
        setExpenseForm((current) => ({ ...current, category_id: category.id }));
        setCategoryForm(emptyCategoryForm);
        setNotice("Preview expense category added locally.");
        return;
      }

      const category = await createExpenseCategory(token, {
        name,
        description,
      });
      setCategories((current) => [category, ...current]);
      setExpenseForm((current) => ({ ...current, category_id: category.id }));
      setCategoryForm(emptyCategoryForm);
      setNotice(`Created category ${category.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create category.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateExpense(event: FormEvent) {
    event.preventDefault();
    if (createExpenseIssue) {
      setNotice(createExpenseIssue);
      return;
    }
    const amount = numberValue(expenseForm.amount);
    const description = expenseForm.description.trim();
    const referenceNumber = optionalText(expenseForm.reference_number);
    const notes = optionalText(expenseForm.notes);

    setBusy(true);
    try {
      if (!token || isPreview) {
        const expense: Expense = {
          id: `preview-expense-${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          branch_id: expenseForm.branch_id,
          category_id: expenseForm.category_id,
          submitted_by_id: user?.id ?? "preview-user",
          approved_by_id: null,
          description,
          amount: String(amount),
          payment_method: expenseForm.payment_method,
          status: "pending",
          reference_number: referenceNumber,
          notes,
        };
        upsertExpense(expense);
        setExpenseForm((current) => ({
          ...emptyExpenseForm,
          branch_id: current.branch_id,
          category_id: current.category_id,
          payment_method: current.payment_method,
        }));
        setNotice("Preview expense submitted locally.");
        return;
      }

      const expense = await createExpense(token, {
        branch_id: expenseForm.branch_id,
        category_id: expenseForm.category_id,
        description,
        amount,
        payment_method: expenseForm.payment_method,
        reference_number: referenceNumber,
        notes,
      });
      upsertExpense(expense);
      setExpenseForm((current) => ({
        ...emptyExpenseForm,
        branch_id: current.branch_id,
        category_id: current.category_id,
        payment_method: current.payment_method,
      }));
      setNotice(`Submitted expense ${expense.description}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not submit expense.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateExpense(event: FormEvent) {
    event.preventDefault();
    if (!selectedExpense) {
      setNotice("Select an expense first.");
      return;
    }
    if (selectedExpense.status !== "pending") {
      setNotice("Only pending expenses can be edited.");
      return;
    }
    if (editExpenseIssue) {
      setNotice(editExpenseIssue);
      return;
    }
    const amount = numberValue(editForm.amount);
    const description = editForm.description.trim();
    const referenceNumber = optionalText(editForm.reference_number);
    const notes = optionalText(editForm.notes);

    setBusy(true);
    try {
      if (!token || isPreview) {
        upsertExpense({
          ...selectedExpense,
          updated_at: new Date().toISOString(),
          category_id: editForm.category_id,
          description,
          amount: String(amount),
          payment_method: editForm.payment_method,
          reference_number: referenceNumber,
          notes,
        });
        setNotice("Preview expense updated locally.");
        return;
      }

      const expense = await updateExpense(token, selectedExpense.id, {
        category_id: editForm.category_id,
        description,
        amount,
        payment_method: editForm.payment_method,
        reference_number: referenceNumber,
        notes,
      });
      upsertExpense(expense);
      setNotice(`Updated expense ${expense.description}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update expense.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDecision(action: "approve" | "reject" | "cancel") {
    const decisionIssue = expenseDecisionIssue(selectedExpense, action, decisionNotes);
    if (decisionIssue) {
      setNotice(decisionIssue);
      return;
    }
    if (!selectedExpense) return;
    const notes = optionalText(decisionNotes);

    setBusy(true);
    try {
      if (!token || isPreview) {
        const nextStatus =
          action === "approve"
            ? "approved"
            : action === "reject"
              ? "rejected"
              : "cancelled";
        upsertExpense({
          ...selectedExpense,
          updated_at: new Date().toISOString(),
          status: nextStatus,
          approved_by_id: action === "approve" ? user?.id ?? "preview-manager" : null,
          notes: notes ?? selectedExpense.notes,
        });
        setNotice(`Preview expense ${nextStatus}.`);
        return;
      }

      const expense = await decideExpense(token, selectedExpense.id, action, {
        notes,
      });
      upsertExpense(expense);
      setNotice(`Expense ${titleize(expense.status)}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update expense decision.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="module-page expenses-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operating costs</p>
          <h1>Expenses</h1>
          <p>
            Record branch costs, organize categories, and keep approvals visible
            before they affect owner reports.
          </p>
        </div>
        <StatusPill tone={pendingCount ? "warning" : "success"}>
          {integer(pendingCount)} pending approval
        </StatusPill>
      </div>

      {notice && <div className="notice notice--page">{notice}</div>}

      <div className="stats-grid">
        <article className="metric-card">
          <span>Total submitted</span>
          <strong>{money(totals.total)}</strong>
          <StatusPill tone="info">{integer(visibleExpenses.length)} entries</StatusPill>
        </article>
        <article className="metric-card">
          <span>Approved</span>
          <strong>{money(totals.approved)}</strong>
          <StatusPill tone="success">Booked</StatusPill>
        </article>
        <article className="metric-card">
          <span>Pending</span>
          <strong>{money(totals.pending)}</strong>
          <StatusPill tone={totals.pending ? "warning" : "success"}>Review</StatusPill>
        </article>
        <article className="metric-card">
          <span>Exceptions</span>
          <strong>{integer(totals.rejected + totals.cancelled)}</strong>
          <StatusPill tone={totals.rejected + totals.cancelled ? "danger" : "success"}>
            Rejected/cancelled
          </StatusPill>
        </article>
      </div>

      <section className="panel-card expense-filter-bar">
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
          Status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            {expenseStatuses.map((status) => (
              <option key={status} value={status}>
                {titleize(status)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="expense-control-strip m-t">
        <article>
          <span>Approval load</span>
          <strong>{pendingCount ? `${integer(pendingCount)} waiting` : "Clear"}</strong>
          <small>
            {pendingCount
              ? `${money(totals.pending)} queued for review`
              : "No operating cost is waiting in this view."}
          </small>
        </article>
        <article>
          <span>Average pending</span>
          <strong>{money(pendingAverage)}</strong>
          <small>Useful for spotting a queue full of unusually large entries.</small>
        </article>
        <article>
          <span>Largest category</span>
          <strong>{highestCategory?.category.name ?? "No spend yet"}</strong>
          <small>
            {highestCategory
              ? `${money(highestCategory.amount)} across ${integer(highestCategory.count)} entry(s)`
              : "Category pressure appears once expenses are submitted."}
          </small>
        </article>
        <article>
          <span>Approval rule</span>
          <strong>Proof before booking</strong>
          <small>M-Pesa, card, and bank transfer costs need a reference.</small>
        </article>
      </section>

      <div className="expense-desk m-t">
        <section className="panel-card">
          <header className="panel-card__header panel-card__header--compact">
            <div>
              <p className="eyebrow">Selected expense</p>
              <h2>{selectedExpense?.description ?? "No expense selected"}</h2>
            </div>
            {selectedExpense && (
              <StatusPill tone={toneForStatus(selectedExpense.status)}>
                {titleize(selectedExpense.status)}
              </StatusPill>
            )}
          </header>
          {selectedExpense ? (
            <div className="expense-focus-card">
              <strong>{money(selectedExpenseAmount)}</strong>
              <span>
                {categoryName(selectedExpense.category_id)} ·{" "}
                {branchName(selectedExpense.branch_id)}
              </span>
              <div>
                <span>Payment</span>
                <b>{titleize(selectedExpense.payment_method)}</b>
              </div>
              <div>
                <span>Reference</span>
                <b>{selectedExpense.reference_number ?? selectedReferenceIssue ?? "Optional"}</b>
              </div>
              <div>
                <span>Submitted</span>
                <b>{dateLabel(selectedExpense.created_at)}</b>
              </div>
              <div>
                <span>Last updated</span>
                <b>{dateLabel(selectedExpense.updated_at)}</b>
              </div>
              <p>{selectedExpense.notes || "No notes recorded."}</p>
            </div>
          ) : (
            <p className="empty-panel-message">Select an expense from the table.</p>
          )}
        </section>

        <section className="panel-card">
          <header className="panel-card__header panel-card__header--compact">
            <div>
              <p className="eyebrow">Approval queue</p>
              <h2>Pending costs</h2>
            </div>
          </header>
          <div className="expense-pending-list">
            {pendingExpenses.length ? (
              pendingExpenses.slice(0, 5).map((expense) => (
                <button
                  key={expense.id}
                  type="button"
                  onClick={() => setSelectedExpenseId(expense.id)}
                >
                  <strong>{money(expense.amount)}</strong>
                  <span>{expense.description}</span>
                  <small>
                    {categoryName(expense.category_id)} · {branchName(expense.branch_id)}
                  </small>
                  <em>{dateLabel(expense.created_at)}</em>
                </button>
              ))
            ) : (
              <p className="empty-panel-message">No pending expenses in this view.</p>
            )}
          </div>
        </section>

        <section className="panel-card">
          <header className="panel-card__header panel-card__header--compact">
            <div>
              <p className="eyebrow">Category pressure</p>
              <h2>Cost split</h2>
            </div>
          </header>
          <div className="expense-category-list">
            {categoryTotals.length ? (
              categoryTotals.map(({ category, amount, count }) => (
                <article key={category.id}>
                  <div>
                    <strong>{category.name}</strong>
                    <span>{integer(count)} expense(s)</span>
                  </div>
                  <b>{money(amount)}</b>
                </article>
              ))
            ) : (
              <p className="empty-panel-message">No category totals in this view.</p>
            )}
          </div>
        </section>
      </div>

      <div className="repair-workspace m-t">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">New expense</p>
              <h2>Record operating cost</h2>
            </div>
          </header>
          <form className="form-panel" onSubmit={handleCreateExpense}>
            <div className="form-grid form-grid--two">
              <label>
                Branch
                <select
                  value={expenseForm.branch_id}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      branch_id: event.target.value,
                    }))
                  }
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select
                  value={expenseForm.category_id}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      category_id: event.target.value,
                    }))
                  }
                >
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-grid form-grid--three">
              <label>
                Amount
                <input
                  type="number"
                  min="1"
                  value={expenseForm.amount}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      amount: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Payment method
                <select
                  value={expenseForm.payment_method}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      payment_method: event.target.value as ExpensePaymentMethod,
                    }))
                  }
                >
                  {paymentMethods.map((method) => (
                    <option key={method} value={method}>
                      {titleize(method)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reference
                <input
                  value={expenseForm.reference_number}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      reference_number: event.target.value,
                    }))
                  }
                  placeholder={referenceLabel(expenseForm.payment_method)}
                />
                {needsReference(expenseForm.payment_method) &&
                  !expenseForm.reference_number.trim() && (
                    <span className="expense-field-warning">
                      {paymentMethodHelp(expenseForm.payment_method)}
                    </span>
                  )}
              </label>
            </div>
            <label>
              Description
              <textarea
                value={expenseForm.description}
                onChange={(event) =>
                  setExpenseForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="What was paid for?"
              />
            </label>
            <label>
              Notes
              <textarea
                value={expenseForm.notes}
                onChange={(event) =>
                  setExpenseForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                placeholder="Approval context or receipt details"
              />
            </label>
            <div
              className={`expense-readiness-card ${
                createExpenseIssue ? "is-blocked" : "is-ready"
              }`}
            >
              <div>
                <span>Submission check</span>
                <strong>
                  {createExpenseIssue ? "Needs details" : "Ready for approval"}
                </strong>
              </div>
              <div className="expense-readiness-grid">
                <article>
                  <span>Branch</span>
                  <b>{expenseForm.branch_id ? branchName(expenseForm.branch_id) : "Missing"}</b>
                </article>
                <article>
                  <span>Category</span>
                  <b>
                    {expenseForm.category_id
                      ? categoryName(expenseForm.category_id)
                      : "Missing"}
                  </b>
                </article>
                <article>
                  <span>Amount band</span>
                  <b>{amountBand(createAmount)}</b>
                </article>
                <article>
                  <span>Reference</span>
                  <b>
                    {needsReference(expenseForm.payment_method)
                      ? expenseForm.reference_number.trim()
                        ? "Captured"
                        : "Required"
                      : "Optional"}
                  </b>
                </article>
              </div>
              <small>
                {createExpenseIssue ??
                  "This will enter the approval queue before affecting reports."}
              </small>
            </div>
            <div className="form-footer">
              <button className="primary-button" disabled={busy || Boolean(createExpenseIssue)}>
                Submit Expense
              </button>
            </div>
          </form>

          <form className="form-panel form-panel--bordered" onSubmit={handleCreateCategory}>
            <strong>Quick category</strong>
            <div className="form-grid form-grid--two">
              <label>
                Category name
                <input
                  value={categoryForm.name}
                  onChange={(event) =>
                    setCategoryForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Utilities"
                />
                {categoryForm.name.trim() && quickCategoryIssue && (
                  <span className="expense-field-warning">{quickCategoryIssue}</span>
                )}
              </label>
              <label>
                Description
                <input
                  value={categoryForm.description}
                  onChange={(event) =>
                    setCategoryForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Electricity, water..."
                />
              </label>
            </div>
            <div className="form-footer">
              <button className="secondary-button" disabled={busy || Boolean(quickCategoryIssue)}>
                Add Category
              </button>
            </div>
          </form>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Review</p>
              <h2>Selected expense action</h2>
            </div>
          </header>

          <div className="ticket-action-panel">
            {selectedExpense ? (
              <>
                <div
                  className={`expense-decision-card ${
                    selectedExpenseCanEdit && !approveIssue ? "is-ready" : "is-blocked"
                  }`}
                >
                  <div>
                    <span>Approval posture</span>
                    <strong>
                      {selectedExpenseCanEdit
                        ? approveIssue
                          ? "Needs review"
                          : "Can approve"
                        : titleize(selectedExpense.status)}
                    </strong>
                  </div>
                  <div className="expense-readiness-grid">
                    <article>
                      <span>Amount</span>
                      <b>{money(selectedExpenseAmount)}</b>
                    </article>
                    <article>
                      <span>Method</span>
                      <b>{titleize(selectedExpense.payment_method)}</b>
                    </article>
                    <article>
                      <span>Reference</span>
                      <b>{selectedReferenceIssue ?? "Clear"}</b>
                    </article>
                    <article>
                      <span>Decision notes</span>
                      <b>{decisionNotes.trim() ? "Captured" : "Optional for approval"}</b>
                    </article>
                  </div>
                  <small>
                    {selectedExpenseCanEdit
                      ? approveIssue ??
                        "Approval will book this expense into the reporting layer."
                      : "This expense has already left the pending approval queue."}
                  </small>
                </div>
                <form className="action-form" onSubmit={handleUpdateExpense}>
                  <strong>Edit pending expense</strong>
                  <label>
                    Description
                    <textarea
                      value={editForm.description}
                      disabled={!selectedExpenseCanEdit}
                      onChange={(event) =>
                        setEditForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="form-grid form-grid--two">
                    <label>
                      Category
                      <select
                        value={editForm.category_id}
                        disabled={!selectedExpenseCanEdit}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            category_id: event.target.value,
                          }))
                        }
                      >
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Amount
                      <input
                        type="number"
                        min="1"
                        value={editForm.amount}
                        disabled={!selectedExpenseCanEdit}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            amount: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Method
                      <select
                        value={editForm.payment_method}
                        disabled={!selectedExpenseCanEdit}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            payment_method: event.target.value as ExpensePaymentMethod,
                          }))
                        }
                      >
                        {paymentMethods.map((method) => (
                          <option key={method} value={method}>
                            {titleize(method)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Reference
                      <input
                        value={editForm.reference_number}
                        disabled={!selectedExpenseCanEdit}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            reference_number: event.target.value,
                          }))
                        }
                        placeholder={referenceLabel(editForm.payment_method)}
                      />
                      {selectedExpenseCanEdit &&
                        needsReference(editForm.payment_method) &&
                        !editForm.reference_number.trim() && (
                          <span className="expense-field-warning">
                            {paymentMethodHelp(editForm.payment_method)}
                          </span>
                        )}
                    </label>
                  </div>
                  <label>
                    Internal notes
                    <textarea
                      value={editForm.notes}
                      disabled={!selectedExpenseCanEdit}
                      onChange={(event) =>
                        setEditForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      placeholder="Receipt location, supplier note, or manager context"
                    />
                  </label>
                  {selectedExpenseCanEdit && editExpenseIssue && (
                    <span className="expense-field-warning">{editExpenseIssue}</span>
                  )}
                  <button
                    className="secondary-button"
                    disabled={busy || !selectedExpenseCanEdit || Boolean(editExpenseIssue)}
                  >
                    Save Pending Expense
                  </button>
                </form>

                <div className="action-form">
                  <strong>Approval decision</strong>
                  <label>
                    Decision notes
                    <textarea
                      value={decisionNotes}
                      disabled={!selectedExpenseCanEdit}
                      onChange={(event) => setDecisionNotes(event.target.value)}
                      placeholder="Approval, rejection, or cancellation note"
                    />
                    {selectedExpenseCanEdit && (rejectIssue || cancelIssue) && (
                      <span className="expense-field-warning">
                        Add a short note before rejecting or cancelling this expense.
                      </span>
                    )}
                  </label>
                  <div className="table-actions">
                    <button
                      className="secondary-button"
                      disabled={busy || Boolean(approveIssue)}
                      onClick={() => void handleDecision("approve")}
                      type="button"
                    >
                      Approve
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy || Boolean(rejectIssue)}
                      onClick={() => void handleDecision("reject")}
                      type="button"
                    >
                      Reject
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy || Boolean(cancelIssue)}
                      onClick={() => void handleDecision("cancel")}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="muted">Select an expense from the table.</p>
            )}
          </div>
        </section>
      </div>

      <section className="panel-card m-t">
        <header className="panel-card__header">
          <div>
            <p className="eyebrow">Expense register</p>
            <h2>Submitted expenses</h2>
          </div>
        </header>
        <table className="data-table report-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Branch</th>
              <th>Category</th>
              <th>Method</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleExpenses.length ? (
              visibleExpenses.map((expense) => (
                <tr
                  className={selectedExpense?.id === expense.id ? "is-selected" : ""}
                  key={expense.id}
                  onClick={() => setSelectedExpenseId(expense.id)}
                >
                  <td>{dateLabel(expense.created_at)}</td>
                  <td>
                    {expense.description}
                    <span>{expense.reference_number ?? "No reference"}</span>
                  </td>
                  <td>{branchName(expense.branch_id)}</td>
                  <td>{categoryName(expense.category_id)}</td>
                  <td>{titleize(expense.payment_method)}</td>
                  <td>{money(expense.amount)}</td>
                  <td>
                    <StatusPill tone={toneForStatus(expense.status)}>
                      {titleize(expense.status)}
                    </StatusPill>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="empty-table-cell">
                  No expenses match the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </section>
  );
}
