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
