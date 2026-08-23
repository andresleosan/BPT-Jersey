import { describe, expect, it, vi } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { parseLevelCatalogSource } from "@bpt-jersey/domain/levels";
import { getLevelCatalog } from "./levels-client";

const parsed = parseLevelCatalogSource(observedJson, businessCriteriaJson);
if (!parsed.ok) throw new Error("Catalog parsing failed");

const mockProjection = {
  system: parsed.value.system,
  definitions: parsed.value.definitions,
  skills: parsed.value.skills,
  requirements: parsed.value.requirements,
  sourceHash: "test-hash-123456",
};

let mockCallableResult: any = { data: mockProjection };
let mockCallableError: any = null;

vi.mock("firebase/functions", () => ({
  httpsCallable: () => async () => {
    if (mockCallableError) throw mockCallableError;
    return mockCallableResult;
  },
}));

vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: () => ({}),
}));

describe("Levels Web Client", () => {
  it("fetches and validates published level catalog", async () => {
    mockCallableError = null;
    mockCallableResult = { data: mockProjection };

    const catalog = await getLevelCatalog();
    expect(catalog.system.systemId).toBe("ibjjf-v1");
    expect(catalog.definitions).toHaveLength(171);
    expect(catalog.skills).toHaveLength(11);
    expect(catalog.requirements).toHaveLength(165);
  });

  it("throws user-facing safe error on backend failure", async () => {
    mockCallableError = new Error("Firebase internal");

    await expect(getLevelCatalog()).rejects.toThrow(
      "Unable to load level catalog. Please try again.",
    );
  });

  it("throws user-facing safe error when response is malformed", async () => {
    mockCallableError = null;
    mockCallableResult = { data: { malformed: true } };

    await expect(getLevelCatalog()).rejects.toThrow(
      "Unable to load level catalog. Please try again.",
    );
  });
});
