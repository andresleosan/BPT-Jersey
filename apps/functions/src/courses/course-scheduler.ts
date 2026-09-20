import { FieldPath, getFirestore, type Firestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import type { Course, CourseProof } from "@bpt-jersey/domain/courses";
import { createPrivateStorageR2Client, type R2Client } from "../storage/r2-client.js";
import { enrolmentStorageSecrets } from "../members/enrolment-payment-proof.js";
import { advanceCourseCapacity, nextCourseSession } from "./course-capacity.js";
import { runCourseJobBatch } from "./course-jobs.js";
import { coursesAcademyId } from "./course-public-http.js";
import { courseCollection, courseData, newCourseJob } from "./course-store.js";
import { publicCourseProjection } from "./course-publication.js";

async function refreshCourseLifecycle(db: Firestore, academyId: string, courseId: string): Promise<void> {
  await db.runTransaction(async tx => {
    const ref = courseCollection(db, academyId, "courses").doc(courseId);
    const course = courseData<Course>(await tx.get(ref));
    if (course.status !== "published") return;
    const now = new Date().toISOString();
    const [next, remaining, location] = await Promise.all([nextCourseSession(db, tx, course, now),
      tx.get(courseCollection(db, academyId, "sessions").where("courseId", "==", courseId).where("coursePublicationRevision", "==", course.publicationRevision).where("status", "==", "scheduled").where("endAt", ">", now).orderBy("endAt").limit(1)),
      tx.get(courseCollection(db, academyId, "locations").doc(course.locationId))]);
    const completed = remaining.empty;
    if (!completed && course.nextSessionAt === (next?.startAt ?? null)) return;
    const updated: Course = {...course, nextSessionAt: next?.startAt ?? null, status: completed ? "completed" : "published", revision: course.revision + 1, updatedAt: now};
    tx.set(ref, updated); tx.set(courseCollection(db, academyId, "publicCourses").doc(courseId), publicCourseProjection(updated, String(location.data()?.name ?? "")));
    if (completed) {const job = newCourseJob(updated, "cancel_course"); tx.create(courseCollection(db, academyId, "courseJobs").doc(job.jobId), job);}
  });
}

/** Cursors rotate through bounded queues, including expired worker leases. */
export const courseScheduler = onSchedule({schedule: "every 1 minutes", timeoutSeconds: 60, memory: "256MiB", maxInstances: 1}, async () => {
  const academyId = coursesAcademyId.value(); if (!academyId) return;
  const db = getFirestore(); const deadline = Date.now() + 40_000;
  const cursorRef = db.doc(`academies/${academyId}/courseWorkerState/scheduler`);
  const cursors = (await cursorRef.get()).data() ?? {};
  let jobCursor = typeof cursors.jobCursor === "string" ? cursors.jobCursor : null;
  let courseCursor = typeof cursors.courseCursor === "string" ? cursors.courseCursor : null;
  let jobQuery = courseCollection(db, academyId, "courseJobs").where("state", "in", ["queued", "running"]).orderBy(FieldPath.documentId());
  if (jobCursor) jobQuery = jobQuery.startAfter(jobCursor);
  const jobPage = await jobQuery.limit(30).get();
  for (const job of jobPage.docs) {
    if (Date.now() > deadline - 15_000) break;
    await runCourseJobBatch(db, academyId, job.id); jobCursor = job.id;
  }
  if (jobPage.empty || (jobPage.size < 30 && jobCursor === jobPage.docs.at(-1)?.id)) jobCursor = null;
  let query = courseCollection(db, academyId, "courses").where("status", "==", "published").orderBy(FieldPath.documentId());
  if (courseCursor) query = query.startAfter(courseCursor);
  const coursePage = await query.limit(30).get();
  for (const course of coursePage.docs) {
    if (Date.now() > deadline - 3_000) break;
    try {await refreshCourseLifecycle(db, academyId, course.id); await advanceCourseCapacity(db, academyId, course.id, undefined, deadline - 2_000);} catch { /* Isolate a malformed course; its records remain intact for office review. */ }
    courseCursor = course.id;
  }
  if (coursePage.empty || (coursePage.size < 30 && courseCursor === coursePage.docs.at(-1)?.id)) courseCursor = null;
  await cursorRef.set({jobCursor, courseCursor, updatedAt: new Date().toISOString()});
});

export async function cleanOrphanCourseProofs(db: Firestore, r2: R2Client, academyId: string, now: string, deadline = Date.now() + 40_000): Promise<{deleted: number; more: boolean}> {
  const cutoff = new Date(Date.parse(now) - 48 * 3_600_000).toISOString();
  const page = await courseCollection(db, academyId, "courseProofs").where("state", "in", ["uploading", "ready", "deleting"]).where("createdAt", "<", cutoff).orderBy("createdAt").limit(20).get();
  let deleted = 0;
  for (const snapshot of page.docs) {
    if (Date.now() > deadline - 3_000) break;
    const proof = await db.runTransaction(async tx => {
      const live = (await tx.get(snapshot.ref)).data() as CourseProof | undefined;
      if (!live || live.state === "attached" || live.attachedAt || live.createdAt >= cutoff) return null;
      const [enrolment, incidents] = await Promise.all([tx.get(courseCollection(db, academyId, "courseEnrolments").doc(live.enrolmentId)), tx.get(courseCollection(db, academyId, "coursePaymentIncidents").where("proofId", "==", live.proofId).limit(1))]);
      if (enrolment.data()?.proofId === live.proofId || !incidents.empty) return null;
      tx.update(snapshot.ref, {state: "deleting"}); return live;
    });
    if (!proof) continue;
    try {
      await r2.deleteObject(proof.objectKey);
      await db.runTransaction(async tx => {const live = await tx.get(snapshot.ref); if (live.data()?.state === "deleting") tx.delete(snapshot.ref);});
      deleted++;
    } catch { /* Keep tombstone for the next scheduled attempt. */ }
  }
  return {deleted, more: page.size === 20 || Date.now() >= deadline - 3_000};
}
export const courseProofCleanup = onSchedule({schedule: "every 60 minutes", timeoutSeconds: 60, memory: "256MiB", maxInstances: 1, secrets: enrolmentStorageSecrets}, async () => {
  const academyId = coursesAcademyId.value(); if (!academyId) return;
  const deadline = Date.now() + 40_000; const db = getFirestore();
  await cleanOrphanCourseProofs(db, createPrivateStorageR2Client(), academyId, new Date().toISOString(), deadline - 3_000);
  if (Date.now() < deadline - 2_000) {
    const expired = await courseCollection(db, academyId, "courseRateLimits").where("expiresAt", "<", new Date().toISOString()).limit(50).get();
    const batch = db.batch(); expired.docs.forEach(doc => batch.delete(doc.ref)); if (!expired.empty) await batch.commit();
  }
});
