import { getAuth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { courseLabel, courseMutationSchema, isCourseAgeEligible, type ApprovalInput, type Course, type CourseEnrolment, type CourseMutation, type CourseProof } from "@bpt-jersey/domain/courses";
import { ensureApprovedCourseStudent, resolveCourseParticipantInTransaction, type CourseIdentityDependencies } from "./course-participants.js";
import { advanceCourseCapacity, courseLocalDate, nextCourseSession, writeCourseSeats } from "./course-capacity.js";
import { prepareCourseMoney } from "./course-finance.js";
import { assertCourseActorLive, appendCourseNotice, assertCourseOffice, assertCourseRevision, courseCollection, courseData, courseFailure, courseHash, courseOperation, newCourseJob, operationResult, saveOperation, type CourseActor } from "./course-store.js";

export async function approveCourseEnrolment(db: Firestore, actor: CourseActor, value: ApprovalInput, identityDependencies: CourseIdentityDependencies): Promise<CourseEnrolment> {
  assertCourseOffice(actor);
  const input = courseMutationSchema.extend({acknowledgeDuplicate: z.boolean().optional()}).parse(value);
  const replay = operationResult<CourseEnrolment>(await courseOperation(db, actor, "approve", input.requestId).get(), input); if (replay) return replay;
  const initial = courseData<CourseEnrolment>(await courseCollection(db, actor.academyId, "courseEnrolments").doc(input.enrolmentId).get());
  assertCourseRevision(initial.revision, input.expectedRevision);
  await advanceCourseCapacity(db, actor.academyId, initial.courseId);
  const identity = await ensureApprovedCourseStudent(db, actor, input.enrolmentId, identityDependencies);
  return db.runTransaction(async tx => {
    await assertCourseActorLive(db, tx, actor);
    const now = new Date().toISOString();
    const ref = courseCollection(db, actor.academyId, "courseEnrolments").doc(input.enrolmentId);
    const [snapshot, receipt] = await Promise.all([tx.get(ref), tx.get(courseOperation(db, actor, "approve", input.requestId))]);
    const replay = operationResult<CourseEnrolment>(receipt, input); if (replay) return replay;
    const enrolment = courseData<CourseEnrolment>(snapshot); assertCourseRevision(enrolment.revision, input.expectedRevision);
    if (!enrolment.proofId || enrolment.receivedMinor !== 0 || !["review", "expired", "rejected", "cancelled"].includes(enrolment.status)) courseFailure("conflict", "This enrolment is not awaiting payment approval.");
    const account = await getAuth().getUser(enrolment.applicantUid);
    if (account.disabled || account.customClaims?.academyId !== actor.academyId || account.customClaims?.role === "teenStudent") courseFailure("forbidden", "The applicant's account is unavailable.");
    const participant = await resolveCourseParticipantInTransaction(db, tx, {uid: account.uid, academyId: actor.academyId, role: String(account.customClaims?.role)}, {kind: "student", studentId: identity.studentId});
    const course = courseData<Course>(await tx.get(courseCollection(db, actor.academyId, "courses").doc(enrolment.courseId)));
    const session = await nextCourseSession(db, tx, course, now);
    if (course.status !== "published" || !session) courseFailure("no_future_session", "No future sessions remain. Resolve the payment incident without granting access.");
    if (!isCourseAgeEligible(course, participant.dateOfBirth, courseLocalDate(session.startAt))) courseFailure("age_ineligible", "The participant is outside the age range for the next session.");
    const proof = courseData<CourseProof>(await tx.get(courseCollection(db, actor.academyId, "courseProofs").doc(enrolment.proofId)));
    if (proof.enrolmentId !== enrolment.enrolmentId || proof.applicantUid !== enrolment.applicantUid || proof.state !== "attached") courseFailure("conflict", "The submitted payment evidence is unavailable.");
    const keys = [courseHash("image", proof.sha256), courseHash("reference", enrolment.reference.normalize("NFKC").trim().toUpperCase())];
    for (const key of keys) {
      const duplicates = await tx.get(courseCollection(db, actor.academyId, "courseEvidenceKeys").where("key", "==", key).where("enrolmentId", "!=", enrolment.enrolmentId).limit(1));
      if (!duplicates.empty && !input.acknowledgeDuplicate) courseFailure("conflict", "This image or reference appears on another enrolment. Confirm the separate bank payment before approving.");
    }
    const lockRefs = [...new Set([enrolment.participantKey, participant.participantKey, `student:${identity.studentId}`])].map(key => courseCollection(db, actor.academyId, "courseParticipantLocks").doc(courseHash(course.courseId, key)));
    const locks = await tx.getAll(...lockRefs);
    for (const lock of locks) {
      const otherId = lock.data()?.enrolmentId;
      if (otherId && otherId !== enrolment.enrolmentId) {
        const other = courseData<CourseEnrolment>(await tx.get(courseCollection(db, actor.academyId, "courseEnrolments").doc(String(otherId))));
        if (!["expired", "rejected", "cancelled"].includes(other.status)) courseFailure("conflict", "This participant has another current enrolment. Resolve it before approval.");
      }
    }
    if (!enrolment.seatCommitted) {
      const features = await tx.get(db.doc(`academies/${actor.academyId}/settings/courseFeatures`));
      const queue = await tx.get(courseCollection(db, actor.academyId, "courseEnrolments").where("courseId", "==", course.courseId).where("status", "==", "waitlisted").limit(1));
      if (features.data()?.coursesEnabled !== true || course.committedSeats >= course.capacity || !queue.empty) courseFailure("full", "There is no unallocated place. Resolve the payment incident without course access.");
    } else if (enrolment.status !== "review") courseFailure("conflict", "This place is not awaiting review.");
    const incidents = await tx.get(courseCollection(db, actor.academyId, "coursePaymentIncidents").where("enrolmentId", "==", enrolment.enrolmentId).where("state", "==", "open").limit(31));
    if (incidents.size > 30) courseFailure("conflict", "Resolve older payment incidents before approval.");
    const writeMoney = await prepareCourseMoney(db, tx, actor, enrolment, course, identity.studentId, now);
    const approved: CourseEnrolment = {...enrolment, status: "approved", studentId: identity.studentId, seatCommitted: true, expiresAt: null, approvedAt: now, accessFrom: now, receivedMinor: enrolment.priceMinor, revision: enrolment.revision + 1, updatedAt: now, decisionReason: null};
    writeMoney(); tx.set(ref, approved);
    for (const lockRef of lockRefs) tx.set(lockRef, {enrolmentId: enrolment.enrolmentId, participantKey: enrolment.participantKey});
    if (!enrolment.seatCommitted) writeCourseSeats(db, tx, course, 1, now);
    for (const incident of incidents.docs) if (incident.data().proofId === enrolment.proofId) tx.update(incident.ref, {state: "resolved", resolution: "Payment confirmed and course place approved.", resolvedAt: now});
    const job = newCourseJob(course, "project_enrolment", enrolment.enrolmentId, approved.revision);
    tx.set(courseCollection(db, actor.academyId, "courseJobs").doc(job.jobId), job);
    appendCourseNotice(tx, db, actor.academyId, {eventId: `approved:${enrolment.enrolmentId}`, recipientUid: enrolment.applicantUid, courseId: course.courseId, enrolmentId: enrolment.enrolmentId, kind: "approved", title: "You're enrolled", message: "Your payment is approved. All remaining course sessions are included in your calendar.", href: "/account/courses", createdAt: now});
    saveOperation(tx, db, actor, "approve", input.requestId, input, approved);
    return approved;
  });
}

type Decision = CourseMutation & {action: "correction" | "reject" | "request-withdrawal" | "confirm-withdrawal" | "deny-withdrawal"; reason: string};
async function decideEnrolment(db: Firestore, actor: CourseActor, value: Decision): Promise<CourseEnrolment> {
  const input = courseMutationSchema.extend({action: z.enum(["correction", "reject", "request-withdrawal", "confirm-withdrawal", "deny-withdrawal"]), reason: courseLabel(1000)}).parse(value);
  if (input.action !== "request-withdrawal") assertCourseOffice(actor);
  return db.runTransaction(async tx => {
    await assertCourseActorLive(db, tx, actor);
    const ref = courseCollection(db, actor.academyId, "courseEnrolments").doc(input.enrolmentId);
    const [snapshot, receipt] = await Promise.all([tx.get(ref), tx.get(courseOperation(db, actor, input.action, input.requestId))]);
    const replay = operationResult<CourseEnrolment>(receipt, input); if (replay) return replay;
    const enrolment = courseData<CourseEnrolment>(snapshot); assertCourseRevision(enrolment.revision, input.expectedRevision);
    if (input.action === "request-withdrawal" && enrolment.applicantUid !== actor.uid) courseFailure("forbidden", "This enrolment is not available.");
    const required = input.action === "request-withdrawal" ? "approved" : input.action.includes("withdrawal") ? "withdrawal_requested" : "review";
    if (enrolment.status !== required) courseFailure("conflict", "This enrolment is no longer awaiting that decision.");
    const course = courseData<Course>(await tx.get(courseCollection(db, actor.academyId, "courses").doc(enrolment.courseId)));
    const now = new Date().toISOString();
    const status = input.action === "request-withdrawal" ? "withdrawal_requested" : input.action === "confirm-withdrawal" ? "cancelled" : input.action === "deny-withdrawal" ? "approved" : input.action === "reject" ? "rejected" : "correction";
    const release = status === "cancelled" || status === "rejected";
    const next: CourseEnrolment = {...enrolment, status, revision: enrolment.revision + 1, decisionReason: input.reason, expiresAt: status === "correction" ? new Date(Date.parse(now) + 86_400_000).toISOString() : null, seatCommitted: release ? false : enrolment.seatCommitted, updatedAt: now};
    tx.set(ref, next);
    if (release && enrolment.seatCommitted) writeCourseSeats(db, tx, course, -1, now);
    if (status === "cancelled") {
      const job = newCourseJob(course, "revoke_enrolment", enrolment.enrolmentId, next.revision);
      tx.set(courseCollection(db, actor.academyId, "courseJobs").doc(job.jobId), job);
    }
    if (input.action !== "request-withdrawal") appendCourseNotice(tx, db, actor.academyId, {eventId: `${input.action}:${enrolment.enrolmentId}:${next.revision}`, recipientUid: enrolment.applicantUid, courseId: course.courseId, enrolmentId: enrolment.enrolmentId, kind: status === "correction" ? "correction" : status === "rejected" ? "rejected" : status === "cancelled" ? "cancelled" : "approved", title: status === "correction" ? "Payment details need a correction" : "Course enrolment update", message: input.reason, href: "/account/courses", createdAt: now});
    saveOperation(tx, db, actor, input.action, input.requestId, input, next);
    return next;
  });
}
export const reviewCourseEnrolment = (db: Firestore, actor: CourseActor, input: CourseMutation & {decision: "correction" | "reject"; reason: string}) => decideEnrolment(db, actor, {requestId: input.requestId, enrolmentId: input.enrolmentId, expectedRevision: input.expectedRevision, action: input.decision, reason: input.reason});
export const requestCourseWithdrawal = (db: Firestore, actor: CourseActor, input: CourseMutation & {reason: string}) => decideEnrolment(db, actor, {...input, action: "request-withdrawal"});
export const decideCourseWithdrawal = (db: Firestore, actor: CourseActor, input: CourseMutation & {approve: boolean; reason: string}) => {
  const {approve, ...rest} = input;
  return decideEnrolment(db, actor, {...rest, action: approve ? "confirm-withdrawal" : "deny-withdrawal"});
};
