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
  const audits: FinanceAuditDraft[] = [];
  const firestore: FinanceFirestore = {
    doc: (path) => ref(path),
    collection: (path) => ({
      doc: (id?: string) => ref(`${path}/${id ?? "generated"}`),
      get: async () => ({
        docs: [...records.entries()]
          .filter(([recordPath]) => recordPath.startsWith(`${path}/`))
          .map(([recordPath, data]) => ({ ...ref(recordPath), exists: true, data: () => data })),
      }),
      where: (field, _operator, value) => ({ path, field, value }),
    }),
    runTransaction: async (callback) => {
      const snapshot = new Map(records);
      const transaction = {
        get: async (target: Ref | Query) => {
          if ("field" in target) {
            return {
              docs: [...records.entries()]
                .filter(
                  ([recordPath, data]) =>
                    recordPath.startsWith(`${target.path}/`) && data[target.field] === target.value,
                )
                .map(([recordPath, data]) => ({
                  ...ref(recordPath),
                  exists: true,
                  data: () => data,
                })),
            };
          }
          const data = records.get(target.path);
          return { ...ref(target.path), exists: data !== undefined, data: () => data };
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
  return { firestore, records, writes, audits };
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
});
