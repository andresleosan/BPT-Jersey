# Member Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove postal/medical capture, canonicalise visible membership numbers with safe reconciliation, and introduce immutable `ibjjf-v3` progress criteria.

**Architecture:** Keep legacy persisted schemas readable while narrowing current form payloads, reuse `studentIdentityKeys` for transactional uniqueness, and reuse the frozen-plan migration pattern for reconciliation. Publish progress criteria as a new catalogue version and migrate only mutable progress heads; historical promotions stay on their original catalogue.

**Tech Stack:** TypeScript, Zod, Next.js App Router/static export, React, Firebase Auth/Firestore/Cloud Functions, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-member-data-foundation-design.md`

## Global Constraints

- Work directly on local `main`; fetch and integrate `origin/main` before product edits.
- Do not include `.impeccable/`, `Assets/`, `docs/audits/` or `docs/reviews/` in commits.
- Internal `studentId`/`memberId` values remain opaque and immutable.
- Canonical `membershipNumber` is a string in the range `1..999999999`, without `#` or leading zeroes.
- Persisted legacy postal and medical fields remain readable; current forms do not capture or edit them.
- Public/admin enrolment retains venue and plan selection; profile save never creates a subscription.
- Coach views remain free of finance, postal, medical and migration data.
- `ibjjf-v2` is immutable; all new criteria live in `ibjjf-v3`.
- Production migration, seed and deployment are out of scope without separate operator authorisation.
- Reuse existing shells, controls, brand tokens, App Check, academy scoping, audit and HMAC identity keys.
- Do not add dependencies unless an existing project capability cannot implement the requirement.

## Review Focus

- An old client sends `postalAddress` while a current client omits it: both mutations succeed and omission preserves stored history without exposing it.
- Two concurrent writes claim textual variants of the same number (`#0033` and `33`): exactly one canonical reservation wins and neither partially writes.
- A reconciliation chunk is retried after partial success: applied rows remain stable and do not consume fresh sequence numbers.
- A progress head references an unexpected v2 definition key: v3 migration reports manual review and leaves it unchanged.
- A member exceeds 20 classes or 60 days: eligibility remains true rather than requiring literal equality.

---

## File Structure

### Existing files to modify

- `packages/domain/src/members/member-directory-contracts.ts` — separate legacy stored fields from current mutation shapes and canonicalise membership-number input.
- `packages/domain/src/members/member-directory-contracts.test.ts` — contract compatibility and current-input tests.
- `packages/domain/src/members/enrolment-request-contracts.ts` — current applicant schema without postal capture while legacy records remain readable.
- `packages/domain/src/members/enrolment-request-contracts.test.ts` — current/legacy enrolment fixtures.
- `apps/functions/src/members/canonical-member-directory-service.ts` — preserve omitted legacy fields and reserve canonical member numbers.
- `apps/functions/src/members/canonical-member-directory-service.test.ts` — atomic uniqueness and preservation tests.
- `apps/functions/src/members/enrolment-request-service.ts` and its test — store current requests without location and read legacy requests.
- `apps/web/src/app/enrol/page.tsx`, `page.test.tsx`, `enrolment-steps.css` — remove location capture while retaining centre/plan.
- `apps/web/src/app/admin/members/add/page.tsx`, `page.test.tsx` — remove location/medical capture and retain registration completion.
- `apps/web/src/app/admin/members/add/registration-completion.tsx`, its test — keep venue/level/subscription progression after simplified personal details.
- `apps/web/src/app/admin/members/profile/details-form-model.ts`, its test — omit location from current Details payload while preserving backend history.
- `apps/web/src/app/admin/members/profile/details-tab.tsx`, its test — remove Address/City/Post code/Country controls.
- `apps/web/src/app/admin/members/medical/medical-review-section.tsx`, `page.test.tsx` — read-only legacy presentation.
- `apps/web/src/app/account/profile/page.tsx`, `page.test.tsx` — retain venue and route plan changes to Membership.
- `packages/domain/src/levels/level-catalog-v2.ts` and its test — register and build `ibjjf-v3` without mutating v2.
- `apps/functions/src/levels/level-source.ts`, `level-source.test.ts`, `level-seed.ts`, `level-seed.test.ts` — v3 hashes and guarded seed.
- `apps/functions/scripts/level-seed-target.mjs`, its test, and `seed-levels.mjs` — v3 CLI target support.
- `apps/functions/src/levels/level-service.ts`, `level-service.test.ts` — progress-head version migration store.
- `apps/web/src/app/account/progress/own-progress.tsx`, `family-progress.tsx`, `page.test.tsx` — assert catalogue-driven 20/60 rendering.
- `qa/tests/enrolment-payment-staff.spec.ts`, `member-profile.spec.ts`, `progress-auth-emulator.spec.ts` — integrated browser coverage.

### New focused files

- `packages/domain/src/members/membership-number-contracts.ts` and `.test.ts` — pure canonical number and reconciliation-plan contracts.
- `apps/functions/src/members/membership-number-reconciliation.ts` and `.test.ts` — deterministic planner/applicator independent of Firebase SDK.
- `apps/functions/src/members/membership-number-reconciliation-firestore.ts` and `.test.ts` — academy-scoped reads, transactions, receipts and audit.
- `apps/functions/scripts/reconcile-membership-numbers.mjs` — dry-run-by-default operator CLI.
- `apps/functions/src/levels/level-progress-migration.ts` and `.test.ts` — pure v2→v3 head decision logic.
- `apps/functions/scripts/migrate-level-progress.mjs` — guarded dry-run/apply CLI.
- `qa/tests/member-data-foundation.spec.ts` — one tagged synthetic E2E story for this delivery.

---

### Task 1: Separate historical profile data from current mutation inputs

**Files:**
- Modify: `packages/domain/src/members/member-directory-contracts.ts`
- Modify: `packages/domain/src/members/member-directory-contracts.test.ts`
- Modify: `packages/domain/src/members/enrolment-request-contracts.ts`
- Modify: `packages/domain/src/members/enrolment-request-contracts.test.ts`

**Interfaces:**
- Consumes: existing `studentAdminProfileSchema`, `adminCreateStudentInputShape`, `adminUpdateStudentInputSchema`.
- Produces: `legacyPostalAddressInputSchema`, create/update schemas that accept both omission and the deprecated optional property, and record parsers that keep historical requests readable.

- [ ] **Step 1: Add failing stored-versus-current contract tests**

```ts
it("reads a historical admin profile with postal data", () => {
  expect(studentAdminProfileSchema.safeParse({ ...storedProfile, postalAddress }).success).toBe(true);
});

it("accepts current create and update inputs without postal location", () => {
  expect(adminCreateStudentInputSchema.safeParse(currentCreate).success).toBe(true);
  expect(adminUpdateStudentInputSchema.safeParse(currentUpdate).success).toBe(true);
});

it("accepts an old client payload but current submission omits postalAddress", () => {
  expect(adminCreateStudentInputSchema.safeParse({ ...currentCreate, postalAddress }).success)
    .toBe(true);
  expect(enrolmentRequestRecordSchema.safeParse(historicalRequest).success).toBe(true);
  expect(enrolmentRequestSubmissionSchema.parse(currentRequest).applicant)
    .not.toHaveProperty("postalAddress");
});
```

- [ ] **Step 2: Run the contract tests and confirm the new current/legacy split fails**

Run: `corepack pnpm exec vitest run packages/domain/src/members/member-directory-contracts.test.ts packages/domain/src/members/enrolment-request-contracts.test.ts`

Expected: FAIL because there is no named deprecated-field boundary and fixtures still treat postal location as current form data.

- [ ] **Step 3: Implement distinct current and legacy shapes**

```ts
export const legacyPostalAddressInputSchema = postalAddressSchema.optional();

export const adminCreateStudentInputShape = Object.freeze({
  ...currentIdentityAndTrainingShape,
  postalAddress: legacyPostalAddressInputSchema, // deprecated wire compatibility; no current UI
});

export const enrolmentApplicantSchema = z.strictObject({
  ...withoutOfficeOwnedFields(adminCreateStudentInputShape, officeOwnedEnrolmentFields),
  phoneNumber: adminCreateStudentInputShape.phoneNumber.unwrap(),
});
```

Keep the deprecated property explicitly optional. Do not use `.passthrough()` and do not make it required in any completeness/refinement check. Current clients omit it; old bounded payloads remain valid.

- [ ] **Step 4: Run the tests until current inputs and historical reads pass**

Run: `corepack pnpm exec vitest run packages/domain/src/members/member-directory-contracts.test.ts packages/domain/src/members/enrolment-request-contracts.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the contract boundary**

```bash
git add packages/domain/src/members/member-directory-contracts.ts packages/domain/src/members/member-directory-contracts.test.ts packages/domain/src/members/enrolment-request-contracts.ts packages/domain/src/members/enrolment-request-contracts.test.ts
git commit -m "Refine current member profile inputs"
```

### Task 2: Remove postal capture from public enrolment without losing venue or plans

**Files:**
- Modify: `apps/web/src/app/enrol/page.tsx`
- Modify: `apps/web/src/app/enrol/page.test.tsx`
- Modify: `apps/web/src/app/enrol/enrolment-steps.css`
- Modify: `apps/web/src/lib/enrolment-client.test.ts`

**Interfaces:**
- Consumes: current `EnrolmentRequestSubmission`, `PlanChoices`, existing payment evidence flow.
- Produces: a form model without `addressLine`/`postCode` that still sends `trainingCenter` and `planSelections`.

- [ ] **Step 1: Replace address-oriented tests with the approved behaviour**

```tsx
it("collects centre and plan without collecting postal or medical data", async () => {
  renderPage();
  expect(screen.queryByLabelText(/^Address$/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Post code/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: /medical conditions/i })).not.toBeInTheDocument();
  await completeAdultDetails({ centre: "West" });
  expect(await screen.findByRole("radio", { name: /West.*plan/i })).toBeVisible();
});
```

Also update the existing back-navigation test to prove changing centre resets an ineligible plan while preserving personal details.

- [ ] **Step 2: Run the enrolment component tests and observe removed-field assertions fail**

Run: `corepack pnpm exec vitest run apps/web/src/app/enrol/page.test.tsx apps/web/src/lib/enrolment-client.test.ts`

Expected: FAIL while the fields and payload mapping remain.

- [ ] **Step 3: Remove state, validation, mapping, markup and dead CSS**

```ts
type EnrolmentForm = Readonly<{
  fullName: string;
  dateOfBirth: string;
  phoneNumber: string;
  trainingCenter: TrainingCenter;
  trainingTimePreferences: readonly TrainingTimePreference[];
  minors: readonly MinorForm[];
  waiverAccepted: boolean;
}>;

const applicant = {
  fullName: form.fullName.trim(),
  dateOfBirth: form.dateOfBirth,
  phoneNumber: form.phoneNumber.trim(),
  trainingCenter: form.trainingCenter,
  trainingTimePreferences: [...form.trainingTimePreferences],
};
```

Remove the medical-collection hint, not the waiver's legal declaration that the participant must tell an instructor about relevant conditions.

- [ ] **Step 4: Run the focused tests**

Run: `corepack pnpm exec vitest run apps/web/src/app/enrol/page.test.tsx apps/web/src/lib/enrolment-client.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the public form simplification**

```bash
git add apps/web/src/app/enrol/page.tsx apps/web/src/app/enrol/page.test.tsx apps/web/src/app/enrol/enrolment-steps.css apps/web/src/lib/enrolment-client.test.ts
git commit -m "Simplify public member enrolment fields"
```

### Task 3: Simplify administrative enrolment and keep completion controls

**Files:**
- Modify: `apps/web/src/app/admin/members/add/page.tsx`
- Modify: `apps/web/src/app/admin/members/add/page.test.tsx`
- Modify: `apps/web/src/app/admin/members/add/registration-completion.tsx`
- Modify: `apps/web/src/app/admin/members/add/registration-completion.test.tsx`
- Modify: `apps/functions/src/members/enrolment-request-service.ts`
- Modify: `apps/functions/src/members/enrolment-request-service.test.ts`

**Interfaces:**
- Consumes: Task 1 current create/submission schemas and existing completion result.
- Produces: administrative create payload without postal/medical fields and unchanged venue, initial-level, plan and payment completion.

- [ ] **Step 1: Add failing UI/service tests**

```tsx
it("creates personal details without postal or medical capture, then completes venue and plan", async () => {
  renderAddMember();
  expect(screen.queryByRole("group", { name: /Address/i })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Medical/i)).not.toBeInTheDocument();
  await savePersonalDetails({ trainingCenter: "Town" });
  expect(await screen.findByLabelText(/Subscription plan/i)).toBeEnabled();
});
```

Add a service fixture that reads an older request containing `postalAddress` and returns it only through the restricted detail projection, while a new request is stored without it.

- [ ] **Step 2: Run the administrative enrolment tests**

Run: `corepack pnpm exec vitest run apps/web/src/app/admin/members/add/page.test.tsx apps/web/src/app/admin/members/add/registration-completion.test.tsx apps/functions/src/members/enrolment-request-service.test.ts`

Expected: FAIL on old fields/completion fixture assumptions.

- [ ] **Step 3: Remove capture and preserve the existing completion state machine**

Delete the address and medical form state, validation and save branch. Keep `trainingCenter`, `RegistrationCompletion`, `definitionKey`, `planId`, subscription dates and settlement fields unchanged. In service mapping, parse historical records with Task 1's legacy record schema and store current submissions from the current schema.

- [ ] **Step 4: Run focused tests**

Run the Step 2 command.

Expected: PASS, including retry/idempotency cases already in the suite.

- [ ] **Step 5: Commit administrative enrolment**

```bash
git add apps/web/src/app/admin/members/add apps/functions/src/members/enrolment-request-service.ts apps/functions/src/members/enrolment-request-service.test.ts
git commit -m "Simplify administrative member enrolment"
```

### Task 4: Simplify member/admin profile surfaces and protect historical data

**Files:**
- Modify: `apps/web/src/app/admin/members/profile/details-form-model.ts`
- Modify: `apps/web/src/app/admin/members/profile/details-form-model.test.ts`
- Modify: `apps/web/src/app/admin/members/profile/details-tab.tsx`
- Modify: `apps/web/src/app/admin/members/profile/details-tab.test.tsx`
- Modify: `apps/web/src/app/admin/members/medical/medical-review-section.tsx`
- Modify: `apps/web/src/app/admin/members/medical/page.test.tsx`
- Modify: `apps/web/src/app/account/profile/page.tsx`
- Modify: `apps/web/src/app/account/profile/page.test.tsx`
- Modify: `apps/functions/src/members/canonical-member-directory-service.ts`
- Modify: `apps/functions/src/members/canonical-member-directory-service.test.ts`

**Interfaces:**
- Consumes: Task 1 update schema and existing `/account/membership` route.
- Produces: `DetailsDraft` without location fields; backend merge semantics that preserve omitted legacy data; read-only legacy medical rendering.

- [ ] **Step 1: Write failing profile and preservation tests**

```ts
it("builds an update without postal location and preserves stored legacy values", async () => {
  const payload = payloadFromDraft(historicalDetails, currentDraft, requestId);
  expect(payload.ok && payload.payload).not.toHaveProperty("postalAddress");
  await update(payload);
  expect(storedAdminProfile.postalAddress).toEqual(historicalDetails.postalAddress);
});
```

```tsx
expect(screen.queryByLabelText(/^Address$/i)).not.toBeInTheDocument();
expect(screen.queryByLabelText(/^City$/i)).not.toBeInTheDocument();
expect(screen.getByRole("link", { name: /Manage membership/i }))
  .toHaveAttribute("href", "/account/membership");
```

Add a medical test asserting existing text is visible but no textbox, textarea or Save button is rendered; assert a coach receives no restricted medical projection.

- [ ] **Step 2: Run profile tests and verify failure**

Run: `corepack pnpm exec vitest run apps/web/src/app/admin/members/profile/details-form-model.test.ts apps/web/src/app/admin/members/profile/details-tab.test.tsx apps/web/src/app/admin/members/medical/page.test.tsx apps/web/src/app/account/profile/page.test.tsx apps/functions/src/members/canonical-member-directory-service.test.ts`

Expected: FAIL while location fields and editable medical controls remain.

- [ ] **Step 3: Implement the minimal UI/model and merge changes**

```ts
const nextProfile = {
  ...existingProfile,
  ...currentEditableProfileFields(input),
  // existingProfile.postalAddress survives because omission is not deletion
};
```

Remove `addressLine`, `city`, `postCode`, `country` from `DetailsDraft`, field mapping and markup. Keep `trainingCenter` and the Plan tab/editor. Render the medical legacy snapshot as labelled text through the existing office-only gate.

- [ ] **Step 4: Run the profile tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit profile simplification**

```bash
git add apps/web/src/app/admin/members/profile apps/web/src/app/admin/members/medical apps/web/src/app/account/profile apps/functions/src/members/canonical-member-directory-service.ts apps/functions/src/members/canonical-member-directory-service.test.ts
git commit -m "Remove postal and medical profile capture"
```

### Task 5: Canonicalise membership numbers at every write boundary

**Files:**
- Create: `packages/domain/src/members/membership-number-contracts.ts`
- Create: `packages/domain/src/members/membership-number-contracts.test.ts`
- Modify: `packages/domain/src/members/member-directory-contracts.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/package.json`
- Modify: `packages/domain/src/members/member-profile-contracts.ts`
- Modify: `packages/domain/src/members/member-profile-contracts.test.ts`
- Modify: `apps/functions/src/members/canonical-member-directory-service.ts`
- Modify: `apps/functions/src/members/canonical-member-directory-service.test.ts`

**Interfaces:**
- Produces: `canonicalMembershipNumberSchema`, `canonicaliseMembershipNumber(value): Result<string, MembershipNumberIssue>`, `nextMonotonicMembershipNumber(values): string`.
- Consumes: existing `studentIdentityKeys` HMAC reservation writer.

- [ ] **Step 1: Write failing pure-domain tests**

```ts
expect(canonicaliseMembershipNumber("#0033")).toEqual(ok("33"));
expect(canonicaliseMembershipNumber(" 0033 ")).toEqual(ok("33"));
for (const value of ["0", "-1", "3.3", "A33", "#", "1000000000"]) {
  expect(canonicaliseMembershipNumber(value).ok).toBe(false);
}
expect(nextMonotonicMembershipNumber(["1", "33", "00099", "A-7"])).toBe("100");
```

Add service tests where `#0033` and `33` resolve to the same HMAC key, concurrent owners cannot both commit, and an unrelated legacy postal field is preserved.

- [ ] **Step 2: Run domain and writer tests**

Run: `corepack pnpm exec vitest run packages/domain/src/members/membership-number-contracts.test.ts packages/domain/src/members/member-profile-contracts.test.ts apps/functions/src/members/canonical-member-directory-service.test.ts`

Expected: FAIL because the canonical module does not exist and existing identifier normalisation preserves prefixes.

- [ ] **Step 3: Implement pure canonicalisation and wire create/update**

```ts
export function canonicaliseMembershipNumber(value: string): Result<string, MembershipNumberIssue> {
  const digits = value.trim().replace(/^#/u, "");
  if (!/^\d+$/u.test(digits)) return err("invalid_format");
  const canonical = digits.replace(/^0+(?=\d)/u, "");
  if (!/^[1-9]\d{0,8}$/u.test(canonical)) return err("out_of_range");
  return ok(canonical);
}
```

Pipe member-number input through this schema before `buildStudentIdentityKey`. Leave ID-card/VAT normalisation unchanged. Replace `nextFreeMemberNumber`'s permissive parser with `nextMonotonicMembershipNumber`. Add the exact `@bpt-jersey/domain/members/membership-number` export in `packages/domain/package.json` and re-export its public types/functions from `packages/domain/src/index.ts`.

- [ ] **Step 4: Run tests including concurrency and no-partial-write cases**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit canonical numbering**

```bash
git add packages/domain/src/members packages/domain/src/index.ts packages/domain/package.json apps/functions/src/members/canonical-member-directory-service.ts apps/functions/src/members/canonical-member-directory-service.test.ts
git commit -m "Canonicalise member numbers transactionally"
```

### Task 6: Build the deterministic reconciliation plan

**Files:**
- Extend: `packages/domain/src/members/membership-number-contracts.ts`
- Extend: `packages/domain/src/members/membership-number-contracts.test.ts`
- Create: `apps/functions/src/members/membership-number-reconciliation.ts`
- Create: `apps/functions/src/members/membership-number-reconciliation.test.ts`

**Interfaces:**
- Consumes: `canonicaliseMembershipNumber`, immutable source rows `{recordRef, sourceKind, ownerId, sourceVersion, membershipNumber}`.
- Produces: `buildMembershipNumberReconciliationPlan(input): MembershipNumberPlan`, plan-row statuses, stable SHA-256 content payload.

- [ ] **Step 1: Write failing planner cases**

```ts
const plan = buildMembershipNumberReconciliationPlan({
  academyId: "academy-1",
  generatedAt: now,
  rows: [
    row("studentAdminProfiles/canonical", "canonical", "33"),
    row("members/legacy-a", "legacy", "#33"),
    row("members/legacy-b", "legacy", "#0033"),
  ],
});
expect(plan.rows).toEqual([
  expect.objectContaining({ recordRef: "studentAdminProfiles/canonical", action: "already_canonical", proposed: "33" }),
  expect.objectContaining({ recordRef: "members/legacy-a", action: "reassign", proposed: "34" }),
  expect.objectContaining({ recordRef: "members/legacy-b", action: "reassign", proposed: "35" }),
]);
expect(buildMembershipNumberReconciliationPlan(reversedInput).contentHash).toBe(plan.contentHash);
```

Add Review Focus tests for invalid values, duplicate opaque IDs, cross-academy rows, deterministic sorting and gaps that are not reused.

- [ ] **Step 2: Run the planner test**

Run: `corepack pnpm exec vitest run packages/domain/src/members/membership-number-contracts.test.ts apps/functions/src/members/membership-number-reconciliation.test.ts`

Expected: FAIL because planner/contracts are absent.

- [ ] **Step 3: Implement frozen data shapes and planner**

Use strict Zod contracts for the serialised artefact. Hash `JSON.stringify()` of a canonical key-sorted payload that excludes `contentHash`; sort inputs by `recordRef` before allocating. Mask old values in the serialised operator result while retaining raw values only inside the in-memory apply scope.

- [ ] **Step 4: Run the pure tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit the planner**

```bash
git add packages/domain/src/members/membership-number-contracts.ts packages/domain/src/members/membership-number-contracts.test.ts apps/functions/src/members/membership-number-reconciliation.ts apps/functions/src/members/membership-number-reconciliation.test.ts
git commit -m "Plan member number reconciliation safely"
```

### Task 7: Add the Firestore applicator and dry-run-first operator CLI

**Files:**
- Create: `apps/functions/src/members/membership-number-reconciliation-firestore.ts`
- Create: `apps/functions/src/members/membership-number-reconciliation-firestore.test.ts`
- Create: `apps/functions/scripts/reconcile-membership-numbers.mjs`
- Modify: `apps/functions/package.json`

**Interfaces:**
- Consumes: Task 6 `MembershipNumberPlan`, existing `buildStudentIdentityKey`, audit writer and member-directory transaction abstractions.
- Produces: `planMembershipNumberReconciliation(store, scope)`, `applyMembershipNumberReconciliation(store, plan, confirmation)`, chunk receipt statuses.

- [ ] **Step 1: Write failing adapter tests**

Test dry-run performs no writes; apply requires exact academy, operation ID, content hash and confirmation; canonical owner keeps `33`; reassigned rows receive reserved HMAC identity keys; old reservations remain bound to the same owner as historical aliases and are never reassigned; stale version/manual-review rows write nothing; retry returns `already_applied`; attendance/payment/audit fixture paths remain byte-for-byte unchanged.

```ts
await expect(apply(store, plan, { confirmation: "wrong" })).rejects.toThrow(/confirmation/i);
expect(store.writes).toEqual([]);
```

- [ ] **Step 2: Run adapter tests**

Run: `corepack pnpm exec vitest run apps/functions/src/members/membership-number-reconciliation-firestore.test.ts`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement transaction/precondition/audit semantics**

Follow `member-directory-forward-runner.ts` and `member-directory-frozen-plan.ts`: bound chunk size, re-read planned documents, check versions, reserve new identity key, update only number projections, append masked audit/receipt, then mark the row applied. Do not export a browser callable.

- [ ] **Step 4: Implement and syntax-check the CLI**

```js
const apply = options["apply"] === true;
if (!apply) console.log(JSON.stringify(await planOnly(scope), null, 2));
else if (options["confirmation"] !== expectedConfirmation(plan)) throw new Error("Confirmation required");
```

Require `--project`, `--academy-id`; default to dry-run. Reject production when emulator variables are present and reject emulator when the known production project is selected. Never print raw membership numbers.

Run: `node --check apps/functions/scripts/reconcile-membership-numbers.mjs`

Expected: exit 0.

- [ ] **Step 5: Run adapter tests and a demo-project dry run**

Run: `corepack pnpm exec vitest run apps/functions/src/members/membership-number-reconciliation-firestore.test.ts apps/functions/src/members/membership-number-reconciliation.test.ts`

Run against emulator only: `corepack pnpm --filter @bpt-jersey/functions reconcile:membership-numbers -- --project=demo-bpt-jersey --academy-id=demo-academy`

Expected: tests PASS; CLI prints a masked plan and performs zero writes.

- [ ] **Step 6: Commit reconciliation execution**

```bash
git add apps/functions/src/members/membership-number-reconciliation-firestore.ts apps/functions/src/members/membership-number-reconciliation-firestore.test.ts apps/functions/scripts/reconcile-membership-numbers.mjs apps/functions/package.json
git commit -m "Add idempotent member number reconciliation"
```

### Task 8: Introduce immutable ibjjf-v3 catalogue data

**Files:**
- Modify: `packages/domain/src/levels/level-catalog-v2.ts`
- Modify: `packages/domain/src/levels/level-catalog-v2.test.ts`
- Modify: `apps/functions/src/levels/level-source.ts`
- Modify: `apps/functions/src/levels/level-source.test.ts`
- Modify: `apps/functions/src/levels/level-catalog-integrity.test.ts`

**Interfaces:**
- Produces: `LevelCatalogVersion` including `ibjjf-v3`, `buildIbjjfV3CatalogSources()`, approved v3 source hashes.
- Consumes: committed v2 structural sources and stable definition keys.

- [ ] **Step 1: Write failing catalogue/version tests**

```ts
const v2 = buildIbjjfV2CatalogSources(v1, regyfit);
const v3 = buildIbjjfV3CatalogSources(v1, regyfit);
expect(keys(v3)).toEqual(keys(v2));
expect(criteria(v2, "WHITE BELT")).toEqual({ minClasses: 25, minDays: 90 });
expect(criteria(v3, "WHITE BELT")).toEqual({ minClasses: 20, minDays: 60 });
expect(withoutWhiteCriteria(v3)).toEqual(withoutWhiteCriteria(v2));
```

Assert v2 hashes remain unchanged and v3 has its own approved deterministic hashes.

- [ ] **Step 2: Run catalogue integrity tests**

Run: `corepack pnpm exec vitest run packages/domain/src/levels/level-catalog-v2.test.ts apps/functions/src/levels/level-source.test.ts apps/functions/src/levels/level-catalog-integrity.test.ts`

Expected: FAIL because v3 is unknown.

- [ ] **Step 3: Implement v3 as a narrow derivation, not a copy**

```ts
export const levelCatalogVersions = Object.freeze(["ibjjf-v1", "ibjjf-v2", "ibjjf-v3"] as const);

const v3CriteriaOverrides = new Map([
  ["WHITE BELT", { minClasses: 20, minDays: 60 }],
  ["RED BELT", { minClasses: null, minDays: 0 }],
]);
```

Extract one internal builder parameterised by system ID and override table so v2 output/hash does not change. Compute v3 hashes with the existing source-hash functions and pin them in tests/source approval.

- [ ] **Step 4: Run catalogue tests and prove v2 immutability**

Run the Step 2 command.

Expected: PASS and the existing v2 golden hash remains `7b3d072ce9e61b3b24edd6c76a5e221c1f3c1deb886be74de4b74182d31df98c`.

- [ ] **Step 5: Commit v3 domain data**

```bash
git add packages/domain/src/levels/level-catalog-v2.ts packages/domain/src/levels/level-catalog-v2.test.ts apps/functions/src/levels/level-source.ts apps/functions/src/levels/level-source.test.ts apps/functions/src/levels/level-catalog-integrity.test.ts
git commit -m "Add immutable IBJJF v3 criteria"
```

### Task 9: Guard v3 publication and migrate progress heads idempotently

**Files:**
- Modify: `apps/functions/src/levels/level-seed.ts`
- Modify: `apps/functions/src/levels/level-seed.test.ts`
- Modify: `apps/functions/scripts/level-seed-target.mjs`
- Modify: `apps/functions/scripts/level-seed-target.test.mjs`
- Modify: `apps/functions/scripts/seed-levels.mjs`
- Create: `apps/functions/src/levels/level-progress-migration.ts`
- Create: `apps/functions/src/levels/level-progress-migration.test.ts`
- Create: `apps/functions/scripts/migrate-level-progress.mjs`
- Modify: `apps/functions/src/levels/level-service.ts`
- Modify: `apps/functions/src/levels/level-service.test.ts`
- Modify: `apps/functions/package.json`

**Interfaces:**
- Consumes: Task 8 v3 catalogue and existing guarded seed environment.
- Produces: dry-run/apply head decisions `{migrate, already_v3, stale, manual_review}` and CLI.

- [ ] **Step 1: Write failing seed and migration-decision tests**

Cover v3 loading; production confirmation distinct from v2; target mismatch; a valid v2 head with stable definition key; already-v3 replay; unknown key; changed update timestamp; historical promotions remaining v2.

```ts
expect(decideProgressHeadMigration(validV2Head, v3Definitions)).toEqual({
  status: "migrate",
  studentId: "student-1",
  fromSystemId: "ibjjf-v2",
  toSystemId: "ibjjf-v3",
});
```

- [ ] **Step 2: Run seed/migration tests**

Run: `corepack pnpm exec vitest run apps/functions/src/levels/level-seed.test.ts apps/functions/src/levels/level-progress-migration.test.ts apps/functions/src/levels/level-service.test.ts`

Expected: FAIL because v3 loading/migration are absent.

- [ ] **Step 3: Implement guarded v3 loading and pure decisions**

Extend `loadApprovedLevelCatalog` to dispatch by exact system ID. Preserve production project checks and require a new literal confirmation for v3. The pure decision must never infer White Belt for a missing or unknown head.

- [ ] **Step 4: Implement transactional head updates and CLI**

Inside one transaction, re-read the head, verify academy/student/system/version, verify the v3 definition exists, update only `systemId`, `updatedAt`, `updatedBy` and migration metadata, append audit/receipt, and leave promotions untouched. CLI defaults to dry-run and masks student IDs in summary output.

- [ ] **Step 5: Run tests and emulator dry run**

Run: `corepack pnpm exec vitest run apps/functions/src/levels/level-seed.test.ts apps/functions/src/levels/level-progress-migration.test.ts apps/functions/src/levels/level-service.test.ts`

Run: `node --check apps/functions/scripts/migrate-level-progress.mjs`

Expected: PASS / exit 0. Do not run either CLI against production.

- [ ] **Step 6: Commit publication and head migration**

```bash
git add apps/functions/src/levels apps/functions/scripts apps/functions/package.json
git commit -m "Prepare guarded IBJJF v3 migration"
```

### Task 10: Verify catalogue-driven progress in backend and account widgets

**Files:**
- Modify: `packages/domain/src/levels/level-contracts.test.ts`
- Modify: `packages/domain/src/levels/level-progress.test.ts`
- Modify: `apps/functions/src/levels/level-service.test.ts`
- Modify: `apps/web/src/app/account/progress/own-progress.tsx`
- Modify: `apps/web/src/app/account/progress/family-progress.tsx`
- Modify: `apps/web/src/app/account/progress/page.test.tsx`
- Modify: `apps/web/src/app/admin/members/profile/ibjjf-card.test.tsx`

**Interfaces:**
- Consumes: v3 criteria returned by existing progress summaries.
- Produces: UI rendering that uses `criteria.classes.required` and `criteria.time.requiredDays`, with no local 20/60 constants.

- [ ] **Step 1: Add threshold and above-threshold tests**

```ts
expect(summary({ classes: 19, days: 60 }).criteria.overallEligible).toBe(false);
expect(summary({ classes: 20, days: 59 }).criteria.overallEligible).toBe(false);
expect(summary({ classes: 20, days: 60 }).criteria.overallEligible).toBe(true);
expect(summary({ classes: 21, days: 61 }).criteria.overallEligible).toBe(true);
```

Render own/family/admin widgets with required values from fixtures and assert `20 classes` / `60 days`, progress capping, and no equality regression.

- [ ] **Step 2: Run progress tests**

Run: `corepack pnpm exec vitest run packages/domain/src/levels/level-contracts.test.ts packages/domain/src/levels/level-progress.test.ts apps/functions/src/levels/level-service.test.ts apps/web/src/app/account/progress/page.test.tsx apps/web/src/app/admin/members/profile/ibjjf-card.test.tsx`

Expected: FAIL where v2 fixtures still assert 25/90.

- [ ] **Step 3: Update consumers/fixtures only where they hard-code old criteria**

Do not add a frontend criteria table. Read the service summary and adjust copy/fixtures so the same response drives own, family and admin views.

- [ ] **Step 4: Run progress tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit progress consumers**

```bash
git add packages/domain/src/levels apps/functions/src/levels/level-service.test.ts apps/web/src/app/account/progress apps/web/src/app/admin/members/profile/ibjjf-card.test.tsx
git commit -m "Use IBJJF v3 progress thresholds"
```

### Task 11: Add focused emulator-backed Playwright coverage

**Files:**
- Create: `qa/tests/member-data-foundation.spec.ts`
- Modify: `qa/tests/enrolment-payment-staff.spec.ts`
- Modify: `qa/tests/member-profile.spec.ts`
- Modify: `qa/tests/progress-auth-emulator.spec.ts`
- Modify: `qa/scripts/seed-enrolment-applicants-emulator.mjs`
- Modify: `qa/scripts/seed-member-profile-actors-emulator.mjs`
- Modify: `qa/scripts/seed-onboarding-emulator.mjs`

**Interfaces:**
- Consumes: Tasks 1–10 and existing emulator fixtures.
- Produces: tag `@member-data-foundation` covering approved browser journeys and role boundaries.

- [ ] **Step 1: Read the required Playwright references before editing tests**

Read completely:

- `.agents/skills/playwright-best-practices/core/test-suite-structure.md`
- `.agents/skills/playwright-best-practices/core/locators.md`
- `.agents/skills/playwright-best-practices/core/assertions-waiting.md`
- `.agents/skills/playwright-best-practices/frameworks/nextjs.md`
- `.agents/skills/playwright-best-practices/advanced/authentication.md`
- `.agents/skills/playwright-best-practices/advanced/multi-user.md`
- `.agents/skills/playwright-best-practices/testing-patterns/security-testing.md`

- [ ] **Step 2: Write the failing E2E story using accessible locators**

```ts
test("member data foundation @member-data-foundation", async ({ page }) => {
  await page.goto("/enrol");
  await expect(page.getByLabel(/^Address$/i)).toHaveCount(0);
  await page.getByLabel(/Full name/i).fill("Synthetic Member");
  await page.getByLabel(/Date of birth/i).fill("1990-01-01");
  await page.getByLabel(/Phone number/i).fill("+44 7700 900123");
  await page.getByLabel(/Training center/i).selectOption("West");
  await page.getByRole("button", { name: /Choose plans/i }).click();
  await expect(page.getByRole("heading", { name: /Choose.*plan/i })).toBeVisible();
});
```

Add authenticated admin assertions for no location controls and preserved Plan controls; member assertions for preferred venue/Membership link; progress fixtures for 19/59, 20/60 and 21/61; coach/API negative assertions for medical and reconciliation access.

- [ ] **Step 3: Build the web/functions artefacts needed by the emulator suite**

Run: `corepack pnpm --filter @bpt-jersey/domain build:runtime`

Run: `corepack pnpm --filter @bpt-jersey/functions build`

Run: `corepack pnpm --filter @bpt-jersey/web build`

Expected: each command exits 0. A compile failure is fixed only when caused by this delivery.

- [ ] **Step 4: Run the tagged Playwright test and verify the initial red state**

Run: `firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions "corepack pnpm --dir qa test:e2e --grep @member-data-foundation"`

Expected before final fixture/code alignment: at least one assertion fails for the old fields or v2 thresholds; no production connection is made.

- [ ] **Step 5: Finish synthetic fixtures and rerun the tagged suite**

Run the Step 4 command.

Expected: all `@member-data-foundation` tests PASS with zero retries required.

- [ ] **Step 6: Commit E2E coverage**

```bash
git add qa/tests/member-data-foundation.spec.ts qa/tests/enrolment-payment-staff.spec.ts qa/tests/member-profile.spec.ts qa/tests/progress-auth-emulator.spec.ts qa/scripts/seed-enrolment-applicants-emulator.mjs qa/scripts/seed-member-profile-actors-emulator.mjs qa/scripts/seed-onboarding-emulator.mjs
git commit -m "Cover member data foundation end to end"
```

### Task 12: Run requested verification, review scope and publish code to GitHub main

**Files:**
- Modify only files from Tasks 1–11 if verification exposes a regression caused by this delivery.
- Do not modify unrelated fixtures or restore automatic GitHub workflow triggers.

**Interfaces:**
- Consumes: complete delivery.
- Produces: fresh evidence, clean scoped diff, local/GitHub SHA equality.

- [ ] **Step 1: Run the full existing unit suites explicitly requested by the operator**

Run: `corepack pnpm test:unit`

Expected: all web/node Vitest projects PASS. Record exact file/test counts.

- [ ] **Step 2: Run targeted rules/security suites only where changed contracts require them**

Run: `corepack pnpm test:rules`

Expected: PASS when the emulator port is available. If the documented host port collision recurs, report it and run the rules project inside the repository's established isolated emulator environment; do not change rules merely to make the runner start.

- [ ] **Step 3: Rerun the complete relevant Playwright set**

Run: `firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,functions "corepack pnpm --dir qa test:e2e --grep '(member-data-foundation|registration|member profile|progress)'"`

Expected: PASS with synthetic data only. Record test/pass/skip counts.

- [ ] **Step 4: Run proportional static checks**

Run: `corepack pnpm --filter @bpt-jersey/domain typecheck`

Run: `corepack pnpm --filter @bpt-jersey/functions typecheck`

Run: `corepack pnpm --filter @bpt-jersey/web typecheck`

Run: `git diff --check origin/main...HEAD`

Expected: all exit 0.

- [ ] **Step 5: Review every spec requirement against the final diff**

Check explicitly: current/legacy field split; venue/plan retention; coach exclusions; canonical write uniqueness; masked/idempotent reconciliation; v2 immutability; v3 20/60; historical promotion preservation; no production action.

- [ ] **Step 6: Return any delivery-caused failure to its owning task**

Do not create a catch-all verification commit. Reopen the task that owns the failing behaviour, add the missing regression test there, complete its red-green cycle and make a new focused commit naming that behaviour. Leave unrelated pre-existing failures unchanged and report them with evidence.

- [ ] **Step 7: Push directly to origin/main and verify both SHAs**

```bash
git push origin main
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main
```

Expected: both SHA values are identical. Never place a PAT in chat, a command argument, a file or logs; Git's configured in-memory credential helper handles the interactive credential.

---

## Deferred production runbook

The implementation stops before production effects. A later operator-authorised run must separately:

1. Review a production membership-number dry-run artefact and its hash.
2. Approve/apply reconciliation and verify receipts.
3. Build and publish compatible Functions.
4. Seed `ibjjf-v3` with its exact production confirmation.
5. Review/apply the progress-head migration.
6. Publish the web application in a coordinated window.
7. Re-read representative synthetic/authorised records and compare audit receipts.

None of these steps is implied by approval of this implementation plan.
