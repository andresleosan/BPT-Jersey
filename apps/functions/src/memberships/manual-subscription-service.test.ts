import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import type { UserActorContext } from "@bpt-jersey/domain";
import type { ManualSubscriptionInput } from "@bpt-jersey/domain/memberships/admin";
import { expiryNotificationId } from "../notifications/notification-identifiers.js";
import { listSubscriptionBilling, saveManualSubscription } from "./manual-subscription-service.js";

const actor = {
  kind: "user",
  academyId: "academy-1",
  userId: "owner-1",
  role: "owner",
} as UserActorContext;
const base = "academies/academy-1/";
const time = "2026-08-01T10:00:00.000Z";
const envelope = {
  academyId: actor.academyId,
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: time,
  createdBy: "owner-1",
  updatedAt: time,
  updatedBy: "owner-1",
};
const selectedPlan = PLAN_CATALOG[0]!;
type Data = Record<string, unknown>;
type Ref = {
  path: string;
  id: string;
  field?: string;
  op?: string;
  value?: unknown;
  cap?: number;
  collection: (name: string) => ReturnType<typeof collection>;
};
function collection(path: string) {
  return {
    doc: (id = randomUUID()) => reference(`${path}/${id}`),
    where: (field: string, op: string, value: unknown) => ({
      limit: (cap: number) => ({ ...reference(path), field, op, value, cap }),
    }),
  };
}
function reference(path: string): Ref {
  return { path, id: path.split("/").at(-1)!, collection: (name) => collection(`${path}/${name}`) };
}
function harness() {
  const records = new Map<string, Data>([
    [
      base + "students/student-1",
      {
        ...envelope,
        studentId: "student-1",
        familyId: "family-1",
        fullName: "Fixture member",
        dateOfBirth: "1990-01-01",
        participantType: "adult",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
      },
    ],
    [
      base + "families/family-1",
      {
        ...envelope,
        familyId: "family-1",
        primaryContactUserId: "member-1",
        billingContactUserId: "member-1",
      },
    ],
    [base + "plans/" + selectedPlan.planId, { ...selectedPlan, ...envelope }],
  ]);
  delete records.get(base + "plans/" + selectedPlan.planId)!.status;
  const snapshot = (r: Ref, data = records) => ({
    id: r.id,
    exists: data.has(r.path),
    data: () => data.get(r.path),
    get: (key: string) => data.get(r.path)?.[key],
  });
  const read = (r: Ref, data = records) => {
    if (!r.field) return snapshot(r, data);
    const docs = [...data]
      .filter(
        ([path, value]) =>
          path.startsWith(r.path + "/") &&
          (r.op === "in"
            ? (r.value as unknown[]).includes(value[r.field!])
            : value[r.field!] === r.value),
      )
      .slice(0, r.cap)
      .map(([path]) => snapshot(reference(path), data));
    return { docs, size: docs.length };
  };
  function readable(r: Ref): object {
    return {
      ...r,
      get: async () => read(r),
      collection: (name: string) => ({
        doc: (id = randomUUID()) => readable(reference(`${r.path}/${name}/${id}`)),
        where: (field: string, op: string, value: unknown) => ({
          limit: (cap: number) =>
            readable({ ...reference(`${r.path}/${name}`), field, op, value, cap }),
        }),
      }),
    };
  }
  const db = {
    doc: (path: string) => readable(reference(path)),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const staged = new Map(records);
      let wrote = false;
      const tx = {
        get: async (r: Ref) => {
          if (wrote) throw Error("Read after write");
          return read(r, staged);
        },
        set: (r: Ref, d: Data) => {
          wrote = true;
          staged.set(r.path, d);
        },
        create: (r: Ref, d: Data) => {
          if (staged.has(r.path)) throw Error("Duplicate document");
          wrote = true;
          staged.set(r.path, d);
        },
      };
      const result = await fn(tx);
      records.clear();
      for (const [p, d] of staged) records.set(p, d);
      return result;
    },
  } as unknown as Firestore;
  return { db, records };
}
function input(settlement: ManualSubscriptionInput["settlement"]): ManualSubscriptionInput {
  return {
    studentId: "student-1",
    membershipId: null,
    expectedUpdatedAt: null,
    requestId: randomUUID(),
    operation: "assign",
    planId: selectedPlan.planId,
    startsAt: time,
    endsAt: "2027-08-01T10:00:00.000Z",
    settlement,
  };
}
const paid = {
  kind: "paid",
  amountMinor: 6000,
  method: "cash",
  reference: "CASH-1",
  occurredAt: time,
} as const;
describe("office subscription settlements", () => {
  it("commits paid subscription, invoice and receipt together and replays once", async () => {
    const h = harness();
    const command = input(paid);
    const saved = await saveManualSubscription(h.db, actor, command);
    expect(saved.status).toBe("active");
    const count = h.records.size;
    expect(await saveManualSubscription(h.db, actor, command)).toEqual(saved);
    expect(h.records.size).toBe(count);
    expect([...h.records].filter(([p]) => p.includes("/payments/"))).toHaveLength(1);
    expect(h.records.get(base + "invoices/manual-" + command.requestId)?.status).toBe("paid");
  });
  it("grants free access without inventing a payment", async () => {
    const h = harness();
    const saved = await saveManualSubscription(
      h.db,
      actor,
      input({ kind: "complimentary", reason: "Office scholarship" }),
    );
    expect(saved.status).toBe("active");
    expect(
      [...h.records.keys()].some((p) => p.includes("/payments/") || p.includes("/invoices/")),
    ).toBe(false);
    expect(
      h.records.get(base + "membershipAdministration/" + saved.membershipId)?.complimentary,
    ).toBe(true);
  });
  it("settles an unpaid period and activates the same membership without a second invoice", async () => {
    const h = harness();
    const command = input({ kind: "unpaid", amountMinor: 6000 });
    const pending = await saveManualSubscription(h.db, actor, command);
    expect(pending.status).toBe("overdue");
    const saved = await saveManualSubscription(h.db, actor, {
      ...command,
      operation: "update",
      requestId: randomUUID(),
      membershipId: pending.membershipId,
      expectedUpdatedAt: pending.updatedAt,
      settlement: paid,
    });
    expect(saved.status).toBe("active");
    expect([...h.records.keys()].filter((p) => p.includes("/invoices/"))).toHaveLength(1);
  });
  it("rejects stale updates and a second assignment without partial writes", async () => {
    const h = harness();
    const command = input(paid);
    const saved = await saveManualSubscription(h.db, actor, command);
    const before = new Map(h.records);
    await expect(
      saveManualSubscription(h.db, actor, { ...command, requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(
      saveManualSubscription(h.db, actor, {
        ...command,
        operation: "update",
        membershipId: saved.membershipId,
        expectedUpdatedAt: time,
        requestId: randomUUID(),
        settlement: { kind: "unchanged" },
      }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(h.records).toEqual(before);
  });
  it("denies non-office actors and cross-tenant member records", async () => {
    const h = harness();
    const command = input(paid);
    await expect(
      saveManualSubscription(h.db, { ...actor, role: "adultStudent" }, command),
    ).rejects.toMatchObject({ code: "permission-denied" });
    h.records.get(base + "students/student-1")!.academyId = "another-academy";
    await expect(saveManualSubscription(h.db, actor, command)).rejects.toMatchObject({
      code: "failed-precondition",
    });
    expect([...h.records.keys()].some((p) => p.includes("/payments/"))).toBe(false);
  });
  it("changes an active plan without charging again and preserves paid history", async () => {
    const h = harness();
    const command = input(paid);
    const saved = await saveManualSubscription(h.db, actor, command);
    const alternate = PLAN_CATALOG[1]!;
    h.records.set(base + "plans/" + alternate.planId, { ...alternate, ...envelope });
    delete h.records.get(base + "plans/" + alternate.planId)!.status;
    const edited = await saveManualSubscription(h.db, actor, {
      ...command,
      operation: "update",
      membershipId: saved.membershipId,
      expectedUpdatedAt: saved.updatedAt,
      requestId: randomUUID(),
      planId: alternate.planId,
      settlement: { kind: "unchanged" },
    });
    expect(edited.planId).toBe(alternate.planId);
    expect([...h.records.keys()].filter((p) => p.includes("/payments/"))).toHaveLength(1);
    const before = new Map(h.records);
    await expect(
      saveManualSubscription(h.db, actor, {
        ...command,
        operation: "update",
        membershipId: edited.membershipId,
        expectedUpdatedAt: edited.updatedAt,
        requestId: randomUUID(),
        settlement: { kind: "unpaid", amountMinor: 6000 },
      }),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    expect(h.records).toEqual(before);
  });
});

it("renews without interrupting access before the existing period ends", async () => {
  const h = harness();
  const initial = input(paid);
  const current = await saveManualSubscription(h.db, actor, initial);
  const noticePath =
    base + "adminNotifications/" + expiryNotificationId(current.membershipId, current.endsAt!);
  h.records.set(noticePath, { readAt: null, resolvedAt: null });
  const renewed = await saveManualSubscription(h.db, actor, {
    ...initial,
    requestId: randomUUID(),
    membershipId: current.membershipId,
    expectedUpdatedAt: current.updatedAt,
    operation: "renew",
    startsAt: current.endsAt!,
    endsAt: "2027-09-01T10:00:00.000Z",
    settlement: { kind: "complimentary", reason: "One extra month" },
  });
  expect(h.records.get(noticePath)?.resolvedAt).toBe(renewed.updatedAt);
  const [billing] = await listSubscriptionBilling(h.db, actor.academyId, current.studentId);
  expect(billing).toMatchObject({ complimentary: true, currentInvoiceId: null });
  expect(billing?.invoices[0]?.payments).toEqual([
    expect.objectContaining({ amountMinor: 6000, reference: "CASH-1" }),
  ]);
  expect(renewed.startsAt).toBe(current.startsAt);
  expect(renewed.endsAt).toBe("2027-09-01T10:00:00.000Z");
  expect(renewed.status).toBe("active");
  expect([...h.records].filter(([path]) => path.includes("/payments/"))).toHaveLength(1);
});

it("settles an existing Billing invoice without an office link and exposes the actual receipt", async () => {
  const h = harness();
  const command = input({ kind: "unpaid", amountMinor: 6000 });
  const current = await saveManualSubscription(h.db, actor, command);
  h.records.delete(base + "membershipAdministration/" + current.membershipId);
  const [before] = await listSubscriptionBilling(h.db, actor.academyId, current.studentId);
  expect(before?.currentInvoiceId).toBe("manual-" + command.requestId);
  const saved = await saveManualSubscription(h.db, actor, {
    ...command,
    operation: "update",
    membershipId: current.membershipId,
    expectedUpdatedAt: current.updatedAt,
    requestId: randomUUID(),
    settlement: paid,
  });
  const [billing] = await listSubscriptionBilling(h.db, actor.academyId, saved.studentId);
  expect(saved.status).toBe("active");
  expect(billing?.invoices).toHaveLength(1);
  expect(billing?.invoices[0]).toMatchObject({
    status: "paid",
    payments: [expect.objectContaining({ reference: "CASH-1" })],
  });
});

it("distinguishes an absent student from an existing student without a billing family", async () => {
  const h = harness();
  delete h.records.get(base + "students/student-1")!.familyId;
  expect(await listSubscriptionBilling(h.db, actor.academyId, "student-1")).toEqual([]);
  await expect(listSubscriptionBilling(h.db, actor.academyId, "missing")).rejects.toMatchObject({
    code: "not-found",
  });
});

it("excludes imported memberships, invoices and receipts before parsing and current selection", async () => {
  const h = harness();
  const saved = await saveManualSubscription(h.db, actor, input(paid));
  h.records.delete(base + "membershipAdministration/" + saved.membershipId);
  h.records.set(base + "memberships/imported", { studentId: "student-1", source: "legacy-import" });
  h.records.set(base + "invoices/imported", {
    membershipId: saved.membershipId,
    source: "legacy-import",
  });
  const invoice = [...h.records].find(([path]) => path.includes("/invoices/manual-"))!;
  h.records.set(base + "payments/imported", {
    invoiceId: invoice[1].invoiceId,
    source: "legacy-import",
  });
  h.records.set(base + "invoices/sibling", { membershipId: "sibling-membership", status: "open" });
  h.records.set(base + "payments/sibling", { invoiceId: "sibling", amountMinor: 9999 });
  const before = new Map(h.records);
  const billing = await listSubscriptionBilling(h.db, actor.academyId, "student-1");
  expect(billing).toHaveLength(1);
  expect(billing[0]).toMatchObject({
    membershipId: saved.membershipId,
    currentInvoiceId: invoice[1].invoiceId,
  });
  expect(billing[0]!.invoices).toHaveLength(1);
  expect(billing[0]!.invoices[0]!.payments).toEqual([
    expect.objectContaining({ amountMinor: 6000, reference: "CASH-1" }),
  ]);
  expect(h.records).toEqual(before);
});

it.each([
  "unknown-source",
  "invalid-live",
  "historical-pointer",
  "membership-cap",
  "invoice-cap",
  "receipt-cap",
])("fails safely for %s without finance writes", async (scenario) => {
  const h = harness();
  const saved = await saveManualSubscription(h.db, actor, input(paid));
  const invoice = [...h.records].find(([path]) => path.includes("/invoices/"))!;
  if (scenario === "unknown-source") invoice[1].source = "unknown";
  if (scenario === "invalid-live") invoice[1].familyId = "wrong-family";
  if (scenario === "historical-pointer") invoice[1].source = "legacy-import";
  const collectionName =
    scenario === "membership-cap"
      ? "memberships"
      : scenario === "invoice-cap"
        ? "invoices"
        : "payments";
  if (scenario.endsWith("-cap")) {
    for (let i = 0; i < (scenario === "receipt-cap" ? 1001 : 101); i++)
      h.records.set(base + collectionName + "/extra-" + i, {
        studentId: "student-1",
        membershipId: saved.membershipId,
        invoiceId: invoice[1].invoiceId,
        source: "legacy-import",
      });
  }
  const before = new Map(h.records);
  await expect(listSubscriptionBilling(h.db, actor.academyId, "student-1")).rejects.toMatchObject({
    code: "failed-precondition",
  });
  expect(h.records).toEqual(before);
});
