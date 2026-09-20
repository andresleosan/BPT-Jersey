import { FieldPath, type Firestore, type Query, type DocumentData } from "firebase-admin/firestore";
import { z } from "zod";
import { parsePaymentInstructionsRecord } from "@bpt-jersey/domain/finance";
import { courseDraftSchema, courseSlot, courseIdSchema, courseRecordIdSchema, enrolmentStatuses, type Course, type CourseDraft, type CourseEnrolment, type CourseNotice, type CoursePage, type CoursePaymentIncident, type CourseRefund, type ParticipantScope } from "@bpt-jersey/domain/courses";
import { assertCourseOffice, courseCollection, courseData, courseFailure, type CourseActor } from "./course-store.js";
import { resolveCourseParticipant } from "./course-participants.js";
export const courseCursorSchema = z.string().max(256).regex(/^[A-Za-z0-9._:-]+$/u);
export const courseListFilterSchema = z.strictObject({courseId: courseIdSchema.optional(), status: z.enum(enrolmentStatuses).optional(), ownOnly: z.boolean().optional(), cursor: courseCursorSchema.optional()});
export type CourseListFilter = z.infer<typeof courseListFilterSchema>;
export async function coursePage<T>(query: Query<DocumentData>, cursor?: string): Promise<CoursePage<T>> {
  let ordered = query.orderBy(FieldPath.documentId());
  if (cursor) ordered = ordered.startAfter(courseCursorSchema.parse(cursor));
  const snapshot = await ordered.limit(31).get();
  const docs = snapshot.docs.slice(0, 30);
  return {items: docs.map(d => d.data() as T), cursor: snapshot.size > 30 ? docs[29]!.id : null};
}
export function listCourses(db: Firestore, actor: CourseActor, cursor?: string): Promise<CoursePage<Course>> {
  assertCourseOffice(actor); return coursePage(courseCollection(db, actor.academyId, "courses"), cursor);
}
export async function getCourse(db: Firestore, actor: CourseActor, courseId: string): Promise<Course> {
  assertCourseOffice(actor); return courseData<Course>(await courseCollection(db, actor.academyId, "courses").doc(courseIdSchema.parse(courseId)).get());
}
export async function getCourseEnrolment(db: Firestore, actor: CourseActor, enrolmentId: string): Promise<CourseEnrolment> {
  const enrolment = courseData<CourseEnrolment>(await courseCollection(db, actor.academyId, "courseEnrolments").doc(courseIdSchema.parse(enrolmentId)).get());
  if (enrolment.applicantUid !== actor.uid) assertCourseOffice(actor);
  return enrolment;
}
export function listCourseEnrolments(db: Firestore, actor: CourseActor, value: CourseListFilter): Promise<CoursePage<CourseEnrolment>> {
  const filter = courseListFilterSchema.parse(value);
  let query: Query<DocumentData> = courseCollection(db, actor.academyId, "courseEnrolments");
  if (filter.ownOnly || !["owner", "administrator"].includes(actor.role)) query = query.where("applicantUid", "==", actor.uid);
  if (filter.courseId) query = query.where("courseId", "==", filter.courseId);
  if (filter.status) query = query.where("status", "==", filter.status);
  return coursePage(query, filter.cursor);
}
export async function listCourseNotices(db: Firestore, actor: CourseActor, cursor?: string): Promise<CoursePage<CourseNotice>> {
  const collection = courseCollection(db, actor.academyId, "courseNotices");
  let query = collection.where("recipientUid", "==", actor.uid).orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc");
  if (cursor) {const anchor = await collection.doc(courseCursorSchema.parse(cursor)).get(); if (!anchor.exists || anchor.data()?.recipientUid !== actor.uid) courseFailure("invalid", "Refresh your notices."); query = query.startAfter(anchor);}
  const page = await query.limit(31).get(); const docs = page.docs.slice(0, 30);
  return {items: docs.map(d => d.data() as CourseNotice), cursor: page.size > 30 ? docs[29]!.id : null};
}
export async function markCourseNoticeRead(db: Firestore, actor: CourseActor, noticeId: string): Promise<void> {
  const ref = courseCollection(db, actor.academyId, "courseNotices").doc(z.string().regex(/^[a-f0-9]{64}$/u).parse(noticeId));
  await db.runTransaction(async tx => {
    const notice = courseData<CourseNotice>(await tx.get(ref));
    if (notice.recipientUid !== actor.uid) courseFailure("forbidden", "This notice is not available.");
    if (!notice.readAt) tx.update(ref, {readAt: new Date().toISOString()});
  });
}
export async function getCoursePaymentInstructions(db: Firestore, actor: CourseActor, enrolmentId: string) {
  const enrolment = await getCourseEnrolment(db, actor, enrolmentId);
  if (!enrolment.seatCommitted || !["held", "offered", "correction"].includes(enrolment.status) || !enrolment.expiresAt || enrolment.expiresAt <= new Date().toISOString()) return {instructions: null};
  const record = parsePaymentInstructionsRecord((await db.doc(`academies/${actor.academyId}/settings/paymentInstructions`).get()).data());
  if (!record.ok || record.value.academyId !== actor.academyId) return {instructions: null};
  const {accountName, sortCode, accountNumber, bankName, referenceHint} = record.value;
  return {instructions: {accountName, sortCode, accountNumber, bankName, referenceHint}};
}
export async function listCourseRefunds(db: Firestore, actor: CourseActor, enrolmentId: string, cursor?: string): Promise<CoursePage<CourseRefund>> {
  await getCourseEnrolment(db, actor, enrolmentId);
  const result = await coursePage<CourseRefund>(courseCollection(db, actor.academyId, "courseRefunds").where("enrolmentId", "==", enrolmentId), cursor);
  if (!["owner", "administrator"].includes(actor.role)) result.items = result.items.map(r => ({...r, reason: "", createdBy: "", updatedBy: ""}));
  return result;
}
export async function listCoursePaymentIncidents(db: Firestore, actor: CourseActor, filter: {enrolmentId?: string | undefined; cursor?: string | undefined; openOnly?: boolean | undefined}): Promise<CoursePage<CoursePaymentIncident & {participantName?: string; courseTitle?: string}>> {
  let query: Query<DocumentData> = courseCollection(db, actor.academyId, "coursePaymentIncidents");
  if (filter.enrolmentId) {await getCourseEnrolment(db, actor, filter.enrolmentId); query = query.where("enrolmentId", "==", filter.enrolmentId);}
  else assertCourseOffice(actor);
  if (filter.openOnly) query = query.where("state", "==", "open");
  const result = await coursePage<CoursePaymentIncident>(query, filter.cursor);
  if (!["owner", "administrator"].includes(actor.role)) result.items = result.items.map(i => ({...i, resolution: i.state === "resolved" ? "Reviewed by the office. Contact us for the outcome." : null}));
  if (!filter.enrolmentId) {
    const items = await Promise.all(result.items.map(async incident => {
      const detail = await getCourseEnrolmentDetail(db, actor, incident.enrolmentId);
      return {...incident, participantName: detail.participant.fullName, courseTitle: detail.courseTitle};
    }));
    return {...result, items};
  }
  return result;
}

/** Three bounded streams share a phase cursor; no account-wide unbounded reads. */
export async function listCourseParticipants(db: Firestore, actor: CourseActor, cursor?: string): Promise<CoursePage<ParticipantScope>> {
  const value = cursor ?? "0:";
  const separator = value.indexOf(":");
  const phaseText = value.slice(0, separator); const after = value.slice(separator + 1);
  const phase = Number(phaseText);
  if (![0, 1, 2].includes(phase) || (after && !courseRecordIdSchema.safeParse(after).success)) courseFailure("invalid", "Refresh the participant list.");
  const collection = phase === 0 ? "students" : phase === 1 ? "relationships" : "courseCandidates";
  const field = phase === 0 ? "userId" : phase === 1 ? "adultUserId" : "applicantUid";
  let query: Query<DocumentData> = courseCollection(db, actor.academyId, collection).where(field, "==", actor.uid).orderBy(FieldPath.documentId());
  if (after) query = query.startAfter(after);
  const snapshot = await query.limit(31).get();
  const docs = snapshot.docs.slice(0, 30);
  const items: ParticipantScope[] = [];
  for (const doc of docs) {
    try {
      const participant = await resolveCourseParticipant(db, actor, phase === 2 ? {kind: "candidate", candidateId: doc.id} : {kind: "student", studentId: phase === 0 ? doc.id : String(doc.data().studentId)});
      if (!items.some(p => p.participantKey === participant.participantKey)) items.push(participant);
    } catch (error) {
      if ((error as {code?: string}).code !== "permission-denied") throw error;
    }
  }
  return {items, cursor: snapshot.size > 30 ? `${phase}:${docs[29]!.id}` : phase < 2 ? `${phase + 1}:` : null};
}

export async function getCourseEnrolmentDetail(db: Firestore, actor: CourseActor, enrolmentId: string) {
  const enrolment = await getCourseEnrolment(db, actor, enrolmentId);
  const ref = enrolment.studentId ? courseCollection(db, actor.academyId, "students").doc(enrolment.studentId) : enrolment.participant.kind === "candidate" ? courseCollection(db, actor.academyId, "courseCandidates").doc(enrolment.participant.candidateId) : courseCollection(db, actor.academyId, "students").doc(enrolment.participant.studentId);
  const [participant, course] = await Promise.all([ref.get(), courseCollection(db, actor.academyId, "courses").doc(enrolment.courseId).get()]);
  const data = participant.data() ?? {};
  const position = enrolment.status === "waitlisted" && enrolment.queuedAt ? (await courseCollection(db, actor.academyId, "courseEnrolments").where("courseId", "==", enrolment.courseId).where("status", "==", "waitlisted").orderBy("queuedAt").orderBy("enrolmentId").endAt(enrolment.queuedAt, enrolment.enrolmentId).count().get()).data().count : null;
  return {waitlistPosition: position, enrolment, participant: {fullName: String(data.fullName ?? data.displayName ?? "Participant"), dateOfBirth: String(data.dateOfBirth ?? "")}, courseTitle: String(course.data()?.title ?? "Course")};
}
export async function listCourseSessionDates(db: Firestore, actor: CourseActor, filter: {courseId: string; enrolmentId?: string | undefined; cursor?: string | undefined; draft?: CourseDraft | undefined}) {
  if (filter.draft) {assertCourseOffice(actor); return previewCourseDates(filter.courseId, courseDraftSchema.parse(filter.draft), filter.cursor);}
  if (filter.enrolmentId) {const e = await getCourseEnrolment(db, actor, filter.enrolmentId); if (e.courseId !== filter.courseId) courseFailure("forbidden", "This course is not part of the enrolment.");}
  else assertCourseOffice(actor);
  const course = courseData<Course>(await courseCollection(db, actor.academyId, "courses").doc(filter.courseId).get());
  if (course.status === "draft") {assertCourseOffice(actor); return previewCourseDates(course.courseId, course, filter.cursor);}
  let query = courseCollection(db, actor.academyId, "sessions").where("courseId", "==", course.courseId).where("coursePublicationRevision", "==", course.publicationRevision).orderBy("courseOrdinal");
  if (filter.cursor) {const ordinal = Number(filter.cursor); if (!Number.isSafeInteger(ordinal) || ordinal < 1) courseFailure("invalid", "Refresh the session dates."); query = query.startAfter(ordinal);}
  const page = await query.limit(31).get(); const docs = page.docs.slice(0, 30);
  return {items: docs.map(d => ({sessionId: d.id, courseId: course.courseId, ordinal: Number(d.data().courseOrdinal), startAt: String(d.data().startAt), endAt: String(d.data().endAt), status: String(d.data().status)})), cursor: page.size > 30 ? String(docs[29]!.data().courseOrdinal) : null};
}
export async function courseCoachOptions(db: Firestore, actor: CourseActor, cursor?: string) {
  assertCourseOffice(actor);
  let query = courseCollection(db, actor.academyId, "staff").where("active", "==", true).orderBy(FieldPath.documentId());
  if (cursor) query = query.startAfter(cursor);
  const page = await query.limit(31).get(); const docs = page.docs.slice(0, 30);
  const users = await Promise.all(docs.map(d => courseCollection(db, actor.academyId, "users").doc(String(d.data().userId)).get()));
  return {items: docs.flatMap((d,i) => d.data().status === "active" ? [{staffId: d.id, name: String(users[i]?.data()?.displayName ?? users[i]?.data()?.fullName ?? "Coach")}] : []), cursor: page.size > 30 ? docs[29]!.id : null};
}

function previewCourseDates(courseId: string, draft: CourseDraft, cursor?: string) {
  const after = cursor ? Number(cursor) : 0;
  if (!Number.isSafeInteger(after) || after < 0 || after >= draft.sessionCount) courseFailure("invalid", "Refresh the date preview.");
  const items = [];
  for (let ordinal = after + 1; ordinal <= Math.min(after + 30, draft.sessionCount); ordinal++) {
    try {items.push({...courseSlot({...draft, courseId}, ordinal), status: "draft"});}
    catch (error) {courseFailure("invalid", `Session ${ordinal}: ${error instanceof Error ? error.message : "Check the Jersey date and time."}`);}
  }
  return {items, cursor: after + 30 < draft.sessionCount ? String(after + 30) : null};
}
