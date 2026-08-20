import { describe, expect, it } from "vitest";

import type { MembershipRecord, MembershipStatus } from "@bpt-jersey/domain/memberships/lifecycle";

import {
  FinancialAccessServiceError,
  createFinancialAccessService,
  type FinancialAccessServiceDependencies,
} from "./financial-access-service.js";
import type { FinancialAccountView } from "./finance-service.js";

const academyId = "academy-1";
const membershipId = "membership-1";
const familyId = "family-1";
const studentId = "student-1";
const now = "2026-08-19T10:00:00.000Z";

function membership(
  status: MembershipStatus = "active",
  overrides: Partial<MembershipRecord> = {},
): MembershipRecord {
  return {
    membershipId,
    academyId,
    familyId,
    studentId,
    planId: "bpt-jersey-adult",
    status,
    startsAt: now,
    endsAt: null,
    nextBillingAt: null,
    schemaVersion: "1",
    createdAt: now,
    createdBy: "creator-1",
    updatedAt: now,
    updatedBy: "creator-1",
    ...overrides,
  };
}

function account(paygDebtMinor: number): FinancialAccountView {
  return { invoices: [], balanceMinor: paygDebtMinor, paygDebtMinor };
}

function doubles(
  storedMembership?: MembershipRecord,
  storedAccount: FinancialAccountView = account(0),
) {
  const resolvedMembership = arguments.length === 0 ? membership() : storedMembership;
  const membershipScopes: unknown[] = [];
  const financialScopes: unknown[] = [];
  let currentAccount = storedAccount;
  const dependencies: FinancialAccessServiceDependencies = {
    getMembership: async (scope, requestedMembershipId) => {
      membershipScopes.push([scope, requestedMembershipId]);
      return resolvedMembership;
    },
    listFinancialAccount: async (scope) => {
      financialScopes.push(scope);
      return currentAccount;
    },
  };
  return {
    dependencies,
    membershipScopes,
    financialScopes,
    setAccount(nextAccount: FinancialAccountView) {
      currentAccount = nextAccount;
    },
  };
}

describe("financial access service", () => {
  it("allows active and trial memberships with zero derived PAYG debt", async () => {
    for (const status of ["active", "trial"] as const) {
      const service = createFinancialAccessService(
        doubles(membership(status), account(0)).dependencies,
      );

      await expect(service.getAccessDecision({ academyId, membershipId })).resolves.toMatchObject({
        academyId,
        membershipId,
        studentId,
        membershipStatus: status,
        paygDebtMinor: 0,
        decision: {
          allowed: true,
          code: "ALLOWED",
        },
      });
    }
  });

  it("denies active and trial memberships with positive derived PAYG debt", async () => {
    for (const status of ["active", "trial"] as const) {
      const service = createFinancialAccessService(
        doubles(membership(status), account(1000)).dependencies,
      );

      await expect(service.getAccessDecision({ academyId, membershipId })).resolves.toMatchObject({
        membershipStatus: status,
        paygDebtMinor: 1000,
        decision: {
          allowed: false,
          code: "PAYG_DEBT_OUTSTANDING",
        },
      });
    }
  });

  it("denies every inaccessible membership regardless of derived debt", async () => {
    for (const status of ["paused", "overdue", "cancelled"] as const) {
      for (const debt of [0, 1000]) {
        const service = createFinancialAccessService(
          doubles(membership(status), account(debt)).dependencies,
        );

        await expect(service.getAccessDecision({ academyId, membershipId })).resolves.toMatchObject(
          {
            membershipStatus: status,
            paygDebtMinor: debt,
            decision: {
              allowed: false,
              code: "MEMBERSHIP_NOT_ACCESSIBLE",
            },
          },
        );
      }
    }
  });

  it("recovers access when the derived debt changes from positive to zero", async () => {
    const testDoubles = doubles(membership("active"), account(1000));
    const service = createFinancialAccessService(testDoubles.dependencies);

    await expect(service.getAccessDecision({ academyId, membershipId })).resolves.toMatchObject({
      paygDebtMinor: 1000,
      decision: { code: "PAYG_DEBT_OUTSTANDING" },
    });

    testDoubles.setAccount(account(0));

    await expect(service.getAccessDecision({ academyId, membershipId })).resolves.toMatchObject({
      paygDebtMinor: 0,
      decision: { allowed: true, code: "ALLOWED" },
    });
  });

  it("passes exact stored membership and student scopes to the read stores", async () => {
    const testDoubles = doubles();
    const service = createFinancialAccessService(testDoubles.dependencies);

    await service.getAccessDecision({ academyId, membershipId });

    expect(testDoubles.membershipScopes).toEqual([
      [{ academyId, membershipIds: [membershipId] }, membershipId],
    ]);
    expect(testDoubles.financialScopes).toEqual([
      { academyId, familyIds: [familyId], studentIds: [studentId] },
    ]);
  });

  it("rejects invalid identifiers before reading either store", async () => {
    const testDoubles = doubles();
    const service = createFinancialAccessService(testDoubles.dependencies);

    for (const input of [
      { academyId: "../academy", membershipId },
      { academyId, membershipId: "/membership" },
      { academyId: "", membershipId },
    ]) {
      await expect(service.getAccessDecision(input)).rejects.toMatchObject({
        code: "invalid",
        message: "Financial access request is invalid",
      });
    }
    expect(testDoubles.membershipScopes).toEqual([]);
    expect(testDoubles.financialScopes).toEqual([]);
  });

  it("uses a generic not-found error for a missing membership", async () => {
    const testDoubles = doubles(undefined);
    const service = createFinancialAccessService(testDoubles.dependencies);

    await expect(service.getAccessDecision({ academyId, membershipId })).rejects.toEqual(
      new FinancialAccessServiceError("not-found", "Financial access is not available"),
    );
    expect(testDoubles.financialScopes).toEqual([]);
  });

  it("rejects stored membership tenant and identity mismatches before financial reads", async () => {
    for (const mismatchedMembership of [
      membership("active", { academyId: "academy-2" }),
      membership("active", { membershipId: "membership-2" }),
    ]) {
      const testDoubles = doubles(mismatchedMembership);
      const service = createFinancialAccessService(testDoubles.dependencies);

      await expect(service.getAccessDecision({ academyId, membershipId })).rejects.toMatchObject({
        code: "tenant",
        message: "Financial access is not available",
      });
      expect(testDoubles.financialScopes).toEqual([]);
    }
  });

  it("rejects malformed financial results without treating debt as zero", async () => {
    for (const malformedAccount of [
      { invoices: [], balanceMinor: 0, paygDebtMinor: -1 },
      { invoices: [], balanceMinor: 0, paygDebtMinor: Number.NaN },
      { invoices: [], balanceMinor: 0 },
    ]) {
      const testDoubles = doubles(membership(), malformedAccount as FinancialAccountView);
      const service = createFinancialAccessService(testDoubles.dependencies);

      await expect(service.getAccessDecision({ academyId, membershipId })).rejects.toMatchObject({
        code: "invalid",
        message: "Financial access data is invalid",
      });
    }
  });

  it("rejects financial results with inherited required fields", async () => {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, "paygDebtMinor");
    Object.defineProperty(Object.prototype, "paygDebtMinor", {
      configurable: true,
      enumerable: false,
      value: 0,
      writable: true,
    });

    try {
      const malformedAccount = { invoices: [], balanceMinor: 0 } as unknown as FinancialAccountView;
      const testDoubles = doubles(membership(), malformedAccount);
      const service = createFinancialAccessService(testDoubles.dependencies);

      await expect(service.getAccessDecision({ academyId, membershipId })).rejects.toMatchObject({
        code: "invalid",
        message: "Financial access data is invalid",
      });
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(Object.prototype, "paygDebtMinor");
      } else {
        Object.defineProperty(Object.prototype, "paygDebtMinor", original);
      }
    }
  });

  it("preserves known service errors and wraps unknown dependency failures", async () => {
    const knownError = new FinancialAccessServiceError(
      "tenant",
      "Financial access is not available",
    );
    const knownService = createFinancialAccessService({
      getMembership: async () => {
        throw knownError;
      },
      listFinancialAccount: async () => account(0),
    });
    await expect(knownService.getAccessDecision({ academyId, membershipId })).rejects.toBe(
      knownError,
    );

    const unknownService = createFinancialAccessService({
      getMembership: async () => {
        throw new Error("raw dependency details");
      },
      listFinancialAccount: async () => account(0),
    });
    await expect(unknownService.getAccessDecision({ academyId, membershipId })).rejects.toEqual(
      new FinancialAccessServiceError("transaction", "Financial access could not be evaluated"),
    );
  });

  it("returns an immutable view and exposes only read-only service behavior", async () => {
    const testDoubles = doubles();
    const service = createFinancialAccessService(testDoubles.dependencies);
    const view = await service.getAccessDecision({ academyId, membershipId });

    expect(Object.keys(testDoubles.dependencies)).toEqual([
      "getMembership",
      "listFinancialAccount",
    ]);
    expect(Object.keys(service)).toEqual(["getAccessDecision"]);
    expect(Object.isFrozen(service)).toBe(true);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.decision)).toBe(true);
    expect(() => Object.defineProperty(view, "paygDebtMinor", { value: 999 })).toThrow();
    expect(view).not.toHaveProperty("invoices");
    expect(view).not.toHaveProperty("familyId");
  });
});
