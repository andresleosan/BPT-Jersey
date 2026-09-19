# T037 Manual Finance Design

**Status:** approved design, pending written-spec review before implementation

**Approved scope:** manual invoices, receipts/payment records, derived balances, PAYG debt
calculation, and authorization. Refunds, provider integrations, checkout, webhooks, automated
billing, UI, and reservation blocking remain outside this task.

## Goal

Provide a tenant-scoped backend for owner/administrator staff to issue manual invoices and record
manual payments without creating a second financial source of truth, storing card data, or depending
on a payment provider.

## Functional Authority

- `BPTJ FUNCTIONS APP.docx` fixes PAYG arrears: a new booking requires payment for the new session and
  the unpaid prior session.
- `BPTJ FUNCTIONS APP.docx` requires a manual cash check-in path and an invoice sent to the member's
  email; T037 records the backend financial operation, while any delivery channel remains outside
  this task.
- `BPT-memberships.docx` fixes catalogue prices, plan access, weekly limits, and Open Mat charges.
- T037 does not reinterpret unresolved freeze, overdue, trial, discount, refund, billing-date,
  timezone, waitlist, or Open Mat scheduling policy.

## Global Constraints

- Firestore is canonical under `academies/{academyId}`; clients never write financial collections directly.
- `owner` and `administrator` are the only financial writers.
- `guardian` and `adultStudent` can read only their own authorized financial scope.
- `headCoach` and `coach` have no financial access.
- Every input is allowlisted, type-checked, tenant-scoped, and server-owned fields are never accepted from the client.
- Amounts are positive integer minor units in GBP; no floating point, card data, CVV/CVC, PIN, provider secret, or full payment payload is stored.
- Financial history is append-only in effect; no payment is deleted or silently overwritten.
- No production migration, production write, deployment, provider call, or new paid service.
- Refund behavior is not implemented until its policy is separately approved.

## Data Model

### Invoices

Canonical path: `academies/{academyId}/invoices/{invoiceId}`.

Required envelope fields remain:

```ts
type InvoiceRecord = Readonly<{
  invoiceId: string;
  academyId: string;
  familyId: string;
  membershipId: string;
  status: "open" | "partially_paid" | "paid" | "void";
  totalMinor: number;
  currency: "GBP";
  dueAt: string;
  paidAt: string | null;
  schemaVersion: 1;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  chargeKind: "membership" | "payg_session" | "manual_adjustment";
  sourceRef: string | null;
  invoiceReference: string;
  description: string;
}>;
```

Rules:

- `chargeKind: "payg_session"` requires a non-empty opaque `sourceRef`; other kinds may use null.
- `sourceRef` is a backend-validated reference to the originating charge/session. A browser cannot
  turn an arbitrary cross-tenant string into a valid source reference. T037's public manual-invoice
  callable supports `membership` and `manual_adjustment`; the PAYG variant is created by an internal
  service that receives validated source context from the future booking/session owner.
- `invoiceReference` is a tenant-scoped idempotency key. Repeating the same issuance returns the
  existing invoice; a divergent replay fails without mutation.
- `description` is a short staff-facing label, not a place for PII, medical text, card data, or an
  unbounded narrative.
- `paidAt` is null unless the outstanding amount reaches zero. A paid invoice cannot return to an
  unpaid state.
- `void` is terminal and is available only for an `open` invoice with no payment applied. Voiding preserves the
  record and excludes it from balances/debt.
- `dueAt` is stored for the manually issued invoice and exposed as data; T037 does not classify an
  invoice as overdue or enforce an overdue policy.

### Payments

Canonical path: `academies/{academyId}/payments/{paymentId}`.

```ts
type ManualPaymentRecord = Readonly<{
  paymentId: string;
  academyId: string;
  familyId: string;
  invoiceId: string;
  status: "recorded";
  amountMinor: number;
  currency: "GBP";
  method: "cash" | "bank_transfer" | "other";
  manualReference: string;
  providerReference: null;
  occurredAt: string;
  schemaVersion: 1;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;
```

Rules:

- Payments are created, not updated in place. Payment correction/void workflows are separately scoped
  and are not exposed by T037.
- `manualReference` is an opaque, tenant-scoped idempotency key with a strict length and character
  allowlist. Repeating it with the same request returns the existing payment; reusing it with a
  different invoice, amount, method, or family fails closed.
- The backend derives a deterministic payment document ID from the tenant and normalized
  `manualReference`; a retry cannot create a second payment document.
- One payment record applies to one invoice. A PAYG arrears settlement uses one payment record per
  invoice, with a shared caller correlation value outside the canonical payment identity.
- `providerReference` is always null in T037. Provider evidence belongs to T034-T036.

### Derived balance and debt

- No `balances` or `debts` collection is created.
- Invoice balance is `totalMinor - sum(recorded payments for invoice)`, never below zero.
- Account balance is the sum of non-void invoice balances in the authorized family scope.
- PAYG debt is the sum of non-void, unpaid `payg_session` invoice balances.
- A receipt is a redacted read projection of one invoice and its recorded payments; T037 does not
  create a separate receipt collection or deliver email.
- T038 consumes the debt projection to block or restore booking; T037 does not write bookings or
  membership status.

## Backend Commands

All callable payloads are exact allowlists and are parsed before authorization or any write.

### `issueManualInvoice`

Input:

```ts
{
  familyId: string;
  membershipId: string;
  totalMinor: number;
  dueAt: string;
  chargeKind: "membership" | "manual_adjustment";
  invoiceReference: string;
  description: string;
}
```

The backend derives `academyId`, actor, IDs, envelope timestamps, `currency: "GBP"`, and
`status: "open"`. It verifies the family and membership are same-tenant and compatible before
creating the invoice and `invoice.created` audit event in one transaction. The internal PAYG service
uses the same store contract with `chargeKind: "payg_session"` and validated source context.

### `recordManualPayment`

Input:

```ts
{
  invoiceId: string;
  amountMinor: number;
  method: "cash" | "bank_transfer" | "other";
  manualReference: string;
  occurredAt: string;
}
```

The transaction reads the invoice and existing payment allocation, rejects void/paid invoices and
overpayment, creates the payment, and updates the invoice to `partially_paid` or `paid`. A successful
operation writes `payment.recorded` and, when the invoice becomes paid, `invoice.status.changed`.

### `voidManualInvoice`

Input:

```ts
{
  invoiceId: string;
}
```

Only an owner/administrator can void an `open` invoice with zero applied payments. The operation is
transactional, preserves the record, and writes `invoice.voided`. It
cannot refund, reverse, or alter an existing payment.

### Read commands

- `listFinancialAccount`: returns invoices and derived balances only within the caller's authorized
  family/student scope.
- `getInvoice`: returns one invoice, its payment allocations, and derived balance after validating
  the same scope.
- Reads do not expose internal claims, unrelated families, cross-tenant existence, provider fields,
  or raw audit payloads.

## Authorization Matrix

| Actor           |     Read own scope | Issue invoice | Record payment | Void invoice |
| --------------- | -----------------: | ------------: | -------------: | -----------: |
| `owner`         |                yes |           yes |            yes |          yes |
| `administrator` |                yes |           yes |            yes |          yes |
| `guardian`      | family-linked only |            no |             no |           no |
| `adultStudent`  |          self only |            no |             no |           no |
| `headCoach`     |                 no |            no |             no |           no |
| `coach`         |                 no |            no |             no |           no |
| anonymous       |                 no |            no |             no |           no |

Every positive result is tenant-scoped. Cross-tenant, inactive-actor, unrelated-family, and
unrelated-student requests fail closed without revealing whether a financial document exists.

## Audit Contract

T037 extends the discriminated audit action contract with:

- `invoice.created`
- `invoice.voided`
- `payment.recorded`
- `invoice.status.changed`

Events contain only the minimum financial evidence: tenant, actor, opaque target reference, purpose,
correlation ID, amount/currency where needed, payment method for `payment.recorded`, and result. They
never contain card data, provider secrets, full descriptions, PII, claims, tokens, medical data, or
before/after snapshots. The existing create-only audit writer remains the only writer.

## Errors and Idempotency

- Invalid payload, extra fields, invalid amount/date/reference, unauthorized actor, inactive actor,
  cross-tenant reference, missing invoice, invalid invoice status, overpayment, or idempotency conflict
  produce stable safe errors.
- Firestore errors and internal stack traces never reach clients or logs containing financial payloads.
- Transaction retries are safe because invoice creation is keyed by the tenant-scoped
  `invoiceReference`, and payment creation is keyed by the tenant-scoped `manualReference`.
- The same idempotent payment request returns the original payment result; a divergent replay fails
  without mutation.

## Verification and Rollback

- Domain tests cover exact contracts, hostile inputs, amounts, dates, status transitions, derived
  balances/debt, audit variants, and forbidden financial fields on memberships.
- Store tests cover same-tenant references, transaction ordering, concurrent payment attempts,
  idempotency, overpayment, open-only voiding, and no hard delete.
- Emulator integration covers Auth roles, family scopes, invoice/payment/audit documents, no direct
  client writes, no `debts`/`balances`/provider documents, and no cross-tenant leakage.
- Rules tests cover deny-by-default `invoices` and `payments` operations for all project roles.
- Final gates are focused tests, full unit suite, Rules, lint, typecheck, build, format, audit high,
  and `git diff --check`.
- Rollback for synthetic Emulator/staging is deletion of only the test run's IDs. A real recorded
  business operation is retained and corrected through an approved non-destructive command; no
  production rollback or migration is part of T037.

## Explicit Non-Goals

- No refund, chargeback, credit, discount, freeze, overdue enforcement, trial billing, or automated renewal.
- No payment provider, checkout, webhook, external email, receipt delivery, or tax engine.
- No UI/dashboard; T050 owns presentation.
- No booking block; T038 owns access restriction and recovery.
- No production writes, deployment, migration, or new paid service.
