# Intro Class Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a new canonical student book and attend one free Intro Class without a subscription, then submit a venue/plan/payment-evidence application that office staff manually approve into canonical membership and finance records.

**Architecture:** Add an explicit, backward-compatible `accessMode` to classes/sessions and a versioned `intro` booking origin; extend the existing calendar and attendance paths instead of creating parallel ones. A create-once attendance conversion state emits recipient-scoped in-app notices, while a separate membership-application module owns private evidence and orchestrates the existing `saveManualSubscription` transaction with deterministic receipts.

**Tech Stack:** TypeScript 6, Zod 4, Next.js 16 App Router, React 19, Firebase Auth/App Check/Firestore/Cloud Functions v2, private Cloudflare R2 adapter, Vitest 4, Playwright 1.61.

**Spec:** `docs/superpowers/specs/2026-09-21-intro-class-conversion-design.md`

## Global Constraints

- Work directly on local `main`; fetch and integrate `origin/main` before product edits.
- Preserve `.impeccable/`, `Assets/`, `docs/audits/` and `docs/reviews/` as unrelated untracked content.
- Existing class/session documents without `accessMode` read as `membership`; no production backfill is required.
- Existing membership and course bookings remain readable and keep their current authorisation.
- An Intro Class requires account, canonical participant and accepted waiver, but no subscription.
- A participant gets at most one future confirmed intro booking and no self-service intro after attended/late intro attendance.
- Pending/correction membership applications confer no class access.
- Follow-up is in-app only. Do not invoke email, SMS, browser push or an external delivery provider.
- Coach views retain roster/attendance only and exclude plans, prices, bank instructions, evidence and review actions.
- Reuse App Check, actor resolution, academy scope, audit writers, bank instructions, private R2 and manual-subscription finance invariants.
- Evidence is PNG/JPEG only, non-empty, magic-byte checked, at most 2 MiB, SHA-256 addressed and privately stored.
- All user-supplied objects use closed Zod schemas or equivalent exact-key parsers at trust boundaries.
- No direct browser writes are added to Firestore Rules and no new dependency is introduced.
- UI copy is British English and uses existing member/admin shells and `DESIGN.md` tokens.
- No Firebase deploy, production write, migration, seed or secret/IAM change belongs to this plan.

## Review Focus

- A stale client sees an intro session before another user takes the final place: the server confirms one booking and returns a capacity error to the other without partial writes.
- A guardian relationship changes between page load and application submit: the server denies the stale actor and does not attach evidence or create an application.
- Attendance trigger delivery is duplicated or arrives after a correction: one conversion state/notice exists and no notification is redirected to another account.
- Subscription approval succeeds in `saveManualSubscription` but the final application update is interrupted: retry reuses the membership receipt and safely completes the application once.
- A plan price/site/active flag changes after evidence submission: approval stops before payment creation and asks office to refresh rather than approving stale commercial terms.

---

## File Structure

### New focused files

- `packages/domain/src/memberships/intro-conversion-contracts.ts` — conversion state, member notification and membership-application Zod contracts.
- `packages/domain/src/memberships/intro-conversion-contracts.test.ts` — closed-shape and state-transition coverage.
- `apps/functions/src/schedule/intro-booking-service.ts` — transactional eligibility and booking creation using the existing booking store types.
- `apps/functions/src/schedule/intro-booking-service.test.ts` — capacity, waiver, prior attendance and concurrency cases.
- `apps/functions/src/memberships/intro-conversion-service.ts` — attendance-trigger projection, notification queries, application submission and review orchestration.
- `apps/functions/src/memberships/intro-conversion-service.test.ts` — recipient scope, idempotency, stale plan and partial-approval recovery.
- `apps/functions/src/memberships/intro-conversion-callables.ts` — member/office callable boundaries and safe error mapping.
- `apps/functions/src/memberships/intro-conversion-callables.test.ts` — App Check, role and closed-payload checks.
- `apps/functions/src/memberships/intro-conversion-trigger.ts` — Firestore attendance create trigger.
- `apps/functions/src/memberships/intro-payment-proof.ts` — private R2 upload/read helpers specific to membership applications.
- `apps/functions/src/memberships/intro-payment-proof.test.ts` — magic bytes, size, owner namespace and signed-link authorisation.
- `apps/web/src/lib/intro-conversion-client.ts` — validated callable client and safe errors.
- `apps/web/src/lib/intro-conversion-client.test.ts` — response validation and file guards.
- `apps/web/src/app/account/intro-notices.tsx` — recipient-scoped status bands for account notices.
- `apps/web/src/app/account/intro-notices.test.tsx` — rendering, read action and safe text coverage.
- `apps/web/src/app/admin/billing/intro-applications-panel.tsx` — pending-review table and decision panel.
- `apps/web/src/app/admin/billing/intro-applications-panel.test.tsx` — role, evidence and decision UI coverage.
- `qa/tests/intro-class-conversion.spec.ts` — tagged desktop/mobile synthetic browser story.
- `qa/tests/intro-class-conversion-auth-emulator.spec.ts` — authenticated emulator integration story.

### Existing files to modify

- `packages/domain/src/schedule/schedule-contracts.ts` and tests — `accessMode`, intro booking union and request parser.
- `packages/domain/src/schedule/member-calendar-contracts.ts` and tests — intro visibility/status without membership.
- `packages/domain/src/index.ts` — public type exports.
- `apps/functions/src/schedule/schedule-service.ts`, `schedule-callables.ts` and tests — persistence and intro booking routing.
- `apps/functions/src/schedule/weekly-session-service.ts` and tests — project access mode to generated sessions.
- `apps/functions/src/schedule/attendance-transaction-service.ts` and tests — accept validated intro booking origin.
- `apps/functions/src/index.ts` — callable and trigger exports.
- `apps/functions/src/data/backup-v3-contracts.ts` and tests — inventory new metadata collections.
- `firestore.indexes.json` — member-notification and application review queries.
- `apps/web/src/lib/schedule-client.ts` and tests — new booking wire union.
- `apps/web/src/lib/calendar/calendar-repository.ts`, `firebase-calendar-repository.ts` and tests — canonical participants without memberships and intro data.
- `apps/web/src/app/account/calendar/member-calendar.tsx`, `session-card.tsx` and tests — free-intro labels/actions.
- `apps/web/src/app/account/page.tsx`, `account.css` and tests — in-app follow-up band.
- `apps/web/src/app/account/membership/page.tsx`, `membership.css` and tests — venue/plan/evidence application flow.
- `apps/web/src/app/admin/classes-services/classes/page.tsx`, `session-panel.tsx`, CSS and tests — class/session access-mode controls.
- `apps/web/src/app/admin/billing/page.tsx`, `billing.css` and tests — membership application review panel.

---

### Task 1: Add backward-compatible access and conversion contracts

**Files:**

- Modify: `packages/domain/src/schedule/schedule-contracts.ts`
- Modify: `packages/domain/src/schedule/schedule-contracts.test.ts`
- Modify: `packages/domain/src/schedule/member-calendar-contracts.ts`
- Modify: `packages/domain/src/schedule/member-calendar-contracts.test.ts`
- Create: `packages/domain/src/memberships/intro-conversion-contracts.ts`
- Create: `packages/domain/src/memberships/intro-conversion-contracts.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Produces: `classAccessModes`, `ClassAccessMode`, `IntroBookingRecord`, `RequestIntroBookingInput`, `introConversionStateSchema`, `memberNotificationSchema`, `membershipApplicationSchema`, `membershipApplicationSubmitSchema`, `membershipApplicationDecisionSchema`.
- Compatibility: `normalizeClassRecord` and the new `sessionAccessMode` reader return `accessMode: "membership"` when the stored property is absent.

- [ ] **Step 1: Write failing schedule compatibility and booking-union tests**

```ts
it("defaults legacy classes and sessions to membership access", () => {
  expect(normalizeClassRecord(legacyClass).accessMode).toBe("membership");
  expect(sessionAccessMode(legacySession)).toBe("membership");
});

it("parses an intro booking request without a membership", () => {
  expect(parseRequestBookingInput({
    kind: "intro", sessionId: "session-1", studentId: "student-1",
  })).toEqual(ok({kind: "intro", sessionId: "session-1", studentId: "student-1"}));
});
```

- [ ] **Step 2: Write failing closed Zod contract tests**

```ts
expect(membershipApplicationSubmitSchema.safeParse({
  requestId: crypto.randomUUID(), conversionId: "intro-student-1", studentId: "student-1",
  site: "Town", planId: "town-adult", proofId: "a".repeat(64), bankReference: "INTRO-123",
}).success).toBe(true);
expect(membershipApplicationSubmitSchema.safeParse({...valid, priceMinor: 1}).success).toBe(false);
expect(memberNotificationSchema.safeParse({...notice, href: "https://evil.example"}).success).toBe(false);
```

- [ ] **Step 3: Run the focused domain tests and verify RED**

Run: `corepack pnpm exec vitest run packages/domain/src/schedule/schedule-contracts.test.ts packages/domain/src/schedule/member-calendar-contracts.test.ts packages/domain/src/memberships/intro-conversion-contracts.test.ts`

Expected: FAIL because the new access mode, booking variant and conversion schemas do not exist.

- [ ] **Step 4: Implement the exact domain shapes**

```ts
export const classAccessModes = ["membership", "intro"] as const;
export type ClassAccessMode = (typeof classAccessModes)[number];

export type IntroBookingRecord = Omit<LegacyBookingRecord, "membershipId" | "schemaVersion"> & {
  schemaVersion: "3";
  membershipId: null;
  source: Readonly<{kind: "intro"}>;
};

export type RequestBookingInput =
  | Readonly<{kind: "membership"; sessionId: string; studentId: string; membershipId: string}>
  | Readonly<{kind: "intro"; sessionId: string; studentId: string}>;
```

Use `z.strictObject` for all new membership-conversion inputs and records. Application statuses are exactly `draft`, `pending_review`, `correction_requested`, `approved`, `rejected`, `cancelled`; notice kinds are `intro-membership-follow-up`, `membership-application-correction`, `membership-application-approved`, `membership-application-rejected`. Hrefs must start with `/account/`.

- [ ] **Step 5: Extend calendar rules without weakening ordinary membership checks**

```ts
if (session.accessMode === "intro") {
  if (member.hasActiveMembership || member.hasAttendedIntro) return "paid_period";
  return sessionSite(session) === member.introSite ? undefined : "site";
}
if (member.membershipId === null) return "paid_period";
```

Add `introSite?: Site`, `hasActiveMembership?: boolean`, and `hasAttendedIntro?: boolean` to `CalendarMemberContext`; leave course handling first and unchanged.

- [ ] **Step 6: Run the domain tests and commit**

Run: `corepack pnpm exec vitest run packages/domain/src/schedule/schedule-contracts.test.ts packages/domain/src/schedule/member-calendar-contracts.test.ts packages/domain/src/memberships/intro-conversion-contracts.test.ts`

Expected: PASS.

```bash
git add packages/domain/src/schedule packages/domain/src/memberships/intro-conversion-contracts.ts packages/domain/src/memberships/intro-conversion-contracts.test.ts packages/domain/src/index.ts
git commit -m "Model intro class access and conversion"
```

### Task 2: Persist and administer Intro Class access mode

**Files:**

- Modify: `apps/functions/src/schedule/schedule-service.ts`
- Modify: `apps/functions/src/schedule/schedule-service.test.ts`
- Modify: `apps/functions/src/schedule/weekly-session-service.ts`
- Modify: `apps/functions/src/schedule/weekly-session-service.test.ts`
- Modify: `apps/web/src/lib/schedule-client.ts`
- Modify: `apps/web/src/app/admin/classes-services/classes/page.tsx`
- Modify: `apps/web/src/app/admin/classes-services/classes/page.test.tsx`
- Modify: `apps/web/src/app/admin/classes-services/classes/session-panel.tsx`
- Modify: `apps/web/src/app/admin/classes-services/classes/session-panel.test.tsx`
- Modify: `apps/web/src/app/admin/classes-services/classes-services.css`

**Interfaces:**

- Consumes: `ClassAccessMode` and existing `CreateClassInput`, `UpdateClassInput`, `UpdateSessionInput`.
- Produces: class/session documents with explicit access mode for new writes; existing reads continue to default.

- [ ] **Step 1: Add failing persistence/projection tests**

```ts
it("projects intro access to every generated session", async () => {
  const created = await store.createClass(academyId, {...draft, accessMode: "intro"}, actorId);
  const sessions = await store.generateSessions(academyId, created.classId, range, actorId);
  expect(sessions.every((session) => session.accessMode === "intro")).toBe(true);
});

it("does not infer intro access from the class title", async () => {
  expect((await store.createClass(academyId, {...draft, name: "Intro Class", accessMode: "membership"}, actorId)).accessMode).toBe("membership");
});
```

- [ ] **Step 2: Add failing admin form tests**

```tsx
await user.selectOptions(screen.getByLabelText("Class access"), "intro");
await user.click(screen.getByRole("button", {name: "Save class"}));
expect(saveClass).toHaveBeenCalledWith(expect.objectContaining({accessMode: "intro"}));
```

- [ ] **Step 3: Run focused tests and verify RED**

Run: `corepack pnpm exec vitest run apps/functions/src/schedule/schedule-service.test.ts apps/functions/src/schedule/weekly-session-service.test.ts apps/web/src/app/admin/classes-services/classes/page.test.tsx apps/web/src/app/admin/classes-services/classes/session-panel.test.tsx`

Expected: FAIL because persistence and controls omit `accessMode`.

- [ ] **Step 4: Persist the explicit value at class/session write boundaries**

```ts
const record: ClassRecord = {...existingRecordFields, accessMode: input.accessMode};
const session: SessionRecord = {...generatedSessionFields, accessMode: classRecord.accessMode};
```

`updateSession` accepts an office-authored access-mode correction and writes it into the existing audit event. No title-based migration or background write is added.

- [ ] **Step 5: Add one native labelled select to both editors**

```tsx
<label>
  Class access
  <select name="accessMode" defaultValue={record?.accessMode ?? "membership"}>
    <option value="membership">Membership required</option>
    <option value="intro">Free Intro Class</option>
  </select>
</label>
```

Use existing field grids and focus styles; do not add a card or new colour.

- [ ] **Step 6: Run focused tests and commit**

Run the command from Step 3. Expected: PASS.

```bash
git add apps/functions/src/schedule apps/web/src/lib/schedule-client.ts apps/web/src/app/admin/classes-services/classes
git commit -m "Administer Intro Class sessions explicitly"
```

### Task 3: Authorise free Intro Class bookings transactionally

**Files:**

- Create: `apps/functions/src/schedule/intro-booking-service.ts`
- Create: `apps/functions/src/schedule/intro-booking-service.test.ts`
- Modify: `apps/functions/src/schedule/booking-transaction-service.ts`
- Modify: `apps/functions/src/schedule/booking-transaction-service.test.ts`
- Modify: `apps/functions/src/schedule/schedule-service.ts`
- Modify: `apps/functions/src/schedule/schedule-callables.ts`
- Modify: `apps/functions/src/schedule/schedule-callables.test.ts`
- Modify: `apps/web/src/lib/schedule-client.ts`

**Interfaces:**

- Produces: `requestIntroBooking(firestore, {academyId, actorId, actorRole, studentId, sessionId, now}): Promise<IntroBookingRecord>`.
- Reuses: `assertBookingMemberAccess`, canonical identity resolution, waiver consent IDs, deterministic booking IDs and existing audit writer.

- [ ] **Step 1: Add failing eligibility and concurrency tests**

```ts
it.each(["missing-waiver", "active-membership", "prior-intro-attendance", "future-intro-booking"])(
  "rejects %s without writing a booking", async (state) => {
    const store = seededIntroStore({state});
    await expect(requestIntroBooking(store.db, command)).rejects.toMatchObject({code: "ineligible"});
    expect(store.bookingWrites()).toHaveLength(0);
  },
);

it("lets only one caller take the final place", async () => {
  const results = await Promise.allSettled([book("student-a"), book("student-b")]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(await confirmedCount("session-1")).toBe(1);
});
```

- [ ] **Step 2: Run service tests and verify RED**

Run: `corepack pnpm exec vitest run apps/functions/src/schedule/intro-booking-service.test.ts apps/functions/src/schedule/booking-transaction-service.test.ts apps/functions/src/schedule/schedule-callables.test.ts`

Expected: FAIL because intro routing is absent.

- [ ] **Step 3: Implement one transaction for final eligibility and capacity**

```ts
export async function requestIntroBooking(
  db: Firestore,
  command: IntroBookingCommand,
): Promise<IntroBookingRecord> {
  return db.runTransaction(async (tx) => {
    const facts = await readIntroEligibility(tx, db, command);
    assertIntroEligibility(facts, command.now);
    const booking = buildIntroBooking(command, facts.session);
    tx.create(db.doc(bookingPath(command.academyId, booking.bookingId)), booking);
    appendAuditEventInTransaction(tx, db.collection(auditPath(command.academyId)).doc(), introBookingAudit(command, booking));
    return booking;
  });
}
```

Bound all collection queries to 101 records and fail closed above 100. Count all confirmed booking origins for capacity. Query canonical identity aliases so legacy IDs cannot bypass prior attendance or current membership checks.

- [ ] **Step 4: Route the discriminated request without changing membership booking**

```ts
return parsed.value.kind === "intro"
  ? requestIntroBooking(getFirestore(), introCommand(actor, parsed.value))
  : store.requestBooking(actor.academyId, parsed.value, actor.userId, auditActor(actor));
```

Keep guardian/adult/teen actor checks in the callable and recheck canonical participant scope in the transaction.

- [ ] **Step 5: Run focused tests and commit**

Run the command from Step 2. Expected: PASS.

```bash
git add apps/functions/src/schedule apps/web/src/lib/schedule-client.ts
git commit -m "Book Intro Classes without memberships"
```

### Task 4: Expose Intro Class in the pre-membership calendar

**Files:**

- Modify: `apps/web/src/lib/calendar/calendar-repository.ts`
- Modify: `apps/web/src/lib/calendar/firebase-calendar-repository.ts`
- Modify: `apps/web/src/lib/calendar/firebase-calendar-repository.test.ts`
- Modify: `apps/web/src/app/account/calendar/member-calendar.tsx`
- Modify: `apps/web/src/app/account/calendar/member-calendar.test.tsx`
- Modify: `apps/web/src/app/account/calendar/session-card.tsx`
- Modify: `apps/web/src/app/account/calendar/session-card.test.tsx`

**Interfaces:**

- Produces: `CalendarParticipant` fields `introSite`, `hasAttendedIntro`, `hasActiveMembership`; `CalendarRepository.book` accepts the Task 1 union.
- Reuses: `getClientProfile`, `getFamily`, `listSessions`, `listStudentBookings`, `listStudentAttendance`, and existing cancellation/self-check-in calls.

- [ ] **Step 1: Add failing repository tests for a participant without membership**

```ts
it("loads a canonical adult and only eligible Intro Classes before membership", async () => {
  mockProfile({studentId: "student-1", trainingCenter: "Town"});
  mockMemberships([]);
  mockSessions([townIntro, westIntro, ordinaryClass]);
  const member = await repository.loadMember();
  expect(member.participants[0]).toMatchObject({studentId: "student-1", membershipId: null, introSite: "Town"});
  expect((await repository.loadWeek("student-1", from, to)).sessions).toContainEqual(townIntro);
});
```

- [ ] **Step 2: Add failing UI tests**

```tsx
expect(screen.getByText("Free Intro Class")).toBeVisible();
await user.click(screen.getByRole("button", {name: "Book free intro"}));
expect(repository.book).toHaveBeenCalledWith({kind: "intro", sessionId: "intro-1", studentId: "student-1"});
```

- [ ] **Step 3: Run calendar tests and verify RED**

Run: `corepack pnpm exec vitest run apps/web/src/lib/calendar/firebase-calendar-repository.test.ts apps/web/src/app/account/calendar/member-calendar.test.tsx apps/web/src/app/account/calendar/session-card.test.tsx`

Expected: FAIL because participants are currently sourced only from memberships/courses and ordinary loading short-circuits.

- [ ] **Step 4: Load canonical participants and intro facts in parallel**

```ts
const [memberships, plans, subjects] = await Promise.all([
  listClientMemberships(), listAvailableMembershipPlans(), loadCanonicalSubjects(session.role),
]);
```

Always include authorised canonical subjects. `loadWeek` fetches sessions/bookings/attendance for them, then filters ordinary sessions unless a current membership exists; explicit intro sessions remain. Do not expose another family or academy.

- [ ] **Step 5: Render existing card states with intro copy**

Use `Free Intro Class` as metadata and `Book free intro` as the only open-card action. Booked, attended, full and closed retain existing whole-card status colours and cancellation/check-in behaviour.

- [ ] **Step 6: Run calendar tests and commit**

Run the command from Step 3. Expected: PASS.

```bash
git add apps/web/src/lib/calendar apps/web/src/app/account/calendar
git commit -m "Show Intro Classes before membership"
```

### Task 5: Create the first-attendance conversion state and account notice

**Files:**

- Modify: `apps/functions/src/schedule/attendance-transaction-service.ts`
- Modify: `apps/functions/src/schedule/attendance-transaction-service.test.ts`
- Create: `apps/functions/src/memberships/intro-conversion-service.ts`
- Create: `apps/functions/src/memberships/intro-conversion-service.test.ts`
- Create: `apps/functions/src/memberships/intro-conversion-trigger.ts`
- Create: `apps/functions/src/memberships/intro-conversion-callables.ts`
- Create: `apps/functions/src/memberships/intro-conversion-callables.test.ts`
- Modify: `apps/functions/src/index.ts`
- Create: `apps/web/src/lib/intro-conversion-client.ts`
- Create: `apps/web/src/lib/intro-conversion-client.test.ts`
- Create: `apps/web/src/app/account/intro-notices.tsx`
- Create: `apps/web/src/app/account/intro-notices.test.tsx`
- Modify: `apps/web/src/app/account/page.tsx`
- Modify: `apps/web/src/app/account/page.test.tsx`
- Modify: `apps/web/src/app/account/account.css`

**Interfaces:**

- Produces: `projectIntroAttendance(db, {academyId, attendanceId}): Promise<"created" | "ignored" | "existing" | "unresolved">`; callables `listMemberNotifications`, `markMemberNotificationRead`.
- Trigger: `introAttendanceCreated` on `academies/{academyId}/attendance/{attendanceId}`.

- [ ] **Step 1: Prove attendance accepts intro booking but still requires confirmation**

```ts
it("records self and staff attendance for a confirmed intro booking", async () => {
  expect(await selfCheckIn(introFixture)).toMatchObject({state: "attended"});
  expect(await staffCheckIn(otherIntroFixture)).toMatchObject({state: "attended"});
});
it("rejects an unbooked intro check-in", async () => {
  await expect(selfCheckIn({...introFixture, booking: undefined})).rejects.toMatchObject({code: "ineligible"});
});
```

- [ ] **Step 2: Add trigger idempotency and recipient-scope tests**

```ts
expect(await projectIntroAttendance(db, event)).toBe("created");
expect(await projectIntroAttendance(db, event)).toBe("existing");
expect(await count("introConversions")).toBe(1);
expect(await count("memberNotifications")).toBe(1);
expect((await listMemberNotifications(db, adultActor, query)).items[0]?.recipientUid).toBe(adultActor.userId);
```

Cover non-intro, correction, `no_show`, changed guardian, ambiguous guardian and mismatched academy. Ambiguous recipient returns `unresolved` and creates no notice.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `corepack pnpm exec vitest run apps/functions/src/schedule/attendance-transaction-service.test.ts apps/functions/src/memberships/intro-conversion-service.test.ts apps/functions/src/memberships/intro-conversion-callables.test.ts apps/web/src/lib/intro-conversion-client.test.ts apps/web/src/app/account/intro-notices.test.tsx apps/web/src/app/account/page.test.tsx`

Expected: FAIL because projection, callables and UI are absent.

- [ ] **Step 4: Implement create-once projection and recipient-scoped queries**

```ts
const conversionId = `intro-${studentId}`;
const noticeId = createHash("sha256").update(`${academyId}|${conversionId}|${recipientUid}`).digest("hex");
tx.create(conversionRef, introConversionStateSchema.parse({...state, conversionId}));
tx.create(noticeRef, memberNotificationSchema.parse({...notice, noticeId, recipientUid}));
```

The transaction re-reads attendance, session, booking, student, canonical account/relationship and any existing conversion. List queries require `recipientUid == actor.userId`, order by `createdAt` then document ID, limit 31 and return 30 plus cursor.

- [ ] **Step 5: Add a plain in-app status band**

Render server title/message as React text. The action href comes only from the parsed internal-path enum. Marking read is explicit and does not hide the membership action until the callable succeeds.

- [ ] **Step 6: Run focused tests and commit**

Run the command from Step 3. Expected: PASS.

```bash
git add apps/functions/src/schedule/attendance-transaction-service.ts apps/functions/src/schedule/attendance-transaction-service.test.ts apps/functions/src/memberships/intro-conversion-* apps/functions/src/index.ts apps/web/src/lib/intro-conversion-client* apps/web/src/app/account
git commit -m "Follow up first Intro Class attendance in app"
```

### Task 6: Submit private membership applications with venue and plan

**Files:**

- Create: `apps/functions/src/memberships/intro-payment-proof.ts`
- Create: `apps/functions/src/memberships/intro-payment-proof.test.ts`
- Modify: `apps/functions/src/memberships/intro-conversion-service.ts`
- Modify: `apps/functions/src/memberships/intro-conversion-service.test.ts`
- Modify: `apps/functions/src/memberships/intro-conversion-callables.ts`
- Modify: `apps/functions/src/memberships/intro-conversion-callables.test.ts`
- Modify: `apps/functions/src/index.ts`
- Modify: `apps/web/src/lib/intro-conversion-client.ts`
- Modify: `apps/web/src/lib/intro-conversion-client.test.ts`
- Modify: `apps/web/src/app/account/membership/page.tsx`
- Modify: `apps/web/src/app/account/membership/page.test.tsx`
- Modify: `apps/web/src/app/account/membership/membership.css`

**Interfaces:**

- Produces callables: `getIntroMembershipContext`, `uploadIntroMembershipProof`, `submitIntroMembershipApplication`, `cancelIntroMembershipApplication`.
- Produces object key: `academies/{academyId}/membership-application-proofs/{sha256(uid)}/{requestId}/{proofId}`.

- [ ] **Step 1: Add proof validation tests**

```ts
it.each([
  ["image/png", Buffer.from("not png")],
  ["image/jpeg", Buffer.alloc(0)],
  ["image/png", Buffer.alloc(2 * 1024 * 1024 + 1)],
])("rejects invalid %s evidence", async (contentType, bytes) => {
  await expect(uploadProof(requestFor(contentType, bytes), storage)).rejects.toMatchObject({code: "invalid-argument"});
});
```

Also assert a different UID cannot attach or retrieve the object and repeated identical upload returns the same hash/key.

- [ ] **Step 2: Add application boundary tests**

```ts
it("snapshots server plan facts and ignores client price attempts", async () => {
  await expect(submit({...validSubmit, priceMinor: 1} as never)).rejects.toMatchObject({code: "invalid-argument"});
  const application = await submit(validSubmit);
  expect(application).toMatchObject({site: "Town", planId: "town-adult", priceMinor: 8500, status: "pending_review"});
});
```

Cover stale guardian, inactive/retired plan, wrong site/participant type, missing bank instructions, no conversion, proof hash mismatch and existing non-terminal application.

- [ ] **Step 3: Add membership UI tests**

```tsx
expect(screen.getByLabelText("Training centre")).toHaveValue("Town");
await user.selectOptions(screen.getByLabelText("Membership plan"), "town-adult");
await user.upload(screen.getByLabelText(/Payment screenshot/), pngFile);
await user.click(screen.getByRole("button", {name: "Send for approval"}));
expect(await screen.findByText("Membership pending office approval.")).toBeVisible();
```

- [ ] **Step 4: Run focused tests and verify RED**

Run: `corepack pnpm exec vitest run apps/functions/src/memberships/intro-payment-proof.test.ts apps/functions/src/memberships/intro-conversion-service.test.ts apps/functions/src/memberships/intro-conversion-callables.test.ts apps/web/src/lib/intro-conversion-client.test.ts apps/web/src/app/account/membership/page.test.tsx`

Expected: FAIL because proof/application operations are absent.

- [ ] **Step 5: Implement upload and atomic application submission**

Reuse the proven magic-byte logic from `enrolment-payment-proof.ts`, but keep a separate object namespace and exact callable schema. Submission verifies object bytes/hash before its transaction, then the transaction rechecks conversion ownership, relationship, plan, site, bank settings and application uniqueness before creating `pending_review`.

```ts
const application = membershipApplicationSchema.parse({
  applicationId: `intro-application-${input.requestId}`,
  academyId: actor.academyId,
  applicantUid: actor.userId,
  studentId: input.studentId,
  conversionId: input.conversionId,
  site: input.site,
  planId: plan.planId,
  priceMinor: plan.priceMinor,
  currency: "GBP",
  proofId: input.proofId,
  bankReference: input.bankReference,
  status: "pending_review",
  revision: 0,
  createdAt: now,
  updatedAt: now,
});
```

- [ ] **Step 6: Replace the generic trial action only for intro conversions**

Keep existing membership history readable. When the context contains an eligible intro conversion, render participant, venue, eligible plan, bank instructions, transfer reference and file input. An existing pending/correction application renders its current state and correction reason; it never starts a trial membership.

- [ ] **Step 7: Run focused tests and commit**

Run the command from Step 4. Expected: PASS.

```bash
git add apps/functions/src/memberships apps/functions/src/index.ts apps/web/src/lib/intro-conversion-client* apps/web/src/app/account/membership
git commit -m "Submit Intro Class membership applications"
```

### Task 7: Review applications through canonical subscription billing

**Files:**

- Modify: `apps/functions/src/memberships/intro-conversion-service.ts`
- Modify: `apps/functions/src/memberships/intro-conversion-service.test.ts`
- Modify: `apps/functions/src/memberships/intro-conversion-callables.ts`
- Modify: `apps/functions/src/memberships/intro-conversion-callables.test.ts`
- Modify: `apps/functions/src/memberships/manual-subscription-service.ts`
- Modify: `apps/functions/src/memberships/manual-subscription-service.test.ts`
- Modify: `apps/functions/src/index.ts`
- Modify: `apps/web/src/lib/intro-conversion-client.ts`
- Create: `apps/web/src/app/admin/billing/intro-applications-panel.tsx`
- Create: `apps/web/src/app/admin/billing/intro-applications-panel.test.tsx`
- Modify: `apps/web/src/app/admin/billing/page.tsx`
- Modify: `apps/web/src/app/admin/billing/page.test.tsx`
- Modify: `apps/web/src/app/admin/billing/billing.css`

**Interfaces:**

- Produces callables: `listIntroMembershipApplications`, `getIntroMembershipProofUrl`, `reviewIntroMembershipApplication`.
- Approval orchestration calls existing `saveManualSubscription(db, actor, input)` with deterministic `requestId = application.requestId` and `settlement.kind = "paid"`.

- [ ] **Step 1: Add office role and private-evidence tests**

```ts
await expect(listAs(coach)).rejects.toMatchObject({code: "permission-denied"});
await expect(proofUrlAs(member, applicationId)).rejects.toMatchObject({code: "permission-denied"});
expect((await proofUrlAs(administrator, applicationId)).expiresAt).toBe(oneMinuteAfter(now));
```

- [ ] **Step 2: Add approval/recovery tests**

```ts
const first = await approve({applicationId, expectedRevision: 0, requestId: applicationRequestId});
const retry = await approve({applicationId, expectedRevision: 0, requestId: applicationRequestId});
expect(retry.membershipId).toBe(first.membershipId);
expect(await count("memberships")).toBe(1);
expect(await count("invoices")).toBe(1);
expect(await count("payments")).toBe(1);
```

Simulate interruption after `saveManualSubscription`; retry must find the deterministic `membershipChanges` receipt and finalize the application. Add a stale-plan test that changes `active`, `priceMinor` or site before approval and asserts zero new finance writes.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `corepack pnpm exec vitest run apps/functions/src/memberships/intro-conversion-service.test.ts apps/functions/src/memberships/intro-conversion-callables.test.ts apps/functions/src/memberships/manual-subscription-service.test.ts apps/web/src/app/admin/billing/intro-applications-panel.test.tsx apps/web/src/app/admin/billing/page.test.tsx`

Expected: FAIL because office review is absent.

- [ ] **Step 4: Implement claim, canonical settlement and finalize**

```ts
const claim = await claimApplicationReview(db, actor, input);
const subscription = await saveManualSubscription(db, actor, {
  studentId: claim.studentId,
  membershipId: null,
  expectedUpdatedAt: null,
  requestId: claim.requestId,
  operation: "assign",
  planId: claim.planId,
  startsAt: claim.startsAt,
  endsAt: claim.endsAt,
  settlement: {
    kind: "paid",
    amountMinor: claim.priceMinor,
    method: "bank_transfer",
    reference: claim.bankReference,
    occurredAt: input.occurredAt,
  },
});
return finalizeApprovedApplication(db, actor, claim, subscription);
```

`claimApplicationReview` uses expected revision, current office actor, fresh plan/participant/site/price and a deterministic review-operation document. Monthly periods use the existing `addSubscriptionMonth`; term plans require the current catalogue end-date rule already used by office enrolment. Per-session plans are not offered by this conversion flow.

- [ ] **Step 5: Implement correction/rejection transitions and notices**

Require a trimmed 1–1000 character reason. Transition only from `pending_review`; increment revision; create one deterministic recipient notice. Correction allows re-upload/resubmit from Membership. Rejection is terminal and never calls `saveManualSubscription`.

- [ ] **Step 6: Add the admin Billing panel**

Use the existing data table/panel controls. Show participant, venue, plan, amount, reference, submitted time and status. Evidence opens only after a button requests a one-minute URL; render with `alt="Payment evidence submitted for this membership application"` and `referrerPolicy="no-referrer"`. Approval has an explicit confirmation; correction/rejection require the reason field.

- [ ] **Step 7: Run focused tests and commit**

Run the command from Step 3. Expected: PASS.

```bash
git add apps/functions/src/memberships apps/functions/src/index.ts apps/web/src/lib/intro-conversion-client.ts apps/web/src/app/admin/billing
git commit -m "Review Intro Class membership applications"
```

### Task 8: Complete storage inventory, indexes and privacy boundaries

**Files:**

- Modify: `apps/functions/src/data/backup-v3-contracts.ts`
- Modify: `apps/functions/src/data/backup-v3-contracts.test.ts`
- Modify: `firestore.indexes.json`
- Modify: `docs/adr/ADR-004-firestore-aggregate-boundaries.md`
- Modify: `PRODUCT.md`

**Interfaces:**

- Adds direct collections: `introConversions`, `memberNotifications`, `membershipApplications`, `membershipApplicationReviews`.
- Adds composite queries: notifications by `recipientUid, createdAt, __name__`; applications by `status, updatedAt, __name__`.

- [ ] **Step 1: Add failing inventory tests**

```ts
expect(directCollectionSet).toEqual(expect.arrayContaining([
  "introConversions", "memberNotifications", "membershipApplications", "membershipApplicationReviews",
]));
```

- [ ] **Step 2: Run inventory tests and verify RED**

Run: `corepack pnpm exec vitest run apps/functions/src/data/backup-v3-contracts.test.ts`

Expected: FAIL because the collections are not inventoried.

- [ ] **Step 3: Add metadata collections and indexes**

Inventory only Firestore metadata. Document that evidence bytes remain private R2 objects and are neither Firestore fields nor public backup content. Add the two exact composite indexes without changing Rules to allow direct client access.

- [ ] **Step 4: Update product truth**

Add one concise PRODUCT.md section recording Intro Class eligibility, in-app-only conversion, pending review and coach finance exclusion. ADR-004 gains the four direct subcollections and deterministic create-once rationale.

- [ ] **Step 5: Run inventory tests and commit**

Run the command from Step 2. Expected: PASS.

```bash
git add apps/functions/src/data/backup-v3-contracts.ts apps/functions/src/data/backup-v3-contracts.test.ts firestore.indexes.json docs/adr/ADR-004-firestore-aggregate-boundaries.md PRODUCT.md
git commit -m "Inventory Intro Class conversion data"
```

### Task 9: Add synthetic emulator and Playwright acceptance coverage

**Files:**

- Create: `qa/tests/intro-class-conversion.spec.ts`
- Create: `qa/tests/intro-class-conversion-auth-emulator.spec.ts`
- Modify: `qa/tests/admin-fixture.ts`
- Modify: `qa/playwright.config.ts` only if the existing project matcher does not already include the new files.

**Interfaces:**

- Tag: `@intro-class-conversion` on every new acceptance case.
- Uses only Firebase emulator project `demo-bpt-jersey` and synthetic PNG bytes.

- [ ] **Step 1: Write the mocked browser story**

```ts
test("new adult books intro and submits membership evidence @intro-class-conversion", async ({page}) => {
  await page.goto("/account");
  await page.getByRole("button", {name: "Book free intro"}).click();
  await expect(page.getByText("Booked")).toBeVisible();
  await page.goto("/account/membership?from=intro");
  await page.getByLabel("Training centre").selectOption("Town");
  await page.getByLabel("Membership plan").selectOption("town-adult");
  await page.getByLabel(/Payment screenshot/).setInputFiles(syntheticPng);
  await page.getByRole("button", {name: "Send for approval"}).click();
  await expect(page.getByText("Membership pending office approval.")).toBeVisible();
});
```

Add desktop/mobile cases for cancel/rebook, in-app notice, correction/rejection, admin approval and coach denial.

- [ ] **Step 2: Write the emulator transaction story**

Seed adult, guardian/minor, waiver, Town Intro Class capacity one, active plan and bank instructions. Use authenticated callable SDKs to prove booking race, self/coach attendance, duplicate trigger projection, pending access denial, approval idempotency and coach finance denial.

- [ ] **Step 3: Run the tagged Playwright UI suite**

Run: `corepack pnpm --dir qa exec playwright test tests/intro-class-conversion.spec.ts --project=chromium --project=mobile-chrome`

Expected: PASS for all non-emulator desktop/mobile cases.

- [ ] **Step 4: Run the emulator acceptance case**

Run: `firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions "corepack pnpm --dir qa exec playwright test tests/intro-class-conversion-auth-emulator.spec.ts --project=chromium"`

Expected: PASS with synthetic records only. If a required emulator port is occupied by an unknown process, do not stop it; report the blocked command and retain the non-emulator evidence.

- [ ] **Step 5: Commit acceptance coverage**

```bash
git add qa/tests/intro-class-conversion.spec.ts qa/tests/intro-class-conversion-auth-emulator.spec.ts qa/tests/admin-fixture.ts qa/playwright.config.ts
git commit -m "Cover Intro Class conversion end to end"
```

### Task 10: Final focused verification, review and safe publication

**Files:**

- Modify only files required to fix findings introduced by Tasks 1–9.

**Interfaces:** None; this is the delivery gate.

- [ ] **Step 1: Run the modified domain/function/web unit suites**

Run the union of focused Vitest commands from Tasks 1–8, including every changed `.test.ts`/`.test.tsx` file.

Expected: PASS. Record unrelated pre-existing failures separately and do not repair unrelated fixtures.

- [ ] **Step 2: Type-check changed packages**

Run:

```bash
corepack pnpm --filter @bpt-jersey/domain typecheck
corepack pnpm --filter @bpt-jersey/functions typecheck
corepack pnpm --filter @bpt-jersey/web typecheck
corepack pnpm --dir qa typecheck
```

Expected: PASS for domain/functions/web and for the new QA files; document an unrelated existing QA baseline error without modifying it.

- [ ] **Step 3: Run the requested tagged Playwright suites**

Repeat Task 9 Steps 3–4 after all fixes. Expected: PASS or an explicitly evidenced emulator infrastructure block, never an inferred success.

- [ ] **Step 4: Inspect the complete delivery diff**

Run:

```bash
git diff --check origin/main...HEAD
git status --short
git diff --stat origin/main...HEAD
```

Expected: no whitespace errors; only requested tracked files; the four unrelated untracked directories remain untouched.

- [ ] **Step 5: Request one fresh whole-delivery review**

Reviewer focus: actor/academy scope, one-place concurrency, trigger idempotency, evidence privacy, partial-approval recovery, coach finance exclusion and compatibility of membership/course bookings. Fix only validated findings and rerun their focused checks.

- [ ] **Step 6: Commit any validated review fixes**

```bash
git add packages/domain/src/schedule packages/domain/src/memberships/intro-conversion-contracts.ts packages/domain/src/memberships/intro-conversion-contracts.test.ts packages/domain/src/index.ts apps/functions/src/schedule apps/functions/src/memberships apps/functions/src/data/backup-v3-contracts.ts apps/functions/src/data/backup-v3-contracts.test.ts apps/functions/src/index.ts apps/web/src/lib apps/web/src/app/account apps/web/src/app/admin/billing apps/web/src/app/admin/classes-services/classes firestore.indexes.json PRODUCT.md docs/adr/ADR-004-firestore-aggregate-boundaries.md qa/tests/intro-class-conversion.spec.ts qa/tests/intro-class-conversion-auth-emulator.spec.ts qa/tests/admin-fixture.ts qa/playwright.config.ts
git commit -m "Harden Intro Class conversion flow"
```

Skip this commit when review finds no change.

- [ ] **Step 7: Push only after the delivery gate is green**

```bash
git push origin main
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
```

Expected: local and remote SHA match. Do not force-push and do not deploy Firebase or the web app.

---

## Completion Checklist

- [ ] Explicit Intro access defaults old records safely and never depends on a title.
- [ ] Free booking enforces canonical scope, waiver, capacity, venue, active-membership and prior-attendance rules transactionally.
- [ ] Existing membership/course booking and attendance flows retain their behaviour.
- [ ] Member/guardian and coach/admin check-in work for confirmed intro bookings.
- [ ] First attendance creates one correctly scoped in-app notice and no external delivery.
- [ ] Membership application collects participant, venue, eligible plan, bank reference and private evidence.
- [ ] Pending/correction states do not grant booking access.
- [ ] Admin approval reuses canonical subscription/finance records idempotently; coach access is denied.
- [ ] New metadata is inventoried/indexed and evidence bytes remain private.
- [ ] Focused Vitest, emulator and Playwright evidence is recorded honestly.
- [ ] No deployment, production data mutation or secret change occurred.
- [ ] Local and `origin/main` SHAs match after the approved push.
