import { describe, expect, it } from "vitest";

import { needsAdultClaim } from "./member-access-contracts";

describe("needsAdultClaim", () => {
  const base = { via: "self" as const, createdByGuardian: true, adultClaimedAt: null };
  it("asks once, at 18, only for guardian-created own accounts", () => {
    expect(needsAdultClaim({ ...base, age: 17 })).toBe(false);
    expect(needsAdultClaim({ ...base, age: 18 })).toBe(true);
    expect(needsAdultClaim({ ...base, age: 18, adultClaimedAt: "2026-09-24T10:00:00.000Z" })).toBe(false);
    expect(needsAdultClaim({ ...base, age: 18, createdByGuardian: false })).toBe(false);
    expect(needsAdultClaim({ ...base, age: 18, via: "guardian" })).toBe(false);
    expect(needsAdultClaim({ ...base, age: null })).toBe(false);
  });
});
