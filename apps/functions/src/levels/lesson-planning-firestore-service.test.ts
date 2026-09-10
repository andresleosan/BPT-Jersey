import { describe, expect, it } from "vitest";

import type {
  LessonPlanRecord,
  TechniqueLibraryVersion,
} from "@bpt-jersey/domain/levels/lesson-planning";

import { createFirestoreLessonPlanningStore } from "./lesson-planning-service";

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

describe("lesson planning Firestore store", () => {
  it("writes exact tenant-scoped documents and updates approval atomically", async () => {
    const documents = new Map<string, Record<string, unknown>>();
    const firestore = {
      doc(path: string) {
        return {
          path,
          id: path.split("/").at(-1),
          get: async () => {
            const data = documents.get(path);
            return { exists: data !== undefined, data: () => data };
          },
        };
      },
      async runTransaction<T>(
        update: (transaction: {
          get: (reference: { get: () => Promise<unknown> }) => Promise<unknown>;
          create: (reference: { path: string }, data: Readonly<Record<string, unknown>>) => void;
          update: (reference: { path: string }, data: Readonly<Record<string, unknown>>) => void;
        }) => Promise<T>,
      ): Promise<T> {
        const pending: Array<{ path: string; data: Record<string, unknown> }> = [];
        const result = await update({
          get: (reference) => reference.get(),
          create: (reference, data) => pending.push({ path: reference.path, data: { ...data } }),
          update: (reference, data) => pending.push({ path: reference.path, data: { ...data } }),
        });
        for (const entry of pending) documents.set(entry.path, entry.data);
        return result;
      },
    };

    const store = createFirestoreLessonPlanningStore({ firestore: firestore as never });
    await store.saveLibrary({ academyId: "academy-1", library });
    await store.savePlan(submittedPlan);

    expect(documents.has("academies/academy-1/techniqueLibraries/library-1__1")).toBe(true);
    expect(documents.has("academies/academy-1/lessonPlans/plan-1")).toBe(true);

    await expect(
      store.approvePlan({
        academyId: "academy-1",
        planId: "plan-1",
        input: {
          staffId: "head-coach-1",
          staffRole: "head_coach",
          approvedAt: "2026-08-31T11:00:00.000Z",
        },
      }),
    ).resolves.toMatchObject({ status: "approved" });
    expect(documents.get("academies/academy-1/lessonPlans/plan-1")).toMatchObject({
      status: "approved",
      schemaVersion: 1,
    });
    expect(
      documents.get(
        "academies/academy-1/auditEvents/lesson-plan-approved-v1__academy-1__plan-1__2026-08-31T11:00:00.000Z",
      ),
    ).toMatchObject({
      action: "lesson.plan.approved",
      academyId: "academy-1",
      actorId: "head-coach-1",
      targetRef: "academies/academy-1/lessonPlans/plan-1",
      auditEventId: "lesson-plan-approved-v1__academy-1__plan-1__2026-08-31T11:00:00.000Z",
      planId: "plan-1",
      libraryId: "library-1",
      libraryVersion: 1,
      approvedAt: "2026-08-31T11:00:00.000Z",
      result: "completed",
      schemaVersion: 1,
    });
  });
});
