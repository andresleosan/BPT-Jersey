import { describe, expect, it } from "vitest";

import {
  assertLeaseRecoveryWithinDeadline,
  assertLeaseRenewable,
  assertMemberDirectoryOperationStatusTransition,
  assertPostDeadlineRecoveryDeadline,
  isLeaseExpired,
  isMemberDirectoryOperationStatusTransitionAllowed,
  maxInitialOperationDeadlineMs,
  memberDirectoryLeaseDurationSeconds,
  memberDirectoryOperationStatuses,
  memberDirectoryOperationTypes,
  memberDirectoryTerminalStatuses,
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
