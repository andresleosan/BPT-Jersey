import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * T112 authenticated Emulator E2E for the upcoming birthdays of the coach panel: canonical adult
 * profiles at Town and at West -> staff reads the birthdays of the site they picked.
 *
 * The panel used to announce an invented sample list. What it reads now is derived from the
 * canonical students, and the projection never carries a date of birth: this spec asserts the
 * absence as well as the presence.
 *
 * Same mechanism as T093-T098 and T111: the web client is App Check fail-closed, so the spec drives
 * the callables directly with real Auth Emulator sessions and an unsigned App Check token that only
 * the Functions Emulator (skipTokenVerification) accepts.
 */
const enabled = process.env.T112_BIRTHDAY_EMULATOR_E2E === "true";
const functionsPort = process.env.T112_FUNCTIONS_EMULATOR_PORT ?? "5001";
const projectId = "demo-bpt-jersey";
const academyId = process.env.T112_E2E_ACADEMY_ID ?? "";
const functionsBaseUrl = `http://127.0.0.1:${functionsPort}/${projectId}/us-central1`;
const authUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`;
const firestoreRestBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;

type CallableEnvelope = Readonly<{
  result?: unknown;
  error?: Readonly<{ message?: string; status?: string }>;
}>;
type Session = Readonly<{ idToken: string; uid: string }>;
type Birthday = Readonly<{
  studentId: string;
  displayName: string;
  daysAway: number;
  participantType: string;
  trainingCenter: string;
}>;

const day = 86_400_000;

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Unsigned, emulator-only App Check token. It is never accepted outside skipTokenVerification.
function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:t112-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

async function signIn(request: APIRequestContext, email: string | undefined): Promise<Session> {
  expect(typeof email).toBe("string");
  const response = await request.post(authUrl, {
    data: { email, password: process.env.T112_E2E_PASSWORD, returnSecureToken: true },
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
 * A date of birth whose day and month are `offsetDays` from today. The year is 2000, a leap year,
 * so 29 February is a valid synthetic birth date whichever day the suite runs on.
 */
function birthDateIn(offsetDays: number): string {
  return `2000-${new Date(Date.now() + offsetDays * day).toISOString().slice(5, 10)}`;
}

async function enrolAdult(
  request: APIRequestContext,
  adult: Session,
  input: Readonly<{ suffix: string; fullName: string; birthDate: string; site: "Town" | "West" }>,
): Promise<string> {
  const profile = await ok<{ student: { studentId: string } }>(
    request,
    "saveClientProfile",
    {
      requestId: `t112-profile-${input.suffix}`,
      fullName: input.fullName,
      dateOfBirth: input.birthDate,
      phoneNumber: "+441534000981",
      trainingCenter: input.site,
      trainingTimePreferences: ["evening"],
    },
    adult,
  );
  return profile.student.studentId;
}

test.describe("T112 coach birthdays with Firebase Emulators", () => {
  test.skip(!enabled, "T112_BIRTHDAY_EMULATOR_E2E is not enabled");
  test.beforeAll(() => {
    expect(academyId).toMatch(/^[a-z][a-z0-9-]{2,60}$/u);
  });

  test("derives the upcoming birthdays of each site from the canonical students @critical", async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const owner = await signIn(request, process.env.T112_OWNER_EMAIL);
    const headCoach = await signIn(request, process.env.T112_HEAD_COACH_EMAIL);
    const townAdult = await signIn(request, process.env.T112_ADULT_TOWN_EMAIL);
    const westAdult = await signIn(request, process.env.T112_ADULT_WEST_EMAIL);
    const suffix = randomUUID().replace(/-/gu, "").slice(0, 8).toLowerCase();

    const townName = `T112 Town Birthday ${suffix}`;
    const westName = `T112 West Birthday ${suffix}`;
    const townStudentId = await enrolAdult(request, townAdult, {
      suffix: `town-${suffix}`,
      fullName: townName,
      birthDate: birthDateIn(0),
      site: "Town",
    });
    const westStudentId = await enrolAdult(request, westAdult, {
      suffix: `west-${suffix}`,
      fullName: westName,
      birthDate: birthDateIn(3),
      site: "West",
    });

    // The coach panel asks for the site it is showing. Only that site's members come back.
    const town = (
      await ok<{ birthdays: readonly Birthday[] }>(
        request,
        "listUpcomingBirthdays",
        { trainingCenter: "Town", windowDays: 7 },
        headCoach,
      )
    ).birthdays;
    expect(town.find((entry) => entry.studentId === townStudentId)).toMatchObject({
      displayName: townName,
      daysAway: 0,
      participantType: "adult",
      trainingCenter: "Town",
    });
    expect(town.map((entry) => entry.studentId)).not.toContain(westStudentId);

    const west = (
      await ok<{ birthdays: readonly Birthday[] }>(
        request,
        "listUpcomingBirthdays",
        { trainingCenter: "West", windowDays: 7 },
        headCoach,
      )
    ).birthdays;
    expect(west.find((entry) => entry.studentId === westStudentId)).toMatchObject({
      displayName: westName,
      daysAway: 3,
      trainingCenter: "West",
    });
    expect(west.map((entry) => entry.studentId)).not.toContain(townStudentId);

    // Without a filter both sites are there; the default window is the week.
    const all = (
      await ok<{ birthdays: readonly Birthday[] }>(request, "listUpcomingBirthdays", null, owner)
    ).birthdays;
    const allIds = all.map((entry) => entry.studentId);
    expect(allIds).toContain(townStudentId);
    expect(allIds).toContain(westStudentId);
    // Nearest first.
    expect(allIds.indexOf(townStudentId)).toBeLessThan(allIds.indexOf(westStudentId));

    // No date of birth and no year travels to the panel, for anybody in the list.
    const serialised = JSON.stringify(all);
    expect(serialised).not.toContain("dateOfBirth");
    expect(serialised).not.toContain("2000-");
    for (const entry of all) {
      expect(Object.keys(entry).sort()).toEqual([
        "daysAway",
        "displayName",
        "participantType",
        "studentId",
        "trainingCenter",
      ]);
    }

    // A window of zero days is today only, so the member three days out drops off.
    const todayOnly = (
      await ok<{ birthdays: readonly Birthday[] }>(
        request,
        "listUpcomingBirthdays",
        { windowDays: 0 },
        owner,
      )
    ).birthdays;
    expect(todayOnly.map((entry) => entry.studentId)).toContain(townStudentId);
    expect(todayOnly.map((entry) => entry.studentId)).not.toContain(westStudentId);

    // Members never read the birthdays of the mat, not even their own site.
    await denied(request, "listUpcomingBirthdays", null, townAdult, 403, "PERMISSION_DENIED");
    await denied(
      request,
      "listUpcomingBirthdays",
      { trainingCenter: "Town" },
      westAdult,
      403,
      "PERMISSION_DENIED",
    );

    // Direct Firestore access to the canonical students is denied, which is where the date lives.
    for (const path of [
      `academies/${academyId}/students/${townStudentId}`,
      `academies/${academyId}/students/${westStudentId}`,
    ]) {
      const direct = await request.get(`${firestoreRestBase}/${path}`);
      expect(direct.status(), path).toBe(403);
    }
  });

  test("fails closed without App Check, without a session and on malformed payloads @critical", async ({
    request,
  }) => {
    const owner = await signIn(request, process.env.T112_OWNER_EMAIL);

    const noAppCheck = await call(request, "listUpcomingBirthdays", null, {
      session: owner,
      appCheck: false,
    });
    expect(noAppCheck.status).toBe(401);
    expect(noAppCheck.body.error?.status).toBe("UNAUTHENTICATED");
    const noSession = await call(request, "listUpcomingBirthdays", null);
    expect(noSession.status).toBe(401);
    expect(noSession.body.error?.status).toBe("UNAUTHENTICATED");

    for (const payload of [
      { trainingCenter: "North" },
      { trainingCenter: "Town", studentId: "student-1" },
      { windowDays: 400 },
      { windowDays: -1 },
      "Town",
    ]) {
      await denied(request, "listUpcomingBirthdays", payload, owner, 400, "INVALID_ARGUMENT");
    }
  });
});
