import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { createInMemoryLevelStore } from "./level-service";
import { normalizeLevelCatalogSource } from "./level-source";
import type { LevelAuthorizationService } from "./level-authorization";
import {
  createApprovePromotionHandler,
  createGetStudentProgressSummaryHandler,
  createListGraduationsHandler,
  createListLevelCatalogHandler,
  createListMedicalLeavesHandler,
  createListRecognitionCandidatesHandler,
  createListStudentEvaluationsHandler,
  createRecordEvaluationHandler,
  createRecordMedicalLeaveHandler,
  createRejectPromotionHandler,
} from "./level-callables";

function fakeRequest(
  data: unknown,
  role = "owner",
  uid: string | null = "user-1",
  academyId = "demo-academy",
) {
  return {
    auth: uid ? { uid, token: { academyId, role } } : undefined,
    app: { appId: "test-app" },
    data,
  } as never;
}

const authorization: LevelAuthorizationService = {
  requireActor: async (request) => {
    if (!request.auth) throw new Error("unauthenticated");
    return {
      kind: "user",
      userId: request.auth.uid as never,
      academyId: request.auth.token.academyId as never,
      role: request.auth.token.role as never,
      staffId:
        request.auth.token.role === "headCoach" || request.auth.token.role === "coach"
          ? "staff-1"
          : null,
    };
  },
  resolveStudent: async (actor, requestedStudentId) => ({
    studentId: requestedStudentId ?? actor.userId,
    academyId: actor.academyId,
    ...(actor.role === "adultStudent" ? { userId: actor.userId } : {}),
    fullName: "Synthetic Student",
    dateOfBirth: "1990-01-01",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "owner-1",
  }),
};

describe("Level Callables", () => {
  const normalized = normalizeLevelCatalogSource(observedJson, businessCriteriaJson);

  function createTestStore() {
    const store = createInMemoryLevelStore();
    store.seed({ academyId: "demo-academy", normalized });
    return store;
  }

  it("allows authenticated owner to read the catalog", async () => {
    const store = createTestStore();
    const handler = createListLevelCatalogHandler({ store, authorization });

    const response = await handler(fakeRequest(null, "owner", "user-1", "demo-academy"));

    expect(response.system.systemId).toBe("ibjjf-v1");
    expect(response.definitions).toHaveLength(171);
    expect(response.skills).toHaveLength(11);
    expect(response.requirements).toHaveLength(165);
  });

  it("allows authenticated coach and guardian to read the catalog", async () => {
    const store = createTestStore();
    const handler = createListLevelCatalogHandler({ store, authorization });

    const coachResponse = await handler(fakeRequest(null, "coach", "coach-1", "demo-academy"));
    expect(coachResponse.definitions).toHaveLength(171);

    const guardianResponse = await handler(
      fakeRequest(null, "guardian", "guardian-1", "demo-academy"),
    );
    expect(guardianResponse.definitions).toHaveLength(171);
  });

  it("rejects unauthenticated requests", async () => {
    const store = createTestStore();
    const handler = createListLevelCatalogHandler({ store, authorization });

    await expect(handler(fakeRequest(null, "owner", null, "demo-academy"))).rejects.toThrow();
  });

  it("rejects non-null request payload", async () => {
    const store = createTestStore();
    const handler = createListLevelCatalogHandler({ store, authorization });

    await expect(
      handler(fakeRequest({ unexpected: "payload" }, "owner", "user-1", "demo-academy")),
    ).rejects.toThrow();
  });

  it("enforces tenant boundary (cannot read another academy)", async () => {
    const store = createTestStore();
    const handler = createListLevelCatalogHandler({ store, authorization });

    await expect(handler(fakeRequest(null, "owner", "user-2", "other-academy"))).rejects.toThrow();
  });

  describe("Record Evaluation Callable (T039)", () => {
    it("allows coach to record valid evaluation", async () => {
      const store = createTestStore();
      const recordHandler = createRecordEvaluationHandler({ store, authorization });

      const result = await recordHandler(
        fakeRequest(
          {
            studentId: "student-1",
            sessionId: "session-1",
            definitionKey: "white-1",
            skillKey: "guard-pass-knee-cut",
            score: 4,
            evidenceNotes: "Clean execution and posture maintenance during drills.",
          },
          "coach",
          "coach-1",
          "demo-academy",
        ),
      );

      expect(result.evaluation.studentId).toBe("student-1");
      expect(result.evaluation.score).toBe(4);
      expect(result.evaluation.evaluatorId).toBe("coach-1");
    });

    it("rejects non-staff attempts to record evaluation", async () => {
      const store = createTestStore();
      const recordHandler = createRecordEvaluationHandler({ store, authorization });

      await expect(
        recordHandler(
          fakeRequest(
            {
              studentId: "student-1",
              sessionId: "session-1",
              definitionKey: "white-1",
              skillKey: "guard-pass-knee-cut",
              score: 4,
              evidenceNotes: "Self evaluation not allowed.",
            },
            "adultStudent",
            "student-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow(/current coach role is required/);
    });

    it("rejects invalid payload arguments", async () => {
      const store = createTestStore();
      const recordHandler = createRecordEvaluationHandler({ store, authorization });

      await expect(
        recordHandler(
          fakeRequest(
            {
              studentId: "student-1",
              sessionId: "session-1",
              definitionKey: "white-1",
              skillKey: "guard-pass",
              score: 99,
              evidenceNotes: "Bad score",
            },
            "coach",
            "coach-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow();
    });
  });

  describe("List Student Evaluations Callable & Family Visibility (T039)", () => {
    it("allows staff to list evaluations of any student", async () => {
      const store = createTestStore();
      await store.recordEvaluation({
        academyId: "demo-academy",
        input: {
          studentId: "student-1",
          sessionId: "session-1",
          definitionKey: "white-1",
          skillKey: "armbar-closed-guard",
          score: 5,
          evidenceNotes: "Perfect hip elevation and breaking mechanics.",
        },
        evaluatorId: "coach-1",
        evaluatorStaffId: "staff-1",
        evaluatorRole: "coach",
      });

      const listHandler = createListStudentEvaluationsHandler({ store, authorization });
      const result = await listHandler(
        fakeRequest({ studentId: "student-1" }, "headCoach", "headcoach-1", "demo-academy"),
      );

      expect(result.evaluations).toHaveLength(1);
      expect(result.evaluations[0]?.score).toBe(5);
      expect(result.summary["armbar-closed-guard"]?.maxScore).toBe(5);
    });

    it("allows adult student to list only their own evaluations", async () => {
      const store = createTestStore();
      await store.recordEvaluation({
        academyId: "demo-academy",
        input: {
          studentId: "adult-1",
          sessionId: "session-1",
          definitionKey: "white-1",
          skillKey: "armbar-closed-guard",
          score: 3,
          evidenceNotes: "Good attempt.",
        },
        evaluatorId: "coach-1",
        evaluatorStaffId: "staff-1",
        evaluatorRole: "coach",
      });

      const listHandler = createListStudentEvaluationsHandler({ store, authorization });

      // Can list own
      const ownResult = await listHandler(
        fakeRequest({}, "adultStudent", "adult-1", "demo-academy"),
      );
      expect(ownResult.evaluations).toHaveLength(1);

      // Cannot list another student
      await expect(
        listHandler(
          fakeRequest({ studentId: "adult-2" }, "adultStudent", "adult-1", "demo-academy"),
        ),
      ).rejects.toThrow(/Levels payload is invalid/);
    });
  });

  describe("Get Student Progress Summary Callable (T040)", () => {
    it("allows staff to retrieve student progress summary", async () => {
      const store = createTestStore();
      const progressHandler = createGetStudentProgressSummaryHandler({ store, authorization });

      const res = await progressHandler(
        fakeRequest({ studentId: "student-1" }, "coach", "coach-1", "demo-academy"),
      );

      expect(res.progress.studentId).toBe("student-1");
      expect(res.progress.state).toBe("uninitialized");
    });

    it("enforces family visibility on progress summary", async () => {
      const store = createTestStore();
      const progressHandler = createGetStudentProgressSummaryHandler({ store, authorization });

      // Student can view own progress
      const ownRes = await progressHandler(
        fakeRequest({}, "adultStudent", "adult-1", "demo-academy"),
      );
      expect(ownRes.progress.studentId).toBe("adult-1");

      // Student cannot view other student progress
      await expect(
        progressHandler(
          fakeRequest({ studentId: "other-student" }, "adultStudent", "adult-1", "demo-academy"),
        ),
      ).rejects.toThrow(/Levels payload is invalid/);
    });
  });

  describe("Medical Leave Callables (T041)", () => {
    it("allows staff to record and list medical leave", async () => {
      const store = createTestStore();
      const recordHandler = createRecordMedicalLeaveHandler({ store, authorization });
      const listHandler = createListMedicalLeavesHandler({ store, authorization });

      const recordRes = await recordHandler(
        fakeRequest(
          {
            studentId: "student-1",
            startDate: "2026-08-01T00:00:00Z",
            endDate: "2026-08-15T00:00:00Z",
            reasonCode: "recovery",
          },
          "coach",
          "coach-1",
          "demo-academy",
        ),
      );

      expect(recordRes.medicalLeave.studentId).toBe("student-1");
      expect(recordRes.medicalLeave.reasonCode).toBe("recovery");

      const listRes = await listHandler(
        fakeRequest({ studentId: "student-1" }, "coach", "coach-1", "demo-academy"),
      );
      expect(listRes.medicalLeaves).toHaveLength(1);
    });

    it("rejects non-staff recording medical leave", async () => {
      const store = createTestStore();
      const recordHandler = createRecordMedicalLeaveHandler({ store, authorization });

      await expect(
        recordHandler(
          fakeRequest(
            {
              studentId: "student-1",
              startDate: "2026-08-01T00:00:00Z",
              endDate: "2026-08-15T00:00:00Z",
              reasonCode: "recovery",
            },
            "adultStudent",
            "adult-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow(/current staff role is required/);
    });
  });

  describe("Recognition Candidates Callable (T041)", () => {
    it("allows staff to list recognition candidates", async () => {
      const store = createTestStore();
      const candidatesHandler = createListRecognitionCandidatesHandler({ store, authorization });

      const res = await candidatesHandler(
        fakeRequest({}, "headCoach", "headcoach-1", "demo-academy"),
      );

      expect(Array.isArray(res.candidates)).toBe(true);
    });

    it("rejects non-staff listing recognition candidates", async () => {
      const store = createTestStore();
      const candidatesHandler = createListRecognitionCandidatesHandler({ store, authorization });

      await expect(
        candidatesHandler(fakeRequest({}, "adultStudent", "adult-1", "demo-academy")),
      ).rejects.toThrow(/current staff role is required/);
    });
  });

  describe("Head Coach Promotion & Graduation Callables (T042)", () => {
    it("allows headCoach to approve and reject promotions and lists graduations", async () => {
      const store = createTestStore();
      const approveHandler = createApprovePromotionHandler({ store, authorization });
      const rejectHandler = createRejectPromotionHandler({ store, authorization });
      const listHandler = createListGraduationsHandler({ store, authorization });

      const appRes = await approveHandler(
        fakeRequest(
          {
            studentId: "student-1",
            fromDefinitionKey: "white-0",
            toDefinitionKey: "white-1",
            decisionNotes: "Exemplary commitment, technical guard precision and class leadership.",
            ceremonyDate: "2026-09-01T18:00:00Z",
          },
          "headCoach",
          "headcoach-1",
          "demo-academy",
        ),
      );

      expect(appRes.graduation.status).toBe("approved");
      expect(appRes.graduation.studentId).toBe("student-1");
      expect(appRes.graduation.toDefinitionKey).toBe("white-1");

      const rejRes = await rejectHandler(
        fakeRequest(
          {
            studentId: "student-2",
            targetDefinitionKey: "white-1",
            decisionNotes: "Requires additional sparring rounds and defensive posture drills.",
          },
          "headCoach",
          "headcoach-1",
          "demo-academy",
        ),
      );

      expect(rejRes.graduation.status).toBe("rejected");

      const listRes = await listHandler(
        fakeRequest({ studentId: "student-1" }, "coach", "coach-1", "demo-academy"),
      );
      expect(listRes.graduations).toHaveLength(1);
    });

    it("rejects regular coach or student from approving or rejecting promotions", async () => {
      const store = createTestStore();
      const approveHandler = createApprovePromotionHandler({ store, authorization });
      const rejectHandler = createRejectPromotionHandler({ store, authorization });

      await expect(
        approveHandler(
          fakeRequest(
            {
              studentId: "student-1",
              fromDefinitionKey: "white-0",
              toDefinitionKey: "white-1",
              decisionNotes: "Looks good to me.",
            },
            "coach",
            "coach-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow(/current head coach is required/);

      await expect(
        rejectHandler(
          fakeRequest(
            {
              studentId: "student-1",
              targetDefinitionKey: "white-1",
              decisionNotes: "Not yet ready.",
            },
            "administrator",
            "admin-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow(/current head coach is required/);
    });
  });
});
