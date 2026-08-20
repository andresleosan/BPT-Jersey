import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import { parseStudentProfile } from "@bpt-jersey/domain/profiles";

import {
  createMembershipHandler,
  getMembershipHandler,
  transitionMembershipHandler,
  type MembershipCallableServices,
} from "../../apps/functions/src/memberships/membership-callables.js";
import {
  createMembershipStore,
  type MembershipFirestore,
} from "../../apps/functions/src/memberships/membership-service.js";
import {
  createFamilyStore,
  type FamilyFirestore,
} from "../../apps/functions/src/families/family-service.js";
import {
  createPlanStore,
  type PlanFirestore,
} from "../../apps/functions/src/memberships/plan-service.js";

const runId = `memberships-${process.pid}-${randomUUID().slice(0, 8)}`;
const academyA = `${runId}-academy-a`;
const academyB = `${runId}-academy-b`;
const ownerA = `${runId}-owner-a`;
const administratorA = `${runId}-administrator-a`;
const guardianA = `${runId}-guardian-a`;
const adultStudentA = `${runId}-adult-a`;
const ownerB = `${runId}-owner-b`;
const familyA = `${runId}-family-a`;
const adultFamilyA = `${runId}-adult-family-a`;
const minorStudentA = `${runId}-minor-a`;
const adultStudentRecordA = `${runId}-adult-student-a`;
const now = "2026-08-19T10:00:00.000Z";

const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const auth = getAuth(app);
const firestore = getFirestore(app);
const planStore = createPlanStore({ firestore: firestore as unknown as PlanFirestore });

const userSeeds = [
  { userId: ownerA, academyId: academyA, role: "owner" },
  { userId: administratorA, academyId: academyA, role: "administrator" },
  { userId: guardianA, academyId: academyA, role: "guardian" },
  { userId: adultStudentA, academyId: academyA, role: "adultStudent" },
  { userId: ownerB, academyId: academyB, role: "owner" },
] as const;

const academyCollections = [
  "users",
  "families",
  "students",
  "relationships",
  "plans",
  "memberships",
  "auditEvents",
  "payments",
  "invoices",
  "receipts",
  "balances",
  "debts",
  "paygDebts",
] as const;

function userProfile(userId: string, academyId: string) {
  return {
    userId,
    academyId,
    accountType: "client" as const,
    displayName: `Synthetic ${userId}`,
    email: `${userId}@example.test`,
    phoneNumber: "+441234567890",
    active: true,
    status: "active" as const,
    schemaVersion: "1" as const,
    createdAt: now,
    createdBy: ownerA,
    updatedAt: now,
    updatedBy: ownerA,
  };
}

function familyRecord(familyId: string, primaryContactUserId: string, academyId = academyA) {
  return {
    familyId,
    academyId,
    primaryContactUserId,
    billingContactUserId: primaryContactUserId,
    active: true,
    status: "active" as const,
    schemaVersion: "1" as const,
    createdAt: now,
    createdBy: ownerA,
    updatedAt: now,
    updatedBy: ownerA,
  };
}

function studentRecord(
  studentId: string,
  familyId: string,
  participantType: "adult" | "minor",
  userId?: string,
) {
  return {
    studentId,
    academyId: academyA,
    familyId,
    ...(userId === undefined ? {} : { userId }),
    fullName: `Synthetic ${participantType} ${studentId}`,
    dateOfBirth: participantType === "minor" ? "2012-01-01" : "1990-01-01",
    trainingCenter: "Town" as const,
    trainingTimePreferences: ["evening"] as const,
    participantType,
    active: true,
    status: "active" as const,
    schemaVersion: "1" as const,
    createdAt: now,
    createdBy: ownerA,
    updatedAt: now,
    updatedBy: ownerA,
  };
}

function relationshipRecord(
  relationshipId: string,
  familyId: string,
  studentId: string,
  adultUserId: string,
) {
  return {
    relationshipId,
    academyId: academyA,
    familyId,
    studentId,
    adultUserId,
    relationshipType: "guardian" as const,
    permissions: ["readProfile"] as const,
    validFrom: now,
    active: true,
    status: "active" as const,
    schemaVersion: "1" as const,
    createdAt: now,
    createdBy: ownerA,
    updatedAt: now,
    updatedBy: ownerA,
  };
}

async function createAuthUsers(): Promise<void> {
  await Promise.all(
    userSeeds.map(async ({ userId, academyId, role }) => {
      await auth.createUser({ uid: userId, email: `${userId}@example.test` });
      await auth.setCustomUserClaims(userId, { academyId, role });
    }),
  );
}

async function deleteCollection(path: string): Promise<void> {
  const snapshot = await firestore.collection(path).get();
  await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
}

async function clearRunData(): Promise<void> {
  await Promise.all(
    [academyA, academyB].flatMap((academyId) =>
      academyCollections.map((collection) =>
        deleteCollection(`academies/${academyId}/${collection}`),
      ),
    ),
  );
}

async function seedBaseData(): Promise<void> {
  await Promise.all([
    firestore.doc(`academies/${academyA}/users/${guardianA}`).set(userProfile(guardianA, academyA)),
    firestore
      .doc(`academies/${academyA}/users/${adultStudentA}`)
      .set(userProfile(adultStudentA, academyA)),
    firestore
      .doc(`academies/${academyA}/families/${familyA}`)
      .set(familyRecord(familyA, guardianA)),
    firestore
      .doc(`academies/${academyA}/families/${adultFamilyA}`)
      .set(familyRecord(adultFamilyA, adultStudentA)),
    firestore
      .doc(`academies/${academyA}/students/${minorStudentA}`)
      .set(studentRecord(minorStudentA, familyA, "minor")),
    firestore
      .doc(`academies/${academyA}/students/${adultStudentRecordA}`)
      .set(studentRecord(adultStudentRecordA, adultFamilyA, "adult", adultStudentA)),
    firestore
      .doc(`academies/${academyA}/relationships/${familyA}--${minorStudentA}`)
      .set(relationshipRecord(`${familyA}--${minorStudentA}`, familyA, minorStudentA, guardianA)),
    firestore
      .doc(`academies/${academyA}/relationships/${adultFamilyA}--${adultStudentRecordA}`)
      .set(
        relationshipRecord(
          `${adultFamilyA}--${adultStudentRecordA}`,
          adultFamilyA,
          adultStudentRecordA,
          adultStudentA,
        ),
      ),
  ]);

  await Promise.all(
    [
      [academyA, ownerA],
      [academyB, ownerB],
    ].map(([academyId, actorId]) => planStore.seedPlanCatalog({ academyId, actorId, now })),
  );
}

async function requestFor(userId: string, data: unknown): Promise<CallableRequest<unknown>> {
  const user = await auth.getUser(userId);
  const academyId = user.customClaims?.academyId;
  const role = user.customClaims?.role;
  if (typeof academyId !== "string" || typeof role !== "string") {
    throw new Error("Synthetic Auth claims were not provisioned");
  }
  return {
    data,
    auth: { uid: user.uid, token: { academyId, role } },
  } as unknown as CallableRequest<unknown>;
}

function services(): MembershipCallableServices {
  const store = createMembershipStore({
    firestore: firestore as unknown as MembershipFirestore,
  });
  const familyStore = createFamilyStore({
    auth: { getUser: async (userId) => ({ uid: (await auth.getUser(userId)).uid }) },
    firestore: firestore as unknown as FamilyFirestore,
  });
  return {
    store,
    familyStore,
    findStudentByUserId: async (academyId, userId) => {
      const snapshot = await firestore
        .collection(`academies/${academyId}/students`)
        .where("userId", "==", userId)
        .limit(2)
        .get();
      if (snapshot.docs.length !== 1) return undefined;
      const document = snapshot.docs[0];
      if (document === undefined) return undefined;
      const parsed = parseStudentProfile(document.data());
      if (!parsed.ok || document.id !== parsed.value.studentId) return undefined;
      const student = parsed.value;
      if (student.familyId === undefined) return undefined;
      return {
        studentId: student.studentId,
        familyId: student.familyId,
        participantType: student.participantType,
        active: student.active,
        status: student.status,
      };
    },
    isActorActive: async (actor) => !(await auth.getUser(actor.userId)).disabled,
    now: () => now,
  };
}

async function createMembership(
  actorId: string,
  familyId: string,
  studentId: string,
  status: "trial" | "active",
) {
  return createMembershipHandler(
    await requestFor(actorId, {
      familyId,
      studentId,
      planId: "bpt-jersey-adult",
      status,
    }),
    services(),
  );
}

async function transition(actorId: string, membershipId: string, targetStatus: string) {
  return transitionMembershipHandler(
    await requestFor(actorId, { membershipId, targetStatus }),
    services(),
  );
}

async function auditDocuments(academyId = academyA) {
  return (await firestore.collection(`academies/${academyId}/auditEvents`).get()).docs;
}

beforeAll(createAuthUsers);
beforeEach(async () => {
  await clearRunData();
  await seedBaseData();
});
afterEach(clearRunData);
afterAll(async () => {
  await clearRunData();
  await Promise.allSettled(userSeeds.map(({ userId }) => auth.deleteUser(userId)));
  await deleteApp(app);
});

describe("membership adapters against Auth/Firestore emulators", () => {
  it("creates guardian trial, adult self-only trial, and owner/admin active memberships", async () => {
    const guardianTrial = await createMembership(guardianA, familyA, minorStudentA, "trial");
    expect(guardianTrial).toMatchObject({
      familyId: familyA,
      studentId: minorStudentA,
      status: "trial",
    });

    await expect(
      createMembership(adultStudentA, adultFamilyA, minorStudentA, "trial"),
    ).rejects.toMatchObject({ code: "permission-denied" });
    const adultTrial = await createMembership(
      adultStudentA,
      adultFamilyA,
      adultStudentRecordA,
      "trial",
    );
    expect(adultTrial).toMatchObject({
      familyId: adultFamilyA,
      studentId: adultStudentRecordA,
      status: "trial",
    });

    await transition(administratorA, guardianTrial.membershipId, "cancelled");
    const ownerActive = await createMembership(ownerA, familyA, minorStudentA, "active");
    expect(ownerActive.status).toBe("active");
    await transition(ownerA, ownerActive.membershipId, "cancelled");

    const administratorActive = await createMembership(
      administratorA,
      familyA,
      minorStudentA,
      "active",
    );
    expect(administratorActive.status).toBe("active");
  });

  it("covers every valid lifecycle edge and same-state idempotency", async () => {
    const first = await createMembership(ownerA, familyA, minorStudentA, "trial");
    const initialAudits = await auditDocuments();
    await expect(transition(ownerA, first.membershipId, "trial")).resolves.toMatchObject({
      status: "trial",
    });
    expect(await auditDocuments()).toHaveLength(initialAudits.length);

    await transition(administratorA, first.membershipId, "active");
    await expect(transition(administratorA, first.membershipId, "active")).resolves.toMatchObject({
      status: "active",
    });
    await transition(administratorA, first.membershipId, "paused");
    await expect(transition(administratorA, first.membershipId, "paused")).resolves.toMatchObject({
      status: "paused",
    });
    await transition(administratorA, first.membershipId, "active");
    await transition(administratorA, first.membershipId, "overdue");
    await expect(transition(administratorA, first.membershipId, "overdue")).resolves.toMatchObject({
      status: "overdue",
    });
    await transition(administratorA, first.membershipId, "active");
    await transition(administratorA, first.membershipId, "cancelled");
    await expect(
      transition(administratorA, first.membershipId, "cancelled"),
    ).resolves.toMatchObject({ status: "cancelled" });

    const second = await createMembership(ownerA, familyA, minorStudentA, "trial");
    await transition(administratorA, second.membershipId, "cancelled");
    const third = await createMembership(ownerA, familyA, minorStudentA, "active");
    await transition(administratorA, third.membershipId, "paused");
    await expect(transition(administratorA, third.membershipId, "paused")).resolves.toMatchObject({
      status: "paused",
    });
    await transition(administratorA, third.membershipId, "cancelled");

    const records = await firestore.collection(`academies/${academyA}/memberships`).get();
    expect(records.docs.map((document) => document.data().status).sort()).toEqual([
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
  });

  it("rejects invalid transitions without changing membership or audit state", async () => {
    const created = await createMembership(ownerA, familyA, minorStudentA, "active");
    const beforeMembership = await firestore
      .doc(`academies/${academyA}/memberships/${created.membershipId}`)
      .get();
    const beforeAudits = await auditDocuments();

    await expect(transition(administratorA, created.membershipId, "trial")).rejects.toMatchObject({
      code: "failed-precondition",
      message: "Membership operation is not available",
    });

    const afterMembership = await firestore
      .doc(`academies/${academyA}/memberships/${created.membershipId}`)
      .get();
    expect(afterMembership.data()).toEqual(beforeMembership.data());
    expect(await auditDocuments()).toHaveLength(beforeAudits.length);
  });

  it("makes cancellation terminal, requires a new ID, and detects current duplicates after history", async () => {
    const first = await createMembership(ownerA, familyA, minorStudentA, "active");
    const cancelled = await transition(administratorA, first.membershipId, "cancelled");
    expect(cancelled.endsAt).toBe(now);
    await expect(transition(administratorA, first.membershipId, "active")).rejects.toMatchObject({
      code: "failed-precondition",
    });

    const second = await createMembership(ownerA, familyA, minorStudentA, "active");
    expect(second.membershipId).not.toBe(first.membershipId);
    await transition(administratorA, second.membershipId, "cancelled");
    for (let index = 0; index < 101; index += 1) {
      await firestore.doc(`academies/${academyA}/memberships/history-${index}`).set({
        ...((
          await firestore.doc(`academies/${academyA}/memberships/${first.membershipId}`).get()
        ).data() as Record<string, unknown>),
        membershipId: `history-${index}`,
        status: "cancelled",
        endsAt: now,
      });
    }
    const current = await createMembership(ownerA, familyA, minorStudentA, "active");
    await expect(createMembership(ownerA, familyA, minorStudentA, "trial")).rejects.toMatchObject({
      code: "failed-precondition",
    });
    expect(current.membershipId).toBeTruthy();
  });

  it("denies cross-tenant, cross-family, and cross-student access", async () => {
    const membership = await createMembership(ownerA, familyA, minorStudentA, "active");
    await expect(
      getMembershipHandler(
        await requestFor(guardianA, { membershipId: membership.membershipId }),
        services(),
      ),
    ).resolves.toMatchObject({ membershipId: membership.membershipId });

    await expect(
      createMembership(adultStudentA, adultFamilyA, minorStudentA, "trial"),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      getMembershipHandler(
        await requestFor(ownerB, { membershipId: membership.membershipId }),
        services(),
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });

    await firestore.doc(`academies/${academyA}/memberships/other-family-membership`).set({
      ...((
        await firestore.doc(`academies/${academyA}/memberships/${membership.membershipId}`).get()
      ).data() as Record<string, unknown>),
      membershipId: "other-family-membership",
      familyId: adultFamilyA,
      studentId: adultStudentRecordA,
    });
    await expect(
      getMembershipHandler(
        await requestFor(guardianA, { membershipId: "other-family-membership" }),
        services(),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("writes exact safe audit fields and no financial documents", async () => {
    const created = await createMembership(ownerA, familyA, minorStudentA, "active");
    await transition(administratorA, created.membershipId, "paused");
    const audits = await auditDocuments();
    expect(audits).toHaveLength(2);

    for (const document of audits) {
      const data = document.data();
      expect(Object.keys(data).sort()).toEqual(
        [
          "academyId",
          "actorId",
          "action",
          "targetRef",
          "purpose",
          "correlationId",
          "auditEventId",
          "occurredAt",
          "result",
          "schemaVersion",
        ].sort(),
      );
      expect(data).toEqual(
        expect.objectContaining({
          academyId: academyA,
          targetRef: `academies/${academyA}/memberships/${created.membershipId}`,
          result: "completed",
          schemaVersion: 1,
          auditEventId: document.id,
        }),
      );
      expect(data.occurredAt).toBeTruthy();
      expect(data).not.toHaveProperty("priceMinor");
      expect(data).not.toHaveProperty("payment");
      expect(data).not.toHaveProperty("debt");
    }
    expect(audits.map((document) => document.data().action).sort()).toEqual([
      "membership.created",
      "membership.status.changed",
    ]);

    for (const collection of [
      "payments",
      "invoices",
      "receipts",
      "balances",
      "debts",
      "paygDebts",
    ]) {
      await expect(
        firestore.collection(`academies/${academyA}/${collection}`).get(),
      ).resolves.toMatchObject({
        empty: true,
      });
      await expect(
        firestore.collection(`academies/${academyB}/${collection}`).get(),
      ).resolves.toMatchObject({
        empty: true,
      });
    }
  });
});
