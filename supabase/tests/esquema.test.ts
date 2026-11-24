import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, dbFailure } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

describe("esquema base", () => {
  it.each([
    "locations",
    "categories",
    "products",
    "inventory_items",
    "recipes",
    "staff",
    "devices",
    "pairing_codes",
    "settings",
    "alerts",
    "audit_log",
  ])("existe la tabla %s", async (t) => {
    const r = await db.query<{ ok: boolean }>(
      `select to_regclass('public.${t}') is not null as ok`,
    );
    expect(r.rows[0]?.ok).toBe(true);
  });

  it("toda tabla de public (salvo audit_log) tiene el trigger audit_row", async () => {
    const r = await db.query(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'audit_log'
        and not exists (
          select 1 from pg_trigger t
          where t.tgrelid = c.oid and t.tgname = 'audit_row' and not t.tgisinternal
        )`);
    expect(r.rows).toEqual([]);
  });

  it("el código de producto no se borra ni se cambia", async () => {
    const borrar = await dbFailure(db.query("delete from products where code = 'CF-001'"));
    expect(borrar.message).toMatch(/^CODIGO_INMUTABLE/);
    const cambiar = await dbFailure(
      db.query("update products set code = 'CF-999' where code = 'CF-001'"),
    );
    expect(cambiar.message).toMatch(/^CODIGO_INMUTABLE/);
  });
});
