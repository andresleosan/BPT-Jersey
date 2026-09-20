import { randomUUID } from "node:crypto";
import { FieldPath, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { Course, CourseEnrolment, CourseJob, CoursePaymentIncident } from "@bpt-jersey/domain/courses";
import { prepareCourseBooking } from "./course-access.js";
import { runCoursePublicationBatch } from "./course-publication.js";
import { appendCourseNotice, assertCourseActorLive, assertCourseOffice, assertCourseRevision, courseCollection, courseData, courseFailure, courseOperation, newCourseJob, operationResult, saveOperation, type CourseActor } from "./course-store.js";

type LeasedJob = CourseJob & {leaseToken: string; message?: string; sessionId?: string};
const jobs = (db: Firestore, academyId: string) => courseCollection(db, academyId, "courseJobs");
export function ownsCourseJob(live: CourseJob & {leaseToken?: string}, job: CourseJob & {leaseToken?: string}): boolean {
  return live.state === "running" && !!job.leaseToken && live.leaseToken === job.leaseToken && !!live.leaseUntil && live.leaseUntil > new Date().toISOString();
}
function progress(tx: Transaction, db: Firestore, job: LeasedJob, done: boolean, fields: Record<string, unknown> = {}) {
  tx.update(jobs(db, job.academyId).doc(job.jobId), {...fields, state: done ? "done" : "queued", leaseUntil: null, leaseToken: null, nextAttemptAt: null, attempts: 0});
}
export async function cancelCourse(db: Firestore, actor: CourseActor, input: {courseId: string; expectedRevision: number; requestId: string; reason: string}): Promise<Course> {
  assertCourseOffice(actor);
  return db.runTransaction(async tx => {
    await assertCourseActorLive(db, tx, actor);
    const ref = courseCollection(db, actor.academyId, "courses").doc(input.courseId);
    const [snapshot, receipt] = await Promise.all([tx.get(ref), tx.get(courseOperation(db, actor, "cancel_course", input.requestId))]);
    const replay = operationResult<Course>(receipt, input); if (replay) return replay;
    const course = courseData<Course>(snapshot); assertCourseRevision(course.revision, input.expectedRevision);
    if (!["draft", "published"].includes(course.status)) courseFailure("conflict", "This course is already closed.");
    const next: Course = {...course, status: "cancelled", accessClosedAt: new Date().toISOString(), revision: course.revision + 1, nextSessionAt: null, updatedAt: new Date().toISOString()};
    tx.set(ref, next);
    tx.delete(courseCollection(db, actor.academyId, "publicCourses").doc(course.courseId));
    const job = newCourseJob(next, "cancel_course");
    tx.create(jobs(db, actor.academyId).doc(job.jobId), {...job, message: input.reason});
    saveOperation(tx, db, actor, "cancel_course", input.requestId, input, next);
    return next;
  });
}
export async function retryCourseJob(db: Firestore, actor: CourseActor, jobId: string, requestId: string): Promise<CourseJob> {
  assertCourseOffice(actor);
  return db.runTransaction(async tx => {
    await assertCourseActorLive(db, tx, actor);
    const [snapshot, receipt] = await Promise.all([tx.get(jobs(db, actor.academyId).doc(jobId)), tx.get(courseOperation(db, actor, "retry_job", requestId))]);
    const replay = operationResult<CourseJob>(receipt, {jobId}); if (replay) return replay;
    const job = courseData<CourseJob>(snapshot);
    const course = courseData<Course>(await tx.get(courseCollection(db, actor.academyId, "courses").doc(job.courseId)));
    if (job.state !== "failed" || (job.kind === "publish" && (course.status !== "draft" || course.revision !== job.expectedRevision))) courseFailure("conflict", "Refresh the course before retrying this job.");
    const next: CourseJob = {...job, state: "queued", leaseUntil: null, nextAttemptAt: null, attempts: 0};
    tx.set(snapshot.ref, next, {merge: true});
    saveOperation(tx, db, actor, "retry_job", requestId, {jobId}, next);
    return next;
  });
}
async function projectBatch(db: Firestore, job: LeasedJob): Promise<boolean> {
  return db.runTransaction(async tx => {
    const live = courseData<LeasedJob>(await tx.get(jobs(db, job.academyId).doc(job.jobId)));
    if (!ownsCourseJob(live, job)) return true;
    const enrolment = courseData<CourseEnrolment>(await tx.get(courseCollection(db, job.academyId, "courseEnrolments").doc(job.enrolmentId!)));
    const course = courseData<Course>(await tx.get(courseCollection(db, job.academyId, "courses").doc(job.courseId)));
    if (enrolment.revision !== job.expectedRevision || !["approved", "withdrawal_requested"].includes(enrolment.status) || !["published", "completed"].includes(course.status) || !enrolment.studentId) {progress(tx, db, job, true); return true;}
    const sessions = await tx.get(courseCollection(db, job.academyId, "sessions").where("courseId", "==", job.courseId).where("courseOrdinal", ">=", live.nextOrdinal).orderBy("courseOrdinal").limit(20));
    const writes: (() => void)[] = [];
    for (const session of sessions.docs) {
      const data = session.data();
      if (data.status === "cancelled" || data.startAt < enrolment.accessFrom! || data.endAt <= new Date().toISOString() || data.coursePublicationRevision !== course.publicationRevision) continue;
      const prepared = await prepareCourseBooking(db, tx, job.academyId, session.id, enrolment.studentId);
      writes.push(prepared.write);
    }
    writes.forEach(write => write());
    const done = sessions.size < 20;
    progress(tx, db, job, done, {nextOrdinal: Number(sessions.docs.at(-1)?.data().courseOrdinal ?? live.nextOrdinal) + 1});
    return done;
  });
}
async function revokeBatch(db: Firestore, job: LeasedJob): Promise<boolean> {
  return db.runTransaction(async tx => {
    const live = courseData<LeasedJob>(await tx.get(jobs(db, job.academyId).doc(job.jobId)));
    if (!ownsCourseJob(live, job)) return true;
    const enrolment = courseData<CourseEnrolment>(await tx.get(courseCollection(db, job.academyId, "courseEnrolments").doc(job.enrolmentId!)));
    if (enrolment.revision !== job.expectedRevision || ["approved", "withdrawal_requested"].includes(enrolment.status)) {progress(tx, db, job, true); return true;}
    let query = courseCollection(db, job.academyId, "bookings").where("source.enrolmentId", "==", job.enrolmentId).orderBy(FieldPath.documentId());
    if (live.recipientCursor) query = query.startAfter(live.recipientCursor);
    const bookings = await tx.get(query.limit(40));
    const sessions = bookings.empty ? [] : await tx.getAll(...bookings.docs.map(b => courseCollection(db, job.academyId, "sessions").doc(String(b.data().sessionId))));
    const now = new Date().toISOString();
    bookings.docs.forEach((booking, index) => {if (sessions[index]?.data()?.startAt > now && booking.data().status === "confirmed") tx.update(booking.ref, {status: "cancelled", cancelledAt: now, cancellationReason: "Course enrolment ended", updatedAt: now, updatedBy: "course-worker"});});
    const done = bookings.size < 40; progress(tx, db, job, done, {recipientCursor: bookings.docs.at(-1)?.id ?? null}); return done;
  });
}
async function notifyBatch(db: Firestore, job: LeasedJob): Promise<boolean> {
  return db.runTransaction(async tx => {
    const live = courseData<LeasedJob>(await tx.get(jobs(db, job.academyId).doc(job.jobId)));
    if (!ownsCourseJob(live, job)) return true;
    let query = courseCollection(db, job.academyId, "courseEnrolments").where("courseId", "==", job.courseId).where("status", "in", ["approved", "withdrawal_requested"]).orderBy(FieldPath.documentId());
    if (live.recipientCursor) query = query.startAfter(live.recipientCursor);
    const page = await tx.get(query.limit(40));
    page.docs.forEach(doc => {const e = doc.data() as CourseEnrolment; appendCourseNotice(tx, db, job.academyId, {eventId: `${job.eventId ?? job.jobId}:${doc.id}`, recipientUid: e.applicantUid, courseId: job.courseId, enrolmentId: doc.id, kind: "rescheduled", title: "Course session updated", message: live.message ?? "Check your course calendar for the updated session.", href: "/account/courses", createdAt: new Date().toISOString()});});
    const done = page.size < 40; progress(tx, db, job, done, {recipientCursor: page.docs.at(-1)?.id ?? null}); return done;
  });
}
async function closeBatch(db: Firestore, job: LeasedJob): Promise<boolean> {
  return db.runTransaction(async tx => {
    const live = courseData<LeasedJob>(await tx.get(jobs(db, job.academyId).doc(job.jobId)));
    if (!ownsCourseJob(live, job)) return true;
    const courseRef = courseCollection(db, job.academyId, "courses").doc(job.courseId);
    const course = courseData<Course>(await tx.get(courseRef));
    if (!["cancelled", "completed"].includes(course.status)) {progress(tx, db, job, true); return true;}
    const now = new Date().toISOString();
    if (live.recipientCursor === null && course.status === "cancelled") {
      const sessions = await tx.get(courseCollection(db, job.academyId, "sessions").where("courseId", "==", job.courseId).where("courseOrdinal", ">=", live.nextOrdinal).orderBy("courseOrdinal").limit(90));
      for (const s of sessions.docs) if (s.data().startAt > now && s.data().status !== "cancelled") tx.update(s.ref, {status: "cancelled", cancellationReason: live.message ?? "Course cancelled", updatedAt: now, updatedBy: "course-worker"});
      progress(tx, db, job, false, {nextOrdinal: Number(sessions.docs.at(-1)?.data().courseOrdinal ?? live.nextOrdinal) + 1, recipientCursor: sessions.size < 90 ? "" : null}); return false;
    }
    let query = courseCollection(db, job.academyId, "courseEnrolments").where("courseId", "==", job.courseId).orderBy(FieldPath.documentId());
    if (live.recipientCursor) query = query.startAfter(live.recipientCursor);
    const page = await tx.get(query.limit(10));
    let released = 0;
    for (const doc of page.docs) {
      const e = doc.data() as CourseEnrolment;
      if (course.status === "completed" && ["approved", "withdrawal_requested"].includes(e.status)) continue;
      const active = e.seatCommitted || e.status === "waitlisted";
      if (e.seatCommitted) released++;
      if (active) {
        tx.update(doc.ref, {status: "cancelled", accessUntil: course.accessClosedAt ?? now, seatCommitted: false, expiresAt: null, revision: e.revision + 1, decisionReason: live.message ?? "Course finished", updatedAt: now});
        const revoke = newCourseJob(course, "revoke_enrolment", e.enrolmentId, e.revision + 1);
        tx.set(jobs(db, job.academyId).doc(revoke.jobId), revoke);
        appendCourseNotice(tx, db, job.academyId, {eventId: `${job.jobId}:${doc.id}`, recipientUid: e.applicantUid, courseId: job.courseId, enrolmentId: doc.id, kind: "cancelled", title: course.status === "cancelled" ? "Course cancelled" : "Course enrolment closed", message: live.message ?? "The course has finished. The office will review any payment evidence separately.", href: "/account/courses", createdAt: now});
      }
      if (e.proofId && (course.status === "cancelled" || ["review", "correction", "expired"].includes(e.status))) {
        const incidentId = randomUUID();
        const incident: CoursePaymentIncident = {incidentId, academyId: job.academyId, enrolmentId: doc.id, proofId: e.proofId, reference: e.reference, reason: course.status === "cancelled" ? "course_cancelled" : "course_ended", state: "open", resolution: null, createdAt: now, resolvedAt: null};
        tx.create(courseCollection(db, job.academyId, "coursePaymentIncidents").doc(incidentId), incident);
      }
    }
    if (released > course.committedSeats) courseFailure("conflict", "Course capacity requires office review.");
    if (released) tx.update(courseRef, {committedSeats: course.committedSeats - released, updatedAt: now});
    const done = page.size < 10; progress(tx, db, job, done, {recipientCursor: page.docs.at(-1)?.id ?? ""}); return done;
  });
}
/** One claim and one batch, with at most 93 transaction writes. */
export async function runCourseJobBatch(db: Firestore, academyId: string, jobId: string): Promise<{done: boolean}> {
  const ref = jobs(db, academyId).doc(jobId);
  const job = await db.runTransaction(async tx => {
    const live = courseData<CourseJob>(await tx.get(ref)); const now = new Date().toISOString();
    if (["done", "failed"].includes(live.state) || (live.leaseUntil && live.leaseUntil > now) || (live.nextAttemptAt && live.nextAttemptAt > now)) return null;
    const claimed: LeasedJob = {...live, leaseToken: randomUUID(), state: "running", leaseUntil: new Date(Date.now() + 120_000).toISOString()};
    tx.update(ref, claimed); return claimed;
  });
  if (!job) return {done: false};
  try {
    const done = job.kind === "publish" ? await runCoursePublicationBatch(db, job) : job.kind === "project_enrolment" ? await projectBatch(db, job) : job.kind === "revoke_enrolment" ? await revokeBatch(db, job) : job.kind === "notify_session" ? await notifyBatch(db, job) : await closeBatch(db, job);
    return {done};
  } catch {
    await db.runTransaction(async tx => {
      const live = courseData<LeasedJob>(await tx.get(ref)); if (!ownsCourseJob(live, job)) return;
      const attempts = live.attempts + 1;
      tx.update(ref, {attempts, state: attempts >= 5 ? "failed" : "queued", leaseUntil: null, leaseToken: null, lastError: "batch_failed", nextAttemptAt: new Date(Date.now() + Math.min(900_000, 30_000 * 2 ** (attempts - 1))).toISOString()});
    });
    return {done: false};
  }
}
