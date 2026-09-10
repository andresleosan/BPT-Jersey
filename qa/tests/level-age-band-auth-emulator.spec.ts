import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * T113 authenticated Emulator E2E for the age bands of the level catalog: two children of the same
 * family are opened at the same kids belt, one inside the band of the next rank and one below it,
 * and only the one inside it is proposed for recognition.
 *
 * The BRIEF says the DOCX govern age, classes and time, and every one of the 171 definitions of the
 * catalog carries a band. The rule only filters candidates and proposals: belts and stripes are
 * still never granted automatically, and the head coach may still open a level outside the band,
 * which this spec asserts rather than assumes.
 *
 * Same mechanism as T093-T098: the web client is App Check fail-closed, so the spec drives the
 * callables directly with real Auth Emulator sessions and an unsigned App Check token that only
 * the Functions Emulator (skipTokenVerification) accepts.
 */
const enabled = process.env.T113_AGE_BAND_EMULATOR_E2E === "true";
const functionsPort = process.env.T113_FUNCTIONS_EMULATOR_PORT ?? "5001";
const projectId = "demo-bpt-jersey";
const academyId = process.env.T113_E2E_ACADEMY_ID ?? "";
const functionsBaseUrl = `http://127.0.0.1:${functionsPort}/${projectId}/us-central1`;
const authUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`;

type CallableEnvelope = Readonly<{
  result?: unknown;
  error?: Readonly<{ message?: string; status?: string }>;
}>;
type Session = Readonly<{ idToken: string; uid: string }>;
type Criteria = Readonly<{ minAge: number | null; maxAge: number | null }>;
type Definition = Readonly<{
  definitionKey: string;
  kind: string;
  name: string;
  sequence: number;
  criteria: Criteria;
}>;
type Catalog = Readonly<{ definitions: readonly Definition[] }>;
type AgeCriterion = Readonly<{
  requiredMinAge: number | null;
  requiredMaxAge: number | null;
  ageYears: number | null;
  met: boolean;
}>;
type Progress =
  | Readonly<{ state: "uninitialized"; studentId: string }>
  | Readonly<{
      state: "initialized";
      studentId: string;
      currentDefinition: Definition;
      targetDefinition: Definition | null;
      criteria: Readonly<{ age: AgeCriterion; overallEligible: boolean }>;
    }>;
type Candidate = Readonly<{
  studentId: string;
  currentDefinitionKey: string;
  targetDefinitionKey: string;
  isEligibleForPromotion: boolean;
  readinessPercentage: number;
  reasons: readonly string[];
}>;

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Unsigned, emulator-only App Check token. It is never accepted outside skipTokenVerification.
function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:t113-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

async function signIn(request: APIRequestContext, email: string | undefined): Promise<Session> {
  expect(typeof email).toBe("string");
  const response = await request.post(authUrl, {
    data: { email, password: process.env.T113_E2E_PASSWORD, returnSecureToken: true },
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
): Promise<void> {
  const response = await call(request, name, data, { session });
  expect(response.status, `${name}: ${JSON.stringify(response.body)}`).toBe(status);
  expect(response.body.error?.status).toBe(code);
  expect(response.body.result).toBeUndefined();
}

/**
 * A kids belt whose NEXT rank carries a closed band that keeps both synthetic children minors, so
 * the family flow accepts them. Derived from the catalog rather than hard-coded, because the band
 * of a rank is data the DOCX own.
 */
function beltWithBoundedNextBand(
  catalog: Catalog,
): Readonly<{ belt: Definition; target: Definition; minAge: number; maxAge: number }> {
  const ordered = [...catalog.definitions].sort((left, right) => left.sequence - right.sequence);
  for (const belt of ordered) {
    if (belt.kind !== "belt") continue;
    const target = ordered.find((entry) => entry.sequence === belt.sequence + 1);
    const minAge = target?.criteria.minAge ?? null;
    const maxAge = target?.criteria.maxAge ?? null;
    if (target === undefined || minAge === null || maxAge === null) continue;
    // Room for a child one year below the band who is still old enough to be enrolled.
    if (minAge < 5 || maxAge > 15) continue;
    return { belt, target, minAge, maxAge };
  }
  throw new Error("The catalog has no kids belt whose next rank carries a closed age band");
}

/** A date of birth that makes a child exactly `years` old today. */
function bornForAge(years: number): string {
  const today = new Date();
  return `${today.getUTCFullYear() - years}-01-05`;
}

test.describe("T113 level age bands with Firebase Emulators", () => {
  test.skip(!enabled, "T113_AGE_BAND_EMULATOR_E2E is not enabled");
  test.beforeAll(() => {
    expect(academyId).toMatch(/^[a-z][a-z0-9-]{2,60}$/u);
  });

  test("proposes only the child the catalog band allows @critical", async ({ request }) => {
    test.setTimeout(120_000);
    const owner = await signIn(request, process.env.T113_OWNER_EMAIL);
    const headCoach = await signIn(request, process.env.T113_HEAD_COACH_EMAIL);
    const guardian = await signIn(request, process.env.T113_GUARDIAN_EMAIL);
    const suffix = randomUUID().replace(/-/gu, "").slice(0, 8).toLowerCase();

    const catalog = await ok<Catalog>(request, "listLevelCatalog", null, headCoach);
    const { belt, target, minAge, maxAge } = beltWithBoundedNextBand(catalog);

    // One family, two children of the same belt: one inside the band of the next rank and one a
    // year below it. Everything else about them is identical.
    const guardianName = `Synthetic T113 Guardian ${suffix}`;
    await ok(
      request,
      "saveGuardianProfile",
      {
        requestId: `t113-guardian-${suffix}`,
        displayName: guardianName,
        phoneNumber: "+441534000991",
      },
      guardian,
    );
    const emergencyContact = {
      fullName: guardianName,
      relationship: "Parent",
      phoneNumber: "+441534000991",
    };
    const family = await ok<{ students: readonly { studentId: string; fullName: string }[] }>(
      request,
      "createFamily",
      {
        requestId: `t113-family-${suffix}`,
        tutorUserId: guardian.uid,
        students: [
          {
            fullName: `T113 In Band ${suffix}`,
            dateOfBirth: bornForAge(minAge),
            trainingCenter: "Town",
            trainingTimePreferences: ["afternoon"],
            emergencyContact,
          },
          {
            fullName: `T113 Below Band ${suffix}`,
            dateOfBirth: bornForAge(minAge - 1),
            trainingCenter: "Town",
            trainingTimePreferences: ["afternoon"],
            emergencyContact,
          },
        ],
      },
      owner,
    );
    const inBandId = family.students.find((student) =>
      student.fullName.startsWith("T113 In Band"),
    )!.studentId;
    const belowBandId = family.students.find((student) =>
      student.fullName.startsWith("T113 Below Band"),
    )!.studentId;

    // The band filters proposals; it does not police the head coach. Opening a level is still their
    // decision, and it succeeds for both children.
    for (const studentId of [inBandId, belowBandId]) {
      await ok(
        request,
        "openStudentLevel",
        {
          studentId,
          definitionKey: belt.definitionKey,
          decisionNotes: "Starts at the kids belt after the trial classes.",
        },
        headCoach,
      );
    }

    // The summary reports the band of the rank the child would move into, and its own verdict.
    const inBand = await ok<{ progress: Progress }>(
      request,
      "getStudentProgressSummary",
      { studentId: inBandId },
      owner,
    );
    expect(inBand.progress.state).toBe("initialized");
    if (inBand.progress.state === "initialized") {
      expect(inBand.progress.targetDefinition?.definitionKey).toBe(target.definitionKey);
      expect(inBand.progress.criteria.age).toEqual({
        requiredMinAge: minAge,
        requiredMaxAge: maxAge,
        ageYears: minAge,
        met: true,
      });
    }

    const belowBand = await ok<{ progress: Progress }>(
      request,
      "getStudentProgressSummary",
      { studentId: belowBandId },
      owner,
    );
    expect(belowBand.progress.state).toBe("initialized");
    if (belowBand.progress.state === "initialized") {
      expect(belowBand.progress.criteria.age).toEqual({
        requiredMinAge: minAge,
        requiredMaxAge: maxAge,
        ageYears: minAge - 1,
        met: false,
      });
      expect(belowBand.progress.criteria.overallEligible).toBe(false);
    }

    // The recognition list carries the band as an explanation, and only for the child it holds back.
    const { candidates } = await ok<{ candidates: readonly Candidate[] }>(
      request,
      "listRecognitionCandidates",
      {},
      owner,
    );
    const inBandCandidate = candidates.find((entry) => entry.studentId === inBandId);
    const belowBandCandidate = candidates.find((entry) => entry.studentId === belowBandId);
    expect(inBandCandidate?.targetDefinitionKey).toBe(target.definitionKey);
    expect(belowBandCandidate?.targetDefinitionKey).toBe(target.definitionKey);
    expect(belowBandCandidate?.isEligibleForPromotion).toBe(false);
    expect(belowBandCandidate?.reasons ?? []).toContain(
      `Age: ${minAge - 1} against band ${minAge}-${maxAge} (Not met)`,
    );
    expect((inBandCandidate?.reasons ?? []).join(" ")).not.toContain("Age:");
    // Getting older is not training, so the readiness bar of the two children is the same.
    expect(inBandCandidate?.readinessPercentage).toBe(belowBandCandidate?.readinessPercentage);

    // Neither child is promoted by any of this: the head coach still decides, and clients never
    // read the recognition list at all.
    await denied(request, "listRecognitionCandidates", {}, guardian, 403, "PERMISSION_DENIED");
    const stillThere = await ok<{ progress: Progress }>(
      request,
      "getStudentProgressSummary",
      { studentId: belowBandId },
      guardian,
    );
    if (stillThere.progress.state === "initialized") {
      expect(stillThere.progress.currentDefinition.definitionKey).toBe(belt.definitionKey);
    }
  });
});
