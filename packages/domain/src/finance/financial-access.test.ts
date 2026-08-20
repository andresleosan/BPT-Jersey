import { describe, expect, it } from "vitest";

import { membershipStatuses, type MembershipStatus } from "../memberships/membership-contracts";
import { evaluateFinancialAccess, type FinancialAccessDecision } from "./financial-access";

function input(
  membershipStatus: MembershipStatus = "active",
  paygDebtMinor = 0,
): { membershipStatus: MembershipStatus; paygDebtMinor: number } {
  return { membershipStatus, paygDebtMinor };
}

describe("financial access policy", () => {
  it("allows active and trial memberships with zero PAYG debt", () => {
    expect(evaluateFinancialAccess(input("active"))).toEqual({
      allowed: true,
      code: "ALLOWED",
      membershipStatus: "active",
      paygDebtMinor: 0,
    });
    expect(evaluateFinancialAccess(input("trial"))).toEqual({
      allowed: true,
      code: "ALLOWED",
      membershipStatus: "trial",
      paygDebtMinor: 0,
    });
  });

  it("denies PAYG debt for active and trial memberships", () => {
    for (const membershipStatus of ["active", "trial"] as const) {
      expect(evaluateFinancialAccess(input(membershipStatus, 1))).toEqual({
        allowed: false,
        code: "PAYG_DEBT_OUTSTANDING",
        membershipStatus,
        paygDebtMinor: 1,
      });
    }
  });

  it("denies every inaccessible membership regardless of debt", () => {
    for (const membershipStatus of ["paused", "overdue", "cancelled"] as const) {
      for (const paygDebtMinor of [0, 1]) {
        expect(evaluateFinancialAccess(input(membershipStatus, paygDebtMinor))).toEqual({
          allowed: false,
          code: "MEMBERSHIP_NOT_ACCESSIBLE",
          membershipStatus,
          paygDebtMinor,
        });
      }
    }
  });

  it("rejects invalid debt values without treating them as zero", () => {
    for (const paygDebtMinor of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity]) {
      expect(evaluateFinancialAccess(input("active", paygDebtMinor))).toEqual({
        allowed: false,
        code: "INVALID_INPUT",
        membershipStatus: null,
        paygDebtMinor: 0,
      });
    }
  });

  it("rejects unknown statuses and non-object inputs", () => {
    const invalidValues: readonly unknown[] = [
      input("unknown" as MembershipStatus),
      null,
      [],
      "active",
      1,
      { membershipStatus: "active" },
      { paygDebtMinor: 0 },
    ];

    for (const value of invalidValues) {
      expect(evaluateFinancialAccess(value)).toEqual({
        allowed: false,
        code: "INVALID_INPUT",
        membershipStatus: null,
        paygDebtMinor: 0,
      });
    }
  });

  it("rejects extra, accessor, non-enumerable, and hostile-prototype properties", () => {
    const extra = { ...input(), reason: "manual override" };
    const symbol = { ...input(), [Symbol("unexpected")]: true };
    const accessor = { ...input() };
    Object.defineProperty(accessor, "paygDebtMinor", {
      enumerable: true,
      get: () => {
        throw new Error("hostile getter");
      },
    });
    const nonEnumerable = { ...input() };
    Object.defineProperty(nonEnumerable, "hidden", { value: true });
    const hostilePrototype = Object.assign(Object.create({ inherited: true }), input());
    const cases = [extra, symbol, accessor, nonEnumerable, hostilePrototype];

    for (const value of cases) {
      expect(() => evaluateFinancialAccess(value)).not.toThrow();
      expect(evaluateFinancialAccess(value)).toEqual({
        allowed: false,
        code: "INVALID_INPUT",
        membershipStatus: null,
        paygDebtMinor: 0,
      });
    }
  });

  it("accepts only the exact policy fields", () => {
    for (const membershipStatus of membershipStatuses) {
      expect(evaluateFinancialAccess({ membershipStatus, paygDebtMinor: 0 })).toMatchObject({
        membershipStatus,
      });
    }
    expect(
      evaluateFinancialAccess({ membershipStatus: "active", paygDebtMinor: 0, actor: "owner" }),
    ).toEqual({
      allowed: false,
      code: "INVALID_INPUT",
      membershipStatus: null,
      paygDebtMinor: 0,
    });
  });

  it("returns frozen decisions", () => {
    const decisions: readonly FinancialAccessDecision[] = [
      evaluateFinancialAccess(input("active")),
      evaluateFinancialAccess(input("active", 1)),
      evaluateFinancialAccess(null),
    ];

    for (const decision of decisions) {
      expect(Object.isFrozen(decision)).toBe(true);
      expect(() => Object.defineProperty(decision, "paygDebtMinor", { value: 999 })).toThrow();
    }
  });
});
