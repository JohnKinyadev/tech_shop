import { useEffect, useState } from "react";

import { AppShell, canAccessView, firstAccessibleView, type AppView } from "./components/AppShell";
import { CatalogPage } from "./pages/CatalogPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ExpensesPage } from "./pages/ExpensesPage";
import { InventoryPage } from "./pages/InventoryPage";
import { LoginPage } from "./pages/LoginPage";
import { PosPage } from "./pages/PosPage";
import { PurchasesPage } from "./pages/PurchasesPage";
import { RepairsPage } from "./pages/RepairsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { RoleStudioPage } from "./pages/RoleStudioPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useAuth } from "./state/auth";
import { getStoredTheme, persistTheme, type ThemeChoice } from "./state/theme";

export function App() {
  const { user } = useAuth();
  const [activeView, setActiveView] = useState<AppView>("dashboard");
  const [theme, setTheme] = useState<ThemeChoice>(getStoredTheme);
  const safeView = user && canAccessView(user, activeView) ? activeView : firstAccessibleView(user);

  useEffect(() => {
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (user && activeView !== safeView) {
      setActiveView(safeView);
    }
  }, [activeView, safeView, user]);

  if (!user) {
    return <LoginPage />;
  }

  function renderView(view: AppView) {
    if (view === "dashboard") return <DashboardPage onNavigate={setActiveView} />;
    if (view === "pos") return <PosPage />;
    if (view === "catalog") return <CatalogPage />;
    if (view === "inventory") return <InventoryPage />;
    if (view === "repairs") return <RepairsPage />;
    if (view === "purchases") return <PurchasesPage />;
    if (view === "expenses") return <ExpensesPage />;
    if (view === "reports") return <ReportsPage />;
    if (view === "roles") return <RoleStudioPage />;
    if (view === "settings") return <SettingsPage />;
    return <DashboardPage onNavigate={setActiveView} />;
  }

  return (
    <AppShell
      activeView={safeView}
      onViewChange={setActiveView}
      theme={theme}
      onThemeChange={setTheme}
    >
      {renderView(safeView)}
    </AppShell>
  );
}
