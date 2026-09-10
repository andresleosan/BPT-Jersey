import { beforeEach, describe, expect, it, vi } from "vitest";

const callable = vi.hoisted(() => vi.fn());
vi.mock("firebase/functions", () => ({ httpsCallable: () => callable }));
vi.mock("./firebase-client", () => ({ getFirebaseFunctions: () => ({}) }));

import { listFinancialAccount, savePaymentInstructions } from "./billing-client";

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
});
