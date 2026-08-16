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
  description: string;
  roles?: string[];
  permissions?: string[];
};

const navItems: NavItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Daily command center for sales, repairs, stock, and alerts.",
  },
  {
    key: "pos",
    label: "Sales / POS",
    description: "Cashier workspace for tills, carts, payments, and receipts.",
    roles: ["admin", "owner", "branch_manager", "cashier"],
    permissions: ["sales.process", "tills.own.view", "tills.manage"],
  },
  {
    key: "catalog",
    label: "Catalog",
    description: "Product, variant, category, brand, pricing, and image setup.",
    roles: ["admin", "owner", "branch_manager", "inventory_manager", "cashier"],
    permissions: ["catalog.view", "catalog.manage"],
  },
  {
    key: "inventory",
    label: "Inventory",
    description: "Live stock balances, serialized units, adjustments, and transfers.",
    roles: ["admin", "owner", "branch_manager", "inventory_manager", "cashier"],
    permissions: [
      "inventory.view",
      "inventory.adjust",
      "inventory.transfer",
      "reports.inventory.view",
    ],
  },
  {
    key: "repairs",
    label: "Repairs",
    description: "Device intake, diagnosis, parts usage, payments, and collection.",
    roles: ["admin", "owner", "branch_manager", "technician", "cashier"],
    permissions: [
      "sales.process",
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
    description: "Supplier setup, purchase orders, approvals, and goods receiving.",
    roles: ["admin", "owner", "branch_manager", "inventory_manager"],
    permissions: ["purchases.create", "purchases.approve", "purchases.receive"],
  },
  {
    key: "expenses",
    label: "Expenses",
    description: "Operating cost capture, category control, and approval workflow.",
    roles: ["admin", "owner", "branch_manager", "accountant"],
    permissions: ["expenses.view", "expenses.manage"],
  },
  {
    key: "reports",
    label: "Reports",
    description: "Owner visibility across sales, stock, repairs, and expenses.",
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
    description: "Staff accounts, assignable roles, and permission design.",
    roles: ["admin", "owner", "branch_manager"],
    permissions: ["staff.manage", "roles.manage"],
  },
  {
    key: "settings",
    label: "Settings",
    description: "Branch profiles, receipt details, tills, and payment readiness.",
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
  const activeItem = navItems.find((item) => item.key === activeView) ?? navItems[0];
  const activeTheme =
    themeOptions.find((option) => option.value === theme) ?? themeOptions[0];
  const branchScope = user && !hasGlobalAccess(user) ? "Assigned branch" : "All branches";

  function handleThemeChange(value: string) {
    if (isThemeChoice(value)) {
      onThemeChange(value);
    }
  }

  return (
    <div className={`erp-app erp-app--${activeView}`}>
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
                  {option.label}: {option.description}
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

      <section className="workspace-context-bar" aria-label="Workspace context">
        <div>
          <span>Current module</span>
          <strong>{activeItem.label}</strong>
          <small>{activeItem.description}</small>
        </div>
        <div>
          <span>Access scope</span>
          <strong>{branchScope}</strong>
          <small>{user?.role_name ?? "Signed-in staff account"}</small>
        </div>
        <div>
          <span>Theme</span>
          <strong>{activeTheme.label}</strong>
          <small>{activeTheme.description}</small>
        </div>
      </section>

      <main className={`erp-workspace erp-workspace--${activeView}`}>
        {children}
      </main>
    </div>
  );
}
