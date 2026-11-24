import { QueryClientProvider } from "@tanstack/react-query";
import { NavLink, Route, Routes } from "react-router-dom";
import { queryClient } from "@/lib/backend";
import { MarcaBanda } from "@/lib/marca";
import { cn } from "@/lib/utils";
import { AdminPage } from "@/panel/AdminPage";
import { DashboardPage } from "@/panel/DashboardPage";
import { DayCloseWizard } from "@/panel/DayCloseWizard";
import { InventoryPage } from "@/panel/InventoryPage";
import { PanelGuard, usePanelUser } from "@/panel/PanelGuard";
import { ReportsPage } from "@/panel/ReportsPage";

const enlace = ({ isActive }: { isActive: boolean }) =>
  cn(
    "rounded-lg border-2 px-3 py-2 font-bold transition-opacity duration-150 ease-out",
    isActive
      ? "border-primary bg-accent text-accent-foreground"
      : "border-primary/30 bg-surface text-foreground",
  );

function PanelLayout() {
  const user = usePanelUser();
  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-4 bg-background p-4 text-foreground">
      <header className="space-y-3">
        <MarcaBanda className="-mx-4 -mt-4 sm:rounded-b-xl">
          <div className="ml-auto text-right">
            <h1 className="text-2xl font-bold">Panel de socios</h1>
            <p className="text-sm font-bold">
              {user.displayName} · {user.role === "supervisor" ? "Supervisor" : "Socio"}
            </p>
          </div>
        </MarcaBanda>
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
