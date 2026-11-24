import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { buttonVariants } from "@/lib/utils";
import { CashierLogin } from "@/pos/CashierLogin";
import { getMeta, type StaffRow } from "@/pos/db";
import { PairingScreen } from "@/pos/PairingScreen";
import { HardwareTestPage } from "@/pos/print/HardwareTestPage";

function PosHome() {
  const estado = useLiveQuery(async () => ({
    deviceId: await getMeta<string>("deviceId"),
    label: await getMeta<string>("deviceLabel"),
  }));
  const [cajero, setCajero] = useState<StaffRow | null>(null);

  if (!estado) {
    return (
      <main className="min-h-screen bg-background p-6 text-foreground">
        <h1 className="text-3xl font-bold text-primary">Caja</h1>
        <p className="mt-2 text-muted-foreground">Cargando…</p>
      </main>
    );
  }
  if (!estado.deviceId) return <PairingScreen />;
  if (!cajero) return <CashierLogin onLogin={setCajero} />;
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <h1 className="text-3xl font-bold text-primary">Caja — {estado.label}</h1>
      <p className="mt-2 text-lg">Atiende: {cajero.displayName}</p>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          className={buttonVariants({ variant: "ghost" })}
          onClick={() => setCajero(null)}
        >
          Cambiar cajero
        </button>
        <Link to="hardware" className={buttonVariants({ variant: "ghost" })}>
          Prueba de impresora
        </Link>
      </div>
    </main>
  );
}

export function PosRoutes() {
  return (
    <Routes>
      <Route index element={<PosHome />} />
      <Route path="hardware" element={<HardwareTestPage />} />
    </Routes>
  );
}
