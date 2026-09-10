import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdir as makeDirectory,
  readFile as readLocalFile,
  writeFile as writeLocalFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";

import { z } from "zod";

import {
  canonicalizeMemberDirectoryValue,
  decodeMemberDirectorySecret,
  encodeLengthPrefixedUtf8,
} from "./member-directory-crypto.js";
import type { VerifiedPrivateEmptyIdentityBaseline } from "./member-directory-empty-initializer.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/u;
const maximumArtifactBytes = 16 * 1024;

const bindingSchema = z.strictObject({
  projectId: z.literal("demo-bpt-jersey"),
  academyId: z.string().regex(identifierPattern),
});

const payloadSchema = z.strictObject({
  artifactKind: z.literal("member-directory-empty-identity-baseline-v1"),
  artifactId: z.string().regex(identifierPattern),
  projectId: z.literal("demo-bpt-jersey"),
  academyId: z.string().regex(identifierPattern),
  identityKeyCount: z.literal(0),
  digestVersion: z.literal("hmac-sha256-v1"),
  identitySecretVersion: z.literal("identity-v1"),
  baselineMac: z.string().regex(/^[a-f0-9]{64}$/u),
  integrityMacVersion: z.literal("hmac-sha256-v1"),
  integritySecretVersion: z.literal("integrity-v1"),
  schemaVersion: z.literal("1"),
  artifactMac: z.string().regex(/^[a-f0-9]{64}$/u),
});

const envelopeSchema = z.strictObject({
  envelopeKind: z.literal("member-directory-empty-baseline-envelope-v1"),
  algorithm: z.literal("aes-256-gcm"),
  projectId: z.literal("demo-bpt-jersey"),
  academyId: z.string().regex(identifierPattern),
  artifactId: z.string().regex(identifierPattern),
  schemaVersion: z.literal("1"),
  identitySecretVersion: z.literal("identity-v1"),
  integritySecretVersion: z.literal("integrity-v1"),
  encryptionSecretVersion: z.literal("baseline-encryption-v1"),
  iv: z.string().regex(base64UrlPattern),
  authTag: z.string().regex(base64UrlPattern),
  ciphertext: z.string().regex(base64UrlPattern),
});

export type EmptyCanonicalInitializerSecrets = Readonly<{
  identity: Readonly<{ material: string; version: "identity-v1" }>;
  integrity: Readonly<{ material: string; version: "integrity-v1" }>;
  encryption: Readonly<{
    material: string;
    version: "baseline-encryption-v1";
  }>;
}>;

export type EmptyBaselineFileIo = Readonly<{
  mkdir(path: string, options: Readonly<{ recursive: true }>): Promise<unknown>;
  writeFile(
    path: string,
    value: string,
    options: Readonly<{ encoding: "utf8"; flag: "wx"; mode: number }>,
  ): Promise<void>;
  readFile(path: string): Promise<string>;
}>;

type BaselineBinding = Readonly<z.infer<typeof bindingSchema>>;
type BaselinePayload = Readonly<z.infer<typeof payloadSchema>>;
type BaselineEnvelope = Readonly<z.infer<typeof envelopeSchema>>;

const defaultIo: EmptyBaselineFileIo = Object.freeze({
  mkdir: async (path, options) => makeDirectory(path, options),
  writeFile: async (path, value, options) => writeLocalFile(path, value, options),
  readFile: async (path) => readLocalFile(path, "utf8"),
});

function invalidSecret(): never {
  throw new Error("Invalid empty canonical initializer secrets.");
}

function checkedSecret(value: string | undefined, purpose: string): Buffer {
  if (value === undefined) return invalidSecret();
  let decoded: Buffer;
  try {
    decoded = decodeMemberDirectorySecret(value, purpose);
  } catch {
    return invalidSecret();
  }
  const normalizedText = decoded.toString("utf8").toLowerCase();
  if (
    decoded.every((byte) => byte === decoded[0]) ||
    /change.?me|placeholder|example|dummy|password|test/u.test(normalizedText)
  ) {
    return invalidSecret();
  }
  return decoded;
}

export function loadEmptyCanonicalInitializerSecrets(
  environment: Readonly<Record<string, string | undefined>>,
): EmptyCanonicalInitializerSecrets {
  const identityMaterial = environment.MEMBER_DIRECTORY_IDENTITY_KEY_SECRET;
  const integrityMaterial = environment.MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET;
  const encryptionMaterial = environment.MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET;
  const decoded = [
    checkedSecret(identityMaterial, "identity"),
    checkedSecret(integrityMaterial, "integrity"),
    checkedSecret(encryptionMaterial, "baseline encryption"),
  ];
  for (let left = 0; left < decoded.length; left += 1) {
    for (let right = left + 1; right < decoded.length; right += 1) {
      const leftValue = decoded[left];
      const rightValue = decoded[right];
      if (
        leftValue !== undefined &&
        rightValue !== undefined &&
        leftValue.length === rightValue.length &&
        timingSafeEqual(leftValue, rightValue)
      ) {
        throw new Error("Empty canonical initializer purpose secrets must be distinct.");
      }
    }
  }
  if (
    identityMaterial === undefined ||
    integrityMaterial === undefined ||
    encryptionMaterial === undefined
  ) {
    return invalidSecret();
  }
  return Object.freeze({
    identity: Object.freeze({ material: identityMaterial, version: "identity-v1" }),
    integrity: Object.freeze({ material: integrityMaterial, version: "integrity-v1" }),
    encryption: Object.freeze({
      material: encryptionMaterial,
      version: "baseline-encryption-v1",
    }),
  });
}

function keyedMac(domain: string, value: unknown, secret: Buffer): string {
  return createHmac("sha256", secret)
    .update(encodeLengthPrefixedUtf8([domain, canonicalizeMemberDirectoryValue(value)]))
    .digest("hex");
}

function artifactIdentity(binding: BaselineBinding): Readonly<{
  artifactId: string;
  fileName: string;
}> {
  const digest = createHash("sha256")
    .update(
      encodeLengthPrefixedUtf8([
        "member-directory-empty-baseline-artifact-id-v1",
        binding.projectId,
        binding.academyId,
      ]),
    )
    .digest("hex");
  return Object.freeze({
    artifactId: `empty-baseline-${digest.slice(0, 40)}`,
    fileName: `${digest}.json`,
  });
}

function buildPayload(
  binding: BaselineBinding,
  artifactId: string,
  secrets: EmptyCanonicalInitializerSecrets,
): BaselinePayload {
  const integritySecret = decodeMemberDirectorySecret(secrets.integrity.material, "integrity");
  const identityCommitment = Object.freeze({
    artifactId,
    projectId: binding.projectId,
    academyId: binding.academyId,
    identityKeyCount: 0,
    digestVersion: "hmac-sha256-v1",
    identitySecretVersion: secrets.identity.version,
    schemaVersion: "1",
  });
  const baselineMac = keyedMac(
    "member-directory-empty-identity-baseline-v1",
    identityCommitment,
    integritySecret,
  );
  const unsignedPayload = Object.freeze({
    artifactKind: "member-directory-empty-identity-baseline-v1",
    artifactId,
    projectId: binding.projectId,
    academyId: binding.academyId,
    identityKeyCount: 0,
    digestVersion: "hmac-sha256-v1",
    identitySecretVersion: secrets.identity.version,
    baselineMac,
    integrityMacVersion: "hmac-sha256-v1",
    integritySecretVersion: secrets.integrity.version,
    schemaVersion: "1",
  });
  return payloadSchema.parse({
    ...unsignedPayload,
    artifactMac: keyedMac(
      "member-directory-empty-baseline-artifact-v1",
      unsignedPayload,
      integritySecret,
    ),
  });
}

function envelopeHeader(
  binding: BaselineBinding,
  artifactId: string,
  secrets: EmptyCanonicalInitializerSecrets,
) {
  return Object.freeze({
    envelopeKind: "member-directory-empty-baseline-envelope-v1" as const,
    algorithm: "aes-256-gcm" as const,
    projectId: binding.projectId,
    academyId: binding.academyId,
    artifactId,
    schemaVersion: "1" as const,
    identitySecretVersion: secrets.identity.version,
    integritySecretVersion: secrets.integrity.version,
    encryptionSecretVersion: secrets.encryption.version,
  });
}

function deriveEncryptionKey(
  binding: BaselineBinding,
  artifactId: string,
  secretMaterial: string,
): Buffer {
  const secret = decodeMemberDirectorySecret(secretMaterial, "baseline encryption");
  const salt = createHash("sha256")
    .update(
      encodeLengthPrefixedUtf8([
        "member-directory-empty-baseline-hkdf-salt-v1",
        binding.projectId,
        binding.academyId,
        artifactId,
      ]),
    )
    .digest();
  const info = encodeLengthPrefixedUtf8([
    "member-directory-empty-baseline-aes-256-gcm-key-v1",
    "schema-1",
    "baseline-encryption-v1",
  ]);
  return Buffer.from(hkdfSync("sha256", secret, salt, info, 32));
}

function encryptPayload(
  binding: BaselineBinding,
  payload: BaselinePayload,
  secrets: EmptyCanonicalInitializerSecrets,
): BaselineEnvelope {
  const header = envelopeHeader(binding, payload.artifactId, secrets);
  const aad = Buffer.from(canonicalizeMemberDirectoryValue(header), "utf8");
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveEncryptionKey(binding, payload.artifactId, secrets.encryption.material),
    iv,
  );
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(canonicalizeMemberDirectoryValue(payload), "utf8"),
    cipher.final(),
  ]);
  return envelopeSchema.parse({
    ...header,
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  });
}

function decodeCanonicalBase64Url(value: string, expectedBytes?: number): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length === 0 ||
    decoded.toString("base64url") !== value ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes)
  ) {
    throw new Error("Invalid encoded artifact field.");
  }
  return decoded;
}

function reopenEnvelope(
  serialized: string,
  binding: BaselineBinding,
  artifactId: string,
  secrets: EmptyCanonicalInitializerSecrets,
): VerifiedPrivateEmptyIdentityBaseline {
  if (Buffer.byteLength(serialized, "utf8") > maximumArtifactBytes) {
    throw new Error("Invalid artifact size.");
  }
  const envelope = envelopeSchema.parse(JSON.parse(serialized));
  const expectedHeader = envelopeHeader(binding, artifactId, secrets);
  for (const [key, value] of Object.entries(expectedHeader)) {
    if (envelope[key as keyof typeof envelope] !== value) {
      throw new Error("Invalid artifact binding.");
    }
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveEncryptionKey(binding, artifactId, secrets.encryption.material),
    decodeCanonicalBase64Url(envelope.iv, 12),
  );
  decipher.setAAD(Buffer.from(canonicalizeMemberDirectoryValue(expectedHeader), "utf8"));
  decipher.setAuthTag(decodeCanonicalBase64Url(envelope.authTag, 16));
  const plaintext = Buffer.concat([
    decipher.update(decodeCanonicalBase64Url(envelope.ciphertext)),
    decipher.final(),
  ]).toString("utf8");
  const payload = payloadSchema.parse(JSON.parse(plaintext));
  if (
    payload.projectId !== binding.projectId ||
    payload.academyId !== binding.academyId ||
    payload.artifactId !== artifactId
  ) {
    throw new Error("Invalid payload binding.");
  }
  const expectedPayload = buildPayload(binding, artifactId, secrets);
  if (
    !timingSafeEqual(
      Buffer.from(payload.baselineMac, "hex"),
      Buffer.from(expectedPayload.baselineMac, "hex"),
    ) ||
    !timingSafeEqual(
      Buffer.from(payload.artifactMac, "hex"),
      Buffer.from(expectedPayload.artifactMac, "hex"),
    ) ||
    canonicalizeMemberDirectoryValue(payload) !== canonicalizeMemberDirectoryValue(expectedPayload)
  ) {
    throw new Error("Invalid artifact MAC.");
  }
  return Object.freeze(payload);
}

function isAlreadyExistingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function validatedArtifactRoot(artifactRootUrl: URL): string {
  if (
    artifactRootUrl.protocol !== "file:" ||
    artifactRootUrl.username !== "" ||
    artifactRootUrl.password !== "" ||
    artifactRootUrl.search !== "" ||
    artifactRootUrl.hash !== ""
  ) {
    throw new Error("Invalid private baseline root.");
  }
  const root = fileURLToPath(artifactRootUrl);
  if (basename(root) !== "member-directory-baselines" || basename(dirname(root)) !== ".tmp") {
    throw new Error("Invalid private baseline root.");
  }
  return root;
}

export function createLocalEmptyIdentityBaselineAdapter(
  input: Readonly<{
    secrets: EmptyCanonicalInitializerSecrets;
    artifactRootUrl: URL;
    io?: EmptyBaselineFileIo;
  }>,
): Readonly<{
  ensureAndReopen(binding: BaselineBinding): Promise<VerifiedPrivateEmptyIdentityBaseline>;
}> {
  const io = input.io ?? defaultIo;
  const artifactRoot = validatedArtifactRoot(input.artifactRootUrl);
  return Object.freeze({
    async ensureAndReopen(rawBinding) {
      try {
        const binding = bindingSchema.parse(rawBinding);
        const identity = artifactIdentity(binding);
        const filePath = join(artifactRoot, identity.fileName);
        const candidate = canonicalizeMemberDirectoryValue(
          encryptPayload(
            binding,
            buildPayload(binding, identity.artifactId, input.secrets),
            input.secrets,
          ),
        );
        await io.mkdir(artifactRoot, { recursive: true });
        try {
          await io.writeFile(filePath, candidate, {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          });
        } catch (error) {
          if (!isAlreadyExistingFile(error)) throw error;
        }
        return reopenEnvelope(
          await io.readFile(filePath),
          binding,
          identity.artifactId,
          input.secrets,
        );
      } catch {
        throw new Error("Invalid private empty baseline artifact.");
      }
    },
  });
}
