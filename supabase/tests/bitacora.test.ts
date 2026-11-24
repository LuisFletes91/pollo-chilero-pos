import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, dbFailure } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

type Fila = { id: number; action: string; antes: string | null; despues: string | null };

describe("bitácora con hash encadenado", () => {
  it("registra el cambio de precio, es inmutable y detecta alteraciones", async () => {
    const max = async () =>
      Number(
        (await db.query<{ m: string }>("select max(id)::text as m from audit_log")).rows[0]?.m,
      );
    const antes = await max();

    await db.query("update products set price = 210 where code = 'CF-001'");

    const nuevas = await db.query<Fila>(
      `select id::int as id, action, before ->> 'price' as antes, after ->> 'price' as despues
       from audit_log where id > $1 order by id`,
      [antes],
    );
    expect(nuevas.rows).toHaveLength(1);
    const fila = nuevas.rows[0]!;
    expect(fila).toMatchObject({ action: "UPDATE", antes: "209.00", despues: "210.00" });

    const ok = await db.query<{ ok: boolean }>("select ok from app.audit_chain_check()");
    expect(ok.rows[0]?.ok).toBe(true);

    const fallo = await dbFailure(db.query("update audit_log set after = '{}'"));
    expect(fallo.message).toMatch(/^BITACORA_INMUTABLE/);

    const alterado = fila.id - 1;
    await db.exec("alter table public.audit_log disable trigger audit_log_inmutable");
    await db.query(`update public.audit_log set after = '{"x": 1}'::jsonb where id = $1`, [
      alterado,
    ]);
    await db.exec("alter table public.audit_log enable trigger audit_log_inmutable");

    const roto = await db.query<{ ok: boolean; first_bad_id: string }>(
      "select ok, first_bad_id::text as first_bad_id from app.audit_chain_check()",
    );
    expect(roto.rows[0]).toEqual({ ok: false, first_bad_id: String(alterado) });
  });
});
