import {
  buildPreClassView,
  preClassWindowDays,
  type PreClassAttendanceEntry,
  type PreClassStudent,
  type PreClassView,
} from "@bpt-jersey/domain/schedule/pre-class";
import type { AttendanceRecord, BookingRecord, SessionRecord } from "@bpt-jersey/domain/schedule";

/**
 * T114: the reads behind the pre-class view. Everything it shows is canonical - the session, its
 * bookings, its attendance and the attendance of comparable past sessions - and nothing is written.
 * The coach still records every check-in; the view only puts the likely names in front of them.
 */
export type PreClassErrorCode = "invalid" | "not-found" | "tenant" | "conflict";

export class PreClassError extends Error {
  public constructor(
    public readonly code: PreClassErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PreClassError";
  }
}

export type PreClassDocumentData = Readonly<Record<string, unknown>>;
export type PreClassSnapshot = Readonly<{
  docs: readonly Readonly<{ id: string; data: () => PreClassDocumentData | undefined }>[];
}>;
export type PreClassQuery = Readonly<{
  where: (field: string, operator: "==" | ">=" | "<", value: unknown) => PreClassQuery;
  limit: (count: number) => PreClassQuery;
  get: () => Promise<PreClassSnapshot>;
}>;
export type PreClassFirestore = Readonly<{
  doc: (path: string) => Readonly<{
    get: () => Promise<
      Readonly<{ exists: boolean; id: string; data: () => PreClassDocumentData | undefined }>
    >;
  }>;
  collection: (path: string) => PreClassQuery;
}>;

export type PreClassService = Readonly<{
  getPreClassView: (
    input: Readonly<{ academyId: string; sessionId: string; now?: string }>,
  ) => Promise<PreClassView>;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const dayMs = 86_400_000;
/** One page of each collection. Above it the view refuses rather than showing a partial class. */
const maxRecentSessions = 1_000;
const maxHistoryRecords = 5_000;
const maxActiveStudents = 2_000;

function fail(code: PreClassErrorCode, message: string): never {
  throw new PreClassError(code, message);
}

function segment(value: unknown, label: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    fail("invalid", `${label} is invalid`);
  }
  return value;
}

async function pageOf(
  query: PreClassQuery,
  limit: number,
  label: string,
): Promise<readonly Readonly<{ id: string; data: () => PreClassDocumentData | undefined }>[]> {
  const snapshot = await query.limit(limit + 1).get();
  if (snapshot.docs.length > limit) {
    fail("conflict", `${label} exceeds what one pre-class view may read`);
  }
  return snapshot.docs;
}

export function createPreClassService(options: {
  firestore: PreClassFirestore;
  now?: () => string;
}): PreClassService {
  return {
    async getPreClassView(input) {
      const academyId = segment(input.academyId, "academyId");
      const sessionId = segment(input.sessionId, "sessionId");
      const now = input.now ?? options.now?.() ?? new Date().toISOString();
      if (Number.isNaN(Date.parse(now))) fail("invalid", "Pre-class time is invalid");

      const sessionDoc = await options.firestore
        .doc(`academies/${academyId}/sessions/${sessionId}`)
        .get();
      const sessionValue = sessionDoc.exists ? sessionDoc.data() : undefined;
      if (sessionValue === undefined) fail("not-found", "Session is unavailable");
      if (sessionValue.academyId !== academyId || sessionValue.sessionId !== sessionId) {
        fail("tenant", "Session tenant binding is invalid");
      }
      const session = sessionValue as unknown as SessionRecord;

      const windowStart = new Date(Date.parse(now) - preClassWindowDays * dayMs).toISOString();
      const [bookingDocs, attendanceDocs, recentSessionDocs, studentDocs] = await Promise.all([
        pageOf(
          options.firestore
            .collection(`academies/${academyId}/bookings`)
            .where("sessionId", "==", sessionId),
          maxRecentSessions,
          "Bookings",
        ),
        pageOf(
          options.firestore
            .collection(`academies/${academyId}/attendance`)
            .where("sessionId", "==", sessionId),
          maxRecentSessions,
          "Attendance",
        ),
        pageOf(
          options.firestore
            .collection(`academies/${academyId}/sessions`)
            .where("programId", "==", session.programId)
            .where("startAt", ">=", windowStart),
          maxRecentSessions,
          "Recent sessions",
        ),
        pageOf(
          options.firestore
            .collection(`academies/${academyId}/students`)
            .where("active", "==", true),
          maxActiveStudents,
          "Students",
        ),
      ]);

      const recentSessions = recentSessionDocs
        .map((document) => document.data())
        .filter((value): value is PreClassDocumentData => value !== undefined)
        .filter((value) => value.academyId === academyId && typeof value.sessionId === "string")
        .map((value) => value as unknown as SessionRecord);

      // Attendance of the comparable window, read once per session of the programme.
      const historyDocs = await pageOf(
        options.firestore
          .collection(`academies/${academyId}/attendance`)
          .where("occurredAt", ">=", windowStart),
        maxHistoryRecords,
        "Attendance history",
      );
      const history: PreClassAttendanceEntry[] = historyDocs
        .map((document) => document.data())
        .filter((value): value is PreClassDocumentData => value !== undefined)
        .filter(
          (value) =>
            value.academyId === academyId &&
            typeof value.sessionId === "string" &&
            typeof value.studentId === "string" &&
            typeof value.state === "string" &&
            typeof value.occurredAt === "string",
        )
        .map((value) =>
          Object.freeze({
            sessionId: value.sessionId as string,
            studentId: value.studentId as string,
            state: value.state as string,
            occurredAt: value.occurredAt as string,
            correctionOf: typeof value.correctionOf === "string" ? value.correctionOf : null,
          }),
        );

      const students: PreClassStudent[] = studentDocs
        .map((document) => ({ id: document.id, value: document.data() }))
        .filter(
          (entry): entry is { id: string; value: PreClassDocumentData } =>
            entry.value !== undefined &&
            entry.value.academyId === academyId &&
            entry.value.studentId === entry.id &&
            typeof entry.value.fullName === "string",
        )
        .map((entry) =>
          Object.freeze({
            studentId: entry.id,
            fullName: entry.value.fullName as string,
            active: entry.value.active === true,
            status: typeof entry.value.status === "string" ? entry.value.status : "",
          }),
        );

      return buildPreClassView({
        session,
        bookings: bookingDocs
          .map((document) => document.data())
          .filter((value): value is PreClassDocumentData => value !== undefined)
          .filter((value) => value.academyId === academyId)
          .map((value) => value as unknown as BookingRecord),
        attendance: attendanceDocs
          .map((document) => document.data())
          .filter((value): value is PreClassDocumentData => value !== undefined)
          .filter((value) => value.academyId === academyId)
          .map((value) => value as unknown as AttendanceRecord),
        recentSessions,
        history,
        students,
        now,
      });
    },
  };
}
