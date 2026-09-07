import { describe, expect, it } from "vitest";

import { memberDirectoryStateSchema } from "./member-directory-contracts";
import type { MemberDirectoryState } from "./member-directory-contracts";
import { memberDirectoryMigrationPhases } from "./member-directory-migration-contracts";
import {
  memberDirectoryMaxChunksPerOperation,
  memberDirectoryMaxRowsPerChunk,
  memberDirectoryMaxRowsPerOperation,
  planMemberDirectoryAcquisition,
  planMemberDirectoryChunkCommit,
  planMemberDirectoryPhaseChange,
} from "./member-directory-transitions";

const now = "2026-09-07T12:00:00.000Z";
const deadline = "2026-09-07T12:25:00.000Z";

function state(overrides: Record<string, unknown> = {}): MemberDirectoryState {
  return memberDirectoryStateSchema.parse({
    stateId: "current",
    academyId: "academy-bpt-jersey",
    readerVersion: "legacy-v1",
    directoryWriteMode: "legacy-v1",
    freezeStatus: "open",
    stateRevision: 7,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "incomplete",
    digestVersion: "hmac-sha256-v1",
    secretVersion: "2",
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: 12,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "system",
    updatedAt: "2026-09-06T00:00:00.000Z",
    updatedBy: "system",
    ...overrides,
  });
}

const acquire = {
  operationId: "op-1",
  leaseId: "lease-1",
  leaseOwner: "runner-a",
  operationDeadline: deadline,
  now,
  actorId: "runner-a",
} as const;

describe("member directory acquisition", () => {
  it("freezes the pre-cutover baseline into a forward operation", () => {
    const next = planMemberDirectoryAcquisition({
      ...acquire,
      currentState: state(),
      phase: "forward",
    });

    expect(next.readerVersion).toBe("legacy-v1");
    expect(next.directoryWriteMode).toBe("blocked");
    expect(next.freezeStatus).toBe("frozen");
    expect(next.operationPhase).toBe("forward");
    expect(next.stateRevision).toBe(8);
    expect(next.lastCommittedChunkNo).toBe(0);
    expect(next.activeOperationId).toBe("op-1");
    // 120 seconds after now, to the millisecond.
    expect(next.leaseExpiresAt).toBe("2026-09-07T12:02:00.000Z");
  });

  /**
   * The administrative reader stays legacy through the whole forward operation. If acquisition
   * moved it, partially written students would become visible before the cutover transaction, which
   * is the failure mode the frozen tuple exists to prevent.
   */
  it("never moves the reader while acquiring a forward", () => {
    const next = planMemberDirectoryAcquisition({
      ...acquire,
      currentState: state(),
      phase: "forward",
    });
    expect(next.readerVersion).toBe(state().readerVersion);
  });

  it("refuses to acquire from the wrong tuple", () => {
    expect(() =>
      planMemberDirectoryAcquisition({
        ...acquire,
        currentState: state({
          readerVersion: "canonical-v1",
          directoryWriteMode: "canonical-v1",
        }),
        phase: "forward",
      }),
    ).toThrow(/cannot be acquired from/u);
  });

  it("refuses to acquire twice: a tuple with a live lease is not stable", () => {
    const frozenForward = planMemberDirectoryAcquisition({
      ...acquire,
      currentState: state(),
      phase: "forward",
    });

    expect(() =>
      planMemberDirectoryAcquisition({
        ...acquire,
        currentState: frozenForward,
        phase: "forward",
        operationId: "op-2",
        leaseId: "lease-2",
      }),
    ).toThrow(/cannot be acquired from/u);
  });

  /**
   * Rollback projection only makes sense while a legacy reader could still serve it. After the
   * global marker the protocol is disabled for good, so acquiring would build a projection that
   * nothing is ever allowed to read.
   */
  it("refuses rollback projection once the global marker is set", () => {
    expect(() =>
      planMemberDirectoryAcquisition({
        ...acquire,
        currentState: state({
          readerVersion: "canonical-v1",
          directoryWriteMode: "canonical-v1",
          globalLegacyReadEliminated: true,
          rollbackProtocolVersion: "disabled",
        }),
        phase: "rollback-projection",
      }),
    ).toThrow(/globalLegacyReadEliminated=false/u);
  });

  it("allows identity reconcile on either side of the global marker", () => {
    for (const marker of [false, true]) {
      const next = planMemberDirectoryAcquisition({
        ...acquire,
        currentState: state({
          readerVersion: "canonical-v1",
          directoryWriteMode: "canonical-v1",
          globalLegacyReadEliminated: marker,
          rollbackProtocolVersion: marker ? "disabled" : "legacy-projection-v1",
        }),
        phase: "identity-reconcile",
      });
      expect(next.operationPhase).toBe("identity-reconcile");
    }
  });

  /**
   * Canonical recovery is one of the two already-frozen exceptions: it starts from the stable
   * read-only tuple and must not pass through an open one, because reopening writes even for a
   * single transaction is exactly what the read-only state is protecting against.
   */
  it("acquires canonical recovery from stable read-only without reopening writes", () => {
    const next = planMemberDirectoryAcquisition({
      ...acquire,
      currentState: state({
        readerVersion: "legacy-rollback-v1",
        directoryWriteMode: "blocked",
        freezeStatus: "frozen",
        operationPhase: "rollback-readonly",
      }),
      phase: "canonical-recovery",
    });

    expect(next.operationPhase).toBe("canonical-recovery");
    expect(next.directoryWriteMode).toBe("blocked");
    expect(next.freezeStatus).toBe("frozen");
  });

  it("consumes the prepared operation on restore acquire, and only its own", () => {
    const prepared = state({
      readerVersion: "canonical-v1",
      directoryWriteMode: "blocked",
      freezeStatus: "frozen",
      operationPhase: "restore-prepared",
      preparedOperationId: "op-1",
    });

    const next = planMemberDirectoryAcquisition({
      ...acquire,
      currentState: prepared,
      phase: "restore-recovery",
    });
    expect(next.operationPhase).toBe("restore-recovery");
    expect(next.preparedOperationId).toBeUndefined();

    expect(() =>
      planMemberDirectoryAcquisition({
        ...acquire,
        currentState: prepared,
        phase: "restore-recovery",
        operationId: "op-9",
      }),
    ).toThrow(/its own prepared operation/u);
  });
});

describe("member directory acquisition deadlines", () => {
  it("refuses a deadline beyond the 30-minute initial window", () => {
    expect(() =>
      planMemberDirectoryAcquisition({
        ...acquire,
        currentState: state(),
        phase: "forward",
        operationDeadline: "2026-09-07T12:30:00.001Z",
      }),
    ).toThrow(/maximum initial window/u);
  });

  it("refuses a deadline that leaves no room for a full lease", () => {
    expect(() =>
      planMemberDirectoryAcquisition({
        ...acquire,
        currentState: state(),
        phase: "forward",
        operationDeadline: "2026-09-07T12:01:00.000Z",
      }),
    ).toThrow(/cannot outlive its operation deadline/u);
  });

  it("refuses a deadline in the past", () => {
    expect(() =>
      planMemberDirectoryAcquisition({
        ...acquire,
        currentState: state(),
        phase: "forward",
        operationDeadline: "2026-09-07T11:59:00.000Z",
      }),
    ).toThrow(/must be in the future/u);
  });
});

describe("member directory phase change", () => {
  function frozenForward(): MemberDirectoryState {
    return planMemberDirectoryAcquisition({
      ...acquire,
      currentState: state(),
      phase: "forward",
    });
  }

  it("moves forward to compensation under the same operation and resets the chunk counter", () => {
    const applying = memberDirectoryStateSchema.parse({
      ...frozenForward(),
      lastCommittedChunkNo: 5,
    });

    const next = planMemberDirectoryPhaseChange({
      currentState: applying,
      toPhase: "compensation",
      operationId: "op-1",
      now: "2026-09-07T12:01:00.000Z",
      actorId: "runner-a",
    });

    expect(next.operationPhase).toBe("compensation");
    expect(next.lastCommittedChunkNo).toBe(0);
    expect(next.stateRevision).toBe(applying.stateRevision + 1);
    expect(next.activeOperationId).toBe("op-1");
  });

  it("refuses a phase change from a different operation", () => {
    expect(() =>
      planMemberDirectoryPhaseChange({
        currentState: frozenForward(),
        toPhase: "compensation",
        operationId: "op-2",
        now: "2026-09-07T12:01:00.000Z",
        actorId: "runner-a",
      }),
    ).toThrow(/its own operation/u);
  });

  it("refuses a phase change once the lease has expired", () => {
    expect(() =>
      planMemberDirectoryPhaseChange({
        currentState: frozenForward(),
        toPhase: "compensation",
        operationId: "op-1",
        now: "2026-09-07T12:02:00.000Z",
        actorId: "runner-a",
      }),
    ).toThrow(/live lease/u);
  });

  it("permits no phase change other than forward to compensation", () => {
    expect(() =>
      planMemberDirectoryPhaseChange({
        currentState: frozenForward(),
        toPhase: "bootstrap",
        operationId: "op-1",
        now: "2026-09-07T12:01:00.000Z",
        actorId: "runner-a",
      }),
    ).toThrow(/is not permitted/u);
  });
});

describe("member directory phase vocabularies", () => {
  /** The reader each phase's valid tuple uses, so every case below is tested on a legal tuple. */
  const readerByPhase: Readonly<Record<string, MemberDirectoryState["readerVersion"]>> = {
    bootstrap: "legacy-v1",
    forward: "legacy-v1",
    compensation: "legacy-v1",
    "identity-reconcile": "canonical-v1",
    "rollback-projection": "canonical-v1",
    "canonical-recovery": "legacy-rollback-v1",
    "restore-recovery": "canonical-v1",
    "rollback-readonly": "legacy-rollback-v1",
    "restore-prepared": "canonical-v1",
    "restore-rehearsal-complete": "canonical-v1",
  };

  const coordination = {
    activeOperationId: "op-1",
    leaseId: "lease-1",
    leaseOwner: "runner-a",
    leaseExpiresAt: "2026-09-07T12:02:00.000Z",
    operationDeadline: deadline,
  };

  function frozenTuple(
    phase: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      ...state(),
      readerVersion: readerByPhase[phase],
      directoryWriteMode: "blocked",
      freezeStatus: "frozen",
      operationPhase: phase,
      ...extra,
    };
  }

  /**
   * The phases that own chunks and the phases the state schema treats as active must be the same
   * set. If they drift, either a chunk gets written under a tuple that carries no lease, or an
   * active operation exists that can commit nothing - both silent failures, so this pins them.
   *
   * "Active" is tested by its actual consequence rather than by reading a list: an active phase
   * *requires* the coordination envelope and a stable one *forbids* it.
   */
  it("requires a lease for exactly the chunk-owning phases", () => {
    for (const phase of memberDirectoryMigrationPhases) {
      expect(memberDirectoryStateSchema.safeParse(frozenTuple(phase, coordination)).success).toBe(
        true,
      );
      expect(memberDirectoryStateSchema.safeParse(frozenTuple(phase)).success).toBe(false);
    }
  });

  it("forbids a lease on every stable phase, including the frozen ones", () => {
    const stablePhases = ["rollback-readonly", "restore-rehearsal-complete"] as const;
    for (const phase of stablePhases) {
      expect(memberDirectoryStateSchema.safeParse(frozenTuple(phase)).success).toBe(true);
      expect(memberDirectoryStateSchema.safeParse(frozenTuple(phase, coordination)).success).toBe(
        false,
      );
    }

    // restore-prepared is stable too, but carries the prepared operation instead of a lease.
    expect(
      memberDirectoryStateSchema.safeParse(
        frozenTuple("restore-prepared", { preparedOperationId: "op-1" }),
      ).success,
    ).toBe(true);
    expect(
      memberDirectoryStateSchema.safeParse(
        frozenTuple("restore-prepared", { preparedOperationId: "op-1", ...coordination }),
      ).success,
    ).toBe(false);
  });
});

describe("member directory chunk commit", () => {
  function frozenForward(lastCommittedChunkNo = 0): MemberDirectoryState {
    const acquired = planMemberDirectoryAcquisition({
      ...acquire,
      currentState: state(),
      phase: "forward",
    });
    return memberDirectoryStateSchema.parse({ ...acquired, lastCommittedChunkNo });
  }

  const commit = {
    operationId: "op-1",
    phase: "forward",
    rowCount: 50,
    priorRowCount: 0,
    outputSetMac: "a".repeat(64),
    now: "2026-09-07T12:01:00.000Z",
    actorId: "runner-a",
  } as const;

  it("commits the next chunk and advances both counters together", () => {
    const decision = planMemberDirectoryChunkCommit({
      ...commit,
      currentState: frozenForward(3),
      chunkNo: 4,
      priorRowCount: 150,
    });

    expect(decision.kind).toBe("commit");
    if (decision.kind !== "commit") {
      return;
    }
    expect(decision.nextState.lastCommittedChunkNo).toBe(4);
    expect(decision.nextState.stateRevision).toBe(frozenForward(3).stateRevision + 1);
  });

  it("refuses a gap in the chunk sequence", () => {
    expect(() =>
      planMemberDirectoryChunkCommit({ ...commit, currentState: frozenForward(3), chunkNo: 5 }),
    ).toThrow(/without gaps/u);
  });

  /**
   * The replay rule. An already-committed chunk arriving again with the same receipt is a no-op,
   * which is what makes a crashed runner safe to restart. The same chunk with a different receipt
   * is not a replay at all - it is a second, different write under an identifier that already means
   * something else, and it fails closed.
   */
  it("no-ops an exact replay and refuses a divergent one", () => {
    const replay = planMemberDirectoryChunkCommit({
      ...commit,
      currentState: frozenForward(4),
      chunkNo: 4,
      committedOutputSetMac: commit.outputSetMac,
    });
    expect(replay.kind).toBe("noop");

    expect(() =>
      planMemberDirectoryChunkCommit({
        ...commit,
        currentState: frozenForward(4),
        chunkNo: 4,
        committedOutputSetMac: "b".repeat(64),
      }),
    ).toThrow(/different content under the same receipt/u);
  });

  it("refuses a replay with no stored receipt to compare against", () => {
    expect(() =>
      planMemberDirectoryChunkCommit({ ...commit, currentState: frozenForward(4), chunkNo: 4 }),
    ).toThrow(/no stored receipt/u);
  });

  it("enforces the row and chunk budgets", () => {
    expect(() =>
      planMemberDirectoryChunkCommit({
        ...commit,
        currentState: frozenForward(0),
        chunkNo: 1,
        rowCount: memberDirectoryMaxRowsPerChunk + 1,
      }),
    ).toThrow(/at most 50 rows/u);

    expect(() =>
      planMemberDirectoryChunkCommit({
        ...commit,
        currentState: frozenForward(memberDirectoryMaxChunksPerOperation),
        chunkNo: memberDirectoryMaxChunksPerOperation + 1,
      }),
    ).toThrow(/at most 8 chunks/u);

    expect(() =>
      planMemberDirectoryChunkCommit({
        ...commit,
        currentState: frozenForward(7),
        chunkNo: 8,
        rowCount: 1,
        priorRowCount: memberDirectoryMaxRowsPerOperation,
      }),
    ).toThrow(/at most 400 rows/u);
  });

  it("refuses a chunk whose phase does not match the state", () => {
    expect(() =>
      planMemberDirectoryChunkCommit({
        ...commit,
        currentState: frozenForward(0),
        chunkNo: 1,
        phase: "compensation",
      }),
    ).toThrow(/while the state is in forward/u);
  });

  it("refuses a chunk from another operation, or on an expired lease", () => {
    expect(() =>
      planMemberDirectoryChunkCommit({
        ...commit,
        currentState: frozenForward(0),
        chunkNo: 1,
        operationId: "op-2",
      }),
    ).toThrow(/its own operation/u);

    expect(() =>
      planMemberDirectoryChunkCommit({
        ...commit,
        currentState: frozenForward(0),
        chunkNo: 1,
        now: "2026-09-07T12:02:00.000Z",
      }),
    ).toThrow(/live lease/u);
  });
});
