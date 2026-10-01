import {
  buildFinancialDashboard,
  currentFinancialMonth,
  type DashboardShopPayment,
  type FinancialDashboard,
} from "@bpt-jersey/domain/finance/dashboard";
import {
  parseInvoiceRecord,
  sameInvoicePayer,
  parseManualPaymentRecord,
  parseVoidedPaymentRecord,
  type InvoiceRecord,
  type ManualPaymentRecord,
  type VoidedPaymentRecord,
} from "@bpt-jersey/domain/finance";
import { parseShopOrderRecord } from "@bpt-jersey/domain/shop";
import {
  parseMembershipRecord,
  type MembershipRecord,
} from "@bpt-jersey/domain/memberships/lifecycle";

type DashboardDocument = Readonly<{ id: string; data: () => unknown }>;
type DashboardSnapshot = Readonly<{ docs: readonly DashboardDocument[] }>;
type DashboardQuery = Readonly<{ get: () => Promise<DashboardSnapshot> }>;

export type FinancialDashboardFirestore = Readonly<{
  collection: (path: string) => Readonly<{ limit: (value: number) => DashboardQuery }>;
}>;

export type FinancialDashboardStore = Readonly<{
  getFinancialDashboard: (academyId: string, month?: string) => Promise<FinancialDashboard>;
}>;

export class FinancialDashboardStoreError extends Error {
  public readonly code: "invalid" | "tenant" | "source-limit" | "month";

  public constructor(code: FinancialDashboardStoreError["code"], message: string) {
    super(message);
    this.name = "FinancialDashboardStoreError";
    this.code = code;
  }
}

export const financialDashboardSourceLimit = 5_000;
const sourceReadLimit = financialDashboardSourceLimit + 1;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    throw new FinancialDashboardStoreError("invalid", `Invalid ${label}`);
  }
  return value;
}

function timestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !dateTimePattern.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new FinancialDashboardStoreError("invalid", "Invalid dashboard timestamp");
  }
  return value;
}

function collectionPath(academyId: string, name: string): string {
  return `academies/${identifier(academyId, "academy")}/${name}`;
}

function boundedDocuments(snapshot: DashboardSnapshot): readonly DashboardDocument[] {
  if (snapshot.docs.length > financialDashboardSourceLimit) {
    throw new FinancialDashboardStoreError("source-limit", "Financial source limit exceeded");
  }
  return snapshot.docs;
}

function assertUniqueId(ids: Set<string>, id: string): void {
  if (ids.has(id)) {
    throw new FinancialDashboardStoreError("invalid", "Duplicate financial source identity");
  }
  ids.add(id);
}

function membershipsFrom(
  documents: readonly DashboardDocument[],
  academyId: string,
): readonly MembershipRecord[] {
  const ids = new Set<string>();
  return documents.map((document) => {
    identifier(document.id, "membership document");
    assertUniqueId(ids, document.id);
    const parsed = parseMembershipRecord(document.data());
    if (!parsed.ok || parsed.value.membershipId !== document.id) {
      throw new FinancialDashboardStoreError("invalid", "Invalid membership source");
    }
    if (parsed.value.academyId !== academyId) {
      throw new FinancialDashboardStoreError("tenant", "Membership tenant mismatch");
    }
    return parsed.value;
  });
}

function invoicesFrom(
  documents: readonly DashboardDocument[],
  academyId: string,
): readonly InvoiceRecord[] {
  const ids = new Set<string>();
  return documents.map((document) => {
    identifier(document.id, "invoice document");
    assertUniqueId(ids, document.id);
    const parsed = parseInvoiceRecord(document.data());
    if (!parsed.ok || parsed.value.invoiceId !== document.id) {
      throw new FinancialDashboardStoreError("invalid", "Invalid invoice source");
    }
    if (parsed.value.academyId !== academyId) {
      throw new FinancialDashboardStoreError("tenant", "Invoice tenant mismatch");
    }
    return parsed.value;
  });
}

function paymentsFrom(
  documents: readonly DashboardDocument[],
  academyId: string,
): readonly ManualPaymentRecord[] {
  const ids = new Set<string>();
  return documents.map((document) => {
    identifier(document.id, "payment document");
    assertUniqueId(ids, document.id);
    const parsed = parseManualPaymentRecord(document.data());
    if (!parsed.ok || parsed.value.paymentId !== document.id) {
      throw new FinancialDashboardStoreError("invalid", "Invalid payment source");
    }
    if (parsed.value.academyId !== academyId) {
      throw new FinancialDashboardStoreError("tenant", "Payment tenant mismatch");
    }
    return parsed.value;
  });
}

function voidedFrom(
  documents: readonly DashboardDocument[],
  academyId: string,
): readonly VoidedPaymentRecord[] {
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

function shopPaymentsFrom(
  documents: readonly DashboardDocument[],
  academyId: string,
): readonly DashboardShopPayment[] {
  const rows: DashboardShopPayment[] = [];
  for (const document of documents) {
    const parsed = parseShopOrderRecord(document.data());
    if (!parsed.ok || parsed.value.orderId !== document.id) {
      throw new FinancialDashboardStoreError("invalid", "Invalid shop order source");
    }
    const order = parsed.value;
    if (order.academyId !== academyId) {
      throw new FinancialDashboardStoreError("tenant", "Shop order tenant mismatch");
    }
    // A zero total collected nothing, and dashboard rows carry positive amounts only.
    if (order.paymentStatus !== "paid" || order.status === "cancelled" || order.totalMinor === 0) {
      continue;
    }
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
  const value =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)[field]
      : undefined;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function validateRelationships(
  memberships: readonly MembershipRecord[],
  invoices: readonly InvoiceRecord[],
  payments: readonly ManualPaymentRecord[],
): void {
  const membershipById = new Map(memberships.map((record) => [record.membershipId, record]));
  const invoiceById = new Map(invoices.map((record) => [record.invoiceId, record]));
  const totalsByInvoice = new Map<string, number>();

  for (const invoice of invoices) {
    // A membership-less invoice has no membership to relate to.
    if (invoice.membershipId === null) continue;
    const membership = membershipById.get(invoice.membershipId);
    if (membership === undefined || membership.familyId !== invoice.familyId) {
      throw new FinancialDashboardStoreError("tenant", "Invoice relationship mismatch");
    }
  }

  for (const payment of payments) {
    const invoice = invoiceById.get(payment.invoiceId);
    if (invoice === undefined || !sameInvoicePayer(invoice, payment)) {
      throw new FinancialDashboardStoreError("tenant", "Payment relationship mismatch");
    }
    const total = (totalsByInvoice.get(payment.invoiceId) ?? 0) + payment.amountMinor;
    if (!Number.isSafeInteger(total) || total > invoice.totalMinor) {
      throw new FinancialDashboardStoreError("invalid", "Invalid payment allocation");
    }
    totalsByInvoice.set(payment.invoiceId, total);
  }

  for (const invoice of invoices) {
    const paidMinor = totalsByInvoice.get(invoice.invoiceId) ?? 0;
    const coherent =
      (invoice.status === "open" && paidMinor === 0) ||
      (invoice.status === "partially_paid" && paidMinor > 0 && paidMinor < invoice.totalMinor) ||
      (invoice.status === "paid" && paidMinor === invoice.totalMinor) ||
      (invoice.status === "void" && paidMinor === 0);
    if (!coherent) {
      throw new FinancialDashboardStoreError("invalid", "Inconsistent invoice allocation state");
    }
  }
}

export function createFirestoreFinancialDashboardStore(options: {
  firestore: FinancialDashboardFirestore;
  now?: () => string;
}): FinancialDashboardStore {
  return Object.freeze({
    async getFinancialDashboard(academyIdInput, monthInput) {
      const academyId = identifier(academyIdInput, "academy");
      const generatedAt = timestamp(options.now?.() ?? new Date().toISOString());
      const month = monthInput ?? currentFinancialMonth(generatedAt);
      if (month > currentFinancialMonth(generatedAt)) {
        throw new FinancialDashboardStoreError("month", "The month has not started yet");
      }
      // ponytail: full scans of every source (about 60 docs each on 2026-10-01); move to
      // month-ranged queries plus a running aggregate when any collection nears
      // financialDashboardSourceLimit.
      const read = (name: string) =>
        options.firestore.collection(collectionPath(academyId, name)).limit(sourceReadLimit).get();
      const [
        membershipSnapshot,
        invoiceSnapshot,
        paymentSnapshot,
        voidedSnapshot,
        shopSnapshot,
        planSnapshot,
        lessonSnapshot,
      ] = await Promise.all([
        read("memberships"),
        read("invoices"),
        read("payments"),
        read("voidedPayments"),
        read("shopOrders"),
        read("plans"),
        read("privateLessonPurchases"),
      ]);
      const memberships = membershipsFrom(boundedDocuments(membershipSnapshot), academyId);
      const invoices = invoicesFrom(boundedDocuments(invoiceSnapshot), academyId);
      const payments = paymentsFrom(boundedDocuments(paymentSnapshot), academyId);
      validateRelationships(memberships, invoices, payments);
      const voidedPayments = voidedFrom(boundedDocuments(voidedSnapshot), academyId);
      const shopPayments = shopPaymentsFrom(boundedDocuments(shopSnapshot), academyId);
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
        generatedAt,
        month,
        memberships,
        invoices,
        payments,
        voidedPayments,
        shopPayments,
        studentByInvoiceId,
        planNames,
      });
    },
  });
}
