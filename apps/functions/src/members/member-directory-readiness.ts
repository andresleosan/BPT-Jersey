import { memberDirectoryStateSchema } from "@bpt-jersey/domain/members/directory";
import { planMemberDirectoryGlobalLegacyElimination } from "@bpt-jersey/domain/members/directory-transitions";
import { z } from "zod";

import { memberDirectoryRestoreGuardSchema } from "./member-directory-state.js";

/**
 * Read-only readiness for global legacy-read elimination (T097), assessed from what an observation
 * saw: documents and counts as read, never a verdict. The input has no field that can claim a MAC
 * was checked, a restore verified or a cutover proven, so nothing here passes on someone's word;
 * what this offline check cannot verify is UNKNOWN, and a missing component is a FAIL. It opens no
 * connection, reads no secret and writes nothing.
 */
export type ReadinessStatus = "PASS" | "FAIL" | "UNKNOWN";
export type ReadinessCheck = Readonly<{ id: string; status: ReadinessStatus; detail: string }>;
export type MemberDirectoryReadinessReport = Readonly<{
  overall: ReadinessStatus;
  checks: readonly ReadinessCheck[];
}>;

const count = z.number().int().nonnegative().safe().nullable().optional();
const observationsSchema = z.strictObject({
  observedAt: z.iso.datetime().optional(),
  state: z.unknown().optional(),
  guard: z.unknown().optional(),
  studentCount: count,
  nestedLegacyDocumentCount: count,
  completedDirectoryForwardCount: count,
  restoreAttestationCount: count,
});
export type MemberDirectoryReadinessObservations = z.input<typeof observationsSchema>;

export const readinessObservationMaxAgeMs = 24 * 3_600_000;

function check(id: string, status: ReadinessStatus, detail: string): ReadinessCheck {
  return Object.freeze({ id, status, detail });
}

/** Components and proofs that do not exist yet, whatever an observation says. */
const standing: readonly ReadinessCheck[] = Object.freeze([
  check("guard-mac", "UNKNOWN", "Needs the server's integrity secret; not checked offline."),
  check("runtime-provenance", "UNKNOWN", "Deployed code is not bound to a reviewed revision."),
  check(
    "legacy-reader-quiescence",
    "UNKNOWN",
    "Legacy readers stay coherent with the state they read; none being in flight at the cutover is not shown.",
  ),
  check(
    "legacy-dependency-registry",
    "FAIL",
    "No dependency registry or zero-reader proof exists.",
  ),
  check("eliminate-approval", "FAIL", "No global-legacy-eliminate approval flow exists."),
  check(
    "restore-activation",
    "FAIL",
    "Recovery is unavailable: restore callables are off, the v3 rehearsal is demo-only and quarantined without Auth, and no activation binds Auth identities or is audited.",
  ),
]);

export function assessMemberDirectoryReadiness(
  value: unknown,
  now: string,
): MemberDirectoryReadinessReport {
  const parsed = observationsSchema.safeParse(value);
  if (!parsed.success) {
    return report([check("observations", "FAIL", "Observations do not match the expected shape.")]);
  }
  const seen = parsed.data;
  if (seen.observedAt === undefined) {
    return report([check("observations", "UNKNOWN", "Observations carry no time.")]);
  }
  const age = Date.parse(now) - Date.parse(seen.observedAt);
  if (!(age >= 0)) {
    return report([check("observations", "FAIL", "Observations are dated in the future.")]);
  }
  if (age > readinessObservationMaxAgeMs) {
    return report([check("observations", "UNKNOWN", "Observations are stale; read again.")]);
  }

  const checks: ReadinessCheck[] = [check("observations", "PASS", `Observed ${seen.observedAt}.`)];
  const state =
    seen.state === undefined ? undefined : memberDirectoryStateSchema.safeParse(seen.state);
  if (state === undefined) checks.push(check("state", "UNKNOWN", "State not observed."));
  else if (!state.success) checks.push(check("state", "FAIL", "State document does not parse."));
  else checks.push(...stateChecks(state.data, seen, now));

  const nested = seen.nestedLegacyDocumentCount ?? null;
  const forward = seen.completedDirectoryForwardCount ?? null;
  const attestations = seen.restoreAttestationCount ?? null;
  checks.push(
    nested === null
      ? check("nested-legacy-history", "UNKNOWN", "Nested legacy documents not counted.")
      : check(
          "nested-legacy-history",
          nested === 0 ? "PASS" : "FAIL",
          `${nested} nested legacy documents.`,
        ),
    check(
      "cutover",
      "UNKNOWN",
      `${forward === null ? "Forward receipts not counted" : `${forward} completed forward receipts`}; the evidence model awaits the ADR-009 amendment, and no receipt is verifiable offline.`,
    ),
    attestations === null
      ? check("restore-attestation", "UNKNOWN", "I4 attestations not counted.")
      : attestations === 0
        ? check("restore-attestation", "FAIL", "No I4 restore attestation exists.")
        : check(
            "restore-attestation",
            "UNKNOWN",
            `${attestations} I4 attestations present, not verifiable offline.`,
          ),
  );
  return report(checks);
}

function stateChecks(
  state: ReturnType<typeof memberDirectoryStateSchema.parse>,
  seen: z.infer<typeof observationsSchema>,
  now: string,
): ReadinessCheck[] {
  const stable =
    state.readerVersion === "canonical-v1" &&
    state.directoryWriteMode === "canonical-v1" &&
    state.freezeStatus === "open" &&
    state.operationPhase === "idle" &&
    state.identityKeyCoverage === "complete";
  const checks = [
    stable
      ? check("state", "PASS", `Canonical, open, idle, complete; revision ${state.stateRevision}.`)
      : check("state", "FAIL", "Not the canonical open idle tuple with complete coverage."),
    state.globalLegacyReadEliminated
      ? check("global-marker", "FAIL", "Already set: there is nothing to prepare.")
      : check("global-marker", "PASS", "Not set."),
  ];

  const guard =
    seen.guard === undefined ? undefined : memberDirectoryRestoreGuardSchema.safeParse(seen.guard);
  if (guard === undefined) checks.push(check("guard", "UNKNOWN", "Guard not observed."));
  else if (!guard.success) checks.push(check("guard", "FAIL", "Guard document does not parse."));
  else {
    const bound =
      guard.data.academyId === state.academyId &&
      guard.data.highestStateRevision === state.stateRevision &&
      guard.data.globalLegacyReadEverEliminated === state.globalLegacyReadEliminated &&
      guard.data.highestRollbackEligibleStudentCount === state.rollbackEligibleStudentCount;
    checks.push(
      bound
        ? check("guard", "PASS", "Academy, revision, marker and count match (MAC unchecked).")
        : check("guard", "FAIL", "Guard and state disagree on academy, revision, marker or count."),
    );
  }

  const students = seen.studentCount ?? null;
  checks.push(
    students === null
      ? check("admissions", "UNKNOWN", "Students not counted.")
      : students === state.rollbackEligibleStudentCount
        ? check("admissions", "PASS", "The counter matches the students present.")
        : check(
            "admissions",
            "UNKNOWN",
            `${state.rollbackEligibleStudentCount} admissions recorded, ${students} students now; the cause is not established, and the counter is never lowered.`,
          ),
  );

  // The prepared T097 planner, given only what this offline check can stand behind.
  try {
    planMemberDirectoryGlobalLegacyElimination({
      currentState: state,
      evidence: {
        completedDirectoryForwardCount: 0,
        verifiedRestoreAttestationCount: 0,
        legacyMemberReaderCount: null,
        nestedLegacyDocumentCount: seen.nestedLegacyDocumentCount ?? null,
        unexpiredApprovalCount: 0,
      },
      now,
      actorId: "readiness-check",
    });
    checks.push(check("t097-plan", "UNKNOWN", "The planner accepted; nothing here was verified."));
  } catch (error) {
    checks.push(check("t097-plan", "FAIL", (error as Error).message));
  }
  return checks;
}

function report(checks: readonly ReadinessCheck[]): MemberDirectoryReadinessReport {
  const all = [...checks, ...standing];
  const statuses = new Set(all.map((entry) => entry.status));
  const overall = statuses.has("FAIL") ? "FAIL" : statuses.has("UNKNOWN") ? "UNKNOWN" : "PASS";
  return Object.freeze({ overall, checks: Object.freeze(all) });
}
