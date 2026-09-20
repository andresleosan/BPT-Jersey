import { z } from "zod";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { buildBookingId, buildBookingIdCandidates, type CourseBookingRecord, type SessionRecord } from "@bpt-jersey/domain/schedule";
import { canAccessCourseSession, courseIdSchema, courseRecordIdSchema, type Course, type CourseEnrolment } from "@bpt-jersey/domain/courses";
import { assertCourseActorLive, courseCollection, courseData, courseFailure, courseOperation, operationResult, saveOperation, type CourseActor } from "./course-store.js";
import { resolveCourseParticipantInTransaction } from "./course-participants.js";

export async function authorizeCourseSessionActor(db: Firestore, tx: Transaction, actor: CourseActor, course: Course, studentId: string): Promise<void> {
  if (actor.role === "owner" || actor.role === "administrator") return;
  if ((actor.role === "coach" || actor.role === "headCoach") && course.instructor.kind === "staff") {
    const staff = (await tx.get(courseCollection(db, actor.academyId, "staff").doc(course.instructor.staffId))).data();
    if (staff?.userId === actor.uid && staff.active === true && staff.status === "active") return;
  }
  await resolveCourseParticipantInTransaction(db, tx, actor, {kind: "student", studentId});
}

export async function prepareCourseBooking(db: Firestore, tx: Transaction, academyId: string, sessionId: string, studentId: string, actor?: CourseActor): Promise<{booking: CourseBookingRecord; write: () => void}> {
  const session = courseData<SessionRecord>(await tx.get(courseCollection(db, academyId, "sessions").doc(sessionId)));
  if (!session.courseId) courseFailure("invalid", "Choose a course session.");
  const course = courseData<Course>(await tx.get(courseCollection(db, academyId, "courses").doc(session.courseId)));
  if (!["published", "completed"].includes(course.status) || session.academyId !== academyId || session.coursePublicationRevision !== course.publicationRevision) courseFailure("forbidden", "This course session is not available.");
  if (actor) await authorizeCourseSessionActor(db, tx, actor, course, studentId);
  const student = (await tx.get(courseCollection(db, academyId, "students").doc(studentId))).data();
  if (!student || student.academyId !== academyId || student.active !== true || student.status !== "active") courseFailure("forbidden", "The participant is not active.");
  const enrolments = await tx.get(courseCollection(db, academyId, "courseEnrolments").where("courseId", "==", course.courseId).where("studentId", "==", studentId).where("status", "in", ["approved", "withdrawal_requested"]).limit(2));
  if (enrolments.size !== 1) courseFailure("forbidden", "An approved course enrolment is required.");
  const enrolment = enrolments.docs[0]!.data() as CourseEnrolment;
  if (!canAccessCourseSession(enrolment, session)) courseFailure("forbidden", "This session is not included in the enrolment.");
  const refs = buildBookingIdCandidates(sessionId, studentId).map(id => courseCollection(db, academyId, "bookings").doc(id));
  const existing = (await tx.getAll(...refs)).filter(snapshot => snapshot.exists);
  if (existing.length > 1) courseFailure("conflict", "Booking identity requires office review.");
  const old = existing[0]?.data();
  if (old && (old.schemaVersion !== "2" || old.membershipId !== null || old.source?.kind !== "course" || old.source?.courseId !== course.courseId || old.studentId !== studentId || old.sessionId !== sessionId || old.academyId !== academyId)) courseFailure("conflict", "The existing booking belongs to a different enrolment.");
  const replacing = !!old && old.source.enrolmentId !== enrolment.enrolmentId;
  const now = new Date().toISOString();
  if (replacing) {
    // The approval instant defines the included dates even when projection runs after class starts.
    const previous = courseData<CourseEnrolment>(await tx.get(courseCollection(db, academyId, "courseEnrolments").doc(old.source.enrolmentId)));
    if (previous.courseId !== course.courseId || previous.studentId !== studentId || !["cancelled", "rejected", "expired"].includes(previous.status) || !enrolment.accessFrom || session.startAt < enrolment.accessFrom)
      courseFailure("conflict", "The previous booking cannot be replaced.");
  }
  const booking: CourseBookingRecord = {bookingId: existing[0]?.id ?? buildBookingId(sessionId, studentId), academyId, sessionId, studentId, membershipId: null, schemaVersion: "2", source: {kind: "course", courseId: course.courseId, enrolmentId: enrolment.enrolmentId}, absent: !replacing && old?.absent === true, status: "confirmed", requestedAt: old?.requestedAt ?? enrolment.approvedAt ?? now, cancelledAt: null, cancellationReason: null, createdAt: old?.createdAt ?? now, createdBy: old?.createdBy ?? actor?.uid ?? "course-projection", updatedAt: now, updatedBy: actor?.uid ?? "course-projection"};
  return {booking, write: () => {if (!old || replacing || old.status !== "confirmed") tx.set(courseCollection(db, academyId, "bookings").doc(booking.bookingId), booking);}};
}
export async function ensureCourseBooking(db: Firestore, actor: CourseActor, sessionId: string, studentId: string): Promise<CourseBookingRecord> {
  courseRecordIdSchema.parse(sessionId); courseRecordIdSchema.parse(studentId);
  return db.runTransaction(async tx => {
    await assertCourseActorLive(db, tx, actor);
    const prepared = await prepareCourseBooking(db, tx, actor.academyId, sessionId, studentId, actor);
    prepared.write(); return prepared.booking;
  });
}
export async function setCourseAbsence(db: Firestore, actor: CourseActor, value: {requestId: string; sessionId: string; studentId: string; absent: boolean}): Promise<CourseBookingRecord> {
  const input = z.strictObject({requestId: courseIdSchema, sessionId: courseRecordIdSchema, studentId: courseRecordIdSchema, absent: z.boolean()}).parse(value);
  return db.runTransaction(async tx => {
    await assertCourseActorLive(db, tx, actor);
    await resolveCourseParticipantInTransaction(db, tx, actor, {kind: "student", studentId: input.studentId});
    const receipt = await tx.get(courseOperation(db, actor, "absence", input.requestId));
    const replay = operationResult<CourseBookingRecord>(receipt, input); if (replay) return replay;
    const prepared = await prepareCourseBooking(db, tx, actor.academyId, input.sessionId, input.studentId, actor);
    const session = (await tx.get(courseCollection(db, actor.academyId, "sessions").doc(input.sessionId))).data();
    if (!session || session.startAt <= new Date().toISOString()) courseFailure("conflict", "Contact your coach about a session that has already started.");
    const booking = {...prepared.booking, absent: input.absent, updatedBy: actor.uid};
    tx.set(courseCollection(db, actor.academyId, "bookings").doc(booking.bookingId), booking);
    saveOperation(tx, db, actor, "absence", input.requestId, input, booking);
    return booking;
  });
}
