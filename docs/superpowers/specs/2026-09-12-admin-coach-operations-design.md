# Admin para coaches: Overview, Attendance, Enrolment, Medical y menú — diseño

Fecha: 2026-09-12 · Estado: aprobado en chat por el operador (Luis) el 2026-09-12 · Rama de
trabajo: `feature/admin-coach-operations` (a partir de `feature/member-calendar`).

## 1. Qué se pide y por qué

Los coaches usan el panel `/admin` en el tatami y el operador transmitió cinco peticiones:

1. **Overview**: quitar la barra negra de atajos y la métrica "Members"; mostrar los tres
   próximos cumpleaños con su día y avisar cuando alguien cumple hoy.
2. **Attendance**: una lista por clase, con el nombre de la clase y el coach en el título, donde
   se ve quién ya hizo clock-in (verde), quién reservó y aún no llegó (gris) y quién no marcó al
   empezar la clase (rojo "Late"), con un botón por persona para que el coach registre la llegada.
3. **Enrolment requests**: que los botones existentes funcionen de verdad contra la base de datos
   y que se explique qué hace cada uno.
4. **Medical conditions**: un botón "Show all references" que liste todas las referencias; el
   resto igual.
5. Quitar del menú **Memberships** y **Waivers**.

Decisiones tomadas con el operador en el chat (2026-09-12):

| Tema | Decisión |
| --- | --- |
| Rol | Los cambios son en `/admin` para todos, y `coach`/`headCoach` ganan acceso a Overview, Attendance, Enrolment requests y Medical conditions con **los mismos poderes que la oficina** (aprobar, devolver, guardar etiqueta). Es una excepción consciente al modelo T007/T121 y se registra en `docs/adr/ADR-010-coach-office-powers.md`. |
| Cumpleaños | La ventana máxima del backend pasa de 31 a **366 días** para que siempre haya tres. La fecha se calcula en cliente a partir de `daysAway`; el año de nacimiento sigue sin salir del backend. |
| "Late" | Rojo en la lista desde la hora de inicio (reloj local). Un clock-in posterior al inicio se persiste como `late`: el umbral de `determinePunctuality` pasa de 15 a **0 minutos**. Quien nunca llega sigue quedando `no_show` con "Mark no-shows". |
| "Ready for Jiu Jitsu" | El botón del miembro no existe y **no entra** en este trabajo. La etiqueta verde refleja cualquier check-in registrado, sea cual sea el método; cuando exista el botón del miembro la lista no cambia. |
| Memberships / Waivers | Se **ocultan del menú**; rutas, callables y tests se conservan (el registro de waivers oficiales T090 depende de ellas). |
| Overview del coach | `getOperationalReport` se abre a `headCoach`/`coach`: el Overview es el mismo para todos. Solo son conteos, nunca importes. |
| Lista de asistencia | **Un bloque por sesión del día, apilados**, filtrados por sede (Town/West). La tabla actual de correcciones y cierre queda debajo, plegada. |
| Refresco | Sondeo cada **30 s** y reloj local para el cambio gris→rojo. Sin RTDB ni websockets. |
| Enrolment | No se observó un fallo concreto: se **verifica contra emuladores** (spec T121 existente + Playwright de UI) y se corrige lo que falle. |
| Medical | `listHealthReferences` devuelve `studentId`, `displayName`, `staffReferenceLabel` de perfiles `active` con etiqueta. **Sin** `conditionSummary`. |
| Despliegue | **No se despliega.** Se entrega rama con `verify:mvp` verde y evidencia en el ledger; el operador confirma el deploy aparte. |

## 2. Fuera de alcance

- Botón "Ready for Jiu Jitsu" del miembro y cualquier ruta de check-in del propio alumno (ME-3).
- Check-in por QR o PIN.
- Nombre "humano" del coach: el schedule solo guarda `instructorId` (texto libre en el alta de
  clase; `staffProfiles` no tiene nombre). El título muestra `Coach {instructorId}`.
  `ponytail: instructorId es la única identidad de coach que existe; resolver a displayName exige
  Auth Admin SDK y se hará cuando el alta de clase elija coaches de un listado.`
- Borrar Memberships/Waivers, tocar `/coach`, tocar el calendario de miembros.

## 3. Arquitectura por capas (sigue `CLAUDE.md`)

| Capa | Cambios |
| --- | --- |
| `packages/domain` | `birthdays`: `upcomingBirthdayMaxWindowDays = 366`. `schedule`: `determinePunctuality(..., lateThresholdMinutes = 0)`. `schedule/pre-class`: nueva `deriveRosterTag` (la vista no cambia; el `instructorId` ya viaja en `session`). `health`: nuevo contrato `HealthReferenceRow` y `parseHealthReferenceQuery` (payload vacío). |
| `apps/functions` | `reports`: `reportRoles` += `headCoach`, `coach`. `members/enrolment-request-callables.ts`: `officeRoles` += `headCoach`, `coach` (lista, detalle, devolver, aprobar). `health`: `saveHealthProfileHandler` acepta `headCoach`/`coach`; nuevo `listHealthReferencesHandler` + `listHealthReferences` en `index.ts`. `schedule`: tests de punctuality y de servicio ajustados al umbral 0. |
| `apps/web/src/lib` | `health-client.ts`: `listHealthReferences()`. `birthdays-client.ts`: `birthdayDateLabel(daysAway, now)` → "Sat 20 Sep" en `Europe/Jersey`. |
| `apps/web/src/app/admin` | `overview-page.tsx`, `attendance/page.tsx` (+ nuevo `attendance/session-roster.tsx`), `members/requests/page.tsx` (texto de ayuda), nueva ruta `members/medical/page.tsx` (sección movida desde `members/page.tsx`), `admin-shell.tsx` (menú y `coachRoutes`), `admin-gate.tsx` (rutas de staff), `admin-test-bootstrap.ts` + `E2EAdminGate` (rol sintético `coach`). |
| `qa/tests` | Nuevos specs de UI con sesión sintética y callables interceptados; ejecución del spec T121 contra emuladores. |
| `docs` | Este diseño, el plan, `ADR-010`, entradas en `tasksv2.md`. |

## 4. Overview

### 4.1 Qué se quita

- El `<div className="admin-quick-actions">` y la constante `quickActions`.
- La `AdminMetric` "Members" (`report.students.activeStudents`). El grid pasa a 3 columnas
  (`.admin-metrics-grid` con `repeat(3, minmax(0, 1fr))`, colapsa a 1 en `50rem`).
- CSS huérfano: `.admin-quick-actions`, `.admin-quick-action` y sus estados en `admin.css`.

### 4.2 Próximos cumpleaños

- Carga: `listUpcomingBirthdays({ windowDays: 366 })` (sin sede: el Overview es de toda la
  academia), en paralelo con el dashboard y el reporte. Falla por separado: si cumpleaños falla, el
  resto del Overview se muestra igual y la tarjeta dice "Birthdays are temporarily unavailable."
- Tarjeta `admin-panel-card` "Next birthdays" (eyebrow `People`) en `.admin-overview-grid`, tras
  "Needs attention". Lista `<ol>` de **como máximo 3** filas: `<strong>{displayName}</strong>` ·
  `{birthdayDateLabel}` · `turns {turningAge}`; la fila de hoy antepone `Today`. Vacía: "No birthdays
  recorded for the year ahead."
- `birthdayDateLabel(daysAway, now = Date.now())`: suma `daysAway` al día de hoy en `Europe/Jersey`
  y formatea `en-GB` `{weekday short} {day} {month short}` → "Sat 20 Sep". Vive en
  `birthdays-client.ts` junto a `birthdayWhenLabel` y se prueba con fechas fijas (cambio de mes,
  cambio de año, 29 de febrero).
- **Aviso de hoy**: si alguna fila tiene `daysAway === 0`, encima del grid de métricas se muestra
  una banda `admin-birthday-today` (`role="status"`): eyebrow `Birthday today`, titular condensado
  "{name} turns {age} today" (varios: "{n} birthdays today" y la lista de nombres), fondo Purple
  Wash `#F0EFFF`, `border-left: 0.35rem solid #2F2483`, badge lime `#D9F36A` con texto ink. Sin
  emojis, sin animación (DESIGN.md §7, §8).

### 4.3 Dominio y backend

- `upcomingBirthdayMaxWindowDays` 31 → 366. `deriveUpcomingBirthdays` no cambia de algoritmo (el
  bucle por días es O(ventana × candidatos) = 366 × 2 000 como techo: aceptable en una callable
  que se llama una vez por carga; `ponytail: si pesa, precalcular el próximo cumpleaños por
  candidato`). Tests del contrato: 366 acepta, 367 rechaza; una persona a 300 días aparece.
- La callable no cambia de firma; el cliente sigue con `limitedUseAppCheckTokens: true`.

## 5. Attendance

### 5.1 Datos

- Sesiones del día: `listSessions(dayQuery(date))`, filtradas en cliente por `locationId ===
  premises` (misma regla que `/coach`). Sede en `localStorage["bpt_coach_premises"]` (clave ya
  usada por `/coach`, así ambas pantallas recuerdan lo mismo).
- Por sesión: `getPreClassView(sessionId)` → `attendees` con `displayName`, `source` y `status`
  vivo. La lista usa **solo** `source === "booked"`; los "regulars" sugeridos no se listan (no
  reservaron).
- Refresco: `setInterval` de 30 s que vuelve a pedir los `getPreClassView` de las sesiones
  visibles (no `listSessions`, que cambia poco); un `clockMs` que tica cada 30 s decide gris/rojo.
  El intervalo se limpia al desmontar y se pausa cuando `document.hidden`.

### 5.2 Estado por fila (derivación pura, testeada en dominio)

Nueva función en `packages/domain/src/schedule/pre-class-contracts.ts`:

```ts
export type RosterTag = "ready" | "booked" | "late" | "no_show" | "absent";
export function deriveRosterTag(status: SessionOperationalStatus | null, startAtIso: string, nowMs: number): RosterTag
```

| `status` | Resultado |
| --- | --- |
| `attended`, `late`, `checked_out` | `ready` (verde, texto "Ready") |
| `no_show` | `no_show` (rojo, "No-show") |
| `absent` | `absent` (rojo, "Absent") |
| `booked_not_arrived` o `null`, `nowMs < startAt` | `booked` (gris, "Booked") |
| `booked_not_arrived` o `null`, `nowMs >= startAt` | `late` (rojo, "Late") |

Contadores del bloque: Ready = filas `ready`; Waiting = `booked`; Late = `late`+`no_show`+`absent`.

### 5.3 Interfaz

- Cabecera de página: `AdminSectionHeader` actual. Debajo, una barra con el `radiogroup` de sede
  (Town / West, mismos textos que `/coach`) y el `<input type="date">`.
- Un `<section className="attendance-session-block">` por sesión, ordenadas por `startAt`:
  - Título `<h3>`: `{session.title} · Coach {session.instructorId}`; línea meta: `{HH:MM}–{HH:MM}` ·
    `{n} booked`. Contadores en tres `AdminMetric` pequeños o un `<dl>` inline (Ready / Waiting /
    Late) con `tabular-nums`.
  - `<ul className="attendance-roster">` con una `<li>` por reservado: nombre a la izquierda;
    a la derecha la etiqueta `<span className="attendance-tag attendance-tag-{tag}">` y el botón
    **"Clock in"** (`aria-label="Clock in {name}"`) solo cuando la etiqueta es `booked` o `late`.
  - Etiquetas según DESIGN.md §2 (texto + regla izquierda, no pill sola): verde `#176B49` sobre
    `#E7F6EE`; rojo `#8D1C2F` sobre `#FFF0F2`; gris `#65635D` sobre `#E8E7E3`. `border-left:
    0.35rem`, radio 0, `font-size 0.8rem`, uppercase, `letter-spacing 0.06em`.
  - Sesión sin reservas: "Nobody has booked this class." Sesión cancelada: bloque con la
    etiqueta `Cancelled` y sin botones.
- Clock in: `recordCheckIn({ sessionId, studentId, method: "manual" })`, sin señal de proximidad
  (esa vive en `/coach`); tras éxito se vuelve a pedir el `getPreClassView` de esa sesión y se
  anuncia en `role="status"` "Clock-in recorded for {name}." Error: "Unable to record the clock-in.
  Nothing was changed." Un solo `busyKey` bloquea los botones del bloque mientras hay una llamada.
- La tabla actual (filtros, Correct, Checkout, Mark no-shows) se envuelve en
  `<details className="attendance-corrections">` con `<summary>Corrections and closeout</summary>`,
  cerrado por defecto; nada de su lógica cambia.
- Móvil (`< 50rem`): bloques a una columna; fila nombre/etiqueta/botón se apila en dos líneas;
  botón mantiene `min-height 3.15rem`.

### 5.4 Backend

- `determinePunctuality(sessionStartAtIso, checkInAtIso?, lateThresholdMinutes = 0)`. Se ajustan
  los tests del contrato y los de `schedule-service` / `attendance-transaction-service` que asuman
  15 min. Regla resultante: check-in `<= startAt` → `attended`; `> startAt` → `late`.

## 6. Enrolment requests

- UI: bajo el `AdminSectionHeader`, un `<dl className="admin-request-help">` con los tres botones:
  - **Read the full request**: descarga el detalle (fecha de nacimiento, teléfono, dirección,
    contacto de emergencia, hijos). Cada lectura queda auditada y cuenta contra el límite de
    lecturas restringidas del actor; el detalle se guarda en memoria para no repetirla.
  - **Send back to applicant**: exige una nota; la solicitud pasa a `returned` y el solicitante ve
    la nota en su cuenta y puede corregir y reenviar.
  - **Approve and enrol**: crea el registro de miembro (y los de los hijos), enlaza la cuenta con su
    rol y marca la solicitud `approved`. Solo se habilita tras leer el detalle. Si falla a medias, la
    solicitud queda `approval-failed` con el código y se puede devolver.
- Roles: `officeRoles` en `enrolment-request-callables.ts` pasa a
  `owner | administrator | headCoach | coach`. Tests de callables: cada rol de staff pasa; `guardian`
  sigue rechazado.
- Verificación (evidencia obligatoria en el ledger): (a) `qa/tests/enrolment-approval-auth-emulator.spec.ts`
  contra emuladores, incluyendo un caso nuevo con actor `coach`; (b) nuevo
  `qa/tests/enrolment-requests-ui.spec.ts` con sesión sintética `administrator` y callables
  interceptados: pulsa los tres botones y comprueba el payload enviado y el estado en pantalla.
  Cualquier defecto encontrado se corrige dentro de este trabajo y se anota.

## 7. Medical conditions

- `MedicalReviewSection` se mueve tal cual a `apps/web/src/app/admin/members/medical/page.tsx`
  (ruta `/admin/members/medical`); `members/page.tsx` deja de renderizarla y muestra un
  `admin-text-link` "Medical conditions" en su cabecera. Su test se mueve con ella.
- Menú: "Medical conditions" en el grupo People, tras "Enrolment requests".
- **Show all references**: botón `button button-secondary` bajo el formulario. Al pulsar, llama a
  `listHealthReferences()` y muestra `<table>` (Student · Reference) ordenada por `displayName`;
  cada fila tiene un botón "Use" que rellena el Student ID y dispara la carga del perfil. Segundo
  clic: "Hide references". Vacío: "No reference labels recorded yet." Error: "Unable to load the
  reference labels. Please try again."
- Contrato (`packages/domain/src/health/health-contracts.ts`):
  `HealthReferenceRow = { studentId, displayName, staffReferenceLabel }` y
  `parseHealthReferenceQuery` (acepta solo `null`/`undefined`).
- Callable `listHealthReferences` (`health-callables.ts`, roles `owner | administrator | headCoach |
  coach`; `guardian` rechazado): lee `academies/{academyId}/healthProfiles` con `status == "active"`,
  descarta `staffReferenceLabel === null`, resuelve `displayName` desde
  `academies/{academyId}/students/{studentId}.fullName` (perfil sin alumno → se omite), límite 2 000
  con la misma regla que pre-class (por encima, falla antes que mostrar parcial). Respuesta
  `{ references: HealthReferenceRow[] }`. Nunca incluye `conditionSummary` ni
  `minimumOperationalSupport`.
- `saveHealthProfileHandler`: roles `owner | administrator | headCoach | coach`.
  `deactivateHealthProfile` y `reviewHealthProfileChangeRequest` **no** cambian.
- Cliente: `listHealthReferences()` en `health-client.ts`, valida forma y devuelve el error seguro.

## 8. Menú y acceso

- `navigationGroups`: People = Members, Enrolment requests, Medical conditions. Memberships y Waivers
  se quitan. `coachRoutes`: `coach` = `/admin`, `/admin/attendance`, `/admin/members/requests`,
  `/admin/members/medical`; `headCoach` = los mismos + `/admin/classes`.
- `admin-gate.tsx`: la condición de staff acepta además `pathname === "/admin"`,
  `/admin/members/requests` y `/admin/members/medical` (helpers `isOverviewRoute`,
  `isEnrolmentRequestsRoute`, `isMedicalRoute`). `/admin/members` (directorio) sigue siendo de
  oficina.
- Sesión sintética e2e: `AdminE2ERole` admite `coach` y `headCoach`; `E2EAdminGate` construye una
  `StaffSession` en ese caso y usa `AuthorizedStaffWaitlistContent`. Sigue exigiendo la bandera
  bakeada y loopback.
- `ADR-010-coach-office-powers.md`: contexto (petición del operador 2026-09-12), decisión (coach y
  head coach comparten con oficina: reporte operativo, cola de inscripción completa, etiqueta médica),
  consecuencias (auditoría existente cubre cada acción con `actorId`; el riesgo de que un coach
  apruebe a alguien sin leer el detalle queda mitigado por el botón deshabilitado hasta leer), y lo
  que **no** se abre (directorio de miembros, finanzas, staff, retención, desactivar perfil médico).

## 9. Pruebas

Unitarias (vitest, TDD por tarea):

- Dominio: ventana 366; `determinePunctuality` umbral 0; `deriveRosterTag` (5 ramas + frontera
  `nowMs === startAt`); `parseHealthReferenceQuery`.
- Functions: roles de reporte, enrolment y health; `listHealthReferencesHandler` (omite sin
  etiqueta, omite inactivo, omite sin alumno, nunca devuelve `conditionSummary`).
- Web: `birthdayDateLabel`; Overview (sin atajos, sin "Members", 3 cumpleaños máximo, banda de hoy,
  fallo aislado); Attendance (bloque por sesión, título con coach, etiquetas por estado, botón solo
  en gris/rojo, gris→rojo al avanzar el reloj con `vi.useFakeTimers`, Clock in llama a
  `recordCheckIn` y refresca, sondeo de 30 s); Enrolment (texto de ayuda); Medical (ruta nueva,
  Show all / Hide, "Use" rellena el ID); shell (menú sin Memberships/Waivers, coach ve sus 4
  entradas, headCoach 5); gate (coach autorizado en las 4 rutas y denegado en `/admin/members`).
  "Comprobación de guardia" (LECCIONES §4): para `deriveRosterTag` y para el gate se desactiva la
  regla y se confirma que el test muere.

Playwright (UI, sesión sintética + `page.route`):

- `qa/tests/admin-overview-birthdays.spec.ts`: sin barra negra, sin métrica Members, tres filas,
  banda "Birthday today".
- `qa/tests/attendance-roster.spec.ts`: dos sesiones, reloj de Playwright (`page.clock`) antes y
  después de `startAt` → gris pasa a rojo; Clock in → verde y payload `method: "manual"`.
- `qa/tests/enrolment-requests-ui.spec.ts`: los tres botones.
- `qa/tests/medical-references.spec.ts`: Show all references.
- `qa/tests/admin-shell.spec.ts`: se actualiza (menú) y se añade el caso `role=coach`.

Emuladores: `enrolment-approval-auth-emulator.spec.ts` (+ caso `coach`) y una nueva prueba de
`listHealthReferences` en el mismo estilo (`health-references-auth-emulator.spec.ts`).

Cierre: `corepack pnpm verify:mvp` verde; evidencia (comandos y salida resumida) en `tasksv2.md`
bajo una tarea nueva por sección (T130V2..T134V2 o la numeración libre siguiente).

## 10. Riesgos y cómo se cubren

- **Privilegio del coach** (aprobar inscripciones, etiqueta médica): decisión del operador,
  ADR-010, acciones auditadas con actor. No se abre nada más.
- **Datos sensibles en Overview**: cumpleaños sin fecha de nacimiento; solo día/mes y edad.
- **Reloj del navegador desviado**: el rojo es orientativo; el estado persistido lo decide el
  servidor con `occurredAt`. Se documenta en la ayuda del bloque: "Late is judged by the server at
  clock-in."
- **Sondeo**: 30 s × sesiones visibles (≤ 10/día) = carga despreciable; se pausa con la pestaña
  oculta.
- **Ventana de 366 días**: coste O(366 × alumnos) por llamada; techo documentado.
