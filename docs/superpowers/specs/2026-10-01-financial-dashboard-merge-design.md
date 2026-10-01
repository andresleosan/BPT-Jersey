# Financial dashboard: merge Billing, edit/void payments, connect every panel

Date: 2026-10-01 · Status: approved in chat (operator), spec pending review

## Why

The admin menu shows two entries, "Billing" and "Financial dashboard", but `/admin/finance`
only redirects to `/admin/billing`. The operator wants one page, "Financial dashboard", where the
office can add, edit and void member payments, and where every panel shows the data already
collected. An audit against production (read-only, 2026-10-01) found these gaps:

| Panel | Gap |
|---|---|
| Menu | Two entries, one page |
| KPIs | Only invoice payments; paid shop orders never counted; current month only |
| Latest payments | No edit/void; fixing a payment means opening the member profile |
| Outstanding invoices | Invoice reference only, no member; capped at 10 rows |
| Upcoming renewals | Shows plan slug (`town-adult`), no member; ~20 due in 30 days, capped at 10 |
| Overdue renewals | Memberships past `nextBillingAt` (or `status: overdue`) are shown nowhere |
| All invoices | PAYG/private-lesson invoices show the description instead of the member |

Facts that shape the design:

- Approved private lessons already write an invoice + payment into `payments`
  (`private-lesson-firestore.ts:97`), so they are already in the totals. Counting
  `privateLessonPurchases` again would double them.
- The shop never writes to `payments`; `shopOrders` has `paymentStatus` but no paid timestamp.
  No order is paid in production today, so nothing needs backfilling.
- `parseManualPaymentRecord` is strict and is bundled by 8 modules (PAYG, subscriptions, courses,
  private lessons, finance). Adding fields to a payment document would break every deployed
  function still on the old parser (same failure as `listStaffProfiles`, see memory
  `strict-parsers-partial-deploy`).
- `editManualPayment` already exists (reason ≥ 10 chars, audit, idempotent `requestId`) and the
  member profile already has `EditPaymentDialog`.
- The Regyfit archive (`memberHistoryEntries`, kind `payment`) stays out of the totals (decision).

## Decisions (operator, 2026-10-01)

1. Totals include everything the platform takes: invoice payments (membership, PAYG, private
   lessons, courses) + paid shop orders. Regyfit archive excluded.
2. Payments can be added, edited and **voided with a reason**.
3. Page visible to owner + administrator; both may void (audited).
4. Layout: summary on top, tabs below, active tab in the URL (`?tab=`).
5. A month selector (`‹ September 2026 ›`) drives the KPIs and the Payments tab.

## Design

### 1. Route and navigation

- `apps/web/src/app/admin/finance/page.tsx` becomes the page (today's `BillingPage`, moved and
  reshaped). `apps/web/src/app/admin/billing/page.tsx` becomes the forwarder (the same pattern the
  finance route uses today), so old links keep working. The billing components
  (`*-dialog.tsx`, `*-panel.tsx`, `billing-format.ts`, `billing.css`) stay where they are; only
  the page moves.
- `admin-shell.tsx`: remove "Billing" and keep one item, `{ label: "Financial dashboard",
  href: "/admin/finance" }` with no `ownerOnly`. `overview-page.tsx` already links to
  `/admin/finance`.
- Header: eyebrow "Money / Finance", title "Financial dashboard", actions "Issue invoice" and
  "Record payment" (existing dialogs).

### 2. Data: `getFinancialDashboard` v2 (one callable for the summary + lists)

Input: `{ month?: "YYYY-MM" }` (strict). Missing → current month. A `null` payload is still
accepted, so the web build that is live during deploy keeps working. Month bounds are UTC, as
today (worst case: a payment made at 00:30 BST on the 1st counts in the previous month).

Server reads (all small today; `ponytail:` comment names the ceiling: full scans of `invoices`,
`payments`, `memberships`; switch to month-ranged queries + an aggregate doc past a few thousand
rows):

- `memberships`, `invoices`, `payments` (as today)
- `voidedPayments` whose original `payment.occurredAt` falls in the month (a voided row shows
  where the payment used to be; see §4)
- `shopOrders` where `paymentStatus == "paid"` and `status != "cancelled"`
- `privateLessonPurchases` (only to map `invoiceId → studentId`)
- `plans` (only for `planId → name`)

Output (domain `FinancialDashboard`, `packages/domain/src/finance/financial-dashboard.ts`):

```ts
{
  currency: "GBP"; generatedAt; month: "YYYY-MM"; period: { from; to };
  metrics: { collectedMinor; paymentsReceived; outstandingMinor; overdueBalances;
             renewalsDue; renewalsOverdue; activeMemberships };
  payments: PaymentRow[];          // every payment in the month, newest first, no cap
  balances: BalanceRow[];          // every invoice with balance > 0, no cap
  renewals: { overdue: RenewalRow[]; dueSoon: RenewalRow[] };   // dueSoon = next 30 days
}
PaymentRow = { rowId; source: "membership" | "payg" | "private_lesson" | "course" | "shop" | "adjustment";
  occurredAt; amountMinor; method; studentId: string | null; label: string;  // label = invoice description or "SHOP-000001 · contact name"
  paymentId: string | null; invoiceId: string | null; shopOrderId: string | null;
  editable: boolean; voidable: boolean; voided: null | { voidedAt; voidedByName; reason } }
BalanceRow = { invoiceId; invoiceReference; studentId: string | null; label; dueAt; balanceMinor; overdue; status }
RenewalRow = { membershipId; studentId; planId; planName; nextBillingAt: string | null; status }
```

Rules:

- `collectedMinor` / `paymentsReceived` = non-voided invoice payments with `occurredAt` in the
  month + paid shop orders with `paidAt` in the month. Voided payments appear in `payments`
  (struck through) but are never summed.
- `editable` = invoice `schemaVersion === 1` and `chargeKind` not `payg_session` and invoice not
  void (the guards `editManualPayment` already enforces). `voidable` = `editable` and `chargeKind`
  is `membership` or `manual_adjustment` (private lessons and courses manage their own credits
  and money).
- `studentId`: membership invoice → `memberships/{membershipId}.studentId`; private lesson invoice →
  purchase with that `invoiceId`; otherwise `null` and the UI shows `label`.
- Overdue renewal = membership `status === "overdue"`, or `status` in (`active`, `trial`) with
  `nextBillingAt < now`. Due soon = `active`/`trial` with `nextBillingAt` in `[now, now + 30d]`.
  Memberships with `nextBillingAt === null` (PAYG, free transit) are never renewals.
- The builder keeps today's integrity throws (duplicate ids, orphan payment, inconsistent status).
  A voided payment is not in `payments`, so it is not an orphan.

`listRecentPayments` stops being called by this page (it can be deleted from the web client; the
callable stays deployed until a later cleanup, so nothing breaks). `listFinancialAccount`,
`getFamilyFinancialAccount`, `listMemberships`, `listMemberNames` stay, but the page loads them
only when their tab opens (Invoices/Settings). That cuts the first paint from 5 callables to 2
(`getFinancialDashboard` + `listMemberNames`), following the cold-start finding in
`docs/reviews/informe-rendimiento-2026-10-01.md`.

### 3. Shop: record when an order was paid

- `shopOrderBaseSchema` gains `paidAt: dateTimeSchema.nullable().optional()`. Optional, because
  existing orders have no field and must keep parsing.
- The shop status update sets `paidAt = now` on `unpaid → paid` and `paidAt = null` on
  `paid → unpaid`.
- ⚠️ Strict parser: every shop function must be deployed in the same batch (list in the plan).

### 4. Void a payment: new callable `voidManualPayment`

Contract (`finance-contracts.ts`): `{ paymentId, reason (10–280, same schema as edit), requestId: uuid }`.

To avoid touching the strict payment parser, a void **moves** the document:

1. In one transaction: read payment + invoice + all payments of that invoice; check `voidable`.
2. Create `voidedPayments/{paymentId}` = `{ payment: <original record>, voidedAt, voidedBy,
   voidedByName, reason, requestId }`.
3. Delete `payments/{paymentId}`.
4. Recompute the invoice status from the remaining payments: `paid → partially_paid | open`.
5. Append the audit event (`appendAuditEventInTransaction`, action `finance.payment.voided`).
6. Idempotency: receipt `paymentVoidReceipts/void-{requestId}` (same pattern as
   `paymentEditReceipts`). A replay returns the stored result; the same `requestId` used for
   another payment returns `conflict`.

Every other module (PAYG, subscriptions, account balance, member profile) keeps reading
`payments` with the old parser and sees the correct, smaller set. No other function needs a
redeploy for correctness.

Not reverted by a void (stated in the dialog): membership dates or status changes that the payment
caused (e.g. an `overdue` membership reactivated). The office fixes those in the Plan tab.

Auth: `requireAdministrator` (owner + administrator), App Check enforced, `financeCallableOptions`.
Firestore rules: none needed. `firestore.rules` ends with `match /{document=**}` deny-all, so
`voidedPayments` and `paymentVoidReceipts` are server-only (Admin SDK) by default.

### 5. UI (`/admin/finance`)

Order: header → feedback band → month selector → 4 KPIs → tabs → tab panel → dialogs.

- **Month selector:** `‹` / `›` buttons plus the label ("September 2026"), next disabled on the
  current month. Changing the month refetches `getFinancialDashboard({ month })`.
- **KPIs** (`AdminMetric`): Collected (month) · Outstanding (now) · Overdue invoices · Renewals
  (detail: "N overdue · M due in 30 days").
- **Tabs** (shop pattern: `nav > ul[role=tablist] > button[role=tab][aria-selected]`), synced to
  `?tab=payments|owed|renewals|invoices|settings` via `useSearchParams` + `router.replace`
  (wrapped in `Suspense` for the static export). Default `payments`.
  - **Payments:** table Date · Member · Source · Method · Amount · Actions. Member = name from
    `listMemberNames` via `studentId`, else `label`. Actions: `Edit` (opens `EditPaymentDialog`,
    adapted to take `{ paymentId, amountMinor, method, reference, occurredAt }`) and `Void`
    (new `VoidPaymentDialog`: amount + member + reason textarea, counter 10–280, warning sentence
    about plan dates, destructive button "Void payment"). Shop rows: no actions, label links to
    `/admin/shop`. Voided rows: muted, amount struck through, "Voided — reason (by, date)".
    Empty: "No payments in September 2026."
  - **Owed:** Member · Invoice · Due · Balance · Status (Overdue/Due later, text + left rule) ·
    `Record payment` (opens `RecordPaymentDialog` with the invoice preselected).
  - **Renewals:** two tables, "Overdue" first, then "Due in the next 30 days". Member · Plan
    (name) · Date · Status · `Open plan` link → `/admin/members/profile?…&tab=plan` (the
    existing renewal flow; check the profile route's query format).
  - **Invoices:** "Find a member" + `MemberAccountPanel` (as today), then "All invoices"
    (as today, member resolved from membership or private-lesson mapping).
  - **Settings:** `PaymentInstructionsPanel` + `PrivateLessonsPanel` (as today).
- DESIGN.md rules that apply: radius 0; status = text + coloured left rule, never a pill; skeletons
  in Paper Edge sized like the real panel, no spinners; table actions inline at the row end,
  ≥ 44 px targets, no kebab; money in `tabular-nums`; UK English, plain voice; no emojis/icons as
  decoration; one column below 48rem, tables scroll inside their card, the page never scrolls
  sideways; inputs ≥ 16px; `prefers-reduced-motion` respected.
- Security (frontend): render every name/label as React text (no `dangerouslySetInnerHTML`);
  web clients zod-parse responses and surface fixed user-facing strings, never raw Firebase errors;
  the void/edit `requestId` is created once per opened dialog (replay-safe double click).

### 6. Error handling

- Dashboard callable fails → KPI area shows "The finance summary is unavailable. Try again." with
  a Retry button; tabs that only need the dashboard show the same band.
- Void/edit conflict (`already-exists`/`failed-precondition`) → dialog stays open with the server's
  safe message mapped in `billing-client.ts` ("This payment was changed by someone else. Refresh and
  try again.", "Class and course payments are managed from their own pages.").
- Success → close dialog, feedback band "Payment voided." / "Payment updated.", refetch dashboard.

## Out of scope

Regyfit archive in totals; CSV export; Europe/London month bounds; reverting membership dates on
void; editing shop payments from this page (they stay in Shop); deleting `listRecentPayments`.

## Verification

- Unit (domain): month filter, voided excluded from sums but listed, paid shop order counted by
  `paidAt`, overdue vs due-soon renewals, `editable`/`voidable` flags, `studentId` mapping.
- Unit (functions): `voidManualPayment` service with in-memory fakes: happy path (moves doc,
  invoice `paid → open`), partial (→ `partially_paid`), guards (payg, course, private lesson,
  void invoice), idempotent replay, `requestId` reuse conflict, audit appended. Disable the
  voidable guard and confirm a test fails (LECCIONES §4).
- Unit (shop): `paidAt` set/cleared on payment status change; an order without `paidAt` still parses.
- Browser: Playwright MCP against the emulators (`demo-bpt-jersey`) with seeded data: menu shows one
  entry; `/admin/billing` lands on `/admin/finance`; month switch changes totals; edit and void a
  payment end to end; owed/renewals show member names; 390 px width has no horizontal scroll.
- Production cannot be driven from the VPS (App Check, memory `vps-chrome-appcheck-fails`); after an
  authorised deploy the operator checks the page from the laptop.

## Deploy (only after explicit operator confirmation)

1. Push `main` (Cloudflare Pages auto-deploys the web; the guard needs the commit pushed first).
2. Functions, one batch: `getFinancialDashboard`, `voidManualPayment` (new), all shop callables
   (exact list from `apps/functions/src/index.ts` in the plan). 120 s wait between batches.
