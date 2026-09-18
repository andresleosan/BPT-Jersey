import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const structure = JSON.parse(
  readFileSync(
    new URL("../../docs/data/ibjjf-skills-observed.sanitized.json", import.meta.url),
    "utf8",
  ),
) as {
  skills: {
    regyfitId: string;
    key: string;
    displayLabel: string;
    observedLabel: string | null;
    category: string;
    sequence: number;
  }[];
  levels: {
    regyfitId: string;
    name: string;
    kind: string;
    parentName: string | null;
    sequence: number;
    criteria: Record<string, number | null>;
    skillMinimums: { skillKey: string; minimumRating: number }[];
  }[];
} & Record<string, unknown>;

describe("ibjjf-skills-observed.sanitized.json", () => {
  it("holds only the allowlisted structure keys", () => {
    expect(Object.keys(structure).sort()).toEqual([
      "levels",
      "observedAt",
      "schemaVersion",
      "skills",
      "source",
    ]);
    for (const skill of structure.skills) {
      expect(Object.keys(skill).sort()).toEqual([
        "category",
        "displayLabel",
        "key",
        "observedLabel",
        "regyfitId",
        "sequence",
      ]);
    }
    for (const level of structure.levels) {
      expect(Object.keys(level).sort()).toEqual([
        "criteria",
        "kind",
        "name",
        "parentName",
        "regyfitId",
        "sequence",
        "skillMinimums",
      ]);
      expect(Object.keys(level.criteria).sort()).toEqual([
        "maxAge",
        "minAge",
        "minClasses",
        "minDays",
      ]);
    }
  });

  it("carries no personal data shapes", () => {
    // The only date allowed is the capture date; no e-mail, phone or other date may appear.
    const text = JSON.stringify(structure).replaceAll('"observedAt":"2026-09-17"', "");
    expect(text).not.toMatch(/@|\+44|\d{4}-\d{2}-\d{2}/u);
  });

  it("captures the 58 skills with v1 keys preserved and categories from the label prefix", () => {
    expect(structure.skills).toHaveLength(58);
    expect(new Set(structure.skills.map((skill) => skill.key)).size).toBe(58);
    expect(structure.skills.map((skill) => skill.sequence)).toEqual(
      Array.from({ length: 58 }, (_, i) => i + 1),
    );
    const tie = structure.skills.find((skill) => skill.key === "tie-the-belt");
    expect(tie).toMatchObject({
      displayLabel: "Tie The Belt",
      observedLabel: "1. Tie The Belt",
      category: "Fundamentals",
    });
    expect(
      structure.skills.find((skill) => skill.key === "warm-up-9-hip-shuffles-forward-and-back"),
    ).toMatchObject({
      displayLabel: "Warm Up 9 - Hip Shuffles Forward And Back",
      observedLabel: "Warm Up 9 - Hip Shuffles Foward And Back",
      category: "Warm Up",
    });
    const counts = Object.fromEntries(
      [...new Set(structure.skills.map((skill) => skill.category))].map((category) => [
        category,
        structure.skills.filter((skill) => skill.category === category).length,
      ]),
    );
    expect(counts).toEqual({
      Fundamentals: 6,
      "Dominant Positions": 9,
      Escapes: 1,
      Guard: 5,
      "Guard Passing": 6,
      Submissions: 13,
      Sweeps: 8,
      "Warm Up": 10,
    });
  });

  it("captures 177 levels (27 belts, 150 stripes) with 15 skill minimum sets", () => {
    expect(structure.levels).toHaveLength(177);
    expect(structure.levels.filter((level) => level.kind === "belt")).toHaveLength(27);
    expect(structure.levels.filter((level) => level.kind === "stripe")).toHaveLength(150);
    expect(structure.levels.filter((level) => level.skillMinimums.length > 0)).toHaveLength(15);
    const names = new Set(structure.levels.map((level) => level.name));
    for (const level of structure.levels) {
      if (level.parentName !== null) expect(names.has(level.parentName)).toBe(true);
    }
    const skillKeys = new Set(structure.skills.map((skill) => skill.key));
    for (const level of structure.levels) {
      for (const minimum of level.skillMinimums) expect(skillKeys.has(minimum.skillKey)).toBe(true);
    }
    expect(structure.levels.find((level) => level.name === "WHITE BELT")?.criteria).toEqual({
      minAge: 16,
      maxAge: null,
      minClasses: 20,
      minDays: 60,
    });
    // The captured structure keeps Regyfit's 20/60; the G11 operator override to 25/90 is applied
    // later, by buildIbjjfV2CatalogSources (Task 3), not by the capture.
    expect(structure.levels.find((level) => level.name === "Black - 1st Degree")).toMatchObject({
      kind: "stripe",
      parentName: "BLACK BELT",
      criteria: { minAge: 22, maxAge: null, minClasses: 150, minDays: 1095 },
    });
  });
});
