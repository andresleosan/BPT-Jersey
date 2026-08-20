# T038 Financial Access Design

**Status:** approved design, pending written-spec review before implementation

**Approved scope:** reusable financial-access policy and backend read service that combines
membership status with derived PAYG debt. The task does not write bookings, change membership
status automatically, add UI, or add a callable.

## Goal

Give the future booking module one authoritative decision for whether a student may start a new
paid session. A `trial` or `active` membership is allowed only when the student's derived PAYG
debt is zero. A `paused`, `overdue`, or `cancelled` membership is denied regardless of balance.
Recording the payment that clears the debt makes the next decision allowed without mutating the
membership record.

## Functional Authority

- `BRIEF.md` requires that PAYG can leave one session pending, and that a new session requires
  payment for both the previous debt and the new session.
- T037 is the source for invoice/payment records and the derived `paygDebtMinor` projection.
- Membership lifecycle statuses are `trial`, `active`, `paused`, `overdue`, and `cancelled`.
- T027 will own booking writes and consume this decision later; T038 must not implement bookings.

## Global Constraints

- Firestore remains canonical under `academies/{academyId}`.
- No `balances`, `debts`, restrictions, or access-decision collection is created.
- The decision is computed from validated membership data and the T037 financial projection.
- Tenant and student scope are checked before any financial data is used.
- The policy accepts no free-form reason, actor claims, client-owned status, or payment payload.
- No automatic membership transition, payment write, audit event, migration, deployment, production
  write, provider call, or new paid service.
- No callable or UI is added; existing authorized financial reads remain the user-facing path.

## Domain Policy

Create `packages/domain/src/finance/financial-access.ts` with a pure function:

```ts
type FinancialAccessInput = Readonly<{
  membershipStatus: MembershipStatus;
  paygDebtMinor: number;
}>;

type FinancialAccessDecision = Readonly<{
  allowed: true;
  code: "ALLOWED";
  membershipStatus: MembershipStatus;
  paygDebtMinor: number;
}> | Readonly<{
  allowed: false;
  code: "INVALID_INPUT" | "PAYG_DEBT_OUTSTANDING" | "MEMBERSHIP_NOT_ACCESSIBLE";
  membershipStatus: MembershipStatus | null;
  paygDebtMinor: number;
}>;

function evaluateFinancialAccess(input: unknown): FinancialAccessDecision;
```

Rules are ordered and deterministic:

| Membership status | Debt | Result |
| --- | ---: | --- |
| `trial` or `active` | `0` | `ALLOWED` |
| `trial` or `active` | `> 0` | `PAYG_DEBT_OUTSTANDING` |
| `paused`, `overdue`, or `cancelled` | `0` or `> 0` | `MEMBERSHIP_NOT_ACCESSIBLE` |

`paygDebtMinor` must be a safe non-negative integer. Invalid domain input returns `INVALID_INPUT`
rather than being silently treated as zero. Returned objects are immutable and contain no invoice
descriptions, payment methods, claims, or personal data.

## Backend Service

Create `apps/functions/src/finance/financial-access-service.ts` with a service that composes the
existing `MembershipStore` and `FinanceStore`:

```ts
type FinancialAccessInput = Readonly<{
  academyId: string;
  membershipId: string;
}>;

type FinancialAccessView = Readonly<{
  academyId: string;
  membershipId: string;
  studentId: string;
  membershipStatus: MembershipStatus;
  paygDebtMinor: number;
  decision: FinancialAccessDecision;
}>;
```

Flow:

1. Validate the tenant and membership identifiers.
2. Read the membership using a scope containing the same `academyId` and `membershipId`.
3. Build the financial scope from the stored membership's `familyId` and `studentId`.
4. Read `listFinancialAccount` and use its recalculated `paygDebtMinor`.
5. Evaluate the pure domain policy and return the immutable view.

The debt is account-level for the selected student, so unpaid PAYG invoices from prior sessions
remain effective even if they belong to an older membership. A payment recorded by T037 is visible
on the next read and restores access only when the derived debt reaches zero. The service performs
no writes and does not trust a client-provided family, student, membership status, or debt.

## Errors and Isolation

- Invalid identifiers or malformed stored records fail with a safe invalid error.
- Missing membership, tenant mismatch, and unauthorized scope fail closed without revealing whether
  a financial document exists.
- Finance store transaction failures are wrapped in a stable internal/service error without stack
  traces or financial payloads.
- The service does not expose invoice descriptions, payment allocations, claims, or unrelated
  family/student data.
- No new audit event is emitted for a read decision; invoice and payment mutations remain audited
  by T037.

## Verification

- Domain tests cover every status/debt combination, zero debt, positive debt, negative/fractional/
  unsafe debt, extra fields, prototypes, and immutable output.
- Service tests cover same-tenant reads, tenant mismatch, missing membership, selected student scope,
  debt across multiple PAYG invoices, membership restrictions, and recovery after a payment.
- Firebase Emulator integration seeds a membership, a PAYG invoice, and a manual payment; it verifies
  denied access before settlement and allowed access after settlement without creating restriction
  documents or mutating membership status.
- Final gates: focused tests, full suite, Rules, lint, typecheck, build, format check, audit high,
  and `git diff --check`.

## Rollback and Non-Goals

This task adds only pure code and read tests. Rollback is reverting the domain/service files and
tests; no data migration or production rollback is required. Booking writes, booking cancellation,
new PAYG invoice creation, membership transitions, overdue policy, refunds, providers, UI, and
production deployment remain outside T038.
