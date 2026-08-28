import { describe, expect, it } from "vitest";

import {
  approveLessonPlan,
  parseLessonPlanRecord,
  parseTechniqueLibraryVersion,
} from "./lesson-planning-contracts";

const library = parseTechniqueLibraryVersion({
  libraryId: "library-1",
  version: 1,
  status: "published",
  publishedAt: "2026-08-27T12:00:00Z",
  techniques: [
    {
      techniqueId: "technique-armbar",
      label: "Armbar",
      skillKey: "guard-armbar",
      sequence: 1,
      active: true,
    },
    {
      techniqueId: "technique-old",
      label: "Old technique",
      skillKey: "old-skill",
      sequence: 2,
      active: false,
    },
  ],
});

const submittedPlan = {
  planId: "plan-1",
  academyId: "academy-1",
  title: "Guard fundamentals",
  libraryId: "library-1",
  libraryVersion: 1,
  status: "submitted",
  activities: [
    {
      activityId: "activity-1",
      kind: "technique",
      techniqueId: "technique-armbar",
      durationMinutes: 30,
      sequence: 1,
    },
    {
      activityId: "activity-2",
      kind: "sparring",
      techniqueId: null,
      durationMinutes: 20,
      sequence: 2,
    },
  ],
  approvedByStaffId: null,
  approvedAt: null,
};

describe("lesson planning contracts", () => {
  it("parses a published version and a submitted plan", () => {
    expect(library.ok).toBe(true);
    if (!library.ok) return;
    const plan = parseLessonPlanRecord(submittedPlan, library.value);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.activities).toHaveLength(2);
    expect(Object.isFrozen(plan.value)).toBe(true);
  });

  it("rejects references to inactive techniques and mismatched versions", () => {
    expect(library.ok).toBe(true);
    if (!library.ok) return;
    expect(
      parseLessonPlanRecord(
        {
          ...submittedPlan,
          activities: [{ ...submittedPlan.activities[0], techniqueId: "technique-old" }],
        },
        library.value,
      ).ok,
    ).toBe(false);
    expect(parseLessonPlanRecord({ ...submittedPlan, libraryVersion: 2 }, library.value).ok).toBe(
      false,
    );
  });

  it("requires a human head coach approval transition", () => {
    expect(library.ok).toBe(true);
    if (!library.ok) return;
    const plan = parseLessonPlanRecord(submittedPlan, library.value);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(
      approveLessonPlan(plan.value, {
        staffId: "staff-1",
        staffRole: "coach",
        approvedAt: "2026-08-27T12:00:00Z",
      }).ok,
    ).toBe(false);
    const approved = approveLessonPlan(plan.value, {
      staffId: "staff-1",
      staffRole: "head_coach",
      approvedAt: "2026-08-27T12:00:00Z",
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.value.status).toBe("approved");
    expect(approved.value.approvedByStaffId).toBe("staff-1");
  });

  it("does not allow approval metadata on non-approved plans", () => {
    expect(library.ok).toBe(true);
    if (!library.ok) return;
    expect(
      parseLessonPlanRecord(
        { ...submittedPlan, approvedByStaffId: "staff-1", approvedAt: "2026-08-27T12:00:00Z" },
        library.value,
      ).ok,
    ).toBe(false);
  });

  it("rejects invalid library definitions and duplicate activities", () => {
    expect(
      parseTechniqueLibraryVersion({
        libraryId: "library-1",
        version: 1,
        status: "draft",
        publishedAt: "2026-08-27T12:00:00Z",
        techniques: [],
      }).ok,
    ).toBe(false);
    expect(library.ok).toBe(true);
    if (!library.ok) return;
    expect(
      parseLessonPlanRecord(
        {
          ...submittedPlan,
          activities: [submittedPlan.activities[0], submittedPlan.activities[0]],
        },
        library.value,
      ).ok,
    ).toBe(false);
  });
});
