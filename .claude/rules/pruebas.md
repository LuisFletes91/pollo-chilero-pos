---
description: Convenciones de pruebas (Vitest, PGlite, Playwright)
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "e2e/**"
---

# Pruebas

- Prohibido `.skip(` y `.only(`: el gate lo busca con grep.
- Pruebas de BD: `createTestDb()` en `beforeAll`, una instancia por archivo; datos con `./fixtures`.
- Errores esperados con `dbFailure(promesa)` y aserción sobre `code` y el prefijo del mensaje.
- Pruebas de componentes: `@testing-library/react` + `user-event`, consultas por rol y texto visible.
- Dexie en pruebas: `fake-indexeddb/auto` (ya en `src/test/setup.ts`); borre la BD en `beforeEach`.
- El backend en pruebas unitarias es un objeto falso `fake` que implementa `Backend`; nunca red real. Se inyecta con
  `vi.mock("@/lib/backend-impl", () => ({ createBackendImpl: () => fake }))` y en `beforeEach` se llama `resetBackendForTests()` y
  `queryClient.clear()` (de `@/lib/backend`) para que ni el singleton por tipo ni la caché de TanStack Query pasen de una prueba a otra.
- Tiempo: `vi.useFakeTimers()` para reintentos y polling; restaure con `vi.useRealTimers()`.
- E2E: selectores por rol/texto; el humo solo usa pantallas de entrada.
