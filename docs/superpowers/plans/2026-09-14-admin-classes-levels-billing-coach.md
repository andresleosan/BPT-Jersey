# Admin Classes, Levels, Billing and Coach Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin creates, edits and removes multi-day classes (with level range, age range and description) that reach the member calendar; Levels shows 27 belt cards; Billing becomes the finance home with 20 recent payments, per-member history, member search for invoices and cash/bank payments; coaches get Classes (read) and Levels; the 2026-09-12 coach work is re-verified and the ledger repaired.

**Architecture:** Per-feature layering of `CLAUDE.md`: domain contracts (hand-rolled parsers returning `Result`, no zod in schedule/finance) → functions store + callables → web clients → components/routes. Class records move to schema v2 (`recurrenceRules[]`) with a read-side normaliser so no document is rewritten; sessions gain additive optional fields. Finance makes `membershipId` nullable end to end and adds three read callables. Everything is verified with vitest, Playwright synthetic-session specs and one callable-level emulator spec.

**Tech Stack:** pnpm monorepo, TypeScript strict, Next.js 16 static export, React 19, Firebase Functions v2 `onCall`, Firestore, vitest 4, Playwright, Firebase emulators in Docker (`bpt-emu:local`).

**Spec:** `docs/superpowers/specs/2026-09-14-admin-classes-levels-billing-coach-design.md`

## Global Constraints

- Node `>=22.13 <25`; every command via `corepack pnpm <script>` from the repo root; never install pnpm or firebase-tools globally.
- Talk to the operator in Spanish; code, identifiers, UI copy and commit messages in English (UK English in UI copy, plain academy voice, DESIGN.md §8).
- `packages/domain` never imports Firebase. Schedule/finance contracts are hand-rolled parsers returning `Result<T, string>` (schedule) or `Result<T, ValidationIssue[]>` (finance); do not introduce zod there.
- Every new callable is exported from `apps/functions/src/index.ts` and authorises on every call (`requireUserActor` + role list); hiding a button in the client is never the control.
- Web clients return safe user-facing error strings, never raw Firebase errors.
- DESIGN.md: radius `0`, no pills, no blue accents, no emojis, no spinners, status = text + coloured left rule, buttons `min-height 3.15rem`, focus ring `3px solid #2F2483`, breakpoints in rem (`50rem` collapses to one column), `prefers-reduced-motion` respected. Exception introduced by this plan: belt colours from the level catalogue inside `.belt-bar` only (DESIGN.md §10, Task 12).
- Existing test conventions: unit `*.test.ts(x)` beside source; Playwright `*.spec.ts` in `qa/tests/` using `installAdminFixture`; every test owns its data; an existence check is not a functioning check (LECCIONES §4).
- Never run prettier on `tasksv2.md`. Never deploy. Never run a destructive migration. Emulator work runs in Docker (`bpt-emu:local`, `--network none`, project `demo-bpt-jersey`, `FUNCTIONS_DISCOVERY_TIMEOUT=300000`).
- Before `typecheck`/`test:unit`/`verify:mvp` on this VPS: `git sparse-checkout add Lista Listav2 .cronos`; restore at the end with `git sparse-checkout set '/*' '!/.cronos' '!/Lista' '!/Listav2'`.
- Known pre-existing failures to ignore unless the diff touches them: `member-calendar.test.tsx` (real date) and `schedule-security-boundary.test.ts` (flaky under the full suite; passes alone).
- Commit after every task with a conventional message ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and the `Claude-Session:` line the session reminder dictates.

---

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `apps/web/src/app/admin/classes/class-form.tsx` (+ `.test.tsx`) | Mobile-first class form: name, program, centre, weekly schedule, level range, age range, description, coaches, capacity. |
| `apps/web/src/app/levels/levels-grouping.ts` (+ `.test.ts`) | Pure grouping of the level catalogue into belts with stripes, age group and colour. |
| `apps/web/src/app/admin/billing/member-picker.tsx` (+ `.test.tsx`) | Search-as-you-type member selector over `listMemberNames`. |
| `apps/web/src/app/admin/billing/issue-invoice-dialog.tsx` (+ `.test.tsx`) | Issue invoice with member search and optional membership. |
| `apps/web/src/app/admin/billing/record-payment-dialog.tsx` (+ `.test.tsx`) | Record payment with Cash / Bank transfer choice. |
| `apps/web/src/app/admin/billing/member-account-panel.tsx` (+ `.test.tsx`) | A family's payments and invoices for one selected member. |
| `apps/web/src/app/admin/billing/billing.css` | Billing-only styles. |
| `apps/functions/src/members/member-names-callables.ts` (+ `.test.ts`) | `listMemberNames` callable. |
| `apps/web/src/lib/calendar/firebase-calendar-repository.test.ts` | Adapter tests with mocked clients. |
| `qa/tests/admin-classes-form.spec.ts`, `qa/tests/admin-levels.spec.ts`, `qa/tests/admin-billing-home.spec.ts`, `qa/tests/schedule-finance-emulator.spec.ts` | Playwright UI specs and the emulator callable spec. |

**Modified**

| File | Change |
| --- | --- |
| `packages/domain/src/schedule/schedule-contracts.ts` (+ test) | Ranges, description, labels, class v2, normaliser, new inputs, multi-rule generator. |
| `packages/domain/src/finance/finance-contracts.ts` (+ test) | `membershipId` nullable, `RecentPaymentRow`. |
| `packages/domain/src/members/member-directory-contracts.ts` (+ test) | `memberNameRowSchema`. |
| `apps/functions/src/schedule/schedule-service.ts` (+ test) | Normalised reads, `updateSession`, `removeClass`, `countConfirmedBookings`, legacy-id skip. |
| `apps/functions/src/schedule/schedule-callables.ts` (+ test), `apps/functions/src/index.ts` | Three new callables. |
| `apps/functions/src/finance/finance-service.ts`, `finance-callables.ts`, `financial-dashboard-service.ts` (+ tests) | Null membership, `listRecentPayments`, `getFamilyFinancialAccount`. |
| `apps/web/src/lib/schedule-client.ts`, `billing-client.ts`, `finance-client.ts`, `members-client.ts` (+ tests) | New client functions. |
| `apps/web/src/app/admin/classes/page.tsx`, `classes-dialog.tsx`, `classes.css` (+ tests) | New dialog kinds, table columns, role gating. |
| `apps/web/src/app/admin/admin-routes.ts` (+ test), `admin-shell.tsx`, `qa/tests/admin-shell.spec.ts` | Coach routes. |
| `apps/web/src/app/levels/levels-browser.tsx`, `levels.css` (+ test) | Belt cards. |
| `apps/web/src/app/admin/billing/page.tsx` (+ test), `apps/web/src/app/admin/finance/page.tsx` (+ test) | Finance home; redirect. |
| `apps/web/src/lib/calendar/firebase-calendar-repository.ts`, `fixture-calendar-repository.ts`, `apps/web/src/app/account/calendar/session-card.tsx` (+ test), `account.css` | Booked counts, card details. |
| `qa/run-e2e.mjs` | Forward `T032_SCHEDULE_FINANCE_EMULATOR_E2E`. |
| `DESIGN.md`, `STACK.md`, `docs/adr/ADR-010-coach-office-powers.md`, `tasksv2.md`, `Listav2/Listav2.data.js` | Docs and ledger. |

---

### Task 0: Workbench commit, branch and sparse checkout

**Files:**
- Commit: `apps/web/next.config.ts`, `apps/web/src/lib/firebase-client.ts`, `deploy/Caddyfile`, `deploy/compose.yaml`, `deploy/firebase.emulator.json`, `CLAUDE.md`, `docs/roadmap/2026-09-12-mvp-por-pantallas.md`, the deletions of `.codex/config.toml` and `AGENTS.md`, plus the spec and this plan.
- Inspect before deciding: `Assets/`.

- [ ] **Step 1: Look at `Assets/` before committing anything from it**

Run: `ls -la Assets | head -40 && du -sh Assets`
Expected: screenshots from the operator's docx (`.png`). If any file is larger than 2 MB or is not an image, leave `Assets/` out of the commit and say so in the final report. Otherwise include it.

- [ ] **Step 2: Commit the workbench changes**

```bash
git add apps/web/next.config.ts apps/web/src/lib/firebase-client.ts deploy/ CLAUDE.md docs/roadmap/2026-09-12-mvp-por-pantallas.md docs/superpowers/specs/2026-09-14-admin-classes-levels-billing-coach-design.md docs/superpowers/plans/2026-09-14-admin-classes-levels-billing-coach.md
git add -u .codex/config.toml AGENTS.md
git add Assets   # only if Step 1 said so
git commit -m "chore(workbench): tailnet dev origins, emulator host overrides, compose sidecar, roadmap and the 2026-09-14 spec and plan"
```

- [ ] **Step 3: Create the working branch and materialise the sparse directories**

```bash
git checkout -b feature/admin-classes-billing-levels
git sparse-checkout add Lista Listav2 .cronos
ls Listav2/Listav2.data.js
```
Expected: the file exists. It stays materialised until Task 25 restores the sparse set.

- [ ] **Step 4: Baseline the suites you will be touching**

Run: `corepack pnpm vitest run --project node packages/domain/src/schedule apps/functions/src/schedule apps/functions/src/finance packages/domain/src/finance`
Expected: all green. Record the count; a later failure that is not yours must be visible here first.

Run: `corepack pnpm vitest run --project node qa/unit/listav2-ledger-sync.test.ts`
Expected: **FAILS** with "tasksv2.md declares T027V2, T028V2, T029V2, T030V2, T031V2 but Listav2 does not" and "uses statuses the board cannot render: T027V2=en curso …". This is the ledger drift Task 25 repairs; do not fix it now.

---

### Task 1: Age range, level range, description and labels (domain)

**Files:**
- Modify: `packages/domain/src/schedule/schedule-contracts.ts` (append after `parseListSessionsQuery`, before `CreateProgramInput`)
- Test: `packages/domain/src/schedule/schedule-contracts.test.ts` (append a `describe`)

**Interfaces:**
- Produces: `AgeRange`, `LevelRange`, `ageRangePresets`, `classDescriptionMaxLength`, `parseAgeRange`, `parseLevelRange`, `parseClassDescription`, `ageRangeLabel`, `levelRangeLabel` — all exported from `@bpt-jersey/domain/schedule`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/domain/src/schedule/schedule-contracts.test.ts` (extend the existing import from `./schedule-contracts`):

```ts
describe("class ranges and description", () => {
  it("parses an age range and rejects an inverted or absurd one", () => {
    expect(parseAgeRange({ minAge: 8, maxAge: 11 })).toEqual({ ok: true, value: { minAge: 8, maxAge: 11 } });
    expect(parseAgeRange({ minAge: 16, maxAge: null })).toEqual({ ok: true, value: { minAge: 16, maxAge: null } });
    expect(parseAgeRange({ minAge: 12, maxAge: 7 }).ok).toBe(false);
    expect(parseAgeRange({ minAge: 2, maxAge: null }).ok).toBe(false);
    expect(parseAgeRange({ minAge: 8, maxAge: 120 }).ok).toBe(false);
    expect(parseAgeRange({ minAge: 8.5, maxAge: 11 }).ok).toBe(false);
  });

  it("labels age ranges the way the card shows them", () => {
    expect(ageRangeLabel({ minAge: 8, maxAge: 11 })).toBe("Ages 8–11");
    expect(ageRangeLabel({ minAge: 16, maxAge: null })).toBe("Ages 16+");
    expect(ageRangeLabel(null)).toBe("All ages");
    expect(ageRangePresets.map((p) => p.label)).toEqual(["4–7", "8–11", "12–15", "16+"]);
  });

  it("parses a level range carrying its names", () => {
    const range = { fromKey: "adult-white", toKey: "adult-blue", fromName: "White", toName: "Blue" };
    expect(parseLevelRange(range)).toEqual({ ok: true, value: range });
    expect(parseLevelRange({ ...range, fromName: "" }).ok).toBe(false);
    expect(parseLevelRange({ ...range, toKey: "x".repeat(129) }).ok).toBe(false);
    expect(levelRangeLabel(range)).toBe("White → Blue");
    expect(levelRangeLabel({ ...range, toKey: "adult-white", toName: "White" })).toBe("White");
    expect(levelRangeLabel(null)).toBe("All levels");
  });

  it("accepts an empty description, trims it and caps it", () => {
    expect(parseClassDescription(undefined)).toEqual({ ok: true, value: "" });
    expect(parseClassDescription("  Gi only, bring a mouthguard. ")).toEqual({
      ok: true,
      value: "Gi only, bring a mouthguard.",
    });
    expect(parseClassDescription("a".repeat(classDescriptionMaxLength + 1)).ok).toBe(false);
    expect(parseClassDescription("bad" + String.fromCharCode(7) + "char").ok).toBe(false);
    expect(parseClassDescription(42).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run --project node packages/domain/src/schedule/schedule-contracts.test.ts -t "class ranges"`
Expected: FAIL — `parseAgeRange` is not exported.

- [ ] **Step 3: Implement**

Add to `schedule-contracts.ts` (reuse the file's existing `ok`, `err`, `Result`, `isRecord` helpers):

```ts
// ── Class ranges and description (2026-09-14) ──

export type AgeRange = Readonly<{ minAge: number; maxAge: number | null }>;
export type LevelRange = Readonly<{
  fromKey: string;
  toKey: string;
  fromName: string;
  toName: string;
}>;

export const classDescriptionMaxLength = 500;
export const ageRangeMinAge = 3;
export const ageRangeMaxAge = 99;

/** ponytail: the four bands the academy uses on the mat; the form also takes custom values. */
export const ageRangePresets = Object.freeze([
  Object.freeze({ label: "4–7", minAge: 4, maxAge: 7 }),
  Object.freeze({ label: "8–11", minAge: 8, maxAge: 11 }),
  Object.freeze({ label: "12–15", minAge: 12, maxAge: 15 }),
  Object.freeze({ label: "16+", minAge: 16, maxAge: null }),
] as const);

const levelKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

function isAge(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= ageRangeMinAge &&
    value <= ageRangeMaxAge
  );
}

export function parseAgeRange(input: unknown): Result<AgeRange, string> {
  if (!isRecord(input)) return err("ageRange must be an object");
  const { minAge, maxAge } = input;
  if (!isAge(minAge)) {
    return err(`minAge must be an integer between ${ageRangeMinAge} and ${ageRangeMaxAge}`);
  }
  if (maxAge !== null && !isAge(maxAge)) {
    return err(`maxAge must be null or an integer between ${ageRangeMinAge} and ${ageRangeMaxAge}`);
  }
  if (maxAge !== null && maxAge < minAge) return err("maxAge cannot be below minAge");
  return ok(Object.freeze({ minAge, maxAge: maxAge as number | null }));
}

function isLevelName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 80 &&
    !controlCharacterPattern.test(value)
  );
}

export function parseLevelRange(input: unknown): Result<LevelRange, string> {
  if (!isRecord(input)) return err("levelRange must be an object");
  const { fromKey, toKey, fromName, toName } = input;
  if (typeof fromKey !== "string" || !levelKeyPattern.test(fromKey)) {
    return err("Invalid levelRange.fromKey");
  }
  if (typeof toKey !== "string" || !levelKeyPattern.test(toKey)) {
    return err("Invalid levelRange.toKey");
  }
  if (!isLevelName(fromName) || !isLevelName(toName)) {
    return err("levelRange names must be 1 to 80 printable characters");
  }
  return ok(Object.freeze({ fromKey, toKey, fromName: fromName.trim(), toName: toName.trim() }));
}

export function parseClassDescription(input: unknown): Result<string, string> {
  if (input === undefined || input === null) return ok("");
  if (typeof input !== "string") return err("description must be a string");
  const trimmed = input.trim();
  if (trimmed.length > classDescriptionMaxLength) {
    return err(`description must be at most ${classDescriptionMaxLength} characters`);
  }
  if (controlCharacterPattern.test(trimmed)) return err("description contains control characters");
  return ok(trimmed);
}

export function ageRangeLabel(range: AgeRange | null | undefined): string {
  if (!range) return "All ages";
  return range.maxAge === null ? `Ages ${range.minAge}+` : `Ages ${range.minAge}–${range.maxAge}`;
}

export function levelRangeLabel(range: LevelRange | null | undefined): string {
  if (!range) return "All levels";
  return range.fromKey === range.toKey ? range.fromName : `${range.fromName} → ${range.toName}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm vitest run --project node packages/domain/src/schedule/schedule-contracts.test.ts -t "class ranges"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/schedule/schedule-contracts.ts packages/domain/src/schedule/schedule-contracts.test.ts
git commit -m "feat(domain): class age range, level range and description contracts"
```

---

### Task 2: Class record v2, recurrence rules, session additive fields and the new inputs (domain)

**Files:**
- Modify: `packages/domain/src/schedule/schedule-contracts.ts` — `ClassRecord`, `SessionRecord`, `CreateClassInput`, `UpdateClassInput`, `CreateSessionInput`, `parseCreateClassInput`, `parseUpdateClassInput`, `parseCreateSessionInput`; add `parseRecurrenceRules`, `normalizeClassRecord`, `UpdateSessionInput`, `parseUpdateSessionInput`, `RemoveClassInput`, `parseRemoveClassInput`.
- Test: `packages/domain/src/schedule/schedule-contracts.test.ts`.
- Compile fallout (fix in this task, no behaviour change): every `ClassRecord` literal and every `recurrenceRule` read. Find them with `grep -rn "recurrenceRule\b" --include='*.ts' --include='*.tsx' apps packages qa | grep -v node_modules`.

**Interfaces:**
- Produces: `ClassRecord` v2 shape (spec §5.1), `normalizeClassRecord(raw: unknown): ClassRecord`, `parseRecurrenceRules(input: unknown): Result<readonly ClassRecurrenceRule[], string>`, `maxRecurrenceRules = 7`, `UpdateSessionInput`, `parseUpdateSessionInput`, `RemoveClassInput`, `parseRemoveClassInput`, `classRemovalReasonMinLength = 2`, `classRemovalReasonMaxLength = 200`.
- `SessionRecord` gains optional `description?: string; ageRange?: AgeRange | null; levelRange?: LevelRange | null`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("class record v2", () => {
  const audit = {
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "u",
    updatedAt: "2026-09-01T00:00:00.000Z",
    updatedBy: "u",
  };
  const v1 = {
    classId: "c1", academyId: "a", programId: "p", locationId: "town", name: "Kids BJJ",
    recurrenceRule: { dayOfWeek: 1, startTime: "17:00", durationMinutes: 60 },
    instructorIds: ["coach-a"], capacity: 20, minParticipants: 4, active: true,
    schemaVersion: "1", ...audit,
  };

  it("normalises a v1 document into a one-rule v2 record", () => {
    expect(normalizeClassRecord(v1)).toEqual({
      classId: "c1", academyId: "a", programId: "p", locationId: "town", name: "Kids BJJ",
      recurrenceRules: [{ dayOfWeek: 1, startTime: "17:00", durationMinutes: 60 }],
      description: "", ageRange: null, levelRange: null,
      instructorIds: ["coach-a"], capacity: 20, minParticipants: 4, active: true,
      schemaVersion: "2", ...audit,
    });
  });

  it("returns a v2 document untouched and throws on garbage", () => {
    const v2 = normalizeClassRecord(v1);
    expect(normalizeClassRecord(v2)).toEqual(v2);
    expect(() => normalizeClassRecord(null)).toThrow();
    expect(() => normalizeClassRecord({ classId: "c" })).toThrow();
  });

  it("parses one to seven rules, sorted, and rejects a duplicate day and time", () => {
    const rules = [
      { dayOfWeek: 3, startTime: "18:00", durationMinutes: 60 },
      { dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 },
    ];
    const parsed = parseRecurrenceRules(rules);
    expect(parsed.ok && parsed.value.map((r) => r.dayOfWeek)).toEqual([1, 3]);
    expect(parseRecurrenceRules([]).ok).toBe(false);
    expect(parseRecurrenceRules([rules[0], rules[0]]).ok).toBe(false);
    const eight = Array.from({ length: 8 }, (_, i) => ({ ...rules[0]!, startTime: `0${i}:00` }));
    expect(parseRecurrenceRules(eight).ok).toBe(false);
  });

  it("creates a class with rules, ranges and description", () => {
    const parsed = parseCreateClassInput({
      programId: "p", locationId: "town", name: "Kids BJJ",
      recurrenceRules: [{ dayOfWeek: 1, startTime: "17:00", durationMinutes: 60 }],
      instructorIds: ["coach-a"], capacity: 20, minParticipants: 4,
      description: "Bring a gi.", ageRange: { minAge: 8, maxAge: 11 },
      levelRange: { fromKey: "k-white", toKey: "k-grey", fromName: "White", toName: "Grey" },
    });
    expect(parsed.ok && parsed.value.description).toBe("Bring a gi.");
    expect(parsed.ok && parsed.value.ageRange).toEqual({ minAge: 8, maxAge: 11 });
    const legacyShape = parseCreateClassInput({
      programId: "p", locationId: "town", name: "X1",
      recurrenceRule: { dayOfWeek: 1, startTime: "17:00", durationMinutes: 60 },
      instructorIds: ["c"], capacity: 5,
    });
    expect(legacyShape.ok).toBe(false);
  });

  it("updates rules and clears a range with null", () => {
    const parsed = parseUpdateClassInput({
      classId: "c1",
      recurrenceRules: [{ dayOfWeek: 2, startTime: "19:00", durationMinutes: 90 }],
      ageRange: null, levelRange: null, description: "",
    });
    expect(parsed.ok && parsed.value).toEqual({
      classId: "c1",
      recurrenceRules: [{ dayOfWeek: 2, startTime: "19:00", durationMinutes: 90 }],
      ageRange: null, levelRange: null, description: "",
    });
  });

  it("parses a session update and a class removal", () => {
    expect(parseUpdateSessionInput({ sessionId: "s1", title: "Open mat", capacity: 30 }).ok).toBe(true);
    expect(parseUpdateSessionInput({ sessionId: "s1" }).ok).toBe(false);
    expect(
      parseUpdateSessionInput({ sessionId: "s1", startAt: "2026-09-20T18:00:00Z", endAt: "2026-09-20T17:00:00Z" }).ok,
    ).toBe(false);
    expect(parseRemoveClassInput({ classId: "c1", reason: "Coach left" })).toEqual({
      ok: true,
      value: { classId: "c1", reason: "Coach left" },
    });
    expect(parseRemoveClassInput({ classId: "c1", reason: "x" }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project node packages/domain/src/schedule/schedule-contracts.test.ts -t "class record v2"`
Expected: FAIL — `normalizeClassRecord` is not exported.

- [ ] **Step 3: Change the records and inputs**

In `schedule-contracts.ts`:

```ts
export type ClassRecord = Readonly<{
  classId: string;
  academyId: string;
  programId: string;
  locationId: LocationId;
  name: string;
  recurrenceRules: readonly ClassRecurrenceRule[];
  description: string;
  ageRange: AgeRange | null;
  levelRange: LevelRange | null;
  instructorIds: readonly string[];
  capacity: number;
  minParticipants: number;
  active: boolean;
  schemaVersion: "2";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;
```

Add to `SessionRecord` (keep `schemaVersion: "1"`):

```ts
  // ponytail: additive on a v1 document; readers use `?? ""` / `?? null`.
  description?: string;
  ageRange?: AgeRange | null;
  levelRange?: LevelRange | null;
```

Inputs:

```ts
export type CreateClassInput = Readonly<{
  programId: string;
  locationId: LocationId;
  name: string;
  recurrenceRules: readonly ClassRecurrenceRule[];
  instructorIds: readonly string[];
  capacity: number;
  minParticipants?: number;
  description?: string;
  ageRange?: AgeRange | null;
  levelRange?: LevelRange | null;
}>;

export type UpdateClassInput = Readonly<{
  classId: string;
  name?: string;
  recurrenceRules?: readonly ClassRecurrenceRule[];
  instructorIds?: readonly string[];
  capacity?: number;
  minParticipants?: number;
  active?: boolean;
  description?: string;
  ageRange?: AgeRange | null;
  levelRange?: LevelRange | null;
}>;

// CreateSessionInput: add the same three optional fields.

export type UpdateSessionInput = Readonly<{
  sessionId: string;
  title?: string;
  instructorId?: string;
  startAt?: string;
  endAt?: string;
  capacity?: number;
  minParticipants?: number;
  description?: string;
}>;

export const classRemovalReasonMinLength = 2;
export const classRemovalReasonMaxLength = 200;
export type RemoveClassInput = Readonly<{ classId: string; reason: string }>;
```

Parsers (after `parseRecurrenceRule`):

```ts
export const maxRecurrenceRules = 7;

export function parseRecurrenceRules(
  input: unknown,
): Result<readonly ClassRecurrenceRule[], string> {
  if (!Array.isArray(input) || input.length === 0 || input.length > maxRecurrenceRules) {
    return err(`recurrenceRules must hold between 1 and ${maxRecurrenceRules} rules`);
  }
  const rules: ClassRecurrenceRule[] = [];
  for (const candidate of input) {
    const parsed = parseRecurrenceRule(candidate);
    if (!parsed.ok) return parsed;
    rules.push(parsed.value);
  }
  const keys = new Set(rules.map((rule) => `${rule.dayOfWeek}:${rule.startTime}`));
  if (keys.size !== rules.length) return err("recurrenceRules cannot repeat a day and start time");
  rules.sort(
    (left, right) =>
      left.dayOfWeek - right.dayOfWeek || left.startTime.localeCompare(right.startTime),
  );
  return ok(Object.freeze(rules));
}

/**
 * Reads a stored class of either schema. v1 documents carry one `recurrenceRule`; they are
 * presented as v2 with one rule and empty description/ranges. Nothing is written back until the
 * class is edited.
 */
export function normalizeClassRecord(raw: unknown): ClassRecord {
  if (!isRecord(raw) || typeof raw.classId !== "string" || typeof raw.name !== "string") {
    throw new Error("Stored class record is invalid");
  }
  const rules =
    raw.schemaVersion === "2" && Array.isArray(raw.recurrenceRules)
      ? raw.recurrenceRules
      : [raw.recurrenceRule];
  const parsedRules = parseRecurrenceRules(rules);
  if (!parsedRules.ok) throw new Error(`Stored class record is invalid: ${parsedRules.error}`);
  const ageRange =
    raw.ageRange === undefined || raw.ageRange === null ? null : parseAgeRange(raw.ageRange);
  const levelRange =
    raw.levelRange === undefined || raw.levelRange === null ? null : parseLevelRange(raw.levelRange);
  if ((ageRange && !ageRange.ok) || (levelRange && !levelRange.ok)) {
    throw new Error("Stored class record is invalid");
  }
  const description = parseClassDescription(raw.description);
  const { recurrenceRule: _legacy, recurrenceRules: _rules, ...rest } = raw;
  return Object.freeze({
    ...(rest as Omit<
      ClassRecord,
      "recurrenceRules" | "description" | "ageRange" | "levelRange" | "schemaVersion"
    >),
    recurrenceRules: parsedRules.value,
    description: description.ok ? description.value : "",
    ageRange: ageRange ? ageRange.value : null,
    levelRange: levelRange ? levelRange.value : null,
    schemaVersion: "2" as const,
  });
}
```

`parseCreateClassInput`: destructure `recurrenceRules, description, ageRange, levelRange` instead of `recurrenceRule`; call `parseRecurrenceRules`; then:

```ts
  const descriptionResult = parseClassDescription(description);
  if (!descriptionResult.ok) return err(descriptionResult.error);
  let parsedAgeRange: AgeRange | null = null;
  if (ageRange !== undefined && ageRange !== null) {
    const result = parseAgeRange(ageRange);
    if (!result.ok) return err(result.error);
    parsedAgeRange = result.value;
  }
  let parsedLevelRange: LevelRange | null = null;
  if (levelRange !== undefined && levelRange !== null) {
    const result = parseLevelRange(levelRange);
    if (!result.ok) return err(result.error);
    parsedLevelRange = result.value;
  }
  // returned object gains:
  //   recurrenceRules: rulesResult.value, description: descriptionResult.value,
  //   ageRange: parsedAgeRange, levelRange: parsedLevelRange,
```

`parseUpdateClassInput`: extend the "at least one field" check with the four new fields; parse `recurrenceRules` with `parseRecurrenceRules` when present; `description` with `parseClassDescription`; `ageRange`/`levelRange` when present and not `null` with their parsers, and copy `null` through as "clear". Extend the local `result` type with the four optional keys.

`parseCreateSessionInput`: accept the three optional fields the same way and spread them into the frozen output only when provided.

Add `parseUpdateSessionInput` and `parseRemoveClassInput`:

```ts
export function parseUpdateSessionInput(input: unknown): Result<UpdateSessionInput, string> {
  if (!isRecord(input)) return err("Session update input must be an object");
  const { sessionId, title, instructorId, startAt, endAt, capacity, minParticipants, description } =
    input;
  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return err("sessionId is required");
  }
  if (
    [title, instructorId, startAt, endAt, capacity, minParticipants, description].every(
      (value) => value === undefined,
    )
  ) {
    return err("At least one session field must be updated");
  }
  if (
    title !== undefined &&
    (typeof title !== "string" || title.trim().length < 2 || title.trim().length > 120)
  ) {
    return err("title must be between 2 and 120 characters");
  }
  if (
    instructorId !== undefined &&
    (typeof instructorId !== "string" || instructorId.trim().length === 0)
  ) {
    return err("instructorId must be a non-empty string");
  }
  if (startAt !== undefined && !isIsoDate(startAt)) {
    return err("startAt must be a valid ISO 8601 UTC date");
  }
  if (endAt !== undefined && !isIsoDate(endAt)) return err("endAt must be a valid ISO 8601 UTC date");
  if (
    typeof startAt === "string" &&
    typeof endAt === "string" &&
    Date.parse(endAt) <= Date.parse(startAt)
  ) {
    return err("endAt must be strictly after startAt");
  }
  if (
    capacity !== undefined &&
    (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity < 1 || capacity > 300)
  ) {
    return err("capacity must be an integer between 1 and 300");
  }
  if (
    minParticipants !== undefined &&
    (typeof minParticipants !== "number" ||
      !Number.isInteger(minParticipants) ||
      minParticipants < 0 ||
      minParticipants > 300)
  ) {
    return err("minParticipants must be an integer between 0 and 300");
  }
  if (
    typeof capacity === "number" &&
    typeof minParticipants === "number" &&
    minParticipants > capacity
  ) {
    return err("minParticipants cannot exceed capacity");
  }
  const descriptionResult =
    description === undefined ? undefined : parseClassDescription(description);
  if (descriptionResult && !descriptionResult.ok) return err(descriptionResult.error);
  const result: { -readonly [K in keyof UpdateSessionInput]: UpdateSessionInput[K] } = {
    sessionId: sessionId.trim(),
  };
  if (typeof title === "string") result.title = title.trim();
  if (typeof instructorId === "string") result.instructorId = instructorId.trim();
  if (typeof startAt === "string") result.startAt = startAt;
  if (typeof endAt === "string") result.endAt = endAt;
  if (typeof capacity === "number") result.capacity = capacity;
  if (typeof minParticipants === "number") result.minParticipants = minParticipants;
  if (descriptionResult) result.description = descriptionResult.value;
  return ok(Object.freeze(result));
}

export function parseRemoveClassInput(input: unknown): Result<RemoveClassInput, string> {
  if (!isRecord(input)) return err("Class removal input must be an object");
  const { classId, reason } = input;
  if (typeof classId !== "string" || classId.trim().length === 0) return err("classId is required");
  if (
    typeof reason !== "string" ||
    reason.trim().length < classRemovalReasonMinLength ||
    reason.trim().length > classRemovalReasonMaxLength ||
    controlCharacterPattern.test(reason)
  ) {
    return err(
      `reason must be between ${classRemovalReasonMinLength} and ${classRemovalReasonMaxLength} characters`,
    );
  }
  return ok(Object.freeze({ classId: classId.trim(), reason: reason.trim() }));
}
```

- [ ] **Step 4: Fix every compile site that still reads `recurrenceRule` or builds a v1 `ClassRecord`**

Run: `grep -rn "recurrenceRule\b" --include='*.ts' --include='*.tsx' apps packages qa | grep -v node_modules`

For each hit that is a `ClassRecord` (not a session): replace `recurrenceRule: {…}` with `recurrenceRules: [{…}]`, add `description: ""`, `ageRange: null`, `levelRange: null`, and `schemaVersion: "2"`. In `apps/web/src/app/admin/classes/page.tsx` make `newClassDraft` and the table compile by reading `record.recurrenceRules[0]!` for now (Task 7 and Task 9 replace them). In `generateSessionsFromClass` read `classRecord.recurrenceRules[0]!` temporarily; Task 3 replaces it.

Run: `corepack pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run --project node packages/domain/src/schedule apps/functions/src/schedule && corepack pnpm vitest run --project web apps/web/src/app/admin/classes`
Expected: the new `describe` passes; every previously passing test still passes (existing class tests now use the v2 literals).

- [ ] **Step 6: Commit**

```bash
git add -A packages/domain/src/schedule apps/functions/src/schedule apps/web/src/app/admin/classes apps/web/src/app/coach qa/tests
git commit -m "feat(domain): class record v2 with weekly rules, ranges and description; session update and class removal inputs"
```

---

### Task 3: Multi-rule session generation with legacy id skip (domain)

**Files:**
- Modify: `packages/domain/src/schedule/schedule-contracts.ts` — `generateSessionsFromClass`; add `sessionIdFor`, `legacySessionId`.
- Test: `packages/domain/src/schedule/schedule-contracts.test.ts`.

**Interfaces:**
- Produces: `generateSessionsFromClass(classRecord, fromDate, toDate, timezone)` iterates `recurrenceRules`; drafts carry `description`, `ageRange`, `levelRange`. `sessionIdFor(classId, localDate, startTime)` → `${classId}__${localDate}__${HHmm}`. `legacySessionId(classId, localDate)` → `${classId}__${localDate}`.

- [ ] **Step 1: Write the failing test**

```ts
describe("multi-rule session generation", () => {
  const cls = normalizeClassRecord({
    classId: "c1", academyId: "a", programId: "p", locationId: "town", name: "Kids BJJ",
    recurrenceRules: [
      { dayOfWeek: 1, startTime: "17:00", durationMinutes: 60 },
      { dayOfWeek: 3, startTime: "18:30", durationMinutes: 45 },
    ],
    description: "Bring a gi.", ageRange: { minAge: 8, maxAge: 11 }, levelRange: null,
    instructorIds: ["coach-a", "coach-b"], capacity: 20, minParticipants: 4, active: true,
    schemaVersion: "2",
    createdAt: "2026-09-01T00:00:00.000Z", createdBy: "u",
    updatedAt: "2026-09-01T00:00:00.000Z", updatedBy: "u",
  });

  it("emits one session per rule occurrence with the rule's own time and length", () => {
    // 2026-09-14 is a Monday; the week holds Mon 14 and Wed 16. Jersey is UTC+1 in September.
    const drafts = generateSessionsFromClass(cls, "2026-09-14", "2026-09-20", "Europe/Jersey");
    expect(drafts.map((d) => d.sessionId)).toEqual(["c1__2026-09-14__1700", "c1__2026-09-16__1830"]);
    expect(drafts[0]).toMatchObject({
      startAt: "2026-09-14T16:00:00Z", endAt: "2026-09-14T17:00:00Z", instructorId: "coach-a",
      description: "Bring a gi.", ageRange: { minAge: 8, maxAge: 11 }, levelRange: null,
    });
    expect(drafts[1]).toMatchObject({ startAt: "2026-09-16T17:30:00Z", endAt: "2026-09-16T18:15:00Z" });
    expect(legacySessionId("c1", "2026-09-14")).toBe("c1__2026-09-14");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run --project node packages/domain/src/schedule/schedule-contracts.test.ts -t "multi-rule"`
Expected: FAIL (`legacySessionId` not exported; ids differ).

- [ ] **Step 3: Implement**

```ts
export function sessionIdFor(classId: string, localDate: string, startTime: string): string {
  return `${classId}__${localDate}__${startTime.replace(":", "")}`;
}

/** The id a v1 (single-rule) class produced. Stores skip a draft when this id already exists. */
export function legacySessionId(classId: string, localDate: string): string {
  return `${classId}__${localDate}`;
}

export function generateSessionsFromClass(
  classRecord: ClassRecord,
  fromDate: string,
  toDate: string,
  timezone: string,
): Omit<SessionRecord, "createdAt" | "createdBy" | "updatedAt" | "updatedBy">[] {
  const {
    recurrenceRules, classId, academyId, programId, locationId, instructorIds,
    capacity, minParticipants, name, description, ageRange, levelRange,
  } = classRecord;
  const sessions: Omit<SessionRecord, "createdAt" | "createdBy" | "updatedAt" | "updatedBy">[] = [];
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T23:59:59Z`);
  const current = new Date(from);
  while (current <= to) {
    const jsDay = current.getUTCDay();
    const isoDay = jsDay === 0 ? 7 : jsDay;
    const localDateStr = current.toISOString().slice(0, 10);
    for (const rule of recurrenceRules) {
      if (rule.dayOfWeek !== isoDay) continue;
      const [startHour = 0, startMinute = 0] = rule.startTime.split(":").map(Number);
      const startUtc = localToUtc(localDateStr, startHour, startMinute, timezone);
      const endUtc = new Date(startUtc.getTime() + rule.durationMinutes * 60 * 1000);
      sessions.push(
        Object.freeze({
          sessionId: sessionIdFor(classId, localDateStr, rule.startTime),
          academyId, classId, programId, locationId,
          instructorId: instructorIds[0] ?? "",
          title: name,
          startAt: endWithZ(startUtc),
          endAt: endWithZ(endUtc),
          capacity, minParticipants,
          status: "scheduled" as const,
          isSeminar: false,
          cancellationReason: null,
          schemaVersion: "1" as const,
          description, ageRange, levelRange,
        }),
      );
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return sessions;
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project node packages/domain/src/schedule apps/functions/src/schedule`
Expected: PASS. If an older generation test asserted the id without the time suffix, update that assertion — the new id format is the decision (spec §5.1).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/schedule apps/functions/src/schedule
git commit -m "feat(domain): generate sessions for every weekly rule, with description and ranges"
```

---

### Task 4: Schedule store — normalised reads, session update, class removal, booked counts (functions)

**Files:**
- Modify: `apps/functions/src/schedule/schedule-service.ts` — `ScheduleStore` type (around line 150), Firestore store (`createFirestoreScheduleStore`, ~line 377 onward: `listClasses`, `getClass`, `createClass`, `updateClass`, `generateSessions`, `listSessions`, `getSession`) and in-memory store (`createInMemoryScheduleStore`, ~line 1103 onward, same methods).
- Test: `apps/functions/src/schedule/schedule-service.test.ts` (append a `describe` using `createInMemoryScheduleStore`).

**Interfaces:**
- Consumes: Task 2/3 domain (`normalizeClassRecord`, `UpdateSessionInput`, `legacySessionId`).
- Produces on `ScheduleStore`:
  - `updateSession(academyId: string, input: UpdateSessionInput, actorId: string): Promise<SessionRecord>` — throws `Error("Session … does not exist")` or `Error("Only scheduled sessions can be edited")`.
  - `removeClass(academyId: string, classId: string, reason: string, actorId: string, nowIso: string): Promise<{ class: ClassRecord; cancelledSessions: readonly SessionRecord[] }>`.
  - `countConfirmedBookings(academyId: string, sessionIds: readonly string[]): Promise<Readonly<Record<string, number>>>`.

- [ ] **Step 1: Write the failing tests**

Append to `schedule-service.test.ts` (reuse the file's existing helpers for creating a program/class if any; otherwise the literal below):

```ts
describe("schedule store: v2 classes, session edits, class removal and booked counts", () => {
  const academyId = "demo-academy";
  const classInput = {
    programId: "program-1",
    locationId: "town" as const,
    name: "Kids BJJ",
    recurrenceRules: [
      { dayOfWeek: 1 as const, startTime: "17:00", durationMinutes: 60 },
      { dayOfWeek: 3 as const, startTime: "17:00", durationMinutes: 60 },
    ],
    instructorIds: ["coach-a"],
    capacity: 20,
    minParticipants: 4,
    description: "Bring a gi.",
    ageRange: { minAge: 8, maxAge: 11 },
    levelRange: null,
  };

  it("creates a v2 class and generates a session per rule", async () => {
    const store = createInMemoryScheduleStore();
    const created = await store.createClass(academyId, classInput, "owner-1");
    expect(created.schemaVersion).toBe("2");
    expect(created.recurrenceRules).toHaveLength(2);
    const sessions = await store.generateSessions(academyId, created.classId, "2026-09-14", "2026-09-20", "Europe/Jersey", "owner-1");
    expect(sessions.map((s) => s.sessionId)).toEqual([
      `${created.classId}__2026-09-14__1700`,
      `${created.classId}__2026-09-16__1700`,
    ]);
    expect(sessions[0]?.description).toBe("Bring a gi.");
  });

  it("does not duplicate a session a v1 class already generated under the legacy id", async () => {
    const store = createInMemoryScheduleStore();
    const created = await store.createClass(academyId, classInput, "owner-1");
    await store.createSession(
      academyId,
      { programId: "program-1", locationId: "town", instructorId: "coach-a", title: "Kids BJJ", startAt: "2026-09-14T16:00:00Z", endAt: "2026-09-14T17:00:00Z", capacity: 20, classId: created.classId },
      "owner-1",
    );
    // Plant the legacy id the way a v1 generation would have.
    const legacy = (await store.listSessions(academyId, { from: "2026-09-14T00:00:00.000Z", to: "2026-09-14T23:59:59.999Z" }))[0]!;
    await store.__seedSessionId?.(academyId, legacy, `${created.classId}__2026-09-14`);
    const sessions = await store.generateSessions(academyId, created.classId, "2026-09-14", "2026-09-14", "Europe/Jersey", "owner-1");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe(`${created.classId}__2026-09-14`);
  });

  it("edits only scheduled sessions and keeps end after start", async () => {
    const store = createInMemoryScheduleStore();
    const session = await store.createSession(
      academyId,
      { programId: "program-1", locationId: "town", instructorId: "coach-a", title: "Open mat", startAt: "2026-09-20T10:00:00Z", endAt: "2026-09-20T11:00:00Z", capacity: 20 },
      "owner-1",
    );
    const updated = await store.updateSession(academyId, { sessionId: session.sessionId, title: "Open mat (Gi)", endAt: "2026-09-20T11:30:00Z", description: "All belts." }, "owner-1");
    expect(updated).toMatchObject({ title: "Open mat (Gi)", endAt: "2026-09-20T11:30:00Z", description: "All belts.", updatedBy: "owner-1" });
    await expect(store.updateSession(academyId, { sessionId: session.sessionId, startAt: "2026-09-20T12:00:00Z" }, "owner-1")).rejects.toThrow(/after/u);
    await store.cancelSession(academyId, session.sessionId, "Coach ill", "owner-1");
    await expect(store.updateSession(academyId, { sessionId: session.sessionId, title: "X" }, "owner-1")).rejects.toThrow(/scheduled/u);
  });

  it("removes a class: inactive, future sessions cancelled, past ones untouched", async () => {
    const store = createInMemoryScheduleStore();
    const created = await store.createClass(academyId, classInput, "owner-1");
    await store.generateSessions(academyId, created.classId, "2026-09-07", "2026-09-20", "Europe/Jersey", "owner-1");
    const result = await store.removeClass(academyId, created.classId, "Coach left", "owner-1", "2026-09-13T12:00:00.000Z");
    expect(result.class.active).toBe(false);
    expect(result.cancelledSessions.map((s) => s.sessionId).sort()).toEqual([
      `${created.classId}__2026-09-14__1700`,
      `${created.classId}__2026-09-16__1700`,
    ]);
    const all = await store.listSessions(academyId, { from: "2026-09-01T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z" });
    expect(all.find((s) => s.sessionId === `${created.classId}__2026-09-07__1700`)?.status).toBe("scheduled");
    expect(all.find((s) => s.sessionId === `${created.classId}__2026-09-14__1700`)).toMatchObject({ status: "cancelled", cancellationReason: "Coach left" });
  });

  it("counts confirmed bookings per session", async () => {
    const store = createInMemoryScheduleStore();
    const session = await store.createSession(
      academyId,
      { programId: "program-1", locationId: "town", instructorId: "coach-a", title: "Adults", startAt: "2099-01-05T18:00:00Z", endAt: "2099-01-05T19:00:00Z", capacity: 20 },
      "owner-1",
    );
    await store.requestBooking(academyId, { sessionId: session.sessionId, studentId: "s-1", membershipId: "m-1" }, "s-1");
    const counts = await store.countConfirmedBookings(academyId, [session.sessionId, "missing"]);
    expect(counts).toEqual({ [session.sessionId]: 1, missing: 0 });
  });
});
```

Note on the legacy-id test: the in-memory store needs a tiny test-only hook `__seedSessionId(academyId, session, id)` that stores a copy of `session` under `id`. Add it to the in-memory store only (not to the `ScheduleStore` type; declare it as an optional property on the returned object and access it with `?.` as above). If `requestBooking` in the in-memory store returns `requested` rather than `confirmed` for a bookable session, use whatever status it does return and count that status as well as `confirmed` only if the existing `evaluateSessionMinimum` does — mirror `evaluateSessionMinimum`, which counts `confirmed` only.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule/schedule-service.test.ts -t "v2 classes"`
Expected: FAIL — `updateSession is not a function`, ids without suffix, etc.

- [ ] **Step 3: Extend the `ScheduleStore` type**

```ts
  updateSession: (
    academyId: string,
    input: UpdateSessionInput,
    actorId: string,
  ) => Promise<SessionRecord>;
  removeClass: (
    academyId: string,
    classId: string,
    reason: string,
    actorId: string,
    nowIso: string,
  ) => Promise<Readonly<{ class: ClassRecord; cancelledSessions: readonly SessionRecord[] }>>;
  countConfirmedBookings: (
    academyId: string,
    sessionIds: readonly string[],
  ) => Promise<Readonly<Record<string, number>>>;
```

Import `UpdateSessionInput`, `normalizeClassRecord`, `legacySessionId` from `@bpt-jersey/domain/schedule`.

- [ ] **Step 4: Implement in the Firestore store**

- `listClasses`: `snapshot.docs.map((doc) => normalizeClassRecord(doc.data()))`.
- `getClass`: `doc.exists ? normalizeClassRecord(doc.data()) : null`.
- `createClass`: write `recurrenceRules: input.recurrenceRules, description: input.description ?? "", ageRange: input.ageRange ?? null, levelRange: input.levelRange ?? null, schemaVersion: "2"`.
- `updateClass`: `const current = normalizeClassRecord(existing.data());` and merge `recurrenceRules`, `description`, `ageRange`, `levelRange` (`input.x === undefined ? current.x : input.x`); keep the min/capacity check.
- `generateSessions`: `const cls = normalizeClassRecord(existing.data());` and inside the loop, before creating:

```ts
        const legacyRef = firestore
          .collection(`academies/${academyId}/sessions`)
          .doc(legacySessionId(cls.classId, draft.startAt.slice(0, 10)));
        // ponytail: a v1 class generated `${classId}__${date}`; keep that document instead of a twin.
        const [existingSession, legacySession] = await Promise.all([sessionRef.get(), legacyRef.get()]);
        if (existingSession.exists) created.push(existingSession.data() as SessionRecord);
        else if (legacySession.exists) created.push(legacySession.data() as SessionRecord);
        else { /* existing create path */ }
```

  The legacy date must be the *local* date the draft was generated for. `draft.startAt.slice(0, 10)` is the UTC date, which differs from the Jersey date only for sessions starting between 00:00 and 01:00 local in summer; to be exact, change the generator to also return nothing new and compute the legacy id as `legacySessionId(cls.classId, draft.sessionId.split("__")[1]!)` — the second segment of the new id is the local date. Use that.

- New methods:

```ts
    async updateSession(academyId, input, actorId) {
      const docRef = firestore.collection(`academies/${academyId}/sessions`).doc(input.sessionId);
      const existing = await docRef.get();
      if (!existing.exists) throw new Error(`Session ${input.sessionId} does not exist`);
      const current = existing.data() as SessionRecord;
      if (current.status !== "scheduled") throw new Error("Only scheduled sessions can be edited");
      const updated = mergeSessionUpdate(current, input, actorId, new Date().toISOString());
      await docRef.set(updated);
      return updated;
    },

    async removeClass(academyId, classId, reason, actorId, nowIso) {
      const classRef = firestore.collection(`academies/${academyId}/classes`).doc(classId);
      const existing = await classRef.get();
      if (!existing.exists) throw new Error(`Class ${classId} does not exist`);
      const current = normalizeClassRecord(existing.data());
      const retired: ClassRecord = Object.freeze({ ...current, active: false, updatedAt: nowIso, updatedBy: actorId });
      await classRef.set(retired);
      const snapshot = await firestore
        .collection(`academies/${academyId}/sessions`)
        .where("classId", "==", classId)
        .get();
      const cancelled: SessionRecord[] = [];
      for (const doc of snapshot.docs) {
        const session = doc.data() as SessionRecord;
        if ((session.status !== "scheduled" && session.status !== "active") || session.startAt < nowIso) continue;
        const next: SessionRecord = Object.freeze({ ...session, status: "cancelled", cancellationReason: reason, updatedAt: nowIso, updatedBy: actorId });
        await doc.ref.set(next);
        cancelled.push(next);
      }
      return Object.freeze({ class: retired, cancelledSessions: Object.freeze(cancelled) });
    },

    async countConfirmedBookings(academyId, sessionIds) {
      const counts: Record<string, number> = Object.fromEntries(sessionIds.map((id) => [id, 0]));
      const unique = [...new Set(sessionIds)];
      // ponytail: Firestore `in` takes 30 values; two weeks of sessions is under that most days.
      for (let index = 0; index < unique.length; index += 30) {
        const chunk = unique.slice(index, index + 30);
        const snapshot = await firestore
          .collection(`academies/${academyId}/bookings`)
          .where("sessionId", "in", chunk)
          .where("status", "==", "confirmed")
          .get();
        for (const doc of snapshot.docs) {
          const booking = doc.data() as BookingRecord;
          counts[booking.sessionId] = (counts[booking.sessionId] ?? 0) + 1;
        }
      }
      return Object.freeze(counts);
    },
```

Shared module-level helper (used by both stores):

```ts
function mergeSessionUpdate(
  current: SessionRecord,
  input: UpdateSessionInput,
  actorId: string,
  now: string,
): SessionRecord {
  const startAt = input.startAt ?? current.startAt;
  const endAt = input.endAt ?? current.endAt;
  if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error("Session must end after it starts");
  const capacity = input.capacity ?? current.capacity;
  const minParticipants = input.minParticipants ?? current.minParticipants;
  if (minParticipants > capacity) throw new Error("Session minimum participants cannot exceed capacity");
  return Object.freeze({
    ...current,
    title: input.title ?? current.title,
    instructorId: input.instructorId ?? current.instructorId,
    startAt,
    endAt,
    capacity,
    minParticipants,
    ...(input.description !== undefined ? { description: input.description } : {}),
    updatedAt: now,
    updatedBy: actorId,
  });
}
```

- [ ] **Step 5: Implement in the in-memory store**

Same semantics against the maps (`classesMap`, `sessionsMap`, `bookingsMap`): normalise on read in `listClasses`/`getClass`/`updateClass`/`generateSessions` (records are already v2 there, but `normalizeClassRecord` keeps both stores identical); `generateSessions` checks `aSessions.has(draft.sessionId) || aSessions.has(legacySessionId(...))`; `updateSession`/`removeClass`/`countConfirmedBookings` mirror the Firestore versions; add the `__seedSessionId` test hook.

- [ ] **Step 6: Run the tests**

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule`
Expected: PASS, including `schedule-security-boundary.test.ts` when run alone if it flaked.

- [ ] **Step 7: Commit**

```bash
git add apps/functions/src/schedule/schedule-service.ts apps/functions/src/schedule/schedule-service.test.ts
git commit -m "feat(functions): schedule store reads v2 classes, edits sessions, removes classes and counts bookings"
```

---

### Task 5: Callables `updateSession`, `removeClass`, `listSessionBookedCounts` (functions)

**Files:**
- Modify: `apps/functions/src/schedule/schedule-callables.ts` (add three handler factories after `createCancelSessionHandler` and three `onCall` exports at the bottom), `apps/functions/src/index.ts` (add the three names to the schedule export list).
- Test: `apps/functions/src/schedule/schedule-callables.test.ts`.

**Interfaces:**
- Produces callables:
  - `updateSession` — roles `managerRoles`; payload `UpdateSessionInput`; response `{ session: SessionRecord }`.
  - `removeClass` — roles `managerRoles`; payload `RemoveClassInput`; response `{ class: ClassRecord; cancelledSessions: SessionRecord[] }`.
  - `listSessionBookedCounts` — any authenticated user (`requireUserActor` only, like `listSessions`); payload `ListSessionsQuery`; response `{ counts: Record<string, number> }`.

- [ ] **Step 1: Write the failing tests**

```ts
import {
  createListSessionBookedCountsHandler,
  createRemoveClassHandler,
  createUpdateSessionHandler,
} from "./schedule-callables";

describe("session update, class removal and booked counts callables", () => {
  const classInput = {
    programId: "program-1", locationId: "town", name: "Kids BJJ",
    recurrenceRules: [{ dayOfWeek: 1, startTime: "17:00", durationMinutes: 60 }],
    instructorIds: ["coach-a"], capacity: 20,
  };

  it("lets a head coach edit a scheduled session and refuses a coach", async () => {
    const store = createInMemoryScheduleStore();
    const session = await store.createSession("demo-academy", { programId: "program-1", locationId: "town", instructorId: "coach-a", title: "Adults", startAt: "2099-01-05T18:00:00Z", endAt: "2099-01-05T19:00:00Z", capacity: 20 }, "owner-1");
    const handler = createUpdateSessionHandler({ store });
    const result = await handler(fakeRequest({ sessionId: session.sessionId, title: "Adults Gi" }, "headCoach"));
    expect(result.session.title).toBe("Adults Gi");
    await expect(handler(fakeRequest({ sessionId: session.sessionId, title: "X" }, "coach"))).rejects.toMatchObject({ code: "permission-denied" });
    await expect(handler(fakeRequest({ sessionId: session.sessionId }, "owner"))).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("removes a class for a manager and reports the cancelled sessions", async () => {
    const store = createInMemoryScheduleStore();
    const created = await store.createClass("demo-academy", classInput, "owner-1");
    await store.generateSessions("demo-academy", created.classId, "2099-01-04", "2099-01-10", "Europe/Jersey", "owner-1");
    const handler = createRemoveClassHandler({ store, now: () => "2099-01-01T00:00:00.000Z" });
    const result = await handler(fakeRequest({ classId: created.classId, reason: "Coach left" }, "administrator"));
    expect(result.class.active).toBe(false);
    expect(result.cancelledSessions).toHaveLength(1);
    await expect(handler(fakeRequest({ classId: created.classId, reason: "Coach left" }, "coach"))).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("returns booked counts for any signed-in user and rejects anonymous calls", async () => {
    const store = createInMemoryScheduleStore();
    const session = await store.createSession("demo-academy", { programId: "program-1", locationId: "town", instructorId: "coach-a", title: "Adults", startAt: "2099-01-05T18:00:00Z", endAt: "2099-01-05T19:00:00Z", capacity: 20 }, "owner-1");
    await store.requestBooking("demo-academy", { sessionId: session.sessionId, studentId: "s-1", membershipId: "m-1" }, "s-1");
    const handler = createListSessionBookedCountsHandler({ store });
    const result = await handler(fakeRequest({ from: "2099-01-01T00:00:00.000Z", to: "2099-01-31T00:00:00.000Z" }, "adultStudent", "s-1"));
    expect(result.counts).toEqual({ [session.sessionId]: 1 });
    await expect(handler(fakeRequest({ from: "2099-01-01T00:00:00.000Z", to: "2099-01-31T00:00:00.000Z" }, "owner", null))).rejects.toMatchObject({ code: "unauthenticated" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule/schedule-callables.test.ts -t "session update"`
Expected: FAIL — handlers not exported.

- [ ] **Step 3: Implement the handlers**

```ts
export function createUpdateSessionHandler(options: { store: ScheduleStore }) {
  const { store } = options;
  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!managerRoles.includes(actor.role as (typeof managerRoles)[number])) {
      throw new HttpsError("permission-denied", "Manager access required to edit sessions");
    }
    const parsed = parseUpdateSessionInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    try {
      return { session: await store.updateSession(actor.academyId, parsed.value, actor.userId) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/does not exist/u.test(message)) throw new HttpsError("not-found", "Session not found");
      throw new HttpsError("failed-precondition", "Session cannot be edited in its current state");
    }
  };
}

export function createRemoveClassHandler(options: { store: ScheduleStore; now?: () => string }) {
  const { store } = options;
  const now = options.now ?? (() => new Date().toISOString());
  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!managerRoles.includes(actor.role as (typeof managerRoles)[number])) {
      throw new HttpsError("permission-denied", "Manager access required to remove classes");
    }
    const parsed = parseRemoveClassInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    try {
      return await store.removeClass(actor.academyId, parsed.value.classId, parsed.value.reason, actor.userId, now());
    } catch {
      throw new HttpsError("not-found", "Class not found");
    }
  };
}

export function createListSessionBookedCountsHandler(options: { store: ScheduleStore }) {
  const { store } = options;
  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const parsed = parseListSessionsQuery(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    const sessions = await store.listSessions(actor.academyId, parsed.value);
    const counts = await store.countConfirmedBookings(actor.academyId, sessions.map((session) => session.sessionId));
    return { counts };
  };
}
```

Exports at the bottom, next to `cancelSession`:

```ts
export const updateSession = onCall(scheduleCallableOptions, async (request) =>
  createUpdateSessionHandler({ store: getStore() })(request),
);
export const removeClass = onCall(scheduleCallableOptions, async (request) =>
  createRemoveClassHandler({ store: getStore() })(request),
);
export const listSessionBookedCounts = onCall(scheduleCallableOptions, async (request) =>
  createListSessionBookedCountsHandler({ store: getStore() })(request),
);
```

`apps/functions/src/index.ts`: add `updateSession`, `removeClass`, `listSessionBookedCounts` to the `./schedule/schedule-callables.js` export list (alphabetical within the list, matching the file's style).

- [ ] **Step 4: Run the tests and typecheck**

Run: `corepack pnpm vitest run --project node apps/functions/src/schedule && corepack pnpm --filter @bpt-jersey/functions typecheck`
Expected: PASS; if `parseListSessionsQuery` requires `from`/`to` only, the test payload above is valid.

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/schedule apps/functions/src/index.ts
git commit -m "feat(functions): updateSession, removeClass and listSessionBookedCounts callables"
```

---

### Task 6: Schedule web client (web)

**Files:**
- Modify: `apps/web/src/lib/schedule-client.ts` (after `cancelSession`).
- Test: `apps/web/src/lib/schedule-client.test.ts` (follow the file's existing `vi.mock("firebase/functions")` pattern for `httpsCallable`).

**Interfaces:**
- Produces: `updateSession(input: UpdateSessionInput): Promise<SessionRecord>`, `removeClass(input: RemoveClassInput): Promise<{ class: ClassRecord; cancelledSessions: readonly SessionRecord[] }>`, `listSessionBookedCounts(query: ListSessionsQuery): Promise<Readonly<Record<string, number>>>`.

- [ ] **Step 1: Write the failing tests**

```ts
it("calls updateSession, removeClass and listSessionBookedCounts by name", async () => {
  callable.mockResolvedValueOnce({ data: { session: { sessionId: "s1" } } });
  await expect(updateSession({ sessionId: "s1", title: "Adults Gi" })).resolves.toEqual({ sessionId: "s1" });
  expect(httpsCallable).toHaveBeenLastCalledWith(expect.anything(), "updateSession", { limitedUseAppCheckTokens: true });

  callable.mockResolvedValueOnce({ data: { class: { classId: "c1" }, cancelledSessions: [] } });
  await expect(removeClass({ classId: "c1", reason: "Coach left" })).resolves.toEqual({ class: { classId: "c1" }, cancelledSessions: [] });
  expect(httpsCallable).toHaveBeenLastCalledWith(expect.anything(), "removeClass", { limitedUseAppCheckTokens: true });

  callable.mockResolvedValueOnce({ data: { counts: { s1: 2, s2: 0 } } });
  await expect(listSessionBookedCounts({ from: "2026-09-14T00:00:00.000Z", to: "2026-09-20T23:59:59.999Z" })).resolves.toEqual({ s1: 2, s2: 0 });
  callable.mockResolvedValueOnce({ data: { counts: { s1: "two" } } });
  await expect(listSessionBookedCounts({ from: "2026-09-14T00:00:00.000Z", to: "2026-09-20T23:59:59.999Z" })).rejects.toThrow("Unable to load booking counts.");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/schedule-client.test.ts -t "removeClass"`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

```ts
export async function updateSession(input: UpdateSessionInput): Promise<SessionRecord> {
  const callable = httpsCallable<UpdateSessionInput, { session: SessionRecord }>(getFirebaseFunctions(), "updateSession");
  const result = await callable(input);
  return result.data.session;
}

export async function removeClass(
  input: RemoveClassInput,
): Promise<Readonly<{ class: ClassRecord; cancelledSessions: readonly SessionRecord[] }>> {
  const callable = httpsCallable<RemoveClassInput, { class: ClassRecord; cancelledSessions: SessionRecord[] }>(getFirebaseFunctions(), "removeClass");
  const result = await callable(input);
  return result.data;
}

export async function listSessionBookedCounts(
  query: ListSessionsQuery,
): Promise<Readonly<Record<string, number>>> {
  const callable = httpsCallable<ListSessionsQuery, { counts: unknown }>(getFirebaseFunctions(), "listSessionBookedCounts");
  const result = await callable(query);
  const counts = result.data.counts;
  if (
    typeof counts !== "object" || counts === null || Array.isArray(counts) ||
    !Object.values(counts).every((value) => Number.isSafeInteger(value) && (value as number) >= 0)
  ) {
    throw new Error("Unable to load booking counts.");
  }
  return Object.freeze({ ...(counts as Record<string, number>) });
}
```

Import `RemoveClassInput`, `UpdateSessionInput` from `@bpt-jersey/domain/schedule`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/schedule-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/schedule-client.ts apps/web/src/lib/schedule-client.test.ts
git commit -m "feat(web): schedule client for session edits, class removal and booked counts"
```

---

### Task 7: The class form (web component)

**Files:**
- Create: `apps/web/src/app/admin/classes/class-form.tsx`
- Test: `apps/web/src/app/admin/classes/class-form.test.tsx`
- Modify: `apps/web/src/app/admin/classes/classes.css` (append the `.class-form*` and `.class-choice*` rules below)

**Interfaces:**
- Produces:
  ```ts
  export type ClassDraft = Readonly<{
    name: string; programId: string; locationId: "" | LocationId;
    rules: readonly ClassRecurrenceRule[];
    levelRange: Readonly<{ fromKey: string; toKey: string }> | null;
    ageRange: AgeRange | null;
    description: string; instructorIds: readonly string[]; capacity: number; minParticipants: number; active: boolean;
  }>;
  export function emptyClassDraft(): ClassDraft;
  export function draftFromClass(record: ClassRecord): ClassDraft;
  export function draftToCreateInput(draft: ClassDraft, belts: readonly BeltOption[]): CreateClassInput | string; // string = validation message
  export function draftToUpdateInput(classId: string, draft: ClassDraft, belts: readonly BeltOption[]): UpdateClassInput | string;
  export type BeltOption = Readonly<{ key: string; name: string; sequence: number }>;
  export function ClassForm(props: { draft: ClassDraft; mode: "create" | "edit"; belts: readonly BeltOption[] | null; catalog: ScheduleCatalogResponse; activeStaff: readonly StaffProfileProjection[]; onChange: (draft: ClassDraft) => void }): JSX.Element;
  ```
- Consumes: `ageRangePresets`, `ageRangeLabel`, `classDescriptionMaxLength`, `daysOfWeek` from `@bpt-jersey/domain/schedule`; `StaffProfileProjection`; `ScheduleCatalogResponse`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClassForm, draftToCreateInput, emptyClassDraft, type BeltOption } from "./class-form";

const catalog = {
  locations: [
    { locationId: "town", academyId: "a", name: "BPT Town", address: "", timezone: "Europe/Jersey", active: true, schemaVersion: "1" },
    { locationId: "west", academyId: "a", name: "BPT West", address: "", timezone: "Europe/Jersey", active: true, schemaVersion: "1" },
  ],
  programs: [{ programId: "p-kids", academyId: "a", name: "Kids BJJ", ageBand: "kids", discipline: "bjj", level: "all-levels", active: true, schemaVersion: "1" }],
} as const;
const belts: BeltOption[] = [
  { key: "k-white", name: "White", sequence: 1 },
  { key: "k-grey", name: "Grey", sequence: 2 },
  { key: "k-yellow", name: "Yellow", sequence: 3 },
];
const staff = [{ staffKey: "coach-a", role: "coach", active: true, status: "active", schemaVersion: "1" }] as const;

describe("class form", () => {
  afterEach(cleanup);

  it("toggles weekdays and copies the last time into a newly opened day", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ClassForm activeStaff={staff} belts={belts} catalog={catalog} draft={emptyClassDraft()} mode="create" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Monday", pressed: false }));
    let draft = onChange.mock.lastCall![0];
    expect(draft.rules).toEqual([{ dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 }]);
    rerender(<ClassForm activeStaff={staff} belts={belts} catalog={catalog} draft={draft} mode="create" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Monday start time"), { target: { value: "17:30" } });
    draft = onChange.mock.lastCall![0];
    rerender(<ClassForm activeStaff={staff} belts={belts} catalog={catalog} draft={draft} mode="create" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Wednesday", pressed: false }));
    draft = onChange.mock.lastCall![0];
    expect(draft.rules).toEqual([
      { dayOfWeek: 1, startTime: "17:30", durationMinutes: 60 },
      { dayOfWeek: 3, startTime: "17:30", durationMinutes: 60 },
    ]);
  });

  it("applies an age preset and a custom range", () => {
    const onChange = vi.fn();
    render(<ClassForm activeStaff={staff} belts={belts} catalog={catalog} draft={emptyClassDraft()} mode="create" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "8–11" }));
    expect(onChange.mock.lastCall![0].ageRange).toEqual({ minAge: 8, maxAge: 11 });
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    expect(onChange.mock.lastCall![0].ageRange).toEqual({ minAge: 8, maxAge: 11 });
  });

  it("builds a create input with belt names and refuses an inverted belt range", () => {
    const draft = {
      ...emptyClassDraft(),
      name: "Kids BJJ", programId: "p-kids", locationId: "town" as const,
      rules: [{ dayOfWeek: 1 as const, startTime: "17:00", durationMinutes: 60 }],
      levelRange: { fromKey: "k-white", toKey: "k-yellow" },
      ageRange: { minAge: 8, maxAge: 11 },
      description: " Bring a gi. ", instructorIds: ["coach-a"], capacity: 20, minParticipants: 4,
    };
    expect(draftToCreateInput(draft, belts)).toEqual({
      programId: "p-kids", locationId: "town", name: "Kids BJJ",
      recurrenceRules: [{ dayOfWeek: 1, startTime: "17:00", durationMinutes: 60 }],
      instructorIds: ["coach-a"], capacity: 20, minParticipants: 4,
      description: "Bring a gi.", ageRange: { minAge: 8, maxAge: 11 },
      levelRange: { fromKey: "k-white", toKey: "k-yellow", fromName: "White", toName: "Yellow" },
    });
    expect(draftToCreateInput({ ...draft, levelRange: { fromKey: "k-yellow", toKey: "k-white" } }, belts)).toBe("The 'to' belt cannot be below the 'from' belt.");
    expect(draftToCreateInput({ ...draft, rules: [] }, belts)).toBe("Pick at least one day.");
  });

  it("disables the belt selectors when the catalogue is unavailable", () => {
    render(<ClassForm activeStaff={staff} belts={null} catalog={catalog} draft={emptyClassDraft()} mode="create" onChange={vi.fn()} />);
    expect(screen.getByLabelText("From belt")).toBeDisabled();
    expect(screen.getByText("Belt catalogue unavailable. Level range can be set later.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/classes/class-form.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `class-form.tsx`**

```tsx
"use client";

import {
  ageRangeMaxAge,
  ageRangeMinAge,
  ageRangePresets,
  classDescriptionMaxLength,
  daysOfWeek,
  type AgeRange,
  type ClassRecord,
  type ClassRecurrenceRule,
  type CreateClassInput,
  type DayOfWeek,
  type LocationId,
  type UpdateClassInput,
} from "@bpt-jersey/domain/schedule";

import type { ScheduleCatalogResponse } from "../../../lib/schedule-client";
import type { StaffProfileProjection } from "../../../lib/staff-client";

export type BeltOption = Readonly<{ key: string; name: string; sequence: number }>;

export type ClassDraft = Readonly<{
  name: string;
  programId: string;
  locationId: "" | LocationId;
  rules: readonly ClassRecurrenceRule[];
  levelRange: Readonly<{ fromKey: string; toKey: string }> | null;
  ageRange: AgeRange | null;
  description: string;
  instructorIds: readonly string[];
  capacity: number;
  minParticipants: number;
  active: boolean;
}>;

export const dayLabels: Readonly<Record<DayOfWeek, string>> = Object.freeze({
  1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday",
});
const dayShort: Readonly<Record<DayOfWeek, string>> = Object.freeze({
  1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun",
});
const durations = Object.freeze([30, 45, 60, 75, 90, 120]);
const defaultRule = Object.freeze({ startTime: "18:00", durationMinutes: 60 });

export function emptyClassDraft(): ClassDraft {
  return Object.freeze({
    name: "", programId: "", locationId: "", rules: Object.freeze([]), levelRange: null, ageRange: null,
    description: "", instructorIds: Object.freeze([]), capacity: 20, minParticipants: 4, active: true,
  });
}

export function draftFromClass(record: ClassRecord): ClassDraft {
  return Object.freeze({
    name: record.name,
    programId: record.programId,
    locationId: record.locationId,
    rules: Object.freeze([...record.recurrenceRules]),
    levelRange: record.levelRange ? { fromKey: record.levelRange.fromKey, toKey: record.levelRange.toKey } : null,
    ageRange: record.ageRange,
    description: record.description,
    instructorIds: Object.freeze([...record.instructorIds]),
    capacity: record.capacity,
    minParticipants: record.minParticipants,
    active: record.active,
  });
}

function sortRules(rules: readonly ClassRecurrenceRule[]): readonly ClassRecurrenceRule[] {
  return Object.freeze(
    [...rules].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)),
  );
}

function resolveLevelRange(
  draft: ClassDraft,
  belts: readonly BeltOption[],
): CreateClassInput["levelRange"] | string {
  if (!draft.levelRange) return null;
  const from = belts.find((belt) => belt.key === draft.levelRange?.fromKey);
  const to = belts.find((belt) => belt.key === draft.levelRange?.toKey);
  if (!from || !to) return "Pick both belts or choose Any level.";
  if (to.sequence < from.sequence) return "The 'to' belt cannot be below the 'from' belt.";
  return { fromKey: from.key, toKey: to.key, fromName: from.name, toName: to.name };
}

function validateCommon(draft: ClassDraft): string | undefined {
  if (draft.name.trim().length < 2) return "Give the class a name of at least two characters.";
  if (draft.rules.length === 0) return "Pick at least one day.";
  if (draft.rules.some((rule) => !/^([01]\d|2[0-3]):[0-5]\d$/u.test(rule.startTime))) return "Every day needs a start time.";
  if (draft.instructorIds.length === 0) return "Pick at least one coach.";
  if (draft.minParticipants > draft.capacity) return "Minimum participants cannot exceed capacity.";
  if (draft.ageRange && draft.ageRange.maxAge !== null && draft.ageRange.maxAge < draft.ageRange.minAge) return "The upper age cannot be below the lower age.";
  return undefined;
}

export function draftToCreateInput(draft: ClassDraft, belts: readonly BeltOption[]): CreateClassInput | string {
  if (!draft.programId || !draft.locationId) return "Pick the program and the training centre.";
  const common = validateCommon(draft);
  if (common) return common;
  const levelRange = resolveLevelRange(draft, belts);
  if (typeof levelRange === "string") return levelRange;
  return {
    programId: draft.programId,
    locationId: draft.locationId,
    name: draft.name.trim(),
    recurrenceRules: sortRules(draft.rules),
    instructorIds: draft.instructorIds,
    capacity: draft.capacity,
    minParticipants: draft.minParticipants,
    description: draft.description.trim(),
    ageRange: draft.ageRange,
    levelRange,
  };
}

export function draftToUpdateInput(classId: string, draft: ClassDraft, belts: readonly BeltOption[]): UpdateClassInput | string {
  const common = validateCommon(draft);
  if (common) return common;
  const levelRange = resolveLevelRange(draft, belts);
  if (typeof levelRange === "string") return levelRange;
  return {
    classId,
    name: draft.name.trim(),
    recurrenceRules: sortRules(draft.rules),
    instructorIds: draft.instructorIds,
    capacity: draft.capacity,
    minParticipants: draft.minParticipants,
    active: draft.active,
    description: draft.description.trim(),
    ageRange: draft.ageRange,
    levelRange,
  };
}

type ClassFormProps = Readonly<{
  activeStaff: readonly StaffProfileProjection[];
  belts: readonly BeltOption[] | null;
  catalog: ScheduleCatalogResponse;
  draft: ClassDraft;
  mode: "create" | "edit";
  onChange: (draft: ClassDraft) => void;
}>;

export function ClassForm({ activeStaff, belts, catalog, draft, mode, onChange }: ClassFormProps) {
  const set = (patch: Partial<ClassDraft>) => onChange(Object.freeze({ ...draft, ...patch }));
  const lastRule = draft.rules[draft.rules.length - 1] ?? defaultRule;
  const presetIndex = ageRangePresets.findIndex(
    (preset) => draft.ageRange?.minAge === preset.minAge && draft.ageRange?.maxAge === preset.maxAge,
  );
  const ageChoice = draft.ageRange === null ? "any" : presetIndex >= 0 ? String(presetIndex) : "custom";

  function toggleDay(day: DayOfWeek) {
    const existing = draft.rules.find((rule) => rule.dayOfWeek === day);
    set({
      rules: sortRules(
        existing
          ? draft.rules.filter((rule) => rule.dayOfWeek !== day)
          : [...draft.rules, { dayOfWeek: day, startTime: lastRule.startTime, durationMinutes: lastRule.durationMinutes }],
      ),
    });
  }

  function patchRule(day: DayOfWeek, patch: Partial<ClassRecurrenceRule>) {
    set({ rules: draft.rules.map((rule) => (rule.dayOfWeek === day ? { ...rule, ...patch } : rule)) });
  }

  const staffKeys = [
    ...activeStaff.map((profile) => profile.staffKey),
    ...draft.instructorIds.filter((id) => !activeStaff.some((profile) => profile.staffKey === id)),
  ];

  return (
    <div className="class-form">
      <label className="schedule-admin-field class-form-wide">
        Class name
        <input autoFocus maxLength={100} minLength={2} onChange={(e) => set({ name: e.target.value })} required value={draft.name} />
      </label>

      {mode === "create" ? (
        <>
          <label className="schedule-admin-field">
            Program
            <select onChange={(e) => set({ programId: e.target.value })} required value={draft.programId}>
              <option value="">Select a program</option>
              {catalog.programs.filter((p) => p.active).map((p) => (
                <option key={p.programId} value={p.programId}>{p.name}</option>
              ))}
            </select>
          </label>
          <div className="schedule-admin-field" role="radiogroup" aria-label="Training centre">
            <span>Training centre</span>
            <div className="class-choice-row">
              {catalog.locations.filter((l) => l.active).map((location) => (
                <button
                  aria-checked={draft.locationId === location.locationId}
                  className="class-choice"
                  key={location.locationId}
                  onClick={() => set({ locationId: location.locationId })}
                  role="radio"
                  type="button"
                >
                  {location.name}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <p className="schedule-admin-form-note class-form-wide">
          {catalog.programs.find((p) => p.programId === draft.programId)?.name ?? draft.programId} ·{" "}
          {catalog.locations.find((l) => l.locationId === draft.locationId)?.name ?? draft.locationId}.
          Program and centre stay fixed; sessions already generated keep their times. Generate again for new days.
        </p>
      )}

      <fieldset className="class-form-wide class-form-schedule">
        <legend>Weekly schedule</legend>
        <div className="class-choice-row" role="group" aria-label="Days of the week">
          {daysOfWeek.map((day) => (
            <button
              aria-pressed={draft.rules.some((rule) => rule.dayOfWeek === day)}
              className="class-choice class-choice-day"
              key={day}
              onClick={() => toggleDay(day)}
              type="button"
            >
              <span aria-hidden="true">{dayShort[day]}</span>
              <span className="visually-hidden">{dayLabels[day]}</span>
            </button>
          ))}
        </div>
        {draft.rules.length === 0 ? <p className="schedule-admin-form-note">Pick the days this class runs.</p> : null}
        <ul className="class-form-rules">
          {draft.rules.map((rule) => (
            <li key={rule.dayOfWeek}>
              <strong>{dayLabels[rule.dayOfWeek]}</strong>
              <label>
                <span className="visually-hidden">{dayLabels[rule.dayOfWeek]} start time</span>
                <input aria-label={`${dayLabels[rule.dayOfWeek]} start time`} onChange={(e) => patchRule(rule.dayOfWeek, { startTime: e.target.value })} required type="time" value={rule.startTime} />
              </label>
              <label>
                <span className="visually-hidden">{dayLabels[rule.dayOfWeek]} duration</span>
                <select aria-label={`${dayLabels[rule.dayOfWeek]} duration`} onChange={(e) => patchRule(rule.dayOfWeek, { durationMinutes: Number(e.target.value) })} value={rule.durationMinutes}>
                  {[...new Set([...durations, rule.durationMinutes])].sort((a, b) => a - b).map((minutes) => (
                    <option key={minutes} value={minutes}>{minutes} min</option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset className="class-form-wide">
        <legend>Level range</legend>
        {belts === null ? (
          <p className="schedule-admin-form-note">Belt catalogue unavailable. Level range can be set later.</p>
        ) : null}
        <div className="class-form-pair">
          <label className="schedule-admin-field">
            From belt
            <select
              aria-label="From belt"
              disabled={belts === null}
              onChange={(e) => set({ levelRange: e.target.value ? { fromKey: e.target.value, toKey: draft.levelRange?.toKey || e.target.value } : null })}
              value={draft.levelRange?.fromKey ?? ""}
            >
              <option value="">Any level</option>
              {(belts ?? []).map((belt) => <option key={belt.key} value={belt.key}>{belt.name}</option>)}
            </select>
          </label>
          <label className="schedule-admin-field">
            To belt
            <select
              aria-label="To belt"
              disabled={belts === null || draft.levelRange === null}
              onChange={(e) => set({ levelRange: draft.levelRange ? { ...draft.levelRange, toKey: e.target.value } : null })}
              value={draft.levelRange?.toKey ?? ""}
            >
              {(belts ?? []).map((belt) => <option key={belt.key} value={belt.key}>{belt.name}</option>)}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="class-form-wide">
        <legend>Age range</legend>
        <div className="class-choice-row" role="radiogroup" aria-label="Age range">
          <button aria-checked={ageChoice === "any"} className="class-choice" onClick={() => set({ ageRange: null })} role="radio" type="button">Any age</button>
          {ageRangePresets.map((preset, index) => (
            <button aria-checked={ageChoice === String(index)} className="class-choice" key={preset.label} onClick={() => set({ ageRange: { minAge: preset.minAge, maxAge: preset.maxAge } })} role="radio" type="button">
              {preset.label}
            </button>
          ))}
          <button aria-checked={ageChoice === "custom"} className="class-choice" onClick={() => set({ ageRange: draft.ageRange ?? { minAge: 8, maxAge: 11 } })} role="radio" type="button">Custom</button>
        </div>
        {ageChoice === "custom" && draft.ageRange ? (
          <div className="class-form-pair">
            <label className="schedule-admin-field">
              From age
              <input inputMode="numeric" max={ageRangeMaxAge} min={ageRangeMinAge} onChange={(e) => set({ ageRange: { minAge: Number(e.target.value), maxAge: draft.ageRange?.maxAge ?? null } })} type="number" value={draft.ageRange.minAge} />
            </label>
            <label className="schedule-admin-field">
              To age (blank = no limit)
              <input inputMode="numeric" max={ageRangeMaxAge} min={ageRangeMinAge} onChange={(e) => set({ ageRange: { minAge: draft.ageRange?.minAge ?? ageRangeMinAge, maxAge: e.target.value === "" ? null : Number(e.target.value) } })} type="number" value={draft.ageRange.maxAge ?? ""} />
            </label>
          </div>
        ) : null}
      </fieldset>

      <label className="schedule-admin-field class-form-wide">
        Description
        <textarea maxLength={classDescriptionMaxLength} onChange={(e) => set({ description: e.target.value })} rows={3} value={draft.description} />
        <small>{draft.description.length}/{classDescriptionMaxLength}</small>
      </label>

      <fieldset className="class-form-wide">
        <legend>Coaches</legend>
        <div className="class-form-checks">
          {staffKeys.map((staffKey) => (
            <label className="schedule-admin-check" key={staffKey}>
              <input
                checked={draft.instructorIds.includes(staffKey)}
                onChange={(e) => set({ instructorIds: e.target.checked ? [...draft.instructorIds, staffKey] : draft.instructorIds.filter((id) => id !== staffKey) })}
                type="checkbox"
              />
              {staffKey}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="schedule-admin-field">
        Capacity
        <input inputMode="numeric" max={200} min={1} onChange={(e) => set({ capacity: Number(e.target.value) })} required type="number" value={draft.capacity} />
      </label>
      <label className="schedule-admin-field">
        Minimum participants
        <input inputMode="numeric" max={draft.capacity} min={0} onChange={(e) => set({ minParticipants: Number(e.target.value) })} required type="number" value={draft.minParticipants} />
      </label>

      {mode === "edit" ? (
        <label className="schedule-admin-check class-form-wide">
          <input checked={draft.active} onChange={(e) => set({ active: e.target.checked })} type="checkbox" />
          Class is active
        </label>
      ) : null}
    </div>
  );
}
```

CSS to append to `classes.css` (tokens: `--bpt-purple`, `--mat-ink`, `--gi-white`, `--muted` already exist in `admin.css`; verify the names with `grep -n "^  --" apps/web/src/app/admin/admin.css | head -20` and use those):

```css
.class-form {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.class-form-wide { grid-column: 1 / -1; }
.class-form fieldset { border: 1px solid var(--line, #8a8880); margin: 0; min-width: 0; padding: 0.9rem; }
.class-form legend { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: var(--bpt-purple); padding: 0 0.3rem; }
.class-choice-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.class-choice {
  background: var(--gi-white); border: 1px solid var(--mat-ink); cursor: pointer; font: inherit;
  font-size: 0.85rem; font-weight: 700; letter-spacing: 0.04em; min-height: 3.15rem; min-width: 3.15rem;
  padding: 0.5rem 0.9rem; text-transform: uppercase; transition: background-color 160ms ease, color 160ms ease;
}
.class-choice[aria-checked="true"], .class-choice[aria-pressed="true"] { background: var(--bpt-purple); border-color: var(--bpt-purple); color: var(--gi-white); }
.class-choice:focus-visible { outline: 3px solid var(--bpt-purple); outline-offset: 4px; }
.class-form-rules { display: grid; gap: 0.6rem; list-style: none; margin: 0.9rem 0 0; padding: 0; }
.class-form-rules li { align-items: center; display: grid; gap: 0.6rem; grid-template-columns: minmax(6rem, 1fr) minmax(0, 1fr) minmax(0, 1fr); }
.class-form-rules input, .class-form-rules select { min-height: 3rem; width: 100%; }
.class-form-pair { display: grid; gap: 0.75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 0.75rem; }
.class-form-checks { display: grid; gap: 0.4rem; }
.class-form small { color: var(--muted); display: block; margin-top: 0.25rem; text-align: right; font-variant-numeric: tabular-nums; }
@media (max-width: 50rem) {
  .class-form, .class-form-pair { grid-template-columns: minmax(0, 1fr); }
  .class-form-rules li { grid-template-columns: minmax(0, 1fr); }
  .schedule-admin-dialog { inset: 0; max-height: none; max-width: none; width: 100%; height: 100%; overflow: auto; }
}
@media (prefers-reduced-motion: reduce) { .class-choice { transition: none; } }
```

Check `.schedule-admin-dialog` in `classes.css` (line ~246) before adding the mobile override so it overrides rather than duplicates: if the dialog is positioned with `margin: auto; max-width: 40rem`, the override above is right; adjust property names to what is there.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/classes/class-form.test.tsx`
Expected: PASS (4 tests). If `getByRole("button", { name: "Monday", pressed: false })` fails because the visible text is "Mon", the visually-hidden span still gives the accessible name "MonMonday" — change the button to `aria-label={dayLabels[day]}` and drop the hidden span.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/classes/class-form.tsx apps/web/src/app/admin/classes/class-form.test.tsx apps/web/src/app/admin/classes/classes.css
git commit -m "feat(admin): mobile-first class form with weekly days, level and age ranges"
```

---

### Task 8: Dialog kinds and page handlers for the new class model (web)

**Files:**
- Modify: `apps/web/src/app/admin/classes/classes-dialog.tsx` — replace the `kind === "class"` form body with `<ClassForm/>`; add kinds `session-edit` and `remove-class`; export the new `ScheduleDialogState`.
- Modify: `apps/web/src/app/admin/classes/page.tsx` — state and handlers (`submitClass`, new `submitSessionEdit`, `submitRemoveClass`), belts loading, `newClassDraft` removal.
- Test: `apps/web/src/app/admin/classes/page.test.tsx` (extend the mocks with `updateSession`, `removeClass`, and `vi.mock("../../../lib/levels-client", () => ({ getLevelCatalog }))`).

**Interfaces:**
- Consumes: Task 7 (`ClassForm`, `ClassDraft`, `emptyClassDraft`, `draftFromClass`, `draftToCreateInput`, `draftToUpdateInput`, `BeltOption`), Task 6 client functions, `getLevelCatalog` from `apps/web/src/lib/levels-client.ts`.
- Produces `ScheduleDialogState`:
  ```ts
  | { kind: "class"; mode: "create" | "edit"; classId?: string; draft: ClassDraft }
  | { kind: "session"; draft: SessionDraft }          // SessionDraft gains `description: string`
  | { kind: "session-edit"; sessionId: string; draft: SessionEditDraft }
  | { kind: "generate"; classId: string; fromDate: string; toDate: string }
  | { kind: "remove-class"; classId: string; label: string; reason: string }
  | { kind: "cancel-session"; … } | { kind: "cancel-booking"; … }
  export type SessionEditDraft = Readonly<{ title: string; instructorId: string; startAt: string; endAt: string; capacity: number; minParticipants: number; description: string }>;
  ```
  Dialog props gain `belts: readonly BeltOption[] | null`, `onSubmitSessionEdit`, `onSubmitRemoveClass`.

- [ ] **Step 1: Write the failing tests** (append to `page.test.tsx`; reuse its `beforeEach` fixtures, which after Task 2 hold a v2 class)

```tsx
it("creates a two-day class with ranges through the new form", async () => {
  mocks.getLevelCatalog.mockResolvedValue({
    system: { systemId: "ibjjf", displayName: "IBJJF", schemaVersion: 1, precedence: {}, counts: { definitions: 2, belts: 2, stripes: 0 }, skillCatalog: [] },
    definitions: [
      { definitionKey: "k-white", systemId: "ibjjf", kind: "belt", parentDefinitionKey: null, name: "White", sequence: 1, stripeNumber: null, criteria: { minAge: 4, maxAge: 15, minClasses: null, minimumTime: null }, observedCriteria: { minAge: null, maxAge: null, minClasses: null, minimumTime: null }, visual: { colorMode: 1, colors: ["#ffffff"], stripeColor: null, stripeCenter: null, stripeWidth: null, stripePosition: null }, observedSkillRequirementSetKey: null, observedSkillRequirementsState: "none", anomalyFlags: [], schemaVersion: 1 },
      { definitionKey: "k-grey", systemId: "ibjjf", kind: "belt", parentDefinitionKey: null, name: "Grey", sequence: 2, stripeNumber: null, criteria: { minAge: 4, maxAge: 15, minClasses: null, minimumTime: null }, observedCriteria: { minAge: null, maxAge: null, minClasses: null, minimumTime: null }, visual: { colorMode: 1, colors: ["#8a8880"], stripeColor: null, stripeCenter: null, stripeWidth: null, stripePosition: null }, observedSkillRequirementSetKey: null, observedSkillRequirementsState: "none", anomalyFlags: [], schemaVersion: 1 },
    ],
    skills: [], requirements: [], sourceHash: "test",
  });
  mocks.saveClass.mockImplementation(async (input) => ({ ...input, classId: "class-new", academyId, active: true, schemaVersion: "2", createdAt: now, createdBy: "u", updatedAt: now, updatedBy: "u" }));
  render(<ClassesPage />);
  fireEvent.click(await screen.findByRole("button", { name: "New class" }));
  fireEvent.change(screen.getByLabelText("Class name"), { target: { value: "Kids BJJ" } });
  fireEvent.change(screen.getByLabelText("Program"), { target: { value: "program-adults" } });
  fireEvent.click(screen.getByRole("radio", { name: "BPT Town" }));
  fireEvent.click(screen.getByRole("button", { name: "Monday" }));
  fireEvent.click(screen.getByRole("button", { name: "Wednesday" }));
  fireEvent.click(screen.getByRole("radio", { name: "8–11" }));
  fireEvent.change(screen.getByLabelText("From belt"), { target: { value: "k-white" } });
  fireEvent.change(screen.getByLabelText("To belt"), { target: { value: "k-grey" } });
  fireEvent.click(screen.getByLabelText("coach-1"));
  fireEvent.click(screen.getByRole("button", { name: "Create class" }));
  await waitFor(() => expect(mocks.saveClass).toHaveBeenCalledTimes(1));
  expect(mocks.saveClass.mock.calls[0]![0]).toMatchObject({
    recurrenceRules: [
      { dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 },
      { dayOfWeek: 3, startTime: "18:00", durationMinutes: 60 },
    ],
    ageRange: { minAge: 8, maxAge: 11 },
    levelRange: { fromKey: "k-white", toKey: "k-grey", fromName: "White", toName: "Grey" },
  });
  expect(await screen.findByText("Class created.")).toBeInTheDocument();
});

it("edits a session and removes a class with a reason", async () => {
  mocks.updateSession.mockImplementation(async (input) => ({ ...sessionFixture, ...input }));
  mocks.removeClass.mockResolvedValue({ class: { ...classFixture, active: false }, cancelledSessions: [sessionFixture, sessionFixture] });
  render(<ClassesPage />);
  fireEvent.click(await screen.findByRole("button", { name: `Edit ${sessionFixture.title}` }));
  fireEvent.change(screen.getByLabelText("Session title"), { target: { value: "Adults Gi" } });
  fireEvent.click(screen.getByRole("button", { name: "Save session" }));
  await waitFor(() => expect(mocks.updateSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: sessionFixture.sessionId, title: "Adults Gi" })));

  fireEvent.click(screen.getByRole("button", { name: `Remove ${classFixture.name}` }));
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Coach left" } });
  fireEvent.click(screen.getByRole("button", { name: "Remove class" }));
  await waitFor(() => expect(mocks.removeClass).toHaveBeenCalledWith({ classId: classFixture.classId, reason: "Coach left" }));
  expect(await screen.findByText("Class removed. 2 upcoming sessions cancelled.")).toBeInTheDocument();
});
```

Use the names the fixture file already declares for its class and session (`classFixture`/`sessionFixture` here stand for whatever the `beforeEach` resolves `listClasses`/`listSessions` with; the staff mock must return a profile with `staffKey: "coach-1"` and `listStaffProfiles` must be mocked as it is today).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/classes/page.test.tsx -t "two-day class"`
Expected: FAIL — no "New class" button / no belts.

- [ ] **Step 3: Update `classes-dialog.tsx`**

- Remove the local `ClassDraft` type and `dayLabels`; import `ClassDraft`, `ClassForm`, `BeltOption` from `./class-form`.
- `SessionDraft` gains `description: string`; add `SessionEditDraft`; extend `ScheduleDialogState` as in Interfaces.
- `title()`: `"session-edit"` → "Edit session"; `"remove-class"` → "Remove class".
- Replace the whole `dialog.kind === "class"` form body (from the "Class name" label to the `DialogActions`) with:

```tsx
<form aria-label={dialogTitle} className="schedule-admin-form" onSubmit={onSubmitClass}>
  <ClassForm activeStaff={activeStaff} belts={belts} catalog={catalog} draft={dialog.draft} mode={dialog.mode} onChange={(draft) => onChange({ ...dialog, draft })} />
  {error ? <p className="schedule-admin-notice schedule-admin-notice-error schedule-admin-field-wide" role="alert">{error}</p> : null}
  <DialogActions busy={busy} label={dialog.mode === "edit" ? "Save changes" : "Create class"} onClose={onClose} />
</form>
```

- In the `session` form add a Description textarea (`maxLength={classDescriptionMaxLength}`) after the seminar checkbox.
- Add the `session-edit` form:

```tsx
{dialog.kind === "session-edit" ? (
  <form aria-label={dialogTitle} className="schedule-admin-form" onSubmit={onSubmitSessionEdit}>
    <label className="schedule-admin-field schedule-admin-field-wide">Session title
      <input maxLength={120} minLength={2} onChange={(e) => onChange({ ...dialog, draft: { ...dialog.draft, title: e.target.value } })} required value={dialog.draft.title} />
    </label>
    <label className="schedule-admin-field">Coach
      <select onChange={(e) => onChange({ ...dialog, draft: { ...dialog.draft, instructorId: e.target.value } })} required value={dialog.draft.instructorId}>
        {[...activeStaff.map((p) => p.staffKey), ...(activeStaff.some((p) => p.staffKey === dialog.draft.instructorId) ? [] : [dialog.draft.instructorId])].map((key) => <option key={key} value={key}>{key}</option>)}
      </select>
    </label>
    <label className="schedule-admin-field">Starts on this device
      <input onChange={(e) => onChange({ ...dialog, draft: { ...dialog.draft, startAt: e.target.value } })} required type="datetime-local" value={dialog.draft.startAt} />
    </label>
    <label className="schedule-admin-field">Ends on this device
      <input onChange={(e) => onChange({ ...dialog, draft: { ...dialog.draft, endAt: e.target.value } })} required type="datetime-local" value={dialog.draft.endAt} />
    </label>
    <label className="schedule-admin-field">Capacity
      <input inputMode="numeric" max={300} min={1} onChange={(e) => onChange({ ...dialog, draft: { ...dialog.draft, capacity: Number(e.target.value) } })} required type="number" value={dialog.draft.capacity} />
    </label>
    <label className="schedule-admin-field">Minimum participants
      <input inputMode="numeric" max={dialog.draft.capacity} min={0} onChange={(e) => onChange({ ...dialog, draft: { ...dialog.draft, minParticipants: Number(e.target.value) } })} required type="number" value={dialog.draft.minParticipants} />
    </label>
    <label className="schedule-admin-field schedule-admin-field-wide">Description
      <textarea maxLength={classDescriptionMaxLength} onChange={(e) => onChange({ ...dialog, draft: { ...dialog.draft, description: e.target.value } })} rows={3} value={dialog.draft.description} />
    </label>
    <p className="schedule-admin-form-note schedule-admin-field-wide">Existing bookings are kept. Members are not notified of the change.</p>
    {error ? <p className="schedule-admin-notice schedule-admin-notice-error schedule-admin-field-wide" role="alert">{error}</p> : null}
    <DialogActions busy={busy} label="Save session" onClose={onClose} />
  </form>
) : null}
```

- Add the `remove-class` form (same shape as the cancellation form): note text "You are removing <strong>{label}</strong>. Its upcoming sessions will be cancelled and members with bookings will see them cancelled. Past sessions and attendance are kept."; textarea labelled `Reason` (`aria-label="Reason"`, 2–200); `DialogActions destructive label="Remove class"`; `onSubmit={onSubmitRemoveClass}`.

- [ ] **Step 4: Update `page.tsx`**

- Imports: `emptyClassDraft`, `draftFromClass`, `draftToCreateInput`, `draftToUpdateInput`, `type BeltOption` from `./class-form`; `updateSession`, `removeClass` from the schedule client; `getLevelCatalog` from `../../../lib/levels-client`; `useAdminOrStaffSession` from `../admin-gate`.
- Delete `newClassDraft` and the local `dayLabels`; `newSessionDraft` gains `description: ""`.
- State: `const [belts, setBelts] = useState<readonly BeltOption[] | null>(null);` loaded in the initial `Promise.all` **separately** so a catalogue failure does not break the page:

```ts
void getLevelCatalog()
  .then((catalog) => setBelts(catalog.definitions.filter((d) => d.kind === "belt").sort((a, b) => a.sequence - b.sequence).map((d) => ({ key: d.definitionKey, name: d.name, sequence: d.sequence }))))
  .catch(() => setBelts(null));
```

- `const session = useAdminOrStaffSession(); const canManage = session.role !== "coach";`
- `submitClass`:

```ts
const input = dialog.mode === "create" ? draftToCreateInput(dialog.draft, belts ?? []) : draftToUpdateInput(dialog.classId!, dialog.draft, belts ?? []);
if (typeof input === "string") { setDialogError(input); return; }
// create → saveClass(input as CreateClassInput); edit → updateClass(input as UpdateClassInput); the rest unchanged
```

- `submitSession`: add `description: draft.description.trim()` to the input.
- New handlers:

```ts
async function submitSessionEdit(event: FormEvent<HTMLFormElement>): Promise<void> {
  event.preventDefault();
  if (dialog?.kind !== "session-edit") return;
  const { draft } = dialog;
  if (draft.minParticipants > draft.capacity) { setDialogError("Minimum participants cannot exceed capacity."); return; }
  setDialogBusy(true); setDialogError("");
  try {
    const updated = await updateSession({
      sessionId: dialog.sessionId, title: draft.title.trim(), instructorId: draft.instructorId,
      startAt: localDateTimeToIso(draft.startAt), endAt: localDateTimeToIso(draft.endAt),
      capacity: draft.capacity, minParticipants: draft.minParticipants, description: draft.description.trim(),
    });
    setSessions((current) => replaceById(current, updated, (item) => item.sessionId));
    setNotice({ kind: "success", message: "Session updated." });
    setDialog(undefined);
  } catch {
    setDialogError("Unable to update the session. Only scheduled sessions can be edited.");
  } finally { setDialogBusy(false); }
}

async function submitRemoveClass(event: FormEvent<HTMLFormElement>): Promise<void> {
  event.preventDefault();
  if (dialog?.kind !== "remove-class") return;
  setDialogBusy(true); setDialogError("");
  try {
    const result = await removeClass({ classId: dialog.classId, reason: dialog.reason.trim() });
    setClasses((current) => replaceById(current, result.class, (item) => item.classId));
    setSessions((current) => mergeSessions(current, result.cancelledSessions));
    const n = result.cancelledSessions.length;
    setNotice({ kind: "success", message: `Class removed. ${n} upcoming ${n === 1 ? "session" : "sessions"} cancelled.` });
    setDialog(undefined);
  } catch {
    setDialogError("Unable to remove the class. Refresh and try again.");
  } finally { setDialogBusy(false); }
}
```

- Helper for the edit draft: `function sessionEditDraft(session: SessionRecord): SessionEditDraft` converting ISO to `datetime-local` (`new Date(iso)` → `YYYY-MM-DDTHH:mm` in local time via `toISOString` offset by `getTimezoneOffset`, or reuse an existing helper if the file has one for the opposite direction).
- Pass `belts`, `onSubmitSessionEdit={(e) => void submitSessionEdit(e)}`, `onSubmitRemoveClass={(e) => void submitRemoveClass(e)}` to `<ScheduleDialog/>`.
- Header actions: buttons renamed "New session" / "New class" and rendered only when `canManage`.

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/classes && corepack pnpm --filter @bpt-jersey/web typecheck`
Expected: PASS. Existing page tests that clicked "Create class" in the header must now click "New class"; update them.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/admin/classes
git commit -m "feat(admin): class dialog uses the new form; edit session and remove class flows"
```

---

### Task 9: Class and session tables, role gating and mobile layout (web)

**Files:**
- Modify: `apps/web/src/app/admin/classes/page.tsx` (catalog and sessions tables), `classes.css`.
- Test: `apps/web/src/app/admin/classes/page.test.tsx`.

**Interfaces:**
- Consumes: `ageRangeLabel`, `levelRangeLabel` from the domain; `canManage` from Task 8; `dayLabels` from `./class-form`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows every weekly rule, the age and level ranges, and hides actions from a coach", async () => {
  // classFixture in beforeEach: two rules (Mon 18:00, Wed 18:00, 60 min), ageRange 8–11, levelRange White → Grey
  render(<ClassesPage />);
  expect(await screen.findByText("Mon 18:00 · Wed 18:00")).toBeInTheDocument();
  expect(screen.getByText("Ages 8–11 · White → Grey")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: `Remove ${classFixture.name}` })).toBeInTheDocument();
});

it("renders read-only for a coach", async () => {
  sessionMock.mockReturnValue({ uid: "c", email: "c@x", displayName: "Coach", academyId, role: "coach" });
  render(<ClassesPage />);
  await screen.findByText(classFixture.name);
  expect(screen.queryByRole("button", { name: "New class" })).toBeNull();
  expect(screen.queryByRole("button", { name: `Edit ${classFixture.name}` })).toBeNull();
  expect(screen.queryByRole("button", { name: `Generate sessions for ${classFixture.name}` })).toBeNull();
  expect(screen.queryByRole("button", { name: `Cancel ${sessionFixture.title}` })).toBeNull();
  expect(screen.getByRole("button", { name: `View reservations for ${sessionFixture.title}` })).toBeInTheDocument();
});
```

`sessionMock` is a `vi.hoisted` fn behind `vi.mock("../admin-gate", () => ({ useAdminOrStaffSession: sessionMock }))`, defaulting to an `owner` session in `beforeEach`.

- [ ] **Step 2: Run to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/classes/page.test.tsx -t "weekly rule|read-only"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Class table: rename headers to Class · Program / centre · Schedule · Who · Capacity · Status · Actions. Schedule cell:

```tsx
<td data-label="Schedule">
  {item.recurrenceRules.map((rule) => `${dayShortLabel(rule.dayOfWeek)} ${rule.startTime}`).join(" · ")}
  <small className="schedule-admin-block">
    {[...new Set(item.recurrenceRules.map((rule) => rule.durationMinutes))].map((m) => `${m} min`).join(" / ")}
  </small>
</td>
<td data-label="Who">{`${ageRangeLabel(item.ageRange)} · ${levelRangeLabel(item.levelRange)}`}</td>
```

(`dayShortLabel` = first three letters of `dayLabels[day]`.) Actions column, wrapped in `{canManage ? (…) : null}`: Edit (opens `{ kind: "class", mode: "edit", classId, draft: draftFromClass(item) }`), Generate (disabled when inactive), Remove (`aria-label={"Remove " + item.name}`, class `schedule-admin-text-button schedule-admin-danger-text`, opens `{ kind: "remove-class", classId: item.classId, label: item.name, reason: "" }`, hidden when `!item.active`).

Sessions table actions: Reservations always; when `canManage && session.status === "scheduled"` add Edit (`aria-label={"Edit " + session.title}`, opens `session-edit` with `sessionEditDraft(session)`); Cancel stays as today but only when `canManage`. Session cell shows `session.description` as a `<small>` under the program when non-empty.

CSS: confirm `.admin-data-table td[data-label]` stacks under `50rem` in `admin.css` (`grep -n "data-label" apps/web/src/app/admin/admin.css`). If it does not, add to `classes.css`:

```css
@media (max-width: 50rem) {
  .schedule-admin-page .admin-data-table thead { position: absolute; left: -9999px; }
  .schedule-admin-page .admin-data-table tr { display: grid; gap: 0.25rem; border-bottom: 1px solid var(--line, #8a8880); padding: 0.75rem 0; }
  .schedule-admin-page .admin-data-table td { display: grid; grid-template-columns: 7rem minmax(0, 1fr); gap: 0.5rem; border: 0; padding: 0.2rem 0; }
  .schedule-admin-page .admin-data-table td::before { content: attr(data-label); color: var(--muted); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; }
  .schedule-admin-row-actions { flex-wrap: wrap; }
  .schedule-admin-row-actions button { min-height: 2.75rem; }
}
```

- [ ] **Step 4: Run the tests and lint**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/classes && corepack pnpm lint`
Expected: PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/classes
git commit -m "feat(admin): class catalogue shows weekly rules and ranges; coaches read only"
```

---

### Task 10: Coach routes: Classes and Levels (web + docs)

**Files:**
- Modify: `apps/web/src/app/admin/admin-routes.ts`, `apps/web/src/app/admin/admin-routes.test.ts`, `apps/web/src/app/admin/admin-shell.tsx` (doc comment only), `qa/tests/admin-shell.spec.ts` (coach case), `docs/adr/ADR-010-coach-office-powers.md` (append an amendment).

- [ ] **Step 1: Write the failing test** (replace the first `it` in `admin-routes.test.ts`)

```ts
it("lists what each role sees in the menu, in navigation order", () => {
  expect(staffRoutes.coach).toEqual([
    "/admin",
    "/admin/attendance",
    "/admin/members/requests",
    "/admin/members/medical",
    "/admin/classes",
    "/admin/levels",
  ]);
  expect(staffRoutes.headCoach).toEqual(staffRoutes.coach);
});
```

and in the gating test change `expect(isStaffRouteAllowed("/admin/classes", "coach")).toBe(false)` to `true` and add `expect(isStaffRouteAllowed("/admin/levels", "coach")).toBe(true)`. Keep `/admin/members` → `false` (guard check: temporarily add `"/admin/members"` to `coachRoutes`, confirm the test dies, revert).

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/admin-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * What the mat can open inside /admin, in menu order. Operator decisions 2026-09-12 (ADR-010) and
 * 2026-09-14 (ADR-010 amendment: Classes read-only for coaches, Levels for both). The member
 * directory stays office-only.
 */
const coachRoutes = Object.freeze([
  "/admin",
  "/admin/attendance",
  "/admin/members/requests",
  "/admin/members/medical",
  "/admin/classes",
  "/admin/levels",
] as const);

export const staffRoutes: Readonly<Record<StaffRouteRole, readonly string[]>> = Object.freeze({
  coach: coachRoutes,
  headCoach: coachRoutes,
});
```

`admin-shell.spec.ts`: in the `role=coach` case assert the six menu labels: Overview, Attendance, Enrolment requests, Medical conditions, Classes, Levels — and that Members, Billing, Shop, Staff, Reports are absent.

ADR-010 amendment (append):

```markdown
## Enmienda 2026-09-14

Decision del operador en chat (2026-09-14): `coach` y `headCoach` ven ademas **Classes** y **Levels**.
En Classes, `coach` solo lee (la pagina no muestra crear, editar, generar, cancelar ni eliminar);
`headCoach` conserva los poderes de `managerRoles`. No cambia ningun callable: `listClasses` ya era de
staff, `listSessions` de cualquier autenticado, y las mutaciones siguen en `managerRoles`. El
directorio de Members sigue cerrado a coaches; se evaluo abrirlo en lectura y se descarto por el coste
de ADR-009.
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/admin-routes.test.ts apps/web/src/app/admin/page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/admin-routes.ts apps/web/src/app/admin/admin-routes.test.ts apps/web/src/app/admin/admin-shell.tsx qa/tests/admin-shell.spec.ts docs/adr/ADR-010-coach-office-powers.md
git commit -m "feat(admin): coaches open Classes (read) and Levels; ADR-010 amendment"
```

---

### Task 11: Belt grouping (pure, web)

**Files:**
- Create: `apps/web/src/app/levels/levels-grouping.ts`
- Test: `apps/web/src/app/levels/levels-grouping.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BeltAgeGroup = "kids" | "adults";
  export type BeltGroup = Readonly<{ belt: LevelDefinitionRecord; stripes: readonly LevelDefinitionRecord[]; ageGroup: BeltAgeGroup; primaryColor: string }>;
  export function beltAgeGroup(criteria: LevelCriteria): BeltAgeGroup; // kids when maxAge !== null && maxAge < 16
  export function groupBelts(catalog: Pick<LevelCatalogProjection, "definitions">): readonly BeltGroup[]; // belts by sequence; stripes by stripeNumber
  export function distinctBeltColors(groups: readonly BeltGroup[]): readonly Readonly<{ color: string; name: string }>[]; // first belt name per colour, in sequence order
  export function formatMinimumTime(time: LevelCriteria["minimumTime"]): string; // moved from levels-browser
  export function formatAgeRange(minAge: number | null, maxAge: number | null): string; // moved from levels-browser
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import type { LevelDefinitionRecord } from "@bpt-jersey/domain/levels";

import { beltAgeGroup, distinctBeltColors, groupBelts } from "./levels-grouping";

function def(overrides: Partial<LevelDefinitionRecord> & Pick<LevelDefinitionRecord, "definitionKey" | "kind" | "sequence">): LevelDefinitionRecord {
  return {
    systemId: "ibjjf", parentDefinitionKey: null, name: overrides.definitionKey, stripeNumber: null,
    criteria: { minAge: null, maxAge: null, minClasses: null, minimumTime: null },
    observedCriteria: { minAge: null, maxAge: null, minClasses: null, minimumTime: null },
    visual: { colorMode: 1, colors: ["#ffffff"], stripeColor: null, stripeCenter: null, stripeWidth: null, stripePosition: null },
    observedSkillRequirementSetKey: null, observedSkillRequirementsState: "none", anomalyFlags: [], schemaVersion: 1,
    ...overrides,
  };
}

describe("belt grouping", () => {
  const white = def({ definitionKey: "k-white", kind: "belt", sequence: 1, name: "White (kids)", criteria: { minAge: 4, maxAge: 15, minClasses: null, minimumTime: null } });
  const whiteS2 = def({ definitionKey: "k-white-2", kind: "stripe", sequence: 3, parentDefinitionKey: "k-white", stripeNumber: 2 });
  const whiteS1 = def({ definitionKey: "k-white-1", kind: "stripe", sequence: 2, parentDefinitionKey: "k-white", stripeNumber: 1 });
  const blue = def({ definitionKey: "a-blue", kind: "belt", sequence: 10, name: "Blue", criteria: { minAge: 16, maxAge: null, minClasses: 50, minimumTime: null }, visual: { colorMode: 1, colors: ["#1f4fa3"], stripeColor: null, stripeCenter: null, stripeWidth: null, stripePosition: null } });
  const blueAlias = def({ definitionKey: "a-blue-2", kind: "belt", sequence: 11, name: "Blue II", visual: { colorMode: 1, colors: ["#1f4fa3"], stripeColor: null, stripeCenter: null, stripeWidth: null, stripePosition: null } });

  it("groups stripes under their belt, ordered by belt sequence and stripe number", () => {
    const groups = groupBelts({ definitions: [blue, whiteS2, white, whiteS1, blueAlias] });
    expect(groups.map((g) => g.belt.definitionKey)).toEqual(["k-white", "a-blue", "a-blue-2"]);
    expect(groups[0]?.stripes.map((s) => s.stripeNumber)).toEqual([1, 2]);
    expect(groups[0]?.ageGroup).toBe("kids");
    expect(groups[1]?.ageGroup).toBe("adults");
    expect(groups[1]?.primaryColor).toBe("#1f4fa3");
  });

  it("classifies age groups by the belt's upper age", () => {
    expect(beltAgeGroup({ minAge: 4, maxAge: 15, minClasses: null, minimumTime: null })).toBe("kids");
    expect(beltAgeGroup({ minAge: 16, maxAge: null, minClasses: null, minimumTime: null })).toBe("adults");
    expect(beltAgeGroup({ minAge: null, maxAge: null, minClasses: null, minimumTime: null })).toBe("adults");
  });

  it("lists each colour once with the first belt that wears it", () => {
    const groups = groupBelts({ definitions: [white, blue, blueAlias] });
    expect(distinctBeltColors(groups)).toEqual([
      { color: "#ffffff", name: "White (kids)" },
      { color: "#1f4fa3", name: "Blue" },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run --project web apps/web/src/app/levels/levels-grouping.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { LevelCatalogProjection, LevelCriteria, LevelDefinitionRecord } from "@bpt-jersey/domain/levels";

export type BeltAgeGroup = "kids" | "adults";

export type BeltGroup = Readonly<{
  belt: LevelDefinitionRecord;
  stripes: readonly LevelDefinitionRecord[];
  ageGroup: BeltAgeGroup;
  primaryColor: string;
}>;

/** ponytail: the catalogue encodes age in criteria; anything capped below 16 is a kids' belt. */
export function beltAgeGroup(criteria: LevelCriteria): BeltAgeGroup {
  return criteria.maxAge !== null && criteria.maxAge < 16 ? "kids" : "adults";
}

export function groupBelts(catalog: Pick<LevelCatalogProjection, "definitions">): readonly BeltGroup[] {
  const belts = catalog.definitions.filter((d) => d.kind === "belt").sort((a, b) => a.sequence - b.sequence);
  const stripesByParent = new Map<string, LevelDefinitionRecord[]>();
  for (const stripe of catalog.definitions.filter((d) => d.kind === "stripe" && d.parentDefinitionKey)) {
    const list = stripesByParent.get(stripe.parentDefinitionKey!) ?? [];
    list.push(stripe);
    stripesByParent.set(stripe.parentDefinitionKey!, list);
  }
  return Object.freeze(
    belts.map((belt) =>
      Object.freeze({
        belt,
        stripes: Object.freeze(
          (stripesByParent.get(belt.definitionKey) ?? []).sort(
            (a, b) => (a.stripeNumber ?? 0) - (b.stripeNumber ?? 0) || a.sequence - b.sequence,
          ),
        ),
        ageGroup: beltAgeGroup(belt.criteria),
        primaryColor: belt.visual.colors[0] ?? "#ffffff",
      }),
    ),
  );
}

export function distinctBeltColors(
  groups: readonly BeltGroup[],
): readonly Readonly<{ color: string; name: string }>[] {
  const seen = new Map<string, string>();
  for (const group of groups) {
    if (!seen.has(group.primaryColor)) seen.set(group.primaryColor, group.belt.name);
  }
  return Object.freeze([...seen.entries()].map(([color, name]) => Object.freeze({ color, name })));
}

export function formatAgeRange(minAge: number | null, maxAge: number | null): string {
  if (minAge !== null && maxAge !== null) return `${minAge}–${maxAge} yrs`;
  if (minAge !== null) return `${minAge}+ yrs`;
  if (maxAge !== null) return `Up to ${maxAge} yrs`;
  return "All ages";
}

export function formatMinimumTime(time: LevelCriteria["minimumTime"]): string {
  if (!time) return "None";
  const parts: string[] = [];
  if (time.years > 0) parts.push(`${time.years} ${time.years === 1 ? "yr" : "yrs"}`);
  if (time.months > 0) parts.push(`${time.months} ${time.months === 1 ? "mo" : "mos"}`);
  if (time.days > 0) parts.push(`${time.days} ${time.days === 1 ? "day" : "days"}`);
  return parts.length > 0 ? parts.join(" ") : "None";
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project web apps/web/src/app/levels/levels-grouping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/levels/levels-grouping.ts apps/web/src/app/levels/levels-grouping.test.ts
git commit -m "feat(levels): group the catalogue into belts with stripes, age group and colour"
```

---

### Task 12: Belt cards browser and DESIGN.md §10 (web + docs)

**Files:**
- Modify: `apps/web/src/app/levels/levels-browser.tsx` (rewrite the render; keep the load/error state machine), `apps/web/src/app/levels/levels.css` (rewrite), `apps/web/src/app/levels/levels-browser.test.tsx`, `apps/web/src/app/admin/levels/page.tsx` (title copy), `DESIGN.md` (append §10).

**Interfaces:**
- Consumes: Task 11. `LevelsBrowser` keeps its props (`roleContext`).
- Produces markup contract used by the Playwright spec: `section[aria-labelledby=levels-heading]`; `radiogroup[aria-label="Age group"]` with radios `All`, `Kids`, `Adults`; `group[aria-label="Belt colour"]` with buttons `aria-pressed`; `region[aria-label="Belts"]` containing `article.belt-card` each with `.belt-bar` (`role="img"`, `aria-label="{name} belt"`) and `h2`.

- [ ] **Step 1: Write the failing tests** (replace the existing `levels-browser.test.tsx` render assertions; keep its `vi.mock("../../lib/levels-client")` and catalogue fixture, extending the fixture with a kids belt with two stripes and an adult belt of a different colour)

```tsx
it("renders one card per belt with its stripes inside", async () => {
  render(<LevelsBrowser roleContext="admin" />);
  const belts = await screen.findByRole("region", { name: "Belts" });
  expect(within(belts).getAllByRole("article")).toHaveLength(2);
  const kids = within(belts).getByRole("article", { name: "White (kids)" });
  expect(within(kids).getByRole("img", { name: "White (kids) belt" })).toHaveStyle({ backgroundColor: "#ffffff" });
  expect(within(kids).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
    expect.stringContaining("1st stripe"),
    expect.stringContaining("2nd stripe"),
  ]);
  expect(screen.queryByText(/^stripe$/iu)).toBeNull(); // no separate stripe cards
});

it("filters by age group and by colour", async () => {
  render(<LevelsBrowser roleContext="coach" />);
  await screen.findByRole("region", { name: "Belts" });
  fireEvent.click(screen.getByRole("radio", { name: "Adults" }));
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("article", { name: "Blue" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "All" }));
  fireEvent.click(screen.getByRole("button", { name: "Filter by White (kids) colour" }));
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("article", { name: "White (kids)" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run --project web apps/web/src/app/levels/levels-browser.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite the render of `levels-browser.tsx`**

Keep `useEffect` loading, `triggerLoad`, `skillsMap`, `requirementsByDefKey`. Replace `kindFilter` with `ageFilter: "all" | "kids" | "adults"` and `colorFilter: string | null`. Compute:

```ts
const groups = useMemo(() => (catalog ? groupBelts(catalog) : []), [catalog]);
const colours = useMemo(() => distinctBeltColors(groups), [groups]);
const visible = groups.filter((g) => {
  if (ageFilter !== "all" && g.ageGroup !== ageFilter) return false;
  if (colorFilter && g.primaryColor !== colorFilter) return false;
  const q = searchQuery.trim().toLowerCase();
  return !q || g.belt.name.toLowerCase().includes(q) || g.stripes.some((s) => s.name.toLowerCase().includes(q));
});
```

Render:

```tsx
<section aria-labelledby="levels-heading" className="levels-container" data-role-context={roleContext}>
  <header className="levels-header">
    <p className="admin-eyebrow">Mat / Levels</p>
    <h1 className="levels-title" id="levels-heading">{catalog.system.displayName}</h1>
    <p className="levels-subtitle">{catalog.system.counts.belts} belts · {catalog.system.counts.stripes} stripes · {catalog.skills.length} evaluated techniques</p>
  </header>
  <div className="levels-controls" role="search" aria-label="Search and filter belts">
    <label className="levels-search">
      <span>Search belts</span>
      <input onChange={(e) => setSearchQuery(e.target.value)} placeholder="White, Grey, Blue…" type="search" value={searchQuery} />
    </label>
    <div className="levels-choice-row" role="radiogroup" aria-label="Age group">
      {(["all", "kids", "adults"] as const).map((value) => (
        <button aria-checked={ageFilter === value} className="levels-choice" key={value} onClick={() => setAgeFilter(value)} role="radio" type="button">
          {value === "all" ? "All" : value === "kids" ? "Kids" : "Adults"}
        </button>
      ))}
    </div>
    <div className="levels-colours" role="group" aria-label="Belt colour">
      {colours.map(({ color, name }) => (
        <button aria-label={`Filter by ${name} colour`} aria-pressed={colorFilter === color} className="levels-colour" key={color} onClick={() => setColorFilter(colorFilter === color ? null : color)} style={{ "--belt": color } as React.CSSProperties} type="button" />
      ))}
    </div>
  </div>
  {visible.length === 0 ? (
    <p className="levels-empty" role="status">No belts match this filter.</p>
  ) : (
    <div aria-label="Belts" className="levels-grid" role="region">
      {visible.map(({ belt, stripes, ageGroup }) => (
        <article aria-labelledby={`belt-${belt.definitionKey}`} className="belt-card" key={belt.definitionKey}>
          <BeltBar name={belt.name} stripeCount={stripes.length} visual={belt.visual} />
          <p className="belt-eyebrow">{ageGroup === "kids" ? "Kids" : "Adults"} · #{belt.sequence}</p>
          <h2 className="belt-name" id={`belt-${belt.definitionKey}`}>{belt.name}</h2>
          <dl className="belt-criteria">
            <div><dt>Age</dt><dd>{formatAgeRange(belt.criteria.minAge, belt.criteria.maxAge)}</dd></div>
            <div><dt>Min classes</dt><dd>{belt.criteria.minClasses ?? "None"}</dd></div>
            <div><dt>Min time</dt><dd>{formatMinimumTime(belt.criteria.minimumTime)}</dd></div>
          </dl>
          {stripes.length > 0 ? (
            <ol aria-label={`${belt.name} stripes`} className="belt-stripes">
              {stripes.map((s) => (
                <li key={s.definitionKey}>
                  <strong>{ordinal(s.stripeNumber ?? 0)} stripe</strong>
                  <span>{s.criteria.minClasses ? `${s.criteria.minClasses} classes` : "—"} · {formatMinimumTime(s.criteria.minimumTime)}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {(requirementsByDefKey.get(belt.definitionKey) ?? []).length > 0 ? (
            <p className="belt-skills"><span>Techniques</span> {requirementsByDefKey.get(belt.definitionKey)!.join(" · ")}</p>
          ) : null}
        </article>
      ))}
    </div>
  )}
</section>
```

`BeltBar`:

```tsx
function BeltBar({ name, stripeCount, visual }: { name: string; stripeCount: number; visual: LevelDefinitionRecord["visual"] }) {
  const [first = "#ffffff", second, third] = visual.colors;
  const background = third ? `linear-gradient(to right, ${first} 33%, ${second} 33% 66%, ${third} 66%)` : second ? `linear-gradient(to right, ${first} 50%, ${second} 50%)` : first;
  return (
    <div aria-label={`${name} belt`} className="belt-bar" role="img" style={{ background, backgroundColor: first }}>
      <span className="belt-tip" style={{ "--tip": visual.stripeColor ?? "#1A1A18" } as React.CSSProperties}>
        {Array.from({ length: Math.min(stripeCount, 4) }, (_, i) => <i key={i} />)}
      </span>
    </div>
  );
}
function ordinal(n: number): string { return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 || Math.floor((n % 100) / 10) === 1 ? 0 : n % 10]}`; }
```

Rewrite `levels.css` with the project tokens (no blue, radius 0, no pills, no blur):

```css
.levels-container { display: grid; gap: 1.5rem; }
.levels-header { max-width: 58rem; }
.levels-title { font-family: var(--font-display), Impact, sans-serif; font-size: clamp(2.4rem, 5vw, 3.6rem); letter-spacing: 0.035em; line-height: 1; margin: 0.25rem 0 0.5rem; text-transform: uppercase; }
.levels-subtitle { color: var(--muted); margin: 0; font-variant-numeric: tabular-nums; }
.levels-controls { background: var(--gi-white); border-top: 0.35rem solid var(--bpt-purple); display: grid; gap: 1rem; padding: 1rem; }
.levels-search { display: grid; gap: 0.35rem; font-weight: 600; }
.levels-search input { border: 1px solid var(--line, #8a8880); border-radius: 0; font: inherit; min-height: 3rem; padding: 0 0.75rem; }
.levels-search input:focus-visible, .levels-choice:focus-visible, .levels-colour:focus-visible { outline: 3px solid var(--bpt-purple); outline-offset: 3px; }
.levels-choice-row, .levels-colours { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.levels-choice { background: var(--gi-white); border: 1px solid var(--mat-ink); cursor: pointer; font: inherit; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.04em; min-height: 3.15rem; padding: 0.5rem 1rem; text-transform: uppercase; }
.levels-choice[aria-checked="true"] { background: var(--bpt-purple); border-color: var(--bpt-purple); color: var(--gi-white); }
.levels-colour { background: var(--belt); border: 2px solid var(--mat-ink); cursor: pointer; height: 2.75rem; width: 2.75rem; }
.levels-colour[aria-pressed="true"] { box-shadow: 0 0 0 3px var(--gi-white), 0 0 0 6px var(--bpt-purple); }
.levels-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr)); }
.belt-card { background: var(--gi-white); border: 1px solid var(--paper-edge, #d9d8d2); display: grid; gap: 0.6rem; min-width: 0; padding: 0 0 1.1rem; }
.belt-bar { border-bottom: 1px solid var(--mat-ink); display: flex; height: 2.25rem; justify-content: flex-end; }
.belt-tip { align-items: center; background: var(--tip); display: flex; gap: 0.3rem; justify-content: center; min-width: 5rem; padding: 0 0.6rem; }
.belt-tip i { background: var(--gi-white); display: block; height: 1.4rem; width: 0.35rem; }
.belt-eyebrow { color: var(--bpt-purple); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.15em; margin: 0.6rem 1.1rem 0; text-transform: uppercase; }
.belt-name { font-family: var(--font-display), Impact, sans-serif; font-size: 1.9rem; letter-spacing: 0.035em; line-height: 1; margin: 0 1.1rem; text-transform: uppercase; }
.belt-criteria { display: grid; gap: 0.35rem 1rem; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0 1.1rem; }
.belt-criteria dt { color: var(--muted); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; }
.belt-criteria dd { font-variant-numeric: tabular-nums; font-weight: 600; margin: 0; }
.belt-stripes { border-top: 1px solid var(--paper-edge, #e8e7e3); display: grid; gap: 0.35rem; list-style: none; margin: 0 1.1rem; padding: 0.6rem 0 0; }
.belt-stripes li { display: flex; flex-wrap: wrap; gap: 0.4rem 0.75rem; justify-content: space-between; font-variant-numeric: tabular-nums; }
.belt-stripes span { color: var(--muted); }
.belt-skills { border-left: 0.35rem solid var(--bpt-purple); color: var(--muted); font-size: 0.9rem; margin: 0 1.1rem; padding-left: 0.75rem; }
.belt-skills span { color: var(--bpt-purple); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; }
.levels-empty, .levels-loading, .levels-error { background: var(--gi-white); border-left: 0.35rem solid var(--bpt-purple); padding: 1rem 1.25rem; }
.levels-error { border-left-color: #8d1c2f; }
@media (max-width: 50rem) { .levels-grid { grid-template-columns: minmax(0, 1fr); } .belt-criteria { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
```

Loading state: replace the "Loading IBJJF Level Catalog..." paragraph with three `.belt-card` skeleton blocks (`aria-busy="true"`, Paper Edge background) — DESIGN.md forbids spinners and asks skeletons to reserve the layout.

`apps/web/src/app/admin/levels/page.tsx`: description → "Belts by colour and age group, with the stripes, minimum classes and time behind each one."

DESIGN.md — append:

```markdown
## 10. Belt colours are data (Levels)

The level catalogue carries each belt's real colours (`visual.colors`, `stripeColor`). Inside
`.belt-bar` those hex values are **data, not decoration**, so blue, yellow, orange, green, brown and
black are allowed there and nowhere else. They never become an accent, a background, a tag or text
colour; the card around the bar stays Gi White with Mat Ink and the single purple eyebrow. A belt
card is one `<article>` per belt; stripes are marks on the bar's ink tip plus an ordered list, never
separate cards.
```

- [ ] **Step 4: Run the tests and lint**

Run: `corepack pnpm vitest run --project web apps/web/src/app/levels apps/web/src/app/admin/levels apps/web/src/app/coach/levels && corepack pnpm lint`
Expected: PASS; if `toHaveStyle` is not available, assert `style.backgroundColor` on the element instead.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/levels apps/web/src/app/admin/levels DESIGN.md
git commit -m "feat(levels): belt cards with stripes, age and colour filters; DESIGN.md belt colour rule"
```

---

### Task 13: Finance domain — nullable membership, recent payment row, member name row

**Files:**
- Modify: `packages/domain/src/finance/finance-contracts.ts` (`InvoiceRecord`, `parseInvoiceValues`; add `recentPaymentsLimit`, `RecentPaymentRow`, `isRecentPaymentRow`), `packages/domain/src/members/member-directory-contracts.ts` (add `memberNameRowSchema`, `MemberNameRow`, `memberNamesLimit`).
- Test: `packages/domain/src/finance/finance-contracts.test.ts`, `packages/domain/src/members/member-directory-contracts.test.ts`, `packages/domain/src/finance/financial-dashboard.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  // finance
  InvoiceRecord.membershipId: string | null
  export const recentPaymentsLimit = 20;
  export type RecentPaymentRow = Readonly<{ paymentId: string; occurredAt: string; amountMinor: number; method: ManualPaymentMethod; manualReference: string; invoiceReference: string; description: string; familyId: string; memberName: string | null }>;
  export function isRecentPaymentRow(value: unknown): value is RecentPaymentRow;
  // members
  export const memberNamesLimit = 2000;
  export const memberNameRowSchema = z.strictObject({ studentId: opaqueIdentifierSchema, fullName: canonicalText(160), familyId: opaqueIdentifierSchema.nullable() });
  export type MemberNameRow = Readonly<z.infer<typeof memberNameRowSchema>>;
  ```

- [ ] **Step 1: Write the failing tests**

`finance-contracts.test.ts`:

```ts
it("accepts an invoice without a membership and still rejects a wrong identifier", () => {
  const base = validInvoiceRecordFixture(); // the file's existing valid invoice literal
  expect(parseInvoiceRecord({ ...base, membershipId: null }).ok).toBe(true);
  expect(parseInvoiceRecord({ ...base, membershipId: "bad id" }).ok).toBe(false);
  expect(parseInvoiceRecord({ ...base, membershipId: undefined }).ok).toBe(false);
});

it("guards a recent payment row", () => {
  const row = { paymentId: "p1", occurredAt: "2026-09-13T10:00:00.000Z", amountMinor: 7500, method: "cash", manualReference: "CASH-1", invoiceReference: "INV-1", description: "September", familyId: "f1", memberName: "Ana Coelho" };
  expect(isRecentPaymentRow(row)).toBe(true);
  expect(isRecentPaymentRow({ ...row, memberName: null })).toBe(true);
  expect(isRecentPaymentRow({ ...row, method: "card" })).toBe(false);
  expect(isRecentPaymentRow({ ...row, extra: 1 })).toBe(false);
  expect(recentPaymentsLimit).toBe(20);
});
```

`financial-dashboard.test.ts`: add a case where one invoice has `membershipId: null` and assert `buildFinancialDashboard` still returns it in `balanceAttention` (it never reads `membershipId`).

`member-directory-contracts.test.ts`:

```ts
it("parses a member name row", () => {
  expect(memberNameRowSchema.safeParse({ studentId: "s1", fullName: "Ana Coelho", familyId: null }).success).toBe(true);
  expect(memberNameRowSchema.safeParse({ studentId: "s1", fullName: "Ana Coelho", familyId: "f1", email: "x" }).success).toBe(false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `corepack pnpm vitest run --project node packages/domain/src/finance packages/domain/src/members/member-directory-contracts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`finance-contracts.ts`: `membershipId: string | null;` in `InvoiceRecord`. In `parseInvoiceValues`, remove `"membershipId"` from the `identifiers` loop and add:

```ts
  if (data.membershipId !== null && !validString(data.membershipId, 128, identifierPattern)) {
    issues.push(issue(["membershipId"], "invalid_identifier"));
  }
```

(`readExactFields` still requires the key to be present, so `undefined` keeps failing.) Append:

```ts
export const recentPaymentsLimit = 20;

export type RecentPaymentRow = Readonly<{
  paymentId: string;
  occurredAt: string;
  amountMinor: number;
  method: ManualPaymentMethod;
  manualReference: string;
  invoiceReference: string;
  description: string;
  familyId: string;
  memberName: string | null;
}>;

const recentPaymentRowFields = Object.freeze([
  "paymentId", "occurredAt", "amountMinor", "method", "manualReference",
  "invoiceReference", "description", "familyId", "memberName",
] as const);

export function isRecentPaymentRow(value: unknown): value is RecentPaymentRow {
  if (!isPlainRecord(value)) return false;
  const fields = readExactFields(value, recentPaymentRowFields);
  if (!fields.ok) return false;
  const row = fields.value;
  return (
    validString(row.paymentId, 128, identifierPattern) &&
    validDateTime(row.occurredAt) &&
    validAmount(row.amountMinor) &&
    validEnum(row.method, manualPaymentMethods) &&
    validString(row.manualReference, 128, manualReferencePattern) &&
    validString(row.invoiceReference, 128, identifierPattern) &&
    validString(row.description, 200) &&
    validString(row.familyId, 128, identifierPattern) &&
    (row.memberName === null || validString(row.memberName, 160))
  );
}
```

(`validString`, `validDateTime`, `validAmount`, `validEnum`, `readExactFields`, `isPlainRecord` are the file's existing helpers; check their exact signatures before using them.)

`member-directory-contracts.ts` (after `adminDirectoryRowSchema`):

```ts
export const memberNamesLimit = 2000;

/** The lightest member list the office needs to pick somebody: name, id and billing family. */
export const memberNameRowSchema = z.strictObject({
  studentId: opaqueIdentifierSchema,
  fullName: canonicalText(160),
  familyId: opaqueIdentifierSchema.nullable(),
});
export type MemberNameRow = Readonly<z.infer<typeof memberNameRowSchema>>;
```

- [ ] **Step 4: Run the tests and typecheck the whole repo** (the nullable membership will surface every `invoice.membershipId` consumer)

Run: `corepack pnpm vitest run --project node packages/domain/src/finance packages/domain/src/members && corepack pnpm typecheck`
Expected: tests PASS; typecheck lists the consumers in `apps/functions/src/finance/*` (fixed in Task 14), `apps/functions/src/reports/*` (if any: treat `null` as "no membership" in the same expression), `apps/web/src/app/admin/billing/page.tsx` (fixed in Task 20 — for now guard with `view.invoice.membershipId ?? ""`). Fix every non-finance consumer minimally in this task so typecheck is clean before committing.

- [ ] **Step 5: Commit**

```bash
git add -A packages/domain apps/functions/src/reports apps/web/src/app/admin/billing apps/web/src/app/account
git commit -m "feat(domain): invoices without a membership, recent payment rows and member name rows"
```

---

### Task 14: Finance store — invoice without membership, recent payments (functions)

**Files:**
- Modify: `apps/functions/src/finance/finance-service.ts` (`IssueManualInvoiceInput`, `sourceRecords`, `invoicePayload`, `matchesStudentScopeInTransaction`, `FinanceStore` type, new `listRecentPayments`), `apps/functions/src/finance/financial-dashboard-service.ts` (`validateRelationships`).
- Test: `apps/functions/src/finance/finance-service.test.ts`, `apps/functions/src/finance/financial-dashboard-service.test.ts`.

**Interfaces:**
- `IssueManualInvoiceInput.membershipId: string | null`.
- `FinanceStore.listRecentPayments(academyId: string, limit: number): Promise<readonly RecentPaymentRow[]>`.
- `FinanceStore.listFinancialAccount(scope: FinanceReadScope)` already exists and is reused by Task 15 with `{ academyId, familyIds: [familyId] }`.

- [ ] **Step 1: Write the failing tests** (follow the file's existing in-memory Firestore fake)

```ts
it("issues an invoice with no membership and reads it back for the family only", async () => {
  const { store, firestore } = storeWithFamily("family-1"); // the file's helper that seeds academies/{a}/families/family-1
  const invoice = await store.issueManualInvoice({ academyId, actorId: "owner-1", familyId: "family-1", membershipId: null, totalMinor: 1500, dueAt: "2026-10-01T23:59:59.000Z", chargeKind: "manual_adjustment", invoiceReference: "INV-SEM-1", description: "Seminar" });
  expect(invoice.membershipId).toBeNull();
  const familyView = await store.listFinancialAccount({ academyId, familyIds: ["family-1"] });
  expect(familyView.invoices.map((v) => v.invoice.invoiceId)).toContain(invoice.invoiceId);
  const studentView = await store.listFinancialAccount({ academyId, familyIds: ["family-1"], studentIds: ["student-1"] });
  expect(studentView.invoices.map((v) => v.invoice.invoiceId)).not.toContain(invoice.invoiceId);
  expect(firestore.reads.some((path) => path.includes("/memberships/"))).toBe(false);
});

it("lists the most recent payments with the member's name when a membership links one", async () => {
  const { store } = storeWithFamilyMembershipAndStudent({ familyId: "family-1", membershipId: "m-1", studentId: "student-1", fullName: "Ana Coelho" });
  const withMember = await store.issueManualInvoice({ academyId, actorId: "owner-1", familyId: "family-1", membershipId: "m-1", totalMinor: 7500, dueAt: "2026-10-01T23:59:59.000Z", chargeKind: "membership", invoiceReference: "INV-1", description: "September" });
  const withoutMember = await store.issueManualInvoice({ academyId, actorId: "owner-1", familyId: "family-1", membershipId: null, totalMinor: 1500, dueAt: "2026-10-01T23:59:59.000Z", chargeKind: "manual_adjustment", invoiceReference: "INV-2", description: "Seminar" });
  await store.recordManualPayment({ academyId, actorId: "owner-1", invoiceId: withMember.invoiceId, amountMinor: 7500, method: "bank_transfer", manualReference: "BT-1", occurredAt: "2026-09-10T10:00:00.000Z" });
  await store.recordManualPayment({ academyId, actorId: "owner-1", invoiceId: withoutMember.invoiceId, amountMinor: 1500, method: "cash", manualReference: "CASH-1", occurredAt: "2026-09-12T10:00:00.000Z" });
  const rows = await store.listRecentPayments(academyId, 20);
  expect(rows.map((r) => [r.manualReference, r.memberName, r.method])).toEqual([
    ["CASH-1", null, "cash"],
    ["BT-1", "Ana Coelho", "bank_transfer"],
  ]);
  expect(await store.listRecentPayments(academyId, 1)).toHaveLength(1);
});
```

Write `storeWithFamily` / `storeWithFamilyMembershipAndStudent` on top of the fake the file already uses (seed `families/family-1`, `memberships/m-1` with `{ membershipId, familyId, studentId, academyId, … }` and `students/student-1` with `{ fullName }`). The fake's query must support `orderBy("occurredAt", "desc").limit(n)` for the payments collection; extend the fake if it does not.

- [ ] **Step 2: Run to verify they fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/finance/finance-service.test.ts -t "no membership|recent payments"`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `IssueManualInvoiceInput.membershipId: string | null`.
- `sourceRecords`: read the family always; read and validate the membership only `if (input.membershipId !== null)`.
- `invoicePayload`: `membershipId: input.membershipId === null ? null : pathSegment(input.membershipId, "membership")`.
- `matchesStudentScopeInTransaction`: at the top, `if (invoice.membershipId === null) return scope.studentIds === undefined;` (family-scoped and office readers see it; student-scoped readers do not).
- Idempotent re-issue check compares `existing.membershipId !== requested.membershipId` — already null-safe.
- `listRecentPayments`:

```ts
    async listRecentPayments(academyId, limit) {
      const academy = pathSegment(academyId, "academy");
      const snapshot = querySnapshot(
        await dependencies.firestore
          .collection(paymentsPath(academy))
          .orderBy("occurredAt", "desc")
          .limit(limit)
          .get(),
      );
      const payments = snapshot.docs.map((document) => parseScopedStoredPayment(document, academy));
      const invoiceIds = [...new Set(payments.map((payment) => payment.invoiceId))];
      const invoices = new Map<string, InvoiceRecord>();
      for (const invoiceId of invoiceIds) {
        const document = documentSnapshot(await dependencies.firestore.doc(invoicePath(academy, invoiceId)).get());
        invoices.set(invoiceId, parseScopedStoredInvoice(document, academy));
      }
      const names = new Map<string, string | null>();
      for (const invoice of invoices.values()) {
        if (invoice.membershipId === null || names.has(invoice.membershipId)) continue;
        const membership = await dependencies.firestore.doc(membershipPath(academy, invoice.membershipId)).get();
        const studentId = membership.exists ? (membership.data()?.studentId as unknown) : undefined;
        if (typeof studentId !== "string") { names.set(invoice.membershipId, null); continue; }
        const student = await dependencies.firestore.doc(`academies/${academy}/students/${pathSegment(studentId, "student")}`).get();
        const fullName = student.exists ? (student.data()?.fullName as unknown) : undefined;
        names.set(invoice.membershipId, typeof fullName === "string" && fullName.trim() ? fullName.trim() : null);
      }
      return Object.freeze(
        payments.map((payment) => {
          const invoice = invoices.get(payment.invoiceId)!;
          return Object.freeze({
            paymentId: payment.paymentId,
            occurredAt: payment.occurredAt,
            amountMinor: payment.amountMinor,
            method: payment.method,
            manualReference: payment.manualReference,
            invoiceReference: invoice.invoiceReference,
            description: invoice.description,
            familyId: payment.familyId,
            memberName: invoice.membershipId === null ? null : (names.get(invoice.membershipId) ?? null),
          });
        }),
      );
    },
```

  Check the `FinanceFirestore`/`FinanceQuery` types at the top of the file: if `orderBy` is missing from `FinanceQuery`, add `orderBy: (field: string, direction: "asc" | "desc") => FinanceQuery; limit: (n: number) => FinanceQuery; get: () => Promise<FinanceQuerySnapshot>` and satisfy them in the test fake. Firestore's real `CollectionReference` already has them.

- `financial-dashboard-service.ts` `validateRelationships`: `if (invoice.membershipId === null) continue;` before the membership lookup.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project node apps/functions/src/finance`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/finance
git commit -m "feat(functions): invoices without a membership and the recent payments read"
```

---

### Task 15: Finance callables `listRecentPayments` and `getFamilyFinancialAccount` (functions)

**Files:**
- Modify: `apps/functions/src/finance/finance-callables.ts` (`parseManualInvoicePayload` accepts `membershipId: null`; add `parseFamilyIdPayload`, `listRecentPaymentsHandler`, `getFamilyFinancialAccountHandler`, two `onCall` exports), `apps/functions/src/index.ts`.
- Test: `apps/functions/src/finance/finance-callables.test.ts`.

**Interfaces:**
- `listRecentPayments` — `requireAdministrator`; payload `null`; response `{ payments: RecentPaymentRow[] }` (`recentPaymentsLimit`).
- `getFamilyFinancialAccount` — `requireAdministrator`; payload `{ familyId }`; response `FinancialAccountView`.

- [ ] **Step 1: Write the failing tests**

```ts
it("issues an invoice with membershipId null and rejects a missing key", async () => {
  const s = services();
  (s.store.issueManualInvoice as ReturnType<typeof vi.fn>).mockResolvedValue({ invoiceId: "i1" });
  const payload = { familyId: "family-1", membershipId: null, totalMinor: 1500, dueAt: "2026-10-01T23:59:59.000Z", chargeKind: "manual_adjustment", invoiceReference: "INV-SEM-1", description: "Seminar" };
  await expect(issueManualInvoiceHandler(request(payload, actor("owner")), s)).resolves.toEqual({ invoiceId: "i1" });
  expect(s.store.issueManualInvoice).toHaveBeenCalledWith(expect.objectContaining({ membershipId: null }));
  const { membershipId: _omit, ...missing } = payload;
  await expect(issueManualInvoiceHandler(request(missing, actor("owner")), s)).rejects.toMatchObject({ code: "invalid-argument" });
});

it("lists recent payments for office roles only", async () => {
  const s = services({ store: { ...(services().store as object), listRecentPayments: vi.fn().mockResolvedValue([]) } as unknown as FinanceStore });
  await expect(listRecentPaymentsHandler(request(null, actor("administrator")), s)).resolves.toEqual({ payments: [] });
  expect(s.store.listRecentPayments).toHaveBeenCalledWith(academyId, 20);
  await expect(listRecentPaymentsHandler(request(null, actor("coach"))), s).rejects.toMatchObject({ code: "permission-denied" });
  await expect(listRecentPaymentsHandler(request({}, actor("owner")), s)).rejects.toMatchObject({ code: "invalid-argument" });
});

it("reads one family's account for the office and refuses guardians", async () => {
  const s = services();
  await expect(getFamilyFinancialAccountHandler(request({ familyId: "family-9" }, actor("owner")), s)).resolves.toMatchObject({ invoices: [] });
  expect(s.store.listFinancialAccount).toHaveBeenCalledWith({ academyId, familyIds: ["family-9"] });
  await expect(getFamilyFinancialAccountHandler(request({ familyId: "family-9" }, actor("guardian")), s)).rejects.toMatchObject({ code: "permission-denied" });
  await expect(getFamilyFinancialAccountHandler(request({ familyId: "bad id" }, actor("owner")), s)).rejects.toMatchObject({ code: "invalid-argument" });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `corepack pnpm vitest run --project node apps/functions/src/finance/finance-callables.test.ts -t "membershipId null|recent payments|family's account"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`parseManualInvoicePayload`: `membershipId: descriptorValue(value, "membershipId") === null ? null : parseId(descriptorValue(value, "membershipId"))`.

```ts
function parseFamilyIdPayload(value: unknown): string {
  if (!isPlainRecord(value) || !exactFields(value, ["familyId"])) return invalidPayload();
  return parseId(descriptorValue(value, "familyId"));
}

export async function listRecentPaymentsHandler(
  request: CallableRequest<unknown>,
  services: FinanceCallableServices,
): Promise<{ payments: readonly RecentPaymentRow[] }> {
  const actor = await requireAdministrator(request, services);
  parseNoPayload(request.data);
  try {
    return { payments: await services.store.listRecentPayments(actor.academyId, recentPaymentsLimit) };
  } catch (error) {
    return mapStoreError(error, "read");
  }
}

export async function getFamilyFinancialAccountHandler(
  request: CallableRequest<unknown>,
  services: FinanceCallableServices,
): Promise<FinancialAccountView> {
  const actor = await requireAdministrator(request, services);
  const familyId = parseFamilyIdPayload(request.data);
  try {
    return await services.store.listFinancialAccount({ academyId: actor.academyId, familyIds: [familyId] });
  } catch (error) {
    return mapStoreError(error, "read");
  }
}

export const listRecentPayments = onCall(financeCallableOptions, (request) =>
  listRecentPaymentsHandler(request, callableServices()),
);
export const getFamilyFinancialAccount = onCall(financeCallableOptions, (request) =>
  getFamilyFinancialAccountHandler(request, callableServices()),
);
```

Use the same options object and `callableServices()` factory the existing finance exports use (names may differ: read the bottom of the file). `index.ts`: add both names to the finance export block.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project node apps/functions/src/finance && corepack pnpm --filter @bpt-jersey/functions typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/finance apps/functions/src/index.ts
git commit -m "feat(functions): listRecentPayments and getFamilyFinancialAccount; invoices accept membershipId null"
```

---

### Task 16: `listMemberNames` callable (functions)

**Files:**
- Create: `apps/functions/src/members/member-names-callables.ts`, `apps/functions/src/members/member-names-callables.test.ts`
- Modify: `apps/functions/src/index.ts`

**Interfaces:**
- `listMemberNames` — owner/administrator (`requireAdminActor`, the same helper `member-callables.ts` imports; confirm its import path there); payload `null`; response `{ members: MemberNameRow[] }`, active students only, sorted by `fullName`, `memberNamesLimit` (2 000) enforced with the "read limit + 1, fail if exceeded" rule.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";

import { listMemberNamesHandler } from "./member-names-callables";

function fakeRequest(data: unknown, role = "owner", uid: string | null = "u1", academyId = "academy-1") {
  return { data, auth: uid ? { uid, token: { academyId, role } } : undefined } as never;
}
function store(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return {
    listActiveStudents: vi.fn(async (_academyId: string, limit: number) => docs.slice(0, limit)),
  };
}

describe("listMemberNames", () => {
  it("returns active students sorted by name with a nullable family", async () => {
    const result = await listMemberNamesHandler(fakeRequest(null), {
      store: store([
        { id: "s2", data: { fullName: "Zé Pinto", familyId: "f2", status: "active" } },
        { id: "s1", data: { fullName: "Ana Coelho", status: "active" } },
      ]),
    });
    expect(result).toEqual({
      members: [
        { studentId: "s1", fullName: "Ana Coelho", familyId: null },
        { studentId: "s2", fullName: "Zé Pinto", familyId: "f2" },
      ],
    });
  });

  it("refuses coaches, anonymous callers and payloads", async () => {
    const s = store([]);
    await expect(listMemberNamesHandler(fakeRequest(null, "coach"), { store: s })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(listMemberNamesHandler(fakeRequest(null, "owner", null), { store: s })).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(listMemberNamesHandler(fakeRequest({}), { store: s })).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("fails instead of returning a partial list above the limit", async () => {
    const docs = Array.from({ length: 2001 }, (_, i) => ({ id: `s${i}`, data: { fullName: `Member ${i}`, status: "active" } }));
    await expect(listMemberNamesHandler(fakeRequest(null), { store: store(docs) })).rejects.toMatchObject({ code: "failed-precondition" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/member-names-callables.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { memberNameRowSchema, memberNamesLimit, type MemberNameRow } from "@bpt-jersey/domain/members/directory";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireAdminActor } from "../auth/admin-authorization.js";

export type MemberNamesStore = Readonly<{
  listActiveStudents: (
    academyId: string,
    limit: number,
  ) => Promise<readonly Readonly<{ id: string; data: Record<string, unknown> }>[]>;
}>;

export async function listMemberNamesHandler(
  request: CallableRequest<unknown>,
  services: { store: MemberNamesStore },
): Promise<{ members: readonly MemberNameRow[] }> {
  const actor = requireAdminActor(request);
  if (request.data !== null) throw new HttpsError("invalid-argument", "Member names payload must be null");
  const documents = await services.store.listActiveStudents(actor.academyId, memberNamesLimit + 1);
  if (documents.length > memberNamesLimit) {
    throw new HttpsError("failed-precondition", "Too many members to list at once");
  }
  const members: MemberNameRow[] = [];
  for (const document of documents) {
    const parsed = memberNameRowSchema.safeParse({
      studentId: document.id,
      fullName: typeof document.data.fullName === "string" ? document.data.fullName.trim() : "",
      familyId: typeof document.data.familyId === "string" ? document.data.familyId : null,
    });
    if (parsed.success) members.push(parsed.data);
  }
  members.sort((left, right) => left.fullName.localeCompare(right.fullName));
  return { members: Object.freeze(members) };
}

function firestoreStore(): MemberNamesStore {
  return {
    async listActiveStudents(academyId, limit) {
      const snapshot = await getFirestore()
        .collection(`academies/${academyId}/students`)
        .where("status", "==", "active")
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }));
    },
  };
}

export const listMemberNames = onCall(
  { ...browserAdminCallableOptions, enforceAppCheck: true, consumeAppCheckToken: false },
  (request) => listMemberNamesHandler(request, { store: firestoreStore() }),
);
```

Check the domain subpath: `memberNameRowSchema` lives in `member-directory-contracts.ts`, exported as `@bpt-jersey/domain/members/directory` per `packages/domain/package.json`. If `requireAdminActor` throws `unauthenticated` for a missing `auth` and `permission-denied` for a non-admin role, the tests above hold; otherwise adjust the expected codes to what the helper does — but keep "coach refused" and "anonymous refused".

`index.ts`: `export { listMemberNames } from "./members/member-names-callables.js";`

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project node apps/functions/src/members/member-names-callables.test.ts && corepack pnpm --filter @bpt-jersey/functions typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/members/member-names-callables.ts apps/functions/src/members/member-names-callables.test.ts apps/functions/src/index.ts
git commit -m "feat(functions): listMemberNames for the office"
```

---

### Task 17: Finance and member web clients (web)

**Files:**
- Modify: `apps/web/src/lib/billing-client.ts` (`IssueManualInvoiceInput.membershipId: string | null`, `validateInvoiceInput`, `export function parseFinancialAccount`), `apps/web/src/lib/finance-client.ts` (add `listRecentPayments`, `getFamilyFinancialAccount`), `apps/web/src/lib/members-client.ts` (add `listMemberNames`).
- Test: `apps/web/src/lib/billing-client.test.ts`, `apps/web/src/lib/finance-client.test.ts`, `apps/web/src/lib/members-client.test.ts`.

**Interfaces:**
- `listRecentPayments(): Promise<readonly RecentPaymentRow[]>` — error text "Unable to load recent payments. Please try again."
- `getFamilyFinancialAccount(familyId: string): Promise<FinancialAccount>` — error text "Unable to load this family's account. Please try again."
- `listMemberNames(): Promise<readonly MemberNameRow[]>` — error text "The member list is unavailable. Please try again." and the two directory error classes when the callable answers `failed-precondition` / `permission-denied` (reuse `directoryFailure`).

- [ ] **Step 1: Write the failing tests** (follow each file's existing `httpsCallable` mock)

```ts
// billing-client.test.ts
it("issues an invoice with membershipId null", async () => {
  callable.mockResolvedValueOnce({ data: { ...validInvoice, membershipId: null } });
  await expect(issueManualInvoice({ familyId: "f1", membershipId: null, totalMinor: 1500, dueAt: "2026-10-01T23:59:59.000Z", chargeKind: "manual_adjustment", invoiceReference: "INV-1", description: "Seminar" })).resolves.toMatchObject({ membershipId: null });
});

// finance-client.test.ts
it("lists recent payments and rejects a malformed row", async () => {
  callable.mockResolvedValueOnce({ data: { payments: [validRecentPaymentRow] } });
  await expect(listRecentPayments()).resolves.toEqual([validRecentPaymentRow]);
  callable.mockResolvedValueOnce({ data: { payments: [{ ...validRecentPaymentRow, amountMinor: -1 }] } });
  await expect(listRecentPayments()).rejects.toThrow("Unable to load recent payments. Please try again.");
});
it("reads a family account by id", async () => {
  callable.mockResolvedValueOnce({ data: { invoices: [], balanceMinor: 0, paygDebtMinor: 0, paymentInstructions: null } });
  await expect(getFamilyFinancialAccount("family-1")).resolves.toEqual({ invoices: [], balanceMinor: 0, paygDebtMinor: 0, paymentInstructions: null });
  expect(callable).toHaveBeenLastCalledWith({ familyId: "family-1" });
  await expect(getFamilyFinancialAccount("bad id")).rejects.toThrow("Unable to load this family's account. Please try again.");
});

// members-client.test.ts
it("lists member names and surfaces an uninitialised directory", async () => {
  callable.mockResolvedValueOnce({ data: { members: [{ studentId: "s1", fullName: "Ana Coelho", familyId: null }] } });
  await expect(listMemberNames()).resolves.toEqual([{ studentId: "s1", fullName: "Ana Coelho", familyId: null }]);
  callable.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "functions/failed-precondition" }));
  await expect(listMemberNames()).rejects.toBeInstanceOf(MemberDirectoryUninitializedError);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/billing-client.test.ts apps/web/src/lib/finance-client.test.ts apps/web/src/lib/members-client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`billing-client.ts`: `membershipId: string | null` in the input type; in `validateInvoiceInput` replace `!isIdentifier(input.membershipId)` with `(input.membershipId !== null && !isIdentifier(input.membershipId))`; add `export` to `parseFinancialAccount`.

`finance-client.ts`:

```ts
import { isRecentPaymentRow, type RecentPaymentRow } from "@bpt-jersey/domain/finance";
import { parseFinancialAccount, type FinancialAccount } from "./billing-client";

const safeRecentPaymentsError = "Unable to load recent payments. Please try again.";
const safeFamilyAccountError = "Unable to load this family's account. Please try again.";
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const callableOptions = Object.freeze({ limitedUseAppCheckTokens: true });

export async function listRecentPayments(): Promise<readonly RecentPaymentRow[]> {
  try {
    const callable = httpsCallable<null, { payments: unknown }>(getFirebaseFunctions(), "listRecentPayments", callableOptions);
    const response = await callable(null);
    const payments = response.data.payments;
    if (!Array.isArray(payments) || !payments.every(isRecentPaymentRow)) throw new Error(safeRecentPaymentsError);
    return Object.freeze([...payments]);
  } catch {
    throw new Error(safeRecentPaymentsError);
  }
}

export async function getFamilyFinancialAccount(familyId: string): Promise<FinancialAccount> {
  try {
    if (!identifierPattern.test(familyId)) throw new Error(safeFamilyAccountError);
    const callable = httpsCallable<{ familyId: string }, unknown>(getFirebaseFunctions(), "getFamilyFinancialAccount", callableOptions);
    const response = await callable({ familyId });
    return parseFinancialAccount(response.data);
  } catch {
    throw new Error(safeFamilyAccountError);
  }
}
```

`members-client.ts`:

```ts
import { memberNameRowSchema, type MemberNameRow } from "@bpt-jersey/domain/members/directory";

const safeMemberNamesError = "The member list is unavailable. Please try again.";

export async function listMemberNames(): Promise<readonly MemberNameRow[]> {
  try {
    const callable = httpsCallable<null, { members: unknown }>(getFirebaseFunctions(), "listMemberNames");
    const response = await callable(null);
    const members = response.data.members;
    if (!Array.isArray(members)) throw new Error(safeMemberNamesError);
    return Object.freeze(members.map((row) => memberNameRowSchema.parse(row)));
  } catch (error) {
    throw directoryFailure(error, safeMemberNamesError);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project web apps/web/src/lib`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib
git commit -m "feat(web): recent payments, family account and member names clients; invoices without membership"
```

---

### Task 18: Member picker (web component)

**Files:**
- Create: `apps/web/src/app/admin/billing/member-picker.tsx`, `apps/web/src/app/admin/billing/member-picker.test.tsx`
- Create: `apps/web/src/app/admin/billing/billing.css` (first rules)

**Interfaces:**
- ```ts
  export type MemberPickerProps = Readonly<{
    members: readonly MemberNameRow[] | null;   // null while loading
    error?: string | undefined;
    selected: MemberNameRow | null;
    onSelect: (member: MemberNameRow | null) => void;
    label?: string;                              // default "Find a member"
    autoFocus?: boolean;
  }>;
  export function MemberPicker(props: MemberPickerProps): JSX.Element;
  export function filterMembers(members: readonly MemberNameRow[], query: string, limit = 8): readonly MemberNameRow[]; // case/diacritic-insensitive `includes`, min 2 chars
  ```
- Loading of `listMemberNames()` is the parent's job (page and dialogs share one list).

- [ ] **Step 1: Write the failing tests**

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberPicker, filterMembers } from "./member-picker";

const members = [
  { studentId: "s1", fullName: "Ana Coelho", familyId: "f1" },
  { studentId: "s2", fullName: "Zé Pinto", familyId: null },
  { studentId: "s3", fullName: "Ana Maria Costa", familyId: "f3" },
] as const;

describe("member picker", () => {
  afterEach(cleanup);

  it("filters from two characters, ignoring case and accents, capped", () => {
    expect(filterMembers(members, "a")).toEqual([]);
    expect(filterMembers(members, "ANA").map((m) => m.studentId)).toEqual(["s1", "s3"]);
    expect(filterMembers(members, "ze").map((m) => m.studentId)).toEqual(["s2"]);
    expect(filterMembers(members, "an", 1)).toHaveLength(1);
  });

  it("lists matches as options and reports the pick", () => {
    const onSelect = vi.fn();
    render(<MemberPicker members={members} onSelect={onSelect} selected={null} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a member" }), { target: { value: "ana" } });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Ana Coelho", "Ana Maria Costa"]);
    fireEvent.click(options[1]!);
    expect(onSelect).toHaveBeenCalledWith(members[2]);
  });

  it("shows the selected member with a change action, and the error honestly", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<MemberPicker members={members} onSelect={onSelect} selected={members[0]} />);
    expect(screen.getByText("Ana Coelho")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change member" }));
    expect(onSelect).toHaveBeenCalledWith(null);
    rerender(<MemberPicker error="The member list is unavailable. Please try again." members={null} onSelect={onSelect} selected={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The member list is unavailable. Please try again.");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/billing/member-picker.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
"use client";

import { useId, useState } from "react";
import type { MemberNameRow } from "@bpt-jersey/domain/members/directory";

import "./billing.css";

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase();
}

export function filterMembers(
  members: readonly MemberNameRow[],
  query: string,
  limit = 8,
): readonly MemberNameRow[] {
  const needle = fold(query.trim());
  if (needle.length < 2) return Object.freeze([]);
  return Object.freeze(members.filter((member) => fold(member.fullName).includes(needle)).slice(0, limit));
}

export type MemberPickerProps = Readonly<{
  members: readonly MemberNameRow[] | null;
  error?: string | undefined;
  selected: MemberNameRow | null;
  onSelect: (member: MemberNameRow | null) => void;
  label?: string;
  autoFocus?: boolean;
}>;

export function MemberPicker({ members, error, selected, onSelect, label = "Find a member", autoFocus = false }: MemberPickerProps) {
  const [query, setQuery] = useState("");
  const listId = useId();
  if (selected) {
    return (
      <div className="member-picker member-picker-selected">
        <div>
          <p className="admin-eyebrow">Member</p>
          <strong>{selected.fullName}</strong>
          {selected.familyId ? null : <small>No billing family on record</small>}
        </div>
        <button className="button button-secondary" onClick={() => onSelect(null)} type="button">Change member</button>
      </div>
    );
  }
  const matches = members ? filterMembers(members, query) : [];
  return (
    <div className="member-picker">
      <label className="family-field">
        {label}
        <input
          aria-controls={listId}
          aria-expanded={matches.length > 0}
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={members === null && !error}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={members === null && !error ? "Loading members…" : "Type at least two letters"}
          role="combobox"
          type="search"
          value={query}
        />
      </label>
      {error ? <p className="family-error" role="alert">{error}</p> : null}
      {query.trim().length >= 2 && members && matches.length === 0 ? <p className="member-picker-empty" role="status">No member matches “{query.trim()}”.</p> : null}
      {matches.length > 0 ? (
        <ul className="member-picker-options" id={listId} role="listbox" aria-label={`${label} results`}>
          {matches.map((member) => (
            <li key={member.studentId} role="option" aria-selected={false}>
              <button className="member-picker-option" onClick={() => { onSelect(member); setQuery(""); }} type="button">{member.fullName}</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

Testing note: `getByRole("searchbox")` will not match an element with `role="combobox"`. Keep `type="search"` **without** the combobox role (native searchbox semantics) and drop `aria-expanded`; the listbox is announced via `aria-controls`.

`billing.css`:

```css
.member-picker { display: grid; gap: 0.6rem; }
.member-picker-selected { align-items: center; background: #f0efff; border-left: 0.35rem solid var(--bpt-purple); display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; padding: 0.9rem 1rem; }
.member-picker-selected small { color: var(--muted); display: block; }
.member-picker-options { border: 1px solid var(--mat-ink); display: grid; list-style: none; margin: 0; max-height: 18rem; overflow: auto; padding: 0; }
.member-picker-option { background: var(--gi-white); border: 0; border-bottom: 1px solid var(--paper-edge, #e8e7e3); cursor: pointer; font: inherit; min-height: 3.15rem; padding: 0.8rem 1rem; text-align: left; width: 100%; }
.member-picker-option:hover, .member-picker-option:focus-visible { background: #f0efff; outline: 3px solid var(--bpt-purple); outline-offset: -3px; }
.member-picker-empty { color: var(--muted); margin: 0; }
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/billing/member-picker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin/billing/member-picker.tsx apps/web/src/app/admin/billing/member-picker.test.tsx apps/web/src/app/admin/billing/billing.css
git commit -m "feat(admin): member picker for billing"
```

---

### Task 19: Issue invoice and record payment dialogs (web components)

**Files:**
- Create: `apps/web/src/app/admin/billing/issue-invoice-dialog.tsx` (+ `.test.tsx`), `apps/web/src/app/admin/billing/record-payment-dialog.tsx` (+ `.test.tsx`)
- Modify: `apps/web/src/app/admin/billing/billing.css`

**Interfaces:**
- ```ts
  export function IssueInvoiceDialog(props: {
    members: readonly MemberNameRow[] | null; membersError?: string;
    memberships: readonly AdminMembership[];               // all memberships, filtered by studentId inside
    onClose: () => void; onIssued: (invoice: InvoiceRecord) => void;
    issue?: typeof issueManualInvoice;                      // injectable for tests, defaults to the client
  }): JSX.Element;
  export function RecordPaymentDialog(props: {
    invoice: InvoiceView | null;                            // preselected from a row, or null → pick via member
    members: readonly MemberNameRow[] | null; membersError?: string;
    loadFamilyAccount?: typeof getFamilyFinancialAccount;
    record?: typeof recordManualPayment;
    onClose: () => void; onRecorded: (payment: ManualPaymentRecord) => void;
  }): JSX.Element;
  ```
- Both render the `role="dialog"` shell from the classes dialog (`schedule-admin-dialog-backdrop` / `schedule-admin-dialog` classes → copy the two rules into `billing.css` as `.billing-dialog-backdrop` / `.billing-dialog` so billing does not import `classes.css`).
- Copy: dialog titles "Issue invoice" / "Record payment"; submit labels "Issue invoice" / "Save payment"; secondary "Keep unchanged".

- [ ] **Step 1: Write the failing tests**

`issue-invoice-dialog.test.tsx`:

```tsx
it("issues a custom charge to a member without membership", async () => {
  const issue = vi.fn().mockResolvedValue({ invoiceId: "i1" });
  const onIssued = vi.fn();
  render(<IssueInvoiceDialog issue={issue} members={members} memberships={[]} onClose={vi.fn()} onIssued={onIssued} />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a member" }), { target: { value: "ana" } });
  fireEvent.click(screen.getByRole("option", { name: "Ana Coelho" }));
  expect(screen.getByRole("radio", { name: "No membership · custom charge" })).toBeChecked();
  fireEvent.change(screen.getByLabelText("Invoice amount (GBP)"), { target: { value: "15.00" } });
  fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("Charge type"), { target: { value: "manual_adjustment" } });
  fireEvent.change(screen.getByLabelText("Invoice reference"), { target: { value: "INV-SEM-1" } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Seminar" } });
  fireEvent.click(screen.getByRole("button", { name: "Issue invoice" }));
  await waitFor(() => expect(issue).toHaveBeenCalledWith({ familyId: "f1", membershipId: null, totalMinor: 1500, dueAt: "2026-10-01T23:59:59.000Z", chargeKind: "manual_adjustment", invoiceReference: "INV-SEM-1", description: "Seminar" }));
  expect(onIssued).toHaveBeenCalledWith({ invoiceId: "i1" });
});

it("preselects the active membership and blocks a member with no family", async () => {
  render(<IssueInvoiceDialog members={members} memberships={[{ membershipId: "m1", familyId: "f1", studentId: "s1", planId: "town-teens", status: "active", startsAt: "2026-01-01T00:00:00.000Z", endsAt: null, nextBillingAt: null }]} onClose={vi.fn()} onIssued={vi.fn()} />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a member" }), { target: { value: "ana c" } });
  fireEvent.click(screen.getByRole("option", { name: "Ana Coelho" }));
  expect(screen.getByRole("radio", { name: /town-teens · active/u })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Change member" }));
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a member" }), { target: { value: "ze" } });
  fireEvent.click(screen.getByRole("option", { name: "Zé Pinto" }));
  expect(screen.getByRole("alert")).toHaveTextContent("This member has no billing family yet. Add the family before invoicing.");
  expect(screen.getByRole("button", { name: "Issue invoice" })).toBeDisabled();
});
```

`record-payment-dialog.test.tsx`:

```tsx
it("records a cash payment against a preselected invoice", async () => {
  const record = vi.fn().mockResolvedValue({ paymentId: "p1" });
  const onRecorded = vi.fn();
  render(<RecordPaymentDialog invoice={openInvoiceView} members={null} onClose={vi.fn()} onRecorded={onRecorded} record={record} />);
  expect(screen.getByLabelText("Payment amount (GBP)")).toHaveValue("75.00");
  fireEvent.click(screen.getByRole("radio", { name: "Cash" }));
  fireEvent.change(screen.getByLabelText("Payment reference"), { target: { value: "CASH-1" } });
  fireEvent.change(screen.getByLabelText("Paid on"), { target: { value: "2026-09-13T10:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Save payment" }));
  await waitFor(() => expect(record).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: "invoice-1", amountMinor: 7500, method: "cash", manualReference: "CASH-1" })));
  expect(onRecorded).toHaveBeenCalledWith({ paymentId: "p1" });
});

it("finds the member's open invoices when none is preselected", async () => {
  const loadFamilyAccount = vi.fn().mockResolvedValue({ invoices: [openInvoiceView, paidInvoiceView], balanceMinor: 7500, paygDebtMinor: 0, paymentInstructions: null });
  render(<RecordPaymentDialog invoice={null} loadFamilyAccount={loadFamilyAccount} members={members} onClose={vi.fn()} onRecorded={vi.fn()} record={vi.fn()} />);
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a member" }), { target: { value: "ana c" } });
  fireEvent.click(screen.getByRole("option", { name: "Ana Coelho" }));
  await waitFor(() => expect(loadFamilyAccount).toHaveBeenCalledWith("f1"));
  expect(screen.getAllByRole("radio", { name: /INV-/u })).toHaveLength(1); // paid invoice is not offered
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/billing/issue-invoice-dialog.test.tsx apps/web/src/app/admin/billing/record-payment-dialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `issue-invoice-dialog.tsx`**

Move `parseMoney` and `isOpaqueId` from `page.tsx` into a small `billing-format.ts` (`formatMoney`, `formatDate`, `parseMoney`) shared by page, panel and dialogs.

```tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { ChargeKind, InvoiceRecord } from "@bpt-jersey/domain/finance";
import type { MemberNameRow } from "@bpt-jersey/domain/members/directory";

import { issueManualInvoice } from "../../../lib/billing-client";
import type { AdminMembership } from "../../../lib/membership-admin-client";
import { parseMoney } from "./billing-format";
import { MemberPicker } from "./member-picker";

const noMembership = "__none__";

type Props = Readonly<{
  members: readonly MemberNameRow[] | null;
  membersError?: string | undefined;
  memberships: readonly AdminMembership[];
  onClose: () => void;
  onIssued: (invoice: InvoiceRecord) => void;
  issue?: typeof issueManualInvoice;
}>;

export function IssueInvoiceDialog({ members, membersError, memberships, onClose, onIssued, issue = issueManualInvoice }: Props) {
  const [member, setMember] = useState<MemberNameRow | null>(null);
  const [membershipId, setMembershipId] = useState<string>(noMembership);
  const [form, setForm] = useState({ amount: "", dueDate: "", chargeKind: "membership" as Exclude<ChargeKind, "payg_session">, invoiceReference: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const options = member ? memberships.filter((m) => m.studentId === member.studentId).sort((a, b) => Number(b.status === "active") - Number(a.status === "active")) : [];
  useEffect(() => {
    setMembershipId(options[0]?.membershipId ?? noMembership);
    setForm((current) => ({ ...current, chargeKind: options.length > 0 ? "membership" : "manual_adjustment" }));
  }, [member?.studentId]); // eslint-disable-line react-hooks/exhaustive-deps -- options derives from member
  const chosen = options.find((m) => m.membershipId === membershipId);
  const familyId = chosen?.familyId ?? member?.familyId ?? null;
  const blocked = member !== null && familyId === null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!member || !familyId) return;
    const totalMinor = parseMoney(form.amount);
    if (totalMinor === undefined || !/^\d{4}-\d{2}-\d{2}$/u.test(form.dueDate)) { setError("Enter a valid positive amount and due date."); return; }
    setBusy(true); setError("");
    try {
      const invoice = await issue({ familyId, membershipId: chosen?.membershipId ?? null, totalMinor, dueAt: `${form.dueDate}T23:59:59.000Z`, chargeKind: form.chargeKind, invoiceReference: form.invoiceReference.trim(), description: form.description.trim() });
      onIssued(invoice);
    } catch {
      setError("The invoice could not be issued. Check the reference is unique and try again.");
    } finally { setBusy(false); }
  }

  return (
    <div aria-labelledby="issue-invoice-title" aria-modal="true" className="billing-dialog-backdrop" role="dialog">
      <section className="billing-dialog">
        <div className="billing-dialog-heading">
          <div><p className="admin-eyebrow">Manual charge</p><h3 id="issue-invoice-title">Issue invoice</h3></div>
          <button aria-label="Close dialog" className="button button-secondary" disabled={busy} onClick={onClose} type="button">Close</button>
        </div>
        <form className="billing-form" onSubmit={(e) => void submit(e)}>
          <MemberPicker autoFocus error={membersError} members={members} onSelect={setMember} selected={member} />
          {member ? (
            <fieldset className="billing-form-wide">
              <legend>Membership</legend>
              <div className="billing-choice-column" role="radiogroup" aria-label="Membership">
                {options.map((m) => (
                  <label className="billing-radio" key={m.membershipId}>
                    <input checked={membershipId === m.membershipId} name="membership" onChange={() => setMembershipId(m.membershipId)} type="radio" />
                    {m.planId} · {m.status}
                  </label>
                ))}
                <label className="billing-radio">
                  <input checked={membershipId === noMembership} name="membership" onChange={() => setMembershipId(noMembership)} type="radio" />
                  No membership · custom charge
                </label>
              </div>
            </fieldset>
          ) : null}
          {blocked ? <p className="family-error billing-form-wide" role="alert">This member has no billing family yet. Add the family before invoicing.</p> : null}
          <label className="family-field">Invoice amount (GBP)
            <input aria-label="Invoice amount (GBP)" disabled={!member} inputMode="decimal" onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="75.00" required value={form.amount} />
          </label>
          <label className="family-field">Due date
            <input aria-label="Due date" disabled={!member} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} required type="date" value={form.dueDate} />
          </label>
          <label className="family-field">Charge type
            <select aria-label="Charge type" disabled={!member} onChange={(e) => setForm({ ...form, chargeKind: e.target.value as Exclude<ChargeKind, "payg_session"> })} value={form.chargeKind}>
              <option value="membership">Membership</option>
              <option value="manual_adjustment">Manual adjustment</option>
            </select>
          </label>
          <label className="family-field">Invoice reference
            <input aria-label="Invoice reference" autoComplete="off" disabled={!member} onChange={(e) => setForm({ ...form, invoiceReference: e.target.value })} required value={form.invoiceReference} />
          </label>
          <label className="family-field billing-form-wide">Description
            <textarea aria-label="Description" disabled={!member} maxLength={200} onChange={(e) => setForm({ ...form, description: e.target.value })} required value={form.description} />
          </label>
          {error ? <p className="family-error billing-form-wide" role="alert">{error}</p> : null}
          <div className="billing-dialog-actions billing-form-wide">
            <button className="button button-secondary" disabled={busy} onClick={onClose} type="button">Keep unchanged</button>
            <button className="button" disabled={busy || !member || blocked} type="submit">{busy ? "Working…" : "Issue invoice"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Implement `record-payment-dialog.tsx`**

Same shell. State: `member`, `account` (`FinancialAccount | null`, loaded with `loadFamilyAccount(member.familyId)` when `invoice === null` and a member with a family is picked; members without family show "This member has no billing family yet."), `selectedInvoice` (`invoice ?? null`), form `{ amount, method: "bank_transfer" | "cash", manualReference, occurredAt }` with `amount` prefilled `(balanceMinor / 100).toFixed(2)` whenever `selectedInvoice` changes and `occurredAt` defaulting to now in `datetime-local` format. Open invoices offered: `account.invoices.filter((v) => (v.invoice.status === "open" || v.invoice.status === "partially_paid") && v.balanceMinor > 0)` as radios labelled `${invoiceReference} · ${description} · balance ${formatMoney(balanceMinor)}`. Method:

```tsx
<div className="billing-choice-row" role="radiogroup" aria-label="Payment method">
  {(["cash", "bank_transfer"] as const).map((method) => (
    <button aria-checked={form.method === method} className="billing-choice" key={method} onClick={() => setForm({ ...form, method })} role="radio" type="button">
      {method === "cash" ? "Cash" : "Bank transfer"}
    </button>
  ))}
</div>
```

Fields: "Payment amount (GBP)" (`inputMode="decimal"`), "Payment reference", "Paid on" (`datetime-local`). Validation as the old page: amount ≤ balance; error copy "Enter a valid payment no greater than the balance." Submit calls `record({ invoiceId, amountMinor, method, manualReference, occurredAt: new Date(form.occurredAt).toISOString() })` then `onRecorded(payment)`; failure → "The payment could not be recorded. Refresh the balance and try again."

CSS additions to `billing.css`: `.billing-dialog-backdrop`/`.billing-dialog`/`.billing-dialog-heading`/`.billing-dialog-actions` copied from `classes.css` equivalents (rename), `.billing-form { display: grid; gap: 1rem; grid-template-columns: repeat(2, minmax(0,1fr)); } .billing-form-wide { grid-column: 1 / -1; } .billing-choice-row { display: flex; gap: 0.5rem; flex-wrap: wrap; } .billing-choice { /* same as .class-choice */ } .billing-choice-column { display: grid; gap: 0.5rem; } .billing-radio { display: flex; gap: 0.6rem; align-items: center; min-height: 3.15rem; border: 1px solid var(--line, #8a8880); padding: 0 0.9rem; }` and the `50rem` collapse (one column; dialog full screen).

- [ ] **Step 5: Run the tests**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/billing`
Expected: PASS (the old `page.test.tsx` may still pass or may already need Task 20; if it fails only because `parseMoney` moved, update its import).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/admin/billing
git commit -m "feat(admin): issue invoice with member search and optional membership; record payment with cash or bank transfer"
```

---

### Task 20: Billing home page, member account panel and finance redirect (web)

**Files:**
- Create: `apps/web/src/app/admin/billing/member-account-panel.tsx` (+ `.test.tsx`)
- Modify: `apps/web/src/app/admin/billing/page.tsx` (rewrite), `apps/web/src/app/admin/billing/page.test.tsx` (rewrite), `apps/web/src/app/admin/finance/page.tsx` (redirect), `apps/web/src/app/admin/finance/page.test.tsx`, `billing.css`.

**Interfaces:**
- `MemberAccountPanel({ member, account, status: "loading" | "ready" | "error", onRecordPayment(view), onVoid(view), busy })` — renders name/family, balance, "All payments" table (flattened `account.invoices[].payments`, desc by `occurredAt`: Date · Invoice · Method · Amount) and "Invoices" table with per-row actions (same rules as today's `InvoiceActions`).
- Page data: `getFinancialDashboard()`, `listRecentPayments()`, `listFinancialAccount()`, `listMemberships()`, `listMemberNames()` — each fails independently and shows its own band.

- [ ] **Step 1: Write the failing tests** (`page.test.tsx`, rewritten; mock `finance-client`, `billing-client`, `membership-admin-client`, `members-client`, and `./no-show-penalty-queue` + `./payment-instructions-panel` as light stubs)

```tsx
it("opens on the finance dashboard with the latest twenty payments", async () => {
  financeApi.getFinancialDashboard.mockResolvedValue(dashboard);
  financeApi.listRecentPayments.mockResolvedValue(twentyOnePayments.slice(0, 20));
  render(<BillingPage />);
  expect(await screen.findByRole("heading", { name: "Billing" })).toBeInTheDocument();
  expect(screen.getByRole("article", { name: /Collected this month/u })).toBeInTheDocument();
  const latest = screen.getByRole("region", { name: "Latest payments" });
  expect(within(latest).getAllByRole("row")).toHaveLength(21); // header + 20
  expect(within(latest).getByText("Ana Coelho")).toBeInTheDocument();
  expect(within(latest).getAllByText("Cash").length).toBeGreaterThan(0);
  expect(screen.getByRole("group", { name: "Outstanding invoices" })).not.toHaveAttribute("open");
});

it("shows a member's family payments after picking them", async () => {
  membersApi.listMemberNames.mockResolvedValue(members);
  financeApi.getFamilyFinancialAccount.mockResolvedValue(familyAccount);
  render(<BillingPage />);
  fireEvent.change(await screen.findByRole("searchbox", { name: "Find a member" }), { target: { value: "ana c" } });
  fireEvent.click(screen.getByRole("option", { name: "Ana Coelho" }));
  await waitFor(() => expect(financeApi.getFamilyFinancialAccount).toHaveBeenCalledWith("f1"));
  const panel = screen.getByRole("region", { name: "Ana Coelho's account" });
  expect(within(panel).getByRole("table", { name: "All payments" })).toBeInTheDocument();
  expect(within(panel).getAllByRole("row")).toHaveLength(1 + familyAccount.invoices.flatMap((v) => v.payments).length + 1 + familyAccount.invoices.length + 1);
});

it("keeps the page usable when the member list fails", async () => {
  membersApi.listMemberNames.mockRejectedValue(new Error("The member list is unavailable. Please try again."));
  render(<BillingPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("The member list is unavailable. Please try again.");
  expect(screen.getByRole("button", { name: "Issue invoice" })).toBeInTheDocument();
});
```

`finance/page.test.tsx` (rewrite): mock `next/navigation`'s `useRouter` and assert `replace` is called with `/admin/billing` and a link "Go to Billing" renders.

- [ ] **Step 2: Run to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/billing/page.test.tsx apps/web/src/app/admin/finance/page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `member-account-panel.tsx`**

```tsx
"use client";

import type { ManualPaymentRecord } from "@bpt-jersey/domain/finance";
import type { MemberNameRow } from "@bpt-jersey/domain/members/directory";

import type { FinancialAccount, InvoiceView } from "../../../lib/billing-client";
import { AdminDataTable } from "../admin-data-table";
import { AdminStatusBadge } from "../admin-ui";
import { formatDate, formatMoney } from "./billing-format";

type Props = Readonly<{
  member: MemberNameRow;
  account: FinancialAccount | undefined;
  status: "loading" | "ready" | "error";
  busy: boolean;
  onRecordPayment: (view: InvoiceView) => void;
  onVoid: (view: InvoiceView) => void;
}>;

const methodLabel: Readonly<Record<ManualPaymentRecord["method"], string>> = Object.freeze({ cash: "Cash", bank_transfer: "Bank transfer", other: "Other" });

export function MemberAccountPanel({ member, account, status, busy, onRecordPayment, onVoid }: Props) {
  const payments = account ? account.invoices.flatMap((view) => view.payments.map((payment) => ({ payment, invoice: view.invoice }))).sort((a, b) => b.payment.occurredAt.localeCompare(a.payment.occurredAt)) : [];
  const titleId = `member-account-${member.studentId}`;
  return (
    <section aria-labelledby={titleId} className="admin-panel-card" role="region">
      <div className="admin-panel-card-heading">
        <div>
          <p className="admin-eyebrow">Member account</p>
          <h3 id={titleId}>{member.fullName}&apos;s account</h3>
        </div>
        {account ? <strong className="billing-balance">Balance {formatMoney(account.balanceMinor)}</strong> : null}
      </div>
      {status === "loading" ? <div aria-busy="true" className="billing-skeleton" /> : null}
      {status === "error" ? <p className="family-error" role="alert">Unable to load this family&apos;s account. Please try again.</p> : null}
      {member.familyId === null ? <p className="family-error" role="alert">This member has no billing family yet, so there is no account to show.</p> : null}
      {account ? (
        <>
          <AdminDataTable
            caption="All payments"
            columns={[
              { key: "date", label: "Date", render: (row) => formatDate(row.payment.occurredAt) },
              { key: "invoice", label: "Invoice", render: (row) => <><strong>{row.invoice.invoiceReference}</strong><small className="billing-cell-note">{row.invoice.description}</small></> },
              { key: "method", label: "Method", render: (row) => methodLabel[row.payment.method] },
              { key: "amount", label: "Amount", render: (row) => formatMoney(row.payment.amountMinor) },
            ]}
            rowKey={(row) => row.payment.paymentId}
            rows={payments}
          />
          {payments.length === 0 ? <p className="admin-empty-state">No payments recorded for this family yet.</p> : null}
          <AdminDataTable
            caption="Invoices"
            columns={[
              { key: "reference", label: "Invoice", render: (view: InvoiceView) => <strong>{view.invoice.invoiceReference}</strong> },
              { key: "due", label: "Due", render: (view: InvoiceView) => formatDate(view.invoice.dueAt) },
              { key: "total", label: "Total", render: (view: InvoiceView) => formatMoney(view.invoice.totalMinor) },
              { key: "balance", label: "Balance", render: (view: InvoiceView) => formatMoney(view.balanceMinor) },
              { key: "status", label: "Status", render: (view: InvoiceView) => <AdminStatusBadge status={view.invoice.status} /> },
              { key: "actions", label: "Actions", render: (view: InvoiceView) => <InvoiceRowActions busy={busy} onRecordPayment={onRecordPayment} onVoid={onVoid} view={view} /> },
            ]}
            rowKey={(view) => view.invoice.invoiceId}
            rows={account.invoices}
          />
        </>
      ) : null}
    </section>
  );
}

export function InvoiceRowActions({ view, busy, onRecordPayment, onVoid }: { view: InvoiceView; busy: boolean; onRecordPayment: (view: InvoiceView) => void; onVoid: (view: InvoiceView) => void }) {
  const canReceivePayment = (view.invoice.status === "open" || view.invoice.status === "partially_paid") && view.balanceMinor > 0;
  const canVoid = view.invoice.status === "open" && view.payments.length === 0;
  return (
    <div className="admin-table-actions">
      {canReceivePayment ? <button aria-label={`Record payment for ${view.invoice.invoiceReference}`} className="family-text-button" disabled={busy} onClick={() => onRecordPayment(view)} type="button">Record payment</button> : null}
      {canVoid ? <button aria-label={`Void ${view.invoice.invoiceReference}`} className="family-text-button" disabled={busy} onClick={() => onVoid(view)} type="button">Void</button> : null}
    </div>
  );
}
```

(If `AdminDataTable` needs `role`/`aria-label` on its `<table>` for `getByRole("table", { name })`, use the `caption` it already renders — `getByRole("table", { name: "All payments" })` matches a caption.)

- [ ] **Step 4: Rewrite `billing/page.tsx`**

Structure (spec §7.2), keeping `formatMoney`/`formatDate` in `billing-format.ts`, the void confirm via `window.confirm`, and the two existing panels:

```tsx
export function BillingPage() {
  const [dashboard, setDashboard] = useState<FinancialDashboard>();
  const [dashboardState, setDashboardState] = useState<RequestState>("loading");
  const [recent, setRecent] = useState<readonly RecentPaymentRow[]>();
  const [recentState, setRecentState] = useState<RequestState>("loading");
  const [account, setAccount] = useState<FinancialAccount>();          // whole academy (All invoices, penalties, instructions)
  const [accountState, setAccountState] = useState<RequestState>("loading");
  const [memberships, setMemberships] = useState<readonly AdminMembership[]>([]);
  const [members, setMembers] = useState<readonly MemberNameRow[] | null>(null);
  const [membersError, setMembersError] = useState<string>();
  const [member, setMember] = useState<MemberNameRow | null>(null);
  const [familyAccount, setFamilyAccount] = useState<FinancialAccount>();
  const [familyState, setFamilyState] = useState<RequestState>("ready");
  const [dialog, setDialog] = useState<{ kind: "invoice" } | { kind: "payment"; invoice: InvoiceView | null }>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Readonly<{ kind: "success" | "error"; text: string }>>();
  const [version, setVersion] = useState(0);
  // five independent loads keyed on `version`; each sets its own state and never blocks the others
  // member pick → getFamilyFinancialAccount(member.familyId) when familyId !== null
  // refreshAll = () => setVersion(v => v + 1); called after issue / payment / void
```

Render order: `AdminSectionHeader` (eyebrow "Money / Billing", title "Billing", description "Manual GBP invoices and receipts. No card details are stored here.", actions: `<button className="button" onClick={() => setDialog({ kind: "invoice" })}>Issue invoice</button>` and `<button className="button button-secondary" onClick={() => setDialog({ kind: "payment", invoice: null })}>Record payment</button>`) → feedback band → metrics grid (four `AdminMetric`: "Collected this month" `formatMoney(dashboard.metrics.collectedMinor)` with detail `${paymentsReceived} payments`; "Outstanding" `outstandingMinor`; "Overdue invoices" `overdueBalances`; "Renewals due" `renewalsDue` detail "Next 30 days"; while loading render four `.billing-skeleton` blocks; on error a red-rule band "The finance summary is unavailable. Try again.") → `<section aria-labelledby="latest-payments-title" className="admin-panel-card" role="region">` with `<h3 id="latest-payments-title">Latest payments</h3>` and `AdminDataTable` columns Date · Member (`row.memberName ?? row.description`) · Invoice (`invoiceReference`) · Method (`methodLabel`) · Amount → `<section className="admin-panel-card" aria-labelledby="find-member-title">` with `MemberPicker` and, when `member`, `<MemberAccountPanel …/>` → five `<details className="billing-details">` with `<summary>`: "Outstanding invoices" (dashboard `balanceAttention` table, reuse `balanceColumns` from the old finance page), "Upcoming renewals" (`renewalColumns`), "No-show penalties" (`<NoShowPenaltyQueue/>`), "Payment instructions" (`<PaymentInstructionsPanel current={account?.paymentInstructions ?? null} onSaved={refreshAll}/>`), "All invoices" (today's invoice table with `InvoiceRowActions`; Student column resolves `memberships.find(m => m.membershipId === view.invoice.membershipId)` and falls back to `view.invoice.description` when `membershipId === null`). Give each `<details>` `aria-label` equal to its summary so `getByRole("group", { name })` works. Dialogs render at the end when `dialog` is set: `IssueInvoiceDialog` (`onIssued` → feedback "Invoice issued.", close, `refreshAll`) and `RecordPaymentDialog` (`onRecorded` → "Payment recorded.", close, `refreshAll`).

`finance/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Billing is the finance home since 2026-09-14; this route only forwards old links. */
export default function FinanceRoute() {
  const router = useRouter();
  useEffect(() => { router.replace("/admin/billing"); }, [router]);
  return (
    <p className="admin-empty-state">
      Finance moved. <Link className="admin-text-link" href="/admin/billing">Go to Billing</Link>
    </p>
  );
}
```

Delete the old `FinancePage` export; move `balanceColumns`/`renewalColumns` into `billing/page.tsx`. Grep for other imports of `FinancePage` (`grep -rn "FinancePage\|admin/finance" apps/web/src qa/tests`) and fix them (the billing page's old "Finance dashboard" link goes away; `qa/tests` referencing `/admin/finance` should now expect the redirect).

CSS: `.billing-skeleton { background: #e8e7e3; min-height: 6rem; }`, `.billing-details { background: var(--gi-white); border-top: 0.3rem solid var(--mat-ink); margin-top: 1rem; padding: 0 1.15rem 1.15rem; } .billing-details > summary { cursor: pointer; font-family: var(--font-display), Impact, sans-serif; font-size: 1.6rem; letter-spacing: 0.035em; line-height: 1; list-style: none; min-height: 3.15rem; padding: 1rem 0; text-transform: uppercase; } .billing-details > summary::-webkit-details-marker { display: none; } .billing-details > summary::after { content: " +"; color: var(--bpt-purple); } .billing-details[open] > summary::after { content: " −"; } .billing-balance { font-variant-numeric: tabular-nums; } .billing-cell-note { color: var(--muted); display: block; }` and a `50rem` rule stacking the metrics grid to one column (the shared `.admin-metrics-grid` already collapses; verify).

- [ ] **Step 5: Run the tests, typecheck, lint**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin && corepack pnpm --filter @bpt-jersey/web typecheck && corepack pnpm lint`
Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/admin/billing apps/web/src/app/admin/finance
git commit -m "feat(admin): billing is the finance home with latest payments, member history and folded operations"
```

---

### Task 21: Member calendar — real booked counts and card details (web + docs)

**Files:**
- Modify: `apps/web/src/lib/calendar/firebase-calendar-repository.ts`, `apps/web/src/lib/calendar/fixture-calendar-repository.ts`, `apps/web/src/app/account/calendar/session-card.tsx`, `apps/web/src/app/account/account.css`, `STACK.md`.
- Create: `apps/web/src/lib/calendar/firebase-calendar-repository.test.ts`.
- Test: `apps/web/src/app/account/calendar/session-card.test.tsx`, `apps/web/src/app/account/calendar/member-calendar.test.tsx` (add one case with the Firebase repository and mocked clients).

**Interfaces:**
- Consumes: `listSessionBookedCounts` (Task 6), `ageRangeLabel`, `levelRangeLabel`.
- Card markup: `<p className="session-detail">` = `${levelRangeLabel(session.levelRange)} · ${ageRangeLabel(session.ageRange)}` only when the session has `levelRange` or `ageRange`; `<p className="session-description">` when `description` is non-empty.

- [ ] **Step 1: Write the failing tests**

`firebase-calendar-repository.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const schedule = vi.hoisted(() => ({
  listSessions: vi.fn(), getScheduleCatalog: vi.fn(), listStudentBookings: vi.fn(),
  listStudentAttendance: vi.fn(), requestBooking: vi.fn(), cancelBooking: vi.fn(), listSessionBookedCounts: vi.fn(),
}));
vi.mock("../schedule-client", () => schedule);
vi.mock("../waitlist-client", () => ({ listClientMemberships: vi.fn().mockResolvedValue([{ membershipId: "m-1", studentId: "s-1", planId: "bpt-jersey-adult", status: "active" }]) }));
vi.mock("../family-client", () => ({ getFamily: vi.fn() }));
vi.mock("../no-show-penalties-client", () => ({ listNoShowPenalties: vi.fn().mockResolvedValue([]) }));

import { createFirebaseCalendarRepository } from "./firebase-calendar-repository";

describe("firebase calendar repository", () => {
  beforeEach(() => {
    schedule.listSessions.mockResolvedValue([{ sessionId: "s1" }]);
    schedule.getScheduleCatalog.mockResolvedValue({ locations: [], programs: [{ programId: "p" }] });
    schedule.listStudentBookings.mockResolvedValue([]);
    schedule.listStudentAttendance.mockResolvedValue([]);
    schedule.listSessionBookedCounts.mockResolvedValue({ s1: 20 });
  });

  it("loads the week with real booked counts", async () => {
    const repo = createFirebaseCalendarRepository({ role: "adultStudent", displayName: "Alex Demo" });
    const week = await repo.loadWeek("s-1", "2026-09-14T00:00:00.000Z", "2026-09-20T23:59:59.999Z");
    expect(schedule.listSessionBookedCounts).toHaveBeenCalledWith({ from: "2026-09-14T00:00:00.000Z", to: "2026-09-20T23:59:59.999Z" });
    expect(week.bookedCounts).toEqual({ s1: 20 });
    expect(week.programs).toEqual([{ programId: "p" }]);
  });

  it("builds the adult participant from the plan catalogue", async () => {
    const repo = createFirebaseCalendarRepository({ role: "adultStudent", displayName: "Alex Demo" });
    const member = await repo.loadMember();
    expect(member.participants).toEqual([expect.objectContaining({ studentId: "s-1", firstName: "Alex", participantType: "adult" })]);
  });
});
```

`session-card.test.tsx` addition:

```tsx
it("shows the level and age ranges and the description when the session carries them", () => {
  const detailed = { ...session, description: "Gi only. Bring a mouthguard.", ageRange: { minAge: 12, maxAge: 15 }, levelRange: { fromKey: "w", toKey: "b", fromName: "White", toName: "Blue" } };
  render(<ul><SessionCard busy={false} entry={{ session: detailed, program, derived: { status: "open" } }} now={new Date("2026-09-16T10:00:00Z")} onBook={vi.fn()} onCancelRequest={vi.fn()} /></ul>);
  expect(screen.getByText("White → Blue · Ages 12–15")).toBeInTheDocument();
  expect(screen.getByText("Gi only. Bring a mouthguard.")).toBeInTheDocument();
  cleanup();
  render(<ul><SessionCard busy={false} entry={{ session, program, derived: { status: "open" } }} now={new Date("2026-09-16T10:00:00Z")} onBook={vi.fn()} onCancelRequest={vi.fn()} /></ul>);
  expect(screen.queryByText(/All levels/u)).toBeNull();
});
```

`member-calendar.test.tsx` addition (mock the four schedule client functions plus `listClientMemberships`; use `vi.useFakeTimers({ now: <a Monday 10:00 Jersey> })` so this test does not depend on the real date):

```tsx
it("renders a full session as Full when the Firebase adapter reports the count", async () => {
  // listSessions → one scheduled session tomorrow 18:00 for program "adult", capacity 2; listSessionBookedCounts → { [id]: 2 }
  render(<MemberCalendar repository={createFirebaseCalendarRepository({ role: "adultStudent", displayName: "Alex" })} session={{ role: "adultStudent", displayName: "Alex" }} onSignOut={vi.fn()} />);
  const card = await screen.findByRole("listitem", { name: /Adults BJJ/u }); // or locate by data-session-id
  expect(card).toHaveAttribute("data-status", "full");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/calendar apps/web/src/app/account/calendar/session-card.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`firebase-calendar-repository.ts` `loadWeek`:

```ts
      const [sessions, catalog, bookings, attendance, bookedCounts] = await Promise.all([
        listSessions({ from: fromIso, to: toIso }),
        getScheduleCatalog(),
        listStudentBookings(studentId),
        listStudentAttendance(studentId),
        listSessionBookedCounts({ from: fromIso, to: toIso }),
      ]);
      return { sessions, programs: catalog.programs, bookings, attendance, bookedCounts };
```

Update the header comment: drop item (2); keep (1) and (3) and state that (1) is covered by the unit + emulator callable suites of 2026-09-14 while the in-browser run stays impossible offline (App Check fail-closed).

`session-card.tsx` after `<p className="session-site">`:

```tsx
{session.levelRange || session.ageRange ? (
  <p className="session-detail">{`${levelRangeLabel(session.levelRange)} · ${ageRangeLabel(session.ageRange)}`}</p>
) : null}
{session.description ? <p className="session-description">{session.description}</p> : null}
```

`account.css`:

```css
.session-detail { font-size: 0.8rem; font-weight: 700; letter-spacing: 0.04em; margin: 0; text-transform: uppercase; }
.session-description { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; font-size: 0.85rem; margin: 0; overflow: hidden; }
```

`fixture-calendar-repository.ts`: give two generated sessions (the Teens BJJ and the Kids BJJ ones) `description`, `ageRange` and `levelRange` so the workbench shows them.

`STACK.md` (Pages variables line 141): append "y `NEXT_PUBLIC_CALENDAR_SOURCE=firebase` para que `/account` lea el backend real (sin ella la build sirve fixtures; `.env.local` del banco la deja sin definir a propósito porque solo tiene el emulador de Auth)".

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run --project web apps/web/src/lib/calendar apps/web/src/app/account`
Expected: PASS except the pre-existing real-date failure in `member-calendar.test.tsx` if it is still there — your new case must pass under fake timers.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/calendar apps/web/src/app/account STACK.md
git commit -m "feat(account): calendar reads booked counts from Firebase and shows level, age and description"
```

---

### Task 22: Playwright UI specs and screenshots (qa)

**Files:**
- Create: `qa/tests/admin-classes-form.spec.ts`, `qa/tests/admin-levels.spec.ts`, `qa/tests/admin-billing-home.spec.ts`
- Modify: `qa/tests/admin-shell.spec.ts` (done in Task 10; re-run here)
- Output: `qa/test-results/screens/*.png` (git-ignored; attach paths to the ledger evidence)

**Interfaces:**
- Consumes: `installAdminFixture(page, { role, callables, calls })`; callable names as the clients call them — confirm each with `grep -n '"[a-zA-Z]*"' apps/web/src/lib/<client>.ts` (`listScheduleCatalog`, `listClasses`, `listSessions`, `listStaffProfiles`, `listMemberships`, `listMembers`, `saveClass`, `updateSession`, `removeClass`, `getFinancialDashboard`, `listRecentPayments`, `listFinancialAccount`, `listMemberNames`, `getFamilyFinancialAccount`, `issueManualInvoice`, `recordManualPayment`, `listNoShowPenalties`/whatever `NoShowPenaltyQueue` calls, and `listLevelCatalog` only if `isConnectedLevelsBackendEnabled()` is true in the e2e build — otherwise the bundled catalogue is used and nothing is intercepted).

- [ ] **Step 1: Write `admin-classes-form.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

import { installAdminFixture, type CallableCall } from "./admin-fixture";

const audit = { schemaVersion: "1", createdAt: "2026-09-01T10:00:00.000Z", createdBy: "admin-1", updatedAt: "2026-09-01T10:00:00.000Z", updatedBy: "admin-1" };
const catalog = {
  locations: [
    { locationId: "town", academyId: "synthetic-academy", name: "BPT Town", address: "St Helier", timezone: "Europe/Jersey", active: true, schemaVersion: "1" },
    { locationId: "west", academyId: "synthetic-academy", name: "BPT West", address: "St Peter", timezone: "Europe/Jersey", active: true, schemaVersion: "1" },
  ],
  programs: [{ programId: "program-kids", academyId: "synthetic-academy", name: "Kids BJJ", ageBand: "kids", discipline: "bjj", level: "all-levels", active: true, schemaVersion: "1" }],
};
const existingClass = {
  classId: "class-1", academyId: "synthetic-academy", programId: "program-kids", locationId: "town", name: "Kids BJJ",
  recurrenceRules: [{ dayOfWeek: 1, startTime: "17:00", durationMinutes: 60 }, { dayOfWeek: 3, startTime: "17:00", durationMinutes: 60 }],
  description: "Bring a gi.", ageRange: { minAge: 8, maxAge: 11 }, levelRange: { fromKey: "k-white", toKey: "k-grey", fromName: "White", toName: "Grey" },
  instructorIds: ["coach-miro"], capacity: 20, minParticipants: 4, active: true, ...audit, schemaVersion: "2",
};

test.describe("admin classes", () => {
  test("creates a two-day class and shows it with its ranges", async ({ page }, testInfo) => {
    const calls: CallableCall[] = [];
    await installAdminFixture(page, {
      calls,
      callables: {
        listScheduleCatalog: catalog, listClasses: { classes: [existingClass] }, listSessions: { sessions: [] },
        listStaffProfiles: { profiles: [{ staffKey: "coach-miro", role: "headCoach", active: true, status: "active", schemaVersion: "1" }] },
        listMemberships: { memberships: [] }, listMembers: { rows: [] },
        saveClass: (body: unknown) => ({ class: { ...(body as { data: object }).data, classId: "class-2", academyId: "synthetic-academy", active: true, schemaVersion: "2", ...audit } }),
      },
    });
    await page.goto("/admin/classes?adminTestRole=owner");
    await expect(page.getByText("Mon 17:00 · Wed 17:00")).toBeVisible();
    await expect(page.getByText("Ages 8–11 · White → Grey")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`classes-list-${testInfo.project.name}.png`), fullPage: true });

    await page.getByRole("button", { name: "New class" }).click();
    await page.getByLabel("Class name").fill("Teens BJJ");
    await page.getByLabel("Program").selectOption("program-kids");
    await page.getByRole("radio", { name: "BPT West" }).click();
    await page.getByRole("button", { name: "Tuesday" }).click();
    await page.getByRole("button", { name: "Thursday" }).click();
    await page.getByLabel("Tuesday start time").fill("18:30");
    await page.getByRole("radio", { name: "12–15" }).click();
    await page.getByLabel("coach-miro").check();
    await page.screenshot({ path: testInfo.outputPath(`classes-form-${testInfo.project.name}.png`), fullPage: true });
    await page.getByRole("button", { name: "Create class" }).click();
    await expect(page.getByRole("status")).toContainText("Class created.");
    const saved = calls.find((call) => call.name === "saveClass");
    expect(saved?.body).toMatchObject({ data: { locationId: "west", recurrenceRules: [{ dayOfWeek: 2, startTime: "18:30", durationMinutes: 60 }, { dayOfWeek: 4, startTime: "18:30", durationMinutes: 60 }], ageRange: { minAge: 12, maxAge: 15 } } });
  });

  test("a coach sees classes without any action", async ({ page }) => {
    await installAdminFixture(page, { role: "coach", callables: { listScheduleCatalog: catalog, listClasses: { classes: [existingClass] }, listSessions: { sessions: [] }, listStaffProfiles: { profiles: [] }, listMemberships: { memberships: [] }, listMembers: { rows: [] } } });
    await page.goto("/admin/classes?adminTestRole=coach");
    await expect(page.getByText("Kids BJJ")).toBeVisible();
    await expect(page.getByRole("button", { name: "New class" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Remove|Edit|Generate/u })).toHaveCount(0);
  });
});
```

The exact response envelopes (`{ classes }`, `{ sessions }`, `{ profiles }`, `{ memberships }`, `{ rows }`) must match what each client unwraps — read the client before writing the fixture.

- [ ] **Step 2: Write `admin-levels.spec.ts`**

Navigate to `/admin/levels?adminTestRole=coach` (coach is allowed after Task 10) with the default fixture; assert `region[name=Belts]` has ≥ 20 `article`s, click `radio Kids` and assert fewer articles than before, click the first `button[name^="Filter by"]` and assert ≥ 1 article, take screenshots `levels-${project}.png`. If the levels client calls a callable in this build, answer `listLevelCatalog` with a two-belt fixture instead.

- [ ] **Step 3: Write `admin-billing-home.spec.ts`**

Fixture: `getFinancialDashboard` (a valid `dashboard` — copy a fixture from `apps/web/src/app/admin/finance/page.test.tsx` before deleting it, or build one that passes `isFinancialDashboard`), `listRecentPayments` with 20 rows (alternate `cash` / `bank_transfer`, one `memberName: null`), `listFinancialAccount` with one open invoice, `listMemberships`, `listMemberNames` with three members, `getFamilyFinancialAccount` returning the same account, `issueManualInvoice` echoing an invoice, `recordManualPayment` echoing a payment, plus whatever `NoShowPenaltyQueue` requests. Cases:

1. Home: heading "Billing", 4 metric articles, "Latest payments" region with 20 data rows, the `Cash` cell visible, details closed; screenshot `billing-home-${project}.png`.
2. Member history: search "ana", pick, region "Ana Coelho's account" with the "All payments" table; assert `getFamilyFinancialAccount` was called with `{ data: { familyId: "f1" } }`.
3. Issue invoice: open dialog, pick member, choose "No membership · custom charge", fill amount `15`, due date, reference, description, submit; assert the `issueManualInvoice` call body has `membershipId: null` and `dueAt: "<date>T23:59:59.000Z"`; feedback "Invoice issued."; screenshot `billing-invoice-${project}.png`.
4. Record payment: from the "All invoices" details, click "Record payment for INV-1", choose `Cash`, submit; assert the call body `method: "cash"`.

- [ ] **Step 4: Build the synthetic export and run the specs on both projects**

```bash
NEXT_PUBLIC_ADMIN_E2E=true corepack pnpm --filter @bpt-jersey/web build
cd qa && NEXT_PUBLIC_ADMIN_E2E=true node run-e2e.mjs --grep "admin classes|admin levels|billing home|admin shell" ; cd ..
```
Expected: all green on `desktop-chromium` and `mobile-chromium`. Open every screenshot (`Read` the PNG) and check against DESIGN.md: square corners, purple accent only, belt colours only inside the bars, buttons ≥ 3.15rem, one column on mobile, no horizontal scroll. Fix CSS and re-run until it matches.

- [ ] **Step 5: Commit**

```bash
git add qa/tests/admin-classes-form.spec.ts qa/tests/admin-levels.spec.ts qa/tests/admin-billing-home.spec.ts qa/tests/admin-shell.spec.ts
git commit -m "test(admin): playwright for the class form, belt cards, billing home and the coach menu"
```

---

### Task 23: Emulator spec for the new callables (qa + Docker)

**Files:**
- Create: `qa/tests/schedule-finance-emulator.spec.ts`
- Modify: `qa/run-e2e.mjs` (add `T032_SCHEDULE_FINANCE_EMULATOR_E2E` and `T032_FUNCTIONS_EMULATOR_PORT` to the forwarded env allow-list)

**Interfaces:**
- Gate: `process.env.T032_SCHEDULE_FINANCE_EMULATOR_E2E === "true"`, else `test.skip`.
- Reuse the helpers of `qa/tests/enrolment-approval-auth-emulator.spec.ts`: `syntheticAppCheckToken()`, `signIn(request, email, password)` and the callable POST envelope (`{ data }` with `Authorization: Bearer <idToken>` and `X-Firebase-AppCheck`). Copy them into this file (no shared module exists; keep the copy small).

- [ ] **Step 1: Write the spec**

```ts
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

const enabled = process.env.T032_SCHEDULE_FINANCE_EMULATOR_E2E === "true";
const functionsPort = process.env.T032_FUNCTIONS_EMULATOR_PORT ?? "5001";
const projectId = "demo-bpt-jersey";
const functionsBaseUrl = `http://127.0.0.1:${functionsPort}/${projectId}/us-central1`;
const authBase = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const academyId = "t032-academy";

// --- copy syntheticAppCheckToken and signIn from enrolment-approval-auth-emulator.spec.ts ---

async function createUser(request: APIRequestContext, email: string, role: string): Promise<string> {
  const signUp = await (await request.post(`${authBase}/accounts:signUp?key=demo`, { data: { email, password: "Passw0rd!", returnSecureToken: true } })).json();
  await request.post(`${authBase}/accounts:update?key=demo`, { data: { localId: signUp.localId, customAttributes: JSON.stringify({ role, academyId }) } });
  return signIn(request, email, "Passw0rd!");
}

async function call<T>(request: APIRequestContext, idToken: string, name: string, data: unknown): Promise<T> {
  const response = await request.post(`${functionsBaseUrl}/${name}`, {
    headers: { Authorization: `Bearer ${idToken}`, "X-Firebase-AppCheck": syntheticAppCheckToken(), "Content-Type": "application/json" },
    data: { data },
  });
  const envelope = (await response.json()) as { result?: T; error?: { message?: string; status?: string } };
  if (envelope.error) throw new Error(`${name}: ${envelope.error.status} ${envelope.error.message}`);
  return envelope.result as T;
}

test.describe("schedule and finance callables against the emulators", () => {
  test.skip(!enabled, "set T032_SCHEDULE_FINANCE_EMULATOR_E2E=true inside firebase emulators:exec");

  test("class with two rules → sessions → counts → booking → edit → remove", async ({ request }) => {
    const owner = await createUser(request, `owner-${randomUUID()}@t032.test`, "owner");
    const coach = await createUser(request, `coach-${randomUUID()}@t032.test`, "coach");
    const catalog = await call<{ programs: { programId: string }[] }>(request, owner, "listScheduleCatalog", null);
    const programId = catalog.programs[0]!.programId;
    const created = await call<{ class: { classId: string; schemaVersion: string } }>(request, owner, "saveClass", {
      programId, locationId: "town", name: "T032 Kids",
      recurrenceRules: [{ dayOfWeek: 1, startTime: "17:00", durationMinutes: 60 }, { dayOfWeek: 3, startTime: "18:30", durationMinutes: 45 }],
      instructorIds: ["coach-t032"], capacity: 2, description: "Bring a gi.", ageRange: { minAge: 8, maxAge: 11 },
    });
    expect(created.class.schemaVersion).toBe("2");
    const generated = await call<{ sessions: { sessionId: string; startAt: string; description?: string }[] }>(request, owner, "generateSessions", { classId: created.class.classId, fromDate: "2099-01-04", toDate: "2099-01-10" });
    expect(generated.sessions).toHaveLength(2);
    expect(generated.sessions[0]?.description).toBe("Bring a gi.");
    const window = { from: "2099-01-01T00:00:00.000Z", to: "2099-01-31T00:00:00.000Z" };
    const before = await call<{ counts: Record<string, number> }>(request, coach, "listSessionBookedCounts", window);
    expect(before.counts[generated.sessions[0]!.sessionId]).toBe(0);
    // a coach cannot edit
    await expect(call(request, coach, "updateSession", { sessionId: generated.sessions[0]!.sessionId, title: "X" })).rejects.toThrow(/PERMISSION_DENIED/u);
    const edited = await call<{ session: { title: string } }>(request, owner, "updateSession", { sessionId: generated.sessions[0]!.sessionId, title: "T032 Kids (Gi)", capacity: 3 });
    expect(edited.session.title).toBe("T032 Kids (Gi)");
    const removed = await call<{ class: { active: boolean }; cancelledSessions: unknown[] }>(request, owner, "removeClass", { classId: created.class.classId, reason: "T032 cleanup" });
    expect(removed.class.active).toBe(false);
    expect(removed.cancelledSessions).toHaveLength(2);
  });

  test("invoice without membership → cash payment → recent payments → family account → member names", async ({ request }) => {
    const owner = await createUser(request, `owner-${randomUUID()}@t032.test`, "owner");
    // Seed a family through the existing families callable used by T094/T095 (read qa/tests/*billing*emulator*.spec.ts for the exact call and payload) and capture its familyId.
    const familyId = await seedFamily(request, owner);
    const reference = `T032-${randomUUID().slice(0, 8)}`;
    const invoice = await call<{ invoiceId: string; membershipId: string | null }>(request, owner, "issueManualInvoice", { familyId, membershipId: null, totalMinor: 1500, dueAt: "2099-01-31T23:59:59.000Z", chargeKind: "manual_adjustment", invoiceReference: reference, description: "Seminar" });
    expect(invoice.membershipId).toBeNull();
    const payment = await call<{ method: string }>(request, owner, "recordManualPayment", { invoiceId: invoice.invoiceId, amountMinor: 1500, method: "cash", manualReference: `${reference}-CASH`, occurredAt: "2099-01-10T10:00:00.000Z" });
    expect(payment.method).toBe("cash");
    const recent = await call<{ payments: { invoiceReference: string; memberName: string | null; method: string }[] }>(request, owner, "listRecentPayments", null);
    expect(recent.payments.some((row) => row.invoiceReference === reference && row.memberName === null && row.method === "cash")).toBe(true);
    const family = await call<{ invoices: { invoice: { invoiceId: string } }[] }>(request, owner, "getFamilyFinancialAccount", { familyId });
    expect(family.invoices.map((v) => v.invoice.invoiceId)).toContain(invoice.invoiceId);
    const names = await call<{ members: unknown[] }>(request, owner, "listMemberNames", null);
    expect(Array.isArray(names.members)).toBe(true);
    await expect(call(request, await createUser(request, `coach-${randomUUID()}@t032.test`, "coach"), "listMemberNames", null)).rejects.toThrow(/PERMISSION_DENIED/u);
  });
});
```

`seedFamily`: `qa/tests/manual-billing-auth-emulator.spec.ts` already creates a family before invoicing; lift its exact seeding sequence (callable name + payload) into a local `seedFamily` helper.

- [ ] **Step 2: Forward the flags in `qa/run-e2e.mjs`**

Add `"T032_SCHEDULE_FINANCE_EMULATOR_E2E"` and `"T032_FUNCTIONS_EMULATOR_PORT"` to the env allow-list array next to the `T093_*` entries.

- [ ] **Step 3: Run inside the Docker emulator image** (host has no free 8080)

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm --filter @bpt-jersey/functions build
docker run --rm --network none \
  -v /root/BPT-Jersey:/root/BPT-Jersey -v /root/.cache/firebase:/root/.cache/firebase -v /root/.cache/node:/root/.cache/node \
  -e COREPACK_ENABLE_NETWORK=0 -e FUNCTIONS_DISCOVERY_TIMEOUT=300000 -e BPT_SYNTHETIC_PILOT=true \
  -w /root/BPT-Jersey bpt-emu:local bash -lc '
    node apps/functions/scripts/build-deploy-artifact.mjs &&
    corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions \
      "T032_SCHEDULE_FINANCE_EMULATOR_E2E=true corepack pnpm --dir qa exec playwright test tests/schedule-finance-emulator.spec.ts --project desktop-chromium --reporter=list"'
```
Expected: 2 passed. If the T121 emulator run of 2026-09-12 used a different entry (check the `T029V2` row and `git log --grep=emulator`), use that exact recipe; the memory note `vps-emulators-docker-sparse` records the constraints (jars pre-downloaded, secrets via `--env-file`).

Also run the rules suite the same way: `corepack pnpm test:rules` inside the container (nothing in this plan changes `firestore.rules`, so this is a regression check only).

- [ ] **Step 4: Commit**

```bash
git add qa/tests/schedule-finance-emulator.spec.ts qa/run-e2e.mjs
git commit -m "test(qa): emulator spec for v2 classes, session edits, class removal, booked counts and membership-less invoices"
```

---

### Task 24: Re-verify the coach work of 2026-09-12 (points 1–5)

**Files:**
- No source changes expected. Evidence goes to `tasksv2.md` in Task 25.

- [ ] **Step 1: Unit suites of the five items**

Run: `corepack pnpm vitest run --project web apps/web/src/app/admin/overview-page.test.tsx apps/web/src/app/admin/attendance apps/web/src/app/admin/members/requests apps/web/src/app/admin/members/medical apps/web/src/app/admin/admin-routes.test.ts apps/web/src/app/admin/page.test.tsx && corepack pnpm vitest run --project node packages/domain/src/birthdays packages/domain/src/schedule/pre-class-contracts.test.ts apps/functions/src/health apps/functions/src/members/enrolment-request-callables.test.ts`
Expected: all PASS. Record counts.

- [ ] **Step 2: Playwright of the five items with screenshots**

```bash
cd qa && NEXT_PUBLIC_ADMIN_E2E=true node run-e2e.mjs --grep "overview birthdays|attendance roster|enrolment requests|medical references|admin shell" ; cd ..
```
Expected: PASS on both projects. Add `page.screenshot` calls to those five specs if they lack them (commit as `test(admin): screenshots for the coach specs`), then `Read` the PNGs and check each requirement of the operator's list:

1. Overview: no black shortcut bar, no "Members" metric, "Next birthdays" with three rows and the "Birthday today" band when a row has `daysAway: 0`.
2. Attendance: one block per session titled `{title} · Coach {instructorId}`, tags Ready (green) / Booked (grey) / Late (red), "Clock in" only on grey/red rows, manual check-in payload `method: "manual"`.
3. Enrolment requests: the "What the buttons do" help block; coach sees "Send back to applicant" only.
4. Medical conditions: "Show all references" toggles the table, "Use" fills the Student ID.
5. Menu: no Memberships, no Waivers; coach sees the six entries (after Task 10).

- [ ] **Step 3: Note anything that fails**

If a spec fails because of this plan's changes (e.g. the coach menu now has six items), fix the spec. If it fails for another reason, fix the defect in a `fix(admin): …` commit and record it. Do not skip a failing case.

---

### Task 25: Ledger, board, gates and sparse restore

**Files:**
- Modify: `tasksv2.md` (section V2-E: rows T027V2–T031V2 status; new rows T032V2–T039V2), `Listav2/Listav2.data.js` (rows T027V2–T039V2: `adminItems`, `RESOLUTION_NOTES`, `RESOLUTION_REQUIREMENTS`, `TASK_SURFACES`, `evidenceSyncDates`; run `node Listav2/build.mjs` and `node Listav2/parallel-report.mjs`).

- [ ] **Step 1: New ledger rows** (single-line table rows, same columns as the section: `| ID | Tarea atomica | Depende de | Estado | Evidencia de salida |`; never run prettier on this file)

| ID | Tarea | Depende de | Estado |
| --- | --- | --- | --- |
| T032V2 | Clases con varios dias por semana, rango de nivel, rango de edad y descripcion (contrato v2, generador, formulario movil) | - | revision |
| T033V2 | Editar sesion y eliminar clase (cancela sus sesiones futuras) | T032V2 | revision |
| T034V2 | Levels como fichas de cinturon con stripes, filtros por edad y color | - | revision |
| T035V2 | Billing como home financiero: 20 ultimos pagos, historial por miembro, operativa plegada | T036V2 | revision |
| T036V2 | Issue invoice con busqueda de miembro y membresia opcional; Record payment efectivo/transferencia | - | revision |
| T037V2 | Coach y head coach ven Classes (coach en lectura) y Levels | T031V2 | revision |
| T038V2 | Calendario de miembros conectado: conteo de reservas real y ficha con nivel, edad y descripcion | T032V2 | revision |
| T039V2 | Verificacion de los cinco puntos de coaches (T027V2-T031V2) con capturas y suites | T027V2 | revision |

Evidence column for each: the exact commands run (Tasks 22–24), pass counts, the screenshot paths, the emulator run result, the design decision references (spec §, ADR-010 amendment), and "Sin despliegue." Status of T027V2–T031V2: change `en curso` → `revision` and append "Reverificado 2026-09-14 (T039V2): <suites and specs with counts>".

- [ ] **Step 2: Board rows in `Listav2/Listav2.data.js`**

For each of T027V2…T039V2 add a `task(id, title, status, description, dependsOn, evidence, references, kind)` entry to `adminItems` (T035V2/T036V2 may go to `paymentItems` — the ledger section is V2-E for all of them, so keep them in `adminItems`), a `RESOLUTION_NOTES[id]` sentence, `RESOLUTION_REQUIREMENTS[id]` with `requirement("…", true)` per delivered item, `TASK_SURFACES[id]` with the touched paths, and `evidenceSyncDates[id]: "2026-09-14"` (`"2026-09-12"` for T027V2–T031V2). Then:

```bash
node Listav2/build.mjs
node Listav2/parallel-report.mjs
corepack pnpm vitest run --project node qa/unit/listav2-ledger-sync.test.ts
```
Expected: the sync test PASSES (ids, statuses and dependencies agree; `revision` is a valid status). If `parallel-report.mjs` rewrites a block inside `tasksv2.md`, keep that edit (it is the generated "reparto" block) and nothing else.

- [ ] **Step 3: Full gates**

```bash
corepack pnpm format:check   # tasksv2.md is not in its globs; if it is, do NOT run prettier on it — exclude instead
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm verify:mvp     # rules step runs in Docker per the memory note if the host cannot bind 8080
```
Expected: green except the two documented pre-existing failures. Record the exact numbers in the ledger evidence.

- [ ] **Step 4: Commit and restore the sparse checkout**

```bash
git add tasksv2.md Listav2/
git commit -m "docs(ledger): T032V2-T039V2 and re-verification of T027V2-T031V2; board back in step"
git sparse-checkout set '/*' '!/.cronos' '!/Lista' '!/Listav2'
git status --short   # expect nothing pending
```

- [ ] **Step 5: Final report to the operator (in Spanish)**

Lead with what is verified and what is not: the callables are proven against the emulators, the UI against the synthetic session on both viewports, the member calendar adapter by unit + component + callable suites — and say plainly that a browser run of `/account` against emulators is impossible offline (App Check fail-closed), so the last verification of the connected calendar happens on staging when the operator sets `NEXT_PUBLIC_CALENDAR_SOURCE=firebase`. List the new callables that must be deployed with the next `firebase deploy --only functions:…` (updateSession, removeClass, listSessionBookedCounts, listRecentPayments, getFamilyFinancialAccount, listMemberNames) and remind that nothing was deployed.

---

## Self-review (run by the plan author before handing over)

**Spec coverage**

| Spec section | Tasks |
| --- | --- |
| §5.1 contracts | 1, 2, 3 |
| §5.2 store & callables | 4, 5 |
| §5.3 classes UI | 7, 8, 9 |
| §6 levels | 11, 12 |
| §7.1 finance backend | 13, 14, 15, 16 |
| §7.2 billing UI | 17, 18, 19, 20 |
| §8 menu & access | 10 |
| §9 member calendar | 6 (client), 21 |
| §10 tests | every task + 22, 23, 24 |
| §11 ledger drift | 0 (baseline), 25 |
| Decision 14 (branch/workbench commit) | 0 |
| Decision 16 (Cash / Bank transfer only in UI) | 19 |

**Type consistency checked**: `ClassRecord.recurrenceRules` (Tasks 2, 3, 4, 7, 9, 22); `UpdateSessionInput` fields (2, 4, 5, 6, 8); `RemoveClassInput { classId, reason }` (2, 5, 6, 8); `listSessionBookedCounts(query) → Record<string, number>` (5, 6, 21); `RecentPaymentRow` fields (13, 14, 15, 17, 20); `MemberNameRow { studentId, fullName, familyId | null }` (13, 16, 17, 18, 19, 20); `IssueManualInvoiceInput.membershipId: string | null` (13, 14, 15, 17, 19); `BeltOption { key, name, sequence }` (7, 8); `LevelRange` carries names (1, 7, 21).

**Placeholders**: none — every step names its file, its code and its command. Where a value must be read from the repo first (callable envelope shapes, `requireAdminActor` import path, the T094/T095 family seeding call), the step says exactly where to read it.
