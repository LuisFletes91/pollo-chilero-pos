import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { anonUser, cashier, device, panelUser, PIN_PRUEBA, type PanelUser } from "./fixtures";
import { asRole, createTestDb, dbFailure } from "./harness";

let db: PGlite;
let supervisor: PanelUser;
let socio: PanelUser;

beforeAll(async () => {
  db = await createTestDb();
  supervisor = await panelUser(db, "supervisor");
  socio = await panelUser(db, "socio");
});

type Json = Record<string, unknown>;

async function rpc<T = Json>(
  role: "anon" | "authenticated",
  claims: object,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  return asRole(db, role, claims, async (tx) => {
    const r = await tx.query<{ r: T }>(`select ${sql} as r`, params);
    return r.rows[0]!.r;
  });
}

describe("propiedades de seguridad", () => {
  it("toda tabla de public tiene RLS", async () => {
    const r = await db.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(r.rows).toEqual([]);
  });

  it("anon no tiene privilegios sobre tablas ni vistas", async () => {
    const r = await db.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
        and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
          or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))`);
    expect(r.rows).toEqual([]);
  });

  it("authenticated no escribe ninguna tabla", async () => {
    const r = await db.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and (has_table_privilege('authenticated', c.oid, 'INSERT')
          or has_table_privilege('authenticated', c.oid, 'UPDATE')
          or has_table_privilege('authenticated', c.oid, 'DELETE'))`);
    expect(r.rows).toEqual([]);
  });

  it("anon no ejecuta funciones de public", async () => {
    const r = await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')`);
    expect(r.rows).toEqual([]);
  });

  it("en app, authenticated solo ejecuta is_panel_reader e is_panel_supervisor", async () => {
    const r = await db.query<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      order by p.proname`);
    expect(r.rows.map((x) => x.proname)).toEqual(["is_panel_reader", "is_panel_supervisor"]);
  });
});

describe("escritura directa bloqueada", () => {
  it.each([
    "insert into products (code, name, category_code, price) values ('CF-099', 'x', 'CF', 1)",
    "update staff set display_name = 'x'",
    "delete from audit_log",
  ])("%s → 42501", async (sql) => {
    const f = await dbFailure(
      asRole(db, "authenticated", supervisor.claims("aal2"), (tx) => tx.query(sql)),
    );
    expect(f.code).toBe("42501");
  });
});

describe("lectura del panel con MFA", () => {
  it("socio aal1 no ve productos; aal2 ve 59", async () => {
    const contar = (aal: "aal1" | "aal2") =>
      asRole(db, "authenticated", socio.claims(aal), async (tx) => {
        const r = await tx.query<{ n: number }>("select count(*)::int as n from products");
        return r.rows[0]!.n;
      });
    expect(await contar("aal1")).toBe(0);
    expect(await contar("aal2")).toBe(59);
  });

  it("panel_whoami con aal1 exige MFA", async () => {
    const f = await dbFailure(rpc("authenticated", socio.claims("aal1"), "panel_whoami()"));
    expect(f.message).toMatch(/^MFA_REQUERIDO/);
  });

  it("socio no administra", async () => {
    const a = await dbFailure(
      rpc("authenticated", socio.claims("aal2"), "create_pairing_code('Caja 1')"),
    );
    expect(a.message).toMatch(/^NO_AUTORIZADO/);
    const b = await dbFailure(
      rpc("authenticated", socio.claims("aal2"), "upsert_staff(null, 'X', 'cajero', true)"),
    );
    expect(b.message).toMatch(/^NO_AUTORIZADO/);
  });
});

describe("emparejamiento y snapshot", () => {
  it("empareja una caja con un código de un solo uso", async () => {
    const pc = await rpc<{ code: string; expires_at: string }>(
      "authenticated",
      supervisor.claims("aal2"),
      "create_pairing_code('Caja 1')",
    );
    expect(pc.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(pc.expires_at).toBeTruthy();

    const caja = await anonUser(db);
    const res = await rpc<{ device_id: string; label: string }>(
      "authenticated",
      caja.claims,
      "pos_claim_device($1)",
      [pc.code],
    );
    const d = await db.query<{ n: number }>(
      "select count(*)::int as n from devices where id = $1 and active and auth_user_id = $2",
      [res.device_id, caja.uid],
    );
    expect(d.rows[0]!.n).toBe(1);

    const otro = await anonUser(db);
    const f = await dbFailure(rpc("authenticated", otro.claims, "pos_claim_device($1)", [pc.code]));
    expect(f.message).toMatch(/^CODIGO_INVALIDO/);
  });

  it("la caja descarga el catálogo y el personal", async () => {
    const cajeroId = await cashier(db, "Cajero Uno", PIN_PRUEBA);
    const caja = await device(db, "Caja snapshot");
    type Snap = {
      version: number;
      unchanged: boolean;
      products: unknown[];
      categories: unknown[];
      settings: Record<string, unknown>;
      staff: { id: string; pin_hash: string }[];
    };
    const s = await rpc<Snap>("authenticated", caja.claims, "pos_pull_snapshot(0)");
    expect(s.unchanged).toBe(false);
    expect(s.products).toHaveLength(59);
    expect(s.categories).toHaveLength(6);
    expect(s.settings.cash_diff_threshold).toBe(50);
    expect(s.staff.find((x) => x.id === cajeroId)?.pin_hash).toBe(PIN_PRUEBA.hash);

    const s2 = await rpc<Snap>("authenticated", caja.claims, "pos_pull_snapshot($1)", [s.version]);
    expect(s2.unchanged).toBe(true);

    const f = await dbFailure(
      rpc("authenticated", supervisor.claims("aal2"), "pos_pull_snapshot(0)"),
    );
    expect(f.message).toMatch(/^NO_AUTORIZADO/);
  });
});
