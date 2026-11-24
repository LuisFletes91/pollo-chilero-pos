import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { buttonVariants, formatLempiras } from "@/lib/utils";
import type { StaffRow } from "@/pos/db";
import {
  closeShift,
  countTotal,
  DEFAULT_DENOMINATIONS,
  denominations,
  openShift,
  type Counts,
} from "@/pos/shift";
import { SupervisorPin } from "@/pos/SupervisorPin";

function DenominationRows({
  counts,
  setCounts,
}: {
  counts: Counts;
  setCounts: (c: Counts) => void;
}) {
  const dens = useLiveQuery(denominations) ?? DEFAULT_DENOMINATIONS;
  const cambiar = (d: number, delta: number) => {
    const k = String(d);
    setCounts({ ...counts, [k]: Math.max(0, (counts[k] ?? 0) + delta) });
  };
  return (
    <div className="grid gap-2">
      {dens.map((d) => {
        const k = String(d);
        return (
          <div key={k} className="flex items-center gap-3">
            <span className="w-24 text-right font-bold">{formatLempiras(d)}</span>
            <button
              type="button"
              aria-label={`Quitar ${formatLempiras(d)}`}
              className={buttonVariants({ variant: "ghost", size: "md" })}
              onClick={() => cambiar(d, -1)}
            >
              −
            </button>
            <span
              className="w-10 text-center text-xl"
              aria-label={`Cantidad de ${formatLempiras(d)}`}
            >
              {counts[k] ?? 0}
            </span>
            <button
              type="button"
              aria-label={`Agregar ${formatLempiras(d)}`}
              className={buttonVariants({ variant: "secondary", size: "md" })}
              onClick={() => cambiar(d, 1)}
            >
              +
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function OpenShiftScreen({ cashier }: { cashier: StaffRow }) {
  const [counts, setCounts] = useState<Counts>({});
  const [approver, setApprover] = useState<StaffRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function abrir() {
    setError(null);
    try {
      if (!approver) throw new Error("Se requiere otro supervisor");
      await openShift(cashier, approver, counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <h1 className="text-3xl font-bold text-primary">Caja — Abrir turno</h1>
      <p className="mt-2">
        Cajero: {cashier.displayName}. Cuente el fondo inicial por denominación.
      </p>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <DenominationRows counts={counts} setCounts={setCounts} />
        <div className="flex flex-col gap-4">
          <p className="text-3xl font-bold">Fondo: {formatLempiras(countTotal(counts))}</p>
          <SupervisorPin onChange={setApprover} />
          <button type="button" className={buttonVariants({ size: "lg" })} onClick={abrir}>
            Abrir turno
          </button>
          {error && (
            <p role="alert" className="font-bold text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

export function CloseShiftScreen({ shiftId, onDone }: { shiftId: string; onDone: () => void }) {
  const [counts, setCounts] = useState<Counts>({});
  const [resultado, setResultado] = useState<Awaited<ReturnType<typeof closeShift>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enviar() {
    setError(null);
    try {
      setResultado(await closeShift(shiftId, counts));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <h1 className="text-3xl font-bold text-primary">Caja — Cerrar turno</h1>
      {!resultado ? (
        <>
          <p className="mt-2">Conteo ciego: cuente el efectivo de la gaveta por denominación.</p>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <DenominationRows counts={counts} setCounts={setCounts} />
            <div className="flex flex-col gap-4">
              <p className="text-3xl font-bold">Contado: {formatLempiras(countTotal(counts))}</p>
              <button type="button" className={buttonVariants({ size: "lg" })} onClick={enviar}>
                Enviar conteo
              </button>
              {error && (
                <p role="alert" className="font-bold text-destructive">
                  {error}
                </p>
              )}
            </div>
          </div>
        </>
      ) : (
        <section
          className="mt-6 flex max-w-md flex-col gap-2 text-xl"
          aria-label="Resultado del cierre"
        >
          <p>Esperado: {formatLempiras(resultado.esperado)}</p>
          <p>Contado: {formatLempiras(resultado.contado)}</p>
          <p
            className={
              resultado.diferencia === 0 ? "font-bold text-success" : "font-bold text-destructive"
            }
          >
            Diferencia: {formatLempiras(resultado.diferencia)}
          </p>
          <button type="button" className={buttonVariants({ size: "lg" })} onClick={onDone}>
            Listo
          </button>
        </section>
      )}
    </main>
  );
}
