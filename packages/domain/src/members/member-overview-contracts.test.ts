import { describe, expect, it } from "vitest";

import { buildMemberOverview, isGuardianOnly } from "./member-overview-contracts";

const baseInput = {
  students: [
    {
      studentId: "student-1",
      fullName: "Mia Rowe",
      dateOfBirth: "2010-01-01",
      trainingCenter: "West" as const,
      active: true,
      legacy: false,
    },
  ],
  membershipsByStudent: new Map([
    [
      "student-1",
      [
        {
          studentId: "student-1",
          planId: "teens-monthly",
          status: "active",
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: null,
        },
      ],
    ],
  ]),
  planNames: new Map([["teens-monthly", "Teens monthly"]]),
  familiesById: new Map(),
  levelByStudent: new Map(),
  planBands: new Map(),
  now: "2026-09-24T10:00:00.000Z",
};

describe("buildMemberOverview", () => {
  it("flags a live plan whose band differs from the age band (H3)", () => {
    const overview = buildMemberOverview({
      ...baseInput,
      planBands: new Map([["teens-monthly", ["teens"] as const]]),
      now: "2026-09-24T10:00:00.000Z",
    });
    expect(overview.rows[0]?.ageBand).toBe("adult");
    expect(overview.rows[0]?.flags).toContain("plan-band-differs");
  });

  it("does not flag a plan that admits the age band", () => {
    const overview = buildMemberOverview({
      ...baseInput,
      planBands: new Map([["teens-monthly", ["teens", "adult"] as const]]),
    });
    expect(overview.rows[0]?.flags).not.toContain("plan-band-differs");
  });
});

describe("isGuardianOnly", () => {
  it("marks a guardian of an active member with no plan or trial of their own", () => {
    expect(isGuardianOnly({ hasOwnCoveringPlan: false, hasActiveTrial: false, guardsActiveStudent: true })).toBe(true);
    expect(isGuardianOnly({ hasOwnCoveringPlan: true, hasActiveTrial: false, guardsActiveStudent: true })).toBe(false);
    expect(isGuardianOnly({ hasOwnCoveringPlan: false, hasActiveTrial: true, guardsActiveStudent: true })).toBe(false);
    expect(isGuardianOnly({ hasOwnCoveringPlan: false, hasActiveTrial: false, guardsActiveStudent: false })).toBe(false);
  });
});
