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
            ? "Some expense setup data is unavailable or not permitted. Sample data remains visible."
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
        setNotice("Expenses are unavailable or not permitted. Showing sample data.");
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
    if (!categoryForm.name.trim()) {
      setNotice("Category name is required.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const category: ExpenseCategory = {
          id: `preview-expense-category-${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          name: categoryForm.name.trim(),
          description: categoryForm.description || null,
        };
        setCategories((current) => [category, ...current]);
        setExpenseForm((current) => ({ ...current, category_id: category.id }));
        setCategoryForm(emptyCategoryForm);
        setNotice("Preview expense category added locally.");
        return;
      }

      const category = await createExpenseCategory(token, {
        name: categoryForm.name.trim(),
        description: categoryForm.description || null,
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
    const amount = Number(expenseForm.amount);
    if (!expenseForm.branch_id || !expenseForm.category_id) {
      setNotice("Branch and category are required.");
      return;
    }
    if (!expenseForm.description.trim()) {
      setNotice("Expense description is required.");
      return;
    }
    if (!amount || amount <= 0) {
      setNotice("Expense amount must be greater than zero.");
      return;
    }

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
          description: expenseForm.description.trim(),
          amount: String(amount),
          payment_method: expenseForm.payment_method,
          status: "pending",
          reference_number: expenseForm.reference_number || null,
          notes: expenseForm.notes || null,
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
        description: expenseForm.description.trim(),
        amount,
        payment_method: expenseForm.payment_method,
        reference_number: expenseForm.reference_number || null,
        notes: expenseForm.notes || null,
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
    const amount = Number(editForm.amount);
    if (!editForm.description.trim() || !amount || amount <= 0) {
      setNotice("Description and valid amount are required.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        upsertExpense({
          ...selectedExpense,
          updated_at: new Date().toISOString(),
          category_id: editForm.category_id,
          description: editForm.description.trim(),
          amount: String(amount),
          payment_method: editForm.payment_method,
          reference_number: editForm.reference_number || null,
          notes: editForm.notes || null,
        });
        setNotice("Preview expense updated locally.");
        return;
      }

      const expense = await updateExpense(token, selectedExpense.id, {
        category_id: editForm.category_id,
        description: editForm.description.trim(),
        amount,
        payment_method: editForm.payment_method,
        reference_number: editForm.reference_number || null,
        notes: editForm.notes || null,
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
    if (!selectedExpense) {
      setNotice("Select an expense first.");
      return;
    }
    if (selectedExpense.status !== "pending") {
      setNotice("Only pending expenses can be approved, rejected, or cancelled.");
      return;
    }

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
          notes: decisionNotes || selectedExpense.notes,
        });
        setNotice(`Preview expense ${nextStatus}.`);
        return;
      }

      const expense = await decideExpense(token, selectedExpense.id, action, {
        notes: decisionNotes || null,
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
        <StatusPill tone={pendingExpenses.length ? "warning" : "success"}>
          {integer(pendingExpenses.length)} pending approval
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
              <strong>{money(selectedExpense.amount)}</strong>
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
                <b>{selectedExpense.reference_number ?? "Not set"}</b>
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
                  <small>{categoryName(expense.category_id)}</small>
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
                  placeholder="Receipt, M-Pesa code..."
                />
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
            <div className="form-footer">
              <button className="primary-button" disabled={busy}>
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
              <button className="secondary-button" disabled={busy}>
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
                <form className="action-form" onSubmit={handleUpdateExpense}>
                  <strong>Edit pending expense</strong>
                  <label>
                    Description
                    <textarea
                      value={editForm.description}
                      disabled={selectedExpense.status !== "pending"}
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
                        disabled={selectedExpense.status !== "pending"}
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
                        disabled={selectedExpense.status !== "pending"}
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
                        disabled={selectedExpense.status !== "pending"}
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
                        disabled={selectedExpense.status !== "pending"}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            reference_number: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <button
                    className="secondary-button"
                    disabled={busy || selectedExpense.status !== "pending"}
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
                      disabled={selectedExpense.status !== "pending"}
                      onChange={(event) => setDecisionNotes(event.target.value)}
                      placeholder="Approval, rejection, or cancellation note"
                    />
                  </label>
                  <div className="table-actions">
                    <button
                      className="secondary-button"
                      disabled={busy || selectedExpense.status !== "pending"}
                      onClick={() => void handleDecision("approve")}
                      type="button"
                    >
                      Approve
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy || selectedExpense.status !== "pending"}
                      onClick={() => void handleDecision("reject")}
                      type="button"
                    >
                      Reject
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy || selectedExpense.status !== "pending"}
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
