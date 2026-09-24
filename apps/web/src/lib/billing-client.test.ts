import { beforeEach, describe, expect, it, vi } from "vitest";

const callable = vi.hoisted(() => vi.fn());
vi.mock("firebase/functions", () => ({ httpsCallable: () => callable }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import {
  editManualPayment,
  issueManualInvoice,
  listFinancialAccount,
  savePaymentInstructions,
} from "./billing-client";

const instructions = {
  accountName: "BPT Jersey",
  sortCode: "402530",
  accountNumber: "12345678",
  bankName: null,
  referenceHint: "Quote your invoice reference",
  acceptsCash: true,
};

describe("billing client payment instructions (T010/T035 re-scope)", () => {
  beforeEach(() => {
    // Block body on purpose: an arrow returning the mock makes Vitest treat it as the hook's
    // teardown and call it after the test.
    callable.mockReset();
  });

  it("reads the instructions with the account and drops the record envelope", async () => {
    callable.mockResolvedValue({
      data: {
        invoices: [],
        balanceMinor: 0,
        paygDebtMinor: 0,
        paymentInstructions: {
          ...instructions,
          academyId: "academy-1",
          schemaVersion: 1,
          updatedAt: "2026-09-06T10:00:00.000Z",
          updatedBy: "owner-1",
        },
      },
    });
    const account = await listFinancialAccount();
    expect(account.paymentInstructions).toEqual(instructions);
    expect(Object.keys(account.paymentInstructions ?? {})).not.toContain("updatedBy");
  });

  it("accepts null instructions and refuses a malformed set", async () => {
    callable.mockResolvedValue({
      data: { invoices: [], balanceMinor: 0, paygDebtMinor: 0, paymentInstructions: null },
    });
    await expect(listFinancialAccount()).resolves.toMatchObject({ paymentInstructions: null });

    for (const bad of [
      { ...instructions, sortCode: "40-25-30" },
      { ...instructions, accountNumber: "1234" },
      { ...instructions, acceptsCash: "yes" },
      "12345678",
    ]) {
      callable.mockResolvedValue({
        data: { invoices: [], balanceMinor: 0, paygDebtMinor: 0, paymentInstructions: bad },
      });
      await expect(listFinancialAccount()).rejects.toThrow("Unable to load the billing account");
    }
  });

  it("still refuses an account payload without the field, so an old backend cannot pass", async () => {
    callable.mockResolvedValue({ data: { invoices: [], balanceMinor: 0, paygDebtMinor: 0 } });
    await expect(listFinancialAccount()).rejects.toThrow("Unable to load the billing account");
  });

  it("saves and returns the normalised record without leaking the failure", async () => {
    callable.mockResolvedValue({ data: { ...instructions, academyId: "academy-1" } });
    await expect(savePaymentInstructions({ ...instructions, sortCode: "40-25-30" })).resolves.toEqual(
      instructions,
    );
    callable.mockImplementation(() => {
      throw new Error("FIRESTORE precondition academies/academy-1/settings");
    });
    await expect(savePaymentInstructions(instructions)).rejects.toThrow(
      "Unable to save the payment instructions",
    );
  });

  it("issues an invoice with membershipId null", async () => {
    const validInvoice = {
      invoiceId: "invoice-1",
      academyId: "academy-1",
      familyId: "f1",
      membershipId: null,
      status: "open",
      totalMinor: 1500,
      currency: "GBP",
      dueAt: "2026-10-01T23:59:59.000Z",
      paidAt: null,
      schemaVersion: 1,
      createdAt: "2026-09-15T00:00:00.000Z",
      createdBy: "admin-1",
      updatedAt: "2026-09-15T00:00:00.000Z",
      updatedBy: "admin-1",
      chargeKind: "manual_adjustment",
      sourceRef: null,
      invoiceReference: "INV-1",
      description: "Seminar",
    };
    callable.mockResolvedValueOnce({ data: { ...validInvoice, membershipId: null } });
    await expect(
      issueManualInvoice({
        familyId: "f1",
        membershipId: null,
        totalMinor: 1500,
        dueAt: "2026-10-01T23:59:59.000Z",
        chargeKind: "manual_adjustment",
        invoiceReference: "INV-1",
        description: "Seminar",
      }),
    ).resolves.toMatchObject({ membershipId: null });
  });
});

describe("billing client payment edits", () => {
  const edit = {
    paymentId: "payment-1",
    amountMinor: 3000,
    reason: "Cash was miscounted at the desk",
    requestId: "0b8f7c52-3d5e-4c8a-9f1e-2a7b6c5d4e3f",
  };

  beforeEach(() => {
    callable.mockReset();
  });

  it("sends only the parsed edit and returns the invoice's new status", async () => {
    callable.mockResolvedValue({
      data: { paymentId: "payment-1", invoiceId: "invoice-1", invoiceStatus: "partially_paid" },
    });
    await expect(editManualPayment(edit)).resolves.toEqual({
      ok: true,
      invoiceStatus: "partially_paid",
    });
    expect(callable).toHaveBeenCalledWith(edit);
  });

  it("refuses a short reason without calling the backend", async () => {
    await expect(editManualPayment({ ...edit, reason: "too short" })).resolves.toEqual({
      ok: false,
      message: "Give a reason of at least 10 characters.",
    });
    expect(callable).not.toHaveBeenCalled();
  });

  it("shows the overpayment refusal and hides any other backend wording", async () => {
    callable.mockRejectedValueOnce({
      code: "functions/failed-precondition",
      message: "This change would overpay the invoice",
    });
    await expect(editManualPayment(edit)).resolves.toEqual({
      ok: false,
      message: "This change would overpay the invoice",
    });
    callable.mockRejectedValueOnce({
      code: "functions/internal",
      message: "FirebaseError: stack trace at firestore.googleapis.com",
    });
    await expect(editManualPayment(edit)).resolves.toEqual({
      ok: false,
      message: "Unable to save the payment change. Refresh and try again.",
    });
  });

  it("refuses a response for another payment", async () => {
    callable.mockResolvedValue({
      data: { paymentId: "payment-2", invoiceId: "invoice-1", invoiceStatus: "paid" },
    });
    await expect(editManualPayment(edit)).resolves.toEqual({
      ok: false,
      message: "Unable to save the payment change. Refresh and try again.",
    });
  });
});
