import {
  buildProgressReport,
  type EvaluationRecord,
  type ProgressReport,
  type ProgressReportStudent,
} from "@bpt-jersey/domain/levels";
import { parseStudentProfile } from "@bpt-jersey/domain/profiles";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import type { Firestore } from "firebase-admin/firestore";
import {
  storedDaysOffset,
  storedImportedBaseline,
  storedTrainingRange,
  type LevelCatalogStore,
  type GenericFirestore,
} from "./level-service.js";
import { openMatSessionIds, readProgressAdjustments } from "./progress-adjustments.js";

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
      const [
        catalog,
        studentsSnapshot,
        headsSnapshot,
        assessmentsSnapshot,
        attendanceSnapshot,
        accessSnapshot,
      ] = await Promise.all([
        params.levelStore.listPublished(academyId),
        params.firestore.collection(`academies/${academyId}/students`).get(),
        params.firestore.collection(`academies/${academyId}/studentLevelProgress`).get(),
        params.firestore.collection(`academies/${academyId}/assessments`).get(),
        params.firestore.collection(`academies/${academyId}/attendance`).get(),
        // ponytail: GenericFirestore has no getAll; one query reads only the members with a grant.
        params.firestore.collection(`academies/${academyId}/studentGroupAccess`).get(),
      ]);
      const today = dateKeyInJersey(new Date());
      const trainingRanges = new Map(
        accessSnapshot.docs.map((document) => [
          document.id,
          storedTrainingRange(document.data(), academyId, today),
        ]),
      );
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
            importedBaseline: storedImportedBaseline(head?.importedBaseline),
            daysOffset: storedDaysOffset(head?.daysOffset),
            // T113: the age band of the target rank is applied against it; it is never reported.
            dateOfBirth: student.dateOfBirth,
            trainingRange: trainingRanges.get(student.studentId) ?? null,
          };
        });

      const activeStudentIds = new Set(students.map((student) => student.studentId));
      const rawAttendances = attendanceSnapshot.docs.flatMap((document) => {
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
          typeof data.courseId === "string" ||
          !activeStudentIds.has(data.studentId) ||
          data.correctionOf !== null ||
          (data.state !== "attended" && data.state !== "late")
        ) {
          return [];
        }
        return [
          {
            studentId: data.studentId,
            attendedAt: data.occurredAt,
            attendanceId: document.id,
            sessionId: String(data.sessionId),
          },
        ];
      });
      const firestore = params.firestore as unknown as Firestore;
      const [adjustments, openMat] = await Promise.all([
        readProgressAdjustments(firestore, academyId, { sinceDate: null }),
        openMatSessionIds(
          firestore,
          academyId,
          rawAttendances.map((record) => record.sessionId),
        ),
      ]);
      // Spec §A: the same rule as countedClassInstants, for every student at once.
      const attendances = [
        ...rawAttendances
          .filter(
            (record) =>
              !adjustments.voidedAttendanceIds.has(record.attendanceId) &&
              !openMat.has(record.sessionId),
          )
          .map(({ studentId, attendedAt }) => ({ studentId, attendedAt })),
        ...[...adjustments.manualByStudent]
          .filter(([studentId]) => activeStudentIds.has(studentId))
          .flatMap(([studentId, instants]) =>
            instants.map((attendedAt) => ({ studentId, attendedAt })),
          ),
      ];
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
