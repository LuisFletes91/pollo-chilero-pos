import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  cashier,
  device,
  openShiftEvent,
  panelUser,
  PIN_PRUEBA,
  posEvent,
  productId,
  saleEvent,
  supervisorStaff,
  type PanelUser,
  type PosEvent,
} from "./fixtures";
import { asRole, createTestDb, dbFailure, type Claims } from "./harness";

type Resultado = { client_seq: number; estado: string; error?: string };

const DIA1 = "2026-11-22";
const DIA2 = "2026-11-23";
const AT2 = "2026-11-23T16:00:00.000Z";

let db: PGlite;
let cajero: string;
let supCaja: string;
let sup: PanelUser;
let socio: PanelUser;
let caja: { deviceId: string; claims: Claims };
let seq = 1;
let ventaCF: string;

async function push(events: PosEvent[]): Promise<Resultado[]> {
  return asRole(db, "authenticated", caja.claims, async (tx) => {
    const r = await tx.query<{ r: { resultados: Resultado[] } }>(
      "select pos_push_events($1::jsonb) as r",
      [JSON.stringify(events)],
    );
    return r.rows[0]!.r.resultados;
  });
}

async function como<T = unknown>(user: PanelUser, sql: string, params: unknown[] = []): Promise<T> {
  return asRole(db, "authenticated", user.claims("aal2"), async (tx) => {
    const r = await tx.query<{ r: T }>(`select ${sql} as r`, params);
    return r.rows[0]!.r;
  });
}

const panel = <T = unknown>(sql: string, params: unknown[] = []) => como<T>(sup, sql, params);

const efectivo = (amount: number, recibido = amount) => ({
  payment_id: crypto.randomUUID(),
  method: "efectivo" as const,
  amount,
  cash_received: recibido,
});

beforeAll(async () => {
  db = await createTestDb();
  cajero = await cashier(db, "Cajero Uno", PIN_PRUEBA);
  supCaja = await supervisorStaff(db, "Supervisor Caja", PIN_PRUEBA);
  sup = await panelUser(db, "supervisor", { pin: PIN_PRUEBA });
  socio = await panelUser(db, "socio");
  caja = await device(db, "Caja 1");

  const shift = crypto.randomUUID();
  ventaCF = crypto.randomUUID();
  const ventaEX = crypto.randomUUID();
  const r = await push([
    openShiftEvent(seq++, cajero, supCaja, shift),
    saleEvent(seq++, cajero, shift, {
      saleId: ventaCF,
      receipt: 1,
      lines: [{ productId: await productId(db, "CF-001"), qty: 1, unitPrice: 209 }],
      payments: [efectivo(209, 300)],
    }),
    saleEvent(seq++, cajero, shift, {
      receipt: 2,
      lines: [{ productId: await productId(db, "PZ-001"), qty: 1, unitPrice: 120 }],
      payments: [efectivo(120)],
    }),
    saleEvent(seq++, cajero, shift, {
      saleId: ventaEX,
      receipt: 3,
      lines: [{ productId: await productId(db, "EX-001"), qty: 1, unitPrice: 25 }],
      payments: [efectivo(25)],
    }),
    posEvent(seq++, "anulacion_solicitada", cajero, {
      void_id: crypto.randomUUID(),
      sale_id: ventaEX,
      reason: "Cliente no la quiso",
      approved_by: supCaja,
    }),
    posEvent(seq++, "turno_cerrado", cajero, {
      shift_id: shift,
      closing_count: { "500": 1, "200": 1, "100": 1, "20": 1, "5": 1, "2": 2 },
    }),
  ]);
  expect(r.map((x) => x.estado)).toEqual(Array(6).fill("aplicado"));
});

describe("cierre del día", () => {
  it("respeta el orden del asistente y valida el PIN", async () => {
    const f = await dbFailure(
      panel("day_close_deposit($1, 'entrega_socio', 829, 'Socio encargado')", [DIA1]),
    );
    expect(f.message).toMatch(/^ORDEN_CIERRE/);

    await panel("day_close_start($1)", [DIA1]);
    await panel("day_close_cash_count($1, $2::jsonb)", [
      DIA1,
      JSON.stringify({ "500": 1, "200": 1, "100": 1, "20": 1, "5": 1, "2": 2 }),
    ]);
    await panel("day_close_inventory_count($1, $2::jsonb)", [
      DIA1,
      JSON.stringify([{ item_code: "ALA", counted: 0 }]),
    ]);
    await panel("day_close_deposit($1, 'entrega_socio', 829, 'Socio encargado')", [DIA1]);

    const pin = await dbFailure(panel("day_close_finalize($1, $2)", [DIA1, "f".repeat(64)]));
    expect(pin.message).toMatch(/^PIN_INVALIDO/);
  });

  it("segundo día: exige transferencias resueltas y justificación", async () => {
    const shift = crypto.randomUUID();
    const pago = crypto.randomUUID();
    const r = await push([
      { ...openShiftEvent(seq++, cajero, supCaja, shift), client_created_at: AT2 },
      {
        ...saleEvent(seq++, cajero, shift, {
          receipt: 4,
          lines: [{ productId: await productId(db, "PZ-001"), qty: 1, unitPrice: 120 }],
          payments: [
            {
              payment_id: pago,
              method: "transferencia",
              amount: 120,
              transfer_reference: "BAC-23001",
            },
          ],
        }),
        client_created_at: AT2,
      },
      posEvent(
        seq++,
        "turno_cerrado",
        cajero,
        { shift_id: shift, closing_count: { "100": 3, "50": 4 } },
        AT2,
      ),
    ]);
    expect(r.map((x) => x.estado)).toEqual(["aplicado", "aplicado", "aplicado"]);

    await panel("day_close_start($1)", [DIA2]);
    await panel("day_close_cash_count($1, $2::jsonb)", [DIA2, JSON.stringify({ "100": 5 })]);
    await panel("day_close_inventory_count($1, $2::jsonb)", [
      DIA2,
      JSON.stringify([{ item_code: "PIERNA", counted: 0 }]),
    ]);
    const dep = "day_close_deposit($1, 'entrega_socio', 700, 'Socio encargado')";
    const t = await dbFailure(panel(dep, [DIA2]));
    expect(t.message).toMatch(/^TRANSFERENCIAS_PENDIENTES/);

    await panel("confirm_transfer($1)", [pago]);
    await panel("day_close_cash_count($1, $2::jsonb)", [
      DIA2,
      JSON.stringify({ "500": 1, "200": 1 }),
    ]);
    await panel(dep, [DIA2]);
    const j = await dbFailure(panel("day_close_finalize($1, $2)", [DIA2, PIN_PRUEBA.hash]));
    expect(j.message).toMatch(/^JUSTIFICACION_REQUERIDA/);
  });

  it("cierra el primer día con un reporte Z inmutable", async () => {
    await panel("day_close_finalize($1, $2)", [DIA1, PIN_PRUEBA.hash]);
    const r = await db.query<{
      ventas: string;
      anul: string;
      esperado: string;
      status: string;
      hash_ok: boolean;
    }>(
      `select z_report ->> 'ventas_total' as ventas,
              z_report -> 'anulaciones' ->> 'cantidad' as anul,
              z_report -> 'efectivo' ->> 'esperado' as esperado,
              status,
              z_hash = encode(sha256(convert_to(z_report::text, 'UTF8')), 'hex') as hash_ok
       from day_closes where business_date = $1`,
      [DIA1],
    );
    const z = r.rows[0]!;
    expect(Number(z.ventas)).toBe(329);
    expect(Number(z.anul)).toBe(1);
    expect(Number(z.esperado)).toBe(829);
    expect(z.status).toBe("cerrado");
    expect(z.hash_ok).toBe(true);

    const u = await dbFailure(
      db.query("update day_closes set justification = 'x' where business_date = $1", [DIA1]),
    );
    expect(u.message).toMatch(/^DIA_CERRADO/);

    const an = await push([
      posEvent(seq++, "anulacion_solicitada", cajero, {
        void_id: crypto.randomUUID(),
        sale_id: ventaCF,
        reason: "Intento tardío",
      }),
    ]);
    expect(an[0]!.estado).toBe("rechazado");
    expect(an[0]!.error).toMatch(/^DIA_CERRADO/);
  });

  it("el panel resume y lista el día", async () => {
    const s = await como<{ venta_total: number; recibos: number }>(socio, "panel_summary($1, $2)", [
      DIA1,
      DIA1,
    ]);
    expect(Number(s.venta_total)).toBe(329);
    expect(Number(s.recibos)).toBe(2);
    const l = await como<unknown[]>(socio, "panel_list('ventas', $1, $2)", [DIA1, DIA1]);
    expect(l).toHaveLength(3);
  });
});
