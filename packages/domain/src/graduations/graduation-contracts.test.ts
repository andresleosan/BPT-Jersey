import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { parseLevelCatalogSource } from "../levels/level-contracts";
import { computeLevelProgress } from "../levels/level-progress";
import { assessGraduation, type GraduationInput } from "./graduation-contracts";

const parsed = parseLevelCatalogSource(observedJson, businessCriteriaJson);
if (!parsed.ok) throw new Error("catalogue must parse");
const first = parsed.value.definitions[0]!;
// The next level in the 2026-10-20 case: 4 classes and 30 days. Skills play no part in review.
const target = {
  ...first,
  criteria: { ...first.criteria, minClasses: 4, minimumTime: { years: 0, months: 0, days: 30 } },
};

function input(
  counted: GraduationInput["counted"],
  reviews: GraduationInput["reviews"] = [],
): GraduationInput {
  return {
    target,
    currentLevelStartedAt: "2026-09-08T00:00:00.000Z",
    // Three classes carried in from before BPT; BPT attendance counts from the level start.
    importedBaseline: { classes: 3, cutoff: "2026-09-08", source: "regyfit-import" },
    counted,
    sessions: [],
    bookedSessionIds: new Set<string>(),
    reviews,
    now: "2026-10-20T12:00:00.000Z",
  };
}

const earlyClass = { occurredAt: "2026-09-18T17:00:00.000Z", sessionId: "s-1" };

describe("graduation review versus overall progress (pinned, unchanged policy)", () => {
  it("keeps 3 imported + 1 BPT class taken before the time was met out of review", () => {
    expect(assessGraduation(input([earlyClass]))).toMatchObject({
      stage: "next",
      classesDone: 4,
      minClasses: 4,
      daysDone: 42,
      minDays: 30,
      periodEndsOn: "2026-10-08",
      graduationClass: null,
    });
    // The same member's card reads 66%: classes and days are full, no skill is at its minimum.
    expect(
      computeLevelProgress({
        classes: { done: 4, min: 4 },
        days: { done: 42, min: 30 },
        skills: [{ score: 0, required: 32 }],
      }),
    ).toBe(66);
  });

  it("opens review at the first BPT class attended once both are met", () => {
    const graduationClass = { occurredAt: "2026-10-10T17:00:00.000Z", sessionId: "s-2" };

    expect(assessGraduation(input([earlyClass, graduationClass]))).toMatchObject({
      stage: "approval",
      graduationClass,
    });
  });

  it("never opens review on an office-added class, nor on the class a Not yet was given at", () => {
    const added = { occurredAt: "2026-10-10T12:00:00.000Z", sessionId: null };
    expect(assessGraduation(input([added])).stage).toBe("next");

    const attended = { occurredAt: "2026-10-10T17:00:00.000Z", sessionId: "s-2" };
    const notYet = {
      sessionId: "s-2",
      definitionKey: target.definitionKey,
      decidedAt: "2026-10-10T19:00:00.000Z",
      note: null,
    };
    expect(assessGraduation(input([attended], [notYet])).stage).toBe("next");
  });
});
