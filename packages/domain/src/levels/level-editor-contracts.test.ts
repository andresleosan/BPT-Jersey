import { describe, expect, it } from "vitest";

import { parseLevelCatalogProjection } from "./level-contracts";
import {
  customLevelSystemIdPattern,
  missingProgressKeys,
  saveLevelCatalogDraftInputSchema,
} from "./level-editor-contracts";

const level = {
  definitionKey: "white",
  kind: "belt",
  parentDefinitionKey: null,
  name: "White belt",
  sequence: 1,
  stripeNumber: null,
  criteria: { minAge: 4, maxAge: null, minClasses: 0, minimumTime: null },
  visual: { colors: ["#FFFFFF"], stripeColor: "#111111", stripeCount: 4 },
};

function draft(overrides: Record<string, unknown> = {}) {
  return {
    systemId: "bpt-20260926-1",
    displayName: "BPT 2026",
    levels: [level],
    skills: [],
    requirements: [],
    ...overrides,
  };
}

describe("level draft validation", () => {
  it("accepts a valid belt", () => {
    expect(saveLevelCatalogDraftInputSchema.safeParse(draft()).success).toBe(true);
  });

  it.each([
    ["colour that is not hex", { visual: { ...level.visual, colors: ["red;background:url(x)"] } }],
    ["empty stripe colour", { visual: { ...level.visual, stripeColor: "" } }],
    // IBJJF kids belts carry 11 degrees in ibjjf-v3, so 11 is the ceiling and 12 the first refusal.
    ["too many stripes", { visual: { ...level.visual, stripeCount: 12 } }],
    ["negative classes", { criteria: { ...level.criteria, minClasses: -1 } }],
    ["age out of range", { criteria: { ...level.criteria, minAge: 2 } }],
    ["age above range", { criteria: { ...level.criteria, maxAge: 100 } }],
    [
      "negative minimum time",
      { criteria: { ...level.criteria, minimumTime: { years: 0, months: 0, days: -1 } } },
    ],
    ["name too long", { name: "x".repeat(81) }],
    ["empty name", { name: "   " }],
  ])("rejects %s", (_label, patch) => {
    expect(
      saveLevelCatalogDraftInputSchema.safeParse(draft({ levels: [{ ...level, ...patch }] }))
        .success,
    ).toBe(false);
  });

  it("accepts 11 stripes, the IBJJF kids maximum", () => {
    expect(
      saveLevelCatalogDraftInputSchema.safeParse(
        draft({ levels: [{ ...level, visual: { ...level.visual, stripeCount: 11 } }] }),
      ).success,
    ).toBe(true);
  });

  it("rejects editing a code catalogue", () => {
    expect(
      saveLevelCatalogDraftInputSchema.safeParse(draft({ systemId: "ibjjf-v3", displayName: "x" }))
        .success,
    ).toBe(false);
  });

  it("rejects duplicate level keys, orphan stripes and dangling requirements", () => {
    expect(
      saveLevelCatalogDraftInputSchema.safeParse(draft({ levels: [level, level] })).success,
    ).toBe(false);
    const orphan = { ...level, definitionKey: "s1", kind: "stripe", parentDefinitionKey: "none" };
    expect(
      saveLevelCatalogDraftInputSchema.safeParse(draft({ levels: [level, orphan] })).success,
    ).toBe(false);
    expect(
      saveLevelCatalogDraftInputSchema.safeParse(
        draft({
          requirements: [{ definitionKey: "white", skillKey: "missing", minimumRating: 3 }],
        }),
      ).success,
    ).toBe(false);
  });

  it("accepts a requirement that names a level and a skill of the draft", () => {
    expect(
      saveLevelCatalogDraftInputSchema.safeParse(
        draft({
          skills: [{ key: "shrimp", displayLabel: "Shrimp", minimumRating: 3, sequence: 1 }],
          requirements: [{ definitionKey: "white", skillKey: "shrimp", minimumRating: 3 }],
        }),
      ).success,
    ).toBe(true);
  });
});

describe("customLevelSystemIdPattern", () => {
  it("matches only BPT custom versions", () => {
    expect(customLevelSystemIdPattern.test("bpt-20260926-1")).toBe(true);
    expect(customLevelSystemIdPattern.test("bpt-20260926-123")).toBe(true);
    expect(customLevelSystemIdPattern.test("bpt-20260926-1234")).toBe(false);
    expect(customLevelSystemIdPattern.test("ibjjf-v3")).toBe(false);
  });
});

describe("missingProgressKeys", () => {
  it("lists keys students hold that the target version lacks", () => {
    const result = missingProgressKeys(new Set(["white", "blue"]), [
      { studentId: "a", currentDefinitionKey: "white" },
      { studentId: "b", currentDefinitionKey: "white-stripe-2" },
      { studentId: "c", currentDefinitionKey: "white-stripe-2" },
    ]);
    expect(result).toEqual([{ definitionKey: "white-stripe-2", students: 2 }]);
  });

  it("returns nothing when every held key survives", () => {
    expect(
      missingProgressKeys(new Set(["white"]), [{ studentId: "a", currentDefinitionKey: "white" }]),
    ).toEqual([]);
  });
});

describe("parseLevelCatalogProjection with a custom version", () => {
  it("accepts an active custom catalogue without a fixed shape", () => {
    const result = parseLevelCatalogProjection({
      system: { systemId: "bpt-20260926-1", displayName: "BPT 2026" },
      definitions: [{ definitionKey: "white" }],
      skills: [],
      requirements: [],
      sourceHash: "a".repeat(64),
    });
    expect(result.ok).toBe(true);
  });

  it("still rejects an unknown system id", () => {
    expect(
      parseLevelCatalogProjection({
        system: { systemId: "other-1" },
        definitions: [],
        skills: [],
        requirements: [],
        sourceHash: "a".repeat(64),
      }).ok,
    ).toBe(false);
  });
});
