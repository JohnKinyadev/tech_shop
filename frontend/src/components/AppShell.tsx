import type { ReactNode } from "react";

import { BrandMark } from "./BrandMark";
import { StatusPill } from "./StatusPill";
import type { CurrentUser } from "../api/types";
import { useAuth } from "../state/auth";
import { isThemeChoice, themeOptions, type ThemeChoice } from "../state/theme";

export type AppView =
  | "dashboard"
  | "pos"
  | "catalog"
  | "inventory"
  | "repairs"
  | "purchases"
  | "expenses"
  | "reports"
  | "roles"
  | "settings";

type AppShellProps = {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  theme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
  children: ReactNode;
};

type NavItem = {
  key: AppView;
  label: string;
  roles?: string[];
  permissions?: string[];
};

const navItems: NavItem[] = [
  { key: "dashboard", label: "Dashboard" },
  {
    key: "pos",
    label: "Sales / POS",
    roles: ["admin", "owner", "branch_manager", "cashier"],
    permissions: ["sales.process", "tills.own.view", "tills.manage"],
  },
  {
    key: "catalog",
    label: "Catalog",
    roles: ["admin", "owner", "branch_manager", "inventory_manager", "cashier"],
    permissions: ["catalog.view", "catalog.manage"],
  },
  {
    key: "inventory",
    label: "Inventory",
    roles: ["admin", "owner", "branch_manager", "inventory_manager", "cashier"],
    permissions: ["inventory.view", "inventory.adjust", "inventory.transfer", "reports.inventory.view"],
  },
  {
    key: "repairs",
    label: "Repairs",
    roles: ["admin", "owner", "branch_manager", "technician"],
    permissions: [
      "repairs.view",
      "repairs.assign",
      "repairs.update",
      "repairs.close",
      "reports.own_repairs.view",
      "reports.repairs.view",
    ],
  },
  {
    key: "purchases",
    label: "Purchases",
    roles: ["admin", "owner", "branch_manager", "inventory_manager"],
    permissions: ["purchases.create", "purchases.approve", "purchases.receive"],
  },
  {
    key: "expenses",
    label: "Expenses",
    roles: ["admin", "owner", "branch_manager", "accountant"],
    permissions: ["expenses.view", "expenses.manage"],
  },
  {
    key: "reports",
    label: "Reports",
    roles: ["admin", "owner", "branch_manager", "inventory_manager", "accountant"],
    permissions: [
      "reports.sales.view",
      "reports.inventory.view",
      "reports.repairs.view",
      "reports.own_repairs.view",
      "expenses.view",
    ],
  },
  {
    key: "roles",
    label: "Staff & Roles",
    roles: ["admin", "owner", "branch_manager"],
    permissions: ["staff.manage", "roles.manage"],
  },
  {
    key: "settings",
    label: "Settings",
    roles: ["admin", "owner", "branch_manager"],
    permissions: ["branches.manage", "tills.manage"],
  },
];

function roleCode(user: CurrentUser) {
  return user.role_code.toLowerCase();
}

function hasGlobalAccess(user: CurrentUser) {
  return ["admin", "owner"].includes(roleCode(user)) || user.permissions.includes("*");
}

function hasAnyPermission(user: CurrentUser, permissions: string[] = []) {
  if (hasGlobalAccess(user)) return true;
  return permissions.some((permission) => user.permissions.includes(permission));
}

export function canAccessView(user: CurrentUser | null, view: AppView) {
  if (!user) return false;
  if (view === "dashboard") return true;
  if (hasGlobalAccess(user)) return true;

  const item = navItems.find((navItem) => navItem.key === view);
  if (!item) return false;

  return Boolean(item.roles?.includes(roleCode(user)) || hasAnyPermission(user, item.permissions));
}

export function firstAccessibleView(user: CurrentUser | null): AppView {
  return navItems.find((item) => canAccessView(user, item.key))?.key ?? "dashboard";
}

export function AppShell({
  activeView,
  onViewChange,
  theme,
  onThemeChange,
  children,
}: AppShellProps) {
  const { user, signOut, isPreview } = useAuth();
  const visibleNavItems = navItems.filter((item) => canAccessView(user, item.key));
  const branchScope = user && !hasGlobalAccess(user) ? "Assigned branch" : "All branches";

  function handleThemeChange(value: string) {
    if (isThemeChoice(value)) {
      onThemeChange(value);
    }
  }

  return (
    <div className="erp-app">
      <header className="erp-topbar">
        <div className="erp-topbar__brand">
          <BrandMark />
          <span className="branch-chip">{branchScope}</span>
        </div>

        <div className="erp-topbar__actions">
          {isPreview && <StatusPill tone="warning">Preview mode</StatusPill>}
          <label className="theme-picker">
            <span>Theme</span>
            <select
              value={theme}
              onChange={(event) => handleThemeChange(event.target.value)}
              aria-label="Workspace theme"
            >
              {themeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} — {option.description}
                </option>
              ))}
            </select>
          </label>
          <div className="operator-card">
            <strong>{user?.full_name}</strong>
            <small>{user?.role_name}</small>
          </div>
          <button className="topbar-button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="module-nav" aria-label="Main modules">
        {visibleNavItems.map((item) => (
          <button
            key={item.key}
            className={activeView === item.key ? "is-active" : ""}
            onClick={() => onViewChange(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className={`erp-workspace erp-workspace--${activeView}`}>
        {children}
      </main>
    </div>
  );
}
