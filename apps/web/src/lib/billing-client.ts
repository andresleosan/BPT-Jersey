import {
  manualPaymentMethods,
  parseInvoiceRecord,
  parseManualPaymentRecord,
  type ChargeKind,
  type InvoiceRecord,
  type ManualPaymentMethod,
  type ManualPaymentRecord,
} from "@bpt-jersey/domain/finance";
import { httpsCallable } from "firebase/functions";

import { getFirebaseFunctions } from "./firebase-client";

export type InvoiceView = Readonly<{
  invoice: InvoiceRecord;
  payments: readonly ManualPaymentRecord[];
  balanceMinor: number;
}>;

export type FinancialAccount = Readonly<{
  invoices: readonly InvoiceView[];
  balanceMinor: number;
  paygDebtMinor: number;
}>;

export type IssueManualInvoiceInput = Readonly<{
  familyId: string;
  membershipId: string;
  totalMinor: number;
  dueAt: string;
  chargeKind: Exclude<ChargeKind, "payg_session">;
  invoiceReference: string;
  description: string;
}>;

export type RecordManualPaymentInput = Readonly<{
  invoiceId: string;
  amountMinor: number;
  method: ManualPaymentMethod;
  manualReference: string;
  occurredAt: string;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const referencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;
const safeReadError = "Unable to load the billing account. Please try again.";
const safeInvoiceError = "Unable to save the invoice. Check the details and try again.";
const safePaymentError = "Unable to record the payment. Check the details and try again.";
const safeVoidError = "Unable to void the invoice. Refresh the account and try again.";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isReference(value: unknown): value is string {
  return typeof value === "string" && referencePattern.test(value);
}

function isPositiveMinor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isBalance(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    dateTimePattern.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function parseInvoice(value: unknown, message: string): InvoiceRecord {
  const parsed = parseInvoiceRecord(value);
  if (!parsed.ok) throw new Error(message);
  return Object.freeze(parsed.value);
}

function parsePayment(value: unknown, message: string): ManualPaymentRecord {
  const parsed = parseManualPaymentRecord(value);
  if (!parsed.ok) throw new Error(message);
  return Object.freeze(parsed.value);
}

function parseInvoiceView(value: unknown, message = safeReadError): InvoiceView {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["invoice", "payments", "balanceMinor"]) ||
    !Array.isArray(value.payments) ||
    !isBalance(value.balanceMinor)
  ) {
    throw new Error(message);
  }
  const invoice = parseInvoice(value.invoice, message);
  const payments = value.payments.map((item) => parsePayment(item, message));
  if (
    payments.some(
      (payment) =>
        payment.invoiceId !== invoice.invoiceId || payment.familyId !== invoice.familyId,
    )
  ) {
    throw new Error(message);
  }
  return Object.freeze({
    invoice,
    payments: Object.freeze(payments),
    balanceMinor: value.balanceMinor,
  });
}

function parseFinancialAccount(value: unknown): FinancialAccount {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["invoices", "balanceMinor", "paygDebtMinor"]) ||
    !Array.isArray(value.invoices) ||
    !isBalance(value.balanceMinor) ||
    !isBalance(value.paygDebtMinor)
  ) {
    throw new Error(safeReadError);
  }
  const invoices = value.invoices.map((item) => parseInvoiceView(item));
  if (new Set(invoices.map((item) => item.invoice.invoiceId)).size !== invoices.length) {
    throw new Error(safeReadError);
  }
  return Object.freeze({
    invoices: Object.freeze(invoices),
    balanceMinor: value.balanceMinor,
    paygDebtMinor: value.paygDebtMinor,
  });
}

function validateInvoiceInput(input: IssueManualInvoiceInput): void {
  if (
    !isIdentifier(input.familyId) ||
    !isIdentifier(input.membershipId) ||
    !isPositiveMinor(input.totalMinor) ||
    !isDateTime(input.dueAt) ||
    (input.chargeKind !== "membership" && input.chargeKind !== "manual_adjustment") ||
    !isReference(input.invoiceReference) ||
    typeof input.description !== "string" ||
    input.description.length === 0 ||
    input.description.length > 200 ||
    controlCharacterPattern.test(input.description)
  ) {
    throw new Error(safeInvoiceError);
  }
}

function validatePaymentInput(input: RecordManualPaymentInput): void {
  if (
    !isIdentifier(input.invoiceId) ||
    !isPositiveMinor(input.amountMinor) ||
    !manualPaymentMethods.includes(input.method) ||
    !isReference(input.manualReference) ||
    !isDateTime(input.occurredAt)
  ) {
    throw new Error(safePaymentError);
  }
}

const callableOptions = Object.freeze({ limitedUseAppCheckTokens: true });

export async function listFinancialAccount(): Promise<FinancialAccount> {
  try {
    const callable = httpsCallable<null, unknown>(
      getFirebaseFunctions(),
      "listFinancialAccount",
      callableOptions,
    );
    const response = await callable(null);
    return parseFinancialAccount(response.data);
  } catch {
    throw new Error(safeReadError);
  }
}

export async function issueManualInvoice(
  input: IssueManualInvoiceInput,
): Promise<InvoiceRecord> {
  try {
    validateInvoiceInput(input);
    const callable = httpsCallable<IssueManualInvoiceInput, unknown>(
      getFirebaseFunctions(),
      "issueManualInvoice",
      callableOptions,
    );
    const response = await callable(input);
    return parseInvoice(response.data, safeInvoiceError);
  } catch {
    throw new Error(safeInvoiceError);
  }
}

export async function recordManualPayment(
  input: RecordManualPaymentInput,
): Promise<ManualPaymentRecord> {
  try {
    validatePaymentInput(input);
    const callable = httpsCallable<RecordManualPaymentInput, unknown>(
      getFirebaseFunctions(),
      "recordManualPayment",
      callableOptions,
    );
    const response = await callable(input);
    const payment = parsePayment(response.data, safePaymentError);
    if (payment.invoiceId !== input.invoiceId) throw new Error(safePaymentError);
    return payment;
  } catch {
    throw new Error(safePaymentError);
  }
}

export async function voidManualInvoice(invoiceId: string): Promise<InvoiceRecord> {
  try {
    if (!isIdentifier(invoiceId)) throw new Error(safeVoidError);
    const callable = httpsCallable<Readonly<{ invoiceId: string }>, unknown>(
      getFirebaseFunctions(),
      "voidManualInvoice",
      callableOptions,
    );
    const response = await callable({ invoiceId });
    const invoice = parseInvoice(response.data, safeVoidError);
    if (invoice.invoiceId !== invoiceId || invoice.status !== "void") {
      throw new Error(safeVoidError);
    }
    return invoice;
  } catch {
    throw new Error(safeVoidError);
  }
}

export async function getInvoice(invoiceId: string): Promise<InvoiceView> {
  try {
    if (!isIdentifier(invoiceId)) throw new Error(safeReadError);
    const callable = httpsCallable<Readonly<{ invoiceId: string }>, unknown>(
      getFirebaseFunctions(),
      "getInvoice",
      callableOptions,
    );
    const response = await callable({ invoiceId });
    const view = parseInvoiceView(response.data);
    if (view.invoice.invoiceId !== invoiceId) throw new Error(safeReadError);
    return view;
  } catch {
    throw new Error(safeReadError);
  }
}
