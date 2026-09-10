import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listFinancialAccount: vi.fn(),
  formatSortCode: (sortCode: string) =>
    `${sortCode.slice(0, 2)}-${sortCode.slice(2, 4)}-${sortCode.slice(4, 6)}`,
}));
vi.mock("../../../lib/client-auth", () => ({
  ClientAuthGate: ({ children }: { children: React.ReactNode }) => children,
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../../lib/billing-client", () => api);

import BillingPage from "./page";

const instructions = {
  accountName: "BPT Jersey",
  sortCode: "402530",
  accountNumber: "12345678",
  bankName: "Synthetic Bank",
  referenceHint: "Quote your invoice reference",
  acceptsCash: true,
};

function account(overrides: Record<string, unknown> = {}) {
  return {
    invoices: [],
    balanceMinor: 1_500,
    paygDebtMinor: 0,
    paymentInstructions: instructions,
    ...overrides,
  };
}

describe("member billing page (T010/T035 re-scope)", () => {
  beforeEach(() => {
    api.listFinancialAccount.mockResolvedValue(account());
  });

  afterEach(() => {
    cleanup();
    api.listFinancialAccount.mockReset();
  });

  it("tells a member with a balance exactly where to transfer", async () => {
    render(<BillingPage />);
    expect(await screen.findByRole("heading", { name: "How to pay" })).toBeVisible();
    expect(screen.getByText("40-25-30")).toBeVisible();
    expect(screen.getByText("12345678")).toBeVisible();
    expect(screen.getByText("Synthetic Bank")).toBeVisible();
    expect(screen.getByText("Quote your invoice reference")).toBeVisible();
    expect(screen.getByText("Accepted at reception")).toBeVisible();
  });

  it("says plainly when office has not published bank details yet", async () => {
    api.listFinancialAccount.mockResolvedValue(account({ paymentInstructions: null }));
    render(<BillingPage />);
    await screen.findByRole("heading", { name: "How to pay" });
    expect(screen.getByText(/has not published bank details yet/)).toBeVisible();
  });

  it("does not show payment details to a member who owes nothing", async () => {
    api.listFinancialAccount.mockResolvedValue(account({ balanceMinor: 0 }));
    render(<BillingPage />);
    expect(await screen.findByText("No invoices yet")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "How to pay" })).toBeNull();
    expect(screen.queryByText("12345678")).toBeNull();
  });

  it("omits the bank line when none was given and reports cash not accepted", async () => {
    api.listFinancialAccount.mockResolvedValue(
      account({ paymentInstructions: { ...instructions, bankName: null, acceptsCash: false } }),
    );
    render(<BillingPage />);
    await screen.findByRole("heading", { name: "How to pay" });
    expect(screen.queryByText("Bank")).toBeNull();
    expect(screen.getByText("Not accepted")).toBeVisible();
  });
});
