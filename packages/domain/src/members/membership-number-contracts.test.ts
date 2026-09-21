import { describe, expect, it } from "vitest";

import { ok } from "../result";
import {
  canonicalMembershipNumberSchema,
  canonicaliseMembershipNumber,
  nextMonotonicMembershipNumber,
} from "./membership-number-contracts";

describe("membership number contracts", () => {
  it("canonicalises inherited prefixes, whitespace and leading zeroes", () => {
    expect(canonicaliseMembershipNumber("#0033")).toEqual(ok("33"));
    expect(canonicaliseMembershipNumber(" 0033 ")).toEqual(ok("33"));
    expect(canonicalMembershipNumberSchema.parse("#000001")).toBe("1");
  });

  it("rejects non-positive, non-decimal and out-of-range values", () => {
    for (const value of ["0", "-1", "3.3", "A33", "#", "1000000000"]) {
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
