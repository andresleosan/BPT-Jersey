import { describe, expect, it } from "vitest";
import type { LevelDefinitionRecord } from "@bpt-jersey/domain/levels";

import {
  beltPosition,
  beltTipColors,
  beltAgeGroup,
  distinctBeltColors,
  groupBelts,
  ordinal,
  stripeOrdinal,
  techniqueSets,
} from "./levels-grouping";

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

  it("numbers a stripe by its position when the catalogue leaves stripeNumber null", () => {
    const unnumbered = def({ definitionKey: "k-white-x", kind: "stripe", sequence: 4 });
    expect(stripeOrdinal(unnumbered, 0)).toBe(1);
    expect(stripeOrdinal(unnumbered, 10)).toBe(11);
    expect(stripeOrdinal(whiteS2, 0)).toBe(2);
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
    ]);
  });

  it("shows every technique once per distinct list, naming the levels it applies to", () => {
    const stripes = [1, 2, 3, 4, 5].map((n) =>
      def({
        definitionKey: `k-white-s${n}`,
        kind: "stripe",
        sequence: 1 + n,
        parentDefinitionKey: "k-white",
      }),
    );
    const [group] = groupBelts({ definitions: [white, ...stripes] });
    const foundation = ["Tie The Belt (Min 2★)", "Bridges (Min 3★)"];
    const techniques = new Map<string, readonly string[]>([
      ["k-white", foundation],
      ["k-white-s1", foundation],
      ["k-white-s2", [...foundation].reverse()],
      ["k-white-s4", foundation],
      ["k-white-s5", ["Guard Pull (Min 3★)"]],
    ]);

    expect(techniqueSets(group!, techniques)).toEqual([
      { appliesTo: "Belt, 1st–2nd, 4th stripe", techniques: foundation },
      { appliesTo: "5th stripe", techniques: ["Guard Pull (Min 3★)"] },
    ]);
    expect(techniqueSets(group!, new Map())).toEqual([]);
  });

  it("draws stripes in the stripe colour on a tip that contrasts with the belt", () => {
    const visual = (colors: string[]) => ({ ...white.visual, colors, stripeColor: "#ffffff" });
    // Colours taken from the catalogue: blue, brown and black belts.
    expect(beltTipColors(visual(["#1e96c0", "#1890ba", "#1485ac"]))).toEqual({
      tip: "#1a1a18",
      stripe: "#ffffff",
    });
    expect(beltTipColors(visual(["#6d3415", "#602d12", "#562911"])).tip).toBe("#1a1a18");
    expect(beltTipColors(visual(["#262626", "#121212", "#000000"])).tip).toBe("#b3202a");
    expect(beltTipColors({ ...white.visual, stripeColor: null }).stripe).toBe("#ffffff");
  });

  it("lists each colour once with the first belt that wears it", () => {
    const groups = groupBelts({ definitions: [white, blue, blueAlias] });
    expect(distinctBeltColors(groups)).toEqual([
      { color: "#ffffff", name: "White (kids)" },
      { color: "#1f4fa3", name: "Blue" },
    ]);
  });
});

describe("beltPosition", () => {
  const belt = def({ definitionKey: "white-belt", kind: "belt", sequence: 1, name: "WHITE BELT" });
  const first = def({
    definitionKey: "white-1",
    kind: "stripe",
    sequence: 2,
    parentDefinitionKey: "white-belt",
    name: "White - 1st Stripe",
  });
  const second = def({
    definitionKey: "white-2",
    kind: "stripe",
    sequence: 3,
    parentDefinitionKey: "white-belt",
    name: "White - 2nd Stripe",
  });
  const groups = groupBelts({ definitions: [second, belt, first] });

  it("returns the parent belt and the stripe count for a stripe", () => {
    expect(beltPosition(groups, "white-2")).toEqual({ belt, definition: second, stripeCount: 2 });
    expect(beltPosition(groups, "white-1")).toEqual({ belt, definition: first, stripeCount: 1 });
    expect(beltPosition(groups, "white-belt")).toEqual({ belt, definition: belt, stripeCount: 0 });
  });

  it("returns null for a key the catalogue does not carry", () => {
    expect(beltPosition(groups, "missing")).toBeNull();
    expect(beltPosition(groups, "")).toBeNull();
    expect(beltPosition([], "white-belt")).toBeNull();
  });
});
