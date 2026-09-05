import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * T111 authenticated Emulator E2E for the manual no-show penalty of BRIEF decision 2:
 * membership -> Town session -> booking -> no-show reconciliation -> GBP 15 proposal ->
 * office queue -> charge linked to a manual invoice of T095, or waiver with a reason.
 *
 * The platform proposes and office decides: nothing is ever charged automatically. West is out of
 * scope by the decision, and an absence covered by an approved medical leave never earns a
 * proposal, because the rule that medical absence must not cost a recognition would be hollow if
 * the same absence produced a charge.
 *
 * Same mechanism as T093-T098: the web client is App Check fail-closed, so the spec drives the
 * callables directly with real Auth Emulator sessions and an unsigned App Check token that only
 * the Functions Emulator (skipTokenVerification) accepts.
 */
const enabled = process.env.T111_NO_SHOW_PENALTY_EMULATOR_E2E === "true";
const functionsPort = process.env.T111_FUNCTIONS_EMULATOR_PORT ?? "5001";
const projectId = "demo-bpt-jersey";
const academyId = process.env.T111_E2E_ACADEMY_ID ?? "";
const functionsBaseUrl = `http://127.0.0.1:${functionsPort}/${projectId}/us-central1`;
const authUrl = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`;
const firestoreRestBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;

type CallableEnvelope = Readonly<{
  result?: unknown;
  error?: Readonly<{ message?: string; status?: string }>;
}>;
type Session = Readonly<{ idToken: string; uid: string }>;
type ScheduleSession = Readonly<{ sessionId: string; locationId: string; startAt: string }>;
type Penalty = Readonly<{
  penaltyId: string;
  sessionId: string;
  studentId: string;
  locationId: string;
  amountMinor: number;
  currency: string;
  status: string;
  proposedBy: string;
  resolution: Readonly<{
    decision: string;
    reason: string;
    invoiceId: string | null;
    resolvedBy: string;
  }> | null;
}>;
type Proposal = Readonly<{
  sessionId: string;
  proposed: readonly Penalty[];
  skipped: readonly Readonly<{ studentId: string; skipReason: string }>[];
  alreadyProposed: number;
}>;

const hour = 3_600_000;
/** BRIEF decision 2: GBP 15, in minor units. */
const penaltyAmountMinor = 1_500;

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Unsigned, emulator-only App Check token. It is never accepted outside skipTokenVerification.
function syntheticAppCheckToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    sub: `1:${projectId}:web:t111-e2e`,
    aud: [`projects/${projectId}`],
    iss: `https://firebaseappcheck.googleapis.com/${projectId}`,
    iat: now,
    exp: now + 3_600,
  })}.emulator-only`;
}

async function signIn(request: APIRequestContext, email: string | undefined): Promise<Session> {
  expect(typeof email).toBe("string");
  const response = await request.post(authUrl, {
    data: { email, password: process.env.T111_E2E_PASSWORD, returnSecureToken: true },
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
    versionLabel: `t111-${suffix}`,
    title: "Synthetic T111 waiver",
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

// The canonical both-sites adult plan, so the same student can be absent at Town and at West and
// only the Town absence is penalised.
const bothSitesAdultPlan = {
  planId: "bpt-jersey-adult",
  displayName: "BPT Jersey Adult",
  priceMinor: 12_500,
  currency: "GBP",
  billingPeriod: "monthly",
  eligibleParticipantTypes: ["adult"],
  classSites: ["Town", "West"],
  weeklyClassLimit: null,
  openMatSites: ["Town", "West"],
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

test.describe("T111 no-show penalty with Firebase Emulators", () => {
  test.skip(!enabled, "T111_NO_SHOW_PENALTY_EMULATOR_E2E is not enabled");
  test.beforeAll(() => {
    expect(academyId).toMatch(/^[a-z][a-z0-9-]{2,60}$/u);
  });

  test("proposes the Town no-show penalty and lets office charge or waive it @critical", async ({
    request,
  }) => {
    // Around fifty sequential callables against the Functions Emulator; the default budget is
    // sized for browser pages.
    test.setTimeout(240_000);
    const owner = await signIn(request, process.env.T111_OWNER_EMAIL);
    const headCoach = await signIn(request, process.env.T111_HEAD_COACH_EMAIL);
    const adult = await signIn(request, process.env.T111_ADULT_EMAIL);
    const suffix = randomUUID().replace(/-/gu, "").slice(0, 8).toLowerCase();

    // Prerequisites from the onboarding and billing paths: waiver, canonical adult and membership.
    const version = await ok<{ waiverVersionId: string; contentHash: string }>(
      request,
      "publishWaiverVersion",
      publication(suffix),
      owner,
    );
    const fullName = "Synthetic T111 Adult";
    const profile = await ok<{ student: { studentId: string; familyId?: string } }>(
      request,
      "saveClientProfile",
      {
        requestId: `t111-profile-${suffix}`,
        fullName,
        dateOfBirth: "1990-04-11",
        phoneNumber: "+441534000971",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
      },
      adult,
    );
    const studentId = profile.student.studentId;
    const familyId = profile.student.familyId;
    expect(typeof familyId).toBe("string");
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
    await ok(request, "savePlan", bothSitesAdultPlan, owner);
    const activation = await call(
      request,
      "activatePlan",
      { planId: bothSitesAdultPlan.planId },
      { session: owner },
    );
    expect([200, 400], JSON.stringify(activation.body)).toContain(activation.status);
    const membership = await ok<{ membershipId: string }>(
      request,
      "createMembership",
      { studentId, planId: bothSitesAdultPlan.planId, status: "active" },
      owner,
    );

    const { program } = await ok<{ program: { programId: string } }>(
      request,
      "saveProgram",
      { name: `T111 Adults ${suffix}`, ageBand: "adult", discipline: "bjj", level: "all-levels" },
      owner,
    );
    async function newSession(
      locationId: "town" | "west",
      offsetMs: number,
      label: string,
    ): Promise<ScheduleSession> {
      const created = await ok<{ session: ScheduleSession }>(
        request,
        "saveSession",
        sessionInput(program.programId, owner.uid, locationId, offsetMs, `T111 ${label} ${suffix}`),
        owner,
      );
      await ok(
        request,
        "requestBooking",
        { sessionId: created.session.sessionId, studentId, membershipId: membership.membershipId },
        adult,
      );
      return created.session;
    }

    // Five booked sessions: two Town absences that office will resolve differently, one Town
    // absence covered later by a medical leave, one Town class actually attended, and one West
    // absence that the decision leaves out of scope.
    const charged = await newSession("town", 3 * hour, "Charged");
    const waived = await newSession("town", 4 * hour, "Waived");
    const medical = await newSession("town", 5 * hour, "Medical");
    const attended = await newSession("town", 6 * hour, "Attended");
    const west = await newSession("west", 7 * hour, "West");
    expect(west.locationId).toBe("west");

    await ok(
      request,
      "checkIn",
      { sessionId: attended.sessionId, studentId, method: "manual" },
      owner,
    );

    // The absences become canonical no-show attendance; the attended class produces none.
    for (const [session, expected] of [
      [charged, 1],
      [waived, 1],
      [medical, 1],
      [attended, 0],
      [west, 1],
    ] as const) {
      const reconciled = await ok<{ noShowsMarked: number }>(
        request,
        "reconcileSessionNoShows",
        { sessionId: session.sessionId },
        owner,
      );
      expect(reconciled.noShowsMarked, session.sessionId).toBe(expected);
    }

    // Presence never costs money, and West is out of the decision's scope with the reason recorded.
    const attendedProposal = (
      await ok<{ result: Proposal }>(
        request,
        "proposeNoShowPenalties",
        { sessionId: attended.sessionId },
        owner,
      )
    ).result;
    expect(attendedProposal).toMatchObject({ proposed: [], skipped: [], alreadyProposed: 0 });
    const westProposal = (
      await ok<{ result: Proposal }>(
        request,
        "proposeNoShowPenalties",
        { sessionId: west.sessionId },
        owner,
      )
    ).result;
    expect(westProposal.proposed).toEqual([]);
    expect(westProposal.skipped).toEqual([{ studentId, skipReason: "otherSite" }]);

    // The Town absence earns a proposal of GBP 15, never a charge. A client may not propose, and
    // any staff role that operated the session may: the head coach proposes the second one.
    await denied(
      request,
      "proposeNoShowPenalties",
      { sessionId: charged.sessionId },
      adult,
      403,
      "PERMISSION_DENIED",
    );
    const chargedProposal = (
      await ok<{ result: Proposal }>(
        request,
        "proposeNoShowPenalties",
        { sessionId: charged.sessionId },
        owner,
      )
    ).result;
    expect(chargedProposal.proposed).toHaveLength(1);
    const chargedPenalty = chargedProposal.proposed[0] as Penalty;
    expect(chargedPenalty).toMatchObject({
      penaltyId: `${charged.sessionId}__${studentId}`,
      sessionId: charged.sessionId,
      studentId,
      locationId: "town",
      amountMinor: penaltyAmountMinor,
      currency: "GBP",
      status: "proposed",
      proposedBy: owner.uid,
      resolution: null,
    });
    const waivedProposal = (
      await ok<{ result: Proposal }>(
        request,
        "proposeNoShowPenalties",
        { sessionId: waived.sessionId },
        headCoach,
      )
    ).result;
    expect(waivedProposal.proposed).toHaveLength(1);
    const waivedPenalty = waivedProposal.proposed[0] as Penalty;
    expect(waivedPenalty.proposedBy).toBe(headCoach.uid);
    expect(waivedPenalty.status).toBe("proposed");

    // The queue is office only: neither the client nor the coach who proposed may read it.
    await denied(request, "listNoShowPenalties", null, adult, 403, "PERMISSION_DENIED");
    await denied(request, "listNoShowPenalties", null, headCoach, 403, "PERMISSION_DENIED");
    await denied(
      request,
      "listNoShowPenalties",
      { state: "proposed" },
      owner,
      400,
      "INVALID_ARGUMENT",
    );
    await denied(
      request,
      "listNoShowPenalties",
      { status: "refunded" },
      owner,
      400,
      "INVALID_ARGUMENT",
    );
    const pending = (
      await ok<{ penalties: readonly Penalty[] }>(
        request,
        "listNoShowPenalties",
        { status: "proposed" },
        owner,
      )
    ).penalties;
    expect(pending.map((entry) => entry.penaltyId).sort()).toEqual(
      [chargedPenalty.penaltyId, waivedPenalty.penaltyId].sort(),
    );
    for (const entry of pending) {
      expect(entry.amountMinor).toBe(penaltyAmountMinor);
      expect(entry.locationId).toBe("town");
    }

    // Resolution is office only, always with a reason, and an invoice belongs to a charge.
    const chargeInput = {
      penaltyId: chargedPenalty.penaltyId,
      decision: "charge",
      reason: "Absent without notice at Town",
    };
    await denied(request, "resolveNoShowPenalty", chargeInput, adult, 403, "PERMISSION_DENIED");
    await denied(request, "resolveNoShowPenalty", chargeInput, headCoach, 403, "PERMISSION_DENIED");
    await denied(
      request,
      "resolveNoShowPenalty",
      { ...chargeInput, reason: "too short" },
      owner,
      400,
      "INVALID_ARGUMENT",
    );
    await denied(
      request,
      "resolveNoShowPenalty",
      { penaltyId: waivedPenalty.penaltyId, decision: "waive", reason: "Waived", invoiceId: "x1" },
      owner,
      400,
      "INVALID_ARGUMENT",
    );
    await denied(
      request,
      "resolveNoShowPenalty",
      { ...chargeInput, penaltyId: `missing-${suffix}` },
      owner,
      404,
      "NOT_FOUND",
    );

    // The money keeps travelling through the manual billing cycle of T095: office issues the
    // invoice in Billing and links it here. The penalty never issues one on its own.
    const invoice = await ok<{ invoiceId: string; totalMinor: number }>(
      request,
      "issueManualInvoice",
      {
        familyId,
        membershipId: membership.membershipId,
        totalMinor: penaltyAmountMinor,
        dueAt: new Date(Date.now() + 7 * 24 * hour).toISOString(),
        chargeKind: "manual_adjustment",
        invoiceReference: `T111-${suffix}`,
        description: "Synthetic Town no-show penalty",
      },
      owner,
    );
    expect(invoice.totalMinor).toBe(penaltyAmountMinor);
    const chargedResult = (
      await ok<{ penalty: Penalty }>(
        request,
        "resolveNoShowPenalty",
        { ...chargeInput, invoiceId: invoice.invoiceId },
        owner,
      )
    ).penalty;
    expect(chargedResult).toMatchObject({
      penaltyId: chargedPenalty.penaltyId,
      status: "charged",
      amountMinor: penaltyAmountMinor,
    });
    expect(chargedResult.resolution).toMatchObject({
      decision: "charge",
      reason: chargeInput.reason,
      invoiceId: invoice.invoiceId,
      resolvedBy: owner.uid,
    });

    // A penalty is resolved once: a charge may not quietly become a waiver.
    await denied(
      request,
      "resolveNoShowPenalty",
      {
        penaltyId: chargedPenalty.penaltyId,
        decision: "waive",
        reason: "Reversing the charge in silence",
      },
      owner,
      400,
      "FAILED_PRECONDITION",
    );

    const waivedResult = (
      await ok<{ penalty: Penalty }>(
        request,
        "resolveNoShowPenalty",
        {
          penaltyId: waivedPenalty.penaltyId,
          decision: "waive",
          reason: "First absence, warned in person",
        },
        owner,
      )
    ).penalty;
    expect(waivedResult.status).toBe("waived");
    expect(waivedResult.resolution).toMatchObject({
      decision: "waive",
      invoiceId: null,
      resolvedBy: owner.uid,
    });

    // The queue empties as office decides, and each decision keeps its own status.
    const stillPending = (
      await ok<{ penalties: readonly Penalty[] }>(
        request,
        "listNoShowPenalties",
        { status: "proposed" },
        owner,
      )
    ).penalties;
    expect(stillPending.map((entry) => entry.penaltyId)).not.toContain(chargedPenalty.penaltyId);
    expect(stillPending.map((entry) => entry.penaltyId)).not.toContain(waivedPenalty.penaltyId);
    for (const [status, penaltyId] of [
      ["charged", chargedPenalty.penaltyId],
      ["waived", waivedPenalty.penaltyId],
    ] as const) {
      const filtered = (
        await ok<{ penalties: readonly Penalty[] }>(
          request,
          "listNoShowPenalties",
          { status },
          owner,
        )
      ).penalties;
      expect(
        filtered.map((entry) => entry.penaltyId),
        status,
      ).toContain(penaltyId);
    }

    // Proposing again is the same document: the deterministic identifier never duplicates a
    // penalty, and a resolved one is never returned to the queue.
    const replay = (
      await ok<{ result: Proposal }>(
        request,
        "proposeNoShowPenalties",
        { sessionId: charged.sessionId },
        owner,
      )
    ).result;
    expect(replay).toMatchObject({ proposed: [], alreadyProposed: 1 });
    const afterReplay = (
      await ok<{ penalties: readonly Penalty[] }>(
        request,
        "listNoShowPenalties",
        { status: "charged" },
        owner,
      )
    ).penalties;
    expect(afterReplay.find((entry) => entry.penaltyId === chargedPenalty.penaltyId)?.status).toBe(
      "charged",
    );

    // An approved medical leave covering the day of the class never earns a proposal: the rule
    // that medical absence must not cost a recognition would be hollow if the same absence
    // produced a charge. The rule is read when proposing, and it never reopens what office
    // already resolved.
    const medicalDay = new Date(medical.startAt).toISOString().slice(0, 10);
    await ok(
      request,
      "recordMedicalLeave",
      { studentId, startDate: medicalDay, endDate: medicalDay, reasonCode: "injury" },
      owner,
    );
    const medicalProposal = (
      await ok<{ result: Proposal }>(
        request,
        "proposeNoShowPenalties",
        { sessionId: medical.sessionId },
        owner,
      )
    ).result;
    expect(medicalProposal.proposed).toEqual([]);
    expect(medicalProposal.skipped).toEqual([{ studentId, skipReason: "medicalLeave" }]);
    const afterLeave = (
      await ok<{ penalties: readonly Penalty[] }>(
        request,
        "listNoShowPenalties",
        { status: "charged" },
        owner,
      )
    ).penalties;
    expect(afterLeave.map((entry) => entry.penaltyId)).toContain(chargedPenalty.penaltyId);

    // Direct Firestore access to the penalties and to their audit evidence is denied.
    for (const path of [
      `academies/${academyId}/noShowPenalties/${chargedPenalty.penaltyId}`,
      `academies/${academyId}/noShowPenalties/${waivedPenalty.penaltyId}`,
      `academies/${academyId}/auditEvents/no-show-penalty-proposed-${chargedPenalty.penaltyId}`,
      `academies/${academyId}/auditEvents/no-show-penalty-resolved-${chargedPenalty.penaltyId}`,
    ]) {
      const direct = await request.get(`${firestoreRestBase}/${path}`);
      expect(direct.status(), path).toBe(403);
    }
  });

  test("fails closed without App Check, without a session and on malformed payloads @critical", async ({
    request,
  }) => {
    const owner = await signIn(request, process.env.T111_OWNER_EMAIL);

    for (const name of ["proposeNoShowPenalties", "listNoShowPenalties", "resolveNoShowPenalty"]) {
      const noAppCheck = await call(request, name, null, { session: owner, appCheck: false });
      expect(noAppCheck.status, name).toBe(401);
      expect(noAppCheck.body.error?.status).toBe("UNAUTHENTICATED");
      const noSession = await call(request, name, null);
      expect(noSession.status, name).toBe(401);
      expect(noSession.body.error?.status).toBe("UNAUTHENTICATED");
    }

    await denied(request, "proposeNoShowPenalties", null, owner, 400, "INVALID_ARGUMENT");
    await denied(
      request,
      "proposeNoShowPenalties",
      { sessionId: "" },
      owner,
      400,
      "INVALID_ARGUMENT",
    );
    await denied(
      request,
      "proposeNoShowPenalties",
      { sessionId: "session-1", force: true },
      owner,
      400,
      "INVALID_ARGUMENT",
    );
    await denied(
      request,
      "proposeNoShowPenalties",
      { sessionId: `unknown-session-${randomUUID().slice(0, 8)}` },
      owner,
      404,
      "NOT_FOUND",
    );
    await denied(request, "resolveNoShowPenalty", null, owner, 400, "INVALID_ARGUMENT");
    await denied(
      request,
      "resolveNoShowPenalty",
      { penaltyId: "penalty-1", decision: "refund", reason: "A long enough reason" },
      owner,
      400,
      "INVALID_ARGUMENT",
    );
  });
});
