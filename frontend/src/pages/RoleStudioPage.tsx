import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  createStaffUser,
  listAssignableRoles,
  listBranches,
  listStaffUsers,
  updateStaffUser,
} from "../api/client";
import type { AssignableRole, Branch, StaffUser } from "../api/types";
import { StatusPill } from "../components/StatusPill";
import { demoBranches, demoRoles, demoStaffUsers } from "../data/demoManagement";
import { useAuth } from "../state/auth";
import { dateLabel, integer, titleize, toneForStatus } from "../utils/format";

const permissionGroups = [
  ["Catalog", "View products", "Create products", "Edit pricing"],
  ["Inventory", "View stock", "Adjust stock", "Transfer stock"],
  ["POS / Sales", "Process sale", "Void sale", "Approve refund"],
  ["Repairs", "Assign ticket", "Update ticket", "Close ticket"],
  ["Reports", "Sales reports", "Inventory reports", "Repair reports"],
  ["Staff", "Create staff", "Edit staff", "Assign role"],
];

const emptyCreateForm = {
  full_name: "",
  username: "",
  email: "",
  phone: "",
  password: "TempPass123!",
  role_id: demoRoles.find((role) => role.code === "cashier")?.id ?? demoRoles[0]?.id ?? "",
  branch_id: demoBranches[0]?.id ?? "",
};

const emptyEditForm = {
  full_name: "",
  email: "",
  phone: "",
  role_id: "",
  branch_id: "",
  is_active: true,
  is_verified: true,
};

function usernameFromName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function RoleStudioPage() {
  const { token, isPreview } = useAuth();
  const [roles, setRoles] = useState<AssignableRole[]>(demoRoles);
  const [branches, setBranches] = useState<Branch[]>(demoBranches);
  const [users, setUsers] = useState<StaffUser[]>(demoStaffUsers);
  const [selectedUserId, setSelectedUserId] = useState(demoStaffUsers[0]?.id ?? "");
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const roleNameById = useMemo(
    () => new Map(roles.map((role) => [role.id, role.name])),
    [roles],
  );

  const roleById = useMemo(
    () => new Map(roles.map((role) => [role.id, role])),
    [roles],
  );

  const branchNameById = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  );

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? users[0],
    [selectedUserId, users],
  );

  const stats = useMemo(
    () => ({
      users: users.length,
      active: users.filter((user) => user.is_active).length,
      pendingPassword: users.filter((user) => user.must_change_password).length,
      roles: roles.length,
    }),
    [roles.length, users],
  );

  useEffect(() => {
    if (!token || isPreview) return;

    let active = true;
    Promise.allSettled([
      listAssignableRoles(token),
      listStaffUsers(token),
      listBranches(token),
    ]).then(([rolesResult, usersResult, branchesResult]) => {
      if (!active) return;
      let failed = false;

      if (rolesResult.status === "fulfilled") {
        setRoles(rolesResult.value);
        setCreateForm((current) => ({
          ...current,
          role_id: current.role_id || rolesResult.value[0]?.id || "",
        }));
      } else {
        failed = true;
      }

      if (usersResult.status === "fulfilled") {
        setUsers(usersResult.value);
        setSelectedUserId((current) => current || usersResult.value[0]?.id || "");
      } else {
        failed = true;
      }

      if (branchesResult.status === "fulfilled") {
        setBranches(branchesResult.value);
        setCreateForm((current) => ({
          ...current,
          branch_id: current.branch_id || branchesResult.value[0]?.id || "",
        }));
      } else {
        failed = true;
      }

      setNotice(
        failed
          ? "Staff API unavailable or not permitted. Sample data remains visible where needed."
          : null,
      );
    });

    return () => {
      active = false;
    };
  }, [isPreview, token]);

  useEffect(() => {
    if (!selectedUser) {
      setEditForm(emptyEditForm);
      return;
    }
    setEditForm({
      full_name: selectedUser.full_name,
      email: selectedUser.email,
      phone: selectedUser.phone ?? "",
      role_id: selectedUser.role_id,
      branch_id: selectedUser.branch_id ?? "",
      is_active: selectedUser.is_active,
      is_verified: selectedUser.is_verified,
    });
  }, [selectedUser]);

  function branchLabel(branchId: string | null) {
    if (!branchId) return "All branches";
    return branchNameById.get(branchId) ?? branchId;
  }

  function upsertUser(user: StaffUser) {
    setUsers((current) => current.map((item) => (item.id === user.id ? user : item)));
    setSelectedUserId(user.id);
  }

  async function handleCreateStaff(event: FormEvent) {
    event.preventDefault();
    if (!createForm.full_name.trim() || !createForm.username.trim()) {
      setNotice("Full name and username are required.");
      return;
    }
    if (!createForm.email.trim()) {
      setNotice("Email is required.");
      return;
    }
    if (createForm.password.length < 8) {
      setNotice("Temporary password must be at least 8 characters.");
      return;
    }
    if (!createForm.role_id) {
      setNotice("Select a role for the staff account.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const user: StaffUser = {
          id: `preview-user-${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          full_name: createForm.full_name.trim(),
          username: createForm.username.trim().toLowerCase(),
          email: createForm.email.trim().toLowerCase(),
          phone: createForm.phone || null,
          branch_id: createForm.branch_id || null,
          role_id: createForm.role_id,
          is_active: true,
          is_verified: true,
          must_change_password: true,
        };
        setUsers((current) => [user, ...current]);
        setSelectedUserId(user.id);
        setCreateForm((current) => ({
          ...emptyCreateForm,
          role_id: current.role_id,
          branch_id: current.branch_id,
        }));
        setNotice("Preview staff user created locally.");
        return;
      }

      const user = await createStaffUser(token, {
        full_name: createForm.full_name.trim(),
        username: createForm.username.trim().toLowerCase(),
        email: createForm.email.trim().toLowerCase(),
        phone: createForm.phone || null,
        password: createForm.password,
        role_id: createForm.role_id,
        branch_id: createForm.branch_id || null,
      });
      setUsers((current) => [user, ...current]);
      setSelectedUserId(user.id);
      setCreateForm((current) => ({
        ...emptyCreateForm,
        role_id: current.role_id,
        branch_id: current.branch_id,
      }));
      setNotice(`Created staff user ${user.full_name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create staff user.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateStaff(event: FormEvent) {
    event.preventDefault();
    if (!selectedUser) {
      setNotice("Select a staff user first.");
      return;
    }
    if (!editForm.full_name.trim() || !editForm.email.trim() || !editForm.role_id) {
      setNotice("Full name, email, and role are required.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        upsertUser({
          ...selectedUser,
          updated_at: new Date().toISOString(),
          full_name: editForm.full_name.trim(),
          email: editForm.email.trim().toLowerCase(),
          phone: editForm.phone || null,
          branch_id: editForm.branch_id || null,
          role_id: editForm.role_id,
          is_active: editForm.is_active,
          is_verified: editForm.is_verified,
        });
        setNotice("Preview staff user updated locally.");
        return;
      }

      const user = await updateStaffUser(token, selectedUser.id, {
        full_name: editForm.full_name.trim(),
        email: editForm.email.trim().toLowerCase(),
        phone: editForm.phone || null,
        branch_id: editForm.branch_id || null,
        role_id: editForm.role_id,
        is_active: editForm.is_active,
        is_verified: editForm.is_verified,
      });
      upsertUser(user);
      setNotice(`Updated staff user ${user.full_name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update staff user.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="role-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Staff & permissions</p>
          <h1>Staff and roles</h1>
          <p>
            Create staff accounts, assign branch-scoped roles, keep risky role
            changes behind backend safeguards, and prepare for custom permission
            roles later.
          </p>
        </div>
        <StatusPill tone="info">Backend-enforced role assignment</StatusPill>
      </div>

      {notice && <div className="notice notice--page">{notice}</div>}

      <div className="stats-grid">
        <article className="metric-card">
          <span>Staff users</span>
          <strong>{integer(stats.users)}</strong>
          <StatusPill tone="info">Accounts</StatusPill>
        </article>
        <article className="metric-card">
          <span>Active</span>
          <strong>{integer(stats.active)}</strong>
          <StatusPill tone="success">Enabled</StatusPill>
        </article>
        <article className="metric-card">
          <span>Password reset</span>
          <strong>{integer(stats.pendingPassword)}</strong>
          <StatusPill tone={stats.pendingPassword ? "warning" : "success"}>
            First login
          </StatusPill>
        </article>
        <article className="metric-card">
          <span>Assignable roles</span>
          <strong>{integer(stats.roles)}</strong>
          <StatusPill tone="neutral">By your role</StatusPill>
        </article>
      </div>

      <div className="repair-workspace m-t">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">New account</p>
              <h2>Create staff user</h2>
            </div>
          </header>

          <form className="form-panel" onSubmit={handleCreateStaff}>
            <div className="form-grid form-grid--two">
              <label>
                Full name
                <input
                  value={createForm.full_name}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      full_name: event.target.value,
                      username:
                        current.username === usernameFromName(current.full_name)
                          ? usernameFromName(event.target.value)
                          : current.username,
                    }))
                  }
                  placeholder="Jane Cashier"
                />
              </label>
              <label>
                Username
                <input
                  value={createForm.username}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      username: usernameFromName(event.target.value),
                    }))
                  }
                  placeholder="jane_cashier"
                />
              </label>
            </div>

            <div className="form-grid form-grid--two">
              <label>
                Email
                <input
                  type="email"
                  value={createForm.email}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Phone
                <input
                  value={createForm.phone}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <div className="form-grid form-grid--three">
              <label>
                Role
                <select
                  value={createForm.role_id}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      role_id: event.target.value,
                    }))
                  }
                >
                  <option value="">Select role</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Branch
                <select
                  value={createForm.branch_id}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      branch_id: event.target.value,
                    }))
                  }
                >
                  <option value="">All branches / owner scope</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Temp password
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <div className="form-footer">
              <button className="primary-button" disabled={busy}>
                Create Staff User
              </button>
            </div>
          </form>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Selected user</p>
              <h2>{selectedUser?.full_name ?? "No staff selected"}</h2>
            </div>
          </header>

          <div className="ticket-action-panel">
            {selectedUser ? (
              <>
                <div className="selected-ticket-card">
                  <strong>{selectedUser.full_name}</strong>
                  <span>
                    {selectedUser.username} · {selectedUser.email} ·{" "}
                    {branchLabel(selectedUser.branch_id)}
                  </span>
                  <div className="table-actions">
                    <StatusPill tone={toneForStatus(selectedUser.is_active)}>
                      {selectedUser.is_active ? "Active" : "Inactive"}
                    </StatusPill>
                    <StatusPill tone={selectedUser.must_change_password ? "warning" : "success"}>
                      {selectedUser.must_change_password ? "Must change password" : "Ready"}
                    </StatusPill>
                  </div>
                </div>

                <form className="action-form" onSubmit={handleUpdateStaff}>
                  <div className="form-grid form-grid--two">
                    <label>
                      Full name
                      <input
                        value={editForm.full_name}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            full_name: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Email
                      <input
                        type="email"
                        value={editForm.email}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            email: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Phone
                      <input
                        value={editForm.phone}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            phone: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Role
                      <select
                        value={editForm.role_id}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            role_id: event.target.value,
                          }))
                        }
                      >
                        <option value="">Select role</option>
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Branch
                      <select
                        value={editForm.branch_id}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            branch_id: event.target.value,
                          }))
                        }
                      >
                        <option value="">All branches / owner scope</option>
                        {branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Active
                      <select
                        value={editForm.is_active ? "true" : "false"}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            is_active: event.target.value === "true",
                          }))
                        }
                      >
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                    </label>
                    <label>
                      Verified
                      <select
                        value={editForm.is_verified ? "true" : "false"}
                        onChange={(event) =>
                          setEditForm((current) => ({
                            ...current,
                            is_verified: event.target.value === "true",
                          }))
                        }
                      >
                        <option value="true">Verified</option>
                        <option value="false">Unverified</option>
                      </select>
                    </label>
                  </div>
                  <button className="primary-button" disabled={busy}>
                    Save Staff Changes
                  </button>
                </form>
              </>
            ) : (
              <p className="muted">Select a staff user from the table.</p>
            )}
          </div>
        </section>
      </div>

      <div className="role-layout m-t">
        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Staff</p>
              <h2>Users</h2>
            </div>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Branch</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className={selectedUser?.id === user.id ? "is-selected" : ""}
                  onClick={() => setSelectedUserId(user.id)}
                >
                  <td>{user.full_name}</td>
                  <td>{user.username}</td>
                  <td>{roleNameById.get(user.role_id) ?? user.role_id}</td>
                  <td>{branchLabel(user.branch_id)}</td>
                  <td>
                    <StatusPill tone={toneForStatus(user.is_active)}>
                      {user.is_active ? "Active" : "Inactive"}
                    </StatusPill>
                  </td>
                  <td>{dateLabel(user.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Assignable roles</p>
              <h2>Role list</h2>
            </div>
            <StatusPill tone="warning">Role CRUD backend pending</StatusPill>
          </header>
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id}>
                  <td>{role.code}</td>
                  <td>{role.name}</td>
                  <td>{role.description ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="form-panel form-panel--bordered">
            <strong>Assignment rule</strong>
            <p className="muted">
              This frontend only shows roles returned by the backend for the
              current user. The backend still enforces the important rule:
              Branch Managers cannot create Admins or peer managers, while
              Admins can assign any role.
            </p>
            {selectedUser && (
              <p className="muted">
                Selected role:{" "}
                {roleById.get(selectedUser.role_id)?.name ?? selectedUser.role_id}
              </p>
            )}
          </div>
        </section>
      </div>

      <section className="panel-card m-t">
        <header className="panel-card__header">
          <div>
            <p className="eyebrow">Permission matrix</p>
            <h2>Future custom role editor</h2>
          </div>
          <StatusPill tone="warning">Display only</StatusPill>
        </header>
        <div className="permission-matrix">
          {permissionGroups.map(([group, ...permissions]) => (
            <fieldset key={group}>
              <legend>{group}</legend>
              {permissions.map((permission) => (
                <label key={permission}>
                  <input
                    type="checkbox"
                    defaultChecked={!permission.includes("Void")}
                    disabled
                  />
                  {permission}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </section>
    </section>
  );
}
