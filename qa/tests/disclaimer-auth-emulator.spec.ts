import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * T117 authenticated Emulator E2E for manageable disclaimers.
 *
 * The property under test is that acceptance is bound to a version, not to a name. Office publishes
 * v1, the adult accepts it and their outstanding list empties; office publishes v2 of the same key
 * and the same participant is asked again, told it is a re-consent, while the v1 acceptance stays on
 * file as history. Accepting with a stale hash is refused.
 *
 * Every disclaimer here is written by the test. The platform ships no wording, and the legal text
 * for a real one is still blocked by T011.
 *
 * Same mechanism as T093-T098 and T111-T116: the web client is App Check fail-closed, so the spec
 * drives the callables directly with real Auth Emulator sessions and an unsigned App Check token
 * that only the Functions Emulator (skipTokenVerification) accepts.
 */
const enabled = process.env.T117_DISCLAIMER_EMULATOR_E2E === "true";
const functionsPort = process.env.T117_FUNCTIONS_EMULATOR_PORT ?? "5001";
const projectId = "demo-bpt-jersey";
const academyId = process.env.T117_E2E_ACADEMY_ID ?? "";
const functionsBaseUrl = `http://127.0.0.1:${functionsPort}/${projectId}/us-central1`;
const authUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`;
const firestoreRestBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;

type CallableEnvelope = Readonly<{
  result?: unknown;
  error?: Readonly<{ message?: string; status?: string }>;
}>;
type Session = Readonly<{ idToken: string; uid: string }>;
type Disclaimer = Readonly<{
  disclaimerId: string;
  key: string;
  versionLabel: string;
  contentHash: string;
  status: string;
}>;
type Outstanding = Readonly<{
  studentId: string;
  disclaimer: Disclaimer & Readonly<{ title: string; body: string; required: boolean }>;
  previouslyAcceptedVersionLabel: string | null;
}>;

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Unsigned, emulator-only App Check token. It is never accepted outside skipTokenVerification.
function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:t117-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

async function signIn(request: APIRequestContext, email: string | undefined): Promise<Session> {
  expect(typeof email).toBe("string");
  const response = await request.post(authUrl, {
    data: { email, password: process.env.T117_E2E_PASSWORD, returnSecureToken: true },
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

/** A key unique to this run, so repeated golden-path runs never collide on a published version. */
const runKey = `pilot-notice-${Date.now().toString(36)}`;

function publication(versionLabel: string, body: string, overrides: Record<string, unknown> = {}) {
  return {
    key: runKey,
    versionLabel,
    title: "Synthetic pilot notice",
    body,
    audience: "all",
    required: true,
    effectiveAt: new Date(Date.now() - 86_400_000).toISOString(),
    ...overrides,
  };
}

test.describe("T117 disclaimers with Firebase Emulators", () => {
  test.skip(!enabled, "T117_DISCLAIMER_EMULATOR_E2E is not enabled");

  test("an acceptance is bound to the version, not to the person", async ({ request }) => {
    expect(academyId.length).toBeGreaterThan(0);
    const owner = await signIn(request, process.env.T117_OWNER_EMAIL);
    const adult = await signIn(request, process.env.T117_ADULT_EMAIL);

    // The adult enrols themselves, which is what gives them a canonical student record.
    const profile = await ok<{ student: { studentId: string } }>(
      request,
      "saveClientProfile",
      {
        requestId: `t117-profile-${runKey}`,
        fullName: "Dana Disclaimer",
        dateOfBirth: "1994-04-04",
        phoneNumber: "+441534000117",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
      },
      adult,
    );
    const studentId = profile.student.studentId;

    // 1. Nothing published for this key yet, so nothing of it is outstanding.
    const before = await ok<{ outstanding: Outstanding[] }>(
      request,
      "getOutstandingDisclaimers",
      { studentId },
      adult,
    );
    expect(before.outstanding.some((entry) => entry.disclaimer.key === runKey)).toBe(false);

    // 2. Office publishes v1. Every word of it comes from this test.
    const v1 = await ok<{ disclaimer: Disclaimer }>(
      request,
      "publishDisclaimer",
      publication("v1", "Synthetic body, first version. No legal wording ships with the platform."),
      owner,
    );
    expect(v1.disclaimer).toMatchObject({ key: runKey, versionLabel: "v1", status: "published" });

    // 3. It appears for the adult as a first read, not as a re-consent.
    const outstanding = await ok<{ outstanding: Outstanding[] }>(
      request,
      "getOutstandingDisclaimers",
      { studentId },
      adult,
    );
    const entry = outstanding.outstanding.find((candidate) => candidate.disclaimer.key === runKey);
    expect(entry).toBeDefined();
    expect(entry?.previouslyAcceptedVersionLabel).toBeNull();
    expect(entry?.disclaimer.required).toBe(true);

    // 4. Accepting with a hash that is not the published one is refused.
    await denied(
      request,
      "acceptDisclaimer",
      {
        disclaimerId: v1.disclaimer.disclaimerId,
        studentId,
        contentHash: "0".repeat(64),
      },
      adult,
      // Firebase maps `aborted` to 409, which is the right shape for "the world moved under you".
      409,
      "ABORTED",
    );

    // 5. Accepting with the hash that was shown works, and empties the list for this key.
    await ok(
      request,
      "acceptDisclaimer",
      {
        disclaimerId: v1.disclaimer.disclaimerId,
        studentId,
        contentHash: v1.disclaimer.contentHash,
      },
      adult,
    );
    const afterAccept = await ok<{ outstanding: Outstanding[] }>(
      request,
      "getOutstandingDisclaimers",
      { studentId },
      adult,
    );
    expect(afterAccept.outstanding.some((candidate) => candidate.disclaimer.key === runKey)).toBe(
      false,
    );

    // 6. Office publishes v2 of the same key. The whole row exists for what happens next.
    const v2 = await ok<{ disclaimer: Disclaimer }>(
      request,
      "publishDisclaimer",
      publication("v2", "Synthetic body, reworded second version."),
      owner,
    );
    const afterV2 = await ok<{ outstanding: Outstanding[] }>(
      request,
      "getOutstandingDisclaimers",
      { studentId },
      adult,
    );
    const reconsent = afterV2.outstanding.find((candidate) => candidate.disclaimer.key === runKey);
    expect(reconsent).toBeDefined();
    expect(reconsent?.disclaimer.versionLabel).toBe("v2");
    // It says it is a re-consent rather than pretending this is the first time.
    expect(reconsent?.previouslyAcceptedVersionLabel).toBe("v1");

    // 7. The v1 hash no longer accepts v2: the participant must read the new words.
    await denied(
      request,
      "acceptDisclaimer",
      {
        disclaimerId: v2.disclaimer.disclaimerId,
        studentId,
        contentHash: v1.disclaimer.contentHash,
      },
      adult,
      // Firebase maps `aborted` to 409, which is the right shape for "the world moved under you".
      409,
      "ABORTED",
    );

    // 8. Office sees adoption as a count and never as a list of people.
    const listed = await ok<{ disclaimers: { disclaimer: Disclaimer; acceptedCount: number }[] }>(
      request,
      "listDisclaimers",
      null,
      owner,
    );
    const v1Row = listed.disclaimers.find(
      (row) => row.disclaimer.disclaimerId === v1.disclaimer.disclaimerId,
    );
    expect(v1Row?.acceptedCount).toBe(1);
    expect(v1Row?.disclaimer.status).toBe("superseded");
    expect(JSON.stringify(listed)).not.toContain(studentId);

    // 9. Rules keep both collections closed to every client, office included.
    for (const session of [owner, adult]) {
      for (const collection of ["disclaimers", "disclaimerAcceptances"]) {
        const direct = await request.get(
          `${firestoreRestBase}/academies/${academyId}/${collection}`,
          { headers: { Authorization: `Bearer ${session.idToken}` } },
        );
        expect(direct.status(), collection).toBe(403);
      }
    }
  });

  test("refuses what the roles and the payloads do not allow", async ({ request }) => {
    expect(academyId.length).toBeGreaterThan(0);
    const owner = await signIn(request, process.env.T117_OWNER_EMAIL);
    const headCoach = await signIn(request, process.env.T117_HEAD_COACH_EMAIL);
    const adult = await signIn(request, process.env.T117_ADULT_EMAIL);

    // Publishing is office-only; a head coach is staff but not office.
    await denied(
      request,
      "publishDisclaimer",
      publication("vX", "A body a coach should never be able to publish."),
      headCoach,
      403,
      "PERMISSION_DENIED",
    );
    await denied(request, "listDisclaimers", null, headCoach, 403, "PERMISSION_DENIED");

    // The outstanding list belongs to the participant; staff read counts instead.
    await denied(
      request,
      "getOutstandingDisclaimers",
      { studentId: "student-does-not-exist" },
      owner,
      403,
      "PERMISSION_DENIED",
    );

    // A payload carrying a derived field, or an audience the contract does not know.
    for (const payload of [
      { ...publication("vY", "A body."), contentHash: "0".repeat(64) },
      { ...publication("vY", "A body."), status: "published" },
      { ...publication("vY", "A body."), audience: "coaches" },
      { ...publication("vY", "A body."), key: "Not A Slug" },
      null,
      {},
    ]) {
      await denied(request, "publishDisclaimer", payload, owner, 400, "INVALID_ARGUMENT");
    }

    // An acceptance without the hash it is meant to carry.
    await denied(
      request,
      "acceptDisclaimer",
      { disclaimerId: `${runKey}__v1`, studentId: "student-1" },
      adult,
      400,
      "INVALID_ARGUMENT",
    );

    // Fail closed without App Check and without a session.
    for (const name of ["publishDisclaimer", "listDisclaimers", "getOutstandingDisclaimers"]) {
      const withoutAppCheck = await call(request, name, null, { session: owner, appCheck: false });
      expect(withoutAppCheck.status, name).toBe(401);
      const withoutSession = await call(request, name, null, {});
      expect(withoutSession.status, name).toBe(401);
    }
  });
});
