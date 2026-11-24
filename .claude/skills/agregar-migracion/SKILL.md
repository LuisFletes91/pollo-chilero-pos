---
name: agregar-migracion
description: Usar al crear o cambiar tablas, columnas, funciones RPC, triggers o políticas de Supabase en este repo ("nueva tabla", "agregar columna", "nueva RPC", "cambiar la base de datos", "migración"). Crea una migración nueva con seguridad y bitácora, y su prueba en PGlite.
---

# Agregar una migración

## Cuándo usar
Cualquier cambio de esquema o de lógica SQL. Nunca se edita una migración que ya existe en
`supabase/migrations/` (puede estar aplicada en Supabase).

## Pasos
1. Cree `supabase/migrations/<AAAAMMDDHHMMSS>_<nombre>.sql` con una marca de tiempo mayor que la
   última del directorio (el orden alfabético es el orden de aplicación).
2. Cambios solo aditivos (expandir → migrar → contraer): una caja offline puede llegar con eventos de
   una versión anterior.
3. Toda tabla nueva: `select app.secure_table('public.<tabla>'::regclass);` en la misma migración
   (RLS + sin escritura directa + lectura de panel con MFA + bitácora).
4. Toda función de escritura: `language plpgsql security definer set search_path = ''`, nombres
   totalmente calificados (`public.x`, `app.y`, `auth.uid()`), y primera línea de identidad
   `app.require_panel(array['supervisor'])` o `app.require_device()`.
5. Errores: `raise exception 'CODIGO: detalle' using errcode = 'P0001'` (o `42501` para permisos).
6. Agregue o extienda la prueba en `supabase/tests/<area>.test.ts` usando `createTestDb()` y `asRole()`
   de `./harness`.

## Verify
```bash
npm run test:db   # expect: exit 0, 0 failed — incluye las pruebas de propiedad de seguridad (paso 4)
```

## No hacer
- Escribir `grant insert/update/delete` a `anon` o `authenticated`.
- Usar `pgcrypto`, `uuid-ossp` o zonas horarias por nombre: `sha256()`, `gen_random_uuid()` y
  `app.local_date()` son nativos y funcionan en PGlite.
