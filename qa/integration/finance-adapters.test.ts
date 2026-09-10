import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import type { AuditEventDraft } from "@bpt-jersey/domain/audit";

import {
  getInvoiceHandler,
  listFinancialAccountHandler,
  recordManualPaymentHandler,
  issueManualInvoiceHandler,
  type FinanceCallableServices,
} from "../../apps/functions/src/finance/finance-callables.js";
import {
  createFinanceStore,
  type FinanceFirestore,
} from "../../apps/functions/src/finance/finance-service.js";
import { appendAuditEventInTransaction } from "../../apps/functions/src/audit/audit-writer.js";

const runId = `finance-${process.pid}-${randomUUID().slice(0, 8)}`;
const academyA = `${runId}-academy-a`;
const academyB = `${runId}-academy-b`;
const ownerA = `${runId}-owner-a`;
const administratorA = `${runId}-administrator-a`;
const guardianA = `${runId}-guardian-a`;
const adultStudentA = `${runId}-adult-a`;
const coachA = `${runId}-coach-a`;
const ownerB = `${runId}-owner-b`;
const familyA = `${runId}-family-a`;
const adultFamilyA = `${runId}-adult-family-a`;
const membershipA = `${runId}-membership-a`;
const adultMembershipA = `${runId}-adult-membership-a`;
const now = "2026-08-19T10:00:00.000Z";

const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const auth = getAuth(app);
const firestore = getFirestore(app);

function request(
  data: unknown,
  userId: string,
  academyId: string,
  role: string,
): CallableRequest<unknown> {
  return {
    data,
    rawRequest: {} as CallableRequest<unknown>["rawRequest"],
    auth: { uid: userId, token: { academyId, role } },
  } as unknown as CallableRequest<unknown>;
}

function services(): FinanceCallableServices {
  return {
    store: createFinanceStore({
      firestore: firestore as unknown as FinanceFirestore,
      appendAudit: (transaction, ref, draft) =>
        appendAuditEventInTransaction(transaction, ref, draft as unknown as AuditEventDraft),
    }),
    familyStore: {
      getGuardianFamily: async (academyId, userId) =>
        academyId === academyA && userId === guardianA
          ? {
              family: { familyId: familyA, active: true, status: "active" },
              tutor: {
                userId: guardianA,
                displayName: "Synthetic guardian",
                email: `${guardianA}@example.test`,
                phoneNumber: "+441234567890",
              },
              students: [],
            }
          : undefined,
    },
    findStudentByUserId: async (academyId, userId) =>
      academyId === academyA && userId === adultStudentA
        ? {
            studentId: `${runId}-adult-student`,
            familyId: adultFamilyA,
            participantType: "adult",
            active: true,
            status: "active",
          }
        : undefined,
    isActorActive: async (actor) => !(await auth.getUser(actor.userId)).disabled,
  };
}

async function seed(): Promise<void> {
  await Promise.all(
    [
      [ownerA, academyA, "owner"],
      [administratorA, academyA, "administrator"],
      [guardianA, academyA, "guardian"],
      [adultStudentA, academyA, "adultStudent"],
      [coachA, academyA, "coach"],
      [ownerB, academyB, "owner"],
    ].map(async ([userId, academyId, role]) => {
      await auth.createUser({ uid: userId, email: `${userId}@example.test` });
      await auth.setCustomUserClaims(userId, { academyId, role });
    }),
  );
  await Promise.all([
    firestore.doc(`academies/${academyA}/families/${familyA}`).set({
      familyId: familyA,
      academyId: academyA,
      active: true,
      status: "active",
    }),
    firestore.doc(`academies/${academyA}/families/${adultFamilyA}`).set({
      familyId: adultFamilyA,
      academyId: academyA,
      active: true,
      status: "active",
    }),
    firestore.doc(`academies/${academyA}/memberships/${membershipA}`).set({
      membershipId: membershipA,
      academyId: academyA,
      familyId: familyA,
      studentId: `${runId}-minor-student`,
      status: "active",
    }),
    firestore.doc(`academies/${academyA}/memberships/${adultMembershipA}`).set({
      membershipId: adultMembershipA,
      academyId: academyA,
      familyId: adultFamilyA,
      studentId: `${runId}-adult-student`,
      status: "active",
    }),
  ]);
}

describe("finance adapters against Auth/Firestore emulators", () => {
  beforeAll(async () => {
    await seed();
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  it("creates, pays, and reads a manual invoice with idempotent payment", async () => {
    const finance = services();
    const invoice = await issueManualInvoiceHandler(
      request(
        {
          familyId: familyA,
          membershipId: membershipA,
          totalMinor: 1000,
          dueAt: now,
          chargeKind: "membership",
          invoiceReference: `${runId}-invoice-a`,
          description: "Synthetic membership invoice",
        },
        ownerA,
        academyA,
        "owner",
      ),
      finance,
    );
    const firstPayment = await recordManualPaymentHandler(
      request(
        {
          invoiceId: invoice.invoiceId,
          amountMinor: 400,
          method: "cash",
          manualReference: `${runId}-cash-a`,
          occurredAt: now,
        },
        administratorA,
        academyA,
        "administrator",
      ),
      finance,
    );
    const replay = await recordManualPaymentHandler(
      request(
        {
          invoiceId: invoice.invoiceId,
          amountMinor: 400,
          method: "cash",
          manualReference: `${runId}-cash-a`,
          occurredAt: now,
        },
        administratorA,
        academyA,
        "administrator",
      ),
      finance,
    );

    expect(replay).toEqual(firstPayment);
    await expect(
      getInvoiceHandler(
        request({ invoiceId: invoice.invoiceId }, guardianA, academyA, "guardian"),
        finance,
      ),
    ).resolves.toMatchObject({ balanceMinor: 600 });
    const payments = await firestore.collection(`academies/${academyA}/payments`).get();
    expect(payments.docs).toHaveLength(1);
  });

  it("keeps guardian and adult reads scoped to their own family/student", async () => {
    const finance = services();
    await issueManualInvoiceHandler(
      request(
        {
          familyId: adultFamilyA,
          membershipId: adultMembershipA,
          totalMinor: 1000,
          dueAt: now,
          chargeKind: "manual_adjustment",
          invoiceReference: `${runId}-invoice-adult`,
          description: "Synthetic adult invoice",
        },
        ownerA,
        academyA,
        "owner",
      ),
      finance,
    );

    const guardianAccount = await listFinancialAccountHandler(
      request(null, guardianA, academyA, "guardian"),
      finance,
    );
    const adultAccount = await listFinancialAccountHandler(
      request(null, adultStudentA, academyA, "adultStudent"),
      finance,
    );
    expect(guardianAccount.invoices).toHaveLength(1);
    expect(adultAccount.invoices).toHaveLength(1);
    expect(adultAccount.invoices[0]?.invoice.familyId).toBe(adultFamilyA);
  });

  it("denies coach and cross-tenant access without revealing documents", async () => {
    const finance = services();
    await expect(
      listFinancialAccountHandler(request(null, coachA, academyA, "coach"), finance),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      getInvoiceHandler(
        request({ invoiceId: `${runId}-missing` }, ownerB, academyB, "owner"),
        finance,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("writes only invoices, payments, and redacted audit events", async () => {
    const [invoices, payments, audits, debts, balances, providerEvents] = await Promise.all([
      firestore.collection(`academies/${academyA}/invoices`).get(),
      firestore.collection(`academies/${academyA}/payments`).get(),
      firestore.collection(`academies/${academyA}/auditEvents`).get(),
      firestore.collection(`academies/${academyA}/debts`).get(),
      firestore.collection(`academies/${academyA}/balances`).get(),
      firestore.collection(`academies/${academyA}/paymentEvents`).get(),
    ]);
    expect(invoices.docs.length).toBeGreaterThan(0);
    expect(payments.docs.length).toBeGreaterThan(0);
    expect(audits.docs.map((doc) => doc.data().action)).toEqual(
      expect.arrayContaining(["invoice.created", "payment.recorded"]),
    );
    expect(debts.docs).toHaveLength(0);
    expect(balances.docs).toHaveLength(0);
    expect(providerEvents.docs).toHaveLength(0);
    for (const document of audits.docs) {
      expect(document.data()).not.toHaveProperty("cardNumber");
      expect(document.data()).not.toHaveProperty("providerPayload");
    }
  });
});
