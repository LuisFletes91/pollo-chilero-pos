import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { buttonVariants, formatLempiras } from "@/lib/utils";
import { db, type SaleRow, type StaffRow } from "@/pos/db";
import { internalConsumption, openDrawer, requestVoid } from "@/pos/shift";
import { SupervisorPin } from "@/pos/SupervisorPin";

const PIEZAS = ["ALA", "PIERNA", "MUSLO", "PECHUGA", "PAPA-PERS"];
const ESTADO_VENTA: Record<SaleRow["status"], string> = {
  registrada: "Registrada",
  anulacion_solicitada: "Anulación solicitada",
  anulada: "Anulada",
};

function useResultado() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(fn: () => Promise<void>, ok: string) {
    try {
      await fn();
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }
  const view = msg && (
    <p
      role={msg.ok ? "status" : "alert"}
      className={msg.ok ? "text-success" : "font-bold text-destructive"}
    >
      {msg.text}
    </p>
  );
  return { run, view };
}

function VoidForm({ actor, sale }: { actor: StaffRow; sale: SaleRow }) {
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState<StaffRow | null>(null);
  const { run, view } = useResultado();
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface p-3">
      <label className="flex flex-col gap-1">
        Motivo de anulación de {sale.receiptCode}
        <input
          className="rounded-lg border border-border p-2"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <SupervisorPin
        label="PIN de supervisor (opcional: sin él queda pendiente)"
        onChange={setApprover}
      />
      <button
        type="button"
        className={buttonVariants({ variant: "danger" })}
        onClick={() =>
          run(
            () => requestVoid(actor, sale, reason, approver),
            approver ? "Venta anulada" : "Anulación solicitada",
          )
        }
      >
        Solicitar anulación
      </button>
      {view}
    </div>
  );
}

export function SupervisorActions({ actor, shiftId }: { actor: StaffRow; shiftId: string }) {
  const ventas = useLiveQuery(() =>
    db.sales.orderBy("receiptNumber").reverse().limit(20).toArray(),
  );
  const bebidas = useLiveQuery(() => db.products.where("categoryCode").equals("BE").toArray());
  const [elegida, setElegida] = useState<string | null>(null);
  const [motivoGaveta, setMotivoGaveta] = useState("");
  const gaveta = useResultado();
  const [item, setItem] = useState("ALA");
  const [qty, setQty] = useState(1);
  const [motivoConsumo, setMotivoConsumo] = useState("");
  const [aprobador, setAprobador] = useState<StaffRow | null>(null);
  const consumo = useResultado();

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <h1 className="text-3xl font-bold text-primary">Caja — Acciones de supervisor</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-bold">Últimas ventas</h2>
          {(ventas ?? []).map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-2">
              <div className="flex justify-between">
                <span className="font-bold">{s.receiptCode}</span>
                <span>{formatLempiras(s.total)}</span>
              </div>
              <p className="text-sm text-muted-foreground">{ESTADO_VENTA[s.status]}</p>
              {s.status === "registrada" &&
                (elegida === s.id ? (
                  <VoidForm actor={actor} sale={s} />
                ) : (
                  <button
                    type="button"
                    className={buttonVariants({ variant: "ghost" })}
                    onClick={() => setElegida(s.id)}
                  >
                    Solicitar anulación
                  </button>
                ))}
            </div>
          ))}
          {ventas && ventas.length === 0 && (
            <p className="text-muted-foreground">Aún no hay ventas.</p>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-bold">Apertura de gaveta sin venta</h2>
          <p className="text-sm text-muted-foreground">
            La gaveta se abre a mano; aquí queda constancia de quién y por qué.
          </p>
          <label className="flex flex-col gap-1">
            Motivo de apertura
            <input
              className="rounded-lg border border-border p-2"
              value={motivoGaveta}
              onChange={(e) => setMotivoGaveta(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={buttonVariants({ variant: "secondary" })}
            onClick={() =>
              gaveta.run(() => openDrawer(actor, shiftId, motivoGaveta), "Apertura registrada")
            }
          >
            Registrar apertura de gaveta sin venta
          </button>
          {gaveta.view}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-bold">Consumo interno</h2>
          <label className="flex flex-col gap-1">
            Ítem
            <select
              className="rounded-lg border border-border p-2"
              value={item}
              onChange={(e) => setItem(e.target.value)}
            >
              {PIEZAS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              {(bebidas ?? []).map((b) => (
                <option key={b.code} value={b.code}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Cantidad
            <input
              type="number"
              min={1}
              className="rounded-lg border border-border p-2"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1">
            Motivo del consumo
            <input
              className="rounded-lg border border-border p-2"
              value={motivoConsumo}
              onChange={(e) => setMotivoConsumo(e.target.value)}
            />
          </label>
          <SupervisorPin onChange={setAprobador} />
          <button
            type="button"
            className={buttonVariants({ variant: "secondary" })}
            onClick={() =>
              consumo.run(
                () => internalConsumption(actor, item, qty, motivoConsumo, aprobador),
                "Consumo registrado",
              )
            }
          >
            Registrar consumo interno
          </button>
          {consumo.view}
        </section>
      </div>
    </main>
  );
}
