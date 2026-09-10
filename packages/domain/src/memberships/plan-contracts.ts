import type { ValidationIssue } from "../errors";
import { err, ok, type Result } from "../result";

export const planIds = Object.freeze([
  "payg",
  "bpt-jersey-adult",
  "west-kids-1x",
  "west-kids-2x",
  "west-adult",
  "west-teens",
  "town-adult",
  "town-kids-1x",
  "town-kids-2x",
  "town-teens",
] as const);
export type PlanId = (typeof planIds)[number];

export const participantTypes = Object.freeze(["adult", "kids", "teens"] as const);
export type ParticipantType = (typeof participantTypes)[number];

export const billingPeriods = Object.freeze(["per-session", "monthly"] as const);
export type BillingPeriod = (typeof billingPeriods)[number];

export const siteValues = Object.freeze(["Town", "West"] as const);
export type Site = (typeof siteValues)[number];

export const sessionTypes = Object.freeze(["class", "openMat"] as const);
export type SessionType = (typeof sessionTypes)[number];

type PlanFields = Readonly<{
  planId: PlanId;
  displayName: string;
  priceMinor: number;
  currency: "GBP";
  billingPeriod: BillingPeriod;
  eligibleParticipantTypes: readonly ParticipantType[];
  classSites: readonly Site[];
  weeklyClassLimit: 1 | 2 | null;
  openMatSites: readonly Site[];
  openMatFeeMinor: number | null;
}>;

export type PlanDraft = PlanFields;

export type PlanRecord = PlanFields &
  Readonly<{
    academyId: string;
    active: boolean;
    schemaVersion: "1";
    createdAt: string;
    createdBy: string;
    updatedAt: string;
    updatedBy: string;
  }>;

export type PlanAccessInput = Readonly<{
  participantType: ParticipantType;
  site: Site;
  sessionType: SessionType;
  weeklyClassesUsed: number;
}>;

type PlanAccessDenialCode =
  | "INVALID_PLAN"
  | "INVALID_INPUT"
  | "PLAN_INACTIVE"
  | "PARTICIPANT_TYPE_NOT_ELIGIBLE"
  | "CLASS_SITE_NOT_ELIGIBLE"
  | "WEEKLY_LIMIT_REACHED"
  | "OPEN_MAT_SITE_NOT_ELIGIBLE";

export type PlanAccessDecision =
  | Readonly<{
      allowed: true;
      code: "ALLOWED";
      feeMinor: number;
    }>
  | Readonly<{
      allowed: false;
      code: PlanAccessDenialCode;
      feeMinor: 0;
    }>;

const planDraftFields = Object.freeze([
  "planId",
  "displayName",
  "priceMinor",
  "currency",
  "billingPeriod",
  "eligibleParticipantTypes",
  "classSites",
  "weeklyClassLimit",
  "openMatSites",
  "openMatFeeMinor",
] as const);
const planRecordFields = Object.freeze([
  ...planDraftFields,
  "academyId",
  "active",
  "schemaVersion",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
] as const);
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

function issue(path: readonly (string | number)[], code: string): ValidationIssue {
  return { path, code };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function readDataFields(
  value: Record<string, unknown>,
  required: readonly string[],
  issues: ValidationIssue[],
): Record<string, unknown> {
  const descriptors = new Map<string, PropertyDescriptor>();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !required.includes(key) ||
      descriptor?.enumerable !== true ||
      descriptor?.get !== undefined ||
      descriptor?.set !== undefined ||
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      issues.push(issue(typeof key === "string" ? [key] : [], "unexpected_property"));
    } else {
      descriptors.set(key, descriptor);
    }
  }
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of required) {
    const descriptor = descriptors.get(key);
    if (descriptor === undefined) {
      issues.push(issue([key], "missing_property"));
    } else {
      snapshot[key] = descriptor.value;
    }
  }
  return snapshot;
}

function isNonEmptyText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !controlCharacterPattern.test(value)
  );
}

function isSafeMinor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isValidDateTime(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !dateTimePattern.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (!match) return false;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function parseEnumArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: readonly (string | number)[],
  issues: ValidationIssue[],
  nonEmpty: boolean,
): readonly T[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(issue(path, "invalid_type"));
    return undefined;
  }
  const descriptors = new Map<PropertyKey, PropertyDescriptor>();
  let keysAreIndexes = true;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    descriptors.set(key, descriptor as PropertyDescriptor);
    if (key === "length") continue;
    if (
      typeof key !== "string" ||
      !/^\d+$/u.test(key) ||
      descriptor?.enumerable !== true ||
      descriptor?.get !== undefined ||
      descriptor?.set !== undefined ||
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      keysAreIndexes = false;
    }
  }
  const lengthDescriptor = descriptors.get("length");
  const length =
    lengthDescriptor !== undefined &&
    Object.hasOwn(lengthDescriptor, "value") &&
    Number.isSafeInteger(lengthDescriptor.value) &&
    lengthDescriptor.value >= 0
      ? lengthDescriptor.value
      : undefined;
  const entries: unknown[] = [];
  if (length !== undefined) {
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors.get(String(index));
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        !Object.hasOwn(descriptor, "value")
      ) {
        keysAreIndexes = false;
      } else {
        entries.push(descriptor.value);
      }
    }
  }
  if (!keysAreIndexes || length === undefined || entries.length !== length) {
    issues.push(issue(path, "unexpected_property"));
    return undefined;
  }
  if ((nonEmpty && length === 0) || new Set(entries).size !== length) {
    issues.push(issue(path, length === 0 ? "empty_array" : "duplicate_value"));
    return undefined;
  }
  const parsed: T[] = [];
  entries.forEach((entry, index) => {
    if (typeof entry !== "string" || !allowed.includes(entry as T)) {
      issues.push(issue([...path, index], "unknown_enum"));
    } else {
      parsed.push(entry as T);
    }
  });
  if (parsed.length !== length) return undefined;
  parsed.sort((left, right) => allowed.indexOf(left) - allowed.indexOf(right));
  return Object.freeze(parsed);
}

function parsePlanFields(
  value: Record<string, unknown>,
  issues: ValidationIssue[],
): PlanFields | undefined {
  const planId = planIds.includes(value.planId as PlanId) ? (value.planId as PlanId) : undefined;
  if (planId === undefined) issues.push(issue(["planId"], "unknown_enum"));
  if (!isNonEmptyText(value.displayName, 160)) issues.push(issue(["displayName"], "invalid_text"));
  if (!isSafeMinor(value.priceMinor)) issues.push(issue(["priceMinor"], "invalid_money"));
  if (value.currency !== "GBP") issues.push(issue(["currency"], "unknown_enum"));
  const billingPeriod = billingPeriods.includes(value.billingPeriod as BillingPeriod)
    ? (value.billingPeriod as BillingPeriod)
    : undefined;
  if (billingPeriod === undefined) issues.push(issue(["billingPeriod"], "unknown_enum"));
  const eligibleParticipantTypes = parseEnumArray(
    value.eligibleParticipantTypes,
    participantTypes,
    ["eligibleParticipantTypes"],
    issues,
    true,
  );
  const classSites = parseEnumArray(value.classSites, siteValues, ["classSites"], issues, true);
  const openMatSites = parseEnumArray(
    value.openMatSites,
    siteValues,
    ["openMatSites"],
    issues,
    true,
  );
  if (
    value.weeklyClassLimit !== null &&
    value.weeklyClassLimit !== 1 &&
    value.weeklyClassLimit !== 2
  ) {
    issues.push(issue(["weeklyClassLimit"], "invalid_limit"));
  }
  if (value.openMatFeeMinor !== null && !isSafeMinor(value.openMatFeeMinor)) {
    issues.push(issue(["openMatFeeMinor"], "invalid_money"));
  }
  if (
    planId === undefined ||
    !isNonEmptyText(value.displayName, 160) ||
    !isSafeMinor(value.priceMinor) ||
    billingPeriod === undefined ||
    eligibleParticipantTypes === undefined ||
    classSites === undefined ||
    openMatSites === undefined ||
    (value.weeklyClassLimit !== null &&
      value.weeklyClassLimit !== 1 &&
      value.weeklyClassLimit !== 2) ||
    (value.openMatFeeMinor !== null && !isSafeMinor(value.openMatFeeMinor))
  ) {
    return undefined;
  }
  return {
    planId,
    displayName: value.displayName,
    priceMinor: value.priceMinor,
    currency: "GBP",
    billingPeriod,
    eligibleParticipantTypes,
    classSites,
    weeklyClassLimit: value.weeklyClassLimit,
    openMatSites,
    openMatFeeMinor: value.openMatFeeMinor,
  };
}

function parseResult<T>(
  value: T | undefined,
  issues: readonly ValidationIssue[],
): Result<T, readonly ValidationIssue[]> {
  return issues.length === 0 && value !== undefined
    ? ok(Object.freeze(value))
    : err(Object.freeze([...issues]));
}

export function parsePlanDraft(value: unknown): Result<PlanDraft, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  try {
    if (!isPlainRecord(value)) return err(Object.freeze([issue([], "invalid_type")]));
    const snapshot = readDataFields(value, planDraftFields, issues);
    return parseResult(parsePlanFields(snapshot, issues), issues);
  } catch {
    return err(Object.freeze([...issues, issue([], "invalid_input")]));
  }
}

export function parsePlanRecord(value: unknown): Result<PlanRecord, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  try {
    if (!isPlainRecord(value)) return err(Object.freeze([issue([], "invalid_type")]));
    const snapshot = readDataFields(value, planRecordFields, issues);
    const fields = parsePlanFields(snapshot, issues);
    if (
      !isNonEmptyText(snapshot.academyId, 128) ||
      !identifierPattern.test(snapshot.academyId as string)
    ) {
      issues.push(issue(["academyId"], "invalid_identifier"));
    }
    if (typeof snapshot.active !== "boolean") issues.push(issue(["active"], "invalid_type"));
    if (snapshot.schemaVersion !== "1") issues.push(issue(["schemaVersion"], "unknown_version"));
    for (const field of ["createdBy", "updatedBy"] as const) {
      if (
        !isNonEmptyText(snapshot[field], 128) ||
        !identifierPattern.test(snapshot[field] as string)
      ) {
        issues.push(issue([field], "invalid_identifier"));
      }
    }
    for (const field of ["createdAt", "updatedAt"] as const) {
      if (!isValidDateTime(snapshot[field])) issues.push(issue([field], "invalid_iso_datetime"));
    }
    if (
      fields === undefined ||
      typeof snapshot.active !== "boolean" ||
      snapshot.schemaVersion !== "1" ||
      !isNonEmptyText(snapshot.academyId, 128) ||
      !identifierPattern.test(snapshot.academyId as string) ||
      !isNonEmptyText(snapshot.createdBy, 128) ||
      !identifierPattern.test(snapshot.createdBy as string) ||
      !isNonEmptyText(snapshot.updatedBy, 128) ||
      !identifierPattern.test(snapshot.updatedBy as string) ||
      !isValidDateTime(snapshot.createdAt) ||
      !isValidDateTime(snapshot.updatedAt)
    ) {
      return err(Object.freeze([...issues]));
    }
    return parseResult(
      {
        ...fields,
        academyId: snapshot.academyId,
        active: snapshot.active,
        schemaVersion: "1",
        createdAt: snapshot.createdAt,
        createdBy: snapshot.createdBy,
        updatedAt: snapshot.updatedAt,
        updatedBy: snapshot.updatedBy,
      },
      issues,
    );
  } catch {
    return err(Object.freeze([...issues, issue([], "invalid_input")]));
  }
}

function readPlanAccessInput(value: unknown): PlanAccessInput | undefined {
  if (!isPlainRecord(value)) return undefined;
  const issues: ValidationIssue[] = [];
  const snapshot = readDataFields(
    value,
    ["participantType", "site", "sessionType", "weeklyClassesUsed"],
    issues,
  );
  return issues.length === 0 ? (snapshot as PlanAccessInput) : undefined;
}

function draft(
  planId: PlanId,
  displayName: string,
  priceMinor: number,
  billingPeriod: BillingPeriod,
  eligibleParticipantTypes: readonly ParticipantType[],
  classSites: readonly Site[],
  weeklyClassLimit: 1 | 2 | null,
  openMatSites: readonly Site[],
  openMatFeeMinor: number | null,
): PlanDraft {
  return Object.freeze({
    planId,
    displayName,
    priceMinor,
    currency: "GBP" as const,
    billingPeriod,
    eligibleParticipantTypes: Object.freeze([...eligibleParticipantTypes]),
    classSites: Object.freeze([...classSites]),
    weeklyClassLimit,
    openMatSites: Object.freeze([...openMatSites]),
    openMatFeeMinor,
  });
}

export const PLAN_CATALOG: readonly PlanDraft[] = Object.freeze([
  draft(
    "payg",
    "Pay as you go",
    1000,
    "per-session",
    ["adult", "kids", "teens"],
    ["Town", "West"],
    null,
    ["Town", "West"],
    null,
  ),
  draft(
    "bpt-jersey-adult",
    "BPT Jersey Adult",
    12500,
    "monthly",
    ["adult"],
    ["Town", "West"],
    null,
    ["Town", "West"],
    null,
  ),
  draft("west-kids-1x", "West Kids 1x", 9500, "monthly", ["kids"], ["West"], 1, ["West"], null),
  draft("west-kids-2x", "West Kids 2x", 11500, "monthly", ["kids"], ["West"], 2, ["Town"], null),
  draft(
    "west-adult",
    "West Adult",
    6500,
    "monthly",
    ["adult"],
    ["West"],
    null,
    ["Town", "West"],
    null,
  ),
  draft("west-teens", "West Teens", 4500, "monthly", ["teens"], ["West"], 2, ["West"], 750),
  draft("town-adult", "Town Adult", 8500, "monthly", ["adult"], ["Town"], null, ["Town"], null),
  draft("town-kids-1x", "Town Kids 1x", 9500, "monthly", ["kids"], ["Town"], 1, ["Town"], null),
  draft("town-kids-2x", "Town Kids 2x", 13500, "monthly", ["kids"], ["Town"], 2, ["Town"], null),
  draft("town-teens", "Town Teens", 4500, "monthly", ["teens"], ["Town"], 2, ["Town"], 750),
]);

function denied(code: PlanAccessDenialCode): PlanAccessDecision {
  return Object.freeze({ allowed: false as const, code, feeMinor: 0 as const });
}

export function evaluatePlanAccess(plan: PlanRecord, input: PlanAccessInput): PlanAccessDecision {
  try {
    const parsedPlan = parsePlanRecord(plan);
    if (!parsedPlan.ok) return denied("INVALID_PLAN");
    const safeInput = readPlanAccessInput(input);
    if (
      safeInput === undefined ||
      !participantTypes.includes(safeInput.participantType as ParticipantType) ||
      !siteValues.includes(safeInput.site as Site) ||
      !sessionTypes.includes(safeInput.sessionType as SessionType) ||
      !Number.isSafeInteger(safeInput.weeklyClassesUsed) ||
      safeInput.weeklyClassesUsed < 0
    ) {
      return denied("INVALID_INPUT");
    }
    const safePlan = parsedPlan.value;
    if (!safePlan.active) return denied("PLAN_INACTIVE");
    if (!safePlan.eligibleParticipantTypes.includes(safeInput.participantType)) {
      return denied("PARTICIPANT_TYPE_NOT_ELIGIBLE");
    }
    if (safeInput.sessionType === "class") {
      if (!safePlan.classSites.includes(safeInput.site)) return denied("CLASS_SITE_NOT_ELIGIBLE");
      if (
        safePlan.weeklyClassLimit !== null &&
        safeInput.weeklyClassesUsed >= safePlan.weeklyClassLimit
      ) {
        return denied("WEEKLY_LIMIT_REACHED");
      }
      return Object.freeze({
        allowed: true as const,
        code: "ALLOWED" as const,
        feeMinor: safePlan.billingPeriod === "per-session" ? safePlan.priceMinor : 0,
      });
    }
    if (!safePlan.openMatSites.includes(safeInput.site)) {
      return denied("OPEN_MAT_SITE_NOT_ELIGIBLE");
    }
    return Object.freeze({
      allowed: true as const,
      code: "ALLOWED" as const,
      feeMinor:
        safePlan.openMatFeeMinor ??
        (safePlan.billingPeriod === "per-session" ? safePlan.priceMinor : 0),
    });
  } catch {
    return denied("INVALID_INPUT");
  }
}
