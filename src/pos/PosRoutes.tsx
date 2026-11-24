import { useLiveQuery } from "dexie-react-hooks";
import { Link, Route, Routes } from "react-router-dom";
import { getMeta } from "@/pos/db";
import { PairingScreen } from "@/pos/PairingScreen";
import { HardwareTestPage } from "@/pos/print/HardwareTestPage";

function PosHome() {
  const estado = useLiveQuery(async () => ({
    deviceId: await getMeta<string>("deviceId"),
    label: await getMeta<string>("deviceLabel"),
  }));

  if (!estado) {
    return (
      <main className="min-h-screen bg-background p-6 text-foreground">
        <h1 className="text-3xl font-bold text-primary">Caja</h1>
        <p className="mt-2 text-muted-foreground">Cargando…</p>
      </main>
    );
  }
  if (!estado.deviceId) return <PairingScreen />;
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <h1 className="text-3xl font-bold text-primary">Caja</h1>
      <p className="mt-2 text-muted-foreground">Caja emparejada: {estado.label}</p>
      <Link to="hardware" className="mt-4 inline-block font-bold text-primary underline">
        Prueba de impresora
      </Link>
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
