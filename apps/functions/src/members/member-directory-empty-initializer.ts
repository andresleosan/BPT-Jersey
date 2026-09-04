import {
  memberDirectoryStateSchema,
  type MemberDirectoryState,
} from "@bpt-jersey/domain/members/directory";
import { z } from "zod";

import { decodeMemberDirectorySecret } from "./member-directory-crypto.js";
import {
  assertMemberDirectoryOperationEnvironment,
  type MemberDirectoryRestoreAmbientEnvironment,
} from "./member-directory-environment.js";
import {
  buildInitialMemberDirectoryControlPlane,
  type MemberDirectoryGuardEvent,
  type MemberDirectoryRestoreGuard,
} from "./member-directory-state.js";

const projectId = "demo-bpt-jersey" as const;
const actorId = "t093-empty-canonical-initializer" as const;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export const EMPTY_CANONICAL_INITIALIZER_CONFIRMATION = "T093-EMPTY-CANONICAL-INITIALIZE" as const;

const privateBaselineSchema = z.strictObject({
  artifactKind: z.literal("member-directory-empty-identity-baseline-v1"),
  artifactId: z.string().regex(identifierPattern),
  projectId: z.literal(projectId),
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

export type VerifiedPrivateEmptyIdentityBaseline = Readonly<z.infer<typeof privateBaselineSchema>>;

export type EmptyCanonicalInitializationDocuments = Readonly<{
  academyId: string;
  state: MemberDirectoryState;
  guard: MemberDirectoryRestoreGuard;
  event: MemberDirectoryGuardEvent;
}>;

export type EmptyCanonicalDirectoryStore = Readonly<{
  projectId: string;
  initializeAtomically(documents: EmptyCanonicalInitializationDocuments): Promise<void>;
}>;

export type EmptyCanonicalInitializerRequest = Readonly<{
  arguments: readonly string[];
  environment: MemberDirectoryRestoreAmbientEnvironment;
  now(): string;
}>;

export type EmptyCanonicalInitializerDependencies = Readonly<{
  /**
   * This port must reopen a private artifact and verify its MAC before returning.
   * No filesystem/Secret Manager implementation exists yet, so the CLI deliberately
   * leaves it undefined and fails before Firebase is imported or initialized.
   */
  reopenAndVerifyPrivateEmptyBaseline?: (
    binding: Readonly<{
      projectId: typeof projectId;
      academyId: string;
    }>,
  ) => Promise<VerifiedPrivateEmptyIdentityBaseline>;
  getIntegritySecret(): Readonly<{
    material: string;
    version: "integrity-v1";
  }>;
  /** The factory is invoked only after arguments, environment and artifact are valid. */
  createStore(): EmptyCanonicalDirectoryStore | Promise<EmptyCanonicalDirectoryStore>;
}>;

type ParsedArguments = Readonly<{ academyId: string }>;

function invalidArguments(): never {
  throw new Error("Invalid empty canonical initializer arguments or confirmation.");
}

export function parseEmptyCanonicalInitializerArguments(
  arguments_: readonly string[],
): ParsedArguments {
  if (arguments_.length !== 2) return invalidArguments();
  const values = new Map<string, string>();
  for (const argument of arguments_) {
    if (!argument.startsWith("--")) return invalidArguments();
    const separator = argument.indexOf("=");
    if (separator < 3 || separator !== argument.lastIndexOf("=")) return invalidArguments();
    const key = argument.slice(2, separator);
    const value = argument.slice(separator + 1);
    if (
      (key !== "academy-id" && key !== "confirmation") ||
      values.has(key) ||
      value.length === 0 ||
      value.trim() !== value
    ) {
      return invalidArguments();
    }
    values.set(key, value);
  }
  const academyId = values.get("academy-id");
  if (
    academyId === undefined ||
    !identifierPattern.test(academyId) ||
    values.get("confirmation") !== EMPTY_CANONICAL_INITIALIZER_CONFIRMATION
  ) {
    return invalidArguments();
  }
  return Object.freeze({ academyId });
}

function buildDocuments(
  academyId: string,
  now: string,
  baseline: VerifiedPrivateEmptyIdentityBaseline,
  integritySecret: Readonly<{ material: string; version: "integrity-v1" }>,
): EmptyCanonicalInitializationDocuments {
  const decodedIntegritySecret = decodeMemberDirectorySecret(
    integritySecret.material,
    "initializer integrity",
  );
  if (
    baseline.academyId !== academyId ||
    baseline.integritySecretVersion !== integritySecret.version ||
    decodedIntegritySecret.every((byte) => byte === decodedIntegritySecret[0])
  ) {
    throw new Error("Private empty baseline academy binding mismatch.");
  }
  const state = memberDirectoryStateSchema.parse({
    stateId: "current",
    academyId,
    readerVersion: "canonical-v1",
    directoryWriteMode: "canonical-v1",
    freezeStatus: "open",
    stateRevision: 0,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "complete",
    digestVersion: baseline.digestVersion,
    secretVersion: baseline.identitySecretVersion,
    identityKeyBaselineMac: baseline.baselineMac,
    identityKeyBaselineArtifactId: baseline.artifactId,
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: 0,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
  });
  const control = buildInitialMemberDirectoryControlPlane({
    projectId,
    state,
    now,
    actorId,
    integritySecretMaterial: integritySecret.material,
    integritySecretVersion: integritySecret.version,
  });
  return Object.freeze({ academyId, state, guard: control.guard, event: control.event });
}

/** @internal Runner-only. It is intentionally absent from Functions/index exports. */
export async function runEmptyCanonicalMemberDirectoryInitializer(
  request: EmptyCanonicalInitializerRequest,
  dependencies: EmptyCanonicalInitializerDependencies,
): Promise<
  Readonly<{
    academyId: string;
    stateRevision: 0;
    baselineArtifactId: string;
  }>
> {
  const parsedArguments = parseEmptyCanonicalInitializerArguments(request.arguments);
  assertMemberDirectoryOperationEnvironment({
    target: "emulator",
    explicitProjectId: projectId,
    environment: request.environment,
    app: { projectId },
  });

  const reopenBaseline = dependencies.reopenAndVerifyPrivateEmptyBaseline;
  if (reopenBaseline === undefined) {
    throw new Error(
      "Private empty baseline verifier is not configured; initialization is disabled.",
    );
  }
  const baseline = privateBaselineSchema.parse(
    await reopenBaseline({ projectId, academyId: parsedArguments.academyId }),
  );
  const documents = buildDocuments(
    parsedArguments.academyId,
    request.now(),
    baseline,
    dependencies.getIntegritySecret(),
  );

  // Creating the Admin/Firestore adapter is intentionally the final pre-I/O step.
  const store = await dependencies.createStore();
  if (store.projectId !== projectId) {
    throw new Error("Empty canonical initializer Firestore project mismatch.");
  }
  await store.initializeAtomically(documents);
  return Object.freeze({
    academyId: parsedArguments.academyId,
    stateRevision: 0,
    baselineArtifactId: baseline.artifactId,
  });
}
