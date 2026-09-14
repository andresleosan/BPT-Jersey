# Ready for Jiu Jitsu — member self check-in — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member with a confirmed booking whose session window is open sees a "READY / FOR JIU JITSU" slider at the very top of `/account`; sliding it clocks the member in through a new `selfCheckIn` callable that enforces the 50 m rule on the server and records punctuality.

**Architecture:** Pure rules in `packages/domain` (window, next session, input parser, distance gate) → a new member-only transaction `recordSelfCheckIn` beside the staff `recordCheckIn` in `apps/functions` → a `clockIn` method on the `/account` calendar repository port (fixture live on `:9471`, firebase adapter written) → a `ReadyForJiuJitsu` component rendered first inside `MemberCalendar`, which polls the week every 60 s while a window is open so a coach's check-in replaces the slider with the confirmation card.

**Tech Stack:** TypeScript strict, Next 16 / React 19 static export, Firebase Functions v2 `onCall`, Firestore transactions, vitest (`web` jsdom + `node`), Playwright, pnpm via Corepack.

**Spec:** `docs/superpowers/specs/2026-09-14-ready-for-jiu-jitsu-self-check-in-design.md` (decisions 1–20). Read it first; every task below cites the decision it implements.

## Global Constraints

- Run every command from `/root/BPT-Jersey` with `corepack pnpm …`; never install pnpm or firebase-tools globally. Node `>=22.13 <25`.
- **Decision 19:** another session is editing this same branch (`feature/admin-classes-billing-levels`). Never touch `apps/web/src/app/admin/**`, `apps/web/src/app/coach/**` or `admin/*.css`. Commit after every task with only the files that task names (`git add <paths>`, never `git add -A`). Before each commit run `git status --short` and leave other people's changes unstaged.
- UI copy in UK English, plain academy voice (DESIGN.md §8). Docs and ledger rows in Spanish.
- No new dependencies (`apps/web/package.json` stays: domain, firebase, next, react, react-dom, zod).
- DESIGN.md tokens only: purple `#2F2483`, lime `#D9F36A`, Mat Ink `#1A1A18`, Gi White `#FFFFFF`, canvas `#F2F1ED`, refused red rule `#8D1C2F`, Barlow Condensed 700 for the headline, radius `1rem` inside `/account`.
- Coordinates (decision 15, rounded to the 6 decimals the domain accepts): Town `49.183954, -2.107142`; West `49.205824, -2.185817`. Member coordinates are never stored, logged, audited or echoed.
- Window (decisions 3, 20): opens `startAt − 60 min`; closes `startAt + 20 min`, or `endAt` for `discipline === "open-mat"`. Gate (decisions 1, 2, 14): accuracy ≤ 100 m and distance ≤ 50 m, computed on the server.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BRsvmzFdzTfALk4DyxcSso
  ```

---

## File structure

| File | Responsibility |
|---|---|
| `packages/domain/src/schedule/self-check-in-contracts.ts` (+ `.test.ts`) | Pure rules: window, next candidate, input parser, distance gate, refusal codes |
| `packages/domain/src/schedule/schedule-contracts.ts` | `checkInMethods` gains `"self"`; `LocationGeofence` comment amended |
| `packages/domain/src/actor-context.ts` | `userRoles` gains `"teenStudent"` (the server did not know the role) |
| `packages/domain/package.json` | subpath export `./schedule/self-check-in` |
| `apps/functions/src/schedule/canonical-client-student-scope.ts` (+ `.test.ts`) | `teenStudent` branch: own profile, minor, 12+ |
| `apps/functions/src/schedule/attendance-transaction-service.ts` | `recordSelfCheckIn` transaction + `SelfCheckInRefusedError` |
| `apps/functions/src/schedule/schedule-service.ts` | `ScheduleStore.recordSelfCheckIn` (Firestore delegate + in-memory) |
| `apps/functions/src/schedule/schedule-callables.ts` (+ `.test.ts`) | `createSelfCheckInHandler`, `selfCheckIn`, `requireStudentScope` accepts teens |
| `apps/functions/src/schedule/schedule-security-boundary.test.ts` | transaction tests incl. coordinate-leak assertion |
| `apps/functions/src/index.ts` | export `selfCheckIn` |
| `apps/web/src/lib/self-check-in-position.ts` (+ `.test.ts`) | `navigator.geolocation` → `{ok, position} | denied | unavailable` |
| `apps/web/src/lib/calendar/self-check-in-messages.ts` (+ `.test.ts`) | refusal code → sentence |
| `apps/web/src/lib/calendar/calendar-repository.ts` | port gains `clockIn` |
| `apps/web/src/lib/calendar/fixture-calendar-repository.ts` (+ `.test.ts`) | sites with coordinates, a "ready" session per participant, `clockIn` |
| `apps/web/src/lib/calendar/firebase-calendar-repository.ts`, `apps/web/src/lib/schedule-client.ts` | `selfCheckIn` callable wrapper |
| `apps/web/src/app/account/calendar/ready-for-jiu-jitsu.tsx` (+ `.test.tsx`) | the slider card and its states |
| `apps/web/src/app/account/calendar/member-calendar.tsx` (+ `.test.tsx`) | candidate, sibling hint, 60 s poll, render first |
| `apps/web/src/app/account/account.css` | `.ready-*` styles |
| `qa/tests/account-self-check-in.spec.ts`, `qa/scripts/account-self-check-in-shots.mjs` | Playwright on `:9471` + screenshots |
| `tasksv2.md`, `Listav2/Listav2.data.js`, `BRIEF.md`, `DESIGN.md` | ledger row, board, decision 5 amendment, design addendum |

---

### Task 1: Domain — window and next candidate (decisions 3, 6, 16, 20)

**Files:**
- Create: `packages/domain/src/schedule/self-check-in-contracts.ts`
- Create: `packages/domain/src/schedule/self-check-in-contracts.test.ts`
- Modify: `packages/domain/package.json` (exports map)

**Interfaces:**
- Produces: `selfCheckInWindow`, `isSelfCheckInWindowOpen`, `selfCheckInWindowLabels`, `isOpenMatProgram`, `nextSelfCheckInSession`, type `SelfCheckInCandidate` (used by Tasks 4, 7, 8, 9).

- [ ] **Step 1: Add the subpath export**

In `packages/domain/package.json`, inside `"exports"`, next to `"./schedule/member-calendar"`, add:

```json
"./schedule/self-check-in": {
  "types": "./src/schedule/self-check-in-contracts.ts",
  "import": "./src/schedule/self-check-in-contracts.ts",
  "default": "./lib/schedule/self-check-in-contracts.js"
},
```

- [ ] **Step 2: Write the failing tests**

`packages/domain/src/schedule/self-check-in-contracts.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  isSelfCheckInWindowOpen,
  nextSelfCheckInSession,
  selfCheckInWindow,
  selfCheckInWindowLabels,
} from "./self-check-in-contracts";
import type {
  AttendanceRecord,
  BookingRecord,
  ProgramRecord,
  SessionRecord,
} from "./schedule-contracts";

const audit = {
  schemaVersion: "1" as const,
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: "t",
  updatedAt: "2026-09-01T00:00:00.000Z",
  updatedBy: "t",
};
// 18:00–19:00 Jersey (BST) on 2026-09-15 = 17:00Z–18:00Z
const startAt = "2026-09-15T17:00:00.000Z";
const endAt = "2026-09-15T18:00:00.000Z";
const minute = 60_000;

function session(id: string, programId = "prog-teens", start = startAt, end = endAt): SessionRecord {
  return {
    sessionId: id, academyId: "bpt", classId: null, programId, locationId: "town",
    instructorId: "coach-1", title: "Teens BJJ", startAt: start, endAt: end, capacity: 20,
    minParticipants: 4, status: "scheduled", isSeminar: false, cancellationReason: null, ...audit,
  };
}
function booking(sessionId: string, status: BookingRecord["status"] = "confirmed"): BookingRecord {
  return {
    bookingId: `bk_${sessionId}`, academyId: "bpt", sessionId, studentId: "sam", membershipId: "m",
    status, requestedAt: audit.createdAt, cancelledAt: null, cancellationReason: null, ...audit,
  };
}
function attendance(sessionId: string, method: AttendanceRecord["method"] = "manual"): AttendanceRecord {
  return {
    attendanceId: `${sessionId}__sam`, academyId: "bpt", sessionId, studentId: "sam", method,
    state: "attended", occurredAt: startAt, notes: null, correctionOf: null, ...audit,
  };
}
const programs: ProgramRecord[] = [
  { programId: "prog-teens", academyId: "bpt", name: "Teens BJJ", ageBand: "teens", discipline: "bjj", level: "all-levels", active: true, schemaVersion: "1" },
  { programId: "prog-om", academyId: "bpt", name: "Open Mat", ageBand: "all", discipline: "open-mat", level: "all-levels", active: true, schemaVersion: "1" },
];
const s = session("s1");
const startMs = Date.parse(startAt);

describe("selfCheckInWindow", () => {
  it("opens 60 minutes before and closes 20 minutes after the start", () => {
    expect(selfCheckInWindow(s, false)).toEqual({ opensAtMs: startMs - 60 * minute, closesAtMs: startMs + 20 * minute });
  });
  it("closes at endAt for an open mat (decision 20)", () => {
    expect(selfCheckInWindow(s, true).closesAtMs).toBe(Date.parse(endAt));
  });
  it("is open exactly at the edges and closed one second outside them", () => {
    expect(isSelfCheckInWindowOpen(s, false, startMs - 60 * minute)).toBe(true);
    expect(isSelfCheckInWindowOpen(s, false, startMs - 60 * minute - 1000)).toBe(false);
    expect(isSelfCheckInWindowOpen(s, false, startMs + 20 * minute)).toBe(true);
    expect(isSelfCheckInWindowOpen(s, false, startMs + 20 * minute + 1000)).toBe(false);
  });
  it("is closed for an invalid date", () => {
    expect(isSelfCheckInWindowOpen({ startAt: "nope", endAt }, false, startMs)).toBe(false);
  });
  it("labels the window in Jersey time", () => {
    expect(selfCheckInWindowLabels(s, false)).toEqual({ opens: "17:00", closes: "18:20" });
    expect(selfCheckInWindowLabels(s, true)).toEqual({ opens: "17:00", closes: "19:00" });
  });
});

describe("nextSelfCheckInSession", () => {
  const now = startMs - 30 * minute;
  it("returns nothing without a confirmed booking", () => {
    expect(nextSelfCheckInSession({ sessions: [s], programs, bookings: [], attendance: [], nowMs: now })).toBeUndefined();
    expect(nextSelfCheckInSession({ sessions: [s], programs, bookings: [booking("s1", "requested")], attendance: [], nowMs: now })).toBeUndefined();
    expect(nextSelfCheckInSession({ sessions: [s], programs, bookings: [booking("s1", "cancelled")], attendance: [], nowMs: now })).toBeUndefined();
  });
  it("returns nothing for a cancelled session or a closed window", () => {
    expect(nextSelfCheckInSession({ sessions: [{ ...s, status: "cancelled" }], programs, bookings: [booking("s1")], attendance: [], nowMs: now })).toBeUndefined();
    expect(nextSelfCheckInSession({ sessions: [s], programs, bookings: [booking("s1")], attendance: [], nowMs: startMs - 61 * minute })).toBeUndefined();
  });
  it("is ready with a confirmed booking inside the window", () => {
    expect(nextSelfCheckInSession({ sessions: [s], programs, bookings: [booking("s1")], attendance: [], nowMs: now })).toEqual({ kind: "ready", session: s });
  });
  it("is checkedIn when any attendance exists, whatever the method (decisions 6, 16)", () => {
    const coach = attendance("s1", "manual");
    expect(nextSelfCheckInSession({ sessions: [s], programs, bookings: [booking("s1")], attendance: [coach], nowMs: now })).toEqual({ kind: "checkedIn", session: s, attendance: coach });
  });
  it("picks the earliest open session when two overlap", () => {
    const later = session("s2", "prog-teens", "2026-09-15T17:30:00.000Z", "2026-09-15T18:30:00.000Z");
    const result = nextSelfCheckInSession({ sessions: [later, s], programs, bookings: [booking("s1"), booking("s2")], attendance: [], nowMs: now });
    expect(result?.session.sessionId).toBe("s1");
  });
  it("keeps an open mat open until it ends", () => {
    const om = session("om", "prog-om");
    expect(nextSelfCheckInSession({ sessions: [om], programs, bookings: [booking("om")], attendance: [], nowMs: startMs + 45 * minute })?.kind).toBe("ready");
    expect(nextSelfCheckInSession({ sessions: [s], programs, bookings: [booking("s1")], attendance: [], nowMs: startMs + 45 * minute })).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project node packages/domain/src/schedule/self-check-in-contracts.test.ts`
Expected: FAIL — cannot resolve `./self-check-in-contracts`.

- [ ] **Step 4: Write the implementation**

`packages/domain/src/schedule/self-check-in-contracts.ts`:

```ts
/**
 * Ready for Jiu Jitsu — member self check-in (/account). Pure rules only; nothing here touches
 * Firebase. Spec: docs/superpowers/specs/2026-09-14-ready-for-jiu-jitsu-self-check-in-design.md
 */
import type {
  AttendanceRecord,
  BookingRecord,
  ProgramRecord,
  SessionRecord,
} from "./schedule-contracts";

export const selfCheckInOpensBeforeStartMs = 60 * 60 * 1000;
export const selfCheckInClosesAfterStartMs = 20 * 60 * 1000;

type WindowSession = Pick<SessionRecord, "startAt" | "endAt">;

export function isOpenMatProgram(program: Pick<ProgramRecord, "discipline"> | undefined): boolean {
  return program?.discipline === "open-mat";
}

/** Decision 3 and 20: −60 min → +20 min, or → endAt for an open mat (no 20-minute loss there). */
export function selfCheckInWindow(
  session: WindowSession,
  isOpenMat: boolean,
): Readonly<{ opensAtMs: number; closesAtMs: number }> {
  const startMs = Date.parse(session.startAt);
  const endMs = Date.parse(session.endAt);
  return Object.freeze({
    opensAtMs: startMs - selfCheckInOpensBeforeStartMs,
    closesAtMs: isOpenMat ? endMs : startMs + selfCheckInClosesAfterStartMs,
  });
}

export function isSelfCheckInWindowOpen(
  session: WindowSession,
  isOpenMat: boolean,
  nowMs: number,
): boolean {
  const { opensAtMs, closesAtMs } = selfCheckInWindow(session, isOpenMat);
  return (
    Number.isFinite(opensAtMs) &&
    Number.isFinite(closesAtMs) &&
    nowMs >= opensAtMs &&
    nowMs <= closesAtMs
  );
}

const jerseyClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Jersey",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function selfCheckInWindowLabels(
  session: WindowSession,
  isOpenMat: boolean,
): Readonly<{ opens: string; closes: string }> {
  const { opensAtMs, closesAtMs } = selfCheckInWindow(session, isOpenMat);
  return Object.freeze({
    opens: jerseyClock.format(new Date(opensAtMs)),
    closes: jerseyClock.format(new Date(closesAtMs)),
  });
}

export type SelfCheckInCandidate =
  | Readonly<{ kind: "ready"; session: SessionRecord }>
  | Readonly<{ kind: "checkedIn"; session: SessionRecord; attendance: AttendanceRecord }>;

/**
 * The earliest session whose window is open and that the student holds a confirmed booking for.
 * Attendance of any method turns it into `checkedIn` (decision 6: attendance is the seam with the
 * coach team; decision 16: the confirmation card survives reloads).
 */
export function nextSelfCheckInSession(input: {
  sessions: readonly SessionRecord[];
  programs: readonly ProgramRecord[];
  bookings: readonly BookingRecord[];
  attendance: readonly AttendanceRecord[];
  nowMs: number;
}): SelfCheckInCandidate | undefined {
  const programs = new Map(input.programs.map((p) => [p.programId, p]));
  const confirmed = new Set(
    input.bookings.filter((b) => b.status === "confirmed").map((b) => b.sessionId),
  );
  const attendance = new Map(input.attendance.map((a) => [a.sessionId, a]));
  const open = input.sessions
    .filter(
      (s) =>
        s.status !== "cancelled" &&
        confirmed.has(s.sessionId) &&
        isSelfCheckInWindowOpen(s, isOpenMatProgram(programs.get(s.programId)), input.nowMs),
    )
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const session = open[0];
  if (!session) return undefined;
  const record = attendance.get(session.sessionId);
  return record ? { kind: "checkedIn", session, attendance: record } : { kind: "ready", session };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project node packages/domain/src/schedule/self-check-in-contracts.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/package.json packages/domain/src/schedule/self-check-in-contracts.ts packages/domain/src/schedule/self-check-in-contracts.test.ts
git commit -m "feat(domain): self check-in window, open-mat close and next candidate (T040V2)"
```

---

### Task 2: Domain — input parser, distance gate, method `self` (decisions 2, 7, 12, 14)

**Files:**
- Modify: `packages/domain/src/schedule/self-check-in-contracts.ts`
- Modify: `packages/domain/src/schedule/self-check-in-contracts.test.ts`
- Modify: `packages/domain/src/schedule/schedule-contracts.ts:1445` (`checkInMethods`) and `:26-35` (comment)

**Interfaces:**
- Produces: `SelfCheckInPosition`, `SelfCheckInInput`, `SelfCheckInRefusal`, `selfCheckInRefusals`, `selfCheckInMaxAccuracyMeters`, `parseSelfCheckInInput(input): Result<SelfCheckInInput, string>`, `decideSelfCheckIn(...): Result<AttendanceProximity, { reason: SelfCheckInRefusal; distanceMeters?: number }>`; `CheckInMethod` now includes `"self"`.

- [ ] **Step 1: Write the failing tests** (append to the test file)

```ts
import {
  decideSelfCheckIn,
  parseSelfCheckInInput,
  selfCheckInMaxAccuracyMeters,
} from "./self-check-in-contracts";
import { checkInMethods } from "./schedule-contracts";

const town = { latitude: 49.183954, longitude: -2.107142 };
// 1e-5° of latitude ≈ 1.11 m
const at = (metresNorth: number, accuracyMeters = 12) => ({
  latitude: Number((town.latitude + metresNorth / 111_000).toFixed(6)),
  longitude: town.longitude,
  accuracyMeters,
});

describe("parseSelfCheckInInput", () => {
  const valid = { sessionId: "s1", studentId: "sam", position: at(0) };
  it("accepts exactly sessionId, studentId and position", () => {
    expect(parseSelfCheckInInput(valid)).toEqual({ ok: true, value: { ...valid, position: at(0) } });
  });
  it("rejects extra keys, missing keys and non-objects", () => {
    expect(parseSelfCheckInInput({ ...valid, extra: 1 }).ok).toBe(false);
    expect(parseSelfCheckInInput({ sessionId: "s1", studentId: "sam" }).ok).toBe(false);
    expect(parseSelfCheckInInput({ ...valid, position: { ...at(0), speed: 1 } }).ok).toBe(false);
    expect(parseSelfCheckInInput("nope").ok).toBe(false);
    expect(parseSelfCheckInInput(null).ok).toBe(false);
  });
  it("rejects strings, NaN and out-of-range coordinates", () => {
    expect(parseSelfCheckInInput({ ...valid, position: { ...at(0), latitude: "49" } }).ok).toBe(false);
    expect(parseSelfCheckInInput({ ...valid, position: { ...at(0), latitude: Number.NaN } }).ok).toBe(false);
    expect(parseSelfCheckInInput({ ...valid, position: { ...at(0), latitude: 91 } }).ok).toBe(false);
    expect(parseSelfCheckInInput({ ...valid, position: { ...at(0), longitude: -181 } }).ok).toBe(false);
    expect(parseSelfCheckInInput({ ...valid, position: { ...at(0), accuracyMeters: -1 } }).ok).toBe(false);
    expect(parseSelfCheckInInput({ ...valid, position: { ...at(0), accuracyMeters: 100_001 } }).ok).toBe(false);
    expect(parseSelfCheckInInput({ ...valid, sessionId: "  " }).ok).toBe(false);
  });
  it("never echoes the submitted values in its error", () => {
    const result = parseSelfCheckInInput({ ...valid, position: { ...at(0), latitude: 91.123456 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("91.123456");
  });
});

describe("decideSelfCheckIn", () => {
  const base = { session: s, isOpenMat: false, site: town, nowMs: startMs - 30 * minute };
  it("refuses in order: window, site, accuracy, distance", () => {
    expect(decideSelfCheckIn({ ...base, nowMs: startMs - 61 * minute, site: null, position: at(500, 900) })).toEqual({ ok: false, error: { reason: "window_closed" } });
    expect(decideSelfCheckIn({ ...base, site: null, position: at(500, 900) })).toEqual({ ok: false, error: { reason: "site_not_ready" } });
    expect(decideSelfCheckIn({ ...base, site: undefined, position: at(0) })).toEqual({ ok: false, error: { reason: "site_not_ready" } });
    expect(decideSelfCheckIn({ ...base, position: at(500, selfCheckInMaxAccuracyMeters + 1) })).toEqual({ ok: false, error: { reason: "imprecise" } });
    expect(decideSelfCheckIn({ ...base, position: at(120) })).toEqual({ ok: false, error: { reason: "outside", distanceMeters: 120 } });
  });
  it("passes at exactly 50 m and exactly 100 m accuracy, fails at 51 m and 101 m", () => {
    expect(decideSelfCheckIn({ ...base, position: at(50, 100) })).toEqual({
      ok: true,
      value: { signal: "within", distanceMeters: 50, accuracyMeters: 100, overrideReason: null },
    });
    expect(decideSelfCheckIn({ ...base, position: at(51) }).ok).toBe(false);
    expect(decideSelfCheckIn({ ...base, position: at(0, 101) }).ok).toBe(false);
  });
  it("uses the open-mat window when told so", () => {
    expect(decideSelfCheckIn({ ...base, isOpenMat: true, nowMs: startMs + 45 * minute, position: at(0) }).ok).toBe(true);
  });
});

describe("check-in methods", () => {
  it("include self", () => {
    expect(checkInMethods).toContain("self");
  });
});
```

Note: `at(50)` rounds the latitude to 6 decimals, so the haversine distance may land on 50 or 51. If the "exactly 50 m" assertion fails on the rounded value, change `at(50, 100)` to `at(49.5, 100)` and keep the `distanceMeters: 50` expectation (`Math.round`) — the edge under test is the `<= 50` comparison, not the sixth decimal.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project node packages/domain/src/schedule/self-check-in-contracts.test.ts`
Expected: FAIL — `parseSelfCheckInInput`/`decideSelfCheckIn` not exported; `checkInMethods` lacks `self`.

- [ ] **Step 3: Implement**

Append to `self-check-in-contracts.ts` (and extend its import from `./schedule-contracts` with `checkInProximityRadiusMeters, distanceInMetres, maxCheckInProximityMeters, type AttendanceProximity, type LocationGeofence`; add `import { err, ok, type Result } from "../result";`):

```ts
/** Decision 14: readings wider than this are refused; the distance itself must still be ≤ 50 m. */
export const selfCheckInMaxAccuracyMeters = 100;

export type SelfCheckInPosition = Readonly<{
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}>;

export type SelfCheckInInput = Readonly<{
  sessionId: string;
  studentId: string;
  position: SelfCheckInPosition;
}>;

export const selfCheckInRefusals = Object.freeze([
  "window_closed",
  "site_not_ready",
  "imprecise",
  "outside",
  "not_booked",
  "already_checked_in",
] as const);
export type SelfCheckInRefusal = (typeof selfCheckInRefusals)[number];

export type SelfCheckInDecisionError = Readonly<{
  reason: SelfCheckInRefusal;
  /** Only with `outside`, so the member can be told how far they are. Never a coordinate. */
  distanceMeters?: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  return present.length === keys.length && keys.every((key) => present.includes(key));
}

function finiteWithin(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/** Strict: exactly the three fields, exactly the three coordinates, finite and in range. */
export function parseSelfCheckInInput(input: unknown): Result<SelfCheckInInput, string> {
  if (!isRecord(input) || !exactKeys(input, ["sessionId", "studentId", "position"])) {
    return err("Self check-in accepts exactly sessionId, studentId and position");
  }
  const { sessionId, studentId, position } = input;
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return err("sessionId is required");
  }
  if (typeof studentId !== "string" || studentId.trim().length === 0) {
    return err("studentId is required");
  }
  if (!isRecord(position) || !exactKeys(position, ["latitude", "longitude", "accuracyMeters"])) {
    return err("position accepts exactly latitude, longitude and accuracyMeters");
  }
  if (
    !finiteWithin(position.latitude, -90, 90) ||
    !finiteWithin(position.longitude, -180, 180) ||
    !finiteWithin(position.accuracyMeters, 0, maxCheckInProximityMeters)
  ) {
    return err("position is out of range");
  }
  return ok(
    Object.freeze({
      sessionId: sessionId.trim(),
      studentId: studentId.trim(),
      position: Object.freeze({
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyMeters: position.accuracyMeters,
      }),
    }),
  );
}

/**
 * Decisions 1, 2, 14: the hard gate, judged on the server with server time. Order: window → site
 * coordinates → accuracy → distance. The returned proximity is what the attendance record stores;
 * the position itself is used here and nowhere else.
 */
export function decideSelfCheckIn(input: {
  session: WindowSession;
  isOpenMat: boolean;
  site: LocationGeofence | null | undefined;
  position: SelfCheckInPosition;
  nowMs: number;
}): Result<AttendanceProximity, SelfCheckInDecisionError> {
  if (!isSelfCheckInWindowOpen(input.session, input.isOpenMat, input.nowMs)) {
    return err({ reason: "window_closed" });
  }
  if (
    input.site === null ||
    input.site === undefined ||
    !Number.isFinite(input.site.latitude) ||
    !Number.isFinite(input.site.longitude)
  ) {
    return err({ reason: "site_not_ready" });
  }
  const accuracyMeters = Math.round(input.position.accuracyMeters);
  if (accuracyMeters > selfCheckInMaxAccuracyMeters) {
    return err({ reason: "imprecise" });
  }
  const distanceMeters = Math.round(
    distanceInMetres(
      { latitude: input.position.latitude, longitude: input.position.longitude },
      input.site,
    ),
  );
  if (distanceMeters > checkInProximityRadiusMeters) {
    return err({ reason: "outside", distanceMeters });
  }
  return ok(
    Object.freeze({
      signal: "within" as const,
      distanceMeters,
      accuracyMeters,
      overrideReason: null,
    }),
  );
}
```

In `schedule-contracts.ts` line 1445:

```ts
export const checkInMethods = Object.freeze(["qr", "pin", "nameSearch", "manual", "self"] as const);
```

And replace the `LocationGeofence` doc comment (lines 26-30) with:

```ts
/**
 * Coordinates of an academy site, used only to judge whether a check-in was measured at the venue.
 * These are the academy's own premises. A member's coordinates are accepted by exactly one path,
 * `selfCheckIn` (2026-09-15, decision 2 of the self check-in spec): they are reduced to a distance
 * in memory and never stored, logged or audited. Staff check-in still receives only a distance.
 */
```

- [ ] **Step 4: Run the domain tests**

Run: `corepack pnpm vitest run --project node packages/domain`
Expected: PASS. If a test enumerates `checkInMethods` exactly (grep: `grep -rn '"nameSearch", "manual"' packages/domain/src apps/functions/src apps/web/src`), add `"self"` to that expectation.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/schedule/self-check-in-contracts.ts packages/domain/src/schedule/self-check-in-contracts.test.ts packages/domain/src/schedule/schedule-contracts.ts
git commit -m "feat(domain): self check-in parser, 50 m server gate and method self (T040V2)"
```

---

### Task 3: Server roles — `teenStudent` exists, and the scope resolver accepts it (decision 4)

**Files:**
- Modify: `packages/domain/src/actor-context.ts:9-17`
- Modify: `apps/functions/src/schedule/canonical-client-student-scope.ts:6-11, 47-73`
- Modify: `apps/functions/src/schedule/canonical-client-student-scope.test.ts`
- Modify: `apps/functions/src/schedule/schedule-callables.ts:76` (`requireStudentScope`)
- Modify: `apps/functions/src/schedule/attendance-transaction-service.ts:31-32`

**Interfaces:**
- Produces: `CanonicalClientStudentScopeInput.actorRole` accepts `"teenStudent"`; `ScheduleMutationActorRole` includes `"teenStudent"`; `userRoles` includes `"teenStudent"`.

- [ ] **Step 1: Write the failing test**

Append to `canonical-client-student-scope.test.ts` (reuse its `audit()` helper and the `documents`/`queryDocuments` shape of the first test):

```ts
  it("resolves a teen by unique students.userId only when minor, active and 12 or older", async () => {
    const student = (dateOfBirth: string) => ({
      studentId: "student-teen-1",
      academyId: "academy-1",
      familyId: "family-1",
      userId: "teen-user-1",
      fullName: "Synthetic Teen",
      dateOfBirth,
      trainingCenter: "Town",
      trainingTimePreferences: ["afternoon"],
      participantType: "minor",
      ...audit(),
    });
    const resolverFor = (profile: Record<string, unknown>) =>
      createCanonicalClientStudentScopeResolver({
        now: () => "2026-09-15T12:00:00.000Z",
        getDocument: async () => ({ id: "", exists: false, data: undefined }),
        queryDocuments: async (path, field, value) =>
          path === "academies/academy-1/students" && field === "userId" && value === "teen-user-1"
            ? [{ id: "student-teen-1", exists: true, data: profile }]
            : [],
      });
    const input = { academyId: "academy-1", actorUserId: "teen-user-1", actorRole: "teenStudent" as const, requestedStudentId: "student-teen-1" };

    await expect(resolverFor(student("2012-09-15"))({ ...input })).resolves.toBe(true); // 14 today
    await expect(resolverFor(student("2014-09-15"))({ ...input })).resolves.toBe(true); // 12 today
    await expect(resolverFor(student("2014-09-16"))({ ...input })).resolves.toBe(false); // 12 tomorrow
    await expect(resolverFor({ ...student("2012-09-15"), participantType: "adult" })({ ...input })).resolves.toBe(false);
    await expect(resolverFor({ ...student("2012-09-15"), active: false })({ ...input })).resolves.toBe(false);
    await expect(resolverFor(student("2012-09-15"))({ ...input, requestedStudentId: "someone-else" })).resolves.toBe(false);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule/canonical-client-student-scope.test.ts`
Expected: FAIL — type error on `actorRole: "teenStudent"` / resolver returns false.

- [ ] **Step 3: Implement**

`packages/domain/src/actor-context.ts` — add `"teenStudent"` after `"adultStudent"` in `userRoles`.

`canonical-client-student-scope.ts`:

```ts
// imports: add
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";

export type CanonicalClientStudentScopeInput = Readonly<{
  academyId: string;
  actorUserId: string;
  actorRole: "guardian" | "adultStudent" | "teenStudent";
  requestedStudentId: string;
}>;

/** D1 / T009V2: a minor holds their own account from 12, the Kids/Teens line. */
export const teenAccountMinimumAge = 12;

function ageInYears(dateOfBirth: string, todayKey: string): number {
  const birth = new Date(`${dateOfBirth}T00:00:00.000Z`);
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(today.getTime())) return -1;
  const years = today.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate());
  return beforeBirthday ? years - 1 : years;
}
```

Inside the resolver, after the `adultStudent` branch and before the guardian lookup:

```ts
      if (input.actorRole === "teenStudent") {
        const matches = await dependencies.queryDocuments(
          `academies/${input.academyId}/students`,
          "userId",
          input.actorUserId,
          2,
        );
        if (matches.length !== 1) return false;
        const document = matches[0]!;
        const parsed = document.data === undefined ? undefined : parseStudentProfile(document.data);
        if (!document.exists || parsed === undefined || !parsed.ok) return false;
        const todayKey = dateKeyInJersey(new Date(dependencies.now?.() ?? new Date().toISOString()));
        return (
          document.id === parsed.value.studentId &&
          parsed.value.studentId === input.requestedStudentId &&
          parsed.value.academyId === input.academyId &&
          parsed.value.userId === input.actorUserId &&
          parsed.value.participantType === "minor" &&
          parsed.value.active &&
          parsed.value.status === "active" &&
          ageInYears(parsed.value.dateOfBirth, todayKey) >= teenAccountMinimumAge
        );
      }
```

`schedule-callables.ts` `requireStudentScope`: change the role test to

```ts
  if (
    (actor.role === "guardian" || actor.role === "adultStudent" || actor.role === "teenStudent") &&
```

`attendance-transaction-service.ts`:

```ts
export type ScheduleMutationActorRole =
  "owner" | "administrator" | "headCoach" | "coach" | "guardian" | "adultStudent" | "teenStudent";
```

- [ ] **Step 4: Run the node tests**

Run: `corepack pnpm vitest run --project node packages/domain apps/functions/src/auth apps/functions/src/schedule`
Expected: PASS. If a test asserts the exact `userRoles` list, add `"teenStudent"` to it. Note in the commit body that `teenStudent` claims now pass `requireUserActor` and student-scope callables (bookings) — that is decision 4 and D1, not a side effect.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/actor-context.ts apps/functions/src/schedule/canonical-client-student-scope.ts apps/functions/src/schedule/canonical-client-student-scope.test.ts apps/functions/src/schedule/schedule-callables.ts apps/functions/src/schedule/attendance-transaction-service.ts
git commit -m "feat(functions): teenStudent role known to the server; scope resolver accepts a 12+ minor's own profile (T040V2)"
```

---

### Task 4: Server — `recordSelfCheckIn` transaction and store methods (decisions 5, 6, 7, 16)

**Files:**
- Modify: `apps/functions/src/schedule/attendance-transaction-service.ts`
- Modify: `apps/functions/src/schedule/schedule-service.ts` (`ScheduleStore` type ~line 244, Firestore store ~line 1005, in-memory store ~line 1247+)
- Modify: `apps/functions/src/schedule/schedule-security-boundary.test.ts`

**Interfaces:**
- Consumes: `parseSelfCheckInInput`'s `SelfCheckInInput`, `decideSelfCheckIn`, `isOpenMatProgram` (Task 2), `determinePunctuality`, `buildAttendanceId`, `appendAuditEventInTransaction`, `matchesAuditEventReplay` (existing).
- Produces: `class SelfCheckInRefusedError extends Error { reason: SelfCheckInRefusal; distanceMeters?: number }`; `TransactionalAttendanceService.recordSelfCheckIn(context: MutationContext<SelfCheckInInput>): Promise<AttendanceRecord>`; `ScheduleStore.recordSelfCheckIn(academyId, input, actorId, occurredAt?, actorRole?): Promise<AttendanceRecord>`.

- [ ] **Step 1: Confirm the program document path**

Run: `grep -n '"programs"' apps/functions/src/schedule/booking-transaction-service.ts apps/functions/src/schedule/schedule-service.ts | head -5`
Expected: a `path(academyId, "programs", …)` or `collection(\`academies/${academyId}/programs\`)` — programs live at `academies/{academyId}/programs/{programId}`. If the collection has another name, use that name in Step 4 and in the test seed.

- [ ] **Step 2: Write the failing transaction tests**

Append inside the `describe` of `schedule-security-boundary.test.ts` (reuse `transactionalFirestore`, `auditFields`, `academyId`, `Data`; note the file's `now` is `2026-09-03T18:05:00.000Z`, so the session below starts at 18:00Z and `now` is 5 min after the start → `late`):

```ts
  const town = { latitude: 49.183954, longitude: -2.107142 };
  const near = { latitude: 49.184224, longitude: -2.107142, accuracyMeters: 12 }; // ≈30 m north
  const far = { latitude: 49.185034, longitude: -2.107142, accuracyMeters: 12 }; // ≈120 m north

  function selfCheckInFixture(extra: ReadonlyArray<readonly [string, Data]> = []) {
    const sessionId = "session-self";
    const studentId = "adult-self";
    return {
      sessionId,
      studentId,
      attendanceId: `${sessionId}__${studentId}`,
      fixture: transactionalFirestore(
        new Map<string, Data>([
          [
            `academies/${academyId}/sessions/${sessionId}`,
            { sessionId, academyId, programId: "adult-fundamentals", locationId: "town",
              startAt: "2026-09-03T18:00:00.000Z", endAt: "2026-09-03T19:00:00.000Z", status: "scheduled" },
          ],
          [
            `academies/${academyId}/students/${studentId}`,
            { studentId, academyId, userId: "adult-user-1", fullName: "Synthetic Adult",
              dateOfBirth: "1990-01-01", trainingCenter: "Town", trainingTimePreferences: ["evening"],
              participantType: "adult", ...auditFields() },
          ],
          [
            `academies/${academyId}/bookings/v2:12:session-self:10:adult-self`,
            { bookingId: "v2:12:session-self:10:adult-self", academyId, sessionId, studentId,
              membershipId: "membership-1", status: "confirmed" },
          ],
          [`academies/${academyId}/locations/town`, { locationId: "town", academyId, geofence: town }],
          [`academies/${academyId}/programs/adult-fundamentals`, { programId: "adult-fundamentals", academyId, discipline: "bjj" }],
          ...extra,
        ]),
      ),
    };
  }

  it("self check-in: a member inside 50 m is recorded as self, late after the start, with no coordinates anywhere", async () => {
    const { fixture, sessionId, studentId, attendanceId } = selfCheckInFixture();
    const service = createTransactionalAttendanceService({ firestore: fixture.firestore as never, now: () => now });
    const record = await service.recordSelfCheckIn({
      academyId, input: { sessionId, studentId, position: near }, actorId: "adult-user-1", actorRole: "adultStudent",
    });
    expect(record).toMatchObject({ attendanceId, method: "self", state: "late", createdBy: "adult-user-1",
      proximity: { signal: "within", distanceMeters: 30, accuracyMeters: 12, overrideReason: null } });
    const stored = fixture.documents.get(`academies/${academyId}/attendance/${attendanceId}`);
    const audit = fixture.documents.get(`academies/${academyId}/auditEvents/attendance-check-in-${attendanceId}`);
    expect(audit).toMatchObject({ action: "attendance.checked_in", actorId: "adult-user-1" });
    for (const written of [JSON.stringify(stored), JSON.stringify(audit)]) {
      expect(written).not.toContain("49.18");
      expect(written).not.toContain("-2.107");
      expect(written).not.toContain("latitude");
    }
    // replay returns the same record and writes nothing new
    const again = await service.recordSelfCheckIn({
      academyId, input: { sessionId, studentId, position: near }, actorId: "adult-user-1", actorRole: "adultStudent",
    });
    expect(again).toEqual(record);
  });

  it("self check-in: refusals carry a reason and never a coordinate; staff are refused", async () => {
    const { fixture, sessionId, studentId } = selfCheckInFixture();
    const service = createTransactionalAttendanceService({ firestore: fixture.firestore as never, now: () => now });
    const attempt = (position: typeof near, actorRole: "adultStudent" | "coach" = "adultStudent") =>
      service.recordSelfCheckIn({ academyId, input: { sessionId, studentId, position }, actorId: "adult-user-1", actorRole });

    await expect(attempt(far)).rejects.toMatchObject({ name: "SelfCheckInRefusedError", reason: "outside", distanceMeters: 120 });
    await expect(attempt({ ...near, accuracyMeters: 101 })).rejects.toMatchObject({ reason: "imprecise" });
    await expect(attempt(near, "coach")).rejects.toMatchObject({ code: "credential" });
    await expect(attempt(far)).rejects.not.toThrow(/49\.18|-2\.10/u);
    expect(fixture.documents.has(`academies/${academyId}/attendance/${sessionId}__${studentId}`)).toBe(false);
  });

  it("self check-in: closed window, missing site, missing booking and a coach's earlier record", async () => {
    const closed = selfCheckInFixture();
    const closedService = createTransactionalAttendanceService({ firestore: closed.fixture.firestore as never, now: () => "2026-09-03T18:21:00.000Z" });
    await expect(closedService.recordSelfCheckIn({ academyId, input: { sessionId: closed.sessionId, studentId: closed.studentId, position: near }, actorId: "adult-user-1", actorRole: "adultStudent" }))
      .rejects.toMatchObject({ reason: "window_closed" });

    const noSite = selfCheckInFixture();
    noSite.fixture.documents.set(`academies/${academyId}/locations/town`, { locationId: "town", academyId, geofence: null });
    const noSiteService = createTransactionalAttendanceService({ firestore: noSite.fixture.firestore as never, now: () => now });
    await expect(noSiteService.recordSelfCheckIn({ academyId, input: { sessionId: noSite.sessionId, studentId: noSite.studentId, position: near }, actorId: "adult-user-1", actorRole: "adultStudent" }))
      .rejects.toMatchObject({ reason: "site_not_ready" });

    const unbooked = selfCheckInFixture();
    unbooked.fixture.documents.delete(`academies/${academyId}/bookings/v2:12:session-self:10:adult-self`);
    const unbookedService = createTransactionalAttendanceService({ firestore: unbooked.fixture.firestore as never, now: () => now });
    await expect(unbookedService.recordSelfCheckIn({ academyId, input: { sessionId: unbooked.sessionId, studentId: unbooked.studentId, position: near }, actorId: "adult-user-1", actorRole: "adultStudent" }))
      .rejects.toMatchObject({ reason: "not_booked" });

    const coachFirst = selfCheckInFixture();
    const coachService = createTransactionalAttendanceService({ firestore: coachFirst.fixture.firestore as never, now: () => now });
    await coachService.recordCheckIn({ academyId, input: { sessionId: coachFirst.sessionId, studentId: coachFirst.studentId, method: "manual" }, actorId: "coach-user-1", actorRole: "coach" });
    await expect(coachService.recordSelfCheckIn({ academyId, input: { sessionId: coachFirst.sessionId, studentId: coachFirst.studentId, position: near }, actorId: "adult-user-1", actorRole: "adultStudent" }))
      .rejects.toMatchObject({ reason: "already_checked_in" });
  });
```

If the fixture's booking-id shape (`v2:12:session-self:10:adult-self`) is not one that `buildBookingIdCandidates(sessionId, studentId)` produces, copy the exact shape used by the existing test at line ~120 (`v2:<len>:<sessionId>:<len>:<studentId>`, where the numbers are the lengths of the two ids: `session-self` = 12, `adult-self` = 10).

- [ ] **Step 3: Run to verify they fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule/schedule-security-boundary.test.ts`
Expected: FAIL — `recordSelfCheckIn is not a function`.

- [ ] **Step 4: Implement the transaction**

In `attendance-transaction-service.ts`:

```ts
// imports: add
import {
  decideSelfCheckIn,
  isOpenMatProgram,
  type SelfCheckInInput,
  type SelfCheckInRefusal,
} from "@bpt-jersey/domain/schedule/self-check-in";

/** A member's self check-in that the server refused. `reason` is safe to send to the client. */
export class SelfCheckInRefusedError extends Error {
  public constructor(
    public readonly reason: SelfCheckInRefusal,
    public readonly distanceMeters?: number,
  ) {
    super(`Self check-in refused: ${reason}`);
    this.name = "SelfCheckInRefusedError";
  }
}

const memberRoles = new Set<ScheduleMutationActorRole>(["adultStudent", "teenStudent", "guardian"]);

function siteGeofence(snapshot: BookingDocumentSnapshot): LocationGeofence | null {
  const value = data(snapshot)?.geofence;
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Readonly<{ latitude?: unknown; longitude?: unknown }>;
  return typeof candidate.latitude === "number" && typeof candidate.longitude === "number"
    ? { latitude: candidate.latitude, longitude: candidate.longitude }
    : null;
}
```

Add `recordSelfCheckIn` to the `TransactionalAttendanceService` type:

```ts
  recordSelfCheckIn: (context: MutationContext<SelfCheckInInput>) => Promise<AttendanceRecord>;
```

Add the method to the returned object, after `recordCheckIn`:

```ts
    /**
     * Decision 5: the member's own path, beside the staff one. The gate (window, site, accuracy,
     * distance) is judged inside the transaction on server data and server time; the position is
     * used for one distance and is never written, logged or echoed. Attendance ids are deterministic,
     * so a coach and a member can never produce two records for one session.
     */
    async recordSelfCheckIn(context) {
      const academyId = segment(context.academyId, "academyId");
      const actorId = segment(context.actorId, "actorId");
      const sessionId = segment(context.input.sessionId, "sessionId");
      const studentId = segment(context.input.studentId, "studentId");
      if (!memberRoles.has(context.actorRole)) {
        return fail("credential", "Member authority is required for self check-in");
      }
      const occurredAt = currentTime(context.occurredAt);
      const attendanceId = buildAttendanceId(sessionId, studentId);
      const sessionRef = options.firestore.doc(path(academyId, "sessions", sessionId));
      const studentRef = options.firestore.doc(path(academyId, "students", studentId));
      const attendanceRef = options.firestore.doc(path(academyId, "attendance", attendanceId));
      const auditRef = options.firestore.doc(
        path(academyId, "auditEvents", `attendance-check-in-${attendanceId}`),
      );
      const draft = auditDraft(
        academyId,
        actorId,
        "attendance.checked_in",
        path(academyId, "attendance", attendanceId),
        attendanceId,
      );

      return options.firestore.runTransaction(async (transaction) => {
        const [sessionSnapshot, studentSnapshot, bookings, attendanceSnapshot, auditSnapshot] =
          await Promise.all([
            transaction.get(sessionRef),
            transaction.get(studentRef),
            bookingSnapshots(options.firestore, transaction, academyId, sessionId, studentId),
            transaction.get(attendanceRef),
            transaction.get(auditRef),
          ]);
        const session = requireSession(sessionSnapshot, academyId, sessionId, false);
        requireStudent(studentSnapshot, academyId, studentId);
        try {
          requireConfirmedBooking(bookings, academyId, sessionId, studentId);
        } catch (error) {
          if (error instanceof ScheduleAttendanceError) throw new SelfCheckInRefusedError("not_booked");
          throw error;
        }

        const existing = storedAttendance(attendanceSnapshot, academyId, sessionId, studentId);
        if (existing !== undefined) {
          const replay =
            existing.method === "self" &&
            existing.createdBy === actorId &&
            auditSnapshot.exists &&
            matchesAuditEventReplay(auditSnapshot.data(), auditRef.id, draft);
          if (replay) return existing;
          throw new SelfCheckInRefusedError("already_checked_in");
        }
        if (auditSnapshot.exists) return fail("conflict", "Attendance evidence already exists");

        const raw = data(sessionSnapshot) ?? {};
        const endAt = typeof raw.endAt === "string" ? raw.endAt : session.startAt;
        const programId = typeof raw.programId === "string" ? raw.programId : null;
        const [locationSnapshot, programSnapshot] = await Promise.all([
          session.locationId === null
            ? Promise.resolve(undefined)
            : transaction.get(options.firestore.doc(path(academyId, "locations", session.locationId))),
          programId === null
            ? Promise.resolve(undefined)
            : transaction.get(options.firestore.doc(path(academyId, "programs", programId))),
        ]);
        const decision = decideSelfCheckIn({
          session: { startAt: session.startAt, endAt },
          isOpenMat: isOpenMatProgram(
            programSnapshot === undefined
              ? undefined
              : { discipline: data(programSnapshot)?.discipline as never },
          ),
          site: locationSnapshot === undefined ? null : siteGeofence(locationSnapshot),
          position: context.input.position,
          nowMs: Date.parse(occurredAt),
        });
        if (!decision.ok) {
          throw new SelfCheckInRefusedError(decision.error.reason, decision.error.distanceMeters);
        }

        const record: AttendanceRecord = Object.freeze({
          attendanceId,
          academyId,
          sessionId,
          studentId,
          method: "self",
          state: determinePunctuality(session.startAt, occurredAt),
          occurredAt,
          notes: null,
          correctionOf: null,
          proximity: decision.value,
          schemaVersion: "1",
          createdAt: occurredAt,
          createdBy: actorId,
          updatedAt: occurredAt,
          updatedBy: actorId,
        });
        transaction.create(attendanceRef, record as unknown as BookingDocumentData);
        appendAuditEventInTransaction(transaction, auditRef, draft);
        return record;
      });
    },
```

If `requireSession` returns a value without `locationId`, read it from `raw.locationId` the same way as `endAt`. `LocationGeofence` is already imported from `@bpt-jersey/domain/schedule` in this file; if not, add it.

- [ ] **Step 5: Add the store methods**

`schedule-service.ts` — `ScheduleStore` type, after `recordCheckIn`:

```ts
  recordSelfCheckIn: (
    academyId: string,
    input: SelfCheckInInput,
    actorId: string,
    occurredAt?: string,
    actorRole?: ScheduleMutationActorRole,
  ) => Promise<AttendanceRecord>;
```

Firestore store (next to its `recordCheckIn`, ~line 1005):

```ts
    async recordSelfCheckIn(academyId, input, actorId, occurredAt, actorRole) {
      return attendanceTransactions.recordSelfCheckIn({
        academyId,
        input,
        actorId,
        actorRole: requireAttendanceActorRole(actorRole),
        ...(occurredAt === undefined ? {} : { occurredAt }),
      });
    },
```

In-memory store (next to its `recordCheckIn`, ~line 1900):

```ts
    async recordSelfCheckIn(academyId, input, actorId, occurredAt, actorRole) {
      if (actorRole === undefined || !["adultStudent", "teenStudent", "guardian"].includes(actorRole)) {
        throw new ScheduleAttendanceError("credential", "Member authority is required for self check-in");
      }
      const session = sessionsMap.get(academyId)?.get(input.sessionId);
      if (!session) throw new Error(`Session ${input.sessionId} does not exist`);
      if (session.status === "cancelled") throw new Error(`Cannot check in to cancelled session ${input.sessionId}`);
      const booked = [...(bookingsMap.get(academyId)?.values() ?? [])].some(
        (b) => b.sessionId === input.sessionId && b.studentId === input.studentId && b.status === "confirmed",
      );
      if (!booked) throw new SelfCheckInRefusedError("not_booked");
      if (!attendanceMap.has(academyId)) attendanceMap.set(academyId, new Map());
      const aMap = attendanceMap.get(academyId)!;
      const attendanceId = buildAttendanceId(input.sessionId, input.studentId);
      const existing = aMap.get(attendanceId);
      if (existing) {
        if (existing.method === "self" && existing.createdBy === actorId) return existing;
        throw new SelfCheckInRefusedError("already_checked_in");
      }
      const checkInTime = occurredAt ?? new Date().toISOString();
      const site = (locationsMap.get(academyId) ?? defaultLocations.map((loc) => ({ ...loc, academyId })))
        .find((location) => location.locationId === session.locationId);
      const program = (programsMap.get(academyId) ?? defaultPrograms).find((p) => p.programId === session.programId);
      const decision = decideSelfCheckIn({
        session,
        isOpenMat: isOpenMatProgram(program),
        site: site?.geofence ?? null,
        position: input.position,
        nowMs: Date.parse(checkInTime),
      });
      if (!decision.ok) throw new SelfCheckInRefusedError(decision.error.reason, decision.error.distanceMeters);
      const record: AttendanceRecord = Object.freeze({
        attendanceId, academyId, sessionId: input.sessionId, studentId: input.studentId,
        method: "self", state: determinePunctuality(session.startAt, checkInTime), occurredAt: checkInTime,
        notes: null, correctionOf: null, proximity: decision.value, schemaVersion: "1",
        createdAt: checkInTime, createdBy: actorId, updatedAt: checkInTime, updatedBy: actorId,
      });
      aMap.set(attendanceId, record);
      return record;
    },
```

Add the imports `decideSelfCheckIn, isOpenMatProgram, type SelfCheckInInput` from `@bpt-jersey/domain/schedule/self-check-in` and `SelfCheckInRefusedError` from `./attendance-transaction-service.js`. If `programsMap` is keyed differently (check its `listPrograms` at ~line 1374), mirror that lookup.

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule`
Expected: PASS including the three new boundary tests.

- [ ] **Step 7: Mutation check (LECCIONES §5)**

Temporarily change `distanceMeters > checkInProximityRadiusMeters` to `>=` in `decideSelfCheckIn` → the "exactly 50 m" test must fail. Temporarily remove the `memberRoles` guard → the "staff are refused" test must fail. Temporarily skip the `existing` branch → "coach's earlier record" must fail. Restore each change; run the two files again → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/functions/src/schedule/attendance-transaction-service.ts apps/functions/src/schedule/schedule-service.ts apps/functions/src/schedule/schedule-security-boundary.test.ts
git commit -m "feat(functions): recordSelfCheckIn transaction with the server-side 50 m gate (T040V2)"
```

---

### Task 5: Server — `selfCheckIn` callable (decisions 5, 12)

**Files:**
- Modify: `apps/functions/src/schedule/schedule-callables.ts`
- Modify: `apps/functions/src/schedule/schedule-callables.test.ts`
- Modify: `apps/functions/src/index.ts:96-124` (export list)

**Interfaces:**
- Consumes: `store.recordSelfCheckIn`, `SelfCheckInRefusedError` (Task 4), `parseSelfCheckInInput` (Task 2), `requireStudentScope` (Task 3).
- Produces: `createSelfCheckInHandler(options: StudentScopeOptions)`; callable `selfCheckIn` returning `{ attendance: AttendanceRecord }`; refusals as `HttpsError("failed-precondition", …, { reason, distanceMeters? })`.

- [ ] **Step 1: Write the failing tests** (append a `describe` in `schedule-callables.test.ts`; reuse `fakeRequest`, `ownStudentScope`, `createInMemoryScheduleStore`)

```ts
import { vi } from "vitest"; // already imported at the top
import { createSelfCheckInHandler } from "./schedule-callables";

describe("Self check-in callable", () => {
  const town = { latitude: 49.183954, longitude: -2.107142 };
  const near = { latitude: 49.184224, longitude: -2.107142, accuracyMeters: 12 };
  const far = { latitude: 49.185034, longitude: -2.107142, accuracyMeters: 12 };

  async function seeded() {
    const store = createInMemoryScheduleStore();
    await store.saveLocationGeofence("demo-academy", { locationId: "town", geofence: town }, "owner-1");
    const session = await store.createSession(
      "demo-academy",
      { programId: "adult-fundamentals", locationId: "town", instructorId: "coach-1", title: "Evening Class",
        startAt: "2099-09-01T18:00:00Z", endAt: "2099-09-01T19:00:00Z", capacity: 25 },
      "owner-1",
    );
    await store.requestBooking("demo-academy", { sessionId: session.sessionId, studentId: "student-1", membershipId: "mem-1" }, "student-1");
    return { store, session };
  }

  beforeEach(() => vi.useFakeTimers({ now: new Date("2099-09-01T17:30:00Z") }));
  afterEach(() => vi.useRealTimers());

  it("clocks a member in and refuses staff, strangers and malformed input", async () => {
    const { store, session } = await seeded();
    const handler = createSelfCheckInHandler({ store, resolveClientStudentScope: ownStudentScope });
    const input = { sessionId: session.sessionId, studentId: "student-1", position: near };

    await expect(handler(fakeRequest(input, "coach", "coach-1"))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(handler(fakeRequest(input, "adultStudent", "student-2"))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(handler(fakeRequest({ ...input, extra: true }, "adultStudent", "student-1"))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(handler(fakeRequest({ ...input, position: { ...near, latitude: "49" } }, "adultStudent", "student-1"))).rejects.toMatchObject({ code: "invalid-argument" });

    const result = await handler(fakeRequest(input, "adultStudent", "student-1"));
    expect(result.attendance).toMatchObject({ method: "self", state: "attended", studentId: "student-1" });
    const again = await handler(fakeRequest(input, "adultStudent", "student-1"));
    expect(again.attendance).toEqual(result.attendance);
  });

  it("maps every refusal to failed-precondition with a reason and no coordinate", async () => {
    const { store, session } = await seeded();
    const handler = createSelfCheckInHandler({ store, resolveClientStudentScope: ownStudentScope });
    const attempt = (position: typeof near, studentId = "student-1") =>
      handler(fakeRequest({ sessionId: session.sessionId, studentId, position }, "adultStudent", studentId));

    await expect(attempt(far)).rejects.toMatchObject({ code: "failed-precondition", details: { reason: "outside", distanceMeters: 120 } });
    await expect(attempt({ ...near, accuracyMeters: 101 })).rejects.toMatchObject({ details: { reason: "imprecise" } });
    await expect(attempt(near, "student-9")).rejects.toMatchObject({ details: { reason: "not_booked" } });
    vi.setSystemTime(new Date("2099-09-01T18:21:00Z"));
    await expect(attempt(near)).rejects.toMatchObject({ details: { reason: "window_closed" } });
    await expect(attempt(far)).rejects.not.toThrow(/49\.18/u);
  });

  it("is exported with the shared schedule options", async () => {
    const callables = await import("./schedule-callables");
    expect(typeof callables.selfCheckIn).toBe("function");
  });
});
```

`ownStudentScope` in this file treats `actorUserId === requestedStudentId` as in-scope, so `student-9` must also be booked for the `not_booked` case to reach the store — replace that line with a session the student did not book: create a second session with `store.createSession(...)` (different `startAt: "2099-09-01T18:05:00Z"`) and call `attempt` with its id and `"student-1"`.

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule/schedule-callables.test.ts -t "Self check-in"`
Expected: FAIL — `createSelfCheckInHandler` is not exported.

- [ ] **Step 3: Implement**

In `schedule-callables.ts`:

```ts
// imports: add
import { parseSelfCheckInInput } from "@bpt-jersey/domain/schedule/self-check-in";
import { ScheduleAttendanceError, SelfCheckInRefusedError, type ScheduleMutationActorRole } from "./attendance-transaction-service.js";

function mapSelfCheckInError(error: unknown): never {
  if (error instanceof SelfCheckInRefusedError) {
    throw new HttpsError("failed-precondition", "Self check-in is not available right now", {
      reason: error.reason,
      ...(error.distanceMeters === undefined ? {} : { distanceMeters: error.distanceMeters }),
    });
  }
  if (!(error instanceof HttpsError) && !(error instanceof ScheduleAttendanceError)) {
    // The error only, never the request: the request carries the member's position.
    console.error("self check-in failed", error);
  }
  return mapAttendanceError(error);
}

/**
 * T040V2: the member's own check-in. Staff use `checkIn`. The 50 m rule, the window and the booking
 * are all judged by the store on server data; this handler only authenticates, parses and scopes.
 */
export function createSelfCheckInHandler(options: StudentScopeOptions) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError("permission-denied", "Staff check in members from the coach screen");
    }
    const parsed = parseSelfCheckInInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", "Self check-in request is invalid");
    }
    await requireStudentScope(request, parsed.value.studentId, options);

    try {
      const attendance = await store.recordSelfCheckIn(
        actor.academyId,
        parsed.value,
        actor.userId,
        undefined,
        actor.role as ScheduleMutationActorRole,
      );
      return { attendance };
    } catch (error) {
      return mapSelfCheckInError(error);
    }
  };
}

export const selfCheckIn = onCall(scheduleCallableOptions, async (request) =>
  createSelfCheckInHandler({ store: getStore() })(request),
);
```

In `apps/functions/src/index.ts`, add `selfCheckIn,` in alphabetical order inside the `export { … } from "./schedule/schedule-callables.js";` block (after `saveSession,`).

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule apps/functions/src/index.test.ts`
Expected: PASS. If an index test counts exported callables, raise its number by one and say so in the commit body.

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/schedule/schedule-callables.ts apps/functions/src/schedule/schedule-callables.test.ts apps/functions/src/index.ts
git commit -m "feat(functions): selfCheckIn callable — members only, strict input, coded refusals (T040V2)"
```

---

### Task 6: Web — position helper and refusal sentences (decisions 11, 12)

**Files:**
- Create: `apps/web/src/lib/self-check-in-position.ts`, `apps/web/src/lib/self-check-in-position.test.ts`
- Create: `apps/web/src/lib/calendar/self-check-in-messages.ts`, `apps/web/src/lib/calendar/self-check-in-messages.test.ts`

**Interfaces:**
- Produces: `readDevicePosition(geolocation?): Promise<PositionReading>` with `PositionReading = { status: "ok"; position: SelfCheckInPosition } | { status: "denied" } | { status: "unavailable" }`; `selfCheckInFailureMessage(error: unknown): string`; `positionFailureMessage(status: "denied" | "unavailable"): string`.

- [ ] **Step 1: Write the failing tests**

`self-check-in-position.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { readDevicePosition } from "./self-check-in-position";

type Success = (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void;
type Failure = (e: { code: number }) => void;

describe("readDevicePosition", () => {
  it("returns a rounded position when the device answers", async () => {
    const geolocation = {
      getCurrentPosition: (ok: Success) => ok({ coords: { latitude: 49.18395412345, longitude: -2.1071421, accuracy: 11.6 } }),
    };
    await expect(readDevicePosition(geolocation)).resolves.toEqual({
      status: "ok",
      position: { latitude: 49.183954, longitude: -2.107142, accuracyMeters: 12 },
    });
  });
  it("is denied on permission error code 1 and unavailable otherwise", async () => {
    await expect(readDevicePosition({ getCurrentPosition: (_ok: Success, fail: Failure) => fail({ code: 1 }) })).resolves.toEqual({ status: "denied" });
    await expect(readDevicePosition({ getCurrentPosition: (_ok: Success, fail: Failure) => fail({ code: 2 }) })).resolves.toEqual({ status: "unavailable" });
    await expect(readDevicePosition(undefined)).resolves.toEqual({ status: "unavailable" });
  });
  it("treats a non-finite reading as unavailable", async () => {
    const geolocation = { getCurrentPosition: (ok: Success) => ok({ coords: { latitude: Number.NaN, longitude: 0, accuracy: 5 } }) };
    await expect(readDevicePosition(geolocation)).resolves.toEqual({ status: "unavailable" });
  });
});
```

`self-check-in-messages.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { positionFailureMessage, selfCheckInFailureMessage } from "./self-check-in-messages";

const refusal = (reason: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error("x"), { code: "functions/failed-precondition", details: { reason, ...extra } });

describe("self check-in messages", () => {
  it("turns each refusal into one plain sentence", () => {
    expect(selfCheckInFailureMessage(refusal("outside", { distanceMeters: 120 }))).toBe("You're 120 m away. Get to the gym and try again.");
    expect(selfCheckInFailureMessage(refusal("imprecise"))).toBe("Your location isn't precise enough yet. Turn on Precise Location, step near the entrance and try again.");
    expect(selfCheckInFailureMessage(refusal("site_not_ready"))).toBe("This gym can't take self check-ins yet. Ask a coach to check you in.");
    expect(selfCheckInFailureMessage(refusal("window_closed"))).toBe("Check-in for this class has closed.");
    expect(selfCheckInFailureMessage(refusal("not_booked"))).toBe("You need a confirmed booking for this class.");
    expect(selfCheckInFailureMessage(refusal("already_checked_in"))).toBe("You're already checked in.");
    expect(selfCheckInFailureMessage(new Error("boom"))).toBe("Couldn't check you in. Try again or ask a coach.");
    expect(selfCheckInFailureMessage(Object.assign(new Error("x"), { code: "functions/permission-denied" }))).toBe("Couldn't check you in. Try again or ask a coach.");
  });
  it("explains a missing position", () => {
    expect(positionFailureMessage("denied")).toBe("Location is off. Allow it for this site, or ask a coach to check you in.");
    expect(positionFailureMessage("unavailable")).toBe("Couldn't read your location. Try again outside, or ask a coach to check you in.");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/self-check-in-position.test.ts apps/web/src/lib/calendar/self-check-in-messages.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/web/src/lib/self-check-in-position.ts`:

```ts
import type { SelfCheckInPosition } from "@bpt-jersey/domain/schedule/self-check-in";

/**
 * Decision 11: asked only after the slide commits. The coordinates live in the returned object and
 * in the one request body that carries them; nothing here stores or logs them.
 */
export type PositionReading =
  | Readonly<{ status: "ok"; position: SelfCheckInPosition }>
  | Readonly<{ status: "denied" }>
  | Readonly<{ status: "unavailable" }>;

export type GeolocationLike = Readonly<{
  getCurrentPosition: (
    onSuccess: (position: { coords: { latitude: number; longitude: number; accuracy: number } }) => void,
    onError: (error: { code: number }) => void,
    options?: Readonly<{ enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number }>,
  ) => void;
}>;

const permissionDenied = 1; // GeolocationPositionError.PERMISSION_DENIED
const round6 = (value: number): number => Number(value.toFixed(6));

export function readDevicePosition(
  geolocation: GeolocationLike | undefined = typeof navigator === "undefined"
    ? undefined
    : (navigator.geolocation as GeolocationLike | undefined),
): Promise<PositionReading> {
  if (geolocation === undefined) return Promise.resolve({ status: "unavailable" });
  return new Promise((resolve) => {
    try {
      geolocation.getCurrentPosition(
        ({ coords }) => {
          const { latitude, longitude, accuracy } = coords;
          if (![latitude, longitude, accuracy].every(Number.isFinite) || accuracy < 0) {
            resolve({ status: "unavailable" });
            return;
          }
          resolve({
            status: "ok",
            position: { latitude: round6(latitude), longitude: round6(longitude), accuracyMeters: Math.round(accuracy) },
          });
        },
        (error) => resolve({ status: error?.code === permissionDenied ? "denied" : "unavailable" }),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      );
    } catch {
      resolve({ status: "unavailable" });
    }
  });
}
```

`apps/web/src/lib/calendar/self-check-in-messages.ts`:

```ts
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

const fallback = "Couldn't check you in. Try again or ask a coach.";

/** Decision 12: one sentence per refusal code from `selfCheckIn`; anything else gets the fallback. */
export function selfCheckInFailureMessage(error: unknown): string {
  if (field(error, "code") !== "functions/failed-precondition") return fallback;
  const details = field(error, "details");
  const reason = field(details, "reason");
  const distance = field(details, "distanceMeters");
  switch (reason) {
    case "outside":
      return typeof distance === "number"
        ? `You're ${distance} m away. Get to the gym and try again.`
        : "You're too far from the gym. Get to the gym and try again.";
    case "imprecise":
      return "Your location isn't precise enough yet. Turn on Precise Location, step near the entrance and try again.";
    case "site_not_ready":
      return "This gym can't take self check-ins yet. Ask a coach to check you in.";
    case "window_closed":
      return "Check-in for this class has closed.";
    case "not_booked":
      return "You need a confirmed booking for this class.";
    case "already_checked_in":
      return "You're already checked in.";
    default:
      return fallback;
  }
}

export function positionFailureMessage(status: "denied" | "unavailable"): string {
  return status === "denied"
    ? "Location is off. Allow it for this site, or ask a coach to check you in."
    : "Couldn't read your location. Try again outside, or ask a coach to check you in.";
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/self-check-in-position.test.ts apps/web/src/lib/calendar/self-check-in-messages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/self-check-in-position.ts apps/web/src/lib/self-check-in-position.test.ts apps/web/src/lib/calendar/self-check-in-messages.ts apps/web/src/lib/calendar/self-check-in-messages.test.ts
git commit -m "feat(account): device position reader and self check-in sentences (T040V2)"
```

---

### Task 7: Web — repository port `clockIn`, fixture with sites and a ready session, firebase adapter (decisions 8, 15)

**Files:**
- Modify: `apps/web/src/lib/calendar/calendar-repository.ts`
- Modify: `apps/web/src/lib/calendar/fixture-calendar-repository.ts`, `apps/web/src/lib/calendar/fixture-calendar-repository.test.ts`
- Modify: `apps/web/src/lib/schedule-client.ts`, `apps/web/src/lib/calendar/firebase-calendar-repository.ts`

**Interfaces:**
- Produces: `CalendarRepository.clockIn(input: SelfCheckInInput): Promise<AttendanceRecord>`; fixture sessions `${dateKey}_${locationId}_${programId}_ready` starting 30 min after load for every participant's usual program; `selfCheckIn(input)` in `schedule-client.ts`.

- [ ] **Step 1: Write the failing fixture tests** (append to `fixture-calendar-repository.test.ts`)

```ts
import { nextSelfCheckInSession } from "@bpt-jersey/domain/schedule/self-check-in";

const town = { latitude: 49.183954, longitude: -2.107142 };
const near = { latitude: 49.184224, longitude: -2.107142, accuracyMeters: 12 };
const far = { latitude: 49.185034, longitude: -2.107142, accuracyMeters: 12 };

describe("fixture self check-in", () => {
  const soon = new Date(Date.now() - 3600000).toISOString();
  const later = new Date(Date.now() + 3 * 3600000).toISOString();

  it("seeds one ready session per participant, 30 minutes from load", async () => {
    for (const [role, studentId] of [["teenStudent", "sam"], ["adultStudent", "alex"], ["guardian", "maya"], ["guardian", "leo"]] as const) {
      const repo = createFixtureCalendarRepository(role);
      const week = await repo.loadWeek(studentId, soon, later);
      const candidate = nextSelfCheckInSession({ ...week, nowMs: Date.now() });
      expect(candidate?.kind, `${role}/${studentId}`).toBe("ready");
    }
  });

  it("clocks in inside 50 m, refuses outside with the distance, and refuses twice", async () => {
    const repo = createFixtureCalendarRepository("teenStudent");
    const week = await repo.loadWeek("sam", soon, later);
    const session = nextSelfCheckInSession({ ...week, nowMs: Date.now() })!.session;
    expect(session.locationId).toBe("town");
    await expect(repo.clockIn({ sessionId: session.sessionId, studentId: "sam", position: far })).rejects.toMatchObject({
      code: "functions/failed-precondition", details: { reason: "outside", distanceMeters: 120 },
    });
    const record = await repo.clockIn({ sessionId: session.sessionId, studentId: "sam", position: near });
    expect(record).toMatchObject({ method: "self", state: "attended", sessionId: session.sessionId });
    const after = await repo.loadWeek("sam", soon, later);
    expect(nextSelfCheckInSession({ ...after, nowMs: Date.now() })?.kind).toBe("checkedIn");
    await expect(repo.clockIn({ sessionId: session.sessionId, studentId: "sam", position: near })).resolves.toEqual(record);
  });

  it("refuses a session without a booking", async () => {
    const repo = createFixtureCalendarRepository("adultStudent");
    await expect(repo.clockIn({ sessionId: "nope", studentId: "alex", position: near })).rejects.toMatchObject({ code: "functions/not-found" });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/calendar/fixture-calendar-repository.test.ts`
Expected: FAIL — `clockIn` is not a function / no ready candidate.

- [ ] **Step 3: Extend the port**

`calendar-repository.ts` — add to the imports `import type { SelfCheckInInput } from "@bpt-jersey/domain/schedule/self-check-in";` and to the interface:

```ts
  /** T040V2: the member's own check-in. Refusals arrive as `functions/failed-precondition` + `details.reason`. */
  clockIn(input: SelfCheckInInput): Promise<AttendanceRecord>;
```

- [ ] **Step 4: Extend the fixture**

In `fixture-calendar-repository.ts`:

```ts
// imports: add
import { decideSelfCheckIn, isOpenMatProgram } from "@bpt-jersey/domain/schedule/self-check-in";
import { determinePunctuality, type LocationGeofence } from "@bpt-jersey/domain/schedule";

// Decision 15: the real pins, rounded to the six decimals the domain accepts.
const sites: Readonly<Record<SessionRecord["locationId"], LocationGeofence>> = Object.freeze({
  town: { latitude: 49.183954, longitude: -2.107142 },
  west: { latitude: 49.205824, longitude: -2.185817 },
});
```

In `generateSessions(now)` after the loop, add one "ready" session per (location, program) pair that the seeds use, so every participant has a window open on the workbench:

```ts
  // ponytail: a session 30 min from load per usual slot, so the slider is visible on :9471.
  const readyKey = dateKeyInJersey(now);
  const startAt = new Date(now.getTime() + 30 * 60000);
  const endAt = new Date(startAt.getTime() + 60 * 60000);
  for (const [locationId, programId, title] of [
    ["town", "prog-teens", "Teens BJJ"],
    ["town", "prog-adult", "Adults BJJ"],
    ["west", "prog-kids", "Kids BJJ"],
  ] as const) {
    sessions.push({
      sessionId: `${readyKey}_${locationId}_${programId}_ready`,
      academyId, classId: null, programId, locationId, instructorId: "coach-1", title,
      startAt: startAt.toISOString(), endAt: endAt.toISOString(), capacity: 20, minParticipants: 4,
      status: "scheduled", isSeminar: false, cancellationReason: null, ...audit,
    });
  }
```

In `seedFor`, after `if (nextSession) bookings.push(...)`, add:

```ts
    const ready = mine.find((s) => s.sessionId.endsWith("_ready"));
    if (ready) bookings.push(bookingFor(ready, p));
```

(`isUpcoming` requires start > now + 2 h, so the ready session is not `nextSession`; the explicit line books it.)

Add the method to the returned object:

```ts
    async clockIn(input) {
      const session = sessions.find((s) => s.sessionId === input.sessionId);
      if (!session) throw failure("functions/not-found");
      const booked = bookings.some(
        (b) => b.sessionId === input.sessionId && b.studentId === input.studentId && b.status === "confirmed",
      );
      if (!booked) throw failure("functions/failed-precondition", "not_booked");
      const existing = attendance.find((a) => a.sessionId === input.sessionId && a.studentId === input.studentId);
      if (existing) {
        if (existing.method === "self") return existing;
        throw failure("functions/failed-precondition", "already_checked_in");
      }
      const nowIso = new Date().toISOString();
      const decision = decideSelfCheckIn({
        session,
        isOpenMat: isOpenMatProgram(programs.find((p) => p.programId === session.programId)),
        site: sites[session.locationId],
        position: input.position,
        nowMs: Date.parse(nowIso),
      });
      if (!decision.ok) {
        throw Object.assign(new Error("functions/failed-precondition"), {
          code: "functions/failed-precondition",
          details: decision.error,
        });
      }
      const participant = participants.find((p) => p.studentId === input.studentId) ?? sam;
      const record: AttendanceRecord = {
        ...attendanceFor(session, participant, determinePunctuality(session.startAt, nowIso)),
        method: "self",
        occurredAt: nowIso,
        proximity: decision.value,
      };
      attendance.push(record);
      return record;
    },
```

- [ ] **Step 5: Firebase adapter**

`schedule-client.ts` — add after `recordCheckIn`:

```ts
import type { SelfCheckInInput } from "@bpt-jersey/domain/schedule/self-check-in";

/** T040V2 member self check-in. Errors keep `code` and `details.reason` for the UI to map. */
export async function selfCheckIn(input: SelfCheckInInput): Promise<AttendanceRecord> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<SelfCheckInInput, { attendance: AttendanceRecord }>(functions, "selfCheckIn");
  const result = await callable(input);
  return result.data.attendance;
}
```

`firebase-calendar-repository.ts` — import `selfCheckIn` from `../schedule-client` and add `clockIn: selfCheckIn,` after `cancel: cancelBooking,`. Extend the header comment's list with "(4) `clockIn` → `selfCheckIn`, written against Task 5's contract, unverified until the emulator run".

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/calendar apps/web/src/lib/schedule-client.test.ts`
Expected: PASS (the existing fixture tests still pass: the ready sessions are on today's date, weekday sets unchanged).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/calendar/calendar-repository.ts apps/web/src/lib/calendar/fixture-calendar-repository.ts apps/web/src/lib/calendar/fixture-calendar-repository.test.ts apps/web/src/lib/schedule-client.ts apps/web/src/lib/calendar/firebase-calendar-repository.ts
git commit -m "feat(account): clockIn on the calendar port — fixture with site pins and a ready session; firebase adapter (T040V2)"
```

---

### Task 8: Web — the `ReadyForJiuJitsu` card (decisions 8, 9, 10, 11, 12, 16, 17, 18)

**Files:**
- Create: `apps/web/src/app/account/calendar/ready-for-jiu-jitsu.tsx`, `apps/web/src/app/account/calendar/ready-for-jiu-jitsu.test.tsx`
- Modify: `apps/web/src/app/account/account.css` (append `.ready-*`)

**Interfaces:**
- Consumes: `SelfCheckInCandidate`, `selfCheckInWindowLabels`, `isOpenMatProgram` (Task 1), `readDevicePosition` (Task 6), `selfCheckInFailureMessage`, `positionFailureMessage` (Task 6), `formatSessionTimeRange`, `sessionSite` (`@bpt-jersey/domain/schedule/member-calendar`).
- Produces: `ReadyForJiuJitsu(props: { candidate; program?; studentId; clockIn(input): Promise<AttendanceRecord>; onCheckedIn(record): void; siblingHint?: string })`.

- [ ] **Step 1: Write the failing component tests**

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AttendanceRecord, ProgramRecord, SessionRecord } from "@bpt-jersey/domain/schedule";

import { ReadyForJiuJitsu } from "./ready-for-jiu-jitsu";

const audit = { schemaVersion: "1" as const, createdAt: "", createdBy: "", updatedAt: "", updatedBy: "" };
const session: SessionRecord = {
  sessionId: "s1", academyId: "bpt", classId: null, programId: "prog-teens", locationId: "town",
  instructorId: "c", title: "Teens BJJ", startAt: "2026-09-15T17:00:00.000Z", endAt: "2026-09-15T18:00:00.000Z",
  capacity: 20, minParticipants: 4, status: "scheduled", isSeminar: false, cancellationReason: null, ...audit,
};
const program: ProgramRecord = { programId: "prog-teens", academyId: "bpt", name: "Teens BJJ", ageBand: "teens", discipline: "bjj", level: "all-levels", active: true, schemaVersion: "1" };
const record: AttendanceRecord = {
  attendanceId: "s1__sam", academyId: "bpt", sessionId: "s1", studentId: "sam", method: "self", state: "attended",
  occurredAt: "2026-09-15T16:52:00.000Z", notes: null, correctionOf: null, ...audit,
};
const near = { coords: { latitude: 49.184224, longitude: -2.107142, accuracy: 12 } };

function stubGeolocation(impl: (ok: (p: typeof near) => void, fail: (e: { code: number }) => void) => void) {
  const getCurrentPosition = vi.fn(impl);
  Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
  return getCurrentPosition;
}
function slide(): void {
  const slider = screen.getByRole("slider", { name: /Slide to clock in/u });
  fireEvent.change(slider, { target: { value: "100" } });
  fireEvent.keyUp(slider, { key: "End" });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReadyForJiuJitsu", () => {
  it("shows the two-line headline, the class and the window, and asks for location only after the slide", async () => {
    const getPosition = stubGeolocation((ok) => ok(near));
    const clockIn = vi.fn().mockResolvedValue(record);
    const onCheckedIn = vi.fn();
    render(<ReadyForJiuJitsu candidate={{ kind: "ready", session }} program={program} studentId="sam" clockIn={clockIn} onCheckedIn={onCheckedIn} />);
    expect(screen.getByRole("heading", { name: "Ready for Jiu Jitsu" })).toBeInTheDocument();
    expect(screen.getByText("Teens BJJ · 18:00–19:00 · Town")).toBeInTheDocument();
    expect(screen.getByText("Opens 17:00 · closes 18:20")).toBeInTheDocument();
    expect(getPosition).not.toHaveBeenCalled();
    slide();
    await waitFor(() => expect(clockIn).toHaveBeenCalledWith({ sessionId: "s1", studentId: "sam", position: { latitude: 49.184224, longitude: -2.107142, accuracyMeters: 12 } }));
    await waitFor(() => expect(onCheckedIn).toHaveBeenCalledWith(record));
    expect(getPosition).toHaveBeenCalledTimes(1);
  });

  it("snaps back when released early and does not ask for location", () => {
    const getPosition = stubGeolocation((ok) => ok(near));
    render(<ReadyForJiuJitsu candidate={{ kind: "ready", session }} program={program} studentId="sam" clockIn={vi.fn()} onCheckedIn={vi.fn()} />);
    const slider = screen.getByRole("slider", { name: /Slide to clock in/u }) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "60" } });
    fireEvent.pointerUp(slider);
    expect(slider.value).toBe("0");
    expect(getPosition).not.toHaveBeenCalled();
  });

  it("explains a denied location and a refusal, then lets the member retry", async () => {
    stubGeolocation((_ok, fail) => fail({ code: 1 }));
    const clockIn = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { code: "functions/failed-precondition", details: { reason: "outside", distanceMeters: 120 } }));
    render(<ReadyForJiuJitsu candidate={{ kind: "ready", session }} program={program} studentId="sam" clockIn={clockIn} onCheckedIn={vi.fn()} />);
    slide();
    await screen.findByText("Location is off. Allow it for this site, or ask a coach to check you in.");
    expect(clockIn).not.toHaveBeenCalled();
    stubGeolocation((ok) => ok(near));
    slide();
    await screen.findByText("You're 120 m away. Get to the gym and try again.");
    expect((screen.getByRole("slider") as HTMLInputElement).value).toBe("0");
  });

  it("shows the confirmation card for an existing record, whoever wrote it", () => {
    render(<ReadyForJiuJitsu candidate={{ kind: "checkedIn", session, attendance: { ...record, method: "manual", state: "late", occurredAt: "2026-09-15T17:04:00.000Z" } }} program={program} studentId="sam" clockIn={vi.fn()} onCheckedIn={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "You're in" })).toBeInTheDocument();
    expect(screen.getByText("18:04 · Late")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("shows the sibling hint when given", () => {
    render(<ReadyForJiuJitsu candidate={{ kind: "ready", session }} program={program} studentId="maya" clockIn={vi.fn()} onCheckedIn={vi.fn()} siblingHint="Leo is ready too — switch to Leo" />);
    expect(screen.getByText("Leo is ready too — switch to Leo")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/account/calendar/ready-for-jiu-jitsu.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

`ready-for-jiu-jitsu.tsx`:

```tsx
"use client";

import { useCallback, useState, type KeyboardEvent } from "react";

import type { AttendanceRecord, ProgramRecord } from "@bpt-jersey/domain/schedule";
import { formatSessionTimeRange, sessionSite } from "@bpt-jersey/domain/schedule/member-calendar";
import {
  isOpenMatProgram,
  selfCheckInWindowLabels,
  type SelfCheckInCandidate,
  type SelfCheckInInput,
} from "@bpt-jersey/domain/schedule/self-check-in";

import { readDevicePosition } from "../../../lib/self-check-in-position";
import { positionFailureMessage, selfCheckInFailureMessage } from "../../../lib/calendar/self-check-in-messages";

type Props = Readonly<{
  candidate: SelfCheckInCandidate;
  program?: ProgramRecord;
  studentId: string;
  clockIn: (input: SelfCheckInInput) => Promise<AttendanceRecord>;
  onCheckedIn: (record: AttendanceRecord) => void;
  siblingHint?: string;
}>;

type Phase =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "locating" }>
  | Readonly<{ kind: "sending" }>
  | Readonly<{ kind: "refused"; message: string }>;

const commitAt = 95;
const jerseyClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Jersey", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function punctualityLabel(record: AttendanceRecord): string {
  const time = jerseyClock.format(new Date(record.occurredAt));
  const state = record.state === "attended" ? "On time" : record.state === "late" ? "Late" : record.state;
  return `${time} · ${state}`;
}

export function ReadyForJiuJitsu({ candidate, program, studentId, clockIn, onCheckedIn, siblingHint }: Props) {
  const [value, setValue] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const { session } = candidate;
  const meta = `${session.title} · ${formatSessionTimeRange(session)} · ${sessionSite(session)}`;
  const window = selfCheckInWindowLabels(session, isOpenMatProgram(program));
  const busy = phase.kind === "locating" || phase.kind === "sending";

  const commit = useCallback(async () => {
    setPhase({ kind: "locating" });
    const reading = await readDevicePosition();
    if (reading.status !== "ok") {
      setValue(0);
      setPhase({ kind: "refused", message: positionFailureMessage(reading.status) });
      return;
    }
    setPhase({ kind: "sending" });
    try {
      const record = await clockIn({ sessionId: session.sessionId, studentId, position: reading.position });
      setPhase({ kind: "idle" });
      onCheckedIn(record);
    } catch (error) {
      setValue(0);
      setPhase({ kind: "refused", message: selfCheckInFailureMessage(error) });
    }
  }, [clockIn, onCheckedIn, session.sessionId, studentId]);

  const settle = useCallback(() => {
    if (busy) return;
    if (value >= commitAt) {
      setValue(100);
      void commit();
    } else {
      setValue(0);
    }
  }, [busy, commit, value]);

  const onKeyUp = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "End" || event.key === "ArrowRight" || event.key === "ArrowUp") settle();
  };

  if (candidate.kind === "checkedIn") {
    return (
      <section className="ready-card ready-card--done" aria-labelledby="ready-title">
        <p className="member-eyebrow ready-eyebrow">Checked in</p>
        <h2 className="ready-title" id="ready-title">You&apos;re in</h2>
        <p className="ready-meta">{meta}</p>
        <p className="ready-result">{punctualityLabel(candidate.attendance)}</p>
      </section>
    );
  }

  const status =
    phase.kind === "locating" ? "Checking you're at the gym…" :
    phase.kind === "sending" ? "Clocking you in…" :
    phase.kind === "refused" ? phase.message : "";

  return (
    <section className="ready-card" aria-labelledby="ready-title">
      <h2 className="ready-title" id="ready-title" aria-label="Ready for Jiu Jitsu">
        <span>Ready</span>
        <span>for Jiu Jitsu</span>
      </h2>
      <div className="ready-slider" style={{ "--ready-progress": `${value}%` } as React.CSSProperties}>
        <span className="ready-fill" aria-hidden="true" />
        <span className="ready-label" aria-hidden="true">{busy ? "" : "Slide to clock in"}</span>
        <input
          aria-label={`Slide to clock in for ${session.title}, ${formatSessionTimeRange(session)}, ${sessionSite(session)}`}
          aria-valuetext={`${value}% — release at the end to clock in`}
          className="ready-range"
          disabled={busy}
          max={100}
          min={0}
          onChange={(event) => setValue(Number(event.target.value))}
          onKeyUp={onKeyUp}
          onPointerUp={settle}
          onTouchEnd={settle}
          type="range"
          value={value}
        />
      </div>
      <p className="ready-meta">{meta}</p>
      <p className="ready-window">{`Opens ${window.opens} · closes ${window.closes}`}</p>
      <p
        aria-live="polite"
        className={phase.kind === "refused" ? "ready-status ready-status--refused" : "ready-status"}
        role="status"
      >
        {status}
      </p>
      {siblingHint ? <p className="ready-hint">{siblingHint}</p> : null}
    </section>
  );
}
```

Note on the `aria-label` on the `<h2>`: it lets the accessible name be "Ready for Jiu Jitsu" while the visual text is two spans; the "You're in" heading has plain text so its name is the text.

- [ ] **Step 4: Styles** (append to `account.css`)

```css
/* T040V2 — Ready for Jiu Jitsu (decisions 8, 9, 17): white card on canvas, above the purple header. */
.ready-card {
  background: var(--gi-white);
  border-radius: var(--radius);
  border-top: 0.35rem solid var(--bpt-purple);
  margin: 1rem clamp(1rem, 4vw, 3rem) 0;
  padding: 1.25rem 1.25rem 1rem;
}
.ready-title {
  color: var(--mat-ink);
  display: flex;
  flex-direction: column;
  font-family: var(--font-display), Impact, sans-serif;
  font-size: clamp(3rem, 14vw, 6rem);
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 0.92;
  margin: 0 0 1rem;
  text-transform: uppercase;
}
.ready-eyebrow { color: var(--bpt-purple); }
.ready-slider {
  --ready-progress: 0%;
  background: var(--paper-edge, #e8e7e3);
  border-radius: 999px;
  height: 4rem;
  overflow: hidden;
  position: relative;
}
.ready-fill {
  background: var(--bpt-purple);
  border-radius: 999px;
  inset: 0 auto 0 0;
  position: absolute;
  width: calc(var(--ready-progress) + 3rem);
}
.ready-label {
  color: var(--muted, #65635d);
  font-size: 0.9rem;
  font-weight: 700;
  inset: 0;
  letter-spacing: 0.025em;
  line-height: 4rem;
  position: absolute;
  text-align: center;
  text-transform: uppercase;
}
.ready-range {
  appearance: none;
  background: transparent;
  height: 4rem;
  margin: 0;
  position: relative;
  width: 100%;
}
.ready-range::-webkit-slider-runnable-track { background: transparent; height: 4rem; }
.ready-range::-moz-range-track { background: transparent; height: 4rem; }
.ready-range::-webkit-slider-thumb {
  appearance: none;
  background: var(--bpt-lime);
  border: 2px solid var(--mat-ink);
  border-radius: 999px;
  height: 3.25rem;
  margin-top: 0.375rem;
  width: 3.25rem;
}
.ready-range::-moz-range-thumb {
  background: var(--bpt-lime);
  border: 2px solid var(--mat-ink);
  border-radius: 999px;
  height: 3.25rem;
  width: 3.25rem;
}
.ready-range:focus-visible { outline: 3px solid var(--bpt-purple); outline-offset: 4px; }
.ready-range:disabled { cursor: progress; }
.ready-meta { font-weight: 600; margin: 1rem 0 0; }
.ready-window, .ready-hint { color: var(--muted, #65635d); font-size: 0.85rem; margin: 0.25rem 0 0; }
.ready-status { font-size: 0.95rem; margin: 0.75rem 0 0; min-height: 1.4rem; }
.ready-status--refused {
  background: var(--status-missed);
  border-left: 0.35rem solid #8d1c2f;
  color: #5f1020;
  padding: 0.6rem 0.8rem;
}
.ready-result { font-size: 1.25rem; font-weight: 700; margin: 0.5rem 0 0; }
@media (prefers-reduced-motion: no-preference) {
  .ready-fill { transition: width 220ms ease; }
}
```

If `--paper-edge` / `--muted` are not defined in `globals.css` (check with `grep -n "\-\-muted\|\-\-paper-edge" apps/web/src/app/globals.css`), the fallbacks above render the DESIGN.md values.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run --project web apps/web/src/app/account/calendar/ready-for-jiu-jitsu.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/account/calendar/ready-for-jiu-jitsu.tsx apps/web/src/app/account/calendar/ready-for-jiu-jitsu.test.tsx apps/web/src/app/account/account.css
git commit -m "feat(account): Ready for Jiu Jitsu slider card with states, refusals and confirmation (T040V2)"
```

---

### Task 9: Web — wire the card into `MemberCalendar`: candidate, sibling hint, 60 s poll (decisions 6, 16, 18)

**Files:**
- Modify: `apps/web/src/app/account/calendar/member-calendar.tsx`
- Modify: `apps/web/src/app/account/calendar/member-calendar.test.tsx`
- Modify: `DESIGN.md` (append section 10)

**Interfaces:**
- Consumes: `ReadyForJiuJitsu` (Task 8), `nextSelfCheckInSession` (Task 1), `repository.clockIn` (Task 7).

- [ ] **Step 1: Write the failing tests** (append to `member-calendar.test.tsx`)

```tsx
import { fireEvent } from "@testing-library/react";

describe("MemberCalendar — Ready for Jiu Jitsu", () => {
  const near = { coords: { latitude: 49.184224, longitude: -2.107142, accuracy: 12 } };
  function stubGeolocation() {
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: (ok: (p: typeof near) => void) => ok(near) }, configurable: true });
  }

  it("renders the card as the first child of the app for a teen with an open window", async () => {
    stubViewport(false);
    render(<MemberCalendar onSignOut={vi.fn()} repository={createFixtureCalendarRepository("teenStudent")} session={teen} />);
    const card = await screen.findByRole("region", { name: "Ready for Jiu Jitsu" });
    expect(document.querySelector("main.member-app")?.firstElementChild).toBe(card);
  });

  it("clocks in and turns the card into the confirmation and the session card into attended", async () => {
    stubViewport(false);
    stubGeolocation();
    render(<MemberCalendar onSignOut={vi.fn()} repository={createFixtureCalendarRepository("teenStudent")} session={teen} />);
    const slider = await screen.findByRole("slider", { name: /Slide to clock in/u });
    fireEvent.change(slider, { target: { value: "100" } });
    fireEvent.keyUp(slider, { key: "End" });
    await screen.findByRole("heading", { name: "You're in" });
    await waitFor(() => expect(document.querySelector('li[data-session-id$="_ready"]')?.getAttribute("data-status")).toBe("attended"));
  });

  it("follows the guardian's child chips and names the sibling who is ready too", async () => {
    stubViewport(false);
    render(<MemberCalendar onSignOut={vi.fn()} repository={createFixtureCalendarRepository("guardian")} session={guardian} />);
    await screen.findByRole("slider", { name: /Teens BJJ/u });
    await screen.findByText("Leo is ready too — switch to Leo");
    await userEvent.click(screen.getByRole("button", { name: "Leo" }));
    await screen.findByRole("slider", { name: /Kids BJJ/u });
    await screen.findByText("Maya is ready too — switch to Maya");
  });

  it("re-reads the week every 60 s while a window is open", async () => {
    stubViewport(false);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const repository = createFixtureCalendarRepository("teenStudent");
    const loadWeek = vi.spyOn(repository, "loadWeek");
    render(<MemberCalendar onSignOut={vi.fn()} repository={repository} session={teen} />);
    await screen.findByRole("slider", { name: /Slide to clock in/u });
    const before = loadWeek.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(loadWeek.mock.calls.length).toBeGreaterThan(before);
    vi.useRealTimers();
  });
});
```

If the chip buttons are not named by first name, read `calendar-header.tsx` and use the accessible name it renders (the existing "guardian chips switch colours" test shows the query).

- [ ] **Step 2: Run to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/account/calendar/member-calendar.test.tsx -t "Ready for Jiu Jitsu"`
Expected: FAIL — no region / slider.

- [ ] **Step 3: Implement the orchestration**

In `member-calendar.tsx`:

```tsx
// imports: add
import { nextSelfCheckInSession, type SelfCheckInCandidate } from "@bpt-jersey/domain/schedule/self-check-in";
import { ReadyForJiuJitsu } from "./ready-for-jiu-jitsu";

const pollIntervalMs = 60_000;
```

State and effects, inside the component after `const [reloadToken, setReloadToken] = useState(0);`:

```tsx
  const [pollToken, setPollToken] = useState(0);
  const silentReload = useRef(false);
  const [siblingReady, setSiblingReady] = useState<readonly string[]>([]);
```

Change the week-loading effect: add `pollToken` to its dependency array and replace `setWeekState("loading");` with

```tsx
    if (!silentReload.current) setWeekState("loading");
    silentReload.current = false;
```

After `entriesByDay`, compute the candidate and the sibling hint:

```tsx
  const candidate: SelfCheckInCandidate | undefined = useMemo(
    () => (week && participant ? nextSelfCheckInSession({ ...week, nowMs: now.getTime() }) : undefined),
    [week, participant, now],
  );
  const candidateProgram = candidate ? week?.programs.find((p) => p.programId === candidate.session.programId) : undefined;

  // Decision 18: name the other child whose window is open, without a second slider.
  useEffect(() => {
    const others = (member?.participants ?? []).filter((p) => p.studentId !== selectedStudentId);
    if (member?.role !== "guardian" || others.length === 0) {
      setSiblingReady([]);
      return;
    }
    let active = true;
    const from = new Date(now.getTime() - 3 * 3600000).toISOString();
    const to = new Date(now.getTime() + 3 * 3600000).toISOString();
    Promise.all(
      others.map(async (p) => {
        const data = await repository.loadWeek(p.studentId, from, to);
        return nextSelfCheckInSession({ ...data, nowMs: now.getTime() })?.kind === "ready" ? p.firstName : undefined;
      }),
    )
      .then((names) => { if (active) setSiblingReady(names.filter((n): n is string => Boolean(n))); })
      .catch(() => { if (active) setSiblingReady([]); });
    return () => { active = false; };
  }, [member, selectedStudentId, repository, pollToken, now.getMinutes()]);

  // Decision 6: while a window is open, re-read so a coach's check-in replaces the slider.
  useEffect(() => {
    if (!candidate) return;
    const timer = setInterval(() => {
      silentReload.current = true;
      setPollToken((value) => value + 1);
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [candidate?.kind, candidate?.session.sessionId]);

  const handleCheckedIn = useCallback((record: AttendanceRecord) => {
    setWeek((current) => {
      if (!current) return current;
      const others = current.attendance.filter((a) => a.sessionId !== record.sessionId);
      return { ...current, attendance: [record, ...others] };
    });
  }, []);

  const siblingHint = siblingReady.length > 0 ? `${siblingReady[0]} is ready too — switch to ${siblingReady[0]}` : undefined;
```

Add `useRef` to the React import and `type AttendanceRecord` to the domain import. In the JSX, as the first child of `<main className="member-app">`:

```tsx
      {!failed && weekState === "ready" && candidate && participant ? (
        <ReadyForJiuJitsu
          candidate={candidate}
          clockIn={(input) => repository.clockIn(input)}
          onCheckedIn={handleCheckedIn}
          program={candidateProgram}
          siblingHint={siblingHint}
          studentId={participant.studentId}
        />
      ) : null}
```

Note: `now.getMinutes()` in the sibling effect's dependencies is a deliberate minute-granularity tick from `useMinuteClock`; if ESLint's `react-hooks/exhaustive-deps` rejects it, use `const minuteKey = Math.floor(now.getTime() / 60_000)` above the effect and depend on `minuteKey`.

- [ ] **Step 4: Run the web tests**

Run: `corepack pnpm vitest run --project web apps/web/src/app/account`
Expected: PASS, including the older calendar tests (the first `region` is now the card: the "two day columns" test counts `region`s — if it now sees 3, change that assertion to query `.day-column` elements instead, or give the card `role="region"` via `aria-labelledby` and adjust the count to `+1`; say which in the commit body).

- [ ] **Step 5: DESIGN.md addendum** (append)

```markdown
## 10. Ready for Jiu Jitsu (`/account` self check-in)

The only element allowed above the purple member header: a **Gi White** card with the purple
`0.35rem` top rule, radius `1rem`, holding the two-line headline **READY / FOR JIU JITSU** in Barlow
Condensed 700, Mat Ink, `clamp(3rem, 14vw, 6rem)`, and a native range styled as a slide-to-confirm:
a Paper Edge track, a **BPT Purple** fill that follows the thumb, a **BPT Lime** thumb with a Mat
Ink ring. One line of meta (class · time · site), one line for the window, one status line. A
refusal is the red left-rule band with one plain sentence. The checked-in state replaces the slider
with "YOU'RE IN" and the time. No spinners, no animation beyond the 220 ms fill.
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/account/calendar/member-calendar.tsx apps/web/src/app/account/calendar/member-calendar.test.tsx DESIGN.md
git commit -m "feat(account): Ready for Jiu Jitsu at the top of the calendar — candidate, sibling hint, 60 s poll (T040V2)"
```

---

### Task 10: Playwright on the `:9471` workbench and screenshots (decision 13)

**Files:**
- Create: `qa/tests/account-self-check-in.spec.ts`
- Create: `qa/scripts/account-self-check-in-shots.mjs`

**Interfaces:**
- Consumes: the running workbench (`deploy/compose.yaml`, `bpt-account-app`, fixture source) and the seeded emulator users (`teen@bpt.test`, `tutor@bpt.test`, `Passw0rd!`).

- [ ] **Step 1: Restart the workbench on the new code**

The dev server picks up source changes, but the domain package gained a subpath export. Run:

```bash
docker restart bpt-account-app && sleep 8 && docker logs --tail 5 bpt-account-app
```

Expected: `Ready in …`. Then `curl -sk -o /dev/null -w '%{http_code}\n' https://optimyze-vps-de-prod.tail29c816.ts.net:9471/login` → `200`.

- [ ] **Step 2: Write the spec**

```ts
import { expect, test, type Page } from "@playwright/test";

/**
 * T040V2 Ready for Jiu Jitsu on the tailnet workbench (fixture repository). Opt-in: needs
 * ACCOUNT_WORKBENCH_E2E=true and BASE_URL pointing at the :9471 workbench.
 */
const enabled = process.env.ACCOUNT_WORKBENCH_E2E === "true";
const password = "Passw0rd!";
const town = { latitude: 49.183954, longitude: -2.107142 };
const far = { latitude: 49.185034, longitude: -2.107142 }; // ≈120 m north

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/iu }).click();
  await page.waitForURL(/\/account/u);
}

test.describe("Ready for Jiu Jitsu @account", () => {
  test.skip(!enabled, "ACCOUNT_WORKBENCH_E2E is not enabled");
  const errors: string[] = [];
  test.beforeEach(({ page }) => {
    errors.length = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  });
  test.afterEach(() => expect(errors, errors.join(" | ")).toEqual([]));

  test("sits at the very top and clocks a teen in from inside 50 m, keyboard only", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ ...town, accuracy: 12 });
    await login(page, "teen@bpt.test");
    const card = page.getByRole("region", { name: "Ready for Jiu Jitsu" });
    await expect(card).toBeVisible();
    await expect(page.locator("main.member-app > *").first()).toHaveClass(/ready-card/u);
    const slider = card.getByRole("slider", { name: /Slide to clock in/u });
    await slider.focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("heading", { name: "You're in" })).toBeVisible();
    await expect(page.getByText(/\d{2}:\d{2} · (On time|Late)/u)).toBeVisible();
    await expect(page.locator('li[data-session-id$="_ready"]')).toHaveAttribute("data-status", "attended");
  });

  test("refuses from 120 m away and says how far", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ ...far, accuracy: 12 });
    await login(page, "teen@bpt.test");
    const slider = page.getByRole("slider", { name: /Slide to clock in/u });
    await slider.focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("status")).toHaveText("You're 120 m away. Get to the gym and try again.");
    await expect(slider).toHaveValue("0");
  });

  test("explains a denied location without calling the backend", async ({ page }) => {
    await login(page, "teen@bpt.test");
    const slider = page.getByRole("slider", { name: /Slide to clock in/u });
    await slider.focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("status")).toHaveText("Location is off. Allow it for this site, or ask a coach to check you in.");
  });

  test("guardian: slider follows the child chip and names the sibling", async ({ page }) => {
    await login(page, "tutor@bpt.test");
    await expect(page.getByRole("slider", { name: /Teens BJJ/u })).toBeVisible();
    await expect(page.getByText("Leo is ready too — switch to Leo")).toBeVisible();
    await page.getByRole("button", { name: "Leo" }).click();
    await expect(page.getByRole("slider", { name: /Kids BJJ/u })).toBeVisible();
  });
});
```

- [ ] **Step 3: Run it against the workbench at both viewports**

```bash
cd /root/BPT-Jersey/qa
ACCOUNT_WORKBENCH_E2E=true BASE_URL=https://optimyze-vps-de-prod.tail29c816.ts.net:9471 \
  corepack pnpm exec playwright test tests/account-self-check-in.spec.ts --project desktop-chromium --project mobile-chromium
```

Expected: 8 passed (4 × 2 projects). If `run-e2e.mjs` is preferred, `node run-e2e.mjs tests/account-self-check-in.spec.ts` with the same env works too as long as it does not start a local server when `BASE_URL` is set (check the top of `run-e2e.mjs`; if it always builds, use the direct `playwright test` line above).

- [ ] **Step 4: Screenshot script**

`qa/scripts/account-self-check-in-shots.mjs`:

```js
// Screenshots of the Ready for Jiu Jitsu states on the workbench. Run from qa/: node scripts/account-self-check-in-shots.mjs
import { chromium } from "@playwright/test";

const base = process.env.ACCOUNT_BASE_URL ?? "https://optimyze-vps-de-prod.tail29c816.ts.net:9471";
const town = { latitude: 49.183954, longitude: -2.107142, accuracy: 12 };
const far = { latitude: 49.185034, longitude: -2.107142, accuracy: 12 };
const viewports = [["phone", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 800 }]];

async function login(page) {
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "teen@bpt.test");
  await page.fill('input[type="password"]', "Passw0rd!");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/account/);
  await page.waitForSelector(".ready-card");
}
async function slide(page) {
  await page.getByRole("slider").focus();
  await page.keyboard.press("End");
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const [name, viewport] of viewports) {
  for (const [state, geo] of [["idle", town], ["done", town], ["refused", far]]) {
    const context = await browser.newContext({ viewport, geolocation: geo, permissions: ["geolocation"] });
    const page = await context.newPage();
    await login(page);
    if (state !== "idle") {
      await slide(page);
      await page.waitForSelector(state === "done" ? ".ready-card--done" : ".ready-status--refused");
    }
    await page.screenshot({ path: `screenshots/ready-${state}-${name}.png`, fullPage: true });
    console.log(`ready-${state}-${name}.png`);
    await context.close();
  }
}
await browser.close();
```

Run: `cd /root/BPT-Jersey/qa && node scripts/account-self-check-in-shots.mjs`
Expected: six PNGs under `qa/screenshots/`. Open each with the Read tool and compare against the spec §5 table and DESIGN.md §10: two-line headline, white card first, purple fill, lime thumb, red-rule refusal band, no horizontal overflow at 390 px.

- [ ] **Step 5: Commit**

```bash
git add qa/tests/account-self-check-in.spec.ts qa/scripts/account-self-check-in-shots.mjs
git commit -m "test(account): Playwright for Ready for Jiu Jitsu on the workbench, with real geolocation (T040V2)"
```

(`qa/screenshots/` is not versioned; do not add it.)

---

### Task 11: Ledger row, board, BRIEF amendment, full gate

**Files:**
- Modify: `tasksv2.md` (new section before "## Preguntas abiertas del operador")
- Modify: `Listav2/Listav2.data.js` (`membersItems`, `RESOLUTION_REQUIREMENTS`, `TASK_SURFACES`), regenerate `Listav2/Listav2.js`
- Modify: `BRIEF.md:79-80` (decision 5)
- Modify: the spec header if the id is not `T040V2`

- [ ] **Step 1: Pick the id**

Run: `grep -oE '^\| T[0-9]{3}V2' tasksv2.md | sort -u | tail -1`
Expected: the highest row in the ledger. The sync test requires ids without gaps, so the new row is **that number + 1**. If the classes session has not yet written T032V2–T039V2, the row is `T032V2` and the classes plan renumbers when it lands; update the spec header line 4 and every "T040V2" in this plan's commit messages to the id actually used, and say so in the commit body.

- [ ] **Step 2: Ledger row** (insert as a new section `## V2-H - Check-in del propio miembro` after V2-G, one line per row exactly like the others)

```markdown
## V2-H - Check-in del propio miembro

| ID   | Tarea atomica | Depende de | Estado | Evidencia de salida |
| ---- | ------------- | ---------- | ------ | ------------------- |
| T0NNV2 | Slider "Ready for Jiu Jitsu" en /account: check-in del propio miembro con puerta de 50 m en el servidor y puntualidad | - | revision | Spec `docs/superpowers/specs/2026-09-14-ready-for-jiu-jitsu-self-check-in-design.md` (20 decisiones, grill 2026-09-15) y plan `docs/superpowers/plans/2026-09-15-ready-for-jiu-jitsu-self-check-in.md`. Construido: reglas puras en `packages/domain/src/schedule/self-check-in-contracts.ts` (ventana -60/+20 min, open mat hasta `endAt`, candidato, parser estricto, puerta distancia ≤ 50 m con precision ≤ 100 m); callable `selfCheckIn` solo para adultStudent/teenStudent/guardian, transaccion `recordSelfCheckIn` que juzga en el servidor y nunca persiste coordenadas (prueba de fuga en `schedule-security-boundary.test.ts`); metodo `self`; rol `teenStudent` conocido por el servidor; tarjeta `ready-for-jiu-jitsu.tsx` primera en `/account`, sondeo cada 60 s (costura con el equipo de coaches: cualquier asistencia esconde el slider). Fixture con los pines de Town y West; adaptador Firebase escrito, SIN verificar contra emulador (no hay Java en el VPS). Evidencia: vitest dominio+functions+web en verde, Playwright `account-self-check-in.spec.ts` 8/8 en :9471 con geolocalizacion real, capturas `qa/screenshots/ready-*.png`. Pendiente para `desplegada`: desplegar `functions:selfCheckIn`, cargar los pines en `/admin/classes` (hasta entonces responde `site_not_ready`), correr el emulador con Java. |
```

- [ ] **Step 3: Board**

In `Listav2/Listav2.data.js`:

Append to `membersItems`:

```js
  task(
    "T0NNV2",
    "Slider «Ready for Jiu Jitsu»: check-in del propio miembro con puerta de 50 m en el servidor",
    "revision",
    "El miembro se marca presente desde su móvil una hora antes; el servidor decide si está en el gimnasio.",
    "-",
    "Construido el 2026-09-15 con el mismo patrón que el calendario: reglas puras, callable propio junto al de staff, puerto con fixture viva y adaptador Firebase sin verificar. Las coordenadas se usan para una distancia y no se guardan, registran ni auditan; hay prueba de fuga. Cualquier asistencia, sea del coach o del miembro, esconde el slider: esa es la costura con el equipo de coaches.",
    [REF_TASKS, "docs/superpowers/specs/2026-09-14-ready-for-jiu-jitsu-self-check-in-design.md", "apps/functions/src/schedule/attendance-transaction-service.ts"],
    "funcion",
  ),
```

Add to `RESOLUTION_REQUIREMENTS`:

```js
  T0NNV2: [
    requirement("Reglas puras con pruebas: ventana, open mat, candidato, parser, puerta. HECHO EL 2026-09-15.", true),
    requirement("Callable selfCheckIn con puerta en el servidor y prueba de que no se persiste ninguna coordenada. HECHO EL 2026-09-15.", true),
    requirement("Tarjeta en /account, primera del todo, con Playwright en :9471 y geolocalización real. HECHO EL 2026-09-15.", true),
    requirement("Desplegar functions:selfCheckIn y cargar los pines de Town y West en el panel de sedes."),
    requirement("Verificar el adaptador Firebase contra el emulador (necesita Java)."),
  ],
```

Add to `TASK_SURFACES`:

```js
  T0NNV2: [
    "packages/domain/src/schedule/self-check-in-contracts.ts",
    "packages/domain/src/schedule/schedule-contracts.ts",
    "packages/domain/src/actor-context.ts",
    "apps/functions/src/schedule/attendance-transaction-service.ts",
    "apps/functions/src/schedule/schedule-service.ts",
    "apps/functions/src/schedule/schedule-callables.ts",
    "apps/functions/src/schedule/canonical-client-student-scope.ts",
    "apps/functions/src/index.ts",
    "apps/web/src/lib/calendar/calendar-repository.ts",
    "apps/web/src/lib/calendar/fixture-calendar-repository.ts",
    "apps/web/src/lib/calendar/firebase-calendar-repository.ts",
    "apps/web/src/lib/schedule-client.ts",
    "apps/web/src/app/account/calendar/ready-for-jiu-jitsu.tsx",
    "apps/web/src/app/account/calendar/member-calendar.tsx",
    "apps/web/src/app/account/account.css",
  ],
```

Then regenerate and verify:

```bash
node Listav2/build.mjs && node Listav2/parallel-report.mjs
corepack pnpm vitest run --project node qa/unit/listav2-ledger-sync.test.ts qa/unit/listav2-interference.test.ts qa/unit/listav2-checklist.test.ts
```

Expected: PASS. (`parallel-report.mjs` rewrites the REPARTO block in `tasksv2.md`; that change is part of this commit.)

- [ ] **Step 4: BRIEF decision 5 amendment** — append to the decision 5 paragraph:

```markdown
   **Enmendada el 2026-09-15 (fila T0NNV2).** Para el **check-in del propio miembro** desde `/account`
   el radio es una puerta dura sin override: el servidor calcula la distancia con las coordenadas
   que envía el teléfono, exige precisión ≤ 100 m y distancia ≤ 50 m, y descarta las coordenadas sin
   guardarlas ni registrarlas. El check-in de staff no cambia: sigue siendo señal más override con
   motivo y auditoría.
```

- [ ] **Step 5: Full gate**

```bash
corepack pnpm format && corepack pnpm format:check && corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test
```

Expected: all green. `format` may reflow the new files only; if it reflows a `tasksv2.md` row onto several lines, revert that (rows must stay single-line: see commit `be977e6`).

- [ ] **Step 6: Commit**

```bash
git add tasksv2.md Listav2/Listav2.data.js Listav2/Listav2.js BRIEF.md docs/superpowers/specs/2026-09-14-ready-for-jiu-jitsu-self-check-in-design.md docs/superpowers/plans/2026-09-15-ready-for-jiu-jitsu-self-check-in.md
git commit -m "docs(ledger): T0NNV2 Ready for Jiu Jitsu — row, board, BRIEF decision 5 amendment"
```

---

### Task 12: Review pass and best-effort emulator run (decision 13, spec §7)

**Files:**
- Modify only what a review finding requires; each fix is its own small commit.
- Optional create: `qa/tests/self-check-in-auth-emulator.spec.ts` if the container run works.

- [ ] **Step 1: Design reviews on the card** — invoke, in this order, `impeccable` (critique the card at 390 px against DESIGN.md §10 using the screenshots), `taste-skill`, `redesign-skill`. Apply only findings that keep decisions 8, 9, 17; record rejected findings and why in the task's commit body.

- [ ] **Step 2: Security reviews** — invoke `security-best-practices` and `frontend-security-coder` on `schedule-callables.ts` (`createSelfCheckInHandler`), `attendance-transaction-service.ts` (`recordSelfCheckIn`), `self-check-in-position.ts` and `ready-for-jiu-jitsu.tsx`. Checklist they must confirm: App Check enforced; strict schema; staff refused; scope by role; coordinates absent from record, audit, errors and logs; location requested only on a user gesture; no `dangerouslySetInnerHTML`; refusal sentences contain no user-controlled text except the integer distance.

- [ ] **Step 3: Ponytail pass** — invoke `ponytail:ponytail` on `git diff origin/main -- <files from TASK_SURFACES>`; remove anything speculative it flags that no test needs.

- [ ] **Step 4: Emulator (best effort)** — Java is not on the VPS. Run in a throwaway container that never touches the host:

```bash
docker run --rm -v /root/BPT-Jersey:/app -w /app node:22-trixie bash -c '
  apt-get update -qq && apt-get install -y -qq openjdk-21-jre-headless >/dev/null &&
  corepack enable &&
  export FUNCTIONS_DISCOVERY_TIMEOUT=300000 &&
  corepack pnpm --filter @bpt-jersey/domain build:runtime &&
  corepack pnpm --filter @bpt-jersey/functions build &&
  corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions \
    "cd qa && T096_SCHEDULE_EMULATOR_E2E=true T096_E2E_ACADEMY_ID=demo-academy corepack pnpm exec playwright test tests/schedule-auth-emulator.spec.ts --project desktop-chromium"'
```

If that green-lights the existing T096 spec, add one test to `qa/tests/schedule-auth-emulator.spec.ts` inside its `describe`, reusing its helpers `signIn`, `call`, `ok`, `denied`, `enrolAdult` and `sessionInput` (read lines 102–283 for their exact signatures):

```ts
  test("selfCheckIn: adult inside 50 m is recorded as self; outside is refused with a reason @critical", async ({ request }) => {
    const owner = await signIn(request, process.env.T096_OWNER_EMAIL);
    await ok(request, "saveLocationGeofence", { locationId: "town", geofence: { latitude: 49.183954, longitude: -2.107142 } }, owner);
    const adult = await enrolAdult(request, owner); // returns the adult's session and studentId as the first test uses them
    const start = new Date(Date.now() + 30 * 60000).toISOString();
    const end = new Date(Date.now() + 90 * 60000).toISOString();
    const { session } = await ok<{ session: { sessionId: string } }>(request, "saveSession", sessionInput("town", start, end), owner);
    await ok(request, "requestBooking", { sessionId: session.sessionId, studentId: adult.studentId, membershipId: adult.membershipId }, adult.session);
    const outside = await call(request, "selfCheckIn", { sessionId: session.sessionId, studentId: adult.studentId, position: { latitude: 49.185034, longitude: -2.107142, accuracyMeters: 12 } }, { session: adult.session });
    expect(outside.status).toBe(400);
    expect(outside.body.error?.details).toMatchObject({ reason: "outside", distanceMeters: 120 });
    const inside = await ok<{ attendance: { method: string; state: string } }>(request, "selfCheckIn", { sessionId: session.sessionId, studentId: adult.studentId, position: { latitude: 49.184224, longitude: -2.107142, accuracyMeters: 12 } }, adult.session);
    expect(inside.attendance).toMatchObject({ method: "self", state: "attended" });
    await denied(request, "selfCheckIn", { sessionId: session.sessionId, studentId: adult.studentId, position: { latitude: 49.184224, longitude: -2.107142, accuracyMeters: 12 } }, owner);
  });
```

Adjust `sessionInput`'s arguments and `enrolAdult`'s return shape to what those helpers actually take and return. If the container cannot get Java 21 (`node:22-trixie` missing, or the package absent), stop here and write in the ledger row that the emulator run was **not** done and why; the firebase adapter stays marked unverified. Never install Java on the host.

- [ ] **Step 5: Final report** — `git log --oneline origin/main..HEAD | head -20`, the vitest totals, the Playwright line, the six screenshot paths, the review outcomes, and the emulator result (done / not done, with the reason). Update the ledger row status to `aprobada` only if the emulator run passed; otherwise it stays `revision` with the pending items listed.

---

## Self-review against the spec

- **Coverage:** §2 decisions 1–20 → Tasks 1 (3, 6, 16, 20), 2 (2, 7, 12, 14), 3 (4), 4 (5, 6, 7, 16), 5 (5, 12), 6 (11, 12), 7 (8, 15), 8 (8–12, 16–18), 9 (6, 16, 18), 10 (13), 11 (ledger/BRIEF amendments), 12 (13, §7 reviews, emulator). §3 rules: all functions named there exist in Tasks 1–2 with those names. §4 handler order: Task 5 steps match. §5 states table: Task 8. §6 security notes: Tasks 4, 5, 6, 12. §7 tests: Tasks 1–10. §8 rollout: Task 11 ledger text.
- **Placeholders:** none; every step has its code. Two steps ask the executor to confirm a shape in a neighbouring file (`programs` path, `enrolAdult` return) and say what to do in each case.
- **Type consistency:** `SelfCheckInInput { sessionId; studentId; position }` and `SelfCheckInPosition { latitude; longitude; accuracyMeters }` are used identically in Tasks 2, 4, 5, 6, 7, 8, 10. `decideSelfCheckIn` returns `Result<AttendanceProximity, { reason; distanceMeters? }>` and every consumer (Tasks 4, 7) reads `decision.error.reason` / `.distanceMeters`. `SelfCheckInRefusedError(reason, distanceMeters?)` is thrown in Task 4 and mapped in Task 5. `CalendarRepository.clockIn(input)` (Task 7) is what Task 8 receives as the `clockIn` prop and Task 9 passes as `(input) => repository.clockIn(input)`.
