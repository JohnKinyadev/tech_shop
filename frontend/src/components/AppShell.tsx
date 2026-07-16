import type { ReactNode } from "react";

import { BrandMark } from "./BrandMark";
import { StatusPill } from "./StatusPill";
import { useAuth } from "../state/auth";

export type AppView =
  | "dashboard"
  | "pos"
  | "catalog"
  | "inventory"
  | "repairs"
  | "purchases"
  | "reports"
  | "roles"
  | "settings";

type AppShellProps = {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  children: ReactNode;
};

const navItems: Array<{ key: AppView; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "pos", label: "Sales / POS" },
  { key: "catalog", label: "Catalog" },
  { key: "inventory", label: "Inventory" },
  { key: "repairs", label: "Repairs" },
  { key: "purchases", label: "Purchases" },
  { key: "reports", label: "Reports" },
  { key: "roles", label: "Staff & Roles" },
  { key: "settings", label: "Settings" },
];

export function AppShell({ activeView, onViewChange, children }: AppShellProps) {
  const { user, signOut, isPreview } = useAuth();

  return (
    <div className="erp-app">
      <header className="erp-topbar">
        <div className="erp-topbar__brand">
          <BrandMark />
          <span className="branch-chip">Main Branch</span>
        </div>

        <div className="erp-topbar__actions">
          {isPreview && <StatusPill tone="warning">Preview mode</StatusPill>}
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
        {navItems.map((item) => (
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
