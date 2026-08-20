import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";

import { appendAuditEventInTransaction } from "../../apps/functions/src/audit/audit-writer.js";
import {
  createFinancialAccessService,
  FinancialAccessServiceError,
} from "../../apps/functions/src/finance/financial-access-service.js";
import {
  createFinanceStore,
  type FinanceFirestore,
} from "../../apps/functions/src/finance/finance-service.js";
import {
  createMembershipStore,
  type MembershipFirestore,
} from "../../apps/functions/src/memberships/membership-service.js";

const runId = `financial-access-${process.pid}-${randomUUID()}`;
const academyA = `${runId}-academy-a`;
const academyB = `${runId}-academy-b`;
const actorId = `${runId}-owner`;
const familyId = `${runId}-family`;
const studentId = `${runId}-student`;
const membershipId = `${runId}-membership`;
const relationshipId = `${familyId}--${studentId}`;
const sourceSessionId = `${runId}-session`;
const now = "2026-08-19T10:00:00.000Z";

function requireFirestoreEmulatorHost(): void {
  if (
    typeof process.env.FIRESTORE_EMULATOR_HOST !== "string" ||
    process.env.FIRESTORE_EMULATOR_HOST.trim() === ""
  ) {
    throw new Error("Firestore Emulator host is required");
  }
}

requireFirestoreEmulatorHost();
const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const firestore = getFirestore(app);

const academyCollections = [
  "families",
  "students",
  "relationships",
  "plans",
  "memberships",
  "invoices",
  "payments",
  "auditEvents",
  "debts",
  "balances",
  "restrictions",
  "financialAccess",
] as const;

async function clearRunData(): Promise<void> {
  await Promise.all(
    [academyA, academyB].flatMap((academyId) =>
      academyCollections.map(async (collection) => {
        const snapshot = await firestore.collection(`academies/${academyId}/${collection}`).get();
        await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
      }),
    ),
  );
}

async function expectNoForbiddenFinancialDocuments(): Promise<void> {
  for (const collection of ["debts", "balances", "restrictions", "financialAccess"] as const) {
    const snapshot = await firestore.collection(`academies/${academyA}/${collection}`).get();
    expect(snapshot.docs).toHaveLength(0);
  }
}

async function seedFixture(): Promise<void> {
  const paygPlan = PLAN_CATALOG.find((plan) => plan.planId === "payg");
  if (paygPlan === undefined) throw new Error("PAYG plan catalog fixture is unavailable");

  await Promise.all([
    firestore.doc(`academies/${academyA}/families/${familyId}`).set({
      familyId,
      academyId: academyA,
      primaryContactUserId: actorId,
      billingContactUserId: actorId,
      active: true,
      status: "active",
      schemaVersion: "1",
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    }),
    firestore.doc(`academies/${academyA}/students/${studentId}`).set({
      studentId,
      academyId: academyA,
      familyId,
      fullName: `Synthetic student ${studentId}`,
      dateOfBirth: "2012-01-01",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      participantType: "minor",
      active: true,
      status: "active",
      schemaVersion: "1",
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    }),
    firestore.doc(`academies/${academyA}/relationships/${relationshipId}`).set({
      relationshipId,
      academyId: academyA,
      familyId,
      studentId,
      adultUserId: actorId,
      relationshipType: "guardian",
      permissions: ["readProfile"],
      validFrom: now,
      active: true,
      status: "active",
      schemaVersion: "1",
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    }),
    firestore.doc(`academies/${academyA}/plans/${paygPlan.planId}`).set({
      ...paygPlan,
      academyId: academyA,
      active: true,
      schemaVersion: "1",
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    }),
    firestore.doc(`academies/${academyA}/memberships/${membershipId}`).set({
      membershipId,
      academyId: academyA,
      familyId,
      studentId,
      planId: paygPlan.planId,
      status: "active",
      startsAt: now,
      endsAt: null,
      nextBillingAt: null,
      schemaVersion: "1",
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
    }),
  ]);
}

describe("financial access against the Firestore Emulator", () => {
  beforeAll(async () => {
    await clearRunData();
    await seedFixture();
  });

  afterAll(async () => {
    await clearRunData();
    await deleteApp(app);
  });

  it("restricts PAYG debt, recovers after payment, and remains tenant-isolated", async () => {
    const membershipStore = createMembershipStore({
      firestore: firestore as unknown as MembershipFirestore,
    });
    const financeStore = createFinanceStore({
      firestore: firestore as unknown as FinanceFirestore,
      appendAudit: (transaction, ref, draft) =>
        appendAuditEventInTransaction(transaction, ref, draft as unknown as AuditEventDraft),
    });
    const accessService = createFinancialAccessService({
      getMembership: membershipStore.getMembership,
      listFinancialAccount: financeStore.listFinancialAccount,
    });

    const paygDebtMinor = 1000;
    const invoice = await financeStore.issuePaygInvoice({
      academyId: academyA,
      actorId,
      familyId,
      membershipId,
      totalMinor: paygDebtMinor,
      dueAt: now,
      chargeKind: "payg_session",
      sourceRef: `academies/${academyA}/families/${familyId}/sessions/${sourceSessionId}`,
      invoiceReference: `${runId}-invoice`,
      description: "Synthetic PAYG session",
    });

    const restricted = await accessService.getAccessDecision({
      academyId: academyA,
      membershipId,
    });
    expect(restricted).toMatchObject({
      academyId: academyA,
      membershipId,
      membershipStatus: "active",
      paygDebtMinor,
      decision: {
        allowed: false,
        code: "PAYG_DEBT_OUTSTANDING",
        membershipStatus: "active",
        paygDebtMinor,
      },
    });

    const membershipBefore = await firestore
      .doc(`academies/${academyA}/memberships/${membershipId}`)
      .get();
    expect(membershipBefore.data()).toMatchObject({ status: "active" });

    await expectNoForbiddenFinancialDocuments();

    await financeStore.recordManualPayment({
      academyId: academyA,
      actorId,
      invoiceId: invoice.invoiceId,
      amountMinor: paygDebtMinor,
      method: "cash",
      manualReference: `${runId}-payment`,
      occurredAt: now,
    });
    await expectNoForbiddenFinancialDocuments();

    const recovered = await accessService.getAccessDecision({
      academyId: academyA,
      membershipId,
    });
    expect(recovered).toMatchObject({
      academyId: academyA,
      membershipId,
      membershipStatus: "active",
      paygDebtMinor: 0,
      decision: {
        allowed: true,
        code: "ALLOWED",
        membershipStatus: "active",
        paygDebtMinor: 0,
      },
    });
    await expectNoForbiddenFinancialDocuments();

    const membershipAfter = await firestore
      .doc(`academies/${academyA}/memberships/${membershipId}`)
      .get();
    expect(membershipAfter.data()).toMatchObject({ status: "active" });

    const recoveredAgain = await accessService.getAccessDecision({
      academyId: academyA,
      membershipId,
    });
    expect(recoveredAgain).toEqual(recovered);

    const crossTenantError = await accessService
      .getAccessDecision({ academyId: academyB, membershipId })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(crossTenantError).toBeInstanceOf(FinancialAccessServiceError);
    expect(crossTenantError).toMatchObject({
      code: "not-found",
      message: "Financial access is not available",
    });
  });
});
