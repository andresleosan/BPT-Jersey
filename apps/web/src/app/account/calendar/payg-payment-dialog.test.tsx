import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionRecord } from "@bpt-jersey/domain/schedule";

const schedule = vi.hoisted(() => ({ uploadPaygClassProof: vi.fn() }));
vi.mock("../../../lib/schedule-client", () => schedule);
const enrolment = vi.hoisted(() => ({ getEnrolmentPaymentInstructions: vi.fn() }));
vi.mock("../../../lib/enrolment-client", () => enrolment);

import { PaygPaymentDialog } from "./payg-payment-dialog";

const session: SessionRecord = {
  sessionId: "s-payg",
  academyId: "bpt-jersey",
  classId: null,
  programId: "prog-adult",
  locationId: "west",
  instructorId: "coach-1",
  title: "Adults BJJ",
  startAt: "2026-09-24T17:00:00.000Z",
  endAt: "2026-09-24T18:00:00.000Z",
  capacity: 20,
  minParticipants: 4,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  schemaVersion: "1",
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: "fixture",
  updatedAt: "2026-09-01T00:00:00.000Z",
  updatedBy: "fixture",
};

function renderDialog(props: Partial<Parameters<typeof PaygPaymentDialog>[0]> = {}) {
  const onChoose = vi.fn();
  const onClose = vi.fn();
  render(
    <PaygPaymentDialog
      onChoose={onChoose}
      onClose={onClose}
      priceMinor={1000}
      session={session}
      studentId="student-1"
      {...props}
    />,
  );
  return { onChoose, onClose };
}

const screenshot = () =>
  new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "transfer.png", {
    type: "image/png",
  });

describe("PaygPaymentDialog", () => {
  beforeEach(() => {
    enrolment.getEnrolmentPaymentInstructions.mockResolvedValue({
      accountName: "BPT Jersey",
      sortCode: "000000",
      accountNumber: "00000000",
      bankName: "Synthetic Bank",
      referenceHint: "Your name",
      acceptsCash: true,
    });
    schedule.uploadPaygClassProof.mockResolvedValue("b".repeat(64));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("chooses paying at the academy without uploading anything", async () => {
    const { onChoose } = renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "Pay at the academy" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith({ method: "at_venue" }));
    expect(schedule.uploadPaygClassProof).not.toHaveBeenCalled();
  });

  it("keeps Continue disabled until a bank transfer screenshot is attached", async () => {
    renderDialog();
    expect(await screen.findByText("BPT Jersey")).toBeVisible();
    expect(screen.getByRole("radio", { name: "Pay online now (bank transfer)" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Payment screenshot"), {
      target: { files: [screenshot()] },
    });
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("uploads the screenshot and returns the proof with the reference", async () => {
    const { onChoose } = renderDialog();
    const file = screenshot();
    expect(screen.getByLabelText("Payment reference")).toHaveValue("BPT-2026-09-24");
    fireEvent.change(screen.getByLabelText("Payment reference"), { target: { value: "BPT-33" } });
    fireEvent.change(screen.getByLabelText("Payment screenshot"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(schedule.uploadPaygClassProof).toHaveBeenCalledWith("s-payg", "student-1", file),
    );
    await waitFor(() =>
      expect(onChoose).toHaveBeenCalledWith({
        method: "bank_transfer",
        proofId: "b".repeat(64),
        reference: "BPT-33",
      }),
    );
  });

  it("shows the price and keeps the class payable after a failed upload", async () => {
    schedule.uploadPaygClassProof.mockRejectedValue(new Error("nope"));
    const { onChoose } = renderDialog();
    expect(screen.getByText("£10 · Adults BJJ")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Payment screenshot"), {
      target: { files: [screenshot()] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The payment screenshot could not be uploaded.",
    );
    expect(onChoose).not.toHaveBeenCalled();
  });
});
