# T032 Membership Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the ten approved BPT Jersey membership plans and expose validated, tenant-scoped catalog and eligibility operations without creating memberships, payments, invoices, or PAYG debt.

**Architecture:** Keep the immutable product vocabulary and pure eligibility function in `packages/domain`. Put Firestore reads, writes, idempotent catalog seeding, and projections in a Functions store. Put authentication, role checks, exact callable payloads, and safe public errors in a separate callable module. The browser has no direct Firestore path; Rules remain deny-by-default.

**Tech Stack:** TypeScript, pnpm/Corepack, Vitest, Firebase Auth/Firestore Emulator, Cloud Functions v2 callable handlers, Next.js/React existing workspace, Prettier, ESLint.

## Global Constraints

- Persist exactly the ten plan IDs approved in `BRIEF.md`; reject unknown plan IDs.
- Store prices as integer pence in `priceMinor` and always use `currency: "GBP"`; never use decimal or string money values.
- T032 does not create memberships, membership lifecycle states, invoices, receipts, balances, refunds, payments, or PAYG debt.
- Firestore direct browser reads and writes remain denied by `firestore.rules`.
- `academyId`, actor IDs, timestamps, envelope fields, and `schemaVersion` are server-owned.
- Do not create Auth users, custom claims, production writes, migrations, deployments, payment-provider calls, or new paid API usage.
- User-visible copy remains English; internal documentation and tests may be Spanish/English according to existing files.
- Use synthetic IDs and data only in tests and Emulator.
- No commit is performed in this session unless the operator explicitly requests one.

## File Map

- Create `packages/domain/src/memberships/plan-contracts.ts`: plan IDs, catalog seed, stored/draft types, parsers, and pure eligibility.
- Create `packages/domain/src/memberships/plan-contracts.test.ts`: hostile input, catalog, money, and eligibility tests.
- Modify `packages/domain/package.json`: export `@bpt-jersey/domain/memberships`.
- Modify `packages/domain/src/index.ts`: export the public membership contract surface.
- Create `apps/functions/src/memberships/plan-service.ts`: Firestore abstraction, store errors, CRUD/read projections, and idempotent seed.
- Create `apps/functions/src/memberships/plan-service.test.ts`: store and seed unit tests with fake Firestore/Auth-independent dependencies.
- Create `apps/functions/src/memberships/plan-callables.ts`: callable handlers, payload parsing, role checks, and safe error mapping.
- Create `apps/functions/src/memberships/plan-callables.test.ts`: callable authorization and payload tests.
- Modify `apps/functions/src/index.ts`: export catalog callables.
- Create `qa/integration/plan-adapters.test.ts`: Auth/Firestore Emulator coverage for the ten-plan catalog, tenant isolation, and idempotent seed.
- Modify `qa/rules/client-data-boundary.test.ts`: add `plans` direct-access deny cases while preserving all existing negative coverage.
- Modify `docs/data/firestore-data-model.md`: replace the generic `plans` row with the approved T032 contract and ownership/rollback notes.
- Modify `tasks.md` and `Lista/Lista.js`: record RED/GREEN, integration, security, and gate evidence; move T032 to `revisión` only after all evidence passes.

---

### Task 1: Domain Contract And Pure Eligibility

**Files:**

- Create: `packages/domain/src/memberships/plan-contracts.test.ts`
- Create: `packages/domain/src/memberships/plan-contracts.ts`
- Modify: `packages/domain/package.json`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Produces `planIds`, `participantTypes`, `billingPeriods`, `siteValues`, `sessionTypes`.
- Produces `PlanId`, `ParticipantType`, `BillingPeriod`, `Site`, `SessionType`, `PlanRecord`, `PlanDraft`, `PlanAccessInput`, `PlanAccessDecision`.
- Produces `PLAN_CATALOG: readonly PlanDraft[]` with exactly ten entries.
- Produces `parsePlanRecord(value: unknown): Result<PlanRecord, readonly ValidationIssue[]>`.
- Produces `parsePlanDraft(value: unknown): Result<PlanDraft, readonly ValidationIssue[]>`.
- Produces `evaluatePlanAccess(plan: PlanRecord, input: PlanAccessInput): PlanAccessDecision`.

- [ ] **Step 1: Write the failing domain tests.**

  Add tests for the exact ten plan IDs and approved values: `payg` 1000
  pence/session; `bpt-jersey-adult` 12500/month; West Kids 1x/2x 9500/11500;
  West Adult 6500; West Teens 4500 with 750 Open Mat; Town Adult 8500; Town
  Kids 1x/2x 9500/13500; and Town Teens 4500 with 750 Open Mat. Also assert:

  - `currency` is always `GBP`, price is an integer, and `billingPeriod` is closed.
  - Unknown IDs, duplicate arrays, invalid sites, decimal prices, extra fields,
    symbols, non-enumerable fields, non-plain prototypes, and invalid envelope
    fields are rejected.
  - `none`/empty participant arrays are rejected where the contract disallows them.
  - `evaluatePlanAccess` handles participant type, Town/West class access, weekly
    limits `1`/`2`/`null`, Open Mat site, 750-pence fee, and inactive plans.
  - The function never reads Firestore and never creates a membership/payment.

- [ ] **Step 2: Run the focused tests and verify RED.**

  Run:

  ```bash
  corepack pnpm exec vitest run --project node packages/domain/src/memberships/plan-contracts.test.ts
  ```

  Expected: failure because the membership contract module does not exist yet.

- [ ] **Step 3: Implement the minimal contract.**

  Model persisted plans as the exact envelope plus catalog fields:

  ```ts
  type PlanRecord = Readonly<{
    planId: PlanId;
    academyId: string;
    displayName: string;
    priceMinor: number;
    currency: "GBP";
    billingPeriod: BillingPeriod;
    eligibleParticipantTypes: readonly ParticipantType[];
    classSites: readonly Site[];
    weeklyClassLimit: 1 | 2 | null;
    openMatSites: readonly Site[];
    openMatFeeMinor: number | null;
    active: boolean;
    schemaVersion: "1";
    createdAt: string;
    createdBy: string;
    updatedAt: string;
    updatedBy: string;
  }>;
  ```

  Keep `PlanDraft` free of tenant and server envelope fields. Freeze allowlists,
  catalog entries, arrays, and returned values consistently with the family
  contracts. Use exact-field validation and the existing `Result`/`ValidationIssue`
  conventions. For `payg`, use both sites, `per-session`, no weekly limit, and
  `openMatFeeMinor: null` so Open Mat uses `priceMinor`. For monthly plans, use
  the exact approved site and Open Mat combinations from the spec.

- [ ] **Step 4: Run focused GREEN and domain gates.**

  Run:

  ```bash
  corepack pnpm exec vitest run --project node packages/domain/src/memberships/plan-contracts.test.ts
  corepack pnpm --filter @bpt-jersey/domain typecheck
  corepack pnpm exec prettier --check packages/domain/src/memberships/plan-contracts.ts packages/domain/src/memberships/plan-contracts.test.ts packages/domain/package.json
  ```

  Expected: focused tests, typecheck, and formatting pass.

### Task 2: Firestore Store And Idempotent Seed

**Files:**

- Create: `apps/functions/src/memberships/plan-service.test.ts`
- Create: `apps/functions/src/memberships/plan-service.ts`

**Interfaces:**

- Consumes `PlanRecord`, `PlanDraft`, `PLAN_CATALOG`, `parsePlanRecord`, and `parsePlanDraft` from `@bpt-jersey/domain/memberships`.
- Produces `PlanFirestore`, `PlanCollectionReference`, `PlanTransaction`, `PlanStore`, `PlanStoreError`.
- Produces `SavePlanInput`, `ActivatePlanInput`, `DeactivatePlanInput`, and `SeedPlanCatalogInput`.
- Produces `createPlanStore(dependencies: PlanStoreDependencies): PlanStore`.
- `PlanStore` exposes `listPlans(academyId: string): Promise<readonly PlanRecord[]>`,
  `getPlan(academyId: string, planId: PlanId): Promise<PlanRecord | undefined>`,
  `savePlan(input: SavePlanInput): Promise<PlanRecord>`,
  `activatePlan(input: ActivatePlanInput): Promise<PlanRecord>`,
  `deactivatePlan(input: DeactivatePlanInput): Promise<PlanRecord>`, and
  `seedPlanCatalog(input: SeedPlanCatalogInput): Promise<readonly PlanRecord[]>`.

  Use these input shapes so server-owned values stay outside client drafts:

  ```ts
  type SavePlanInput = Readonly<{
    academyId: string;
    actorId: string;
    now: string;
    draft: PlanDraft;
  }>;
  type DeactivatePlanInput = Readonly<{
    academyId: string;
    actorId: string;
    planId: PlanId;
    now: string;
  }>;
  type ActivatePlanInput = Readonly<{
    academyId: string;
    actorId: string;
    planId: PlanId;
    now: string;
  }>;
  type SeedPlanCatalogInput = Readonly<{
    academyId: string;
    actorId: string;
    now: string;
  }>;
  ```

- [ ] **Step 1: Write failing store tests.**

  Cover:

  - `listPlans` returns active plans in catalog order and tenant-scopes the collection path.
  - `getPlan` returns `undefined` only for a missing plan in the requested tenant.
  - `savePlan` creates a missing plan with server envelope and preserves the supplied fixed ID.
  - Updating a plan preserves `createdAt`/`createdBy` and changes only approved fields plus `updatedAt`/`updatedBy`.
  - `deactivatePlan` is idempotent and never deletes.
  - `activatePlan` is restricted to administrative callers, is repeat-safe, and preserves the envelope.
  - `seedPlanCatalog` creates all ten plans, then a second run creates no duplicate documents and preserves each envelope.
  - Stored invalid plans, cross-tenant IDs, invalid timestamps, and unknown plan IDs fail closed with `PlanStoreError`.

- [ ] **Step 2: Run the focused store tests and verify RED.**

  Run:

  ```bash
  corepack pnpm exec vitest run --project node apps/functions/src/memberships/plan-service.test.ts
  ```

  Expected: failure because the store module does not exist yet.

- [ ] **Step 3: Implement the tenant-scoped store.**

  Follow the existing family adapter shape. The minimum Firestore abstraction
  must support:

  ```ts
  type PlanFirestore = Readonly<{
    doc: (path: string) => PlanDocumentReference;
    collection: (path: string) => PlanCollectionReference;
    runTransaction: <T>(callback: (transaction: PlanTransaction) => Promise<T>) => Promise<T>;
  }>;
  ```

  Use `academies/${academyId}/plans`, safe path segments, real
  `collection().where("active", "==", true).limit(10)` queries, and transactions
  for create/update/deactivate/seed. Parse every document after reading it.
  Never accept `academyId`, actor fields, timestamps, envelope, or `schemaVersion`
  from a client input. Return a public projection without internal actors and
  timestamps for non-administrative callers.

- [ ] **Step 4: Run store GREEN and Functions typecheck.**

  Run:

  ```bash
  corepack pnpm exec vitest run --project node apps/functions/src/memberships/plan-service.test.ts
  corepack pnpm --filter @bpt-jersey/functions typecheck
  corepack pnpm exec prettier --check apps/functions/src/memberships/plan-service.ts apps/functions/src/memberships/plan-service.test.ts
  ```

  Expected: all focused tests, typecheck, and formatting pass.

### Task 3: Callable Authorization And Public API

**Files:**

- Create: `apps/functions/src/memberships/plan-callables.test.ts`
- Create: `apps/functions/src/memberships/plan-callables.ts`
- Modify: `apps/functions/src/index.ts`

**Interfaces:**

- Consumes `PlanStore`, `PlanStoreError`, and `requireUserActor`.
- Produces `listPlans`, `getPlan`, `savePlan`, `activatePlan`, and `deactivatePlan` Firebase callables.
- Produces testable handlers `listPlansHandler`, `getPlanHandler`, `savePlanHandler`, and `deactivatePlanHandler`, each with signature `(request: CallableRequest<unknown>, services: PlanCallableServices) => Promise<unknown>` and role-specific projection return types.
- `listPlans` returns active public plan projections; `getPlan` accepts `{ planId }`; `savePlan` accepts a fixed `planId` plus editable catalog fields; `activatePlan` and `deactivatePlan` accept `{ planId }`.

- [ ] **Step 1: Write failing callable tests.**

  Assert:

  - Anonymous requests fail with `unauthenticated`.
  - `owner` and `administrator` can list and manage only their own academy.
  - `guardian`, `adultStudent`, `headCoach`, and `coach` can list/get active plans but cannot mutate.
  - Inactive plans are not returned by public list/get handlers.
  - Payloads with `academyId`, actor, timestamps, envelope, `schemaVersion`, unknown fields, unknown IDs, decimals, or invalid arrays fail with `invalid-argument`.
  - Store errors map to safe public messages and do not expose paths, plan existence in another tenant, or internal exceptions.
  - Deactivation is a soft state change and repeated deactivation remains safe.

- [ ] **Step 2: Run focused callable tests and verify RED.**

  Run:

  ```bash
  corepack pnpm exec vitest run --project node apps/functions/src/memberships/plan-callables.test.ts
  ```

  Expected: failure because the callable module does not exist yet.

- [ ] **Step 3: Implement exact payload parsers and handlers.**

  Reuse the existing callable conventions: plain-record checks, `Reflect.ownKeys`
  exact fields, safe ID validation, `requireUserActor`, and generic `HttpsError`
  mapping. Keep the pure `evaluatePlanAccess` in the domain package; do not make
  an I/O callable for it in T032.

- [ ] **Step 4: Export callables and run GREEN.**

  Add the five exports to `apps/functions/src/index.ts`, then run:

  ```bash
  corepack pnpm exec vitest run --project node apps/functions/src/memberships/plan-callables.test.ts
  corepack pnpm --filter @bpt-jersey/functions typecheck
  corepack pnpm exec prettier --check apps/functions/src/memberships/plan-callables.ts apps/functions/src/memberships/plan-callables.test.ts apps/functions/src/index.ts
  ```

  Expected: focused callable tests, Functions typecheck, and formatting pass.

### Task 4: Emulator Integration And Direct-Access Boundary

**Files:**

- Create: `qa/integration/plan-adapters.test.ts`
- Modify: `qa/rules/client-data-boundary.test.ts`

**Interfaces:**

- Consumes the real `createPlanStore`, callable handlers, and Firebase Admin Auth/Firestore Emulator.
- Produces evidence that all ten plans persist, seed idempotently, remain tenant-scoped, and cannot be read or written directly by clients.

- [ ] **Step 1: Write the Emulator integration tests.**

  Use a unique synthetic run ID and two academy IDs. Test:

  - Owner seeds exactly ten plans and a second seed leaves exactly ten documents.
  - Public list returns only active plans in catalog order.
  - Admin correction preserves the original envelope.
  - Deactivation removes a plan from public projections without deleting it.
  - A plan in academy A is not visible through academy B, even with the same plan ID.
  - A non-admin cannot mutate through handlers.
  - No membership, invoice, payment, or debt document is created by any T032 operation.

- [ ] **Step 2: Extend the Rules boundary matrix.**

  Add `plans` documents to the direct Firestore read/list/create/update/delete
  matrix for anonymous, owner, administrator, headCoach, coach, guardian, and
  adultStudent. Keep the expected result denied for every operation; do not add
  a client allow rule.

- [ ] **Step 3: Run the Emulator tests and verify GREEN.**

  Run:

  ```bash
  corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore,auth "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts qa/integration/plan-adapters.test.ts"
  corepack pnpm test:rules
  ```

  Expected: integration assertions pass, the Rules suite remains green, and
  permission-denied warnings appear only as expected negative-test output.

### Task 5: Canonical Documentation And Contract Reconciliation

**Files:**

- Modify: `docs/data/firestore-data-model.md`
- Modify: `tasks.md`
- Modify: `Lista/Lista.js`

- [ ] **Step 1: Update the Firestore model.**

  Replace the generic `plans` row with the exact T032 fields, ten-plan ownership,
  integer-pence rule, active-only public projection, soft deactivation, no
  compound index, and the boundary to T033/T037. Document the seed rollback as
  staging/Emulator-only deactivation or removal, with no production migration.

- [ ] **Step 2: Record implementation evidence.**

  Keep T032 `en-progreso` until every test and gate passes. Record RED/GREEN
  commands, Emulator counts, Rules counts, full-suite results, security review,
  audit output, and the fact that no payments, migrations, production writes,
  deployments, or commits occurred. Only then set T032 to `revisión` and mirror
  the evidence in `Lista/Lista.js`.

- [ ] **Step 3: Verify documentation and diff hygiene.**

  Run:

  ```bash
  corepack pnpm exec prettier --check docs/data/firestore-data-model.md Lista/Lista.js
  git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check
  ```

  Expected: focused formatting and diff checks pass without modifying unrelated
  worktree changes.

### Task 6: Final Gates And Self-Critique

**Files:**

- Modify only files already listed above if a test or security finding requires a focused correction.
- Update `tasks.md` with final evidence.

- [ ] **Step 1: Run the complete test suite.**

  ```bash
  corepack pnpm test
  corepack pnpm test:rules
  ```

  Expected: zero failed test files and zero failed tests. Any failure returns to
  the relevant task; do not mark T032 as reviewed on partial evidence.

- [ ] **Step 2: Run quality and build gates.**

  ```bash
  corepack pnpm lint
  corepack pnpm typecheck
  corepack pnpm build
  corepack pnpm format:check
  git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check
  ```

  Expected: all commands exit zero. Existing warnings may be recorded only when
  they do not affect exit status and are not new T032 findings.

- [ ] **Step 3: Run the security baseline review.**

  Inspect changed domain, store, callables, integration, Rules, and docs for:
  - Auth/role/tenant checks before every callable and store operation.
  - Exact payload validation and no authority fields from the client.
  - No secrets, payment data, PII, internal paths, or raw errors in responses/logs.
  - Direct Firestore access still denied.
  - No new external integration, dependency, migration, production write, or cost.
  - Existing moderate dependency advisories remain only as the documented DR-001
    risk; any high/critical advisory blocks closure.

- [ ] **Step 4: Record final evidence and stop at review.**

  Update `tasks.md` and `Lista/Lista.js` with exact counts and commands. Leave
  T032 in `revisión` for operator approval; do not deploy, commit, or claim
  approval automatically.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-19-t032-membership-catalog-plan.md`.

Execution must use either:

1. **Subagent-Driven:** one isolated subagent per task with review checkpoints.
2. **Inline:** execute the tasks in this session with explicit checkpoints.

The operator must choose the execution mode before implementation begins.
