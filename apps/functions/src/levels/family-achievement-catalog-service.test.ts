import { describe, expect, it } from "vitest";

import {
  createInMemoryFamilyAchievementCatalogStore,
  FamilyAchievementCatalogStoreError,
} from "./family-achievement-catalog-service";

const catalog = {
  goals: [
    {
      goalId: "goal-classes",
      label: "Attend classes",
      metric: "classes_attended" as const,
      target: 10,
    },
  ],
  achievements: [
    {
      achievementId: "achievement-classes",
      label: "Ten classes",
      metric: "classes_attended" as const,
      target: 10,
    },
  ],
};

describe("family achievement catalog store", () => {
  it("persists validated tenant-scoped goals and achievements", async () => {
    const store = createInMemoryFamilyAchievementCatalogStore();
    await expect(store.saveCatalog({ academyId: "academy-1", catalog })).resolves.toMatchObject({
      goalCount: 1,
      achievementCount: 1,
      idempotent: false,
    });
    await expect(store.getCatalog("academy-1")).resolves.toEqual(catalog);
    await expect(store.getCatalog("academy-2")).rejects.toMatchObject({ code: "not-found" });
  });

  it("is idempotent and rejects invalid or divergent catalog replay", async () => {
    const store = createInMemoryFamilyAchievementCatalogStore();
    const input = { academyId: "academy-1", catalog } as const;
    await store.saveCatalog(input);
    await expect(store.saveCatalog(input)).resolves.toMatchObject({ idempotent: true });
    await expect(
      store.saveCatalog({
        ...input,
        catalog: { ...catalog, goals: [{ ...catalog.goals[0]!, target: 12 }] },
      }),
    ).rejects.toBeInstanceOf(FamilyAchievementCatalogStoreError);
  });
});
