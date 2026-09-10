import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import { memberDirectoryDryRunClassifications } from "@bpt-jersey/domain/members/directory-migration";
import { planMemberDirectoryAcquisition } from "@bpt-jersey/domain/members/directory-transitions";
import { beforeEach, describe, expect, it } from "vitest";

import {
  runMemberDirectoryBootstrapCompletion,
  runMemberDirectoryBootstrapVerification,
  type MemberDirectoryBootstrapBaselineArtifact,
  type MemberDirectoryBootstrapClosureControlPlane,
  type MemberDirectoryBootstrapClosureDependencies,
  type MemberDirectoryBootstrapClosureStore,
  type MemberDirectoryBootstrapCompletionWrite,
  type MemberDirectoryBootstrapVerificationWrite,
} from "./member-directory-bootstrap-closure-runner.js";
import {
  buildStudentIdentityKey,
  buildStudentIdentityKeyTuple,
  createMemberDirectoryIdentityBaselineMac,
  type StudentIdentityKey,
} from "./member-directory-crypto.js";
import {
  advanceMemberDirectoryControlPlane,
  buildInitialMemberDirectoryControlPlane,
} from "./member-directory-state.js";

/**
 * The closure runner's rules (T108, slice 9). The Emulator rehearsal proves the transactions land;
 * these prove what may reach a transaction at all.
 */

const projectId = "demo-bpt-jersey";
const academyId = "academy-closure";
const operationId = "op-bootstrap-closure";
const artifactId = "artifact-bootstrap-closure";
const actorId = "closure-runner";
const identitySecretMaterial = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const integritySecretVersion = "integrity-v1";
const identitySecretVersion = "identity-v1";
const initializedAt = "2026-09-07T11:00:00.000Z";
const acquiredAt = "2026-09-07T12:00:00.000Z";
const closedAt = "2026-09-07T12:01:00.000Z";
const afterLeaseExpiry = "2026-09-07T12:30:00.000Z";
const operationDeadline = "2026-09-07T12:25:00.000Z";

function baselineState(): MemberDirectoryState {
  return {
    stateId: "current",
    academyId,
    readerVersion: "legacy-v1",
    directoryWriteMode: "legacy-v1",
    freezeStatus: "open",
    stateRevision: 0,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "incomplete",
    digestVersion: "hmac-sha256-v1",
    secretVersion: identitySecretVersion,
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: 0,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: initializedAt,
    createdBy: actorId,
    updatedAt: initializedAt,
    updatedBy: actorId,
  };
}

/** The frozen bootstrap control plane a closure runs against, at revision 1. */
function frozenControlPlane() {
  const baseline = baselineState();
  const initial = buildInitialMemberDirectoryControlPlane({
    projectId,
    state: baseline,
    now: initializedAt,
    actorId,
    integritySecretMaterial,
    integritySecretVersion,
  });
  const acquired = planMemberDirectoryAcquisition({
    currentState: baseline,
    phase: "bootstrap",
    operationId,
    leaseId: `lease-${operationId}`,
    leaseOwner: actorId,
    operationDeadline,
    now: acquiredAt,
    actorId,
  });
  const advanced = advanceMemberDirectoryControlPlane({
    projectId,
    state: baseline,
    guard: initial.guard,
    event: initial.event,
    nextState: acquired,
    operationId,
    transitionKind: "identity-key-bootstrap",
    now: acquiredAt,
    actorId,
    integritySecretMaterial,
    integritySecretVersion,
  });
  return { state: acquired, guard: advanced.guard, event: advanced.event };
}

function identityKey(studentId: string, membershipNumber: string): StudentIdentityKey {
  return buildStudentIdentityKey({
    academyId,
    kind: "membership-number",
    value: membershipNumber,
    ownerStudentId: studentId,
    secretMaterial: identitySecretMaterial,
    secretVersion: identitySecretVersion,
    now: acquiredAt,
    actorId,
  });
}

const firstKey = identityKey("student-4001", "BPT 4001");
const secondKey = identityKey("student-4002", "BPT 4002");

function baselineMac(keys: readonly StudentIdentityKey[]): string {
  return createMemberDirectoryIdentityBaselineMac({
    academyId,
    operationId,
    secretVersion: identitySecretVersion,
    tuples: keys.map(buildStudentIdentityKeyTuple),
    secretMaterial: integritySecretMaterial,
  });
}

function receipt(chunkNo: number): Readonly<Record<string, unknown>> {
  return {
    chunkId: `${operationId}:bootstrap:${String(chunkNo)}`,
    operationId,
    academyId,
    phase: "bootstrap",
    chunkNo,
    status: "committed",
    outputSetMac: "a".repeat(64),
    writtenCount: 1,
    quarantinedCount: 0,
    integrityMacVersion: "hmac-sha256-v1",
    integritySecretVersion,
    schemaVersion: "1",
    createdAt: acquiredAt,
    createdBy: actorId,
  };
}

function operationDocument(
  status: string,
  identityKeyBaselineMac: string,
): Readonly<Record<string, unknown>> {
  return {
    operationId,
    academyId,
    operationType: "identity-key-bootstrap",
    status,
    receipt: {
      operationId,
      academyId,
      phase: "bootstrap",
      targetProjectClassification: "emulator",
      codeVersion: "8680f7c",
      schemaVersion: "1",
      effectiveDate: initializedAt,
      expiresAt: "2026-09-07T13:00:00.000Z",
      sourceMac: "b".repeat(64),
      privateManifestMac: "c".repeat(64),
      planMac: "d".repeat(64),
      digestVersion: "hmac-sha256-v1",
      secretVersion: identitySecretVersion,
      identityKeyBaselineMac,
      expectedOutputSetMacRoots: ["e".repeat(64)],
      classificationCounts: Object.fromEntries(
        memberDirectoryDryRunClassifications.map((classification) => [classification, 0]),
      ),
      preExistingAdmittedStudentCount: 2,
      plannedNewStudentCount: 0,
      postCutoverAdmittedStudentCount: 2,
      maximumApprovedRows: 400,
      integrityMacVersion: "hmac-sha256-v1",
      integritySecretVersion,
      operationWriteTime: initializedAt,
      createdAt: initializedAt,
      createdBy: actorId,
    },
    statusAuditEventId: "1",
    statusChangedAt: acquiredAt,
    statusChangedBy: actorId,
    schemaVersion: "1",
    createdAt: initializedAt,
    createdBy: actorId,
  };
}

function artifact(
  overrides: Partial<MemberDirectoryBootstrapBaselineArtifact> = {},
): MemberDirectoryBootstrapBaselineArtifact {
  return {
    artifactId,
    academyId,
    operationId,
    secretVersion: identitySecretVersion,
    identityKeyBaselineMac: baselineMac([firstKey, secondKey]),
    chunks: [
      { chunkNo: 1, expectedKeyTuples: [buildStudentIdentityKeyTuple(firstKey)] },
      { chunkNo: 2, expectedKeyTuples: [buildStudentIdentityKeyTuple(secondKey)] },
    ],
    ...overrides,
  };
}

type Recorded = {
  verifications: MemberDirectoryBootstrapVerificationWrite[];
  completions: MemberDirectoryBootstrapCompletionWrite[];
};

let recorded: Recorded;

beforeEach(() => {
  recorded = { verifications: [], completions: [] };
});

function dependencies(
  options: Readonly<{
    controlPlane?: Partial<MemberDirectoryBootstrapClosureControlPlane>;
    artifact?: MemberDirectoryBootstrapBaselineArtifact;
    now?: string;
    status?: string;
    operationBaselineMac?: string;
  }> = {},
): MemberDirectoryBootstrapClosureDependencies {
  const plane = frozenControlPlane();
  const chosenArtifact = options.artifact ?? artifact();
  const store: MemberDirectoryBootstrapClosureStore = {
    read: async () =>
      Object.freeze({
        state: plane.state,
        guard: plane.guard,
        event: plane.event,
        operation: operationDocument(
          options.status ?? "applying",
          options.operationBaselineMac ?? chosenArtifact.identityKeyBaselineMac,
        ),
        receipts: [receipt(1), receipt(2)],
        identityKeys: new Map<string, unknown>([
          [firstKey.keyId, firstKey],
          [secondKey.keyId, secondKey],
        ]),
        ...options.controlPlane,
      }),
    commitVerification: async (write) => {
      recorded.verifications.push(write);
    },
    commitCompletion: async (write) => {
      recorded.completions.push(write);
    },
  };
  return {
    projectId,
    store,
    artifacts: { open: async () => chosenArtifact },
    integritySecretMaterial,
    integritySecretVersion,
    now: () => options.now ?? closedAt,
  };
}

const request = { academyId, operationId, actorId };

describe("member directory bootstrap verification transaction", () => {
  it("proves the baseline from the stored reservations and moves only the parent", async () => {
    const result = await runMemberDirectoryBootstrapVerification(dependencies(), request);

    expect(result.moved).toBe(true);
    expect(result.verification?.identityCount).toBe(2);
    expect(result.verification?.chunkCount).toBe(2);
    expect(result.verification?.writtenCount).toBe(2);

    expect(recorded.completions).toHaveLength(0);
    const write = recorded.verifications[0];
    expect(write).toBeDefined();
    expect(write?.operation.status).toBe("verified");
    // Filed against the exact control-plane position the proof was established on.
    expect(write?.expectedStateRevision).toBe(1);
    expect(write?.operation.statusAuditEventId).toBe("1");
  });

  it("is a no-op when the operation is already verified", async () => {
    const result = await runMemberDirectoryBootstrapVerification(
      dependencies({ status: "verified" }),
      request,
    );

    expect(result.moved).toBe(false);
    expect(result.reason).toMatch(/already verified/u);
    // The proof is still established: a resume must know the baseline still holds, not assume it.
    expect(result.verification?.identityCount).toBe(2);
    expect(recorded.verifications).toHaveLength(0);
  });

  it("refuses when a reservation the artifact expects does not exist", async () => {
    await expect(
      runMemberDirectoryBootstrapVerification(
        dependencies({
          controlPlane: { identityKeys: new Map<string, unknown>([[firstKey.keyId, firstKey]]) },
        }),
        request,
      ),
    ).rejects.toThrow(/does not exist/u);
  });

  it("refuses when a stored reservation was reassigned to another student", async () => {
    const reassigned = { ...secondKey, ownerStudentId: "student-9999" };
    await expect(
      runMemberDirectoryBootstrapVerification(
        dependencies({
          controlPlane: {
            identityKeys: new Map<string, unknown>([
              [firstKey.keyId, firstKey],
              [secondKey.keyId, reassigned],
            ]),
          },
        }),
        request,
      ),
      // The owner is part of the tuple, so this dies on the baseline comparison rather than on a
      // second guard that would have to be kept in step with it.
    ).rejects.toThrow(/does not match its artifact/u);
  });

  it("refuses a stored reservation filed under another academy", async () => {
    const foreign = { ...secondKey, academyId: "academy-other" };
    await expect(
      runMemberDirectoryBootstrapVerification(
        dependencies({
          controlPlane: {
            identityKeys: new Map<string, unknown>([
              [firstKey.keyId, firstKey],
              [secondKey.keyId, foreign],
            ]),
          },
        }),
        request,
      ),
    ).rejects.toThrow(/belongs to another academy/u);
  });

  it("refuses an artifact that is not the one the operation froze", async () => {
    await expect(
      runMemberDirectoryBootstrapVerification(
        dependencies({ operationBaselineMac: "f".repeat(64) }),
        request,
      ),
    ).rejects.toThrow(/not the one this operation froze/u);
  });

  it("refuses when a chunk the artifact planned has no committed receipt", async () => {
    await expect(
      runMemberDirectoryBootstrapVerification(
        dependencies({ controlPlane: { receipts: [receipt(1)] } }),
        request,
      ),
    ).rejects.toThrow(/do not match the chunks the artifact planned/u);
  });

  it("refuses when the artifact was frozen under another identity secret version", async () => {
    await expect(
      runMemberDirectoryBootstrapVerification(
        dependencies({ artifact: artifact({ secretVersion: "identity-v2" }) }),
        request,
      ),
    ).rejects.toThrow(/another identity secret version/u);
  });

  it("refuses an expired lease", async () => {
    await expect(
      runMemberDirectoryBootstrapVerification(dependencies({ now: afterLeaseExpiry }), request),
    ).rejects.toThrow(/live lease/u);
  });
});

describe("member directory bootstrap completion transaction", () => {
  it("re-establishes the proof and hands the directory back at the pre-cutover tuple", async () => {
    const result = await runMemberDirectoryBootstrapCompletion(
      dependencies({ status: "verified" }),
      request,
    );

    expect(result.moved).toBe(true);
    const write = recorded.completions[0];
    expect(write).toBeDefined();
    expect(write?.nextState.identityKeyCoverage).toBe("complete");
    expect(write?.nextState.identityKeyBaselineMac).toBe(
      result.verification?.identityKeyBaselineMac,
    );
    expect(write?.nextState.identityKeyBaselineArtifactId).toBe(artifactId);
    expect(write?.nextState.readerVersion).toBe("legacy-v1");
    expect(write?.nextState.directoryWriteMode).toBe("legacy-v1");
    expect(write?.nextState.freezeStatus).toBe("open");
    expect(write?.nextState.activeOperationId).toBeUndefined();
    expect(write?.nextState.leaseId).toBeUndefined();
    expect(write?.nextState.stateRevision).toBe(2);
    // The parent's completion is bound to the very event this transaction writes.
    expect(write?.operation.status).toBe("completed");
    expect(write?.operation.statusAuditEventId).toBe(write?.event.eventId);
    expect(write?.event.eventId).toBe("2");
    expect(write?.event.transitionKind).toBe("identity-key-bootstrap");
  });

  it("is a no-op when the operation is already completed", async () => {
    const result = await runMemberDirectoryBootstrapCompletion(
      dependencies({ status: "completed" }),
      request,
    );

    expect(result.moved).toBe(false);
    expect(result.reason).toMatch(/already completed/u);
    // No proof comes back, and that is the honest answer: completion opened the freeze and cleared
    // the lease, so there is no frozen bootstrap left for a proof to be about.
    expect(result.verification).toBeUndefined();
    expect(recorded.completions).toHaveLength(0);
  });

  it("refuses to complete a parent that was never verified", async () => {
    await expect(
      runMemberDirectoryBootstrapCompletion(dependencies({ status: "applying" }), request),
    ).rejects.toThrow(/applying/u);
    expect(recorded.completions).toHaveLength(0);
  });

  it("refuses an expired lease, so the clock cannot stand in for authorization", async () => {
    await expect(
      runMemberDirectoryBootstrapCompletion(
        dependencies({ status: "verified", now: afterLeaseExpiry }),
        request,
      ),
    ).rejects.toThrow(/live lease/u);
  });

  it("refuses an artifact whose chunk numbers have a hole", async () => {
    await expect(
      runMemberDirectoryBootstrapCompletion(
        dependencies({
          status: "verified",
          artifact: artifact({
            chunks: [
              { chunkNo: 1, expectedKeyTuples: [buildStudentIdentityKeyTuple(firstKey)] },
              { chunkNo: 3, expectedKeyTuples: [buildStudentIdentityKeyTuple(secondKey)] },
            ],
          }),
        }),
        request,
      ),
    ).rejects.toThrow(/without gaps/u);
  });

  it("refuses an artifact that claims one reservation under two chunks", async () => {
    await expect(
      runMemberDirectoryBootstrapCompletion(
        dependencies({
          status: "verified",
          artifact: artifact({
            chunks: [
              { chunkNo: 1, expectedKeyTuples: [buildStudentIdentityKeyTuple(firstKey)] },
              { chunkNo: 2, expectedKeyTuples: [buildStudentIdentityKeyTuple(firstKey)] },
            ],
          }),
        }),
        request,
      ),
    ).rejects.toThrow(/one reservation under two chunks/u);
  });
});
