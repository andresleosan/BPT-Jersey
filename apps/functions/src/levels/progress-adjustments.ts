import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { manualAttendanceInstant } from "@bpt-jersey/domain/levels";
import { isOpenMatProgram } from "@bpt-jersey/domain/schedule/self-check-in";

/** ponytail: getAll in chunks of 300; no documented cap, this keeps one call bounded. */
export async function readDocuments(
  db: Firestore,
  paths: readonly string[],
): Promise<DocumentSnapshot[]> {
  const out: DocumentSnapshot[] = [];
  for (let index = 0; index < paths.length; index += 300) {
    const refs = paths.slice(index, index + 300).map((path) => db.doc(path));
    if (refs.length > 0) out.push(...(await db.getAll(...refs)));
  }
  return out;
}

/**
 * D3/D14: sessions whose program is an Open Mat, resolved on read (attendance → session → program).
 * A session or program that cannot be read is NOT in the set: it counts as a class (fail open).
 */
export async function openMatSessionIds(
  db: Firestore,
  academyId: string,
  sessionIds: Iterable<string>,
): Promise<Set<string>> {
  const base = `academies/${academyId}`;
  const sessions = await readDocuments(
    db,
    [...new Set(sessionIds)].map((id) => `${base}/sessions/${id}`),
  );
  const programBySession = new Map<string, string>();
  for (const session of sessions) {
    const programId = session.get("programId");
    if (session.exists && typeof programId === "string")
      programBySession.set(session.id, programId);
  }
  const programs = await readDocuments(
    db,
    [...new Set(programBySession.values())].map((id) => `${base}/programs/${id}`),
  );
  const openMat = new Set(
    programs
      .filter((program) => program.exists && isOpenMatProgram(program.data() as never))
      .map((program) => program.id),
  );
  return new Set(
    [...programBySession].filter(([, programId]) => openMat.has(programId)).map(([id]) => id),
  );
}

export type ProgressAdjustments = {
  /** Attendance ids the owner removed (D6); the attendance doc itself is never touched. */
  voidedAttendanceIds: Set<string>;
  /** Canonical studentId → owner-added class instants (§C), voided ones left out. */
  manualByStudent: Map<string, string[]>;
};

/** One member (`studentId`) or the whole academy from `sinceDate` (null = all time). */
export async function readProgressAdjustments(
  db: Firestore,
  academyId: string,
  scope: { studentId: string } | { sinceDate: string | null },
): Promise<ProgressAdjustments> {
  const base = `academies/${academyId}`;
  const voids = db.collection(`${base}/attendanceVoids`);
  const manual = db.collection(`${base}/memberManualAttendance`);
  const [voidSnapshot, manualSnapshot] = await Promise.all([
    ("studentId" in scope ? voids.where("studentId", "==", scope.studentId) : voids).get(),
    ("studentId" in scope
      ? manual.where("studentId", "==", scope.studentId)
      : scope.sinceDate === null
        ? manual
        : manual.where("date", ">=", scope.sinceDate)
    ).get(),
  ]);
  const voidedAttendanceIds = new Set(
    voidSnapshot.docs
      .filter(
        (document) => document.get("academyId") === academyId && document.get("voided") === true,
      )
      .map((document) => document.id),
  );
  const manualByStudent = new Map<string, string[]>();
  for (const document of manualSnapshot.docs) {
    const value = document.data();
    if (
      value.academyId !== academyId ||
      typeof value.studentId !== "string" ||
      typeof value.date !== "string" ||
      (value.progressVoid !== null && value.progressVoid !== undefined)
    )
      continue;
    manualByStudent.set(value.studentId, [
      ...(manualByStudent.get(value.studentId) ?? []),
      manualAttendanceInstant(value.date),
    ]);
  }
  return { voidedAttendanceIds, manualByStudent };
}

export type CountedClass = { occurredAt: string; sessionId: string | null };

/**
 * Spec §A — THE counting rule for one member: `countedAttendance` output minus owner voids and
 * Open Mat sessions, plus owner-added dates. Oldest first. Every per-member progress reader uses it.
 */
export async function countedClassInstants(
  db: Firestore,
  academyId: string,
  studentId: string,
  records: readonly Record<string, unknown>[],
): Promise<CountedClass[]> {
  const [adjustments, openMat] = await Promise.all([
    readProgressAdjustments(db, academyId, { studentId }),
    openMatSessionIds(
      db,
      academyId,
      records.map((record) => String(record.sessionId)),
    ),
  ]);
  const real = records
    .filter(
      (record) =>
        !adjustments.voidedAttendanceIds.has(String(record.attendanceId)) &&
        !openMat.has(String(record.sessionId)),
    )
    .map((record) => ({
      occurredAt: String(record.occurredAt),
      sessionId: String(record.sessionId),
    }));
  const manual = (adjustments.manualByStudent.get(studentId) ?? []).map((occurredAt) => ({
    occurredAt,
    sessionId: null,
  }));
  return [...real, ...manual].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}
