import { err, ok } from "../result";
import type { ValidationIssue } from "../errors";
import type { Result } from "../result";
import type { UtcDateTime } from "../time";

export const regyfitEntityNames = Object.freeze([
  "users",
  "families",
  "students",
  "staff",
  "programs",
  "classes",
  "bookings",
  "attendance",
  "memberships",
  "payments",
  "assessments",
  "leads",
  "communications",
  "documents",
  "consents",
  "audit",
] as const);

export type RegyfitEntityName = (typeof regyfitEntityNames)[number];

export const regyfitSensitivities = Object.freeze([
  "public",
  "internal",
  "confidential",
  "restricted",
] as const);

export type RegyfitSensitivity = (typeof regyfitSensitivities)[number];

export const regyfitMappingStrategies = Object.freeze([
  "direct",
  "normalize",
  "lookup",
  "exclude",
  "manual-review",
] as const);

export type RegyfitMappingStrategy = (typeof regyfitMappingStrategies)[number];

const regyfitDataTypes = Object.freeze([
  "text",
  "email",
  "phone",
  "number",
  "integer",
  "currency",
  "boolean",
  "date",
  "datetime",
  "time",
  "select",
  "multiselect",
  "reference",
  "file",
] as const);

type RegyfitDataType = (typeof regyfitDataTypes)[number];

export type RegyfitFieldSnapshot = Readonly<{
  name: string;
  label: string;
  dataType: RegyfitDataType;
  sensitivity: RegyfitSensitivity;
  required: boolean;
}>;

export type RegyfitModuleSnapshot = Readonly<{
  key: string;
  label: string;
  route: string;
  observedRoles: readonly string[];
  discoveryActions: readonly string[];
  fields: readonly RegyfitFieldSnapshot[];
}>;

export type RegyfitCapabilityMetadata = Readonly<{
  export: Readonly<{
    available: boolean;
    formats: readonly string[];
  }>;
  api: Readonly<{
    available: boolean;
    documented: boolean;
  }>;
}>;

export type RegyfitMapping = Readonly<{
  sourceEntity: RegyfitEntityName;
  sourceField: string;
  targetPath: string;
  strategy: RegyfitMappingStrategy;
  sensitivity: RegyfitSensitivity;
  reason: string;
}>;

export type RegyfitDiscoveryManifest = Readonly<{
  schemaVersion: "1";
  sourceSystem: "regyfit";
  capturedAtUtc: UtcDateTime;
  capabilities: RegyfitCapabilityMetadata;
  modules: readonly RegyfitModuleSnapshot[];
  mappings?: readonly RegyfitMapping[];
  notes: readonly string[];
}>;

type Path = readonly (string | number)[];
type RecordValue = Record<string, unknown>;

const unsafeTextPatterns = [
  /-----BEGIN(?: [^-]+)? PRIVATE KEY-----/i,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\b(?:password|passwd|token|secret|api[_-]?key|credential)\s*[:=]/i,
  /https?:\/\/[^/\s:@]+:[^@\s]+@/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\+?\d[\d\s().-]{7,}\d/,
  /\b(?:\d[ -]*?){13,19}\b/,
] as const;

const credentialFieldPattern =
  /(?:password|passwd|passcode|token|secret|api[_-]?key|credential|private[_-]?key|cvv|cvc|card(?:[_-]?number)?)/i;
const unsafePathSegmentPattern =
  /(?:payload|value|values|row|rows|record|records|password|passwd|token|secret|credential|api[_-]?key|private[_-]?key|cvv|cvc|card(?:[_-]?number)?)/i;
const reservedPrototypeSegmentPattern = /^(?:constructor|prototype|__proto__)$/i;
const mutatingDiscoveryActionPattern =
  /^(?:create|update|delete|destroy|write|edit|save|export|pay|payment|message|send|approve|correct|charge|refund|remove|archive|invite|new)(?:[-_ ]|$)/i;
const metadataControlPattern = /[\u0000-\u001f\u007f-\u009f]/;
const metadataDumpPattern =
  /^\s*[\[{]|(?:^|[,;]\s*)[A-Za-z][A-Za-z0-9_-]*\s*[:=]\s*[^,;]+(?:[,;]\s*[A-Za-z][A-Za-z0-9_-]*\s*[:=]){1,}/;
const metadataAddressPattern =
  /\b\d{1,5}\s+[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,4}\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|close|court|ct|way|place|pl|boulevard|blvd|terrace|crescent)\b/i;
const metadataPostalCodePattern = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
const metadataProperNamePattern = /^\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\s*$/;
const metadataNamedPersonPattern =
  /\b(?:name|student|parent|guardian|contact|person)\s*(?:is|:|-)?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/;
const metadataTextMaxLength = 512;
const bptFirestoreCollectionRoots = Object.freeze([
  "users",
  "families",
  "students",
  "staff",
  "relationships",
  "locations",
  "programs",
  "classes",
  "sessions",
  "plans",
  "bookings",
  "attendance",
  "checkouts",
  "memberships",
  "invoices",
  "payments",
  "paymentEvents",
  "assessments",
  "skillProgress",
  "recognitions",
  "leads",
  "messages",
  "deliveryEvents",
  "healthProfiles",
  "safeguardingCases",
  "consents",
  "documents",
  "auditEvents",
  "exports",
] as const);

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(issues: ValidationIssue[], path: Path, code: string): void {
  issues.push({ path, code });
}

function validateKnownProperties(
  value: RecordValue,
  allowed: readonly string[],
  path: Path,
  issues: ValidationIssue[],
): void {
  for (const property of Object.keys(value)) {
    if (!allowed.includes(property)) {
      addIssue(issues, [...path, property], "unexpected_property");
    }
  }
}

function validateNonEmptyText(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): string | undefined {
  if (typeof value !== "string") {
    addIssue(issues, path, "invalid_type");
    return undefined;
  }
  if (value.trim().length === 0) {
    addIssue(issues, path, "empty_value");
    return undefined;
  }
  if (value.includes("\u0000") || unsafeTextPatterns.some((pattern) => pattern.test(value))) {
    addIssue(issues, path, "unsafe_value");
    return undefined;
  }
  return value;
}

function validateMetadataText(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): string | undefined {
  const text = validateNonEmptyText(value, path, issues);
  if (text === undefined) {
    return undefined;
  }

  const isUnsafeMetadata =
    text.length > metadataTextMaxLength ||
    metadataControlPattern.test(text) ||
    metadataDumpPattern.test(text) ||
    metadataAddressPattern.test(text) ||
    metadataPostalCodePattern.test(text) ||
    metadataProperNamePattern.test(text) ||
    metadataNamedPersonPattern.test(text);
  if (isUnsafeMetadata) {
    addIssue(issues, path, "unsafe_value");
    return undefined;
  }
  return text;
}

function validateBoolean(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): boolean | undefined {
  if (typeof value !== "boolean") {
    addIssue(issues, path, "invalid_type");
    return undefined;
  }
  return value;
}

function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: Path,
  issues: ValidationIssue[],
): T | undefined {
  if (typeof value !== "string") {
    addIssue(issues, path, "invalid_type");
    return undefined;
  }
  if (!allowed.includes(value as T)) {
    addIssue(issues, path, "unknown_enum");
    return undefined;
  }
  return value as T;
}

function validateArray(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): readonly unknown[] | undefined {
  if (!Array.isArray(value)) {
    addIssue(issues, path, "invalid_type");
    return undefined;
  }
  return value;
}

function validateTextArray(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): readonly string[] | undefined {
  const items = validateArray(value, path, issues);
  if (!items) {
    return undefined;
  }

  const validated: string[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = validateNonEmptyText(items[index], [...path, index], issues);
    if (item !== undefined) {
      validated.push(item);
    }
  }
  return validated;
}

function validateMetadataTextArray(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): readonly string[] | undefined {
  const items = validateArray(value, path, issues);
  if (!items) {
    return undefined;
  }

  const validated: string[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = validateMetadataText(items[index], [...path, index], issues);
    if (item !== undefined) {
      validated.push(item);
    }
  }
  return validated;
}

function validateDiscoveryActions(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): readonly string[] | undefined {
  const actions = validateTextArray(value, path, issues);
  if (actions) {
    for (let index = 0; index < actions.length; index += 1) {
      if (mutatingDiscoveryActionPattern.test(actions[index]!)) {
        addIssue(issues, [...path, index], "mutating_discovery_action");
      }
    }
  }
  return actions;
}

function validateRoute(value: unknown, path: Path, issues: ValidationIssue[]): string | undefined {
  const route = validateNonEmptyText(value, path, issues);
  if (route === undefined) {
    return undefined;
  }

  let decodedRoute = route;
  let routeEncodingValid = true;
  for (let iteration = 0; decodedRoute.includes("%") && iteration < 8; iteration += 1) {
    try {
      const nextRoute = decodeURIComponent(decodedRoute);
      if (nextRoute === decodedRoute) {
        break;
      }
      decodedRoute = nextRoute;
    } catch {
      routeEncodingValid = false;
      break;
    }
  }

  const routeSegments = route.split("/");
  const decodedSegments = decodedRoute.split("/");
  const hasEmptyInteriorSegment = (segments: readonly string[]) =>
    segments.slice(1, -1).some((segment) => segment.length === 0);
  const hasUnsafeRouteShape =
    !routeEncodingValid ||
    decodedRoute.includes("%") ||
    !route.startsWith("/") ||
    route.startsWith("//") ||
    route.includes("?") ||
    route.includes("#") ||
    route.includes("\\") ||
    metadataControlPattern.test(route) ||
    decodedRoute.startsWith("//") ||
    decodedRoute.includes("?") ||
    decodedRoute.includes("#") ||
    decodedRoute.includes("\\") ||
    metadataControlPattern.test(decodedRoute) ||
    routeSegments.some((segment) => segment === "." || segment === "..") ||
    decodedSegments.some((segment) => segment === "." || segment === "..") ||
    hasEmptyInteriorSegment(routeSegments) ||
    hasEmptyInteriorSegment(decodedSegments);
  if (hasUnsafeRouteShape) {
    addIssue(issues, path, "unsafe_route");
    return undefined;
  }
  return route;
}

function validateUtcDateTime(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): UtcDateTime | undefined {
  if (typeof value !== "string") {
    addIssue(issues, path, "invalid_type");
    return undefined;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  const timestamp = Date.parse(value);
  if (!match || Number.isNaN(timestamp)) {
    addIssue(issues, path, "invalid_utc_datetime");
    return undefined;
  }

  const parsed = new Date(timestamp);
  const milliseconds = Number(`${match[7] ?? ""}000`.slice(0, 3));
  const matchesUtcComponents =
    parsed.getUTCFullYear() === Number(match[1]) &&
    parsed.getUTCMonth() === Number(match[2]) - 1 &&
    parsed.getUTCDate() === Number(match[3]) &&
    parsed.getUTCHours() === Number(match[4]) &&
    parsed.getUTCMinutes() === Number(match[5]) &&
    parsed.getUTCSeconds() === Number(match[6]) &&
    parsed.getUTCMilliseconds() === milliseconds;
  if (!matchesUtcComponents) {
    addIssue(issues, path, "invalid_utc_datetime");
    return undefined;
  }
  return value as UtcDateTime;
}

function parseField(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): RegyfitFieldSnapshot | undefined {
  if (!isRecord(value)) {
    addIssue(issues, path, "invalid_type");
    return undefined;
  }
  validateKnownProperties(
    value,
    ["name", "label", "dataType", "sensitivity", "required"],
    path,
    issues,
  );

  const name = validateNonEmptyText(value.name, [...path, "name"], issues);
  const label = validateNonEmptyText(value.label, [...path, "label"], issues);
  const dataType = validateEnum(value.dataType, regyfitDataTypes, [...path, "dataType"], issues);
  const sensitivity = validateEnum(
    value.sensitivity,
    regyfitSensitivities,
    [...path, "sensitivity"],
    issues,
  );
  const required = validateBoolean(value.required, [...path, "required"], issues);

  if (
    name === undefined ||
    label === undefined ||
    dataType === undefined ||
    sensitivity === undefined ||
    required === undefined
  ) {
    return undefined;
  }
  return Object.freeze({ name, label, dataType, sensitivity, required });
}

function parseModule(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): RegyfitModuleSnapshot | undefined {
  if (!isRecord(value)) {
    addIssue(issues, path, "invalid_type");
    return undefined;
  }
  validateKnownProperties(
    value,
    ["key", "label", "route", "observedRoles", "discoveryActions", "fields"],
    path,
    issues,
  );

  const key = validateNonEmptyText(value.key, [...path, "key"], issues);
  const label = validateNonEmptyText(value.label, [...path, "label"], issues);
  const route = validateRoute(value.route, [...path, "route"], issues);
  const observedRoles = validateTextArray(value.observedRoles, [...path, "observedRoles"], issues);
  const discoveryActions = validateDiscoveryActions(
    value.discoveryActions,
    [...path, "discoveryActions"],
    issues,
  );
  const fieldValues = validateArray(value.fields, [...path, "fields"], issues);
  const fields: RegyfitFieldSnapshot[] = [];
  if (fieldValues) {
    for (let index = 0; index < fieldValues.length; index += 1) {
      const field = parseField(fieldValues[index], [...path, "fields", index], issues);
      if (field) {
        fields.push(field);
      }
    }
  }

  if (
    key === undefined ||
    label === undefined ||
    route === undefined ||
    observedRoles === undefined ||
    discoveryActions === undefined ||
    fieldValues === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    key,
    label,
    route,
    observedRoles: Object.freeze([...observedRoles]),
    discoveryActions: Object.freeze([...discoveryActions]),
    fields: Object.freeze(fields),
  });
}

function validateTargetPath(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): string | undefined {
  const targetPath = validateNonEmptyText(value, path, issues);
  if (targetPath === undefined) {
    return undefined;
  }

  const segments = targetPath.split(".");
  const isSafePath =
    segments.length >= 2 &&
    !targetPath.startsWith("/") &&
    !targetPath.startsWith(".") &&
    !targetPath.includes("/") &&
    !targetPath.includes("\\") &&
    !targetPath.includes("?") &&
    !targetPath.includes("#") &&
    bptFirestoreCollectionRoots.some((root) => root === segments[0]) &&
    segments.every((segment) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(segment)) &&
    segments.every((segment) => !unsafePathSegmentPattern.test(segment)) &&
    segments.every((segment) => !reservedPrototypeSegmentPattern.test(segment));
  if (!isSafePath) {
    addIssue(issues, path, "unsafe_target_path");
    return undefined;
  }
  return targetPath;
}

function parseMapping(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): RegyfitMapping | undefined {
  if (!isRecord(value)) {
    addIssue(issues, path, "invalid_type");
    return undefined;
  }
  validateKnownProperties(
    value,
    ["sourceEntity", "sourceField", "targetPath", "strategy", "sensitivity", "reason"],
    path,
    issues,
  );

  const sourceEntity = validateEnum(
    value.sourceEntity,
    regyfitEntityNames,
    [...path, "sourceEntity"],
    issues,
  );
  const sourceField = validateNonEmptyText(value.sourceField, [...path, "sourceField"], issues);
  const targetPath = validateTargetPath(value.targetPath, [...path, "targetPath"], issues);
  const strategy = validateEnum(
    value.strategy,
    regyfitMappingStrategies,
    [...path, "strategy"],
    issues,
  );
  const sensitivity = validateEnum(
    value.sensitivity,
    regyfitSensitivities,
    [...path, "sensitivity"],
    issues,
  );
  const reason = validateMetadataText(value.reason, [...path, "reason"], issues);

  if (
    sourceField !== undefined &&
    strategy !== undefined &&
    credentialFieldPattern.test(sourceField)
  ) {
    if (strategy !== "exclude") {
      addIssue(issues, [...path, "strategy"], "credential_field_requires_exclude");
    }
  }

  if (
    sourceEntity === undefined ||
    sourceField === undefined ||
    targetPath === undefined ||
    strategy === undefined ||
    sensitivity === undefined ||
    reason === undefined
  ) {
    return undefined;
  }
  return Object.freeze({ sourceEntity, sourceField, targetPath, strategy, sensitivity, reason });
}

function parseCapabilities(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): RegyfitCapabilityMetadata | undefined {
  if (!isRecord(value)) {
    addIssue(issues, path, "invalid_type");
    return undefined;
  }
  validateKnownProperties(value, ["export", "api"], path, issues);

  const exportValue = value.export;
  const apiValue = value.api;
  if (!isRecord(exportValue)) {
    addIssue(issues, [...path, "export"], "invalid_type");
  }
  if (!isRecord(apiValue)) {
    addIssue(issues, [...path, "api"], "invalid_type");
  }
  if (!isRecord(exportValue) || !isRecord(apiValue)) {
    return undefined;
  }

  validateKnownProperties(exportValue, ["available", "formats"], [...path, "export"], issues);
  validateKnownProperties(apiValue, ["available", "documented"], [...path, "api"], issues);
  const exportAvailable = validateBoolean(
    exportValue.available,
    [...path, "export", "available"],
    issues,
  );
  const exportFormats = validateTextArray(
    exportValue.formats,
    [...path, "export", "formats"],
    issues,
  );
  const apiAvailable = validateBoolean(apiValue.available, [...path, "api", "available"], issues);
  const apiDocumented = validateBoolean(
    apiValue.documented,
    [...path, "api", "documented"],
    issues,
  );

  if (
    exportAvailable === undefined ||
    exportFormats === undefined ||
    apiAvailable === undefined ||
    apiDocumented === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    export: Object.freeze({
      available: exportAvailable,
      formats: Object.freeze([...exportFormats]),
    }),
    api: Object.freeze({ available: apiAvailable, documented: apiDocumented }),
  });
}

function parseManifest(
  value: unknown,
  path: Path,
  issues: ValidationIssue[],
): RegyfitDiscoveryManifest | undefined {
  if (!isRecord(value)) {
    addIssue(issues, path, "invalid_type");
    return undefined;
  }
  validateKnownProperties(
    value,
    [
      "schemaVersion",
      "sourceSystem",
      "capturedAtUtc",
      "capabilities",
      "modules",
      "mappings",
      "notes",
    ],
    path,
    issues,
  );

  const schemaVersion = validateEnum(
    value.schemaVersion,
    ["1"] as const,
    [...path, "schemaVersion"],
    issues,
  );
  const sourceSystem = validateEnum(
    value.sourceSystem,
    ["regyfit"] as const,
    [...path, "sourceSystem"],
    issues,
  );
  const capturedAtUtc = validateUtcDateTime(
    value.capturedAtUtc,
    [...path, "capturedAtUtc"],
    issues,
  );
  const capabilities = parseCapabilities(value.capabilities, [...path, "capabilities"], issues);
  const moduleValues = validateArray(value.modules, [...path, "modules"], issues);
  const notes = validateMetadataTextArray(value.notes, [...path, "notes"], issues);

  const modules: RegyfitModuleSnapshot[] = [];
  const moduleKeys = new Set<string>();
  if (moduleValues) {
    for (let index = 0; index < moduleValues.length; index += 1) {
      const moduleSnapshot = parseModule(moduleValues[index], [...path, "modules", index], issues);
      if (moduleSnapshot) {
        const key = moduleSnapshot.key.trim().toLowerCase();
        if (moduleKeys.has(key)) {
          addIssue(issues, [...path, "modules", index, "key"], "duplicate_module_key");
        } else {
          moduleKeys.add(key);
        }
        modules.push(moduleSnapshot);
      }
    }
  }

  const mappings: RegyfitMapping[] = [];
  const mappingKeys = new Set<string>();
  let mappingValues: readonly unknown[] | undefined;
  if (Object.prototype.hasOwnProperty.call(value, "mappings")) {
    mappingValues = validateArray(value.mappings, [...path, "mappings"], issues);
    if (mappingValues) {
      for (let index = 0; index < mappingValues.length; index += 1) {
        const mapping = parseMapping(mappingValues[index], [...path, "mappings", index], issues);
        if (mapping) {
          const sourcePair = `${mapping.sourceEntity.trim().toLowerCase()}\u0000${mapping.sourceField.trim().toLowerCase()}`;
          if (mappingKeys.has(sourcePair)) {
            addIssue(issues, [...path, "mappings", index], "duplicate_source_mapping");
          } else {
            mappingKeys.add(sourcePair);
          }
          mappings.push(mapping);
        }
      }
    }
  }

  if (
    schemaVersion === undefined ||
    sourceSystem === undefined ||
    capturedAtUtc === undefined ||
    capabilities === undefined ||
    moduleValues === undefined ||
    notes === undefined ||
    (Object.prototype.hasOwnProperty.call(value, "mappings") && mappingValues === undefined)
  ) {
    return undefined;
  }

  const base = {
    schemaVersion,
    sourceSystem,
    capturedAtUtc,
    capabilities,
    modules: Object.freeze(modules),
    notes: Object.freeze([...notes]),
  } as const;
  if (Object.prototype.hasOwnProperty.call(value, "mappings")) {
    return Object.freeze({ ...base, mappings: Object.freeze(mappings) });
  }
  return Object.freeze(base);
}

export function validateRegyfitDiscoveryManifest(
  manifest: unknown,
): Result<RegyfitDiscoveryManifest, ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const parsed = parseManifest(manifest, [], issues);
  return issues.length > 0 || parsed === undefined ? err(issues) : ok(parsed);
}

export function validateRegyfitMapping(
  mapping: unknown,
): Result<RegyfitMapping, ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const parsed = parseMapping(mapping, [], issues);
  return issues.length > 0 || parsed === undefined ? err(issues) : ok(parsed);
}
