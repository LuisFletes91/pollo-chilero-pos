import { Route, Routes } from "react-router-dom";

function PanelHome() {
  return (
    <main className="mx-auto min-h-screen max-w-5xl bg-background p-6 text-foreground">
      <h1 className="text-3xl font-bold text-primary">Panel de socios</h1>
      <p className="mt-2 text-muted-foreground">Panel listo para configurarse</p>
    </main>
  );
}

export function PanelRoutes() {
  return (
    <Routes>
      <Route index element={<PanelHome />} />
    </Routes>
  );
}
