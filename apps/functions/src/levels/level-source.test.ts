import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import regyfitJson from "../../../../docs/data/ibjjf-skills-observed.sanitized.json";
import { buildIbjjfV2CatalogSources, buildIbjjfV3CatalogSources } from "@bpt-jersey/domain/levels";
import {
  approvedLevelCatalogSourceHashes,
  approvedLevelCatalogSourceHashesBySystem,
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

  it("rejects a catalogue whose system is not an approved version", () => {
    const catalog = normalizeLevelCatalogSource(observedJson, businessCriteriaJson);
    const foreignCatalog = {
      ...catalog,
      system: { ...catalog.system, systemId: "ibjjf-v9" },
    };

    expect(() => assertApprovedLevelCatalogSource(foreignCatalog)).toThrow(
      /do not match the approved hashes/,
    );
  });

  it("throws for invalid source data", () => {
    expect(() => normalizeLevelCatalogSource({}, businessCriteriaJson)).toThrow();
  });
});

describe("approved ibjjf-v2 source hashes", () => {
  it("pins the v2 sources built from the committed files", () => {
    const sources = buildIbjjfV2CatalogSources(observedJson, regyfitJson);
    const normalized = normalizeLevelCatalogSource(sources.observed, sources.business);
    expect({
      observed: normalized.sourceHashes.observed,
      businessCriteria: normalized.sourceHashes.businessCriteria,
      combined: normalized.sourceHash,
    }).toEqual(approvedLevelCatalogSourceHashesBySystem["ibjjf-v2"]);
  });
});

describe("approved ibjjf-v3 source hashes", () => {
  it("pins v3 independently while preserving the v2 golden hash", () => {
    const sources = buildIbjjfV3CatalogSources(observedJson, regyfitJson);
    const normalized = normalizeLevelCatalogSource(sources.observed, sources.business);
    expect({
      observed: normalized.sourceHashes.observed,
      businessCriteria: normalized.sourceHashes.businessCriteria,
      combined: normalized.sourceHash,
    }).toEqual(approvedLevelCatalogSourceHashesBySystem["ibjjf-v3"]);
    expect(() => assertApprovedLevelCatalogSource(normalized)).not.toThrow();
    expect(approvedLevelCatalogSourceHashesBySystem["ibjjf-v2"].combined).toBe(
      "7b3d072ce9e61b3b24edd6c76a5e221c1f3c1deb886be74de4b74182d31df98c",
    );
  });
});
