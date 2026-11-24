import { defineConfig } from "vitest/config";

// Pruebas de base de datos: migraciones reales de supabase/migrations/ sobre PGlite (Postgres WASM,
// en proceso, sin Docker ni credenciales). Cada archivo crea su propia instancia.
export default defineConfig({
  test: {
    environment: "node",
    include: ["supabase/tests/**/*.test.ts"],
    exclude: ["node_modules/**", "blueprints/**"],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
