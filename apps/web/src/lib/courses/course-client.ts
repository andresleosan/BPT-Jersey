import { httpsCallable } from "firebase/functions";
import type { Course, CourseDraft, CourseEnrolment, CourseCandidate, CourseMutation, CourseNotice, CoursePage, CoursePaymentIncident, CourseRefund, CourseJob, ParticipantScope, ReserveCourseInput, PaymentSubmission } from "@bpt-jersey/domain/courses";
import { getFirebaseFunctions } from "../firebase-client";
import type { PreClassView } from "@bpt-jersey/domain/schedule/pre-class";
import type { AttendanceRecord, BookingRecord, SessionRecord } from "@bpt-jersey/domain/schedule";
import type { SelfCheckInInput } from "@bpt-jersey/domain/schedule/self-check-in";
import type { PublicCourseSlot } from "./course-public-client";
const call = <I, O>(name: string) => async (input: I): Promise<O> => (await httpsCallable<I, O>(getFirebaseFunctions(), name, {limitedUseAppCheckTokens: true})(input)).data;
type Page = {cursor?: string};
type Mutation = CourseMutation;
export const courseApi = {
  roster: call<{sessionId: string; cursor?: string}, PreClassView & {cursor: string | null}>("listCourseRoster"),
  calendar: call<{studentId: string; from: string; to: string; cursor?: string}, {sessions: SessionRecord[]; bookings: BookingRecord[]; attendance: AttendanceRecord[]; cursor: string | null}>("getCourseCalendar"),
  absence: call<{requestId: string; sessionId: string; studentId: string; absent: boolean}, BookingRecord>("setCourseAbsence"),
  checkIn: call<SelfCheckInInput, {attendance: AttendanceRecord}>("courseSelfCheckIn"),
  detail: call<{enrolmentId: string}, {enrolment: CourseEnrolment; participant: {fullName: string; dateOfBirth: string}; courseTitle: string; waitlistPosition: number | null}>("getCourseEnrolmentDetail"),
  dates: call<Page & {courseId: string; enrolmentId?: string; draft?: CourseDraft}, CoursePage<PublicCourseSlot>>("listCourseSessionDates"),
  coaches: call<Page, CoursePage<{staffId: string; name: string}>>("listCourseCoaches"),
  session: call<Record<string, never>, {uid: string; role: string; canApply: boolean}>("getCourseSession"),
  courses: call<Page, CoursePage<Course>>("listCourses"),
  course: call<{courseId: string}, Course>("getCourse"),
  save: call<{requestId: string; draft: CourseDraft; courseId: string | null; expectedRevision: number | null}, Course>("saveCourse"),
  publish: call<{courseId: string; expectedRevision: number; requestId: string}, Course>("publishCourse"),
  cancel: call<{courseId: string; expectedRevision: number; requestId: string; reason: string}, Course>("cancelCourse"),
  reviseLocalSession: call<{courseId: string; sessionId: string; expectedRevision: number; requestId: string; reason: string; startLocal: string; endLocal: string; cancel: boolean}, {ok: true}>("reviseCourseLocalSession"),
  reviseSession: call<{courseId: string; sessionId: string; expectedRevision: number; requestId: string; reason: string; startAt: string; endAt: string; cancel: boolean}, {ok: true}>("reviseCourseSession"),
  enrolments: call<Page & {courseId?: string; ownOnly?: boolean; status?: CourseEnrolment["status"]}, CoursePage<CourseEnrolment>>("listCourseEnrolments"),
  enrolment: call<{enrolmentId: string}, CourseEnrolment>("getCourseEnrolment"),
  participants: call<Page, CoursePage<ParticipantScope>>("listCourseParticipants"),
  candidate: call<Omit<CourseCandidate, "academyId" | "applicantUid" | "canonicalStudentId" | "frozen"> & {guardianDeclaration: boolean}, CourseCandidate>("saveCourseCandidate"),
  reserve: call<ReserveCourseInput, CourseEnrolment>("reserveCourse"),
  waitlist: call<ReserveCourseInput, CourseEnrolment>("joinCourseWaitlist"),
  cancelReservation: call<Mutation, CourseEnrolment>("cancelUnapprovedCourseEnrolment"),
  upload: call<Mutation & {base64: string; mime: "image/png" | "image/jpeg"}, {proofId: string}>("uploadCourseProof"),
  submit: call<PaymentSubmission, {enrolment: CourseEnrolment; incident: CoursePaymentIncident | null}>("submitCoursePayment"),
  proof: call<{proofId: string}, {url: string; expiresAt: string}>("getCourseProofUrl"),
  approve: call<Mutation & {acknowledgeDuplicate?: boolean}, CourseEnrolment>("approveCourseEnrolment"),
  review: call<Mutation & {decision: "correction" | "reject"; reason: string}, CourseEnrolment>("reviewCourseEnrolment"),
  withdraw: call<Mutation & {reason: string}, CourseEnrolment>("requestCourseWithdrawal"),
  decideWithdrawal: call<Mutation & {approve: boolean; reason: string}, CourseEnrolment>("decideCourseWithdrawal"),
  bank: call<{enrolmentId: string}, {instructions: {accountName: string; sortCode: string; accountNumber: string; bankName: string; referenceHint: string} | null}>("getCoursePaymentInstructions"),
  notices: call<Page, CoursePage<CourseNotice>>("listCourseNotices"),
  readNotice: call<{noticeId: string}, {ok: true}>("markCourseNoticeRead"),
  refunds: call<Page & {enrolmentId: string}, CoursePage<CourseRefund>>("listCourseRefunds"),
  refund: call<Mutation & {refundId: string; amountMinor: number; status: CourseRefund["status"]; reason: string; reference: string | null; occurredAt: string | null}, CourseRefund>("recordCourseRefund"),
  incidents: call<Page & {enrolmentId?: string; openOnly?: boolean}, CoursePage<CoursePaymentIncident & {participantName?: string; courseTitle?: string}>>("listCoursePaymentIncidents"),
  resolveIncident: call<Mutation & {incidentId: string; received: boolean; reason: string}, CoursePaymentIncident>("resolveCoursePaymentIncident"),
  jobs: call<Page & {state?: "failed" | "queued" | "running"}, CoursePage<CourseJob>>("listCourseJobs"),
  retryJob: call<{jobId: string; requestId: string}, CourseJob>("retryCourseJob"),
};
export function courseError(error: unknown): string {
  const value = error as {code?: string; message?: string};
  if (value.code === "functions/unauthenticated") return "Sign in again to continue.";
  if (value.code === "functions/unavailable" || value.code === "functions/deadline-exceeded") return "The service is temporarily unavailable. Retry the same action.";
  return value.code?.startsWith("functions/") && value.message ? value.message : "This action could not be completed. Refresh and try again.";
}
