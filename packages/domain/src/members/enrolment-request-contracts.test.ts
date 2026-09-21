import { describe, expect, it } from "vitest";

import { enrolmentWaiverTermsVersion } from "../consents/enrolment-waiver-terms";

import { adminCreateStudentInputSchema } from "./member-directory-contracts";
import {
  getEnrolmentPlans,
  parseEnrolmentRequestDetails,
  canSubmitEnrolmentRequest,
  isApprovableEnrolmentRequest,
  isOpenEnrolmentRequest,
  parseEnrolmentRequestApproval,
  parseEnrolmentRequestDetailRequest,
  maximumEnrolmentRequestMinors,
  parseEnrolmentRequestRecord,
  parseEnrolmentRequestReview,
  parseEnrolmentRequestSubmission,
  enrolmentPaymentTotal,
  toEnrolmentRequestClientView,
  toEnrolmentRequestDetail,
  toEnrolmentRequestRow,
  type EnrolmentRequestRecord,
} from "./enrolment-request-contracts";

const effectiveDate = "2026-09-06";
const requestId = "6f1d2f66-6f4f-4a2e-9a0e-2b6f0a4a1c11";

const applicant = {
  fullName: "Alex Adult",
  dateOfBirth: "1994-04-02",
  phoneNumber: "07700900123",
  email: "alex@example.test",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  gender: "female",
  emergencyContact: {
    fullName: "Sam Contact",
    relationship: "Partner",
    phoneNumber: "07700900124",
  },
} as const;

const historicalPostalAddress = { line: "9 Library Place", postCode: "JE2 4WW" } as const;

const minor = {
  fullName: "Robin Minor",
  dateOfBirth: "2016-05-10",
  gender: "male",
  trainingCenter: "Town",
  trainingTimePreferences: ["afternoon"],
} as const;

function submission(overrides: Record<string, unknown> = {}) {
  const result = {
    requestId,
    applicantIsStudent: true,
    applicant,
    minors: [],
    planSelections:
      overrides.applicantIsStudent === false
        ? { minors: ((overrides.minors ?? []) as unknown[]).map(() => "town-kids-1x") }
        : { applicant: "town-adult", minors: [] },
    waiverAcceptance: { version: enrolmentWaiverTermsVersion, accepted: true },
    ...overrides,
  };
  return {
    ...result,
    payment: {
      proofId: "a".repeat(64),
      amountMinor: Math.max(1, enrolmentPaymentTotal(result.planSelections as never)),
      paidOn: "2026-09-01",
      reference: "TEST",
    },
  };
}

const record: EnrolmentRequestRecord = {
  enrolmentRequestId: "enrolment-1",
  academyId: "academy-1",
  requestId,
  status: "submitted",
  applicantIsStudent: false,
  applicant: { ...applicant, postalAddress: historicalPostalAddress },
  minors: [minor],
  submittedBy: "visitor-1",
  submittedAt: "2026-09-06T10:00:00.000Z",
  schemaVersion: "1",
};

describe("enrolment request submission", () => {
  it("keeps historical postal data readable while current submissions omit it", () => {
    expect(parseEnrolmentRequestRecord(record).ok).toBe(true);

    const parsed = parseEnrolmentRequestSubmission(submission(), effectiveDate);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.applicant).not.toHaveProperty("postalAddress");
  });

  it("requires evidence for paid plans and checks the exact total", () => {
    const value = submission();
    expect(
      parseEnrolmentRequestSubmission(
        Object.fromEntries(Object.entries(value).filter(([key]) => key !== "payment")),
        effectiveDate,
      ).ok,
    ).toBe(false);
    expect(
      parseEnrolmentRequestSubmission(
        { ...value, payment: { ...value.payment, amountMinor: 1 } },
        effectiveDate,
      ).ok,
    ).toBe(false);
  });
  it("exempts adult West PAYG and excludes teen PAYG from a mixed family's transfer total", () => {
    const value = submission({
      applicant: { ...applicant, trainingCenter: "West" },
      planSelections: { applicant: "payg", minors: [] },
    });
    expect(
      parseEnrolmentRequestSubmission(
        Object.fromEntries(Object.entries(value).filter(([key]) => key !== "payment")),
        effectiveDate,
      ).ok,
    ).toBe(true);
    expect(enrolmentPaymentTotal({ minors: ["west-teens-payg", "town-kids-1x"] })).toBe(9500);
    expect(enrolmentPaymentTotal({ minors: ["west-teens-payg"] })).toBe(0);
  });

  it("accepts an adult enrolling themselves", () => {
    const parsed = parseEnrolmentRequestSubmission(submission(), effectiveDate);

    expect(parsed.ok).toBe(true);
  });

  it("accepts a guardian enrolling the minors in their care", () => {
    const parsed = parseEnrolmentRequestSubmission(
      submission({ applicantIsStudent: false, minors: [minor] }),
      effectiveDate,
    );

    expect(parsed.ok).toBe(true);
  });

  it("refuses a request that enrols nobody", () => {
    const parsed = parseEnrolmentRequestSubmission(
      submission({ applicantIsStudent: false, minors: [] }),
      effectiveDate,
    );

    expect(parsed).toEqual({
      ok: false,
      error: [{ path: ["minors"], code: "request_enrols_nobody" }],
    });
  });

  it("decides the flow by age instead of trusting the form", () => {
    const asMinor = parseEnrolmentRequestSubmission(
      submission({ applicant: { ...applicant, dateOfBirth: "2015-01-01" } }),
      effectiveDate,
    );
    const asAdult = parseEnrolmentRequestSubmission(
      submission({
        applicantIsStudent: false,
        minors: [{ ...minor, dateOfBirth: "1990-01-01" }],
      }),
      effectiveDate,
    );

    expect(asMinor).toEqual({
      ok: false,
      error: [{ path: ["applicant", "dateOfBirth"], code: "applicant_must_be_adult" }],
    });
    expect(asAdult).toEqual({
      ok: false,
      error: [{ path: ["minors", 0, "dateOfBirth"], code: "minor_must_be_under_age" }],
    });
  });

  it("asks for a phone number even though the administrative form does not", () => {
    // The academy's client record will not parse without one, and an approved applicant whose
    // client record cannot be written is half-enrolled.
    const withoutPhone = Object.fromEntries(
      Object.entries(applicant).filter(([key]) => key !== "phoneNumber"),
    );
    const parsed = parseEnrolmentRequestSubmission(
      submission({ applicant: withoutPhone }),
      effectiveDate,
    );

    expect(parsed.ok).toBe(false);
    expect(
      adminCreateStudentInputSchema.safeParse({ ...withoutPhone, requestId: "x" }).success,
    ).toBe(true);
  });

  it("refuses an adult who is also enrolling children, because no role can express it", () => {
    // A claim holds one role and the vocabulary has no guardian-and-adult-student. Accepting this
    // would build a request the write path cannot approve.
    const parsed = parseEnrolmentRequestSubmission(
      submission({ applicantIsStudent: true, minors: [minor] }),
      effectiveDate,
    );

    expect(parsed).toEqual({
      ok: false,
      error: [{ path: ["minors"], code: "adult_and_minors_not_supported" }],
    });
  });

  it("never lets an applicant claim a membership number the academy assigns", () => {
    const parsed = parseEnrolmentRequestSubmission(
      submission({ applicant: { ...applicant, membershipNumber: "BPT-0001" } }),
      effectiveDate,
    );

    expect(parsed.ok).toBe(false);
  });

  it("keeps the applicant fields identical to the administrative enrolment form", () => {
    // The proof that the two doors ask for the same thing: what a request accepts is what the
    // administrative create accepts, once the two fields office owns are supplied by office.
    const parsed = parseEnrolmentRequestSubmission(submission(), effectiveDate);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const administrative = adminCreateStudentInputSchema.safeParse({
      ...parsed.value.applicant,
      requestId: "enrolment-1",
      membershipNumber: "1",
    });

    expect(administrative.success).toBe(true);
  });

  it("rejects prototype pollution, unknown fields and oversized families", () => {
    expect(
      parseEnrolmentRequestSubmission(JSON.parse('{"__proto__":{"x":1}}'), effectiveDate).ok,
    ).toBe(false);
    expect(parseEnrolmentRequestSubmission(submission({ extra: true }), effectiveDate).ok).toBe(
      false,
    );
    expect(
      parseEnrolmentRequestSubmission(
        submission({
          applicantIsStudent: false,
          minors: Array.from({ length: maximumEnrolmentRequestMinors + 1 }, () => minor),
        }),
        effectiveDate,
      ).ok,
    ).toBe(false);
    expect(
      parseEnrolmentRequestSubmission(submission({ requestId: "not-a-uuid" }), effectiveDate).ok,
    ).toBe(false);
  });
});

describe("enrolment request projections", () => {
  it("keeps confidential detail out of the office queue", () => {
    const row = toEnrolmentRequestRow(record);

    expect(row).toEqual({
      enrolmentRequestId: "enrolment-1",
      applicantName: "Alex Adult",
      applicantIsStudent: false,
      minorCount: 1,
      trainingCenter: "Town",
      status: "submitted",
      submittedAt: "2026-09-06T10:00:00.000Z",
    });
    expect(Object.isFrozen(row)).toBe(true);
    for (const forbidden of ["dateOfBirth", "email", "phoneNumber", "postalAddress"]) {
      expect(JSON.stringify(row)).not.toContain(forbidden);
    }
  });

  it("shows an applicant their own status and the note office wrote", () => {
    const view = toEnrolmentRequestClientView({
      ...record,
      status: "returned",
      reviewNote: "Please add a phone number we can reach you on.",
    });

    expect(view).toEqual({
      enrolmentRequestId: "enrolment-1",
      status: "returned",
      submittedAt: "2026-09-06T10:00:00.000Z",
      reviewNote: "Please add a phone number we can reach you on.",
    });
    expect(JSON.stringify(view)).not.toContain("Alex Adult");
  });

  it("round-trips a stored record and rejects a malformed one", () => {
    expect(parseEnrolmentRequestRecord(record)).toEqual({ ok: true, value: record });
    expect(parseEnrolmentRequestRecord({ ...record, status: "invented" }).ok).toBe(false);
    expect(parseEnrolmentRequestRecord({ ...record, submittedAt: "2026-09-06" }).ok).toBe(false);
  });

  it("treats resolved requests as closed", () => {
    expect(isOpenEnrolmentRequest("submitted")).toBe(true);
    expect(isOpenEnrolmentRequest("returned")).toBe(true);
    expect(isOpenEnrolmentRequest("approved")).toBe(false);
    expect(isOpenEnrolmentRequest("withdrawn")).toBe(false);
  });

  it("validates a review note", () => {
    expect(
      parseEnrolmentRequestReview({ enrolmentRequestId: "enrolment-1", note: "Add a phone." }).ok,
    ).toBe(true);
    expect(parseEnrolmentRequestReview({ enrolmentRequestId: "enrolment-1", note: " " }).ok).toBe(
      false,
    );
    expect(parseEnrolmentRequestReview({ enrolmentRequestId: "enrolment-1" }).ok).toBe(false);
  });
});

describe("enrolment request approval", () => {
  const approvalKey = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";

  it("shows the reviewer the Confidential detail the queue withholds", () => {
    const detail = toEnrolmentRequestDetail(record);
    const row = toEnrolmentRequestRow(record);

    expect(detail.applicant.dateOfBirth).toBe("1994-04-02");
    expect(detail.applicant.emergencyContact).toBeDefined();
    expect(detail.minors).toHaveLength(1);
    // The two projections exist precisely so that a queue is not a bulk export of dates of birth.
    expect(JSON.stringify(row)).not.toContain("1994-04-02");
    expect(JSON.stringify(row)).not.toContain("Library Place");
  });

  it("carries the outcome of an approval, and the reason one stopped", () => {
    const approved = toEnrolmentRequestDetail({
      ...record,
      status: "approved",
      approvedStudentIds: ["student-1"],
    });
    const stopped = toEnrolmentRequestDetail({
      ...record,
      status: "approval-failed",
      approvalFailureCode: "claim_not_persisted",
    });

    expect(approved.approvedStudentIds).toEqual(["student-1"]);
    expect(stopped.approvalFailureCode).toBe("claim_not_persisted");
  });

  it("stores the reviewer's idempotency key and what the approval produced", () => {
    const parsed = parseEnrolmentRequestRecord({
      ...record,
      status: "approving",
      approvalRequestId: approvalKey,
    });

    expect(parsed.ok).toBe(true);
    expect(parseEnrolmentRequestRecord({ ...record, approvalRequestId: "not-a-uuid" }).ok).toBe(
      false,
    );
    expect(parseEnrolmentRequestRecord({ ...record, approvalFailureCode: "Not A Slug" }).ok).toBe(
      false,
    );
  });

  it("takes an approval only with a reviewer key and a declared purpose", () => {
    expect(
      parseEnrolmentRequestApproval({
        enrolmentRequestId: "enrolment-1",
        requestId: approvalKey,
        purpose: "enrolment-request-review",
        setup: {
          students: [
            {
              planId: "town-adult",
              definitionKey: "yellow-2",
              startsOn: "2026-09-01",
              endsOn: "2026-10-01",
            },
          ],
          detailsVerified: true,
          paymentVerified: true,
        },
      }).ok,
    ).toBe(true);
    // A key chosen by the applicant's browser has no business inside the write receipt's MAC, and
    // an undeclared purpose is not a review.
    expect(
      parseEnrolmentRequestApproval({
        enrolmentRequestId: "enrolment-1",
        requestId: approvalKey,
      }).ok,
    ).toBe(false);
    expect(
      parseEnrolmentRequestApproval({
        enrolmentRequestId: "enrolment-1",
        requestId: "enrolment-1",
        purpose: "enrolment-request-review",
      }).ok,
    ).toBe(false);
    expect(
      parseEnrolmentRequestDetailRequest({
        enrolmentRequestId: "enrolment-1",
        purpose: "member-record-maintenance",
      }).ok,
    ).toBe(false);
  });

  it("keeps an approval in flight out of both the applicant's hands and a second reviewer's", () => {
    expect(isOpenEnrolmentRequest("approving")).toBe(false);
    expect(isOpenEnrolmentRequest("approval-failed")).toBe(false);
    expect(canSubmitEnrolmentRequest("approving")).toBe(false);
    expect(canSubmitEnrolmentRequest("approval-failed")).toBe(false);
    expect(canSubmitEnrolmentRequest("approved")).toBe(false);
    expect(canSubmitEnrolmentRequest("submitted")).toBe(false);
    // Only two things let somebody apply: never having applied, and having withdrawn.
    expect(canSubmitEnrolmentRequest("withdrawn")).toBe(true);
    expect(canSubmitEnrolmentRequest(undefined)).toBe(true);
  });

  it("lets a reviewer resume an attempt but never reopen a decided request", () => {
    expect(isApprovableEnrolmentRequest("submitted")).toBe(true);
    expect(isApprovableEnrolmentRequest("returned")).toBe(true);
    expect(isApprovableEnrolmentRequest("approving")).toBe(true);
    expect(isApprovableEnrolmentRequest("approval-failed")).toBe(true);
    expect(isApprovableEnrolmentRequest("withdrawn")).toBe(false);
    expect(isApprovableEnrolmentRequest("approved")).toBe(false);
  });
});

describe("enrolment plan preferences", () => {
  it("keeps legacy requests readable and exposes new choices only in the review detail", () => {
    expect(parseEnrolmentRequestRecord(record).ok).toBe(true);
    const withPlans = { ...record, planSelections: { minors: ["town-kids-1x" as const] } };
    expect(parseEnrolmentRequestRecord(withPlans).ok).toBe(true);
    expect(toEnrolmentRequestDetail(withPlans).planSelections).toEqual(withPlans.planSelections);
    expect(toEnrolmentRequestRow(withPlans)).not.toHaveProperty("planSelections");
    expect(toEnrolmentRequestClientView(withPlans)).not.toHaveProperty("planSelections");
  });

  it("allows a non-training guardian to complete details without training times", () => {
    const { planSelections, payment, ...details } = submission({
      applicantIsStudent: false,
      applicant: { ...applicant, trainingTimePreferences: [] },
      minors: [minor],
    });
    expect(planSelections).toBeDefined();
    expect(parseEnrolmentRequestDetails(details, effectiveDate).ok).toBe(true);
    expect(
      parseEnrolmentRequestSubmission(
        { ...details, payment, planSelections: { minors: ["town-kids-1x"] } },
        effectiveDate,
      ).ok,
    ).toBe(true);
    expect(
      parseEnrolmentRequestSubmission(
        submission({ applicant: { ...applicant, trainingTimePreferences: [] } }),
        effectiveDate,
      ).ok,
    ).toBe(false);
  });

  it("requires one appropriate plan for the adult or each child", () => {
    const { planSelections, ...withoutPlans } = submission();
    expect(planSelections).toBeDefined();
    expect(parseEnrolmentRequestSubmission(withoutPlans, effectiveDate).ok).toBe(false);
    for (const planSelections of [
      { minors: [] },
      { applicant: "west-adult", minors: [] },
      { applicant: "town-kids-1x", minors: [] },
      { applicant: "unknown", minors: [] },
    ]) {
      expect(
        parseEnrolmentRequestSubmission(submission({ planSelections }), effectiveDate).ok,
      ).toBe(false);
    }
    const family = {
      applicantIsStudent: false,
      minors: [minor, { ...minor, fullName: "Second child", trainingCenter: "West" }],
    };
    expect(
      parseEnrolmentRequestSubmission(
        submission({ ...family, planSelections: { minors: ["town-kids-1x", "west-kids-2x"] } }),
        effectiveDate,
      ).ok,
    ).toBe(true);
    for (const planSelections of [
      { minors: [] },
      { minors: ["town-kids-1x"] },
      { minors: ["town-kids-1x", "town-kids-2x"] },
      { applicant: "town-adult", minors: ["town-kids-1x", "west-kids-1x"] },
    ]) {
      expect(
        parseEnrolmentRequestSubmission(submission({ ...family, planSelections }), effectiveDate)
          .ok,
      ).toBe(false);
    }
  });

  it("filters sites, retired plans, and the exact 12th and 18th birthdays", () => {
    const ids = (dob: string, site: "Town" | "West") =>
      getEnrolmentPlans(dob, site, effectiveDate).map((plan) => plan.planId);
    expect(ids("2014-09-07", "West")).toEqual(["west-kids-1x", "west-kids-2x"]);
    expect(ids("2014-09-06", "West")).toEqual(["west-teens", "west-teens-payg"]);
    expect(ids("2008-09-07", "Town")).toEqual(["town-kids-1x", "town-kids-2x"]);
    expect(ids("2008-09-06", "Town")).toEqual(["bpt-jersey-adult", "town-adult"]);
    expect(ids("bad-date", "West")).toEqual([]);
  });
});
