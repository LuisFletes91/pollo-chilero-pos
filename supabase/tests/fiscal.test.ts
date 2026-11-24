import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  cashier,
  device,
  openShiftEvent,
  PIN_PRUEBA,
  productId,
  saleEvent,
  supervisorStaff,
} from "./fixtures";
import { asRole, createTestDb, dbFailure } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

async function config(opts: { activo: boolean; final?: number; diasLimite?: number }) {
  await db.exec("delete from public.fiscal_config");
  await db.query(
    `insert into public.fiscal_config (rtn, razon_social, nombre_comercial, direccion, cai,
       establecimiento, punto_emision, tipo_doc, rango_inicial, rango_final, siguiente, fecha_limite, activo)
     values ('08011999123456', 'Prueba S. de R.L.', 'Pollo Chilero', 'El Ocotal', 'CAI-PRUEBA',
       '001', '001', '01', 1, $1, 1, app.local_date(now()) + $2::int, $3)`,
    [opts.final ?? 2, opts.diasLimite ?? 60, opts.activo],
  );
}

const siguiente = () =>
  db.query<{ n: string }>("select app.next_fiscal_number() as n").then((r) => r.rows[0]!.n);

describe("numeración fiscal SAR (apagada)", () => {
  it("numera en 16 dígitos y bloquea al agotar el rango", async () => {
    await config({ activo: true });
    expect(await siguiente()).toBe("001-001-01-00000001");
    expect(await siguiente()).toBe("001-001-01-00000002");
    expect((await dbFailure(siguiente())).message).toMatch(/^RANGO_FISCAL_AGOTADO/);
  });

  it("bloquea con fecha límite vencida o fiscal inactivo", async () => {
    await config({ activo: true, diasLimite: -1 });
    expect((await dbFailure(siguiente())).message).toMatch(/^FECHA_LIMITE_VENCIDA/);
    await config({ activo: false });
    expect((await dbFailure(siguiente())).message).toMatch(/^FISCAL_INACTIVO/);
    await db.exec("delete from public.fiscal_config");
    expect((await dbFailure(siguiente())).message).toMatch(/^FISCAL_INACTIVO/);
  });

  it("alerta cuando el CAI está por vencer", async () => {
    await config({ activo: true, diasLimite: 10 });
    await siguiente();
    const r = await db.query("select 1 from alerts where kind = 'rango_fiscal'");
    expect(r.rows).toHaveLength(1);
  });

  it("las ventas no llevan número fiscal mientras está apagado", async () => {
    await db.exec("delete from public.fiscal_config");
    const cajero = await cashier(db, "Cajero", PIN_PRUEBA);
    const sup = await supervisorStaff(db, "Supervisor", PIN_PRUEBA);
    const caja = await device(db);
    const shift = crypto.randomUUID();
    const saleId = crypto.randomUUID();
    const events = [
      openShiftEvent(1, cajero, sup, shift),
      saleEvent(2, cajero, shift, {
        saleId,
        receipt: 1,
        lines: [{ productId: await productId(db, "PZ-001"), qty: 1, unitPrice: 120 }],
        payments: [
          { payment_id: crypto.randomUUID(), method: "efectivo", amount: 120, cash_received: 120 },
        ],
      }),
    ];
    await asRole(db, "authenticated", caja.claims, (tx) =>
      tx.query("select pos_push_events($1::jsonb)", [JSON.stringify(events)]),
    );
    const s = await db.query<{ fiscal_number: string | null }>(
      "select fiscal_number from sales where id = $1",
      [saleId],
    );
    expect(s.rows).toEqual([{ fiscal_number: null }]);
  });
});
