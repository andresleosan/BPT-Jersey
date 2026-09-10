import { Buffer } from "node:buffer";

import { canonicalizeMemberDirectoryValue } from "../members/member-directory-crypto.js";

export const BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION = "firestore-value-v1" as const;

const mebibyte = 1_024 * 1_024;
const int64Minimum = -(1n << 63n);
const int64Maximum = (1n << 63n) - 1n;
const firestoreTimestampMinimumSeconds = -62_135_596_800n;
const firestoreTimestampMaximumSeconds = 253_402_300_799n;
const canonicalIntegerPattern = /^(?:0|-[1-9]\d*|[1-9]\d*)$/u;
const canonicalFiniteDoublePattern = /^finite:[a-f0-9]{16}$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;
const rfc3339TimestampPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/u;

export type BackupV3FirestoreValueCodecErrorCode =
  | "ambiguous-value"
  | "cyclic-value"
  | "depth-limit"
  | "invalid-canonical-value"
  | "invalid-geo-point"
  | "invalid-integer"
  | "invalid-reference"
  | "invalid-timestamp"
  | "size-limit"
  | "unsupported-value";

export class BackupV3FirestoreValueCodecError extends Error {
  readonly code: BackupV3FirestoreValueCodecErrorCode;

  constructor(code: BackupV3FirestoreValueCodecErrorCode, message: string) {
    super(message);
    this.name = "BackupV3FirestoreValueCodecError";
    this.code = code;
  }
}

export type BackupV3CanonicalFirestoreDouble =
  `finite:${string}` | "negative-zero" | "nan" | "positive-infinity" | "negative-infinity";

export type BackupV3CanonicalFirestoreValue =
  | Readonly<{ type: "null" }>
  | Readonly<{ type: "boolean"; value: boolean }>
  | Readonly<{ type: "integer"; value: string }>
  | Readonly<{ type: "double"; value: BackupV3CanonicalFirestoreDouble }>
  | Readonly<{ type: "timestamp"; seconds: string; nanos: number }>
  | Readonly<{ type: "string"; value: string }>
  | Readonly<{ type: "bytes"; value: string }>
  | Readonly<{ type: "reference"; value: string }>
  | Readonly<{
      type: "geo-point";
      latitude: BackupV3CanonicalFirestoreDouble;
      longitude: BackupV3CanonicalFirestoreDouble;
    }>
  | Readonly<{ type: "array"; values: readonly BackupV3CanonicalFirestoreValue[] }>
  | Readonly<{
      type: "map";
      fields: Readonly<Record<string, BackupV3CanonicalFirestoreValue>>;
    }>;

export type BackupV3CanonicalFirestoreDocument = Readonly<{
  codecVersion: typeof BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION;
  fields: Readonly<Record<string, BackupV3CanonicalFirestoreValue>>;
}>;

export type BackupV3FirestoreValueCodecLimits = Readonly<{
  maxDepth: number;
  maxValueCount: number;
  maxStringBytes: number;
  maxBytesLength: number;
  maxCanonicalDocumentBytes: number;
}>;

type CodecBinding = Readonly<{
  database: string;
  limits?: Partial<BackupV3FirestoreValueCodecLimits>;
}>;

const defaultLimits: BackupV3FirestoreValueCodecLimits = Object.freeze({
  maxDepth: 20,
  maxValueCount: 40_000,
  maxStringBytes: mebibyte - 89,
  maxBytesLength: mebibyte - 89,
  maxCanonicalDocumentBytes: 4 * mebibyte,
});

const firestoreValueVariants = Object.freeze([
  "nullValue",
  "booleanValue",
  "integerValue",
  "doubleValue",
  "timestampValue",
  "stringValue",
  "bytesValue",
  "referenceValue",
  "geoPointValue",
  "arrayValue",
  "mapValue",
] as const);

function codecError(code: BackupV3FirestoreValueCodecErrorCode, message: string): never {
  throw new BackupV3FirestoreValueCodecError(code, message);
}

function record(
  value: unknown,
  code: BackupV3FirestoreValueCodecErrorCode,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return codecError(code, "Firestore value must be an object");
  }
  return value as Record<string, unknown>;
}

function dataEntries(
  value: unknown,
  code: BackupV3FirestoreValueCodecErrorCode,
): readonly (readonly [string, unknown])[] {
  const source = record(value, code);
  const entries: [string, unknown][] = [];
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key !== "string") return codecError(code, "Symbol keys are unsupported");
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      return codecError(code, "Accessor or hidden properties are unsupported");
    }
    entries.push([key, descriptor.value]);
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return entries;
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
  code: BackupV3FirestoreValueCodecErrorCode,
): Record<string, unknown> {
  const source = record(value, code);
  const actual = dataEntries(source, code).map(([key]) => key);
  const expected = [...keys].sort((left, right) => left.localeCompare(right));
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return codecError(code, "Canonical Firestore value has an unexpected shape");
  }
  return source;
}

function limits(binding: CodecBinding): BackupV3FirestoreValueCodecLimits {
  const result = Object.freeze({ ...defaultLimits, ...binding.limits });
  for (const value of Object.values(result)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      return codecError("size-limit", "Firestore codec limit is invalid");
    }
  }
  return result;
}

function assertDatabase(database: string): void {
  if (
    !/^projects\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\/databases\/\(default\)\/documents$/u.test(
      database,
    )
  ) {
    codecError("invalid-reference", "Firestore database binding is invalid");
  }
}

function canonicalInt64(value: unknown, code: "invalid-integer" | "invalid-timestamp"): string {
  let text: string;
  if (typeof value === "string") text = value;
  else if (typeof value === "bigint") text = value.toString();
  else if (typeof value === "number" && Number.isSafeInteger(value)) text = String(value);
  else if (typeof value === "object" && value !== null && typeof value.toString === "function") {
    try {
      text = value.toString();
    } catch {
      return codecError(code, "Firestore integer cannot be represented exactly");
    }
  } else {
    return codecError(code, "Firestore integer cannot be represented exactly");
  }
  if (!canonicalIntegerPattern.test(text)) {
    return codecError(code, "Firestore integer is not canonical decimal");
  }
  const integer = BigInt(text);
  if (integer < int64Minimum || integer > int64Maximum) {
    return codecError(code, "Firestore integer is outside int64");
  }
  return text;
}

function doubleBits(value: number): string {
  const bytes = Buffer.allocUnsafe(8);
  bytes.writeDoubleBE(value, 0);
  return bytes.toString("hex");
}

function canonicalDouble(value: unknown): BackupV3CanonicalFirestoreDouble {
  if (value === "NaN") return "nan";
  if (value === "Infinity") return "positive-infinity";
  if (value === "-Infinity") return "negative-infinity";
  if (typeof value !== "number") {
    return codecError("unsupported-value", "Firestore double is invalid");
  }
  if (Number.isNaN(value)) return "nan";
  if (value === Number.POSITIVE_INFINITY) return "positive-infinity";
  if (value === Number.NEGATIVE_INFINITY) return "negative-infinity";
  if (Object.is(value, -0)) return "negative-zero";
  return `finite:${doubleBits(value)}`;
}

function decodedDouble(value: unknown): number {
  if (value === "negative-zero") return -0;
  if (value === "nan") return Number.NaN;
  if (value === "positive-infinity") return Number.POSITIVE_INFINITY;
  if (value === "negative-infinity") return Number.NEGATIVE_INFINITY;
  if (typeof value !== "string" || !canonicalFiniteDoublePattern.test(value)) {
    return codecError("invalid-canonical-value", "Canonical Firestore double is invalid");
  }
  const decoded = Buffer.from(value.slice("finite:".length), "hex").readDoubleBE(0);
  if (!Number.isFinite(decoded) || Object.is(decoded, -0)) {
    return codecError("invalid-canonical-value", "Canonical Firestore double tag is ambiguous");
  }
  return decoded;
}

function timestampParts(value: unknown): Readonly<{ seconds: string; nanos: number }> {
  let seconds: string;
  let nanos: number;
  if (typeof value === "string") {
    const match = rfc3339TimestampPattern.exec(value);
    if (match === null) return codecError("invalid-timestamp", "Timestamp is not RFC3339 UTC");
    const base = `${match[1]}.000Z`;
    const millis = Date.parse(base);
    if (Number.isNaN(millis) || new Date(millis).toISOString().slice(0, 19) !== match[1]) {
      return codecError("invalid-timestamp", "Timestamp calendar value is invalid");
    }
    seconds = String(Math.floor(millis / 1_000));
    nanos = Number((match[2] ?? "").padEnd(9, "0"));
  } else {
    const source = record(value, "invalid-timestamp");
    const keys = dataEntries(source, "invalid-timestamp").map(([key]) => key);
    if (keys.some((key) => key !== "seconds" && key !== "nanos")) {
      return codecError("invalid-timestamp", "Timestamp contains unknown fields");
    }
    seconds = canonicalInt64(source["seconds"] ?? 0, "invalid-timestamp");
    nanos = source["nanos"] === undefined ? 0 : Number(source["nanos"]);
  }
  const secondValue = BigInt(seconds);
  if (
    secondValue < firestoreTimestampMinimumSeconds ||
    secondValue > firestoreTimestampMaximumSeconds ||
    !Number.isInteger(nanos) ||
    nanos < 0 ||
    nanos > 999_999_999
  ) {
    return codecError("invalid-timestamp", "Timestamp is outside the Firestore range");
  }
  return Object.freeze({ seconds, nanos });
}

function assertFieldName(name: string): void {
  if (Buffer.byteLength(name, "utf8") > 1_500 || controlCharacterPattern.test(name)) {
    codecError("size-limit", "Firestore field name exceeds the codec limit");
  }
}

function canonicalReference(value: unknown, database: string): string {
  if (typeof value !== "string" || !value.startsWith(`${database}/`) || value.length > 6_144) {
    return codecError("invalid-reference", "Firestore reference crosses its database binding");
  }
  const relative = value.slice(database.length + 1);
  const segments = relative.split("/");
  if (
    relative.length === 0 ||
    relative !== relative.trim() ||
    controlCharacterPattern.test(relative) ||
    segments.length % 2 !== 0 ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    return codecError("invalid-reference", "Firestore reference path is invalid");
  }
  return value;
}

function sourceBytes(value: unknown, maximum: number): string {
  let bytes: Buffer;
  if (typeof value === "string") {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
      return codecError("unsupported-value", "Firestore bytes are not canonical base64");
    }
    bytes = Buffer.from(value, "base64");
    if (bytes.toString("base64") !== value) {
      return codecError("unsupported-value", "Firestore bytes are not canonical base64");
    }
  } else if (value instanceof Uint8Array) {
    bytes = Buffer.from(value);
  } else {
    return codecError("unsupported-value", "Firestore bytes are invalid");
  }
  if (bytes.length > maximum) return codecError("size-limit", "Firestore bytes exceed the limit");
  return bytes.toString("base64url");
}

function sourceArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) return codecError("unsupported-value", "Firestore array is invalid");
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string") ||
    keys.length !== value.length + 1 ||
    !keys.includes("length")
  ) {
    return codecError("unsupported-value", "Sparse or decorated arrays are unsupported");
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      return codecError("unsupported-value", "Sparse arrays are unsupported");
    }
  }
  return value;
}

function sourceFields(value: unknown): Record<string, unknown> {
  return record(value ?? {}, "unsupported-value");
}

function vectorMarker(fields: Record<string, unknown>): boolean {
  const marker = fields["__type__"];
  if (typeof marker !== "object" || marker === null || Array.isArray(marker)) return false;
  return (marker as Record<string, unknown>)["stringValue"] === "__vector__";
}

type Traversal = {
  readonly binding: CodecBinding;
  readonly limits: BackupV3FirestoreValueCodecLimits;
  readonly active: WeakSet<object>;
  valueCount: number;
};

function enterObject(value: object, traversal: Traversal): void {
  if (traversal.active.has(value)) return codecError("cyclic-value", "Firestore value is cyclic");
  traversal.active.add(value);
}

function leaveObject(value: object, traversal: Traversal): void {
  traversal.active.delete(value);
}

function encodeFields(
  fieldsValue: unknown,
  traversal: Traversal,
  depth: number,
): Readonly<Record<string, BackupV3CanonicalFirestoreValue>> {
  const fields = sourceFields(fieldsValue);
  enterObject(fields, traversal);
  try {
    const encoded: Record<string, BackupV3CanonicalFirestoreValue> = {};
    for (const [name, value] of dataEntries(fields, "unsupported-value")) {
      assertFieldName(name);
      encoded[name] = encodeValue(value, traversal, depth);
    }
    return Object.freeze(encoded);
  } finally {
    leaveObject(fields, traversal);
  }
}

function encodeValue(
  value: unknown,
  traversal: Traversal,
  depth: number,
): BackupV3CanonicalFirestoreValue {
  if (depth > traversal.limits.maxDepth) {
    return codecError("depth-limit", "Firestore value exceeds the nesting limit");
  }
  traversal.valueCount += 1;
  if (traversal.valueCount > traversal.limits.maxValueCount) {
    return codecError("size-limit", "Firestore value count exceeds the limit");
  }
  const source = record(value, "unsupported-value");
  enterObject(source, traversal);
  try {
    const entries = dataEntries(source, "unsupported-value");
    const variants = firestoreValueVariants.filter((key) => Object.hasOwn(source, key));
    if (variants.length > 1) {
      return codecError("ambiguous-value", "Firestore Value contains multiple variants");
    }
    if (variants.length === 0 || entries.some(([key]) => key !== variants[0])) {
      return codecError("unsupported-value", "Firestore Value variant is unknown");
    }
    const variant = variants[0]!;
    const raw = source[variant];
    if (variant === "nullValue") {
      if (raw !== 0 && raw !== "NULL_VALUE") {
        return codecError("unsupported-value", "Firestore null is invalid");
      }
      return Object.freeze({ type: "null" });
    }
    if (variant === "booleanValue") {
      if (typeof raw !== "boolean") {
        return codecError("unsupported-value", "Firestore boolean is invalid");
      }
      return Object.freeze({ type: "boolean", value: raw });
    }
    if (variant === "integerValue") {
      return Object.freeze({ type: "integer", value: canonicalInt64(raw, "invalid-integer") });
    }
    if (variant === "doubleValue") {
      return Object.freeze({ type: "double", value: canonicalDouble(raw) });
    }
    if (variant === "timestampValue") {
      return Object.freeze({ type: "timestamp", ...timestampParts(raw) });
    }
    if (variant === "stringValue") {
      if (typeof raw !== "string") {
        return codecError("unsupported-value", "Firestore string is invalid");
      }
      if (Buffer.byteLength(raw, "utf8") > traversal.limits.maxStringBytes) {
        return codecError("size-limit", "Firestore string exceeds the limit");
      }
      return Object.freeze({ type: "string", value: raw });
    }
    if (variant === "bytesValue") {
      return Object.freeze({
        type: "bytes",
        value: sourceBytes(raw, traversal.limits.maxBytesLength),
      });
    }
    if (variant === "referenceValue") {
      return Object.freeze({
        type: "reference",
        value: canonicalReference(raw, traversal.binding.database),
      });
    }
    if (variant === "geoPointValue") {
      const point = record(raw, "invalid-geo-point");
      const keys = dataEntries(point, "invalid-geo-point").map(([key]) => key);
      if (keys.some((key) => key !== "latitude" && key !== "longitude")) {
        return codecError("invalid-geo-point", "GeoPoint contains unknown fields");
      }
      const latitude = canonicalDouble(point["latitude"] ?? 0);
      const longitude = canonicalDouble(point["longitude"] ?? 0);
      const decodedLatitude = decodedDouble(latitude);
      const decodedLongitude = decodedDouble(longitude);
      if (
        !Number.isFinite(decodedLatitude) ||
        !Number.isFinite(decodedLongitude) ||
        decodedLatitude < -90 ||
        decodedLatitude > 90 ||
        decodedLongitude < -180 ||
        decodedLongitude > 180
      ) {
        return codecError("invalid-geo-point", "GeoPoint is outside the Firestore range");
      }
      return Object.freeze({ type: "geo-point", latitude, longitude });
    }
    if (variant === "arrayValue") {
      const container = record(raw, "unsupported-value");
      const keys = dataEntries(container, "unsupported-value").map(([key]) => key);
      if (keys.some((key) => key !== "values")) {
        return codecError("unsupported-value", "Firestore array contains unknown fields");
      }
      const values = sourceArray(container["values"] ?? []);
      enterObject(values, traversal);
      try {
        const encoded = values.map((item) => encodeValue(item, traversal, depth + 1));
        if (encoded.some((item) => item.type === "array")) {
          return codecError("unsupported-value", "Firestore arrays cannot directly nest arrays");
        }
        return Object.freeze({ type: "array", values: Object.freeze(encoded) });
      } finally {
        leaveObject(values, traversal);
      }
    }
    const container = record(raw, "unsupported-value");
    const keys = dataEntries(container, "unsupported-value").map(([key]) => key);
    if (keys.some((key) => key !== "fields")) {
      return codecError("unsupported-value", "Firestore map contains unknown fields");
    }
    const fields = sourceFields(container["fields"] ?? {});
    if (vectorMarker(fields)) {
      return codecError("unsupported-value", "Firestore vectors are outside backup v3");
    }
    return Object.freeze({ type: "map", fields: encodeFields(fields, traversal, depth + 1) });
  } finally {
    leaveObject(source, traversal);
  }
}

function canonicalFields(
  fieldsValue: unknown,
  traversal: Traversal,
  depth: number,
): Readonly<Record<string, BackupV3CanonicalFirestoreValue>> {
  const fields = record(fieldsValue, "invalid-canonical-value");
  enterObject(fields, traversal);
  try {
    const parsed: Record<string, BackupV3CanonicalFirestoreValue> = {};
    for (const [name, value] of dataEntries(fields, "invalid-canonical-value")) {
      assertFieldName(name);
      parsed[name] = canonicalValue(value, traversal, depth);
    }
    return Object.freeze(parsed);
  } finally {
    leaveObject(fields, traversal);
  }
}

function canonicalValue(
  value: unknown,
  traversal: Traversal,
  depth: number,
): BackupV3CanonicalFirestoreValue {
  if (depth > traversal.limits.maxDepth) {
    return codecError("depth-limit", "Canonical Firestore value exceeds the nesting limit");
  }
  traversal.valueCount += 1;
  if (traversal.valueCount > traversal.limits.maxValueCount) {
    return codecError("size-limit", "Canonical Firestore value count exceeds the limit");
  }
  const source = record(value, "invalid-canonical-value");
  enterObject(source, traversal);
  try {
    const type = source["type"];
    if (type === "null") {
      exactKeys(source, ["type"], "invalid-canonical-value");
      return Object.freeze({ type });
    }
    if (type === "boolean") {
      exactKeys(source, ["type", "value"], "invalid-canonical-value");
      if (typeof source["value"] !== "boolean") {
        return codecError("invalid-canonical-value", "Canonical boolean is invalid");
      }
      return Object.freeze({ type, value: source["value"] });
    }
    if (type === "integer") {
      exactKeys(source, ["type", "value"], "invalid-canonical-value");
      let integer: string;
      try {
        integer = canonicalInt64(source["value"], "invalid-integer");
      } catch {
        return codecError("invalid-canonical-value", "Canonical integer is invalid");
      }
      return Object.freeze({ type, value: integer });
    }
    if (type === "double") {
      exactKeys(source, ["type", "value"], "invalid-canonical-value");
      decodedDouble(source["value"]);
      return Object.freeze({ type, value: source["value"] as BackupV3CanonicalFirestoreDouble });
    }
    if (type === "timestamp") {
      exactKeys(source, ["type", "seconds", "nanos"], "invalid-canonical-value");
      let parts: Readonly<{ seconds: string; nanos: number }>;
      try {
        parts = timestampParts({ seconds: source["seconds"], nanos: source["nanos"] });
      } catch {
        return codecError("invalid-canonical-value", "Canonical timestamp is invalid");
      }
      return Object.freeze({ type, ...parts });
    }
    if (type === "string") {
      exactKeys(source, ["type", "value"], "invalid-canonical-value");
      if (
        typeof source["value"] !== "string" ||
        Buffer.byteLength(source["value"], "utf8") > traversal.limits.maxStringBytes
      ) {
        return codecError("invalid-canonical-value", "Canonical string is invalid");
      }
      return Object.freeze({ type, value: source["value"] });
    }
    if (type === "bytes") {
      exactKeys(source, ["type", "value"], "invalid-canonical-value");
      if (typeof source["value"] !== "string" || !/^[A-Za-z0-9_-]*$/u.test(source["value"])) {
        return codecError("invalid-canonical-value", "Canonical bytes are invalid");
      }
      const bytes = Buffer.from(source["value"], "base64url");
      if (
        bytes.toString("base64url") !== source["value"] ||
        bytes.length > traversal.limits.maxBytesLength
      ) {
        return codecError("invalid-canonical-value", "Canonical bytes are invalid");
      }
      return Object.freeze({ type, value: source["value"] });
    }
    if (type === "reference") {
      exactKeys(source, ["type", "value"], "invalid-canonical-value");
      let reference: string;
      try {
        reference = canonicalReference(source["value"], traversal.binding.database);
      } catch {
        return codecError("invalid-canonical-value", "Canonical reference is invalid");
      }
      return Object.freeze({ type, value: reference });
    }
    if (type === "geo-point") {
      exactKeys(source, ["type", "latitude", "longitude"], "invalid-canonical-value");
      const latitude = source["latitude"];
      const longitude = source["longitude"];
      const decodedLatitude = decodedDouble(latitude);
      const decodedLongitude = decodedDouble(longitude);
      if (
        !Number.isFinite(decodedLatitude) ||
        !Number.isFinite(decodedLongitude) ||
        decodedLatitude < -90 ||
        decodedLatitude > 90 ||
        decodedLongitude < -180 ||
        decodedLongitude > 180
      ) {
        return codecError("invalid-canonical-value", "Canonical GeoPoint is invalid");
      }
      return Object.freeze({
        type,
        latitude: latitude as BackupV3CanonicalFirestoreDouble,
        longitude: longitude as BackupV3CanonicalFirestoreDouble,
      });
    }
    if (type === "array") {
      exactKeys(source, ["type", "values"], "invalid-canonical-value");
      const values = sourceArray(source["values"]);
      enterObject(values, traversal);
      try {
        const parsed = values.map((item) => canonicalValue(item, traversal, depth + 1));
        if (parsed.some((item) => item.type === "array")) {
          return codecError("invalid-canonical-value", "Canonical arrays cannot nest arrays");
        }
        return Object.freeze({ type, values: Object.freeze(parsed) });
      } finally {
        leaveObject(values, traversal);
      }
    }
    if (type === "map") {
      exactKeys(source, ["type", "fields"], "invalid-canonical-value");
      const fields = canonicalFields(source["fields"], traversal, depth + 1);
      if (fields["__type__"]?.type === "string" && fields["__type__"].value === "__vector__") {
        return codecError("invalid-canonical-value", "Canonical vectors are unsupported");
      }
      return Object.freeze({ type, fields });
    }
    return codecError("invalid-canonical-value", "Canonical Firestore value type is unknown");
  } finally {
    leaveObject(source, traversal);
  }
}

function traversal(binding: CodecBinding): Traversal {
  assertDatabase(binding.database);
  return {
    binding,
    limits: limits(binding),
    active: new WeakSet<object>(),
    valueCount: 0,
  };
}

function assertDocumentSize(document: BackupV3CanonicalFirestoreDocument, maximum: number): void {
  if (Buffer.byteLength(canonicalizeMemberDirectoryValue(document), "utf8") > maximum) {
    codecError("size-limit", "Canonical Firestore document exceeds the codec limit");
  }
}

export function encodeBackupV3FirestoreDocument(
  fields: unknown,
  binding: CodecBinding,
): BackupV3CanonicalFirestoreDocument {
  const state = traversal(binding);
  const document = Object.freeze({
    codecVersion: BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION,
    fields: encodeFields(fields, state, 1),
  });
  assertDocumentSize(document, state.limits.maxCanonicalDocumentBytes);
  return document;
}

export function parseBackupV3FirestoreDocument(
  value: unknown,
  binding: CodecBinding,
): BackupV3CanonicalFirestoreDocument {
  const state = traversal(binding);
  const source = exactKeys(value, ["codecVersion", "fields"], "invalid-canonical-value");
  if (source["codecVersion"] !== BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION) {
    return codecError("invalid-canonical-value", "Firestore codec version is unsupported");
  }
  const document = Object.freeze({
    codecVersion: BACKUP_V3_FIRESTORE_VALUE_CODEC_VERSION,
    fields: canonicalFields(source["fields"], state, 1),
  });
  assertDocumentSize(document, state.limits.maxCanonicalDocumentBytes);
  return document;
}

function decodeValue(value: BackupV3CanonicalFirestoreValue): Readonly<Record<string, unknown>> {
  if (value.type === "null") return Object.freeze({ nullValue: "NULL_VALUE" });
  if (value.type === "boolean") return Object.freeze({ booleanValue: value.value });
  if (value.type === "integer") return Object.freeze({ integerValue: value.value });
  if (value.type === "double") return Object.freeze({ doubleValue: decodedDouble(value.value) });
  if (value.type === "timestamp") {
    return Object.freeze({
      timestampValue: Object.freeze({ seconds: value.seconds, nanos: value.nanos }),
    });
  }
  if (value.type === "string") return Object.freeze({ stringValue: value.value });
  if (value.type === "bytes") {
    return Object.freeze({ bytesValue: Uint8Array.from(Buffer.from(value.value, "base64url")) });
  }
  if (value.type === "reference") return Object.freeze({ referenceValue: value.value });
  if (value.type === "geo-point") {
    return Object.freeze({
      geoPointValue: Object.freeze({
        latitude: decodedDouble(value.latitude),
        longitude: decodedDouble(value.longitude),
      }),
    });
  }
  if (value.type === "array") {
    return Object.freeze({
      arrayValue: Object.freeze({ values: Object.freeze(value.values.map(decodeValue)) }),
    });
  }
  return Object.freeze({
    mapValue: Object.freeze({
      fields: Object.freeze(
        Object.fromEntries(
          Object.entries(value.fields).map(([name, child]) => [name, decodeValue(child)]),
        ),
      ),
    }),
  });
}

export function decodeBackupV3FirestoreDocument(
  document: unknown,
  binding: CodecBinding,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
  const parsed = parseBackupV3FirestoreDocument(document, binding);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(parsed.fields).map(([name, value]) => [name, decodeValue(value)]),
    ),
  );
}

export function canonicalizeBackupV3FirestoreDocument(
  document: unknown,
  binding: CodecBinding,
): string {
  return canonicalizeMemberDirectoryValue(parseBackupV3FirestoreDocument(document, binding));
}
