import { afterEach, describe, expect, it, vi } from "vitest";

import { getFamilyAchievementSummary } from "./family-achievement-client";

let mockCallableResult: unknown = {
  data: {
    familyId: "family-1",
    generatedAt: "2026-08-31T12:00:00.000Z",
    members: [
      {
        studentId: "student-1",
        displayName: "Synthetic Minor",
        participantType: "minor",
        goals: [
          {
            goalId: "family-classes",
            label: "Family classes",
            metric: "classes_attended",
            target: 10,
            progress: 4,
            status: "in_progress",
          },
        ],
        achievementCandidates: [],
      },
    ],
    adultComparison: [],
  },
};
let mockCallableError: Error | null = null;
let mockCallableInvocations = 0;

vi.mock("firebase/functions", () => ({
  httpsCallable: () => async (payload: unknown) => {
    mockCallableInvocations += 1;
    expect(payload).toEqual({ familyId: "family-1" });
    if (mockCallableError) throw mockCallableError;
    return mockCallableResult;
  },
}));

vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: () => ({}),
}));

describe("Family achievement web client", () => {
  afterEach(() => {
    mockCallableResult = {
      data: {
        familyId: "family-1",
        generatedAt: "2026-08-31T12:00:00.000Z",
        members: [
          {
            studentId: "student-1",
            displayName: "Synthetic Minor",
            participantType: "minor",
            goals: [
              {
                goalId: "family-classes",
                label: "Family classes",
                metric: "classes_attended",
                target: 10,
                progress: 4,
                status: "in_progress",
              },
            ],
            achievementCandidates: [],
          },
        ],
        adultComparison: [],
      },
    };
    mockCallableError = null;
    mockCallableInvocations = 0;
  });

  it("loads and validates the read-only family summary", async () => {
    const summary = await getFamilyAchievementSummary("family-1");

    expect(summary.familyId).toBe("family-1");
    expect(summary.members[0]?.goals[0]?.progress).toBe(4);
    expect(mockCallableInvocations).toBe(1);
  });

  it("rejects unsafe family IDs before contacting Firebase", async () => {
    await expect(getFamilyAchievementSummary("family/other")).rejects.toThrow(
      "Unable to load family achievements. Please try again.",
    );
    expect(mockCallableInvocations).toBe(0);
  });

  it("hides backend and malformed-response details behind a safe error", async () => {
    mockCallableError = new Error("private backend details");
    await expect(getFamilyAchievementSummary("family-1")).rejects.toThrow(
      "Unable to load family achievements. Please try again.",
    );

    mockCallableError = null;
    mockCallableResult = { data: { familyId: "family-1" } };
    await expect(getFamilyAchievementSummary("family-1")).rejects.toThrow(
      "Unable to load family achievements. Please try again.",
    );
  });
});
