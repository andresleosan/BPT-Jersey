import { describe, expect, it } from "vitest";

import {
  buildMemberOverview,
  isGuardianOnly,
  memberOverviewSchema,
  type OverviewStudentSource,
} from "./member-overview-contracts";

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
  trialsByStudent: new Map(),
  guardianUsers: [],
  now: "2026-09-24T10:00:00.000Z",
};

const now = "2026-09-24T10:00:00.000Z";
type Student = OverviewStudentSource;
function student(studentId: string, fullName: string, extra: Partial<Student> = {}): Student {
  return { studentId, fullName, dateOfBirth: "1990-01-01", trainingCenter: "West", active: true, legacy: false, ...extra };
}
function liveMembership(studentId: string) {
  return { studentId, planId: "adult-monthly", status: "active", startsAt: "2026-01-01T00:00:00.000Z", endsAt: null };
}
function trial(status: string, expiresAt: string) {
  return { status, expiresAt, allowance: 2, countedAttendanceIds: [] };
}
function overview(input: {
  students: Student[];
  memberships?: [string, ReturnType<typeof liveMembership>[]][];
  trials?: [string, ReturnType<typeof trial>][];
  families?: { familyId: string; primaryContactUserId?: string; guardianName?: string; online: boolean }[];
  guardianUsers?: { userId: string; fullName: string; familyIds: string[] }[];
}) {
  return buildMemberOverview({
    ...baseInput,
    students: input.students,
    membershipsByStudent: new Map(input.memberships ?? []),
    planNames: new Map([["adult-monthly", "Adult monthly"]]),
    trialsByStudent: new Map(input.trials ?? []),
    familiesById: new Map((input.families ?? []).map((family) => [family.familyId, family])),
    guardianUsers: input.guardianUsers ?? [],
    now,
  });
}

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

describe("buildMemberOverview free trials", () => {
  it("shows an active trial without a membership as a training Free Trial", () => {
    const result = overview({ students: [student("s-1", "Tia Trial")], trials: [["s-1", trial("active", "2026-10-10T00:00:00.000Z")]] });
    const row = result.rows[0];
    expect(row?.planState).toBe("trial");
    expect(row?.plan).toMatchObject({ planId: "free-trial", displayName: "Free Trial", endsAt: "2026-10-10T00:00:00.000Z" });
    expect(row?.active).toBe(true);
    expect(result.counters.active).toBe(1);
    expect(result.counters.inactive).toBe(0);
  });

  it.each([
    ["expired", trial("active", "2026-09-20T00:00:00.000Z")],
    ["converted", trial("converted", "2026-10-10T00:00:00.000Z")],
    ["exhausted", trial("exhausted", "2026-10-10T00:00:00.000Z")],
  ])("does not show a %s trial as Free Trial", (_label, record) => {
    const result = overview({ students: [student("s-1", "Tia Trial")], trials: [["s-1", record]] });
    expect(result.rows[0]?.planState).toBe("none");
    expect(result.rows[0]?.plan).toBeUndefined();
    expect(result.rows[0]?.active).toBe(false);
    expect(result.counters.inactive).toBe(1);
  });

  it("does not show a trial on a deactivated member", () => {
    const result = overview({
      students: [student("s-1", "Tia Trial", { active: false })],
      trials: [["s-1", trial("active", "2026-10-10T00:00:00.000Z")]],
    });
    expect(result.rows[0]?.planState).toBe("none");
    expect(result.rows[0]?.plan).toBeUndefined();
    expect(result.counters).toMatchObject({ active: 0, inactive: 1 });
  });

  it("prefers a live membership over a trial", () => {
    const result = overview({
      students: [student("s-1", "Tia Trial")],
      memberships: [["s-1", [liveMembership("s-1")]]],
      trials: [["s-1", trial("active", "2026-10-10T00:00:00.000Z")]],
    });
    expect(result.rows[0]?.planState).toBe("current");
    expect(result.rows[0]?.plan?.displayName).toBe("Adult monthly");
  });
});

describe("buildMemberOverview guardians", () => {
  const family = { familyId: "fam-1", primaryContactUserId: "user-g", guardianName: "Gina Guard", online: true };
  const child = student("s-child", "Kid Guard", { dateOfBirth: "2016-01-01", familyId: "fam-1", trainingCenter: "Town" });

  it("marks a guardian with a member record and no plan as a guardian row", () => {
    const result = overview({
      students: [student("s-g", "Gina Guard", { userId: "user-g" }), child],
      memberships: [["s-child", [liveMembership("s-child")]]],
      families: [family],
      guardianUsers: [{ userId: "user-g", fullName: "Gina Guard", familyIds: ["fam-1"] }],
    });
    const row = result.rows.find((item) => item.studentId === "s-g");
    expect(row?.rowKind).toBe("guardian");
    expect(row?.active).toBe(false);
    expect(result.rows.filter((item) => item.fullName === "Gina Guard")).toHaveLength(1);
    expect(result.counters).toMatchObject({ total: 2, active: 1, guardians: 1, inactive: 0 });
  });

  it("keeps a guardian who trains on a live plan as a member", () => {
    const result = overview({
      students: [student("s-g", "Gina Guard", { userId: "user-g" }), child],
      memberships: [["s-child", [liveMembership("s-child")]], ["s-g", [liveMembership("s-g")]]],
      families: [family],
      guardianUsers: [{ userId: "user-g", fullName: "Gina Guard", familyIds: ["fam-1"] }],
    });
    const row = result.rows.find((item) => item.studentId === "s-g");
    expect(row?.rowKind).toBe("member");
    expect(row?.plan?.displayName).toBe("Adult monthly");
    expect(result.counters).toMatchObject({ active: 2, guardians: 0 });
  });

  it("adds a synthetic guardian row for a guardian without a member record", () => {
    const result = overview({
      students: [child],
      trials: [["s-child", trial("active", "2026-10-10T00:00:00.000Z")]],
      families: [family],
      guardianUsers: [{ userId: "user-g", fullName: "Gina Guard", familyIds: ["fam-1"] }],
    });
    const row = result.rows.find((item) => item.rowKind === "guardian");
    expect(row).toEqual({
      studentId: "guardian:user-g",
      rowKind: "guardian",
      userId: "user-g",
      fullName: "Gina Guard",
      trainingCenter: "Town",
      centreConfirmed: true,
      active: false,
      source: "bpt",
      planState: "none",
      ownAccount: true,
      flags: [],
    });
    expect(result.counters).toMatchObject({ total: 2, active: 1, guardians: 1, inactive: 0 });
  });

  it("does not treat a guardian of inactive members as a guardian", () => {
    const withRecord = overview({
      students: [student("s-g", "Gina Guard", { userId: "user-g" }), child],
      families: [family],
      guardianUsers: [{ userId: "user-g", fullName: "Gina Guard", familyIds: ["fam-1"] }],
    });
    expect(withRecord.rows.find((item) => item.studentId === "s-g")?.rowKind).toBe("member");
    expect(withRecord.counters.guardians).toBe(0);
    const withoutRecord = overview({
      students: [child],
      families: [family],
      guardianUsers: [{ userId: "user-g", fullName: "Gina Guard", familyIds: ["fam-1"] }],
    });
    expect(withoutRecord.rows.map((item) => item.studentId)).toEqual(["s-child"]);
    expect(withoutRecord.counters.guardians).toBe(0);
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

describe("memberOverviewSchema", () => {
  it("accepts a response from a server without the guardians counter", () => {
    const parsed = memberOverviewSchema.parse({
      rows: [],
      counters: { total: 0, active: 0, expiring: 0, review: 0, inactive: 0 },
      generatedAt: "2026-09-25T10:00:00.000Z",
    });
    expect(parsed.counters.guardians).toBe(0);
  });

  it("accepts more than 500 rows so synthetic guardian rows fit", () => {
    const rowTemplate = buildMemberOverview({ ...baseInput }).rows[0];
    const rows = Array.from({ length: 700 }, (_, index) => ({ ...rowTemplate, studentId: `s-${index}` }));
    const counters = { total: 700, active: 700, expiring: 0, review: 0, inactive: 0, guardians: 0 };
    expect(memberOverviewSchema.parse({ rows, counters, generatedAt: now }).rows).toHaveLength(700);
  });
});
