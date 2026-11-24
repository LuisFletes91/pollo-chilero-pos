import { QueryClientProvider } from "@tanstack/react-query";
import { NavLink, Route, Routes } from "react-router-dom";
import { queryClient } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { DashboardPage } from "@/panel/DashboardPage";
import { PanelGuard, usePanelUser } from "@/panel/PanelGuard";

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
        </nav>
      </header>
      <Routes>
        <Route index element={<DashboardPage />} />
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
