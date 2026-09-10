import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import { PLAN_CATALOG, planIds } from "@bpt-jersey/domain/memberships";

import { requireUserActor } from "../../apps/functions/src/auth/user-authorization.js";
import {
  activatePlanHandler,
  deactivatePlanHandler,
  getPlanHandler,
  listPlansHandler,
  savePlanHandler,
} from "../../apps/functions/src/memberships/plan-callables.js";
import {
  createPlanStore,
  type PlanFirestore,
} from "../../apps/functions/src/memberships/plan-service.js";

const runId = `plans-${process.pid}-${randomUUID()}`;
const academyA = `${runId}-academy-a`;
const academyB = `${runId}-academy-b`;
const ownerA = `${runId}-owner-a`;
const administratorA = `${runId}-administrator-a`;
const coachA = `${runId}-coach-a`;
const ownerB = `${runId}-owner-b`;
const now = "2026-08-19T10:00:00.000Z";
const later = "2026-08-19T11:00:00.000Z";

const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const auth = getAuth(app);
const firestore = getFirestore(app);
const store = createPlanStore({ firestore: firestore as unknown as PlanFirestore });

const users = [
  { userId: ownerA, academyId: academyA, role: "owner" },
  { userId: administratorA, academyId: academyA, role: "administrator" },
  { userId: coachA, academyId: academyA, role: "coach" },
  { userId: ownerB, academyId: academyB, role: "owner" },
] as const;

async function createAuthUser(
  userId: string,
  academyId: string,
  role: (typeof users)[number]["role"],
): Promise<void> {
  await auth.createUser({
    uid: userId,
    displayName: `Synthetic ${role}`,
    email: `${userId}@example.test`,
  });
  await auth.setCustomUserClaims(userId, { academyId, role });
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

async function deleteCollection(path: string): Promise<void> {
  const snapshot = await firestore.collection(path).get();
  await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
}

async function deletePlanDocuments(academyId: string): Promise<void> {
  await deleteCollection(`academies/${academyId}/plans`);
}

async function seedAcademyA(): Promise<void> {
  const actor = requireUserActor(await requestFor(ownerA, null));
  await store.seedPlanCatalog({ academyId: actor.academyId, actorId: actor.userId, now });
}

async function readPlanEnvelopes(
  academyId: string,
): Promise<Map<string, Readonly<{ createdAt: unknown; createdBy: unknown }>>> {
  const snapshot = await firestore.collection(`academies/${academyId}/plans`).get();
  return new Map(
    snapshot.docs.map((document) => {
      const data = document.data();
      return [document.id, Object.freeze({ createdAt: data.createdAt, createdBy: data.createdBy })];
    }),
  );
}

beforeAll(async () => {
  for (const user of users) {
    await createAuthUser(user.userId, user.academyId, user.role);
  }
});

beforeEach(async () => {
  await Promise.all([deletePlanDocuments(academyA), deletePlanDocuments(academyB)]);
});

afterAll(async () => {
  await Promise.all([deletePlanDocuments(academyA), deletePlanDocuments(academyB)]);
  await Promise.allSettled(users.map((user) => auth.deleteUser(user.userId)));
  await deleteApp(app);
});

describe("membership plan adapters against Auth/Firestore emulators", () => {
  it("seeds ten plans idempotently and preserves every envelope through reseed and correction", async () => {
    const ownerRequest = await requestFor(ownerA, null);
    const actor = requireUserActor(ownerRequest);

    const first = await store.seedPlanCatalog({
      academyId: actor.academyId,
      actorId: actor.userId,
      now,
    });
    const firstSnapshot = await firestore.collection(`academies/${academyA}/plans`).get();
    const firstEnvelopes = await readPlanEnvelopes(academyA);

    const second = await store.seedPlanCatalog({
      academyId: actor.academyId,
      actorId: actor.userId,
      now: later,
    });
    const secondSnapshot = await firestore.collection(`academies/${academyA}/plans`).get();
    const secondEnvelopes = await readPlanEnvelopes(academyA);

    expect(first).toHaveLength(10);
    expect(second).toHaveLength(10);
    expect(first.map((plan) => plan.planId)).toEqual([...planIds]);
    expect(firstSnapshot.size).toBe(10);
    expect(secondSnapshot.size).toBe(10);
    for (const planId of planIds) {
      expect(secondEnvelopes.get(planId)).toEqual(firstEnvelopes.get(planId));
    }

    const corrected = await savePlanHandler(
      await requestFor(administratorA, {
        ...PLAN_CATALOG[0]!,
        displayName: "Pay as you go corrected",
      }),
      { store, now: () => later },
    );
    const correctedEnvelopes = await readPlanEnvelopes(academyA);
    expect(corrected.displayName).toBe("Pay as you go corrected");
    for (const planId of planIds) {
      expect(correctedEnvelopes.get(planId)).toEqual(firstEnvelopes.get(planId));
    }
  });

  it("uses Auth tenant context for public catalog order and administrative lifecycle", async () => {
    await seedAcademyA();
    const coachRequest = await requestFor(coachA, null);
    const initialList = await listPlansHandler(coachRequest, { store });
    expect(initialList.map((plan) => plan.planId)).toEqual([...planIds]);
    expect(initialList[0]).not.toHaveProperty("createdAt");

    const beforeCorrection = (await firestore.doc(`academies/${academyA}/plans/payg`).get()).data();
    const correctedDraft = { ...PLAN_CATALOG[0]!, displayName: "Pay as you go corrected" };
    const corrected = await savePlanHandler(await requestFor(administratorA, correctedDraft), {
      store,
      now: () => later,
    });
    const afterCorrection = (await firestore.doc(`academies/${academyA}/plans/payg`).get()).data();
    expect(corrected.displayName).toBe("Pay as you go corrected");
    expect(afterCorrection).toEqual(
      expect.objectContaining({
        createdAt: beforeCorrection?.createdAt,
        createdBy: beforeCorrection?.createdBy,
        updatedBy: administratorA,
      }),
    );

    const deactivated = await deactivatePlanHandler(await requestFor(ownerA, { planId: "payg" }), {
      store,
      now: () => later,
    });
    expect(deactivated.active).toBe(false);
    expect((await firestore.doc(`academies/${academyA}/plans/payg`).get()).exists).toBe(true);
    expect(
      (await listPlansHandler(coachRequest, { store })).map((plan) => plan.planId),
    ).not.toContain("payg");
    await expect(
      getPlanHandler(await requestFor(coachA, { planId: "payg" }), { store }),
    ).rejects.toMatchObject({ code: "failed-precondition" });

    const activated = await activatePlanHandler(
      await requestFor(administratorA, { planId: "payg" }),
      { store, now: () => later },
    );
    expect(activated).toMatchObject({ active: true, displayName: "Pay as you go corrected" });
    const restored = await getPlanHandler(await requestFor(coachA, { planId: "payg" }), { store });
    expect(restored.displayName).toBe("Pay as you go corrected");
    expect((await firestore.doc(`academies/${academyA}/plans/payg`).get()).data()).toEqual(
      expect.objectContaining({
        createdAt: beforeCorrection?.createdAt,
        createdBy: beforeCorrection?.createdBy,
      }),
    );
  });

  it("isolates the same plan ID between academies and rejects non-admin mutations", async () => {
    await seedAcademyA();
    const academyBPayg = { ...PLAN_CATALOG[0]!, displayName: "Academy B Pay as you go" };
    const ownerBActor = requireUserActor(await requestFor(ownerB, null));
    await store.savePlan({
      academyId: ownerBActor.academyId,
      actorId: ownerBActor.userId,
      now,
      draft: academyBPayg,
    });

    const academyBPlan = await getPlanHandler(await requestFor(ownerB, { planId: "payg" }), {
      store,
    });
    expect(academyBPlan.displayName).toBe("Academy B Pay as you go");
    expect(
      (await listPlansHandler(await requestFor(ownerB, null), { store })).map(
        (plan) => plan.planId,
      ),
    ).toEqual(["payg"]);

    const before = (await firestore.doc(`academies/${academyA}/plans/payg`).get()).data();
    const coachRequest = await requestFor(coachA, null);
    await expect(savePlanHandler(coachRequest, { store, now: () => later })).rejects.toMatchObject({
      code: "permission-denied",
    });
    await expect(
      deactivatePlanHandler(await requestFor(coachA, { planId: "payg" }), { store }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      activatePlanHandler(await requestFor(coachA, { planId: "payg" }), { store }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect((await firestore.doc(`academies/${academyA}/plans/payg`).get()).data()).toEqual(before);
  });

  it("does not create memberships, invoices, payments, or debt documents", async () => {
    await seedAcademyA();
    for (const academyId of [academyA, academyB]) {
      for (const collection of ["memberships", "invoices", "payments", "debts", "paygDebts"]) {
        await expect(
          firestore.collection(`academies/${academyId}/${collection}`).get(),
        ).resolves.toMatchObject({
          empty: true,
        });
      }
    }
  });
});
