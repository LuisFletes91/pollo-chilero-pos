# Epic 03: Sincronización, recibo, panel de socios y salida

> Al terminar la caja sincroniza sola (con indicador y respaldo de emergencia), imprime el recibo de 80 mm con gaveta y reimpresión "COPIA", y el
> panel `/panel` (móvil, MFA) muestra el tablero, decide transferencias y anulaciones, administra inventario, personal y cajas, guía el cierre ciego
> hasta el reporte Z y exporta CSV. Los 3 flujos críticos pasan en e2e y las cabeceras de seguridad viajan en el build.

| | |
|---|---|
| **Epic id** | `03-operacion-panel-salida` |
| **Tareas** | `E3-T1` … `E3-T6` |
| **Depende de** | `01-fundacion-datos`, `02-cierre-y-caja` |
| **Desbloquea** | nada — es el último epic; después vienen las verificaciones manuales de `blueprint.md` §20.1 |
| **En paralelo con** | secuencial: el gate de cada tarea recorre todo el árbol |

No necesita ningún otro archivo para completar este epic. Todo lo de abajo se repite aquí a propósito.

---

## Stack

Vite 8 + React 19 + TypeScript 6 · Tailwind CSS v4 (tokens en `src/index.css`) · react-router-dom 7 · TanStack Query 5 (panel) ·
Dexie 4 / IndexedDB (caja) · vite-plugin-pwa 2 · Supabase (Postgres + Auth + RLS + Storage) · Vitest 5 + jsdom · PGlite (pruebas SQL, sin Docker) ·
Playwright · ESLint 10 + Prettier 3. Gestor: `npm` (Node 24, `.nvmrc`). Las versiones exactas están en `package.json` y `package-lock.json`:
léalas, no adivine. Todos los comandos se ejecutan en **Git Bash** desde la raíz del proyecto.

| Tarea | Comando |
|---|---|
| Tipos | `npm run typecheck` |
| Lint · formato | `npm run lint` · `npm run format:check` (arreglar: `npm run format`) |
| Pruebas unitarias (un archivo) | `npm run test -- <ruta>` |
| Pruebas de BD en PGlite (un archivo) | `npm run test:db -- <ruta>` |
| Build | `npm run build` |
| E2E | `npm run e2e -- e2e/smoke.spec.ts` (navegadores: `npm run e2e:install`) |

**Gate:** `npm run typecheck && npm run lint && npm run format:check && npm run test` (+ `npm run test:db` desde la tarea `E1-T3`) pasa antes de
marcar cualquier tarea como `done`. No hay servicios que levantar: la base de datos de las pruebas es PGlite en proceso (`supabase/tests/harness.ts`)
y nunca se usa Supabase real, Docker ni credenciales en un gate.

## Subárbol de directorios

```
src/
  pos/sync.ts                   # NUEVO (E3-T1)
  pos/SyncIndicator.tsx         # NUEVO (E3-T1)
  pos/emergency-export.ts       # NUEVO (E3-T1)
  pos/PosRoutes.tsx             # existe; se edita en E3-T1
  pos/SaleScreen.tsx            # existe (E2-T6); se edita en E3-T2
  pos/print/receipt.ts          # NUEVO (E3-T2)
  pos/print/print-service.ts    # NUEVO (E3-T2)
  pos/print/ReceiptPrintView.tsx  # NUEVO (E3-T2)
  panel/PanelRoutes.tsx         # existe (E1-T1); se edita en E3-T3, E3-T4, E3-T5
  panel/AuthScreens.tsx         # NUEVO (E3-T3)
  panel/PanelGuard.tsx          # NUEVO (E3-T3)
  panel/DashboardPage.tsx       # NUEVO (E3-T3)
  panel/InventoryPage.tsx       # NUEVO (E3-T4)
  panel/AdminPage.tsx           # NUEVO (E3-T4)
  panel/forms.ts                # NUEVO (E3-T4)
  panel/DayCloseWizard.tsx      # NUEVO (E3-T5)
  panel/ZReportView.tsx         # NUEVO (E3-T5)
  lib/csv.ts                    # NUEVO (E3-T5)
  lib/mock-backend.ts           # NUEVO (E3-T6): solo en el modo de Vite e2e-mock (alias de @/lib/backend-impl)
  lib/fiscal-invoice.ts         # NUEVO (E3-T6)
  lib/{backend.tsx,utils.ts,pin.ts}   # existen (E2); solo lectura
  {pos,panel,lib}/**/*.test.ts(x)     # NUEVOS por tarea
public/_headers                 # NUEVO (E3-T6)
e2e/flujos.spec.ts              # NUEVO (E3-T6)
```

## Modelo de datos tocado aquí

| Entidad | Uso en este epic | Notas |
|---|---|---|
| Dexie `outbox` | `sync.ts` cambia `status` (`enviando`, `aplicado`, `duplicado`, `rechazado`), `attempts`, `lastError`, `ackedAt` | nunca borra filas |
| Dexie `meta.syncState` | `{ estado, pendientes, rechazados, ultimaSincronizacion }` | lo lee `SyncIndicator` |
| `alerts`, `payments`, `void_requests`, `day_closes`, `inventory_*` (servidor) | solo por RPC | el panel nunca escribe tablas |

## Contratos

**Consumidos**:

| De | Interfaz | Garantía |
|---|---|---|
| `E2-T2` | `useBackend("pos" \| "panel")`, `BackendError` (`code` = `RED` sin conexión), `queryClient`, `formatLempiras`, `toLocalHN`, `buttonVariants` | sin `Intl` |
| `E2-T3`/`E2-T4` | `db`, `getMeta`/`setMeta`, `pendingEvents`, `enqueueEvent`, `pullSnapshot` | `clientSeq` consecutivo |
| `E2-T4` | `hashPin`, `newSalt`, `verifyPin` | PBKDF2-SHA256, hex de 64 |
| `E2-T6` | `registerSale`, venta local con `receiptCode`, `lines`, `payments` | recibo correlativo |
| `E1-T2` | `encodeLines`, `writeBytes`, `isWebSerialSupported` | ESC/POS |
| `E1-T4…E2-T1` | RPC `pos_push_events`, `panel_whoami`, `panel_summary`, `panel_list`, `confirm_transfer`, `reject_transfer`, `decide_void`, `ack_alert`, `register_purchase`, `register_cut`, `upsert_recipe`, `upsert_staff`, `link_staff_by_email`, `create_pairing_code`, `set_device_active`, `set_product`, `create_product`, `set_setting`, `verify_audit_chain`, `my_pin_params`, `day_close_*` | ver sus contratos en las tareas |

**Producidos**:

| Export | Firma | Usado por |
|---|---|---|
| `src/pos/sync.ts` | `syncOnce(backend)`, `startSync(backend)` | caja |
| `src/pos/print/print-service.ts` | `printSale(sale, { copy })`, `reprintSale(sale)` | caja |
| `src/lib/csv.ts` | `toCsv(rows, columns)`, `downloadCsv(name, text)` | panel |
| `src/lib/fiscal-invoice.ts` | `buildInvoiceLines(invoice)`, `amountInWords(n)` | activación SAR futura |
| `src/lib/mock-backend.ts` | `createBackendImpl: CreateBackendImpl` (simulado) | build `e2e-mock` → `e2e/flujos.spec.ts` |

## Convenciones que muerden en esta área

- Ninguna pantalla llama `pos_push_events`: solo `src/pos/sync.ts`. Lotes de máximo 25; espera `min(2^intentos, 300)` s.
- Panel: lecturas con `useQuery` (`refetchInterval: 60000`), escrituras con `useMutation` + `invalidateQueries`; socio = solo lectura (los botones de
  supervisor no se renderizan).
- El cierre no muestra el efectivo esperado antes de enviar el conteo (ni en texto ni en atributos `aria-*`).
- PIN: el panel calcula `hashPin` en el navegador y envía solo sal + hash; ningún argumento de RPC lleva el PIN.
- Imports dentro de `src/` siempre con `@/…` sin extensión; en `supabase/tests/` y `e2e/` rutas relativas sin extensión (`./harness`). No hay
  scripts ejecutados con `node` suelto: todo corre bajo Vite, Vitest o Playwright (matriz de resolución en `blueprint.md` §19.6).
- Errores SQL: `raise exception 'CODIGO: detalle' using errcode = 'P0001'` (o `'42501'` para permisos). El cliente usa el prefijo como `code`.
- Fechas de negocio: Honduras UTC-6 sin horario de verano → `app.local_date()` en SQL y `toLocalHN()` en TypeScript. Nunca nombres de zona horaria.
- Prohibido `.skip(` / `.only(` en pruebas: el último comando de cada Verify lo busca.
- Reglas por área: `.claude/rules/base-de-datos.md`, `pos-offline.md`, `panel.md`, `pruebas.md`; reglas globales: `CLAUDE.md`. Todo eso ya está en la
  raíz del proyecto (el Bootstrap copió `workspace/` antes de la primera tarea).

---

## Tareas

En el mismo orden que `tasks.json`. Ese orden es el orden de construcción: trabaje de arriba hacia abajo y no reordene por prioridad.

### `E3-T1` — Motor de sincronización, indicador y respaldo de emergencia

**Depende de:** `E2-T6` · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 13

1. `src/pos/sync.ts`: `syncOnce(backend)` — un solo vuelo a la vez (candado en memoria); toma hasta **25** eventos `pendiente` en orden de `clientSeq`, los marca
   `enviando`, llama `backend.rpc("pos_push_events", { p_events: [...] })` con el sobre `{ client_seq, event_id, type, staff_id, client_created_at, payload }`;
   por cada resultado: `aplicado` / `duplicado` → `status` igual y `ackedAt`; `rechazado` → `status: "rechazado"`, `lastError`; repite mientras queden pendientes;
   error `RED` → devuelve los eventos a `pendiente`, `attempts + 1`, estado `sin_conexion`, próximo intento en `min(2^attempts, 300)` s (2, 4, 8 … 300);
   `startSync(backend)` — intervalo de 15 s, evento `online`, llamada tras cada `enqueueEvent`, y `pullSnapshot` cada 5 min; `syncState` observable
   (`sincronizado` | `sincronizando` | `sin_conexion` | `error`, `pendientes`, `rechazados`, `ultimaSincronizacion`) guardado en `meta` para la UI.
2. `src/pos/SyncIndicator.tsx`: insignia con texto y color (`role="status"`, `aria-live="polite"`): "Sincronizado", "Sincronizando…", "Sin conexión", "Error";
   contador "N pendientes"; "Última sincronización HH:MM" con `toLocalHN`; botón "Reintentar ahora"; si `meta.storagePersisted` es `false`, aviso
   "El navegador puede borrar datos: no limpie el historial".
3. `src/pos/emergency-export.ts`: `exportEmergency()` → `Blob` JSON `{ exportado_en, meta, outbox, sales, shifts }` y descarga
   `respaldo-caja-<fecha>.json` (botón "Exportar respaldo de emergencia" en la barra).
4. `src/pos/PosRoutes.tsx`: monta `SyncIndicator` y el botón de exportación en la barra superior; llama `startSync` al emparejar/abrir.
5. `src/pos/sync.test.tsx` con transporte falso y `vi.useFakeTimers()`: 50 pendientes → 2 llamadas (25 + 25) en orden y 0 pendientes; reenvío con respuesta
   `duplicado` → confirmados, sin filas nuevas en `outbox`; error `RED` → siguen `pendiente`, estado "Sin conexión", reintentos a 2 s, 4 s, 8 s y tope 300 s;
   `rechazado` → estado "Error" con 1 rechazado y su mensaje; exportación con las claves `outbox`, `sales`, `shifts` y `meta`; indicador "Sincronizado" con "0 pendientes" y la hora.

#### Eventos de la caja

**Sobre de cada evento** (cliente → `pos_push_events(p_events jsonb)`, arreglo de 1 a 100, ordenado por `client_seq`):

```json
{
  "client_seq": 12,
  "event_id": "8f0c2c7e-2a8f-4b1e-9d55-0a3c1e7b9a10",
  "type": "venta",
  "staff_id": "3b1d6f0a-7c55-4e8e-9a2d-1f4b8c9e0d21",
  "client_created_at": "2026-11-22T16:03:11.123Z",
  "payload": {}
}
```

**Respuesta:** `{ "resultados": [ { "client_seq": 12, "estado": "aplicado" | "duplicado" | "rechazado", "error"?: "CODIGO: detalle", "estado_original"?: "aplicado" | "rechazado" } ], "recibido_en": "2026-11-22T16:03:12.402Z" }`.
Idempotencia por `(device_id, client_seq)`: un `client_seq` ya recibido responde `duplicado` y no vuelve a aplicarse. Un evento rechazado
queda en `pos_events` con su error y genera la alerta `evento_rechazado`; el resto del lote sigue.

| `type` | `payload` | Manejador | Rechazos posibles |
|---|---|---|---|
| `turno_abierto` | `{ shift_id, opening_float: { "100": 3, "50": 4 }, approved_by }` | `app.ev_turno_abierto` | `SEGREGACION`, `TURNO_YA_ABIERTO`, `CONTEO_INVALIDO`, `STAFF_INVALIDO` |
| `turno_cerrado` | `{ shift_id, closing_count: { "500": 1, … } }` | `app.ev_turno_cerrado` | `TURNO_NO_ABIERTO`, `CONTEO_INVALIDO` |
| `venta` | `{ sale_id, receipt_number, shift_id, order_type: "comer_aqui" \| "para_llevar", total, lines: [{ product_id, qty, unit_price }], payments: [{ payment_id, method: "efectivo" \| "transferencia", amount, cash_received?, transfer_reference? }] }` | `app.ev_venta` | `VENTA_VACIA`, `TIPO_PEDIDO_INVALIDO`, `TURNO_NO_ABIERTO`, `RECIBO_DUPLICADO`, `LINEA_INVALIDA`, `PRODUCTO_INVALIDO`, `TOTAL_INVALIDO`, `REFERENCIA_REQUERIDA`, `PAGO_INVALIDO` |
| `anulacion_solicitada` | `{ void_id, sale_id, reason, approved_by? }` | `app.ev_anulacion_solicitada` | `VENTA_NO_ENCONTRADA`, `ANULACION_INVALIDA`, `MOTIVO_REQUERIDO`, `SEGREGACION`, `DIA_CERRADO` |
| `reimpresion` | `{ reprint_id, sale_id }` | `app.ev_reimpresion` | `VENTA_NO_ENCONTRADA` |
| `gaveta_abierta` | `{ opening_id, shift_id, reason }` | `app.ev_gaveta_abierta` | `MOTIVO_REQUERIDO` |
| `consumo_interno` | `{ consumption_id, item_code, qty, reason, approved_by }` | `app.ev_consumo_interno` (paso 6) | `SEGREGACION`, `ITEM_INVALIDO`, `CANTIDAD_INVALIDA` |
| `pin_bloqueado` | `{ blocked_staff_id }` | `app.ev_pin_bloqueado` | — |

Todo evento además se rechaza con `TIPO_DESCONOCIDO` (no existe `app.ev_<type>`) o `STAFF_INVALIDO` (`staff_id` inactivo o sin rol `cajero`/`supervisor`).
Montos con 2 decimales; `qty` entero ≥ 1; IDs nuevos con `crypto.randomUUID()` en la caja.

**Files**

- `src/pos/sync.ts`
- `src/pos/SyncIndicator.tsx`
- `src/pos/emergency-export.ts`
- `src/pos/PosRoutes.tsx`
- `src/pos/sync.test.tsx`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** hay 50 eventos pendientes y el transporte falso responde `aplicado` **EL SISTEMA DEBERÁ** enviarlos en orden de `clientSeq` en lotes de máximo 25 y dejar 0 pendientes.
2. **CUANDO** el transporte falso responde `duplicado` al reenviar eventos ya aplicados **EL SISTEMA DEBERÁ** marcarlos como confirmados sin crear filas nuevas en el outbox.
3. **CUANDO** el transporte lanza un error `RED` **EL SISTEMA DEBERÁ** conservar los eventos `pendiente`, mostrar el estado `Sin conexión` y programar los reintentos a 2 s, 4 s, 8 s con tope de 300 s.
4. **CUANDO** el servidor responde `rechazado` para un evento **EL SISTEMA DEBERÁ** mostrar el estado `Error` con el contador de rechazados y conservar el evento con su mensaje.
5. **CUANDO** se toca `Exportar respaldo de emergencia` **EL SISTEMA DEBERÁ** generar un JSON con las claves `outbox`, `sales`, `shifts` y `meta` de Dexie.
6. **CUANDO** el estado es `Sincronizado` **EL SISTEMA DEBERÁ** mostrar `0 pendientes` y la hora de la última sincronización.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test -- src/pos/sync.test.tsx
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run test:db
npm run build
npm run e2e -- e2e/smoke.spec.ts
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E3-T1 paso 13: sincronizacion"
git tag step-13-sincronizacion
git ls-files --error-unmatch src/pos/sync.ts   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

### `E3-T2` — Recibo de 80 mm, impresión y reimpresión COPIA

**Depende de:** `E3-T1` · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 14

1. `src/pos/print/receipt.ts`: `buildReceiptLines(sale, { copy: boolean, cashierName, deviceLabel })` → líneas de máximo 48 caracteres con la plantilla
   *Recibo de venta* (abajo, idéntica a §6): encabezado, "RECIBO DE VENTA", código, fecha/hora locales (`toLocalHN`), caja, cajero, tipo de pedido, líneas
   (cantidad, nombre truncado, importe), total, ISV incluido, forma(s) de pago, recibido y cambio, "Este documento no es una factura"; con `copy` agrega
   `*** COPIA ***` arriba y abajo. Montos con `formatLempiras`.
2. `src/pos/print/print-service.ts`: `printSale(sale, { copy })` — modo de `settings.printer.modo` (`serial` | `navegador`); `serial` y Web Serial disponible con puerto
   recordado → `encodeLines(lines, { cut: true })` (sin pulso: la gaveta se abre a mano) + `writeBytes`; si falla o no hay soporte → `navegador`: renderiza
   `ReceiptPrintView` y `window.print()`. `reprintSale(sale)` → `printSale(..., { copy: true })` + `enqueueEvent("reimpresion", …)`.
3. `src/pos/print/ReceiptPrintView.tsx`: `<pre className="receipt-80mm">` con las líneas (oculto en pantalla salvo al imprimir).
4. `src/pos/SaleScreen.tsx`: tras `registerSale` llama `printSale`; botón "Reimprimir último" (pide confirmación) llama `reprintSale`.
5. `src/pos/print/receipt.test.ts`: recibo de 1× `CF-001` efectivo recibido L 300.00 → contiene "POLLO CHILERO", "RECIBO DE VENTA", "R-00000001", el cajero,
   "Comer aquí", "L 209.00", "Recibido", "L 300.00", "Cambio", "L 91.00", "Este documento no es una factura"; toda línea ≤ 48; copia → "*** COPIA ***" y 1 evento
   `reimpresion`; modo `serial` con efectivo y con solo transferencia → bytes sin `1b 70` (la gaveta se abre a mano); sin Web Serial → `window.print` llamado una vez;
   `formatLempiras(1234.5)` dentro del recibo → "L 1,234.50".

#### Recibo de venta

Plantilla del recibo interno (48 columnas, fuente A de la térmica de 80 mm). Ejemplo con 1× `CF-001` pagado en efectivo con L 300.00:

```text
                 POLLO CHILERO
               Orgullo Catracho
     Aldea El Ocotal, Olanchito, Yoro
                RECIBO DE VENTA
No.: R-00000001
Fecha: 2026-11-22  10:00            Caja: Caja 1
Cajero: Ana
Pedido: Comer aquí
------------------------------------------------
1 x 2 muslos + 1 pierna + 1 ala + 1 p  L 209.00
------------------------------------------------
TOTAL                                  L 209.00
ISV incluido (15%)                      L 27.26
Efectivo                               L 209.00
Recibido                               L 300.00
Cambio                                  L 91.00
------------------------------------------------
     Este documento no es una factura
            ¡Gracias por su compra!
```

Reglas: montos alineados a la derecha con `formatLempiras`; nombre del producto truncado para que la línea no pase de 48; tipo de pedido
`Comer aquí` o `Para llevar`; pago mixto imprime una línea por forma de pago y, para transferencia, `Ref.: <referencia>`; la reimpresión
agrega `*** COPIA ***` centrado como primera y última línea. Las pruebas comprueban contenido y ancho, no bytes exactos.

**Files**

- `src/pos/print/receipt.ts`
- `src/pos/print/print-service.ts`
- `src/pos/print/ReceiptPrintView.tsx`
- `src/pos/SaleScreen.tsx`
- `src/pos/print/receipt.test.ts`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** se construye el recibo de una venta **EL SISTEMA DEBERÁ** producir líneas de máximo 48 caracteres que contienen `POLLO CHILERO`, `RECIBO DE VENTA`, el código `R-00000001`, el cajero, `Comer aquí` o `Para llevar`, cada producto, el total, la forma de pago, recibido, cambio y `Este documento no es una factura`.
2. **CUANDO** se reimprime una venta **EL SISTEMA DEBERÁ** incluir la línea `*** COPIA ***` y encolar un evento `reimpresion`.
3. **CUANDO** el modo de impresión es `serial` **EL SISTEMA DEBERÁ** enviar los bytes del recibo sin el pulso de gaveta ESC p (`1b 70`), sea el pago en efectivo o por transferencia, porque la gaveta no tiene conexión con el sistema y se abre a mano.
4. **CUANDO** el modo es `navegador` o Web Serial no está disponible **EL SISTEMA DEBERÁ** renderizar `ReceiptPrintView` con la clase `receipt-80mm` y llamar `window.print()` una vez.
5. **CUANDO** un monto de 1234.5 aparece en el recibo **EL SISTEMA DEBERÁ** imprimirlo como `L 1,234.50` sin depender de `Intl`.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test -- src/pos/print/receipt.test.ts
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run test:db
npm run build
npm run e2e -- e2e/smoke.spec.ts
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E3-T2 paso 14: recibo-impresion"
git tag step-14-recibo-impresion
git ls-files --error-unmatch src/pos/print/receipt.ts   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

### `E3-T3` — Panel: login, MFA TOTP, tablero y decisiones pendientes

**Depende de:** `E2-T1`, `E2-T2` · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 15

1. `src/panel/AuthScreens.tsx`: `LoginScreen` (`<h1>Panel de socios</h1>`, subtítulo "Iniciar sesión", correo + contraseña, sin registro público, error
   "Correo o contraseña incorrectos") y `MfaScreen` — sin factor TOTP verificado: enrolamiento (`enrollTotp()` → muestra el QR SVG devuelto y el secreto, campo de
   6 dígitos, `verifyTotp`); con factor: solo el campo de 6 dígitos. Ambos con `autocomplete` correcto (`username`, `current-password`, `one-time-code`) y sin
   bloquear pegar (WCAG 3.3.8).
2. `src/panel/PanelGuard.tsx`: sin sesión → `LoginScreen`; sesión `aal1` → `MfaScreen`; `aal2` → `useQuery(["whoami"], () => rpc("panel_whoami"))` y provee
   `{ staffId, displayName, role }` por contexto; `NO_AUTORIZADO` → "Su usuario no tiene acceso al panel" + "Cerrar sesión".
3. `src/panel/DashboardPage.tsx`: selector de rango (Hoy / Ayer / 7 días); `useQuery(["summary", desde, hasta], …, { refetchInterval: 60000 })` sobre
   `panel_summary`; tarjetas: venta total, # recibos, ticket promedio, efectivo vs transferencia, venta por hora (barras CSS simples), por categoría, diferencias
   de caja por cajero, merma de piezas, anulaciones/reimpresiones/aperturas sin venta, estado de la caja (última sincronización); listas `panel_list("alertas")`,
   `("transferencias_pendientes")`, `("anulaciones_pendientes")`. **Solo si `role === "supervisor"`** se renderizan "Confirmar" / "Rechazar" (con motivo) →
   `confirm_transfer` / `reject_transfer`, "Aprobar" / "Rechazar" → `decide_void`, y "Reconocer" → `ack_alert`. Estados de carga, vacío ("Sin alertas abiertas") y error.
4. `src/panel/PanelRoutes.tsx`: envuelve sus rutas en `<QueryClientProvider client={queryClient}>` (de `@/lib/backend`); índice → `PanelGuard` › `DashboardPage`; navegación superior "Tablero" (los pasos 16 y 17 agregan "Inventario", "Administración", "Cierre del día").
5. `src/panel/panel-access.test.tsx` con backend falso (inyección del backend falso: `vi.mock("@/lib/backend-impl", () => ({ createBackendImpl: () => fake }))`; en `beforeEach`, `resetBackendForTests()` y `queryClient.clear()` (ambos de `@/lib/backend`)): sin sesión → "Iniciar sesión" y ningún monto; `aal1` sin factores → QR y campo de 6 dígitos;
   `aal2` + socio → tarjetas sin botones "Confirmar"/"Rechazar"/"Aprobar"; supervisor → botones que llaman las RPC con los ids; con `vi.useFakeTimers()`,
   avanzar 60 s → `panel_summary` llamado 2 veces.

#### Contrato Backend

```ts
// src/lib/backend.tsx — contrato único hacia Supabase (o el simulado de e2e)
export type Aal = "aal1" | "aal2";
export type Session = { userId: string; aal: Aal; isAnonymous: boolean };
export type TotpFactor = { id: string; status: "verified" | "unverified" };
export type TotpEnrollment = { factorId: string; qrCodeSvg: string; secret: string };

// Definida en src/lib/utils.ts; src/lib/backend.tsx la re-exporta.
export class BackendError extends Error {
  constructor(
    public readonly code: string, // prefijo antes de ":" del mensaje SQL, o "RED" sin conexión
    message: string,
  ) {
    super(message);
  }
}

export interface Backend {
  rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T>;
  getSession(): Promise<Session | null>;
  signInAnonymously(): Promise<Session>;
  signInWithPassword(email: string, password: string): Promise<Session>;
  signOut(): Promise<void>;
  listTotpFactors(): Promise<TotpFactor[]>;
  enrollTotp(): Promise<TotpEnrollment>;
  verifyTotp(factorId: string, code: string): Promise<Session>;
  uploadReceiptPhoto(path: string, file: Blob): Promise<string>; // bucket privado "comprobantes"
}

export type BackendKind = "pos" | "panel"; // dos clientes: storageKey "pc-pos-auth" y "pc-panel-auth"
// La implementa el módulo "@/lib/backend-impl": src/lib/backend-impl.ts (Supabase) en todos los modos, salvo el modo
// de Vite e2e-mock, donde el alias de vite.config.ts lo apunta a src/lib/mock-backend.ts (paso 18).
export type CreateBackendImpl = (kind: BackendKind) => Backend;
```

**Files**

- `src/panel/PanelRoutes.tsx`
- `src/panel/AuthScreens.tsx`
- `src/panel/PanelGuard.tsx`
- `src/panel/DashboardPage.tsx`
- `src/panel/panel-access.test.tsx`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** un visitante sin sesión abre `/panel` **EL SISTEMA DEBERÁ** mostrar el encabezado `Panel de socios` con el formulario `Iniciar sesión` (correo y contraseña) y ningún dato del negocio.
2. **CUANDO** la sesión es `aal1` y el usuario no tiene factor TOTP **EL SISTEMA DEBERÁ** mostrar el enrolamiento con el código QR y exigir un código de 6 dígitos antes de mostrar el tablero.
3. **CUANDO** la sesión es `aal2` y `panel_whoami` devuelve rol `socio` **EL SISTEMA DEBERÁ** mostrar el tablero con venta total, número de recibos, ticket promedio y alertas, sin los botones `Confirmar`, `Rechazar` ni `Aprobar`.
4. **CUANDO** el rol es `supervisor` **EL SISTEMA DEBERÁ** mostrar transferencias y anulaciones pendientes con botones que llaman `confirm_transfer`, `reject_transfer` y `decide_void`, y alertas con `Reconocer` que llama `ack_alert`.
5. **CUANDO** pasan 60 segundos con el tablero abierto **EL SISTEMA DEBERÁ** volver a consultar `panel_summary`.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test -- src/panel/panel-access.test.tsx
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run test:db
npm run build
npm run e2e -- e2e/smoke.spec.ts
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E3-T3 paso 15: panel-acceso"
git tag step-15-panel-acceso
git ls-files --error-unmatch src/panel/PanelGuard.tsx   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

### `E3-T4` — Panel: inventario, recetas, personal y emparejamiento

**Depende de:** `E3-T3`, `E1-T6` · **Prioridad:** p1 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 16

1. `src/panel/forms.ts`: esquemas zod — `purchaseSchema` (`itemCode`, `qty > 0`, `totalCost > 0`, `supplier` no vacío, `pounds` obligatorio cuando `itemCode === "POLLO-ENTERO"`
   con el mensaje "Las libras son obligatorias para pollo entero"), `cutSchema` (`chickens ≥ 1`, piezas ≥ 0), `recipeSchema` (≥ 1 línea, `qty > 0`), `staffSchema`
   (nombre, rol, PIN de 4 dígitos opcional), `productSchema`, `settingSchema`.
2. `src/panel/InventoryPage.tsx` (supervisor): stock (`panel_list("stock")`, resaltado bajo mínimo); "Registrar compra" (ítem, cantidad, costo total, proveedor, libras,
   foto opcional → `uploadReceiptPhoto("compras/<uuid>.jpg")` y `p_photo_path`) → `register_purchase`; "Corte" (pollos N → propone 2N alas, 2N piernas,
   2N muslos, 2N pechugas editables) → `register_cut(p_chickens, p_pieces)`; "Recetas" (producto → líneas ítem/cantidad editables) → `upsert_recipe`.
   Socio: solo lectura del stock.
3. `src/panel/AdminPage.tsx` (supervisor): personal (`panel_list("staff")`; crear/editar cajero o supervisor con PIN de 4 dígitos → `newSalt()` + `hashPin(pin, sal, 210000)`
   de `@/lib/pin` → `upsert_staff` con `p_pin_salt`/`p_pin_hash`; **nunca** envía el PIN); vincular socio por correo → `link_staff_by_email`; cajas
   (`panel_list("dispositivos")`, "Generar código de emparejamiento" → muestra el código de 8 caracteres y "vence en 15 minutos"; desactivar → `set_device_active`);
   productos (precio/activo → `set_product`, nuevo → `create_product`); ajustes (umbral de diferencia, umbral de merma, horario → `set_setting`); verificación de
   bitácora → `verify_audit_chain` ("Bitácora íntegra: N registros" o "ALTERADA en el registro N").
4. `src/panel/PanelRoutes.tsx`: rutas `inventario` y `administracion` dentro de `PanelGuard`, enlaces en la navegación (ocultos para socio en administración).
5. `src/panel/panel-ops.test.tsx` (inyección del backend falso: `vi.mock("@/lib/backend-impl", () => ({ createBackendImpl: () => fake }))`; en `beforeEach`, `resetBackendForTests()` y `queryClient.clear()` (ambos de `@/lib/backend`)): compra de pollo sin libras → mensaje y 0 llamadas; compra válida → `register_purchase` con `p_item_code`, `p_qty`, `p_total_cost`,
   `p_pounds`, `p_supplier`; corte de 3 → 6/6/6/6 propuestos y `register_cut` con el desglose editado; receta vacía rechazada, válida → `upsert_recipe`; cajero con PIN
   "4821" → `upsert_staff` recibe sal de 32 y hash de 64 hex y ningún argumento contiene "4821"; código de emparejamiento mostrado con "vence en 15 minutos".

**Files**

- `src/panel/InventoryPage.tsx`
- `src/panel/AdminPage.tsx`
- `src/panel/forms.ts`
- `src/panel/PanelRoutes.tsx`
- `src/panel/panel-ops.test.tsx`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** el supervisor registra una compra de `POLLO-ENTERO` sin libras **EL SISTEMA DEBERÁ** mostrar `Las libras son obligatorias para pollo entero` y no llamar `register_purchase`.
2. **CUANDO** registra una compra válida **EL SISTEMA DEBERÁ** llamar `register_purchase` con `p_item_code`, `p_qty`, `p_total_cost`, `p_pounds` y `p_supplier`.
3. **CUANDO** abre Corte e ingresa 3 pollos **EL SISTEMA DEBERÁ** proponer 6 alas, 6 piernas, 6 muslos y 6 pechugas editables y enviar `register_cut` con el desglose final.
4. **CUANDO** guarda la receta de un producto **EL SISTEMA DEBERÁ** llamar `upsert_recipe` solo con líneas de cantidad mayor a 0 y rechazar una receta sin líneas.
5. **CUANDO** crea un cajero con PIN `4821` **EL SISTEMA DEBERÁ** enviar a `upsert_staff` una sal de 32 caracteres hex y un hash PBKDF2 de 64 caracteres hex, y ningún argumento con el PIN en claro.
6. **CUANDO** genera un código de emparejamiento **EL SISTEMA DEBERÁ** mostrar el código devuelto por `create_pairing_code` y el aviso `vence en 15 minutos`.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test -- src/panel/panel-ops.test.tsx
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run test:db
npm run build
npm run e2e -- e2e/smoke.spec.ts
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E3-T4 paso 16: panel-inventario-admin"
git tag step-16-panel-inventario-admin
git ls-files --error-unmatch src/panel/forms.ts   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

### `E3-T5` — Panel: asistente de cierre ciego, reporte Z y CSV

**Depende de:** `E3-T4` · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 17

1. `src/panel/DayCloseWizard.tsx` (supervisor): fecha (hoy por defecto) → `day_close_start`; pasos en orden, cada uno habilitado solo si el anterior está completo
   (estado de `panel_list("cierre", fecha)`): **1 Efectivo** — filas por denominación, total contado, sin mostrar esperado ni ventas → `day_close_cash_count`;
   **2 Inventario** — conteo ciego de piezas, bebidas y desechables (lista de `panel_list("stock")` sin la columna teórica) → `day_close_inventory_count`;
   **3 Transferencias** — `panel_list("transferencias_pendientes")` filtrado por fecha con Confirmar/Rechazar; sigue solo cuando quedan 0;
   **4 Ingreso** — tipo (entrega a socio / depósito en banco), monto, quién recibe, foto opcional (`uploadReceiptPhoto("cierres/<fecha>.jpg")`) → `day_close_deposit`;
   **5 Firma** — PIN del supervisor: `my_pin_params()` → `hashPin(pin, salt, iterations)` → `day_close_finalize(p_date, p_pin_hash, p_justification)`;
   `JUSTIFICACION_REQUERIDA` → campo de justificación obligatorio (10+ caracteres) y reintento; éxito → `ZReportView`.
2. `src/panel/ZReportView.tsx`: muestra el `z_report` con las claves de la tabla *Reporte Z* (abajo, idéntica a §5): fecha, recibos primero/último/cantidad, ventas
   por forma de pago y por categoría, ISV incluido (gravado 15 %, ISV 15 %, 18 %, exento), anulaciones, reimpresiones, aperturas sin venta, consumo interno,
   efectivo esperado/contado/diferencia por turno, transferencias, merma, ingreso, firmado por/en y `z_hash`; sin controles de edición; botón "Exportar Z (CSV)".
3. `src/lib/csv.ts`: `toCsv(rows, columns: { key, header }[])` → texto con BOM `\uFEFF`, separador `,`, fin de línea `\r\n`, comillas dobles cuando hay `,` `"` o
   salto de línea y `"` duplicada (RFC 4180); `downloadCsv(nombre, texto)`. Exportes: ventas (`panel_list("ventas")`), movimientos (`"movimientos"`) y cierres (`"cierres"`).
4. `src/panel/PanelRoutes.tsx`: ruta `cierre` (supervisor) y `reportes` (socio y supervisor: lista de Z con `ZReportView` y botones de CSV).
5. `src/panel/dayclose.test.tsx` con backend falso (inyección del backend falso: `vi.mock("@/lib/backend-impl", () => ({ createBackendImpl: () => fake }))`; en `beforeEach`, `resetBackendForTests()` y `queryClient.clear()` (ambos de `@/lib/backend`)): los 5 pasos visibles en orden y "Siguiente" deshabilitado hasta completar cada uno; en el paso 1 no aparece
   "esperado" ni "L 829.00"; `JUSTIFICACION_REQUERIDA` → campo de justificación y segunda llamada con `p_justification`; Z renderizado sin botón "Editar";
   `toCsv([{ nombre: 'Pollo "chilero", 8 pzs' }], [{ key: "nombre", header: "Producto" }])` empieza con `\uFEFF` y contiene `"Pollo ""chilero"", 8 pzs"`.

#### Reporte Z

| Clave de `z_report` | Contenido |
|---|---|
| `fecha` | día de negocio (`business_date`) |
| `recibos` | `{ primero, ultimo, cantidad }` — incluye anuladas |
| `ventas_total` | suma de `total` de ventas no anuladas |
| `ventas_por_forma_pago` | `{ efectivo, transferencia_confirmada, transferencia_rechazada }` |
| `ventas_por_categoria` | `[{ categoria, unidades, monto }]` en el orden de las pestañas |
| `isv_incluido` | `{ gravado_15, isv_15, gravado_18, isv_18, exento }` |
| `anulaciones` | `{ cantidad, monto }` |
| `reimpresiones` / `aperturas_sin_venta` | conteos del día |
| `consumo_interno` | `[{ item, unidades, valor }]` a costo promedio |
| `efectivo` | `{ esperado, contado, diferencia, justificacion, por_turno: [{ turno_id, cajero, esperado, contado, diferencia }] }` |
| `transferencias` | `{ confirmadas: { cantidad, monto }, rechazadas: { cantidad, monto } }` |
| `merma` | `[{ item, unidades, valor }]` del conteo de inventario del cierre |
| `ingreso` | `{ tipo: "entrega_socio" \| "deposito_banco", monto, recibe }` |
| `firmado_por` / `firmado_en` | supervisor y hora de la firma con PIN |

`z_hash` = `sha256(z_report::text)` en hex. Un `day_closes` con `status = 'cerrado'` no admite `UPDATE` ni `DELETE` (`DIA_CERRADO`).

**Files**

- `src/panel/DayCloseWizard.tsx`
- `src/panel/ZReportView.tsx`
- `src/lib/csv.ts`
- `src/panel/PanelRoutes.tsx`
- `src/panel/dayclose.test.tsx`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** el supervisor abre el cierre del día **EL SISTEMA DEBERÁ** mostrar los 5 pasos en orden (efectivo, inventario, transferencias, ingreso, firma) y no permitir avanzar a un paso sin completar el anterior.
2. **CUANDO** está en el paso de efectivo **EL SISTEMA DEBERÁ** pedir el conteo por denominación sin mostrar el efectivo esperado ni las ventas del día.
3. **CUANDO** `day_close_finalize` responde `JUSTIFICACION_REQUERIDA` **EL SISTEMA DEBERÁ** mostrar un campo de justificación obligatorio y reenviar con `p_justification`.
4. **CUANDO** el cierre se completa **EL SISTEMA DEBERÁ** mostrar el reporte Z con fecha, rango de recibos, ventas por forma de pago, ISV, anulaciones, efectivo esperado, contado y diferencia, y merma, sin ningún control de edición.
5. **CUANDO** se exportan datos a CSV **EL SISTEMA DEBERÁ** generar texto UTF-8 que empieza con BOM, con encabezados en español y comillas dobles escapadas según RFC 4180.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test -- src/panel/dayclose.test.tsx
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run test:db
npm run build
npm run e2e -- e2e/smoke.spec.ts
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E3-T5 paso 17: panel-cierre-z"
git tag step-17-panel-cierre-z
git ls-files --error-unmatch src/panel/DayCloseWizard.tsx   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

### `E3-T6` — Endurecimiento: plantilla de factura, cabeceras y e2e

**Depende de:** `E3-T2`, `E3-T5` · **Prioridad:** p0 — metadato para recortes de alcance, no un orden de ejecución · **Paso del blueprint:** 18

1. `src/lib/mock-backend.ts`: `export const createBackendImpl: CreateBackendImpl` (simulado) que implementa `Backend` en el navegador, con estado compartido en `localStorage["pc-mock-state"]`
   (la caja y el panel del mismo origen lo ven). Datos semilla: 6 categorías, `PZ-001` L 120.00, `CF-001` L 209.00, `BE-008` L 13.00; staff "Ana" (cajera, PIN 1111) y
   "Carlos" (supervisor, PIN 2222) con hash calculado al iniciar con `hashPin`; código de emparejamiento válido `MOCK2345`; usuario de panel `supervisor@prueba.hn` /
   `prueba1234` con TOTP `000000`. Implementa `pos_claim_device`, `pos_pull_snapshot`, `pos_push_events` (aplica y responde por `client_seq`; venta → resumen;
   `anulacion_solicitada` sin aprobador → anulación pendiente), `panel_whoami`, `panel_summary`, `panel_list`, `decide_void`, `confirm_transfer`, `my_pin_params`,
   `day_close_*` (sin lógica de dinero: el Z simulado devuelve los montos acumulados). Cualquier `rpc` con `navigator.onLine === false` lanza `BackendError("RED")`.
   Entra al build solo con `--mode e2e-mock`: `vite.config.ts` apunta el alias `@/lib/backend-impl` a este archivo únicamente en ese modo (y solo si
   existe); en producción ningún módulo lo referencia, y el Verify lo comprueba con `grep -rq "mock-backend" dist` esperando 1 (sin coincidencias).
2. `src/lib/fiscal-invoice.ts`: `buildInvoiceLines(invoice)` con la plantilla *Factura SAR* (abajo, idéntica a §6) y `amountInWords(n)` ("MIL CIENTO CINCUENTA LEMPIRAS
   CON 00/100"); no se usa en ninguna pantalla mientras `fiscal_config.activo = false`.
3. `public/_headers` con el contenido literal del bloque *Cabeceras de seguridad* (abajo, idéntico a §14).
4. `e2e/flujos.spec.ts` (proyecto `flujos`, puerto 4174): **un solo `test.describe.serial("flujos críticos", …)` con contexto compartido declarado
   explícitamente**: `let context: BrowserContext; let page: Page;` creados en `test.beforeAll(async ({ browser }) => { context = await browser.newContext(); page = await context.newPage(); })`
   y cerrados en `test.afterAll`; los 3 tests corren en este orden y cada uno parte del estado que dejó el anterior (si uno falla, los siguientes no corren).
   (a) **venta sin conexión → sincronización**: emparejar con `MOCK2345`, Ana + 1111, abrir turno con Carlos 2222,
   `context.setOffline(true)`, vender 1× `PZ-001` en efectivo, ver "Sin conexión" y "1 pendientes", `context.setOffline(false)` y "Reintentar ahora" → "Sincronizado" y
   "0 pendientes"; (b) **anulación → aprobación**: solicitar anulación de esa venta sin PIN, sincronizar, abrir `/panel` en otra página del mismo `context`, login + TOTP, ver la anulación
   pendiente, "Aprobar", ver "anulada"; (c) **cierre ciego → Z**: cerrar turno en caja, en el panel recorrer los 5 pasos (sin ver "esperado" en el paso 1) y ver el
   reporte Z.
5. `src/lib/hardening.test.ts`: `buildInvoiceLines` de una factura de L 1,150.00 gravada 15 % contiene RTN, CAI, rango autorizado, fecha límite, número con formato
   `^\d{3}-\d{3}-\d{2}-\d{8}$`, "ORIGINAL: CLIENTE", "COPIA: EMISOR", "GRAVADO 15%" L 1,000.00, "ISV 15%" L 150.00, "CONSUMIDOR FINAL" y
   "MIL CIENTO CINCUENTA LEMPIRAS CON 00/100"; con total > L 10,000.00 sin identidad del cliente lanza `IDENTIDAD_REQUERIDA`; `public/_headers` (leído con `node:fs`)
   contiene `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `Referrer-Policy`, `X-Content-Type-Options: nosniff` y
   `Permissions-Policy`.

#### Factura SAR

Plantilla de **FACTURA** (SAR, Acuerdo 481-2017 art. 10) — preparada y **apagada**; `buildInvoiceLines` existe y se prueba, ninguna pantalla la usa
mientras `fiscal_config.activo = false`. Campos obligatorios: RTN y razón social del emisor, nombre comercial, dirección, teléfono, correo, CAI,
rango autorizado (inicial–final), fecha límite de emisión, número de 16 dígitos `NNN-NNN-NN-NNNNNNNN`, fecha y hora, cliente (`CONSUMIDOR FINAL`
por defecto; RTN opcional; número de identidad obligatorio si el total supera L 10,000.00), desglose gravado 15 % / ISV 15 % / gravado 18 % /
ISV 18 % / exento, total en números y en letras, y la leyenda `ORIGINAL: CLIENTE` / `COPIA: EMISOR`.

```text
            POLLO CHILERO (nombre comercial)
                 <razón social>
               RTN: <14 dígitos>
                  <dirección>
          Tel.: <teléfono>  <correo>
                    FACTURA
No.: 001-001-01-00000001
CAI: <CAI>
Rango autorizado: 001-001-01-00000001 al 001-001-01-00005000
Fecha límite de emisión: <AAAA-MM-DD>
Fecha: <AAAA-MM-DD HH:MM>
Cliente: CONSUMIDOR FINAL
------------------------------------------------
<líneas como en el recibo>
------------------------------------------------
GRAVADO 15%                          L 1,000.00
ISV 15%                                L 150.00
GRAVADO 18%                              L 0.00
ISV 18%                                  L 0.00
EXENTO                                   L 0.00
TOTAL                                L 1,150.00
MIL CIENTO CINCUENTA LEMPIRAS CON 00/100
ORIGINAL: CLIENTE                 COPIA: EMISOR
```

#### Cabeceras de seguridad

```text
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co; font-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=(), serial=(self)
```

`public/_headers` es el formato de Netlify y Cloudflare Pages (Vite lo copia tal cual a `dist/_headers`). En Vercel las mismas cabeceras van en
`vercel.json` → `headers`; en el hosting de Lovable su soporte de cabeceras personalizadas está **[PENDIENTE]** de verificar (§12).

**Files**

- `src/lib/mock-backend.ts`
- `src/lib/fiscal-invoice.ts`
- `public/_headers`
- `e2e/flujos.spec.ts`
- `src/lib/hardening.test.ts`

**Acceptance**

Copiados del arreglo `acceptance` de esta tarea en `tasks.json` — idénticos salvo el énfasis markdown. Cada uno lo decide un comando de abajo, en esta máquina, durante el build.

1. **CUANDO** `npm run e2e -- e2e/flujos.spec.ts` ejecuta el flujo venta sin conexión → sincronización **EL SISTEMA DEBERÁ** mostrar `Sin conexión` con `1 pendientes` mientras el contexto está offline y `Sincronizado` con `0 pendientes` al volver la red.
2. **CUANDO** ejecuta el flujo anulación → aprobación **EL SISTEMA DEBERÁ** mostrar la anulación pendiente en el panel del supervisor y, al aprobarla, el estado `anulada`.
3. **CUANDO** ejecuta el flujo cierre ciego → Z **EL SISTEMA DEBERÁ** completar los 5 pasos y mostrar el reporte Z, sin mostrar el efectivo esperado antes de enviar el conteo.
4. **CUANDO** `buildInvoiceLines` recibe una factura de L 1,150.00 gravada al 15% **EL SISTEMA DEBERÁ** incluir RTN del emisor, CAI, rango autorizado, fecha límite, número con formato `NNN-NNN-NN-NNNNNNNN`, `ORIGINAL: CLIENTE`, `COPIA: EMISOR`, gravado 15% `L 1,000.00`, ISV 15% `L 150.00`, `CONSUMIDOR FINAL` y `MIL CIENTO CINCUENTA LEMPIRAS CON 00/100`.
5. **CUANDO** `npm run build` termina **EL SISTEMA DEBERÁ** copiar `public/_headers` a `dist/_headers` con `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `Referrer-Policy` y `X-Content-Type-Options: nosniff`.

**Verify** — todos los comandos, en orden, desde la raíz del proyecto. Cada uno sale con 0 cuando la tarea es correcta; la tarea está terminada cuando el último sale con 0.

```bash
npm run test -- src/lib/hardening.test.ts
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run test:db
npm run build
status=0; grep -rq 'mock-backend' dist || status=$?; test "$status" -eq 1
test -f dist/_headers
grep -q 'Content-Security-Policy' dist/_headers
grep -q 'X-Frame-Options: DENY' dist/_headers
npm run e2e
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E3-T6 paso 18: endurecimiento-e2e"
git tag step-18-endurecimiento-e2e
git ls-files --error-unmatch public/_headers   # expect: exit 0 — versionado por el commit de arriba
```

Ejecute ambos después de que el último comando de Verify salga con 0 y antes de empezar la tarea siguiente. El tag es el punto de retorno: si la tarea siguiente sale mal, `git reset --hard` a este tag. Nunca invente el tag: copie el campo `checkpoint` de `tasks.json`.

---

## Aceptación del epic

1. **CUANDO** `npm run e2e` ejecuta `e2e/smoke.spec.ts` y `e2e/flujos.spec.ts` **EL SISTEMA DEBERÁ** pasar la prueba de humo y los 3 flujos críticos (venta sin
   conexión → sincronización, anulación → aprobación, cierre ciego → Z) con 0 fallidas.
2. **CUANDO** el transporte responde `RED` **EL SISTEMA DEBERÁ** seguir vendiendo en la caja y mostrar "Sin conexión" con el contador de pendientes — lo deciden
   el caso `RED` de `src/pos/sync.test.tsx` y el flujo (a) de `e2e/flujos.spec.ts`.

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test && npm run test:db
npm run build
npm run e2e
```

## Trampas

- **El backend simulado en producción** — solo lo resuelve el alias de `vite.config.ts` en el modo `e2e-mock`; nunca se importa por nombre desde `src/`, y
  `npm run build` (modo producción) no lo contiene (lo comprueba el `grep -rq 'mock-backend' dist` del Verify).
- **`Intl` en montos o fechas** — depende de los datos ICU del runtime; use `formatLempiras` y `toLocalHN`.
- **Polling que no se detiene** — use `refetchInterval` de TanStack Query, no `setInterval` propio, para que se limpie al desmontar.
- **CSP demasiado estricta** — el QR del TOTP llega como `data:` y las fotos como `https://*.supabase.co`; ambos están permitidos en `img-src`.

## Antes de seguir

- [ ] Toda tarea de este epic está `done` en `tasks.json` — ninguna en `in_progress`.
- [ ] Pasaron todos los comandos `verify` de cada tarea, no solo el primero.
- [ ] Ningún comando `verify` se editó ni se saltó porque faltaba un archivo.
- [ ] Cada tarea tiene su tag `checkpoint` en git (`git tag -l 'step-*'` los lista).
- [ ] El gate pasa limpio desde la raíz del proyecto, con `blueprints/` presente.
- [ ] Cada contrato "Producidos" existe con la firma indicada.
- [ ] No se modificó ningún archivo fuera del subárbol.
- [ ] `.env.example` no cambió (este epic no agrega variables) o se actualizó junto con `src/lib/env.ts`.
- [ ] Un commit por tarea, con el id de la tarea en el mensaje, seguido de su tag.

