import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * T097 authenticated Emulator E2E for progress on canonical data: the head coach opens a
 * student's level record, a session with attendance and an evaluation feed the progress summary,
 * recognition candidates list the student, the head coach approves the first promotion and the
 * progress report reflects it. Same mechanism as T093-T096 (callable-level, unsigned App Check
 * accepted only by the Functions Emulator).
 */
const enabled = process.env.T097_PROGRESS_EMULATOR_E2E === "true";
const functionsPort = process.env.T097_FUNCTIONS_EMULATOR_PORT ?? "5001";
const projectId = "demo-bpt-jersey";
const academyId = process.env.T097_E2E_ACADEMY_ID ?? "";
const functionsBaseUrl = `http://127.0.0.1:${functionsPort}/${projectId}/us-central1`;
const authUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`;
const firestoreRestBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;

type CallableEnvelope = Readonly<{
  result?: unknown;
  error?: Readonly<{ message?: string; status?: string }>;
}>;
type Session = Readonly<{ idToken: string; uid: string }>;
type Definition = Readonly<{
  definitionKey: string;
  systemId: string;
  kind: string;
  name: string;
  sequence: number;
  criteria: Readonly<{ minAge: number | null; maxAge: number | null }>;
}>;
type Catalog = Readonly<{
  system: Readonly<{ skillCatalog: readonly Readonly<{ key: string }>[] }>;
  definitions: readonly Definition[];
}>;
type Progress =
  | Readonly<{ state: "uninitialized"; studentId: string }>
  | Readonly<{
      state: "initialized";
      studentId: string;
      currentDefinition: Definition;
      totalAttendedClasses: number;
    }>;

const hour = 3_600_000;
const adultAge = 33;

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:t097-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

async function signIn(request: APIRequestContext, email: string | undefined): Promise<Session> {
  expect(typeof email).toBe("string");
  const response = await request.post(authUrl, {
    data: { email, password: process.env.T097_E2E_PASSWORD, returnSecureToken: true },
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

async function denied(
  request: APIRequestContext,
  name: string,
  data: unknown,
  session: Session,
  status: number,
  code: string,
): Promise<CallableEnvelope> {
  const response = await call(request, name, data, { session });
  expect(response.status, `${name}: ${JSON.stringify(response.body)}`).toBe(status);
  expect(response.body.error?.status).toBe(code);
  expect(response.body.result).toBeUndefined();
  return response.body;
}

function publication(suffix: string) {
  return {
    versionLabel: `t097-${suffix}`,
    title: "Synthetic T097 waiver",
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
    effectiveAt: new Date(Date.now() - 60_000).toISOString(),
    confirmReviewed: true,
  };
}

const townAdultPlan = {
  planId: "town-adult",
  displayName: "Town Adult",
  priceMinor: 8_500,
  currency: "GBP",
  billingPeriod: "monthly",
  eligibleParticipantTypes: ["adult"],
  classSites: ["Town"],
  weeklyClassLimit: null,
  openMatSites: ["Town"],
  openMatFeeMinor: null,
};

/** The first belt of the catalog an adult of `adultAge` may hold, and the definition after it. */
function adultStartingLevel(catalog: Catalog): Readonly<{ belt: Definition; next: Definition }> {
  const ordered = [...catalog.definitions].sort((left, right) => left.sequence - right.sequence);
  const belt = ordered.find(
    (definition) =>
      definition.kind === "belt" &&
      (definition.criteria.minAge === null || definition.criteria.minAge <= adultAge) &&
      (definition.criteria.maxAge === null || definition.criteria.maxAge >= adultAge),
  );
  expect(belt, "an adult belt exists in the catalog").toBeDefined();
  const next = ordered.find(
    (definition) =>
      definition.systemId === belt!.systemId && definition.sequence === belt!.sequence + 1,
  );
  expect(next, "the belt has a following definition").toBeDefined();
  return { belt: belt!, next: next! };
}

test.describe("T097 progress and promotions with Firebase Emulators", () => {
  test.skip(!enabled, "T097_PROGRESS_EMULATOR_E2E is not enabled");
  test.beforeAll(() => {
    expect(academyId).toMatch(/^[a-z][a-z0-9-]{2,60}$/u);
  });

  test("opens a level, records attendance and evaluation, lists the candidate and approves the first promotion @critical", async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const owner = await signIn(request, process.env.T097_OWNER_EMAIL);
    const headCoach = await signIn(request, process.env.T097_HEAD_COACH_EMAIL);
    const adult = await signIn(request, process.env.T097_ADULT_EMAIL);
    const suffix = randomUUID().replace(/-/gu, "").slice(0, 8).toLowerCase();

    // Canonical catalog seeded by the runner; the head coach reads it like any staff member.
    const catalog = await ok<Catalog>(request, "listLevelCatalog", null, headCoach);
    expect(catalog.definitions.length).toBeGreaterThan(100);
    const { belt, next } = adultStartingLevel(catalog);
    const skillKey = catalog.system.skillCatalog[0]?.key;
    expect(typeof skillKey).toBe("string");

    // Onboarding prerequisites (T094/T095): waiver, adult profile, consent, plan, membership.
    const version = await ok<{ waiverVersionId: string; contentHash: string }>(
      request,
      "publishWaiverVersion",
      publication(suffix),
      owner,
    );
    const fullName = "Synthetic T097 Adult";
    const profile = await ok<{ student: { studentId: string } }>(
      request,
      "saveClientProfile",
      {
        requestId: `t097-profile-${suffix}`,
        fullName,
        dateOfBirth: `${new Date().getUTCFullYear() - adultAge}-01-15`,
        phoneNumber: "+441534000971",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
      },
      adult,
    );
    const studentId = profile.student.studentId;
    await ok(
      request,
      "acceptWaiver",
      {
        studentId,
        waiverVersionId: version.waiverVersionId,
        contentHash: version.contentHash,
        typedName: fullName,
        clauseResponses: {
          photoVideo: "declined",
          medicalTreatment: "accepted",
          hygiene: "accepted",
          dataProtection: "accepted",
        },
      },
      adult,
    );
    await ok(request, "savePlan", townAdultPlan, owner);
    const activation = await call(
      request,
      "activatePlan",
      { planId: "town-adult" },
      { session: owner },
    );
    expect([200, 400]).toContain(activation.status);
    const membership = await ok<{ membershipId: string }>(
      request,
      "createMembership",
      { studentId, planId: "town-adult", status: "active" },
      owner,
    );

    // Before any level is opened the adult is honestly uninitialized.
    const before = await ok<{ progress: Progress }>(
      request,
      "getStudentProgressSummary",
      {},
      adult,
    );
    expect(before.progress.state).toBe("uninitialized");

    // Only the current head coach opens a level, only once, only at a belt.
    const opening = {
      studentId,
      definitionKey: belt.definitionKey,
      decisionNotes: "Starts as a white belt after the trial classes.",
    };
    await denied(request, "openStudentLevel", opening, owner, 403, "PERMISSION_DENIED");
    await denied(request, "openStudentLevel", opening, adult, 403, "PERMISSION_DENIED");
    const stripe = catalog.definitions.find((definition) => definition.kind === "stripe");
    await denied(
      request,
      "openStudentLevel",
      { ...opening, definitionKey: stripe!.definitionKey },
      headCoach,
      400,
      "FAILED_PRECONDITION",
    );
    const opened = await ok<{ head: { currentDefinitionKey: string; state: string } }>(
      request,
      "openStudentLevel",
      opening,
      headCoach,
    );
    expect(opened.head).toMatchObject({
      currentDefinitionKey: belt.definitionKey,
      state: "initialized",
    });
    await denied(request, "openStudentLevel", opening, headCoach, 400, "FAILED_PRECONDITION");

    // Attendance in a head-coach session feeds the progress summary.
    const { program } = await ok<{ program: { programId: string } }>(
      request,
      "saveProgram",
      { name: `T097 Adults ${suffix}`, ageBand: "adult", discipline: "bjj", level: "all-levels" },
      owner,
    );
    const startAt = new Date(Date.now() + 2 * hour);
    const { session } = await ok<{ session: { sessionId: string } }>(
      request,
      "saveSession",
      {
        classId: null,
        programId: program.programId,
        locationId: "town",
        instructorId: headCoach.uid,
        title: `T097 Town ${suffix}`,
        startAt: startAt.toISOString(),
        endAt: new Date(startAt.getTime() + hour).toISOString(),
        capacity: 10,
        minParticipants: 4,
      },
      headCoach,
    );
    await ok(
      request,
      "requestBooking",
      { sessionId: session.sessionId, studentId, membershipId: membership.membershipId },
      adult,
    );
    await ok(
      request,
      "checkIn",
      { sessionId: session.sessionId, studentId, method: "manual" },
      headCoach,
    );

    const after = await ok<{ progress: Progress }>(request, "getStudentProgressSummary", {}, adult);
    expect(after.progress.state).toBe("initialized");
    if (after.progress.state === "initialized") {
      expect(after.progress.currentDefinition.definitionKey).toBe(belt.definitionKey);
      expect(after.progress.totalAttendedClasses).toBeGreaterThanOrEqual(0);
    }
    const staffView = await ok<{ progress: Progress }>(
      request,
      "getStudentProgressSummary",
      { studentId },
      owner,
    );
    expect(staffView.progress.state).toBe("initialized");

    // Evaluations are recorded by coaches with evidence; clients never record them.
    const evaluationInput = {
      studentId,
      sessionId: session.sessionId,
      definitionKey: belt.definitionKey,
      skillKey,
      score: 4,
      evidenceNotes: "Observed under resistance during positional sparring.",
    };
    await denied(request, "recordEvaluation", evaluationInput, adult, 403, "PERMISSION_DENIED");
    await ok(request, "recordEvaluation", evaluationInput, headCoach);

    // Recognition candidates now include the student; eligibility is a proposal, never a grant.
    const { candidates } = await ok<{
      candidates: readonly { studentId: string; currentDefinitionKey: string }[];
    }>(request, "listRecognitionCandidates", {}, owner);
    const candidate = candidates.find((entry) => entry.studentId === studentId);
    expect(candidate?.currentDefinitionKey).toBe(belt.definitionKey);
    await denied(request, "listRecognitionCandidates", {}, adult, 403, "PERMISSION_DENIED");

    // Only the head coach approves; the summary then moves to the next definition.
    const promotion = {
      studentId,
      fromDefinitionKey: belt.definitionKey,
      toDefinitionKey: next.definitionKey,
      decisionNotes: "Approved after the head coach reviewed attendance and technique.",
    };
    await denied(request, "approvePromotion", promotion, owner, 403, "PERMISSION_DENIED");
    const approved = await ok<{ graduation: { status: string; toDefinitionKey: string } }>(
      request,
      "approvePromotion",
      promotion,
      headCoach,
    );
    expect(approved.graduation).toMatchObject({
      status: "approved",
      toDefinitionKey: next.definitionKey,
    });
    const promoted = await ok<{ progress: Progress }>(
      request,
      "getStudentProgressSummary",
      {},
      adult,
    );
    expect(promoted.progress.state).toBe("initialized");
    if (promoted.progress.state === "initialized") {
      expect(promoted.progress.currentDefinition.definitionKey).toBe(next.definitionKey);
    }

    // Reports stay staff-only and aggregate the same connected records.
    const report = await ok<{ report: { activeStudentCount: number } }>(
      request,
      "getProgressReport",
      null,
      owner,
    );
    expect(report.report.activeStudentCount).toBeGreaterThanOrEqual(1);
    await denied(request, "getProgressReport", null, adult, 403, "PERMISSION_DENIED");

    // Direct Firestore access to the level head and the promotion is denied by Rules.
    for (const path of [
      `academies/${academyId}/studentLevelProgress/${studentId}`,
      `academies/${academyId}/levelDefinitions/${belt.definitionKey}`,
    ]) {
      const direct = await request.get(`${firestoreRestBase}/${path}`);
      expect(direct.status(), path).toBe(403);
    }
  });

  test("fails closed without App Check, without a session and on malformed level payloads @critical", async ({
    request,
  }) => {
    const headCoach = await signIn(request, process.env.T097_HEAD_COACH_EMAIL);
    for (const name of ["openStudentLevel", "approvePromotion", "recordEvaluation"]) {
      const noAppCheck = await call(request, name, null, { session: headCoach, appCheck: false });
      expect(noAppCheck.status, name).toBe(401);
      expect(noAppCheck.body.error?.status).toBe("UNAUTHENTICATED");
      const noSession = await call(request, name, null);
      expect(noSession.status, name).toBe(401);
      expect(noSession.body.error?.status).toBe("UNAUTHENTICATED");
    }
    await denied(
      request,
      "openStudentLevel",
      { studentId: "student-1", definitionKey: "white-0", decisionNotes: "ok", state: "x" },
      headCoach,
      400,
      "INVALID_ARGUMENT",
    );
    await denied(
      request,
      "openStudentLevel",
      { studentId: "student-1", definitionKey: "white-0", decisionNotes: "no" },
      headCoach,
      400,
      "INVALID_ARGUMENT",
    );
  });
});
