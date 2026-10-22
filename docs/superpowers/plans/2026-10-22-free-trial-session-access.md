# Free Trial session access Implementation Plan

> **For agentic workers:** executed inline (operator asked to implement directly). No automated tests
> (repo AGENTS.md: tests only on explicit request); verification = focused tsc + code inspection.

**Goal:** each session says whether paid members, Free Trial members or both may book it, and trial
rules stop depending on the class type's name.

**Architecture:** reuse the session's `accessMode`: add `paid` and `trial-and-paid`; `intro` keeps
meaning Free-Trial-only; legacy `membership` resolves through the class type. One domain rule
(`sessionAudience`) and one trial rule (`trialSessionRefusal`) shared by server and calendar.

**Spec:** `docs/superpowers/specs/2026-10-22-free-trial-session-access-design.md` (D1–D16).

## Global Constraints

- `packages/domain` never imports Firebase.
- Member-facing copy says «Free Trial», never «Introduction Class».
- Deploy order: commit A (domain + functions) → push → full functions deploy → commit B (web UI) → push.
- No production data writes; no new indexes.

## Review Focus

1. Legacy `membership` session on the «Free Trail» type → Free Trial only (name rule, D11).
2. A paid member never books a Free-Trial-only session, by calendar, booking, walk-in or self check-in.
3. Minor on trial: paid sessions of their age + children's Free Trial sessions; never the adult one.
4. Admin can't switch both toggles off; private lessons unaffected.
5. Age limits / waitlists stay limited to paid-only sessions.

---

### Task 1: Domain rules (commit A)

**Files:** `packages/domain/src/schedule/schedule-contracts.ts`,
`packages/domain/src/schedule/member-calendar-contracts.ts`, `packages/domain/src/index.ts`

- `classAccessModes = ["membership", "intro", "private-lesson", "paid", "trial-and-paid"]`; parser
  error copy lists them.
- `isIntroductionClassName`: also `free trial` / `free trail` prefixes.
- `isIntroductionClass`: `intro` session, or marker `true`, or name rule (name beats a stored false).
- `sessionAudience(session, program): { paid: boolean; trial: boolean }` per spec table.
- `isPaidOnlySession(session, program): boolean` = paid && !trial.
- `accessModeForAudience({paid, trial}): "paid" | "intro" | "trial-and-paid"`.
- `trialSessionRefusal(session, program, age, site): "site" | "open_mat" | "age_band" | "trial_class_only" | undefined`
  (spec D2, D3, D10, D12). `introductionClassAdmitsAge` removed; `trial_intro_first` →
  `trial_class_only` («On your Free Trial, adults book Free Trial classes»).
- `trialLockedReason` and `lockedReasonFor` use them (D15).

### Task 2: Functions (commit A)

**Files:** `intro-booking-service.ts` (use `trialSessionRefusal`, drop beginner/first-intro rules),
`booking-transaction-service.ts:881` (`!paid` → «This class is for Free Trial members»),
`schedule-callables.ts` (679/684 and walk-in 1349 → paid-only / `!membership`; self check-in 1178
drops `intro ||=`), `age-capacity.ts`, `waitlist-invitations.ts` (ordinary = paid-only).

Verify: `corepack pnpm --filter @bpt-jersey/domain build:runtime` then the deploy tsc of functions.

### Task 3: Admin UI (commit B)

**Files:** `session-panel.tsx` (+ `classes-services.css`), `types/page.tsx`.

- «Class access»: private lesson keeps its read-only line; otherwise two switches «Paid members» /
  «Free Trial» bound to `sessionAudience(draft, program)`; toggling writes
  `accessModeForAudience`; the last one on is disabled. New sessions default `paid`.
- Age limits enabled only for paid-only.
- Types: remove the Introduction Class checkbox and badge.

### Task 4: Member copy (commit B)

`session-card.tsx`, `member-calendar.tsx`, `requests/page.tsx`, `enrol/page.tsx`,
`enrol/plan-choices.tsx`, `account/membership/page.tsx`, `lib/schedule-client.ts` («intro» refusal).

Verify: web `tsc --noEmit` (project tsconfig), inspection; commit; push after functions deploy.
