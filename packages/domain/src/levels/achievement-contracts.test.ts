import { describe, expect, it } from "vitest";

import {
  buildFamilyAchievementSummary,
  type BuildFamilyAchievementSummaryInput,
} from "./achievement-contracts";

const baseInput: BuildFamilyAchievementSummaryInput = {
  familyId: "family-1",
  now: "2026-08-27T12:00:00Z",
  goals: [
    { goalId: "goal-classes", label: "Attend classes", metric: "classes_attended", target: 10 },
    { goalId: "goal-streak", label: "Build a streak", metric: "current_streak_weeks", target: 4 },
  ],
  achievements: [
    {
      achievementId: "achievement-classes",
      label: "Ten classes",
      metric: "classes_attended",
      target: 10,
    },
    {
      achievementId: "achievement-streak",
      label: "Four-week streak",
      metric: "current_streak_weeks",
      target: 4,
    },
  ],
  members: [
    {
      familyId: "family-1",
      studentId: "adult-1",
      displayName: "Adult One",
      participantType: "adult",
      active: true,
      classesAttended: 12,
      currentStreakWeeks: 4,
      longestStreakWeeks: 5,
      adultComparisonOptIn: true,
    },
    {
      familyId: "family-1",
      studentId: "minor-1",
      displayName: "Minor One",
      participantType: "minor",
      active: true,
      classesAttended: 12,
      currentStreakWeeks: 4,
      longestStreakWeeks: 5,
      adultComparisonOptIn: false,
    },
  ],
};

const adultMember = baseInput.members[0]!;
const minorMember = baseInput.members[1]!;
const firstAchievement = baseInput.achievements[0]!;

describe("family achievement contracts", () => {
  it("builds goals and achievement candidates without automatic awards", () => {
    const result = buildFamilyAchievementSummary(baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.members).toHaveLength(2);
    expect(result.value.members[0]?.goals[0]).toMatchObject({
      goalId: "goal-classes",
      progress: 12,
      status: "complete",
    });
    expect(result.value.members[0]?.achievementCandidates).toHaveLength(2);
    expect(result.value.members[0]?.achievementCandidates[0]?.status).toBe("candidate");
    expect(result.value.members[0]).not.toHaveProperty("awarded");
    expect(result.value.adultComparison).toEqual([
      {
        studentId: "adult-1",
        classesAttended: 12,
        currentStreakWeeks: 4,
        longestStreakWeeks: 5,
      },
    ]);
  });

  it("never includes minors or adults without opt-in in adult comparison", () => {
    const result = buildFamilyAchievementSummary({
      ...baseInput,
      members: [
        ...baseInput.members,
        {
          ...adultMember,
          studentId: "adult-2",
          displayName: "Adult Two",
          adultComparisonOptIn: false,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adultComparison.map((entry) => entry.studentId)).toEqual(["adult-1"]);
    expect(JSON.stringify(result.value.adultComparison)).not.toContain("minor-1");
  });

  it("excludes inactive members from the family summary", () => {
    const result = buildFamilyAchievementSummary({
      ...baseInput,
      members: [{ ...minorMember, active: false }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.members).toEqual([]);
    expect(result.value.adultComparison).toEqual([]);
  });

  it("is immutable and deterministic for the same canonical input", () => {
    const first = buildFamilyAchievementSummary(baseInput);
    const second = buildFamilyAchievementSummary(baseInput);

    expect(first).toEqual(second);
    expect(first.ok && Object.isFrozen(first.value)).toBe(true);
    expect(first.ok && Object.isFrozen(first.value.members)).toBe(true);
    expect(first.ok && Object.isFrozen(first.value.members[0]?.goals)).toBe(true);
  });

  it("rejects cross-family, duplicate, invalid and minor opt-in inputs", () => {
    expect(
      buildFamilyAchievementSummary({
        ...baseInput,
        members: [{ ...adultMember, familyId: "family-2" }],
      }).ok,
    ).toBe(false);
    expect(
      buildFamilyAchievementSummary({
        ...baseInput,
        members: [adultMember, adultMember],
      }).ok,
    ).toBe(false);
    expect(
      buildFamilyAchievementSummary({
        ...baseInput,
        members: [{ ...minorMember, adultComparisonOptIn: true }],
      }).ok,
    ).toBe(false);
    expect(
      buildFamilyAchievementSummary({
        ...baseInput,
        achievements: [{ ...firstAchievement, target: 0 }],
      }).ok,
    ).toBe(false);
  });

  it("keeps the contract limited to progress metrics and does not grant promotion", () => {
    const result = buildFamilyAchievementSummary(baseInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.value)).not.toContain("promotion");
    expect(JSON.stringify(result.value)).not.toContain("belt");
    expect(JSON.stringify(result.value)).not.toContain("stripe");
  });
});
