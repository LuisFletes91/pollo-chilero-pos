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
