import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  API_BASE_URL,
  createBranch,
  createTill,
  listBranches,
  listTills,
  updateBranch,
  updateTill,
} from "../api/client";
import type { Branch, Till } from "../api/types";
import { StatusPill } from "../components/StatusPill";
import { demoBranches } from "../data/demoManagement";
import { useAuth } from "../state/auth";
import { dateLabel, integer, titleize, toneForStatus } from "../utils/format";

const now = new Date().toISOString();

const demoTills: Till[] = [
  {
    id: "demo-till-main-pos",
    created_at: now,
    updated_at: now,
    is_deleted: false,
    branch_id: demoBranches[0]?.id ?? "demo-branch",
    name: "Main POS",
    code: "HQ-POS-01",
    is_active: true,
  },
  {
    id: "demo-till-service-desk",
    created_at: now,
    updated_at: now,
    is_deleted: false,
    branch_id: demoBranches[0]?.id ?? "demo-branch",
    name: "Service Desk",
    code: "HQ-SVC-01",
    is_active: false,
  },
];

const emptyBranchForm = {
  name: "",
  code: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  country: "Kenya",
  status: "active",
  is_headquarters: false,
};

const emptyTillForm = {
  name: "",
  code: "",
  is_active: true,
};

type ReadinessState = "done" | "review" | "missing";

function branchToForm(branch?: Branch) {
  if (!branch) return emptyBranchForm;
  return {
    name: branch.name,
    code: branch.code,
    phone: branch.phone ?? "",
    email: branch.email ?? "",
    address: branch.address ?? "",
    city: branch.city ?? "",
    country: branch.country,
    status: branch.status,
    is_headquarters: branch.is_headquarters,
  };
}

function codeFromName(name: string, suffix = "") {
  const code = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return code ? `${code}${suffix}`.slice(0, 30) : "";
}

function setupChecklist(branch: Branch | undefined, tills: Till[]) {
  const activeTills = tills.filter((till) => till.is_active);
  return [
    {
      label: "Branch name",
      done: Boolean(branch?.name),
      detail: branch?.name ?? "Missing branch name",
    },
    {
      label: "Branch code",
      done: Boolean(branch?.code),
      detail: branch?.code ?? "Missing branch code",
    },
    {
      label: "Branch active",
      done: branch?.status === "active",
      detail:
        branch?.status === "active"
          ? "Ready for staff operations"
          : `Currently ${titleize(branch?.status)}`,
    },
    {
      label: "Receipt contact",
      done: Boolean(branch?.phone || branch?.email),
      detail: branch?.phone || branch?.email || "Add phone or email",
    },
    {
      label: "Receipt address",
      done: Boolean(branch?.address && branch?.city),
      detail:
        branch?.address && branch?.city
          ? `${branch.address}, ${branch.city}`
          : "Add address and city",
    },
    {
      label: "Active POS till",
      done: activeTills.length > 0,
      detail: `${integer(activeTills.length)} active till(s)`,
    },
    {
      label: "Till codes",
      done: activeTills.every((till) => Boolean(till.code)) && activeTills.length > 0,
      detail:
        activeTills.length > 0
          ? activeTills.map((till) => till.code).join(", ")
          : "Create at least one active till",
    },
  ];
}

function branchAddress(branch?: Branch) {
  if (!branch) return "No branch selected";
  return [branch.address, branch.city, branch.country].filter(Boolean).join(", ");
}

function readinessTone(state: ReadinessState): "success" | "info" | "warning" {
  if (state === "done") return "success";
  if (state === "review") return "info";
  return "warning";
}

export function SettingsPage() {
  const { token, isPreview, user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>(demoBranches);
  const [tills, setTills] = useState<Till[]>(demoTills);
  const [selectedBranchId, setSelectedBranchId] = useState(
    user?.branch_id ?? demoBranches[0]?.id ?? "",
  );
  const [selectedTillId, setSelectedTillId] = useState(demoTills[0]?.id ?? "");
  const [branchForm, setBranchForm] = useState(branchToForm(demoBranches[0]));
  const [newBranchForm, setNewBranchForm] = useState(emptyBranchForm);
  const [tillForm, setTillForm] = useState(emptyTillForm);
  const [tillEditForm, setTillEditForm] = useState(emptyTillForm);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedBranch = useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId) ?? branches[0],
    [branches, selectedBranchId],
  );

  const branchTills = useMemo(
    () => tills.filter((till) => till.branch_id === selectedBranch?.id),
    [selectedBranch?.id, tills],
  );

  const selectedTill = useMemo(
    () =>
      branchTills.find((till) => till.id === selectedTillId) ?? branchTills[0],
    [branchTills, selectedTillId],
  );

  const checklist = useMemo(
    () => setupChecklist(selectedBranch, branchTills),
    [branchTills, selectedBranch],
  );

  const setupScore = checklist.length
    ? Math.round((checklist.filter((item) => item.done).length / checklist.length) * 100)
    : 0;

  const totals = useMemo(
    () => ({
      branches: branches.length,
      activeBranches: branches.filter((branch) => branch.status === "active").length,
      tills: tills.length,
      activeTills: tills.filter((till) => till.is_active).length,
    }),
    [branches, tills],
  );

  const activeBranchTills = branchTills.filter((till) => till.is_active);
  const apiTarget = useMemo(() => {
    try {
      return new URL(API_BASE_URL).origin;
    } catch {
      return API_BASE_URL;
    }
  }, []);
  const paymentReadiness: Array<{
    label: string;
    state: ReadinessState;
    detail: string;
  }> = [
    {
      label: "POS till coverage",
      state: activeBranchTills.length ? "done" : "missing",
      detail: activeBranchTills.length
        ? `${integer(activeBranchTills.length)} active register(s) can open sessions`
        : "Create and activate at least one till for this branch",
    },
    {
      label: "Frontend API target",
      state: API_BASE_URL.includes("/api/v1/staff") ? "done" : "review",
      detail: apiTarget,
    },
    {
      label: "M-Pesa server keys",
      state: "review",
      detail: "Confirm MPESA_CONSUMER_KEY, SECRET, PASSKEY, SHORTCODE in backend .env",
    },
    {
      label: "M-Pesa callback URL",
      state: "review",
      detail: "Confirm MPESA_CALLBACK_BASE_URL points to your public backend/ngrok URL",
    },
  ];
  const selectedBranchContact =
    selectedBranch?.phone || selectedBranch?.email || "No contact set";

  useEffect(() => {
    if (!token || isPreview) return;

    let active = true;
    listBranches(token)
      .then((result) => {
        if (!active) return;
        setBranches(result);
        setSelectedBranchId((current) => {
          if (current && result.some((branch) => branch.id === current)) return current;
          return user?.branch_id ?? result[0]?.id ?? "";
        });
      })
      .catch(() => {
        if (!active) return;
        setNotice("Branch settings are unavailable or not permitted. Showing sample data.");
      });

    return () => {
      active = false;
    };
  }, [isPreview, token, user?.branch_id]);

  useEffect(() => {
    setBranchForm(branchToForm(selectedBranch));
    setNewBranchForm((current) => ({
      ...current,
      country: selectedBranch?.country ?? current.country,
    }));
  }, [selectedBranch]);

  useEffect(() => {
    if (!token || isPreview || !selectedBranch?.id) return;

    let active = true;
    listTills(token, selectedBranch.id, true)
      .then((result) => {
        if (!active) return;
        setTills((current) => [
          ...current.filter((till) => till.branch_id !== selectedBranch.id),
          ...result,
        ]);
        setSelectedTillId((current) => current || result[0]?.id || "");
        setNotice(null);
      })
      .catch(() => {
        if (!active) return;
        setNotice("Till setup is unavailable or not permitted. Showing sample tills.");
      });

    return () => {
      active = false;
    };
  }, [isPreview, selectedBranch?.id, token]);

  useEffect(() => {
    if (!selectedTill) {
      setTillEditForm(emptyTillForm);
      return;
    }
    setTillEditForm({
      name: selectedTill.name,
      code: selectedTill.code,
      is_active: selectedTill.is_active,
    });
  }, [selectedTill]);

  useEffect(() => {
    if (!branchTills.length) {
      setSelectedTillId("");
      return;
    }
    if (!branchTills.some((till) => till.id === selectedTillId)) {
      setSelectedTillId(branchTills[0].id);
    }
  }, [branchTills, selectedTillId]);

  function upsertBranch(branch: Branch) {
    setBranches((current) =>
      current.some((item) => item.id === branch.id)
        ? current.map((item) => (item.id === branch.id ? branch : item))
        : [branch, ...current],
    );
    setSelectedBranchId(branch.id);
  }

  function upsertTill(till: Till) {
    setTills((current) =>
      current.some((item) => item.id === till.id)
        ? current.map((item) => (item.id === till.id ? till : item))
        : [till, ...current],
    );
    setSelectedTillId(till.id);
  }

  async function handleUpdateBranch(event: FormEvent) {
    event.preventDefault();
    if (!selectedBranch) {
      setNotice("Select a branch first.");
      return;
    }
    if (!branchForm.name.trim()) {
      setNotice("Branch name is required.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        upsertBranch({
          ...selectedBranch,
          updated_at: new Date().toISOString(),
          name: branchForm.name.trim(),
          phone: branchForm.phone || null,
          email: branchForm.email || null,
          address: branchForm.address || null,
          city: branchForm.city || null,
          country: branchForm.country || "Kenya",
          status: branchForm.status,
        });
        setNotice("Preview branch profile updated locally.");
        return;
      }

      const branch = await updateBranch(token, selectedBranch.id, {
        name: branchForm.name.trim(),
        phone: branchForm.phone || null,
        email: branchForm.email || null,
        address: branchForm.address || null,
        city: branchForm.city || null,
        country: branchForm.country || "Kenya",
        status: branchForm.status,
      });
      upsertBranch(branch);
      setNotice(`Updated branch ${branch.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update branch.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateBranch(event: FormEvent) {
    event.preventDefault();
    if (!newBranchForm.name.trim() || !newBranchForm.code.trim()) {
      setNotice("New branch name and code are required.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const branch: Branch = {
          id: `preview-branch-${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          name: newBranchForm.name.trim(),
          code: newBranchForm.code.trim().toUpperCase(),
          phone: newBranchForm.phone || null,
          email: newBranchForm.email || null,
          address: newBranchForm.address || null,
          city: newBranchForm.city || null,
          country: newBranchForm.country || "Kenya",
          is_headquarters: newBranchForm.is_headquarters,
          status: "active",
        };
        upsertBranch(branch);
        setNewBranchForm(emptyBranchForm);
        setNotice("Preview branch created locally.");
        return;
      }

      const branch = await createBranch(token, {
        name: newBranchForm.name.trim(),
        code: newBranchForm.code.trim().toUpperCase(),
        phone: newBranchForm.phone || null,
        email: newBranchForm.email || null,
        address: newBranchForm.address || null,
        city: newBranchForm.city || null,
        country: newBranchForm.country || "Kenya",
        is_headquarters: newBranchForm.is_headquarters,
      });
      upsertBranch(branch);
      setNewBranchForm(emptyBranchForm);
      setNotice(`Created branch ${branch.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create branch.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateTill(event: FormEvent) {
    event.preventDefault();
    if (!selectedBranch) {
      setNotice("Select a branch before creating a till.");
      return;
    }
    if (!tillForm.name.trim() || !tillForm.code.trim()) {
      setNotice("Till name and code are required.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const till: Till = {
          id: `preview-till-${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          branch_id: selectedBranch.id,
          name: tillForm.name.trim(),
          code: tillForm.code.trim().toUpperCase(),
          is_active: true,
        };
        upsertTill(till);
        setTillForm(emptyTillForm);
        setNotice("Preview till created locally.");
        return;
      }

      const till = await createTill(token, {
        branch_id: selectedBranch.id,
        name: tillForm.name.trim(),
        code: tillForm.code.trim().toUpperCase(),
      });
      upsertTill(till);
      setTillForm(emptyTillForm);
      setNotice(`Created till ${till.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create till.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateTill(event: FormEvent) {
    event.preventDefault();
    if (!selectedTill) {
      setNotice("Select a till first.");
      return;
    }
    if (!tillEditForm.name.trim()) {
      setNotice("Till name is required.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        upsertTill({
          ...selectedTill,
          updated_at: new Date().toISOString(),
          name: tillEditForm.name.trim(),
          is_active: tillEditForm.is_active,
        });
        setNotice("Preview till updated locally.");
        return;
      }

      const till = await updateTill(token, selectedTill.id, {
        name: tillEditForm.name.trim(),
        is_active: tillEditForm.is_active,
      });
      upsertTill(till);
      setNotice(`Updated till ${till.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update till.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="module-page settings-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">System setup</p>
          <h1>Settings</h1>
          <p>
            Configure branch profiles, receipt-facing details, and POS tills so
            the shop is ready for live sales.
          </p>
        </div>
        <StatusPill tone={setupScore === 100 ? "success" : "warning"}>
          {setupScore}% setup
        </StatusPill>
      </div>

      {notice && <div className="notice notice--page">{notice}</div>}

      <div className="stats-grid">
        <article className="metric-card">
          <span>Branches</span>
          <strong>{integer(totals.branches)}</strong>
          <StatusPill tone="info">{integer(totals.activeBranches)} active</StatusPill>
        </article>
        <article className="metric-card">
          <span>POS tills</span>
          <strong>{integer(totals.tills)}</strong>
          <StatusPill tone="success">{integer(totals.activeTills)} active</StatusPill>
        </article>
        <article className="metric-card">
          <span>Selected branch</span>
          <strong>{selectedBranch?.code ?? "-"}</strong>
          <StatusPill tone={toneForStatus(selectedBranch?.status)}>
            {titleize(selectedBranch?.status)}
          </StatusPill>
        </article>
        <article className="metric-card">
          <span>Receipt readiness</span>
          <strong>{setupScore}%</strong>
          <StatusPill tone={setupScore === 100 ? "success" : "warning"}>
            {setupScore === 100 ? "Ready" : "Needs details"}
          </StatusPill>
        </article>
      </div>

      <section className="settings-context-grid">
        <article>
          <span>Admin context</span>
          <strong>{user?.role_name ?? "Current user"}</strong>
        </article>
        <article>
          <span>Branch scope</span>
          <strong>{selectedBranch?.name ?? "No branch selected"}</strong>
        </article>
        <article>
          <span>Receipt contact</span>
          <strong>{selectedBranchContact}</strong>
        </article>
        <article>
          <span>API target</span>
          <strong>{apiTarget}</strong>
        </article>
      </section>

      <div className="settings-desk m-t">
        <section className="panel-card">
          <header className="panel-card__header panel-card__header--compact">
            <div>
              <p className="eyebrow">Selected branch</p>
              <h2>{selectedBranch?.name ?? "No branch selected"}</h2>
            </div>
            {selectedBranch && (
              <StatusPill tone={toneForStatus(selectedBranch.status)}>
                {titleize(selectedBranch.status)}
              </StatusPill>
            )}
          </header>
          {selectedBranch ? (
            <div className="settings-branch-card">
              <strong>{selectedBranch.name}</strong>
              <span>
                {selectedBranch.address || "No address"} ·{" "}
                {selectedBranch.city || "No city"}
              </span>
              <div>
                <span>Receipt phone</span>
                <b>{selectedBranch.phone ?? "Not set"}</b>
              </div>
              <div>
                <span>Receipt email</span>
                <b>{selectedBranch.email ?? "Not set"}</b>
              </div>
            </div>
          ) : (
            <p className="empty-panel-message">No branch selected.</p>
          )}
        </section>

        <section className="panel-card">
          <header className="panel-card__header panel-card__header--compact">
            <div>
              <p className="eyebrow">Checklist</p>
              <h2>Go-live readiness</h2>
            </div>
          </header>
          <div className="settings-checklist">
            {checklist.map((item) => (
              <article key={item.label}>
                <StatusPill tone={item.done ? "success" : "warning"}>
                  {item.done ? "Done" : "Missing"}
                </StatusPill>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel-card">
          <header className="panel-card__header panel-card__header--compact">
            <div>
              <p className="eyebrow">Tills</p>
              <h2>POS registers</h2>
            </div>
          </header>
          <div className="settings-till-list">
            {branchTills.length ? (
              branchTills.map((till) => (
                <button
                  className={selectedTill?.id === till.id ? "is-selected" : ""}
                  key={till.id}
                  onClick={() => setSelectedTillId(till.id)}
                  type="button"
                >
                  <strong>{till.name}</strong>
                  <span>{till.code}</span>
                  <StatusPill tone={toneForStatus(till.is_active)}>
                    {till.is_active ? "Active" : "Inactive"}
                  </StatusPill>
                </button>
              ))
            ) : (
              <p className="empty-panel-message">No tills configured.</p>
            )}
          </div>
        </section>
      </div>

      <div className="settings-admin-grid m-t">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Receipt preview</p>
              <h2>What customers will see</h2>
            </div>
            <StatusPill tone={setupScore === 100 ? "success" : "warning"}>
              {setupScore === 100 ? "Clean receipt" : "Needs profile data"}
            </StatusPill>
          </header>
          <div className="settings-receipt-preview">
            <div className="settings-receipt-preview__paper">
              <h3>{selectedBranch?.name ?? "Branch name"}</h3>
              <span>{selectedBranch?.code ?? "BRANCH-CODE"}</span>
              <p>{branchAddress(selectedBranch) || "Receipt address not set"}</p>
              <div>
                <span>Phone</span>
                <strong>{selectedBranch?.phone ?? "Not set"}</strong>
              </div>
              <div>
                <span>Email</span>
                <strong>{selectedBranch?.email ?? "Not set"}</strong>
              </div>
              <small>
                Receipt details are pulled from the selected branch profile.
              </small>
            </div>
          </div>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Payments</p>
              <h2>Payment readiness</h2>
            </div>
            <StatusPill
              tone={
                paymentReadiness.every((item) => item.state === "done")
                  ? "success"
                  : "info"
              }
            >
              Safe config view
            </StatusPill>
          </header>
          <div className="settings-payment-readiness">
            {paymentReadiness.map((item) => (
              <article key={item.label}>
                <StatusPill tone={readinessTone(item.state)}>
                  {titleize(item.state)}
                </StatusPill>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </div>
              </article>
            ))}
            <p>
              Secret values are never displayed here. Use this panel as a
              go-live checklist before testing M-Pesa prompts with a public
              callback URL.
            </p>
          </div>
        </section>
      </div>

      <div className="repair-workspace m-t">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Branch profile</p>
              <h2>Edit selected branch</h2>
            </div>
          </header>
          <form className="form-panel" onSubmit={handleUpdateBranch}>
            <div className="form-grid form-grid--two">
              <label>
                Branch name
                <input
                  value={branchForm.name}
                  onChange={(event) =>
                    setBranchForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Branch code
                <input value={branchForm.code} disabled />
              </label>
              <label>
                Phone
                <input
                  value={branchForm.phone}
                  onChange={(event) =>
                    setBranchForm((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={branchForm.email}
                  onChange={(event) =>
                    setBranchForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                City
                <input
                  value={branchForm.city}
                  onChange={(event) =>
                    setBranchForm((current) => ({
                      ...current,
                      city: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Country
                <input
                  value={branchForm.country}
                  onChange={(event) =>
                    setBranchForm((current) => ({
                      ...current,
                      country: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <label>
              Receipt address
              <textarea
                value={branchForm.address}
                onChange={(event) =>
                  setBranchForm((current) => ({
                    ...current,
                    address: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Branch status
              <select
                value={branchForm.status}
                onChange={(event) =>
                  setBranchForm((current) => ({
                    ...current,
                    status: event.target.value,
                  }))
                }
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <div className="form-footer">
              <button className="primary-button" disabled={busy || !selectedBranch}>
                Save Branch
              </button>
            </div>
          </form>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">POS setup</p>
              <h2>Till configuration</h2>
            </div>
          </header>
          <div className="ticket-action-panel">
            <form className="action-form" onSubmit={handleCreateTill}>
              <strong>Create till for {selectedBranch?.name ?? "branch"}</strong>
              <div className="form-grid form-grid--two">
                <label>
                  Till name
                  <input
                    value={tillForm.name}
                    onChange={(event) =>
                      setTillForm((current) => ({
                        ...current,
                        name: event.target.value,
                        code:
                          current.code === codeFromName(current.name, "-01")
                            ? codeFromName(event.target.value, "-01")
                            : current.code,
                      }))
                    }
                    placeholder="Main POS"
                  />
                </label>
                <label>
                  Till code
                  <input
                    value={tillForm.code}
                    onChange={(event) =>
                      setTillForm((current) => ({
                        ...current,
                        code: codeFromName(event.target.value),
                      }))
                    }
                    placeholder="HQ-POS-01"
                  />
                </label>
              </div>
              <button className="secondary-button" disabled={busy || !selectedBranch}>
                Create Till
              </button>
            </form>

            {selectedTill && (
              <form className="action-form" onSubmit={handleUpdateTill}>
                <strong>Edit selected till</strong>
                <div className="selected-ticket-card">
                  <strong>{selectedTill.name}</strong>
                  <span>
                    {selectedTill.code} · Created {dateLabel(selectedTill.created_at)}
                  </span>
                  <StatusPill tone={toneForStatus(selectedTill.is_active)}>
                    {selectedTill.is_active ? "Active" : "Inactive"}
                  </StatusPill>
                </div>
                <label>
                  Till name
                  <input
                    value={tillEditForm.name}
                    onChange={(event) =>
                      setTillEditForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Active
                  <select
                    value={tillEditForm.is_active ? "true" : "false"}
                    onChange={(event) =>
                      setTillEditForm((current) => ({
                        ...current,
                        is_active: event.target.value === "true",
                      }))
                    }
                  >
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </label>
                <button className="primary-button" disabled={busy}>
                  Save Till
                </button>
              </form>
            )}
          </div>
        </section>
      </div>

      <div className="dashboard-grid m-t">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Branches</p>
              <h2>Branch list</h2>
            </div>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>City</th>
                <th>Contact</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => (
                <tr
                  className={selectedBranch?.id === branch.id ? "is-selected" : ""}
                  key={branch.id}
                  onClick={() => setSelectedBranchId(branch.id)}
                >
                  <td>{branch.code}</td>
                  <td>{branch.name}</td>
                  <td>{branch.city ?? "-"}</td>
                  <td>{branch.phone ?? branch.email ?? "-"}</td>
                  <td>
                    <StatusPill tone={toneForStatus(branch.status)}>
                      {titleize(branch.status)}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">New branch</p>
              <h2>Add branch</h2>
            </div>
          </header>
          <form className="form-panel" onSubmit={handleCreateBranch}>
            <div className="form-grid form-grid--two">
              <label>
                Name
                <input
                  value={newBranchForm.name}
                  onChange={(event) =>
                    setNewBranchForm((current) => ({
                      ...current,
                      name: event.target.value,
                      code:
                        current.code === codeFromName(current.name)
                          ? codeFromName(event.target.value)
                          : current.code,
                    }))
                  }
                  placeholder="West Branch"
                />
              </label>
              <label>
                Code
                <input
                  value={newBranchForm.code}
                  onChange={(event) =>
                    setNewBranchForm((current) => ({
                      ...current,
                      code: codeFromName(event.target.value),
                    }))
                  }
                  placeholder="WEST"
                />
              </label>
              <label>
                Phone
                <input
                  value={newBranchForm.phone}
                  onChange={(event) =>
                    setNewBranchForm((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                City
                <input
                  value={newBranchForm.city}
                  onChange={(event) =>
                    setNewBranchForm((current) => ({
                      ...current,
                      city: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <label>
              Address
              <textarea
                value={newBranchForm.address}
                onChange={(event) =>
                  setNewBranchForm((current) => ({
                    ...current,
                    address: event.target.value,
                  }))
                }
              />
            </label>
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={newBranchForm.is_headquarters}
                onChange={(event) =>
                  setNewBranchForm((current) => ({
                    ...current,
                    is_headquarters: event.target.checked,
                  }))
                }
              />
              Mark as headquarters
            </label>
            <div className="form-footer">
              <button className="secondary-button" disabled={busy}>
                Add Branch
              </button>
            </div>
          </form>
        </section>
      </div>
    </section>
  );
}
