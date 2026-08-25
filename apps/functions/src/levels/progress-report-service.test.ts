import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { normalizeLevelCatalogSource } from "./level-source";
import {
  createFirestoreProgressReportStore,
  type ProgressReportStore,
} from "./progress-report-service";
import type { GenericFirestore, LevelCatalogStore } from "./level-service";

const catalog = normalizeLevelCatalogSource(observedJson, businessCriteriaJson);

describe("Firestore progress report store", () => {
  it("counts only active members from the requested academy", async () => {
    const levelStore = {
      listPublished: async () => catalog,
      listStudentEvaluations: async () => [],
    } as unknown as LevelCatalogStore;
    const firestore = {
      collection(path: string) {
        if (path.endsWith("/members")) {
          return {
            get: async () => ({
              docs: [
                {
                  id: "student-1",
                  data: () => ({ academyId: "academy-1", membershipStatus: "active" }),
                  ref: { delete: async () => undefined },
                },
                {
                  id: "inactive-1",
                  data: () => ({ academyId: "academy-1", membershipStatus: "inactive" }),
                  ref: { delete: async () => undefined },
                },
                {
                  id: "cross-1",
                  data: () => ({ academyId: "academy-2", membershipStatus: "active" }),
                  ref: { delete: async () => undefined },
                },
              ],
            }),
          };
        }
        return {
          get: async () => ({
            docs: [
              {
                id: "attendance-1",
                data: () => ({ studentId: "student-1", status: "attended" }),
                ref: { delete: async () => undefined },
              },
              {
                id: "attendance-cross",
                data: () => ({ studentId: "cross-1", status: "attended" }),
                ref: { delete: async () => undefined },
              },
            ],
          }),
        };
      },
    };

    const store: ProgressReportStore = createFirestoreProgressReportStore({
      firestore: firestore as unknown as GenericFirestore,
      levelStore,
    });
    const report = await store.getProgressReport("academy-1");

    expect(report.activeStudentCount).toBe(1);
    expect(report.totalEvaluationCount).toBe(0);
    expect(report.assessmentCoveragePercentage).toBe(0);
    expect(JSON.stringify(report)).not.toContain("cross-1");
  });
});
