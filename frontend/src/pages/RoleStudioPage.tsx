import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  createRole,
  createStaffUser,
  listAssignableRoles,
  listBranches,
  listManagedRoles,
  listPermissions,
  listStaffUsers,
  updateRole,
  updateStaffUser,
} from "../api/client";
import type {
  AssignableRole,
  Branch,
  Permission,
  Role,
  StaffUser,
} from "../api/types";
import { StatusPill } from "../components/StatusPill";
import { demoBranches, demoRoles, demoStaffUsers } from "../data/demoManagement";
import { useAuth } from "../state/auth";
import { dateLabel, integer, titleize, toneForStatus } from "../utils/format";

const permissionCatalog = [
  ["branches.manage", "Create and configure branches"],
  ["catalog.view", "View the product catalog"],
  ["catalog.manage", "Create products, variants, categories, brands, and prices"],
  ["inventory.view", "View branch inventory levels"],
  ["inventory.adjust", "Request or perform stock adjustments"],
  ["inventory.transfer", "Initiate and process stock transfers"],
  ["purchases.create", "Create purchase orders"],
  ["purchases.approve", "Approve purchase orders"],
  ["purchases.receive", "Receive stock against purchase orders"],
  ["sales.process", "Process point-of-sale transactions"],
  ["sales.void", "Approve or perform sale voids"],
  ["returns.approve", "Approve returns and refunds"],
  ["tills.manage", "Create and configure branch tills"],
  ["tills.own.view", "View the signed-in cashier's till session"],
  ["repairs.view", "View repair tickets within the permitted scope"],
  ["repairs.assign", "Assign repair tickets to technicians"],
  ["repairs.update", "Update repair status and parts usage"],
  ["repairs.close", "Close repair tickets and generate invoices"],
  ["orders.fulfill", "Fulfill or cancel online orders"],
  ["reports.sales.view", "View sales reports"],
  ["reports.inventory.view", "View inventory and purchasing reports"],
  ["reports.repairs.view", "View repair reports"],
  ["reports.own_repairs.view", "View reports for assigned repair tickets"],
  ["expenses.view", "View expense records"],
  ["expenses.manage", "Create and approve expense records"],
  ["staff.manage", "Create and edit staff accounts within role scope"],
] as const;

const demoPermissionCodesByRole: Record<string, string[]> = {
  admin: permissionCatalog.map(([code]) => code),
  branch_manager: [
    "catalog.view",
    "inventory.view",
    "inventory.adjust",
    "inventory.transfer",
    "purchases.create",
    "purchases.approve",
    "purchases.receive",
    "sales.process",
    "sales.void",
    "returns.approve",
    "tills.manage",
    "repairs.view",
    "repairs.assign",
    "repairs.update",
    "repairs.close",
    "orders.fulfill",
    "reports.sales.view",
    "reports.inventory.view",
    "reports.repairs.view",
    "expenses.view",
    "expenses.manage",
    "staff.manage",
  ],
  inventory_manager: [
    "catalog.view",
    "inventory.view",
    "inventory.adjust",
    "inventory.transfer",
    "purchases.create",
    "purchases.approve",
    "purchases.receive",
    "orders.fulfill",
    "reports.inventory.view",
  ],
  technician: [
    "repairs.view",
    "repairs.update",
    "repairs.close",
    "reports.own_repairs.view",
  ],
  cashier: ["catalog.view", "inventory.view", "sales.process", "tills.own.view"],
  accountant: [
    "reports.sales.view",
    "reports.inventory.view",
    "reports.repairs.view",
    "expenses.view",
  ],
};

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

const emptyRoleForm = {
  code: "",
  name: "",
  description: "",
  permission_ids: [] as string[],
  is_active: true,
};

function usernameFromName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function roleCodeFromName(name: string) {
  return usernameFromName(name).slice(0, 50);
}

function fallbackPermissions(): Permission[] {
  const now = new Date().toISOString();
  return permissionCatalog.map(([code, description]) => {
    const [resource, action] = code.split(/\.(?=[^.]+$)/);
    return {
      id: `demo-permission-${code}`,
      created_at: now,
      updated_at: now,
      is_deleted: false,
      code,
      resource,
      action,
      description,
    };
  });
}

function demoManagedRoles(permissions: Permission[]): Role[] {
  const now = new Date().toISOString();
  const permissionByCode = new Map(permissions.map((permission) => [permission.code, permission]));
  return demoRoles.map((role) => ({
    id: role.id,
    created_at: now,
    updated_at: now,
    is_deleted: false,
    code: role.code,
    name: role.name,
    description: role.description,
    is_system: true,
    is_active: true,
    permissions: (demoPermissionCodesByRole[role.code] ?? [])
      .map((code) => permissionByCode.get(code))
      .filter((permission): permission is Permission => Boolean(permission)),
  }));
}

export function RoleStudioPage() {
  const { token, isPreview, user } = useAuth();
  const previewPermissions = useMemo(() => fallbackPermissions(), []);
  const [assignableRoles, setAssignableRoles] = useState<AssignableRole[]>(demoRoles);
  const [managedRoles, setManagedRoles] = useState<Role[]>(() =>
    demoManagedRoles(previewPermissions),
  );
  const [permissions, setPermissions] = useState<Permission[]>(previewPermissions);
  const [branches, setBranches] = useState<Branch[]>(demoBranches);
  const [users, setUsers] = useState<StaffUser[]>(demoStaffUsers);
  const [selectedUserId, setSelectedUserId] = useState(demoStaffUsers[0]?.id ?? "");
  const [selectedRoleId, setSelectedRoleId] = useState(demoRoles[0]?.id ?? "");
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [roleForm, setRoleForm] = useState(emptyRoleForm);
  const [userSearch, setUserSearch] = useState("");
  const [roleSearch, setRoleSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const roleNameById = useMemo(
    () =>
      new Map([
        ...assignableRoles.map((role) => [role.id, role.name] as const),
        ...managedRoles.map((role) => [role.id, role.name] as const),
      ]),
    [assignableRoles, managedRoles],
  );

  const roleById = useMemo(
    () => new Map(managedRoles.map((role) => [role.id, role])),
    [managedRoles],
  );

  const branchNameById = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  );

  const permissionById = useMemo(
    () => new Map(permissions.map((permission) => [permission.id, permission])),
    [permissions],
  );

  const permissionGroups = useMemo(() => {
    const groups = new Map<string, Permission[]>();
    permissions.forEach((permission) => {
      const current = groups.get(permission.resource) ?? [];
      current.push(permission);
      groups.set(permission.resource, current);
    });
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [permissions]);

  const selectedUser = useMemo(
    () => users.find((item) => item.id === selectedUserId) ?? users[0],
    [selectedUserId, users],
  );

  const selectedRole = useMemo(
    () => managedRoles.find((role) => role.id === selectedRoleId),
    [managedRoles, selectedRoleId],
  );

  const filteredUsers = useMemo(() => {
    const needle = userSearch.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((staff) =>
      [
        staff.full_name,
        staff.username,
        staff.email,
        roleNameById.get(staff.role_id),
        branchLabel(staff.branch_id),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [roleNameById, userSearch, users, branches]);

  const filteredRoles = useMemo(() => {
    const needle = roleSearch.trim().toLowerCase();
    if (!needle) return managedRoles;
    return managedRoles.filter((role) =>
      [role.code, role.name, role.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [managedRoles, roleSearch]);

  const selectedRolePermissionCodes = useMemo(
    () =>
      roleForm.permission_ids
        .map((permissionId) => permissionById.get(permissionId)?.code)
        .filter((code): code is string => Boolean(code)),
    [permissionById, roleForm.permission_ids],
  );

  const stats = useMemo(
    () => ({
      users: users.length,
      active: users.filter((staff) => staff.is_active).length,
      pendingPassword: users.filter((staff) => staff.must_change_password).length,
      roles: managedRoles.length,
      customRoles: managedRoles.filter((role) => !role.is_system).length,
    }),
    [managedRoles, users],
  );

  useEffect(() => {
    if (!token || isPreview) return;

    let active = true;
    Promise.allSettled([
      listAssignableRoles(token),
      listManagedRoles(token),
      listPermissions(token),
      listStaffUsers(token),
      listBranches(token),
    ]).then(
      ([assignableResult, managedResult, permissionsResult, usersResult, branchesResult]) => {
        if (!active) return;
        let failed = false;

        if (assignableResult.status === "fulfilled") {
          setAssignableRoles(assignableResult.value);
          setCreateForm((current) => ({
            ...current,
            role_id: current.role_id || assignableResult.value[0]?.id || "",
          }));
        } else {
          failed = true;
        }

        if (managedResult.status === "fulfilled") {
          setManagedRoles(managedResult.value);
          setSelectedRoleId((current) => current || managedResult.value[0]?.id || "");
        } else {
          failed = true;
        }

        if (permissionsResult.status === "fulfilled") {
          setPermissions(permissionsResult.value);
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
            ? "Some staff or role tools are unavailable or not permitted. Available data remains visible."
            : null,
        );
      },
    );

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

  useEffect(() => {
    if (!selectedRole) {
      setRoleForm(emptyRoleForm);
      return;
    }
    setRoleForm({
      code: selectedRole.code,
      name: selectedRole.name,
      description: selectedRole.description ?? "",
      permission_ids: selectedRole.permissions.map((permission) => permission.id),
      is_active: selectedRole.is_active,
    });
  }, [selectedRole]);

  function branchLabel(branchId: string | null) {
    if (!branchId) return "All branches";
    return branchNameById.get(branchId) ?? branchId;
  }

  function roleScopeLabel(role: Role | AssignableRole | undefined) {
    if (!role) return "Unknown";
    if (role.code === "admin") return "All branches";
    return "Branch-scoped";
  }

  function upsertUser(nextUser: StaffUser) {
    setUsers((current) =>
      current.some((item) => item.id === nextUser.id)
        ? current.map((item) => (item.id === nextUser.id ? nextUser : item))
        : [nextUser, ...current],
    );
    setSelectedUserId(nextUser.id);
  }

  function upsertRole(nextRole: Role) {
    setManagedRoles((current) =>
      current.some((role) => role.id === nextRole.id)
        ? current.map((role) => (role.id === nextRole.id ? nextRole : role))
        : [nextRole, ...current],
    );
    setAssignableRoles((current) => {
      const assignable = {
        id: nextRole.id,
        code: nextRole.code,
        name: nextRole.name,
        description: nextRole.description,
      };
      if (!nextRole.is_active) {
        return current.filter((role) => role.id !== nextRole.id);
      }
      return current.some((role) => role.id === nextRole.id)
        ? current.map((role) => (role.id === nextRole.id ? assignable : role))
        : [...current, assignable].sort((left, right) =>
            left.name.localeCompare(right.name),
          );
    });
    setSelectedRoleId(nextRole.id);
  }

  function togglePermission(permissionId: string) {
    setRoleForm((current) => ({
      ...current,
      permission_ids: current.permission_ids.includes(permissionId)
        ? current.permission_ids.filter((item) => item !== permissionId)
        : [...current.permission_ids, permissionId],
    }));
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
        const nextUser: StaffUser = {
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
        upsertUser(nextUser);
        setCreateForm((current) => ({
          ...emptyCreateForm,
          role_id: current.role_id,
          branch_id: current.branch_id,
        }));
        setNotice("Preview staff user created locally.");
        return;
      }

      const nextUser = await createStaffUser(token, {
        full_name: createForm.full_name.trim(),
        username: createForm.username.trim().toLowerCase(),
        email: createForm.email.trim().toLowerCase(),
        phone: createForm.phone || null,
        password: createForm.password,
        role_id: createForm.role_id,
        branch_id: createForm.branch_id || null,
      });
      upsertUser(nextUser);
      setCreateForm((current) => ({
        ...emptyCreateForm,
        role_id: current.role_id,
        branch_id: current.branch_id,
      }));
      setNotice(`Created staff user ${nextUser.full_name}.`);
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

      const nextUser = await updateStaffUser(token, selectedUser.id, {
        full_name: editForm.full_name.trim(),
        email: editForm.email.trim().toLowerCase(),
        phone: editForm.phone || null,
        branch_id: editForm.branch_id || null,
        role_id: editForm.role_id,
        is_active: editForm.is_active,
        is_verified: editForm.is_verified,
      });
      upsertUser(nextUser);
      setNotice(`Updated staff user ${nextUser.full_name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update staff user.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateRole(event: FormEvent) {
    event.preventDefault();
    const code = roleCodeFromName(roleForm.code || roleForm.name);
    if (!roleForm.name.trim() || !code) {
      setNotice("Role name and code are required.");
      return;
    }
    if (!roleForm.permission_ids.length) {
      setNotice("Select at least one permission for this role.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const nextRole: Role = {
          id: `preview-role-${Date.now()}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_deleted: false,
          code,
          name: roleForm.name.trim(),
          description: roleForm.description || null,
          is_system: false,
          is_active: true,
          permissions: roleForm.permission_ids
            .map((permissionId) => permissionById.get(permissionId))
            .filter((permission): permission is Permission => Boolean(permission)),
        };
        upsertRole(nextRole);
        setNotice(`Preview role ${nextRole.name} created locally.`);
        return;
      }

      const nextRole = await createRole(token, {
        code,
        name: roleForm.name.trim(),
        description: roleForm.description || null,
        permission_ids: roleForm.permission_ids,
      });
      upsertRole(nextRole);
      setNotice(`Created role ${nextRole.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create role.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateRole(event: FormEvent) {
    event.preventDefault();
    if (!selectedRole) {
      setNotice("Select a role first.");
      return;
    }
    if (selectedRole.is_system) {
      setNotice("System roles are protected. Create a custom role if you need changes.");
      return;
    }
    if (!roleForm.name.trim() || !roleForm.permission_ids.length) {
      setNotice("Role name and at least one permission are required.");
      return;
    }

    setBusy(true);
    try {
      if (!token || isPreview) {
        const nextRole: Role = {
          ...selectedRole,
          updated_at: new Date().toISOString(),
          name: roleForm.name.trim(),
          description: roleForm.description || null,
          is_active: roleForm.is_active,
          permissions: roleForm.permission_ids
            .map((permissionId) => permissionById.get(permissionId))
            .filter((permission): permission is Permission => Boolean(permission)),
        };
        upsertRole(nextRole);
        setNotice(`Preview role ${nextRole.name} updated locally.`);
        return;
      }

      const nextRole = await updateRole(token, selectedRole.id, {
        name: roleForm.name.trim(),
        description: roleForm.description || null,
        permission_ids: roleForm.permission_ids,
        is_active: roleForm.is_active,
      });
      upsertRole(nextRole);
      setNotice(`Updated role ${nextRole.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update role.");
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
            Create staff accounts, assign branch-scoped roles, and let Admins
            compose custom permission roles without touching code.
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
          <span>Roles</span>
          <strong>{integer(stats.roles)}</strong>
          <StatusPill tone={stats.customRoles ? "success" : "neutral"}>
            {integer(stats.customRoles)} custom
          </StatusPill>
        </article>
      </div>

      <div className="role-rule-grid m-t">
        <article className="panel-card role-rule-card">
          <strong>Admin role control</strong>
          <span>
            Admin can create custom roles, choose permissions, assign roles to
            staff, and create another Admin account when needed.
          </span>
        </article>
        <article className="panel-card role-rule-card">
          <strong>Branch manager limit</strong>
          <span>
            Branch Managers can manage Cashiers and Technicians in their own
            branch only. They cannot appoint peers or Admins.
          </span>
        </article>
        <article className="panel-card role-rule-card">
          <strong>System role safety</strong>
          <span>
            Built-in roles stay protected. Create a custom role when the client
            wants a new staff type such as Accountant or Supervisor.
          </span>
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
                  {assignableRoles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name} ({roleScopeLabel(role)})
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
                        {assignableRoles.map((role) => (
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
            <label className="table-search">
              <span>Search</span>
              <input
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="Name, role, branch"
              />
            </label>
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
              {filteredUsers.length ? (
                filteredUsers.map((staff) => (
                  <tr
                    key={staff.id}
                    className={selectedUser?.id === staff.id ? "is-selected" : ""}
                    onClick={() => setSelectedUserId(staff.id)}
                  >
                    <td>{staff.full_name}</td>
                    <td>{staff.username}</td>
                    <td>{roleNameById.get(staff.role_id) ?? staff.role_id}</td>
                    <td>{branchLabel(staff.branch_id)}</td>
                    <td>
                      <StatusPill tone={toneForStatus(staff.is_active)}>
                        {staff.is_active ? "Active" : "Inactive"}
                      </StatusPill>
                    </td>
                    <td>{dateLabel(staff.created_at)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="empty-table-cell">
                    No staff users match the search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="panel-card">
          <header className="panel-card__header">
            <div>
              <p className="eyebrow">Roles</p>
              <h2>Role library</h2>
            </div>
            <label className="table-search">
              <span>Search</span>
              <input
                value={roleSearch}
                onChange={(event) => setRoleSearch(event.target.value)}
                placeholder="Role or permission"
              />
            </label>
          </header>
          <div className="role-card-list">
            {filteredRoles.map((role) => (
              <button
                className={selectedRole?.id === role.id ? "is-selected" : ""}
                key={role.id}
                onClick={() => setSelectedRoleId(role.id)}
                type="button"
              >
                <div>
                  <strong>{role.name}</strong>
                  <span>{role.code}</span>
                </div>
                <div className="table-actions">
                  <StatusPill tone={role.is_system ? "neutral" : "info"}>
                    {role.is_system ? "System" : "Custom"}
                  </StatusPill>
                  <StatusPill tone={toneForStatus(role.is_active)}>
                    {role.is_active ? "Active" : "Inactive"}
                  </StatusPill>
                </div>
                <small>{integer(role.permissions.length)} permission(s)</small>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="panel-card m-t">
        <header className="panel-card__header">
          <div>
            <p className="eyebrow">Permission studio</p>
            <h2>{selectedRole?.name ?? "Create custom role"}</h2>
          </div>
          <StatusPill tone={selectedRole?.is_system ? "warning" : "success"}>
            {selectedRole?.is_system ? "System role locked" : "Custom role editable"}
          </StatusPill>
        </header>

        <form
          className="role-builder"
          onSubmit={selectedRole && !selectedRole.is_system ? handleUpdateRole : handleCreateRole}
        >
          <div className="role-builder__form">
            <div className="form-grid form-grid--three">
              <label>
                Role name
                <input
                  value={roleForm.name}
                  onChange={(event) =>
                    setRoleForm((current) => ({
                      ...current,
                      name: event.target.value,
                      code:
                        !selectedRole || selectedRole.is_system
                          ? roleCodeFromName(event.target.value)
                          : current.code,
                    }))
                  }
                  placeholder="Sales Supervisor"
                />
              </label>
              <label>
                Role code
                <input
                  value={roleForm.code}
                  disabled={Boolean(selectedRole && !selectedRole.is_system)}
                  onChange={(event) =>
                    setRoleForm((current) => ({
                      ...current,
                      code: roleCodeFromName(event.target.value),
                    }))
                  }
                  placeholder="sales_supervisor"
                />
              </label>
              <label>
                Status
                <select
                  value={roleForm.is_active ? "true" : "false"}
                  disabled={selectedRole?.is_system}
                  onChange={(event) =>
                    setRoleForm((current) => ({
                      ...current,
                      is_active: event.target.value === "true",
                    }))
                  }
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </label>
            </div>
            <label>
              Description
              <textarea
                value={roleForm.description}
                onChange={(event) =>
                  setRoleForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Explain where this role fits in the shop"
              />
            </label>
            <div className="role-builder__summary">
              <strong>{integer(roleForm.permission_ids.length)} selected</strong>
              <span>
                {selectedRolePermissionCodes.slice(0, 5).join(", ") ||
                  "Choose permissions below"}
              </span>
            </div>
          </div>

          <div className="permission-matrix permission-matrix--editable">
            {permissionGroups.map(([group, groupPermissions]) => (
              <fieldset key={group}>
                <legend>{titleize(group)}</legend>
                {groupPermissions.map((permission) => (
                  <label key={permission.id}>
                    <input
                      type="checkbox"
                      checked={roleForm.permission_ids.includes(permission.id)}
                      disabled={selectedRole?.is_system}
                      onChange={() => togglePermission(permission.id)}
                    />
                    <span>
                      <strong>{permission.code}</strong>
                      {permission.description}
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>

          <div className="form-footer role-builder__actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setSelectedRoleId("");
                setRoleForm(emptyRoleForm);
              }}
            >
              New Custom Role
            </button>
            <button
              className="primary-button"
              disabled={busy || Boolean(selectedRole?.is_system && selectedRoleId)}
            >
              {selectedRole && !selectedRole.is_system ? "Save Role" : "Create Role"}
            </button>
          </div>
        </form>
      </section>
    </section>
  );
}
