import { describe, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import type { UserActorContext } from "@bpt-jersey/domain";
import type { GuardianFamilyProjection } from "@bpt-jersey/domain/families";

import {
  FinanceCallableError,
  editManualPaymentCallableOptions,
  editManualPaymentHandler,
  financeCallableOptions,
  getFamilyFinancialAccountHandler,
  getInvoiceHandler,
  issueManualInvoiceHandler,
  listFinancialAccountHandler,
  listRecentPaymentsHandler,
  savePaymentInstructionsHandler,
  recordManualPaymentHandler,
  voidManualInvoiceHandler,
  type FinanceCallableServices,
} from "./finance-callables.js";
import { FinanceStoreError, type FinanceStore } from "./finance-service.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";

const academyId = "academy-1";

function actor(role: UserActorContext["role"], userId = `${role}-1`): UserActorContext {
  return {
    kind: "user",
    userId: userId as UserActorContext["userId"],
    academyId: academyId as UserActorContext["academyId"],
    role,
  };
}

function request(data: unknown, user: UserActorContext | undefined): CallableRequest<unknown> {
  return {
    data,
    rawRequest: {} as CallableRequest<unknown>["rawRequest"],
    auth:
      user === undefined
        ? undefined
        : {
            uid: user.userId,
            token: { academyId: user.academyId, role: user.role },
          },
  } as unknown as CallableRequest<unknown>;
}

function guardianFamily(): GuardianFamilyProjection {
  return {
    family: {
      familyId: "family-1",
      active: true,
      status: "active",
    },
    tutor: {
      userId: "guardian-1",
      displayName: "Guardian",
      email: "guardian@example.com",
      phoneNumber: "01534123456",
    },
    students: [],
  };
}

function services(overrides: Partial<FinanceCallableServices> = {}): FinanceCallableServices {
  const store = {
    issueManualInvoice: vi.fn(),
    issuePaygInvoice: vi.fn(),
    recordManualPayment: vi.fn(),
    editManualPayment: vi.fn(),
    voidManualInvoice: vi.fn(),
    listFinancialAccount: vi.fn().mockResolvedValue({
      invoices: [],
      balanceMinor: 0,
      paygDebtMinor: 0,
      paymentInstructions: null,
    }),
    getInvoice: vi.fn(),
    savePaymentInstructions: vi.fn().mockResolvedValue({ accountNumber: "12345678" }),
    listRecentPayments: vi.fn().mockResolvedValue([]),
  } as unknown as FinanceStore;
  return {
    store,
    familyStore: {
      getGuardianFamily: vi.fn().mockResolvedValue(guardianFamily()),
    },
    findStudentByUserId: vi.fn().mockResolvedValue({
      studentId: "student-1",
      familyId: "family-1",
      participantType: "adult",
      active: true,
      status: "active",
    }),
    isActorActive: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("finance callables", () => {
  it("requires App Check on every finance wrapper", () => {
    expect(financeCallableOptions).toEqual({
      enforceAppCheck: true,
      consumeAppCheckToken: true,
    });
  });

  it("accepts the exact manual invoice payload for administrators", async () => {
    const finance = services();
    const store = finance.store as unknown as { issueManualInvoice: ReturnType<typeof vi.fn> };
    store.issueManualInvoice.mockResolvedValue({ invoiceId: "invoice-1", status: "open" });

    await expect(
      issueManualInvoiceHandler(
        request(
          {
            familyId: "family-1",
            membershipId: "membership-1",
            totalMinor: 1000,
            dueAt: "2026-08-19T10:00:00Z",
            chargeKind: "membership",
            invoiceReference: "invoice-reference-1",
            description: "Membership invoice",
          },
          actor("administrator"),
        ),
        finance,
      ),
    ).resolves.toMatchObject({ invoiceId: "invoice-1" });
    expect(store.issueManualInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ academyId, actorId: "administrator-1" }),
    );
  });

  it("rejects extra fields and public PAYG source fields before calling the store", async () => {
    const finance = services();
    const store = finance.store as unknown as { issueManualInvoice: ReturnType<typeof vi.fn> };
    const base = {
      familyId: "family-1",
      membershipId: "membership-1",
      totalMinor: 1000,
      dueAt: "2026-08-19T10:00:00Z",
      chargeKind: "membership",
      invoiceReference: "invoice-reference-1",
      description: "Membership invoice",
    };

    await expect(
      issueManualInvoiceHandler(request({ ...base, actorId: "attacker" }, actor("owner")), finance),
    ).rejects.toMatchObject({
      code: "invalid-argument",
    });
    await expect(
      issueManualInvoiceHandler(
        request(
          { ...base, chargeKind: "payg_session", sourceRef: "academies/academy-1/sessions/s-1" },
          actor("owner"),
        ),
        finance,
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(store.issueManualInvoice).not.toHaveBeenCalled();
  });

  it("allows only administrators to record payments and void invoices", async () => {
    const finance = services();
    const store = finance.store as unknown as {
      recordManualPayment: ReturnType<typeof vi.fn>;
      voidManualInvoice: ReturnType<typeof vi.fn>;
    };
    store.recordManualPayment.mockResolvedValue({ paymentId: "payment-1" });
    store.voidManualInvoice.mockResolvedValue({ invoiceId: "invoice-1", status: "void" });

    await expect(
      recordManualPaymentHandler(
        request(
          {
            invoiceId: "invoice-1",
            amountMinor: 1000,
            method: "cash",
            manualReference: "cash-reference-1",
            occurredAt: "2026-08-19T10:00:00Z",
          },
          actor("administrator"),
        ),
        finance,
      ),
    ).resolves.toMatchObject({ paymentId: "payment-1" });
    await expect(
      voidManualInvoiceHandler(request({ invoiceId: "invoice-1" }, actor("owner")), finance),
    ).resolves.toMatchObject({ status: "void" });
    await expect(
      recordManualPaymentHandler(
        request(
          {
            invoiceId: "invoice-1",
            amountMinor: 1000,
            method: "cash",
            manualReference: "cash-reference-2",
            occurredAt: "2026-08-19T10:00:00Z",
          },
          actor("coach"),
        ),
        finance,
      ),
    ).rejects.toBeInstanceOf(FinanceCallableError);
  });

  it("limits guardian reads to the linked family and denies cross-tenant actors", async () => {
    const finance = services();
    const store = finance.store as unknown as { listFinancialAccount: ReturnType<typeof vi.fn> };

    await listFinancialAccountHandler(request(null, actor("guardian", "guardian-1")), finance);
    expect(store.listFinancialAccount).toHaveBeenCalledWith({
      academyId,
      familyIds: ["family-1"],
    });
    await expect(
      listFinancialAccountHandler(request(null, actor("coach")), finance),
    ).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("limits adult reads to the resolved student family", async () => {
    const finance = services();
    const store = finance.store as unknown as { getInvoice: ReturnType<typeof vi.fn> };
    store.getInvoice.mockResolvedValue({
      invoice: { invoiceId: "invoice-1" },
      balanceMinor: 0,
      payments: [],
    });

    await getInvoiceHandler(
      request({ invoiceId: "invoice-1" }, actor("adultStudent", "adult-1")),
      finance,
    );
    expect(store.getInvoice).toHaveBeenCalledWith(
      { academyId, familyIds: ["family-1"], studentIds: ["student-1"] },
      "invoice-1",
    );
  });

  it("maps store errors to safe callable errors", async () => {
    const finance = services();
    const store = finance.store as unknown as { recordManualPayment: ReturnType<typeof vi.fn> };
    store.recordManualPayment.mockRejectedValue(new Error("Firestore path and financial payload"));

    await expect(
      recordManualPaymentHandler(
        request(
          {
            invoiceId: "invoice-1",
            amountMinor: 1000,
            method: "cash",
            manualReference: "cash-reference-1",
            occurredAt: "2026-08-19T10:00:00Z",
          },
          actor("administrator"),
        ),
        finance,
      ),
    ).rejects.toMatchObject({
      code: "internal",
      message: expect.not.stringContaining("Firestore"),
    });
  });
});

describe("savePaymentInstructions (T010/T035 re-scope)", () => {
  const payload = {
    accountName: "BPT Jersey",
    sortCode: "40-25-30",
    accountNumber: "12345678",
    bankName: null,
    referenceHint: "Quote your invoice reference",
    acceptsCash: true,
  };

  it("lets office save the normalised details with the actor attached", async () => {
    const finance = services();
    const store = finance.store as unknown as {
      savePaymentInstructions: ReturnType<typeof vi.fn>;
    };
    await savePaymentInstructionsHandler(request(payload, actor("owner", "owner-1")), finance);
    expect(store.savePaymentInstructions).toHaveBeenCalledWith({
      academyId: "academy-1",
      actorId: "owner-1",
      instructions: { ...payload, sortCode: "402530" },
    });
  });

  it("refuses every role that is not office", async () => {
    for (const role of ["headCoach", "coach", "guardian", "adultStudent"] as const) {
      await expect(
        savePaymentInstructionsHandler(request(payload, actor(role, "user-1")), services()),
      ).rejects.toMatchObject({ code: "permission-denied" });
    }
  });

  it("refuses a malformed payload before touching the store", async () => {
    const finance = services();
    for (const bad of [
      null,
      {},
      { ...payload, accountNumber: "1234" },
      { ...payload, iban: "GB00" },
      { ...payload, acceptsCash: "yes" },
    ]) {
      await expect(
        savePaymentInstructionsHandler(request(bad, actor("owner", "owner-1")), finance),
      ).rejects.toMatchObject({ code: "invalid-argument" });
    }
    const store = finance.store as unknown as { savePaymentInstructions: ReturnType<typeof vi.fn> };
    expect(store.savePaymentInstructions).not.toHaveBeenCalled();
  });

  it("issues an invoice with membershipId null and rejects a missing key", async () => {
    const s = services();
    (s.store.issueManualInvoice as ReturnType<typeof vi.fn>).mockResolvedValue({ invoiceId: "i1" });
    const payload = {
      familyId: "family-1",
      membershipId: null,
      totalMinor: 1500,
      dueAt: "2026-10-01T23:59:59.000Z",
      chargeKind: "manual_adjustment",
      invoiceReference: "INV-SEM-1",
      description: "Seminar",
    };
    await expect(issueManualInvoiceHandler(request(payload, actor("owner")), s)).resolves.toEqual({
      invoiceId: "i1",
    });
    expect(s.store.issueManualInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ membershipId: null }),
    );
    const missing: Record<string, unknown> = { ...payload };
    delete missing.membershipId;
    await expect(
      issueManualInvoiceHandler(request(missing, actor("owner")), s),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("rejects a membership charge with no membershipId", async () => {
    const s = services();
    const payload = {
      familyId: "family-1",
      membershipId: null,
      totalMinor: 1500,
      dueAt: "2026-10-01T23:59:59.000Z",
      chargeKind: "membership",
      invoiceReference: "INV-MEM-1",
      description: "Membership charge",
    };
    await expect(
      issueManualInvoiceHandler(request(payload, actor("owner")), s),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    const store = s.store as unknown as { issueManualInvoice: ReturnType<typeof vi.fn> };
    expect(store.issueManualInvoice).not.toHaveBeenCalled();
  });

  it("lists recent payments for office roles only", async () => {
    const s = services();
    await expect(
      listRecentPaymentsHandler(request(null, actor("administrator")), s),
    ).resolves.toEqual({ payments: [] });
    expect(s.store.listRecentPayments).toHaveBeenCalledWith(academyId, 20);
    await expect(listRecentPaymentsHandler(request(null, actor("coach")), s)).rejects.toMatchObject(
      { code: "permission-denied" },
    );
    await expect(listRecentPaymentsHandler(request({}, actor("owner")), s)).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("reads one family's account for the office and refuses guardians", async () => {
    const s = services();
    await expect(
      getFamilyFinancialAccountHandler(request({ familyId: "family-9" }, actor("owner")), s),
    ).resolves.toMatchObject({ invoices: [] });
    expect(s.store.listFinancialAccount).toHaveBeenCalledWith({
      academyId,
      familyIds: ["family-9"],
    });
    await expect(
      getFamilyFinancialAccountHandler(request({ familyId: "family-9" }, actor("guardian")), s),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      getFamilyFinancialAccountHandler(request({ familyId: "bad id" }, actor("owner")), s),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  describe("editManualPayment", () => {
    const valid = {
      paymentId: "payment-1",
      amountMinor: 3000,
      reason: "Cash was miscounted at the desk",
      requestId: "0b8f7c52-3d5e-4c8a-9f1e-2a7b6c5d4e3f",
    };

    function editServices(name: string | null = "Ana Office") {
      const finance = services({ actorDisplayName: vi.fn().mockResolvedValue(name) });
      const store = finance.store as unknown as { editManualPayment: ReturnType<typeof vi.fn> };
      store.editManualPayment.mockResolvedValue({
        paymentId: "payment-1",
        invoiceId: "invoice-1",
        invoiceStatus: "partially_paid",
      });
      return { finance, store };
    }

    it("passes the parsed edit, the actor and the actor's name to the store", async () => {
      const { finance, store } = editServices();
      await expect(
        editManualPaymentHandler(request(valid, actor("owner")), finance),
      ).resolves.toEqual({
        paymentId: "payment-1",
        invoiceId: "invoice-1",
        invoiceStatus: "partially_paid",
      });
      expect(store.editManualPayment).toHaveBeenCalledWith({
        ...valid,
        academyId,
        actorId: "owner-1",
        actorName: "Ana Office",
      });
    });

    it("falls back to Office when the actor has no display name", async () => {
      const { finance, store } = editServices(null);
      await editManualPaymentHandler(request(valid, actor("administrator")), finance);
      expect(store.editManualPayment).toHaveBeenCalledWith(
        expect.objectContaining({ actorName: "Office" }),
      );
    });

    it.each([
      ["a nine-character reason", { ...valid, reason: "too short" }],
      [
        "no editable field",
        { paymentId: "payment-1", reason: valid.reason, requestId: valid.requestId },
      ],
      ["an extra field", { ...valid, invoiceId: "invoice-2" }],
      ["a request id that is not a uuid", { ...valid, requestId: "request-1" }],
    ])("rejects %s before calling the store", async (_label, data) => {
      const { finance, store } = editServices();
      await expect(
        editManualPaymentHandler(request(data, actor("owner")), finance),
      ).rejects.toMatchObject({ code: "invalid-argument" });
      expect(store.editManualPayment).not.toHaveBeenCalled();
    });

    it.each(["coach", "headCoach", "guardian", "adultStudent"] as const)(
      "denies a %s",
      async (role) => {
        const { finance, store } = editServices();
        await expect(
          editManualPaymentHandler(request(valid, actor(role)), finance),
        ).rejects.toMatchObject({ code: "permission-denied" });
        expect(store.editManualPayment).not.toHaveBeenCalled();
      },
    );

    it("tells the office plainly when the edit would overpay the invoice", async () => {
      const { finance, store } = editServices();
      store.editManualPayment.mockRejectedValue(
        new FinanceStoreError("precondition", "This change would overpay the invoice"),
      );
      await expect(
        editManualPaymentHandler(request(valid, actor("owner")), finance),
      ).rejects.toMatchObject({
        code: "failed-precondition",
        message: "This change would overpay the invoice",
      });
    });

    it("uses the browser admin options with single-use App Check tokens", () => {
      expect(editManualPaymentCallableOptions).toEqual({
        ...browserAdminCallableOptions,
        consumeAppCheckToken: true,
      });
    });
  });
});
