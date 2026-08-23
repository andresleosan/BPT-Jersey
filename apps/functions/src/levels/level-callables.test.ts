import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { createInMemoryLevelStore } from "./level-service";
import { normalizeLevelCatalogSource } from "./level-source";
import {
  createListLevelCatalogHandler,
  createListStudentEvaluationsHandler,
  createRecordEvaluationHandler,
} from "./level-callables";

function fakeRequest(
  data: unknown,
  role = "owner",
  uid: string | null = "user-1",
  academyId = "demo-academy",
) {
  return {
    auth: uid ? { uid, token: { academyId, role } } : undefined,
    data,
  } as never;
}

describe("Level Callables", () => {
  const normalized = normalizeLevelCatalogSource(observedJson, businessCriteriaJson);

  function createTestStore() {
    const store = createInMemoryLevelStore();
    store.seed({ academyId: "demo-academy", normalized });
    return store;
  }

  it("allows authenticated owner to read the catalog", async () => {
    const store = createTestStore();
    const handler = createListLevelCatalogHandler({ store });

    const response = await handler(fakeRequest(null, "owner", "user-1", "demo-academy"));

    expect(response.system.systemId).toBe("ibjjf-v1");
    expect(response.definitions).toHaveLength(171);
    expect(response.skills).toHaveLength(11);
    expect(response.requirements).toHaveLength(165);
  });

  it("allows authenticated coach and guardian to read the catalog", async () => {
    const store = createTestStore();
    const handler = createListLevelCatalogHandler({ store });

    const coachResponse = await handler(fakeRequest(null, "coach", "coach-1", "demo-academy"));
    expect(coachResponse.definitions).toHaveLength(171);

    const guardianResponse = await handler(
      fakeRequest(null, "guardian", "guardian-1", "demo-academy"),
    );
    expect(guardianResponse.definitions).toHaveLength(171);
  });

  it("rejects unauthenticated requests", async () => {
    const store = createTestStore();
    const handler = createListLevelCatalogHandler({ store });

    await expect(handler(fakeRequest(null, "owner", null, "demo-academy"))).rejects.toThrow();
  });

  it("rejects non-null request payload", async () => {
    const store = createTestStore();
    const handler = createListLevelCatalogHandler({ store });

    await expect(
      handler(fakeRequest({ unexpected: "payload" }, "owner", "user-1", "demo-academy")),
    ).rejects.toThrow();
  });

  it("enforces tenant boundary (cannot read another academy)", async () => {
    const store = createTestStore();
    const handler = createListLevelCatalogHandler({ store });

    await expect(handler(fakeRequest(null, "owner", "user-2", "other-academy"))).rejects.toThrow();
  });

  describe("Record Evaluation Callable (T039)", () => {
    it("allows coach to record valid evaluation", async () => {
      const store = createTestStore();
      const recordHandler = createRecordEvaluationHandler({ store });

      const result = await recordHandler(
        fakeRequest(
          {
            studentId: "student-1",
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
      const recordHandler = createRecordEvaluationHandler({ store });

      await expect(
        recordHandler(
          fakeRequest(
            {
              studentId: "student-1",
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
      ).rejects.toThrow(/Staff role required to record evaluation/);
    });

    it("rejects invalid payload arguments", async () => {
      const store = createTestStore();
      const recordHandler = createRecordEvaluationHandler({ store });

      await expect(
        recordHandler(
          fakeRequest(
            {
              studentId: "student-1",
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
          definitionKey: "white-1",
          skillKey: "armbar-closed-guard",
          score: 5,
          evidenceNotes: "Perfect hip elevation and breaking mechanics.",
        },
        evaluatorId: "coach-1",
        evaluatorRole: "coach",
      });

      const listHandler = createListStudentEvaluationsHandler({ store });
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
          definitionKey: "white-1",
          skillKey: "armbar-closed-guard",
          score: 3,
          evidenceNotes: "Good attempt.",
        },
        evaluatorId: "coach-1",
        evaluatorRole: "coach",
      });

      const listHandler = createListStudentEvaluationsHandler({ store });

      // Can list own
      const ownResult = await listHandler(
        fakeRequest({ studentId: "adult-1" }, "adultStudent", "adult-1", "demo-academy"),
      );
      expect(ownResult.evaluations).toHaveLength(1);

      // Cannot list another student
      await expect(
        listHandler(
          fakeRequest({ studentId: "adult-2" }, "adultStudent", "adult-1", "demo-academy"),
        ),
      ).rejects.toThrow(/Access denied: student evaluation visibility restricted/);
    });
  });
});
