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
    /**
     * The artifact-encryption secret, when the caller holds it. It is a fourth purpose - it seals
     * the frozen manifest, plan and baseline - and reusing the integrity key to encrypt what that
     * key also authenticates would make one compromise into two.
     */
    artifact?: string;
  }>,
): void {
  const decoded = [
    decodeMemberDirectorySecret(input.identity, "identity"),
    decodeMemberDirectorySecret(input.integrity, "integrity"),
    decodeMemberDirectorySecret(input.cursor, "cursor"),
    ...(input.artifact === undefined
      ? []
      : [decodeMemberDirectorySecret(input.artifact, "artifact")]),
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

export type MemberDirectoryOutputWrite = Readonly<{ path: string; data: unknown }>;

/**
 * The canonical content MAC of one document a chunk writes (T108).
 *
 * It has two readers that must agree byte for byte: the chunk output-set MAC folds these leaves
 * into the root a receipt carries, and the frozen output plan stores one per planned target as its
 * `contentMac`. Two spellings of "the MAC of this document at this path" would produce a plan whose
 * targets could never be reconciled against the receipt that approved them, and the mismatch would
 * only surface once chunks had already written.
 */
export function createMemberDirectoryOutputLeafMac(
  input: Readonly<{ path: string; data: unknown; secretMaterial: string }>,
): string {
  return createMemberDirectoryIntegrityMac({
    domain: "bpt-member-directory-chunk-output-leaf-v1",
    values: [input.path, canonicalizeMemberDirectoryValue(input.data)],
    secretMaterial: input.secretMaterial,
  });
}

/**
 * The output-set MAC of one migration chunk (T108): a sorted leaf-per-document MAC folded into a
 * root bound to the chunk that produced it.
 *
 * The leaves are sorted so the MAC describes a *set* of documents rather than the order an executor
 * happened to emit them in, and the root binds the chunk ID and phase so a MAC computed for one
 * chunk cannot be presented as the receipt of another. Its domains are distinct from the canonical
 * import's leaf/root domains for the same reason: an import receipt must not verify as a chunk one.
 *
 * A repeated path is rejected rather than folded in twice. Two writes to one document inside a
 * transaction is a planning bug, and a MAC that quietly accepted it would certify the wrong set.
 */
export function createMemberDirectoryChunkOutputSetMac(
  input: Readonly<{
    chunkId: string;
    phase: string;
    writes: readonly MemberDirectoryOutputWrite[];
    secretMaterial: string;
  }>,
): string {
  const seenPaths = new Set<string>();
  const leaves = input.writes
    .map((write) => {
      if (seenPaths.has(write.path)) {
        throw new Error("A member directory chunk cannot write the same document twice");
      }
      seenPaths.add(write.path);
      return createMemberDirectoryOutputLeafMac({
        path: write.path,
        data: write.data,
        secretMaterial: input.secretMaterial,
      });
    })
    .sort();
  return createMemberDirectoryIntegrityMac({
    domain: "bpt-member-directory-chunk-output-root-v1",
    values: [input.chunkId, input.phase, "1", ...leaves],
    secretMaterial: input.secretMaterial,
  });
}

/**
 * The fingerprint of one source row (T108, forward).
 *
 * The dry-run records it for every reviewed row; the forward chunk recomputes it from the row it
 * re-reads and refuses the chunk when the two differ. That is what "reject the whole plan if any
 * input changed" is made of - without it the confirmation would migrate whatever the source happens
 * to say at commit time rather than what a human reviewed.
 *
 * It covers the whole stored document, so a changed name, a changed identifier and a changed
 * `updatedAt` are one failure rather than three separate checks that can drift apart. Its domain is
 * its own: a source-row MAC and a chunk-output MAC answer different questions, and neither may ever
 * verify as the other.
 */
export function createMemberDirectorySourceRowMac(
  input: Readonly<{
    academyId: string;
    sourceCollection: string;
    sourceId: string;
    document: unknown;
    secretMaterial: string;
  }>,
): string {
  return createMemberDirectoryIntegrityMac({
    domain: "bpt-member-directory-source-row-v1",
    values: [
      requiredSafeIdentifier(input.academyId, "academy ID"),
      requiredSafeIdentifier(input.sourceCollection, "source collection"),
      requiredSafeIdentifier(input.sourceId, "source ID"),
      canonicalizeMemberDirectoryValue(input.document),
    ],
    secretMaterial: input.secretMaterial,
  });
}

/**
 * The MACs of the two frozen private artifacts (T108): the reviewed manifest and the output plan.
 *
 * They are separate functions with separate domains because they answer separate questions - which
 * legacy row becomes which student, against which documents that produces - and a receipt binds
 * both. One MAC over a concatenation of the two would let a manifest be re-paired with a plan that
 * happened to hash to the same total.
 *
 * Each MAC is taken over the canonical JSON of the whole artifact, so nothing inside it - a row, a
 * reviewed reason, an expiry, a target path - can change without the receipt that named it ceasing
 * to verify. That is what keeps the artifacts outside Firestore honest: the database stores no row,
 * only the proof that the rows it was confirmed against are the rows being executed.
 */
export function createMemberDirectoryPrivateManifestMac(
  input: Readonly<{ manifest: unknown; secretMaterial: string }>,
): string {
  return createMemberDirectoryIntegrityMac({
    domain: "bpt-member-directory-private-manifest-v1",
    values: [canonicalizeMemberDirectoryValue(input.manifest)],
    secretMaterial: input.secretMaterial,
  });
}

export function createMemberDirectoryPrivatePlanMac(
  input: Readonly<{ plan: unknown; secretMaterial: string }>,
): string {
  return createMemberDirectoryIntegrityMac({
    domain: "bpt-member-directory-private-plan-v1",
    values: [canonicalizeMemberDirectoryValue(input.plan)],
    secretMaterial: input.secretMaterial,
  });
}

/**
 * The source-set MAC of an operation: the fold of every reviewed row's own source fingerprint.
 *
 * The receipt carries it so that "the source changed" can be caught **once, for the whole plan**,
 * before the first chunk, rather than one row at a time as each chunk reaches it. Sorting by source
 * ID makes it a proof about a set, so re-deriving it from the manifest in a different row order
 * gives the same answer; a repeated source ID is rejected instead of folded in twice, because a
 * source mapped twice is the ambiguity the manifest rule already refuses.
 */
export function createMemberDirectorySourceSetMac(
  input: Readonly<{
    academyId: string;
    operationId: string;
    rows: readonly Readonly<{ sourceId: string; sourceRowMac: string }>[];
    secretMaterial: string;
  }>,
): string {
  const seen = new Set<string>();
  const folded = input.rows.map((row) => {
    if (seen.has(row.sourceId)) {
      throw new Error("A member directory source set cannot list the same row twice");
    }
    seen.add(row.sourceId);
    return `${requiredSafeIdentifier(row.sourceId, "source ID")},${row.sourceRowMac}`;
  });
  const sorted = [...folded].sort();
  return createMemberDirectoryIntegrityMac({
    domain: "bpt-member-directory-source-set-v1",
    values: [
      requiredSafeIdentifier(input.academyId, "academy ID"),
      requiredSafeIdentifier(input.operationId, "operation ID"),
      String(sorted.length),
      ...sorted,
    ],
    secretMaterial: input.secretMaterial,
  });
}

/**
 * The reservation tuple a baseline is folded from, and its inverse.
 *
 * The format has exactly one definition because it now has two readers: the bootstrap executor,
 * which emits the tuples its chunk expects to own, and the closure runner, which rebuilds them from
 * the documents Firestore actually stored. Two spellings of the same five-field join would produce
 * two MACs that disagree for no reason anyone could see from either side.
 *
 * Only `keyId` may contain a `:`, and none of the five fields may contain a `,`, so the join is
 * unambiguous and the split back out is total.
 */
export function buildStudentIdentityKeyTuple(key: StudentIdentityKey): string {
  return [key.kind, key.keyId, key.ownerStudentId, key.digestVersion, key.secretVersion].join(",");
}

export type ParsedStudentIdentityKeyTuple = Readonly<{
  kind: StudentIdentityKeyKind;
  keyId: string;
  ownerStudentId: string;
  digestVersion: "hmac-sha256-v1";
  secretVersion: string;
}>;

const identityKeyTupleFields = z.strictObject({
  kind: z.enum(studentIdentityKeyKinds),
  keyId: studentIdentityKeySchema.shape.keyId,
  ownerStudentId: studentIdentityKeySchema.shape.ownerStudentId,
  digestVersion: studentIdentityKeySchema.shape.digestVersion,
  secretVersion: studentIdentityKeySchema.shape.secretVersion,
});

/**
 * Reads a tuple back into its fields, and refuses anything it cannot read exactly.
 *
 * This exists so a frozen artifact's expected tuple can name the document that must prove it. A
 * tuple whose `keyId` does not carry its own `kind` is rejected rather than repaired: the prefix is
 * what ties the digest to the identifier space it was derived in, and a caller that trusted a
 * mismatched pair would read one reservation while proving another.
 */
export function parseStudentIdentityKeyTuple(value: string): ParsedStudentIdentityKeyTuple {
  const segments = value.split(",");
  if (segments.length !== 5) {
    throw new Error("Invalid student identity key tuple");
  }
  const [kind, keyId, ownerStudentId, digestVersion, secretVersion] = segments as [
    string,
    string,
    string,
    string,
    string,
  ];
  const parsed = identityKeyTupleFields.safeParse({
    kind,
    keyId,
    ownerStudentId,
    digestVersion,
    secretVersion,
  });
  if (!parsed.success || !keyId.startsWith(`${kind}:`)) {
    throw new Error("Invalid student identity key tuple");
  }
  return Object.freeze(parsed.data);
}

/**
 * The identity-key baseline MAC (T108, bootstrap verification).
 *
 * It is a frozen proof of the identities that predated writer activation: the complete set of
 * current reservation tuples `(kind,keyId,ownerStudentId,digestVersion,secretVersion)`, sorted into
 * canonical lexical order and folded under a domain of its own. Its own domain matters - a chunk
 * output MAC and a baseline MAC must never verify as one another, because they answer different
 * questions: "what did this chunk write" against "what does this tenant now hold".
 *
 * Sorting rather than accepting the caller's order is what makes it a baseline of a *set*: the same
 * identities discovered in a different chunk order must produce the same proof, or resuming a failed
 * bootstrap could never reproduce it. A repeated tuple is rejected instead of folded in twice.
 *
 * It is deliberately not an accumulator. Normal writes never recompute it; later identities are
 * covered by their own write receipts.
 */
export function createMemberDirectoryIdentityBaselineMac(
  input: Readonly<{
    academyId: string;
    operationId: string;
    secretVersion: string;
    tuples: readonly string[];
    secretMaterial: string;
  }>,
): string {
  const seen = new Set<string>();
  for (const tuple of input.tuples) {
    if (seen.has(tuple)) {
      throw new Error("A member directory identity baseline cannot list the same tuple twice");
    }
    seen.add(tuple);
  }
  const sorted = [...input.tuples].sort();
  return createMemberDirectoryIntegrityMac({
    domain: "bpt-member-directory-identity-baseline-v1",
    values: [
      requiredSafeIdentifier(input.academyId, "academy ID"),
      requiredSafeIdentifier(input.operationId, "operation ID"),
      requiredSafeIdentifier(input.secretVersion, "secret version"),
      String(sorted.length),
      ...sorted,
    ],
    secretMaterial: input.secretMaterial,
  });
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
