import { memberDirectoryStateSchema } from "@bpt-jersey/domain/members/directory";
import { memberDirectoryDryRunClassifications } from "@bpt-jersey/domain/members/directory-migration";
import {
  memberDirectoryOperationDocumentSchema,
  type MemberDirectoryOperationDocument,
} from "@bpt-jersey/domain/members/directory-operations";
import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import {
  planMemberDirectoryAcquisition,
  planMemberDirectoryPhaseChange,
} from "@bpt-jersey/domain/members/directory-transitions";
import { describe, expect, it } from "vitest";

import { planMemberDirectoryBootstrapChunk } from "./member-directory-bootstrap-executor.js";
import {
  runMemberDirectoryChunkCommit,
  type MemberDirectoryChunkCommitWrite,
  type MemberDirectoryChunkControlPlane,
  type MemberDirectoryChunkStore,
} from "./member-directory-chunk-runner.js";
import {
  advanceMemberDirectoryControlPlane,
  buildInitialMemberDirectoryControlPlane,
} from "./member-directory-state.js";

const projectId = "demo-bpt-jersey";
const academyId = "academy-bpt-jersey";
const integritySecretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const identitySecretMaterial = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecretVersion = "integrity-v1";
const acquiredAt = "2026-09-07T12:00:00.000Z";
const now = "2026-09-07T12:01:00.000Z";

function baseline(): MemberDirectoryState {
  return memberDirectoryStateSchema.parse({
    stateId: "current",
    academyId,
    readerVersion: "legacy-v1",
    directoryWriteMode: "legacy-v1",
    freezeStatus: "open",
    stateRevision: 0,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "incomplete",
    digestVersion: "hmac-sha256-v1",
    secretVersion: "identity-v1",
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

/**
 * Builds a real control plane rather than a hand-written fixture: initialize at revision zero, then
 * acquire the forward operation through the same functions production uses. A fixture with a
 * hand-made MAC would pass the runner while proving nothing about the chain it is supposed to check.
 */
function frozenControlPlane(
  phase: "forward" | "bootstrap",
  transitionKind: "directory-forward" | "identity-key-bootstrap",
  lastCommittedChunkNo: number,
): {
  state: MemberDirectoryState;
  guard: unknown;
  event: unknown;
} {
  const initial = buildInitialMemberDirectoryControlPlane({
    projectId,
    state: baseline(),
    now: "2026-09-01T00:00:00.000Z",
    actorId: "system",
    integritySecretMaterial,
    integritySecretVersion,
  });

  const acquired = planMemberDirectoryAcquisition({
    currentState: baseline(),
    phase,
    operationId: "op-1",
    leaseId: "lease-1",
    leaseOwner: "runner-a",
    operationDeadline: "2026-09-07T12:25:00.000Z",
    now: acquiredAt,
    actorId: "runner-a",
  });

  const advanced = advanceMemberDirectoryControlPlane({
    projectId,
    state: baseline(),
    guard: initial.guard,
    event: initial.event,
    nextState: acquired,
    operationId: "op-1",
    transitionKind,
    now: acquiredAt,
    actorId: "runner-a",
    integritySecretMaterial,
    integritySecretVersion,
  });

  return {
    state: memberDirectoryStateSchema.parse({ ...acquired, lastCommittedChunkNo }),
    guard: advanced.guard,
    event: advanced.event,
  };
}

function frozenForwardControlPlane(lastCommittedChunkNo = 0): {
  state: MemberDirectoryState;
  guard: unknown;
  event: unknown;
} {
  return frozenControlPlane("forward", "directory-forward", lastCommittedChunkNo);
}

function createStore(
  overrides: Partial<MemberDirectoryChunkControlPlane> = {},
  lastCommittedChunkNo = 0,
): { store: MemberDirectoryChunkStore; writes: MemberDirectoryChunkCommitWrite[] } {
  const plane = frozenForwardControlPlane(lastCommittedChunkNo);
  const writes: MemberDirectoryChunkCommitWrite[] = [];
  return {
    writes,
    store: {
      read: () =>
        Promise.resolve({
          state: plane.state,
          guard: plane.guard,
          event: plane.event,
          operation: operationDocument(
            lastCommittedChunkNo === 0 ? {} : { status: "applying", statusAuditEventId: "audit-2" },
          ),
          priorRowCount: 0,
          ...overrides,
        }),
      commit: (write) => {
        writes.push(write);
        return Promise.resolve();
      },
    },
  };
}

/**
 * The parent operation the chunks belong to. Built through its own schema, so a chunk test cannot
 * accidentally pass with a parent shape production would reject.
 */
function operationDocument(
  overrides: Readonly<Record<string, unknown>> = {},
): MemberDirectoryOperationDocument {
  const phase = (overrides["phase"] as string | undefined) ?? "forward";
  const operationType = phase === "bootstrap" ? "identity-key-bootstrap" : "directory-forward";
  // The receipt has to name the same operation as the document, so overriding one moves both: a
  // fixture that let them drift would only ever prove the schema rejects its own fixture.
  const operationId = (overrides["operationId"] as string | undefined) ?? "op-1";
  const rest = { ...overrides };
  delete rest["phase"];
  return memberDirectoryOperationDocumentSchema.parse({
    operationId,
    academyId,
    operationType,
    status: "frozen",
    receipt: {
      operationId,
      academyId,
      phase,
      targetProjectClassification: "emulator",
      codeVersion: "9a9d839",
      schemaVersion: "1",
      effectiveDate: "2026-09-07T10:00:00.000Z",
      expiresAt: "2026-09-07T13:00:00.000Z",
      sourceMac: "a".repeat(64),
      privateManifestMac: "b".repeat(64),
      planMac: "c".repeat(64),
      digestVersion: "hmac-sha256-v1",
      secretVersion: "identity-v1",
      identityKeyBaselineMac: "d".repeat(64),
      expectedOutputSetMacRoots: ["e".repeat(64)],
      classificationCounts: Object.fromEntries(
        memberDirectoryDryRunClassifications.map((classification) => [classification, 0]),
      ),
      preExistingAdmittedStudentCount: 100,
      plannedNewStudentCount: 0,
      postCutoverAdmittedStudentCount: 100,
      maximumApprovedRows: 400,
      integrityMacVersion: "hmac-sha256-v1",
      integritySecretVersion: "integrity-v1",
      operationWriteTime: "2026-09-07T10:00:00.000Z",
      createdAt: "2026-09-07T10:00:00.000Z",
      createdBy: "operator",
    },
    statusAuditEventId: "audit-1",
    statusChangedAt: acquiredAt,
    statusChangedBy: "runner-a",
    schemaVersion: "1",
    createdAt: "2026-09-07T10:00:00.000Z",
    createdBy: "operator",
    ...rest,
  });
}

function createBootstrapStore(): {
  store: MemberDirectoryChunkStore;
  writes: MemberDirectoryChunkCommitWrite[];
} {
  const plane = frozenControlPlane("bootstrap", "identity-key-bootstrap", 0);
  const writes: MemberDirectoryChunkCommitWrite[] = [];
  return {
    writes,
    store: {
      read: () =>
        Promise.resolve({
          state: plane.state,
          guard: plane.guard,
          event: plane.event,
          operation: operationDocument({ phase: "bootstrap" }),
          priorRowCount: 0,
        }),
      commit: (write) => {
        writes.push(write);
        return Promise.resolve();
      },
    },
  };
}

function bootstrapPlanInput() {
  const studentId = "student-1001";
  const auditFields = {
    schemaVersion: "1",
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "system",
    updatedAt: "2026-09-01T00:00:00.000Z",
    updatedBy: "system",
  } as const;
  return {
    academyId,
    operationId: "op-1",
    chunkNo: 1,
    plannedStudentIds: [studentId],
    observed: [
      {
        studentId,
        student: {
          studentId,
          academyId,
          fullName: "Synthetic Bootstrap Student",
          dateOfBirth: "2000-01-02",
          trainingCenter: "Town",
          trainingTimePreferences: ["evening"],
          participantType: "adult",
          active: true,
          status: "active",
          ...auditFields,
        },
        profile: {
          studentId,
          academyId,
          membershipNumber: "BPT 1001",
          gender: "unknown",
          source: "admin",
          ...auditFields,
        },
      },
    ],
    existingKeys: [],
    now,
    actorId: "runner-a",
  };
}

const dependencies = (store: MemberDirectoryChunkStore) => ({
  projectId,
  store,
  integritySecretMaterial,
  integritySecretVersion,
  now: () => now,
});

const request = {
  academyId,
  operationId: "op-1",
  phase: "forward",
  chunkNo: 1,
  rowCount: 40,
  quarantinedCount: 2,
  outputSetMac: "a".repeat(64),
  actorId: "runner-a",
} as const;

describe("member directory chunk runner", () => {
  it("commits state, guard, event and receipt together", async () => {
    const { store, writes } = createStore();

    const result = await runMemberDirectoryChunkCommit(dependencies(store), request);

    expect(result).toEqual({ chunkId: "op-1:forward:1", committed: true });
    expect(writes).toHaveLength(1);
    const write = writes[0];
    expect(write?.receipt.chunkId).toBe("op-1:forward:1");
    expect(write?.receipt.writtenCount).toBe(40);
    expect(write?.receipt.quarantinedCount).toBe(2);
    expect(write?.receipt.status).toBe("committed");
    // The guard event chain advanced with the state, not independently of it.
    expect(write?.event.currentStateRevision).toBe(write?.guard.highestStateRevision);
    expect(write?.event.transitionKind).toBe("directory-forward");
  });

  it("no-ops an exact replay without writing anything", async () => {
    const { store, writes } = createStore({ committedOutputSetMac: request.outputSetMac }, 1);

    const result = await runMemberDirectoryChunkCommit(dependencies(store), request);

    expect(result.committed).toBe(false);
    expect(result.reason).toMatch(/already committed/u);
    expect(writes).toHaveLength(0);
  });

  it("writes nothing when a replay presents different content", async () => {
    const { store, writes } = createStore({ committedOutputSetMac: "b".repeat(64) }, 1);

    await expect(runMemberDirectoryChunkCommit(dependencies(store), request)).rejects.toThrow(
      /different content under the same receipt/u,
    );
    expect(writes).toHaveLength(0);
  });

  /**
   * A state whose revision has moved past what its guard records means the control plane was
   * restored or edited underneath the runner. No chunk may commit over that, however valid the
   * chunk itself looks.
   */
  it("refuses to commit when the state no longer matches its guard", async () => {
    const plane = frozenForwardControlPlane();
    const tampered = memberDirectoryStateSchema.parse({
      ...plane.state,
      stateRevision: plane.state.stateRevision + 5,
    });
    const writes: MemberDirectoryChunkCommitWrite[] = [];
    const store: MemberDirectoryChunkStore = {
      read: () =>
        Promise.resolve({
          state: tampered,
          guard: plane.guard,
          event: plane.event,
          operation: operationDocument(),
          priorRowCount: 0,
        }),
      commit: (write) => {
        writes.push(write);
        return Promise.resolve();
      },
    };

    await expect(runMemberDirectoryChunkCommit(dependencies(store), request)).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });

  it("refuses a chunk whose academy is not the one in the control plane", async () => {
    const { store, writes } = createStore();

    await expect(
      runMemberDirectoryChunkCommit(dependencies(store), {
        ...request,
        academyId: "academy-other",
      }),
    ).rejects.toThrow(/academy does not match/u);
    expect(writes).toHaveLength(0);
  });

  /**
   * restore-recovery owns chunks, but backup v3 owns restore-recovery. Filing its audit trail under
   * a migration transition kind would put a restore in the migration's history.
   */
  it("refuses restore-recovery, which belongs to the backup v3 restore module", async () => {
    const { store, writes } = createStore();

    await expect(
      runMemberDirectoryChunkCommit(dependencies(store), {
        ...request,
        phase: "restore-recovery",
      }),
    ).rejects.toThrow(/not committed by the migration chunk runner/u);
    expect(writes).toHaveLength(0);
  });

  it("binds the reversed forward chunk on a compensation receipt", async () => {
    const plane = frozenForwardControlPlane();
    // Uses the real phase-change planner, so the revision advances exactly as production would.
    const compensating = planMemberDirectoryPhaseChange({
      currentState: plane.state,
      toPhase: "compensation",
      operationId: "op-1",
      now: "2026-09-07T12:00:30.000Z",
      actorId: "runner-a",
    });
    const advanced = advanceMemberDirectoryControlPlane({
      projectId,
      state: plane.state,
      guard: plane.guard,
      event: plane.event,
      nextState: compensating,
      operationId: "op-1",
      transitionKind: "failed-forward-compensation",
      now: "2026-09-07T12:00:30.000Z",
      actorId: "runner-a",
      integritySecretMaterial,
      integritySecretVersion,
    });
    const writes: MemberDirectoryChunkCommitWrite[] = [];
    const store: MemberDirectoryChunkStore = {
      read: () =>
        Promise.resolve({
          state: compensating,
          guard: advanced.guard,
          event: advanced.event,
          operation: operationDocument({
            phase: "compensation",
            status: "compensating",
            statusAuditEventId: "audit-2",
          }),
          priorRowCount: 0,
        }),
      commit: (write) => {
        writes.push(write);
        return Promise.resolve();
      },
    };

    await runMemberDirectoryChunkCommit(dependencies(store), {
      ...request,
      phase: "compensation",
      sourceForwardChunkNo: 8,
    });

    expect(writes[0]?.receipt.sourceForwardChunkNo).toBe(8);
    expect(writes[0]?.event.transitionKind).toBe("failed-forward-compensation");
  });

  /**
   * The parent's half of the commit. Without it an operation could have written domain documents
   * while its own record still said `frozen`, which is the state a resume would trust.
   */
  it("moves the parent operation from frozen to applying on the first chunk", async () => {
    const { store, writes } = createStore();

    await runMemberDirectoryChunkCommit(dependencies(store), request);

    expect(writes[0]?.operation?.status).toBe("applying");
    // Bound to the same guard event as the state transition, not to an audit entry of its own.
    expect(writes[0]?.operation?.statusAuditEventId).toBe(writes[0]?.event.eventId);
    expect(writes[0]?.operation?.receipt.planMac).toBe("c".repeat(64));
  });

  it("leaves the parent alone on a later chunk, with nothing to write", async () => {
    const { store, writes } = createStore({}, 1);

    await runMemberDirectoryChunkCommit(dependencies(store), { ...request, chunkNo: 2 });

    expect(writes[0]?.operation).toBeUndefined();
  });

  it("refuses a chunk whose parent document belongs to another operation", async () => {
    const { store, writes } = createStore({
      operation: operationDocument({ operationId: "op-other" }),
    });

    await expect(runMemberDirectoryChunkCommit(dependencies(store), request)).rejects.toThrow(
      /does not match its parent document/u,
    );
    expect(writes).toHaveLength(0);
  });

  /** A parent that already finished cannot gain another chunk, whatever the control plane says. */
  it("refuses a chunk while its parent is already completed", async () => {
    const { store, writes } = createStore({
      operation: operationDocument({ status: "completed", statusAuditEventId: "audit-9" }),
    });

    await expect(runMemberDirectoryChunkCommit(dependencies(store), request)).rejects.toThrow(
      /cannot commit while its operation is completed/u,
    );
    expect(writes).toHaveLength(0);
  });

  /**
   * The join between the envelope and the first executor: the bootstrap planner produces the domain
   * writes and their MAC, and the runner carries both into the same commit as the control plane.
   */
  it("carries an executor's domain writes into the same commit", async () => {
    const plan = planMemberDirectoryBootstrapChunk(bootstrapPlanInput(), {
      identitySecretMaterial,
      identitySecretVersion: "identity-v1",
      integritySecretMaterial,
    });
    const { store, writes } = createBootstrapStore();

    const result = await runMemberDirectoryChunkCommit(dependencies(store), {
      ...request,
      phase: "bootstrap",
      rowCount: plan.rowCount,
      quarantinedCount: plan.quarantinedCount,
      outputSetMac: plan.outputSetMac,
      domainWrites: plan.domainWrites,
    });

    expect(result).toEqual({ chunkId: "op-1:bootstrap:1", committed: true });
    expect(writes[0]?.domainWrites).toEqual(plan.domainWrites);
    expect(writes[0]?.receipt.chunkId).toBe("op-1:bootstrap:1");
    expect(writes[0]?.event.transitionKind).toBe("identity-key-bootstrap");
  });

  /**
   * A receipt that does not describe the documents it is committed with would certify the wrong
   * set forever, so the check runs before the control plane is even read.
   */
  it("refuses domain writes the receipt MAC does not describe", async () => {
    const plan = planMemberDirectoryBootstrapChunk(bootstrapPlanInput(), {
      identitySecretMaterial,
      identitySecretVersion: "identity-v1",
      integritySecretMaterial,
    });
    const { store, writes } = createBootstrapStore();
    let reads = 0;
    const countingStore: MemberDirectoryChunkStore = {
      read: (input) => {
        reads += 1;
        return store.read(input);
      },
      commit: (write) => store.commit(write),
    };

    await expect(
      runMemberDirectoryChunkCommit(dependencies(countingStore), {
        ...request,
        phase: "bootstrap",
        rowCount: plan.rowCount,
        quarantinedCount: plan.quarantinedCount,
        outputSetMac: "c".repeat(64),
        domainWrites: plan.domainWrites,
      }),
    ).rejects.toThrow(/output set does not match its receipt MAC/u);
    expect(writes).toHaveLength(0);
    expect(reads).toBe(0);
  });
});
