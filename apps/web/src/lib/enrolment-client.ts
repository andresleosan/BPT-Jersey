import { httpsCallable } from "firebase/functions";

import type {
  EnrolmentRequestClientView,
  EnrolmentRequestDetail,
  EnrolmentRequestRow,
  EnrolmentRequestStatus,
  EnrolmentRequestSubmission,
} from "@bpt-jersey/domain/members/enrolment-requests";
import { enrolmentRequestStatuses } from "@bpt-jersey/domain/members/enrolment-requests";

import { getFirebaseFunctions } from "./firebase-client";

const submitError = "Unable to send your request. Please try again.";
const loadError = "Unable to load your request. Please try again.";
const withdrawError = "Unable to withdraw your request. Please try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function view(value: unknown, message: string): EnrolmentRequestClientView {
  if (!isRecord(value)) throw new Error(message);
  const { enrolmentRequestId, status, submittedAt, reviewNote } = value;
  if (
    typeof enrolmentRequestId !== "string" ||
    typeof status !== "string" ||
    !(enrolmentRequestStatuses as readonly string[]).includes(status) ||
    typeof submittedAt !== "string" ||
    (reviewNote !== undefined && typeof reviewNote !== "string")
  ) {
    throw new Error(message);
  }
  return Object.freeze({
    enrolmentRequestId,
    status: status as EnrolmentRequestStatus,
    submittedAt,
    ...(reviewNote === undefined ? {} : { reviewNote }),
  });
}

/**
 * The academy answers a rejected submission with a sentence the applicant needs to read - "you
 * already have a request waiting" - so a failed precondition keeps its message. Every other failure
 * collapses to a safe one.
 */
function submissionError(error: unknown): Error {
  const code =
    isRecord(error) && typeof error.code === "string" ? error.code : "";
  const message =
    isRecord(error) && typeof error.message === "string" ? error.message : "";
  if (code.endsWith("failed-precondition") && message) return new Error(message);
  return new Error(submitError);
}

export function createEnrolmentRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export async function submitEnrolmentRequest(
  submission: EnrolmentRequestSubmission,
): Promise<EnrolmentRequestClientView> {
  try {
    const callable = httpsCallable<EnrolmentRequestSubmission, unknown>(
      getFirebaseFunctions(),
      "submitEnrolmentRequest",
    );
    return view((await callable(submission)).data, submitError);
  } catch (error) {
    throw submissionError(error);
  }
}

export async function listMyEnrolmentRequests(): Promise<readonly EnrolmentRequestClientView[]> {
  try {
    const callable = httpsCallable<null, unknown>(
      getFirebaseFunctions(),
      "listMyEnrolmentRequests",
    );
    const data = (await callable(null)).data;
    if (!Array.isArray(data)) throw new Error(loadError);
    return Object.freeze(data.map((item) => view(item, loadError)));
  } catch {
    throw new Error(loadError);
  }
}

export async function withdrawEnrolmentRequest(
  enrolmentRequestId: string,
): Promise<EnrolmentRequestClientView> {
  try {
    const callable = httpsCallable<{ enrolmentRequestId: string }, unknown>(
      getFirebaseFunctions(),
      "withdrawEnrolmentRequest",
    );
    return view((await callable({ enrolmentRequestId })).data, withdrawError);
  } catch {
    throw new Error(withdrawError);
  }
}

const queueError = "Unable to load enrolment requests.";
const reviewError = "Unable to update the request.";

/**
 * The office queue. It carries a name, a centre and a status by design: the applicant's date of
 * birth, address and emergency contact are Confidential and are never listed here.
 */
function row(value: unknown, message: string): EnrolmentRequestRow {
  if (!isRecord(value)) throw new Error(message);
  const {
    enrolmentRequestId,
    applicantName,
    applicantIsStudent,
    minorCount,
    trainingCenter,
    status,
    submittedAt,
    reviewedAt,
  } = value;
  if (
    typeof enrolmentRequestId !== "string" ||
    typeof applicantName !== "string" ||
    typeof applicantIsStudent !== "boolean" ||
    typeof minorCount !== "number" ||
    typeof trainingCenter !== "string" ||
    typeof status !== "string" ||
    !(enrolmentRequestStatuses as readonly string[]).includes(status) ||
    typeof submittedAt !== "string" ||
    (reviewedAt !== undefined && typeof reviewedAt !== "string")
  ) {
    throw new Error(message);
  }
  return Object.freeze({
    enrolmentRequestId,
    applicantName,
    applicantIsStudent,
    minorCount,
    trainingCenter: trainingCenter as EnrolmentRequestRow["trainingCenter"],
    status: status as EnrolmentRequestStatus,
    submittedAt,
    ...(reviewedAt === undefined ? {} : { reviewedAt }),
  });
}

export type EnrolmentRequestQueue = Readonly<{
  requests: readonly EnrolmentRequestRow[];
  /** True when the page filled up, so office is not looking at every request. */
  truncated: boolean;
}>;

export async function listEnrolmentRequests(): Promise<EnrolmentRequestQueue> {
  try {
    const callable = httpsCallable<null, unknown>(getFirebaseFunctions(), "listEnrolmentRequests");
    const data = (await callable(null)).data;
    if (!isRecord(data) || !Array.isArray(data.requests) || typeof data.truncated !== "boolean") {
      throw new Error(queueError);
    }
    return Object.freeze({
      requests: Object.freeze(data.requests.map((item) => row(item, queueError))),
      truncated: data.truncated,
    });
  } catch {
    throw new Error(queueError);
  }
}

export async function returnEnrolmentRequest(
  enrolmentRequestId: string,
  note: string,
): Promise<EnrolmentRequestRow> {
  try {
    const callable = httpsCallable<{ enrolmentRequestId: string; note: string }, unknown>(
      getFirebaseFunctions(),
      "returnEnrolmentRequest",
    );
    return row((await callable({ enrolmentRequestId, note })).data, reviewError);
  } catch {
    throw new Error(reviewError);
  }
}

const detailError = "Unable to open this request.";
const approvalError = "Unable to approve this request.";

/**
 * The Confidential detail of one request. Read on demand and never for a whole page: it is
 * purpose-bound, audited, and spends from the same per-actor budget as reading a member record, so
 * fetching one per row would burn a reviewer's allowance just by opening the queue.
 */
export async function getEnrolmentRequestDetail(
  enrolmentRequestId: string,
): Promise<EnrolmentRequestDetail> {
  try {
    const callable = httpsCallable<
      { enrolmentRequestId: string; purpose: "enrolment-request-review" },
      unknown
    >(getFirebaseFunctions(), "getEnrolmentRequestDetail");
    const data = (
      await callable({ enrolmentRequestId, purpose: "enrolment-request-review" })
    ).data;
    if (
      !isRecord(data) ||
      typeof data.enrolmentRequestId !== "string" ||
      typeof data.status !== "string" ||
      !(enrolmentRequestStatuses as readonly string[]).includes(data.status) ||
      !isRecord(data.applicant) ||
      !Array.isArray(data.minors)
    ) {
      throw new Error(detailError);
    }
    return data as unknown as EnrolmentRequestDetail;
  } catch {
    throw new Error(detailError);
  }
}

export type EnrolmentApprovalOutcome = Readonly<{
  enrolmentRequestId: string;
  role: "adultStudent" | "guardian";
  studentIds: readonly string[];
  alreadyApproved: boolean;
}>;

/**
 * Approves one request. The idempotency key belongs to the reviewer's action, so it is minted here
 * and not by the applicant; a retry of a failed approval mints a new one and the request itself
 * still resolves it to the key the first attempt pinned.
 */
export async function approveEnrolmentRequest(
  enrolmentRequestId: string,
): Promise<EnrolmentApprovalOutcome> {
  try {
    const callable = httpsCallable<
      {
        enrolmentRequestId: string;
        requestId: string;
        purpose: "enrolment-request-review";
      },
      unknown
    >(getFirebaseFunctions(), "approveEnrolmentRequest");
    const data = (
      await callable({
        enrolmentRequestId,
        requestId: createEnrolmentRequestId(),
        purpose: "enrolment-request-review",
      })
    ).data;
    if (
      !isRecord(data) ||
      typeof data.enrolmentRequestId !== "string" ||
      (data.role !== "adultStudent" && data.role !== "guardian") ||
      !Array.isArray(data.studentIds) ||
      typeof data.alreadyApproved !== "boolean"
    ) {
      throw new Error(approvalError);
    }
    return Object.freeze({
      enrolmentRequestId: data.enrolmentRequestId,
      role: data.role,
      studentIds: Object.freeze(data.studentIds.map(String)),
      alreadyApproved: data.alreadyApproved,
    });
  } catch (error) {
    // An approval that stops carries a reason office needs to read, and the failure slug travels
    // in the message. Collapsing it would leave a reviewer staring at "something went wrong".
    if (isRecord(error) && typeof error.code === "string" && error.code.endsWith("failed-precondition")) {
      const message = typeof error.message === "string" ? error.message : "";
      if (message) throw new Error(message);
    }
    throw new Error(approvalError);
  }
}
