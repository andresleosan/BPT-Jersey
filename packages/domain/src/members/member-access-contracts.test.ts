import { describe, expect, it } from "vitest";

import {
  allowsOwnSensitiveAccess,
  decideMemberAccess,
  needsAdultClaim,
} from "./member-access-contracts";

describe("needsAdultClaim", () => {
  const base = { via: "self" as const, createdByGuardian: true, adultClaimedAt: null };
  it("asks once, at 18, only for guardian-created own accounts", () => {
    expect(needsAdultClaim({ ...base, age: 17 })).toBe(false);
    expect(needsAdultClaim({ ...base, age: 18 })).toBe(true);
    expect(needsAdultClaim({ ...base, age: 18, adultClaimedAt: "2026-09-24T10:00:00.000Z" })).toBe(
      false,
    );
    expect(needsAdultClaim({ ...base, age: 18, createdByGuardian: false })).toBe(false);
    expect(needsAdultClaim({ ...base, age: 18, via: "guardian" })).toBe(false);
    expect(needsAdultClaim({ ...base, age: null })).toBe(false);
  });
});

describe("decideMemberAccess", () => {
  it("gives own access from 12 and guardian access until 18", () => {
    const base = {
      actorActive: true,
      academyMatches: true,
      memberAccessible: true,
      guardianLinkCurrent: false,
    };
    expect(decideMemberAccess({ ...base, confirmedAge: 11, ownLinkApproved: true })).toEqual({
      allowed: false,
    });
    expect(decideMemberAccess({ ...base, confirmedAge: 12, ownLinkApproved: true })).toEqual({
      allowed: true,
      via: "self",
    });
    expect(
      decideMemberAccess({
        ...base,
        confirmedAge: 17,
        ownLinkApproved: false,
        guardianLinkCurrent: true,
      }),
    ).toEqual({ allowed: true, via: "guardian" });
    expect(
      decideMemberAccess({
        ...base,
        confirmedAge: 18,
        ownLinkApproved: false,
        guardianLinkCurrent: true,
      }),
    ).toEqual({ allowed: false });
  });
});

describe("allowsOwnSensitiveAccess", () => {
  it("keeps own health access at 16 and leaves guardian access unchanged", () => {
    const self = { allowed: true, via: "self" } as const;
    expect(allowsOwnSensitiveAccess(self, 15)).toBe(false);
    expect(allowsOwnSensitiveAccess(self, 16)).toBe(true);
    expect(allowsOwnSensitiveAccess(self, null)).toBe(false);
    expect(allowsOwnSensitiveAccess({ allowed: true, via: "guardian" }, 12)).toBe(true);
    expect(allowsOwnSensitiveAccess({ allowed: false }, 30)).toBe(false);
  });
});
