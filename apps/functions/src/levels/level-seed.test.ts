import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { createInMemoryLevelStore } from "./level-service";
import { rollbackLevelCatalog, seedLevelCatalog } from "./level-seed";

describe("Level Seed Guard and Execution", () => {
  it("refuses production target", async () => {
    const store = createInMemoryLevelStore();

    await expect(
      seedLevelCatalog({
        target: "production" as unknown as "emulator",
        academyId: "demo-academy",
        store,
      }),
    ).rejects.toThrow(/Production seed is strictly prohibited/);
  });

  it("requires confirmation for staging target", async () => {
    const store = createInMemoryLevelStore();

    await expect(
      seedLevelCatalog({
        target: "staging",
        academyId: "demo-academy",
        store,
      }),
    ).rejects.toThrow(/Confirmation required for staging/);
  });

  it("seeds successfully to emulator target with valid sources", async () => {
    const store = createInMemoryLevelStore();

    const result = await seedLevelCatalog({
      target: "emulator",
      academyId: "demo-academy",
      store,
      customObserved: observedJson,
      customBusiness: businessCriteriaJson,
    });

    expect(result.systemId).toBe("ibjjf-v1");
    expect(result.definitionCount).toBe(171);
    expect(result.beltCount).toBe(27);
    expect(result.stripeCount).toBe(144);
    expect(result.skillCount).toBe(11);
    expect(result.requirementCount).toBe(165);
  });

  it("rolls back successfully in emulator target", async () => {
    const store = createInMemoryLevelStore();

    await seedLevelCatalog({
      target: "emulator",
      academyId: "demo-academy",
      store,
      customObserved: observedJson,
      customBusiness: businessCriteriaJson,
    });

    const rollbackResult = await rollbackLevelCatalog({
      target: "emulator",
      academyId: "demo-academy",
      systemId: "ibjjf-v1",
      store,
    });

    expect(rollbackResult.deletedDefinitions).toBe(171);
    expect(rollbackResult.deletedRequirements).toBe(165);
    expect(rollbackResult.deletedSystems).toBe(1);
  });
});
