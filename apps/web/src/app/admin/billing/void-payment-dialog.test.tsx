import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VoidPaymentDialog } from "./void-payment-dialog";

const payment = {
  paymentId: "payment-1",
  amountMinor: 9500,
  occurredAt: "2026-09-12T10:00:00.000Z",
} as const;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function renderDialog(
  voidPayment = vi.fn().mockResolvedValue({ ok: true, invoiceStatus: "open" }),
  memberLabel = "Ana Coelho",
) {
  const onClose = vi.fn();
  const onVoided = vi.fn();
  render(
    <VoidPaymentDialog
      memberLabel={memberLabel}
      onClose={onClose}
      onVoided={onVoided}
      payment={payment}
      voidPayment={voidPayment}
    />,
  );
  return { voidPayment, onClose, onVoided };
}

function reasonBox() {
  return screen.getByRole("textbox", { name: /reason for voiding/i });
}

function submitButton() {
  return screen.getByRole("button", { name: /void payment/i });
}

describe("void payment dialog", () => {
  afterEach(cleanup);

  it("shows the heading, amount, member and the plan-dates warning", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Void payment" })).toBeTruthy();
    expect(screen.getByText(/£95\.00/)).toBeTruthy();
    expect(screen.getByText("Ana Coelho")).toBeTruthy();
    expect(
      screen.getByText(
        "Voiding does not change the member's plan dates. Fix those in the Plan tab if needed.",
      ),
    ).toBeTruthy();
  });

  it("keeps submit disabled until the reason has ten characters and counts them", () => {
    renderDialog();
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(reasonBox(), { target: { value: "  too short  " } });
    expect(screen.getByText(/^9\/280/)).toBeTruthy();
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(reasonBox(), { target: { value: "Duplicate entry" } });
    expect(screen.getByText(/^15\/280/)).toBeTruthy();
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("voids once with a request id and reports success", async () => {
    let resolve: (value: { ok: true; invoiceStatus: "open" }) => void = () => {};
    const voidPayment = vi.fn(
      () =>
        new Promise<{ ok: true; invoiceStatus: "open" }>((done) => {
          resolve = done;
        }),
    );
    const { onVoided } = renderDialog(voidPayment);
    fireEvent.change(reasonBox(), { target: { value: "  Recorded twice by mistake  " } });
    fireEvent.click(submitButton());
    fireEvent.click(screen.getByRole("button", { name: /voiding/i }));
    expect(voidPayment).toHaveBeenCalledTimes(1);
    const [input] = voidPayment.mock.calls[0] as unknown as [
      { paymentId: string; reason: string; requestId: string },
    ];
    expect(input.paymentId).toBe("payment-1");
    expect(input.reason).toBe("Recorded twice by mistake");
    expect(input.requestId).toMatch(uuidPattern);
    resolve({ ok: true, invoiceStatus: "open" });
    await waitFor(() => expect(onVoided).toHaveBeenCalledTimes(1));
  });

  it("shows the failure message and stays open", async () => {
    const voidPayment = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "Payment already voided." });
    const { onVoided } = renderDialog(voidPayment);
    fireEvent.change(reasonBox(), { target: { value: "Recorded twice by mistake" } });
    fireEvent.click(submitButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Payment already voided.");
    expect(onVoided).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Void payment" })).toBeTruthy();
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders the member label as text", () => {
    renderDialog(undefined, "<img src=x onerror=alert(1)>");
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(document.querySelector("dialog img")).toBeNull();
  });
});
