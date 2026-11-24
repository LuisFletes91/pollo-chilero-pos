import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite, type Transaction } from "@electric-sql/pglite";

// Arnés de pruebas de base de datos: aplica supabase/tests/shim.sql y luego TODAS las migraciones de
// supabase/migrations/ en orden de nombre, sobre una instancia PGlite nueva (Postgres en WASM).
const root = fileURLToPath(new URL("../..", import.meta.url));
const migrationsDir = join(root, "supabase", "migrations");
const shimPath = join(root, "supabase", "tests", "shim.sql");

export type DbRole = "anon" | "authenticated";

export type Claims = {
  sub?: string;
  aal?: "aal1" | "aal2";
  is_anonymous?: boolean;
};

export type DbFailure = {
  code: string | undefined;
  message: string;
};

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(shimPath, "utf8"));
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Falló la migración ${file}: ${message}`, { cause: error });
    }
  }
  return db;
}

// Ejecuta fn como el rol de la API (anon/authenticated) con los claims JWT dados, en una transacción.
export async function asRole<T>(
  db: PGlite,
  role: DbRole,
  claims: Claims,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role, ...claims }),
    ]);
    await tx.exec(role === "anon" ? "set local role anon" : "set local role authenticated");
    return fn(tx);
  });
}

// Espera que la promesa falle y devuelve SQLSTATE + mensaje ("CODIGO: detalle").
export async function dbFailure(promise: Promise<unknown>): Promise<DbFailure> {
  try {
    await promise;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return {
      code: typeof code === "string" ? code : undefined,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  throw new Error("Se esperaba un error de base de datos y la operación tuvo éxito");
}
