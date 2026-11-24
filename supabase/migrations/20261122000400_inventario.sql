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
