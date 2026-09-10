import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { expect, test, type APIRequestContext } from "@playwright/test";

const authUrl =
  "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo";
const functionsBaseUrl = "http://127.0.0.1:5001/demo-bpt-jersey/us-central1";

type CallableEnvelope = {
  result?: {
    preference?: Record<string, unknown>;
    preferences?: Record<string, unknown>[];
  };
  error?: Record<string, unknown>;
};

const useBootstrap = process.env.T064_NOTIFICATION_EMULATOR_BOOTSTRAP === "true";
let adminAuth: Auth | undefined;
let adminApp: ReturnType<typeof initializeApp> | undefined;
let syntheticCredentials: Readonly<{ email: string; password: string; role: "owner" }> | undefined;

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

test.describe("T064 notification preferences with Firebase Emulators", () => {
  test.beforeAll(async () => {
    if (!useBootstrap) return;
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
    adminApp = initializeApp(
      { projectId: "demo-bpt-jersey" },
      `t064-notification-e2e-${randomUUID()}`,
    );
    adminAuth = getAuth(adminApp);
    const email = `t064-${randomUUID()}@example.test`;
    const password = `${randomUUID()}Aa1!`;
    const user = await adminAuth.createUser({ email, password });
    await adminAuth.setCustomUserClaims(user.uid, {
      academyId: "academy-t064-e2e",
      role: "owner",
    });
    syntheticCredentials = { email, password, role: "owner" };
  });

  test.afterAll(async () => {
    if (adminAuth !== undefined && syntheticCredentials !== undefined) {
      const current = await adminAuth.getUserByEmail(syntheticCredentials.email);
      await adminAuth.deleteUser(current.uid);
    }
    if (adminApp !== undefined) await deleteApp(adminApp);
  });

  test("authenticates and persists an owner preference @critical", async ({
    request,
  }, testInfo) => {
    const role = useBootstrap ? syntheticCredentials?.role : process.env.AUTH_EMULATOR_E2E_ROLE;
    const email = useBootstrap ? syntheticCredentials?.email : process.env.AUTH_EMULATOR_E2E_EMAIL;
    const password = useBootstrap
      ? syntheticCredentials?.password
      : process.env.AUTH_EMULATOR_E2E_PASSWORD;
    test.skip(
      process.env.T064_NOTIFICATION_EMULATOR_E2E !== "true" ||
        !email ||
        !password ||
        !role ||
        !["owner", "administrator"].includes(role),
      "Synthetic T064 Emulator credentials, owner/administrator claims, and seed are required.",
    );

    const audienceId = `audience-t064-e2e-${testInfo.repeatEachIndex}`;
    const unauthenticated = await call(request, "listNotificationPreferences", { audienceId });
    expect(unauthenticated.response.status()).toBe(401);
    expect(unauthenticated.body).toMatchObject({ error: { status: "UNAUTHENTICATED" } });

    const login = await request.post(authUrl, {
      data: {
        email,
        password,
        returnSecureToken: true,
      },
    });
    expect(login.status()).toBe(200);
    const loginBody = (await login.json()) as { idToken?: string };
    expect(loginBody.idToken).toEqual(expect.any(String));
    const idToken = loginBody.idToken!;

    const saved = await call(
      request,
      "saveNotificationPreference",
      {
        audienceId,
        purpose: "class_reminder",
        channel: "email",
        enabled: true,
        consentState: "granted",
      },
      idToken,
    );
    expect(saved.response.status()).toBe(200);
    expect(saved.body).toMatchObject({
      result: {
        preference: {
          audienceId,
          purpose: "class_reminder",
          channel: "email",
          enabled: true,
          consentState: "granted",
          preferenceId: expect.stringMatching(/^notification-preference-/u),
          updatedAt: expect.any(String),
        },
      },
    });

    const listed = await call(request, "listNotificationPreferences", { audienceId }, idToken);
    expect(listed.response.status()).toBe(200);
    expect(listed.body.result?.preferences).toEqual([
      expect.objectContaining({
        audienceId,
        purpose: "class_reminder",
        channel: "email",
        enabled: true,
        consentState: "granted",
      }),
    ]);

    const updated = await call(
      request,
      "saveNotificationPreference",
      {
        audienceId,
        purpose: "class_reminder",
        channel: "email",
        enabled: false,
        consentState: "withdrawn",
      },
      idToken,
    );
    expect(updated.response.status()).toBe(200);
    expect(updated.body.result?.preference).toMatchObject({
      audienceId,
      enabled: false,
      consentState: "withdrawn",
    });
  });
});
