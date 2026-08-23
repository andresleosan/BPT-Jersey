import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import {
  parseLevelCatalogProjection,
  parseLevelCatalogSource,
  type CanonicalLevelCatalog,
  type LevelCatalogProjection,
} from "./level-contracts";

describe("Level Contracts", () => {
  it("parses valid observed and business criteria JSON into canonical catalog", () => {
    const result = parseLevelCatalogSource(observedJson, businessCriteriaJson);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok result");

    const catalog: CanonicalLevelCatalog = result.value;
    expect(catalog.system.displayName).toBe("JIU-JITSU - IBJJF");
    expect(catalog.system.schemaVersion).toBe(1);
    expect(catalog.definitions).toHaveLength(171);

    const belts = catalog.definitions.filter((d) => d.kind === "belt");
    const stripes = catalog.definitions.filter((d) => d.kind === "stripe");
    expect(belts).toHaveLength(27);
    expect(stripes).toHaveLength(144);

    expect(catalog.skills).toHaveLength(11);
    expect(catalog.requirements).toHaveLength(165);
  });

  it("prioritizes DOCX criteria while retaining observedCriteria", () => {
    const customBusiness = {
      ...businessCriteriaJson,
      levels: {
        ...businessCriteriaJson.levels,
        "white-belt-kids-4-5-and-5-7-yo": {
          minAge: 4,
          maxAge: 7,
          minClasses: 10,
          minimumTime: { years: 0, months: 1, days: 0 },
        },
      },
    };

    const result = parseLevelCatalogSource(observedJson, customBusiness);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok result");

    const target = result.value.definitions.find(
      (d) => d.definitionKey === "white-belt-kids-4-5-and-5-7-yo",
    );
    expect(target).toBeDefined();
    expect(target?.criteria.minClasses).toBe(10);
    expect(target?.criteria.minAge).toBe(4);
    expect(target?.observedCriteria.minClasses).toBe(4);
  });

  it("rejects missing DOCX criteria for a level key", () => {
    const incompleteBusiness = {
      ...businessCriteriaJson,
      levels: { ...businessCriteriaJson.levels },
    };
    // @ts-expect-error test deletion of key
    delete incompleteBusiness.levels["white-belt-kids-4-5-and-5-7-yo"];

    const result = parseLevelCatalogSource(observedJson, incompleteBusiness);
    expect(result.ok).toBe(false);
  });

  it("rejects orphan parentKey", () => {
    const badObserved = {
      ...observedJson,
      levels: observedJson.levels.map((l) =>
        l.key === "white-4-5-and-5-7yo-1st-stripe" ? { ...l, parentKey: "non-existent-parent" } : l,
      ),
    };

    const result = parseLevelCatalogSource(badObserved, businessCriteriaJson);
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate level keys", () => {
    const badObserved = {
      ...observedJson,
      levels: [...observedJson.levels, { ...observedJson.levels[0] }],
    };

    const result = parseLevelCatalogSource(badObserved, businessCriteriaJson);
    expect(result.ok).toBe(false);
  });

  it("rejects invalid visual color format", () => {
    const badObserved = {
      ...observedJson,
      levels: observedJson.levels.map((l, index) =>
        index === 0
          ? { ...l, visual: { ...l.visual, colors: ["invalid-color", "#ffffff", "#ffffff"] } }
          : l,
      ),
    };

    const result = parseLevelCatalogSource(badObserved, businessCriteriaJson);
    expect(result.ok).toBe(false);
  });

  it("rejects invalid skill minimumRating (out of 1-5)", () => {
    const badObserved = {
      ...observedJson,
      skillCatalog: observedJson.skillCatalog.map((s, idx) =>
        idx === 0 ? { ...s, minimumRating: 6 } : s,
      ),
    };

    const result = parseLevelCatalogSource(badObserved, businessCriteriaJson);
    expect(result.ok).toBe(false);
  });

  it("rejects prototype pollution and hostile getters", () => {
    const hostileObject = Object.create({ malicious: true });
    hostileObject.schemaVersion = 1;

    const result = parseLevelCatalogSource(hostileObject, businessCriteriaJson);
    expect(result.ok).toBe(false);
  });

  it("parses and freezes safe level catalog projection", () => {
    const catalogResult = parseLevelCatalogSource(observedJson, businessCriteriaJson);
    if (!catalogResult.ok) throw new Error("Catalog source parsing failed");

    const rawProjection: LevelCatalogProjection = {
      system: catalogResult.value.system,
      definitions: catalogResult.value.definitions,
      skills: catalogResult.value.skills,
      requirements: catalogResult.value.requirements,
      sourceHash: "test-hash-123456",
    };

    const projectionResult = parseLevelCatalogProjection(rawProjection);
    expect(projectionResult.ok).toBe(true);
    if (!projectionResult.ok) throw new Error("Projection parsing failed");

    expect(Object.isFrozen(projectionResult.value)).toBe(true);
    expect(Object.isFrozen(projectionResult.value.definitions)).toBe(true);
  });
});
