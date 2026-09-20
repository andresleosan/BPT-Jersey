# Finite Courses and Seminars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vender cursos de pago único con sesiones semanales finitas, aprobación administrativa y asistencia dentro del calendario habitual de BPT.

**Architecture:** Módulo de cursos dentro del monolito actual, con contratos Zod, transacciones Firestore y pruebas de pago privadas en R2. Reutilizar identidad canónica, sesiones, reservas, asistencia y contabilidad; representar explícitamente el origen curso para que no dependa de una membresía ordinaria. La inscripción es la autoridad y las proyecciones de calendario son reanudables.

**Tech Stack:** Next.js 16.3.3 con exportación estática, React 19.2.8, TypeScript, Firebase Auth/Functions/Firestore, App Check, Cloudflare Pages/R2, Zod, date-fns-tz existente. Node según engines del repositorio; añadir sharp 0.35.4 al backend para normalizar imágenes, versión ya presente en el lockfile del workspace.

**Spec:** [2026-09-20-finite-courses-seminars-design.md](../specs/2026-09-20-finite-courses-seminars-design.md), aprobada por el operador en conversación después del commit `ccc9209`.

## Global Constraints

Valores de la especificación, conservados literalmente:

- “Sesiones normales repetidas semanalmente hasta completar el número asignado.”
- “Solicitud, transferencia, referencia y justificante separados por participante.”
- “Exclusivamente dentro de la plataforma, sin correos.”
- “Las fechas se calculan en `Europe/Jersey`”.
- “Precio único positivo en GBP por participante, almacenado en peniques enteros.”
- “Reserva durante 24 horas para enviar referencia y justificante.”
- “Los justificantes se limitan a PNG/JPEG de hasta 2 MiB y 20 megapíxeles”.
- “lotes de hasta 100 documentos por trabajo”.
- “Las colas se paginan en grupos de 30 y se filtran en servidor.”
- “10 reservas nuevas por hora y cuenta solicitante, 20 cargas por hora y 10 envíos por solicitud y hora”.
- “Las sesiones del curso no consumen el cupo semanal ordinario ni generan facturas PAYG.”
- “Owner y administrador activos” tienen gestión completa sin suscripción personal; “Coach asignado” no tiene pagos ni justificantes.
- “LCP ≤ 2,5 s, INP ≤ 200 ms y CLS ≤ 0,1” son objetivos de percentil 75, no resultados medidos.
- “no se añaden ni ejecutan suites automatizadas, navegador, cobertura, lint global o comprobaciones globales de tipos sin petición explícita”.

Aplicar AGENTS.md: trabajar en `main`, integrar origin antes de editar, commits acotados,
no ramas/worktrees/PR, no force-push, preservar trabajo ajeno. Solo compilar lo necesario
para un despliegue autorizado. Este documento no autoriza ejecución, instalación ni despliegue.
Las instrucciones TDD de la plantilla quedan sustituidas por revisión de código y escenarios
concretos de aceptación. No crear archivos de pruebas ni ejecutar los ejemplos como pruebas.

## Review Focus

Estos cinco riesgos tienen un paso de revisión explícito en la tarea propietaria:

1. **RF1, cambio de hora y publicación interrumpida:** exactamente N fechas locales, ningún borrador visible ni séptima sesión accidental. Tarea 2.
2. **RF2, última plaza y vencimiento simultáneos:** la cola conserva su orden; dos pestañas o reintentos no duplican plaza; pago tardío se conserva como incidencia. Tarea 4.
3. **RF3, cuentas nuevas, tutores y staff:** acceso por identidad/recurso sin membresía inventada, sin cambiar roles de staff ni acceder al menor de otra familia. Tarea 3.
4. **RF4, prueba manipulada y doble aprobación:** imagen validada y privada, mismo pago registrado una vez; ninguna aprobación automática por subir un archivo. Tareas 5 y 6.
5. **RF5, proyección atrasada, baja y compatibilidad:** acceso aprobado disponible sin esperar a todos los lotes y revocación inmediata; clases y facturas antiguas siguen legibles. Tareas 6 y 7.

---

## Ajuste técnico explícito para revisar junto con el plan

La especificación §8/§10 propone `/courses/[courseId]` y contenido actualizado renderizado
por servidor. La inspección de `apps/web/next.config.ts` demuestra `output: "export"`:
los Server Components se ejecutan al compilar, no al publicar un curso. No existe un servidor
Next en el despliegue actual. Véase la documentación instalada
`apps/web/node_modules/next/dist/docs/01-app/02-guides/static-exports.md`.

**Propuesta concreta:** conservar el despliegue estático y usar `/courses/view?course=<uuid>`
para las fichas. Una isla pequeña carga JSON público sin Firebase Auth; un endpoint HTTP
público sirve una proyección mínima y usa validación condicional ETag. Portada, navegación y
estructura inicial permanecen preconstruidas. No migrar todo BPT a SSR ni crear un servidor.

La proyección pública actualiza su revisión al publicar/cambiar/cancelar/finalizar. El endpoint
usa `Cache-Control: public, max-age=0, must-revalidate` y ETag; no se promete una invalidación
remota de CDN que no exista. Un 304 reutiliza el cuerpo, y un fallo muestra un enlace estable
al catálogo y un estado recuperable. No esperar al catálogo para mostrar la portada.

**Diferencia para el operador:** un curso nuevo funciona sin recompilar la web. **Límite:**
la ficha dinámica requiere JavaScript y no ofrece metadatos sociales específicos por curso
renderizados en servidor en esta primera versión. El contenido privado nunca comparte caché.
La revisión de este plan incluye aceptar este ajuste; no se altera silenciosamente la spec.

## Estructura y orden

Un solo plan porque publicación, aforo, cobro y acceso comparten invariantes. Cada tarea
produce un módulo revisable; hasta completar el flujo, el interruptor `coursesEnabled` queda
apagado en `academies/{academyId}/settings/courseFeatures`. Leer flags en servidor, nunca
usar el flag del navegador como autorización. Al apagarlo se cierran nuevas ventas/publicación,
pero siguen disponibles revisión de pagos, bajas, asistencia y acceso ya aprobado.

Orden: 1 contratos → 2 calendario → 3 identidad → 4 plazas → 5 evidencia → 6 aprobación/
finanzas → 7 calendario y asistencia → 8 HTTP/callables/avisos → 9 administración →
10 usuario/portada → 11 recuperación, privacidad y entrega. Las tareas 2 y 3 pueden
revisarse por separado, pero no se delega ni ejecuta nada durante la redacción del plan.

No añadir un archivo gigante con todo el módulo. Las carpetas nuevas se fijan aquí:
`packages/domain/src/courses/`, `apps/functions/src/courses/`,
`apps/web/src/app/admin/courses/`, `apps/web/src/app/account/courses/`,
`apps/web/src/app/courses/` y clientes en `apps/web/src/lib/`.

## Tarea 1: contratos versionados e invariantes de cursos

**Archivos:** crear `packages/domain/src/courses/course-contracts.ts`,
`enrolment-contracts.ts`, `course-policy.ts`, `course-calendar.ts`, `index.ts` en esa carpeta;
modificar `packages/domain/package.json` con export `./courses` (types/import a src y default
a lib, igual a las demás entradas). No cambiar todavía productores de reservas normales.

**Consume:** `localInstant` y `shiftIsoInZone` de `@bpt-jersey/domain/schedule/classes-services`;
`SessionRecord` de schedule; Zod existente.
**Produce:** los tipos siguientes, esquemas estrictos equivalentes y funciones puras.
Los esquemas de autoservicio no admiten actor, academia, precio calculado o estado del
servidor. El esquema de edición de curso de oficina sí admite priceMinor.

- [ ] Definir contratos de datos. Los tipos internos se comparten entre tareas; cada fecha
  ISO se valida y normaliza en servidor. courseId, enrolmentId, candidateId, proofId y
  requestId nuevos usan UUID; sesiones, locks, avisos, recibos y pagos usan los IDs
  deterministas descritos en sus tareas, compatibles con los parsers existentes.

```ts
export type CourseStatus = "draft" | "published" | "completed" | "cancelled";
export type Instructor =
  | { kind: "staff"; staffId: string; name: string }
  | { kind: "guest"; name: string };
export type CourseDraft = {
  kind: "course" | "seminar"; title: string; description: string;
  techniques: string[]; instructor: Instructor; locationId: string;
  minAge: number; maxAge: number | null; priceMinor: number; capacity: number;
  cancellationTerms: string; startsOn: string; startTime: string;
  endTime: string; sessionCount: number;
};
export type Course = CourseDraft & {
  courseId: string; academyId: string; revision: number;
  status: CourseStatus; timezone: "Europe/Jersey"; currency: "GBP";
  committedSeats: number; nextSessionAt: string | null;
  publicationRevision: number | null; createdAt: string; updatedAt: string;
};
export type ParticipantRef =
  | { kind: "student"; studentId: string }
  | { kind: "candidate"; candidateId: string };
export type EnrolmentStatus = "held" | "review" | "correction" | "approved"
  | "withdrawal_requested" | "expired" | "rejected" | "cancelled"
  | "waitlisted" | "offered";
export type CourseEnrolment = {
  enrolmentId: string; academyId: string; courseId: string;
  applicantUid: string; participant: ParticipantRef; participantKey: string;
  studentId: string | null; status: EnrolmentStatus; revision: number;
  priceMinor: number; currency: "GBP"; courseRevision: number;
  acceptedTerms: string; acceptedAt: string; reference: string;
  proofId: string | null; expiresAt: string | null; submittedAt: string | null;
  approvedAt: string | null; accessFrom: string | null;
  queuedAt: string | null; decisionReason: string | null;
  createdAt: string; updatedAt: string;
  seatCommitted: boolean; receivedMinor: number; refundedMinor: number; pendingRefundMinor: number;
};
export type CourseMutation = {
  requestId: string; enrolmentId: string; expectedRevision: number;
};
export type CoursePage<T> = { items: T[]; cursor: string | null };
export type CourseSlot = {
  sessionId: string; courseId: string; ordinal: number; startAt: string; endAt: string;
};
export type CourseErrorCode = "invalid" | "forbidden" | "not_found" | "conflict"
  | "full" | "expired" | "age_ineligible" | "payment_instructions_missing"
  | "no_future_session" | "rate_limited" | "unavailable";
```

- [ ] Crear esquemas estrictos con: título 1..160, descripción 1..6000, técnicas 1..40
  elementos de 1..240, condiciones 1..6000, nombre instructor 1..160, edades enteras
  0..120 con max ≥ min, importe entero positivo seguro, aforo y N enteros positivos
  seguros. Rechazar controles invisibles en etiquetas; admitir letras, símbolos y números.
  Validar que todas las fechas calculadas existen y caben en el rango ISO soportado;
  no poner un límite comercial arbitrario de cursos/sesiones al owner.
- [ ] Implementar funciones exportadas y su algoritmo:

```ts
export const courseHoldMs = 24 * 60 * 60 * 1000;
export function occupiesCourseSeat(e: CourseEnrolment, nowMs: number): boolean {
  if (["review", "approved", "withdrawal_requested"].includes(e.status)) return true;
  return ["held", "offered", "correction"].includes(e.status)
    && e.expiresAt !== null && Date.parse(e.expiresAt) > nowMs;
}
// course-calendar.ts imports Course, CourseSlot, localInstant and shiftIsoInZone.
export function courseSlot(course: Course, ordinal: number): CourseSlot {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > course.sessionCount)
    throw new Error("invalid_course_ordinal");
  const start = new Date(localInstant(course.startsOn, course.startTime, course.timezone)).toISOString();
  const end = new Date(localInstant(course.startsOn, course.endTime, course.timezone)).toISOString();
  return {
    sessionId: `course_${course.courseId}_${ordinal}`, courseId: course.courseId, ordinal,
    startAt: shiftIsoInZone(start, (ordinal - 1) * 7, course.timezone),
    endAt: shiftIsoInZone(end, (ordinal - 1) * 7, course.timezone),
  };
}
```

- [ ] Revisar sin ejecución: inicio < fin el mismo día; ida/vuelta de fecha local ante
  horas inexistentes/ambiguas rechaza la publicación y pide otra hora; ordinal N+1 falla.
  Los rangos de horas ambiguas no se resuelven silenciosamente.
- [ ] Commit acotado: `feat: define finite course contracts and scheduling policy`.

## Tarea 2: creación y publicación finita en el calendario existente

**Crear:** `apps/functions/src/courses/course-store.ts`, `course-publication.ts`,
`course-jobs.ts`, `course-notices.ts`.
**Modificar:** `packages/domain/src/schedule/schedule-contracts.ts`,
`apps/functions/src/schedule/schedule-service.ts`, `weekly-session-service.ts`,
`apps/functions/src/schedule/quorum-sweep-service.ts`.

**Produce:** `saveCourse(db, actor, draft, courseId, expectedRevision): Promise<Course>`;
`publishCourse(db, actor, courseId, expectedRevision, requestId): Promise<Course>`;
`runCourseJobBatch(db, academyId, jobId, now): Promise<{done: boolean}>`;
`reviseCourseSession(db, actor, courseId, sessionId, startAt, endAt, expectedRevision, reason, requestId): Promise<void>`;
`cancelCourseSession(db, actor, courseId, sessionId, expectedRevision, reason, requestId): Promise<void>`.
`db` es Firestore; `actor` es CourseActor de tarea 3 (tipo declarado allí); `now` ISO. draft es CourseDraft;
academyId/courseId/sessionId/jobId/requestId/startAt/endAt/reason son string; expectedRevision es number,
salvo creación de borrador donde courseId y expectedRevision valen null. courseId nuevo
lo genera el servidor y se devuelve dentro de Course. El resto
de firmas abreviadas de este plan usan estos mismos tipos para esos nombres.
El contrato `CourseJob` y `CourseNoticeDraft` se declaran aquí:

```ts
export type CourseJob = {
  jobId: string; academyId: string; courseId: string;
  kind: "publish" | "project_enrolment" | "revoke_enrolment" | "cancel_course" | "notify_session";
  enrolmentId: string | null; expectedRevision: number; nextOrdinal: number;
  state: "queued" | "running" | "done" | "failed";
  leaseUntil: string | null; lastError: string | null;
  recipientCursor: string | null; eventId: string | null;
  attempts: number; nextAttemptAt: string | null;
};
export type CourseNoticeDraft = {
  eventId: string; recipientUid: string; courseId: string;
  enrolmentId: string | null; kind: "offered" | "approved" | "correction"
    | "rejected" | "expired" | "rescheduled" | "cancelled" | "refund";
  title: string; message: string; href: string; createdAt: string;
};
```

- [ ] Añadir a SessionRecord campos opcionales `courseId`, `courseOrdinal`,
  `coursePublicationRevision`; a sesiones existentes sin ellos no se les cambia nada.
  Usar `programId: "seminar"`, `isSeminar: true`, `classId: null`, capacidad del curso,
  `minParticipants: 0`, sin weeklySeriesId y `repeatWeekly: false`. El curso gobierna
  la repetición. Instructor invitado usa `instructorId: "guest"`, nombre en metadatos
  explícitos y lista `instructorIds: []`; nunca autorizar ese valor como UID real.
- [ ] Guardar borrador con compare-and-swap de revisión y liveness del actor. Validar sede
  y coach contra registros de la academia. Publicar adquiere una revisión inmutable y
  crea job determinista `publish_<courseId>_<revision>`. Preparar hasta 100 documentos
  por lote con courseSlot; curso queda draft hasta confirmar todas sus sesiones.
- [ ] En todos los listados de sesiones, filtrar registros de curso por estado publicado
  y revisión efectiva. Escribir la proyección pública y activar curso al finalizar.
  Al reintentar, cotejar contenido del ID existente en lugar de sobrescribir cambios.
  Una revisión cambiada invalida el job; no mezcla dos calendarios.
- [ ] Canalizar editar, copiar semana, eliminar y repetición desde controles de sesiones:
  las sesiones de curso se envían al servicio de curso; copy-week no clona sus vínculos
  ni concede nuevas plazas. Cambio de N tras publicación exige nueva edición. Cancelar
  conserva ID/historial, reprogramar avisa, y el sweep de quorum ordinario no las cancela.
  Completar curso al terminar su última sesión; cerrar admisión al comenzar la última.
- [ ] Crear `appendCourseNotice(tx, academyId, notice): void` con ID derivado de eventId
  y recipientUid; los eventos pueden reintentarse. Fan-out de cambios grandes por job
  paginado, no cientos de avisos en la misma transacción de editar una sesión.
- [ ] Revisión RF1: trazar seis sábados cruzando cambio de hora; abortar después del lote
  inicial deja todo invisible para miembros/coaches; reanudar no añade una séptima sesión.
- [ ] Commit: `feat: publish finite courses into existing sessions`.

## Tarea 3: identidad y autorización sin membresía obligatoria

**Crear:** `apps/functions/src/courses/course-authorization.ts`, `course-participants.ts`.
**Modificar:** `apps/functions/src/members/canonical-member-directory-service.ts`,
`apps/functions/src/families/family-service.ts`, solo extensiones internas necesarias;
`apps/functions/src/profiles/guardian-profile-service.ts` para alta del tutor si falta.
**No reutilizar** `createEnrolmentRegistration`: asigna plan y nivel obligatorios.

**Produce:**

```ts
export type CourseActor = {
  uid: string; academyId: string; role: string;
};
export type CourseCandidate = {
  candidateId: string; academyId: string; applicantUid: string;
  kind: "adult" | "minor"; fullName: string; dateOfBirth: string;
  contactEmail: string; contactPhone: string; revision: number;
  canonicalStudentId: string | null;
};
export type ParticipantScope = {
  participant: ParticipantRef; participantKey: string;
  fullName: string; dateOfBirth: string; studentId: string | null;
};
// CallableRequest / Firestore / Transaction son tipos de Firebase existentes.
export function requireCourseActor(request: CallableRequest): Promise<CourseActor>;
export function requireCourseOffice(request: CallableRequest): Promise<CourseActor>;
export function resolveCourseParticipant(db: Firestore, actor: CourseActor,
  ref: ParticipantRef): Promise<ParticipantScope>;
export function saveCourseCandidate(db: Firestore, actor: CourseActor,
  candidate: Omit<CourseCandidate, "academyId" | "applicantUid" | "canonicalStudentId">)
  : Promise<CourseCandidate>;
export function ensureApprovedCourseStudent(db: Firestore, office: CourseActor,
  enrolmentId: string): Promise<{studentId: string; familyId: string | null}>;
```

- [ ] requireCourseActor exige Auth, academia, App Check y cuenta habilitada. Office
  además verifica staff canónico activo y owner/administrator, usando las comprobaciones
  de `members/canonical-actor.ts`. Coach no puede acceder a callables financieros.
- [ ] Antes del pago, usar estudiante existente autorizado o candidato privado. Candidato
  adulto solo representa al solicitante; menor requiere tutor adulto y su declaración
  de relación. Nunca aceptar un UID de tutor o academia enviados por el navegador.
  Resolver estudiantes por vínculo canónico o relación familiar activa, no por nombre/email.
  Una coincidencia ambigua requiere revisión de oficina y conserva el justificante.
- [ ] Reservar una clave de participante estable en servidor. Para candidato adulto:
  cuenta UID; para menores: registro candidato reutilizable de esa familia y detección
  de nombre normalizado/fecha duplicados dentro de la familia. La identidad canónica
  sigue usando los índices/MAC existentes, no claves públicas derivadas de fecha de nacimiento.
- [ ] Al aprobar, owner/admin registra alumno mediante createAdminAdultForAccount o
  createFamily/updateFamily. Ampliar su contexto interno con una unión explícita
  `{kind:"general", requestId}` / `{kind:"course", enrolmentId}` verificada contra
  solicitud en revisión; no fabricar solicitudes de alta general ni elevar al solicitante
  a owner. El proceso guarda un recibo de identidad antes de continuar con finanzas.
- [ ] Conservar el rol de cuenta, también shopper y staff; el permiso de curso procede
  de identidad y relación canónica. Adaptar los servicios internos que exijan rol guardian
  para aceptar una relación de tutor de curso autorizada por oficina, sin dar permisos
  globales de guardian a staff. Nunca modificar `setCustomUserClaims` para esta compra.
- [ ] Revisión RF3: shopper adulto, tutor nuevo, tutor existente, dueño sin displayName,
  coach comprador, menor de otra familia y cuenta deshabilitada. Confirmar que solo los
  sujetos autorizados llegan a la inscripción; administrar no crea un perfil personal.
- [ ] Commit: `feat: authorize course participants independently of memberships`.

## Tarea 4: plazas, vencimientos y lista de espera transaccionales

**Crear:** `apps/functions/src/courses/course-enrolments.ts`, `course-capacity.ts`,
`course-rate-limits.ts`; ampliar `packages/domain/src/courses/enrolment-contracts.ts`.
**Consume:** CourseActor, ParticipantRef, CourseMutation, resolveCourseParticipant,
occupiesCourseSeat y appendCourseNotice de las tareas 1–3.
**Produce:** los contratos siguientes; `db: Firestore`, `actor: CourseActor`, `now: string`.

```ts
export type ReserveCourseInput = {
  requestId: string; courseId: string; participant: ParticipantRef;
  courseRevision: number; acceptTerms: true;
};
export type CoursePaymentIncident = {
  incidentId: string; academyId: string; enrolmentId: string;
  proofId: string; reference: string; reason: "late_payment" | "course_ended"
    | "course_cancelled" | "duplicate_evidence";
  state: "open" | "resolved"; resolution: string | null;
  createdAt: string; resolvedAt: string | null;
};
export function reserveCourse(db: Firestore, actor: CourseActor,
  input: ReserveCourseInput): Promise<CourseEnrolment>;
export function joinCourseWaitlist(db: Firestore, actor: CourseActor,
  input: ReserveCourseInput): Promise<CourseEnrolment>;
export function cancelUnapprovedCourseEnrolment(db: Firestore, actor: CourseActor,
  input: CourseMutation): Promise<CourseEnrolment>;
export function advanceCourseCapacity(db: Firestore, academyId: string,
  courseId: string, now: string): Promise<{changed: number; more: boolean}>;
```

- [ ] Fijar rutas bajo `academies/{academyId}`: `courses`, `courseEnrolments`,
  `courseCandidates`, `courseParticipantLocks`, `courseJobs`, `courseProofs`,
  `coursePaymentIncidents`, `courseNotices`, `courseOperations`, `courseRateLimits`,
  `courseIdentityReceipts`, `courseRefunds`, `publicCourses`. No colecciones paralelas
  para lista de espera: waitlisted/offered son estados de la misma solicitud.
- [ ] Guardar locks por hash de courseId + participantKey; conservarlos al convertir un
  candidato en estudiante y resolver ambos alias al mismo lock. Una nueva solicitud tras
  cierre conserva historial y sustituye el puntero del lock dentro de la transacción.
  `courseOperations` usa hash de actor + acción + requestId, hash del payload y resultado:
  repetición idéntica devuelve resultado; misma clave con datos distintos da conflict.
- [ ] Implementar reserva en una transacción de lecturas antes de escrituras. Leer cuenta
  canónica, participante/vínculo, curso, próxima sesión real no cancelada, instrucciones
  bancarias, lock, recibo, rate-limit y cabeza de cola. Comprobar edad en esa sesión,
  precio/revisión/condiciones y flag. No usar curso.startsOn para incorporación tardía.
  Usar hora de servidor dentro de cada intento transaccional, nunca reloj del cliente.

```text
recibo existente y mismo payload → devolver resultado persistido
lock vigente → devolver esa solicitud, sin cobrar otra reserva al rate-limit
banco ausente / edad no válida / sin sesión futura → error específico sin reserva
cola anterior pendiente → procesar cola y responder espera/reintento; nadie la adelanta
committedSeats >= capacity → full, ofrecer lista de espera sin pedir transferencia
resto → held, expiresAt=ahora+24h, snapshot precio/condiciones, lock y contador +1
        guardar recibo y consumir una reserva del límite en la misma transacción
```

- [ ] Mantener `committedSeats` como contador persistido conservador: una reserva vencida
  sigue contada hasta su transición transaccional a expired. Usar campo interno
  `seatCommitted: boolean` de la solicitud para decrementar exactamente una vez. Los
  vencimientos no pueden reactivarse por enviar un reloj o revision antiguos. Antes de
  dar full por reservas vencidas, ejecutar un lote acotado y devolver reintento si resta
  trabajo; jamás calcular un aforo menor solo en memoria y olvidar corregir el contador.
- [ ] advanceCourseCapacity procesa vencidos por expiresAt y luego candidatos por
  queuedAt + enrolmentId; revalida edad, cuenta y sesiones futuras. Cada transacción
  decrementa la reserva liberada, crea oferta cuando corresponda y el aviso idempotente.
  Si quedan plazas/cola, continuar con cursor mediante job; todos los contendientes leen
  y escriben el mismo documento de curso. No saltar un candidato anterior aún pendiente
  de evaluación; inhabilitado se cierra con motivo y aviso antes de avanzar.
- [ ] Ofertas mantienen precio y condiciones snapshot aceptados al entrar en lista,
  aunque el curso cambie después; mostrar esos valores al recibir la oferta. Una nueva
  solicitud tras cierre acepta la revisión nueva. La oferta conserva 24h desde su creación;
  abrirla o aceptarla no reinicia ese reloj.
  El sistema no promete una plaza a una solicitud waitlisted. Cancelar la espera no
  toca el contador; cancelar held/offered/correction libera exactamente una plaza.
- [ ] Implementar contadores por ventana móvil: buckets por minuto y lectura de los 60
  anteriores dentro de la transacción, sumando solo eventos nuevos. Límites 10 reservas/
  cuenta/h, 20 cargas/cuenta/h y 10 envíos/solicitud/h; expiración técnica de buckets
  antiguos sin borrar recibos idempotentes. Responder rate_limited con retryAfterSeconds.
  No registrar referencias, capturas ni datos personales en contadores o logs.
- [ ] Revisión RF2 en papel: dos reservas y una caducidad con una plaza; oferta contra
  reserva directa; reintento con igual/diferente payload; pago tardío; última sesión
  iniciada. Confirmar que el único resultado posible respeta aforo, orden y evidencia.
- [ ] Commit: `feat: manage course capacity and unpaid waitlists atomically`.

## Tarea 5: referencia y justificante privado con recuperación

**Crear:** `apps/functions/src/courses/course-payment-proof.ts`.
**Modificar:** `apps/functions/src/storage/r2-client.ts`, `apps/functions/package.json`,
`pnpm-lock.yaml`; ampliar contratos de cursos con CourseProof y PaymentSubmission.
**Consume:** R2Client existente, CourseMutation, CoursePaymentIncident, rate-limits y
CourseActor. La carga se permite al solicitante autorizado, incluso para una solicitud
caducada con pago por resolver; no se permite alterar evidencia histórica ya aprobada.

```ts
export type CourseProof = {
  proofId: string; academyId: string; enrolmentId: string; applicantUid: string;
  objectKey: string; sha256: string; mime: "image/jpeg" | "image/png";
  sizeBytes: number; state: "uploading" | "ready" | "attached" | "deleting";
  createdAt: string; attachedAt: string | null;
};
export type PaymentSubmission = CourseMutation & {proofId: string; reference: string};
export function uploadCourseProof(db: Firestore, r2: R2Client, actor: CourseActor,
  input: CourseMutation & {base64: string; mime: "image/jpeg" | "image/png"})
  : Promise<{proofId: string}>;
export function submitCoursePayment(db: Firestore, actor: CourseActor,
  input: PaymentSubmission): Promise<{
    enrolment: CourseEnrolment; incident: CoursePaymentIncident | null;
  }>;
export function getCourseProofUrl(db: Firestore, r2: R2Client, actor: CourseActor,
  proofId: string): Promise<{url: string; expiresAt: string}>;
```

- [ ] En ejecución autorizada, añadir sharp como dependencia directa de Functions:
  `corepack pnpm --filter @bpt-jersey/functions add sharp@0.35.4`. Confirmar engines y
  empaquetado nativo en el artefacto de despliegue cuando se autorice compilar; no instalar
  ahora ni introducir otra librería de imágenes. Limitar instancia de procesamiento a
  concurrencia 1, memoria 512 MiB y tiempo 30s inicialmente; error seguro si agota recursos.
- [ ] Antes de decodificar base64, rechazar longitud superior a `4*Math.ceil(2097152/3)`;
  validar alfabeto/padding y tamaño de bytes de 1..2097152. Comprobar firma PNG/JPEG y
  metadatos: tipo real coincide, una sola imagen, anchura*altura ≤20000000. Sharp debe
  decodificar con límite de píxeles, fallar ante corrupción y reexportar sin metadatos.

```ts
import sharp from "sharp";
export async function normaliseCourseImage(bytes: Uint8Array): Promise<Buffer> {
  const decoder = sharp(bytes, {limitInputPixels: 20_000_000, failOn: "warning"});
  const meta = await decoder.metadata();
  if (!["png", "jpeg"].includes(meta.format ?? "") || (meta.pages ?? 1) !== 1)
    throw new Error("invalid_course_image");
  const result = await decoder.rotate().jpeg({quality: 85}).toBuffer();
  if (result.byteLength > 2 * 1024 * 1024) throw new Error("course_image_too_large");
  return result; // guardar mime image/jpeg; sin withMetadata/keepMetadata
}
```

- [ ] Generar proofId y clave opaca desde servidor. Crear recibo uploading y autorización
  antes de R2; normalizar, calcular hash sobre bytes finales, subir a clave determinista,
  después pasar a ready. Mismo requestId reanuda el mismo objeto; no crear nuevas claves
  en cada reintento. ready no demuestra pago ni activa acceso. No aceptar URLs remotas.
- [ ] submitCoursePayment lee solicitud, curso, proof y recibo en transacción. Exigir
  propiedad, academia, estado ready/attached compatible y referencia imprimible 1..128;
  cambiar held/offered/correction vigente a review, quitar expiresAt y enlazar prueba.
  Si venció: guardar incidencia late_payment y evidencia attached; no activar plaza.
  Si terminó/canceló: incidencia específica. No resucitar rechazadas silenciosamente.
  Correcciones conservan historial de evidencia y motivo; un adjunto nuevo no borra otro.
- [ ] Detectar hash o referencia normalizada reutilizados en otra solicitud de la misma
  academia usando índices privados. Señalar coincidencia para revisión humana, sin
  afirmar fraude ni bloquear por una referencia común; aprobación requiere reconocer
  explícitamente la coincidencia cuando exista. No exponer el pago de otra persona al
  solicitante. Una referencia opaca generada no reemplaza la efectivamente transferida.
- [ ] Ampliar R2Client con `createPrivateDownloadUrl(input: {objectKey: string;
  expiresInSeconds: number; contentType: string; fileName: string}): Promise<string>`.
  Firmar GetObject a 60s con ResponseCacheControl private/no-store, ContentType seguro
  y ContentDisposition de archivo generado por servidor. Solo oficina o solicitante;
  nunca coach por asignación deportiva. Respuesta callable privada, no guardar URLs en
  Firestore, analítica ni logs; imagen se solicita solo al abrir detalle. No reutilizar
  el método de PDF, ni cambiar su comportamiento para los imports existentes.
- [ ] Revisión RF4: HTML renombrado JPEG, SVG, imagen multipágina, 20MP excedidos, carga
  interrumpida, otra academia y proofId de otra familia. Recorrer las denegaciones antes
  de leer R2 y confirmar que una captura tardía queda recuperable sin repetir el pago.
- [ ] Commit: `feat: accept private course payment evidence safely`.

## Tarea 6: aprobar, dar de baja y contabilizar el pago una sola vez

**Crear:** `apps/functions/src/courses/course-approval.ts`, `course-finance.ts`,
`course-withdrawals.ts`; `packages/domain/src/courses/course-finance-contracts.ts`.
**Modificar:** `packages/domain/src/finance/finance-contracts.ts`,
`packages/domain/src/finance/financial-dashboard.ts`, `packages/domain/src/index.ts`,
`apps/functions/src/finance/finance-service.ts`, `finance-callables.ts`,
`financial-access-service.ts`, `financial-dashboard-service.ts` en esa carpeta;
`apps/web/src/lib/billing-client.ts`, `apps/web/src/lib/finance-client.ts`,
`apps/web/src/app/admin/billing/member-account-panel.tsx`, `record-payment-dialog.tsx`,
`issue-invoice-dialog.tsx` en esa carpeta. Actualizar export de cursos de tarea 1.

**Consume:** ensureApprovedCourseStudent, CourseMutation, CourseProof, CourseJob.
**Produce:** ApprovalInput, CourseRefund y operaciones autorizadas siguientes.

```ts
export type ApprovalInput = CourseMutation & {acknowledgeDuplicate?: boolean};
export type CourseRefund = {
  refundId: string; academyId: string; enrolmentId: string;
  amountMinor: number; currency: "GBP"; reason: string;
  status: "pending" | "recorded" | "cancelled";
  reference: string | null; occurredAt: string | null;
  createdBy: string; updatedBy: string; revision: number;
};
export function approveCourseEnrolment(db: Firestore, actor: CourseActor,
  input: ApprovalInput): Promise<CourseEnrolment>;
export function reviewCourseEnrolment(db: Firestore, actor: CourseActor,
  input: CourseMutation & {decision: "correction" | "reject"; reason: string})
  : Promise<CourseEnrolment>;
export function requestCourseWithdrawal(db: Firestore, actor: CourseActor,
  input: CourseMutation & {reason: string}): Promise<CourseEnrolment>;
export function decideCourseWithdrawal(db: Firestore, actor: CourseActor,
  input: CourseMutation & {approve: boolean; reason: string}): Promise<CourseEnrolment>;
export function recordCourseRefund(db: Firestore, actor: CourseActor,
  input: CourseMutation & {refundId: string; amountMinor: number; reason: string;
    status: "pending" | "recorded" | "cancelled"; reference: string | null;
    occurredAt: string | null}): Promise<CourseRefund>;
```

- [ ] Conservar los tipos actuales como LegacyInvoiceRecord/LegacyManualPaymentRecord y
  sus parsers v1. Definir unión versionada para las mismas colecciones existentes. V2
  solo para curso; no migrar registros históricos ni inventar familyId para adulto.

```ts
export type CoursePayer = {kind: "user"; userId: string}
  | {kind: "family"; familyId: string};
export type CourseInvoiceRecord = Omit<LegacyInvoiceRecord,
  "schemaVersion" | "familyId" | "membershipId" | "chargeKind" | "sourceRef"> & {
  schemaVersion: 2; familyId: string | null; membershipId: null;
  chargeKind: "course"; sourceRef: string; payer: CoursePayer;
};
export type CourseManualPaymentRecord = Omit<LegacyManualPaymentRecord,
  "schemaVersion" | "familyId"> & {
  schemaVersion: 2; familyId: string | null; payer: CoursePayer;
};
export type InvoiceRecord = LegacyInvoiceRecord | CourseInvoiceRecord;
export type ManualPaymentRecord = LegacyManualPaymentRecord | CourseManualPaymentRecord;
```

- [ ] Parsers públicos despachan por schemaVersion, validan campos exactos y relación
  payer/familyId; rechazar versión desconocida. Saldos emparejan academia, invoiceId y
  payer, no dos null familyId. Lecturas de familia incluyen sus facturas v2; adulto
  consulta por payer.userId autorizado. Dashboard suma cobros course una sola vez;
  mostrar categoría Courses y devolver campos mínimos, sin capturas. Mutaciones genéricas
  de facturas/pagos rechazan source curso y dirigen al servicio de aprobación.
- [ ] Autorizar office antes de preparar identidad. ensureApprovedCourseStudent deja
  recibo determinista studentId/familyId, sin otorgar acceso. La transacción de decisión
  vuelve a leer estado de cuenta, familia, participante, curso, próxima sesión, prueba,
  contador, identidad, recibo de operación e índices de duplicados antes de escribir.
  Si cambia la solicitud mientras se crea identidad, dejar recibo recuperable sin cobro
  ni aprobación; no eliminar un alumno canónico que podría tener otros vínculos.

```text
recibo de aprobación existente + payload igual → devolver la misma decisión
estado review y plaza comprometida → candidato aprobable
incidencia tardía → resolver cola/capacidad primero; nunca saltar una oferta anterior
sin futuro / identidad no resuelta / importe inválido / prueba ajena → sin decisión
aprobable → misma transacción escribe:
  inscripción approved, studentId, approvedAt y accessFrom (hora de decisión)
  factura course_invoice_<enrolmentId> pagada por importe snapshot
  pago course_payment_<enrolmentId> bank_transfer y referencia efectiva
  recibo idempotente, auditoría actor/revisión y aviso determinista
  job project_enrolment_<enrolmentId>_<revision>
```

- [ ] Approve confirma la recepción bancaria por decisión humana; no requiere displayName,
  correo verificado ni checkboxes redundantes. No aprueba automáticamente una imagen.
  La excepción es advertencia concreta de evidencia repetida con reconocimiento explícito.
  Si revisión termina sin sesiones futuras, mantener incidencia económica visible en la
  cola. Registrar dinero confirmado sin acceso mediante resolución de incidencia en
  `course-finance.ts`; usar los mismos IDs de factura/pago para impedir doble cobro.
  Producir `resolveCoursePaymentIncident(db: Firestore, actor: CourseActor,
  input: CourseMutation & {incidentId: string; received: boolean; reason: string})
  : Promise<CoursePaymentIncident>`. received=true registra el importe snapshot una
  vez; received=false exige motivo, no afirma devolución y conserva evidencia.
- [ ] Corrección deja 24h y motivo; rechazo libera plaza pero no elimina pago/incidencia.
  Baja solicitada conserva acceso/plaza; confirmarla cambia a cancelled, libera contador
  y encola revocación, con efecto inmediato desde inscripción. Denegar vuelve a approved
  con motivo. Sesión individual ausente no llama a esta operación.
- [ ] Refund es registro separado: pending nunca significa transferido. recorded exige
  importe positivo ≤ saldo cobrado menos devoluciones registradas y pendientes, referencia
  y fecha; sumar en transacción usando contador financiero de la inscripción. Un refundId
  repetido no duplica devolución; no mutar importe de devolución ya registrada. Añadir
  `receivedMinor`, `refundedMinor`, `pendingRefundMinor` internos a la inscripción,
  inicializados en cero. Mostrar bruto/devuelto/neto sin reabrir factura como impagada.
- [ ] Revisión RF4/RF5: doble Approve, timeout tras commit, fallo previo a finanzas,
  identidad creada sin decisión, factura v1 mezclada con v2, adulto sin familia, devolución
  parcial dos veces y baja durante proyección. No debe haber pago huérfano ni membresía.
- [ ] Commit: `feat: approve course payments and record manual refunds idempotently`.

## Tarea 7: calendario, roster y asistencia habituales para cursos

**Crear:** `apps/functions/src/courses/course-access.ts`.
**Modificar contratos:** `packages/domain/src/schedule/schedule-contracts.ts`,
`member-calendar-contracts.ts` en esa carpeta.
**Modificar backend:** `apps/functions/src/schedule/schedule-service.ts`,
`schedule-callables.ts`, `booking-transaction-service.ts`, `advanced-booking-service.ts`,
`attendance-transaction-service.ts`, `pre-class-service.ts` en esa carpeta;
`apps/functions/src/penalties/no-show-penalty-service.ts`,
`apps/functions/src/levels/progress-report-service.ts`, `level-service.ts` en esa carpeta;
`apps/functions/src/courses/course-jobs.ts`.
**Modificar web:** `apps/web/src/lib/calendar/calendar-repository.ts`,
`firebase-calendar-repository.ts` en esa carpeta;
`apps/web/src/app/account/calendar/member-calendar.tsx`, `session-card.tsx`,
`day-column.tsx`, `calendar-header.tsx` en esa carpeta;
`apps/web/src/app/coach/page.tsx`, `apps/web/src/lib/schedule-client.ts`.

**Consume:** CourseEnrolment, CourseActor, SessionRecord y BookingRecord actual.
**Produce:** contrato versionado de reserva, política de acceso y proyección bajo demanda.

```ts
// Conservar contrato anterior con este nombre, incluidos membershipId y schemaVersion "1".
export type BookingRecord = LegacyBookingRecord | CourseBookingRecord;
export type CourseBookingRecord = Omit<LegacyBookingRecord,
  "membershipId" | "schemaVersion"> & {
  schemaVersion: "2"; membershipId: null;
  source: {kind: "course"; courseId: string; enrolmentId: string};
  absent: boolean;
};
export type CourseAccess = {
  courseId: string; enrolmentId: string; studentId: string;
  accessFrom: string; revision: number;
};
export function canAccessCourseSession(e: CourseEnrolment, s: SessionRecord): boolean {
  return (e.status === "approved" || e.status === "withdrawal_requested")
    && e.studentId !== null && s.courseId === e.courseId
    && e.accessFrom !== null && Date.parse(s.startAt) >= Date.parse(e.accessFrom)
    && s.status !== "cancelled";
}
export function ensureCourseBooking(db: Firestore, actor: CourseActor,
  sessionId: string, studentId: string): Promise<CourseBookingRecord>;
export function setCourseAbsence(db: Firestore, actor: CourseActor,
  input: {requestId: string; sessionId: string; studentId: string; absent: boolean})
  : Promise<CourseBookingRecord>;
```

- [ ] Mantener parseo v1 y normalizar su origen a membership en el adaptador, sin reescribir
  datos. V2 requiere source.kind=course, membershipId=null y relación canónica existente.
  Ningún `as BookingRecord` debe ocultar membershipId ausente. Usar el generador canónico
  existente de bookingId por sesión/alumno (no un segundo ID para el mismo par).
- [ ] canAccessCourseSession es un predicado de fechas/estado, no una autorización completa:
  servicio comprueba academia, liveness, vínculo del actor, curso publicado/completado,
  alumno, revisión de publicación y sesión. Coach: asignación vigente por UID, nunca
  nombre guest. Alumno/tutor: vínculo actual. Los IDs conocidos no bastan. Owner/admin
  acceden sin membresía y sin crear participante para sí mismos.
- [ ] ensureCourseBooking lee la inscripción autoritativa y la sesión dentro de la
  transacción que crea/actualiza la reserva. Un worker no sobreescribe absent ni asistencia.
  Proyección procesa solo sesiones no iniciadas desde accessFrom y máximo 100 escrituras
  incluyendo progreso; cada lote revalida revisión. Una baja/cancelación invalida el job.
  Mantener sesiones futuras reprogramadas y no usar ordinal como orden cronológico.
- [ ] Calendario y roster consultan inscripciones aprobadas/baja solicitada por curso y
  página, fusionan por studentId con reservas proyectadas y pueden asegurar una reserva
  antes de check-in. Lecturas retrasadas no conceden acceso: la transacción final comprueba
  la inscripción nuevamente. No generar reservas retroactivas para incorporaciones tardías.
- [ ] Separar participantes de membresías en CalendarParticipant: identidad obligatoria,
  `membership: {membershipId, planId, membershipStartsAt, membershipEndsAt,
  planClassSites, planOpenMatSites, weeklyClassLimit} | null` y `courseAccess: CourseAccess[]`.
  Mantener los tipos de cada campo del contrato anterior y participantType. loadMember
  une alumnos canónicos autorizados por membresía o curso; loadWeek consulta rango visible
  y cursos autorizados. No fabricar planId, sede o weeklyClassLimit para un course-only.
- [ ] Ampliar CalendarRole con owner/administrator/coach/shopper/headCoach para mostrar identidad,
  nunca para decidir permisos en navegador. La política de calendario decide primero si
  session.courseId existe: requiere CourseAccess exacto; solo para sesiones ordinarias
  usa la lógica previa de membresía, grupos y cuotas. Curso ajeno no aparece reservable.
- [ ] Session-card usa “Session 2 of 6” y “Included in your course”; acción “Mark absent”
  / “Undo absence” sustituye cancelar reserva ordinaria para cursos. No mostrar el texto
  existente “Missing it costs £15” en cursos. Ausencia no libera plaza ni crea deuda.
  Backend ordinario book/cancel rechaza sesión con courseId y dirige al flujo de curso.
- [ ] Attendance y self-check-in conservan ventanas, ubicación, actor y controles actuales.
  Para curso resuelven reserva por ensureCourseBooking y origen, sin exigir membresía;
  no omitir esos controles por tratarse de curso. Coach habitual ve roster mínimo y
  asistencia, sin emails financieros, proofId ni referencias. Consultas de límites
  semanales, PAYG, no-show ordinario y graduación excluyen source curso explícitamente.
- [ ] Revisión RF5: proyección cero/parcial/completa, baja con reserva vieja confirmed,
  ausencia deshecha, miembro con curso+plan, cuenta solo curso, sesión reprogramada al
  pasado y asistencia antigua. Revisar consumidores de BookingRecord con `rg` y separar
  por origen; actualizar adaptadores afectados, sin tocar archivos de pruebas prohibidos.
- [ ] Commit: `feat: integrate course access into existing calendars and attendance`.

## Tarea 8: API pública mínima, API privada y avisos internos

**Crear:** `apps/functions/src/courses/course-callables.ts`, `course-public-http.ts`,
`course-queries.ts`, `course-scheduler.ts`; `apps/web/src/lib/course-public-client.ts`,
`course-client.ts`, `course-session.tsx`, `use-course-notices.ts`.
**Modificar:** `apps/functions/src/index.ts`, `firestore.indexes.json`, `firestore.rules`.
**Consume:** operaciones de tareas 2–7; auth-client/firebase-client existentes para login
sin inicializarlos desde la barra pública. Imports backend R2 solo en funciones privadas.

**Produce:** los DTO públicos siguientes y los métodos de lectura privados.

```ts
export type PublicCourse = Pick<Course, "courseId" | "revision" | "kind" | "title"
  | "description" | "techniques" | "minAge" | "maxAge" | "priceMinor" | "currency"
  | "sessionCount" | "nextSessionAt" | "cancellationTerms" | "timezone"> & {
  instructorName: string; locationName: string; status: "published" | "completed";
  availability: "available" | "waitlist" | "closed";
};
export type CourseNotice = CourseNoticeDraft & {noticeId: string; readAt: string | null};
export type CourseListFilter = {
  courseId?: string; status?: EnrolmentStatus; cursor?: string;
};
export function listCourseEnrolments(db: Firestore, actor: CourseActor,
  filter: CourseListFilter): Promise<CoursePage<CourseEnrolment>>;
export function listCourseNotices(db: Firestore, actor: CourseActor,
  cursor?: string): Promise<CoursePage<CourseNotice>>;
export function markCourseNoticeRead(db: Firestore, actor: CourseActor,
  noticeId: string): Promise<void>;
export function listCourseSessions(db: Firestore, actor: CourseActor | null,
  courseId: string, cursor?: string): Promise<CoursePage<CourseSlot & {
    status: SessionRecord["status"];
  }>>;
export function listCoursePaymentIncidents(db: Firestore, actor: CourseActor,
  filter: {courseId?: string; enrolmentId?: string; cursor?: string})
  : Promise<CoursePage<CoursePaymentIncident>>;
export function listCourseParticipants(db: Firestore, actor: CourseActor,
  cursor?: string): Promise<CoursePage<ParticipantScope>>;
export function listCourseRefunds(db: Firestore, actor: CourseActor,
  enrolmentId: string, cursor?: string): Promise<CoursePage<CourseRefund>>;
export function getPublicCourses(cursor?: string): Promise<CoursePage<PublicCourse>>;
export function getPublicCourse(courseId: string): Promise<PublicCourse>;
```

- [ ] Exportar callables con los mismos nombres de servicios de mutación, estrictos
  inputs Zod, App Check y requireCourseActor/Office según acción. No aceptar db/actor
  del cliente: el wrapper los inyecta. course-client expone funciones con igual input
  y resultado omitiendo db/actor/r2. Todos los listados retornan 30 máximo, curso y
  academia delimitados antes de query. Propietario implícito del solicitante; filtros
  del cliente no permiten listar a terceros. Coach no obtiene CourseEnrolment financiero:
  su roster continúa en schedule, con DTO deportivo mínimo de tarea 7.
- [ ] Añadir lecturas privadas `getCourse(db, actor, courseId): Promise<Course>` y
  `listCourses(db, actor, cursor?): Promise<CoursePage<Course>>` restringidas a oficina;
  `getCourseEnrolment(db, actor, enrolmentId): Promise<CourseEnrolment>` para oficina o
  solicitante; `getCoursePaymentInstructions(db, actor, enrolmentId)` devuelve el
  PaymentInstructionsRecord existente solo tras verificar solicitud autorizada.
  Listado de participantes devuelve solo identidades canónicas/candidatas autorizadas;
  incidencias y refunds financieros completos son de oficina. Para solicitante devolver
  únicamente sus incidencias/resoluciones y devoluciones, sin notas internas ni terceros.
  `getCourseSession(db, actor): Promise<{uid: string; role: string; canApply: boolean}>`
  resuelve sesión canónica: adolescente canApply=false; cuenta adulta puede actuar.
- [ ] CourseSessionProvider reutiliza subscribeToIdTokenChanges de auth-client, admite
  staff por UID aun sin email/displayName y consulta getCourseSession. Un usuario sin
  rol usa registerShopperAccount existente una sola vez; nunca modificar un rol existente.
  No relajar ClientAuthProvider global para conceder acceso a otras áreas. Las rutas
  de retorno deben empezar por `/` simple y pertenecer a /courses o /account/courses,
  rechazando `//`, esquemas, barras invertidas y codificaciones equivalentes.
- [ ] Publicar `coursePublic` como onRequest HTTP: GET con `view=list|detail|sessions`,
  courseId UUID/cursor validados, academia configurada en servidor. Rechazar otros
  métodos y tamaños excesivos; CORS solo orígenes BPT configurados. DTO construido por
  allowlist, nunca spread del documento privado. CORS no es autorización; este endpoint
  es deliberadamente público y no exige App Check. Cursos draft/cancelled no aparecen;
  detalle finalizado puede mostrar estado cerrado sin nuevas inscripciones.
- [ ] Revision de proyección incluye fechas/estado/ocupación orientativa. ETag de cuerpo
  serializado; HTTP304 solo si sigue siendo pública la revisión consultada. Headers
  max-age=0,must-revalidate; errores/not-found no-store. Cliente deduplica solicitudes
  en memoria, aborta al desmontar y conserva datos previos al refrescar. URL de Functions
  pública se configura sin credenciales; no añadir SDK Firebase al bundle de la barra.
- [ ] Scheduler cada minuto reclama trabajos por lease con vencimiento y cursor; presupuesto
  máximo 100 documentos escritos por lote, 40s de trabajo por invocación. Continuar en
  siguiente tick si queda trabajo. Vencimientos en lecturas siguen siendo autoritativos.
  Fan-out usa kind notify_session y recipientCursor/eventId de CourseJob; no escribe
  todos los avisos en el lote de la sesión. Consumir el presupuesto de escrituras real,
  reservando espacio para cursor, avisos y recibos, no 100 sesiones más sus metadatos.
- [ ] Añadir índices compuestos en ámbitos de academia: enrolments(courseId,status,
  queuedAt,enrolmentId), (status,expiresAt,enrolmentId), (applicantUid,updatedAt,enrolmentId),
  (courseId,status,enrolmentId), (studentId,status,enrolmentId); notices(recipientUid,
  createdAt,noticeId); sessions(courseId,startAt,sessionId); jobs(state,leaseUntil,jobId);
  proofs(state,createdAt,proofId); publicCourses(nextSessionAt,courseId). Establecer
  direcciones acordes a cada consulta y cursores que incluyan todos los campos ordenados.
  Reglas mantienen denegación directa cliente a las colecciones privadas; Admin SDK
  solo a través de servicios autorizados. No ampliar catch-all allow.
- [ ] useCourseNotices refresca al entrar, foco y mutación relevante; deduplica promesas,
  cancela al salir y vacía estado al cambiar UID/academia. No timers nuevos por shell ni
  localStorage de datos privados. Errores de negocio usan CourseErrorCode; otros errores
  devuelven unavailable sin stack, tokens ni URLs de archivos.
- [ ] Revisión de rutas: petición anónima obtiene solo DTO público; alumno ajeno/tutor ajeno/
  coach financiero reciben denegación; owner sin suscripción obtiene gestión. No navegar
  ni ejecutar suites en esta fase; inspeccionar reglas, wrappers e imports.
- [ ] Commit: `feat: expose scoped course APIs and in-app notifications`.

## Tarea 9: administración de cursos y solicitudes

**Crear:** `apps/web/src/app/admin/courses/page.tsx`, `course-editor.tsx`,
`course-sessions.tsx`, `course-enrolment-queue.tsx`, `course-request-detail.tsx`,
`course-refund-panel.tsx`, `courses.css` en esa carpeta.
**Modificar:** `apps/web/src/app/admin/admin-shell.tsx`, `admin-routes.ts` en esa carpeta.
**Consume:** course-client de tarea 8 y componentes/formularios/tokens del admin existente.
**Produce:** gestión completa bajo /admin/courses, sin perfil personal del administrador.

- [ ] Añadir “Courses & Seminars” a navegación owner/administrator y denegar a coach en
  admin-routes. Estado de cuenta activa y permisos server siguen siendo autoridad;
  ninguna membresía personal para office. Enlace al catálogo para otros roles se añade
  como navegación pública, no como permiso para este módulo administrativo.
- [ ] Construir página con encabezado, Create course y lista paginada. Seleccionar curso
  abre pestañas “Overview”, “Sessions”, “Requests”, “Participants”, “Waitlist”, “Payments”.
  Contadores desconocidos muestran guion/estado pendiente, nunca cero inventado. Filtro
  por estado en servidor y detalle por solicitud; conservar filtros al volver.
- [ ] Editor en tres grupos: información/técnicas, instructor/sede/edades, fechas/precio/
  capacidad/condiciones. Guardar borrador y Publish diferenciados. Lista previa muestra
  exactamente N fechas, zona Jersey y total GBP; para N grande paginar vista previa.
  Seleccionar staff por ID o introducir invitado en campo separado. Horarios erróneos
  o DST ambiguo señalan campo y fecha. Progreso de publicación reanudable visible.
- [ ] Tabla desktop y filas apiladas móvil para solicitudes; nombre del participante,
  solicitante, curso, importe, fecha, estado y acción. Drawer/dialog de detalle usa
  componentes existentes y muestra referencia bancaria, captura bajo demanda, historial
  y motivo. Approve habilitado para estado revisable; no pide displayName de Auth ni
  suscripción. Mostrar campos del participante como texto React, no HTML.

```tsx
// Props: request: CourseEnrolment; busy: boolean; hasOpenLatePaymentIncident: boolean;
// approve: (input: ApprovalInput) => Promise<void>; operationId: string.
// hasOpenLatePaymentIncident procede del listado autorizado; servidor revalida aforo/cola.
<button type="button" disabled={busy || (request.status !== "review" && !hasOpenLatePaymentIncident)}
  onClick={() => approve({enrolmentId: request.enrolmentId,
    expectedRevision: request.revision, requestId: operationId})}>
  {busy ? "Approving…" : "Approve"}
</button>
// operationId se crea una vez por intención y se conserva si hubo timeout.
```

- [ ] Al completar, actualizar fila/detalle/contadores locales con respuesta y revalidar
  solicitudes afectadas; no window.location.reload ni descargar todo el catálogo. Si
  conflict, mostrar estado actualizado con explicación, sin perder selección. Captura
  no se carga en tablas ni queda en memoria después de cerrar/cambiar sesión.
- [ ] Request correction y Reject exigen motivo; Withdrawals y Payments tienen acciones
  explícitas y separadas. Pago tardío abre incidencia y muestra aforo real antes de aprobar;
  sin plaza ofrece resolver/devolver manualmente, nunca fuerza sobreaforo. Refund muestra
  pending frente a recorded claramente; enviar no ejecuta transferencia. Confirmaciones
  concretas solo para cancelación de curso, rechazo/baja y dinero registrado.
- [ ] Sesiones permiten reprogramar/cancelar conservando ID, ordinal e historial. Avisar
  impacto en participantes antes de confirmar. Aforo/importe editados muestran restricción
  de plazas comprometidas y vigencia solo para futuras solicitudes; no recalcular compras.
- [ ] Aplicar DESIGN.md: canvas cálido, panel blanco, púrpura BPT, tablas con reglas finas,
  tipografía existente y jerarquía clara, sin tarjetas para cada dato. Móvil en columna,
  botones ≥44px, foco visible, diálogo con foco contenido y devolución al disparador,
  errores asociados con aria-describedby y resultado breve en aria-live polite.
- [ ] Inspección de estados vacío, carga, error, revisión, conflicto, publicación parcial,
  prueba caducada y devolución parcial; no capturas reales de usuarios en documentación.
- [ ] Commit: `feat: add course administration and payment review screens`.

## Tarea 10: catálogo, barra promocional e inscripción personal

**Crear:** `apps/web/src/app/courses/page.tsx`, `view/page.tsx`,
`public-course-list.tsx`, `public-course-detail.tsx`, `course-promo-bar.tsx`,
`courses.css` en la carpeta courses; `apps/web/src/app/account/courses/page.tsx`,
`course-application.tsx`, `my-course-requests.tsx`, `course-payment-form.tsx`,
`course-notice-list.tsx`, `courses.css` en la carpeta account/courses.
**Modificar:** `apps/web/src/app/page.tsx`, `apps/web/src/app/account/page.tsx`,
`apps/web/src/app/account/calendar/calendar-header.tsx`,
`apps/web/src/app/coach/page.tsx`, `apps/web/src/app/shop/page.tsx`,
`apps/web/src/app/admin/admin-shell.tsx`, `apps/web/src/lib/calendar/index.ts`.
**Consume:** PublicCourse, CoursePage, CourseSessionProvider, course-client,
course-public-client y MemberCalendar/CalendarRepository existentes adaptados en tarea 7.
**Produce:** flujo comercial completo, manteniendo login y destinos de cada rol.

- [ ] Leer guía instalada de Next sobre static exports antes de escribir rutas. Crear
  `/courses` y `/courses/view?course=<uuid>` estáticas con metadatos generales de BPT.
  view/page.tsx envuelve el componente que usa useSearchParams en Suspense. No crear
  route handlers dinámicos ni getServerSideProps en una app output export. Estado inicial
  reservado permite cargar datos sin desplazar el resto de la portada.
- [ ] Catálogo lista título, próxima sesión, sede, edad, precio GBP y disponibilidad.
  Ficha: descripción, técnicas en lista, nombre de coach, todas las fechas paginadas,
  condiciones y CTA “Join course” / “Join waitlist”. Para incorporación tardía mostrar
  “Full course price” y fechas restantes antes de aceptar. La disponibilidad visual es
  orientativa; nunca autoriza plaza. Curso cerrado explica por qué sin pedir pago.
- [ ] Insertar una barra debajo de la navegación de portada, en flujo normal, con título,
  próxima fecha y enlace. Mantener enlace estático “Courses & Seminars” siempre visible.
  Datos comparten fetch deduplicado con catálogo cuando coincidan; ninguna carga de Auth
  para mostrarla. Si no hay cursos, ocultar pista manteniendo navegación; error permite
  reintentar desde catálogo y no bloquea hero ni contacto.

```css
.course-promo__track { display: flex; width: max-content;
  animation: course-promo-scroll 35s linear infinite; }
.course-promo:is(:hover, :focus-within) .course-promo__track,
.course-promo[data-paused="true"] .course-promo__track { animation-play-state: paused; }
@keyframes course-promo-scroll { to { transform: translateX(-50%); } }
@media (prefers-reduced-motion: reduce) {
  .course-promo__track { animation: none; transform: none; width: auto; flex-wrap: wrap; }
  .course-promo__copy { display: none; }
}
```

- [ ] La pista contiene dos grupos geométricamente iguales para el bucle; el segundo
  es solo visual, aria-hidden e inert, sin elementos focalizables. Pausa visible con
  aria-pressed conserva elección hasta salir de página. Pausar al foco permite leer y
  activar el enlace principal; no usar aria-live en texto en movimiento ni animación JS.
  CSS fija espacio suficiente para banda/botón y texto largo; sin recortes que oculten CTA.
- [ ] /account/courses usa CourseSessionProvider independiente del gate de membresías.
  Secciones “My requests”, “My courses” y “Notifications”; selector de participante solo
  muestra relaciones permitidas. Adulto nuevo completa candidato, tutor crea/reutiliza
  menor; staff conserva rol y ve “Back to administration/coaching”. Administrar no obliga
  a completar datos personales; estos se piden solo si decide inscribir un participante.
- [ ] course-application conserva courseRevision y aceptación explícita de condiciones;
  reserve/joinWaitlist recibe participante, no precio editable. Un hermano inicia su
  propia solicitud; no total familiar ni captura compartida. Al agotar aforo ofrecer cola
  sin datos de pago y explicar avisos solo dentro de la plataforma.
- [ ] Formulario de pago muestra destinatario y datos bancarios de settings, importe,
  referencia generada y campo de referencia realmente utilizada. Copy button con estado
  accesible; PNG/JPEG ≤2MiB explicado. Preview local usa objectURL revocado al reemplazar/
  salir; comprobación cliente mejora UX pero servidor revalida. Subir y enviar son dos
  pasos técnicos bajo una acción clara “Submit payment for review”, con progreso textual.
  Conservar proofId y requestId al reintentar, sin guardar el archivo en localStorage.
- [ ] Reserva/oferta/corrección muestra fecha absoluta en Jersey y contador aproximado.
  El servidor decide caducidad; refrescar pestaña no reinicia plazo. Review muestra
  “Payment under review”; captura tardía “Payment received for review — do not pay again”.
  Error distingue archivo, expiración, aforo y servicio; conservar referencia al reintentar.
  Una corrección habilita nueva evidencia conservando historial y motivo anterior.
- [ ] “My courses” permite abrir el mismo MemberCalendar con repositorio autorizado y
  pestaña calendario; no duplicar componentes ni crear panel de coach. CalendarRepository
  acepta opción `scope: "all" | "courses"` (default all); scope courses consulta solamente
  datos de curso y evita penalizaciones/membresías ordinarias para shopper/staff.
  Usuarios habituales siguen viendo cursos + clases en /account. Staff comprador puede
  consultar sus sesiones personales aquí sin cambiar el destino de su acceso laboral.
- [ ] Enlaces al catálogo/seguimiento desde header de calendario, shop, coach y shell
  administrativo; no incluir gestión financiera en menú de coach/headCoach. Adolescente
  puede ver calendario propio, pero solicitudes/pagos se muestran como gestión del tutor
  sin acción de compra. Avisos enlazan a solicitud propia, nunca a la de otra familia.
- [ ] Diseño conserva superficies de DESIGN.md (admin/público rectos, excepción redondeada
  de account). Catálogo editorial legible, lista de técnicas simple y resumen de compra
  claro; no biblioteca de animación, fuentes nuevas o imágenes de stock decorativas.
  Cargar detalle de pago y calendario solo al entrar en su sección. Fetch independiente
  no provoca cascada curso→autenticación→catálogo ni recarga completa después de Approve.
- [ ] Inspección de imports, CSS y estados: reduce-motion, teclado, nombres largos,
  móviles, sin cursos, sin conexión, role staff sin email, menor y pago tardío. Objetivos
  LCP/INP/CLS siguen pendientes de medición autorizada; no afirmar que ya se cumplen.
- [ ] Commit: `feat: promote courses and add participant enrolment journeys`.

## Tarea 11: recuperación, privacidad y entrega coordinada

**Crear:** `apps/functions/src/courses/course-maintenance.ts`, `course-privacy.ts`,
`docs/runbooks/finite-courses-operations.md`.
**Modificar:** `apps/functions/src/courses/course-jobs.ts`, `course-scheduler.ts`,
`course-callables.ts`, `course-publication.ts`,
`apps/functions/src/data/backup-v3-contracts.ts`, `backup-v3-firestore-inventory.ts`
si la allowlist actual requiere registrar las nuevas colecciones; `PRODUCT.md`, `DESIGN.md`
solo con la funcionalidad finalmente entregada y la excepción de movimiento de la barra.
**Consume:** contratos de trabajos, proofs, operaciones, identidades y auditoría.
**Produce:** recuperación acotada y procedimientos que no borran evidencia por error.

```ts
export function retryCourseJob(db: Firestore, actor: CourseActor,
  jobId: string, requestId: string): Promise<CourseJob>;
export function cleanOrphanCourseProofs(db: Firestore, r2: R2Client,
  academyId: string, now: string): Promise<{deleted: number; more: boolean}>;
export function cancelCourse(db: Firestore, actor: CourseActor,
  input: {courseId: string; expectedRevision: number; requestId: string; reason: string})
  : Promise<Course>;
export function exportCourseSubjectData(db: Firestore, actor: CourseActor,
  subjectUid: string, cursor?: string): Promise<CoursePage<{
    collection: string; recordId: string; data: Record<string, unknown>;
  }>>;
```

- [ ] Registrar jobs con lease, intentos, próximo intento y error saneado (código, sin
  capturas/URLs). Reintentos automáticos limitados con retraso exponencial y tope 15min;
  tras 5 fallos pasar a failed con aviso interno office y botón Retry autorizado.
  Usar attempts y nextAttemptAt de CourseJob y añadir índice por estado y nextAttemptAt. Worker nunca reinicia un job de otra revisión ni borra su historial.
- [ ] cancelCourse cambia autoridad a cancelled en transacción, bloquea ventas/ofertas,
  revoca futuro por política y encola cancelación de sesiones futuras y avisos. No esperar
  al job para negar nuevas reservas. Cada solicitud con dinero/evidencia queda enlazada
  a incidencia course_cancelled; historial de asistencia y finanzas permanece. Liberar
  contadores/locks por lotes sin ofertar plazas de un curso cancelado.
- [ ] Reprogramación/cancelación individual actualiza nextSessionAt usando sesiones reales
  activas y revisión pública en la misma decisión o job de publicación coherente. El fin
  del curso depende de la última sesión vigente por fecha, no del ordinal mayor. Si no
  quedan sesiones futuras, cerrar ventas y resolver pagos pendientes sin aprobar acceso.
- [ ] Limpiar orphan proofs uploading/ready con más de 48h y sin vínculo a solicitud,
  historial o incidencia. Reclamar `deleting` por transacción tras comprobar referencias;
  submit rechaza estado deleting para evitar carrera. Borrar R2 idempotentemente y luego
  metadata; fallo deja tombstone para reintento. Un archivo attached nunca es huérfano
  aunque solicitud esté rechazada o cancelada. Este job no es retención financiera.
- [ ] Exportación de sujeto: solo oficina canónica, por academia y relación solicitante/
  participante; paginar 30 y excluir datos de terceros, claves internas y signed URLs.
  Evidencia se descarga por getCourseProofUrl autorizado, no URL pública permanente.
  Runbook incorpora tratamiento de solicitudes de eliminación: resolver referencias y
  política financiera vigente antes de cualquier borrado; no crear endpoint autoservicio
  destructivo ni activar plazos propuestos en ADR-008. Registrar las nuevas colecciones y
  referencias de R2 en inventario/backup; backup Firestore no equivale a copia de objetos.
- [ ] Documentar recuperación de cinco fallos: publicación parcial → mismo job; timeout de
  aprobación → mismo requestId; identidad creada sin pago → continuar recibo; proyección
  caída → acceso autoritativo y replay; R2 guardado sin submit → recuperar proofId o limpieza
  48h si no quedó adjunto. Añadir procedimiento office para conciliar contador con registros
  sin corregir a ciegas: pausar ventas del curso, inspeccionar operaciones, reconstruir
  total en snapshot consistente, aplicar cambio auditado y reabrir. No reset global.
- [ ] Registrar aceptación por inspección de código, no resultados inventados. Confirmar
  los doce escenarios de la spec contra cambios concretos; revisar permisos en backend,
  transacciones, DTO públicos, consumidores de registros v1/v2 e imports de landing.
  No ejecutar pruebas, navegador, lint, typecheck global ni builds por rutina.
- [ ] Secuencia de futura publicación, solo dentro de autorización de despliegue aplicable:
  flag apagado → índices y backend compatible → frontend → activar cursos. Ante rollback,
  apagar nuevas ventas preservando aprobados y resoluciones; no desplegar un backend viejo
  que no entienda v2 después de generar registros v2. Preferir reparación compatible.
  Compilar únicamente los artefactos necesarios cuando se autorice ese despliegue.
- [ ] Commit scoped por tarea en main y push origin/main, preservando cambios ajenos.
  Al finalizar implementación, inspeccionar git status, fetch y comprobar que SHA entregado
  es ancestro de main local y origin/main; nunca force-push. Separar en informe código
  publicado en GitHub, despliegue efectivo y comportamiento observado. Redacción de este
  plan entrega solo documentos; no activar funciones ni flags.
- [ ] Commit: `docs: document course recovery privacy and coordinated release`.

## Matriz de cobertura y revisión del plan

| Requisito de la especificación | Tareas responsables | Evidencia prevista por inspección |
| --- | --- | --- |
| §2 decisiones y seis sesiones semanales | 1, 2, 7 | N finito, zona Jersey, IDs y coach habitual |
| §4 borrador, publicación, aforo, precio, edición | 1, 2, 4, 9 | Revisión publicada coherente y snapshots |
| §5 adulto nuevo, tutor, pago por participante | 3, 5, 6, 10 | Identidad, vínculo, solicitud y recibo individual |
| §6 plaza 24h, corrección, FIFO, pago tardío | 4, 5, 6 | Transacciones y estados independientes del dinero |
| §7 reservas, asistencia, bajas, no PAYG | 6, 7, 11 | Origen v2 y acceso autoritativo al decidir |
| §8 admin, usuario, coach, barra y avisos | 8, 9, 10 | Navegación, privacidad del coach, pausa y reduced-motion |
| §9 autorización, archivos, rate limits, privacidad | 3, 4, 5, 8, 11 | Controles backend y recuperación sin borrar evidencia |
| §10 rendimiento y consistencia | 2, 7, 8, 10 | Páginas de 30, lotes ≤100, carga diferida y JSON público |
| §11 integración con finanzas existentes | 6 | Parsers v1/v2, pagador real y totales sin duplicación |
| §12 criterios 1–12 | 2–11 | Escenarios descritos por tarea; no pruebas ejecutadas |
| §13 exclusiones | Global y 7–11 | Sin panel coach nuevo, cuotas, email ni banco automático |

**RF1:** tarea 2. **RF2:** tarea 4. **RF3:** tarea 3. **RF4:** tareas 5–6.
**RF5:** tareas 6–7. La revisión documental no sustituye pruebas de funcionamiento.

**Revisión documental realizada:** cobertura de las secciones de la spec, búsqueda de
marcadores pendientes, contratos entre tareas y cinco riesgos RF contrastados. Correcciones
incorporadas: excepciones a IDs UUID, rol headCoach, oferta con snapshot original, aprobación
de incidencias tardías y presupuesto de escrituras que incluye metadatos. Sin pruebas ni
mediciones ejecutadas; siguen siendo criterios para la futura implementación.

**Único ajuste funcional/técnico solicitado para revisión:** URL de ficha y forma de
entregar su contenido público por la exportación estática, descrito al principio.
Las demás decisiones acordadas se conservan. Los límites técnicos no son cuotas de
suscripción del owner; protegen transacciones, imágenes y solicitudes de autoservicio.

**Método recomendado para implementar:** Native, porque calendario, identidad, aforo y
finanzas comparten contratos y conviene mantener el contexto de las once tareas. Significa
implementar en esta sesión y una revisión independiente final según la skill de ejecución;
no autoriza delegar ahora. Subagent-driven es alternativa con revisión independiente por
cada tarea, a mayor coste de contexto. La selección corresponde al operador después de
revisar este plan. No se ha comenzado la implementación ni autorizado su despliegue.
