import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { courseDraftSchema, courseSlot, type Course, type CourseDraft, type CourseJob } from "@bpt-jersey/domain/courses";
import { assertCourseOffice, assertCourseRevision, courseCollection, courseData, courseFailure, courseOperation, newCourseJob, operationResult, requireCourseSales, saveOperation, type CourseActor } from "./course-store.js";
export async function saveCourse(db: Firestore, actor: CourseActor, draft: CourseDraft, courseId: string | null, expectedRevision: number | null): Promise<Course> {
  assertCourseOffice(actor);
  const parsed = courseDraftSchema.safeParse(draft);
  if (!parsed.success) courseFailure("invalid", parsed.error.issues[0]?.message ?? "Check the course details.");
  const id = courseId ?? randomUUID();
  courseSlot({...parsed.data, courseId: id}, parsed.data.sessionCount);
  const ref = courseCollection(db, actor.academyId, "courses").doc(id);
  return db.runTransaction(async tx => {
    const [existing, location, staff] = await Promise.all([tx.get(ref), tx.get(courseCollection(db, actor.academyId, "locations").doc(parsed.data.locationId)),
      parsed.data.instructor.kind === "staff" ? tx.get(courseCollection(db, actor.academyId, "staff").doc(parsed.data.instructor.staffId)) : Promise.resolve(null)]);
    if (!location.exists || location.data()?.active === false) courseFailure("invalid", "Choose an active location.");
    if (staff && (!staff.exists || staff.data()?.active === false)) courseFailure("invalid", "Choose an active coach.");
    const old = existing.exists ? existing.data() as Course : null;
    if (old) assertCourseRevision(old.revision, expectedRevision ?? -1);
    if (!old && courseId !== null) courseFailure("not_found", "Course not found.");
    if (old && old.status !== "draft") {
      if (old.status !== "published") courseFailure("conflict", "Only active courses can be edited.");
      for (const field of ["startsOn", "startTime", "endTime", "sessionCount", "locationId"] as const)
        if (old[field] !== parsed.data[field]) courseFailure("conflict", "Edit individual sessions or create a new course edition.");
      if (JSON.stringify(old.instructor) !== JSON.stringify(parsed.data.instructor)) courseFailure("conflict", "The published coach cannot be replaced through this form.");
    }
    if (old && parsed.data.capacity < old.committedSeats) courseFailure("full", "Capacity cannot be below committed places.");
    const now = new Date().toISOString();
    const course: Course = {...parsed.data, courseId: id, academyId: actor.academyId, revision: (old?.revision ?? 0) + 1,
      status: old?.status ?? "draft", timezone: "Europe/Jersey", currency: "GBP", committedSeats: old?.committedSeats ?? 0,
      nextSessionAt: old?.nextSessionAt ?? null, publicationRevision: old?.publicationRevision ?? null,
      createdAt: old?.createdAt ?? now, updatedAt: now};
    tx.set(ref, course);
    if (course.status === "published") tx.set(courseCollection(db, actor.academyId, "publicCourses").doc(id), publicCourseProjection(course, String(location.data()?.name ?? "")));
    return course;
  });
}
export function publicCourseProjection(course: Course, locationName: string) {
  return {courseId: course.courseId, revision: course.revision, kind: course.kind, title: course.title,
    description: course.description, techniques: course.techniques, minAge: course.minAge, maxAge: course.maxAge,
    priceMinor: course.priceMinor, currency: course.currency, sessionCount: course.sessionCount,
    nextSessionAt: course.nextSessionAt, cancellationTerms: course.cancellationTerms, timezone: course.timezone,
    instructorName: course.instructor.name, locationName, status: course.status,
    availability: course.status !== "published" || !course.nextSessionAt ? "closed" : course.committedSeats >= course.capacity ? "waitlist" : "available"};
}
export async function publishCourse(db: Firestore, actor: CourseActor, courseId: string, expectedRevision: number, requestId: string): Promise<Course> {
  assertCourseOffice(actor); await requireCourseSales(db, actor.academyId);
  const payload = {courseId, expectedRevision};
  return db.runTransaction(async tx => {
    const ref = courseCollection(db, actor.academyId, "courses").doc(courseId);
    const [snapshot, receipt] = await Promise.all([tx.get(ref), tx.get(courseOperation(db, actor, "publish", requestId))]);
    const replay = operationResult<Course>(receipt, payload); if (replay) return replay;
    const course = courseData<Course>(snapshot); assertCourseRevision(course.revision, expectedRevision);
    if (course.status !== "draft") courseFailure("conflict", "Only a draft can be published.");
    if (Date.parse(courseSlot(course, 1).startAt) <= Date.now()) courseFailure("invalid", "Start the new course in the future.");
    const job = newCourseJob(course, "publish");
    const jobRef = courseCollection(db, actor.academyId, "courseJobs").doc(job.jobId);
    const existingJob = await tx.get(jobRef);
    if (!existingJob.exists) tx.create(jobRef, job);
    saveOperation(tx, db, actor, "publish", requestId, payload, course);
    return course;
  });
}
export async function runCoursePublicationBatch(db: Firestore, job: CourseJob): Promise<boolean> {
  return db.runTransaction(async tx => {
    const ref = courseCollection(db, job.academyId, "courses").doc(job.courseId);
    const jobRef = courseCollection(db, job.academyId, "courseJobs").doc(job.jobId);
    const [snapshot, progress] = await Promise.all([tx.get(ref), tx.get(jobRef)]);
    const course = courseData<Course>(snapshot); const live = courseData<CourseJob>(progress);
    if (live.state === "done") return true;
    if (course.revision !== job.expectedRevision || course.status !== "draft") {tx.update(jobRef, {state: "failed", lastError: "revision_changed"}); return true;}
    const end = Math.min(course.sessionCount, live.nextOrdinal + 89);
    const slots = Array.from({length: end - live.nextOrdinal + 1}, (_, i) => courseSlot(course, live.nextOrdinal + i));
    const refs = slots.map(s => courseCollection(db, job.academyId, "sessions").doc(s.sessionId));
    const existing = refs.length ? await tx.getAll(...refs) : [];
    const location = await tx.get(courseCollection(db, job.academyId, "locations").doc(course.locationId));
    const now = new Date().toISOString();
    slots.forEach((slot, i) => {
      if (existing[i]?.exists && existing[i]?.data()?.coursePublicationRevision === job.expectedRevision) return;
      if (existing[i]?.exists && existing[i]?.data()?.courseId !== course.courseId) courseFailure("conflict", "Session identity is already in use.");
      tx.set(refs[i]!, {...slot, courseOrdinal: slot.ordinal, courseSessionCount: course.sessionCount,
        coursePublicationRevision: job.expectedRevision, academyId: course.academyId,
        classId: null, programId: "seminar", locationId: course.locationId,
        instructorId: course.instructor.kind === "staff" ? course.instructor.staffId : "guest",
        instructorIds: course.instructor.kind === "staff" ? [course.instructor.staffId] : [], instructorName: course.instructor.name,
        title: course.title, description: course.description, capacity: course.capacity, minParticipants: 0,
        status: "scheduled", isSeminar: true, cancellationReason: null, schemaVersion: "1",
        repeatWeekly: false, createdAt: now, createdBy: "course-publication", updatedAt: now, updatedBy: "course-publication"});
    });
    const done = end === course.sessionCount;
    tx.update(jobRef, {nextOrdinal: end + 1, state: done ? "done" : "queued", leaseUntil: null});
    if (done) {
      const published: Course = {...course, status: "published", publicationRevision: job.expectedRevision, nextSessionAt: courseSlot(course, 1).startAt, updatedAt: now};
      tx.set(ref, published); tx.set(courseCollection(db, job.academyId, "publicCourses").doc(course.courseId), publicCourseProjection(published, String(location.data()?.name ?? "")));
    }
    return done;
  });
}
export async function filterPublishedCourseSessions<T extends {courseId?: string; coursePublicationRevision?: number}>(db: Firestore, academyId: string, sessions: T[]): Promise<T[]> {
  const ids = [...new Set(sessions.flatMap(s => s.courseId ? [s.courseId] : []))];
  if (!ids.length) return sessions;
  const courses = new Map<string, Course>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const snapshots = await db.getAll(...ids.slice(offset, offset + 100).map(id => courseCollection(db, academyId, "courses").doc(id)));
    for (const s of snapshots) if (s.exists) courses.set(s.id, s.data() as Course);
  }
  return sessions.filter(s => !s.courseId || (courses.has(s.courseId) && courses.get(s.courseId)?.status !== "draft" && courses.get(s.courseId)?.publicationRevision === s.coursePublicationRevision));
}

export async function reviseCourseSession(db: Firestore, actor: CourseActor, courseId: string, sessionId: string,
  startAt: string, endAt: string, expectedRevision: number, reason: string, requestId: string, cancel = false): Promise<void> {
  assertCourseOffice(actor);
  if (!reason.trim() || reason.length > 500 || !Number.isFinite(Date.parse(startAt)) || Date.parse(endAt) <= Date.parse(startAt)) courseFailure("invalid", "Give a reason and a valid start and finish.");
  const payload = {courseId, sessionId, startAt, endAt, expectedRevision, reason, cancel};
  await db.runTransaction(async tx => {
    const courseRef = courseCollection(db, actor.academyId, "courses").doc(courseId);
    const sessionRef = courseCollection(db, actor.academyId, "sessions").doc(sessionId);
    const [cs, ss, receipt, futures] = await Promise.all([tx.get(courseRef), tx.get(sessionRef), tx.get(courseOperation(db, actor, "session", requestId)),
      tx.get(courseCollection(db, actor.academyId, "sessions").where("courseId", "==", courseId).where("startAt", ">", new Date().toISOString()).orderBy("startAt").limit(2))]);
    if (operationResult<boolean>(receipt, payload)) return;
    const course = courseData<Course>(cs); const session = courseData<Record<string, unknown>>(ss);
    assertCourseRevision(course.revision, expectedRevision);
    if (course.status !== "published" || session.courseId !== courseId || session.coursePublicationRevision !== course.publicationRevision) courseFailure("conflict", "Choose a published course session.");
    if (Date.parse(String(session.startAt)) <= Date.now()) courseFailure("conflict", "Past sessions keep their history.");
    if (!cancel && Date.parse(startAt) <= Date.now()) courseFailure("invalid", "Choose a future date.");
    const location = await tx.get(courseCollection(db, actor.academyId, "locations").doc(course.locationId));
    const now = new Date().toISOString();
    const candidates = futures.docs.filter(d => d.id !== sessionId && d.data().status !== "cancelled").map(d => String(d.data().startAt));
    if (!cancel) candidates.push(startAt);
    const next: Course = {...course, revision: course.revision + 1, nextSessionAt: candidates.sort()[0] ?? null, updatedAt: now};
    tx.update(sessionRef, {startAt, endAt, status: cancel ? "cancelled" : "scheduled", cancellationReason: cancel ? reason : null, updatedAt: now, updatedBy: actor.uid});
    tx.set(courseRef, next); tx.set(courseCollection(db, actor.academyId, "publicCourses").doc(courseId), publicCourseProjection(next, String(location.data()?.name ?? "")));
    const job = newCourseJob(next, "notify_session");
    tx.set(courseCollection(db, actor.academyId, "courseJobs").doc(job.jobId), {...job, eventId: requestId, sessionId, message: reason});
    saveOperation(tx, db, actor, "session", requestId, payload, true);
  });
}
