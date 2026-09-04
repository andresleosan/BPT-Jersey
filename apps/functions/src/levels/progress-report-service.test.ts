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
  it("counts only active canonical students and never reads members", async () => {
    const levelStore = {
      listPublished: async () => catalog,
      listStudentEvaluations: async () => [],
    } as unknown as LevelCatalogStore;
    const paths: string[] = [];
    const profile = (studentId: string, active: boolean) => ({
      studentId,
      academyId: "academy-1",
      fullName: `Synthetic ${studentId}`,
      dateOfBirth: "1990-01-01",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      participantType: "adult",
      active,
      status: active ? "active" : "inactive",
      schemaVersion: "1",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "owner-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "owner-1",
    });
    const firestore = {
      collection(path: string) {
        paths.push(path);
        if (path.endsWith("/students")) {
          return {
            get: async () => ({
              docs: [
                {
                  id: "student-1",
                  data: () => profile("student-1", true),
                  ref: { delete: async () => undefined },
                },
                {
                  id: "inactive-1",
                  data: () => profile("inactive-1", false),
                  ref: { delete: async () => undefined },
                },
              ],
            }),
          };
        }
        if (path.endsWith("/studentLevelProgress")) {
          return {
            get: async () => ({ docs: [] }),
          };
        }
        if (path.endsWith("/assessments")) {
          return { get: async () => ({ docs: [] }) };
        }
        return {
          get: async () => ({
            docs: [
              {
                id: "attendance-1",
                data: () => ({
                  attendanceId: "attendance-1",
                  academyId: "academy-1",
                  studentId: "student-1",
                  state: "attended",
                  correctionOf: null,
                  occurredAt: "2026-08-20T12:00:00.000Z",
                }),
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
    expect(paths.some((path) => path.includes("/members"))).toBe(false);
  });
});
