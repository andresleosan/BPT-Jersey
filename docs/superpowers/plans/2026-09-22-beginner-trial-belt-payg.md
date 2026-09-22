# Beginner Trial, Declared Belt, PAYG Conversion and Pay-at-Venue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a new student register as a Beginner (2 free Introduction Classes) or declare a belt (1 free class), book those classes without a plan, get nudged into a membership after the first class, auto-convert to PAYG at West, and choose "pay online" or "pay at the academy" for every PAYG booking.

**Architecture:** Extend the existing Intro Class funnel (spec 2026-09-21) instead of building a parallel one. A server-only `trialAccess/{studentId}` document is the source of truth for the Trial (allowance, attended count, expiry); it is never a membership. Public enrolment gains a `"trial"` plan choice plus a per-student level declaration; office approval creates level + trial. Booking, calendar visibility, the attendance trigger and the membership application all read the trial document. PAYG bookings carry a `paygPayment` field, issue their invoice at booking time, and staff settle it with one tick.

**Tech Stack:** pnpm monorepo. `packages/domain` (TypeScript + zod, pure contracts, tests with vitest), `apps/functions` (Firebase Functions v2, firebase-admin Firestore, europe-west9, tests with vitest + in-memory fake Firestore), `apps/web` (Next.js/React, Firebase callables via `httpsCallable` wrapper, vitest + testing-library).

**Spec:** `docs/superpowers/specs/2026-09-22-beginner-trial-belt-payg-design.md` — decisions D1–D17 are the acceptance criteria; the plan cites them as `[Dn]`.

## Global Constraints

- Work directly on `main` (AGENTS.md). Commit each task; do not push until Task 17. Never touch files another session has modified in the working tree (`git status` shows them; currently `PRODUCT.md`, `apps/functions/src/schedule/attendance-transaction-service.ts`, `apps/functions/src/schedule/booking-transaction-service.ts`, `apps/functions/src/schedule/schedule-callables.ts`, `apps/functions/src/index.ts`, `apps/web/src/app/admin/classes-services/classes/registrations-panel.tsx`, `docs/adr/ADR-018-*`, `packages/domain/package.json` and others). If a task below must edit one of those files and it is still dirty in `git status`, STOP and report; do not stash, revert or commit someone else's hunks. Coordinate: the other session's work must be committed before Tasks 9, 10, 11 and 13 can be committed.
- Run only the focused vitest files named in each task: `corepack pnpm vitest run --project node <file>` for domain/functions, `corepack pnpm vitest run --project web <file>` for web. Do not run the full suite, lint or typecheck of the whole workspace as a gate (AGENTS.md); run `corepack pnpm --filter @bpt-jersey/functions typecheck` only in Task 17.
- All user-facing copy in British English, short, no internal IDs. Copy that is fixed by the spec:
  - Beginner card title: `I am a beginner` — body: `Trial: 2 free Introduction Classes`.
  - Button: `I'm not a Beginner`. Experienced card body: `Trial: 1 free Introduction Class`.
  - Notice after first class: title `Did you enjoy training with us?`, body `Tap here to get a membership and keep training with us.`
  - Trial label pattern: `Trial · {left} of {allowance} classes left · ends {date}`; ended: `Your trial has ended. Choose a membership to keep training.`
  - Roster labels: `PAYG Pay at venue`, `PAYG Transfer sent`, `PAYG Paid`, `PAYG Needs to pay`.
- Trial constants: `TRIAL_DAYS = 30`; allowance beginner `2`, experienced `1`; age rule boundary is `16` (age on the session date, Jersey calendar day).
- PAYG plans are only `payg` (adult, West, £10) and `west-teens-payg` (teens, West, £7.50); nothing in this plan adds a Town PAYG plan.
- `transit-free` is never offered to members; assigning it requires actor role `owner` [D13].
- Every new callable uses `browserAdminCallableOptions` or `scheduleCallableOptions` exactly like its neighbours (App Check enforced) and is exported from `apps/functions/src/index.ts`.
- New Firestore collection `trialAccess`: add `allow read, write: if false;` to `firestore.rules` (Task 5).

---

## File map

| Area | File | Responsibility |
|---|---|---|
| domain | `packages/domain/src/members/enrolment-request-contracts.ts` | `"trial"` plan choice, level declarations, allowance, validation |
| domain | `packages/domain/src/memberships/trial-access-contracts.ts` (new) | `trialAccess` record schema + status/expiry helpers |
| domain | `packages/domain/src/schedule/member-calendar-contracts.ts` | trial rules in `lockedReasonFor`, new locked reasons + labels |
| domain | `packages/domain/src/schedule/schedule-contracts.ts` | `paygPayment` on booking input/record, roster labels |
| domain | `packages/domain/src/finance/finance-contracts.ts` | `calculatePaygDebt(..., asOf)` |
| domain | `packages/domain/src/memberships/intro-conversion-contracts.ts` | per-session applications without proof |
| functions | `apps/functions/src/members/enrolment-registration.ts` | approval creates level + trial for `"trial"` students |
| functions | `apps/functions/src/members/enrolment-request-service.ts` | persists `levelDeclarations` |
| functions | `apps/functions/src/memberships/trial-access-service.ts` (new) | read/expire/count helpers shared by booking, calendar, trigger |
| functions | `apps/functions/src/schedule/intro-booking-service.ts` | trial-based eligibility (allowance, age rule, site) |
| functions | `apps/functions/src/memberships/intro-conversion-service.ts` | count attendance, new notice copy, West auto-PAYG |
| functions | `apps/functions/src/schedule/member-calendar-week-callables.ts` | trial context in calendar, `getTrialAccess` callable |
| functions | `apps/functions/src/memberships/intro-application-service.ts` + `-admin-service.ts` | PAYG applications |
| functions | `apps/functions/src/schedule/payg-class-payment.ts` | shared `ensurePaygClassInvoice`, `confirmPaygClassPayment`, `uploadPaygClassProof`, `getPaygClassProofUrl` |
| functions | `apps/functions/src/schedule/payg-booking-payment.ts` (new) | attach payment choice to a booking, void on cancel |
| functions | `apps/functions/src/schedule/session-registrations.ts` | roster labels |
| functions | `apps/functions/src/memberships/manual-subscription-service.ts` | Transit Free owner-only |
| web | `apps/web/src/app/enrol/plan-choices.tsx`, `page.tsx` | Beginner card, belt/stripes, submission |
| web | `apps/web/src/app/admin/members/requests/page.tsx` | declaration display, preselected level, trial setup, Membership requests section |
| web | `apps/web/src/app/account/calendar/*`, `apps/web/src/lib/calendar/*` | trial band, booking rules, PAYG payment dialog |
| web | `apps/web/src/app/account/membership/*`, `apps/web/src/app/account/intro-notices.tsx` | Trial status, PAYG application, notice copy |
| web | `apps/web/src/app/admin/classes-services/classes/registrations-panel.tsx` | labels, Confirm paid, View transfer |
| web | `apps/web/src/app/admin/members/member-subscription-editor.tsx` | Transit Free owner-only |

---

### Task 1: Domain — enrolment contracts: `"trial"` choice, level declarations, allowance [D1][D2][D8]

**Files:**
- Modify: `packages/domain/src/members/enrolment-request-contracts.ts`
- Test: `packages/domain/src/members/enrolment-request-contracts.test.ts`

**Interfaces:**
- Produces:
  - `export const trialPlanChoice = "trial" as const; export type EnrolmentPlanChoice = PlanId | "trial";`
  - `export const enrolmentExperiences = Object.freeze(["beginner", "experienced"] as const); export type EnrolmentExperience = ...`
  - `export const enrolmentLevelDeclarationSchema` → `{ experience: EnrolmentExperience; declaredLevelKey: string | null }`
  - `export const enrolmentLevelDeclarationsSchema` → `{ applicant?: EnrolmentLevelDeclaration; minors: readonly EnrolmentLevelDeclaration[] }`; type `EnrolmentLevelDeclarations`
  - `export function enrolmentTrialAllowance(experience: EnrolmentExperience): 1 | 2`
  - `enrolmentNeedsPayment("trial") === false`; `enrolmentPaymentTotal` ignores trial.
  - `enrolmentPlanSelectionsSchema` accepts `"trial"`; `enrolmentApprovalSetupSchema.students[].planId` accepts `"trial"` (then `endsOn` must be `null`).
  - `enrolmentRequestSubmissionSchema` and `enrolmentRequestRecordSchema` gain optional `levelDeclarations`; `EnrolmentRequestDetail` exposes it.

- [ ] **Step 1: Write the failing tests** (append to the existing `describe` blocks in the test file; reuse its `applicant`, `effectiveDate`, `requestId` fixtures and its `submission(...)` helper if present, otherwise build the object inline the way the file's first `parseEnrolmentRequestSubmission` test does)

```ts
import { enrolmentTrialAllowance, enrolmentNeedsPayment, enrolmentPaymentTotal, parseEnrolmentRequestSubmission, parseEnrolmentRequestApproval, toEnrolmentRequestDetail } from "./enrolment-request-contracts";

describe("trial plan choice", () => {
  it("needs no payment and counts nothing towards the transfer total", () => {
    expect(enrolmentNeedsPayment("trial")).toBe(false);
    expect(enrolmentPaymentTotal({ applicant: "trial", minors: [] })).toBe(0);
    expect(enrolmentPaymentTotal({ minors: ["trial", "town-kids-1x"] })).toBe(9500);
  });
  it("gives a beginner 2 classes and an experienced student 1", () => {
    expect(enrolmentTrialAllowance("beginner")).toBe(2);
    expect(enrolmentTrialAllowance("experienced")).toBe(1);
  });
  it("accepts a beginner trial submission without payment", () => {
    const result = parseEnrolmentRequestSubmission(
      { requestId, applicantIsStudent: true, applicant, minors: [], waiverAcceptance,
        planSelections: { applicant: "trial", minors: [] },
        levelDeclarations: { applicant: { experience: "beginner", declaredLevelKey: null }, minors: [] } },
      effectiveDate,
    );
    expect(result.ok).toBe(true);
  });
  it("requires a declared level for an experienced trial student", () => {
    const result = parseEnrolmentRequestSubmission(
      { requestId, applicantIsStudent: true, applicant, minors: [], waiverAcceptance,
        planSelections: { applicant: "trial", minors: [] },
        levelDeclarations: { applicant: { experience: "experienced", declaredLevelKey: null }, minors: [] } },
      effectiveDate,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.code).toBe("declared_level_required");
  });
  it("requires a declaration for every trial student", () => {
    const result = parseEnrolmentRequestSubmission(
      { requestId, applicantIsStudent: true, applicant, minors: [], waiverAcceptance,
        planSelections: { applicant: "trial", minors: [] } },
      effectiveDate,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.code).toBe("level_declaration_required");
  });
  it("rejects a beginner who also declares a level", () => {
    const result = parseEnrolmentRequestSubmission(
      { requestId, applicantIsStudent: true, applicant, minors: [], waiverAcceptance,
        planSelections: { applicant: "trial", minors: [] },
        levelDeclarations: { applicant: { experience: "beginner", declaredLevelKey: "blue-belt" }, minors: [] } },
      effectiveDate,
    );
    expect(result.ok).toBe(false);
  });
  it("approves a trial student only with an open-ended period", () => {
    const base = { enrolmentRequestId: "enrol-1", requestId, purpose: "enrolment-request-review" as const };
    const ok = parseEnrolmentRequestApproval({ ...base, setup: { students: [{ planId: "trial", definitionKey: "white-belt", startsOn: "2026-09-06", endsOn: null }], detailsVerified: true, paymentVerified: true } });
    expect(ok.ok).toBe(true);
    const bad = parseEnrolmentRequestApproval({ ...base, setup: { students: [{ planId: "trial", definitionKey: "white-belt", startsOn: "2026-09-06", endsOn: "2026-10-06" }], detailsVerified: true, paymentVerified: true } });
    expect(bad.ok).toBe(false);
  });
  it("carries level declarations into the office detail", () => {
    const detail = toEnrolmentRequestDetail({ ...record, levelDeclarations: { applicant: { experience: "experienced", declaredLevelKey: "blue-2nd-stripe" }, minors: [] } });
    expect(detail.levelDeclarations?.applicant?.declaredLevelKey).toBe("blue-2nd-stripe");
  });
});
```
(`waiverAcceptance` = `{ version: enrolmentWaiverTermsVersion, accepted: true }`; `record` = any valid `EnrolmentRequestRecord` fixture already used by the `toEnrolmentRequestDetail` tests in that file.)

- [ ] **Step 2: Run the test file to verify it fails**

Run: `cd /root/BPT-Jersey && corepack pnpm vitest run --project node packages/domain/src/members/enrolment-request-contracts.test.ts`
Expected: FAIL — `enrolmentTrialAllowance is not a function` / zod rejects `"trial"`.

- [ ] **Step 3: Implement**

In `enrolment-request-contracts.ts`:

```ts
export const trialPlanChoice = "trial" as const;
export type EnrolmentPlanChoice = PlanId | typeof trialPlanChoice;
const enrolmentPlanChoiceSchema = z.union([z.enum(planIds), z.literal(trialPlanChoice)]);

export const enrolmentExperiences = Object.freeze(["beginner", "experienced"] as const);
export type EnrolmentExperience = (typeof enrolmentExperiences)[number];

/** Beginners get two free Introduction Classes; a student who declares a belt gets one. */
export function enrolmentTrialAllowance(experience: EnrolmentExperience): 1 | 2 {
  return experience === "beginner" ? 2 : 1;
}

export const enrolmentLevelDeclarationSchema = z
  .strictObject({
    experience: z.enum(enrolmentExperiences),
    declaredLevelKey: opaqueIdentifierSchema.nullable(),
  })
  .readonly();
export type EnrolmentLevelDeclaration = Readonly<z.infer<typeof enrolmentLevelDeclarationSchema>>;

export const enrolmentLevelDeclarationsSchema = z
  .strictObject({
    applicant: enrolmentLevelDeclarationSchema.optional(),
    minors: z.array(enrolmentLevelDeclarationSchema).max(maximumEnrolmentRequestMinors).readonly(),
  })
  .readonly();
export type EnrolmentLevelDeclarations = Readonly<z.infer<typeof enrolmentLevelDeclarationsSchema>>;
```

Replace `z.enum(planIds)` inside `enrolmentPlanSelectionsSchema` (both `applicant` and `minors`) with `enrolmentPlanChoiceSchema`. In `enrolmentApprovalSetupSchema.students[]`, `planId: enrolmentPlanChoiceSchema` and add `.refine((s) => s.planId !== "trial" || s.endsOn === null, "Trial has no paid period")` on the student object.

```ts
export function enrolmentNeedsPayment(planId: string): boolean {
  if (planId === trialPlanChoice) return false;
  const plan = PLAN_CATALOG.find((item) => item.planId === planId);
  return plan?.billingPeriod !== "per-session";
}
```
(`enrolmentPaymentTotal` already returns 0 for anything `enrolmentNeedsPayment` rejects; the `PLAN_CATALOG.find` for `"trial"` yields `undefined ?? 0` — keep as is.)

Add `levelDeclarations: enrolmentLevelDeclarationsSchema.optional()` to `enrolmentRequestSubmissionSchema` and `enrolmentRequestRecordSchema`; add `levelDeclarations?: EnrolmentLevelDeclarations` to `EnrolmentRequestDetail` and spread it in `toEnrolmentRequestDetail` like `planSelections`.

In `parseEnrolmentRequestSubmission`, destructure `levelDeclarations` too and, after the plan availability loop, add:

```ts
  const choices = applicantIsStudent
    ? [{ path: ["applicant"] as const, plan: planSelections.applicant, declaration: levelDeclarations?.applicant }]
    : minors.map((_, index) => ({ path: ["minors", index] as const, plan: planSelections.minors[index], declaration: levelDeclarations?.minors[index] }));
  for (const { path, plan, declaration } of choices) {
    if (plan !== trialPlanChoice) continue;
    if (!declaration) return err(issue(["levelDeclarations", ...path], "level_declaration_required"));
    if (declaration.experience === "experienced" && declaration.declaredLevelKey === null)
      return err(issue(["levelDeclarations", ...path], "declared_level_required"));
    if (declaration.experience === "beginner" && declaration.declaredLevelKey !== null)
      return err(issue(["levelDeclarations", ...path], "beginner_declares_no_level"));
  }
```
The plan-availability checks (`getEnrolmentPlans(...).some(...)`) must accept `"trial"` for any student: change both conditions to `planSelections.applicant !== trialPlanChoice && !getEnrolmentPlans(...).some(...)` (same for minors).

- [ ] **Step 4: Run the test file to verify it passes**

Run: `corepack pnpm vitest run --project node packages/domain/src/members/enrolment-request-contracts.test.ts`
Expected: PASS (all, including pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/members/enrolment-request-contracts.ts packages/domain/src/members/enrolment-request-contracts.test.ts
git commit -m "Accept a trial plan choice and level declaration in enrolment requests"
```

---

### Task 2: Domain — `trialAccess` record contracts [D5][D7]

**Files:**
- Create: `packages/domain/src/memberships/trial-access-contracts.ts`
- Create: `packages/domain/src/memberships/trial-access-contracts.test.ts`
- Modify: `packages/domain/package.json` (add export `./memberships/trial-access`, mirror the `./memberships/intro-conversion` entry) — **this file is dirty in another session's tree: if `git status` still lists it, add the export anyway but commit only your hunk with `git add -p`; if that is not possible, stop and report.**
- Modify: `packages/domain/src/index.ts` (re-export the new module next to the intro-conversion exports)

**Interfaces:**
- Produces:
```ts
export const trialAccessStatuses = Object.freeze(["active", "exhausted", "expired", "converted"] as const);
export type TrialAccessStatus = (typeof trialAccessStatuses)[number];
export const TRIAL_DAYS = 30;
export const trialAccessSchema = z.strictObject({
  trialId: identifier, academyId: identifier, studentId: identifier,
  site: z.enum(siteValues), experience: z.enum(["beginner", "experienced"]),
  allowance: z.union([z.literal(1), z.literal(2)]),
  countedAttendanceIds: z.array(identifier).max(10),
  status: z.enum(trialAccessStatuses),
  startsAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  enrolmentRequestId: identifier, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  schemaVersion: z.literal("1"),
});
export type TrialAccessRecord = z.infer<typeof trialAccessSchema>;
export function trialExpiresAt(startsAt: string): string;             // startsAt + TRIAL_DAYS days, ISO
export function trialAttendedCount(trial: TrialAccessRecord): number;  // countedAttendanceIds.length
export function trialStatusAt(trial: TrialAccessRecord, nowIso: string): TrialAccessStatus;
export type TrialAccessView = Readonly<{ site: Site; allowance: 1 | 2; attendedCount: number; futureBookings: number; expiresAt: string; status: TrialAccessStatus }>;
```
`trialStatusAt`: `converted` stays; otherwise `expired` if `now >= expiresAt`; otherwise `exhausted` if `attendedCount >= allowance`; otherwise `active`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { trialAccessSchema, trialExpiresAt, trialStatusAt, TRIAL_DAYS } from "./trial-access-contracts";

const trial = trialAccessSchema.parse({
  trialId: "student-1", academyId: "academy-1", studentId: "student-1", site: "West",
  experience: "beginner", allowance: 2, countedAttendanceIds: [], status: "active",
  startsAt: "2026-09-22T10:00:00.000Z", expiresAt: trialExpiresAt("2026-09-22T10:00:00.000Z"),
  enrolmentRequestId: "enrol-1", createdAt: "2026-09-22T10:00:00.000Z", updatedAt: "2026-09-22T10:00:00.000Z", schemaVersion: "1",
});

describe("trial access", () => {
  it("expires 30 days after it starts", () => {
    expect(TRIAL_DAYS).toBe(30);
    expect(trial.expiresAt).toBe("2026-10-22T10:00:00.000Z");
  });
  it("is active until the allowance is used or the date passes", () => {
    expect(trialStatusAt(trial, "2026-09-23T10:00:00.000Z")).toBe("active");
    expect(trialStatusAt({ ...trial, countedAttendanceIds: ["a", "b"] }, "2026-09-23T10:00:00.000Z")).toBe("exhausted");
    expect(trialStatusAt(trial, "2026-10-22T10:00:00.000Z")).toBe("expired");
    expect(trialStatusAt({ ...trial, status: "converted" }, "2026-12-01T00:00:00.000Z")).toBe("converted");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `corepack pnpm vitest run --project node packages/domain/src/memberships/trial-access-contracts.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** the module exactly per the interface above (`identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u)`, import `siteValues`/`Site` from `./plan-contracts`). `trialExpiresAt`: `new Date(Date.parse(startsAt) + TRIAL_DAYS * 86_400_000).toISOString()`. Add the package export and the `index.ts` re-exports (`trialAccessSchema, trialAccessStatuses, trialExpiresAt, trialAttendedCount, trialStatusAt, TRIAL_DAYS` and types `TrialAccessRecord, TrialAccessStatus, TrialAccessView`).

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/memberships/trial-access-contracts.ts packages/domain/src/memberships/trial-access-contracts.test.ts packages/domain/src/index.ts
git add -p packages/domain/package.json   # only the ./memberships/trial-access export hunk
git commit -m "Add trial access record contracts"
```

---

### Task 3: Domain — calendar trial rules and labels [D6][D7][D12]

**Files:**
- Modify: `packages/domain/src/schedule/member-calendar-contracts.ts`
- Test: `packages/domain/src/schedule/member-calendar-contracts.test.ts` (exists; append)

**Interfaces:**
- Produces:
  - `LockedReason` gains `"trial_ended" | "trial_intro_only"`.
  - `CalendarMemberContext.trial?: TrialAccessView` (import type from `../memberships/trial-access-contracts`).
  - `lockedReasonLabel` handles both new reasons.
  - `deriveSessionStatus` returns `booked`/`attended` for a session the member already holds even when the lock applies now.
  - `export function ageOnDate(dateOfBirth: string, dateKey: string): number` (extracted from `participantTypeOn`).

- [ ] **Step 1: Write the failing tests** (use the file's existing `session`/`program`/`member` fixture builders; if none fit, build minimal `SessionRecord`/`ProgramRecord` objects the way the nearest existing test does)

```ts
const trial = { site: "West" as const, allowance: 2 as const, attendedCount: 0, futureBookings: 0, expiresAt: "2026-10-22T10:00:00.000Z", status: "active" as const };
const trialMember = { ...memberWithoutMembership, membershipId: null, hasActiveMembership: false, trial, dateOfBirth: "1990-01-01" };
const westIntro = { ...session, locationId: "west", accessMode: "intro" };
const westClass = { ...session, locationId: "west" };
const kidsProgram = { ...program, ageBand: "kids" };

describe("trial calendar access", () => {
  it("lets a 16+ trial member book intro sessions at their site only", () => {
    expect(canViewMemberSession(westIntro, program, trialMember)).toBe(true);
    expect(deriveSessionStatus({ session: westClass, program, member: trialMember, bookedCount: 0, now }).lockedReason).toBe("trial_intro_only");
    expect(deriveSessionStatus({ session: { ...westIntro, locationId: "town" }, program, member: trialMember, bookedCount: 0, now }).lockedReason).toBe("site");
  });
  it("lets an under-16 trial member book classes of their age band", () => {
    const kid = { ...trialMember, dateOfBirth: "2018-01-01" };
    expect(canViewMemberSession(westClass, kidsProgram, kid)).toBe(true);
    expect(deriveSessionStatus({ session: westClass, program: { ...program, ageBand: "adult" }, member: kid, bookedCount: 0, now }).lockedReason).toBe("age_band");
  });
  it("locks everything once the allowance is used or the trial expired", () => {
    const used = { ...trialMember, trial: { ...trial, attendedCount: 1, futureBookings: 1 } };
    expect(deriveSessionStatus({ session: westIntro, program, member: used, bookedCount: 0, now }).lockedReason).toBe("trial_ended");
    const expired = { ...trialMember, trial: { ...trial, status: "expired" as const } };
    expect(deriveSessionStatus({ session: westIntro, program, member: expired, bookedCount: 0, now }).lockedReason).toBe("trial_ended");
  });
  it("still shows a held session as booked after the trial locks", () => {
    const used = { ...trialMember, trial: { ...trial, attendedCount: 1, futureBookings: 1 } };
    const booking = { ...introBooking, sessionId: westIntro.sessionId, status: "confirmed" };
    expect(deriveSessionStatus({ session: westIntro, program, member: used, booking, bookedCount: 1, now }).status).toBe("booked");
  });
  it("labels the trial reasons", () => {
    expect(lockedReasonLabel("trial_ended", "West", "all")).toBe("Your trial has ended. Choose a membership to keep training.");
    expect(lockedReasonLabel("trial_intro_only", "West", "all")).toBe("During your trial you can book Introduction Classes only.");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `corepack pnpm vitest run --project node packages/domain/src/schedule/member-calendar-contracts.test.ts`.

- [ ] **Step 3: Implement**

```ts
import type { TrialAccessView } from "../memberships/trial-access-contracts";
export type LockedReason = "age_band" | "site" | "open_mat" | "weekly_limit" | "paid_period" | "trial_ended" | "trial_intro_only";
// CalendarMemberContext: add
  trial?: TrialAccessView;

export function ageOnDate(dateOfBirth: string, dateKey: string): number {
  let age = Number(dateKey.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  if (dateKey.slice(5) < dateOfBirth.slice(5)) age -= 1;
  return age;
}
export function participantTypeOn(dateOfBirth: string, dateKey: string): ParticipantType {
  const age = ageOnDate(dateOfBirth, dateKey);
  return age >= 18 ? "adult" : age >= 12 ? "teens" : "kids";
}

function trialLockedReason(session: SessionRecord, program: ProgramRecord, member: CalendarMemberContext, trial: TrialAccessView): LockedReason | undefined {
  if (trial.status !== "active" || Date.parse(session.startAt) >= Date.parse(trial.expiresAt)) return "trial_ended";
  if (trial.attendedCount + trial.futureBookings >= trial.allowance) return "trial_ended";
  if (sessionSite(session) !== trial.site) return "site";
  const dateKey = dateKeyInJersey(new Date(session.startAt));
  const age = typeof member.dateOfBirth === "string" ? ageOnDate(member.dateOfBirth, dateKey) : 16;
  if (sessionAccessMode(session) === "intro") return undefined;
  if (age >= 16) return "trial_intro_only";
  return program.ageBand === participantTypeOn(member.dateOfBirth as string, dateKey) ? undefined : "age_band";
}
```
In `lockedReasonFor`, after the `courseId` line and BEFORE the existing `intro` branch, insert:
```ts
  if (member.trial && !member.hasActiveMembership && member.membershipId === null)
    return trialLockedReason(session, program, member, member.trial);
```
In `deriveSessionStatus`, compute `held` first and skip the lock for held sessions:
```ts
  const attended = input.attendance?.state === "attended" || input.attendance?.state === "late";
  const booked = input.booking !== undefined && (input.booking.status === "confirmed" || input.booking.status === "requested");
  const lockedReason = lockedReasonFor(input.session, input.program, input.member);
  if (lockedReason && !attended && !booked) return Object.freeze({ status: "locked", lockedReason });
  if (input.attendance?.state === "no_show") return Object.freeze({ status: "missed" });
  if (attended) return Object.freeze({ status: "attended" });
  if (booked) return Object.freeze({ status: "booked" });
```
(remove the now-duplicated later `booked` computation). `lockedReasonLabel`: add the two strings from the test. `dateKeyInJersey` already exists in this file (it is exported from it); if it lives elsewhere in the file, reuse it.

- [ ] **Step 4: Run to verify it passes** (whole file; existing tests must stay green).

- [ ] **Step 5: Commit** — `git commit -m "Apply trial access rules in the member calendar"` (both files).

---

### Task 4: Domain — PAYG booking payment input, roster labels, overdue-only PAYG debt [D14][D16]

**Files:**
- Modify: `packages/domain/src/schedule/schedule-contracts.ts`
- Modify: `packages/domain/src/finance/finance-contracts.ts`
- Test: `packages/domain/src/schedule/schedule-contracts.test.ts`, `packages/domain/src/finance/finance-contracts.test.ts` (append)

**Interfaces:**
- Produces:
```ts
export type PaygBookingPayment =
  | Readonly<{ method: "at_venue" }>
  | Readonly<{ method: "bank_transfer"; proofId: string; reference: string }>;
export type RequestMembershipBookingInput = Readonly<{ kind?: "membership"; sessionId: string; studentId: string; membershipId: string; paygPayment?: PaygBookingPayment }>;
// LegacyBookingRecord gains optional `paygPayment?: PaygBookingPayment`
// SessionRegistrationRecord.paymentLabel gains "PAYG Pay at venue" | "PAYG Transfer sent"
export function calculatePaygDebt(invoices, payments, asOf?: string): number // when asOf given, only invoices with dueAt <= asOf count
```

- [ ] **Step 1: Failing tests**

```ts
// schedule-contracts.test.ts
it("accepts a PAYG payment choice on a membership booking", () => {
  const atVenue = parseRequestBookingInput({ kind: "membership", sessionId: "s1", studentId: "st1", membershipId: "m1", paygPayment: { method: "at_venue" } });
  expect(atVenue.ok && atVenue.value.kind === "membership" && atVenue.value.paygPayment?.method).toBe("at_venue");
  const transfer = parseRequestBookingInput({ sessionId: "s1", studentId: "st1", membershipId: "m1", paygPayment: { method: "bank_transfer", proofId: "a".repeat(64), reference: "BPT-123" } });
  expect(transfer.ok).toBe(true);
  expect(parseRequestBookingInput({ sessionId: "s1", studentId: "st1", membershipId: "m1", paygPayment: { method: "bank_transfer" } }).ok).toBe(false);
  expect(parseRequestBookingInput({ kind: "intro", sessionId: "s1", studentId: "st1", paygPayment: { method: "at_venue" } }).ok).toBe(false);
});
// finance-contracts.test.ts
it("counts only PAYG invoices already due when asOf is given", () => {
  const due = { ...paygInvoice, invoiceId: "i1", dueAt: "2026-09-20T18:00:00.000Z" };
  const future = { ...paygInvoice, invoiceId: "i2", dueAt: "2026-09-25T18:00:00.000Z" };
  expect(calculatePaygDebt([due, future], [], "2026-09-22T10:00:00.000Z")).toBe(due.totalMinor);
  expect(calculatePaygDebt([due, future], [])).toBe(due.totalMinor + future.totalMinor);
});
```
(`paygInvoice` = a valid `InvoiceRecord` with `chargeKind: "payg_session"`, `status: "open"` — copy the shape from an existing invoice fixture in that test file.)

- [ ] **Step 2: Run both files to verify they fail.**

- [ ] **Step 3: Implement**

`parseRequestBookingInput`: read `paygPayment` from input; for `kind === "intro"` return `err("Intro bookings cannot include a payment")` when present; for membership:
```ts
  let paygPayment: PaygBookingPayment | undefined;
  if (paygPaymentInput !== undefined) {
    if (!isRecord(paygPaymentInput)) return err("paygPayment must be an object");
    if (paygPaymentInput.method === "at_venue") paygPayment = Object.freeze({ method: "at_venue" as const });
    else if (paygPaymentInput.method === "bank_transfer") {
      const { proofId, reference } = paygPaymentInput;
      if (typeof proofId !== "string" || !/^[a-f0-9]{64}$/u.test(proofId)) return err("proofId is required for a bank transfer");
      if (typeof reference !== "string" || reference.trim().length < 2 || reference.length > 120) return err("reference is required for a bank transfer");
      paygPayment = Object.freeze({ method: "bank_transfer" as const, proofId, reference: reference.trim() });
    } else return err("paygPayment.method must be at_venue or bank_transfer");
  }
```
and include `...(paygPayment ? { paygPayment } : {})` in the returned membership input. `calculatePaygDebt`: add `asOf?: string` and filter `asOf === undefined || Date.parse(invoice.dueAt) <= Date.parse(asOf)`.

- [ ] **Step 4: Run both files → PASS.**

- [ ] **Step 5: Commit** — `git commit -m "Carry a PAYG payment choice on bookings and count only overdue PAYG debt"`.

---

### Task 5: Functions — approval creates level + trial; requests persist declarations [D3][D8]

**Files:**
- Modify: `apps/functions/src/members/enrolment-registration.ts`
- Modify: `apps/functions/src/members/enrolment-request-service.ts` (line ~475: add `...(input.submission.levelDeclarations ? { levelDeclarations: input.submission.levelDeclarations } : {})` to the candidate)
- Modify: `firestore.rules` (add `match /academies/{academyId}/trialAccess/{studentId} { allow read, write: if false; }` next to `enrolmentRequests`)
- Test: `apps/functions/src/members/enrolment-registration.test.ts` (append; reuse `harness()`, `baseRecord`, `actor`, `api` mocks)

**Interfaces:**
- Consumes: `trialAccessSchema`, `trialExpiresAt` (Task 2); `enrolmentTrialAllowance`, `trialPlanChoice` (Task 1).
- Produces: on approval of a `"trial"` student, a doc at `academies/{a}/trialAccess/{studentId}` with `trialId = studentId`, `experience` and `allowance` from the request's `levelDeclarations` (default `beginner`/2 when absent), `site = student.trainingCenter`, `startsAt = approvalStartedAt`, `expiresAt = trialExpiresAt(startsAt)`, `status: "active"`, `countedAttendanceIds: []`, `enrolmentRequestId`. No subscription, no `membershipChanges` receipt.

- [ ] **Step 1: Failing tests**

```ts
it("approves a trial student with a level and a trial record, and no subscription", async () => {
  const { db, documents } = harness();
  api.listPublished.mockResolvedValue({ definitions: [{ definitionKey: "white-belt" }] });
  const record = { ...baseRecord, payment: undefined, planSelections: { applicant: "trial", minors: [] },
    levelDeclarations: { applicant: { experience: "beginner", declaredLevelKey: null }, minors: [] },
    applicant: { ...baseRecord.applicant, trainingCenter: "West" },
    approvalSetup: { students: [{ planId: "trial", definitionKey: "white-belt", startsOn: "2026-09-20", endsOn: null }], detailsVerified: true, paymentVerified: true } } as unknown as EnrolmentRequestRecord;
  const registration = createEnrolmentRegistration(db as unknown as Firestore);
  await registration.validate(record);
  await registration.complete(record, ["student-1"], actor);
  expect(api.openStudentLevel).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ definitionKey: "white-belt" }) }));
  expect(api.saveManualSubscription).not.toHaveBeenCalled();
  const trial = documents.get("academies/academy-1/trialAccess/student-1");
  expect(trial).toMatchObject({ status: "active", allowance: 2, site: "West", experience: "beginner", countedAttendanceIds: [] });
  expect(trial?.expiresAt).toBe("2026-10-20T12:00:00.000Z");
});
it("gives an experienced trial student one class", async () => { /* same, experience "experienced", declaredLevelKey "blue-belt" → allowance 1 */ });
it("is idempotent when the trial record already exists for this enrolment", async () => { /* pre-seed the trial doc with the same enrolmentRequestId; complete again; no throw, still one doc */ });
it("refuses a trial record that belongs to another enrolment", async () => { /* pre-seed with enrolmentRequestId "other"; expect complete to reject with EnrolmentApprovalError */ });
```
Look at `harness()` in the existing test to see how `documents` is exposed and how `db.doc(...).get/set` are faked; extend the fake if `set` on a nested collection path is missing.

- [ ] **Step 2: Run** `corepack pnpm vitest run --project node apps/functions/src/members/enrolment-registration.test.ts` → FAIL.

- [ ] **Step 3: Implement** in `enrolment-registration.ts`:

`validate`: replace `const plan = PLAN_CATALOG.find(...); if (!plan) fail(...)` with
```ts
        const trial = selection.planId === trialPlanChoice;
        const plan = trial ? undefined : PLAN_CATALOG.find((item) => item.planId === selection.planId);
        if (!trial && !plan) fail("Choose a catalogue plan.");
        ...
        if (!trial && plan!.billingPeriod !== "per-session" && !selection.endsOn) fail("Enter the end date of the paid subscription period.");
        if (trial && selection.endsOn) fail("A trial has no paid period.");
```
`complete`: after the level block, before `registrationKey`:
```ts
        if (selection.planId === trialPlanChoice) {
          const declaration = record.applicantIsStudent ? record.levelDeclarations?.applicant : record.levelDeclarations?.minors[index];
          const experience = declaration?.experience ?? "beginner";
          const student = record.applicantIsStudent ? record.applicant : record.minors[index]!;
          const trialRef = base.collection("trialAccess").doc(studentId);
          const existing = await trialRef.get();
          if (existing.exists) {
            if (existing.get("enrolmentRequestId") !== record.enrolmentRequestId) fail("The student already has a trial from another enrolment.");
            continue;
          }
          const startsAt = record.approvalStartedAt!;
          await trialRef.set(trialAccessSchema.parse({
            trialId: studentId, academyId: record.academyId, studentId, site: student.trainingCenter,
            experience, allowance: enrolmentTrialAllowance(experience), countedAttendanceIds: [], status: "active",
            startsAt, expiresAt: trialExpiresAt(startsAt), enrolmentRequestId: record.enrolmentRequestId,
            createdAt: startsAt, updatedAt: startsAt, schemaVersion: "1",
          }));
          continue;
        }
```
Imports: `trialPlanChoice, enrolmentTrialAllowance` from `@bpt-jersey/domain/members/enrolment-requests`; `trialAccessSchema, trialExpiresAt` from `@bpt-jersey/domain/memberships/trial-access`.

- [ ] **Step 4: Run → PASS.** Also run `apps/functions/src/members/enrolment-request-service.test.ts` to confirm the candidate change broke nothing.

- [ ] **Step 5: Commit** — `git commit -m "Create a trial on approval of a trial enrolment"` (registration, request-service, rules, test).

---

### Task 6: Functions — shared trial reader (`trial-access-service.ts`)

**Files:**
- Create: `apps/functions/src/memberships/trial-access-service.ts`
- Create: `apps/functions/src/memberships/trial-access-service.test.ts`

**Interfaces:**
- Produces:
```ts
export type TrialReader = { get(path: string): Promise<{ exists: boolean; data(): unknown }> };
export async function readTrialAccess(reader: TrialReader, academyId: string, studentId: string): Promise<TrialAccessRecord | undefined>;
// validates with trialAccessSchema; returns undefined when missing or scoped to another academy/student
export function trialView(trial: TrialAccessRecord, futureBookings: number, nowIso: string): TrialAccessView;
// { site, allowance, attendedCount: trialAttendedCount(trial), futureBookings, expiresAt, status: trialStatusAt(trial, nowIso) }
export function futureIntroBookingCount(bookings: readonly BookingRecord[], sessions: ReadonlyMap<string, { startAt: string }>, attendedSessionIds: ReadonlySet<string>, nowIso: string): number;
// confirmed intro bookings (isIntroBooking) whose session startAt > now and not attended
```
`reader` is satisfied by `{ get: (path) => tx.get(db.doc(path)) }` or `{ get: (path) => db.doc(path).get() }`.

- [ ] **Step 1: Failing tests** covering: missing doc → undefined; wrong academy → undefined; valid → record; `futureIntroBookingCount` ignores cancelled, attended and past sessions.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** per the interface.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Add a shared trial access reader"`.

---

### Task 7: Functions — trial-based intro booking eligibility [D2][D6][D7]

**Files:**
- Modify: `apps/functions/src/schedule/intro-booking-service.ts`
- Test: `apps/functions/src/schedule/intro-booking-service.test.ts` (append; reuse `createFirestore()`, seed helpers)

**Interfaces:**
- Consumes: `readTrialAccess`, `futureIntroBookingCount` (Task 6), `ageOnDate` (Task 3), `dateKeyInJersey`.
- Produces: `requestIntroBooking` rules:
  1. `trialAccess/{studentId}` must exist with `trialStatusAt(trial, now) === "active"` → else `fail("ineligible", "Your trial is not active")`.
  2. Session site must equal `trial.site` (replaces the `student.trainingCenter` check).
  3. `storedSession` no longer requires `accessMode === "intro"`; instead: if `sessionAccessMode(session) !== "intro"`, the student must be under 16 on the session date **and** the session's program `ageBand` must equal `participantTypeOn(dateOfBirth, sessionDate)` (read `programs/{programId}` in the transaction; `fail("ineligible", "During your trial you can book Introduction Classes only")` for 16+; `fail("ineligible", "This class is for another age group")` for a band mismatch).
  4. Allowance: `trialAttendedCount(trial) + futureIntroBookingCount(...) < trial.allowance` else `fail("ineligible", "Your free classes are used up")`. The existing `introBookings()` + `otherSessions` reads supply the future count (count instead of `some`). Remove `assertNoIntroAttendance` entirely.
  5. Keep `assertNoMembershipHistory`, waiver, cutoff, capacity, replay and audit exactly as they are.

- [ ] **Step 1: Failing tests** (seed `academies/academy-1/trialAccess/student-1` in the fake; the existing tests that seed no trial must be updated to seed an active beginner trial so they keep passing — do that first and confirm the file is green before adding new cases):

```ts
it("refuses a booking without an active trial", ...);            // no trial doc → "Your trial is not active"
it("lets a beginner hold two future intro bookings and no more", ...); // third → "Your free classes are used up"
it("counts attended classes against the allowance", ...);         // trial.countedAttendanceIds ["att-1"], one future booking → refused
it("refuses an ordinary class for a 16+ trial member", ...);      // session without accessMode → "Introduction Classes only"
it("lets an under-16 trial member book a kids class at their site", ...); // dateOfBirth 2018-01-01, program ageBand kids → confirmed, source.kind intro
it("refuses an under-16 trial member outside their age band", ...);
it("refuses a session at the other site", ...);
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** as described (the student's `dateOfBirth` comes from the `students/{id}` doc already read; if it is missing, treat the student as 16+).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Book intro classes against the trial allowance and age rule"`.

---

### Task 8: Functions — attendance trigger counts the trial, new notice copy, West auto-PAYG [D9][D12]

**Files:**
- Modify: `apps/functions/src/memberships/intro-conversion-service.ts`
- Test: `apps/functions/src/memberships/intro-conversion-service.test.ts` (append; reuse `fakeFirestore`)

**Interfaces:**
- Consumes: `readTrialAccess`, `trialStatusAt`, `trialAttendedCount`; `parseMembershipRecord` from `@bpt-jersey/domain/memberships/lifecycle`.
- Produces, inside the existing transaction of `projectIntroAttendance`:
  1. The session filter `sessionAccessMode(session) !== "intro"` is removed; the booking must still be a confirmed intro booking (`isIntroBooking`). This is what makes under-16 age-band classes count.
  2. Read `trialAccess/{studentId}`. If present and `!countedAttendanceIds.includes(attendanceId)`: append the id, `updatedAt = now`; if the new count `>= allowance` set `status: "exhausted"`. (Idempotent on retry.)
  3. Conversion state + notice are created on the FIRST counted attendance as today (existing `if (existing.exists) return "existing"` keeps the notice single); notice copy becomes title `Did you enjoy training with us?` and body `Tap here to get a membership and keep training with us.`. When the conversion already exists, still perform step 2 and return `"existing"`.
  4. West auto-PAYG: when the count reaches the allowance, `trial.site === "West"` and age on `now` is `>= 12`: create `memberships/payg-trial-{studentId}` (create-once; if it exists, skip) with `planId = age >= 18 ? "payg" : "west-teens-payg"`, `status: "active"`, `startsAt: now`, `endsAt: null`, `nextBillingAt: null`, `familyId` from the student doc, `createdBy/updatedBy: "system"`, `schemaVersion: "1"`; validate with `parseMembershipRecord` before writing; set the trial `status: "converted"`; create a second notice `memberNotifications/payg-{sha256(conversionId:recipientUid)}` with kind `intro_membership_ready`, title `You're now on Pay as you go`, body `Book classes at West and pay online or at the academy.`, `href: "/account/membership"`. Reuse the recipient resolution already in the function (adult → own uid, minor → single guardian). Also append an audit event `membership.created`? — only if `appendAuditEventInTransaction` is already imported here; otherwise skip audit (ponytail: the deterministic id is the trail).
  5. Town, or West under 12, at exhaustion: trial `status: "exhausted"` only.

- [ ] **Step 1: Failing tests**

```ts
it("counts a first attendance and sends the enjoy-training notice", ...);   // trial allowance 2 → countedAttendanceIds [att-1], status active, notice title/body as above
it("counts a second attendance without a second notice", ...);           // returns "existing", countedAttendanceIds length 2, status "exhausted" (Town)
it("converts a West adult to PAYG when the allowance is used", ...);       // membership payg-trial-student-1 planId "payg", trial status "converted", second notice created
it("converts a West teen to the teens PAYG plan", ...);                    // dateOfBirth 2012-01-01 → "west-teens-payg"
it("does not convert a West kid under 12", ...);                          // status "exhausted", no membership
it("counts an under-16 age-band class booked as intro", ...);              // session without accessMode, booking schema 3 → counted
it("ignores a retried attendance already counted", ...);
```

- [ ] **Step 2: Run → FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Count trial attendance, nudge after the first class and convert West trials to PAYG"`.

---

### Task 9: Functions — trial context in the member calendar + `getTrialAccess` callable

**Files:**
- Modify: `apps/functions/src/schedule/member-calendar-week-callables.ts`
- Modify: `apps/functions/src/index.ts` — **dirty in another session's tree; if still dirty when you reach Step 5, stop and report instead of committing.** Add `getTrialAccess` to the export list that already names `getMemberCalendarWeek`.
- Test: none new (logic lives in Tasks 3 and 6); verify by `corepack pnpm --filter @bpt-jersey/functions typecheck` in Task 17.

**Interfaces:**
- Produces:
  - `getMemberCalendarWeek` response gains `trial?: TrialAccessView` and the member context passes `trial` to `canViewMemberSession`. Visibility line becomes: `if (!member.hasActiveMembership && !member.trial && sessionAccessMode(session) !== "intro") return false;`.
  - Context: inside the existing read-only transaction also `tx.get(db.doc(`${base}/trialAccess/${studentId}`))`; `trial = membership ? undefined : readTrialAccess(...)`; `futureBookings` via `futureIntroBookingCount(bookings, sessionsById, attended, now)` where `sessionsById` = the week's sessions plus `db.getAll(...)` of at most 10 session docs referenced by confirmed intro bookings not in the week.
  - Drop `hasAttendedIntro` from the context when `trial` is present (keep computing it for legacy members without a trial doc).
  - New callable in the same file:
```ts
export const getTrialAccess = onCall({ ...browserAdminCallableOptions, region: memberRegion }, async (request) => {
  const actor = requireUserActor(request);
  const ids = studentGroupAccessQuerySchema.safeParse({ studentId: (request.data as { studentId?: unknown } | null)?.studentId });
  if (!ids.success) throw new HttpsError("invalid-argument", "Select a member.");
  const options = getStudentScopeOptions();
  await requireStudentScope(request, ids.data.studentId, options);
  const db = getFirestore();
  const base = `academies/${actor.academyId}`;
  const studentId = await db.runTransaction((tx) => resolveCanonicalStudentIdInTransaction(createMemberDirectoryReadTransaction(db, tx), actor.academyId, ids.data.studentId), { readOnly: true });
  const trial = await readTrialAccess({ get: (path) => db.doc(path).get() }, actor.academyId, studentId);
  if (!trial) return { trial: null };
  const [bookings, attendance] = await Promise.all([options.store.listStudentBookings(actor.academyId, studentId), options.store.listStudentAttendance(actor.academyId, studentId)]);
  const attended = new Set(attendance.filter((r) => r.state === "attended" || r.state === "late").map((r) => r.sessionId));
  const pending = bookings.filter((b) => isIntroBooking(b) && b.status === "confirmed" && !attended.has(b.sessionId)).slice(0, 10);
  const sessionDocs = pending.length ? await db.getAll(...pending.map((b) => db.doc(`${base}/sessions/${b.sessionId}`))) : [];
  const sessions = new Map(sessionDocs.filter((d) => d.exists).map((d) => [d.id, { startAt: String(d.get("startAt")) }]));
  const now = new Date().toISOString();
  return { trial: trialView(trial, futureIntroBookingCount(pending, sessions, attended, now), now) };
});
```

- [ ] **Step 1: Implement** the two changes above.
- [ ] **Step 2: Typecheck functions only**: `corepack pnpm --filter @bpt-jersey/functions typecheck` → no errors in the touched files.
- [ ] **Step 3: Commit** (only if `apps/functions/src/index.ts` is not dirty from another session) — `git commit -m "Expose trial access to the member calendar"`.

---

### Task 10: Functions — PAYG membership applications after the trial [D10][D11]

**Files:**
- Modify: `packages/domain/src/memberships/intro-conversion-contracts.ts`
- Modify: `apps/functions/src/memberships/intro-application-service.ts`
- Modify: `apps/functions/src/memberships/intro-application-admin-service.ts`
- Test: `packages/domain/src/memberships/intro-conversion-contracts.test.ts`, `apps/functions/src/memberships/intro-application-admin-service.test.ts` (append)

**Interfaces:**
- Produces:
  - `membershipApplicationSubmitSchema`: `proofId: proofIdSchema.nullable()`, `bankReference: z.string().trim().min(2).max(120).nullable()`.
  - `membershipApplicationSchema`: `billingPeriod: z.enum(["per-session", "monthly", "term"])`, `proofId` nullable, `bankReference` nullable.
  - `getIntroMembershipContext`: plans filter drops `value.billingPeriod !== "per-session"` (PAYG plans are West-only by catalogue; the form filters by site).
  - `submitIntroMembershipApplication`: if the stored plan is `per-session` → require `proofId === null && bankReference === null`, skip `assertIntroProof`, do not require payment instructions; else require both non-null (current behaviour). Remove the `plan.value.billingPeriod === "per-session"` rejection.
  - `reviewIntroApplication` approve: for `per-session` use `settlement: { kind: "pay-as-you-go" }`, `endsAt: null`; for others unchanged. In both cases, if `trialAccess/{studentId}` exists, `tx.update` it to `status: "converted", updatedAt: now`.

- [ ] **Step 1: Failing tests** — domain: a per-session application record with null proof parses; a monthly one with null proof still parses at schema level (service enforces). admin-service: approving a per-session application calls `saveManualSubscriptionInTransaction` with `settlement.kind === "pay-as-you-go"` and marks a seeded trial `converted`.
- [ ] **Step 2: Run → FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Allow West pay-as-you-go membership applications without a transfer"`.

---

### Task 11: Functions — PAYG booking payment choice, invoice at booking, staff confirmation, proofs [D14][D15][D16]

**Files:**
- Modify: `apps/functions/src/schedule/payg-class-payment.ts` (extract `ensurePaygClassInvoice`; add `confirmPaygClassPayment`, `uploadPaygClassProof`, `getPaygClassProofUrl`)
- Create: `apps/functions/src/schedule/payg-booking-payment.ts`
- Create: `apps/functions/src/schedule/payg-booking-payment.test.ts`
- Modify: `apps/functions/src/schedule/session-registrations.ts` (labels)
- Modify: `apps/functions/src/finance/finance-service.ts` line ~594: `paygDebtMinor: calculatePaygDebt(scopedInvoices, scopedPayments, now())` (use the store's `now` if in scope; otherwise `new Date().toISOString()`).
- Modify: `apps/functions/src/schedule/schedule-callables.ts` (`createRequestBookingHandler`, `createCancelBookingHandler`) and `apps/functions/src/index.ts` — **both dirty in another session's tree; if still dirty at commit time, stop and report.**

**Interfaces:**
- Produces:
```ts
// payg-class-payment.ts
export async function ensurePaygClassInvoice(db: Firestore, input: { academyId: string; actorId: string; sessionId: string; studentId: string; membershipId: string }): Promise<InvoiceRecord>;
// = the body of preparePaygClassPayment from "const membership = ..." to "return invoice" with the booking already validated by the caller; preparePaygClassPayment now calls it.
export function paygProofKey(academyId: string, userId: string, bookingId: string, proofId: string): string; // `academies/${a}/payg-proofs/${sha256(userId)}/${bookingId}/${proofId}`
export const uploadPaygClassProof: callable   // member (requireMemberAccountActor); input { sessionId, studentId, contentType, base64 }; requireStudentScope; validateIntroProof (from ../memberships/intro-payment-proof.js); putObject at paygProofKey(..., buildBookingId(sessionId, studentId), proofId); returns { proofId }
export const confirmPaygClassPayment: callable // staffRoles (owner/administrator/headCoach/coach) via requireUserActor + role check; input { sessionId, studentId }; loads the confirmed schema-1 booking; ensurePaygClassInvoice; if balance 0 → { status: "paid" }; else store.recordManualPayment({ invoiceId, amountMinor: balance, method: booking.paygPayment?.method === "bank_transfer" ? "bank_transfer" : "cash", manualReference: `payg-${groupKey(sessionId, membershipId)}-${method}`, occurredAt: now, actorId }) → { status: "paid" }
export const getPaygClassProofUrl: callable    // requireActiveOfficeActor; input { sessionId, studentId }; reads booking.paygPayment (must be bank_transfer); signed URL 60 s via storage.createPrivateImageUrl (same as getIntroProofUrl) → { url, expiresAt }

// payg-booking-payment.ts
export async function attachPaygBookingPayment(db: Firestore, storage: R2Client | null, input: { academyId: string; actorId: string; booking: BookingRecord; paygPayment: PaygBookingPayment }): Promise<void>;
// booking must be schema "1" with membershipId; plan must be per-session (else HttpsError failed-precondition "This plan does not pay per class");
// bank_transfer → storage.readObject(paygProofKey(academyId, actorId, booking.bookingId, proofId)) must hash to proofId (throw failed-precondition "Payment evidence is unavailable." otherwise);
// ensurePaygClassInvoice(...); db.doc(`academies/${a}/bookings/${booking.bookingId}`).update({ paygPayment, updatedAt: now })
export async function voidUnpaidPaygInvoice(db: Firestore, input: { academyId: string; actorId: string; sessionId: string; membershipId: string }): Promise<void>;
// finds invoices where sourceRef == `academies/${a}/sessions/${sessionId}` && membershipId && chargeKind payg_session && status "open"; if none have payments → store.voidManualInvoice; partially_paid/paid untouched
```
- `createRequestBookingHandler`: after the membership branch resolves `booking`, `if (parsed.value.kind !== "intro" && parsed.value.paygPayment) await attachPaygBookingPayment(getFirestore(), createPrivateStorageR2Client(), { academyId: actor.academyId, actorId: actor.userId, booking, paygPayment: parsed.value.paygPayment });` — `requestBooking`/`requestBookingEu` need `secrets: enrolmentStorageSecrets` added to their options when they call the R2 client (only construct the client when `paygPayment.method === "bank_transfer"`; pass `null` otherwise so at-venue bookings need no secret).
- `createCancelBookingHandler`: after cancel, `if (booking.schemaVersion === "1" && booking.membershipId) await voidUnpaidPaygInvoice(getFirestore(), { academyId: actor.academyId, actorId: actor.userId, sessionId: parsed.value.sessionId, membershipId: booking.membershipId }).catch(() => undefined);` (never fail a cancellation over an invoice).
- `session-registrations.ts`: in the `if (!invoices.length)` / unsettled branches, return `booking.paygPayment?.method === "at_venue" ? "PAYG Pay at venue" : booking.paygPayment?.method === "bank_transfer" ? "PAYG Transfer sent" : "PAYG Needs to pay"`.

- [ ] **Step 1: Failing tests** (`payg-booking-payment.test.ts`, with a fake Firestore like `intro-conversion-service.test.ts` and a stub R2 client `{ readObject, putObject }`):
```ts
it("records an at-venue choice and issues the class invoice", ...);
it("refuses a payment choice on a monthly plan", ...);
it("rejects a transfer whose proof is missing or mismatched", ...);
it("voids an open unpaid class invoice on cancellation and keeps a paid one", ...);
```
For `ensurePaygClassInvoice`, add one test in `payg-class-payment.test.ts` if it exists; otherwise cover via the booking-payment tests (mock `createFinanceStore` like the existing tests mock stores).
- [ ] **Step 2: Run → FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run → PASS**, plus `apps/functions/src/schedule/session-registrations.test.ts` if it exists.
- [ ] **Step 5: Commit** — `git commit -m "Let PAYG members choose how to pay at booking and let staff confirm it"`. If `schedule-callables.ts`/`index.ts` are dirty from the other session, commit everything else and report the two files as pending.

---

### Task 12: Functions — Transit Free is owner-only [D13]

**Files:**
- Modify: `apps/functions/src/memberships/manual-subscription-service.ts` (after `const transitFree = ...`: `if (transitFree && actor.role !== "owner") throw new HttpsError("permission-denied", "Only an owner can assign Transit Free.");`)
- Test: `apps/functions/src/memberships/manual-subscription-service.test.ts` (append: administrator assigning `transit-free` → permission-denied; owner → existing happy path still passes)

- [ ] Steps 1–4 as usual. — [ ] **Step 5: Commit** — `git commit -m "Restrict Transit Free to owners"`.

---

### Task 13: Web — public enrolment: Beginner card, "I'm not a Beginner", belt and stripes [D1][D2][D3]

**Files:**
- Modify: `apps/web/src/app/enrol/plan-choices.tsx`
- Modify: `apps/web/src/app/enrol/page.tsx`
- Create: `apps/web/src/app/enrol/level-declaration.tsx`
- Test: `apps/web/src/app/enrol/level-declaration.test.tsx` (new), `apps/web/src/app/enrol/page.test.tsx` (append one submission test)

**Interfaces:**
- Consumes: `getLevelCatalog()` from `apps/web/src/lib/levels-client.ts` (bundled catalogue works without the backend), `ageOnDate` (Task 3), `EnrolmentPlanChoice`, `EnrolmentLevelDeclaration` (Task 1).
- Produces:
```tsx
// level-declaration.tsx
export function beltsForAge(definitions: readonly LevelDefinitionRecord[], age: number): readonly LevelDefinitionRecord[];
// kind === "belt" && (criteria.minAge ?? 0) <= age && age <= (criteria.maxAge ?? 200), sorted by sequence
export function stripesForBelt(definitions: readonly LevelDefinitionRecord[], beltKey: string): readonly { definitionKey: string; stripes: number }[];
// kind === "stripe" && parentDefinitionKey === beltKey; stripes parsed from /(\d+)(?:st|nd|rd|th) Stripe$/u on name; sorted ascending
export function LevelDeclaration(props: { id: string; age: number; definitions: readonly LevelDefinitionRecord[]; value: EnrolmentLevelDeclaration; disabled: boolean; onChange(next: EnrolmentLevelDeclaration): void }): JSX.Element;
// Renders: when value.experience === "beginner": <button type="button">I'm not a Beginner</button>.
// When "experienced": <label>Belt<select>…beltsForAge…</select></label><label>Stripes<select><option value="0">No stripes</option>…stripesForBelt…</select></label><button type="button">I am a beginner</button>.
// declaredLevelKey = stripe definitionKey when stripes > 0, else the belt definitionKey.
```
- `EnrolmentPlanChoices` gains props `declaration: EnrolmentLevelDeclaration`, `onDeclarationChange`, `age: number`, `definitions`. It renders FIRST a radio option `value="trial"` labelled `I am a beginner` / `Trial: 2 free Introduction Classes` (or `Trial: 1 free Introduction Class` when experienced), selected by default (`selectedPlan === ""` is treated as `"trial"` by the page: initialise `selectedPlan: "trial"` in `emptyForm` and in the minor reset paths at lines 330/341/693/745), then `<LevelDeclaration …/>` inside that option, then the catalogue plans as today. `recommended` badge logic unchanged.
- `page.tsx`: `ApplicantForm.selectedPlan` and `MinorForm.selectedPlan` become `EnrolmentPlanChoice | ""`; add `declaration: EnrolmentLevelDeclaration` to both (default `{ experience: "beginner", declaredLevelKey: null }`); load the catalogue once with `getLevelCatalog()` in an effect (state `definitions`, `[]` on failure; when empty, `LevelDeclaration` shows `Belt selection is unavailable right now — the office will confirm your level.` and keeps `experience: "experienced", declaredLevelKey: null` invalid → the page validation message tells the user to pick Beginner). Build `levelDeclarations` next to `selections` and include it in the `parseEnrolmentRequestSubmission` input. Payment step copy when total is 0 and any selection is `"trial"`: `No payment is required for a trial. Send your request and the academy will confirm your first free classes.`

- [ ] **Step 1: Failing tests**
```tsx
// level-declaration.test.tsx
it("offers only belts for the student's age", () => { expect(beltsForAge(defs, 30).map((b) => b.definitionKey)).toEqual(["white-belt", "blue-belt", "purple-belt", "brown-belt", "black-belt"]); expect(beltsForAge(defs, 9).every((b) => b.criteria.maxAge !== null)).toBe(true); });
it("lists stripes of the chosen belt in order", () => { expect(stripesForBelt(defs, "blue-belt").map((s) => s.stripes)).toEqual([1, 2, 3, 4]); });
it("declares the stripe key when stripes are chosen", async () => { /* render experienced, choose blue-belt + 2 → onChange({ experience: "experienced", declaredLevelKey: "blue-2nd-stripe" }) */ });
it("returns to beginner", async () => { /* click "I am a beginner" → onChange({ experience: "beginner", declaredLevelKey: null }) */ });
```
`defs` = `getLevelCatalog()` bundled result (import from `../../lib/levels-client` inside the test; it is synchronous when `NEXT_PUBLIC_LEVELS_BACKEND` is unset) — or a hand-made subset with `criteria.minAge/maxAge` matching the values in the catalogue (`white-belt` minAge 16, kids belts maxAge ≤ 15).
```tsx
// page.test.tsx (append)
it("submits a beginner trial without payment", async () => { /* fill details, continue, keep the default beginner card, continue, send → submitEnrolmentRequest called with planSelections.applicant "trial" and levelDeclarations.applicant { experience: "beginner", declaredLevelKey: null } */ });
```
- [ ] **Step 2: Run** `corepack pnpm vitest run --project web apps/web/src/app/enrol/level-declaration.test.tsx apps/web/src/app/enrol/page.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** Reuse the `enrol-plan-option` / `enrol-field` classes; native `<select>`; buttons ≥ 44 px (existing `.button` class).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Offer a beginner trial and belt declaration at enrolment"`.

---

### Task 14: Web — office review: declarations, preselected level, trial setup, Membership requests section [D3][D8][D11]

**Files:**
- Modify: `apps/web/src/app/admin/members/requests/page.tsx`
- Modify: `apps/web/src/app/admin/billing/page.tsx` (remove the `<IntroApplicationsPanel />` line and its import)
- Modify: `apps/web/src/app/admin/billing/intro-applications-panel.tsx` (eyebrow `After the trial`, heading `Membership requests`; show `item.billingPeriod === "per-session" ? "Pay as you go — no transfer" : item.bankReference`; hide "View evidence" for per-session; approve confirm text for per-session: `Approve ${item.planName} (pay per class)?`)
- Test: `apps/web/src/app/admin/members/requests/page.test.tsx` (append)

**Interfaces:**
- Produces in `requests/page.tsx`:
  - `PlanPreference` renders `Trial (2 free Introduction Classes)` / `Trial (1 free Introduction Class)` when `planId === "trial"` (needs the declaration: pass `declaration` prop).
  - Under each student: `Level: Beginner` or `Level: Blue belt · 2 stripes (declared)` from `detail.levelDeclarations` + catalogue names.
  - Setup initialisation (line ~301): `definitionKey: declaration?.declaredLevelKey ?? defaultWhiteBelt(catalog, age)`, where `defaultWhiteBelt` = belts whose name starts with `WHITE BELT`, age within `[minAge ?? 0, maxAge ?? 200]`, highest `sequence`; `age` from the student's `dateOfBirth` via `ageOnDate(dob, today)`. `endsOn: null` for trial.
  - Setup form: for `planId === "trial"` show `<p>Trial — no plan, dates or payment. Confirm the initial level.</p>` instead of the start/end date fields (keep `startsOn: today` in state).
  - `approve` validation unchanged (`enrolmentNeedsPayment("trial")` is false).
  - At the bottom of the office content (`office` true), render `<IntroApplicationsPanel />` under a `<section className="admin-panel-card" aria-labelledby="membership-requests-title">` heading `Membership requests`.
- Export `defaultWhiteBelt(definitions, age)` from `apps/web/src/app/enrol/level-declaration.tsx` (Task 13 file) and import it here.

- [ ] **Step 1: Failing tests** — `page.test.tsx`: opening a trial request preselects the declared level; a beginner adult preselects `white-belt`; a 9-year-old beginner preselects `white-belt-kids-7-8-and-8-10-yo`; approve sends `planId: "trial", endsOn: null`; the Membership requests section renders for an administrator.
- [ ] **Step 2: Run → FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run → PASS** (also `apps/web/src/app/admin/billing/page.test.tsx` if it references the panel).
- [ ] **Step 5: Commit** — `git commit -m "Review trial enrolments with a preselected level and list membership requests"`.

---

### Task 15: Web — member calendar and membership: trial band, trial bookings, PAYG payment dialog, notice copy [D5][D6][D9][D10][D14]

**Files:**
- Modify: `apps/web/src/lib/calendar/calendar-repository.ts` (`CalendarParticipant.trial?: TrialAccessView`)
- Modify: `apps/web/src/lib/calendar/firebase-calendar-repository.ts` (for subjects without a current membership call `getTrialAccess(studentId)`; set `trial` when returned; drop the intro-attendance scan for those subjects when a trial exists)
- Modify: `apps/web/src/lib/schedule-client.ts` (`getTrialAccess`, `uploadPaygClassProof`, `MemberCalendarWeek.trial?`)
- Modify: `apps/web/src/app/account/calendar/member-calendar.tsx` (context `trial`; `handleBook`: allow when `participant.trial && !participant.membershipId` → `kind: "intro"`; when the participant's plan is per-session (`PLAN_CATALOG.find(p => p.planId === participant.planId)?.billingPeriod === "per-session"`) open the payment dialog before booking; trial band above the week)
- Create: `apps/web/src/app/account/calendar/payg-payment-dialog.tsx` + test
- Modify: `apps/web/src/app/account/calendar/session-card.tsx` (`Book free intro` also when the member has a trial and the session is not intro-mode: label `Book free trial class`)
- Modify: `apps/web/src/app/account/intro-notices.tsx` (link text `Get a membership`)
- Modify: `apps/web/src/lib/intro-conversion-client.ts` (`billingPeriod` enum add `"per-session"`; submit `proofId: string | null`, `bankReference: string | null`)
- Modify: `apps/web/src/app/account/membership/intro-application-form.tsx` (per-session plan selected → hide reference/file, copy `£X per class. Pay when you book — online by bank transfer or at the academy.`; submit with nulls)
- Modify: `apps/web/src/app/account/membership/page.tsx` (when no current membership, call `getTrialAccess(selectedStudentId)`; render in "Membership status": `Trial · {left} of {allowance} classes left · ends {date}` or `Your trial has ended. Choose a membership to keep training.`; the intro form shows when `from=intro` OR a conversion is ready)
- Tests: `apps/web/src/app/account/calendar/payg-payment-dialog.test.tsx` (new), `apps/web/src/app/account/membership/intro-application-form.test.tsx` (append PAYG case), `apps/web/src/app/account/calendar/member-calendar.test.tsx` if it exists (append trial band case)

**Interfaces:**
```tsx
// payg-payment-dialog.tsx
export function PaygPaymentDialog(props: { session: SessionRecord; studentId: string; priceMinor: number; onClose(): void; onChoose(payment: PaygBookingPayment): void }): JSX.Element;
// <dialog> with two radios: "Pay online now (bank transfer)" and "Pay at the academy". Bank transfer shows <EnrolmentBankDetails/> via useEnrolmentBankDetails() (from ../../enrol/payment-instructions), amount formatted £, reference input (default `BPT-${session.startAt.slice(0,10)}`), file input; Continue → uploadPaygClassProof(session.sessionId, studentId, file) → onChoose({ method: "bank_transfer", proofId, reference }). At venue → onChoose({ method: "at_venue" }). Focus trapped by the native dialog; Escape → onClose.
// schedule-client.ts
export async function getTrialAccess(studentId: string): Promise<TrialAccessView | null>;   // callable "getTrialAccess" in memberFunctionsRegion; parse with a zod object mirroring TrialAccessView
export async function uploadPaygClassProof(sessionId: string, studentId: string, file: File): Promise<string>; // same base64 dance as uploadIntroMembershipProof; callable "uploadPaygClassProof"
```
Trial band (in `member-calendar.tsx`, above the week grid, only when `participant.trial`): `<p className="calendar-trial-band" role="status">Trial · {allowance - attendedCount - futureBookings} of {allowance} classes left · ends {new Date(expiresAt).toLocaleDateString("en-GB")}</p>`; when status is not `active` or no classes left: `Your trial has ended. Choose a membership to keep training.` followed by `<a href="/account/membership?from=intro">Get a membership</a>`.

- [ ] **Step 1: Failing tests** — dialog: at-venue calls `onChoose({method:"at_venue"})`; bank transfer without a file keeps Continue disabled; with a file uploads then calls `onChoose` with the proofId. Application form: selecting a per-session plan hides the reference/file inputs and submits `proofId: null`. Calendar: a participant with `trial` renders the band with `2 of 2 classes left`.
- [ ] **Step 2: Run → FAIL.** — [ ] **Step 3: Implement.** — [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -m "Show the trial, book trial classes and choose PAYG payment in the member app"`.

---

### Task 16: Web — staff roster confirmation, office transfer link, Transit Free owner-only [D13][D15]

**Files:**
- Modify: `apps/web/src/app/admin/classes-services/classes/registrations-panel.tsx` — **dirty in another session's tree; if still dirty when you start, stop and report.** Changes: `data-payment` treats the two new labels as `"due"`; for any staff (`canEdit || true` — every roster viewer is staff per `listSessionBookings`) show a `Confirm paid` button when the label is `PAYG Pay at venue`, `PAYG Transfer sent` or `PAYG Needs to pay` → `confirmPaygClassPayment(sessionId, studentId)` then `refresh()`; for `canReadMemberships && label === "PAYG Transfer sent"` show `View transfer` → `getPaygClassProofUrl(sessionId, studentId)` and open the URL in a new tab (`rel="noreferrer"`). Keep the existing office `Record class payment` button.
- Modify: `apps/web/src/lib/groups-client.ts` (`confirmPaygClassPayment`, `getPaygClassProofUrl` using the file's `call` helper)
- Modify: `apps/web/src/app/admin/members/member-subscription-editor.tsx` and its parent that passes `plans` (find with `grep -rn "MemberSubscriptionEditor" apps/web/src`): pass `role`; inside the editor filter `plans` to exclude `transit-free` unless `role === "owner"`.
- Tests: `registrations-panel.test.tsx` (append: coach sees Confirm paid for a Pay-at-venue row and the callable is invoked), `member-subscription-editor.test.tsx` if it exists (administrator does not see Transit Free).

- [ ] Steps 1–4 as usual. — [ ] **Step 5: Commit** — `git commit -m "Let staff confirm PAYG class payments and keep Transit Free owner-only"`.

---

### Task 17: Typecheck, integrate, push, deploy [D17]

**Files:** none new. `docs/superpowers/specs/2026-09-22-beginner-trial-belt-payg-design.md` status line → `implementado; publicado <fecha>` once deployed.

- [ ] **Step 1: Confirm the other session's work is committed.** `git status --porcelain` must be empty except your own uncommitted work. If foreign hunks remain, stop and report — do not commit them.
- [ ] **Step 2: Finish the deferred commits** from Tasks 9 and 11 (the `schedule-callables.ts` / `index.ts` edits) now that the tree is clean, and Task 16's panel edit if it was deferred.
- [ ] **Step 3: Typecheck the two apps you changed**: `corepack pnpm --filter @bpt-jersey/domain typecheck && corepack pnpm --filter @bpt-jersey/functions typecheck && corepack pnpm --filter @bpt-jersey/web typecheck`. Fix errors in files this plan touched only.
- [ ] **Step 4: Run the focused test files of every task once more** (list them from the tasks) → all PASS.
- [ ] **Step 5: Integrate and push**: `git fetch origin main && git rebase origin/main` (resolve conflicts locally, never force-push), then `git push origin main`; verify `git rev-parse main origin/main` match.
- [ ] **Step 6: Deploy functions** (the predeploy guard requires a clean tree equal to origin/main): `firebase deploy --only functions` from the repo root, using the project's existing Firebase authorisation. Cloudflare Pages publishes the web from `main` automatically (~90 s).
- [ ] **Step 7: Smoke-check production with synthetic data only**: open `/enrol` and confirm the Beginner card and the `I'm not a Beginner` control render; as an office account open Enrolment Requests and confirm the `Membership requests` section renders; as a coach open a West session roster and confirm the labels render. Report exactly what was and was not verified.
- [ ] **Step 8: Commit the spec status update** — `git commit -m "Mark the beginner trial design as published"` and push.

---

## Self-review against the spec

- D1 (card + button + belt/stripes) → Task 13. D2 (2 vs 1) → Tasks 1, 5. D3 (belt list by age, preselected, White Belt default) → Tasks 13, 14. D4 (intro = Introduction Class) → Task 7 (accessMode). D5 ("Trial" label, not a membership) → Tasks 2, 15. D6 (≥16 intro only, <16 age band, same site) → Tasks 3, 7. D7 (30 days / allowance) → Tasks 2, 3, 7, 8. D8 (Enrolment Requests without payment) → Tasks 1, 5, 14. D9 (notice copy, persists) → Task 8 (copy) + Task 15 (link text; the notice list already hides only read notices — `Dismiss` remains available, which the spec tolerates because the calendar band repeats the call to action). D10 (form with PAYG) → Tasks 10, 15. D11 (owner/admin in Enrolment Requests) → Task 14. D12 (West auto-PAYG, Town blocked, kids blocked) → Task 8. D13 (Transit Free owner) → Tasks 12, 16. D14 (payment choice) → Tasks 4, 11, 15. D15 (coach tick) → Tasks 11, 16. D16 (overdue-only debt) → Tasks 4, 11. D17 (main + deploy) → Task 17.
- Type names used across tasks: `TrialAccessView` (Task 2) is consumed by Tasks 3, 6, 9, 15; `PaygBookingPayment` (Task 4) by Tasks 11, 15; `EnrolmentLevelDeclaration(s)`, `EnrolmentPlanChoice`, `trialPlanChoice`, `enrolmentTrialAllowance` (Task 1) by Tasks 5, 13, 14; `ageOnDate` (Task 3) by Tasks 7, 13, 14; `readTrialAccess`, `trialView`, `futureIntroBookingCount` (Task 6) by Tasks 7, 8, 9.
