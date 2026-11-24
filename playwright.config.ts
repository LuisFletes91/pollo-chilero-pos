import { defineConfig, devices } from "@playwright/test";

// Dos servidores de vista previa del build de producción:
// - 4173: modo "e2e" (backend Supabase con URL falsa) para la prueba de humo.
// - 4174: modo "e2e-mock" (backend simulado en el navegador, paso 18) para los flujos críticos.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    trace: "retain-on-failure",
    serviceWorkers: "block",
    locale: "es-HN",
    timezoneId: "America/Tegucigalpa",
  },
  projects: [
    {
      name: "smoke",
      testMatch: /smoke\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4173" },
    },
    {
      name: "flujos",
      testMatch: /flujos\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4174" },
    },
  ],
  webServer: [
    {
      command: "npm run build -- --mode e2e && npm run preview",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
    },
    {
      command: "npm run build:e2e-mock && npm run preview:e2e-mock",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
    },
  ],
});
