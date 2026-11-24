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

let db: PGlite;
let cajero: string;
let supervisor: string;
let supervisor2: string;
let sup: PanelUser;

const PIEZAS = ["ALA", "PIERNA", "MUSLO", "PECHUGA"];

beforeAll(async () => {
  db = await createTestDb();
  cajero = await cashier(db, "Cajero Uno", PIN_PRUEBA);
  supervisor = await supervisorStaff(db, "Supervisor Caja", PIN_PRUEBA);
  supervisor2 = await supervisorStaff(db, "Supervisor Dos", PIN_PRUEBA);
  sup = await panelUser(db, "supervisor");
});

async function push(claims: Claims, events: PosEvent[]): Promise<Resultado[]> {
  return asRole(db, "authenticated", claims, async (tx) => {
    const r = await tx.query<{ r: { resultados: Resultado[] } }>(
      "select pos_push_events($1::jsonb) as r",
      [JSON.stringify(events)],
    );
    return r.rows[0]!.r.resultados;
  });
}

async function panel<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  return asRole(db, "authenticated", sup.claims("aal2"), async (tx) => {
    const r = await tx.query<{ r: T }>(`select ${sql} as r`, params);
    return r.rows[0]!.r;
  });
}

async function stock(code: string): Promise<number> {
  const r = await db.query<{ qty: string }>(
    "select qty::text as qty from inventory_stock where code = $1",
    [code],
  );
  return Number(r.rows[0]!.qty);
}

async function movimientos(where: string, params: unknown[] = []) {
  const r = await db.query<{ code: string; qty: string; kind: string }>(
    `select i.code, m.qty::text as qty, m.kind from inventory_movements m
     join inventory_items i on i.id = m.item_id where ${where} order by m.id`,
    params,
  );
  return r.rows.map((x) => ({ code: x.code, qty: Number(x.qty), kind: x.kind }));
}

async function totalMovimientos(): Promise<number> {
  const r = await db.query<{ n: number }>("select count(*)::int as n from inventory_movements");
  return r.rows[0]!.n;
}

describe("inventario por receta", () => {
  it("descuenta la venta, la revierte al anular y no duplica en reenvíos", async () => {
    const caja = await device(db, "Caja inventario");
    const shiftId = crypto.randomUUID();
    const saleId = crypto.randomUUID();
    const previo = Object.fromEntries(
      await Promise.all(PIEZAS.map(async (p) => [p, await stock(p)] as const)),
    );
    const lote = [
      openShiftEvent(1, cajero, supervisor, shiftId),
      saleEvent(2, cajero, shiftId, {
        saleId,
        receipt: 1,
        lines: [{ productId: await productId(db, "PZ-003"), qty: 1, unitPrice: 255 }],
        payments: [
          { payment_id: crypto.randomUUID(), method: "efectivo", amount: 255, cash_received: 300 },
        ],
      }),
    ];
    expect((await push(caja.claims, lote)).map((x) => x.estado)).toEqual(["aplicado", "aplicado"]);

    const ventas = await movimientos("m.kind = 'venta' and m.ref_id = $1", [saleId]);
    expect(ventas).toHaveLength(4);
    for (const p of PIEZAS) {
      expect(ventas).toContainEqual({ code: p, qty: -2, kind: "venta" });
    }

    const r = await push(caja.claims, [
      posEvent(3, "anulacion_solicitada", cajero, {
        void_id: crypto.randomUUID(),
        sale_id: saleId,
        reason: "Pedido equivocado",
        approved_by: supervisor,
      }),
    ]);
    expect(r[0]!.estado).toBe("aplicado");
    const anul = await movimientos("m.kind = 'anulacion'");
    for (const p of PIEZAS) {
      expect(anul).toContainEqual({ code: p, qty: 2, kind: "anulacion" });
      expect(await stock(p)).toBe(previo[p]);
    }

    expect((await push(caja.claims, lote)).map((x) => x.estado)).toEqual([
      "duplicado",
      "duplicado",
    ]);
    expect(await movimientos("m.kind = 'venta' and m.ref_id = $1", [saleId])).toHaveLength(4);
  });

  it("registra compras de pollo por peso", async () => {
    const antes = await stock("POLLO-ENTERO");
    const id = await panel<string>(
      "register_purchase('POLLO-ENTERO', 10, 2275, 'Avícola del Valle', 45.5)",
    );
    const r = await db.query<{ cpu: string; cpp: string }>(
      "select cost_per_unit::numeric::text as cpu, cost_per_pound::numeric::text as cpp from purchases where id = $1",
      [id],
    );
    expect(Number(r.rows[0]!.cpu)).toBe(227.5);
    expect(Number(r.rows[0]!.cpp)).toBe(50);
    expect(await stock("POLLO-ENTERO")).toBe(antes + 10);

    const f = await dbFailure(
      panel("register_purchase('POLLO-ENTERO', 1, 200, 'Avícola del Valle')"),
    );
    expect(f.message).toMatch(/^LIBRAS_REQUERIDAS/);
  });

  it("corta pollos en piezas con costo por pieza", async () => {
    const pieza = Object.fromEntries(
      await Promise.all(PIEZAS.map(async (p) => [p, await stock(p)] as const)),
    );
    const pollo = await stock("POLLO-ENTERO");
    const id = await panel<string>("register_cut(2)");
    expect(await stock("POLLO-ENTERO")).toBe(pollo - 2);
    for (const p of PIEZAS) expect(await stock(p)).toBe(pieza[p]! + 4);
    const c = await db.query<{ cpp: string }>(
      "select cost_per_piece::text as cpp from cuts where id = $1",
      [id],
    );
    expect(Number(c.rows[0]!.cpp)).toBe(28.4375);

    const n = await totalMovimientos();
    const f = await dbFailure(panel("register_cut(999)"));
    expect(f.message).toMatch(/^STOCK_INSUFICIENTE/);
    expect(await totalMovimientos()).toBe(n);
  });

  it("el conteo físico ajusta el teórico, valoriza la merma y alerta", async () => {
    await panel("register_cut(1)");
    expect(await stock("POLLO-ENTERO")).toBe(7);
    expect(await stock("ALA")).toBe(6);

    const avg = await db.query<{ c: string }>(
      "select avg_cost::text as c from inventory_items where code = 'ALA'",
    );
    const countId = (
      await db.query<{ id: string }>(
        `select app.apply_inventory_count($1, app.local_date(now()), '[{"item_code":"ALA","counted":0}]'::jsonb)::text as id`,
        [supervisor],
      )
    ).rows[0]!.id;

    expect(await movimientos("m.kind = 'ajuste_conteo'")).toEqual([
      { code: "ALA", qty: -6, kind: "ajuste_conteo" },
    ]);
    const linea = await db.query<{ w: string }>(
      "select waste_value::text as w from inventory_count_lines where count_id = $1",
      [countId],
    );
    expect(Number(linea.rows[0]!.w)).toBe(Math.round(6 * Number(avg.rows[0]!.c) * 100) / 100);
    const alertas = await db.query("select 1 from alerts where kind = 'merma'");
    expect(alertas.rows).toHaveLength(1);
  });

  it("los movimientos son inmutables", async () => {
    const u = await dbFailure(db.query("update inventory_movements set qty = 1"));
    expect(u.message).toMatch(/^MOVIMIENTO_INMUTABLE/);
    const d = await dbFailure(db.query("delete from inventory_movements"));
    expect(d.message).toMatch(/^MOVIMIENTO_INMUTABLE/);
  });

  it("el consumo interno exige aprobación de otro supervisor", async () => {
    const caja = await device(db, "Caja consumo");
    const consumo = (seq: number, approvedBy: string) =>
      posEvent(seq, "consumo_interno", supervisor, {
        consumption_id: crypto.randomUUID(),
        item_code: "PECHUGA",
        qty: 1,
        reason: "Almuerzo del personal",
        approved_by: approvedBy,
      });
    const r = await push(caja.claims, [consumo(1, supervisor2), consumo(2, supervisor)]);
    expect(r[0]!.estado).toBe("aplicado");
    expect(r[1]!.error).toMatch(/^SEGREGACION/);
    expect(await movimientos("m.kind = 'consumo_interno'")).toEqual([
      { code: "PECHUGA", qty: -1, kind: "consumo_interno" },
    ]);
  });

  it("valida recetas y numera productos nuevos", async () => {
    const f = await dbFailure(panel("upsert_recipe('CP-004', '[]'::jsonb)"));
    expect(f.message).toMatch(/^RECETA_INVALIDA/);
    expect(await panel<string>("create_product('BE', 'Coca prueba', 20)")).toBe("BE-028");
  });
});
