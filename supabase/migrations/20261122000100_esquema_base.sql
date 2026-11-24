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
