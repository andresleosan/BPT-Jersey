# Classes / Services — History: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `/admin/classes-services/history` muestre el registro real de reservas, cancelaciones y asistencias — fecha, usuario, IP y frase legible — filtrable, exportable a PDF y alimentado tanto por los eventos nuevos de BPT como por el histórico importado de Regyfit.

**Architecture:** Los eventos se escriben como `auditEvents` dentro de la misma transacción que crea o cancela la reserva (fallo cerrado). Una función pura del dominio traduce evento + nombres a una frase en inglés; el callable consulta, resuelve nombres por lotes, oculta la IP a quien no puede verla y devuelve filas ya compuestas. La pantalla es una tabla con panel de filtros que no consulta nada hasta pulsar LIST.

**Tech Stack:** TypeScript estricto; Firebase Functions v2 (`onCall`), Firestore; Next.js 16 / React 19 con `output: "export"`; `pdf-lib` 1.17.1 (ya es dependencia); Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-classes-services-history-design.md` (decisiones H1–H4 del operador y G1–G9 del grill).

## Global Constraints

- Rama y worktree: `feature/cs-history` en `/root/BPT-Jersey-wt/history`, creada desde `main` (`1b72e0b`). **Todo el trabajo ocurre ahí**; otra sesión trabaja en `feature/member-profile-e0-e2` y no se toca.
- Comandos siempre con `corepack pnpm <script>` desde la raíz del repo. Node `>=22.13 <25`.
- `packages/domain` **nunca** importa Firebase.
- **Sin dependencias nuevas.** El módulo `audit` valida a mano (`parseAuditEventDraft` en `packages/domain/src/audit/audit-event.ts`), no con zod; se sigue ese estilo, igual que hacen `staff-callables.ts` y `staff-client.ts` con sus patrones y listas de campos.
- Interfaz en inglés; documentación y mensajes al operador en español. Código e identificadores en inglés.
- DESIGN.md manda en la interfaz: radio 0, sin emojis ni iconos decorativos, sin píldoras, sin spinners, sin azul, `tabular-nums` en cifras, estado = texto + filo de color a la izquierda, foco púrpura de 3 px, `prefers-reduced-motion` respetado.
- Nunca datos personales en `logger` ni en mensajes de error; el cliente recibe cadenas seguras fijas.
- Una prueba que solo comprueba que algo existe no vale (LECCIONES.md §4): se afirma el valor, y de cada guarda nueva se comprueba a mano que al desactivarla muere una prueba.
- Zona horaria de presentación: `Europe/Jersey`. Los datos se guardan en UTC ISO.
- Cada tarea termina con `corepack pnpm typecheck && corepack pnpm lint` en verde y un commit.
- Nada se despliega a producción ni se importa a producción sin confirmación explícita del operador en chat.

---

### Task 1: Contrato del evento de clases en el dominio

**Files:**
- Modify: `packages/domain/src/audit/audit-event.ts`
- Test: `packages/domain/src/audit/audit-event.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: acciones `"booking.created" | "booking.cancelled" | "dropin.created" | "dropin.cancelled"`; tipo `ClassAuditEventDraft` con los campos `class`, `actorIp`, `actorRole`, `actorGroup`, `actorName`, `source`; función `classActorGroup(role: UserRole | "system" | "regyfit"): "member" | "staff" | "system"`; `parseAuditEventDraft` acepta los eventos nuevos y sigue aceptando los antiguos.

- [ ] **Step 1: Write the failing test**

En `packages/domain/src/audit/audit-event.test.ts` (fichero existente), añadir:

```ts
const classDraft = {
  academyId: "demo-academy",
  actorId: "user-1",
  action: "booking.created" as const,
  targetRef: "academies/demo-academy/bookings/b1",
  purpose: "class-booking-log",
  correlationId: "b1",
  class: {
    studentId: "s1",
    studentName: null,
    sessionId: "sess1",
    sessionStartAt: "2026-09-16T17:30:00Z",
    programId: "gi-all-levels",
    locationId: "town",
  },
  actorIp: "82.112.144.10",
  actorRole: "adultStudent" as const,
  actorGroup: "member" as const,
  actorName: null,
  source: "bpt" as const,
};

it("accepts a class booking event", () => {
  const result = parseAuditEventDraft(classDraft);
  expect(result.ok).toBe(true);
});

it("accepts a class event for a session without programme or location", () => {
  const result = parseAuditEventDraft({
    ...classDraft,
    class: { ...classDraft.class, programId: null, locationId: null },
  });
  expect(result.ok).toBe(true);
});

it("rejects a class event whose IP is not an address", () => {
  const result = parseAuditEventDraft({ ...classDraft, actorIp: "not-an-ip" });
  expect(result.ok).toBe(false);
});

it("accepts an imported event with no student id and a plain name", () => {
  const result = parseAuditEventDraft({
    ...classDraft,
    class: { ...classDraft.class, studentId: null, studentName: "Olivia Lewis" },
    actorRole: "regyfit" as const,
    actorGroup: "member" as const,
    actorName: "Prof. Charles Tromans",
    source: "regyfit" as const,
  });
  expect(result.ok).toBe(true);
});

it("still accepts an event written before this change", () => {
  const result = parseAuditEventDraft({
    academyId: "demo-academy",
    actorId: "user-1",
    action: "member.created",
    targetRef: "academies/demo-academy/students/s1",
    purpose: "member-maintenance",
    correlationId: "c1",
  });
  expect(result.ok).toBe(true);
});

it("groups every role into member, staff or system", () => {
  expect(classActorGroup("guardian")).toBe("member");
  expect(classActorGroup("teenStudent")).toBe("member");
  expect(classActorGroup("headCoach")).toBe("staff");
  expect(classActorGroup("administrator")).toBe("staff");
  expect(classActorGroup("system")).toBe("system");
  expect(classActorGroup("regyfit")).toBe("member");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm vitest run --project node packages/domain/src/audit/audit-event.test.ts
```

Esperado: FAIL — `classActorGroup is not defined` y `AUDIT_ACTION_INVALID` para `booking.created`.

- [ ] **Step 3: Write minimal implementation**

En `audit-event.ts`: añadir las cuatro acciones a `auditActions`; añadir el bloque de variante y los campos a `fieldsByAction`; validar los campos nuevos.

```ts
export const classAuditActions = Object.freeze([
  "booking.created",
  "booking.cancelled",
  "dropin.created",
  "dropin.cancelled",
  "attendance.checked_in",
  "attendance.corrected",
  "attendance.proximity_override",
  "student.checked_out",
] as const);

export const classActorGroups = Object.freeze(["member", "staff", "system"] as const);
export type ClassActorGroup = (typeof classActorGroups)[number];
export type ClassActorRole = UserRole | "system" | "regyfit";

const staffRoles = Object.freeze(["owner", "administrator", "headCoach", "coach"] as const);

/** Regyfit rows were written by athletes, so an imported actor counts as a member. */
export function classActorGroup(role: ClassActorRole): ClassActorGroup {
  if (role === "system") return "system";
  if (staffRoles.includes(role as (typeof staffRoles)[number])) return "staff";
  return "member";
}

const ipv4Pattern = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/u;
const ipv6Pattern = /^[0-9a-fA-F:]{2,45}$/u;

export function isAuditIpAddress(value: unknown): value is string {
  return typeof value === "string" && (ipv4Pattern.test(value) || ipv6Pattern.test(value));
}
```

Los campos de una acción de clase son `[...commonFields, "class", "actorIp", "actorRole", "actorGroup", "actorName", "source"]`. La validación comprueba: `class` es objeto plano con exactamente sus seis claves; `sessionId` cumple `safeAuditIdentifierPattern`; `studentId`, `programId`, `locationId` son `null` o cumplen ese patrón; `studentName` es `null` o cadena acotada a 128 sin caracteres de control; `sessionStartAt` cumple `dateTimePattern`; `actorIp` es `null` o `isAuditIpAddress`; `actorRole` está en la lista; `actorGroup` coincide con `classActorGroup(actorRole)`; `source` es `"bpt"` o `"regyfit"`.

- [ ] **Step 4: Run test to verify it passes**

```bash
corepack pnpm vitest run --project node packages/domain/src/audit/audit-event.test.ts
corepack pnpm typecheck
```

Esperado: PASS. Si `matchesAuditEventReplay` se queja en otras pruebas, es porque compara claves exactas: no se toca, solo se comprueba que las pruebas existentes siguen verdes.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/audit/audit-event.ts packages/domain/src/audit/audit-event.test.ts
git commit -m "feat(domain): class audit events with actor role, group and IP (T048V2-H)"
```

---

### Task 2: Tipos de registro y compositor de frases

**Files:**
- Create: `packages/domain/src/audit/class-history-contracts.ts`
- Create: `packages/domain/src/audit/class-history-contracts.test.ts`
- Modify: `packages/domain/package.json` (subpath export `./audit`, si aún no expone este módulo), `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: Task 1 (`classAuditActions`, `ClassActorGroup`).
- Produces: `classHistoryRegistrationTypes` (los diez de Regyfit), `registrationTypeFilter(type): { actions: readonly string[]; groups: readonly ClassActorGroup[] }`, `composeClassHistorySentence(input: ClassHistorySentenceInput): string`, tipos `ClassHistoryRow` y `ListClassHistoryInput`.

- [ ] **Step 1: Write the failing test**

```ts
import { composeClassHistorySentence, registrationTypeFilter } from "./class-history-contracts";

const base = {
  action: "booking.created" as const,
  actorGroup: "member" as const,
  studentName: "Olivia Lewis",
  actorName: "Connor Hoopes",
  programName: "GI Beginners Lunchtime",
  sessionStartAt: "2026-09-16T17:30:00Z",
};

it("writes the member booking sentence", () => {
  expect(composeClassHistorySentence(base)).toBe(
    "Olivia Lewis booked the class of 16 Sep 2026 at 17:30",
  );
});

it("names the staff member who booked on somebody's behalf", () => {
  expect(composeClassHistorySentence({ ...base, actorGroup: "staff" })).toBe(
    "Olivia Lewis was booked by Connor Hoopes into GI Beginners Lunchtime on 16 Sep 2026 at 17:30",
  );
});

it("writes the member cancellation sentence", () => {
  expect(composeClassHistorySentence({ ...base, action: "booking.cancelled" })).toBe(
    "Olivia Lewis cancelled the booking for the class of 16 Sep 2026 at 17:30",
  );
});

it("writes the attendance sentence", () => {
  expect(
    composeClassHistorySentence({ ...base, action: "attendance.checked_in", actorGroup: "staff" }),
  ).toBe("Attendance was marked for the class of 16 Sep 2026 at 17:30");
});

it("falls back to Former member when the student is gone", () => {
  expect(composeClassHistorySentence({ ...base, studentName: null })).toBe(
    "Former member booked the class of 16 Sep 2026 at 17:30",
  );
});

it("prints Jersey local time, not UTC", () => {
  // 2026-01-16 is GMT in Jersey; 2026-09-16 is BST (+1).
  expect(
    composeClassHistorySentence({ ...base, sessionStartAt: "2026-01-16T17:30:00Z" }),
  ).toContain("16 Jan 2026 at 17:30");
  expect(composeClassHistorySentence(base)).toContain("at 18:30");
});

it("maps the Regyfit registration types to actions and actor groups", () => {
  expect(registrationTypeFilter("member-bookings")).toEqual({
    actions: ["booking.created"],
    groups: ["member"],
  });
  expect(registrationTypeFilter("coach-cancellations")).toEqual({
    actions: ["booking.cancelled"],
    groups: ["staff"],
  });
  expect(registrationTypeFilter("all").actions.length).toBe(8);
});
```

Nota: la prueba de hora local es la que decide el formateo; si al ejecutarla se ve que la hora esperada era otra, se corrige **la expectativa con el valor real de Jersey**, no la implementación a ojo.

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm vitest run --project node packages/domain/src/audit/class-history-contracts.test.ts
```

Esperado: FAIL — el módulo no existe.

- [ ] **Step 3: Write minimal implementation**

`class-history-contracts.ts`: los diez tipos (`all`, `member-bookings`, `member-cancellations`, `dropin-bookings`, `dropin-cancellations`, `coach-bookings`, `coach-cancellations`, `coach-dropin-bookings`, `coach-dropin-cancellations`, `attendance`), su tabla a acciones + grupos, y el compositor. El formateo usa `Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Jersey", … })`, sin dependencias.

- [ ] **Step 4: Run test to verify it passes**

```bash
corepack pnpm vitest run --project node packages/domain/src/audit/class-history-contracts.test.ts
corepack pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/audit packages/domain/package.json packages/domain/src/index.ts
git commit -m "feat(domain): Regyfit registration types and English log sentences (T048V2-H)"
```

---

### Task 3: La IP real del cliente

**Files:**
- Create: `apps/functions/src/audit/client-ip.ts`
- Create: `apps/functions/src/audit/client-ip.test.ts`

**Interfaces:**
- Consumes: Task 1 (`isAuditIpAddress`).
- Produces: `clientIpFromRequest(request: { rawRequest?: { headers?: Record<string, unknown>; ip?: unknown } }): string | null`.

- [ ] **Step 1: Write the failing test**

```ts
it("takes the first entry of X-Forwarded-For", () => {
  expect(
    clientIpFromRequest({
      rawRequest: { headers: { "x-forwarded-for": "82.112.144.10, 35.191.8.2" }, ip: "35.191.8.2" },
    }),
  ).toBe("82.112.144.10");
});

it("falls back to the socket address when there is no header", () => {
  expect(clientIpFromRequest({ rawRequest: { headers: {}, ip: "82.112.144.10" } })).toBe(
    "82.112.144.10",
  );
});

it("returns null rather than rubbish", () => {
  expect(clientIpFromRequest({ rawRequest: { headers: { "x-forwarded-for": "<script>" } } })).toBe(
    null,
  );
  expect(clientIpFromRequest({})).toBe(null);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm vitest run --project node apps/functions/src/audit/client-ip.test.ts
```

- [ ] **Step 3: Write minimal implementation**

```ts
import { isAuditIpAddress } from "@bpt-jersey/domain/audit";

export function clientIpFromRequest(request: {
  rawRequest?: { headers?: Record<string, unknown>; ip?: unknown };
}): string | null {
  const header = request.rawRequest?.headers?.["x-forwarded-for"];
  const forwarded = Array.isArray(header) ? header[0] : header;
  const first = typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : undefined;
  if (isAuditIpAddress(first)) return first;
  const socket = request.rawRequest?.ip;
  return isAuditIpAddress(socket) ? socket : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
corepack pnpm vitest run --project node apps/functions/src/audit/client-ip.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/audit/client-ip.ts apps/functions/src/audit/client-ip.test.ts
git commit -m "feat(functions): read the caller IP from the forwarded-for chain (T048V2-H)"
```

> **Verificación real (G4), obligatoria antes de cerrar la tarea:** arrancar los emuladores
> (`FUNCTIONS_DISCOVERY_TIMEOUT=300000 corepack pnpm firebase:emulators`), reservar una clase desde
> el navegador y comprobar en la UI del emulador que el evento guardó una IP con pinta de IP y no
> una dirección interna. Anotar el valor observado en la evidencia de la tarea. Si sale la IP del
> balanceador, se corrige aquí antes de seguir: la columna no puede mentir.

---

### Task 4: La reserva escribe su línea de registro

**Files:**
- Modify: `apps/functions/src/schedule/booking-transaction-service.ts`
- Modify: `apps/functions/src/schedule/schedule-callables.ts` (pasa IP y rol al servicio)
- Test: `apps/functions/src/schedule/booking-transaction-service.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 3, `appendAuditEventInTransaction` (`apps/functions/src/audit/audit-writer.ts`).
- Produces: `executeBookingInTransaction` y `cancelBookingInTransaction` aceptan `actorIp: string | null` y `actorRole: ClassActorRole` y escriben el evento dentro de la transacción.

- [ ] **Step 1: Write the failing test**

```ts
it("writes one audit event with the booking", async () => {
  const result = await executeBookingInTransaction({ ...input, actorIp: "82.112.144.10", actorRole: "adultStudent" });
  expect(result.ok).toBe(true);
  const events = firestore.documents("academies/demo-academy/auditEvents");
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    action: "booking.created",
    actorIp: "82.112.144.10",
    actorRole: "adultStudent",
    actorGroup: "member",
    source: "bpt",
    class: { studentId: "s1", sessionId: "sess1" },
  });
});

it("books a session that has no programme or location and logs it with empty fields", async () => {
  const result = await executeBookingInTransaction({ ...inputForIncompleteSession });
  expect(result.ok).toBe(true);
  expect(firestore.documents("academies/demo-academy/auditEvents")[0]).toMatchObject({
    class: { programId: null, locationId: null },
  });
});

it("does not create the booking when the audit event cannot be written", async () => {
  firestore.failCreatesIn("auditEvents");
  await expect(executeBookingInTransaction(input)).rejects.toThrow();
  expect(firestore.documents("academies/demo-academy/bookings")).toHaveLength(0);
});

it("logs a second booking of the same class after a cancellation", async () => {
  await executeBookingInTransaction(input);
  await cancelBookingInTransaction(cancelInput);
  await executeBookingInTransaction(input);
  expect(firestore.documents("academies/demo-academy/auditEvents")).toHaveLength(3);
});

it("writes the cancellation with the staff group when staff cancels", async () => {
  await executeBookingInTransaction(input);
  await cancelBookingInTransaction({ ...cancelInput, actorRole: "administrator" });
  const last = firestore.documents("academies/demo-academy/auditEvents").at(-1);
  expect(last).toMatchObject({ action: "booking.cancelled", actorGroup: "staff" });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm vitest run --project node apps/functions/src/schedule/booking-transaction-service.test.ts
```

Esperado: FAIL — no se escribe ningún evento.

- [ ] **Step 3: Write minimal implementation**

Antes de abrir la transacción (G6):

```ts
const auditRef = options.firestore.collection(path(academyId, "auditEvents")).doc();
```

y dentro del cuerpo, junto a la escritura de la reserva:

```ts
appendAuditEventInTransaction(transaction, auditRef, {
  academyId,
  actorId,
  action: "booking.created",
  targetRef: path(academyId, "bookings", bookingId),
  purpose: "class-booking-log",
  correlationId: bookingId,
  class: {
    studentId,
    studentName: null,
    sessionId,
    sessionStartAt: session.startAt,
    programId: session.programId ?? null,
    locationId: session.locationId ?? null,
  },
  actorIp: input.actorIp,
  actorRole: input.actorRole,
  actorGroup: classActorGroup(input.actorRole),
  actorName: null,
  source: "bpt",
});
```

Lo mismo en la cancelación con `action: "booking.cancelled"` y su propia referencia. En
`schedule-callables.ts`, `actorIp: clientIpFromRequest(request)` y `actorRole` desde el actor ya
resuelto; en llamadas de sistema, `null` y `"system"`.

- [ ] **Step 4: Run test to verify it passes**

```bash
corepack pnpm vitest run --project node apps/functions/src/schedule
corepack pnpm typecheck && corepack pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/schedule
git commit -m "feat(schedule): log every booking and cancellation in the same transaction (T048V2-H)"
```

---

### Task 5: El servicio de consulta

**Files:**
- Create: `apps/functions/src/audit/class-history-service.ts`
- Create: `apps/functions/src/audit/class-history-service.test.ts`

**Interfaces:**
- Consumes: Tasks 1 y 2.
- Produces: `listClassHistory(store, input, actor): Promise<{ rows: ClassHistoryRow[]; total: number }>`, donde `ClassHistoryRow = { occurredAt: string; actorLabel: string; actorIp: string | null; text: string }`. `ClassHistoryStore` es la interfaz que Task 6 implementa: `queryEvents({ actions, groups, since, limit })`, `readStudents(ids)`, `readSessions(ids)`, `readStaffNames(ids)`.

- [ ] **Step 1: Write the failing test**

```ts
const adminActor = { uid: "admin-1", academyId: "demo-academy", role: "administrator" as const };
const coachActor = { uid: "coach-1", academyId: "demo-academy", role: "headCoach" as const };

it("clamps the limit to the Regyfit range", async () => {
  await listClassHistory(store, { ...input, limit: 5000 }, adminActor);
  expect(store.lastQuery.limit).toBe(1000);
  await listClassHistory(store, { ...input, limit: 1 }, adminActor);
  expect(store.lastQuery.limit).toBe(100);
});

it("asks Firestore for the actions and groups of the chosen type", async () => {
  await listClassHistory(store, { ...input, registrationType: "coach-bookings" }, adminActor);
  expect(store.lastQuery).toMatchObject({ actions: ["booking.created"], groups: ["staff"] });
});

it("resolves each distinct student once", async () => {
  await listClassHistory(store, input, adminActor);
  expect(store.readStudentCalls).toEqual([["s1", "s2"]]);
});

it("shows Former member when the student no longer exists", async () => {
  store.students = new Map();
  const { rows } = await listClassHistory(store, input, adminActor);
  expect(rows[0].text).toContain("Former member");
});

it("hides the IP from an actor who may not read it", async () => {
  const { rows } = await listClassHistory(store, input, coachActor);
  expect(rows[0].actorIp).toBe(null);
});

it("keeps the IP for an administrator", async () => {
  const { rows } = await listClassHistory(store, input, adminActor);
  expect(rows[0].actorIp).toBe("82.112.144.10");
});

it("uses the imported name when the event has no student id", async () => {
  store.events = [importedEvent];
  const { rows } = await listClassHistory(store, input, adminActor);
  expect(rows[0].text).toContain("Olivia Lewis");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm vitest run --project node apps/functions/src/audit/class-history-service.test.ts
```

- [ ] **Step 3: Write minimal implementation**

El servicio: recorta el límite (100–1000), traduce el tipo con `registrationTypeFilter`, pide los eventos, agrupa los ids distintos de alumno y sesión, hace una lectura por lote de cada uno, compone la frase con `composeClassHistorySentence` y decide la IP con `canReadRestrictedIp(actor.role)` (ya existe en `@bpt-jersey/domain/auth/admin-contracts`, usado por `getRegyfitProjectionScope`).

- [ ] **Step 4: Run test to verify it passes**

```bash
corepack pnpm vitest run --project node apps/functions/src/audit/class-history-service.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/audit/class-history-service.ts apps/functions/src/audit/class-history-service.test.ts
git commit -m "feat(functions): class history query with batched name resolution and IP redaction (T048V2-H)"
```

---

### Task 6: Adaptador de Firestore e índice

**Files:**
- Create: `apps/functions/src/audit/class-history-firestore.ts`
- Create: `apps/functions/src/audit/class-history-firestore.test.ts`
- Modify: `firestore.indexes.json`

**Interfaces:**
- Consumes: Task 5 (`ClassHistoryStore`).
- Produces: `createClassHistoryStore(firestore, academyId): ClassHistoryStore`.

- [ ] **Step 1: Write the failing test**

```ts
it("queries auditEvents by action, actor group and time, newest first", async () => {
  const store = createClassHistoryStore(fakeFirestore, "demo-academy");
  await store.queryEvents({
    actions: ["booking.created"],
    groups: ["member"],
    since: "2026-09-01T00:00:00Z",
    limit: 100,
  });
  expect(fakeFirestore.lastQuery).toEqual({
    collection: "academies/demo-academy/auditEvents",
    where: [
      ["action", "in", ["booking.created"]],
      ["actorGroup", "in", ["member"]],
      ["occurredAt", ">=", "2026-09-01T00:00:00Z"],
    ],
    orderBy: ["occurredAt", "desc"],
    limit: 100,
  });
});

it("reads students in one batch and tolerates missing ones", async () => {
  const students = await store.readStudents(["s1", "gone"]);
  expect(students.get("s1")).toBe("Olivia Lewis");
  expect(students.has("gone")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm vitest run --project node apps/functions/src/audit/class-history-firestore.test.ts
```

- [ ] **Step 3: Write minimal implementation**

El adaptador usa `getAll` para alumnos y sesiones. En `firestore.indexes.json`, en el **mismo commit**:

```json
{
  "collectionGroup": "auditEvents",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "action", "order": "ASCENDING" },
    { "fieldPath": "actorGroup", "order": "ASCENDING" },
    { "fieldPath": "occurredAt", "order": "DESCENDING" }
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
corepack pnpm vitest run --project node apps/functions/src/audit/class-history-firestore.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/audit/class-history-firestore.ts apps/functions/src/audit/class-history-firestore.test.ts firestore.indexes.json
git commit -m "feat(functions): Firestore adapter and composite index for the class history (T048V2-H)"
```

---

### Task 7: El PDF

**Files:**
- Create: `apps/functions/src/audit/class-history-pdf.ts`
- Create: `apps/functions/src/audit/class-history-pdf.test.ts`

**Interfaces:**
- Consumes: Task 5 (`ClassHistoryRow`).
- Produces: `buildClassHistoryPdf(input: { rows: readonly ClassHistoryRow[]; filters: ClassHistoryFilterSummary; generatedAt: string }): Promise<Uint8Array>`.

- [ ] **Step 1: Write the failing test**

```ts
it("produces a PDF that carries the rows", async () => {
  const bytes = await buildClassHistoryPdf({ rows, filters, generatedAt: "2026-09-17T09:00:00Z" });
  expect(bytes.subarray(0, 5)).toEqual(new TextEncoder().encode("%PDF-"));
  const document = await PDFDocument.load(bytes);
  expect(document.getPageCount()).toBeGreaterThan(0);
});

it("paginates a thousand rows instead of overflowing one page", async () => {
  const bytes = await buildClassHistoryPdf({ rows: thousandRows, filters, generatedAt });
  expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(10);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm vitest run --project node apps/functions/src/audit/class-history-pdf.test.ts
```

- [ ] **Step 3: Write minimal implementation**

Seguir el patrón de `apps/functions/src/members/member-report-pdf.ts` (fuente estándar, sin recursos externos): título, resumen de filtros, fecha de generación en hora de Jersey y la tabla; salto de página cuando `y` baja del margen.

- [ ] **Step 4: Run test to verify it passes**

```bash
corepack pnpm vitest run --project node apps/functions/src/audit/class-history-pdf.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/audit/class-history-pdf.ts apps/functions/src/audit/class-history-pdf.test.ts
git commit -m "feat(functions): printable class history PDF (T048V2-H)"
```

---

### Task 8: Los callables

**Files:**
- Create: `apps/functions/src/audit/class-history-callables.ts`
- Create: `apps/functions/src/audit/class-history-callables.test.ts`
- Modify: `apps/functions/src/index.ts`, `apps/functions/src/deploy-runtime.ts`

**Interfaces:**
- Consumes: Tasks 3, 5, 6, 7.
- Produces: callables `listClassHistory` y `exportClassHistoryPdf` (`browserAdminCallableOptions`). Salida: `{ rows, total }` y `{ pdfBase64, fileName }`.

- [ ] **Step 1: Write the failing test**

```ts
it("refuses a caller who is not an administrator", async () => {
  await expect(handleListClassHistory(services, coachRequest)).rejects.toMatchObject({
    code: "permission-denied",
  });
});

it("refuses another academy", async () => {
  await expect(
    handleListClassHistory(services, { ...adminRequest, data: { ...data, academyId: "other" } }),
  ).rejects.toMatchObject({ code: "permission-denied" });
});

it("rejects a since value that is not a timestamp", async () => {
  await expect(
    handleListClassHistory(services, { ...adminRequest, data: { ...data, since: "yesterday" } }),
  ).rejects.toMatchObject({ code: "invalid-argument" });
});

it("records the read in the audit ledger", async () => {
  await handleListClassHistory(services, adminRequest);
  expect(services.auditedActions).toEqual(["class.history.read"]);
});

it("returns the PDF as base64 with a dated file name", async () => {
  const result = await handleExportClassHistoryPdf(services, adminRequest);
  expect(result.fileName).toBe("class-history-2026-09-17.pdf");
  expect(result.pdfBase64.length).toBeGreaterThan(100);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm vitest run --project node apps/functions/src/audit/class-history-callables.test.ts
```

- [ ] **Step 3: Write minimal implementation**

`requireAdminActor` + `assertAcademyScope`; validación a mano de `since` (`dateTimePattern`),
`registrationType` (en la lista), `limit` (entero recortado) y `actorId` opcional (patrón de
identificador); `clientIpFromRequest` no se usa aquí (es una lectura); la acción restringida
`class.history.read` se añade en `audit-event.ts` con el vocabulario de resultado de
`member.detail.read` y su propósito en `restrictedReadPurposes` (`class-history-read`). Reexportar
en `index.ts` y añadir al inventario de `deploy-runtime.ts`.

- [ ] **Step 4: Run test to verify it passes**

```bash
corepack pnpm vitest run --project node apps/functions/src/audit
corepack pnpm typecheck && corepack pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/audit apps/functions/src/index.ts apps/functions/src/deploy-runtime.ts packages/domain/src/audit
git commit -m "feat(functions): admin-only class history callables, audited on read (T048V2-H)"
```

> **Prueba negativa (LECCIONES.md §4):** comentar la línea de `requireAdminActor`, ejecutar las
> pruebas del fichero y comprobar que la prueba del coach **falla**; restaurar la línea. Anotar en
> la evidencia de la tarea.

---

### Task 9: El cliente web

**Files:**
- Create: `apps/web/src/lib/class-history-client.ts`
- Create: `apps/web/src/lib/class-history-client.test.ts`

**Interfaces:**
- Consumes: Task 8.
- Produces: `fetchClassHistory(input): Promise<{ rows: ClassHistoryRow[]; total: number }>` y `downloadClassHistoryPdf(input): Promise<{ blob: Blob; fileName: string }>`, ambas con errores ya traducidos a frases seguras.

- [ ] **Step 1: Write the failing test**

```ts
it("parses the rows the callable returns", async () => {
  callable.mockResolvedValue({ data: { rows: [row], total: 1 } });
  await expect(fetchClassHistory(input)).resolves.toEqual({ rows: [row], total: 1 });
});

it("rejects a payload with unexpected fields", async () => {
  callable.mockResolvedValue({ data: { rows: [{ ...row, secret: "x" }], total: 1 } });
  await expect(fetchClassHistory(input)).rejects.toThrow("The log is temporarily unavailable.");
});

it("never leaks the Firebase error text", async () => {
  callable.mockRejectedValue(new Error("FirebaseError: permission-denied projects/xyz"));
  await expect(fetchClassHistory(input)).rejects.toThrow("The log is temporarily unavailable.");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm vitest run --project web apps/web/src/lib/class-history-client.test.ts
```

- [ ] **Step 3: Write minimal implementation**

Seguir el estilo de `apps/web/src/lib/staff-client.ts`: lista de campos esperados y comprobación exacta; cualquier desviación se convierte en la misma frase segura.

- [ ] **Step 4: Run test to verify it passes**

```bash
corepack pnpm vitest run --project web apps/web/src/lib/class-history-client.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/class-history-client.ts apps/web/src/lib/class-history-client.test.ts
git commit -m "feat(web): class history client with safe error strings (T048V2-H)"
```

---

### Task 10: La pantalla

**Files:**
- Modify: `apps/web/src/app/admin/classes-services/history/page.tsx`
- Create: `apps/web/src/app/admin/classes-services/history/history.css`
- Create: `apps/web/src/app/admin/classes-services/history/page.test.tsx`

**Interfaces:**
- Consumes: Tasks 2 y 9; `useAdminOrStaffSession` de `../../admin-gate`; `listStaffProfiles` vía `apps/web/src/lib/staff-client.ts`.
- Produces: la ruta `/admin/classes-services/history`.

- [ ] **Step 1: Write the failing test**

```tsx
it("does not query anything until LIST is pressed", () => {
  render(<HistoryPage />);
  expect(fetchClassHistory).not.toHaveBeenCalled();
});

it("lists the records and shows the count", async () => {
  render(<HistoryPage />);
  fireEvent.click(screen.getByRole("button", { name: "LIST" }));
  expect(await screen.findByText("RECORDS (2)")).toBeInTheDocument();
  expect(screen.getByRole("table")).toHaveAccessibleName(/class registrations log/i);
  expect(screen.getAllByRole("row")).toHaveLength(3);
});

it("sends the chosen filters", async () => {
  render(<HistoryPage />);
  fireEvent.change(screen.getByLabelText("Since"), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByLabelText("Registration type"), {
    target: { value: "coach-bookings" },
  });
  fireEvent.click(screen.getByRole("button", { name: "LIST" }));
  await waitFor(() =>
    expect(fetchClassHistory).toHaveBeenCalledWith(
      expect.objectContaining({ since: "2026-09-01T00:00:00Z", registrationType: "coach-bookings" }),
    ),
  );
});

it("shows an honest message when the log fails", async () => {
  fetchClassHistory.mockRejectedValue(new Error("The log is temporarily unavailable."));
  render(<HistoryPage />);
  fireEvent.click(screen.getByRole("button", { name: "LIST" }));
  expect(await screen.findByText("The log is temporarily unavailable.")).toBeInTheDocument();
});

it("shows the empty state with no rows", async () => {
  fetchClassHistory.mockResolvedValue({ rows: [], total: 0 });
  render(<HistoryPage />);
  fireEvent.click(screen.getByRole("button", { name: "LIST" }));
  expect(await screen.findByText("No records for these filters.")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm vitest run --project web apps/web/src/app/admin/classes-services/history/page.test.tsx
```

- [ ] **Step 3: Write minimal implementation**

Estructura: eyebrow `BPT JERSEY / ADMIN`, título `CLASS REGISTRATIONS LOG`, panel de filtros
(`<form>` con `Since` fecha + hora, `Logged by`, `Registration type`, `No. of records`, botón
`LIST`), y la tarjeta `RECORDS (N)` con el botón `PDF` y la tabla (`<caption>` accesible,
`scope="col"`, `aria-live="polite"` en el recuento). CSS en `history.css`, importado por la
página, reutilizando `.cs-table` de `classes-services.css` cuando encaje:

- radio 0, borde 1 px `#8A8880`, cabecera eyebrow (0.72rem, 700, mayúsculas, `letter-spacing: 0.15em`, `#2F2483`);
- `font-variant-numeric: tabular-nums` en `DATE/TIME` e `IP`; `overflow-wrap: anywhere` en `TASK`;
- por debajo de `50rem`, cada fila es un bloque con etiquetas y sin scroll horizontal;
- esqueletos en `#E8E7E3` con la altura real mientras carga, **sin spinner**;
- error en banda con tinte `#FFF0F2` y `border-left: 0.35rem solid #8D1C2F`;
- `@media (prefers-reduced-motion: reduce) { transition: none }`.

La columna `IP` se omite entera si la primera fila trae `actorIp: null` para todas (un coach nunca
debería llegar aquí, pero la pantalla no presume).

- [ ] **Step 4: Run test to verify it passes**

```bash
corepack pnpm vitest run --project web apps/web/src/app/admin/classes-services/history
corepack pnpm lint && corepack pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/classes-services/history
git commit -m "feat(admin): class registrations log screen (T048V2-H)"
```

---

### Task 11: Barrido de retención de la IP

**Files:**
- Create: `apps/functions/src/audit/class-ip-retention-sweep.ts`
- Create: `apps/functions/src/audit/class-ip-retention-sweep.test.ts`
- Modify: `apps/functions/src/index.ts`, `apps/functions/src/deploy-runtime.ts`
- Modify: `docs/operations/t011-retention-residency-erasure-policy.md`, `docs/adr/ADR-008-t011-retention-residency-erasure-policy.md`

**Interfaces:**
- Consumes: Task 1.
- Produces: `sweepClassIpRetention(store, now): Promise<{ cleared: number }>` y la función programada diaria que la ejecuta.

- [ ] **Step 1: Write the failing test**

```ts
it("clears the IP of events older than twelve months and keeps the event", async () => {
  const result = await sweepClassIpRetention(store, "2026-09-17T03:00:00Z");
  expect(result.cleared).toBe(1);
  expect(store.documents[0]).toMatchObject({ action: "booking.created", actorIp: null });
});

it("leaves recent events untouched", async () => {
  store.documents = [recentEvent];
  expect((await sweepClassIpRetention(store, "2026-09-17T03:00:00Z")).cleared).toBe(0);
  expect(store.documents[0].actorIp).toBe("82.112.144.10");
});

it("works in batches so a long history does not break it", async () => {
  store.documents = Array.from({ length: 900 }, () => oldEvent());
  expect((await sweepClassIpRetention(store, now)).cleared).toBe(900);
  expect(store.commits.every((batch) => batch.length <= 400)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm vitest run --project node apps/functions/src/audit/class-ip-retention-sweep.test.ts
```

- [ ] **Step 3: Write minimal implementation**

Consulta por `occurredAt < now - 12 meses` con `actorIp != null`, en lotes de 400 escrituras, poniendo `actorIp: null`. `onSchedule("every day 03:00")`. En la política de retención se añade la fila: *IP de eventos de clases — 12 meses — barrido diario `sweepClassIpRetention` — prueba en `class-ip-retention-sweep.test.ts`*, y una línea equivalente en ADR-008.

- [ ] **Step 4: Run test to verify it passes**

```bash
corepack pnpm vitest run --project node apps/functions/src/audit/class-ip-retention-sweep.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/audit apps/functions/src/index.ts apps/functions/src/deploy-runtime.ts docs/operations docs/adr
git commit -m "feat(functions): daily sweep that clears class-event IPs after twelve months (T048V2-H)"
```

---

### Task 12: Reglas de seguridad

**Files:**
- Modify: `qa/rules/audit-events.rules.test.ts` (o el fichero de reglas donde vivan las pruebas de `auditEvents`)

**Interfaces:**
- Consumes: nada del código nuevo; comprueba `firestore.rules`.

- [ ] **Step 1: Write the failing test**

```ts
it("denies every client read of the class history, admin included", async () => {
  await assertFails(getDoc(doc(adminDb, "academies/demo-academy/auditEvents/e1")));
  await assertFails(getDoc(doc(memberDb, "academies/demo-academy/auditEvents/e1")));
});

it("denies a client write of a class event", async () => {
  await assertFails(setDoc(doc(adminDb, "academies/demo-academy/auditEvents/e2"), classEvent));
});
```

- [ ] **Step 2: Run test to verify it fails or passes for the right reason**

```bash
corepack pnpm test:rules
```

Si ya pasa, es que la regla existente ya cubre el caso: se deja la prueba como red de seguridad y se anota que no hizo falta cambiar `firestore.rules`.

- [ ] **Step 3: Write minimal implementation**

Solo si falla: ajustar `firestore.rules` alrededor de la línea 207 para que `auditEvents` siga sin lectura de cliente.

- [ ] **Step 4: Run test to verify it passes**

```bash
corepack pnpm test:rules
```

- [ ] **Step 5: Commit**

```bash
git add qa/rules firestore.rules
git commit -m "test(rules): the class history is unreachable from any client (T048V2-H)"
```

---

### Task 13: Playwright

**Files:**
- Create: `qa/tests/admin-classes-services-history.spec.ts`
- Modify: `qa/scripts/` si hace falta un sembrado de eventos falsos para el emulador

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Write the failing test**

```ts
test("@classes-services lists the log and exports it", async ({ page }) => {
  await page.goto("/admin/classes-services/history");
  await expect(page.getByRole("button", { name: "LIST" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.getByLabel("Since").fill("2026-09-01");
  await page.getByRole("button", { name: "LIST" }).click();
  await expect(page.getByText(/RECORDS \(\d+\)/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF" }).click();
  expect((await download).suggestedFilename()).toMatch(/^class-history-\d{4}-\d{2}-\d{2}\.pdf$/);
  await page.screenshot({ path: "qa/screenshots/cs-history-desktop.png", fullPage: true });
});

test("@classes-services stacks the rows on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/classes-services/history");
  await page.getByRole("button", { name: "LIST" }).click();
  await expect(page.getByText(/RECORDS \(\d+\)/)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  await page.screenshot({ path: "qa/screenshots/cs-history-mobile.png", fullPage: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm --dir qa exec playwright install chromium   # solo la primera vez
NEXT_PUBLIC_FIREBASE_ENV=local USE_FIREBASE_EMULATORS=true ADMIN_E2E=true corepack pnpm --filter @bpt-jersey/web build
corepack pnpm test:e2e:smoke -- --grep @classes-services
```

- [ ] **Step 3: Write minimal implementation**

Sembrar eventos de clase en el emulador (script de fixtures) y ajustar lo que la prueba destape.

- [ ] **Step 4: Run test to verify it passes**

Mismo comando; además, mirar las dos capturas y compararlas con
`/root/regyfit-capture/raw/09-history/screenshot.png`: mismas columnas, mismo orden, mismo sentido
de lectura, estilo BPT.

- [ ] **Step 5: Commit**

```bash
git add qa/tests qa/screenshots qa/scripts
git commit -m "test(e2e): class registrations log, desktop and phone (T048V2-H)"
```

---

### Task 14: Puerta de calidad y despliegue

**Files:**
- Modify: `tasksv2.md` (fila T048V2-H con la evidencia real)

- [ ] **Step 1: Run the full gate**

```bash
corepack pnpm verify:mvp
```

Esperado: todo verde. Cualquier fallo se arregla antes de seguir.

- [ ] **Step 2: Build functions from the compiled domain**

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm --filter @bpt-jersey/functions build
```

- [ ] **Step 3: Ask the operator before deploying**

Presentar en chat: los callables nuevos (`listClassHistory`, `exportClassHistoryPdf`), la función programada (`sweepClassIpRetention`), los callables modificados de `schedule` y el índice nuevo. **No se despliega sin su "sí".**

- [ ] **Step 4: Deploy web and functions together, then verify**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://us-central1-bptjersey-f5a25.cloudfunctions.net/listClassHistory
```

Esperado: `401` (desplegada). `404` significa que no se desplegó.

- [ ] **Step 5: Commit the ledger row**

```bash
git add tasksv2.md
git commit -m "docs(tasks): T048V2-H shipped — class registrations log with evidence"
```

---

### Task 15: Histórico de Regyfit

**Files:**
- Create: `qa/scripts/regyfit-history-import.mjs`
- Create: `qa/scripts/regyfit-history-import.test.mjs` (o `qa/unit/regyfit-history-import.test.ts`)

**Interfaces:**
- Consumes: Task 1 (contrato del evento).
- Produces: el script de importación, idempotente y con `--dry-run` por defecto.

- [ ] **Step 1: Recapture (needs the operator)**

Pedir a Luis que abra el túnel y entre en Regyfit por noVNC (memoria `regyfit-capture-visible-chrome-tunnel`), y barrer el histórico en ventanas semanales desde el 16 de enero de 2026 a `/root/regyfit-capture/data/history-log.full.json`. Nunca pulsar guardar ni borrar.

- [ ] **Step 2: Write the failing test for the sentence parser**

```js
it("reads a member booking row", () => {
  expect(parseRegyfitRow({
    dateTime: "16-09-2026 00:21",
    user: "Olivia L.",
    ip: "82.112.144.10",
    task: "O atleta Olivia Lewis Inscreveu-se na aula do dia 16 Sep 2026 pelas 17:30",
  })).toMatchObject({
    action: "booking.created",
    actorGroup: "member",
    studentName: "Olivia Lewis",
    sessionStartAt: "2026-09-16T16:30:00Z",
  });
});

it("reads a staff booking row", () => {
  expect(parseRegyfitRow({ ...row, task: "O atleta Andy Smith foi inscrito pelo ADMIN na aula do dia 10 Sep 2026 pelas 18:30" }))
    .toMatchObject({ action: "booking.created", actorGroup: "staff", studentName: "Andy Smith" });
});

it("reads an attendance row", () => {
  expect(parseRegyfitRow({ ...row, task: "Foram marcadas presenças e faltas da aula: 1401 | 15-09-2026 | 12:00" }))
    .toMatchObject({ action: "attendance.checked_in" });
});

it("returns null for an unknown sentence instead of guessing", () => {
  expect(parseRegyfitRow({ ...row, task: "Algo que nunca vimos" })).toBe(null);
});
```

- [ ] **Step 3: Run the tests to verify they fail, then implement**

```bash
corepack pnpm vitest run --project node qa/unit/regyfit-history-import.test.ts
```

El script: lee solo de `/root/regyfit-capture/data/`, traduce con una expresión regular por patrón,
cruza personas por número de socio y, si falta, por nombre normalizado, deja lo no casado en
`unmatched.json`, escribe con id derivado del hash del contenido (idempotente), `source: "regyfit"`
y `actorRole: "regyfit"` cuando el autor no existe en BPT.

- [ ] **Step 4: Dry run on the emulator, then ask before production**

```bash
node qa/scripts/regyfit-history-import.mjs --dry-run            # cuenta y muestra 10 ejemplos
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node qa/scripts/regyfit-history-import.mjs --apply
```

Comprobar en `/admin/classes-services/history` que las filas importadas se leen igual que en
Regyfit (comparar diez filas al azar con la captura). **Producción solo con el "sí" del operador**,
y repitiendo el script después para confirmar que no duplica nada.

- [ ] **Step 5: Commit**

```bash
git add qa/scripts qa/unit
git commit -m "feat(qa): idempotent Regyfit history importer with unmatched report (T048V2-H)"
```

---

## Autorrevisión del plan

- **Cobertura de la spec:** §5 modelo → Tarea 1; §7 consulta y frases → Tareas 2, 5, 6; §6 escritura y fallo cerrado → Tarea 4; G4 IP → Tarea 3 (con verificación real); §8 pantalla → Tarea 10; §9 PDF → Tareas 7 y 8; §10 importación → Tarea 15; §11 seguridad → Tareas 8, 11 y 12; §12 pruebas → Tareas 12, 13; §13 despliegue → Tarea 14. Sin huecos.
- **Sin marcadores de posición:** cada tarea trae su prueba y su implementación concretas.
- **Consistencia de nombres:** `classActorGroup`, `isAuditIpAddress`, `clientIpFromRequest`,
  `registrationTypeFilter`, `composeClassHistorySentence`, `ClassHistoryStore`,
  `listClassHistory`, `exportClassHistoryPdf`, `sweepClassIpRetention`, `fetchClassHistory`,
  `downloadClassHistoryPdf` se usan con el mismo nombre en todas las tareas donde aparecen.
