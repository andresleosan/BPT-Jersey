import { describe, expect, it } from "vitest";

import {
  assertChunkSequence,
  assertCompensationReversesDescending,
  assertForwardCapacity,
  buildMemberDirectoryChunkId,
  isWriteEligibleClassification,
  memberDirectoryChunkReceiptSchema,
  memberDirectoryDryRunClassifications,
  memberDirectoryMigrationPhases,
  memberDirectoryOperationReceiptSchema,
  memberDirectoryRollbackCapacityLimit,
  parseMemberDirectoryChunkId,
} from "./member-directory-migration-contracts";

const baseReceipt = {
  operationId: "op-2026-09-07-forward",
  academyId: "academy-bpt-jersey",
  phase: "forward",
  targetProjectClassification: "emulator",
  codeVersion: "0794df0",
  schemaVersion: "1",
  effectiveDate: "2026-09-07T10:00:00.000Z",
  expiresAt: "2026-09-07T12:00:00.000Z",
  sourceMac: "a".repeat(64),
  privateManifestMac: "b".repeat(64),
  planMac: "c".repeat(64),
  digestVersion: "hmac-sha256-v1",
  secretVersion: "2",
  identityKeyBaselineMac: "d".repeat(64),
  expectedOutputSetMacRoots: ["e".repeat(64)],
  classificationCounts: Object.fromEntries(
    memberDirectoryDryRunClassifications.map((classification) => [classification, 0]),
  ),
  preExistingAdmittedStudentCount: 100,
  plannedNewStudentCount: 20,
  postCutoverAdmittedStudentCount: 120,
  maximumApprovedRows: 500,
  integrityMacVersion: "hmac-sha256-v1",
  integritySecretVersion: "2",
  operationWriteTime: "2026-09-07T10:00:00.000Z",
  createdAt: "2026-09-07T10:00:00.000Z",
  createdBy: "operator",
} as const;

const baseChunkReceipt = {
  chunkId: "op-1:forward:1",
  operationId: "op-1",
  academyId: "academy-bpt-jersey",
  phase: "forward",
  chunkNo: 1,
  status: "committed",
  outputSetMac: "f".repeat(64),
  writtenCount: 0,
  quarantinedCount: 0,
  integrityMacVersion: "hmac-sha256-v1",
  integritySecretVersion: "2",
  schemaVersion: "1",
  createdAt: "2026-09-07T10:05:00.000Z",
  createdBy: "operator",
} as const;

describe("member directory migration classifications", () => {
  it("treats same-id-compatible as eligible only after explicit review", () => {
    expect(isWriteEligibleClassification("same-id-compatible", { explicitlyReviewed: false })).toBe(
      false,
    );
    expect(isWriteEligibleClassification("same-id-compatible", { explicitlyReviewed: true })).toBe(
      true,
    );
  });

  /**
   * The spec's table has exactly two unconditionally eligible rows. Everything else is ineligible,
   * and review does not promote it: a minor without a family match stays ineligible however many
   * humans looked at it, because what is missing is the family, not the looking.
   */
  it("never lets review promote an ineligible classification", () => {
    const ineligible = memberDirectoryDryRunClassifications.filter(
      (classification) =>
        classification !== "same-id-compatible" &&
        classification !== "explicit-existing-student-match" &&
        classification !== "createable-adult",
    );

    expect(ineligible).toHaveLength(6);
    for (const classification of ineligible) {
      expect(isWriteEligibleClassification(classification, { explicitlyReviewed: true })).toBe(
        false,
      );
    }
  });
});

describe("member directory chunk identifiers", () => {
  it("round-trips {operationId}:{phase}:{chunkNo}", () => {
    const chunkId = buildMemberDirectoryChunkId({
      operationId: "op-1",
      phase: "forward",
      chunkNo: 7,
    });

    expect(chunkId).toBe("op-1:forward:7");
    expect(parseMemberDirectoryChunkId(chunkId)).toEqual({
      operationId: "op-1",
      phase: "forward",
      chunkNo: 7,
    });
  });

  it("rejects chunk number zero, because zero means no chunk committed", () => {
    expect(() =>
      buildMemberDirectoryChunkId({ operationId: "op-1", phase: "forward", chunkNo: 0 }),
    ).toThrow();
  });

  /**
   * `rollback-readonly` is the interesting rejection. It is a real operation phase, but its tuple is
   * stable and frozen with no lease and no active operation, so nothing runs under it and it owns no
   * chunks. `restore-recovery` is the mirror case: backup v3's phase, but it does run chunked work.
   */
  it("rejects phases that own no chunks and accepts the one that surprises", () => {
    for (const phase of ["idle", "rollback-readonly", "restore-prepared"]) {
      expect(() =>
        buildMemberDirectoryChunkId({
          operationId: "op-1",
          phase: phase as (typeof memberDirectoryMigrationPhases)[number],
          chunkNo: 1,
        }),
      ).toThrow();
    }

    expect(
      buildMemberDirectoryChunkId({
        operationId: "op-1",
        phase: "restore-recovery",
        chunkNo: 1,
      }),
    ).toBe("op-1:restore-recovery:1");
  });

  it("rejects an identifier whose operation segment is not opaque-safe", () => {
    expect(() => parseMemberDirectoryChunkId("op 1:forward:1")).toThrow();
    expect(() => parseMemberDirectoryChunkId("op-1:forward:01")).toThrow();
    expect(() => parseMemberDirectoryChunkId("op-1:forward")).toThrow();
  });
});

describe("member directory chunk sequence", () => {
  it("accepts a gapless sequence starting at one", () => {
    expect(() => {
      assertChunkSequence([1, 2, 3, 4]);
    }).not.toThrow();
    expect(() => {
      assertChunkSequence([]);
    }).not.toThrow();
  });

  it("fails closed on a gap rather than continuing over the hole", () => {
    expect(() => {
      assertChunkSequence([1, 2, 4]);
    }).toThrow(/without gaps/u);
    expect(() => {
      assertChunkSequence([2]);
    }).toThrow(/expected 1 but found 2/u);
  });
});

describe("member directory forward capacity", () => {
  /**
   * The bound the spec spells out: 399 existing plus two creates is rejected at plan time. This is
   * the case that matters, because it is the one a source-row count would have let through.
   */
  it("rejects 399 existing plus two creates before any write", () => {
    expect(() => {
      assertForwardCapacity({
        preExistingAdmittedStudentCount: 399,
        plannedNewStudentCount: 2,
        postCutoverAdmittedStudentCount: 401,
      });
    }).toThrow(/must not exceed 400/u);
  });

  it("accepts exactly the capacity limit", () => {
    expect(() => {
      assertForwardCapacity({
        preExistingAdmittedStudentCount: 399,
        plannedNewStudentCount: 1,
        postCutoverAdmittedStudentCount: memberDirectoryRollbackCapacityLimit,
      });
    }).not.toThrow();
  });

  it("rejects a post-cutover count that does not equal the sum", () => {
    expect(() => {
      assertForwardCapacity({
        preExistingAdmittedStudentCount: 10,
        plannedNewStudentCount: 5,
        postCutoverAdmittedStudentCount: 14,
      });
    }).toThrow(/must equal pre-existing plus planned new/u);
  });
});

describe("member directory receipts", () => {
  it("accepts a well-formed dry-run receipt", () => {
    expect(memberDirectoryOperationReceiptSchema.parse(baseReceipt).operationId).toBe(
      "op-2026-09-07-forward",
    );
  });

  /**
   * Invariant 18: no names, contacts, tax or card identifiers, no raw source values. `strictObject`
   * is what enforces it - an extra field is a parse failure, not a silently stored column.
   */
  it("refuses any field the spec does not list, which is how PII stays out", () => {
    for (const extra of ["memberName", "email", "membershipNumber", "sourceRow"]) {
      expect(() =>
        memberDirectoryOperationReceiptSchema.parse({ ...baseReceipt, [extra]: "x" }),
      ).toThrow();
    }
  });

  it("enforces the capacity bound inside the receipt itself", () => {
    expect(() =>
      memberDirectoryOperationReceiptSchema.parse({
        ...baseReceipt,
        preExistingAdmittedStudentCount: 399,
        plannedNewStudentCount: 2,
        postCutoverAdmittedStudentCount: 401,
      }),
    ).toThrow();
  });

  it("requires expiry to follow the effective date", () => {
    expect(() =>
      memberDirectoryOperationReceiptSchema.parse({
        ...baseReceipt,
        expiresAt: baseReceipt.effectiveDate,
      }),
    ).toThrow();
  });

  it("accepts a chunk receipt carrying only MACs and counts", () => {
    const receipt = memberDirectoryChunkReceiptSchema.parse({
      ...baseChunkReceipt,
      writtenCount: 25,
      quarantinedCount: 3,
    });

    expect(receipt.outputSetMac).toHaveLength(64);
  });

  it("rejects a non-hex output MAC", () => {
    expect(() =>
      memberDirectoryChunkReceiptSchema.parse({
        ...baseChunkReceipt,
        outputSetMac: "G".repeat(64),
      }),
    ).toThrow();
  });

  /**
   * The ID is derived from three fields that are also stored, so it can disagree with them. A
   * receipt whose ID says chunk 1 while its body says chunk 2 would make the gapless-sequence check
   * meaningless, since the two are read from different places.
   */
  it("rejects a chunk ID that disagrees with its own operation, phase or number", () => {
    expect(() =>
      memberDirectoryChunkReceiptSchema.parse({ ...baseChunkReceipt, chunkNo: 2 }),
    ).toThrow();
    expect(() =>
      memberDirectoryChunkReceiptSchema.parse({ ...baseChunkReceipt, phase: "bootstrap" }),
    ).toThrow();
  });

  it("requires a compensation chunk to bind the forward chunk it reverses", () => {
    expect(() =>
      memberDirectoryChunkReceiptSchema.parse({
        ...baseChunkReceipt,
        chunkId: "op-1:compensation:1",
        phase: "compensation",
      }),
    ).toThrow(/must bind the forward chunk/u);

    expect(
      memberDirectoryChunkReceiptSchema.parse({
        ...baseChunkReceipt,
        chunkId: "op-1:compensation:1",
        phase: "compensation",
        sourceForwardChunkNo: 8,
      }).sourceForwardChunkNo,
    ).toBe(8);
  });

  it("refuses a source forward chunk on any phase but compensation", () => {
    expect(() =>
      memberDirectoryChunkReceiptSchema.parse({ ...baseChunkReceipt, sourceForwardChunkNo: 1 }),
    ).toThrow(/Only a compensation chunk/u);
  });
});

describe("member directory compensation ordering", () => {
  it("accepts forward chunks reversed in descending order", () => {
    expect(() => {
      assertCompensationReversesDescending([8, 7, 6, 5]);
    }).not.toThrow();
    expect(() => {
      assertCompensationReversesDescending([1]);
    }).not.toThrow();
  });

  it("rejects ascending or repeated source chunks", () => {
    expect(() => {
      assertCompensationReversesDescending([5, 6]);
    }).toThrow(/descending order/u);
    expect(() => {
      assertCompensationReversesDescending([5, 5]);
    }).toThrow(/descending order/u);
  });
});
