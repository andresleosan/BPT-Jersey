# T038 Financial Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement a reusable, fail-closed financial access decision that combines membership status with derived PAYG debt without writing bookings or changing membership records.

**Architecture:** `packages/domain` owns the pure `evaluateFinancialAccess` policy and its immutable discriminated decision. `apps/functions` owns a read-only service that obtains a validated membership through `MembershipStore`, obtains the student's derived `paygDebtMinor` through `FinanceStore`, and applies the policy. Firebase Emulator integration proves that debt blocks access before settlement and restores it after a manual payment.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Firebase Admin Firestore, Firebase Emulator Suite, existing membership and finance stores.

## Global Constraints

- Firestore remains canonical under `academies/{academyId}`.
- No `balances`, `debts`, restrictions, or access-decision collection is created.
- The decision is computed from validated membership data and the T037 financial projection.
- Tenant and student scope are checked before any financial data is used.
- The policy accepts no free-form reason, actor claims, client-owned status, or payment payload.
- No automatic membership transition, payment write, audit event, migration, deployment, production write, provider call, or new paid service.
- No callable or UI is added; existing authorized financial reads remain the user-facing path.
- `trial` and `active` with zero PAYG debt return `ALLOWED`.
- `trial` and `active` with positive PAYG debt return `PAYG_DEBT_OUTSTANDING`.
- `paused`, `overdue`, and `cancelled` return `MEMBERSHIP_NOT_ACCESSIBLE` regardless of debt.
- Invalid policy input returns `INVALID_INPUT` and is never treated as zero debt.
- T027 owns booking writes and will consume this service later.
- All new production behavior follows TDD: failing test first, expected RED run, minimal GREEN implementation, then refactor while green.

---

## File Map

- Create `packages/domain/src/finance/financial-access.test.ts`: pure policy tests, hostile input tests, and immutable decision assertions.
- Create `packages/domain/src/finance/financial-access.ts`: exact access input, decision types, validation, and `evaluateFinancialAccess`.
- Modify `packages/domain/src/index.ts`: export the policy and its types from the domain root.
- Modify `packages/domain/package.json`: publish `@bpt-jersey/domain/finance/access`.
- Modify `packages/domain/tsconfig.runtime.json`: include the policy in the portable runtime build.
- Create `apps/functions/src/finance/financial-access-service.test.ts`: service tests with read-only store doubles.
- Create `apps/functions/src/finance/financial-access-service.ts`: validated composition of membership and finance stores.
- Create `qa/integration/financial-access.test.ts`: Firestore Emulator test for debt restriction and recovery.
- Modify `tasks.md`: register T038 implementation evidence and move it to `en-progreso` before code, then `revisión` only after all gates.
- Modify `Lista/Lista.js`: mirror the exact T038 ledger state and evidence after `tasks.md`.

---

### Task 0: Register T038 In Progress

**Files:**

- Modify: `tasks.md` at the T038 row and the T038 evidence section.
- Modify: `Lista/Lista.js` at the generated T038 entry.

**Interfaces:**

- Consumes: approved spec `docs/superpowers/specs/2026-08-19-t038-financial-access-design.md`.
- Produces: persistent ledger state showing T038 is active before code changes.

- [ ] **Step 1: Update the ledger before touching production code**

Change T038 from `pendiente` to `en-progreso`. Record the approved scope, the plan path, the explicit non-goals, and the first next action: write the failing domain policy tests. Keep T037 as `revisión`; do not mark it `aprobada` implicitly.

- [ ] **Step 2: Mirror the state in `Lista/Lista.js`**

Update only the T038 entry so the visible task list matches `tasks.md`; do not invent a second status or evidence format.

- [ ] **Step 3: Verify the ledger diff**

Run:

```powershell
git diff --check -- tasks.md Lista/Lista.js
```

Expected: exit code `0` and no whitespace errors. Do not commit this task alone; include the ledger start with the first implementation commit if the execution workflow uses commits per task.

---

### Task 1: Pure Financial Access Policy

**Files:**

- Create: `packages/domain/src/finance/financial-access.test.ts`
- Create: `packages/domain/src/finance/financial-access.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/package.json`
- Modify: `packages/domain/tsconfig.runtime.json`

**Interfaces:**

- Consumes: `MembershipStatus` from `packages/domain/src/memberships/membership-contracts.ts`.
- Produces: `evaluateFinancialAccess(input: unknown): FinancialAccessDecision` and the exported `FinancialAccessInput`, `FinancialAccessDecision`, and `FinancialAccessDenialCode` types.

The public subpath is `@bpt-jersey/domain/finance/access`, while the domain root also re-exports the policy for source consumers. Keep the existing `@bpt-jersey/domain/finance` contract export unchanged.

- [ ] **Step 1: Write the failing domain tests**

Create test fixtures and assert the following behavior:

```ts
const allowed = evaluateFinancialAccess({ membershipStatus: "active", paygDebtMinor: 0 });
expect(allowed).toEqual({
  allowed: true,
  code: "ALLOWED",
  membershipStatus: "active",
  paygDebtMinor: 0,
});

expect(evaluateFinancialAccess({ membershipStatus: "trial", paygDebtMinor: 1000 })).toMatchObject({
  allowed: false,
  code: "PAYG_DEBT_OUTSTANDING",
});

for (const membershipStatus of ["paused", "overdue", "cancelled"] as const) {
  expect(evaluateFinancialAccess({ membershipStatus, paygDebtMinor: 0 })).toMatchObject({
    allowed: false,
    code: "MEMBERSHIP_NOT_ACCESSIBLE",
  });
}
```

Also cover positive debt for inaccessible statuses, negative/fractional/unsafe debt, unknown status, `null`, arrays, extra fields, accessors, non-enumerable fields, and hostile prototypes. Invalid input must return `{ allowed: false, code: "INVALID_INPUT", membershipStatus: null, paygDebtMinor: 0 }`. Assert the returned decision cannot be mutated.

- [ ] **Step 2: Run RED and verify the failure is correct**

Run:

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/finance/financial-access.test.ts
```

Expected: the test fails because `./financial-access` and its exports do not exist. If it fails from a test syntax error or configuration issue, fix the test and rerun until the failure is specifically the missing policy.

- [ ] **Step 3: Implement the minimum policy**

Implement an exact-field parser in `financial-access.ts` using the domain's existing plain-object and descriptor-validation conventions. Return frozen decisions. Use this decision shape:

```ts
export type FinancialAccessDenialCode =
  | "INVALID_INPUT"
  | "PAYG_DEBT_OUTSTANDING"
  | "MEMBERSHIP_NOT_ACCESSIBLE";

export type FinancialAccessDecision =
  | Readonly<{
      allowed: true;
      code: "ALLOWED";
      membershipStatus: MembershipStatus;
      paygDebtMinor: number;
    }>
  | Readonly<{
      allowed: false;
      code: FinancialAccessDenialCode;
      membershipStatus: MembershipStatus | null;
      paygDebtMinor: number;
    }>;

export function evaluateFinancialAccess(input: unknown): FinancialAccessDecision;
```

Return `INVALID_INPUT` before applying access rules. For valid input, apply membership status first, then debt. Do not import Firestore, Auth, Functions, or payment records into the domain module.

- [ ] **Step 4: Publish the runtime subpath**

Add this package export without changing the existing finance contract export:

```json
"./finance/access": {
  "types": "./src/finance/financial-access.ts",
  "default": "./lib/finance/financial-access.js"
}
```

Add `src/finance/financial-access.ts` to `tsconfig.runtime.json`, and re-export the policy/types from `packages/domain/src/index.ts`.

- [ ] **Step 5: Run GREEN and package checks**

Run:

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/finance/financial-access.test.ts
corepack pnpm --filter @bpt-jersey/domain typecheck
corepack pnpm --filter @bpt-jersey/domain build:runtime
```

Expected: all policy tests pass, the domain typecheck passes, and the runtime build emits `lib/finance/financial-access.js` without workspace imports.

- [ ] **Step 6: Commit the completed domain unit**

```powershell
git add packages/domain/src/finance/financial-access.ts packages/domain/src/finance/financial-access.test.ts packages/domain/src/index.ts packages/domain/package.json packages/domain/tsconfig.runtime.json tasks.md Lista/Lista.js
git commit -m "feat: add financial access policy"
```

---

### Task 2: Read-Only Financial Access Service

**Files:**

- Create: `apps/functions/src/finance/financial-access-service.test.ts`
- Create: `apps/functions/src/finance/financial-access-service.ts`

**Interfaces:**

- Consumes: `MembershipStore.getMembership` and `FinanceStore.listFinancialAccount`.
- Produces: `createFinancialAccessService`, `FinancialAccessService`, `FinancialAccessServiceInput`, `FinancialAccessView`, and `FinancialAccessServiceError` for T027.

Use these exact service contracts:

```ts
export type FinancialAccessServiceInput = Readonly<{
  academyId: string;
  membershipId: string;
}>;

export type FinancialAccessView = Readonly<{
  academyId: string;
  membershipId: string;
  studentId: string;
  membershipStatus: MembershipStatus;
  paygDebtMinor: number;
  decision: FinancialAccessDecision;
}>;

export type FinancialAccessServiceDependencies = Readonly<{
  getMembership: MembershipStore["getMembership"];
  listFinancialAccount: FinanceStore["listFinancialAccount"];
}>;

export type FinancialAccessService = Readonly<{
  getAccessDecision: (input: FinancialAccessServiceInput) => Promise<FinancialAccessView>;
}>;
```

`FinancialAccessServiceError.code` is one of `"invalid" | "not-found" | "tenant" | "transaction"`. Error messages are stable and generic; no invoice or family existence is disclosed.

- [ ] **Step 1: Write the failing service tests**

Create read-only store doubles. Verify the service calls membership first and passes exactly the stored membership scope to finance:

```ts
const getMembership = vi.fn().mockResolvedValue(membership({ status: "active" }));
const listFinancialAccount = vi.fn().mockResolvedValue({
  invoices: [],
  balanceMinor: 0,
  paygDebtMinor: 0,
});
const service = createFinancialAccessService({ getMembership, listFinancialAccount });

await expect(service.getAccessDecision({ academyId, membershipId })).resolves.toMatchObject({
  membershipId,
  studentId,
  membershipStatus: "active",
  paygDebtMinor: 0,
  decision: { allowed: true, code: "ALLOWED" },
});
expect(getMembership).toHaveBeenCalledWith(
  { academyId, membershipIds: [membershipId] },
  membershipId,
);
expect(listFinancialAccount).toHaveBeenCalledWith({
  academyId,
  familyIds: [familyId],
  studentIds: [studentId],
});
```

Add tests for `PAYG_DEBT_OUTSTANDING`, all inaccessible membership states, debt recovery after the finance double changes from positive to zero, invalid identifiers, missing membership, tenant mismatch, malformed financial result, wrapped dependency failure, and no write-capable dependency being accepted.

- [ ] **Step 2: Run RED and verify the failure is correct**

Run:

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/finance/financial-access-service.test.ts
```

Expected: failure because `financial-access-service.ts` does not exist. Correct any test setup errors before implementation.

- [ ] **Step 3: Implement the minimal composition service**

Validate `academyId` and `membershipId` with the existing safe path-segment convention. Call:

```ts
const membership = await dependencies.getMembership(
  { academyId, membershipIds: [membershipId] },
  membershipId,
);
```

If it returns `undefined`, throw `FinancialAccessServiceError("not-found", "Financial access is not available")`. Verify `membership.academyId` and `membership.membershipId` before using its `familyId` and `studentId`. Then call:

```ts
const account = await dependencies.listFinancialAccount({
  academyId,
  familyIds: [membership.familyId],
  studentIds: [membership.studentId],
});
```

Apply `evaluateFinancialAccess({ membershipStatus: membership.status, paygDebtMinor: account.paygDebtMinor })`, freeze the view, and return it. Wrap unknown dependency failures as `transaction`; preserve known service errors. Never issue a write or read a client-provided family/student/debt value.

- [ ] **Step 4: Run GREEN and regression checks**

Run:

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/finance/financial-access-service.test.ts packages/domain/src/finance/financial-access.test.ts
corepack pnpm --filter @bpt-jersey/functions typecheck
```

Expected: focused service/domain tests pass and Functions typecheck resolves `@bpt-jersey/domain/finance/access`.

- [ ] **Step 5: Commit the completed service unit**

```powershell
git add apps/functions/src/finance/financial-access-service.ts apps/functions/src/finance/financial-access-service.test.ts
git commit -m "feat: add financial access service"
```

---

### Task 3: Firestore Emulator Restriction and Recovery

**Files:**

- Create: `qa/integration/financial-access.test.ts`

**Interfaces:**

- Consumes: `createMembershipStore`, `createFinanceStore`, and `createFinancialAccessService`.
- Produces: Emulator evidence that the derived debt, not a persisted restriction, controls the decision.

- [ ] **Step 1: Create isolated synthetic Emulator fixtures**

Use a unique `runId` and seed only `demo-bpt-jersey` Firestore documents required by the validated membership store: active academy family, active student, active family relationship, active plan, and an active membership. Create a PAYG invoice through `createFinanceStore.issuePaygInvoice` with a validated source reference under the same academy and membership.

- [ ] **Step 2: Validate Emulator connectivity before adding assertions**

Run the new file through the project integration config:

```powershell
corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts qa/integration/financial-access.test.ts"
```

Expected: the file loads against the Emulator and the synthetic fixture setup completes; this step isolates Emulator connectivity before the restriction and recovery assertions are added.

- [ ] **Step 3: Verify restriction before settlement**

Call `getAccessDecision({ academyId, membershipId })` and assert `PAYG_DEBT_OUTSTANDING`, the expected debt amount, and unchanged membership status. Assert no document exists under `debts`, `balances`, `restrictions`, or `financialAccess`.

- [ ] **Step 4: Settle the debt and verify recovery**

Record one manual payment for the full PAYG invoice amount through the existing finance store, call the access service again, and assert `ALLOWED` with `paygDebtMinor: 0`. Read the membership document and assert its status is still `active`. Repeat the read once to prove the result is derived and stable.

- [ ] **Step 5: Verify tenant isolation**

Request the same membership ID with a different academy ID and assert `FinancialAccessServiceError` with a safe code. Do not assert or print raw Firestore payloads in failure output.

- [ ] **Step 6: Run the integration test and inspect output**

Run the Emulator command from Step 2 again. Expected: all T038 integration tests pass, with synthetic IDs only and no production endpoints or writes.

- [ ] **Step 7: Commit the integration unit**

```powershell
git add qa/integration/financial-access.test.ts
git commit -m "test: verify financial access recovery"
```

---

### Task 4: Ledger, Security Review, and Final Gates

**Files:**

- Modify: `tasks.md` at the T038 row and evidence section.
- Modify: `Lista/Lista.js` at the T038 entry.

**Interfaces:**

- Consumes: focused, Emulator, and repository gate evidence from Tasks 1-3.
- Produces: T038 in `revisión`, synchronized ledger/list, and a final verification record.

- [ ] **Step 1: Run the focused verification set**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/finance/financial-access.test.ts apps/functions/src/finance/financial-access-service.test.ts
corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts qa/integration/financial-access.test.ts"
```

Record exact test counts and any known non-fatal Emulator warnings in the ledger.

- [ ] **Step 2: Run the full repository gates**

```powershell
corepack pnpm test
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm format:check
corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore,auth "node node_modules/vitest/vitest.mjs run --project rules qa/rules/client-data-boundary.test.ts"
git diff --check
```

Expected: every command exits `0`; no new security-critical finding, production write, migration, or deployment occurs. UI E2E is not required because T038 adds no UI or callable.

- [ ] **Step 3: Perform the security self-review**

Inspect only the changed policy/service/integration code for:

- missing tenant or membership scope checks;
- client-owned status/debt accepted as truth;
- direct financial collection writes;
- financial details in errors/logs;
- hardcoded secrets or provider data;
- an accidental persisted restriction or new endpoint;
- an unresolved rate-limit exposure.

The expected result is no critical/high finding. Existing DR-001 moderate dependency findings and the transversal rate-limit residual remain documented and do not become silently resolved by T038.

- [ ] **Step 4: Update the ledger and visible task list**

Change T038 from `en-progreso` to `revisión` only after all tests and the security review pass. Record file paths, exact commands and counts, the no-schema/no-booking boundary, and the remaining DR-001/rate-limit limitations. Mirror the same state in `Lista/Lista.js`.

- [ ] **Step 5: Verify documentation consistency**

```powershell
git diff --check
git status --short
```

Expected: only intended T038 changes remain, with no `.env`, token, Emulator state, `graphify-out`, `.superpowers`, or test-report artifacts staged.

- [ ] **Step 6: Commit the final T038 evidence**

```powershell
git add tasks.md Lista/Lista.js
git commit -m "docs: record financial access verification"
```

Do not mark T038 `aprobada` or `desplegada` automatically; that requires the operator's formal approval and separate deployment gates.

---

## Plan Self-Review

- **Spec coverage:** policy rules are covered in Task 1; validation and immutability in Task 1; store composition and scope in Task 2; debt recovery and no persisted restriction in Task 3; safe errors and security review in Tasks 2 and 4; full verification and rollback boundary in Task 4.
- **No schema changes:** no Firestore indexes, Rules, collections, migrations, or production data are touched.
- **Type consistency:** `FinancialAccessDecision` is produced by the domain policy, embedded in `FinancialAccessView`, and consumed by the future booking module through `FinancialAccessService.getAccessDecision`.
- **Completeness check:** every implementation step names its files, interfaces, command, expected result, and boundary conditions.
- **Scope:** the plan contains one bounded feature with three independently testable code units and a documentation/gates closeout; booking integration remains explicitly deferred to T027.
