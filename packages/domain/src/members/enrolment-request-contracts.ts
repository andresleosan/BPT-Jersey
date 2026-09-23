import { z } from "zod";

import { enrolmentWaiverTermsVersion } from "../consents/enrolment-waiver-terms";

import type { ValidationIssue } from "../errors";
import { err, ok, type Result } from "../result";
import {
  administrativePlanIds,
  PLAN_CATALOG,
  planIds,
  retiredPlanIds,
  type PlanDraft,
  type PlanId,
  type Site,
} from "../memberships/plan-contracts";
import { deriveParticipantType } from "../profiles/profile-contracts";
import { bandForAge } from "../memberships/participant-band";
import { memberAgeOn } from "./member-access-contracts";
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

export const enrolmentTrainingFields = Object.freeze({
  trainingCenter: applicantShape.trainingCenter,
  trainingTimePreferences: applicantShape.trainingTimePreferences,
});

/**
 * `approving` is not decoration: approving a request is several writes across Firestore and Auth
 * that cannot share one commit, so the request itself is the lock. A reviewer takes it before the
 * first write and nobody else can take it again, which is what stops two reviewers from enrolling
 * one applicant twice. `approval-failed` is where a half-finished approval stops: not open, so the
 * applicant cannot apply again behind office's back, and not approved, because they are not.
 */
export const enrolmentRequestStatuses = Object.freeze([
  "submitted",
  "returned",
  "approving",
  "approval-failed",
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

/**
 * One field is deliberately stricter here than on the administrative form: a phone number. The
 * academy's own client record (`users/{uid}`) will not parse without one, and an approved applicant
 * whose client record cannot be written is half-enrolled - for a guardian it blocks their children
 * entirely. Office can enrol somebody who left a phone number blank because office is standing in
 * front of them; a form on the website has no such recourse, so it asks.
 */
export const enrolmentApplicantSchema = z
  .strictObject({
    ...applicantShape,
    phoneNumber: applicantShape.phoneNumber.unwrap(),
    // A guardian who is not training has no training time preference.
    trainingTimePreferences: z.union([applicantShape.trainingTimePreferences, z.tuple([])]),
  })
  .readonly();
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

/**
 * What the applicant sends to say they accept the waiver. Only the version travels: the text and
 * its hash live in the domain, so a client cannot claim to have accepted words it invented, and the
 * server records which version was on screen. `accepted` is a literal `true` rather than a boolean
 * because a submission that says `false` is not an acceptance to store - it is a form that was
 * never completed.
 */
export const enrolmentWaiverAcceptanceSchema = z
  .strictObject({
    version: z.literal(enrolmentWaiverTermsVersion),
    accepted: z.literal(true),
  })
  .readonly();
export type EnrolmentWaiverAcceptance = Readonly<z.infer<typeof enrolmentWaiverAcceptanceSchema>>;

const enrolmentDetailsShape = {
  requestId: z.string().regex(uuidV4Pattern),
  applicantIsStudent: z.boolean(),
  applicant: enrolmentApplicantSchema,
  minors: z.array(enrolmentMinorSchema).max(maximumEnrolmentRequestMinors).readonly(),
  waiverAcceptance: enrolmentWaiverAcceptanceSchema,
};

export const enrolmentRequestDetailsSchema = z.strictObject(enrolmentDetailsShape).readonly();
export type EnrolmentRequestDetails = Readonly<z.infer<typeof enrolmentRequestDetailsSchema>>;

/** The free "Trial" choice: a Beginner gets two free Introduction Classes, a belted student one. */
export const trialPlanChoice = "trial" as const;
export type EnrolmentPlanChoice = PlanId | typeof trialPlanChoice;
const enrolmentPlanChoiceSchema = z.union([z.enum(planIds), z.literal(trialPlanChoice)]);

/** Whether a trial applicant has never trained before, or is declaring a prior belt. */
export const enrolmentExperiences = Object.freeze(["beginner", "experienced"] as const);
export type EnrolmentExperience = (typeof enrolmentExperiences)[number];

/** Beginners get two free Introduction Classes; a student who declares a belt gets one. */
export function enrolmentTrialAllowance(experience: EnrolmentExperience): 1 | 2 {
  return experience === "beginner" ? 2 : 1;
}

export const enrolmentLevelDeclarationSchema = z
  .strictObject({
    experience: z.enum(enrolmentExperiences),
    declaredLevelKey: opaqueIdentifierSchema.nullable(),
  })
  .readonly();
export type EnrolmentLevelDeclaration = Readonly<z.infer<typeof enrolmentLevelDeclarationSchema>>;

export const enrolmentLevelDeclarationsSchema = z
  .strictObject({
    applicant: enrolmentLevelDeclarationSchema.optional(),
    minors: z.array(enrolmentLevelDeclarationSchema).max(maximumEnrolmentRequestMinors).readonly(),
  })
  .readonly();
export type EnrolmentLevelDeclarations = Readonly<z.infer<typeof enrolmentLevelDeclarationsSchema>>;

// Choices are indexed in the same order as the minors; the guardian has no plan of their own.
export const enrolmentPlanSelectionsSchema = z
  .strictObject({
    applicant: enrolmentPlanChoiceSchema.optional(),
    minors: z.array(enrolmentPlanChoiceSchema).max(maximumEnrolmentRequestMinors).readonly(),
  })
  .readonly();
export type EnrolmentPlanSelections = Readonly<z.infer<typeof enrolmentPlanSelectionsSchema>>;

export const enrolmentPaymentSchema = z
  .strictObject({
    proofId: z.string().regex(/^[a-f0-9]{64}$/u),
    amountMinor: z.number().int().positive().max(100_000_000),
    paidOn: z.iso.date(),
    reference: z.string().trim().min(1).max(120),
  })
  .readonly();
export type EnrolmentPayment = z.infer<typeof enrolmentPaymentSchema>;

export const enrolmentApprovalSetupSchema = z
  .strictObject({
    students: z
      .array(
        z
          .strictObject({
            planId: enrolmentPlanChoiceSchema,
            definitionKey: opaqueIdentifierSchema,
            startsOn: z.iso.date(),
            endsOn: z.iso.date().nullable(),
          })
          .refine((s) => s.planId !== trialPlanChoice || s.endsOn === null, "Trial has no paid period"),
      )
      .min(1)
      .max(maximumEnrolmentRequestMinors + 1),
    detailsVerified: z.literal(true),
    paymentVerified: z.literal(true),
  })
  .readonly();
export type EnrolmentApprovalSetup = z.infer<typeof enrolmentApprovalSetupSchema>;

/** Pay-as-you-go plans are paid per class, with no payment or proof required at registration. */
export function enrolmentNeedsPayment(planId: string): boolean {
  if (planId === trialPlanChoice) return false;
  const plan = PLAN_CATALOG.find((item) => item.planId === planId);
  return plan?.billingPeriod !== "per-session";
}
export function enrolmentPaymentTotal(selections: EnrolmentPlanSelections): number {
  return [selections.applicant, ...selections.minors].reduce<number>(
    (total, id) =>
      total +
      (id && enrolmentNeedsPayment(id)
        ? (PLAN_CATALOG.find((plan) => plan.planId === id)?.priceMinor ?? 0)
        : 0),
    0,
  );
}

export const enrolmentRequestSubmissionSchema = z
  .strictObject({
    ...enrolmentDetailsShape,
    planSelections: enrolmentPlanSelectionsSchema,
    levelDeclarations: enrolmentLevelDeclarationsSchema.optional(),
    payment: enrolmentPaymentSchema.optional(),
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
    // Older requests remain reviewable without a plan preference.
    planSelections: enrolmentPlanSelectionsSchema.optional(),
    levelDeclarations: enrolmentLevelDeclarationsSchema.optional(),
    payment: enrolmentPaymentSchema.optional(),
    approvalSetup: enrolmentApprovalSetupSchema.optional(),
    approvalStartedAt: auditDateTimeSchema.optional(),
    approvalActorId: opaqueIdentifierSchema.optional(),
    submittedBy: opaqueIdentifierSchema,
    submittedAt: auditDateTimeSchema,
    /**
     * Optional because requests submitted before the waiver existed are still readable. A missing
     * acceptance is a fact about an old request, not a reason for office to lose the record.
     */
    waiverAcceptance: z
      .strictObject({
        version: z.string().min(1).max(32),
        contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
        acceptedAt: auditDateTimeSchema,
        acceptedBy: opaqueIdentifierSchema,
      })
      .readonly()
      .optional(),
    /**
     * The `Instructor Name` line of the paper waiver. Filled on approval with the display name of
     * the reviewer who approved, so the name comes from an authenticated account instead of
     * handwriting. Optional for the same reason as the acceptance above.
     */
    instructorName: z.string().min(1).max(160).optional(),
    reviewedBy: opaqueIdentifierSchema.optional(),
    reviewedAt: auditDateTimeSchema.optional(),
    reviewNote: reviewNoteSchema.optional(),
    /**
     * The idempotency key of the administrative write, minted by the reviewer and then pinned to
     * the request. A retried approval must reuse it: a fresh key would mint a fresh write receipt,
     * and a fresh receipt is a second student for the same person.
     */
    approvalRequestId: z.string().regex(uuidV4Pattern).optional(),
    approvedStudentIds: z
      .array(opaqueIdentifierSchema)
      .min(1)
      .max(maximumEnrolmentRequestMinors + 1)
      .readonly()
      .optional(),
    approvalFailureCode: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,63}$/u)
      .optional(),
    schemaVersion: z.literal("1"),
  })
  .readonly();
export type EnrolmentRequestRecord = Readonly<z.infer<typeof enrolmentRequestRecordSchema>>;

/**
 * What a reviewer sends to approve. `requestId` is theirs, not the applicant's: it becomes the
 * idempotency key of the canonical write and lands inside the write receipt's MAC, so a value
 * chosen by the applicant's browser has no business being there. `purpose` is declared for the
 * same reason every restricted read declares one - the approval reads the whole Confidential
 * request before it writes.
 */
export const enrolmentRequestApprovalSchema = z
  .strictObject({
    enrolmentRequestId: opaqueIdentifierSchema,
    requestId: z.string().regex(uuidV4Pattern),
    purpose: z.literal("enrolment-request-review"),
    setup: enrolmentApprovalSetupSchema,
  })
  .readonly();
export type EnrolmentRequestApproval = Readonly<z.infer<typeof enrolmentRequestApprovalSchema>>;

export const enrolmentRequestDetailRequestSchema = z
  .strictObject({
    enrolmentRequestId: opaqueIdentifierSchema,
    purpose: z.literal("enrolment-request-review"),
  })
  .readonly();
export type EnrolmentRequestDetailRequest = Readonly<
  z.infer<typeof enrolmentRequestDetailRequestSchema>
>;

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

/**
 * What one reviewer reads about one request, immediately before deciding it. This is the
 * Confidential half the queue deliberately withholds - date of birth, emergency contact, postal
 * address, document numbers - and it exists because approving a person without reading what you
 * are approving is not a review. It is read one request at a time, purpose-bound, audited and
 * counted against the same restricted read budget as a member record.
 */
export type EnrolmentRequestDetail = Readonly<{
  enrolmentRequestId: string;
  status: EnrolmentRequestStatus;
  applicantIsStudent: boolean;
  applicant: EnrolmentApplicant;
  minors: readonly EnrolmentMinor[];
  planSelections?: EnrolmentPlanSelections;
  levelDeclarations?: EnrolmentLevelDeclarations;
  payment?: EnrolmentPayment;
  paymentProofUrl?: string;
  approvalSetup?: EnrolmentApprovalSetup;
  waiverAcceptance?: EnrolmentRequestRecord["waiverAcceptance"];
  submittedBy: string;
  submittedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  approvedStudentIds?: readonly string[];
  approvalFailureCode?: string;
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
export function parseEnrolmentRequestDetails(
  value: unknown,
  effectiveDate: string,
): Result<EnrolmentRequestDetails, readonly ValidationIssue[]> {
  if (!isPlainData(value)) return err(issue([], "invalid_plain_data"));
  const parsed = enrolmentRequestDetailsSchema.safeParse(value);
  if (!parsed.success) return err(issues(parsed.error));

  const { applicantIsStudent, applicant, minors } = parsed.data;
  if (!applicantIsStudent && minors.length === 0) {
    return err(issue(["minors"], "request_enrols_nobody"));
  }
  // A role claim holds one value, and the vocabulary has no "guardian and adult student" - so an
  // adult who trains AND brings children cannot be represented by anything the write path can
  // produce. Rejecting it here is honest; accepting it would build a request nobody can approve.
  if (applicantIsStudent && minors.length > 0) {
    return err(issue(["minors"], "adult_and_minors_not_supported"));
  }

  if (applicantIsStudent && applicant.trainingTimePreferences.length === 0) {
    return err(issue(["applicant", "trainingTimePreferences"], "training_time_required"));
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

/** Plans offered at the student's centre, using the one age band (D6) as memberships. */
export function getEnrolmentPlans(
  dateOfBirth: string,
  trainingCenter: Site,
  effectiveDate: string,
): readonly PlanDraft[] {
  const age = memberAgeOn(dateOfBirth, effectiveDate);
  if (age === null) return [];
  const participantType = bandForAge(age);
  return PLAN_CATALOG.filter(
    (plan) =>
      !retiredPlanIds.includes(plan.planId) &&
      !administrativePlanIds.includes(plan.planId) &&
      plan.classSites.includes(trainingCenter) &&
      plan.eligibleParticipantTypes.includes(participantType),
  );
}

export function parseEnrolmentRequestSubmission(
  value: unknown,
  effectiveDate: string,
): Result<EnrolmentRequestSubmission, readonly ValidationIssue[]> {
  if (!isPlainData(value)) return err(issue([], "invalid_plain_data"));
  const parsed = enrolmentRequestSubmissionSchema.safeParse(value);
  if (!parsed.success) return err(issues(parsed.error));
  const { planSelections, levelDeclarations, payment, ...details } = parsed.data;
  const checkedDetails = parseEnrolmentRequestDetails(details, effectiveDate);
  if (!checkedDetails.ok) return checkedDetails;
  const { applicantIsStudent, applicant, minors } = details;
  if (applicantIsStudent !== (planSelections.applicant !== undefined)) {
    return err(issue(["planSelections", "applicant"], "plan_selection_required_for_student_only"));
  }
  if (planSelections.minors.length !== minors.length) {
    return err(issue(["planSelections", "minors"], "plan_required_for_every_child"));
  }
  if (
    applicantIsStudent &&
    planSelections.applicant !== trialPlanChoice &&
    !getEnrolmentPlans(applicant.dateOfBirth, applicant.trainingCenter, effectiveDate).some(
      (plan) => plan.planId === planSelections.applicant,
    )
  ) {
    return err(issue(["planSelections", "applicant"], "plan_not_available"));
  }
  for (const [index, minor] of minors.entries()) {
    if (
      planSelections.minors[index] !== trialPlanChoice &&
      !getEnrolmentPlans(minor.dateOfBirth, minor.trainingCenter, effectiveDate).some(
        (plan) => plan.planId === planSelections.minors[index],
      )
    ) {
      return err(issue(["planSelections", "minors", index], "plan_not_available"));
    }
  }
  const trialChoices = applicantIsStudent
    ? [
        {
          path: ["applicant"] as const,
          plan: planSelections.applicant,
          declaration: levelDeclarations?.applicant,
        },
      ]
    : minors.map((_, index) => ({
        path: ["minors", index] as const,
        plan: planSelections.minors[index],
        declaration: levelDeclarations?.minors[index],
      }));
  for (const { path, plan, declaration } of trialChoices) {
    if (plan !== trialPlanChoice) continue;
    if (!declaration) return err(issue(["levelDeclarations", ...path], "level_declaration_required"));
    if (declaration.experience === "experienced" && declaration.declaredLevelKey === null) {
      return err(issue(["levelDeclarations", ...path], "declared_level_required"));
    }
    if (declaration.experience === "beginner" && declaration.declaredLevelKey !== null) {
      return err(issue(["levelDeclarations", ...path], "beginner_declares_no_level"));
    }
  }
  const total = enrolmentPaymentTotal(planSelections);
  if (total > 0 && !payment) return err(issue(["payment"], "payment_proof_required"));
  if (payment && (payment.amountMinor !== total || payment.paidOn > effectiveDate))
    return err(issue(["payment"], "payment_does_not_match_plans"));
  if (total === 0 && payment) return err(issue(["payment"], "payment_not_required"));
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

export function toEnrolmentRequestDetail(record: EnrolmentRequestRecord): EnrolmentRequestDetail {
  return Object.freeze({
    enrolmentRequestId: record.enrolmentRequestId,
    status: record.status,
    applicantIsStudent: record.applicantIsStudent,
    applicant: record.applicant,
    minors: Object.freeze([...record.minors]),
    ...(record.planSelections === undefined ? {} : { planSelections: record.planSelections }),
    ...(record.levelDeclarations === undefined
      ? {}
      : { levelDeclarations: record.levelDeclarations }),
    ...(record.payment ? { payment: record.payment } : {}),
    ...(record.approvalSetup ? { approvalSetup: record.approvalSetup } : {}),
    ...(record.waiverAcceptance ? { waiverAcceptance: record.waiverAcceptance } : {}),
    submittedBy: record.submittedBy,
    submittedAt: record.submittedAt,
    ...(record.reviewedBy === undefined ? {} : { reviewedBy: record.reviewedBy }),
    ...(record.reviewedAt === undefined ? {} : { reviewedAt: record.reviewedAt }),
    ...(record.reviewNote === undefined ? {} : { reviewNote: record.reviewNote }),
    ...(record.approvedStudentIds === undefined
      ? {}
      : { approvedStudentIds: Object.freeze([...record.approvedStudentIds]) }),
    ...(record.approvalFailureCode === undefined
      ? {}
      : { approvalFailureCode: record.approvalFailureCode }),
  });
}

export function parseEnrolmentRequestApproval(
  value: unknown,
): Result<EnrolmentRequestApproval, readonly ValidationIssue[]> {
  if (!isPlainData(value)) return err(issue([], "invalid_plain_data"));
  const parsed = enrolmentRequestApprovalSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(issues(parsed.error));
}

export function parseEnrolmentRequestDetailRequest(
  value: unknown,
): Result<EnrolmentRequestDetailRequest, readonly ValidationIssue[]> {
  if (!isPlainData(value)) return err(issue([], "invalid_plain_data"));
  const parsed = enrolmentRequestDetailRequestSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(issues(parsed.error));
}

const openStatuses: ReadonlySet<string> = new Set<EnrolmentRequestStatus>([
  "submitted",
  "returned",
]);

/**
 * The one hold status from which somebody may apply again. Written as an allow list on purpose: a
 * deny list has to be revisited every time the vocabulary grows, and the status that gets
 * forgotten is the one that lets a person hold two requests at once.
 */
const resubmittableHoldStatuses: ReadonlySet<string> = new Set<EnrolmentRequestStatus>([
  "withdrawn",
]);

/**
 * A request that office already resolved is history: nothing may reopen or edit it. Takes a plain
 * string because callers also ask this of a status read straight out of storage, where the value is
 * not yet known to belong to the vocabulary.
 */
export function isOpenEnrolmentRequest(status: string): boolean {
  return openStatuses.has(status);
}

/** Whether an applicant holding a request in this state may submit a new one. */
export function canSubmitEnrolmentRequest(heldStatus: string | undefined): boolean {
  return heldStatus === undefined || resubmittableHoldStatuses.has(heldStatus);
}

/** A request a reviewer may take the approval lock on, now or as a retry of their own attempt. */
export function isApprovableEnrolmentRequest(status: string): boolean {
  return isOpenEnrolmentRequest(status) || status === "approving" || status === "approval-failed";
}

/**
 * A request office may hand back to the applicant with a note. It includes `approval-failed`, and
 * that is not a detail: an approval can stop for a reason only the applicant can fix, and without
 * this the person is stuck for ever - they cannot withdraw a request that is not open, and they
 * cannot apply again while they hold one. Handing it back is the way out, and the note says why.
 */
export function isReturnableEnrolmentRequest(status: string): boolean {
  return isOpenEnrolmentRequest(status) || status === "approval-failed";
}
