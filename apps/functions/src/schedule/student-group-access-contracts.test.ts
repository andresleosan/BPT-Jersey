import { describe, expect, it } from "vitest";
import {
  effectiveGroupProgramIds,
  saveStudentGroupAccessSchema,
  studentGroupAccessSchema,
} from "@bpt-jersey/domain/schedule/member-calendar";

const base = { studentId: "student-1", programIds: ["adults-gi"], revision: 0 };

describe("additional group access exception", () => {
  it("requires a reason to grant groups but not to clear them", () => {
    expect(saveStudentGroupAccessSchema.safeParse(base).success).toBe(false);
    expect(saveStudentGroupAccessSchema.safeParse({ ...base, reason: " " }).success).toBe(false);
    expect(
      saveStudentGroupAccessSchema.safeParse({ ...base, reason: "Competition camp" }).success,
    ).toBe(true);
    expect(saveStudentGroupAccessSchema.safeParse({ ...base, programIds: [] }).success).toBe(true);
  });

  it("authorises nothing after the expiry day and keeps undated grants open", () => {
    const programIds = ["adults-gi"];
    expect(effectiveGroupProgramIds({ programIds, expiresOn: "2026-09-21" }, "2026-09-21")).toEqual(
      programIds,
    );
    expect(effectiveGroupProgramIds({ programIds, expiresOn: "2026-09-21" }, "2026-09-22")).toEqual(
      [],
    );
    expect(effectiveGroupProgramIds({ programIds, expiresOn: null }, "2099-01-01")).toEqual(
      programIds,
    );
    expect(effectiveGroupProgramIds({ programIds }, "2099-01-01")).toEqual(programIds);
  });

  it("still reads documents saved before reasons existed", () => {
    expect(studentGroupAccessSchema.safeParse({ ...base, dateOfBirth: null }).success).toBe(true);
  });
});
