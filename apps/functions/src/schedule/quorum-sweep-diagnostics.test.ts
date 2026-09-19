import { describe, expect, it } from "vitest";

import { classifyQuorumSweepFailure } from "./quorum-sweep-diagnostics";

describe("safe quorum failure classification", () => {
  it.each([
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
  ] as const)(
    "allowlists numeric, string and namespaced SDK code %s as %s",
    (numeric, code, retryable) => {
      for (const value of [numeric, code, `firestore/${code}`]) {
        const error = Object.assign(new Error("private SDK message"), {
          code: value,
          details: { studentId: "synthetic-private-id" },
        });
        expect(classifyQuorumSweepFailure(error, "reconcile")).toEqual({
          stage: "reconcile",
          code,
          retryable,
        });
      }
    },
  );

  it.each(["malformed-series", "invalid", "tenant", "conflict"])(
    "keeps persistent data error %s distinct",
    (code) => {
      expect(classifyQuorumSweepFailure({ code }, "materialise-series")).toEqual({
        stage: "materialise-series",
        code,
        retryable: false,
      });
    },
  );

  it.each([
    undefined,
    null,
    "private data",
    new Error("private SDK message"),
    { code: "private data" },
    { code: 999 },
    { code: null },
  ])("redacts unrecognised errors without guessing retryability: %#", (error) => {
    expect(classifyQuorumSweepFailure(error, "list-candidates")).toEqual({
      stage: "list-candidates",
      code: "unknown",
      retryable: null,
    });
  });
});
