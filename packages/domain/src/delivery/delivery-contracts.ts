import { err, ok, type Result } from "../result";
import type { ValidationIssue } from "../errors";

export const deliveryChannels = Object.freeze(["email", "sms"] as const);
export type DeliveryChannel = (typeof deliveryChannels)[number];

export const deliveryStatuses = Object.freeze([
  "accepted",
  "delivered",
  "failed",
  "skipped",
] as const);
export type DeliveryStatus = (typeof deliveryStatuses)[number];

export type ExternalDeliveryRequest = Readonly<{
  deliveryId: string;
  academyId: string;
  channel: DeliveryChannel;
  recipient: string;
  templateId: string;
  variables: Readonly<Record<string, string>>;
  requestedAt: string;
}>;

export type DeliveryProviderResult = Readonly<{
  status: DeliveryStatus;
  providerMessageId: string | null;
  failureCode: string | null;
  retryable: boolean;
}>;

export type DeliveryHistoryRecord = Readonly<{
  deliveryId: string;
  academyId: string;
  channel: DeliveryChannel;
  provider: string;
  status: DeliveryStatus;
  attempt: number;
  providerMessageId: string | null;
  failureCode: string | null;
  retryable: boolean;
  occurredAt: string;
  schemaVersion: 1;
}>;

const deliveryRequestFields = Object.freeze([
  "deliveryId",
  "academyId",
  "channel",
  "recipient",
  "templateId",
  "variables",
  "requestedAt",
] as const);

const deliveryHistoryFields = Object.freeze([
  "deliveryId",
  "academyId",
  "channel",
  "provider",
  "status",
  "attempt",
  "providerMessageId",
  "failureCode",
  "retryable",
  "occurredAt",
  "schemaVersion",
] as const);

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const providerPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const templatePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u;
const failureCodePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const phonePattern = /^\+[1-9]\d{7,14}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;

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

function validText(value: unknown, maxLength: number, pattern?: RegExp): value is string {
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

function validEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function parseVariables(
  value: unknown,
  path: string,
): Result<Readonly<Record<string, string>>, readonly ValidationIssue[]> {
  if (!isPlainRecord(value)) return err(Object.freeze([issue([path], "expected_plain_object")]));

  const issues: ValidationIssue[] = [];
  const variables: Record<string, string> = {};
  const variableKeyPattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;

  const keys = Object.keys(value);
  if (keys.length > 20) issues.push(issue([path], "too_many_variables"));
  for (const key of keys) {
    const raw = value[key];
    if (!variableKeyPattern.test(key)) {
      issues.push(issue([path, key], "invalid_variable_name"));
    } else if (!validText(raw, 2000)) {
      issues.push(issue([path, key], "invalid_variable_value"));
    } else {
      variables[key] = raw;
    }
  }

  return issues.length > 0 ? err(Object.freeze(issues)) : ok(Object.freeze(variables));
}

function parseDeliveryRequestValues(
  data: Record<string, unknown>,
): Result<ExternalDeliveryRequest, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  for (const field of ["deliveryId", "academyId"] as const) {
    if (!validText(data[field], 128, identifierPattern)) {
      issues.push(issue([field], "invalid_identifier"));
    }
  }
  if (!validEnum(data.channel, deliveryChannels))
    issues.push(issue(["channel"], "invalid_channel"));
  if (!validText(data.recipient, 320)) {
    issues.push(issue(["recipient"], "invalid_recipient"));
  } else if (data.channel === "email" && !emailPattern.test(data.recipient)) {
    issues.push(issue(["recipient"], "invalid_email"));
  } else if (data.channel === "sms" && !phonePattern.test(data.recipient)) {
    issues.push(issue(["recipient"], "invalid_phone"));
  }
  if (!validText(data.templateId, 96, templatePattern)) {
    issues.push(issue(["templateId"], "invalid_template"));
  }
  const variables = parseVariables(data.variables, "variables");
  if (!variables.ok) issues.push(...variables.error);
  if (!validDateTime(data.requestedAt)) issues.push(issue(["requestedAt"], "invalid_datetime"));

  return issues.length > 0
    ? err(Object.freeze(issues))
    : ok(
        Object.freeze({
          deliveryId: data.deliveryId as string,
          academyId: data.academyId as string,
          channel: data.channel as DeliveryChannel,
          recipient: data.recipient as string,
          templateId: data.templateId as string,
          variables: variables.ok ? variables.value : Object.freeze({}),
          requestedAt: data.requestedAt as string,
        }),
      );
}

export function parseExternalDeliveryRequest(
  value: unknown,
): Result<ExternalDeliveryRequest, readonly ValidationIssue[]> {
  if (!isPlainRecord(value)) return err(Object.freeze([issue([], "expected_plain_object")]));
  const fields = readExactFields(value, deliveryRequestFields);
  return fields.ok ? parseDeliveryRequestValues(fields.value) : fields;
}

export function buildDeliveryHistoryRecord(params: {
  request: ExternalDeliveryRequest;
  provider: string;
  result: DeliveryProviderResult;
  attempt: number;
  occurredAt: string;
}): DeliveryHistoryRecord {
  if (!validText(params.provider, 64, providerPattern))
    throw new Error("Invalid delivery provider");
  if (!Number.isSafeInteger(params.attempt) || params.attempt < 1 || params.attempt > 3) {
    throw new Error("Invalid delivery attempt");
  }
  if (!validDateTime(params.occurredAt)) throw new Error("Invalid delivery timestamp");

  return Object.freeze({
    deliveryId: params.request.deliveryId,
    academyId: params.request.academyId,
    channel: params.request.channel,
    provider: params.provider,
    status: params.result.status,
    attempt: params.attempt,
    providerMessageId: params.result.providerMessageId,
    failureCode: params.result.failureCode,
    retryable: params.result.retryable,
    occurredAt: params.occurredAt,
    schemaVersion: 1,
  });
}

export function buildDeliveryEventId(deliveryId: string, attempt: number): string {
  if (!identifierPattern.test(deliveryId) || !Number.isSafeInteger(attempt) || attempt < 1) {
    throw new Error("Invalid delivery event identity");
  }
  return `delivery_${deliveryId}_${attempt}`;
}

export function parseDeliveryHistoryRecord(
  value: unknown,
): Result<DeliveryHistoryRecord, readonly ValidationIssue[]> {
  if (!isPlainRecord(value)) return err(Object.freeze([issue([], "expected_plain_object")]));
  const fields = readExactFields(value, deliveryHistoryFields);
  if (!fields.ok) return fields;

  const data = fields.value;
  const issues: ValidationIssue[] = [];
  for (const field of ["deliveryId", "academyId"] as const) {
    if (!validText(data[field], 128, identifierPattern))
      issues.push(issue([field], "invalid_identifier"));
  }
  if (!validEnum(data.channel, deliveryChannels))
    issues.push(issue(["channel"], "invalid_channel"));
  if (!validText(data.provider, 64, providerPattern))
    issues.push(issue(["provider"], "invalid_provider"));
  if (!validEnum(data.status, deliveryStatuses)) issues.push(issue(["status"], "invalid_status"));
  if (
    !Number.isSafeInteger(data.attempt) ||
    (data.attempt as number) < 1 ||
    (data.attempt as number) > 3
  ) {
    issues.push(issue(["attempt"], "invalid_attempt"));
  }
  if (data.providerMessageId !== null && !validText(data.providerMessageId, 256)) {
    issues.push(issue(["providerMessageId"], "invalid_provider_message_id"));
  }
  if (data.failureCode !== null && !validText(data.failureCode, 64, failureCodePattern)) {
    issues.push(issue(["failureCode"], "invalid_failure_code"));
  }
  if (typeof data.retryable !== "boolean") issues.push(issue(["retryable"], "invalid_boolean"));
  if (!validDateTime(data.occurredAt)) issues.push(issue(["occurredAt"], "invalid_datetime"));
  if (data.schemaVersion !== 1) issues.push(issue(["schemaVersion"], "invalid_schema_version"));

  return issues.length > 0
    ? err(Object.freeze(issues))
    : ok(Object.freeze({ ...data }) as DeliveryHistoryRecord);
}
