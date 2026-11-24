---
description: Convenciones de la caja offline-first (Dexie, outbox, sincronización, impresión)
paths:
  - "src/pos/**"
---

# Caja offline-first

- Toda escritura va primero a Dexie (`src/pos/db.ts`); la red es opcional en todas las pantallas.
- Venta + número de recibo + evento `venta` en UNA transacción `db.transaction("rw", ...)`.
- `client_seq` y `lastReceiptNumber` solo crecen; al recibir la instantánea se usa `max(local, servidor)`.
- Ninguna pantalla llama `pos_push_events`: solo `src/pos/sync.ts`.
- IDs nuevos con `crypto.randomUUID()`; horas con `new Date().toISOString()` (el servidor no ordena por ellas).
- El precio viene del catálogo en Dexie; no existe campo para editarlo.
- El PIN se verifica con `verifyPin()` de `src/lib/pin.ts`; 5 fallos → bloqueo 30 s + evento `pin_bloqueado`.
- Impresión: `src/pos/print/print-service.ts` decide Web Serial o `window.print()`; montos con `formatLempiras()`.
- Botones táctiles mínimo `min-h-18 min-w-18` (72 px); todo operable con teclado.
