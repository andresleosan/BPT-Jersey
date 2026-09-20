import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { parsePaymentInstructionsRecord } from "@bpt-jersey/domain/finance";
import { reserveCourseSchema, courseMutationSchema, isCourseAgeEligible, type Course, type CourseEnrolment, type CourseMutation, type ReserveCourseInput } from "@bpt-jersey/domain/courses";
import { requireCourseApplicant } from "./course-authorization.js";
import { resolveCourseParticipantInTransaction } from "./course-participants.js";
import { advanceCourseCapacity, courseLocalDate, nextCourseSession, writeCourseSeats } from "./course-capacity.js";
import { readCourseRateLimit } from "./course-rate-limits.js";
import { assertCourseActorLive, assertCourseRevision, courseCollection, courseData, courseFailure, courseHash, courseOperation, operationResult, saveOperation, type CourseActor } from "./course-store.js";

const closed = new Set(["expired", "rejected", "cancelled"]);
async function createCourseEnrolment(db: Firestore, actor: CourseActor, value: ReserveCourseInput, waitlist: boolean): Promise<CourseEnrolment> {
  requireCourseApplicant(actor);
  const input = reserveCourseSchema.parse(value);
  await advanceCourseCapacity(db, actor.academyId, input.courseId);
  const action = waitlist ? "waitlist" : "reserve";
  const enrolmentId = randomUUID();
  return db.runTransaction(async tx => {
    await assertCourseActorLive(db, tx, actor);
    const now = new Date().toISOString();
    const receipt = await tx.get(courseOperation(db, actor, action, input.requestId));
    const replay = operationResult<CourseEnrolment>(receipt, input);
    if (replay) return replay;
    const participant = await resolveCourseParticipantInTransaction(db, tx, actor, input.participant);
    const courseRef = courseCollection(db, actor.academyId, "courses").doc(input.courseId);
    const lockRef = courseCollection(db, actor.academyId, "courseParticipantLocks").doc(courseHash(input.courseId, participant.participantKey));
    const [courseSnapshot, lock, features, bank] = await Promise.all([
      tx.get(courseRef), tx.get(lockRef), tx.get(db.doc(`academies/${actor.academyId}/settings/courseFeatures`)), tx.get(db.doc(`academies/${actor.academyId}/settings/paymentInstructions`)),
    ]);
    if (lock.exists) {
      const prior = courseData<CourseEnrolment>(await tx.get(courseCollection(db, actor.academyId, "courseEnrolments").doc(String(lock.data()?.enrolmentId))));
      if (!closed.has(prior.status)) {
        if (prior.applicantUid !== actor.uid) courseFailure("conflict", "The participant already has an enrolment. Contact the office.");
        saveOperation(tx, db, actor, action, input.requestId, input, prior);
        return prior;
      }
    }
    const course = courseData<Course>(courseSnapshot);
    if (features.data()?.coursesEnabled !== true) courseFailure("unavailable", "New course enrolments are currently closed.");
    if (course.status !== "published") courseFailure("conflict", "This course is not open for enrolment.");
    assertCourseRevision(course.revision, input.courseRevision);
    const instructions = parsePaymentInstructionsRecord(bank.data());
    if (!instructions.ok || instructions.value.academyId !== actor.academyId || !instructions.value.accountNumber || !instructions.value.sortCode || !instructions.value.accountName) courseFailure("payment_instructions_missing", "Payment details are not available. Contact the office.");
    const session = await nextCourseSession(db, tx, course, now);
    if (!session) courseFailure("no_future_session", "This course has no remaining sessions.");
    if (!isCourseAgeEligible(course, participant.dateOfBirth, courseLocalDate(session.startAt))) courseFailure("age_ineligible", "The participant is outside the age range for the next session.");
    const queue = await tx.get(courseCollection(db, actor.academyId, "courseEnrolments").where("courseId", "==", input.courseId).where("status", "==", "waitlisted").orderBy("queuedAt").orderBy("enrolmentId").limit(1));
    const unavailable = course.committedSeats >= course.capacity || !queue.empty;
    if (!waitlist && unavailable) courseFailure("full", "All places are reserved. You can join the unpaid waitlist.");
    if (waitlist && !unavailable) courseFailure("conflict", "A place is available. Reserve it to receive the payment details.");
    const consumeLimit = await readCourseRateLimit(db, tx, actor.academyId, actor.uid, "reserve", Date.parse(now));
    const enrolment: CourseEnrolment = {enrolmentId, academyId: actor.academyId, courseId: input.courseId, applicantUid: actor.uid, participant: participant.participant, participantKey: participant.participantKey, studentId: participant.studentId, status: waitlist ? "waitlisted" : "held", revision: 1, priceMinor: course.priceMinor, currency: "GBP", courseRevision: course.revision, acceptedTerms: course.cancellationTerms, acceptedAt: now, transferReference: `BPT${enrolmentId.replaceAll("-", "").slice(0, 15).toUpperCase()}`, reference: "", proofId: null, expiresAt: waitlist ? null : new Date(Date.parse(now) + 86_400_000).toISOString(), submittedAt: null, approvedAt: null, accessFrom: null, queuedAt: waitlist ? now : null, decisionReason: null, createdAt: now, updatedAt: now, seatCommitted: !waitlist, receivedMinor: 0, refundedMinor: 0, pendingRefundMinor: 0};
    consumeLimit();
    if (participant.participant.kind === "candidate") tx.update(courseCollection(db, actor.academyId, "courseCandidates").doc(participant.participant.candidateId), {frozen: true});
    tx.create(courseCollection(db, actor.academyId, "courseEnrolments").doc(enrolmentId), enrolment);
    tx.set(lockRef, {enrolmentId, participantKey: participant.participantKey});
    writeCourseSeats(db, tx, course, waitlist ? 0 : 1, now);
    saveOperation(tx, db, actor, action, input.requestId, input, enrolment);
    return enrolment;
  });
}
export const reserveCourse = (db: Firestore, actor: CourseActor, input: ReserveCourseInput) => createCourseEnrolment(db, actor, input, false);
export const joinCourseWaitlist = (db: Firestore, actor: CourseActor, input: ReserveCourseInput) => createCourseEnrolment(db, actor, input, true);
export async function cancelUnapprovedCourseEnrolment(db: Firestore, actor: CourseActor, value: CourseMutation): Promise<CourseEnrolment> {
  const input = courseMutationSchema.parse(value);
  return db.runTransaction(async tx => {
    await assertCourseActorLive(db, tx, actor);
    const ref = courseCollection(db, actor.academyId, "courseEnrolments").doc(input.enrolmentId);
    const [snapshot, receipt] = await Promise.all([tx.get(ref), tx.get(courseOperation(db, actor, "cancel-unpaid", input.requestId))]);
    const replay = operationResult<CourseEnrolment>(receipt, input); if (replay) return replay;
    const enrolment = courseData<CourseEnrolment>(snapshot);
    if (enrolment.applicantUid !== actor.uid) courseFailure("forbidden", "This enrolment is not available to your account.");
    assertCourseRevision(enrolment.revision, input.expectedRevision);
    if (!["held", "offered", "correction", "waitlisted"].includes(enrolment.status) || enrolment.receivedMinor > 0) courseFailure("conflict", "Contact the office about withdrawing from this enrolment.");
    const course = courseData<Course>(await tx.get(courseCollection(db, actor.academyId, "courses").doc(enrolment.courseId)));
    const now = new Date().toISOString();
    const next: CourseEnrolment = {...enrolment, status: "cancelled", seatCommitted: false, expiresAt: null, revision: enrolment.revision + 1, updatedAt: now};
    tx.set(ref, next);
    if (enrolment.seatCommitted) writeCourseSeats(db, tx, course, -1, now);
    saveOperation(tx, db, actor, "cancel-unpaid", input.requestId, input, next);
    return next;
  });
}
