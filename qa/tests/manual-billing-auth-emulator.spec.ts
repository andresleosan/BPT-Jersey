import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * T095 authenticated Emulator E2E for the manual billing cycle on canonical data:
 * plan -> membership for a self-service adult -> manual invoice -> manual payment -> account.
 *
 * Same mechanism as T093/T094: the web client is App Check fail-closed, so the spec drives the
 * callables directly with real Auth Emulator sessions and an unsigned App Check token that only
 * the Functions Emulator (skipTokenVerification) accepts. No card data, checkout or provider.
 */
const enabled = process.env.T095_MANUAL_BILLING_EMULATOR_E2E === "true";
const functionsPort = process.env.T095_FUNCTIONS_EMULATOR_PORT ?? "5001";
const projectId = "demo-bpt-jersey";
const academyId = process.env.T095_E2E_ACADEMY_ID ?? "";
const functionsBaseUrl = `http://127.0.0.1:${functionsPort}/${projectId}/us-central1`;
const authUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`;
const firestoreRestBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;

type CallableEnvelope = Readonly<{
  result?: unknown;
  error?: Readonly<{ message?: string; status?: string }>;
}>;
type Session = Readonly<{ idToken: string; uid: string }>;
type Membership = Readonly<{
  membershipId: string;
  familyId: string;
  studentId: string;
  planId: string;
  status: string;
}>;
type Invoice = Readonly<{
  invoiceId: string;
  familyId: string;
  membershipId: string;
  status: string;
  totalMinor: number;
  invoiceReference: string;
}>;
type Account = Readonly<{
  paymentInstructions: Readonly<Record<string, unknown>> | null;
  invoices: readonly Readonly<{
    invoice: Invoice;
    payments: readonly Readonly<{ paymentId: string; amountMinor: number }>[];
    balanceMinor: number;
  }>[];
  balanceMinor: number;
  paygDebtMinor: number;
}>;

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Unsigned, emulator-only App Check token. It is never accepted outside skipTokenVerification.
function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:t095-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

async function signIn(request: APIRequestContext, email: string | undefined): Promise<Session> {
  expect(typeof email).toBe("string");
  const response = await request.post(authUrl, {
    data: { email, password: process.env.T095_E2E_PASSWORD, returnSecureToken: true },
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
    versionLabel: `t095-${suffix}`,
    title: "Synthetic T095 waiver",
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

// Exactly the closed catalog entry for the Town adult plan.
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

test.describe("T095 manual billing cycle with Firebase Emulators", () => {
  test.skip(!enabled, "T095_MANUAL_BILLING_EMULATOR_E2E is not enabled");
  test.beforeAll(() => {
    expect(academyId).toMatch(/^[a-z][a-z0-9-]{2,60}$/u);
  });

  test("runs plan, adult membership, manual invoice, payment and account on canonical data @critical", async ({
    request,
  }) => {
    const owner = await signIn(request, process.env.T095_OWNER_EMAIL);
    const adult = await signIn(request, process.env.T095_ADULT_EMAIL);
    const suffix = randomUUID().replace(/-/gu, "").slice(0, 8).toLowerCase();

    // Prerequisites from the onboarding path: published waiver and a canonical adult profile.
    const version = await ok<{ waiverVersionId: string; contentHash: string }>(
      request,
      "publishWaiverVersion",
      publication(suffix),
      owner,
    );
    const fullName = "Synthetic T095 Adult";
    const profile = await ok<{ student: { studentId: string; familyId?: string } }>(
      request,
      "saveClientProfile",
      {
        requestId: `t095-profile-${suffix}`,
        fullName,
        dateOfBirth: "1992-06-07",
        phoneNumber: "+441534000951",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
      },
      adult,
    );
    const studentId = profile.student.studentId;
    expect(typeof profile.student.familyId).toBe("string");

    // Plan catalog: the owner configures and activates the closed Town adult plan.
    await ok(request, "savePlan", townAdultPlan, owner);
    const activation = await call(
      request,
      "activatePlan",
      { planId: "town-adult" },
      { session: owner },
    );
    expect([200, 400], JSON.stringify(activation.body)).toContain(activation.status);
    const plans = await ok<readonly { planId: string; active?: boolean }[]>(
      request,
      "listManagedPlans",
      null,
      owner,
    );
    expect(plans.find((plan) => plan.planId === "town-adult")?.active).toBe(true);

    // No membership before the current waiver is accepted, even for staff.
    const membershipInput = { studentId, planId: "town-adult", status: "active" };
    await denied(request, "createMembership", membershipInput, owner, 400, "FAILED_PRECONDITION");

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

    // Self-service can only start a trial; staff creates the active membership without naming
    // a family: the backend derives the adult's own family from the canonical record.
    await denied(request, "createMembership", membershipInput, adult, 403, "PERMISSION_DENIED");
    const membership = await ok<Membership>(request, "createMembership", membershipInput, owner);
    expect(membership.studentId).toBe(studentId);
    expect(membership.familyId).toBe(profile.student.familyId);
    expect(membership.status).toBe("active");
    await denied(request, "createMembership", membershipInput, owner, 400, "FAILED_PRECONDITION");
    await denied(
      request,
      "createMembership",
      { ...membershipInput, familyId: `other-family-${suffix}` },
      owner,
      400,
      "FAILED_PRECONDITION",
    );

    // Manual invoice on the derived family; clients never issue invoices.
    const dueAt = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
    const invoiceInput = {
      familyId: membership.familyId,
      membershipId: membership.membershipId,
      totalMinor: townAdultPlan.priceMinor,
      dueAt,
      chargeKind: "membership",
      invoiceReference: `T095-${suffix}`,
      description: "Synthetic monthly membership charge",
    };
    await denied(request, "issueManualInvoice", invoiceInput, adult, 403, "PERMISSION_DENIED");
    const invoice = await ok<Invoice>(request, "issueManualInvoice", invoiceInput, owner);
    expect(invoice.membershipId).toBe(membership.membershipId);
    expect(invoice.familyId).toBe(membership.familyId);
    expect(invoice.totalMinor).toBe(townAdultPlan.priceMinor);

    // The adult sees the open invoice on their own account before paying.
    // T010/T035 re-scope: no gateway, so office publishes where to transfer and the member reads
    // it with their balance. The adult may not write it, and a bad account number never lands.
    await denied(
      request,
      "savePaymentInstructions",
      {
        accountName: "BPT Jersey",
        sortCode: "40-25-30",
        accountNumber: "12345678",
        bankName: null,
        referenceHint: "Quote your invoice reference",
        acceptsCash: true,
      },
      adult,
      403,
      "PERMISSION_DENIED",
    );
    await denied(
      request,
      "savePaymentInstructions",
      {
        accountName: "BPT Jersey",
        sortCode: "40-25-30",
        accountNumber: "1234",
        bankName: null,
        referenceHint: "Quote your invoice reference",
        acceptsCash: true,
      },
      owner,
      400,
      "INVALID_ARGUMENT",
    );
    const instructions = await ok<{ sortCode: string; accountNumber: string }>(
      request,
      "savePaymentInstructions",
      {
        accountName: "BPT Jersey",
        sortCode: "40-25-30",
        accountNumber: "12345678",
        bankName: "Synthetic Bank",
        referenceHint: "Quote your invoice reference",
        acceptsCash: true,
      },
      owner,
    );
    expect(instructions.sortCode).toBe("402530");

    const open = await ok<Account>(request, "listFinancialAccount", null, adult);
    expect(open.paymentInstructions).toMatchObject({
      sortCode: "402530",
      accountNumber: "12345678",
      referenceHint: "Quote your invoice reference",
    });
    const openView = open.invoices.find((view) => view.invoice.invoiceId === invoice.invoiceId);
    expect(openView?.balanceMinor).toBe(townAdultPlan.priceMinor);
    expect(open.paygDebtMinor).toBe(0);
    for (const view of open.invoices) expect(view.invoice.familyId).toBe(membership.familyId);

    // Manual cash payment: never above the balance, then settles it exactly.
    const paymentInput = {
      invoiceId: invoice.invoiceId,
      amountMinor: townAdultPlan.priceMinor,
      method: "cash",
      manualReference: `CASH-${suffix}`,
      occurredAt: new Date().toISOString(),
    };
    await denied(
      request,
      "recordManualPayment",
      { ...paymentInput, amountMinor: townAdultPlan.priceMinor + 100 },
      owner,
      400,
      "FAILED_PRECONDITION",
    );
    await denied(request, "recordManualPayment", paymentInput, adult, 403, "PERMISSION_DENIED");
    await ok(request, "recordManualPayment", paymentInput, owner);

    const settled = await ok<Account>(request, "listFinancialAccount", null, adult);
    const settledView = settled.invoices.find(
      (view) => view.invoice.invoiceId === invoice.invoiceId,
    );
    expect(settledView?.balanceMinor).toBe(0);
    expect(settledView?.payments.map((payment) => payment.amountMinor)).toEqual([
      townAdultPlan.priceMinor,
    ]);
    expect(settled.balanceMinor).toBe(0);

    // Staff dashboard and ledger reflect the same connected records.
    await ok(request, "getFinancialDashboard", null, owner);
    const staffAccount = await ok<Account>(request, "listFinancialAccount", null, owner);
    expect(staffAccount.invoices.some((view) => view.invoice.invoiceId === invoice.invoiceId)).toBe(
      true,
    );
    const memberships = await ok<readonly Membership[]>(request, "listMemberships", null, owner);
    expect(
      memberships.some((candidate) => candidate.membershipId === membership.membershipId),
    ).toBe(true);

    // Direct Firestore access to memberships, invoices and payments is denied by Rules.
    for (const path of [
      `academies/${academyId}/memberships/${membership.membershipId}`,
      `academies/${academyId}/invoices/${invoice.invoiceId}`,
    ]) {
      const direct = await request.get(`${firestoreRestBase}/${path}`);
      expect(direct.status(), path).toBe(403);
    }
  });

  test("fails closed without App Check, without a session and on malformed billing payloads @critical", async ({
    request,
  }) => {
    const owner = await signIn(request, process.env.T095_OWNER_EMAIL);

    for (const name of [
      "createMembership",
      "issueManualInvoice",
      "recordManualPayment",
      "savePaymentInstructions",
    ]) {
      const noAppCheck = await call(request, name, null, { session: owner, appCheck: false });
      expect(noAppCheck.status, name).toBe(401);
      expect(noAppCheck.body.error?.status).toBe("UNAUTHENTICATED");
      const noSession = await call(request, name, null);
      expect(noSession.status, name).toBe(401);
      expect(noSession.body.error?.status).toBe("UNAUTHENTICATED");
    }

    await denied(
      request,
      "createMembership",
      { studentId: "student-1", planId: "town-adult", status: "active", extra: true },
      owner,
      400,
      "INVALID_ARGUMENT",
    );
    await denied(
      request,
      "createMembership",
      { planId: "town-adult", status: "active" },
      owner,
      400,
      "INVALID_ARGUMENT",
    );
    await denied(
      request,
      "issueManualInvoice",
      {
        familyId: "family-1",
        membershipId: "membership-1",
        totalMinor: -100,
        dueAt: new Date().toISOString(),
        chargeKind: "membership",
        invoiceReference: "T095-NEGATIVE",
        description: "Rejected before any read",
      },
      owner,
      400,
      "INVALID_ARGUMENT",
    );
    const unknownMembership = await call(
      request,
      "issueManualInvoice",
      {
        familyId: "family-unknown",
        membershipId: "membership-unknown",
        totalMinor: 100,
        dueAt: new Date().toISOString(),
        chargeKind: "membership",
        invoiceReference: "T095-UNKNOWN",
        description: "Unknown membership",
      },
      { session: owner },
    );
    expect(unknownMembership.status).toBeGreaterThanOrEqual(400);
    expect(unknownMembership.body.result).toBeUndefined();
  });
});
