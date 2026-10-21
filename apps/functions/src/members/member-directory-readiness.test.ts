import { describe, expect, it } from "vitest";

import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";

import {
  assessMemberDirectoryReadiness,
  readinessObservationMaxAgeMs,
  type MemberDirectoryReadinessObservations,
  type MemberDirectoryReadinessReport,
} from "./member-directory-readiness.js";

const now = "2026-10-20T12:00:00.000Z";

// Synthetic copies shaped like the 2026-10-20 diagnostic reading (revision 794, 400 admissions
// recorded, 150 students, no I4 attestation). Nothing here was read from production.
function state(overrides: Partial<MemberDirectoryState> = {}): MemberDirectoryState {
  return {
    stateId: "current",
    academyId: "academy-1",
    readerVersion: "canonical-v1",
    directoryWriteMode: "canonical-v1",
    freezeStatus: "open",
    stateRevision: 794,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "complete",
    digestVersion: "hmac-sha256-v1",
    secretVersion: "identity-v1",
    identityKeyBaselineMac: "a".repeat(64),
    identityKeyBaselineArtifactId: "baseline-1",
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: 400,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: "2026-09-03T20:00:00.000Z",
    createdBy: "system-1",
    updatedAt: "2026-10-20T11:00:00.000Z",
    updatedBy: "owner-1",
    ...overrides,
  };
}

// The MAC is made up: the validator must never treat it as checked.
function guard(overrides: Record<string, unknown> = {}) {
  return {
    guardId: "academy-1",
    projectId: "demo-bpt-jersey",
    academyId: "academy-1",
    highestStateRevision: 794,
    globalLegacyReadEverEliminated: false,
    highestRollbackEligibleStudentCount: 400,
    restoreEpoch: 0,
    integrityMacVersion: "hmac-sha256-v1",
    integritySecretVersion: "integrity-v1",
    lastEventId: "794",
    lastEventMac: "b".repeat(64),
    schemaVersion: "1",
    createdAt: "2026-09-03T20:00:00.000Z",
    createdBy: "system-1",
    updatedAt: "2026-10-20T11:00:00.000Z",
    updatedBy: "owner-1",
    ...overrides,
  };
}

function observed(
  overrides: Partial<MemberDirectoryReadinessObservations> = {},
): MemberDirectoryReadinessObservations {
  return {
    observedAt: "2026-10-20T11:29:00.000Z",
    state: state(),
    guard: guard(),
    studentCount: 150,
    restoreAttestationCount: 0,
    ...overrides,
  };
}

const statuses = (report: MemberDirectoryReadinessReport) =>
  Object.fromEntries(report.checks.map((entry) => [entry.id, entry.status]));
const detail = (report: MemberDirectoryReadinessReport, id: string) =>
  report.checks.find((entry) => entry.id === id)?.detail;
const ids = (report: MemberDirectoryReadinessReport) => report.checks.map((entry) => entry.id);

describe("member directory readiness (2026-10-20 capacity prep, part 5)", () => {
  it("fails a reading like 2026-10-20's and names each missing proof", () => {
    const report = assessMemberDirectoryReadiness(observed(), now);

    expect(report.overall).toBe("FAIL");
    expect(statuses(report)).toEqual({
      observations: "PASS",
      state: "PASS",
      "global-marker": "PASS",
      guard: "PASS",
      admissions: "UNKNOWN",
      "t097-plan": "FAIL",
      "nested-legacy-history": "UNKNOWN",
      cutover: "UNKNOWN",
      "restore-attestation": "FAIL",
      "guard-mac": "UNKNOWN",
      "runtime-provenance": "UNKNOWN",
      "legacy-reader-quiescence": "UNKNOWN",
      "legacy-dependency-registry": "FAIL",
      "eliminate-approval": "FAIL",
      "restore-activation": "FAIL",
    });
    expect(detail(report, "t097-plan")).toBe(
      "Global legacy-read elimination is not proven: completed-directory-forward, verified-backup-attestation, zero-legacy-dependencies, nested-legacy-history-adapted, global-legacy-eliminate-approval",
    );
    expect(detail(report, "admissions")).toBe(
      "400 admissions recorded, 150 students now; the cause is not established, and the counter is never lowered.",
    );
  });

  it("passes nothing on the input's word: counted receipts, attestations and a made-up MAC", () => {
    const report = assessMemberDirectoryReadiness(
      observed({
        guard: guard({ lastEventMac: "f".repeat(64) }),
        studentCount: 400,
        nestedLegacyDocumentCount: 0,
        completedDirectoryForwardCount: 12,
        restoreAttestationCount: 3,
      }),
      now,
    );

    expect(report.overall).toBe("FAIL");
    expect(statuses(report)).toMatchObject({
      admissions: "PASS",
      "nested-legacy-history": "PASS",
      guard: "PASS",
      "guard-mac": "UNKNOWN",
      cutover: "UNKNOWN",
      "restore-attestation": "UNKNOWN",
      "t097-plan": "FAIL",
    });
    // The planner hears only what an offline check can stand behind: zero receipts, zero
    // attestations, readers unmeasured and no approval.
    expect(detail(report, "t097-plan")).toBe(
      "Global legacy-read elimination is not proven: completed-directory-forward, verified-backup-attestation, zero-legacy-dependencies, global-legacy-eliminate-approval",
    );
  });

  it.each([
    ["a MAC verdict", { macVerified: true }],
    ["a restore verdict", { restoreVerified: true }],
    ["a cutover verdict", { cutoverProven: true }],
    ["a reader count", { legacyMemberReaderCount: 0 }],
    ["a negative count", { studentCount: -1 }],
    ["a fractional count", { restoreAttestationCount: 1.5 }],
    ["a date without a time", { observedAt: "2026-10-20" }],
  ])("refuses observations it cannot read: %s", (_label, extra) => {
    const report = assessMemberDirectoryReadiness({ ...observed(), ...extra }, now);

    expect(report.overall).toBe("FAIL");
    expect(report.checks[0]).toMatchObject({ id: "observations", status: "FAIL" });
    expect(ids(report)).not.toContain("state");
  });

  it.each([null, "PASS", true, 0])("refuses %j as observations", (value) => {
    const report = assessMemberDirectoryReadiness(value, now);

    expect(report.checks[0]).toMatchObject({ id: "observations", status: "FAIL" });
    expect(report.overall).toBe("FAIL");
  });

  it.each([
    ["undated", undefined, "UNKNOWN"],
    [
      "stale",
      new Date(Date.parse(now) - readinessObservationMaxAgeMs - 1).toISOString(),
      "UNKNOWN",
    ],
    ["dated in the future", "2026-10-20T12:00:00.001Z", "FAIL"],
  ] as const)("assesses nothing else from %s observations", (_label, observedAt, status) => {
    const report = assessMemberDirectoryReadiness({ ...observed(), observedAt }, now);

    expect(report.checks[0]).toMatchObject({ id: "observations", status });
    expect(ids(report)).not.toContain("state");
    expect(ids(report)).not.toContain("t097-plan");
    expect(report.overall).toBe("FAIL");
  });

  it("is UNKNOWN about what was not observed and never fills the gap", () => {
    const bare = assessMemberDirectoryReadiness({ observedAt: "2026-10-20T11:29:00.000Z" }, now);
    const partial = assessMemberDirectoryReadiness(
      observed({ guard: undefined, studentCount: null, restoreAttestationCount: null }),
      now,
    );

    expect(statuses(bare)).toMatchObject({
      observations: "PASS",
      state: "UNKNOWN",
      "nested-legacy-history": "UNKNOWN",
      cutover: "UNKNOWN",
      "restore-attestation": "UNKNOWN",
    });
    expect(ids(bare)).not.toContain("t097-plan");
    expect(statuses(partial)).toMatchObject({
      state: "PASS",
      guard: "UNKNOWN",
      admissions: "UNKNOWN",
      "restore-attestation": "UNKNOWN",
    });
    expect(bare.overall).toBe("FAIL");
    expect(partial.overall).toBe("FAIL");
  });

  it.each([
    ["a state that does not parse", { state: { ...state(), stateRevision: -1 } }, "state"],
    ["a state carrying a verdict", { state: { ...state(), quiesced: true } }, "state"],
    [
      "a state outside the canonical open idle tuple",
      { state: state({ readerVersion: "legacy-v1", directoryWriteMode: "legacy-v1" }) },
      "state",
    ],
    ["a guard that does not parse", { guard: guard({ lastEventMac: "not-a-mac" }) }, "guard"],
    [
      "a guard from another academy",
      { guard: guard({ guardId: "academy-2", academyId: "academy-2" }) },
      "guard",
    ],
    ["a guard behind the state", { guard: guard({ highestStateRevision: 793 }) }, "guard"],
    ["a guard ahead of the state", { guard: guard({ highestStateRevision: 795 }) }, "guard"],
    [
      "a guard with another count",
      { guard: guard({ highestRollbackEligibleStudentCount: 399 }) },
      "guard",
    ],
    [
      "a guard that has seen the marker",
      { guard: guard({ globalLegacyReadEverEliminated: true }) },
      "guard",
    ],
  ])("fails %s", (_label, change, id) => {
    const report = assessMemberDirectoryReadiness(observed(change), now);

    expect(statuses(report)[id]).toBe("FAIL");
    expect(report.overall).toBe("FAIL");
  });

  it("has nothing to prepare once the marker is set", () => {
    const report = assessMemberDirectoryReadiness(
      observed({
        state: state({
          stateRevision: 795,
          globalLegacyReadEliminated: true,
          rollbackProtocolVersion: "disabled",
        }),
        guard: guard({ highestStateRevision: 795, globalLegacyReadEverEliminated: true }),
      }),
      now,
    );

    expect(statuses(report)).toMatchObject({
      state: "PASS",
      "global-marker": "FAIL",
      guard: "PASS",
      "t097-plan": "FAIL",
    });
    expect(detail(report, "t097-plan")).toBe("Global legacy-read elimination has already happened");
  });

  it("counts nested legacy documents only as observed", () => {
    const left = assessMemberDirectoryReadiness(observed({ nestedLegacyDocumentCount: 2 }), now);

    expect(statuses(left)["nested-legacy-history"]).toBe("FAIL");
    expect(detail(left, "t097-plan")).toContain("nested-legacy-history-adapted");
  });
});
