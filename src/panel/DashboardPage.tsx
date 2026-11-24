import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useBackend } from "@/lib/backend";
import { buttonVariants, cn, formatLempiras, toLocalHN } from "@/lib/utils";
import { motivoSchema } from "@/panel/forms";
import { usePanelUser } from "@/panel/PanelGuard";

type Summary = {
  venta_total: number;
  recibos: number;
  ticket_promedio: number;
  por_hora: { hora: number; monto: number }[];
  por_categoria: { categoria: string; monto: number }[];
  por_forma_pago: { efectivo: number; transferencia: number };
  diferencias_caja: { cajero: string; turnos: number; diferencia: number }[];
  merma_piezas: { item: string; unidades: number; valor: number }[];
  anulaciones: { cantidad: number; monto: number };
  reimpresiones: number;
  aperturas_sin_venta: number;
  cajas: { id: string; label: string; last_seen_at: string | null; active: boolean }[];
};
type Alerta = { id: number; kind: string; severity: string; message: string; created_at: string };
export type Transferencia = {
  payment_id: string;
  receipt_code: string;
  amount: number;
  reference: string;
  business_date?: string;
};
type Anulacion = {
  void_id: string;
  receipt_code: string;
  total: number;
  reason: string;
  requested_by: string;
};

export const REFETCH_MS = 60_000;
type Rango = "hoy" | "ayer" | "7dias";

function restarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
}

export function rangoFechas(rango: Rango, ahora = new Date()): { desde: string; hasta: string } {
  const hoy = toLocalHN(ahora).fecha;
  if (rango === "ayer") return { desde: restarDias(hoy, 1), hasta: restarDias(hoy, 1) };
  if (rango === "7dias") return { desde: restarDias(hoy, 6), hasta: hoy };
  return { desde: hoy, hasta: hoy };
}

const L = (n: number) => formatLempiras(Number(n));

function Card(props: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-surface p-4" aria-label={props.title}>
      <h3 className="font-bold text-muted-foreground">{props.title}</h3>
      <div className="mt-2">{props.children}</div>
    </section>
  );
}

function useList<T>(kind: string) {
  const backend = useBackend("panel");
  return useQuery({
    queryKey: ["list", kind],
    queryFn: () => backend.rpc<T[]>("panel_list", { p_kind: kind }),
    refetchInterval: REFETCH_MS,
  });
}

function useDecision(fn: string, invalidar: string) {
  const backend = useBackend("panel");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: Record<string, unknown>) => backend.rpc<void>(fn, args),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["list", invalidar] });
      void qc.invalidateQueries({ queryKey: ["summary"] });
    },
  });
}

function Estado(props: {
  q: { isPending: boolean; isError: boolean };
  vacio: boolean;
  textoVacio: string;
}) {
  if (props.q.isPending) return <p>Cargando…</p>;
  if (props.q.isError)
    return (
      <p role="alert" className="text-destructive">
        No se pudo cargar
      </p>
    );
  if (props.vacio) return <p className="text-muted-foreground">{props.textoVacio}</p>;
  return null;
}

export function TransferenciaItem(props: { t: Transferencia; supervisor: boolean }) {
  const { t, supervisor } = props;
  const confirmar = useDecision("confirm_transfer", "transferencias_pendientes");
  const rechazar = useDecision("reject_transfer", "transferencias_pendientes");
  const [motivo, setMotivo] = useState("");
  const motivoOk = motivoSchema.safeParse(motivo);
  return (
    <li className="space-y-2 border-b border-border py-2">
      <p>
        {t.receipt_code} · {L(t.amount)} · Ref. {t.reference}
      </p>
      {supervisor && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonVariants()}
            disabled={confirmar.isPending}
            onClick={() => confirmar.mutate({ p_payment_id: t.payment_id })}
          >
            Confirmar
          </button>
          <input
            aria-label={`Motivo de rechazo ${t.receipt_code}`}
            className="rounded-lg border border-border p-2"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <button
            type="button"
            className={buttonVariants({ variant: "danger" })}
            disabled={!motivoOk.success || rechazar.isPending}
            onClick={() =>
              motivoOk.success &&
              rechazar.mutate({ p_payment_id: t.payment_id, p_reason: motivoOk.data })
            }
          >
            Rechazar
          </button>
        </div>
      )}
    </li>
  );
}

function AnulacionItem(props: { a: Anulacion; supervisor: boolean }) {
  const { a, supervisor } = props;
  const decidir = useDecision("decide_void", "anulaciones_pendientes");
  return (
    <li className="space-y-2 border-b border-border py-2">
      <p>
        {a.receipt_code} · {L(a.total)} · {a.reason} · pidió {a.requested_by}
      </p>
      {supervisor && (
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonVariants()}
            disabled={decidir.isPending}
            onClick={() => decidir.mutate({ p_void_id: a.void_id, p_approve: true })}
          >
            Aprobar
          </button>
          <button
            type="button"
            className={buttonVariants({ variant: "danger" })}
            disabled={decidir.isPending}
            onClick={() => decidir.mutate({ p_void_id: a.void_id, p_approve: false })}
          >
            Rechazar
          </button>
        </div>
      )}
    </li>
  );
}

function Pendientes(props: { supervisor: boolean }) {
  const alertas = useList<Alerta>("alertas");
  const transf = useList<Transferencia>("transferencias_pendientes");
  const anul = useList<Anulacion>("anulaciones_pendientes");
  const reconocer = useDecision("ack_alert", "alertas");
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card title="Alertas abiertas">
        <Estado q={alertas} vacio={alertas.data?.length === 0} textoVacio="Sin alertas abiertas" />
        <ul>
          {alertas.data?.map((a) => (
            <li key={a.id} className="space-y-1 border-b border-border py-2">
              <p>
                <span className="font-bold">{a.kind}</span> · {a.message}
              </p>
              {props.supervisor && (
                <button
                  type="button"
                  className={buttonVariants({ variant: "ghost" })}
                  onClick={() => reconocer.mutate({ p_alert_id: a.id })}
                >
                  Reconocer
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Transferencias por confirmar">
        <Estado
          q={transf}
          vacio={transf.data?.length === 0}
          textoVacio="Sin transferencias pendientes"
        />
        <ul>
          {transf.data?.map((t) => (
            <TransferenciaItem key={t.payment_id} t={t} supervisor={props.supervisor} />
          ))}
        </ul>
      </Card>
      <Card title="Anulaciones por decidir">
        <Estado q={anul} vacio={anul.data?.length === 0} textoVacio="Sin anulaciones pendientes" />
        <ul>
          {anul.data?.map((a) => (
            <AnulacionItem key={a.void_id} a={a} supervisor={props.supervisor} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Resumen(props: { s: Summary }) {
  const { s } = props;
  const maxHora = Math.max(1, ...s.por_hora.map((h) => Number(h.monto)));
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card title="Venta total">
        <p className="text-3xl font-bold">{L(s.venta_total)}</p>
      </Card>
      <Card title="Recibos">
        <p className="text-3xl font-bold">{s.recibos}</p>
      </Card>
      <Card title="Ticket promedio">
        <p className="text-3xl font-bold">{L(s.ticket_promedio)}</p>
      </Card>
      <Card title="Efectivo vs transferencia">
        <p>Efectivo: {L(s.por_forma_pago.efectivo)}</p>
        <p>Transferencia: {L(s.por_forma_pago.transferencia)}</p>
      </Card>
      <Card title="Venta por hora">
        <ul className="space-y-1">
          {s.por_hora.map((h) => (
            <li key={h.hora} className="flex items-center gap-2 text-sm">
              <span className="w-10">{String(h.hora).padStart(2, "0")}:00</span>
              <span
                className="h-3 rounded bg-primary"
                style={{ width: `${(Number(h.monto) / maxHora) * 100}%` }}
              />
              <span>{L(h.monto)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Por categoría">
        {s.por_categoria.map((c) => (
          <p key={c.categoria}>
            {c.categoria}: {L(c.monto)}
          </p>
        ))}
      </Card>
      <Card title="Diferencias de caja">
        {s.diferencias_caja.length === 0 && (
          <p className="text-muted-foreground">Sin turnos cerrados</p>
        )}
        {s.diferencias_caja.map((d) => (
          <p
            key={d.cajero}
            className={cn(Number(d.diferencia) !== 0 && "font-bold text-destructive")}
          >
            {d.cajero} ({d.turnos} turnos): {L(d.diferencia)}
          </p>
        ))}
      </Card>
      <Card title="Merma de piezas">
        {s.merma_piezas.length === 0 && (
          <p className="text-muted-foreground">Sin merma registrada</p>
        )}
        {s.merma_piezas.map((m) => (
          <p key={m.item}>
            {m.item}: {m.unidades} u · {L(m.valor)}
          </p>
        ))}
      </Card>
      <Card title="Controles">
        <p>
          Anulaciones: {s.anulaciones.cantidad} ({L(s.anulaciones.monto)})
        </p>
        <p>Reimpresiones: {s.reimpresiones}</p>
        <p>Aperturas sin venta: {s.aperturas_sin_venta}</p>
      </Card>
      <Card title="Estado de las cajas">
        {s.cajas.map((c) => (
          <p key={c.id}>
            {c.label}:{" "}
            {c.last_seen_at
              ? `última sincronización ${toLocalHN(c.last_seen_at).fecha} ${toLocalHN(c.last_seen_at).hora}`
              : "sin sincronizar"}
            {!c.active && " (inactiva)"}
          </p>
        ))}
      </Card>
    </div>
  );
}

export function DashboardPage() {
  const backend = useBackend("panel");
  const user = usePanelUser();
  const [rango, setRango] = useState<Rango>("hoy");
  const { desde, hasta } = rangoFechas(rango);
  const summary = useQuery({
    queryKey: ["summary", desde, hasta],
    queryFn: () => backend.rpc<Summary>("panel_summary", { p_from: desde, p_to: hasta }),
    refetchInterval: REFETCH_MS,
  });

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Rango" className="flex gap-2">
        {(
          [
            ["hoy", "Hoy"],
            ["ayer", "Ayer"],
            ["7dias", "7 días"],
          ] as const
        ).map(([r, label]) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={rango === r}
            className={buttonVariants({ variant: rango === r ? "secondary" : "ghost" })}
            onClick={() => setRango(r)}
          >
            {label}
          </button>
        ))}
      </div>
      {summary.isPending && <p>Cargando…</p>}
      {summary.isError && (
        <p role="alert" className="text-destructive">
          No se pudo cargar el resumen
        </p>
      )}
      {summary.data && <Resumen s={summary.data} />}
      <Pendientes supervisor={user.role === "supervisor"} />
    </div>
  );
}
