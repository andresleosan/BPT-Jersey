import { createHmac, timingSafeEqual } from "node:crypto";

import { normalizeAdministrativeIdentifier } from "@bpt-jersey/domain/members/directory";
import { z } from "zod";

export const studentIdentityKeyKinds = Object.freeze([
  "membership-number",
  "id-card-number",
  "vat-number",
  "legacy-member-id",
  "auth-user-id",
] as const);

export type StudentIdentityKeyKind = (typeof studentIdentityKeyKinds)[number];

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const administrativeIdentifierPattern = /^[A-Z0-9][A-Z0-9 ./-]{0,63}$/u;
const strictBase64UrlPattern = /^[A-Za-z0-9_-]+$/u;
const lowercaseMacPattern = /^[a-f0-9]{64}$/u;
const utcMillisecondPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export const studentIdentityKeySchema = z.strictObject({
  keyId: z
    .string()
    .regex(
      /^(?:membership-number|id-card-number|vat-number|legacy-member-id|auth-user-id):[a-f0-9]{64}$/u,
    ),
  academyId: z.string().regex(safeIdentifierPattern),
  kind: z.enum(studentIdentityKeyKinds),
  digestVersion: z.literal("hmac-sha256-v1"),
  secretVersion: z.string().regex(safeIdentifierPattern),
  ownerStudentId: z.string().regex(safeIdentifierPattern),
  schemaVersion: z.literal("1"),
  createdAt: z.string().regex(utcMillisecondPattern),
  createdBy: z.string().regex(safeIdentifierPattern),
  updatedAt: z.string().regex(utcMillisecondPattern),
  updatedBy: z.string().regex(safeIdentifierPattern),
});

export type StudentIdentityKey = Readonly<z.infer<typeof studentIdentityKeySchema>>;

export type BuildStudentIdentityKeyInput = Readonly<{
  academyId: string;
  kind: StudentIdentityKeyKind;
  value: string;
  ownerStudentId: string;
  secretMaterial: string;
  secretVersion: string;
  now: string;
  actorId: string;
}>;

export type DeriveStudentIdentityKeyIdInput = Readonly<{
  academyId: string;
  kind: StudentIdentityKeyKind;
  value: string;
  secretMaterial: string;
}>;

function requiredSafeIdentifier(value: string, label: string): string {
  if (!safeIdentifierPattern.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function requiredTimestamp(value: string): string {
  if (!utcMillisecondPattern.test(value)) throw new Error("Invalid timestamp");
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error("Invalid timestamp");
  }
  return value;
}

export function decodeMemberDirectorySecret(material: string, label: string): Buffer {
  if (!strictBase64UrlPattern.test(material) || material.includes("=")) {
    throw new Error(`Invalid ${label} secret`);
  }
  const decoded = Buffer.from(material, "base64url");
  if (decoded.length < 32 || decoded.length > 64 || decoded.toString("base64url") !== material) {
    throw new Error(`Invalid ${label} secret length or encoding`);
  }
  return decoded;
}

export function assertDistinctMemberDirectorySecrets(
  input: Readonly<{
    identity: string;
    integrity: string;
    cursor: string;
  }>,
): void {
  const decoded = [
    decodeMemberDirectorySecret(input.identity, "identity"),
    decodeMemberDirectorySecret(input.integrity, "integrity"),
    decodeMemberDirectorySecret(input.cursor, "cursor"),
  ];
  for (let left = 0; left < decoded.length; left += 1) {
    for (let right = left + 1; right < decoded.length; right += 1) {
      const leftSecret = decoded[left];
      const rightSecret = decoded[right];
      if (
        leftSecret !== undefined &&
        rightSecret !== undefined &&
        leftSecret.length === rightSecret.length &&
        timingSafeEqual(leftSecret, rightSecret)
      ) {
        throw new Error("Member directory purpose secrets must be distinct");
      }
    }
  }
}

export function encodeLengthPrefixedUtf8(segments: readonly string[]): Buffer {
  const chunks: Buffer[] = [];
  for (const segment of segments) {
    const encoded = Buffer.from(segment, "utf8");
    if (encoded.length > 0xffff_ffff) throw new Error("Encoded segment is too large");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(encoded.length, 0);
    chunks.push(length, encoded);
  }
  return Buffer.concat(chunks);
}

function canonicalValue(value: unknown, depth: number): string {
  if (depth > 32) throw new Error("Invalid canonical value depth");
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Invalid canonical number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes("length")) {
      throw new Error("Invalid canonical array");
    }
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new Error("Invalid canonical sparse array");
      items.push(canonicalValue(value[index], depth + 1));
    }
    return `[${items.join(",")}]`;
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("Invalid canonical object");
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (keys.some((key) => typeof key !== "string")) {
    throw new Error("Invalid canonical object key");
  }
  const entries = (keys as string[]).sort().map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.hasOwn(descriptor, "value")
    ) {
      throw new Error("Invalid canonical object property");
    }
    return `${JSON.stringify(key)}:${canonicalValue(descriptor.value, depth + 1)}`;
  });
  return `{${entries.join(",")}}`;
}

export function canonicalizeMemberDirectoryValue(value: unknown): string {
  return canonicalValue(value, 0);
}

export function createMemberDirectoryIntegrityMac(
  input: Readonly<{
    domain: string;
    values: readonly string[];
    secretMaterial: string;
  }>,
): string {
  if (
    input.domain.length === 0 ||
    input.domain.length > 128 ||
    input.domain !== input.domain.trim() ||
    /[\u0000-\u001f\u007f]/u.test(input.domain)
  ) {
    throw new Error("Invalid integrity MAC domain");
  }
  const secret = decodeMemberDirectorySecret(input.secretMaterial, "integrity");
  return createHmac("sha256", secret)
    .update(encodeLengthPrefixedUtf8([input.domain, ...input.values]))
    .digest("hex");
}

function normalizedIdentityValue(kind: StudentIdentityKeyKind, value: string): string {
  if (kind === "auth-user-id") return requiredSafeIdentifier(value, "Auth user ID");
  const normalized = normalizeAdministrativeIdentifier(value);
  if (!administrativeIdentifierPattern.test(normalized)) {
    throw new Error("Invalid administrative identifier");
  }
  return normalized;
}

export function deriveStudentIdentityKeyId(input: DeriveStudentIdentityKeyIdInput): string {
  const academyId = requiredSafeIdentifier(input.academyId, "academy ID");
  const value = normalizedIdentityValue(input.kind, input.value);
  const secret = decodeMemberDirectorySecret(input.secretMaterial, "identity");
  const digest = createHmac("sha256", secret)
    .update(encodeLengthPrefixedUtf8(["bpt-student-identity-v1", academyId, input.kind, value]))
    .digest("hex");
  return `${input.kind}:${digest}`;
}

export function buildStudentIdentityKey(input: BuildStudentIdentityKeyInput): StudentIdentityKey {
  const academyId = requiredSafeIdentifier(input.academyId, "academy ID");
  const ownerStudentId = requiredSafeIdentifier(input.ownerStudentId, "student ID");
  const secretVersion = requiredSafeIdentifier(input.secretVersion, "secret version");
  const actorId = requiredSafeIdentifier(input.actorId, "actor ID");
  const now = requiredTimestamp(input.now);
  const keyId = deriveStudentIdentityKeyId(input);
  const record = {
    keyId,
    academyId,
    kind: input.kind,
    digestVersion: "hmac-sha256-v1" as const,
    secretVersion,
    ownerStudentId,
    schemaVersion: "1" as const,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  };
  const parsed = studentIdentityKeySchema.safeParse(record);
  if (!parsed.success) throw new Error("Invalid student identity key record");
  return Object.freeze(parsed.data);
}

export function constantTimeMacEquals(left: string, right: string): boolean {
  if (!lowercaseMacPattern.test(left) || !lowercaseMacPattern.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
