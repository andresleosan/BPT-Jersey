# Admin para coaches (Overview, Attendance, Enrolment, Medical, menú) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En `/admin`: quitar la barra negra de atajos y la métrica "Members" del Overview y añadir los tres próximos cumpleaños con aviso del día; convertir Attendance en una lista por clase con etiquetas Ready/Booked/Late y botón "Clock in"; explicar y verificar los botones de Enrolment requests; dar a Medical conditions su ruta y un botón "Show all references"; ocultar Memberships y Waivers del menú; y abrir a `coach`/`headCoach` Overview, Attendance, Enrolment (lista + devolver) y Medical.

**Architecture:** Reglas puras nuevas en `packages/domain` (`deriveRosterTag`, ventana de cumpleaños 366, umbral de puntualidad 0, `HealthReferenceRow`). Backend: roles ampliados en tres callables existentes y un callable nuevo `listHealthReferences` con su método de store. Web: `admin-routes.ts` es la única fuente de rutas de staff (la usan shell y gate); Overview, Attendance y Medical se renderizan a partir de los callables existentes más los dos ampliados; Playwright de UI usa la sesión sintética (`?adminTestRole=`) con callables interceptados por `page.route`.

**Tech Stack:** Next 16 (`output: "export"`, `"use client"`), React 19, TypeScript strict, vitest 4 (`web` = jsdom, `node`), @testing-library/react + user-event, Firebase client SDK 12 (`httpsCallable`), Firebase Functions v2 `onCall`, Playwright 1.61 (`qa/`), CSS plano (sin Tailwind).

**Spec:** `docs/superpowers/specs/2026-09-12-admin-coach-operations-design.md`

## Global Constraints

Del proyecto (`CLAUDE.md`, `LECCIONES.md`, `DESIGN.md`):

- Comandos siempre `corepack pnpm …` desde `/root/BPT-Jersey`. Node `>=22.13 <25` (aquí: 24.16). Nunca instalar pnpm ni firebase-tools globales.
- `packages/domain` nunca importa Firebase. Capas por feature: contracts → service → firestore → callables → `index.ts` → `apps/web/src/lib/<feature>-client.ts` → ruta.
- Un test de existencia no es un test de funcionamiento: se asserta el valor. Para cada guarda nueva (`deriveRosterTag`, `isStaffRouteAllowed`, roles de callables) el plan incluye el paso "desactiva la regla y confirma que el test muere".
- Ningún despliegue, ninguna migración, ningún gasto de API. La rama termina con `corepack pnpm verify:mvp` verde y evidencia en `tasksv2.md`.
- Commits: `feat(admin): …`, `feat(domain): …`, `feat(functions): …`, `test(...)`, `docs(...)`. Cada commit termina con las dos líneas de atribución de esta sesión (ver "Convención de commit" abajo).
- Copy en inglés británico, voz de academia, sin exclamaciones, sin "Oops", sin em-dash (`—`) en texto visible. Sentence case en encabezados.
- Diseño (DESIGN.md): radio `0`, sin emojis, sin spinners (texto de estado o esqueleto), sin gradientes, sin sombras con blur, sin pills solas para estado (texto + regla izquierda de `0.35rem`), colores solo por tokens (`--bpt-purple #2F2483`, `--gi-white`, `--mat-ink #1A1A18`, `--muted #65635D`, `--line #8A8880`, canvas `#F2F1ED`, purple wash `#F0EFFF` / borde `#D9D6FF`, lime `#D9F36A`, verde `#176B49` sobre `#E7F6EE`, rojo `#8D1C2F` sobre `#FFF0F2`, gris `#65635D` sobre `#E8E7E3`). Display `Barlow Condensed` vía `var(--font-display)`, cuerpo `Source Sans 3`. Botones `min-height 3.15rem`, focus ring `3px solid var(--bpt-purple)` offset `4px`. Grids con `minmax(0, …)`, colapso a una columna en `≤ 50rem` (el admin ya usa `@media (max-width: 700px)`; se reutiliza). `prefers-reduced-motion` ya está cubierto globalmente.
- Skills (impeccable / taste / redesign / security-best-practices / frontend-security-coder), reglas aplicables aquí: contraste texto ≥ 4.5:1; targets táctiles ≥ 44 px; cada control con estados default/hover/focus/disabled/loading/error/empty; botones deshabilitados mientras hay una llamada en curso; limpiar timers y listeners al desmontar; abortar/ignorar respuestas tras desmontar (`active` flag); nunca `dangerouslySetInnerHTML`, nunca `innerHTML`, todo texto por JSX; nunca `window.alert`; `localStorage` solo para la sede elegida (no es dato sensible); la autorización se repite en el servidor (ocultar un botón nunca es un control); mensajes de error nombran el problema y la recuperación; sin estilos inline nuevos (clases en `admin.css` / `attendance.css`); `font-variant-numeric: tabular-nums` en contadores; sin enlaces muertos.
- Zona horaria de todo lo visible: `Europe/Jersey`. Los ISO del backend son UTC.
- Comandos de test: dominio → `corepack pnpm vitest run --project node <file>`; functions → igual (`node`); web → `corepack pnpm vitest run --project web <file>`; lint → `corepack pnpm eslint <files> --max-warnings 0`; formato → `corepack pnpm prettier --write <files>`.

**Convención de commit** (añadir al final de cada mensaje):

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Qg3MvSGE4FQU2zbpZ72xJM
```

**Entorno de esta máquina (comprobado el 2026-09-12):** no hay JDK (`java` no existe; `openjdk-21-jre-headless` está disponible en apt). Sin JDK no arrancan los emuladores (`test:rules`, `verify:mvp`, spec T121). Playwright no tiene navegadores instalados aún (`.playwright-browsers/` vacío). La Task 0 lo resuelve.

---

### Task 0: Entorno y rama

**Files:** ninguno del repo.

- [ ] **Step 1: Confirmar la rama**

```bash
cd /root/BPT-Jersey && git branch --show-current
```

Expected: `feature/admin-coach-operations`. Si no, `git checkout feature/admin-coach-operations`.

- [ ] **Step 2: Instalar Chromium de Playwright en la caché del repo**

```bash
cd /root/BPT-Jersey && corepack pnpm --dir qa exec playwright install chromium
```

Expected: descarga en `.playwright-browsers/` (ignorado por git). Verifica: `ls .playwright-browsers | head -2` muestra `chromium-…`.

- [ ] **Step 3: ⚠️ Instalar JDK 21 (cambia el sistema; pedir OK al operador si no está ya autorizado)**

📍 esta máquina, usuario root:

```bash
apt-get update && apt-get install -y openjdk-21-jre-headless && java -version
```

Expected: `openjdk version "21.0.…"`. Sin esto, las Tasks 20 y 21 no pueden ejecutarse aquí; el resto del plan no lo necesita.

- [ ] **Step 4: Instalar dependencias y comprobar el punto de partida**

```bash
cd /root/BPT-Jersey && corepack pnpm install --frozen-lockfile && corepack pnpm typecheck
```

Expected: `typecheck` termina sin errores en todos los workspaces.

---

### Task 1: Ventana de cumpleaños a 366 días (dominio)

**Files:**
- Modify: `packages/domain/src/birthdays/upcoming-birthday-contracts.ts:16`
- Test: `packages/domain/src/birthdays/upcoming-birthday-contracts.test.ts`
- Test: `apps/functions/src/birthdays/upcoming-birthday-callables.test.ts:64`

**Interfaces:**
- Produces: `upcomingBirthdayMaxWindowDays === 366`. `parseUpcomingBirthdayQuery({ windowDays: 366 })` es válido; `367` no. `deriveUpcomingBirthdays` acepta `windowDays` hasta 366.

- [ ] **Step 1: Test que falla** — añadir dentro de `describe("deriveUpcomingBirthdays", …)` (junto al caso "counts a member once even when the window spans a whole year"):

```ts
  it("finds a birthday almost a year away, so the office always has three to greet", () => {
    expect(upcomingBirthdayMaxWindowDays).toBe(366);
    const result = deriveUpcomingBirthdays({
      today: "2026-06-15",
      windowDays: upcomingBirthdayMaxWindowDays,
      candidates: [candidate({ studentId: "s-far", dateOfBirth: "1990-06-10" })],
    });
    expect(result.map((entry) => [entry.studentId, entry.daysAway])).toEqual([["s-far", 360]]);
  });
```

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project node packages/domain/src/birthdays/upcoming-birthday-contracts.test.ts -t "almost a year away"
```

Expected: FAIL (`expected 31 to be 366`).

- [ ] **Step 3: Cambiar la constante** en `upcoming-birthday-contracts.ts`:

```ts
export const upcomingBirthdayMaxWindowDays = 366;
```

Y ajustar el comentario del bucle en `deriveUpcomingBirthdays` (justo encima del `for`):

```ts
  // ponytail: O(ventana x candidatos) = 366 x 2000 como techo; precalcular el proximo cumpleanos
  // por candidato si alguna vez pesa.
```

- [ ] **Step 4: Ejecutar todo el archivo y el test del callable**

```bash
corepack pnpm vitest run --project node packages/domain/src/birthdays/upcoming-birthday-contracts.test.ts apps/functions/src/birthdays/upcoming-birthday-callables.test.ts
```

Expected: PASS. El caso `["a window out of range", { windowDays: 400 }]` del callable sigue siendo inválido (400 > 366).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/birthdays && git commit -m "feat(domain): birthday window up to 366 days so the office always has three to greet"
```

---

### Task 2: Umbral de puntualidad a 0 minutos (dominio + tests de servicio)

**Files:**
- Modify: `packages/domain/src/schedule/schedule-contracts.ts:1201-1219` (`determinePunctuality`)
- Test: `packages/domain/src/schedule/schedule-contracts.test.ts:614-632`
- Test: `apps/functions/src/schedule/schedule-service.test.ts:490-515` (check-ins a 18:05 y 18:10 con inicio 18:00)

**Interfaces:**
- Produces: `determinePunctuality(startAt, checkInAt?, lateThresholdMinutes = 0)`: check-in `<= startAt` → `"attended"`; `> startAt` → `"late"`.

- [ ] **Step 1: Reemplazar los tres tests del bloque `describe("determinePunctuality")`** por:

```ts
  describe("determinePunctuality", () => {
    const sessionStart = "2026-09-01T18:00:00Z";

    it("returns 'attended' when checking in before session start", () => {
      expect(determinePunctuality(sessionStart, "2026-09-01T17:50:00Z")).toBe("attended");
    });

    it("returns 'attended' exactly at session start", () => {
      expect(determinePunctuality(sessionStart, "2026-09-01T18:00:00Z")).toBe("attended");
    });

    it("returns 'late' one second after session start: the class has begun", () => {
      expect(determinePunctuality(sessionStart, "2026-09-01T18:00:01Z")).toBe("late");
    });

    it("keeps an explicit threshold for callers that pass one", () => {
      expect(determinePunctuality(sessionStart, "2026-09-01T18:10:00Z", 15)).toBe("attended");
    });
  });
```

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project node packages/domain/src/schedule/schedule-contracts.test.ts -t "determinePunctuality"
```

Expected: FAIL en "one second after session start" (`expected 'attended' to be 'late'`).

- [ ] **Step 3: Cambiar el valor por defecto y el comentario** en `schedule-contracts.ts`:

```ts
/**
 * Determines punctuality state based on check-in timestamp relative to session start.
 * A check-in at or before `startAt` is 'attended'; anything after it is 'late'. The office asked
 * (2026-09-12) for the class start to be the line, so the default threshold is 0 minutes.
 */
export function determinePunctuality(
  sessionStartAtIso: string,
  checkInAtIso?: string,
  lateThresholdMinutes = 0,
): AttendanceState {
```

- [ ] **Step 4: Ajustar los dos check-ins del test de servicio** (`schedule-service.test.ts`, bloque "Student 3" y "Student 4"): cambiar los comentarios y expectativas a `late`:

```ts
      // Student 3: Name Search check-in by front desk (18:05 -> five minutes late)
      …
      expect(checkIn3.state).toBe("late");
      …
      // Student 4: Manual check-in by coach (18:10 -> late, with notes)
      …
      expect(checkIn4.state).toBe("late");
```

- [ ] **Step 5: Ejecutar dominio y toda la carpeta de schedule de functions**

```bash
corepack pnpm vitest run --project node packages/domain/src/schedule apps/functions/src/schedule
```

Expected: PASS. Si otro test asume el umbral de 15 min (busca `expect(...state).toBe("attended")` con `occurredAt` posterior a `startAt`), cámbialo a `late` y anota el archivo en el commit.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/schedule apps/functions/src/schedule && git commit -m "feat(domain): a check-in after the class starts is late (threshold 0)"
```

---

### Task 3: `deriveRosterTag` (dominio)

**Files:**
- Modify: `packages/domain/src/schedule/pre-class-contracts.ts` (añadir al final)
- Test: `packages/domain/src/schedule/pre-class-contracts.test.ts` (añadir `describe`)

**Interfaces:**
- Produces:
  ```ts
  export const rosterTags = Object.freeze(["ready", "booked", "late", "no_show", "absent"] as const);
  export type RosterTag = (typeof rosterTags)[number];
  export function deriveRosterTag(status: SessionOperationalStatus | null, startAtIso: string, nowMs: number): RosterTag;
  ```

- [ ] **Step 1: Test que falla** — añadir al final del archivo de test (importar `deriveRosterTag` en el `import` existente de `./pre-class-contracts`):

```ts
describe("deriveRosterTag", () => {
  const startAt = "2026-09-08T18:00:00.000Z";
  const before = Date.parse("2026-09-08T17:59:59.000Z");
  const atStart = Date.parse(startAt);

  it("is ready for anybody with a recorded check-in, whatever the method", () => {
    for (const status of ["attended", "late", "checked_out"] as const) {
      expect(deriveRosterTag(status, startAt, before)).toBe("ready");
      expect(deriveRosterTag(status, startAt, atStart)).toBe("ready");
    }
  });

  it("is booked before the class starts and late from the start on", () => {
    expect(deriveRosterTag("booked_not_arrived", startAt, before)).toBe("booked");
    expect(deriveRosterTag(null, startAt, before)).toBe("booked");
    expect(deriveRosterTag("booked_not_arrived", startAt, atStart)).toBe("late");
    expect(deriveRosterTag(null, startAt, atStart + 60_000)).toBe("late");
  });

  it("keeps a persisted no-show or absence as what it is", () => {
    expect(deriveRosterTag("no_show", startAt, before)).toBe("no_show");
    expect(deriveRosterTag("absent", startAt, atStart)).toBe("absent");
  });

  it("never marks somebody late against an unparseable start", () => {
    expect(deriveRosterTag(null, "not-a-date", atStart)).toBe("booked");
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project node packages/domain/src/schedule/pre-class-contracts.test.ts -t "deriveRosterTag"
```

Expected: FAIL (`deriveRosterTag is not a function` / no exportado).

- [ ] **Step 3: Implementar** al final de `pre-class-contracts.ts`:

```ts
/**
 * The tag a coach sees beside a booked member on the attendance list. Green "ready" for any
 * recorded check-in, whatever the method; grey "booked" until the class starts; red "late" from
 * the start on. The persisted state still belongs to the server: this only colours the list.
 */
export const rosterTags = Object.freeze(["ready", "booked", "late", "no_show", "absent"] as const);
export type RosterTag = (typeof rosterTags)[number];

export function deriveRosterTag(
  status: SessionOperationalStatus | null,
  startAtIso: string,
  nowMs: number,
): RosterTag {
  switch (status) {
    case "attended":
    case "late":
    case "checked_out":
      return "ready";
    case "no_show":
      return "no_show";
    case "absent":
      return "absent";
    default: {
      const startMs = Date.parse(startAtIso);
      return Number.isNaN(startMs) || nowMs < startMs ? "booked" : "late";
    }
  }
}
```

- [ ] **Step 4: Ejecutar; luego prueba de guarda**

```bash
corepack pnpm vitest run --project node packages/domain/src/schedule/pre-class-contracts.test.ts
```

Expected: PASS. Ahora cambia temporalmente `nowMs < startMs` por `nowMs <= startMs`, vuelve a ejecutar: debe FALLAR en "late from the start on". Revierte el cambio.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/schedule/pre-class-contracts.ts packages/domain/src/schedule/pre-class-contracts.test.ts && git commit -m "feat(domain): roster tag for the attendance list (ready, booked, late)"
```

---

### Task 4: `HealthReferenceRow` (dominio)

**Files:**
- Modify: `packages/domain/src/health/health-contracts.ts` (añadir al final)
- Test: `packages/domain/src/health/health-contracts.test.ts` (añadir `describe`)

**Interfaces:**
- Produces:
  ```ts
  export const healthReferenceLabelMaxLength = 25;
  export type HealthReferenceRow = Readonly<{ studentId: string; displayName: string; staffReferenceLabel: string }>;
  export function isHealthReferenceRow(value: unknown): value is HealthReferenceRow;
  ```

- [ ] **Step 1: Test que falla** — añadir al final de `health-contracts.test.ts` (importar `isHealthReferenceRow`, `healthReferenceLabelMaxLength`):

```ts
describe("isHealthReferenceRow", () => {
  const row = { studentId: "student-1", displayName: "Ana Coelho", staffReferenceLabel: "ASTHMA-INHALER" };

  it("accepts exactly the three public fields", () => {
    expect(healthReferenceLabelMaxLength).toBe(25);
    expect(isHealthReferenceRow(row)).toBe(true);
  });

  it("refuses anything that could leak more than the label", () => {
    expect(isHealthReferenceRow({ ...row, conditionSummary: "x" })).toBe(false);
    expect(isHealthReferenceRow({ ...row, staffReferenceLabel: null })).toBe(false);
    expect(isHealthReferenceRow({ ...row, staffReferenceLabel: "a".repeat(26) })).toBe(false);
    expect(isHealthReferenceRow({ ...row, studentId: "../x" })).toBe(false);
    expect(isHealthReferenceRow({ ...row, displayName: "" })).toBe(false);
    expect(isHealthReferenceRow(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project node packages/domain/src/health/health-contracts.test.ts -t "isHealthReferenceRow"
```

Expected: FAIL (no exportado).

- [ ] **Step 3: Implementar** al final de `health-contracts.ts` (reutiliza `isPlainRecord`, `exactFields` y `safeIdPattern` ya definidos en el archivo):

```ts
/**
 * One line of "Show all references": who, and the 25-character label a coach reads on the mat.
 * Nothing else travels - not the condition summary, not the support codes.
 */
export const healthReferenceLabelMaxLength = 25;
export type HealthReferenceRow = Readonly<{
  studentId: string;
  displayName: string;
  staffReferenceLabel: string;
}>;
const healthReferenceFields = ["studentId", "displayName", "staffReferenceLabel"] as const;

export function isHealthReferenceRow(value: unknown): value is HealthReferenceRow {
  if (!isPlainRecord(value) || !exactFields(value, healthReferenceFields)) return false;
  const { studentId, displayName, staffReferenceLabel } = value;
  return (
    typeof studentId === "string" &&
    safeIdPattern.test(studentId) &&
    typeof displayName === "string" &&
    displayName.trim().length > 0 &&
    displayName.length <= 160 &&
    typeof staffReferenceLabel === "string" &&
    staffReferenceLabel.trim().length > 0 &&
    staffReferenceLabel.length <= healthReferenceLabelMaxLength
  );
}
```

Si `exactFields` tiene otra firma en el archivo (compruébalo en la línea donde se define, cerca de `storedHealthFields`), adapta la llamada; no dupliques el helper.

- [ ] **Step 4: Ejecutar**

```bash
corepack pnpm vitest run --project node packages/domain/src/health/health-contracts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/health && git commit -m "feat(domain): health reference row for the show-all-references list"
```

---

### Task 5: Reporte operativo abierto a staff (functions)

**Files:**
- Modify: `apps/functions/src/reports/operational-report-callables.ts:13-22`
- Test: `apps/functions/src/reports/operational-report-callables.test.ts:35-70`

**Interfaces:**
- Produces: `getOperationalReport` acepta `owner | administrator | headCoach | coach`; mensaje de rechazo "Staff access required to view operational reports".

- [ ] **Step 1: Ajustar tests**: en "allows owner and administrator roles…" añade tras las dos expectativas:

```ts
    await expect(handler(request(query, "headCoach"))).resolves.toEqual({ report });
    await expect(handler(request(query, "coach"))).resolves.toEqual({ report });
```

Y en "rejects non-financial roles…" sustituye el bloque de `coach` por:

```ts
    await expect(handler(request(query, "guardian"))).rejects.toThrow(/Staff access required/);
    await expect(handler(request(query, "adultStudent"))).rejects.toThrow(/Staff access required/);
```

(elimina la expectativa anterior de `coach` y la de `guardian` con el mensaje viejo). Renombra el test a `"rejects client roles, unauthenticated calls and invalid ranges"`.

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project node apps/functions/src/reports/operational-report-callables.test.ts
```

Expected: FAIL (coach rechazado).

- [ ] **Step 3: Implementar**

```ts
// The office and the mat read the same counts: the coach's Overview is the administrator's
// Overview (operator decision 2026-09-12, ADR-010). Counts only, never amounts.
const reportRoles = Object.freeze(["owner", "administrator", "headCoach", "coach"] as const);
…
      throw new HttpsError("permission-denied", "Staff access required to view operational reports");
```

- [ ] **Step 4: Ejecutar** el mismo archivo. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/reports && git commit -m "feat(functions): operational report readable by head coaches and coaches (ADR-010)"
```

---

### Task 6: Cola de inscripción: staff lista y devuelve (functions)

**Files:**
- Modify: `apps/functions/src/members/enrolment-request-callables.ts:91`
- Test: `apps/functions/src/members/enrolment-request-callables.test.ts` (bloque de `listEnrolmentRequestsHandler` ~línea 175, y el de `approveEnrolmentRequestHandler` ~línea 353)

**Interfaces:**
- Produces: `listEnrolmentRequests` y `returnEnrolmentRequest` aceptan `owner | administrator | headCoach | coach`. `getEnrolmentRequestDetail` y `approveEnrolmentRequest` **no cambian** (siguen exigiendo `requireCanonicalMemberDirectoryActor`).

- [ ] **Step 1: Tests**: junto al test que comprueba que `listEnrolmentRequestsHandler(request(null, "guardian"))` es rechazado, añade:

```ts
  it("lets the mat read the queue and send a request back, but not open or approve it", async () => {
    for (const role of ["headCoach", "coach"]) {
      const current = services();
      await expect(listEnrolmentRequestsHandler(request(null, role, "staff-1"), current)).resolves.toMatchObject({
        truncated: false,
      });
      await expect(
        returnEnrolmentRequestHandler(
          request({ enrolmentRequestId: "enrolment-1", note: "Add the emergency contact." }, role, "staff-1"),
          current,
        ),
      ).resolves.toMatchObject({ enrolmentRequestId: "enrolment-1" });
    }
  });
```

Adapta `services()` / los ids al fake ya usado en ese `describe` (mira cómo el test "sends back" construye `returnForChanges`). En el test "refuses a client account, however well formed the payload" de `approveEnrolmentRequestHandler`, `"coach"` ya está en la lista de rechazados: **déjalo** y añade `"headCoach"`. Añade el mismo par al test de rechazo de `getEnrolmentRequestDetailHandler` si existe uno de roles; si no, crea:

```ts
  it("keeps the confidential detail behind the office door", async () => {
    for (const role of ["coach", "headCoach"]) {
      await expect(
        getEnrolmentRequestDetailHandler(officeRequest({ enrolmentRequestId: "enrolment-1" }, { role }), officeServices()),
      ).rejects.toMatchObject({ code: "permission-denied" });
    }
  });
```

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project node apps/functions/src/members/enrolment-request-callables.test.ts
```

Expected: FAIL solo en "lets the mat read the queue…".

- [ ] **Step 3: Implementar** en `enrolment-request-callables.ts`:

```ts
// The queue and the send-back are office work the mat shares (operator decision 2026-09-12,
// ADR-010). The confidential detail and the approval keep the canonical directory door.
const officeRoles = new Set(["owner", "administrator", "headCoach", "coach"]);
```

- [ ] **Step 4: Ejecutar** el archivo. Expected: PASS. Guarda: pon `officeRoles` de vuelta a dos roles y confirma que el test nuevo muere; restaura.

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/members/enrolment-request-callables.ts apps/functions/src/members/enrolment-request-callables.test.ts && git commit -m "feat(functions): coaches list the enrolment queue and send requests back (ADR-010)"
```

---

### Task 7: `listHealthReferences` y guardado de etiqueta por staff (functions)

**Files:**
- Modify: `apps/functions/src/health/health-service.ts` (tipo `HealthStore`, `createHealthStore`)
- Modify: `apps/functions/src/health/health-callables.ts` (roles de `save`, nuevo handler y export)
- Modify: `apps/functions/src/index.ts:175-181` (export)
- Test: `apps/functions/src/health/health-service.test.ts`, `apps/functions/src/health/health-callables.test.ts`

**Interfaces:**
- Produces: `HealthStore.listReferences(input: { academyId: string }): Promise<readonly HealthReferenceRow[]>`; callable `listHealthReferences` (payload `null`) → `{ references: HealthReferenceRow[] }`; `saveHealthProfile` acepta `owner | administrator | headCoach | coach`.

- [ ] **Step 1: Test del store que falla** — en `health-service.test.ts`, mira cómo construye el `firestore` falso (`runTransaction`, `collection().where().limit()`, `doc()`), y añade:

```ts
  it("lists active profiles with a label, named from the canonical student, and nothing else", async () => {
    // Arrange the fake so that:
    //   academies/academy-1/healthProfiles has: student-1 (active, label "ASTHMA-INHALER"),
    //   student-2 (active, label null), student-3 (inactive, label "KNEE-BRACE"),
    //   student-4 (active, label "NO-STUDENT-DOC", but academies/academy-1/students/student-4 missing)
    //   academies/academy-1/students/student-1 -> { fullName: "Ana Coelho", ... }
    const store = createHealthStore({ firestore: fakeFirestore /* built as above */ });
    await expect(store.listReferences({ academyId: "academy-1" })).resolves.toEqual([
      { studentId: "student-1", displayName: "Ana Coelho", staffReferenceLabel: "ASTHMA-INHALER" },
    ]);
  });
```

Construye `fakeFirestore` con el mismo helper del archivo (si el helper solo soporta `doc`, extiéndelo para que `collection(path).where("status","==","active").limit(n)` devuelva un `HealthQuery` que `transaction.get` resuelva con los docs del path filtrados por `status`). Cada perfil falso debe pasar `parseHealthProfile` (copia un perfil válido del propio archivo y cambia `studentId`, `status`, `staffReferenceLabel`).

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project node apps/functions/src/health/health-service.test.ts -t "lists active profiles"
```

Expected: FAIL (`listReferences is not a function`).

- [ ] **Step 3: Implementar el store** en `health-service.ts`:

Al tipo `HealthStore` añade:

```ts
  listReferences: (input: Readonly<{ academyId: string }>) => Promise<readonly HealthReferenceRow[]>;
```

Importa `type HealthReferenceRow` desde `@bpt-jersey/domain/health`. Añade la constante y el path:

```ts
/** One page. Above it the list refuses rather than showing a partial academy (same rule as pre-class). */
const MAX_REFERENCES = 2_000;
function healthCollection(academyId: string): string {
  return "academies/" + segment(academyId, "academy") + "/healthProfiles";
}
```

Dentro de `createHealthStore(...)` devuelve además:

```ts
    async listReferences({ academyId }) {
      return firestore.runTransaction(async (transaction) => {
        const query = firestore
          .collection(healthCollection(academyId))
          .where("status", "==", "active")
          .limit(MAX_REFERENCES + 1);
        const page = asQuery(await transaction.get(query));
        if (page.docs.length > MAX_REFERENCES)
          throw new HealthStoreError("precondition", "Too many health profiles to list");
        const rows: HealthReferenceRow[] = [];
        for (const snapshot of page.docs) {
          const parsed = parseHealthProfile(snapshot.data());
          if (!parsed.ok || parsed.value.academyId !== academyId) continue;
          const label = parsed.value.staffReferenceLabel;
          if (label === null) continue;
          const student = asDocument(
            await transaction.get(firestore.doc(studentPath(academyId, parsed.value.studentId))),
          );
          const fullName = student.exists ? student.data()?.fullName : undefined;
          if (typeof fullName !== "string" || fullName.trim().length === 0) continue;
          rows.push(
            Object.freeze({
              studentId: parsed.value.studentId,
              displayName: fullName.trim(),
              staffReferenceLabel: label,
            }),
          );
        }
        return Object.freeze(
          rows.sort((left, right) => left.displayName.localeCompare(right.displayName)),
        );
      });
    },
```

(`firestore` es `dependencies.firestore`, como en los demás métodos; usa el mismo nombre local que ya emplea el archivo.)

- [ ] **Step 4: Ejecutar el test del store**. Expected: PASS.

- [ ] **Step 5: Tests del callable que fallan** — en `health-callables.test.ts` añade `listReferences: vi.fn(async () => [row])` al fake `store` de `services()` (define `const row = { studentId: "student-1", displayName: "Ana Coelho", staffReferenceLabel: "ASTHMA-INHALER" } as const;`), importa `listHealthReferencesHandler`, y añade:

```ts
  it("lists the references for every staff role and for nobody else", async () => {
    const current = services();
    for (const role of ["owner", "administrator", "headCoach", "coach"]) {
      await expect(listHealthReferencesHandler(request(null, role), current)).resolves.toEqual({
        references: [row],
      });
    }
    await expect(listHealthReferencesHandler(request(null, "guardian"), current)).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(listHealthReferencesHandler(request({ studentId: "x" }), current)).rejects.toMatchObject({
      code: "invalid-argument",
    });
    await expect(listHealthReferencesHandler(request(null), services(false))).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });

  it("lets the mat save the staff reference label", async () => {
    const payload = {
      studentId: "student-1",
      minimumOperationalSupport: ["mobility"],
      conditionSummary: null,
      staffReferenceLabel: "ASTHMA-INHALER",
      expiresAt: null,
    };
    for (const role of ["headCoach", "coach"]) {
      await expect(saveHealthProfileHandler(request(payload, role), services())).resolves.toMatchObject({
        studentId: "student-1",
      });
    }
  });
```

- [ ] **Step 6: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project node apps/functions/src/health/health-callables.test.ts
```

Expected: FAIL (handler no existe; coach rechazado en save).

- [ ] **Step 7: Implementar en `health-callables.ts`**:

```ts
const staffRoles = ["owner", "administrator", "headCoach", "coach"] as const;
```

En `saveHealthProfileHandler` sustituye `requireRole(request, ["owner", "administrator"])` por `requireRole(request, staffRoles)` con el comentario `// The mat keeps the 25-character label (operator decision 2026-09-12, ADR-010).`

Añade el handler:

```ts
export async function listHealthReferencesHandler(
  request: CallableRequest<unknown>,
  services: HealthCallableServices,
) {
  pilot(services);
  const actor = requireRole(request, staffRoles);
  if (request.data !== null && request.data !== undefined) invalidPayload();
  try {
    return { references: await services.store.listReferences({ academyId: actor.academyId }) };
  } catch (error) {
    return mapError(error, "read");
  }
}
```

Y el export al final:

```ts
export const listHealthReferences = onCall(healthCallableOptions, (request) =>
  listHealthReferencesHandler(request, callableServices()),
);
```

En `apps/functions/src/index.ts` añade `listHealthReferences,` al bloque `export { … } from "./health/health-callables.js";`.

- [ ] **Step 8: Ejecutar tests de health y typecheck de functions**

```bash
corepack pnpm vitest run --project node apps/functions/src/health && corepack pnpm --filter @bpt-jersey/functions typecheck
```

Expected: PASS y sin errores de tipos.

- [ ] **Step 9: Commit**

```bash
git add apps/functions/src/health apps/functions/src/index.ts && git commit -m "feat(functions): listHealthReferences callable and staff may save the reference label"
```

---

### Task 8: `birthdayDateLabel` (web lib)

**Files:**
- Modify: `apps/web/src/lib/birthdays-client.ts` (añadir al final)
- Test: `apps/web/src/lib/birthdays-client.test.ts`

**Interfaces:**
- Produces: `birthdayDateLabel(daysAway: number, nowMs = Date.now()): string` → `"Sun 20 Sep"`, calculado sobre el día civil de `Europe/Jersey`.

- [ ] **Step 1: Test que falla** — añadir al `describe` existente (importar `birthdayDateLabel`):

```ts
  it("prints the calendar day in Jersey time, never the year of birth", () => {
    // Saturday 12 September 2026, 10:00 UTC.
    const now = Date.UTC(2026, 8, 12, 10);
    expect(birthdayDateLabel(0, now)).toBe("Sat 12 Sep");
    expect(birthdayDateLabel(8, now)).toBe("Sun 20 Sep");
    // Across a year boundary.
    expect(birthdayDateLabel(3, Date.UTC(2026, 11, 30, 12))).toBe("Sat 2 Jan");
    // 00:30 BST on the night the clocks go back: still counts from Sunday 25 October.
    expect(birthdayDateLabel(1, Date.UTC(2026, 9, 24, 23, 30))).toBe("Mon 26 Oct");
  });
```

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project web apps/web/src/lib/birthdays-client.test.ts -t "calendar day"
```

Expected: FAIL (no exportado).

- [ ] **Step 3: Implementar**

```ts
const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const jerseyDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Jersey",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * "Sun 20 Sep": the day of the birthday, counted from today's civil date in Jersey. The backend
 * only says how many days away it is; the year of birth still never reaches the browser.
 * ponytail: fixed weekday/month tables because en-GB Intl prints "Sept", and the office asked
 * for "Sep".
 */
export function birthdayDateLabel(daysAway: number, nowMs: number = Date.now()): string {
  const [year, month, day] = jerseyDay.format(new Date(nowMs)).split("-").map(Number);
  const target = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + daysAway));
  return `${weekdayLabels[target.getUTCDay()]} ${target.getUTCDate()} ${monthLabels[target.getUTCMonth()]}`;
}
```

- [ ] **Step 4: Ejecutar el archivo**. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/birthdays-client.ts apps/web/src/lib/birthdays-client.test.ts && git commit -m "feat(admin): birthday date label in Jersey time"
```

---

### Task 9: `listHealthReferences` (web lib)

**Files:**
- Modify: `apps/web/src/lib/health-client.ts` (añadir al final; importar `isHealthReferenceRow`, `type HealthReferenceRow` de `@bpt-jersey/domain/health`)
- Test: `apps/web/src/lib/health-admin-client.test.ts`

**Interfaces:**
- Produces: `listHealthReferences(): Promise<readonly HealthReferenceRow[]>`; error seguro `"Unable to load the reference labels. Please try again."`.

- [ ] **Step 1: Test que falla** — en `health-admin-client.test.ts` importa `listHealthReferences` y añade:

```ts
  it("lists the reference labels and refuses a row that carries more than the label", async () => {
    const row = { studentId: "student-1", displayName: "Ana Coelho", staffReferenceLabel: "ASTHMA-INHALER" };
    callableState.call.mockResolvedValueOnce({ data: { references: [row] } });
    await expect(listHealthReferences()).resolves.toEqual([row]);
    expect(callableState.call).toHaveBeenCalledWith(null);

    callableState.call.mockResolvedValueOnce({
      data: { references: [{ ...row, conditionSummary: "leak" }] },
    });
    await expect(listHealthReferences()).rejects.toThrow(
      "Unable to load the reference labels. Please try again.",
    );
  });
```

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project web apps/web/src/lib/health-admin-client.test.ts -t "reference labels"
```

Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
const safeReferencesError = "Unable to load the reference labels. Please try again.";

export async function listHealthReferences(): Promise<readonly HealthReferenceRow[]> {
  try {
    const callable = httpsCallable<null, unknown>(getFirebaseFunctions(), "listHealthReferences");
    const result = await callable(null);
    const data = result.data;
    if (!isPlainRecord(data) || !Array.isArray(data.references)) throw new Error(safeReferencesError);
    if (!data.references.every(isHealthReferenceRow)) throw new Error(safeReferencesError);
    return Object.freeze([...data.references]);
  } catch {
    throw new Error(safeReferencesError);
  }
}
```

Exporta también `export type { HealthReferenceRow } from "@bpt-jersey/domain/health";` junto a los otros re-exports del archivo.

- [ ] **Step 4: Ejecutar**. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/health-client.ts apps/web/src/lib/health-admin-client.test.ts && git commit -m "feat(admin): health client lists reference labels"
```

---

### Task 10: Rutas de staff en un solo sitio; menú sin Memberships/Waivers

**Files:**
- Create: `apps/web/src/app/admin/admin-routes.ts`
- Create: `apps/web/src/app/admin/admin-routes.test.ts`
- Modify: `apps/web/src/app/admin/admin-shell.tsx:24-71` (grupos y `coachRoutes`)
- Test: `apps/web/src/app/admin/page.test.tsx:24-37, 215-256`

**Interfaces:**
- Produces:
  ```ts
  export const staffRoutes: Readonly<Record<"headCoach" | "coach", readonly string[]>>;
  export function isStaffRouteAllowed(pathname: string, role: "headCoach" | "coach"): boolean;
  ```
  `coach` → `["/admin", "/admin/attendance", "/admin/members/requests", "/admin/members/medical"]`; `headCoach` → los mismos + `"/admin/classes"`. `isStaffRouteAllowed` acepta la ruta exacta o un subpath (`/admin/attendance/x`), y además `/admin/waitlists*` y `/admin/lesson-plans*` para ambos roles (rutas fuera de menú que el gate ya permitía). `/admin` solo exacto.

- [ ] **Step 1: Test que falla** — `admin-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { isStaffRouteAllowed, staffRoutes } from "./admin-routes";

describe("staff routes", () => {
  it("lists what each role sees in the menu, in navigation order", () => {
    expect(staffRoutes.coach).toEqual([
      "/admin",
      "/admin/attendance",
      "/admin/members/requests",
      "/admin/members/medical",
    ]);
    expect(staffRoutes.headCoach).toEqual([...staffRoutes.coach, "/admin/classes"]);
  });

  it("gates by prefix, except the overview which is exact", () => {
    expect(isStaffRouteAllowed("/admin", "coach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/attendance/today", "coach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/members/requests", "coach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/members", "coach")).toBe(false);
    expect(isStaffRouteAllowed("/admin/members/search", "coach")).toBe(false);
    expect(isStaffRouteAllowed("/admin/classes", "coach")).toBe(false);
    expect(isStaffRouteAllowed("/admin/classes", "headCoach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/billing", "headCoach")).toBe(false);
  });

  it("keeps the off-menu routes staff could already open", () => {
    expect(isStaffRouteAllowed("/admin/waitlists/x", "coach")).toBe(true);
    expect(isStaffRouteAllowed("/admin/lesson-plans", "headCoach")).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project web apps/web/src/app/admin/admin-routes.test.ts
```

Expected: FAIL (módulo no existe).

- [ ] **Step 3: Crear `admin-routes.ts`**

```ts
import type { StaffSession } from "../../lib/staff-auth";

export type StaffRouteRole = StaffSession["role"];

/**
 * What the mat can open inside /admin, in menu order. The shell lists exactly these; the gate
 * lets a staff session through exactly these (plus two working routes kept off the menu).
 * Operator decision 2026-09-12, ADR-010.
 */
const coachRoutes = Object.freeze([
  "/admin",
  "/admin/attendance",
  "/admin/members/requests",
  "/admin/members/medical",
] as const);

export const staffRoutes: Readonly<Record<StaffRouteRole, readonly string[]>> = Object.freeze({
  coach: coachRoutes,
  headCoach: Object.freeze([...coachRoutes, "/admin/classes"]),
});

const offMenuStaffRoutes = Object.freeze(["/admin/waitlists", "/admin/lesson-plans"] as const);

function matches(pathname: string, route: string): boolean {
  if (route === "/admin") return pathname === "/admin";
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function isStaffRouteAllowed(pathname: string, role: StaffRouteRole): boolean {
  return [...staffRoutes[role], ...offMenuStaffRoutes].some((route) => matches(pathname, route));
}
```

- [ ] **Step 4: Ejecutar** el test. Expected: PASS.

- [ ] **Step 5: Test del shell que falla** — en `page.test.tsx`: en `pilotNavigation` quita `"Memberships"` y `"Waivers"` y añade `"Medical conditions"` justo después de `"Enrolment requests"`. En el test del coach cambia la expectativa a:

```ts
    ).toEqual(["->Overview", "->Attendance", "->Enrolment requests", "->Medical conditions"]);
```

y su nombre a `"shows a coach the mat modules plus a way back to the coach portal"`. En el del head coach:

```ts
    ).toEqual(["->Overview", "->Attendance", "->Enrolment requests", "->Medical conditions", "->Classes"]);
```

Añade un test:

```ts
  it("no longer lists memberships or waivers, though their routes still exist", () => {
    render(
      <AdminShell session={syntheticSession}>
        <p>Content</p>
      </AdminShell>,
    );
    const navigation = screen.getByRole("navigation", { name: "Admin navigation" });
    expect(within(navigation).queryByRole("link", { name: "Memberships" })).toBeNull();
    expect(within(navigation).queryByRole("link", { name: "Waivers" })).toBeNull();
    expect(within(navigation).getByRole("link", { name: "Medical conditions" })).toHaveAttribute(
      "href",
      "/admin/members/medical",
    );
  });
```

- [ ] **Step 6: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project web apps/web/src/app/admin/page.test.tsx
```

Expected: FAIL en los tres tests tocados.

- [ ] **Step 7: Modificar `admin-shell.tsx`**: el grupo People pasa a

```ts
  {
    label: "People",
    items: [
      { label: "Members", href: "/admin/members" },
      { label: "Enrolment requests", href: "/admin/members/requests" },
      { label: "Medical conditions", href: "/admin/members/medical" },
    ],
  },
```

Actualiza el comentario de `navigationGroups` añadiendo: "Memberships and waivers keep their routes (`/admin/memberships`, `/admin/waivers`) and tests but left the menu on 2026-09-12 at the operator's request." Borra la constante `coachRoutes` y sustitúyela por `import { staffRoutes } from "./admin-routes";` y `const allowedRoutes = isStaffRole(session.role) ? staffRoutes[session.role] : undefined;`.

- [ ] **Step 8: Ejecutar** `page.test.tsx` y `admin-ui.test.tsx`. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/admin/admin-routes.ts apps/web/src/app/admin/admin-routes.test.ts apps/web/src/app/admin/admin-shell.tsx apps/web/src/app/admin/page.test.tsx && git commit -m "feat(admin): staff routes in one place; menu without memberships and waivers"
```

---

### Task 11: Gate para staff y sesión sintética de coach

**Files:**
- Modify: `apps/web/src/app/admin/admin-gate.tsx:77-92, 159-176, 196-230`
- Modify: `apps/web/src/lib/admin-test-bootstrap.ts`
- Test: `apps/web/src/lib/admin-test-bootstrap.test.ts`

**Interfaces:**
- Produces: `staffSessionForTestRole(role: "headCoach" | "coach"): StaffSession`; `E2EAdminGate` acepta `?adminTestRole=coach|headCoach` y renderiza el shell de staff; `FirebaseAdminGate` autoriza a staff con `isStaffRouteAllowed(pathname, role)`.

- [ ] **Step 1: Test que falla** — en `admin-test-bootstrap.test.ts` añade:

```ts
  it("builds a frozen synthetic staff session for the coach roles", () => {
    const session = staffSessionForTestRole("coach");
    expect(session).toEqual({
      uid: "synthetic-staff-coach",
      email: "coach@example.test",
      displayName: "Synthetic coach",
      academyId: "synthetic-academy",
      role: "coach",
    });
    expect(Object.isFrozen(session)).toBe(true);
    expect(staffSessionForTestRole("headCoach").role).toBe("headCoach");
  });
```

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project web apps/web/src/lib/admin-test-bootstrap.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar en `admin-test-bootstrap.ts`**

```ts
import type { StaffSession } from "./staff-auth";

export type StaffE2ERole = StaffSession["role"];

export function staffSessionForTestRole(role: StaffE2ERole): StaffSession {
  return Object.freeze({
    uid: `synthetic-staff-${role}`,
    email: `${role}@example.test`,
    displayName: `Synthetic ${role}`,
    academyId: "synthetic-academy",
    role,
  });
}
```

- [ ] **Step 4: Modificar `admin-gate.tsx`**

Sustituye los helpers `isWaitlistRoute`, `isLessonPlanningRoute`, `isAttendanceRoute`, `isClassesRoute` y la condición de staff por:

```ts
import { isStaffRouteAllowed } from "./admin-routes";
…
  if (staff.status === "signed-in" && staff.session && isStaffRouteAllowed(pathname, staff.session.role)) {
    return (
      <AuthorizedStaffWaitlistContent onSignOut={staff.signOut} session={staff.session}>
        {children}
      </AuthorizedStaffWaitlistContent>
    );
  }
```

(borra los cuatro helpers si quedan sin uso). En `E2EAdminGate` cambia el estado y el efecto:

```ts
    | { status: "authorized"; role: Extract<AdminRole, "owner" | "administrator"> }
    | { status: "authorized-staff"; role: StaffE2ERole }
…
    if (role === "coach" || role === "headCoach") {
      startTransition(() => setState({ status: "authorized-staff", role }));
      return;
    }
    if (role !== "owner" && role !== "administrator") {
      startTransition(() => setState({ status: "denied" }));
      return;
    }
…
  if (state.status === "authorized-staff") {
    return (
      <AuthorizedStaffWaitlistContent onSignOut={async () => {}} session={staffSessionForTestRole(state.role)}>
        {children}
      </AuthorizedStaffWaitlistContent>
    );
  }
```

Añade `"headCoach"` a `isAdminTestRole` y al tipo `AdminTestRole`. Importa `staffSessionForTestRole, type StaffE2ERole` de `../../lib/admin-test-bootstrap`.

- [ ] **Step 5: Typecheck y tests de admin**

```bash
corepack pnpm --filter @bpt-jersey/web typecheck && corepack pnpm vitest run --project web apps/web/src/app/admin/page.test.tsx apps/web/src/app/admin/layout.test.tsx apps/web/src/lib/admin-test-bootstrap.test.ts
```

Expected: PASS. Si `layout.test.tsx` o `page.test.tsx` cubren el gate con `?adminTestRole=`, añade un caso con `coach` que espere el shell con el enlace "Coach portal" visible; si no lo cubren, la cobertura queda en la Task 19 (Playwright).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/admin/admin-gate.tsx apps/web/src/lib/admin-test-bootstrap.ts apps/web/src/lib/admin-test-bootstrap.test.ts && git commit -m "feat(admin): staff gate driven by admin-routes; synthetic coach session for e2e"
```

---

### Task 12: Overview sin atajos ni métrica Members

**Files:**
- Modify: `apps/web/src/app/admin/overview-page.tsx:49-57, 168-193`
- Modify: `apps/web/src/app/admin/admin.css:24-59, 61-66`
- Test: `apps/web/src/app/admin/overview-page.test.tsx`

**Interfaces:**
- Consumes: `getDailyOperationsDashboard`, `getOperationalReport` (sin cambios).
- Produces: Overview sin `.admin-quick-actions`; tres `AdminMetric` (Classes today, Attendance pending, Overdue memberships).

- [ ] **Step 1: Test que falla** — reemplaza el contenido de `overview-page.test.tsx` por un harness con datos (los mocks deben ser `vi.hoisted` para poder cambiarlos por test):

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getOperationalReport: vi.fn(),
  getDailyOperationsDashboard: vi.fn(),
  listUpcomingBirthdays: vi.fn(),
}));

vi.mock("../../lib/reports-client", () => ({ getOperationalReport: api.getOperationalReport }));
vi.mock("../../lib/schedule-client", () => ({
  getDailyOperationsDashboard: api.getDailyOperationsDashboard,
}));
vi.mock("../../lib/birthdays-client", async () => {
  const actual = await vi.importActual<typeof import("../../lib/birthdays-client")>(
    "../../lib/birthdays-client",
  );
  return { ...actual, listUpcomingBirthdays: api.listUpcomingBirthdays };
});

import { OverviewPage } from "./overview-page";

const report = {
  students: { activeStudents: 126 },
  memberships: { overdue: 2 },
  attendance: { noShow: 0 },
} as never;
const dashboard = { sessions: [] } as never;

beforeEach(() => {
  api.getOperationalReport.mockResolvedValue(report);
  api.getDailyOperationsDashboard.mockResolvedValue(dashboard);
  api.listUpcomingBirthdays.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("admin overview", () => {
  it("does not render synthetic metrics when connected sources are unavailable", async () => {
    api.getOperationalReport.mockRejectedValue(new Error("unavailable"));
    api.getDailyOperationsDashboard.mockRejectedValue(new Error("unavailable"));
    render(<OverviewPage />);

    expect(screen.getByRole("heading", { name: "Today's academy view" })).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load today's connected dashboard");
    expect(screen.queryByText("126")).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Today's classes" })).not.toBeInTheDocument();
  });

  it("shows the three operational counts without the shortcut bar or the member count", async () => {
    render(<OverviewPage />);

    expect(await screen.findByRole("article", { name: "0 Classes today" })).toBeVisible();
    expect(screen.getByRole("article", { name: "0 Attendance pending" })).toBeVisible();
    expect(screen.getByRole("article", { name: "2 Overdue memberships" })).toBeVisible();
    expect(screen.queryByRole("article", { name: /Members$/ })).not.toBeInTheDocument();
    expect(screen.queryByText("126")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add new member" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Quick actions")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project web apps/web/src/app/admin/overview-page.test.tsx
```

Expected: FAIL en el segundo test ("Add new member" existe; artículo "126 Members" existe).

- [ ] **Step 3: Editar `overview-page.tsx`**: borra la constante `quickActions`, el `<div className="admin-quick-actions" …>` completo y el `AdminMetric` con `label="Members"`. Quita el import de `Link` **solo** si deja de usarse (sigue usándose en "Manage classes and sessions" y "Review finance": consérvalo).

- [ ] **Step 4: Editar `admin.css`**: borra los bloques `.admin-quick-actions { … }`, `.admin-quick-action { … }`, `.admin-quick-action:hover, .admin-quick-action:focus-visible { … }` y en la regla `.admin-quick-action:focus-visible, .admin-text-link:focus-visible` deja solo `.admin-text-link:focus-visible`. Cambia `.admin-metrics-grid` a `grid-template-columns: repeat(3, minmax(0, 1fr));`. Comprueba con `grep -rn "admin-quick-action" apps/web/src qa` que no queda ninguna referencia (la de `qa/tests/admin-shell.spec.ts` se arregla en la Task 19).

- [ ] **Step 5: Ejecutar test, lint y formato**

```bash
corepack pnpm vitest run --project web apps/web/src/app/admin/overview-page.test.tsx && corepack pnpm eslint apps/web/src/app/admin/overview-page.tsx --max-warnings 0 && corepack pnpm prettier --check apps/web/src/app/admin/overview-page.tsx apps/web/src/app/admin/admin.css
```

Expected: PASS / sin avisos.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/admin/overview-page.tsx apps/web/src/app/admin/overview-page.test.tsx apps/web/src/app/admin/admin.css && git commit -m "feat(admin): overview without the shortcut bar and the member count"
```

---

### Task 13: Overview con los tres próximos cumpleaños y aviso del día

**Files:**
- Modify: `apps/web/src/app/admin/overview-page.tsx`
- Modify: `apps/web/src/app/admin/admin.css` (añadir tras `.admin-action-list li span`)
- Test: `apps/web/src/app/admin/overview-page.test.tsx`

**Interfaces:**
- Consumes: `listUpcomingBirthdays({ windowDays: 366 })`, `birthdayDateLabel(daysAway)`, `birthdayWhenLabel` (Task 8; `upcomingBirthdayMaxWindowDays` de `@bpt-jersey/domain/birthdays`).
- Produces: tarjeta "Next birthdays" (máx. 3 filas) y banda `role="status"` "Birthday today".

- [ ] **Step 1: Tests que fallan** — añadir a `overview-page.test.tsx`:

```tsx
  it("lists at most the three nearest birthdays with their day, and never a year of birth", async () => {
    api.listUpcomingBirthdays.mockResolvedValue([
      { studentId: "s-1", displayName: "Ana Coelho", daysAway: 2, turningAge: 30, participantType: "adult", trainingCenter: "Town" },
      { studentId: "s-2", displayName: "Ben Kid", daysAway: 5, turningAge: 9, participantType: "minor", trainingCenter: "West" },
      { studentId: "s-3", displayName: "Cara Lima", daysAway: 40, turningAge: 41, participantType: "adult", trainingCenter: "Town" },
      { studentId: "s-4", displayName: "Dan Extra", daysAway: 90, turningAge: 22, participantType: "adult", trainingCenter: "Town" },
    ]);
    render(<OverviewPage />);

    const card = await screen.findByRole("region", { name: "Next birthdays" });
    expect(api.listUpcomingBirthdays).toHaveBeenCalledWith({ windowDays: 366 });
    const items = within(card).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/Ana Coelho/);
    expect(items[0]).toHaveTextContent(/turns 30/);
    expect(items[0]).toHaveTextContent(/^\S+ \d{1,2} \S{3}/); // e.g. "Mon 14 Sep" before the name
    expect(card).not.toHaveTextContent("Dan Extra");
    expect(card).not.toHaveTextContent(/19\d\d|20\d\d/);
    expect(screen.queryByRole("status", { name: "Birthday today" })).not.toBeInTheDocument();
  });

  it("announces a birthday that is today", async () => {
    api.listUpcomingBirthdays.mockResolvedValue([
      { studentId: "s-1", displayName: "Ana Coelho", daysAway: 0, turningAge: 30, participantType: "adult", trainingCenter: "Town" },
    ]);
    render(<OverviewPage />);

    const band = await screen.findByRole("status", { name: "Birthday today" });
    expect(band).toHaveTextContent("Ana Coelho turns 30 today");
    expect(within(band).getByText("Ana Coelho")).toBeVisible();
  });

  it("keeps the rest of the overview when birthdays cannot be read", async () => {
    api.listUpcomingBirthdays.mockRejectedValue(new Error("unavailable"));
    render(<OverviewPage />);

    expect(await screen.findByRole("article", { name: "0 Classes today" })).toBeVisible();
    expect(screen.getByText("Birthdays are temporarily unavailable.")).toBeVisible();
  });
```

(importa `within` de testing-library.) La regex de la fecha es intencionadamente laxa: el día concreto depende del reloj real; lo exacto lo cubre el test de `birthdayDateLabel`.

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project web apps/web/src/app/admin/overview-page.test.tsx
```

Expected: FAIL en los tres nuevos.

- [ ] **Step 3: Implementar en `overview-page.tsx`**

Imports nuevos:

```ts
import { upcomingBirthdayMaxWindowDays, type UpcomingBirthday } from "@bpt-jersey/domain/birthdays";
import { birthdayDateLabel, listUpcomingBirthdays } from "../../lib/birthdays-client";
```

Estado y carga (independiente del dashboard; no bloquea el resto):

```ts
type BirthdayState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; entries: readonly UpcomingBirthday[] }>
  | Readonly<{ status: "error" }>;

const nextBirthdaysShown = 3;
…
  const [birthdays, setBirthdays] = useState<BirthdayState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void listUpcomingBirthdays({ windowDays: upcomingBirthdayMaxWindowDays }).then(
      (entries) => {
        if (active) setBirthdays({ status: "ready", entries: entries.slice(0, nextBirthdaysShown) });
      },
      () => {
        if (active) setBirthdays({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, []);
```

Componentes (en el mismo archivo, debajo de `toClassRows`):

```tsx
function BirthdayTodayBand({ entries }: { entries: readonly UpcomingBirthday[] }) {
  const today = entries.filter((entry) => entry.daysAway === 0);
  if (today.length === 0) return null;
  const [first] = today;
  return (
    <aside className="admin-birthday-today" aria-label="Birthday today" role="status">
      <p className="admin-eyebrow">Birthday today</p>
      <h3>
        {today.length === 1 && first
          ? `${first.displayName} turns ${first.turningAge} today`
          : `${today.length} birthdays today`}
      </h3>
      <ul className="admin-birthday-today-names">
        {today.map((entry) => (
          <li key={entry.studentId}>
            <span className="admin-birthday-badge">{entry.displayName}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function NextBirthdaysCard({ state }: { state: BirthdayState }) {
  return (
    <section className="admin-panel-card" aria-labelledby="next-birthdays-title">
      <div className="admin-panel-card-heading">
        <div>
          <p className="admin-eyebrow">People</p>
          <h3 id="next-birthdays-title">Next birthdays</h3>
        </div>
      </div>
      {state.status === "loading" ? <p role="status">Loading birthdays...</p> : null}
      {state.status === "error" ? <p className="admin-report-state">Birthdays are temporarily unavailable.</p> : null}
      {state.status === "ready" && state.entries.length === 0 ? (
        <p className="admin-empty-state">No birthdays recorded for the year ahead.</p>
      ) : null}
      {state.status === "ready" && state.entries.length > 0 ? (
        <ol className="admin-birthday-list">
          {state.entries.map((entry) => (
            <li key={entry.studentId}>
              <span className="admin-birthday-date">
                {entry.daysAway === 0 ? "Today" : birthdayDateLabel(entry.daysAway)}
              </span>
              <strong>{entry.displayName}</strong>
              <span className="admin-birthday-age">turns {entry.turningAge}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
```

En el JSX de "ready": justo antes de `<div className="admin-metrics-grid" …>` inserta `{birthdays.status === "ready" ? <BirthdayTodayBand entries={birthdays.entries} /> : null}`; y dentro de `.admin-overview-grid`, después de la sección "Needs attention", `<NextBirthdaysCard state={birthdays} />`. Como `section` con `aria-labelledby` expone rol `region` con nombre "Next birthdays", el test lo encuentra.

- [ ] **Step 4: CSS** (añadir en `admin.css` tras `.admin-action-list li span { … }`):

```css
.admin-birthday-today {
  background: #f0efff;
  border: 1px solid #d9d6ff;
  border-left: 0.35rem solid var(--bpt-purple);
  margin: 1.5rem 0 0;
  padding: 1rem 1.15rem;
}

.admin-birthday-today h3 {
  font-family: var(--font-display), Impact, sans-serif;
  font-size: clamp(1.6rem, 3vw, 2.4rem);
  line-height: 0.92;
  margin: 0.3rem 0 0.6rem;
  text-transform: uppercase;
}

.admin-birthday-today-names {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.admin-birthday-badge {
  background: #d9f36a;
  color: var(--mat-ink);
  display: inline-block;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 0.3rem 0.55rem;
  text-transform: uppercase;
}

.admin-birthday-list {
  display: grid;
  gap: 0.7rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.admin-birthday-list li {
  align-items: baseline;
  border-bottom: 1px solid var(--line);
  display: grid;
  gap: 0.2rem 0.8rem;
  grid-template-columns: minmax(6.5rem, auto) minmax(0, 1fr);
  padding-bottom: 0.7rem;
}

.admin-birthday-date {
  color: var(--bpt-purple);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.admin-birthday-age {
  color: var(--muted);
  font-size: 0.85rem;
  grid-column: 2;
}
```

- [ ] **Step 5: Ejecutar test, lint, formato**

```bash
corepack pnpm vitest run --project web apps/web/src/app/admin/overview-page.test.tsx && corepack pnpm eslint apps/web/src/app/admin/overview-page.tsx --max-warnings 0 && corepack pnpm prettier --write apps/web/src/app/admin/overview-page.tsx apps/web/src/app/admin/admin.css
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/admin/overview-page.tsx apps/web/src/app/admin/overview-page.test.tsx apps/web/src/app/admin/admin.css && git commit -m "feat(admin): next three birthdays on the overview, with a birthday-today band"
```

---

### Task 14: Bloque de sesión con la lista de reservados (`SessionRoster`)

**Files:**
- Create: `apps/web/src/app/admin/attendance/session-roster.tsx`
- Create: `apps/web/src/app/admin/attendance/session-roster.test.tsx`
- Modify: `apps/web/src/app/admin/attendance/attendance.css` (añadir al final)

**Interfaces:**
- Consumes: `deriveRosterTag`, `type PreClassAttendee` (`@bpt-jersey/domain/schedule/pre-class`), `type SessionRecord` (`@bpt-jersey/domain/schedule`).
- Produces:
  ```tsx
  export type SessionRosterState =
    | Readonly<{ status: "loading" }>
    | Readonly<{ status: "ready"; attendees: readonly PreClassAttendee[] }>
    | Readonly<{ status: "error" }>;
  export function SessionRoster(props: {
    session: SessionRecord; roster: SessionRosterState; nowMs: number;
    busyStudentId?: string; onClockIn: (studentId: string, displayName: string) => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Test que falla** — `session-roster.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PreClassAttendee } from "@bpt-jersey/domain/schedule/pre-class";
import type { SessionRecord } from "@bpt-jersey/domain/schedule";

import { SessionRoster } from "./session-roster";

const session: SessionRecord = {
  sessionId: "session-1",
  academyId: "academy-1",
  classId: "class-1",
  programId: "program-1",
  locationId: "town",
  instructorId: "coach-miro",
  title: "Adults Gi",
  startAt: "2026-09-12T18:00:00.000Z",
  endAt: "2026-09-12T19:00:00.000Z",
  capacity: 20,
  minParticipants: 4,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  schemaVersion: "1",
  createdAt: "2026-09-01T10:00:00.000Z",
  createdBy: "admin-1",
  updatedAt: "2026-09-01T10:00:00.000Z",
  updatedBy: "admin-1",
};

function attendee(overrides: Partial<PreClassAttendee> & { studentId: string; displayName: string }): PreClassAttendee {
  return {
    source: "booked",
    status: "booked_not_arrived",
    attendedCount: 0,
    comparableSessionCount: 0,
    lastAttendedAt: null,
    ...overrides,
  };
}

const attendees = [
  attendee({ studentId: "s-ready", displayName: "Ana Ready", status: "attended" }),
  attendee({ studentId: "s-booked", displayName: "Ben Booked" }),
  attendee({ studentId: "s-regular", displayName: "Reg Ular", source: "regular", status: null }),
];
const before = Date.parse("2026-09-12T17:45:00.000Z");
const after = Date.parse("2026-09-12T18:00:00.000Z");

describe("SessionRoster", () => {
  it("titles the block with the class and the coach, and lists only booked members", () => {
    render(<SessionRoster session={session} roster={{ status: "ready", attendees }} nowMs={before} onClockIn={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Adults Gi · Coach coach-miro" })).toBeVisible();
    const list = screen.getByRole("list", { name: "Adults Gi roster" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(list).not.toHaveTextContent("Reg Ular");
  });

  it("tags ready, booked, then late once the class has started, with a button only where a clock-in is missing", async () => {
    const onClockIn = vi.fn();
    const { rerender } = render(
      <SessionRoster session={session} roster={{ status: "ready", attendees }} nowMs={before} onClockIn={onClockIn} />,
    );
    expect(screen.getByText("Ready")).toHaveClass("attendance-tag-ready");
    expect(screen.getByText("Booked")).toHaveClass("attendance-tag-booked");
    expect(screen.queryByRole("button", { name: "Clock in Ana Ready" })).not.toBeInTheDocument();
    expect(screen.getByText("1 ready")).toBeVisible();
    expect(screen.getByText("1 waiting")).toBeVisible();
    expect(screen.getByText("0 late")).toBeVisible();

    rerender(<SessionRoster session={session} roster={{ status: "ready", attendees }} nowMs={after} onClockIn={onClockIn} />);
    expect(screen.getByText("Late")).toHaveClass("attendance-tag-late");
    expect(screen.getByText("1 late")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Clock in Ben Booked" }));
    expect(onClockIn).toHaveBeenCalledWith("s-booked", "Ben Booked");
  });

  it("disables every button of the block while one clock-in is in flight", () => {
    render(
      <SessionRoster session={session} roster={{ status: "ready", attendees }} nowMs={after} busyStudentId="s-booked" onClockIn={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Clock in Ben Booked" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clock in Ben Booked" })).toHaveTextContent("Clocking in...");
  });

  it("says so when nobody booked, when the roster failed and when the session is cancelled", () => {
    const { rerender } = render(
      <SessionRoster session={session} roster={{ status: "ready", attendees: [] }} nowMs={before} onClockIn={vi.fn()} />,
    );
    expect(screen.getByText("Nobody has booked this class.")).toBeVisible();
    rerender(<SessionRoster session={session} roster={{ status: "error" }} nowMs={before} onClockIn={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load this roster.");
    rerender(
      <SessionRoster session={{ ...session, status: "cancelled" }} roster={{ status: "ready", attendees }} nowMs={after} onClockIn={vi.fn()} />,
    );
    expect(screen.getByText("Cancelled")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Clock in/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project web apps/web/src/app/admin/attendance/session-roster.test.tsx
```

Expected: FAIL (módulo no existe).

- [ ] **Step 3: Crear `session-roster.tsx`**

```tsx
"use client";

import type { SessionRecord } from "@bpt-jersey/domain/schedule";
import { deriveRosterTag, type PreClassAttendee, type RosterTag } from "@bpt-jersey/domain/schedule/pre-class";

export type SessionRosterState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; attendees: readonly PreClassAttendee[] }>
  | Readonly<{ status: "error" }>;

const tagLabels: Readonly<Record<RosterTag, string>> = {
  ready: "Ready",
  booked: "Booked",
  late: "Late",
  no_show: "No-show",
  absent: "Absent",
};

function timeOf(iso: string): string {
  return iso.slice(11, 16);
}

/**
 * One class of the day: who booked, who is already on the mat (green), who is still expected
 * (grey) and who has not clocked in although the class started (red). The coach records the
 * arrival from here; the server still decides the persisted state.
 */
export function SessionRoster({
  busyStudentId,
  nowMs,
  onClockIn,
  roster,
  session,
}: {
  busyStudentId?: string;
  nowMs: number;
  onClockIn: (studentId: string, displayName: string) => void;
  roster: SessionRosterState;
  session: SessionRecord;
}) {
  const cancelled = session.status === "cancelled";
  const booked = roster.status === "ready" ? roster.attendees.filter((a) => a.source === "booked") : [];
  const rows = booked.map((attendee) => ({
    attendee,
    tag: deriveRosterTag(attendee.status, session.startAt, nowMs),
  }));
  const ready = rows.filter((row) => row.tag === "ready").length;
  const waiting = rows.filter((row) => row.tag === "booked").length;
  const late = rows.length - ready - waiting;
  const titleId = `roster-${session.sessionId}-title`;

  return (
    <section className="attendance-session-block" aria-labelledby={titleId}>
      <div className="attendance-session-block-heading">
        <div>
          <h3 id={titleId}>
            {session.title} · Coach {session.instructorId}
          </h3>
          <p>
            {timeOf(session.startAt)} - {timeOf(session.endAt)} · {booked.length} booked
            {cancelled ? <span className="attendance-tag attendance-tag-late">Cancelled</span> : null}
          </p>
        </div>
        <p className="attendance-counters" aria-label="Roster counts">
          <span className="attendance-counter-ready">{`${ready} ready`}</span>
          <span className="attendance-counter-waiting">{`${waiting} waiting`}</span>
          <span className="attendance-counter-late">{`${late} late`}</span>
        </p>
      </div>
      {roster.status === "loading" ? <p role="status">Loading roster...</p> : null}
      {roster.status === "error" ? <p role="alert">Unable to load this roster. It will retry shortly.</p> : null}
      {roster.status === "ready" && booked.length === 0 ? <p className="admin-empty-state">Nobody has booked this class.</p> : null}
      {rows.length > 0 ? (
        <ul className="attendance-roster" aria-label={`${session.title} roster`}>
          {rows.map(({ attendee, tag }) => {
            const busy = busyStudentId !== undefined;
            const mine = busyStudentId === attendee.studentId;
            return (
              <li key={attendee.studentId}>
                <span className="attendance-roster-name">{attendee.displayName}</span>
                <span className={`attendance-tag attendance-tag-${tag}`}>{tagLabels[tag]}</span>
                {!cancelled && (tag === "booked" || tag === "late") ? (
                  <button
                    aria-label={`Clock in ${attendee.displayName}`}
                    className="button attendance-clock-in"
                    disabled={busy}
                    onClick={() => onClockIn(attendee.studentId, attendee.displayName)}
                    type="button"
                  >
                    {mine ? "Clocking in..." : "Clock in"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
```

Cada contador es un solo nodo de texto (`"1 ready"`), así `getByText("1 ready")` lo encuentra sin matcher especial.

- [ ] **Step 4: CSS** (final de `attendance.css`):

```css
.attendance-premises {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1.5rem 0 1rem;
}

.attendance-premises-label {
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.attendance-premises-button {
  background: var(--gi-white);
  border: 1px solid var(--mat-ink);
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  min-height: 2.75rem;
  padding: 0.5rem 0.9rem;
  text-transform: uppercase;
}

.attendance-premises-button[aria-checked="true"] {
  background: var(--bpt-purple);
  border-color: var(--bpt-purple);
  color: var(--gi-white);
}

.attendance-premises-button:focus-visible,
.attendance-clock-in:focus-visible {
  outline: 3px solid var(--bpt-purple);
  outline-offset: 4px;
}

.attendance-session-blocks {
  display: grid;
  gap: 1rem;
  margin: 0 0 1.5rem;
}

.attendance-session-block {
  background: var(--gi-white);
  border-top: 0.3rem solid var(--mat-ink);
  min-width: 0;
  padding: 1.15rem;
}

.attendance-session-block-heading {
  align-items: start;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: space-between;
  margin-bottom: 0.9rem;
}

.attendance-session-block h3 {
  font-family: var(--font-display), Impact, sans-serif;
  font-size: clamp(1.6rem, 3vw, 2.4rem);
  line-height: 0.92;
  margin: 0;
  overflow-wrap: anywhere;
  text-transform: uppercase;
}

.attendance-session-block-heading p {
  align-items: center;
  color: var(--muted);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  gap: 0.6rem;
  margin: 0.35rem 0 0;
}

.attendance-counters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
}

.attendance-counters span {
  border-left: 0.35rem solid currentColor;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 0.3rem 0.6rem;
  text-transform: uppercase;
}

.attendance-counter-ready {
  background: #e7f6ee;
  color: #176b49;
}

.attendance-counter-waiting {
  background: #e8e7e3;
  color: #65635d;
}

.attendance-counter-late {
  background: #fff0f2;
  color: #8d1c2f;
}

.attendance-roster {
  display: grid;
  gap: 0;
  list-style: none;
  margin: 0;
  padding: 0;
}

.attendance-roster li {
  align-items: center;
  border-top: 1px solid var(--line);
  display: grid;
  gap: 0.6rem 1rem;
  grid-template-columns: minmax(0, 1fr) auto auto;
  min-height: 3.6rem;
  padding: 0.45rem 0;
}

.attendance-roster-name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.attendance-tag {
  border-left: 0.35rem solid currentColor;
  display: inline-block;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 0.3rem 0.6rem;
  text-transform: uppercase;
}

.attendance-tag-ready {
  background: #e7f6ee;
  color: #176b49;
}

.attendance-tag-booked {
  background: #e8e7e3;
  color: #65635d;
}

.attendance-tag-late,
.attendance-tag-no_show,
.attendance-tag-absent {
  background: #fff0f2;
  color: #8d1c2f;
}

.attendance-clock-in {
  min-height: 2.75rem;
  padding: 0.5rem 0.9rem;
}

.attendance-corrections > summary {
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin: 0 0 1rem;
  text-transform: uppercase;
}

@media (max-width: 700px) {
  .attendance-roster li {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .attendance-roster li .attendance-clock-in {
    grid-column: 1 / -1;
    width: 100%;
  }
}
```

- [ ] **Step 5: Ejecutar test, lint, formato**

```bash
corepack pnpm vitest run --project web apps/web/src/app/admin/attendance/session-roster.test.tsx && corepack pnpm eslint apps/web/src/app/admin/attendance/session-roster.tsx --max-warnings 0 && corepack pnpm prettier --write apps/web/src/app/admin/attendance
```

Expected: PASS. Comprueba a mano contraste: `#176b49` sobre `#e7f6ee` ≈ 6.8:1; `#8d1c2f` sobre `#fff0f2` ≈ 8:1; `#65635d` sobre `#e8e7e3` ≈ 4.6:1 (todas ≥ 4.5).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/admin/attendance && git commit -m "feat(admin): session roster block with ready, booked and late tags"
```

---

### Task 15: Página de Attendance: sede, bloques por sesión, sondeo y tabla plegada

**Files:**
- Modify: `apps/web/src/app/admin/attendance/page.tsx`
- Test: `apps/web/src/app/admin/attendance/page.test.tsx` (añadir mocks y tests)

**Interfaces:**
- Consumes: `SessionRoster`, `SessionRosterState` (Task 14); `getPreClassView`, `listSessions`, `recordCheckIn` de `schedule-client`; `LocationId` de `@bpt-jersey/domain/schedule`.
- Produces: `AttendancePage` con `radiogroup` "Premises", un `SessionRoster` por sesión de la sede, sondeo de 30 s, reloj de 30 s, y la tabla actual bajo `<details className="attendance-corrections">`.

- [ ] **Step 1: Tests que fallan** — en `page.test.tsx`: añade `getPreClassView: vi.fn()` al objeto `schedule` hoisted; en el `beforeEach` existente añade `schedule.getPreClassView.mockResolvedValue(preClass)` con

```ts
const preClass = {
  session,
  attendees: [
    { studentId: "student-attended", displayName: "Ana Ready", source: "booked" as const, status: "attended" as const, attendedCount: 0, comparableSessionCount: 0, lastAttendedAt: null },
    { studentId: "student-pending", displayName: "Ben Booked", source: "booked" as const, status: "booked_not_arrived" as const, attendedCount: 0, comparableSessionCount: 0, lastAttendedAt: null },
  ],
  evidence: { open: true, windowDays: 56, bookedCount: 2, suggestedCount: 0, comparableSessionCount: 0 },
};
```

y los tests:

```tsx
  it("stacks one roster block per session of the chosen premises and hides the rest", async () => {
    const west = { ...session, sessionId: "session-west", locationId: "west" as const, title: "West Kids" };
    schedule.listSessions.mockResolvedValue([session, west]);
    render(<AttendancePage />);

    expect(await screen.findByRole("heading", { name: "Connected fundamentals · Coach coach-1" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /West Kids/ })).not.toBeInTheDocument();
    expect(schedule.getPreClassView).toHaveBeenCalledWith("session-connected-1");
    expect(schedule.getPreClassView).not.toHaveBeenCalledWith("session-west");

    await userEvent.click(screen.getByRole("radio", { name: "West (St Peter)" }));
    expect(await screen.findByRole("heading", { name: "West Kids · Coach coach-1" })).toBeVisible();
    expect(window.localStorage.getItem("bpt_coach_premises")).toBe("west");
  });

  it("clocks a booked member in manually and refreshes that roster", async () => {
    schedule.recordCheckIn.mockResolvedValue(attended);
    render(<AttendancePage />);
    await userEvent.click(await screen.findByRole("button", { name: "Clock in Ben Booked" }));

    expect(schedule.recordCheckIn).toHaveBeenCalledWith({
      sessionId: "session-connected-1",
      studentId: "student-pending",
      method: "manual",
    });
    await waitFor(() => expect(schedule.getPreClassView).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("status")).toHaveTextContent("Clock-in recorded for Ben Booked.");
  });

  it("re-reads the rosters every thirty seconds while the page is open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<AttendancePage />);
      await waitFor(() => expect(schedule.getPreClassView).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(30_000);
      await waitFor(() => expect(schedule.getPreClassView).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the corrections table, folded under a summary", async () => {
    render(<AttendancePage />);
    const details = (await screen.findByText("Corrections and closeout")).closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    await userEvent.click(screen.getByText("Corrections and closeout"));
    expect(screen.getByRole("table", { name: "Attendance roster" })).toBeVisible();
  });
```

Añade `localStorage.clear()` en `afterEach`. Si el harness usa `userEvent.setup()` con un `delay`, con fake timers pasa `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project web apps/web/src/app/admin/attendance/page.test.tsx
```

Expected: FAIL en los cuatro nuevos; los antiguos siguen en verde.

- [ ] **Step 3: Implementar en `page.tsx`**

Imports:

```ts
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { LocationId, … } from "@bpt-jersey/domain/schedule";
import { getPreClassView, … } from "../../../lib/schedule-client";
import { SessionRoster, type SessionRosterState } from "./session-roster";
```

Constantes y helpers (encima de `AttendancePage`):

```ts
const premisesStorageKey = "bpt_coach_premises"; // shared with /coach so both remember the same site
const rosterPollMs = 30_000;

function savedPremises(): LocationId {
  try {
    const saved = localStorage.getItem(premisesStorageKey);
    if (saved === "town" || saved === "west") return saved;
  } catch {
    // Storage can be unavailable; Town is the default site.
  }
  return "town";
}
```

Estado nuevo dentro del componente:

```ts
  const [premises, setPremises] = useState<LocationId>(savedPremises);
  const [rosters, setRosters] = useState<Readonly<Record<string, SessionRosterState>>>({});
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [busyStudentId, setBusyStudentId] = useState<string>();

  const siteSessions = useMemo(
    () => views.map((view) => view.session).filter((s) => s.locationId === premises).sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [views, premises],
  );
  const siteSessionIds = useMemo(() => siteSessions.map((s) => s.sessionId).join(","), [siteSessions]);

  const loadRoster = useCallback(async (sessionId: string) => {
    try {
      const view = await getPreClassView(sessionId);
      setRosters((current) => ({ ...current, [sessionId]: { status: "ready", attendees: view.attendees } }));
    } catch {
      setRosters((current) => ({ ...current, [sessionId]: { status: "error" } }));
    }
  }, []);

  // Rosters of the chosen site, re-read every thirty seconds while the tab is visible.
  useEffect(() => {
    if (siteSessionIds.length === 0) return;
    const ids = siteSessionIds.split(",");
    let active = true;
    const readAll = () => {
      if (!active || document.hidden) return;
      setClockMs(Date.now());
      ids.forEach((id) => void loadRoster(id));
    };
    setRosters((current) => Object.fromEntries(ids.map((id) => [id, current[id] ?? { status: "loading" }])));
    readAll();
    const timer = setInterval(readAll, rosterPollMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [siteSessionIds, loadRoster]);

  function choosePremises(next: LocationId): void {
    setPremises(next);
    try {
      localStorage.setItem(premisesStorageKey, next);
    } catch {
      // Ignore storage errors; the choice still applies to this visit.
    }
  }

  async function handleClockIn(sessionId: string, studentId: string, displayName: string): Promise<void> {
    setBusyStudentId(studentId);
    setBusyKey(`clock-in:${sessionId}:${studentId}`);
    setOperationError("");
    setNotice("");
    try {
      await recordCheckIn({ sessionId, studentId, method: "manual" });
      await loadRoster(sessionId);
      setClockMs(Date.now());
      await refreshAfterSuccess(`Clock-in recorded for ${displayName}.`);
    } catch {
      setOperationError("Unable to record the clock-in. Nothing was changed.");
    } finally {
      setBusyStudentId(undefined);
      setBusyKey(undefined);
    }
  }
```

(`views` ya existe: son las `SessionOperationalView` del día. `refreshAfterSuccess` ya existe y recarga la tabla.) Nota: el efecto no cambia `setRosters` para ids que ya estaban en `ready`, así el sondeo no parpadea a "loading".

JSX: sustituye el `<aside className="attendance-credential-note">` por (mismo sitio):

```tsx
      <div className="attendance-premises" role="radiogroup" aria-label="Premises">
        <span className="attendance-premises-label">Premises</span>
        {(["town", "west"] as const).map((site) => (
          <button
            aria-checked={premises === site}
            className="attendance-premises-button"
            key={site}
            onClick={() => choosePremises(site)}
            role="radio"
            type="button"
          >
            {site === "town" ? "Town (St Helier)" : "West (St Peter)"}
          </button>
        ))}
        <label className="admin-filter-control">
          Date
          <input aria-label="Attendance date" disabled={busy} onChange={(event) => setDate(event.target.value)} type="date" value={date} />
        </label>
      </div>

      {operationError ? <p className="attendance-operation-message attendance-operation-error" role="alert">{operationError}</p> : null}
      {notice ? <p className="attendance-operation-message attendance-operation-success" role="status">{notice}</p> : null}

      {isLoading ? <p role="status">Loading today&apos;s classes...</p> : null}
      {!isLoading && data.status === "ready" && siteSessions.length === 0 ? (
        <p className="admin-empty-state">No classes at {premises === "town" ? "Town" : "West"} on this date.</p>
      ) : null}
      <div className="attendance-session-blocks">
        {siteSessions.map((s) => (
          <SessionRoster
            busyStudentId={busyStudentId}
            key={s.sessionId}
            nowMs={clockMs}
            onClockIn={(studentId, displayName) => void handleClockIn(s.sessionId, studentId, displayName)}
            roster={rosters[s.sessionId] ?? { status: "loading" }}
            session={s}
          />
        ))}
      </div>
      <p className="admin-sidebar-note">Late is judged by the server at clock-in; the red tag is a reminder, not a record.</p>

      <details className="attendance-corrections">
        <summary>Corrections and closeout</summary>
        {/* existing: AdminFilterBar (without the Date control, now above), session strip, table, dialog */}
      </details>
```

Mueve dentro de `<details>` el `AdminFilterBar` (quitándole el control Date, que ahora está arriba), la `attendance-session-strip` y la `section` de la tabla. Deja el `AttendanceDialog` fuera del `<details>` (es un diálogo). Quita los dos `<p>` de mensajes duplicados que antes estaban entre strip y tabla. Elimina la nota `attendance-credential-note` y sus tres reglas CSS (`.attendance-credential-note`, `.attendance-credential-mark`, `.attendance-credential-note strong/p`) si ya no se usan en ningún otro sitio (`grep -rn credential-note apps/web/src`).

- [ ] **Step 4: Ejecutar tests, lint, formato, typecheck**

```bash
corepack pnpm vitest run --project web apps/web/src/app/admin/attendance && corepack pnpm eslint apps/web/src/app/admin/attendance --max-warnings 0 && corepack pnpm prettier --write apps/web/src/app/admin/attendance && corepack pnpm --filter @bpt-jersey/web typecheck
```

Expected: PASS. Si algún test antiguo buscaba la nota "Verified check-in only", elimina esa expectativa (la nota se retiró).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/attendance && git commit -m "feat(admin): attendance as one roster per class, with premises, polling and folded corrections"
```

---

### Task 16: Enrolment requests: ayuda por botón y vista del coach

**Files:**
- Modify: `apps/web/src/app/admin/members/requests/page.tsx`
- Modify: `apps/web/src/app/admin/admin.css` (tras `.admin-request-actions .shop-admin-field`)
- Test: `apps/web/src/app/admin/members/requests/page.test.tsx`

**Interfaces:**
- Consumes: `useAdminOrStaffSession()` de `../../admin-gate`.
- Produces: `<dl className="admin-request-help">`; para `headCoach`/`coach` no se renderizan "Read the full request" ni "Approve and enrol".

- [ ] **Step 1: Tests que fallan** — en `page.test.tsx` añade el mock de sesión (hoisted, por defecto owner) antes de importar la página:

```ts
const gate = vi.hoisted(() => ({ role: "owner" as "owner" | "administrator" | "headCoach" | "coach" }));
vi.mock("../../admin-gate", () => ({
  useAdminOrStaffSession: () => ({
    uid: "u-1",
    email: "u@example.test",
    displayName: "Synthetic",
    academyId: "academy-1",
    role: gate.role,
  }),
}));
```

y en `beforeEach` `gate.role = "owner";`. Tests:

```tsx
  it("explains what each button does before anybody presses it", async () => {
    render(<EnrolmentRequestQueuePage />);
    const help = await screen.findByRole("region", { name: "What the buttons do" });
    expect(help).toHaveTextContent("Read the full request");
    expect(help).toHaveTextContent("Send back to applicant");
    expect(help).toHaveTextContent("Approve and enrol");
    expect(help).toHaveTextContent("audited");
  });

  it("lets a coach see the queue and send a request back, but not open or approve it", async () => {
    gate.role = "coach";
    render(<EnrolmentRequestQueuePage />);
    await screen.findByText("Alex Adult");
    expect(screen.queryByRole("button", { name: /Read the full request/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve and enrol/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Send back to applicant/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "What the buttons do" })).toHaveTextContent(
      "Opening the full request and enrolling somebody is office work.",
    );
  });
```

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project web apps/web/src/app/admin/members/requests/page.test.tsx
```

Expected: FAIL en los dos nuevos (y posiblemente los existentes por el hook: si fallan por "must be used inside an authorized AdminGate", el mock está mal colocado; debe ir antes del `import EnrolmentRequestQueuePage`).

- [ ] **Step 3: Implementar en `page.tsx`**

```ts
import { useAdminOrStaffSession } from "../../admin-gate";
…
  const session = useAdminOrStaffSession();
  const office = session.role === "owner" || session.role === "administrator";
```

Tras `<AdminSectionHeader …/>`:

```tsx
      <section className="admin-panel-card admin-request-help" aria-labelledby="request-help-title">
        <h3 id="request-help-title">What the buttons do</h3>
        <dl>
          <dt>Read the full request</dt>
          <dd>
            Loads the confidential detail: date of birth, phone, address, emergency contact and the
            children. Every read is audited and counted, so the detail is kept on screen once loaded.
          </dd>
          <dt>Send back to applicant</dt>
          <dd>
            Needs a note. The request goes back to the applicant, who sees the note in their account,
            fixes it and sends it again.
          </dd>
          <dt>Approve and enrol</dt>
          <dd>
            Creates the member record (and the children&apos;s), links the account to its role and
            marks the request approved. Only available after the detail has been read.
          </dd>
        </dl>
        {office ? null : <p>Opening the full request and enrolling somebody is office work. You can read the queue and send a request back.</p>}
      </section>
```

En la lista de acciones, envuelve el botón "Read the full request" y el botón "Approve and enrol" en `{office ? … : null}`; el `DetailPanel` solo se renderiza cuando `office` (nunca tendrá detalle sin él, pero así el árbol lo dice).

- [ ] **Step 4: CSS**

```css
.admin-request-help h3 {
  font-size: clamp(1.4rem, 2.4vw, 1.9rem);
}

.admin-request-help dl {
  display: grid;
  gap: 0.35rem 1rem;
  grid-template-columns: minmax(10rem, auto) minmax(0, 1fr);
  margin: 0.8rem 0 0;
}

.admin-request-help dt {
  font-weight: 700;
}

.admin-request-help dd {
  color: var(--muted);
  margin: 0;
  max-width: 58rem;
}

.admin-request-help > p {
  border-left: 0.35rem solid #c98b00;
  background: #fff8e6;
  color: #765400;
  margin: 0.9rem 0 0;
  padding: 0.6rem 0.8rem;
}

@media (max-width: 700px) {
  .admin-request-help dl {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Ejecutar tests, lint, formato**

```bash
corepack pnpm vitest run --project web apps/web/src/app/admin/members/requests/page.test.tsx && corepack pnpm eslint apps/web/src/app/admin/members/requests/page.tsx --max-warnings 0 && corepack pnpm prettier --write apps/web/src/app/admin/members/requests/page.tsx apps/web/src/app/admin/admin.css
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/admin/members/requests apps/web/src/app/admin/admin.css && git commit -m "feat(admin): enrolment queue explains its buttons; coaches read and send back only"
```

---

### Task 17: Medical conditions: ruta propia y "Show all references"

**Files:**
- Create: `apps/web/src/app/admin/members/medical/medical-review-section.tsx` (mover `MedicalReviewSection` desde `members/page.tsx:235-470`)
- Create: `apps/web/src/app/admin/members/medical/page.tsx`
- Create: `apps/web/src/app/admin/members/medical/page.test.tsx`
- Modify: `apps/web/src/app/admin/members/page.tsx` (quitar la sección y sus imports; añadir enlace)
- Modify: `apps/web/src/app/admin/admin.css` (tras `.admin-birthday-age`)

**Interfaces:**
- Consumes: `getHealthAdminProfile`, `saveHealthProfile`, `listHealthReferences` (Task 9), `type HealthReferenceRow`.
- Produces: ruta `/admin/members/medical`; botón "Show all references" / "Hide references"; tabla con botón "Use" por fila que rellena el Student ID y carga el perfil.

- [ ] **Step 1: Test que falla** — `medical/page.test.tsx`:

```tsx
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const health = vi.hoisted(() => ({
  getHealthAdminProfile: vi.fn(),
  saveHealthProfile: vi.fn(),
  listHealthReferences: vi.fn(),
}));
vi.mock("../../../../lib/health-client", () => health);

import MedicalConditionsRoute from "./page";

const rows = [
  { studentId: "student-2", displayName: "Ben Kid", staffReferenceLabel: "KNEE-BRACE" },
  { studentId: "student-1", displayName: "Ana Coelho", staffReferenceLabel: "ASTHMA-INHALER" },
];

beforeEach(() => {
  health.listHealthReferences.mockResolvedValue(rows);
  health.getHealthAdminProfile.mockResolvedValue({ staffReferenceLabel: "ASTHMA-INHALER", conditionSummary: "Inhaler in bag." });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("medical conditions route", () => {
  it("keeps the lookup and label form", () => {
    render(<MedicalConditionsRoute />);
    expect(screen.getByRole("heading", { name: "Medical conditions" })).toBeVisible();
    expect(screen.getByLabelText("Student ID")).toBeVisible();
    expect(screen.getByLabelText(/Staff reference label/)).toBeVisible();
    expect(screen.getByLabelText(/Condition summary/)).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows every reference label on demand, sorted by name, and fills the lookup from a row", async () => {
    render(<MedicalConditionsRoute />);
    await userEvent.click(screen.getByRole("button", { name: "Show all references" }));

    const table = await screen.findByRole("table", { name: "Staff reference labels" });
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(bodyRows[0]).toHaveTextContent("Ana Coelho");
    expect(bodyRows[0]).toHaveTextContent("ASTHMA-INHALER");
    expect(bodyRows[1]).toHaveTextContent("Ben Kid");
    expect(table).not.toHaveTextContent("Inhaler in bag.");
    expect(screen.getByRole("button", { name: "Hide references" })).toBeVisible();

    await userEvent.click(within(bodyRows[0] as HTMLElement).getByRole("button", { name: "Use student-1" }));
    expect(screen.getByLabelText("Student ID")).toHaveValue("student-1");
    expect(health.getHealthAdminProfile).toHaveBeenCalledWith("student-1");
  });

  it("names the failure and the empty case", async () => {
    health.listHealthReferences.mockRejectedValueOnce(new Error("Unable to load the reference labels. Please try again."));
    render(<MedicalConditionsRoute />);
    await userEvent.click(screen.getByRole("button", { name: "Show all references" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load the reference labels. Please try again.");

    health.listHealthReferences.mockResolvedValueOnce([]);
    await userEvent.click(screen.getByRole("button", { name: "Show all references" }));
    expect(await screen.findByText("No reference labels recorded yet.")).toBeVisible();
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

```bash
corepack pnpm vitest run --project web apps/web/src/app/admin/members/medical/page.test.tsx
```

Expected: FAIL (módulo no existe).

- [ ] **Step 3: Mover la sección.** Corta la función `MedicalReviewSection` completa de `members/page.tsx` (desde `function MedicalReviewSection() {` hasta su `}` de cierre, justo antes de `export default function MembersRoute`) y pégala en `medical/medical-review-section.tsx` con esta cabecera:

```tsx
"use client";

import { useState, type FormEvent } from "react";

import {
  getHealthAdminProfile,
  listHealthReferences,
  saveHealthProfile,
  type HealthReferenceRow,
} from "../../../../lib/health-client";

export function MedicalReviewSection() {
```

Cambios dentro de la función movida (misma funcionalidad, sin estilos inline: DESIGN.md manda radio 0 y tokens):

1. Sustituye todos los `style={{ … }}` por clases: el contenedor `<section className="admin-panel-card">` (sin `marginTop`), el párrafo descriptivo `className="admin-medical-intro"`, los formularios `className="admin-medical-form"`, cada bloque label+input `className="admin-filter-control admin-medical-field"`, los `input`/`textarea` sin `style` (heredan de `.admin-filter-control input`), el contador `className="admin-medical-count"`. Los `label` conservan `htmlFor` y los textos "Student ID", "Staff Reference Label (max 25 characters)", "Condition Summary (max 1000 characters)" pasan a sentence case: "Staff reference label (max 25 characters)", "Condition summary (max 1000 characters)".
2. Extrae la carga del perfil a una función reutilizable para que "Use" la dispare:

```ts
  async function loadProfile(id: string): Promise<void> {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const profile = await getHealthAdminProfile(id);
      if (profile) {
        setReferenceLabel(profile.staffReferenceLabel ?? "");
        setConditionSummary(profile.conditionSummary ?? "");
        setSuccess(`Loaded medical record for student ${id}.`);
      } else {
        setReferenceLabel("");
        setConditionSummary("");
        setSuccess(`No existing medical profile for student ${id}. You may assign one below.`);
      }
    } catch {
      setError("Unable to load student health record. Check student ID.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLoad(e: FormEvent) {
    e.preventDefault();
    const id = studentId.trim();
    if (id) await loadProfile(id);
  }
```

3. Añade el estado y el bloque "Show all references" al final del `<section>`:

```tsx
  const [references, setReferences] = useState<
    | Readonly<{ status: "hidden" }>
    | Readonly<{ status: "loading" }>
    | Readonly<{ status: "ready"; rows: readonly HealthReferenceRow[] }>
    | Readonly<{ status: "error"; message: string }>
  >({ status: "hidden" });

  async function toggleReferences(): Promise<void> {
    if (references.status === "ready" || references.status === "error") {
      setReferences({ status: "hidden" });
      return;
    }
    setReferences({ status: "loading" });
    try {
      const rows = await listHealthReferences();
      setReferences({ status: "ready", rows });
    } catch (error) {
      setReferences({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to load the reference labels. Please try again.",
      });
    }
  }

  function useReference(row: HealthReferenceRow): void {
    setStudentId(row.studentId);
    void loadProfile(row.studentId);
  }
  …
      <div className="admin-medical-references">
        <button
          className="button button-secondary"
          disabled={references.status === "loading"}
          onClick={() => void toggleReferences()}
          type="button"
        >
          {references.status === "loading"
            ? "Loading references..."
            : references.status === "hidden"
              ? "Show all references"
              : "Hide references"}
        </button>
        {references.status === "error" ? <p className="login-message login-message-error" role="alert">{references.message}</p> : null}
        {references.status === "ready" && references.rows.length === 0 ? <p className="admin-empty-state">No reference labels recorded yet.</p> : null}
        {references.status === "ready" && references.rows.length > 0 ? (
          <table className="admin-medical-table" aria-label="Staff reference labels">
            <thead>
              <tr><th scope="col">Student</th><th scope="col">Reference</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr>
            </thead>
            <tbody>
              {references.rows.map((row) => (
                <tr key={row.studentId}>
                  <td>{row.displayName}</td>
                  <td>{row.staffReferenceLabel}</td>
                  <td>
                    <button aria-label={`Use ${row.studentId}`} className="attendance-action-button" onClick={() => useReference(row)} type="button">
                      Use
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
```

Las filas ya llegan ordenadas por nombre desde el backend; el cliente no reordena. Si `visually-hidden` no existe en `globals.css`, usa `<th scope="col" aria-label="Actions" />`. `attendance-action-button` viene de `attendance.css`: importa `"../../attendance/attendance.css"` en este archivo o define `.admin-medical-table button` con las mismas reglas en `admin.css`; elige lo segundo para no acoplar.

- [ ] **Step 4: Crear `medical/page.tsx`**

```tsx
"use client";

import { AdminSectionHeader } from "../../admin-ui";
import { MedicalReviewSection } from "./medical-review-section";

import "../../admin.css";

export default function MedicalConditionsRoute() {
  return (
    <section className="admin-module-page" aria-labelledby="medical-title">
      <AdminSectionHeader
        description="Declared conditions and the short reference label coaches read on the mat. Health data is only shown to authorised staff and every read is audited."
        eyebrow="People / Medical conditions"
        title="Medical conditions"
      />
      <MedicalReviewSection />
    </section>
  );
}
```

`AdminSectionHeader` renderiza `<h2>`; añade `id="medical-title"` pasando el título por `aria-labelledby` solo si el componente lo admite; si no, usa `aria-label="Medical conditions"` en la `section`.

- [ ] **Step 5: Limpiar `members/page.tsx`**: borra `<MedicalReviewSection />`, la función movida, el import de `health-client` y el import de `FormEvent` si queda sin uso. En la cabecera del directorio (`admin-panel-card-heading` de "Member directory") añade `<Link className="admin-text-link" href="/admin/members/medical">Medical conditions</Link>`.

- [ ] **Step 6: CSS** (tras `.admin-birthday-age`):

```css
.admin-medical-intro {
  color: var(--muted);
  margin: 0 0 1rem;
  max-width: 58rem;
}

.admin-medical-form {
  display: grid;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.admin-medical-field textarea {
  font: inherit;
  min-height: 6rem;
}

.admin-medical-count {
  color: var(--muted);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.admin-medical-references {
  border-top: 1px solid var(--line);
  display: grid;
  gap: 1rem;
  justify-items: start;
  margin-top: 1.5rem;
  padding-top: 1.25rem;
}

.admin-medical-table {
  border-collapse: collapse;
  width: 100%;
}

.admin-medical-table th,
.admin-medical-table td {
  border-bottom: 1px solid var(--line);
  padding: 0.6rem 0.5rem;
  text-align: left;
}

.admin-medical-table th {
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.admin-medical-table button {
  background: var(--gi-white);
  border: 1px solid var(--mat-ink);
  cursor: pointer;
  font: inherit;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  min-height: 2.75rem;
  padding: 0.55rem 0.8rem;
  text-transform: uppercase;
}

.admin-medical-table button:hover,
.admin-medical-table button:focus-visible {
  background: var(--bpt-purple);
  border-color: var(--bpt-purple);
  color: var(--gi-white);
}
```

Comprueba que `.admin-filter-control input` ya define fondo blanco, borde `1px solid var(--line)` y radio 0 (si no, añade `.admin-medical-field input, .admin-medical-field textarea { border: 1px solid var(--line); border-radius: 0; min-height: 3rem; padding: 0.5rem 0.7rem; width: 100%; }`).

- [ ] **Step 7: Ejecutar tests de members y medical, lint, formato, typecheck**

```bash
corepack pnpm vitest run --project web apps/web/src/app/admin/members && corepack pnpm eslint apps/web/src/app/admin/members --max-warnings 0 && corepack pnpm prettier --write apps/web/src/app/admin/members apps/web/src/app/admin/admin.css && corepack pnpm --filter @bpt-jersey/web typecheck
```

Expected: PASS. Si `members/page.test.tsx` mockeaba `health-client`, quita ese mock (ya no se importa).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/admin/members apps/web/src/app/admin/admin.css && git commit -m "feat(admin): medical conditions route with show-all-references"
```

---

### Task 18: ADR-010 y ledger

**Files:**
- Create: `docs/adr/ADR-010-coach-office-powers.md`
- Modify: `tasksv2.md` (sección `## V2-E`, añadir filas)

- [ ] **Step 1: Escribir el ADR**

```markdown
# ADR-010: los coaches comparten con la oficina el panel operativo

Fecha: 2026-09-12
Estado: aceptada (decisión del operador en chat, 2026-09-12)

## Contexto

El panel `/admin` restringía a `coach` a Attendance y a `headCoach` a Attendance + Classes. Los
coaches piden ver el Overview del día (con cumpleaños), operar la asistencia por clase, ver la cola
de inscripción y mantener la etiqueta de referencia médica de 25 caracteres. Los callables detrás
de cada pantalla estaban limitados a `owner | administrator`.

## Decisión

Se abre a `headCoach` y `coach`:

- `getOperationalReport` (conteos: clases, asistencia pendiente, membresías vencidas; nunca importes).
- `listEnrolmentRequests` y `returnEnrolmentRequest` (ver la cola y devolver con nota).
- `saveHealthProfile` (guardar la etiqueta de referencia) y el nuevo `listHealthReferences`.
- Rutas `/admin`, `/admin/attendance`, `/admin/members/requests`, `/admin/members/medical`
  (`apps/web/src/app/admin/admin-routes.ts`).

No se abre:

- `getEnrolmentRequestDetail` ni `approveEnrolmentRequest`: siguen detrás de
  `requireCanonicalMemberDirectoryActor` y de los cerrojos de ADR-009 (lector, aprobador, familias,
  escritor canónico). Se evaluó abrirlos y se descartó el 2026-09-12 por su coste y por lo que
  protegen.
- El directorio de miembros, finanzas, staff, retención, `deactivateHealthProfile` y
  `reviewHealthProfileChangeRequest`.

## Consecuencias

- Cada acción del coach queda auditada con su `actorId`, como ya ocurre para la oficina.
- Un coach ve el número de membresías vencidas; no ve importes ni facturas.
- Ocultar botones en el cliente no es el control: la autorización se repite en cada callable, y
  los tests de callables fijan qué rol pasa y cuál no.
- Si en el futuro se abre la aprobación a coaches, hará falta una sonda de cuenta activa para staff
  equivalente a la de `canonical-actor.ts` y una enmienda a ADR-009.
```

- [ ] **Step 2: Añadir filas al ledger** (tabla `## V2-E`, tras `T026V2`; ajusta la numeración si ya hay filas T027V2+):

```markdown
| T027V2 | Overview sin barra de atajos ni conteo de miembros; tres próximos cumpleaños y aviso del día | - | en curso | Pedido por el operador el 2026-09-12. Spec `docs/superpowers/specs/2026-09-12-admin-coach-operations-design.md`, plan `docs/superpowers/plans/2026-09-12-admin-coach-operations.md`. Ventana de cumpleaños a 366 días. Evidencia al cerrar: tests web `overview-page.test.tsx`, Playwright `admin-overview-birthdays.spec.ts`. |
| T028V2 | Attendance como lista por clase con etiquetas Ready/Booked/Late y botón Clock in | T027V2 | en curso | Cubre la parte "seleccionar de la lista quién está y quién no" de T014V2; el umbral de tarde pasa a 0 min (`determinePunctuality`). No cubre T015V2 (vencimiento a 20 min): sigue pendiente. Evidencia: `session-roster.test.tsx`, `attendance/page.test.tsx`, Playwright `attendance-roster.spec.ts`. |
| T029V2 | Enrolment requests: ayuda por botón, verificación contra emuladores y acceso del coach a cola y devolución | T012V2 | en curso | Detalle y aprobación siguen siendo de oficina (ADR-010). Evidencia: `requests/page.test.tsx`, `enrolment-request-callables.test.ts`, spec T121 contra emuladores con caso coach, Playwright `enrolment-requests-ui.spec.ts`. |
| T030V2 | Medical conditions en su ruta con "Show all references" | - | en curso | Nuevo callable `listHealthReferences` (nombre + etiqueta, nunca el resumen). Nota: todos los callables de salud exigen `BPT_SYNTHETIC_PILOT=true`; si producción no lo define, la sección falla hoy igual que ayer. Evidencia: `medical/page.test.tsx`, `health-callables.test.ts`, Playwright `medical-references.spec.ts`. |
| T031V2 | Menú sin Memberships ni Waivers; coach y head coach ven Overview, Attendance, Enrolment requests y Medical conditions | - | en curso | ADR-010. Rutas y tests de Memberships/Waivers se conservan. Evidencia: `admin-routes.test.ts`, `page.test.tsx`, Playwright `admin-shell.spec.ts` (caso coach). |
```

- [ ] **Step 3: Commit**

```bash
git add docs/adr/ADR-010-coach-office-powers.md tasksv2.md && git commit -m "docs(admin): ADR-010 coach office powers and ledger rows T027V2-T031V2"
```

---

### Task 19: Playwright de UI (sesión sintética, callables interceptados)

**Files:**
- Create: `qa/tests/admin-fixture.ts` (helper compartido)
- Modify: `qa/tests/admin-shell.spec.ts:1-100, 150-160`
- Create: `qa/tests/admin-overview-birthdays.spec.ts`, `qa/tests/attendance-roster.spec.ts`, `qa/tests/enrolment-requests-ui.spec.ts`, `qa/tests/medical-references.spec.ts`

**Interfaces:**
- Produces: `installAdminFixture(page, { role?, callables? })` donde `callables` es `Record<string, unknown>` nombre de callable → cuerpo JSON de `data`.

- [ ] **Step 1: Crear el helper `qa/tests/admin-fixture.ts`** extrayendo el patrón de `admin-shell.spec.ts`:

```ts
import type { Page, Route } from "@playwright/test";

export type AdminTestRole = "owner" | "administrator" | "headCoach" | "coach";

const emptyReport = {
  students: { totalStudents: 0, activeStudents: 0, inactiveStudents: 0, suspendedStudents: 0, activeAdults: 0, activeMinors: 0, activeTown: 0, activeWest: 0 },
  attendance: { totalRecords: 0, checkedIn: 0, attended: 0, late: 0, absent: 0, noShow: 0, excused: 0, attendanceRatePercentage: 0 },
  memberships: { currentMemberships: 0, trial: 0, active: 0, paused: 0, overdue: 0, cancelled: 0 },
  revenue: { currency: "GBP", issuedMinor: 0, receivedMinor: 0, outstandingMinor: 0, invoiceCount: 0, openInvoiceCount: 0, partiallyPaidInvoiceCount: 0, paidInvoiceCount: 0, voidedInvoiceCount: 0, paymentCount: 0, paymentsByMethod: { cash: 0, bankTransfer: 0, other: 0 } },
  calculatedAt: "2026-08-24T20:00:00.000Z",
};

export type CallableResponder = (body: unknown) => unknown;

/**
 * The static export is served without Firebase: every callable is answered here. `callables` maps
 * a callable name to the `data` it returns (or a function of the request body). Unlisted callables
 * get 404 so a page that quietly depends on one fails loudly.
 */
export async function installAdminFixture(
  page: Page,
  options: { role?: AdminTestRole; callables?: Record<string, unknown | CallableResponder>; calls?: Array<{ name: string; body: unknown }> } = {},
): Promise<void> {
  const role = options.role ?? "owner";
  const callables: Record<string, unknown | CallableResponder> = {
    getDailyOperationsDashboard: (body: unknown) => ({
      dashboard: { query: (body as { data: unknown }).data, sessions: [], refreshedAt: "2026-08-24T20:00:00.000Z" },
    }),
    getOperationalReport: (body: unknown) => ({ report: { query: (body as { data: unknown }).data, ...emptyReport } }),
    listUpcomingBirthdays: { birthdays: [] },
    ...options.callables,
  };

  await page.route("**/*", async (route: Route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.split("/").pop() ?? "";
    if (route.request().method() === "POST" && name in callables) {
      const body = route.request().postDataJSON() as unknown;
      options.calls?.push({ name, body });
      const responder = callables[name];
      const data = typeof responder === "function" ? (responder as CallableResponder)(body) : responder;
      await route.fulfill({ body: JSON.stringify({ data }), contentType: "application/json", status: 200 });
      return;
    }
    if (url.pathname.startsWith("/admin")) {
      if (!url.pathname.endsWith(".html") && !url.pathname.includes(".")) url.pathname = `${url.pathname.replace(/\/$/, "")}.html`;
      url.searchParams.set("adminTestRole", role);
      await route.continue({ url: url.toString() });
      return;
    }
    await route.continue();
  });
}
```

Reescribe `installAdminFixture` de `admin-shell.spec.ts` como `import { installAdminFixture } from "./admin-fixture";` y elimina la copia local. En el test del shell, sustituye la expectativa de `"Add new member"` por:

```ts
    await expect(page.getByRole("link", { name: "Add new member" })).toHaveCount(0);
    await expect(page.getByLabel("Quick actions")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Next birthdays" })).toBeVisible();
```

y las dos navegaciones `page.goto("/admin?adminTestRole=owner")` quedan igual (el fixture fuerza el rol). Añade un test:

```ts
  test("shows a coach the four mat modules and nothing else", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium");
    await installAdminFixture(page, { role: "coach" });
    await page.goto("/admin?adminTestRole=coach");
    const navigation = page.locator(".admin-desktop-navigation");
    await expect(navigation.getByRole("link")).toHaveText(["->Overview", "->Attendance", "->Enrolment requests", "->Medical conditions"]);
    await expect(page.getByRole("link", { name: "Coach portal" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today's academy view", level: 2 })).toBeVisible();
  });
```

- [ ] **Step 2: `admin-overview-birthdays.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

import { installAdminFixture } from "./admin-fixture";

test.describe("admin overview birthdays", () => {
  test("lists the next three birthdays and announces one that is today", async ({ page }) => {
    await installAdminFixture(page, {
      callables: {
        listUpcomingBirthdays: {
          birthdays: [
            { studentId: "s-1", displayName: "Ana Coelho", daysAway: 0, turningAge: 30, participantType: "adult", trainingCenter: "Town" },
            { studentId: "s-2", displayName: "Ben Kid", daysAway: 3, turningAge: 9, participantType: "minor", trainingCenter: "West" },
            { studentId: "s-3", displayName: "Cara Lima", daysAway: 40, turningAge: 41, participantType: "adult", trainingCenter: "Town" },
            { studentId: "s-4", displayName: "Dan Extra", daysAway: 90, turningAge: 22, participantType: "adult", trainingCenter: "Town" },
          ],
        },
      },
    });
    await page.goto("/admin?adminTestRole=owner");

    const band = page.getByRole("status", { name: "Birthday today" });
    await expect(band).toContainText("Ana Coelho turns 30 today");
    const card = page.getByRole("region", { name: "Next birthdays" });
    await expect(card.getByRole("listitem")).toHaveCount(3);
    await expect(card).not.toContainText("Dan Extra");
    await expect(card.getByRole("listitem").nth(0)).toContainText("Today");
    await expect(card.getByRole("listitem").nth(1)).toContainText(/\w{3} \d{1,2} \w{3}/);
    await expect(page.getByRole("article", { name: /Members$/ })).toHaveCount(0);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/19\d\d-|\b(19|20)\d\d\b/);
  });
});
```

(El último `expect` vigila que ningún año de nacimiento llegue a la pantalla; si el pie o la cabecera imprimen un año, acota la búsqueda a `card` y `band`.)

- [ ] **Step 3: `attendance-roster.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

import { installAdminFixture } from "./admin-fixture";

const session = {
  sessionId: "session-1", academyId: "synthetic-academy", classId: "class-1", programId: "program-1", locationId: "town",
  instructorId: "coach-miro", title: "Adults Gi", startAt: "2026-09-12T18:00:00.000Z", endAt: "2026-09-12T19:00:00.000Z",
  capacity: 20, minParticipants: 4, status: "scheduled", isSeminar: false, cancellationReason: null, schemaVersion: "1",
  createdAt: "2026-09-01T10:00:00.000Z", createdBy: "admin-1", updatedAt: "2026-09-01T10:00:00.000Z", updatedBy: "admin-1",
};
const attendee = (studentId: string, displayName: string, status: string | null) => ({
  studentId, displayName, source: "booked", status, attendedCount: 0, comparableSessionCount: 0, lastAttendedAt: null,
});
const view = (pendingStatus: string) => ({
  session,
  attendees: [attendee("s-ready", "Ana Ready", "attended"), attendee("s-booked", "Ben Booked", pendingStatus)],
  evidence: { open: true, windowDays: 56, bookedCount: 2, suggestedCount: 0, comparableSessionCount: 0 },
});
const operational = {
  session,
  summary: { capacity: 20, minParticipants: 4, quorumMet: false, totalBookings: 2, totalCheckedIn: 1, totalCheckedOut: 0, totalNoShows: 0, totalPendingArrival: 1 },
  roster: [],
};

test.describe("attendance roster", () => {
  test("turns a booked member red at the start time and green after a clock-in", async ({ page }) => {
    let pendingStatus = "booked_not_arrived";
    const calls: Array<{ name: string; body: unknown }> = [];
    await page.clock.install({ time: new Date("2026-09-12T17:58:00.000Z") });
    await installAdminFixture(page, {
      calls,
      callables: {
        listSessions: { sessions: [session] },
        getSessionOperationalView: { view: operational },
        getPreClassView: () => ({ view: view(pendingStatus) }),
        checkIn: () => {
          pendingStatus = "late";
          return { attendance: { attendanceId: "session-1__s-booked", academyId: "synthetic-academy", sessionId: "session-1", studentId: "s-booked", method: "manual", state: "late", occurredAt: "2026-09-12T18:01:00.000Z", notes: null, correctionOf: null, schemaVersion: "1", createdAt: "2026-09-12T18:01:00.000Z", createdBy: "u", updatedAt: "2026-09-12T18:01:00.000Z", updatedBy: "u" } };
        },
      },
    });
    await page.goto("/admin/attendance?adminTestRole=coach");

    await expect(page.getByRole("heading", { name: "Adults Gi · Coach coach-miro" })).toBeVisible();
    const row = page.getByRole("list", { name: "Adults Gi roster" }).getByRole("listitem").filter({ hasText: "Ben Booked" });
    await expect(row.locator(".attendance-tag")).toHaveText("Booked");

    await page.clock.runFor(3 * 60_000);
    await expect(row.locator(".attendance-tag")).toHaveText("Late");

    await row.getByRole("button", { name: "Clock in Ben Booked" }).click();
    await expect(row.locator(".attendance-tag")).toHaveText("Ready");
    const checkIn = calls.find((call) => call.name === "checkIn");
    expect(checkIn?.body).toEqual({ data: { sessionId: "session-1", studentId: "s-booked", method: "manual" } });
    await expect(page.getByRole("status").filter({ hasText: "Clock-in recorded for Ben Booked." })).toBeVisible();
  });
});
```

Comprueba en `schedule-client.ts` (`listSessions`, `getSessionOperationalView`, `recordCheckIn`) la forma exacta del `data` que cada uno espera (`{ sessions }`, `{ view }`, `{ attendance }` o el registro directo) y ajusta los cuerpos del fixture a esa forma antes de ejecutar. `page.clock.install` congela el reloj que la página lee con `Date.now()`; `runFor` avanza también los `setInterval`.

- [ ] **Step 4: `enrolment-requests-ui.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

import { installAdminFixture } from "./admin-fixture";

const waiting = { enrolmentRequestId: "enrolment-1", applicantName: "Alex Adult", applicantIsStudent: true, minorCount: 0, trainingCenter: "Town", status: "submitted", submittedAt: "2026-09-06T10:00:00.000Z" };
const detail = {
  enrolmentRequestId: "enrolment-1", status: "submitted", applicantIsStudent: true,
  applicant: { fullName: "Alex Adult", dateOfBirth: "1991-03-04", phoneNumber: "+441534000122", trainingCenter: "Town", trainingTimePreferences: ["evening"], postalAddress: { line: "2 Synthetic Lane", postCode: "JE2 4XY" } },
  minors: [], submittedBy: "client-1", submittedAt: "2026-09-06T10:00:00.000Z",
};

test.describe("enrolment requests", () => {
  test("office reads, sends back and approves through the three buttons", async ({ page }) => {
    const calls: Array<{ name: string; body: unknown }> = [];
    await installAdminFixture(page, {
      calls,
      callables: {
        listEnrolmentRequests: { requests: [waiting], truncated: false },
        getEnrolmentRequestDetail: { detail },
        returnEnrolmentRequest: { request: { ...waiting, status: "returned" } },
        approveEnrolmentRequest: { outcome: { alreadyApproved: false, role: "adultStudent", studentIds: ["student-1"] } },
      },
    });
    await page.goto("/admin/members/requests?adminTestRole=owner");

    await expect(page.getByRole("region", { name: "What the buttons do" })).toContainText("Approve and enrol");
    const approve = page.getByRole("button", { name: "Approve and enrol" });
    await expect(approve).toBeDisabled();
    await page.getByRole("button", { name: "Read the full request" }).click();
    await expect(page.getByText("1991-03-04")).toBeVisible();
    await expect(approve).toBeEnabled();

    await page.getByLabel("What needs to change").fill("Add the emergency contact.");
    await page.getByRole("button", { name: "Send back to applicant" }).click();
    await expect(page.getByRole("status")).toContainText("Sent back to Alex Adult.");
    expect(calls.find((c) => c.name === "returnEnrolmentRequest")?.body).toEqual({
      data: { enrolmentRequestId: "enrolment-1", note: "Add the emergency contact." },
    });
  });

  test("a coach sees the queue without the office buttons", async ({ page }) => {
    await installAdminFixture(page, { role: "coach", callables: { listEnrolmentRequests: { requests: [waiting], truncated: false } } });
    await page.goto("/admin/members/requests?adminTestRole=coach");
    await expect(page.getByText("Alex Adult")).toBeVisible();
    await expect(page.getByRole("button", { name: "Read the full request" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve and enrol" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send back to applicant" })).toBeVisible();
  });
});
```

Ajusta los cuerpos (`{ detail }`, `{ request }`, `{ outcome }`) a lo que `enrolment-client.ts` parsea realmente (léelo: líneas 152-290). Como una devolución cambia el estado a `returned` y la fila deja de ser "returnable", el test hace primero la lectura y después la devolución; la aprobación se cubre en unit (`page.test.tsx`, "enrols the applicant") y en emuladores (Task 20).

- [ ] **Step 5: `medical-references.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

import { installAdminFixture } from "./admin-fixture";

test.describe("medical references", () => {
  test("shows every reference label on demand and fills the lookup", async ({ page }) => {
    await installAdminFixture(page, {
      role: "coach",
      callables: {
        listHealthReferences: { references: [
          { studentId: "student-1", displayName: "Ana Coelho", staffReferenceLabel: "ASTHMA-INHALER" },
          { studentId: "student-2", displayName: "Ben Kid", staffReferenceLabel: "KNEE-BRACE" },
        ] },
        getHealthProfile: { healthProfileId: "student-1", academyId: "synthetic-academy", studentId: "student-1", minimumOperationalSupport: ["none"], conditionSummary: null, staffReferenceLabel: "ASTHMA-INHALER", reviewState: "current", expiresAt: null, status: "active", schemaVersion: "1", createdAt: "2026-08-24T12:00:00Z", createdBy: "u", updatedAt: "2026-08-24T12:00:00Z", updatedBy: "u", pendingChangeRequest: null },
      },
    });
    await page.goto("/admin/members/medical?adminTestRole=coach");

    await page.getByRole("button", { name: "Show all references" }).click();
    const table = page.getByRole("table", { name: "Staff reference labels" });
    await expect(table.getByRole("row")).toHaveCount(3);
    await expect(table).toContainText("ASTHMA-INHALER");
    await page.getByRole("button", { name: "Use student-1" }).click();
    await expect(page.getByLabel("Student ID")).toHaveValue("student-1");
    await expect(page.getByLabel(/Staff reference label/)).toHaveValue("ASTHMA-INHALER");
  });
});
```

Ajusta el cuerpo de `getHealthProfile` a lo que `parseAdminProjection` de `health-client.ts` exige (campos exactos).

- [ ] **Step 6: Construir el export sintético y ejecutar los specs**

```bash
cd /root/BPT-Jersey && NEXT_PUBLIC_ADMIN_E2E=true corepack pnpm --filter @bpt-jersey/web build && NEXT_PUBLIC_ADMIN_E2E=true corepack pnpm --dir qa test:e2e -- --project desktop-chromium --project mobile-chromium admin-shell admin-overview-birthdays attendance-roster enrolment-requests-ui medical-references
```

Expected: todos PASS en ambos proyectos (el runner sirve `apps/web/out` en `127.0.0.1:3100`). Si `run-e2e.mjs` no acepta filtros posicionales, usa `--grep "admin shell|birthdays|attendance roster|enrolment requests|medical references"`.

- [ ] **Step 7: Commit**

```bash
git add qa/tests && git commit -m "test(admin): playwright for overview birthdays, attendance roster, enrolment buttons, medical references and coach menu"
```

---

### Task 20: Verificación contra emuladores (T121 + caso coach)

**Files:**
- Modify: `qa/tests/enrolment-approval-auth-emulator.spec.ts` (añadir un test)
- Modify: `qa/scripts/seed-enrolment-applicants-emulator.mjs` o el runner `qa/scripts/run-member-directory-e2e.mjs` si hace falta sembrar un usuario `coach` (claims `{ academyId, role: "coach" }`)

Requiere JDK 21 (Task 0, Step 3), `node apps/functions/scripts/build-deploy-artifact.mjs`, `.firebase-functions/.secret.local` con los seis secretos sintéticos y las variables descritas en `docs/development/firebase-emulators.md` §T093.

- [ ] **Step 1: Añadir el test** al `describe` de T121 (usa los helpers `signIn`, `callable`, `syntheticAppCheckToken` del propio archivo; mira el test "refuses the office doors…" para la forma de las llamadas):

```ts
  test("a coach reads the queue and sends a request back, and is refused the detail and the approval @critical", async ({ request }) => {
    const coach = await signIn(request, process.env.T121_COACH_EMAIL);
    const queue = await callable(request, "listEnrolmentRequests", null, coach);
    expect(queue.error).toBeUndefined();
    const [first] = (queue.result as { requests: Array<{ enrolmentRequestId: string }> }).requests;
    expect(first).toBeDefined();

    const detail = await callable(request, "getEnrolmentRequestDetail", { enrolmentRequestId: first.enrolmentRequestId }, coach);
    expect(detail.error?.status).toBe("PERMISSION_DENIED");
    const approval = await callable(request, "approveEnrolmentRequest", { enrolmentRequestId: first.enrolmentRequestId, requestId: randomUUID() }, coach);
    expect(approval.error?.status).toBe("PERMISSION_DENIED");

    const returned = await callable(request, "returnEnrolmentRequest", { enrolmentRequestId: first.enrolmentRequestId, note: "Coach: add the emergency contact." }, coach);
    expect(returned.error).toBeUndefined();
    expect((returned.result as { status: string }).status).toBe("returned");
  });
```

Siembra el usuario coach donde el runner siembra al owner (mismo mecanismo: `accounts:signUp` + `accounts:update` con `customAttributes: JSON.stringify({ academyId, role: "coach" })`), leyendo `T121_COACH_EMAIL` y la misma contraseña que `T121_APPLICANT_PASSWORD`. Añade `T121_COACH_EMAIL` a la lista de variables de `qa/run-e2e.mjs`. Elige como objetivo una solicitud que ninguno de los otros tests apruebe (siembra una tercera, p. ej. `t121-coach-target@example.test`).

- [ ] **Step 2: Ejecutar** (📍 esta máquina, raíz del repo, con los secretos exportados como documenta `docs/development/firebase-emulators.md`):

```bash
export FUNCTIONS_DISCOVERY_TIMEOUT=300000 BPT_SYNTHETIC_PILOT=true
node apps/functions/scripts/build-deploy-artifact.mjs
# rewrite .firebase-functions/.secret.local here (the build deletes it)
T093_MEMBER_DIRECTORY_EMULATOR_E2E=true GCLOUD_PROJECT=demo-bpt-jersey T093_E2E_ACADEMY_ID=t093-e2e-academy \
AUTH_EMULATOR_E2E_EMAIL=t093-owner@example.test AUTH_EMULATOR_E2E_PASSWORD=<12+ chars> \
T121_APPLICANT_PASSWORD=<12+ chars> T121_COACH_EMAIL=t121-coach@example.test \
corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions "node qa/scripts/run-member-directory-e2e.mjs"
```

Expected: T093 y T121 en verde, incluido el caso nuevo. Anota en `tasksv2.md` (fila T029V2) el resultado literal (`N passed`) y la fecha. Si esta máquina no puede correrlo (sin JDK), anótalo como **no ejecutado aquí** con el comando exacto; no lo des por hecho.

- [ ] **Step 3: Commit**

```bash
git add qa && git commit -m "test(enrolment): emulator case for a coach reading the queue and sending back"
```

---

### Task 21: Cierre: `verify:mvp`, evidencia y estado del ledger

- [ ] **Step 1: Puerta completa**

```bash
cd /root/BPT-Jersey && export FUNCTIONS_DISCOVERY_TIMEOUT=300000 && corepack pnpm verify:mvp
```

Expected: `format:check`, `lint`, `typecheck`, `build`, `test:unit`, `test:rules`, `build:e2e-synthetic`, `test:load:synthetic`, `test:e2e:smoke` en verde. `test:rules` necesita el JDK (Task 0). Si un paso falla, arréglalo en el commit de la tarea que lo causó (no en un "fix misc").

- [ ] **Step 2: Actualizar el ledger**: en cada fila T027V2..T031V2 cambia `en curso` por `revision` y pega en "Evidencia de salida" la salida resumida (nombre del comando, `N passed`, duración) de: vitest web + node, Playwright (Task 19), emuladores (Task 20 o "no ejecutado aquí: sin JDK"), `verify:mvp`.

- [ ] **Step 3: Diff final sin ruido**

```bash
git status --short && git diff --stat main..HEAD
```

Expected: solo archivos de este plan. Los cambios preexistentes sin commitear de la rama (`apps/web/next.config.ts`, `apps/web/src/lib/firebase-client.ts`, `AGENTS.md` borrado, `.codex/`, `Assets/`, `deploy/`, `CLAUDE.md`, `docs/roadmap/…`) **no** se tocan ni se commitean: no son de este trabajo.

- [ ] **Step 4: Commit del ledger**

```bash
git add tasksv2.md && git commit -m "docs(ledger): evidence for T027V2-T031V2 (admin coach operations)"
```

- [ ] **Step 5: Entregar**: sin push ni deploy. Informa al operador de la rama, los commits, qué se ejecutó y qué no (JDK), y la nota de `BPT_SYNTHETIC_PILOT` para Medical en producción.
