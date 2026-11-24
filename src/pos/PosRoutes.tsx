import { Route, Routes } from "react-router-dom";

function PosHome() {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <h1 className="text-3xl font-bold text-primary">Caja</h1>
      <p className="mt-2 text-muted-foreground">Caja lista para configurarse</p>
    </main>
  );
}

export function PosRoutes() {
  return (
    <Routes>
      <Route index element={<PosHome />} />
    </Routes>
  );
}
