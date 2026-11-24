import { Link, Navigate, Route, Routes } from "react-router-dom";
import { LOGO_URL } from "@/lib/marca";
import { PanelRoutes } from "@/panel/PanelRoutes";
import { PosRoutes } from "@/pos/PosRoutes";

function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-brand-orange p-4 text-foreground">
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-xl border-8 border-primary bg-surface p-6 shadow-lg">
        <img
          src={LOGO_URL}
          alt="Logotipo de Pollo Chilero con el gallo"
          width={192}
          height={258}
          className="h-64 w-48 rounded-xl object-cover"
        />
        <header className="text-center">
          <h1 className="rounded-xl bg-accent px-4 py-1 text-4xl font-bold text-primary-strong">
            POLLO CHILERO
          </h1>
          <p className="mt-2 text-lg font-bold italic text-primary">Orgullo Catracho</p>
        </header>
        <nav className="flex w-full flex-col gap-3">
          <Link
            to="/pos"
            className="rounded-lg bg-primary px-10 py-5 text-center text-2xl font-bold text-primary-foreground"
          >
            Caja
          </Link>
          <Link
            to="/panel"
            className="rounded-lg border-2 border-primary bg-accent px-10 py-5 text-center text-2xl font-bold text-accent-foreground"
          >
            Panel de socios
          </Link>
        </nav>
      </div>
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
