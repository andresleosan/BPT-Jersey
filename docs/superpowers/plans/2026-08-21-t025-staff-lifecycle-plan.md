# T025 Staff Lifecycle And Assignments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement tenant-scoped staff lifecycle, availability, assignments, and non-administrative role synchronization when T025 becomes the active WIP.

**Architecture:** `staff` is the canonical backend aggregate linked to an existing `users` record. Functions validate roles, tenant, assignment targets, availability windows, and lifecycle transitions; the browser receives projections only. Firestore remains deny-by-default for direct browser access, and Auth claims are a derived access signal rather than the source of staff authority.

**Tech Stack:** TypeScript, Zod/domain contracts, Firebase Cloud Functions, Firestore Emulator, Firebase Auth Emulator, Vitest, Security Rules tests.

## Global Constraints

- Do not start this plan while another P1 task owns WIP.
- Do not grant roles from the browser or trust client-provided tenant, actor, active state, or assignments.
- `owner` remains the only role allowed to grant or revoke administrative access.
- Do not assume a timezone, capacity, location, program, or class that remains open under `T008`.
- Do not add health, safeguarding, payment, retention, residency, or production behavior.
- Deactivation is soft and auditable; do not hard-delete staff, users, assignments, or audit history.

---

### Task 1: Define staff, availability, and assignment contracts

**Files:**
- Create: `packages/domain/src/staff/staff-contracts.ts`
- Create: `packages/domain/src/staff/staff-contracts.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/contracts.test.ts`

**Interfaces:**
- Consumes: existing identifiers, `UserRole`, `AcademyId`, and validation/result conventions.
- Produces: `StaffProfile`, `StaffRoleAssignment`, `StaffAvailabilityWindow`, `parseStaffProfile`, `parseStaffRoleAssignment`, and `parseStaffAvailabilityWindow`.

- [x] **Step 1: Write RED tests**

Cover exact plain-object allowlists, same-tenant IDs, roles `headCoach` and `coach`, active/inactive states, local weekday/time windows, explicit timezone, assignment target types `location`, `program`, and `class`, duplicate targets, reversed windows, unknown fields, prototype pollution, and hostile getters.

- [x] **Step 2: Run focused RED**

Run: `corepack pnpm exec vitest run --project node packages/domain/src/staff/staff-contracts.test.ts packages/domain/src/contracts.test.ts`

Expected: FAIL because the staff contracts and public exports do not exist.

- [x] **Step 3: Implement minimal contracts**

Validate with the existing strict plain-object and immutable-output conventions. Require an explicit IANA timezone string in availability input, but do not choose its value. Keep server-owned IDs, timestamps, and actor fields outside client drafts.

- [x] **Step 4: Verify GREEN and packaging**

Run: `corepack pnpm exec vitest run --project node packages/domain/src/staff/staff-contracts.test.ts packages/domain/src/contracts.test.ts`, `corepack pnpm --filter @bpt-jersey/domain typecheck`, and `corepack pnpm --filter @bpt-jersey/domain build:runtime`.

Expected: focused contracts pass and the runtime package exports no workspace-only imports.

### Task 2: Implement the staff Firestore service

**Files:**
- Create: `apps/functions/src/staff/staff-service.ts`
- Create: `apps/functions/src/staff/staff-service.test.ts`
- Modify: `apps/functions/src/deploy-runtime.ts`
- Modify: `apps/functions/src/deploy-runtime.test.ts`

**Interfaces:**
- Consumes: the Task 1 parsers, existing authenticated actor context, Firestore transaction adapters, and the canonical `users` record.
- Produces: `createStaffProfile`, `updateStaffProfile`, `setStaffActive`, `replaceStaffAvailability`, and `replaceStaffAssignments` service operations.

- [x] **Step 1: Write RED service tests**

Cover missing user, cross-tenant user, unsupported role, duplicate active staff for one user, unknown assignment target, overlapping invalid availability, inactive staff mutation, read-before-write transactions, idempotent retry, and create-only audit drafts without PII.

- [x] **Step 2: Run focused RED**

Run: `corepack pnpm exec vitest run --project node apps/functions/src/staff/staff-service.test.ts`

Expected: FAIL because the staff service does not exist.

- [x] **Step 3: Implement tenant-scoped transactional writes**

Read and validate all referenced `users`, `locations`, `programs`, and `classes` before the first write. Derive tenant, actor, IDs, timestamps, active state, and role claims input on the server. Preserve historical assignments by deactivating or replacing versioned records rather than deleting them.

- [x] **Step 4: Verify service and packaging**

Run: `corepack pnpm exec vitest run --project node apps/functions/src/staff/staff-service.test.ts apps/functions/src/deploy-runtime.test.ts` and `corepack pnpm --filter @bpt-jersey/functions typecheck`.

Expected: service tests and portable runtime packaging pass.

### Task 3: Add callable authorization and role synchronization

**Files:**
- Create: `apps/functions/src/staff/staff-callables.ts`
- Create: `apps/functions/src/staff/staff-callables.test.ts`
- Modify: `apps/functions/src/index.ts`

**Interfaces:**
- Consumes: staff service operations, `requireAdminActor`, the strict six-role claims parser, and Auth Admin SDK claim updates.
- Produces: protected callables for staff management and a fail-closed synchronization path for `headCoach`/`coach` claims.

- [x] **Step 1: Write RED callable tests**

Cover anonymous, cross-tenant, `guardian`, `adultStudent`, `coach`, and `headCoach` attempts; owner-only administrative grant/revoke; exact payload allowlists; generic public errors; no claims update before Firestore validation; and deactivation removing the non-administrative role signal.

- [x] **Step 2: Run focused RED**

Run: `corepack pnpm exec vitest run --project node apps/functions/src/staff/staff-callables.test.ts`

Expected: FAIL because the staff callables do not exist.

- [x] **Step 3: Implement authorization and idempotent claims sync**

Derive the actor and tenant from Auth. Permit owner/administrator management only where the existing authorization contract allows it, keep owner-only grant/revoke for administrative roles, and update claims only after the canonical staff transaction succeeds. Treat repeated synchronization as a no-op and do not log full claims or payloads.

- [x] **Step 4: Verify callable behavior and regressions**

Run: `corepack pnpm exec vitest run --project node apps/functions/src/staff/staff-callables.test.ts apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/auth/user-authorization.test.ts` and `corepack pnpm --filter @bpt-jersey/functions typecheck`.

Expected: all authorization negatives remain fail-closed and no administrative provisioning boundary expands.

### Task 4A: Verify staff Rules and the Firestore Emulator

**Files:**
- Create: `qa/integration/staff-emulator.test.ts`
- Modify: `firestore.rules`
- Create: `qa/rules/staff-data-boundary.test.ts`

**Interfaces:**
- Consumes: `createStaffStore`, the existing Firebase Admin emulator adapter, and the current deny-by-default Rules harness.
- Produces: verified direct-client denial and an emulator-backed staff lifecycle regression without production writes.

- [x] **Step 1: Write the Rules characterization tests**

Add `qa/rules/staff-data-boundary.test.ts` using `initializeTestEnvironment`, `assertFails`, and the existing emulator ports. Assert that unauthenticated, client, coach, owner, and administrator contexts cannot read or write:

```text
academies/{academyId}/staff/{staffId}
academies/{academyId}/staffAvailability/{windowId}
academies/{academyId}/staffAssignments/{assignmentId}
academies/{academyId}/adminRoleLocks/{uid}
```

Include a second academy in the fixture and assert that an authenticated administrator cannot access either academy through a direct Firestore client. These tests are expected to pass against the existing catch-all deny; they characterize the boundary before explicit staff matches are added.

- [x] **Step 2: Run the Rules characterization test**

Run: `corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only auth,firestore,database "corepack pnpm exec vitest run --project rules qa/rules/staff-data-boundary.test.ts"`

Expected: the new test passes because the existing catch-all deny already blocks direct access; existing default-deny tests remain unchanged.

- [x] **Step 3: Add explicit staff deny matches**

Add explicit `allow read, write: if false` matches for staff profiles, availability, assignments, and administrative role locks before the existing catch-all deny. Do not add a positive client rule, query exception, migration, or index.

- [x] **Step 4: Run the Rules GREEN test**

Run: `corepack pnpm test:rules`

Expected: all Rules suites pass, including the new staff boundary suite, with no authenticated direct client access.

- [x] **Step 5: Write the Emulator lifecycle regression test**

Create `qa/integration/staff-emulator.test.ts` following `qa/integration/profile-adapters.test.ts`: initialize a uniquely named Admin app against `FIRESTORE_EMULATOR_HOST`, create two academy users and valid location/program/class targets, and exercise the real `createStaffStore` against the local Firestore emulator. Assert creation, idempotent `requestId`, role update, replacement of availability and assignments, deactivation, derived-record revocation, audit actions without PII, and cross-tenant rejection.

- [x] **Step 6: Run the Emulator lifecycle regression**

Run: `corepack pnpm exec vitest run --config qa/integration/vitest.config.ts qa/integration/staff-emulator.test.ts`

Expected: the test exercises the existing service behavior against the emulator; it must skip safely with an explicit message when `FIRESTORE_EMULATOR_HOST` is absent rather than connecting to a non-local endpoint.

- [x] **Step 7: Run the Emulator GREEN test and gate**

Run with the local emulator active: `corepack pnpm exec vitest run --config qa/integration/vitest.config.ts qa/integration/staff-emulator.test.ts` and `corepack pnpm --filter @bpt-jersey/functions typecheck`.

Expected: lifecycle and isolation pass against the emulator; no production credentials, endpoints, or data are used.

### Task 4B: Add the safe staff projection and web client

**Files:**
- Modify: `apps/functions/src/staff/staff-service.ts`
- Modify: `apps/functions/src/staff/staff-callables.ts`
- Modify: `apps/functions/src/index.ts`
- Modify: `apps/functions/src/staff/staff-service.test.ts`
- Modify: `apps/functions/src/staff/staff-callables.test.ts`
- Create: `apps/web/src/lib/staff-client.ts`
- Create: `apps/web/src/lib/staff-client.test.ts`

**Interfaces:**
- Consumes: tenant-scoped `StaffStore`, `requireAdminActor`, and the shared role lock.
- Produces: `listStaffProfiles` callable returning `Readonly<{ staffKey: string; role: "headCoach" | "coach"; active: boolean; status: "active" | "inactive"; schemaVersion: "1" }>[]`, plus strict client methods for listing and existing mutations. Browser mutation payloads use `staffKey`; the callable parser maps it to the validated store `staffId` without exposing Auth UID or Firestore paths.

- [x] **Step 1: Write the failing list-store and callable tests**

Cover a same-tenant list, empty result, cross-tenant exclusion, malformed stored document rejection, anonymous/non-admin denial, exact empty payload rejection, and a response that contains no `userId`, claims, audit fields, Firestore paths, or unrelated fields.

- [x] **Step 2: Run focused RED**

Run: `corepack pnpm exec vitest run --project node apps/functions/src/staff/staff-service.test.ts apps/functions/src/staff/staff-callables.test.ts`

Expected: the new list tests fail because the store/list callable and safe projection do not exist.

- [x] **Step 3: Implement tenant-scoped list and projection**

Add a bounded `listStaffProfiles(academyId)` store method with `MAX_STAFF_LIST_RECORDS = 100` that reads only the academy staff collection, validates every returned `StaffProfile`, sorts deterministically by `staffId`, and maps each profile to the minimal safe projection. Keep `staffKey` as the existing hash identifier; never return `userId`, raw documents, claims, audit IDs, timestamps, or paths.

Add `listStaffProfiles` to the callable module and root exports. Require `owner` or `administrator`, accept `{}` only, map store errors to existing generic codes, and do not add any Auth claim mutation to the read path.

Add `staff-client.ts` with strict runtime validators, exact callable payloads, generic error constants, and exported typed methods for list/create/update/activation/availability/assignments. Reject extra response fields before React sees them.

- [x] **Step 4: Run the projection GREEN tests**

Run: `corepack pnpm exec vitest run --project node apps/functions/src/staff/staff-service.test.ts apps/functions/src/staff/staff-callables.test.ts apps/web/src/lib/staff-client.test.ts` and `corepack pnpm --filter @bpt-jersey/functions typecheck`.

Expected: all staff service/callable/client tests pass and no existing authorization regression appears.

### Task 4C: Build the staff administration UI and E2E coverage

**Files:**
- Create: `apps/web/src/app/admin/staff/page.tsx`
- Create: `apps/web/src/app/admin/staff/page.test.tsx`
- Modify: `apps/web/src/app/admin/admin-shell.tsx`
- Modify: `apps/web/src/app/admin/admin.css`
- Create: `qa/tests/staff-management.spec.ts`

**Interfaces:**
- Consumes: `listStaffProfiles` and the typed methods in `staff-client.ts`.
- Produces: `/admin/staff` with accessible listing and lifecycle controls, without direct Firebase client database access.

- [x] **Step 1: Write the failing web tests**

Cover loading, empty and generic error states; safe role/status rendering; create/update/deactivate actions; accessible labels; keyboard focus after an action; owner and administrator visibility; and no rendering of Auth UID, claims, audit data, Firestore paths, or hidden response fields.

- [x] **Step 2: Run focused web RED**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/staff/page.test.tsx apps/web/src/lib/staff-client.test.ts`

Expected: the new route/component tests fail because the page, navigation entry, and client module do not exist.

- [x] **Step 3: Implement the page using existing admin patterns**

Add a staff navigation item, a responsive table based on `AdminDataTable`, explicit loading/empty/error states, and forms for creation, role update, activation/deactivation, availability windows, and assignments. Send only validated editable fields; derive academy and actor exclusively on the server. Keep action controls disabled during pending mutations and restore focus to the triggering row.

- [x] **Step 4: Run web GREEN and lint checks**

Run: `corepack pnpm exec vitest run --project web apps/web/src/app/admin/staff/page.test.tsx apps/web/src/lib/staff-client.test.ts`, `corepack pnpm lint`, and `corepack pnpm typecheck`.

Expected: focused web tests and workspace static checks pass.

- [x] **Step 5: Write and run Playwright coverage**

Add `qa/tests/staff-management.spec.ts` covering authenticated owner and administrator access, denied non-admin access, list rendering, generic backend error, keyboard navigation, and horizontal overflow at desktop and Pixel 7 viewports. Run: `corepack pnpm test:e2e -- --grep staff-management` with the local web app and Firebase emulators active.

Expected: all staff scenarios pass without console errors, direct Firestore access, or leaked internal fields.

### Task 4D: Close T025 for human review

**Files:**
- Modify: `docs/superpowers/plans/2026-08-21-t025-staff-lifecycle-plan.md`
- Modify: `tasks.md`
- Modify: `Lista/Lista.js`

- [x] **Step 1: Run final gates**

Run: `corepack pnpm test`, `corepack pnpm test:rules`, `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm build`, `corepack pnpm format:check`, and `corepack pnpm audit --audit-level high`.

Expected: all gates pass; existing moderate transitive audit findings may remain documented, but high/critical findings block closure.

- [x] **Step 2: Run the security review**

Inspect the changed files for authentication/authorization, tenant derivation, direct client writes, response allowlists, logs, secrets, claims elevation, destructive deletion, and emulator-only boundaries. Confirm no production operation or migration occurred.

- [x] **Step 3: Record evidence and move T025 to review**

Record exact test counts, emulator/rules results, static checks, audit residuals, and the explicit fact that T025 is in `revisión` and not `aprobada`. Synchronize the same status in `Lista/Lista.js`.
