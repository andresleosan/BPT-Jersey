import {
  buildProgressReport,
  type ProgressReport,
  type ProgressReportStudent,
} from "@bpt-jersey/domain/levels";
import type { LevelCatalogStore, GenericFirestore } from "./level-service.js";

export class ProgressReportStoreError extends Error {
  public readonly code: "invalid" | "tenant" | "not-found";

  public constructor(code: "invalid" | "tenant" | "not-found", message: string) {
    super(message);
    this.name = "ProgressReportStoreError";
    this.code = code;
  }
}

export type ProgressReportStore = Readonly<{
  getProgressReport: (academyId: string) => Promise<ProgressReport>;
}>;

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function assertAcademyId(academyId: string): void {
  if (!safeIdentifierPattern.test(academyId)) {
    throw new ProgressReportStoreError("invalid", "Invalid academyId");
  }
}

export function createFirestoreProgressReportStore(params: {
  firestore: GenericFirestore;
  levelStore: LevelCatalogStore;
}): ProgressReportStore {
  return {
    async getProgressReport(academyId) {
      assertAcademyId(academyId);
      const [catalog, membersSnapshot, attendanceSnapshot] = await Promise.all([
        params.levelStore.listPublished(academyId),
        params.firestore.collection(`academies/${academyId}/members`).get(),
        params.firestore.collection(`academies/${academyId}/attendance`).get(),
      ]);

      const students: ProgressReportStudent[] = membersSnapshot.docs
        .filter((document) => {
          const data = document.data();
          return (
            document.id.match(safeIdentifierPattern) !== null &&
            data["membershipStatus"] === "active" &&
            (data["academyId"] === undefined || data["academyId"] === academyId)
          );
        })
        .map((document) => {
          const data = document.data();
          return {
            studentId: document.id,
            currentDefinitionKey:
              typeof data["currentLevel"] === "string" ? data["currentLevel"] : undefined,
            currentLevelStartedAt:
              typeof data["currentLevelStartedAt"] === "string"
                ? data["currentLevelStartedAt"]
                : null,
          };
        });

      const activeStudentIds = new Set(students.map((student) => student.studentId));
      const attendances = attendanceSnapshot.docs
        .map((document) => document.data())
        .filter(
          (data) =>
            (data["status"] === "attended" || data["status"] === "late") &&
            typeof data["studentId"] === "string" &&
            activeStudentIds.has(data["studentId"] as string),
        )
        .map((data) => ({
          studentId: data["studentId"] as string,
          attendedAt: String(data["attendedAt"] ?? data["sessionDate"] ?? ""),
        }));

      const evaluationGroups = await Promise.all(
        students.map((student) =>
          params.levelStore.listStudentEvaluations(academyId, student.studentId),
        ),
      );
      const evaluations = evaluationGroups.flat();

      return buildProgressReport({
        catalog,
        students,
        evaluations,
        attendances,
      });
    },
  };
}
