import {
  buildFinancialDashboard,
  type FinancialDashboard,
} from "@bpt-jersey/domain/finance/dashboard";
import {
  parseInvoiceRecord,
  parseManualPaymentRecord,
  type InvoiceRecord,
  type ManualPaymentRecord,
} from "@bpt-jersey/domain/finance";
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
  getFinancialDashboard: (academyId: string) => Promise<FinancialDashboard>;
}>;

export class FinancialDashboardStoreError extends Error {
  public readonly code: "invalid" | "tenant" | "source-limit";

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

function validateRelationships(
  memberships: readonly MembershipRecord[],
  invoices: readonly InvoiceRecord[],
  payments: readonly ManualPaymentRecord[],
): void {
  const membershipById = new Map(memberships.map((record) => [record.membershipId, record]));
  const invoiceById = new Map(invoices.map((record) => [record.invoiceId, record]));
  const totalsByInvoice = new Map<string, number>();

  for (const invoice of invoices) {
    const membership = membershipById.get(invoice.membershipId);
    if (membership === undefined || membership.familyId !== invoice.familyId) {
      throw new FinancialDashboardStoreError("tenant", "Invoice relationship mismatch");
    }
  }

  for (const payment of payments) {
    const invoice = invoiceById.get(payment.invoiceId);
    if (invoice === undefined || invoice.familyId !== payment.familyId) {
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
    async getFinancialDashboard(academyIdInput) {
      const academyId = identifier(academyIdInput, "academy");
      const [membershipSnapshot, invoiceSnapshot, paymentSnapshot] = await Promise.all([
        options.firestore
          .collection(collectionPath(academyId, "memberships"))
          .limit(sourceReadLimit)
          .get(),
        options.firestore
          .collection(collectionPath(academyId, "invoices"))
          .limit(sourceReadLimit)
          .get(),
        options.firestore
          .collection(collectionPath(academyId, "payments"))
          .limit(sourceReadLimit)
          .get(),
      ]);
      const memberships = membershipsFrom(boundedDocuments(membershipSnapshot), academyId);
      const invoices = invoicesFrom(boundedDocuments(invoiceSnapshot), academyId);
      const payments = paymentsFrom(boundedDocuments(paymentSnapshot), academyId);
      validateRelationships(memberships, invoices, payments);
      return buildFinancialDashboard({
        generatedAt: timestamp(options.now?.() ?? new Date().toISOString()),
        memberships,
        invoices,
        payments,
      });
    },
  });
}
