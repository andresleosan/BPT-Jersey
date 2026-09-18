import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import regyfitJson from "../../../../docs/data/ibjjf-skills-observed.sanitized.json";
import { buildIbjjfV2CatalogSources } from "./level-catalog-v2";
import { parseLevelCatalogSource } from "./level-contracts";
import type { LevelDefinitionRecord } from "./level-contracts";
import { ladderIndexes, listPromotionGaps } from "./level-progress";

/**
 * T051V2 Task 13 — the blocking item carried out of Task 9's DECISION 4.
 *
 * Skip counts are computed only inside the target's own age-band ladder, and the ladders are
 * DERIVED (`ladderIndexes` walks the definitions by `sequence` and opens a new ladder wherever a
 * definition's age window steps outside the window its ladder opened with). Every ladder test
 * written so far pinned `ibjjf-v1` (171 definitions). Plan C publishes `ibjjf-v2` (177 definitions,
 * 6 new black-belt degrees), so if v2's age windows widened mid-ladder the partition — and with it
 * every "Skips N belts / N stripes" the head coach is shown, and whether a note is mandatory —
 * would shift on the catalogue we actually use, with nothing failing.
 *
 * These cases pin the partition on BOTH catalogues from the real sources, so a v1/v2 divergence
 * cannot land silently.
 */

const v1Result = parseLevelCatalogSource(observedJson, businessCriteriaJson);
if (!v1Result.ok) throw new Error("ibjjf-v1 must parse");
const v1 = v1Result.value;

const v2Sources = buildIbjjfV2CatalogSources(observedJson, regyfitJson);
const v2Result = parseLevelCatalogSource(v2Sources.observed, v2Sources.business);
if (!v2Result.ok) throw new Error("ibjjf-v2 must parse");
const v2 = v2Result.value;

/** The ladders as spans, read back out of `ladderIndexes` — the real function, not a copy. */
function ladderSpans(definitions: readonly LevelDefinitionRecord[]): readonly Readonly<{
  ladder: number;
  firstSequence: number;
  lastSequence: number;
  firstKey: string;
  lastKey: string;
}>[] {
  const indexes = ladderIndexes(definitions);
  const ordered = [...definitions].sort((left, right) => left.sequence - right.sequence);
  const spans = new Map<
    number,
    {
      ladder: number;
      firstSequence: number;
      lastSequence: number;
      firstKey: string;
      lastKey: string;
    }
  >();
  for (const definition of ordered) {
    const ladder = indexes.get(definition.definitionKey);
    if (ladder === undefined) throw new Error(`no ladder for ${definition.definitionKey}`);
    const span = spans.get(ladder);
    if (span === undefined) {
      spans.set(ladder, {
        ladder,
        firstSequence: definition.sequence,
        lastSequence: definition.sequence,
        firstKey: definition.definitionKey,
        lastKey: definition.definitionKey,
      });
      continue;
    }
    span.lastSequence = definition.sequence;
    span.lastKey = definition.definitionKey;
  }
  return [...spans.values()].sort((left, right) => left.ladder - right.ladder);
}

const topScores: Record<string, number> = Object.fromEntries(
  v2.skills.map((skill) => [skill.key, 5]),
);

describe("age-band ladders on the real catalogues (T051V2)", () => {
  it("derives exactly four ladders from ibjjf-v1, the four the belts are named for", () => {
    expect(v1.system.systemId).toBe("ibjjf-v1");
    expect(v1.definitions).toHaveLength(171);
    expect(ladderSpans(v1.definitions)).toEqual([
      {
        ladder: 0,
        firstSequence: 1,
        lastSequence: 48,
        firstKey: "white-belt-kids-4-5-and-5-7-yo",
        lastKey: "grey-and-black-4-5-and-5-7yo-11th-stripe",
      },
      {
        ladder: 1,
        firstSequence: 49,
        lastSequence: 102,
        firstKey: "white-belt-kids-7-8-and-8-10-yo",
        lastKey: "yellow-and-black-7-8-and-8-10yo-8th-stripe",
      },
      {
        ladder: 2,
        firstSequence: 103,
        lastSequence: 147,
        firstKey: "white-belt-teens-10-12-and-13-15-yo",
        lastKey: "green-and-black-4th-stripe",
      },
      {
        ladder: 3,
        firstSequence: 148,
        lastSequence: 171,
        firstKey: "white-belt",
        lastKey: "red-belt",
      },
    ]);
  });

  it("derives the SAME four ladders from ibjjf-v2, with the 6 black degrees inside the adult one", () => {
    expect(v2.system.systemId).toBe("ibjjf-v2");
    expect(v2.definitions).toHaveLength(177);
    expect(ladderSpans(v2.definitions)).toEqual([
      {
        ladder: 0,
        firstSequence: 1,
        lastSequence: 48,
        firstKey: "white-belt-kids-4-5-and-5-7-yo",
        lastKey: "grey-and-black-4-5-and-5-7yo-11th-stripe",
      },
      {
        ladder: 1,
        firstSequence: 49,
        lastSequence: 102,
        firstKey: "white-belt-kids-7-8-and-8-10-yo",
        lastKey: "yellow-and-black-7-8-and-8-10yo-8th-stripe",
      },
      {
        ladder: 2,
        firstSequence: 103,
        lastSequence: 147,
        firstKey: "white-belt-teens-10-12-and-13-15-yo",
        lastKey: "green-and-black-4th-stripe",
      },
      // The only v2 movement: the adult ladder grows from 171 to 177, because black 1st-6th degree
      // raise `minAge` (22, 25, 28, 33, 38, 43) with `maxAge` still absent. A RAISED minimum stays
      // inside the window the adult ladder opened with (16, +inf), so it opens no ladder.
      {
        ladder: 3,
        firstSequence: 148,
        lastSequence: 177,
        firstKey: "white-belt",
        lastKey: "red-belt",
      },
    ]);
  });

  it("puts every one of the 6 new black-belt degrees in the adult ladder", () => {
    const indexes = ladderIndexes(v2.definitions);
    const adult = indexes.get("white-belt");
    expect(adult).toBe(3);
    for (const key of [
      "black-1st-degree",
      "black-2nd-degree",
      "black-3rd-degree",
      "black-4th-degree",
      "black-5th-degree",
      "black-6th-degree",
    ]) {
      expect(indexes.get(key)).toBe(adult);
    }
  });

  it("counts a skip across the new degrees, which only v2 can express", () => {
    expect(
      listPromotionGaps({
        definitions: v2.definitions,
        requirements: v2.requirements,
        fromDefinitionKey: "black-belt",
        toDefinitionKey: "black-6th-degree",
        classesDone: 9999,
        daysDone: 9999,
        skillScores: topScores,
        ageYears: 45,
      }),
    ).toEqual(["Skips 5 stripes"]);
  });

  it("still reports no skip at each v2 ladder boundary, the ordinary ageing-out step", () => {
    const boundaries = [
      {
        from: "grey-and-black-4-5-and-5-7yo-11th-stripe",
        to: "white-belt-kids-7-8-and-8-10-yo",
        ageYears: 8,
      },
      {
        from: "yellow-and-black-7-8-and-8-10yo-8th-stripe",
        to: "white-belt-teens-10-12-and-13-15-yo",
        ageYears: 11,
      },
      { from: "green-and-black-4th-stripe", to: "white-belt", ageYears: 16 },
    ] as const;
    for (const boundary of boundaries) {
      expect(
        listPromotionGaps({
          definitions: v2.definitions,
          requirements: v2.requirements,
          fromDefinitionKey: boundary.from,
          toDefinitionKey: boundary.to,
          classesDone: 9999,
          daysDone: 9999,
          skillScores: topScores,
          ageYears: boundary.ageYears,
        }),
      ).toEqual([]);
    }
  });
});
