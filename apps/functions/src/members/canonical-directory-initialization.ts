import { createHash, createHmac } from "node:crypto";

import {
  memberDirectoryStateSchema,
  type MemberDirectoryState,
} from "@bpt-jersey/domain/members/directory";

import {
  canonicalizeMemberDirectoryValue,
  decodeMemberDirectorySecret,
  encodeLengthPrefixedUtf8,
} from "./member-directory-crypto.js";
import {
  buildInitialMemberDirectoryControlPlane,
  type MemberDirectoryGuardEvent,
  type MemberDirectoryRestoreGuard,
} from "./member-directory-state.js";

/**
 * Initializing the canonical member directory of a real academy.
 *
 * This exists because the directory of production was never initialized, and every read and every
 * write of the directory refuses without its state document: reads answer HTTP 400 through
 * `assertCanonicalReader`, and writes - enrolment approval among them - die inside
 * `createAdminAdultForAccount`. Nobody could be enrolled at all.
 *
 * There was already an initializer, `member-directory-empty-initializer.ts`, and it is deliberately
 * unusable here: it pins `demo-bpt-jersey` in a constant, in a `z.literal`, in an `emulator`
 * environment assertion and in a store check. That guard rail is not a mistake and is left exactly
 * as it is. This module is the separate, production-shaped path, so that making a real academy
 * work never requires weakening the emulator tool's promise that it cannot touch production.
 *
 * Two things about how it differs, and why:
 *
 * 1. **The identity baseline is computed here, not reopened from a private artifact.** The emulator
 *    flow mints an encrypted artifact on disk and verifies its MAC before initializing. That
 *    machinery guards a file; what the directory itself requires is narrower and is enforced by the
 *    state schema: `identityKeyCoverage: "complete"` is only accepted together with
 *    `identityKeyBaselineMac` and `identityKeyBaselineArtifactId`, and coverage has to be complete
 *    or neither the reader nor the writer will accept the state. So the same two values are derived
 *    here, byte for byte as the artifact flow derives them - same domain separators, same canonical
 *    encoding, same integrity secret - over the only commitment an empty directory can honestly
 *    make: zero identity keys. No artifact file is written, because there is no second party to
 *    hand it to and a file nobody reopens proves nothing.
 * 2. **A narrower emptiness precondition.** The emulator initializer demands eighteen empty
 *    collections, `auditEvents` included. An append-only audit log says nothing about directory
 *    integrity, and production has one the moment anybody tries anything - so that rule would block
 *    the fix forever while protecting nothing. What is checked instead is every collection whose
 *    contents would make "initialize as empty" a lie: the members themselves, their profiles and
 *    identity keys, and any migration, approval, receipt or cursor state that a half-run operation
 *    could have left behind.
 */

/** The actor recorded when a person initializes the directory: always a real uid, never a label. */
const initializationActorAction = "member.directory.initialized" as const;

/**
 * Collections that must be empty before an academy can be declared an empty canonical directory.
 *
 * Each one is here because its contents would contradict `identityKeyCoverage: "complete"` over
 * zero members, or because a later operation would treat leftovers as its own. Deliberately absent:
 * `auditEvents`, which is append-only and describes attempts rather than state; and the family,
 * profile and import receipts, which belong to writers outside the canonical directory.
 */
export const canonicalDirectoryRequiredEmptyCollections = Object.freeze([
  "members",
  "students",
  "studentAdminProfiles",
  "studentIdentityKeys",
  "memberDirectoryStates",
  "memberDirectoryMigrations",
  "memberDirectoryMigrationChunks",
  "memberDirectoryApprovals",
  "memberDirectoryApprovalConsumptions",
  "memberDirectoryWriteReceipts",
  "memberDirectoryCursorStates",
] as const);

export type CanonicalDirectoryInitializationCode =
  "already-initialized" | "not-empty" | "invalid" | "unavailable";

export class CanonicalDirectoryInitializationError extends Error {
  readonly code: CanonicalDirectoryInitializationCode;

  constructor(code: CanonicalDirectoryInitializationCode, message: string) {
    super(message);
    this.name = "CanonicalDirectoryInitializationError";
    this.code = code;
  }
}

export type CanonicalDirectoryDocuments = Readonly<{
  academyId: string;
  state: MemberDirectoryState;
  guard: MemberDirectoryRestoreGuard;
  event: MemberDirectoryGuardEvent;
}>;

export type BuildCanonicalDirectoryDocumentsInput = Readonly<{
  academyId: string;
  projectId: string;
  actorId: string;
  now: string;
  identitySecretVersion: string;
  integritySecretMaterial: string;
  integritySecretVersion: string;
}>;

function keyedMac(domain: string, value: unknown, secret: Buffer): string {
  return createHmac("sha256", secret)
    .update(encodeLengthPrefixedUtf8([domain, canonicalizeMemberDirectoryValue(value)]))
    .digest("hex");
}

/**
 * The identity baseline of a directory that holds no identity keys at all.
 *
 * Derived exactly as the artifact flow derives it, so that the two can never disagree about what an
 * empty baseline of a given project and academy is: the identifier is a hash of the binding, and
 * the MAC covers the commitment that the key count is zero under a named digest and secret version.
 */
function emptyIdentityBaseline(
  input: Readonly<{
    projectId: string;
    academyId: string;
    identitySecretVersion: string;
    integritySecret: Buffer;
  }>,
): Readonly<{ artifactId: string; baselineMac: string }> {
  const digest = createHash("sha256")
    .update(
      encodeLengthPrefixedUtf8([
        "member-directory-empty-baseline-artifact-id-v1",
        input.projectId,
        input.academyId,
      ]),
    )
    .digest("hex");
  const artifactId = `empty-baseline-${digest.slice(0, 40)}`;
  const baselineMac = keyedMac(
    "member-directory-empty-identity-baseline-v1",
    Object.freeze({
      artifactId,
      projectId: input.projectId,
      academyId: input.academyId,
      identityKeyCount: 0,
      digestVersion: "hmac-sha256-v1",
      identitySecretVersion: input.identitySecretVersion,
      schemaVersion: "1",
    }),
    input.integritySecret,
  );
  return Object.freeze({ artifactId, baselineMac });
}

/**
 * The three documents an empty canonical directory is made of, built together so that a partial
 * set can never be assembled: the state the readers and the writer consult, the restore guard the
 * writer also insists on, and the guard's genesis event that fixes the MAC chain at revision zero.
 */
export function buildCanonicalDirectoryDocuments(
  input: BuildCanonicalDirectoryDocumentsInput,
): CanonicalDirectoryDocuments {
  let baseline: Readonly<{ artifactId: string; baselineMac: string }>;
  try {
    const integritySecret = decodeMemberDirectorySecret(
      input.integritySecretMaterial,
      "initializer integrity",
    );
    // A secret of one repeated byte is an unset secret wearing a secret's shape. The emulator
    // initializer refuses it and so does this: a MAC computed with it would look like proof and
    // be worth nothing, and the state document it lands in is the directory's integrity anchor.
    if (integritySecret.every((byte) => byte === integritySecret[0])) {
      throw new Error("Integrity secret carries no entropy");
    }
    baseline = emptyIdentityBaseline({
      projectId: input.projectId,
      academyId: input.academyId,
      identitySecretVersion: input.identitySecretVersion,
      integritySecret,
    });
  } catch {
    throw new CanonicalDirectoryInitializationError(
      "invalid",
      "Member directory identity baseline could not be derived",
    );
  }

  let state: MemberDirectoryState;
  try {
    state = memberDirectoryStateSchema.parse({
      stateId: "current",
      academyId: input.academyId,
      readerVersion: "canonical-v1",
      directoryWriteMode: "canonical-v1",
      freezeStatus: "open",
      stateRevision: 0,
      globalLegacyReadEliminated: false,
      identityKeyCoverage: "complete",
      digestVersion: "hmac-sha256-v1",
      secretVersion: input.identitySecretVersion,
      identityKeyBaselineMac: baseline.baselineMac,
      identityKeyBaselineArtifactId: baseline.artifactId,
      rollbackProtocolVersion: "legacy-projection-v1",
      rollbackCapacityLimit: 400,
      rollbackEligibleStudentCount: 0,
      operationPhase: "idle",
      lastCommittedChunkNo: 0,
      schemaVersion: "1",
      createdAt: input.now,
      createdBy: input.actorId,
      updatedAt: input.now,
      updatedBy: input.actorId,
    });
  } catch {
    throw new CanonicalDirectoryInitializationError(
      "invalid",
      "Member directory state could not be built",
    );
  }

  let control: Readonly<{ guard: MemberDirectoryRestoreGuard; event: MemberDirectoryGuardEvent }>;
  try {
    control = buildInitialMemberDirectoryControlPlane({
      projectId: input.projectId,
      state,
      now: input.now,
      actorId: input.actorId,
      integritySecretMaterial: input.integritySecretMaterial,
      integritySecretVersion: input.integritySecretVersion,
    });
  } catch {
    throw new CanonicalDirectoryInitializationError(
      "invalid",
      "Member directory control plane could not be built",
    );
  }

  return Object.freeze({
    academyId: input.academyId,
    state,
    guard: control.guard,
    event: control.event,
  });
}

export type CanonicalDirectoryInitializationStore = Readonly<{
  /**
   * Creates the three documents and the audit event in one transaction, create-only, after
   * re-reading every precondition inside it. Returns `already-initialized` rather than throwing
   * when the state document is already there, so that a second click is not an incident.
   */
  initializeAtomically(
    input: Readonly<{
      documents: CanonicalDirectoryDocuments;
      actorId: string;
      auditAction: typeof initializationActorAction;
    }>,
  ): Promise<Readonly<{ alreadyInitialized: boolean }>>;
}>;

export type CanonicalDirectoryInitializationService = Readonly<{
  initialize(
    input: Readonly<{
      academyId: string;
      actorId: string;
      now: string;
    }>,
  ): Promise<Readonly<{ alreadyInitialized: boolean }>>;
}>;

export type CanonicalDirectoryInitializationDependencies = Readonly<{
  store: CanonicalDirectoryInitializationStore;
  projectId: string;
  identitySecretVersion: string;
  integritySecretMaterial: string;
  integritySecretVersion: string;
}>;

export function createCanonicalDirectoryInitializationService(
  dependencies: CanonicalDirectoryInitializationDependencies,
): CanonicalDirectoryInitializationService {
  return Object.freeze({
    async initialize(input) {
      const documents = buildCanonicalDirectoryDocuments({
        academyId: input.academyId,
        projectId: dependencies.projectId,
        actorId: input.actorId,
        now: input.now,
        identitySecretVersion: dependencies.identitySecretVersion,
        integritySecretMaterial: dependencies.integritySecretMaterial,
        integritySecretVersion: dependencies.integritySecretVersion,
      });
      return dependencies.store.initializeAtomically({
        documents,
        actorId: input.actorId,
        auditAction: initializationActorAction,
      });
    },
  });
}

export { initializationActorAction };
