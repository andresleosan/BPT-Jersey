import {
  buildOperationalReport,
  type OperationalReport,
  type OperationalReportAttendanceInput,
  type OperationalReportInvoiceInput,
  type OperationalReportMembershipInput,
  type OperationalReportPaymentInput,
  type OperationalReportQuery,
  type OperationalReportStudentInput,
} from "@bpt-jersey/domain/reports";

type FirestoreDocument = Readonly<{
  id: string;
  data: () => unknown;
}>;

type FirestoreSnapshot = Readonly<{
  docs: readonly FirestoreDocument[];
}>;

export type OperationalReportFirestore = Readonly<{
  collection: (path: string) => Readonly<{
    get: () => Promise<FirestoreSnapshot>;
  }>;
}>;

export type OperationalReportStore = Readonly<{
  getOperationalReport: (
    academyId: string,
    query: OperationalReportQuery,
  ) => Promise<OperationalReport>;
}>;

export class OperationalReportStoreError extends Error {
  public readonly code: "invalid" | "tenant";

  public constructor(code: "invalid" | "tenant", message: string) {
    super(message);
    this.name = "OperationalReportStoreError";
    this.code = code;
  }
}

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !safeIdentifierPattern.test(value)) {
    throw new OperationalReportStoreError("invalid", "Invalid " + label + " record");
  }
  return value;
}

function requiredDateTime(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !dateTimePattern.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new OperationalReportStoreError("invalid", "Invalid " + label + " timestamp");
  }
  return value;
}

function recordData(document: FirestoreDocument, academyId: string): Record<string, unknown> {
  requiredIdentifier(document.id, "document");
  const data = document.data();
  if (!isPlainRecord(data)) {
    throw new OperationalReportStoreError("invalid", "Invalid report source record");
  }
  if (data["academyId"] !== academyId) {
    throw new OperationalReportStoreError("tenant", "Report source tenant mismatch");
  }
  return data;
}

function studentInput(
  document: FirestoreDocument,
  academyId: string,
): OperationalReportStudentInput {
  const data = recordData(document, academyId);
  if (data["studentId"] !== document.id) {
    throw new OperationalReportStoreError("invalid", "Invalid student record");
  }
  const status = data["status"];
  const participantType = data["participantType"];
  const trainingCenter = data["trainingCenter"];
  if (status !== "active" && status !== "inactive" && status !== "suspended") {
    throw new OperationalReportStoreError("invalid", "Invalid student status");
  }
  if (participantType !== "adult" && participantType !== "minor") {
    throw new OperationalReportStoreError("invalid", "Invalid student participant type");
  }
  if (trainingCenter !== "Town" && trainingCenter !== "West") {
    throw new OperationalReportStoreError("invalid", "Invalid student training center");
  }
  return Object.freeze({
    studentId: document.id,
    status,
    participantType,
    trainingCenter,
  });
}

function attendanceInput(
  document: FirestoreDocument,
  academyId: string,
): OperationalReportAttendanceInput {
  const data = recordData(document, academyId);
  if (data["attendanceId"] !== document.id) {
    throw new OperationalReportStoreError("invalid", "Invalid attendance record");
  }
  const state = data["state"];
  if (
    state !== "attended" &&
    state !== "late" &&
    state !== "absent" &&
    state !== "no_show" &&
    state !== "excused"
  ) {
    throw new OperationalReportStoreError("invalid", "Invalid attendance state");
  }
  const correctionOf = data["correctionOf"];
  if (
    correctionOf !== null &&
    (typeof correctionOf !== "string" || !safeIdentifierPattern.test(correctionOf))
  ) {
    throw new OperationalReportStoreError("invalid", "Invalid attendance correction");
  }
  return Object.freeze({
    attendanceId: document.id,
    state,
    occurredAt: requiredDateTime(data["occurredAt"], "attendance"),
    correctionOf,
  });
}

function membershipInput(
  document: FirestoreDocument,
  academyId: string,
): OperationalReportMembershipInput {
  const data = recordData(document, academyId);
  if (data["membershipId"] !== document.id) {
    throw new OperationalReportStoreError("invalid", "Invalid membership record");
  }
  const status = data["status"];
  if (
    status !== "trial" &&
    status !== "active" &&
    status !== "paused" &&
    status !== "overdue" &&
    status !== "cancelled"
  ) {
    throw new OperationalReportStoreError("invalid", "Invalid membership status");
  }
  return Object.freeze({
    membershipId: document.id,
    studentId: requiredIdentifier(data["studentId"], "membership student"),
    status,
    updatedAt: requiredDateTime(data["updatedAt"], "membership"),
  });
}

function invoiceInput(
  document: FirestoreDocument,
  academyId: string,
): OperationalReportInvoiceInput {
  const data = recordData(document, academyId);
  if (data["invoiceId"] !== document.id) {
    throw new OperationalReportStoreError("invalid", "Invalid invoice record");
  }
  const status = data["status"];
  if (status !== "open" && status !== "partially_paid" && status !== "paid" && status !== "void") {
    throw new OperationalReportStoreError("invalid", "Invalid invoice status");
  }
  const totalMinor = data["totalMinor"];
  if (!Number.isSafeInteger(totalMinor) || (totalMinor as number) < 0) {
    throw new OperationalReportStoreError("invalid", "Invalid invoice amount");
  }
  return Object.freeze({
    invoiceId: document.id,
    status,
    totalMinor: totalMinor as number,
    createdAt: requiredDateTime(data["createdAt"], "invoice"),
  });
}

function paymentInput(
  document: FirestoreDocument,
  academyId: string,
): OperationalReportPaymentInput {
  const data = recordData(document, academyId);
  if (data["paymentId"] !== document.id) {
    throw new OperationalReportStoreError("invalid", "Invalid payment record");
  }
  const method = data["method"];
  if (method !== "cash" && method !== "bank_transfer" && method !== "other") {
    throw new OperationalReportStoreError("invalid", "Invalid payment method");
  }
  const amountMinor = data["amountMinor"];
  if (!Number.isSafeInteger(amountMinor) || (amountMinor as number) <= 0) {
    throw new OperationalReportStoreError("invalid", "Invalid payment amount");
  }
  return Object.freeze({
    paymentId: document.id,
    invoiceId: requiredIdentifier(data["invoiceId"], "payment invoice"),
    amountMinor: amountMinor as number,
    method,
    occurredAt: requiredDateTime(data["occurredAt"], "payment"),
  });
}

function collectionPath(academyId: string, collectionName: string): string {
  return "academies/" + requiredIdentifier(academyId, "academy") + "/" + collectionName;
}

export function createFirestoreOperationalReportStore(options: {
  firestore: OperationalReportFirestore;
  now?: () => string;
}): OperationalReportStore {
  return {
    async getOperationalReport(academyId, query) {
      requiredIdentifier(academyId, "academy");
      const [students, attendance, memberships, invoices, payments] = await Promise.all([
        options.firestore.collection(collectionPath(academyId, "students")).get(),
        options.firestore.collection(collectionPath(academyId, "attendance")).get(),
        options.firestore.collection(collectionPath(academyId, "memberships")).get(),
        options.firestore.collection(collectionPath(academyId, "invoices")).get(),
        options.firestore.collection(collectionPath(academyId, "payments")).get(),
      ]);

      const now = options.now?.();
      return buildOperationalReport({
        query,
        students: students.docs.map((document) => studentInput(document, academyId)),
        attendance: attendance.docs.map((document) => attendanceInput(document, academyId)),
        memberships: memberships.docs.map((document) => membershipInput(document, academyId)),
        invoices: invoices.docs.map((document) => invoiceInput(document, academyId)),
        payments: payments.docs.map((document) => paymentInput(document, academyId)),
        ...(now === undefined ? {} : { now }),
      });
    },
  };
}
