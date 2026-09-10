import { planIds } from "../memberships/plan-contracts";
import type { MembershipRecord } from "../memberships/membership-contracts";
import type { InvoiceRecord, ManualPaymentRecord } from "./finance-contracts";

const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const renewalWindowMs = 30 * 24 * 60 * 60 * 1000;
export const financialDashboardListLimit = 10;

export type FinancialDashboardPayment = Readonly<{
  invoiceReference: string;
  amountMinor: number;
  occurredAt: string;
}>;

export type FinancialDashboardBalance = Readonly<{
  invoiceReference: string;
  balanceMinor: number;
  dueAt: string;
  status: "open" | "partially_paid";
  overdue: boolean;
}>;

export type FinancialDashboardRenewal = Readonly<{
  planId: MembershipRecord["planId"];
  nextBillingAt: string;
  status: "trial" | "active";
}>;

export type FinancialDashboard = Readonly<{
  currency: "GBP";
  generatedAt: string;
  period: Readonly<{ from: string; to: string }>;
  renewalWindow: Readonly<{ from: string; to: string }>;
  metrics: Readonly<{
    collectedMinor: number;
    activeMemberships: number;
    outstandingMinor: number;
    paymentsReceived: number;
    overdueBalances: number;
    renewalsDue: number;
  }>;
  recentPayments: readonly FinancialDashboardPayment[];
  balanceAttention: readonly FinancialDashboardBalance[];
  upcomingRenewals: readonly FinancialDashboardRenewal[];
}>;

export type FinancialDashboardSource = Readonly<{
  generatedAt: string;
  memberships: readonly MembershipRecord[];
  invoices: readonly InvoiceRecord[];
  payments: readonly ManualPaymentRecord[];
}>;

function safeSum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) throw new RangeError("Financial dashboard amount overflow");
  }
  return total;
}

function monthStart(timestamp: string): string {
  const date = new Date(timestamp);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

function addRenewalWindow(timestamp: string): string {
  return new Date(Date.parse(timestamp) + renewalWindowMs).toISOString();
}

function uniqueById<T>(items: readonly T[], id: (item: T) => string): readonly T[] {
  const records = new Map<string, T>();
  for (const item of items) {
    const key = id(item);
    if (records.has(key)) throw new Error("Financial dashboard source contains duplicate IDs");
    records.set(key, item);
  }
  return [...records.values()];
}

export function buildFinancialDashboard(source: FinancialDashboardSource): FinancialDashboard {
  if (!isDateTime(source.generatedAt)) throw new Error("Invalid dashboard generation timestamp");
  const generatedAtMs = Date.parse(source.generatedAt);
  const period = Object.freeze({ from: monthStart(source.generatedAt), to: source.generatedAt });
  const renewalWindow = Object.freeze({
    from: source.generatedAt,
    to: addRenewalWindow(source.generatedAt),
  });
  const periodStartMs = Date.parse(period.from);
  const renewalEndMs = Date.parse(renewalWindow.to);
  const memberships = uniqueById(source.memberships, (record) => record.membershipId);
  const invoices = uniqueById(source.invoices, (record) => record.invoiceId);
  const payments = uniqueById(source.payments, (record) => record.paymentId);
  const invoiceById = new Map(invoices.map((invoice) => [invoice.invoiceId, invoice]));
  const paymentsByInvoice = new Map<string, ManualPaymentRecord[]>();

  for (const payment of payments) {
    if (!invoiceById.has(payment.invoiceId)) {
      throw new Error("Financial dashboard source contains an orphan payment");
    }
    const allocated = paymentsByInvoice.get(payment.invoiceId) ?? [];
    allocated.push(payment);
    paymentsByInvoice.set(payment.invoiceId, allocated);
  }

  const balanceRows = invoices
    .filter((invoice) => invoice.status !== "void")
    .map((invoice): FinancialDashboardBalance | undefined => {
      const paidMinor = safeSum(
        (paymentsByInvoice.get(invoice.invoiceId) ?? []).map((payment) => payment.amountMinor),
      );
      const balanceMinor = Math.max(0, invoice.totalMinor - paidMinor);
      if (balanceMinor === 0) return undefined;
      if (invoice.status !== "open" && invoice.status !== "partially_paid") {
        throw new Error("Financial dashboard source contains an inconsistent invoice status");
      }
      return Object.freeze({
        invoiceReference: invoice.invoiceReference,
        balanceMinor,
        dueAt: invoice.dueAt,
        status: invoice.status,
        overdue: Date.parse(invoice.dueAt) < generatedAtMs,
      });
    })
    .filter((row): row is FinancialDashboardBalance => row !== undefined)
    .sort(
      (left, right) =>
        Number(right.overdue) - Number(left.overdue) ||
        left.dueAt.localeCompare(right.dueAt) ||
        left.invoiceReference.localeCompare(right.invoiceReference),
    );

  const periodPayments = payments.filter((payment) => {
    const occurredAt = Date.parse(payment.occurredAt);
    return occurredAt >= periodStartMs && occurredAt <= generatedAtMs;
  });
  const recentPayments = payments
    .filter((payment) => Date.parse(payment.occurredAt) <= generatedAtMs)
    .sort(
      (left, right) =>
        right.occurredAt.localeCompare(left.occurredAt) ||
        left.paymentId.localeCompare(right.paymentId),
    )
    .slice(0, financialDashboardListLimit)
    .map((payment) =>
      Object.freeze({
        invoiceReference: invoiceById.get(payment.invoiceId)!.invoiceReference,
        amountMinor: payment.amountMinor,
        occurredAt: payment.occurredAt,
      }),
    );

  const renewalRows = memberships
    .filter(
      (membership): membership is MembershipRecord & { status: "trial" | "active" } =>
        (membership.status === "trial" || membership.status === "active") &&
        membership.nextBillingAt !== null &&
        Date.parse(membership.nextBillingAt) >= generatedAtMs &&
        Date.parse(membership.nextBillingAt) <= renewalEndMs,
    )
    .sort(
      (left, right) =>
        left.nextBillingAt!.localeCompare(right.nextBillingAt!) ||
        left.membershipId.localeCompare(right.membershipId),
    )
    .map((membership) =>
      Object.freeze({
        planId: membership.planId,
        nextBillingAt: membership.nextBillingAt!,
        status: membership.status,
      }),
    );

  return Object.freeze({
    currency: "GBP",
    generatedAt: source.generatedAt,
    period,
    renewalWindow,
    metrics: Object.freeze({
      collectedMinor: safeSum(periodPayments.map((payment) => payment.amountMinor)),
      activeMemberships: memberships.filter((membership) => membership.status === "active").length,
      outstandingMinor: safeSum(balanceRows.map((row) => row.balanceMinor)),
      paymentsReceived: periodPayments.length,
      overdueBalances: balanceRows.filter((row) => row.overdue).length,
      renewalsDue: renewalRows.length,
    }),
    recentPayments: Object.freeze(recentPayments),
    balanceAttention: Object.freeze(balanceRows.slice(0, financialDashboardListLimit)),
    upcomingRenewals: Object.freeze(renewalRows.slice(0, financialDashboardListLimit)),
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  try {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  } catch {
    return false;
  }
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.length !== fields.length) return false;
    for (const key of keys) {
      if (typeof key !== "string" || !fields.includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        !Object.hasOwn(descriptor, "value")
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function valueOf(record: Record<string, unknown>, field: string): unknown {
  return Object.getOwnPropertyDescriptor(record, field)?.value;
}

function isDateTime(value: unknown): value is string {
  return (
    typeof value === "string" && dateTimePattern.test(value) && !Number.isNaN(Date.parse(value))
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isWindow(value: unknown): value is Readonly<{ from: string; to: string }> {
  return (
    isPlainRecord(value) &&
    exactFields(value, ["from", "to"]) &&
    isDateTime(valueOf(value, "from")) &&
    isDateTime(valueOf(value, "to")) &&
    Date.parse(valueOf(value, "from") as string) <= Date.parse(valueOf(value, "to") as string)
  );
}

function isPayment(value: unknown): value is FinancialDashboardPayment {
  if (
    !isPlainRecord(value) ||
    !exactFields(value, ["invoiceReference", "amountMinor", "occurredAt"])
  ) {
    return false;
  }
  const reference = valueOf(value, "invoiceReference");
  return (
    typeof reference === "string" &&
    referencePattern.test(reference) &&
    isNonNegativeInteger(valueOf(value, "amountMinor")) &&
    (valueOf(value, "amountMinor") as number) > 0 &&
    isDateTime(valueOf(value, "occurredAt"))
  );
}

function isBalance(value: unknown): value is FinancialDashboardBalance {
  if (
    !isPlainRecord(value) ||
    !exactFields(value, ["invoiceReference", "balanceMinor", "dueAt", "status", "overdue"])
  ) {
    return false;
  }
  const reference = valueOf(value, "invoiceReference");
  const status = valueOf(value, "status");
  return (
    typeof reference === "string" &&
    referencePattern.test(reference) &&
    isNonNegativeInteger(valueOf(value, "balanceMinor")) &&
    (valueOf(value, "balanceMinor") as number) > 0 &&
    isDateTime(valueOf(value, "dueAt")) &&
    (status === "open" || status === "partially_paid") &&
    typeof valueOf(value, "overdue") === "boolean"
  );
}

function isRenewal(value: unknown): value is FinancialDashboardRenewal {
  if (!isPlainRecord(value) || !exactFields(value, ["planId", "nextBillingAt", "status"])) {
    return false;
  }
  const planId = valueOf(value, "planId");
  const status = valueOf(value, "status");
  return (
    typeof planId === "string" &&
    identifierPattern.test(planId) &&
    planIds.includes(planId as (typeof planIds)[number]) &&
    isDateTime(valueOf(value, "nextBillingAt")) &&
    (status === "trial" || status === "active")
  );
}

export function isFinancialDashboard(value: unknown): value is FinancialDashboard {
  if (
    !isPlainRecord(value) ||
    !exactFields(value, [
      "currency",
      "generatedAt",
      "period",
      "renewalWindow",
      "metrics",
      "recentPayments",
      "balanceAttention",
      "upcomingRenewals",
    ]) ||
    valueOf(value, "currency") !== "GBP" ||
    !isDateTime(valueOf(value, "generatedAt")) ||
    !isWindow(valueOf(value, "period")) ||
    !isWindow(valueOf(value, "renewalWindow"))
  ) {
    return false;
  }

  const generatedAt = valueOf(value, "generatedAt") as string;
  const period = valueOf(value, "period") as FinancialDashboard["period"];
  const renewalWindow = valueOf(value, "renewalWindow") as FinancialDashboard["renewalWindow"];
  if (
    period.from !== monthStart(generatedAt) ||
    period.to !== generatedAt ||
    renewalWindow.from !== generatedAt ||
    renewalWindow.to !== addRenewalWindow(generatedAt)
  ) {
    return false;
  }

  const metricsValue = valueOf(value, "metrics");
  const metricFields = [
    "collectedMinor",
    "activeMemberships",
    "outstandingMinor",
    "paymentsReceived",
    "overdueBalances",
    "renewalsDue",
  ] as const;
  if (
    !isPlainRecord(metricsValue) ||
    !exactFields(metricsValue, metricFields) ||
    !metricFields.every((field) => isNonNegativeInteger(valueOf(metricsValue, field)))
  ) {
    return false;
  }

  const payments = valueOf(value, "recentPayments");
  const balances = valueOf(value, "balanceAttention");
  const renewals = valueOf(value, "upcomingRenewals");
  if (
    !Array.isArray(payments) ||
    !Array.isArray(balances) ||
    !Array.isArray(renewals) ||
    payments.length > financialDashboardListLimit ||
    balances.length > financialDashboardListLimit ||
    renewals.length > financialDashboardListLimit ||
    !payments.every(isPayment) ||
    !balances.every(isBalance) ||
    !renewals.every(isRenewal)
  ) {
    return false;
  }

  const metrics = metricsValue as FinancialDashboard["metrics"];
  let visibleOutstandingMinor: number;
  try {
    visibleOutstandingMinor = safeSum(balances.map((row) => row.balanceMinor));
  } catch {
    return false;
  }
  return (
    metrics.outstandingMinor >= visibleOutstandingMinor &&
    (metrics.collectedMinor === 0) === (metrics.paymentsReceived === 0) &&
    (metrics.outstandingMinor === 0) === (balances.length === 0) &&
    metrics.overdueBalances >= balances.filter((row) => row.overdue).length &&
    (metrics.overdueBalances === 0) === !balances.some((row) => row.overdue) &&
    metrics.renewalsDue >= renewals.length &&
    (metrics.renewalsDue === 0) === (renewals.length === 0) &&
    balances.every((row) => row.overdue === Date.parse(row.dueAt) < Date.parse(generatedAt)) &&
    renewals.every(
      (row) =>
        Date.parse(row.nextBillingAt) >= Date.parse(renewalWindow.from) &&
        Date.parse(row.nextBillingAt) <= Date.parse(renewalWindow.to),
    )
  );
}
