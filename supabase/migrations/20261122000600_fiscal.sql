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
