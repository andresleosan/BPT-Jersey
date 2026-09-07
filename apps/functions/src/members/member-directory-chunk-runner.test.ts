import { memberDirectoryStateSchema } from "@bpt-jersey/domain/members/directory";
import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import {
  planMemberDirectoryAcquisition,
  planMemberDirectoryPhaseChange,
} from "@bpt-jersey/domain/members/directory-transitions";
import { describe, expect, it } from "vitest";

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
function frozenForwardControlPlane(lastCommittedChunkNo = 0): {
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
    phase: "forward",
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
    transitionKind: "directory-forward",
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
});
