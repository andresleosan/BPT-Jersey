import { describe, expect, it } from "vitest";

import type {
  ApproveLessonPlanInput,
  LessonPlanRecord,
  TechniqueLibraryVersion,
} from "@bpt-jersey/domain/levels/lesson-planning";

import {
  LessonPlanningStoreError,
  createInMemoryLessonPlanningStore,
} from "./lesson-planning-service";

const library: TechniqueLibraryVersion = {
  libraryId: "library-1",
  version: 1,
  status: "published",
  publishedAt: "2026-08-31T10:00:00.000Z",
  techniques: [
    {
      techniqueId: "technique-1",
      label: "Guard pass",
      skillKey: "guard-pass",
      sequence: 1,
      active: true,
    },
  ],
};

const submittedPlan: LessonPlanRecord = {
  planId: "plan-1",
  academyId: "academy-1",
  title: "Synthetic guard passing",
  libraryId: "library-1",
  libraryVersion: 1,
  status: "submitted",
  activities: [
    {
      activityId: "activity-1",
      kind: "technique",
      techniqueId: "technique-1",
      durationMinutes: 30,
      sequence: 1,
    },
  ],
  approvedByStaffId: null,
  approvedAt: null,
};

const approval: ApproveLessonPlanInput = {
  staffId: "head-coach-1",
  staffRole: "head_coach",
  approvedAt: "2026-08-31T11:00:00.000Z",
};

describe("lesson planning store", () => {
  it("persists a tenant-scoped library and plan idempotently", async () => {
    const store = createInMemoryLessonPlanningStore();

    await expect(store.saveLibrary({ academyId: "academy-1", library })).resolves.toEqual({
      idempotent: false,
    });
    await expect(store.saveLibrary({ academyId: "academy-1", library })).resolves.toEqual({
      idempotent: true,
    });
    await expect(store.savePlan(submittedPlan)).resolves.toEqual({ idempotent: false });
    await expect(store.savePlan(submittedPlan)).resolves.toEqual({ idempotent: true });
    await expect(store.getPlan("academy-1", "plan-1")).resolves.toEqual(submittedPlan);
  });

  it("rejects cross-tenant reads and divergent idempotent writes", async () => {
    const store = createInMemoryLessonPlanningStore();
    await store.saveLibrary({ academyId: "academy-1", library });
    await store.savePlan(submittedPlan);

    await expect(store.getLibrary("academy-2", "library-1", 1)).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(
      store.savePlan({ ...submittedPlan, title: "Divergent plan" }),
    ).rejects.toBeInstanceOf(LessonPlanningStoreError);
  });

  it("approves only a submitted plan through the head coach domain rule", async () => {
    const store = createInMemoryLessonPlanningStore();
    await store.saveLibrary({ academyId: "academy-1", library });
    await store.savePlan(submittedPlan);

    await expect(
      store.approvePlan({ academyId: "academy-1", planId: "plan-1", input: approval }),
    ).resolves.toMatchObject({
      planId: "plan-1",
      status: "approved",
      approvedByStaffId: "head-coach-1",
    });

    await expect(
      store.approvePlan({ academyId: "academy-1", planId: "plan-1", input: approval }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
