# Pollo Chilero — POS + Inventario — instrucciones para agentes

POS web offline-first (caja `/pos`) con inventario por receta, cierre ciego y panel con MFA para
socios (`/panel`), sobre Vite + React + TypeScript + Supabase. Todo el producto en español (es-HN).

## Comandos (Git Bash, desde la raíz)

| Tarea | Comando |
|---|---|
| Instalar | `npm install --no-audit --no-fund` (CI: `npm ci`) |
| Tipos · lint · formato | `npm run typecheck` · `npm run lint` · `npm run format:check` |
| Pruebas unitarias | `npm run test` (un archivo: `npm run test -- <ruta>`) |
| Pruebas de BD (PGlite) | `npm run test:db` (un archivo: `npm run test:db -- <ruta>`) |
| Build | `npm run build` |
| E2E | `npm run e2e:install` (una vez) · `npm run e2e` |

Orden de construcción: `blueprints/pollo-chilero-pos/tasks.json`; cada tarea se ejecuta con su
archivo `blueprints/pollo-chilero-pos/epics/NN-*.md`.

## No negociable

1. Nunca escribir tablas directo desde el cliente: solo RPC `SECURITY DEFINER` que validan rol. Una
   tabla nueva llama `select app.secure_table('public.x'::regclass);` en su misma migración.
2. Nunca editar una migración ya aplicada en Supabase: se agrega una nueva.
3. Nunca borrar ni editar ventas, eventos, movimientos ni la bitácora: se anula o se ajusta.
4. Nunca enviar ni guardar un PIN en claro: solo sal + hash PBKDF2 (≥ 100 000 iteraciones).
5. Lovable puede editar UI, nunca `supabase/migrations/`, RPC ni `src/lib/backend.tsx` sin pasar los gates.
6. Nunca hacer `git push`, `supabase db push` ni crear recursos en la nube desde un gate.
7. Nunca marcar una tarea `done` con un gate fallando, ni editar un comando `verify` para que pase.

Arquitectura completa, fronteras de imports y tokens de diseño: `CLAUDE.md` en este directorio.
