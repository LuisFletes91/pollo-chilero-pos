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
  type Payment,
  type PosEvent,
} from "./fixtures";
import { asRole, createTestDb, dbFailure, type Claims } from "./harness";

type Resultado = { client_seq: number; estado: string; error?: string };
type Respuesta = { resultados: Resultado[]; recibido_en: string };

let db: PGlite;
let cajero: string;
let supervisor: string;
let panelSup: PanelUser;
let panelSup2: PanelUser;
let pz1: string;

beforeAll(async () => {
  db = await createTestDb();
  cajero = await cashier(db, "Cajero Uno", PIN_PRUEBA);
  supervisor = await supervisorStaff(db, "Supervisor Caja", PIN_PRUEBA);
  panelSup = await panelUser(db, "supervisor", { pin: PIN_PRUEBA });
  panelSup2 = await panelUser(db, "supervisor");
  pz1 = await productId(db, "PZ-001");
});

async function push(claims: Claims, events: PosEvent[]): Promise<Respuesta> {
  return asRole(db, "authenticated", claims, async (tx) => {
    const r = await tx.query<{ r: Respuesta }>("select pos_push_events($1::jsonb) as r", [
      JSON.stringify(events),
    ]);
    return r.rows[0]!.r;
  });
}

async function panel(user: PanelUser, sql: string, params: unknown[]): Promise<void> {
  await asRole(db, "authenticated", user.claims("aal2"), (tx) => tx.query(`select ${sql}`, params));
}

async function contar(sql: string, params: unknown[] = []): Promise<number> {
  const r = await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params);
  return r.rows[0]!.n;
}

async function alertas(kind: string): Promise<string[]> {
  const r = await db.query<{ message: string }>(
    "select message from alerts where kind = $1 order by id",
    [kind],
  );
  return r.rows.map((x) => x.message);
}

async function estadoVenta(saleId: string): Promise<string> {
  const r = await db.query<{ status: string }>("select status from sales where id = $1", [saleId]);
  return r.rows[0]!.status;
}

const efectivo = (amount: number): Payment => ({
  payment_id: crypto.randomUUID(),
  method: "efectivo",
  amount,
  cash_received: amount,
});

/** Caja nueva con turno abierto; devuelve el siguiente client_seq. */
async function cajaConTurno(label: string) {
  const d = await device(db, label);
  const shiftId = crypto.randomUUID();
  const r = await push(d.claims, [openShiftEvent(1, cajero, supervisor, shiftId)]);
  expect(r.resultados[0]!.estado).toBe("aplicado");
  let seq = 2;
  return { ...d, shiftId, next: () => seq++ };
}

describe("pos_push_events", () => {
  it("es idempotente por client_seq y calcula base e ISV", async () => {
    const d = await device(db, "Caja idempotente");
    const shiftId = crypto.randomUUID();
    const saleId = crypto.randomUUID();
    const lote = [
      openShiftEvent(1, cajero, supervisor, shiftId),
      saleEvent(2, cajero, shiftId, {
        saleId,
        receipt: 1,
        lines: [{ productId: pz1, qty: 1, unitPrice: 120 }],
        payments: [efectivo(120)],
      }),
    ];
    const r1 = await push(d.claims, lote);
    expect(r1.resultados.map((x) => x.estado)).toEqual(["aplicado", "aplicado"]);
    const r2 = await push(d.claims, lote);
    expect(r2.resultados.map((x) => x.estado)).toEqual(["duplicado", "duplicado"]);

    expect(await contar("shifts where device_id = $1", [d.deviceId])).toBe(1);
    expect(await contar("sales where device_id = $1", [d.deviceId])).toBe(1);
    expect(await contar("pos_events where device_id = $1", [d.deviceId])).toBe(2);

    const l = await db.query<{ line_base: string; line_isv: string }>(
      "select line_base::text, line_isv::text from sale_lines where sale_id = $1",
      [saleId],
    );
    expect(l.rows).toEqual([{ line_base: "104.35", line_isv: "15.65" }]);
  });

  it("rechaza total inválido y venta vacía sin crear ventas", async () => {
    const c = await cajaConTurno("Caja rechazos");
    const antes = (await alertas("evento_rechazado")).length;

    const r1 = await push(c.claims, [
      saleEvent(c.next(), cajero, c.shiftId, {
        receipt: 1,
        lines: [{ productId: pz1, qty: 1, unitPrice: 120 }],
        payments: [efectivo(100)],
        total: 100,
      }),
    ]);
    expect(r1.resultados[0]).toMatchObject({ estado: "rechazado" });
    expect(r1.resultados[0]!.error).toMatch(/^TOTAL_INVALIDO/);

    const r2 = await push(c.claims, [
      saleEvent(c.next(), cajero, c.shiftId, { receipt: 1, lines: [], payments: [] }),
    ]);
    expect(r2.resultados[0]!.error).toMatch(/^VENTA_VACIA/);

    expect(await contar("sales where device_id = $1", [c.deviceId])).toBe(0);
    expect((await alertas("evento_rechazado")).length).toBe(antes + 2);
  });

  it("alerta huecos de numeración y precios distintos", async () => {
    const c = await cajaConTurno("Caja huecos");
    const venta = (receipt: number, unitPrice: number) =>
      saleEvent(c.next(), cajero, c.shiftId, {
        receipt,
        lines: [{ productId: pz1, qty: 1, unitPrice }],
        payments: [efectivo(unitPrice)],
      });
    const r = await push(c.claims, [venta(1, 120), venta(5, 120)]);
    expect(r.resultados.map((x) => x.estado)).toEqual(["aplicado", "aplicado"]);
    expect(await alertas("hueco_numeracion")).toContain("Faltan recibos R-00000002 a R-00000004");

    const antes = (await alertas("precio_distinto")).length;
    const r2 = await push(c.claims, [venta(6, 110)]);
    expect(r2.resultados[0]!.estado).toBe("aplicado");
    expect((await alertas("precio_distinto")).length).toBe(antes + 1);
  });

  it("exige turno abierto y segregación al abrir", async () => {
    const d = await device(db, "Caja sin turno");
    const r = await push(d.claims, [
      saleEvent(1, cajero, crypto.randomUUID(), {
        receipt: 1,
        lines: [{ productId: pz1, qty: 1, unitPrice: 120 }],
        payments: [efectivo(120)],
      }),
      openShiftEvent(2, cajero, cajero, crypto.randomUUID()),
    ]);
    expect(r.resultados[0]!.error).toMatch(/^TURNO_NO_ABIERTO/);
    expect(r.resultados[1]!.error).toMatch(/^SEGREGACION/);
  });
});

describe("anulaciones", () => {
  it("aplica segregación en caja y en panel", async () => {
    const c = await cajaConTurno("Caja anulaciones");
    const ventas = [crypto.randomUUID(), crypto.randomUUID()];
    await push(
      c.claims,
      ventas.map((saleId, i) =>
        saleEvent(c.next(), panelSup.staffId, c.shiftId, {
          saleId,
          receipt: i + 1,
          lines: [{ productId: pz1, qty: 1, unitPrice: 120 }],
          payments: [efectivo(120)],
        }),
      ),
    );

    const propia = await push(c.claims, [
      posEvent(c.next(), "anulacion_solicitada", cajero, {
        void_id: crypto.randomUUID(),
        sale_id: ventas[0],
        reason: "Cliente cambió de pedido",
        approved_by: cajero,
      }),
    ]);
    expect(propia.resultados[0]!.error).toMatch(/^SEGREGACION/);

    const voids = [crypto.randomUUID(), crypto.randomUUID()];
    const r = await push(
      c.claims,
      ventas.map((saleId, i) =>
        posEvent(c.next(), "anulacion_solicitada", panelSup.staffId, {
          void_id: voids[i],
          sale_id: saleId,
          reason: "Cliente cambió de pedido",
        }),
      ),
    );
    expect(r.resultados.map((x) => x.estado)).toEqual(["aplicado", "aplicado"]);
    expect(await estadoVenta(ventas[0]!)).toBe("anulacion_pendiente");

    await panel(panelSup2, "decide_void($1, true)", [voids[0]]);
    expect(await estadoVenta(ventas[0]!)).toBe("anulada");

    const f = await dbFailure(panel(panelSup, "decide_void($1, true)", [voids[1]]));
    expect(f.message).toMatch(/^SEGREGACION/);
  });
});

describe("transferencias", () => {
  it("quedan pendientes hasta confirmarse o rechazarse", async () => {
    const c = await cajaConTurno("Caja transferencias");
    const ventas = [crypto.randomUUID(), crypto.randomUUID()];
    const pagos = [crypto.randomUUID(), crypto.randomUUID()];
    await push(
      c.claims,
      ventas.map((saleId, i) =>
        saleEvent(c.next(), cajero, c.shiftId, {
          saleId,
          receipt: i + 1,
          lines: [{ productId: pz1, qty: 1, unitPrice: 120 }],
          payments: [
            {
              payment_id: pagos[i]!,
              method: "transferencia",
              amount: 120,
              transfer_reference: "BAC-12345",
            },
          ],
        }),
      ),
    );
    expect(await estadoVenta(ventas[0]!)).toBe("pago_pendiente");

    await panel(panelSup, "confirm_transfer($1)", [pagos[0]]);
    expect(await estadoVenta(ventas[0]!)).toBe("pagada");

    const antes = (await alertas("transferencia_rechazada")).length;
    await panel(panelSup, "reject_transfer($1, $2)", [pagos[1], "No llegó a la cuenta"]);
    expect(await estadoVenta(ventas[1]!)).toBe("cobro_fallido");
    expect((await alertas("transferencia_rechazada")).length).toBe(antes + 1);
  });
});

describe("cierre de turno, gaveta y reimpresión", () => {
  it("alerta diferencia de caja, gaveta abierta y reimpresión", async () => {
    const c = await cajaConTurno("Caja cierre");
    const saleId = crypto.randomUUID();
    await push(c.claims, [
      saleEvent(c.next(), cajero, c.shiftId, {
        saleId,
        receipt: 1,
        lines: [{ productId: pz1, qty: 1, unitPrice: 120 }],
        payments: [
          {
            payment_id: crypto.randomUUID(),
            method: "transferencia",
            amount: 120,
            transfer_reference: "BAC-777",
          },
        ],
      }),
    ]);
    const gav = (await alertas("apertura_sin_venta")).length;
    const rep = (await alertas("reimpresion")).length;
    const dif = (await alertas("diferencia_caja")).length;

    // Fondo L 500, sin ventas en efectivo: se cuentan L 449 (L 51 menos).
    const r = await push(c.claims, [
      posEvent(c.next(), "gaveta_abierta", cajero, {
        opening_id: crypto.randomUUID(),
        shift_id: c.shiftId,
        reason: "Cambio de billete",
      }),
      posEvent(c.next(), "reimpresion", cajero, {
        reprint_id: crypto.randomUUID(),
        sale_id: saleId,
      }),
      posEvent(c.next(), "turno_cerrado", cajero, {
        shift_id: c.shiftId,
        closing_count: { "200": 2, "20": 2, "5": 1, "2": 2 },
      }),
    ]);
    expect(r.resultados.map((x) => x.estado)).toEqual(["aplicado", "aplicado", "aplicado"]);
    expect((await alertas("apertura_sin_venta")).length).toBe(gav + 1);
    expect((await alertas("reimpresion")).length).toBe(rep + 1);
    expect((await alertas("diferencia_caja")).length).toBe(dif + 1);
  });
});
