import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { name: string; data: unknown }[] = [];
let result: unknown;
let failure: Error | null = null;

vi.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => async (data: unknown) => {
    calls.push({ name, data });
    if (failure) throw failure;
    return { data: result };
  },
}));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import {
  assignLevel,
  getStudentLevelCard,
  getStudentLevelHistory,
  getStudentSkillScores,
  levelsSafeErrors,
  recordEvaluation,
  recordSkillRatings,
  voidPromotion,
} from "./levels-client";
import type { RecordSkillRatingsInput } from "@bpt-jersey/domain/levels";

const NUL = String.fromCharCode(0);

const initializedCard = {
  state: "initialized",
  studentId: "student-1",
  currentDefinition: { definitionKey: "white-belt" },
  targetDefinition: { definitionKey: "white-1st-stripe" },
  currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
  progressPercent: 69,
  criteria: {
    classes: { required: 25, completed: 11, imported: 9, met: false },
    time: { requiredDays: 75, elapsedDays: 71, met: false },
  },
};

const promotionEntry = {
  entryId: "grad_1",
  kind: "promotion",
  definitionKey: "white-1st-stripe",
  fromDefinitionKey: "white-belt",
  assignedOn: "2026-09-10",
  classes: { done: 11, min: 25 },
  days: { done: 71, min: 75 },
  decidedByRole: "headCoach",
  source: "bpt",
  note: "Competition result justifies it.",
  gaps: ["Skips 1 stripe"],
  voided: null,
};

const assignInput = {
  studentId: "student-1",
  fromDefinitionKey: "white-belt",
  toDefinitionKey: "white-2nd-stripe",
  promotedOn: "2026-09-10",
  note: "Competition result justifies it.",
};

const assignResult = {
  promotionId: "grad_1",
  toDefinitionKey: "white-2nd-stripe",
  promotedOn: "2026-09-10",
  gaps: ["Skips 1 stripe"],
};

const ratingsInput: RecordSkillRatingsInput = {
  studentId: "student-1",
  definitionKey: "white-belt",
  ratings: [
    { skillKey: "tie-the-belt", score: 3 },
    { skillKey: "warm-up-2-bridges", score: 4 },
  ],
};

beforeEach(() => {
  calls.length = 0;
  failure = null;
  result = undefined;
});

describe("levels manage client — the safe strings", () => {
  // Pinned by text: a UI copy change is a deliberate act, not a silent one. And they must stay
  // distinct, or a caller switching on the literal would tell two different failures apart wrongly.
  it("is exactly these seven strings", () => {
    expect(levelsSafeErrors).toEqual({
      card: "Levels are unavailable right now. Please try again later.",
      history: "Unable to load the level history. Please try again.",
      assignInput: "Unable to assign the level. Check the date and the note, then try again.",
      assign: "Unable to assign the level. Please try again later.",
      void: "Unable to void the promotion. Please try again.",
      ratings: "Unable to save the ratings. Please try again.",
      scores: "Unable to load the skill ratings. Please try again.",
    });
  });

  it("has no two keys sharing a string", () => {
    const values = Object.values(levelsSafeErrors);
    expect(values).toHaveLength(7);
    expect(new Set(values).size).toBe(7);
  });

  it("never hints at the cause of a void refusal", () => {
    expect(levelsSafeErrors.void).not.toMatch(/latest|voided|restore|snapshot|permission|role/iu);
  });
});

describe("levels manage client — student id validation", () => {
  it.each([
    ["../students", "card"],
    ["", "card"],
    ["-leading-dash", "card"],
    ["has space", "card"],
    ["has/slash", "card"],
  ])("refuses %s before calling anything", async (studentId) => {
    await expect(getStudentLevelCard(studentId)).rejects.toThrow(levelsSafeErrors.card);
    expect(calls).toHaveLength(0);
  });

  // `RegExp.prototype.test` COERCES its argument, so every one of these passed the old guard and
  // reached a callable. `undefined` was the dangerous one: the payload became `{}`, the backend's
  // "my own progress" shape, so the signed-in coach's own data would come back for the member.
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 123],
    ["a boolean", true],
    ["a one-element array", ["student-1"]],
    ["an object", {}],
    ["an object with a toString", { toString: () => "student-1" }],
  ])("refuses %s on all three read calls, with zero callable invocations", async (_label, id) => {
    const studentId = id as unknown as string;
    await expect(getStudentLevelCard(studentId)).rejects.toThrow(levelsSafeErrors.card);
    await expect(getStudentLevelHistory(studentId)).rejects.toThrow(levelsSafeErrors.history);
    await expect(getStudentSkillScores(studentId)).rejects.toThrow(levelsSafeErrors.scores);
    expect(calls).toHaveLength(0);
  });

  it("accepts a 128-character id and refuses a 129-character one", async () => {
    const longest = "a".repeat(128);
    result = { progress: { ...initializedCard, studentId: longest } };
    await expect(getStudentLevelCard(longest)).resolves.toMatchObject({ studentId: longest });
    expect(calls).toHaveLength(1);
    await expect(getStudentLevelCard("a".repeat(129))).rejects.toThrow(levelsSafeErrors.card);
    expect(calls).toHaveLength(1);
  });

  it("refuses a bad student id on the history call too", async () => {
    await expect(getStudentLevelHistory("../students")).rejects.toThrow(levelsSafeErrors.history);
    expect(calls).toHaveLength(0);
  });

  it("refuses a bad student id on the skill scores call too", async () => {
    await expect(getStudentSkillScores("../students")).rejects.toThrow(levelsSafeErrors.scores);
    expect(calls).toHaveLength(0);
  });
});

/**
 * A getter that throws while zod reads the field: `safeParse` does not catch it, so an input built
 * from anything but a plain literal could carry a raw message out to the operator.
 */
describe("levels manage client — a throwing getter on the input", () => {
  const withThrowingGetter = <T extends object>(base: T, field: string, secret: string): T =>
    Object.defineProperty({ ...base }, field, {
      get() {
        throw new Error(secret);
      },
      enumerable: true,
    });

  it("gives the safe assignment message, not the getter's own", async () => {
    const input = withThrowingGetter(assignInput, "promotedOn", "SECRET academies/acad-1 leak");
    await expect(assignLevel(input)).rejects.toThrow(levelsSafeErrors.assignInput);
    await expect(assignLevel(input)).rejects.not.toThrow(/SECRET|academies/u);
    expect(calls).toHaveLength(0);
  });

  it("gives the safe void message, not the getter's own", async () => {
    const input = withThrowingGetter(
      { studentId: "student-1", promotionId: "grad_1", reason: "Assigned to the wrong member." },
      "reason",
      "SECRET staff-9182 leak",
    );
    await expect(voidPromotion(input)).rejects.toThrow(levelsSafeErrors.void);
    await expect(voidPromotion(input)).rejects.not.toThrow(/SECRET|staff-/u);
    expect(calls).toHaveLength(0);
  });

  it("gives the safe ratings message, not the getter's own", async () => {
    const input = withThrowingGetter(ratingsInput, "ratings", "SECRET uid-abc leak");
    await expect(recordSkillRatings(input)).rejects.toThrow(levelsSafeErrors.ratings);
    await expect(recordSkillRatings(input)).rejects.not.toThrow(/SECRET|uid-/u);
    expect(calls).toHaveLength(0);
  });
});

describe("levels manage client — the card", () => {
  it("calls getStudentProgressSummary and returns the parsed card", async () => {
    result = { progress: initializedCard };
    const card = await getStudentLevelCard("student-1");
    expect(calls).toEqual([
      { name: "getStudentProgressSummary", data: { studentId: "student-1" } },
    ]);
    expect(card.state === "initialized" && card.progressPercent).toBe(69);
    expect(card.state === "initialized" && card.criteria.classes.imported).toBe(9);
  });

  it("accepts the topped-out card, where progressPercent is null and there is no next level", async () => {
    result = {
      progress: { ...initializedCard, targetDefinition: null, progressPercent: null },
    };
    const card = await getStudentLevelCard("student-1");
    expect(card.state).toBe("initialized");
    expect(card.state === "initialized" && card.progressPercent).toBeNull();
    expect(card.state === "initialized" && card.targetDefinition).toBeNull();
  });

  it("accepts the uninitialized card", async () => {
    result = { progress: { state: "uninitialized", studentId: "student-1" } };
    await expect(getStudentLevelCard("student-1")).resolves.toEqual({
      state: "uninitialized",
      studentId: "student-1",
    });
  });

  it("turns a malformed card into the safe message", async () => {
    result = { progress: { state: "initialized", studentId: "student-1" } };
    await expect(getStudentLevelCard("student-1")).rejects.toThrow(levelsSafeErrors.card);
  });

  it("refuses a card that names a different student", async () => {
    result = { progress: { ...initializedCard, studentId: "student-2" } };
    await expect(getStudentLevelCard("student-1")).rejects.toThrow(levelsSafeErrors.card);
  });

  it("never lets a backend error text reach the caller", async () => {
    failure = Object.assign(new Error("FirebaseError: permission-denied at academies/x/students/y"), {
      code: "functions/permission-denied",
    });
    await expect(getStudentLevelCard("student-1")).rejects.toThrow(levelsSafeErrors.card);
    await expect(getStudentLevelCard("student-1")).rejects.not.toThrow(/academies/u);
  });
});

describe("levels manage client — the history", () => {
  it("calls getStudentLevelHistory and returns the parsed history", async () => {
    result = {
      studentId: "student-1",
      currentDefinitionKey: "white-1st-stripe",
      entries: [promotionEntry],
    };
    const history = await getStudentLevelHistory("student-1");
    expect(calls).toEqual([{ name: "getStudentLevelHistory", data: { studentId: "student-1" } }]);
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]?.voided).toBeNull();
  });

  it("accepts a voided block whose three sub-fields are independently null", async () => {
    result = {
      studentId: "student-1",
      currentDefinitionKey: "white-belt",
      entries: [
        { ...promotionEntry, voided: { reason: null, voidedByRole: null, voidedOn: null } },
        {
          ...promotionEntry,
          entryId: "grad_2",
          // Shorter than the 10-character write bound, and a role but no date.
          voided: { reason: "oops", voidedByRole: "owner", voidedOn: null },
        },
        {
          ...promotionEntry,
          entryId: "grad_3",
          voided: { reason: "x".repeat(1000), voidedByRole: null, voidedOn: "2026-09-12" },
        },
      ],
    };
    const history = await getStudentLevelHistory("student-1");
    expect(history.entries.map((entry) => entry.voided !== null)).toEqual([true, true, true]);
    expect(history.entries[1]?.voided?.reason).toBe("oops");
    expect(history.entries[2]?.voided?.voidedOn).toBe("2026-09-12");
  });

  it("accepts a row promoted through the old recognition panel, with no gaps and no criteria", async () => {
    result = {
      studentId: "student-1",
      currentDefinitionKey: "white-1st-stripe",
      entries: [{ ...promotionEntry, classes: null, days: null, gaps: [], note: null }],
    };
    const history = await getStudentLevelHistory("student-1");
    expect(history.entries[0]?.classes).toBeNull();
    expect(history.entries[0]?.gaps).toEqual([]);
  });

  it("turns a malformed history into the safe message", async () => {
    result = { studentId: "student-1", entries: [{ entryId: "grad_1" }] };
    await expect(getStudentLevelHistory("student-1")).rejects.toThrow(levelsSafeErrors.history);
  });

  it("refuses a history that names a different student", async () => {
    result = { studentId: "student-2", currentDefinitionKey: null, entries: [] };
    await expect(getStudentLevelHistory("student-1")).rejects.toThrow(levelsSafeErrors.history);
  });

  it("turns a backend refusal into the safe message", async () => {
    failure = Object.assign(new Error("Levels access is not permitted"), {
      code: "functions/permission-denied",
    });
    await expect(getStudentLevelHistory("student-1")).rejects.toThrow(levelsSafeErrors.history);
  });
});

describe("levels manage client — assignment", () => {
  it("sends the parsed input and returns the matching result", async () => {
    result = assignResult;
    await expect(assignLevel(assignInput)).resolves.toMatchObject({ gaps: ["Skips 1 stripe"] });
    expect(calls.at(-1)).toEqual({ name: "assignLevel", data: assignInput });
  });

  it("omits the note key entirely when there is no note, and never sends a ratings key", async () => {
    result = assignResult;
    await assignLevel({
      studentId: assignInput.studentId,
      fromDefinitionKey: assignInput.fromDefinitionKey,
      toDefinitionKey: assignInput.toDefinitionKey,
      promotedOn: assignInput.promotedOn,
    });
    const sent = calls.at(-1)?.data as Record<string, unknown>;
    expect(Object.hasOwn(sent, "note")).toBe(false);
    expect(Object.hasOwn(sent, "ratings")).toBe(false);
  });

  // A form that writes `note: noteText || undefined` sends an OWN `note` key with an undefined
  // value, and zod keeps that key in its output. Forwarding the parse result whole would put it on
  // the wire; spelling the four fields out is what drops it. This pins the exact wire shape.
  it("drops an explicitly undefined note and sends exactly the four assignment keys", async () => {
    result = assignResult;
    await assignLevel({
      studentId: assignInput.studentId,
      fromDefinitionKey: assignInput.fromDefinitionKey,
      toDefinitionKey: assignInput.toDefinitionKey,
      promotedOn: assignInput.promotedOn,
      note: undefined,
    });
    const sent = calls.at(-1)?.data as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual([
      "studentId",
      "fromDefinitionKey",
      "toDefinitionKey",
      "promotedOn",
    ]);
    expect(Object.hasOwn(sent, "note")).toBe(false);
  });

  it.each([
    ["a note under ten characters", { ...assignInput, note: "short" }],
    ["a note carrying a control character", { ...assignInput, note: `Wrong belt${NUL} recorded` }],
    ["a date that is not a calendar date", { ...assignInput, promotedOn: "2026-13-45" }],
    ["a student id with a slash", { ...assignInput, studentId: "a/b" }],
  ])("refuses %s without calling the backend", async (_label, input) => {
    // The client refused this one itself, so the date-and-note advice is true here and only here.
    await expect(assignLevel(input)).rejects.toThrow(levelsSafeErrors.assignInput);
    expect(calls).toHaveLength(0);
  });

  it("refuses a result that promotes to a different level", async () => {
    result = { ...assignResult, toDefinitionKey: "blue-belt" };
    await expect(assignLevel(assignInput)).rejects.toThrow(levelsSafeErrors.assign);
  });

  it("refuses a result dated differently from the request", async () => {
    result = { ...assignResult, promotedOn: "2026-09-11" };
    await expect(assignLevel(assignInput)).rejects.toThrow(levelsSafeErrors.assign);
  });

  it("refuses a malformed result", async () => {
    result = { promotionId: "grad_1" };
    await expect(assignLevel(assignInput)).rejects.toThrow(levelsSafeErrors.assign);
  });

  // G12: an administrator is SUPPOSED to be refused here. Telling them to check the date and the
  // note would send them round a loop they can never leave, so a backend refusal never says it.
  it.each([
    ["a role refusal", "Promotion decision role is invalid"],
    ["a collapsed invalid-request refusal", "Levels request is invalid"],
    ["a level-start conflict", "Levels state conflicts"],
  ])("gives the neutral assignment message for %s", async (_label, message) => {
    result = assignResult;
    failure = new Error(message);
    await expect(assignLevel(assignInput)).rejects.toThrow(levelsSafeErrors.assign);
    await expect(assignLevel(assignInput)).rejects.not.toThrow(/Check the date/u);
  });
});

describe("levels manage client — void", () => {
  const voidInput = {
    studentId: "student-1",
    promotionId: "grad_1",
    reason: "Assigned to the wrong member.",
  };

  it("sends the parsed input and returns the matching result", async () => {
    result = {
      voidId: "void_grad_1",
      voidsPromotionId: "grad_1",
      restoredDefinitionKey: "white-belt",
    };
    await expect(voidPromotion(voidInput)).resolves.toMatchObject({
      restoredDefinitionKey: "white-belt",
    });
    expect(calls.at(-1)).toEqual({ name: "voidPromotion", data: voidInput });
  });

  it.each([
    ["a reason under ten characters", { ...voidInput, reason: "nope" }],
    ["a reason carrying a control character", { ...voidInput, reason: `Wrong${NUL} member here` }],
    ["a missing reason", { studentId: "student-1", promotionId: "grad_1" }],
  ])("refuses %s without calling the backend", async (_label, input) => {
    await expect(voidPromotion(input as never)).rejects.toThrow(levelsSafeErrors.void);
    expect(calls).toHaveLength(0);
  });

  it("refuses a result that voids a different promotion", async () => {
    result = {
      voidId: "void_grad_9",
      voidsPromotionId: "grad_9",
      restoredDefinitionKey: "white-belt",
    };
    await expect(voidPromotion(voidInput)).rejects.toThrow(levelsSafeErrors.void);
  });

  it("gives one safe message whatever the backend refusal was", async () => {
    failure = new Error("Promotion cannot be voided");
    await expect(voidPromotion(voidInput)).rejects.toThrow(levelsSafeErrors.void);
    failure = new Error("Levels state conflicts");
    await expect(voidPromotion(voidInput)).rejects.toThrow(levelsSafeErrors.void);
  });
});

describe("levels manage client — ratings", () => {
  it("sends the batch payload through recordEvaluation", async () => {
    result = { studentId: "student-1", recorded: 2 };
    await expect(recordSkillRatings(ratingsInput)).resolves.toEqual({
      studentId: "student-1",
      recorded: 2,
    });
    const call = calls.at(-1);
    expect(call?.name).toBe("recordEvaluation");
    const sent = call?.data as Record<string, unknown>;
    expect(Object.hasOwn(sent, "ratings")).toBe(true);
    expect(Object.hasOwn(sent, "evidenceNotes")).toBe(false);
    expect(Object.hasOwn(sent, "skillKey")).toBe(false);
    expect(Object.hasOwn(sent, "sessionId")).toBe(false);
  });

  it("sends evidence notes only when there are some", async () => {
    result = { studentId: "student-1", recorded: 2 };
    await recordSkillRatings({ ...ratingsInput, evidenceNotes: "  Graded in class.  " });
    const sent = calls.at(-1)?.data as Record<string, unknown>;
    expect(sent.evidenceNotes).toBe("Graded in class.");
  });

  // Same trap as the assignment note: an explicit `undefined` survives the parse as an own key.
  it("drops an explicitly undefined evidence note and sends exactly the three batch keys", async () => {
    result = { studentId: "student-1", recorded: 2 };
    await recordSkillRatings({ ...ratingsInput, evidenceNotes: undefined });
    const sent = calls.at(-1)?.data as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(["studentId", "definitionKey", "ratings"]);
    expect(Object.hasOwn(sent, "evidenceNotes")).toBe(false);
  });

  it.each([
    ["an empty evidence note", { ...ratingsInput, evidenceNotes: "" }],
    ["a duplicated skill", {
      ...ratingsInput,
      ratings: [
        { skillKey: "tie-the-belt", score: 3 },
        { skillKey: "tie-the-belt", score: 4 },
      ],
    }],
    ["no ratings at all", { ...ratingsInput, ratings: [] }],
    ["a score outside 1-5", { ...ratingsInput, ratings: [{ skillKey: "tie-the-belt", score: 6 }] }],
  ])("refuses %s without calling the backend", async (_label, input) => {
    await expect(recordSkillRatings(input as never)).rejects.toThrow(levelsSafeErrors.ratings);
    expect(calls).toHaveLength(0);
  });

  it("refuses a result that recorded a different number of ratings", async () => {
    result = { studentId: "student-1", recorded: 1 };
    await expect(recordSkillRatings(ratingsInput)).rejects.toThrow(levelsSafeErrors.ratings);
  });

  it("refuses a malformed result", async () => {
    result = { studentId: "student-1", recorded: "2" };
    await expect(recordSkillRatings(ratingsInput)).rejects.toThrow(levelsSafeErrors.ratings);
  });

  // A confirmation about another member is a confirmation about the wrong promotion decision.
  it("refuses a result that names a different student", async () => {
    result = { studentId: "student-2", recorded: 2 };
    await expect(recordSkillRatings(ratingsInput)).rejects.toThrow(levelsSafeErrors.ratings);
  });

  it("refuses a result that names no student at all", async () => {
    result = { recorded: 2 };
    await expect(recordSkillRatings(ratingsInput)).rejects.toThrow(levelsSafeErrors.ratings);
  });

  it("keeps the legacy single-rating payload free of a ratings key", async () => {
    result = { evaluation: { evaluationId: "eval_1" } };
    await recordEvaluation({
      studentId: "student-1",
      sessionId: "session-1",
      definitionKey: "white-belt",
      skillKey: "tie-the-belt",
      score: 3,
      evidenceNotes: "Graded in class.",
      ratings: [{ skillKey: "tie-the-belt", score: 5 }],
    } as never);
    const sent = calls.at(-1)?.data as Record<string, unknown>;
    expect(calls.at(-1)?.name).toBe("recordEvaluation");
    expect(Object.hasOwn(sent, "ratings")).toBe(false);
    expect(Object.hasOwn(sent, "skillKey")).toBe(true);
  });
});

describe("levels manage client — skill scores", () => {
  it("reads the latest and the best score per skill", async () => {
    result = {
      studentId: "student-1",
      evaluations: [{ evidenceNotes: "not needed by the view" }],
      summary: {
        "tie-the-belt": {
          count: 2,
          maxScore: 4,
          latestScore: 3,
          lastEvaluatedAt: "2026-09-10T12:00:00.000Z",
        },
      },
    };
    await expect(getStudentSkillScores("student-1")).resolves.toEqual({
      latest: { "tie-the-belt": 3 },
      best: { "tie-the-belt": 4 },
    });
    expect(calls.at(-1)).toEqual({
      name: "listStudentEvaluations",
      data: { studentId: "student-1" },
    });
  });

  it("returns empty maps when nothing has been rated", async () => {
    result = { studentId: "student-1", evaluations: [], summary: {} };
    await expect(getStudentSkillScores("student-1")).resolves.toEqual({ latest: {}, best: {} });
  });

  it("turns a malformed summary into the safe message", async () => {
    result = { studentId: "student-1", summary: { "tie-the-belt": { count: 2 } } };
    await expect(getStudentSkillScores("student-1")).rejects.toThrow(levelsSafeErrors.scores);
  });

  // Ratings decide a promotion about a named member: a summary that belongs to anyone else — the
  // signed-in coach included — must never be rendered under that member's name.
  it("refuses a summary that names a different student", async () => {
    result = { studentId: "student-2", evaluations: [], summary: {} };
    await expect(getStudentSkillScores("student-1")).rejects.toThrow(levelsSafeErrors.scores);
  });

  it("refuses a summary that names no student at all", async () => {
    result = { evaluations: [], summary: {} };
    await expect(getStudentSkillScores("student-1")).rejects.toThrow(levelsSafeErrors.scores);
  });

  it("turns a backend refusal into the safe message", async () => {
    failure = new Error("Levels record is not available");
    await expect(getStudentSkillScores("student-1")).rejects.toThrow(levelsSafeErrors.scores);
  });
});
