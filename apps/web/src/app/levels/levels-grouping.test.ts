import { describe, expect, it } from "vitest";
import type { LevelDefinitionRecord } from "@bpt-jersey/domain/levels";

import { beltAgeGroup, distinctBeltColors, groupBelts } from "./levels-grouping";

function def(
  overrides: Partial<LevelDefinitionRecord> &
    Pick<LevelDefinitionRecord, "definitionKey" | "kind" | "sequence">,
): LevelDefinitionRecord {
  return {
    systemId: "ibjjf",
    parentDefinitionKey: null,
    name: overrides.definitionKey,
    stripeNumber: null,
    criteria: { minAge: null, maxAge: null, minClasses: null, minimumTime: null },
    observedCriteria: { minAge: null, maxAge: null, minClasses: null, minimumTime: null },
    visual: {
      colorMode: 1,
      colors: ["#ffffff"],
      stripeColor: null,
      stripeCenter: null,
      stripeWidth: null,
      stripePosition: null,
    },
    observedSkillRequirementSetKey: null,
    observedSkillRequirementsState: "none",
    anomalyFlags: [],
    schemaVersion: 1,
    ...overrides,
  };
}

describe("belt grouping", () => {
  const white = def({
    definitionKey: "k-white",
    kind: "belt",
    sequence: 1,
    name: "White (kids)",
    criteria: { minAge: 4, maxAge: 15, minClasses: null, minimumTime: null },
  });
  const whiteS2 = def({
    definitionKey: "k-white-2",
    kind: "stripe",
    sequence: 3,
    parentDefinitionKey: "k-white",
    stripeNumber: 2,
  });
  const whiteS1 = def({
    definitionKey: "k-white-1",
    kind: "stripe",
    sequence: 2,
    parentDefinitionKey: "k-white",
    stripeNumber: 1,
  });
  const blue = def({
    definitionKey: "a-blue",
    kind: "belt",
    sequence: 10,
    name: "Blue",
    criteria: { minAge: 16, maxAge: null, minClasses: 50, minimumTime: null },
    visual: {
      colorMode: 1,
      colors: ["#1f4fa3"],
      stripeColor: null,
      stripeCenter: null,
      stripeWidth: null,
      stripePosition: null,
    },
  });
  const blueAlias = def({
    definitionKey: "a-blue-2",
    kind: "belt",
    sequence: 11,
    name: "Blue II",
    visual: {
      colorMode: 1,
      colors: ["#1f4fa3"],
      stripeColor: null,
      stripeCenter: null,
      stripeWidth: null,
      stripePosition: null,
    },
  });

  it("groups stripes under their belt, ordered by belt sequence and stripe number", () => {
    const groups = groupBelts({ definitions: [blue, whiteS2, white, whiteS1, blueAlias] });
    expect(groups.map((g) => g.belt.definitionKey)).toEqual(["k-white", "a-blue", "a-blue-2"]);
    expect(groups[0]?.stripes.map((s) => s.stripeNumber)).toEqual([1, 2]);
    expect(groups[0]?.ageGroup).toBe("kids");
    expect(groups[1]?.ageGroup).toBe("adults");
    expect(groups[1]?.primaryColor).toBe("#1f4fa3");
  });

  it("classifies age groups by the belt's upper age", () => {
    expect(beltAgeGroup({ minAge: 4, maxAge: 15, minClasses: null, minimumTime: null })).toBe(
      "kids",
    );
    expect(beltAgeGroup({ minAge: 16, maxAge: null, minClasses: null, minimumTime: null })).toBe(
      "adults",
    );
    expect(beltAgeGroup({ minAge: null, maxAge: null, minClasses: null, minimumTime: null })).toBe(
      "adults",
    );
  });

  it("lists each colour once with the first belt that wears it", () => {
    const groups = groupBelts({ definitions: [white, blue, blueAlias] });
    expect(distinctBeltColors(groups)).toEqual([
      { color: "#ffffff", name: "White (kids)" },
      { color: "#1f4fa3", name: "Blue" },
    ]);
  });
});
