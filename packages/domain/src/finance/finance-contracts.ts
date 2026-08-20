import type { ValidationIssue } from "../errors";
import { err, ok, type Result } from "../result";

export const invoiceStatuses = Object.freeze(["open", "partially_paid", "paid", "void"] as const);
export type InvoiceStatus = (typeof invoiceStatuses)[number];

export const chargeKinds = Object.freeze([
  "membership",
  "payg_session",
  "manual_adjustment",
] as const);
export type ChargeKind = (typeof chargeKinds)[number];

export const manualPaymentMethods = Object.freeze(["cash", "bank_transfer", "other"] as const);
export type ManualPaymentMethod = (typeof manualPaymentMethods)[number];

export type InvoiceRecord = Readonly<{
  invoiceId: string;
  academyId: string;
  familyId: string;
  membershipId: string;
  status: InvoiceStatus;
  totalMinor: number;
  currency: "GBP";
  dueAt: string;
  paidAt: string | null;
  schemaVersion: 1;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  chargeKind: ChargeKind;
  sourceRef: string | null;
  invoiceReference: string;
  description: string;
}>;

export type ManualPaymentRecord = Readonly<{
  paymentId: string;
  academyId: string;
  familyId: string;
  invoiceId: string;
  status: "recorded";
  amountMinor: number;
  currency: "GBP";
  method: ManualPaymentMethod;
  manualReference: string;
  providerReference: null;
  occurredAt: string;
  schemaVersion: 1;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

const invoiceFields = Object.freeze([
  "invoiceId",
  "academyId",
  "familyId",
  "membershipId",
  "status",
  "totalMinor",
  "currency",
  "dueAt",
  "paidAt",
  "schemaVersion",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
  "chargeKind",
  "sourceRef",
  "invoiceReference",
  "description",
] as const);

const paymentFields = Object.freeze([
  "paymentId",
  "academyId",
  "familyId",
  "invoiceId",
  "status",
  "amountMinor",
  "currency",
  "method",
  "manualReference",
  "providerReference",
  "occurredAt",
  "schemaVersion",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
] as const);

const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,511}$/u;
const manualReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

function issue(path: readonly (string | number)[], code: string): ValidationIssue {
  return Object.freeze({ path: Object.freeze([...path]), code });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function readExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): Result<Record<string, unknown>, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const data: Record<string, unknown> = {};

  for (const key of Reflect.ownKeys(value)) {
    const descriptor =
      typeof key === "string" ? Object.getOwnPropertyDescriptor(value, key) : undefined;
    if (
      typeof key !== "string" ||
      !fields.includes(key) ||
      descriptor?.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      issues.push(issue(typeof key === "string" ? [key] : [], "unexpected_property"));
      continue;
    }
    data[key] = descriptor.value;
  }

  for (const field of fields) {
    if (!Object.hasOwn(data, field)) issues.push(issue([field], "missing"));
  }

  return issues.length > 0 ? err(Object.freeze(issues)) : ok(data);
}

function validString(value: unknown, maxLength: number, pattern?: RegExp): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !controlCharacterPattern.test(value) &&
    (pattern === undefined || pattern.test(value))
  );
}

function validDateTime(value: unknown): value is string {
  return (
    typeof value === "string" && dateTimePattern.test(value) && !Number.isNaN(Date.parse(value))
  );
}

function validAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function parseInvoiceValues(
  data: Record<string, unknown>,
): Result<InvoiceRecord, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const identifiers = [
    "invoiceId",
    "academyId",
    "familyId",
    "membershipId",
    "createdBy",
    "updatedBy",
    "invoiceReference",
  ] as const;
  for (const field of identifiers) {
    if (!validString(data[field], 128, identifierPattern))
      issues.push(issue([field], "invalid_identifier"));
  }
  if (!validEnum(data.status, invoiceStatuses)) issues.push(issue(["status"], "invalid_enum"));
  if (!validAmount(data.totalMinor)) issues.push(issue(["totalMinor"], "invalid_amount"));
  if (data.currency !== "GBP") issues.push(issue(["currency"], "invalid_currency"));
  for (const field of ["dueAt", "createdAt", "updatedAt"] as const) {
    if (!validDateTime(data[field])) issues.push(issue([field], "invalid_datetime"));
  }
  if (data.paidAt !== null && !validDateTime(data.paidAt))
    issues.push(issue(["paidAt"], "invalid_datetime"));
  if (data.schemaVersion !== 1) issues.push(issue(["schemaVersion"], "invalid_schema_version"));
  if (!validEnum(data.chargeKind, chargeKinds)) issues.push(issue(["chargeKind"], "invalid_enum"));
  if (data.sourceRef !== null && !validString(data.sourceRef, 512, referencePattern)) {
    issues.push(issue(["sourceRef"], "invalid_reference"));
  }
  if (!validString(data.description, 200))
    issues.push(issue(["description"], "invalid_description"));
  if (data.chargeKind === "payg_session" && !validString(data.sourceRef, 512, referencePattern)) {
    issues.push(issue(["sourceRef"], "required_for_payg"));
  }
  if (data.status === "paid" && data.paidAt === null)
    issues.push(issue(["paidAt"], "required_for_paid"));
  if (data.status !== "paid" && data.paidAt !== null)
    issues.push(issue(["paidAt"], "must_be_null"));
  return issues.length > 0
    ? err(Object.freeze(issues))
    : ok(Object.freeze({ ...data }) as InvoiceRecord);
}

function parsePaymentValues(
  data: Record<string, unknown>,
): Result<ManualPaymentRecord, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  for (const field of [
    "paymentId",
    "academyId",
    "familyId",
    "invoiceId",
    "createdBy",
    "updatedBy",
  ] as const) {
    if (!validString(data[field], 128, identifierPattern))
      issues.push(issue([field], "invalid_identifier"));
  }
  if (data.status !== "recorded") issues.push(issue(["status"], "invalid_status"));
  if (!validAmount(data.amountMinor)) issues.push(issue(["amountMinor"], "invalid_amount"));
  if (data.currency !== "GBP") issues.push(issue(["currency"], "invalid_currency"));
  if (!validEnum(data.method, manualPaymentMethods)) issues.push(issue(["method"], "invalid_enum"));
  if (!validString(data.manualReference, 128, manualReferencePattern)) {
    issues.push(issue(["manualReference"], "invalid_reference"));
  }
  if (data.providerReference !== null) issues.push(issue(["providerReference"], "must_be_null"));
  if (!validDateTime(data.occurredAt)) issues.push(issue(["occurredAt"], "invalid_datetime"));
  if (data.schemaVersion !== 1) issues.push(issue(["schemaVersion"], "invalid_schema_version"));
  if (!validDateTime(data.createdAt)) issues.push(issue(["createdAt"], "invalid_datetime"));
  if (!validDateTime(data.updatedAt)) issues.push(issue(["updatedAt"], "invalid_datetime"));
  return issues.length > 0
    ? err(Object.freeze(issues))
    : ok(Object.freeze({ ...data }) as ManualPaymentRecord);
}

export function parseInvoiceRecord(
  value: unknown,
): Result<InvoiceRecord, readonly ValidationIssue[]> {
  if (!isPlainRecord(value)) return err(Object.freeze([issue([], "expected_plain_object")]));
  const fields = readExactFields(value, invoiceFields);
  return fields.ok ? parseInvoiceValues(fields.value) : fields;
}

export function parseManualPaymentRecord(
  value: unknown,
): Result<ManualPaymentRecord, readonly ValidationIssue[]> {
  if (!isPlainRecord(value)) return err(Object.freeze([issue([], "expected_plain_object")]));
  const fields = readExactFields(value, paymentFields);
  return fields.ok ? parsePaymentValues(fields.value) : fields;
}

export function calculateInvoiceBalance(
  invoice: InvoiceRecord,
  payments: readonly ManualPaymentRecord[],
): number {
  if (invoice.status === "void") return 0;
  const paidMinor = payments
    .filter(
      (payment) =>
        payment.status === "recorded" &&
        payment.academyId === invoice.academyId &&
        payment.familyId === invoice.familyId &&
        payment.invoiceId === invoice.invoiceId,
    )
    .reduce((total, payment) => total + payment.amountMinor, 0);
  return Math.max(0, invoice.totalMinor - paidMinor);
}

export function calculateAccountBalance(
  invoices: readonly InvoiceRecord[],
  payments: readonly ManualPaymentRecord[],
): number {
  return invoices.reduce((total, invoice) => total + calculateInvoiceBalance(invoice, payments), 0);
}

export function calculatePaygDebt(
  invoices: readonly InvoiceRecord[],
  payments: readonly ManualPaymentRecord[],
): number {
  return invoices
    .filter((invoice) => invoice.chargeKind === "payg_session")
    .reduce((total, invoice) => total + calculateInvoiceBalance(invoice, payments), 0);
}
