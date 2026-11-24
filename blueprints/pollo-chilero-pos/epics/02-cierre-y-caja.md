# Epic 02: Cierre del día en servidor y caja offline

> Al terminar existe el cierre del día ciego con reporte Z inmutable y la facturación SAR preparada (apagada) en la base de datos, y la caja `/pos`
> funciona sin internet: se empareja una vez, el cajero entra con 2 toques + PIN, abre turno con fondo, vende con efectivo/transferencia y numera
> recibos `R-00000001` sin huecos, todo en IndexedDB con cada acción en el outbox.

| | |
|---|---|
| **Epic id** | `02-cierre-y-caja` |
| **Tareas** | `E2-T1` … `E2-T6` |
| **Depende de** | `01-fundacion-datos` (`E2-T1` necesita `E1-T6`; `E2-T2` necesita `E1-T1` y `E1-T3`) |
| **Desbloquea** | `03-operacion-panel-salida` |
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
supabase/migrations/20261122000500_cierre_dia.sql   # NUEVO (E2-T1)
supabase/migrations/20261122000600_fiscal.sql       # NUEVO (E2-T1)
supabase/tests/cierre.test.ts                       # NUEVO (E2-T1)
supabase/tests/fiscal.test.ts                       # NUEVO (E2-T1)
supabase/tests/{harness,fixtures}.ts                # existen; solo lectura
src/
  App.tsx                    # existe (E1-T1); solo lectura en este epic
  lib/env.ts                 # NUEVO (E2-T2)
  lib/backend.tsx            # NUEVO (E2-T2): tipos, getBackend/useBackend, queryClient
  lib/backend-impl.ts        # NUEVO (E2-T2): implementación Supabase
  lib/utils.ts               # NUEVO (E2-T2): cn, round2, formatLempiras, toLocalHN, buttonVariants
  lib/backend.test.tsx       # NUEVO (E2-T2)
  lib/pin.ts                 # NUEVO (E2-T4)
  pos/PosRoutes.tsx          # existe; se edita en E2-T3 … E2-T6
  pos/db.ts                  # NUEVO (E2-T3)
  pos/device.ts              # NUEVO (E2-T3)
  pos/PairingScreen.tsx      # NUEVO (E2-T3)
  pos/outbox.ts              # NUEVO (E2-T4)
  pos/CashierLogin.tsx       # NUEVO (E2-T4)
  pos/shift.ts               # NUEVO (E2-T5)
  pos/ShiftScreens.tsx       # NUEVO (E2-T5)
  pos/SupervisorActions.tsx  # NUEVO (E2-T5)
  pos/cart.ts                # NUEVO (E2-T6)
  pos/NumPad.tsx             # NUEVO (E2-T6)
  pos/SaleScreen.tsx         # NUEVO (E2-T6)
  pos/print/escpos.ts        # existe (E1-T2); solo lectura
  pos/{device,pin-outbox,shift,sale}.test.ts(x)   # NUEVOS
```

## Modelo de datos tocado aquí

| Entidad | Campos | Notas |
|---|---|---|
| `day_closes` (servidor) | `business_date` único, `status`, conteos, `deposit_*`, `expected_cash`, `cash_difference`, `justification`, `z_report`, `z_hash` | inmutable tras `cerrado` |
| `fiscal_config` (servidor) | fila única `id = 1`, CAI, rango, `siguiente`, `fecha_limite`, `activo = false` | SAR preparado y apagado |
| Dexie `meta`, `categories`, `products`, `staff`, `settings` | instantánea del servidor + contadores locales | `lastReceiptNumber`, `lastClientSeq` solo crecen |
| Dexie `outbox`, `sales`, `shifts`, `pinAttempts` | datos propios de la caja | nada se borra en v1 |

## Contratos

**Consumidos**:

| De | Interfaz | Garantía |
|---|---|---|
| `E1-T4` | RPC `pos_claim_device(p_code, p_label)` · `pos_pull_snapshot(p_since)` | errores `CODIGO_INVALIDO`, `NO_AUTORIZADO`; instantánea con `device.last_receipt_number` y `last_client_seq` |
| `E1-T5` | sobre y payloads de `pos_push_events` (tabla *Eventos de la caja*, en las tareas que la usan) | el servidor revalida todo |
| `E1-T2` | `encodeLines`, `writeBytes`, `getRememberedPort` | bytes ESC/POS |

**Producidos**:

| Export | Firma | Usado por |
|---|---|---|
| `src/lib/backend.tsx` | `Backend`, `BackendError` (re-exportada), `CreateBackendImpl`, `getBackend(kind)`, `useBackend(kind)`, `resetBackendForTests()`, `queryClient` | `E3-*` |
| `src/lib/backend-impl.ts` | `createBackendImpl: CreateBackendImpl` (Supabase) | `src/lib/backend.tsx` vía `@/lib/backend-impl` |
| `src/lib/utils.ts` | `cn`, `round2`, `formatLempiras`, `toLocalHN`, `buttonVariants` | `E3-*` |
| `src/lib/pin.ts` | `hashPin(pin, salt, iterations)`, `newSalt()`, `verifyPin(pin, staff)` | `E3-T4`, `E3-T5` |
| `src/pos/db.ts` | `db`, `getMeta`, `setMeta` | `E3-T1`, `E3-T2` |
| `src/pos/outbox.ts` | `enqueueEvent`, `enqueueEventInTx`, `pendingEvents(limit)` | `E3-T1`, `E3-T2` |
| `src/pos/device.ts` | `pullSnapshot(backend)`, `isPaired()` | `E3-T1` |
| `src/pos/cart.ts` | `registerSale(...)`, `cartTotals(lines)` | `E3-T2` |
| RPC del cierre | `day_close_start`, `day_close_cash_count`, `day_close_inventory_count`, `day_close_deposit`, `day_close_finalize`, `panel_summary`, `panel_list` | `E3-T3`, `E3-T5` |

## Convenciones que muerden en esta área

- Venta + número de recibo + evento `venta` en UNA transacción `db.transaction("rw", db.meta, db.sales, db.outbox, …)`; nunca dos transacciones.
- `src/lib/` no importa nada de `src/pos/` ni de `src/panel/` (el panel también usa `pin.ts`).
- Las pantallas de entrada conservan su `h1`: `/pos` contiene "Caja" y `/panel` "Panel de socios" (la prueba de humo e2e lo verifica en cada tarea).
- El backend en pruebas unitarias es un objeto falso que implementa `Backend` con `vi.fn()`; nunca red real. Se inyecta con
  `vi.mock("@/lib/backend-impl", () => ({ createBackendImpl: () => fake }))`; en `beforeEach`, `resetBackendForTests()` y `queryClient.clear()`. Borre la BD Dexie en `beforeEach`
  (`await db.delete(); await db.open();`).
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

### `E2-T1` — Cierre del día, reporte Z, panel y SAR preparado apagado

**Depende de:** `E1-T6` · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 7

1. Cree `supabase/migrations/20261122000500_cierre_dia.sql` con el bloque **M-0500** y `supabase/migrations/20261122000600_fiscal.sql` con el bloque
   **M-0600** (ambos abajo, literales).
2. `supabase/tests/cierre.test.ts` — escenario fijo del día `2026-11-22` (eventos a las 16:00 UTC): turno con fondo `{"100":3,"50":4}` (L 500.00) aprobado por un
   supervisor de caja; ventas en efectivo `CF-001` (L 209.00, recibido 300) y `PZ-001` (L 120.00, recibido 120); venta `EX-001` (L 25.00) anulada en caja con
   supervisor distinto; `turno_cerrado` con conteo `{"500":1,"200":1,"100":1,"20":1,"5":1,"2":2}` (L 829.00). Luego, como supervisor de panel `aal2`:
   - `day_close_deposit` antes de contar → `ORDEN_CIERRE` (día `2026-11-22`);
   - `day_close_start` → `day_close_cash_count({"500":1,"200":1,"100":1,"20":1,"5":1,"2":2})` → `day_close_inventory_count([{"item_code":"ALA","counted":…}])` →
     `day_close_deposit('2026-11-22', 'entrega_socio', 829, 'Socio encargado')`;
   - `day_close_finalize(fecha, 'f'.repeat(64))` con PIN distinto → `PIN_INVALIDO`;
   - **segundo día `2026-11-23`** (aislado del día 1; eventos con `client_created_at` del 23), en este orden exacto, que respeta las guardas de M-0500:
     `turno_abierto` (fondo `{"100":3,"50":4}` = L 500.00) → `venta` con un único pago `transferencia` (referencia "BAC-23001", queda `pendiente`) →
     `turno_cerrado` → `day_close_start('2026-11-23')` → `day_close_cash_count` → `day_close_inventory_count` → `day_close_deposit('2026-11-23', …)` →
     **`TRANSFERENCIAS_PENDIENTES`** → `confirm_transfer` → `day_close_cash_count('2026-11-23', {"500":1,"200":1})` (L 700.00: difiere del esperado
     L 500.00 —solo el fondo, porque la venta fue por transferencia— por L 200.00, más que el umbral L 50) → `day_close_deposit` de nuevo (ahora acepta) →
     `day_close_finalize('2026-11-23', <pin_hash correcto del supervisor>)` sin justificación → **`JUSTIFICACION_REQUERIDA`**. Así el día `2026-11-22`
     conserva exactamente sus 3 ventas;
   - finalización correcta → `z_report.ventas_total = 329`, `z_report.anulaciones.cantidad = 1`, `z_report.efectivo.esperado = 829`, `status = 'cerrado'`,
     `z_hash = encode(sha256(convert_to(z_report::text, 'UTF8')), 'hex')`;
   - `update day_closes set justification = 'x'` sobre el cerrado → `DIA_CERRADO`; `anulacion_solicitada` de una venta de ese día → evento `rechazado` con `DIA_CERRADO`;
   - `panel_summary('2026-11-22', '2026-11-22')` como socio `aal2` → `venta_total = 329`, `recibos = 2`; `panel_list('ventas', …)` devuelve 3 filas.
3. `supabase/tests/fiscal.test.ts` (superusuario inserta `fiscal_config`): con `activo = true`, establecimiento `001`, punto `001`, tipo `01`, rango 1–2, siguiente 1 y
   `fecha_limite = app.local_date(now()) + 60` (el mismo reloj que usa la función) → `app.next_fiscal_number()` devuelve `001-001-01-00000001` y luego `001-001-01-00000002`; el tercero → `RANGO_FISCAL_AGOTADO`;
   con `fecha_limite = app.local_date(now()) - 1` → `FECHA_LIMITE_VENCIDA`; con `activo = false` o sin fila → `FISCAL_INACTIVO`; con `fecha_limite = app.local_date(now()) + 10` →
   crea una alerta `rango_fiscal`; dentro de este mismo archivo se aplica por `pos_push_events` un `turno_abierto` + una `venta` (con `./fixtures`) y
   su fila en `sales` tiene `fiscal_number` nulo (no depende de ningún otro archivo de prueba).

#### Bloque M-0500 — `supabase/migrations/20261122000500_cierre_dia.sql`

```sql
-- supabase/migrations/20261122000500_cierre_dia.sql  (paso 7)
-- Cierre del día por el socio supervisor (5 pasos, ciego), reporte Z inmutable, resumen y listados del panel.

create table public.day_closes (
  id uuid primary key default gen_random_uuid(),
  business_date date not null unique,
  status text not null default 'en_progreso' check (status in ('en_progreso', 'cerrado')),
  supervisor_staff_id uuid not null references public.staff (id),
  cash_count jsonb,
  cash_count_total numeric(12, 2),
  inventory_count_id uuid references public.inventory_counts (id),
  deposit_kind text check (deposit_kind in ('entrega_socio', 'deposito_banco')),
  deposit_amount numeric(12, 2) check (deposit_amount >= 0),
  deposit_receiver text,
  deposit_photo_path text,
  expected_cash numeric(12, 2),
  cash_difference numeric(12, 2),
  justification text,
  z_report jsonb,
  z_hash text check (z_hash ~ '^[0-9a-f]{64}$'),
  signed_at timestamptz,
  created_at timestamptz not null default now()
);

select app.secure_table('public.day_closes'::regclass);

create or replace function app.is_day_closed(p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.day_closes where business_date = p_date and status = 'cerrado')
$$;

create or replace function app.day_close_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or old.status = 'cerrado' then
    raise exception 'DIA_CERRADO: el cierre % es inmutable', old.business_date using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger day_closes_guard before update or delete on public.day_closes
  for each row execute function app.day_close_guard();

-- Tras el cierre no se anula: ni solicitud nueva ni cambio a 'anulada'.
create or replace function app.sales_closed_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status in ('anulada', 'anulacion_pendiente')
     and app.is_day_closed(old.business_date) then
    raise exception 'DIA_CERRADO: el día % ya cerró; no se anula', old.business_date using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger sales_closed_guard before update of status on public.sales
  for each row execute function app.sales_closed_guard();

-- Venta tardía de un día ya cerrado: se aplica (el dinero existe) y se alerta; el Z no cambia.
create or replace function app.sales_late_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if app.is_day_closed(new.business_date) then
    perform app.raise_alert('venta_tras_cierre', 'alta', new.business_date,
      format('%s llegó después del cierre del %s', new.receipt_code, new.business_date), 'sale', new.id::text);
  end if;
  return null;
end $$;

create trigger sales_late_alert after insert on public.sales
  for each row execute function app.sales_late_alert();

create or replace function app.expected_cash(p_date date) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(opening_float_total) from public.shifts where business_date = p_date), 0)
       + coalesce((select sum(pay.amount) from public.payments pay join public.sales s on s.id = pay.sale_id
                   where s.business_date = p_date and pay.method = 'efectivo' and s.status <> 'anulada'), 0)
$$;

create or replace function app.build_z(p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_dc public.day_closes;
begin
  select * into v_dc from public.day_closes where business_date = p_date;
  return jsonb_build_object(
    'fecha', p_date,
    'recibos', (
      select jsonb_build_object('primero', min(receipt_code), 'ultimo', max(receipt_code), 'cantidad', count(*))
      from public.sales where business_date = p_date
    ),
    'ventas_total', (
      select coalesce(sum(total), 0) from public.sales where business_date = p_date and status <> 'anulada'
    ),
    'ventas_por_forma_pago', (
      select jsonb_build_object(
        'efectivo', coalesce(sum(pay.amount) filter (where pay.method = 'efectivo'), 0),
        'transferencia_confirmada', coalesce(sum(pay.amount) filter (where pay.transfer_status = 'confirmada'), 0),
        'transferencia_rechazada', coalesce(sum(pay.amount) filter (where pay.transfer_status = 'rechazada'), 0))
      from public.payments pay join public.sales s on s.id = pay.sale_id
      where s.business_date = p_date and s.status <> 'anulada'
    ),
    'ventas_por_categoria', (
      select coalesce(jsonb_agg(jsonb_build_object('categoria', x.name, 'unidades', x.u, 'monto', x.m)
        order by x.sort_order), '[]')
      from (
        select c.name, c.sort_order, sum(l.qty) as u, sum(l.line_total) as m
        from public.sale_lines l
        join public.sales s on s.id = l.sale_id
        join public.products p on p.id = l.product_id
        join public.categories c on c.code = p.category_code
        where s.business_date = p_date and s.status <> 'anulada'
        group by c.name, c.sort_order
      ) x
    ),
    'isv_incluido', (
      select jsonb_build_object(
        'gravado_15', coalesce(sum(l.line_base) filter (where l.isv_rate = 0.15), 0),
        'isv_15', coalesce(sum(l.line_isv) filter (where l.isv_rate = 0.15), 0),
        'gravado_18', coalesce(sum(l.line_base) filter (where l.isv_rate = 0.18), 0),
        'isv_18', coalesce(sum(l.line_isv) filter (where l.isv_rate = 0.18), 0),
        'exento', coalesce(sum(l.line_total) filter (where l.isv_rate = 0), 0))
      from public.sale_lines l join public.sales s on s.id = l.sale_id
      where s.business_date = p_date and s.status <> 'anulada'
    ),
    'anulaciones', (
      select jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(total), 0))
      from public.sales where business_date = p_date and status = 'anulada'
    ),
    'reimpresiones', (select count(*) from public.reprints where business_date = p_date),
    'aperturas_sin_venta', (select count(*) from public.drawer_openings where business_date = p_date),
    'consumo_interno', (
      select coalesce(jsonb_agg(jsonb_build_object('item', i.code, 'unidades', ic.qty,
        'valor', round(ic.qty * i.avg_cost, 2))), '[]')
      from public.internal_consumptions ic join public.inventory_items i on i.id = ic.item_id
      where ic.business_date = p_date
    ),
    'efectivo', jsonb_build_object(
      'esperado', v_dc.expected_cash,
      'contado', v_dc.cash_count_total,
      'diferencia', v_dc.cash_difference,
      'justificacion', v_dc.justification,
      'por_turno', (
        select coalesce(jsonb_agg(jsonb_build_object('turno_id', sh.id, 'cajero', st.display_name,
          'esperado', sh.expected_cash, 'contado', sh.closing_count_total, 'diferencia', sh.difference)
          order by sh.opened_at_client), '[]')
        from public.shifts sh join public.staff st on st.id = sh.cashier_staff_id
        where sh.business_date = p_date
      )
    ),
    'transferencias', (
      select jsonb_build_object(
        'confirmadas', jsonb_build_object('cantidad', count(*) filter (where pay.transfer_status = 'confirmada'),
          'monto', coalesce(sum(pay.amount) filter (where pay.transfer_status = 'confirmada'), 0)),
        'rechazadas', jsonb_build_object('cantidad', count(*) filter (where pay.transfer_status = 'rechazada'),
          'monto', coalesce(sum(pay.amount) filter (where pay.transfer_status = 'rechazada'), 0)))
      from public.payments pay join public.sales s on s.id = pay.sale_id
      where s.business_date = p_date and pay.method = 'transferencia'
    ),
    'merma', (
      select coalesce(jsonb_agg(jsonb_build_object('item', i.code, 'unidades', -cl.difference,
        'valor', cl.waste_value)), '[]')
      from public.inventory_count_lines cl join public.inventory_items i on i.id = cl.item_id
      where cl.count_id = v_dc.inventory_count_id and cl.difference < 0
    ),
    'ingreso', jsonb_build_object('tipo', v_dc.deposit_kind, 'monto', v_dc.deposit_amount,
      'recibe', v_dc.deposit_receiver),
    'firmado_por', (select display_name from public.staff where id = v_dc.supervisor_staff_id)
  );
end $$;

-- ---------- Asistente del cierre (supervisor). Orden: efectivo → inventario → transferencias → ingreso → firma.
create or replace function app.open_day_close(p_date date) returns public.day_closes
language plpgsql security definer set search_path = '' as $$
declare
  v public.day_closes;
begin
  select * into v from public.day_closes where business_date = p_date for update;
  if not found then
    raise exception 'ORDEN_CIERRE: primero inicie el cierre del %', p_date using errcode = 'P0001';
  end if;
  if v.status = 'cerrado' then
    raise exception 'DIA_CERRADO: el % ya cerró', p_date using errcode = 'P0001';
  end if;
  return v;
end $$;

create or replace function public.day_close_start(p_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v_id uuid;
begin
  if exists (select 1 from public.shifts where business_date = p_date and status = 'abierto') then
    raise exception 'TURNOS_ABIERTOS: cierre en caja todos los turnos del %', p_date using errcode = 'P0001';
  end if;
  if app.is_day_closed(p_date) then
    raise exception 'DIA_CERRADO: el % ya cerró', p_date using errcode = 'P0001';
  end if;
  insert into public.day_closes (business_date, supervisor_staff_id) values (p_date, v_actor)
  on conflict (business_date) do update set supervisor_staff_id = excluded.supervisor_staff_id
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.day_close_cash_count(p_date date, p_counts jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v public.day_closes := app.open_day_close(p_date);
begin
  update public.day_closes set cash_count = p_counts, cash_count_total = app.count_total(p_counts)
  where id = v.id;
end $$;

create or replace function public.day_close_inventory_count(p_date date, p_lines jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v public.day_closes := app.open_day_close(p_date);
begin
  if v.cash_count is null then
    raise exception 'ORDEN_CIERRE: primero el conteo de efectivo' using errcode = 'P0001';
  end if;
  if v.inventory_count_id is not null then
    raise exception 'ORDEN_CIERRE: el conteo de inventario ya se registró' using errcode = 'P0001';
  end if;
  update public.day_closes set inventory_count_id = app.apply_inventory_count(v_actor, p_date, p_lines)
  where id = v.id;
end $$;

create or replace function public.day_close_deposit(
  p_date date, p_kind text, p_amount numeric, p_receiver text, p_photo_path text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v public.day_closes := app.open_day_close(p_date);
begin
  if v.cash_count is null or v.inventory_count_id is null then
    raise exception 'ORDEN_CIERRE: faltan el conteo de efectivo o el de inventario' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payments pay join public.sales s on s.id = pay.sale_id
             where s.business_date = p_date and pay.transfer_status = 'pendiente') then
    raise exception 'TRANSFERENCIAS_PENDIENTES: confirme o rechace las transferencias del %', p_date
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.void_requests vr join public.sales s on s.id = vr.sale_id
             where s.business_date = p_date and vr.status = 'pendiente') then
    raise exception 'ANULACIONES_PENDIENTES: apruebe o rechace las anulaciones del %', p_date
      using errcode = 'P0001';
  end if;
  if p_kind not in ('entrega_socio', 'deposito_banco') or coalesce(p_amount, -1) < 0
     or length(trim(coalesce(p_receiver, ''))) = 0 then
    raise exception 'INGRESO_INVALIDO: tipo, monto y quién recibe son obligatorios' using errcode = 'P0001';
  end if;
  update public.day_closes set deposit_kind = p_kind, deposit_amount = p_amount,
    deposit_receiver = trim(p_receiver), deposit_photo_path = p_photo_path
  where id = v.id;
end $$;

create or replace function public.day_close_finalize(
  p_date date, p_pin_hash text, p_justification text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v public.day_closes := app.open_day_close(p_date);
  v_expected numeric := app.expected_cash(p_date);
  v_diff numeric;
  v_z jsonb;
begin
  if v.deposit_kind is null then
    raise exception 'ORDEN_CIERRE: falta registrar el ingreso del dinero' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.staff where id = v_actor and pin_hash = p_pin_hash) then
    raise exception 'PIN_INVALIDO: el PIN del supervisor no coincide' using errcode = 'P0001';
  end if;
  v_diff := v.cash_count_total - v_expected;
  if abs(v_diff) > app.setting_num('cash_diff_threshold')
     and length(trim(coalesce(p_justification, ''))) < 10 then
    raise exception 'JUSTIFICACION_REQUERIDA: diferencia de L % supera el umbral', v_diff using errcode = 'P0001';
  end if;
  update public.day_closes set expected_cash = v_expected, cash_difference = v_diff,
    justification = nullif(trim(coalesce(p_justification, '')), '')
  where id = v.id;
  v_z := app.build_z(p_date) || jsonb_build_object('firmado_en', now());
  update public.day_closes set z_report = v_z, z_hash = encode(sha256(convert_to(v_z::text, 'UTF8')), 'hex'),
    signed_at = now(), status = 'cerrado'
  where id = v.id;
  if abs(v_diff) > app.setting_num('cash_diff_threshold') then
    perform app.raise_alert('diferencia_caja', 'alta', p_date,
      format('Cierre del %s: diferencia L %s. Justificación: %s', p_date, v_diff, trim(p_justification)),
      'day_close', v.id::text);
  end if;
  return v_z;
end $$;

-- ---------- Lectura del panel (socio o supervisor con MFA) ----------
create or replace function app.raise_stale_sync_alerts() returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.devices;
begin
  for d in select * from public.devices where active
    and (last_seen_at is null or last_seen_at < now() - make_interval(hours => app.setting_num('sync_stale_hours')::int))
  loop
    if not exists (select 1 from public.alerts where kind = 'caja_sin_sincronizar' and ref_id = d.id::text
                   and acknowledged_at is null) then
      perform app.raise_alert('caja_sin_sincronizar', 'alta', app.local_date(now()),
        format('La caja %s no sincroniza desde %s', d.label, coalesce(d.last_seen_at::text, 'nunca')),
        'device', d.id::text);
    end if;
  end loop;
end $$;

create or replace function public.panel_summary(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['socio', 'supervisor']);
begin
  perform app.raise_stale_sync_alerts();
  return (
    with s as (
      select * from public.sales where business_date between p_from and p_to
    ), ok as (select * from s where status <> 'anulada')
    select jsonb_build_object(
      'desde', p_from, 'hasta', p_to,
      'venta_total', (select coalesce(sum(total), 0) from ok),
      'recibos', (select count(*) from ok),
      'ticket_promedio', (select coalesce(round(avg(total), 2), 0) from ok),
      'por_hora', (select coalesce(jsonb_agg(jsonb_build_object('hora', h, 'monto', m) order by h), '[]')
        from (select extract(hour from app.local_ts(client_created_at))::int as h, sum(total) as m
              from ok group by 1) x),
      'por_categoria', (select coalesce(jsonb_agg(jsonb_build_object('categoria', c.name, 'monto', x.m)
          order by c.sort_order), '[]')
        from (select p.category_code, sum(l.line_total) as m from public.sale_lines l
              join ok on ok.id = l.sale_id join public.products p on p.id = l.product_id group by 1) x
        join public.categories c on c.code = x.category_code),
      'por_forma_pago', (select jsonb_build_object(
          'efectivo', coalesce(sum(pay.amount) filter (where pay.method = 'efectivo'), 0),
          'transferencia', coalesce(sum(pay.amount) filter (where pay.method = 'transferencia'), 0))
        from public.payments pay join ok on ok.id = pay.sale_id),
      'diferencias_caja', (select coalesce(jsonb_agg(jsonb_build_object('cajero', st.display_name,
          'turnos', x.n, 'diferencia', x.d)), '[]')
        from (select cashier_staff_id, count(*) as n, sum(difference) as d from public.shifts
              where business_date between p_from and p_to and status = 'cerrado' group by 1) x
        join public.staff st on st.id = x.cashier_staff_id),
      'merma_piezas', (select coalesce(jsonb_agg(jsonb_build_object('item', i.code,
          'unidades', -cl.difference, 'valor', cl.waste_value)), '[]')
        from public.inventory_count_lines cl join public.inventory_counts ic on ic.id = cl.count_id
        join public.inventory_items i on i.id = cl.item_id
        where ic.business_date between p_from and p_to and cl.difference < 0 and i.kind = 'pieza'),
      'anulaciones', (select jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(total), 0))
        from s where status = 'anulada'),
      'reimpresiones', (select count(*) from public.reprints where business_date between p_from and p_to),
      'aperturas_sin_venta', (select count(*) from public.drawer_openings
        where business_date between p_from and p_to),
      'transferencias_pendientes', (select count(*) from public.payments where transfer_status = 'pendiente'),
      'anulaciones_pendientes', (select count(*) from public.void_requests where status = 'pendiente'),
      'alertas_abiertas', (select count(*) from public.alerts where acknowledged_at is null),
      'cajas', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label,
          'last_seen_at', d.last_seen_at, 'last_client_seq', d.last_client_seq, 'active', d.active)), '[]')
        from public.devices d)
    )
  );
end $$;

create or replace function public.panel_list(p_kind text, p_from date default null, p_to date default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['socio', 'supervisor']);
  v_from date := coalesce(p_from, app.local_date(now()));
  v_to date := coalesce(p_to, app.local_date(now()));
begin
  if p_kind is null or p_kind not in ('alertas', 'transferencias_pendientes', 'anulaciones_pendientes',
     'ventas', 'movimientos', 'cierres', 'cierre', 'stock', 'productos', 'recetas', 'staff', 'dispositivos') then
    raise exception 'LISTA_INVALIDA: %', coalesce(p_kind, '(nulo)') using errcode = 'P0001';
  end if;
  return case p_kind
    when 'alertas' then (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]')
      from (select * from public.alerts where acknowledged_at is null order by created_at desc limit 200) a)
    when 'transferencias_pendientes' then (select coalesce(jsonb_agg(jsonb_build_object(
        'payment_id', pay.id, 'receipt_code', s.receipt_code, 'amount', pay.amount,
        'reference', pay.transfer_reference, 'business_date', s.business_date) order by s.client_created_at), '[]')
      from public.payments pay join public.sales s on s.id = pay.sale_id where pay.transfer_status = 'pendiente')
    when 'anulaciones_pendientes' then (select coalesce(jsonb_agg(jsonb_build_object(
        'void_id', v.id, 'receipt_code', s.receipt_code, 'total', s.total, 'reason', v.reason,
        'requested_by', st.display_name, 'requested_by_id', v.requested_by)), '[]')
      from public.void_requests v join public.sales s on s.id = v.sale_id
      join public.staff st on st.id = v.requested_by where v.status = 'pendiente')
    when 'ventas' then (select coalesce(jsonb_agg(jsonb_build_object(
        'recibo', s.receipt_code, 'fecha', s.business_date, 'hora', to_char(app.local_ts(s.client_created_at), 'HH24:MI'),
        'cajero', st.display_name, 'tipo_pedido', s.order_type, 'total', s.total, 'isv', s.isv_total,
        'estado', s.status) order by s.receipt_number), '[]')
      from public.sales s join public.staff st on st.id = s.cashier_staff_id
      where s.business_date between v_from and v_to)
    when 'movimientos' then (select coalesce(jsonb_agg(jsonb_build_object(
        'fecha', m.business_date, 'item', i.code, 'tipo', m.kind, 'cantidad', m.qty, 'costo_unitario', m.unit_cost,
        'referencia', m.ref_type || ':' || m.ref_id, 'usuario', st.display_name) order by m.id), '[]')
      from public.inventory_movements m join public.inventory_items i on i.id = m.item_id
      left join public.staff st on st.id = m.staff_id where m.business_date between v_from and v_to)
    when 'cierres' then (select coalesce(jsonb_agg(jsonb_build_object('fecha', d.business_date,
        'estado', d.status, 'z', d.z_report, 'z_hash', d.z_hash) order by d.business_date desc), '[]')
      from public.day_closes d where d.business_date between v_from and v_to)
    when 'cierre' then (select to_jsonb(x) from (select business_date, status, cash_count is not null as efectivo,
        inventory_count_id is not null as inventario, deposit_kind is not null as ingreso, z_report
        from public.day_closes where business_date = v_from) x)
    when 'stock' then (select coalesce(jsonb_agg(to_jsonb(st) order by st.code), '[]') from public.inventory_stock st)
    when 'productos' then (select coalesce(jsonb_agg(to_jsonb(p) order by p.category_code, p.sort_order), '[]')
      from public.products p)
    when 'recetas' then (select coalesce(jsonb_agg(jsonb_build_object('product_code', p.code,
        'item_code', i.code, 'qty', r.qty)), '[]')
      from public.recipes r join public.products p on p.id = r.product_id
      join public.inventory_items i on i.id = r.item_id)
    when 'staff' then (select coalesce(jsonb_agg(jsonb_build_object('id', st.id, 'display_name', st.display_name,
        'role', st.role, 'active', st.active, 'has_pin', st.pin_hash is not null,
        'has_panel', st.auth_user_id is not null) order by st.display_name), '[]') from public.staff st)
    when 'dispositivos' then (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label,
        'active', d.active, 'last_seen_at', d.last_seen_at)), '[]') from public.devices d)
    else null
  end;
end $$;
```

#### Bloque M-0600 — `supabase/migrations/20261122000600_fiscal.sql`

```sql
-- supabase/migrations/20261122000600_fiscal.sql  (paso 7)
-- Facturación SAR PREPARADA Y APAGADA (Acuerdo 481-2017). Ninguna venta la usa mientras activo = false.
create table public.fiscal_config (
  id smallint primary key default 1 check (id = 1),
  rtn text not null check (rtn ~ '^[0-9]{14}$'),
  razon_social text not null,
  nombre_comercial text not null,
  direccion text not null,
  telefono text,
  correo text,
  cai text not null,
  establecimiento text not null check (establecimiento ~ '^[0-9]{3}$'),
  punto_emision text not null check (punto_emision ~ '^[0-9]{3}$'),
  tipo_doc text not null default '01' check (tipo_doc ~ '^[0-9]{2}$'),
  rango_inicial bigint not null check (rango_inicial > 0),
  rango_final bigint not null,
  siguiente bigint not null,
  fecha_limite date not null,
  activo boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint fiscal_rango check (rango_final >= rango_inicial),
  constraint fiscal_siguiente check (siguiente between rango_inicial and rango_final + 1)
);

select app.secure_table('public.fiscal_config'::regclass);

create trigger fiscal_config_touch before update on public.fiscal_config
  for each row execute function app.touch_updated_at();

-- NNN-NNN-NN-NNNNNNNN (16 dígitos). Bloquea al agotar el rango o pasar la fecha límite;
-- alerta cuando faltan 30 días o menos para la fecha límite.
create or replace function app.next_fiscal_number() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v public.fiscal_config;
  v_today date := app.local_date(now());
begin
  select * into v from public.fiscal_config where id = 1 for update;
  if not found or not v.activo then
    raise exception 'FISCAL_INACTIVO: la facturación SAR no está activada' using errcode = 'P0001';
  end if;
  if v.fecha_limite < v_today then
    raise exception 'FECHA_LIMITE_VENCIDA: el CAI venció el %', v.fecha_limite using errcode = 'P0001';
  end if;
  if v.siguiente > v.rango_final then
    raise exception 'RANGO_FISCAL_AGOTADO: se usó hasta %', v.rango_final using errcode = 'P0001';
  end if;
  update public.fiscal_config set siguiente = siguiente + 1 where id = 1;
  if v.fecha_limite - v_today <= 30 and not exists (
    select 1 from public.alerts where kind = 'rango_fiscal' and business_date = v_today
  ) then
    perform app.raise_alert('rango_fiscal', 'alta', v_today,
      format('El CAI vence el %s; tramite un nuevo rango', v.fecha_limite), 'fiscal_config', '1');
  end if;
  return v.establecimiento || '-' || v.punto_emision || '-' || v.tipo_doc || '-'
    || lpad(v.siguiente::text, 8, '0');
end $$;
```

**Files**

- `supabase/migrations/20261122000500_cierre_dia.sql`
- `supabase/migrations/20261122000600_fiscal.sql`
- `supabase/tests/cierre.test.ts`
- `supabase/tests/fiscal.test.ts`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** el supervisor ejecuta `day_close_deposit` antes de registrar el conteo de efectivo y el de inventario, o con transferencias `pendiente` del día **EL SISTEMA DEBERÁ** fallar con `ORDEN_CIERRE` o `TRANSFERENCIAS_PENDIENTES` respectivamente.
2. **CUANDO** `day_close_finalize` recibe un `p_pin_hash` distinto del `pin_hash` del supervisor **EL SISTEMA DEBERÁ** fallar con `PIN_INVALIDO`, y con una diferencia de efectivo mayor a `cash_diff_threshold` sin justificación DEBERÁ fallar con `JUSTIFICACION_REQUERIDA`.
3. **CUANDO** `day_close_finalize` cierra un día con ventas en efectivo de L 209.00 y L 120.00, una venta anulada de L 25.00 y fondo de L 500.00 **EL SISTEMA DEBERÁ** guardar `z_report` con `ventas_total = 329`, `anulaciones.cantidad = 1`, `efectivo.esperado = 829`, `status = 'cerrado'` y `z_hash` igual al sha256 de `z_report::text`.
4. **CUANDO** se intenta `UPDATE` sobre un `day_closes` cerrado, o anular una venta de ese día **EL SISTEMA DEBERÁ** fallar con `DIA_CERRADO`.
5. **CUANDO** `app.next_fiscal_number()` se llama con `fiscal_config` activo, establecimiento `001`, punto `001`, tipo `01` y siguiente 1 **EL SISTEMA DEBERÁ** devolver `001-001-01-00000001` y luego `001-001-01-00000002`.
6. **CUANDO** el rango está agotado o `fecha_limite` ya pasó **EL SISTEMA DEBERÁ** fallar con `RANGO_FISCAL_AGOTADO` o `FECHA_LIMITE_VENCIDA`, y con `fiscal_config.activo = false` DEBERÁ fallar con `FISCAL_INACTIVO`.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test:db -- supabase/tests/cierre.test.ts supabase/tests/fiscal.test.ts
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
git add -A && git commit -m "E2-T1 paso 7: cierre-z-fiscal"
git tag step-07-cierre-z-fiscal
git ls-files --error-unmatch supabase/migrations/20261122000600_fiscal.sql   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

### `E2-T2` — App shell: env validado, backend y utilidades

**Depende de:** `E1-T1`, `E1-T3` · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 8

1. `src/lib/env.ts`: esquema zod `{ VITE_SUPABASE_URL: z.url(), VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1) }`;
   `parseEnv(raw)` lanza `Error("Variable de entorno inválida: VITE_SUPABASE_URL")` (con el nombre de la primera variable inválida); `env = parseEnv(import.meta.env)`.
   Ningún otro archivo lee `import.meta.env` (todas las variables son requeridas desde este paso — §10).
2. `src/lib/backend.tsx`: los tipos del bloque *Contrato Backend* (§6) — `Backend`, `Session`, `TotpFactor`, `TotpEnrollment`, `BackendKind`,
   `CreateBackendImpl` — y la re-exportación de `BackendError` (definida en `@/lib/utils`); `getBackend(kind)` / `useBackend(kind)` devuelven un singleton por
   tipo, creado perezosamente con `createBackendImpl(kind)`, importado **estáticamente** de `@/lib/backend-impl`; `resetBackendForTests()` vacía esa caché de
   singletons (solo para pruebas); y un `QueryClient` exportado (`retry: 1`, `refetchOnWindowFocus: true`). Sin contexto React ni proveedor, y **ninguna referencia al backend simulado**: qué archivo implementa `@/lib/backend-impl`
   lo decide el alias por modo de `vite.config.ts` (§19.6).
3. `src/lib/backend-impl.ts` (implementación Supabase): `export const createBackendImpl: CreateBackendImpl` (import **solo de tipo** desde `@/lib/backend`)
   con `createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: kind === "pos" ? "pc-pos-auth" : "pc-panel-auth" } })`
   (dos clientes separados: la sesión de la caja y la del panel nunca se pisan en la misma PC); `rpc()` convierte `{ error }` en `BackendError` (de `@/lib/utils`)
   con `code` = prefijo antes de `:` del mensaje, o `"RED"` si es un fallo de red.
   Lea los tipos instalados de `@supabase/supabase-js` para `auth.signInAnonymously`, `auth.mfa.enroll/challengeAndVerify/listFactors/getAuthenticatorAssuranceLevel` y `storage.from().upload`.
4. `src/lib/utils.ts`: `cn(...inputs)` (clsx + tailwind-merge); `round2(n)`; `formatLempiras(n)` → `"L 1,234.50"` (separador de miles con coma, 2 decimales,
   **sin `Intl`**); `toLocalHN(iso)` → `{ fecha: "2026-11-22", hora: "10:00" }` restando 6 h a UTC; la clase `BackendError` del *Contrato Backend*; `buttonVariants` (cva: `primary`, `secondary`, `danger`, `ghost`; tamaños `md`, `lg`, `pos` = `min-h-18 min-w-18 text-lg font-bold`).
5. `src/lib/backend.test.tsx`: `parseEnv` con URL vacía o `"no-es-url"` lanza un error que contiene `VITE_SUPABASE_URL`; con `.env.test`, `getBackend("pos")` y
   `getBackend("panel")` se crean sin llamar `fetch` (espía `globalThis.fetch`); `formatLempiras(1234.5) === "L 1,234.50"`, `formatLempiras(0) === "L 0.00"`; `toLocalHN("2026-11-22T16:00:00.000Z")`
   → hora `"10:00"`; `App` en `/pos` y `/panel` sigue mostrando `Caja` y `Panel de socios`; un error `{ message: "CODIGO_INVALIDO: x" }` se
   normaliza a `code = "CODIGO_INVALIDO"`.

#### Contrato Backend

```ts
// src/lib/backend.tsx — contrato único hacia Supabase (o el simulado de e2e)
export type Aal = "aal1" | "aal2";
export type Session = { userId: string; aal: Aal; isAnonymous: boolean };
export type TotpFactor = { id: string; status: "verified" | "unverified" };
export type TotpEnrollment = { factorId: string; qrCodeSvg: string; secret: string };

// Definida en src/lib/utils.ts; src/lib/backend.tsx la re-exporta.
export class BackendError extends Error {
  constructor(
    public readonly code: string, // prefijo antes de ":" del mensaje SQL, o "RED" sin conexión
    message: string,
  ) {
    super(message);
  }
}

export interface Backend {
  rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T>;
  getSession(): Promise<Session | null>;
  signInAnonymously(): Promise<Session>;
  signInWithPassword(email: string, password: string): Promise<Session>;
  signOut(): Promise<void>;
  listTotpFactors(): Promise<TotpFactor[]>;
  enrollTotp(): Promise<TotpEnrollment>;
  verifyTotp(factorId: string, code: string): Promise<Session>;
  uploadReceiptPhoto(path: string, file: Blob): Promise<string>; // bucket privado "comprobantes"
}

export type BackendKind = "pos" | "panel"; // dos clientes: storageKey "pc-pos-auth" y "pc-panel-auth"
// La implementa el módulo "@/lib/backend-impl": src/lib/backend-impl.ts (Supabase) en todos los modos, salvo el modo
// de Vite e2e-mock, donde el alias de vite.config.ts lo apunta a src/lib/mock-backend.ts (paso 18).
export type CreateBackendImpl = (kind: BackendKind) => Backend;
```

**Files**

- `src/lib/env.ts`
- `src/lib/backend.tsx`
- `src/lib/backend-impl.ts`
- `src/lib/utils.ts`
- `src/lib/backend.test.tsx`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** `parseEnv` recibe `VITE_SUPABASE_URL` vacío o que no es una URL **EL SISTEMA DEBERÁ** lanzar un error cuyo mensaje contiene `VITE_SUPABASE_URL`.
2. **CUANDO** `npm run test` crea los backends `pos` y `panel` con los valores de `.env.test` **EL SISTEMA DEBERÁ** hacerlo sin llamar `fetch`.
3. **CUANDO** el backend recibe un error con mensaje `CODIGO_INVALIDO: x` **EL SISTEMA DEBERÁ** lanzar un `BackendError` con `code = "CODIGO_INVALIDO"`.
4. **CUANDO** `formatLempiras(1234.5)` se ejecuta **EL SISTEMA DEBERÁ** devolver `L 1,234.50` sin usar `Intl`.
5. **CUANDO** `App` se renderiza en `/pos` y `/panel` **EL SISTEMA DEBERÁ** seguir mostrando los encabezados `Caja` y `Panel de socios`, y `npm run e2e -- e2e/smoke.spec.ts` DEBERÁ salir con código 0.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test -- src/lib/backend.test.tsx
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run test:db
npm run build
npm run e2e -- e2e/smoke.spec.ts
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T2 paso 8: app-shell"
git tag step-08-app-shell
git ls-files --error-unmatch src/lib/backend.tsx   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

### `E2-T3` — Emparejamiento de la caja, Dexie e instantánea

**Depende de:** `E1-T2`, `E1-T4`, `E2-T2` · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 9

1. `src/pos/db.ts`: `PosDb extends Dexie` llamada `"pollo-chilero-pos"`, `version(1).stores(...)` exactamente como el bloque *Almacén local* (abajo, igual a §4)
   y tipos de cada tabla; `export const db = new PosDb()`; `getMeta(key)` / `setMeta(key, value)`.
2. `src/pos/device.ts`: `pairDevice(backend, code, label)` → `backend.signInAnonymously()` → `backend.rpc("pos_claim_device", { p_code: code.trim().toUpperCase(), p_label: label })`
   → guarda `deviceId` y `deviceLabel` en `meta` → `navigator.storage?.persist?.()` (guarda el resultado en `meta.storagePersisted`) → `pullSnapshot(backend)`;
   `pullSnapshot(backend)` → `rpc("pos_pull_snapshot", { p_since: meta.snapshotVersion ?? 0 })`; si `unchanged` no escribe nada; si no, en una transacción reemplaza
   `categories`, `products`, `staff`, `settings`, guarda `snapshotVersion` y fija `lastReceiptNumber = max(local, device.last_receipt_number)` y
   `lastClientSeq = max(local, device.last_client_seq)`; `isPaired()`.
3. `src/pos/PairingScreen.tsx`: `<h1>Caja — Emparejar esta caja</h1>`, campo "Código de emparejamiento" (8 caracteres, mayúsculas), campo "Nombre de la caja"
   (por defecto "Caja 1"), botón "Emparejar". Error `CODIGO_INVALIDO` → "Código inválido o vencido"; `RED` → "Sin conexión: el emparejamiento necesita internet".
4. `src/pos/PosRoutes.tsx`: el índice muestra `PairingScreen` si `!isPaired()` (con `useLiveQuery`); si está emparejada, muestra "Caja emparejada: <label>"
   (el paso 10 lo reemplaza por el selector de cajero). Conserva la ruta `hardware`.
5. `src/pos/device.test.ts`: con un backend falso (objeto `fake` que implementa `Backend` con `vi.fn()`; inyección del backend falso: `vi.mock("@/lib/backend-impl", () => ({ createBackendImpl: () => fake }))`; en `beforeEach`, `resetBackendForTests()` y `queryClient.clear()` (ambos de `@/lib/backend`)): `pairDevice("abcd2345", "Caja 1")` llama `signInAnonymously` y luego
   `pos_claim_device` con `p_code: "ABCD2345"` y guarda `deviceId`; con `CODIGO_INVALIDO` no guarda `deviceId` y la pantalla muestra "Código inválido o vencido";
   una instantánea versión 7 con `last_receipt_number = 120` reemplaza las tablas y deja `lastReceiptNumber = 120` (o el local si es mayor); `unchanged: true` no escribe.

#### Almacén local (Dexie)

```ts
// src/pos/db.ts — base IndexedDB "pollo-chilero-pos", versión 1
this.version(1).stores({
  meta: "key", // deviceId, deviceLabel, snapshotVersion, lastReceiptNumber, lastClientSeq, storagePersisted, syncState
  categories: "code, sortOrder",
  products: "id, code, categoryCode, active",
  staff: "id, role", // displayName, pinSalt, pinHash, pinIterations
  settings: "key",
  outbox: "clientSeq, status, eventId", // type, staffId, payload, clientCreatedAt, attempts, lastError, ackedAt
  sales: "id, receiptNumber, shiftId, createdAt, status", // receiptCode, cashierId, orderType, lines, payments, total, isv
  shifts: "id, status, cashierId", // openedAt, openingFloat, openingTotal, closingCount, closedAt, approvedBy
  pinAttempts: "staffId", // failures, lockedUntil
});
```

Estados locales: `outbox.status` ∈ `pendiente` · `enviando` · `aplicado` · `duplicado` · `rechazado`; `sales.status` ∈ `registrada` ·
`anulacion_solicitada` · `anulada`; `shifts.status` ∈ `abierto` · `cerrado`. Ningún registro de `outbox`, `sales` o `shifts` se borra en v1.

**Files**

- `src/pos/db.ts`
- `src/pos/device.ts`
- `src/pos/PairingScreen.tsx`
- `src/pos/PosRoutes.tsx`
- `src/pos/device.test.ts`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** la caja no está emparejada y se abre `/pos` **EL SISTEMA DEBERÁ** mostrar el encabezado `Caja — Emparejar esta caja` con un campo para el código de 8 caracteres.
2. **CUANDO** `pairDevice` se ejecuta con el código `abcd2345` contra un backend falso que lo acepta **EL SISTEMA DEBERÁ** llamar `signInAnonymously` y luego `pos_claim_device` con `p_code` `ABCD2345`, y guardar `deviceId` en la tabla `meta` de Dexie.
3. **CUANDO** el backend falso rechaza con `CODIGO_INVALIDO` **EL SISTEMA DEBERÁ** mostrar `Código inválido o vencido` y no guardar `deviceId`.
4. **CUANDO** `pullSnapshot` recibe una instantánea con versión 7 y `last_receipt_number = 120` **EL SISTEMA DEBERÁ** reemplazar `products`, `categories`, `staff` y `settings` en Dexie, guardar `snapshotVersion = 7` y fijar el contador local de recibos en el mayor entre el local y 120.
5. **CUANDO** la instantánea responde `unchanged: true` **EL SISTEMA DEBERÁ** conservar los datos locales sin escribir en Dexie.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test -- src/pos/device.test.ts
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run test:db
npm run build
npm run e2e -- e2e/smoke.spec.ts
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T3 paso 9: emparejamiento-dexie"
git tag step-09-emparejamiento-dexie
git ls-files --error-unmatch src/pos/db.ts   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

### `E2-T4` — Selector de cajero, PIN PBKDF2 y outbox

**Depende de:** `E2-T3` · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 10

1. `src/lib/pin.ts`: `hashPin(pin, saltHex, iterations)` → hex de 64 caracteres (WebCrypto `PBKDF2`, `SHA-256`, 256 bits); `newSalt()` → 16 bytes aleatorios en hex
   (32 caracteres); `verifyPin(pin, staff)` compara con `staff.pinHash`; `registerFailure(staffId)` / `clearFailures(staffId)` / `lockedUntil(staffId)` sobre la tabla
   Dexie `pinAttempts` con la política `settings.pin_lockout` (5 intentos, 30 s). Este módulo vive en `src/lib/` porque el panel lo usa para crear PIN (paso 16)
   — recibe la tabla `pinAttempts` por parámetro para no importar `src/pos/`.
2. `src/pos/outbox.ts`: tipos `PosEventType` (`turno_abierto`, `turno_cerrado`, `venta`, `anulacion_solicitada`, `reimpresion`, `gaveta_abierta`, `consumo_interno`,
   `pin_bloqueado`) y sus payloads (tabla *Eventos de la caja*, abajo); `enqueueEventInTx(type, staffId, payload)` — debe ejecutarse dentro de una transacción
   `rw` que incluya `meta` y `outbox`: incrementa `meta.lastClientSeq`, asigna `eventId = crypto.randomUUID()`, `clientCreatedAt = new Date().toISOString()`,
   `status: "pendiente"`, `attempts: 0`; `enqueueEvent(...)` abre su propia transacción; `pendingEvents(limit)`.
3. `src/pos/CashierLogin.tsx`: `<h1>Caja — ¿Quién atiende?</h1>`, un botón grande (`buttonVariants({ size: "pos" })`) por staff activo con rol `cajero` o
   `supervisor` y `pinHash`; al tocarlo, teclado PIN en pantalla de 4 dígitos (botones 0–9, borrar; también acepta teclado físico) con puntos ocultos; PIN correcto →
   `onLogin(staff)`; incorrecto → "PIN incorrecto"; al 5.º fallo → "Bloqueado 30 s" y `enqueueEvent("pin_bloqueado", staff.id, { blocked_staff_id: staff.id })`.
   Cambiar de cajero = botón "Cambiar cajero" (vuelve a esta pantalla) + tocar nombre = 2 toques antes del PIN.
4. `src/pos/PosRoutes.tsx`: emparejada y sin cajero → `CashierLogin`; con cajero → "Atiende: <nombre>" + "Cambiar cajero" (el paso 11 agrega el turno). El cajero
   activo vive en estado React (se pierde al recargar: se vuelve a pedir PIN).
5. `src/pos/pin-outbox.test.tsx`: `hashPin("1234", sal, 210000)` dos veces → mismo hex de 64; `"1235"` → distinto; render con 2 cajeros en Dexie → 2 botones; PIN
   correcto → `onLogin`; 5 incorrectos → "Bloqueado 30 s" y 1 evento `pin_bloqueado` en `outbox`; 3 `enqueueEvent` → `clientSeq` 1, 2, 3 y `eventId` distintos.

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

- `src/lib/pin.ts`
- `src/pos/outbox.ts`
- `src/pos/CashierLogin.tsx`
- `src/pos/PosRoutes.tsx`
- `src/pos/pin-outbox.test.tsx`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** la caja emparejada abre `/pos` sin cajero activo **EL SISTEMA DEBERÁ** mostrar un botón por cada staff activo con rol `cajero` o `supervisor` y PIN, con su nombre.
2. **CUANDO** se toca un nombre y se ingresa el PIN correcto de 4 dígitos **EL SISTEMA DEBERÁ** marcar a ese staff como cajero activo usando `verifyPin` (PBKDF2-SHA256 con la sal y las iteraciones del staff).
3. **CUANDO** se ingresa un PIN incorrecto 5 veces seguidas **EL SISTEMA DEBERÁ** bloquear a ese staff 30 segundos, mostrar `Bloqueado 30 s` y encolar un evento `pin_bloqueado` en el outbox.
4. **CUANDO** `enqueueEvent` encola 3 eventos **EL SISTEMA DEBERÁ** asignar `clientSeq` 1, 2 y 3 consecutivos y un `eventId` UUID distinto a cada uno, persistidos en la tabla `outbox`.
5. **CUANDO** `hashPin("1234", sal, 210000)` se calcula dos veces **EL SISTEMA DEBERÁ** devolver el mismo hash hexadecimal de 64 caracteres, y uno distinto para el PIN `1235`.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test -- src/pos/pin-outbox.test.tsx
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run test:db
npm run build
npm run e2e -- e2e/smoke.spec.ts
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T4 paso 10: cajero-pin"
git tag step-10-cajero-pin
git ls-files --error-unmatch src/pos/outbox.ts   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

### `E2-T5` — Turno en caja: fondo, cierre ciego y acciones de supervisor

**Depende de:** `E2-T4`, `E1-T5` · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 11

1. `src/pos/shift.ts` (lógica pura + Dexie): `countTotal(counts)` con las denominaciones de `settings.denominations` (L 500…0.10);
   `openShift(cashier, approver, counts)` — exige `approver.role === "supervisor"` y `approver.id !== cashier.id` (si no, `Error("Se requiere otro supervisor")`), guarda
   `shifts` `abierto` y encola `turno_abierto` en la misma transacción; `currentShift()`; `expectedCash(shiftId)` = fondo + suma de pagos `efectivo` de ventas locales
   del turno no anuladas; `closeShift(shiftId, counts)` → guarda conteo, encola `turno_cerrado`, devuelve `{ esperado, contado, diferencia }`;
   `requestVoid(sale, reason, approver?)` (sin aprobador → venta local `anulacion_solicitada`; con supervisor distinto → `anulada`), `openDrawer(reason)`,
   `internalConsumption(itemCode, qty, reason, approver)` — todos encolan su evento; motivo de 5+ caracteres obligatorio.
2. `src/pos/ShiftScreens.tsx`: `OpenShiftScreen` (`<h1>Caja — Abrir turno</h1>`, una fila por denominación con − / + y total, selector del supervisor que
   aprueba y su PIN en un campo `type="password"` `inputMode="numeric"` de 4 dígitos propio de esta pantalla, verificado con `verifyPin`) y `CloseShiftScreen`
   (conteo ciego: mismas filas, sin mostrar el esperado; tras "Enviar conteo" muestra esperado, contado y diferencia).
3. `src/pos/SupervisorActions.tsx`: lista de las últimas 20 ventas locales con "Solicitar anulación" (motivo + PIN de supervisor opcional), "Registrar apertura de gaveta sin venta"
   (motivo; la gaveta se abre a mano —no se envía pulso—, el registro deja constancia de quién y por qué), "Consumo interno" (ítem: `ALA`, `PIERNA`, `MUSLO`, `PECHUGA`, `PAPA-PERS` o una bebida `BE-NNN` del catálogo local —
   el código del ítem de bebida es el mismo del producto—, cantidad, motivo, PIN de supervisor).
4. `src/pos/PosRoutes.tsx`: con cajero y sin turno abierto → `OpenShiftScreen`; con turno → pantalla provisional con "Cerrar turno" y "Acciones de supervisor".
5. `src/pos/shift.test.tsx`: fondo `{"100":3,"50":4}` → total 500 y evento `turno_abierto` con `approved_by`; aprobador = cajero → error y 0 eventos; cierre: el
   esperado no está en el documento antes de enviar y sí después; anulación sin PIN → `anulacion_solicitada` sin `approved_by`; con supervisor distinto → `anulada`
   con `approved_by`; gaveta con motivo vacío → no encola; consumo interno → `consumo_interno`.

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

- `src/pos/shift.ts`
- `src/pos/ShiftScreens.tsx`
- `src/pos/SupervisorActions.tsx`
- `src/pos/PosRoutes.tsx`
- `src/pos/shift.test.tsx`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** el cajero abre turno con fondo `{"100": 3, "50": 4}` y el PIN de un supervisor distinto **EL SISTEMA DEBERÁ** guardar un turno `abierto` con total de fondo 500 y encolar `turno_abierto` con `approved_by` del supervisor.
2. **CUANDO** el PIN de aprobación pertenece al mismo staff que abre el turno **EL SISTEMA DEBERÁ** mostrar `Se requiere otro supervisor` y no encolar ningún evento.
3. **CUANDO** el cajero cierra turno **EL SISTEMA DEBERÁ** pedir el conteo por denominación sin mostrar el efectivo esperado, y solo después de enviar mostrar esperado, contado y diferencia, encolando `turno_cerrado`.
4. **CUANDO** se solicita anular una venta local sin PIN de supervisor **EL SISTEMA DEBERÁ** marcarla `anulacion_solicitada` y encolar `anulacion_solicitada` sin `approved_by`, y con el PIN de un supervisor distinto DEBERÁ marcarla `anulada` y encolar con `approved_by`.
5. **CUANDO** se abre la gaveta sin venta o se registra consumo interno **EL SISTEMA DEBERÁ** exigir un motivo de al menos 5 caracteres (y PIN de supervisor para consumo interno) y encolar `gaveta_abierta` o `consumo_interno`.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test -- src/pos/shift.test.tsx
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run test:db
npm run build
npm run e2e -- e2e/smoke.spec.ts
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T5 paso 11: turno-caja"
git tag step-11-turno-caja
git ls-files --error-unmatch src/pos/shift.ts   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

### `E2-T6` — Pantalla de venta táctil con pagos y recibo correlativo

**Depende de:** `E2-T5` · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 12

1. `src/pos/cart.ts` (puro): `addItem`, `removeItem`, `setQty`; `cartTotals(lines)` → `{ total, base, isv }` con ISV por línea
   `base = round2(lineTotal / (1 + isvRate))`, `isv = lineTotal − base` (mismo cálculo que el servidor); `cashChange(total, received)`;
   `validatePayments(total, payments)` (suma = total; efectivo con recibido ≥ monto; transferencia con referencia de 4+ caracteres);
   `registerSale({ cart, orderType, payments, cashier, shift })` — UNA transacción `rw` sobre `meta`, `sales`, `outbox`: `receiptNumber = meta.lastReceiptNumber + 1`,
   `receiptCode = "R-" + 8 dígitos`, guarda la venta local y llama `enqueueEventInTx("venta", …)` con el payload de la tabla *Eventos de la caja*.
2. `src/pos/NumPad.tsx`: teclado numérico en pantalla para montos (0–9, `.`, borrar, "Exacto"), botones `min-h-18`.
3. `src/pos/SaleScreen.tsx` (`<h1>Caja — Venta</h1>` visualmente oculto con `sr-only`): pestañas de las 6 categorías en orden `sort_order` (`role="tablist"`, activa
   `bg-accent text-accent-foreground font-bold text-xl`); cuadrícula de productos activos de la categoría con nombre y `formatLempiras(price)`, botones `min-h-18 min-w-18`;
   carrito a la derecha con cantidades +/−, total `text-5xl font-bold` e ISV incluido; selector obligatorio "Comer aquí" / "Para llevar"; botón "Cobrar"
   deshabilitado sin líneas o sin tipo de pedido; diálogo de cobro: efectivo (NumPad, cambio en grande), transferencia (referencia), mixto; "Confirmar" deshabilitado
   mientras `validatePayments` falle; al confirmar llama `registerSale`, limpia el carrito y muestra "Recibo R-00000001 registrado".
4. `src/pos/PosRoutes.tsx`: con turno abierto → `SaleScreen` con barra superior (cajero, "Cerrar turno", "Acciones de supervisor", "Cambiar cajero").
5. `src/pos/sale.test.tsx`: semilla Dexie con las 6 categorías y productos `PZ-001` (L 120.00) y `BE-008` (L 13.00); verifica pestañas en orden; botón de producto con
   clases `min-h-18` y `min-w-18`; 2× `PZ-001` + 1× `BE-008` → total "L 253.00" e ISV "L 33.00"; "Cobrar" deshabilitado sin tipo de pedido; efectivo L 300.00 → cambio
   "L 47.00" y venta `R-00000001` + 1 evento `venta`; mixto L 200.00 + L 53.00 sin referencia → "Confirmar" deshabilitado; dos `registerSale` lanzados con
   `Promise.all` → `R-00000001` y `R-00000002`, 2 eventos `venta` en `outbox` con `clientSeq` consecutivos y `fetch` no llamado (espía
   `globalThis.fetch`).

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

- `src/pos/cart.ts`
- `src/pos/NumPad.tsx`
- `src/pos/SaleScreen.tsx`
- `src/pos/PosRoutes.tsx`
- `src/pos/sale.test.tsx`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** se abre la pantalla de venta **EL SISTEMA DEBERÁ** mostrar 6 pestañas en el orden Combos familiares, Combos personales, Pollo en piezas, Combos infantiles, Extras, Bebidas, y botones de producto con nombre, precio y las clases `min-h-18` y `min-w-18` (72 px).
2. **CUANDO** se agregan 2× `PZ-001` (L 120.00) y 1× `BE-008` (L 13.00) **EL SISTEMA DEBERÁ** mostrar el total `L 253.00` y el ISV incluido `L 33.00`.
3. **CUANDO** no se ha elegido `Comer aquí` ni `Para llevar` **EL SISTEMA DEBERÁ** mantener deshabilitado el botón `Cobrar`.
4. **CUANDO** se cobra en efectivo con L 300.00 recibidos para un total de L 253.00 **EL SISTEMA DEBERÁ** mostrar el cambio `L 47.00`, guardar la venta con `receiptCode` `R-00000001` y encolar un evento `venta` en la misma transacción Dexie.
5. **CUANDO** se cobra mixto con L 200.00 en efectivo y L 53.00 por transferencia sin referencia **EL SISTEMA DEBERÁ** mantener deshabilitado `Confirmar` hasta que se ingrese una referencia de al menos 4 caracteres.
6. **CUANDO** se registran dos ventas concurrentes **EL SISTEMA DEBERÁ** asignar `R-00000001` y `R-00000002` sin huecos ni repetidos, con 2 eventos `venta` en `outbox` con `clientSeq` consecutivos y `fetch` no llamado.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test -- src/pos/sale.test.tsx
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run test:db
npm run build
npm run e2e -- e2e/smoke.spec.ts
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T6 paso 12: pantalla-venta"
git tag step-12-pantalla-venta
git ls-files --error-unmatch src/pos/cart.ts   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

---

## Aceptación del epic

1. **CUANDO** `src/pos/sale.test.tsx` registra dos ventas concurrentes con un backend falso **EL SISTEMA DEBERÁ** guardar `R-00000001` y `R-00000002` y encolar
   dos eventos `venta` con `clientSeq` consecutivos, sin ninguna llamada de red.
2. **CUANDO** `supabase/tests/cierre.test.ts` cierra el día `2026-11-22` del escenario fijo **EL SISTEMA DEBERÁ** producir un Z con `ventas_total = 329` y rechazar
   cualquier cambio posterior con `DIA_CERRADO`.

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test && npm run test:db
npm run build
npm run e2e -- e2e/smoke.spec.ts
```

## Trampas

- **Dos transacciones para una venta** — si el recibo se numera en una y el evento se encola en otra, un cierre de pestaña entre ambas deja un hueco.
- **Confiar en `Date.now()` para ordenar** — el orden es `clientSeq`; la hora del cliente es informativa.
- **Mostrar el esperado en el cierre ciego** — ni en el DOM ni en un `title`; la prueba busca el texto.
- **Compartir sesión entre caja y panel** — son dos clientes Supabase con `storageKey` distintos; si comparten uno, abrir el panel en la PC de caja desempareja la caja.

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

