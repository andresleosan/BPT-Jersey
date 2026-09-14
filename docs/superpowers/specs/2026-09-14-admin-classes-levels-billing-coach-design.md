# Admin: Classes, Levels, Billing y panel de coaches — diseño

Fecha: 2026-09-14 · Estado: decidido con el operador (Luis) en chat el 2026-09-14 (16 decisiones) ·
Rama de trabajo: `feature/admin-classes-billing-levels` (desde `feature/member-calendar`, tras un
commit `chore(workbench)` con los cambios locales pendientes).

## 1. Qué se pide

Cuatro puntos del operador para `/admin` (6-9 de su lista) y la verificación de los cinco de
coaches (1-5) que ya se construyeron el 2026-09-12 (T027V2-T031V2):

6. **Classes**: el admin crea, edita y elimina clases y sesiones que aparecen en el calendario de
   miembros y coaches, con un formulario de selección rápida (móvil y escritorio): nombre, horas y
   días semanales, rango de nivel, rango de edad, descripción.
7. **Levels**: categorizar por color de cinturón y edad; fichas legibles en móvil y escritorio.
8. **Billing**: el dashboard financiero es la pantalla de "Billing"; últimos 20 pagos; historial
   completo por miembro; "Issue invoice" con búsqueda de miembro que funcione; "Record payment"
   con elección efectivo / transferencia.
9. **Staff**: los coaches ven un panel casi igual al de admin salvo Billing, Shop, Staff, Reports y
   Waivers.

## 2. Decisiones (trazables)

| # | Tema | Decisión |
| - | ---- | -------- |
| 1 | Menú del coach | Overview, Attendance, Enrolment requests, Medical conditions, **Classes, Levels**. El directorio de Members sigue siendo de oficina (ADR-009 y ADR-010 no se enmiendan en eso). |
| 2 | Poderes en Classes | `coach` lee (sin botones de crear/editar/eliminar/generar); `headCoach` tiene los poderes de admin. Coincide con `managerRoles`/`staffRoles` actuales: **cero cambios de autorización** en schedule. |
| 3 | `/coach` | No se toca. |
| 4 | Días semanales | `ClassRecord.recurrenceRules[]` (1-7 reglas, cada una con día, hora y duración). Los documentos v1 con `recurrenceRule` se leen como una lista de una regla. `schemaVersion` de clase pasa a `"2"`. |
| 5 | Rango de nivel | `levelRange { fromKey, toKey, fromName, toName }` con dos selectores del catálogo de cinturones. **Informativo**: no bloquea reservas. Los nombres viajan denormalizados para que el calendario del miembro no necesite el catálogo. |
| 6 | Rango de edad | `ageRange { minAge, maxAge \| null }` con presets 4–7, 8–11, 12–15, 16+ y valores propios. La franja del programa (`ageBand`) se conserva y sigue gobernando el bloqueo del calendario. |
| 7 | Eliminar | "Remove class" = `active:false` + cancelar todas sus sesiones futuras (`scheduled`/`active`, `startAt >= now`) con motivo. "Remove session" = cancelar con motivo. Nada se borra. |
| 8 | Calendario real | Entra en este plan: `bookedCounts` con callable nuevo, tarjeta con descripción/nivel/edad, adaptador probado (unit + emuladores a nivel callable + componente con datos con forma de callable) y la variable documentada para la build de Cloudflare. **No** se puede recorrer en navegador contra emuladores: App Check es fail-closed offline (ya registrado en el spec T093). |
| 9 | Editar sesión | Nuevo `updateSession`: título, coach, horario, aforo, mínimo, descripción; solo `scheduled`. Las reservas se conservan; sin aviso a reservados (no hay canal). |
| 10 | Factura | Búsqueda por nombre (≥2 letras) contra un listado ligero de alumnos activos; `membershipId` pasa a ser **opcional** (`null`) en factura y contrato. El error de directorio se muestra. |
| 11 | Pagos por miembro | Se busca al alumno; se listan los pagos y facturas de su **familia** (quien paga) con referencia, método, importe y fecha. |
| 12 | Billing layout | Una sola página `/admin/billing`: métricas + Issue invoice / Record payment (diálogos) + últimos 20 pagos + buscador con historial. Debajo, plegados: facturas con saldo, renovaciones, penalizaciones, instrucciones de pago, todas las facturas. `/admin/finance` redirige a `/admin/billing`. |
| 13 | Levels | 27 fichas de cinturón con franja de color **real** (excepción documentada en DESIGN.md §10: color de cinturón = dato), stripes dentro de la ficha, filtros Kids/Adults y por color, búsqueda. Solo lectura. |
| 14 | Rama | Commit `chore(workbench)` con `next.config.ts`, `firebase-client.ts`, `deploy/`, `CLAUDE.md`, el roadmap; `Assets/` se revisa antes. Rama nueva desde ahí. |
| 15 | Pruebas finales | UI sintética (Playwright + `installAdminFixture`, móvil y escritorio, con capturas) + callables nuevos contra emuladores en Docker + `verify:mvp` verde. |
| 16 | Método de pago | Dos botones grandes Cash / Bank transfer; `other` queda en el contrato y fuera de la UI. |

## 3. Fuera de alcance

- Directorio de Members para coaches; abrir `getOperationalReport`, finanzas, staff o retención a coaches.
- Editor de cinturones/técnicas (BE-1), bandeja de promociones (BE-3).
- Bloquear reservas por nivel; nombre "humano" del coach (sigue `instructorId`).
- Aviso in-app a reservados cuando cambia o se elimina una sesión.
- Programas (`saveProgram` sigue sin UI): el formulario de clase elige programa existente.
- `teenStudent.studentId` en `loadMember` del adaptador Firebase (decisión abierta del spec del calendario).
- Despliegue. Se entrega rama con `verify:mvp` verde y evidencia en el ledger.

## 4. Arquitectura por capas

| Capa | Cambios |
| --- | --- |
| `packages/domain/src/schedule/schedule-contracts.ts` | `AgeRange`, `LevelRange`, `ageRangePresets`, `classDescriptionMaxLength = 500`, `parseAgeRange`, `parseLevelRange`, `parseClassDescription`, `ageRangeLabel`, `levelRangeLabel`, `parseRecurrenceRules`; `ClassRecord` v2 (`recurrenceRules`, `description`, `ageRange`, `levelRange`, `schemaVersion: "2"`), `normalizeClassRecord` (v1→v2); `SessionRecord` gana `description?`, `ageRange?`, `levelRange?` (aditivo, v1); `CreateClassInput`/`UpdateClassInput`/`CreateSessionInput` ampliados; nuevos `UpdateSessionInput`, `RemoveClassInput` con parsers; `generateSessionsFromClass` itera reglas, id `${classId}__${YYYY-MM-DD}__${HHmm}`, `legacySessionId(classId, date)`. |
| `packages/domain/src/finance/finance-contracts.ts` | `InvoiceRecord.membershipId: string \| null`; `recentPaymentsLimit = 20`; `RecentPaymentRow` + `isRecentPaymentRow`. |
| `packages/domain/src/members/member-directory-contracts.ts` | `memberNameRowSchema` / `MemberNameRow` (`studentId`, `fullName`, `familyId \| null`). |
| `apps/functions/src/schedule` | Store: lecturas normalizadas, `updateSession`, `removeClass`, `countConfirmedBookings`, generación con salto de id legado. Callables: `updateSession`, `removeClass` (managerRoles), `listSessionBookedCounts` (autenticado). `index.ts` los exporta. |
| `apps/functions/src/finance` | `IssueManualInvoiceInput.membershipId: string \| null`; `sourceRecords` valida membresía solo si existe; `matchesStudentScopeInTransaction` niega alcance de alumno a facturas sin membresía; dashboard tolera `membershipId: null`. Store: `listRecentPayments(academyId, limit)`. Callables: `listRecentPayments`, `getFamilyFinancialAccount` (requireAdministrator). |
| `apps/functions/src/members/member-names-callables.ts` | `listMemberNames` (owner/administrator): `students` activos, ≤ 2 000, `{studentId, fullName, familyId}`. |
| `apps/web/src/lib` | `schedule-client.ts`: `updateSession`, `removeClass`, `listSessionBookedCounts`. `billing-client.ts`: `membershipId: string \| null`, exporta `parseFinancialAccount`. `finance-client.ts`: `listRecentPayments`, `getFamilyFinancialAccount`. `members-client.ts`: `listMemberNames`. `calendar/firebase-calendar-repository.ts`: `bookedCounts` real. `calendar/fixture-calendar-repository.ts`: descripción y rangos en dos sesiones. |
| `apps/web/src/app/admin/classes` | `class-form.tsx` (nuevo formulario móvil-primero), `classes-dialog.tsx` (kinds nuevos `session-edit`, `remove-class`), `page.tsx` (catálogo con reglas/edad/nivel, acciones por rol), `classes.css`. |
| `apps/web/src/app/levels` | `levels-grouping.ts` (puro: cinturones con sus stripes, grupo de edad, colores), `levels-browser.tsx` y `levels.css` reescritos según DESIGN.md. |
| `apps/web/src/app/admin/billing` | `page.tsx` (home financiero), `member-picker.tsx`, `issue-invoice-dialog.tsx`, `record-payment-dialog.tsx`, `member-account-panel.tsx`, `billing.css`. `admin/finance/page.tsx` redirige. |
| `apps/web/src/app/admin` | `admin-routes.ts` (`coach` = `headCoach` = 6 rutas), `admin-shell.tsx` (comentario). |
| `apps/web/src/app/account/calendar/session-card.tsx` | Línea de nivel/edad y descripción. `account.css`. |
| `qa/tests` | `admin-classes-form.spec.ts`, `admin-levels.spec.ts`, `admin-billing-home.spec.ts`, `admin-shell.spec.ts` (coach ve 6), `schedule-finance-emulator.spec.ts` (callables contra emuladores). `qa/run-e2e.mjs` reenvía la nueva bandera. |
| `docs` | Este diseño, el plan, DESIGN.md §10, enmienda a ADR-010, STACK.md (variable `NEXT_PUBLIC_CALENDAR_SOURCE`), `tasksv2.md` (T032V2-T039V2 y estado de T027V2-T031V2), `Listav2/Listav2.data.js` (T027V2-T039V2). |

## 5. Classes

### 5.1 Contratos

```ts
export type AgeRange = Readonly<{ minAge: number; maxAge: number | null }>; // 3..99, maxAge >= minAge
export type LevelRange = Readonly<{ fromKey: string; toKey: string; fromName: string; toName: string }>;
export const classDescriptionMaxLength = 500;
export const ageRangePresets = Object.freeze([
  { label: "4–7", minAge: 4, maxAge: 7 },
  { label: "8–11", minAge: 8, maxAge: 11 },
  { label: "12–15", minAge: 12, maxAge: 15 },
  { label: "16+", minAge: 16, maxAge: null },
] as const);
export function ageRangeLabel(range: AgeRange | null): string;   // "Ages 8–11" · "Ages 16+" · "All ages"
export function levelRangeLabel(range: LevelRange | null): string; // "White → Blue" · "White" · "All levels"

export type ClassRecord = Readonly<{
  classId; academyId; programId; locationId; name;
  recurrenceRules: readonly ClassRecurrenceRule[];   // 1..7, sin duplicados (dayOfWeek, startTime), ordenadas
  description: string;                               // "" permitido, <= 500, sin caracteres de control
  ageRange: AgeRange | null;
  levelRange: LevelRange | null;
  instructorIds; capacity; minParticipants; active;
  schemaVersion: "2"; createdAt; createdBy; updatedAt; updatedBy;
}>;
export function normalizeClassRecord(raw: unknown): ClassRecord; // v1 {recurrenceRule} -> v2; lanza si no es objeto

// SessionRecord: campos aditivos, schemaVersion sigue "1"
description?: string; ageRange?: AgeRange | null; levelRange?: LevelRange | null;

export type UpdateSessionInput = Readonly<{
  sessionId: string; title?: string; instructorId?: string; startAt?: string; endAt?: string;
  capacity?: number; minParticipants?: number; description?: string;
}>;
export type RemoveClassInput = Readonly<{ classId: string; reason: string }>; // reason 2..200
export function legacySessionId(classId: string, localDate: string): string; // `${classId}__${date}`
```

`generateSessionsFromClass` recorre cada regla; el id es `${classId}__${YYYY-MM-DD}__${HHmm}`. El
store, antes de crear, comprueba también el id legado `${classId}__${YYYY-MM-DD}`: si existe (clase
v1 ya generada) lo devuelve y no duplica. Copia `description`, `ageRange`, `levelRange` y
`instructorIds[0]` a cada sesión.

### 5.2 Store y callables

- `updateSession(academyId, input, actorId)`: 404 si no existe; `precondition` si `status !== "scheduled"`;
  tras fusionar exige `endAt > startAt` y `minParticipants <= capacity`; escribe `updatedAt/By`.
- `removeClass(academyId, classId, reason, actorId, nowIso)`: `active:false`; cancela sesiones con
  `classId`, `status in (scheduled, active)` y `startAt >= nowIso` con `cancellationReason = reason`.
  Devuelve `{ class, cancelledSessions }`.
- `countConfirmedBookings(academyId, sessionIds)`: `Record<sessionId, number>` de reservas `confirmed`.
  Firestore: `where("sessionId","in",chunk de 30).where("status","==","confirmed")`.
- Callables: `updateSession`, `removeClass` → `managerRoles`; `listSessionBookedCounts(ListSessionsQuery)` →
  cualquier usuario autenticado (misma regla que `listSessions`), responde `{ counts }`.

### 5.3 Interfaz (`/admin/classes`)

- Cabecera con "New class" (primario) y "New session" (secundario) solo si `canManage`
  (`owner | administrator | headCoach`). Con `coach`: sin botones de acción en cabecera ni filas.
- **Formulario de clase** (`class-form.tsx`), móvil primero, un campo por fila bajo `50rem`:
  1. Class name.
  2. Program (`<select>` de programas activos) y **Training center** como `radiogroup` de dos botones
     Town / West (patrón `.attendance-premises-button`, aquí `.class-choice`).
  3. **Weekly schedule**: siete botones Mon…Sun con `aria-pressed`; cada día activo despliega una fila
     con `<input type="time">` y `<select>` de duración (30, 45, 60, 75, 90, 120 min). Al activar un
     día nuevo hereda hora y duración del último día activo. Mínimo un día.
  4. **Level range**: dos `<select>` "From belt" / "To belt" con los cinturones del catálogo (`kind ===
     "belt"`, orden `sequence`) y opción "Any level". "To" nunca por debajo de "From" (se valida en
     cliente por `sequence`). Si el catálogo no carga, los selectores se deshabilitan con nota.
  5. **Age range**: botones 4–7 / 8–11 / 12–15 / 16+ / Custom (dos números) / Any age.
  6. Description (`<textarea maxLength=500>` con contador).
  7. Coaches: lista de casillas (una por `staffKey`), no `<select multiple>`.
  8. Capacity y Minimum (`inputMode="numeric"`).
  En edición: programa y centro se muestran como texto fijo (cambiarlos dejaría sesiones huérfanas);
  todo lo demás editable; nota "Sessions already generated keep their times. Generate again for the
  new days."; casilla "Class is active".
- Catálogo de clases: columnas Class (nombre + coaches), Schedule ("Mon 18:00 · Wed 18:00 · 60 min"),
  Who ("Ages 8–11 · White → Grey"), Capacity, Status, Actions (Edit · Generate · Remove).
- Sesiones: Actions (Reservations · Edit · Cancel). Edit abre `session-edit` (título, coach, inicio,
  fin, aforo, mínimo, descripción) solo para `scheduled`.
- Remove class: diálogo con motivo obligatorio (2-200); aviso "Remove class. Its upcoming sessions
  will be cancelled and members with bookings will see them cancelled." Tras éxito:
  "Class removed. {n} upcoming sessions cancelled."
- Diálogo a pantalla completa bajo `50rem`; botones `min-height 3.15rem`; radio 0; DESIGN.md §4.

## 6. Levels

- `levels-grouping.ts`: `groupBelts(catalog)` → `BeltGroup[] = { belt, stripes[], ageGroup: "kids" | "adults", primaryColor }`
  ordenados por `sequence`; `beltAgeGroup(criteria)` = `kids` si `maxAge !== null && maxAge < 16`, si no
  `adults`; `distinctBeltColors(groups)`.
- `levels-browser.tsx`: cabecera (eyebrow, título condensado, conteos como texto), controles:
  búsqueda, `radiogroup` All / Kids / Adults, tira de colores (botón por color con `aria-pressed`,
  `aria-label="Filter {beltName} colour"`). Rejilla `repeat(auto-fill, minmax(18rem, 1fr))`, una
  columna bajo `50rem`. Ficha: `<article>` con `.belt-bar` (fondo = color real; a la derecha un tramo
  ink con las marcas de stripe), nombre en display, `<dl>` Age · Min classes · Min time, lista de
  stripes (`<ol>`: "1st stripe · 4 classes · 1 mo"), técnicas como lista separada por "·" (sin pills).
- DESIGN.md §10 "Belt colours are data": los hex del catálogo solo pueden usarse dentro de `.belt-bar`;
  no como acento, fondo ni texto.
- Sin editor. Mismo componente en `/admin/levels` y `/coach/levels`.

## 7. Billing

### 7.1 Backend

- `listMemberNames` (`members/member-names-callables.ts`, owner/administrator, payload `null`): lee
  `academies/{academyId}/students` con `status == "active"`, límite 2 000 (por encima falla),
  devuelve `{ members: MemberNameRow[] }` ordenados por `fullName`.
- `listRecentPayments` (finance, `requireAdministrator`, payload `null`): 20 pagos más recientes por
  `occurredAt desc`; por cada uno resuelve factura (referencia, descripción, `membershipId`) y, si hay
  membresía, `students/{studentId}.fullName` → `memberName`; sin membresía → `null`. Respuesta
  `{ payments: RecentPaymentRow[] }`.
- `getFamilyFinancialAccount` (finance, `requireAdministrator`, payload `{ familyId }`): reutiliza
  `readFinancialAccountInTransaction` con `scope: { academyId, familyIds: [familyId] }`. Respuesta =
  `FinancialAccountView`.
- `issueManualInvoice`: `membershipId: string | null`. Con `null`: no se valida membresía; la factura
  se crea con `membershipId: null`; `matchesStudentScopeInTransaction` devuelve `false` para alcance de
  alumno y `true` para alcance de familia; el dashboard salta la comprobación de membresía.

### 7.2 Interfaz (`/admin/billing`)

Orden fijo: cabecera ("Billing", acciones **Issue invoice** y **Record payment**) → aviso de
resultado → métricas (Collected this month · Outstanding · Overdue invoices · Renewals due) →
"Latest payments" (tabla de 20: Date · Member · Invoice · Method · Amount) → "Find a member"
(`MemberPicker`: `<input type="search">`, resultados ≥ 2 letras, máximo 8, `role="listbox"`) → al elegir,
`MemberAccountPanel`: nombre, familia, saldo, lista de pagos (todos, orden desc) y facturas con saldo
con acciones Record payment / Void → `<details>` plegados: Outstanding invoices, Upcoming renewals,
No-show penalties, Payment instructions, All invoices.

- **Issue invoice dialog**: `MemberPicker` → membresías del alumno como radios (activa primero) +
  "No membership · custom charge" → Amount (GBP, `inputMode="decimal"`) → Due date (`type="date"`,
  se envía como `T23:59:59.000Z`) → Charge type (Membership / Manual adjustment) → Reference →
  Description. Si el alumno no tiene `familyId` y no tiene membresía: "This member has no billing
  family yet. Add the family before invoicing." y el botón deshabilitado.
- **Record payment dialog**: factura (preseleccionada desde una fila; si no, `MemberPicker` +
  radios de facturas abiertas de la familia) → Amount (prellenado con el saldo) → **Method** como
  `radiogroup` de dos botones Cash / Bank transfer → Reference → Occurred at (`datetime-local`,
  por defecto ahora).
- Errores honestos: "The member list is unavailable. Try again." / "Unable to load this family's
  account." Nunca se traga un fallo de directorio.
- `/admin/finance/page.tsx`: `router.replace("/admin/billing")` en efecto y enlace de respaldo.

## 8. Menú y acceso

`admin-routes.ts`: `coachRoutes = ["/admin", "/admin/attendance", "/admin/members/requests",
"/admin/members/medical", "/admin/classes", "/admin/levels"]`; `headCoach` idéntico. Enmienda a
ADR-010 (sección "Enmienda 2026-09-14"): Classes en lectura para `coach` y Levels para ambos; el
directorio sigue cerrado. La página de Classes lee `useAdminOrStaffSession()` y deriva
`canManage = role !== "coach"`. `admin-shell.spec.ts`: el coach ve 6 entradas.

## 9. Calendario de miembros

- `firebase-calendar-repository.loadWeek`: añade `listSessionBookedCounts({ from, to })` al
  `Promise.all` y devuelve `bookedCounts` reales; quita el `TODO(connect)` correspondiente.
- `session-card.tsx`: bajo el sitio, `<p className="session-detail">{levelRangeLabel} · {ageRangeLabel}</p>`
  solo cuando la sesión trae alguno de los dos; `<p className="session-description">` (line-clamp 2)
  cuando `description` no está vacía.
- Fixtures: dos sesiones con descripción y rangos para el banco y las pruebas.
- Verificación: (a) `firebase-calendar-repository.test.ts` con los clientes mockeados; (b)
  `member-calendar.test.tsx` renderiza con el repositorio Firebase y clientes mockeados con datos con
  forma de callable, comprobando `full` con `bookedCounts`; (c) spec de emuladores a nivel callable.
- `STACK.md`: `NEXT_PUBLIC_CALENDAR_SOURCE=firebase` entre las variables de Pages. El banco `:9471`
  sigue en `fixture` (solo tiene emulador de Auth y App Check no funciona offline).

## 10. Pruebas

Unitarias (vitest, TDD por tarea): dominio (parsers nuevos, `normalizeClassRecord`, generador con
varias reglas e id legado, etiquetas, `parseInvoiceValues` con `null`, `isRecentPaymentRow`,
`groupBelts`); functions (store en memoria: `updateSession`, `removeClass`, `countConfirmedBookings`,
salto de id legado; callables: roles y payloads; finance: factura sin membresía, `listRecentPayments`,
`getFamilyFinancialAccount`, `listMemberNames`); web (clientes, `class-form`, página de clases por
rol, `levels-browser`, `member-picker`, diálogos, página de billing, redirección de finance,
`session-card`, adaptador y calendario con Firebase). Comprobación de guardia (LECCIONES §4) en
`parseRecurrenceRules` (duplicados) y en `isStaffRouteAllowed` (coach en `/admin/members`).

Playwright (sesión sintética, `installAdminFixture`, proyectos desktop y mobile, capturas en
`qa/test-results/screens/`): `admin-classes-form.spec.ts`, `admin-levels.spec.ts`,
`admin-billing-home.spec.ts`, `admin-shell.spec.ts` (coach 6 entradas), y re-ejecución de los cinco
specs de coaches.

Emuladores (Docker `bpt-emu:local`, sin red): `schedule-finance-emulator.spec.ts` con bandera
`T032_SCHEDULE_FINANCE_EMULATOR_E2E=true`: clase con dos reglas → generar → contar reservas → reservar
→ editar sesión → eliminar clase cancela futuras; factura sin membresía → pago en efectivo →
`listRecentPayments` → `getFamilyFinancialAccount` → `listMemberNames`. Además `test:rules` y
`verify:mvp` completos.

## 11. Riesgos

- **Cambio de esquema de clase**: lecturas normalizadas en el store; ningún documento se reescribe
  hasta que se edita. Prueba: v1 entra, v2 sale.
- **Ids de sesión**: el salto por id legado evita duplicar sesiones ya generadas de clases v1.
- **Factura sin membresía**: los lectores con alcance de alumno no la ven (no hay membresía que la
  vincule); la ve la familia y la oficina. Documentado en el callable.
- **`listMemberNames`** expone nombre y `familyId` de alumnos activos a owner/administrator, que ya
  ven el directorio completo: sin dato nuevo para ese rol.
- **Ledger**: T027V2-T031V2 no existen en `Listav2.data.js` y usan `en curso`, que el tablero no
  renderiza; se repara en este trabajo (rows + `revision`).
