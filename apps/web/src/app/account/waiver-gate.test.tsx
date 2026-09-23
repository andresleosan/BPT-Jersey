import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const waiverApi = vi.hoisted(() => ({
  getEnrolmentWaiverStatus: vi.fn(),
  acceptEnrolmentWaiver: vi.fn(),
}));
vi.mock("../../lib/enrolment-waiver-client", () => waiverApi);

import { WaiverGate } from "./waiver-acceptance";

beforeEach(() => {
  waiverApi.acceptEnrolmentWaiver.mockImplementation(
    async ({ studentIds }: { studentIds: string[] }) => studentIds,
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderGate() {
  render(
    <WaiverGate>
      <p>Member calendar</p>
    </WaiverGate>,
  );
}

it("shows only the waiver until every pending member is accepted (D12)", async () => {
  waiverApi.getEnrolmentWaiverStatus.mockResolvedValue({
    version: "2026-09",
    pending: [
      { studentId: "s-guardian-child-1", fullName: "Ava Example" },
      { studentId: "s-guardian-child-2", fullName: "Leo Example" },
    ],
  });
  const user = userEvent.setup();
  renderGate();

  expect(await screen.findByRole("heading", { name: /accept the academy terms/i })).toBeVisible();
  expect(screen.queryByText("Member calendar")).not.toBeInTheDocument();
  const accept = screen.getByRole("button", { name: "Accept and continue" });
  await user.click(screen.getByRole("checkbox", { name: /Ava Example/ }));
  expect(accept).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /Leo Example/ }));
  await user.click(accept);

  expect(await screen.findByText("Member calendar")).toBeVisible();
  expect(waiverApi.acceptEnrolmentWaiver).toHaveBeenCalledWith({
    version: "2026-09",
    studentIds: ["s-guardian-child-1", "s-guardian-child-2"],
  });
});

it("opens the calendar straight away when nothing is pending", async () => {
  waiverApi.getEnrolmentWaiverStatus.mockResolvedValue({ version: "2026-09", pending: [] });
  renderGate();
  expect(await screen.findByText("Member calendar")).toBeVisible();
});

it("does not lock a member out when the check itself fails", async () => {
  waiverApi.getEnrolmentWaiverStatus.mockRejectedValue(new Error("offline"));
  renderGate();
  await waitFor(() => expect(screen.getByText("Member calendar")).toBeVisible());
});
