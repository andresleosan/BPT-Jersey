import { describe, expect, it } from "vitest";

import { parseAuditEventDraft } from "../audit/audit-event";
import { parseOpenStudentLevelInput } from "./level-contracts";
import {
  assignLevelInputSchema,
  assignLevelResultSchema,
  importedBaselineSchema,
  recordSkillRatingsInputSchema,
  recordSkillRatingsResultSchema,
  studentLevelCardSchema,
  studentLevelHistoryRequestSchema,
  studentLevelHistorySchema,
  voidPromotionInputSchema,
  voidPromotionResultSchema,
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

const promotionEntry = {
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
  voided: null,
};

const voidedBlock = {
  reason: "Assigned to the wrong member.",
  voidedByRole: "headCoach",
  voidedOn: "2026-09-11",
};

const historyBase = {
  studentId: "student-1",
  currentDefinitionKey: "white-belt",
  entries: [promotionEntry],
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

  it("refuses coach as a deciding or voiding role", () => {
    // Spec 6.3 / G12: only the head coach and the owner assign or void a promotion.
    expect(
      studentLevelHistorySchema.safeParse({
        ...historyBase,
        entries: [{ ...promotionEntry, decidedByRole: "coach" }],
      }).success,
    ).toBe(false);
    expect(
      studentLevelHistorySchema.safeParse({
        ...historyBase,
        entries: [{ ...promotionEntry, voided: { ...voidedBlock, voidedByRole: "coach" } }],
      }).success,
    ).toBe(false);
    expect(
      studentLevelHistorySchema.safeParse({
        ...historyBase,
        entries: [{ ...promotionEntry, decidedByRole: "headCoach" }],
      }).success,
    ).toBe(true);
  });

  it("refuses an unknown key on every manage object", () => {
    expect(studentLevelHistorySchema.safeParse({ ...historyBase, academyId: "a" }).success).toBe(
      false,
    );
    expect(
      studentLevelHistorySchema.safeParse({
        ...historyBase,
        entries: [{ ...promotionEntry, classes: { done: 11, min: 25, met: true } }],
      }).success,
    ).toBe(false);
    expect(
      studentLevelHistorySchema.safeParse({
        ...historyBase,
        entries: [{ ...promotionEntry, voided: { ...voidedBlock, voidedBy: "uid" } }],
      }).success,
    ).toBe(false);
    expect(
      studentLevelHistoryRequestSchema.safeParse({ studentId: "student-1", academyId: "a" })
        .success,
    ).toBe(false);
    expect(
      recordSkillRatingsInputSchema.safeParse({
        studentId: "student-1",
        definitionKey: "white-belt",
        ratings: [{ skillKey: "tie-the-belt", score: 3 }],
        sessionId: "session-1",
      }).success,
    ).toBe(false);
    expect(
      importedBaselineSchema.safeParse({
        classes: 9,
        cutoff: "2026-07-01",
        source: "regyfit-import",
        academyId: "a",
      }).success,
    ).toBe(false);
    expect(
      assignLevelResultSchema.safeParse({
        promotionId: "grad_student-1",
        toDefinitionKey: "white-1st-stripe",
        promotedOn: "2026-09-10",
        gaps: [],
        restore: {},
      }).success,
    ).toBe(false);
    expect(
      voidPromotionResultSchema.safeParse({
        voidId: "void_grad_student-1",
        voidsPromotionId: "grad_student-1",
        restoredDefinitionKey: "white-belt",
        restored: true,
      }).success,
    ).toBe(false);
    expect(recordSkillRatingsResultSchema.safeParse({ recorded: 2, skipped: 0 }).success).toBe(
      false,
    );
  });

  it("refuses a negative or fractional count", () => {
    const baseline = { classes: 9, cutoff: "2026-07-01", source: "regyfit-import" };
    expect(importedBaselineSchema.safeParse(baseline).success).toBe(true);
    expect(importedBaselineSchema.safeParse({ ...baseline, classes: -1 }).success).toBe(false);
    expect(importedBaselineSchema.safeParse({ ...baseline, classes: 1.5 }).success).toBe(false);
    expect(
      studentLevelHistorySchema.safeParse({
        ...historyBase,
        entries: [{ ...promotionEntry, classes: { done: -1, min: 25 } }],
      }).success,
    ).toBe(false);
    expect(
      studentLevelHistorySchema.safeParse({
        ...historyBase,
        entries: [{ ...promotionEntry, days: { done: 70.5, min: 75 } }],
      }).success,
    ).toBe(false);
  });

  it("bounds the history at 400 entries and a stored note at 1000 characters", () => {
    const entries = (count: number) => Array.from({ length: count }, () => promotionEntry);
    expect(
      studentLevelHistorySchema.safeParse({ ...historyBase, entries: entries(400) }).success,
    ).toBe(true);
    expect(
      studentLevelHistorySchema.safeParse({ ...historyBase, entries: entries(401) }).success,
    ).toBe(false);
    expect(
      studentLevelHistorySchema.safeParse({
        ...historyBase,
        entries: [{ ...promotionEntry, note: "x".repeat(1000) }],
      }).success,
    ).toBe(true);
    expect(
      studentLevelHistorySchema.safeParse({
        ...historyBase,
        entries: [{ ...promotionEntry, note: "x".repeat(1001) }],
      }).success,
    ).toBe(false);
  });

  it("reads a stored note that is empty or whitespace without failing the whole history", () => {
    // A read schema over stored data: one bad row must not take the view down.
    for (const note of ["", "   ", null]) {
      expect(
        studentLevelHistorySchema.safeParse({
          ...historyBase,
          entries: [{ ...promotionEntry, note }],
        }).success,
      ).toBe(true);
    }
  });

  it("refuses control characters inside a gap label", () => {
    expect(
      studentLevelHistorySchema.safeParse({
        ...historyBase,
        entries: [{ ...promotionEntry, gaps: [`${escapeControl}[31mSkips 1 stripe`] }],
      }).success,
    ).toBe(false);
    expect(
      assignLevelResultSchema.safeParse({
        promotionId: "grad_student-1",
        toDefinitionKey: "white-1st-stripe",
        promotedOn: "2026-09-10",
        gaps: [`Skips${bellControl} 1 stripe`],
      }).success,
    ).toBe(false);
  });

  it("refuses an empty or whitespace-only evidenceNotes", () => {
    const base = {
      studentId: "student-1",
      definitionKey: "white-belt",
      ratings: [{ skillKey: "tie-the-belt", score: 3 }],
    };
    expect(recordSkillRatingsInputSchema.safeParse(base).success).toBe(true);
    expect(recordSkillRatingsInputSchema.safeParse({ ...base, evidenceNotes: "" }).success).toBe(
      false,
    );
    expect(recordSkillRatingsInputSchema.safeParse({ ...base, evidenceNotes: "   " }).success).toBe(
      false,
    );
    expect(
      recordSkillRatingsInputSchema.safeParse({ ...base, evidenceNotes: "Solid guard." }).success,
    ).toBe(true);
  });

  it("refuses control characters in the open-level decision notes", () => {
    const base = { studentId: "student-1", definitionKey: "white-1st-stripe" };
    expect(parseOpenStudentLevelInput({ ...base, decisionNotes: "Holds this stripe." }).ok).toBe(
      true,
    );
    expect(
      parseOpenStudentLevelInput({ ...base, decisionNotes: `Holds${nullControl} this stripe.` }).ok,
    ).toBe(false);
    expect(
      parseOpenStudentLevelInput({
        ...base,
        decisionNotes: `Holds ${escapeControl}[31m this stripe.`,
      }).ok,
    ).toBe(false);
    expect(
      parseOpenStudentLevelInput({ ...base, decisionNotes: `Holds${deleteControl} this stripe.` })
        .ok,
    ).toBe(false);
    expect(
      parseOpenStudentLevelInput({ ...base, decisionNotes: "First line.\nSecond line." }).ok,
    ).toBe(true);
  });
});
