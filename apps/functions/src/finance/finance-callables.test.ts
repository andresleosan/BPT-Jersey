import { describe, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

import type { UserActorContext } from "@bpt-jersey/domain";
import type { GuardianFamilyProjection } from "@bpt-jersey/domain/families";

import {
  FinanceCallableError,
  financeCallableOptions,
  getInvoiceHandler,
  issueManualInvoiceHandler,
  listFinancialAccountHandler,
  savePaymentInstructionsHandler,
  recordManualPaymentHandler,
  voidManualInvoiceHandler,
  type FinanceCallableServices,
} from "./finance-callables.js";
import type { FinanceStore } from "./finance-service.js";

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
    voidManualInvoice: vi.fn(),
    listFinancialAccount: vi.fn().mockResolvedValue({
      invoices: [],
      balanceMinor: 0,
      paygDebtMinor: 0,
      paymentInstructions: null,
    }),
    getInvoice: vi.fn(),
    savePaymentInstructions: vi.fn().mockResolvedValue({ accountNumber: "12345678" }),
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
});
