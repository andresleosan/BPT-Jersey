import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * T093 authenticated Emulator E2E for the canonical member directory callables.
 *
 * The browser path cannot run offline: the web client is App Check fail-closed and the SDK only
 * attaches an App Check header after a real token exchange. The Functions Emulator, however, runs
 * with `skipTokenVerification`, so an unsigned App Check JWT is decoded (not verified) and
 * `request.app` is populated. This spec therefore drives the deployed callable surface directly,
 * exactly as the web client does, with a real Auth Emulator session.
 */
const enabled = process.env.T093_MEMBER_DIRECTORY_EMULATOR_E2E === "true";
const functionsPort = process.env.T093_FUNCTIONS_EMULATOR_PORT ?? "5001";
const projectId = "demo-bpt-jersey";
const functionsBaseUrl = `http://127.0.0.1:${functionsPort}/${projectId}/us-central1`;
const authUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`;
const firestoreRestBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;

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
    sub: `1:${projectId}:web:t093-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

async function signIn(request: APIRequestContext): Promise<string> {
  const response = await request.post(authUrl, {
    data: {
      email: process.env.AUTH_EMULATOR_E2E_EMAIL,
      password: process.env.AUTH_EMULATOR_E2E_PASSWORD,
      returnSecureToken: true,
    },
  });
  expect(response.ok()).toBe(true);
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

const generalRowKeys = [
  "active",
  "fullName",
  "membershipReference",
  "participantType",
  "status",
  "studentId",
  "trainingCenter",
];

test.describe("T093 canonical member directory with Firebase Emulators", () => {
  test.skip(
    !enabled || !process.env.AUTH_EMULATOR_E2E_EMAIL || !process.env.AUTH_EMULATOR_E2E_PASSWORD,
    "Synthetic T093 Emulator credentials, provisioning and directory state are required.",
  );

  test("creates, looks up, details, edits and lists a canonical adult with waiver contact @critical", async ({
    request,
  }) => {
    const idToken = await signIn(request);
    const suffix = randomUUID().replace(/-/gu, "").slice(0, 8).toUpperCase();
    const membershipNumber = `BPT T093 ${suffix}`;
    const requestId = `t093-create-${suffix}`;
    const createInput = {
      requestId,
      fullName: "Synthetic T093 Adult",
      dateOfBirth: "1990-01-02",
      phoneNumber: "+441534000093",
      email: `t093-${suffix.toLowerCase()}@example.test`,
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      membershipNumber,
      gender: "unknown",
      emergencyContact: {
        fullName: "Synthetic T093 Contact",
        relationship: "Spouse",
        phoneNumber: "+441534000094",
      },
      postalAddress: { line: "1 Synthetic Street, St Helier", postCode: "JE2 3AB" },
    };

    const created = await call(request, "createMember", createInput, { idToken });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const createdResult = created.body.result as { memberId: string; studentId: string };
    expect(createdResult.memberId).toBe(createdResult.studentId);
    const studentId = createdResult.studentId;

    // Exact replay returns the same identifiers without creating a second student.
    const replay = await call(request, "createMember", createInput, { idToken });
    expect(replay.status).toBe(200);
    expect(replay.body.result).toEqual(createdResult);

    // Exact lookup returns only the minimized general row and never echoes the identifier.
    const lookup = await call(
      request,
      "lookupMemberIdentity",
      {
        lookupKind: "membership-number",
        value: membershipNumber,
        purpose: "member-identity-lookup",
      },
      { idToken },
    );
    expect(lookup.status, JSON.stringify(lookup.body)).toBe(200);
    const lookupResult = lookup.body.result as { matched: boolean; row: Record<string, unknown> };
    expect(lookupResult.matched).toBe(true);
    expect(lookupResult.row.studentId).toBe(studentId);
    expect(Object.keys(lookupResult.row).sort()).toEqual(generalRowKeys);
    expect(JSON.stringify(lookupResult.row)).not.toContain(membershipNumber);
    expect(JSON.stringify(lookupResult.row)).not.toMatch(/emergency|postCode|dateOfBirth|email/u);

    // Purpose-bound detail carries the waiver blocks exactly as captured.
    const detail = await call(
      request,
      "getMemberDetail",
      { studentId, purpose: "member-record-maintenance" },
      { idToken },
    );
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    const detailResult = detail.body.result as Record<string, unknown>;
    expect(detailResult.emergencyContact).toEqual(createInput.emergencyContact);
    expect(detailResult.postalAddress).toEqual(createInput.postalAddress);
    expect(detailResult.membershipNumber).toBe(membershipNumber);
    expect(JSON.stringify(detailResult)).not.toMatch(/academyId|source|createdBy/u);

    // Full-replacement update keeps identity history and replaces the waiver blocks.
    const update = await call(
      request,
      "updateMember",
      {
        studentId,
        requestId: randomUUID(),
        fullName: createInput.fullName,
        dateOfBirth: createInput.dateOfBirth,
        phoneNumber: createInput.phoneNumber,
        email: createInput.email,
        trainingCenter: "West",
        trainingTimePreferences: ["morning", "evening"],
        membershipNumber,
        gender: "unknown",
        frequencyNote: "Twice weekly",
        emergencyContact: {
          ...createInput.emergencyContact,
          alternatePhoneNumber: "+441534000095",
        },
      },
      { idToken },
    );
    expect(update.status, JSON.stringify(update.body)).toBe(200);
    expect(update.body.result).toEqual(createdResult);

    const updatedDetail = await call(
      request,
      "getMemberDetail",
      { studentId, purpose: "member-record-maintenance" },
      { idToken },
    );
    const updatedResult = updatedDetail.body.result as Record<string, unknown>;
    expect(updatedResult.trainingCenter).toBe("West");
    expect(updatedResult.frequencyNote).toBe("Twice weekly");
    expect(updatedResult.emergencyContact).toEqual({
      ...createInput.emergencyContact,
      alternatePhoneNumber: "+441534000095",
    });
    expect(updatedResult.postalAddress).toBeUndefined();

    // The general list stays minimized and contains the student.
    const list = await call(request, "listMembers", { pageSize: 50 }, { idToken });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const page = list.body.result as { rows: Record<string, unknown>[] };
    const row = page.rows.find((candidate) => candidate.studentId === studentId);
    expect(row).toBeDefined();
    for (const candidate of page.rows) {
      expect(generalRowKeys).toEqual(expect.arrayContaining(Object.keys(candidate)));
    }
    expect(JSON.stringify(page)).not.toMatch(/emergency|postCode|dateOfBirth|@example\.test/u);

    // Direct Firestore access to the Restricted profile is denied by Rules even in the Emulator.
    const direct = await request.get(
      `${firestoreRestBase}/academies/${process.env.T093_E2E_ACADEMY_ID}/studentAdminProfiles/${studentId}`,
    );
    expect(direct.status()).toBe(403);
  });

  test("fails closed without App Check, without a session or with an unapproved lookup kind @critical", async ({
    request,
  }) => {
    const idToken = await signIn(request);

    const noAppCheck = await call(
      request,
      "listMembers",
      { pageSize: 1 },
      { idToken, appCheck: false },
    );
    expect(noAppCheck.status).toBe(401);
    expect(noAppCheck.body.error?.status).toBe("UNAUTHENTICATED");

    const noSession = await call(request, "listMembers", { pageSize: 1 });
    expect(noSession.status).toBe(401);
    expect(noSession.body.error?.status).toBe("UNAUTHENTICATED");

    const legacyKind = await call(
      request,
      "lookupMemberIdentity",
      { lookupKind: "auth-user-id", value: "user-1", purpose: "member-identity-lookup" },
      { idToken },
    );
    expect(legacyKind.status).toBeGreaterThanOrEqual(400);
    expect(legacyKind.body.result).toBeUndefined();
    expect(JSON.stringify(legacyKind.body)).not.toContain("user-1");
  });
});
