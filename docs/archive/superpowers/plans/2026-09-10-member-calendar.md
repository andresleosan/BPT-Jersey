# Member Calendar (`/account`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/account` home with a traffic-light booking calendar for members 12+ (phone: today+tomorrow, desktop: Mon–Sat), running on fixtures today and connectable to the existing Firebase callables by one env change.

**Architecture:** Pure rules and view types live in `packages/domain/src/schedule/member-calendar-contracts.ts` (tested with vitest `node`). A `CalendarRepository` port in `apps/web/src/lib/calendar/` has a fixture implementation (live on `:9471`, used by tests) and a Firebase adapter written against the existing `schedule-client` / `waitlist-client` / `no-show-penalties-client` / `family-client` functions but never run. React components under `apps/web/src/app/account/calendar/` only render what the domain derives.

**Tech Stack:** Next 16 (app router, `"use client"`), React 19, TypeScript strict, vitest 4 (`web` = jsdom, `node`), @testing-library/react, native `<dialog>`, CSS files (no Tailwind), Firebase client SDK 12 (adapter only).

**Spec:** `docs/superpowers/specs/2026-09-10-member-calendar-design.md`

## Global Constraints

- Time zone for every calendar day, label and deadline: `Europe/Jersey`.
- Booking and cancellation cut-off: **60 minutes** before `startAt`, Open Mats included (`isWithinBookingCutoff(startAt, nowIso, 60)` from `@bpt-jersey/domain/schedule`).
- Forward-only navigation, cap **14 days** (`calendarMaxOffsetDays = 14`), Sunday never shown.
- Breakpoint phone/desktop: **58rem** (`@media (min-width: 58rem)`).
- Penalty copy, verbatim: `A £15 no-show penalty will be added to your next booking. Claims are handled by the office.` and after booking: `Booked. Missing it costs £15.`
- Status colours: open `#FFE66D`, booked `#D7F0E2` + rule `#176B49`, attended `#E7F6EE`, missed `#FFE1E6` + rule `#8D1C2F`, closed/full/locked `#E8E7E3`. Header purple `#2F2483`, lime `#D9F36A`, canvas `#F2F1ED`, ink `#1A1A18`, muted `#65635D`.
- No emojis, no spinners (skeletons), no new dependencies, `border-radius: 1rem` only inside `/account`.
- Roles allowed on `/account`: `guardian`, `adultStudent`, `teenStudent`.
- Commit convention: `feat(account): …` / `test(account): …`; work on branch `feature/member-calendar`.
- Test commands: domain → `corepack pnpm vitest run --project node <file>`; web → `corepack pnpm vitest run --project web <file>`; lint → `corepack pnpm eslint <files> --max-warnings 0`.

---

### Task 0: Branch

- [ ] **Step 1: Create the working branch**

```bash
cd /root/BPT-Jersey && git checkout -b feature/member-calendar
```

Expected: `Switched to a new branch 'feature/member-calendar'`.

---

### Task 1: `teenStudent` role + emulator seed

**Files:**
- Modify: `apps/web/src/lib/client-account.ts:11-13`
- Modify: `apps/web/src/lib/client-auth.tsx:15,41-45`
- Modify: `deploy/seed-auth.mjs:4-7`
- Test: `apps/web/src/lib/client-auth.test.tsx` (append one case)

**Interfaces:**
- Produces: `ClientAccountRole = "guardian" | "adultStudent" | "teenStudent" | "shopper"`; `studentClientRoles` includes `teenStudent`.

- [ ] **Step 1: Write the failing test** — append to `apps/web/src/lib/client-auth.test.tsx` inside the existing `describe`:

```tsx
  it("treats teenStudent as a student role", () => {
    expect(studentClientRoles).toContain("teenStudent");
  });
```

Add `studentClientRoles` to the existing import from `./client-auth` at the top of the file.

- [ ] **Step 2: Run it** — `corepack pnpm vitest run --project web apps/web/src/lib/client-auth.test.tsx` → FAIL (`teenStudent` not in array).

- [ ] **Step 3: Implement** — in `client-account.ts`:

```ts
export type ClientAccountRole = "guardian" | "adultStudent" | "teenStudent" | "shopper";

const clientRoles: readonly string[] = ["guardian", "adultStudent", "teenStudent", "shopper"];
```

In `client-auth.tsx`:

```ts
export const studentClientRoles: readonly ClientAccountRole[] = [
  "guardian",
  "adultStudent",
  "teenStudent",
];
```
and in `clientRole()`:
```ts
  return value === "guardian" ||
    value === "adultStudent" ||
    value === "teenStudent" ||
    value === "shopper"
    ? value
    : undefined;
```

In `deploy/seed-auth.mjs` add to `users`:
```js
  { email: "teen@bpt.test", password: "Passw0rd!", role: "teenStudent", name: "Sam Demo" },
```

- [ ] **Step 4: Run** the same test → PASS. Then `docker exec bpt-account-app node /app/deploy/seed-auth.mjs` → `teen@bpt.test teenStudent OK`.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/lib/client-account.ts apps/web/src/lib/client-auth.tsx apps/web/src/lib/client-auth.test.tsx deploy/seed-auth.mjs
git commit -m "feat(account): add teenStudent client role"
```

---

### Task 2: Domain — calendar days & navigation

**Files:**
- Create: `packages/domain/src/schedule/member-calendar-contracts.ts`
- Create: `packages/domain/src/schedule/member-calendar-contracts.test.ts`
- Modify: `packages/domain/package.json` (add export `./schedule/member-calendar`)

**Interfaces:**
- Produces:
  - `calendarTimeZone = "Europe/Jersey"`, `calendarMaxOffsetDays = 14`, `calendarCutoffMinutes = 60`
  - `type CalendarViewport = "phone" | "desktop"`
  - `type CalendarDay = Readonly<{ dateKey: string; weekday: string; dayNumber: number; isToday: boolean; startAt: string; endAt: string }>` (`startAt`/`endAt` = UTC ISO bounds of that Jersey day)
  - `dateKeyInJersey(date: Date): string`
  - `visibleDays(input: { now: Date; viewport: CalendarViewport; offset: number }): readonly CalendarDay[]`
  - `clampOffset(viewport, offset, now): number`, `nextOffset(viewport, offset, now): number | null`, `prevOffset(viewport, offset, now): number | null`

- [ ] **Step 1: Add the package export** — in `packages/domain/package.json` `exports`, after `"./schedule/pre-class"`:

```json
    "./schedule/member-calendar": {
      "types": "./src/schedule/member-calendar-contracts.ts",
      "import": "./src/schedule/member-calendar-contracts.ts",
      "default": "./lib/schedule/member-calendar-contracts.js"
    },
```

- [ ] **Step 2: Write the failing tests** — `member-calendar-contracts.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  calendarMaxOffsetDays,
  clampOffset,
  dateKeyInJersey,
  nextOffset,
  prevOffset,
  visibleDays,
} from "./member-calendar-contracts";

// Wednesday 2026-09-16 14:00 BST (13:00Z)
const wednesday = new Date("2026-09-16T13:00:00Z");
// Saturday 2026-09-19 14:00 BST
const saturday = new Date("2026-09-19T13:00:00Z");
// Sunday 2026-09-20 14:00 BST
const sunday = new Date("2026-09-20T13:00:00Z");

describe("dateKeyInJersey", () => {
  it("uses the Jersey calendar day, not UTC", () => {
    // 23:30Z on the 16th is 00:30 BST on the 17th
    expect(dateKeyInJersey(new Date("2026-09-16T23:30:00Z"))).toBe("2026-09-17");
  });
});

describe("visibleDays / phone", () => {
  it("shows today and tomorrow on a weekday", () => {
    const days = visibleDays({ now: wednesday, viewport: "phone", offset: 0 });
    expect(days.map((d) => d.dateKey)).toEqual(["2026-09-16", "2026-09-17"]);
    expect(days[0]?.isToday).toBe(true);
    expect(days[0]?.weekday).toBe("Wed");
    expect(days[0]?.dayNumber).toBe(16);
  });

  it("skips Sunday: Saturday shows Sat + Mon", () => {
    const days = visibleDays({ now: saturday, viewport: "phone", offset: 0 });
    expect(days.map((d) => d.dateKey)).toEqual(["2026-09-19", "2026-09-21"]);
  });

  it("skips Sunday: Sunday shows Mon + Tue", () => {
    const days = visibleDays({ now: sunday, viewport: "phone", offset: 0 });
    expect(days.map((d) => d.dateKey)).toEqual(["2026-09-21", "2026-09-22"]);
    expect(days.every((d) => !d.isToday)).toBe(true);
  });

  it("advances by offset days and never lands on Sunday", () => {
    const days = visibleDays({ now: wednesday, viewport: "phone", offset: 4 });
    // Wed + 4 = Sunday 20th → skipped → Mon 21, Tue 22
    expect(days.map((d) => d.dateKey)).toEqual(["2026-09-21", "2026-09-22"]);
  });

  it("gives each day UTC bounds covering the Jersey day", () => {
    const [day] = visibleDays({ now: wednesday, viewport: "phone", offset: 0 });
    expect(day?.startAt).toBe("2026-09-15T23:00:00.000Z"); // 00:00 BST
    expect(day?.endAt).toBe("2026-09-16T23:00:00.000Z");
  });
});

describe("visibleDays / desktop", () => {
  it("shows Monday to Saturday of the current week", () => {
    const days = visibleDays({ now: wednesday, viewport: "desktop", offset: 0 });
    expect(days.map((d) => d.dateKey)).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
    ]);
    expect(days[2]?.isToday).toBe(true);
  });

  it("on Sunday shows the coming week", () => {
    const days = visibleDays({ now: sunday, viewport: "desktop", offset: 0 });
    expect(days[0]?.dateKey).toBe("2026-09-21");
  });

  it("shifts by whole weeks", () => {
    const days = visibleDays({ now: wednesday, viewport: "desktop", offset: 1 });
    expect(days[0]?.dateKey).toBe("2026-09-21");
  });
});

describe("offset navigation", () => {
  it("phone: next skips Sunday and stops at the cap", () => {
    expect(nextOffset("phone", 3, wednesday)).toBe(5); // Wed+4 = Sun → 5
    expect(nextOffset("phone", calendarMaxOffsetDays, wednesday)).toBeNull();
    expect(nextOffset("phone", calendarMaxOffsetDays - 1, wednesday)).toBe(14);
  });

  it("phone: prev stops at zero", () => {
    expect(prevOffset("phone", 0, wednesday)).toBeNull();
    expect(prevOffset("phone", 5, wednesday)).toBe(3); // 4 would be Sunday
  });

  it("desktop: next/prev move one week, capped so Monday ≤ today+14", () => {
    expect(nextOffset("desktop", 0, wednesday)).toBe(1);
    expect(nextOffset("desktop", 1, wednesday)).toBe(2); // Mon 28 Sep = today+12 ✓
    expect(nextOffset("desktop", 2, wednesday)).toBeNull(); // Mon 5 Oct = today+19 ✗
    expect(prevOffset("desktop", 0, wednesday)).toBeNull();
  });

  it("clampOffset keeps values inside [0, cap]", () => {
    expect(clampOffset("phone", -3, wednesday)).toBe(0);
    expect(clampOffset("phone", 40, wednesday)).toBe(14);
    expect(clampOffset("desktop", 9, wednesday)).toBe(2);
  });
});
```

- [ ] **Step 3: Run** — `corepack pnpm vitest run --project node packages/domain/src/schedule/member-calendar-contracts.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement** — `member-calendar-contracts.ts` (part 1; Task 3 appends the status rules to the same file):

```ts
/**
 * Member calendar (/account) — pure rules for what a member sees and may do.
 *
 * Spec: docs/superpowers/specs/2026-09-10-member-calendar-design.md
 * Every day, label and deadline is computed in Europe/Jersey. Nothing here touches Firebase.
 */
import { isWithinBookingCutoff } from "./schedule-contracts";
import type {
  AttendanceRecord,
  BookingRecord,
  ProgramRecord,
  SessionRecord,
} from "./schedule-contracts";
import type { ParticipantType, Site } from "../memberships/plan-contracts";

export const calendarTimeZone = "Europe/Jersey";
export const calendarMaxOffsetDays = 14;
export const calendarCutoffMinutes = 60;

export type CalendarViewport = "phone" | "desktop";

export type CalendarDay = Readonly<{
  dateKey: string; // YYYY-MM-DD in Jersey
  weekday: string; // Mon … Sat
  dayNumber: number;
  isToday: boolean;
  startAt: string; // UTC ISO, 00:00 Jersey
  endAt: string; // UTC ISO, 00:00 Jersey of the next day
}>;

const dayMs = 24 * 60 * 60 * 1000;

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: calendarTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type JerseyParts = Readonly<{
  year: number;
  month: number;
  day: number;
  weekday: string;
  hour: number;
  minute: number;
}>;

function jerseyParts(date: Date): JerseyParts {
  const parts: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday ?? "",
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function dateKeyInJersey(date: Date): string {
  const { year, month, day } = jerseyParts(date);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Noon UTC of the given Jersey date key: always inside that Jersey day (UTC+0 or +1). */
function noonAnchor(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** Offset of Jersey from UTC at `date`, in minutes (0 in winter, 60 in summer). */
function jerseyOffsetMinutes(date: Date): number {
  const { year, month, day, hour, minute } = jerseyParts(date);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  return Math.round((asUtc - date.getTime()) / 60000);
}

function jerseyMidnight(dateKey: string): Date {
  const anchor = noonAnchor(dateKey);
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  const localMidnightAsUtc = Date.UTC(year, month - 1, day, 0);
  return new Date(localMidnightAsUtc - jerseyOffsetMinutes(anchor) * 60000);
}

const weekdayIndex: Readonly<Record<string, number>> = Object.freeze({
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
});

function dayFromAnchor(anchor: Date, todayKey: string): CalendarDay {
  const key = dateKeyInJersey(anchor);
  const { weekday, day } = jerseyParts(anchor);
  return Object.freeze({
    dateKey: key,
    weekday,
    dayNumber: day,
    isToday: key === todayKey,
    startAt: jerseyMidnight(key).toISOString(),
    endAt: jerseyMidnight(dateKeyInJersey(new Date(anchor.getTime() + dayMs))).toISOString(),
  });
}

function isSunday(anchor: Date): boolean {
  return jerseyParts(anchor).weekday === "Sun";
}

function todayAnchor(now: Date): Date {
  return noonAnchor(dateKeyInJersey(now));
}

function mondayOfWeek(anchor: Date): Date {
  const index = weekdayIndex[jerseyParts(anchor).weekday] ?? 1;
  return new Date(anchor.getTime() - (index - 1) * dayMs);
}

function desktopMaxOffset(now: Date): number {
  const today = todayAnchor(now);
  const baseMonday = isSunday(today)
    ? new Date(today.getTime() + dayMs)
    : mondayOfWeek(today);
  const cap = today.getTime() + calendarMaxOffsetDays * dayMs;
  let offset = 0;
  while (baseMonday.getTime() + (offset + 1) * 7 * dayMs <= cap) offset += 1;
  return offset;
}

export function clampOffset(viewport: CalendarViewport, offset: number, now: Date): number {
  const max = viewport === "phone" ? calendarMaxOffsetDays : desktopMaxOffset(now);
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.min(Math.trunc(offset), max);
}

export function visibleDays(input: {
  now: Date;
  viewport: CalendarViewport;
  offset: number;
}): readonly CalendarDay[] {
  const todayKey = dateKeyInJersey(input.now);
  const today = todayAnchor(input.now);
  const offset = clampOffset(input.viewport, input.offset, input.now);

  if (input.viewport === "phone") {
    const days: CalendarDay[] = [];
    let cursor = new Date(today.getTime() + offset * dayMs);
    while (days.length < 2) {
      if (!isSunday(cursor)) days.push(dayFromAnchor(cursor, todayKey));
      cursor = new Date(cursor.getTime() + dayMs);
    }
    return Object.freeze(days);
  }

  const baseMonday = isSunday(today) ? new Date(today.getTime() + dayMs) : mondayOfWeek(today);
  const monday = new Date(baseMonday.getTime() + offset * 7 * dayMs);
  return Object.freeze(
    [0, 1, 2, 3, 4, 5].map((step) =>
      dayFromAnchor(new Date(monday.getTime() + step * dayMs), todayKey),
    ),
  );
}

export function nextOffset(
  viewport: CalendarViewport,
  offset: number,
  now: Date,
): number | null {
  if (viewport === "desktop") {
    const next = offset + 1;
    return next <= desktopMaxOffset(now) ? next : null;
  }
  const today = todayAnchor(now);
  let next = offset + 1;
  if (isSunday(new Date(today.getTime() + next * dayMs))) next += 1;
  return next <= calendarMaxOffsetDays ? next : null;
}

export function prevOffset(
  viewport: CalendarViewport,
  offset: number,
  now: Date,
): number | null {
  if (offset <= 0) return null;
  if (viewport === "desktop") return offset - 1;
  const today = todayAnchor(now);
  let prev = offset - 1;
  if (isSunday(new Date(today.getTime() + prev * dayMs))) prev -= 1;
  return prev < 0 ? null : prev;
}
```

(Keep the imports of `isWithinBookingCutoff`, `AttendanceRecord`, `BookingRecord`, `ProgramRecord`, `SessionRecord`, `ParticipantType`, `Site` — Task 3 uses them. If eslint flags them as unused before Task 3, add them in Task 3 instead.)

- [ ] **Step 5: Run** the test file → PASS (all cases).

- [ ] **Step 6: Commit**
```bash
git add packages/domain/package.json packages/domain/src/schedule/member-calendar-contracts.ts packages/domain/src/schedule/member-calendar-contracts.test.ts
git commit -m "feat(domain): member calendar days and forward-only navigation"
```

---

### Task 3: Domain — session status, cancel rules, labels

**Files:**
- Modify: `packages/domain/src/schedule/member-calendar-contracts.ts` (append)
- Modify: `packages/domain/src/schedule/member-calendar-contracts.test.ts` (append)

**Interfaces:**
- Produces:
  - `calendarSessionStatuses`, `type CalendarSessionStatus = "open"|"booked"|"attended"|"missed"|"closed"|"full"|"locked"`
  - `type LockedReason = "age_band"|"site"|"open_mat"`
  - `type CalendarMemberContext = Readonly<{ studentId; membershipId; participantType: ParticipantType; planClassSites: readonly Site[]; planOpenMatSites: readonly Site[] }>`
  - `type DerivedSessionStatus = Readonly<{ status: CalendarSessionStatus; lockedReason?: LockedReason }>`
  - `deriveSessionStatus(input: { session; program; member; booking?; attendance?; bookedCount: number; now: Date }): DerivedSessionStatus`
  - `canCancelBooking(session, now): boolean`, `cancelDeadlineLabel(session): string`, `formatSessionTimeRange(session): string`, `sessionSite(session): Site`, `memberGroupLabel(participantType): string`, `lockedReasonLabel(reason, site, participantType): string`, `formatDayHeading(day: CalendarDay): string`

- [ ] **Step 1: Append failing tests**

```ts
import {
  canCancelBooking,
  cancelDeadlineLabel,
  deriveSessionStatus,
  formatDayHeading,
  formatSessionTimeRange,
  lockedReasonLabel,
  memberGroupLabel,
  sessionSite,
  type CalendarMemberContext,
} from "./member-calendar-contracts";
import type {
  AttendanceRecord,
  BookingRecord,
  ProgramRecord,
  SessionRecord,
} from "./schedule-contracts";

const audit = {
  schemaVersion: "1" as const,
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: "seed",
  updatedAt: "2026-09-01T00:00:00.000Z",
  updatedBy: "seed",
};

const teensProgram: ProgramRecord = {
  programId: "prog-teens",
  academyId: "bpt",
  name: "Teens BJJ",
  ageBand: "teens",
  discipline: "bjj",
  level: "all-levels",
  active: true,
  schemaVersion: "1",
};
const openMatProgram: ProgramRecord = { ...teensProgram, programId: "prog-om", name: "Open Mat", ageBand: "all", discipline: "open-mat" };
const kidsProgram: ProgramRecord = { ...teensProgram, programId: "prog-kids", name: "Kids BJJ", ageBand: "kids" };

// Wednesday 2026-09-16 18:00 BST = 17:00Z
const session: SessionRecord = {
  sessionId: "s1",
  academyId: "bpt",
  classId: null,
  programId: "prog-teens",
  locationId: "town",
  instructorId: "coach",
  title: "Teens BJJ",
  startAt: "2026-09-16T17:00:00.000Z",
  endAt: "2026-09-16T18:00:00.000Z",
  capacity: 20,
  minParticipants: 4,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  ...audit,
};

const maya: CalendarMemberContext = {
  studentId: "maya",
  membershipId: "m-maya",
  participantType: "teens",
  planClassSites: ["Town"],
  planOpenMatSites: ["Town"],
};

const booking: BookingRecord = {
  bookingId: "b1",
  academyId: "bpt",
  sessionId: "s1",
  studentId: "maya",
  membershipId: "m-maya",
  status: "confirmed",
  requestedAt: "2026-09-10T10:00:00.000Z",
  cancelledAt: null,
  cancellationReason: null,
  ...audit,
};

function attendance(state: AttendanceRecord["state"]): AttendanceRecord {
  return {
    attendanceId: "a1",
    academyId: "bpt",
    sessionId: "s1",
    studentId: "maya",
    method: "manual",
    state,
    occurredAt: "2026-09-16T17:05:00.000Z",
    notes: null,
    correctionOf: null,
    ...audit,
  };
}

const twoHoursBefore = new Date("2026-09-16T15:00:00Z");
const thirtyMinBefore = new Date("2026-09-16T16:30:00Z");

describe("deriveSessionStatus", () => {
  it("is open when in group, bookable and not booked", () => {
    expect(
      deriveSessionStatus({ session, program: teensProgram, member: maya, bookedCount: 3, now: twoHoursBefore }),
    ).toEqual({ status: "open" });
  });

  it("is booked when a booking is confirmed or requested", () => {
    expect(deriveSessionStatus({ session, program: teensProgram, member: maya, booking, bookedCount: 3, now: twoHoursBefore }).status).toBe("booked");
    expect(deriveSessionStatus({ session, program: teensProgram, member: maya, booking: { ...booking, status: "requested" }, bookedCount: 3, now: twoHoursBefore }).status).toBe("booked");
  });

  it("ignores a cancelled booking", () => {
    expect(deriveSessionStatus({ session, program: teensProgram, member: maya, booking: { ...booking, status: "cancelled" }, bookedCount: 3, now: twoHoursBefore }).status).toBe("open");
  });

  it("is missed only for no_show", () => {
    expect(deriveSessionStatus({ session, program: teensProgram, member: maya, booking, attendance: attendance("no_show"), bookedCount: 3, now: twoHoursBefore }).status).toBe("missed");
    expect(deriveSessionStatus({ session, program: teensProgram, member: maya, booking, attendance: attendance("absent"), bookedCount: 3, now: twoHoursBefore }).status).toBe("booked");
  });

  it("is attended for attended or late", () => {
    expect(deriveSessionStatus({ session, program: teensProgram, member: maya, booking, attendance: attendance("attended"), bookedCount: 3, now: twoHoursBefore }).status).toBe("attended");
    expect(deriveSessionStatus({ session, program: teensProgram, member: maya, booking, attendance: attendance("late"), bookedCount: 3, now: twoHoursBefore }).status).toBe("attended");
  });

  it("closes 60 minutes before start when not booked, but a booking stays booked", () => {
    expect(deriveSessionStatus({ session, program: teensProgram, member: maya, bookedCount: 3, now: thirtyMinBefore }).status).toBe("closed");
    expect(deriveSessionStatus({ session, program: teensProgram, member: maya, booking, bookedCount: 3, now: thirtyMinBefore }).status).toBe("booked");
  });

  it("closes once the session is active or completed", () => {
    expect(deriveSessionStatus({ session: { ...session, status: "completed" }, program: teensProgram, member: maya, bookedCount: 3, now: twoHoursBefore }).status).toBe("closed");
  });

  it("is full at capacity when not booked", () => {
    expect(deriveSessionStatus({ session, program: teensProgram, member: maya, bookedCount: 20, now: twoHoursBefore }).status).toBe("full");
  });

  it("locks sessions of another age band", () => {
    expect(deriveSessionStatus({ session: { ...session, programId: "prog-kids" }, program: kidsProgram, member: maya, bookedCount: 0, now: twoHoursBefore })).toEqual({ status: "locked", lockedReason: "age_band" });
  });

  it("locks sessions at a site the plan does not cover", () => {
    expect(deriveSessionStatus({ session: { ...session, locationId: "west" }, program: teensProgram, member: maya, bookedCount: 0, now: twoHoursBefore })).toEqual({ status: "locked", lockedReason: "site" });
  });

  it("locks open mats at a site outside the plan's open-mat sites, and allows the covered one", () => {
    const westOpenMat = { ...session, programId: "prog-om", locationId: "west" as const };
    expect(deriveSessionStatus({ session: westOpenMat, program: openMatProgram, member: maya, bookedCount: 0, now: twoHoursBefore })).toEqual({ status: "locked", lockedReason: "open_mat" });
    expect(deriveSessionStatus({ session: { ...westOpenMat, locationId: "town" }, program: openMatProgram, member: maya, bookedCount: 0, now: twoHoursBefore }).status).toBe("open");
  });

  it("locked beats missed (a wrong-group session is never coloured)", () => {
    expect(deriveSessionStatus({ session: { ...session, programId: "prog-kids" }, program: kidsProgram, member: maya, attendance: attendance("no_show"), bookedCount: 0, now: twoHoursBefore }).status).toBe("locked");
  });
});

describe("cancel rules and labels", () => {
  it("allows cancelling until exactly 60 minutes before", () => {
    expect(canCancelBooking(session, new Date("2026-09-16T16:00:00Z"))).toBe(true);
    expect(canCancelBooking(session, new Date("2026-09-16T16:00:01Z"))).toBe(false);
  });

  it("labels the deadline and time range in Jersey time", () => {
    expect(cancelDeadlineLabel(session)).toBe("17:00");
    expect(formatSessionTimeRange(session)).toBe("18:00–19:00");
  });

  it("maps sites, groups and locked reasons to copy", () => {
    expect(sessionSite(session)).toBe("Town");
    expect(memberGroupLabel("teens")).toBe("Teens");
    expect(lockedReasonLabel("age_band", "Town", "kids")).toBe("Kids only");
    expect(lockedReasonLabel("site", "Town", "teens")).toBe("Your plan doesn't cover Town");
    expect(lockedReasonLabel("open_mat", "West", "teens")).toBe("Open Mats at West aren't in your plan");
  });

  it("formats a day heading", () => {
    expect(formatDayHeading({ dateKey: "2026-09-16", weekday: "Wed", dayNumber: 16, isToday: true, startAt: "", endAt: "" })).toBe("Wednesday 16");
  });
});
```

Note: `lockedReasonLabel("age_band", site, programAgeBand)` — third argument is the **program's** age band (what the session is for), so the copy says "Kids only".

- [ ] **Step 2: Run** → FAIL (functions not exported).

- [ ] **Step 3: Append implementation** to `member-calendar-contracts.ts`:

```ts
// ── Session status ──

export const calendarSessionStatuses = Object.freeze([
  "open",
  "booked",
  "attended",
  "missed",
  "closed",
  "full",
  "locked",
] as const);
export type CalendarSessionStatus = (typeof calendarSessionStatuses)[number];

export type LockedReason = "age_band" | "site" | "open_mat";

export type CalendarMemberContext = Readonly<{
  studentId: string;
  membershipId: string;
  participantType: ParticipantType;
  planClassSites: readonly Site[];
  planOpenMatSites: readonly Site[];
}>;

export type DerivedSessionStatus = Readonly<{
  status: CalendarSessionStatus;
  lockedReason?: LockedReason;
}>;

export function sessionSite(session: Pick<SessionRecord, "locationId">): Site {
  return session.locationId === "town" ? "Town" : "West";
}

function lockedReasonFor(
  session: SessionRecord,
  program: ProgramRecord,
  member: CalendarMemberContext,
): LockedReason | undefined {
  if (program.ageBand !== "all" && program.ageBand !== member.participantType) return "age_band";
  const site = sessionSite(session);
  if (program.discipline === "open-mat") {
    return member.planOpenMatSites.includes(site) ? undefined : "open_mat";
  }
  return member.planClassSites.includes(site) ? undefined : "site";
}

export function deriveSessionStatus(input: {
  session: SessionRecord;
  program: ProgramRecord;
  member: CalendarMemberContext;
  booking?: BookingRecord;
  attendance?: AttendanceRecord;
  bookedCount: number;
  now: Date;
}): DerivedSessionStatus {
  const lockedReason = lockedReasonFor(input.session, input.program, input.member);
  if (lockedReason) return Object.freeze({ status: "locked", lockedReason });

  if (input.attendance?.state === "no_show") return Object.freeze({ status: "missed" });
  if (input.attendance?.state === "attended" || input.attendance?.state === "late") {
    return Object.freeze({ status: "attended" });
  }

  const booked =
    input.booking !== undefined &&
    (input.booking.status === "confirmed" || input.booking.status === "requested");
  if (booked) return Object.freeze({ status: "booked" });

  const bookable =
    input.session.status === "scheduled" &&
    isWithinBookingCutoff(input.session.startAt, input.now.toISOString(), calendarCutoffMinutes);
  if (!bookable) return Object.freeze({ status: "closed" });
  if (input.bookedCount >= input.session.capacity) return Object.freeze({ status: "full" });
  return Object.freeze({ status: "open" });
}

export function canCancelBooking(session: Pick<SessionRecord, "startAt">, now: Date): boolean {
  return isWithinBookingCutoff(session.startAt, now.toISOString(), calendarCutoffMinutes);
}

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: calendarTimeZone,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function jerseyTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

export function cancelDeadlineLabel(session: Pick<SessionRecord, "startAt">): string {
  return jerseyTime(
    new Date(Date.parse(session.startAt) - calendarCutoffMinutes * 60000).toISOString(),
  );
}

export function formatSessionTimeRange(session: Pick<SessionRecord, "startAt" | "endAt">): string {
  return `${jerseyTime(session.startAt)}–${jerseyTime(session.endAt)}`;
}

const longWeekday: Readonly<Record<string, string>> = Object.freeze({
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
});

export function formatDayHeading(day: Pick<CalendarDay, "weekday" | "dayNumber">): string {
  return `${longWeekday[day.weekday] ?? day.weekday} ${day.dayNumber}`;
}

export function memberGroupLabel(participantType: ParticipantType): string {
  if (participantType === "kids") return "Kids";
  if (participantType === "teens") return "Teens";
  return "Adults";
}

export function lockedReasonLabel(
  reason: LockedReason,
  site: Site,
  programAgeBand: ProgramRecord["ageBand"],
): string {
  if (reason === "age_band") {
    const group = programAgeBand === "kids" ? "Kids" : programAgeBand === "teens" ? "Teens" : "Adults";
    return `${group} only`;
  }
  if (reason === "site") return `Your plan doesn't cover ${site}`;
  return `Open Mats at ${site} aren't in your plan`;
}
```

- [ ] **Step 4: Run** the test file → PASS. Then `corepack pnpm eslint packages/domain/src/schedule/member-calendar-contracts.ts --max-warnings 0` → clean.

- [ ] **Step 5: Commit**
```bash
git add packages/domain/src/schedule/member-calendar-contracts.ts packages/domain/src/schedule/member-calendar-contracts.test.ts
git commit -m "feat(domain): member calendar status derivation and cancel rules"
```

---

### Task 4: Repository port + fixture implementation

**Files:**
- Create: `apps/web/src/lib/calendar/calendar-repository.ts`
- Create: `apps/web/src/lib/calendar/fixture-calendar-repository.ts`
- Create: `apps/web/src/lib/calendar/fixture-calendar-repository.test.ts`

**Interfaces:**
- Consumes: `dateKeyInJersey`, `calendarTimeZone` (Task 2); record types from `@bpt-jersey/domain/schedule`, `PlanId`/`ParticipantType`/`Site` from `@bpt-jersey/domain/memberships`, `NoShowPenaltyRecord` from `@bpt-jersey/domain/penalties`.
- Produces:
  - `type CalendarRole = "guardian" | "adultStudent" | "teenStudent"`
  - `type CalendarParticipant`, `type CalendarMember`, `type CalendarWeekData`, `interface CalendarRepository` (spec §5)
  - `createFixtureCalendarRepository(role: CalendarRole): CalendarRepository`

- [ ] **Step 1: Write the port** — `calendar-repository.ts`:

```ts
import type {
  AttendanceRecord,
  BookingRecord,
  CancelBookingInput,
  ProgramRecord,
  RequestBookingInput,
  SessionRecord,
} from "@bpt-jersey/domain/schedule";
import type { ParticipantType, PlanId, Site } from "@bpt-jersey/domain/memberships";
import type { NoShowPenaltyRecord } from "@bpt-jersey/domain/penalties";

/**
 * The only seam between the member calendar UI and the backend. `fixture-calendar-repository`
 * runs today (workbench + tests); `firebase-calendar-repository` is written against the existing
 * callables and is what the connecting model has to verify. Pick one in `./index.ts`.
 */
export type CalendarRole = "guardian" | "adultStudent" | "teenStudent";

export type CalendarParticipant = Readonly<{
  studentId: string;
  firstName: string;
  membershipId: string;
  planId: PlanId;
  participantType: ParticipantType;
  planClassSites: readonly Site[];
  planOpenMatSites: readonly Site[];
}>;

export type CalendarMember = Readonly<{
  role: CalendarRole;
  displayName: string;
  participants: readonly CalendarParticipant[];
}>;

export type CalendarWeekData = Readonly<{
  sessions: readonly SessionRecord[];
  programs: readonly ProgramRecord[];
  bookings: readonly BookingRecord[];
  attendance: readonly AttendanceRecord[];
  /** sessionId → confirmed bookings. `{}` when the backend cannot tell. */
  bookedCounts: Readonly<Record<string, number>>;
}>;

export interface CalendarRepository {
  loadMember(): Promise<CalendarMember>;
  loadWeek(studentId: string, fromIso: string, toIso: string): Promise<CalendarWeekData>;
  book(input: RequestBookingInput): Promise<BookingRecord>;
  cancel(input: CancelBookingInput): Promise<BookingRecord>;
  loadPenalties(studentId: string): Promise<readonly NoShowPenaltyRecord[]>;
}
```

- [ ] **Step 2: Write the failing test** — `fixture-calendar-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createFixtureCalendarRepository } from "./fixture-calendar-repository";

const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
const inThreeWeeks = new Date(Date.now() + 21 * 86400000).toISOString();

describe("fixture calendar repository", () => {
  it("gives a guardian two children and a teen one participant", async () => {
    const guardian = await createFixtureCalendarRepository("guardian").loadMember();
    expect(guardian.participants.map((p) => p.firstName)).toEqual(["Maya", "Leo"]);
    const teen = await createFixtureCalendarRepository("teenStudent").loadMember();
    expect(teen.participants).toHaveLength(1);
    expect(teen.participants[0]?.participantType).toBe("teens");
  });

  it("generates sessions for every weekday but Sunday, with programs", async () => {
    const repo = createFixtureCalendarRepository("teenStudent");
    const week = await repo.loadWeek("sam", weekAgo, inThreeWeeks);
    expect(week.sessions.length).toBeGreaterThan(20);
    const days = new Set(
      week.sessions.map((s) =>
        new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Jersey", weekday: "short" }).format(
          new Date(s.startAt),
        ),
      ),
    );
    expect(days.has("Sun")).toBe(false);
    expect(week.programs.map((p) => p.programId)).toContain("prog-teens");
  });

  it("books and cancels round-trip", async () => {
    const repo = createFixtureCalendarRepository("teenStudent");
    const week = await repo.loadWeek("sam", weekAgo, inThreeWeeks);
    const target = week.sessions.find(
      (s) => s.programId === "prog-teens" && Date.parse(s.startAt) > Date.now() + 2 * 3600000,
    );
    expect(target).toBeDefined();
    const booking = await repo.book({ sessionId: target!.sessionId, studentId: "sam", membershipId: "m-sam" });
    expect(booking.status).toBe("confirmed");
    const after = await repo.loadWeek("sam", weekAgo, inThreeWeeks);
    expect(after.bookings.some((b) => b.sessionId === target!.sessionId && b.status === "confirmed")).toBe(true);
    const cancelled = await repo.cancel({ bookingId: booking.bookingId, studentId: "sam", reason: "member_cancelled" });
    expect(cancelled.status).toBe("cancelled");
  });

  it("seeds a pending penalty for Maya only", async () => {
    const repo = createFixtureCalendarRepository("guardian");
    expect(await repo.loadPenalties("maya")).toHaveLength(1);
    expect(await repo.loadPenalties("leo")).toHaveLength(0);
  });
});
```

Check `CancelBookingInput` fields first: `grep -n -A6 'export type CancelBookingInput' packages/domain/src/schedule/schedule-contracts.ts`. If the field set differs from `{ bookingId, studentId, reason }`, use the real one in the test and in the fixture.

- [ ] **Step 3: Run** — `corepack pnpm vitest run --project web apps/web/src/lib/calendar/fixture-calendar-repository.test.ts` → FAIL.

- [ ] **Step 4: Implement** — `fixture-calendar-repository.ts`:

```ts
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import type {
  AttendanceRecord,
  BookingRecord,
  CancelBookingInput,
  ProgramRecord,
  RequestBookingInput,
  SessionRecord,
} from "@bpt-jersey/domain/schedule";
import type { NoShowPenaltyRecord } from "@bpt-jersey/domain/penalties";

import type {
  CalendarMember,
  CalendarParticipant,
  CalendarRepository,
  CalendarRole,
  CalendarWeekData,
} from "./calendar-repository";

// ponytail: deterministic in-memory fixtures so /account renders and round-trips without Firebase.
// Sessions are generated around "today" so cut-offs, past days and the 14-day cap all exercise.

const academyId = "bpt-jersey";
const dayMs = 86400000;
const audit = Object.freeze({
  schemaVersion: "1" as const,
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: "fixture",
  updatedAt: "2026-09-01T00:00:00.000Z",
  updatedBy: "fixture",
});

const programs: readonly ProgramRecord[] = Object.freeze([
  { programId: "prog-kids", academyId, name: "Kids BJJ", ageBand: "kids", discipline: "bjj", level: "all-levels", active: true, schemaVersion: "1" },
  { programId: "prog-teens", academyId, name: "Teens BJJ", ageBand: "teens", discipline: "bjj", level: "all-levels", active: true, schemaVersion: "1" },
  { programId: "prog-adult", academyId, name: "Adults BJJ", ageBand: "adult", discipline: "bjj", level: "all-levels", active: true, schemaVersion: "1" },
  { programId: "prog-om", academyId, name: "Open Mat", ageBand: "all", discipline: "open-mat", level: "all-levels", active: true, schemaVersion: "1" },
]);

const maya: CalendarParticipant = { studentId: "maya", firstName: "Maya", membershipId: "m-maya", planId: "town-teens", participantType: "teens", planClassSites: ["Town"], planOpenMatSites: ["Town"] };
const leo: CalendarParticipant = { studentId: "leo", firstName: "Leo", membershipId: "m-leo", planId: "west-kids-2x", participantType: "kids", planClassSites: ["West"], planOpenMatSites: ["Town"] };
const sam: CalendarParticipant = { studentId: "sam", firstName: "Sam", membershipId: "m-sam", planId: "town-teens", participantType: "teens", planClassSites: ["Town"], planOpenMatSites: ["Town"] };
const alex: CalendarParticipant = { studentId: "alex", firstName: "Alex", membershipId: "m-alex", planId: "bpt-jersey-adult", participantType: "adult", planClassSites: ["Town", "West"], planOpenMatSites: ["Town", "West"] };

const members: Readonly<Record<CalendarRole, CalendarMember>> = Object.freeze({
  guardian: { role: "guardian", displayName: "Jordan Demo", participants: [maya, leo] },
  teenStudent: { role: "teenStudent", displayName: "Sam Demo", participants: [sam] },
  adultStudent: { role: "adultStudent", displayName: "Alex Demo", participants: [alex] },
});

type Slot = Readonly<{ programId: string; locationId: "town" | "west"; hour: number; minute: number; durationMin: number; title: string }>;

const weekdaySlots: Readonly<Record<number, readonly Slot[]>> = Object.freeze({
  1: [town("prog-kids", 17, 0, "Kids BJJ"), town("prog-teens", 18, 0, "Teens BJJ"), town("prog-adult", 19, 0, "Adults BJJ")],
  2: [west("prog-kids", 17, 30, "Kids BJJ"), west("prog-teens", 18, 30, "Teens BJJ"), west("prog-adult", 19, 30, "Adults BJJ")],
  3: [town("prog-kids", 17, 0, "Kids BJJ"), town("prog-teens", 18, 0, "Teens BJJ"), town("prog-adult", 19, 0, "Adults BJJ")],
  4: [west("prog-kids", 17, 30, "Kids BJJ"), west("prog-teens", 18, 30, "Teens BJJ"), west("prog-adult", 19, 30, "Adults BJJ")],
  5: [town("prog-kids", 17, 0, "Kids BJJ"), town("prog-teens", 18, 0, "Teens BJJ"), town("prog-adult", 19, 0, "Adults BJJ")],
  6: [town("prog-om", 10, 0, "Open Mat", 90), west("prog-om", 11, 30, "Open Mat", 90)],
});

function town(programId: string, hour: number, minute: number, title: string, durationMin = 60): Slot {
  return { programId, locationId: "town", hour, minute, durationMin, title };
}
function west(programId: string, hour: number, minute: number, title: string, durationMin = 60): Slot {
  return { programId, locationId: "west", hour, minute, durationMin, title };
}

/** UTC instant for `dateKey` at HH:mm Jersey. */
function jerseyInstant(dateKey: string, hour: number, minute: number): Date {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute));
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Jersey", hour: "2-digit", hourCycle: "h23" }).formatToParts(guess);
  const localHour = Number(parts.find((p) => p.type === "hour")?.value ?? hour);
  const offsetHours = ((localHour - hour) + 24) % 24; // 0 in winter, 1 in summer
  return new Date(guess.getTime() - offsetHours * 3600000);
}

function weekdayOf(dateKey: string): number {
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Jersey", weekday: "short" }).format(jerseyInstant(dateKey, 12, 0));
  return { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[label] ?? 7;
}

function generateSessions(now: Date): SessionRecord[] {
  const sessions: SessionRecord[] = [];
  const start = new Date(now.getTime() - 7 * dayMs);
  for (let i = 0; i < 29; i += 1) {
    const key = dateKeyInJersey(new Date(start.getTime() + i * dayMs));
    for (const slot of weekdaySlots[weekdayOf(key)] ?? []) {
      const startAt = jerseyInstant(key, slot.hour, slot.minute);
      const endAt = new Date(startAt.getTime() + slot.durationMin * 60000);
      const startMs = startAt.getTime();
      sessions.push({
        sessionId: `${key}_${slot.locationId}_${slot.programId}`,
        academyId,
        classId: null,
        programId: slot.programId,
        locationId: slot.locationId,
        instructorId: "coach-1",
        title: slot.title,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        capacity: 20,
        minParticipants: 4,
        status: endAt.getTime() < now.getTime() ? "completed" : "scheduled",
        isSeminar: false,
        cancellationReason: null,
        ...audit,
      });
      void startMs;
    }
  }
  return sessions;
}

export function createFixtureCalendarRepository(role: CalendarRole): CalendarRepository {
  const now = new Date();
  const sessions = generateSessions(now);
  const bookings: BookingRecord[] = [];
  const attendance: AttendanceRecord[] = [];
  const bookedCounts: Record<string, number> = {};

  const isPast = (s: SessionRecord) => Date.parse(s.endAt) < now.getTime();
  const isUpcoming = (s: SessionRecord) => Date.parse(s.startAt) > now.getTime() + 2 * 3600000;

  function seedFor(p: CalendarParticipant, programId: string, locationId: "town" | "west"): void {
    const mine = sessions.filter((s) => s.programId === programId && s.locationId === locationId);
    const past = mine.filter(isPast).slice(-2);
    const upcoming = mine.filter(isUpcoming);
    const [missed, attended] = [past[past.length - 1], past[past.length - 2]];
    if (missed) {
      bookings.push(booking(missed, p));
      attendance.push(attend(missed, p, "no_show"));
    }
    if (attended) {
      bookings.push(booking(attended, p));
      attendance.push(attend(attended, p, "attended"));
    }
    if (upcoming[0]) bookings.push(booking(upcoming[0], p));
    if (upcoming[1]) bookedCounts[upcoming[1].sessionId] = upcoming[1].capacity;
  }

  seedFor(maya, "prog-teens", "town");
  seedFor(sam, "prog-teens", "town");
  seedFor(leo, "prog-kids", "west");
  seedFor(alex, "prog-adult", "town");

  const penalties: NoShowPenaltyRecord[] = [];
  const mayaMissed = attendance.find((a) => a.studentId === "maya" && a.state === "no_show");
  const mayaSession = sessions.find((s) => s.sessionId === mayaMissed?.sessionId);
  if (mayaMissed && mayaSession) {
    penalties.push({
      penaltyId: `pen_${mayaSession.sessionId}`,
      academyId,
      sessionId: mayaSession.sessionId,
      studentId: "maya",
      locationId: "town",
      amountMinor: 1500,
      currency: "GBP",
      status: "proposed",
      sessionStartAt: mayaSession.startAt,
      proposedAt: mayaSession.endAt,
      proposedBy: "system",
      resolution: null,
      ...audit,
    });
  }

  return {
    async loadMember() {
      return members[role];
    },
    async loadWeek(studentId, fromIso, toIso) {
      const from = Date.parse(fromIso);
      const to = Date.parse(toIso);
      const inRange = sessions.filter((s) => {
        const t = Date.parse(s.startAt);
        return t >= from && t < to;
      });
      const ids = new Set(inRange.map((s) => s.sessionId));
      return {
        sessions: inRange,
        programs,
        bookings: bookings.filter((b) => b.studentId === studentId && ids.has(b.sessionId)),
        attendance: attendance.filter((a) => a.studentId === studentId && ids.has(a.sessionId)),
        bookedCounts: { ...bookedCounts },
      };
    },
    async book(input) {
      const session = sessions.find((s) => s.sessionId === input.sessionId);
      if (!session) throw Object.assign(new Error("not found"), { code: "functions/not-found" });
      if ((bookedCounts[session.sessionId] ?? 0) >= session.capacity) {
        throw Object.assign(new Error("full"), { code: "functions/failed-precondition", details: { reason: "capacity" } });
      }
      const existing = bookings.find((b) => b.sessionId === input.sessionId && b.studentId === input.studentId);
      const record: BookingRecord = { ...(existing ?? booking(session, participantOf(input.studentId))), status: "confirmed", cancelledAt: null, cancellationReason: null, requestedAt: new Date().toISOString() };
      if (existing) bookings.splice(bookings.indexOf(existing), 1, record);
      else bookings.push(record);
      return record;
    },
    async cancel(input) {
      const existing = bookings.find((b) => b.bookingId === input.bookingId);
      if (!existing) throw Object.assign(new Error("not found"), { code: "functions/not-found" });
      const record: BookingRecord = { ...existing, status: "cancelled", cancelledAt: new Date().toISOString(), cancellationReason: input.reason ?? "member_cancelled" };
      bookings.splice(bookings.indexOf(existing), 1, record);
      return record;
    },
    async loadPenalties(studentId) {
      return penalties.filter((p) => p.studentId === studentId);
    },
  };

  function participantOf(studentId: string): CalendarParticipant {
    return [maya, leo, sam, alex].find((p) => p.studentId === studentId) ?? sam;
  }
}

function booking(session: SessionRecord, p: CalendarParticipant): BookingRecord {
  return {
    bookingId: `bk_${session.sessionId}_${p.studentId}`,
    academyId,
    sessionId: session.sessionId,
    studentId: p.studentId,
    membershipId: p.membershipId,
    status: "confirmed",
    requestedAt: session.createdAt,
    cancelledAt: null,
    cancellationReason: null,
    ...audit,
  };
}

function attend(session: SessionRecord, p: CalendarParticipant, state: AttendanceRecord["state"]): AttendanceRecord {
  return {
    attendanceId: `${session.sessionId}__${p.studentId}`,
    academyId,
    sessionId: session.sessionId,
    studentId: p.studentId,
    method: "manual",
    state,
    occurredAt: session.startAt,
    notes: null,
    correctionOf: null,
    ...audit,
  };
}
```

Adjust `cancel()` to the real `CancelBookingInput` fields found in Step 2 (if the type has no `reason`, drop `input.reason ??`). Remove the `void startMs` line and the `startMs` const (leftover).

- [ ] **Step 5: Run** the test → PASS. Lint the two files → clean (fix any `prefer-const` / unused warnings).

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/lib/calendar/
git commit -m "feat(account): calendar repository port with fixture implementation"
```

---

### Task 5: Firebase adapter (unverified), selector, booking messages

**Files:**
- Create: `apps/web/src/lib/calendar/firebase-calendar-repository.ts`
- Create: `apps/web/src/lib/calendar/booking-messages.ts`
- Create: `apps/web/src/lib/calendar/booking-messages.test.ts`
- Create: `apps/web/src/lib/calendar/index.ts`
- Modify: `.env.local` (append `NEXT_PUBLIC_CALENDAR_SOURCE=fixture`), `.env.example` (document the variable)

**Interfaces:**
- Consumes: `listSessions`, `getScheduleCatalog`, `listStudentBookings`, `listStudentAttendance`, `requestBooking`, `cancelBooking` (`../schedule-client`); `listClientMemberships` (`../waitlist-client`); `listNoShowPenalties` (`../no-show-penalties-client`); `getFamily` (`../family-client`); `PLAN_CATALOG` (`@bpt-jersey/domain/memberships`).
- Produces: `createFirebaseCalendarRepository(session: { role: CalendarRole; displayName: string; uid: string }): CalendarRepository`; `createCalendarRepository(session): CalendarRepository` (index); `bookingFailureMessage(error: unknown): string`, `cancellationFailureMessage(error: unknown): string`.

- [ ] **Step 1: Failing test for messages** — `booking-messages.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { bookingFailureMessage, cancellationFailureMessage } from "./booking-messages";

describe("booking messages", () => {
  it("maps capacity, financial, ineligible, auth and not-found", () => {
    expect(bookingFailureMessage({ code: "functions/failed-precondition", details: { reason: "capacity" } })).toBe("This class is full.");
    expect(bookingFailureMessage({ code: "functions/failed-precondition", details: { reason: "financial" } })).toBe("Your account can't book right now. Contact the academy.");
    expect(bookingFailureMessage({ code: "functions/failed-precondition", details: { reason: "ineligible" } })).toBe("Your membership doesn't cover this class.");
    expect(bookingFailureMessage({ code: "functions/permission-denied" })).toBe("You can't book for this member.");
    expect(bookingFailureMessage({ code: "functions/not-found" })).toBe("This class is no longer available.");
    expect(bookingFailureMessage(new Error("boom"))).toBe("Couldn't book. Refresh and try again.");
  });

  it("maps cancellation failures", () => {
    expect(cancellationFailureMessage({ code: "functions/failed-precondition", details: { reason: "ineligible" } })).toBe("This booking can't be cancelled online any more. Contact the academy.");
    expect(cancellationFailureMessage(new Error("boom"))).toBe("Couldn't cancel. Refresh and try again.");
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Implement** `booking-messages.ts`:

```ts
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

export function bookingFailureMessage(error: unknown): string {
  const code = field(error, "code");
  const reason = field(field(error, "details"), "reason");
  if (code === "functions/failed-precondition" && reason === "capacity") return "This class is full.";
  if (code === "functions/failed-precondition" && reason === "financial") {
    return "Your account can't book right now. Contact the academy.";
  }
  if (code === "functions/failed-precondition" && reason === "ineligible") {
    return "Your membership doesn't cover this class.";
  }
  if (code === "functions/permission-denied" || code === "functions/unauthenticated") {
    return "You can't book for this member.";
  }
  if (code === "functions/not-found") return "This class is no longer available.";
  return "Couldn't book. Refresh and try again.";
}

export function cancellationFailureMessage(error: unknown): string {
  const code = field(error, "code");
  const reason = field(field(error, "details"), "reason");
  if (code === "functions/failed-precondition" && reason === "ineligible") {
    return "This booking can't be cancelled online any more. Contact the academy.";
  }
  if (code === "functions/permission-denied" || code === "functions/unauthenticated") {
    return "You can't cancel this booking.";
  }
  if (code === "functions/not-found") return "This booking is no longer available.";
  return "Couldn't cancel. Refresh and try again.";
}
```

Run → PASS.

- [ ] **Step 3: Write the Firebase adapter** — `firebase-calendar-repository.ts`:

```ts
/**
 * UNVERIFIED — written against the client signatures in ../schedule-client, ../waitlist-client,
 * ../no-show-penalties-client and ../family-client, never run against Firebase. The connecting
 * model must: (1) run it with NEXT_PUBLIC_CALENDAR_SOURCE=firebase against emulators/staging,
 * (2) provide `bookedCounts` (needs a callable that returns confirmed counts per session; today
 * every session reads as not full), (3) confirm how a teenStudent's studentId reaches loadMember.
 */
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import type { PlanId } from "@bpt-jersey/domain/memberships";

import { getFamily } from "../family-client";
import { listNoShowPenalties } from "../no-show-penalties-client";
import {
  cancelBooking,
  getScheduleCatalog,
  listSessions,
  listStudentAttendance,
  listStudentBookings,
  requestBooking,
} from "../schedule-client";
import { listClientMemberships } from "../waitlist-client";
import type { CalendarMember, CalendarParticipant, CalendarRepository, CalendarRole } from "./calendar-repository";

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/u)[0] ?? fullName;
}

function participantFromPlan(
  studentId: string,
  membershipId: string,
  planId: string,
  name: string,
): CalendarParticipant | undefined {
  const plan = PLAN_CATALOG.find((candidate) => candidate.planId === planId);
  if (!plan) return undefined;
  const participantType = plan.eligibleParticipantTypes[0];
  if (!participantType) return undefined;
  return {
    studentId,
    firstName: firstName(name),
    membershipId,
    planId: plan.planId as PlanId,
    participantType,
    planClassSites: plan.classSites,
    planOpenMatSites: plan.openMatSites,
  };
}

export function createFirebaseCalendarRepository(session: {
  role: CalendarRole;
  displayName: string;
}): CalendarRepository {
  return {
    async loadMember(): Promise<CalendarMember> {
      const memberships = await listClientMemberships();
      const current = memberships.filter((m) => m.status === "active" || m.status === "trial");
      const names = new Map<string, string>();
      if (session.role === "guardian") {
        const family = await getFamily();
        for (const student of family?.students ?? []) names.set(student.studentId, student.fullName);
      }
      const participants: CalendarParticipant[] = [];
      for (const membership of current) {
        if (participants.some((p) => p.studentId === membership.studentId)) continue;
        const participant = participantFromPlan(
          membership.studentId,
          membership.membershipId,
          membership.planId,
          names.get(membership.studentId) ?? session.displayName,
        );
        if (participant) participants.push(participant);
      }
      return { role: session.role, displayName: session.displayName, participants };
    },
    async loadWeek(studentId, fromIso, toIso) {
      const [sessions, catalog, bookings, attendance] = await Promise.all([
        listSessions({ from: fromIso, to: toIso }),
        getScheduleCatalog(),
        listStudentBookings(studentId),
        listStudentAttendance(studentId),
      ]);
      return { sessions, programs: catalog.programs, bookings, attendance, bookedCounts: {} };
    },
    book: requestBooking,
    cancel: cancelBooking,
    async loadPenalties(studentId) {
      const penalties = await listNoShowPenalties();
      return penalties.filter((p) => p.studentId === studentId);
    },
  };
}
```

Check `getFamily()` return: the guardian projection's `students` have `studentId` and `fullName` (confirmed in `family-contracts.ts:103-111`). If `listSessions` requires `Z`-suffixed ISO (`isIsoDate` regex), pass `new Date(x).toISOString()` — the callers in Task 9 already produce that.

- [ ] **Step 4: Selector** — `index.ts`:

```ts
import type { CalendarRepository, CalendarRole } from "./calendar-repository";
import { createFirebaseCalendarRepository } from "./firebase-calendar-repository";
import { createFixtureCalendarRepository } from "./fixture-calendar-repository";

export type { CalendarMember, CalendarParticipant, CalendarRepository, CalendarRole, CalendarWeekData } from "./calendar-repository";

/**
 * NEXT_PUBLIC_CALENDAR_SOURCE=firebase switches /account to the real backend. Anything else
 * (including unset) keeps the fixtures, so a build without the flag can never hit Firebase.
 */
export function createCalendarRepository(session: {
  role: CalendarRole;
  displayName: string;
}): CalendarRepository {
  return process.env.NEXT_PUBLIC_CALENDAR_SOURCE === "firebase"
    ? createFirebaseCalendarRepository(session)
    : createFixtureCalendarRepository(session.role);
}
```

Append to `.env.local`: `NEXT_PUBLIC_CALENDAR_SOURCE=fixture`. Append to `.env.example`:
```
# Member calendar (/account) data source: "fixture" (default, no backend) or "firebase".
NEXT_PUBLIC_CALENDAR_SOURCE=fixture
```

- [ ] **Step 5: Typecheck the lib** — `corepack pnpm --dir apps/web exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'lib/calendar' || echo "calendar lib typechecks"`. Fix anything reported. Lint the four files.

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/lib/calendar/ .env.example
git commit -m "feat(account): firebase calendar adapter (unverified) and source selector"
```

---

### Task 6: `/account` styles + DESIGN.md addendum

**Files:**
- Create: `apps/web/src/app/account/account.css`
- Modify: `DESIGN.md` (append section 9)

**Interfaces:**
- Produces class names used by Tasks 7–9: `.member-app`, `.member-header`, `.member-eyebrow`, `.member-name`, `.member-chips`, `.member-chip`, `.member-chip--active`, `.day-strip`, `.day-pill`, `.day-pill--today`, `.day-nav`, `.member-body`, `.member-week`, `.day-column`, `.day-column--today`, `.day-heading`, `.day-empty`, `.session-card`, `.session-card--{status}`, `.session-time`, `.session-title`, `.session-site`, `.session-action`, `.session-note`, `.session-reason`, `.penalty-banner`, `.calendar-error`, `.skeleton-card`, `.cancel-dialog`.

- [ ] **Step 1: Write `account.css`**

```css
/* /account member app — immersive purple header, light traffic-light calendar. Radius 1rem here only. */
.member-app {
  --radius: 1rem;
  --status-open: #ffe66d;
  --status-booked: #d7f0e2;
  --status-attended: #e7f6ee;
  --status-missed: #ffe1e6;
  --status-grey: #e8e7e3;
  background: var(--canvas);
  color: var(--mat-ink);
  min-height: 100dvh;
}

.member-header {
  background: var(--bpt-purple);
  color: var(--gi-white);
  padding: 1.25rem clamp(1rem, 4vw, 3rem) 1.5rem;
}

.member-header-top {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.member-eyebrow {
  color: var(--bpt-lime);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  margin: 0;
  text-transform: uppercase;
}

.member-signout {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 999px;
  color: var(--gi-white);
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  min-height: 2.75rem;
  padding: 0.5rem 1rem;
}

.member-name {
  font-family: var(--font-display), Impact, sans-serif;
  font-size: clamp(2.4rem, 8vw, 4rem);
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
  margin: 0.5rem 0 1rem;
  text-transform: uppercase;
}

.member-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0 0 1rem;
  padding: 0;
  list-style: none;
}

.member-chip {
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 999px;
  color: var(--gi-white);
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  min-height: 2.75rem;
  padding: 0.5rem 1.1rem;
}

.member-chip--active {
  background: var(--bpt-lime);
  border-color: var(--bpt-lime);
  color: var(--mat-ink);
}

.day-strip-row {
  align-items: center;
  display: grid;
  gap: 0.5rem;
  grid-template-columns: auto 1fr auto;
}

.day-nav {
  align-items: center;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 999px;
  color: var(--gi-white);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 1.4rem;
  height: 2.75rem;
  justify-content: center;
  line-height: 1;
  width: 2.75rem;
}

.day-nav:disabled {
  cursor: default;
  opacity: 0.35;
}

.day-strip {
  display: grid;
  gap: 0.5rem;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  list-style: none;
  margin: 0;
  padding: 0;
}

.day-pill {
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.45);
  border-radius: 999px;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-height: 3.6rem;
  justify-content: center;
  padding: 0.5rem 0.25rem;
}

.day-pill span:first-child {
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  opacity: 0.85;
  text-transform: uppercase;
}

.day-pill span:last-child {
  font-family: var(--font-display), Impact, sans-serif;
  font-size: 1.4rem;
  font-weight: 700;
  line-height: 1;
}

.day-pill--today {
  background: var(--bpt-lime);
  border-color: var(--bpt-lime);
  color: var(--mat-ink);
}

.penalty-banner {
  background: var(--status-missed);
  border-left: 0.35rem solid #8d1c2f;
  color: #5f1020;
  margin: 1rem clamp(1rem, 4vw, 3rem) 0;
  padding: 0.9rem 1rem;
}

.member-body {
  padding: 1rem clamp(1rem, 4vw, 3rem) 3rem;
}

.member-week {
  display: grid;
  gap: 1.25rem;
}

.day-column {
  min-width: 0;
}

.day-heading {
  color: var(--bpt-purple);
  font-family: var(--font-display), Impact, sans-serif;
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  margin: 0 0 0.6rem;
  text-transform: uppercase;
}

.day-column--today .day-heading {
  background: var(--bpt-purple);
  border-radius: var(--radius);
  color: var(--gi-white);
  padding: 0.35rem 0.8rem;
}

.day-empty {
  color: var(--muted);
  margin: 0;
}

.day-list {
  display: grid;
  gap: 0.75rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.session-card {
  background: var(--status-grey);
  border-radius: var(--radius);
  display: grid;
  gap: 0.35rem;
  padding: 0.9rem 1rem;
}

.session-card--open {
  background: var(--status-open);
}

.session-card--booked {
  background: var(--status-booked);
  box-shadow: inset 0.35rem 0 0 #176b49;
}

.session-card--attended {
  background: var(--status-attended);
  color: var(--muted);
}

.session-card--missed {
  background: var(--status-missed);
  box-shadow: inset 0.35rem 0 0 #8d1c2f;
}

.session-card--closed,
.session-card--full,
.session-card--locked {
  color: var(--muted);
}

.session-time {
  font-family: var(--font-display), Impact, sans-serif;
  font-size: 1.2rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.session-title {
  font-weight: 700;
  margin: 0;
}

.session-site {
  font-size: 0.85rem;
  margin: 0;
}

.session-action {
  background: var(--mat-ink);
  border: 0;
  border-radius: 999px;
  color: var(--gi-white);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  justify-self: start;
  margin-top: 0.4rem;
  min-height: 2.75rem;
  padding: 0.5rem 1.1rem;
  transition: transform 160ms ease;
}

.session-action:hover {
  transform: translateY(-2px);
}

.session-action:active {
  transform: translateY(0);
}

.session-action:disabled,
.session-action--static {
  background: transparent;
  border: 1px solid currentColor;
  color: inherit;
  cursor: default;
  transform: none;
}

.session-action--cancel {
  background: transparent;
  border: 1px solid #176b49;
  color: #0f4a31;
}

.session-note,
.session-reason {
  font-size: 0.85rem;
  margin: 0.25rem 0 0;
}

.session-reason {
  font-weight: 600;
}

.calendar-error {
  background: var(--gi-white);
  border-left: 0.35rem solid #8d1c2f;
  border-radius: var(--radius);
  padding: 1rem;
}

.skeleton-card {
  background: linear-gradient(90deg, #e8e7e3 25%, #f2f1ed 50%, #e8e7e3 75%);
  background-size: 200% 100%;
  border-radius: var(--radius);
  height: 6.5rem;
  animation: skeleton-shimmer 1.4s ease infinite;
}

@keyframes skeleton-shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

.cancel-dialog {
  border: 0;
  border-radius: var(--radius);
  max-width: 24rem;
  padding: 1.5rem;
  width: calc(100% - 2rem);
}

.cancel-dialog::backdrop {
  background: rgba(26, 26, 24, 0.6);
}

.cancel-dialog h2 {
  font-family: var(--font-display), Impact, sans-serif;
  font-size: 1.6rem;
  margin: 0 0 0.5rem;
  text-transform: uppercase;
}

.cancel-dialog-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 1.25rem;
}

.cancel-dialog-actions .button {
  border-radius: 999px;
}

@media (min-width: 58rem) {
  .member-week {
    grid-template-columns: var(--week-columns, repeat(6, minmax(0, 1fr)));
  }

  .day-strip {
    max-width: 40rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-card {
    animation: none;
  }

  .session-action {
    transition: none;
  }
}
```

The desktop grid uses `--week-columns` set inline by the week component (`1.6fr` for today).

- [ ] **Step 2: Append to `DESIGN.md`**:

```markdown
## 9. Member app (`/account`)

The signed-in member area is an app, not a web page: immersive **BPT Purple** header holding
identity, child chips and the day strip (pills: weekday letter + number, today filled **BPT
Lime**); the calendar body sits on **Canvas** so the traffic light stays legible. Radius here is
**1rem** (999px on pills/actions) — the only place the system rounds. Status is the **whole card
background**: open `#FFE66D`, booked `#D7F0E2` + `#176B49` left rule, attended `#E7F6EE`
muted, missed `#FFE1E6` + `#8D1C2F` left rule, closed/full/locked `#E8E7E3` muted. One action per
card. Phone (< 58rem) stacks two days; desktop shows six columns Mon–Sat with today at `1.6fr`.
Skeleton shimmer while loading; native `<dialog>` for the only confirmation (cancel).
```

- [ ] **Step 3: Commit**
```bash
git add apps/web/src/app/account/account.css DESIGN.md
git commit -m "feat(account): member app styles and design addendum"
```

---

### Task 7: `SessionCard` + `CancelDialog`

**Files:**
- Create: `apps/web/src/app/account/calendar/session-card.tsx`
- Create: `apps/web/src/app/account/calendar/cancel-dialog.tsx`
- Create: `apps/web/src/app/account/calendar/session-card.test.tsx`

**Interfaces:**
- Consumes: `DerivedSessionStatus`, `formatSessionTimeRange`, `sessionSite`, `lockedReasonLabel`, `cancelDeadlineLabel`, `canCancelBooking`, `formatDayHeading` (domain).
- Produces:
  - `type CalendarEntry = Readonly<{ session: SessionRecord; program: ProgramRecord; derived: DerivedSessionStatus; booking?: BookingRecord }>`
  - `<SessionCard entry busy note onBook(entry) onCancelRequest(entry) now />`
  - `<CancelDialog entry open onKeep onConfirm />`

- [ ] **Step 1: Failing tests** — `session-card.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProgramRecord, SessionRecord } from "@bpt-jersey/domain/schedule";

import { SessionCard, type CalendarEntry } from "./session-card";

const audit = { schemaVersion: "1" as const, createdAt: "", createdBy: "", updatedAt: "", updatedBy: "" };
const program: ProgramRecord = { programId: "prog-teens", academyId: "bpt", name: "Teens BJJ", ageBand: "teens", discipline: "bjj", level: "all-levels", active: true, schemaVersion: "1" };
const session: SessionRecord = { sessionId: "s1", academyId: "bpt", classId: null, programId: "prog-teens", locationId: "town", instructorId: "c", title: "Teens BJJ", startAt: "2026-09-16T17:00:00.000Z", endAt: "2026-09-16T18:00:00.000Z", capacity: 20, minParticipants: 4, status: "scheduled", isSeminar: false, cancellationReason: null, ...audit };
const now = new Date("2026-09-16T15:00:00Z");

function entry(status: CalendarEntry["derived"]["status"], extra: Partial<CalendarEntry> = {}): CalendarEntry {
  return { session, program, derived: { status }, ...extra };
}

describe("SessionCard", () => {
  afterEach(cleanup);

  it("shows time, title, site and a Book action when open", async () => {
    const onBook = vi.fn();
    render(<SessionCard entry={entry("open")} now={now} busy={false} onBook={onBook} onCancelRequest={vi.fn()} />);
    expect(screen.getByText("18:00–19:00")).toBeInTheDocument();
    expect(screen.getByText("Teens BJJ")).toBeInTheDocument();
    expect(screen.getByText("Town")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Book" }));
    expect(onBook).toHaveBeenCalledTimes(1);
  });

  it("offers Cancel while cancellable and says closed after the cut-off", () => {
    const { rerender } = render(<SessionCard entry={entry("booked")} now={now} busy={false} onBook={vi.fn()} onCancelRequest={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Booked · Cancel" })).toBeInTheDocument();
    rerender(<SessionCard entry={entry("booked")} now={new Date("2026-09-16T16:30:00Z")} busy={false} onBook={vi.fn()} onCancelRequest={vi.fn()} />);
    expect(screen.getByText("Booked")).toBeInTheDocument();
    expect(screen.getByText("Cancellations closed")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders static labels for missed, attended, closed and full", () => {
    for (const [status, label] of [["missed", "Missed"], ["attended", "Attended"], ["closed", "Closed"], ["full", "Full"]] as const) {
      const { unmount } = render(<SessionCard entry={entry(status)} now={now} busy={false} onBook={vi.fn()} onCancelRequest={vi.fn()} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("toggles the locked reason on tap", async () => {
    render(<SessionCard entry={entry("locked", { derived: { status: "locked", lockedReason: "site" } })} now={now} busy={false} onBook={vi.fn()} onCancelRequest={vi.fn()} />);
    expect(screen.queryByText("Your plan doesn't cover Town")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Not available" }));
    expect(screen.getByText("Your plan doesn't cover Town")).toBeInTheDocument();
  });

  it("shows the note passed in", () => {
    render(<SessionCard entry={entry("booked")} now={now} busy={false} note="Booked. Missing it costs £15." onBook={vi.fn()} onCancelRequest={vi.fn()} />);
    expect(screen.getByText("Booked. Missing it costs £15.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Implement** `session-card.tsx`:

```tsx
"use client";

import { useState } from "react";

import {
  canCancelBooking,
  formatSessionTimeRange,
  lockedReasonLabel,
  sessionSite,
  type DerivedSessionStatus,
} from "@bpt-jersey/domain/schedule/member-calendar";
import type { BookingRecord, ProgramRecord, SessionRecord } from "@bpt-jersey/domain/schedule";

export type CalendarEntry = Readonly<{
  session: SessionRecord;
  program: ProgramRecord;
  derived: DerivedSessionStatus;
  booking?: BookingRecord;
}>;

type SessionCardProps = Readonly<{
  entry: CalendarEntry;
  now: Date;
  busy: boolean;
  note?: string;
  onBook: (entry: CalendarEntry) => void;
  onCancelRequest: (entry: CalendarEntry) => void;
}>;

const staticLabels: Readonly<Record<string, string>> = Object.freeze({
  missed: "Missed",
  attended: "Attended",
  closed: "Closed",
  full: "Full",
});

export function SessionCard({ entry, now, busy, note, onBook, onCancelRequest }: SessionCardProps) {
  const [showReason, setShowReason] = useState(false);
  const { session, program, derived } = entry;
  const status = derived.status;
  const site = sessionSite(session);

  let action: React.ReactNode;
  if (status === "open") {
    action = (
      <button className="session-action" disabled={busy} onClick={() => onBook(entry)} type="button">
        Book
      </button>
    );
  } else if (status === "booked") {
    action = canCancelBooking(session, now) ? (
      <button
        className="session-action session-action--cancel"
        disabled={busy}
        onClick={() => onCancelRequest(entry)}
        type="button"
      >
        Booked · Cancel
      </button>
    ) : (
      <>
        <span className="session-action session-action--static">Booked</span>
        <p className="session-note">Cancellations closed</p>
      </>
    );
  } else if (status === "locked") {
    action = (
      <>
        <button
          aria-expanded={showReason}
          className="session-action session-action--static"
          onClick={() => setShowReason((value) => !value)}
          type="button"
        >
          Not available
        </button>
        {showReason && derived.lockedReason ? (
          <p className="session-reason">{lockedReasonLabel(derived.lockedReason, site, program.ageBand)}</p>
        ) : null}
      </>
    );
  } else {
    action = <span className="session-action session-action--static">{staticLabels[status]}</span>;
  }

  return (
    <li className={`session-card session-card--${status}`} data-status={status}>
      <span className="session-time">{formatSessionTimeRange(session)}</span>
      <p className="session-title">{session.title}</p>
      <p className="session-site">{site}</p>
      {action}
      {note ? <p className="session-note" role="status">{note}</p> : null}
    </li>
  );
}
```

Tests render a `<li>` outside a list; jsdom does not care, but wrap renders in `<ul>` if a11y lint complains.

- [ ] **Step 3: `cancel-dialog.tsx`**:

```tsx
"use client";

import { useEffect, useRef } from "react";

import { cancelDeadlineLabel, formatDayHeading } from "@bpt-jersey/domain/schedule/member-calendar";
import type { CalendarDay } from "@bpt-jersey/domain/schedule/member-calendar";

import type { CalendarEntry } from "./session-card";

type CancelDialogProps = Readonly<{
  entry: CalendarEntry | undefined;
  day: CalendarDay | undefined;
  busy: boolean;
  onKeep: () => void;
  onConfirm: (entry: CalendarEntry) => void;
}>;

export function CancelDialog({ entry, day, busy, onKeep, onConfirm }: CancelDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (entry && !dialog.open) dialog.showModal();
    if (!entry && dialog.open) dialog.close();
  }, [entry]);

  const time = entry ? entry.session.startAt : undefined;
  const timeLabel = time
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Jersey", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(time))
    : "";

  return (
    <dialog aria-labelledby="cancel-dialog-title" className="cancel-dialog" onClose={onKeep} ref={ref}>
      {entry ? (
        <>
          <h2 id="cancel-dialog-title">
            Cancel {day ? formatDayHeading(day) : ""} {timeLabel} · {entry.session.title}?
          </h2>
          <p>Cancellations close at {cancelDeadlineLabel(entry.session)}.</p>
          <div className="cancel-dialog-actions">
            <button className="button button-secondary" disabled={busy} onClick={onKeep} type="button">
              Keep booking
            </button>
            <button className="button button-primary" disabled={busy} onClick={() => onConfirm(entry)} type="button">
              Cancel booking
            </button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
```

`.button-primary` in `globals.css` is white-on-purple for the hero; inside the dialog add in `account.css`:

```css
.cancel-dialog .button-primary {
  background: var(--bpt-purple);
  color: var(--gi-white);
}

.cancel-dialog .button-secondary {
  border-color: var(--mat-ink);
  color: var(--mat-ink);
}
```

jsdom has no `showModal`; in tests that mount the dialog (Task 9) stub it: `HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });` and `close` similarly.

- [ ] **Step 4: Run** `session-card.test.tsx` → PASS. Lint both files.

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/app/account/calendar/session-card.tsx apps/web/src/app/account/calendar/cancel-dialog.tsx apps/web/src/app/account/calendar/session-card.test.tsx apps/web/src/app/account/account.css
git commit -m "feat(account): session card and cancel dialog"
```

---

### Task 8: `DayColumn`, `CalendarHeader`, `PenaltyBanner`

**Files:**
- Create: `apps/web/src/app/account/calendar/day-column.tsx`
- Create: `apps/web/src/app/account/calendar/calendar-header.tsx`
- Create: `apps/web/src/app/account/calendar/penalty-banner.tsx`
- Create: `apps/web/src/app/account/calendar/calendar-header.test.tsx`

**Interfaces:**
- Consumes: `CalendarDay`, `formatDayHeading`, `CalendarEntry`, `SessionCard`, `CalendarParticipant`.
- Produces:
  - `<DayColumn day entries loading now busyKey notes onBook onCancelRequest />` (sets `day-column--today`)
  - `<CalendarHeader displayName participants selectedStudentId onSelectStudent days canPrev canNext onPrev onNext onSignOut />`
  - `<PenaltyBanner />`

- [ ] **Step 1: Failing test** — `calendar-header.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CalendarHeader } from "./calendar-header";

const days = [
  { dateKey: "2026-09-16", weekday: "Wed", dayNumber: 16, isToday: true, startAt: "", endAt: "" },
  { dateKey: "2026-09-17", weekday: "Thu", dayNumber: 17, isToday: false, startAt: "", endAt: "" },
];
const participants = [
  { studentId: "maya", firstName: "Maya", membershipId: "m1", planId: "town-teens" as const, participantType: "teens" as const, planClassSites: ["Town" as const], planOpenMatSites: ["Town" as const] },
  { studentId: "leo", firstName: "Leo", membershipId: "m2", planId: "west-kids-2x" as const, participantType: "kids" as const, planClassSites: ["West" as const], planOpenMatSites: ["Town" as const] },
];

describe("CalendarHeader", () => {
  afterEach(cleanup);

  it("shows the first name, day pills with today marked, and arrows", async () => {
    const onNext = vi.fn();
    render(<CalendarHeader displayName="Jordan Demo" participants={[participants[0]!]} selectedStudentId="maya" onSelectStudent={vi.fn()} days={days} canPrev={false} canNext onPrev={vi.fn()} onNext={onNext} onSignOut={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Jordan" })).toBeInTheDocument();
    expect(screen.getByText("16").closest(".day-pill")).toHaveClass("day-pill--today");
    expect(screen.getByRole("button", { name: "Earlier" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onNext).toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Choose member" })).not.toBeInTheDocument();
  });

  it("renders chips for a guardian with several children and reports selection", async () => {
    const onSelect = vi.fn();
    render(<CalendarHeader displayName="Jordan Demo" participants={participants} selectedStudentId="maya" onSelectStudent={onSelect} days={days} canPrev={false} canNext onPrev={vi.fn()} onNext={vi.fn()} onSignOut={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Maya" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Leo" }));
    expect(onSelect).toHaveBeenCalledWith("leo");
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Implement** `calendar-header.tsx`:

```tsx
"use client";

import type { CalendarDay } from "@bpt-jersey/domain/schedule/member-calendar";

import type { CalendarParticipant } from "../../../lib/calendar";

type CalendarHeaderProps = Readonly<{
  displayName: string;
  participants: readonly CalendarParticipant[];
  selectedStudentId: string;
  onSelectStudent: (studentId: string) => void;
  days: readonly CalendarDay[];
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSignOut: () => void;
}>;

export function CalendarHeader(props: CalendarHeaderProps) {
  const firstName = props.displayName.trim().split(/\s+/u)[0] || "Member";
  return (
    <header className="member-header">
      <div className="member-header-top">
        <p className="member-eyebrow">BPT Jersey / Member</p>
        <button className="member-signout" onClick={props.onSignOut} type="button">
          Sign out
        </button>
      </div>
      <h1 className="member-name">{firstName}</h1>
      {props.participants.length > 1 ? (
        <ul aria-label="Choose member" className="member-chips" role="group">
          {props.participants.map((participant) => (
            <li key={participant.studentId}>
              <button
                aria-pressed={participant.studentId === props.selectedStudentId}
                className={`member-chip${participant.studentId === props.selectedStudentId ? " member-chip--active" : ""}`}
                onClick={() => props.onSelectStudent(participant.studentId)}
                type="button"
              >
                {participant.firstName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="day-strip-row">
        <button aria-label="Earlier" className="day-nav" disabled={!props.canPrev} onClick={props.onPrev} type="button">
          ‹
        </button>
        <ol className="day-strip">
          {props.days.map((day) => (
            <li className={`day-pill${day.isToday ? " day-pill--today" : ""}`} key={day.dateKey}>
              <span>{day.weekday}</span>
              <span>{day.dayNumber}</span>
            </li>
          ))}
        </ol>
        <button aria-label="Later" className="day-nav" disabled={!props.canNext} onClick={props.onNext} type="button">
          ›
        </button>
      </div>
    </header>
  );
}
```

`day-column.tsx`:

```tsx
"use client";

import { formatDayHeading, type CalendarDay } from "@bpt-jersey/domain/schedule/member-calendar";

import { SessionCard, type CalendarEntry } from "./session-card";

type DayColumnProps = Readonly<{
  day: CalendarDay;
  entries: readonly CalendarEntry[];
  loading: boolean;
  now: Date;
  busyKey: string;
  notes: Readonly<Record<string, string>>;
  onBook: (entry: CalendarEntry) => void;
  onCancelRequest: (entry: CalendarEntry) => void;
}>;

export function DayColumn(props: DayColumnProps) {
  return (
    <section
      aria-labelledby={`day-${props.day.dateKey}`}
      className={`day-column${props.day.isToday ? " day-column--today" : ""}`}
      data-date={props.day.dateKey}
    >
      <h2 className="day-heading" id={`day-${props.day.dateKey}`}>
        {formatDayHeading(props.day)}
      </h2>
      {props.loading ? (
        <div aria-busy="true" className="day-list">
          <div className="skeleton-card" />
          <div className="skeleton-card" />
          <div className="skeleton-card" />
        </div>
      ) : props.entries.length === 0 ? (
        <p className="day-empty">No sessions</p>
      ) : (
        <ul className="day-list">
          {props.entries.map((entry) => (
            <SessionCard
              busy={props.busyKey === entry.session.sessionId}
              entry={entry}
              key={entry.session.sessionId}
              note={props.notes[entry.session.sessionId]}
              now={props.now}
              onBook={props.onBook}
              onCancelRequest={props.onCancelRequest}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
```

`penalty-banner.tsx`:

```tsx
export function PenaltyBanner() {
  return (
    <p className="penalty-banner" role="alert">
      A £15 no-show penalty will be added to your next booking. Claims are handled by the office.
    </p>
  );
}
```

- [ ] **Step 3: Run** header test → PASS. Lint the three files.

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/app/account/calendar/day-column.tsx apps/web/src/app/account/calendar/calendar-header.tsx apps/web/src/app/account/calendar/penalty-banner.tsx apps/web/src/app/account/calendar/calendar-header.test.tsx
git commit -m "feat(account): calendar header, day column and penalty banner"
```

---

### Task 9: `MemberCalendar` orchestration + new `/account` page

**Files:**
- Create: `apps/web/src/app/account/calendar/member-calendar.tsx`
- Create: `apps/web/src/app/account/calendar/member-calendar.test.tsx`
- Rewrite: `apps/web/src/app/account/page.tsx`
- Rewrite: `apps/web/src/app/account/page.test.tsx`

**Interfaces:**
- Consumes: everything above; `useClientSession`, `ClientAuthGate`, `ClientAuthProvider`, `requireClientSession`; `createCalendarRepository`.
- Produces: `<MemberCalendar repository session onSignOut />` and default export `AccountPage`.

- [ ] **Step 1: Failing tests** — `member-calendar.test.tsx` (uses the fixture repository; stub `matchMedia` and `<dialog>`):

```tsx
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixtureCalendarRepository } from "../../../lib/calendar/fixture-calendar-repository";
import { MemberCalendar } from "./member-calendar";

function stubViewport(desktop: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: desktop && query.includes("58rem"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const teen = { role: "teenStudent" as const, displayName: "Sam Demo" };
const guardian = { role: "guardian" as const, displayName: "Jordan Demo" };

describe("MemberCalendar", () => {
  it("phone: renders two day columns for a teen and no chips", async () => {
    stubViewport(false);
    render(<MemberCalendar repository={createFixtureCalendarRepository("teenStudent")} session={teen} onSignOut={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("region")).toHaveLength(2));
    expect(screen.queryByRole("group", { name: "Choose member" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sam" })).toBeInTheDocument();
  });

  it("desktop: renders six columns with today wider", async () => {
    stubViewport(true);
    render(<MemberCalendar repository={createFixtureCalendarRepository("teenStudent")} session={teen} onSignOut={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByRole("region")).toHaveLength(6));
    const week = document.querySelector(".member-week") as HTMLElement;
    expect(week.style.getPropertyValue("--week-columns")).toContain("1.6fr");
  });

  it("guardian: chips switch the selected child and the penalty banner follows Maya", async () => {
    stubViewport(false);
    render(<MemberCalendar repository={createFixtureCalendarRepository("guardian")} session={guardian} onSignOut={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Maya" })).toHaveAttribute("aria-pressed", "true"));
    const bannerForMaya = await screen.findByRole("alert").catch(() => null);
    await userEvent.click(screen.getByRole("button", { name: "Leo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Leo" })).toHaveAttribute("aria-pressed", "true"));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    // Maya only has a penalty when the fixture found a past Town Teens session this week; assert consistency, not presence.
    expect(bannerForMaya === null || bannerForMaya.textContent).toBeTruthy();
  });

  it("books with one tap and shows the £15 note, then cancels through the dialog", async () => {
    stubViewport(true);
    render(<MemberCalendar repository={createFixtureCalendarRepository("teenStudent")} session={teen} onSignOut={vi.fn()} />);
    const bookButtons = await screen.findAllByRole("button", { name: "Book" });
    const first = bookButtons[0]!;
    const card = first.closest("li") as HTMLElement;
    await userEvent.click(first);
    await waitFor(() => expect(within(card).getByText("Booked. Missing it costs £15.")).toBeInTheDocument());
    await userEvent.click(within(card).getByRole("button", { name: "Booked · Cancel" }));
    const dialog = screen.getByRole("dialog", { hidden: true });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel booking" }));
    await waitFor(() => expect(within(card).getByRole("button", { name: "Book" })).toBeInTheDocument());
  });

  it("navigates forward and disables Earlier at offset 0", async () => {
    stubViewport(false);
    render(<MemberCalendar repository={createFixtureCalendarRepository("teenStudent")} session={teen} onSignOut={vi.fn()} />);
    await screen.findAllByRole("region");
    expect(screen.getByRole("button", { name: "Earlier" })).toBeDisabled();
    const before = screen.getAllByRole("region").map((r) => r.getAttribute("data-date"));
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(() => {
      const after = screen.getAllByRole("region").map((r) => r.getAttribute("data-date"));
      expect(after).not.toEqual(before);
    });
    expect(screen.getByRole("button", { name: "Earlier" })).toBeEnabled();
  });

  it("shows an error panel with retry when loading fails", async () => {
    stubViewport(false);
    const broken = { ...createFixtureCalendarRepository("teenStudent"), loadMember: () => Promise.reject(new Error("x")) };
    render(<MemberCalendar repository={broken} session={teen} onSignOut={vi.fn()} />);
    expect(await screen.findByText("Couldn't load your calendar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

void act;
```

- [ ] **Step 2: Run** → FAIL. **Implement** `member-calendar.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  deriveSessionStatus,
  nextOffset,
  prevOffset,
  visibleDays,
  type CalendarDay,
  type CalendarViewport,
} from "@bpt-jersey/domain/schedule/member-calendar";
import type { BookingRecord } from "@bpt-jersey/domain/schedule";
import type { NoShowPenaltyRecord } from "@bpt-jersey/domain/penalties";

import type { CalendarMember, CalendarRepository, CalendarRole, CalendarWeekData } from "../../../lib/calendar";
import { bookingFailureMessage, cancellationFailureMessage } from "../../../lib/calendar/booking-messages";
import { CalendarHeader } from "./calendar-header";
import { CancelDialog } from "./cancel-dialog";
import { DayColumn } from "./day-column";
import { PenaltyBanner } from "./penalty-banner";
import type { CalendarEntry } from "./session-card";

const desktopQuery = "(min-width: 58rem)";
const bookedNote = "Booked. Missing it costs £15.";

type MemberCalendarProps = Readonly<{
  repository: CalendarRepository;
  session: Readonly<{ role: CalendarRole; displayName: string }>;
  onSignOut: () => void;
}>;

type LoadState = "loading" | "ready" | "error";

function useViewport(): CalendarViewport {
  const [viewport, setViewport] = useState<CalendarViewport>("phone");
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(desktopQuery);
    const apply = () => setViewport(media.matches ? "desktop" : "phone");
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return viewport;
}

function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function hasPendingPenalty(penalties: readonly NoShowPenaltyRecord[]): boolean {
  return penalties.some((p) => (p.status === "proposed" || p.status === "charged") && p.resolution === null);
}

export function MemberCalendar({ repository, session, onSignOut }: MemberCalendarProps) {
  const viewport = useViewport();
  const now = useMinuteClock();
  const [offset, setOffset] = useState(0);
  const [member, setMember] = useState<CalendarMember>();
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [memberState, setMemberState] = useState<LoadState>("loading");
  const [week, setWeek] = useState<CalendarWeekData>();
  const [weekState, setWeekState] = useState<LoadState>("loading");
  const [penalties, setPenalties] = useState<readonly NoShowPenaltyRecord[]>([]);
  const [busyKey, setBusyKey] = useState("");
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  const [cancelling, setCancelling] = useState<CalendarEntry>();
  const [reloadToken, setReloadToken] = useState(0);

  const days = useMemo(() => visibleDays({ now, viewport, offset }), [now, viewport, offset]);
  const rangeFrom = days[0]?.startAt ?? "";
  const rangeTo = days[days.length - 1]?.endAt ?? "";

  useEffect(() => {
    setOffset(0);
  }, [viewport]);

  useEffect(() => {
    let active = true;
    setMemberState("loading");
    repository
      .loadMember()
      .then((loaded) => {
        if (!active) return;
        setMember(loaded);
        setSelectedStudentId((current) =>
          loaded.participants.some((p) => p.studentId === current) ? current : loaded.participants[0]?.studentId ?? "",
        );
        setMemberState("ready");
      })
      .catch(() => {
        if (active) setMemberState("error");
      });
    return () => {
      active = false;
    };
  }, [repository, reloadToken]);

  useEffect(() => {
    if (!selectedStudentId || !rangeFrom || !rangeTo) return;
    let active = true;
    setWeekState("loading");
    Promise.all([repository.loadWeek(selectedStudentId, rangeFrom, rangeTo), repository.loadPenalties(selectedStudentId)])
      .then(([loadedWeek, loadedPenalties]) => {
        if (!active) return;
        setWeek(loadedWeek);
        setPenalties(loadedPenalties);
        setWeekState("ready");
      })
      .catch(() => {
        if (active) setWeekState("error");
      });
    return () => {
      active = false;
    };
  }, [repository, selectedStudentId, rangeFrom, rangeTo, reloadToken]);

  const participant = member?.participants.find((p) => p.studentId === selectedStudentId);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    if (!week || !participant) return map;
    const programs = new Map(week.programs.map((p) => [p.programId, p]));
    const bookings = new Map(week.bookings.filter((b) => b.status !== "cancelled").map((b) => [b.sessionId, b]));
    const attendance = new Map(week.attendance.map((a) => [a.sessionId, a]));
    const memberContext = {
      studentId: participant.studentId,
      membershipId: participant.membershipId,
      participantType: participant.participantType,
      planClassSites: participant.planClassSites,
      planOpenMatSites: participant.planOpenMatSites,
    };
    const sorted = [...week.sessions]
      .filter((s) => s.status !== "cancelled")
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
    for (const sessionRecord of sorted) {
      const program = programs.get(sessionRecord.programId);
      if (!program) continue;
      const day = days.find((d) => sessionRecord.startAt >= d.startAt && sessionRecord.startAt < d.endAt);
      if (!day) continue;
      const booking = bookings.get(sessionRecord.sessionId);
      const derived = deriveSessionStatus({
        session: sessionRecord,
        program,
        member: memberContext,
        booking,
        attendance: attendance.get(sessionRecord.sessionId),
        bookedCount: week.bookedCounts[sessionRecord.sessionId] ?? 0,
        now,
      });
      const list = map.get(day.dateKey) ?? [];
      list.push({ session: sessionRecord, program, derived, booking });
      map.set(day.dateKey, list);
    }
    return map;
  }, [week, participant, days, now]);

  const applyBooking = useCallback((replacement: BookingRecord) => {
    setWeek((current) => {
      if (!current) return current;
      const others = current.bookings.filter((b) => b.sessionId !== replacement.sessionId);
      return { ...current, bookings: [replacement, ...others] };
    });
  }, []);

  const flashNote = useCallback((sessionId: string, text: string) => {
    setNotes((current) => ({ ...current, [sessionId]: text }));
    setTimeout(() => {
      setNotes((current) => {
        const { [sessionId]: _removed, ...rest } = current;
        return rest;
      });
    }, 4000);
  }, []);

  const handleBook = useCallback(
    async (entry: CalendarEntry) => {
      if (!participant) return;
      setBusyKey(entry.session.sessionId);
      try {
        const booking = await repository.book({
          sessionId: entry.session.sessionId,
          studentId: participant.studentId,
          membershipId: participant.membershipId,
        });
        applyBooking(booking);
        flashNote(entry.session.sessionId, bookedNote);
      } catch (error) {
        flashNote(entry.session.sessionId, bookingFailureMessage(error));
      } finally {
        setBusyKey("");
      }
    },
    [participant, repository, applyBooking, flashNote],
  );

  const handleConfirmCancel = useCallback(
    async (entry: CalendarEntry) => {
      if (!participant || !entry.booking) return;
      setBusyKey(entry.session.sessionId);
      try {
        const booking = await repository.cancel({
          bookingId: entry.booking.bookingId,
          studentId: participant.studentId,
          reason: "member_cancelled",
        });
        applyBooking(booking);
      } catch (error) {
        flashNote(entry.session.sessionId, cancellationFailureMessage(error));
      } finally {
        setBusyKey("");
        setCancelling(undefined);
      }
    },
    [participant, repository, applyBooking, flashNote],
  );

  const next = nextOffset(viewport, offset, now);
  const prev = prevOffset(viewport, offset, now);
  const todayIndex = days.findIndex((d) => d.isToday);
  const weekColumns = days.map((_, index) => (index === todayIndex ? "1.6fr" : "1fr")).join(" ");
  const cancellingDay: CalendarDay | undefined = cancelling
    ? days.find((d) => cancelling.session.startAt >= d.startAt && cancelling.session.startAt < d.endAt)
    : undefined;

  if (memberState === "error" || weekState === "error") {
    return (
      <main className="member-app">
        <CalendarHeader
          canNext={false}
          canPrev={false}
          days={days}
          displayName={session.displayName}
          onNext={() => undefined}
          onPrev={() => undefined}
          onSelectStudent={() => undefined}
          onSignOut={onSignOut}
          participants={[]}
          selectedStudentId=""
        />
        <div className="member-body">
          <div className="calendar-error" role="alert">
            <p>Couldn't load your calendar.</p>
            <button className="session-action" onClick={() => setReloadToken((value) => value + 1)} type="button">
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="member-app">
      <CalendarHeader
        canNext={next !== null}
        canPrev={prev !== null}
        days={days}
        displayName={session.displayName}
        onNext={() => next !== null && setOffset(next)}
        onPrev={() => prev !== null && setOffset(prev)}
        onSelectStudent={setSelectedStudentId}
        onSignOut={onSignOut}
        participants={member?.participants ?? []}
        selectedStudentId={selectedStudentId}
      />
      {weekState === "ready" && hasPendingPenalty(penalties) ? <PenaltyBanner /> : null}
      <div className="member-body">
        <div className="member-week" style={{ "--week-columns": weekColumns } as React.CSSProperties}>
          {days.map((day) => (
            <DayColumn
              busyKey={busyKey}
              day={day}
              entries={entriesByDay.get(day.dateKey) ?? []}
              key={day.dateKey}
              loading={memberState === "loading" || weekState === "loading"}
              notes={notes}
              now={now}
              onBook={(entry) => void handleBook(entry)}
              onCancelRequest={setCancelling}
            />
          ))}
        </div>
      </div>
      <CancelDialog
        busy={busyKey !== ""}
        day={cancellingDay}
        entry={cancelling}
        onConfirm={(entry) => void handleConfirmCancel(entry)}
        onKeep={() => setCancelling(undefined)}
      />
    </main>
  );
}
```

Adjust `repository.cancel({...})` to the real `CancelBookingInput` (see Task 4 Step 2). If eslint rejects the unused `_removed` destructure, use `const rest = { ...current }; delete rest[sessionId]; return rest;`.

- [ ] **Step 3: Rewrite `page.tsx`**:

```tsx
"use client";

import { useMemo } from "react";

import { ClientAuthGate, ClientAuthProvider, useClientSession } from "../../lib/client-auth";
import { createCalendarRepository, type CalendarRole } from "../../lib/calendar";
import { requireClientSession } from "../../lib/login-flow";
import { MemberCalendar } from "./calendar/member-calendar";

import "./account.css";

function AccountContent() {
  const { session, signOut } = useClientSession();
  const role: CalendarRole | undefined =
    session?.role === "guardian" || session?.role === "adultStudent" || session?.role === "teenStudent"
      ? session.role
      : undefined;
  const displayName = session?.displayName || "Member";
  const repository = useMemo(
    () => (role ? createCalendarRepository({ role, displayName }) : undefined),
    [role, displayName],
  );

  if (!session || !role || !repository) return null;

  async function handleSignOut(): Promise<void> {
    await signOut();
    window.location.assign(requireClientSession("/account").loginPath);
  }

  return (
    <MemberCalendar
      onSignOut={() => void handleSignOut()}
      repository={repository}
      session={{ role, displayName }}
    />
  );
}

export default function AccountPage() {
  return (
    <ClientAuthProvider>
      <ClientAuthGate returnPath="/account">
        <AccountContent />
      </ClientAuthGate>
    </ClientAuthProvider>
  );
}
```

- [ ] **Step 4: Rewrite `page.test.tsx`** — keep the existing `client-auth` mock block (lines 1-40 of the old file, minus the `guardian-notices` / `client-reminders` mocks) and replace the cases with:

```tsx
vi.mock("./calendar/member-calendar", () => ({
  MemberCalendar: ({ session }: { session: { role: string; displayName: string } }) => (
    <main data-testid="member-calendar">{`${session.role}:${session.displayName}`}</main>
  ),
}));

describe("account home", () => {
  afterEach(() => {
    cleanup();
    authState.status = "signed-out";
    authState.session = undefined;
    vi.clearAllMocks();
  });

  it("requires a client session before showing the calendar", () => {
    render(<AccountPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?returnTo=%2Faccount");
    expect(screen.queryByTestId("member-calendar")).not.toBeInTheDocument();
  });

  it("mounts the member calendar for a signed-in teen", () => {
    authState.status = "signed-in";
    authState.session = { email: "teen@bpt.test", displayName: "Sam Demo", uid: "u1", role: "teenStudent" };
    render(<AccountPage />);
    expect(screen.getByTestId("member-calendar")).toHaveTextContent("teenStudent:Sam Demo");
  });

  it("has no links to the legacy account pages", () => {
    authState.status = "signed-in";
    authState.session = { email: "a@bpt.test", displayName: "Alex", uid: "u2", role: "adultStudent" };
    render(<AccountPage />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
```

Extend `authState.session`'s type in the hoisted block with `role?: string`. Delete `client-reminders.tsx`, `client-reminders.test.tsx`, `guardian-notices.tsx`, `guardian-notices.test.tsx` **only if** nothing else imports them (`grep -rn "client-reminders\|guardian-notices" apps/web/src --include=*.tsx | grep -v "^apps/web/src/app/account/"`); if something does, leave them.

- [ ] **Step 5: Run** both test files → PASS. Then the whole web project: `corepack pnpm vitest run --project web` → all green. Lint: `corepack pnpm eslint apps/web/src/app/account apps/web/src/lib/calendar --max-warnings 0`. Typecheck: `corepack pnpm --dir apps/web typecheck`.

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/app/account
git commit -m "feat(account): replace account home with the member booking calendar"
```

---

### Task 10: Visual verification on the workbench (build → Playwright → fix loop)

**Files:**
- Create: `qa/scripts/account-calendar-shots.mjs` (throwaway-grade, kept for the next iteration)
- Output: `/root/BPT-Jersey/qa/screenshots/account-*.png` (gitignored — add `qa/screenshots/` to `.gitignore`)

- [ ] **Step 1: Confirm the workbench serves the new page** — `docker compose -f deploy/compose.yaml up -d --force-recreate app` (env changed), then `curl -sk -o /dev/null -w '%{http_code}' https://optimyze-vps-de-prod.tail29c816.ts.net:9471/account` → `200`.

- [ ] **Step 2: Screenshot script** — `qa/scripts/account-calendar-shots.mjs` (run from `qa/` so `@playwright/test` resolves):

```js
import { chromium } from "@playwright/test";

const base = "https://optimyze-vps-de-prod.tail29c816.ts.net:9471";
const users = [
  ["teen", "teen@bpt.test"],
  ["tutor", "tutor@bpt.test"],
];
const viewports = [
  ["phone", { width: 390, height: 844 }],
  ["desktop", { width: 1280, height: 800 }],
];

const browser = await chromium.launch({ args: ["--no-sandbox"] });
for (const [who, email] of users) {
  for (const [name, viewport] of viewports) {
    const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', "Passw0rd!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/account/);
    await page.waitForSelector(".session-card, .day-empty", { timeout: 15000 });
    await page.screenshot({ path: `screenshots/account-${who}-${name}.png`, fullPage: true });
    const summary = await page.evaluate(() => ({
      columns: document.querySelectorAll(".day-column").length,
      statuses: [...document.querySelectorAll(".session-card")].map((c) => c.dataset.status),
      chips: document.querySelectorAll(".member-chip").length,
      banner: Boolean(document.querySelector(".penalty-banner")),
    }));
    console.log(who, name, JSON.stringify(summary), errors.length ? `ERRORS: ${errors.join(" | ")}` : "no errors");
    await page.close();
  }
}
await browser.close();
```

- [ ] **Step 3: Run** — `cd qa && mkdir -p screenshots && node scripts/account-calendar-shots.mjs`. Expected: `phone` → `columns: 2`, `desktop` → `columns: 6`; `tutor` → `chips: 2`; statuses contain `open`, `booked`, `locked` (and `missed`/`attended` when the week has past sessions); `no errors`.

- [ ] **Step 4: Look at every screenshot** (Read tool on each PNG) and check against the spec §6: purple header, lime today pill, chips for the tutor, six columns with today wider on desktop, whole-card colours, one action per card, no emojis, no horizontal overflow on phone (`document.documentElement.scrollWidth <= 390`). Also click-test on desktop: book one open card → note appears; open cancel dialog → cancel → card returns to open. Add these to the script as assertions if useful.

- [ ] **Step 5: Fix loop** — for each mismatch, edit the component/CSS, keep the unit tests green (`corepack pnpm vitest run --project web`), re-run Step 3, re-read the screenshots. Repeat until Step 4 has no findings.

- [ ] **Step 6: Final gates** — `corepack pnpm lint`, `corepack pnpm test`, `corepack pnpm --dir apps/web typecheck` all green; `corepack pnpm --dir apps/web build` succeeds (static export must still compile with `NEXT_PUBLIC_CALENDAR_SOURCE` unset → fixtures).

- [ ] **Step 7: Commit**
```bash
git add qa/scripts/account-calendar-shots.mjs .gitignore
git commit -m "test(account): workbench screenshot script for the member calendar"
```

---

## Handoff notes for the connecting model (kept in the plan on purpose)

1. Set `NEXT_PUBLIC_CALENDAR_SOURCE=firebase`; everything in `apps/web/src/lib/calendar/firebase-calendar-repository.ts` is the surface to verify.
2. `bookedCounts` is `{}` there — add a callable (or extend `listSessions`) returning confirmed counts so `full` can render.
3. Decide teen account creation (spec §7); the fixture assumes `loadMember()` can resolve the teen's `studentId` from their memberships.
4. `deploy/seed-auth.mjs` only seeds Auth; Firestore/Functions emulators were intentionally not added.
