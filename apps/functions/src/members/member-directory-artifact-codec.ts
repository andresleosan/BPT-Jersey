import { createDecipheriv, createCipheriv, createHmac, randomBytes } from "node:crypto";

import { z } from "zod";

import {
  canonicalizeMemberDirectoryValue,
  decodeMemberDirectorySecret,
  encodeLengthPrefixedUtf8,
} from "./member-directory-crypto.js";

/**
 * The envelope every frozen member directory artifact is sealed in (T108).
 *
 * The reviewed manifest, the output plan and the identity baseline live outside Firestore. The
 * operator's decision of 2026-09-08 is that wherever those bytes land they are sealed by the
 * application first, under a key of their own, rather than resting on whatever the store encrypts
 * with: the manifest carries `reviewedReason`, free text a person wrote, and a name can end up
 * there. With an envelope of our own, an object read straight out of the bucket is not readable
 * even by whoever holds the bucket credential.
 *
 * **Why the codec is separate from the store.** The artifact is sealed and opened the same way
 * whether the bytes go to a file under the approved input root or to an approved remote store
 * later. Keeping the two apart means the store is only ever a byte sink, and the encryption path is
 * exercised by the Emulator rehearsal instead of running for the first time somewhere remote.
 *
 * **What the sealing binds.** The kind, the academy and the operation go into the AEAD's additional
 * data, so a manifest ciphertext cannot be opened as a plan, under another operation or for another
 * tenant: those are not comparisons a caller can forget, they are inputs to the tag. The plaintext
 * is the artifact's canonical JSON, the same bytes its MAC is taken over, so the seal and the proof
 * agree on what the artifact is rather than covering two slightly different serializations.
 */

export const memberDirectoryArtifactKinds = Object.freeze([
  "reviewed-manifest",
  "output-plan",
  "identity-baseline",
] as const);

export type MemberDirectoryArtifactKind = (typeof memberDirectoryArtifactKinds)[number];

const envelopeVersion = "aes-256-gcm-v1";
const keyDerivationDomain = "bpt-member-directory-artifact-key-v1";
const associatedDataDomain = "bpt-member-directory-artifact-aad-v1";

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;

const initializationVectorBytes = 12;
const authenticationTagBytes = 16;

/** A frozen artifact is metadata, not a payload: a megabyte of it is already far past any real plan. */
export const memberDirectoryMaxArtifactBytes = 1024 * 1024;

export const memberDirectorySealedArtifactSchema = z.strictObject({
  envelopeVersion: z.literal(envelopeVersion),
  kind: z.enum(memberDirectoryArtifactKinds),
  academyId: z.string().regex(safeIdentifierPattern),
  operationId: z.string().regex(safeIdentifierPattern),
  initializationVector: z.string().regex(base64UrlPattern),
  ciphertext: z.string().regex(base64UrlPattern),
  authenticationTag: z.string().regex(base64UrlPattern),
});

export type MemberDirectorySealedArtifact = Readonly<
  z.infer<typeof memberDirectorySealedArtifactSchema>
>;

export type MemberDirectoryArtifactAddress = Readonly<{
  kind: MemberDirectoryArtifactKind;
  academyId: string;
  operationId: string;
}>;

function artifactFailure(reason: string): never {
  throw new Error(`Member directory artifact refused: ${reason}`);
}

function assertAddress(address: MemberDirectoryArtifactAddress): void {
  if (!safeIdentifierPattern.test(address.academyId)) {
    artifactFailure("the academy ID is not a safe identifier");
  }
  if (!safeIdentifierPattern.test(address.operationId)) {
    artifactFailure("the operation ID is not a safe identifier");
  }
}

/**
 * The content key.
 *
 * AES-256 needs exactly 32 bytes and the configured secret is 32 to 64, so a derivation step is
 * required regardless; the secret itself never reaches the cipher. It is domain-separated from the
 * empty-baseline initializer's HKDF use of the same secret, so nothing sealed by one opens under
 * the other.
 *
 * It is deliberately **not** derived per artifact kind. Kind separation lives in the additional
 * data, where a cross-kind open fails on the tag; a second key split would add nothing a test could
 * ever observe, and a guard no test can kill is an intention rather than a rule.
 */
function deriveContentKey(secretMaterial: string): Buffer {
  const secret = decodeMemberDirectorySecret(secretMaterial, "artifact");
  return createHmac("sha256", secret)
    .update(encodeLengthPrefixedUtf8([keyDerivationDomain, envelopeVersion]))
    .digest();
}

function associatedData(address: MemberDirectoryArtifactAddress): Buffer {
  return encodeLengthPrefixedUtf8([
    associatedDataDomain,
    envelopeVersion,
    address.kind,
    address.academyId,
    address.operationId,
  ]);
}

/** Seals one artifact into the envelope the store persists verbatim. */
export function sealMemberDirectoryArtifact(
  input: MemberDirectoryArtifactAddress & Readonly<{ artifact: unknown; secretMaterial: string }>,
): MemberDirectorySealedArtifact {
  assertAddress(input);
  const plaintext = Buffer.from(canonicalizeMemberDirectoryValue(input.artifact), "utf8");
  if (plaintext.byteLength > memberDirectoryMaxArtifactBytes) {
    artifactFailure("the artifact exceeds the maximum sealed size");
  }
  const initializationVector = randomBytes(initializationVectorBytes);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveContentKey(input.secretMaterial),
    initializationVector,
    { authTagLength: authenticationTagBytes },
  );
  cipher.setAAD(associatedData(input));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Object.freeze({
    envelopeVersion,
    kind: input.kind,
    academyId: input.academyId,
    operationId: input.operationId,
    initializationVector: initializationVector.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authenticationTag: cipher.getAuthTag().toString("base64url"),
  });
}

/**
 * Opens a sealed artifact, and refuses anything that is not the artifact that was asked for.
 *
 * The header is compared with the caller's address before the cipher runs. That comparison is not
 * the security boundary - the tag is, because the same three fields are the additional data - but
 * without it a mismatch would surface as "decryption failed", which sends the reader looking for a
 * corrupted object when what actually happened is that they opened the wrong one.
 */
export function openMemberDirectoryArtifact(
  input: MemberDirectoryArtifactAddress & Readonly<{ sealed: unknown; secretMaterial: string }>,
): unknown {
  assertAddress(input);
  const parsed = memberDirectorySealedArtifactSchema.safeParse(input.sealed);
  if (!parsed.success) {
    artifactFailure("the stored envelope is not a valid sealed artifact");
  }
  const envelope = parsed.data;
  if (
    envelope.kind !== input.kind ||
    envelope.academyId !== input.academyId ||
    envelope.operationId !== input.operationId
  ) {
    artifactFailure("the stored envelope is not the artifact that was asked for");
  }
  const initializationVector = Buffer.from(envelope.initializationVector, "base64url");
  const authenticationTag = Buffer.from(envelope.authenticationTag, "base64url");
  if (
    initializationVector.byteLength !== initializationVectorBytes ||
    authenticationTag.byteLength !== authenticationTagBytes
  ) {
    artifactFailure("the stored envelope has an invalid nonce or tag");
  }
  const ciphertext = Buffer.from(envelope.ciphertext, "base64url");
  if (ciphertext.byteLength > memberDirectoryMaxArtifactBytes) {
    artifactFailure("the sealed artifact exceeds the maximum size");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveContentKey(input.secretMaterial),
    initializationVector,
    { authTagLength: authenticationTagBytes },
  );
  decipher.setAAD(associatedData(input));
  decipher.setAuthTag(authenticationTag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // Deliberately not reflecting the underlying error: a tag failure and a key failure are the
    // same answer to a caller, and telling them apart is a distinction only an attacker needs.
    artifactFailure("the sealed artifact does not open under this key");
  }
  try {
    return JSON.parse(plaintext.toString("utf8")) as unknown;
  } catch {
    artifactFailure("the sealed artifact does not contain valid JSON");
  }
}
