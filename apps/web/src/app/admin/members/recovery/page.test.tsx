import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  listMemberRecoveryRequests: vi.fn(),
  getMemberRecoveryDetail: vi.fn(),
  reviewMemberRecovery: vi.fn(),
}));
const session = vi.hoisted(() => ({ role: "administrator" }));
vi.mock("../../../../lib/member-recovery-client", () => api);
vi.mock("../../admin-gate", () => ({ useAdminOrStaffSession: () => session }));
import Page from "./page";
const requestId = "a".repeat(64),
  candidateId = "b".repeat(64);
const row = {
  requestId,
  fullName: "Alex Member",
  status: "pending-review",
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
};
beforeEach(() => {
  vi.resetAllMocks();
  session.role = "administrator";
  api.listMemberRecoveryRequests.mockResolvedValue({ requests: [row], truncated: false });
  api.getMemberRecoveryDetail.mockResolvedValue({
    request: { ...row, previousEmail: "old@example.test", accountEmail: "new@example.test" },
    candidates: [
      {
        candidateId,
        fullName: "Alex Member",
        email: "old@example.test",
        dateOfBirth: "1990-02-03",
        membershipState: "active",
      },
    ],
  });
  api.reviewMemberRecovery.mockResolvedValue({ status: "profile-required" });
});
afterEach(cleanup);
it("requires a selected record and independent identity confirmation to approve", async () => {
  const user = userEvent.setup();
  render(<Page />);
  await user.click(await screen.findByRole("button", { name: "Review request" }));
  const approve = await screen.findByRole("button", { name: "Approve identity" });
  expect(approve).toBeDisabled();
  await user.click(screen.getByRole("radio", { name: /Alex Member/ }));
  expect(approve).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /independently verified/i }));
  await user.click(approve);
  await waitFor(() =>
    expect(api.reviewMemberRecovery).toHaveBeenCalledWith({
      requestId,
      decision: "approve",
      candidateId,
      identityConfirmed: true,
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(/complete their details/i);
});
it("does not fetch confidential requests for a coach", () => {
  session.role = "coach";
  render(<Page />);
  expect(screen.getByText(/only the office/i)).toBeVisible();
  expect(api.listMemberRecoveryRequests).not.toHaveBeenCalled();
});
it("rejects a request without granting access", async () => {
  api.reviewMemberRecovery.mockResolvedValue({ status: "rejected" });
  const user = userEvent.setup();
  render(<Page />);
  await user.click(await screen.findByRole("button", { name: "Review request" }));
  await user.click(await screen.findByRole("button", { name: "Reject request" }));
  expect(await screen.findByRole("status")).toHaveTextContent(/rejected/i);
  expect(api.reviewMemberRecovery).toHaveBeenCalledWith({ requestId, decision: "reject" });
});
it("does not carry identity confirmation into another request", async () => {
  api.listMemberRecoveryRequests.mockResolvedValue({
    requests: [row, { ...row, requestId: "c".repeat(64), fullName: "Robin Member" }],
    truncated: false,
  });
  const user = userEvent.setup();
  render(<Page />);
  await screen.findByText("Robin Member");
  await user.click(screen.getAllByRole("button", { name: "Review request" })[0]!);
  await user.click(await screen.findByRole("checkbox", { name: /independently verified/i }));
  await user.click(screen.getAllByRole("button", { name: "Review request" })[1]!);
  expect(
    await screen.findByRole("checkbox", { name: /independently verified/i }),
  ).not.toBeChecked();
  expect(screen.getByRole("button", { name: "Approve identity" })).toBeDisabled();
});

it("does not describe an unverified account email as verified", async () => {
  api.getMemberRecoveryDetail.mockResolvedValue({
    request: {
      ...row,
      status: "verify-email",
      previousEmail: "old@example.test",
      accountEmail: "new@example.test",
    },
    candidates: [],
  });
  const user = userEvent.setup();
  render(<Page />);
  await user.click(await screen.findByRole("button", { name: "Review request" }));
  expect(await screen.findByText("Account email")).toBeVisible();
  expect(screen.queryByText("Verified account email")).not.toBeInTheDocument();
});

it("explains how resolving the oldest verified requests reveals the next queue page", async () => {
  api.listMemberRecoveryRequests.mockResolvedValue({ requests: [row], truncated: true });
  render(<Page />);
  expect(await screen.findByText(/oldest 50 verified requests awaiting review/)).toHaveTextContent(
    /Resolve requests, then refresh/,
  );
});
