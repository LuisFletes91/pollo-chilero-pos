import { QueryClientProvider } from "@tanstack/react-query";
import { NavLink, Route, Routes } from "react-router-dom";
import { queryClient } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { AdminPage } from "@/panel/AdminPage";
import { DashboardPage } from "@/panel/DashboardPage";
import { DayCloseWizard } from "@/panel/DayCloseWizard";
import { InventoryPage } from "@/panel/InventoryPage";
import { PanelGuard, usePanelUser } from "@/panel/PanelGuard";
import { ReportsPage } from "@/panel/ReportsPage";

const enlace = ({ isActive }: { isActive: boolean }) =>
  cn(
    "rounded-lg px-3 py-2 font-bold",
    isActive ? "bg-accent text-accent-foreground" : "text-foreground",
  );

function PanelLayout() {
  const user = usePanelUser();
  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-4 bg-background p-4 text-foreground">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-primary">Panel de socios</h1>
        <p className="text-muted-foreground">
          {user.displayName} · {user.role === "supervisor" ? "Supervisor" : "Socio"}
        </p>
        <nav aria-label="Panel" className="flex flex-wrap gap-2">
          <NavLink to="/panel" end className={enlace}>
            Tablero
          </NavLink>
          <NavLink to="/panel/inventario" className={enlace}>
            Inventario
          </NavLink>
          {user.role === "supervisor" && (
            <NavLink to="/panel/cierre" className={enlace}>
              Cierre del día
            </NavLink>
          )}
          <NavLink to="/panel/reportes" className={enlace}>
            Reportes
          </NavLink>
          {user.role === "supervisor" && (
            <NavLink to="/panel/administracion" className={enlace}>
              Administración
            </NavLink>
          )}
        </nav>
      </header>
      <Routes>
        <Route index element={<DashboardPage />} />
        <Route path="inventario" element={<InventoryPage />} />
        <Route path="administracion" element={<AdminPage />} />
        <Route
          path="cierre"
          element={
            user.role === "supervisor" ? (
              <DayCloseWizard />
            ) : (
              <p role="alert">Solo los supervisores cierran el día.</p>
            )
          }
        />
        <Route path="reportes" element={<ReportsPage />} />
      </Routes>
    </main>
  );
}

export function PanelRoutes() {
  return (
    <QueryClientProvider client={queryClient}>
      <PanelGuard>
        <PanelLayout />
      </PanelGuard>
    </QueryClientProvider>
  );
}
