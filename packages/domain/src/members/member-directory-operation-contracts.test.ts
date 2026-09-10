import { describe, expect, it } from "vitest";

import { memberDirectoryDryRunClassifications } from "./member-directory-migration-contracts";
import {
  assertLeaseRecoveryWithinDeadline,
  assertLeaseRenewable,
  assertMemberDirectoryOperationStatusTransition,
  assertPostDeadlineRecoveryDeadline,
  isLeaseExpired,
  isMemberDirectoryOperationStatusTransitionAllowed,
  maxInitialOperationDeadlineMs,
  memberDirectoryLeaseDurationSeconds,
  memberDirectoryOperationDocumentSchema,
  memberDirectoryOperationStatuses,
  memberDirectoryOperationTypes,
  memberDirectoryTerminalStatuses,
  planMemberDirectoryOperationChunkStatus,
  planMemberDirectoryOperationStatusChange,
} from "./member-directory-operation-contracts";
import type {
  MemberDirectoryOperationStatus,
  MemberDirectoryOperationType,
} from "./member-directory-operation-contracts";

function allowed(
  operationType: MemberDirectoryOperationType,
): readonly (readonly [MemberDirectoryOperationStatus, MemberDirectoryOperationStatus])[] {
  const pairs: (readonly [MemberDirectoryOperationStatus, MemberDirectoryOperationStatus])[] = [];
  for (const from of memberDirectoryOperationStatuses) {
    for (const to of memberDirectoryOperationStatuses) {
      if (isMemberDirectoryOperationStatusTransitionAllowed({ operationType, from, to })) {
        pairs.push([from, to]);
      }
    }
  }
  return pairs;
}

describe("member directory operation status transitions", () => {
  it("allows exactly the normal success path for a plain forward operation", () => {
    for (const [from, to] of [
      ["planned", "frozen"],
      ["frozen", "applying"],
      ["applying", "verified"],
      ["verified", "completed"],
    ] as const) {
      expect(() => {
        assertMemberDirectoryOperationStatusTransition({
          operationType: "directory-forward",
          from,
          to,
        });
      }).not.toThrow();
    }
  });

  it("never lets a terminal status move anywhere", () => {
    for (const operationType of memberDirectoryOperationTypes) {
      for (const from of memberDirectoryTerminalStatuses) {
        for (const to of memberDirectoryOperationStatuses) {
          expect(
            isMemberDirectoryOperationStatusTransitionAllowed({ operationType, from, to }),
          ).toBe(false);
        }
      }
    }
  });

  it("skips no step: frozen cannot jump straight to verified or completed", () => {
    for (const to of ["verified", "completed"] as const) {
      expect(
        isMemberDirectoryOperationStatusTransitionAllowed({
          operationType: "directory-forward",
          from: "frozen",
          to,
        }),
      ).toBe(false);
    }
  });

  /**
   * The reverse path belongs to directory-forward alone. Letting any other operation type
   * compensate would mean reversing writes whose reference closure was never designed.
   */
  it("permits failed -> compensating only for directory-forward", () => {
    expect(
      isMemberDirectoryOperationStatusTransitionAllowed({
        operationType: "directory-forward",
        from: "failed",
        to: "compensating",
      }),
    ).toBe(true);

    for (const operationType of memberDirectoryOperationTypes.filter(
      (candidate) => candidate !== "directory-forward",
    )) {
      expect(
        isMemberDirectoryOperationStatusTransitionAllowed({
          operationType,
          from: "failed",
          to: "compensating",
        }),
      ).toBe(false);
    }
  });

  it("permits the metadata-only failed -> aborted abandonment only for identity-key-bootstrap", () => {
    expect(
      isMemberDirectoryOperationStatusTransitionAllowed({
        operationType: "identity-key-bootstrap",
        from: "failed",
        to: "aborted",
      }),
    ).toBe(true);
    expect(
      isMemberDirectoryOperationStatusTransitionAllowed({
        operationType: "directory-forward",
        from: "failed",
        to: "aborted",
      }),
    ).toBe(false);
  });

  it("permits the short planned -> completed path only for global-legacy-elimination", () => {
    expect(
      isMemberDirectoryOperationStatusTransitionAllowed({
        operationType: "global-legacy-elimination",
        from: "planned",
        to: "completed",
      }),
    ).toBe(true);
    for (const operationType of memberDirectoryOperationTypes.filter(
      (candidate) => candidate !== "global-legacy-elimination",
    )) {
      expect(
        isMemberDirectoryOperationStatusTransitionAllowed({
          operationType,
          from: "planned",
          to: "completed",
        }),
      ).toBe(false);
    }
  });

  /**
   * Pins the whole table for the most dangerous operation type, so that widening it anywhere is a
   * visible test change rather than a quiet new edge.
   */
  it("pins the complete edge set for directory-forward", () => {
    expect(allowed("directory-forward")).toEqual([
      ["planned", "frozen"],
      ["frozen", "applying"],
      ["frozen", "failed"],
      ["applying", "verified"],
      ["applying", "failed"],
      ["verified", "completed"],
      ["verified", "failed"],
      ["failed", "applying"],
      ["failed", "compensating"],
      ["compensating", "aborted"],
    ]);
  });
});

describe("member directory lease", () => {
  const now = "2026-09-07T12:00:00.000Z";

  it("treats the expiry instant itself as expired", () => {
    expect(isLeaseExpired({ leaseExpiresAt: now, now })).toBe(true);
    expect(isLeaseExpired({ leaseExpiresAt: "2026-09-07T12:00:00.001Z", now })).toBe(false);
  });

  it("lasts 120 seconds", () => {
    expect(memberDirectoryLeaseDurationSeconds).toBe(120);
  });

  it("renews for the same operation and owner before expiry", () => {
    expect(() => {
      assertLeaseRenewable({
        currentOperationId: "op-1",
        currentLeaseOwner: "runner-a",
        currentLeaseExpiresAt: "2026-09-07T12:01:00.000Z",
        operationDeadline: "2026-09-07T12:30:00.000Z",
        requestedBy: "runner-a",
        requestedOperationId: "op-1",
        now,
      });
    }).not.toThrow();
  });

  it("refuses a steal by another owner or another operation", () => {
    const base = {
      currentOperationId: "op-1",
      currentLeaseOwner: "runner-a",
      currentLeaseExpiresAt: "2026-09-07T12:01:00.000Z",
      operationDeadline: "2026-09-07T12:30:00.000Z",
      now,
    };
    expect(() => {
      assertLeaseRenewable({
        ...base,
        requestedBy: "runner-b",
        requestedOperationId: "op-1",
      });
    }).toThrow(/different owner/u);
    expect(() => {
      assertLeaseRenewable({
        ...base,
        requestedBy: "runner-a",
        requestedOperationId: "op-2",
      });
    }).toThrow(/different operation/u);
  });

  /**
   * The point of the whole freeze: an expired lease is not renewable by its own owner either. It
   * has to go through audited recovery, so expiry never becomes a way around authorization.
   */
  it("refuses to renew an expired lease even for its rightful owner", () => {
    expect(() => {
      assertLeaseRenewable({
        currentOperationId: "op-1",
        currentLeaseOwner: "runner-a",
        currentLeaseExpiresAt: "2026-09-07T11:59:59.999Z",
        operationDeadline: "2026-09-07T12:30:00.000Z",
        requestedBy: "runner-a",
        requestedOperationId: "op-1",
        now,
      });
    }).toThrow(/audited recovery/u);
  });

  it("refuses a renewal that would outlive the operation deadline", () => {
    expect(() => {
      assertLeaseRenewable({
        currentOperationId: "op-1",
        currentLeaseOwner: "runner-a",
        currentLeaseExpiresAt: "2026-09-07T12:00:30.000Z",
        operationDeadline: "2026-09-07T12:01:00.000Z",
        requestedBy: "runner-a",
        requestedOperationId: "op-1",
        now,
      });
    }).toThrow(/outlive the operation deadline/u);
  });
});

describe("member directory operation deadlines", () => {
  it("caps a normal initial deadline at 30 minutes", () => {
    expect(
      maxInitialOperationDeadlineMs({ operationType: "directory-forward", pagedV2: false }),
    ).toBe(30 * 60 * 1000);
  });

  it("gives the paged identity reconcile two hours, and only it", () => {
    expect(
      maxInitialOperationDeadlineMs({ operationType: "identity-key-reconcile", pagedV2: true }),
    ).toBe(2 * 60 * 60 * 1000);
    expect(() =>
      maxInitialOperationDeadlineMs({ operationType: "directory-forward", pagedV2: true }),
    ).toThrow(/paged-v2/u);
  });

  it("allows in-deadline recovery only when a full lease still fits", () => {
    expect(() => {
      assertLeaseRecoveryWithinDeadline({
        operationDeadline: "2026-09-07T12:30:00.000Z",
        now: "2026-09-07T12:00:00.000Z",
      });
    }).not.toThrow();
    expect(() => {
      assertLeaseRecoveryWithinDeadline({
        operationDeadline: "2026-09-07T12:00:30.000Z",
        now: "2026-09-07T12:00:00.000Z",
      });
    }).toThrow(/post-deadline recovery/u);
  });

  /**
   * Post-deadline recovery grants a fresh 30-minute window, never an extension of the original and
   * never the two-hour paged bound - that one only ever applies to an initial unextended run.
   */
  it("bounds a post-deadline recovery deadline to 30 minutes from now", () => {
    expect(() => {
      assertPostDeadlineRecoveryDeadline({
        now: "2026-09-07T12:00:00.000Z",
        recoveryDeadline: "2026-09-07T12:30:00.000Z",
      });
    }).not.toThrow();
    expect(() => {
      assertPostDeadlineRecoveryDeadline({
        now: "2026-09-07T12:00:00.000Z",
        recoveryDeadline: "2026-09-07T12:30:00.001Z",
      });
    }).toThrow(/within 30 minutes/u);
    expect(() => {
      assertPostDeadlineRecoveryDeadline({
        now: "2026-09-07T12:00:00.000Z",
        recoveryDeadline: "2026-09-07T12:00:00.000Z",
      });
    }).toThrow(/must be in the future/u);
  });
});

const bootstrapReceipt = {
  operationId: "op-bootstrap-1",
  academyId: "academy-bpt-jersey",
  phase: "bootstrap",
  targetProjectClassification: "emulator",
  codeVersion: "9a9d839",
  schemaVersion: "1",
  effectiveDate: "2026-09-07T10:00:00.000Z",
  expiresAt: "2026-09-07T12:00:00.000Z",
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
} as const;

function operationDocument(overrides: Readonly<Record<string, unknown>> = {}) {
  return memberDirectoryOperationDocumentSchema.parse({
    operationId: "op-bootstrap-1",
    academyId: "academy-bpt-jersey",
    operationType: "identity-key-bootstrap",
    status: "frozen",
    receipt: bootstrapReceipt,
    statusAuditEventId: "audit-1",
    statusChangedAt: "2026-09-07T11:00:00.000Z",
    statusChangedBy: "runner-a",
    schemaVersion: "1",
    createdAt: "2026-09-07T10:00:00.000Z",
    createdBy: "operator",
    ...overrides,
  });
}

describe("member directory parent operation document", () => {
  it("binds its receipt to its own operation, academy and phase", () => {
    expect(operationDocument().receipt.phase).toBe("bootstrap");

    expect(() =>
      operationDocument({ receipt: { ...bootstrapReceipt, operationId: "op-other" } }),
    ).toThrow();
    expect(() =>
      operationDocument({ receipt: { ...bootstrapReceipt, academyId: "academy-other" } }),
    ).toThrow();
  });

  /**
   * A phase an operation type never runs would make the document describe work that cannot happen,
   * and the chunk receipts filed under it would have no parent that admits them.
   */
  it("refuses a phase its operation type never runs", () => {
    expect(() =>
      operationDocument({
        receipt: { ...bootstrapReceipt, phase: "forward" },
      }),
    ).toThrow(/cannot run the forward phase/u);
  });

  /** Compensation runs under the same operation as its forward, which is why both are allowed. */
  it("lets a directory-forward operation own both its forward and its compensation", () => {
    for (const phase of ["forward", "compensation"] as const) {
      const document = operationDocument({
        operationId: "op-forward-1",
        operationType: "directory-forward",
        receipt: { ...bootstrapReceipt, operationId: "op-forward-1", phase },
      });
      expect(document.receipt.phase).toBe(phase);
    }
  });

  it("refuses global-legacy-elimination, which owns no chunk phase", () => {
    expect(() => operationDocument({ operationType: "global-legacy-elimination" })).toThrow();
  });

  it("refuses a status change that is not in the transition table", () => {
    expect(() =>
      planMemberDirectoryOperationStatusChange({
        current: operationDocument({ status: "completed" }),
        toStatus: "applying",
        auditEventId: "audit-2",
        now: "2026-09-07T12:00:00.000Z",
        actorId: "runner-a",
      }),
    ).toThrow(/cannot move from completed to applying/u);
  });

  /**
   * The receipt is nested rather than spread precisely so this holds by construction: a transition
   * has no field of the evidence block it could rewrite.
   */
  it("carries the receipt through a status change untouched", () => {
    const current = operationDocument();
    const next = planMemberDirectoryOperationStatusChange({
      current,
      toStatus: "applying",
      auditEventId: "audit-2",
      now: "2026-09-07T12:00:00.000Z",
      actorId: "runner-a",
    });

    expect(next.status).toBe("applying");
    expect(next.statusAuditEventId).toBe("audit-2");
    expect(next.receipt).toEqual(current.receipt);
    expect(next.createdAt).toBe(current.createdAt);
  });

  it("refuses a transition stamped before the one it follows", () => {
    expect(() =>
      planMemberDirectoryOperationStatusChange({
        current: operationDocument(),
        toStatus: "applying",
        auditEventId: "audit-2",
        now: "2026-09-07T10:30:00.000Z",
        actorId: "runner-a",
      }),
    ).toThrow(/backwards in time/u);
  });

  describe("the parent's half of a chunk commit", () => {
    const chunkStatus = (
      current: ReturnType<typeof operationDocument>,
      chunkNo: number,
      phase: "bootstrap" | "compensation" = "bootstrap",
    ) =>
      planMemberDirectoryOperationChunkStatus({
        current,
        phase,
        chunkNo,
        auditEventId: "audit-2",
        now: "2026-09-07T12:00:00.000Z",
        actorId: "runner-a",
      });

    it("moves frozen to applying on the first committed chunk", () => {
      expect(chunkStatus(operationDocument(), 1)?.status).toBe("applying");
    });

    /** Returning nothing, rather than the same document, leaves the caller with nothing to write. */
    it("changes nothing on a later chunk", () => {
      expect(chunkStatus(operationDocument({ status: "applying" }), 2)).toBeUndefined();
    });

    /**
     * A compensation chunk runs under `compensating`. The phase change is what authorised it, and
     * that already happened; moving the parent again here would file a second transition for it.
     */
    it("changes nothing while compensating", () => {
      const compensating = operationDocument({
        operationId: "op-forward-1",
        operationType: "directory-forward",
        status: "compensating",
        receipt: { ...bootstrapReceipt, operationId: "op-forward-1", phase: "compensation" },
      });
      expect(chunkStatus(compensating, 1, "compensation")).toBeUndefined();
    });

    it("refuses a frozen operation whose first chunk is not chunk 1", () => {
      expect(() => chunkStatus(operationDocument(), 2)).toThrow(
        /only be moved by its first chunk/u,
      );
    });

    it("refuses a chunk while the operation is verified, completed or failed", () => {
      for (const status of ["verified", "completed", "failed"] as const) {
        expect(() => chunkStatus(operationDocument({ status }), 1)).toThrow(
          new RegExp(`cannot commit while its operation is ${status}`, "u"),
        );
      }
    });

    it("refuses a chunk whose phase its operation type never runs", () => {
      expect(() => chunkStatus(operationDocument(), 1, "compensation")).toThrow(
        /cannot commit a compensation chunk/u,
      );
    });
  });
});
