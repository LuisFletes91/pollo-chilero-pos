import { existsSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const src = fileURLToPath(new URL("./src", import.meta.url));
const mockBackend = fileURLToPath(new URL("./src/lib/mock-backend.ts", import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Pollo Chilero — Caja y Panel",
        short_name: "Pollo Chilero",
        lang: "es-HN",
        start_url: "/pos",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#c8102e",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg}"],
      },
    }),
  ],
  resolve: {
    // El orden importa: el alias específico va antes que "@". Solo el modo e2e-mock (flujos e2e del paso 18) usa el
    // backend simulado; producción, pruebas y la prueba de humo resuelven @/lib/backend-impl al archivo real.
    alias: [
      ...(mode === "e2e-mock" && existsSync(mockBackend)
        ? [{ find: "@/lib/backend-impl", replacement: mockBackend }]
        : []),
      { find: "@", replacement: src },
    ],
  },
}));
