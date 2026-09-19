# T050 Financial Dashboard Design

**Status:** approved implementation scope for the synthetic pilot

**Approved scope:** an owner/administrator-only, read-only dashboard projection over the
canonical T033/T037 membership, invoice, and manual-payment records. No new persistence,
automated renewal, payment provider, production write, migration, or deployment is introduced.

## Goal

Replace the synthetic finance preview with a connected operational surface for manual GBP
finance. The page must answer four questions without exposing member identity: how much was
collected this month, how much remains outstanding, which invoice references need attention,
and which membership plans have a billing date in the next 30 days.

## Contract

`getFinancialDashboard(null)` derives the academy and actor from verified authentication and
returns `{ dashboard }`. The projection contains:

- `currency: "GBP"`, `generatedAt`, the current UTC month period, and a fixed 30-day renewal window.
- Aggregate metrics for collected minor units, active memberships, outstanding minor units,
  payments received, overdue invoice balances, and renewals due.
- At most ten recent payments: invoice reference, amount, and occurrence timestamp.
- At most ten outstanding balances: invoice reference, balance, due date, status, and overdue flag.
- At most ten upcoming renewals: plan ID, next billing timestamp, and current membership status.

The response excludes names, email, family/student/internal membership identifiers, descriptions,
manual payment references, methods, actor IDs, audit data, provider data, and card fields.

## Authorization and data integrity

- Only active `owner` and `administrator` actors may call the endpoint.
- The academy comes from the actor; the payload must be exactly `null`.
- Every source document is parsed with the canonical membership/finance contract, must match its
  Firestore document ID and academy, and must have a valid same-tenant relationship.
- Orphan payments, family mismatches, duplicate IDs, over-allocation, or invoice/payment status
  inconsistencies fail closed with a generic client error.
- Source reads are capped per collection. The endpoint is read-only and creates no audit event.

## Projection rules

- The reporting period starts at 00:00 UTC on the first day of the generated month and ends at
  `generatedAt`.
- Collected revenue and payment count include recorded payments in that period only.
- Outstanding balance is derived from non-void invoices minus their validated payments.
- An outstanding invoice is overdue only when `dueAt < generatedAt`.
- Renewals include only `trial` or `active` memberships with `nextBillingAt` from `generatedAt`
  through the end of the fixed 30-day window. This is an operational reminder, not automated billing.
- Lists are deterministic, sorted, immutable, and truncated to ten rows while aggregate counters
  continue to represent the complete validated source set.

## Interface design

The existing BPT system in `STACK.md` remains authoritative: BPT Purple, Mat Ink, Gi White,
Canvas, Barlow Condensed, and Source Sans 3.

- **Layout concept:** a compact finance ledger: four headline figures followed by a 30-day horizon
  that pairs balance attention with upcoming renewals, then recent receipts.
- **Signature element:** the horizon uses the mat-purple contrast as a date-driven operational
  rail, making the page read like the academy's next financial actions rather than a generic chart grid.
- **Accessibility:** semantic tables, visible loading/error/empty states, keyboard-visible refresh
  and filter controls, mobile cards, 4.5:1 text contrast, and reduced-motion compatibility.

## Verification and rollback

- Domain contract and hostile-response tests.
- Service tests for tenant isolation, relationship integrity, source caps, deterministic metrics,
  overdue balances, renewals, and corrupted financial states.
- Callable tests for auth, roles, active actor, exact payload, safe errors, and academy derivation.
- Client/UI tests plus desktop/mobile Playwright with a synthetic callable fixture and no PII/card data.
- Full unit, Rules, typecheck, Functions/domain/web builds, lint, format, audit, and diff checks.

Rollback is a code-only revert of the projection, callable, client, UI, and exports. There is no
schema rollback because T050 writes no data and creates no collection.
