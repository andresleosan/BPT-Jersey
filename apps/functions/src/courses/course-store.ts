import { getAuth } from "firebase-admin/auth";
import { matchesProvisionedMemberDirectoryActor } from "../members/member-directory-actor-authorization.js";
import { createHash } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import type { Firestore, Transaction, DocumentSnapshot } from "firebase-admin/firestore";
import type { Course, CourseErrorCode, CourseJob, CourseNoticeDraft } from "@bpt-jersey/domain/courses";
export type CourseActor = {uid: string; academyId: string; role: string};
export function courseFailure(code: CourseErrorCode, message: string): never {
  const transport = code === "forbidden" ? "permission-denied" : code === "not_found" ? "not-found" : code === "invalid" ? "invalid-argument" : code === "rate_limited" ? "resource-exhausted" : code === "unavailable" ? "unavailable" : "failed-precondition";
  throw new HttpsError(transport, message, {reason: code});
}
export const courseHash = (...parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export const courseCollection = (db: Firestore, academyId: string, name: string) => db.collection(`academies/${academyId}/${name}`);
export function courseData<T>(snapshot: DocumentSnapshot): T {
  if (!snapshot.exists) courseFailure("not_found", "This course record is no longer available.");
  return snapshot.data() as T;
}
export function assertCourseOffice(actor: CourseActor): void {
  if (actor.role !== "owner" && actor.role !== "administrator") courseFailure("forbidden", "Office access is required.");
}
export function assertCourseRevision(actual: number, expected: number): void {
  if (actual !== expected) courseFailure("conflict", "This record changed. Refresh it before continuing.");
}
export async function requireCourseSales(db: Firestore, academyId: string): Promise<void> {
  if ((await db.doc(`academies/${academyId}/settings/courseFeatures`).get()).data()?.coursesEnabled !== true)
    courseFailure("unavailable", "New course enrolments are not available yet.");
}
export function courseOperation(db: Firestore, actor: CourseActor, action: string, requestId: string) {
  return courseCollection(db, actor.academyId, "courseOperations").doc(courseHash(actor.uid, action, requestId));
}
export function operationResult<T>(snapshot: DocumentSnapshot, payload: unknown): T | undefined {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data()!;
  if (data.payloadHash !== courseHash(JSON.stringify(payload))) courseFailure("conflict", "This operation was already used with different details.");
  return data.result as T;
}
export function saveOperation(tx: Transaction, db: Firestore, actor: CourseActor, action: string, requestId: string, payload: unknown, result: unknown): void {
  const ref = courseOperation(db, actor, action, requestId);
  const now = new Date().toISOString();
  tx.create(ref, {academyId: actor.academyId, actorId: actor.uid, action, requestId,
    payloadHash: courseHash(JSON.stringify(payload)), result, createdAt: now});
  tx.create(courseCollection(db, actor.academyId, "courseAudit").doc(ref.id), {
    academyId: actor.academyId, actorId: actor.uid, action, requestId, createdAt: now,
  });
}
export function appendCourseNotice(tx: Transaction, db: Firestore, academyId: string, notice: CourseNoticeDraft): void {
  const noticeId = courseHash(notice.eventId, notice.recipientUid);
  tx.set(courseCollection(db, academyId, "courseNotices").doc(noticeId), {...notice, noticeId, readAt: null});
}
export function newCourseJob(course: Course, kind: CourseJob["kind"], enrolmentId: string | null = null, revision = course.revision): CourseJob {
  return {jobId: `${kind}_${enrolmentId ?? course.courseId}_${revision}`, academyId: course.academyId,
    courseId: course.courseId, kind, enrolmentId, expectedRevision: revision, nextOrdinal: 1,
    state: "queued", leaseUntil: null, lastError: null, recipientCursor: null, eventId: null,
    attempts: 0, nextAttemptAt: null};
}

/** Decisions recheck live account and transactional role locks at the write boundary. */
export async function assertCourseActorLive(db: Firestore, tx: Transaction, actor: CourseActor): Promise<void> {
  const account = await getAuth().getUser(actor.uid);
  if (account.disabled || account.customClaims?.academyId !== actor.academyId || account.customClaims?.role !== actor.role) courseFailure("forbidden", "Your account permissions changed. Sign in again.");
  if (actor.role === "owner" || actor.role === "administrator") {
    const [profile, lock] = await Promise.all([tx.get(db.doc(`academies/${actor.academyId}/users/${actor.uid}`)), tx.get(db.doc(`academies/${actor.academyId}/adminRoleLocks/${actor.uid}`))]);
    if (lock.exists || !matchesProvisionedMemberDirectoryActor(profile.data(), {actorId: actor.uid, academyId: actor.academyId, role: actor.role})) courseFailure("forbidden", "Active office permissions are required.");
  }
}
