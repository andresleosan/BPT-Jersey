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

- [ ] **Step 1: Write RED tests**

Cover exact plain-object allowlists, same-tenant IDs, roles `headCoach` and `coach`, active/inactive states, local weekday/time windows, explicit timezone, assignment target types `location`, `program`, and `class`, duplicate targets, reversed windows, unknown fields, prototype pollution, and hostile getters.

- [ ] **Step 2: Run focused RED**

Run: `corepack pnpm exec vitest run --project node packages/domain/src/staff/staff-contracts.test.ts packages/domain/src/contracts.test.ts`

Expected: FAIL because the staff contracts and public exports do not exist.

- [ ] **Step 3: Implement minimal contracts**

Validate with the existing strict plain-object and immutable-output conventions. Require an explicit IANA timezone string in availability input, but do not choose its value. Keep server-owned IDs, timestamps, and actor fields outside client drafts.

- [ ] **Step 4: Verify GREEN and packaging**

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

- [ ] **Step 1: Write RED service tests**

Cover missing user, cross-tenant user, unsupported role, duplicate active staff for one user, unknown assignment target, overlapping invalid availability, inactive staff mutation, read-before-write transactions, idempotent retry, and create-only audit drafts without PII.

- [ ] **Step 2: Run focused RED**

Run: `corepack pnpm exec vitest run --project node apps/functions/src/staff/staff-service.test.ts`

Expected: FAIL because the staff service does not exist.

- [ ] **Step 3: Implement tenant-scoped transactional writes**

Read and validate all referenced `users`, `locations`, `programs`, and `classes` before the first write. Derive tenant, actor, IDs, timestamps, active state, and role claims input on the server. Preserve historical assignments by deactivating or replacing versioned records rather than deleting them.

- [ ] **Step 4: Verify service and packaging**

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

- [ ] **Step 1: Write RED callable tests**

Cover anonymous, cross-tenant, `guardian`, `adultStudent`, `coach`, and `headCoach` attempts; owner-only administrative grant/revoke; exact payload allowlists; generic public errors; no claims update before Firestore validation; and deactivation removing the non-administrative role signal.

- [ ] **Step 2: Run focused RED**

Run: `corepack pnpm exec vitest run --project node apps/functions/src/staff/staff-callables.test.ts`

Expected: FAIL because the staff callables do not exist.

- [ ] **Step 3: Implement authorization and idempotent claims sync**

Derive the actor and tenant from Auth. Permit owner/administrator management only where the existing authorization contract allows it, keep owner-only grant/revoke for administrative roles, and update claims only after the canonical staff transaction succeeds. Treat repeated synchronization as a no-op and do not log full claims or payloads.

- [ ] **Step 4: Verify callable behavior and regressions**

Run: `corepack pnpm exec vitest run --project node apps/functions/src/staff/staff-callables.test.ts apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/auth/user-authorization.test.ts` and `corepack pnpm --filter @bpt-jersey/functions typecheck`.

Expected: all authorization negatives remain fail-closed and no administrative provisioning boundary expands.

### Task 4: Verify Emulator, Rules, UI projection, and close T025

**Files:**
- Create: `qa/integration/staff-emulator.test.ts`
- Create: `apps/web/src/lib/staff-client.ts`
- Create: `apps/web/src/lib/staff-client.test.ts`
- Create: `apps/web/src/app/admin/staff/page.tsx`
- Create: `apps/web/src/app/admin/staff/page.test.tsx`
- Modify: `firestore.rules`
- Modify: `qa/rules/*.test.ts`
- Modify: `tasks.md`
- Modify: `Lista/Lista.js`

**Interfaces:**
- Consumes: the protected staff callables and safe staff projections.
- Produces: staff management UI with accessible errors and a documented T025 review gate.

- [ ] **Step 1: Write RED integration, Rules, and UI tests**

Cover Auth/Firestore Emulator creation, update, assignment replacement, deactivation, cross-tenant isolation, direct browser deny-by-default, owner/admin UI permissions, keyboard focus, generic errors, and desktop/mobile layout without horizontal overflow.

- [ ] **Step 2: Run focused RED**

Run the new unit, Rules, Emulator, and web tests individually and record the expected missing-contract failures before implementation.

- [ ] **Step 3: Implement the safe projection and UI**

Expose only fields needed for staff operations. Keep internal IDs, claim details, audit metadata, and unrelated family/health/finance data out of the browser projection.

- [ ] **Step 4: Run final gates**

Run: `corepack pnpm test`, `corepack pnpm test:rules`, `corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm build`, `corepack pnpm format:check`, `corepack pnpm audit --audit-level high`, and `git -c safe.directory='F:/Proyectos/BPT Jersey/Dev' diff --check`.

- [ ] **Step 5: Run security and record the WIP transition**

Confirm no client direct writes, no claim elevation, no PII/secrets in logs, no destructive delete, and no production operations. Only after all evidence is recorded may `T025` move to `revisión`; do not mark it `aprobada` without human approval.
