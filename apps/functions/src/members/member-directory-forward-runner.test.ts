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
  createMemberDirectoryPrivatePlanMac,
  createMemberDirectorySourceSetMac,
} from "./member-directory-crypto.js";

import type {
  MemberDirectoryChunkCommitWrite,
  MemberDirectoryChunkStore,
} from "./member-directory-chunk-runner.js";
import {
  planMemberDirectoryForwardDryRun,
  type MemberDirectoryForwardDryRun,
} from "./member-directory-forward-dry-run.js";
import {
  assertMemberDirectoryForwardBaseline,
  runMemberDirectoryForwardChunk,
  type MemberDirectoryForwardChunkDocuments,
  type MemberDirectoryForwardRunnerDependencies,
} from "./member-directory-forward-runner.js";
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

const legacyIds = ["LEGACY-4001", "LEGACY-4002"] as const;

/**
 * The frozen artifacts are produced by the dry-run itself rather than written by hand.
 *
 * A hand-made manifest would have to reproduce every MAC the runner checks, and would pass the
 * moment the fixture and the runner agreed with each other - which is exactly the property under
 * test. Building them with the real producer makes this an end-to-end of slices 13 and 14.
 */
function frozenArtifacts(forOperationId: string = operationId): MemberDirectoryForwardDryRun {
  const minted = ["student-minted-1", "student-minted-2"];
  return planMemberDirectoryForwardDryRun(
    {
      academyId,
      operationId: forOperationId,
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
const otherArtifacts = frozenArtifacts("op-forward-2");

function stableState(overrides: Readonly<Record<string, unknown>> = {}): MemberDirectoryState {
  return memberDirectoryStateSchema.parse({
    stateId: "current",
    academyId,
    readerVersion: "legacy-v1",
    directoryWriteMode: "legacy-v1",
    freezeStatus: "open",
    stateRevision: 0,
    globalLegacyReadEliminated: false,
    // The forward operation runs on a tenant whose identity-key bootstrap already completed.
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
    ...overrides,
  });
}

/** A real frozen-forward control plane, acquired through the same functions production uses. */
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
    state: memberDirectoryStateSchema.parse({ ...acquired, ...stateOverrides }),
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
    status: "frozen",
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

function emptyDocuments(): MemberDirectoryForwardChunkDocuments {
  return {
    sourceRows: new Map(legacyIds.map((id) => [id, legacyMember(id)])),
    students: new Map(),
    adminProfiles: new Map(),
    families: new Map(),
    relationships: new Map(),
    identityKeys: new Map(),
  };
}

type Harness = Readonly<{
  dependencies: MemberDirectoryForwardRunnerDependencies;
  writes: MemberDirectoryChunkCommitWrite[];
  reads: { request?: unknown };
}>;

function harness(
  options: Readonly<{
    state?: Readonly<Record<string, unknown>>;
    operation?: Readonly<Record<string, unknown>>;
    documents?: MemberDirectoryForwardChunkDocuments;
    manifest?: unknown;
    plan?: unknown;
  }> = {},
): Harness {
  const plane = frozenControlPlane(options.state ?? {});
  const writes: MemberDirectoryChunkCommitWrite[] = [];
  const reads: { request?: unknown } = {};
  const chunkStore: MemberDirectoryChunkStore = {
    read: () =>
      Promise.resolve({
        state: plane.state,
        guard: plane.guard,
        event: plane.event,
        operation: operationDocument(options.operation ?? {}),
        priorRowCount: 0,
      }),
    commit: (write) => {
      writes.push(write);
      return Promise.resolve();
    },
  };

  return {
    writes,
    reads,
    dependencies: {
      controlPlane: {
        read: () =>
          Promise.resolve({
            state: plane.state,
            guard: plane.guard,
            event: plane.event,
            operation: operationDocument(options.operation ?? {}),
          }),
      },
      artifacts: {
        open: () =>
          Promise.resolve({
            manifest: options.manifest ?? artifacts.manifest,
            plan: options.plan ?? artifacts.plan,
          }),
      },
      documents: {
        read: (request) => {
          reads.request = request;
          return Promise.resolve(options.documents ?? emptyDocuments());
        },
      },
      chunkRunner: {
        projectId,
        store: chunkStore,
        integritySecretMaterial,
        integritySecretVersion,
        now: () => now,
      },
      identitySecretMaterial,
      identitySecretVersion,
    },
  };
}

const request = { academyId, operationId, chunkNo: 1, actorId: "runner-b" } as const;

describe("member directory forward runner", () => {
  it("commits the chunk the frozen plan describes", async () => {
    const { dependencies, writes } = harness();

    const outcome = await runMemberDirectoryForwardChunk(dependencies, request);

    expect(outcome.committed).toBe(true);
    expect(outcome.chunkId).toBe(`${operationId}:forward:1`);
    expect(outcome.rowCount).toBe(2);
    expect(outcome.createdStudentCount).toBe(2);
    expect(outcome.createdProfileCount).toBe(2);
    // membership-number and legacy-member-id per row; no ID card or VAT on the fixture.
    expect(outcome.createdKeyCount).toBe(4);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.receipt.outputSetMac).toBe(artifacts.plan.chunks[0]?.expectedOutputSetMac);
  });

  it("reads exactly the documents the plan names, and the reservations from its own targets", async () => {
    const { dependencies, reads } = harness();

    await runMemberDirectoryForwardChunk(dependencies, request);

    expect(reads.request).toMatchObject({
      academyId,
      sourceLegacyIds: [...legacyIds],
      targetStudentIds: ["student-minted-1", "student-minted-2"],
      familyIds: [],
      relationshipIds: [],
    });
    const expectedKeyIds = (reads.request as { expectedKeyIds: readonly string[] }).expectedKeyIds;
    expect(expectedKeyIds).toHaveLength(4);
    expect(expectedKeyIds.every((keyId) => /^[a-z-]+:[a-f0-9]{64}$/u.test(keyId))).toBe(true);
  });

  it("writes documents under the actor the plan was frozen with, not the one running the chunk", async () => {
    const { dependencies, writes } = harness();

    await runMemberDirectoryForwardChunk(dependencies, request);

    const student = writes[0]?.domainWrites.find((write) =>
      write.path.includes("/students/student-minted-1"),
    );
    // The plan's content MACs cover these values, so a chunk that stamped the running actor would
    // produce a root the receipt does not approve.
    expect(student?.data).toMatchObject({ createdBy: "operator", createdAt: operationWriteTime });
    // The audit trail, by contrast, records whoever ran it.
    expect(writes[0]?.receipt.createdBy).toBe("runner-b");
  });

  it("refuses a chunk number the frozen plan does not cover", async () => {
    const { dependencies } = harness();

    await expect(
      runMemberDirectoryForwardChunk(dependencies, { ...request, chunkNo: 2 }),
    ).rejects.toThrow(/does not cover chunk 2/u);
  });

  it("refuses when the tenant stands on a different identity-key baseline", async () => {
    const { dependencies } = harness({ state: { identityKeyBaselineMac: "b".repeat(64) } });

    await expect(runMemberDirectoryForwardChunk(dependencies, request)).rejects.toThrow(
      /frozen against a different identity-key baseline/u,
    );
  });

  /**
   * The operation document's schema already binds its receipt's operation and academy to its own,
   * so a parent that half-belongs to another operation is unrepresentable. What is representable -
   * and what a store adapter could really hand back - is a whole different operation, and that is
   * what this refuses.
   */
  it("refuses a parent that is a different operation", async () => {
    const { dependencies } = harness({
      operation: { operationId: "op-forward-2", receipt: otherArtifacts.receipt },
    });

    await expect(runMemberDirectoryForwardChunk(dependencies, request)).rejects.toThrow(
      /parent operation is not this academy's directory-forward/u,
    );
  });

  it("refuses artifacts that are not the ones the receipt was frozen against", async () => {
    const tampered = {
      ...artifacts.manifest,
      rows: artifacts.manifest.rows.map((row, index) =>
        index === 0 ? { ...row, targetStudentId: "student-substituted-1" } : row,
      ),
    };
    const { dependencies } = harness({ manifest: tampered });

    await expect(runMemberDirectoryForwardChunk(dependencies, request)).rejects.toThrow(
      /not the one this receipt was frozen against/u,
    );
  });

  it("refuses a chunk whose output no longer matches the root its plan froze", async () => {
    // The source row changed since the review: same shape, later `updatedAt`. The executor catches
    // it on `sourceRowMac`, which is the layer below the root comparison.
    const drifted = emptyDocuments();
    const changed = {
      ...legacyMember("LEGACY-4001"),
      updatedAt: "2026-09-08T09:00:00.000Z",
    };
    const documents = { ...drifted, sourceRows: new Map(drifted.sourceRows) };
    documents.sourceRows.set("LEGACY-4001", changed);
    const { dependencies } = harness({ documents });

    await expect(runMemberDirectoryForwardChunk(dependencies, request)).rejects.toThrow(
      /changed since it was reviewed/u,
    );
  });

  /**
   * The prior-absence assertion the plan froze no longer holds: something created an admin profile
   * at a planned target between the review and the run. Step 6 creates a profile only when absent
   * and overwrites none, so this is a changed input rather than a row to skip.
   */
  it("refuses a target that acquired an admin profile since the review", async () => {
    const documents = emptyDocuments();
    const { dependencies } = harness({
      documents: {
        ...documents,
        adminProfiles: new Map<string, unknown>([
          [
            "student-minted-1",
            {
              studentId: "student-minted-1",
              academyId,
              gender: "unknown",
              source: "admin",
              schemaVersion: "1",
              createdAt: "2026-02-01T00:00:00.000Z",
              createdBy: "system",
              updatedAt: "2026-02-01T00:00:00.000Z",
              updatedBy: "system",
            },
          ],
        ]),
      },
    });

    await expect(runMemberDirectoryForwardChunk(dependencies, request)).rejects.toThrow(
      /already has an admin profile/u,
    );
  });

  /**
   * The version-skew case, and the only one the root comparison can catch on its own.
   *
   * Every artifact below is sealed with the real MAC functions and every binding holds - the plan
   * carries its manifest's MAC, the receipt carries the plan's, and the receipt's expected roots are
   * the plan's. What the plan claims is a root no executor of this code produces, which is what a
   * plan frozen before a deploy and executed after it looks like. Without the comparison the chunk
   * would commit documents the frozen plan does not describe.
   */
  it("refuses a chunk whose output is not the root its plan froze", async () => {
    const skewedPlan = {
      ...artifacts.plan,
      chunks: artifacts.plan.chunks.map((chunk) => ({
        ...chunk,
        expectedOutputSetMac: "c".repeat(64),
      })),
    };
    const planMac = createMemberDirectoryPrivatePlanMac({
      plan: skewedPlan,
      secretMaterial: integritySecretMaterial,
    });
    const skewedReceipt = {
      ...artifacts.receipt,
      planMac,
      expectedOutputSetMacRoots: skewedPlan.chunks.map((chunk) => chunk.expectedOutputSetMac),
      sourceMac: createMemberDirectorySourceSetMac({
        academyId,
        operationId,
        rows: artifacts.manifest.rows.map((row) => ({
          sourceId: row.sourceLegacyId,
          sourceRowMac: row.sourceRowMac,
        })),
        secretMaterial: integritySecretMaterial,
      }),
    };
    const { dependencies } = harness({
      plan: skewedPlan,
      operation: { receipt: skewedReceipt },
    });

    await expect(runMemberDirectoryForwardChunk(dependencies, request)).rejects.toThrow(
      /does not produce the output set its plan froze/u,
    );
  });

  it("refuses a chunk whose reservation somebody already holds", async () => {
    // Taken from the plan's own target path, so the document really is one this chunk would create.
    const keyPath = artifacts.plan.chunks[0]?.targets
      .map((target) => target.path)
      .find((path) => path.includes("/studentIdentityKeys/"));
    const keyId = keyPath?.split("/studentIdentityKeys/")[1] ?? "";
    expect(keyId).toMatch(/^[a-z-]+:[a-f0-9]{64}$/u);

    const documents = emptyDocuments();
    const { dependencies } = harness({
      documents: {
        ...documents,
        identityKeys: new Map<string, unknown>([
          [
            keyId,
            {
              keyId,
              academyId,
              kind: keyId.split(":")[0],
              digestVersion: "hmac-sha256-v1",
              secretVersion: identitySecretVersion,
              ownerStudentId: "student-someone-else",
              schemaVersion: "1",
              createdAt: "2026-02-01T00:00:00.000Z",
              createdBy: "system",
              updatedAt: "2026-02-01T00:00:00.000Z",
              updatedBy: "system",
            },
          ],
        ]),
      },
    });

    await expect(runMemberDirectoryForwardChunk(dependencies, request)).rejects.toThrow(
      /already reserved/u,
    );
  });
});

describe("member directory forward baseline check", () => {
  it("refuses a tenant whose identity-key bootstrap has not completed", () => {
    expect(() =>
      assertMemberDirectoryForwardBaseline({
        state: stableState({
          identityKeyCoverage: "incomplete",
          identityKeyBaselineMac: undefined,
          identityKeyBaselineArtifactId: undefined,
        }),
        receipt: artifacts.receipt,
      }),
    ).toThrow(/bootstrap has not completed/u);
  });

  it("refuses a plan frozen under another identity secret version", () => {
    expect(() =>
      assertMemberDirectoryForwardBaseline({
        state: stableState({ secretVersion: "identity-v2" }),
        receipt: artifacts.receipt,
      }),
    ).toThrow(/another identity secret version/u);
  });

  it("accepts the baseline the plan was frozen against", () => {
    expect(() =>
      assertMemberDirectoryForwardBaseline({
        state: stableState(),
        receipt: artifacts.receipt,
      }),
    ).not.toThrow();
  });
});
