# Classes / Services: clon fiel de la sección de Regyfit — diseño

Fecha: 2026-09-16 · Estado: decidido con el operador (Luis) en chat el 2026-09-16 (4 decisiones de
alcance + 14 de diseño) · Rama de trabajo: `feature/admin-classes-billing-levels` (o una rama
nueva desde su cabeza cuando el operador integre la anterior).

Evidencia de origen: `docs/data/migrations/regyfit/classes-services-inventory.md` (estructura
saneada de las nueve pantallas, capturada en solo lectura el 2026-09-16). La captura cruda
(capturas de pantalla, HTML, valores con nombres de personas) vive fuera del repositorio en
`/root/regyfit-capture/` bajo el runbook `docs/data/migrations/regyfit/private-staging-runbook.md`.

## 1. Qué se pide

Replicar en `/admin` la sección **Classes / Services** del panel `admin2` de Regyfit, con sus
nueve subsecciones, como una interfaz nueva que sustituye a `/admin/classes` y
`/admin/memberships`, sobre la misma base de datos de BPT, e importar después la configuración y
los registros reales (incluidos drop-ins e historial) desde Regyfit.

Decisiones de alcance del operador (2026-09-16):

| # | Pregunta | Decisión |
| - | -------- | -------- |
| A | ¿Paridad funcional o clon? | **Clon fiel de las nueve pantallas** (misma disposición, campos y flujos), con el estilo de BPT. |
| B | ¿Sustituye o convive? | **Sustituye**: misma base de datos y callables; las rutas viejas redirigen cuando cada pestaña está lista. |
| C | ¿Dónde vive la evidencia? | Crudo fuera del repo; en `docs/` solo estructura saneada. |
| D | ¿Datos semilla? | **Todo**: catálogo (sedes, tipos, planes, vales) **y** registros con personas (clases, inscripciones, drop-ins, historial), bajo el runbook de staging privado, emulador primero y producción solo con confirmación en chat. |

## 2. Decisiones de diseño (trazables)

| # | Tema | Decisión |
| - | ---- | -------- |
| 1 | Ruta | `/admin/classes-services` con nueve pestañas en el orden de Regyfit; cada pestaña tiene URL propia (`/admin/classes-services/<tab>`). Nombres en inglés: Locations, Class / Service Types, Classes & Services 2.0, Memberships and Vouchers, Bulk Operations, Listings & Reports, Drop-ins, Options, History. |
| 2 | Sustitución y roles | `/admin/classes` → `/admin/classes-services/classes`; `/admin/memberships` → `/admin/classes-services/memberships`. Menú "Mat → Classes" pasa a "Classes / Services". Coaches: solo lectura en Locations, Types y Classes & Services 2.0 (ADR-010); no ven Memberships, Bulk, Reports, Drop-ins, Options ni History. `headCoach` conserva los poderes de admin que ya tiene en schedule. |
| 3 | Estilo | DESIGN.md manda: se replica disposición, campos, orden y acciones; no los colores, radios ni iconos de Regyfit. Los colores de tipo de clase son **datos** (como los cinturones, DESIGN.md §10) y solo pintan la tarjeta del calendario y el swatch de la tabla de tipos. Sin emojis ni iconos decorativos; los "iconos" de tipo de Regyfit se sustituyen por la abreviatura en un cuadro Mat Ink. |
| 4 | Locations dinámicas | Colección `locations` con `locationId: string`; `town` y `west` conservan su id. Campos nuevos: `abbreviation`, `kind: "presential" \| "zoom" \| "jitsi"`, `active` (ya existía). `LocationId` deja de ser una unión literal en `schedule-contracts.ts`; los consumidores que hoy discriminan `town \| west` (geocercas, planes, calendario) leen del catálogo. |
| 5 | Types = programas v2 | `ProgramRecord.schemaVersion "2"` añade `abbreviation`, `colour` (hex), `kind` (`class-frequency` \| `class-unlimited` \| `room-frequency` \| `room-unlimited` \| `service`), `dropInPolicy` (`no` \| `unlimited` \| `automatic` \| `1`…`5`), `notifyByEmail`, `showInList`, `message`. `ageBand`, `discipline`, `level` se mantienen (opcionales en v2, con valores por defecto `all` / `bjj` / `all-levels`). |
| 6 | Classes & Services 2.0 | Trabaja sobre `SessionRecord`. Calendario semana/mes/día + lista con filtros. Panel de sesión: fecha, inicio, fin, sede, tipo, capacidad (`No` = sin límite → `capacity: 0` significa ilimitado, hoy no existe: se introduce `capacity: null`), varios entrenadores (`instructorIds` aditivo; `instructorId` sigue siendo el primero), `bookingRules: "defined" \| { custom }`, `waitingList: "general" \| "on" \| "off"`. Callables nuevos `copyWeek` y `deleteWeek` (rango de 7 días, transaccionales, con vista previa). Inscripciones: `requestBooking`/`cancelBooking` existentes; pestaña EXTERNAL crea un drop-in (§5.3). |
| 7 | Planes dinámicos | `membershipPlans` con `planId: string`; los diez `planIds` actuales se convierten en documentos semilla y `PLAN_CATALOG` desaparece del código. Campos nuevos: `paymentCycle` (weekly, fortnightly, four-weeks, monthly, bimonthly, quarterly, semi-annual, annual), `frequency` (`unlimited` \| `{ perWeek: 1..14 }` \| `{ perMonth: n }`), `allowedPrograms: { programId, maxPerCycle: number \| null }[]`, `allowedSlots` (bitmap de 7×48 medias horas, string de 336 caracteres `0/1`), `availableForPurchase`. `discounts` (`name`, `cycle`, `amountMinor`) y `creditPacks` (`name`, `credits`, `priceMinor`, `expiryMonths \| null`, `allowedProgramIds`, `allowedSlots`, `availableForPurchase`) son colecciones nuevas. `evaluatePlanAccess` respeta tipos, rejilla y frecuencia. |
| 8 | Options | Documento `academies/{academyId}/config/classServiceOptions` con las dos pestañas (deadlines, limits, penalties, automations, view, weeklyMap, others). Las constantes de ventana de reserva de `advanced-booking-contracts.ts` pasan a ser los valores por defecto del documento; el servicio de reservas lee el documento. |
| 9 | Drop-ins | Documento `config/dropInOffer`: `priceMinor`, `active`, `address`, `postcode`, `city`, `coordinates`, `policy` (`view-and-book` \| `view-only` \| `none`), `photos[]` (hasta 10, R2, ADR-003), siete textos en inglés. Sin banderas de idioma. |
| 10 | History | Vista filtrada del módulo `audit` con diez tipos de evento (los de Regyfit). Los eventos de reserva, cancelación, drop-in y asistencia guardan `actorIp` (retención ADR-008: 12 meses). Filtros: desde fecha+hora, registrado por, tipo, número de filas (100…1000). Salida PDF imprimible. |
| 11 | Bulk Operations | Cuatro callables por lotes con vista previa (`n sesiones afectadas`) y confirmación: `bulkCancelSessions` (por sede / tipo / fecha), `bulkSetCapacity` (por sede / tipo), `bulkSetBookingRules` (por sede / tipo), `replaceTrainer` (periodo, sede, tipo). Permissions y Membership data reutilizan `listMembers` con los filtros de Regyfit y abren la ficha del miembro. |
| 12 | Listings & Reports | Ocho informes (tres de asistencia, cinco "Others"). Excel = XLSX por `apps/functions/src/exports` (mismo canal que `/admin/reports`); PDF = plantilla imprimible del navegador (`@media print`), sin dependencia nueva. |
| 13 | Importación | Plan aparte (Plan 4): script `qa/scripts/regyfit-classes-services-import.mjs` que lee `/root/regyfit-capture/data/` (nunca el repo), carga catálogo → sesiones → inscripciones → drop-ins → historial (eventos de auditoría) enlazando personas con `students` por nombre normalizado y dejando en `unmatched.json` los que no casen para revisión manual. Emulador primero; producción solo con confirmación en chat. |
| 14 | Pruebas | Vitest por callable sobre fakes; `qa/rules` para las colecciones nuevas; Playwright `@classes-services` por pestaña (móvil y escritorio) contra el export estático en :9471 con capturas en `qa/screenshots/cs-*.png` comparadas visualmente contra las de Regyfit; `verify:mvp` verde antes de integrar. |

Decisiones del grill-me (2026-09-16, tras la spec):

| # | Tema | Decisión |
| - | ---- | -------- |
| 15 | Planes: Regyfit manda | Los 10 planes de Regyfit son los únicos; el script de importación re-apunta las membresías existentes con una tabla de correspondencia (`bpt-jersey-adult` → "BPT Jersey - Town & West", `town-adult` → "Town All Levels", `west-adult` → "Strive", `west-teens` → "Strive Teens x1", `town-kids-1x` → "Town Kids x1", `west-kids-1x` → "Strive Kids", `town-teens` → "Strive Teens x1", `west-kids-2x`/`town-kids-2x`/`payg` → sin equivalente, se listan para decidir) que el operador revisa antes de ejecutar. "Strive" es la sede West (`apps/web/src/content/academy.ts`). |
| 16 | Historial completo | Se importan **todas** las clases de Regyfit (390 el día de la captura) con inscripciones y asistencias, abriendo cada clase con el script de captura. |
| 17 | Personas sin casar | Nombre sin alumno equivalente → se crea `students` archivado con `source: "regyfit"` y solo el nombre, en una lista de revisión para fusionar o borrar; retención ADR-008. El cruce usa `membershipNumber` (número de socio de Regyfit ya presente por la importación de fichas) y, si falta, el nombre normalizado. |
| 18 | PDF | Servidor con `pdf-lib` (ya usado en `member-report-pdf.ts` y la evidencia de waivers); sustituye la vista imprimible de la decisión 12. Excel = el canal de `exports` existente. |
| 19 | Rama | Rama nueva `feature/classes-services-clone` desde la cabeza actual de `feature/admin-classes-billing-levels` (que va cinco commits por delante de `main` con el trabajo de miembros); una sesión paralela sigue en la rama vieja. |

## 3. Fuera de alcance

- Traducciones (banderas de idioma de Regyfit): la interfaz es solo inglés.
- Integraciones "APP" e "INTEGRATIONS" de los planes (columnas de Regyfit): se muestran como `No` fijo hasta que exista la app de miembros con compra.
- Pasarela de pago para "Available for purchase": el campo se guarda; la compra en línea es ADR-006/T010.
- Google Maps en Drop-ins: se guardan coordenadas y se muestra un enlace a OpenStreetMap; sin mapa embebido (sin clave de API ni script de terceros).
- Módulos vecinos de Regyfit (Workouts, Box Observatory, POS) aunque enlacen con clases.

## 4. Arquitectura por capas

Se sigue el orden de CLAUDE.md para cada pestaña:

1. `packages/domain/src/<feature>/<feature>-contracts.ts` + pruebas puras.
2. `apps/functions/src/<feature>/<feature>-service.ts` con fakes en memoria.
3. `apps/functions/src/<feature>/<feature>-firestore.ts`.
4. `apps/functions/src/<feature>/<feature>-callables.ts` (`requireAdminActor`, `assertAcademyScope`, zod) reexportadas en `src/index.ts`.
5. `apps/web/src/lib/<feature>-client.ts` (`httpsCallable` + zod + errores seguros).
6. `apps/web/src/app/admin/classes-services/<tab>/page.tsx` + componentes.

Mapa de carpetas:

| Pestaña | Dominio | Functions | Web |
| ------- | ------- | --------- | --- |
| Locations | `schedule/location-contracts.ts` | `schedule/location-*` | `classes-services/locations/` |
| Types | `schedule/program-contracts.ts` (v2) | `schedule/program-*` | `classes-services/types/` |
| Classes 2.0 | `schedule/schedule-contracts.ts` (sesión v2) | `schedule/session-batch-*` (`copyWeek`, `deleteWeek`) | `classes-services/classes/` (calendar, list, session-panel, registrations-panel) |
| Memberships | `memberships/plan-contracts.ts` (v2), `memberships/discount-contracts.ts`, `memberships/credit-pack-contracts.ts` | `memberships/plan-*`, `discount-*`, `credit-pack-*` | `classes-services/memberships/` (plans, discounts, credit-packs) |
| Bulk | `schedule/bulk-contracts.ts` | `schedule/bulk-*` | `classes-services/bulk/` |
| Reports | `reports/classes-services-report-contracts.ts` | `reports/classes-services-*` + `exports` | `classes-services/reports/` |
| Drop-ins | `schedule/drop-in-offer-contracts.ts` | `schedule/drop-in-offer-*` | `classes-services/drop-ins/` |
| Options | `schedule/class-service-options-contracts.ts` | `schedule/class-service-options-*` | `classes-services/options/` |
| History | `audit/class-history-contracts.ts` | `audit/class-history-*` | `classes-services/history/` |

Cáscara común: `classes-services/layout.tsx` con la barra de pestañas (`role="tablist"`, enlaces
reales), `classes-services.css` y el gate de rol (`useAdminOrStaffSession`).

## 5. Pantallas (comportamiento a replicar)

Cada pantalla replica lo inventariado en `classes-services-inventory.md`; aquí solo lo que decide
el código.

### 5.1 Locations

Formulario `Name` + `Abbreviation` + `CREATE`. Tabla editable en línea: `ROOM/FIELD`,
`ABBREVIATION`, `STATUS` (select), `TYPE` (select), editar, candado si tiene sesiones futuras. El
panel de geocerca actual (`site-geofence-panel.tsx`) se mueve al editor de la sede. Callables:
`listLocations` (ya existe como parte del catálogo), `saveLocation`, `updateLocation`
(estado/tipo/nombre/abreviatura). No se borra: `active:false`.

### 5.2 Class / Service Types

Alta `Name` + `Abbreviation` + `CREATE`. Tabla editable en línea con guardado por fila (`save`
junto al mensaje) y toggles que guardan al cambiar. Callables: `listPrograms`, `saveProgram`
(existe, se amplía), `updateProgram`. Un tipo con sesiones se bloquea (candado), no se borra.

### 5.3 Classes & Services 2.0

- Cabecera: contadores `CLASSES`, `REGISTRATIONS`, `OCCUPANCY`, `TOTAL` del rango visible
  (calculados en cliente sobre las sesiones cargadas + `listSessionBookedCounts`).
- Filtros: sedes, tipos, staff (multiselección), `MINE` (sesiones donde el actor es entrenador),
  `ACTIVE/INACTIVE` (estado de la sesión).
- Calendario: rejilla semanal propia en CSS Grid (sin FullCalendar: no se añade dependencia),
  ventana horaria de Options (`weeklyMap.timeWindow`), tarjeta = color del tipo + título + hora +
  chip `inscritos/capacidad` (`∞` si `capacity: null`). Vistas mes (recuento por día) y día
  (columna única). `TODAY`, ‹ ›, selector de fecha nativo.
- `COPY WEEK` → `copyWeek({ fromWeekStart, toWeekStart, copyBookings })`; `ELIMINAR SEMANA` →
  `deleteWeek({ weekStart, reason })` (cancela, no borra). Ambos muestran vista previa (`n
  sesiones`) en un `<dialog>` nativo antes de confirmar.
- Lista: filtros de Regyfit, `EXCEL` por el canal de exportación, `TODAY'S CLASSES/SERVICES`.
- Panel de sesión (`<dialog>` a ancho completo en móvil, panel lateral en escritorio): crear o
  editar con `saveSession`/`updateSession` ampliados (`instructorIds`, `capacity: null`,
  `bookingRules`, `waitingList`). `DELETE` = `cancelSession` con motivo. `COPY` duplica los datos
  en un borrador nuevo. `MESSAGE` queda como botón deshabilitado con tooltip "Coming with
  announcements" (no hay canal de mensajería en este plan).
- Panel de inscripciones: `MEMBER` (buscador ≥ 2 letras sobre `listMembers`, `requestBooking`
  como admin), `GROUP` (familia: inscribe a todos los alumnos de una familia), `EXTERNAL`
  (nombre + email + teléfono → drop-in en `dropIns` sin `studentId`, ligado a la sesión).

### 5.4 Memberships and Vouchers

- **Payment plans**: formulario completo de Regyfit (rejilla de franjas con arrastre para
  pintar, dos tablas 00:00–11:30 y 12:00–23:30, verde permitido / rojo bloqueado usando
  Confirmed Green y Refused Red de DESIGN.md). Tabla `PLAN NAME`, `APP`, `INTEGRATIONS`,
  `MEMBERS` (recuento de membresías activas), `STATUS`, PDF de socios (informe imprimible),
  editar, candado si tiene socios. Aviso en edición con el número de socios afectados.
  `ASSOCIATE TO MEMBERS`: filtros + `MANAGE` → tabla de miembros con checkbox de plan
  (`assignPlanToStudents`).
- **Discounts**: `name`, `cycle`, `amount`; asociación igual que planes (`discountId` en la
  membresía).
- **Credit packs**: como planes pero con créditos y caducidad; la compra crea `creditPackPurchases`
  (fuera de este plan salvo el registro manual por admin).

### 5.5 Bulk Operations

Seis pestañas. Las cuatro primeras siguen el mismo patrón: selector → vista previa
(`previewBulk...` devuelve `count` y las diez primeras sesiones) → confirmación en `<dialog>` →
callable transaccional por lotes de 200 escrituras. Permissions y Membership data: filtro →
`listMembers` → tabla con enlace a la ficha (`/admin/members/{id}`) y, en Permissions, checkboxes
por tipo que llaman a `updateStudentProgramPermissions` (nuevo campo
`StudentProfile.allowedProgramIds`, opcional; vacío = según plan).

### 5.6 Listings & Reports

Cada tarjeta es un formulario que llama a `generateClassesServicesReport({ report, params })`; el
callable devuelve filas tipadas; el cliente las descarga como XLSX (canal de `exports`) o abre la
vista imprimible (`/admin/classes-services/reports/print?job=…`, `@media print`). Informes:
`bookings-attendance-absences`, `totals`, `monthly-map`, `members-by-type`, `members-by-plan`,
`members-with-additional-plans`, `total-classes`, `occupancy` (con escala de color como dato).

### 5.7 Drop-ins

Un formulario con `SAVE` para la tarjeta principal, subida de hasta 10 JPG a R2 con orden
arrastrable (`photos[].order`), y `SAVE ALL` para los siete textos. `getDropInOffer` /
`saveDropInOffer` / `uploadDropInPhoto` (URL firmada, ADR-003).

### 5.8 Options

Cada control guarda al cambiar (`updateClassServiceOptions({ path, value })` con zod por ruta) y
muestra `done` con la marca de confirmación de DESIGN.md (texto + regla verde, sin pill). Las dos
tarjetas con `SAVE` de Regyfit (título de categoría y mapa semanal) se guardan igual, en bloque.

### 5.9 History

`listClassHistory({ since, actorId?, type?, limit })` sobre `audit`. Tabla `DATE/TIME`, `USER`,
`IP`, `TASK` con frases en inglés equivalentes a las de Regyfit ("Member X booked the class of
16 Sep 2026 at 17:30"). `PDF` = vista imprimible.

## 6. Datos y seguridad

- Reglas de Firestore: las colecciones nuevas (`locations`, `membershipPlans`, `discounts`,
  `creditPacks`, `dropIns`, `config/*`) se escriben solo por callables; lectura por admin/staff
  según rol; los miembros leen `locations`, `programs`, `membershipPlans` (solo
  `availableForPurchase`) y nada de `audit`.
- Índices compuestos nuevos: `sessions (academyId, locationId, startAt)`, `sessions (academyId,
  programId, startAt)`, `audit (academyId, category, at desc)`; se añaden a
  `firestore.indexes.json` en el mismo commit que la consulta.
- IP en auditoría: solo en eventos de reserva/cancelación/drop-in/asistencia; se lee de
  `request.rawRequest.ip`; retención 12 meses (ADR-008, se enmienda con una línea).
- Nada de PII en logs ni en mensajes de error; los errores al cliente son cadenas seguras.
- Vistas previas de operaciones masivas: el servidor recalcula el conjunto al confirmar; si el
  recuento cambió, rechaza con `PRECONDITION_CHANGED` y el cliente vuelve a previsualizar.

## 7. Migración de datos existentes

- `LocationId` literal → string: script de una sola pasada que crea `locations/town` y
  `locations/west` a partir de la constante actual (con sus geocercas) si no existen.
- `PLAN_CATALOG` → documentos `membershipPlans/{planId}`; las membresías existentes ya referencian
  `planId`, no cambian.
- `ProgramRecord` v1 → v2: lectores con valores por defecto; escritura en v2 al editar.
- `SessionRecord`: campos aditivos; `capacity` numérico existente se conserva.

## 8. Planes de implementación

| Plan | Contenido | Sustituye |
| ---- | --------- | --------- |
| 1 | Cáscara de pestañas + Locations + Types + Classes & Services 2.0 | `/admin/classes` |
| 2 | Memberships and Vouchers + Drop-ins + Bulk Operations | `/admin/memberships` |
| 3 | Listings & Reports + Options + History | — |
| 4 | Importación desde Regyfit (catálogo, sesiones, inscripciones, drop-ins, historial) | — |

Cada plan es un fichero en `docs/superpowers/plans/` y una fila propia en `tasksv2.md`.

## 9. Pruebas

- Dominio: contratos y transiciones puras (rejilla de franjas, frecuencia, `evaluatePlanAccess`
  ampliado, cálculo de vista previa de lotes).
- Functions: cada servicio con fakes; cada callable con la prueba de frontera de seguridad
  (actor sin rol → `permission-denied`; academia ajena → rechazo; sin fuga de IP en errores).
- Rules: `qa/rules` para cada colección nueva, incluida la prueba de que un miembro no lee `audit`.
- Web: componentes con datos con forma de callable; Playwright por pestaña (móvil 390 px y
  escritorio) con capturas, sobre el export estático; una prueba de accesibilidad básica por
  pestaña (roles, foco en diálogos, Escape cierra).
- Regla LECCIONES.md §4: para cada guardia nueva, desactivarla y ver morir la prueba.

## 10. Riesgos

- `LocationId` y `PlanId` literales están extendidos por el código (calendario de miembros,
  finanzas, reglas): el cambio a string es el mayor riesgo de regresión y se hace primero, con
  `typecheck` como red.
- El calendario semanal propio en CSS Grid debe rendir en móvil (390 px) con hasta cinco
  clases solapadas por franja: se limita a dos columnas por franja y un contador "+n".
- Las operaciones masivas sobre cientos de sesiones necesitan lotes y no deben superar el tiempo
  de la callable: 200 escrituras por lote, con reintento del cliente por página.
- La importación depende de casar nombres de Regyfit con `students`: se acepta un `unmatched.json`
  y una fase manual.
