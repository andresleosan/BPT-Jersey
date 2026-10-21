import { describe, expect, it } from "vitest";

import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import { planMemberDirectoryGlobalLegacyElimination } from "@bpt-jersey/domain/members/directory-transitions";
import {
  advanceMemberDirectoryControlPlane,
  assertCanonicalMemberDirectoryWriterReady,
  assertMemberDirectoryControlPlane,
  buildInitialMemberDirectoryControlPlane,
  selectAdminDirectoryReader,
  type MemberDirectoryTransitionKind,
} from "./member-directory-state.js";

const integritySecret = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";

function canonicalState(stateRevision = 0): MemberDirectoryState {
  return {
    stateId: "current",
    academyId: "academy-1",
    readerVersion: "canonical-v1",
    directoryWriteMode: "canonical-v1",
    freezeStatus: "open",
    stateRevision,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "complete",
    digestVersion: "hmac-sha256-v1",
    secretVersion: "identity-v1",
    identityKeyBaselineMac: "a".repeat(64),
    identityKeyBaselineArtifactId: "baseline-1",
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: 2,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: "2026-09-03T20:00:00.000Z",
    createdBy: "system-1",
    updatedAt: "2026-09-03T20:00:00.000Z",
    updatedBy: "system-1",
  };
}

describe("member directory control-plane guard", () => {
  it("builds and verifies the revision-zero non-restorable guard", () => {
    const state = canonicalState();
    const initial = buildInitialMemberDirectoryControlPlane({
      projectId: "demo-bpt-jersey",
      state,
      integritySecretMaterial: integritySecret,
      integritySecretVersion: "integrity-v1",
      now: "2026-09-03T20:00:00.000Z",
      actorId: "system-1",
    });

    expect(initial.guard.guardId).toBe("academy-1");
    expect(initial.guard.highestStateRevision).toBe(0);
    expect(initial.event.eventId).toBe("0");
    expect(initial.event.previousStateRevision).toBe(-1);
    expect(initial.event.eventMac).toMatch(/^[a-f0-9]{64}$/u);
    expect(() =>
      assertMemberDirectoryControlPlane({
        projectId: "demo-bpt-jersey",
        state,
        guard: initial.guard,
        event: initial.event,
        integritySecretMaterial: integritySecret,
        integritySecretVersion: "integrity-v1",
      }),
    ).not.toThrow();
  });

  it("advances state, guard and the create-only event together", () => {
    const state = canonicalState();
    const initial = buildInitialMemberDirectoryControlPlane({
      projectId: "demo-bpt-jersey",
      state,
      integritySecretMaterial: integritySecret,
      integritySecretVersion: "integrity-v1",
      now: "2026-09-03T20:00:00.000Z",
      actorId: "system-1",
    });
    const nextState: MemberDirectoryState = {
      ...state,
      stateRevision: 1,
      rollbackEligibleStudentCount: 3,
      updatedAt: "2026-09-03T20:01:00.000Z",
      updatedBy: "owner-1",
    };
    const advanced = advanceMemberDirectoryControlPlane({
      projectId: "demo-bpt-jersey",
      state,
      guard: initial.guard,
      event: initial.event,
      nextState,
      operationId: "write-request-1",
      transitionKind: "canonical-identity-create",
      integritySecretMaterial: integritySecret,
      integritySecretVersion: "integrity-v1",
      now: "2026-09-03T20:01:00.000Z",
      actorId: "owner-1",
    });

    expect(advanced.guard.highestStateRevision).toBe(1);
    expect(advanced.guard.highestRollbackEligibleStudentCount).toBe(3);
    expect(advanced.event.previousEventMac).toBe(initial.event.eventMac);
    expect(advanced.event.currentStateRevision).toBe(1);
    expect(() =>
      assertMemberDirectoryControlPlane({
        projectId: "demo-bpt-jersey",
        state: nextState,
        guard: advanced.guard,
        event: advanced.event,
        integritySecretMaterial: integritySecret,
        integritySecretVersion: "integrity-v1",
      }),
    ).not.toThrow();
  });

  it("rejects tampering, revision gaps and monotonic rollback", () => {
    const state = canonicalState();
    const initial = buildInitialMemberDirectoryControlPlane({
      projectId: "demo-bpt-jersey",
      state,
      integritySecretMaterial: integritySecret,
      integritySecretVersion: "integrity-v1",
      now: "2026-09-03T20:00:00.000Z",
      actorId: "system-1",
    });
    const verify = (guard: unknown, event: unknown) =>
      assertMemberDirectoryControlPlane({
        projectId: "demo-bpt-jersey",
        state,
        guard,
        event,
        integritySecretMaterial: integritySecret,
        integritySecretVersion: "integrity-v1",
      });

    expect(() => verify({ ...initial.guard, projectId: "other" }, initial.event)).toThrow();
    expect(() => verify(initial.guard, { ...initial.event, eventMac: "b".repeat(64) })).toThrow();
    expect(() => verify({ ...initial.guard, highestStateRevision: 1 }, initial.event)).toThrow();

    expect(() =>
      advanceMemberDirectoryControlPlane({
        projectId: "demo-bpt-jersey",
        state,
        guard: initial.guard,
        event: initial.event,
        nextState: { ...state, stateRevision: 2 },
        operationId: "write-request-1",
        transitionKind: "canonical-identity-create",
        integritySecretMaterial: integritySecret,
        integritySecretVersion: "integrity-v1",
        now: "2026-09-03T20:01:00.000Z",
        actorId: "owner-1",
      }),
    ).toThrow(/revision/i);
  });

  it("lets only the T097 transition set the global marker, and it keeps the count", () => {
    const state: MemberDirectoryState = { ...canonicalState(), rollbackEligibleStudentCount: 400 };
    const initial = buildInitialMemberDirectoryControlPlane({
      projectId: "demo-bpt-jersey",
      state,
      integritySecretMaterial: integritySecret,
      integritySecretVersion: "integrity-v1",
      now: "2026-09-03T20:00:00.000Z",
      actorId: "system-1",
    });
    const at = "2026-09-03T20:01:00.000Z";
    const eliminated = planMemberDirectoryGlobalLegacyElimination({
      currentState: state,
      evidence: {
        completedDirectoryForwardCount: 1,
        verifiedRestoreAttestationCount: 1,
        legacyMemberReaderCount: 0,
        nestedLegacyDocumentCount: 0,
        unexpiredApprovalCount: 1,
      },
      now: at,
      actorId: "operator-1",
    });
    const advance = (nextState: MemberDirectoryState, kind: MemberDirectoryTransitionKind) =>
      advanceMemberDirectoryControlPlane({
        projectId: "demo-bpt-jersey",
        state,
        guard: initial.guard,
        event: initial.event,
        nextState,
        operationId: "t097-operation-1",
        transitionKind: kind,
        integritySecretMaterial: integritySecret,
        integritySecretVersion: "integrity-v1",
        now: at,
        actorId: "operator-1",
      });

    expect(() => advance(eliminated, "canonical-identity-create")).toThrow(
      /global legacy-read elimination/u,
    );
    expect(() =>
      advance(
        { ...state, stateRevision: 1, updatedAt: at, updatedBy: "operator-1" },
        "global-legacy-eliminate",
      ),
    ).toThrow(/global legacy-read elimination/u);

    const advanced = advance(eliminated, "global-legacy-eliminate");
    expect(advanced.guard).toMatchObject({
      globalLegacyReadEverEliminated: true,
      highestRollbackEligibleStudentCount: 400,
      highestStateRevision: 1,
    });
    expect(advanced.event.transitionKind).toBe("global-legacy-eliminate");
  });

  it("selects only stable readers and enforces the canonical writer tuple", () => {
    const canonical = canonicalState();
    expect(
      assertCanonicalMemberDirectoryWriterReady(canonical, {
        academyId: "academy-1",
        digestVersion: "hmac-sha256-v1",
        secretVersion: "identity-v1",
      }),
    ).toEqual(canonical);
    expect(selectAdminDirectoryReader(canonical)).toBe("canonical");

    const rollback: MemberDirectoryState = {
      ...canonical,
      readerVersion: "legacy-rollback-v1",
      directoryWriteMode: "blocked",
      freezeStatus: "frozen",
      operationPhase: "rollback-readonly",
    };
    expect(selectAdminDirectoryReader(rollback)).toBe("legacy-rollback");
    expect(() =>
      assertCanonicalMemberDirectoryWriterReady(rollback, {
        academyId: "academy-1",
        digestVersion: "hmac-sha256-v1",
        secretVersion: "identity-v1",
      }),
    ).toThrow(/unavailable/i);

    const legacy: MemberDirectoryState = {
      ...canonical,
      readerVersion: "legacy-v1",
      directoryWriteMode: "legacy-v1",
    };
    expect(() => selectAdminDirectoryReader(legacy)).toThrow(/migration/i);
    expect(() => selectAdminDirectoryReader(undefined)).toThrow(/state/i);
  });
});

describe("recovery eligibility (2026-10-20 capacity prep, part 6)", () => {
  // A synthetic lineage under the test secret: a backup taken before T097, then the live control
  // plane one step after it. No activation route exists; these are the guard's own refusals.
  const binding = {
    projectId: "demo-bpt-jersey",
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
  } as const;
  const backup: MemberDirectoryState = { ...canonicalState(), rollbackEligibleStudentCount: 400 };
  const initial = buildInitialMemberDirectoryControlPlane({
    ...binding,
    state: backup,
    now: "2026-09-03T20:00:00.000Z",
    actorId: "system-1",
  });
  const eliminatedAt = "2026-09-03T20:01:00.000Z";
  const live = planMemberDirectoryGlobalLegacyElimination({
    currentState: backup,
    evidence: {
      completedDirectoryForwardCount: 1,
      verifiedRestoreAttestationCount: 1,
      legacyMemberReaderCount: 0,
      nestedLegacyDocumentCount: 0,
      unexpiredApprovalCount: 1,
    },
    now: eliminatedAt,
    actorId: "operator-1",
  });
  const liveControl = advanceMemberDirectoryControlPlane({
    ...binding,
    state: backup,
    guard: initial.guard,
    event: initial.event,
    nextState: live,
    operationId: "t097-operation-1",
    transitionKind: "global-legacy-eliminate",
    now: eliminatedAt,
    actorId: "operator-1",
  });
  const restoredAt = "2026-09-03T20:02:00.000Z";
  const restoreOnto = (nextState: MemberDirectoryState) =>
    advanceMemberDirectoryControlPlane({
      ...binding,
      state: live,
      guard: liveControl.guard,
      event: liveControl.event,
      nextState: { ...nextState, updatedAt: restoredAt, updatedBy: "operator-1" },
      operationId: "restore-operation-1",
      transitionKind: "restore-complete",
      now: restoredAt,
      actorId: "operator-1",
    });

  it("refuses a pre-T097 backup against a guard that has seen the marker", () => {
    expect(liveControl.guard.globalLegacyReadEverEliminated).toBe(true);
    expect(() =>
      assertMemberDirectoryControlPlane({
        ...binding,
        state: backup,
        guard: liveControl.guard,
        event: liveControl.event,
      }),
    ).toThrow(/binding mismatch/u);
    expect(() => restoreOnto(backup)).toThrow(/advance exactly once/u);
    expect(() => restoreOnto({ ...backup, stateRevision: 2 })).toThrow(/cannot decrease/u);
  });

  it("keeps the revision, the counter and the marker, and checks nothing else", () => {
    expect(() => restoreOnto({ ...live, stateRevision: 1 })).toThrow(/advance exactly once/u);
    expect(() =>
      restoreOnto({ ...live, stateRevision: 2, rollbackEligibleStudentCount: 150 }),
    ).toThrow(/cannot decrease/u);

    // The guard's arithmetic is the whole check: a restore-kind step that keeps all three passes
    // it with no Auth identity binding and no audited activation, so recovery stays unavailable
    // until an activation that requires both exists and is reviewed.
    expect(restoreOnto({ ...live, stateRevision: 2 }).guard).toMatchObject({
      highestStateRevision: 2,
      globalLegacyReadEverEliminated: true,
      highestRollbackEligibleStudentCount: 400,
      restoreEpoch: 0,
    });
  });
});
