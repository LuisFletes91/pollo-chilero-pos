import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { useBackend } from "@/lib/backend";
import { GALLO_URL, MarcaBanda } from "@/lib/marca";
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
        <MarcaBanda className="-mx-6 -mt-6 mb-6" />
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

  const boton =
    "inline-flex min-h-11 items-center rounded-lg border border-white/70 px-3 py-2 font-bold text-primary-foreground transition-opacity duration-150 ease-out hover:opacity-90";
  const barra = (
    <nav
      className="flex flex-wrap items-center gap-3 border-b-4 border-accent bg-primary p-3 text-primary-foreground"
      aria-label="Turno"
    >
      <img
        src={GALLO_URL}
        alt=""
        width={48}
        height={38}
        className="h-10 w-12 rounded-lg bg-accent object-cover"
      />
      <span className="font-bold">
        <span className="text-accent">POLLO CHILERO</span> · {estado.label} · Atiende:{" "}
        {cajero.displayName}
      </span>
      <button type="button" className={boton} onClick={() => setCerrando(shift.id)}>
        Cerrar turno
      </button>
      <button
        type="button"
        className={boton}
        onClick={() => setVista(vista === "supervisor" ? "principal" : "supervisor")}
      >
        {vista === "supervisor" ? "Volver a la venta" : "Acciones de supervisor"}
      </button>
      <button type="button" className={boton} onClick={() => setCajero(null)}>
        Cambiar cajero
      </button>
      <Link to="hardware" className={boton}>
        Prueba de impresora
      </Link>
      <button type="button" className={boton} onClick={() => void exportEmergency()}>
        Exportar respaldo de emergencia
      </button>
      <div className="rounded-lg bg-surface px-2 py-1 text-foreground">
        <SyncIndicator />
      </div>
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
