export type QuorumSweepStage =
  | "initialise"
  | "materialise"
  | "materialise-academy"
  | "materialise-series"
  | "list-candidates"
  | "reconcile";

// Only constants cross the logging boundary; never inspect messages, paths, details or causes.
const codes = [
  [3, "invalid-argument", false],
  [4, "deadline-exceeded", true],
  [5, "not-found", false],
  [7, "permission-denied", false],
  [8, "resource-exhausted", true],
  [9, "failed-precondition", false],
  [10, "aborted", true],
  [13, "internal", true],
  [14, "unavailable", true],
  [16, "unauthenticated", false],
  [null, "malformed-series", false],
  [null, "invalid", false],
  [null, "tenant", false],
  [null, "conflict", false],
] as const;

export function classifyQuorumSweepFailure(error: unknown, stage: QuorumSweepStage) {
  const code =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  const match = codes.find(
    ([numeric, name]) =>
      (numeric !== null && code === numeric) || code === name || code === `firestore/${name}`,
  );
  return Object.freeze({ stage, code: match?.[1] ?? "unknown", retryable: match?.[2] ?? null });
}

export type QuorumSweepFailure = ReturnType<typeof classifyQuorumSweepFailure>;
