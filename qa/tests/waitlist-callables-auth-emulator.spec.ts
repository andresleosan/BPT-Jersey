import { expect, test, type APIRequestContext } from "@playwright/test";

const authUrl =
  "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo";
const functionsBaseUrl = "http://127.0.0.1:5001/demo-bpt-jersey/us-central1";
const sessionId = "session-waitlist-real";

type CallableEnvelope = {
  result?: {
    entry?: Record<string, unknown>;
    entries?: Record<string, unknown>[];
  };
  error?: Record<string, unknown>;
};

async function call(
  request: APIRequestContext,
  name: string,
  data: Record<string, unknown>,
  idToken?: string,
) {
  const response = await request.post(`${functionsBaseUrl}/${name}`, {
    headers: {
      Accept: "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    data: { data },
  });
  return { response, body: (await response.json()) as CallableEnvelope };
}

test.describe("T060 waitlist callables with Firebase Emulators", () => {
  test("authenticates and completes the persisted waitlist workflow @critical", async ({
    request,
  }, testInfo) => {
    test.skip(
      process.env.WAITLIST_EMULATOR_E2E !== "true" ||
        !process.env.AUTH_EMULATOR_E2E_EMAIL ||
        !process.env.AUTH_EMULATOR_E2E_PASSWORD,
      "Synthetic T060 Emulator credentials and seed are required.",
    );
    const studentId = `student-waitlist-real-${testInfo.repeatEachIndex}`;
    const membershipId = `membership-waitlist-real-${testInfo.repeatEachIndex}`;

    const unauthenticated = await call(request, "joinWaitlist", {
      sessionId,
      studentId,
      membershipId,
    });
    expect(unauthenticated.response.status()).toBe(401);
    expect(unauthenticated.body).toMatchObject({
      error: { status: "UNAUTHENTICATED" },
    });

    const login = await request.post(authUrl, {
      data: {
        email: process.env.AUTH_EMULATOR_E2E_EMAIL,
        password: process.env.AUTH_EMULATOR_E2E_PASSWORD,
        returnSecureToken: true,
      },
    });
    expect(login.status()).toBe(200);
    const loginBody = (await login.json()) as { idToken?: string };
    expect(loginBody.idToken).toEqual(expect.any(String));
    const idToken = loginBody.idToken!;

    const joined = await call(
      request,
      "joinWaitlist",
      { sessionId, studentId, membershipId },
      idToken,
    );
    expect(joined.response.status()).toBe(200);
    expect(joined.body).toEqual({
      result: {
        entry: {
          sessionId,
          position: 1,
          status: "waiting",
          requestedAt: expect.any(String),
          cancelledAt: null,
        },
      },
    });
    const joinedEntry = joined.body.result?.entry;
    expect(joinedEntry).toBeDefined();

    const replay = await call(
      request,
      "joinWaitlist",
      { sessionId, studentId, membershipId },
      idToken,
    );
    expect(replay.response.status()).toBe(200);
    expect(replay.body).toEqual(joined.body);

    const studentList = await call(request, "listStudentWaitlist", { studentId }, idToken);
    expect(studentList.response.status()).toBe(200);
    expect(studentList.body).toEqual({ result: { entries: [joinedEntry] } });

    const staffList = await call(request, "listSessionWaitlist", { sessionId }, idToken);
    expect(staffList.response.status()).toBe(200);
    const staffEntries = staffList.body.result?.entries;
    expect(staffEntries).toEqual(
      expect.arrayContaining([{ ...joinedEntry, studentReference: studentId }]),
    );
    for (const item of staffEntries ?? []) {
      expect(Object.keys(item).sort()).toEqual([
        "cancelledAt",
        "position",
        "requestedAt",
        "sessionId",
        "status",
        "studentReference",
      ]);
    }

    const cancelled = await call(request, "cancelWaitlistEntry", { sessionId, studentId }, idToken);
    expect(cancelled.response.status()).toBe(200);
    expect(cancelled.body).toEqual({
      result: {
        entry: {
          ...joinedEntry,
          status: "cancelled",
          cancelledAt: expect.any(String),
        },
      },
    });

    const cancellationReplay = await call(
      request,
      "cancelWaitlistEntry",
      { sessionId, studentId },
      idToken,
    );
    expect(cancellationReplay.response.status()).toBe(200);
    expect(cancellationReplay.body).toEqual(cancelled.body);
  });
});
