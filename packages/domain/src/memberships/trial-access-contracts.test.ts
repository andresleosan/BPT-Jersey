import { describe, expect, it } from "vitest";

import { TRIAL_DAYS, trialAccessSchema, trialExpiresAt, trialStatusAt } from "./trial-access-contracts";

const trial = trialAccessSchema.parse({
  trialId: "student-1",
  academyId: "academy-1",
  studentId: "student-1",
  site: "West",
  experience: "beginner",
  allowance: 2,
  countedAttendanceIds: [],
  status: "active",
  startsAt: "2026-09-22T10:00:00.000Z",
  expiresAt: trialExpiresAt("2026-09-22T10:00:00.000Z"),
  enrolmentRequestId: "enrol-1",
  createdAt: "2026-09-22T10:00:00.000Z",
  updatedAt: "2026-09-22T10:00:00.000Z",
  schemaVersion: "1",
});

describe("trial access", () => {
  it("expires 30 days after it starts", () => {
    expect(TRIAL_DAYS).toBe(30);
    expect(trial.expiresAt).toBe("2026-10-22T10:00:00.000Z");
  });
  it("is active until the allowance is used or the date passes", () => {
    expect(trialStatusAt(trial, "2026-09-23T10:00:00.000Z")).toBe("active");
    expect(trialStatusAt({ ...trial, countedAttendanceIds: ["a", "b"] }, "2026-09-23T10:00:00.000Z")).toBe(
      "exhausted",
    );
    expect(trialStatusAt(trial, "2026-10-22T10:00:00.000Z")).toBe("expired");
    expect(trialStatusAt({ ...trial, status: "converted" }, "2026-12-01T00:00:00.000Z")).toBe("converted");
  });
});
