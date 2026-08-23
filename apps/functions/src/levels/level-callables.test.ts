import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { createInMemoryLevelStore } from "./level-service";
import { normalizeLevelCatalogSource } from "./level-source";
import { createListLevelCatalogHandler } from "./level-callables";

function fakeRequest(
  data: unknown,
  role = "owner",
  uid: string | null = "user-1",
  academyId = "demo-academy",
) {
  return {
    auth: uid ? { uid, token: { academyId, role } } : undefined,
    data,
  } as never;
}

describe("Level Callables", () => {
  const normalized = normalizeLevelCatalogSource(observedJson, businessCriteriaJson);

  function createTestStore() {
    const store = createInMemoryLevelStore();
    store.seed({ academyId: "demo-academy", normalized });
    return store;
  }

  it("allows authenticated owner to read the catalog", async () => {
    const store = createTestStore();
    const handler = createListLevelCatalogHandler({ store });

    const response = await handler(fakeRequest(null, "owner", "user-1", "demo-academy"));

    expect(response.system.systemId).toBe("ibjjf-v1");
    expect(response.definitions).toHaveLength(171);
    expect(response.skills).toHaveLength(11);
    expect(response.requirements).toHaveLength(165);
  });

  it("allows authenticated coach and guardian to read the catalog", async () => {
    const store = createTestStore();
    const handler = createListLevelCatalogHandler({ store });

    const coachResponse = await handler(fakeRequest(null, "coach", "coach-1", "demo-academy"));
    expect(coachResponse.definitions).toHaveLength(171);

    const guardianResponse = await handler(
      fakeRequest(null, "guardian", "guardian-1", "demo-academy"),
    );
    expect(guardianResponse.definitions).toHaveLength(171);
  });

  it("rejects unauthenticated requests", async () => {
    const store = createTestStore();
    const handler = createListLevelCatalogHandler({ store });

    await expect(handler(fakeRequest(null, "owner", null, "demo-academy"))).rejects.toThrow();
  });

  it("rejects non-null request payload", async () => {
    const store = createTestStore();
    const handler = createListLevelCatalogHandler({ store });

    await expect(
      handler(fakeRequest({ unexpected: "payload" }, "owner", "user-1", "demo-academy")),
    ).rejects.toThrow();
  });

  it("enforces tenant boundary (cannot read another academy)", async () => {
    const store = createTestStore();
    const handler = createListLevelCatalogHandler({ store });

    await expect(handler(fakeRequest(null, "owner", "user-2", "other-academy"))).rejects.toThrow();
  });
});
