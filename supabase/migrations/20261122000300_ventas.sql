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
