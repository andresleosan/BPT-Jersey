import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * T116 authenticated Emulator E2E for delegated administrative permissions.
 *
 * The claim is the thing under test. A head coach is refused the office penalty queue, office grants
 * them `reviewPenalties`, the very same session - same token, same claim - is then let in, and the
 * moment office revokes, the door shuts again. Nothing re-issues a token anywhere in this spec, and
 * the suite asserts the claim still reads "headCoach" after the grant.
 *
 * Same mechanism as T093-T098 and T111-T114: the web client is App Check fail-closed, so the spec
 * drives the callables directly with real Auth Emulator sessions and an unsigned App Check token
 * that only the Functions Emulator (skipTokenVerification) accepts.
 */
const enabled = process.env.T116_PERMISSION_GRANT_EMULATOR_E2E === "true";
const functionsPort = process.env.T116_FUNCTIONS_EMULATOR_PORT ?? "5001";
const projectId = "demo-bpt-jersey";
const academyId = process.env.T116_E2E_ACADEMY_ID ?? "";
const functionsBaseUrl = `http://127.0.0.1:${functionsPort}/${projectId}/us-central1`;
const authUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`;
const firestoreRestBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;

type CallableEnvelope = Readonly<{
  result?: unknown;
  error?: Readonly<{ message?: string; status?: string }>;
}>;
type Session = Readonly<{ idToken: string; uid: string }>;
type Grant = Readonly<{
  grantId: string;
  subjectUserId: string;
  permission: string;
  status: string;
  grantedBy: string;
  expiresAt: string;
}>;

const day = 86_400_000;

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Unsigned, emulator-only App Check token. It is never accepted outside skipTokenVerification.
function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:t116-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

async function signIn(request: APIRequestContext, email: string | undefined): Promise<Session> {
  expect(typeof email).toBe("string");
  const response = await request.post(authUrl, {
    data: { email, password: process.env.T116_E2E_PASSWORD, returnSecureToken: true },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { idToken?: string; localId?: string };
  expect(typeof body.idToken).toBe("string");
  expect(typeof body.localId).toBe("string");
  return { idToken: body.idToken as string, uid: body.localId as string };
}

/** Reads the role out of the session's own token, so the claim can be asserted, not assumed. */
function claimRole(session: Session): string {
  const payload = session.idToken.split(".")[1] ?? "";
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    role?: string;
  };
  return decoded.role ?? "";
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

function inDays(days: number): string {
  return new Date(Date.now() + days * day).toISOString();
}

test.describe("T116 delegated staff permissions with Firebase Emulators", () => {
  test.skip(!enabled, "T116_PERMISSION_GRANT_EMULATOR_E2E is not enabled");

  test("office delegates the penalty queue to a coach and takes it back", async ({ request }) => {
    expect(academyId.length).toBeGreaterThan(0);
    const owner = await signIn(request, process.env.T116_OWNER_EMAIL);
    const headCoach = await signIn(request, process.env.T116_HEAD_COACH_EMAIL);

    // The claim before anything happens. Nothing in this spec ever changes it.
    expect(claimRole(headCoach)).toBe("headCoach");

    // 1. Without a grant the office queue is closed to the coach, which is the T111 behaviour.
    await denied(request, "listNoShowPenalties", null, headCoach, 403, "PERMISSION_DENIED");

    // 2. Office grants exactly one permission, with a reason and an expiry.
    const granted = await ok<{ grant: Grant }>(
      request,
      "grantStaffPermission",
      {
        subjectUserId: headCoach.uid,
        permission: "reviewPenalties",
        reason: "Covers the office desk during the Town seminar",
        expiresAt: inDays(7),
      },
      owner,
    );
    expect(granted.grant).toMatchObject({
      subjectUserId: headCoach.uid,
      permission: "reviewPenalties",
      status: "active",
      grantedBy: owner.uid,
    });

    // 3. The same session, with the same token, now reaches the queue.
    const queue = await ok<{ penalties: unknown[] }>(
      request,
      "listNoShowPenalties",
      null,
      headCoach,
    );
    expect(Array.isArray(queue.penalties)).toBe(true);
    // The claim is untouched: the reach came from the document, not from a widened token.
    expect(claimRole(headCoach)).toBe("headCoach");

    // 4. The grant is bounded to what it names: another permission stays closed.
    await denied(
      request,
      "grantStaffPermission",
      {
        subjectUserId: headCoach.uid,
        permission: "manageClasses",
        reason: "Trying to widen the delegation from inside",
        expiresAt: inDays(7),
      },
      headCoach,
      403,
      "PERMISSION_DENIED",
    );
    // 5. And the holder cannot see, extend or hand on the delegation itself.
    await denied(request, "listStaffPermissionGrants", null, headCoach, 403, "PERMISSION_DENIED");
    await denied(
      request,
      "revokeStaffPermission",
      { grantId: granted.grant.grantId, reason: "Trying to keep it alive" },
      headCoach,
      403,
      "PERMISSION_DENIED",
    );

    // 6. Office sees the grant in the list with its live status.
    const listed = await ok<{ grants: Grant[] }>(request, "listStaffPermissionGrants", null, owner);
    expect(listed.grants.some((g) => g.grantId === granted.grant.grantId)).toBe(true);
    expect(listed.grants.find((g) => g.grantId === granted.grant.grantId)?.status).toBe("active");

    // 7. Revoking shuts the door on the next call, with no token refresh anywhere.
    const revoked = await ok<{ grant: Grant }>(
      request,
      "revokeStaffPermission",
      { grantId: granted.grant.grantId, reason: "The seminar is over" },
      owner,
    );
    expect(revoked.grant.status).toBe("revoked");
    await denied(request, "listNoShowPenalties", null, headCoach, 403, "PERMISSION_DENIED");

    // 8. Revoking twice is refused rather than silently writing again.
    await denied(
      request,
      "revokeStaffPermission",
      { grantId: granted.grant.grantId, reason: "The seminar is over" },
      owner,
      400,
      "FAILED_PRECONDITION",
    );

    // 9. Rules keep the collection closed to every client, office included: it is reached only
    //    through the callables.
    for (const session of [owner, headCoach]) {
      const direct = await request.get(
        `${firestoreRestBase}/academies/${academyId}/staffPermissionGrants/${granted.grant.grantId}`,
        { headers: { Authorization: `Bearer ${session.idToken}` } },
      );
      expect(direct.status()).toBe(403);
    }
  });

  test("refuses what the closed list and the bounds do not allow", async ({ request }) => {
    expect(academyId.length).toBeGreaterThan(0);
    const owner = await signIn(request, process.env.T116_OWNER_EMAIL);
    const headCoach = await signIn(request, process.env.T116_HEAD_COACH_EMAIL);

    // A permission outside the closed list never reaches the store.
    for (const permission of ["manageStaff", "grantPermissions", "issueInvoice", "readHealth"]) {
      await denied(
        request,
        "grantStaffPermission",
        {
          subjectUserId: headCoach.uid,
          permission,
          reason: "Trying to delegate something that is not delegable",
          expiresAt: inDays(7),
        },
        owner,
        400,
        "INVALID_ARGUMENT",
      );
    }

    // A grant to oneself, and one to somebody who is not grantable staff.
    await denied(
      request,
      "grantStaffPermission",
      {
        subjectUserId: owner.uid,
        permission: "reviewPenalties",
        reason: "Trying to grant a permission to myself",
        expiresAt: inDays(7),
      },
      owner,
      403,
      "PERMISSION_DENIED",
    );

    // An expiry in the past and one beyond the maximum duration.
    for (const expiresAt of [inDays(-1), inDays(365)]) {
      await denied(
        request,
        "grantStaffPermission",
        {
          subjectUserId: headCoach.uid,
          permission: "reviewPenalties",
          reason: "An expiry the contract does not accept",
          expiresAt,
        },
        owner,
        403,
        "PERMISSION_DENIED",
      );
    }

    // A malformed payload, and a reason too short to mean anything.
    for (const payload of [
      null,
      {},
      { subjectUserId: headCoach.uid, permission: "reviewPenalties", reason: "no" },
      {
        subjectUserId: headCoach.uid,
        permission: "reviewPenalties",
        reason: "A perfectly good reason",
        expiresAt: inDays(7),
        role: "administrator",
      },
    ]) {
      await denied(request, "grantStaffPermission", payload, owner, 400, "INVALID_ARGUMENT");
    }

    // Fail closed without App Check and without a session.
    for (const name of [
      "grantStaffPermission",
      "revokeStaffPermission",
      "listStaffPermissionGrants",
    ]) {
      const withoutAppCheck = await call(request, name, null, { session: owner, appCheck: false });
      expect(withoutAppCheck.status).toBe(401);
      const withoutSession = await call(request, name, null, {});
      expect(withoutSession.status).toBe(401);
    }
  });
});
