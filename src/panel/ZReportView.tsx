import type { ReactNode } from "react";
import { downloadCsv, toCsv } from "@/lib/csv";
import { buttonVariants, formatLempiras, toLocalHN } from "@/lib/utils";

type Linea = { item: string; unidades: number; valor: number };
export type ZReport = {
  fecha: string;
  recibos: { primero: string | null; ultimo: string | null; cantidad: number };
  ventas_total: number;
  ventas_por_forma_pago: {
    efectivo: number;
    transferencia_confirmada: number;
    transferencia_rechazada: number;
  };
  ventas_por_categoria: { categoria: string; unidades: number; monto: number }[];
  isv_incluido: {
    gravado_15: number;
    isv_15: number;
    gravado_18: number;
    isv_18: number;
    exento: number;
  };
  anulaciones: { cantidad: number; monto: number };
  reimpresiones: number;
  aperturas_sin_venta: number;
  consumo_interno: Linea[];
  efectivo: {
    esperado: number;
    contado: number;
    diferencia: number;
    justificacion: string | null;
    por_turno: {
      turno_id: string;
      cajero: string;
      esperado: number;
      contado: number;
      diferencia: number;
    }[];
  };
  transferencias: {
    confirmadas: { cantidad: number; monto: number };
    rechazadas: { cantidad: number; monto: number };
  };
  merma: Linea[];
  ingreso: { tipo: "entrega_socio" | "deposito_banco"; monto: number; recibe: string } | null;
  firmado_por: string | null;
  firmado_en: string | null;
};

const L = (n: number | null | undefined) => formatLempiras(Number(n ?? 0));
const INGRESO = { entrega_socio: "Entrega a socio", deposito_banco: "Depósito en banco" } as const;

function Fila(props: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-1">
      <dt className="text-muted-foreground">{props.k}</dt>
      <dd className="text-right font-bold">{props.v}</dd>
    </div>
  );
}

function Bloque(props: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={props.title}
      className="rounded-xl border-t-4 border-primary bg-surface p-4 shadow-sm"
    >
      <h3 className="mb-2 font-bold">{props.title}</h3>
      <dl>{props.children}</dl>
    </section>
  );
}

/** Filas clave/valor para exportar el Z a CSV. */
export function zRows(z: ZReport, hash?: string | null): { campo: string; valor: string }[] {
  const r: { campo: string; valor: string }[] = [];
  const add = (campo: string, valor: unknown) => r.push({ campo, valor: String(valor ?? "") });
  add("Fecha", z.fecha);
  add("Primer recibo", z.recibos.primero);
  add("Último recibo", z.recibos.ultimo);
  add("Cantidad de recibos", z.recibos.cantidad);
  add("Ventas total", z.ventas_total);
  add("Efectivo", z.ventas_por_forma_pago.efectivo);
  add("Transferencia confirmada", z.ventas_por_forma_pago.transferencia_confirmada);
  add("Transferencia rechazada", z.ventas_por_forma_pago.transferencia_rechazada);
  for (const c of z.ventas_por_categoria)
    add(`Categoría ${c.categoria}`, `${c.unidades} u · ${c.monto}`);
  add("Gravado 15%", z.isv_incluido.gravado_15);
  add("ISV 15%", z.isv_incluido.isv_15);
  add("Gravado 18%", z.isv_incluido.gravado_18);
  add("ISV 18%", z.isv_incluido.isv_18);
  add("Exento", z.isv_incluido.exento);
  add("Anulaciones", `${z.anulaciones.cantidad} · ${z.anulaciones.monto}`);
  add("Reimpresiones", z.reimpresiones);
  add("Aperturas sin venta", z.aperturas_sin_venta);
  for (const c of z.consumo_interno)
    add(`Consumo interno ${c.item}`, `${c.unidades} u · ${c.valor}`);
  add("Efectivo esperado", z.efectivo.esperado);
  add("Efectivo contado", z.efectivo.contado);
  add("Diferencia", z.efectivo.diferencia);
  add("Justificación", z.efectivo.justificacion);
  for (const t of z.efectivo.por_turno)
    add(
      `Turno ${t.cajero}`,
      `esperado ${t.esperado} · contado ${t.contado} · diferencia ${t.diferencia}`,
    );
  for (const m of z.merma) add(`Merma ${m.item}`, `${m.unidades} u · ${m.valor}`);
  if (z.ingreso)
    add(`Ingreso ${INGRESO[z.ingreso.tipo]}`, `${z.ingreso.monto} · recibe ${z.ingreso.recibe}`);
  add("Firmado por", z.firmado_por);
  add("Firmado en", z.firmado_en);
  add("z_hash", hash);
  return r;
}

export function ZReportView(props: { z: ZReport; hash?: string | null }) {
  const { z, hash } = props;
  const firmado = z.firmado_en ? toLocalHN(z.firmado_en) : null;
  return (
    <article aria-label={`Reporte Z ${z.fecha}`} className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-2xl font-bold text-primary">Reporte Z · {z.fecha}</h2>
        <button
          type="button"
          className={buttonVariants({ variant: "ghost" })}
          onClick={() =>
            downloadCsv(
              `reporte-z-${z.fecha}.csv`,
              toCsv(zRows(z, hash), [
                { key: "campo", header: "Campo" },
                { key: "valor", header: "Valor" },
              ]),
            )
          }
        >
          Exportar Z (CSV)
        </button>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <Bloque title="Recibos">
          <Fila k="Primero" v={z.recibos.primero ?? "—"} />
          <Fila k="Último" v={z.recibos.ultimo ?? "—"} />
          <Fila k="Cantidad" v={z.recibos.cantidad} />
        </Bloque>
        <Bloque title="Ventas por forma de pago">
          <Fila k="Total" v={L(z.ventas_total)} />
          <Fila k="Efectivo" v={L(z.ventas_por_forma_pago.efectivo)} />
          <Fila
            k="Transferencia confirmada"
            v={L(z.ventas_por_forma_pago.transferencia_confirmada)}
          />
          <Fila
            k="Transferencia rechazada"
            v={L(z.ventas_por_forma_pago.transferencia_rechazada)}
          />
        </Bloque>
        <Bloque title="Ventas por categoría">
          {z.ventas_por_categoria.map((c) => (
            <Fila key={c.categoria} k={`${c.categoria} (${c.unidades})`} v={L(c.monto)} />
          ))}
        </Bloque>
        <Bloque title="ISV incluido">
          <Fila k="Gravado 15 %" v={L(z.isv_incluido.gravado_15)} />
          <Fila k="ISV 15 %" v={L(z.isv_incluido.isv_15)} />
          <Fila k="Gravado 18 %" v={L(z.isv_incluido.gravado_18)} />
          <Fila k="ISV 18 %" v={L(z.isv_incluido.isv_18)} />
          <Fila k="Exento" v={L(z.isv_incluido.exento)} />
        </Bloque>
        <Bloque title="Controles">
          <Fila k="Anulaciones" v={`${z.anulaciones.cantidad} · ${L(z.anulaciones.monto)}`} />
          <Fila k="Reimpresiones" v={z.reimpresiones} />
          <Fila k="Aperturas sin venta" v={z.aperturas_sin_venta} />
          {z.consumo_interno.map((c) => (
            <Fila key={c.item} k={`Consumo interno ${c.item} (${c.unidades})`} v={L(c.valor)} />
          ))}
        </Bloque>
        <Bloque title="Efectivo">
          <Fila k="Esperado" v={L(z.efectivo.esperado)} />
          <Fila k="Contado" v={L(z.efectivo.contado)} />
          <Fila k="Diferencia" v={L(z.efectivo.diferencia)} />
          {z.efectivo.justificacion && <Fila k="Justificación" v={z.efectivo.justificacion} />}
          {z.efectivo.por_turno.map((t) => (
            <Fila
              key={t.turno_id}
              k={`Turno de ${t.cajero}`}
              v={`${L(t.esperado)} / ${L(t.contado)} / ${L(t.diferencia)}`}
            />
          ))}
        </Bloque>
        <Bloque title="Transferencias">
          <Fila
            k="Confirmadas"
            v={`${z.transferencias.confirmadas.cantidad} · ${L(z.transferencias.confirmadas.monto)}`}
          />
          <Fila
            k="Rechazadas"
            v={`${z.transferencias.rechazadas.cantidad} · ${L(z.transferencias.rechazadas.monto)}`}
          />
        </Bloque>
        <Bloque title="Merma">
          {z.merma.length === 0 && <Fila k="Sin merma" v="—" />}
          {z.merma.map((m) => (
            <Fila key={m.item} k={`${m.item} (${m.unidades})`} v={L(m.valor)} />
          ))}
        </Bloque>
        <Bloque title="Ingreso y firma">
          {z.ingreso && (
            <Fila k={INGRESO[z.ingreso.tipo]} v={`${L(z.ingreso.monto)} · ${z.ingreso.recibe}`} />
          )}
          <Fila k="Firmado por" v={z.firmado_por ?? "—"} />
          <Fila k="Firmado en" v={firmado ? `${firmado.fecha} ${firmado.hora}` : "—"} />
          {hash && <Fila k="z_hash" v={<code className="break-all text-xs">{hash}</code>} />}
        </Bloque>
      </div>
    </article>
  );
}
