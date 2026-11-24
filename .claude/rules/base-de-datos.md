---
description: Convenciones de base de datos Supabase (migraciones, RPC, RLS, bitácora)
paths:
  - "supabase/**"
---

# Base de datos

- `supabase/migrations/` es la fuente de verdad; el editor de tablas del panel de Supabase es solo lectura.
- Una tabla nueva ejecuta `select app.secure_table('public.x'::regclass);` en su misma migración.
- Toda función expuesta en `public` es `security definer`, `set search_path = ''`, y empieza con
  `app.require_device()` o `app.require_panel(array[...])`.
- Nada de `pgcrypto`: `sha256(convert_to(x, 'UTF8'))`, `gen_random_uuid()`, `uuid_send()` nativos.
- Fechas de negocio con `app.local_date(ts)` (UTC-6 fijo), nunca `at time zone 'America/Tegucigalpa'`.
- Dinero `numeric(12, 2)`, costos `numeric(12, 4)`, cantidades de inventario `numeric(12, 3)`.
- Errores: mensaje `CODIGO: detalle`, `errcode = 'P0001'` (negocio) o `'42501'` (permiso).
- `audit_log`, `pos_events`, `sale_lines` e `inventory_movements` son de solo inserción.
- Cada regla nueva lleva su prueba en `supabase/tests/*.test.ts` con `createTestDb()` / `asRole()`.
