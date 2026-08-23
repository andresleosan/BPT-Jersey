import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { normalizeLevelCatalogSource } from "./level-source";
import { createInMemoryLevelStore } from "./level-service";

describe("Level Service & Store", () => {
  const normalized = normalizeLevelCatalogSource(observedJson, businessCriteriaJson);

  it("seeds the full catalog into Firestore store and lists published catalog", async () => {
    const store = createInMemoryLevelStore();

    const seedResult = await store.seed({
      academyId: "demo-academy",
      normalized,
    });

    expect(seedResult.systemId).toBe("ibjjf-v1");
    expect(seedResult.definitionCount).toBe(171);
    expect(seedResult.beltCount).toBe(27);
    expect(seedResult.stripeCount).toBe(144);
    expect(seedResult.skillCount).toBe(11);
    expect(seedResult.requirementCount).toBe(165);
    expect(seedResult.idempotent).toBe(false);

    const catalog = await store.listPublished("demo-academy");
    expect(catalog.system.systemId).toBe("ibjjf-v1");
    expect(catalog.definitions).toHaveLength(171);
    expect(catalog.skills).toHaveLength(11);
    expect(catalog.requirements).toHaveLength(165);
    expect(catalog.sourceHash).toBe(normalized.sourceHash);
  });

  it("is idempotent when re-seeded with identical hash", async () => {
    const store = createInMemoryLevelStore();

    await store.seed({
      academyId: "demo-academy",
      normalized,
    });

    const secondSeed = await store.seed({
      academyId: "demo-academy",
      normalized,
    });

    expect(secondSeed.idempotent).toBe(true);
  });

  it("fails closed on immutable version conflict (same systemId, different sourceHash)", async () => {
    const store = createInMemoryLevelStore();

    await store.seed({
      academyId: "demo-academy",
      normalized,
    });

    const conflicting = {
      ...normalized,
      sourceHash: "different-hash-1234567890abcdef1234567890abcdef1234567890abcdef12345678",
    };

    await expect(
      store.seed({
        academyId: "demo-academy",
        normalized: conflicting,
      }),
    ).rejects.toThrow();
  });

  it("rolls back seeded system by deleting all its documents", async () => {
    const store = createInMemoryLevelStore();

    await store.seed({
      academyId: "demo-academy",
      normalized,
    });

    const rollbackResult = await store.rollback({
      academyId: "demo-academy",
      systemId: "ibjjf-v1",
    });

    expect(rollbackResult.deletedDefinitions).toBe(171);
    expect(rollbackResult.deletedRequirements).toBe(165);
    expect(rollbackResult.deletedSystems).toBe(1);

    await expect(store.listPublished("demo-academy")).rejects.toThrow();
  });

  it("enforces tenant boundary on listPublished", async () => {
    const store = createInMemoryLevelStore();

    await store.seed({
      academyId: "academy-1",
      normalized,
    });

    await expect(store.listPublished("academy-2")).rejects.toThrow();
  });
});
