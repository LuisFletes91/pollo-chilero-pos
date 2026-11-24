import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

// Pruebas unitarias y de componentes (jsdom). La base de datos se prueba con vitest.db.config.ts.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: [
      "node_modules/**",
      "blueprints/**",
      "dist/**",
      "dist-e2e-mock/**",
      "e2e/**",
      "supabase/**",
    ],
    restoreMocks: true,
  },
});
