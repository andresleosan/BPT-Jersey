import { describe, expect, expectTypeOf, it } from "vitest";

import { domainModules, type DomainModule } from "./modules";

const expectedModules = [
  "access",
  "people",
  "academy",
  "scheduling",
  "attendance",
  "memberships",
  "payments",
  "student-development",
  "safeguarding",
  "crm",
  "communications",
  "documents",
  "reporting",
  "audit",
] as const;

describe("domain modules", () => {
  it("exposes the canonical module tuple in order", () => {
    expect(domainModules).toEqual(expectedModules);
  });

  it("contains each module exactly once", () => {
    expect(new Set(domainModules).size).toBe(expectedModules.length);
  });

  it("is frozen at runtime", () => {
    expect(Object.isFrozen(domainModules)).toBe(true);
  });

  it("infers the domain module union from the tuple", () => {
    expectTypeOf<DomainModule>().toEqualTypeOf<(typeof expectedModules)[number]>();
  });
});
