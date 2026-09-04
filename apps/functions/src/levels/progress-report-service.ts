import {
  buildProgressReport,
  type EvaluationRecord,
  type ProgressReport,
  type ProgressReportStudent,
} from "@bpt-jersey/domain/levels";
import { parseStudentProfile } from "@bpt-jersey/domain/profiles";
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
const MAX_PROGRESS_REPORT_RECORDS = 400;

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
      const [catalog, studentsSnapshot, headsSnapshot, assessmentsSnapshot, attendanceSnapshot] =
        await Promise.all([
          params.levelStore.listPublished(academyId),
          params.firestore.collection(`academies/${academyId}/students`).get(),
          params.firestore.collection(`academies/${academyId}/studentLevelProgress`).get(),
          params.firestore.collection(`academies/${academyId}/assessments`).get(),
          params.firestore.collection(`academies/${academyId}/attendance`).get(),
        ]);
      for (const snapshot of [
        studentsSnapshot,
        headsSnapshot,
        assessmentsSnapshot,
        attendanceSnapshot,
      ]) {
        if (snapshot.docs.length > MAX_PROGRESS_REPORT_RECORDS) {
          throw new ProgressReportStoreError(
            "invalid",
            "Progress report input exceeds safe limits",
          );
        }
      }
      const heads = new Map(
        headsSnapshot.docs.map((document) => {
          const data = document.data();
          if (
            data.academyId !== academyId ||
            data.studentId !== document.id ||
            data.state !== "initialized" ||
            typeof data.currentDefinitionKey !== "string"
          ) {
            throw new ProgressReportStoreError("tenant", "Progress head tenant mismatch");
          }
          return [document.id, data] as const;
        }),
      );
      const studentProfiles = studentsSnapshot.docs.map((document) => {
        const parsed = parseStudentProfile(document.data());
        if (
          !parsed.ok ||
          parsed.value.studentId !== document.id ||
          parsed.value.academyId !== academyId
        ) {
          throw new ProgressReportStoreError("tenant", "Student tenant mismatch");
        }
        return parsed.value;
      });
      const allStudentIds = new Set(studentProfiles.map((student) => student.studentId));
      if ([...heads.keys()].some((studentId) => !allStudentIds.has(studentId))) {
        throw new ProgressReportStoreError("tenant", "Progress head student mismatch");
      }
      const students: ProgressReportStudent[] = studentProfiles
        .filter((student) => student.active && student.status === "active")
        .map((student) => {
          const head = heads.get(student.studentId);
          return {
            studentId: student.studentId,
            currentDefinitionKey:
              typeof head?.currentDefinitionKey === "string"
                ? head.currentDefinitionKey
                : undefined,
            currentLevelStartedAt:
              typeof head?.currentLevelStartedAt === "string" ? head.currentLevelStartedAt : null,
          };
        });

      const activeStudentIds = new Set(students.map((student) => student.studentId));
      const attendances = attendanceSnapshot.docs.flatMap((document) => {
        const data = document.data();
        if (
          data.academyId !== academyId ||
          data.attendanceId !== document.id ||
          typeof data.studentId !== "string" ||
          !allStudentIds.has(data.studentId) ||
          typeof data.occurredAt !== "string"
        ) {
          throw new ProgressReportStoreError("tenant", "Attendance tenant mismatch");
        }
        if (
          !activeStudentIds.has(data.studentId) ||
          data.correctionOf !== null ||
          (data.state !== "attended" && data.state !== "late")
        ) {
          return [];
        }
        return [{ studentId: data.studentId, attendedAt: data.occurredAt }];
      });
      const evaluations = assessmentsSnapshot.docs.flatMap((document) => {
        const data = document.data();
        if (
          data.academyId !== academyId ||
          data.assessmentId !== document.id ||
          typeof data.studentId !== "string" ||
          !allStudentIds.has(data.studentId)
        ) {
          throw new ProgressReportStoreError("tenant", "Assessment tenant mismatch");
        }
        return activeStudentIds.has(data.studentId) ? [data as unknown as EvaluationRecord] : [];
      });

      return buildProgressReport({
        catalog,
        students,
        evaluations,
        attendances,
      });
    },
  };
}
