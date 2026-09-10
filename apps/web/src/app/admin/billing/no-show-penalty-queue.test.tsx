import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NoShowPenaltyRecord } from "@bpt-jersey/domain/penalties";

const penaltiesApi = vi.hoisted(() => ({
  listNoShowPenalties: vi.fn(),
  resolveNoShowPenalty: vi.fn(),
}));

vi.mock("../../../lib/no-show-penalties-client", () => penaltiesApi);

import { NoShowPenaltyQueue } from "./no-show-penalty-queue";

const penalty: NoShowPenaltyRecord = {
  penaltyId: "session-1__student-1",
  academyId: "academy-1",
  sessionId: "session-1",
  studentId: "student-1",
  locationId: "town",
  amountMinor: 1_500,
  currency: "GBP",
  status: "proposed",
  sessionStartAt: "2026-09-10T18:00:00.000Z",
  proposedAt: "2026-09-10T19:30:00.000Z",
  proposedBy: "coach-1",
  resolution: null,
  schemaVersion: "1",
  createdAt: "2026-09-10T19:30:00.000Z",
  createdBy: "coach-1",
  updatedAt: "2026-09-10T19:30:00.000Z",
  updatedBy: "coach-1",
};

const reason = "Charged on the September invoice after office review.";

describe("NoShowPenaltyQueue (T111)", () => {
  afterEach(() => {
    cleanup();
    penaltiesApi.listNoShowPenalties.mockReset();
    penaltiesApi.resolveNoShowPenalty.mockReset();
  });

  it("lists only the proposals waiting for a decision", async () => {
    penaltiesApi.listNoShowPenalties.mockResolvedValue([penalty]);

    render(<NoShowPenaltyQueue />);

    expect(await screen.findByText("£15.00")).toBeInTheDocument();
    expect(penaltiesApi.listNoShowPenalties).toHaveBeenCalledWith("proposed");
    expect(
      screen.getByText(/An absence covered by an approved medical leave/u),
    ).toBeInTheDocument();
  });

  it("charges a penalty with a reason and the invoice office issued", async () => {
    penaltiesApi.listNoShowPenalties.mockResolvedValue([penalty]);
    penaltiesApi.resolveNoShowPenalty.mockResolvedValue({ ...penalty, status: "charged" });

    render(<NoShowPenaltyQueue />);
    await screen.findByText("£15.00");

    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: reason } });
    fireEvent.change(screen.getByLabelText("Invoice issued in Billing (optional)"), {
      target: { value: "invoice-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Charge" }));

    await waitFor(() =>
      expect(penaltiesApi.resolveNoShowPenalty).toHaveBeenCalledWith({
        penaltyId: "session-1__student-1",
        decision: "charge",
        reason,
        invoiceId: "invoice-1",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Penalty charged and recorded against invoice invoice-1.",
    );
  });

  it("waives a penalty without an invoice", async () => {
    penaltiesApi.listNoShowPenalties.mockResolvedValue([penalty]);
    penaltiesApi.resolveNoShowPenalty.mockResolvedValue({ ...penalty, status: "waived" });

    render(<NoShowPenaltyQueue />);
    await screen.findByText("£15.00");

    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "First absence and the student warned the coach." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Waive" }));

    await waitFor(() =>
      expect(penaltiesApi.resolveNoShowPenalty).toHaveBeenCalledWith({
        penaltyId: "session-1__student-1",
        decision: "waive",
        reason: "First absence and the student warned the coach.",
      }),
    );
  });

  it("refuses to resolve without a recorded reason", async () => {
    penaltiesApi.listNoShowPenalties.mockResolvedValue([penalty]);

    render(<NoShowPenaltyQueue />);
    await screen.findByText("£15.00");

    fireEvent.click(screen.getByRole("button", { name: "Charge" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Record why you are charging/u);
    expect(penaltiesApi.resolveNoShowPenalty).not.toHaveBeenCalled();
  });

  it("says when nothing is waiting and when the queue cannot be read", async () => {
    penaltiesApi.listNoShowPenalties.mockResolvedValue([]);
    render(<NoShowPenaltyQueue />);
    expect(await screen.findByText("No penalty is waiting for a decision.")).toBeInTheDocument();
    cleanup();

    penaltiesApi.listNoShowPenalties.mockRejectedValue(new Error("nope"));
    render(<NoShowPenaltyQueue />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Unable to load no-show penalties/u);
  });
});
