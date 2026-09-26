import { describe, expect, it } from "vitest";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";
import type { LegacyInvoiceRecord, LegacyManualPaymentRecord } from "@bpt-jersey/domain/finance";
import type { PrivateLessonPurchase } from "@bpt-jersey/domain/private-lessons";

import {
  listMyPrivateLessons,
  recordPrivateLessonPurchase,
  reviewPrivateLessonPurchase,
  submitPrivateLessonPurchase,
  type PrivateLessonActor,
  type PrivateLessonStore,
  type PrivateLessonStudent,
} from "./private-lesson-service";

const academyId = "academy-1";
const now = "2026-09-26T10:00:00.000Z";
const member: PrivateLessonActor = { academyId, userId: "member-uid", role: "adultStudent" };
const office: PrivateLessonActor = { academyId, userId: "office-uid", role: "administrator" };
const requestId = "8b0d6f5e-4c1a-4f7e-9a51-7c0f2b9d3e11";

function createStore(
  options: { students?: PrivateLessonStudent[]; links?: [string, string][] } = {},
) {
  const students = new Map((options.students ?? []).map((student) => [student.studentId, student]));
  const links = new Set((options.links ?? []).map(([uid, studentId]) => `${uid}:${studentId}`));
  const purchases = new Map<string, PrivateLessonPurchase>();
  const invoices: LegacyInvoiceRecord[] = [];
  const payments: LegacyManualPaymentRecord[] = [];
  const audits: AuditEventDraft[] = [];
  const proofs: string[] = [];
  let ids = 0;
  const canAccess = async (userId: string, studentId: string) =>
    links.has(`${userId}:${studentId}`);
  const store: PrivateLessonStore = {
    async runTransaction(update) {
      const staged: (() => void)[] = [];
      const result = await update({
        canAccessStudent: canAccess,
        readStudent: async (studentId) => students.get(studentId) ?? null,
        readPurchase: async (purchaseId) => purchases.get(purchaseId) ?? null,
        readStudentPurchases: async (studentId) =>
          [...purchases.values()].filter((purchase) => purchase.studentId === studentId),
        writePurchase: (purchase) =>
          staged.push(() => purchases.set(purchase.purchaseId, purchase)),
        writeInvoice: (invoice, payment) =>
          staged.push(() => {
            invoices.push(invoice);
            payments.push(payment);
          }),
        appendAudit: (draft) => staged.push(() => audits.push(draft)),
      });
      for (const write of staged) write();
      return result;
    },
    listByStatus: async (status) =>
      [...purchases.values()].filter((purchase) => purchase.status === status),
    listForStudent: async (studentId) =>
      [...purchases.values()].filter((purchase) => purchase.studentId === studentId),
    studentNames: async () => new Map(),
    canAccessStudent: canAccess,
    verifyProof: async (input) => {
      proofs.push(input.proofId);
    },
    newId: () => `generated-${++ids}`,
  };
  return { store, purchases, invoices, payments, audits, proofs };
}

function yearsBefore(iso: string, years: number, dayShift = 0): string {
  const date = new Date(iso);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() + dayShift);
  return date.toISOString().slice(0, 10);
}

const student = (over: Partial<PrivateLessonStudent> = {}): PrivateLessonStudent => ({
  studentId: "student-1",
  fullName: "Synthetic Adult",
  dateOfBirth: "1990-01-01",
  familyId: "family-1",
  active: true,
  ...over,
});

const submission = (over: Record<string, unknown> = {}) => ({
  requestId,
  studentId: "student-1",
  optionId: "single",
  proofId: "proof-1",
  bankReference: "BPT 123",
  ...over,
});

function approved(over: Partial<PrivateLessonPurchase>): PrivateLessonPurchase {
  return {
    purchaseId: "existing",
    studentId: "student-1",
    accountUid: "member-uid",
    optionId: "monthly",
    priceMinor: 20000,
    creditsGranted: 4,
    creditsRemaining: 4,
    status: "approved",
    source: "member",
    method: "bank_transfer",
    proofId: "proof-0",
    bankReference: "BPT 000",
    submittedAt: "2026-09-20T10:00:00.000Z",
    decidedAt: "2026-09-20T12:00:00.000Z",
    decidedBy: "office-uid",
    decisionReason: null,
    expiresAt: "2026-10-20T12:00:00.000Z",
    invoiceId: "invoice-0",
    schemaVersion: "1",
    ...over,
  };
}

describe("submitPrivateLessonPurchase", () => {
  it("accepts a member who turned 16 today, pricing from the catalogue", async () => {
    const fake = createStore({
      students: [student({ dateOfBirth: yearsBefore(now, 16) })],
      links: [["member-uid", "student-1"]],
    });
    const purchase = await submitPrivateLessonPurchase(fake.store, member, submission(), now);
    expect(purchase).toMatchObject({
      status: "pending",
      priceMinor: 6500,
      creditsGranted: 1,
      creditsRemaining: 0,
      source: "member",
      accountUid: "member-uid",
      expiresAt: null,
      invoiceId: null,
    });
    expect(fake.proofs).toEqual(["proof-1"]);
    expect(fake.purchases.get(purchase.purchaseId)).toEqual(purchase);
  });

  it("refuses a member aged 15", async () => {
    const fake = createStore({
      students: [student({ dateOfBirth: yearsBefore(now, 16, 1) })],
      links: [["member-uid", "student-1"]],
    });
    await expect(
      submitPrivateLessonPurchase(fake.store, member, submission(), now),
    ).rejects.toThrow("Private lessons are for members aged 16 or over.");
    expect(fake.purchases.size).toBe(0);
  });

  it("refuses an account that is not linked to the member", async () => {
    const fake = createStore({ students: [student()], links: [["someone-else", "student-1"]] });
    await expect(
      submitPrivateLessonPurchase(fake.store, member, submission(), now),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(fake.purchases.size).toBe(0);
  });

  it("replays the same request instead of creating a second purchase", async () => {
    const fake = createStore({ students: [student()], links: [["member-uid", "student-1"]] });
    const first = await submitPrivateLessonPurchase(fake.store, member, submission(), now);
    const second = await submitPrivateLessonPurchase(fake.store, member, submission(), now);
    expect(second).toEqual(first);
    expect(fake.purchases.size).toBe(1);
  });
});

describe("reviewPrivateLessonPurchase", () => {
  async function pending(optionId: string, submittedAt: string) {
    const fake = createStore({ students: [student()], links: [["member-uid", "student-1"]] });
    const purchase = await submitPrivateLessonPurchase(
      fake.store,
      member,
      submission({ optionId }),
      submittedAt,
    );
    return { fake, purchase };
  }

  it("approves a pack of 10 with credits, expiry, a paid invoice and an audit event", async () => {
    const { fake, purchase } = await pending("pack-10", "2026-08-30T09:00:00.000Z");
    const result = await reviewPrivateLessonPurchase(
      fake.store,
      office,
      { purchaseId: purchase.purchaseId, decision: "approve", reason: null },
      "2026-08-31T09:00:00.000Z",
    );
    expect(result).toMatchObject({
      status: "approved",
      creditsRemaining: 10,
      expiresAt: "2027-02-28T09:00:00.000Z",
      decidedBy: "office-uid",
    });
    expect(fake.invoices).toHaveLength(1);
    expect(fake.invoices[0]).toMatchObject({
      chargeKind: "private-lesson",
      totalMinor: 50000,
      status: "paid",
      familyId: "family-1",
      membershipId: null,
    });
    expect(fake.payments[0]).toMatchObject({
      amountMinor: 50000,
      method: "bank_transfer",
      invoiceId: fake.invoices[0]!.invoiceId,
    });
    expect(result.invoiceId).toBe(fake.invoices[0]!.invoiceId);
    expect(fake.audits).toHaveLength(1);
    expect(fake.audits[0]).toMatchObject({ action: "payment.recorded", actorId: "office-uid" });
  });

  it("refuses a second active monthly plan", async () => {
    const { fake, purchase } = await pending("monthly", now);
    fake.purchases.set("existing", approved({}));
    await expect(
      reviewPrivateLessonPurchase(
        fake.store,
        office,
        { purchaseId: purchase.purchaseId, decision: "approve", reason: null },
        now,
      ),
    ).rejects.toThrow("This member already has an active monthly private lesson plan.");
    expect(fake.invoices).toHaveLength(0);
  });

  it("approves only once", async () => {
    const { fake, purchase } = await pending("single", now);
    const decision = {
      purchaseId: purchase.purchaseId,
      decision: "approve",
      reason: null,
    } as const;
    await reviewPrivateLessonPurchase(fake.store, office, decision, now);
    await expect(reviewPrivateLessonPurchase(fake.store, office, decision, now)).rejects.toThrow(
      "This purchase has already been reviewed.",
    );
    expect(fake.invoices).toHaveLength(1);
    expect(fake.payments).toHaveLength(1);
  });

  it("rejects without money or credits", async () => {
    const { fake, purchase } = await pending("single", now);
    const result = await reviewPrivateLessonPurchase(
      fake.store,
      office,
      { purchaseId: purchase.purchaseId, decision: "reject", reason: "Transfer not received" },
      now,
    );
    expect(result).toMatchObject({
      status: "rejected",
      creditsRemaining: 0,
      decisionReason: "Transfer not received",
    });
    expect(fake.invoices).toHaveLength(0);
  });

  it("needs a billing account to approve", async () => {
    const { fake, purchase } = await pending("single", now);
    const noFamily = createStore({ students: [student({ familyId: null })] });
    noFamily.purchases.set(purchase.purchaseId, fake.purchases.get(purchase.purchaseId)!);
    await expect(
      reviewPrivateLessonPurchase(
        noFamily.store,
        office,
        { purchaseId: purchase.purchaseId, decision: "approve", reason: null },
        now,
      ),
    ).rejects.toThrow("Register the member's billing account first.");
  });
});

describe("recordPrivateLessonPurchase", () => {
  it("records a cash purchase from the office as approved", async () => {
    const fake = createStore({ students: [student()] });
    const result = await recordPrivateLessonPurchase(
      fake.store,
      office,
      { studentId: "student-1", optionId: "single", method: "cash", reference: null },
      now,
    );
    expect(result).toMatchObject({
      status: "approved",
      source: "office",
      method: "cash",
      proofId: null,
      accountUid: null,
      creditsRemaining: 1,
      expiresAt: "2026-12-26T10:00:00.000Z",
    });
    expect(fake.payments[0]).toMatchObject({ method: "cash", amountMinor: 6500 });
    expect(fake.audits).toHaveLength(1);
  });

  it("refuses members under 16 from the office too", async () => {
    const fake = createStore({ students: [student({ dateOfBirth: yearsBefore(now, 15) })] });
    await expect(
      recordPrivateLessonPurchase(
        fake.store,
        office,
        { studentId: "student-1", optionId: "single", method: "cash", reference: null },
        now,
      ),
    ).rejects.toThrow("Private lessons are for members aged 16 or over.");
  });
});

describe("office-only operations", () => {
  it("refuses a coach", async () => {
    const fake = createStore({ students: [student()] });
    const coach: PrivateLessonActor = { academyId, userId: "coach-uid", role: "coach" };
    await expect(
      recordPrivateLessonPurchase(
        fake.store,
        coach,
        { studentId: "student-1", optionId: "single", method: "cash", reference: null },
        now,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      reviewPrivateLessonPurchase(
        fake.store,
        coach,
        { purchaseId: "x", decision: "approve", reason: null },
        now,
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("listMyPrivateLessons", () => {
  it("totals usable credits and the next expiry for a linked member", async () => {
    const fake = createStore({ students: [student()], links: [["member-uid", "student-1"]] });
    fake.purchases.set("a", approved({ purchaseId: "a", creditsRemaining: 2 }));
    fake.purchases.set(
      "b",
      approved({
        purchaseId: "b",
        optionId: "pack-10",
        creditsRemaining: 7,
        expiresAt: "2027-02-28T09:00:00.000Z",
      }),
    );
    fake.purchases.set("c", approved({ purchaseId: "c", expiresAt: "2026-09-01T00:00:00.000Z" }));
    const result = await listMyPrivateLessons(fake.store, member, { studentId: "student-1" }, now);
    expect(result.creditsAvailable).toBe(9);
    expect(result.nextExpiry).toBe("2026-10-20T12:00:00.000Z");
    expect(result.purchases).toHaveLength(3);
  });

  it("refuses an unlinked account", async () => {
    const fake = createStore({ students: [student()] });
    await expect(
      listMyPrivateLessons(fake.store, member, { studentId: "student-1" }, now),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
});
