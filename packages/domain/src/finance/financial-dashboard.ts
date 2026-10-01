import { z } from "zod";

import type { MembershipRecord } from "../memberships/membership-contracts";
import type { InvoiceRecord, ManualPaymentRecord, VoidedPaymentRecord } from "./finance-contracts";

const renewalWindowMs = 30 * 24 * 60 * 60 * 1000;
const instant = z.iso.datetime({ offset: true });
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const minor = z.number().int().nonnegative();

export const financialMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);
export const financialDashboardInputSchema = z.strictObject({
  month: financialMonthSchema.optional(),
});

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
  renewals: z.strictObject({
    overdue: z.array(renewalRowSchema),
    dueSoon: z.array(renewalRowSchema),
  }),
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
  const number =
    order.orderNumber === null
      ? "Shop order"
      : `SHOP-${String(order.orderNumber).padStart(6, "0")}`;
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
    (invoice.membershipId === null
      ? undefined
      : membershipById.get(invoice.membershipId)?.studentId) ??
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
      voided: {
        voidedAt: record.voidedAt,
        voidedByName: record.voidedByName,
        reason: record.reason,
      },
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
    const balanceMinor = Math.max(
      0,
      invoice.totalMinor - (paidByInvoice.get(invoice.invoiceId) ?? 0),
    );
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
