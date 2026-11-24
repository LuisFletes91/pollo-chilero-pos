# Pollo Chilero — POS + Inventario (Etapa 1) — Blueprint

> Generado por The Architect el 2026-11-22
> Shape: internal-tool · `knowledge/shapes/internal-tool.md`
> Runtime track: ts-node · `knowledge/runtime-tracks/ts-node.md` (solo respaldo de versiones; mandan los pins de §11)
> Modo de emisión: bundle (`blueprints/pollo-chilero-pos/`: `blueprint.md`, `tasks.json`, `epics/`, `workspace/`)
> Versión del blueprint: 1
> Versiones verificadas: 2026-11-22 — procedencia por paquete en §11
> Idioma: español (Honduras). Código, comandos, rutas e identificadores en inglés/snake_case.

**Etiquetas de verificación usadas en todo el documento:** **[VERIFICADO]** = comprobado contra la fuente citada en esta sesión ·
**[SUPUESTO]** = decisión técnica o de negocio razonable que el usuario puede cambiar sin rehacer el diseño ·
**[PENDIENTE]** = requiere un dato del usuario, del contador o del SAR **antes de producción**; no bloquea el build.

---

## 1. Project Overview & Non-Goals

### Vision

Pollo Chilero (franquicia "POLLO CHILERO — Orgullo Catracho") es un local de pollo frito en la Aldea El Ocotal, Olanchito, Yoro, con una sola
caja (una PC con Chrome), un cajero por turno y tres socios, uno de ellos el socio supervisor/encargado. Hoy factura en un Excel sin controles: en
57 recibos se encontraron números faltantes, una venta en L 0, un recibo sin detalle, códigos de producto reutilizados y precios distintos al
catálogo. Este sistema reemplaza ese Excel por un **POS web offline-first** que sigue vendiendo sin internet (cortes de luz y red rurales), descuenta
**inventario por receta** (el pollo se compra entero por peso y se corta en 8 piezas), obliga a un **cierre de caja ciego** y deja a los socios ver
el negocio desde el celular en un **panel con MFA**.

La base de datos es la autoridad: las tablas no aceptan escrituras directas; cada acción pasa por funciones del servidor que validan quién la hace,
y una **bitácora encadenada por hash** registra cada cambio con su usuario. La facturación SAR queda **preparada pero apagada** (activación esperada
en 2027, [PENDIENTE] autorización de autoimpresor). El objetivo de la Etapa 1 es que ningún peso ni ninguna pieza de pollo pueda desaparecer sin
dejar rastro, sin hacer más lenta la venta en el mostrador.

### Users

| Persona | Qué viene a hacer | Frecuencia |
|---|---|---|
| Cajero (uno por turno, usuario + PIN propio) | Vender con 2 toques + PIN, cobrar efectivo/transferencia, abrir y cerrar su turno con conteo ciego | Diario, todo el turno |
| Socio supervisor/encargado | Aprobar anulaciones/fondo/consumo interno, registrar compras de pollo y cortes, conteos, cierre del día, confirmar transferencias, administrar precios y personal | Diario |
| Socios (lectura) | Ver ventas, diferencias de caja, merma, alertas y reportes Z desde el celular | Diario/semanal |
| Contador | Recibir exportes CSV (ventas, movimientos, Z) | Mensual |

Escala: 1 local, 1 caja, 1 cajero a la vez, 3 socios; ~50–150 ventas/día [SUPUESTO; el Excel registra 48 facturas el 18/11/2026].

### Goals — v1 scope

1. La caja vende, cobra (efectivo, transferencia o mixto), numera recibos `R-00000001` sin huecos e imprime en 80 mm **sin internet**, y sincroniza
   sola al volver la red sin duplicar nada.
2. Cada venta descuenta el inventario por receta; compras de pollo por peso, cortes de 8 piezas, consumo interno y conteos dejan un libro de
   movimientos inmutable con costo promedio y merma valorizada.
3. El día se cierra con conteo ciego de efectivo e inventario, revisión de transferencias, ingreso del dinero y un reporte Z firmado e inmutable.
4. Los socios ven en el celular (MFA obligatorio) ventas, diferencias, merma y alertas generadas por la base de datos; solo el supervisor decide.
5. La base de datos rechaza toda escritura directa, exige segregación (nadie aprueba lo propio) y deja bitácora encadenada de todo movimiento.
6. Las tablas, la función de numeración fiscal de 16 dígitos y la plantilla de FACTURA quedan listas y probadas, con el SAR apagado.

### Non-Goals — explicitly out of scope for v1

| No se construye | Por qué no ahora | Se revisa cuando |
|---|---|---|
| Contabilidad (asientos, libros, estados financieros) | Etapa 2; v1 entrega los datos limpios (CSV) que la contabilidad necesitará | El contador valide 1 mes de exportes de v1 |
| Facturación SAR **activa** y notas de crédito | Requiere autorización de autoimpresor y CAI [PENDIENTE]; v1 deja la estructura probada | Se obtenga la resolución del SAR (esperada 2027) |
| Descuentos y promociones | El precio siempre es el del catálogo: es el control contra el hallazgo "precios distintos" del Excel | Los socios definan una política escrita de descuentos |
| Domicilio | Solo "Comer aquí / Para llevar" en v1 | Haya repartidor y zona definidos |
| Pago con tarjeta / datáfono | Solo efectivo y transferencia hoy | Se contrate un adquirente con API |
| Múltiples cajas o locales | 1 caja = 1 punto de emisión sin conflictos; el modelo ya trae `location_id`/`device_id` | Se abra una segunda caja o local |
| Alertas por email/WhatsApp/push | Las alertas viven en el panel (PWA en el celular) | Un socio pierda una alerta crítica por no abrir el panel |
| Realtime | Polling de 60 s basta para un tablero de socios | Un flujo concreto falle por la demora |
| Nómina, app nativa | Fuera del problema de caja e inventario | Etapa 2+ |

**El builder no implementa nada de esta tabla**, aunque parezca una adición pequeña. Si un paso parece exigir un non-goal, es un defecto del
blueprint: deténgase y repórtelo.

### Success metrics

| Métrica | Meta | Cómo se mide |
|---|---|---|
| Huecos en la numeración de recibos | 0 alertas `hueco_numeracion` no explicadas por mes, desde el primer mes en producción | `panel_list('alertas')` filtrado por `kind` |
| Ventas perdidas por falta de red | 0 (todo evento llega a `pos_events`) | `devices.last_client_seq` = último `clientSeq` local tras cada cierre |
| Diferencia de caja diaria | ≤ L 50 en el 95 % de los cierres del primer trimestre | `day_closes.cash_difference` |
| Merma de piezas | Medida cada día (hoy no se mide); meta ≤ 2 piezas/día tras 60 días | `inventory_count_lines` de piezas en `panel_summary.merma_piezas` |
| Tiempo de venta típica (2 productos, efectivo) | ≤ 20 s desde el primer toque hasta el recibo | Cronometraje manual en la puesta en marcha (§20.1) |

### Registro de verificación

| Afirmación | Etiqueta | Fuente |
|---|---|---|
| Catálogo inicial de 59 productos con precio final (ISV incluido) | [VERIFICADO] | `productos.tsv` exportado del Excel de la franquicia (leído en esta sesión) |
| Recetas de 4, 6 y 8 piezas (1-1-1-1, 2-2-1-1, 2-2-2-2) y 8 piezas por pollo | [VERIFICADO] | El usuario en esta sesión |
| Recetas de 12 y 24 piezas (3 y 6 de cada tipo) | [SUPUESTO] aprobado por el usuario | "así va incrementando" |
| "1 refresco" = 12 oz; "refresco 2 lts" = Pepsi 2 L; "jugo" infantil = Jugo Quanty personal; "Pepsi" infantil = 12 oz | [SUPUESTO] | Editable en el editor de recetas |
| "Papas" en combos = porción personal | [SUPUESTO] | Editable en el editor de recetas |
| Nombres de insumos no-pollo (papas, ensalada, pan, carne, taco, enchilada, medallones, papitas) | [SUPUESTO] | Editables; desechables se crean desde el panel |
| Precios del catálogo coinciden con el menú físico | [PENDIENTE] | El supervisor revisa contra el menú antes de producción (la alineación de algunos precios de bebidas en la foto es ambigua) |
| Impresora Nenotech ITP250, 80 mm, USB + LAN + RS232, 250 mm/s | [VERIFICADO] | Foto de la etiqueta |
| ITP250 compatible ESC/POS, 576 puntos (48 columnas fuente A), driver USB-serie que expone un puerto COM | [SUPUESTO] | Se valida con la página de prueba del paso 2 (§20.1) |
| Web Serial en Chrome de escritorio desde la v89, requiere HTTPS/localhost y gesto del usuario; `getPorts()` recuerda el permiso | [VERIFICADO] | Documentación de Chrome (propuesta previa) |
| API de `@point-of-sale/receipt-printer-encoder` 4.0.1 (`initialize`, `line`, `pulse`, `cut`, `encode`) | [VERIFICADO] | `dist/receipt-printer-encoder.d.ts` publicado (unpkg, 2026-11-22) |
| Bytes ESC/POS `1b 40` (init), `1b 70` (pulso), `1d 56` (corte) emitidos por esa librería | [SUPUESTO] | Comando de verificación en §19.6 *Byte-exact* |
| PGlite soporta `SET ROLE` y aplica RLS nativo | [VERIFICADO] fuente secundaria | docs.lite.dev/database/rls y un laboratorio RLS con PGlite (búsqueda 2026-11-22) |
| API PGlite 0.5.17 `new PGlite()`, `exec`, `query`, `transaction` | [VERIFICADO] | `dist/index.d.ts` publicado |
| ISV 15 % general, 18 % alcohol/tabaco, 0 % exento | [VERIFICADO] | Ley del ISV art. 6 (según la propuesta previa `Propuesta_ERP_Pollos_Chilero.docx`) |
| Campos obligatorios de la factura (art. 10 Acuerdo 481-2017) y numeración de 16 dígitos | [VERIFICADO] en norma por la propuesta previa | `Propuesta_ERP_Pollos_Chilero.docx` |
| Activación SAR (autoimpresor, CAI, declaración jurada del software) | [PENDIENTE] | Trámite SAR + contador |
| Leyenda "Este documento no es una factura" en el recibo interno | [SUPUESTO] legal | [PENDIENTE] confirmación del contador |
| Denominaciones HNL: billetes 500, 200, 100, 50, 20, 10, 5, 2, 1; monedas 0.50, 0.20, 0.10 | [SUPUESTO] | Revisar vigencia; editable en `settings.denominations` |
| Honduras UTC-6 sin horario de verano | [SUPUESTO] verificable | Base del cálculo de fecha de negocio |
| Horario 09:00–21:00, umbral de diferencia L 50, umbral de merma 2 piezas/día | [SUPUESTO] | Configurables en el panel |
| Colores de marca (#C8102E, #FFD200, #F28C00) | [SUPUESTO] | Aproximados desde fotos del menú; confirmar con arte oficial |
| Logo (gallo de la franquicia) | [PENDIENTE] | El usuario provee el archivo; v1 usa el texto "POLLO CHILERO" |
| Defaults de la plantilla de Lovable (versiones) | [SUPUESTO] no verificado | Mirrors de terceros muestran Vite 5 / Tailwind 3 |
| Lovable importa un repositorio GitHub existente | [PENDIENTE] | Ver §12 *Ruta con Lovable* |
| Supabase permite inicio de sesión anónimo con registro público desactivado | [PENDIENTE] | Ver §8; hay ruta alternativa |
| Plan de Supabase (gratuito pausa por inactividad, sin PITR) | [PENDIENTE] decisión | §16 / §20.2 |
| Región Supabase us-east | [SUPUESTO] | La más cercana disponible |

### Hallazgos del Excel → control del diseño

| Hallazgo en `sistema de EVER gerardo (1).xlsm` (recibos F-000003…F-000060) | Control en este sistema | Dónde |
|---|---|---|
| Números de factura faltantes | Correlativo `R-NNNNNNNN` asignado en la caja dentro de la misma transacción que la venta (sin huecos posibles); el servidor detecta saltos y crea la alerta `hueco_numeracion` | `cart.ts registerSale` (paso 12), `app.ev_venta` (paso 5) |
| Venta registrada en L 0 | `total > 0` y `total = Σ qty × unit_price` obligatorios → `TOTAL_INVALIDO` | `sales.total check`, `app.ev_venta` |
| Recibo sin detalle | Una venta sin líneas se rechaza → `VENTA_VACIA` | `app.ev_venta` |
| Códigos de producto reutilizados | Códigos permanentes `CAT-NNN` que nunca se reasignan ni se borran (`CODIGO_INMUTABLE`); `legacy_code` conserva el código del Excel | `app.code_guard` (paso 3) |
| Precios distintos al catálogo | El cajero no puede editar el precio (no existe el campo); si llega un precio distinto (catálogo desactualizado o manipulación) se aplica lo cobrado y se alerta `precio_distinto` | `SaleScreen`, `app.ev_venta` |
| Sin rastro de quién hizo qué | Cada evento lleva `staff_id`; `audit_log` con hash encadenado en toda tabla; `inventory_movements` con usuario, caja y fecha del servidor | pasos 3–6 |

---

## 2. Tech Stack

**Runtime track: ts-node.** Esta tabla nombra *decisiones*, no versiones. Todo pin vive en §11.

| Capa | Decisión | Por qué esta y no otra |
|---|---|---|
| Lenguaje / runtime | TypeScript 6 sobre Node 24 LTS (herramientas) y Chrome (ejecución) | Mismo stack que genera Lovable (requisito del usuario). TypeScript 7 rechazado: typescript-eslint del stack exige `<6.1.0` |
| Framework | React 19 + Vite 8 (SPA) + react-router-dom 7 | Lo que Lovable genera; una SPA estática es lo único que puede funcionar offline en la caja. Next.js rechazado: el renderizado en servidor no sirve sin red y Lovable no lo usa |
| Styling | Tailwind CSS v4 (configuración en CSS, `@theme`) | Tokens de marca en un solo archivo; Lovable usa Tailwind |
| Component layer | Componentes propios en estilo shadcn (cva + tailwind-merge); `components.json` listo para que Lovable/shadcn agreguen componentes después | Evita depender de un CLI con red y de paquetes Radix no verificados en un gate; las pantallas de caja son botones grandes, no primitivas complejas |
| Base de datos | Supabase Postgres | Lo pide el usuario; RLS + funciones `SECURITY DEFINER` dejan la regla de negocio en la base, donde Lovable no la puede romper |
| Acceso a datos | Funciones RPC SQL (`supabase.rpc`) + IndexedDB con Dexie en la caja | Toda escritura validada en el servidor; un ORM no aporta nada cuando el cliente no escribe tablas. Dexie: la API de IndexedDB más probada para offline |
| Auth | Supabase Auth: caja = sesión de dispositivo emparejada una vez; socios = email + contraseña + TOTP obligatorio; cajeros = PIN local PBKDF2 | Un solo proveedor de identidad; el PIN de 4 dígitos es lo más rápido en el mostrador |
| Trabajo en segundo plano | Ninguno en servidor: alertas por triggers y al consultar el panel; sincronización en la caja (`src/pos/sync.ts`) | Sin colas que operar; el volumen es ~150 ventas/día |
| Pagos | NOT APPLICABLE — solo efectivo y transferencia confirmada a mano por el supervisor; no hay pasarela | — |
| Archivos | Supabase Storage, bucket privado `comprobantes` (fotos de compras y depósitos) | Mismo proveedor, políticas RLS del supervisor |
| Notificaciones | Tabla `alerts` vista en el panel (PWA) | Email/WhatsApp es non-goal v1 |
| Hosting | Frontend estático HTTPS: el hosting de Lovable si se usa Lovable; alternativa documentada Cloudflare Pages/Netlify. Supabase en la nube del usuario | Una SPA estática no necesita servidor propio; HTTPS es requisito de Web Serial y PWA |
| Impresión | Web Serial + `@point-of-sale/receipt-printer-encoder` (ESC/POS) con respaldo `window.print()` 80 mm | Única vía del navegador que puede abrir la gaveta; WebUSB rechazado (posible bloqueo de la clase impresora, no verificado) |
| Pruebas | Vitest + Testing Library + fake-indexeddb; PGlite para SQL; Playwright e2e | Ningún gate necesita Docker ni credenciales |
| Lint/format | ESLint 10 + typescript-eslint + Prettier 3 | Lo que trae Lovable; Biome rechazado para no chocar con la configuración del proyecto Lovable |
| Gestor de paquetes | npm (el que trae Node 24) | Lovable usa npm; un gestor menos que instalar en Windows |

### Compatibility check

Revisado contra `knowledge/stack-compatibility.md`: ninguna fila de la tabla de combinaciones conocidas como malas aplica, con dos observaciones:
(1) *Dos sistemas de migración sobre una base* — el editor de tablas de Supabase y el SQL generado por Lovable podrían convertirse en un segundo
camino; se resuelve declarando `supabase/migrations/` como único dueño del esquema (§12 *Ruta con Lovable*, `CLAUDE.md` regla 5). (2) *Linter con
parser CSS propio + Tailwind v4* — no aplica: ESLint no analiza CSS y Prettier acepta `@theme`. Un solo proveedor de identidad (Supabase Auth).
Gotchas del track que siguen vigentes: TypeScript fijado en la línea 6.0 (no 7), Tailwind v4 configurado en CSS sin `tailwind.config.js`.

---

## 3. Directory Structure

```
pollo-chilero-pos/                       # raíz del repo (GitHub; opcionalmente conectado a Lovable)
├── blueprints/pollo-chilero-pos/        # ESTE bundle: blueprint.md, tasks.json, epics/, workspace/ (se versiona; excluido de lint/format/tests)
├── .claude/                             # workspace: settings.json, skills/, rules/ (§19)
├── .github/workflows/ci.yml             # workspace: CI = mismo gate que §20.1
├── CLAUDE.md · AGENTS.md                # workspace (§19.1, §19.2)
├── package.json · package-lock.json     # workspace / generado por npm install en el Bootstrap
├── .nvmrc                               # workspace: 24
├── tsconfig.json                        # workspace: un solo tsconfig (alias @/ → src/)
├── vite.config.ts                       # workspace: React SWC + Tailwind + PWA (genera dist/sw.js)
├── vitest.config.ts                     # workspace: pruebas unitarias jsdom
├── vitest.db.config.ts                  # workspace: pruebas SQL en PGlite
├── playwright.config.ts                 # workspace: proyectos smoke (4173) y flujos (4174)
├── eslint.config.js · .prettierrc.json · .prettierignore   # workspace
├── .gitignore · .gitattributes          # workspace (LF obligatorio)
├── .env.example · .env.test · .env.e2e · .env.e2e-mock     # workspace (valores falsos, versionados)
├── components.json                      # workspace: configuración shadcn para Lovable
├── index.html                           # workspace
├── public/
│   ├── icon.svg                         # workspace: ícono PWA provisional ("PC")
│   └── _headers                         # paso 18: cabeceras de seguridad (Netlify/Cloudflare Pages)
├── e2e/
│   ├── smoke.spec.ts                    # paso 1
│   └── flujos.spec.ts                   # paso 18: 3 flujos críticos con backend simulado
├── src/
│   ├── main.tsx · index.css             # workspace: arranque + tokens @theme + CSS de impresión 80 mm
│   ├── App.tsx · App.test.tsx           # paso 1
│   ├── test/setup.ts                    # workspace: fake-indexeddb + WebCrypto
│   ├── lib/                             # compartido por caja y panel; no importa src/pos ni src/panel
│   │   ├── env.ts · backend.tsx · backend-impl.ts · utils.ts · backend.test.tsx   # paso 8
│   │   ├── pin.ts                       # paso 10 (PBKDF2)
│   │   ├── csv.ts                       # paso 17
│   │   └── mock-backend.ts · fiscal-invoice.ts · hardening.test.ts   # paso 18
│   ├── pos/                             # caja offline-first (/pos)
│   │   ├── PosRoutes.tsx                # paso 1 (editado en 2, 9–13)
│   │   ├── print/escpos.ts · serial.ts · HardwareTestPage.tsx · hardware.test.tsx   # paso 2
│   │   ├── print/receipt.ts · print-service.ts · ReceiptPrintView.tsx · receipt.test.ts   # paso 14
│   │   ├── db.ts · device.ts · PairingScreen.tsx · device.test.ts   # paso 9
│   │   ├── outbox.ts · CashierLogin.tsx · pin-outbox.test.tsx       # paso 10
│   │   ├── shift.ts · ShiftScreens.tsx · SupervisorActions.tsx · shift.test.tsx   # paso 11
│   │   ├── cart.ts · NumPad.tsx · SaleScreen.tsx · sale.test.tsx    # paso 12 (SaleScreen editado en 14)
│   │   └── sync.ts · SyncIndicator.tsx · emergency-export.ts · sync.test.tsx   # paso 13
│   └── panel/                           # panel de socios (/panel)
│       ├── PanelRoutes.tsx              # paso 1 (editado en 15–17)
│       ├── AuthScreens.tsx · PanelGuard.tsx · DashboardPage.tsx · panel-access.test.tsx   # paso 15
│       ├── InventoryPage.tsx · AdminPage.tsx · forms.ts · panel-ops.test.tsx   # paso 16
│       └── DayCloseWizard.tsx · ZReportView.tsx · dayclose.test.tsx           # paso 17
└── supabase/
    ├── migrations/                      # FUENTE DE VERDAD del esquema (nombres fijos, escritos a mano)
    │   ├── 20261122000100_esquema_base.sql · 20261122000110_catalogo_inicial.sql   # paso 3
    │   ├── 20261122000200_seguridad.sql                                            # paso 4
    │   ├── 20261122000300_ventas.sql                                               # paso 5
    │   ├── 20261122000400_inventario.sql                                           # paso 6
    │   └── 20261122000500_cierre_dia.sql · 20261122000600_fiscal.sql               # paso 7
    └── tests/
        ├── shim.sql · harness.ts        # workspace: imitación mínima de Supabase + arnés PGlite
        ├── fixtures.ts                  # paso 4 (editado en 5)
        └── esquema · catalogo · bitacora · seguridad · ventas · inventario · cierre · fiscal .test.ts   # pasos 3–7
```

Las migraciones se escriben a mano con nombres fijos (no las genera una herramienta): el nombre es el que figura arriba. `supabase/config.toml` no
existe en el repo hasta que el usuario ejecute `supabase init` en el despliegue (§12); ningún gate lo necesita.

**Boundary rules**
- `src/lib/**` no importa de `src/pos/**` ni de `src/panel/**`; `src/pos/**` y `src/panel/**` no se importan entre sí.
- Solo `src/lib/backend.tsx` crea clientes de Supabase; solo `src/pos/sync.ts` llama `pos_push_events`; solo `src/lib/env.ts` lee `import.meta.env`.
- Ninguna escritura de datos de negocio sale del navegador salvo como RPC; las tablas no tienen permisos de escritura para la API.
- Convención de imports (resolución): **declarada una vez en §19.6 *Resolution convention matrix*** — `@/…` sin extensión dentro de `src/`, rutas
  relativas sin extensión en `supabase/tests/` y `e2e/`, sin scripts ejecutados con `node` suelto.
- Rutas de salida (`dist/`, `dist/sw.js`, `dist/_headers`, `dist-e2e-mock/`) tomadas literalmente de §19.6 *Cross-artifact value reconciliation*.

---
## 4. Data Model

La autoridad es el SQL de *Schema* (abajo), que se pega literalmente en `supabase/migrations/`. Estas tablas resumen el significado de cada entidad.
Dinero en `numeric(12, 2)`, costos `numeric(12, 4)`, cantidades de inventario `numeric(12, 3)`, fechas `timestamptz` + `business_date date`
(día de negocio en Honduras calculado con `app.local_date()`, UTC-6 fijo).

### Entities

**Catálogo e identidad** (paso 3)

| Entidad | Campos clave | Restricciones | Significado y ciclo de vida |
|---|---|---|---|
| `locations` | `id`, `name` | — | El local; una fila en v1 (lista para multi-local) |
| `categories` | `code` (`CF`,`CP`,`PZ`,`CI`,`EX`,`BE`), `name`, `sort_order` | `sort_order` único | Pestañas de la caja, en orden fijo |
| `products` | `id`, `code` `CAT-NNN`, `legacy_code`, `name`, `category_code`, `price`, `isv_rate`, `active`, `sort_order` | `code` único e inmutable, prefijo = categoría, `price > 0`, `isv_rate ∈ {0, 0.15, 0.18}` | Precio final con ISV incluido; nunca se borra (se desactiva) |
| `inventory_items` | `id`, `code`, `name`, `kind`, `unit`, `min_stock`, `avg_cost`, `active` | `code` único e inmutable; `kind ∈ {pollo_entero, pieza, bebida, insumo, desechable}` | Todo en unidades; `avg_cost` promedio ponderado |
| `recipes` | `product_id`, `item_id`, `qty` | PK compuesta, `qty > 0` | Qué descuenta cada producto vendido |
| `staff` | `id`, `display_name`, `role`, `auth_user_id`, `pin_salt`, `pin_hash`, `pin_iterations`, `active` | `role ∈ {cajero, supervisor, socio}`; sal/hash juntos | Personal; `auth_user_id` solo para socios/supervisor del panel |
| `devices` | `id`, `location_id`, `label`, `auth_user_id`, `last_client_seq`, `last_receipt_number`, `last_seen_at`, `active` | `auth_user_id` único | La caja emparejada; desactivarla corta su acceso |
| `pairing_codes` | `code_hash`, `label`, `created_by`, `expires_at`, `used_at`, `device_id` | — | Código de un solo uso (15 min); se guarda solo el sha256 |
| `settings` | `key`, `value jsonb` | — | Umbrales, horario, denominaciones, impresora, bloqueo de PIN |
| `alerts` | `id`, `kind`, `severity`, `business_date`, `message`, `ref_type`, `ref_id`, `acknowledged_by/at` | `kind` en la lista cerrada | Las genera la base; el supervisor las reconoce |
| `audit_log` | `id`, `occurred_at`, `actor_staff_id`, `actor_auth_uid`, `device_id`, `action`, `entity`, `entity_id`, `before`, `after`, `prev_hash`, `hash` | solo inserción; `hash` único | Bitácora: `hash = sha256(prev_hash ‖ forma canónica)` |

**Ventas** (paso 5)

| Entidad | Campos clave | Restricciones | Significado y ciclo de vida |
|---|---|---|---|
| `shifts` | `id` (de la caja), `device_id`, `cashier_staff_id`, `business_date`, `opening_float`, `opening_float_total`, `opening_approved_by`, `closing_count`, `closing_count_total`, `expected_cash`, `difference`, `status` | 1 abierto por caja; aprobador ≠ cajero | `abierto` → `cerrado` (cierre ciego) |
| `pos_events` | `(device_id, client_seq)` PK, `event_id`, `type`, `staff_id`, `payload`, `client_created_at`, `received_at`, `status`, `error` | solo inserción | Libro de todo lo que envió la caja, aplicado o rechazado |
| `sales` | `id`, `device_id`, `shift_id`, `receipt_number`, `receipt_code`, `cashier_staff_id`, `order_type`, `total`, `isv_total`, `status`, `status_before_void`, `business_date`, columnas fiscales nulas | `(device_id, receipt_number)` único; `total > 0`; sin DELETE | `pagada` / `pago_pendiente` → `cobro_fallido` · `anulacion_pendiente` → `anulada` |
| `sale_lines` | `sale_id`, `product_id`, `product_code`, `product_name`, `qty`, `unit_price`, `line_total`, `isv_rate`, `line_base`, `line_isv` | solo inserción | Copia del producto al momento de la venta |
| `payments` | `id`, `sale_id`, `method`, `amount`, `cash_received`, `change_given`, `transfer_reference`, `transfer_status`, `decided_by/at` | efectivo: recibido ≥ monto; transferencia: referencia ≥ 4 | Transferencia `pendiente` → `confirmada` / `rechazada` |
| `void_requests` | `id`, `sale_id`, `requested_by`, `reason`, `status`, `decided_by`, `decided_via` | decidido ≠ solicitante; 1 pendiente por venta | `pendiente` → `aprobada` / `rechazada` |
| `drawer_openings` | `id`, `device_id`, `shift_id`, `staff_id`, `reason`, `business_date` | motivo ≥ 5 | Apertura de gaveta sin venta (siempre alerta) |
| `reprints` | `id`, `sale_id`, `staff_id`, `business_date` | — | Reimpresión "COPIA" (siempre alerta) |

**Inventario** (paso 6)

| Entidad | Campos clave | Restricciones | Significado y ciclo de vida |
|---|---|---|---|
| `inventory_movements` | `id`, `item_id`, `qty` (con signo), `unit_cost`, `kind`, `ref_type`, `ref_id`, `staff_id`, `device_id`, `auth_uid`, `business_date`, `occurred_at` | solo inserción; `qty ≠ 0` | Stock teórico = Σ `qty` (vista `inventory_stock`) |
| `purchases` | `item_id`, `supplier`, `qty`, `pounds`, `total_cost`, `cost_per_unit`, `cost_per_pound`, `photo_path`, `registered_by` | pollo entero exige libras | Compra; entra con costo |
| `cuts` | `chickens`, `pieces`, `total_pieces`, `chicken_unit_cost`, `cost_per_piece`, `registered_by` | — | Corte: sale pollo entero, entran piezas (8 por pollo por defecto) |
| `internal_consumptions` | `item_id`, `qty`, `reason`, `requested_by`, `approved_by` | aprobador ≠ solicitante | Comida del personal (no es venta) |
| `inventory_counts` / `inventory_count_lines` | `business_date`, `counted_by` / `theoretical_qty`, `counted_qty`, `difference`, `waste_value` | — | Conteo ciego del cierre; merma valorizada |

**Cierre y SAR** (paso 7)

| Entidad | Campos clave | Restricciones | Significado y ciclo de vida |
|---|---|---|---|
| `day_closes` | `business_date` (único), `status`, `supervisor_staff_id`, `cash_count(_total)`, `inventory_count_id`, `deposit_kind/amount/receiver/photo_path`, `expected_cash`, `cash_difference`, `justification`, `z_report`, `z_hash`, `signed_at` | inmutable tras `cerrado` | `en_progreso` → `cerrado` (no se reabre) |
| `fiscal_config` | fila única `id = 1`: RTN, razón social, CAI, establecimiento, punto de emisión, tipo de documento, rango, `siguiente`, `fecha_limite`, `activo` | `activo = false` en v1 | Numeración fiscal de 16 dígitos lista para 2027 |

### Relationships

- `categories 1 —(N) products` · `products N —(M) inventory_items` vía `recipes` (borrar producto o ítem está prohibido: `on delete restrict` + `CODIGO_INMUTABLE`).
- `locations 1 —(N) devices` · `staff 1 —(N) pairing_codes` (creador) · `devices 1 —(N) shifts, pos_events, sales, drawer_openings`.
- `shifts 1 —(N) sales 1 —(N) sale_lines, payments, void_requests, reprints` — ninguna cascada: las ventas nunca se borran (trigger `sales_sin_borrado`).
- `inventory_items 1 —(N) inventory_movements, purchases, internal_consumptions, inventory_count_lines` · `inventory_counts 1 —(N) inventory_count_lines`.
- `day_closes N —(1) inventory_counts` · `staff 1 —(N)` en todos los campos de actor/aprobador.
- Ninguna FK usa `on delete cascade`: en este dominio un borrado en cascada es pérdida de evidencia.

### Indexes

| Tabla | Índice | Por qué |
|---|---|---|
| `shifts` | único parcial `(device_id) where status = 'abierto'` | un solo turno abierto por caja |
| `sales` | único `(device_id, receipt_number)`; `(business_date)` | recibo sin duplicados; Z, resumen y CSV por día |
| `sale_lines` | `(sale_id)` | Z por categoría, reverso de anulación |
| `payments` | parcial `(sale_id) where transfer_status = 'pendiente'` | lista de transferencias por confirmar |
| `void_requests` | único parcial `(sale_id) where status = 'pendiente'` | una anulación pendiente por venta |
| `inventory_movements` | `(item_id)`; `(ref_type, ref_id)` | stock teórico; reverso exacto de una venta |
| `alerts` | parcial `(created_at desc) where acknowledged_at is null` | alertas abiertas del panel |
| `pos_events` | PK `(device_id, client_seq)`; único `event_id` | idempotencia |

### Schema

Siete migraciones escritas a mano; los nombres son fijos y el orden alfabético es el orden de aplicación. Pegue cada bloque literalmente.

#### Bloque M-0100 — `supabase/migrations/20261122000100_esquema_base.sql`

```sql
-- supabase/migrations/20261122000100_esquema_base.sql  (paso 3)
-- Esquema base + bitácora con cadena de hash. Sin pgcrypto: sha256() y gen_random_uuid() nativos.
create schema if not exists app;
revoke all on schema app from public;

-- Honduras: UTC-6 sin horario de verano. Aritmética fija: no depende de tzdata (PGlite).
create or replace function app.local_ts(p_ts timestamptz) returns timestamp
language sql immutable set search_path = '' as $$
  select (p_ts at time zone 'UTC') - interval '6 hours'
$$;

create or replace function app.local_date(p_ts timestamptz) returns date
language sql immutable set search_path = '' as $$
  select (app.local_ts(p_ts))::date
$$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create sequence app.snapshot_version;

create or replace function app.bump_snapshot_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform nextval('app.snapshot_version');
  return null;
end $$;

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.categories (
  code text primary key check (code in ('CF', 'CP', 'PZ', 'CI', 'EX', 'BE')),
  name text not null,
  sort_order smallint not null unique,
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^(CF|CP|PZ|CI|EX|BE)-[0-9]{3}$'),
  legacy_code text unique,
  name text not null check (length(trim(name)) > 0),
  category_code text not null references public.categories (code),
  price numeric(12, 2) not null check (price > 0),
  isv_rate numeric(4, 2) not null default 0.15 check (isv_rate in (0.00, 0.15, 0.18)),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_code_matches_category check (left(code, 2) = category_code)
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9-]{2,20}$'),
  name text not null check (length(trim(name)) > 0),
  kind text not null check (kind in ('pollo_entero', 'pieza', 'bebida', 'insumo', 'desechable')),
  unit text not null default 'u',
  min_stock numeric(12, 3) not null default 0 check (min_stock >= 0),
  avg_cost numeric(12, 4) not null default 0 check (avg_cost >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recipes (
  product_id uuid not null references public.products (id) on delete restrict,
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  qty numeric(12, 3) not null check (qty > 0),
  updated_at timestamptz not null default now(),
  primary key (product_id, item_id)
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(trim(display_name)) > 0),
  role text not null check (role in ('cajero', 'supervisor', 'socio')),
  auth_user_id uuid unique,
  pin_salt text check (pin_salt ~ '^[0-9a-f]{32}$'),
  pin_hash text check (pin_hash ~ '^[0-9a-f]{64}$'),
  pin_iterations integer not null default 210000 check (pin_iterations >= 100000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_pin_pair check ((pin_salt is null) = (pin_hash is null))
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id),
  label text not null check (length(trim(label)) > 0),
  auth_user_id uuid not null unique,
  last_client_seq bigint not null default 0,
  last_receipt_number bigint not null default 0,
  last_seen_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pairing_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  label text not null,
  created_by uuid not null references public.staff (id),
  expires_at timestamptz not null,
  used_at timestamptz,
  device_id uuid references public.devices (id),
  created_at timestamptz not null default now()
);

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.alerts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in (
    'diferencia_caja', 'merma', 'anulacion', 'reimpresion', 'apertura_sin_venta',
    'hueco_numeracion', 'fuera_de_horario', 'caja_sin_sincronizar', 'transferencia_rechazada',
    'stock_bajo', 'pin_bloqueado', 'evento_rechazado', 'precio_distinto', 'venta_tras_cierre',
    'rango_fiscal'
  )),
  severity text not null default 'media' check (severity in ('baja', 'media', 'alta')),
  business_date date,
  message text not null,
  ref_type text,
  ref_id text,
  created_at timestamptz not null default now(),
  acknowledged_by uuid references public.staff (id),
  acknowledged_at timestamptz
);

create index alerts_abiertas_idx on public.alerts (created_at desc) where acknowledged_at is null;

-- Códigos permanentes: nunca se reasignan ni se borran (solo active = false).
create or replace function app.code_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'CODIGO_INMUTABLE: % no se borra; se desactiva con active = false', tg_table_name
      using errcode = 'P0001';
  end if;
  if (to_jsonb(new) ->> 'code') <> (to_jsonb(old) ->> 'code')
     or (to_jsonb(new) ->> 'legacy_code') is distinct from (to_jsonb(old) ->> 'legacy_code') then
    raise exception 'CODIGO_INMUTABLE: el código de % no cambia', tg_table_name using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger products_code_guard before update or delete on public.products
  for each row execute function app.code_guard();
create trigger inventory_items_code_guard before update or delete on public.inventory_items
  for each row execute function app.code_guard();

create trigger products_touch before update on public.products
  for each row execute function app.touch_updated_at();
create trigger inventory_items_touch before update on public.inventory_items
  for each row execute function app.touch_updated_at();
create trigger recipes_touch before update on public.recipes
  for each row execute function app.touch_updated_at();
create trigger staff_touch before update on public.staff
  for each row execute function app.touch_updated_at();
create trigger devices_touch before update on public.devices
  for each row execute function app.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function app.touch_updated_at();
create trigger categories_touch before update on public.categories
  for each row execute function app.touch_updated_at();

create trigger products_snapshot after insert or update or delete on public.products
  for each statement execute function app.bump_snapshot_version();
create trigger categories_snapshot after insert or update or delete on public.categories
  for each statement execute function app.bump_snapshot_version();
create trigger staff_snapshot after insert or update or delete on public.staff
  for each statement execute function app.bump_snapshot_version();
create trigger settings_snapshot after insert or update or delete on public.settings
  for each statement execute function app.bump_snapshot_version();

-- ===================== Bitácora antifraude =====================
create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null,
  actor_staff_id uuid,
  actor_auth_uid uuid,
  device_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  prev_hash text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  hash text not null unique check (hash ~ '^[0-9a-f]{64}$')
);

-- Forma canónica: fecha en UTC como texto fijo (no depende de TimeZone de la sesión).
create or replace function app.audit_canonical(
  p_occurred_at timestamptz, p_actor_staff_id uuid, p_actor_auth_uid uuid, p_device_id uuid,
  p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb
) returns text
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'occurred_at', to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor_staff_id', p_actor_staff_id,
    'actor_auth_uid', p_actor_auth_uid,
    'device_id', p_device_id,
    'action', p_action,
    'entity', p_entity,
    'entity_id', p_entity_id,
    'before', p_before,
    'after', p_after
  )::text
$$;

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
  v_entity_id text;
  v_prev text;
  v_at timestamptz := clock_timestamp();
  v_staff uuid := nullif(current_setting('app.actor_staff_id', true), '')::uuid;
  v_device uuid := nullif(current_setting('app.actor_device_id', true), '')::uuid;
  v_uid uuid := auth.uid();
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new); end if;
  v_row := coalesce(v_after, v_before);
  v_entity_id := coalesce(
    v_row ->> 'id', v_row ->> 'code', v_row ->> 'key',
    concat_ws(':', v_row ->> 'product_id', v_row ->> 'item_id')
  );
  perform pg_advisory_xact_lock(42001);
  select a.hash into v_prev from public.audit_log a order by a.id desc limit 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  insert into public.audit_log (
    occurred_at, actor_staff_id, actor_auth_uid, device_id, action, entity, entity_id,
    before, after, prev_hash, hash
  ) values (
    v_at, v_staff, v_uid, v_device, tg_op, tg_table_name, v_entity_id, v_before, v_after, v_prev,
    encode(sha256(convert_to(v_prev || app.audit_canonical(
      v_at, v_staff, v_uid, v_device, tg_op, tg_table_name, v_entity_id, v_before, v_after
    ), 'UTF8')), 'hex')
  );
  return null;
end $$;

create or replace function app.audit_log_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'BITACORA_INMUTABLE: la bitácora no se modifica ni se borra' using errcode = 'P0001';
end $$;

create trigger audit_log_inmutable before update or delete on public.audit_log
  for each row execute function app.audit_log_immutable();
create trigger audit_log_sin_truncate before truncate on public.audit_log
  for each statement execute function app.audit_log_immutable();

create or replace function app.attach_audit(p_table regclass) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger t where t.tgrelid = p_table and t.tgname = 'audit_row'
  ) then
    execute format(
      'create trigger audit_row after insert or update or delete on %s for each row execute function app.audit_row()',
      p_table
    );
  end if;
end $$;

create or replace function app.audit_chain_check()
returns table (ok boolean, first_bad_id bigint, checked bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.audit_log;
  v_prev text := repeat('0', 64);
  v_n bigint := 0;
begin
  for r in select * from public.audit_log order by id loop
    v_n := v_n + 1;
    if r.prev_hash <> v_prev or r.hash <> encode(sha256(convert_to(r.prev_hash || app.audit_canonical(
      r.occurred_at, r.actor_staff_id, r.actor_auth_uid, r.device_id, r.action, r.entity,
      r.entity_id, r.before, r.after
    ), 'UTF8')), 'hex') then
      return query select false, r.id, v_n;
      return;
    end if;
    v_prev := r.hash;
  end loop;
  return query select true, null::bigint, v_n;
end $$;

select app.attach_audit(t)
from unnest(array[
  'public.locations', 'public.categories', 'public.products', 'public.inventory_items',
  'public.recipes', 'public.staff', 'public.devices', 'public.pairing_codes', 'public.settings',
  'public.alerts'
]::regclass[]) as t;
```

#### Bloque M-0110 — `supabase/migrations/20261122000110_catalogo_inicial.sql`

```sql
-- supabase/migrations/20261122000110_catalogo_inicial.sql  (paso 3)
-- Catálogo inicial de la franquicia: 59 productos (Excel 'sistema de EVER gerardo', hoja de productos).
-- Precios finales con ISV incluido. legacy_code conserva el código del Excel tal cual (P001…P0059).
insert into public.locations (name) values ('Pollo Chilero — Aldea El Ocotal, Olanchito, Yoro');

insert into public.categories (code, name, sort_order) values
  ('CF', 'Combos familiares', 1),
  ('CP', 'Combos personales', 2),
  ('PZ', 'Pollo en piezas', 3),
  ('CI', 'Combos infantiles', 4),
  ('EX', 'Extras', 5),
  ('BE', 'Bebidas', 6);

insert into public.settings (key, value) values
  ('cash_diff_threshold', '50'::jsonb),
  ('waste_threshold_pieces', '2'::jsonb),
  ('business_hours', '{"abre": "09:00", "cierra": "21:00"}'::jsonb),
  ('sync_stale_hours', '2'::jsonb),
  ('utc_offset_hours', '-6'::jsonb),
  ('denominations', '[500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1]'::jsonb),
  ('printer', '{"modo": "serial", "baudios": 9600, "columnas": 48}'::jsonb),
  ('pin_lockout', '{"intentos": 5, "segundos": 30}'::jsonb);

insert into public.products (code, legacy_code, name, category_code, price, isv_rate, sort_order) values
  ('CF-001', 'P001', '2 muslos + 1 pierna + 1 ala + 1 papa + 1 refresco', 'CF', 209.00, 0.15, 1),
  ('CF-002', 'P002', '6 piezas + 2 ensaladas + 2 papas', 'CF', 265.00, 0.15, 2),
  ('CF-003', 'P003', '8 piezas + 2 ensaladas + 2 papas', 'CF', 355.00, 0.15, 3),
  ('CF-004', 'P004', '12 piezas + 4 ensaladas + 3 papas + 1 refresco 2 L', 'CF', 765.00, 0.15, 4),
  ('CF-005', 'P005', '4 hamburguesas + 4 papas + 1 refresco 2 L', 'CF', 460.00, 0.15, 5),
  ('CF-006', 'P006', '8 hamburguesas + 8 papas + 1 refresco 2 L', 'CF', 845.00, 0.15, 6),
  ('CP-001', 'P007', '1 ala + 1 pierna + 1 papa + 1 refresco', 'CP', 107.00, 0.15, 1),
  ('CP-002', 'P008', '1 ala + 1 pierna + 1 ensalada + 1 refresco', 'CP', 128.00, 0.15, 2),
  ('CP-003', 'P009', '1 pechuga + 1 papa + 1 ensalada', 'CP', 100.00, 0.15, 3),
  ('CP-004', 'P0010', 'Hamburguesa sola', 'CP', 70.00, 0.15, 4),
  ('CP-005', 'P0011', 'Hamburguesa + 1 papa + 1 refresco', 'CP', 135.00, 0.15, 5),
  ('CP-006', 'P0012', 'Orden de tacos (2)', 'CP', 100.00, 0.15, 6),
  ('CP-007', 'P0013', 'Orden de enchiladas (2)', 'CP', 100.00, 0.15, 7),
  ('PZ-001', 'P0014', '4 piezas de pollo', 'PZ', 120.00, 0.15, 1),
  ('PZ-002', 'P0015', '6 piezas de pollo', 'PZ', 165.00, 0.15, 2),
  ('PZ-003', 'P0016', '8 piezas de pollo', 'PZ', 255.00, 0.15, 3),
  ('PZ-004', 'P0017', '12 piezas de pollo', 'PZ', 387.00, 0.15, 4),
  ('PZ-005', 'P0018', '24 piezas de pollo', 'PZ', 740.00, 0.15, 5),
  ('CI-001', 'P0019', '1 pierna + 1 papa + 1 jugo', 'CI', 70.00, 0.15, 1),
  ('CI-002', 'P0020', '1 pierna + 1 papa + 1 Pepsi', 'CI', 80.00, 0.15, 2),
  ('CI-003', 'P0021', 'Medallones + 1 papa + 1 jugo', 'CI', 75.00, 0.15, 3),
  ('CI-004', 'P0022', '1 pierna + 1 papa', 'CI', 50.00, 0.15, 4),
  ('CI-005', 'P0023', 'Papitas con queso + 1 jugo', 'CI', 50.00, 0.15, 5),
  ('CI-006', 'P00024', 'Hamburguesa + 1 papa (infantil)', 'CI', 95.00, 0.15, 6),
  ('EX-001', 'P0025', 'Ensalada', 'EX', 25.00, 0.15, 1),
  ('EX-002', 'P0026', 'Papas personales', 'EX', 25.00, 0.15, 2),
  ('EX-003', 'P0027', 'Papas familiares', 'EX', 50.00, 0.15, 3),
  ('EX-004', 'P0028', 'Tortillas', 'EX', 15.00, 0.15, 4),
  ('EX-005', 'P0029', 'Pechuga', 'EX', 50.00, 0.15, 5),
  ('EX-006', 'P0030', 'Ala', 'EX', 25.00, 0.15, 6),
  ('EX-007', 'P0031', 'Pierna', 'EX', 25.00, 0.15, 7),
  ('EX-008', 'P0032', 'Muslo', 'EX', 32.00, 0.15, 8),
  ('BE-001', 'P0033', 'Pepsi 3 L', 'BE', 75.00, 0.15, 1),
  ('BE-002', 'P0034', 'Pepsi 2 L', 'BE', 58.00, 0.15, 2),
  ('BE-003', 'P0035', 'Pepsi 1.5 L', 'BE', 48.00, 0.15, 3),
  ('BE-004', 'P0036', '1 1/4 L Pepsi, Mirinda, 7up', 'BE', 38.00, 0.15, 4),
  ('BE-005', 'P0037', 'Litro mega vidrio Pepsi y Mirinda', 'BE', 32.00, 0.15, 5),
  ('BE-006', 'P0038', 'Jugo galón', 'BE', 55.00, 0.15, 6),
  ('BE-007', 'P0039', 'Jugo 1/2 galón', 'BE', 35.00, 0.15, 7),
  ('BE-008', 'P0040', '12 oz Pepsi, Mirinda, naranja, uva, 7up, Teen', 'BE', 13.00, 0.15, 8),
  ('BE-009', 'P0041', 'Agua en bolsa', 'BE', 5.00, 0.15, 9),
  ('BE-010', 'P0042', 'Agua bote', 'BE', 10.00, 0.15, 10),
  ('BE-011', 'P0043', 'Montana naranja y manzana', 'BE', 7.00, 0.15, 11),
  ('BE-012', 'P0044', 'Pepsi personal y sabores', 'BE', 25.00, 0.15, 12),
  ('BE-013', 'P0045', 'Té frío pequeño', 'BE', 20.00, 0.15, 13),
  ('BE-014', 'P0046', 'Té frío grande', 'BE', 25.00, 0.15, 14),
  ('BE-015', 'P0047', 'Jugo Quanty personal', 'BE', 15.00, 0.15, 15),
  ('BE-016', 'P0048', 'Jugo Enjoy personal', 'BE', 15.00, 0.15, 16),
  ('BE-017', 'P0049', 'Gatorade pequeño', 'BE', 25.00, 0.15, 17),
  ('BE-018', 'P0050', 'Gatorade grande', 'BE', 35.00, 0.15, 18),
  ('BE-019', 'P0051', 'Sting', 'BE', 10.00, 0.15, 19),
  ('BE-020', 'P0052', 'Link coco y banana', 'BE', 7.00, 0.15, 20),
  ('BE-021', 'P0053', 'Mini Pepsi', 'BE', 8.00, 0.15, 21),
  ('BE-022', 'P0054', 'Enjoy lata', 'BE', 15.00, 0.15, 22),
  ('BE-023', 'P0055', 'Pepsi Zero lata', 'BE', 20.00, 0.15, 23),
  ('BE-024', 'P0056', 'Mountain Dew verde y rosada', 'BE', 23.00, 0.15, 24),
  ('BE-025', 'P0057', 'Adrenalina pequeña', 'BE', 45.00, 0.15, 25),
  ('BE-026', 'P0058', 'Quanty pequeño', 'BE', 10.00, 0.15, 26),
  ('BE-027', 'P0059', 'Link personal de sabores', 'BE', 20.00, 0.15, 27);

insert into public.inventory_items (code, name, kind) values
  ('POLLO-ENTERO', 'Pollo entero', 'pollo_entero'),
  ('PECHUGA', 'Pechuga', 'pieza'),
  ('MUSLO', 'Muslo', 'pieza'),
  ('PIERNA', 'Pierna', 'pieza'),
  ('ALA', 'Ala', 'pieza'),
  ('PAPA-PERS', 'Papas porción personal', 'insumo'),
  ('PAPA-FAM', 'Papas porción familiar', 'insumo'),
  ('ENSALADA', 'Ensalada porción', 'insumo'),
  ('TORTILLAS', 'Tortillas (orden)', 'insumo'),
  ('PAN-HAMB', 'Pan de hamburguesa', 'insumo'),
  ('CARNE-HAMB', 'Carne de hamburguesa', 'insumo'),
  ('TACO', 'Taco', 'insumo'),
  ('ENCHILADA', 'Enchilada', 'insumo'),
  ('MEDALLONES', 'Medallones porción', 'insumo'),
  ('PAPITAS-QUESO', 'Papitas con queso porción', 'insumo'),
  ('BE-001', 'Pepsi 3 L', 'bebida'),
  ('BE-002', 'Pepsi 2 L', 'bebida'),
  ('BE-003', 'Pepsi 1.5 L', 'bebida'),
  ('BE-004', '1 1/4 L Pepsi, Mirinda, 7up', 'bebida'),
  ('BE-005', 'Litro mega vidrio Pepsi y Mirinda', 'bebida'),
  ('BE-006', 'Jugo galón', 'bebida'),
  ('BE-007', 'Jugo 1/2 galón', 'bebida'),
  ('BE-008', '12 oz Pepsi, Mirinda, naranja, uva, 7up, Teen', 'bebida'),
  ('BE-009', 'Agua en bolsa', 'bebida'),
  ('BE-010', 'Agua bote', 'bebida'),
  ('BE-011', 'Montana naranja y manzana', 'bebida'),
  ('BE-012', 'Pepsi personal y sabores', 'bebida'),
  ('BE-013', 'Té frío pequeño', 'bebida'),
  ('BE-014', 'Té frío grande', 'bebida'),
  ('BE-015', 'Jugo Quanty personal', 'bebida'),
  ('BE-016', 'Jugo Enjoy personal', 'bebida'),
  ('BE-017', 'Gatorade pequeño', 'bebida'),
  ('BE-018', 'Gatorade grande', 'bebida'),
  ('BE-019', 'Sting', 'bebida'),
  ('BE-020', 'Link coco y banana', 'bebida'),
  ('BE-021', 'Mini Pepsi', 'bebida'),
  ('BE-022', 'Enjoy lata', 'bebida'),
  ('BE-023', 'Pepsi Zero lata', 'bebida'),
  ('BE-024', 'Mountain Dew verde y rosada', 'bebida'),
  ('BE-025', 'Adrenalina pequeña', 'bebida'),
  ('BE-026', 'Quanty pequeño', 'bebida'),
  ('BE-027', 'Link personal de sabores', 'bebida');

insert into public.recipes (product_id, item_id, qty)
select p.id, i.id, r.qty
from (values
  ('CF-001', 'MUSLO', 2),
  ('CF-001', 'PIERNA', 1),
  ('CF-001', 'ALA', 1),
  ('CF-001', 'PAPA-PERS', 1),
  ('CF-001', 'BE-008', 1),
  ('CF-002', 'ALA', 2),
  ('CF-002', 'PIERNA', 2),
  ('CF-002', 'MUSLO', 1),
  ('CF-002', 'PECHUGA', 1),
  ('CF-002', 'ENSALADA', 2),
  ('CF-002', 'PAPA-PERS', 2),
  ('CF-003', 'ALA', 2),
  ('CF-003', 'PIERNA', 2),
  ('CF-003', 'MUSLO', 2),
  ('CF-003', 'PECHUGA', 2),
  ('CF-003', 'ENSALADA', 2),
  ('CF-003', 'PAPA-PERS', 2),
  ('CF-004', 'ALA', 3),
  ('CF-004', 'PIERNA', 3),
  ('CF-004', 'MUSLO', 3),
  ('CF-004', 'PECHUGA', 3),
  ('CF-004', 'ENSALADA', 4),
  ('CF-004', 'PAPA-PERS', 3),
  ('CF-004', 'BE-002', 1),
  ('CF-005', 'PAN-HAMB', 4),
  ('CF-005', 'CARNE-HAMB', 4),
  ('CF-005', 'PAPA-PERS', 4),
  ('CF-005', 'BE-002', 1),
  ('CF-006', 'PAN-HAMB', 8),
  ('CF-006', 'CARNE-HAMB', 8),
  ('CF-006', 'PAPA-PERS', 8),
  ('CF-006', 'BE-002', 1),
  ('CP-001', 'ALA', 1),
  ('CP-001', 'PIERNA', 1),
  ('CP-001', 'PAPA-PERS', 1),
  ('CP-001', 'BE-008', 1),
  ('CP-002', 'ALA', 1),
  ('CP-002', 'PIERNA', 1),
  ('CP-002', 'ENSALADA', 1),
  ('CP-002', 'BE-008', 1),
  ('CP-003', 'PECHUGA', 1),
  ('CP-003', 'PAPA-PERS', 1),
  ('CP-003', 'ENSALADA', 1),
  ('CP-004', 'PAN-HAMB', 1),
  ('CP-004', 'CARNE-HAMB', 1),
  ('CP-005', 'PAN-HAMB', 1),
  ('CP-005', 'CARNE-HAMB', 1),
  ('CP-005', 'PAPA-PERS', 1),
  ('CP-005', 'BE-008', 1),
  ('CP-006', 'TACO', 2),
  ('CP-007', 'ENCHILADA', 2),
  ('PZ-001', 'ALA', 1),
  ('PZ-001', 'PIERNA', 1),
  ('PZ-001', 'MUSLO', 1),
  ('PZ-001', 'PECHUGA', 1),
  ('PZ-002', 'ALA', 2),
  ('PZ-002', 'PIERNA', 2),
  ('PZ-002', 'MUSLO', 1),
  ('PZ-002', 'PECHUGA', 1),
  ('PZ-003', 'ALA', 2),
  ('PZ-003', 'PIERNA', 2),
  ('PZ-003', 'MUSLO', 2),
  ('PZ-003', 'PECHUGA', 2),
  ('PZ-004', 'ALA', 3),
  ('PZ-004', 'PIERNA', 3),
  ('PZ-004', 'MUSLO', 3),
  ('PZ-004', 'PECHUGA', 3),
  ('PZ-005', 'ALA', 6),
  ('PZ-005', 'PIERNA', 6),
  ('PZ-005', 'MUSLO', 6),
  ('PZ-005', 'PECHUGA', 6),
  ('CI-001', 'PIERNA', 1),
  ('CI-001', 'PAPA-PERS', 1),
  ('CI-001', 'BE-015', 1),
  ('CI-002', 'PIERNA', 1),
  ('CI-002', 'PAPA-PERS', 1),
  ('CI-002', 'BE-008', 1),
  ('CI-003', 'MEDALLONES', 1),
  ('CI-003', 'PAPA-PERS', 1),
  ('CI-003', 'BE-015', 1),
  ('CI-004', 'PIERNA', 1),
  ('CI-004', 'PAPA-PERS', 1),
  ('CI-005', 'PAPITAS-QUESO', 1),
  ('CI-005', 'BE-015', 1),
  ('CI-006', 'PAN-HAMB', 1),
  ('CI-006', 'CARNE-HAMB', 1),
  ('CI-006', 'PAPA-PERS', 1),
  ('EX-001', 'ENSALADA', 1),
  ('EX-002', 'PAPA-PERS', 1),
  ('EX-003', 'PAPA-FAM', 1),
  ('EX-004', 'TORTILLAS', 1),
  ('EX-005', 'PECHUGA', 1),
  ('EX-006', 'ALA', 1),
  ('EX-007', 'PIERNA', 1),
  ('EX-008', 'MUSLO', 1),
  ('BE-001', 'BE-001', 1),
  ('BE-002', 'BE-002', 1),
  ('BE-003', 'BE-003', 1),
  ('BE-004', 'BE-004', 1),
  ('BE-005', 'BE-005', 1),
  ('BE-006', 'BE-006', 1),
  ('BE-007', 'BE-007', 1),
  ('BE-008', 'BE-008', 1),
  ('BE-009', 'BE-009', 1),
  ('BE-010', 'BE-010', 1),
  ('BE-011', 'BE-011', 1),
  ('BE-012', 'BE-012', 1),
  ('BE-013', 'BE-013', 1),
  ('BE-014', 'BE-014', 1),
  ('BE-015', 'BE-015', 1),
  ('BE-016', 'BE-016', 1),
  ('BE-017', 'BE-017', 1),
  ('BE-018', 'BE-018', 1),
  ('BE-019', 'BE-019', 1),
  ('BE-020', 'BE-020', 1),
  ('BE-021', 'BE-021', 1),
  ('BE-022', 'BE-022', 1),
  ('BE-023', 'BE-023', 1),
  ('BE-024', 'BE-024', 1),
  ('BE-025', 'BE-025', 1),
  ('BE-026', 'BE-026', 1),
  ('BE-027', 'BE-027', 1)
) as r (product_code, item_code, qty)
join public.products p on p.code = r.product_code
join public.inventory_items i on i.code = r.item_code;

do $$
begin
  if exists (
    select 1 from public.products p
    where not exists (select 1 from public.recipes r where r.product_id = p.id)
  ) then
    raise exception 'SEED_RECETAS_INCOMPLETAS: hay productos sin receta';
  end if;
end $$;

-- productos 59 recetas 122 items 42
```

#### Bloque M-0200 — `supabase/migrations/20261122000200_seguridad.sql`

```sql
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
```

#### Bloque M-0300 — `supabase/migrations/20261122000300_ventas.sql`

```sql
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
```

#### Bloque M-0400 — `supabase/migrations/20261122000400_inventario.sql`

```sql
-- supabase/migrations/20261122000400_inventario.sql  (paso 6)
-- Inventario por receta: libro de movimientos append-only, compras (pollo por peso), cortes de 8 piezas,
-- consumo interno, conteos y merma valorizada a costo promedio ponderado. Bucket privado de comprobantes.

create table public.inventory_movements (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.inventory_items (id),
  qty numeric(12, 3) not null check (qty <> 0),
  unit_cost numeric(12, 4) not null default 0,
  kind text not null check (kind in (
    'compra', 'corte_salida', 'corte_entrada', 'venta', 'anulacion', 'consumo_interno', 'ajuste_conteo'
  )),
  ref_type text not null,
  ref_id text not null,
  staff_id uuid references public.staff (id),
  device_id uuid references public.devices (id),
  auth_uid uuid default auth.uid(),
  business_date date not null,
  occurred_at timestamptz not null default now()
);
create index inventory_movements_item_idx on public.inventory_movements (item_id);
create index inventory_movements_ref_idx on public.inventory_movements (ref_type, ref_id);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id),
  supplier text not null check (length(trim(supplier)) > 0),
  qty numeric(12, 3) not null check (qty > 0),
  pounds numeric(12, 3) check (pounds > 0),
  total_cost numeric(12, 2) not null check (total_cost > 0),
  cost_per_unit numeric(12, 4) not null,
  cost_per_pound numeric(12, 4),
  photo_path text,
  registered_by uuid not null references public.staff (id),
  business_date date not null,
  created_at timestamptz not null default now()
);

create table public.cuts (
  id uuid primary key default gen_random_uuid(),
  chickens integer not null check (chickens > 0),
  pieces jsonb not null,
  total_pieces integer not null check (total_pieces > 0),
  chicken_unit_cost numeric(12, 4) not null,
  cost_per_piece numeric(12, 4) not null,
  registered_by uuid not null references public.staff (id),
  business_date date not null,
  created_at timestamptz not null default now()
);

create table public.internal_consumptions (
  id uuid primary key,
  item_id uuid not null references public.inventory_items (id),
  qty numeric(12, 3) not null check (qty > 0),
  reason text not null check (length(trim(reason)) >= 5),
  requested_by uuid not null references public.staff (id),
  approved_by uuid not null references public.staff (id),
  device_id uuid references public.devices (id),
  business_date date not null,
  created_at timestamptz not null default now(),
  constraint consumo_segregacion check (approved_by <> requested_by)
);

create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  counted_by uuid not null references public.staff (id),
  created_at timestamptz not null default now()
);

create table public.inventory_count_lines (
  count_id uuid not null references public.inventory_counts (id),
  item_id uuid not null references public.inventory_items (id),
  theoretical_qty numeric(12, 3) not null,
  counted_qty numeric(12, 3) not null check (counted_qty >= 0),
  difference numeric(12, 3) not null,
  waste_value numeric(12, 2) not null,
  primary key (count_id, item_id)
);

select app.secure_table(t)
from unnest(array[
  'public.inventory_movements', 'public.purchases', 'public.cuts', 'public.internal_consumptions',
  'public.inventory_counts', 'public.inventory_count_lines'
]::regclass[]) as t;

create or replace function app.movement_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'MOVIMIENTO_INMUTABLE: los movimientos de inventario no se modifican ni se borran'
    using errcode = 'P0001';
end $$;

create trigger inventory_movements_inmutable before update or delete on public.inventory_movements
  for each row execute function app.movement_immutable();

create view public.inventory_stock with (security_invoker = true) as
select i.id as item_id, i.code, i.name, i.kind, i.min_stock, i.avg_cost,
  coalesce(sum(m.qty), 0)::numeric(12, 3) as qty
from public.inventory_items i
left join public.inventory_movements m on m.item_id = i.id
group by i.id;

revoke all on public.inventory_stock from public, anon, authenticated;
grant select on public.inventory_stock to authenticated;

create or replace function app.stock_of(p_item uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(qty), 0) from public.inventory_movements where item_id = p_item
$$;

create or replace function app.item_by_code(p_code text) returns public.inventory_items
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.inventory_items;
begin
  select * into v from public.inventory_items where code = p_code and active;
  if not found then
    raise exception 'ITEM_INVALIDO: %', p_code using errcode = 'P0001';
  end if;
  return v;
end $$;

-- Costo promedio ponderado al entrar inventario (stock negativo cuenta como 0).
create or replace function app.apply_entry_cost(p_item uuid, p_qty numeric, p_unit_cost numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_stock numeric := greatest(app.stock_of(p_item), 0);
begin
  update public.inventory_items
  set avg_cost = round((v_stock * avg_cost + p_qty * p_unit_cost) / (v_stock + p_qty), 4)
  where id = p_item;
end $$;

-- Alerta de stock bajo (una abierta por ítem).
create or replace function app.movement_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.inventory_items;
begin
  select * into v_item from public.inventory_items where id = new.item_id;
  if v_item.min_stock > 0 and app.stock_of(new.item_id) < v_item.min_stock
     and not exists (select 1 from public.alerts a where a.kind = 'stock_bajo'
       and a.ref_id = new.item_id::text and a.acknowledged_at is null) then
    perform app.raise_alert('stock_bajo', 'media', new.business_date,
      format('Stock bajo de %s: %s (mínimo %s)', v_item.code, app.stock_of(new.item_id), v_item.min_stock),
      'inventory_item', new.item_id::text);
  end if;
  return null;
end $$;

create trigger inventory_movements_after after insert on public.inventory_movements
  for each row execute function app.movement_after();

-- Venta → descuento por receta (por línea).
create or replace function app.sale_line_inventory() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.inventory_movements (item_id, qty, unit_cost, kind, ref_type, ref_id, staff_id,
    device_id, business_date)
  select r.item_id, -(r.qty * new.qty), i.avg_cost, 'venta', 'sale', new.sale_id::text,
    s.cashier_staff_id, s.device_id, s.business_date
  from public.recipes r
  join public.inventory_items i on i.id = r.item_id
  join public.sales s on s.id = new.sale_id
  where r.product_id = new.product_id;
  return null;
end $$;

create trigger sale_lines_inventory after insert on public.sale_lines
  for each row execute function app.sale_line_inventory();

-- Anulación aprobada → movimientos inversos exactos de lo descontado (no de la receta actual).
create or replace function app.sale_void_inventory() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'anulada' and old.status <> 'anulada' then
    insert into public.inventory_movements (item_id, qty, unit_cost, kind, ref_type, ref_id, staff_id,
      device_id, business_date)
    select m.item_id, -m.qty, m.unit_cost, 'anulacion', 'sale', new.id::text,
      nullif(current_setting('app.actor_staff_id', true), '')::uuid, new.device_id, new.business_date
    from public.inventory_movements m
    where m.ref_type = 'sale' and m.ref_id = new.id::text and m.kind = 'venta';
  end if;
  return null;
end $$;

create trigger sales_void_inventory after update of status on public.sales
  for each row execute function app.sale_void_inventory();

-- ---------- RPC de inventario (supervisor, panel con MFA) ----------
create or replace function public.register_purchase(
  p_item_code text, p_qty numeric, p_total_cost numeric, p_supplier text,
  p_pounds numeric default null, p_photo_path text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v_item public.inventory_items := app.item_by_code(p_item_code);
  v_unit numeric;
  v_id uuid;
  v_date date := app.local_date(now());
begin
  if coalesce(p_qty, 0) <= 0 or coalesce(p_total_cost, 0) <= 0 then
    raise exception 'CANTIDAD_INVALIDA: cantidad y costo deben ser mayores a 0' using errcode = 'P0001';
  end if;
  if v_item.kind = 'pollo_entero' and coalesce(p_pounds, 0) <= 0 then
    raise exception 'LIBRAS_REQUERIDAS: el pollo entero se compra por peso' using errcode = 'P0001';
  end if;
  v_unit := round(p_total_cost / p_qty, 4);
  perform app.apply_entry_cost(v_item.id, p_qty, v_unit);
  insert into public.purchases (item_id, supplier, qty, pounds, total_cost, cost_per_unit, cost_per_pound,
    photo_path, registered_by, business_date)
  values (v_item.id, trim(p_supplier), p_qty, p_pounds, p_total_cost, v_unit,
    case when p_pounds is not null then round(p_total_cost / p_pounds, 4) end, p_photo_path, v_actor, v_date)
  returning id into v_id;
  insert into public.inventory_movements (item_id, qty, unit_cost, kind, ref_type, ref_id, staff_id,
    business_date)
  values (v_item.id, p_qty, v_unit, 'compra', 'purchase', v_id::text, v_actor, v_date);
  return v_id;
end $$;

create or replace function public.register_cut(p_chickens integer, p_pieces jsonb default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v_pollo public.inventory_items := app.item_by_code('POLLO-ENTERO');
  v_pieces jsonb;
  v_total integer := 0;
  v_piece_cost numeric;
  v_id uuid;
  v_code text;
  v_n integer;
  v_date date := app.local_date(now());
begin
  if coalesce(p_chickens, 0) <= 0 then
    raise exception 'CANTIDAD_INVALIDA: indique cuántos pollos se cortan' using errcode = 'P0001';
  end if;
  if app.stock_of(v_pollo.id) < p_chickens then
    raise exception 'STOCK_INSUFICIENTE: hay % pollos enteros', app.stock_of(v_pollo.id) using errcode = 'P0001';
  end if;
  v_pieces := coalesce(p_pieces, jsonb_build_object(
    'ALA', 2 * p_chickens, 'PIERNA', 2 * p_chickens, 'MUSLO', 2 * p_chickens, 'PECHUGA', 2 * p_chickens));
  for v_code, v_n in select key, (value #>> '{}')::integer from jsonb_each(v_pieces) loop
    if v_code not in ('ALA', 'PIERNA', 'MUSLO', 'PECHUGA') or v_n < 0 then
      raise exception 'CORTE_INVALIDO: % = %', v_code, v_n using errcode = 'P0001';
    end if;
    v_total := v_total + v_n;
  end loop;
  if v_total <= 0 then
    raise exception 'CORTE_INVALIDO: el corte no produjo piezas' using errcode = 'P0001';
  end if;
  v_piece_cost := round(v_pollo.avg_cost * p_chickens / v_total, 4);
  insert into public.cuts (chickens, pieces, total_pieces, chicken_unit_cost, cost_per_piece, registered_by,
    business_date)
  values (p_chickens, v_pieces, v_total, v_pollo.avg_cost, v_piece_cost, v_actor, v_date)
  returning id into v_id;
  insert into public.inventory_movements (item_id, qty, unit_cost, kind, ref_type, ref_id, staff_id,
    business_date)
  values (v_pollo.id, -p_chickens, v_pollo.avg_cost, 'corte_salida', 'cut', v_id::text, v_actor, v_date);
  for v_code, v_n in select key, (value #>> '{}')::integer from jsonb_each(v_pieces) loop
    if v_n > 0 then
      perform app.apply_entry_cost((app.item_by_code(v_code)).id, v_n, v_piece_cost);
      insert into public.inventory_movements (item_id, qty, unit_cost, kind, ref_type, ref_id, staff_id,
        business_date)
      values ((app.item_by_code(v_code)).id, v_n, v_piece_cost, 'corte_entrada', 'cut', v_id::text,
        v_actor, v_date);
    end if;
  end loop;
  return v_id;
end $$;

-- Conteo físico (lo usa el cierre del día): ajusta al contado y valoriza la merma.
create or replace function app.apply_inventory_count(p_counted_by uuid, p_date date, p_lines jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_count uuid;
  v_line jsonb;
  v_item public.inventory_items;
  v_theo numeric;
  v_counted numeric;
  v_piece_waste numeric := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'CONTEO_INVALIDO: el conteo no tiene líneas' using errcode = 'P0001';
  end if;
  insert into public.inventory_counts (business_date, counted_by) values (p_date, p_counted_by)
  returning id into v_count;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_item := app.item_by_code(v_line ->> 'item_code');
    v_counted := (v_line ->> 'counted')::numeric;
    if v_counted is null or v_counted < 0 then
      raise exception 'CONTEO_INVALIDO: % = %', v_item.code, v_line ->> 'counted' using errcode = 'P0001';
    end if;
    v_theo := app.stock_of(v_item.id);
    insert into public.inventory_count_lines (count_id, item_id, theoretical_qty, counted_qty, difference,
      waste_value)
    values (v_count, v_item.id, v_theo, v_counted, v_counted - v_theo,
      round(greatest(v_theo - v_counted, 0) * v_item.avg_cost, 2));
    if v_counted <> v_theo then
      insert into public.inventory_movements (item_id, qty, unit_cost, kind, ref_type, ref_id, staff_id,
        business_date)
      values (v_item.id, v_counted - v_theo, v_item.avg_cost, 'ajuste_conteo', 'inventory_count',
        v_count::text, p_counted_by, p_date);
    end if;
    if v_item.kind = 'pieza' then
      v_piece_waste := v_piece_waste + greatest(v_theo - v_counted, 0);
    end if;
  end loop;
  if v_piece_waste > app.setting_num('waste_threshold_pieces') then
    perform app.raise_alert('merma', 'alta', p_date,
      format('Merma de %s piezas de pollo el %s', v_piece_waste, p_date), 'inventory_count', v_count::text);
  end if;
  return v_count;
end $$;

-- Consumo interno (comida del personal), aprobado por supervisor en caja.
create or replace function app.ev_consumo_interno(p_device uuid, p_event jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := p_event -> 'payload';
  v_staff uuid := (p_event ->> 'staff_id')::uuid;
  v_approver uuid := (p ->> 'approved_by')::uuid;
  v_item public.inventory_items := app.item_by_code(p ->> 'item_code');
  v_date date := app.local_date((p_event ->> 'client_created_at')::timestamptz);
  v_qty numeric := (p ->> 'qty')::numeric;
begin
  if v_approver is null or v_approver = v_staff then
    raise exception 'SEGREGACION: el consumo interno lo aprueba otro supervisor' using errcode = 'P0001';
  end if;
  perform app.require_staff(v_approver, array['supervisor']);
  if coalesce(v_qty, 0) <= 0 then
    raise exception 'CANTIDAD_INVALIDA: %', p ->> 'qty' using errcode = 'P0001';
  end if;
  insert into public.internal_consumptions (id, item_id, qty, reason, requested_by, approved_by, device_id,
    business_date)
  values ((p ->> 'consumption_id')::uuid, v_item.id, v_qty, trim(p ->> 'reason'), v_staff, v_approver,
    p_device, v_date);
  insert into public.inventory_movements (item_id, qty, unit_cost, kind, ref_type, ref_id, staff_id,
    device_id, business_date)
  values (v_item.id, -v_qty, v_item.avg_cost, 'consumo_interno', 'internal_consumption', p ->> 'consumption_id',
    v_staff, p_device, v_date);
end $$;

-- ---------- RPC de catálogo y configuración (supervisor) ----------
create or replace function public.upsert_recipe(p_product_code text, p_lines jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v_product uuid;
  v_line jsonb;
begin
  select id into v_product from public.products where code = p_product_code;
  if v_product is null then
    raise exception 'PRODUCTO_INVALIDO: %', p_product_code using errcode = 'P0001';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'RECETA_INVALIDA: la receta necesita al menos una línea' using errcode = 'P0001';
  end if;
  delete from public.recipes where product_id = v_product;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if coalesce((v_line ->> 'qty')::numeric, 0) <= 0 then
      raise exception 'RECETA_INVALIDA: cantidad inválida en %', v_line using errcode = 'P0001';
    end if;
    insert into public.recipes (product_id, item_id, qty)
    values (v_product, (app.item_by_code(v_line ->> 'item_code')).id, (v_line ->> 'qty')::numeric);
  end loop;
end $$;

create or replace function public.set_product(
  p_code text, p_name text, p_price numeric, p_active boolean, p_isv_rate numeric default 0.15
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
begin
  update public.products set name = trim(p_name), price = p_price, active = p_active, isv_rate = p_isv_rate
  where code = p_code;
  if not found then
    raise exception 'PRODUCTO_INVALIDO: %', p_code using errcode = 'P0001';
  end if;
end $$;

create or replace function public.create_product(
  p_category_code text, p_name text, p_price numeric, p_isv_rate numeric default 0.15
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
  v_next integer;
  v_code text;
begin
  select coalesce(max(substr(code, 4)::integer), 0) + 1 into v_next
  from public.products where category_code = p_category_code;
  v_code := p_category_code || '-' || lpad(v_next::text, 3, '0');
  insert into public.products (code, name, category_code, price, isv_rate, sort_order)
  values (v_code, trim(p_name), p_category_code, p_price, p_isv_rate, v_next);
  return v_code;
end $$;

create or replace function public.set_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
begin
  update public.settings set value = p_value where key = p_key;
  if not found then
    raise exception 'AJUSTE_INVALIDO: %', p_key using errcode = 'P0001';
  end if;
end $$;

create or replace function public.set_item(p_code text, p_name text, p_min_stock numeric, p_active boolean,
  p_kind text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_panel(array['supervisor']);
begin
  if exists (select 1 from public.inventory_items where code = p_code) then
    update public.inventory_items set name = trim(p_name), min_stock = p_min_stock, active = p_active
    where code = p_code;
  else
    insert into public.inventory_items (code, name, kind, min_stock, active)
    values (p_code, trim(p_name), coalesce(p_kind, 'desechable'), p_min_stock, p_active);
  end if;
end $$;

-- ---------- Storage: comprobantes (bucket privado) ----------
insert into storage.buckets (id, name, public) values ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;

create policy comprobantes_insert_supervisor on storage.objects for insert to authenticated
  with check (bucket_id = 'comprobantes' and app.is_panel_supervisor());
create policy comprobantes_select_panel on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and app.is_panel_reader());
```

#### Bloque M-0500 — `supabase/migrations/20261122000500_cierre_dia.sql`

```sql
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
```

#### Bloque M-0600 — `supabase/migrations/20261122000600_fiscal.sql`

```sql
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
```

### Migrations

- **Herramienta:** archivos SQL planos en `supabase/migrations/<AAAAMMDDHHMMSS>_<nombre>.sql`, escritos a mano (no generados), aplicados en orden
  alfabético. En pruebas los aplica `supabase/tests/harness.ts` sobre PGlite tras `supabase/tests/shim.sql`; en producción los aplica el usuario
  con la CLI de Supabase (`supabase db push`, §12) o pegándolos en el SQL Editor, **en orden y una sola vez cada uno**.
- **Regla de producción:** una migración aplicada nunca se edita; todo cambio es una migración nueva, aditiva (expandir → migrar → contraer),
  porque una caja que estuvo offline puede enviar eventos de la versión anterior. Skill del proyecto: `agregar-migracion` (§19.4).
- Toda tabla nueva llama `select app.secure_table('public.<tabla>'::regclass);` en su misma migración; las pruebas de propiedad de los pasos 3–4
  fallan si se omite.

### Seed data

El catálogo inicial es **dato de producción**, no de demostración: vive en la migración `20261122000110_catalogo_inicial.sql` (bloque M-0110) y se
aplica una vez. Contiene: 1 local, 6 categorías, 8 ajustes (`cash_diff_threshold` 50, `waste_threshold_pieces` 2, `business_hours` 09:00–21:00,
`sync_stale_hours` 2, `utc_offset_hours` −6, `denominations`, `printer` serial 9600 baudios 48 columnas, `pin_lockout` 5 intentos/30 s), 59 productos
(`CF-001…006`, `CP-001…007`, `PZ-001…005`, `CI-001…006`, `EX-001…008`, `BE-001…027`, `legacy_code` P001…P0059 del Excel), 42 ítems de inventario
(5 de pollo, 10 insumos, 27 bebidas con el mismo código que su producto) y la receta de cada producto. No crea personal ni cajas: el primer
supervisor se crea con `app.bootstrap_supervisor` en el SQL Editor (§12) y el resto desde el panel.

### Almacén local de la caja (IndexedDB con Dexie)

```ts
// src/pos/db.ts — base IndexedDB "pollo-chilero-pos", versión 1
this.version(1).stores({
  meta: "key", // deviceId, deviceLabel, snapshotVersion, lastReceiptNumber, lastClientSeq, storagePersisted, syncState
  categories: "code, sortOrder",
  products: "id, code, categoryCode, active",
  staff: "id, role", // displayName, pinSalt, pinHash, pinIterations
  settings: "key",
  outbox: "clientSeq, status, eventId", // type, staffId, payload, clientCreatedAt, attempts, lastError, ackedAt
  sales: "id, receiptNumber, shiftId, createdAt, status", // receiptCode, cashierId, orderType, lines, payments, total, isv
  shifts: "id, status, cashierId", // openedAt, openingFloat, openingTotal, closingCount, closedAt, approvedBy
  pinAttempts: "staffId", // failures, lockedUntil
});
```

Estados locales: `outbox.status` ∈ `pendiente` · `enviando` · `aplicado` · `duplicado` · `rechazado`; `sales.status` ∈ `registrada` ·
`anulacion_solicitada` · `anulada`; `shifts.status` ∈ `abierto` · `cerrado`. Ningún registro de `outbox`, `sales` o `shifts` se borra en v1.

---

## 5. API Design

### Conventions

- **Base:** no hay API HTTP propia. El cliente llama funciones de Postgres vía PostgREST de Supabase: `POST {VITE_SUPABASE_URL}/rest/v1/rpc/<función>`
  (envuelto por `supabase.rpc()` dentro de `src/lib/backend.tsx`). Ninguna tabla acepta `INSERT/UPDATE/DELETE` de la API.
- **Respuesta:** el valor de retorno de la función (`jsonb`, `uuid`, `text` o `void`). **Error:** PostgREST devuelve el `message` del `raise exception`,
  que siempre tiene la forma `CODIGO: detalle legible`; `BackendError.code` = `CODIGO` (o `RED` si no hubo conexión).
- **Códigos de error** (cerrados): permisos `NO_AUTORIZADO`, `MFA_REQUERIDO` (SQLSTATE `42501` → HTTP 401/403); negocio (SQLSTATE `P0001` → HTTP 400):
  `CODIGO_INVALIDO`, `ETIQUETA_REQUERIDA`, `ROL_INVALIDO`, `SEGREGACION`, `NO_ENCONTRADO`, `NO_PENDIENTE`, `MOTIVO_REQUERIDO`, `LOTE_INVALIDO`,
  `TIPO_DESCONOCIDO`, `STAFF_INVALIDO`, `TURNO_YA_ABIERTO`, `TURNO_NO_ABIERTO`, `CONTEO_INVALIDO`, `VENTA_VACIA`, `TIPO_PEDIDO_INVALIDO`,
  `RECIBO_DUPLICADO`, `LINEA_INVALIDA`, `PRODUCTO_INVALIDO`, `TOTAL_INVALIDO`, `REFERENCIA_REQUERIDA`, `PAGO_INVALIDO`, `VENTA_NO_ENCONTRADA`,
  `ANULACION_INVALIDA`, `ITEM_INVALIDO`, `CANTIDAD_INVALIDA`, `LIBRAS_REQUERIDAS`, `STOCK_INSUFICIENTE`, `CORTE_INVALIDO`,
  `RECETA_INVALIDA`, `AJUSTE_INVALIDO`, `ORDEN_CIERRE`, `TURNOS_ABIERTOS`, `TRANSFERENCIAS_PENDIENTES`, `ANULACIONES_PENDIENTES`, `INGRESO_INVALIDO`,
  `PIN_INVALIDO`, `JUSTIFICACION_REQUERIDA`, `DIA_CERRADO`, `LISTA_INVALIDA`, `FISCAL_INACTIVO`, `FECHA_LIMITE_VENCIDA`, `RANGO_FISCAL_AGOTADO`,
  `YA_EXISTE`; inmutabilidad: `CODIGO_INMUTABLE`, `BITACORA_INMUTABLE`, `EVENTO_INMUTABLE`, `MOVIMIENTO_INMUTABLE`.
- **Validación:** en el servidor dentro de cada función (fuente de verdad); en el cliente con zod (`src/lib/env.ts`, `src/panel/forms.ts`) solo para
  dar errores tempranos.
- **Paginación:** `panel_list` devuelve como máximo 200 alertas abiertas; las demás listas están acotadas por rango de fechas (`p_from`/`p_to`,
  por defecto hoy). A ~150 ventas/día no hace falta cursor en v1.
- **Idempotencia:** `pos_push_events` por `(device_id, client_seq)` (reenvío → `duplicado`); `pos_claim_device` por código de un solo uso;
  `day_close_start` por `business_date`.
- **Límite de tasa:** el de Supabase Auth para inicio de sesión y TOTP; `pos_push_events` acepta 1–100 eventos por lote (la caja envía 25).

### Routes

| Método | Ruta (`/rest/v1/rpc/…`) | Qué hace | Auth | Límite |
|---|---|---|---|---|
| POST | `pos_claim_device` | Canjea un código y crea la caja | sesión sin identidad | código de 1 uso, 15 min |
| POST | `pos_pull_snapshot` | Catálogo, staff con hash de PIN, ajustes, contadores | caja activa | cada 5 min |
| POST | `pos_push_events` | Aplica eventos de la caja (tabla abajo) | caja activa | 1–100 eventos |
| POST | `panel_whoami` | Identidad y rol del panel | socio/supervisor, aal2 | — |
| POST | `my_pin_params` | Sal e iteraciones del PIN propio | socio/supervisor, aal2 | — |
| POST | `panel_summary` | Tablero por rango | socio/supervisor, aal2 | polling 60 s |
| POST | `panel_list` | Listas: alertas, transferencias/anulaciones pendientes, ventas, movimientos, cierres, cierre, stock, productos, recetas, staff, dispositivos | socio/supervisor, aal2 | — |
| POST | `verify_audit_chain` | Verifica la cadena de la bitácora | socio/supervisor, aal2 | — |
| POST | `create_pairing_code` · `set_device_active` | Emparejar / desactivar caja | supervisor, aal2 | — |
| POST | `upsert_staff` · `link_staff_by_email` | Personal y PIN (sal + hash) | supervisor, aal2 | — |
| POST | `confirm_transfer` · `reject_transfer` · `decide_void` · `ack_alert` | Decisiones | supervisor, aal2 | — |
| POST | `register_purchase` · `register_cut` · `upsert_recipe` · `set_item` | Inventario | supervisor, aal2 | — |
| POST | `set_product` · `create_product` · `set_setting` | Catálogo y ajustes | supervisor, aal2 | — |
| POST | `day_close_start` · `day_close_cash_count` · `day_close_inventory_count` · `day_close_deposit` · `day_close_finalize` | Cierre del día | supervisor, aal2 | — |
| — | `app.bootstrap_supervisor(email, nombre)` | Primer supervisor | solo SQL Editor (rol postgres) | 1 vez |
| — | `app.next_fiscal_number()` | Número fiscal `NNN-NNN-NN-NNNNNNNN` | interno (no expuesto) | — |

Storage: `POST /storage/v1/object/comprobantes/<ruta>` (fotos de compras y depósitos), solo supervisor `aal2` por política RLS.

### Eventos de la caja

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

### Critical endpoints — full detail

**`pos_push_events(p_events jsonb) → jsonb`** — el corazón de la sincronización (paso 5).
Identidad: `app.require_device()` (sesión de una caja activa; si no, `NO_AUTORIZADO` y no se procesa nada). Procesa el lote ordenado por `client_seq`;
por cada evento: si `(device_id, client_seq)` ya existe → `duplicado` (no se reaplica); si no, en un subbloque: valida `type` (`^[a-z_]{3,40}$` y que
exista `app.ev_<type>(uuid, jsonb)`), fija `app.actor_staff_id`, exige staff activo `cajero`/`supervisor`, ejecuta el manejador e inserta `pos_events`
`aplicado`. Cualquier error revierte solo ese evento, se guarda `pos_events` `rechazado` con el error y se crea la alerta `evento_rechazado`
(severidad alta). Al final actualiza `devices.last_client_seq` y `last_seen_at`. Efectos de `venta`: `sales`, `sale_lines` (con base e ISV por
línea), `payments`, movimientos de inventario por receta (trigger del paso 6), alertas `hueco_numeracion`, `precio_distinto`, `fuera_de_horario`.

**`pos_claim_device(p_code text, p_label text) → { device_id, label }`** — emparejamiento (paso 4). Requiere una sesión (`auth.uid()` no nulo) que
no sea ya staff ni caja (`NO_AUTORIZADO`). Busca `sha256(upper(trim(código)))` sin usar y vigente; si no, `CODIGO_INVALIDO` (mismo error para
inexistente, usado o vencido: no revela cuál). Crea `devices` y marca el código usado en la misma transacción.

**`confirm_transfer(p_payment_id) · reject_transfer(p_payment_id, p_reason) · decide_void(p_void_id, p_approve)`** — decisiones del supervisor
(paso 5). `app.require_panel(array['supervisor'])` (aal2). Solo actúan sobre pendientes (`NO_PENDIENTE`). `reject_transfer` exige motivo ≥ 5 y deja
la venta en `cobro_fallido` con alerta. `decide_void` rechaza si el decisor es quien pidió la anulación (`SEGREGACION`); aprobar → `anulada` y el
trigger del paso 6 devuelve el inventario exacto que se descontó; rechazar → restaura el estado previo.

**`day_close_finalize(p_date, p_pin_hash, p_justification) → z_report`** — firma del cierre (paso 7). Exige el cierre iniciado y con efectivo,
inventario e ingreso registrados (`ORDEN_CIERRE`), sin transferencias ni anulaciones pendientes del día (verificado en `day_close_deposit`),
`p_pin_hash` = `staff.pin_hash` del supervisor (`PIN_INVALIDO`) y, si `|contado − esperado| > cash_diff_threshold`, justificación de 10+
caracteres (`JUSTIFICACION_REQUERIDA`). Esperado = Σ fondos de los turnos del día + Σ pagos en efectivo de ventas no anuladas. Guarda
`z_report` (claves abajo), `z_hash`, `status = 'cerrado'`; desde ese momento `DIA_CERRADO` para todo cambio y toda anulación de ese día.

**`panel_summary(p_from, p_to) → jsonb`** — tablero (paso 7). Socio o supervisor `aal2`. Antes de responder crea la alerta `caja_sin_sincronizar`
si una caja activa no se ve desde hace `sync_stale_hours`. Devuelve `venta_total`, `recibos`, `ticket_promedio`, `por_hora`, `por_categoria`,
`por_forma_pago`, `diferencias_caja`, `merma_piezas`, `anulaciones`, `reimpresiones`, `aperturas_sin_venta`, `transferencias_pendientes`,
`anulaciones_pendientes`, `alertas_abiertas`, `cajas`.

### Reporte Z

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

---

## 6. Frontend Architecture

### Routes

| Ruta | Página | Fuente de datos | Auth |
|---|---|---|---|
| `/` | Inicio: "POLLO CHILERO" + enlaces Caja / Panel de socios | estática | pública |
| `/pos` | Flujo de caja: emparejar → ¿quién atiende? → abrir turno → venta (con cierre de turno y acciones de supervisor) | Dexie (`useLiveQuery`) + `sync.ts` | caja emparejada + PIN de cajero |
| `/pos/hardware` | Prueba de impresora y gaveta | navegador (Web Serial) | ninguna (no muestra datos) |
| `/panel` | Login → MFA → tablero | `panel_summary`, `panel_list` (TanStack Query) | socio/supervisor aal2 |
| `/panel/inventario` | Stock, compras, cortes, recetas | `panel_list('stock' \| 'recetas')` + RPC | supervisor (socio: solo stock) |
| `/panel/administracion` | Personal y PIN, cajas, productos, ajustes, bitácora | `panel_list` + RPC | supervisor |
| `/panel/cierre` | Asistente de cierre del día (5 pasos) | `panel_list('cierre')` + RPC `day_close_*` | supervisor |
| `/panel/reportes` | Reportes Z y exportes CSV | `panel_list('cierres' \| 'ventas' \| 'movimientos')` | socio/supervisor |

### Rendering strategy

SPA estática de Vite (`vite build` → `dist/`), sin renderizado en servidor. `vite-plugin-pwa` (modo `generateSW`, `registerType: "autoUpdate"`)
genera `dist/sw.js` que precachea `**/*.{js,css,html,svg}` y responde la navegación con `/index.html`: la caja abre y vende sin red después de la
primera carga. No hay rutas perezosas (todo en el bundle inicial) para que ninguna pantalla necesite descargar un trozo estando offline. Tampoco hay
importaciones diferidas: `src/lib/backend.tsx` importa estáticamente `@/lib/backend-impl`, y `vite.config.ts` resuelve ese alias según el modo —
`src/lib/backend-impl.ts` (Supabase) en producción, pruebas y humo; `src/lib/mock-backend.ts` solo con `--mode e2e-mock`—, así que el build de producción
nunca referencia el simulado (el Verify del paso 18 comprueba que `dist/` no contiene `mock-backend`). El panel sí
necesita red; muestra "Sin conexión" si `RED`.

### Component hierarchy

```
App (Routes; useBackend(kind) es un singleton sin contexto; /panel se envuelve en QueryClientProvider)
├── /pos → PosRoutes (estado: cajero activo en memoria; resto en Dexie)
│   ├── PairingScreen                  ← si !isPaired()
│   ├── CashierLogin (botones + PIN)   ← si no hay cajero
│   ├── OpenShiftScreen                ← si no hay turno abierto
│   └── Barra (SyncIndicator · Exportar respaldo · Cerrar turno · Acciones de supervisor · Cambiar cajero)
│       ├── SaleScreen › Pestañas · Cuadrícula · Carrito · Diálogo de cobro (NumPad) · ReceiptPrintView
│       ├── CloseShiftScreen (conteo ciego)
│       └── SupervisorActions (anulación · gaveta · consumo interno)
└── /panel → PanelRoutes
    └── PanelGuard (LoginScreen | MfaScreen | contexto { staffId, role })
        ├── DashboardPage (tarjetas · alertas · transferencias · anulaciones)
        ├── InventoryPage · AdminPage
        ├── DayCloseWizard › ZReportView
        └── Reportes (ZReportView + CSV)
```

### State management

- **Caja:** el estado durable vive en Dexie (`src/pos/db.ts`) y se lee con `useLiveQuery`; el cajero activo y el carrito son estado React (se pierden
  al recargar a propósito: se vuelve a pedir PIN). Ninguna escritura espera a la red.
- **Panel:** estado del servidor con TanStack Query (`refetchInterval: 60000` en tablero y listas, `invalidateQueries` tras cada mutación); formularios
  con estado local + zod (`src/panel/forms.ts`). Sin optimistic updates: toda decisión del supervisor se confirma en el servidor.
- **No va a estado global:** catálogo (Dexie es la fuente), sesión (la maneja Supabase Auth en cada cliente), totales (se derivan del carrito).

### Contrato Backend

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

### Loading, empty, and error states

| Superficie | Cargando | Vacío | Error |
|---|---|---|---|
| Emparejamiento | botón "Emparejando…" deshabilitado | — | "Código inválido o vencido" · "Sin conexión: el emparejamiento necesita internet" |
| ¿Quién atiende? | — (Dexie es local) | "No hay cajeros con PIN: pida al supervisor que los cree en el panel" | "Bloqueado 30 s" · "PIN incorrecto" |
| Venta | — | categoría sin productos activos: "Sin productos en esta categoría" | guardado fallido en Dexie: diálogo bloqueante "No se pudo guardar la venta; no entregue el pedido" |
| Indicador de sincronización | "Sincronizando…" | "0 pendientes" | "Sin conexión" (gris) · "Error" (rojo, con N rechazados) |
| Impresión | "Imprimiendo…" | — | "No se pudo imprimir por la impresora; se abrió la impresión del navegador" |
| Tablero del panel | esqueletos de tarjeta | "Sin ventas en el rango" · "Sin alertas abiertas" | "No se pudo cargar (Reintentar)"; `MFA_REQUERIDO` → pantalla TOTP |
| Listas (transferencias, anulaciones, stock, personal) | filas esqueleto | mensaje vacío propio de cada lista | `role="alert"` con el `code` traducido |
| Cierre del día | botón del paso deshabilitado con "Guardando…" | paso 3 sin pendientes: "Sin transferencias pendientes" | mensaje por código (`ORDEN_CIERRE`, `PIN_INVALIDO`, `JUSTIFICACION_REQUERIDA`, …) |

### Recibo de venta

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

### Factura SAR (preparada, apagada)

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

---

## 7. Design System

Producido desde `knowledge/capabilities/styling.md` (la skill `ui-ux-pro-max` no se ejecutó en la fase de diseño). Colores de la franquicia tomados
de fotos del menú **[SUPUESTO: confirmar con el arte oficial]**. Tema claro únicamente en v1 (la caja trabaja con luz de local y el panel es de
consulta rápida): la columna "Dark" repite el valor claro a propósito.

### Colors

| Token | Light | Dark | Uso |
|---|---|---|---|
| `--primary` | `#C8102E` | `#C8102E` | botones de acción, encabezados, anillo de foco |
| `--primary-fg` | `#FFFFFF` | `#FFFFFF` | texto sobre rojo |
| `--accent` | `#FFD200` | `#FFD200` | pestaña de categoría activa (texto `#1F1F1F`) |
| `--brand-orange` | `#F28C00` | `#F28C00` | solo encabezado/splash, con texto `#1F1F1F` |
| `--background` | `#F5F5F5` | `#F5F5F5` | página |
| `--surface` | `#FFFFFF` | `#FFFFFF` | tarjetas, paneles, diálogos |
| `--border` | `#D6D6D6` | `#D6D6D6` | divisores, campos |
| `--fg` | `#1F1F1F` | `#1F1F1F` | texto |
| `--fg-muted` | `#5C5C5C` | `#5C5C5C` | texto secundario |
| `--destructive` | `#B00020` | `#B00020` | errores, anular |
| `--success` | `#1E7B34` | `#1E7B34` | sincronizado, confirmado |
| `--warning` | `#8A5200` | `#8A5200` | sin conexión, pendiente |

**Contraste (WCAG 2.2 AA), calculado con la fórmula de luminancia relativa:** blanco sobre `#C8102E` **5.89:1** ✓; `#1F1F1F` sobre `#FFD200`
**11.35:1** ✓; `#5C5C5C` sobre `#F5F5F5` **6.13:1** ✓; blanco sobre `#1E7B34` 5.33:1 ✓; blanco sobre `#B00020` 7.33:1 ✓; `#1F1F1F` sobre `#F28C00`
6.69:1 ✓. **Dos ajustes respecto del brief:** (1) el amarillo de advertencia `#B26A00` daba 4.24:1 con blanco (falla AA para texto normal) → se fija
en `#8A5200` (6.39:1); (2) rojo sobre amarillo da 4.06:1 → solo se permite en texto grande (≥ 20 px negrita, criterio 3:1); la pestaña activa usa texto
`#1F1F1F`. Blanco sobre naranja (2.46:1) está prohibido.

Implementación: `src/index.css` `@theme` (`--color-primary`, `--color-primary-foreground`, `--color-accent`, `--color-accent-foreground`,
`--color-brand-orange`, `--color-background`, `--color-surface`, `--color-border`, `--color-foreground`, `--color-muted-foreground`,
`--color-success`, `--color-warning`, `--color-destructive`) → clases de Tailwind con el mismo nombre (`bg-primary`, `text-primary-foreground`, `border-border`, `text-muted-foreground`). Ningún componente usa hex directo.

### Typography

| Rol | Familia | Tamaño / interlineado | Peso | Tracking |
|---|---|---|---|---|
| Display (total de la venta) | `system-ui, "Segoe UI", Roboto, sans-serif` | 48 px / 1.1 (`text-5xl`) | 700 | -0.01em |
| Heading | igual | 24 px / 1.25 (`text-2xl`); 20 px pestañas | 700 | 0 |
| Body | igual | 16 px / 1.5; botones de producto 18 px | 400 (botones 700) | 0 |
| Mono (recibo) | `"Courier New", ui-monospace, monospace` | 12 px / 1.25 | 400 | 0 |

**Font loading:** solo fuentes del sistema; ninguna descarga (la caja debe funcionar offline y no hay `@font-face`).

### Spacing, radius, elevation

- Espaciado: base 4 px — escala Tailwind 1, 2, 3, 4, 6, 8, 12, 16 (4, 8, 12, 16, 24, 32, 48, 64 px). Botones de producto `min-h-18 min-w-18` (72 px), separación `gap-3`.
- Radio: botones `rounded-lg` (8 px), tarjetas y diálogos `rounded-xl` (12 px).
- Sombras: tarjetas `shadow-sm` (`0 1px 2px rgb(0 0 0 / 0.05)`); diálogos `shadow-lg` (`0 10px 15px -3px rgb(0 0 0 / 0.1)`); nada más.
- Ancho máximo: caja a pantalla completa (PC horizontal ≥ 1280 px: productos 2/3, carrito 1/3); panel `max-w-5xl`. Breakpoints Tailwind `sm 640`, `md 768`, `lg 1024`, `xl 1280`.

### Motion

150 ms `ease-out` en hover/press (solo `opacity` y `transform`), 200 ms al abrir diálogos; nada se anima en la ruta crítica de cobro. Todo respeta
`prefers-reduced-motion: reduce` (regla global en `src/index.css`).

### Component style

Función sobre forma: bloques grandes de color plano, texto negro o blanco con contraste alto, rojo de la marca para acciones y amarillo solo para
"lo seleccionado". Sin degradados, sin ilustraciones, sin animaciones decorativas. Un componente nuevo encaja si se puede tocar con el pulgar a
72 px, se lee a un metro de distancia y funciona igual con mouse, dedo y teclado. El panel sigue el estilo shadcn "new-york" sobre los mismos tokens.

---

## 8. Authentication & Authorization

### Provider and rationale

**Supabase Auth**, único proveedor de identidad (`knowledge/capabilities/auth.md`: auth de plataforma junto a su propia base → la sesión ya está
en el contexto de RLS). Tres identidades distintas: la **caja** (sesión Supabase de dispositivo), los **socios/supervisor** (email + contraseña +
TOTP) y los **cajeros** (sin cuenta Supabase; PIN local de 4 dígitos verificado en la caja y re-validado por rol en el servidor).

### Flows

- **Emparejar la caja (una vez):** el supervisor, en `/panel/administracion`, pulsa "Generar código" (`create_pairing_code`, 8 caracteres, vence en
  15 min, se guarda solo su sha256). En la PC de caja, `/pos` muestra "Emparejar esta caja": se ingresa el código → `signInAnonymously()` →
  `pos_claim_device` → la caja queda ligada a esa sesión; el refresh token persiste en IndexedDB/localStorage de Chrome y la caja no vuelve a pedir
  credenciales. **[PENDIENTE]** verificar que el inicio de sesión anónimo funcione con el registro público desactivado; **ruta alternativa sin
  cambiar código del servidor:** el supervisor invita en Supabase Auth un usuario `caja1@<dominio>` y en la caja se inicia sesión una vez con ese
  correo y contraseña antes de canjear el código (`pos_claim_device` acepta cualquier sesión que no sea staff ni caja).
  Desemparejar = `set_device_active(false)`: la RPC deja de aceptar esa sesión de inmediato.
- **Cajero:** ¿Quién atiende? (botones con nombres) → PIN de 4 dígitos → listo. Cambiar de cajero = 2 toques. El PIN se compara con
  `PBKDF2-SHA256(pin, sal, 210 000 iteraciones)` cacheado en Dexie; 5 fallos → bloqueo de 30 s de ese usuario y evento `pin_bloqueado`. Cada evento
  lleva `staff_id`; el servidor re-valida que ese staff esté activo y tenga el rol.
- **Socio/supervisor:** sin registro público. El supervisor invita el correo desde el panel de Supabase Auth (manual, §12) y lo vincula con
  `link_staff_by_email`. Inicio de sesión: correo + contraseña (aal1) → si no tiene TOTP: enrolar (QR) y verificar → aal2; si tiene: código de 6
  dígitos → aal2. Sin aal2, `panel_whoami` responde `MFA_REQUERIDO` y RLS devuelve 0 filas. Recuperar contraseña: "¿Olvidó su contraseña?" usa el
  correo de recuperación de Supabase. Cerrar sesión: botón en el panel (`signOut`). Expiración: tokens de Supabase (1 h, con refresco automático).
  Baja de un socio: `upsert_staff(..., p_active = false)` → `app.panel_staff_id` deja de devolverlo en la siguiente llamada.
- **Primer supervisor:** se invita su correo en Supabase Auth y se ejecuta una vez en el SQL Editor `select app.bootstrap_supervisor('correo-del-supervisor@dominio.hn', 'Nombre del supervisor');` con el correo invitado y el nombre reales.

### Route protection

| Superficie | Regla | Dónde se aplica |
|---|---|---|
| Todas las tablas `public` | sin INSERT/UPDATE/DELETE para `anon`/`authenticated`; SELECT solo si `app.is_panel_reader()` (socio/supervisor activo con aal2) | `20261122000200_seguridad.sql` (`app.secure_table`) |
| RPC de la caja (`pos_pull_snapshot`, `pos_push_events`) | sesión ligada a un `devices` activo | `app.require_device()` |
| RPC de lectura del panel | socio o supervisor, aal2 | `app.require_panel(array['socio','supervisor'])` |
| RPC de decisión/administración/cierre | supervisor, aal2 | `app.require_panel(array['supervisor'])` |
| Storage `comprobantes` | subir: supervisor aal2; leer: panel aal2 | políticas en `20261122000400_inventario.sql` |
| `/panel/*` (UI) | `PanelGuard` | `src/panel/PanelGuard.tsx` (cosmético) |
| `/pos` (UI) | emparejada + cajero con PIN | `src/pos/PosRoutes.tsx` (cosmético) |

**Regla de aplicación:** la autorización se verifica en el servidor en cada llamada. Las guardas de React son cosméticas; un botón oculto no es un permiso.

### Roles and permissions

| Rol | Puede | No puede |
|---|---|---|
| `cajero` | vender, cobrar, abrir/cerrar su turno (con aprobación), solicitar anulación, abrir gaveta con motivo, pedir consumo interno | aprobar nada, cambiar precios, ver el esperado antes de contar, usar el panel |
| `supervisor` (socio) | todo lo del cajero en caja; aprobar anulaciones, fondo y consumo interno de **otros**; compras, cortes, recetas, conteos, cierre del día, precios, personal, cajas, confirmar/rechazar transferencias, reconocer alertas | aprobar su propia solicitud (`SEGREGACION`), desactivarse a sí mismo, editar ventas, eventos, movimientos o la bitácora |
| `socio` | ver tablero, listas, reportes Z, CSV y verificar la bitácora | cualquier escritura |
| `pos_device` (sesión de la caja, en `devices`) | descargar la instantánea y enviar eventos | leer tablas del panel, llamar RPC de panel |

### Sessions

Tokens JWT de Supabase Auth en `localStorage` del navegador, con claves separadas `pc-pos-auth` (caja) y `pc-panel-auth` (panel) para que abrir el
panel en la PC de caja no reemplace la sesión del dispositivo. Duración del access token 1 h con refresco automático; sin cookies (no hay servidor
propio), por lo que no aplica CSRF: cada RPC lleva el JWT en `Authorization`. aal2 obligatorio para el panel.

### Multi-tenancy / row-level isolation

Un solo local en v1: no hay inquilinos. El aislamiento es por **rol**, aplicado por RLS (`panel_lectura` en cada tabla) y por las funciones
`SECURITY DEFINER` (`app.require_device` / `app.require_panel`), nunca por filtros en el cliente. `location_id` en `devices` deja lista la extensión
a varios locales (non-goal v1).

---
## 9. BUILD ORDER

**Esta es la sección para la que existe el blueprint.** Un builder que sigue el §9 exactamente y se detiene cuando cada gate está en verde
entrega el proyecto. En modo bundle, cada paso es también una tarea de `tasks.json` y un bloque de tarea de su epic (`epics/*.md`); el builder
reanuda con `tasks.json` y ejecuta cada tarea leyendo solo su epic.

### Reglas de un paso

1. **Una sesión por paso:** máximo 5 archivos y 2–6 criterios de aceptación por paso (los mismos límites que `tasks-schema` y el validador).
2. **Cuatro campos siempre:** `Do`, `Done when`, `Verify`, `Checkpoint`. El Checkpoint es un bloque de shell literal: commit + `git tag step-NN-<slug>`.
3. **"Done when" es observable y decidible por un comando**, en forma EARS en español: **CUANDO** `<disparador>` **EL SISTEMA DEBERÁ** `<respuesta observable>`.
4. Prohibido "se ve bien", "funciona", "está implementado". Cada criterio nombra un número, un texto, un código de error o un código de salida.
5. **`Verify` es shell literal (Git Bash)** que sale con 0 si el paso es correcto. Lo que no se puede comprobar con un comando va a §20.1.
6. Un paso termina cuando pasan su `Verify` **y** los de los pasos anteriores (por eso cada `Verify` re-ejecuta las suites completas).
7. **Checkpoint en cada paso**; si el paso siguiente sale mal: `git reset --hard <tag del paso anterior>` y reintentar.
8. **Nunca adelantarse:** si el paso 7 se bloquea, se detiene y se reporta.
9. **Ningún paso rompe el gate de uno anterior.** Las variables de entorno se exigen solo desde el paso que indica §10 (todas desde el paso 8, cuando
   nace `src/lib/env.ts`, y los archivos `.env.test`/`.env.e2e` versionados ya las traen); las reglas de lint/formato existen desde el paso 1; las
   pruebas de propiedad SQL (RLS, bitácora, privilegios) nacen en los pasos 3–4 y obligan a toda migración posterior a llamar `app.secure_table`.
10. **Números derivados contados, no supuestos:** 59 productos, 6 categorías y 42 ítems salen del archivo del Excel (`productos.tsv`), suma de precios
    L 6,667.00; el resto de los gates afirman propiedades ("toda tabla tiene RLS", "0 fallidas"), no conteos.
11. **Un `Verify` sale con 0 cuando el paso es correcto.** Única verificación de un código distinto de 0: la búsqueda de `.skip(`/`.only(`, escrita
    `status=0; grep … || status=$?; test "$status" -eq 1` (1 = sin coincidencias; 2 = error de grep, que hace fallar el gate).
12. **Cada verificación es posible en su medio:** los permisos se prueban con `has_table_privilege` y `set local role` en PGlite (no con la UI); los
    bytes ESC/POS con la salida del codificador (no con la impresora); el diseño táctil de 72 px con las clases `min-h-18 min-w-18` en el DOM de
    jsdom (que no calcula layout); la impresión física y la gaveta van a §20.1.
13. **El primer artefacto ejecutable se ejecuta en el paso que lo crea:** el paso 1 sirve el build de producción y lo abre con Playwright
    (`e2e/smoke.spec.ts`); desde entonces cada paso de UI re-ejecuta esa prueba de humo.
14. **Ningún `Verify` depende de su propio Checkpoint:** las comprobaciones de "archivo versionado" (`git ls-files --error-unmatch`) están en el bloque
    Checkpoint, después del commit; `Verify` comprueba el disco (`test -f`) y las pruebas.
15. **Sin salidas byte-exactas escritas por adelantado:** el recibo, el Z y la factura se prueban por contenido y ancho de línea; la única
    subsecuencia de bytes que se afirma (ESC/POS) figura en §19.6 *Byte-exact artifact reconciliation* con su comando de verificación.
16. **Un gate falla por la razón que dice:** ninguna verificación acepta "cualquier código distinto de 0"; no hay `!` ni `test $? -ne 0`.

### One step, one unit — the counting rule

> **Un paso del §9 = una tarea de `tasks.json` = un bloque de tarea en un epic.** 18 pasos → 18 tareas → 3 epics de 6 pasos cada uno
> (legal para 15–18 pasos: 2 o 3 epics de 5–9).

### Mapa de pasos

| # | Paso | Tarea | Depende de | Toca | Gate |
|---|---|---|---|---|---|
| 1 | Andamiaje, toolchain y gates con prueba de humo | `E1-T1` | — | `src/App.tsx`<br>`src/pos/PosRoutes.tsx`<br>`src/panel/PanelRoutes.tsx`<br>`src/App.test.tsx`<br>`e2e/smoke.spec.ts` | `npm run typecheck` |
| 2 | Prueba temprana de impresora térmica y gaveta | `E1-T2` | 1 | `src/pos/print/escpos.ts`<br>`src/pos/print/serial.ts`<br>`src/pos/print/HardwareTestPage.tsx`<br>`src/pos/PosRoutes.tsx`<br>`src/pos/print/hardware.test.tsx` | `npm run test -- src/pos/print/hardware.test.tsx` |
| 3 | Esquema base, bitácora con hash y catálogo de 59 productos | `E1-T3` | 1 | `supabase/migrations/20261122000100_esquema_base.sql`<br>`supabase/migrations/20261122000110_catalogo_inicial.sql`<br>`supabase/tests/esquema.test.ts`<br>`supabase/tests/catalogo.test.ts`<br>`supabase/tests/bitacora.test.ts` | `npm run test:db -- supabase/tests/esquema.test.ts supabase/tests/catalogo.test.ts supabase/tests/bitacora.test.ts` |
| 4 | Seguridad de BD: REVOKE, RLS con MFA y emparejamiento | `E1-T4` | 3 | `supabase/migrations/20261122000200_seguridad.sql`<br>`supabase/tests/fixtures.ts`<br>`supabase/tests/seguridad.test.ts` | `npm run test:db -- supabase/tests/seguridad.test.ts` |
| 5 | Ventas, pagos, anulaciones y pos_push_events idempotente | `E1-T5` | 4 | `supabase/migrations/20261122000300_ventas.sql`<br>`supabase/tests/fixtures.ts`<br>`supabase/tests/ventas.test.ts` | `npm run test:db -- supabase/tests/ventas.test.ts` |
| 6 | Inventario por receta: compras, cortes, conteos y merma | `E1-T6` | 5 | `supabase/migrations/20261122000400_inventario.sql`<br>`supabase/tests/inventario.test.ts` | `npm run test:db -- supabase/tests/inventario.test.ts` |
| 7 | Cierre del día, reporte Z, panel y SAR preparado apagado | `E2-T1` | 6 | `supabase/migrations/20261122000500_cierre_dia.sql`<br>`supabase/migrations/20261122000600_fiscal.sql`<br>`supabase/tests/cierre.test.ts`<br>`supabase/tests/fiscal.test.ts` | `npm run test:db -- supabase/tests/cierre.test.ts supabase/tests/fiscal.test.ts` |
| 8 | App shell: env validado, backend y utilidades | `E2-T2` | 1, 3 | `src/lib/env.ts`<br>`src/lib/backend.tsx`<br>`src/lib/backend-impl.ts`<br>`src/lib/utils.ts`<br>`src/lib/backend.test.tsx` | `npm run test -- src/lib/backend.test.tsx` |
| 9 | Emparejamiento de la caja, Dexie e instantánea | `E2-T3` | 2, 4, 8 | `src/pos/db.ts`<br>`src/pos/device.ts`<br>`src/pos/PairingScreen.tsx`<br>`src/pos/PosRoutes.tsx`<br>`src/pos/device.test.ts` | `npm run test -- src/pos/device.test.ts` |
| 10 | Selector de cajero, PIN PBKDF2 y outbox | `E2-T4` | 9 | `src/lib/pin.ts`<br>`src/pos/outbox.ts`<br>`src/pos/CashierLogin.tsx`<br>`src/pos/PosRoutes.tsx`<br>`src/pos/pin-outbox.test.tsx` | `npm run test -- src/pos/pin-outbox.test.tsx` |
| 11 | Turno en caja: fondo, cierre ciego y acciones de supervisor | `E2-T5` | 10, 5 | `src/pos/shift.ts`<br>`src/pos/ShiftScreens.tsx`<br>`src/pos/SupervisorActions.tsx`<br>`src/pos/PosRoutes.tsx`<br>`src/pos/shift.test.tsx` | `npm run test -- src/pos/shift.test.tsx` |
| 12 | Pantalla de venta táctil con pagos y recibo correlativo | `E2-T6` | 11 | `src/pos/cart.ts`<br>`src/pos/NumPad.tsx`<br>`src/pos/SaleScreen.tsx`<br>`src/pos/PosRoutes.tsx`<br>`src/pos/sale.test.tsx` | `npm run test -- src/pos/sale.test.tsx` |
| 13 | Motor de sincronización, indicador y respaldo de emergencia | `E3-T1` | 12 | `src/pos/sync.ts`<br>`src/pos/SyncIndicator.tsx`<br>`src/pos/emergency-export.ts`<br>`src/pos/PosRoutes.tsx`<br>`src/pos/sync.test.tsx` | `npm run test -- src/pos/sync.test.tsx` |
| 14 | Recibo de 80 mm, impresión y reimpresión COPIA | `E3-T2` | 13 | `src/pos/print/receipt.ts`<br>`src/pos/print/print-service.ts`<br>`src/pos/print/ReceiptPrintView.tsx`<br>`src/pos/SaleScreen.tsx`<br>`src/pos/print/receipt.test.ts` | `npm run test -- src/pos/print/receipt.test.ts` |
| 15 | Panel: login, MFA TOTP, tablero y decisiones pendientes | `E3-T3` | 7, 8 | `src/panel/PanelRoutes.tsx`<br>`src/panel/AuthScreens.tsx`<br>`src/panel/PanelGuard.tsx`<br>`src/panel/DashboardPage.tsx`<br>`src/panel/panel-access.test.tsx` | `npm run test -- src/panel/panel-access.test.tsx` |
| 16 | Panel: inventario, recetas, personal y emparejamiento | `E3-T4` | 15, 6 | `src/panel/InventoryPage.tsx`<br>`src/panel/AdminPage.tsx`<br>`src/panel/forms.ts`<br>`src/panel/PanelRoutes.tsx`<br>`src/panel/panel-ops.test.tsx` | `npm run test -- src/panel/panel-ops.test.tsx` |
| 17 | Panel: asistente de cierre ciego, reporte Z y CSV | `E3-T5` | 16 | `src/panel/DayCloseWizard.tsx`<br>`src/panel/ZReportView.tsx`<br>`src/lib/csv.ts`<br>`src/panel/PanelRoutes.tsx`<br>`src/panel/dayclose.test.tsx` | `npm run test -- src/panel/dayclose.test.tsx` |
| 18 | Endurecimiento: plantilla de factura, cabeceras y e2e | `E3-T6` | 14, 17 | `src/lib/mock-backend.ts`<br>`src/lib/fiscal-invoice.ts`<br>`public/_headers`<br>`e2e/flujos.spec.ts`<br>`src/lib/hardening.test.ts` | `npm run test -- src/lib/hardening.test.ts` |

Agrupación en epics (§9, regla de conteo: 18 pasos → 3 epics de 6): `epics/01-fundacion-datos.md` = pasos 1, 2, 3, 4, 5, 6 · `epics/02-cierre-y-caja.md` = pasos 7, 8, 9, 10, 11, 12 · `epics/03-operacion-panel-salida.md` = pasos 13, 14, 15, 16, 17, 18.

---

#### Paso 1 — Andamiaje, toolchain y gates con prueba de humo

Tarea `E1-T1` · epic `01-fundacion-datos` · prioridad `p0` · checkpoint `step-01-andamiaje`

**Do**

Los archivos de configuración ya están en la raíz (copia de `workspace/` hecha por el Bootstrap de §10):
`package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `vitest.db.config.ts`,
`playwright.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `index.html`,
`src/main.tsx`, `src/index.css`, `src/test/setup.ts`, `supabase/tests/shim.sql`, `supabase/tests/harness.ts`,
`public/icon.svg`. **No los edite en este paso** salvo lo que haga `npm run format`.

1. Ejecute `npm run e2e:install` (descarga Chromium para Playwright; en Linux/CI use `npx playwright install --with-deps chromium`).
2. Cree `src/App.tsx`: exporta por defecto `App`, que solo declara `<Routes>` (el `BrowserRouter` vive en `src/main.tsx`):
   - `/` → `<main>` con `<h1>POLLO CHILERO</h1>`, subtítulo "Orgullo Catracho" y dos enlaces grandes: "Caja" → `/pos` y "Panel de socios" → `/panel`.
   - `/pos/*` → `<PosRoutes />` · `/panel/*` → `<PanelRoutes />` · `*` → `<Navigate to="/" replace />`.
3. Cree `src/pos/PosRoutes.tsx` (export nombrado `PosRoutes`): `<Routes>` con `index` → `<main><h1>Caja</h1>…</main>` (texto "Caja lista para configurarse").
4. Cree `src/panel/PanelRoutes.tsx` (export nombrado `PanelRoutes`): `index` → `<main><h1>Panel de socios</h1>…</main>`.
5. Cree `src/App.test.tsx`: renderiza `<MemoryRouter initialEntries={[ruta]}><App /></MemoryRouter>` para `/`, `/pos` y `/panel` y verifica con `getByRole("heading", { level: 1, name: /…/ })` los encabezados `POLLO CHILERO`, `Caja` y `Panel de socios`.
6. Cree `e2e/smoke.spec.ts` (proyecto `smoke`, puerto 4173): para cada ruta `/`, `/pos`, `/panel` hace `page.goto(ruta)` y `expect(page.getByRole("heading", { level: 1, name: /POLLO CHILERO|Caja|Panel de socios/ }))` con el nombre exacto que corresponde a cada ruta (regex `/POLLO CHILERO/`, `/Caja/`, `/Panel de socios/`).
7. Ejecute `npm run format` una vez (reconcilia el formato de los archivos copiados con `.prettierrc.json`; la fuente de estilo es ese archivo, no el valor por defecto de Prettier).

Usa clases de Tailwind con los tokens de `src/index.css` (`bg-primary text-primary-foreground`, `bg-background`, `text-foreground`).

Archivos que crea o modifica este paso: `src/App.tsx`, `src/pos/PosRoutes.tsx`, `src/panel/PanelRoutes.tsx`, `src/App.test.tsx`, `e2e/smoke.spec.ts`.

**Done when**

- [ ] **CUANDO** se ejecuta `npm run typecheck` **EL SISTEMA DEBERÁ** salir con código 0 con `strict: true` en `tsconfig.json`.
- [ ] **CUANDO** se ejecutan `npm run lint` y `npm run format:check` desde la raíz con el bundle presente en `blueprints/` **EL SISTEMA DEBERÁ** salir con código 0 en ambos.
- [ ] **CUANDO** se ejecuta `npm run test` **EL SISTEMA DEBERÁ** ejecutar `src/App.test.tsx` y salir con código 0 con 0 pruebas fallidas.
- [ ] **CUANDO** se ejecuta `npm run build` **EL SISTEMA DEBERÁ** generar `dist/index.html` y `dist/sw.js` y salir con código 0.
- [ ] **CUANDO** `npm run e2e -- e2e/smoke.spec.ts` sirve el build de producción y abre `/`, `/pos` y `/panel` **EL SISTEMA DEBERÁ** mostrar los encabezados de nivel 1 `POLLO CHILERO`, `Caja` y `Panel de socios` y salir con código 0.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
test -f dist/index.html
test -f dist/sw.js
npm run e2e -- e2e/smoke.spec.ts
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T1 paso 1: andamiaje"
git tag step-01-andamiaje
git ls-files --error-unmatch package-lock.json   # expect: exit 0 — versionado por el commit de arriba
git ls-files --error-unmatch src/App.tsx   # expect: exit 0 — versionado por el commit de arriba
```

---

#### Paso 2 — Prueba temprana de impresora térmica y gaveta

Tarea `E1-T2` · epic `01-fundacion-datos` · prioridad `p0` · checkpoint `step-02-hardware-impresora`

**Do**

Objetivo: saber **antes de construir la caja** si la Nenotech ITP250 imprime por Web Serial, con un respaldo que siempre funciona
(`window.print()`). La gaveta **no** tiene conexión con el sistema y se abre a mano (decisión del usuario, 2026-11-23): no se envía pulso.

1. Antes de escribir código lea `node_modules/@point-of-sale/receipt-printer-encoder/README.md` y su
   `dist/receipt-printer-encoder.d.ts` (export por defecto `ReceiptPrinterEncoder`; métodos verificados
   en el `.d.ts` publicado 4.0.1: `initialize()`, `codepage()`, `line()`, `text()`, `newline()`, `bold()`,
   `align()`, `size()`, `table()`, `cut()`, `pulse(device?, on?, off?)`, `encode(): Uint8Array`; opciones
   `{ language: "esc-pos", columns: 48 }`).
2. `src/pos/print/escpos.ts`: `createEncoder(columns = 48)`; `encodeLines(lines: string[], opts: { cut: boolean }): Uint8Array`
   (initialize → `codepage("auto")` → cada línea → `cut("partial")`; **sin `pulse()`: la gaveta se abre a mano** — decisión del usuario 2026-11-23);
   `buildTestTicket(): Uint8Array` (líneas "POLLO CHILERO", "PRUEBA DE IMPRESORA", fecha local, "Ñandú áéíóú — L 1,234.50", 48 guiones) con corte;
3. `src/pos/print/serial.ts`: tipos mínimos propios (`SerialPortLike` con `open({ baudRate })`, `writable`, `close()`), sin depender de tipos DOM de Web Serial;
   `isWebSerialSupported()` (`"serial" in navigator`); `requestPrinterPort()` (gesto del usuario, `navigator.serial.requestPort()`);
   `getRememberedPort()` (`navigator.serial.getPorts()` → primero); `writeBytes(port, bytes, baudRate = 9600)` (abre si hace falta, escribe con `writer.write`, libera el lock).
4. `src/pos/print/HardwareTestPage.tsx` con `<h1>Caja — Prueba de impresora</h1>`: estado de soporte Web Serial; selector de baudios 9600/19200/38400/115200;
   botones "Emparejar impresora (Web Serial)" e "Imprimir ticket de prueba" (deshabilitados sin soporte o sin puerto) y
   "Imprimir con el navegador (respaldo)" que renderiza un `<pre className="receipt-80mm">` con el ticket y llama `window.print()`. Errores visibles en `role="alert"`.
5. `src/pos/PosRoutes.tsx`: agrega la ruta `hardware` → `<HardwareTestPage />` y un enlace "Prueba de impresora" en la pantalla índice.
6. `src/pos/print/hardware.test.tsx`: (a) los bytes de `buildTestTicket()` contienen la subsecuencia `1b 40` (ESC @) y `1d 56` (GS V);
   (b) los bytes de `buildTestTicket()` NO contienen `1b 70` (ESC p: la gaveta se abre a mano); (c) sin `navigator.serial`, `isWebSerialSupported()` es `false` y la página
   renderiza el botón "Imprimir con el navegador (respaldo)" habilitado, y al pulsarlo llama `window.print` (espía con `vi.spyOn(window, "print").mockImplementation(() => {})`).

La prueba física con la ITP250 (ticket impreso, gaveta abierta) no es un gate: está en §20.1.

Archivos que crea o modifica este paso: `src/pos/print/escpos.ts`, `src/pos/print/serial.ts`, `src/pos/print/HardwareTestPage.tsx`, `src/pos/PosRoutes.tsx`, `src/pos/print/hardware.test.tsx`.

**Done when**

- [ ] **CUANDO** `npm run test -- src/pos/print/hardware.test.tsx` codifica el ticket de prueba **EL SISTEMA DEBERÁ** producir bytes que contienen la inicialización ESC @ (`1b 40`) y el corte GS V (`1d 56`).
- [ ] **CUANDO** se codifica el ticket de prueba **EL SISTEMA NO DEBERÁ** incluir el pulso de gaveta ESC p (`1b 70`), porque la gaveta no tiene conexión con el sistema y se abre a mano.
- [ ] **CUANDO** `navigator.serial` no existe **EL SISTEMA DEBERÁ** devolver `false` en `isWebSerialSupported()` y la página `/pos/hardware` DEBERÁ mostrar habilitado el botón "Imprimir con el navegador (respaldo)".
- [ ] **CUANDO** se pulsa "Imprimir con el navegador (respaldo)" **EL SISTEMA DEBERÁ** renderizar el ticket en un elemento con la clase `receipt-80mm` y llamar `window.print()` una vez.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

```bash
npm run test -- src/pos/print/hardware.test.tsx
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T2 paso 2: hardware-impresora"
git tag step-02-hardware-impresora
git ls-files --error-unmatch src/pos/print/escpos.ts   # expect: exit 0 — versionado por el commit de arriba
```

---

#### Paso 3 — Esquema base, bitácora con hash y catálogo de 59 productos

Tarea `E1-T3` · epic `01-fundacion-datos` · prioridad `p0` · checkpoint `step-03-esquema-catalogo`

**Do**

1. Cree `supabase/migrations/20261122000100_esquema_base.sql` con el contenido literal del bloque **M-0100** (§4).
2. Cree `supabase/migrations/20261122000110_catalogo_inicial.sql` con el contenido literal del bloque **M-0110** (§4): 59 productos con código
   permanente `CAT-NNN` y `legacy_code` del Excel, 6 categorías, 42 ítems de inventario, recetas de todos los productos y los ajustes iniciales.
3. `supabase/tests/esquema.test.ts` (usa `createTestDb()` de `./harness` en `beforeAll`):
   - cada tabla de esta etapa existe: `select to_regclass('public.<t>') is not null` para `locations`, `categories`, `products`, `inventory_items`,
     `recipes`, `staff`, `devices`, `pairing_codes`, `settings`, `alerts`, `audit_log`;
   - **propiedad que se re-ejecuta en todos los pasos siguientes:** ninguna tabla de `public` (relkind `r`) distinta de `audit_log` carece del trigger `audit_row`
     (consulta sobre `pg_trigger`/`pg_class`/`pg_namespace`; el resultado debe ser 0 filas);
   - `delete from products where code = 'CF-001'` y `update products set code = 'CF-999' where code = 'CF-001'` fallan con mensaje que empieza por `CODIGO_INMUTABLE`.
4. `supabase/tests/catalogo.test.ts`: 59 productos activos; todos los `code` cumplen `^(CF|CP|PZ|CI|EX|BE)-[0-9]{3}$`; `legacy_code` únicos y no nulos;
   recetas de `PZ-001…PZ-005` = (ALA, PIERNA, MUSLO, PECHUGA) (1,1,1,1), (2,2,1,1), (2,2,2,2), (3,3,3,3), (6,6,6,6); cada `BE-NNN` tiene receta 1:1 con el ítem
   `BE-NNN`; `CF-001` descuenta MUSLO 2, PIERNA 1, ALA 1, PAPA-PERS 1, BE-008 1; todo producto tiene al menos una línea de receta;
   **paridad con el Excel:** `select sum(price) from products` = 6667.00 (suma de la columna "Precio final" de las 59 filas del Excel) y
   `CF-001` = 209.00 con `legacy_code` `P001`, `BE-027` = 20.00 con `legacy_code` `P0059`.
5. `supabase/tests/bitacora.test.ts`: `update products set price = 210 where code = 'CF-001'` inserta exactamente 1 fila nueva en `audit_log` con `action = 'UPDATE'`,
   `before ->> 'price' = '209.00'`, `after ->> 'price' = '210.00'`; `select * from app.audit_chain_check()` devuelve `ok = true`;
   `update audit_log set after = '{}'` falla con `BITACORA_INMUTABLE`; con `alter table public.audit_log disable trigger audit_log_inmutable` se altera la fila
   anterior, se rehabilita el trigger y `app.audit_chain_check()` devuelve `ok = false` con `first_bad_id` igual al id alterado.

Las pruebas corren como superusuario de PGlite (las de rol llegan en el paso 4).

Archivos que crea o modifica este paso: `supabase/migrations/20261122000100_esquema_base.sql`, `supabase/migrations/20261122000110_catalogo_inicial.sql`, `supabase/tests/esquema.test.ts`, `supabase/tests/catalogo.test.ts`, `supabase/tests/bitacora.test.ts`.

**Done when**

- [ ] **CUANDO** `npm run test:db` aplica `supabase/tests/shim.sql` y todas las migraciones en PGlite **EL SISTEMA DEBERÁ** salir con código 0 y existir las tablas `locations`, `categories`, `products`, `inventory_items`, `recipes`, `staff`, `devices`, `pairing_codes`, `settings`, `alerts` y `audit_log`.
- [ ] **CUANDO** se consulta `products` tras las migraciones **EL SISTEMA DEBERÁ** contener exactamente 59 productos activos, cada uno con `code` que cumple `^(CF|CP|PZ|CI|EX|BE)-[0-9]{3}$` y un `legacy_code` único.
- [ ] **CUANDO** se leen las recetas de `PZ-001`, `PZ-002`, `PZ-003`, `PZ-004` y `PZ-005` **EL SISTEMA DEBERÁ** devolver (ALA, PIERNA, MUSLO, PECHUGA) = (1,1,1,1), (2,2,1,1), (2,2,2,2), (3,3,3,3) y (6,6,6,6).
- [ ] **CUANDO** se intenta `DELETE` de un producto o `UPDATE` de su `code` **EL SISTEMA DEBERÁ** rechazarlo con un error cuyo mensaje empieza por `CODIGO_INMUTABLE`.
- [ ] **CUANDO** se actualiza el precio de `CF-001` **EL SISTEMA DEBERÁ** insertar exactamente una fila en `audit_log` con `before` y `after`, y `app.audit_chain_check()` DEBERÁ devolver `ok = true`.
- [ ] **CUANDO** una fila de `audit_log` se altera con el trigger `audit_log_inmutable` deshabilitado **EL SISTEMA DEBERÁ** hacer que `app.audit_chain_check()` devuelva `ok = false` con el `first_bad_id` de esa fila, y un `UPDATE` normal sobre `audit_log` DEBERÁ fallar con `BITACORA_INMUTABLE`.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

```bash
npm run test:db -- supabase/tests/esquema.test.ts supabase/tests/catalogo.test.ts supabase/tests/bitacora.test.ts
npm run test:db
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T3 paso 3: esquema-catalogo"
git tag step-03-esquema-catalogo
git ls-files --error-unmatch supabase/migrations/20261122000110_catalogo_inicial.sql   # expect: exit 0 — versionado por el commit de arriba
```

---

#### Paso 4 — Seguridad de BD: REVOKE, RLS con MFA y emparejamiento

Tarea `E1-T4` · epic `01-fundacion-datos` · prioridad `p0` · checkpoint `step-04-seguridad`

**Do**

1. Cree `supabase/migrations/20261122000200_seguridad.sql` con el contenido literal del bloque **M-0200** (§4).
2. Cree `supabase/tests/fixtures.ts` (solo superusuario; usa `PGlite` del arnés):
   - `panelUser(db, role: "socio" | "supervisor", opts?: { pin?: { salt: string; hash: string } })` → inserta `auth.users` (email `<uuid>@prueba.hn`) y un `staff`
     ligado; devuelve `{ staffId, uid, claims(aal: "aal1" | "aal2") }`;
   - `cashier(db, name, pin?: { salt, hash })` y `supervisorStaff(db, name, pin?)` → `staff` sin usuario de panel; devuelven el id;
   - `device(db, label = "Caja 1")` → inserta `auth.users` anónimo y `devices` ligado; devuelve `{ deviceId, uid, claims }` (claims `{ sub: uid }`);
   - `anonUser(db)` → `auth.users` anónimo sin identidad; devuelve `{ uid, claims }`.
   Sal/hash de prueba: cadenas hex válidas (`"0".repeat(32)`, `"a".repeat(64)`); la BD no verifica PBKDF2.
3. `supabase/tests/seguridad.test.ts` con `asRole()` y `dbFailure()` de `./harness`:
   - **Propiedades (se re-ejecutan en cada paso posterior):** toda tabla de `public` tiene `relrowsecurity = true`; para toda tabla o vista de `public`,
     `has_table_privilege('anon', oid, 'SELECT')`, `'INSERT'`, `'UPDATE'` y `'DELETE'` son falsos; para toda tabla,
     `has_table_privilege('authenticated', oid, 'INSERT')`, `'UPDATE'` y `'DELETE'` son falsos; para toda función de `public`,
     `has_function_privilege('anon', oid, 'EXECUTE')` es falso; en el esquema `app` las únicas funciones ejecutables por `authenticated` son
     `is_panel_reader` e `is_panel_supervisor`.
   - `authenticated` haciendo `insert into products …`, `update staff …` o `delete from audit_log` → `code = '42501'`.
   - socio con `aal1` → `select count(*) from products` = 0; con `aal2` = 59.
   - supervisor `aal2` llama `create_pairing_code('Caja 1')` → `{ code, expires_at }` (8 caracteres del alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789`);
     un `anonUser` hace `pos_claim_device(code)` → crea 1 `devices` activo con su `auth_user_id`; otro `anonUser` con el mismo código → `CODIGO_INVALIDO`.
   - el dispositivo llama `pos_pull_snapshot(0)` → `unchanged = false`, 59 `products`, 6 `categories`, `settings.cash_diff_threshold = 50`, y `staff` incluye
     `pin_hash` de un cajero con PIN; `pos_pull_snapshot(<version>)` → `unchanged = true`; un usuario de panel llamando `pos_pull_snapshot` → `NO_AUTORIZADO`.
   - socio `aal2` llama `create_pairing_code` o `upsert_staff` → `NO_AUTORIZADO`; `panel_whoami()` con `aal1` → `MFA_REQUERIDO`.

Archivos que crea o modifica este paso: `supabase/migrations/20261122000200_seguridad.sql`, `supabase/tests/fixtures.ts`, `supabase/tests/seguridad.test.ts`.

**Done when**

- [ ] **CUANDO** se ejecuta `npm run test:db` **EL SISTEMA DEBERÁ** comprobar que toda tabla de `public` tiene RLS habilitado y que `anon` no tiene SELECT, INSERT, UPDATE ni DELETE sobre ninguna tabla o vista, ni EXECUTE sobre ninguna función de `public`.
- [ ] **CUANDO** el rol `authenticated` intenta `INSERT`, `UPDATE` o `DELETE` directo sobre `products`, `staff` o `audit_log` **EL SISTEMA DEBERÁ** fallar con SQLSTATE `42501`.
- [ ] **CUANDO** un usuario de panel con `aal = 'aal1'` consulta `products` **EL SISTEMA DEBERÁ** devolver 0 filas, y con `aal = 'aal2'` DEBERÁ devolver las 59 filas.
- [ ] **CUANDO** un usuario autenticado sin identidad canjea con `pos_claim_device` un código vigente creado por `create_pairing_code` **EL SISTEMA DEBERÁ** crear exactamente un `devices` activo ligado a su `auth.uid()`, y un segundo canje del mismo código por otro usuario DEBERÁ fallar con `CODIGO_INVALIDO`.
- [ ] **CUANDO** un dispositivo emparejado llama `pos_pull_snapshot(0)` **EL SISTEMA DEBERÁ** devolver productos, categorías, staff con `pin_hash` y `settings`, y CUANDO la llama un usuario de panel DEBERÁ fallar con `NO_AUTORIZADO`.
- [ ] **CUANDO** un socio (no supervisor) con `aal2` llama `create_pairing_code` o `upsert_staff` **EL SISTEMA DEBERÁ** fallar con `NO_AUTORIZADO`.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

```bash
npm run test:db -- supabase/tests/seguridad.test.ts
npm run test:db
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T4 paso 4: seguridad"
git tag step-04-seguridad
git ls-files --error-unmatch supabase/tests/fixtures.ts   # expect: exit 0 — versionado por el commit de arriba
```

---

#### Paso 5 — Ventas, pagos, anulaciones y pos_push_events idempotente

Tarea `E1-T5` · epic `01-fundacion-datos` · prioridad `p0` · checkpoint `step-05-ventas-servidor`

**Do**

1. Cree `supabase/migrations/20261122000300_ventas.sql` con el contenido literal del bloque **M-0300** (§4). El sobre de eventos y los payloads
   por tipo están en la tabla *Eventos de la caja* de §5.
2. Edite `supabase/tests/fixtures.ts`: agregue `posEvent(seq, type, staffId, payload, at = "2026-11-22T16:00:00.000Z")` (genera `event_id` con
   `crypto.randomUUID()`), `openShiftEvent(seq, cashierId, approverId, shiftId, float = { "100": 3, "50": 4 })`,
   `saleEvent(seq, cashierId, shiftId, { receipt, lines: [{ productId, qty, unitPrice }], payments, orderType = "comer_aqui" })` (calcula `total`) y
   `productId(db, code)`. Hora por defecto 16:00 UTC = 10:00 en Honduras (dentro del horario 09:00–21:00).
3. `supabase/tests/ventas.test.ts` (dispositivo con `asRole(db, "authenticated", device.claims, …)`; panel con `aal2`):
   - lote `[turno_abierto #1, venta #2]` enviado dos veces → 1 `shifts`, 1 `sales`, 1 fila `pos_events` por `client_seq`; respuesta 1: `aplicado`×2;
     respuesta 2: `duplicado`×2; `sale_lines` del recibo con `line_base`/`line_isv` (`PZ-001` L 120.00 → base 104.35, ISV 15.65);
   - `venta` con `total` distinto de la suma → `rechazado` con error que empieza por `TOTAL_INVALIDO`; con `lines: []` → `VENTA_VACIA`; en ambos casos
     0 filas nuevas en `sales` y 1 alerta `evento_rechazado`;
   - recibo 5 después del 1 → aplicado + alerta `hueco_numeracion` ("Faltan recibos R-00000002 a R-00000004"); `unit_price` distinto del catálogo →
     alerta `precio_distinto`;
   - venta sin turno abierto → `TURNO_NO_ABIERTO`; `turno_abierto` aprobado por el mismo cajero → `SEGREGACION`;
   - `anulacion_solicitada` con `approved_by` = `staff_id` → `SEGREGACION`; sin `approved_by` → venta `anulacion_pendiente`; `decide_void(void, true)` por un
     supervisor de panel distinto → `anulada`; por el mismo staff que la pidió → `SEGREGACION`;
   - venta con pago `transferencia` (referencia "BAC-12345") → `pago_pendiente`; `confirm_transfer` → `pagada`; otra con `reject_transfer(id, 'No llegó a la cuenta')`
     → `cobro_fallido` + alerta `transferencia_rechazada`;
   - `turno_cerrado` con un conteo L 51.00 menor que el esperado → alerta `diferencia_caja` (|−51| > umbral 50); `gaveta_abierta` y `reimpresion` → 1 alerta cada uno.

Archivos que crea o modifica este paso: `supabase/migrations/20261122000300_ventas.sql`, `supabase/tests/fixtures.ts`, `supabase/tests/ventas.test.ts`.

**Done when**

- [ ] **CUANDO** el mismo lote de eventos `turno_abierto` + `venta` se envía dos veces a `pos_push_events` **EL SISTEMA DEBERÁ** crear exactamente un `shifts` y un `sales`, y responder `aplicado` la primera vez y `duplicado` la segunda para cada `client_seq`.
- [ ] **CUANDO** llega una `venta` cuyo `total` no es la suma de `qty * unit_price`, o sin líneas **EL SISTEMA DEBERÁ** registrar el evento como `rechazado` con error `TOTAL_INVALIDO` o `VENTA_VACIA`, no crear filas en `sales` y crear una alerta `evento_rechazado`.
- [ ] **CUANDO** llega una `venta` con `receipt_number` mayor que el último + 1 **EL SISTEMA DEBERÁ** aplicarla y crear una alerta `hueco_numeracion`, y CUANDO el precio unitario difiere del catálogo DEBERÁ crear una alerta `precio_distinto`.
- [ ] **CUANDO** llega una `venta` sin turno abierto de esa caja **EL SISTEMA DEBERÁ** rechazarla con `TURNO_NO_ABIERTO`.
- [ ] **CUANDO** llega `anulacion_solicitada` con `approved_by` igual al `staff_id` que la solicita **EL SISTEMA DEBERÁ** rechazarla con `SEGREGACION`, y sin `approved_by` DEBERÁ dejar la venta en `anulacion_pendiente` hasta que `decide_void` de un supervisor distinto la marque `anulada`.
- [ ] **CUANDO** una venta tiene un pago `transferencia` **EL SISTEMA DEBERÁ** dejarla en `pago_pendiente` hasta que `confirm_transfer` la pase a `pagada`, o `reject_transfer` la pase a `cobro_fallido` con una alerta `transferencia_rechazada`.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

```bash
npm run test:db -- supabase/tests/ventas.test.ts
npm run test:db
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T5 paso 5: ventas-servidor"
git tag step-05-ventas-servidor
git ls-files --error-unmatch supabase/migrations/20261122000300_ventas.sql   # expect: exit 0 — versionado por el commit de arriba
```

---

#### Paso 6 — Inventario por receta: compras, cortes, conteos y merma

Tarea `E1-T6` · epic `01-fundacion-datos` · prioridad `p0` · checkpoint `step-06-inventario-servidor`

**Do**

1. Cree `supabase/migrations/20261122000400_inventario.sql` con el contenido literal del bloque **M-0400** (§4).
2. `supabase/tests/inventario.test.ts` (reutiliza `./fixtures`; panel supervisor `aal2` para RPC; superusuario para `app.apply_inventory_count`):
   - venta de 1× `PZ-003` (8 piezas) → movimientos `venta` de −2 para `ALA`, `PIERNA`, `MUSLO` y `PECHUGA`; anularla (`anulacion_solicitada` con supervisor
     distinto) → movimientos `anulacion` +2 y el stock teórico (`inventory_stock.qty`) de cada pieza vuelve al valor previo; reenviar el mismo lote
     de la venta → `duplicado` y el número de movimientos `venta` de esa venta no cambia;
   - `register_purchase('POLLO-ENTERO', 10, 2275, 'Avícola del Valle', 45.5)` → `cost_per_unit = 227.5`, `cost_per_pound = 50`, stock +10;
     sin libras → `LIBRAS_REQUERIDAS`;
   - `register_cut(2)` → `POLLO-ENTERO` −2, cada pieza +4, `cuts.cost_per_piece` = `avg_cost` del pollo × 2 ÷ 16 (con la compra anterior: 28.4375);
     `register_cut(999)` → `STOCK_INSUFICIENTE` y 0 movimientos nuevos;
   - `register_cut(1)` (pollo entero 10 − 2 − 1 = 7) → `ALA` +2; secuencia de `ALA`: 0 (venta −2, anulación +2) + 4 (`register_cut(2)`) + 2 = **6**;
     `app.apply_inventory_count(staff, fecha, '[{"item_code":"ALA","counted":0}]')` con ese teórico 6 → movimiento `ajuste_conteo` −6 y línea con
     `waste_value = 6 × avg_cost` de `ALA`, y alerta `merma` (6 > umbral 2);
   - `update`/`delete` sobre `inventory_movements` → `MOVIMIENTO_INMUTABLE`;
   - `consumo_interno` desde la caja con `approved_by` de otro supervisor → movimiento `consumo_interno`; sin aprobador distinto → `SEGREGACION`;
   - `upsert_recipe('CP-004', '[]')` → `RECETA_INVALIDA`; `create_product('BE', 'Coca prueba', 20)` → `BE-028`.

Archivos que crea o modifica este paso: `supabase/migrations/20261122000400_inventario.sql`, `supabase/tests/inventario.test.ts`.

**Done when**

- [ ] **CUANDO** se aplica una venta de `PZ-003` (8 piezas) **EL SISTEMA DEBERÁ** insertar movimientos `venta` de −2 para `ALA`, `PIERNA`, `MUSLO` y `PECHUGA`, y CUANDO esa venta se anula DEBERÁ insertar movimientos `anulacion` que devuelven el stock teórico de cada ítem al valor previo.
- [ ] **CUANDO** `register_purchase` registra 10 `POLLO-ENTERO` de 45.5 libras por L 2,275.00 **EL SISTEMA DEBERÁ** guardar `cost_per_unit = 227.50` y `cost_per_pound = 50.00` y sumar 10 al stock teórico de `POLLO-ENTERO`.
- [ ] **CUANDO** `register_cut` corta 2 pollos sin desglose explícito **EL SISTEMA DEBERÁ** restar 2 de `POLLO-ENTERO`, sumar 4 a cada una de `ALA`, `PIERNA`, `MUSLO` y `PECHUGA`, y fijar el costo por pieza = costo promedio del pollo × 2 ÷ 16.
- [ ] **CUANDO** `register_cut` pide cortar más pollos que el stock teórico **EL SISTEMA DEBERÁ** fallar con `STOCK_INSUFICIENTE` sin insertar movimientos.
- [ ] **CUANDO** `app.apply_inventory_count` registra un conteo menor al teórico **EL SISTEMA DEBERÁ** insertar un movimiento `ajuste_conteo` por la diferencia y una línea con `waste_value` = (teórico − contado) × `avg_cost`.
- [ ] **CUANDO** se intenta `UPDATE` o `DELETE` sobre `inventory_movements` **EL SISTEMA DEBERÁ** fallar con `MOVIMIENTO_INMUTABLE`.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

```bash
npm run test:db -- supabase/tests/inventario.test.ts
npm run test:db
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E1-T6 paso 6: inventario-servidor"
git tag step-06-inventario-servidor
git ls-files --error-unmatch supabase/migrations/20261122000400_inventario.sql   # expect: exit 0 — versionado por el commit de arriba
```

---

#### Paso 7 — Cierre del día, reporte Z, panel y SAR preparado apagado

Tarea `E2-T1` · epic `02-cierre-y-caja` · prioridad `p0` · checkpoint `step-07-cierre-z-fiscal`

**Do**

1. Cree `supabase/migrations/20261122000500_cierre_dia.sql` con el bloque **M-0500** y `supabase/migrations/20261122000600_fiscal.sql` con el bloque
   **M-0600** (ambos en §4, literales).
2. `supabase/tests/cierre.test.ts` — escenario fijo del día `2026-11-22` (eventos a las 16:00 UTC): turno con fondo `{"100":3,"50":4}` (L 500.00) aprobado por un
   supervisor de caja; ventas en efectivo `CF-001` (L 209.00, recibido 300) y `PZ-001` (L 120.00, recibido 120); venta `EX-001` (L 25.00) anulada en caja con
   supervisor distinto; `turno_cerrado` con conteo `{"500":1,"200":1,"100":1,"20":1,"5":1,"2":2}` (L 829.00). Luego, como supervisor de panel `aal2`:
   - `day_close_deposit` antes de contar → `ORDEN_CIERRE` (día `2026-11-22`);
   - `day_close_start` → `day_close_cash_count({"500":1,"200":1,"100":1,"20":1,"5":1,"2":2})` → `day_close_inventory_count([{"item_code":"ALA","counted":…}])` →
     `day_close_deposit('2026-11-22', 'entrega_socio', 829, 'Socio encargado')`;
   - `day_close_finalize(fecha, 'f'.repeat(64))` con PIN distinto → `PIN_INVALIDO`;
   - **segundo día `2026-11-23`** (aislado del día 1; eventos con `client_created_at` del 23), en este orden exacto, que respeta las guardas de M-0500:
     `turno_abierto` (fondo `{"100":3,"50":4}` = L 500.00) → `venta` con un único pago `transferencia` (referencia "BAC-23001", queda `pendiente`) →
     `turno_cerrado` → `day_close_start('2026-11-23')` → `day_close_cash_count` → `day_close_inventory_count` → `day_close_deposit('2026-11-23', …)` →
     **`TRANSFERENCIAS_PENDIENTES`** → `confirm_transfer` → `day_close_cash_count('2026-11-23', {"500":1,"200":1})` (L 700.00: difiere del esperado
     L 500.00 —solo el fondo, porque la venta fue por transferencia— por L 200.00, más que el umbral L 50) → `day_close_deposit` de nuevo (ahora acepta) →
     `day_close_finalize('2026-11-23', <pin_hash correcto del supervisor>)` sin justificación → **`JUSTIFICACION_REQUERIDA`**. Así el día `2026-11-22`
     conserva exactamente sus 3 ventas;
   - finalización correcta → `z_report.ventas_total = 329`, `z_report.anulaciones.cantidad = 1`, `z_report.efectivo.esperado = 829`, `status = 'cerrado'`,
     `z_hash = encode(sha256(convert_to(z_report::text, 'UTF8')), 'hex')`;
   - `update day_closes set justification = 'x'` sobre el cerrado → `DIA_CERRADO`; `anulacion_solicitada` de una venta de ese día → evento `rechazado` con `DIA_CERRADO`;
   - `panel_summary('2026-11-22', '2026-11-22')` como socio `aal2` → `venta_total = 329`, `recibos = 2`; `panel_list('ventas', …)` devuelve 3 filas.
3. `supabase/tests/fiscal.test.ts` (superusuario inserta `fiscal_config`): con `activo = true`, establecimiento `001`, punto `001`, tipo `01`, rango 1–2, siguiente 1 y
   `fecha_limite = app.local_date(now()) + 60` (el mismo reloj que usa la función) → `app.next_fiscal_number()` devuelve `001-001-01-00000001` y luego `001-001-01-00000002`; el tercero → `RANGO_FISCAL_AGOTADO`;
   con `fecha_limite = app.local_date(now()) - 1` → `FECHA_LIMITE_VENCIDA`; con `activo = false` o sin fila → `FISCAL_INACTIVO`; con `fecha_limite = app.local_date(now()) + 10` →
   crea una alerta `rango_fiscal`; dentro de este mismo archivo se aplica por `pos_push_events` un `turno_abierto` + una `venta` (con `./fixtures`) y
   su fila en `sales` tiene `fiscal_number` nulo (no depende de ningún otro archivo de prueba).

Archivos que crea o modifica este paso: `supabase/migrations/20261122000500_cierre_dia.sql`, `supabase/migrations/20261122000600_fiscal.sql`, `supabase/tests/cierre.test.ts`, `supabase/tests/fiscal.test.ts`.

**Done when**

- [ ] **CUANDO** el supervisor ejecuta `day_close_deposit` antes de registrar el conteo de efectivo y el de inventario, o con transferencias `pendiente` del día **EL SISTEMA DEBERÁ** fallar con `ORDEN_CIERRE` o `TRANSFERENCIAS_PENDIENTES` respectivamente.
- [ ] **CUANDO** `day_close_finalize` recibe un `p_pin_hash` distinto del `pin_hash` del supervisor **EL SISTEMA DEBERÁ** fallar con `PIN_INVALIDO`, y con una diferencia de efectivo mayor a `cash_diff_threshold` sin justificación DEBERÁ fallar con `JUSTIFICACION_REQUERIDA`.
- [ ] **CUANDO** `day_close_finalize` cierra un día con ventas en efectivo de L 209.00 y L 120.00, una venta anulada de L 25.00 y fondo de L 500.00 **EL SISTEMA DEBERÁ** guardar `z_report` con `ventas_total = 329`, `anulaciones.cantidad = 1`, `efectivo.esperado = 829`, `status = 'cerrado'` y `z_hash` igual al sha256 de `z_report::text`.
- [ ] **CUANDO** se intenta `UPDATE` sobre un `day_closes` cerrado, o anular una venta de ese día **EL SISTEMA DEBERÁ** fallar con `DIA_CERRADO`.
- [ ] **CUANDO** `app.next_fiscal_number()` se llama con `fiscal_config` activo, establecimiento `001`, punto `001`, tipo `01` y siguiente 1 **EL SISTEMA DEBERÁ** devolver `001-001-01-00000001` y luego `001-001-01-00000002`.
- [ ] **CUANDO** el rango está agotado o `fecha_limite` ya pasó **EL SISTEMA DEBERÁ** fallar con `RANGO_FISCAL_AGOTADO` o `FECHA_LIMITE_VENCIDA`, y con `fiscal_config.activo = false` DEBERÁ fallar con `FISCAL_INACTIVO`.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

```bash
npm run test:db -- supabase/tests/cierre.test.ts supabase/tests/fiscal.test.ts
npm run test:db
npm run typecheck
npm run lint
npm run format:check
npm run test
npm run build
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1
```

**Checkpoint**

```bash
git add -A && git commit -m "E2-T1 paso 7: cierre-z-fiscal"
git tag step-07-cierre-z-fiscal
git ls-files --error-unmatch supabase/migrations/20261122000600_fiscal.sql   # expect: exit 0 — versionado por el commit de arriba
```

---

#### Paso 8 — App shell: env validado, backend y utilidades

Tarea `E2-T2` · epic `02-cierre-y-caja` · prioridad `p0` · checkpoint `step-08-app-shell`

**Do**

1. `src/lib/env.ts`: esquema zod `{ VITE_SUPABASE_URL: z.url(), VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1) }`;
   `parseEnv(raw)` lanza `Error("Variable de entorno inválida: VITE_SUPABASE_URL")` (con el nombre de la primera variable inválida); `env = parseEnv(import.meta.env)`.
   Ningún otro archivo lee `import.meta.env` (todas las variables son requeridas desde este paso — §10).
2. `src/lib/backend.tsx`: los tipos del bloque *Contrato Backend* (§6) — `Backend`, `Session`, `TotpFactor`, `TotpEnrollment`, `BackendKind`,
   `CreateBackendImpl` — y la re-exportación de `BackendError` (definida en `@/lib/utils`); `getBackend(kind)` / `useBackend(kind)` devuelven un singleton por
   tipo, creado perezosamente con `createBackendImpl(kind)`, importado **estáticamente** de `@/lib/backend-impl`; `resetBackendForTests()` vacía esa caché de
   singletons (solo para pruebas); y un `QueryClient` exportado (`retry: 1`, `refetchOnWindowFocus: true`). Sin contexto React ni proveedor, y **ninguna referencia al backend simulado**: qué archivo implementa `@/lib/backend-impl`
   lo decide el alias por modo de `vite.config.ts` (§19.6).
3. `src/lib/backend-impl.ts` (implementación Supabase): `export const createBackendImpl: CreateBackendImpl` (import **solo de tipo** desde `@/lib/backend`)
   con `createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: kind === "pos" ? "pc-pos-auth" : "pc-panel-auth" } })`
   (dos clientes separados: la sesión de la caja y la del panel nunca se pisan en la misma PC); `rpc()` convierte `{ error }` en `BackendError` (de `@/lib/utils`)
   con `code` = prefijo antes de `:` del mensaje, o `"RED"` si es un fallo de red.
   Lea los tipos instalados de `@supabase/supabase-js` para `auth.signInAnonymously`, `auth.mfa.enroll/challengeAndVerify/listFactors/getAuthenticatorAssuranceLevel` y `storage.from().upload`.
4. `src/lib/utils.ts`: `cn(...inputs)` (clsx + tailwind-merge); `round2(n)`; `formatLempiras(n)` → `"L 1,234.50"` (separador de miles con coma, 2 decimales,
   **sin `Intl`**); `toLocalHN(iso)` → `{ fecha: "2026-11-22", hora: "10:00" }` restando 6 h a UTC; la clase `BackendError` del *Contrato Backend*; `buttonVariants` (cva: `primary`, `secondary`, `danger`, `ghost`; tamaños `md`, `lg`, `pos` = `min-h-18 min-w-18 text-lg font-bold`).
5. `src/lib/backend.test.tsx`: `parseEnv` con URL vacía o `"no-es-url"` lanza un error que contiene `VITE_SUPABASE_URL`; con `.env.test`, `getBackend("pos")` y
   `getBackend("panel")` se crean sin llamar `fetch` (espía `globalThis.fetch`); `formatLempiras(1234.5) === "L 1,234.50"`, `formatLempiras(0) === "L 0.00"`; `toLocalHN("2026-11-22T16:00:00.000Z")`
   → hora `"10:00"`; `App` en `/pos` y `/panel` sigue mostrando `Caja` y `Panel de socios`; un error `{ message: "CODIGO_INVALIDO: x" }` se
   normaliza a `code = "CODIGO_INVALIDO"`.

Archivos que crea o modifica este paso: `src/lib/env.ts`, `src/lib/backend.tsx`, `src/lib/backend-impl.ts`, `src/lib/utils.ts`, `src/lib/backend.test.tsx`.

**Done when**

- [ ] **CUANDO** `parseEnv` recibe `VITE_SUPABASE_URL` vacío o que no es una URL **EL SISTEMA DEBERÁ** lanzar un error cuyo mensaje contiene `VITE_SUPABASE_URL`.
- [ ] **CUANDO** `npm run test` crea los backends `pos` y `panel` con los valores de `.env.test` **EL SISTEMA DEBERÁ** hacerlo sin llamar `fetch`.
- [ ] **CUANDO** el backend recibe un error con mensaje `CODIGO_INVALIDO: x` **EL SISTEMA DEBERÁ** lanzar un `BackendError` con `code = "CODIGO_INVALIDO"`.
- [ ] **CUANDO** `formatLempiras(1234.5)` se ejecuta **EL SISTEMA DEBERÁ** devolver `L 1,234.50` sin usar `Intl`.
- [ ] **CUANDO** `App` se renderiza en `/pos` y `/panel` **EL SISTEMA DEBERÁ** seguir mostrando los encabezados `Caja` y `Panel de socios`, y `npm run e2e -- e2e/smoke.spec.ts` DEBERÁ salir con código 0.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

```bash
npm run test -- src/lib/backend.test.tsx
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
git add -A && git commit -m "E2-T2 paso 8: app-shell"
git tag step-08-app-shell
git ls-files --error-unmatch src/lib/backend.tsx   # expect: exit 0 — versionado por el commit de arriba
```

---

#### Paso 9 — Emparejamiento de la caja, Dexie e instantánea

Tarea `E2-T3` · epic `02-cierre-y-caja` · prioridad `p0` · checkpoint `step-09-emparejamiento-dexie`

**Do**

1. `src/pos/db.ts`: `PosDb extends Dexie` llamada `"pollo-chilero-pos"`, `version(1).stores(...)` exactamente como el bloque *Almacén local* (§4)
   y tipos de cada tabla; `export const db = new PosDb()`; `getMeta(key)` / `setMeta(key, value)`.
2. `src/pos/device.ts`: `pairDevice(backend, code, label)` → `backend.signInAnonymously()` → `backend.rpc("pos_claim_device", { p_code: code.trim().toUpperCase(), p_label: label })`
   → guarda `deviceId` y `deviceLabel` en `meta` → `navigator.storage?.persist?.()` (guarda el resultado en `meta.storagePersisted`) → `pullSnapshot(backend)`;
   `pullSnapshot(backend)` → `rpc("pos_pull_snapshot", { p_since: meta.snapshotVersion ?? 0 })`; si `unchanged` no escribe nada; si no, en una transacción reemplaza
   `categories`, `products`, `staff`, `settings`, guarda `snapshotVersion` y fija `lastReceiptNumber = max(local, device.last_receipt_number)` y
   `lastClientSeq = max(local, device.last_client_seq)`; `isPaired()`.
3. `src/pos/PairingScreen.tsx`: `<h1>Caja — Emparejar esta caja</h1>`, campo "Código de emparejamiento" (8 caracteres, mayúsculas), campo "Nombre de la caja"
   (por defecto "Caja 1"), botón "Emparejar". Error `CODIGO_INVALIDO` → "Código inválido o vencido"; `RED` → "Sin conexión: el emparejamiento necesita internet".
4. `src/pos/PosRoutes.tsx`: el índice muestra `PairingScreen` si `!isPaired()` (con `useLiveQuery`); si está emparejada, muestra "Caja emparejada: <label>"
   (el paso 10 lo reemplaza por el selector de cajero). Conserva la ruta `hardware`.
5. `src/pos/device.test.ts`: con un backend falso (objeto `fake` que implementa `Backend` con `vi.fn()`; inyección del backend falso: `vi.mock("@/lib/backend-impl", () => ({ createBackendImpl: () => fake }))`; en `beforeEach`, `resetBackendForTests()` y `queryClient.clear()` (ambos de `@/lib/backend`)): `pairDevice("abcd2345", "Caja 1")` llama `signInAnonymously` y luego
   `pos_claim_device` con `p_code: "ABCD2345"` y guarda `deviceId`; con `CODIGO_INVALIDO` no guarda `deviceId` y la pantalla muestra "Código inválido o vencido";
   una instantánea versión 7 con `last_receipt_number = 120` reemplaza las tablas y deja `lastReceiptNumber = 120` (o el local si es mayor); `unchanged: true` no escribe.

Archivos que crea o modifica este paso: `src/pos/db.ts`, `src/pos/device.ts`, `src/pos/PairingScreen.tsx`, `src/pos/PosRoutes.tsx`, `src/pos/device.test.ts`.

**Done when**

- [ ] **CUANDO** la caja no está emparejada y se abre `/pos` **EL SISTEMA DEBERÁ** mostrar el encabezado `Caja — Emparejar esta caja` con un campo para el código de 8 caracteres.
- [ ] **CUANDO** `pairDevice` se ejecuta con el código `abcd2345` contra un backend falso que lo acepta **EL SISTEMA DEBERÁ** llamar `signInAnonymously` y luego `pos_claim_device` con `p_code` `ABCD2345`, y guardar `deviceId` en la tabla `meta` de Dexie.
- [ ] **CUANDO** el backend falso rechaza con `CODIGO_INVALIDO` **EL SISTEMA DEBERÁ** mostrar `Código inválido o vencido` y no guardar `deviceId`.
- [ ] **CUANDO** `pullSnapshot` recibe una instantánea con versión 7 y `last_receipt_number = 120` **EL SISTEMA DEBERÁ** reemplazar `products`, `categories`, `staff` y `settings` en Dexie, guardar `snapshotVersion = 7` y fijar el contador local de recibos en el mayor entre el local y 120.
- [ ] **CUANDO** la instantánea responde `unchanged: true` **EL SISTEMA DEBERÁ** conservar los datos locales sin escribir en Dexie.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

```bash
npm run test -- src/pos/device.test.ts
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
git add -A && git commit -m "E2-T3 paso 9: emparejamiento-dexie"
git tag step-09-emparejamiento-dexie
git ls-files --error-unmatch src/pos/db.ts   # expect: exit 0 — versionado por el commit de arriba
```

---

#### Paso 10 — Selector de cajero, PIN PBKDF2 y outbox

Tarea `E2-T4` · epic `02-cierre-y-caja` · prioridad `p0` · checkpoint `step-10-cajero-pin`

**Do**

1. `src/lib/pin.ts`: `hashPin(pin, saltHex, iterations)` → hex de 64 caracteres (WebCrypto `PBKDF2`, `SHA-256`, 256 bits); `newSalt()` → 16 bytes aleatorios en hex
   (32 caracteres); `verifyPin(pin, staff)` compara con `staff.pinHash`; `registerFailure(staffId)` / `clearFailures(staffId)` / `lockedUntil(staffId)` sobre la tabla
   Dexie `pinAttempts` con la política `settings.pin_lockout` (5 intentos, 30 s). Este módulo vive en `src/lib/` porque el panel lo usa para crear PIN (paso 16)
   — recibe la tabla `pinAttempts` por parámetro para no importar `src/pos/`.
2. `src/pos/outbox.ts`: tipos `PosEventType` (`turno_abierto`, `turno_cerrado`, `venta`, `anulacion_solicitada`, `reimpresion`, `gaveta_abierta`, `consumo_interno`,
   `pin_bloqueado`) y sus payloads (§5, *Eventos de la caja*); `enqueueEventInTx(type, staffId, payload)` — debe ejecutarse dentro de una transacción
   `rw` que incluya `meta` y `outbox`: incrementa `meta.lastClientSeq`, asigna `eventId = crypto.randomUUID()`, `clientCreatedAt = new Date().toISOString()`,
   `status: "pendiente"`, `attempts: 0`; `enqueueEvent(...)` abre su propia transacción; `pendingEvents(limit)`.
3. `src/pos/CashierLogin.tsx`: `<h1>Caja — ¿Quién atiende?</h1>`, un botón grande (`buttonVariants({ size: "pos" })`) por staff activo con rol `cajero` o
   `supervisor` y `pinHash`; al tocarlo, teclado PIN en pantalla de 4 dígitos (botones 0–9, borrar; también acepta teclado físico) con puntos ocultos; PIN correcto →
   `onLogin(staff)`; incorrecto → "PIN incorrecto"; al 5.º fallo → "Bloqueado 30 s" y `enqueueEvent("pin_bloqueado", staff.id, { blocked_staff_id: staff.id })`.
   Cambiar de cajero = botón "Cambiar cajero" (vuelve a esta pantalla) + tocar nombre = 2 toques antes del PIN.
4. `src/pos/PosRoutes.tsx`: emparejada y sin cajero → `CashierLogin`; con cajero → "Atiende: <nombre>" + "Cambiar cajero" (el paso 11 agrega el turno). El cajero
   activo vive en estado React (se pierde al recargar: se vuelve a pedir PIN).
5. `src/pos/pin-outbox.test.tsx`: `hashPin("1234", sal, 210000)` dos veces → mismo hex de 64; `"1235"` → distinto; render con 2 cajeros en Dexie → 2 botones; PIN
   correcto → `onLogin`; 5 incorrectos → "Bloqueado 30 s" y 1 evento `pin_bloqueado` en `outbox`; 3 `enqueueEvent` → `clientSeq` 1, 2, 3 y `eventId` distintos.

Archivos que crea o modifica este paso: `src/lib/pin.ts`, `src/pos/outbox.ts`, `src/pos/CashierLogin.tsx`, `src/pos/PosRoutes.tsx`, `src/pos/pin-outbox.test.tsx`.

**Done when**

- [ ] **CUANDO** la caja emparejada abre `/pos` sin cajero activo **EL SISTEMA DEBERÁ** mostrar un botón por cada staff activo con rol `cajero` o `supervisor` y PIN, con su nombre.
- [ ] **CUANDO** se toca un nombre y se ingresa el PIN correcto de 4 dígitos **EL SISTEMA DEBERÁ** marcar a ese staff como cajero activo usando `verifyPin` (PBKDF2-SHA256 con la sal y las iteraciones del staff).
- [ ] **CUANDO** se ingresa un PIN incorrecto 5 veces seguidas **EL SISTEMA DEBERÁ** bloquear a ese staff 30 segundos, mostrar `Bloqueado 30 s` y encolar un evento `pin_bloqueado` en el outbox.
- [ ] **CUANDO** `enqueueEvent` encola 3 eventos **EL SISTEMA DEBERÁ** asignar `clientSeq` 1, 2 y 3 consecutivos y un `eventId` UUID distinto a cada uno, persistidos en la tabla `outbox`.
- [ ] **CUANDO** `hashPin("1234", sal, 210000)` se calcula dos veces **EL SISTEMA DEBERÁ** devolver el mismo hash hexadecimal de 64 caracteres, y uno distinto para el PIN `1235`.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

```bash
npm run test -- src/pos/pin-outbox.test.tsx
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
git add -A && git commit -m "E2-T4 paso 10: cajero-pin"
git tag step-10-cajero-pin
git ls-files --error-unmatch src/pos/outbox.ts   # expect: exit 0 — versionado por el commit de arriba
```

---

#### Paso 11 — Turno en caja: fondo, cierre ciego y acciones de supervisor

Tarea `E2-T5` · epic `02-cierre-y-caja` · prioridad `p0` · checkpoint `step-11-turno-caja`

**Do**

1. `src/pos/shift.ts` (lógica pura + Dexie): `countTotal(counts)` con las denominaciones de `settings.denominations` (L 500…0.10);
   `openShift(cashier, approver, counts)` — exige `approver.role === "supervisor"` y `approver.id !== cashier.id` (si no, `Error("Se requiere otro supervisor")`), guarda
   `shifts` `abierto` y encola `turno_abierto` en la misma transacción; `currentShift()`; `expectedCash(shiftId)` = fondo + suma de pagos `efectivo` de ventas locales
   del turno no anuladas; `closeShift(shiftId, counts)` → guarda conteo, encola `turno_cerrado`, devuelve `{ esperado, contado, diferencia }`;
   `requestVoid(sale, reason, approver?)` (sin aprobador → venta local `anulacion_solicitada`; con supervisor distinto → `anulada`), `openDrawer(reason)`,
   `internalConsumption(itemCode, qty, reason, approver)` — todos encolan su evento; motivo de 5+ caracteres obligatorio.
2. `src/pos/ShiftScreens.tsx`: `OpenShiftScreen` (`<h1>Caja — Abrir turno</h1>`, una fila por denominación con − / + y total, selector del supervisor que
   aprueba y su PIN en un campo `type="password"` `inputMode="numeric"` de 4 dígitos propio de esta pantalla, verificado con `verifyPin`) y `CloseShiftScreen`
   (conteo ciego: mismas filas, sin mostrar el esperado; tras "Enviar conteo" muestra esperado, contado y diferencia).
3. `src/pos/SupervisorActions.tsx`: lista de las últimas 20 ventas locales con "Solicitar anulación" (motivo + PIN de supervisor opcional), "Registrar apertura de gaveta sin venta"
   (motivo; la gaveta se abre a mano —no se envía pulso—, el registro deja constancia de quién y por qué), "Consumo interno" (ítem: `ALA`, `PIERNA`, `MUSLO`, `PECHUGA`, `PAPA-PERS` o una bebida `BE-NNN` del catálogo local —
   el código del ítem de bebida es el mismo del producto—, cantidad, motivo, PIN de supervisor).
4. `src/pos/PosRoutes.tsx`: con cajero y sin turno abierto → `OpenShiftScreen`; con turno → pantalla provisional con "Cerrar turno" y "Acciones de supervisor".
5. `src/pos/shift.test.tsx`: fondo `{"100":3,"50":4}` → total 500 y evento `turno_abierto` con `approved_by`; aprobador = cajero → error y 0 eventos; cierre: el
   esperado no está en el documento antes de enviar y sí después; anulación sin PIN → `anulacion_solicitada` sin `approved_by`; con supervisor distinto → `anulada`
   con `approved_by`; gaveta con motivo vacío → no encola; consumo interno → `consumo_interno`.

Archivos que crea o modifica este paso: `src/pos/shift.ts`, `src/pos/ShiftScreens.tsx`, `src/pos/SupervisorActions.tsx`, `src/pos/PosRoutes.tsx`, `src/pos/shift.test.tsx`.

**Done when**

- [ ] **CUANDO** el cajero abre turno con fondo `{"100": 3, "50": 4}` y el PIN de un supervisor distinto **EL SISTEMA DEBERÁ** guardar un turno `abierto` con total de fondo 500 y encolar `turno_abierto` con `approved_by` del supervisor.
- [ ] **CUANDO** el PIN de aprobación pertenece al mismo staff que abre el turno **EL SISTEMA DEBERÁ** mostrar `Se requiere otro supervisor` y no encolar ningún evento.
- [ ] **CUANDO** el cajero cierra turno **EL SISTEMA DEBERÁ** pedir el conteo por denominación sin mostrar el efectivo esperado, y solo después de enviar mostrar esperado, contado y diferencia, encolando `turno_cerrado`.
- [ ] **CUANDO** se solicita anular una venta local sin PIN de supervisor **EL SISTEMA DEBERÁ** marcarla `anulacion_solicitada` y encolar `anulacion_solicitada` sin `approved_by`, y con el PIN de un supervisor distinto DEBERÁ marcarla `anulada` y encolar con `approved_by`.
- [ ] **CUANDO** se abre la gaveta sin venta o se registra consumo interno **EL SISTEMA DEBERÁ** exigir un motivo de al menos 5 caracteres (y PIN de supervisor para consumo interno) y encolar `gaveta_abierta` o `consumo_interno`.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

```bash
npm run test -- src/pos/shift.test.tsx
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
git add -A && git commit -m "E2-T5 paso 11: turno-caja"
git tag step-11-turno-caja
git ls-files --error-unmatch src/pos/shift.ts   # expect: exit 0 — versionado por el commit de arriba
```

---

#### Paso 12 — Pantalla de venta táctil con pagos y recibo correlativo

Tarea `E2-T6` · epic `02-cierre-y-caja` · prioridad `p0` · checkpoint `step-12-pantalla-venta`

**Do**

1. `src/pos/cart.ts` (puro): `addItem`, `removeItem`, `setQty`; `cartTotals(lines)` → `{ total, base, isv }` con ISV por línea
   `base = round2(lineTotal / (1 + isvRate))`, `isv = lineTotal − base` (mismo cálculo que el servidor); `cashChange(total, received)`;
   `validatePayments(total, payments)` (suma = total; efectivo con recibido ≥ monto; transferencia con referencia de 4+ caracteres);
   `registerSale({ cart, orderType, payments, cashier, shift })` — UNA transacción `rw` sobre `meta`, `sales`, `outbox`: `receiptNumber = meta.lastReceiptNumber + 1`,
   `receiptCode = "R-" + 8 dígitos`, guarda la venta local y llama `enqueueEventInTx("venta", …)` con el payload de la tabla *Eventos de la caja* de §5.
2. `src/pos/NumPad.tsx`: teclado numérico en pantalla para montos (0–9, `.`, borrar, "Exacto"), botones `min-h-18`.
3. `src/pos/SaleScreen.tsx` (`<h1>Caja — Venta</h1>` visualmente oculto con `sr-only`): pestañas de las 6 categorías en orden `sort_order` (`role="tablist"`, activa
   `bg-accent text-accent-foreground font-bold text-xl`); cuadrícula de productos activos de la categoría con nombre y `formatLempiras(price)`, botones `min-h-18 min-w-18`;
   carrito a la derecha con cantidades +/−, total `text-5xl font-bold` e ISV incluido; selector obligatorio "Comer aquí" / "Para llevar"; botón "Cobrar"
   deshabilitado sin líneas o sin tipo de pedido; diálogo de cobro: efectivo (NumPad, cambio en grande), transferencia (referencia), mixto; "Confirmar" deshabilitado
   mientras `validatePayments` falle; al confirmar llama `registerSale`, limpia el carrito y muestra "Recibo R-00000001 registrado".
4. `src/pos/PosRoutes.tsx`: con turno abierto → `SaleScreen` con barra superior (cajero, "Cerrar turno", "Acciones de supervisor", "Cambiar cajero").
5. `src/pos/sale.test.tsx`: semilla Dexie con las 6 categorías y productos `PZ-001` (L 120.00) y `BE-008` (L 13.00); verifica pestañas en orden; botón de producto con
   clases `min-h-18` y `min-w-18`; 2× `PZ-001` + 1× `BE-008` → total "L 253.00" e ISV "L 33.00"; "Cobrar" deshabilitado sin tipo de pedido; efectivo L 300.00 → cambio
   "L 47.00" y venta `R-00000001` + 1 evento `venta`; mixto L 200.00 + L 53.00 sin referencia → "Confirmar" deshabilitado; dos `registerSale` lanzados con
   `Promise.all` → `R-00000001` y `R-00000002`, 2 eventos `venta` en `outbox` con `clientSeq` consecutivos y `fetch` no llamado (espía
   `globalThis.fetch`).

Archivos que crea o modifica este paso: `src/pos/cart.ts`, `src/pos/NumPad.tsx`, `src/pos/SaleScreen.tsx`, `src/pos/PosRoutes.tsx`, `src/pos/sale.test.tsx`.

**Done when**

- [ ] **CUANDO** se abre la pantalla de venta **EL SISTEMA DEBERÁ** mostrar 6 pestañas en el orden Combos familiares, Combos personales, Pollo en piezas, Combos infantiles, Extras, Bebidas, y botones de producto con nombre, precio y las clases `min-h-18` y `min-w-18` (72 px).
- [ ] **CUANDO** se agregan 2× `PZ-001` (L 120.00) y 1× `BE-008` (L 13.00) **EL SISTEMA DEBERÁ** mostrar el total `L 253.00` y el ISV incluido `L 33.00`.
- [ ] **CUANDO** no se ha elegido `Comer aquí` ni `Para llevar` **EL SISTEMA DEBERÁ** mantener deshabilitado el botón `Cobrar`.
- [ ] **CUANDO** se cobra en efectivo con L 300.00 recibidos para un total de L 253.00 **EL SISTEMA DEBERÁ** mostrar el cambio `L 47.00`, guardar la venta con `receiptCode` `R-00000001` y encolar un evento `venta` en la misma transacción Dexie.
- [ ] **CUANDO** se cobra mixto con L 200.00 en efectivo y L 53.00 por transferencia sin referencia **EL SISTEMA DEBERÁ** mantener deshabilitado `Confirmar` hasta que se ingrese una referencia de al menos 4 caracteres.
- [ ] **CUANDO** se registran dos ventas concurrentes **EL SISTEMA DEBERÁ** asignar `R-00000001` y `R-00000002` sin huecos ni repetidos, con 2 eventos `venta` en `outbox` con `clientSeq` consecutivos y `fetch` no llamado.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

```bash
npm run test -- src/pos/sale.test.tsx
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
git add -A && git commit -m "E2-T6 paso 12: pantalla-venta"
git tag step-12-pantalla-venta
git ls-files --error-unmatch src/pos/cart.ts   # expect: exit 0 — versionado por el commit de arriba
```

---

#### Paso 13 — Motor de sincronización, indicador y respaldo de emergencia

Tarea `E3-T1` · epic `03-operacion-panel-salida` · prioridad `p0` · checkpoint `step-13-sincronizacion`

**Do**

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

Archivos que crea o modifica este paso: `src/pos/sync.ts`, `src/pos/SyncIndicator.tsx`, `src/pos/emergency-export.ts`, `src/pos/PosRoutes.tsx`, `src/pos/sync.test.tsx`.

**Done when**

- [ ] **CUANDO** hay 50 eventos pendientes y el transporte falso responde `aplicado` **EL SISTEMA DEBERÁ** enviarlos en orden de `clientSeq` en lotes de máximo 25 y dejar 0 pendientes.
- [ ] **CUANDO** el transporte falso responde `duplicado` al reenviar eventos ya aplicados **EL SISTEMA DEBERÁ** marcarlos como confirmados sin crear filas nuevas en el outbox.
- [ ] **CUANDO** el transporte lanza un error `RED` **EL SISTEMA DEBERÁ** conservar los eventos `pendiente`, mostrar el estado `Sin conexión` y programar los reintentos a 2 s, 4 s, 8 s con tope de 300 s.
- [ ] **CUANDO** el servidor responde `rechazado` para un evento **EL SISTEMA DEBERÁ** mostrar el estado `Error` con el contador de rechazados y conservar el evento con su mensaje.
- [ ] **CUANDO** se toca `Exportar respaldo de emergencia` **EL SISTEMA DEBERÁ** generar un JSON con las claves `outbox`, `sales`, `shifts` y `meta` de Dexie.
- [ ] **CUANDO** el estado es `Sincronizado` **EL SISTEMA DEBERÁ** mostrar `0 pendientes` y la hora de la última sincronización.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

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

---

#### Paso 14 — Recibo de 80 mm, impresión y reimpresión COPIA

Tarea `E3-T2` · epic `03-operacion-panel-salida` · prioridad `p0` · checkpoint `step-14-recibo-impresion`

**Do**

1. `src/pos/print/receipt.ts`: `buildReceiptLines(sale, { copy: boolean, cashierName, deviceLabel })` → líneas de máximo 48 caracteres con la plantilla
   *Recibo de venta* (§6): encabezado, "RECIBO DE VENTA", código, fecha/hora locales (`toLocalHN`), caja, cajero, tipo de pedido, líneas
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

Archivos que crea o modifica este paso: `src/pos/print/receipt.ts`, `src/pos/print/print-service.ts`, `src/pos/print/ReceiptPrintView.tsx`, `src/pos/SaleScreen.tsx`, `src/pos/print/receipt.test.ts`.

**Done when**

- [ ] **CUANDO** se construye el recibo de una venta **EL SISTEMA DEBERÁ** producir líneas de máximo 48 caracteres que contienen `POLLO CHILERO`, `RECIBO DE VENTA`, el código `R-00000001`, el cajero, `Comer aquí` o `Para llevar`, cada producto, el total, la forma de pago, recibido, cambio y `Este documento no es una factura`.
- [ ] **CUANDO** se reimprime una venta **EL SISTEMA DEBERÁ** incluir la línea `*** COPIA ***` y encolar un evento `reimpresion`.
- [ ] **CUANDO** el modo de impresión es `serial` **EL SISTEMA DEBERÁ** enviar los bytes del recibo sin el pulso de gaveta ESC p (`1b 70`), sea el pago en efectivo o por transferencia, porque la gaveta no tiene conexión con el sistema y se abre a mano.
- [ ] **CUANDO** el modo es `navegador` o Web Serial no está disponible **EL SISTEMA DEBERÁ** renderizar `ReceiptPrintView` con la clase `receipt-80mm` y llamar `window.print()` una vez.
- [ ] **CUANDO** un monto de 1234.5 aparece en el recibo **EL SISTEMA DEBERÁ** imprimirlo como `L 1,234.50` sin depender de `Intl`.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

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

---

#### Paso 15 — Panel: login, MFA TOTP, tablero y decisiones pendientes

Tarea `E3-T3` · epic `03-operacion-panel-salida` · prioridad `p0` · checkpoint `step-15-panel-acceso`

**Do**

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

Archivos que crea o modifica este paso: `src/panel/PanelRoutes.tsx`, `src/panel/AuthScreens.tsx`, `src/panel/PanelGuard.tsx`, `src/panel/DashboardPage.tsx`, `src/panel/panel-access.test.tsx`.

**Done when**

- [ ] **CUANDO** un visitante sin sesión abre `/panel` **EL SISTEMA DEBERÁ** mostrar el encabezado `Panel de socios` con el formulario `Iniciar sesión` (correo y contraseña) y ningún dato del negocio.
- [ ] **CUANDO** la sesión es `aal1` y el usuario no tiene factor TOTP **EL SISTEMA DEBERÁ** mostrar el enrolamiento con el código QR y exigir un código de 6 dígitos antes de mostrar el tablero.
- [ ] **CUANDO** la sesión es `aal2` y `panel_whoami` devuelve rol `socio` **EL SISTEMA DEBERÁ** mostrar el tablero con venta total, número de recibos, ticket promedio y alertas, sin los botones `Confirmar`, `Rechazar` ni `Aprobar`.
- [ ] **CUANDO** el rol es `supervisor` **EL SISTEMA DEBERÁ** mostrar transferencias y anulaciones pendientes con botones que llaman `confirm_transfer`, `reject_transfer` y `decide_void`, y alertas con `Reconocer` que llama `ack_alert`.
- [ ] **CUANDO** pasan 60 segundos con el tablero abierto **EL SISTEMA DEBERÁ** volver a consultar `panel_summary`.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

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

---

#### Paso 16 — Panel: inventario, recetas, personal y emparejamiento

Tarea `E3-T4` · epic `03-operacion-panel-salida` · prioridad `p1` · checkpoint `step-16-panel-inventario-admin`

**Do**

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

Archivos que crea o modifica este paso: `src/panel/InventoryPage.tsx`, `src/panel/AdminPage.tsx`, `src/panel/forms.ts`, `src/panel/PanelRoutes.tsx`, `src/panel/panel-ops.test.tsx`.

**Done when**

- [ ] **CUANDO** el supervisor registra una compra de `POLLO-ENTERO` sin libras **EL SISTEMA DEBERÁ** mostrar `Las libras son obligatorias para pollo entero` y no llamar `register_purchase`.
- [ ] **CUANDO** registra una compra válida **EL SISTEMA DEBERÁ** llamar `register_purchase` con `p_item_code`, `p_qty`, `p_total_cost`, `p_pounds` y `p_supplier`.
- [ ] **CUANDO** abre Corte e ingresa 3 pollos **EL SISTEMA DEBERÁ** proponer 6 alas, 6 piernas, 6 muslos y 6 pechugas editables y enviar `register_cut` con el desglose final.
- [ ] **CUANDO** guarda la receta de un producto **EL SISTEMA DEBERÁ** llamar `upsert_recipe` solo con líneas de cantidad mayor a 0 y rechazar una receta sin líneas.
- [ ] **CUANDO** crea un cajero con PIN `4821` **EL SISTEMA DEBERÁ** enviar a `upsert_staff` una sal de 32 caracteres hex y un hash PBKDF2 de 64 caracteres hex, y ningún argumento con el PIN en claro.
- [ ] **CUANDO** genera un código de emparejamiento **EL SISTEMA DEBERÁ** mostrar el código devuelto por `create_pairing_code` y el aviso `vence en 15 minutos`.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

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

---

#### Paso 17 — Panel: asistente de cierre ciego, reporte Z y CSV

Tarea `E3-T5` · epic `03-operacion-panel-salida` · prioridad `p0` · checkpoint `step-17-panel-cierre-z`

**Do**

1. `src/panel/DayCloseWizard.tsx` (supervisor): fecha (hoy por defecto) → `day_close_start`; pasos en orden, cada uno habilitado solo si el anterior está completo
   (estado de `panel_list("cierre", fecha)`): **1 Efectivo** — filas por denominación, total contado, sin mostrar esperado ni ventas → `day_close_cash_count`;
   **2 Inventario** — conteo ciego de piezas, bebidas y desechables (lista de `panel_list("stock")` sin la columna teórica) → `day_close_inventory_count`;
   **3 Transferencias** — `panel_list("transferencias_pendientes")` filtrado por fecha con Confirmar/Rechazar; sigue solo cuando quedan 0;
   **4 Ingreso** — tipo (entrega a socio / depósito en banco), monto, quién recibe, foto opcional (`uploadReceiptPhoto("cierres/<fecha>.jpg")`) → `day_close_deposit`;
   **5 Firma** — PIN del supervisor: `my_pin_params()` → `hashPin(pin, salt, iterations)` → `day_close_finalize(p_date, p_pin_hash, p_justification)`;
   `JUSTIFICACION_REQUERIDA` → campo de justificación obligatorio (10+ caracteres) y reintento; éxito → `ZReportView`.
2. `src/panel/ZReportView.tsx`: muestra el `z_report` con las claves de la tabla *Reporte Z* (§5): fecha, recibos primero/último/cantidad, ventas
   por forma de pago y por categoría, ISV incluido (gravado 15 %, ISV 15 %, 18 %, exento), anulaciones, reimpresiones, aperturas sin venta, consumo interno,
   efectivo esperado/contado/diferencia por turno, transferencias, merma, ingreso, firmado por/en y `z_hash`; sin controles de edición; botón "Exportar Z (CSV)".
3. `src/lib/csv.ts`: `toCsv(rows, columns: { key, header }[])` → texto con BOM `\uFEFF`, separador `,`, fin de línea `\r\n`, comillas dobles cuando hay `,` `"` o
   salto de línea y `"` duplicada (RFC 4180); `downloadCsv(nombre, texto)`. Exportes: ventas (`panel_list("ventas")`), movimientos (`"movimientos"`) y cierres (`"cierres"`).
4. `src/panel/PanelRoutes.tsx`: ruta `cierre` (supervisor) y `reportes` (socio y supervisor: lista de Z con `ZReportView` y botones de CSV).
5. `src/panel/dayclose.test.tsx` con backend falso (inyección del backend falso: `vi.mock("@/lib/backend-impl", () => ({ createBackendImpl: () => fake }))`; en `beforeEach`, `resetBackendForTests()` y `queryClient.clear()` (ambos de `@/lib/backend`)): los 5 pasos visibles en orden y "Siguiente" deshabilitado hasta completar cada uno; en el paso 1 no aparece
   "esperado" ni "L 829.00"; `JUSTIFICACION_REQUERIDA` → campo de justificación y segunda llamada con `p_justification`; Z renderizado sin botón "Editar";
   `toCsv([{ nombre: 'Pollo "chilero", 8 pzs' }], [{ key: "nombre", header: "Producto" }])` empieza con `\uFEFF` y contiene `"Pollo ""chilero"", 8 pzs"`.

Archivos que crea o modifica este paso: `src/panel/DayCloseWizard.tsx`, `src/panel/ZReportView.tsx`, `src/lib/csv.ts`, `src/panel/PanelRoutes.tsx`, `src/panel/dayclose.test.tsx`.

**Done when**

- [ ] **CUANDO** el supervisor abre el cierre del día **EL SISTEMA DEBERÁ** mostrar los 5 pasos en orden (efectivo, inventario, transferencias, ingreso, firma) y no permitir avanzar a un paso sin completar el anterior.
- [ ] **CUANDO** está en el paso de efectivo **EL SISTEMA DEBERÁ** pedir el conteo por denominación sin mostrar el efectivo esperado ni las ventas del día.
- [ ] **CUANDO** `day_close_finalize` responde `JUSTIFICACION_REQUERIDA` **EL SISTEMA DEBERÁ** mostrar un campo de justificación obligatorio y reenviar con `p_justification`.
- [ ] **CUANDO** el cierre se completa **EL SISTEMA DEBERÁ** mostrar el reporte Z con fecha, rango de recibos, ventas por forma de pago, ISV, anulaciones, efectivo esperado, contado y diferencia, y merma, sin ningún control de edición.
- [ ] **CUANDO** se exportan datos a CSV **EL SISTEMA DEBERÁ** generar texto UTF-8 que empieza con BOM, con encabezados en español y comillas dobles escapadas según RFC 4180.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

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

---

#### Paso 18 — Endurecimiento: plantilla de factura, cabeceras y e2e

Tarea `E3-T6` · epic `03-operacion-panel-salida` · prioridad `p0` · checkpoint `step-18-endurecimiento-e2e`

**Do**

1. `src/lib/mock-backend.ts`: `export const createBackendImpl: CreateBackendImpl` (simulado) que implementa `Backend` en el navegador, con estado compartido en `localStorage["pc-mock-state"]`
   (la caja y el panel del mismo origen lo ven). Datos semilla: 6 categorías, `PZ-001` L 120.00, `CF-001` L 209.00, `BE-008` L 13.00; staff "Ana" (cajera, PIN 1111) y
   "Carlos" (supervisor, PIN 2222) con hash calculado al iniciar con `hashPin`; código de emparejamiento válido `MOCK2345`; usuario de panel `supervisor@prueba.hn` /
   `prueba1234` con TOTP `000000`. Implementa `pos_claim_device`, `pos_pull_snapshot`, `pos_push_events` (aplica y responde por `client_seq`; venta → resumen;
   `anulacion_solicitada` sin aprobador → anulación pendiente), `panel_whoami`, `panel_summary`, `panel_list`, `decide_void`, `confirm_transfer`, `my_pin_params`,
   `day_close_*` (sin lógica de dinero: el Z simulado devuelve los montos acumulados). Cualquier `rpc` con `navigator.onLine === false` lanza `BackendError("RED")`.
   Entra al build solo con `--mode e2e-mock`: `vite.config.ts` apunta el alias `@/lib/backend-impl` a este archivo únicamente en ese modo (y solo si
   existe); en producción ningún módulo lo referencia, y el Verify lo comprueba con `grep -rq "mock-backend" dist` esperando 1 (sin coincidencias).
2. `src/lib/fiscal-invoice.ts`: `buildInvoiceLines(invoice)` con la plantilla *Factura SAR* (§6) y `amountInWords(n)` ("MIL CIENTO CINCUENTA LEMPIRAS
   CON 00/100"); no se usa en ninguna pantalla mientras `fiscal_config.activo = false`.
3. `public/_headers` con el contenido literal del bloque *Cabeceras de seguridad* (§14).
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

Archivos que crea o modifica este paso: `src/lib/mock-backend.ts`, `src/lib/fiscal-invoice.ts`, `public/_headers`, `e2e/flujos.spec.ts`, `src/lib/hardening.test.ts`.

**Done when**

- [ ] **CUANDO** `npm run e2e -- e2e/flujos.spec.ts` ejecuta el flujo venta sin conexión → sincronización **EL SISTEMA DEBERÁ** mostrar `Sin conexión` con `1 pendientes` mientras el contexto está offline y `Sincronizado` con `0 pendientes` al volver la red.
- [ ] **CUANDO** ejecuta el flujo anulación → aprobación **EL SISTEMA DEBERÁ** mostrar la anulación pendiente en el panel del supervisor y, al aprobarla, el estado `anulada`.
- [ ] **CUANDO** ejecuta el flujo cierre ciego → Z **EL SISTEMA DEBERÁ** completar los 5 pasos y mostrar el reporte Z, sin mostrar el efectivo esperado antes de enviar el conteo.
- [ ] **CUANDO** `buildInvoiceLines` recibe una factura de L 1,150.00 gravada al 15% **EL SISTEMA DEBERÁ** incluir RTN del emisor, CAI, rango autorizado, fecha límite, número con formato `NNN-NNN-NN-NNNNNNNN`, `ORIGINAL: CLIENTE`, `COPIA: EMISOR`, gravado 15% `L 1,000.00`, ISV 15% `L 150.00`, `CONSUMIDOR FINAL` y `MIL CIENTO CINCUENTA LEMPIRAS CON 00/100`.
- [ ] **CUANDO** `npm run build` termina **EL SISTEMA DEBERÁ** copiar `public/_headers` a `dist/_headers` con `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `Referrer-Policy` y `X-Content-Type-Options: nosniff`.

**Verify** — cada línea sale con código 0 cuando el paso es correcto (la última, `status=0; grep … || status=$?; test "$status" -eq 1`, exige 1 = ninguna prueba con `.skip(`/`.only(`; 2 = error de grep, y entonces falla).

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


---

### 9.1 Parity and cutover

Este sistema reemplaza un **Excel de facturación** (`sistema de EVER gerardo (1).xlsm`), no un sistema con API: no hay tráfico que espejar ni base
que migrar en caliente. Lo que debe mantenerse idéntico es el catálogo; el historial de ventas del Excel **no se migra** (decisión §20.3 #9).

#### Parity set

| # | Comportamiento que se conserva | Cómo se prueba la paridad | Tolerancia |
|---|---|---|---|
| 1 | Los 59 productos y sus precios finales del Excel | `supabase/tests/catalogo.test.ts` (paso 3): 59 productos, `sum(price) = 6667.00`, `legacy_code` P001…P0059 únicos, muestras `CF-001` = 209.00 y `BE-027` = 20.00 | exacta |
| 2 | Precio final con ISV incluido (el cliente paga lo mismo que hoy) | `sale_lines.line_base + line_isv = line_total` en `ventas.test.ts` (paso 5) | exacta al centavo |
| 3 | El supervisor confirma que el catálogo coincide con el menú físico | revisión manual del listado `panel_list('productos')` contra el menú (§20.1) | [PENDIENTE] — es lo único no automatizable |

**Período en paralelo:** 3 días de operación real en los que la caja nueva es la que cobra y el Excel se llena en paralelo solo con totales del día;
paridad = total del Z igual a la suma del Excel cada día, 0 diferencias inexplicadas en los 3 días. Una diferencia bloquea el apagado del Excel.

#### Cutover

| Fase | Qué cambia | A quién afecta | Se revierte con | Verificación |
|---|---|---|---|---|
| Ensayo | La caja nueva funciona en la PC con el local cerrado; ventas de prueba y un cierre completo | nadie | no hace falta: usa un proyecto Supabase de pruebas, separado del de producción | `npm run e2e` verde + checklist §20.1 |
| Paralelo (3 días) | La caja nueva cobra e imprime; el Excel solo registra el total del día | cajeros y supervisor | volver al Excel + talonario de recibos de contingencia | Z diario = total del Excel |
| Producción | Solo la caja nueva | todos | volver al Excel + talonario (inmediato, sin despliegue) | `panel_summary` diario |
| Retiro del Excel | El `.xlsm` queda archivado, solo lectura (responsable: socio supervisor) | nadie | reabrir el archivo | el `.xlsm` está en una carpeta de archivo con atributo de solo lectura y existe una copia externa (nube del socio); el socio supervisor lo confirma marcando la casilla de §20.1 |

**Interruptor de emergencia:** el talonario de recibos de contingencia en papel + el Excel archivado. Lo acciona el **socio supervisor**, que está de
guardia durante todo el corte (ensayo, paralelo y primeros 30 días de producción) y revisa los criterios de abajo en cada cierre del día. Tiempo de reversión: inmediato (no hay
despliegue). Si la caja no puede imprimir, el respaldo `window.print()` y, en último caso, el talonario; las ventas siguen registrándose en la caja.

#### Abort criteria

Quién vigila: el **socio supervisor**, al firmar cada cierre del día en el panel.

- [ ] CUANDO el total del Z de un día del período en paralelo difiere del total del Excel por más de L 50 sin explicación, el socio supervisor DEBERÁ volver a la fase *Paralelo* y extenderla 3 días.
- [ ] CUANDO aparece una alerta `hueco_numeracion` o `evento_rechazado` no explicada, el socio supervisor DEBERÁ detener el avance de fase hasta corregir la causa.
- [ ] CUANDO la caja queda más de 2 h sin sincronizar con internet disponible (alerta `caja_sin_sincronizar`), el socio supervisor DEBERÁ revisar la caja antes del cierre del día.

#### Data migration

Solo el catálogo, mediante la migración `20261122000110_catalogo_inicial.sql` (idempotencia: se aplica una vez, como toda migración). El historial
de 57 recibos del Excel no se migra: tiene los defectos que este sistema existe para impedir (huecos, ventas en L 0, códigos reutilizados) y
cargarlo contaminaría los reportes. Punto de no retorno: el primer cierre del día firmado en producción.

#### Decommission

Responsable: el **socio supervisor**. Después de 30 días en producción sin abortar: mover el `.xlsm` a una carpeta de archivo con atributo de solo
lectura, copiarlo a un respaldo externo (nube del socio) y dejar de abrirlo; queda hecho cuando el socio supervisor marca esa casilla en §20.1.
No es un paso del §9.

---
## 10. Environment Setup

### Prerequisites

| Herramienta | Versión | Comprobación |
|---|---|---|
| Node.js | 24.x LTS (24.22.3 en la lista LTS de nodejs.org, 2026-11-22) — fijado en `.nvmrc` | `node -v` → `v24.…` |
| npm | el que trae Node 24 | `npm -v` |
| Git (Windows: Git for Windows con **Git Bash**) | ≥ 2.28 (`git init -b`) | `git --version` |
| Chrome de escritorio (caja) | actual (Web Serial desde la v89) | `chrome://version` |
| Chromium de Playwright | el que fija `@playwright/test` 1.65.1 | lo instala `npm run e2e:install` (paso 1) |

Todos los comandos de este blueprint son **POSIX y se ejecutan en Git Bash** (en Windows) o bash (Linux/macOS), desde la raíz del repo. No se
necesitan Docker, Supabase local ni credenciales para ningún gate: la base de datos de las pruebas es PGlite (Postgres en WASM) dentro del proceso.

### Accounts to create first

Ningún gate del §9 necesita una cuenta externa. Antes de **producción** (§12, checklist §20.1):

| Servicio | Para qué | Registro | Lo necesita |
|---|---|---|---|
| GitHub | repositorio y CI | https://github.com/signup | §12 (CI) |
| Supabase | Postgres + Auth + Storage en la nube del usuario | https://supabase.com/dashboard | §12 (despliegue) |
| Hosting estático HTTPS: Lovable **o** Cloudflare Pages / Netlify | servir `dist/` con HTTPS (Web Serial y PWA lo exigen) | https://lovable.dev · https://dash.cloudflare.com · https://app.netlify.com | §12 (despliegue) |

### Environment variables

| Variable | Propósito | Dónde se obtiene | Requerida desde el paso | ¿Secreta? |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase (va al navegador) | Supabase → Project Settings → API → Project URL. Pruebas: `http://127.0.0.1:54321` en `.env.test`, `.env.e2e`, `.env.e2e-mock` | 8 | no (pública por diseño) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | clave pública del proyecto (publishable/anon) | Supabase → Project Settings → API Keys. Pruebas: `sb_publishable_prueba_no_real` | 8 | no (pública; la seguridad la dan RLS y las RPC) |
| `SUPABASE_DB_URL` | cadena de conexión Postgres para el `pg_dump` diario (§12); solo en la terminal de quien respalda, nunca en el repo ni en `.env*` | Supabase → Project Settings → Database → Connection string | ninguno — operación manual de §12, fuera del build | **sí** |

Ninguna variable secreta llega al cliente: no hay `service_role` en el frontend ni en el repo. Las dos variables las lee **solo**
`src/lib/env.ts` (zod) y son obligatorias desde el paso 8, que es el que crea ese archivo; los pasos 1–7 no leen ninguna. Vite carga `.env.test`
(Vitest, modo `test`), `.env.e2e` (prueba de humo, `vite build --mode e2e`) y `.env.e2e-mock` (`vite build --mode e2e-mock`) por sí mismo: no hay
herramienta independiente que necesite un cargador aparte (§19.6). Para `npm run dev` y el build de producción local el usuario crea `.env.local`
(ignorado por git) copiando `.env.example`; en el hosting se definen en su panel de variables.

### Files that must be committed

| Archivo | Por qué se versiona | Línea de excepción en `.gitignore` |
|---|---|---|
| `.env.example` | plantilla de variables (sin valores) | `!.env.example` después de `.env.*` |
| `.env.test` | valores falsos para Vitest | `!.env.test` después de `.env.*` |
| `.env.e2e` | valores falsos para la prueba de humo | `!.env.e2e` después de `.env.*` |
| `.env.e2e-mock` | build de los flujos e2e con backend simulado | `!.env.e2e-mock` después de `.env.*` |
| `package-lock.json` | `npm ci` en CI y versiones reproducibles | — no la cubre ningún patrón |
| `.claude/settings.json`, `.claude/skills/**`, `.claude/rules/**` | configuración del agente | — solo se ignora `.claude/settings.local.json` |
| configs de §19.6 (`tsconfig.json`, `vite.config.ts`, `vitest*.config.ts`, `playwright.config.ts`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitattributes`, `components.json`, `index.html`, `src/test/setup.ts`, `supabase/tests/shim.sql`, `supabase/tests/harness.ts`) | los gates no corren sin ellos | — no los cubre ningún patrón |
| `supabase/migrations/*.sql` | fuente de verdad del esquema | — no los cubre ningún patrón |
| `.github/workflows/ci.yml` | CI | — no lo cubre ningún patrón |
| `blueprints/pollo-chilero-pos/**` | `tasks.json` lleva el estado de reanudación | — no lo cubre ningún patrón |

El `.gitignore` con esas excepciones viaja en `workspace/` y la copia del Bootstrap lo deja en disco **antes** del primer commit.

### Bootstrap

**Dónde vive el repo:** el repositorio destino se crea **fuera de OneDrive** (por ejemplo `C:\dev\pollo-chilero-pos`) y este bundle se copia a
`<repo>/blueprints/pollo-chilero-pos/` antes del Bootstrap. **Nunca** ejecute el Bootstrap dentro de la carpeta de OneDrive "ERP Pollos": la
sincronización de OneDrive bloquea archivos de `node_modules/` y `.git/`, y esa carpeta contiene los insumos (`.xlsm`, `.docx`, fotos) que no
deben entrar al repo (`.gitignore` excluye `*.xlsm`, `*.docx`, `*.dump` y `respaldo-*.json` por si acaso).

```bash
# Git Bash (Windows) o bash, desde la raíz del repo destino, con este bundle en blueprints/pollo-chilero-pos/.
# El orden importa: archivos que gobiernan comandos posteriores (.gitignore + excepciones, .gitattributes, configs de
# lint/format con sus exclusiones de blueprints/) → repositorio → primer commit → instalación.
# Todo el bloque es seguro de re-ejecutar y sale con 0 la segunda vez. No crea recursos en la nube.
set -euo pipefail
node -v | grep -Eq '^v(2[4-9]|[3-9][0-9])\.'   # expect: exit 0 — Node ≥ 24 (recomendado: 24 LTS de .nvmrc)
B=blueprints/pollo-chilero-pos/workspace
test -d "$B"   # expect: exit 0 — el bundle está en su lugar
# 1) Copia de workspace/ SOLO de lo que falta: nunca sobrescribe package.json, package-lock.json ni un config que un paso
#    ya editó. Bucle portable en lugar de cp -n / rsync (cp -Rn sale con 1 en BSD/macOS al saltar; rsync no viene con
#    Git for Windows); sale con 0 aunque todo exista.
( cd "$B" && find . -type f -print ) | while IFS= read -r f; do
  [ -e "$f" ] || { mkdir -p "$(dirname "$f")" && cp "$B/$f" "$f"; }
done
# 2) Repositorio (idempotente) e identidad de commits local solo si no hay una configurada.
git rev-parse --git-dir >/dev/null 2>&1 || git init -b main
git config user.email >/dev/null 2>&1 || git config user.email "builder@pollo-chilero.local"
git config user.name >/dev/null 2>&1 || git config user.name "Builder Pollo Chilero"
# 3) Primer commit solo si el repo aún no tiene ninguno (los tags step-NN necesitan un commit base).
git rev-parse --verify HEAD >/dev/null 2>&1 || { git add -A && git commit -q -m "chore: andamiaje inicial (workspace del blueprint)"; }
# 4) Dependencias exactas de package.json (crea package-lock.json la primera vez; idempotente después).
npm install --no-audit --no-fund
```

Después del Bootstrap el builder empieza por `E1-T1` (paso 1), cuyo **Do** descarga Chromium (`npm run e2e:install`) y reconcilia el formato
(`npm run format`). Archivos que la copia nunca sobrescribe una vez existen: `package.json`, `package-lock.json` y cualquier config que un paso
haya editado — la copia solo agrega lo que falta.

---

## 11. Dependencies

Fuente de autoridad: el informe de versiones de `stack-researcher` de esta sesión (consultas a `registry.npmjs.org` y `nodejs.org` el 2026-11-22).
Las filas marcadas "esta sesión" se verificaron además al escribir el blueprint (registry y API de GitHub, 2026-11-22). El track `ts-node.md`
(2026-10-17) solo sirve de respaldo y no aportó ningún pin. Todas las dependencias npm se instalan con un único comando, `npm install --no-audit
--no-fund` del **§10 Bootstrap**, a partir del `package.json` emitido en `workspace/` con versiones exactas (sin `^`).

### Runtime

| Package | Version | Source (registry URL or track file) | Checked | Installed by | Purpose |
|---|---|---|---|---|---|
| Node.js | 24 (`.nvmrc`; 24.22.3 LTS) | https://nodejs.org/dist/index.json | 2026-11-22 | prerrequisito §10 (lo instala el desarrollador) | runtime de herramientas; vitest 5 exige `^22.12 \|\| ^24 \|\| >=26` |
| react · react-dom | 19.3.1 | https://registry.npmjs.org/react | 2026-11-22 | §10 Bootstrap | UI |
| react-router-dom | 7.18.6 | https://registry.npmjs.org/react-router-dom | 2026-11-22 | §10 Bootstrap | rutas `/pos`, `/panel` (no la 8: exige node ≥ 22.22 y cambia imports) |
| @tanstack/react-query | 5.108.3 | https://registry.npmjs.org/@tanstack/react-query (peers `react ^18 \|\| ^19`, leídos esta sesión) | 2026-11-22 | §10 Bootstrap | estado del servidor en el panel, polling 60 s |
| @supabase/supabase-js | 2.119.2 | https://registry.npmjs.org/@supabase/supabase-js | 2026-11-22 | §10 Bootstrap | RPC, Auth (anónimo, contraseña, TOTP), Storage |
| dexie | 4.4.7 | https://registry.npmjs.org/dexie | 2026-11-22 | §10 Bootstrap | IndexedDB de la caja |
| dexie-react-hooks | 4.4.0 | https://registry.npmjs.org/dexie-react-hooks (peer `dexie >=4.2.0-alpha.1 <5`, esta sesión) | 2026-11-22 | §10 Bootstrap | `useLiveQuery` |
| zod | 4.6.7 | https://registry.npmjs.org/zod | 2026-11-22 | §10 Bootstrap | validación de env y formularios |
| @point-of-sale/receipt-printer-encoder | 4.0.1 | https://registry.npmjs.org/@point-of-sale/receipt-printer-encoder (publicado 2026-09-18; `.d.ts` leído esta sesión) | 2026-11-22 | §10 Bootstrap | ESC/POS: texto, corte, pulso de gaveta. Reemplaza a `esc-pos-encoder` (deprecado) |
| class-variance-authority · clsx · tailwind-merge | 0.7.1 · 2.1.1 · 3.7.1 | https://registry.npmjs.org/class-variance-authority · /clsx · /tailwind-merge | 2026-11-22 | §10 Bootstrap | `cn()` y variantes de botón estilo shadcn |
| lucide-react | 1.77.0 | https://registry.npmjs.org/lucide-react | 2026-11-22 | §10 Bootstrap | íconos |
| tw-animate-css | 1.4.0 | https://registry.npmjs.org/tw-animate-css | 2026-11-22 | §10 Bootstrap | utilidades de animación que esperan los componentes shadcn (Tailwind v4) |

### Development

| Package | Version | Source (registry URL or track file) | Checked | Installed by | Purpose |
|---|---|---|---|---|---|
| vite | 8.3.8 | https://registry.npmjs.org/-/package/vite/dist-tags (engines node `^20.19.0 \|\| >=22.12.0`) | 2026-11-22 | §10 Bootstrap | build y preview |
| @vitejs/plugin-react-swc | 4.3.3 | https://registry.npmjs.org/@vitejs/plugin-react-swc (peer `vite ^4…^8`, esta sesión) | 2026-11-22 | §10 Bootstrap | JSX/TSX en Vite y Vitest |
| typescript | 6.0.3 | https://registry.npmjs.org/typescript (latest es 7.0.2; typescript-eslint 8.73.0 exige `>=4.8.4 <6.1.0`, esta sesión) | 2026-11-22 | §10 Bootstrap | tipos |
| @types/react · @types/react-dom | 19.3.0 · 19.3.0 | https://registry.npmjs.org/-/package/@types/react/dist-tags | 2026-11-22 | §10 Bootstrap | tipos de React |
| @types/node | 24.19.2 | https://registry.npmjs.org/@types/node (tag old-version; latest 26.6.6) | 2026-11-22 | §10 Bootstrap | tipos de Node 24 (vitest peer `^22 \|\| >=24`) |
| tailwindcss · @tailwindcss/vite | 4.3.5 · 4.3.5 | https://registry.npmjs.org/tailwindcss · /@tailwindcss/vite (peer vite `^5.2…^8`) | 2026-11-22 | §10 Bootstrap | estilos, configuración CSS-first |
| vite-plugin-pwa | 2.0.0 | https://registry.npmjs.org/vite-plugin-pwa (peers vite `^3…^8`, workbox `^7.4.1`, assets-generator opcional; esta sesión) | 2026-11-22 | §10 Bootstrap | service worker `dist/sw.js` y manifiesto |
| workbox-build · workbox-window | 7.4.1 · 7.4.1 | https://registry.npmjs.org/-/package/workbox-build/dist-tags (esta sesión) | 2026-11-22 | §10 Bootstrap | peers de vite-plugin-pwa, fijados explícitamente |
| vitest | 5.1.1 | https://registry.npmjs.org/vitest (peer vite `^6.4 \|\| ^7 \|\| ^8`; engines node `^22.12 \|\| ^24 \|\| >=26`) | 2026-11-22 | §10 Bootstrap | pruebas unitarias y de BD |
| jsdom | 31.0.1 | https://registry.npmjs.org/jsdom | 2026-11-22 | §10 Bootstrap | entorno DOM de Vitest |
| @testing-library/react · @testing-library/dom · @testing-library/user-event | 16.3.3 · 10.4.2 · 14.6.13 | https://registry.npmjs.org/@testing-library/react (peers react/dom 18–19 y `@testing-library/dom ^10`, esta sesión) | 2026-11-22 | §10 Bootstrap | pruebas de componentes |
| fake-indexeddb | 6.2.8 | https://registry.npmjs.org/fake-indexeddb (export `./auto`, esta sesión) | 2026-11-22 | §10 Bootstrap | IndexedDB en Node para Dexie |
| @electric-sql/pglite | 0.5.17 | https://registry.npmjs.org/@electric-sql/pglite (API `new PGlite`, `exec`, `query`, `transaction` leída en el `.d.ts`, esta sesión) | 2026-11-22 | §10 Bootstrap | Postgres en WASM para probar las migraciones reales sin Docker |
| @playwright/test | 1.65.1 | https://registry.npmjs.org/@playwright/test | 2026-11-22 | §10 Bootstrap (navegador: `npm run e2e:install`, paso 1) | e2e |
| eslint · @eslint/js | 10.15.0 · 10.0.1 | https://registry.npmjs.org/eslint · /@eslint/js (peer eslint ^10) | 2026-11-22 | §10 Bootstrap | lint |
| typescript-eslint | 8.73.0 | https://registry.npmjs.org/typescript-eslint (peer eslint `^8.57 \|\| ^9 \|\| ^10`, esta sesión) | 2026-11-22 | §10 Bootstrap | reglas TS |
| eslint-plugin-react-hooks | 7.1.1 | https://registry.npmjs.org/eslint-plugin-react-hooks (peer incluye eslint `^10.0.0`, esta sesión) | 2026-11-22 | §10 Bootstrap | reglas de hooks |
| globals | 17.14.0 | https://registry.npmjs.org/globals | 2026-11-22 | §10 Bootstrap | globales browser/node para ESLint |
| prettier | 3.10.1 | https://registry.npmjs.org/prettier | 2026-11-22 | §10 Bootstrap | formato |
| supabase (CLI) | 3.2.0 | https://registry.npmjs.org/-/package/supabase/dist-tags (esta sesión) | 2026-11-22 | §12 despliegue, a mano: `npx --yes supabase@3.2.0 …` (no está en `package.json`) | aplicar migraciones al proyecto real; nunca en un gate |
| actions/checkout · actions/setup-node | v7 (v7.0.1 · v7.1.0) | https://api.github.com/repos/actions/checkout/releases/latest · /actions/setup-node (esta sesión) | 2026-11-22 | `.github/workflows/ci.yml` (emitido en workspace) | CI en GitHub |

### Deliberately not used

| Rechazado | En su lugar | Por qué |
|---|---|---|
| `shadcn` CLI 4.23.0 (verificado en el registry) | componentes propios estilo shadcn; `components.json` listo | el CLI descarga de la red y agrega paquetes (Radix) no verificados; no puede correr dentro de un gate. Lovable puede usarlo después |
| `@testing-library/jest-dom` 8.0.0 | aserciones de Vitest sobre consultas por rol | la ruta de export `/vitest` de la v8 no está verificada; no es necesaria |
| `pgcrypto` / `uuid-ossp` | `sha256()`, `gen_random_uuid()`, `uuid_send()` nativos | no depender de extensiones que PGlite podría no tener |
| `typescript` 7.x | 6.0.3 | typescript-eslint 8.73.0 no la acepta |
| `react-router` 8 | `react-router-dom` 7.18.6 | exige node ≥ 22.22 y cambia los imports |
| `esc-pos-encoder` | `@point-of-sale/receipt-printer-encoder` | deprecado |
| WebUSB | Web Serial + `window.print()` | posible bloqueo de la clase impresora en Chrome (no verificado) |
| `supabase` como devDependency | `npx --yes supabase@3.2.0` solo al desplegar | su postinstall descarga un binario: haría frágil cada `npm install` del Bootstrap |
| Biome, Drizzle, Prisma, Next.js | ESLint + Prettier, RPC SQL, Vite SPA | ver §2 |

---

## 12. Deployment Strategy

### Hosting

- **Frontend:** sitio estático HTTPS. Comando de build `npm run build`, directorio de salida `dist/`, sin runtime de servidor; cualquier ruta
  desconocida debe servir `index.html` (SPA). Decisión: el hosting que provea Lovable si el usuario usa Lovable; **alternativa documentada:**
  Cloudflare Pages (gratuito, lee `dist/_headers`) o Netlify (igual). Vercel también sirve, con las cabeceras en `vercel.json`.
- **Backend:** un proyecto Supabase en la cuenta del usuario, región la más cercana disponible (us-east) **[SUPUESTO]**, plan **[PENDIENTE]**
  (ver §16: el gratuito pausa proyectos inactivos y no tiene PITR).

### Environments

| Ambiente | Rama | URL | Base de datos | Modo |
|---|---|---|---|---|
| Local / pruebas | cualquiera | http://127.0.0.1:5173 (dev) · 4173/4174 (e2e) | PGlite en proceso (pruebas) · proyecto Supabase de pruebas (dev) | valores falsos de `.env.test` / `.env.e2e*` |
| Ensayo | `main` | URL de vista previa del hosting | proyecto Supabase **de pruebas** (separado) | datos de prueba |
| Producción | `main` | dominio del local o el subdominio del hosting | proyecto Supabase de producción | datos reales |

### CI/CD

`.github/workflows/ci.yml` (emitido en `workspace/`) ejecuta en cada push a `main` y en cada PR, en este orden: `npm ci` → `npm run typecheck` →
`npm run lint` → `npm run format:check` → `npm run test` → `npm run test:db` → `npm run build` → `npx playwright install --with-deps chromium` →
`npm run e2e` → `npm audit --omit=dev --audit-level=high`. Es el mismo gate de §20.1. El despliegue del frontend lo hace el hosting al detectar el
push a `main` (integración Git del hosting); **las migraciones nunca se aplican desde CI**: las aplica el supervisor técnico a mano (abajo).

### Release and rollback

1. **Base de datos primero, siempre aditiva:** aplicar migraciones nuevas antes de publicar el frontend que las usa.
   `npx --yes supabase@3.2.0 login` → `npx --yes supabase@3.2.0 link --project-ref` seguido del identificador del proyecto (Project Settings → General → Reference ID) → `npx --yes supabase@3.2.0 db push` (o pegar cada
   archivo nuevo de `supabase/migrations/`, en orden, en el SQL Editor). Requiere red y la cuenta del usuario; **jamás en un gate**.
2. **Frontend después:** merge a `main` → el hosting publica. La caja recibe la nueva versión con el service worker (`autoUpdate`) al recargar.
3. **Rollback del frontend:** "promover" el despliegue anterior en el panel del hosting (≈1 min). **Rollback de la base:** no se revierten migraciones;
   se corrige con una migración nueva. Por eso toda migración es aditiva y la caja tolera eventos de la versión previa.

### Domain, DNS, TLS

Opcional en v1: el subdominio HTTPS del hosting sirve. Con dominio propio: registro `CNAME` al hosting, certificado TLS automático del hosting,
redirección `www` → apex. HTTPS es obligatorio (Web Serial, service worker y `Strict-Transport-Security`).

### Puesta en marcha de Supabase (una vez, manual — checklist §20.1)

1. Crear el proyecto; copiar Project URL y la publishable key a las variables del hosting.
2. Auth → Providers: Email activado, **registro público desactivado** (invite only); MFA → TOTP activado; Anonymous sign-ins **activado** para el
   emparejamiento de la caja **[PENDIENTE verificar compatibilidad con registro desactivado; si no, ruta alternativa del §8]**; Site URL = URL del hosting.
3. Aplicar las 7 migraciones (paso 1 de *Release*). Ejecutar el *Security Advisor* de Supabase y resolver todo hallazgo de severidad ERROR.
4. Invitar el correo del socio supervisor → SQL Editor: `select app.bootstrap_supervisor('correo-del-supervisor@dominio.hn', 'Nombre del supervisor');` (con el correo invitado y el nombre reales) → entrar al panel, enrolar TOTP,
   crear su PIN y los cajeros en *Administración*, generar el código de emparejamiento y emparejar la PC de caja.
5. Revisar el catálogo contra el menú físico **[PENDIENTE]** y ajustar precios en *Administración*.

### Respaldo diario **[PENDIENTE decisión de plan]**

Con plan pagado: respaldos diarios de Supabase (y PITR si se contrata). En cualquier plan, además: `pg_dump` diario desde una PC con cliente de
PostgreSQL 17 — exportar en esa terminal `SUPABASE_DB_URL` (§10) y ejecutar `pg_dump "$SUPABASE_DB_URL" --no-owner --format=custom --file=respaldo-$(date +%F).dump`
— guardado fuera de la PC de caja (nube del socio). Mensualmente, restaurar un respaldo en un proyecto de pruebas para comprobar que sirve.
La caja agrega su propio respaldo local: "Exportar respaldo de emergencia" (JSON con outbox, ventas y turnos).

### Ruta con Lovable

El usuario quiere usar **Lovable + Supabase**. Este repo usa el mismo stack que Lovable genera (React + TypeScript + Tailwind + estilo shadcn +
Supabase), construido con los gates de este bundle:

- **(a) Conectar el repo a Lovable** para editar la UI visualmente. **[PENDIENTE]** verificar si Lovable importa un repositorio GitHub existente. Si
  no lo hace, la alternativa es: crear el proyecto en Lovable, conectarlo a GitHub, clonar ese repo, mover este bundle a `blueprints/pollo-chilero-pos/`
  dentro de él y ejecutar el §10 Bootstrap allí — la copia de `workspace/` **no sobrescribe** el `package.json` ni los configs que Lovable ya creó, así
  que antes del paso 1 hay que **fusionar a mano** las dependencias y scripts del `package.json` de `workspace/` (versiones de §11) en el de Lovable y
  reemplazar sus configs de Vite/TypeScript/ESLint por los de `workspace/` si sus versiones son otras **[SUPUESTO: los defaults de Lovable no se pudieron
  verificar; mirrors de terceros muestran Vite 5 / Tailwind 3]**.
- **(b) El backend vive en Supabase** y `supabase/migrations/` es la fuente de verdad: se aplica con `supabase db push` o pegando en el SQL Editor. Si
  Lovable ofrece crear tablas o "arreglar" políticas desde su integración, **no se acepta**: todo cambio de esquema es una migración nueva en el repo.
- **(c) Lovable nunca edita** migraciones ya aplicadas, las funciones RPC ni `src/lib/backend.tsx` sin pasar los gates (`npm run typecheck`,
  `npm run lint`, `npm run test`, `npm run test:db`, `npm run e2e`); la regla está en `CLAUDE.md` (no negociable 5) y en `.claude/rules/base-de-datos.md`,
  y CI la vuelve a comprobar en cada push. Ningún comando de este blueprint crea recursos en la nube por sí solo.

---

## 13. Testing Strategy

| Capa | Framework | Qué cubre | Dónde | Corre |
|---|---|---|---|---|
| Unitaria / componentes | Vitest 5 + jsdom + Testing Library + fake-indexeddb | carrito e ISV, numeración, outbox, PIN PBKDF2, sincronización con transporte falso, recibo, formularios del panel, CSV | `src/**/*.test.ts(x)` | cada paso, CI |
| Base de datos | Vitest 5 (node) + PGlite 0.5 con `supabase/tests/shim.sql` | las migraciones reales: RLS, privilegios, segregación, idempotencia de eventos, inventario por receta, cierre/Z, numeración fiscal | `supabase/tests/*.test.ts` | cada paso desde el 3, CI |
| E2E | Playwright 1.65 (Chromium) contra el build de producción servido con `vite preview` | humo de las 3 pantallas de entrada (4173) y los 3 flujos críticos con backend simulado en el navegador (4174) | `e2e/*.spec.ts` | pasos de UI (humo), paso 18 (todo), CI |

### Critical flows to cover E2E

1. **Venta sin conexión → sincronización** — una venta hecha sin red debe llegar exactamente una vez.
2. **Anulación → aprobación** — la anulación pedida en caja la decide en el panel un supervisor distinto.
3. **Cierre ciego → reporte Z** — los 5 pasos en orden sin ver el esperado antes de contar.

### Test data

PGlite crea una base nueva por archivo de prueba (`createTestDb()` en `beforeAll`), aplica `shim.sql` y todas las migraciones, y los datos de cada
caso los crea `supabase/tests/fixtures.ts`; nada se comparte entre archivos ni depende del orden. Dexie usa fake-indexeddb y cada prueba borra la base
en `beforeEach`. Los e2e usan el backend simulado (`src/lib/mock-backend.ts`, estado en `localStorage`). La prueba de humo usa un contexto nuevo por prueba; los 3 flujos
críticos corren en **un solo `test.describe.serial` con un contexto compartido** creado en `beforeAll`, en orden (a) → (b) → (c), y cada flujo parte del
estado que dejó el anterior (dependencia declarada, no accidental).
**No hay servicio externo que provisionar:** ningún gate usa Supabase real, Docker ni red.

### What is deliberately not tested

- La impresión física en la ITP250 y la apertura real de la gaveta (necesitan el hardware) → §20.1.
- El comportamiento de Supabase Auth real (correo de invitación, TOTP real, inicio anónimo) → §20.1 contra el proyecto de ensayo.
- RLS en Supabase real: PGlite reproduce Postgres pero no el gateway de Supabase; las mismas sondas de §20.1 se corren en el SQL Editor.
- Estilos y textos decorativos; la cobertura porcentual (no hay umbral: los gates son los criterios del §9).

---

## 14. Security & Secrets

| Riesgo | Control | Dónde |
|---|---|---|
| Almacenamiento de secretos | no hay secretos en el cliente ni en el repo; la publishable key es pública por diseño; la `service_role` nunca sale del panel de Supabase | `.gitignore` (`.env`, `.env.*`), §10 |
| Rotación | rotar la publishable key y las contraseñas de socios si se pierde un equipo; rotar códigos de emparejamiento (vencen a los 15 min) | panel de Supabase |
| Validación de entrada | cada RPC valida su entrada en SQL; zod en el cliente solo para errores tempranos | `supabase/migrations/*`, `src/panel/forms.ts` |
| XSS | React escapa todo; sin `dangerouslySetInnerHTML` (el QR de TOTP llega como SVG en `data:` y se muestra con `<img src="data:…">`); CSP sin `unsafe-inline` en scripts | `src/panel/AuthScreens.tsx`, `public/_headers` |
| Inyección SQL | sin SQL construido en el cliente; dentro de las funciones solo `format('%I'…)` con nombres validados por regex | `pos_push_events` |
| AuthN / AuthZ | §8: identidad en cada RPC (`app.require_device` / `app.require_panel`), RLS con aal2, segregación en SQL | migraciones 0200–0500 |
| CSRF | no aplica: sin cookies; el JWT viaja en `Authorization` | — |
| Abuso / fuerza bruta | límites de Supabase Auth; PIN: bloqueo 30 s tras 5 fallos + alerta; códigos de emparejamiento de un solo uso y 15 min | Auth, `src/lib/pin.ts` |
| Escritura directa a tablas | `REVOKE INSERT/UPDATE/DELETE` a `anon`/`authenticated` en toda tabla; `anon` sin SELECT; pruebas de propiedad en cada `npm run test:db` | `app.secure_table`, `seguridad.test.ts` |
| Alteración de registros | `audit_log` con cadena sha256 y triggers que impiden UPDATE/DELETE/TRUNCATE; ventas, eventos y movimientos de solo inserción; `verify_audit_chain` en el panel | migraciones 0100, 0300, 0400 |
| PIN offline no re-verificable | aceptado (§20.2): caja emparejada, bitácora, cierre ciego y alertas | — |
| PIN en el dispositivo | se cachea solo sal + hash PBKDF2 (210 000 iteraciones); un PIN de 4 dígitos es descifrable por fuerza bruta si roban la PC: por eso la caja es un dispositivo revocable y el panel usa contraseña + TOTP | `src/lib/pin.ts` |
| Auditoría de dependencias | `npm audit --omit=dev --audit-level=high` en CI y antes de producción; lo corrige quien mantiene el repo | CI, §20.1 |
| Cabeceras de seguridad | ver bloque abajo (CSP, HSTS, X-Frame-Options, Referrer-Policy, nosniff, Permissions-Policy) | `public/_headers` → `dist/_headers` |
| Datos personales | nombres de personal y, a futuro, RTN/identidad de clientes de facturas > L 10,000 (columnas nulas en v1); sin datos de tarjetas | `staff`, `sales` |
| Higiene de logs | no se registran PIN, tokens ni referencias bancarias completas en consola; los errores visibles muestran solo el código | `src/lib/backend.tsx` |

**Reglas duras**
- Ningún secreto se versiona, se imprime en un log ni va en el bundle del cliente; todo lo que llega al navegador es público.
- Toda verificación de autorización del servidor ocurre antes del trabajo, en la primera línea de cada RPC.
- Las reglas `deny` de `.claude/settings.json` desalientan leer `.env.local`, hacer `git push` o usar la CLI de Supabase desde el agente; no son un
  aislamiento real (para eso, el sandbox de Claude Code).

**Régimen regulado:** datos tributarios hondureños — Ley del ISV y Acuerdo 481-2017 del SAR (facturación) **cuando se active**; la declaración
jurada del autoimpresor exige controles de auditoría, persistencia histórica y exportación de archivos, que este diseño ya trae (bitácora, inmutabilidad,
CSV) **[PENDIENTE trámite]**. No hay datos de salud, de menores ni de tarjetas.

### Cabeceras de seguridad

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

---

## 15. Accessibility

**Meta: WCAG 2.2 nivel AA.** El personal usa la caja todo el turno: operar con teclado y con objetivos grandes es productividad, no solo cumplimiento.

### Baseline requirements

| Requisito | Regla en este proyecto |
|---|---|
| HTML semántico | `<main>` en cada pantalla, un `<h1>` por pantalla (en la venta, `sr-only`), pestañas de categoría con `role="tablist"`/`tab`, listas como `<ul>` |
| Teclado | todo operable sin mouse: PIN y montos aceptan teclado físico; `Enter` confirma, `Escape` cierra diálogos; orden de tabulación lógico |
| Foco visible | `:focus-visible` con contorno de 3 px `#C8102E` (5.89:1 sobre blanco) en `src/index.css` |
| Contraste | paleta de §7 (todas las combinaciones de texto ≥ 4.5:1; rojo sobre amarillo solo en texto grande) |
| Formularios | cada campo con `<label>`; errores en texto con `role="alert"`, nunca solo color |
| Imágenes | el QR de TOTP con `alt="Código QR para la app autenticadora"`; íconos decorativos `aria-hidden` |
| Movimiento | `prefers-reduced-motion: reduce` anula animaciones (`src/index.css`) |
| Zoom / reflujo | el panel funciona a 320 px y 200 % sin scroll horizontal de página (las tablas tienen su propio scroll) |
| Regiones vivas | `SyncIndicator` con `role="status"` `aria-live="polite"`; confirmación de venta anunciada |

### WCAG 2.2 additions — the ones most often missed

| SC | Cómo se cumple |
|---|---|
| 2.4.11 Focus Not Obscured | la barra superior de la caja no es `sticky` sobre el contenido enfocable; los diálogos atrapan y devuelven el foco |
| 2.5.7 Dragging Movements | no hay arrastre: todo es tocar |
| 2.5.8 Target Size | objetivos de 72 × 72 px en la caja (`min-h-18 min-w-18`) y ≥ 44 px en el panel |
| 3.3.7 Redundant Entry | el asistente de cierre no vuelve a pedir datos de pasos anteriores; el último cajero queda preseleccionado |
| 3.3.8 Accessible Authentication | contraseña y TOTP aceptan pegar y gestores de contraseñas (`autocomplete="current-password"`, `one-time-code`) |

### Verification

```bash
npm run test   # expect: exit 0 — las pruebas de componentes consultan por rol y nombre accesible (getByRole/getByLabelText)
```

Las comprobaciones automáticas cubren cerca de un tercio de los problemas reales; antes de lanzar (§20.1): recorrido solo con teclado de los 3
flujos críticos, una pasada con lector de pantalla (NVDA en Windows) por la venta, y zoom al 200 % del panel en 320 px.

---

## 16. Observability & Cost

### Instrumentation

| Señal | Herramienta | Qué captura | Quién la mira |
|---|---|---|---|
| Errores de negocio | tabla `alerts` (generada por la base) | eventos rechazados, diferencias, huecos, anulaciones, reimpresiones, gaveta, stock bajo, PIN bloqueado, caja sin sincronizar | socio supervisor (panel) |
| Libro de eventos | `pos_events` | todo lo que envió la caja, con estado y error | supervisor / soporte |
| Bitácora | `audit_log` + `verify_audit_chain` | cada cambio de datos con actor | socios / contador |
| Errores de la app | consola del navegador + estado "Error" del indicador | rechazos y fallos de red en la caja | supervisor; sin rastreador externo en v1 (decisión §20.3 #11) |
| Salud del servidor | panel de Supabase (Reports, Logs) | uso de API, errores de Postgres | quien mantiene el sistema |

### The metrics that matter for this project

| Métrica | Meta | Alerta en |
|---|---|---|
| Eventos pendientes en la caja | 0 al cierre | > 0 al iniciar el cierre (bloquea con `TURNOS_ABIERTOS` si el turno no llegó) |
| Tiempo sin sincronizar con red | < 15 min | ≥ 2 h (`caja_sin_sincronizar`) |
| Diferencia de caja por cierre | ≤ L 50 | > L 50 (`diferencia_caja`) |
| Merma de piezas por día | ≤ 2 | > 2 (`merma`) |
| Eventos rechazados | 0 | ≥ 1 (`evento_rechazado`, severidad alta) |

### Health check

No hay servidor propio. "Salud" = `panel_summary.cajas[].last_seen_at` (la caja se reporta en cada sincronización y cada 5 min al pedir la
instantánea) + la alerta `caja_sin_sincronizar`. Lo consulta el panel cada 60 s mientras está abierto.

### Cost model

| Servicio | Plan gratuito | A la escala de v1 (~150 ventas/día) | A 10× | Límite a vigilar |
|---|---|---|---|---|
| Supabase | proyecto gratuito: pausa por inactividad, sin PITR | gratuito alcanza en volumen (MB de datos al año) | gratuito alcanza | la **pausa por inactividad** y la falta de PITR, no el volumen → **[PENDIENTE]** plan Pro (USD 25/mes según la propuesta previa; verificar precio vigente) |
| Hosting estático (Lovable / Cloudflare Pages / Netlify) | gratuito para un sitio pequeño | USD 0 | USD 0 | si se usa el plan de Lovable para editar, su suscripción |
| GitHub | gratuito (repo privado + Actions con minutos incluidos) | USD 0 | USD 0 | minutos de Actions |
| Hardware | — | UPS para la PC de caja (recomendado, §20.2) | — | — |

**Costo mensual estimado al lanzar: USD 0 en plan gratuito, o ≈ USD 25 con Supabase Pro [PENDIENTE].** El rubro mayor es Supabase Pro; la palanca
más barata es quedarse en gratuito con el `pg_dump` diario de §12, aceptando el riesgo de pausa (mitigado porque la caja usa la base cada día).

---

## 17. Model Routing

NOT APPLICABLE — this project does not call an LLM at runtime.

---

## 18. Skills to Use During Build

Nombres y comandos copiados de `knowledge/skills-registry.md`. Ninguna sin barra es un comando: se activan por intención. Si una no está instalada,
el builder sigue con la guía de este blueprint y lo anota en una línea.

| Skill | Pasos del §9 | Por qué | Instalación |
|---|---|---|---|
| `frontend-design` | 12, 15, 16, 17 | pantallas de venta y panel con dirección visual concreta | `/plugin marketplace add anthropics/skills` luego `/plugin install example-skills@anthropic-agent-skills` |
| `ui-ux-pro-max` | 12, 15, 17 | densidad de tablas, formularios y diálogos del panel sobre la paleta de §7 | `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill` luego `/plugin install ui-ux-pro-max@ui-ux-pro-max-skill` |
| `playwright-cli` | 1, 18 | e2e de humo y de los 3 flujos críticos | `npm install -g @playwright/cli@latest` luego `playwright-cli install --skills` |
| `agregar-migracion` (del proyecto, §19.4) | 3–7 y todo cambio SQL posterior | migración aditiva + `app.secure_table` + prueba PGlite | ya incluida en `.claude/skills/` (copiada por el Bootstrap) |
| `agregar-evento-pos` (del proyecto, §19.4) | 10–14 y todo evento nuevo | outbox + `app.ev_<tipo>` + pruebas de duplicado | ya incluida en `.claude/skills/` |

---
## 19. Agent Workspace

El repo destino trae su propia configuración de agente y **todos** los archivos que los gates necesitan, como archivos reales bajo
`blueprints/pollo-chilero-pos/workspace/`, en la misma ruta que ocupan en el proyecto:

```
blueprints/pollo-chilero-pos/workspace/
├── CLAUDE.md                        # §19.1
├── AGENTS.md                        # §19.2
├── .claude/settings.json            # §19.3
├── .claude/skills/agregar-migracion/SKILL.md · agregar-evento-pos/SKILL.md   # §19.4
├── .claude/rules/base-de-datos.md · pos-offline.md · panel.md · pruebas.md   # §19.5
└── (configs verify-critical de §19.6: package.json, tsconfig.json, vite.config.ts, vitest.config.ts, vitest.db.config.ts,
     playwright.config.ts, eslint.config.js, .prettierrc.json, .prettierignore, .gitignore, .gitattributes, .nvmrc, .env.example,
     .env.test, .env.e2e, .env.e2e-mock, components.json, index.html, src/main.tsx, src/index.css, src/test/setup.ts,
     supabase/tests/shim.sql, supabase/tests/harness.ts, public/icon.svg, .github/workflows/ci.yml)
```

**Dónde vive el repo:** el repositorio destino se crea **fuera de OneDrive** (por ejemplo `C:\dev\pollo-chilero-pos`) y este bundle se copia a
`<repo>/blueprints/pollo-chilero-pos/` antes del Bootstrap. **Nunca** ejecute el Bootstrap dentro de la carpeta de OneDrive "ERP Pollos": la
sincronización de OneDrive bloquea archivos de `node_modules/` y `.git/`, y esa carpeta contiene los insumos (`.xlsm`, `.docx`, fotos) que no
deben entrar al repo (`.gitignore` excluye `*.xlsm`, `*.docx`, `*.dump` y `respaldo-*.json` por si acaso).

`workspace/` existe para que el builder copie **un directorio** a la raíz del proyecto. **La copia es la del §10 Bootstrap y es segura de
re-ejecutar:** copia solo los archivos que faltan con un bucle portable, así que nunca revierte `package.json`, `package-lock.json` ni un config
que un paso ya editó (archivos que nunca se sobrescriben una vez existen: todos), y sale con 0 en la segunda ejecución:

```bash
B=blueprints/pollo-chilero-pos/workspace
( cd "$B" && find . -type f -print ) | while IFS= read -r f; do
  [ -e "$f" ] || { mkdir -p "$(dirname "$f")" && cp "$B/$f" "$f"; }
done   # solo lo que falta; no usa cp -Rn (sale con 1 en BSD/macOS al saltar) ni rsync (no viene en Git for Windows)
```

**Los archivos emitidos pasan los gates del propio proyecto.** El estilo que manda es el de `.prettierrc.json` emitido (2 espacios, comillas
dobles, punto y coma, comas finales `all`, ancho 100, LF), no el valor por defecto de Prettier; Markdown e `index.html` están excluidos del
formateador en `.prettierignore` y el paso 1 ejecuta `npm run format` una vez para reconciliar cualquier diferencia de formato de los archivos
copiados. **`.claude/commands/` no se emite**: todo flujo repetible es una skill (§19.4).

### 19.1 `CLAUDE.md`

Contenido completo de `workspace/CLAUDE.md` (idéntico al archivo; menos de 200 líneas):

````markdown
# Pollo Chilero — POS + Inventario (Etapa 1)

POS web offline-first para la caja del local "Pollo Chilero" (El Ocotal, Olanchito, Yoro) con
inventario por receta, cierre ciego y panel móvil con MFA para los 3 socios. Todo en español (es-HN).

## Comandos (Git Bash, desde la raíz del repo)

| Tarea | Comando |
|---|---|
| Instalar | `npm install --no-audit --no-fund` (CI: `npm ci`) |
| Servidor de desarrollo | `npm run dev` — http://127.0.0.1:5173 (requiere `.env.local`) |
| Build | `npm run build` → `dist/` (incluye `dist/sw.js`) |
| Tipos | `npm run typecheck` |
| Lint / formato | `npm run lint` · `npm run format:check` · arreglar: `npm run format` |
| Pruebas unitarias | `npm run test` · un archivo: `npm run test -- src/pos/cart.test.ts` |
| Pruebas de BD (PGlite) | `npm run test:db` · un archivo: `npm run test:db -- supabase/tests/ventas.test.ts` |
| Navegadores e2e | `npm run e2e:install` (una vez) |
| E2E | `npm run e2e` · humo: `npm run e2e -- e2e/smoke.spec.ts` |

**Gate de cada tarea:** `npm run typecheck && npm run lint && npm run format:check && npm run test`
y, desde el paso 3, también `npm run test:db`; luego `npm run build`. Ninguna tarea se marca `done`
con un gate en rojo. El orden de construcción está en `blueprints/pollo-chilero-pos/tasks.json`
(protocolo de reanudación) y cada tarea se ejecuta leyendo SOLO su archivo `epics/NN-*.md`.

Node 24 (`.nvmrc`). Versiones exactas en `package.json` y `package-lock.json`: léalas, no adivine.

## Stack

Vite + React 19 + TypeScript 6 · Tailwind v4 (tokens en `src/index.css`) · react-router-dom 7 ·
TanStack Query (panel) · Dexie/IndexedDB (caja) · vite-plugin-pwa · Supabase (Postgres + Auth + RLS
+ Storage) · Vitest (jsdom) · PGlite (pruebas SQL) · Playwright · ESLint + Prettier.

## Arquitectura

**Caja (`/pos`)**: todo se escribe primero en Dexie (`src/pos/db.ts`). Cada acción genera un evento
inmutable en `outbox` con `client_seq` consecutivo (`src/pos/outbox.ts`); la venta, el número de
recibo `R-00000001` y su evento se escriben en UNA transacción Dexie. `src/pos/sync.ts` envía los
pendientes a la RPC `pos_push_events` (idempotente por `(device_id, client_seq)`) con reintento
exponencial. Catálogo/staff/ajustes llegan por `pos_pull_snapshot`.
Ruta: pantalla → `src/pos/*.ts` (lógica pura) → Dexie → `sync.ts` → `src/lib/backend.tsx` → Supabase.

**Panel (`/panel`)**: Supabase Auth email+contraseña + TOTP (aal2). Lee con `panel_summary` /
`panel_list` y escribe con RPC del supervisor, vía TanStack Query (polling 60 s, sin realtime).

**Base de datos**: `supabase/migrations/*.sql` es la fuente de verdad. Ninguna tabla acepta
INSERT/UPDATE/DELETE de `anon`/`authenticated`; toda escritura es una función `SECURITY DEFINER`
con `set search_path = ''` que valida identidad (`app.require_device()` / `app.require_panel()`).
Triggers escriben `audit_log` (cadena sha256) en toda tabla de negocio.

| Capa | Puede importar | Nunca |
|---|---|---|
| `src/pos/**` | `src/lib/**`, `src/pos/**` | `src/panel/**`, llamar Supabase sin `backend` |
| `src/panel/**` | `src/lib/**`, `src/panel/**` | `src/pos/**`, Dexie |
| `src/lib/**` | `src/lib/**` | `src/pos/**`, `src/panel/**` |
| `supabase/tests/**` | `./harness`, `./fixtures` | código de `src/` |

| Asunto | Única fuente de verdad |
|---|---|
| Esquema y reglas de negocio | `supabase/migrations/` (+ pruebas `supabase/tests/`) |
| Variables de entorno | `src/lib/env.ts` (zod); nunca `import.meta.env` en otro archivo |
| Backend (RPC, auth, storage) | `src/lib/backend.tsx` (`useBackend()`); clientes `pos` y `panel` separados |
| Hash de PIN | `src/lib/pin.ts` (PBKDF2-SHA256 WebCrypto) |
| Formato de dinero | `formatLempiras()` en `src/lib/utils.ts` — `L 1,234.50`, sin `Intl` |
| Tokens de diseño | `src/index.css` (`@theme`) |

## Reglas de código

1. **Imports:** dentro de `src/` siempre `@/…` sin extensión (`import { cn } from "@/lib/utils"`);
   en `supabase/tests/` y `e2e/` rutas relativas sin extensión (`./harness`). No hay scripts sueltos
   ejecutados con `node`: toda lógica corre bajo Vite, Vitest o Playwright.
2. **Máximo 400 líneas por archivo**; más, se divide por responsabilidad. Sin archivos barril.
3. **Validar en el borde:** toda entrada de formulario pasa por un esquema zod antes de llamar una RPC.
4. **Errores de backend:** `BackendError { code, message }`; `code` es el prefijo antes de `:` del
   mensaje SQL (`CODIGO_INVALIDO`, `NO_AUTORIZADO`, …) o `RED` si no hay conexión.
5. **Dinero:** `numeric` en SQL; en TS se redondea a 2 decimales con `round2()` de `src/lib/utils.ts`.
6. **Horas:** Honduras es UTC-6 sin horario de verano; usar `toLocalHN()` de `src/lib/utils.ts`.
7. **Pantallas de entrada** conservan su `h1`: `/` "POLLO CHILERO", `/pos` contiene "Caja",
   `/panel` contiene "Panel de socios" (los usa `e2e/smoke.spec.ts`).
8. **Sin dependencias nuevas** sin anotar el motivo en el commit; nunca `shadcn add` en un gate.

## Diseño

| Token | Valor | Uso |
|---|---|---|
| `primary` | `#c8102e` | botones de acción, encabezados, foco (texto blanco 5.89:1) |
| `accent` | `#ffd200` | pestaña de categoría activa (texto `#1f1f1f` 11.35:1) |
| `brand-orange` | `#f28c00` | solo encabezado/splash (texto `#1f1f1f`, nunca blanco) |
| `background` / `surface` | `#f5f5f5` / `#ffffff` | página / tarjetas |
| `foreground` / `muted-foreground` | `#1f1f1f` / `#5c5c5c` | texto / secundario |
| `success` / `warning` / `destructive` | `#1e7b34` / `#8a5200` / `#b00020` | estados (texto blanco ≥ 5.3:1) |

- Tipografía del sistema `system-ui, "Segoe UI", Roboto`, 700 en botones y encabezados; sin fuentes externas.
- Caja: tema claro, botones de producto `min-h-18 min-w-18` (72 px) con nombre y precio, pestañas de
  categoría grandes arriba, carrito a la derecha, total `text-5xl`, teclado numérico en pantalla.
- Panel: móvil primero, ancho máximo `max-w-5xl`. Radio `rounded-xl` en tarjetas, `rounded-lg` en botones.
- Movimiento: 150 ms `ease-out`, solo `opacity`/`transform`; respeta `prefers-reduced-motion`.

## Entorno

| Variable | Requerida desde | Uso |
|---|---|---|
| `VITE_SUPABASE_URL` | paso 8 | `src/lib/env.ts` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | paso 8 | `src/lib/env.ts` |

`.env.example`, `.env.test`, `.env.e2e` y `.env.e2e-mock` se versionan (valores falsos). `.env.local`
con valores reales nunca.

## Reglas por área

| Archivo | Aplica a |
|---|---|
| `.claude/rules/base-de-datos.md` | `supabase/**` |
| `.claude/rules/pos-offline.md` | `src/pos/**` |
| `.claude/rules/panel.md` | `src/panel/**` |
| `.claude/rules/pruebas.md` | `**/*.test.ts`, `**/*.test.tsx`, `e2e/**` |

## No negociable

1. Nunca escribir tablas directo desde el cliente: solo RPC `SECURITY DEFINER` que validan rol. Una
   tabla nueva llama `select app.secure_table('public.x'::regclass);` en su misma migración.
2. Nunca editar una migración ya aplicada en Supabase: se agrega una nueva (skill `agregar-migracion`).
3. Nunca borrar ni editar ventas, eventos, movimientos ni la bitácora: se anula o se ajusta.
4. Nunca enviar ni guardar un PIN en claro: solo sal + hash PBKDF2 (≥ 100 000 iteraciones).
5. Lovable puede editar UI, nunca `supabase/migrations/`, RPC ni `src/lib/backend.tsx` sin pasar los gates.
6. Nunca hacer `git push`, `supabase db push` ni crear recursos en la nube desde un gate.
7. Nunca marcar una tarea `done` con un gate fallando, ni editar un comando `verify` para que pase.
````

### 19.2 `AGENTS.md`

Contenido completo de `workspace/AGENTS.md`:

````markdown
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
````

### 19.3 `.claude/settings.json`

Cada comando de los `Verify` del §9 y de §20.1, dividido por `&&`, `||`, `;` y `|`, tiene su entrada exacta o de prefijo del propio proyecto (`npm run test:*` cubre `npm run test -- <ruta>` y `npm run test:db …`; `npm run e2e:*` cubre `npm run e2e -- <ruta>` y `npm run e2e:install`); `test` está permitido para las aserciones `test -f` y `test "$status" -eq 1`; `grep`, `tail` y los `git` de lectura son de solo lectura. Sin intérpretes sueltos, sin `npx` comodín, sin `curl`. Se niegan lectura de `.env` reales, `git push` y la CLI de Supabase.

```json
{
  "permissions": {
    "allow": [
      "Bash(node -v)",
      "Bash(npm -v)",
      "Bash(npm install --no-audit --no-fund)",
      "Bash(npm ci)",
      "Bash(npm run typecheck)",
      "Bash(npm run lint)",
      "Bash(npm run format)",
      "Bash(npm run format:check)",
      "Bash(npm run test)",
      "Bash(npm run test:*)",
      "Bash(npm run build)",
      "Bash(npm run build:*)",
      "Bash(npm run e2e)",
      "Bash(npm run e2e:*)",
      "Bash(npm audit --omit=dev --audit-level=high)",
      "Bash(test:*)",
      "Bash(grep:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git tag:*)",
      "Bash(git add -A)",
      "Bash(git commit -m:*)",
      "Bash(git ls-files:*)",
      "Bash(git check-ignore:*)",
      "Bash(git rev-list:*)",
      "Bash(git rev-parse:*)",
      "Bash(git init -b main)",
      "Bash(git config user.email:*)",
      "Bash(git config user.name:*)",
      "Bash(git commit -q -m:*)",
      "Bash(tail -n 1)",
      "Bash(find . -type f -print)",
      "Bash(mkdir -p:*)",
      "Bash(cp:*)",
      "Bash(dirname:*)",
      "Bash(npx playwright install --with-deps chromium)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.local)",
      "Read(./.env.production)",
      "Read(./.env.production.local)",
      "Bash(git push:*)",
      "Bash(npx supabase:*)",
      "Bash(supabase:*)"
    ]
  }
}
```

### 19.4 Project skills — `.claude/skills/<name>/SKILL.md`

| Skill | Se activa con | Qué automatiza |
|---|---|---|
| `agregar-migracion` | "nueva tabla", "agregar columna", "nueva RPC", "migración" | migración aditiva con `app.secure_table`, funciones `SECURITY DEFINER` y su prueba PGlite |
| `agregar-evento-pos` | "nuevo evento POS", "registrar X desde la caja" | tipo en `outbox.ts` + `app.ev_<tipo>` + pruebas aplicado/rechazado/duplicado |

`workspace/.claude/skills/agregar-migracion/SKILL.md`:

````markdown
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
````

`workspace/.claude/skills/agregar-evento-pos/SKILL.md`:

````markdown
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
````

### 19.5 `.claude/rules/*.md`

| Archivo | Globs `paths` | Cubre |
|---|---|---|
| `.claude/rules/base-de-datos.md` | `supabase/**` | migraciones, RPC, RLS, bitácora, errores |
| `.claude/rules/pos-offline.md` | `src/pos/**` | Dexie, transacción venta+recibo+evento, sync, PIN, impresión |
| `.claude/rules/panel.md` | `src/panel/**` | MFA, consultas, roles, cierre ciego |
| `.claude/rules/pruebas.md` | `**/*.test.ts`, `**/*.test.tsx`, `e2e/**` | Vitest, PGlite, Playwright |

`workspace/.claude/rules/base-de-datos.md`:

````markdown
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
````

`workspace/.claude/rules/pos-offline.md`:

````markdown
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
````

`workspace/.claude/rules/panel.md`:

````markdown
---
description: Convenciones del panel de socios (auth MFA, consultas, roles)
paths:
  - "src/panel/**"
---

# Panel de socios

- Acceso: sesión Supabase `aal2` + `panel_whoami`; sin eso solo se ve el login o el enrolamiento TOTP.
- Lecturas con `useQuery` sobre `panel_summary` / `panel_list`, `refetchInterval: 60000`. Sin realtime.
- Escrituras con `useMutation` a una RPC; tras éxito, `invalidateQueries` de la lista afectada.
- Socio = solo lectura: los botones de supervisor no se renderizan (y la RPC igual lo rechaza).
- Formularios validados con los esquemas zod de `src/panel/forms.ts` antes de llamar a la RPC.
- El cierre del día no muestra el efectivo esperado antes de que se envíe el conteo.
- Móvil primero: una columna bajo 640 px, tablas con desplazamiento horizontal propio.
````

`workspace/.claude/rules/pruebas.md`:

````markdown
---
description: Convenciones de pruebas (Vitest, PGlite, Playwright)
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "e2e/**"
---

# Pruebas

- Prohibido `.skip(` y `.only(`: el gate lo busca con grep.
- Pruebas de BD: `createTestDb()` en `beforeAll`, una instancia por archivo; datos con `./fixtures`.
- Errores esperados con `dbFailure(promesa)` y aserción sobre `code` y el prefijo del mensaje.
- Pruebas de componentes: `@testing-library/react` + `user-event`, consultas por rol y texto visible.
- Dexie en pruebas: `fake-indexeddb/auto` (ya en `src/test/setup.ts`); borre la BD en `beforeEach`.
- El backend en pruebas unitarias es un objeto falso `fake` que implementa `Backend`; nunca red real. Se inyecta con
  `vi.mock("@/lib/backend-impl", () => ({ createBackendImpl: () => fake }))` y en `beforeEach` se llama `resetBackendForTests()` y
  `queryClient.clear()` (de `@/lib/backend`) para que ni el singleton por tipo ni la caché de TanStack Query pasen de una prueba a otra.
- Tiempo: `vi.useFakeTimers()` para reintentos y polling; restaure con `vi.useRealTimers()`.
- E2E: selectores por rol/texto; el humo solo usa pantallas de entrada.
````


### 19.6 Verify-critical config and local infrastructure

Bundle: todos son archivos reales en `workspace/`, con contenido completo, en su ruta del proyecto. No hay servicios locales que levantar: la base de
datos de los gates es PGlite en proceso (por eso no hay `docker-compose.yml` ni variable de conexión).

| Archivo | Ruta en el proyecto | Lo necesitan los Verify de | Resolución / env que trae | Exclusión del bundle |
|---|---|---|---|---|
| `package.json` | `package.json` | todos (scripts `typecheck`, `lint`, `format:check`, `test`, `test:db`, `build`, `preview`, `build:e2e-mock`, `preview:e2e-mock`, `e2e`, `e2e:install`) | `"type": "module"`; versiones exactas de §11 | n/a — no recorre el árbol |
| `tsconfig.json` | `tsconfig.json` | 1–18 (`npm run typecheck`) | `moduleResolution: bundler`, `paths` `@/*` → `./src/*`, `allowImportingTsExtensions`, `types: ["vite/client","node"]` | `"exclude": [..., "blueprints"]` |
| `vite.config.ts` | `vite.config.ts` | 1–18 (`npm run build`), e2e | alias `@` → `src` y, solo en el modo `e2e-mock` y si el archivo existe, `@/lib/backend-impl` → `src/lib/mock-backend.ts`; PWA genera `dist/sw.js`; Vite carga `.env.<modo>` | Vite compila solo lo que importa `index.html`; el plugin `@tailwindcss/vite` sí recorre el árbol y lo excluye `src/index.css` (`@source not "../blueprints";`) |
| `vitest.config.ts` | `vitest.config.ts` | 1–18 (`npm run test`) | alias `@`, plugin React SWC, `setupFiles` `src/test/setup.ts`, modo `test` carga `.env.test` | `exclude: [..., "blueprints/**", ...]` |
| `vitest.db.config.ts` | `vitest.db.config.ts` | 3–18 (`npm run test:db`) | entorno node; no lee variables | `exclude: [..., "blueprints/**"]` |
| `playwright.config.ts` | `playwright.config.ts` | 1, 8–18 (`npm run e2e`) | dos `webServer` (4173 modo `e2e`, 4174 modo `e2e-mock`), `serviceWorkers: "block"` | `testDir: "./e2e"` — nunca mira `blueprints/` |
| `eslint.config.js` | `eslint.config.js` | 1–18 (`npm run lint`) | typescript-eslint + react-hooks (reglas por nombre) | `globalIgnores(["blueprints/**", ...])` |
| `.prettierrc.json` · `.prettierignore` | raíz | 1–18 (`npm run format:check`) | estilo del proyecto; `tsconfig.json` sin comas finales | `.prettierignore`: `blueprints/` |
| `.gitignore` · `.gitattributes` | raíz | Checkpoints, §20.1 | excepciones `!.env.example`, `!.env.test`, `!.env.e2e`, `!.env.e2e-mock`; LF | n/a (el bundle SÍ se versiona) |
| `.env.test` · `.env.e2e` · `.env.e2e-mock` · `.env.example` | raíz | 8–18 (Vitest y builds e2e) | valores falsos de §10; los carga Vite por modo | n/a |
| `index.html` · `src/main.tsx` · `src/index.css` · `public/icon.svg` | raíz / `src` / `public` | 1–18 (build y e2e) | `src/main.tsx` importa `@/App` (lo crea el paso 1) | `src/index.css`: `@source not "../blueprints";` (la detección automática de fuentes de Tailwind v4 no escanea el bundle) |
| `src/test/setup.ts` | `src/test/setup.ts` | 1–18 (`npm run test`) | `fake-indexeddb/auto`; WebCrypto de Node si jsdom no trae `subtle` | n/a |
| `supabase/tests/shim.sql` · `supabase/tests/harness.ts` | `supabase/tests/` | 3–18 (`npm run test:db`) | imita `auth.uid()`/`auth.jwt()`/`auth.users`, roles `anon`/`authenticated`/`service_role`, `storage`, privilegios por defecto de Supabase; aplica migraciones en orden | n/a |
| `components.json` | raíz | ninguno (Lovable/shadcn) | alias `@/components`, `@/lib/utils` | n/a |
| `.github/workflows/ci.yml` | `.github/workflows/` | CI | Node desde `.nvmrc` | n/a |

**Única excepción de "no editar":** si la API instalada de `@electric-sql/pglite` difiere de la leída en su `.d.ts` (`new PGlite()`, `exec`, `query`,
`transaction`), el builder puede ajustar `supabase/tests/harness.ts` conservando las firmas exportadas `createTestDb`, `asRole`, `dbFailure`.

**Herramientas que leen variables de entorno:** solo Vite (dev, build, preview) y Vitest, que cargan `.env.<modo>` por sí mismos (modos `test`, `e2e`,
`e2e-mock`, `production`). PGlite, ESLint, Prettier y Playwright no leen ninguna variable del proyecto (Playwright solo `CI`). No hay CLI de
migraciones ni scripts sueltos en los gates, así que no hace falta ningún cargador `dotenv`.

#### Resolution convention matrix

**La convención, una sola vez:** dentro de `src/`, todo import entre módulos del proyecto usa el alias `@/` **sin extensión**
(`import { cn } from "@/lib/utils"`); en `supabase/tests/` y `e2e/` se usan rutas relativas **sin extensión** (`./harness`). No existen scripts
ejecutados con `node` suelto.

| Contexto | Comando que lo ejercita | Forma | Config + ajuste literal que la hace funcionar |
|---|---|---|---|
| Código de la app | `npm run build` (`vite build`) | `@/lib/utils` | `vite.config.ts` — `resolve.alias` (arreglo) con `{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) }` |
| Verificación de tipos | `npm run typecheck` (`tsc --noEmit`) | `@/lib/utils`, `./harness` | `tsconfig.json` — `"moduleResolution": "bundler"`, `"paths": { "@/*": ["./src/*"] }` |
| Pruebas unitarias | `npm run test` (`vitest run`) | `@/lib/utils` | `vitest.config.ts` — mismo `resolve.alias["@"]` (Vitest no hereda `vite.config.ts` porque existe `vitest.config.ts`) |
| Implementación del backend | `npm run build` · `npm run build:e2e-mock` · `npm run typecheck` | `@/lib/backend-impl` | `vite.config.ts` — alias por modo (`e2e-mock` → `src/lib/mock-backend.ts`, resto → `src/lib/backend-impl.ts` vía `@`); `tsconfig.json` — `paths` `@/*` resuelve siempre al real, y el simulado se tipa con `CreateBackendImpl` |
| Pruebas de BD | `npm run test:db` (`vitest run --config vitest.db.config.ts`) | `./harness`, `./fixtures` | resolución por defecto de Vite/Vitest para relativas sin extensión; no usa alias |
| E2E | `npm run e2e` (`playwright test`) | `@playwright/test`, relativas | transformación TS propia de Playwright; los specs no importan `src/` |
| Scripts sueltos | — | — | **No existen.** Si algún día se agrega uno, se ejecuta con Vitest o Vite, nunca con `node archivo.ts` |
| ESLint | `npm run lint` | — | no resuelve imports (sin `eslint-plugin-import`) |

#### Cross-artifact value reconciliation

| Valor compartido | Fuente única | Valor literal | Otros lugares donde aparece | Comparado |
|---|---|---|---|---|
| Directorio de salida del build | Vite (valor por defecto de `build.outDir`) | `dist` | `.gitignore` `dist/`, `.prettierignore`, `eslint.config.js`, `tsconfig.json` exclude, `vitest.config.ts` exclude, §12 hosting, Verify pasos 1 y 18 | sí |
| Service worker generado | vite-plugin-pwa (`generateSW`, nombre por defecto) | `dist/sw.js` | Verify paso 1 (`test -f dist/sw.js`), §6 | sí |
| Cabeceras publicadas | `public/_headers` (paso 18) | `dist/_headers` | Verify paso 18, §14 | sí |
| Salida del build e2e simulado | `package.json` script `build:e2e-mock` (`--outDir dist-e2e-mock`) | `dist-e2e-mock` | `preview:e2e-mock`, `.gitignore`, `.prettierignore`, `eslint.config.js`, `tsconfig.json`, `vitest.config.ts` | sí |
| Puerto de la prueba de humo | `package.json` script `preview` | `127.0.0.1:4173` | `playwright.config.ts` (`url`, `baseURL` del proyecto `smoke`) | sí |
| Puerto de los flujos e2e | `package.json` script `preview:e2e-mock` | `127.0.0.1:4174` | `playwright.config.ts` (`url`, `baseURL` del proyecto `flujos`) | sí |
| Modos de Vite y archivos de entorno | `package.json` / `playwright.config.ts` | `e2e` → `.env.e2e`; `e2e-mock` → `.env.e2e-mock`; `test` → `.env.test` | `.gitignore` excepciones, §10 | sí |
| Entrada de la app | `index.html` | `/src/main.tsx` | `src/main.tsx` existe en workspace | sí |
| Módulo que implementa el backend | `vite.config.ts` `resolve.alias` | `@/lib/backend-impl` → `src/lib/backend-impl.ts`; en modo `e2e-mock` → `src/lib/mock-backend.ts` | `src/lib/backend.tsx` (import), `tsconfig.json` `paths`, pasos 8 y 18 | sí |
| Alias de imports | `tsconfig.json` `paths` | `@/*` → `./src/*` | `vite.config.ts`, `vitest.config.ts`, `components.json` (`@/components`, `@/lib/utils`) | sí |
| Archivo de configuración de BD de pruebas | `package.json` script `test:db` | `vitest.db.config.ts` | archivo emitido, `tsconfig.json` include | sí |
| Ruta del bundle | estructura del bundle | `blueprints/` (bundle en `blueprints/pollo-chilero-pos/`) | `eslint.config.js`, `.prettierignore`, `tsconfig.json`, `vitest.config.ts`, `vitest.db.config.ts`, `src/index.css` (`../blueprints` relativo a `src/`), §10 Bootstrap `B=` | sí |
| Nombre de la base IndexedDB | `src/pos/db.ts` (paso 9) | `pollo-chilero-pos` | §4, epic 02 | sí |
| Claves de sesión de Supabase | `src/lib/backend.tsx` (paso 8) | `pc-pos-auth` · `pc-panel-auth` | §8, epic 02 | sí |
| Migraciones | §3 / §4 | `20261122000100_esquema_base.sql` … `20261122000600_fiscal.sql` | pasos 3–7, `tasks.json` `files`, Checkpoints | sí |

Contratos ejercitados en el primer paso donde existen ambos lados: build ↔ PWA ↔ `index.html` ↔ `src/main.tsx` ↔ puertos de Playwright → paso 1
(construye **y abre** el build de producción); `public/_headers` ↔ `dist/_headers` → paso 18; `package.json` `test:db` ↔ `vitest.db.config.ts` ↔
`harness.ts` ↔ migraciones → paso 3.

#### Byte-exact artifact reconciliation

Este blueprint no escribe archivos dorados ni salidas esperadas byte a byte: el recibo, el Z y la factura se prueban por contenido y ancho de línea.
La única aserción sobre bytes producidos por una librería es la presencia de subsecuencias ESC/POS estándar:

| Artefacto byte-exact | Lo escribe | Se compara en | Reglas del blueprint que lo restringen | Llamada en el runtime fijado (§11) | Ambas confirmadas |
|---|---|---|---|---|---|
| Subsecuencias `1b 40`, `1d 56`, `1b 70` en la salida de `encode()` | `src/pos/print/escpos.ts` (paso 2) | pasos 2 y 14 | §6 *Recibo de venta* (initialize → líneas → pulse → cut); ESC/POS estándar | Tras `npm install`: `node --input-type=module -e "import E from '@point-of-sale/receipt-printer-encoder'; const b = new E({ language: 'esc-pos', columns: 48 }).initialize().line('x').pulse().cut().encode(); console.log(Buffer.from(b).toString('hex'))"` → debe contener `1b40`, `1b70` y `1d56` | reglas: sí · runtime: **no ejecutado al escribir** (sin Node en la máquina de diseño) — ver la nota |

**Nota:** si ese comando no muestra alguna de las tres subsecuencias, el builder **SE DETIENE Y LO REPORTA** (con la salida hexadecimal obtenida); nunca
edita la aserción de la prueba para que pase ni cambia la librería. Decidir el ajuste es una decisión de diseño fuera del build.

---

## 20. Acceptance Gate, Risks & Decision Log

### 20.1 Global acceptance gate

El proyecto está **terminado** cuando cada comando de abajo sale con 0 en un checkout limpio (Git Bash, raíz del repo), y no antes. Es el mismo
conjunto que corre CI.

```bash
npm ci   # expect: exit 0 — instala exactamente el lockfile
npm run typecheck   # expect: exit 0
npm run lint   # expect: exit 0, 0 errores y 0 advertencias (--max-warnings 0)
npm run format:check   # expect: exit 0
npm run test   # expect: exit 0, 0 fallidas
npm run test:db   # expect: exit 0, 0 fallidas — incluye las pruebas de propiedad de seguridad y bitácora
npm run build   # expect: exit 0
test -f dist/sw.js   # expect: exit 0 — el artefacto que declara la PWA es el que produjo el build
test -f dist/_headers   # expect: exit 0
npm run e2e:install   # expect: exit 0
npm run e2e   # expect: exit 0 — sirve el build de producción y ejecuta humo + 3 flujos críticos (§9 regla 13)
status=0; grep -rnE '\.(skip|only)\(' src supabase/tests e2e || status=$?; test "$status" -eq 1   # expect: exit 0 — 1 = ninguna prueba saltada
npm audit --omit=dev --audit-level=high   # expect: exit 0 — sin vulnerabilidades altas en dependencias de producción (necesita red)
```

Cada expectativa es una propiedad, no un conteo. Ninguna línea acepta "cualquier código distinto de 0".

Además, estas compuertas manuales (lista de puesta en marcha), cada una revisada una vez antes de producción:

- [ ] Cada paso del §9 tiene su tag: `git tag -l 'step-*'` lista los 18 tags `step-01-andamiaje` … `step-18-endurecimiento-e2e`. El repositorio lo creó el §10 Bootstrap.
- [ ] Cada archivo de §10 *Files that must be committed* está versionado — un comando por ruta, p. ej. `git ls-files --error-unmatch .env.example`,
      `git ls-files --error-unmatch .env.test`, `git ls-files --error-unmatch .env.e2e`, `git ls-files --error-unmatch .env.e2e-mock`,
      `git ls-files --error-unmatch package-lock.json`, `git ls-files --error-unmatch .claude/settings.json` — y no ignorado, también por ruta:
      `status=0; git check-ignore -q .env.example || status=$?; test "$status" -eq 1` (igual para `.env.test`, `.env.e2e`, `.env.e2e-mock`).
- [ ] El `.gitignore` estaba antes del primer commit:
      `test "$(git log --diff-filter=A --format=%H -- .gitignore | tail -n 1)" = "$(git rev-list --max-parents=0 HEAD)"` sale con 0.
- [ ] §19.6 *Byte-exact*: el comando del codificador ESC/POS se ejecutó sobre la versión instalada y mostró `1b40`, `1b70` y `1d56`.
- [ ] El §10 Bootstrap se re-ejecutó una vez sobre el árbol ya construido, **salió con 0** y no cambió nada: `package.json` conserva todas sus
      dependencias y `npm run typecheck` sigue pasando.
- [ ] Todas las filas de §19.6 *Cross-artifact* dicen `Comparado: sí`, y lint/format/typecheck se corrieron desde la raíz **con `blueprints/` presente**.
- [ ] §9.1 (responsable: socio supervisor): paridad de los 3 días (Z = Excel), interruptor de emergencia ensayado una vez (talonario), y tras 30 días
      el `.xlsm` movido a una carpeta de solo lectura con copia externa confirmada por el socio supervisor.
- [ ] Ningún non-goal de §1 está construido.
- [ ] Las variables de §10 están en el hosting de producción y no hay `.env.local` versionado.
- [ ] Supabase real: las 7 migraciones aplicadas en orden; *Security Advisor* sin hallazgos ERROR; en el SQL Editor, `set role anon; select count(*) from public.products;`
      falla con permiso denegado y `set role authenticated; insert into public.products (code, name, category_code, price) values ('BE-999','x','BE',1);`
      falla con `42501` (RLS verificado en Supabase real, §20.2 riesgo 2).
- [ ] Auth real: invitación por correo, enrolamiento TOTP con una app autenticadora, inicio anónimo de la caja (o la ruta alternativa del §8) — [PENDIENTE].
- [ ] **Hardware (ITP250):** en la PC de caja, `/pos/hardware` empareja la impresora por Web Serial, imprime el ticket de prueba legible (acentos y "Ñ")
      y abre la gaveta; si no, se fija `settings.printer.modo = "navegador"` y se documenta (§20.2 riesgo 4).
- [ ] Flujos críticos de §13 repetidos a mano contra la URL de producción con el proyecto de ensayo.
- [ ] Pasada solo con teclado de los 3 flujos y una pasada con NVDA por la venta (§15); zoom 200 % del panel a 320 px.
- [ ] Un evento rechazado provocado a propósito (venta con total alterado) aparece como alerta `evento_rechazado` en el panel (§16).
- [ ] Un rollback del frontend hecho a propósito en el hosting (§12) y una restauración de `pg_dump` en un proyecto de pruebas.
- [ ] El supervisor revisó el catálogo contra el menú físico y el contador aprobó el texto del recibo interno — [PENDIENTE].
- [ ] Cronometraje: una venta típica (2 productos, efectivo) en ≤ 20 s.

**No se ignora ninguna advertencia.**

### 20.2 Risk register

| Riesgo | Prob. | Impacto | Primera señal | Mitigación (responsable) |
|---|---|---|---|---|
| 1. Pérdida de ventas no sincronizadas si se borra el almacenamiento del navegador o falla el disco | M | A | indicador con pendientes que no bajan; alerta `caja_sin_sincronizar` | `navigator.storage.persist()` al emparejar + aviso si se niega; indicador visible; alerta > 2 h; "Exportar respaldo de emergencia"; UPS; no usar "limpiar datos de navegación" en la PC de caja (supervisor) |
| 2. Reglas críticas evadibles desde el cliente | B | A | una fila sin evento en `pos_events` | todo por RPC `SECURITY DEFINER` + REVOKE + RLS con aal2; pruebas de propiedad en cada `npm run test:db`; las mismas sondas en Supabase real (§20.1). PGlite prueba RLS nativo; el gateway de Supabase solo se prueba manualmente (builder / quien despliega) |
| 3. El PIN no se puede re-verificar en eventos offline | A (aceptado) | M | anulaciones o consumos atribuidos a quien no estaba | caja emparejada y revocable, bitácora con `staff_id`, cierre ciego, alertas de anulación/gaveta/reimpresión (supervisor) |
| 4. Impresora/gaveta por Web Serial no probada con la ITP250 (driver USB-serie, baudios) | M | M | la página de prueba no lista el puerto o imprime basura | paso 2 temprano con prueba manual (§20.1), selector de baudios, respaldo `window.print()` 80 mm con gaveta manual (supervisor) |
| 5. Lovable reescribe lógica o migraciones fuera de los gates | M | A | diff en `supabase/migrations/` o `src/lib/backend.tsx` hecho por Lovable | regla no negociable 5 en `CLAUDE.md`, `.claude/rules/base-de-datos.md`, CI en cada push; la base es la autoridad (§12 *Ruta con Lovable*) |
| 6. La activación SAR exige autorización de autoimpresor y validación del contador | A | M (2027) | — | tablas, numeración y plantilla listas y probadas; bitácora, inmutabilidad y exportes ya cumplen lo que pide la declaración jurada; trámite [PENDIENTE] (socios + contador) |
| 7. Cortes de energía/internet rurales | A | M | caja sin sincronizar | offline-first + UPS + talonario de contingencia (obligatorio cuando el SAR esté activo) |
| 8. Supabase gratuito pausa proyectos inactivos y no tiene PITR | M | A | correo de aviso de pausa | plan Pro o `pg_dump` diario fuera de la caja (§12) [PENDIENTE decisión] |
| 9. Un solo supervisor: la segregación impide que apruebe sus propias acciones (abrir su propio turno, anular lo que pidió) | M | M | el supervisor no puede abrir turno cuando atiende solo | designar al menos un segundo usuario con rol `supervisor` entre los socios [SUPUESTO]; la regla no se relaja |
| 10. Precios del catálogo distintos del menú físico | M | M | alertas `precio_distinto` o reclamos | revisión del supervisor antes de producción [PENDIENTE]; precios editables en el panel |

### 20.3 Decision log

| # | Decisión | Alternativa rechazada | Por qué | Se revierte si |
|---|---|---|---|---|
| 1 | Track ts-node con el mismo stack que Lovable (Vite + React + TS 6 + Tailwind v4 + Supabase), construido por los gates de este bundle | construir todo dentro de Lovable sin gates | el usuario quiere Lovable, y la lógica antifraude necesita pruebas automáticas que Lovable no impone | Lovable no puede importar el repo y su plantilla obliga a otra versión mayor (§12 alternativa) |
| 2 | Toda escritura por RPC `SECURITY DEFINER` + REVOKE + RLS | escritura directa a tablas con RLS por fila | una sola puerta validada; RLS de escritura es fácil de dejar abierta y difícil de probar | el volumen exige escrituras masivas que una RPC no soporta |
| 3 | Pruebas SQL en PGlite con un shim de Supabase | Supabase local con Docker | ningún gate necesita Docker ni credenciales en Windows | PGlite deja de soportar `SET ROLE`/RLS o una función que las migraciones necesitan |
| 4 | Identidad de la caja por fila en `devices` ligada a `auth.uid()` (consulta en cada RPC) | rol `pos_device` en `app_metadata` del JWT (lo proponía el brief) | se revoca al instante con `set_device_active(false)`, sin esperar a que expire el token, y se prueba en PGlite sin Edge Functions | Supabase exige claims para alguna política que no podemos evaluar por tabla |
| 5 | Emparejamiento con sesión anónima + código de un solo uso | Edge Function con `service_role` que crea un usuario de dispositivo | todo en SQL y probado; ninguna clave de servicio | el inicio anónimo no puede coexistir con registro desactivado → ruta alternativa del §8 (usuario invitado `caja1@…`) |
| 6 | PIN de 4 dígitos verificado en la caja con PBKDF2-SHA256 (210 000 iteraciones) | contraseña por cajero o verificación en servidor | requisito: lo más rápido posible y offline; el servidor re-valida rol | la caja sale del local o se exige verificación en línea |
| 7 | Eventos inmutables con `(device_id, client_seq)` como idempotencia; orden por `client_seq` | sincronizar filas con "última escritura gana" | una caja = un punto de emisión: no hay conflictos que resolver, solo duplicados | se agregan cajas que comparten turnos o inventario en línea |
| 8 | Impresión por Web Serial + ESC/POS con respaldo `window.print()` | WebUSB / agente local instalado | Web Serial abre la gaveta sin instalar nada; WebUSB puede chocar con la clase impresora | la ITP250 no expone puerto serie con su driver → agente local o impresora LAN |
| 9 | No migrar el historial de ventas del Excel | importar los 57 recibos | trae los defectos que el sistema existe para impedir | el contador necesita ese historial dentro del sistema |
| 10 | Componentes propios estilo shadcn, sin ejecutar el CLI de shadcn en gates | `shadcn add` en los pasos | el CLI usa red y agrega paquetes no verificados | Lovable agrega componentes shadcn: se aceptan si pasan los gates |
| 11 | Sin rastreador de errores externo en v1; alertas en base + estado del indicador | Sentry u otro | los errores que importan son de negocio y ya se registran como alertas | aparecen fallos de UI no reproducibles en la caja |
| 12 | Polling de 60 s en el panel | Realtime de Supabase | sin estado de conexión que mantener; suficiente para socios | un flujo (p. ej. aprobación en caja) necesita respuesta en segundos |
| 13 | Hora de negocio UTC-6 fija | zona `America/Tegucigalpa` por nombre | PGlite puede no traer tzdata; Honduras no usa horario de verano | Honduras vuelve a adoptar horario de verano |
| 14 | npm, ESLint + Prettier | pnpm, Biome (defaults del track) | lo que trae Lovable; un proyecto Lovable no debe pelear con su propia configuración | el proyecto deja Lovable |

### 20.4 What to build next

1. **Facturación SAR activa** (non-goal) — cuando llegue la resolución de autoimpresor: llenar `fiscal_config`, usar `app.next_fiscal_number()` en
   `app.ev_venta` y `buildInvoiceLines` en la impresión, notas de crédito.
2. **Contabilidad (Etapa 2)** — cuando el contador valide un mes de exportes CSV.
3. **Segunda caja o local** — cuando se abra; el modelo ya trae `device_id`/`location_id`.
4. **Alertas por WhatsApp/correo** — si un socio pierde una alerta crítica por no abrir el panel.
5. **Descuentos y promociones** — con una política escrita de los socios.

---

*Fin del blueprint. El orden de construcción es el §9. Deténgase cuando §20.1 esté en verde.*
