import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { normalizeLevelCatalogSource } from "./level-source";

describe("Level Source Normalizer", () => {
  it("normalizes observed and business criteria into canonical catalog with hash", () => {
    const catalog = normalizeLevelCatalogSource(observedJson, businessCriteriaJson);

    expect(catalog.system.systemId).toBe("ibjjf-v1");
    expect(catalog.system.displayName).toBe("JIU-JITSU - IBJJF");
    expect(catalog.definitions).toHaveLength(171);
    expect(catalog.skills).toHaveLength(11);
    expect(catalog.requirements).toHaveLength(165);
    expect(catalog.sourceHash).toBeTypeOf("string");
    expect(catalog.sourceHash.length).toBe(64); // SHA-256
  });

  it("throws for invalid source data", () => {
    expect(() => normalizeLevelCatalogSource({}, businessCriteriaJson)).toThrow();
  });
});
