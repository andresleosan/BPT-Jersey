import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ list: vi.fn(), review: vi.fn() }));
vi.mock("../../../lib/private-lesson-client", () => ({
  listPrivateLessonPurchases: api.list,
  reviewPrivateLessonPurchase: api.review,
}));

import { PrivateLessonsPanel } from "./private-lessons-panel";

const pending = {
  purchaseId: "private-lesson-1",
  studentId: "student-1",
  studentName: "Ana Silva",
  accountUid: "member-uid",
  optionId: "pack-10",
  priceMinor: 50000,
  creditsGranted: 10,
  creditsRemaining: 0,
  status: "pending",
  source: "member",
  method: "bank_transfer",
  proofId: "a".repeat(64),
  bankReference: "BPT 77",
  submittedAt: "2026-09-26T10:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
  decisionReason: null,
  expiresAt: null,
  invoiceId: null,
  schemaVersion: "1",
} as const;

describe("PrivateLessonsPanel", () => {
  beforeEach(() => {
    api.list.mockResolvedValue([pending]);
    api.review.mockResolvedValue({ ...pending, status: "approved" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("lists pending purchases with member, option, amount and reference", async () => {
    render(<PrivateLessonsPanel />);
    const list = await screen.findByRole("list", { name: "Pending private lessons" });
    expect(within(list).getByText("Ana Silva")).toBeVisible();
    expect(within(list).getByText(/Private lessons pack of 10 · £500.00 · BPT 77/u)).toBeVisible();
    expect(api.list).toHaveBeenCalledWith("pending");
  });

  it("approves a pending purchase and takes it off the pending list", async () => {
    render(<PrivateLessonsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve Ana Silva" }));
    await waitFor(() =>
      expect(api.review).toHaveBeenCalledWith({
        purchaseId: "private-lesson-1",
        decision: "approve",
        reason: null,
      }),
    );
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText("Ana Silva")).toBeNull());
    expect(screen.getByText("No private lesson purchases are waiting.")).toBeVisible();
  });

  it("needs a reason to reject", async () => {
    render(<PrivateLessonsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Reject Ana Silva" }));
    expect(api.review).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Add a reason before rejecting.");
    fireEvent.change(screen.getByLabelText("Reason for Ana Silva"), {
      target: { value: "Transfer not received" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject Ana Silva" }));
    await waitFor(() =>
      expect(api.review).toHaveBeenCalledWith({
        purchaseId: "private-lesson-1",
        decision: "reject",
        reason: "Transfer not received",
      }),
    );
  });

  it("shows the server's refusal", async () => {
    api.review.mockRejectedValueOnce(
      new Error("This member already has an active monthly private lesson plan."),
    );
    render(<PrivateLessonsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve Ana Silva" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This member already has an active monthly private lesson plan.",
    );
    expect(screen.getByText("Ana Silva")).toBeVisible();
  });
});
