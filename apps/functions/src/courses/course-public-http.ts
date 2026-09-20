import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { defineString } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { courseIdSchema, type PublicCourse } from "@bpt-jersey/domain/courses";
import { z } from "zod";
import { browserOrigins } from "../auth/callable-options.js";
import { courseCollection } from "./course-store.js";
import { courseCursorSchema } from "./course-queries.js";
export const coursesAcademyId = defineString("COURSES_ACADEMY_ID", {default: ""});
const inputSchema = z.strictObject({view: z.enum(["list", "detail", "sessions"]), courseId: courseIdSchema.optional(), cursor: courseCursorSchema.optional()});
/** Explicit allowlist: private course/enrolment fields can never enter this DTO. */
function publicView(data: Record<string, unknown>): PublicCourse {
  return {courseId: String(data.courseId), revision: Number(data.revision), kind: data.kind as PublicCourse["kind"], title: String(data.title), description: String(data.description), techniques: Array.isArray(data.techniques) ? data.techniques.map(String) : [], minAge: Number(data.minAge), maxAge: data.maxAge === null ? null : Number(data.maxAge), priceMinor: Number(data.priceMinor), currency: "GBP", sessionCount: Number(data.sessionCount), nextSessionAt: typeof data.nextSessionAt === "string" ? data.nextSessionAt : null, cancellationTerms: String(data.cancellationTerms), timezone: "Europe/Jersey", instructorName: String(data.instructorName), locationName: String(data.locationName), status: data.status as PublicCourse["status"], availability: data.status !== "published" || typeof data.nextSessionAt !== "string" || data.nextSessionAt <= new Date().toISOString() ? "closed" : data.availability === "available" ? "available" : "waitlist"};
}
export const coursePublic = onRequest({cors: browserOrigins, invoker: "public", timeoutSeconds: 15, memory: "256MiB"}, async (request, response) => {
  response.set("X-Content-Type-Options", "nosniff");
  response.set("Cache-Control", "no-store");
  if (request.method !== "GET") {response.set("Allow", "GET"); response.status(405).json({error: "method_not_allowed"}); return;}
  const input = inputSchema.safeParse(request.query);
  const academyId = coursesAcademyId.value();
  if (!input.success || request.originalUrl.length > 1500 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(academyId)) {response.status(400).json({error: "invalid_request"}); return;}
  try {
    const db = getFirestore();
    const flags = await db.doc(`academies/${academyId}/settings/courseFeatures`).get();
    if (flags.data()?.coursesEnabled !== true) {response.status(404).json({error: "unavailable"}); return;}
    const {view, courseId, cursor} = input.data;
    let body: unknown;
    if (view === "list") {
      let query = courseCollection(db, academyId, "publicCourses").where("status", "==", "published").where("nextSessionAt", ">", new Date().toISOString()).orderBy("nextSessionAt").orderBy("courseId");
      if (cursor) {
        const anchor = await courseCollection(db, academyId, "publicCourses").doc(cursor).get();
        if (!anchor.exists || anchor.data()?.status !== "published") {response.status(400).json({error: "refresh_catalogue"}); return;}
        query = query.startAfter(anchor.data()!.nextSessionAt, anchor.id);
      }
      const snapshot = await query.limit(31).get();
      const docs = snapshot.docs.slice(0, 30);
      body = {items: docs.map(d => publicView(d.data())), cursor: snapshot.size > 30 ? docs[29]!.id : null};
    } else {
      if (!courseId) {response.status(400).json({error: "course_required"}); return;}
      const [projection, course] = await Promise.all([courseCollection(db, academyId, "publicCourses").doc(courseId).get(), courseCollection(db, academyId, "courses").doc(courseId).get()]);
      if (!projection.exists || !course.exists || !["published", "completed"].includes(String(course.data()?.status))) {response.status(404).json({error: "not_found"}); return;}
      if (view === "detail") body = publicView(projection.data()!);
      else {
        let query = courseCollection(db, academyId, "sessions").where("courseId", "==", courseId).where("coursePublicationRevision", "==", course.data()?.publicationRevision).orderBy("courseOrdinal");
        if (cursor) {
          const ordinal = Number(cursor);
          if (!Number.isSafeInteger(ordinal) || ordinal < 1) {response.status(400).json({error: "invalid_cursor"}); return;}
          query = query.startAfter(ordinal);
        }
        const snapshot = await query.limit(31).get(); const docs = snapshot.docs.slice(0, 30);
        body = {items: docs.map(d => ({sessionId: d.id, courseId, ordinal: d.data().courseOrdinal, startAt: d.data().startAt, endAt: d.data().endAt, status: d.data().status})), cursor: snapshot.size > 30 ? String(docs[29]!.data().courseOrdinal) : null};
      }
    }
    const serialized = JSON.stringify(body);
    const etag = `"${createHash("sha256").update(serialized).digest("hex")}"`;
    response.set("Cache-Control", "public, max-age=0, must-revalidate"); response.set("ETag", etag);
    if (request.headers["if-none-match"] === etag) {response.status(304).end(); return;}
    response.type("application/json").status(200).send(serialized);
  } catch {response.set("Cache-Control", "no-store"); response.status(503).json({error: "temporarily_unavailable"});}
});
