import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
});

async function receta(code: string): Promise<Record<string, number>> {
  const r = await db.query<{ item: string; qty: string }>(
    `select i.code as item, r.qty::text as qty
     from recipes r
     join products p on p.id = r.product_id
     join inventory_items i on i.id = r.item_id
     where p.code = $1`,
    [code],
  );
  return Object.fromEntries(r.rows.map((x) => [x.item, Number(x.qty)]));
}

describe("catálogo inicial", () => {
  it("tiene 59 productos activos con códigos válidos", async () => {
    const r = await db.query<{ code: string }>("select code from products where active");
    expect(r.rows).toHaveLength(59);
    for (const { code } of r.rows) {
      expect(code).toMatch(/^(CF|CP|PZ|CI|EX|BE)-[0-9]{3}$/);
    }
  });

  it("legacy_code es único y no nulo", async () => {
    const r = await db.query<{ total: number; unicos: number; nulos: number }>(
      `select count(*)::int as total, count(distinct legacy_code)::int as unicos,
              count(*) filter (where legacy_code is null)::int as nulos
       from products`,
    );
    expect(r.rows[0]).toEqual({ total: 59, unicos: 59, nulos: 0 });
  });

  it.each([
    ["PZ-001", 1, 1, 1, 1],
    ["PZ-002", 2, 2, 1, 1],
    ["PZ-003", 2, 2, 2, 2],
    ["PZ-004", 3, 3, 3, 3],
    ["PZ-005", 6, 6, 6, 6],
  ])("receta de %s", async (code, ala, pierna, muslo, pechuga) => {
    expect(await receta(code)).toEqual({
      ALA: ala,
      PIERNA: pierna,
      MUSLO: muslo,
      PECHUGA: pechuga,
    });
  });

  it("cada bebida tiene receta 1:1 con su ítem", async () => {
    const r = await db.query<{ code: string }>(
      "select code from products where category_code = 'BE' order by code",
    );
    expect(r.rows.length).toBeGreaterThan(0);
    for (const { code } of r.rows) {
      expect(await receta(code)).toEqual({ [code]: 1 });
    }
  });

  it("CF-001 descuenta lo correcto", async () => {
    expect(await receta("CF-001")).toEqual({
      MUSLO: 2,
      PIERNA: 1,
      ALA: 1,
      "PAPA-PERS": 1,
      "BE-008": 1,
    });
  });

  it("todo producto tiene receta", async () => {
    const r = await db.query(
      "select code from products p where not exists (select 1 from recipes r where r.product_id = p.id)",
    );
    expect(r.rows).toEqual([]);
  });

  it("paridad con el Excel", async () => {
    const suma = await db.query<{ s: string }>("select sum(price)::text as s from products");
    expect(suma.rows[0]?.s).toBe("6667.00");
    const r = await db.query<{ code: string; price: string; legacy_code: string }>(
      "select code, price::text as price, legacy_code from products where code in ('CF-001', 'BE-027') order by code",
    );
    expect(r.rows).toEqual([
      { code: "BE-027", price: "20.00", legacy_code: "P0059" },
      { code: "CF-001", price: "209.00", legacy_code: "P001" },
    ]);
  });
});
