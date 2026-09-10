import { describe, expect, it } from "vitest";

import { planIds } from "./plan-contracts";
import {
  canTransitionMembership,
  currentMembershipStatuses,
  membershipStatuses,
  membershipTransitionTargets,
  parseMembershipDraft,
  parseMembershipRecord,
  type MembershipDraft,
  type MembershipRecord,
} from "./membership-contracts";

const draftFields = [
  "familyId",
  "studentId",
  "planId",
  "status",
  "startsAt",
  "endsAt",
  "nextBillingAt",
] as const;

const recordFields = [
  ...draftFields,
  "membershipId",
  "academyId",
  "schemaVersion",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
] as const;

const validDraft: MembershipDraft = {
  familyId: "family-1",
  studentId: "student-1",
  planId: planIds[0],
  status: "trial",
  startsAt: "2026-08-19T10:00:00Z",
  endsAt: null,
  nextBillingAt: "2026-09-19T10:00:00+00:00",
};

function record(overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    ...validDraft,
    membershipId: "membership-1",
    academyId: "academy-1",
    schemaVersion: "1",
    createdAt: "2026-08-19T10:00:00Z",
    createdBy: "user-1",
    updatedAt: "2026-08-19T10:00:00Z",
    updatedBy: "user-1",
    ...overrides,
  };
}

describe("membership contracts", () => {
  it("publishes frozen statuses and the exact transition table", () => {
    expect(membershipStatuses).toEqual(["trial", "active", "paused", "overdue", "cancelled"]);
    expect(currentMembershipStatuses).toEqual(["trial", "active", "paused", "overdue"]);
    expect(membershipTransitionTargets).toEqual({
      trial: ["active", "cancelled"],
      active: ["paused", "overdue", "cancelled"],
      paused: ["active", "cancelled"],
      overdue: ["active", "cancelled"],
      cancelled: [],
    });
    expect(Object.isFrozen(membershipStatuses)).toBe(true);
    expect(Object.isFrozen(currentMembershipStatuses)).toBe(true);
    expect(Object.isFrozen(membershipTransitionTargets)).toBe(true);
    for (const targets of Object.values(membershipTransitionTargets)) {
      expect(Object.isFrozen(targets)).toBe(true);
    }
  });

  it("accepts same-state evaluation but only the approved transitions", () => {
    for (const status of membershipStatuses) {
      expect(canTransitionMembership(status, status)).toBe(true);
    }
    expect(canTransitionMembership("trial", "active")).toBe(true);
    expect(canTransitionMembership("trial", "cancelled")).toBe(true);
    expect(canTransitionMembership("active", "paused")).toBe(true);
    expect(canTransitionMembership("active", "overdue")).toBe(true);
    expect(canTransitionMembership("active", "cancelled")).toBe(true);
    expect(canTransitionMembership("paused", "active")).toBe(true);
    expect(canTransitionMembership("paused", "cancelled")).toBe(true);
    expect(canTransitionMembership("overdue", "active")).toBe(true);
    expect(canTransitionMembership("overdue", "cancelled")).toBe(true);
  });

  it("rejects every invalid transition and keeps cancelled terminal", () => {
    for (const current of membershipStatuses) {
      for (const target of membershipStatuses) {
        const valid = current === target || membershipTransitionTargets[current].includes(target);
        expect(canTransitionMembership(current, target)).toBe(valid);
      }
    }
    expect(canTransitionMembership("cancelled", "trial")).toBe(false);
    expect(canTransitionMembership("cancelled", "active")).toBe(false);
  });

  it("parses and freezes a valid draft with exact fields", () => {
    const result = parseMembershipDraft(validDraft);

    expect(result).toEqual({ ok: true, value: validDraft });
    if (result.ok) {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.keys(result.value)).toEqual(draftFields);
    }
  });

  it("parses and freezes a valid record for each membership status", () => {
    for (const status of membershipStatuses) {
      const result = parseMembershipRecord(record({ status }));
      expect(result).toEqual({ ok: true, value: record({ status }) });
      if (result.ok) {
        expect(Object.isFrozen(result.value)).toBe(true);
        expect(Object.keys(result.value)).toEqual(recordFields);
      }
    }
  });

  it("rejects unknown statuses, invalid IDs, invalid dates, and invalid nullability", () => {
    const cases: readonly unknown[] = [
      { ...validDraft, status: "paused" },
      { ...validDraft, status: "cancelled" },
      { ...validDraft, familyId: "" },
      { ...validDraft, familyId: " family-1" },
      { ...validDraft, studentId: "student/1" },
      { ...validDraft, planId: "unknown-plan" },
      { ...validDraft, startsAt: "2026-02-30T10:00:00Z" },
      { ...validDraft, startsAt: null },
      { ...validDraft, endsAt: 0 },
      { ...validDraft, nextBillingAt: undefined },
      { ...validDraft, nextBillingAt: "2026-08-19" },
      { ...record(), status: "unknown" },
      { ...record(), membershipId: "membership/1" },
      { ...record(), createdAt: "not-a-date" },
      { ...record(), schemaVersion: "2" },
    ];

    for (const value of cases) {
      expect(parseMembershipDraft(value).ok).toBe(false);
      expect(parseMembershipRecord(value).ok).toBe(false);
    }
  });

  it("rejects extra fields, symbols, accessors, non-enumerable fields, and hostile prototypes", () => {
    const extra = { ...validDraft, priceMinor: 1000 };
    const symbol = { ...validDraft, [Symbol("unexpected")]: true };
    const hidden = { ...validDraft };
    Object.defineProperty(hidden, "hidden", { value: true });
    const accessor = { ...validDraft };
    Object.defineProperty(accessor, "familyId", {
      enumerable: true,
      get: () => {
        throw new Error("hostile getter");
      },
    });
    const hostilePrototype = Object.assign(Object.create({ inherited: true }), validDraft);
    const cases = [extra, symbol, hidden, accessor, hostilePrototype];

    for (const value of cases) {
      expect(() => parseMembershipDraft(value)).not.toThrow();
      expect(parseMembershipDraft(value).ok).toBe(false);
    }

    const recordWithGetter = record();
    Object.defineProperty(recordWithGetter, "updatedBy", {
      enumerable: true,
      get: () => {
        throw new Error("hostile record getter");
      },
    });
    expect(() => parseMembershipRecord(recordWithGetter)).not.toThrow();
    expect(parseMembershipRecord(recordWithGetter).ok).toBe(false);
  });

  it("rejects financial and plan-rule fields from both contracts", () => {
    const forbiddenFields = [
      "priceMinor",
      "currency",
      "site",
      "weeklyClassLimit",
      "invoiceId",
      "paymentId",
      "debtMinor",
      "receiptId",
      "provider",
    ];
    for (const field of forbiddenFields) {
      expect(parseMembershipDraft({ ...validDraft, [field]: 1 }).ok).toBe(false);
      expect(parseMembershipRecord({ ...record(), [field]: 1 }).ok).toBe(false);
    }
  });
});
