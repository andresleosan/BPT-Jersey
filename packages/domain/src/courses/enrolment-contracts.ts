import { z } from "zod";
import { courseIdSchema, courseLabel, courseRecordIdSchema } from "./course-contracts";
export const participantRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({kind: z.literal("student"), studentId: courseRecordIdSchema}),
  z.strictObject({kind: z.literal("candidate"), candidateId: courseIdSchema}),
]);
export type ParticipantRef = z.infer<typeof participantRefSchema>;
export const courseMutationSchema = z.strictObject({requestId: courseIdSchema, enrolmentId: courseIdSchema, expectedRevision: z.number().int().nonnegative()});
export type CourseMutation = z.infer<typeof courseMutationSchema>;
export const reserveCourseSchema = z.strictObject({requestId: courseIdSchema, courseId: courseIdSchema, participant: participantRefSchema, courseRevision: z.number().int().nonnegative(), acceptTerms: z.literal(true)});
export type ReserveCourseInput = z.infer<typeof reserveCourseSchema>;
export const enrolmentStatuses = ["held", "review", "correction", "approved", "withdrawal_requested", "expired", "rejected", "cancelled", "waitlisted", "offered"] as const;
export type EnrolmentStatus = typeof enrolmentStatuses[number];
export type CourseEnrolment = {
  enrolmentId: string; academyId: string; courseId: string; applicantUid: string;
  participant: ParticipantRef; participantKey: string; studentId: string | null;
  status: EnrolmentStatus; revision: number; priceMinor: number; currency: "GBP";
  courseRevision: number; acceptedTerms: string; acceptedAt: string; reference: string;
  proofId: string | null; expiresAt: string | null; submittedAt: string | null;
  approvedAt: string | null; accessFrom: string | null; queuedAt: string | null;
  decisionReason: string | null; createdAt: string; updatedAt: string;
  seatCommitted: boolean; receivedMinor: number; refundedMinor: number; pendingRefundMinor: number;
};
export type CourseCandidate = {
  candidateId: string; academyId: string; applicantUid: string; kind: "adult" | "minor";
  fullName: string; dateOfBirth: string; contactEmail: string; contactPhone: string; applicantName: string;
  trainingCenter: "Town" | "West"; trainingTimePreferences: ("morning" | "afternoon" | "evening")[]; frozen: boolean;
  revision: number; canonicalStudentId: string | null;
};
export const courseCandidateInputSchema = z.strictObject({
  candidateId: courseIdSchema, kind: z.enum(["adult", "minor"]), fullName: courseLabel(160),
  dateOfBirth: z.iso.date(), contactEmail: z.email().max(254),
  contactPhone: courseLabel(64), applicantName: courseLabel(160),
  trainingCenter: z.enum(["Town", "West"]),
  trainingTimePreferences: z.array(z.enum(["morning", "afternoon", "evening"])).min(1).max(3), revision: z.number().int().nonnegative(),
  guardianDeclaration: z.boolean(),
});
export type ParticipantScope = {participant: ParticipantRef; participantKey: string; fullName: string; dateOfBirth: string; studentId: string | null};
export type CoursePaymentIncident = {
  incidentId: string; academyId: string; enrolmentId: string; proofId: string; reference: string;
  reason: "late_payment" | "course_ended" | "course_cancelled" | "duplicate_evidence";
  state: "open" | "resolved"; resolution: string | null; createdAt: string; resolvedAt: string | null;
};
export type CourseProof = {
  proofId: string; academyId: string; enrolmentId: string; applicantUid: string;
  objectKey: string; sha256: string; mime: "image/jpeg" | "image/png"; sizeBytes: number;
  state: "uploading" | "ready" | "attached" | "deleting"; createdAt: string; attachedAt: string | null;
};
export type CourseNoticeDraft = {eventId: string; recipientUid: string; courseId: string; enrolmentId: string | null;
  kind: "offered" | "approved" | "correction" | "rejected" | "expired" | "rescheduled" | "cancelled" | "refund";
  title: string; message: string; href: string; createdAt: string};
export type CourseNotice = CourseNoticeDraft & {noticeId: string; readAt: string | null};
export type CourseJob = {jobId: string; academyId: string; courseId: string;
  kind: "publish" | "project_enrolment" | "revoke_enrolment" | "cancel_course" | "notify_session";
  enrolmentId: string | null; expectedRevision: number; nextOrdinal: number;
  state: "queued" | "running" | "done" | "failed"; leaseUntil: string | null; lastError: string | null;
  recipientCursor: string | null; eventId: string | null; attempts: number; nextAttemptAt: string | null};
export type ApprovalInput = CourseMutation & {acknowledgeDuplicate?: boolean};
export type CourseRefund = {refundId: string; academyId: string; enrolmentId: string;
  amountMinor: number; currency: "GBP"; reason: string; status: "pending" | "recorded" | "cancelled";
  reference: string | null; occurredAt: string | null; createdBy: string; updatedBy: string; revision: number};
export type CourseAccess = {courseId: string; enrolmentId: string; studentId: string; accessFrom: string; revision: number};

export type PaymentSubmission = CourseMutation & {proofId: string; reference: string};
