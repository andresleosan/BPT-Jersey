import { describe, expect, it } from "vitest";

import {
  buildFamilyAchievementSummary,
  type FamilyAchievementSummary,
} from "@bpt-jersey/domain/levels/achievements";
import {
  createFirestoreFamilyAchievementStore,
  createInMemoryFamilyAchievementStore,
  FamilyAchievementStoreError,
} from "./family-achievement-service";

const summary: FamilyAchievementSummary = (() => {
  const result = buildFamilyAchievementSummary({
    familyId: "family-1",
    now: "2026-08-31T12:00:00.000Z",
    goals: [
      { goalId: "goal-classes", label: "Attend classes", metric: "classes_attended", target: 10 },
    ],
    achievements: [
      {
        achievementId: "achievement-classes",
        label: "Ten classes",
        metric: "classes_attended",
        target: 10,
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
        currentStreakWeeks: 1,
        longestStreakWeeks: 2,
        adultComparisonOptIn: true,
      },
    ],
  });
  if (!result.ok) throw new Error("Invalid test fixture");
  return result.value;
})();

describe("family achievement snapshot store", () => {
  it("persists a validated tenant-scoped summary and audit identity", async () => {
    const store = createInMemoryFamilyAchievementStore();

    const written = await store.saveSnapshot({
      academyId: "academy-1",
      summary,
      generatedBy: "system-family-achievements",
      correlationId: "family-achievements:academy-1:family-1:2026-08-31T12:00:00.000Z",
    });

    expect(written).toMatchObject({
      snapshotId: "family-achievements-v1__academy-1__family-1__2026-08-31T12:00:00.000Z",
      auditEventId: "family-achievements-v1__academy-1__family-1__2026-08-31T12:00:00.000Z",
      replayed: false,
    });
    expect(await store.getSnapshot("academy-1", "family-1")).toEqual(summary);
    await expect(store.getSnapshot("academy-2", "family-1")).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("persists through the Firestore adapter with atomic audit replay", async () => {
    const documents = new Map<string, Record<string, unknown>>();
    const firestore = {
      doc(path: string) {
        return {
          id: path.split("/").at(-1) ?? "",
          get: async () => {
            const data = documents.get(path);
            return { exists: data !== undefined, data: () => data };
          },
        };
      },
      collection(prefix: string) {
        return {
          get: async () => ({
            docs: [...documents.entries()]
              .filter(([path]) => path.startsWith(prefix + "/"))
              .map(([path, data]) => ({
                id: path.split("/").at(-1) ?? "",
                data: () => data,
              })),
          }),
        };
      },
      async runTransaction<T>(
        update: (transaction: {
          get: (reference: {
            id: string;
            get: () => Promise<{
              exists: boolean;
              data: () => Record<string, unknown> | undefined;
            }>;
          }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
          create: (reference: { id: string }, data: Readonly<Record<string, unknown>>) => void;
        }) => Promise<T>,
      ): Promise<T> {
        const pending: Array<{ id: string; data: Record<string, unknown> }> = [];
        const result = await update({
          get: (reference) => reference.get(),
          create: (reference, data) => pending.push({ id: reference.id, data: { ...data } }),
        });
        const snapshotEntry = pending.find((entry) => entry.data.familyId === "family-1");
        if (snapshotEntry) {
          documents.set(
            "academies/academy-1/familyAchievementSnapshots/" + snapshotEntry.id,
            snapshotEntry.data,
          );
        }
        const auditEntry = pending.find(
          (entry) => entry.data.action === "family.achievements.generated",
        );
        if (auditEntry) {
          documents.set("academies/academy-1/auditEvents/" + auditEntry.id, auditEntry.data);
        }
        return result;
      },
    };

    const store = createFirestoreFamilyAchievementStore({ firestore });
    const input = {
      academyId: "academy-1",
      summary,
      generatedBy: "system-family-achievements",
      correlationId: "family-achievements:academy-1:family-1:2026-08-31T12:00:00.000Z",
    } as const;
    await expect(store.saveSnapshot(input)).resolves.toMatchObject({ replayed: false });
    await expect(store.saveSnapshot(input)).resolves.toMatchObject({ replayed: true });
    await expect(store.getSnapshot("academy-1", "family-1")).resolves.toEqual(summary);
  });
  it("is idempotent for the same snapshot and rejects divergent replay", async () => {
    const store = createInMemoryFamilyAchievementStore();
    const input = {
      academyId: "academy-1",
      summary,
      generatedBy: "system-family-achievements",
      correlationId: "family-achievements:academy-1:family-1:2026-08-31T12:00:00.000Z",
    } as const;

    await store.saveSnapshot(input);
    await expect(store.saveSnapshot(input)).resolves.toMatchObject({ replayed: true });

    await expect(
      store.saveSnapshot({
        ...input,
        summary: { ...summary, generatedAt: "2026-08-31T13:00:00.000Z" },
      }),
    ).rejects.toBeInstanceOf(FamilyAchievementStoreError);
  });
});
