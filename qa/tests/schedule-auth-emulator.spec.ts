import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * T096 authenticated Emulator E2E for the class operations cycle on canonical data:
 * program -> sessions (Town/West) -> booking by a self-service adult with a connected membership
 * -> one-hour cutoff and site eligibility -> quorum evaluation -> staff manual check-in ->
 * attendance, correction, live roster -> booking cancellation and session cancellation.
 *
 * Same mechanism as T093-T095: the web client is App Check fail-closed, so the spec drives the
 * callables directly with real Auth Emulator sessions and an unsigned App Check token that only
 * the Functions Emulator (skipTokenVerification) accepts.
 */
const enabled = process.env.T096_SCHEDULE_EMULATOR_E2E === "true";
const functionsPort = process.env.T096_FUNCTIONS_EMULATOR_PORT ?? "5001";
const projectId = "demo-bpt-jersey";
const academyId = process.env.T096_E2E_ACADEMY_ID ?? "";
const functionsBaseUrl = `http://127.0.0.1:${functionsPort}/${projectId}/us-central1`;
const authUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`;
const firestoreRestBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;

type CallableEnvelope = Readonly<{
  result?: unknown;
  error?: Readonly<{ message?: string; status?: string }>;
}>;
type Session = Readonly<{ idToken: string; uid: string }>;
type ScheduleSession = Readonly<{
  sessionId: string;
  locationId: string;
  status: string;
  startAt: string;
  minParticipants: number;
}>;
type Booking = Readonly<{
  bookingId: string;
  sessionId: string;
  studentId: string;
  status: string;
}>;
type Attendance = Readonly<{
  attendanceId: string;
  sessionId: string;
  studentId: string;
  method: string;
  state: string;
}>;

const hour = 3_600_000;

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Unsigned, emulator-only App Check token. It is never accepted outside skipTokenVerification.
function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:t096-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

async function signIn(request: APIRequestContext, email: string | undefined): Promise<Session> {
  expect(typeof email).toBe("string");
  const response = await request.post(authUrl, {
    data: { email, password: process.env.T096_E2E_PASSWORD, returnSecureToken: true },
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
    versionLabel: `t096-${suffix}`,
    title: "Synthetic T096 waiver",
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

function sessionInput(
  programId: string,
  instructorId: string,
  locationId: "town" | "west",
  startOffsetMs: number,
  title: string,
) {
  const startAt = new Date(Date.now() + startOffsetMs);
  return {
    classId: null,
    programId,
    locationId,
    instructorId,
    title,
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + hour).toISOString(),
    capacity: 10,
    minParticipants: 4,
  };
}

/** Prepares a canonical adult with an accepted waiver and an active Town membership. */
async function enrolAdult(
  request: APIRequestContext,
  owner: Session,
  adult: Session,
  suffix: string,
): Promise<Readonly<{ studentId: string; membershipId: string }>> {
  const version = await ok<{ waiverVersionId: string; contentHash: string }>(
    request,
    "publishWaiverVersion",
    publication(suffix),
    owner,
  );
  const fullName = "Synthetic T096 Adult";
  const profile = await ok<{ student: { studentId: string } }>(
    request,
    "saveClientProfile",
    {
      requestId: `t096-profile-${suffix}`,
      fullName,
      dateOfBirth: "1993-02-03",
      phoneNumber: "+441534000961",
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
  expect([200, 400], JSON.stringify(activation.body)).toContain(activation.status);
  const membership = await ok<{ membershipId: string }>(
    request,
    "createMembership",
    { studentId, planId: "town-adult", status: "active" },
    owner,
  );
  return { studentId, membershipId: membership.membershipId };
}

test.describe("T096 class operations with Firebase Emulators", () => {
  test.skip(!enabled, "T096_SCHEDULE_EMULATOR_E2E is not enabled");
  test.beforeAll(() => {
    expect(academyId).toMatch(/^[a-z][a-z0-9-]{2,60}$/u);
  });

  test("books, evaluates quorum, checks in, corrects and cancels on canonical data @critical", async ({
    request,
  }) => {
    // More than thirty sequential callables against the Functions Emulator; the default budget
    // is sized for browser pages.
    test.setTimeout(180_000);
    const owner = await signIn(request, process.env.T096_OWNER_EMAIL);
    const adult = await signIn(request, process.env.T096_ADULT_EMAIL);
    const suffix = randomUUID().replace(/-/gu, "").slice(0, 8).toLowerCase();
    const { studentId, membershipId } = await enrolAdult(request, owner, adult, suffix);

    // Catalog: locations are the two canonical sites; the program is created by staff only.
    const catalog = await ok<{ locations: readonly { locationId: string }[] }>(
      request,
      "listScheduleCatalog",
      null,
      adult,
    );
    expect(catalog.locations.map((location) => location.locationId).sort()).toEqual([
      "town",
      "west",
    ]);
    const programInput = {
      name: `T096 Adults ${suffix}`,
      ageBand: "adult",
      discipline: "bjj",
      level: "all-levels",
    };
    await denied(request, "saveProgram", programInput, adult, 403, "PERMISSION_DENIED");
    const { program } = await ok<{ program: { programId: string } }>(
      request,
      "saveProgram",
      programInput,
      owner,
    );

    // Sessions: one bookable Town session, one inside the one-hour cutoff and one at West.
    const far = (
      await ok<{ session: ScheduleSession }>(
        request,
        "saveSession",
        sessionInput(program.programId, owner.uid, "town", 3 * hour, `T096 Town ${suffix}`),
        owner,
      )
    ).session;
    const near = (
      await ok<{ session: ScheduleSession }>(
        request,
        "saveSession",
        sessionInput(program.programId, owner.uid, "town", hour / 2, `T096 Soon ${suffix}`),
        owner,
      )
    ).session;
    const west = (
      await ok<{ session: ScheduleSession }>(
        request,
        "saveSession",
        sessionInput(program.programId, owner.uid, "west", 3 * hour, `T096 West ${suffix}`),
        owner,
      )
    ).session;
    expect(far.minParticipants).toBe(4);
    await denied(
      request,
      "saveSession",
      sessionInput(program.programId, owner.uid, "town", 2 * hour, `T096 Denied ${suffix}`),
      adult,
      403,
      "PERMISSION_DENIED",
    );

    const listed = await ok<{ sessions: readonly ScheduleSession[] }>(
      request,
      "listSessions",
      {
        from: new Date(Date.now() - hour).toISOString(),
        to: new Date(Date.now() + 24 * hour).toISOString(),
      },
      adult,
    );
    const listedIds = listed.sessions.map((session) => session.sessionId);
    expect(listedIds).toEqual(
      expect.arrayContaining([far.sessionId, near.sessionId, west.sessionId]),
    );

    // Booking: only the eligible Town session more than one hour ahead; the request is idempotent.
    const bookingInput = { sessionId: far.sessionId, studentId, membershipId };
    const booking = (await ok<{ booking: Booking }>(request, "requestBooking", bookingInput, adult))
      .booking;
    expect(booking.status).toBe("confirmed");
    expect(booking.studentId).toBe(studentId);
    const replay = (await ok<{ booking: Booking }>(request, "requestBooking", bookingInput, adult))
      .booking;
    expect(replay.bookingId).toBe(booking.bookingId);
    await denied(
      request,
      "requestBooking",
      { ...bookingInput, sessionId: near.sessionId },
      adult,
      400,
      "FAILED_PRECONDITION",
    );
    await denied(
      request,
      "requestBooking",
      { ...bookingInput, sessionId: west.sessionId },
      adult,
      400,
      "FAILED_PRECONDITION",
    );
    const own = await ok<{ bookings: readonly Booking[] }>(
      request,
      "listStudentBookings",
      { studentId },
      adult,
    );
    expect(own.bookings.map((candidate) => candidate.bookingId)).toContain(booking.bookingId);

    // Quorum: four confirmed bookings are required one hour before; one is not enough.
    const minimum = await ok<{
      result: { confirmedCount: number; minParticipants: number; quorumMet: boolean };
    }>(request, "evaluateSessionMinimum", { sessionId: far.sessionId }, owner);
    expect(minimum.result).toEqual({ confirmedCount: 1, minParticipants: 4, quorumMet: false });
    await denied(
      request,
      "evaluateSessionMinimum",
      { sessionId: far.sessionId },
      adult,
      403,
      "PERMISSION_DENIED",
    );

    // Check-in: staff only, manual only in the pilot, one attendance record per student.
    const checkInInput = { sessionId: far.sessionId, studentId, method: "manual" };
    await denied(request, "checkIn", checkInInput, adult, 403, "PERMISSION_DENIED");
    await denied(
      request,
      "checkIn",
      { ...checkInInput, method: "qr" },
      owner,
      400,
      "FAILED_PRECONDITION",
    );
    const attendance = (
      await ok<{ attendance: Attendance }>(request, "checkIn", checkInInput, owner)
    ).attendance;
    expect(attendance.method).toBe("manual");
    expect(attendance.studentId).toBe(studentId);
    const roster = await ok<{ attendance: readonly Attendance[] }>(
      request,
      "listSessionAttendance",
      { sessionId: far.sessionId },
      owner,
    );
    expect(roster.attendance.filter((record) => record.studentId === studentId)).toHaveLength(1);

    // Corrections are staff-only and keep the canonical record.
    const corrected = await ok<{ correction: Attendance; canonical: Attendance }>(
      request,
      "correctAttendance",
      { sessionId: far.sessionId, studentId, newState: "late", reason: "Synthetic correction" },
      owner,
    );
    expect(corrected.canonical.state).toBe("late");
    expect(corrected.correction.studentId).toBe(studentId);
    await denied(
      request,
      "correctAttendance",
      { sessionId: far.sessionId, studentId, newState: "attended", reason: "Not allowed" },
      adult,
      403,
      "PERMISSION_DENIED",
    );
    const view = await ok<{ view: Record<string, unknown> }>(
      request,
      "getSessionOperationalView",
      { sessionId: far.sessionId },
      owner,
    );
    expect(JSON.stringify(view.view)).toContain(studentId);
    await denied(
      request,
      "getSessionOperationalView",
      { sessionId: far.sessionId },
      adult,
      403,
      "PERMISSION_DENIED",
    );

    // Cancellation: the adult cancels their own booking well before the cutoff; staff cancels a
    // session with a reason and nobody can book it afterwards.
    const later = (
      await ok<{ session: ScheduleSession }>(
        request,
        "saveSession",
        sessionInput(program.programId, owner.uid, "town", 5 * hour, `T096 Later ${suffix}`),
        owner,
      )
    ).session;
    await ok(request, "requestBooking", { ...bookingInput, sessionId: later.sessionId }, adult);
    const cancelled = (
      await ok<{ booking: Booking }>(
        request,
        "cancelBooking",
        { sessionId: later.sessionId, studentId, reason: "Synthetic cancellation" },
        adult,
      )
    ).booking;
    expect(cancelled.status).toBe("cancelled");
    await denied(
      request,
      "cancelSession",
      { sessionId: later.sessionId, reason: "Not allowed" },
      adult,
      403,
      "PERMISSION_DENIED",
    );
    const cancelledSession = await ok<{ session: ScheduleSession }>(
      request,
      "cancelSession",
      { sessionId: later.sessionId, reason: "Synthetic quorum not met" },
      owner,
    );
    expect(cancelledSession.session.status).toBe("cancelled");
    await denied(
      request,
      "requestBooking",
      { ...bookingInput, sessionId: later.sessionId },
      adult,
      400,
      "FAILED_PRECONDITION",
    );

    // No-show reconciliation never touches a student who already has attendance.
    const reconciled = await ok<{ noShowsMarked: number }>(
      request,
      "reconcileSessionNoShows",
      { sessionId: far.sessionId },
      owner,
    );
    expect(reconciled.noShowsMarked).toBe(0);

    // Direct Firestore access to sessions, bookings and attendance is denied by Rules.
    for (const path of [
      `academies/${academyId}/sessions/${far.sessionId}`,
      `academies/${academyId}/bookings/${booking.bookingId}`,
      `academies/${academyId}/attendance/${attendance.attendanceId}`,
    ]) {
      const direct = await request.get(`${firestoreRestBase}/${path}`);
      expect(direct.status(), path).toBe(403);
    }
  });

  test("fails closed without App Check, without a session and on malformed schedule payloads @critical", async ({
    request,
  }) => {
    const owner = await signIn(request, process.env.T096_OWNER_EMAIL);

    for (const name of ["saveSession", "requestBooking", "checkIn"]) {
      const noAppCheck = await call(request, name, null, { session: owner, appCheck: false });
      expect(noAppCheck.status, name).toBe(401);
      expect(noAppCheck.body.error?.status).toBe("UNAUTHENTICATED");
      const noSession = await call(request, name, null);
      expect(noSession.status, name).toBe(401);
      expect(noSession.body.error?.status).toBe("UNAUTHENTICATED");
    }

    const base = sessionInput("program-unknown", owner.uid, "town", 2 * hour, "T096 Invalid");
    await denied(
      request,
      "saveSession",
      { ...base, locationId: "north" },
      owner,
      400,
      "INVALID_ARGUMENT",
    );
    await denied(
      request,
      "saveSession",
      { ...base, endAt: base.startAt },
      owner,
      400,
      "INVALID_ARGUMENT",
    );
    await denied(request, "saveSession", { ...base, capacity: 0 }, owner, 400, "INVALID_ARGUMENT");
    await denied(
      request,
      "requestBooking",
      { sessionId: "", studentId: "student-1", membershipId: "membership-1" },
      owner,
      400,
      "INVALID_ARGUMENT",
    );
    await denied(
      request,
      "checkIn",
      { sessionId: "session-1", studentId: "student-1", method: "handshake" },
      owner,
      400,
      "INVALID_ARGUMENT",
    );
  });
});
