# Member Engagement Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put on `main` everything the three member features (streak T042V2, competitors T043V2, account settings T044V2) share, so three teams can build them in parallel without touching the same files.

**Architecture:** One pure domain module (`members/engagement`) holds the streak, hours, goal bars, public card and ranking helpers with tests. `/account` gets its slots once (`topSlot`, header links, two stub routes). Each feature gets an empty callables file already re-exported from `apps/functions/src/index.ts`. The ledger reserves T041V2–T044V2 with surfaces declared. `STACK.md` and `BRIEF.md` are removed.

**Tech Stack:** TypeScript strict, vitest, Next 16 static export, `lottie-web` (new, `apps/web` only).

**Spec:** `docs/superpowers/specs/2026-09-16-member-engagement-phase-0-design.md`

## Global Constraints

- All commands via `corepack pnpm …` from the repo root. Never install pnpm/firebase-tools globally.
- `packages/domain` never imports Firebase. New domain module must be added to `packages/domain/package.json` exports, `packages/domain/tsconfig.runtime.json` and `apps/functions/src/deploy-runtime.ts`.
- `admin/**` and `coach/**` under `apps/web/src/app` are owned by another session: do not touch.
- No `firestore.rules` / `firestore.indexes.json` changes (spec decision 4).
- Copy in English (British), Spanish in ledger/docs. Commit trailer per session instructions.
- Ledger ids contiguous: T041V2, T042V2, T043V2, T044V2. Both `tasksv2.md` and `Listav2/Listav2.data.js` change in the same commit; then `node Listav2/build.mjs` and `node Listav2/parallel-report.mjs`.

---

### Task 1: Domain module `members/engagement`

**Files:**
- Create: `packages/domain/src/members/member-engagement-contracts.ts`
- Create: `packages/domain/src/members/member-engagement-contracts.test.ts`
- Modify: `packages/domain/package.json` (exports, after `./members/regyfit-records`)
- Modify: `packages/domain/tsconfig.runtime.json` (include list)
- Modify: `apps/functions/src/deploy-runtime.ts` (`domainImportReplacements`)

**Interfaces (produces):**
```ts
export type AttendedSession = Readonly<{ occurredAt: string; durationMinutes: number }>;
export type ProgressTarget = Readonly<{ label: string; target: number }>;
export type ProgressBar = Readonly<{ label: string; target: number; progress: number; remaining: number; almost: boolean; complete: boolean }>;
export type MemberStreakSummary = Readonly<{ streakCount: number; seasonStart: string; hoursSinceSeasonStart: number; attendancesSinceSeasonStart: number; goal: ProgressBar; reward: ProgressBar }>;
export const defaultGoal: ProgressTarget;     // { label: "Next goal", target: 10 }
export const defaultReward: ProgressTarget;   // { label: "Next reward", target: 25 }
export const streakGapMs = 7 * 86_400_000;
export function seasonStartFor(nowIso: string): string;   // "YYYY-09-01" (Europe/Jersey)
export function sessionStreak(attendedAt: readonly string[], nowIso: string): number;
export function progressBar(target: ProgressTarget, progress: number): ProgressBar;
export function buildMemberStreakSummary(input: { attendances: readonly AttendedSession[]; now: string; goal?: ProgressTarget; reward?: ProgressTarget }): MemberStreakSummary;
export type MemberPublicCard = Readonly<{ studentId: string; displayName: string; photoUrl: string | null; belt: Readonly<{ name: string; color: string }> | null; stripes: number; streakCount: number; skillKeys: readonly string[] }>;
export function compareTechniques(mine: readonly string[], theirs: readonly string[]): Readonly<{ theyHave: readonly string[]; iHave: readonly string[] }>;
export function rankNeighbours<T extends { studentId: string }>(input: { entries: readonly T[]; currentStudentId: string; score: (entry: T) => number; span?: number }): Readonly<{ above: readonly T[]; current: T; below: readonly T[] }> | null;
```

- [ ] **Step 1: Write the failing test** (`member-engagement-contracts.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import {
  buildMemberStreakSummary, compareTechniques, progressBar, rankNeighbours,
  seasonStartFor, sessionStreak,
} from "./member-engagement-contracts";

describe("seasonStartFor", () => {
  it("is the most recent 1 September in Jersey", () => {
    expect(seasonStartFor("2026-09-16T10:00:00.000Z")).toBe("2026-09-01");
    expect(seasonStartFor("2026-08-31T23:30:00.000Z")).toBe("2025-09-01"); // 00:30 BST 1 Sept? no: 31 Aug 23:30Z = 1 Sept 00:30 BST
  });
});
```
(The full test file is in the repository; it covers: streak counts consecutive check-ins ≤7 days apart, breaks on an 8-day gap, ignores the future, is 0 when the last attendance is older than 7 days; `progressBar` marks `almost` only at remaining 1 and clamps at complete; `buildMemberStreakSummary` sums hours since the season start only; `compareTechniques` returns sorted disjoint sets; `rankNeighbours` returns two above and two below by score, fewer at the edges, `null` when the student is absent.)

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm vitest run --project node packages/domain/src/members/member-engagement-contracts.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `member-engagement-contracts.ts` (see repository; pure functions, `Object.freeze` results, no Firebase).

- [ ] **Step 4: Register the module** in `packages/domain/package.json`, `tsconfig.runtime.json`, `deploy-runtime.ts` (key `@bpt-jersey/domain/members/engagement`).

- [ ] **Step 5: Run tests** — same command, expected PASS; then `corepack pnpm vitest run --project node apps/functions/src/deploy-runtime.test.ts` PASS.

- [ ] **Step 6: Commit** `feat(domain): member engagement contracts (streak, season hours, goal bars, public card, neighbours)`

### Task 2: `photoUrl` on `StudentProfile`

**Files:**
- Modify: `packages/domain/src/profiles/profile-contracts.ts` (type, `studentProfileFields`, optional list, validation)
- Test: `packages/domain/src/profiles/profile-contracts.test.ts`

- [ ] **Step 1: Failing test** — a student with `photoUrl: "https://cdn.example/x.jpg"` parses; `photoUrl: "javascript:alert(1)"` yields issue `["photoUrl"], "invalid_url"`; omitted is fine.
- [ ] **Step 2: Run** `corepack pnpm vitest run --project node packages/domain/src/profiles/profile-contracts.test.ts` → FAIL.
- [ ] **Step 3: Implement**: `photoUrl?: string;` in the type; add `"photoUrl"` to `studentProfileFields` and to the optional list of `studentRequiredProfileFields` and `validateCommonIdentity`; validate `typeof === "string" && /^https:\/\//u && length ≤ 512`.
- [ ] **Step 4: Run** → PASS. Also `corepack pnpm vitest run --project node apps/functions/src/profiles` → PASS.
- [ ] **Step 5: Commit** `feat(domain): optional https photoUrl on StudentProfile`

### Task 3: Callable files reserved per team

**Files:**
- Create: `apps/functions/src/streak/streak-callables.ts`, `apps/functions/src/competitors/competitors-callables.ts`, `apps/functions/src/account-settings/account-settings-callables.ts` — each `export {};` with a header comment naming the owning row.
- Modify: `apps/functions/src/index.ts` — append `export * from "./streak/streak-callables.js";` etc.

- [ ] **Step 1:** create the three files and the three exports.
- [ ] **Step 2:** `corepack pnpm --filter @bpt-jersey/functions typecheck` → PASS.
- [ ] **Step 3: Commit** `chore(functions): reserve callable modules for T042V2–T044V2`

### Task 4: `/account` slots, stub routes, animation, `lottie-web`

**Files:**
- Modify: `apps/web/src/app/account/calendar/member-calendar.tsx` — new prop `topSlot?: ReactNode`, rendered between `<ReadyForJiuJitsu>` and `<CalendarHeader>`.
- Modify: `apps/web/src/app/account/calendar/calendar-header.tsx` — `<nav className="member-links">` with links Progress `/account/progress`, Competitors `/account/competitors`, Settings `/account/settings`.
- Modify: `apps/web/src/app/account/account.css` — `.member-links` styles.
- Create: `apps/web/src/app/account/streak/streak-panel.tsx` — `export function StreakPanel() { return null; }` (T042V2 fills it).
- Modify: `apps/web/src/app/account/page.tsx` — `topSlot={<StreakPanel />}`.
- Create: `apps/web/src/app/account/competitors/page.tsx` + `page.test.tsx`; `apps/web/src/app/account/settings/page.tsx` + `page.test.tsx` — auth-gated, `<h1>`, "Coming soon" paragraph, back link.
- Create: `apps/web/public/animations/streak-flame.json` (copy of `Assets/Soguk Seri Atesi.json`).
- Modify: `apps/web/package.json` — `"lottie-web": "5.13.0"`; `pnpm-lock.yaml` via `corepack pnpm install`.
- Test: `calendar-header.test.tsx` (links present), `member-calendar.test.tsx` (topSlot renders before header).

- [ ] **Step 1:** failing tests for links and topSlot, run `corepack pnpm vitest run --project web apps/web/src/app/account/calendar` → FAIL.
- [ ] **Step 2:** implement; run → PASS.
- [ ] **Step 3:** stub pages + tests; `corepack pnpm vitest run --project web apps/web/src/app/account` → PASS.
- [ ] **Step 4:** copy animation, add dependency, `corepack pnpm install`, `corepack pnpm audit --audit-level high` → no high.
- [ ] **Step 5: Commit** `feat(account): slots for streak, competitors and settings; flame animation and lottie-web`

### Task 5: Ledger rows T041V2–T044V2

**Files:**
- Modify: `tasksv2.md` — new section `## V2-I - Racha, competidores y ajustes de la cuenta` with four rows; REPARTO regenerated.
- Modify: `Listav2/Listav2.data.js` — four `task(...)` in a new stage `engagement` (track `miembros`), `RESOLUTION_REQUIREMENTS`, `TASK_SURFACES`, `evidenceSyncDates`.
- Generated: `Listav2/Listav2.js`.

- [ ] **Step 1:** add rows (T041V2 `aprobada` once this plan lands; T042V2–T044V2 `pendiente`, T044V2 depends on T009V2, T043V2 depends on T041V2 and T044V2, T042V2 depends on T041V2).
- [ ] **Step 2:** `node Listav2/build.mjs && node Listav2/parallel-report.mjs`.
- [ ] **Step 3:** `corepack pnpm vitest run --project node qa/unit/listav2-ledger-sync.test.ts qa/unit/listav2-checklist.test.ts qa/unit/listav2-interference.test.ts` → PASS.
- [ ] **Step 4: Commit** `docs(ledger): T041V2–T044V2 reserved for the member engagement features`

### Task 6: Retire `STACK.md` and `BRIEF.md`

**Files:**
- Delete: `STACK.md`, `BRIEF.md`.
- Modify: `CLAUDE.md` line 11, `README.md` lines 9 and 372–377, `PRODUCT.md` lines 3–4 and the two `BRIEF.md` mentions.

- [ ] **Step 1:** `git rm STACK.md BRIEF.md`; edit references so they point at `PRODUCT.md`, `DESIGN.md`, `LECCIONES.md`, `docs/adr/`.
- [ ] **Step 2:** `grep -rn "STACK.md\|BRIEF.md" CLAUDE.md README.md PRODUCT.md` → empty.
- [ ] **Step 3: Commit** `chore: retire STACK.md and BRIEF.md (Cronos-only documents)`

### Task 7: Full gate and push

- [ ] `corepack pnpm format:check && corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test` → all green.
- [ ] `corepack pnpm --filter @bpt-jersey/domain build:runtime && corepack pnpm --filter @bpt-jersey/functions build` → green.
- [ ] `corepack pnpm --filter @bpt-jersey/web build` → green (static export).
- [ ] Operator pushes: `git push origin HEAD:main` (pushing is blocked for the agent).
