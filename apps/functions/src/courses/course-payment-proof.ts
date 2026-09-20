import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import type { Firestore } from "firebase-admin/firestore";
import { courseIdSchema, courseLabel, courseMutationSchema, type Course, type CourseEnrolment, type CourseMutation, type CoursePaymentIncident, type CourseProof, type PaymentSubmission } from "@bpt-jersey/domain/courses";
import type { R2Client } from "../storage/r2-client.js";
import { assertCourseActorLive, assertCourseRevision, courseCollection, courseData, courseFailure, courseHash, courseOperation, operationResult, saveOperation, type CourseActor } from "./course-store.js";
import { readCourseRateLimit } from "./course-rate-limits.js";
import { nextCourseSession, writeCourseSeats } from "./course-capacity.js";

const maxBytes = 2 * 1024 * 1024;
const uploadSchema = courseMutationSchema.extend({base64: z.string().min(4).max(4 * Math.ceil(maxBytes / 3)).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u), mime: z.enum(["image/jpeg", "image/png"])});
const submissionSchema = courseMutationSchema.extend({proofId: courseIdSchema, reference: courseLabel(160)});
function assertProofApplicant(actor: CourseActor, enrolment: CourseEnrolment): void {
  if (enrolment.applicantUid !== actor.uid || enrolment.academyId !== actor.academyId) courseFailure("forbidden", "This enrolment is not available to your account.");
}
function acceptsEvidence(enrolment: CourseEnrolment): boolean {
  return ["held", "offered", "correction", "expired", "rejected", "cancelled"].includes(enrolment.status) && enrolment.receivedMinor === 0;
}
async function normalizeProof(base64: string, mime: "image/jpeg" | "image/png"): Promise<Buffer> {
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > maxBytes || bytes.toString("base64") !== base64) courseFailure("invalid", "Choose a PNG or JPEG screenshot no larger than 2 MiB.");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/png" ? !png : !jpeg) courseFailure("invalid", "The screenshot format does not match the file.");
  try {
    const image = sharp(bytes, {limitInputPixels: 20_000_000, failOn: "warning", animated: false});
    const metadata = await image.metadata();
    if (metadata.format !== (mime === "image/png" ? "png" : "jpeg") || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height || metadata.width * metadata.height > 20_000_000) courseFailure("invalid", "Choose a single PNG or JPEG image under 20 megapixels.");
    const output = await image.rotate().flatten({background: "#ffffff"}).jpeg({quality: 85}).toBuffer();
    if (output.length > maxBytes) courseFailure("invalid", "The processed screenshot is too large. Choose a smaller image.");
    return output;
  } catch {
    courseFailure("invalid", "The screenshot could not be processed. Choose a smaller, valid PNG or JPEG image.");
  }
}

export async function uploadCourseProof(db: Firestore, r2: R2Client, actor: CourseActor, value: CourseMutation & {base64: string; mime: "image/jpeg" | "image/png"}): Promise<{proofId: string}> {
  const input = uploadSchema.parse(value);
  const payload = {enrolmentId: input.enrolmentId, expectedRevision: input.expectedRevision, mime: input.mime, contentHash: courseHash(input.base64)};
  const proofId = randomUUID();
  const reservation = await db.runTransaction(async tx => {
    await assertCourseActorLive(db, tx, actor);
    const [snapshot, receipt] = await Promise.all([tx.get(courseCollection(db, actor.academyId, "courseEnrolments").doc(input.enrolmentId)), tx.get(courseOperation(db, actor, "upload-proof", input.requestId))]);
    const enrolment = courseData<CourseEnrolment>(snapshot); assertProofApplicant(actor, enrolment);
    const replay = operationResult<{proofId: string}>(receipt, payload);
    if (replay) return replay;
    assertCourseRevision(enrolment.revision, input.expectedRevision);
    if (!acceptsEvidence(enrolment)) courseFailure("conflict", "This enrolment cannot receive a new screenshot.");
    const now = new Date().toISOString();
    const consume = await readCourseRateLimit(db, tx, actor.academyId, actor.uid, "upload", Date.parse(now));
    const proof: CourseProof = {proofId, academyId: actor.academyId, enrolmentId: enrolment.enrolmentId, applicantUid: actor.uid, objectKey: `academies/${actor.academyId}/course-proofs/${enrolment.enrolmentId}/${proofId}.jpg`, sha256: "", mime: "image/jpeg", sizeBytes: 0, state: "uploading", createdAt: now, attachedAt: null};
    consume(); tx.create(courseCollection(db, actor.academyId, "courseProofs").doc(proofId), proof);
    saveOperation(tx, db, actor, "upload-proof", input.requestId, payload, {proofId});
    return {proofId};
  });
  const ref = courseCollection(db, actor.academyId, "courseProofs").doc(reservation.proofId);
  const proof = courseData<CourseProof>(await ref.get());
  if (proof.state === "ready" || proof.state === "attached") return reservation;
  if (proof.state !== "uploading" || Date.now() - Date.parse(proof.createdAt) > 47 * 3_600_000) courseFailure("expired", "Start a new screenshot upload.");
  const output = await normalizeProof(input.base64, input.mime);
  await r2.putObject(proof.objectKey, output, "image/jpeg");
  await db.runTransaction(async tx => {
    await assertCourseActorLive(db, tx, actor);
    const live = courseData<CourseProof>(await tx.get(ref));
    if (live.state === "ready" || live.state === "attached") return;
    if (live.state !== "uploading") courseFailure("conflict", "Start a new screenshot upload.");
    tx.update(ref, {state: "ready", sha256: createHash("sha256").update(output).digest("hex"), sizeBytes: output.length});
  });
  return reservation;
}

export async function submitCoursePayment(db: Firestore, actor: CourseActor, value: PaymentSubmission): Promise<{enrolment: CourseEnrolment; incident: CoursePaymentIncident | null}> {
  const input = submissionSchema.parse(value);
  return db.runTransaction(async tx => {
    await assertCourseActorLive(db, tx, actor);
    const ref = courseCollection(db, actor.academyId, "courseEnrolments").doc(input.enrolmentId);
    const [snapshot, receipt, proofSnapshot] = await Promise.all([tx.get(ref), tx.get(courseOperation(db, actor, "submit-payment", input.requestId)), tx.get(courseCollection(db, actor.academyId, "courseProofs").doc(input.proofId))]);
    const enrolment = courseData<CourseEnrolment>(snapshot); assertProofApplicant(actor, enrolment);
    const replay = operationResult<{enrolment: CourseEnrolment; incident: CoursePaymentIncident | null}>(receipt, input); if (replay) return replay;
    assertCourseRevision(enrolment.revision, input.expectedRevision);
    if (!acceptsEvidence(enrolment)) courseFailure("conflict", "This payment is already under review or the enrolment cannot receive payment.");
    const proof = courseData<CourseProof>(proofSnapshot);
    if (proof.enrolmentId !== enrolment.enrolmentId || proof.applicantUid !== actor.uid || proof.state !== "ready" || proof.academyId !== actor.academyId) courseFailure("forbidden", "Choose a completed screenshot upload for this enrolment.");
    const course = courseData<Course>(await tx.get(courseCollection(db, actor.academyId, "courses").doc(enrolment.courseId)));
    const now = new Date().toISOString();
    const next = await nextCourseSession(db, tx, course, now);
    const consume = await readCourseRateLimit(db, tx, actor.academyId, enrolment.enrolmentId, "submit", Date.parse(now));
    const hasPlace = course.status === "published" && next !== null && enrolment.seatCommitted && enrolment.expiresAt !== null && enrolment.expiresAt > now && ["held", "offered", "correction"].includes(enrolment.status);
    const incident: CoursePaymentIncident | null = hasPlace ? null : {incidentId: input.proofId, academyId: actor.academyId, enrolmentId: enrolment.enrolmentId, proofId: proof.proofId, reference: input.reference, reason: course.status === "cancelled" ? "course_cancelled" : !next ? "course_ended" : "late_payment", state: "open", resolution: null, createdAt: now, resolvedAt: null};
    const updated: CourseEnrolment = {...enrolment, status: hasPlace ? "review" : ["held", "offered", "correction"].includes(enrolment.status) ? "expired" : enrolment.status, seatCommitted: hasPlace, expiresAt: null, proofId: proof.proofId, reference: input.reference, submittedAt: now, updatedAt: now, revision: enrolment.revision + 1};
    consume();
    tx.set(ref, updated);
    tx.update(proofSnapshot.ref, {state: "attached", attachedAt: now});
    if (incident) tx.create(courseCollection(db, actor.academyId, "coursePaymentIncidents").doc(incident.incidentId), incident);
    if (enrolment.seatCommitted && !hasPlace) writeCourseSeats(db, tx, course, -1, now);
    // These indexes are private and append-only. Approval checks for other enrolments.
    for (const key of [courseHash("image", proof.sha256), courseHash("reference", input.reference.normalize("NFKC").trim().toUpperCase())]) {
      tx.set(courseCollection(db, actor.academyId, "courseEvidenceKeys").doc(`${key}_${proof.proofId}`), {key, enrolmentId: enrolment.enrolmentId, proofId: proof.proofId});
    }
    saveOperation(tx, db, actor, "submit-payment", input.requestId, input, {enrolment: updated, incident});
    return {enrolment: updated, incident};
  });
}

export async function getCourseProofUrl(db: Firestore, r2: R2Client, actor: CourseActor, proofId: string): Promise<{url: string; expiresAt: string}> {
  const id = courseIdSchema.parse(proofId);
  const proof = courseData<CourseProof>(await courseCollection(db, actor.academyId, "courseProofs").doc(id).get());
  const enrolment = courseData<CourseEnrolment>(await courseCollection(db, actor.academyId, "courseEnrolments").doc(proof.enrolmentId).get());
  if (actor.uid !== enrolment.applicantUid && !["owner", "administrator"].includes(actor.role)) courseFailure("forbidden", "This screenshot is private.");
  if (proof.academyId !== actor.academyId || proof.applicantUid !== enrolment.applicantUid || !["ready", "attached"].includes(proof.state)) courseFailure("not_found", "This screenshot is not available.");
  if (!r2.createPrivateImageUrl) courseFailure("unavailable", "Private screenshot viewing is not configured.");
  return {url: await r2.createPrivateImageUrl({objectKey: proof.objectKey, contentType: proof.mime, expiresInSeconds: 60}), expiresAt: new Date(Date.now() + 60_000).toISOString()};
}
