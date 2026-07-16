import { useState } from "react";

import { AppShell, type AppView } from "./components/AppShell";
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

export function App() {
  const { user } = useAuth();
  const [activeView, setActiveView] = useState<AppView>("dashboard");

  if (!user) {
    return <LoginPage />;
  }

  function renderView() {
    if (activeView === "dashboard") return <DashboardPage onNavigate={setActiveView} />;
    if (activeView === "pos") return <PosPage />;
    if (activeView === "catalog") return <CatalogPage />;
    if (activeView === "inventory") return <InventoryPage />;
    if (activeView === "repairs") return <RepairsPage />;
    if (activeView === "purchases") return <PurchasesPage />;
    if (activeView === "expenses") return <ExpensesPage />;
    if (activeView === "reports") return <ReportsPage />;
    if (activeView === "roles") return <RoleStudioPage />;
    if (activeView === "settings") return <SettingsPage />;
    return <DashboardPage onNavigate={setActiveView} />;
  }

  return (
    <AppShell activeView={activeView} onViewChange={setActiveView}>
      {renderView()}
    </AppShell>
  );
}
