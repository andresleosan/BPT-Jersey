import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  savePaymentInstructions: vi.fn(),
  formatSortCode: (sortCode: string) =>
    `${sortCode.slice(0, 2)}-${sortCode.slice(2, 4)}-${sortCode.slice(4, 6)}`,
}));
vi.mock("../../../lib/billing-client", () => api);

import { PaymentInstructionsPanel } from "./payment-instructions-panel";

const published = {
  accountName: "BPT Jersey",
  sortCode: "402530",
  accountNumber: "12345678",
  bankName: "Synthetic Bank",
  referenceHint: "Quote your invoice reference",
  acceptsCash: true,
};

describe("payment instructions panel (T010/T035 re-scope)", () => {
  beforeEach(() => {
    api.savePaymentInstructions.mockResolvedValue(published);
  });

  afterEach(() => {
    cleanup();
    api.savePaymentInstructions.mockReset();
  });

  it("says there is no gateway and shows the unconfigured state", () => {
    render(<PaymentInstructionsPanel current={null} onSaved={() => undefined} />);
    expect(screen.getByText(/no card gateway in the pilot/i)).toBeVisible();
    expect(screen.getByText("Not configured")).toBeVisible();
    expect(screen.getByLabelText("Account name")).toHaveValue("");
  });

  it("prefills what office already published, with the sort code formatted", () => {
    render(<PaymentInstructionsPanel current={published} onSaved={() => undefined} />);
    expect(screen.getByText("Published")).toBeVisible();
    expect(screen.getByLabelText("Sort code")).toHaveValue("40-25-30");
    expect(screen.getByLabelText("Account number")).toHaveValue("12345678");
    expect(screen.getByLabelText("Bank (optional)")).toHaveValue("Synthetic Bank");
    expect(screen.getByLabelText("Cash is accepted at reception")).toBeChecked();
  });

  it("saves what office typed, sends an empty bank as null, then reloads the account", async () => {
    const onSaved = vi.fn();
    render(<PaymentInstructionsPanel current={null} onSaved={onSaved} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Account name"), "BPT Jersey");
    await user.type(screen.getByLabelText("Sort code"), "40 25 30");
    await user.type(screen.getByLabelText("Account number"), "12345678");
    await user.click(screen.getByLabelText("Cash is accepted at reception"));
    await user.click(screen.getByRole("button", { name: "Save payment instructions" }));

    await waitFor(() =>
      expect(api.savePaymentInstructions).toHaveBeenCalledWith({
        accountName: "BPT Jersey",
        sortCode: "40 25 30",
        accountNumber: "12345678",
        bankName: null,
        referenceHint: "Quote your invoice reference",
        acceptsCash: false,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Members see them");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("reports the safe error and leaves the form editable", async () => {
    api.savePaymentInstructions.mockImplementation(() =>
      Promise.reject(
        new Error("Unable to save the payment instructions. Check the details and try again."),
      ),
    );
    render(<PaymentInstructionsPanel current={published} onSaved={() => undefined} />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Save payment instructions" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to save");
    expect(screen.getByRole("button", { name: "Save payment instructions" })).toBeEnabled();
  });
});
