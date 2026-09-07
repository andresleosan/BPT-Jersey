import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * T121 slice 2 authenticated Emulator E2E: office approves an enrolment request and the applicant
 * becomes both a member of the academy and an account that can sign in as one.
 *
 * Everything here is driven at the callable surface for the reason the T093 spec already records:
 * the browser path is App Check fail-closed and cannot run offline, while the Functions Emulator
 * runs with `skipTokenVerification`, so an unsigned App Check JWT populates `request.app` exactly
 * as a real token would.
 *
 * What this suite exists to prove, which unit tests structurally cannot:
 *
 * - The union write plan of T122 lands in real Firestore, for an adult and for a tutor with
 *   minors. That is the closing criterion of T122, written in its own design document.
 * - **The defect T122 was opened for does not come back.** After approval the applicant saves
 *   their own profile, and the academy still holds one student, not two. In unit tests both
 *   writers share a fake store; here they share Firestore.
 * - Two approvals of the same request produce one student, against real Firestore.
 *
 * What it does **not** prove, and nothing here should be read as proving: true simultaneous
 * contention. The Functions Emulator runs invocations through a single worker and serialises them -
 * its own log shows `Beginning ... Finished ... Beginning ... Finished`, never an overlap - so the
 * two approvals below arrive together and still execute one after the other. Verified by mutation:
 * with the idempotency key deliberately un-pinned, this suite still passed. The pin itself is
 * covered by a unit test that does fail under that mutation
 * (`enrolment-request-service.test.ts`, "gives a retry the key the first attempt pinned").
 */
const enabled = process.env.T093_MEMBER_DIRECTORY_EMULATOR_E2E === "true";
const functionsPort = process.env.T093_FUNCTIONS_EMULATOR_PORT ?? "5001";
const projectId = "demo-bpt-jersey";
const functionsBaseUrl = `http://127.0.0.1:${functionsPort}/${projectId}/us-central1`;
const authUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`;

type CallableEnvelope = Readonly<{
  result?: unknown;
  error?: Readonly<{ message?: string; status?: string }>;
}>;

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Unsigned, emulator-only App Check token. It is never accepted outside skipTokenVerification.
function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:t121-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

async function signIn(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const response = await request.post(authUrl, {
    data: { email, password, returnSecureToken: true },
  });
  expect(response.ok(), `sign-in failed for ${email}`).toBe(true);
  const body = (await response.json()) as { idToken?: string };
  expect(typeof body.idToken).toBe("string");
  return body.idToken as string;
}

async function call(
  request: APIRequestContext,
  name: string,
  data: unknown,
  options: Readonly<{ idToken?: string; appCheck?: boolean }> = {},
): Promise<Readonly<{ status: number; body: CallableEnvelope }>> {
  const response = await request.post(`${functionsBaseUrl}/${name}`, {
    headers: {
      Accept: "application/json",
      ...(options.idToken ? { Authorization: `Bearer ${options.idToken}` } : {}),
      ...(options.appCheck === false ? {} : { "X-Firebase-AppCheck": syntheticAppCheckToken() }),
    },
    data: { data },
  });
  return { status: response.status(), body: (await response.json()) as CallableEnvelope };
}

const applicantPassword = process.env.T121_APPLICANT_PASSWORD ?? "";
const ownerEmail = process.env.AUTH_EMULATOR_E2E_EMAIL ?? "";
const ownerPassword = process.env.AUTH_EMULATOR_E2E_PASSWORD ?? "";

function applicantEmail(key: string): string {
  return `t121-${key}@example.test`;
}

const emergencyContact = {
  fullName: "Synthetic T121 Contact",
  relationship: "Sibling",
  phoneNumber: "+441534000121",
} as const;

const postalAddress = { line: "2 Synthetic Lane, St Helier", postCode: "JE2 4XY" } as const;

function adultSubmission(requestId: string) {
  return {
    requestId,
    applicantIsStudent: true,
    applicant: {
      fullName: "Synthetic T121 Adult Applicant",
      dateOfBirth: "1991-03-04",
      phoneNumber: "+441534000122",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      gender: "female",
      emergencyContact,
      postalAddress,
    },
    minors: [],
  };
}

/** Counts the students the academy holds, which is the only number that matters for the defect. */
async function countMembers(request: APIRequestContext, idToken: string): Promise<number> {
  const listed = await call(request, "listMembers", { pageSize: 50 }, { idToken });
  expect(listed.status, JSON.stringify(listed.body)).toBe(200);
  return ((listed.body.result as { rows: readonly unknown[] }).rows ?? []).length;
}

test.describe("T121 enrolment approval with Firebase Emulators", () => {
  test.skip(
    !enabled || !applicantPassword || !ownerEmail || !ownerPassword,
    "Synthetic T121/T093 Emulator credentials and directory state are required.",
  );

  test("approves an adult applicant into one member record their own account owns @critical", async ({
    request,
  }) => {
    const applicantToken = await signIn(request, applicantEmail("adult"), applicantPassword);
    const submissionId = randomUUID();

    const submitted = await call(request, "submitEnrolmentRequest", adultSubmission(submissionId), {
      idToken: applicantToken,
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const enrolmentRequestId = (submitted.body.result as { enrolmentRequestId: string })
      .enrolmentRequestId;

    const ownerToken = await signIn(request, ownerEmail, ownerPassword);
    const membersBefore = await countMembers(request, ownerToken);

    // The queue is a general surface: it must not carry the Confidential detail.
    const queue = await call(request, "listEnrolmentRequests", null, { idToken: ownerToken });
    expect(queue.status, JSON.stringify(queue.body)).toBe(200);
    expect(JSON.stringify(queue.body.result)).not.toContain("1991-03-04");
    expect(JSON.stringify(queue.body.result)).not.toContain(emergencyContact.phoneNumber);

    // The detail projection is what stops office approving somebody it cannot see.
    const detail = await call(
      request,
      "getEnrolmentRequestDetail",
      { enrolmentRequestId, purpose: "enrolment-request-review" },
      { idToken: ownerToken },
    );
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    const detailResult = detail.body.result as {
      applicant: Record<string, unknown>;
      status: string;
    };
    expect(detailResult.applicant.dateOfBirth).toBe("1991-03-04");
    expect(detailResult.applicant.emergencyContact).toEqual(emergencyContact);
    expect(detailResult.applicant.postalAddress).toEqual(postalAddress);

    const approved = await call(
      request,
      "approveEnrolmentRequest",
      { enrolmentRequestId, requestId: randomUUID(), purpose: "enrolment-request-review" },
      { idToken: ownerToken },
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const approvalResult = approved.body.result as {
      role: string;
      studentIds: readonly string[];
      alreadyApproved: boolean;
    };
    expect(approvalResult.role).toBe("adultStudent");
    expect(approvalResult.studentIds).toHaveLength(1);
    expect(approvalResult.alreadyApproved).toBe(false);
    const studentId = approvalResult.studentIds[0] as string;

    // What office approved is what the academy now holds.
    const memberDetail = await call(
      request,
      "getMemberDetail",
      { studentId, purpose: "member-record-maintenance" },
      { idToken: ownerToken },
    );
    expect(memberDetail.status, JSON.stringify(memberDetail.body)).toBe(200);
    const member = memberDetail.body.result as Record<string, unknown>;
    expect(member.dateOfBirth).toBe("1991-03-04");
    expect(member.emergencyContact).toEqual(emergencyContact);
    expect(member.postalAddress).toEqual(postalAddress);
    expect(member.gender).toBe("female");
    expect(await countMembers(request, ownerToken)).toBe(membersBefore + 1);

    // ---------------------------------------------------------------------
    // The defect T122 exists for. The applicant now holds `adultStudent`, so a fresh token lets
    // them into their own profile. Before the link existed, saving it minted a SECOND student:
    // one with the data and no access, one with the access and no data, and nothing detected it.
    // ---------------------------------------------------------------------
    const promotedToken = await signIn(request, applicantEmail("adult"), applicantPassword);
    const savedProfile = await call(
      request,
      "saveClientProfile",
      {
        requestId: randomUUID(),
        fullName: "Synthetic T121 Adult Applicant",
        dateOfBirth: "1991-03-04",
        phoneNumber: "+441534000122",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
      },
      { idToken: promotedToken },
    );
    expect(savedProfile.status, JSON.stringify(savedProfile.body)).toBe(200);
    expect(await countMembers(request, ownerToken)).toBe(membersBefore + 1);

    // Approving again is the first approval's answer, not a second enrolment.
    const reapproved = await call(
      request,
      "approveEnrolmentRequest",
      { enrolmentRequestId, requestId: randomUUID(), purpose: "enrolment-request-review" },
      { idToken: ownerToken },
    );
    expect(reapproved.status, JSON.stringify(reapproved.body)).toBe(200);
    expect((reapproved.body.result as { alreadyApproved: boolean }).alreadyApproved).toBe(true);
    expect(await countMembers(request, ownerToken)).toBe(membersBefore + 1);
  });

  test("a second approval of the same request produces one member, not two @critical", async ({
    request,
  }) => {
    const applicantToken = await signIn(request, applicantEmail("concurrent"), applicantPassword);
    const submitted = await call(
      request,
      "submitEnrolmentRequest",
      {
        ...adultSubmission(randomUUID()),
        applicant: {
          ...adultSubmission(randomUUID()).applicant,
          fullName: "Synthetic T121 Concurrent Applicant",
        },
      },
      { idToken: applicantToken },
    );
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const enrolmentRequestId = (submitted.body.result as { enrolmentRequestId: string })
      .enrolmentRequestId;

    const ownerToken = await signIn(request, ownerEmail, ownerPassword);
    const membersBefore = await countMembers(request, ownerToken);

    // Two reviewers, two different idempotency keys, dispatched together. The emulator serialises
    // them, so this is the sequential double-approval - the case a distracted second reviewer
    // actually produces - not a race. Either way one member must come out.
    const [first, second] = await Promise.all([
      call(
        request,
        "approveEnrolmentRequest",
        { enrolmentRequestId, requestId: randomUUID(), purpose: "enrolment-request-review" },
        { idToken: ownerToken },
      ),
      call(
        request,
        "approveEnrolmentRequest",
        { enrolmentRequestId, requestId: randomUUID(), purpose: "enrolment-request-review" },
        { idToken: ownerToken },
      ),
    ]);

    const outcomes = [first, second];
    expect(outcomes.some((outcome) => outcome.status === 200)).toBe(true);
    const studentIds = new Set(
      outcomes
        .filter((outcome) => outcome.status === 200)
        .flatMap(
          (outcome) => (outcome.body.result as { studentIds: readonly string[] }).studentIds,
        ),
    );
    expect(studentIds.size).toBe(1);
    expect(await countMembers(request, ownerToken)).toBe(membersBefore + 1);
  });

  test("approves a tutor into a family without making the tutor a student @critical", async ({
    request,
  }) => {
    const applicantToken = await signIn(request, applicantEmail("guardian"), applicantPassword);
    const submitted = await call(
      request,
      "submitEnrolmentRequest",
      {
        requestId: randomUUID(),
        applicantIsStudent: false,
        applicant: {
          fullName: "Synthetic T121 Guardian Applicant",
          dateOfBirth: "1985-06-07",
          phoneNumber: "+441534000123",
          trainingCenter: "West",
          trainingTimePreferences: ["afternoon"],
          gender: "male",
          emergencyContact,
        },
        minors: [
          {
            fullName: "Synthetic T121 Minor",
            dateOfBirth: "2016-09-10",
            gender: "female",
            trainingCenter: "West",
            trainingTimePreferences: ["afternoon"],
            frequencyNote: "Twice a week",
            emergencyContact,
          },
        ],
      },
      { idToken: applicantToken },
    );
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const enrolmentRequestId = (submitted.body.result as { enrolmentRequestId: string })
      .enrolmentRequestId;

    const ownerToken = await signIn(request, ownerEmail, ownerPassword);
    const membersBefore = await countMembers(request, ownerToken);

    const approved = await call(
      request,
      "approveEnrolmentRequest",
      { enrolmentRequestId, requestId: randomUUID(), purpose: "enrolment-request-review" },
      { idToken: ownerToken },
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const approvalResult = approved.body.result as { role: string; studentIds: readonly string[] };
    expect(approvalResult.role).toBe("guardian");
    // One minor enrolled, and the tutor is not among them: a tutor is not a student.
    expect(approvalResult.studentIds).toHaveLength(1);
    expect(await countMembers(request, ownerToken)).toBe(membersBefore + 1);

    const minorDetail = await call(
      request,
      "getMemberDetail",
      { studentId: approvalResult.studentIds[0], purpose: "member-record-maintenance" },
      { idToken: ownerToken },
    );
    expect(minorDetail.status, JSON.stringify(minorDetail.body)).toBe(200);
    const minor = minorDetail.body.result as Record<string, unknown>;
    expect(minor.fullName).toBe("Synthetic T121 Minor");
    expect(minor.participantType).toBe("minor");
    // The answers the applicant gave about the minor survive the family writer, instead of being
    // flattened to `unknown` and dropped.
    expect(minor.gender).toBe("female");
    expect(minor.frequencyNote).toBe("Twice a week");
    expect(minor.emergencyContact).toEqual(emergencyContact);
  });

  test("refuses the office doors without App Check, without a session, or to a client @critical", async ({
    request,
  }) => {
    const applicantToken = await signIn(request, applicantEmail("adult"), applicantPassword);
    const ownerToken = await signIn(request, ownerEmail, ownerPassword);
    const payload = {
      enrolmentRequestId: "enrolment-does-not-matter",
      requestId: randomUUID(),
      purpose: "enrolment-request-review",
    };

    const withoutAppCheck = await call(request, "approveEnrolmentRequest", payload, {
      idToken: ownerToken,
      appCheck: false,
    });
    expect(withoutAppCheck.status).toBeGreaterThanOrEqual(400);

    const withoutSession = await call(request, "approveEnrolmentRequest", payload, {});
    expect(withoutSession.status).toBeGreaterThanOrEqual(400);

    // The applicant holds a real client claim and still cannot approve or read the detail.
    const asClient = await call(request, "approveEnrolmentRequest", payload, {
      idToken: applicantToken,
    });
    expect(asClient.status).toBeGreaterThanOrEqual(400);
    expect(asClient.body.error?.status).toBe("PERMISSION_DENIED");

    const detailAsClient = await call(
      request,
      "getEnrolmentRequestDetail",
      { enrolmentRequestId: "enrolment-does-not-matter", purpose: "enrolment-request-review" },
      { idToken: applicantToken },
    );
    expect(detailAsClient.body.error?.status).toBe("PERMISSION_DENIED");
  });
});
