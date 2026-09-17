# Classes / Services Plan 4a: import Regyfit types and sessions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the Regyfit class/service types and the scheduled classes already captured in
`/root/regyfit-capture/data/` into Firestore (emulator first), so the Classes & Services 2.0
calendar shows the real week of 14–20 Sep 2026.

**Architecture:** A pure ESM module (`qa/scripts/regyfit-classes-services-map.mjs`, typed by a
`.d.mts`) turns the capture JSON into `ProgramRecord` and `SessionRecord` documents with
deterministic ids and a target guard; a thin CLI (`qa/scripts/regyfit-classes-services-import.mjs`)
reads the capture, dry-runs by default and writes with `firebase-admin` batches. An opt-in emulator
Playwright spec proves, on a synthetic capture, that imported sessions reach the calendar through
real Auth, Functions and Firestore.

**Tech Stack:** Node 22 ESM, `firebase-admin` (resolved from `apps/functions`), Vitest (`node`
project, `qa/unit`), Playwright against the static export with Firebase Emulators in Docker.

**Spec:** `docs/superpowers/specs/2026-09-16-regyfit-classes-services-clone-design.md`
(decisions 5, 6, 13, 16, 17). Evidence: `docs/data/migrations/regyfit/classes-services-inventory.md`.

## Scope of 4a (and what is deliberately left out)

The spec's Plan 4 (T049V2) imports catalogue → sessions → registrations → drop-ins → history.
Only the first two are importable today:

- The capture holds the type catalogue (31 types) and the class list (177 rows, 8 Sep – 18 Oct
  2026). It has **no** per-class registrations or attendance (spec decision 16 needs the capture
  script to open each class; not done).
- Drop-ins need Plan 2 (T047V2), history needs Plan 3 (T048V2).

So 4a = types + sessions. Registrations (`booked`) are **not** written: the calendar's
REGISTRATIONS counter comes from `listSessionBookedCounts` over real booking documents, and those
need people matched to `students` (decision 17). Plan 4b covers that after the per-class capture.

## Global Constraints

- Raw capture stays outside the repository: `/root/regyfit-capture/`. The importer refuses any
  capture directory inside the repo except the synthetic fixture
  `qa/fixtures/regyfit-classes-services-synthetic/`.
- Emulator first. Production writes need `REGYFIT_IMPORT_TARGET=production`,
  `GCLOUD_PROJECT=bptjersey-f5a25` and `REGYFIT_OPERATOR_CONFIRMATION=classes-services-types-sessions-production-v1`,
  and are **not** part of this plan: they happen only after the operator confirms in chat.
- Emulator project id is `demo-bpt-jersey`; `FIRESTORE_EMULATOR_HOST` must be loopback.
- On this VPS emulators run in Docker `bpt-emu:local --network none` (port 8080 on the host is
  code-server). Materialise `Lista Listav2 .cronos` with sparse-checkout before `typecheck`/`test`
  and restore afterwards. Never run prettier on `tasksv2.md`.
- Academy timezone is `Europe/Jersey`; every `startAt`/`endAt` is a UTC ISO string with
  milliseconds (`2026-09-14T05:00:00.000Z`), because `listSessions` compares them as strings.
- The capture's `week` field is wrong (rows tagged `2026-09-01` hold 16 Sep classes). Dates come
  **only** from the DATE cell.
- Session title = Regyfit type name (the list appends ` AULA`); the type is found by that name.
- Operator ruling 2026-09-17: a class whose `endAt <= now` is imported as `status: "completed"`,
  any other as `"scheduled"`. Past classes stay findable through the existing Status filter
  (`Inactive` or `All`, `statusMatches` in `classes-filters.tsx`); no UI change is needed.
  `now` is injectable (`REGYFIT_IMPORT_NOW`) so tests are deterministic.
- Programs keep `schemaVersion: "1"` with the v2 fields added (same shape as `buildProgramV2`,
  `apps/functions/src/schedule/schedule-service.ts:538`).
- Operator ruling 2026-09-17: the Regyfit types are the real catalogue and replace the seven
  default programs (writing `academies/{id}/programs` already stops `listPrograms` falling back to
  them). The import does not touch or delete other program documents.
- Operator ruling 2026-09-17: trainers stay as Regyfit keys, `instructorId = "regyfit-trainer-<slug>"`,
  not matched to `staff`. The importer prints the distinct trainer list.
- Code, identifiers and UI copy in English; ledger and docs in Spanish.
- A task is only done with real test evidence recorded in `tasksv2.md` (row T049V2).

---

### Task 1: Pure mapper with target guard

**Files:**
- Create: `qa/scripts/regyfit-classes-services-map.mjs`
- Create: `qa/scripts/regyfit-classes-services-map.d.mts`
- Test: `qa/unit/regyfit-classes-services-map.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (exact names used by Tasks 2 and 3):
  - `zonedIso(date: string, time: string, timezone: string): string` — `date` is `YYYY-MM-DD`, `time` `HH:mm`.
  - `parseRegyfitDate(text: string): string` — `"14 Sep 2026"` → `"2026-09-14"`.
  - `programIdFor(typeName: string): string` — `"GI Beginners Evenings"` → `"regyfit-gi-beginners-evenings"`.
  - `trainerKeyFor(name: string): string` — `"Zoé Exemple"` → `"regyfit-trainer-zoe-exemple"`.
  - `mapType(type: RegyfitType, academyId: string): ProgramDocument`
  - `mapSessionRow(row: RegyfitRow, options: { academyId: string; programIdsByName: ReadonlyMap<string, string>; now: string; timezone: string }): SessionDocument`
  - `planImport(capture: { types: RegyfitType[]; rows: RegyfitRow[] }, options: { academyId: string; now: string; timezone: string; from?: string; to?: string }): { programs: ProgramDocument[]; sessions: SessionDocument[]; trainers: string[]; outsideWindow: number; duplicates: number }`
  - `resolveTarget(env: Record<string, string | undefined>): { target: "emulator" | "production"; projectId: string }`
  - `productionConfirmation: "classes-services-types-sessions-production-v1"`

- [ ] **Step 1: Create the branch**

```bash
cd /root/BPT-Jersey
git switch -c feature/cs-p4a-import main
```

- [ ] **Step 2: Write the failing test**

Create `qa/unit/regyfit-classes-services-map.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  mapSessionRow,
  mapType,
  parseRegyfitDate,
  planImport,
  productionConfirmation,
  programIdFor,
  resolveTarget,
  trainerKeyFor,
  zonedIso,
  type RegyfitRow,
  type RegyfitType,
} from "../scripts/regyfit-classes-services-map.mjs";

const timezone = "Europe/Jersey";
const now = "2026-09-17T08:00:00.000Z";

function type(overrides: Partial<RegyfitType> = {}): RegyfitType {
  return {
    name: "Synthetic GI Evenings",
    abbreviation: "SYN_GI",
    colour: "#d9d7ff",
    active: true,
    type: "Class: Registrations = weekly/monthly frequency",
    dropIns: "Automatic",
    email: false,
    list: true,
    message: "",
    icon: "../../imagens/icons/656.svg",
    ...overrides,
  };
}

function row(id: string, date: string, time: string, overrides: Partial<Record<number, string>> = {}): RegyfitRow {
  const cells = ["", "", "", "Synthetic GI Evenings AULA", "BPT Town", "Synthetic Trainer", date, time, "0", "0", "2/40", "", ""];
  for (const [index, value] of Object.entries(overrides)) cells[Number(index)] = value!;
  return { week: "2026-09-01", id: `feed_aula${id}`, cells, icon: "/admin2/imagens/icons/656.svg" };
}

describe("dates and times", () => {
  it("parses the Regyfit DATE cell", () => {
    expect(parseRegyfitDate("14 Sep 2026")).toBe("2026-09-14");
    expect(() => parseRegyfitDate("14/09/2026")).toThrow("Unparseable Regyfit date");
  });

  it("converts Jersey wall time to UTC across summer and winter time", () => {
    expect(zonedIso("2026-09-14", "06:00", timezone)).toBe("2026-09-14T05:00:00.000Z");
    expect(zonedIso("2026-12-14", "06:00", timezone)).toBe("2026-12-14T06:00:00.000Z");
  });
});

describe("ids", () => {
  it("derives stable slugs", () => {
    expect(programIdFor("GI Beginners Evenings")).toBe("regyfit-gi-beginners-evenings");
    expect(programIdFor("13-15YO")).toBe("regyfit-13-15yo");
    expect(trainerKeyFor("Zoé Exemple")).toBe("regyfit-trainer-zoe-exemple");
  });
});

describe("mapType", () => {
  it("builds a v1 program carrying the v2 fields", () => {
    expect(mapType(type(), "academy-a")).toEqual({
      programId: "regyfit-synthetic-gi-evenings",
      academyId: "academy-a",
      name: "Synthetic GI Evenings",
      ageBand: "all",
      discipline: "bjj",
      level: "all-levels",
      abbreviation: "SYN_GI",
      colour: "#d9d7ff",
      kind: "class-frequency",
      dropInPolicy: "automatic",
      notifyByEmail: false,
      showInList: true,
      message: "",
      active: true,
      schemaVersion: "1",
    });
  });

  it("maps unlimited classes and numeric drop-in policies", () => {
    const program = mapType(type({ type: "Class: Unlimited registrations", dropIns: "3" }), "a");
    expect(program.kind).toBe("class-unlimited");
    expect(program.dropInPolicy).toBe("3");
  });

  it("refuses a type kind it does not know instead of guessing", () => {
    expect(() => mapType(type({ type: "Room: something new" }), "a")).toThrow("Unknown Regyfit type kind");
  });
});

describe("mapSessionRow", () => {
  const programIdsByName = new Map([["Synthetic GI Evenings", "regyfit-synthetic-gi-evenings"]]);

  it("maps a past row into a completed session in UTC", () => {
    expect(mapSessionRow(row("1", "14 Sep 2026", "06:00 - 07:00"), { academyId: "a", programIdsByName, now, timezone })).toEqual({
      sessionId: "regyfit-1",
      academyId: "a",
      classId: null,
      programId: "regyfit-synthetic-gi-evenings",
      locationId: "town",
      instructorId: "regyfit-trainer-synthetic-trainer",
      instructorIds: ["regyfit-trainer-synthetic-trainer"],
      title: "Synthetic GI Evenings",
      startAt: "2026-09-14T05:00:00.000Z",
      endAt: "2026-09-14T06:00:00.000Z",
      capacity: 40,
      minParticipants: 0,
      status: "completed",
      isSeminar: false,
      cancellationReason: null,
      schemaVersion: "1",
      createdAt: now,
      createdBy: "regyfit-import",
      updatedAt: now,
      updatedBy: "regyfit-import",
    });
  });

  it("keeps a class that has not ended scheduled, including one in progress", () => {
    const options = { academyId: "a", programIdsByName, now, timezone };
    // now = 08:00Z = 09:00 in Jersey.
    expect(mapSessionRow(row("5", "17 Sep 2026", "08:00 - 09:00"), options).status).toBe("completed");
    expect(mapSessionRow(row("6", "17 Sep 2026", "08:30 - 09:30"), options).status).toBe("scheduled");
    expect(mapSessionRow(row("7", "18 Sep 2026", "06:00 - 07:00"), options).status).toBe("scheduled");
  });

  it("reads ∞ as unlimited capacity and BPT West as west", () => {
    const session = mapSessionRow(row("2", "15 Sep 2026", "17:30 - 18:30", { 4: "BPT West", 10: "0/∞" }), { academyId: "a", programIdsByName, now, timezone });
    expect(session.capacity).toBeNull();
    expect(session.locationId).toBe("west");
  });

  it("fails loudly on an unknown type or location rather than dropping the class", () => {
    const options = { academyId: "a", programIdsByName, now, timezone };
    expect(() => mapSessionRow(row("3", "14 Sep 2026", "06:00 - 07:00", { 3: "Unknown AULA" }), options)).toThrow('No type named "Unknown" (row feed_aula3)');
    expect(() => mapSessionRow(row("4", "14 Sep 2026", "06:00 - 07:00", { 4: "BPT Moon" }), options)).toThrow('Unknown location "BPT Moon" (row feed_aula4)');
  });
});

describe("planImport", () => {
  it("keeps the rows inside the local date window, ignoring the bogus week tag", () => {
    const plan = planImport(
      {
        types: [type()],
        rows: [
          row("10", "13 Sep 2026", "10:00 - 11:00"),
          row("11", "14 Sep 2026", "06:00 - 07:00"),
          row("12", "20 Sep 2026", "10:00 - 11:00"),
          row("13", "21 Sep 2026", "06:00 - 07:00"),
        ],
      },
      { academyId: "a", now, timezone, from: "2026-09-14", to: "2026-09-20" },
    );
    expect(plan.programs.map((p) => p.programId)).toEqual(["regyfit-synthetic-gi-evenings"]);
    expect(plan.sessions.map((s) => s.sessionId)).toEqual(["regyfit-11", "regyfit-12"]);
    expect(plan.outsideWindow).toBe(2);
    expect(plan.trainers).toEqual(["Synthetic Trainer"]);
  });

  it("skips an identical repeated row but refuses a conflicting one", () => {
    const repeated = planImport(
      { types: [type()], rows: [row("20", "14 Sep 2026", "06:00 - 07:00"), row("20", "14 Sep 2026", "06:00 - 07:00")] },
      { academyId: "a", now, timezone },
    );
    expect(repeated.sessions).toHaveLength(1);
    expect(repeated.duplicates).toBe(1);
    expect(() =>
      planImport({ types: [type()], rows: [row("21", "14 Sep 2026", "06:00 - 07:00"), row("21", "15 Sep 2026", "06:00 - 07:00")] }, { academyId: "a", now, timezone }),
    ).toThrow("Regyfit row id feed_aula21 appears twice with different cells");
  });
});

describe("resolveTarget", () => {
  it("accepts only a loopback emulator", () => {
    expect(resolveTarget({ REGYFIT_IMPORT_TARGET: "emulator", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" })).toEqual({ target: "emulator", projectId: "demo-bpt-jersey" });
    expect(() => resolveTarget({ REGYFIT_IMPORT_TARGET: "emulator", FIRESTORE_EMULATOR_HOST: "10.0.0.5:8080" })).toThrow("loopback");
    expect(() => resolveTarget({ REGYFIT_IMPORT_TARGET: "emulator" })).toThrow("loopback");
  });

  it("requires the project and the operator confirmation for production", () => {
    const base = { REGYFIT_IMPORT_TARGET: "production", GCLOUD_PROJECT: "bptjersey-f5a25" };
    expect(() => resolveTarget(base)).toThrow("operator confirmation");
    expect(() => resolveTarget({ ...base, REGYFIT_OPERATOR_CONFIRMATION: productionConfirmation, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" })).toThrow("must not run with FIRESTORE_EMULATOR_HOST");
    expect(resolveTarget({ ...base, REGYFIT_OPERATOR_CONFIRMATION: productionConfirmation })).toEqual({ target: "production", projectId: "bptjersey-f5a25" });
  });

  it("rejects anything else", () => {
    expect(() => resolveTarget({})).toThrow("REGYFIT_IMPORT_TARGET must be emulator or production");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `corepack pnpm vitest run --project node qa/unit/regyfit-classes-services-map.test.ts`
Expected: FAIL, `Failed to resolve import "../scripts/regyfit-classes-services-map.mjs"`.

- [ ] **Step 4: Write the type surface**

Create `qa/scripts/regyfit-classes-services-map.d.mts`:

```ts
// Type surface of regyfit-classes-services-map.mjs for the qa unit tests. Keep it in step with
// the exports of the .mjs.

export type RegyfitType = {
  name: string;
  abbreviation: string;
  colour: string;
  active: boolean;
  type: string;
  dropIns: string;
  email: boolean;
  list: boolean;
  message: string;
  icon: string;
};

export type RegyfitRow = { week: string; id: string; cells: string[]; icon: string };

export type ProgramDocument = {
  programId: string;
  academyId: string;
  name: string;
  ageBand: "all";
  discipline: "bjj";
  level: "all-levels";
  abbreviation: string;
  colour: string;
  kind: "class-frequency" | "class-unlimited";
  dropInPolicy: "no" | "unlimited" | "automatic" | "1" | "2" | "3" | "4" | "5";
  notifyByEmail: boolean;
  showInList: boolean;
  message: string;
  active: boolean;
  schemaVersion: "1";
};

export type SessionDocument = {
  sessionId: string;
  academyId: string;
  classId: null;
  programId: string;
  locationId: "town" | "west";
  instructorId: string;
  instructorIds: string[];
  title: string;
  startAt: string;
  endAt: string;
  capacity: number | null;
  minParticipants: 0;
  status: "scheduled" | "completed";
  isSeminar: false;
  cancellationReason: null;
  schemaVersion: "1";
  createdAt: string;
  createdBy: "regyfit-import";
  updatedAt: string;
  updatedBy: "regyfit-import";
};

export const productionConfirmation: "classes-services-types-sessions-production-v1";

export function parseRegyfitDate(text: string): string;
export function zonedIso(date: string, time: string, timezone: string): string;
export function programIdFor(typeName: string): string;
export function trainerKeyFor(name: string): string;
export function mapType(type: RegyfitType, academyId: string): ProgramDocument;
export function mapSessionRow(
  row: RegyfitRow,
  options: {
    academyId: string;
    programIdsByName: ReadonlyMap<string, string>;
    now: string;
    timezone: string;
  },
): SessionDocument;
export function planImport(
  capture: { types: RegyfitType[]; rows: RegyfitRow[] },
  options: { academyId: string; now: string; timezone: string; from?: string; to?: string },
): {
  programs: ProgramDocument[];
  sessions: SessionDocument[];
  trainers: string[];
  outsideWindow: number;
  duplicates: number;
};
export function resolveTarget(env: Record<string, string | undefined>): {
  target: "emulator" | "production";
  projectId: string;
};
```

- [ ] **Step 5: Write the minimal implementation**

Create `qa/scripts/regyfit-classes-services-map.mjs`:

```js
// Pure mapping of the Regyfit Classes / Services capture (class-service-types.json and
// scheduled-classes-list.json) into BPT programs and sessions. No I/O: the CLI in
// regyfit-classes-services-import.mjs reads the files and writes Firestore.

export const productionConfirmation = "classes-services-types-sessions-production-v1";
const productionProjectId = "bptjersey-f5a25";

const months = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const locationIds = new Map([
  ["BPT Town", "town"],
  ["BPT West", "west"],
]);
const kinds = new Map([
  ["Class: Registrations = weekly/monthly frequency", "class-frequency"],
  ["Class: Unlimited registrations", "class-unlimited"],
]);
const dropInPolicies = new Map([
  ["No", "no"],
  ["Unlimited", "unlimited"],
  ["Automatic", "automatic"],
  ["1", "1"],
  ["2", "2"],
  ["3", "3"],
  ["4", "4"],
  ["5", "5"],
]);

function slug(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function programIdFor(typeName) {
  return `regyfit-${slug(typeName)}`;
}

export function trainerKeyFor(name) {
  return `regyfit-trainer-${slug(name)}`;
}

export function parseRegyfitDate(text) {
  const match = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/u.exec(text.trim());
  if (!match || !months[match[2]]) throw new Error(`Unparseable Regyfit date "${text}"`);
  return `${match[3]}-${String(months[match[2]]).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function offsetMinutes(utcMs, timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(utcMs))
      .map((part) => [part.type, part.value]),
  );
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return (local - utcMs) / 60_000;
}

// ponytail: one offset lookup; wrong only for a class starting inside the 1-hour DST gap/overlap.
export function zonedIso(date, time, timezone) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(guess - offsetMinutes(guess, timezone) * 60_000).toISOString();
}

export function mapType(type, academyId) {
  const kind = kinds.get(type.type);
  if (!kind) throw new Error(`Unknown Regyfit type kind "${type.type}" (${type.name})`);
  const dropInPolicy = dropInPolicies.get(type.dropIns);
  if (!dropInPolicy) throw new Error(`Unknown Regyfit drop-in policy "${type.dropIns}" (${type.name})`);
  return {
    programId: programIdFor(type.name),
    academyId,
    name: type.name,
    ageBand: "all",
    discipline: "bjj",
    level: "all-levels",
    abbreviation: type.abbreviation,
    colour: type.colour,
    kind,
    dropInPolicy,
    notifyByEmail: type.email,
    showInList: type.list,
    message: type.message,
    active: type.active,
    schemaVersion: "1",
  };
}

function rowParts(row) {
  if (!Array.isArray(row.cells) || row.cells.length < 11) {
    throw new Error(`Row ${row.id} does not have the 11 expected cells`);
  }
  const [, , , rawTitle, location, trainer, dateText, range, , , registrations] = row.cells;
  const times = /^(\d{2}:\d{2}) - (\d{2}:\d{2})$/u.exec(range.trim());
  if (!times) throw new Error(`Unparseable time range "${range}" (row ${row.id})`);
  return {
    title: rawTitle.replace(/\s+AULA$/u, "").trim(),
    location,
    trainer: trainer.trim(),
    date: parseRegyfitDate(dateText),
    start: times[1],
    end: times[2],
    registrations,
  };
}

export function mapSessionRow(row, { academyId, programIdsByName, now, timezone }) {
  const parts = rowParts(row);
  const programId = programIdsByName.get(parts.title);
  if (!programId) throw new Error(`No type named "${parts.title}" (row ${row.id})`);
  const locationId = locationIds.get(parts.location);
  if (!locationId) throw new Error(`Unknown location "${parts.location}" (row ${row.id})`);
  const capacityText = parts.registrations.split("/")[1]?.trim();
  const capacity = capacityText === "∞" ? null : Number(capacityText);
  if (capacity !== null && !(Number.isInteger(capacity) && capacity > 0)) {
    throw new Error(`Unparseable capacity "${parts.registrations}" (row ${row.id})`);
  }
  const instructorId = trainerKeyFor(parts.trainer);
  const endAt = zonedIso(parts.date, parts.end, timezone);
  return {
    sessionId: `regyfit-${row.id.replace(/^feed_aula/u, "")}`,
    academyId,
    classId: null,
    programId,
    locationId,
    instructorId,
    instructorIds: [instructorId],
    title: parts.title,
    startAt: zonedIso(parts.date, parts.start, timezone),
    endAt,
    capacity,
    minParticipants: 0,
    status: endAt <= now ? "completed" : "scheduled",
    isSeminar: false,
    cancellationReason: null,
    schemaVersion: "1",
    createdAt: now,
    createdBy: "regyfit-import",
    updatedAt: now,
    updatedBy: "regyfit-import",
  };
}

export function planImport({ types, rows }, { academyId, now, timezone, from, to }) {
  const programs = types.map((type) => mapType(type, academyId));
  const programIdsByName = new Map(programs.map((program) => [program.name, program.programId]));
  const seen = new Map();
  const trainers = new Set();
  const sessions = [];
  let outsideWindow = 0;
  let duplicates = 0;
  for (const row of rows) {
    // The list capture pages overlap, so the same class can arrive twice with identical cells.
    const earlier = seen.get(row.id);
    if (earlier !== undefined) {
      if (JSON.stringify(earlier) !== JSON.stringify(row.cells)) {
        throw new Error(`Regyfit row id ${row.id} appears twice with different cells`);
      }
      duplicates += 1;
      continue;
    }
    seen.set(row.id, row.cells);
    const { date, trainer } = rowParts(row);
    if ((from && date < from) || (to && date > to)) {
      outsideWindow += 1;
      continue;
    }
    sessions.push(mapSessionRow(row, { academyId, programIdsByName, now, timezone }));
    trainers.add(trainer);
  }
  return { programs, sessions, trainers: [...trainers].sort(), outsideWindow, duplicates };
}

function isLoopbackHost(value) {
  const host = value?.split(":")[0]?.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function resolveTarget(env) {
  const target = env.REGYFIT_IMPORT_TARGET?.trim();
  if (target === "emulator") {
    if (!isLoopbackHost(env.FIRESTORE_EMULATOR_HOST)) {
      throw new Error("Emulator imports require FIRESTORE_EMULATOR_HOST on a loopback host");
    }
    return { target, projectId: env.GCLOUD_PROJECT?.trim() || "demo-bpt-jersey" };
  }
  if (target === "production") {
    if (env.FIRESTORE_EMULATOR_HOST) {
      throw new Error("Production imports must not run with FIRESTORE_EMULATOR_HOST set");
    }
    if (env.GCLOUD_PROJECT?.trim() !== productionProjectId) {
      throw new Error(`Production imports require GCLOUD_PROJECT=${productionProjectId}`);
    }
    if (env.REGYFIT_OPERATOR_CONFIRMATION !== productionConfirmation) {
      throw new Error("Production imports require the operator confirmation value");
    }
    return { target, projectId: productionProjectId };
  }
  throw new Error("REGYFIT_IMPORT_TARGET must be emulator or production");
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `corepack pnpm vitest run --project node qa/unit/regyfit-classes-services-map.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 7: Prove a guard is load-bearing (LECCIONES §4)**

Temporarily change `if (!isLoopbackHost(env.FIRESTORE_EMULATOR_HOST))` to `if (false)`, rerun the
command from Step 6, confirm `accepts only a loopback emulator` fails, then restore the line and
confirm PASS again.

- [ ] **Step 8: Format, lint, typecheck the qa package**

```bash
corepack pnpm prettier --write qa/scripts/regyfit-classes-services-map.mjs qa/scripts/regyfit-classes-services-map.d.mts qa/unit/regyfit-classes-services-map.test.ts
corepack pnpm lint
git sparse-checkout add Lista Listav2 .cronos
corepack pnpm typecheck
git sparse-checkout set '/*' '!/.cronos' '!/Lista' '!/Listav2'
```
Expected: lint and typecheck exit 0.

- [ ] **Step 9: Commit**

```bash
git add qa/scripts/regyfit-classes-services-map.mjs qa/scripts/regyfit-classes-services-map.d.mts qa/unit/regyfit-classes-services-map.test.ts
git commit -m "feat(classes-services): map the Regyfit capture into programs and sessions (T049V2)"
```

---

### Task 2: Import CLI (dry run by default)

**Files:**
- Create: `qa/scripts/regyfit-classes-services-import.mjs`
- Modify: `qa/package.json` (add one script)

**Interfaces:**
- Consumes: `planImport`, `resolveTarget` from Task 1.
- Produces: CLI driven by env —
  `REGYFIT_CAPTURE_DIR` (dir holding `class-service-types.json` and `scheduled-classes-list.json`),
  `REGYFIT_ACADEMY_ID`, `REGYFIT_IMPORT_TARGET`, optional `REGYFIT_IMPORT_FROM` / `REGYFIT_IMPORT_TO`
  (`YYYY-MM-DD`, local dates, inclusive), optional `REGYFIT_IMPORT_NOW` (ISO instant with
  milliseconds; defaults to the current time), `REGYFIT_IMPORT_APPLY=true` to write. Prints one JSON
  line: `{ target, projectId, academyId, applied, programs, sessions, outsideWindow, duplicates, trainers }`.

The CLI is I/O glue over the tested module; its proof is the emulator run in Task 3.

- [ ] **Step 1: Write the CLI**

Create `qa/scripts/regyfit-classes-services-import.mjs`:

```js
// Imports the Regyfit Classes / Services capture (types + scheduled classes) into Firestore.
//
// usage (dry run prints the plan, writes nothing):
//   REGYFIT_CAPTURE_DIR=/root/regyfit-capture/data \
//   REGYFIT_ACADEMY_ID=<academyId> \
//   REGYFIT_IMPORT_TARGET=emulator|production \
//   [REGYFIT_IMPORT_FROM=2026-09-14 REGYFIT_IMPORT_TO=2026-09-20] \
//   [REGYFIT_IMPORT_NOW=2026-09-17T12:00:00.000Z] \
//   [REGYFIT_IMPORT_APPLY=true] \
//   node qa/scripts/regyfit-classes-services-import.mjs
//
// Production additionally requires GCLOUD_PROJECT=bptjersey-f5a25 and
// REGYFIT_OPERATOR_CONFIRMATION=classes-services-types-sessions-production-v1, and is run only
// after the operator confirms in chat. The capture must stay outside the repository.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";

import { planImport, resolveTarget } from "./regyfit-classes-services-map.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const syntheticFixture = resolve(repositoryRoot, "qa/fixtures/regyfit-classes-services-synthetic");
const requireFromFunctions = createRequire(join(repositoryRoot, "apps/functions/package.json"));
const { getApps, initializeApp } = requireFromFunctions("firebase-admin/app");
const { getFirestore } = requireFromFunctions("firebase-admin/firestore");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment: ${name}`);
  return value;
}

function optionalDate(name) {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error(`${name} must be YYYY-MM-DD`);
  return value;
}

// Past classes are imported as completed relative to this instant; tests pin it.
function importNow() {
  const value = process.env.REGYFIT_IMPORT_NOW?.trim();
  if (!value) return new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new Error("REGYFIT_IMPORT_NOW must be an ISO instant like 2026-09-17T12:00:00.000Z");
  }
  return value;
}

function captureDirectory() {
  const directory = resolve(required("REGYFIT_CAPTURE_DIR"));
  const inside = !relative(repositoryRoot, directory).startsWith("..");
  if (inside && directory !== syntheticFixture) {
    throw new Error("The real capture must stay outside the repository");
  }
  return directory;
}

async function main() {
  const { target, projectId } = resolveTarget(process.env);
  const academyId = required("REGYFIT_ACADEMY_ID");
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/u.test(academyId)) {
    throw new Error("REGYFIT_ACADEMY_ID must be a lowercase slug");
  }
  const directory = captureDirectory();
  const read = (file) => JSON.parse(readFileSync(join(directory, file), "utf8"));
  const plan = planImport(
    { types: read("class-service-types.json"), rows: read("scheduled-classes-list.json").rows },
    {
      academyId,
      now: importNow(),
      timezone: "Europe/Jersey",
      from: optionalDate("REGYFIT_IMPORT_FROM"),
      to: optionalDate("REGYFIT_IMPORT_TO"),
    },
  );
  const applied = process.env.REGYFIT_IMPORT_APPLY === "true";

  if (applied) {
    const firestore = getFirestore(getApps()[0] ?? initializeApp({ projectId }));
    const writes = [
      ...plan.programs.map((doc) => [`academies/${academyId}/programs/${doc.programId}`, doc]),
      ...plan.sessions.map((doc) => [`academies/${academyId}/sessions/${doc.sessionId}`, doc]),
    ];
    // Deterministic ids: a rerun overwrites the same documents instead of duplicating classes.
    for (let index = 0; index < writes.length; index += 400) {
      const batch = firestore.batch();
      for (const [path, doc] of writes.slice(index, index + 400)) batch.set(firestore.doc(path), doc);
      await batch.commit();
    }
  }

  console.log(
    JSON.stringify({
      target,
      projectId,
      academyId,
      applied,
      programs: plan.programs.length,
      sessions: plan.sessions.length,
      outsideWindow: plan.outsideWindow,
      duplicates: plan.duplicates,
      trainers: plan.trainers,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add the package script**

In `qa/package.json`, next to `"import:regyfit-access"`, add:

```json
    "import:regyfit-classes-services": "node scripts/regyfit-classes-services-import.mjs",
```

- [ ] **Step 3: Dry run against the real capture (no emulator needed, writes nothing)**

```bash
cd /root/BPT-Jersey
REGYFIT_CAPTURE_DIR=/root/regyfit-capture/data REGYFIT_ACADEMY_ID=bpt-jersey \
REGYFIT_IMPORT_TARGET=emulator FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
REGYFIT_IMPORT_FROM=2026-09-14 REGYFIT_IMPORT_TO=2026-09-20 \
node qa/scripts/regyfit-classes-services-import.mjs
```
Expected: one JSON line with `"applied":false,"programs":31,"sessions":26,"outsideWindow":146,"duplicates":5`
and the trainer list. Any thrown `No type named` / `Unknown location` is a real data finding:
stop and report it, do not widen the mapper silently.

- [ ] **Step 4: Prove the repository guard**

```bash
REGYFIT_CAPTURE_DIR=qa REGYFIT_ACADEMY_ID=bpt-jersey REGYFIT_IMPORT_TARGET=emulator \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node qa/scripts/regyfit-classes-services-import.mjs; echo "exit=$?"
```
Expected: `The real capture must stay outside the repository` and `exit=1`.

- [ ] **Step 5: Format, lint, commit**

```bash
corepack pnpm prettier --write qa/scripts/regyfit-classes-services-import.mjs qa/package.json
corepack pnpm lint
git add qa/scripts/regyfit-classes-services-import.mjs qa/package.json
git commit -m "feat(classes-services): Regyfit types and sessions import CLI, dry run by default (T049V2)"
```

---

### Task 3: Emulator proof that imported sessions reach the calendar (synthetic data)

**Files:**
- Create: `qa/fixtures/regyfit-classes-services-synthetic/class-service-types.json`
- Create: `qa/fixtures/regyfit-classes-services-synthetic/scheduled-classes-list.json`
- Create: `qa/scripts/run-classes-services-import-ui-e2e.mjs`
- Create: `qa/tests/classes-services-import-emulator.spec.ts`
- Modify: `qa/run-e2e.mjs` (forward the new flag in the env allowlist next to `"T066_LESSON_PLAN_UI_EMULATOR_E2E"`)

**Interfaces:**
- Consumes: the CLI from Task 2; `qa/scripts/seed-auth-emulator.mjs`
  (`AUTH_EMULATOR_E2E_EMAIL`, `AUTH_EMULATOR_E2E_PASSWORD`, `AUTH_EMULATOR_E2E_ROLE`,
  `AUTH_EMULATOR_E2E_ACADEMY_ID`).
- Produces: opt-in flag `CS_IMPORT_UI_EMULATOR_E2E=true`; never runs in CI.

- [ ] **Step 1: Write the synthetic fixture**

`qa/fixtures/regyfit-classes-services-synthetic/class-service-types.json`:

```json
[
  {
    "name": "Synthetic GI Mornings",
    "abbreviation": "SYN_GI_MO",
    "colour": "#d7fffd",
    "active": true,
    "type": "Class: Registrations = weekly/monthly frequency",
    "dropIns": "Unlimited",
    "email": false,
    "list": false,
    "message": "",
    "icon": "../../imagens/icons/656.svg"
  },
  {
    "name": "Synthetic Open Mat",
    "abbreviation": "SYN_OM",
    "colour": "#d7eaff",
    "active": true,
    "type": "Class: Unlimited registrations",
    "dropIns": "Unlimited",
    "email": false,
    "list": false,
    "message": "",
    "icon": "../../imagens/icons/227.svg"
  }
]
```

`qa/fixtures/regyfit-classes-services-synthetic/scheduled-classes-list.json` (four rows inside
14–20 Sep, one outside; the `week` tags are deliberately wrong like the real capture):

```json
{
  "headers": ["EXCEL", "LOCATION", "TRAINERS", "DATE", "TIME", "DROP-INS", "TRIALS", "REGISTRATIONS", "ATTENDANCE", "RESULTS"],
  "rows": [
    { "week": "2026-09-01", "id": "feed_aula9001", "cells": ["", "", "", "Synthetic GI Mornings AULA", "BPT Town", "Synthetic Coach One", "14 Sep 2026", "06:00 - 07:00", "0", "0", "0/∞", "", ""], "icon": "/admin2/imagens/icons/656.svg" },
    { "week": "2026-09-08", "id": "feed_aula9002", "cells": ["", "", "", "Synthetic GI Mornings AULA", "BPT Town", "Synthetic Coach One", "16 Sep 2026", "07:00 - 08:00", "0", "0", "0/40", "", ""], "icon": "/admin2/imagens/icons/656.svg" },
    { "week": "2026-09-08", "id": "feed_aula9003", "cells": ["", "", "", "Synthetic Open Mat AULA", "BPT West", "Synthetic Coach Two", "19 Sep 2026", "10:00 - 12:00", "0", "0", "0/∞", "", ""], "icon": "/admin2/imagens/icons/227.svg" },
    { "week": "2026-09-15", "id": "feed_aula9004", "cells": ["", "", "", "Synthetic Open Mat AULA", "BPT Town", "Synthetic Coach Two", "20 Sep 2026", "19:00 - 20:30", "0", "0", "0/∞", "", ""], "icon": "/admin2/imagens/icons/227.svg" },
    { "week": "2026-09-15", "id": "feed_aula9005", "cells": ["", "", "", "Synthetic GI Mornings AULA", "BPT Town", "Synthetic Coach One", "21 Sep 2026", "06:00 - 07:00", "0", "0", "0/∞", "", ""], "icon": "/admin2/imagens/icons/656.svg" }
  ]
}
```

- [ ] **Step 2: Write the failing spec**

Create `qa/tests/classes-services-import-emulator.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

/**
 * T049V2 (Plan 4a): sessions written by the Regyfit import appear in the Classes & Services 2.0
 * calendar through real Auth, Functions and Firestore emulators. Data is the synthetic fixture in
 * qa/fixtures/regyfit-classes-services-synthetic; the runner imports it before this spec.
 */
test.describe("Classes & Services import on Firebase Emulators", () => {
  test("shows the imported week in the calendar", async ({ page }) => {
    test.skip(
      process.env.CS_IMPORT_UI_EMULATOR_E2E !== "true" ||
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== "demo-bpt-jersey" ||
        !process.env.AUTH_EMULATOR_E2E_EMAIL ||
        !process.env.AUTH_EMULATOR_E2E_PASSWORD,
      "Synthetic owner and imported emulator data are required.",
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.getByLabel("Email address").fill(process.env.AUTH_EMULATOR_E2E_EMAIL!);
    await page.getByLabel("Password").fill(process.env.AUTH_EMULATOR_E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/admin/u);

    await page.goto("/admin/classes-services/classes");
    await page.getByLabel("Go to date").fill("2026-09-14");
    await expect(page.getByText("14 – 20 SEP 2026")).toBeVisible();
    await expect(page.getByText("Loading the schedule…")).toHaveCount(0);
    // Taken before the synthetic assertions so Task 4 gets it from the real week too.
    await page.screenshot({ path: "test-results/classes-services-import-week.png", fullPage: true });

    const classesCounter = page.locator(".cs-counters div", { hasText: "Classes" }).locator("dd");
    const status = page.getByLabel("Status");
    // Default filter is Active: only the two classes after the pinned import instant.
    await expect(classesCounter, JSON.stringify(errors)).toHaveText("2");
    await expect(page.locator(".cs-day", { hasText: "SAT 19/9" }).getByText("Synthetic Open Mat")).toBeVisible();
    await expect(page.locator(".cs-day", { hasText: "MON 14/9" }).getByText("Synthetic GI Mornings")).toHaveCount(0);
    // Past classes were imported as completed and are found through the Status filter.
    await status.selectOption("inactive");
    await expect(classesCounter).toHaveText("2");
    await status.selectOption("all");
    await expect(classesCounter).toHaveText("4");
    await page.screenshot({ path: "test-results/classes-services-import-week-all.png", fullPage: true });

    const monday = page.locator(".cs-day", { hasText: "MON 14/9" });
    await expect(monday.getByText("1 classes")).toBeVisible();
    // 06:00 in Jersey (BST) is stored as 05:00Z: the card must still read 06:00.
    await expect(monday.getByRole("button", { name: /Synthetic GI Mornings\s*06:00 - 07:00/u })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
```

- [ ] **Step 3: Write the runner**

Create `qa/scripts/run-classes-services-import-ui-e2e.mjs`:

```js
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const projectId = "demo-bpt-jersey";
const academyId = "regyfit-import-e2e";

if (
  process.env.CS_IMPORT_UI_EMULATOR_E2E !== "true" ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== projectId ||
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true" ||
  process.env.NEXT_PUBLIC_FIREBASE_ENV !== "local" ||
  process.env.NEXT_PUBLIC_ADMIN_E2E ||
  process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099"
) {
  throw new Error("Classes / Services import runner requires explicit local demo-project emulator flags.");
}

function run(args, env = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["qa/scripts/seed-auth-emulator.mjs"], {
  AUTH_EMULATOR_E2E_ROLE: "owner",
  AUTH_EMULATOR_E2E_ACADEMY_ID: academyId,
});
run(["qa/scripts/regyfit-classes-services-import.mjs"], {
  REGYFIT_CAPTURE_DIR: "qa/fixtures/regyfit-classes-services-synthetic",
  REGYFIT_ACADEMY_ID: academyId,
  REGYFIT_IMPORT_TARGET: "emulator",
  REGYFIT_IMPORT_APPLY: "true",
  // 14 and 16 Sep become completed, 19 and 20 Sep stay scheduled, whatever today is.
  REGYFIT_IMPORT_NOW: "2026-09-17T12:00:00.000Z",
});
run([
  "qa/run-e2e.mjs",
  "tests/classes-services-import-emulator.spec.ts",
  "--project=desktop-chromium",
  "--workers=1",
  "--retries=0",
]);
```

In `qa/run-e2e.mjs`, add `"CS_IMPORT_UI_EMULATOR_E2E",` to the forwarded-variable array right
after `"T066_LESSON_PLAN_UI_EMULATOR_E2E",`.

- [ ] **Step 4: Build what the emulators and the static export need**

```bash
cd /root/BPT-Jersey
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm --filter @bpt-jersey/functions build
node apps/functions/scripts/build-deploy-artifact.mjs
NEXT_PUBLIC_FIREBASE_ENV=local NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true \
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-bpt-jersey corepack pnpm --filter @bpt-jersey/web build
```
Expected: each command exits 0. Use the same `NEXT_PUBLIC_*` values that
`qa/scripts/run-lesson-planning-ui-e2e.mjs` documents if the web build asks for more.

- [ ] **Step 5: Run it in the emulator container and watch it pass**

Write a private env file (delete it afterwards):

```bash
cat > /root/.cs-import-e2e.env <<'EOF'
CS_IMPORT_UI_EMULATOR_E2E=true
NEXT_PUBLIC_FIREBASE_ENV=local
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-bpt-jersey
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
AUTH_EMULATOR_E2E_EMAIL=cs-import-owner@example.test
AUTH_EMULATOR_E2E_PASSWORD=Synthetic-Owner-2026
FUNCTIONS_DISCOVERY_TIMEOUT=300000
COREPACK_ENABLE_NETWORK=0
npm_config_verify_deps_before_run=false
EOF
docker run --rm --network none --env-file /root/.cs-import-e2e.env \
  -v /root/BPT-Jersey:/root/BPT-Jersey -v /root/.cache/firebase:/root/.cache/firebase \
  -v /root/.cache/node:/root/.cache/node -w /root/BPT-Jersey bpt-emu:local \
  bash -lc 'corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions "node qa/scripts/run-classes-services-import-ui-e2e.mjs"'
rm /root/.cs-import-e2e.env
```
Expected: importer line `{"target":"emulator",...,"applied":true,"programs":2,"sessions":5,...}`
(no window set, so all five rows), then `1 passed`. If a counter disagrees (e.g. `5` under All),
the spec is right and the import is wrong: investigate, do not edit the expectation.

- [ ] **Step 6: Prove the spec can fail**

Change `REGYFIT_IMPORT_APPLY: "true"` to `"false"` in the runner, rerun Step 5, confirm the spec
fails on the Classes counter (`Expected "2", Received "0"`), restore `"true"`.

- [ ] **Step 7: Format, lint, commit**

```bash
corepack pnpm prettier --write qa/fixtures/regyfit-classes-services-synthetic qa/scripts/run-classes-services-import-ui-e2e.mjs qa/tests/classes-services-import-emulator.spec.ts qa/run-e2e.mjs
corepack pnpm lint
git add qa/fixtures/regyfit-classes-services-synthetic qa/scripts/run-classes-services-import-ui-e2e.mjs qa/tests/classes-services-import-emulator.spec.ts qa/run-e2e.mjs
git commit -m "test(classes-services): emulator proof that imported sessions reach the calendar (T049V2)"
```

---

### Task 4: Real capture on the emulator, operator review, ledger

**Files:**
- Modify: `tasksv2.md` (row T049V2 only; no prettier)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: evidence for the operator; no code.

- [ ] **Step 1: Import the real week into a throwaway emulator and screenshot it**

Same container recipe as Task 3 Step 5, but the command inside `emulators:exec` is:

```bash
node qa/scripts/seed-auth-emulator.mjs && \
REGYFIT_CAPTURE_DIR=/root/regyfit-capture/data REGYFIT_ACADEMY_ID=regyfit-import-e2e \
REGYFIT_IMPORT_TARGET=emulator REGYFIT_IMPORT_APPLY=true \
REGYFIT_IMPORT_FROM=2026-09-14 REGYFIT_IMPORT_TO=2026-09-20 \
node qa/scripts/regyfit-classes-services-import.mjs && \
node qa/run-e2e.mjs tests/classes-services-import-emulator.spec.ts --project=desktop-chromium --workers=1 --retries=0
```

with `AUTH_EMULATOR_E2E_ROLE=owner`, `AUTH_EMULATOR_E2E_ACADEMY_ID=regyfit-import-e2e` and
`-v /root/regyfit-capture:/root/regyfit-capture:ro` added to `docker run`. The spec's synthetic
assertions fail on real data by design (it screenshots first, under the Active filter). Before this
run, make a one-off local edit to the spec adding `await page.getByLabel("Status").selectOption("all");`
immediately before the first `page.screenshot(...)`, so the real-week screenshot
`qa/test-results/classes-services-import-week.png` shows every class; revert it afterwards with
`git checkout -- qa/tests/classes-services-import-emulator.spec.ts`. Expected: importer reports
`"sessions":26,"duplicates":5`; the screenshot (Status = All) shows 26 classes across
MON 14/9 – SUN 20/9 (5, 5, 5, 5, 4, 1, 1).
Copy the screenshot to the session scratchpad and **delete it from `qa/test-results/`** (it shows
real trainer names).

- [ ] **Step 2: Show the operator**

Send the operator the screenshot and the importer JSON (counts + trainer list). The production import is a
separate step that runs only after he confirms it explicitly in chat.

- [ ] **Step 3: Record evidence in the ledger**

In `tasksv2.md`, row T049V2, change `pendiente` to `en curso` and replace
`Plan en docs/superpowers/plans/ (por escribir).` with a Spanish note: plan 4a path, commits,
unit test count, emulator spec `1 passed` with date, real-week run `26 sesiones / 31 tipos / 5 filas duplicadas descartadas`,
and "decisiones del operador del 2026-09-17 (tipos reales de Regyfit sustituyen a los programas por
defecto; entrenadores como claves `regyfit-trainer-*`; clases pasadas `completed` visibles con el
filtro Status); producción pendiente de confirmación en chat; inscripciones, drop-ins e historial
quedan para 4b". Do not run prettier on this file. Then:

```bash
git sparse-checkout add Lista Listav2 .cronos
corepack pnpm vitest run --project node qa/unit/listav2-ledger-sync.test.ts
git sparse-checkout set '/*' '!/.cronos' '!/Lista' '!/Listav2'
git add tasksv2.md
git commit -m "docs(tasks): T049V2 Plan 4a evidence"
```
Expected: ledger sync test PASS.
