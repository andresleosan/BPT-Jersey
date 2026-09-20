import { getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { checkedCourseInstant, courseCandidateInputSchema, courseDraftSchema, courseIdSchema, courseLabel, courseMutationSchema, courseRecordIdSchema, reserveCourseSchema } from "@bpt-jersey/domain/courses";
import { parseSelfCheckInInput } from "@bpt-jersey/domain/schedule/self-check-in";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { enrolmentStorageSecrets } from "../members/enrolment-payment-proof.js";
import { createPrivateStorageR2Client } from "../storage/r2-client.js";
import { createTransactionalAttendanceService, SelfCheckInRefusedError, type AttendanceFirestore } from "../schedule/attendance-transaction-service.js";
import { requireCourseActor, requireCourseOffice } from "./course-authorization.js";
import type { CourseActor } from "./course-store.js";
import * as publication from "./course-publication.js";
import * as participants from "./course-participants.js";
import * as enrolments from "./course-enrolments.js";
import * as proof from "./course-payment-proof.js";
import * as approval from "./course-approval.js";
import * as finance from "./course-finance.js";
import * as queries from "./course-queries.js";
import * as access from "./course-access.js";
import * as jobs from "./course-jobs.js";
import { exportCourseSubjectData } from "./course-privacy.js";
import { getCourseRoster } from "./course-roster.js";
import { getCourseCalendarPage } from "./course-calendar.js";
const identitySecret = defineSecret("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET");
const integritySecret = defineSecret("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET");
const identitySecrets = [identitySecret, integritySecret];
const dependencies = () => ({projectId: getApp().options.projectId ?? "", identitySecretMaterial: identitySecret.value(), integritySecretMaterial: integritySecret.value()});
function callable<T>(schema: z.ZodType<T>, office: boolean, run: (actor: CourseActor, value: T) => Promise<unknown>, secrets = identitySecrets, upload = false) {
  return onCall({...browserAdminCallableOptions, secrets, ...(upload ? {memory: "512MiB" as const, concurrency: 1, timeoutSeconds: 30} : {})}, async request => {
    const actor = await (office ? requireCourseOffice(request) : requireCourseActor(request));
    const input = schema.safeParse(request.data);
    if (!input.success) throw new HttpsError("invalid-argument", "Check the request details.");
    try {return await run(actor, input.data);} catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error instanceof SelfCheckInRefusedError) throw new HttpsError("failed-precondition", "Self check-in is not available right now", {reason: error.reason, ...(error.distanceMeters === undefined ? {} : {distanceMeters: error.distanceMeters})});
      if (error instanceof z.ZodError) throw new HttpsError("invalid-argument", "Check the request details.");
      throw new HttpsError("failed-precondition", "The operation could not be completed. Refresh the record or contact the office.");
    }
  });
}
const page = z.strictObject({cursor: queries.courseCursorSchema.optional()});
const enrolmentPage = page.extend({enrolmentId: courseIdSchema});
export const getCourseSession = callable(z.strictObject({}), false, async actor => ({uid: actor.uid, role: actor.role, canApply: actor.role !== "teenStudent"}), []);
export const saveCourse = callable(z.strictObject({requestId: courseIdSchema, draft: courseDraftSchema, courseId: courseIdSchema.nullable(), expectedRevision: z.number().int().nonnegative().nullable()}), true, (actor, i) => publication.saveCourse(getFirestore(), actor, i.draft, i.courseId, i.expectedRevision, i.requestId), []);
export const publishCourse = callable(z.strictObject({courseId: courseIdSchema, expectedRevision: z.number().int().nonnegative(), requestId: courseIdSchema}), true, (actor, i) => publication.publishCourse(getFirestore(), actor, i.courseId, i.expectedRevision, i.requestId), []);
export const reviseCourseSession = callable(z.strictObject({courseId: courseIdSchema, sessionId: courseRecordIdSchema, startAt: z.iso.datetime(), endAt: z.iso.datetime(), expectedRevision: z.number().int().nonnegative(), reason: courseLabel(500), requestId: courseIdSchema, cancel: z.boolean()}), true, async (actor, i) => {await publication.reviseCourseSession(getFirestore(), actor, i.courseId, i.sessionId, i.startAt, i.endAt, i.expectedRevision, i.reason, i.requestId, i.cancel); return {ok: true};}, []);
export const saveCourseCandidate = callable(courseCandidateInputSchema, false, (actor, i) => participants.saveCourseCandidate(getFirestore(), actor, i, identitySecret.value()));
export const reserveCourse = callable(reserveCourseSchema, false, (actor, i) => enrolments.reserveCourse(getFirestore(), actor, i), []);
export const joinCourseWaitlist = callable(reserveCourseSchema, false, (actor, i) => enrolments.joinCourseWaitlist(getFirestore(), actor, i), []);
export const cancelUnapprovedCourseEnrolment = callable(courseMutationSchema, false, (actor, i) => enrolments.cancelUnapprovedCourseEnrolment(getFirestore(), actor, i), []);
export const uploadCourseProof = callable(courseMutationSchema.extend({base64: z.string().max(4 * Math.ceil(2097152 / 3)), mime: z.enum(["image/png", "image/jpeg"])}), false, (actor, i) => proof.uploadCourseProof(getFirestore(), createPrivateStorageR2Client(), actor, i), enrolmentStorageSecrets, true);
export const submitCoursePayment = callable(courseMutationSchema.extend({proofId: courseIdSchema, reference: courseLabel(160)}), false, (actor, i) => proof.submitCoursePayment(getFirestore(), actor, i), []);
export const getCourseProofUrl = callable(z.strictObject({proofId: courseIdSchema}), false, (actor, i) => proof.getCourseProofUrl(getFirestore(), createPrivateStorageR2Client(), actor, i.proofId), enrolmentStorageSecrets);
export const approveCourseEnrolment = callable(courseMutationSchema.extend({acknowledgeDuplicate: z.boolean().optional()}), true, (actor, i) => approval.approveCourseEnrolment(getFirestore(), actor, i, dependencies()));
export const reviewCourseEnrolment = callable(courseMutationSchema.extend({decision: z.enum(["correction", "reject"]), reason: courseLabel(1000)}), true, (actor, i) => approval.reviewCourseEnrolment(getFirestore(), actor, i), []);
export const requestCourseWithdrawal = callable(courseMutationSchema.extend({reason: courseLabel(1000)}), false, (actor, i) => approval.requestCourseWithdrawal(getFirestore(), actor, i), []);
export const decideCourseWithdrawal = callable(courseMutationSchema.extend({approve: z.boolean(), reason: courseLabel(1000)}), true, (actor, i) => approval.decideCourseWithdrawal(getFirestore(), actor, i), []);
export const recordCourseRefund = callable(courseMutationSchema.extend({refundId: courseIdSchema, amountMinor: z.number().int().positive(), reason: courseLabel(1000), status: z.enum(["pending", "recorded", "cancelled"]), reference: courseLabel(160).nullable(), occurredAt: z.iso.datetime().nullable()}), true, (actor, i) => finance.recordCourseRefund(getFirestore(), actor, i), []);
export const resolveCoursePaymentIncident = callable(courseMutationSchema.extend({incidentId: courseIdSchema, received: z.boolean(), reason: courseLabel(1000)}), true, (actor, i) => finance.resolveCoursePaymentIncident(getFirestore(), actor, i, dependencies()));
export const listCourses = callable(page, true, (actor, i) => queries.listCourses(getFirestore(), actor, i.cursor), []);
export const getCourse = callable(z.strictObject({courseId: courseIdSchema}), true, (actor, i) => queries.getCourse(getFirestore(), actor, i.courseId), []);
export const listCourseEnrolments = callable(queries.courseListFilterSchema, false, (actor, i) => queries.listCourseEnrolments(getFirestore(), actor, i), []);
export const getCourseEnrolment = callable(z.strictObject({enrolmentId: courseIdSchema}), false, (actor, i) => queries.getCourseEnrolment(getFirestore(), actor, i.enrolmentId), []);
export const listCourseParticipants = callable(page, false, (actor, i) => queries.listCourseParticipants(getFirestore(), actor, i.cursor), []);
export const getCoursePaymentInstructions = callable(z.strictObject({enrolmentId: courseIdSchema}), false, (actor, i) => queries.getCoursePaymentInstructions(getFirestore(), actor, i.enrolmentId), []);
export const listCourseNotices = callable(page, false, (actor, i) => queries.listCourseNotices(getFirestore(), actor, i.cursor), []);
export const markCourseNoticeRead = callable(z.strictObject({noticeId: z.string().regex(/^[a-f0-9]{64}$/u)}), false, async (actor, i) => {await queries.markCourseNoticeRead(getFirestore(), actor, i.noticeId); return {ok: true};}, []);
export const listCourseRefunds = callable(enrolmentPage, false, (actor, i) => queries.listCourseRefunds(getFirestore(), actor, i.enrolmentId, i.cursor), []);
export const listCoursePaymentIncidents = callable(page.extend({enrolmentId: courseIdSchema.optional(), openOnly: z.boolean().optional()}), false, (actor, i) => queries.listCoursePaymentIncidents(getFirestore(), actor, i), []);
export const setCourseAbsence = callable(z.strictObject({requestId: courseIdSchema, sessionId: courseRecordIdSchema, studentId: courseRecordIdSchema, absent: z.boolean()}), false, (actor, i) => access.setCourseAbsence(getFirestore(), actor, i), []);
export const courseSelfCheckIn = callable(z.unknown(), false, async (actor, value) => {
  const input = parseSelfCheckInInput(value);
  if (!input.ok) throw new HttpsError("invalid-argument", "Check-in details are invalid.");
  const db = getFirestore();
  await participants.resolveCourseParticipant(db, actor, {kind: "student", studentId: input.value.studentId});
  await access.ensureCourseBooking(db, actor, input.value.sessionId, input.value.studentId);
  const service = createTransactionalAttendanceService({firestore: db as unknown as AttendanceFirestore});
  return {attendance: await service.recordSelfCheckIn({academyId: actor.academyId, actorId: actor.uid, actorRole: actor.role as Parameters<typeof service.recordSelfCheckIn>[0]["actorRole"], input: input.value})};
}, []);

export const cancelCourse = callable(z.strictObject({courseId: courseIdSchema, expectedRevision: z.number().int().nonnegative(), requestId: courseIdSchema, reason: courseLabel(1000)}), true, (actor, i) => jobs.cancelCourse(getFirestore(), actor, i), []);
export const retryCourseJob = callable(z.strictObject({jobId: z.string().max(256).regex(/^[A-Za-z0-9_-]+$/u), requestId: courseIdSchema}), true, (actor, i) => jobs.retryCourseJob(getFirestore(), actor, i.jobId, i.requestId), []);
export const listCourseJobs = callable(page.extend({state: z.enum(["failed", "queued", "running"]).optional()}), true, (actor, i) => queries.coursePage(getFirestore().collection(`academies/${actor.academyId}/courseJobs`).where("state", "==", i.state ?? "failed"), i.cursor), []);
export const getCourseEnrolmentDetail = callable(z.strictObject({enrolmentId: courseIdSchema}), false, (actor, i) => queries.getCourseEnrolmentDetail(getFirestore(), actor, i.enrolmentId), []);
export const listCourseSessionDates = callable(page.extend({courseId: courseIdSchema, enrolmentId: courseIdSchema.optional(), draft: courseDraftSchema.optional()}), false, (actor, i) => queries.listCourseSessionDates(getFirestore(), actor, i), []);
export const listCourseCoaches = callable(page, true, (actor, i) => queries.courseCoachOptions(getFirestore(), actor, i.cursor), []);

export const reviseCourseLocalSession = callable(z.strictObject({courseId: courseIdSchema, sessionId: courseRecordIdSchema, expectedRevision: z.number().int().nonnegative(), requestId: courseIdSchema, reason: courseLabel(500), startLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u), endLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u), cancel: z.boolean()}), true, async (actor, i) => {
  if (i.startLocal.slice(0,10) !== i.endLocal.slice(0,10)) throw new HttpsError("invalid-argument", "A session must start and finish on the same local date.");
  const startAt = checkedCourseInstant(i.startLocal.slice(0,10), i.startLocal.slice(11));
  const endAt = checkedCourseInstant(i.endLocal.slice(0,10), i.endLocal.slice(11));
  await publication.reviseCourseSession(getFirestore(), actor, i.courseId, i.sessionId, startAt, endAt, i.expectedRevision, i.reason, i.requestId, i.cancel); return {ok: true};
}, []);

export const getCourseCalendar = callable(z.strictObject({studentId: courseRecordIdSchema, from: z.iso.datetime(), to: z.iso.datetime(), cursor: z.string().max(512).regex(/^[A-Za-z0-9_-]+$/u).optional()}), false, (actor, i) => getCourseCalendarPage(getFirestore(), actor, i), []);

export const listCourseRoster = callable(page.extend({sessionId: courseRecordIdSchema}), false, (actor, i) => getCourseRoster(getFirestore(), actor, i.sessionId, i.cursor), []);

export const exportCourseSubject = callable(page.extend({subjectUid: courseRecordIdSchema, studentId: courseRecordIdSchema.optional()}), true, (actor, i) => exportCourseSubjectData(getFirestore(), actor, i.subjectUid, i.cursor, i.studentId), []);
