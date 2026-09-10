import { err, ok, type Result } from "../result";
import type { ValidationIssue } from "../errors";

export const paymentCheckoutStatuses = Object.freeze([
  "created",
  "requires_action",
  "failed",
  "cancelled",
  "unconfigured",
] as const);
export type PaymentCheckoutStatus = (typeof paymentCheckoutStatuses)[number];

export type PaymentCheckoutRequest = Readonly<{
  academyId: string;
  invoiceId: string;
  familyId: string;
  amountMinor: number;
  currency: "GBP";
  idempotencyKey: string;
  requestedAt: string;
}>;

export type PaymentProviderResult = Readonly<{
  status: PaymentCheckoutStatus;
  providerCheckoutId: string | null;
  checkoutUrl: string | null;
  failureCode: string | null;
  retryable: boolean;
}>;

export type PaymentCheckoutRecord = Readonly<
  PaymentCheckoutRequest & {
    checkoutId: string;
    provider: string;
    status: PaymentCheckoutStatus;
    providerCheckoutId: string | null;
    checkoutUrl: string | null;
    failureCode: string | null;
    retryable: boolean;
    createdAt: string;
    updatedAt: string;
    schemaVersion: 1;
  }
>;

const requestFields = Object.freeze([
  "academyId",
  "invoiceId",
  "familyId",
  "amountMinor",
  "currency",
  "idempotencyKey",
  "requestedAt",
] as const);
const recordFields = Object.freeze([
  ...requestFields,
  "checkoutId",
  "provider",
  "status",
  "providerCheckoutId",
  "checkoutUrl",
  "failureCode",
  "retryable",
  "createdAt",
  "updatedAt",
  "schemaVersion",
] as const);
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const providerPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const urlPattern = /^https:\/\/[^\s/]+(?:\/[^\s]*)?$/u;
const failurePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
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
      descriptor?.get !== undefined ||
      descriptor?.set !== undefined ||
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      issues.push(issue(typeof key === "string" ? [key] : [], "unexpected_property"));
      continue;
    }
    data[key] = value[key];
  }
  for (const field of fields) {
    if (!Object.hasOwn(data, field)) issues.push(issue([field], "missing"));
  }
  return issues.length > 0 ? err(Object.freeze(issues)) : ok(data);
}

function validIdentifier(value: unknown, pattern = identifierPattern): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    !controlCharacterPattern.test(value) &&
    pattern.test(value)
  );
}

function validDateTime(value: unknown): value is string {
  return (
    typeof value === "string" && dateTimePattern.test(value) && !Number.isNaN(Date.parse(value))
  );
}

function parseRequestValues(
  data: Record<string, unknown>,
): Result<PaymentCheckoutRequest, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  for (const field of ["academyId", "invoiceId", "familyId"] as const) {
    if (!validIdentifier(data[field])) issues.push(issue([field], "invalid_identifier"));
  }
  if (!Number.isSafeInteger(data.amountMinor) || (data.amountMinor as number) <= 0) {
    issues.push(issue(["amountMinor"], "invalid_amount"));
  }
  if (data.currency !== "GBP") issues.push(issue(["currency"], "invalid_currency"));
  if (!validIdentifier(data.idempotencyKey, idempotencyPattern)) {
    issues.push(issue(["idempotencyKey"], "invalid_idempotency_key"));
  }
  if (!validDateTime(data.requestedAt)) issues.push(issue(["requestedAt"], "invalid_datetime"));
  return issues.length > 0
    ? err(Object.freeze(issues))
    : ok(Object.freeze({ ...data }) as PaymentCheckoutRequest);
}

export function parsePaymentCheckoutRequest(
  value: unknown,
): Result<PaymentCheckoutRequest, readonly ValidationIssue[]> {
  if (!isPlainRecord(value)) return err(Object.freeze([issue([], "expected_plain_object")]));
  const fields = readExactFields(value, requestFields);
  return fields.ok ? parseRequestValues(fields.value) : fields;
}

function parseRecordValues(
  data: Record<string, unknown>,
): Result<PaymentCheckoutRecord, readonly ValidationIssue[]> {
  const request = parseRequestValues(data);
  const issues: ValidationIssue[] = request.ok ? [] : [...request.error];
  for (const field of ["checkoutId"] as const) {
    if (!validIdentifier(data[field])) issues.push(issue([field], "invalid_identifier"));
  }
  if (!validIdentifier(data.provider, providerPattern))
    issues.push(issue(["provider"], "invalid_provider"));
  if (!paymentCheckoutStatuses.includes(data.status as PaymentCheckoutStatus)) {
    issues.push(issue(["status"], "invalid_status"));
  }
  if (data.providerCheckoutId !== null && !validIdentifier(data.providerCheckoutId)) {
    issues.push(issue(["providerCheckoutId"], "invalid_provider_checkout_id"));
  }
  if (
    data.checkoutUrl !== null &&
    (typeof data.checkoutUrl !== "string" ||
      data.checkoutUrl.length > 1024 ||
      !urlPattern.test(data.checkoutUrl))
  ) {
    issues.push(issue(["checkoutUrl"], "invalid_checkout_url"));
  }
  if (data.failureCode !== null && !validIdentifier(data.failureCode, failurePattern)) {
    issues.push(issue(["failureCode"], "invalid_failure_code"));
  }
  if (typeof data.retryable !== "boolean") issues.push(issue(["retryable"], "invalid_retryable"));
  for (const field of ["createdAt", "updatedAt"] as const) {
    if (!validDateTime(data[field])) issues.push(issue([field], "invalid_datetime"));
  }
  if (data.schemaVersion !== 1) issues.push(issue(["schemaVersion"], "invalid_schema_version"));
  if (issues.length > 0) return err(Object.freeze(issues));
  return ok(Object.freeze({ ...data }) as PaymentCheckoutRecord);
}

export function parsePaymentCheckoutRecord(
  value: unknown,
): Result<PaymentCheckoutRecord, readonly ValidationIssue[]> {
  if (!isPlainRecord(value)) return err(Object.freeze([issue([], "expected_plain_object")]));
  const fields = readExactFields(value, recordFields);
  return fields.ok ? parseRecordValues(fields.value) : fields;
}

export function parsePaymentProviderResult(value: unknown): PaymentProviderResult {
  if (
    !isPlainRecord(value) ||
    !paymentCheckoutStatuses.includes(value.status as PaymentCheckoutStatus)
  ) {
    return Object.freeze({
      status: "failed",
      providerCheckoutId: null,
      checkoutUrl: null,
      failureCode: "provider_invalid_response",
      retryable: false,
    });
  }
  const status = value.status as PaymentCheckoutStatus;
  const providerCheckoutId = validIdentifier(value.providerCheckoutId)
    ? value.providerCheckoutId
    : null;
  const checkoutUrl =
    typeof value.checkoutUrl === "string" && urlPattern.test(value.checkoutUrl)
      ? value.checkoutUrl
      : null;
  const failureCode = validIdentifier(value.failureCode, failurePattern) ? value.failureCode : null;
  if (status === "created" || status === "requires_action") {
    if (providerCheckoutId === null || checkoutUrl === null) {
      return Object.freeze({
        status: "failed",
        providerCheckoutId: null,
        checkoutUrl: null,
        failureCode: "provider_invalid_response",
        retryable: false,
      });
    }
    return Object.freeze({
      status,
      providerCheckoutId,
      checkoutUrl,
      failureCode: null,
      retryable: false,
    });
  }
  return Object.freeze({
    status,
    providerCheckoutId: null,
    checkoutUrl: null,
    failureCode:
      failureCode ?? (status === "unconfigured" ? "provider_unconfigured" : "provider_error"),
    retryable: status === "failed" && value.retryable === true,
  });
}

export function buildPaymentCheckoutRecord(params: {
  request: PaymentCheckoutRequest;
  checkoutId: string;
  provider: string;
  result: PaymentProviderResult;
  now: string;
}): PaymentCheckoutRecord {
  const candidate = {
    ...params.request,
    checkoutId: params.checkoutId,
    provider: params.provider,
    status: params.result.status,
    providerCheckoutId: params.result.providerCheckoutId,
    checkoutUrl: params.result.checkoutUrl,
    failureCode: params.result.failureCode,
    retryable: params.result.retryable,
    createdAt: params.now,
    updatedAt: params.now,
    schemaVersion: 1 as const,
  };
  const parsed = parsePaymentCheckoutRecord(candidate);
  if (!parsed.ok) throw new Error("Invalid payment checkout record");
  return parsed.value;
}
