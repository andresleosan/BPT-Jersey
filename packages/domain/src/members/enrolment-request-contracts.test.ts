import { describe, expect, it } from "vitest";

import { adminCreateStudentInputSchema } from "./member-directory-contracts";
import {
  isOpenEnrolmentRequest,
  maximumEnrolmentRequestMinors,
  parseEnrolmentRequestRecord,
  parseEnrolmentRequestReview,
  parseEnrolmentRequestSubmission,
  toEnrolmentRequestClientView,
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
  postalAddress: { line: "9 Library Place", postCode: "JE2 4WW" },
} as const;

const minor = {
  fullName: "Robin Minor",
  dateOfBirth: "2016-05-10",
  gender: "male",
  trainingCenter: "Town",
  trainingTimePreferences: ["afternoon"],
} as const;

function submission(overrides: Record<string, unknown> = {}) {
  return { requestId, applicantIsStudent: true, applicant, minors: [], ...overrides };
}

const record: EnrolmentRequestRecord = {
  enrolmentRequestId: "enrolment-1",
  academyId: "academy-1",
  requestId,
  status: "submitted",
  applicantIsStudent: false,
  applicant,
  minors: [minor],
  submittedBy: "visitor-1",
  submittedAt: "2026-09-06T10:00:00.000Z",
  schemaVersion: "1",
};

describe("enrolment request submission", () => {
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
      membershipNumber: "BPT-0001",
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
