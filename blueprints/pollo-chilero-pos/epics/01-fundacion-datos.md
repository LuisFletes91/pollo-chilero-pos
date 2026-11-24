# Epic 01: Fundación, hardware y base de datos

> Al terminar existe el proyecto con todos sus gates en verde, una prueba de impresora/gaveta usable en la caja real, y la base de datos completa
> de ventas e inventario en `supabase/migrations/`, endurecida (REVOKE + RLS con MFA + RPC `SECURITY DEFINER` + bitácora con hash) y probada en PGlite.

| | |
|---|---|
| **Epic id** | `01-fundacion-datos` |
| **Tareas** | `E1-T1` … `E1-T6` |
| **Depende de** | nada — empiece aquí |
| **Desbloquea** | `02-cierre-y-caja`, `03-operacion-panel-salida` |
| **En paralelo con** | secuencial: el gate de cada tarea recorre todo el árbol |

No necesita ningún otro archivo para completar este epic. Todo lo de abajo se repite aquí a propósito.

---

## Stack

Vite 8 + React 19 + TypeScript 6 · Tailwind CSS v4 (tokens en `src/index.css`) · react-router-dom 7 · TanStack Query 5 (panel) ·
Dexie 4 / IndexedDB (caja) · vite-plugin-pwa 2 · Supabase (Postgres + Auth + RLS + Storage) · Vitest 5 + jsdom · PGlite (pruebas SQL, sin Docker) ·
Playwright · ESLint 10 + Prettier 3. Gestor: `npm` (Node 24, `.nvmrc`). Las versiones exactas están en `package.json` y `package-lock.json`:
léalas, no adivine. Todos los comandos se ejecutan en **Git Bash** desde la raíz del proyecto.

| Tarea | Comando |
|---|---|
| Tipos | `npm run typecheck` |
| Lint · formato | `npm run lint` · `npm run format:check` (arreglar: `npm run format`) |
| Pruebas unitarias (un archivo) | `npm run test -- <ruta>` |
| Pruebas de BD en PGlite (un archivo) | `npm run test:db -- <ruta>` |
| Build | `npm run build` |
| E2E | `npm run e2e -- e2e/smoke.spec.ts` (navegadores: `npm run e2e:install`) |

**Gate:** `npm run typecheck && npm run lint && npm run format:check && npm run test` (+ `npm run test:db` desde la tarea `E1-T3`) pasa antes de
marcar cualquier tarea como `done`. No hay servicios que levantar: la base de datos de las pruebas es PGlite en proceso (`supabase/tests/harness.ts`)
y nunca se usa Supabase real, Docker ni credenciales en un gate.

## Subárbol de directorios

```
src/
  App.tsx                         # NUEVO (E1-T1): rutas /, /pos/*, /panel/*
  App.test.tsx                    # NUEVO (E1-T1)
  main.tsx                        # existe (workspace): BrowserRouter + App; solo lectura
  index.css                       # existe (workspace): tokens @theme, CSS de impresión 80 mm; solo lectura
  test/setup.ts                   # existe (workspace): fake-indexeddb + WebCrypto; solo lectura
  pos/PosRoutes.tsx               # NUEVO (E1-T1), editado en E1-T2 (ruta hardware)
  pos/print/escpos.ts             # NUEVO (E1-T2): codificación ESC/POS
  pos/print/serial.ts             # NUEVO (E1-T2): Web Serial
  pos/print/HardwareTestPage.tsx  # NUEVO (E1-T2)
  pos/print/hardware.test.tsx     # NUEVO (E1-T2)
  panel/PanelRoutes.tsx           # NUEVO (E1-T1)
e2e/smoke.spec.ts                 # NUEVO (E1-T1)
supabase/
  migrations/20261122000100_esquema_base.sql     # NUEVO (E1-T3)
  migrations/20261122000110_catalogo_inicial.sql # NUEVO (E1-T3)
  migrations/20261122000200_seguridad.sql        # NUEVO (E1-T4)
  migrations/20261122000300_ventas.sql           # NUEVO (E1-T5)
  migrations/20261122000400_inventario.sql       # NUEVO (E1-T6)
  tests/shim.sql                  # existe (workspace): imita auth/storage/roles de Supabase; solo lectura
  tests/harness.ts                # existe (workspace): createTestDb(), asRole(), dbFailure(); solo lectura
  tests/fixtures.ts               # NUEVO (E1-T4), editado en E1-T5
  tests/{esquema,catalogo,bitacora,seguridad,ventas,inventario}.test.ts   # NUEVOS
```

Todo lo que esté fuera de este subárbol queda fuera de alcance. Si una tarea parece exigir otro archivo, deténgase y repórtelo.

## Modelo de datos tocado aquí

| Entidad | Qué agrega este epic | Notas |
|---|---|---|
| `products`, `categories`, `inventory_items`, `recipes` | esquema + catálogo inicial de 59 productos y 42 ítems | código `CAT-NNN` inmutable, `legacy_code` del Excel |
| `staff`, `devices`, `pairing_codes`, `settings`, `locations` | esquema + RPC de identidad | PIN como sal + hash PBKDF2; caja = usuario Supabase ligado en `devices` |
| `audit_log` | bitácora con cadena sha256 por triggers | solo inserción; `app.audit_chain_check()` |
| `alerts` | tabla de alertas | la generan triggers y RPC |
| `shifts`, `pos_events`, `sales`, `sale_lines`, `payments`, `void_requests`, `drawer_openings`, `reprints` | ventas y su libro de eventos | idempotencia `(device_id, client_seq)` |
| `inventory_movements`, `purchases`, `cuts`, `internal_consumptions`, `inventory_counts`, `inventory_count_lines`, vista `inventory_stock` | inventario por receta | movimientos de solo inserción; costo promedio ponderado |

## Contratos

**Consumidos** — ya existen, no los reconstruya:

| De | Interfaz | Garantía |
|---|---|---|
| `workspace/` | `createTestDb(): Promise<PGlite>` (`supabase/tests/harness.ts`) | PGlite nuevo con `shim.sql` + todas las migraciones en orden de nombre |
| `workspace/` | `asRole(db, "anon" \| "authenticated", claims, fn)` | ejecuta `fn` en una transacción con `set local role` y `request.jwt.claims` |
| `workspace/` | `dbFailure(promise): Promise<{ code, message }>` | lanza si la promesa no falla |

**Producidos** — los epics siguientes dependen de estas firmas exactas:

| Export | Firma | Usado por |
|---|---|---|
| RPC `pos_claim_device` | `(p_code text, p_label text) → { device_id, label }` | `E2-T3` |
| RPC `pos_pull_snapshot` | `(p_since bigint) → { version, unchanged, device, categories, products, staff, settings }` | `E2-T3` |
| RPC `pos_push_events` | `(p_events jsonb) → { resultados: [{ client_seq, estado, error? }], recibido_en }` | `E3-T1` |
| RPC del supervisor | `create_pairing_code`, `upsert_staff`, `link_staff_by_email`, `set_device_active`, `confirm_transfer`, `reject_transfer`, `decide_void`, `ack_alert`, `register_purchase`, `register_cut`, `upsert_recipe`, `set_product`, `create_product`, `set_setting`, `set_item` | `E3-T3`, `E3-T4` |
| RPC de lectura | `panel_whoami`, `my_pin_params`, `verify_audit_chain` | `E3-T3`, `E3-T4`, `E3-T5` |
| `app.secure_table(regclass)` | RLS + REVOKE + lectura de panel + bitácora | toda migración futura |
| `src/pos/print/escpos.ts` | `encodeLines(lines, { cut }): Uint8Array` (sin pulso de gaveta: se abre a mano) | `E2-T5`, `E3-T2` |
| `src/pos/print/serial.ts` | `isWebSerialSupported()`, `getRememberedPort()`, `writeBytes(port, bytes, baud)` | `E3-T2` |

## Convenciones que muerden en esta área

- Las migraciones de este epic se escriben **literalmente** desde los bloques SQL de cada tarea. No "mejore" el SQL: las pruebas y los epics siguientes
  dependen de sus nombres y mensajes de error.
- Nada de `pgcrypto` ni `uuid-ossp`: `sha256(convert_to(x, 'UTF8'))`, `gen_random_uuid()` y `uuid_send()` son nativos y funcionan en PGlite.
- Toda tabla creada después de `E1-T4` llama `select app.secure_table('public.x'::regclass);` en su misma migración; las pruebas de propiedad de
  `E1-T3` y `E1-T4` (bitácora en toda tabla, RLS en toda tabla, `anon` sin privilegios) se re-ejecutan en cada `npm run test:db` y fallan si se olvida.
- Las pruebas corren como superusuario de PGlite salvo dentro de `asRole(...)`; el superusuario ignora RLS, así que toda prueba de permisos usa `asRole`.
- Imports dentro de `src/` siempre con `@/…` sin extensión; en `supabase/tests/` y `e2e/` rutas relativas sin extensión (`./harness`). No hay
  scripts ejecutados con `node` suelto: todo corre bajo Vite, Vitest o Playwright (matriz de resolución en `blueprint.md` §19.6).
- Errores SQL: `raise exception 'CODIGO: detalle' using errcode = 'P0001'` (o `'42501'` para permisos). El cliente usa el prefijo como `code`.
- Fechas de negocio: Honduras UTC-6 sin horario de verano → `app.local_date()` en SQL y `toLocalHN()` en TypeScript. Nunca nombres de zona horaria.
- Prohibido `.skip(` / `.only(` en pruebas: el último comando de cada Verify lo busca.
- Reglas por área: `.claude/rules/base-de-datos.md`, `pos-offline.md`, `panel.md`, `pruebas.md`; reglas globales: `CLAUDE.md`. Todo eso ya está en la
  raíz del proyecto (el Bootstrap copió `workspace/` antes de la primera tarea).

---

## Tareas

En el mismo orden que `tasks.json`. Ese orden es el orden de construcción: trabaje de arriba hacia abajo y no reordene por prioridad.

### `E1-T1` — Andamiaje, toolchain y gates con prueba de humo

**Depende de:** nada · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 1

Los archivos de configuración ya están en la raíz (copia de `workspace/` hecha por el Bootstrap de §10):
`package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `vitest.db.config.ts`,
`playwright.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `index.html`,
`src/main.tsx`, `src/index.css`, `src/test/setup.ts`, `supabase/tests/shim.sql`, `supabase/tests/harness.ts`,
`public/icon.svg`. **No los edite en este paso** salvo lo que haga `npm run format`.

1. Ejecute `npm run e2e:install` (descarga Chromium para Playwright; en Linux/CI use `npx playwright install --with-deps chromium`).
2. Cree `src/App.tsx`: exporta por defecto `App`, que solo declara `<Routes>` (el `BrowserRouter` vive en `src/main.tsx`):
   - `/` → `<main>` con `<h1>POLLO CHILERO</h1>`, subtítulo "Orgullo Catracho" y dos enlaces grandes: "Caja" → `/pos` y "Panel de socios" → `/panel`.
   - `/pos/*` → `<PosRoutes />` · `/panel/*` → `<PanelRoutes />` · `*` → `<Navigate to="/" replace />`.
3. Cree `src/pos/PosRoutes.tsx` (export nombrado `PosRoutes`): `<Routes>` con `index` → `<main><h1>Caja</h1>…</main>` (texto "Caja lista para configurarse").
4. Cree `src/panel/PanelRoutes.tsx` (export nombrado `PanelRoutes`): `index` → `<main><h1>Panel de socios</h1>…</main>`.
5. Cree `src/App.test.tsx`: renderiza `<MemoryRouter initialEntries={[ruta]}><App /></MemoryRouter>` para `/`, `/pos` y `/panel` y verifica con `getByRole("heading", { level: 1, name: /…/ })` los encabezados `POLLO CHILERO`, `Caja` y `Panel de socios`.
6. Cree `e2e/smoke.spec.ts` (proyecto `smoke`, puerto 4173): para cada ruta `/`, `/pos`, `/panel` hace `page.goto(ruta)` y `expect(page.getByRole("heading", { level: 1, name: /POLLO CHILERO|Caja|Panel de socios/ }))` con el nombre exacto que corresponde a cada ruta (regex `/POLLO CHILERO/`, `/Caja/`, `/Panel de socios/`).
7. Ejecute `npm run format` una vez (reconcilia el formato de los archivos copiados con `.prettierrc.json`; la fuente de estilo es ese archivo, no el valor por defecto de Prettier).

Usa clases de Tailwind con los tokens de `src/index.css` (`bg-primary text-primary-foreground`, `bg-background`, `text-foreground`).

**Files**

- `src/App.tsx`
- `src/pos/PosRoutes.tsx`
- `src/panel/PanelRoutes.tsx`
- `src/App.test.tsx`
- `e2e/smoke.spec.ts`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** se ejecuta `npm run typecheck` **EL SISTEMA DEBERÁ** salir con código 0 con `strict: true` en `tsconfig.json`.
2. **CUANDO** se ejecutan `npm run lint` y `npm run format:check` desde la raíz con el bundle presente en `blueprints/` **EL SISTEMA DEBERÁ** salir con código 0 en ambos.
3. **CUANDO** se ejecuta `npm run test` **EL SISTEMA DEBERÁ** ejecutar `src/App.test.tsx` y salir con código 0 con 0 pruebas fallidas.
4. **CUANDO** se ejecuta `npm run build` **EL SISTEMA DEBERÁ** generar `dist/index.html` y `dist/sw.js` y salir con código 0.
5. **CUANDO** `npm run e2e -- e2e/smoke.spec.ts` sirve el build de producción y abre `/`, `/pos` y `/panel` **EL SISTEMA DEBERÁ** mostrar los encabezados de nivel 1 `POLLO CHILERO`, `Caja` y `Panel de socios` y salir con código 0.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
test -f dist/index.html
test -f dist/sw.js
npm run e2e -- e2e/smoke.spec.ts
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T1 paso 1: andamiaje"
git tag step-01-andamiaje
git ls-files --error-unmatch package-lock.json   # expect: exit 0 — versionado por el commit de arriba
git ls-files --error-unmatch src/App.tsx   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

### `E1-T2` — Prueba temprana de impresora térmica y gaveta

**Depende de:** `E1-T1` · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 2

Objetivo: saber **antes de construir la caja** si la Nenotech ITP250 imprime por Web Serial, con un respaldo que siempre funciona
(`window.print()`). La gaveta **no** tiene conexión con el sistema y se abre a mano (decisión del usuario, 2026-11-23): no se envía pulso.

1. Antes de escribir código lea `node_modules/@point-of-sale/receipt-printer-encoder/README.md` y su
   `dist/receipt-printer-encoder.d.ts` (export por defecto `ReceiptPrinterEncoder`; métodos verificados
   en el `.d.ts` publicado 4.0.1: `initialize()`, `codepage()`, `line()`, `text()`, `newline()`, `bold()`,
   `align()`, `size()`, `table()`, `cut()`, `pulse(device?, on?, off?)`, `encode(): Uint8Array`; opciones
   `{ language: "esc-pos", columns: 48 }`).
2. `src/pos/print/escpos.ts`: `createEncoder(columns = 48)`; `encodeLines(lines: string[], opts: { cut: boolean }): Uint8Array`
   (initialize → `codepage("auto")` → cada línea → `cut("partial")`; **sin `pulse()`: la gaveta se abre a mano** — decisión del usuario 2026-11-23);
   `buildTestTicket(): Uint8Array` (líneas "POLLO CHILERO", "PRUEBA DE IMPRESORA", fecha local, "Ñandú áéíóú — L 1,234.50", 48 guiones) con corte;
3. `src/pos/print/serial.ts`: tipos mínimos propios (`SerialPortLike` con `open({ baudRate })`, `writable`, `close()`), sin depender de tipos DOM de Web Serial;
   `isWebSerialSupported()` (`"serial" in navigator`); `requestPrinterPort()` (gesto del usuario, `navigator.serial.requestPort()`);
   `getRememberedPort()` (`navigator.serial.getPorts()` → primero); `writeBytes(port, bytes, baudRate = 9600)` (abre si hace falta, escribe con `writer.write`, libera el lock).
4. `src/pos/print/HardwareTestPage.tsx` con `<h1>Caja — Prueba de impresora</h1>`: estado de soporte Web Serial; selector de baudios 9600/19200/38400/115200;
   botones "Emparejar impresora (Web Serial)" e "Imprimir ticket de prueba" (deshabilitados sin soporte o sin puerto) y
   "Imprimir con el navegador (respaldo)" que renderiza un `<pre className="receipt-80mm">` con el ticket y llama `window.print()`. Errores visibles en `role="alert"`.
5. `src/pos/PosRoutes.tsx`: agrega la ruta `hardware` → `<HardwareTestPage />` y un enlace "Prueba de impresora" en la pantalla índice.
6. `src/pos/print/hardware.test.tsx`: (a) los bytes de `buildTestTicket()` contienen la subsecuencia `1b 40` (ESC @) y `1d 56` (GS V);
   (b) los bytes de `buildTestTicket()` NO contienen `1b 70` (ESC p: la gaveta se abre a mano); (c) sin `navigator.serial`, `isWebSerialSupported()` es `false` y la página
   renderiza el botón "Imprimir con el navegador (respaldo)" habilitado, y al pulsarlo llama `window.print` (espía con `vi.spyOn(window, "print").mockImplementation(() => {})`).

La prueba física con la ITP250 (ticket impreso, gaveta abierta) no es un gate: está en §20.1.

**Files**

- `src/pos/print/escpos.ts`
- `src/pos/print/serial.ts`
- `src/pos/print/HardwareTestPage.tsx`
- `src/pos/PosRoutes.tsx`
- `src/pos/print/hardware.test.tsx`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** `npm run test -- src/pos/print/hardware.test.tsx` codifica el ticket de prueba **EL SISTEMA DEBERÁ** producir bytes que contienen la inicialización ESC @ (`1b 40`) y el corte GS V (`1d 56`).
2. **CUANDO** se codifica el ticket de prueba **EL SISTEMA NO DEBERÁ** incluir el pulso de gaveta ESC p (`1b 70`), porque la gaveta no tiene conexión con el sistema y se abre a mano.
3. **CUANDO** `navigator.serial` no existe **EL SISTEMA DEBERÁ** devolver `false` en `isWebSerialSupported()` y la página `/pos/hardware` DEBERÁ mostrar habilitado el botón "Imprimir con el navegador (respaldo)".
4. **CUANDO** se pulsa "Imprimir con el navegador (respaldo)" **EL SISTEMA DEBERÁ** renderizar el ticket en un elemento con la clase `receipt-80mm` y llamar `window.print()` una vez.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test -- src/pos/print/hardware.test.tsx
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T2 paso 2: hardware-impresora"
git tag step-02-hardware-impresora
git ls-files --error-unmatch src/pos/print/escpos.ts   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

### `E1-T3` — Esquema base, bitácora con hash y catálogo de 59 productos

**Depende de:** `E1-T1` · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 3

1. Cree `supabase/migrations/20261122000100_esquema_base.sql` con el contenido literal del bloque **M-0100** (abajo).
2. Cree `supabase/migrations/20261122000110_catalogo_inicial.sql` con el contenido literal del bloque **M-0110** (abajo): 59 productos con código
   permanente `CAT-NNN` y `legacy_code` del Excel, 6 categorías, 42 ítems de inventario, recetas de todos los productos y los ajustes iniciales.
3. `supabase/tests/esquema.test.ts` (usa `createTestDb()` de `./harness` en `beforeAll`):
   - cada tabla de esta etapa existe: `select to_regclass('public.<t>') is not null` para `locations`, `categories`, `products`, `inventory_items`,
     `recipes`, `staff`, `devices`, `pairing_codes`, `settings`, `alerts`, `audit_log`;
   - **propiedad que se re-ejecuta en todos los pasos siguientes:** ninguna tabla de `public` (relkind `r`) distinta de `audit_log` carece del trigger `audit_row`
     (consulta sobre `pg_trigger`/`pg_class`/`pg_namespace`; el resultado debe ser 0 filas);
   - `delete from products where code = 'CF-001'` y `update products set code = 'CF-999' where code = 'CF-001'` fallan con mensaje que empieza por `CODIGO_INMUTABLE`.
4. `supabase/tests/catalogo.test.ts`: 59 productos activos; todos los `code` cumplen `^(CF|CP|PZ|CI|EX|BE)-[0-9]{3}$`; `legacy_code` únicos y no nulos;
   recetas de `PZ-001…PZ-005` = (ALA, PIERNA, MUSLO, PECHUGA) (1,1,1,1), (2,2,1,1), (2,2,2,2), (3,3,3,3), (6,6,6,6); cada `BE-NNN` tiene receta 1:1 con el ítem
   `BE-NNN`; `CF-001` descuenta MUSLO 2, PIERNA 1, ALA 1, PAPA-PERS 1, BE-008 1; todo producto tiene al menos una línea de receta;
   **paridad con el Excel:** `select sum(price) from products` = 6667.00 (suma de la columna "Precio final" de las 59 filas del Excel) y
   `CF-001` = 209.00 con `legacy_code` `P001`, `BE-027` = 20.00 con `legacy_code` `P0059`.
5. `supabase/tests/bitacora.test.ts`: `update products set price = 210 where code = 'CF-001'` inserta exactamente 1 fila nueva en `audit_log` con `action = 'UPDATE'`,
   `before ->> 'price' = '209.00'`, `after ->> 'price' = '210.00'`; `select * from app.audit_chain_check()` devuelve `ok = true`;
   `update audit_log set after = '{}'` falla con `BITACORA_INMUTABLE`; con `alter table public.audit_log disable trigger audit_log_inmutable` se altera la fila
   anterior, se rehabilita el trigger y `app.audit_chain_check()` devuelve `ok = false` con `first_bad_id` igual al id alterado.

Las pruebas corren como superusuario de PGlite (las de rol llegan en el paso 4).

#### Bloque M-0100 — `supabase/migrations/20261122000100_esquema_base.sql`

```sql
-- supabase/migrations/20261122000100_esquema_base.sql  (paso 3)
-- Esquema base + bitácora con cadena de hash. Sin pgcrypto: sha256() y gen_random_uuid() nativos.
create schema if not exists app;
revoke all on schema app from public;

-- Honduras: UTC-6 sin horario de verano. Aritmética fija: no depende de tzdata (PGlite).
create or replace function app.local_ts(p_ts timestamptz) returns timestamp
language sql immutable set search_path = '' as $$
  select (p_ts at time zone 'UTC') - interval '6 hours'
$$;

create or replace function app.local_date(p_ts timestamptz) returns date
language sql immutable set search_path = '' as $$
  select (app.local_ts(p_ts))::date
$$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create sequence app.snapshot_version;

create or replace function app.bump_snapshot_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform nextval('app.snapshot_version');
  return null;
end $$;

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.categories (
  code text primary key check (code in ('CF', 'CP', 'PZ', 'CI', 'EX', 'BE')),
  name text not null,
  sort_order smallint not null unique,
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^(CF|CP|PZ|CI|EX|BE)-[0-9]{3}$'),
  legacy_code text unique,
  name text not null check (length(trim(name)) > 0),
  category_code text not null references public.categories (code),
  price numeric(12, 2) not null check (price > 0),
  isv_rate numeric(4, 2) not null default 0.15 check (isv_rate in (0.00, 0.15, 0.18)),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_code_matches_category check (left(code, 2) = category_code)
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9-]{2,20}$'),
  name text not null check (length(trim(name)) > 0),
  kind text not null check (kind in ('pollo_entero', 'pieza', 'bebida', 'insumo', 'desechable')),
  unit text not null default 'u',
  min_stock numeric(12, 3) not null default 0 check (min_stock >= 0),
  avg_cost numeric(12, 4) not null default 0 check (avg_cost >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recipes (
  product_id uuid not null references public.products (id) on delete restrict,
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  qty numeric(12, 3) not null check (qty > 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, item_id)
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(trim(display_name)) > 0),
  role text not null check (role in ('cajero', 'supervisor', 'socio')),
  auth_user_id uuid unique,
  pin_salt text check (pin_salt ~ '^[0-9a-f]{32}$'),
  pin_hash text check (pin_hash ~ '^[0-9a-f]{64}$'),
  pin_iterations integer not null default 210000 check (pin_iterations >= 100000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_pin_pair check ((pin_salt is null) = (pin_hash is null))
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id),
  label text not null check (length(trim(label)) > 0),
  auth_user_id uuid not null unique,
  last_client_seq bigint not null default 0,
  last_receipt_number bigint not null default 0,
  last_seen_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pairing_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  label text not null,
  created_by uuid not null references public.staff (id),
  expires_at timestamptz not null,
  used_at timestamptz,
  device_id uuid references public.devices (id),
  created_at timestamptz not null default now()
);

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.alerts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in (
    'diferencia_caja', 'merma', 'anulacion', 'reimpresion', 'apertura_sin_venta',
    'hueco_numeracion', 'fuera_de_horario', 'caja_sin_sincronizar', 'transferencia_rechazada',
    'stock_bajo', 'pin_bloqueado', 'evento_rechazado', 'precio_distinto', 'venta_tras_cierre',
    'rango_fiscal'
  )),
  severity text not null default 'media' check (severity in ('baja', 'media', 'alta')),
  business_date date,
  message text not null,
  ref_type text,
  ref_id text,
  created_at timestamptz not null default now(),
  acknowledged_by uuid references public.staff (id),
  acknowledged_at timestamptz
);

create index alerts_abiertas_idx on public.alerts (created_at desc) where acknowledged_at is null;

-- Códigos permanentes: nunca se reasignan ni se borran (solo active = false).
create or replace function app.code_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'CODIGO_INMUTABLE: % no se borra; se desactiva con active = false', tg_table_name
      using errcode = 'P0001';
  end if;
  if (to_jsonb(new) ->> 'code') <> (to_jsonb(old) ->> 'code')
     or (to_jsonb(new) ->> 'legacy_code') is distinct from (to_jsonb(old) ->> 'legacy_code') then
    raise exception 'CODIGO_INMUTABLE: el código de % no cambia', tg_table_name using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger products_code_guard before update or delete on public.products
  for each row execute function app.code_guard();
create trigger inventory_items_code_guard before update or delete on public.inventory_items
  for each row execute function app.code_guard();

create trigger products_touch before update on public.products
  for each row execute function app.touch_updated_at();
create trigger inventory_items_touch before update on public.inventory_items
  for each row execute function app.touch_updated_at();
create trigger recipes_touch before update on public.recipes
  for each row execute function app.touch_updated_at();
create trigger staff_touch before update on public.staff
  for each row execute function app.touch_updated_at();
create trigger devices_touch before update on public.devices
  for each row execute function app.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function app.touch_updated_at();
create trigger categories_touch before update on public.categories
  for each row execute function app.touch_updated_at();

create trigger products_snapshot after insert or update or delete on public.products
  for each statement execute function app.bump_snapshot_version();
create trigger categories_snapshot after insert or update or delete on public.categories
  for each statement execute function app.bump_snapshot_version();
create trigger staff_snapshot after insert or update or delete on public.staff
  for each statement execute function app.bump_snapshot_version();
create trigger settings_snapshot after insert or update or delete on public.settings
  for each statement execute function app.bump_snapshot_version();

-- ===================== Bitácora antifraude =====================
create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null,
  actor_staff_id uuid,
  actor_auth_uid uuid,
  device_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  prev_hash text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  hash text not null unique check (hash ~ '^[0-9a-f]{64}$')
);

-- Forma canónica: fecha en UTC como texto fijo (no depende de TimeZone de la sesión).
create or replace function app.audit_canonical(
  p_occurred_at timestamptz, p_actor_staff_id uuid, p_actor_auth_uid uuid, p_device_id uuid,
  p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb
) returns text
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'occurred_at', to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor_staff_id', p_actor_staff_id,
    'actor_auth_uid', p_actor_auth_uid,
    'device_id', p_device_id,
    'action', p_action,
    'entity', p_entity,
    'entity_id', p_entity_id,
    'before', p_before,
    'after', p_after
  )::text
$$;

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
  v_entity_id text;
  v_prev text;
  v_at timestamptz := clock_timestamp();
  v_staff uuid := nullif(current_setting('app.actor_staff_id', true), '')::uuid;
  v_device uuid := nullif(current_setting('app.actor_device_id', true), '')::uuid;
  v_uid uuid := auth.uid();
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new); end if;
  v_row := coalesce(v_after, v_before);
  v_entity_id := coalesce(
    v_row ->> 'id', v_row ->> 'code', v_row ->> 'key',
    concat_ws(':', v_row ->> 'product_id', v_row ->> 'item_id')
  );
  perform pg_advisory_xact_lock(42001);
  select a.hash into v_prev from public.audit_log a order by a.id desc limit 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  insert into public.audit_log (
    occurred_at, actor_staff_id, actor_auth_uid, device_id, action, entity, entity_id,
    before, after, prev_hash, hash
  ) values (
    v_at, v_staff, v_uid, v_device, tg_op, tg_table_name, v_entity_id, v_before, v_after, v_prev,
    encode(sha256(convert_to(v_prev || app.audit_canonical(
      v_at, v_staff, v_uid, v_device, tg_op, tg_table_name, v_entity_id, v_before, v_after
    ), 'UTF8')), 'hex')
  );
  return null;
end $$;

create or replace function app.audit_log_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'BITACORA_INMUTABLE: la bitácora no se modifica ni se borra' using errcode = 'P0001';
end $$;

create trigger audit_log_inmutable before update or delete on public.audit_log
  for each row execute function app.audit_log_immutable();
create trigger audit_log_sin_truncate before truncate on public.audit_log
  for each statement execute function app.audit_log_immutable();

create or replace function app.attach_audit(p_table regclass) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger t where t.tgrelid = p_table and t.tgname = 'audit_row'
  ) then
    execute format(
      'create trigger audit_row after insert or update or delete on %s for each row execute function app.audit_row()',
      p_table
    );
  end if;
end $$;

create or replace function app.audit_chain_check()
returns table (ok boolean, first_bad_id bigint, checked bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.audit_log;
  v_prev text := repeat('0', 64);
  v_n bigint := 0;
begin
  for r in select * from public.audit_log order by id loop
    v_n := v_n + 1;
    if r.prev_hash <> v_prev or r.hash <> encode(sha256(convert_to(r.prev_hash || app.audit_canonical(
      r.occurred_at, r.actor_staff_id, r.actor_auth_uid, r.device_id, r.action, r.entity,
      r.entity_id, r.before, r.after
    ), 'UTF8')), 'hex') then
      return query select false, r.id, v_n;
      return;
    end if;
    v_prev := r.hash;
  end loop;
  return query select true, null::bigint, v_n;
end $$;

select app.attach_audit(t)
from unnest(array[
  'public.locations', 'public.categories', 'public.products', 'public.inventory_items',
  'public.recipes', 'public.staff', 'public.devices', 'public.pairing_codes', 'public.settings',
  'public.alerts'
]::regclass[]) as t;
```

#### Bloque M-0110 — `supabase/migrations/20261122000110_catalogo_inicial.sql`

```sql
-- supabase/migrations/20261122000110_catalogo_inicial.sql  (paso 3)
-- Catálogo inicial de la franquicia: 59 productos (Excel 'sistema de EVER gerardo', hoja de productos).
-- Precios finales con ISV incluido. legacy_code conserva el código del Excel tal cual (P001…P0059).
insert into public.locations (name) values ('Pollo Chilero — Aldea El Ocotal, Olanchito, Yoro');

insert into public.categories (code, name, sort_order) values
  ('CF', 'Combos familiares', 1),
  ('CP', 'Combos personales', 2),
  ('PZ', 'Pollo en piezas', 3),
  ('CI', 'Combos infantiles', 4),
  ('EX', 'Extras', 5),
  ('BE', 'Bebidas', 6);

insert into public.settings (key, value) values
  ('cash_diff_threshold', '50'::jsonb),
  ('waste_threshold_pieces', '2'::jsonb),
  ('business_hours', '{"abre": "09:00", "cierra": "21:00"}'::jsonb),
  ('sync_stale_hours', '2'::jsonb),
  ('utc_offset_hours', '-6'::jsonb),
  ('denominations', '[500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1]'::jsonb),
  ('printer', '{"modo": "serial", "baudios": 9600, "columnas": 48}'::jsonb),
  ('pin_lockout', '{"intentos": 5, "segundos": 30}'::jsonb);

insert into public.products (code, legacy_code, name, category_code, price, isv_rate, sort_order) values
  ('CF-001', 'P001', '2 muslos + 1 pierna + 1 ala + 1 papa + 1 refresco', 'CF', 209.00, 0.15, 1),
  ('CF-002', 'P002', '6 piezas + 2 ensaladas + 2 papas', 'CF', 265.00, 0.15, 2),
  ('CF-003', 'P003', '8 piezas + 2 ensaladas + 2 papas', 'CF', 355.00, 0.15, 3),
  ('CF-004', 'P004', '12 piezas + 4 ensaladas + 3 papas + 1 refresco 2 L', 'CF', 765.00, 0.15, 4),
  ('CF-005', 'P005', '4 hamburguesas + 4 papas + 1 refresco 2 L', 'CF', 460.00, 0.15, 5),
  ('CF-006', 'P006', '8 hamburguesas + 8 papas + 1 refresco 2 L', 'CF', 845.00, 0.15, 6),
  ('CP-001', 'P007', '1 ala + 1 pierna + 1 papa + 1 refresco', 'CP', 107.00, 0.15, 1),
  ('CP-002', 'P008', '1 ala + 1 pierna + 1 ensalada + 1 refresco', 'CP', 128.00, 0.15, 2),
  ('CP-003', 'P009', '1 pechuga + 1 papa + 1 ensalada', 'CP', 100.00, 0.15, 3),
  ('CP-004', 'P0010', 'Hamburguesa sola', 'CP', 70.00, 0.15, 4),
  ('CP-005', 'P0011', 'Hamburguesa + 1 papa + 1 refresco', 'CP', 135.00, 0.15, 5),
  ('CP-006', 'P0012', 'Orden de tacos (2)', 'CP', 100.00, 0.15, 6),
  ('CP-007', 'P0013', 'Orden de enchiladas (2)', 'CP', 100.00, 0.15, 7),
  ('PZ-001', 'P0014', '4 piezas de pollo', 'PZ', 120.00, 0.15, 1),
  ('PZ-002', 'P0015', '6 piezas de pollo', 'PZ', 165.00, 0.15, 2),
  ('PZ-003', 'P0016', '8 piezas de pollo', 'PZ', 255.00, 0.15, 3),
  ('PZ-004', 'P0017', '12 piezas de pollo', 'PZ', 387.00, 0.15, 4),
  ('PZ-005', 'P0018', '24 piezas de pollo', 'PZ', 740.00, 0.15, 5),
  ('CI-001', 'P0019', '1 pierna + 1 papa + 1 jugo', 'CI', 70.00, 0.15, 1),
  ('CI-002', 'P0020', '1 pierna + 1 papa + 1 Pepsi', 'CI', 80.00, 0.15, 2),
  ('CI-003', 'P0021', 'Medallones + 1 papa + 1 jugo', 'CI', 75.00, 0.15, 3),
  ('CI-004', 'P0022', '1 pierna + 1 papa', 'CI', 50.00, 0.15, 4),
  ('CI-005', 'P0023', 'Papitas con queso + 1 jugo', 'CI', 50.00, 0.15, 5),
  ('CI-006', 'P00024', 'Hamburguesa + 1 papa (infantil)', 'CI', 95.00, 0.15, 6),
  ('EX-001', 'P0025', 'Ensalada', 'EX', 25.00, 0.15, 1),
  ('EX-002', 'P0026', 'Papas personales', 'EX', 25.00, 0.15, 2),
  ('EX-003', 'P0027', 'Papas familiares', 'EX', 50.00, 0.15, 3),
  ('EX-004', 'P0028', 'Tortillas', 'EX', 15.00, 0.15, 4),
  ('EX-005', 'P0029', 'Pechuga', 'EX', 50.00, 0.15, 5),
  ('EX-006', 'P0030', 'Ala', 'EX', 25.00, 0.15, 6),
  ('EX-007', 'P0031', 'Pierna', 'EX', 25.00, 0.15, 7),
  ('EX-008', 'P0032', 'Muslo', 'EX', 32.00, 0.15, 8),
  ('BE-001', 'P0033', 'Pepsi 3 L', 'BE', 75.00, 0.15, 1),
  ('BE-002', 'P0034', 'Pepsi 2 L', 'BE', 58.00, 0.15, 2),
  ('BE-003', 'P0035', 'Pepsi 1.5 L', 'BE', 48.00, 0.15, 3),
  ('BE-004', 'P0036', '1 1/4 L Pepsi, Mirinda, 7up', 'BE', 38.00, 0.15, 4),
  ('BE-005', 'P0037', 'Litro mega vidrio Pepsi y Mirinda', 'BE', 32.00, 0.15, 5),
  ('BE-006', 'P0038', 'Jugo galón', 'BE', 55.00, 0.15, 6),
  ('BE-007', 'P0039', 'Jugo 1/2 galón', 'BE', 35.00, 0.15, 7),
  ('BE-008', 'P0040', '12 oz Pepsi, Mirinda, naranja, uva, 7up, Teen', 'BE', 13.00, 0.15, 8),
  ('BE-009', 'P0041', 'Agua en bolsa', 'BE', 5.00, 0.15, 9),
  ('BE-010', 'P0042', 'Agua bote', 'BE', 10.00, 0.15, 10),
  ('BE-011', 'P0043', 'Montana naranja y manzana', 'BE', 7.00, 0.15, 11),
  ('BE-012', 'P0044', 'Pepsi personal y sabores', 'BE', 25.00, 0.15, 12),
  ('BE-013', 'P0045', 'Té frío pequeño', 'BE', 20.00, 0.15, 13),
  ('BE-014', 'P0046', 'Té frío grande', 'BE', 25.00, 0.15, 14),
  ('BE-015', 'P0047', 'Jugo Quanty personal', 'BE', 15.00, 0.15, 15),
  ('BE-016', 'P0048', 'Jugo Enjoy personal', 'BE', 15.00, 0.15, 16),
  ('BE-017', 'P0049', 'Gatorade pequeño', 'BE', 25.00, 0.15, 17),
  ('BE-018', 'P0050', 'Gatorade grande', 'BE', 35.00, 0.15, 18),
  ('BE-019', 'P0051', 'Sting', 'BE', 10.00, 0.15, 19),
  ('BE-020', 'P0052', 'Link coco y banana', 'BE', 7.00, 0.15, 20),
  ('BE-021', 'P0053', 'Mini Pepsi', 'BE', 8.00, 0.15, 21),
  ('BE-022', 'P0054', 'Enjoy lata', 'BE', 15.00, 0.15, 22),
  ('BE-023', 'P0055', 'Pepsi Zero lata', 'BE', 20.00, 0.15, 23),
  ('BE-024', 'P0056', 'Mountain Dew verde y rosada', 'BE', 23.00, 0.15, 24),
  ('BE-025', 'P0057', 'Adrenalina pequeña', 'BE', 45.00, 0.15, 25),
  ('BE-026', 'P0058', 'Quanty pequeño', 'BE', 10.00, 0.15, 26),
  ('BE-027', 'P0059', 'Link personal de sabores', 'BE', 20.00, 0.15, 27);

insert into public.inventory_items (code, name, kind) values
  ('POLLO-ENTERO', 'Pollo entero', 'pollo_entero'),
  ('PECHUGA', 'Pechuga', 'pieza'),
  ('MUSLO', 'Muslo', 'pieza'),
  ('PIERNA', 'Pierna', 'pieza'),
  ('ALA', 'Ala', 'pieza'),
  ('PAPA-PERS', 'Papas porción personal', 'insumo'),
  ('PAPA-FAM', 'Papas porción familiar', 'insumo'),
  ('ENSALADA', 'Ensalada porción', 'insumo'),
  ('TORTILLAS', 'Tortillas (orden)', 'insumo'),
  ('PAN-HAMB', 'Pan de hamburguesa', 'insumo'),
  ('CARNE-HAMB', 'Carne de hamburguesa', 'insumo'),
  ('TACO', 'Taco', 'insumo'),
  ('ENCHILADA', 'Enchilada', 'insumo'),
  ('MEDALLONES', 'Medallones porción', 'insumo'),
  ('PAPITAS-QUESO', 'Papitas con queso porción', 'insumo'),
  ('BE-001', 'Pepsi 3 L', 'bebida'),
  ('BE-002', 'Pepsi 2 L', 'bebida'),
  ('BE-003', 'Pepsi 1.5 L', 'bebida'),
  ('BE-004', '1 1/4 L Pepsi, Mirinda, 7up', 'bebida'),
  ('BE-005', 'Litro mega vidrio Pepsi y Mirinda', 'bebida'),
  ('BE-006', 'Jugo galón', 'bebida'),
  ('BE-007', 'Jugo 1/2 galón', 'bebida'),
  ('BE-008', '12 oz Pepsi, Mirinda, naranja, uva, 7up, Teen', 'bebida'),
  ('BE-009', 'Agua en bolsa', 'bebida'),
  ('BE-010', 'Agua bote', 'bebida'),
  ('BE-011', 'Montana naranja y manzana', 'bebida'),
  ('BE-012', 'Pepsi personal y sabores', 'bebida'),
  ('BE-013', 'Té frío pequeño', 'bebida'),
  ('BE-014', 'Té frío grande', 'bebida'),
  ('BE-015', 'Jugo Quanty personal', 'bebida'),
  ('BE-016', 'Jugo Enjoy personal', 'bebida'),
  ('BE-017', 'Gatorade pequeño', 'bebida'),
  ('BE-018', 'Gatorade grande', 'bebida'),
  ('BE-019', 'Sting', 'bebida'),
  ('BE-020', 'Link coco y banana', 'bebida'),
  ('BE-021', 'Mini Pepsi', 'bebida'),
  ('BE-022', 'Enjoy lata', 'bebida'),
  ('BE-023', 'Pepsi Zero lata', 'bebida'),
  ('BE-024', 'Mountain Dew verde y rosada', 'bebida'),
  ('BE-025', 'Adrenalina pequeña', 'bebida'),
  ('BE-026', 'Quanty pequeño', 'bebida'),
  ('BE-027', 'Link personal de sabores', 'bebida');

insert into public.recipes (product_id, item_id, qty)
select p.id, i.id, r.qty
from (values
  ('CF-001', 'MUSLO', 2),
  ('CF-001', 'PIERNA', 1),
  ('CF-001', 'ALA', 1),
  ('CF-001', 'PAPA-PERS', 1),
  ('CF-001', 'BE-008', 1),
  ('CF-002', 'ALA', 2),
  ('CF-002', 'PIERNA', 2),
  ('CF-002', 'MUSLO', 1),
  ('CF-002', 'PECHUGA', 1),
  ('CF-002', 'ENSALADA', 2),
  ('CF-002', 'PAPA-PERS', 2),
  ('CF-003', 'ALA', 2),
  ('CF-003', 'PIERNA', 2),
  ('CF-003', 'MUSLO', 2),
  ('CF-003', 'PECHUGA', 2),
  ('CF-003', 'ENSALADA', 2),
  ('CF-003', 'PAPA-PERS', 2),
  ('CF-004', 'ALA', 3),
  ('CF-004', 'PIERNA', 3),
  ('CF-004', 'MUSLO', 3),
  ('CF-004', 'PECHUGA', 3),
  ('CF-004', 'ENSALADA', 4),
  ('CF-004', 'PAPA-PERS', 3),
  ('CF-004', 'BE-002', 1),
  ('CF-005', 'PAN-HAMB', 4),
  ('CF-005', 'CARNE-HAMB', 4),
  ('CF-005', 'PAPA-PERS', 4),
  ('CF-005', 'BE-002', 1),
  ('CF-006', 'PAN-HAMB', 8),
  ('CF-006', 'CARNE-HAMB', 8),
  ('CF-006', 'PAPA-PERS', 8),
  ('CF-006', 'BE-002', 1),
  ('CP-001', 'ALA', 1),
  ('CP-001', 'PIERNA', 1),
  ('CP-001', 'PAPA-PERS', 1),
  ('CP-001', 'BE-008', 1),
  ('CP-002', 'ALA', 1),
  ('CP-002', 'PIERNA', 1),
  ('CP-002', 'ENSALADA', 1),
  ('CP-002', 'BE-008', 1),
  ('CP-003', 'PECHUGA', 1),
  ('CP-003', 'PAPA-PERS', 1),
  ('CP-003', 'ENSALADA', 1),
  ('CP-004', 'PAN-HAMB', 1),
  ('CP-004', 'CARNE-HAMB', 1),
  ('CP-005', 'PAN-HAMB', 1),
  ('CP-005', 'CARNE-HAMB', 1),
  ('CP-005', 'PAPA-PERS', 1),
  ('CP-005', 'BE-008', 1),
  ('CP-006', 'TACO', 2),
  ('CP-007', 'ENCHILADA', 2),
  ('PZ-001', 'ALA', 1),
  ('PZ-001', 'PIERNA', 1),
  ('PZ-001', 'MUSLO', 1),
  ('PZ-001', 'PECHUGA', 1),
  ('PZ-002', 'ALA', 2),
  ('PZ-002', 'PIERNA', 2),
  ('PZ-002', 'MUSLO', 1),
  ('PZ-002', 'PECHUGA', 1),
  ('PZ-003', 'ALA', 2),
  ('PZ-003', 'PIERNA', 2),
  ('PZ-003', 'MUSLO', 2),
  ('PZ-003', 'PECHUGA', 2),
  ('PZ-004', 'ALA', 3),
  ('PZ-004', 'PIERNA', 3),
  ('PZ-004', 'MUSLO', 3),
  ('PZ-004', 'PECHUGA', 3),
  ('PZ-005', 'ALA', 6),
  ('PZ-005', 'PIERNA', 6),
  ('PZ-005', 'MUSLO', 6),
  ('PZ-005', 'PECHUGA', 6),
  ('CI-001', 'PIERNA', 1),
  ('CI-001', 'PAPA-PERS', 1),
  ('CI-001', 'BE-015', 1),
  ('CI-002', 'PIERNA', 1),
  ('CI-002', 'PAPA-PERS', 1),
  ('CI-002', 'BE-008', 1),
  ('CI-003', 'MEDALLONES', 1),
  ('CI-003', 'PAPA-PERS', 1),
  ('CI-003', 'BE-015', 1),
  ('CI-004', 'PIERNA', 1),
  ('CI-004', 'PAPA-PERS', 1),
  ('CI-005', 'PAPITAS-QUESO', 1),
  ('CI-005', 'BE-015', 1),
  ('CI-006', 'PAN-HAMB', 1),
  ('CI-006', 'CARNE-HAMB', 1),
  ('CI-006', 'PAPA-PERS', 1),
  ('EX-001', 'ENSALADA', 1),
  ('EX-002', 'PAPA-PERS', 1),
  ('EX-003', 'PAPA-FAM', 1),
  ('EX-004', 'TORTILLAS', 1),
  ('EX-005', 'PECHUGA', 1),
  ('EX-006', 'ALA', 1),
  ('EX-007', 'PIERNA', 1),
  ('EX-008', 'MUSLO', 1),
  ('BE-001', 'BE-001', 1),
  ('BE-002', 'BE-002', 1),
  ('BE-003', 'BE-003', 1),
  ('BE-004', 'BE-004', 1),
  ('BE-005', 'BE-005', 1),
  ('BE-006', 'BE-006', 1),
  ('BE-007', 'BE-007', 1),
  ('BE-008', 'BE-008', 1),
  ('BE-009', 'BE-009', 1),
  ('BE-010', 'BE-010', 1),
  ('BE-011', 'BE-011', 1),
  ('BE-012', 'BE-012', 1),
  ('BE-013', 'BE-013', 1),
  ('BE-014', 'BE-014', 1),
  ('BE-015', 'BE-015', 1),
  ('BE-016', 'BE-016', 1),
  ('BE-017', 'BE-017', 1),
  ('BE-018', 'BE-018', 1),
  ('BE-019', 'BE-019', 1),
  ('BE-020', 'BE-020', 1),
  ('BE-021', 'BE-021', 1),
  ('BE-022', 'BE-022', 1),
  ('BE-023', 'BE-023', 1),
  ('BE-024', 'BE-024', 1),
  ('BE-025', 'BE-025', 1),
  ('BE-026', 'BE-026', 1),
  ('BE-027', 'BE-027', 1)
) as r (product_code, item_code, qty)
join public.products p on p.code = r.product_code
join public.inventory_items i on i.code = r.item_code;

do $$
begin
  if exists (
    select 1 from public.products p
    where not exists (select 1 from public.recipes r where r.product_id = p.id)
  ) then
    raise exception 'SEED_RECETAS_INCOMPLETAS: hay productos sin receta';
  end if;
end $$;

-- productos 59 recetas 122 items 42
```

**Files**

- `supabase/migrations/20261122000100_esquema_base.sql`
- `supabase/migrations/20261122000110_catalogo_inicial.sql`
- `supabase/tests/esquema.test.ts`
- `supabase/tests/catalogo.test.ts`
- `supabase/tests/bitacora.test.ts`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** `npm run test:db` aplica `supabase/tests/shim.sql` y todas las migraciones en PGlite **EL SISTEMA DEBERÁ** salir con código 0 y existir las tablas `locations`, `categories`, `products`, `inventory_items`, `recipes`, `staff`, `devices`, `pairing_codes`, `settings`, `alerts` y `audit_log`.
2. **CUANDO** se consulta `products` tras las migraciones **EL SISTEMA DEBERÁ** contener exactamente 59 productos activos, cada uno con `code` que cumple `^(CF|CP|PZ|CI|EX|BE)-[0-9]{3}$` y un `legacy_code` único.
3. **CUANDO** se leen las recetas de `PZ-001`, `PZ-002`, `PZ-003`, `PZ-004` y `PZ-005` **EL SISTEMA DEBERÁ** devolver (ALA, PIERNA, MUSLO, PECHUGA) = (1,1,1,1), (2,2,1,1), (2,2,2,2), (3,3,3,3) y (6,6,6,6).
4. **CUANDO** se intenta `DELETE` de un producto o `UPDATE` de su `code` **EL SISTEMA DEBERÁ** rechazarlo con un error cuyo mensaje empieza por `CODIGO_INMUTABLE`.
5. **CUANDO** se actualiza el precio de `CF-001` **EL SISTEMA DEBERÁ** insertar exactamente una fila en `audit_log` con `before` y `after`, y `app.audit_chain_check()` DEBERÁ devolver `ok = true`.
6. **CUANDO** una fila de `audit_log` se altera con el trigger `audit_log_inmutable` deshabilitado **EL SISTEMA DEBERÁ** hacer que `app.audit_chain_check()` devuelva `ok = false` con el `first_bad_id` de esa fila, y un `UPDATE` normal sobre `audit_log` DEBERÁ fallar con `BITACORA_INMUTABLE`.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test:db -- supabase/tests/esquema.test.ts supabase/tests/catalogo.test.ts supabase/tests/bitacora.test.ts
npm run test:db
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T3 paso 3: esquema-catalogo"
git tag step-03-esquema-catalogo
git ls-files --error-unmatch supabase/migrations/20261122000110_catalogo_inicial.sql   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

### `E1-T4` — Seguridad de BD: REVOKE, RLS con MFA y emparejamiento

**Depende de:** `E1-T3` · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 4

1. Cree `supabase/migrations/20261122000200_seguridad.sql` con el contenido literal del bloque **M-0200** (abajo).
2. Cree `supabase/tests/fixtures.ts` (solo superusuario; usa `PGlite` del arnés):
   - `panelUser(db, role: "socio" | "supervisor", opts?: { pin?: { salt: string; hash: string } })` → inserta `auth.users` (email `<uuid>@prueba.hn`) y un `staff`
     ligado; devuelve `{ staffId, uid, claims(aal: "aal1" | "aal2") }`;
   - `cashier(db, name, pin?: { salt, hash })` y `supervisorStaff(db, name, pin?)` → `staff` sin usuario de panel; devuelven el id;
   - `device(db, label = "Caja 1")` → inserta `auth.users` anónimo y `devices` ligado; devuelve `{ deviceId, uid, claims }` (claims `{ sub: uid }`);
   - `anonUser(db)` → `auth.users` anónimo sin identidad; devuelve `{ uid, claims }`.
   Sal/hash de prueba: cadenas hex válidas (`"0".repeat(32)`, `"a".repeat(64)`); la BD no verifica PBKDF2.
3. `supabase/tests/seguridad.test.ts` con `asRole()` y `dbFailure()` de `./harness`:
   - **Propiedades (se re-ejecutan en cada paso posterior):** toda tabla de `public` tiene `relrowsecurity = true`; para toda tabla o vista de `public`,
     `has_table_privilege('anon', oid, 'SELECT')`, `'INSERT'`, `'UPDATE'` y `'DELETE'` son falsos; para toda tabla,
     `has_table_privilege('authenticated', oid, 'INSERT')`, `'UPDATE'` y `'DELETE'` son falsos; para toda función de `public`,
     `has_function_privilege('anon', oid, 'EXECUTE')` es falso; en el esquema `app` las únicas funciones ejecutables por `authenticated` son
     `is_panel_reader` e `is_panel_supervisor`.
   - `authenticated` haciendo `insert into products …`, `update staff …` o `delete from audit_log` → `code = '42501'`.
   - socio con `aal1` → `select count(*) from products` = 0; con `aal2` = 59.
   - supervisor `aal2` llama `create_pairing_code('Caja 1')` → `{ code, expires_at }` (8 caracteres del alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789`);
     un `anonUser` hace `pos_claim_device(code)` → crea 1 `devices` activo con su `auth_user_id`; otro `anonUser` con el mismo código → `CODIGO_INVALIDO`.
   - el dispositivo llama `pos_pull_snapshot(0)` → `unchanged = false`, 59 `products`, 6 `categories`, `settings.cash_diff_threshold = 50`, y `staff` incluye
     `pin_hash` de un cajero con PIN; `pos_pull_snapshot(<version>)` → `unchanged = true`; un usuario de panel llamando `pos_pull_snapshot` → `NO_AUTORIZADO`.
   - socio `aal2` llama `create_pairing_code` o `upsert_staff` → `NO_AUTORIZADO`; `panel_whoami()` con `aal1` → `MFA_REQUERIDO`.

#### Bloque M-0200 — `supabase/migrations/20261122000200_seguridad.sql`

```sql
-- supabase/migrations/20261122000200_seguridad.sql  (paso 4)
-- Regla: ninguna tabla se escribe directo desde el cliente. Lecturas por RLS (panel con MFA);
-- toda escritura por funciones SECURITY DEFINER con search_path = '' que validan identidad y rol.

-- 1) Funciones: nada ejecutable por PUBLIC/anon; lo nuevo tampoco (privilegios por defecto).
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema app from public, anon, authenticated;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema app to authenticated;

-- 2) Identidad
create or replace function app.panel_staff_id(p_roles text[]) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.staff s
  where s.auth_user_id = auth.uid()
    and s.active
    and s.role = any (p_roles)
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create or replace function app.is_panel_reader() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.panel_staff_id(array['socio', 'supervisor']) is not null
$$;

create or replace function app.is_panel_supervisor() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.panel_staff_id(array['supervisor']) is not null
$$;

create or replace function app.require_panel(p_roles text[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := app.panel_staff_id(p_roles);
begin
  if v_id is null then
    raise exception 'NO_AUTORIZADO: se requiere sesión de panel con MFA (aal2) y rol %',
      array_to_string(p_roles, '/') using errcode = '42501';
  end if;
  perform set_config('app.actor_staff_id', v_id::text, true);
  return v_id;
end $$;

create or replace function app.require_device() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select d.id into v_id from public.devices d where d.auth_user_id = auth.uid() and d.active;
  if v_id is null then
    raise exception 'NO_AUTORIZADO: esta sesión no es una caja emparejada activa' using errcode = '42501';
  end if;
  perform set_config('app.actor_device_id', v_id::text, true);
  return v_id;
end $$;

grant execute on function app.is_panel_reader() to authenticated;
grant execute on function app.is_panel_supervisor() to authenticated;

-- 3) Tablas: RLS + sin escritura directa + lectura solo para panel con MFA + bitácora.
create or replace function app.secure_table(p_table regclass) returns void
language plpgsql set search_path = '' as $$
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('revoke all on table %s from public, anon, authenticated', p_table);
  execute format('grant select on table %s to authenticated', p_table);
  if not exists (
    select 1 from pg_catalog.pg_policy p where p.polrelid = p_table and p.polname = 'panel_lectura'
  ) then
    execute format(
      'create policy panel_lectura on %s for select to authenticated using (app.is_panel_reader())',
      p_table
    );
  end if;
  if p_table <> 'public.audit_log'::regclass then
    perform app.attach_audit(p_table);
  end if;
end $$;

select app.secure_table(t)
from unnest(array[
  'public.locations', 'public.categories', 'public.products', 'public.inventory_items',
  'public.recipes', 'public.staff', 'public.devices', 'public.pairing_codes', 'public.settings',
  'public.alerts', 'public.audit_log'
]::regclass[]) as t;

-- PIN: el hash y la sal solo salen por pos_pull_snapshot (caja emparejada).
revoke select on public.staff from authenticated;
grant select (id, display_name, role, auth_user_id, active, created_at, updated_at)
  on public.staff to authenticated;
revoke select on public.pairing_codes from authenticated;

-- 4) RPC de identidad y emparejamiento
create or replace function public.panel_whoami() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.staff;
begin
  select * into s from public.staff
  where auth_user_id = auth.uid() and active and role in ('socio', 'supervisor');
  if not found then
    raise exception 'NO_AUTORIZADO: usuario sin acceso al panel' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'MFA_REQUERIDO: complete la verificación TOTP' using errcode = '42501';
  end if;
  return jsonb_build_object('staff_id', s.id, 'display_name', s.display_name, 'role', s.role);
end $$;

create or replace function public.my_pin_params() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := app.require_panel(array['socio', 'supervisor']);
  s public.staff;
begin
  select * into s from public.staff where id = v_id;
  return jsonb_build_object('pin_salt', s.pin_salt, 'pin_iterations', s.pin_iterations);
end $$;

create or replace function public.create_pairing_code(p_label text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_staff uuid := app.require_panel(array['supervisor']);
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := uuid_send(gen_random_uuid());
  v_code text := '';
  v_idx int;
  v_expires timestamptz := now() + interval '15 minutes';
begin
  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'ETIQUETA_REQUERIDA: indique el nombre de la caja' using errcode = 'P0001';
  end if;
  foreach v_idx in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, v_idx) % 31) + 1, 1);
  end loop;
  insert into public.pairing_codes (code_hash, label, created_by, expires_at)
  values (encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), trim(p_label), v_staff, v_expires);
  return jsonb_build_object('code', v_code, 'expires_at', v_expires);
end $$;

create or replace function public.pos_claim_device(p_code text, p_label text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hash text := encode(sha256(convert_to(upper(trim(coalesce(p_code, ''))), 'UTF8')), 'hex');
  v_pc public.pairing_codes;
  v_device uuid;
  v_label text;
begin
  if v_uid is null then
    raise exception 'NO_AUTORIZADO: se requiere una sesión' using errcode = '42501';
  end if;
  if exists (select 1 from public.staff s where s.auth_user_id = v_uid)
     or exists (select 1 from public.devices d where d.auth_user_id = v_uid) then
    raise exception 'NO_AUTORIZADO: esta sesión ya tiene una identidad' using errcode = '42501';
  end if;
  select * into v_pc from public.pairing_codes pc
  where pc.code_hash = v_hash and pc.used_at is null and pc.expires_at > now()
  for update;
  if not found then
    raise exception 'CODIGO_INVALIDO: código inválido o vencido' using errcode = 'P0001';
  end if;
  v_label := coalesce(nullif(trim(p_label), ''), v_pc.label);
  perform set_config('app.actor_staff_id', v_pc.created_by::text, true);
  insert into public.devices (location_id, label, auth_user_id)
  select l.id, v_label, v_uid from public.locations l order by l.created_at limit 1
  returning id into v_device;
  update public.pairing_codes set used_at = now(), device_id = v_device where code_hash = v_hash;
  return jsonb_build_object('device_id', v_device, 'label', v_label);
end $$;

create or replace function public.pos_pull_snapshot(p_since bigint default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_device uuid := app.require_device();
  v_version bigint;
  v_dev jsonb;
begin
  select last_value into v_version from app.snapshot_version;
  update public.devices set last_seen_at = now() where id = v_device;
  select jsonb_build_object(
    'id', d.id, 'label', d.label,
    'last_receipt_number', d.last_receipt_number, 'last_client_seq', d.last_client_seq
  ) into v_dev from public.devices d where d.id = v_device;
  if coalesce(p_since, 0) >= v_version then
    return jsonb_build_object('version', v_version, 'unchanged', true, 'device', v_dev);
  end if;
  return jsonb_build_object(
    'version', v_version,
    'unchanged', false,
    'device', v_dev,
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', c.code, 'name', c.name, 'sort_order', c.sort_order) order by c.sort_order), '[]')
      from public.categories c
    ),
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'code', p.code, 'name', p.name, 'category_code', p.category_code,
        'price', p.price, 'isv_rate', p.isv_rate, 'active', p.active, 'sort_order', p.sort_order
      ) order by p.category_code, p.sort_order), '[]')
      from public.products p
    ),
    'staff', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'display_name', s.display_name, 'role', s.role, 'pin_salt', s.pin_salt,
        'pin_hash', s.pin_hash, 'pin_iterations', s.pin_iterations
      ) order by s.display_name), '[]')
      from public.staff s
      where s.active and s.role in ('cajero', 'supervisor') and s.pin_hash is not null
    ),
    'settings', (select coalesce(jsonb_object_agg(st.key, st.value), '{}') from public.settings st)
  );
end $$;

-- 5) Administración de personal (supervisor). El PIN nunca viaja en claro: llega sal + hash PBKDF2.
create or replace function public.upsert_staff(
  p_id uuid, p_display_name text, p_role text, p_active boolean,
  p_pin_salt text default null, p_pin_hash text default null, p_pin_iterations integer default 210000
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v_id uuid;
begin
  if p_role not in ('cajero', 'supervisor', 'socio') then
    raise exception 'ROL_INVALIDO: %', p_role using errcode = 'P0001';
  end if;
  if p_id = v_actor and not p_active then
    raise exception 'SEGREGACION: no puede desactivarse a sí mismo' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.staff (display_name, role, active, pin_salt, pin_hash, pin_iterations)
    values (trim(p_display_name), p_role, p_active, p_pin_salt, p_pin_hash, p_pin_iterations)
    returning id into v_id;
  else
    update public.staff set
      display_name = trim(p_display_name), role = p_role, active = p_active,
      pin_salt = coalesce(p_pin_salt, pin_salt), pin_hash = coalesce(p_pin_hash, pin_hash),
      pin_iterations = case when p_pin_hash is null then pin_iterations else p_pin_iterations end
    where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'NO_ENCONTRADO: staff %', p_id using errcode = 'P0001';
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.link_staff_by_email(p_staff_id uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v_uid uuid;
begin
  select u.id into v_uid from auth.users u
  where lower(u.email) = lower(trim(p_email)) and not coalesce(u.is_anonymous, false);
  if v_uid is null then
    raise exception 'NO_ENCONTRADO: no hay usuario invitado con ese correo' using errcode = 'P0001';
  end if;
  update public.staff set auth_user_id = v_uid
  where id = p_staff_id and role in ('socio', 'supervisor');
  if not found then
    raise exception 'ROL_INVALIDO: solo socios y supervisores usan el panel' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.set_device_active(p_device_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
begin
  update public.devices set active = p_active where id = p_device_id;
  if not found then
    raise exception 'NO_ENCONTRADO: dispositivo %', p_device_id using errcode = 'P0001';
  end if;
end $$;

create or replace function public.verify_audit_chain() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['socio', 'supervisor']);
  r record;
begin
  select * into r from app.audit_chain_check();
  return jsonb_build_object('ok', r.ok, 'first_bad_id', r.first_bad_id, 'checked', r.checked);
end $$;

-- Solo desde el SQL Editor (rol postgres): primer supervisor del sistema. No se concede a nadie.
create or replace function app.bootstrap_supervisor(p_email text, p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_id uuid;
begin
  if exists (select 1 from public.staff where role = 'supervisor') then
    raise exception 'YA_EXISTE: ya hay un supervisor; use el panel' using errcode = 'P0001';
  end if;
  select u.id into v_uid from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_uid is null then
    raise exception 'NO_ENCONTRADO: invite primero el correo desde Supabase Auth' using errcode = 'P0001';
  end if;
  insert into public.staff (display_name, role, auth_user_id)
  values (trim(p_display_name), 'supervisor', v_uid) returning id into v_id;
  return v_id;
end $$;

revoke execute on function app.bootstrap_supervisor(text, text) from public, anon, authenticated;
```

**Files**

- `supabase/migrations/20261122000200_seguridad.sql`
- `supabase/tests/fixtures.ts`
- `supabase/tests/seguridad.test.ts`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** se ejecuta `npm run test:db` **EL SISTEMA DEBERÁ** comprobar que toda tabla de `public` tiene RLS habilitado y que `anon` no tiene SELECT, INSERT, UPDATE ni DELETE sobre ninguna tabla o vista, ni EXECUTE sobre ninguna función de `public`.
2. **CUANDO** el rol `authenticated` intenta `INSERT`, `UPDATE` o `DELETE` directo sobre `products`, `staff` o `audit_log` **EL SISTEMA DEBERÁ** fallar con SQLSTATE `42501`.
3. **CUANDO** un usuario de panel con `aal = 'aal1'` consulta `products` **EL SISTEMA DEBERÁ** devolver 0 filas, y con `aal = 'aal2'` DEBERÁ devolver las 59 filas.
4. **CUANDO** un usuario autenticado sin identidad canjea con `pos_claim_device` un código vigente creado por `create_pairing_code` **EL SISTEMA DEBERÁ** crear exactamente un `devices` activo ligado a su `auth.uid()`, y un segundo canje del mismo código por otro usuario DEBERÁ fallar con `CODIGO_INVALIDO`.
5. **CUANDO** un dispositivo emparejado llama `pos_pull_snapshot(0)` **EL SISTEMA DEBERÁ** devolver productos, categorías, staff con `pin_hash` y `settings`, y CUANDO la llama un usuario de panel DEBERÁ fallar con `NO_AUTORIZADO`.
6. **CUANDO** un socio (no supervisor) con `aal2` llama `create_pairing_code` o `upsert_staff` **EL SISTEMA DEBERÁ** fallar con `NO_AUTORIZADO`.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test:db -- supabase/tests/seguridad.test.ts
npm run test:db
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T4 paso 4: seguridad"
git tag step-04-seguridad
git ls-files --error-unmatch supabase/tests/fixtures.ts   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

### `E1-T5` — Ventas, pagos, anulaciones y pos_push_events idempotente

**Depende de:** `E1-T4` · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 5

1. Cree `supabase/migrations/20261122000300_ventas.sql` con el contenido literal del bloque **M-0300** (abajo). El sobre de eventos y los payloads
   por tipo están en la tabla *Eventos de la caja* de este mismo bloque de tarea (y en §5).
2. Edite `supabase/tests/fixtures.ts`: agregue `posEvent(seq, type, staffId, payload, at = "2026-11-22T16:00:00.000Z")` (genera `event_id` con
   `crypto.randomUUID()`), `openShiftEvent(seq, cashierId, approverId, shiftId, float = { "100": 3, "50": 4 })`,
   `saleEvent(seq, cashierId, shiftId, { receipt, lines: [{ productId, qty, unitPrice }], payments, orderType = "comer_aqui" })` (calcula `total`) y
   `productId(db, code)`. Hora por defecto 16:00 UTC = 10:00 en Honduras (dentro del horario 09:00–21:00).
3. `supabase/tests/ventas.test.ts` (dispositivo con `asRole(db, "authenticated", device.claims, …)`; panel con `aal2`):
   - lote `[turno_abierto #1, venta #2]` enviado dos veces → 1 `shifts`, 1 `sales`, 1 fila `pos_events` por `client_seq`; respuesta 1: `aplicado`×2;
     respuesta 2: `duplicado`×2; `sale_lines` del recibo con `line_base`/`line_isv` (`PZ-001` L 120.00 → base 104.35, ISV 15.65);
   - `venta` con `total` distinto de la suma → `rechazado` con error que empieza por `TOTAL_INVALIDO`; con `lines: []` → `VENTA_VACIA`; en ambos casos
     0 filas nuevas en `sales` y 1 alerta `evento_rechazado`;
   - recibo 5 después del 1 → aplicado + alerta `hueco_numeracion` ("Faltan recibos R-00000002 a R-00000004"); `unit_price` distinto del catálogo →
     alerta `precio_distinto`;
   - venta sin turno abierto → `TURNO_NO_ABIERTO`; `turno_abierto` aprobado por el mismo cajero → `SEGREGACION`;
   - `anulacion_solicitada` con `approved_by` = `staff_id` → `SEGREGACION`; sin `approved_by` → venta `anulacion_pendiente`; `decide_void(void, true)` por un
     supervisor de panel distinto → `anulada`; por el mismo staff que la pidió → `SEGREGACION`;
   - venta con pago `transferencia` (referencia "BAC-12345") → `pago_pendiente`; `confirm_transfer` → `pagada`; otra con `reject_transfer(id, 'No llegó a la cuenta')`
     → `cobro_fallido` + alerta `transferencia_rechazada`;
   - `turno_cerrado` con un conteo L 51.00 menor que el esperado → alerta `diferencia_caja` (|−51| > umbral 50); `gaveta_abierta` y `reimpresion` → 1 alerta cada uno.

#### Bloque M-0300 — `supabase/migrations/20261122000300_ventas.sql`

```sql
-- supabase/migrations/20261122000300_ventas.sql  (paso 5)
-- Turnos, ventas, pagos, anulaciones, reimpresiones, aperturas de gaveta y el libro de eventos POS.
-- El servidor solo valida y aplica: una caja = un punto de emisión, orden por client_seq, nunca por reloj.

create table public.shifts (
  id uuid primary key,
  device_id uuid not null references public.devices (id),
  cashier_staff_id uuid not null references public.staff (id),
  business_date date not null,
  opened_at_client timestamptz not null,
  opened_received_at timestamptz not null default now(),
  opening_float jsonb not null,
  opening_float_total numeric(12, 2) not null check (opening_float_total >= 0),
  opening_approved_by uuid not null references public.staff (id),
  closed_at_client timestamptz,
  closing_count jsonb,
  closing_count_total numeric(12, 2),
  expected_cash numeric(12, 2),
  difference numeric(12, 2),
  status text not null default 'abierto' check (status in ('abierto', 'cerrado')),
  constraint shifts_segregacion check (opening_approved_by <> cashier_staff_id)
);
create unique index shifts_un_abierto_por_caja on public.shifts (device_id) where status = 'abierto';

create table public.pos_events (
  device_id uuid not null references public.devices (id),
  client_seq bigint not null check (client_seq > 0),
  event_id uuid not null unique,
  type text not null,
  staff_id uuid,
  payload jsonb not null,
  client_created_at timestamptz,
  received_at timestamptz not null default now(),
  status text not null check (status in ('aplicado', 'rechazado')),
  error text,
  primary key (device_id, client_seq)
);

create table public.sales (
  id uuid primary key,
  device_id uuid not null references public.devices (id),
  shift_id uuid not null references public.shifts (id),
  receipt_number bigint not null check (receipt_number > 0),
  receipt_code text not null,
  cashier_staff_id uuid not null references public.staff (id),
  order_type text not null check (order_type in ('comer_aqui', 'para_llevar')),
  total numeric(12, 2) not null check (total > 0),
  isv_total numeric(12, 2) not null check (isv_total >= 0),
  status text not null check (status in (
    'pagada', 'pago_pendiente', 'cobro_fallido', 'anulacion_pendiente', 'anulada'
  )),
  status_before_void text,
  business_date date not null,
  client_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  -- SAR (preparado, apagado): nulos mientras fiscal_config.activo = false
  fiscal_number text unique,
  cai text,
  customer_rtn text,
  customer_name text,
  customer_id_doc text,
  unique (device_id, receipt_number)
);
create index sales_business_date_idx on public.sales (business_date);

create table public.sale_lines (
  id bigint generated always as identity primary key,
  sale_id uuid not null references public.sales (id),
  product_id uuid not null references public.products (id),
  product_code text not null,
  product_name text not null,
  qty integer not null check (qty > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  line_total numeric(12, 2) not null,
  isv_rate numeric(4, 2) not null,
  line_base numeric(12, 2) not null,
  line_isv numeric(12, 2) not null
);
create index sale_lines_sale_idx on public.sale_lines (sale_id);

create table public.payments (
  id uuid primary key,
  sale_id uuid not null references public.sales (id),
  method text not null check (method in ('efectivo', 'transferencia')),
  amount numeric(12, 2) not null check (amount > 0),
  cash_received numeric(12, 2),
  change_given numeric(12, 2),
  transfer_reference text,
  transfer_status text check (transfer_status in ('pendiente', 'confirmada', 'rechazada')),
  decided_by uuid references public.staff (id),
  decided_at timestamptz,
  constraint payments_efectivo check (
    method <> 'efectivo' or (cash_received >= amount and change_given = cash_received - amount)
  ),
  constraint payments_transferencia check (
    method <> 'transferencia'
    or (length(trim(transfer_reference)) >= 4 and transfer_status is not null)
  )
);
create index payments_pendientes_idx on public.payments (sale_id) where transfer_status = 'pendiente';

create table public.void_requests (
  id uuid primary key,
  sale_id uuid not null references public.sales (id),
  requested_by uuid not null references public.staff (id),
  reason text not null check (length(trim(reason)) >= 5),
  requested_at_client timestamptz not null,
  status text not null check (status in ('pendiente', 'aprobada', 'rechazada')),
  decided_by uuid references public.staff (id),
  decided_at timestamptz,
  decided_via text check (decided_via in ('caja', 'panel')),
  constraint void_segregacion check (decided_by is null or decided_by <> requested_by)
);
create unique index void_requests_una_pendiente on public.void_requests (sale_id)
  where status = 'pendiente';

create table public.drawer_openings (
  id uuid primary key,
  device_id uuid not null references public.devices (id),
  shift_id uuid references public.shifts (id),
  staff_id uuid not null references public.staff (id),
  reason text not null check (length(trim(reason)) >= 5),
  business_date date not null,
  client_created_at timestamptz not null,
  received_at timestamptz not null default now()
);

create table public.reprints (
  id uuid primary key,
  sale_id uuid not null references public.sales (id),
  staff_id uuid not null references public.staff (id),
  business_date date not null,
  client_created_at timestamptz not null,
  received_at timestamptz not null default now()
);

select app.secure_table(t)
from unnest(array[
  'public.shifts', 'public.pos_events', 'public.sales', 'public.sale_lines', 'public.payments',
  'public.void_requests', 'public.drawer_openings', 'public.reprints'
]::regclass[]) as t;

create or replace function app.immutable_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'EVENTO_INMUTABLE: % es de solo inserción', tg_table_name using errcode = 'P0001';
end $$;

create trigger pos_events_inmutable before update or delete on public.pos_events
  for each row execute function app.immutable_row();
create trigger sale_lines_inmutable before update or delete on public.sale_lines
  for each row execute function app.immutable_row();
create trigger sales_sin_borrado before delete on public.sales
  for each row execute function app.immutable_row();

-- ---------- utilidades ----------
create or replace function app.raise_alert(
  p_kind text, p_severity text, p_date date, p_message text, p_ref_type text, p_ref_id text
) returns void
language sql security definer set search_path = '' as $$
  insert into public.alerts (kind, severity, business_date, message, ref_type, ref_id)
  values (p_kind, p_severity, p_date, p_message, p_ref_type, p_ref_id)
$$;

create or replace function app.setting_num(p_key text) returns numeric
language sql stable security definer set search_path = '' as $$
  select (value #>> '{}')::numeric from public.settings where key = p_key
$$;

create or replace function app.require_staff(p_staff uuid, p_roles text[]) returns public.staff
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.staff;
begin
  select * into s from public.staff where id = p_staff and active and role = any (p_roles);
  if not found then
    raise exception 'STAFF_INVALIDO: % no está activo con rol %', p_staff, array_to_string(p_roles, '/')
      using errcode = 'P0001';
  end if;
  return s;
end $$;

create or replace function app.count_total(p_counts jsonb) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v_total numeric := 0;
  v_key text;
  v_n numeric;
  v_allowed jsonb := (select value from public.settings where key = 'denominations');
begin
  if p_counts is null or jsonb_typeof(p_counts) <> 'object' then
    raise exception 'CONTEO_INVALIDO: se espera un objeto denominación → cantidad' using errcode = 'P0001';
  end if;
  for v_key, v_n in select key, (value #>> '{}')::numeric from jsonb_each(p_counts) loop
    if not (v_allowed @> to_jsonb(v_key::numeric)) or v_n < 0 or v_n <> trunc(v_n) then
      raise exception 'CONTEO_INVALIDO: denominación % cantidad %', v_key, v_n using errcode = 'P0001';
    end if;
    v_total := v_total + v_key::numeric * v_n;
  end loop;
  return round(v_total, 2);
end $$;

-- ---------- despachador ----------
create or replace function public.pos_push_events(p_events jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_device uuid := app.require_device();
  e jsonb;
  v_seq bigint;
  v_type text;
  v_existing text;
  v_results jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 100 then
    raise exception 'LOTE_INVALIDO: se espera un arreglo de 1 a 100 eventos' using errcode = 'P0001';
  end if;
  update public.devices set last_seen_at = now() where id = v_device;
  for e in select value from jsonb_array_elements(p_events) order by (value ->> 'client_seq')::bigint loop
    v_seq := (e ->> 'client_seq')::bigint;
    v_type := e ->> 'type';
    select status into v_existing from public.pos_events where device_id = v_device and client_seq = v_seq;
    if found then
      v_results := v_results || jsonb_build_object('client_seq', v_seq, 'estado', 'duplicado',
        'estado_original', v_existing);
      continue;
    end if;
    begin
      if v_type is null or v_type !~ '^[a-z_]{3,40}$'
         or to_regprocedure(format('app.%I(uuid,jsonb)', 'ev_' || v_type)) is null then
        raise exception 'TIPO_DESCONOCIDO: %', coalesce(v_type, '(nulo)') using errcode = 'P0001';
      end if;
      perform set_config('app.actor_staff_id', coalesce(e ->> 'staff_id', ''), true);
      perform app.require_staff((e ->> 'staff_id')::uuid, array['cajero', 'supervisor']);
      execute format('select app.%I($1, $2)', 'ev_' || v_type) using v_device, e;
      insert into public.pos_events (device_id, client_seq, event_id, type, staff_id, payload,
        client_created_at, status)
      values (v_device, v_seq, (e ->> 'event_id')::uuid, v_type, (e ->> 'staff_id')::uuid,
        coalesce(e -> 'payload', '{}'::jsonb), (e ->> 'client_created_at')::timestamptz, 'aplicado');
      v_results := v_results || jsonb_build_object('client_seq', v_seq, 'estado', 'aplicado');
    exception when others then
      insert into public.pos_events (device_id, client_seq, event_id, type, staff_id, payload,
        client_created_at, status, error)
      -- event_id nuevo: el original puede ser inválido o estar repetido; queda en el texto del error.
      values (v_device, v_seq, gen_random_uuid(), coalesce(v_type, '(nulo)'), null,
        coalesce(e -> 'payload', '{}'::jsonb), null, 'rechazado',
        format('%s [event_id original: %s]', sqlerrm, coalesce(e ->> 'event_id', '(nulo)')));
      perform app.raise_alert('evento_rechazado', 'alta', app.local_date(now()),
        format('Evento %s #%s rechazado: %s', coalesce(v_type, '?'), v_seq, sqlerrm), 'pos_event', v_seq::text);
      v_results := v_results || jsonb_build_object('client_seq', v_seq, 'estado', 'rechazado', 'error', sqlerrm);
    end;
    update public.devices set last_client_seq = greatest(last_client_seq, v_seq) where id = v_device;
  end loop;
  return jsonb_build_object('resultados', v_results, 'recibido_en', now());
end $$;

-- ---------- manejadores de eventos: app.ev_<tipo>(p_device uuid, p_event jsonb) ----------
-- Cada uno valida su payload y lanza 'CODIGO: detalle' (errcode P0001) para rechazar.

create or replace function app.ev_turno_abierto(p_device uuid, p_event jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_event -> 'payload';
  v_staff uuid := (p_event ->> 'staff_id')::uuid;
  v_approver uuid := (p ->> 'approved_by')::uuid;
  v_at timestamptz := (p_event ->> 'client_created_at')::timestamptz;
begin
  if v_approver is null or v_approver = v_staff then
    raise exception 'SEGREGACION: la apertura la aprueba un supervisor distinto' using errcode = 'P0001';
  end if;
  perform app.require_staff(v_approver, array['supervisor']);
  if exists (select 1 from public.shifts where device_id = p_device and status = 'abierto') then
    raise exception 'TURNO_YA_ABIERTO: cierre el turno anterior' using errcode = 'P0001';
  end if;
  insert into public.shifts (id, device_id, cashier_staff_id, business_date, opened_at_client,
    opening_float, opening_float_total, opening_approved_by)
  values ((p ->> 'shift_id')::uuid, p_device, v_staff, app.local_date(v_at), v_at,
    p -> 'opening_float', app.count_total(p -> 'opening_float'), v_approver);
end $$;

create or replace function app.ev_turno_cerrado(p_device uuid, p_event jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_event -> 'payload';
  v_shift public.shifts;
  v_counted numeric;
  v_expected numeric;
begin
  select * into v_shift from public.shifts
  where id = (p ->> 'shift_id')::uuid and device_id = p_device and status = 'abierto' for update;
  if not found then
    raise exception 'TURNO_NO_ABIERTO: %', p ->> 'shift_id' using errcode = 'P0001';
  end if;
  v_counted := app.count_total(p -> 'closing_count');
  select v_shift.opening_float_total + coalesce(sum(pay.amount), 0) into v_expected
  from public.payments pay join public.sales s on s.id = pay.sale_id
  where s.shift_id = v_shift.id and pay.method = 'efectivo' and s.status <> 'anulada';
  update public.shifts set status = 'cerrado', closed_at_client = (p_event ->> 'client_created_at')::timestamptz,
    closing_count = p -> 'closing_count', closing_count_total = v_counted,
    expected_cash = v_expected, difference = v_counted - v_expected
  where id = v_shift.id;
  if abs(v_counted - v_expected) > app.setting_num('cash_diff_threshold') then
    perform app.raise_alert('diferencia_caja', 'alta', v_shift.business_date,
      format('Turno %s: contado L %s, esperado L %s, diferencia L %s', v_shift.id, v_counted,
        v_expected, v_counted - v_expected), 'shift', v_shift.id::text);
  end if;
end $$;

create or replace function app.ev_venta(p_device uuid, p_event jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_event -> 'payload';
  v_staff uuid := (p_event ->> 'staff_id')::uuid;
  v_at timestamptz := (p_event ->> 'client_created_at')::timestamptz;
  v_sale uuid := (p ->> 'sale_id')::uuid;
  v_receipt bigint := (p ->> 'receipt_number')::bigint;
  v_shift public.shifts;
  v_last bigint;
  v_line jsonb;
  v_pay jsonb;
  v_prod public.products;
  v_total numeric := 0;
  v_isv numeric := 0;
  v_paid numeric := 0;
  v_has_transfer boolean := false;
  v_qty integer;
  v_price numeric;
  v_line_total numeric;
  v_base numeric;
  v_local time := app.local_ts(v_at)::time;
  v_hours jsonb := (select value from public.settings where key = 'business_hours');
begin
  if p -> 'lines' is null or jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') = 0 then
    raise exception 'VENTA_VACIA: la venta no tiene líneas' using errcode = 'P0001';
  end if;
  if coalesce(p ->> 'order_type', '') not in ('comer_aqui', 'para_llevar') then
    raise exception 'TIPO_PEDIDO_INVALIDO: %', p ->> 'order_type' using errcode = 'P0001';
  end if;
  select * into v_shift from public.shifts
  where id = (p ->> 'shift_id')::uuid and device_id = p_device and status = 'abierto';
  if not found then
    raise exception 'TURNO_NO_ABIERTO: la venta exige un turno abierto de esta caja' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.sales where device_id = p_device and receipt_number = v_receipt) then
    raise exception 'RECIBO_DUPLICADO: %', v_receipt using errcode = 'P0001';
  end if;
  -- Validar líneas y total antes de escribir nada.
  for v_line in select value from jsonb_array_elements(p -> 'lines') loop
    v_qty := (v_line ->> 'qty')::integer;
    v_price := (v_line ->> 'unit_price')::numeric;
    if v_qty is null or v_qty < 1 or v_price is null or v_price < 0 then
      raise exception 'LINEA_INVALIDA: %', v_line using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.products where id = (v_line ->> 'product_id')::uuid) then
      raise exception 'PRODUCTO_INVALIDO: %', v_line ->> 'product_id' using errcode = 'P0001';
    end if;
    v_total := v_total + v_qty * v_price;
  end loop;
  if v_total <= 0 or v_total <> (p ->> 'total')::numeric then
    raise exception 'TOTAL_INVALIDO: suma de líneas L % ≠ total L %', v_total, p ->> 'total'
      using errcode = 'P0001';
  end if;
  for v_pay in select value from jsonb_array_elements(coalesce(p -> 'payments', '[]'::jsonb)) loop
    v_paid := v_paid + (v_pay ->> 'amount')::numeric;
    if v_pay ->> 'method' = 'transferencia' then
      v_has_transfer := true;
      if length(trim(coalesce(v_pay ->> 'transfer_reference', ''))) < 4 then
        raise exception 'REFERENCIA_REQUERIDA: transferencia sin referencia' using errcode = 'P0001';
      end if;
    elsif v_pay ->> 'method' = 'efectivo' then
      if coalesce((v_pay ->> 'cash_received')::numeric, -1) < (v_pay ->> 'amount')::numeric then
        raise exception 'PAGO_INVALIDO: efectivo recibido menor al monto' using errcode = 'P0001';
      end if;
    else
      raise exception 'PAGO_INVALIDO: forma de pago %', v_pay ->> 'method' using errcode = 'P0001';
    end if;
  end loop;
  if v_paid <> v_total then
    raise exception 'PAGO_INVALIDO: pagos L % ≠ total L %', v_paid, v_total using errcode = 'P0001';
  end if;

  insert into public.sales (id, device_id, shift_id, receipt_number, receipt_code, cashier_staff_id,
    order_type, total, isv_total, status, business_date, client_created_at)
  values (v_sale, p_device, v_shift.id, v_receipt, 'R-' || lpad(v_receipt::text, 8, '0'), v_staff,
    p ->> 'order_type', v_total, 0, case when v_has_transfer then 'pago_pendiente' else 'pagada' end,
    app.local_date(v_at), v_at);

  for v_line in select value from jsonb_array_elements(p -> 'lines') loop
    select * into v_prod from public.products where id = (v_line ->> 'product_id')::uuid;
    v_qty := (v_line ->> 'qty')::integer;
    v_price := (v_line ->> 'unit_price')::numeric;
    v_line_total := v_qty * v_price;
    v_base := round(v_line_total / (1 + v_prod.isv_rate), 2);
    v_isv := v_isv + (v_line_total - v_base);
    insert into public.sale_lines (sale_id, product_id, product_code, product_name, qty, unit_price,
      line_total, isv_rate, line_base, line_isv)
    values (v_sale, v_prod.id, v_prod.code, v_prod.name, v_qty, v_price, v_line_total, v_prod.isv_rate,
      v_base, v_line_total - v_base);
    if v_price <> v_prod.price then
      perform app.raise_alert('precio_distinto', 'alta', app.local_date(v_at),
        format('Recibo R-%s: %s cobrado a L %s, catálogo L %s', lpad(v_receipt::text, 8, '0'),
          v_prod.code, v_price, v_prod.price), 'sale', v_sale::text);
    end if;
  end loop;
  update public.sales set isv_total = v_isv where id = v_sale;

  for v_pay in select value from jsonb_array_elements(p -> 'payments') loop
    insert into public.payments (id, sale_id, method, amount, cash_received, change_given,
      transfer_reference, transfer_status)
    values ((v_pay ->> 'payment_id')::uuid, v_sale, v_pay ->> 'method', (v_pay ->> 'amount')::numeric,
      (v_pay ->> 'cash_received')::numeric,
      case when v_pay ->> 'method' = 'efectivo'
        then (v_pay ->> 'cash_received')::numeric - (v_pay ->> 'amount')::numeric end,
      nullif(trim(coalesce(v_pay ->> 'transfer_reference', '')), ''),
      case when v_pay ->> 'method' = 'transferencia' then 'pendiente' end);
  end loop;

  select last_receipt_number into v_last from public.devices where id = p_device for update;
  if v_receipt > v_last + 1 then
    perform app.raise_alert('hueco_numeracion', 'alta', app.local_date(v_at),
      format('Faltan recibos R-%s a R-%s', lpad((v_last + 1)::text, 8, '0'),
        lpad((v_receipt - 1)::text, 8, '0')), 'device', p_device::text);
  end if;
  update public.devices set last_receipt_number = greatest(last_receipt_number, v_receipt)
  where id = p_device;
  if v_local < (v_hours ->> 'abre')::time or v_local > (v_hours ->> 'cierra')::time then
    perform app.raise_alert('fuera_de_horario', 'media', app.local_date(v_at),
      format('Venta R-%s a las %s', lpad(v_receipt::text, 8, '0'), to_char(v_local, 'HH24:MI')),
      'sale', v_sale::text);
  end if;
end $$;

create or replace function app.ev_anulacion_solicitada(p_device uuid, p_event jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_event -> 'payload';
  v_staff uuid := (p_event ->> 'staff_id')::uuid;
  v_approver uuid := (p ->> 'approved_by')::uuid;
  v_sale public.sales;
begin
  select * into v_sale from public.sales
  where id = (p ->> 'sale_id')::uuid and device_id = p_device for update;
  if not found then
    raise exception 'VENTA_NO_ENCONTRADA: %', p ->> 'sale_id' using errcode = 'P0001';
  end if;
  if v_sale.status in ('anulada', 'anulacion_pendiente') then
    raise exception 'ANULACION_INVALIDA: la venta está %', v_sale.status using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p ->> 'reason', ''))) < 5 then
    raise exception 'MOTIVO_REQUERIDO: escriba el motivo (5+ caracteres)' using errcode = 'P0001';
  end if;
  if v_approver is not null then
    if v_approver = v_staff then
      raise exception 'SEGREGACION: nadie aprueba su propia anulación' using errcode = 'P0001';
    end if;
    perform app.require_staff(v_approver, array['supervisor']);
    insert into public.void_requests (id, sale_id, requested_by, reason, requested_at_client, status,
      decided_by, decided_at, decided_via)
    values ((p ->> 'void_id')::uuid, v_sale.id, v_staff, trim(p ->> 'reason'),
      (p_event ->> 'client_created_at')::timestamptz, 'aprobada', v_approver, now(), 'caja');
    update public.sales set status_before_void = status, status = 'anulada' where id = v_sale.id;
  else
    insert into public.void_requests (id, sale_id, requested_by, reason, requested_at_client, status)
    values ((p ->> 'void_id')::uuid, v_sale.id, v_staff, trim(p ->> 'reason'),
      (p_event ->> 'client_created_at')::timestamptz, 'pendiente');
    update public.sales set status_before_void = status, status = 'anulacion_pendiente'
    where id = v_sale.id;
  end if;
  perform app.raise_alert('anulacion', 'media', v_sale.business_date,
    format('Anulación %s de %s (L %s): %s', case when v_approver is null then 'solicitada'
      else 'aprobada en caja' end, v_sale.receipt_code, v_sale.total, trim(p ->> 'reason')),
    'sale', v_sale.id::text);
end $$;

create or replace function app.ev_reimpresion(p_device uuid, p_event jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_event -> 'payload';
  v_sale public.sales;
begin
  select * into v_sale from public.sales where id = (p ->> 'sale_id')::uuid and device_id = p_device;
  if not found then
    raise exception 'VENTA_NO_ENCONTRADA: %', p ->> 'sale_id' using errcode = 'P0001';
  end if;
  insert into public.reprints (id, sale_id, staff_id, business_date, client_created_at)
  values ((p ->> 'reprint_id')::uuid, v_sale.id, (p_event ->> 'staff_id')::uuid,
    app.local_date((p_event ->> 'client_created_at')::timestamptz),
    (p_event ->> 'client_created_at')::timestamptz);
  perform app.raise_alert('reimpresion', 'baja', v_sale.business_date,
    format('Reimpresión (COPIA) de %s', v_sale.receipt_code), 'sale', v_sale.id::text);
end $$;

create or replace function app.ev_gaveta_abierta(p_device uuid, p_event jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_event -> 'payload';
  v_at timestamptz := (p_event ->> 'client_created_at')::timestamptz;
begin
  if length(trim(coalesce(p ->> 'reason', ''))) < 5 then
    raise exception 'MOTIVO_REQUERIDO: escriba el motivo (5+ caracteres)' using errcode = 'P0001';
  end if;
  insert into public.drawer_openings (id, device_id, shift_id, staff_id, reason, business_date,
    client_created_at)
  values ((p ->> 'opening_id')::uuid, p_device, (p ->> 'shift_id')::uuid,
    (p_event ->> 'staff_id')::uuid, trim(p ->> 'reason'), app.local_date(v_at), v_at);
  perform app.raise_alert('apertura_sin_venta', 'media', app.local_date(v_at),
    format('Gaveta abierta sin venta: %s', trim(p ->> 'reason')), 'device', p_device::text);
end $$;

create or replace function app.ev_pin_bloqueado(p_device uuid, p_event jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.raise_alert('pin_bloqueado', 'media',
    app.local_date((p_event ->> 'client_created_at')::timestamptz),
    format('PIN bloqueado 30 s tras 5 intentos fallidos (staff %s)', p_event -> 'payload' ->> 'blocked_staff_id'),
    'device', p_device::text);
end $$;

-- ---------- decisiones del supervisor desde el panel ----------
create or replace function public.confirm_transfer(p_payment_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v_sale uuid;
begin
  update public.payments set transfer_status = 'confirmada', decided_by = v_actor, decided_at = now()
  where id = p_payment_id and transfer_status = 'pendiente' returning sale_id into v_sale;
  if v_sale is null then
    raise exception 'NO_PENDIENTE: la transferencia no está pendiente' using errcode = 'P0001';
  end if;
  update public.sales set status = 'pagada'
  where id = v_sale and status = 'pago_pendiente'
    and not exists (select 1 from public.payments where sale_id = v_sale and transfer_status = 'pendiente');
end $$;

create or replace function public.reject_transfer(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v_sale public.sales;
begin
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'MOTIVO_REQUERIDO: escriba el motivo (5+ caracteres)' using errcode = 'P0001';
  end if;
  select s.* into v_sale from public.sales s join public.payments pay on pay.sale_id = s.id
  where pay.id = p_payment_id and pay.transfer_status = 'pendiente';
  if not found then
    raise exception 'NO_PENDIENTE: la transferencia no está pendiente' using errcode = 'P0001';
  end if;
  update public.payments set transfer_status = 'rechazada', decided_by = v_actor, decided_at = now()
  where id = p_payment_id;
  update public.sales set status = 'cobro_fallido' where id = v_sale.id and status = 'pago_pendiente';
  perform app.raise_alert('transferencia_rechazada', 'alta', v_sale.business_date,
    format('Transferencia de %s rechazada: %s', v_sale.receipt_code, trim(p_reason)), 'sale', v_sale.id::text);
end $$;

create or replace function public.decide_void(p_void_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v_req public.void_requests;
begin
  select * into v_req from public.void_requests where id = p_void_id and status = 'pendiente' for update;
  if not found then
    raise exception 'NO_PENDIENTE: la anulación no está pendiente' using errcode = 'P0001';
  end if;
  if v_req.requested_by = v_actor then
    raise exception 'SEGREGACION: nadie aprueba su propia anulación' using errcode = 'P0001';
  end if;
  update public.void_requests set status = case when p_approve then 'aprobada' else 'rechazada' end,
    decided_by = v_actor, decided_at = now(), decided_via = 'panel'
  where id = p_void_id;
  if p_approve then
    update public.sales set status = 'anulada' where id = v_req.sale_id;
  else
    update public.sales set status = coalesce(status_before_void, 'pagada') where id = v_req.sale_id;
  end if;
end $$;

create or replace function public.ack_alert(p_alert_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
begin
  update public.alerts set acknowledged_by = v_actor, acknowledged_at = now()
  where id = p_alert_id and acknowledged_at is null;
  if not found then
    raise exception 'NO_PENDIENTE: la alerta no existe o ya fue reconocida' using errcode = 'P0001';
  end if;
end $$;
```

#### Eventos de la caja

**Sobre de cada evento** (cliente → `pos_push_events(p_events jsonb)`, arreglo de 1 a 100, ordenado por `client_seq`):

```json
{
  "client_seq": 12,
  "event_id": "8f0c2c7e-2a8f-4b1e-9d55-0a3c1e7b9a10",
  "type": "venta",
  "staff_id": "3b1d6f0a-7c55-4e8e-9a2d-1f4b8c9e0d21",
  "client_created_at": "2026-11-22T16:03:11.123Z",
  "payload": {}
}
```

**Respuesta:** `{ "resultados": [ { "client_seq": 12, "estado": "aplicado" | "duplicado" | "rechazado", "error"?: "CODIGO: detalle", "estado_original"?: "aplicado" | "rechazado" } ], "recibido_en": "2026-11-22T16:03:12.402Z" }`.
Idempotencia por `(device_id, client_seq)`: un `client_seq` ya recibido responde `duplicado` y no vuelve a aplicarse. Un evento rechazado
queda en `pos_events` con su error y genera la alerta `evento_rechazado`; el resto del lote sigue.

| `type` | `payload` | Manejador | Rechazos posibles |
|---|---|---|---|
| `turno_abierto` | `{ shift_id, opening_float: { "100": 3, "50": 4 }, approved_by }` | `app.ev_turno_abierto` | `SEGREGACION`, `TURNO_YA_ABIERTO`, `CONTEO_INVALIDO`, `STAFF_INVALIDO` |
| `turno_cerrado` | `{ shift_id, closing_count: { "500": 1, … } }` | `app.ev_turno_cerrado` | `TURNO_NO_ABIERTO`, `CONTEO_INVALIDO` |
| `venta` | `{ sale_id, receipt_number, shift_id, order_type: "comer_aqui" \| "para_llevar", total, lines: [{ product_id, qty, unit_price }], payments: [{ payment_id, method: "efectivo" \| "transferencia", amount, cash_received?, transfer_reference? }] }` | `app.ev_venta` | `VENTA_VACIA`, `TIPO_PEDIDO_INVALIDO`, `TURNO_NO_ABIERTO`, `RECIBO_DUPLICADO`, `LINEA_INVALIDA`, `PRODUCTO_INVALIDO`, `TOTAL_INVALIDO`, `REFERENCIA_REQUERIDA`, `PAGO_INVALIDO` |
| `anulacion_solicitada` | `{ void_id, sale_id, reason, approved_by? }` | `app.ev_anulacion_solicitada` | `VENTA_NO_ENCONTRADA`, `ANULACION_INVALIDA`, `MOTIVO_REQUERIDO`, `SEGREGACION`, `DIA_CERRADO` |
| `reimpresion` | `{ reprint_id, sale_id }` | `app.ev_reimpresion` | `VENTA_NO_ENCONTRADA` |
| `gaveta_abierta` | `{ opening_id, shift_id, reason }` | `app.ev_gaveta_abierta` | `MOTIVO_REQUERIDO` |
| `consumo_interno` | `{ consumption_id, item_code, qty, reason, approved_by }` | `app.ev_consumo_interno` (paso 6) | `SEGREGACION`, `ITEM_INVALIDO`, `CANTIDAD_INVALIDA` |
| `pin_bloqueado` | `{ blocked_staff_id }` | `app.ev_pin_bloqueado` | — |

Todo evento además se rechaza con `TIPO_DESCONOCIDO` (no existe `app.ev_<type>`) o `STAFF_INVALIDO` (`staff_id` inactivo o sin rol `cajero`/`supervisor`).
Montos con 2 decimales; `qty` entero ≥ 1; IDs nuevos con `crypto.randomUUID()` en la caja.

**Files**

- `supabase/migrations/20261122000300_ventas.sql`
- `supabase/tests/fixtures.ts`
- `supabase/tests/ventas.test.ts`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** el mismo lote de eventos `turno_abierto` + `venta` se envía dos veces a `pos_push_events` **EL SISTEMA DEBERÁ** crear exactamente un `shifts` y un `sales`, y responder `aplicado` la primera vez y `duplicado` la segunda para cada `client_seq`.
2. **CUANDO** llega una `venta` cuyo `total` no es la suma de `qty * unit_price`, o sin líneas **EL SISTEMA DEBERÁ** registrar el evento como `rechazado` con error `TOTAL_INVALIDO` o `VENTA_VACIA`, no crear filas en `sales` y crear una alerta `evento_rechazado`.
3. **CUANDO** llega una `venta` con `receipt_number` mayor que el último + 1 **EL SISTEMA DEBERÁ** aplicarla y crear una alerta `hueco_numeracion`, y CUANDO el precio unitario difiere del catálogo DEBERÁ crear una alerta `precio_distinto`.
4. **CUANDO** llega una `venta` sin turno abierto de esa caja **EL SISTEMA DEBERÁ** rechazarla con `TURNO_NO_ABIERTO`.
5. **CUANDO** llega `anulacion_solicitada` con `approved_by` igual al `staff_id` que la solicita **EL SISTEMA DEBERÁ** rechazarla con `SEGREGACION`, y sin `approved_by` DEBERÁ dejar la venta en `anulacion_pendiente` hasta que `decide_void` de un supervisor distinto la marque `anulada`.
6. **CUANDO** una venta tiene un pago `transferencia` **EL SISTEMA DEBERÁ** dejarla en `pago_pendiente` hasta que `confirm_transfer` la pase a `pagada`, o `reject_transfer` la pase a `cobro_fallido` con una alerta `transferencia_rechazada`.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test:db -- supabase/tests/ventas.test.ts
npm run test:db
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T5 paso 5: ventas-servidor"
git tag step-05-ventas-servidor
git ls-files --error-unmatch supabase/migrations/20261122000300_ventas.sql   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

### `E1-T6` — Inventario por receta: compras, cortes, conteos y merma

**Depende de:** `E1-T5` · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 6

1. Cree `supabase/migrations/20261122000400_inventario.sql` con el contenido literal del bloque **M-0400** (abajo).
2. `supabase/tests/inventario.test.ts` (reutiliza `./fixtures`; panel supervisor `aal2` para RPC; superusuario para `app.apply_inventory_count`):
   - venta de 1× `PZ-003` (8 piezas) → movimientos `venta` de −2 para `ALA`, `PIERNA`, `MUSLO` y `PECHUGA`; anularla (`anulacion_solicitada` con supervisor
     distinto) → movimientos `anulacion` +2 y el stock teórico (`inventory_stock.qty`) de cada pieza vuelve al valor previo; reenviar el mismo lote
     de la venta → `duplicado` y el número de movimientos `venta` de esa venta no cambia;
   - `register_purchase('POLLO-ENTERO', 10, 2275, 'Avícola del Valle', 45.5)` → `cost_per_unit = 227.5`, `cost_per_pound = 50`, stock +10;
     sin libras → `LIBRAS_REQUERIDAS`;
   - `register_cut(2)` → `POLLO-ENTERO` −2, cada pieza +4, `cuts.cost_per_piece` = `avg_cost` del pollo × 2 ÷ 16 (con la compra anterior: 28.4375);
     `register_cut(999)` → `STOCK_INSUFICIENTE` y 0 movimientos nuevos;
   - `register_cut(1)` (pollo entero 10 − 2 − 1 = 7) → `ALA` +2; secuencia de `ALA`: 0 (venta −2, anulación +2) + 4 (`register_cut(2)`) + 2 = **6**;
     `app.apply_inventory_count(staff, fecha, '[{"item_code":"ALA","counted":0}]')` con ese teórico 6 → movimiento `ajuste_conteo` −6 y línea con
     `waste_value = 6 × avg_cost` de `ALA`, y alerta `merma` (6 > umbral 2);
   - `update`/`delete` sobre `inventory_movements` → `MOVIMIENTO_INMUTABLE`;
   - `consumo_interno` desde la caja con `approved_by` de otro supervisor → movimiento `consumo_interno`; sin aprobador distinto → `SEGREGACION`;
   - `upsert_recipe('CP-004', '[]')` → `RECETA_INVALIDA`; `create_product('BE', 'Coca prueba', 20)` → `BE-028`.

#### Bloque M-0400 — `supabase/migrations/20261122000400_inventario.sql`

```sql
-- supabase/migrations/20261122000400_inventario.sql  (paso 6)
-- Inventario por receta: libro de movimientos append-only, compras (pollo por peso), cortes de 8 piezas,
-- consumo interno, conteos y merma valorizada a costo promedio ponderado. Bucket privado de comprobantes.

create table public.inventory_movements (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.inventory_items (id),
  qty numeric(12, 3) not null check (qty <> 0),
  unit_cost numeric(12, 4) not null default 0,
  kind text not null check (kind in (
    'compra', 'corte_salida', 'corte_entrada', 'venta', 'anulacion', 'consumo_interno', 'ajuste_conteo'
  )),
  ref_type text not null,
  ref_id text not null,
  staff_id uuid references public.staff (id),
  device_id uuid references public.devices (id),
  auth_uid uuid default auth.uid(),
  business_date date not null,
  occurred_at timestamptz not null default now()
);
create index inventory_movements_item_idx on public.inventory_movements (item_id);
create index inventory_movements_ref_idx on public.inventory_movements (ref_type, ref_id);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id),
  supplier text not null check (length(trim(supplier)) > 0),
  qty numeric(12, 3) not null check (qty > 0),
  pounds numeric(12, 3) check (pounds > 0),
  total_cost numeric(12, 2) not null check (total_cost > 0),
  cost_per_unit numeric(12, 4) not null,
  cost_per_pound numeric(12, 4),
  photo_path text,
  registered_by uuid not null references public.staff (id),
  business_date date not null,
  created_at timestamptz not null default now()
);

create table public.cuts (
  id uuid primary key default gen_random_uuid(),
  chickens integer not null check (chickens > 0),
  pieces jsonb not null,
  total_pieces integer not null check (total_pieces > 0),
  chicken_unit_cost numeric(12, 4) not null,
  cost_per_piece numeric(12, 4) not null,
  registered_by uuid not null references public.staff (id),
  business_date date not null,
  created_at timestamptz not null default now()
);

create table public.internal_consumptions (
  id uuid primary key,
  item_id uuid not null references public.inventory_items (id),
  qty numeric(12, 3) not null check (qty > 0),
  reason text not null check (length(trim(reason)) >= 5),
  requested_by uuid not null references public.staff (id),
  approved_by uuid not null references public.staff (id),
  device_id uuid references public.devices (id),
  business_date date not null,
  created_at timestamptz not null default now(),
  constraint consumo_segregacion check (approved_by <> requested_by)
);

create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  counted_by uuid not null references public.staff (id),
  created_at timestamptz not null default now()
);

create table public.inventory_count_lines (
  count_id uuid not null references public.inventory_counts (id),
  item_id uuid not null references public.inventory_items (id),
  theoretical_qty numeric(12, 3) not null,
  counted_qty numeric(12, 3) not null check (counted_qty >= 0),
  difference numeric(12, 3) not null,
  waste_value numeric(12, 2) not null,
  primary key (count_id, item_id)
);

select app.secure_table(t)
from unnest(array[
  'public.inventory_movements', 'public.purchases', 'public.cuts', 'public.internal_consumptions',
  'public.inventory_counts', 'public.inventory_count_lines'
]::regclass[]) as t;

create or replace function app.movement_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'MOVIMIENTO_INMUTABLE: los movimientos de inventario no se modifican ni se borran'
    using errcode = 'P0001';
end $$;

create trigger inventory_movements_inmutable before update or delete on public.inventory_movements
  for each row execute function app.movement_immutable();

create view public.inventory_stock with (security_invoker = true) as
select i.id as item_id, i.code, i.name, i.kind, i.min_stock, i.avg_cost,
  coalesce(sum(m.qty), 0)::numeric(12, 3) as qty
from public.inventory_items i
left join public.inventory_movements m on m.item_id = i.id
group by i.id;

revoke all on public.inventory_stock from public, anon, authenticated;
grant select on public.inventory_stock to authenticated;

create or replace function app.stock_of(p_item uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(qty), 0) from public.inventory_movements where item_id = p_item
$$;

create or replace function app.item_by_code(p_code text) returns public.inventory_items
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.inventory_items;
begin
  select * into v from public.inventory_items where code = p_code and active;
  if not found then
    raise exception 'ITEM_INVALIDO: %', p_code using errcode = 'P0001';
  end if;
  return v;
end $$;

-- Costo promedio ponderado al entrar inventario (stock negativo cuenta como 0).
create or replace function app.apply_entry_cost(p_item uuid, p_qty numeric, p_unit_cost numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_stock numeric := greatest(app.stock_of(p_item), 0);
begin
  update public.inventory_items
  set avg_cost = round((v_stock * avg_cost + p_qty * p_unit_cost) / (v_stock + p_qty), 4)
  where id = p_item;
end $$;

-- Alerta de stock bajo (una abierta por ítem).
create or replace function app.movement_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.inventory_items;
begin
  select * into v_item from public.inventory_items where id = new.item_id;
  if v_item.min_stock > 0 and app.stock_of(new.item_id) < v_item.min_stock
     and not exists (select 1 from public.alerts a where a.kind = 'stock_bajo'
       and a.ref_id = new.item_id::text and a.acknowledged_at is null) then
    perform app.raise_alert('stock_bajo', 'media', new.business_date,
      format('Stock bajo de %s: %s (mínimo %s)', v_item.code, app.stock_of(new.item_id), v_item.min_stock),
      'inventory_item', new.item_id::text);
  end if;
  return null;
end $$;

create trigger inventory_movements_after after insert on public.inventory_movements
  for each row execute function app.movement_after();

-- Venta → descuento por receta (por línea).
create or replace function app.sale_line_inventory() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.inventory_movements (item_id, qty, unit_cost, kind, ref_type, ref_id, staff_id,
    device_id, business_date)
  select r.item_id, -(r.qty * new.qty), i.avg_cost, 'venta', 'sale', new.sale_id::text,
    s.cashier_staff_id, s.device_id, s.business_date
  from public.recipes r
  join public.inventory_items i on i.id = r.item_id
  join public.sales s on s.id = new.sale_id
  where r.product_id = new.product_id;
  return null;
end $$;

create trigger sale_lines_inventory after insert on public.sale_lines
  for each row execute function app.sale_line_inventory();

-- Anulación aprobada → movimientos inversos exactos de lo descontado (no de la receta actual).
create or replace function app.sale_void_inventory() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'anulada' and old.status <> 'anulada' then
    insert into public.inventory_movements (item_id, qty, unit_cost, kind, ref_type, ref_id, staff_id,
      device_id, business_date)
    select m.item_id, -m.qty, m.unit_cost, 'anulacion', 'sale', new.id::text,
      nullif(current_setting('app.actor_staff_id', true), '')::uuid, new.device_id, new.business_date
    from public.inventory_movements m
    where m.ref_type = 'sale' and m.ref_id = new.id::text and m.kind = 'venta';
  end if;
  return null;
end $$;

create trigger sales_void_inventory after update of status on public.sales
  for each row execute function app.sale_void_inventory();

-- ---------- RPC de inventario (supervisor, panel con MFA) ----------
create or replace function public.register_purchase(
  p_item_code text, p_qty numeric, p_total_cost numeric, p_supplier text,
  p_pounds numeric default null, p_photo_path text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v_item public.inventory_items := app.item_by_code(p_item_code);
  v_unit numeric;
  v_id uuid;
  v_date date := app.local_date(now());
begin
  if coalesce(p_qty, 0) <= 0 or coalesce(p_total_cost, 0) <= 0 then
    raise exception 'CANTIDAD_INVALIDA: cantidad y costo deben ser mayores a 0' using errcode = 'P0001';
  end if;
  if v_item.kind = 'pollo_entero' and coalesce(p_pounds, 0) <= 0 then
    raise exception 'LIBRAS_REQUERIDAS: el pollo entero se compra por peso' using errcode = 'P0001';
  end if;
  v_unit := round(p_total_cost / p_qty, 4);
  perform app.apply_entry_cost(v_item.id, p_qty, v_unit);
  insert into public.purchases (item_id, supplier, qty, pounds, total_cost, cost_per_unit, cost_per_pound,
    photo_path, registered_by, business_date)
  values (v_item.id, trim(p_supplier), p_qty, p_pounds, p_total_cost, v_unit,
    case when p_pounds is not null then round(p_total_cost / p_pounds, 4) end, p_photo_path, v_actor, v_date)
  returning id into v_id;
  insert into public.inventory_movements (item_id, qty, unit_cost, kind, ref_type, ref_id, staff_id,
    business_date)
  values (v_item.id, p_qty, v_unit, 'compra', 'purchase', v_id::text, v_actor, v_date);
  return v_id;
end $$;

create or replace function public.register_cut(p_chickens integer, p_pieces jsonb default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v_pollo public.inventory_items := app.item_by_code('POLLO-ENTERO');
  v_pieces jsonb;
  v_total integer := 0;
  v_piece_cost numeric;
  v_id uuid;
  v_code text;
  v_n integer;
  v_date date := app.local_date(now());
begin
  if coalesce(p_chickens, 0) <= 0 then
    raise exception 'CANTIDAD_INVALIDA: indique cuántos pollos se cortan' using errcode = 'P0001';
  end if;
  if app.stock_of(v_pollo.id) < p_chickens then
    raise exception 'STOCK_INSUFICIENTE: hay % pollos enteros', app.stock_of(v_pollo.id) using errcode = 'P0001';
  end if;
  v_pieces := coalesce(p_pieces, jsonb_build_object(
    'ALA', 2 * p_chickens, 'PIERNA', 2 * p_chickens, 'MUSLO', 2 * p_chickens, 'PECHUGA', 2 * p_chickens));
  for v_code, v_n in select key, (value #>> '{}')::integer from jsonb_each(v_pieces) loop
    if v_code not in ('ALA', 'PIERNA', 'MUSLO', 'PECHUGA') or v_n < 0 then
      raise exception 'CORTE_INVALIDO: % = %', v_code, v_n using errcode = 'P0001';
    end if;
    v_total := v_total + v_n;
  end loop;
  if v_total <= 0 then
    raise exception 'CORTE_INVALIDO: el corte no produjo piezas' using errcode = 'P0001';
  end if;
  v_piece_cost := round(v_pollo.avg_cost * p_chickens / v_total, 4);
  insert into public.cuts (chickens, pieces, total_pieces, chicken_unit_cost, cost_per_piece, registered_by,
    business_date)
  values (p_chickens, v_pieces, v_total, v_pollo.avg_cost, v_piece_cost, v_actor, v_date)
  returning id into v_id;
  insert into public.inventory_movements (item_id, qty, unit_cost, kind, ref_type, ref_id, staff_id,
    business_date)
  values (v_pollo.id, -p_chickens, v_pollo.avg_cost, 'corte_salida', 'cut', v_id::text, v_actor, v_date);
  for v_code, v_n in select key, (value #>> '{}')::integer from jsonb_each(v_pieces) loop
    if v_n > 0 then
      perform app.apply_entry_cost((app.item_by_code(v_code)).id, v_n, v_piece_cost);
      insert into public.inventory_movements (item_id, qty, unit_cost, kind, ref_type, ref_id, staff_id,
        business_date)
      values ((app.item_by_code(v_code)).id, v_n, v_piece_cost, 'corte_entrada', 'cut', v_id::text,
        v_actor, v_date);
    end if;
  end loop;
  return v_id;
end $$;

-- Conteo físico (lo usa el cierre del día): ajusta al contado y valoriza la merma.
create or replace function app.apply_inventory_count(p_counted_by uuid, p_date date, p_lines jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_count uuid;
  v_line jsonb;
  v_item public.inventory_items;
  v_theo numeric;
  v_counted numeric;
  v_piece_waste numeric := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'CONTEO_INVALIDO: el conteo no tiene líneas' using errcode = 'P0001';
  end if;
  insert into public.inventory_counts (business_date, counted_by) values (p_date, p_counted_by)
  returning id into v_count;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_item := app.item_by_code(v_line ->> 'item_code');
    v_counted := (v_line ->> 'counted')::numeric;
    if v_counted is null or v_counted < 0 then
      raise exception 'CONTEO_INVALIDO: % = %', v_item.code, v_line ->> 'counted' using errcode = 'P0001';
    end if;
    v_theo := app.stock_of(v_item.id);
    insert into public.inventory_count_lines (count_id, item_id, theoretical_qty, counted_qty, difference,
      waste_value)
    values (v_count, v_item.id, v_theo, v_counted, v_counted - v_theo,
      round(greatest(v_theo - v_counted, 0) * v_item.avg_cost, 2));
    if v_counted <> v_theo then
      insert into public.inventory_movements (item_id, qty, unit_cost, kind, ref_type, ref_id, staff_id,
        business_date)
      values (v_item.id, v_counted - v_theo, v_item.avg_cost, 'ajuste_conteo', 'inventory_count',
        v_count::text, p_counted_by, p_date);
    end if;
    if v_item.kind = 'pieza' then
      v_piece_waste := v_piece_waste + greatest(v_theo - v_counted, 0);
    end if;
  end loop;
  if v_piece_waste > app.setting_num('waste_threshold_pieces') then
    perform app.raise_alert('merma', 'alta', p_date,
      format('Merma de %s piezas de pollo el %s', v_piece_waste, p_date), 'inventory_count', v_count::text);
  end if;
  return v_count;
end $$;

-- Consumo interno (comida del personal), aprobado por supervisor en caja.
create or replace function app.ev_consumo_interno(p_device uuid, p_event jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_event -> 'payload';
  v_staff uuid := (p_event ->> 'staff_id')::uuid;
  v_approver uuid := (p ->> 'approved_by')::uuid;
  v_item public.inventory_items := app.item_by_code(p ->> 'item_code');
  v_date date := app.local_date((p_event ->> 'client_created_at')::timestamptz);
  v_qty numeric := (p ->> 'qty')::numeric;
begin
  if v_approver is null or v_approver = v_staff then
    raise exception 'SEGREGACION: el consumo interno lo aprueba otro supervisor' using errcode = 'P0001';
  end if;
  perform app.require_staff(v_approver, array['supervisor']);
  if coalesce(v_qty, 0) <= 0 then
    raise exception 'CANTIDAD_INVALIDA: %', p ->> 'qty' using errcode = 'P0001';
  end if;
  insert into public.internal_consumptions (id, item_id, qty, reason, requested_by, approved_by, device_id,
    business_date)
  values ((p ->> 'consumption_id')::uuid, v_item.id, v_qty, trim(p ->> 'reason'), v_staff, v_approver,
    p_device, v_date);
  insert into public.inventory_movements (item_id, qty, unit_cost, kind, ref_type, ref_id, staff_id,
    device_id, business_date)
  values (v_item.id, -v_qty, v_item.avg_cost, 'consumo_interno', 'internal_consumption', p ->> 'consumption_id',
    v_staff, p_device, v_date);
end $$;

-- ---------- RPC de catálogo y configuración (supervisor) ----------
create or replace function public.upsert_recipe(p_product_code text, p_lines jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v_product uuid;
  v_line jsonb;
begin
  select id into v_product from public.products where code = p_product_code;
  if v_product is null then
    raise exception 'PRODUCTO_INVALIDO: %', p_product_code using errcode = 'P0001';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'RECETA_INVALIDA: la receta necesita al menos una línea' using errcode = 'P0001';
  end if;
  delete from public.recipes where product_id = v_product;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if coalesce((v_line ->> 'qty')::numeric, 0) <= 0 then
      raise exception 'RECETA_INVALIDA: cantidad inválida en %', v_line using errcode = 'P0001';
    end if;
    insert into public.recipes (product_id, item_id, qty)
    values (v_product, (app.item_by_code(v_line ->> 'item_code')).id, (v_line ->> 'qty')::numeric);
  end loop;
end $$;

create or replace function public.set_product(
  p_code text, p_name text, p_price numeric, p_active boolean, p_isv_rate numeric default 0.15
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
begin
  update public.products set name = trim(p_name), price = p_price, active = p_active, isv_rate = p_isv_rate
  where code = p_code;
  if not found then
    raise exception 'PRODUCTO_INVALIDO: %', p_code using errcode = 'P0001';
  end if;
end $$;

create or replace function public.create_product(
  p_category_code text, p_name text, p_price numeric, p_isv_rate numeric default 0.15
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v_next integer;
  v_code text;
begin
  select coalesce(max(substr(code, 4)::integer), 0) + 1 into v_next
  from public.products where category_code = p_category_code;
  v_code := p_category_code || '-' || lpad(v_next::text, 3, '0');
  insert into public.products (code, name, category_code, price, isv_rate, sort_order)
  values (v_code, trim(p_name), p_category_code, p_price, p_isv_rate, v_next);
  return v_code;
end $$;

create or replace function public.set_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
begin
  update public.settings set value = p_value where key = p_key;
  if not found then
    raise exception 'AJUSTE_INVALIDO: %', p_key using errcode = 'P0001';
  end if;
end $$;

create or replace function public.set_item(p_code text, p_name text, p_min_stock numeric, p_active boolean,
  p_kind text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
begin
  if exists (select 1 from public.inventory_items where code = p_code) then
    update public.inventory_items set name = trim(p_name), min_stock = p_min_stock, active = p_active
    where code = p_code;
  else
    insert into public.inventory_items (code, name, kind, min_stock, active)
    values (p_code, trim(p_name), coalesce(p_kind, 'desechable'), p_min_stock, p_active);
  end if;
end $$;

-- ---------- Storage: comprobantes (bucket privado) ----------
insert into storage.buckets (id, name, public) values ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;

create policy comprobantes_insert_supervisor on storage.objects for insert to authenticated
  with check (bucket_id = 'comprobantes' and app.is_panel_supervisor());
create policy comprobantes_select_panel on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and app.is_panel_reader());
```

**Files**

- `supabase/migrations/20261122000400_inventario.sql`
- `supabase/tests/inventario.test.ts`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** se aplica una venta de `PZ-003` (8 piezas) **EL SISTEMA DEBERÁ** insertar movimientos `venta` de −2 para `ALA`, `PIERNA`, `MUSLO` y `PECHUGA`, y CUANDO esa venta se anula DEBERÁ insertar movimientos `anulacion` que devuelven el stock teórico de cada ítem al valor previo.
2. **CUANDO** `register_purchase` registra 10 `POLLO-ENTERO` de 45.5 libras por L 2,275.00 **EL SISTEMA DEBERÁ** guardar `cost_per_unit = 227.50` y `cost_per_pound = 50.00` y sumar 10 al stock teórico de `POLLO-ENTERO`.
3. **CUANDO** `register_cut` corta 2 pollos sin desglose explícito **EL SISTEMA DEBERÁ** restar 2 de `POLLO-ENTERO`, sumar 4 a cada una de `ALA`, `PIERNA`, `MUSLO` y `PECHUGA`, y fijar el costo por pieza = costo promedio del pollo × 2 ÷ 16.
4. **CUANDO** `register_cut` pide cortar más pollos que el stock teórico **EL SISTEMA DEBERÁ** fallar con `STOCK_INSUFICIENTE` sin insertar movimientos.
5. **CUANDO** `app.apply_inventory_count` registra un conteo menor al teórico **EL SISTEMA DEBERÁ** insertar un movimiento `ajuste_conteo` por la diferencia y una línea con `waste_value` = (teórico − contado) × `avg_cost`.
6. **CUANDO** se intenta `UPDATE` o `DELETE` sobre `inventory_movements` **EL SISTEMA DEBERÁ** fallar con `MOVIMIENTO_INMUTABLE`.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test:db -- supabase/tests/inventario.test.ts
npm run test:db
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T6 paso 6: inventario-servidor"
git tag step-06-inventario-servidor
git ls-files --error-unmatch supabase/migrations/20261122000400_inventario.sql   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

---

## Aceptación del epic

El epic termina cuando todas sus tareas están `done` **y**:

1. **CUANDO** `npm run test:db` aplica las migraciones `0100` a `0400` sobre PGlite **EL SISTEMA DEBERÁ** pasar todas las pruebas de propiedad (bitácora y RLS en
   toda tabla, `anon` sin privilegios, `authenticated` sin escritura directa) con 0 fallidas — lo deciden `supabase/tests/esquema.test.ts` y
   `supabase/tests/seguridad.test.ts`.
2. **CUANDO** una venta de `PZ-003` llega dos veces por `pos_push_events` **EL SISTEMA DEBERÁ** crear una sola venta y descontar 2 piezas de cada tipo una sola vez
   — lo decide el caso de reenvío de `supabase/tests/inventario.test.ts`.

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test && npm run test:db
npm run build
```

## Trampas

- **Probar permisos como superusuario** — el superusuario de PGlite ignora RLS y privilegios; toda prueba de acceso va dentro de `asRole(...)`.
- **Olvidar `app.secure_table` en una tabla nueva** — la tabla queda legible por `anon` en Supabase real; las pruebas de propiedad lo detectan, no las desactive.
- **Web Serial en pruebas** — jsdom no tiene `navigator.serial`; la página debe funcionar (respaldo) sin él, que es justo lo que se prueba.
- **`cp -n`/`rsync` en Windows** — el Bootstrap ya copió `workspace/`; no lo repita a mano con otro comando.

## Antes de seguir

- [ ] Toda tarea de este epic está `done` en `tasks.json` — ninguna en `in_progress`.
- [ ] Pasaron todos los comandos `verify` de cada tarea, no solo el primero.
- [ ] Ningún comando `verify` se editó ni se saltó porque faltaba un archivo.
- [ ] Cada tarea tiene su tag `checkpoint` en git (`git tag -l 'step-*'` los lista).
- [ ] El gate pasa limpio desde la raíz del proyecto, con `blueprints/` presente.
- [ ] Cada contrato "Producidos" existe con la firma indicada.
- [ ] No se modificó ningún archivo fuera del subárbol.
- [ ] `.env.example` no cambió (este epic no agrega variables) o se actualizó junto con `src/lib/env.ts`.
- [ ] Un commit por tarea, con el id de la tarea en el mensaje, seguido de su tag.

