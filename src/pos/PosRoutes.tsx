import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { useBackend } from "@/lib/backend";
import { buttonVariants } from "@/lib/utils";
import { CashierLogin } from "@/pos/CashierLogin";
import { getMeta, type StaffRow } from "@/pos/db";
import { exportEmergency } from "@/pos/emergency-export";
import { PairingScreen } from "@/pos/PairingScreen";
import { HardwareTestPage } from "@/pos/print/HardwareTestPage";
import { SaleScreen } from "@/pos/SaleScreen";
import { currentShift } from "@/pos/shift";
import { CloseShiftScreen, OpenShiftScreen } from "@/pos/ShiftScreens";
import { SupervisorActions } from "@/pos/SupervisorActions";
import { startSync } from "@/pos/sync";
import { SyncIndicator } from "@/pos/SyncIndicator";

type Vista = "principal" | "supervisor";

function PosHome() {
  const estado = useLiveQuery(async () => ({
    deviceId: await getMeta<string>("deviceId"),
    label: await getMeta<string>("deviceLabel"),
    shift: (await currentShift()) ?? null,
  }));
  const [cajero, setCajero] = useState<StaffRow | null>(null);
  const [vista, setVista] = useState<Vista>("principal");
  // Se guarda el id del turno al cerrar: el resultado debe seguir visible aunque el turno ya no esté abierto.
  const [cerrando, setCerrando] = useState<string | null>(null);
  const backend = useBackend("pos");
  const emparejada = Boolean(estado?.deviceId);
  useEffect(() => (emparejada ? startSync(backend) : undefined), [emparejada, backend]);

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
  if (cerrando) {
    return (
      <CloseShiftScreen
        shiftId={cerrando}
        onDone={() => {
          setCerrando(null);
          setVista("principal");
          setCajero(null);
        }}
      />
    );
  }
  if (!estado.shift) return <OpenShiftScreen cashier={cajero} />;
  const shift = estado.shift;

  const barra = (
    <nav
      className="flex flex-wrap items-center gap-3 bg-brand-orange p-3 text-foreground"
      aria-label="Turno"
    >
      <span className="font-bold">
        {estado.label} · Atiende: {cajero.displayName}
      </span>
      <button
        type="button"
        className={buttonVariants({ variant: "ghost" })}
        onClick={() => setCerrando(shift.id)}
      >
        Cerrar turno
      </button>
      <button
        type="button"
        className={buttonVariants({ variant: "ghost" })}
        onClick={() => setVista(vista === "supervisor" ? "principal" : "supervisor")}
      >
        {vista === "supervisor" ? "Volver a la venta" : "Acciones de supervisor"}
      </button>
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
      <button
        type="button"
        className={buttonVariants({ variant: "ghost" })}
        onClick={() => void exportEmergency()}
      >
        Exportar respaldo de emergencia
      </button>
      <SyncIndicator />
    </nav>
  );

  return (
    <>
      {barra}
      {vista === "supervisor" ? (
        <SupervisorActions actor={cajero} shiftId={shift.id} />
      ) : (
        <SaleScreen cashier={cajero} shift={shift} />
      )}
    </>
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
