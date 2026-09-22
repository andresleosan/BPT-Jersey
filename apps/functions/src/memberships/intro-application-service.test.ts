import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import type { UserActorContext } from "@bpt-jersey/domain";
import type { R2Client } from "../storage/r2-client.js";

// The real member-access authorisation walks students/relationships/guardian-state docs; this
// service's own branching (plan lookup, proof requirement) is what these tests cover, so the
// access check is stubbed to always allow, matching the pattern used for
// `saveManualSubscriptionInTransaction` in intro-application-admin-service.test.ts.
vi.mock("../members/member-access-service.js", () => ({
  createMemberAccessService: () => ({ authorise: async () => ({ allowed: true, via: "self" }) }),
  memberAccessDependenciesInTransaction: () => ({}),
}));

import { submitIntroMembershipApplication } from "./intro-application-service";

type Doc = Record<string, unknown>;

/** Tracks the relative order of the proof read and the transaction opening. */
function fakeFirestore(initial: Record<string, Doc>, order: string[]) {
  const records = new Map(Object.entries(initial));
  const db = {
    doc(path: string) {
      const id = path.slice(path.lastIndexOf("/") + 1);
      return {
        id,
        path,
        async get() {
          const value = records.get(path);
          return { id, exists: value !== undefined, data: () => value };
        },
      };
    },
    async runTransaction<T>(callback: (transaction: never) => Promise<T>): Promise<T> {
      order.push("transaction-start");
      const writes: Array<{ kind: "create" | "update"; path: string; value: Doc }> = [];
      const transaction = {
        async get(reference: { path: string }) {
          const value = records.get(reference.path);
          return { exists: value !== undefined, data: () => value };
        },
        create: (reference: { path: string }, value: Doc) => {
          if (records.has(reference.path)) throw new Error("exists");
          writes.push({ kind: "create", path: reference.path, value });
        },
        update: (reference: { path: string }, value: Doc) =>
          writes.push({ kind: "update", path: reference.path, value }),
      };
      const result = await callback(transaction as never);
      for (const write of writes) {
        records.set(
          write.path,
          write.kind === "update" ? { ...records.get(write.path), ...write.value } : write.value,
        );
      }
      return result;
    },
  };
  return { db: db as unknown as Firestore, records };
}

const pngBytes = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from("synthetic-proof"),
]);
const proofId = createHash("sha256").update(pngBytes).digest("hex");

function fakeStorage(order: string[]): R2Client {
  return {
    putObject: vi.fn(),
    readObject: vi.fn(async () => {
      order.push("proof-read");
      return pngBytes;
    }),
    deleteObject: vi.fn(),
    createPdfUploadUrl: vi.fn(),
    createPdfDownloadUrl: vi.fn(),
  } as unknown as R2Client;
}

const academyId = "academy-1";
const now = "2026-09-21T12:00:00.000Z";
const actor = { academyId, userId: "user-1", role: "member" } as UserActorContext;
const studentPath = `academies/${academyId}/students/student-1`;
const conversionPath = `academies/${academyId}/introConversions/conversion-1`;
const instructionsPath = `academies/${academyId}/settings/paymentInstructions`;

function planPath(planId: string) {
  return `academies/${academyId}/plans/${planId}`;
}

function planDoc(planId: string) {
  const plan = PLAN_CATALOG.find((item) => item.planId === planId)!;
  return {
    ...plan,
    academyId,
    active: true,
    schemaVersion: "1",
    createdAt: now,
    createdBy: "admin-1",
    updatedAt: now,
    updatedBy: "admin-1",
  };
}

function baseSeed(planId: string) {
  return {
    [studentPath]: {
      studentId: "student-1",
      academyId,
      userId: "user-1",
      fullName: "Synthetic Adult",
      dateOfBirth: "1990-01-01",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      participantType: "adult",
      active: true,
      status: "active",
      schemaVersion: "1",
      createdAt: now,
      createdBy: "seed",
      updatedAt: now,
      updatedBy: "seed",
    },
    [conversionPath]: {
      conversionId: "conversion-1",
      academyId,
      studentId: "student-1",
      attendanceId: "attendance-1",
      sessionId: "session-1",
      recipientUid: "user-1",
      status: "ready",
      createdAt: now,
      updatedAt: now,
      schemaVersion: "1",
    },
    [planPath(planId)]: planDoc(planId),
    [instructionsPath]: {
      academyId,
      accountName: "BPT Jersey",
      sortCode: "123456",
      accountNumber: "12345678",
      bankName: "HSBC",
      referenceHint: "your invoice reference",
      acceptsCash: true,
      schemaVersion: 1,
      updatedAt: now,
      updatedBy: "admin-1",
    },
  };
}

function submitInput(overrides: Doc = {}) {
  return {
    requestId: "00000000-0000-4000-8000-000000000001",
    conversionId: "conversion-1",
    studentId: "student-1",
    site: "Town",
    planId: "bpt-jersey-adult",
    proofId: null,
    bankReference: null,
    ...overrides,
  };
}

describe("submitIntroMembershipApplication", () => {
  it("accepts a pay-as-you-go submission with no payment evidence", async () => {
    const order: string[] = [];
    const { db } = fakeFirestore(baseSeed("payg"), order);
    const application = await submitIntroMembershipApplication(
      db,
      actor,
      submitInput({ site: "West", planId: "payg", proofId: null, bankReference: null }),
      fakeStorage(order),
    );
    expect(application).toMatchObject({
      billingPeriod: "per-session",
      proofId: null,
      bankReference: null,
      status: "pending_review",
    });
    // No R2 read at all: pay-as-you-go needs no proof, so the network call never happens.
    expect(order).toEqual(["transaction-start"]);
  });

  it("rejects a pay-as-you-go submission that includes a proof", async () => {
    const order: string[] = [];
    const { db } = fakeFirestore(baseSeed("payg"), order);
    await expect(
      submitIntroMembershipApplication(
        db,
        actor,
        submitInput({ site: "West", planId: "payg", proofId, bankReference: null }),
        fakeStorage(order),
      ),
    ).rejects.toThrow(/do not need payment evidence/);
  });

  it("rejects a pay-as-you-go submission that includes a bank reference", async () => {
    const order: string[] = [];
    const { db } = fakeFirestore(baseSeed("payg"), order);
    await expect(
      submitIntroMembershipApplication(
        db,
        actor,
        submitInput({ site: "West", planId: "payg", proofId: null, bankReference: "BPT-1" }),
        fakeStorage(order),
      ),
    ).rejects.toThrow(/do not need payment evidence/);
  });

  it("rejects a monthly/term submission missing the proof", async () => {
    const order: string[] = [];
    const { db } = fakeFirestore(baseSeed("bpt-jersey-adult"), order);
    await expect(
      submitIntroMembershipApplication(
        db,
        actor,
        submitInput({ proofId: null, bankReference: "BPT-1234" }),
        fakeStorage(order),
      ),
    ).rejects.toThrow(/Payment evidence is required/);
    expect(order).toEqual([]);
  });

  it("rejects a monthly/term submission missing the bank reference", async () => {
    const order: string[] = [];
    const { db } = fakeFirestore(baseSeed("bpt-jersey-adult"), order);
    await expect(
      submitIntroMembershipApplication(
        db,
        actor,
        submitInput({ proofId, bankReference: null }),
        fakeStorage(order),
      ),
    ).rejects.toThrow(/Payment evidence is required/);
    expect(order).toEqual([]);
  });

  it("verifies the proof in R2 before opening the transaction for a monthly submission", async () => {
    const order: string[] = [];
    const { db } = fakeFirestore(baseSeed("bpt-jersey-adult"), order);
    const application = await submitIntroMembershipApplication(
      db,
      actor,
      submitInput({ proofId, bankReference: "BPT-1234" }),
      fakeStorage(order),
    );
    expect(application).toMatchObject({
      billingPeriod: "monthly",
      proofId,
      bankReference: "BPT-1234",
      status: "pending_review",
    });
    // The R2 read happens exactly once, strictly before the Firestore transaction opens — so a
    // transaction retry on contention never repeats the network call.
    expect(order).toEqual(["proof-read", "transaction-start"]);
  });
});
