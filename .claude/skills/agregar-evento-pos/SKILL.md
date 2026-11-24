---
name: agregar-evento-pos
description: Usar al agregar una acción nueva de la caja que deba llegar al servidor ("nuevo evento POS", "registrar X desde la caja", "nuevo tipo de evento", "sincronizar X"). Conecta outbox, sincronización y el manejador SQL app.ev_<tipo>.
---

# Agregar un tipo de evento de la caja

## Cuándo usar
Cualquier acción hecha en `/pos` que deba quedar registrada en el servidor.

## Pasos
1. Defina el tipo del payload en `src/pos/outbox.ts` (unión `PosEventType` + tipo del payload).
2. Encole con `enqueueEvent()` (o `enqueueEventInTx()` dentro de una transacción Dexie que también
   escribe datos locales). Nunca llame a la RPC directamente desde una pantalla.
3. Con la skill `agregar-migracion`, cree `app.ev_<tipo>(p_device uuid, p_event jsonb) returns void`
   (`security definer`, `set search_path = ''`). El despachador `pos_push_events` lo encuentra por
   nombre; un tipo sin función se rechaza con `TIPO_DESCONOCIDO`.
4. Valide el payload y lance `CODIGO: detalle` para rechazar. Si necesita aprobación, exija
   `approved_by` de un supervisor distinto (`SEGREGACION`).
5. Pruebe: el evento aplicado, el rechazado y el reenvío del mismo `client_seq` (`duplicado`).

## Verify
```bash
npm run test:db   # expect: exit 0
npm run test      # expect: exit 0
```

## No hacer
- Ordenar o deduplicar por hora del cliente: el orden es `client_seq` y el servidor guarda `received_at`.
