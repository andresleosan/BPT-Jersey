import { z } from "zod";
import {
  attendanceStates,
  bookingStatuses,
  checkInMethods,
  type AttendanceRecord,
  type BookingRecord,
  type SessionRecord,
} from "./schedule-contracts";

const studentId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
// Booking IDs encode both identifiers and can exceed the individual 128-character limit.
const recordId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u);
const instant = z.iso.datetime();
export const memberClassCursorSchema = z.strictObject({ at: instant, recordId });
export const memberClassQuerySchema = z.strictObject({
  studentId,
  kind: z.enum(["bookings", "attendance"]),
  cursor: memberClassCursorSchema.optional(),
});
export const memberClassSessionSchema = z.strictObject({
  sessionId: studentId,
  title: z.string().min(1).max(200),
  startAt: instant,
  endAt: instant,
  locationId: z.string().min(1).max(128),
});
const bookingRowSchema = z.strictObject({
  recordId,
  session: memberClassSessionSchema.nullable(),
  requestedAt: instant,
  status: z.enum(bookingStatuses),
});
const attendanceRowSchema = z.strictObject({
  recordId,
  session: memberClassSessionSchema.nullable(),
  occurredAt: instant,
  state: z.enum(attendanceStates),
  method: z.enum(checkInMethods),
});
export const memberClassPageSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    studentId,
    kind: z.literal("bookings"),
    rows: z.array(bookingRowSchema).max(25),
    nextCursor: memberClassCursorSchema.nullable(),
  }),
  z.strictObject({
    studentId,
    kind: z.literal("attendance"),
    rows: z.array(attendanceRowSchema).max(25),
    nextCursor: memberClassCursorSchema.nullable(),
  }),
]);
export type MemberClassQuery = z.infer<typeof memberClassQuerySchema>;
export type MemberClassPage = z.infer<typeof memberClassPageSchema>;
export type MemberClassSession = z.infer<typeof memberClassSessionSchema>;
export type MemberClassCursor = z.infer<typeof memberClassCursorSchema>;

export function projectMemberSession(
  session: Pick<SessionRecord, "sessionId" | "title" | "startAt" | "endAt" | "locationId">,
): MemberClassSession {
  const { sessionId, title, startAt, endAt, locationId } = session;
  return memberClassSessionSchema.parse({ sessionId, title, startAt, endAt, locationId });
}
export function projectMemberBooking(
  record: Pick<BookingRecord, "bookingId" | "requestedAt" | "status">,
  session: MemberClassSession | null,
) {
  return bookingRowSchema.parse({
    recordId: record.bookingId,
    session,
    requestedAt: record.requestedAt,
    status: record.status,
  });
}
export function projectMemberAttendance(
  record: Pick<AttendanceRecord, "attendanceId" | "occurredAt" | "state" | "method">,
  session: MemberClassSession | null,
) {
  return attendanceRowSchema.parse({
    recordId: record.attendanceId,
    session,
    occurredAt: record.occurredAt,
    state: record.state,
    method: record.method,
  });
}
