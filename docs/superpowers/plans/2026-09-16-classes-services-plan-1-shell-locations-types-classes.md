# Classes / Services — Plan 1: cáscara, Locations, Types y Classes & Services 2.0

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar `/admin/classes-services` con sus nueve pestañas y las tres primeras funcionando (Locations dinámicas, Class / Service Types v2 y el mapa de clases 2.0 con calendario, lista, panel de sesión, inscripciones, copiar y eliminar semana), sustituyendo `/admin/classes`.

**Architecture:** Un único módulo de dominio nuevo `@bpt-jersey/domain/schedule/classes-services` (contratos y parsers puros) amplía de forma aditiva `LocationRecord`, `ProgramRecord` y `SessionRecord`; `LocationId` pasa de unión literal a `string`. El `ScheduleStore` existente gana `createLocation`, `updateLocation`, `updateProgram` v2, `previewWeek`, `copyWeek` y `deleteWeek` (Firestore + memoria). Seis callables nuevas (`saveLocation`, `updateLocation`, `updateProgram`, `previewWeek`, `copyWeek`, `deleteWeek`) siguen el patrón `create<Nombre>Handler` de `schedule-callables.ts`. La web añade `apps/web/src/app/admin/classes-services/` con un `layout.tsx` de pestañas y una página por pestaña; `/admin/classes` redirige.

**Tech Stack:** TypeScript strict, pnpm por Corepack, Vitest (proyectos `web` jsdom y `node`), Firebase Functions v2 `onCall`, Firestore, Next.js 16 `output: "export"`, React 19, Playwright 1.61 (`qa/tests`), CSS propio (DESIGN.md).

**Spec:** `docs/superpowers/specs/2026-09-16-regyfit-classes-services-clone-design.md` (decisiones 1–6, 14, 19) y evidencia `docs/data/migrations/regyfit/classes-services-inventory.md` (§1–§3).

## Global Constraints

- Node `>=22.13 <25`; todos los comandos `corepack pnpm <script>` desde la raíz; nunca instalar pnpm ni firebase-tools globales.
- `packages/domain` nunca importa Firebase.
- Nunca desplegar a producción, ni migración destructiva, ni gasto de API de pago sin confirmación del operador en chat.
- Interfaz en inglés británico, voz sencilla de academia; documentación técnica en español.
- DESIGN.md: radio 0, sin gradientes, sin blur, sin emojis ni iconos decorativos, un solo morado `#2F2483`, estado = texto + regla izquierda; los colores de tipo de clase son datos y solo pintan la tarjeta del calendario y el swatch de la tabla de tipos.
- Coaches (`coach`, `headCoach`): Locations, Types y Classes & Services 2.0 en solo lectura para `coach`; `headCoach` con poderes de admin (ADR-010 y su enmienda del 2026-09-14). El resto de pestañas no aparece para staff.
- Nada se borra: sedes y tipos se desactivan; sesiones se cancelan con motivo.
- Todo cambio de reglas o índices de Firestore va en el mismo commit que la consulta que lo necesita.
- `tasksv2.md`: fila T046V2; no ejecutar prettier sobre `tasksv2.md`.
- Commits pequeños con mensaje convencional y el pie `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Rama de trabajo: `feature/classes-services-clone` creada desde la cabeza actual de `feature/admin-classes-billing-levels` (decisión 19).

---

## Mapa de ficheros

| Acción | Fichero | Responsabilidad |
| ------ | ------- | --------------- |
| Crear | `packages/domain/src/schedule/classes-services-contracts.ts` | Tipos y parsers: `LocationKind`, `CreateLocationInput`, `UpdateLocationInput`, `ProgramKind`, `DropInPolicy`, `CreateProgramInputV2`, `UpdateProgramInput`, `SessionBookingRules`, `WaitingListMode`, `WeekRange`, `CopyWeekInput`, `DeleteWeekInput`, `WeekPreview`, helpers `weekRangeFor`, `shiftIso`, `slugifyLocationId`. |
| Crear | `packages/domain/src/schedule/classes-services-contracts.test.ts` | Pruebas puras de los parsers y helpers. |
| Modificar | `packages/domain/src/schedule/schedule-contracts.ts` | `LocationId = string`; `LocationRecord` (+`abbreviation?`, `kind?`); `ProgramRecord` (+campos v2 opcionales); `SessionRecord`/`CreateSessionInput`/`UpdateSessionInput` (+`instructorIds?`, `capacity: number \| null`, `bookingRules?`, `waitingList?`); parsers de sesión y geocerca aceptan cualquier id de sede no vacío. |
| Modificar | `packages/domain/package.json` | Subpath `./schedule/classes-services`. |
| Modificar | `apps/functions/src/deploy-runtime.ts` | Reescritura del subpath nuevo en el artefacto de despliegue. |
| Modificar | `apps/functions/src/schedule/schedule-service.ts` | `ScheduleStore` + implementación Firestore y memoria de `createLocation`, `updateLocation`, `createProgram` v2, `updateProgram` v2, `previewWeek`, `copyWeek`, `deleteWeek`; `createSession`/`updateSession` persisten los campos nuevos. |
| Modificar | `apps/functions/src/schedule/booking-transaction-service.ts` | La comprobación de aforo respeta `capacity: null` (ilimitado). |
| Modificar | `apps/functions/src/schedule/schedule-callables.ts` | Seis handlers y `onCall` nuevos; `saveProgram` acepta v2. |
| Modificar | `apps/functions/src/schedule/schedule-callables.test.ts` | Pruebas de los handlers nuevos. |
| Modificar | `apps/functions/src/index.ts` | Reexporta las seis callables. |
| Modificar | `apps/web/src/lib/schedule-client.ts` | Seis funciones cliente con parseo zod. |
| Crear | `apps/web/src/app/admin/classes-services/layout.tsx` | Cáscara: eyebrow, título, barra de pestañas (`role="tablist"` con enlaces), gate de rol. |
| Crear | `apps/web/src/app/admin/classes-services/classes-services-tabs.ts` | Lista de pestañas (etiqueta, ruta, roles que la ven). |
| Crear | `apps/web/src/app/admin/classes-services/classes-services.css` | Estilos de la cáscara, tablas editables, calendario y paneles. |
| Crear | `apps/web/src/app/admin/classes-services/page.tsx` | Redirige a `./classes`. |
| Crear | `apps/web/src/app/admin/classes-services/locations/page.tsx` (+ `.test.tsx`) | Pestaña Locations. |
| Crear | `apps/web/src/app/admin/classes-services/types/page.tsx` (+ `.test.tsx`) | Pestaña Class / Service Types. |
| Crear | `apps/web/src/app/admin/classes-services/classes/page.tsx` (+ `.test.tsx`) | Pestaña Classes & Services 2.0: estado, carga, filtros, contadores. |
| Crear | `apps/web/src/app/admin/classes-services/classes/week-grid.ts` (+ `.test.ts`) | Cálculo puro de la rejilla semanal (columnas, filas, solapes). |
| Crear | `apps/web/src/app/admin/classes-services/classes/calendar-view.tsx` | Vistas semana / mes / día. |
| Crear | `apps/web/src/app/admin/classes-services/classes/list-view.tsx` | Vista lista con filtros y CSV. |
| Crear | `apps/web/src/app/admin/classes-services/classes/session-panel.tsx` (+ `.test.tsx`) | Crear / editar / copiar / eliminar sesión. |
| Crear | `apps/web/src/app/admin/classes-services/classes/registrations-panel.tsx` (+ `.test.tsx`) | Inscripciones MEMBER / GROUP / EXTERNAL. |
| Crear | `apps/web/src/app/admin/classes-services/classes/week-actions.tsx` (+ `.test.tsx`) | Copiar semana y eliminar semana con vista previa. |
| Crear | `apps/web/src/app/admin/classes-services/{memberships,bulk,reports,drop-ins,options,history}/page.tsx` | Marcadores "Coming in the next release" (Planes 2 y 3). |
| Modificar | `apps/web/src/app/admin/classes/page.tsx` | Redirección a `/admin/classes-services/classes`. |
| Modificar | `apps/web/src/app/admin/admin-shell.tsx`, `admin-routes.ts` (+ tests) | Menú "Classes / Services"; rutas de coach. |
| Crear | `qa/tests/admin-classes-services.spec.ts` | Playwright de las tres pestañas, escritorio y móvil, con capturas `qa/screenshots/cs-*.png`. |
| Modificar | `qa/rules/schedule-boundary.test.ts` | Las colecciones siguen cerradas al acceso directo. |
| Modificar | `tasksv2.md`, `docs/adr/ADR-010-coach-office-powers.md` (una línea) | Evidencia y rutas de coach. |

---

### Task 0: Rama de trabajo

**Files:** ninguno.

- [ ] **Step 1: Crear la rama desde la cabeza actual**

```bash
cd /root/BPT-Jersey
git status --short          # solo deben aparecer tasksv2.md, la spec y el inventario (y las carpetas no trazadas .impeccable/, Assets/, docs/audits/)
git checkout -b feature/classes-services-clone
git add docs/superpowers/specs/2026-09-16-regyfit-classes-services-clone-design.md docs/data/migrations/regyfit/classes-services-inventory.md docs/superpowers/plans/2026-09-16-classes-services-plan-1-shell-locations-types-classes.md tasksv2.md
git commit -m "docs(classes-services): spec, inventario saneado de Regyfit y plan 1

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Esperado: `git branch --show-current` imprime `feature/classes-services-clone`.

---

### Task 1: Contratos `classes-services` en el dominio

**Files:**
- Create: `packages/domain/src/schedule/classes-services-contracts.ts`
- Create: `packages/domain/src/schedule/classes-services-contracts.test.ts`
- Modify: `packages/domain/package.json` (bloque `exports`, junto a `"./schedule/advanced-booking"`)
- Modify: `apps/functions/src/deploy-runtime.ts:39-45`

**Interfaces:**
- Produces (todo exportado desde `@bpt-jersey/domain/schedule/classes-services`):
  - `locationKinds = ["presential","zoom","jitsi"]`, `type LocationKind`.
  - `type CreateLocationInput = { name: string; abbreviation: string; kind: LocationKind }`, `parseCreateLocationInput(input: unknown): Result<CreateLocationInput, string>`.
  - `type UpdateLocationInput = { locationId: string; name?: string; abbreviation?: string; kind?: LocationKind; active?: boolean }`, `parseUpdateLocationInput`.
  - `slugifyLocationId(name: string): string` (minúsculas, `[a-z0-9-]`, 2–40 caracteres).
  - `programKinds = ["class-frequency","class-unlimited","room-frequency","room-unlimited","service"]`, `dropInPolicies = ["no","unlimited","automatic","1","2","3","4","5"]`.
  - `type ProgramV2Fields = { abbreviation: string; colour: string; kind: ProgramKind; dropInPolicy: DropInPolicy; notifyByEmail: boolean; showInList: boolean; message: string }`.
  - `type CreateProgramInputV2 = { name: string; abbreviation: string }`, `parseCreateProgramInputV2`.
  - `type UpdateProgramInput = { programId: string } & Partial<ProgramV2Fields & { name: string; active: boolean }>`, `parseUpdateProgramInput`.
  - `programDefaultsV2: ProgramV2Fields` (`colour "#F0EFFF"`, `kind "class-frequency"`, `dropInPolicy "unlimited"`, `notifyByEmail false`, `showInList true`, `message ""`).
  - `type SessionBookingRules = "defined" | { bookUntilMinutesBefore: number; cancelUntil: "start" | "end" | { minutesBefore: number }; advanceMinutes: number }`, `parseSessionBookingRules`.
  - `waitingListModes = ["general","on","off"]`, `type WaitingListMode`.
  - `type WeekRange = { from: string; to: string }` (ISO UTC), `weekRangeFor(weekStart: string /* YYYY-MM-DD lunes */, timezone: string): Result<WeekRange, string>`.
  - `type CopyWeekInput = { fromWeekStart: string; toWeekStart: string; copyBookings: boolean }`, `parseCopyWeekInput`; `type DeleteWeekInput = { weekStart: string; reason: string }`, `parseDeleteWeekInput`; `type WeekPreview = { count: number; sample: readonly { sessionId: string; title: string; startAt: string }[] }`.
  - `shiftIso(iso: string, days: number): string`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
// packages/domain/src/schedule/classes-services-contracts.test.ts
import { describe, expect, it } from "vitest";

import {
  parseCopyWeekInput,
  parseCreateLocationInput,
  parseCreateProgramInputV2,
  parseDeleteWeekInput,
  parseSessionBookingRules,
  parseUpdateLocationInput,
  parseUpdateProgramInput,
  programDefaultsV2,
  shiftIso,
  slugifyLocationId,
  weekRangeFor,
} from "./classes-services-contracts";

describe("locations", () => {
  it("accepts a name, abbreviation and kind and trims them", () => {
    const parsed = parseCreateLocationInput({ name: " BPT Town ", abbreviation: "tow", kind: "presential" });
    expect(parsed).toEqual({ ok: true, value: { name: "BPT Town", abbreviation: "tow", kind: "presential" } });
  });

  it("rejects an unknown kind, a short abbreviation and extra keys", () => {
    expect(parseCreateLocationInput({ name: "BPT Town", abbreviation: "tow", kind: "metaverse" }).ok).toBe(false);
    expect(parseCreateLocationInput({ name: "BPT Town", abbreviation: "t", kind: "zoom" }).ok).toBe(false);
    expect(parseCreateLocationInput({ name: "BPT Town", abbreviation: "tow", kind: "zoom", extra: 1 }).ok).toBe(false);
  });

  it("slugifies a name into a stable id", () => {
    expect(slugifyLocationId("BPT Town")).toBe("bpt-town");
    expect(slugifyLocationId("  Salle  Ünique! ")).toBe("salle-unique");
  });

  it("updates only the given fields and requires the id", () => {
    expect(parseUpdateLocationInput({ locationId: "west", active: false })).toEqual({
      ok: true,
      value: { locationId: "west", active: false },
    });
    expect(parseUpdateLocationInput({ active: false }).ok).toBe(false);
    expect(parseUpdateLocationInput({ locationId: "west" }).ok).toBe(false);
  });
});

describe("programs v2", () => {
  it("creates from name and abbreviation only", () => {
    expect(parseCreateProgramInputV2({ name: "GI All Levels Evenings", abbreviation: "LEV_EVE" })).toEqual({
      ok: true,
      value: { name: "GI All Levels Evenings", abbreviation: "LEV_EVE" },
    });
  });

  it("validates colour, kind, drop-in policy and message length on update", () => {
    expect(parseUpdateProgramInput({ programId: "p1", colour: "#d9d7ff", kind: "service", dropInPolicy: "3" }).ok).toBe(true);
    expect(parseUpdateProgramInput({ programId: "p1", colour: "purple" }).ok).toBe(false);
    expect(parseUpdateProgramInput({ programId: "p1", dropInPolicy: "9" }).ok).toBe(false);
    expect(parseUpdateProgramInput({ programId: "p1", message: "x".repeat(201) }).ok).toBe(false);
  });

  it("ships defaults that DESIGN.md allows", () => {
    expect(programDefaultsV2.colour).toBe("#F0EFFF");
    expect(programDefaultsV2.showInList).toBe(true);
  });
});

describe("session booking rules", () => {
  it("accepts 'defined' and a custom rule set", () => {
    expect(parseSessionBookingRules("defined")).toEqual({ ok: true, value: "defined" });
    expect(
      parseSessionBookingRules({ bookUntilMinutesBefore: 30, cancelUntil: { minutesBefore: 60 }, advanceMinutes: 10080 }),
    ).toEqual({
      ok: true,
      value: { bookUntilMinutesBefore: 30, cancelUntil: { minutesBefore: 60 }, advanceMinutes: 10080 },
    });
    expect(parseSessionBookingRules({ bookUntilMinutesBefore: -1, cancelUntil: "start", advanceMinutes: 0 }).ok).toBe(false);
  });
});

describe("weeks", () => {
  it("turns a Monday into a 7-day UTC range in the academy timezone", () => {
    expect(weekRangeFor("2026-09-14", "Europe/Jersey")).toEqual({
      ok: true,
      value: { from: "2026-09-13T23:00:00.000Z", to: "2026-09-20T22:59:59.999Z" },
    });
  });

  it("rejects days that are not a Monday", () => {
    expect(weekRangeFor("2026-09-16", "Europe/Jersey").ok).toBe(false);
  });

  it("shifts an ISO instant by whole days", () => {
    expect(shiftIso("2026-09-14T05:00:00.000Z", 7)).toBe("2026-09-21T05:00:00.000Z");
  });

  it("parses copy and delete week inputs", () => {
    expect(parseCopyWeekInput({ fromWeekStart: "2026-09-14", toWeekStart: "2026-09-21", copyBookings: false }).ok).toBe(true);
    expect(parseCopyWeekInput({ fromWeekStart: "2026-09-14", toWeekStart: "2026-09-14", copyBookings: false }).ok).toBe(false);
    expect(parseDeleteWeekInput({ weekStart: "2026-09-14", reason: "Bank holiday week" }).ok).toBe(true);
    expect(parseDeleteWeekInput({ weekStart: "2026-09-14", reason: "x" }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `corepack pnpm vitest run --project node packages/domain/src/schedule/classes-services-contracts.test.ts`
Expected: FAIL, "Cannot find module './classes-services-contracts'".

- [ ] **Step 3: Escribir el módulo**

```ts
// packages/domain/src/schedule/classes-services-contracts.ts
import { err, ok, type Result } from "../result";

// ── Locations ──
export const locationKinds = Object.freeze(["presential", "zoom", "jitsi"] as const);
export type LocationKind = (typeof locationKinds)[number];

export type CreateLocationInput = Readonly<{ name: string; abbreviation: string; kind: LocationKind }>;
export type UpdateLocationInput = Readonly<{
  locationId: string;
  name?: string;
  abbreviation?: string;
  kind?: LocationKind;
  active?: boolean;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(input: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(input).every((key) => allowed.includes(key));
}

function parseName(value: unknown, min: number, max: number, label: string): Result<string, string> {
  if (typeof value !== "string") return err(`${label} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) return err(`${label} must be between ${min} and ${max} characters`);
  return ok(trimmed);
}

const abbreviationPattern = /^[A-Za-z0-9_-]{2,12}$/u;

function parseAbbreviation(value: unknown): Result<string, string> {
  if (typeof value !== "string" || !abbreviationPattern.test(value.trim())) {
    return err("abbreviation must be 2–12 letters, digits, '_' or '-'");
  }
  return ok(value.trim());
}

export function slugifyLocationId(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40);
  return slug.length >= 2 ? slug : `site-${slug}`.slice(0, 40);
}

export function parseCreateLocationInput(input: unknown): Result<CreateLocationInput, string> {
  if (!isRecord(input) || !onlyKeys(input, ["name", "abbreviation", "kind"])) {
    return err("Location input accepts exactly name, abbreviation and kind");
  }
  const name = parseName(input.name, 2, 80, "name");
  if (!name.ok) return name;
  const abbreviation = parseAbbreviation(input.abbreviation);
  if (!abbreviation.ok) return abbreviation;
  if (typeof input.kind !== "string" || !locationKinds.includes(input.kind as LocationKind)) {
    return err("kind must be presential, zoom or jitsi");
  }
  return ok(Object.freeze({ name: name.value, abbreviation: abbreviation.value, kind: input.kind as LocationKind }));
}

export function parseUpdateLocationInput(input: unknown): Result<UpdateLocationInput, string> {
  if (!isRecord(input) || !onlyKeys(input, ["locationId", "name", "abbreviation", "kind", "active"])) {
    return err("Location update accepts locationId, name, abbreviation, kind and active");
  }
  if (typeof input.locationId !== "string" || input.locationId.trim().length === 0) {
    return err("locationId is required");
  }
  const result: { -readonly [K in keyof UpdateLocationInput]: UpdateLocationInput[K] } = {
    locationId: input.locationId.trim(),
  };
  if (input.name !== undefined) {
    const name = parseName(input.name, 2, 80, "name");
    if (!name.ok) return name;
    result.name = name.value;
  }
  if (input.abbreviation !== undefined) {
    const abbreviation = parseAbbreviation(input.abbreviation);
    if (!abbreviation.ok) return abbreviation;
    result.abbreviation = abbreviation.value;
  }
  if (input.kind !== undefined) {
    if (typeof input.kind !== "string" || !locationKinds.includes(input.kind as LocationKind)) {
      return err("kind must be presential, zoom or jitsi");
    }
    result.kind = input.kind as LocationKind;
  }
  if (input.active !== undefined) {
    if (typeof input.active !== "boolean") return err("active must be a boolean");
    result.active = input.active;
  }
  if (Object.keys(result).length === 1) return err("Nothing to update");
  return ok(Object.freeze(result));
}

// ── Programs (class / service types) v2 ──
export const programKinds = Object.freeze([
  "class-frequency",
  "class-unlimited",
  "room-frequency",
  "room-unlimited",
  "service",
] as const);
export type ProgramKind = (typeof programKinds)[number];

export const dropInPolicies = Object.freeze(["no", "unlimited", "automatic", "1", "2", "3", "4", "5"] as const);
export type DropInPolicy = (typeof dropInPolicies)[number];

export type ProgramV2Fields = Readonly<{
  abbreviation: string;
  colour: string;
  kind: ProgramKind;
  dropInPolicy: DropInPolicy;
  notifyByEmail: boolean;
  showInList: boolean;
  message: string;
}>;

export const programDefaultsV2: ProgramV2Fields = Object.freeze({
  abbreviation: "",
  colour: "#F0EFFF",
  kind: "class-frequency",
  dropInPolicy: "unlimited",
  notifyByEmail: false,
  showInList: true,
  message: "",
});

export type CreateProgramInputV2 = Readonly<{ name: string; abbreviation: string }>;
export type UpdateProgramInput = Readonly<{ programId: string }> &
  Partial<ProgramV2Fields & Readonly<{ name: string; active: boolean }>>;

const colourPattern = /^#[0-9a-fA-F]{6}$/u;
export const programMessageMaxLength = 200;

export function parseCreateProgramInputV2(input: unknown): Result<CreateProgramInputV2, string> {
  if (!isRecord(input) || !onlyKeys(input, ["name", "abbreviation"])) {
    return err("Program input accepts exactly name and abbreviation");
  }
  const name = parseName(input.name, 2, 100, "name");
  if (!name.ok) return name;
  const abbreviation = parseAbbreviation(input.abbreviation);
  if (!abbreviation.ok) return abbreviation;
  return ok(Object.freeze({ name: name.value, abbreviation: abbreviation.value }));
}

export function parseUpdateProgramInput(input: unknown): Result<UpdateProgramInput, string> {
  const allowed = ["programId", "name", "active", "abbreviation", "colour", "kind", "dropInPolicy", "notifyByEmail", "showInList", "message"];
  if (!isRecord(input) || !onlyKeys(input, allowed)) return err("Program update has unknown keys");
  if (typeof input.programId !== "string" || input.programId.trim().length === 0) return err("programId is required");
  const result: Record<string, unknown> = { programId: input.programId.trim() };
  if (input.name !== undefined) {
    const name = parseName(input.name, 2, 100, "name");
    if (!name.ok) return name;
    result.name = name.value;
  }
  if (input.abbreviation !== undefined) {
    const abbreviation = parseAbbreviation(input.abbreviation);
    if (!abbreviation.ok) return abbreviation;
    result.abbreviation = abbreviation.value;
  }
  if (input.colour !== undefined) {
    if (typeof input.colour !== "string" || !colourPattern.test(input.colour)) return err("colour must be a #RRGGBB hex value");
    result.colour = input.colour.toUpperCase();
  }
  if (input.kind !== undefined) {
    if (typeof input.kind !== "string" || !programKinds.includes(input.kind as ProgramKind)) return err("Invalid kind");
    result.kind = input.kind;
  }
  if (input.dropInPolicy !== undefined) {
    if (typeof input.dropInPolicy !== "string" || !dropInPolicies.includes(input.dropInPolicy as DropInPolicy)) {
      return err("Invalid dropInPolicy");
    }
    result.dropInPolicy = input.dropInPolicy;
  }
  for (const flag of ["notifyByEmail", "showInList", "active"] as const) {
    if (input[flag] !== undefined) {
      if (typeof input[flag] !== "boolean") return err(`${flag} must be a boolean`);
      result[flag] = input[flag];
    }
  }
  if (input.message !== undefined) {
    if (typeof input.message !== "string" || input.message.length > programMessageMaxLength) {
      return err(`message must be at most ${programMessageMaxLength} characters`);
    }
    result.message = input.message.trim();
  }
  if (Object.keys(result).length === 1) return err("Nothing to update");
  return ok(Object.freeze(result) as UpdateProgramInput);
}

// ── Session booking rules and waiting list ──
export type SessionBookingRules =
  | "defined"
  | Readonly<{
      bookUntilMinutesBefore: number;
      cancelUntil: "start" | "end" | Readonly<{ minutesBefore: number }>;
      advanceMinutes: number;
    }>;

export const waitingListModes = Object.freeze(["general", "on", "off"] as const);
export type WaitingListMode = (typeof waitingListModes)[number];

function isMinutes(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

export function parseSessionBookingRules(input: unknown): Result<SessionBookingRules, string> {
  if (input === "defined") return ok("defined");
  if (!isRecord(input) || !onlyKeys(input, ["bookUntilMinutesBefore", "cancelUntil", "advanceMinutes"])) {
    return err("bookingRules must be 'defined' or an object with bookUntilMinutesBefore, cancelUntil and advanceMinutes");
  }
  const { bookUntilMinutesBefore, cancelUntil, advanceMinutes } = input;
  if (!isMinutes(bookUntilMinutesBefore, 60 * 24 * 30)) return err("bookUntilMinutesBefore must be 0–43200");
  if (!isMinutes(advanceMinutes, 60 * 24 * 365)) return err("advanceMinutes must be 0–525600");
  let parsedCancel: SessionBookingRules extends string ? never : Exclude<SessionBookingRules, "defined">["cancelUntil"];
  if (cancelUntil === "start" || cancelUntil === "end") {
    parsedCancel = cancelUntil;
  } else if (isRecord(cancelUntil) && onlyKeys(cancelUntil, ["minutesBefore"]) && isMinutes(cancelUntil.minutesBefore, 60 * 24 * 30)) {
    parsedCancel = Object.freeze({ minutesBefore: cancelUntil.minutesBefore });
  } else {
    return err("cancelUntil must be 'start', 'end' or { minutesBefore }");
  }
  return ok(Object.freeze({ bookUntilMinutesBefore, cancelUntil: parsedCancel, advanceMinutes }));
}

// ── Weeks (copy / delete) ──
export type WeekRange = Readonly<{ from: string; to: string }>;
export type CopyWeekInput = Readonly<{ fromWeekStart: string; toWeekStart: string; copyBookings: boolean }>;
export type DeleteWeekInput = Readonly<{ weekStart: string; reason: string }>;
export type WeekPreview = Readonly<{
  count: number;
  sample: readonly Readonly<{ sessionId: string; title: string; startAt: string }>[];
}>;

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

function zonedOffsetMinutes(utcMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60000);
}

/** Midnight of a local calendar date in `timezone`, as a UTC instant. */
export function localMidnightUtc(date: string, timezone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const guess = Date.UTC(year!, month! - 1, day!);
  return guess - zonedOffsetMinutes(guess, timezone) * 60000;
}

export function weekRangeFor(weekStart: string, timezone: string): Result<WeekRange, string> {
  if (typeof weekStart !== "string" || !isoDatePattern.test(weekStart)) return err("weekStart must be YYYY-MM-DD");
  const startMs = localMidnightUtc(weekStart, timezone);
  if (Number.isNaN(startMs)) return err("weekStart is not a valid date");
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short" }).format(new Date(startMs));
  if (weekday !== "Mon") return err("weekStart must be a Monday");
  const [ny, nm, nd] = weekStart.split("-").map(Number);
  const nextMonday = new Date(Date.UTC(ny!, nm! - 1, nd! + 7)).toISOString().slice(0, 10);
  const endMs = localMidnightUtc(nextMonday, timezone) - 1;
  return ok(Object.freeze({ from: new Date(startMs).toISOString(), to: new Date(endMs).toISOString() }));
}

export function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

export const weekReasonMinLength = 2;
export const weekReasonMaxLength = 200;

export function parseCopyWeekInput(input: unknown): Result<CopyWeekInput, string> {
  if (!isRecord(input) || !onlyKeys(input, ["fromWeekStart", "toWeekStart", "copyBookings"])) {
    return err("Copy week accepts fromWeekStart, toWeekStart and copyBookings");
  }
  const { fromWeekStart, toWeekStart, copyBookings } = input;
  if (typeof fromWeekStart !== "string" || !isoDatePattern.test(fromWeekStart)) return err("fromWeekStart must be YYYY-MM-DD");
  if (typeof toWeekStart !== "string" || !isoDatePattern.test(toWeekStart)) return err("toWeekStart must be YYYY-MM-DD");
  if (fromWeekStart === toWeekStart) return err("Target week must differ from the source week");
  if (typeof copyBookings !== "boolean") return err("copyBookings must be a boolean");
  return ok(Object.freeze({ fromWeekStart, toWeekStart, copyBookings }));
}

export function parseDeleteWeekInput(input: unknown): Result<DeleteWeekInput, string> {
  if (!isRecord(input) || !onlyKeys(input, ["weekStart", "reason"])) return err("Delete week accepts weekStart and reason");
  const { weekStart, reason } = input;
  if (typeof weekStart !== "string" || !isoDatePattern.test(weekStart)) return err("weekStart must be YYYY-MM-DD");
  if (typeof reason !== "string" || reason.trim().length < weekReasonMinLength || reason.trim().length > weekReasonMaxLength) {
    return err(`reason must be between ${weekReasonMinLength} and ${weekReasonMaxLength} characters`);
  }
  return ok(Object.freeze({ weekStart, reason: reason.trim() }));
}
```

- [ ] **Step 4: Registrar el subpath**

En `packages/domain/package.json`, dentro de `exports`, tras el bloque `"./schedule/advanced-booking"`:

```json
    "./schedule/classes-services": {
      "types": "./src/schedule/classes-services-contracts.ts",
      "import": "./src/schedule/classes-services-contracts.ts",
      "default": "./lib/schedule/classes-services-contracts.js"
    },
```

En `apps/functions/src/deploy-runtime.ts`, tras la línea de `advanced-booking`:

```ts
  "@bpt-jersey/domain/schedule/classes-services":
    "../../domain/schedule/classes-services-contracts.js",
```

- [ ] **Step 5: Ejecutar y ver pasar**

Run: `corepack pnpm vitest run --project node packages/domain/src/schedule/classes-services-contracts.test.ts`
Expected: PASS (13 pruebas). Si `weekRangeFor` falla por una hora de verano distinta, comprobar que la máquina interpreta `Europe/Jersey` (BST, UTC+1 el 14 de septiembre).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/schedule/classes-services-contracts.ts packages/domain/src/schedule/classes-services-contracts.test.ts packages/domain/package.json apps/functions/src/deploy-runtime.ts
git commit -m "feat(domain): classes-services contracts — locations, programs v2, booking rules, week ranges

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `LocationId` a string y campos aditivos en sede, programa y sesión

**Files:**
- Modify: `packages/domain/src/schedule/schedule-contracts.ts:3-4` (`LocationId`), `:37-48` (`LocationRecord`), `:72-117` (`parseSaveLocationGeofenceInput`), `:131-140` (`ProgramRecord`), `:169-193` (`SessionRecord`), `:195-247` (inputs de sesión), `:630-742` (`parseCreateSessionInput`), `:741-815` (`parseUpdateSessionInput`)
- Modify: `packages/domain/src/schedule/schedule-contracts.test.ts`
- Modify: `apps/functions/src/schedule/booking-transaction-service.ts` (comprobación de aforo)
- Modify: los ficheros que `corepack pnpm typecheck` señale.

**Interfaces:**
- Produces: `LocationId = string` (se mantiene `locationIds` como lista de las dos sedes por defecto); `LocationRecord` + `abbreviation?: string`, `kind?: LocationKind`; `ProgramRecord` + `Partial<ProgramV2Fields>`; `SessionRecord`/`CreateSessionInput`/`UpdateSessionInput` + `instructorIds?: readonly string[]`, `capacity: number | null`, `bookingRules?: SessionBookingRules`, `waitingList?: WaitingListMode`.

- [ ] **Step 1: Pruebas que fallan en `schedule-contracts.test.ts`** (añadir al final del fichero)

```ts
describe("classes-services additions", () => {
  it("accepts any non-empty location id in session and geofence inputs", () => {
    const base = {
      programId: "p1", locationId: "salle-ouest", instructorId: "coach-1", title: "GI All Levels",
      startAt: "2026-09-14T17:00:00.000Z", endAt: "2026-09-14T18:00:00.000Z", capacity: 20,
    };
    expect(parseCreateSessionInput(base).ok).toBe(true);
    expect(parseCreateSessionInput({ ...base, locationId: "" }).ok).toBe(false);
    expect(parseSaveLocationGeofenceInput({ locationId: "salle-ouest", geofence: null }).ok).toBe(true);
  });

  it("accepts unlimited capacity, several trainers, booking rules and waiting list", () => {
    const parsed = parseCreateSessionInput({
      programId: "p1", locationId: "town", instructorId: "coach-1", instructorIds: ["coach-1", "coach-2"],
      title: "Open Mat", startAt: "2026-09-14T17:00:00.000Z", endAt: "2026-09-14T18:00:00.000Z",
      capacity: null, minParticipants: 0, bookingRules: "defined", waitingList: "off",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.capacity).toBeNull();
    expect(parsed.value.instructorIds).toEqual(["coach-1", "coach-2"]);
    expect(parsed.value.waitingList).toBe("off");
  });

  it("keeps minParticipants within capacity only when capacity is a number", () => {
    const base = {
      programId: "p1", locationId: "town", instructorId: "coach-1", title: "GI",
      startAt: "2026-09-14T17:00:00.000Z", endAt: "2026-09-14T18:00:00.000Z",
    };
    expect(parseCreateSessionInput({ ...base, capacity: 5, minParticipants: 6 }).ok).toBe(false);
    expect(parseCreateSessionInput({ ...base, capacity: null, minParticipants: 6 }).ok).toBe(true);
  });

  it("updates trainers and capacity on an existing session", () => {
    expect(parseUpdateSessionInput({ sessionId: "s1", instructorIds: ["a", "b"], capacity: null }).ok).toBe(true);
    expect(parseUpdateSessionInput({ sessionId: "s1", instructorIds: [] }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `corepack pnpm vitest run --project node packages/domain/src/schedule/schedule-contracts.test.ts -t "classes-services additions"`
Expected: FAIL (locationId rechazado; `capacity: null` rechazado).

- [ ] **Step 3: Cambiar los contratos**

En `schedule-contracts.ts`:

```ts
// línea 3-4
/** Ids de las dos sedes históricas; desde el clon de Classes / Services cualquier slug es válido. */
export const locationIds = Object.freeze(["town", "west"] as const);
export type LocationId = string;
```

```ts
// LocationRecord
export type LocationRecord = Readonly<{
  locationId: LocationId;
  academyId: string;
  name: string;
  address: string;
  timezone: string;
  active: boolean;
  geofence?: LocationGeofence | null;
  /** Classes / Services clone (2026-09-16): additive, absent on v1 documents. */
  abbreviation?: string;
  kind?: LocationKind;
  schemaVersion: "1";
}>;
```

con `import type { LocationKind, ProgramV2Fields, SessionBookingRules, WaitingListMode } from "./classes-services-contracts";` al principio del fichero (import de tipo: no crea ciclo en tiempo de ejecución).

En `parseSaveLocationGeofenceInput` sustituir la comprobación de `locationIds.includes` por:

```ts
  if (typeof locationId !== "string" || locationId.trim().length === 0) {
    return err("locationId is required");
  }
```

`ProgramRecord`: añadir `& Partial<ProgramV2Fields>` al tipo (conservar `schemaVersion: "1"`; un documento v2 se distingue por tener `abbreviation`).

`SessionRecord`: `capacity: number | null;` y añadir al final, junto a `description?`:

```ts
  instructorIds?: readonly string[];
  bookingRules?: SessionBookingRules;
  waitingList?: WaitingListMode;
```

`CreateSessionInput` y `UpdateSessionInput`: `capacity: number | null` (en update `capacity?: number | null`) y los tres campos opcionales anteriores.

`parseCreateSessionInput`: cambiar la validación de `locationId` como en la geocerca; la de `capacity` por:

```ts
  if (capacity !== null && (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity < 1 || capacity > 300)) {
    return err("capacity must be null (unlimited) or an integer between 1 and 300");
  }
  if (
    typeof minParticipants !== "number" || !Number.isInteger(minParticipants) || minParticipants < 0 ||
    (capacity !== null && minParticipants > capacity)
  ) {
    return err("minParticipants must be an integer between 0 and capacity");
  }
```

y, antes del `return ok(...)`, el parseo de los tres campos nuevos:

```ts
  const { instructorIds, bookingRules, waitingList } = input;
  let parsedInstructorIds: readonly string[] | undefined;
  if (instructorIds !== undefined) {
    if (!Array.isArray(instructorIds) || instructorIds.length === 0 || instructorIds.length > 10 ||
        !instructorIds.every((id) => typeof id === "string" && id.trim().length > 0)) {
      return err("instructorIds must list 1–10 trainer ids");
    }
    parsedInstructorIds = Object.freeze([...new Set(instructorIds.map((id) => id.trim()))]);
  }
  let parsedRules: SessionBookingRules | undefined;
  if (bookingRules !== undefined) {
    const result = parseSessionBookingRules(bookingRules);
    if (!result.ok) return err(result.error);
    parsedRules = result.value;
  }
  if (waitingList !== undefined && !waitingListModes.includes(waitingList as WaitingListMode)) {
    return err("waitingList must be general, on or off");
  }
```

y en el objeto devuelto:

```ts
      instructorId: (parsedInstructorIds?.[0] ?? instructorId).trim(),
      ...(parsedInstructorIds ? { instructorIds: parsedInstructorIds } : {}),
      ...(parsedRules !== undefined ? { bookingRules: parsedRules } : {}),
      ...(waitingList !== undefined ? { waitingList: waitingList as WaitingListMode } : {}),
```

(`parseSessionBookingRules` y `waitingListModes` se importan como valores desde `./classes-services-contracts`; ese módulo no importa `schedule-contracts`, así que no hay ciclo.) Repetir el mismo bloque en `parseUpdateSessionInput` con `capacity` opcional.

- [ ] **Step 4: Aforo ilimitado en la reserva**

En `apps/functions/src/schedule/booking-transaction-service.ts` localizar la comprobación de aforo:

Run: `grep -n "capacity" apps/functions/src/schedule/booking-transaction-service.ts apps/functions/src/schedule/quorum-sweep-service.ts apps/functions/src/schedule/schedule-service.ts | head -20`

Cambiar cada comparación `confirmedCount >= session.capacity` (o equivalente) por `session.capacity !== null && confirmedCount >= session.capacity`, y en `evaluateSessionMinimum` y `decideQuorumSweep` dejar `capacity` fuera del cálculo (solo usan `minParticipants`). Añadir en `booking-transaction-service.test.ts`:

```ts
  it("never reports capacity for an unlimited session", async () => {
    // usar el mismo arnés que la prueba de "capacity" existente, con capacity: null y 400 reservas confirmadas
    // esperado: la reserva 401 se confirma
  });
```

(el arnés concreto es el de la prueba vecina "rejects a booking when the session is full": copiar su preparación y cambiar `capacity: 1` por `capacity: null`).

- [ ] **Step 5: Typecheck y arreglar consumidores**

Run: `corepack pnpm typecheck`
Expected: errores en los ficheros que trataban `LocationId` como unión o `capacity` como número. Arreglos esperados:
- `apps/web/src/app/admin/classes/classes-dialog.tsx`, `class-form.tsx`, `site-geofence-panel.tsx`, `apps/web/src/app/admin/attendance/page.tsx`, `apps/web/src/app/coach/page.tsx`: los `switch`/mapas sobre `"town" | "west"` pasan a leer el nombre del catálogo (`locations.find((l) => l.locationId === id)?.name ?? id`).
- `packages/domain/src/penalties/no-show-penalty-contracts.ts` y `apps/functions/src/schedule/attendance-transaction-service.ts`: sustituir `LocationId` por `string` si validan contra `locationIds`.
- `packages/domain/src/schedule/member-calendar-contracts.ts` y `apps/web/src/app/account/**`: donde muestran `n/capacity`, mostrar `∞` cuando `capacity === null` (`session.capacity ?? "∞"`).
- `apps/functions/src/schedule/schedule-service.ts` `createSession`/`updateSession` (Firestore y memoria): persistir `instructorIds`, `bookingRules`, `waitingList` cuando vengan y `capacity` tal cual (puede ser `null`).

Repetir `corepack pnpm typecheck` hasta cero errores; luego `corepack pnpm test` (todo verde: ~2500 pruebas).

- [ ] **Step 6: Commit**

```bash
git add -A packages/domain/src apps/functions/src apps/web/src
git commit -m "feat(schedule): dynamic location ids, unlimited capacity, several trainers and booking rules per session

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Store — sedes, tipos v2, vista previa, copiar y eliminar semana

**Files:**
- Modify: `apps/functions/src/schedule/schedule-service.ts` (`ScheduleStore` 159-260; Firestore 461-640 y 884-940; memoria 1285-1420)
- Modify: `apps/functions/src/schedule/schedule-service.test.ts`

**Interfaces:**
- Consumes: Task 1 (`CreateLocationInput`, `UpdateLocationInput`, `CreateProgramInputV2`, `UpdateProgramInput`, `programDefaultsV2`, `weekRangeFor`, `shiftIso`, `WeekPreview`, `CopyWeekInput`, `DeleteWeekInput`, `slugifyLocationId`).
- Produces en `ScheduleStore`:
  - `createLocation(academyId, input: CreateLocationInput, actorId): Promise<LocationRecord>` — id = `slugifyLocationId(name)`; si ya existe, sufijo `-2`, `-3`…; `address ""`, `timezone "Europe/Jersey"`, `active true`.
  - `updateLocation(academyId, input: UpdateLocationInput, actorId): Promise<LocationRecord>` — sobre un doc existente; si es `town`/`west` y no hay doc, se materializa desde `defaultLocations` antes de aplicar.
  - `createProgramV2(academyId, input: CreateProgramInputV2): Promise<ProgramRecord>` — `ageBand "all"`, `discipline "bjj"`, `level "all-levels"`, `...programDefaultsV2`, `abbreviation` del input, `active true`.
  - `updateProgramV2(academyId, input: UpdateProgramInput): Promise<ProgramRecord>` — mezcla parcial; si el programa solo existía por defecto (`defaultPrograms`), se materializa primero.
  - `previewWeek(academyId, weekStart, timezone): Promise<WeekPreview>` — sesiones `scheduled`/`active` en el rango.
  - `copyWeek(academyId, input: CopyWeekInput, timezone, actorId): Promise<readonly SessionRecord[]>` — clona cada sesión no cancelada desplazada `+n·7` días con `sessionId` nuevo, `classId null`, `status "scheduled"`; con `copyBookings` clona también las reservas `confirmed` (`buildBookingIdV2(newSessionId, studentId)`, `status "confirmed"`); ignora las sesiones cuyo destino ya tiene una sesión con el mismo `programId`, `locationId` y `startAt`.
  - `deleteWeek(academyId, input: DeleteWeekInput, timezone, actorId): Promise<readonly SessionRecord[]>` — cancela (con `reason`) cada sesión `scheduled`/`active` del rango; devuelve las canceladas.

- [ ] **Step 1: Pruebas sobre el store en memoria** (añadir a `schedule-service.test.ts`; usar `createInMemoryScheduleStore()` como el resto del fichero)

```ts
describe("classes-services store", () => {
  const academyId = "demo-academy";

  it("creates a location with a slug id and updates it", async () => {
    const store = createInMemoryScheduleStore();
    const created = await store.createLocation(academyId, { name: "Salle Ouest", abbreviation: "ouest", kind: "presential" }, "admin-1");
    expect(created.locationId).toBe("salle-ouest");
    expect(created.active).toBe(true);
    const second = await store.createLocation(academyId, { name: "Salle Ouest", abbreviation: "oue2", kind: "zoom" }, "admin-1");
    expect(second.locationId).toBe("salle-ouest-2");
    const updated = await store.updateLocation(academyId, { locationId: "salle-ouest", active: false, kind: "jitsi" }, "admin-1");
    expect(updated.active).toBe(false);
    expect(updated.kind).toBe("jitsi");
    const listed = await store.listLocations(academyId);
    expect(listed.map((l) => l.locationId)).toEqual(["town", "west", "salle-ouest", "salle-ouest-2"]);
  });

  it("materialises a default site before updating it", async () => {
    const store = createInMemoryScheduleStore();
    const updated = await store.updateLocation(academyId, { locationId: "west", abbreviation: "wes" }, "admin-1");
    expect(updated.name).toBe("BPT West");
    expect(updated.abbreviation).toBe("wes");
  });

  it("creates a v2 program with defaults and updates its colour", async () => {
    const store = createInMemoryScheduleStore();
    const program = await store.createProgramV2(academyId, { name: "GI Beginners Mornings", abbreviation: "BEG_MOR" });
    expect(program).toMatchObject({ abbreviation: "BEG_MOR", colour: "#F0EFFF", kind: "class-frequency", dropInPolicy: "unlimited", active: true });
    const updated = await store.updateProgramV2(academyId, { programId: program.programId, colour: "#D9D7FF", showInList: false });
    expect(updated.colour).toBe("#D9D7FF");
    expect(updated.showInList).toBe(false);
  });

  it("previews, copies and deletes a week", async () => {
    const store = createInMemoryScheduleStore();
    const make = (startAt: string) =>
      store.createSession(academyId, {
        programId: "open-mat", locationId: "town", instructorId: "coach-1", title: "Open Mat",
        startAt, endAt: shiftIso(startAt, 0).replace("T17:00", "T18:00"), capacity: null,
      }, "admin-1");
    await make("2026-09-14T17:00:00.000Z");
    await make("2026-09-16T17:00:00.000Z");
    await make("2026-09-23T17:00:00.000Z"); // semana siguiente: no cuenta
    const preview = await store.previewWeek(academyId, "2026-09-14", "Europe/Jersey");
    expect(preview.count).toBe(2);
    expect(preview.sample.map((s) => s.startAt)).toEqual(["2026-09-14T17:00:00.000Z", "2026-09-16T17:00:00.000Z"]);

    const copied = await store.copyWeek(academyId, { fromWeekStart: "2026-09-14", toWeekStart: "2026-09-28", copyBookings: false }, "Europe/Jersey", "admin-1");
    expect(copied.map((s) => s.startAt)).toEqual(["2026-09-28T17:00:00.000Z", "2026-09-30T17:00:00.000Z"]);
    expect(copied.every((s) => s.status === "scheduled" && s.classId === null)).toBe(true);

    const again = await store.copyWeek(academyId, { fromWeekStart: "2026-09-14", toWeekStart: "2026-09-28", copyBookings: false }, "Europe/Jersey", "admin-1");
    expect(again).toHaveLength(0); // idempotente

    const cancelled = await store.deleteWeek(academyId, { weekStart: "2026-09-28", reason: "Bank holiday" }, "Europe/Jersey", "admin-1");
    expect(cancelled).toHaveLength(2);
    expect(cancelled.every((s) => s.status === "cancelled" && s.cancellationReason === "Bank holiday")).toBe(true);
  });
});
```

(importar `shiftIso` desde `@bpt-jersey/domain/schedule/classes-services`).

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule/schedule-service.test.ts -t "classes-services store"`
Expected: FAIL, `store.createLocation is not a function`.

- [ ] **Step 3: Implementar en el store en memoria**

Dentro de `createInMemoryScheduleStore`, junto a `listLocations`:

```ts
    async createLocation(academyId, input, _actorId) {
      const existing = [...(await this.listLocations(academyId))];
      const base = slugifyLocationId(input.name);
      let locationId = base;
      for (let n = 2; existing.some((l) => l.locationId === locationId); n += 1) locationId = `${base}-${n}`;
      const record: LocationRecord = Object.freeze({
        locationId, academyId, name: input.name, address: "", timezone: "Europe/Jersey", active: true,
        abbreviation: input.abbreviation, kind: input.kind, schemaVersion: "1",
      });
      locationsMap.set(academyId, [...existing, record]);
      return record;
    },

    async updateLocation(academyId, input, _actorId) {
      const all = [...(await this.listLocations(academyId))];
      const index = all.findIndex((l) => l.locationId === input.locationId);
      if (index === -1) throw new Error(`Location ${input.locationId} does not exist`);
      const current = all[index]!;
      const updated: LocationRecord = Object.freeze({
        ...current,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.abbreviation !== undefined ? { abbreviation: input.abbreviation } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      });
      all[index] = updated;
      locationsMap.set(academyId, all);
      return updated;
    },
```

Nota: `listLocations` en memoria devuelve `defaultLocations` solo cuando no hay ninguna personalizada; para que `town`/`west` sigan apareciendo tras crear otra sede, `createLocation` parte de `listLocations` (que incluye los defaults) y guarda la lista completa. Lo mismo en `updateLocation` (materializa).

`createProgramV2` / `updateProgramV2` en memoria: mismo patrón que `createProgram`/`updateProgram` existentes, con `...programDefaultsV2` y el `Partial` de `UpdateProgramInput`; si `programsMap` está vacío, partir de `defaultPrograms`.

```ts
    async previewWeek(academyId, weekStart, timezone) {
      const range = weekRangeFor(weekStart, timezone);
      if (!range.ok) throw new Error(range.error);
      const sessions = (await this.listSessions(academyId, range.value)).filter((s) => s.status === "scheduled" || s.status === "active");
      return Object.freeze({ count: sessions.length, sample: sessions.slice(0, 10).map((s) => ({ sessionId: s.sessionId, title: s.title, startAt: s.startAt })) });
    },

    async copyWeek(academyId, input, timezone, actorId) {
      const from = weekRangeFor(input.fromWeekStart, timezone);
      const to = weekRangeFor(input.toWeekStart, timezone);
      if (!from.ok) throw new Error(from.error);
      if (!to.ok) throw new Error(to.error);
      const days = Math.round((Date.parse(to.value.from) - Date.parse(from.value.from)) / 86_400_000);
      const source = (await this.listSessions(academyId, from.value)).filter((s) => s.status !== "cancelled");
      const target = await this.listSessions(academyId, to.value);
      const created: SessionRecord[] = [];
      for (const session of source) {
        const startAt = shiftIso(session.startAt, days);
        if (target.some((t) => t.programId === session.programId && t.locationId === session.locationId && t.startAt === startAt)) continue;
        const copy = await this.createSession(academyId, {
          classId: null, programId: session.programId, locationId: session.locationId, instructorId: session.instructorId,
          ...(session.instructorIds ? { instructorIds: session.instructorIds } : {}),
          title: session.title, startAt, endAt: shiftIso(session.endAt, days), capacity: session.capacity,
          minParticipants: session.minParticipants, isSeminar: session.isSeminar,
          ...(session.description ? { description: session.description } : {}),
          ...(session.bookingRules ? { bookingRules: session.bookingRules } : {}),
          ...(session.waitingList ? { waitingList: session.waitingList } : {}),
        }, actorId);
        created.push(copy);
        if (input.copyBookings) {
          for (const booking of await this.listSessionBookings(academyId, session.sessionId)) {
            if (booking.status !== "confirmed") continue;
            await this.requestBooking(academyId, { sessionId: copy.sessionId, studentId: booking.studentId }, actorId);
          }
        }
      }
      return Object.freeze(created);
    },

    async deleteWeek(academyId, input, timezone, actorId) {
      const range = weekRangeFor(input.weekStart, timezone);
      if (!range.ok) throw new Error(range.error);
      const sessions = (await this.listSessions(academyId, range.value)).filter((s) => s.status === "scheduled" || s.status === "active");
      const cancelled: SessionRecord[] = [];
      for (const session of sessions) cancelled.push(await this.cancelSession(academyId, session.sessionId, input.reason, actorId));
      return Object.freeze(cancelled);
    },
```

(`requestBooking` en el store aplica las mismas reglas que una reserva normal; si la copia de una reserva falla por elegibilidad, se captura el error y se sigue: `try { … } catch { /* ponytail: la reserva no se copia si ya no es elegible */ }`.)

- [ ] **Step 4: Implementar en Firestore**

Mismos métodos en `createFirestoreScheduleStore`, con estas diferencias:
- `createLocation`: `firestore.collection(\`academies/${academyId}/locations\`).doc(locationId).set(record)`; para el sufijo comprobar existencia con `.get()` en bucle (máximo 20 intentos).
- `updateLocation`: `docRef.get()`; si no existe y el id está en `locationIds`, `current = defaultLocations.find(...)` con `academyId`; si no existe y no es default, `throw new Error(\`Location ${id} does not exist\`)`. Guardar con `set`.
- `createProgramV2`/`updateProgramV2`: colección `programs`; materializar `defaultPrograms` cuando la colección esté vacía (escribir los siete documentos por defecto en un `batch` antes de crear/actualizar, para que la lista siga completa).
- `previewWeek`/`copyWeek`/`deleteWeek`: reutilizar `this.listSessions`, `this.createSession`, `this.cancelSession`, `this.listSessionBookings`, `this.requestBooking` del propio objeto (definir el objeto en una constante `store` y referirse a `store.x` en vez de `this`, como hace el resto del fichero si no usa `this`). Los lotes de más de 200 sesiones se procesan en trozos de 200 con `Promise.all` por trozo.

Añadir los seis métodos al tipo `ScheduleStore`.

- [ ] **Step 5: Ejecutar y ver pasar**

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule/schedule-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/functions/src/schedule/schedule-service.ts apps/functions/src/schedule/schedule-service.test.ts
git commit -m "feat(schedule): store methods for locations, programs v2, preview/copy/delete week

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Callables `saveLocation`, `updateLocation`, `updateProgram`, `previewWeek`, `copyWeek`, `deleteWeek`

**Files:**
- Modify: `apps/functions/src/schedule/schedule-callables.ts` (handlers junto a `createSaveProgramHandler`, `onCall` al final)
- Modify: `apps/functions/src/schedule/schedule-callables.test.ts`
- Modify: `apps/functions/src/index.ts:100-128` (bloque de reexport de schedule)

**Interfaces:**
- Consumes: Task 3 (`ScheduleStore`), Task 1 (parsers).
- Produces: `createSaveLocationHandler`, `createUpdateLocationHandler`, `createUpdateProgramHandler`, `createPreviewWeekHandler`, `createCopyWeekHandler`, `createDeleteWeekHandler` (todos `{ store: ScheduleStore }`) y las callables exportadas con el mismo nombre sin `create…Handler`. `saveProgram` acepta tanto el cuerpo v1 (`name, ageBand, discipline, level`) como v2 (`name, abbreviation`). Respuestas: `{ location }`, `{ location }`, `{ program }`, `{ preview: WeekPreview }`, `{ sessions }`, `{ sessions }`. Roles: `managerRoles` (`owner`, `administrator`, `headCoach`) para todas las mutaciones y para la vista previa; la zona horaria es la de la primera sede activa o `"Europe/Jersey"`.

- [ ] **Step 1: Pruebas que fallan** (añadir en `schedule-callables.test.ts`)

```ts
describe("classes-services callables", () => {
  it("creates and updates a location for managers only", async () => {
    const store = createInMemoryScheduleStore();
    const save = createSaveLocationHandler({ store });
    const created = await save(fakeRequest({ name: "Salle Ouest", abbreviation: "ouest", kind: "presential" }, "headCoach"));
    expect(created.location.locationId).toBe("salle-ouest");
    await expect(save(fakeRequest({ name: "X Y", abbreviation: "xy", kind: "zoom" }, "coach"))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(save(fakeRequest({ name: "X" }, "owner"))).rejects.toMatchObject({ code: "invalid-argument" });
    const updated = await createUpdateLocationHandler({ store })(fakeRequest({ locationId: "salle-ouest", active: false }, "administrator"));
    expect(updated.location.active).toBe(false);
  });

  it("saves a v2 program from name and abbreviation and updates its fields", async () => {
    const store = createInMemoryScheduleStore();
    const saved = await createSaveProgramHandler({ store })(fakeRequest({ name: "GI Beginners Mornings", abbreviation: "BEG_MOR" }, "owner"));
    expect(saved.program.abbreviation).toBe("BEG_MOR");
    const updated = await createUpdateProgramHandler({ store })(fakeRequest({ programId: saved.program.programId, colour: "#D9D7FF" }, "owner"));
    expect(updated.program.colour).toBe("#D9D7FF");
    await expect(createUpdateProgramHandler({ store })(fakeRequest({ programId: "nope", colour: "#D9D7FF" }, "owner"))).rejects.toMatchObject({ code: "not-found" });
  });

  it("previews, copies and deletes a week", async () => {
    const store = createInMemoryScheduleStore();
    await createSaveSessionHandler({ store })(fakeRequest({
      programId: "open-mat", locationId: "town", instructorId: "coach-1", title: "Open Mat",
      startAt: "2026-09-14T17:00:00.000Z", endAt: "2026-09-14T18:00:00.000Z", capacity: null, minParticipants: 0,
    }, "owner"));
    const preview = await createPreviewWeekHandler({ store })(fakeRequest({ weekStart: "2026-09-14" }, "owner"));
    expect(preview.preview.count).toBe(1);
    const copied = await createCopyWeekHandler({ store })(fakeRequest({ fromWeekStart: "2026-09-14", toWeekStart: "2026-09-21", copyBookings: false }, "owner"));
    expect(copied.sessions).toHaveLength(1);
    const deleted = await createDeleteWeekHandler({ store })(fakeRequest({ weekStart: "2026-09-21", reason: "Closed" }, "owner"));
    expect(deleted.sessions[0]?.status).toBe("cancelled");
    await expect(createCopyWeekHandler({ store })(fakeRequest({ fromWeekStart: "2026-09-14", toWeekStart: "2026-09-21", copyBookings: false }, "coach"))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(createDeleteWeekHandler({ store })(fakeRequest({ weekStart: "2026-09-16", reason: "Closed" }, "owner"))).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
```

Y en la prueba existente "requires and consumes App Check for every shared schedule callable" añadir las seis callables nuevas a la lista comprobada.

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule/schedule-callables.test.ts -t "classes-services"`
Expected: FAIL (handlers no exportados).

- [ ] **Step 3: Implementar los handlers**

```ts
function requireManager(request: CallableRequest<unknown>, purpose: string) {
  const actor = requireUserActor(request);
  if (!managerRoles.includes(actor.role as (typeof managerRoles)[number])) {
    throw new HttpsError("permission-denied", `Manager access required to ${purpose}`);
  }
  return actor;
}

async function academyTimezone(store: ScheduleStore, academyId: string): Promise<string> {
  const locations = await store.listLocations(academyId);
  return locations.find((l) => l.active)?.timezone ?? "Europe/Jersey";
}

function mapWeekError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  const message = error instanceof Error ? error.message : "";
  if (/must be a Monday|YYYY-MM-DD|not a valid date/u.test(message)) throw new HttpsError("invalid-argument", message);
  console.error("week operation failed", error);
  throw new HttpsError("internal", "Unable to complete the week operation");
}

export function createSaveLocationHandler(options: { store: ScheduleStore }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireManager(request, "manage locations");
    const parsed = parseCreateLocationInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    return { location: await options.store.createLocation(actor.academyId, parsed.value, actor.userId) };
  };
}

export function createUpdateLocationHandler(options: { store: ScheduleStore }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireManager(request, "manage locations");
    const parsed = parseUpdateLocationInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    try {
      return { location: await options.store.updateLocation(actor.academyId, parsed.value, actor.userId) };
    } catch (error) {
      mapScheduleMutationError(error, "Session"); // reutiliza el mapeo "does not exist" → not-found
    }
  };
}

export function createUpdateProgramHandler(options: { store: ScheduleStore }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireManager(request, "manage class types");
    const parsed = parseUpdateProgramInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    try {
      return { program: await options.store.updateProgramV2(actor.academyId, parsed.value) };
    } catch (error) {
      mapScheduleMutationError(error, "Class");
    }
  };
}

export function createPreviewWeekHandler(options: { store: ScheduleStore }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireManager(request, "preview a week");
    const data = request.data;
    const weekStart = typeof data === "object" && data !== null ? (data as { weekStart?: unknown }).weekStart : undefined;
    if (typeof weekStart !== "string") throw new HttpsError("invalid-argument", "weekStart must be YYYY-MM-DD");
    try {
      const timezone = await academyTimezone(options.store, actor.academyId);
      return { preview: await options.store.previewWeek(actor.academyId, weekStart, timezone) };
    } catch (error) {
      mapWeekError(error);
    }
  };
}

export function createCopyWeekHandler(options: { store: ScheduleStore }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireManager(request, "copy a week");
    const parsed = parseCopyWeekInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    try {
      const timezone = await academyTimezone(options.store, actor.academyId);
      return { sessions: await options.store.copyWeek(actor.academyId, parsed.value, timezone, actor.userId) };
    } catch (error) {
      mapWeekError(error);
    }
  };
}

export function createDeleteWeekHandler(options: { store: ScheduleStore }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireManager(request, "delete a week");
    const parsed = parseDeleteWeekInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    try {
      const timezone = await academyTimezone(options.store, actor.academyId);
      return { sessions: await options.store.deleteWeek(actor.academyId, parsed.value, timezone, actor.userId) };
    } catch (error) {
      mapWeekError(error);
    }
  };
}
```

`createSaveProgramHandler`: antes de `parseCreateProgramInput`, probar `parseCreateProgramInputV2`; si es v2, `store.createProgramV2`; si no, el camino v1 actual. Ampliar el rol permitido a `managerRoles` (hoy `adminRoles`) para que `headCoach` mantenga sus poderes de admin (decisión 2).

Al final del fichero, seis `onCall(scheduleCallableOptions, …)` con el patrón de `listScheduleCatalog`. En `index.ts` añadir `saveLocation, updateLocation, updateProgram, previewWeek, copyWeek, deleteWeek` al bloque `export { … } from "./schedule/schedule-callables.js";`.

- [ ] **Step 4: Ejecutar y ver pasar; guardia probada (LECCIONES §4)**

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule/schedule-callables.test.ts`
Expected: PASS. Comprobar la guardia: cambiar temporalmente `requireManager` para que no lance y confirmar que la prueba de `coach` falla; revertir.

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/schedule/schedule-callables.ts apps/functions/src/schedule/schedule-callables.test.ts apps/functions/src/index.ts
git commit -m "feat(functions): callables for locations, class types v2 and week copy/delete

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Cliente web

**Files:**
- Modify: `apps/web/src/lib/schedule-client.ts` (tras `saveProgram`, línea 150)
- Modify: `apps/web/src/lib/schedule-client.test.ts` (si no existe, crearlo con el patrón de `members-client.test.ts`: `vi.mock("firebase/functions")` devolviendo `httpsCallable` falso)

**Interfaces:**
- Produces: `saveLocation(input: CreateLocationInput): Promise<LocationRecord>`, `updateLocation(input: UpdateLocationInput): Promise<LocationRecord>`, `updateProgram(input: UpdateProgramInput): Promise<ProgramRecord>`, `saveProgramV2(input: CreateProgramInputV2): Promise<ProgramRecord>`, `previewWeek(weekStart: string): Promise<WeekPreview>`, `copyWeek(input: CopyWeekInput): Promise<readonly SessionRecord[]>`, `deleteWeek(input: DeleteWeekInput): Promise<readonly SessionRecord[]>`. Cada una lanza `Error` con texto seguro ("Unable to save the location", …) si la callable falla.

- [ ] **Step 1: Prueba que falla**

```ts
// apps/web/src/lib/schedule-client.test.ts (fragmento nuevo)
it("calls saveLocation and returns the record", async () => {
  callableResult.mockResolvedValueOnce({ data: { location: { locationId: "salle-ouest", name: "Salle Ouest" } } });
  await expect(saveLocation({ name: "Salle Ouest", abbreviation: "ouest", kind: "presential" })).resolves.toMatchObject({ locationId: "salle-ouest" });
  expect(httpsCallableMock).toHaveBeenCalledWith(expect.anything(), "saveLocation", expect.anything());
});

it("hides Firebase errors behind a safe message", async () => {
  callableResult.mockRejectedValueOnce(new Error("internal: boom"));
  await expect(deleteWeek({ weekStart: "2026-09-14", reason: "Closed" })).rejects.toThrow("Unable to delete the week");
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/schedule-client.test.ts`
Expected: FAIL (funciones no exportadas).

- [ ] **Step 3: Implementar**

```ts
import type {
  CopyWeekInput, CreateLocationInput, CreateProgramInputV2, DeleteWeekInput, UpdateLocationInput, UpdateProgramInput, WeekPreview,
} from "@bpt-jersey/domain/schedule/classes-services";

async function callSafely<Req, Res>(name: string, input: Req, failure: string): Promise<Res> {
  const callable = httpsCallable<Req, Res>(getFirebaseFunctions(), name);
  try {
    return (await callable(input)).data;
  } catch {
    throw new Error(failure);
  }
}

export async function saveLocation(input: CreateLocationInput): Promise<LocationRecord> {
  return (await callSafely<CreateLocationInput, { location: LocationRecord }>("saveLocation", input, "Unable to save the location")).location;
}
export async function updateLocation(input: UpdateLocationInput): Promise<LocationRecord> {
  return (await callSafely<UpdateLocationInput, { location: LocationRecord }>("updateLocation", input, "Unable to update the location")).location;
}
export async function saveProgramV2(input: CreateProgramInputV2): Promise<ProgramRecord> {
  return (await callSafely<CreateProgramInputV2, { program: ProgramRecord }>("saveProgram", input, "Unable to save the class type")).program;
}
export async function updateProgram(input: UpdateProgramInput): Promise<ProgramRecord> {
  return (await callSafely<UpdateProgramInput, { program: ProgramRecord }>("updateProgram", input, "Unable to update the class type")).program;
}
export async function previewWeek(weekStart: string): Promise<WeekPreview> {
  return (await callSafely<{ weekStart: string }, { preview: WeekPreview }>("previewWeek", { weekStart }, "Unable to preview the week")).preview;
}
export async function copyWeek(input: CopyWeekInput): Promise<readonly SessionRecord[]> {
  return (await callSafely<CopyWeekInput, { sessions: SessionRecord[] }>("copyWeek", input, "Unable to copy the week")).sessions;
}
export async function deleteWeek(input: DeleteWeekInput): Promise<readonly SessionRecord[]> {
  return (await callSafely<DeleteWeekInput, { sessions: SessionRecord[] }>("deleteWeek", input, "Unable to delete the week")).sessions;
}
```

- [ ] **Step 4: Ejecutar y ver pasar; commit**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/schedule-client.test.ts` → PASS.

```bash
git add apps/web/src/lib/schedule-client.ts apps/web/src/lib/schedule-client.test.ts
git commit -m "feat(web): schedule client for locations, class types v2 and week actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Cáscara `/admin/classes-services`, menú, rutas y redirección

**Files:**
- Create: `apps/web/src/app/admin/classes-services/classes-services-tabs.ts`, `layout.tsx`, `layout.test.tsx`, `classes-services.css`, `page.tsx`
- Create: `apps/web/src/app/admin/classes-services/{memberships,bulk,reports,drop-ins,options,history}/page.tsx`
- Modify: `apps/web/src/app/admin/classes/page.tsx` (redirección), `apps/web/src/app/admin/admin-shell.tsx:45-50`, `apps/web/src/app/admin/admin-routes.ts:10-17`, `admin-routes.test.ts`, `admin-modules.test.tsx` (si enumera rutas)

**Interfaces:**
- Produces: `classesServicesTabs: readonly { label: string; href: string; staffVisible: boolean }[]` en el orden de Regyfit; `ClassesServicesLayout` (Next `layout.tsx`) que renderiza eyebrow `BPT JERSEY / CLASSES & SERVICES`, `<h1>` "Classes / Services", `<nav aria-label="Classes / Services sections">` con `<ul role="tablist">` y enlaces `role="tab"` + `aria-selected`, y `{children}` dentro de `<section role="tabpanel">`.

- [ ] **Step 1: Prueba de la cáscara que falla**

```tsx
// apps/web/src/app/admin/classes-services/layout.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ usePathname: vi.fn(), useAdminOrStaffSession: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: mocks.usePathname }));
vi.mock("../admin-gate", () => ({ useAdminOrStaffSession: mocks.useAdminOrStaffSession }));

import ClassesServicesLayout from "./layout";

describe("Classes / Services layout", () => {
  it("shows the nine tabs to an administrator and marks the current one", () => {
    mocks.usePathname.mockReturnValue("/admin/classes-services/types");
    mocks.useAdminOrStaffSession.mockReturnValue({ role: "administrator" });
    render(<ClassesServicesLayout><p>content</p></ClassesServicesLayout>);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Locations", "Class / Service Types", "Classes & Services 2.0", "Memberships and Vouchers",
      "Bulk Operations", "Listings & Reports", "Drop-ins", "Options", "History",
    ]);
    expect(screen.getByRole("tab", { name: "Class / Service Types" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("content");
  });

  it("shows only the three mat tabs to a coach", () => {
    mocks.usePathname.mockReturnValue("/admin/classes-services/classes");
    mocks.useAdminOrStaffSession.mockReturnValue({ role: "coach" });
    render(<ClassesServicesLayout><p>content</p></ClassesServicesLayout>);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/classes-services/layout.test.tsx`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
// classes-services-tabs.ts
export type ClassesServicesTab = Readonly<{ label: string; href: string; staffVisible: boolean }>;
export const classesServicesTabs: readonly ClassesServicesTab[] = Object.freeze([
  { label: "Locations", href: "/admin/classes-services/locations", staffVisible: true },
  { label: "Class / Service Types", href: "/admin/classes-services/types", staffVisible: true },
  { label: "Classes & Services 2.0", href: "/admin/classes-services/classes", staffVisible: true },
  { label: "Memberships and Vouchers", href: "/admin/classes-services/memberships", staffVisible: false },
  { label: "Bulk Operations", href: "/admin/classes-services/bulk", staffVisible: false },
  { label: "Listings & Reports", href: "/admin/classes-services/reports", staffVisible: false },
  { label: "Drop-ins", href: "/admin/classes-services/drop-ins", staffVisible: false },
  { label: "Options", href: "/admin/classes-services/options", staffVisible: false },
  { label: "History", href: "/admin/classes-services/history", staffVisible: false },
]);
```

```tsx
// layout.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useAdminOrStaffSession } from "../admin-gate";
import { classesServicesTabs } from "./classes-services-tabs";

import "../admin.css";
import "./classes-services.css";

export default function ClassesServicesLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const session = useAdminOrStaffSession();
  const isStaff = session.role === "coach" || session.role === "headCoach";
  const tabs = classesServicesTabs.filter((tab) => !isStaff || tab.staffVisible);
  return (
    <div className="cs-page">
      <p className="admin-eyebrow">BPT Jersey / Classes &amp; Services</p>
      <h1 className="cs-title">Classes / Services</h1>
      <nav aria-label="Classes / Services sections" className="cs-tabs">
        <ul role="tablist">
          {tabs.map((tab) => {
            const current = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            return (
              <li key={tab.href} role="presentation">
                <Link aria-selected={current} href={tab.href} role="tab">{tab.label}</Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <section className="cs-panel" role="tabpanel">{children}</section>
    </div>
  );
}
```

`page.tsx` de la carpeta raíz: componente cliente que hace `router.replace("/admin/classes-services/classes")` en un `useEffect` y muestra "Opening Classes & Services…". Las seis páginas marcadoras (memberships, bulk, reports, drop-ins, options, history) son un `<p className="cs-placeholder">Coming in the next release.</p>` con el `<h2>` del nombre de la pestaña.

`classes-services.css` (base; se amplía en tareas siguientes):

```css
.cs-page { --cs-green: #176b49; --cs-amber: #c98b00; --cs-red: #8d1c2f; }
.cs-title { font-family: var(--font-display), Impact, sans-serif; font-size: clamp(2.6rem, 6vw, 4.5rem); line-height: 1; margin: 0.25rem 0 1rem; text-transform: uppercase; }
.cs-tabs ul { display: flex; flex-wrap: wrap; gap: 0; list-style: none; margin: 0 0 1.25rem; padding: 0; border-bottom: 2px solid var(--mat-ink); }
.cs-tabs a { display: inline-block; padding: 0.8rem 1rem; min-height: 44px; font-weight: 700; letter-spacing: 0.025em; text-transform: uppercase; font-size: 0.8rem; color: var(--mat-ink); text-decoration: none; border-bottom: 0.35rem solid transparent; }
.cs-tabs a[aria-selected="true"] { border-bottom-color: var(--bpt-purple); color: var(--bpt-purple); }
.cs-tabs a:focus-visible { outline: 3px solid var(--bpt-purple); outline-offset: 4px; }
.cs-panel { display: grid; gap: 1.25rem; }
.cs-card { background: var(--gi-white); border-top: 0.35rem solid var(--bpt-purple); padding: 1.25rem; }
.cs-card h2 { font-family: var(--font-display), Impact, sans-serif; font-size: 1.6rem; letter-spacing: 0.035em; line-height: 1; margin: 0 0 1rem; text-transform: uppercase; }
.cs-form-row { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); align-items: end; }
.cs-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.cs-table th { font-size: 0.72rem; letter-spacing: 0.15em; text-transform: uppercase; color: var(--muted); text-align: left; padding: 0.6rem 0.5rem; border-bottom: 1px solid var(--line); }
.cs-table td { padding: 0.6rem 0.5rem; border-bottom: 1px solid var(--paper-edge); vertical-align: middle; }
.cs-notice { padding: 0.75rem 1rem; border-left: 0.35rem solid var(--cs-green); background: #e7f6ee; color: var(--cs-green); }
.cs-notice[data-kind="error"] { border-left-color: var(--cs-red); background: #fff0f2; color: #721626; }
.cs-swatch { display: inline-block; width: 1.25rem; height: 1.25rem; border: 1px solid var(--mat-ink); vertical-align: middle; margin-right: 0.5rem; }
.cs-abbr { display: inline-block; min-width: 3.5rem; padding: 0.2rem 0.4rem; border: 2px solid var(--mat-ink); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
@media (max-width: 50rem) { .cs-table thead { position: absolute; left: -9999px; } .cs-table tr { display: grid; gap: 0.25rem; padding: 0.75rem 0; } .cs-table td { border: 0; padding: 0.15rem 0; } .cs-table td::before { content: attr(data-label); display: block; font-size: 0.72rem; letter-spacing: 0.15em; text-transform: uppercase; color: var(--muted); } }
@media (prefers-reduced-motion: reduce) { .cs-page * { transition: none !important; } }
```

(Las variables `--font-display`, `--mat-ink`, `--bpt-purple`, `--gi-white`, `--muted`, `--line`, `--paper-edge` ya existen en `globals.css`/`admin.css`; si alguna faltara, definirla en `.cs-page` con el valor de DESIGN.md.)

Menú y rutas:
- `admin-shell.tsx`: `{ label: "Classes / Services", href: "/admin/classes-services" }` en lugar de `Classes`.
- `admin-routes.ts`: en `coachRoutes` sustituir `"/admin/classes"` por `"/admin/classes-services"`; como `matches()` acepta subrutas, las pestañas cuelgan de ella. Añadir en `offMenuStaffRoutes` `"/admin/classes"` para que la redirección siga funcionando para coaches.
- `apps/web/src/app/admin/classes/page.tsx`: sustituir el componente exportado por defecto por una redirección (`router.replace("/admin/classes-services/classes")`), conservando `ClassesPage` exportado con nombre solo mientras sus pruebas sigan existiendo; en la Task 10 se borra junto con `class-form.tsx`, `classes-dialog.tsx`, `site-geofence-panel.tsx` y sus pruebas, que quedan sustituidos.
- Actualizar `admin-routes.test.ts` y `admin-shell.spec.ts`/`admin-modules.test.tsx` donde esperan "Classes".

- [ ] **Step 4: Ejecutar y ver pasar**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin` → PASS. `corepack pnpm typecheck` → 0 errores.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin
git commit -m "feat(admin): Classes / Services shell with nine tabs, menu entry and legacy redirect

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Pestaña Locations

**Files:**
- Create: `apps/web/src/app/admin/classes-services/locations/page.tsx`, `page.test.tsx`
- Move: `apps/web/src/app/admin/classes/site-geofence-panel.tsx` → `apps/web/src/app/admin/classes-services/locations/site-geofence-panel.tsx` (y su test), adaptando `LocationId` a `string`.

**Interfaces:**
- Consumes: `getScheduleCatalog`, `saveLocation`, `updateLocation`, `saveLocationGeofence` (Task 5); `useAdminOrStaffSession`.
- Produces: `LocationsPage` (export por defecto y con nombre).

Comportamiento (inventario §1): tarjeta `Create / manage rooms or fields` con `Name`, `Abbreviation`, `Kind` (select Presential / Zoom platform / Jitsi Meet platform) y `Create`; tabla `ROOM / FIELD`, `ABBREVIATION`, `STATUS` (select Active/Inactive, guarda al cambiar), `TYPE` (select, guarda al cambiar), `Edit` (abre `<dialog>` con nombre, abreviatura y el panel de geocerca), y texto "In use" cuando la sede tiene sesiones futuras (no hay botón de borrar). Coaches: sin formulario, selects deshabilitados, sin Edit.

- [ ] **Step 1: Pruebas que fallan**

```tsx
// locations/page.test.tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getScheduleCatalog: vi.fn(), saveLocation: vi.fn(), updateLocation: vi.fn(), saveLocationGeofence: vi.fn(),
  listSessions: vi.fn(), useAdminOrStaffSession: vi.fn(),
}));
vi.mock("../../../../lib/schedule-client", () => ({
  getScheduleCatalog: mocks.getScheduleCatalog, saveLocation: mocks.saveLocation, updateLocation: mocks.updateLocation,
  saveLocationGeofence: mocks.saveLocationGeofence, listSessions: mocks.listSessions,
}));
vi.mock("../../admin-gate", () => ({ useAdminOrStaffSession: mocks.useAdminOrStaffSession }));

import { LocationsPage } from "./page";

const town = { locationId: "town", academyId: "a", name: "BPT Town", address: "", timezone: "Europe/Jersey", active: true, abbreviation: "tow", kind: "presential", schemaVersion: "1" };
const west = { ...town, locationId: "west", name: "BPT West", abbreviation: "wes" };

beforeEach(() => {
  mocks.useAdminOrStaffSession.mockReturnValue({ role: "administrator" });
  mocks.getScheduleCatalog.mockResolvedValue({ locations: [town, west], programs: [] });
  mocks.listSessions.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Locations tab", () => {
  it("lists the sites with abbreviation, status and kind", async () => {
    render(<LocationsPage />);
    expect(await screen.findByText("BPT Town")).toBeInTheDocument();
    expect(screen.getByText("tow")).toBeInTheDocument();
    expect(screen.getAllByRole("combobox", { name: /status/i })).toHaveLength(2);
  });

  it("creates a site and appends it to the table", async () => {
    mocks.saveLocation.mockResolvedValue({ ...town, locationId: "salle-ouest", name: "Salle Ouest", abbreviation: "ouest" });
    render(<LocationsPage />);
    await screen.findByText("BPT Town");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Salle Ouest" } });
    fireEvent.change(screen.getByLabelText("Abbreviation"), { target: { value: "ouest" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mocks.saveLocation).toHaveBeenCalledWith({ name: "Salle Ouest", abbreviation: "ouest", kind: "presential" }));
    expect(await screen.findByText("Salle Ouest")).toBeInTheDocument();
    expect(screen.getByText("Site saved.")).toBeInTheDocument();
  });

  it("saves status changes inline", async () => {
    mocks.updateLocation.mockResolvedValue({ ...west, active: false });
    render(<LocationsPage />);
    await screen.findByText("BPT West");
    fireEvent.change(screen.getAllByRole("combobox", { name: /status/i })[1]!, { target: { value: "inactive" } });
    await waitFor(() => expect(mocks.updateLocation).toHaveBeenCalledWith({ locationId: "west", active: false }));
  });

  it("is read-only for a coach", async () => {
    mocks.useAdminOrStaffSession.mockReturnValue({ role: "coach" });
    render(<LocationsPage />);
    await screen.findByText("BPT Town");
    expect(screen.queryByRole("button", { name: "Create" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("combobox", { name: /status/i })[0]).toBeDisabled();
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar** — `corepack pnpm vitest run --project web apps/web/src/app/admin/classes-services/locations` → FAIL.

- [ ] **Step 3: Implementar `LocationsPage`**

Estructura (React 19, cliente):

```tsx
"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { LocationRecord } from "@bpt-jersey/domain/schedule";
import { locationKinds, type LocationKind } from "@bpt-jersey/domain/schedule/classes-services";
import { getScheduleCatalog, listSessions, saveLocation, saveLocationGeofence, updateLocation } from "../../../../lib/schedule-client";
import { useAdminOrStaffSession } from "../../admin-gate";
import { SiteGeofencePanel } from "./site-geofence-panel";

const kindLabels: Record<LocationKind, string> = { presential: "Presential", zoom: "Zoom platform", jitsi: "Jitsi Meet platform" };
type Notice = Readonly<{ kind: "success" | "error"; message: string }>;

export function LocationsPage() {
  const session = useAdminOrStaffSession();
  const canEdit = session.role !== "coach";
  const [locations, setLocations] = useState<readonly LocationRecord[]>([]);
  const [inUse, setInUse] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [draft, setDraft] = useState({ name: "", abbreviation: "", kind: "presential" as LocationKind });
  const [editing, setEditing] = useState<LocationRecord | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const catalog = await getScheduleCatalog();
        const from = new Date().toISOString();
        const to = new Date(Date.now() + 90 * 86_400_000).toISOString();
        const sessions = await listSessions({ from, to });
        if (!alive) return;
        setLocations(catalog.locations);
        setInUse(new Set(sessions.filter((s) => s.status !== "cancelled").map((s) => s.locationId)));
        setStatus("ready");
      } catch { if (alive) setStatus("error"); }
    })();
    return () => { alive = false; };
  }, []);

  const replace = (record: LocationRecord) =>
    setLocations((current) => current.some((l) => l.locationId === record.locationId)
      ? current.map((l) => (l.locationId === record.locationId ? record : l)) : [...current, record]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    try {
      replace(await saveLocation(draft));
      setDraft({ name: "", abbreviation: "", kind: "presential" });
      setNotice({ kind: "success", message: "Site saved." });
    } catch (error) { setNotice({ kind: "error", message: (error as Error).message }); }
  }

  async function patch(locationId: string, change: { active?: boolean; kind?: LocationKind; name?: string; abbreviation?: string }) {
    try { replace(await updateLocation({ locationId, ...change })); setNotice({ kind: "success", message: "Site updated." }); }
    catch (error) { setNotice({ kind: "error", message: (error as Error).message }); }
  }
  // …render: tarjeta de alta (solo canEdit), aviso, tabla, <dialog> de edición con SiteGeofencePanel
}
export default LocationsPage;
```

Render de la tabla (cada celda con `data-label` para el modo móvil):

```tsx
<table className="cs-table">
  <thead><tr><th>Room / field</th><th>Abbreviation</th><th>Status</th><th>Type</th><th><span className="sr-only">Actions</span></th></tr></thead>
  <tbody>
    {locations.map((location) => (
      <tr key={location.locationId}>
        <td data-label="Room / field"><span className="cs-abbr">{location.abbreviation ?? location.locationId}</span>{location.name}</td>
        <td data-label="Abbreviation">{location.abbreviation ?? "—"}</td>
        <td data-label="Status">
          <select aria-label={`Status of ${location.name}`} disabled={!canEdit} value={location.active ? "active" : "inactive"}
            onChange={(e) => void patch(location.locationId, { active: e.target.value === "active" })}>
            <option value="active">Active</option><option value="inactive">Inactive</option>
          </select>
        </td>
        <td data-label="Type">
          <select aria-label={`Type of ${location.name}`} disabled={!canEdit} value={location.kind ?? "presential"}
            onChange={(e) => void patch(location.locationId, { kind: e.target.value as LocationKind })}>
            {locationKinds.map((kind) => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}
          </select>
        </td>
        <td data-label="Actions">
          {canEdit ? <button className="button button-secondary" type="button" onClick={() => setEditing(location)}>Edit</button> : null}
          {inUse.has(location.locationId) ? <span className="cs-inuse">In use</span> : null}
        </td>
      </tr>
    ))}
  </tbody>
</table>
```

El `<dialog>` de edición: `ref` + `showModal()` cuando `editing` cambia, `onClose` limpia; formulario con `Name`, `Abbreviation` y `Save`; debajo `<SiteGeofencePanel location={editing} onSaved={replace} />` (el panel movido, que llama a `saveLocationGeofence`). Escape cierra el `<dialog>` de forma nativa; el foco vuelve al botón `Edit` (`returnValue` + `useRef` del botón).

- [ ] **Step 4: Ejecutar y ver pasar; commit**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/classes-services/locations` → PASS.

```bash
git add apps/web/src/app/admin/classes-services/locations apps/web/src/app/admin/classes
git commit -m "feat(admin): Locations tab with inline status/type editing and geofence dialog

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Pestaña Class / Service Types

**Files:**
- Create: `apps/web/src/app/admin/classes-services/types/page.tsx`, `page.test.tsx`

**Interfaces:**
- Consumes: `getScheduleCatalog`, `saveProgramV2`, `updateProgram`, `listSessions`.
- Produces: `TypesPage`.

Comportamiento (inventario §2): tarjeta `Create a new class / service type` con `Name`, `Abbreviation`, `Create`; búsqueda por texto; tabla `NAME` (abreviatura en cuadro + nombre), `COLOUR` (input `type="color"` + hex; guarda al cambiar), `STATUS` (checkbox "Active", guarda al cambiar), `TYPE` (select de `programKinds` con las etiquetas de Regyfit: "Class: registrations = weekly/monthly frequency", "Class: unlimited registrations", "Exercise room: registrations = weekly/monthly frequency", "Exercise room: unlimited registrations", "Service"), `DROP-INS / TRIALS` (select: No, Unlimited, Automatic, 1…5 drop-ins/trials), `E-MAIL` (checkbox), `LIST` (checkbox), `MESSAGE` (input + botón `Save`), y `In use` cuando hay sesiones futuras. Coaches: solo lectura.

- [ ] **Step 1: Pruebas que fallan** (mismo arnés que Locations, con `programs` en el catálogo)

```tsx
it("lists types with colour swatch, kind and drop-in policy", async () => {
  render(<TypesPage />);
  expect(await screen.findByText("GI All Levels Evenings")).toBeInTheDocument();
  expect(screen.getByText("LEV_EVE")).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: /kind of GI All Levels Evenings/i })).toHaveValue("class-frequency");
});

it("creates a type from name and abbreviation", async () => {
  mocks.saveProgramV2.mockResolvedValue({ ...program, programId: "p-new", name: "Open Mat Teens", abbreviation: "OM_TEEN" });
  render(<TypesPage />);
  await screen.findByText("GI All Levels Evenings");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Open Mat Teens" } });
  fireEvent.change(screen.getByLabelText("Abbreviation"), { target: { value: "OM_TEEN" } });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(mocks.saveProgramV2).toHaveBeenCalledWith({ name: "Open Mat Teens", abbreviation: "OM_TEEN" }));
  expect(await screen.findByText("Open Mat Teens")).toBeInTheDocument();
});

it("saves the colour, the drop-in policy and the message inline", async () => {
  mocks.updateProgram.mockImplementation(async (input) => ({ ...program, ...input }));
  render(<TypesPage />);
  await screen.findByText("GI All Levels Evenings");
  fireEvent.change(screen.getByLabelText(/colour of GI All Levels Evenings/i), { target: { value: "#d9d7ff" } });
  await waitFor(() => expect(mocks.updateProgram).toHaveBeenCalledWith({ programId: "p1", colour: "#d9d7ff" }));
  fireEvent.change(screen.getByRole("combobox", { name: /drop-ins of GI All Levels Evenings/i }), { target: { value: "3" } });
  await waitFor(() => expect(mocks.updateProgram).toHaveBeenCalledWith({ programId: "p1", dropInPolicy: "3" }));
  fireEvent.change(screen.getByLabelText(/message of GI All Levels Evenings/i), { target: { value: "Bring a gi" } });
  fireEvent.click(screen.getByRole("button", { name: /save message of GI All Levels Evenings/i }));
  await waitFor(() => expect(mocks.updateProgram).toHaveBeenCalledWith({ programId: "p1", message: "Bring a gi" }));
});

it("filters the table by the search box", async () => {
  render(<TypesPage />);
  await screen.findByText("GI All Levels Evenings");
  fireEvent.change(screen.getByRole("searchbox", { name: "Search types" }), { target: { value: "open" } });
  expect(screen.queryByText("GI All Levels Evenings")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Ejecutar y ver fallar** — `corepack pnpm vitest run --project web apps/web/src/app/admin/classes-services/types` → FAIL.

- [ ] **Step 3: Implementar `TypesPage`** con el mismo esqueleto que `LocationsPage` (`programs`, `inUse` de `programId`, `draft {name, abbreviation}`, `patch(programId, change)` → `updateProgram`). Fila:

```tsx
<tr key={program.programId} style={{ "--type-colour": program.colour ?? "#F0EFFF" } as CSSProperties}>
  <td data-label="Name"><span className="cs-abbr">{program.abbreviation ?? "—"}</span>{program.name}</td>
  <td data-label="Colour">
    <span aria-hidden="true" className="cs-swatch" style={{ background: "var(--type-colour)" }} />
    <input aria-label={`Colour of ${program.name}`} disabled={!canEdit} type="color" value={program.colour ?? "#F0EFFF"}
      onChange={(e) => void patch(program.programId, { colour: e.target.value })} />
  </td>
  <td data-label="Status"><label><input type="checkbox" disabled={!canEdit} checked={program.active} onChange={(e) => void patch(program.programId, { active: e.target.checked })} /> Active</label></td>
  <td data-label="Type"><select aria-label={`Kind of ${program.name}`} …>{programKinds.map(…)}</select></td>
  <td data-label="Drop-ins / trials"><select aria-label={`Drop-ins of ${program.name}`} …>{dropInPolicies.map(…)}</select></td>
  <td data-label="E-mail"><input aria-label={`E-mail for ${program.name}`} type="checkbox" checked={program.notifyByEmail ?? false} … /></td>
  <td data-label="List"><input aria-label={`List ${program.name}`} type="checkbox" checked={program.showInList ?? true} … /></td>
  <td data-label="Message">
    <input aria-label={`Message of ${program.name}`} value={messages[program.programId] ?? program.message ?? ""} onChange={…} />
    <button aria-label={`Save message of ${program.name}`} type="button" className="button button-secondary" onClick={() => void patch(program.programId, { message: messages[program.programId] ?? "" })}>Save</button>
  </td>
  <td data-label="In use">{inUse.has(program.programId) ? "In use" : ""}</td>
</tr>
```

Etiquetas de `kind` y `dropInPolicy` en dos `Record`s locales (`kindLabels`, `dropInLabels`: `no → "No"`, `unlimited → "Unlimited"`, `automatic → "Automatic"`, `"1" → "1 drop-in/trial"`, `"2"…"5" → "n drop-ins/trials"`). El swatch es el único lugar donde el color del tipo aparece fuera del calendario (DESIGN.md §10 aplicado por decisión 3).

- [ ] **Step 4: Ejecutar y ver pasar; commit**

```bash
git add apps/web/src/app/admin/classes-services/types
git commit -m "feat(admin): Class / Service Types tab with inline colour, kind, drop-in and message editing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Rejilla semanal pura y vistas de calendario

**Files:**
- Create: `apps/web/src/app/admin/classes-services/classes/week-grid.ts`, `week-grid.test.ts`, `calendar-view.tsx`

**Interfaces:**
- Produces:
  - `type GridSession = { sessionId: string; title: string; startAt: string; endAt: string; colour: string; booked: number; capacity: number | null; status: SessionStatus; locationId: string; programId: string; instructorIds: readonly string[] }`.
  - `weekDays(weekStart: string): readonly string[]` (7 fechas `YYYY-MM-DD`).
  - `mondayOf(date: string): string`.
  - `layoutWeek(sessions: readonly GridSession[], weekStart: string, timezone: string, window: { fromHour: number; toHour: number }): { days: readonly { date: string; label: string; sessions: readonly PlacedSession[]; classes: number; registrations: number }[]; hours: readonly number[] }` donde `PlacedSession = GridSession & { rowStart: number; rowSpan: number; column: number; columns: number }` (filas = medias horas desde `fromHour`; `column/columns` reparte solapes, máximo 2 columnas visibles y el resto cuenta en `overflow`).
  - `dayLabel(date: string): string` → `"MON 14/9"`.
  - `CalendarView` (props: `view: "week" | "month" | "day"`, `weekStart`, `sessions: readonly GridSession[]`, `timezone`, `window`, `onOpen(sessionId)`, `onCreate(date: string, startTime: string)`).

- [ ] **Step 1: Pruebas puras que fallan**

```ts
// week-grid.test.ts
import { describe, expect, it } from "vitest";
import { dayLabel, layoutWeek, mondayOf, weekDays } from "./week-grid";

const base = { colour: "#F0EFFF", booked: 0, capacity: null, status: "scheduled" as const, locationId: "town", programId: "p", instructorIds: ["c"] };

describe("week grid", () => {
  it("finds the Monday of any date and lists the seven days", () => {
    expect(mondayOf("2026-09-16")).toBe("2026-09-14");
    expect(weekDays("2026-09-14")).toEqual(["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"]);
    expect(dayLabel("2026-09-14")).toBe("MON 14/9");
  });

  it("places sessions in half-hour rows of the academy timezone and counts per day", () => {
    const layout = layoutWeek([
      { ...base, sessionId: "a", title: "GI", startAt: "2026-09-14T16:30:00.000Z", endAt: "2026-09-14T17:30:00.000Z", booked: 2, capacity: 40 },
      { ...base, sessionId: "b", title: "NoGI", startAt: "2026-09-14T17:30:00.000Z", endAt: "2026-09-14T18:30:00.000Z", booked: 3 },
    ], "2026-09-14", "Europe/Jersey", { fromHour: 6, toHour: 20 });
    const monday = layout.days[0]!;
    expect(monday.classes).toBe(2);
    expect(monday.registrations).toBe(5);
    expect(monday.sessions[0]).toMatchObject({ sessionId: "a", rowStart: 23, rowSpan: 2, column: 0, columns: 1 }); // 17:30 local = fila (17.5-6)*2 = 23
    expect(layout.hours).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it("splits overlapping sessions into columns, at most two", () => {
    const at = (h: string) => `2026-09-14T${h}:00.000Z`;
    const layout = layoutWeek([
      { ...base, sessionId: "a", title: "A", startAt: at("06:00"), endAt: at("07:00") },
      { ...base, sessionId: "b", title: "B", startAt: at("06:00"), endAt: at("07:00") },
      { ...base, sessionId: "c", title: "C", startAt: at("06:30"), endAt: at("07:30") },
    ], "2026-09-14", "Europe/Jersey", { fromHour: 6, toHour: 20 });
    const placed = layout.days[0]!.sessions;
    expect(placed.map((s) => [s.sessionId, s.column, s.columns])).toEqual([["a", 0, 2], ["b", 1, 2], ["c", 0, 2]]);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar** — `corepack pnpm vitest run --project web apps/web/src/app/admin/classes-services/classes/week-grid.test.ts`.

- [ ] **Step 3: Implementar `week-grid.ts`**

```ts
import type { SessionStatus } from "@bpt-jersey/domain/schedule";

export type GridSession = Readonly<{ sessionId: string; title: string; startAt: string; endAt: string; colour: string; booked: number; capacity: number | null; status: SessionStatus; locationId: string; programId: string; instructorIds: readonly string[] }>;
export type PlacedSession = GridSession & Readonly<{ rowStart: number; rowSpan: number; column: number; columns: number }>;
export type DayLayout = Readonly<{ date: string; label: string; sessions: readonly PlacedSession[]; classes: number; registrations: number }>;

const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function ymd(date: Date): string { return date.toISOString().slice(0, 10); }

export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  return ymd(new Date(d.getTime() - offset * 86_400_000));
}

export function weekDays(weekStart: string): readonly string[] {
  const start = new Date(`${weekStart}T00:00:00.000Z`).getTime();
  return Array.from({ length: 7 }, (_, i) => ymd(new Date(start + i * 86_400_000)));
}

export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  return `${dayNames[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

/** Local calendar date and fractional hour of an instant in the academy timezone. */
export function localParts(iso: string, timezone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) + Number(get("minute")) / 60 };
}

export function layoutWeek(sessions: readonly GridSession[], weekStart: string, timezone: string, window: { fromHour: number; toHour: number }) {
  const hours = Array.from({ length: window.toHour - window.fromHour + 1 }, (_, i) => window.fromHour + i);
  const days = weekDays(weekStart).map((date) => {
    const own = sessions
      .map((s) => ({ s, start: localParts(s.startAt, timezone), end: localParts(s.endAt, timezone) }))
      .filter(({ start }) => start.date === date)
      .sort((a, b) => a.start.hour - b.start.hour || a.s.title.localeCompare(b.s.title));
    const placed: PlacedSession[] = [];
    const active: { end: number; column: number }[] = [];
    for (const { s, start, end } of own) {
      for (let i = active.length - 1; i >= 0; i -= 1) if (active[i]!.end <= start.hour) active.splice(i, 1);
      const column = active.some((a) => a.column === 0) ? 1 : 0;
      active.push({ end: end.hour, column });
      const rowStart = Math.max(0, Math.round((start.hour - window.fromHour) * 2));
      const rowSpan = Math.max(1, Math.round((end.hour - start.hour) * 2));
      placed.push({ ...s, rowStart, rowSpan, column, columns: 1 });
    }
    // second pass: every session that overlapped anything gets two columns
    const columns = placed.map((p) => placed.some((q) => q !== p && q.rowStart < p.rowStart + p.rowSpan && p.rowStart < q.rowStart + q.rowSpan) ? 2 : 1);
    const final = placed.map((p, i) => ({ ...p, columns: columns[i]! }));
    return Object.freeze({
      date, label: dayLabel(date), sessions: Object.freeze(final),
      classes: own.filter(({ s }) => s.status !== "cancelled").length,
      registrations: own.reduce((sum, { s }) => sum + (s.status === "cancelled" ? 0 : s.booked), 0),
    });
  });
  return Object.freeze({ days: Object.freeze(days), hours: Object.freeze(hours) });
}
```

- [ ] **Step 4: `calendar-view.tsx`** — vista semana como CSS Grid: primera columna de horas (`hours`), siete columnas de día; cada día es un `div` con `display: grid; grid-template-rows: repeat(n, 1.6rem); grid-template-columns: repeat(2, minmax(0,1fr))`; cada sesión un `<button type="button" className="cs-event" style={{ gridRow: `${rowStart + 1} / span ${rowSpan}`, gridColumn: columns === 2 ? `${column + 1}` : "1 / span 2", background: colour }} onClick={() => onOpen(sessionId)}>` con título, `HH:MM - HH:MM` y chip `booked / (capacity ?? "∞")`; las sesiones canceladas llevan `data-status="cancelled"` (texto tachado, fondo Paper Edge). Celdas vacías: `<button className="cs-slot" aria-label={`Create a class on ${label} at ${hh}:${mm}`} onClick={() => onCreate(date, time)} />` por media hora (solo `canEdit`). Cabecera de día: `label` + `n classes · n registrations`. Vista mes: rejilla 7×n con el recuento por día y clic = cambia a la semana. Vista día: la misma rejilla con una sola columna. En móvil (`max-width: 50rem`) la semana muestra dos días por pantalla con scroll horizontal (`overflow-x: auto; scroll-snap-type: x mandatory`). Estilos en `classes-services.css` (`.cs-week`, `.cs-day`, `.cs-event`, `.cs-slot`, `.cs-hours`).

- [ ] **Step 5: Ejecutar y commit**

`corepack pnpm vitest run --project web apps/web/src/app/admin/classes-services/classes` → PASS (solo week-grid por ahora).

```bash
git add apps/web/src/app/admin/classes-services/classes apps/web/src/app/admin/classes-services/classes-services.css
git commit -m "feat(admin): pure week layout and calendar views for Classes & Services 2.0

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Página Classes & Services 2.0: filtros, contadores, lista, panel de sesión, inscripciones, semana

**Files:**
- Create: `classes/page.tsx`, `page.test.tsx`, `list-view.tsx`, `session-panel.tsx`, `session-panel.test.tsx`, `registrations-panel.tsx`, `registrations-panel.test.tsx`, `week-actions.tsx`, `week-actions.test.tsx`
- Delete: `apps/web/src/app/admin/classes/class-form.tsx`, `class-form.test.tsx`, `classes-dialog.tsx`, `page.test.tsx`, `classes.css` (la página `classes/page.tsx` queda solo como redirección)

**Interfaces:**
- Consumes: `getScheduleCatalog`, `listSessions`, `listSessionBookedCounts`, `saveSession`, `updateSession`, `cancelSession`, `listSessionBookings`, `requestBooking`, `cancelBooking`, `previewWeek`, `copyWeek`, `deleteWeek` (schedule-client); `listStaffProfiles` (staff-client); `listMembers` (members-client); `getFamily`/`listFamilies` (families-client, para GROUP); `useAdminOrStaffSession`.
- Produces: `ClassesPage`; `SessionPanel` (props `mode: "create" | "edit"`, `session?`, `catalog`, `staff`, `defaults?: { date, startTime }`, `onSaved`, `onCancelled`, `onClose`, `canEdit`), `RegistrationsPanel` (props `session`, `canEdit`), `WeekActions` (props `weekStart`, `onChanged`).

Comportamiento (inventario §3): cabecera con `CALENDAR` / `LIST` (botones `role="tab"` internos), contadores `CLASSES`, `REGISTRATIONS`, `OCCUPANCY %`, `TOTAL` (sesiones no canceladas del rango cargado, suma de `booked`, `booked/capacidad finita`, total de sesiones del año en curso mediante una segunda consulta `listSessions` de enero a diciembre cacheada); filtros `Locations`, `Types`, `Staff` (multiselección con `<select multiple>`), `Mine` (checkbox: `instructorIds` incluye al actor), `Active / Inactive` (estado); navegación ‹ › `Today`, `<input type="date">`, título `14 – 20 SEP 2026`, `Copy week`, `Delete week`, `Month | Week | Day`.

- [ ] **Step 1: Pruebas que fallan de `page.test.tsx`** (arnés como el de `admin/classes/page.test.tsx` actual: `vi.mock` de los cuatro clientes y del gate)

```tsx
it("loads the week and shows counters and one card per session", async () => {
  render(<ClassesPage />);
  expect(await screen.findByRole("button", { name: /GI All Levels Evenings/ })).toBeInTheDocument();
  expect(screen.getByText("2")).toBeInTheDocument();           // CLASSES
  expect(screen.getByText(/registrations/i)).toBeInTheDocument();
  expect(mocks.listSessions).toHaveBeenCalledWith(expect.objectContaining({ from: expect.stringContaining("2026-09-13T23:00") }));
});

it("filters by location and by mine", async () => {
  render(<ClassesPage />);
  await screen.findByRole("button", { name: /GI All Levels Evenings/ });
  fireEvent.change(screen.getByRole("listbox", { name: "Locations" }), { target: { value: "west" } });
  expect(screen.queryByRole("button", { name: /GI All Levels Evenings/ })).not.toBeInTheDocument();
});

it("opens the session panel from a card and saves an edit", async () => {
  mocks.updateSession.mockImplementation(async (input) => ({ ...sessionFixture, ...input }));
  render(<ClassesPage />);
  fireEvent.click(await screen.findByRole("button", { name: /GI All Levels Evenings/ }));
  const dialog = await screen.findByRole("dialog", { name: /Create classes\/services/i });
  fireEvent.change(within(dialog).getByLabelText("Maximum capacity"), { target: { value: "" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
  await waitFor(() => expect(mocks.updateSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "s1", capacity: null })));
});

it("switches to the list view and exports CSV", async () => {
  render(<ClassesPage />);
  await screen.findByRole("button", { name: /GI All Levels Evenings/ });
  fireEvent.click(screen.getByRole("tab", { name: "List" }));
  expect(await screen.findByRole("table")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Excel" })).toBeInTheDocument();
});

it("keeps a coach read-only", async () => {
  mocks.useAdminOrStaffSession.mockReturnValue({ role: "coach", userId: "coach-1" });
  render(<ClassesPage />);
  await screen.findByRole("button", { name: /GI All Levels Evenings/ });
  expect(screen.queryByRole("button", { name: "Copy week" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Pruebas de `session-panel.test.tsx`**

```tsx
it("creates a session with several trainers, unlimited capacity and custom rules", async () => {
  mocks.saveSession.mockResolvedValue(sessionFixture);
  const onSaved = vi.fn();
  render(<SessionPanel mode="create" catalog={catalog} staff={staff} defaults={{ date: "2026-09-14", startTime: "17:30" }} canEdit onSaved={onSaved} onCancelled={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Class/service type"), { target: { value: "p1" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Coach A" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Coach B" }));
  fireEvent.change(screen.getByLabelText("Booking and cancellation"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("Allow bookings until (minutes before)"), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(mocks.saveSession).toHaveBeenCalledWith(expect.objectContaining({
    programId: "p1", locationId: "town", instructorId: "coach-a", instructorIds: ["coach-a", "coach-b"], capacity: null,
    startAt: "2026-09-14T16:30:00.000Z", endAt: "2026-09-14T17:30:00.000Z",
    bookingRules: expect.objectContaining({ bookUntilMinutesBefore: 30 }),
  })));
  expect(onSaved).toHaveBeenCalled();
});

it("cancels a session with a reason", async () => {
  mocks.cancelSession.mockResolvedValue({ ...sessionFixture, status: "cancelled" });
  render(<SessionPanel mode="edit" session={sessionFixture} catalog={catalog} staff={staff} canEdit onSaved={vi.fn()} onCancelled={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Coach unavailable" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(mocks.cancelSession).toHaveBeenCalledWith("s1", "Coach unavailable"));
});

it("copies a session into a new draft", () => {
  render(<SessionPanel mode="edit" session={sessionFixture} catalog={catalog} staff={staff} canEdit onSaved={vi.fn()} onCancelled={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  expect(screen.getByLabelText("Date")).toHaveValue("2026-09-14");
});
```

- [ ] **Step 3: Pruebas de `registrations-panel.test.tsx`**

```tsx
it("lists confirmed bookings with a remove button and enrols a member by search", async () => {
  mocks.listSessionBookings.mockResolvedValue([{ bookingId: "b1", sessionId: "s1", studentId: "st1", status: "confirmed" }]);
  mocks.listMembers.mockResolvedValue({ rows: [{ studentId: "st2", fullName: "Willow S.", membershipNumber: "42" }] });
  mocks.requestBooking.mockResolvedValue({ bookingId: "b2", sessionId: "s1", studentId: "st2", status: "confirmed" });
  render(<RegistrationsPanel session={sessionFixture} canEdit />);
  expect(await screen.findByRole("button", { name: /remove/i })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox", { name: "Enrol a member of this gym" }), { target: { value: "wi" } });
  fireEvent.click(await screen.findByRole("button", { name: "Willow S." }));
  await waitFor(() => expect(mocks.requestBooking).toHaveBeenCalledWith({ sessionId: "s1", studentId: "st2" }));
});

it("enrols every student of a family from the Group tab", async () => {
  mocks.listFamilies.mockResolvedValue([{ familyId: "f1", label: "Scally family", students: [{ studentId: "st3" }, { studentId: "st4" }] }]);
  mocks.requestBooking.mockResolvedValue({ bookingId: "b", sessionId: "s1", studentId: "st3", status: "confirmed" });
  render(<RegistrationsPanel session={sessionFixture} canEdit />);
  fireEvent.click(screen.getByRole("tab", { name: "Group" }));
  fireEvent.click(await screen.findByRole("button", { name: "Scally family" }));
  await waitFor(() => expect(mocks.requestBooking).toHaveBeenCalledTimes(2));
});

it("explains that External registrations arrive with Drop-ins", () => {
  render(<RegistrationsPanel session={sessionFixture} canEdit />);
  fireEvent.click(screen.getByRole("tab", { name: "External" }));
  expect(screen.getByText(/Drop-in registrations arrive with the Drop-ins release/i)).toBeInTheDocument();
});
```

(`listFamilies` es la función de `families-client.ts` que devuelve las familias con sus alumnos; si el nombre real difiere, usar el existente — comprobar con `grep -n "^export async function" apps/web/src/lib/families-client.ts`.)

- [ ] **Step 4: Pruebas de `week-actions.test.tsx`**

```tsx
it("previews before copying a week and reports the result", async () => {
  mocks.previewWeek.mockResolvedValue({ count: 3, sample: [] });
  mocks.copyWeek.mockResolvedValue([{}, {}, {}]);
  const onChanged = vi.fn();
  render(<WeekActions weekStart="2026-09-14" onChanged={onChanged} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy week" }));
  const dialog = await screen.findByRole("dialog", { name: "Copy week" });
  expect(within(dialog).getByText("3 classes will be copied to the week of 21 Sep 2026.")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(mocks.copyWeek).toHaveBeenCalledWith({ fromWeekStart: "2026-09-14", toWeekStart: "2026-09-21", copyBookings: false }));
  expect(onChanged).toHaveBeenCalled();
});

it("requires a reason to delete a week", async () => {
  mocks.previewWeek.mockResolvedValue({ count: 2, sample: [] });
  mocks.deleteWeek.mockResolvedValue([{}, {}]);
  render(<WeekActions weekStart="2026-09-14" onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete week" }));
  const dialog = await screen.findByRole("dialog", { name: "Delete week" });
  expect(within(dialog).getByRole("button", { name: "Delete" })).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Closed for the bank holiday" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(mocks.deleteWeek).toHaveBeenCalledWith({ weekStart: "2026-09-14", reason: "Closed for the bank holiday" }));
});
```

- [ ] **Step 5: Ejecutar y ver fallar** — `corepack pnpm vitest run --project web apps/web/src/app/admin/classes-services/classes` → FAIL en los cuatro ficheros nuevos.

- [ ] **Step 6: Implementar**

`page.tsx` (esqueleto de estado):

```tsx
type View = "calendar" | "list";
type Range = "week" | "month" | "day";
const [view, setView] = useState<View>("calendar");
const [range, setRange] = useState<Range>("week");
const [weekStart, setWeekStart] = useState(() => mondayOf(new Date().toISOString().slice(0, 10)));
const [sessions, setSessions] = useState<readonly SessionRecord[]>([]);
const [booked, setBooked] = useState<Readonly<Record<string, number>>>({});
const [filters, setFilters] = useState({ locations: [] as string[], programs: [] as string[], staff: [] as string[], mine: false, status: "active" as "active" | "inactive" | "all" });
const [panel, setPanel] = useState<null | { mode: "create"; defaults: { date: string; startTime: string } } | { mode: "edit"; sessionId: string }>(null);
```

Carga: `weekRangeFor(weekStart, timezone)` (importado del dominio; `timezone` = la de la primera sede) → `listSessions(range)` → `listSessionBookedCounts(ids)`; para `month`, cargar de lunes a domingo del mes (5–6 semanas) en una sola consulta. `GridSession` se construye con `colour = programs.find(...)?.colour ?? "#F0EFFF"`, `booked = booked[sessionId] ?? 0`, `instructorIds = session.instructorIds ?? [session.instructorId]`. Filtro `status`: `active` = `scheduled|active`, `inactive` = `cancelled|completed`.

Contadores: `classes = visibles no canceladas`, `registrations = Σ booked`, `occupancy = Math.round(100 * registrations / Σ capacity finita)` (si no hay capacidad finita, "—"), `total` = número de sesiones del año (consulta `listSessions({ from: 1 ene, to: 31 dic })` una vez, contadas sin filtros).

`list-view.tsx`: filtros `Date range` (Today, Yesterday, Day before yesterday, Last 7 days, This week, Last week, This month, Last month, This year → calcula `from/to`), `From`, `To`, `Location`, `Class`, `Trainers`, `Sort by` (Date/time, Class type, Location), `Records` (10…190), `Search`, `Excel` (genera CSV en cliente con `Blob` y `<a download="classes.csv">`; ponytail: CSV en lugar de XLSX hasta que el canal de `exports` del Plan 3 lo sustituya), `Today's classes/services`. Tabla: `Edit` (abre el panel), abreviatura + título + "Class", `Location`, `Trainers`, `Date`, `Time`, `Registrations` (`n / cap`), `Attendance` (enlace a `/admin/attendance?session=<id>`; la marca de asistencia ya vive allí), `Results` (enlace a `/admin/classes-services/classes?session=<id>`).

`session-panel.tsx`: `<dialog aria-labelledby>` con título "Create classes/services", secciones `When` (`Date`, `Start time`, `End time` — `type="date"`/`type="time"` nativos), `Class and location` (`Class/service location`, `Class/service type`, `Maximum capacity` — input numérico vacío = ilimitado, con texto de ayuda "Leave empty for no limit"), `Trainers` (lista de `<label><input type="checkbox">` por miembro de `staff`, con su color de coach a la izquierda como regla de 0.35rem si el perfil lo tiene), `Booking rules` (`Booking and cancellation`: "According to the defined rules" / "Specific rules" que despliega `Allow bookings until (minutes before)`, `Allow cancellations until` [start/end/custom minutes], `Allow bookings with an advance of (minutes)`; `Waiting list for registrations`: general/on/off). Botones: `Delete` (abre confirmación con `Reason`), `Message` (deshabilitado, `title="Coming with announcements"`), `Copy` (pasa a `mode: "create"` con los mismos valores y la fecha de hoy), `Cancel` (cierra), `Edit`/`Create`. La conversión fecha+hora local → ISO usa `localMidnightUtc(date, timezone) + minutos` (helper del dominio) para que el resultado sea estable en cualquier zona del navegador. En `edit`, a la derecha del panel se monta `<RegistrationsPanel>`; en móvil va debajo.

`registrations-panel.tsx`: pestañas `Member` / `Group` / `External` (`role="tablist"` con botones); `Member`: `<input type="search" aria-label="Enrol a member of this gym">` que a partir de 2 letras llama a `listMembers({ search })` (debounce 250 ms) y lista botones con el nombre; clic → `requestBooking({ sessionId, studentId })`; lista de inscritos con nombre (resuelto de `listMembers` por id o del `bookingId`) y botón `Remove` → `cancelBooking({ sessionId, studentId })`. `Group`: `listFamilies()` con buscador; clic → una `requestBooking` por alumno (errores individuales se muestran, no detienen el resto). `External`: párrafo "Drop-in registrations arrive with the Drop-ins release." (Plan 2).

`week-actions.tsx`: dos botones y dos `<dialog>`; al abrir, `previewWeek(weekStart)` y texto `"{count} classes will be copied to the week of {d MMM yyyy}."` / `"{count} classes will be cancelled."`; `Copy` con checkbox `Copy bookings as well`; `Delete` deshabilitado hasta que `reason.trim().length >= 2`.

Borrar los ficheros antiguos de `admin/classes/` listados arriba y dejar `classes/page.tsx` solo con la redirección; mover a `classes-services.css` las reglas de `classes.css` que sigan usándose (`.schedule-admin-*` → renombrar a `.cs-*`) y eliminar el resto.

- [ ] **Step 7: Ejecutar y ver pasar**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin` → PASS; `corepack pnpm typecheck && corepack pnpm lint` → 0 errores/avisos.

- [ ] **Step 8: Commit**

```bash
git add -A apps/web/src/app/admin
git commit -m "feat(admin): Classes & Services 2.0 — calendar, list, session panel, registrations and week actions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Reglas de Firestore, índices y prueba de frontera

**Files:**
- Modify: `qa/rules/schedule-boundary.test.ts`
- Verify: `firestore.rules:134-160`, `firestore.indexes.json`

Las tres colecciones (`locations`, `programs`, `sessions`) ya están cerradas (`allow read, write: if false`) y los índices `(locationId, startAt)` y `(programId, startAt)` ya existen; este plan no añade consultas nuevas con filtros distintos (`copyWeek`/`deleteWeek` usan `startAt` en rango). No cambia nada; se prueba que un `headCoach` tampoco escribe una sede directamente.

- [ ] **Step 1: Añadir la prueba** (en `schedule-boundary.test.ts`, con el patrón del fichero)

```ts
it("keeps locations closed to direct writes even for head coaches", async () => {
  const headCoach = testEnvironment.authenticatedContext("hc-1", { academyId: "academy-1", role: "headCoach" });
  await assertFails(setDoc(doc(headCoach.firestore(), "academies/academy-1/locations/salle-ouest"), { name: "Salle Ouest" }));
  await assertFails(getDoc(doc(headCoach.firestore(), "academies/academy-1/locations/town")));
});
```

- [ ] **Step 2: Ejecutar** — `FUNCTIONS_DISCOVERY_TIMEOUT=300000 corepack pnpm test:rules` (necesita JDK 21; en este VPS, dentro del contenedor `bpt-emu:local --network none` según la memoria del proyecto). Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add qa/rules/schedule-boundary.test.ts
git commit -m "test(rules): locations stay closed to direct access

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Playwright de las tres pestañas, capturas y verificación completa

**Files:**
- Create: `qa/tests/admin-classes-services.spec.ts`
- Modify: `tasksv2.md` (fila T046V2), `docs/adr/ADR-010-coach-office-powers.md` (una línea: la ruta de coach pasa a `/admin/classes-services`)

- [ ] **Step 1: Escribir la spec** (patrón de `admin-classes-form.spec.ts`: `installAdminFixture` con `callables` sintéticas; sin datos reales)

```ts
import { expect, test } from "@playwright/test";
import { installAdminFixture, type CallableCall } from "./admin-fixture";

const catalog = { locations: [/* town, west con abbreviation/kind */], programs: [/* dos tipos con colour */] };
const sessions = [/* dos sesiones la semana del 14 sep 2026, una con capacity null */];

test.describe("@classes-services", () => {
  test("locations: create and toggle status", async ({ page }) => {
    const calls: CallableCall[] = [];
    await installAdminFixture(page, { calls, callables: {
      listScheduleCatalog: catalog, listSessions: { sessions: [] },
      saveLocation: (body) => ({ location: { ...catalog.locations[0], locationId: "salle-ouest", ...(body as { data: object }).data } }),
      updateLocation: (body) => ({ location: { ...catalog.locations[1], ...(body as { data: object }).data } }),
    } });
    await page.goto("/admin/classes-services/locations");
    await expect(page.getByRole("tab", { name: "Locations" })).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Name").fill("Salle Ouest");
    await page.getByLabel("Abbreviation").fill("ouest");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Salle Ouest")).toBeVisible();
    await page.getByRole("combobox", { name: "Status of BPT West" }).selectOption("inactive");
    await expect.poll(() => calls.some((c) => c.name === "updateLocation")).toBe(true);
    await page.screenshot({ path: "qa/screenshots/cs-locations.png", fullPage: true });
  });

  test("types: inline colour and drop-in policy", async ({ page }) => { /* análogo con updateProgram */ });

  test("classes: week calendar, session panel and copy week preview", async ({ page }) => {
    await installAdminFixture(page, { callables: {
      listScheduleCatalog: catalog, listSessions: { sessions }, listSessionBookedCounts: { counts: { s1: 2, s2: 3 } },
      listStaffProfiles: { profiles: [] }, previewWeek: { preview: { count: 2, sample: [] } }, copyWeek: { sessions },
    } });
    await page.clock.setFixedTime(new Date("2026-09-16T10:00:00Z"));
    await page.goto("/admin/classes-services/classes");
    await expect(page.getByText("14 – 20 SEP 2026")).toBeVisible();
    await page.getByRole("button", { name: /GI All Levels Evenings/ }).click();
    await expect(page.getByRole("dialog", { name: /Create classes\/services/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Copy week" }).click();
    await expect(page.getByText("2 classes will be copied to the week of 21 Sep 2026.")).toBeVisible();
    await page.screenshot({ path: "qa/screenshots/cs-classes-week.png", fullPage: true });
    await page.getByRole("tab", { name: "List" }).click();
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("coach sees three tabs and no mutations", async ({ page }) => {
    await installAdminFixture(page, { role: "coach", callables: { listScheduleCatalog: catalog, listSessions: { sessions }, listSessionBookedCounts: { counts: {} }, listStaffProfiles: { profiles: [] } } });
    await page.goto("/admin/classes-services/classes");
    await expect(page.getByRole("tab")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Copy week" })).toHaveCount(0);
  });
});
```

Ejecutar en los dos proyectos (`desktop-chromium`, `mobile-chromium`); las capturas móviles llevan sufijo `-phone`.

- [ ] **Step 2: Construir y ejecutar**

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm --filter @bpt-jersey/web build
BASE_URL=http://127.0.0.1:3100 corepack pnpm --dir qa exec playwright test admin-classes-services --project=desktop-chromium --project=mobile-chromium
```

(servir `apps/web/out` en 3100 con `npx serve`? No: usar el servidor estático que ya define `qa/playwright.config.ts` `webServer`, o el contenedor Caddy de :9471 según la memoria del proyecto.) Expected: 8 pruebas en verde y cuatro capturas en `qa/screenshots/cs-*.png`. Abrir las capturas y compararlas con `/root/regyfit-capture/raw/01-locations`, `02-class-service-types`, `03-aulas-servicos-2` (disposición y campos, no colores).

- [ ] **Step 3: Verificación completa**

Run: `corepack pnpm verify:mvp` → todo verde. Si el paso de reglas no puede correr en esta máquina, ejecutar `test:rules` en el contenedor de emuladores y anotarlo en la evidencia.

- [ ] **Step 4: Ledger y ADR**

En `tasksv2.md`, fila `T046V2`: estado `revision` y evidencia con los comandos y recuentos reales (pruebas de dominio, functions, web, rules, Playwright, capturas). En `ADR-010`, añadir bajo la enmienda del 2026-09-14: "2026-09-16: la ruta de coach `/admin/classes` pasa a `/admin/classes-services` (Locations, Types y Classes & Services 2.0 en solo lectura para `coach`)."

- [ ] **Step 5: Commit**

```bash
git add qa/tests/admin-classes-services.spec.ts qa/screenshots/cs-*.png tasksv2.md docs/adr/ADR-010-coach-office-powers.md
git commit -m "test(e2e): Classes / Services tabs on desktop and phone; ledger T046V2

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- **Cobertura de la spec (decisiones 1–6, 14, 19):** 1 → Task 6; 2 → Tasks 6 y 12 (redirección, menú, rutas de coach, ADR-010); 3 → CSS de Task 6 y swatch/tarjetas de Tasks 8–9; 4 → Tasks 1–3, 7; 5 → Tasks 1, 3, 8; 6 → Tasks 2–5, 9–10 (EXTERNAL queda documentado para el Plan 2, decisión 9); 14 → Tasks 11–12; 19 → Task 0.
- **Sin marcadores:** cada paso lleva código o comando; los dos puntos que dependen de nombres existentes (`listFamilies`, arnés de aforo) indican el `grep` para resolverlos.
- **Tipos coherentes:** `capacity: number | null`, `instructorIds`, `bookingRules`, `waitingList` se definen en Task 2 y se usan igual en Tasks 3, 4, 9 y 10; `WeekPreview`, `CopyWeekInput`, `DeleteWeekInput` en Task 1 y en Tasks 3–5 y 10; los nombres de callables coinciden entre Task 4 (`onCall`), Task 5 (cliente) y Task 12 (fixture).
