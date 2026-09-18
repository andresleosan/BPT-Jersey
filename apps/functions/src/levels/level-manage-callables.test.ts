import { describe, expect, it, vi } from "vitest";

import type { LevelAuthorizationService } from "./level-authorization";
import {
  createAssignLevelHandler,
  createGetStudentLevelHistoryHandler,
  createOpenStudentLevelHandler,
  createRecordEvaluationDispatchHandler,
  createRecordSkillRatingsHandler,
  createVoidPromotionHandler,
  hasSkillRatings,
  levelCallableOptions,
} from "./level-callables";
import { LevelStoreError, type LevelCatalogStore } from "./level-service";

function request(data: unknown, role: string, uid = `${role}-user`) {
  return {
    auth: { uid, token: { academyId: "academy-1", role } },
    app: { appId: "test-app" },
    data,
  } as never;
}

/**
 * A fake that only answers "who is this actor". Identity itself (role spoofing, a foreign or null
 * staff id, an owner with no directory record) is NOT under test here and cannot be: that is
 * `assertTransactionalActor`'s job inside the Firestore store, and the in-memory store has no
 * equivalent (ledger, Task 8 carry 4). What IS under test is the callable's own role guard, and
 * every refusal below is pinned by MESSAGE as well as code, because four times in this plan a
 * code-only assertion passed for the wrong reason.
 */
function authorizationWith(
  staffIdForHeadCoach: string | null = "staff-1",
): LevelAuthorizationService {
  return {
    requireActor: async (callable) => {
      const { auth } = callable as unknown as {
        auth: { uid: string; token: { academyId: string; role: string } };
      };
      const role = auth.token.role;
      return {
        kind: "user",
        userId: auth.uid as never,
        academyId: auth.token.academyId as never,
        role: role as never,
        staffId: role === "headCoach" ? staffIdForHeadCoach : role === "coach" ? "staff-1" : null,
      };
    },
    resolveStudent: async (_actor, studentId) => ({ studentId }) as never,
  };
}

const authorization = authorizationWith();

function storeWith(overrides: Partial<Record<keyof LevelCatalogStore, unknown>>) {
  return overrides as unknown as LevelCatalogStore;
}

const assignPayload = {
  studentId: "student-1",
  fromDefinitionKey: "white-belt",
  toDefinitionKey: "white-2nd-stripe",
  promotedOn: "2026-09-10",
  note: "Competition result justifies it.",
};
const voidPayload = {
  studentId: "student-1",
  promotionId: "grad_student-1_white-2nd-stripe_2026-09-10T12:00:00.000Z",
  reason: "Assigned to the wrong member.",
};
const ratingsPayload = {
  studentId: "student-1",
  definitionKey: "white-belt",
  ratings: [{ skillKey: "tie-the-belt", score: 3 }],
};
const openPayload = {
  studentId: "student-1",
  definitionKey: "white-belt",
  decisionNotes: "Imported level.",
  startedOn: "2026-07-01",
};

const decisionRefusal = /The head coach or the owner is required/u;
const staffRefusal = /A current staff role is required/u;
const coachRefusal = /A current coach role is required/u;

describe("level callable transport", () => {
  it("requires App Check on every level callable wrapper", () => {
    expect(levelCallableOptions).toEqual({ enforceAppCheck: true });
  });
});

describe("assignLevel and voidPromotion callables", () => {
  it("pass the owner without a staff id and the head coach with one", async () => {
    const assignLevel = vi.fn(async () => ({
      promotionId: "p",
      toDefinitionKey: "white-2nd-stripe",
      promotedOn: "2026-09-10",
      gaps: [],
    }));
    const handler = createAssignLevelHandler({ store: storeWith({ assignLevel }), authorization });

    await handler(request(assignPayload, "owner"));
    await handler(request(assignPayload, "headCoach"));

    expect(assignLevel).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        academyId: "academy-1",
        decidedBy: "owner-user",
        decidedByRole: "owner",
        decidedByStaffId: null,
      }),
    );
    expect(assignLevel).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ decidedByRole: "headCoach", decidedByStaffId: "staff-1" }),
    );
  });

  it("passes the owner and the head coach through voidPromotion with the same identity rule", async () => {
    const voidPromotion = vi.fn(async () => ({
      voidId: "void_p",
      voidsPromotionId: "p",
      restoredDefinitionKey: "white-belt",
    }));
    const handler = createVoidPromotionHandler({
      store: storeWith({ voidPromotion }),
      authorization,
    });

    await handler(request(voidPayload, "owner"));
    await handler(request(voidPayload, "headCoach"));

    expect(voidPromotion).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ decidedByRole: "owner", decidedByStaffId: null }),
    );
    expect(voidPromotion).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ decidedByRole: "headCoach", decidedByStaffId: "staff-1" }),
    );
  });

  it("deny every other role, by message, before the store is touched", async () => {
    const assignLevel = vi.fn();
    const voidPromotion = vi.fn();
    const openStudentLevel = vi.fn();
    const assign = createAssignLevelHandler({ store: storeWith({ assignLevel }), authorization });
    const voidHandler = createVoidPromotionHandler({
      store: storeWith({ voidPromotion }),
      authorization,
    });
    const open = createOpenStudentLevelHandler({
      store: storeWith({ openStudentLevel }),
      authorization,
    });

    // G12 narrows G6: the administrator sees the record and the history, but never writes a level.
    for (const role of ["administrator", "coach", "guardian", "adultStudent"]) {
      await expect(assign(request(assignPayload, role))).rejects.toMatchObject({
        code: "permission-denied",
        message: expect.stringMatching(decisionRefusal),
      });
      await expect(voidHandler(request(voidPayload, role))).rejects.toMatchObject({
        code: "permission-denied",
        message: expect.stringMatching(decisionRefusal),
      });
      await expect(open(request(openPayload, role))).rejects.toMatchObject({
        code: "permission-denied",
        message: expect.stringMatching(decisionRefusal),
      });
    }
    expect(assignLevel).not.toHaveBeenCalled();
    expect(voidPromotion).not.toHaveBeenCalled();
    expect(openStudentLevel).not.toHaveBeenCalled();
  });

  it("denies a head coach with no staff record on all three write callables", async () => {
    const staffless = authorizationWith(null);
    const assignLevel = vi.fn();
    const voidPromotion = vi.fn();
    const openStudentLevel = vi.fn();

    await expect(
      createAssignLevelHandler({
        store: storeWith({ assignLevel }),
        authorization: staffless,
      })(request(assignPayload, "headCoach")),
    ).rejects.toMatchObject({
      code: "permission-denied",
      message: expect.stringMatching(decisionRefusal),
    });
    await expect(
      createVoidPromotionHandler({
        store: storeWith({ voidPromotion }),
        authorization: staffless,
      })(request(voidPayload, "headCoach")),
    ).rejects.toMatchObject({
      code: "permission-denied",
      message: expect.stringMatching(decisionRefusal),
    });
    await expect(
      createOpenStudentLevelHandler({
        store: storeWith({ openStudentLevel }),
        authorization: staffless,
      })(request(openPayload, "headCoach")),
    ).rejects.toMatchObject({
      code: "permission-denied",
      message: expect.stringMatching(decisionRefusal),
    });
    expect(assignLevel).not.toHaveBeenCalled();
    expect(voidPromotion).not.toHaveBeenCalled();
    expect(openStudentLevel).not.toHaveBeenCalled();
  });

  it("reject extra keys, short notes and map store errors to safe codes", async () => {
    const assignLevel = vi.fn(async () => {
      throw new LevelStoreError("invalid", "A note is required when criteria are not met");
    });
    const handler = createAssignLevelHandler({ store: storeWith({ assignLevel }), authorization });

    await expect(
      handler(request({ ...assignPayload, decidedBy: "x" }, "owner")),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      handler(request({ ...assignPayload, note: "short" }, "owner")),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(assignLevel).not.toHaveBeenCalled();

    const failure = await handler(request(assignPayload, "owner")).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "invalid-argument",
      message: "Levels request is invalid",
    });

    const voidHandler = createVoidPromotionHandler({
      store: storeWith({ voidPromotion: vi.fn() }),
      authorization,
    });
    await expect(
      voidHandler(request({ ...voidPayload, reason: "no" }, "owner")),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("never lets a raw store message reach the caller", async () => {
    // "Promotion cannot be voided" is deliberately ONE store string covering four causes; the
    // callable collapses it further, so the browser can never be told which cause fired.
    const voidPromotion = vi.fn(async () => {
      throw new LevelStoreError("conflict", "Promotion cannot be voided");
    });
    const handler = createVoidPromotionHandler({
      store: storeWith({ voidPromotion }),
      authorization,
    });
    const failure = await handler(request(voidPayload, "owner")).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "failed-precondition",
      message: "Levels state conflicts",
    });
    expect(String((failure as Error).message)).not.toMatch(/voided/u);
  });
});

describe("getStudentLevelHistory callable", () => {
  it("serves staff roles only, and refuses clients by message", async () => {
    const getStudentLevelHistory = vi.fn(async () => ({
      studentId: "student-1",
      currentDefinitionKey: null,
      entries: [],
    }));
    const handler = createGetStudentLevelHistoryHandler({
      store: storeWith({ getStudentLevelHistory }),
      authorization,
    });

    // The administrator READS, which is exactly what G12 allows and the write callables refuse.
    for (const role of ["owner", "administrator", "headCoach", "coach"]) {
      await expect(handler(request({ studentId: "student-1" }, role))).resolves.toMatchObject({
        entries: [],
      });
    }
    for (const role of ["guardian", "adultStudent"]) {
      await expect(handler(request({ studentId: "student-1" }, role))).rejects.toMatchObject({
        code: "permission-denied",
        message: expect.stringMatching(staffRefusal),
      });
    }
    await expect(
      handler(request({ studentId: "student-1", all: true }, "owner")),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(getStudentLevelHistory).toHaveBeenCalledTimes(4);
    expect(getStudentLevelHistory).toHaveBeenLastCalledWith("academy-1", "student-1");
  });

  it("maps a store failure to a safe message", async () => {
    const handler = createGetStudentLevelHistoryHandler({
      store: storeWith({
        getStudentLevelHistory: vi.fn(async () => {
          throw new LevelStoreError("conflict", "Level history is invalid");
        }),
      }),
      authorization,
    });
    await expect(handler(request({ studentId: "student-1" }, "owner"))).rejects.toMatchObject({
      code: "failed-precondition",
      message: "Levels state conflicts",
    });
  });
});

describe("recordSkillRatings callable", () => {
  it("lets coaches, head coaches and the owner rate, nobody else", async () => {
    const recordSkillRatings = vi.fn(async () => ({ studentId: "student-1", recorded: 1 }));
    const handler = createRecordSkillRatingsHandler({
      store: storeWith({ recordSkillRatings }),
      authorization,
    });

    await handler(request(ratingsPayload, "coach"));
    await handler(request(ratingsPayload, "owner"));
    await handler(request(ratingsPayload, "headCoach"));

    expect(recordSkillRatings).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ evaluatorRole: "coach", evaluatorStaffId: "staff-1" }),
    );
    expect(recordSkillRatings).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ evaluatorRole: "owner", evaluatorStaffId: null }),
    );
    expect(recordSkillRatings).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ evaluatorRole: "headCoach", evaluatorStaffId: "staff-1" }),
    );
    for (const role of ["administrator", "guardian", "adultStudent"]) {
      await expect(handler(request(ratingsPayload, role))).rejects.toMatchObject({
        code: "permission-denied",
        message: expect.stringMatching(coachRefusal),
      });
    }
    expect(recordSkillRatings).toHaveBeenCalledTimes(3);
  });

  it("refuses a head coach with no staff record", async () => {
    const recordSkillRatings = vi.fn();
    const handler = createRecordSkillRatingsHandler({
      store: storeWith({ recordSkillRatings }),
      authorization: authorizationWith(null),
    });
    await expect(handler(request(ratingsPayload, "headCoach"))).rejects.toMatchObject({
      code: "permission-denied",
      message: expect.stringMatching(coachRefusal),
    });
    expect(recordSkillRatings).not.toHaveBeenCalled();
  });

  /**
   * The role half of the rating guard, pinned on its own. Today `activeActor` only ever hands back
   * a non-null `staffId` for an active head coach or coach, so the staff-id half alone would refuse
   * this actor too and the role half is mutation-equivalent. `ratingRoles` is the only thing that
   * would still refuse an administrator if a future change ever gave administrators a staff record,
   * so it gets an actor the staff-id half cannot refuse (LECCIONES §5).
   */
  it("refuses an administrator who does have a staff record", async () => {
    const recordSkillRatings = vi.fn();
    const administratorWithStaffRecord: LevelAuthorizationService = {
      requireActor: async () =>
        ({
          kind: "user",
          userId: "administrator-user",
          academyId: "academy-1",
          role: "administrator",
          staffId: "staff-1",
        }) as never,
      resolveStudent: async (_actor, studentId) => ({ studentId }) as never,
    };
    const handler = createRecordSkillRatingsHandler({
      store: storeWith({ recordSkillRatings }),
      authorization: administratorWithStaffRecord,
    });

    await expect(handler(request(ratingsPayload, "administrator"))).rejects.toMatchObject({
      code: "permission-denied",
      message: expect.stringMatching(coachRefusal),
    });
    expect(recordSkillRatings).not.toHaveBeenCalled();
  });

  it("parses the batch with the store's own schema", async () => {
    const recordSkillRatings = vi.fn(async () => ({ studentId: "student-1", recorded: 1 }));
    const handler = createRecordSkillRatingsHandler({
      store: storeWith({ recordSkillRatings }),
      authorization,
    });
    for (const payload of [
      { ...ratingsPayload, ratings: [] },
      { ...ratingsPayload, ratings: [{ skillKey: "tie-the-belt", score: 6 }] },
      {
        ...ratingsPayload,
        ratings: [
          { skillKey: "tie-the-belt", score: 3 },
          { skillKey: "tie-the-belt", score: 4 },
        ],
      },
      { ...ratingsPayload, evidenceNotes: "" },
      { ...ratingsPayload, sessionId: "session-1" },
    ]) {
      await expect(handler(request(payload, "coach"))).rejects.toMatchObject({
        code: "invalid-argument",
      });
    }
    expect(recordSkillRatings).not.toHaveBeenCalled();
  });
});

describe("recordEvaluation dispatch", () => {
  it("sends a payload carrying ratings to the batch handler and everything else to the legacy one", async () => {
    const recordSkillRatings = vi.fn(async () => ({ studentId: "student-1", recorded: 1 }));
    const recordEvaluation = vi.fn(async () => ({ evaluationId: "eval-1" }));
    const handler = createRecordEvaluationDispatchHandler({
      store: storeWith({ recordSkillRatings, recordEvaluation }),
      authorization,
    });

    await handler(request(ratingsPayload, "coach"));
    expect(recordSkillRatings).toHaveBeenCalledTimes(1);
    expect(recordEvaluation).not.toHaveBeenCalled();

    await handler(
      request(
        {
          studentId: "student-1",
          sessionId: "session-1",
          definitionKey: "white-belt",
          skillKey: "tie-the-belt",
          score: 3,
          evidenceNotes: "Solid.",
        },
        "coach",
      ),
    );
    expect(recordEvaluation).toHaveBeenCalledTimes(1);
    expect(recordSkillRatings).toHaveBeenCalledTimes(1);
  });

  it("treats only an own key named ratings on a plain object as a batch", () => {
    expect(hasSkillRatings({ ratings: [] })).toBe(true);
    expect(hasSkillRatings({ ratings: undefined })).toBe(true);
    expect(hasSkillRatings({ skillKey: "tie-the-belt" })).toBe(false);
    expect(hasSkillRatings(null)).toBe(false);
    expect(hasSkillRatings([{ ratings: [] }])).toBe(false);
    expect(hasSkillRatings("ratings")).toBe(false);
    // An inherited `ratings` must not flip the dispatch: the legacy payload stays legacy.
    expect(hasSkillRatings(Object.create({ ratings: [] }) as unknown)).toBe(false);
  });
});

describe("openStudentLevel callable roles (T051V2)", () => {
  it("accepts the owner with a start date", async () => {
    const openStudentLevel = vi.fn(async () => ({
      head: {
        studentId: "student-1",
        currentDefinitionKey: "white-belt",
        currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
        state: "initialized",
      },
      ageBand: { requiredMinAge: 16, requiredMaxAge: null, ageYears: 30, met: true },
    }));
    const handler = createOpenStudentLevelHandler({
      store: storeWith({ openStudentLevel }),
      authorization,
    });

    const opened = await handler(request(openPayload, "owner"));

    expect(openStudentLevel).toHaveBeenCalledWith(
      expect.objectContaining({
        openedBy: "owner-user",
        openedByRole: "owner",
        openedByStaffId: null,
        input: expect.objectContaining({ startedOn: "2026-07-01" }),
      }),
    );
    expect(opened.head).toEqual({
      studentId: "student-1",
      currentDefinitionKey: "white-belt",
      currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
      state: "initialized",
    });
  });
});
