# Ciclo de 15 tareas — diseño (2026-09-26)

Decisiones cerradas con el operador en la sesión del 2026-09-26 (grill-me, preguntas 1–19).
Código, identificadores y textos de interfaz en inglés británico. Este documento fija el
**qué**; el plan `docs/superpowers/plans/2026-09-26-ciclo-15-tareas.md` fija el **cómo** y el
orden.

Reglas del repo que siguen vigentes: ADR-018 (nadie reserva sin autorización humana),
coaches sin flujos financieros, `packages/domain` sin Firebase, capas por feature, cero
deploy, cero migración destructiva y cero gasto de APIs pagadas sin confirmación explícita.

---

## T01 · Enrolment requests: vista "Waiting"

- El filtro de estado (`page.tsx`, estado `filter`) arranca en un valor nuevo `"waiting"`
  que muestra `submitted` y `approval-failed`. "All requests" y cada estado siguen en el
  selector: ese es el histórico.
- "Clear filters" vuelve a `"waiting"`, no a `"all"`.
- Tras aprobar, el refetch actual ya saca la fila de la vista (pasa a `approved`); tras
  devolver, la actualización local la saca (pasa a `returned`).
- Sin cambios de servidor. No se borra ningún documento.

## T02 · Notificaciones de admin

- `adminInboxQuerySchema` gana `kind: AdminNotificationKind | null`,
  `readState: "all" | "unread" | "read"` (sustituye `filter`) y
  `from/to: ISO date | null` sobre `createdAt`.
- Servidor (`admin-notification-service.ts`): igualdad por `kind`, `readAt == null` para
  unread, rango sobre `createdAt` (el mismo campo del `orderBy`, sin choque de desigualdades).
  **Read** no es consultable sin desigualdad sobre `readAt`: se resuelve con el query de
  "all" + filtro en memoria, con escaneo acotado a 10 páginas
  (`// ponytail: bounded scan; add a readState field if read-filter gets slow`).
- Índices compuestos nuevos en `firestore.indexes.json` para
  `(kind, createdAt desc, __name__ desc)`, `(readAt, createdAt desc, __name__ desc)` y
  `(readAt, kind, createdAt desc, __name__ desc)`. Se despliegan solo con confirmación.
- Sin prioridad.
- Interfaz: CSS propio (`admin-notifications.css`), filtros en una barra que en móvil se
  pliega en `<details>` ("Filters · n active"); escritorio = tabla, móvil = lista apilada;
  no leídas = regla izquierda + texto "Unread", nunca pill de color. Atajos "Last 7 days" y
  "Last 30 days" rellenan `from/to`.

## T03 · Private lessons

### Opciones (catálogo fijo en dominio, no editable en este ciclo)

| optionId | Precio (minor) | Créditos | Caducidad |
|---|---|---|---|
| `single` | 6500 | 1 | 3 meses desde la aprobación |
| `monthly` | 20000 | 4 | fin del periodo mensual (aprobación + 1 mes) |
| `pack-10` | 50000 | 10 | 6 meses desde la aprobación |

Archivo: `packages/domain/src/private-lessons/private-lesson-contracts.ts` (zod), export
`@bpt-jersey/domain/private-lessons`. El cliente envía solo `optionId`; el servidor fija
precio, créditos y caducidad.

### Elegibilidad

- Cuenta con acceso en `/account` y ficha `students` vinculada.
- 16 años o más (banda `adult` de `participant-band.ts`) el día de la compra.
- Independiente de la suscripción: **no** pasa por `planIds` ni por
  `manual-subscription-service`, así que convive con una mensual.
- Mensual: una compra `monthly` aprobada y vigente como máximo por alumno; la renovación es
  otra compra (manual, por transferencia).

### Datos (solo servidor; reglas `allow read, write: if false`)

`academies/{a}/privateLessonPurchases/{purchaseId}`:
`studentId, accountUid, optionId, priceMinor, creditsGranted, creditsRemaining,
status (pending | approved | rejected), source (member | office), method
(bank_transfer | cash | other), proofId | null, bankReference | null, submittedAt,
decidedAt | null, decidedBy | null, expiresAt | null, invoiceId | null, schemaVersion "1"`.

`academies/{a}/privateLessonCreditUses/{bookingId}`: `purchaseId, studentId, sessionId,
state (consumed | restored), consumedAt, restoredAt | null`.

### Flujos

1. **Miembro** (`/account/private-lessons`): elige opción → sube justificante (R2, mismo
   adaptador que planes) + referencia → `submitPrivateLessonPurchase` → `pending`.
2. **Oficina** (`/admin/billing` → sección "Private lessons"): lista pendientes →
   `reviewPrivateLessonPurchase` (approve | reject). Aprobar, en una transacción: fija
   `expiresAt`, `creditsRemaining = creditsGranted`, crea factura
   `chargeKind: "private-lesson"` + pago `bank_transfer` (patrón de `course-finance.ts`) y
   evento de auditoría.
3. **Oficina desde la ficha**: `recordPrivateLessonPurchase` (method cash | bank_transfer |
   other) crea la compra ya aprobada.
4. **Reserva** (ADR-018: solo la oficina): una sesión cuyo programa tiene
   `kind: "service"` es una private lesson. La oficina la crea (capacidad 1) y registra al
   alumno desde el `session-panel` existente. En `confirmBookingInTransaction`, para
   sesiones `service`, la comprobación de acceso por membresía se sustituye por "tiene
   crédito vigente": se consume 1 crédito de la compra aprobada con `expiresAt` más próximo
   (FIFO por caducidad) y se escribe `privateLessonCreditUses/{bookingId}`.
5. **Cancelación por la oficina** → el crédito vuelve a su compra (`restored`) si no ha
   caducado. **No-show** → el crédito queda consumido.
6. Los miembros no pueden reservar ni cancelar sesiones `service` (servidor lo rechaza; el
   calendario de miembros las muestra como `locked` con "Arranged by the office").
7. **Coach**: ve la sesión en calendario y asistencia; nunca créditos ni importes.

### Callables nuevas

`submitPrivateLessonPurchase`, `listMyPrivateLessons` (créditos vigentes + historial),
`listPrivateLessonPurchases` (admin), `reviewPrivateLessonPurchase`,
`recordPrivateLessonPurchase`. Todas con `requireAdminActor`/`assertAcademyScope` o la
sesión de cliente según corresponda, y zod en la entrada.

## T04 · Editor de cinturones versionado

### Modelo

- v1–v3 (`ibjjf-*`) siguen generadas en código y fijadas por hash: **inmutables**.
- Versiones nuevas = sistemas `custom`: `systemId` `bpt-<yyyymmdd>-<n>`, guardadas en las
  mismas colecciones (`levelSystems`, `levelDefinitions`, `levelRequirements`,
  `levelCatalogManifests`) con `origin: "custom"` y `status: draft | published`.
- La comprobación de hash aprobado se aplica solo a `origin: "code"`. Las `custom` se
  validan con zod (hex `/^#[0-9a-fA-F]{6}$/`, stripes 0–10, clases ≥ 0, edades 3–99,
  tiempo mínimo ≥ 0, textos ≤ 80 caracteres) y su manifiesto guarda el sha256 calculado al
  publicar; una versión publicada no se vuelve a escribir.

### Flujo (solo owner/administrator)

1. `createLevelCatalogDraft({ fromSystemId })` clona la versión activa (o cualquiera) a un
   borrador.
2. `saveLevelCatalogDraft({ systemId, levels, skills })`: nombre, color de cinturón
   (`visual.colors`), color de stripes, número de stripes, técnicas (`skillCatalog` +
   `levelRequirements`) y requisitos (`minClasses`, `minimumTime`, edad). Solo sobre
   borradores.
3. `publishLevelCatalogDraft({ systemId })` → `published`, inmutable.
4. `activateLevelCatalog({ systemId })`: comprueba que **cada** `currentDefinitionKey` de
   `studentLevelProgress` existe en la versión destino; si falta alguna, rechaza y devuelve
   la lista de claves y el número de alumnos afectados. Si todas existen, mueve el puntero
   `levelCatalogState.activeSystemId` y reescribe `systemId` en el progreso en la misma
   operación por lotes, conservando `currentDefinitionKey` y `currentLevelStartedAt`.
   Auditoría con antes/después.
5. Rollback = activar la versión anterior con la misma comprobación.

### Permisos y reglas

- Coaches y head coaches: solo lectura (`listLevelCatalog`).
- `firestore.rules`: las colecciones de niveles siguen en `if false` para clientes; se
  añaden tests en `qa/rules/level-catalog-boundary.test.ts` para las colecciones nuevas o
  campos nuevos.
- Colores de cinturón: solo en `.belt-bar`, `.belt-tip` y `.levels-colour` (DESIGN §10).
  En el editor, el hex se muestra en esos mismos elementos de vista previa.

### Interfaz

`/admin/levels`: pestañas "Active catalogue" (el `LevelsBrowser` actual) y "Versions"
(lista de versiones con estado, borrador en edición, publicar, activar). Editor por
cinturón como `<article>` con formulario; `<input type="color">` + campo hex.

## T05 · Eliminar Lesson Plans

Borrado de todo lo listado en la exploración (web, functions, domain, qa, reglas,
`deploy-runtime.ts`, `audit-event.ts`, `login-flow.ts`, `admin-routes.ts`,
`admin-shell.tsx`, exports de `package.json`/`tsconfig.runtime.json`). Las reglas de
`techniqueLibraries` y `lessonPlans` desaparecen (el catch-all deniega igual). Los docs
históricos quedan. **Huérfanas en prod:** `approveLessonPlan`, `getLessonPlan`;
colecciones `techniqueLibraries`, `lessonPlans` sin tocar.

## T06 · Waitlists por grupo

- Grupo = clase recurrente (`SessionRecord.classId`); sesiones sin `classId` se agrupan
  bajo su título.
- Callable nueva `listAdminWaitlistGroups`: lee `waitlistEntries` con estado
  `waiting | offered` de sesiones futuras (≤ 45 días), une con sesiones y devuelve
  `groups[{ groupId, title, location, count, sessions[{ sessionId, startAt, entries }] }]`.
- Interfaz: selector "Group" con "All groups" por defecto; vista agrupada con conteo por
  grupo y desglose por fecha; "Offer next place" sigue siendo por sesión. `?group=<classId>`
  con el patrón `URLSearchParams` + `history.replaceState` (sin datos personales).

## T07 · Attendance

Solo presentación: CSS propio (`attendance.css`) con la escala del sistema, sin desbordes a
320 px, textarea a 16 px, tabla de correcciones como lista apilada bajo 48rem, targets
≥ 44 px. Controles de asistencia intactos.

## T08 · Móvil y tablet

- Cortes: móvil < 48rem; tablet 48–64rem (escritorio a dos columnas); escritorio ≥ 64rem.
  DESIGN §6 y §9 se reescriben con esto.
- `100vh` → `100dvh` en layouts de pantalla completa (17 usos).
- `env(safe-area-inset-*)` en cabeceras fijas/sticky y en el cajón de navegación de admin.
- Controles de formulario ≥ 16 px.
- Landing: menú de navegación plegable (botón "Menu", `aria-expanded`) bajo 58rem, en
  lugar de ocultar los enlaces.
- Soporte: iOS 16+.

## T09 · Calendarios

### Admin/coach (`CalendarView`)

- **Semana:** tarjeta Gi White + texto Mat Ink + regla izquierda 0.35rem con el color del
  tipo (`--type-colour`, hex validado con el mismo patrón del dominio antes de llegar al
  CSS; si no valida, sin regla). Tipo nombrado en texto. Nombre completo en el nombre
  accesible y en `title`; visible completo al hover/focus. Ocupación destacada con
  `tabular-nums`.
- **Franjas vacías:** las medias horas sin sesiones en toda la semana visible se agrupan en
  una banda "13:00 – 15:00 · no classes"; clic la expande (y deja crear clase si
  `canEdit`). La línea "now" dentro de una banda se dibuja sobre ella.
- **Día (escritorio):** vista propia: eje horario a la izquierda; sesiones simultáneas lado
  a lado con nombre completo, o como filas dentro de la franja si no caben (umbral:
  columnas × 12rem > ancho). Cada sesión: nombre, franja, ocupación + barra sólida,
  coach, sede, tipo, estado (cancelada = texto + regla). Clic → `session-panel`.
- **Día (móvil, < 48rem):** agenda por horas, cabecera del día sticky con día
  anterior/siguiente, targets ≥ 44 px.
- **Acciones:** "Delete week" separado visualmente (al final, estilo destructivo de
  DESIGN); diálogo de confirmación intacto. Coach sin acciones de edición (como hoy).

### Miembros (`MemberCalendar`)

- DESIGN §9 se mantiene: estado = fondo completo de la tarjeta, una acción por tarjeta,
  day strip y "Ready for Jiu Jitsu" intactos.
- Móvil: la vista de 1 día sustituye el apilado de dos días; el day strip elige el día;
  Earlier/Later avanzan de uno en uno.
- Tablet/escritorio: selector Week / Day (Week por defecto).
- Jerarquía hora > clase > sede/coach > estado; nombres sin truncar.
- `/account/courses/calendar` hereda todo sin perder etiquetas de curso y ausencia.
- Sesiones `service` (T03): tarjeta `locked`, "Arranged by the office".

### Otros

- Se elimina `/account/classes` (página + tests); `login-flow.ts` mapea ese retorno a
  `/account/calendar`.
- DESIGN: nueva sección "Timetable colours are data" (análoga a §10): el color de tipo solo
  en la regla izquierda de la tarjeta de sesión del calendario de admin y en el muestrario
  de Types; nunca como fondo, texto ni en el calendario de miembros.

## T10 · Anti-slop

Auditoría previa → lista al operador → corrección de lo aprobado. Candidatos ya vistos:
hero genérico, fila de tres tarjetas iguales, títulos de relleno, "Programs" (US),
direcciones duplicadas, animación de entrada del hero, zoom al hover del merch, copy de
racha y "Great first class!", microcopys vacíos.

## T11 · Login

"One academy. One clear system." → "Brazilian Jiu-Jitsu Academy" en
`login/page.tsx:31` y su test.

## T12 · Pestañas placeholder

Borrar `bulk/`, `reports/`, `drop-ins/` de classes-services, sus entradas en
`classes-services-tabs.ts` y sus casos en tests. `classes-services-placeholder.tsx` se
queda (lo usan memberships y options). `/admin/reports` no se toca.

## T13 · Coach

Mismas pantallas y permisos. `/coach` y `/coach/access` con componentes de admin
(`AdminSectionHeader`, `admin-panel-card`, `AdminDataTable`); `coach.css` reducido a lo
imprescindible. `/coach/levels` se elimina (el menú apunta a `/admin/levels`, solo lectura).
Waitlists no entra en el menú del coach. Entregable: tabla pantalla admin → equivalente
coach → diferencias.

## T14 · Cursos en la landing

Escala tipográfica del sistema, medida ≤ 65ch, ritmo vertical. La banda se mantiene y
DESIGN §7 documenta la excepción: "The course promotion band is the only permitted
perpetual motion: linear marquee, visible Pause control, pauses on hover/focus, static
wrapped list under reduced motion".

## T15 · Tienda

`/shop`: paso a dos columnas entre 48 y 64rem, precios alineados con `tabular-nums`. El
móvil no cambia. La landing no muestra precios (sin cambio).
