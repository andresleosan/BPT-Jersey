import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import regyfitJson from "../../../../docs/data/ibjjf-skills-observed.sanitized.json";
import { buildIbjjfV2CatalogSources, levelCatalogVersionShapes } from "./level-catalog-v2";
import { parseLevelCatalogProjection, parseLevelCatalogSource } from "./level-contracts";

describe("ibjjf-v2 catalogue sources", () => {
  const sources = buildIbjjfV2CatalogSources(observedJson, regyfitJson);
  const parsed = parseLevelCatalogSource(sources.observed, sources.business);

  it("parses into 177 definitions, 58 skills and 165 requirements", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.system.systemId).toBe("ibjjf-v2");
    expect(parsed.value.system.counts).toEqual({ definitions: 177, belts: 27, stripes: 150 });
    expect(parsed.value.skills).toHaveLength(58);
    expect(parsed.value.requirements).toHaveLength(165);
    expect(parsed.value.system.precedence).toEqual(
      levelCatalogVersionShapes["ibjjf-v2"].precedence,
    );
  });

  it("keeps v1 keys and visuals, takes Regyfit criteria in days", () => {
    if (!parsed.ok) throw new Error("parse failed");
    const white = parsed.value.definitions.find(
      (definition) => definition.definitionKey === "white-belt",
    );
    const v1White = observedJson.levels.find((level) => level.key === "white-belt");
    // G11 operator override: adult WHITE BELT keeps BPT's 25 classes / 90 days, not Regyfit's 20/60.
    expect(white?.criteria).toEqual({
      minAge: 16,
      maxAge: null,
      minClasses: 25,
      minimumTime: { years: 0, months: 0, days: 90 },
    });
    expect(white?.visual).toEqual(v1White?.visual);
    const blue = parsed.value.definitions.find(
      (definition) => definition.definitionKey === "blue-belt",
    );
    expect(blue?.criteria.minClasses).toBe(50);
    const degree = parsed.value.definitions.find(
      (definition) => definition.definitionKey === "black-1st-degree",
    );
    expect(degree).toMatchObject({
      kind: "stripe",
      parentDefinitionKey: "black-belt",
      name: "Black - 1st Degree",
    });
    expect(degree?.visual).toEqual(
      observedJson.levels.find((level) => level.key === "black-belt")?.visual,
    );
    const redAndBlack = parsed.value.definitions.find(
      (definition) => definition.name === "RED AND BLACK BELT",
    );
    expect(redAndBlack?.sequence).toBe(175);
  });

  it("gives every black belt degree its parent belt's visual, never a default", () => {
    if (!parsed.ok) throw new Error("parse failed");
    const blackBeltVisual = observedJson.levels.find((level) => level.key === "black-belt")?.visual;
    const degrees = parsed.value.definitions.filter(
      (definition) => definition.parentDefinitionKey === "black-belt",
    );
    expect(degrees).toHaveLength(6);
    for (const degree of degrees) {
      expect(degree.visual).toEqual(blackBeltVisual);
    }
  });

  it("keeps RED BELT's zero-length minimum time instead of Regyfit's absent criterion", () => {
    if (!parsed.ok) throw new Error("parse failed");
    // Operator ruling 2026-09-18: RED BELT keeps BPT's minDays 0; Regyfit has no time criterion.
    const regyfitRed = regyfitJson.levels.find((level) => level.name === "RED BELT");
    expect(regyfitRed?.criteria.minDays).toBeNull();
    const red = parsed.value.definitions.find(
      (definition) => definition.definitionKey === "red-belt",
    );
    expect(red?.criteria).toEqual({
      minAge: 67,
      maxAge: null,
      minClasses: null,
      minimumTime: { years: 0, months: 0, days: 0 },
    });
  });

  it("keeps v1 skill keys and minimum ratings, rating 1 for skills with no level minimum", () => {
    if (!parsed.ok) throw new Error("parse failed");
    const bySkill = new Map(parsed.value.skills.map((skill) => [skill.key, skill]));
    // M2 from Task 1's review: a silent key rename in the Regyfit structure would break Plan D.
    const v1SkillKeys = observedJson.skillCatalog.map((skill) => skill.key);
    expect(v1SkillKeys).toHaveLength(11);
    expect(v1SkillKeys.filter((key) => !bySkill.has(key))).toEqual([]);
    expect(bySkill.get("tie-the-belt")?.minimumRating).toBe(2);
    expect(bySkill.get("warm-up-2-bridges")?.minimumRating).toBe(3);
    expect(bySkill.get("berimbolo")?.minimumRating).toBe(1);
    expect(bySkill.get("warm-up-9-hip-shuffles-forward-and-back")?.observedLabel).toBe(
      "Warm Up 9 - Hip Shuffles Foward And Back",
    );
  });

  it("still parses v1 unchanged and rejects an unknown system", () => {
    const v1 = parseLevelCatalogSource(observedJson, businessCriteriaJson);
    expect(v1.ok && v1.value.system.systemId).toBe("ibjjf-v1");
    const unknown = parseLevelCatalogSource(
      { ...observedJson, systemId: "ibjjf-v9" },
      businessCriteriaJson,
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok)
      expect(unknown.error.map((issue) => issue.code)).toContain("unsupported_level_system");
    const prototypeKey = parseLevelCatalogSource(
      { ...observedJson, systemId: "constructor" },
      businessCriteriaJson,
    );
    expect(prototypeKey.ok).toBe(false);
  });

  it("checks v2 counts against the v2 shape", () => {
    const shortSkills = {
      ...sources.observed,
      skillCatalog: (sources.observed.skillCatalog as unknown[]).slice(0, 11),
    };
    const result = parseLevelCatalogSource(shortSkills, sources.business);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.map((issue) => issue.code)).toContain("expected_58_skills");
  });

  it("validates projections against the version of their system", () => {
    if (!parsed.ok) throw new Error("parse failed");
    const projection = { ...parsed.value, sourceHash: "v2-hash" };
    expect(parseLevelCatalogProjection(projection).ok).toBe(true);
    expect(
      parseLevelCatalogProjection({
        ...projection,
        definitions: projection.definitions.slice(0, 171),
      }).ok,
    ).toBe(false);
  });

  it("refuses a Regyfit structure with unexpected keys", () => {
    expect(() =>
      buildIbjjfV2CatalogSources(observedJson, { ...regyfitJson, members: [] }),
    ).toThrow();
  });
});
