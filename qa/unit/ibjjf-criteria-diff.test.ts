import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildCriteriaDiff, minimumDaysOf } from "../scripts/ibjjf-criteria-diff.mjs";

const read = (path: string) =>
  JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")) as unknown;

const tinyV1Observed = {
  skillCatalog: [{ key: "tie-the-belt", displayLabel: "Tie The Belt" }],
  skillRequirementSets: [
    { key: "set-a", requirements: [{ skillKey: "tie-the-belt", minimumRating: 2 }] },
  ],
  levels: [
    { key: "white-belt", name: "WHITE BELT", observedSkillRequirementSetKey: "set-a" },
    { key: "blue-belt", name: "BLUE BELT", observedSkillRequirementSetKey: null },
    { key: "purple-belt", name: "PURPLE BELT", observedSkillRequirementSetKey: null },
  ],
};
const tinyV1Business = {
  levels: {
    "white-belt": {
      minAge: 16,
      maxAge: null,
      minClasses: 25,
      minimumTime: { years: 0, months: 2, days: 30 },
    },
    "blue-belt": {
      minAge: 16,
      maxAge: null,
      minClasses: 50,
      minimumTime: { years: 0, months: 5, days: 28 },
    },
    "purple-belt": {
      minAge: 16,
      maxAge: null,
      minClasses: 100,
      minimumTime: { years: 1, months: 0, days: 0 },
    },
  },
};
const tinyRegyfit = {
  skills: [
    { key: "tie-the-belt", displayLabel: "Tie The Belt", category: "Fundamentals" },
    { key: "berimbolo", displayLabel: "Berimbolo", category: "Fundamentals" },
  ],
  levels: [
    {
      name: "WHITE BELT",
      kind: "belt",
      parentName: null,
      criteria: { minAge: 16, maxAge: null, minClasses: 20, minDays: 60 },
      skillMinimums: [{ skillKey: "tie-the-belt", minimumRating: 3 }],
    },
    {
      name: "BLUE BELT",
      kind: "belt",
      parentName: null,
      criteria: { minAge: 17, maxAge: null, minClasses: 50, minDays: 178 },
      skillMinimums: [],
    },
    {
      name: "Black - 1st Degree",
      kind: "stripe",
      parentName: "BLUE BELT",
      criteria: { minAge: 22, maxAge: null, minClasses: 150, minDays: 1095 },
      skillMinimums: [],
    },
  ],
};

describe("IBJJF criteria diff", () => {
  it("converts BPT minimum time with the rule the platform applies today", () => {
    expect(minimumDaysOf({ years: 0, months: 1, days: 14 })).toBe(44);
    expect(minimumDaysOf({ years: 2, months: 11, days: 30 })).toBe(1090);
    expect(minimumDaysOf(null)).toBeNull();
  });

  it("lists new levels, criteria rows and skill minimum rows", () => {
    const { markdown, counts } = buildCriteriaDiff({
      v1Observed: tinyV1Observed,
      v1Business: tinyV1Business,
      regyfit: tinyRegyfit,
    });
    expect(counts).toEqual({
      regyfitLevels: 3,
      bptLevels: 3,
      onlyRegyfit: 1,
      onlyBpt: 1,
      criteriaDiffLevels: 2,
      regyfitSkills: 2,
      bptSkills: 1,
      onlyRegyfitSkills: 1,
      skillMinimumDiffLevels: 1,
    });
    expect(markdown).toContain("| Black - 1st Degree | stripe | BLUE BELT | 22 | — | 150 | 1095 |");
    expect(markdown).toContain("| BLUE BELT | Min age | 16 | 17 |");
    expect(markdown).toContain("\n| PURPLE BELT |\n");
    expect(markdown).toContain("| WHITE BELT | Min classes | 25 | 20 |");
    expect(markdown).toContain("| WHITE BELT | Min days | 90 | 60 |");
    expect(markdown).not.toContain("| BLUE BELT | Min days |");
    expect(markdown).toContain("| WHITE BELT | Tie The Belt | 2 | 3 |");
    expect(markdown).toContain("| Fundamentals | Berimbolo |");
  });

  it("matches the real committed files", () => {
    const { counts } = buildCriteriaDiff({
      v1Observed: read("docs/data/ibjjf-levels-observed.sanitized.json"),
      v1Business: read("docs/data/ibjjf-levels-business-criteria.sanitized.json"),
      regyfit: read("docs/data/ibjjf-skills-observed.sanitized.json"),
    });
    expect(counts).toEqual({
      regyfitLevels: 177,
      bptLevels: 171,
      onlyRegyfit: 6,
      onlyBpt: 0,
      criteriaDiffLevels: 74,
      regyfitSkills: 58,
      bptSkills: 11,
      onlyRegyfitSkills: 47,
      skillMinimumDiffLevels: 0,
    });
  });
});
