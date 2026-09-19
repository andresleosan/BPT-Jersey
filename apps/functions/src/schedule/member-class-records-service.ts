import { z } from "zod";
import { HttpsError } from "firebase-functions/v2/https";
import { parseStudentProfile } from "@bpt-jersey/domain/profiles";
import { attendanceStates, bookingStatuses, checkInMethods } from "@bpt-jersey/domain/schedule";
import {
  memberClassPageSchema,
  memberClassQuerySchema,
  memberClassSessionSchema,
  projectMemberAttendance,
  projectMemberBooking,
  type MemberClassPage,
  type MemberClassQuery,
} from "@bpt-jersey/domain/schedule/member-class-records";
import { selectAdminDirectoryReader } from "../members/member-directory-state.js";

export type ClassDocument = Readonly<{ id: string; data: unknown }>;
export type MemberClassReader = {
  getState(): Promise<unknown>;
  getStudent(studentId: string): Promise<unknown>;
  getRecord(kind: MemberClassQuery["kind"], recordId: string): Promise<ClassDocument>;
  queryRecords(input: MemberClassQuery, limit: 26): Promise<readonly ClassDocument[]>;
  getSessions(ids: readonly string[]): Promise<readonly ClassDocument[]>;
};
export type MemberClassStore = {
  read<T>(academyId: string, work: (reader: MemberClassReader) => Promise<T>): Promise<T>;
};
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const scopeSchema = z.object({
  academyId: id,
  studentId: id,
  sessionId: id,
  source: z.literal("legacy-import").optional(),
});
const bookingSchema = scopeSchema.extend({
  bookingId: z.string(),
  requestedAt: z.iso.datetime(),
  status: z.enum(bookingStatuses),
});
const attendanceSchema = scopeSchema.extend({
  attendanceId: z.string(),
  occurredAt: z.iso.datetime(),
  correctionOf: z.null(),
  state: z.enum(attendanceStates),
  method: z.enum(checkInMethods),
});
function fail(): never {
  throw new HttpsError(
    "failed-precondition",
    "Class history is unavailable. Refresh to try again.",
  );
}
function scope(document: ClassDocument, academyId: string, input: MemberClassQuery) {
  const raw = z.record(z.string(), z.unknown()).safeParse(document.data);
  if (!raw.success) return fail();
  const data = raw.data;
  const at = input.kind === "bookings" ? data.requestedAt : data.occurredAt;
  if (
    data.academyId !== academyId ||
    data.studentId !== input.studentId ||
    (input.kind === "bookings" ? data.bookingId : data.attendanceId) !== document.id ||
    !z.iso.datetime().safeParse(at).success ||
    (input.kind === "attendance" && data.correctionOf !== null)
  )
    return fail();
  if (data.source !== undefined && data.source !== "legacy-import") return fail();
  return { data, at: at as string };
}
export async function listMemberClassRecordsPage(
  store: MemberClassStore,
  actor: { academyId: string; role: string },
  raw: MemberClassQuery,
): Promise<MemberClassPage> {
  if (actor.role !== "owner" && actor.role !== "administrator")
    throw new HttpsError("permission-denied", "Office access is required.");
  const parsed = memberClassQuerySchema.safeParse(raw);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid class history query.");
  const input = parsed.data;
  return store.read(actor.academyId, async (reader) => {
    const [state, studentData] = await Promise.all([
      reader.getState(),
      reader.getStudent(input.studentId),
    ]);
    try {
      if (
        selectAdminDirectoryReader(state) !== "canonical" ||
        (state as { academyId: string }).academyId !== actor.academyId
      )
        fail();
    } catch {
      fail();
    }
    const student = parseStudentProfile(studentData);
    if (
      !student.ok ||
      student.value.studentId !== input.studentId ||
      student.value.academyId !== actor.academyId
    )
      throw new HttpsError("not-found", "Member record unavailable.");
    if (input.cursor) {
      try {
        const cursor = scope(
          await reader.getRecord(input.kind, input.cursor.recordId),
          actor.academyId,
          input,
        );
        if (cursor.at !== input.cursor.at) fail();
      } catch {
        throw new HttpsError("aborted", "History changed; refresh.");
      }
    }
    const documents = await reader.queryRecords(input, 26);
    if (documents.length > 26) fail();
    const scanned = documents
      .slice(0, 25)
      .map((doc) => ({ doc, ...scope(doc, actor.academyId, input) }));
    const live = scanned.filter((row) => row.data.source !== "legacy-import");
    const records = live.map(({ data }) => {
      const parsed =
        input.kind === "bookings"
          ? bookingSchema.safeParse(data)
          : attendanceSchema.safeParse(data);
      if (!parsed.success) return fail();
      return parsed.data;
    });
    const sessionIds = [...new Set(records.map((record) => record.sessionId))];
    const sessions = new Map(
      (await reader.getSessions(sessionIds)).map((doc) => {
        const parsed = memberClassSessionSchema
          .extend({ academyId: id })
          .strip()
          .safeParse(doc.data);
        if (
          !parsed.success ||
          parsed.data.academyId !== actor.academyId ||
          parsed.data.sessionId !== doc.id
        )
          return [doc.id, null] as const;
        const { academyId: _academyId, ...session } = parsed.data;
        return [doc.id, session] as const;
      }),
    );
    const last = scanned.at(-1);
    const rows = records.map((record) =>
      "bookingId" in record
        ? projectMemberBooking(record, sessions.get(record.sessionId) ?? null)
        : projectMemberAttendance(record, sessions.get(record.sessionId) ?? null),
    );
    return memberClassPageSchema.parse({
      studentId: input.studentId,
      kind: input.kind,
      rows,
      nextCursor: documents.length > 25 && last ? { at: last.at, recordId: last.doc.id } : null,
    });
  });
}
