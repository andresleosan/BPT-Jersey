import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import {
  approvedLevelCatalogSourceHashes,
  assertApprovedLevelCatalogSource,
  normalizeLevelCatalogSource,
} from "./level-source";

describe("Level Source Normalizer", () => {
  it("normalizes observed and business criteria into canonical catalog with hash", () => {
    const catalog = normalizeLevelCatalogSource(observedJson, businessCriteriaJson);

    expect(catalog.system.systemId).toBe("ibjjf-v1");
    expect(catalog.system.displayName).toBe("JIU-JITSU - IBJJF");
    expect(catalog.definitions).toHaveLength(171);
    expect(catalog.skills).toHaveLength(11);
    expect(catalog.requirements).toHaveLength(165);
    expect(catalog.sourceHash).toBeTypeOf("string");
    expect(catalog.sourceHash).toBe(approvedLevelCatalogSourceHashes.combined);
    expect(catalog.sourceHashes).toEqual({
      observed: approvedLevelCatalogSourceHashes.observed,
      businessCriteria: approvedLevelCatalogSourceHashes.businessCriteria,
    });
    expect(() => assertApprovedLevelCatalogSource(catalog)).not.toThrow();
  });

  it("rejects a valid-looking source whose approved file hash changed", () => {
    const catalog = normalizeLevelCatalogSource(observedJson, businessCriteriaJson);
    const tamperedCatalog = {
      ...catalog,
      sourceHashes: {
        ...catalog.sourceHashes,
        observed: "a".repeat(64),
      },
    };

    expect(() => assertApprovedLevelCatalogSource(tamperedCatalog)).toThrow(
      /do not match the approved hashes/,
    );
  });

  it("throws for invalid source data", () => {
    expect(() => normalizeLevelCatalogSource({}, businessCriteriaJson)).toThrow();
  });
});
