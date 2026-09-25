import { describe, expect, it } from "vitest";

import type { ManualPaymentRecord } from "@bpt-jersey/domain/finance";

import {
  FinanceStoreError,
  createFinanceStore,
  type FinanceDocumentData,
  type FinanceFirestore,
  type FinanceAuditDraft,
} from "./finance-service.js";

type Ref = Readonly<{ id: string; path: string }>;
type Query = Readonly<{ path: string; field: string; value: unknown }>;

const academyId = "academy-1";
const familyId = "family-1";
const membershipId = "membership-1";
const now = "2026-08-19T10:00:00.000Z";

function ref(path: string): Ref {
  return { id: path.split("/").at(-1) ?? "", path };
}

function createFakeFirestore(initial: Record<string, FinanceDocumentData> = {}) {
  const records = new Map(Object.entries(initial));
  const writes: string[] = [];
  const reads: string[] = [];
  const audits: FinanceAuditDraft[] = [];

  function readDoc(path: string) {
    reads.push(path);
    const data = records.get(path);
    return { ...ref(path), exists: data !== undefined, data: () => data };
  }

  function matchingEntries(path: string): Array<[string, FinanceDocumentData]> {
    return [...records.entries()].filter(([recordPath]) => recordPath.startsWith(`${path}/`));
  }

  function readCollection(path: string) {
    return matchingEntries(path).map(([recordPath, data]) => {
      reads.push(recordPath);
      return { ...ref(recordPath), exists: true, data: () => data };
    });
  }

  const firestore: FinanceFirestore = {
    doc: (path) => ({ ...ref(path), get: async () => readDoc(path) }),
    collection: (path) => ({
      doc: (id?: string) => {
        const docPath = `${path}/${id ?? "generated"}`;
        return { ...ref(docPath), get: async () => readDoc(docPath) };
      },
      get: async () => ({ docs: readCollection(path) }),
      where: (field, _operator, value) => ({ path, field, value }),
      orderBy: (field, direction) => ({
        limit: (n: number) => ({
          get: async () => {
            const docs = readCollection(path).sort((a, b) => {
              const av = a.data()?.[field] as string | number | undefined;
              const bv = b.data()?.[field] as string | number | undefined;
              if (av === bv) return 0;
              const ascending = (av ?? 0) < (bv ?? 0) ? -1 : 1;
              return direction === "desc" ? -ascending : ascending;
            });
            return { docs: docs.slice(0, n) };
          },
        }),
      }),
    }),
    runTransaction: async (callback) => {
      const snapshot = new Map(records);
      const transaction = {
        get: async (target: Ref | Query) => {
          if ("field" in target) {
            return {
              docs: matchingEntries(target.path)
                .filter(([, data]) => data[target.field] === target.value)
                .map(([recordPath, data]) => {
                  reads.push(recordPath);
                  return { ...ref(recordPath), exists: true, data: () => data };
                }),
            };
          }
          return readDoc(target.path);
        },
        create: (target: Ref, data: FinanceDocumentData) => {
          if (records.has(target.path)) throw new Error("already exists");
          writes.push(`create:${target.path}`);
          records.set(target.path, data);
          return transaction;
        },
        set: (target: Ref, data: FinanceDocumentData) => {
          writes.push(`set:${target.path}`);
          records.set(target.path, data);
          return transaction;
        },
      };
      try {
        return await callback(transaction);
      } catch (error) {
        records.clear();
        for (const [path, data] of snapshot) records.set(path, data);
        writes.length = 0;
        throw error;
      }
    },
  };
  return { firestore, records, writes, reads, audits };
}

function seedSources(): Record<string, FinanceDocumentData> {
  return {
    [`academies/${academyId}/families/${familyId}`]: {
      familyId,
      academyId,
      active: true,
    },
    [`academies/${academyId}/memberships/${membershipId}`]: {
      membershipId,
      academyId,
      familyId,
      status: "active",
    },
  };
}

function store(initial: Record<string, FinanceDocumentData> = seedSources()) {
  const fake = createFakeFirestore(initial);
  let invoiceSequence = 0;
  const service = createFinanceStore({
    firestore: fake.firestore,
    now: () => now,
    generateInvoiceId: () => `invoice-generated-${++invoiceSequence}`,
    appendAudit: (_transaction, _ref, draft) => fake.audits.push(draft),
  });
  return { ...fake, service };
}

function storeWithFamily(seededFamilyId: string) {
  const fake = createFakeFirestore({
    [`academies/${academyId}/families/${seededFamilyId}`]: {
      familyId: seededFamilyId,
      academyId,
      active: true,
    },
  });
  let invoiceSequence = 0;
  const service = createFinanceStore({
    firestore: fake.firestore,
    now: () => now,
    generateInvoiceId: () => `invoice-generated-${++invoiceSequence}`,
    appendAudit: (_transaction, _ref, draft) => fake.audits.push(draft),
  });
  return { store: service, firestore: Object.assign(fake.firestore, { reads: fake.reads }) };
}

function storeWithFamilyMembershipAndStudent(options: {
  familyId: string;
  membershipId: string;
  studentId: string;
  fullName: string;
}) {
  const fake = createFakeFirestore({
    [`academies/${academyId}/families/${options.familyId}`]: {
      familyId: options.familyId,
      academyId,
      active: true,
    },
    [`academies/${academyId}/memberships/${options.membershipId}`]: {
      membershipId: options.membershipId,
      academyId,
      familyId: options.familyId,
      studentId: options.studentId,
      status: "active",
    },
    [`academies/${academyId}/students/${options.studentId}`]: {
      fullName: options.fullName,
    },
  });
  let invoiceSequence = 0;
  const service = createFinanceStore({
    firestore: fake.firestore,
    now: () => now,
    generateInvoiceId: () => `invoice-generated-${++invoiceSequence}`,
    appendAudit: (_transaction, _ref, draft) => fake.audits.push(draft),
  });
  return { store: service, firestore: Object.assign(fake.firestore, { reads: fake.reads }) };
}

describe("finance store", () => {
  it("creates an idempotent manual invoice with server-owned fields", async () => {
    const { service, records } = store();
    const input = {
      academyId,
      actorId: "admin-1",
      familyId,
      membershipId,
      totalMinor: 1000,
      dueAt: now,
      chargeKind: "membership" as const,
      invoiceReference: "invoice-reference-1",
      description: "Manual membership invoice",
    };

    const first = await service.issueManualInvoice(input);
    const replay = await service.issueManualInvoice(input);

    expect(replay).toEqual(first);
    expect(records.get(`academies/${academyId}/invoices/${first.invoiceId}`)).toMatchObject({
      invoiceId: first.invoiceId,
      academyId,
      status: "open",
      currency: "GBP",
      createdAt: now,
      createdBy: "admin-1",
      paidAt: null,
    });
  });

  it("rejects a divergent invoice idempotency replay without mutation", async () => {
    const { service, records } = store();
    const base = {
      academyId,
      actorId: "admin-1",
      familyId,
      membershipId,
      totalMinor: 1000,
      dueAt: now,
      chargeKind: "membership" as const,
      invoiceReference: "invoice-reference-1",
      description: "Manual membership invoice",
    };
    await service.issueManualInvoice(base);
    const before = new Map(records);

    await expect(service.issueManualInvoice({ ...base, totalMinor: 2000 })).rejects.toMatchObject({
      code: "conflict",
    });
    expect(records).toEqual(before);
  });

  it("records a payment transactionally and derives the remaining balance", async () => {
    const { service } = store();
    const invoice = await service.issueManualInvoice({
      academyId,
      actorId: "admin-1",
      familyId,
      membershipId,
      totalMinor: 1000,
      dueAt: now,
      chargeKind: "membership",
      invoiceReference: "invoice-reference-1",
      description: "Manual membership invoice",
    });

    const payment = await service.recordManualPayment({
      academyId,
      actorId: "admin-1",
      invoiceId: invoice.invoiceId,
      amountMinor: 400,
      method: "cash",
      manualReference: "cash-reference-1",
      occurredAt: now,
    });

    expect(payment).toMatchObject<Partial<ManualPaymentRecord>>({
      invoiceId: invoice.invoiceId,
      amountMinor: 400,
      status: "recorded",
    });
    await expect(
      service.getInvoice({ academyId, familyIds: [familyId] }, invoice.invoiceId),
    ).resolves.toMatchObject({
      balanceMinor: 600,
    });
  });

  it("rejects a manual reference reused for a different invoice", async () => {
    const { service } = store();
    const first = await service.issueManualInvoice({
      academyId,
      actorId: "admin-1",
      familyId,
      membershipId,
      totalMinor: 1000,
      dueAt: now,
      chargeKind: "membership",
      invoiceReference: "invoice-reference-1",
      description: "First invoice",
    });
    const second = await service.issueManualInvoice({
      academyId,
      actorId: "admin-1",
      familyId,
      membershipId,
      totalMinor: 1000,
      dueAt: now,
      chargeKind: "membership",
      invoiceReference: "invoice-reference-2",
      description: "Second invoice",
    });
    await service.recordManualPayment({
      academyId,
      actorId: "admin-1",
      invoiceId: first.invoiceId,
      amountMinor: 400,
      method: "cash",
      manualReference: "cash-reference-shared",
      occurredAt: now,
    });

    await expect(
      service.recordManualPayment({
        academyId,
        actorId: "admin-1",
        invoiceId: second.invoiceId,
        amountMinor: 400,
        method: "cash",
        manualReference: "cash-reference-shared",
        occurredAt: now,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects overpayment and voiding after a payment", async () => {
    const { service } = store();
    const invoice = await service.issueManualInvoice({
      academyId,
      actorId: "admin-1",
      familyId,
      membershipId,
      totalMinor: 1000,
      dueAt: now,
      chargeKind: "membership",
      invoiceReference: "invoice-reference-1",
      description: "Manual membership invoice",
    });
    await service.recordManualPayment({
      academyId,
      actorId: "admin-1",
      invoiceId: invoice.invoiceId,
      amountMinor: 400,
      method: "cash",
      manualReference: "cash-reference-1",
      occurredAt: now,
    });

    await expect(
      service.recordManualPayment({
        academyId,
        actorId: "admin-1",
        invoiceId: invoice.invoiceId,
        amountMinor: 700,
        method: "cash",
        manualReference: "cash-reference-2",
        occurredAt: now,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.voidManualInvoice({ academyId, actorId: "admin-1", invoiceId: invoice.invoiceId }),
    ).rejects.toMatchObject({
      code: "precondition",
    });
  });

  it("creates and calculates an internal PAYG invoice", async () => {
    const { service } = store();
    const invoice = await service.issuePaygInvoice({
      academyId,
      actorId: "system-booking",
      familyId,
      membershipId,
      totalMinor: 1000,
      dueAt: now,
      chargeKind: "payg_session",
      sourceRef: `academies/${academyId}/sessions/session-1`,
      invoiceReference: "payg-reference-1",
      description: "PAYG session",
    });

    await expect(
      service.getInvoice({ academyId, familyIds: [familyId] }, invoice.invoiceId),
    ).resolves.toMatchObject({
      balanceMinor: 1000,
      invoice: { chargeKind: "payg_session" },
    });
  });

  it("scopes account queries before parsing another family's records", async () => {
    const { service, records } = store();
    const invoice = await service.issueManualInvoice({
      academyId,
      actorId: "admin-1",
      familyId,
      membershipId,
      totalMinor: 1000,
      dueAt: now,
      chargeKind: "membership",
      invoiceReference: "family-scoped-reference",
      description: "Family scoped invoice",
    });
    records.set(`academies/${academyId}/invoices/corrupt-other-family`, {
      academyId,
      familyId: "family-2",
    });

    await expect(
      service.listFinancialAccount({ academyId, familyIds: [familyId] }),
    ).resolves.toMatchObject({
      invoices: [{ invoice: { invoiceId: invoice.invoiceId } }],
      balanceMinor: 1000,
    });
  });

  it("fails closed on misplaced invoices and payments with matching external scope", async () => {
    const invoiceScenario = store();
    const misplacedInvoice = await invoiceScenario.service.issueManualInvoice({
      academyId,
      actorId: "admin-1",
      familyId,
      membershipId,
      totalMinor: 1000,
      dueAt: now,
      chargeKind: "membership",
      invoiceReference: "cross-tenant-invoice",
      description: "Cross-tenant invoice fixture",
    });
    const invoicePath = `academies/${academyId}/invoices/${misplacedInvoice.invoiceId}`;
    invoiceScenario.records.set(invoicePath, {
      ...invoiceScenario.records.get(invoicePath)!,
      academyId: "academy-2",
    });
    await expect(
      invoiceScenario.service.listFinancialAccount({ academyId, familyIds: [familyId] }),
    ).rejects.toMatchObject({ code: "tenant" });

    const paymentScenario = store();
    const invoice = await paymentScenario.service.issueManualInvoice({
      academyId,
      actorId: "admin-1",
      familyId,
      membershipId,
      totalMinor: 1000,
      dueAt: now,
      chargeKind: "membership",
      invoiceReference: "payment-scope-invoice",
      description: "Payment scope fixture",
    });
    const payment = await paymentScenario.service.recordManualPayment({
      academyId,
      actorId: "admin-1",
      invoiceId: invoice.invoiceId,
      amountMinor: 400,
      method: "cash",
      manualReference: "payment-scope-reference",
      occurredAt: now,
    });
    const paymentPath = `academies/${academyId}/payments/${payment.paymentId}`;
    paymentScenario.records.set(paymentPath, {
      ...paymentScenario.records.get(paymentPath)!,
      academyId: "academy-2",
    });
    await expect(
      paymentScenario.service.listFinancialAccount({ academyId, familyIds: [familyId] }),
    ).rejects.toMatchObject({ code: "tenant" });

    paymentScenario.records.set(paymentPath, {
      ...paymentScenario.records.get(paymentPath)!,
      academyId,
      familyId: "family-2",
    });
    await expect(paymentScenario.service.listFinancialAccount({ academyId })).rejects.toMatchObject(
      { code: "tenant" },
    );
  });

  it("rejects cross-tenant sources before writing", async () => {
    const { service, records } = store();
    const before = new Map(records);

    await expect(
      service.issuePaygInvoice({
        academyId,
        actorId: "system-booking",
        familyId,
        membershipId,
        totalMinor: 1000,
        dueAt: now,
        chargeKind: "payg_session",
        sourceRef: "academies/academy-2/sessions/session-1",
        invoiceReference: "payg-reference-1",
        description: "PAYG session",
      }),
    ).rejects.toMatchObject({ code: "tenant" });
    expect(records).toEqual(before);
  });

  it("rejects traversal-like PAYG source references before writing", async () => {
    const { service } = store();

    await expect(
      service.issuePaygInvoice({
        academyId,
        actorId: "system-booking",
        familyId,
        membershipId,
        totalMinor: 1000,
        dueAt: now,
        chargeKind: "payg_session",
        sourceRef: `academies/${academyId}/sessions/../families/${familyId}`,
        invoiceReference: "payg-reference-1",
        description: "PAYG session",
      }),
    ).rejects.toMatchObject({ code: "tenant" });
  });

  it("voids an open invoice without deleting its record", async () => {
    const { service, records } = store();
    const invoice = await service.issueManualInvoice({
      academyId,
      actorId: "admin-1",
      familyId,
      membershipId,
      totalMinor: 1000,
      dueAt: now,
      chargeKind: "manual_adjustment",
      invoiceReference: "invoice-reference-1",
      description: "Manual adjustment",
    });

    const voided = await service.voidManualInvoice({
      academyId,
      actorId: "admin-1",
      invoiceId: invoice.invoiceId,
    });

    expect(voided.status).toBe("void");
    expect(records.has(`academies/${academyId}/invoices/${invoice.invoiceId}`)).toBe(true);
    await expect(
      service.voidManualInvoice({ academyId, actorId: "admin-1", invoiceId: invoice.invoiceId }),
    ).rejects.toBeInstanceOf(FinanceStoreError);
  });

  it("issues an invoice with no membership and reads it back for the family only", async () => {
    const { store, firestore } = storeWithFamily("family-1");

    const invoice = await store.issueManualInvoice({
      academyId,
      actorId: "owner-1",
      familyId: "family-1",
      membershipId: null,
      totalMinor: 1500,
      dueAt: "2026-10-01T23:59:59.000Z",
      chargeKind: "manual_adjustment",
      invoiceReference: "INV-SEM-1",
      description: "Seminar",
    });

    expect(invoice.membershipId).toBeNull();

    const familyView = await store.listFinancialAccount({ academyId, familyIds: ["family-1"] });
    expect(familyView.invoices.map((v) => v.invoice.invoiceId)).toContain(invoice.invoiceId);

    const studentView = await store.listFinancialAccount({
      academyId,
      familyIds: ["family-1"],
      studentIds: ["student-1"],
    });
    expect(studentView.invoices.map((v) => v.invoice.invoiceId)).not.toContain(invoice.invoiceId);

    expect(firestore.reads.some((path) => path.includes("/memberships/"))).toBe(false);
  });

  it("lists the most recent payments with the member's name when a membership links one", async () => {
    const { store } = storeWithFamilyMembershipAndStudent({
      familyId: "family-1",
      membershipId: "m-1",
      studentId: "student-1",
      fullName: "Ana Coelho",
    });

    const withMember = await store.issueManualInvoice({
      academyId,
      actorId: "owner-1",
      familyId: "family-1",
      membershipId: "m-1",
      totalMinor: 7500,
      dueAt: "2026-10-01T23:59:59.000Z",
      chargeKind: "membership",
      invoiceReference: "INV-1",
      description: "September",
    });
    const withoutMember = await store.issueManualInvoice({
      academyId,
      actorId: "owner-1",
      familyId: "family-1",
      membershipId: null,
      totalMinor: 1500,
      dueAt: "2026-10-01T23:59:59.000Z",
      chargeKind: "manual_adjustment",
      invoiceReference: "INV-2",
      description: "Seminar",
    });

    await store.recordManualPayment({
      academyId,
      actorId: "owner-1",
      invoiceId: withMember.invoiceId,
      amountMinor: 7500,
      method: "bank_transfer",
      manualReference: "BT-1",
      occurredAt: "2026-09-10T10:00:00.000Z",
    });
    await store.recordManualPayment({
      academyId,
      actorId: "owner-1",
      invoiceId: withoutMember.invoiceId,
      amountMinor: 1500,
      method: "cash",
      manualReference: "CASH-1",
      occurredAt: "2026-09-12T10:00:00.000Z",
    });

    const rows = await store.listRecentPayments(academyId, 20);
    expect(rows.map((r) => [r.manualReference, r.memberName, r.method])).toEqual([
      ["CASH-1", null, "cash"],
      ["BT-1", "Ana Coelho", "bank_transfer"],
    ]);
    expect(await store.listRecentPayments(academyId, 1)).toHaveLength(1);
  });
});

describe("payment instructions (T010/T035 re-scope)", () => {
  const instructions = {
    accountName: "BPT Jersey",
    sortCode: "402530",
    accountNumber: "12345678",
    bankName: "Synthetic Bank",
    referenceHint: "Quote your invoice reference",
    acceptsCash: true,
  };

  it("stores the academy's details in one audited document and serves them with the account", async () => {
    const { service, records, audits } = store(seedSources());
    const saved = await service.savePaymentInstructions({
      academyId,
      actorId: "owner-1",
      instructions,
    });
    expect(saved).toMatchObject({ ...instructions, academyId, updatedBy: "owner-1" });
    expect(records.get(`academies/${academyId}/settings/paymentInstructions`)).toMatchObject({
      sortCode: "402530",
      schemaVersion: 1,
    });
    expect(audits.at(-1)).toMatchObject({
      action: "academy.payment_instructions.saved",
      actorId: "owner-1",
      targetRef: `academies/${academyId}/settings/paymentInstructions`,
    });

    const account = await service.listFinancialAccount({ academyId, familyIds: [familyId] });
    expect(account.paymentInstructions).toMatchObject({ accountNumber: "12345678" });
  });

  it("overwrites in place: there is exactly one answer to where to transfer", async () => {
    const { service, records } = store(seedSources());
    await service.savePaymentInstructions({ academyId, actorId: "owner-1", instructions });
    await service.savePaymentInstructions({
      academyId,
      actorId: "admin-1",
      instructions: { ...instructions, accountNumber: "87654321" },
    });
    const stored = [...records.keys()].filter((key) => key.includes("/settings/"));
    expect(stored).toEqual([`academies/${academyId}/settings/paymentInstructions`]);
    expect(records.get(stored[0]!)).toMatchObject({
      accountNumber: "87654321",
      updatedBy: "admin-1",
    });
  });

  it("answers null before office has configured anything, and for a malformed document", async () => {
    const { service, records } = store(seedSources());
    await expect(
      service.listFinancialAccount({ academyId, familyIds: [familyId] }),
    ).resolves.toMatchObject({ paymentInstructions: null });

    records.set(`academies/${academyId}/settings/paymentInstructions`, {
      accountName: "Broken",
      academyId,
    });
    await expect(
      service.listFinancialAccount({ academyId, familyIds: [familyId] }),
    ).resolves.toMatchObject({ paymentInstructions: null });
  });

  it("never serves another academy's instructions", async () => {
    const { service, records } = store(seedSources());
    records.set(`academies/${academyId}/settings/paymentInstructions`, {
      ...instructions,
      academyId: "academy-2",
      schemaVersion: 1,
      updatedAt: now,
      updatedBy: "owner-2",
    });
    await expect(
      service.listFinancialAccount({ academyId, familyIds: [familyId] }),
    ).resolves.toMatchObject({ paymentInstructions: null });
  });

  it("refuses an invalid tenant or actor before writing", async () => {
    const { service, records } = store(seedSources());
    await expect(
      service.savePaymentInstructions({ academyId: "../x", actorId: "owner-1", instructions }),
    ).rejects.toThrow(FinanceStoreError);
    await expect(
      service.savePaymentInstructions({ academyId, actorId: "", instructions }),
    ).rejects.toThrow(FinanceStoreError);
    expect([...records.keys()].some((key) => key.includes("/settings/"))).toBe(false);
  });
});

describe("subscription activation from Billing", () => {
  it.each(["overdue", "cancelled"])(
    "settles a %s subscription without reviving cancellations",
    async (status) => {
      const path = `academies/${academyId}/memberships/${membershipId}`;
      const membership = {
        membershipId,
        academyId,
        familyId,
        studentId: "student-1",
        planId: "payg",
        status: "active",
        startsAt: now,
        endsAt: null,
        nextBillingAt: null,
        schemaVersion: "1",
        createdAt: now,
        createdBy: "admin-1",
        updatedAt: now,
        updatedBy: "admin-1",
      };
      const h = store({ ...seedSources(), [path]: membership });
      const invoice = await h.service.issueManualInvoice({
        academyId,
        actorId: "admin-1",
        familyId,
        membershipId,
        totalMinor: 1000,
        dueAt: now,
        chargeKind: "membership",
        invoiceReference: "SUBSCRIPTION-1",
        description: "Monthly subscription",
      });
      h.records.set(path, { ...membership, status });
      const payment = {
        academyId,
        actorId: "admin-1",
        invoiceId: invoice.invoiceId,
        amountMinor: 400,
        method: "cash" as const,
        manualReference: "PART-1",
        occurredAt: now,
      };
      await h.service.recordManualPayment(payment);
      expect(h.records.get(path)?.status).toBe(status);
      await h.service.recordManualPayment({
        ...payment,
        amountMinor: 600,
        manualReference: "PART-2",
      });
      expect(h.records.get(path)?.status).toBe(status === "overdue" ? "active" : "cancelled");
      expect(h.records.get(`academies/${academyId}/invoices/${invoice.invoiceId}`)?.status).toBe(
        "paid",
      );
    },
  );
});

describe("editing a manual payment", () => {
  const requestId = "0b8f7c52-3d5e-4c8a-9f1e-2a7b6c5d4e3f";

  async function paidInvoice(totalMinor = 5000, amountMinor = 5000) {
    const h = store();
    const invoice = await h.service.issueManualInvoice({
      academyId,
      actorId: "admin-1",
      familyId,
      membershipId,
      totalMinor,
      dueAt: now,
      chargeKind: "membership",
      invoiceReference: "SUBSCRIPTION-EDIT",
      description: "Monthly subscription",
    });
    const payment = await h.service.recordManualPayment({
      academyId,
      actorId: "admin-1",
      invoiceId: invoice.invoiceId,
      amountMinor,
      method: "cash",
      manualReference: "CASH-EDIT-1",
      occurredAt: now,
    });
    const invoicePath = `academies/${academyId}/invoices/${invoice.invoiceId}`;
    const paymentPath = `academies/${academyId}/payments/${payment.paymentId}`;
    h.audits.length = 0;
    return { ...h, invoice, payment, invoicePath, paymentPath };
  }

  function edit(paymentId: string, changes: Record<string, unknown>, id = requestId) {
    return {
      academyId,
      actorId: "admin-1",
      actorName: "Ana Office",
      paymentId,
      reason: "Cash was miscounted at the desk",
      requestId: id,
      ...changes,
    };
  }

  it("lowers the amount and leaves the invoice partially paid", async () => {
    const h = await paidInvoice();
    const result = await h.service.editManualPayment(
      edit(h.payment.paymentId, { amountMinor: 3000 }),
    );
    expect(result).toEqual({
      paymentId: h.payment.paymentId,
      invoiceId: h.invoice.invoiceId,
      invoiceStatus: "partially_paid",
    });
    expect(h.records.get(h.paymentPath)).toMatchObject({
      amountMinor: 3000,
      updatedBy: "admin-1",
      auditHistory: [
        {
          editedAt: now,
          editedBy: "admin-1",
          editedByName: "Ana Office",
          reason: "Cash was miscounted at the desk",
          previousValues: { amountMinor: 5000 },
        },
      ],
    });
    expect(h.records.get(h.invoicePath)).toMatchObject({ status: "partially_paid", paidAt: null });
    expect(h.audits.map((audit) => audit.action)).toEqual([
      "payment.edited",
      "invoice.status.changed",
    ]);
    expect(h.audits[0]).toMatchObject({ amountMinor: 3000, currency: "GBP", method: "cash" });
  });

  it("raises the amount back to the total and marks the invoice paid", async () => {
    const h = await paidInvoice(5000, 3000);
    const result = await h.service.editManualPayment(
      edit(h.payment.paymentId, { amountMinor: 5000 }),
    );
    expect(result.invoiceStatus).toBe("paid");
    expect(h.records.get(h.invoicePath)).toMatchObject({ status: "paid", paidAt: now });
  });

  it("refuses an amount that would overpay the invoice and writes nothing", async () => {
    const h = await paidInvoice();
    const before = new Map(h.records);
    await expect(
      h.service.editManualPayment(edit(h.payment.paymentId, { amountMinor: 6000 })),
    ).rejects.toMatchObject({
      code: "precondition",
      message: "This change would overpay the invoice",
    });
    expect(h.records).toEqual(before);
    expect(h.audits).toEqual([]);
  });

  it("refuses a reason shorter than ten characters", async () => {
    const h = await paidInvoice();
    await expect(
      h.service.editManualPayment(
        edit(h.payment.paymentId, { amountMinor: 3000, reason: "too short" }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("refuses an edit that changes nothing", async () => {
    const h = await paidInvoice();
    await expect(
      h.service.editManualPayment(edit(h.payment.paymentId, { amountMinor: 5000, method: "cash" })),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("appends every edit and never rewrites an earlier entry", async () => {
    const h = await paidInvoice();
    await h.service.editManualPayment(edit(h.payment.paymentId, { amountMinor: 3000 }));
    const first = (h.records.get(h.paymentPath)?.auditHistory as unknown[])[0];
    await h.service.editManualPayment(
      edit(
        h.payment.paymentId,
        {
          method: "bank_transfer",
          occurredAt: "2026-08-18T09:30:00+01:00",
          reason: "Paid by transfer, not cash",
        },
        "5a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      ),
    );
    const history = h.records.get(h.paymentPath)?.auditHistory as Array<Record<string, unknown>>;
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual(first);
    expect(history[1]).toMatchObject({
      reason: "Paid by transfer, not cash",
      previousValues: { method: "cash", occurredAt: now },
    });
    expect(h.records.get(h.paymentPath)).toMatchObject({
      method: "bank_transfer",
      occurredAt: "2026-08-18T08:30:00.000Z",
      amountMinor: 3000,
    });
  });

  it("replays the same request once and refuses the same request id with other details", async () => {
    const h = await paidInvoice();
    const input = edit(h.payment.paymentId, { amountMinor: 3000 });
    const first = await h.service.editManualPayment(input);
    await expect(h.service.editManualPayment(input)).resolves.toEqual(first);
    expect(h.records.get(h.paymentPath)?.auditHistory).toHaveLength(1);
    expect(h.audits.filter((audit) => audit.action === "payment.edited")).toHaveLength(1);
    await expect(
      h.service.editManualPayment({ ...input, amountMinor: 2000 }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses a manual reference already used by another payment", async () => {
    const h = await paidInvoice(5000, 3000);
    await h.service.recordManualPayment({
      academyId,
      actorId: "admin-1",
      invoiceId: h.invoice.invoiceId,
      amountMinor: 1000,
      method: "cash",
      manualReference: "CASH-EDIT-2",
      occurredAt: now,
    });
    await expect(
      h.service.editManualPayment(edit(h.payment.paymentId, { manualReference: "CASH-EDIT-2" })),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses course payments and payments on a void invoice", async () => {
    const h = await paidInvoice();
    const course = {
      ...h.records.get(h.paymentPath)!,
      schemaVersion: 2,
      method: "bank_transfer",
      payer: { kind: "family", familyId },
    };
    h.records.set(h.paymentPath, course);
    await expect(
      h.service.editManualPayment(edit(h.payment.paymentId, { amountMinor: 3000 })),
    ).rejects.toMatchObject({ code: "precondition" });
    const legacy = await paidInvoice();
    legacy.records.set(legacy.invoicePath, {
      ...legacy.records.get(legacy.invoicePath)!,
      status: "void",
      paidAt: null,
    });
    await expect(
      legacy.service.editManualPayment(edit(legacy.payment.paymentId, { amountMinor: 3000 })),
    ).rejects.toMatchObject({ code: "precondition" });
  });

  it("shares an invoice's total across its payments: no overpay, and a partial after lowering", async () => {
    const h = await paidInvoice(5000, 3000);
    const second = await h.service.recordManualPayment({
      academyId,
      actorId: "admin-1",
      invoiceId: h.invoice.invoiceId,
      amountMinor: 2000,
      method: "cash",
      manualReference: "CASH-EDIT-2",
      occurredAt: now,
    });
    await expect(
      h.service.editManualPayment(edit(second.paymentId, { amountMinor: 3000 })),
    ).rejects.toMatchObject({ message: "This change would overpay the invoice" });
    await expect(
      h.service.editManualPayment(edit(second.paymentId, { amountMinor: 1000 })),
    ).resolves.toMatchObject({ invoiceStatus: "partially_paid" });
    expect(h.records.get(h.invoicePath)).toMatchObject({ status: "partially_paid", paidAt: null });
  });

  it("refuses to edit a payment on a class (PAYG) invoice and writes nothing", async () => {
    const h = await paidInvoice();
    h.records.set(h.invoicePath, {
      ...h.records.get(h.invoicePath)!,
      chargeKind: "payg_session",
      sourceRef: `academies/${academyId}/sessions/session-1`,
    });
    const before = new Map(h.records);
    await expect(
      h.service.editManualPayment(edit(h.payment.paymentId, { amountMinor: 3000 })),
    ).rejects.toMatchObject({
      code: "precondition",
      message: "Class payments can't be edited. Void and reissue the invoice instead.",
    });
    expect(h.records).toEqual(before);
    expect(h.audits).toEqual([]);
  });

  it("keeps the edit history in office views and never sends it to a family reader", async () => {
    const h = await paidInvoice();
    await h.service.editManualPayment(edit(h.payment.paymentId, { amountMinor: 3000 }));
    const family = { academyId, familyIds: [familyId] };
    const office = { academyId, includeAuditHistory: true };
    const memberInvoice = await h.service.getInvoice(family, h.invoice.invoiceId);
    expect(memberInvoice.payments[0]).toMatchObject({ amountMinor: 3000 });
    expect(Object.hasOwn(memberInvoice.payments[0]!, "auditHistory")).toBe(false);
    const memberAccount = await h.service.listFinancialAccount(family);
    expect(Object.hasOwn(memberAccount.invoices[0]!.payments[0]!, "auditHistory")).toBe(false);
    const officeInvoice = await h.service.getInvoice(office, h.invoice.invoiceId);
    expect(officeInvoice.payments[0]?.auditHistory).toHaveLength(1);
    const officeAccount = await h.service.listFinancialAccount({
      ...office,
      familyIds: [familyId],
    });
    expect(officeAccount.invoices[0]!.payments[0]?.auditHistory).toHaveLength(1);
  });

  it("refuses to replay a receipt whose stored result is not this payment's", async () => {
    const h = await paidInvoice();
    const input = edit(h.payment.paymentId, { amountMinor: 3000 });
    await h.service.editManualPayment(input);
    const [receiptPath, receipt] = [...h.records].find(([path]) =>
      path.includes("/paymentEditReceipts/"),
    )!;
    h.records.set(receiptPath, {
      ...receipt,
      result: { paymentId: "payment-other", invoiceId: h.invoice.invoiceId, invoiceStatus: "paid" },
    });
    await expect(h.service.editManualPayment(input)).rejects.toMatchObject({ code: "invalid" });
    h.records.set(receiptPath, { ...receipt, result: { paymentId: h.payment.paymentId } });
    await expect(h.service.editManualPayment(input)).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("payment edits and the membership they pay for", () => {
  const membershipPathFor = `academies/${academyId}/memberships/${membershipId}`;
  const membership = {
    membershipId,
    academyId,
    familyId,
    studentId: "student-1",
    planId: "payg",
    status: "active",
    startsAt: now,
    endsAt: null,
    nextBillingAt: null,
    schemaVersion: "1",
    createdAt: now,
    createdBy: "admin-1",
    updatedAt: now,
    updatedBy: "admin-1",
  };

  async function scenario(amountMinor: number, status: "active" | "overdue") {
    const h = store({ ...seedSources(), [membershipPathFor]: membership });
    const invoice = await h.service.issueManualInvoice({
      academyId,
      actorId: "admin-1",
      familyId,
      membershipId,
      totalMinor: 5000,
      dueAt: now,
      chargeKind: "membership",
      invoiceReference: "SUBSCRIPTION-M",
      description: "Monthly subscription",
    });
    const payment = await h.service.recordManualPayment({
      academyId,
      actorId: "admin-1",
      invoiceId: invoice.invoiceId,
      amountMinor,
      method: "cash",
      manualReference: "CASH-M-1",
      occurredAt: now,
    });
    h.records.set(membershipPathFor, { ...membership, status });
    h.audits.length = 0;
    return { ...h, payment };
  }

  const reason = "Cash was miscounted at the desk";

  it("brings an overdue subscription back once an edit pays its invoice in full", async () => {
    const h = await scenario(3000, "overdue");
    await h.service.editManualPayment({
      academyId,
      actorId: "admin-1",
      actorName: "Ana Office",
      paymentId: h.payment.paymentId,
      amountMinor: 5000,
      reason,
      requestId: "3c9e1f2a-7b4d-4e8f-9a1b-2c3d4e5f6a7b",
    });
    expect(h.records.get(membershipPathFor)).toMatchObject({
      status: "active",
      updatedBy: "admin-1",
    });
    expect(h.audits.map((audit) => audit.action).sort()).toEqual([
      "invoice.status.changed",
      "membership.status.changed",
      "payment.edited",
    ]);
  });

  it("never marks a subscription overdue when an edit lowers a paid invoice", async () => {
    const h = await scenario(5000, "active");
    await h.service.editManualPayment({
      academyId,
      actorId: "admin-1",
      actorName: "Ana Office",
      paymentId: h.payment.paymentId,
      amountMinor: 2000,
      reason,
      requestId: "4d0f2a3b-8c5e-4f9a-8b2c-3d4e5f6a7b8c",
    });
    expect(h.records.get(membershipPathFor)).toMatchObject({ status: "active" });
    expect(h.audits.map((audit) => audit.action)).not.toContain("membership.status.changed");
  });
});
