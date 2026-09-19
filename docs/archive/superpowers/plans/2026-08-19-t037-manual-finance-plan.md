# T037 Manual Finance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` task by task. Steps use checkbox syntax for tracking.

**Goal:** Implement tenant-scoped manual invoices, payment records, derived balances, and PAYG debt calculation without providers, refunds, UI, or booking writes.

**Architecture:** `packages/domain` owns exact financial contracts and pure balance/debt projections. `apps/functions` owns Firestore transactions, authorization, idempotency, and the callable boundary. Invoice documents are the charge source of truth; payment documents are append-only in effect; no balance/debt collection is created. PAYG invoice creation is an internal service operation until the future session/booking module supplies validated source context.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Firebase Admin Firestore transactions, Firebase Auth/Firestore Emulator Suite, callable Functions, existing audit writer, Firestore Rules.

## Global Constraints

- Firestore is canonical under `academies/{academyId}`; clients never write financial collections directly.
- `owner` and `administrator` are the only financial writers; `guardian` and `adultStudent` read only their authorized scope; coaches have no financial access.
- Amounts are positive integer minor units in GBP; reject floats, card data, CVV/CVC, PINs, provider secrets, and full payment payloads.
- Invoice and payment inputs use exact allowlists; actor, tenant, IDs, status, timestamps, currency, `paidAt`, and audit fields are server-owned.
- Invoice issuance is idempotent by tenant-scoped `invoiceReference`; payment creation is idempotent by tenant-scoped `manualReference`.
- Financial history is not hard-deleted or silently overwritten. T037 exposes only open-invoice voiding with zero applied payments.
- No `balances` or `debts` collection; balances and PAYG debt are derived from invoices and recorded payments.
- `payg_session` invoices are created only through an internal service with validated source context; the public manual-invoice callable supports `membership` and `manual_adjustment`.
- No refunds, chargebacks, credits, discounts, freeze, overdue enforcement, trial billing, automated renewal, provider, checkout, webhook, external email, receipt delivery, UI, booking writes, migration, deployment, production write, or paid service.
- Use TDD: write a failing test, run it to verify the expected failure, implement the minimum, run it green, then refactor while green.
- No commit or Git configuration change; record evidence in `tasks.md` and the SDD report instead.

## File Map

- Create `packages/domain/src/finance/finance-contracts.ts`: exact invoice/payment input and record parsers, status values, and pure balance/debt projections.
- Create `packages/domain/src/finance/finance-contracts.test.ts`: domain RED/GREEN tests, hostile input tests, and financial-field boundary tests.
- Modify `packages/domain/src/index.ts`, `packages/domain/package.json`, and `packages/domain/tsconfig.runtime.json`: publish the finance runtime subpath.
- Create `apps/functions/src/finance/finance-service.ts`: Firestore store interface, transactions, idempotency, same-tenant references, and derived reads.
- Create `apps/functions/src/finance/finance-service.test.ts`: store tests using transaction doubles with real contract behavior.
- Create `apps/functions/src/finance/finance-callables.ts`: callable input parsing, actor authorization, safe errors, and public/internal command boundary.
- Create `apps/functions/src/finance/finance-callables.test.ts`: callable authorization, payload, error, and response tests.
- Modify `apps/functions/src/audit/audit-writer.ts`, `apps/functions/src/audit/audit-writer.test.ts`, `packages/domain/src/audit/audit-event.ts`, and `packages/domain/src/audit/audit-event.test.ts`: four finance audit actions through the existing create-only writer.
- Modify `apps/functions/src/index.ts`: export/register only the public finance callables.
- Create `qa/integration/finance-adapters.test.ts`: Auth/Firestore Emulator tests for roles, isolation, transactions, audit, idempotency, and absent financial side effects.
- Modify `qa/rules/client-data-boundary.test.ts`: deny-by-default matrix for `invoices` and `payments`.
- Modify `docs/data/firestore-data-model.md`, `tasks.md`, and `Lista/Lista.js`: canonical schema, ownership, evidence, and task status.

---

### Task 1: Domain Contracts And Projections

**Files:**

- Create `packages/domain/src/finance/finance-contracts.test.ts`
- Create `packages/domain/src/finance/finance-contracts.ts`
- Modify `packages/domain/src/index.ts`
- Modify `packages/domain/package.json`
- Modify `packages/domain/tsconfig.runtime.json`
- Modify `packages/domain/src/memberships/membership-contracts.test.ts` only if the finance-field boundary needs a shared assertion.

**Interfaces produced:**

```ts
type InvoiceStatus = "open" | "partially_paid" | "paid" | "void";
type ChargeKind = "membership" | "payg_session" | "manual_adjustment";
type ManualPaymentMethod = "cash" | "bank_transfer" | "other";

type InvoiceRecord = Readonly<{
  invoiceId: string;
  academyId: string;
  familyId: string;
  membershipId: string;
  status: InvoiceStatus;
  totalMinor: number;
  currency: "GBP";
  dueAt: string;
  paidAt: string | null;
  schemaVersion: 1;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  chargeKind: ChargeKind;
  sourceRef: string | null;
  invoiceReference: string;
  description: string;
}>;

type ManualPaymentRecord = Readonly<{
  paymentId: string;
  academyId: string;
  familyId: string;
  invoiceId: string;
  status: "recorded";
  amountMinor: number;
  currency: "GBP";
  method: ManualPaymentMethod;
  manualReference: string;
  providerReference: null;
  occurredAt: string;
  schemaVersion: 1;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

function parseInvoiceRecord(value: unknown): Result<InvoiceRecord, ValidationIssue[]>;
function parseManualPaymentRecord(value: unknown): Result<ManualPaymentRecord, ValidationIssue[]>;
function calculateInvoiceBalance(
  invoice: InvoiceRecord,
  payments: readonly ManualPaymentRecord[],
): number;
function calculateAccountBalance(
  invoices: readonly InvoiceRecord[],
  payments: readonly ManualPaymentRecord[],
): number;
function calculatePaygDebt(
  invoices: readonly InvoiceRecord[],
  payments: readonly ManualPaymentRecord[],
): number;
```

- [ ] **Step 1: Write the failing domain tests**

Cover valid invoice/payment records, exact allowed fields, GBP and positive integer amounts, canonical UTC dates, description/reference limits, valid statuses, and the `sourceRef` requirement for `payg_session`.

```ts
it("calculates a paid invoice balance from recorded payments", () => {
  expect(
    calculateInvoiceBalance(invoice({ totalMinor: 1000 }), [payment({ amountMinor: 1000 })]),
  ).toBe(0);
});

it("rejects finance fields added to a membership contract", () => {
  expect(parseMembershipDraft({ ...validMembershipDraft, invoiceId: "invoice-1" }).ok).toBe(false);
});
```

Add negative cases for floats, zero/negative amounts, non-GBP currency, `overdue` as a stored status, `payg_session` without `sourceRef`, extra fields, symbols, non-enumerable fields, accessors, hostile prototypes, and payment provider fields.

- [ ] **Step 2: Run RED and verify the failure is correct**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/finance/finance-contracts.test.ts packages/domain/src/memberships/membership-contracts.test.ts
```

Expected: failure because the finance module and exports do not exist; existing membership tests must remain understandable and not fail from a test typo.

- [ ] **Step 3: Implement the minimum contracts and pure projections**

Use the existing parser/result conventions. Freeze returned records and arrays. Sum only `recorded` payments linked to the invoice; exclude `void` invoices from account/debt totals. Do not add storage, Firestore, Auth, or callable dependencies to the domain package.

- [ ] **Step 4: Publish the runtime subpath**

Add the `@bpt-jersey/domain/finance` types/default mapping and runtime tsconfig entry. Export the values and parsers from the public domain index.

- [ ] **Step 5: Run GREEN and package checks**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/finance/finance-contracts.test.ts packages/domain/src/memberships/membership-contracts.test.ts
corepack pnpm --filter @bpt-jersey/domain typecheck
corepack pnpm --filter @bpt-jersey/domain build:runtime
```

Expected: all focused domain tests pass and the runtime subpath resolves without workspace imports.

---

### Task 2: Firestore Finance Store

**Files:**

- Create `apps/functions/src/finance/finance-service.test.ts`
- Create `apps/functions/src/finance/finance-service.ts`

**Interfaces produced:**

```ts
type FinanceStore = Readonly<{
  issueManualInvoice(input: IssueManualInvoiceInternal): Promise<InvoiceRecord>;
  issuePaygInvoice(input: IssuePaygInvoiceInternal): Promise<InvoiceRecord>;
  recordManualPayment(input: RecordManualPaymentInternal): Promise<ManualPaymentRecord>;
  voidManualInvoice(input: VoidManualInvoiceInternal): Promise<InvoiceRecord>;
  listFinancialAccount(scope: FinanceReadScope): Promise<FinancialAccountView>;
  getInvoice(scope: FinanceReadScope, invoiceId: string): Promise<InvoiceView>;
}>;

type IssueManualInvoiceInternal = Readonly<{
  academyId: string;
  actorId: string;
  familyId: string;
  membershipId: string;
  totalMinor: number;
  dueAt: string;
  chargeKind: "membership" | "manual_adjustment";
  invoiceReference: string;
  description: string;
}>;

type IssuePaygInvoiceInternal = Readonly<{
  academyId: string;
  actorId: string;
  familyId: string;
  membershipId: string;
  totalMinor: number;
  dueAt: string;
  chargeKind: "payg_session";
  sourceRef: string;
  invoiceReference: string;
  description: string;
}>;

type RecordManualPaymentInternal = Readonly<{
  academyId: string;
  actorId: string;
  invoiceId: string;
  amountMinor: number;
  method: ManualPaymentMethod;
  manualReference: string;
  occurredAt: string;
}>;

type VoidManualInvoiceInternal = Readonly<{
  academyId: string;
  actorId: string;
  invoiceId: string;
}>;

type FinanceReadScope = Readonly<{
  academyId: string;
  actorId: string;
  familyIds: readonly string[];
  studentIds: readonly string[];
}>;

type InvoiceView = Readonly<{
  invoice: InvoiceRecord;
  payments: readonly ManualPaymentRecord[];
  balanceMinor: number;
}>;

type FinancialAccountView = Readonly<{
  invoices: readonly InvoiceView[];
  balanceMinor: number;
  paygDebtMinor: number;
}>;
```

`issueManualInvoice` accepts only `membership` and `manual_adjustment`; `issuePaygInvoice` accepts a validated same-tenant source context from a future booking/session owner. Both use the tenant-scoped `invoiceReference`.

- [ ] **Step 1: Write failing store tests**

Use the existing Firestore transaction-double style. Test same-tenant family/membership references, divergent invoice idempotency, same invoice replay, open invoice creation, PAYG internal source validation, and server-owned envelope fields.

- [ ] **Step 2: Run RED**

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/finance/finance-service.test.ts
```

Expected: failure because the store module and methods do not exist.

- [ ] **Step 3: Implement invoice transactions**

Create invoice documents only after reading and validating family, membership, academy, actor-provided invoice reference, and internal PAYG source context. Use deterministic invoice identity for `invoiceReference`; identical replay returns the existing record and divergent replay aborts with no mutation. Append `invoice.created` through the existing audit writer in the same transaction.

- [ ] **Step 4: Add payment transaction and derived reads**

Derive deterministic payment ID from academy plus normalized `manualReference`. In one transaction read the invoice and payment allocations, reject void/paid/overpayment, create the payment, update invoice status/`paidAt`, and append payment/status audit events. Reads return redacted invoice/payment projections plus pure balance/debt calculations.

- [ ] **Step 5: Add open-only void**

Require `status === "open"` and no recorded payment; set invoice status to `void`, preserve the document, and append `invoice.voided`. Never expose delete/update payment APIs.

- [ ] **Step 6: Run GREEN and regression checks**

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/finance/finance-service.test.ts packages/domain/src/finance/finance-contracts.test.ts
corepack pnpm --filter @bpt-jersey/functions typecheck
```

Expected: store tests pass, transaction doubles show no out-of-transaction financial writes, and Functions typecheck passes.

---

### Task 3: Callable Boundary And Authorization

**Files:**

- Create `apps/functions/src/finance/finance-callables.test.ts`
- Create `apps/functions/src/finance/finance-callables.ts`
- Modify `apps/functions/src/index.ts`

**Interfaces produced:**

```ts
type FinanceCallableResult =
  | Readonly<{ kind: "invoice"; invoice: InvoiceRecord }>
  | Readonly<{ kind: "payment"; payment: ManualPaymentRecord }>
  | Readonly<{ kind: "account"; account: FinancialAccountView }>
  | Readonly<{ kind: "invoice-view"; view: InvoiceView }>;

function issueManualInvoice(request: CallableRequest<unknown>): Promise<FinanceCallableResult>;
function recordManualPayment(request: CallableRequest<unknown>): Promise<FinanceCallableResult>;
function voidManualInvoice(request: CallableRequest<unknown>): Promise<FinanceCallableResult>;
function listFinancialAccount(request: CallableRequest<unknown>): Promise<FinanceCallableResult>;
function getInvoice(request: CallableRequest<unknown>): Promise<FinanceCallableResult>;
```

- [ ] **Step 1: Write failing callable tests**

Build request cases for anonymous, inactive actor, owner, administrator, guardian linked/unlinked, adult student self/other, head coach, coach, cross-tenant data, invalid exact payloads, and safe error mapping. Assert the store is not called for rejected payloads or actors.

- [ ] **Step 2: Run RED**

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/finance/finance-callables.test.ts
```

Expected: failure because the finance callable module does not exist.

- [ ] **Step 3: Implement exact parsing and authorization**

Reuse existing actor/academy/scope authorization helpers. Parse payload before store access, derive actor/tenant on the server, reject extra fields and internal PAYG fields from the public callable, and map internal failures to stable safe callable errors without Firestore paths or financial payloads.

- [ ] **Step 4: Wire public exports only**

Register the five public callable handlers from `apps/functions/src/index.ts`. Do not export the internal PAYG service as a callable or add a client SDK/UI in T037.

- [ ] **Step 5: Run GREEN and Auth regression**

```powershell
corepack pnpm exec vitest run --project node apps/functions/src/finance/finance-callables.test.ts apps/functions/src/auth/admin-authorization.test.ts apps/functions/src/auth/user-authorization.test.ts
corepack pnpm --filter @bpt-jersey/functions typecheck
```

Expected: all authorization cases pass and existing actor behavior remains green.

---

### Task 4: Audit Actions, Emulator Integration, And Rules

**Files:**

- Modify `packages/domain/src/audit/audit-event.ts`
- Modify `packages/domain/src/audit/audit-event.test.ts`
- Modify `apps/functions/src/audit/audit-writer.ts`
- Modify `apps/functions/src/audit/audit-writer.test.ts`
- Create `qa/integration/finance-adapters.test.ts`
- Modify `qa/rules/client-data-boundary.test.ts`

- [ ] **Step 1: Write failing audit contract tests**

Add exact variants for `invoice.created`, `invoice.voided`, `payment.recorded`, and `invoice.status.changed`; reject PII, card/provider fields, extra keys, cross-tenant targets, invalid amounts, and invalid payment methods.

- [ ] **Step 2: Run RED**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/audit/audit-event.test.ts apps/functions/src/audit/audit-writer.test.ts
```

Expected: failure because the finance actions are absent from the discriminated audit contract.

- [ ] **Step 3: Implement audit variants through create-only writer**

Extend the existing typed contract and writer without adding update/delete APIs. Confirm every finance write uses the writer in its transaction and server-owned fields remain writer-owned.

- [ ] **Step 4: Write Emulator integration tests before implementation wiring**

Seed two academies with synthetic Auth users, active families, memberships, and plans. Cover owner/admin writes, guardian/adult reads, coach denial, cross-tenant isolation, invoice/payment/audit shape, invoice/payment idempotency, concurrent payment conflict, open-only void, derived PAYG debt, and absence of `debts`, `balances`, provider, and card documents.

- [ ] **Step 5: Implement and run Emulator integration**

```powershell
corepack pnpm exec firebase emulators:exec --project demo-bpt-jersey --only firestore,auth "node node_modules/vitest/vitest.mjs run --config qa/integration/vitest.config.ts qa/integration/finance-adapters.test.ts"
```

Expected: all integration cases pass with synthetic IDs and no production access.

- [ ] **Step 6: Extend Rules negative matrix**

Add `invoices` and `payments` to the direct client deny-by-default matrix for anonymous, owner, administrator, headCoach, coach, guardian, and adultStudent, covering get/list/create/update/delete.

```powershell
corepack pnpm test:rules
```

Expected: all Rules tests pass; `permission_denied` warnings are expected negative-test output.

---

### Task 5: Documentation, Final Gates, And Review

**Files:**

- Modify `docs/data/firestore-data-model.md`
- Modify `tasks.md`
- Modify `Lista/Lista.js`
- Create `.superpowers/sdd/2026-08-19-t037-manual-finance-plan/task-5-report.md`

- [ ] **Step 1: Document the canonical finance model**

Document exact invoice/payment fields, `chargeKind`, source context boundary, invoice/payment statuses, idempotency keys, derived balance/debt, redacted receipt projection, owner/admin write scope, family/adult read scope, deny-by-default Rules, append-only history, and T037/T038/T034-T036 boundaries. State explicitly that no refund policy is implemented.

- [ ] **Step 2: Run security self-review**

Search all new/modified finance files for direct client writes, unvalidated fields, PII/card/provider data, cross-tenant references, unsafe errors, and financial writes outside transactions. Verify only the existing create-only audit writer writes audit events.

- [ ] **Step 3: Run focused and full gates**

```powershell
corepack pnpm exec vitest run --project node packages/domain/src/finance/finance-contracts.test.ts packages/domain/src/audit/audit-event.test.ts apps/functions/src/finance/finance-service.test.ts apps/functions/src/finance/finance-callables.test.ts apps/functions/src/audit/audit-writer.test.ts
corepack pnpm test
corepack pnpm test:rules
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
corepack pnpm format:check
corepack pnpm audit --audit-level high
git -c safe.directory="F:/Proyectos/BPT Jersey/Dev" diff --check
```

Expected: zero test/lint/type/build/format/diff failures; audit has zero high/critical and any moderate advisories are recorded in DR-001.

- [ ] **Step 4: Reconcile the ledger**

Record exact command outputs and findings in the report. Keep T008 blocked and do not promote its placeholders. Keep T037 in `revisión` until the review gate passes; do not mark it `aprobada` or `desplegada`.

- [ ] **Step 5: Perform independent review**

Review the implementation against the approved spec and report Critical/Important/minor findings, especially financial authorization, tenant isolation, idempotency, audit minimization, no direct Rules access, and no refund/provider scope creep.

No commit, migration, deployment, production write, or Git configuration change is part of this plan.
