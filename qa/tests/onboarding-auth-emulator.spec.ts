import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * T094 authenticated Emulator E2E for client onboarding.
 *
 * The browser path cannot run offline: the web client is App Check fail-closed and the SDK only
 * attaches an App Check header after a real token exchange. The Functions Emulator, however, runs
 * with `skipTokenVerification`, so an unsigned App Check JWT is decoded (not verified) and
 * `request.app` is populated. This spec therefore drives the deployed callable surface directly,
 * exactly as the web client does, with real Auth Emulator sessions for an owner, an adult student
 * and a guardian. Waiver evidence PDFs land in the emulator-only in-process private store.
 */
const enabled = process.env.T094_ONBOARDING_EMULATOR_E2E === "true";
const functionsPort = process.env.T094_FUNCTIONS_EMULATOR_PORT ?? "5001";
const projectId = "demo-bpt-jersey";
const academyId = process.env.T094_E2E_ACADEMY_ID ?? "";
const functionsBaseUrl = `http://127.0.0.1:${functionsPort}/${projectId}/us-central1`;
const authUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`;
const firestoreRestBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;

type CallableEnvelope = Readonly<{
  result?: unknown;
  error?: Readonly<{ message?: string; status?: string }>;
}>;
type Session = Readonly<{ idToken: string; uid: string }>;
type ClauseResponses = Readonly<Record<string, "accepted" | "declined">>;
type WaiverVersion = Readonly<{ waiverVersionId: string; contentHash: string }>;
type Consent = Readonly<{
  consentId: string;
  studentId: string;
  status: string;
  evidenceDocumentId: string;
  revokedAt: string | null;
}>;
type Registration = Readonly<{
  currentVersion: WaiverVersion | null;
  subjects: readonly Readonly<{
    studentId: string;
    participantType: string;
    consent: Consent | null;
  }>[];
}>;

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Unsigned, emulator-only App Check token. It is never accepted outside skipTokenVerification.
function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:t094-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

async function signIn(request: APIRequestContext, email: string | undefined): Promise<Session> {
  expect(typeof email).toBe("string");
  const response = await request.post(authUrl, {
    data: { email, password: process.env.T094_E2E_PASSWORD, returnSecureToken: true },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { idToken?: string; localId?: string };
  expect(typeof body.idToken).toBe("string");
  expect(typeof body.localId).toBe("string");
  return { idToken: body.idToken as string, uid: body.localId as string };
}

async function call(
  request: APIRequestContext,
  name: string,
  data: unknown,
  options: Readonly<{ session?: Session; appCheck?: boolean }> = {},
): Promise<Readonly<{ status: number; body: CallableEnvelope }>> {
  const response = await request.post(`${functionsBaseUrl}/${name}`, {
    headers: {
      Accept: "application/json",
      ...(options.session ? { Authorization: `Bearer ${options.session.idToken}` } : {}),
      ...(options.appCheck === false ? {} : { "X-Firebase-AppCheck": syntheticAppCheckToken() }),
    },
    data: { data },
  });
  return { status: response.status(), body: (await response.json()) as CallableEnvelope };
}

async function ok<T>(
  request: APIRequestContext,
  name: string,
  data: unknown,
  session: Session,
): Promise<T> {
  const response = await call(request, name, data, { session });
  expect(response.status, `${name}: ${JSON.stringify(response.body)}`).toBe(200);
  return response.body.result as T;
}

const acceptedResponses: ClauseResponses = {
  photoVideo: "declined",
  medicalTreatment: "accepted",
  hygiene: "accepted",
  dataProtection: "accepted",
};

function publication(suffix: string) {
  return {
    versionLabel: `t094-${suffix}`,
    title: "Synthetic T094 waiver",
    introduction: "Synthetic emulator wording. Not the official waiver text.",
    clauses: [
      {
        key: "photoVideo",
        heading: "Photo and video",
        body: "Synthetic media clause.",
        required: false,
      },
      {
        key: "medicalTreatment",
        heading: "Medical treatment",
        body: "Synthetic medical clause.",
        required: true,
      },
      { key: "hygiene", heading: "Hygiene", body: "Synthetic hygiene clause.", required: true },
      {
        key: "dataProtection",
        heading: "Data protection",
        body: "Synthetic data clause.",
        required: true,
      },
    ],
    // One minute in the past so the version is effective for the registrations that follow.
    effectiveAt: new Date(Date.now() - 60_000).toISOString(),
    confirmReviewed: true,
  };
}

test.describe("T094 client onboarding with Firebase Emulators", () => {
  test.skip(!enabled, "T094_ONBOARDING_EMULATOR_E2E is not enabled");
  test.beforeAll(() => {
    expect(academyId).toMatch(/^[a-z][a-z0-9-]{2,60}$/u);
  });

  test("onboards an adult through profile, waiver acceptance, evidence and revocation @critical", async ({
    request,
  }) => {
    const owner = await signIn(request, process.env.T094_OWNER_EMAIL);
    const adult = await signIn(request, process.env.T094_ADULT_EMAIL);
    const suffix = randomUUID().replace(/-/gu, "").slice(0, 8).toLowerCase();

    const version = await ok<WaiverVersion>(
      request,
      "publishWaiverVersion",
      publication(suffix),
      owner,
    );
    expect(version.contentHash).toMatch(/^[a-f0-9]{64}$/u);

    // Profile: creates users/{uid} and the adult students/{id} inside the canonical directory.
    const profileInput = {
      requestId: `t094-profile-${suffix}`,
      fullName: "Synthetic T094 Adult",
      dateOfBirth: "1991-04-05",
      phoneNumber: "+441534000941",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
    };
    const profile = await ok<{
      user: { userId: string; accountType: string };
      student: { studentId: string; participantType: string };
    }>(request, "saveClientProfile", profileInput, adult);
    expect(profile.user.userId).toBe(adult.uid);
    expect(profile.user.accountType).toBe("client");
    expect(profile.student.participantType).toBe("adult");
    const studentId = profile.student.studentId;

    // Exact replay is idempotent: same student, no second profile.
    const replay = await ok<typeof profile>(request, "saveClientProfile", profileInput, adult);
    expect(replay.student.studentId).toBe(studentId);

    // Registration lists the published version and the adult as the only subject.
    const before = await ok<Registration>(request, "getWaiverRegistration", null, adult);
    expect(before.currentVersion?.waiverVersionId).toBe(version.waiverVersionId);
    expect(before.subjects.map((subject) => subject.studentId)).toEqual([studentId]);
    expect(before.subjects[0]?.consent).toBeNull();

    // A required clause cannot be declined, and the typed name must match the signer.
    const acceptance = {
      studentId,
      waiverVersionId: version.waiverVersionId,
      contentHash: version.contentHash,
      typedName: profileInput.fullName,
      clauseResponses: acceptedResponses,
    };
    const declinedRequired = await call(
      request,
      "acceptWaiver",
      { ...acceptance, clauseResponses: { ...acceptedResponses, hygiene: "declined" } },
      { session: adult },
    );
    expect(declinedRequired.status).toBe(400);
    expect(declinedRequired.body.error?.status).toBe("FAILED_PRECONDITION");
    const wrongName = await call(
      request,
      "acceptWaiver",
      { ...acceptance, typedName: "Somebody Else" },
      { session: adult },
    );
    expect(wrongName.status).toBe(400);
    expect(wrongName.body.error?.status).toBe("FAILED_PRECONDITION");

    // Acceptance writes consent, evidence document and PDF atomically; replay returns the same consent.
    const consent = await ok<Consent>(request, "acceptWaiver", acceptance, adult);
    expect(consent.status).toBe("accepted");
    expect(consent.studentId).toBe(studentId);
    expect(consent.evidenceDocumentId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
    const consentReplay = await ok<Consent>(request, "acceptWaiver", acceptance, adult);
    expect(consentReplay.consentId).toBe(consent.consentId);

    const after = await ok<Registration>(request, "getWaiverRegistration", null, adult);
    expect(after.subjects[0]?.consent?.consentId).toBe(consent.consentId);

    // Evidence download is a short-lived signed URL; in the emulator it points at a reserved host.
    const evidence = await ok<{ consent: Consent; downloadUrl: string; expiresAt: string }>(
      request,
      "getWaiverEvidenceDownload",
      { consentId: consent.consentId },
      adult,
    );
    expect(evidence.consent.consentId).toBe(consent.consentId);
    const downloadUrl = new URL(evidence.downloadUrl);
    expect(downloadUrl.protocol).toBe("https:");
    expect(downloadUrl.hostname.endsWith(".invalid")).toBe(true);
    expect(Date.parse(evidence.expiresAt)).toBeGreaterThan(Date.now());
    expect(JSON.stringify(evidence)).not.toMatch(/R2_|secret|accessKey/iu);

    // Revocation is final for that version: a fresh acceptance conflicts instead of re-signing.
    const revoked = await ok<Consent>(
      request,
      "revokeWaiverConsent",
      { consentId: consent.consentId },
      adult,
    );
    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).not.toBeNull();
    const reaccept = await call(request, "acceptWaiver", acceptance, { session: adult });
    expect(reaccept.status).toBe(400);
    expect(reaccept.body.error?.status).toBe("FAILED_PRECONDITION");

    // Direct Firestore access to consents and evidence is denied by Rules even in the Emulator.
    for (const path of [
      `academies/${academyId}/consents/${consent.consentId}`,
      `academies/${academyId}/documents/${consent.evidenceDocumentId}`,
      `academies/${academyId}/students/${studentId}`,
    ]) {
      const direct = await request.get(`${firestoreRestBase}/${path}`);
      expect(direct.status(), path).toBe(403);
    }
  });

  test("onboards a guardian with a minor and keeps consent scopes isolated @critical", async ({
    request,
  }) => {
    const owner = await signIn(request, process.env.T094_OWNER_EMAIL);
    const adult = await signIn(request, process.env.T094_ADULT_EMAIL);
    const guardian = await signIn(request, process.env.T094_GUARDIAN_EMAIL);
    const suffix = randomUUID().replace(/-/gu, "").slice(0, 8).toLowerCase();

    const version = await ok<WaiverVersion>(
      request,
      "publishWaiverVersion",
      publication(suffix),
      owner,
    );

    // Guardian profile creates the client users/{uid} document the family writer requires.
    const guardianName = "Synthetic T094 Guardian";
    const guardianProfile = await ok<{ userId: string; accountType: string; displayName: string }>(
      request,
      "saveGuardianProfile",
      {
        requestId: `t094-guardian-${suffix}`,
        displayName: guardianName,
        phoneNumber: "+441534000942",
      },
      guardian,
    );
    expect(guardianProfile.userId).toBe(guardian.uid);
    expect(guardianProfile.accountType).toBe("client");

    // A guardian never gets an adult student profile of their own.
    const guardianAsAdult = await call(
      request,
      "saveClientProfile",
      {
        requestId: `t094-guardian-adult-${suffix}`,
        fullName: guardianName,
        dateOfBirth: "1985-01-02",
        phoneNumber: "+441534000942",
        trainingCenter: "West",
        trainingTimePreferences: ["morning"],
      },
      { session: guardian },
    );
    expect(guardianAsAdult.status).toBe(403);
    expect(guardianAsAdult.body.error?.status).toBe("PERMISSION_DENIED");

    // Staff enrols the minor and links the guardian in one transaction.
    const family = await ok<{
      students: readonly { studentId: string; participantType: string }[];
    }>(
      request,
      "createFamily",
      {
        requestId: `t094-family-${suffix}`,
        tutorUserId: guardian.uid,
        students: [
          {
            fullName: `Synthetic T094 Minor ${suffix}`,
            dateOfBirth: "2016-03-02",
            trainingCenter: "West",
            trainingTimePreferences: ["afternoon"],
            emergencyContact: {
              fullName: guardianName,
              relationship: "Parent",
              phoneNumber: "+441534000942",
            },
          },
        ],
      },
      owner,
    );
    expect(family.students).toHaveLength(1);
    const minorId = family.students[0]!.studentId;
    expect(family.students[0]!.participantType).toBe("minor");

    // The guardian sees the minor as a subject; the adult never does.
    const registration = await ok<Registration>(request, "getWaiverRegistration", null, guardian);
    const subject = registration.subjects.find((candidate) => candidate.studentId === minorId);
    expect(subject?.participantType).toBe("minor");
    expect(subject?.consent).toBeNull();
    const adultRegistration = await ok<Registration>(request, "getWaiverRegistration", null, adult);
    expect(adultRegistration.subjects.map((candidate) => candidate.studentId)).not.toContain(
      minorId,
    );

    const acceptance = {
      studentId: minorId,
      waiverVersionId: version.waiverVersionId,
      contentHash: version.contentHash,
      typedName: guardianName,
      clauseResponses: acceptedResponses,
    };
    // An adult cannot sign for someone else's minor.
    const crossScope = await call(
      request,
      "acceptWaiver",
      { ...acceptance, typedName: "Synthetic T094 Adult" },
      { session: adult },
    );
    expect(crossScope.status).toBe(403);
    expect(crossScope.body.error?.status).toBe("PERMISSION_DENIED");

    const consent = await ok<Consent>(request, "acceptWaiver", acceptance, guardian);
    expect(consent.status).toBe("accepted");
    expect(consent.studentId).toBe(minorId);

    // Evidence is readable by the signing guardian and staff, never by an unrelated adult.
    const guardianEvidence = await ok<{ downloadUrl: string }>(
      request,
      "getWaiverEvidenceDownload",
      { consentId: consent.consentId },
      guardian,
    );
    expect(new URL(guardianEvidence.downloadUrl).protocol).toBe("https:");
    const staffEvidence = await ok<{ consent: Consent }>(
      request,
      "getWaiverEvidenceDownload",
      { consentId: consent.consentId },
      owner,
    );
    expect(staffEvidence.consent.consentId).toBe(consent.consentId);
    const adultEvidence = await call(
      request,
      "getWaiverEvidenceDownload",
      { consentId: consent.consentId },
      { session: adult },
    );
    expect(adultEvidence.status).toBe(403);
    expect(adultEvidence.body.error?.status).toBe("PERMISSION_DENIED");
    expect(JSON.stringify(adultEvidence.body)).not.toContain(minorId);
  });

  test("fails closed without App Check, without a session and with a malformed payload @critical", async ({
    request,
  }) => {
    const adult = await signIn(request, process.env.T094_ADULT_EMAIL);

    for (const name of ["saveClientProfile", "getWaiverRegistration", "acceptWaiver"]) {
      const noAppCheck = await call(request, name, null, { session: adult, appCheck: false });
      expect(noAppCheck.status, name).toBe(401);
      expect(noAppCheck.body.error?.status).toBe("UNAUTHENTICATED");

      const noSession = await call(request, name, null);
      expect(noSession.status, name).toBe(401);
      expect(noSession.body.error?.status).toBe("UNAUTHENTICATED");
    }

    // Unknown keys and non-canonical payloads are rejected before any read or write.
    const extraKey = await call(
      request,
      "saveClientProfile",
      {
        requestId: "t094-invalid",
        fullName: "Synthetic T094 Adult",
        dateOfBirth: "1991-04-05",
        phoneNumber: "+441534000941",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
        role: "owner",
      },
      { session: adult },
    );
    expect(extraKey.status).toBe(400);
    expect(extraKey.body.error?.status).toBe("INVALID_ARGUMENT");
    const minorAsAdult = await call(
      request,
      "saveClientProfile",
      {
        requestId: "t094-minor",
        fullName: "Synthetic T094 Adult",
        dateOfBirth: "2015-04-05",
        phoneNumber: "+441534000941",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
      },
      { session: adult },
    );
    expect(minorAsAdult.status).toBe(400);
    expect(minorAsAdult.body.error?.status).toBe("INVALID_ARGUMENT");
  });
});
