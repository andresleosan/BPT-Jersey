import { describe, expect, it } from "vitest";

import { parseAuditEventDraft } from "../audit/audit-event";
import { parseOpenStudentLevelInput } from "./level-contracts";
import {
  assignLevelInputSchema,
  recordSkillRatingsInputSchema,
  studentLevelCardSchema,
  studentLevelHistorySchema,
  voidPromotionInputSchema,
} from "./level-manage-contracts";

const note = "Promoted after a competition result.";

const escapeControl = String.fromCharCode(0x1b);
const bellControl = String.fromCharCode(0x07);
const nullControl = String.fromCharCode(0x00);
const deleteControl = String.fromCharCode(0x7f);
const startOfHeadingControl = String.fromCharCode(0x01);

const assignBase = {
  studentId: "student-1",
  fromDefinitionKey: "white-belt",
  toDefinitionKey: "white-2nd-stripe",
  promotedOn: "2026-09-10",
};

describe("level manage contracts", () => {
  it("accepts an assignment with an optional 10-500 character note and a real date", () => {
    expect(assignLevelInputSchema.safeParse(assignBase).success).toBe(true);
    expect(assignLevelInputSchema.safeParse({ ...assignBase, note }).success).toBe(true);
    expect(assignLevelInputSchema.safeParse({ ...assignBase, note: "too short" }).success).toBe(
      false,
    );
    expect(assignLevelInputSchema.safeParse({ ...assignBase, note: "x".repeat(501) }).success).toBe(
      false,
    );
    expect(
      assignLevelInputSchema.safeParse({ ...assignBase, promotedOn: "2026-02-30" }).success,
    ).toBe(false);
    expect(assignLevelInputSchema.safeParse({ ...assignBase, decidedBy: "someone" }).success).toBe(
      false,
    );
  });

  it("rejects an unbounded, badly shaped or control-character carrying identifier", () => {
    expect(
      assignLevelInputSchema.safeParse({ ...assignBase, studentId: "a".repeat(129) }).success,
    ).toBe(false);
    expect(
      assignLevelInputSchema.safeParse({ ...assignBase, studentId: `stud${nullControl}ent` })
        .success,
    ).toBe(false);
    expect(assignLevelInputSchema.safeParse({ ...assignBase, studentId: "-leading" }).success).toBe(
      false,
    );
    expect(
      assignLevelInputSchema.safeParse({ ...assignBase, toDefinitionKey: "white belt" }).success,
    ).toBe(false);
  });

  it("rejects control characters in operator free text but keeps line breaks", () => {
    expect(
      assignLevelInputSchema.safeParse({ ...assignBase, note: "First line.\nSecond line." })
        .success,
    ).toBe(true);
    // A browser textarea submits CRLF; it is normalised, not refused.
    const normalised = assignLevelInputSchema.safeParse({
      ...assignBase,
      note: "First line.\r\nSecond line.",
    });
    expect(normalised.success).toBe(true);
    expect(normalised.success && normalised.data.note).toBe("First line.\nSecond line.");
    expect(
      assignLevelInputSchema.safeParse({ ...assignBase, note: `Escape ${escapeControl}[31m here.` })
        .success,
    ).toBe(false);
    expect(
      assignLevelInputSchema.safeParse({ ...assignBase, note: `Delete ${deleteControl} here.` })
        .success,
    ).toBe(false);
  });

  it("requires a void reason of 10-500 characters", () => {
    const base = {
      studentId: "student-1",
      promotionId: "grad_student-1_white-2nd-stripe_2026-09-10T12:00:00.000Z",
    };
    expect(voidPromotionInputSchema.safeParse({ ...base, reason: note }).success).toBe(true);
    expect(voidPromotionInputSchema.safeParse({ ...base, reason: "wrong" }).success).toBe(false);
    expect(
      voidPromotionInputSchema.safeParse({ ...base, reason: note, restore: true }).success,
    ).toBe(false);
    expect(
      voidPromotionInputSchema.safeParse({ ...base, reason: `Wrong member ${bellControl} alarm.` })
        .success,
    ).toBe(false);
    expect(voidPromotionInputSchema.safeParse({ ...base, reason: "x".repeat(501) }).success).toBe(
      false,
    );
    expect(
      voidPromotionInputSchema.safeParse({ ...base, promotionId: "a".repeat(384), reason: note })
        .success,
    ).toBe(true);
    expect(
      voidPromotionInputSchema.safeParse({ ...base, promotionId: "a".repeat(385), reason: note })
        .success,
    ).toBe(false);
  });

  it("accepts many distinct 1-5 ratings in one call", () => {
    const base = { studentId: "student-1", definitionKey: "white-belt" };
    expect(
      recordSkillRatingsInputSchema.safeParse({
        ...base,
        ratings: [
          { skillKey: "tie-the-belt", score: 3 },
          { skillKey: "warm-up-2-bridges", score: 5 },
        ],
      }).success,
    ).toBe(true);
    expect(recordSkillRatingsInputSchema.safeParse({ ...base, ratings: [] }).success).toBe(false);
    expect(
      recordSkillRatingsInputSchema.safeParse({
        ...base,
        ratings: [{ skillKey: "tie-the-belt", score: 6 }],
      }).success,
    ).toBe(false);
    expect(
      recordSkillRatingsInputSchema.safeParse({
        ...base,
        ratings: [{ skillKey: "tie-the-belt", score: 2.5 }],
      }).success,
    ).toBe(false);
    expect(
      recordSkillRatingsInputSchema.safeParse({
        ...base,
        ratings: [
          { skillKey: "tie-the-belt", score: 3 },
          { skillKey: "tie-the-belt", score: 4 },
        ],
      }).success,
    ).toBe(false);
    expect(
      recordSkillRatingsInputSchema.safeParse({
        ...base,
        ratings: Array.from({ length: 101 }, (_unused, index) => ({
          skillKey: `skill-${index}`,
          score: 3,
        })),
      }).success,
    ).toBe(false);
    expect(
      recordSkillRatingsInputSchema.safeParse({
        ...base,
        ratings: [{ skillKey: "tie-the-belt", score: 3 }],
        evidenceNotes: "x".repeat(1001),
      }).success,
    ).toBe(false);
    expect(
      recordSkillRatingsInputSchema.safeParse({
        ...base,
        ratings: [{ skillKey: "tie-the-belt", score: 3 }],
        evidenceNotes: `Solid ${startOfHeadingControl} here.`,
      }).success,
    ).toBe(false);
  });

  it("parses a history with a voided promotion and an imported opening", () => {
    const history = {
      studentId: "student-1",
      currentDefinitionKey: "white-belt",
      entries: [
        {
          entryId: "grad_student-1_white-2nd-stripe_2026-09-10T12:00:00.000Z",
          kind: "promotion",
          definitionKey: "white-2nd-stripe",
          fromDefinitionKey: "white-belt",
          assignedOn: "2026-09-10",
          classes: { done: 11, min: 25 },
          days: { done: 71, min: 75 },
          decidedByRole: "owner",
          source: "bpt",
          note,
          gaps: ["Skips 1 stripe"],
          voided: {
            reason: "Assigned to the wrong member.",
            voidedByRole: "headCoach",
            voidedOn: "2026-09-11",
          },
        },
        {
          entryId: "opening_student-1",
          kind: "opening",
          definitionKey: "white-belt",
          fromDefinitionKey: null,
          assignedOn: "2026-07-01",
          classes: null,
          days: null,
          decidedByRole: null,
          source: "regyfit-import",
          note: null,
          gaps: [],
          voided: null,
        },
      ],
    };
    expect(studentLevelHistorySchema.safeParse(history).success).toBe(true);
    expect(
      studentLevelHistorySchema.safeParse({
        ...history,
        entries: [{ ...history.entries[0], decidedBy: "uid" }],
      }).success,
    ).toBe(false);
    // A criterion with no minimum is `min: null`, never a missing key.
    expect(
      studentLevelHistorySchema.safeParse({
        ...history,
        entries: [{ ...history.entries[0], classes: { done: 11, min: null } }],
      }).success,
    ).toBe(true);
    expect(
      studentLevelHistorySchema.safeParse({
        ...history,
        entries: [{ ...history.entries[0], kind: "void" }],
      }).success,
    ).toBe(false);
    expect(
      studentLevelHistorySchema.safeParse({
        ...history,
        entries: [{ ...history.entries[0], gaps: Array.from({ length: 11 }, () => "Gap") }],
      }).success,
    ).toBe(false);
    expect(
      studentLevelHistorySchema.safeParse({
        ...history,
        entries: [{ ...history.entries[0], gaps: ["x".repeat(121)] }],
      }).success,
    ).toBe(false);
  });

  it("reads only the card fields from a progress summary", () => {
    const parsed = studentLevelCardSchema.parse({
      state: "initialized",
      studentId: "student-1",
      currentDefinition: { definitionKey: "white-belt", name: "WHITE BELT" },
      targetDefinition: { definitionKey: "white-1st-stripe" },
      currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
      progressPercent: 69,
      criteria: {
        classes: { required: 25, completed: 11, imported: 9, met: false },
        time: { requiredDays: 75, elapsedDays: 71, met: false },
        skills: { total: 0, completed: 0, met: true, percentage: 100 },
      },
      skillChecklist: [],
      totalHours: 3,
    });
    expect(parsed).not.toHaveProperty("totalHours");
    expect(
      studentLevelCardSchema.safeParse({ state: "uninitialized", studentId: "student-1" }).success,
    ).toBe(true);
  });

  it("accepts the top of the catalogue, where progressPercent is null", () => {
    // Spec 6.2: `null` means there is no next level; it is not 0% and must never render a bar.
    const toppedOut = {
      state: "initialized",
      studentId: "student-1",
      currentDefinition: { definitionKey: "red-belt" },
      targetDefinition: null,
      currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
      progressPercent: null,
      criteria: {
        classes: { required: null, completed: 0, imported: 0, met: true },
        time: { requiredDays: null, elapsedDays: 0, met: true },
      },
    };
    const parsed = studentLevelCardSchema.parse(toppedOut);
    expect(parsed.state === "initialized" && parsed.progressPercent).toBe(null);
    expect(studentLevelCardSchema.safeParse({ ...toppedOut, progressPercent: 101 }).success).toBe(
      false,
    );
    expect(studentLevelCardSchema.safeParse({ ...toppedOut, progressPercent: 68.5 }).success).toBe(
      false,
    );
    // G10: `imported` is part of the card contract, so a summary without it is refused.
    expect(
      studentLevelCardSchema.safeParse({
        ...toppedOut,
        criteria: {
          classes: { required: null, completed: 0, met: true },
          time: { requiredDays: null, elapsedDays: 0, met: true },
        },
      }).success,
    ).toBe(false);
  });

  it("accepts an optional real startedOn when opening a level", () => {
    const base = {
      studentId: "student-1",
      definitionKey: "white-1st-stripe",
      decisionNotes: "Holds this stripe already.",
    };
    expect(parseOpenStudentLevelInput({ ...base, startedOn: "2026-07-01" }).ok).toBe(true);
    expect(parseOpenStudentLevelInput(base).ok).toBe(true);
    expect(parseOpenStudentLevelInput({ ...base, startedOn: "01/07/2026" }).ok).toBe(false);
    expect(parseOpenStudentLevelInput({ ...base, startedOn: "2026-02-30" }).ok).toBe(false);
    expect(parseOpenStudentLevelInput({ ...base, startedOn: 20260701 }).ok).toBe(false);
  });

  it("keeps startedOn on the parsed open input and drops it when absent", () => {
    const base = {
      studentId: "student-1",
      definitionKey: "white-1st-stripe",
      decisionNotes: "Holds this stripe already.",
    };
    const withDate = parseOpenStudentLevelInput({ ...base, startedOn: "2026-07-01" });
    expect(withDate.ok && withDate.value.startedOn).toBe("2026-07-01");
    const withoutDate = parseOpenStudentLevelInput(base);
    expect(withoutDate.ok && Object.hasOwn(withoutDate.value, "startedOn")).toBe(false);
  });

  it("accepts the void audit only against levelPromotions with the promotion purpose", () => {
    const draft = {
      academyId: "academy-1",
      actorId: "owner-1",
      action: "level.promotion.voided",
      targetRef: "academies/academy-1/levelPromotions/void_grad_student-1",
      purpose: "student-level-promotion",
      correlationId: `level-write-${"b".repeat(64)}`,
    };
    expect(parseAuditEventDraft(draft).ok).toBe(true);
    expect(parseAuditEventDraft({ ...draft, purpose: "student-level-opening" }).ok).toBe(false);
    expect(
      parseAuditEventDraft({
        ...draft,
        targetRef: "academies/academy-1/studentLevelProgress/void_grad_student-1",
      }).ok,
    ).toBe(false);
    expect(parseAuditEventDraft({ ...draft, correlationId: "level-write-short" }).ok).toBe(false);
  });
});
