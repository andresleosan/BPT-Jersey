# T033 Membership Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create tenant-scoped memberships linked to T032 plans and enforce the approved `trial`/`active`/`paused`/`overdue`/`cancelled` lifecycle without implementing payments or PAYG debt.

**Architecture:** Keep membership enums, record parsing, and the transition table pure in `packages/domain`. Store membership documents transactionally in Functions, checking same-tenant student/family/plan references and uniqueness of a current membership. Callable handlers apply Auth/role/family scope and safe errors; sensitive effective changes append typed audit events through the existing writer. Browser Firestore access remains denied.

**Tech Stack:** TypeScript, pnpm/Corepack, Vitest, Firebase Auth/Firestore Emulator, Cloud Functions v2 callables, Firestore transactions, existing append-only audit writer, ESLint, Prettier.

## Global Constraints

- T032 remains the only source of plan prices, eligibility, sites, limits, and Open Mat fees.
- Valid statuses are exactly `trial`, `active`, `paused`, `overdue`, and `cancelled`.
- Valid transitions are `trial -> active/cancelled`, `active -> paused/overdue/cancelled`, `paused -> active/cancelled`, `overdue -> active/cancelled`, and no transitions from `cancelled`.
- A student has at most one current membership in `trial`, `active`, `paused`, or `overdue`.
- `cancelled` documents remain as history; no hard delete or reactivation of a cancelled record.
- T033 does not create payments, invoices, receipts, balances, refunds, debt, checkout, webhooks, or provider calls.
- `academyId`, actor IDs, status result, timestamps, references, and envelope are server-owned.
- Firestore direct browser reads and writes remain denied by `firestore.rules`.
- Use Auth/tenant/family scope and exact payload allowlists; never log sensitive payloads.
- Tests use synthetic data and Emulator only; no production writes, migrations, deploys, new paid APIs, or commits.
- User-visible copy remains English; no purchase UI is added in T033.

## File Map

- Create `packages/domain/src/memberships/membership-contracts.ts`: statuses, transitions, record/draft types, parser, and transition evaluator.
- Create `packages/domain/src/memberships/membership-contracts.test.ts`: state machine and hostile-input tests.
- Modify `packages/domain/package.json`, `packages/domain/src/index.ts`, and `packages/domain/tsconfig.runtime.json` for the membership subpath/runtime.
- Modify `packages/domain/src/audit/audit-event.ts` and its tests: add typed `membership.created` and `membership.status.changed` common-only actions.
- Create `apps/functions/src/memberships/membership-service.ts`: Firestore abstraction, reference checks, current-membership uniqueness, transitions, and audit create integration.
- Create `apps/functions/src/memberships/membership-service.test.ts`: store transaction and authorization-context tests.
- Create `apps/functions/src/memberships/membership-callables.ts`: list/get/create/transition/cancel handlers and callable exports.
- Create `apps/functions/src/memberships/membership-callables.test.ts`: Auth, role, family scope, payload, and safe-error tests.
- Modify `apps/functions/src/index.ts`: export membership callables.
- Create `qa/integration/membership-adapters.test.ts`: Auth/Firestore Emulator lifecycle and audit evidence.
- Modify `qa/rules/client-data-boundary.test.ts`: add direct `memberships` denial cases without granting Rules access.
- Modify `docs/data/firestore-data-model.md`: document exact membership fields, states, references, audit, and ownership.
- Modify `tasks.md` and `Lista/Lista.js`: record evidence and move T033 to `revisión` only after final gates.

---

### Task 1: Domain Membership Contract And State Machine

**Files:**

- Create: `packages/domain/src/memberships/membership-contracts.test.ts`
- Create: `packages/domain/src/memberships/membership-contracts.ts`
- Modify: `packages/domain/package.json`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/tsconfig.runtime.json`

**Interfaces:**

- Produces `membershipStatuses`, `currentMembershipStatuses`, and `membershipTransitionTargets`.
- Produces `MembershipStatus`, `CurrentMembershipStatus`, `MembershipRecord`, `MembershipDraft`, `MembershipCreateInput`, and `MembershipTransitionInput`.
- Produces `parseMembershipRecord(value: unknown): Result<MembershipRecord, readonly ValidationIssue[]>`.
- Produces `parseMembershipDraft(value: unknown): Result<MembershipDraft, readonly ValidationIssue[]>`.
- Produces `canTransitionMembership(current: MembershipStatus, target: MembershipStatus): boolean`.

- [ ] **Step 1: Write failing tests.**

  Test exact statuses and transition table, terminal `cancelled`, same-state
  idempotency, valid/invalid ISO dates, safe IDs, exact fields, `schemaVersion`,
  null date fields, extra properties, symbols, accessors, hostile prototypes,
  and rejection of unknown statuses. Assert records contain no price, payment,
  debt, invoice, or plan-rule fields.

- [ ] **Step 2: Run RED.**

  ```bash
  corepack pnpm exec vitest run --project node packages/domain/src/memberships/membership-contracts.test.ts
  ```

  Expected: module-not-found failure before implementation.

- [ ] **Step 3: Implement the pure contract.**

  Use the existing `Result`/`ValidationIssue` and hostile-object patterns from
  T032. Model:

  ```ts
  type MembershipDraft = Readonly<{
    familyId: string;
    studentId: string;
    planId: PlanId;
    status: "trial" | "active";
    startsAt: string;
    endsAt: string | null;
    nextBillingAt: string | null;
  }>;
  type MembershipRecord = Omit<MembershipDraft, "status"> &
    Readonly<{
      membershipId: string;
      academyId: string;
      schemaVersion: "1";
      createdAt: string;
      createdBy: string;
      updatedAt: string;
      updatedBy: string;
      status: MembershipStatus;
    }>;
  ```

  Export the package subpath and include the runtime file. Freeze allowlists,
  arrays/outputs, and transition tables. Do not import payment or membership
  lifecycle logic from the legacy `members` import model.

- [ ] **Step 4: Run GREEN and domain gates.**

  ```bash
  corepack pnpm exec vitest run --project node packages/domain/src/memberships/membership-contracts.test.ts
  corepack pnpm --filter @bpt-jersey/domain typecheck
  corepack pnpm --filter @bpt-jersey/domain build:runtime
  corepack pnpm exec prettier --check packages/domain/src/memberships/membership-contracts.ts packages/domain/src/memberships/membership-contracts.test.ts packages/domain/package.json packages/domain/tsconfig.runtime.json
  ```

### Task 2: Typed Membership Audit Actions

**Files:**

- Modify: `packages/domain/src/audit/audit-event.ts`
- Modify: `packages/domain/src/audit/audit-event.test.ts`

**Interfaces:**

- Extends `auditActions` with `membership.created` and `membership.status.changed`.
- Extends `AuditEventDraft` with common-only variants for both actions.
- Keeps `appendAuditEventInTransaction` unchanged except for consuming the expanded typed union.

- [ ] **Step 1: Add RED tests.**

  Assert both actions parse with exact common fields, reject extra fields,
  tenant-mismatched `targetRef`, invalid IDs/purpose/correlation, symbols and
  accessors, and remain compatible with all existing audit actions.

- [ ] **Step 2: Run the audit tests and verify RED.**

  ```bash
  corepack pnpm exec vitest run --project node packages/domain/src/audit/audit-event.test.ts
  ```

- [ ] **Step 3: Add the two common-only action variants.**

  Extend `auditActions` and `fieldsByAction` without adding payload snapshots,
  prices, emails, phones, claims, tokens, or medical data. Keep `schemaVersion`,
  `result`, generated ID, and timestamp server-owned in the writer.

- [ ] **Step 4: Run audit/domain regression.**

  ```bash
  corepack pnpm exec vitest run --project node packages/domain/src/audit/audit-event.test.ts packages/domain/src
  corepack pnpm --filter @bpt-jersey/domain typecheck
  ```

### Task 3: Transactional Membership Store

**Files:**

- Create: `apps/functions/src/memberships/membership-service.test.ts`
- Create: `apps/functions/src/memberships/membership-service.ts`

**Interfaces:**

- Consumes T032 `PlanFirestore`/plan parsing and T033 domain contracts.
- Produces `MembershipFirestore`, `MembershipTransaction`, `MembershipStore`, `MembershipStoreError`, `CreateMembershipStoreInput`, and `TransitionMembershipStoreInput`.
- Produces `createMembershipStore(dependencies): MembershipStore`.
- `MembershipStore` exposes `listMemberships(scope)`, `getMembership(scope, membershipId)`, `createMembership(input)`, and `transitionMembership(input)`.

- [ ] **Step 1: Write failing store tests.**

  Cover create `trial`/`active`, same-tenant student/family/plan, inactive plan,
  family mismatch, unknown student, duplicate current membership, all valid
  transitions, invalid transitions, terminal cancellation, same-state retry,
  envelope preservation, tenant isolation, and append-only audit draft creation.

- [ ] **Step 2: Run RED.**

  ```bash
  corepack pnpm exec vitest run --project node apps/functions/src/memberships/membership-service.test.ts
  ```

- [ ] **Step 3: Implement read-before-write transactions.**

  Use `academies/${academyId}/memberships`, `students`, `families`, `plans`, and
  `relationships` references. Read all needed documents and current membership
  queries before any `create`/`set`. Verify the guardian relationship only in a
  callable-provided scope; the store itself must still enforce tenant and source
  record identity. For a status change, set `endsAt` to server `now` when
  cancelling and preserve all other immutable references. Create an audit ref
  under `academies/{academyId}/auditEvents/{generatedId}` and call the existing
  `appendAuditEventInTransaction` after the membership write is logically
  validated, using the same transaction object.

- [ ] **Step 4: Run store GREEN and Functions gates.**

  ```bash
  corepack pnpm exec vitest run --project node apps/functions/src/memberships/membership-service.test.ts
  corepack pnpm --filter @bpt-jersey/functions typecheck
  corepack pnpm exec prettier --check apps/functions/src/memberships/membership-service.ts apps/functions/src/memberships/membership-service.test.ts
  ```

### Task 4: Membership Callables And Scope

**Files:**

- Create: `apps/functions/src/memberships/membership-callables.test.ts`
- Create: `apps/functions/src/memberships/membership-callables.ts`
- Modify: `apps/functions/src/index.ts`

**Interfaces:**

- Consumes `MembershipStore`, T032 plan projections, `requireUserActor`, and existing family relationship lookup.
- Produces `listMemberships`, `getMembership`, `createMembership`, `transitionMembership`, and `cancelMembership` callables plus testable handlers of `(request: CallableRequest<unknown>, services: MembershipCallableServices) => Promise<unknown>`.

- [ ] **Step 1: Write failing callable tests.**

  Assert anonymous denial, owner/admin full scope, guardian only related family,
  adultStudent only own student, headCoach/coach denial, `trial` creation
  restriction for self-service, admin transition authorization, exact payloads,
  cross-tenant denial, safe errors, and no client-controlled status/actor/tenant.

- [ ] **Step 2: Run RED.**

  ```bash
  corepack pnpm exec vitest run --project node apps/functions/src/memberships/membership-callables.test.ts
  ```

- [ ] **Step 3: Implement handlers and exports.**

  Parse exact payloads with `Reflect.ownKeys`, reject hostile descriptors and
  authority fields, derive actor/tenant from `requireUserActor`, build a scope
  object for the store, and map `MembershipStoreError` to generic Firebase
  errors. `cancelMembership` must accept only `{ membershipId }` and delegate to
  the same transition path.

- [ ] **Step 4: Run GREEN and regression gates.**

  ```bash
  corepack pnpm exec vitest run --project node apps/functions/src/memberships/membership-callables.test.ts
  corepack pnpm --filter @bpt-jersey/functions typecheck
  corepack pnpm exec prettier --check apps/functions/src/memberships/membership-callables.ts apps/functions/src/memberships/membership-callables.test.ts apps/functions/src/index.ts
  ```

### Task 5: Emulator, Rules, And Audit Integration

**Files:**

- Create: `qa/integration/membership-adapters.test.ts`
- Modify: `qa/rules/client-data-boundary.test.ts`

- [ ] **Step 1: Write isolated Emulator tests.**

  Every test creates/cleans its own synthetic academies, users, family,
  student, plan reference, membership, and audit docs. Cover adult and guardian
  `trial` creation, admin `active` creation, every valid transition, invalid
  transition, cancellation terminality, cross-tenant denial, duplicate current
  membership, audit event shape, and absence of payments/invoices/debt.

- [ ] **Step 2: Add direct Rules denial.**

  Extend the existing matrix with `memberships` get/list/create/update/delete
  for anonymous, owner, administrator, headCoach, coach, guardian, and
  adultStudent. Do not add a Firestore client grant.

- [ ] **Step 3: Run isolated integration and Rules tests.**

  ```bash
  corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore,auth "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts qa/integration/membership-adapters.test.ts"
  corepack pnpm test:rules
  ```

  Run each integration test individually at least once to prove no order
  dependency. Expected: all tests pass with only expected permission-denied
  warnings from negative Rules cases.

### Task 6: Documentation, Gates, And Ledger

**Files:**

- Modify: `docs/data/firestore-data-model.md`
- Modify: `tasks.md`
- Modify: `Lista/Lista.js`

- [ ] **Step 1: Document the exact membership collection.**

  Add fields, references, status table, single-current invariant, tenant-scoped
  ownership, audit actions, soft cancellation, no hard delete, and T033/T037
  boundaries. State that direct Rules access remains denied and no compound index
  is added without a query owner/test.

- [ ] **Step 2: Run all gates and security review.**

  ```bash
  corepack pnpm test
  corepack pnpm test:rules
  corepack pnpm lint
  corepack pnpm typecheck
  corepack pnpm build
  corepack pnpm format:check
  corepack pnpm audit --audit-level high
  git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check
  ```

  Expected: zero test/lint/type/build/format/diff failures; audit has no
  high/critical findings. Record DR-001 moderates and the transversal rate-limit
  residual honestly; neither is a false production approval.

- [ ] **Step 3: Update ledger only after evidence.**

  Record exact counts and corrections in `tasks.md`, synchronize T033 in
  `Lista/Lista.js`, set T033 to `revisión`, and state no commits, migrations,
  production writes, deployments, payments, or debt were performed.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-19-t033-membership-lifecycle-plan.md`.

Execute with either:

1. **Subagent-Driven:** fresh implementer per task plus task review and final review.
2. **Inline:** execute with `executing-plans` and checkpoints.

The operator chooses the execution mode before implementation begins.
