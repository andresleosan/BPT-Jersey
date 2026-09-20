import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import type { Course, CourseEnrolment } from "@bpt-jersey/domain/courses";
import { canAccessCourseSession } from "@bpt-jersey/domain/courses";
import { buildBookingId, buildBookingIdCandidates, type AttendanceRecord, type CourseBookingRecord, type SessionRecord } from "@bpt-jersey/domain/schedule";
import { resolveCourseParticipant } from "./course-participants.js";
import { courseCollection, courseData, courseFailure, type CourseActor } from "./course-store.js";
/** Each response scans at most 30 sessions of one approved enrolment. */
export async function getCourseCalendarPage(db: Firestore, actor: CourseActor, input: {studentId: string; from: string; to: string; cursor?: string | undefined}) {
  await resolveCourseParticipant(db, actor, {kind: "student", studentId: input.studentId});
  if (Date.parse(input.to) <= Date.parse(input.from) || Date.parse(input.to) - Date.parse(input.from) > 15 * 86400000) courseFailure("invalid", "Choose a calendar range of at most 15 days.");
  let cursor: {e: string; s?: string | undefined} | null = null;
  if (input.cursor) {try {cursor = z.strictObject({e:z.uuid(),s:z.string().regex(/^[A-Za-z0-9_:-]+$/u).optional()}).parse(JSON.parse(Buffer.from(input.cursor,"base64url").toString("utf8")));} catch {courseFailure("invalid", "Refresh the course calendar.");}}
  const enrolments = courseCollection(db, actor.academyId, "courseEnrolments");
  let enrolment: CourseEnrolment | null = null;
  if (cursor?.s) {const snapshot = await enrolments.doc(cursor.e).get(); if (snapshot.exists) enrolment = snapshot.data() as CourseEnrolment;}
  else {
    let query = enrolments.where("studentId", "==", input.studentId).where("status", "in", ["approved", "withdrawal_requested", "cancelled"]).orderBy(FieldPath.documentId());
    if (cursor) query = query.startAfter(cursor.e);
    const page = await query.limit(1).get(); enrolment = page.docs[0]?.data() as CourseEnrolment ?? null;
  }
  const empty = {sessions: [] as SessionRecord[], bookings: [] as CourseBookingRecord[], attendance: [] as AttendanceRecord[], cursor: null as string | null};
  if (!enrolment) return empty;
  const nextEnrolment = Buffer.from(JSON.stringify({e:enrolment.enrolmentId})).toString("base64url");
  if (enrolment.studentId !== input.studentId || !["approved", "withdrawal_requested", "cancelled"].includes(enrolment.status)) courseFailure("forbidden", "This course enrolment is unavailable.");
  const course = courseData<Course>(await courseCollection(db, actor.academyId, "courses").doc(enrolment.courseId).get());
  if (!enrolment.approvedAt || !["published", "completed", "cancelled"].includes(course.status)) return {...empty, cursor:nextEnrolment};
  let query = courseCollection(db, actor.academyId, "sessions").where("courseId", "==", enrolment.courseId).where("startAt", ">=", input.from).where("startAt", "<", input.to).orderBy("startAt").orderBy(FieldPath.documentId());
  if (cursor?.s) {const anchor = await courseCollection(db, actor.academyId, "sessions").doc(cursor.s).get(); if (!anchor.exists || anchor.data()?.courseId !== enrolment.courseId) courseFailure("invalid", "Refresh the course calendar."); query = query.startAfter(anchor);}
  const page = await query.limit(31).get(); const scanned = page.docs.slice(0,30);
  const now = new Date().toISOString();
  const closedAt = [enrolment.accessUntil ?? (enrolment.status === "cancelled" ? enrolment.updatedAt : null), course.accessClosedAt ?? (course.status === "cancelled" ? course.updatedAt : null)].filter((v): v is string => !!v).sort()[0];
  const sessions = scanned.map(s => s.data() as SessionRecord).filter(s => s.coursePublicationRevision === course.publicationRevision && (closedAt
    ? !!enrolment!.accessFrom && s.startAt >= enrolment!.accessFrom && s.startAt < closedAt && s.startAt < now && s.status !== "cancelled"
    : canAccessCourseSession(enrolment!, s)));
  const bookings: CourseBookingRecord[] = []; const attendance: AttendanceRecord[] = [];
  for (const session of sessions) {
    const [stored, records] = await Promise.all([db.getAll(...buildBookingIdCandidates(session.sessionId,input.studentId).map(id=>courseCollection(db,actor.academyId,"bookings").doc(id))), courseCollection(db,actor.academyId,"attendance").where("sessionId","==",session.sessionId).where("studentId","==",input.studentId).limit(2).get()]);
    const booking = stored.find(s=>s.exists)?.data() as CourseBookingRecord | undefined;
    if (booking && (booking.schemaVersion !== "2" || booking.source?.kind !== "course" || booking.source.courseId !== course.courseId || booking.studentId !== input.studentId || booking.sessionId !== session.sessionId || booking.academyId !== actor.academyId)) courseFailure("conflict","A course booking needs office review.");
    const replacing = !!booking && booking.source.enrolmentId !== enrolment.enrolmentId;
    if (replacing) {
      const previous = courseData<CourseEnrolment>(await enrolments.doc(booking.source.enrolmentId).get());
      if (previous.courseId !== course.courseId || previous.studentId !== input.studentId || !["cancelled", "rejected", "expired"].includes(previous.status) || !enrolment.accessFrom || session.startAt < enrolment.accessFrom)
        courseFailure("conflict", "A course booking needs office review.");
    }
    const at=enrolment.approvedAt!;
    bookings.push(!replacing && booking?.status === "confirmed" ? booking : {bookingId:buildBookingId(session.sessionId,input.studentId),academyId:actor.academyId,sessionId:session.sessionId,studentId:input.studentId,membershipId:null,schemaVersion:"2",source:{kind:"course",courseId:course.courseId,enrolmentId:enrolment.enrolmentId},absent:!replacing && (booking?.absent??false),status:"confirmed",requestedAt:at,createdAt:at,createdBy:"course-access",updatedAt:at,updatedBy:"course-access",cancelledAt:null,cancellationReason:null});
    for (const a of records.docs) attendance.push(a.data() as AttendanceRecord);
  }
  return {sessions,bookings,attendance,cursor:page.size>30?Buffer.from(JSON.stringify({e:enrolment.enrolmentId,s:scanned[29]!.id})).toString("base64url"):nextEnrolment};
}
