import { z } from "zod";

import type { ValidationIssue } from "../errors";
import { err, ok, type Result } from "../result";
import { deriveParticipantType } from "../profiles/profile-contracts";
import { adminCreateStudentInputShape } from "./member-directory-contracts";

/**
 * A self-service enrolment request (T121). Somebody who signed in fills the same form office fills
 * in `/admin/members/add`, and office reviews it before anything reaches the canonical directory.
 * The request is a proposal and nothing more: it creates no student, grants no role and is never
 * read as a member record.
 *
 * Two fields office owns are deliberately absent from what an applicant may send. `requestId` is
 * the idempotency key of the administrative write, which belongs to the reviewer's action, not to
 * the applicant's; and `membershipNumber` is assigned by the academy, so letting an applicant type
 * one would let a stranger claim an existing member's number.
 */
export const officeOwnedEnrolmentFields = Object.freeze(["requestId", "membershipNumber"] as const);

function withoutOfficeOwnedFields<Shape extends Record<string, unknown>, Key extends keyof Shape>(
  shape: Shape,
  keys: readonly Key[],
): Omit<Shape, Key> {
  const kept: Record<string, unknown> = { ...shape };
  for (const key of keys) delete kept[key as string];
  return kept as Omit<Shape, Key>;
}

const applicantShape = withoutOfficeOwnedFields(
  adminCreateStudentInputShape,
  officeOwnedEnrolmentFields,
);

export const enrolmentRequestStatuses = Object.freeze([
  "submitted",
  "returned",
  "approved",
  "withdrawn",
] as const);

export type EnrolmentRequestStatus = (typeof enrolmentRequestStatuses)[number];

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const utcMillisecondDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

const opaqueIdentifierSchema = z.string().regex(identifierPattern);
const auditDateTimeSchema = z.string().refine((value) => {
  if (!utcMillisecondDateTimePattern.test(value)) return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}, "Invalid UTC millisecond timestamp");
const reviewNoteSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) => value === value.trim() && !controlCharacterPattern.test(value),
    "Note must be trimmed and contain no control characters",
  );

export const enrolmentApplicantSchema = z.strictObject({ ...applicantShape }).readonly();
export type EnrolmentApplicant = Readonly<z.infer<typeof enrolmentApplicantSchema>>;

/** A minor in the applicant's care. Same fields, minus the ones that belong to an adult account. */
export const enrolmentMinorSchema = z
  .strictObject({
    fullName: applicantShape.fullName,
    dateOfBirth: applicantShape.dateOfBirth,
    gender: applicantShape.gender,
    trainingCenter: applicantShape.trainingCenter,
    trainingTimePreferences: applicantShape.trainingTimePreferences,
    frequencyNote: applicantShape.frequencyNote,
    emergencyContact: applicantShape.emergencyContact,
  })
  .readonly();
export type EnrolmentMinor = Readonly<z.infer<typeof enrolmentMinorSchema>>;

export const maximumEnrolmentRequestMinors = 10;

export const enrolmentRequestSubmissionSchema = z
  .strictObject({
    requestId: z.string().regex(uuidV4Pattern),
    applicantIsStudent: z.boolean(),
    applicant: enrolmentApplicantSchema,
    minors: z.array(enrolmentMinorSchema).max(maximumEnrolmentRequestMinors).readonly(),
  })
  .readonly();
export type EnrolmentRequestSubmission = Readonly<z.infer<typeof enrolmentRequestSubmissionSchema>>;

export const enrolmentRequestRecordSchema = z
  .strictObject({
    enrolmentRequestId: opaqueIdentifierSchema,
    academyId: opaqueIdentifierSchema,
    requestId: z.string().regex(uuidV4Pattern),
    status: z.enum(enrolmentRequestStatuses),
    applicantIsStudent: z.boolean(),
    applicant: enrolmentApplicantSchema,
    minors: z.array(enrolmentMinorSchema).max(maximumEnrolmentRequestMinors).readonly(),
    submittedBy: opaqueIdentifierSchema,
    submittedAt: auditDateTimeSchema,
    reviewedBy: opaqueIdentifierSchema.optional(),
    reviewedAt: auditDateTimeSchema.optional(),
    reviewNote: reviewNoteSchema.optional(),
    schemaVersion: z.literal("1"),
  })
  .readonly();
export type EnrolmentRequestRecord = Readonly<z.infer<typeof enrolmentRequestRecordSchema>>;

export const enrolmentRequestReviewSchema = z
  .strictObject({
    enrolmentRequestId: opaqueIdentifierSchema,
    note: reviewNoteSchema,
  })
  .readonly();
export type EnrolmentRequestReview = Readonly<z.infer<typeof enrolmentRequestReviewSchema>>;

/**
 * What the office inbox lists. Deliberately without date of birth, address, emergency contact,
 * phone or document numbers: a queue is a general surface, and the Confidential detail is read one
 * request at a time through the detail projection.
 */
export type EnrolmentRequestRow = Readonly<{
  enrolmentRequestId: string;
  applicantName: string;
  applicantIsStudent: boolean;
  minorCount: number;
  trainingCenter: EnrolmentApplicant["trainingCenter"];
  status: EnrolmentRequestStatus;
  submittedAt: string;
  reviewedAt?: string;
}>;

/** What the applicant sees about their own request. Never another applicant's. */
export type EnrolmentRequestClientView = Readonly<{
  enrolmentRequestId: string;
  status: EnrolmentRequestStatus;
  submittedAt: string;
  reviewNote?: string;
}>;

function issues(error: z.ZodError): readonly ValidationIssue[] {
  return Object.freeze(
    error.issues.map((item) =>
      Object.freeze({
        path: Object.freeze(
          item.path.filter(
            (segment): segment is string | number =>
              typeof segment === "string" || typeof segment === "number",
          ),
        ),
        code: item.code,
      }),
    ),
  );
}

function issue(path: readonly (string | number)[], code: string): readonly ValidationIssue[] {
  return Object.freeze([{ path: Object.freeze([...path]), code }]);
}

function isPlainData(value: unknown, depth = 0): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (depth > 6) return false;
  if (Array.isArray(value)) return value.every((item) => isPlainData(item, depth + 1));
  if (typeof value !== "object") return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Reflect.ownKeys(value).every(
    (key) =>
      typeof key === "string" && isPlainData((value as Record<string, unknown>)[key], depth + 1),
  );
}

/**
 * Validates a submission against the effective date. Age is what decides which flow a person
 * belongs to, so it is checked here rather than trusted from a checkbox: an applicant who says they
 * are a student must be an adult, and everybody listed as a minor in their care must actually be
 * one.
 */
export function parseEnrolmentRequestSubmission(
  value: unknown,
  effectiveDate: string,
): Result<EnrolmentRequestSubmission, readonly ValidationIssue[]> {
  if (!isPlainData(value)) return err(issue([], "invalid_plain_data"));
  const parsed = enrolmentRequestSubmissionSchema.safeParse(value);
  if (!parsed.success) return err(issues(parsed.error));

  const { applicantIsStudent, applicant, minors } = parsed.data;
  if (!applicantIsStudent && minors.length === 0) {
    return err(issue(["minors"], "request_enrols_nobody"));
  }

  let applicantType: string;
  try {
    applicantType = deriveParticipantType(applicant.dateOfBirth, effectiveDate);
  } catch {
    return err(issue(["applicant", "dateOfBirth"], "invalid_date_of_birth"));
  }
  if (applicantType !== "adult") {
    return err(issue(["applicant", "dateOfBirth"], "applicant_must_be_adult"));
  }

  for (const [index, minor] of minors.entries()) {
    let minorType: string;
    try {
      minorType = deriveParticipantType(minor.dateOfBirth, effectiveDate);
    } catch {
      return err(issue(["minors", index, "dateOfBirth"], "invalid_date_of_birth"));
    }
    if (minorType !== "minor") {
      return err(issue(["minors", index, "dateOfBirth"], "minor_must_be_under_age"));
    }
  }

  return ok(parsed.data);
}

export function parseEnrolmentRequestRecord(
  value: unknown,
): Result<EnrolmentRequestRecord, readonly ValidationIssue[]> {
  const parsed = enrolmentRequestRecordSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(issues(parsed.error));
}

export function parseEnrolmentRequestReview(
  value: unknown,
): Result<EnrolmentRequestReview, readonly ValidationIssue[]> {
  if (!isPlainData(value)) return err(issue([], "invalid_plain_data"));
  const parsed = enrolmentRequestReviewSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(issues(parsed.error));
}

export function toEnrolmentRequestRow(record: EnrolmentRequestRecord): EnrolmentRequestRow {
  return Object.freeze({
    enrolmentRequestId: record.enrolmentRequestId,
    applicantName: record.applicant.fullName,
    applicantIsStudent: record.applicantIsStudent,
    minorCount: record.minors.length,
    trainingCenter: record.applicant.trainingCenter,
    status: record.status,
    submittedAt: record.submittedAt,
    ...(record.reviewedAt === undefined ? {} : { reviewedAt: record.reviewedAt }),
  });
}

export function toEnrolmentRequestClientView(
  record: EnrolmentRequestRecord,
): EnrolmentRequestClientView {
  return Object.freeze({
    enrolmentRequestId: record.enrolmentRequestId,
    status: record.status,
    submittedAt: record.submittedAt,
    ...(record.reviewNote === undefined ? {} : { reviewNote: record.reviewNote }),
  });
}

const openStatuses = new Set<EnrolmentRequestStatus>(["submitted", "returned"]);

/** A request that office already resolved is history: nothing may reopen or edit it. */
export function isOpenEnrolmentRequest(status: EnrolmentRequestStatus): boolean {
  return openStatuses.has(status);
}
