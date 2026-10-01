# Financial Dashboard Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One admin page, `/admin/finance` ("Financial dashboard"), that replaces Billing, lets the office add/edit/void member payments, and shows every collected pound with member names, a month selector and tabs.

**Architecture:** `getFinancialDashboard` becomes a month-aware read model (invoice payments + voided payments + paid shop orders + renewals) built by a pure domain function and validated by a zod schema shared with the web. A new `voidManualPayment` callable moves a payment document to `voidedPayments` (no change to the strict payment parser used by 8 modules). Shop orders gain an optional `paidAt`. The web page reuses the existing billing dialogs/panels and the shop tab pattern.

**Tech Stack:** TypeScript strict, zod 4, Firebase Functions v2 `onCall`, Next.js 16 static export, React 19, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-01-financial-dashboard-merge-design.md`

## Global Constraints

- Work on local `main`, commit per task; never push, never deploy (operator confirms both).
- Commands from repo root via Corepack: `corepack pnpm …`. Node `>=22.13 <25`.
- `packages/domain` never imports Firebase.
- Domain changes must be rebuilt before functions tests that import compiled domain: `corepack pnpm --filter @bpt-jersey/domain build:runtime`.
- UK English UI copy, plain academy voice; no emojis; radius 0; status = text + coloured left rule (`AdminStatusBadge`), never a pill; skeletons, no spinners; actions inline at row end, ≥44px; money `tabular-nums`; inputs ≥16px; no horizontal page scroll at 390px.
- Web clients return fixed safe strings, never raw Firebase errors; no `dangerouslySetInnerHTML`.
- Edit/void dialogs create one `requestId` per opened dialog (`useState(() => crypto.randomUUID())`).
- Months are UTC (`YYYY-MM`), as today.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. A month with zero activity (e.g. a future-adjacent or very old month) → KPIs read £0.00 / 0, Payments tab shows "No payments in <Month Year>.", no crash. (Task 1 test `empty month`.)
2. Same `requestId` replayed for a void after a lost response → returns the stored result, does not throw "not found" because the payment doc is already gone. (Task 3 test `replay after the payment moved`.)
3. Voiding the only payment of a `paid` membership invoice → invoice becomes `open`, appears in Owed, Collected drops by that amount. (Task 1 + Task 3 tests.)
4. A shop order marked paid then unpaid then paid again → `paidAt` reflects the last `unpaid → paid` transition only; an order with `paymentStatus: "paid"` and no `paidAt` (legacy) still counts, dated by `updatedAt`. (Task 4 + Task 1 tests.)
5. Member without a name in `listMemberNames` (archived, or null studentId) → row shows the invoice label, never a raw id or "undefined". (Task 7 test.)

---

## File map

| File | Responsibility |
|---|---|
| `packages/domain/src/finance/financial-dashboard.ts` | **Rewrite.** Input/output zod schemas, `buildFinancialDashboard` v2, month helpers |
| `packages/domain/src/finance/financial-dashboard.test.ts` | **Rewrite.** Builder tests |
| `packages/domain/src/finance/finance-contracts.ts` | Add `voidManualPaymentInputSchema`, `VoidedPaymentRecord`, `parseVoidedPaymentRecord` |
| `packages/domain/src/audit/audit-event.ts` | Add action `payment.voided` (same fields as `payment.edited`) |
| `packages/domain/src/shop/shop-contracts.ts` | Optional `paidAt` on orders |
| `apps/functions/src/finance/financial-dashboard-service.ts` | Read the new sources, call builder with month |
| `apps/functions/src/finance/financial-dashboard-callables.ts` | Accept `null` or `{ month? }` |
| `apps/functions/src/finance/finance-service.ts` | `voidManualPayment` store method; `delete` on `FinanceTransaction` |
| `apps/functions/src/finance/finance-callables.ts` | `voidManualPaymentHandler` + `voidManualPayment` export |
| `apps/functions/src/index.ts` | Export `voidManualPayment` |
| `apps/functions/src/shop/shop-service.ts` | Set/clear `paidAt` in `updateOrder` |
| `apps/web/src/lib/finance-client.ts` | `getFinancialDashboard(month?)` using the domain schema; drop `listRecentPayments` |
| `apps/web/src/lib/billing-client.ts` | `voidManualPayment` |
| `apps/web/src/app/admin/members/profile/payment-dialogs.tsx` | `EditPaymentDialog` accepts a minimal payment shape |
| `apps/web/src/app/admin/billing/void-payment-dialog.tsx` | **New.** Void dialog |
| `apps/web/src/app/admin/finance/page.tsx` | **Rewrite.** The dashboard page (moved from billing) |
| `apps/web/src/app/admin/finance/finance-tabs.tsx` | **New.** Tab panels (Payments, Owed, Renewals) |
| `apps/web/src/app/admin/billing/page.tsx` | Becomes the forwarder to `/admin/finance` |
| `apps/web/src/app/admin/admin-shell.tsx` | One nav item |
| `qa/tests/admin-billing-home.spec.ts` → `qa/tests/admin-finance.spec.ts` | E2E with the admin fixture |

---

### Task 1: Domain — dashboard v2 builder and schema

**Files:**
- Rewrite: `packages/domain/src/finance/financial-dashboard.ts`
- Rewrite: `packages/domain/src/finance/financial-dashboard.test.ts`
- Modify: `packages/domain/src/finance/finance-contracts.ts` (append `VoidedPaymentRecord` type + parser; see Task 2 for the input schema — put the type here now so Task 1 compiles)

**Interfaces:**
- Produces (exported from `@bpt-jersey/domain/finance/dashboard`):
  - `financialMonthSchema: z.ZodString` (`/^\d{4}-(0[1-9]|1[0-2])$/`)
  - `financialDashboardInputSchema = z.strictObject({ month: financialMonthSchema.optional() })`
  - `currentFinancialMonth(isoTimestamp: string): string`
  - `shiftFinancialMonth(month: string, delta: number): string`
  - `financialDashboardSchema` and `type FinancialDashboard = z.infer<…>`
  - `type FinancialDashboardPaymentRow`, `FinancialDashboardBalanceRow`, `FinancialDashboardRenewalRow`
  - `type DashboardShopPayment = { orderId; orderNumber: number | null; contactName: string; totalMinor: number; paidAt: string; paymentMethod: "bank_transfer" | "at_collection" }`
  - `type FinancialDashboardSource` (below), `buildFinancialDashboard(source): FinancialDashboard`
- Produces (from `@bpt-jersey/domain/finance`): `type VoidedPaymentRecord = Readonly<{ payment: ManualPaymentRecord; voidedAt: string; voidedBy: string; voidedByName: string; reason: string; requestId: string }>`, `parseVoidedPaymentRecord(value: unknown): Result<VoidedPaymentRecord, readonly ValidationIssue[]>`

- [ ] **Step 1: Add `VoidedPaymentRecord` to `finance-contracts.ts`** (append near `parseManualPaymentRecord`)

```ts
/** A payment the office voided: moved out of `payments` whole, with who, when and why. */
export type VoidedPaymentRecord = Readonly<{
  payment: ManualPaymentRecord;
  voidedAt: string;
  voidedBy: string;
  voidedByName: string;
  reason: string;
  requestId: string;
}>;

const voidedPaymentEnvelopeSchema = z.strictObject({
  payment: z.unknown(),
  voidedAt: z.iso.datetime({ offset: true }),
  voidedBy: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  voidedByName: z.string().trim().min(1).max(160),
  reason: editPaymentReasonSchema,
  requestId: z.uuid(),
});

export function parseVoidedPaymentRecord(
  value: unknown,
): Result<VoidedPaymentRecord, readonly ValidationIssue[]> {
  const envelope = voidedPaymentEnvelopeSchema.safeParse(value);
  if (!envelope.success) return err([issue(["voidedPayment"], "invalid_voided_payment")]);
  const payment = parseManualPaymentRecord(envelope.data.payment);
  if (!payment.ok) return err(payment.error);
  return ok(Object.freeze({ ...envelope.data, payment: payment.value }));
}
```

(`issue`, `err`, `ok` already exist in that file; if `issue` is named differently, use the local helper that `parseManualPaymentRecord` uses for its issues.)

- [ ] **Step 2: Write the failing builder tests** — replace `financial-dashboard.test.ts` entirely:

```ts
import { describe, expect, it } from "vitest";
import type { InvoiceRecord, ManualPaymentRecord, VoidedPaymentRecord } from "./finance-contracts";
import type { MembershipRecord } from "../memberships/membership-contracts";
import {
  buildFinancialDashboard,
  currentFinancialMonth,
  financialDashboardSchema,
  shiftFinancialMonth,
  type FinancialDashboardSource,
} from "./financial-dashboard";

const academyId = "academy-a";
const now = "2026-10-15T12:00:00.000Z";
const audit = {
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: "owner-1",
  updatedAt: "2026-09-01T00:00:00.000Z",
  updatedBy: "owner-1",
};

function membership(overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    membershipId: "m-1", academyId, familyId: "fam-1", studentId: "stu-1",
    planId: "bpt-jersey-adult", status: "active", startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: null, nextBillingAt: "2026-10-20T00:00:00.000Z", schemaVersion: "1", ...audit,
    ...overrides,
  } as MembershipRecord;
}
function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    invoiceId: "inv-1", academyId, familyId: "fam-1", membershipId: "m-1", status: "paid",
    totalMinor: 9500, currency: "GBP", dueAt: "2026-10-01T00:00:00.000Z",
    paidAt: "2026-10-02T00:00:00.000Z", schemaVersion: 1, chargeKind: "membership",
    sourceRef: null, invoiceReference: "INV-1", description: "Monthly membership", ...audit,
    ...overrides,
  } as InvoiceRecord;
}
function payment(overrides: Partial<ManualPaymentRecord> = {}): ManualPaymentRecord {
  return {
    paymentId: "pay-1", academyId, familyId: "fam-1", invoiceId: "inv-1", status: "recorded",
    amountMinor: 9500, currency: "GBP", method: "bank_transfer", manualReference: "REF-1",
    providerReference: null, occurredAt: "2026-10-02T00:00:00.000Z", schemaVersion: 1, ...audit,
    ...overrides,
  } as ManualPaymentRecord;
}
function source(overrides: Partial<FinancialDashboardSource> = {}): FinancialDashboardSource {
  return {
    generatedAt: now, month: "2026-10", memberships: [membership()], invoices: [invoice()],
    payments: [payment()], voidedPayments: [], shopPayments: [],
    studentByInvoiceId: new Map(), planNames: new Map([["bpt-jersey-adult", "Adult unlimited"]]),
    ...overrides,
  };
}

describe("month helpers", () => {
  it("reads and shifts UTC months", () => {
    expect(currentFinancialMonth(now)).toBe("2026-10");
    expect(shiftFinancialMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftFinancialMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("buildFinancialDashboard", () => {
  it("lists the month's payments with member, source and edit/void flags", () => {
    const dashboard = buildFinancialDashboard(source());
    expect(financialDashboardSchema.safeParse(dashboard).success).toBe(true);
    expect(dashboard.metrics.collectedMinor).toBe(9500);
    expect(dashboard.metrics.paymentsReceived).toBe(1);
    expect(dashboard.payments).toEqual([
      expect.objectContaining({
        rowId: "payment:pay-1", source: "membership", studentId: "stu-1", label: "Monthly membership",
        paymentId: "pay-1", invoiceId: "inv-1", shopOrderId: null, reference: "REF-1",
        editable: true, voidable: true, voided: null,
      }),
    ]);
  });

  it("filters by the requested month only", () => {
    const dashboard = buildFinancialDashboard(source({ month: "2026-09" }));
    expect(dashboard.metrics.collectedMinor).toBe(0);
    expect(dashboard.payments).toEqual([]);
  });

  it("empty month: zero metrics, empty lists, still schema-valid", () => {
    const dashboard = buildFinancialDashboard(
      source({ month: "2025-01", memberships: [], invoices: [], payments: [] }),
    );
    expect(dashboard.metrics).toMatchObject({ collectedMinor: 0, paymentsReceived: 0, outstandingMinor: 0 });
    expect(financialDashboardSchema.safeParse(dashboard).success).toBe(true);
  });

  it("refuses a month after the current one", () => {
    expect(() => buildFinancialDashboard(source({ month: "2026-11" }))).toThrow(RangeError);
  });

  it("shows a voided payment struck out and never sums it", () => {
    const voided: VoidedPaymentRecord = {
      payment: payment(), voidedAt: "2026-10-03T00:00:00.000Z", voidedBy: "owner-1",
      voidedByName: "Owner", reason: "Recorded twice by mistake", requestId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    };
    const dashboard = buildFinancialDashboard(
      source({ invoices: [invoice({ status: "open", paidAt: null })], payments: [], voidedPayments: [voided] }),
    );
    expect(dashboard.metrics.collectedMinor).toBe(0);
    expect(dashboard.metrics.paymentsReceived).toBe(0);
    expect(dashboard.payments[0]).toMatchObject({
      rowId: "voided:pay-1", editable: false, voidable: false,
      voided: { voidedAt: "2026-10-03T00:00:00.000Z", voidedByName: "Owner", reason: "Recorded twice by mistake" },
    });
    expect(dashboard.balances).toEqual([expect.objectContaining({ invoiceId: "inv-1", balanceMinor: 9500, studentId: "stu-1" })]);
  });

  it("counts a paid shop order on its paidAt month", () => {
    const dashboard = buildFinancialDashboard(
      source({
        shopPayments: [{ orderId: "order-1", orderNumber: 7, contactName: "Ana Coelho", totalMinor: 3500,
          paidAt: "2026-10-05T10:00:00.000Z", paymentMethod: "at_collection" }],
      }),
    );
    expect(dashboard.metrics.collectedMinor).toBe(13000);
    expect(dashboard.payments[0]).toMatchObject({
      rowId: "shop:order-1", source: "shop", label: "SHOP-000007 · Ana Coelho", method: "at_collection",
      shopOrderId: "order-1", paymentId: null, editable: false, voidable: false,
    });
  });

  it("flags PAYG as neither editable nor voidable and private lessons as editable only", () => {
    const dashboard = buildFinancialDashboard(
      source({
        memberships: [],
        invoices: [
          invoice({ invoiceId: "inv-p", membershipId: null, chargeKind: "payg_session", sourceRef: "s-1", totalMinor: 1000 }),
          invoice({ invoiceId: "inv-l", membershipId: null, chargeKind: "private-lesson", sourceRef: "p-1", totalMinor: 6500 }),
        ],
        payments: [
          payment({ paymentId: "pay-p", invoiceId: "inv-p", amountMinor: 1000, method: "cash" }),
          payment({ paymentId: "pay-l", invoiceId: "inv-l", amountMinor: 6500 }),
        ],
        studentByInvoiceId: new Map([["inv-l", "stu-9"]]),
      }),
    );
    const byId = new Map(dashboard.payments.map((row) => [row.paymentId, row]));
    expect(byId.get("pay-p")).toMatchObject({ source: "payg", editable: false, voidable: false, studentId: null });
    expect(byId.get("pay-l")).toMatchObject({ source: "private_lesson", editable: true, voidable: false, studentId: "stu-9" });
  });

  it("splits renewals into overdue and due soon, with plan names", () => {
    const dashboard = buildFinancialDashboard(
      source({
        memberships: [
          membership({ membershipId: "m-1", nextBillingAt: "2026-10-20T00:00:00.000Z" }),
          membership({ membershipId: "m-2", studentId: "stu-2", nextBillingAt: "2026-10-01T00:00:00.000Z" }),
          membership({ membershipId: "m-3", studentId: "stu-3", status: "overdue", nextBillingAt: null }),
          membership({ membershipId: "m-4", studentId: "stu-4", nextBillingAt: null }),
          membership({ membershipId: "m-5", studentId: "stu-5", nextBillingAt: "2026-12-30T00:00:00.000Z" }),
        ],
        invoices: [], payments: [],
      }),
    );
    expect(dashboard.renewals.dueSoon.map((row) => row.membershipId)).toEqual(["m-1"]);
    expect(dashboard.renewals.overdue.map((row) => row.membershipId)).toEqual(["m-3", "m-2"]);
    expect(dashboard.renewals.dueSoon[0]).toMatchObject({ planName: "Adult unlimited", studentId: "stu-1" });
    expect(dashboard.metrics).toMatchObject({ renewalsDue: 1, renewalsOverdue: 2 });
  });

  it("keeps every balance row (no cap of 10)", () => {
    const invoices = Array.from({ length: 12 }, (_, index) =>
      invoice({ invoiceId: `inv-${index}`, invoiceReference: `INV-${index}`, status: "open", paidAt: null }),
    );
    const dashboard = buildFinancialDashboard(source({ invoices, payments: [] }));
    expect(dashboard.balances).toHaveLength(12);
    expect(dashboard.metrics.outstandingMinor).toBe(12 * 9500);
  });

  it("still refuses an orphan payment", () => {
    expect(() => buildFinancialDashboard(source({ invoices: [] }))).toThrow(/orphan/u);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `corepack pnpm vitest run --project node packages/domain/src/finance/financial-dashboard.test.ts`
Expected: FAIL (exports `currentFinancialMonth`, `financialDashboardSchema` … not found).

- [ ] **Step 4: Rewrite `financial-dashboard.ts`**

```ts
import { z } from "zod";

import type { MembershipRecord } from "../memberships/membership-contracts";
import type { InvoiceRecord, ManualPaymentRecord, VoidedPaymentRecord } from "./finance-contracts";

const renewalWindowMs = 30 * 24 * 60 * 60 * 1000;
const instant = z.iso.datetime({ offset: true });
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const minor = z.number().int().nonnegative();

export const financialMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);
export const financialDashboardInputSchema = z.strictObject({ month: financialMonthSchema.optional() });

export function currentFinancialMonth(timestamp: string): string {
  return new Date(timestamp).toISOString().slice(0, 7);
}

export function shiftFinancialMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, monthIndex - 1 + delta, 1)).toISOString().slice(0, 7);
}

function monthBounds(month: string): { from: string; to: string } {
  const [year, monthIndex] = month.split("-").map(Number) as [number, number];
  return {
    from: new Date(Date.UTC(year, monthIndex - 1, 1)).toISOString(),
    to: new Date(Date.UTC(year, monthIndex, 1)).toISOString(),
  };
}

const paymentRowSchema = z.strictObject({
  rowId: z.string().min(1),
  source: z.enum(["membership", "payg", "private_lesson", "course", "shop", "adjustment"]),
  occurredAt: instant,
  amountMinor: z.number().int().positive(),
  method: z.enum(["cash", "bank_transfer", "other", "at_collection"]),
  reference: z.string().nullable(),
  studentId: id.nullable(),
  label: z.string(),
  paymentId: id.nullable(),
  invoiceId: id.nullable(),
  shopOrderId: id.nullable(),
  editable: z.boolean(),
  voidable: z.boolean(),
  voided: z
    .strictObject({ voidedAt: instant, voidedByName: z.string(), reason: z.string() })
    .nullable(),
});
const balanceRowSchema = z.strictObject({
  invoiceId: id,
  invoiceReference: z.string(),
  studentId: id.nullable(),
  label: z.string(),
  dueAt: instant,
  balanceMinor: z.number().int().positive(),
  overdue: z.boolean(),
  status: z.enum(["open", "partially_paid"]),
});
const renewalRowSchema = z.strictObject({
  membershipId: id,
  studentId: id,
  planId: z.string(),
  planName: z.string(),
  nextBillingAt: instant.nullable(),
  status: z.enum(["trial", "active", "overdue"]),
});

export const financialDashboardSchema = z.strictObject({
  currency: z.literal("GBP"),
  generatedAt: instant,
  month: financialMonthSchema,
  period: z.strictObject({ from: instant, to: instant }),
  metrics: z.strictObject({
    collectedMinor: minor,
    paymentsReceived: minor,
    outstandingMinor: minor,
    overdueBalances: minor,
    renewalsDue: minor,
    renewalsOverdue: minor,
    activeMemberships: minor,
  }),
  payments: z.array(paymentRowSchema),
  balances: z.array(balanceRowSchema),
  renewals: z.strictObject({ overdue: z.array(renewalRowSchema), dueSoon: z.array(renewalRowSchema) }),
});

export type FinancialDashboard = z.infer<typeof financialDashboardSchema>;
export type FinancialDashboardPaymentRow = z.infer<typeof paymentRowSchema>;
export type FinancialDashboardBalanceRow = z.infer<typeof balanceRowSchema>;
export type FinancialDashboardRenewalRow = z.infer<typeof renewalRowSchema>;

export type DashboardShopPayment = Readonly<{
  orderId: string;
  orderNumber: number | null;
  contactName: string;
  totalMinor: number;
  paidAt: string;
  paymentMethod: "bank_transfer" | "at_collection";
}>;

export type FinancialDashboardSource = Readonly<{
  generatedAt: string;
  month: string;
  memberships: readonly MembershipRecord[];
  invoices: readonly InvoiceRecord[];
  payments: readonly ManualPaymentRecord[];
  voidedPayments: readonly VoidedPaymentRecord[];
  shopPayments: readonly DashboardShopPayment[];
  /** Private lesson invoices carry no membership; their purchase names the student. */
  studentByInvoiceId: ReadonlyMap<string, string>;
  planNames: ReadonlyMap<string, string>;
}>;

function safeSum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) throw new RangeError("Financial dashboard amount overflow");
  }
  return total;
}

function uniqueById<T>(items: readonly T[], key: (item: T) => string): readonly T[] {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(key(item))) throw new Error("Financial dashboard source contains duplicate IDs");
    seen.add(key(item));
  }
  return items;
}

function sourceOf(invoice: InvoiceRecord): FinancialDashboardPaymentRow["source"] {
  if (invoice.schemaVersion === 2) return "course";
  switch (invoice.chargeKind) {
    case "membership":
      return "membership";
    case "payg_session":
      return "payg";
    case "private-lesson":
      return "private_lesson";
    default:
      return "adjustment";
  }
}

/** Same guards editManualPayment enforces; void also leaves lesson credits and courses alone. */
function editable(invoice: InvoiceRecord, payment: ManualPaymentRecord): boolean {
  return (
    invoice.schemaVersion === 1 &&
    payment.schemaVersion === 1 &&
    invoice.chargeKind !== "payg_session" &&
    invoice.status !== "void"
  );
}

function voidable(invoice: InvoiceRecord, payment: ManualPaymentRecord): boolean {
  return (
    editable(invoice, payment) &&
    (invoice.chargeKind === "membership" || invoice.chargeKind === "manual_adjustment")
  );
}

function inRange(timestamp: string, from: string, to: string): boolean {
  const value = Date.parse(timestamp);
  return value >= Date.parse(from) && value < Date.parse(to);
}

function shopLabel(order: DashboardShopPayment): string {
  const number = order.orderNumber === null ? "Shop order" : `SHOP-${String(order.orderNumber).padStart(6, "0")}`;
  return `${number} · ${order.contactName}`;
}

export function buildFinancialDashboard(source: FinancialDashboardSource): FinancialDashboard {
  const generatedAtMs = Date.parse(source.generatedAt);
  if (Number.isNaN(generatedAtMs)) throw new Error("Invalid dashboard generation timestamp");
  if (!financialMonthSchema.safeParse(source.month).success) throw new RangeError("Invalid month");
  if (source.month > currentFinancialMonth(source.generatedAt)) {
    throw new RangeError("The month has not started yet");
  }
  const period = monthBounds(source.month);
  const memberships = uniqueById(source.memberships, (record) => record.membershipId);
  const invoices = uniqueById(source.invoices, (record) => record.invoiceId);
  const payments = uniqueById(source.payments, (record) => record.paymentId);
  const membershipById = new Map(memberships.map((record) => [record.membershipId, record]));
  const invoiceById = new Map(invoices.map((record) => [record.invoiceId, record]));

  const studentFor = (invoice: InvoiceRecord): string | null =>
    (invoice.membershipId === null ? undefined : membershipById.get(invoice.membershipId)?.studentId) ??
    source.studentByInvoiceId.get(invoice.invoiceId) ??
    null;

  const paidByInvoice = new Map<string, number>();
  for (const payment of payments) {
    if (!invoiceById.has(payment.invoiceId)) {
      throw new Error("Financial dashboard source contains an orphan payment");
    }
    paidByInvoice.set(
      payment.invoiceId,
      safeSum([paidByInvoice.get(payment.invoiceId) ?? 0, payment.amountMinor]),
    );
  }

  const paymentRows: FinancialDashboardPaymentRow[] = [];
  for (const payment of payments) {
    if (!inRange(payment.occurredAt, period.from, period.to)) continue;
    const invoice = invoiceById.get(payment.invoiceId)!;
    paymentRows.push({
      rowId: `payment:${payment.paymentId}`,
      source: sourceOf(invoice),
      occurredAt: payment.occurredAt,
      amountMinor: payment.amountMinor,
      method: payment.method,
      reference: payment.manualReference,
      studentId: studentFor(invoice),
      label: invoice.description,
      paymentId: payment.paymentId,
      invoiceId: invoice.invoiceId,
      shopOrderId: null,
      editable: editable(invoice, payment),
      voidable: voidable(invoice, payment),
      voided: null,
    });
  }
  for (const record of source.voidedPayments) {
    const { payment } = record;
    if (!inRange(payment.occurredAt, period.from, period.to)) continue;
    const invoice = invoiceById.get(payment.invoiceId);
    paymentRows.push({
      rowId: `voided:${payment.paymentId}`,
      source: invoice ? sourceOf(invoice) : "adjustment",
      occurredAt: payment.occurredAt,
      amountMinor: payment.amountMinor,
      method: payment.method,
      reference: payment.manualReference,
      studentId: invoice ? studentFor(invoice) : null,
      label: invoice?.description ?? "Voided payment",
      paymentId: payment.paymentId,
      invoiceId: payment.invoiceId,
      shopOrderId: null,
      editable: false,
      voidable: false,
      voided: { voidedAt: record.voidedAt, voidedByName: record.voidedByName, reason: record.reason },
    });
  }
  for (const order of source.shopPayments) {
    if (!inRange(order.paidAt, period.from, period.to)) continue;
    paymentRows.push({
      rowId: `shop:${order.orderId}`,
      source: "shop",
      occurredAt: order.paidAt,
      amountMinor: order.totalMinor,
      method: order.paymentMethod,
      reference: null,
      studentId: null,
      label: shopLabel(order),
      paymentId: null,
      invoiceId: null,
      shopOrderId: order.orderId,
      editable: false,
      voidable: false,
      voided: null,
    });
  }
  paymentRows.sort(
    (left, right) =>
      right.occurredAt.localeCompare(left.occurredAt) || left.rowId.localeCompare(right.rowId),
  );
  const counted = paymentRows.filter((row) => row.voided === null);

  const balances: FinancialDashboardBalanceRow[] = [];
  for (const invoice of invoices) {
    if (invoice.status === "void") continue;
    const balanceMinor = Math.max(0, invoice.totalMinor - (paidByInvoice.get(invoice.invoiceId) ?? 0));
    if (balanceMinor === 0) continue;
    if (invoice.status !== "open" && invoice.status !== "partially_paid") {
      throw new Error("Financial dashboard source contains an inconsistent invoice status");
    }
    balances.push({
      invoiceId: invoice.invoiceId,
      invoiceReference: invoice.invoiceReference,
      studentId: studentFor(invoice),
      label: invoice.description,
      dueAt: invoice.dueAt,
      balanceMinor,
      overdue: Date.parse(invoice.dueAt) < generatedAtMs,
      status: invoice.status,
    });
  }
  balances.sort(
    (left, right) =>
      Number(right.overdue) - Number(left.overdue) ||
      left.dueAt.localeCompare(right.dueAt) ||
      left.invoiceId.localeCompare(right.invoiceId),
  );

  const renewalRow = (membership: MembershipRecord): FinancialDashboardRenewalRow => ({
    membershipId: membership.membershipId,
    studentId: membership.studentId,
    planId: membership.planId,
    planName: source.planNames.get(membership.planId) ?? membership.planId,
    nextBillingAt: membership.nextBillingAt,
    status: membership.status as FinancialDashboardRenewalRow["status"],
  });
  const byDate = (left: MembershipRecord, right: MembershipRecord) =>
    (left.nextBillingAt ?? "").localeCompare(right.nextBillingAt ?? "") ||
    left.membershipId.localeCompare(right.membershipId);
  const current = memberships.filter((m) => m.status === "active" || m.status === "trial");
  const overdue = memberships
    .filter(
      (m) =>
        m.status === "overdue" ||
        ((m.status === "active" || m.status === "trial") &&
          m.nextBillingAt !== null &&
          Date.parse(m.nextBillingAt) < generatedAtMs),
    )
    .sort(byDate)
    .map(renewalRow);
  const dueSoon = current
    .filter(
      (m) =>
        m.nextBillingAt !== null &&
        Date.parse(m.nextBillingAt) >= generatedAtMs &&
        Date.parse(m.nextBillingAt) <= generatedAtMs + renewalWindowMs,
    )
    .sort(byDate)
    .map(renewalRow);

  return {
    currency: "GBP",
    generatedAt: source.generatedAt,
    month: source.month,
    period,
    metrics: {
      collectedMinor: safeSum(counted.map((row) => row.amountMinor)),
      paymentsReceived: counted.length,
      outstandingMinor: safeSum(balances.map((row) => row.balanceMinor)),
      overdueBalances: balances.filter((row) => row.overdue).length,
      renewalsDue: dueSoon.length,
      renewalsOverdue: overdue.length,
      activeMemberships: memberships.filter((m) => m.status === "active").length,
    },
    payments: paymentRows,
    balances,
    renewals: { overdue, dueSoon },
  };
}
```

Note: the overdue sort puts `nextBillingAt: null` (`""`) first, which the test expects (`m-3` before `m-2`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `corepack pnpm vitest run --project node packages/domain/src/finance/financial-dashboard.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Typecheck the domain package**

Run: `corepack pnpm --filter @bpt-jersey/domain typecheck`
Expected: no errors. (Functions/web will fail typecheck until Tasks 3 and 6; that is expected here.)

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/finance/financial-dashboard.ts packages/domain/src/finance/financial-dashboard.test.ts packages/domain/src/finance/finance-contracts.ts
git commit -m "feat(finance): month-aware dashboard read model with voided and shop payments"
```

---

### Task 2: Domain — void input contract and audit action

**Files:**
- Modify: `packages/domain/src/finance/finance-contracts.ts`
- Modify: `packages/domain/src/audit/audit-event.ts` (5 places where `"payment.edited"` appears: action list ~L46, discriminated type ~L364, field map ~L501, validation ~L1163/1172, result ~L1253)
- Test: `packages/domain/src/finance/finance-contracts.test.ts`, `packages/domain/src/audit/audit-event.test.ts` (append)

**Interfaces:**
- Produces: `voidManualPaymentInputSchema = z.strictObject({ paymentId, reason: editPaymentReasonSchema, requestId: z.uuid() })`, `type VoidManualPaymentInput`. Audit action `"payment.voided"` with fields `amountMinor`, `currency`, `method` (same as `payment.edited`).

- [ ] **Step 1: Failing tests** (append)

```ts
// finance-contracts.test.ts
import { voidManualPaymentInputSchema } from "./finance-contracts";
describe("voidManualPaymentInputSchema", () => {
  const valid = { paymentId: "payment-1", reason: "Recorded twice by mistake", requestId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" };
  it("accepts a paymentId, a 10+ char reason and a uuid", () => {
    expect(voidManualPaymentInputSchema.safeParse(valid).success).toBe(true);
  });
  it("refuses a short reason, extra fields and a non-uuid request", () => {
    expect(voidManualPaymentInputSchema.safeParse({ ...valid, reason: "oops" }).success).toBe(false);
    expect(voidManualPaymentInputSchema.safeParse({ ...valid, amountMinor: 1 }).success).toBe(false);
    expect(voidManualPaymentInputSchema.safeParse({ ...valid, requestId: "x" }).success).toBe(false);
  });
});
```

```ts
// audit-event.test.ts — copy the existing "payment.edited" draft test, change action to "payment.voided",
// and assert parseAuditEventDraft(draft).ok === true; then the same draft without `method` → ok === false.
```

- [ ] **Step 2: Run** `corepack pnpm vitest run --project node packages/domain/src/finance/finance-contracts.test.ts packages/domain/src/audit/audit-event.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// finance-contracts.ts, under editManualPaymentInputSchema
/** Office void of a recorded payment: the document moves to voidedPayments with the reason. */
export const voidManualPaymentInputSchema = z.strictObject({
  paymentId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  reason: editPaymentReasonSchema,
  requestId: z.uuid(),
});
export type VoidManualPaymentInput = z.infer<typeof voidManualPaymentInputSchema>;
```

In `audit-event.ts`, add `"payment.voided"` next to every `"payment.edited"` (list, union `action: "payment.recorded" | "payment.edited" | "payment.voided"`, field map entry identical to `payment.edited`, both validation conditions, and the result branch).

- [ ] **Step 4: Run** the same command → PASS. Then `corepack pnpm --filter @bpt-jersey/domain build:runtime` → exits 0.

- [ ] **Step 5: Commit** `git commit -m "feat(finance): void payment input contract and payment.voided audit action"`

---

### Task 3: Functions — `voidManualPayment` store method and callable

**Files:**
- Modify: `apps/functions/src/finance/finance-service.ts`
- Modify: `apps/functions/src/finance/finance-callables.ts`
- Modify: `apps/functions/src/index.ts` (add `voidManualPayment` to the finance export list next to `editManualPayment`)
- Test: `apps/functions/src/finance/finance-service.test.ts`, `apps/functions/src/finance/finance-callables.test.ts`

**Interfaces:**
- Consumes: `voidManualPaymentInputSchema`, `VoidedPaymentRecord`, `parseVoidedPaymentRecord` (Tasks 1–2).
- Produces: `FinanceStore.voidManualPayment(input: VoidManualPaymentStoreInput): Promise<VoidManualPaymentResult>` where
  `VoidManualPaymentStoreInput = { academyId; actorId; actorName; paymentId; reason; requestId }` and
  `VoidManualPaymentResult = Readonly<{ paymentId: string; invoiceId: string; invoiceStatus: InvoiceStatus }>`.
  Callable `voidManualPayment` returns `VoidManualPaymentResult`. `FinanceTransaction` gains `delete(ref): FinanceTransaction`.
- Error messages surfaced as `failed-precondition` (add to `editRefusals`-style map `voidRefusals`):
  - `"Only membership and adjustment payments can be voided here."`
  - `"This void was already sent for another payment."`

- [ ] **Step 1: Extend the test fake** in `finance-service.test.ts`: inside `runTransaction`'s `transaction` object add

```ts
        delete: (target: Ref) => {
          writes.push(`delete:${target.path}`);
          records.delete(target.path);
          return transaction;
        },
```

- [ ] **Step 2: Failing service tests** (append a `describe("voidManualPayment")`, using the file's existing `seedSources()`, `recordManualPayment` helpers and constants; the snippet uses the names this file already defines — `academyId`, `membershipId`, `familyId`, `createStore`/`fakeFirestore`; adapt to their exact names):

```ts
describe("voidManualPayment", () => {
  const requestId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  async function seededPaidInvoice() {
    const fake = fakeFirestore(seedSources());
    const store = createFinanceStore({ firestore: fake.firestore, appendAudit: fake.appendAudit, now: () => "2026-10-02T10:00:00.000Z" });
    const invoice = await store.issueManualInvoice(/* the file's standard membership invoice input, totalMinor 9500 */);
    const payment = await store.recordManualPayment(/* full 9500 payment on that invoice */);
    return { fake, store, invoice, payment };
  }

  it("moves the payment to voidedPayments and reopens the invoice", async () => {
    const { fake, store, invoice, payment } = await seededPaidInvoice();
    const result = await store.voidManualPayment({
      academyId, actorId: "owner-1", actorName: "Owner", paymentId: payment.paymentId,
      reason: "Recorded twice by mistake", requestId,
    });
    expect(result).toEqual({ paymentId: payment.paymentId, invoiceId: invoice.invoiceId, invoiceStatus: "open" });
    expect(fake.records.has(`academies/${academyId}/payments/${payment.paymentId}`)).toBe(false);
    const moved = fake.records.get(`academies/${academyId}/voidedPayments/${payment.paymentId}`);
    expect(moved).toMatchObject({ voidedBy: "owner-1", voidedByName: "Owner", reason: "Recorded twice by mistake", requestId });
    expect(fake.records.get(`academies/${academyId}/invoices/${invoice.invoiceId}`)).toMatchObject({ status: "open", paidAt: null });
    expect(fake.audits.map((entry) => entry.action)).toContain("payment.voided");
  });

  it("leaves a partial status when other payments remain", async () => {
    // issue 9500, pay 5000 + 4500, void the 4500 → invoiceStatus "partially_paid"
  });

  it("replays the stored result after the payment moved (same requestId)", async () => {
    const { store, payment } = await seededPaidInvoice();
    const input = { academyId, actorId: "owner-1", actorName: "Owner", paymentId: payment.paymentId, reason: "Recorded twice by mistake", requestId };
    const first = await store.voidManualPayment(input);
    await expect(store.voidManualPayment(input)).resolves.toEqual(first);
  });

  it("refuses the same requestId for another payment", async () => {
    // void payment A with requestId, then call with payment B and the same requestId →
    // rejects FinanceStoreError code "conflict", message "Request id was already used for another void"
  });

  it("refuses PAYG, private lesson and void-invoice payments", async () => {
    // seed an invoice with chargeKind "payg_session" (use store.issuePaygInvoice) + payment → rejects code "precondition",
    // message "Only membership and adjustment payments can be voided here."
  });
});
```

Write the two stubbed cases fully in the same style before running (no comments-as-tests).

- [ ] **Step 3: Run** `corepack pnpm vitest run --project node apps/functions/src/finance/finance-service.test.ts -t voidManualPayment` → FAIL (`store.voidManualPayment is not a function`).

- [ ] **Step 4: Implement in `finance-service.ts`**

1. `FinanceTransaction` type: add `delete: (ref: FinanceDocumentReference) => FinanceTransaction;`
2. `FinanceAuditAction`: add `| "payment.voided"`.
3. Path helpers next to `paymentEditReceiptPath`:

```ts
function paymentVoidReceiptPath(academyId: string, actorId: string, requestId: string): string {
  const key = createHash("sha256").update(`${actorId}:${requestId}`).digest("hex").slice(0, 40);
  return `academies/${pathSegment(academyId, "academy")}/paymentVoidReceipts/void-${key}`;
}

function voidedPaymentPath(academyId: string, paymentId: string): string {
  return `academies/${pathSegment(academyId, "academy")}/voidedPayments/${pathSegment(paymentId, "payment")}`;
}
```

4. Types next to `EditManualPaymentResult`:

```ts
export type VoidManualPaymentStoreInput = Readonly<{
  academyId: string; actorId: string; actorName: string; paymentId: string; reason: string; requestId: string;
}>;
export type VoidManualPaymentResult = Readonly<{ paymentId: string; invoiceId: string; invoiceStatus: InvoiceStatus }>;
```

and `voidManualPayment: (input: VoidManualPaymentStoreInput) => Promise<VoidManualPaymentResult>;` in `FinanceStore`.

5. The method, placed after `editManualPayment` and added to the returned store object:

```ts
  /**
   * Office voids a recorded membership/adjustment payment. The document moves whole to
   * voidedPayments (the strict payment parser elsewhere never sees a new field), the invoice
   * status follows the remaining payments, and membership dates are left alone on purpose.
   */
  async function voidManualPayment(input: VoidManualPaymentStoreInput): Promise<VoidManualPaymentResult> {
    const current = now();
    const academy = pathSegment(input.academyId, "academy");
    const actorId = pathSegment(input.actorId, "actor");
    const id = pathSegment(input.paymentId, "payment");
    const reason = editPaymentReasonSchema.safeParse(input.reason);
    if (!reason.success) throw new FinanceStoreError("invalid", "Invalid void reason");
    const actorName = input.actorName.trim().slice(0, 160);
    if (actorName.length === 0 || /[\u0000-\u001f\u007f]/u.test(actorName)) {
      throw new FinanceStoreError("invalid", "Invalid editor name");
    }
    const receiptRef = dependencies.firestore.doc(paymentVoidReceiptPath(academy, actorId, input.requestId));
    return dependencies.firestore.runTransaction(async (transaction) => {
      const receipt = documentSnapshot(await transaction.get(receiptRef));
      if (receipt.exists) {
        const stored = receipt.data()?.result as Record<string, unknown> | undefined;
        if (stored?.paymentId !== id) {
          throw new FinanceStoreError("conflict", "Request id was already used for another void");
        }
        if (
          !safePathSegmentPattern.test(String(stored.invoiceId)) ||
          !invoiceStatuses.includes(stored.invoiceStatus as InvoiceStatus)
        ) {
          throw new FinanceStoreError("invalid", "Stored payment void receipt is invalid");
        }
        return Object.freeze({ paymentId: id, invoiceId: String(stored.invoiceId), invoiceStatus: stored.invoiceStatus as InvoiceStatus });
      }
      const paymentRef = dependencies.firestore.doc(paymentPath(academy, id));
      const payment = parseScopedStoredPayment(documentSnapshot(await transaction.get(paymentRef)), academy);
      const invoiceRef = dependencies.firestore.doc(invoicePath(academy, payment.invoiceId));
      const invoice = parseScopedStoredInvoice(documentSnapshot(await transaction.get(invoiceRef)), academy);
      assertPaymentInvoiceScope(payment, invoice);
      if (
        payment.schemaVersion !== 1 ||
        invoice.schemaVersion !== 1 ||
        invoice.status === "void" ||
        (invoice.chargeKind !== "membership" && invoice.chargeKind !== "manual_adjustment")
      ) {
        throw new FinanceStoreError("precondition", "Only membership and adjustment payments can be voided here.");
      }
      const remaining = (await paymentsFor(transaction, academy, invoice)).filter(
        (candidate) => candidate.paymentId !== payment.paymentId,
      );
      const paidMinor = remaining.reduce(
        (total, candidate) => total + (candidate.status === "recorded" ? candidate.amountMinor : 0),
        0,
      );
      const invoiceStatus: InvoiceStatus =
        paidMinor >= invoice.totalMinor ? "paid" : paidMinor > 0 ? "partially_paid" : "open";
      const result: VoidManualPaymentResult = Object.freeze({
        paymentId: payment.paymentId, invoiceId: invoice.invoiceId, invoiceStatus,
      });
      const voided: VoidedPaymentRecord = Object.freeze({
        payment, voidedAt: current, voidedBy: actorId, voidedByName: actorName,
        reason: reason.data, requestId: input.requestId,
      });
      transaction.create(dependencies.firestore.doc(voidedPaymentPath(academy, payment.paymentId)), voided);
      transaction.delete(paymentRef);
      transaction.set(invoiceRef, {
        ...invoice,
        status: invoiceStatus,
        paidAt: invoiceStatus === "paid" ? invoice.paidAt : null,
        updatedAt: current,
        updatedBy: actorId,
      });
      transaction.create(receiptRef, { result, createdAt: current });
      dependencies.appendAudit(transaction, dependencies.firestore.doc(auditPath(academy, generateAuditId())), {
        academyId: academy, actorId, action: "payment.voided",
        targetRef: paymentPath(academy, payment.paymentId), purpose: "manual payment voided",
        correlationId: input.requestId, amountMinor: payment.amountMinor, currency: "GBP", method: payment.method,
      });
      if (invoiceStatus !== invoice.status) {
        dependencies.appendAudit(transaction, dependencies.firestore.doc(auditPath(academy, generateAuditId())), {
          academyId: academy, actorId, action: "invoice.status.changed",
          targetRef: invoicePath(academy, invoice.invoiceId),
          purpose: "invoice status recalculated after a payment void",
          correlationId: input.requestId, amountMinor: invoice.totalMinor, currency: "GBP",
        });
      }
      return result;
    });
  }
```

Note on reads-before-writes: Firestore transactions require every `get` before any write — the method above does all `get`s (receipt, payment, invoice, `paymentsFor`) first. Keep it that way.

- [ ] **Step 5: Run** the service tests → PASS. Then disable the chargeKind guard (comment the condition), rerun, confirm "refuses PAYG…" fails, restore (LECCIONES §4).

- [ ] **Step 6: Callable** in `finance-callables.ts`:

```ts
const voidRefusals: Readonly<Record<string, string>> = Object.freeze({
  "Only membership and adjustment payments can be voided here.":
    "Only membership and adjustment payments can be voided here.",
  "Request id was already used for another void": "This void was already sent for another payment.",
});

export async function voidManualPaymentHandler(request: CallableRequest<unknown>, services: FinanceCallableServices) {
  const actor = await requireAdministrator(request, services);
  const parsed = voidManualPaymentInputSchema.safeParse(request.data);
  if (!parsed.success) return invalidPayload();
  try {
    const name = (await services.actorDisplayName?.(actor))?.trim();
    return await services.store.voidManualPayment({
      ...parsed.data, academyId: actor.academyId, actorId: actor.userId, actorName: name ? name : "Office",
    });
  } catch (error) {
    if (error instanceof FinanceStoreError && Object.hasOwn(voidRefusals, error.message)) {
      throw new FinanceCallableError("failed-precondition", voidRefusals[error.message]!);
    }
    return mapStoreError(error, "write");
  }
}

export const voidManualPayment = onCall(editManualPaymentCallableOptions, async (request) =>
  voidManualPaymentHandler(request, financeCallableServices()),
);
```

Callable test (append to `finance-callables.test.ts`, mirroring the existing `editManualPaymentHandler` tests): a coach role → `permission-denied`; invalid payload → `invalid-argument`; store throwing `FinanceStoreError("precondition", "Only membership and adjustment payments can be voided here.")` → `failed-precondition` with that message; happy path passes `actorName` from `actorDisplayName`.

- [ ] **Step 7: Export** `voidManualPayment` in `apps/functions/src/index.ts` in the same export block as `editManualPayment`.

- [ ] **Step 8: Run** `corepack pnpm vitest run --project node apps/functions/src/finance` → PASS; `corepack pnpm --filter @bpt-jersey/functions typecheck` → the only errors left are in the dashboard service (Task 5).

- [ ] **Step 9: Commit** `git commit -m "feat(finance): voidManualPayment moves a payment to voidedPayments with reason and audit"`

---

### Task 4: Shop — record `paidAt`

**Files:**
- Modify: `packages/domain/src/shop/shop-contracts.ts` (`shopOrderBaseSchema`)
- Modify: `apps/functions/src/shop/shop-service.ts` (`updateOrder`)
- Test: `apps/functions/src/shop/shop-service.test.ts`, `packages/domain/src/shop/shop-contracts.test.ts`

**Interfaces:**
- Produces: `ShopOrderRecord.paidAt?: string | null`.

- [ ] **Step 1: Failing tests**
  - contracts: an existing valid order fixture without `paidAt` still parses; with `paidAt: "2026-10-01T10:00:00.000Z"` parses; with `paidAt: "yesterday"` fails.
  - service (use the file's existing order seed + `updateOrder` helper): `unpaid → paid` sets `paidAt` to `input.now`; `paid → unpaid` sets `paidAt: null`; a status-only update on a paid order keeps the existing `paidAt`; `paid → unpaid → paid` with three different `now` values ends with the last `now`.
- [ ] **Step 2: Run** `corepack pnpm vitest run --project node packages/domain/src/shop apps/functions/src/shop` → FAIL.
- [ ] **Step 3: Implement**

```ts
// shop-contracts.ts, inside shopOrderBaseSchema after paymentStatus
  // Optional: orders paid before 2026-10 carry no field; the dashboard dates those by updatedAt.
  paidAt: dateTimeSchema.nullable().optional(),
```

```ts
// shop-service.ts updateOrder, replace the candidate construction
        const nextPayment = update.paymentStatus ?? existing.paymentStatus;
        const paidAt =
          nextPayment === "paid"
            ? existing.paymentStatus === "paid"
              ? existing.paidAt
              : now
            : null;
        const candidate = parseShopOrderRecord({
          ...existing,
          status: nextStatus,
          paymentStatus: nextPayment,
          ...(paidAt === undefined ? {} : { paidAt }),
          staffNote: update.staffNote === undefined ? existing.staffNote : update.staffNote,
          updatedAt: now,
          updatedBy: actorId,
        });
```

- [ ] **Step 4: Run** → PASS. Also run the web shop tests that parse projections: `corepack pnpm vitest run --project web apps/web/src/lib/shop` → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(shop): record when an order was marked paid"`

---

### Task 5: Functions — dashboard store v2 and callable input

**Files:**
- Modify: `apps/functions/src/finance/financial-dashboard-service.ts`
- Modify: `apps/functions/src/finance/financial-dashboard-callables.ts`
- Test: `apps/functions/src/finance/financial-dashboard-service.test.ts`, `apps/functions/src/finance/financial-dashboard-callables.test.ts`

**Interfaces:**
- Consumes: `buildFinancialDashboard`, `financialDashboardInputSchema`, `currentFinancialMonth`, `DashboardShopPayment` (Task 1); `parseVoidedPaymentRecord` (Task 1); `parseShopOrderRecord` (Task 4).
- Produces: `FinancialDashboardStore.getFinancialDashboard(academyId: string, month?: string): Promise<FinancialDashboard>`. Store error code `"month"` for a future month → callable `invalid-argument`.

- [ ] **Step 1: Update the store tests.** Keep the file's fake (`collection(path).limit(n).get()`), add empty collections for `voidedPayments`, `shopOrders`, `plans`, `privateLessonPurchases` to the fake's map, rewrite assertions to the v2 shape, and add:
  - month argument: payments in September only appear with `"2026-09"`.
  - a stored voided payment (`voidedPayments/pay-x` with the `VoidedPaymentRecord` shape) shows as a voided row.
  - a paid, non-cancelled shop order with `paidAt` is counted; a cancelled paid order is not; a paid order without `paidAt` is dated by `updatedAt`.
  - `plans/bpt-jersey-adult` `{ displayName: "Adult unlimited" }` gives `planName`; a plan doc without `displayName` falls back to the id.
  - `privateLessonPurchases/p-1` `{ invoiceId: "inv-l", studentId: "stu-9" }` maps the student.
  - future month → rejects `FinancialDashboardStoreError` with code `"month"`.
  - a malformed `voidedPayments` doc → rejects code `"invalid"` (integrity first, as with payments).
- [ ] **Step 2: Run** `corepack pnpm vitest run --project node apps/functions/src/finance/financial-dashboard-service.test.ts` → FAIL.
- [ ] **Step 3: Implement**

```ts
// financial-dashboard-service.ts — changes only
import {
  buildFinancialDashboard,
  currentFinancialMonth,
  type DashboardShopPayment,
  type FinancialDashboard,
} from "@bpt-jersey/domain/finance/dashboard";
import { parseVoidedPaymentRecord, type VoidedPaymentRecord /* + existing imports */ } from "@bpt-jersey/domain/finance";
import { parseShopOrderRecord } from "@bpt-jersey/domain/shop";

export type FinancialDashboardStore = Readonly<{
  getFinancialDashboard: (academyId: string, month?: string) => Promise<FinancialDashboard>;
}>;
// error code union gains "month"

function voidedFrom(documents: readonly DashboardDocument[], academyId: string): readonly VoidedPaymentRecord[] {
  return documents.map((document) => {
    const parsed = parseVoidedPaymentRecord(document.data());
    if (!parsed.ok || parsed.value.payment.paymentId !== document.id) {
      throw new FinancialDashboardStoreError("invalid", "Invalid voided payment source");
    }
    if (parsed.value.payment.academyId !== academyId) {
      throw new FinancialDashboardStoreError("tenant", "Voided payment tenant mismatch");
    }
    return parsed.value;
  });
}

function shopPaymentsFrom(documents: readonly DashboardDocument[], academyId: string): readonly DashboardShopPayment[] {
  const rows: DashboardShopPayment[] = [];
  for (const document of documents) {
    const parsed = parseShopOrderRecord(document.data());
    if (!parsed.ok || parsed.value.orderId !== document.id) {
      throw new FinancialDashboardStoreError("invalid", "Invalid shop order source");
    }
    const order = parsed.value;
    if (order.academyId !== academyId) throw new FinancialDashboardStoreError("tenant", "Shop order tenant mismatch");
    if (order.paymentStatus !== "paid" || order.status === "cancelled") continue;
    rows.push({
      orderId: order.orderId,
      orderNumber: order.orderNumber ?? null,
      contactName: order.contactName,
      totalMinor: order.totalMinor,
      // ponytail: orders paid before paidAt existed (none in prod on 2026-10-01) fall back to updatedAt.
      paidAt: order.paidAt ?? order.updatedAt,
      paymentMethod: order.paymentMethod,
    });
  }
  return rows;
}

// Lookups only: a plan name or a lesson's student. Tolerant on purpose so a plan/lesson schema
// change never takes the money page down; a missing value falls back to the id / the invoice label.
function stringField(document: DashboardDocument, field: string): string | undefined {
  const data = document.data();
  const value = typeof data === "object" && data !== null ? (data as Record<string, unknown>)[field] : undefined;
  return typeof value === "string" && value.trim() ? value : undefined;
}
```

In `getFinancialDashboard(academyIdInput, monthInput?)`:

```ts
      const generatedAt = timestamp(options.now?.() ?? new Date().toISOString());
      const month = monthInput ?? currentFinancialMonth(generatedAt);
      if (month > currentFinancialMonth(generatedAt)) {
        throw new FinancialDashboardStoreError("month", "The month has not started yet");
      }
      // ponytail: full scans of every source (≈60 docs each on 2026-10-01); move to month-ranged
      // queries plus a running aggregate when any collection nears financialDashboardSourceLimit.
      const read = (name: string) =>
        options.firestore.collection(collectionPath(academyId, name)).limit(sourceReadLimit).get();
      const [membershipSnapshot, invoiceSnapshot, paymentSnapshot, voidedSnapshot, shopSnapshot, planSnapshot, lessonSnapshot] =
        await Promise.all([read("memberships"), read("invoices"), read("payments"), read("voidedPayments"),
          read("shopOrders"), read("plans"), read("privateLessonPurchases")]);
      const memberships = membershipsFrom(boundedDocuments(membershipSnapshot), academyId);
      const invoices = invoicesFrom(boundedDocuments(invoiceSnapshot), academyId);
      const payments = paymentsFrom(boundedDocuments(paymentSnapshot), academyId);
      validateRelationships(memberships, invoices, payments);
      const planNames = new Map<string, string>();
      for (const document of boundedDocuments(planSnapshot)) {
        const name = stringField(document, "displayName");
        if (name) planNames.set(document.id, name);
      }
      const studentByInvoiceId = new Map<string, string>();
      for (const document of boundedDocuments(lessonSnapshot)) {
        const invoiceId = stringField(document, "invoiceId");
        const studentId = stringField(document, "studentId");
        if (invoiceId && studentId) studentByInvoiceId.set(invoiceId, studentId);
      }
      return buildFinancialDashboard({
        generatedAt, month, memberships, invoices, payments,
        voidedPayments: voidedFrom(boundedDocuments(voidedSnapshot), academyId),
        shopPayments: shopPaymentsFrom(boundedDocuments(shopSnapshot), academyId),
        studentByInvoiceId, planNames,
      });
```

Callable (`financial-dashboard-callables.ts`): replace `requireNoPayload` with

```ts
function parsePayload(value: unknown): string | undefined {
  // null stays valid so the web build live during a deploy keeps working.
  if (value === null) return undefined;
  const parsed = financialDashboardInputSchema.safeParse(value);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Financial dashboard payload is invalid");
  return parsed.data.month;
}
```

call `services.store.getFinancialDashboard(actor.academyId, parsePayload(request.data))`, and map `FinancialDashboardStoreError` code `"month"` → `HttpsError("invalid-argument", "That month has not started yet")`. Callable tests: `null` OK; `{ month: "2026-09" }` passes the month to the store; `{ month: "Sept" }` and `{ extra: 1 }` → `invalid-argument`; store `"month"` error → `invalid-argument`.

- [ ] **Step 4: Run** `corepack pnpm vitest run --project node apps/functions/src/finance` → PASS; `corepack pnpm --filter @bpt-jersey/functions typecheck` → clean.
- [ ] **Step 5: Commit** `git commit -m "feat(finance): dashboard callable reads voided payments, paid shop orders, plan names by month"`

---

### Task 6: Web — clients

**Files:**
- Modify: `apps/web/src/lib/finance-client.ts`
- Modify: `apps/web/src/lib/billing-client.ts`
- Test: `apps/web/src/lib/finance-client.test.ts` (create if absent), `apps/web/src/lib/billing-client.test.ts`

**Interfaces:**
- Produces: `getFinancialDashboard(month?: string): Promise<FinancialDashboard>` (throws `Error("Unable to load the financial dashboard. Please try again.")`); `voidManualPayment(input: VoidManualPaymentInput): Promise<{ ok: true; invoiceStatus: InvoiceStatus } | { ok: false; message: string }>` (never throws). `listRecentPayments` is removed (its only caller was the billing page).

- [ ] **Step 1: Failing tests** (mock `./callable` the way `billing-client.test.ts` already does):
  - `getFinancialDashboard()` sends `null`; `getFinancialDashboard("2026-09")` sends `{ month: "2026-09" }`; a response that fails `financialDashboardSchema` → throws the safe message.
  - `voidManualPayment`: short reason → `{ ok:false, message:"Give a reason of at least 10 characters." }` without calling; success → `{ ok:true, invoiceStatus:"open" }`; `functions/failed-precondition` with `"Only membership and adjustment payments can be voided here."` → that message; `functions/permission-denied` → `"An active owner or administrator session is required. Sign in again."`; anything else → `"The payment could not be voided. Refresh and try again."`.
- [ ] **Step 2: Run** `corepack pnpm vitest run --project web apps/web/src/lib/finance-client.test.ts apps/web/src/lib/billing-client.test.ts` → FAIL.
- [ ] **Step 3: Implement**

```ts
// finance-client.ts
import { financialDashboardSchema, type FinancialDashboard } from "@bpt-jersey/domain/finance/dashboard";

export async function getFinancialDashboard(month?: string): Promise<FinancialDashboard> {
  const callable = httpsCallable<{ month: string } | null, { dashboard: unknown }>(
    getFirebaseFunctions(), "getFinancialDashboard",
  );
  try {
    const response = await callable(month === undefined ? null : { month });
    const parsed = financialDashboardSchema.safeParse(response.data.dashboard);
    if (!parsed.success) throw new Error(safeFinancialDashboardError);
    return parsed.data;
  } catch {
    throw new Error(safeFinancialDashboardError);
  }
}
```

(remove `listRecentPayments`, its error string and the `isRecentPaymentRow` import)

```ts
// billing-client.ts, after editManualPayment
const safeVoidError = "The payment could not be voided. Refresh and try again.";
const voidRefusals = new Set([
  "Only membership and adjustment payments can be voided here.",
  "This void was already sent for another payment.",
]);

export async function voidManualPayment(input: VoidManualPaymentInput): Promise<EditManualPaymentResult> {
  const parsed = voidManualPaymentInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues.some((issue) => issue.path[0] === "reason")
        ? "Give a reason of at least 10 characters."
        : safeVoidError,
    };
  }
  try {
    const callable = httpsCallable<VoidManualPaymentInput, unknown>(getFirebaseFunctions(), "voidManualPayment", callableOptions);
    const result = editResultSchema.parse((await callable(parsed.data)).data);
    if (result.paymentId !== parsed.data.paymentId) return { ok: false, message: safeVoidError };
    return { ok: true, invoiceStatus: result.invoiceStatus };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    const message = typeof error === "object" && error !== null && "message" in error ? error.message : null;
    if (code === "functions/failed-precondition" && typeof message === "string" && voidRefusals.has(message)) {
      return { ok: false, message };
    }
    if (code === "functions/permission-denied" || code === "functions/unauthenticated") {
      return { ok: false, message: "An active owner or administrator session is required. Sign in again." };
    }
    return { ok: false, message: safeVoidError };
  }
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git commit -m "feat(finance): web clients for the monthly dashboard and payment void"`

---

### Task 7: Web — dialogs (edit reuse + void)

**Files:**
- Modify: `apps/web/src/app/admin/members/profile/payment-dialogs.tsx` (`EditPaymentDialog` prop type; export `ModalDialog` and `DialogHeading` if not exported)
- Create: `apps/web/src/app/admin/billing/void-payment-dialog.tsx`
- Test: `apps/web/src/app/admin/billing/void-payment-dialog.test.tsx`; keep `payments-tab.test.tsx` green

**Interfaces:**
- Produces: `type EditablePayment = Pick<SubscriptionBillingPayment, "paymentId" | "amountMinor" | "method" | "reference" | "occurredAt">`; `EditPaymentDialog({ payment: EditablePayment; onClose; onSaved })`.
  `VoidPaymentDialog({ payment: { paymentId: string; amountMinor: number; occurredAt: string }; memberLabel: string; onClose: () => void; onVoided: () => void; voidPayment?: typeof voidManualPayment })`.

- [ ] **Step 1: Failing test** `void-payment-dialog.test.tsx` (Testing Library, as the sibling dialog tests do):
  - renders "Void payment" heading, the amount (`£95.00`), the member label, and the sentence "Voiding does not change the member's plan dates. Fix those in the Plan tab if needed."
  - submit disabled until the reason has ≥10 non-space chars; counter shows `n/280`.
  - submitting calls `voidPayment` once with `{ paymentId, reason, requestId }` where `requestId` is a uuid; a second click while busy does not call again; on `{ ok:true }` calls `onVoided`.
  - on `{ ok:false, message }` shows the message in `role="alert"` and keeps the dialog open.
  - the member label `<img src=x onerror=alert(1)>` renders as text (query by text, no `img` in the dialog).
- [ ] **Step 2: Run** `corepack pnpm vitest run --project web apps/web/src/app/admin/billing/void-payment-dialog.test.tsx` → FAIL.
- [ ] **Step 3: Implement** — in `payment-dialogs.tsx` change the `payment` prop type to `EditablePayment` (body unchanged) and export `ModalDialog`, `DialogHeading`, `reasonLimit`, `reasonMinimum`. Then:

```tsx
"use client";

import { useId, useState, type FormEvent } from "react";

import { voidManualPayment } from "../../../lib/billing-client";
import { DialogHeading, ModalDialog, reasonLimit, reasonMinimum } from "../members/profile/payment-dialogs";
import { formatDate, formatMoney } from "./billing-format";

export function VoidPaymentDialog({
  payment,
  memberLabel,
  onClose,
  onVoided,
  voidPayment = voidManualPayment,
}: {
  payment: Readonly<{ paymentId: string; amountMinor: number; occurredAt: string }>;
  memberLabel: string;
  onClose: () => void;
  onVoided: () => void;
  voidPayment?: typeof voidManualPayment;
}) {
  const titleId = useId();
  const countId = useId();
  // One id per opened dialog: a retry after a lost response replays instead of voiding twice.
  const [requestId] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = reason.trim().length >= reasonMinimum;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError("");
    const result = await voidPayment({ paymentId: payment.paymentId, reason: reason.trim(), requestId });
    if (result.ok) {
      onVoided();
      return;
    }
    setError(result.message);
    setBusy(false);
  }

  return (
    <ModalDialog titleId={titleId} onClose={onClose}>
      <DialogHeading busy={busy} eyebrow={memberLabel} id={titleId} onClose={onClose} title="Void payment" />
      <form className="billing-form" onSubmit={(event) => void submit(event)}>
        <p className="billing-form-wide" style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatMoney(payment.amountMinor)} paid on {formatDate(payment.occurredAt)}
        </p>
        <p className="member-subscription-help billing-form-wide">
          Voiding does not change the member&apos;s plan dates. Fix those in the Plan tab if needed.
        </p>
        <label className="family-field billing-form-wide">
          Reason for voiding
          <textarea
            aria-describedby={countId}
            maxLength={reasonLimit}
            onChange={(event) => setReason(event.target.value)}
            required
            rows={3}
            value={reason}
          />
        </label>
        <p className="member-subscription-help billing-form-wide" id={countId} style={{ fontVariantNumeric: "tabular-nums" }}>
          {reason.trim().length}/{reasonLimit}
          {ready ? null : ` · At least ${reasonMinimum} characters. Kept with the payment.`}
        </p>
        {error ? <p className="member-record-notice billing-form-wide" role="alert">{error}</p> : null}
        <div className="billing-dialog-actions billing-form-wide">
          <button className="button billing-danger-button" disabled={busy || !ready} type="submit">
            {busy ? "Voiding…" : "Void payment"}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
```

Add to `billing.css`:

```css
.billing-danger-button { background: #8d1c2f; border-color: #8d1c2f; color: #fff; }
.billing-danger-button:hover:not(:disabled) { background: #721626; border-color: #721626; }
.billing-form textarea { border: 1px solid var(--line, #8a8880); border-radius: 0; font: inherit; font-size: max(1rem, 16px); min-height: 3rem; padding: 0.65rem; }
```

- [ ] **Step 4: Run** the new test plus `apps/web/src/app/admin/members/profile/payments-tab.test.tsx` → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(finance): void payment dialog; edit dialog takes a minimal payment"`

---

### Task 8: Web — the `/admin/finance` page, forwarder and nav

**Files:**
- Rewrite: `apps/web/src/app/admin/finance/page.tsx`
- Create: `apps/web/src/app/admin/finance/finance-tabs.tsx`
- Move + rewrite test: `apps/web/src/app/admin/billing/page.test.tsx` → `apps/web/src/app/admin/finance/page.test.tsx`; replace `apps/web/src/app/admin/finance/page.test.tsx` (old redirect test)
- Rewrite: `apps/web/src/app/admin/billing/page.tsx` (forwarder)
- Modify: `apps/web/src/app/admin/admin-shell.tsx:57-58`, `admin-shell.test.tsx` / `admin-routes.test.ts` if they assert the two items
- Modify: `apps/web/src/app/admin/billing/billing.css` (tabs + voided rows + month nav)

**Interfaces:**
- Consumes: `getFinancialDashboard(month?)`, `shiftFinancialMonth`, `currentFinancialMonth` (Task 1/6), `EditPaymentDialog`, `VoidPaymentDialog` (Task 7), existing `RecordPaymentDialog`, `IssueInvoiceDialog`, `MemberAccountPanel`, `MemberPicker`, `PaymentInstructionsPanel`, `PrivateLessonsPanel`, `getInvoice`, `listFinancialAccount`, `getFamilyFinancialAccount`, `listMemberships`, `listMemberNames`, `recordHref` from `../members/profile/member-record`.
- Produces: `export function FinancePage()`, default export route. `finance-tabs.tsx` exports `financeTabs = ["payments","owed","renewals","invoices","settings"] as const`, `type FinanceTab`, `readFinanceTab(search: string): FinanceTab`, `PaymentsPanel`, `OwedPanel`, `RenewalsPanel`.

- [ ] **Step 1: Failing page test** (`finance/page.test.tsx`, mocking `../../../lib/finance-client`, `billing-client`, `members-client`, `membership-admin-client` like the old billing test):
  1. renders heading "Financial dashboard", KPIs "Collected", "Outstanding", "Overdue invoices", "Renewals" from the mocked dashboard; month label "October 2026"; "Next month" button disabled.
  2. Payments tab: row shows member name "Ana Coelho" (resolved via `listMemberNames` by `studentId`), source "Plan", `Edit` and `Void` buttons; a shop row shows "SHOP-000007 · Ana Coelho" with no buttons; a voided row shows "Voided" and the reason.
  3. Clicking "Previous month" calls `getFinancialDashboard("2026-09")`.
  4. Clicking `Void` opens the dialog; mocked success → feedback "Payment voided." and dashboard refetched.
  5. Owed tab (`?tab=owed` in `window.history`): row for a balance whose `studentId` is unknown shows the invoice `label`, not the id.
  6. Renewals tab: "Overdue" table first; "Open plan" link href = `/admin/members/profile?id=stu-1&tab=plan`.
  7. Only `getFinancialDashboard` and `listMemberNames` are called on first render (not `listFinancialAccount`).
  8. Dashboard rejection → alert "The finance summary is unavailable. Try again." and a "Retry" button that refetches.
- [ ] **Step 2: Run** `corepack pnpm vitest run --project web apps/web/src/app/admin/finance` → FAIL.
- [ ] **Step 3: Implement `finance-tabs.tsx`**

```tsx
"use client";

import Link from "next/link";
import type {
  FinancialDashboard,
  FinancialDashboardBalanceRow,
  FinancialDashboardPaymentRow,
  FinancialDashboardRenewalRow,
} from "@bpt-jersey/domain/finance/dashboard";

import { AdminDataTable } from "../admin-data-table";
import { AdminStatusBadge } from "../admin-ui";
import { formatDate, formatMoney } from "../billing/billing-format";
import { recordHref } from "../members/profile/member-record";

export const financeTabs = ["payments", "owed", "renewals", "invoices", "settings"] as const;
export type FinanceTab = (typeof financeTabs)[number];
export const financeTabLabels: Readonly<Record<FinanceTab, string>> = {
  payments: "Payments", owed: "Owed", renewals: "Renewals", invoices: "Invoices", settings: "Settings",
};

export function readFinanceTab(search: string): FinanceTab {
  const tab = new URLSearchParams(search).get("tab");
  return (financeTabs as readonly string[]).includes(tab ?? "") ? (tab as FinanceTab) : "payments";
}

const sourceLabels: Readonly<Record<FinancialDashboardPaymentRow["source"], string>> = {
  membership: "Plan", payg: "Pay as you go", private_lesson: "Private lesson",
  course: "Course", shop: "Shop", adjustment: "Adjustment",
};
const methodLabels: Readonly<Record<FinancialDashboardPaymentRow["method"], string>> = {
  cash: "Cash", bank_transfer: "Bank transfer", other: "Other", at_collection: "Pay on collection",
};

export type NameOf = (studentId: string | null, fallback: string) => string;

export function PaymentsPanel({
  rows, monthLabel, nameOf, busy, onEdit, onVoid,
}: {
  rows: FinancialDashboard["payments"]; monthLabel: string; nameOf: NameOf; busy: boolean;
  onEdit: (row: FinancialDashboardPaymentRow) => void; onVoid: (row: FinancialDashboardPaymentRow) => void;
}) {
  if (rows.length === 0) return <p className="admin-empty-state">No payments in {monthLabel}.</p>;
  return (
    <AdminDataTable
      caption={`Payments in ${monthLabel}`}
      columns={[
        { key: "date", label: "Date", render: (row: FinancialDashboardPaymentRow) => formatDate(row.occurredAt) },
        {
          key: "member", label: "Member",
          render: (row: FinancialDashboardPaymentRow) =>
            row.source === "shop" ? <Link className="admin-text-link" href="/admin/shop">{row.label}</Link> : nameOf(row.studentId, row.label),
        },
        { key: "source", label: "Source", render: (row: FinancialDashboardPaymentRow) => sourceLabels[row.source] },
        { key: "method", label: "Method", render: (row: FinancialDashboardPaymentRow) => methodLabels[row.method] },
        {
          key: "amount", label: "Amount",
          render: (row: FinancialDashboardPaymentRow) =>
            row.voided ? <s className="finance-voided-amount">{formatMoney(row.amountMinor)}</s> : formatMoney(row.amountMinor),
        },
        {
          key: "actions", label: "Actions",
          render: (row: FinancialDashboardPaymentRow) =>
            row.voided ? (
              <span className="finance-voided-note">
                Voided — {row.voided.reason} ({row.voided.voidedByName}, {formatDate(row.voided.voidedAt)})
              </span>
            ) : (
              <span className="finance-row-actions">
                {row.editable ? <button className="family-text-button" disabled={busy} onClick={() => onEdit(row)} type="button">Edit</button> : null}
                {row.voidable ? <button className="family-text-button" disabled={busy} onClick={() => onVoid(row)} type="button">Void</button> : null}
              </span>
            ),
        },
      ]}
      rowKey={(row) => row.rowId}
      rows={rows}
    />
  );
}

export function OwedPanel({
  rows, nameOf, busy, onRecordPayment,
}: {
  rows: FinancialDashboard["balances"]; nameOf: NameOf; busy: boolean;
  onRecordPayment: (row: FinancialDashboardBalanceRow) => void;
}) {
  if (rows.length === 0) return <p className="admin-empty-state">Nobody owes anything right now.</p>;
  return (
    <AdminDataTable
      caption="Invoices with a balance"
      columns={[
        { key: "member", label: "Member", render: (row: FinancialDashboardBalanceRow) => nameOf(row.studentId, row.label) },
        { key: "invoice", label: "Invoice", render: (row: FinancialDashboardBalanceRow) => row.invoiceReference },
        { key: "due", label: "Due", render: (row: FinancialDashboardBalanceRow) => formatDate(row.dueAt) },
        { key: "balance", label: "Balance", render: (row: FinancialDashboardBalanceRow) => formatMoney(row.balanceMinor) },
        { key: "status", label: "Status", render: (row: FinancialDashboardBalanceRow) => <AdminStatusBadge status={row.overdue ? "Overdue" : "Due later"} /> },
        {
          key: "actions", label: "Actions",
          render: (row: FinancialDashboardBalanceRow) => (
            <button className="family-text-button" disabled={busy} onClick={() => onRecordPayment(row)} type="button">Record payment</button>
          ),
        },
      ]}
      rowKey={(row) => row.invoiceId}
      rows={rows}
    />
  );
}

function RenewalTable({ caption, rows, nameOf, empty }: {
  caption: string; rows: readonly FinancialDashboardRenewalRow[]; nameOf: NameOf; empty: string;
}) {
  return (
    <>
      <h3 className="finance-subheading">{caption}</h3>
      {rows.length === 0 ? <p className="admin-empty-state">{empty}</p> : (
        <AdminDataTable
          caption={caption}
          columns={[
            { key: "member", label: "Member", render: (row: FinancialDashboardRenewalRow) => nameOf(row.studentId, "Member record") },
            { key: "plan", label: "Plan", render: (row: FinancialDashboardRenewalRow) => row.planName },
            { key: "date", label: "Renews", render: (row: FinancialDashboardRenewalRow) => (row.nextBillingAt ? formatDate(row.nextBillingAt) : "Not set") },
            { key: "status", label: "Status", render: (row: FinancialDashboardRenewalRow) => <AdminStatusBadge status={row.status === "overdue" ? "Overdue" : row.status === "trial" ? "Trial" : "Active"} /> },
            {
              key: "actions", label: "Actions",
              render: (row: FinancialDashboardRenewalRow) => (
                <Link className="admin-text-link" href={recordHref(row.studentId, "plan")}>Open plan</Link>
              ),
            },
          ]}
          rowKey={(row) => row.membershipId}
          rows={rows}
        />
      )}
    </>
  );
}

export function RenewalsPanel({ renewals, nameOf }: { renewals: FinancialDashboard["renewals"]; nameOf: NameOf }) {
  return (
    <>
      <RenewalTable caption="Overdue" empty="No plan is past its renewal date." nameOf={nameOf} rows={renewals.overdue} />
      <RenewalTable caption="Due in the next 30 days" empty="No renewals are due in the next 30 days." nameOf={nameOf} rows={renewals.dueSoon} />
    </>
  );
}
```

- [ ] **Step 4: Implement `finance/page.tsx`** (moved from `billing/page.tsx`; keep its loading/feedback/dialog code, replace the body). Key parts:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  currentFinancialMonth,
  shiftFinancialMonth,
  type FinancialDashboard,
  type FinancialDashboardPaymentRow,
} from "@bpt-jersey/domain/finance/dashboard";
import type { MemberNameRow } from "@bpt-jersey/domain/members/directory";

import { getFamilyFinancialAccount, getFinancialDashboard } from "../../../lib/finance-client";
import { getInvoice, listFinancialAccount, voidManualInvoice, type FinancialAccount, type InvoiceView } from "../../../lib/billing-client";
import { listMemberships, type AdminMembership } from "../../../lib/membership-admin-client";
import { listMemberNames } from "../../../lib/members-client";
import { AdminDataTable } from "../admin-data-table";
import { AdminMetric, AdminSectionHeader, AdminStatusBadge } from "../admin-ui";
import { formatDate, formatMoney } from "../billing/billing-format";
import { IssueInvoiceDialog } from "../billing/issue-invoice-dialog";
import { InvoiceRowActions, MemberAccountPanel } from "../billing/member-account-panel";
import { MemberPicker } from "../billing/member-picker";
import { PaymentInstructionsPanel } from "../billing/payment-instructions-panel";
import { PrivateLessonsPanel } from "../billing/private-lessons-panel";
import { RecordPaymentDialog } from "../billing/record-payment-dialog";
import { VoidPaymentDialog } from "../billing/void-payment-dialog";
import { EditPaymentDialog } from "../members/profile/payment-dialogs";
import { financeTabLabels, financeTabs, OwedPanel, PaymentsPanel, readFinanceTab, RenewalsPanel, type FinanceTab } from "./finance-tabs";

import "../admin.css";
import "../billing/billing.css";

const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const monthLabelOf = (month: string) => monthFormat.format(new Date(`${month}-01T00:00:00.000Z`));

type DialogState =
  | Readonly<{ kind: "invoice" }>
  | Readonly<{ kind: "payment"; invoice: InvoiceView | null }>
  | Readonly<{ kind: "edit"; row: FinancialDashboardPaymentRow }>
  | Readonly<{ kind: "void"; row: FinancialDashboardPaymentRow }>;
```

State and effects:
- `month` (`useState(() => currentFinancialMonth(new Date().toISOString()))`), `tab` (`useState<FinanceTab>("payments")`, set from `readFinanceTab(window.location.search)` in a mount effect), `dashboard` + `dashboardState`, `members`/`membersError` (as today), `version` for refetch.
- `selectTab(next)`: `setTab(next)`; `const url = new URL(window.location.href); url.searchParams.set("tab", next); window.history.replaceState(null, "", url)` — same no-router approach as `member-record.tsx`'s `readRecordLocation`.
- Dashboard effect depends on `[month, version]` and calls `getFinancialDashboard(month === currentMonth ? undefined : month)`. Keep the `mounted` guard pattern.
- `listFinancialAccount` + `listMemberships` effect runs only when `tab === "invoices"` (or when the invoice dialog opens) — guard with `if (tab !== "invoices" && dialog?.kind !== "invoice") return;`.
- `nameOf = useCallback((studentId, fallback) => (studentId && names.get(studentId)) || fallback, [names])` where `names = useMemo(() => new Map(members?.map(r => [r.studentId, r.fullName])), [members])`.
- Owed "Record payment": `setBusy(true); getInvoice(row.invoiceId).then(view => setDialog({ kind: "payment", invoice: view })).catch(() => setFeedback({ kind:"error", text:"That invoice could not be opened. Refresh and try again." })).finally(() => setBusy(false))`.
- Edit dialog: `<EditPaymentDialog payment={{ paymentId: row.paymentId!, amountMinor: row.amountMinor, method: row.method as ManualPaymentMethod, reference: row.reference ?? "", occurredAt: row.occurredAt }} onClose=… onSaved={() => { setFeedback({kind:"success",text:"Payment updated."}); setDialog(undefined); refresh(); }} />` — only reachable for `editable` rows, whose method is never `at_collection`.
- Void dialog: `<VoidPaymentDialog memberLabel={nameOf(row.studentId, row.label)} payment={{ paymentId: row.paymentId!, amountMinor: row.amountMinor, occurredAt: row.occurredAt }} onVoided={() => { setFeedback({kind:"success",text:"Payment voided."}); … }} />`.

Render order:

```tsx
<section className="admin-module-page finance-dashboard-page" aria-labelledby="finance-title">
  <AdminSectionHeader eyebrow="Money / Finance" title="Financial dashboard"
    description="Manual GBP invoices, receipts and shop payments. No card details are stored here."
    actions={/* Issue invoice + Record payment buttons, as billing had */} />
  {feedback band (as billing had)}
  <div className="finance-month-nav" role="group" aria-label="Month">
    <button className="button button-secondary" onClick={() => setMonth(shiftFinancialMonth(month, -1))} type="button" aria-label="Previous month">‹</button>
    <p aria-live="polite" className="finance-month-label">{monthLabelOf(month)}</p>
    <button className="button button-secondary" disabled={month >= currentMonth} onClick={() => setMonth(shiftFinancialMonth(month, 1))} type="button" aria-label="Next month">›</button>
  </div>
  {loading skeleton grid (4 × .billing-skeleton) | error alert + Retry | metrics:}
  <div className="admin-metrics-grid">
    <AdminMetric label="Collected" value={formatMoney(m.collectedMinor)} detail={`${m.paymentsReceived} payments in ${monthLabel}`} />
    <AdminMetric label="Outstanding" value={formatMoney(m.outstandingMinor)} detail="Owed today" />
    <AdminMetric label="Overdue invoices" value={m.overdueBalances} detail="Past their due date" />
    <AdminMetric label="Renewals" value={m.renewalsOverdue + m.renewalsDue} detail={`${m.renewalsOverdue} overdue · ${m.renewalsDue} due in 30 days`} />
  </div>
  <nav aria-label="Finance views" className="shop-admin-tabs">
    <ul role="tablist">{financeTabs.map(t => <li key={t} role="presentation"><button aria-selected={tab === t} className="shop-admin-tab" onClick={() => selectTab(t)} role="tab" type="button">{financeTabLabels[t]}</button></li>)}</ul>
  </nav>
  <section className="admin-panel-card" role="tabpanel" aria-label={financeTabLabels[tab]}>
    {tab === "payments" && dashboard ? <PaymentsPanel …/> : null}
    {tab === "owed" && dashboard ? <OwedPanel …/> : null}
    {tab === "renewals" && dashboard ? <RenewalsPanel …/> : null}
    {tab === "invoices" ? (/* Find a member: MemberPicker + MemberAccountPanel, then All invoices table — moved verbatim from billing/page.tsx */) : null}
    {tab === "settings" ? (<><PaymentInstructionsPanel current={account?.paymentInstructions ?? null} onSaved={refresh} /><PrivateLessonsPanel /></>) : null}
  </section>
  {dialogs}
</section>
```

Settings needs `account` for `paymentInstructions`: load `listFinancialAccount` for `tab === "invoices" || tab === "settings"`.

Check that `.shop-admin-tabs` / `.shop-admin-tab` styles live in a CSS file the finance page imports. If they are in `admin/shop/shop.css`, copy the two rules into `billing.css` under the names `.finance-tabs` / `.finance-tab` and use those instead (do not import shop.css).

`billing.css` additions:

```css
.finance-month-nav { align-items: center; display: flex; gap: 0.75rem; }
.finance-month-label { font-family: var(--font-display); font-size: 1.6rem; letter-spacing: 0.035em; margin: 0; min-width: 11ch; text-align: center; text-transform: uppercase; }
.finance-voided-amount { color: var(--muted, #65635d); }
.finance-voided-note { border-left: 0.35rem solid #8d1c2f; color: #721626; display: inline-block; padding-left: 0.5rem; }
.finance-row-actions { display: inline-flex; gap: 0.5rem; }
.finance-row-actions .family-text-button { min-height: 44px; }
.finance-subheading { font-family: var(--font-display); letter-spacing: 0.035em; margin: 1.5rem 0 0.5rem; text-transform: uppercase; }
.finance-dashboard-page .admin-panel-card { overflow-x: auto; }
```

- [ ] **Step 5: Forwarder** — `billing/page.tsx` becomes the old finance forwarder with targets swapped: `router.replace("/admin/finance" + window.location.search)`, copy "Billing moved." + link "Go to the Financial dashboard". Replace `billing/page.test.tsx` with one test: renders the link to `/admin/finance` and calls `replace`.
- [ ] **Step 6: Nav** — `admin-shell.tsx`: delete `{ label: "Billing", href: "/admin/billing" }`; change the finance item to `{ label: "Financial dashboard", href: "/admin/finance" }` (no `ownerOnly`). Update `admin-shell.test.tsx` / `admin-routes.test.ts` assertions if they list "Billing" or the owner-only flag.
- [ ] **Step 7: Run** `corepack pnpm vitest run --project web apps/web/src/app/admin` → PASS. Run `corepack pnpm --filter @bpt-jersey/web typecheck` and `corepack pnpm lint` → clean.
- [ ] **Step 8: Commit** `git commit -m "feat(finance): single Financial dashboard page with month selector and tabs; Billing forwards to it"`

---

### Task 9: E2E spec and browser verification

**Files:**
- Rename + rewrite: `qa/tests/admin-billing-home.spec.ts` → `qa/tests/admin-finance.spec.ts`

- [ ] **Step 1: Rewrite the spec** with the existing `installAdminFixture` (callable mocks): dashboard fixture in the v2 shape (one membership payment for `student-ana`, one voided, one shop order, one balance, one overdue + one due-soon renewal), `listMemberNames` fixture with Ana/Bruno/Carla, `voidManualPayment` responder returning `{ paymentId, invoiceId, invoiceStatus: "open" }`. Tests (tag `@smoke` on the first):
  1. `/admin/billing` lands on `/admin/finance`; nav has exactly one "Financial dashboard" link and no "Billing" link.
  2. KPIs and the Payments rows render with member names; "Previous month" sends `{ month: "<prev>" }` (assert from `calls`).
  3. Void flow: open, type reason, submit → `voidManualPayment` called with a uuid `requestId`; feedback "Payment voided.".
  4. Owed and Renewals tabs show names; "Open plan" href contains `tab=plan`.
  5. At 390×844: `document.documentElement.scrollWidth <= 390`.
- [ ] **Step 2: Build and run**

```bash
corepack pnpm --filter @bpt-jersey/domain build:runtime
corepack pnpm --filter @bpt-jersey/web build
corepack pnpm --dir qa exec playwright test tests/admin-finance.spec.ts
```

Expected: 5 passed.
- [ ] **Step 3: Interactive check with Playwright MCP** against the same static build served locally (`corepack pnpm --dir qa exec playwright` web server config, or `npx serve apps/web/out -l 127.0.0.1:4173`), with the fixture installed via `browser_run_code_unsafe` reusing `admin-fixture.ts`'s route handler. Screens to capture: desktop 1440 Payments tab, Void dialog, Renewals tab, 390px Payments tab. Check: no console errors, no horizontal scroll, focus ring visible on tabs, dialog closes on Escape.
- [ ] **Step 4: Emulator smoke for the callables** (needs JDK 21): `FUNCTIONS_DISCOVERY_TIMEOUT=300000 corepack pnpm test:integration -- -t "financial"` if an integration test exists for finance; otherwise skip and say so in the report.
- [ ] **Step 5: Commit** `git commit -m "test(finance): e2e for the merged Financial dashboard"`

---

### Task 10: Whole-branch review, runbook, memory

- [ ] Full gate (no CI dispatch): `corepack pnpm format:check && corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test`.
- [ ] Whole-branch review (fresh reviewer): security (void auth, idempotency, no raw errors), money correctness, DESIGN.md compliance.
- [ ] Write the deploy runbook `/root/bpt-runbook/deploy-2026-10-01-finance/README.md` (Spanish, operator format): push main, then ONE functions batch: `getFinancialDashboard,voidManualPayment,listShopCatalog,listPublicShopCatalog,listManagedShopProducts,saveShopProduct,setShopProductActive,placeShopOrder,uploadShopOrderProof,getShopOrderProofUrl,listMyShopOrders,listShopOrders,updateShopOrder` (13 < 20), verify with `firebase functions:list` and the laptop browser.
- [ ] Update memory (project file for this feature + MEMORY.md line).
