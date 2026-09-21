import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import type { UserActorContext } from "@bpt-jersey/domain";
import type { Firestore } from "firebase-admin/firestore";

const manual = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("./manual-subscription-service.js", () => ({
  saveManualSubscriptionInTransaction: manual.save,
}));
import { reviewIntroApplication } from "./intro-application-admin-service";

type Value = Record<string, unknown>;
function fakeFirestore(initial: Record<string, Value>) {
  const records = new Map(Object.entries(initial));
  let activeTransaction: unknown;
  const db = {
    doc: (path: string) => ({ id: path.slice(path.lastIndexOf("/") + 1), path }),
    async runTransaction<T>(callback: (transaction: never) => Promise<T>) {
      const writes: Array<{ kind: "create" | "set" | "update"; path: string; value: Value }> = [];
      const transaction = {
        async get(reference: { path: string }) {
          const value = records.get(reference.path);
          return { exists: value !== undefined, data: () => value };
        },
        create: (reference: { path: string }, value: Value) =>
          writes.push({ kind: "create", path: reference.path, value }),
        set: (reference: { path: string }, value: Value) =>
          writes.push({ kind: "set", path: reference.path, value }),
        update: (reference: { path: string }, value: Value) =>
          writes.push({ kind: "update", path: reference.path, value }),
      };
      activeTransaction = transaction;
      const result = await callback(transaction as never);
      for (const write of writes) {
        if (write.kind === "create" && records.has(write.path)) throw new Error("exists");
        records.set(
          write.path,
          write.kind === "update" ? { ...records.get(write.path), ...write.value } : write.value,
        );
      }
      return result;
    },
  };
  return { db: db as unknown as Firestore, records, transaction: () => activeTransaction };
}

const academyId = "academy-1";
const now = "2026-09-21T12:00:00.000Z";
const actor = { academyId, userId: "admin-1", role: "administrator" } as UserActorContext;
const applicationPath = `academies/${academyId}/membershipApplications/application-1`;
const conversionPath = `academies/${academyId}/introConversions/intro-student-1`;
const planPath = `academies/${academyId}/plans/bpt-jersey-adult`;
const membershipPath = `academies/${academyId}/memberships/manual-request-1`;
function seed() {
  const plan = PLAN_CATALOG.find((item) => item.planId === "bpt-jersey-adult")!;
  return {
    [applicationPath]: {
      applicationId: "application-1",
      requestId: "00000000-0000-4000-8000-000000000001",
      academyId,
      applicantUid: "user-1",
      studentId: "student-1",
      conversionId: "intro-student-1",
      site: "Town",
      planId: plan.planId,
      planName: plan.displayName,
      priceMinor: plan.priceMinor,
      currency: "GBP",
      billingPeriod: plan.billingPeriod,
      planUpdatedAt: now,
      proofId: "a".repeat(64),
      bankReference: "INTRO-1",
      status: "pending_review",
      revision: 0,
      decisionReason: null,
      approvedMembershipId: null,
      createdAt: now,
      updatedAt: now,
      schemaVersion: "1",
    },
    [conversionPath]: {
      conversionId: "intro-student-1",
      academyId,
      studentId: "student-1",
      attendanceId: "attendance-1",
      sessionId: "session-1",
      recipientUid: "user-1",
      status: "application_pending",
      createdAt: now,
      updatedAt: now,
      schemaVersion: "1",
    },
    [planPath]: {
      ...plan,
      academyId,
      active: true,
      schemaVersion: "1",
      createdAt: now,
      createdBy: "admin-1",
      updatedAt: now,
      updatedBy: "admin-1",
    },
  };
}
const decision = {
  applicationId: "application-1",
  expectedRevision: 0,
  decision: "approve" as const,
  occurredAt: "2026-09-21T11:00:00.000Z",
};

describe("reviewIntroApplication", () => {
  beforeEach(() => vi.clearAllMocks());
  it("commits the subscription and decision through the same transaction", async () => {
    const store = fakeFirestore(seed());
    manual.save.mockImplementation(async (_db, transaction) => {
      transaction.set({ path: membershipPath }, { membershipId: "manual-request-1" });
      return {
        membershipId: "manual-request-1",
        studentId: "student-1",
        planId: "bpt-jersey-adult",
        status: "active",
        startsAt: decision.occurredAt,
        endsAt: null,
        updatedAt: now,
      };
    });
    await expect(reviewIntroApplication(store.db, actor, decision)).resolves.toMatchObject({
      status: "approved",
      membershipId: "manual-request-1",
    });
    expect(manual.save.mock.calls[0]?.[1]).toBe(store.transaction());
    expect(store.records.get(applicationPath)).toMatchObject({
      status: "approved",
      approvedMembershipId: "manual-request-1",
    });
    expect(store.records.get(conversionPath)).toMatchObject({ status: "converted" });
    expect(store.records.has(membershipPath)).toBe(true);
  });
  it("rolls back subscription writes when approval fails", async () => {
    const store = fakeFirestore(seed());
    manual.save.mockImplementation(async (_db, transaction) => {
      transaction.set({ path: membershipPath }, { membershipId: "manual-request-1" });
      throw new Error("synthetic settlement failure");
    });
    await expect(reviewIntroApplication(store.db, actor, decision)).rejects.toThrow(
      "synthetic settlement failure",
    );
    expect(store.records.has(membershipPath)).toBe(false);
    expect(store.records.get(applicationPath)).toMatchObject({
      status: "pending_review",
      revision: 0,
    });
    expect(store.records.get(conversionPath)).toMatchObject({ status: "application_pending" });
  });
});
