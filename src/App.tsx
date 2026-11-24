import { Link, Navigate, Route, Routes } from "react-router-dom";
import { PanelRoutes } from "@/panel/PanelRoutes";
import { PosRoutes } from "@/pos/PosRoutes";

function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-8 p-6">
      <header className="text-center">
        <h1 className="text-5xl font-bold text-primary">POLLO CHILERO</h1>
        <p className="mt-2 text-lg font-bold text-muted-foreground">Orgullo Catracho</p>
      </header>
      <nav className="flex flex-col gap-4 sm:flex-row">
        <Link
          to="/pos"
          className="rounded-lg bg-primary px-10 py-6 text-2xl font-bold text-primary-foreground"
        >
          Caja
        </Link>
        <Link
          to="/panel"
          className="rounded-lg bg-accent px-10 py-6 text-2xl font-bold text-accent-foreground"
        >
          Panel de socios
        </Link>
      </nav>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/pos/*" element={<PosRoutes />} />
      <Route path="/panel/*" element={<PanelRoutes />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
