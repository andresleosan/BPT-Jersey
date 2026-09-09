import {
  memberDirectoryStateSchema,
  type MemberDirectoryState,
} from "@bpt-jersey/domain/members/directory";
import {
  memberDirectoryOperationDocumentSchema,
  type MemberDirectoryOperationDocument,
} from "@bpt-jersey/domain/members/directory-operations";
import { planMemberDirectoryAcquisition } from "@bpt-jersey/domain/members/directory-transitions";
import { describe, expect, it } from "vitest";

import {
  runMemberDirectoryForwardCutover,
  runMemberDirectoryForwardVerification,
  type MemberDirectoryForwardClosureDependencies,
  type MemberDirectoryForwardCutoverWrite,
  type MemberDirectoryForwardVerificationWrite,
} from "./member-directory-forward-closure-runner.js";
import {
  planMemberDirectoryForwardDryRun,
  type MemberDirectoryForwardDryRun,
} from "./member-directory-forward-dry-run.js";
import {
  advanceMemberDirectoryControlPlane,
  buildInitialMemberDirectoryControlPlane,
} from "./member-directory-state.js";

const projectId = "demo-bpt-jersey";
const academyId = "academy-bpt-jersey";
const identitySecretMaterial = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const identitySecretVersion = "identity-v1";
const integritySecretVersion = "integrity-v1";
const operationId = "op-forward-1";
const baselineMac = "a".repeat(64);
const operationWriteTime = "2026-09-08T12:00:00.000Z";
const acquiredAt = "2026-09-08T12:00:30.000Z";
const now = "2026-09-08T12:01:00.000Z";

const legacyIds = ["LEGACY-4001", "LEGACY-4002"] as const;

function legacyMember(memberId: string): Readonly<Record<string, unknown>> {
  return {
    memberId,
    academyId,
    membershipNumber: `BPT ${memberId.slice(-4)}`,
    fullName: "Synthetic Legacy Member",
    email: `${memberId.toLowerCase()}@example.test`,
    birthDate: "1990-04-05",
    mobileNumber: "+441534000401",
    frequency: "Twice a week",
    paymentStatus: "regularized",
    gender: "unknown",
    trainingCenter: "Town",
    membershipStatus: "active",
    createdAt: "2026-01-02T00:00:00.000Z",
    createdBy: "system",
    updatedAt: "2026-01-02T00:00:00.000Z",
    updatedBy: "system",
    source: "member-pdf-import",
    schemaVersion: "1",
  };
}

/** The frozen artifacts, produced by the real dry-run so the proof has something true to check. */
function frozenArtifacts(): MemberDirectoryForwardDryRun {
  const minted = ["student-minted-1", "student-minted-2"];
  return planMemberDirectoryForwardDryRun(
    {
      academyId,
      operationId,
      manifestId: "manifest-1",
      planId: "plan-1",
      targetProjectClassification: "emulator",
      codeVersion: "code-1",
      sourceRows: legacyIds.map((legacyMemberId) => ({
        legacyMemberId,
        document: legacyMember(legacyMemberId),
      })),
      existingStudents: [],
      existingAdminProfiles: [],
      existingIdentityKeys: [],
      existingFamilies: [],
      existingRelationships: [],
      stateAdmittedStudentCount: 0,
      identityKeyBaselineMac: baselineMac,
      maximumApprovedRows: 400,
      effectiveDate: operationWriteTime,
      expiresAt: "2026-09-09T12:00:00.000Z",
      operationWriteTime,
      createdAt: operationWriteTime,
      manifestPreparedAt: "2026-09-08T11:00:00.000Z",
      manifestExpiresAt: "2026-09-09T11:00:00.000Z",
      actorId: "operator",
      decisions: legacyIds.map((legacyMemberId) => ({
        legacyMemberId,
        decision: "create" as const,
        trainingTimePreferences: ["evening"] as const,
      })),
    },
    {
      identitySecretMaterial,
      identitySecretVersion,
      integritySecretMaterial,
      integritySecretVersion,
      mintTargetStudentId: () => {
        const next = minted.shift();
        if (next === undefined) throw new Error("the test ran out of minted student IDs");
        return next;
      },
    },
  );
}

const artifacts = frozenArtifacts();

function stableState(): MemberDirectoryState {
  return memberDirectoryStateSchema.parse({
    stateId: "current",
    academyId,
    readerVersion: "legacy-v1",
    directoryWriteMode: "legacy-v1",
    freezeStatus: "open",
    stateRevision: 0,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "complete",
    identityKeyBaselineMac: baselineMac,
    identityKeyBaselineArtifactId: "artifact-baseline-1",
    digestVersion: "hmac-sha256-v1",
    secretVersion: identitySecretVersion,
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: 0,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "system",
    updatedAt: "2026-09-01T00:00:00.000Z",
    updatedBy: "system",
  });
}

function frozenControlPlane(stateOverrides: Readonly<Record<string, unknown>> = {}): Readonly<{
  state: MemberDirectoryState;
  guard: unknown;
  event: unknown;
}> {
  const stable = stableState();
  const initial = buildInitialMemberDirectoryControlPlane({
    projectId,
    state: stable,
    now: "2026-09-01T00:00:00.000Z",
    actorId: "system",
    integritySecretMaterial,
    integritySecretVersion,
  });
  const acquired = planMemberDirectoryAcquisition({
    currentState: stable,
    phase: "forward",
    operationId,
    leaseId: "lease-1",
    leaseOwner: "runner-a",
    operationDeadline: "2026-09-08T12:25:00.000Z",
    now: acquiredAt,
    actorId: "runner-a",
  });
  const advanced = advanceMemberDirectoryControlPlane({
    projectId,
    state: stable,
    guard: initial.guard,
    event: initial.event,
    nextState: acquired,
    operationId,
    transitionKind: "directory-forward",
    now: acquiredAt,
    actorId: "runner-a",
    integritySecretMaterial,
    integritySecretVersion,
  });
  return {
    state: memberDirectoryStateSchema.parse({
      ...acquired,
      lastCommittedChunkNo: artifacts.plan.chunks.length,
      ...stateOverrides,
    }),
    guard: advanced.guard,
    event: advanced.event,
  };
}

function operationDocument(
  overrides: Readonly<Record<string, unknown>> = {},
): MemberDirectoryOperationDocument {
  return memberDirectoryOperationDocumentSchema.parse({
    operationId,
    academyId,
    operationType: "directory-forward",
    status: "applying",
    receipt: artifacts.receipt,
    statusAuditEventId: "audit-1",
    statusChangedAt: acquiredAt,
    statusChangedBy: "runner-a",
    schemaVersion: "1",
    createdAt: operationWriteTime,
    createdBy: "operator",
    ...overrides,
  });
}

/** One committed receipt per planned chunk, carrying the root the plan froze. */
function committedReceipts(overrides: Readonly<Record<string, unknown>> = {}): readonly unknown[] {
  return artifacts.plan.chunks.map((chunk) => ({
    chunkId: `${operationId}:forward:${String(chunk.chunkNo)}`,
    operationId,
    academyId,
    phase: "forward",
    chunkNo: chunk.chunkNo,
    status: "committed",
    outputSetMac: chunk.expectedOutputSetMac,
    writtenCount: chunk.sourceLegacyIds.length,
    quarantinedCount: 0,
    integrityMacVersion: "hmac-sha256-v1",
    integritySecretVersion,
    schemaVersion: "1",
    createdAt: "2026-09-08T12:00:45.000Z",
    createdBy: "runner-a",
    ...overrides,
  }));
}

type Harness = Readonly<{
  dependencies: MemberDirectoryForwardClosureDependencies;
  verifications: MemberDirectoryForwardVerificationWrite[];
  cutovers: MemberDirectoryForwardCutoverWrite[];
}>;

function harness(
  options: Readonly<{
    state?: Readonly<Record<string, unknown>>;
    operation?: Readonly<Record<string, unknown>>;
    receipts?: readonly unknown[];
    admittedStudentCount?: number;
    plan?: unknown;
  }> = {},
): Harness {
  const plane = frozenControlPlane(options.state ?? {});
  const verifications: MemberDirectoryForwardVerificationWrite[] = [];
  const cutovers: MemberDirectoryForwardCutoverWrite[] = [];
  return {
    verifications,
    cutovers,
    dependencies: {
      projectId,
      integritySecretMaterial,
      integritySecretVersion,
      now: () => now,
      artifacts: {
        open: () =>
          Promise.resolve({
            manifest: artifacts.manifest,
            plan: options.plan ?? artifacts.plan,
          }),
      },
      store: {
        read: () =>
          Promise.resolve({
            state: plane.state,
            guard: plane.guard,
            event: plane.event,
            operation: operationDocument(options.operation ?? {}),
            receipts: options.receipts ?? committedReceipts(),
            admittedStudentCount:
              options.admittedStudentCount ?? artifacts.receipt.postCutoverAdmittedStudentCount,
          }),
        commitVerification: (write) => {
          verifications.push(write);
          return Promise.resolve();
        },
        commitCutover: (write) => {
          cutovers.push(write);
          return Promise.resolve();
        },
      },
    },
  };
}

const request = { academyId, operationId, actorId: "runner-b" } as const;

describe("member directory forward verification", () => {
  it("proves the migration and moves only the parent", async () => {
    const { dependencies, verifications, cutovers } = harness();

    const result = await runMemberDirectoryForwardVerification(dependencies, request);

    expect(result.moved).toBe(true);
    expect(result.proof).toMatchObject({
      chunkCount: 1,
      writtenRowCount: 2,
      postCutoverAdmittedStudentCount: 2,
      planMac: artifacts.receipt.planMac,
    });
    expect(verifications).toHaveLength(1);
    expect(verifications[0]?.operation.status).toBe("verified");
    // The state stays legacy, blocked and frozen: this transaction writes the parent alone.
    expect(cutovers).toEqual([]);
  });

  it("files the parent against the control-plane position the proof was made at", async () => {
    const { dependencies, verifications } = harness();

    await runMemberDirectoryForwardVerification(dependencies, request);

    expect(verifications[0]?.expectedStateRevision).toBe(1);
    expect(verifications[0]?.expectedEventMac).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("refuses a chunk that committed an output its plan did not freeze", async () => {
    const { dependencies } = harness({
      receipts: committedReceipts({ outputSetMac: "b".repeat(64) }),
    });

    await expect(runMemberDirectoryForwardVerification(dependencies, request)).rejects.toThrow(
      /committed an output its plan did not freeze/u,
    );
  });

  it("refuses when a planned chunk never committed", async () => {
    const { dependencies } = harness({ receipts: [] });

    await expect(runMemberDirectoryForwardVerification(dependencies, request)).rejects.toThrow(
      /do not match the chunks the plan froze/u,
    );
  });

  it("refuses a receipt from another phase of the same operation", async () => {
    const { dependencies } = harness({
      receipts: committedReceipts({
        phase: "compensation",
        chunkId: `${operationId}:compensation:1`,
        sourceForwardChunkNo: 1,
      }),
    });

    await expect(runMemberDirectoryForwardVerification(dependencies, request)).rejects.toThrow(
      /does not belong to this operation's forward phase/u,
    );
  });

  it("refuses a chunk that wrote a different number of rows than planned", async () => {
    const { dependencies } = harness({ receipts: committedReceipts({ writtenCount: 1 }) });

    await expect(runMemberDirectoryForwardVerification(dependencies, request)).rejects.toThrow(
      /a different number of rows than planned/u,
    );
  });

  it("refuses a chunk that quarantined rows, which forward never does", async () => {
    const { dependencies } = harness({ receipts: committedReceipts({ quarantinedCount: 1 }) });

    await expect(runMemberDirectoryForwardVerification(dependencies, request)).rejects.toThrow(
      /quarantined rows, which forward never does/u,
    );
  });

  it("refuses when the directory holds a different number of students than planned", async () => {
    const { dependencies } = harness({ admittedStudentCount: 3 });

    await expect(runMemberDirectoryForwardVerification(dependencies, request)).rejects.toThrow(
      /a different number of students than the plan predicted/u,
    );
  });

  it("answers 'already verified' with the proof rather than auditing the move twice", async () => {
    const { dependencies, verifications } = harness({ operation: { status: "verified" } });

    const result = await runMemberDirectoryForwardVerification(dependencies, request);

    expect(result.moved).toBe(false);
    expect(result.reason).toMatch(/already verified/u);
    expect(result.proof).toBeDefined();
    expect(verifications).toEqual([]);
  });
});

describe("member directory forward cutover", () => {
  it("switches the reader, releases the freeze and completes the parent in one transaction", async () => {
    const { dependencies, cutovers } = harness({ operation: { status: "verified" } });

    const result = await runMemberDirectoryForwardCutover(dependencies, request);

    expect(result.moved).toBe(true);
    expect(cutovers).toHaveLength(1);
    expect(cutovers[0]?.nextState).toMatchObject({
      readerVersion: "canonical-v1",
      directoryWriteMode: "canonical-v1",
      freezeStatus: "open",
      operationPhase: "idle",
      globalLegacyReadEliminated: false,
      rollbackEligibleStudentCount: 2,
    });
    expect(cutovers[0]?.nextState).not.toHaveProperty("leaseId");
    expect(cutovers[0]?.operation.status).toBe("completed");
    // One audit entry for the reader switch and the parent's completion, not two to correlate.
    expect(cutovers[0]?.operation.statusAuditEventId).toBe(cutovers[0]?.event.eventId);
  });

  it("refuses to cut over an operation that was never verified", async () => {
    const { dependencies, cutovers } = harness();

    await expect(runMemberDirectoryForwardCutover(dependencies, request)).rejects.toThrow(
      /requires a verified operation/u,
    );
    expect(cutovers).toEqual([]);
  });

  it("re-establishes the proof rather than trusting the verified parent it found", async () => {
    // A parent marked verified over receipts that no longer prove anything must not cut over: the
    // completion transaction is where a crash between the two halves resumes.
    const { dependencies } = harness({
      operation: { status: "verified" },
      receipts: committedReceipts({ outputSetMac: "b".repeat(64) }),
    });

    await expect(runMemberDirectoryForwardCutover(dependencies, request)).rejects.toThrow(
      /committed an output its plan did not freeze/u,
    );
  });

  it("answers 'already completed' without a proof", async () => {
    // Completion opened the freeze and cleared the lease, so there is no frozen plan left for a
    // proof to be about - which is why this is the one outcome that carries none.
    const { dependencies, cutovers } = harness({ operation: { status: "completed" } });

    const result = await runMemberDirectoryForwardCutover(dependencies, request);

    expect(result.moved).toBe(false);
    expect(result.reason).toMatch(/already completed/u);
    expect(result.proof).toBeUndefined();
    expect(cutovers).toEqual([]);
  });

  it("refuses once the lease has expired", async () => {
    const { dependencies } = harness({
      operation: { status: "verified" },
      state: { leaseExpiresAt: "2026-09-08T12:00:59.000Z" },
    });

    await expect(runMemberDirectoryForwardCutover(dependencies, request)).rejects.toThrow(
      /requires a live lease/u,
    );
  });
});
