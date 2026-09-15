import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * T032 authenticated Emulator E2E for the schedule and finance callables added on top of
 * schema-v2 classes: a class with two recurrence rules -> generated sessions -> booked counts ->
 * a coach permission check -> session edit -> class removal; and a membership-less manual
 * invoice -> cash payment -> recent payments -> family financial account -> member names.
 *
 * Same mechanism as T093-T096: the web client is App Check fail-closed, so the spec drives the
 * callables directly with real Auth Emulator sessions and an unsigned App Check token that only
 * the Functions Emulator (skipTokenVerification) accepts.
 */
const enabled = process.env.T032_SCHEDULE_FINANCE_EMULATOR_E2E === "true";
const functionsPort = process.env.T032_FUNCTIONS_EMULATOR_PORT ?? "5001";
const projectId = "demo-bpt-jersey";
const academyId = process.env.T032_E2E_ACADEMY_ID ?? "";
const functionsBaseUrl = `http://127.0.0.1:${functionsPort}/${projectId}/us-central1`;
const authUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`;

type CallableEnvelope = Readonly<{
  result?: unknown;
  error?: Readonly<{ message?: string; status?: string }>;
}>;
type Session = Readonly<{ idToken: string; uid: string }>;

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Unsigned, emulator-only App Check token. It is never accepted outside skipTokenVerification.
function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:t032-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

async function signIn(request: APIRequestContext, email: string | undefined): Promise<Session> {
  expect(typeof email).toBe("string");
  const response = await request.post(authUrl, {
    data: { email, password: process.env.T032_E2E_PASSWORD, returnSecureToken: true },
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

// Lifted from manual-billing-auth-emulator.spec.ts: the canonical adult profile created through
// the onboarding path is where a familyId comes from, since manual invoices never create one.
async function seedFamily(
  request: APIRequestContext,
  adult: Session,
  suffix: string,
): Promise<string> {
  const profile = await ok<{ student: { studentId: string; familyId?: string } }>(
    request,
    "saveClientProfile",
    {
      requestId: `t032-profile-${suffix}`,
      fullName: "Synthetic T032 Adult",
      dateOfBirth: "1992-06-07",
      phoneNumber: "+441534000032",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
    },
    adult,
  );
  expect(typeof profile.student.familyId).toBe("string");
  return profile.student.familyId as string;
}

test.describe("T032 schedule and finance callables with Firebase Emulators", () => {
  test.skip(!enabled, "T032_SCHEDULE_FINANCE_EMULATOR_E2E is not enabled");
  test.beforeAll(() => {
    expect(academyId).toMatch(/^[a-z][a-z0-9-]{2,60}$/u);
  });

  test("class with two rules -> sessions -> counts -> booking edit -> remove @critical", async ({
    request,
  }) => {
    const owner = await signIn(request, process.env.T032_OWNER_EMAIL);
    const coach = await signIn(request, process.env.T032_COACH_EMAIL);
    const suffix = randomUUID().replace(/-/gu, "").slice(0, 8).toLowerCase();

    const { program } = await ok<{ program: { programId: string } }>(
      request,
      "saveProgram",
      { name: `T032 Kids ${suffix}`, ageBand: "kids", discipline: "bjj", level: "all-levels" },
      owner,
    );

    const created = await ok<{ class: { classId: string; schemaVersion: string } }>(
      request,
      "saveClass",
      {
        programId: program.programId,
        locationId: "town",
        name: `T032 Kids ${suffix}`,
        recurrenceRules: [
          { dayOfWeek: 1, startTime: "17:00", durationMinutes: 60 },
          { dayOfWeek: 3, startTime: "18:30", durationMinutes: 45 },
        ],
        instructorIds: ["coach-t032"],
        capacity: 2,
        minParticipants: 0,
        description: "Bring a gi.",
        ageRange: { minAge: 8, maxAge: 11 },
      },
      owner,
    );
    expect(created.class.schemaVersion).toBe("2");

    const generated = await ok<{
      sessions: { sessionId: string; startAt: string; description?: string }[];
    }>(
      request,
      "generateSessions",
      { classId: created.class.classId, fromDate: "2099-01-04", toDate: "2099-01-10" },
      owner,
    );
    expect(generated.sessions).toHaveLength(2);
    expect(generated.sessions[0]?.description).toBe("Bring a gi.");

    const window = { from: "2099-01-01T00:00:00.000Z", to: "2099-01-31T00:00:00.000Z" };
    const before = await ok<{ counts: Record<string, number> }>(
      request,
      "listSessionBookedCounts",
      window,
      coach,
    );
    expect(before.counts[generated.sessions[0]!.sessionId]).toBe(0);

    // A coach cannot edit a session.
    await denied(
      request,
      "updateSession",
      { sessionId: generated.sessions[0]!.sessionId, title: `${suffix} X` },
      coach,
      403,
      "PERMISSION_DENIED",
    );

    const edited = await ok<{ session: { title: string } }>(
      request,
      "updateSession",
      {
        sessionId: generated.sessions[0]!.sessionId,
        title: `T032 Kids (Gi) ${suffix}`,
        capacity: 3,
      },
      owner,
    );
    expect(edited.session.title).toBe(`T032 Kids (Gi) ${suffix}`);

    const removed = await ok<{ class: { active: boolean }; cancelledSessions: unknown[] }>(
      request,
      "removeClass",
      { classId: created.class.classId, reason: "T032 cleanup" },
      owner,
    );
    expect(removed.class.active).toBe(false);
    expect(removed.cancelledSessions).toHaveLength(2);
  });

  test("invoice without membership -> cash payment -> recent payments -> family account -> member names @critical", async ({
    request,
  }) => {
    const owner = await signIn(request, process.env.T032_OWNER_EMAIL);
    const coach = await signIn(request, process.env.T032_COACH_EMAIL);
    const adult = await signIn(request, process.env.T032_ADULT_EMAIL);
    const suffix = randomUUID().replace(/-/gu, "").slice(0, 8).toLowerCase();

    const familyId = await seedFamily(request, adult, suffix);
    const reference = `T032-${suffix}`;
    const invoice = await ok<{ invoiceId: string; membershipId: string | null }>(
      request,
      "issueManualInvoice",
      {
        familyId,
        membershipId: null,
        totalMinor: 1_500,
        dueAt: "2099-01-31T23:59:59.000Z",
        chargeKind: "manual_adjustment",
        invoiceReference: reference,
        description: "Seminar",
      },
      owner,
    );
    expect(invoice.membershipId).toBeNull();

    const payment = await ok<{ method: string }>(
      request,
      "recordManualPayment",
      {
        invoiceId: invoice.invoiceId,
        amountMinor: 1_500,
        method: "cash",
        manualReference: `${reference}-CASH`,
        occurredAt: "2099-01-10T10:00:00.000Z",
      },
      owner,
    );
    expect(payment.method).toBe("cash");

    const recent = await ok<{
      payments: { invoiceReference: string; memberName: string | null; method: string }[];
    }>(request, "listRecentPayments", null, owner);
    expect(
      recent.payments.some(
        (row) =>
          row.invoiceReference === reference && row.memberName === null && row.method === "cash",
      ),
    ).toBe(true);

    const family = await ok<{ invoices: { invoice: { invoiceId: string } }[] }>(
      request,
      "getFamilyFinancialAccount",
      { familyId },
      owner,
    );
    expect(family.invoices.map((view) => view.invoice.invoiceId)).toContain(invoice.invoiceId);

    const names = await ok<{ members: unknown[] }>(request, "listMemberNames", null, owner);
    expect(Array.isArray(names.members)).toBe(true);

    await denied(request, "listMemberNames", null, coach, 403, "PERMISSION_DENIED");
  });
});
