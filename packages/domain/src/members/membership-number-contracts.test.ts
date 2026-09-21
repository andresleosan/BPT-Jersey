import { describe, expect, it } from "vitest";

import { ok } from "../result";
import {
  canonicalMembershipNumberSchema,
  canonicaliseMembershipNumber,
  membershipNumberPlanPayloadSchema,
  membershipNumberPlanSchema,
  nextMonotonicMembershipNumber,
} from "./membership-number-contracts";

describe("membership number contracts", () => {
  it("canonicalises inherited prefixes, whitespace and leading zeroes", () => {
    expect(canonicaliseMembershipNumber("#0033")).toEqual(ok("33"));
    expect(canonicaliseMembershipNumber(" 0033 ")).toEqual(ok("33"));
    expect(canonicalMembershipNumberSchema.parse("#000001")).toBe("1");
  });

  it("rejects non-positive, non-decimal and out-of-range values", () => {
    for (const value of ["0", "-1", "3.3", "A33", "#", "1000000000", "1".repeat(65)]) {
      expect(canonicaliseMembershipNumber(value).ok).toBe(false);
      expect(canonicalMembershipNumberSchema.safeParse(value).success).toBe(false);
    }
  });

  it("allocates monotonically above every canonicalisable historical value", () => {
    expect(nextMonotonicMembershipNumber(["1", "33", "00099", "A-7"])).toBe("100");
    expect(nextMonotonicMembershipNumber([])).toBe("1");
    expect(() => nextMonotonicMembershipNumber(["999999999"])).toThrow(
      "Membership number sequence is exhausted",
    );
  });
});

describe("membership number reconciliation artefact", () => {
  const payload = {
    academyId: "academy-1",
    generatedAt: "2026-09-21T04:00:00.000Z",
    rows: [
      {
        recordRef: "members/legacy-a",
        sourceKind: "legacy",
        ownerId: "legacy-a",
        sourceVersion: "version-1",
        currentMasked: "******33",
        action: "reassign",
        proposed: "34",
      },
    ],
    schemaVersion: "1",
  } as const;

  it("keeps the payload and hashed plan closed", () => {
    expect(membershipNumberPlanPayloadSchema.safeParse(payload).success).toBe(true);
    expect(
      membershipNumberPlanSchema.safeParse({ ...payload, contentHash: "a".repeat(64) }).success,
    ).toBe(true);
    expect(
      membershipNumberPlanSchema.safeParse({
        ...payload,
        contentHash: "a".repeat(64),
        membershipNumber: "33",
      }).success,
    ).toBe(false);
    expect(
      membershipNumberPlanSchema.safeParse({ ...payload, contentHash: "not-a-hash" }).success,
    ).toBe(false);
  });
});
