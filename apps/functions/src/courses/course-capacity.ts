import { getAuth } from "firebase-admin/auth";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { isCourseAgeEligible, type Course, type CourseEnrolment } from "@bpt-jersey/domain/courses";
import { appendCourseNotice, courseCollection, courseData, courseFailure } from "./course-store.js";
import { resolveCourseParticipantInTransaction } from "./course-participants.js";

export async function nextCourseSession(db: Firestore, tx: Transaction, course: Course, now: string): Promise<{sessionId: string; startAt: string} | null> {
  const result = await tx.get(courseCollection(db, course.academyId, "sessions").where("courseId", "==", course.courseId).where("coursePublicationRevision", "==", course.publicationRevision).where("status", "==", "scheduled").where("startAt", ">", now).orderBy("startAt").limit(1));
  const first = result.docs[0];
  return first ? {sessionId: first.id, startAt: String(first.data().startAt)} : null;
}
export function courseLocalDate(instant: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/Jersey", year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(new Date(instant));
  const value = (key: string) => parts.find(p => p.type === key)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function writeCourseSeats(db: Firestore, tx: Transaction, course: Course, delta: number, now: string): void {
  const count = course.committedSeats + delta;
  if (!Number.isSafeInteger(count) || count < 0 || (delta > 0 && count > course.capacity)) courseFailure("conflict", "Course capacity needs office review.");
  tx.update(courseCollection(db, course.academyId, "courses").doc(course.courseId), {committedSeats: count, updatedAt: now});
  // Merge only into an already published projection; callers require publication.
  tx.set(courseCollection(db, course.academyId, "publicCourses").doc(course.courseId), {availability: course.status !== "published" || !course.nextSessionAt ? "closed" : count >= course.capacity ? "waitlist" : "available"}, {merge: true});
}
export async function advanceCourseCapacity(db: Firestore, academyId: string, courseId: string, _now?: string): Promise<{changed: number; more: boolean}> {
  let changed = 0;
  // At most twelve small transactions per invocation, each with fewer than 100 writes.
  for (let index = 0; index < 12; index++) {
    const advanced = await db.runTransaction(async tx => {
      const now = new Date().toISOString();
      const course = courseData<Course>(await tx.get(courseCollection(db, academyId, "courses").doc(courseId)));
      if (course.status !== "published") return false;
      const expired = await tx.get(courseCollection(db, academyId, "courseEnrolments").where("courseId", "==", courseId).where("seatCommitted", "==", true).where("expiresAt", ">", "").where("expiresAt", "<=", now).orderBy("expiresAt").limit(1));
      const expiry = expired.docs[0];
      if (expiry) {
        const enrolment = expiry.data() as CourseEnrolment;
        if (!["held", "offered", "correction"].includes(enrolment.status) || !enrolment.expiresAt) courseFailure("conflict", "Unexpected expiring course reservation.");
        tx.update(expiry.ref, {status: "expired", seatCommitted: false, expiresAt: null, revision: enrolment.revision + 1, updatedAt: now});
        writeCourseSeats(db, tx, course, -1, now);
        appendCourseNotice(tx, db, academyId, {eventId: `expired:${enrolment.enrolmentId}:${enrolment.revision}`, recipientUid: enrolment.applicantUid, courseId, enrolmentId: enrolment.enrolmentId, kind: "expired", title: "Course reservation expired", message: "Your unpaid place has been released. If you already paid, send your evidence for office review.", href: "/account/courses", createdAt: now});
        return true;
      }
      if (course.committedSeats >= course.capacity) return false;
      const flags = await tx.get(db.doc(`academies/${academyId}/settings/courseFeatures`));
      if (flags.data()?.coursesEnabled !== true) return false;
      const queue = await tx.get(courseCollection(db, academyId, "courseEnrolments").where("courseId", "==", courseId).where("status", "==", "waitlisted").orderBy("queuedAt").orderBy("enrolmentId").limit(1));
      const head = queue.docs[0];
      if (!head) return false;
      const enrolment = head.data() as CourseEnrolment;
      const session = await nextCourseSession(db, tx, course, now);
      let eligible = !!session;
      let reason = "There are no future course sessions.";
      try {
        const account = await getAuth().getUser(enrolment.applicantUid);
        if (account.disabled || account.customClaims?.academyId !== academyId || account.customClaims?.role === "teenStudent") {eligible = false; reason = "The applicant account is unavailable.";}
        if (eligible && session) {
          const participant = await resolveCourseParticipantInTransaction(db, tx, {uid: account.uid, academyId, role: String(account.customClaims?.role)}, enrolment.participant);
          eligible = isCourseAgeEligible(course, participant.dateOfBirth, courseLocalDate(session.startAt));
          if (!eligible) reason = "The participant is outside the course age range.";
        }
      } catch (error) {
        // Transient infrastructure errors leave FIFO intact for a later retry.
        const code = (error as {code?: string}).code;
        if (code !== "permission-denied" && code !== "not-found" && code !== "auth/user-not-found") throw error;
        eligible = false; reason = "Participant access requires office review.";
      }
      tx.update(head.ref, {status: eligible ? "offered" : "rejected", seatCommitted: eligible, expiresAt: eligible ? new Date(Date.parse(now) + 86_400_000).toISOString() : null, decisionReason: eligible ? null : reason, revision: enrolment.revision + 1, updatedAt: now});
      // Even rejection touches the shared lock before anyone can evaluate the next queue entry.
      writeCourseSeats(db, tx, course, eligible ? 1 : 0, now);
      appendCourseNotice(tx, db, academyId, {eventId: `offer:${enrolment.enrolmentId}:${enrolment.revision}`, recipientUid: enrolment.applicantUid, courseId, enrolmentId: enrolment.enrolmentId, kind: eligible ? "offered" : "rejected", title: eligible ? "Your course place is available" : "Course waitlist update", message: eligible ? "You have 24 hours to transfer payment and submit your reference and screenshot." : reason, href: "/account/courses", createdAt: now});
      return true;
    });
    if (!advanced) return {changed, more: false};
    changed++;
  }
  return {changed, more: true};
}
