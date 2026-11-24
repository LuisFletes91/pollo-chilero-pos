# Pollo Chilero — POS + Inventario (Etapa 1)

POS web offline-first para la caja del local "Pollo Chilero" (El Ocotal, Olanchito, Yoro) con
inventario por receta, cierre ciego y panel móvil con MFA para los 3 socios. Todo en español (es-HN).

## Comandos (Git Bash, desde la raíz del repo)

| Tarea | Comando |
|---|---|
| Instalar | `npm install --no-audit --no-fund` (CI: `npm ci`) |
| Servidor de desarrollo | `npm run dev` — http://127.0.0.1:5173 (requiere `.env.local`) |
| Build | `npm run build` → `dist/` (incluye `dist/sw.js`) |
| Tipos | `npm run typecheck` |
| Lint / formato | `npm run lint` · `npm run format:check` · arreglar: `npm run format` |
| Pruebas unitarias | `npm run test` · un archivo: `npm run test -- src/pos/cart.test.ts` |
| Pruebas de BD (PGlite) | `npm run test:db` · un archivo: `npm run test:db -- supabase/tests/ventas.test.ts` |
| Navegadores e2e | `npm run e2e:install` (una vez) |
| E2E | `npm run e2e` · humo: `npm run e2e -- e2e/smoke.spec.ts` |

**Gate de cada tarea:** `npm run typecheck && npm run lint && npm run format:check && npm run test`
y, desde el paso 3, también `npm run test:db`; luego `npm run build`. Ninguna tarea se marca `done`
con un gate en rojo. El orden de construcción está en `blueprints/pollo-chilero-pos/tasks.json`
(protocolo de reanudación) y cada tarea se ejecuta leyendo SOLO su archivo `epics/NN-*.md`.

Node 24 (`.nvmrc`). Versiones exactas en `package.json` y `package-lock.json`: léalas, no adivine.

## Stack

Vite + React 19 + TypeScript 6 · Tailwind v4 (tokens en `src/index.css`) · react-router-dom 7 ·
TanStack Query (panel) · Dexie/IndexedDB (caja) · vite-plugin-pwa · Supabase (Postgres + Auth + RLS
+ Storage) · Vitest (jsdom) · PGlite (pruebas SQL) · Playwright · ESLint + Prettier.

## Arquitectura

**Caja (`/pos`)**: todo se escribe primero en Dexie (`src/pos/db.ts`). Cada acción genera un evento
inmutable en `outbox` con `client_seq` consecutivo (`src/pos/outbox.ts`); la venta, el número de
recibo `R-00000001` y su evento se escriben en UNA transacción Dexie. `src/pos/sync.ts` envía los
pendientes a la RPC `pos_push_events` (idempotente por `(device_id, client_seq)`) con reintento
exponencial. Catálogo/staff/ajustes llegan por `pos_pull_snapshot`.
Ruta: pantalla → `src/pos/*.ts` (lógica pura) → Dexie → `sync.ts` → `src/lib/backend.tsx` → Supabase.

**Panel (`/panel`)**: Supabase Auth email+contraseña + TOTP (aal2). Lee con `panel_summary` /
`panel_list` y escribe con RPC del supervisor, vía TanStack Query (polling 60 s, sin realtime).

**Base de datos**: `supabase/migrations/*.sql` es la fuente de verdad. Ninguna tabla acepta
INSERT/UPDATE/DELETE de `anon`/`authenticated`; toda escritura es una función `SECURITY DEFINER`
con `set search_path = ''` que valida identidad (`app.require_device()` / `app.require_panel()`).
Triggers escriben `audit_log` (cadena sha256) en toda tabla de negocio.

| Capa | Puede importar | Nunca |
|---|---|---|
| `src/pos/**` | `src/lib/**`, `src/pos/**` | `src/panel/**`, llamar Supabase sin `backend` |
| `src/panel/**` | `src/lib/**`, `src/panel/**` | `src/pos/**`, Dexie |
| `src/lib/**` | `src/lib/**` | `src/pos/**`, `src/panel/**` |
| `supabase/tests/**` | `./harness`, `./fixtures` | código de `src/` |

| Asunto | Única fuente de verdad |
|---|---|
| Esquema y reglas de negocio | `supabase/migrations/` (+ pruebas `supabase/tests/`) |
| Variables de entorno | `src/lib/env.ts` (zod); nunca `import.meta.env` en otro archivo |
| Backend (RPC, auth, storage) | `src/lib/backend.tsx` (`useBackend()`); clientes `pos` y `panel` separados |
| Hash de PIN | `src/lib/pin.ts` (PBKDF2-SHA256 WebCrypto) |
| Formato de dinero | `formatLempiras()` en `src/lib/utils.ts` — `L 1,234.50`, sin `Intl` |
| Tokens de diseño | `src/index.css` (`@theme`) |

## Reglas de código

1. **Imports:** dentro de `src/` siempre `@/…` sin extensión (`import { cn } from "@/lib/utils"`);
   en `supabase/tests/` y `e2e/` rutas relativas sin extensión (`./harness`). No hay scripts sueltos
   ejecutados con `node`: toda lógica corre bajo Vite, Vitest o Playwright.
2. **Máximo 400 líneas por archivo**; más, se divide por responsabilidad. Sin archivos barril.
3. **Validar en el borde:** toda entrada de formulario pasa por un esquema zod antes de llamar una RPC.
4. **Errores de backend:** `BackendError { code, message }`; `code` es el prefijo antes de `:` del
   mensaje SQL (`CODIGO_INVALIDO`, `NO_AUTORIZADO`, …) o `RED` si no hay conexión.
5. **Dinero:** `numeric` en SQL; en TS se redondea a 2 decimales con `round2()` de `src/lib/utils.ts`.
6. **Horas:** Honduras es UTC-6 sin horario de verano; usar `toLocalHN()` de `src/lib/utils.ts`.
7. **Pantallas de entrada** conservan su `h1`: `/` "POLLO CHILERO", `/pos` contiene "Caja",
   `/panel` contiene "Panel de socios" (los usa `e2e/smoke.spec.ts`).
8. **Sin dependencias nuevas** sin anotar el motivo en el commit; nunca `shadcn add` en un gate.

## Diseño

| Token | Valor | Uso |
|---|---|---|
| `primary` | `#c8102e` | botones de acción, encabezados, foco (texto blanco 5.89:1) |
| `accent` | `#ffd200` | pestaña de categoría activa (texto `#1f1f1f` 11.35:1) |
| `brand-orange` | `#f28c00` | solo encabezado/splash (texto `#1f1f1f`, nunca blanco) |
| `background` / `surface` | `#f5f5f5` / `#ffffff` | página / tarjetas |
| `foreground` / `muted-foreground` | `#1f1f1f` / `#5c5c5c` | texto / secundario |
| `success` / `warning` / `destructive` | `#1e7b34` / `#8a5200` / `#b00020` | estados (texto blanco ≥ 5.3:1) |

- Tipografía del sistema `system-ui, "Segoe UI", Roboto`, 700 en botones y encabezados; sin fuentes externas.
- Caja: tema claro, botones de producto `min-h-18 min-w-18` (72 px) con nombre y precio, pestañas de
  categoría grandes arriba, carrito a la derecha, total `text-5xl`, teclado numérico en pantalla.
- Panel: móvil primero, ancho máximo `max-w-5xl`. Radio `rounded-xl` en tarjetas, `rounded-lg` en botones.
- Movimiento: 150 ms `ease-out`, solo `opacity`/`transform`; respeta `prefers-reduced-motion`.

## Entorno

| Variable | Requerida desde | Uso |
|---|---|---|
| `VITE_SUPABASE_URL` | paso 8 | `src/lib/env.ts` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | paso 8 | `src/lib/env.ts` |

`.env.example`, `.env.test`, `.env.e2e` y `.env.e2e-mock` se versionan (valores falsos). `.env.local`
con valores reales nunca.

## Reglas por área

| Archivo | Aplica a |
|---|---|
| `.claude/rules/base-de-datos.md` | `supabase/**` |
| `.claude/rules/pos-offline.md` | `src/pos/**` |
| `.claude/rules/panel.md` | `src/panel/**` |
| `.claude/rules/pruebas.md` | `**/*.test.ts`, `**/*.test.tsx`, `e2e/**` |

## No negociable

1. Nunca escribir tablas directo desde el cliente: solo RPC `SECURITY DEFINER` que validan rol. Una
   tabla nueva llama `select app.secure_table('public.x'::regclass);` en su misma migración.
2. Nunca editar una migración ya aplicada en Supabase: se agrega una nueva (skill `agregar-migracion`).
3. Nunca borrar ni editar ventas, eventos, movimientos ni la bitácora: se anula o se ajusta.
4. Nunca enviar ni guardar un PIN en claro: solo sal + hash PBKDF2 (≥ 100 000 iteraciones).
5. Lovable puede editar UI, nunca `supabase/migrations/`, RPC ni `src/lib/backend.tsx` sin pasar los gates.
6. Nunca hacer `git push`, `supabase db push` ni crear recursos en la nube desde un gate.
7. Nunca marcar una tarea `done` con un gate fallando, ni editar un comando `verify` para que pase.
