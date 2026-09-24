import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const waiverApi = vi.hoisted(() => ({
  getEnrolmentWaiverStatus: vi.fn(),
  acceptEnrolmentWaiver: vi.fn(),
}));
vi.mock("../../lib/enrolment-waiver-client", () => waiverApi);
const statusApi = vi.hoisted(() => ({ getMyDisclaimerStatus: vi.fn() }));
vi.mock("../../lib/disclaimer-status-client", () => statusApi);
vi.mock("../../lib/client-auth", () => ({
  useClientSession: () => ({ session: { role: "guardian" } }),
}));

import { AcademyTermsAcceptance, WaiverGate } from "./waiver-acceptance";

beforeEach(() => {
  waiverApi.acceptEnrolmentWaiver.mockImplementation(
    async ({ studentIds }: { studentIds: string[] }) => studentIds,
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderGate(studentId: string) {
  render(
    <WaiverGate>
      {(gate) => gate(studentId) ?? <p>Member calendar</p>}
    </WaiverGate>,
  );
}

it("accepts the terms for every pending member on /account/waiver (D12)", async () => {
  waiverApi.getEnrolmentWaiverStatus.mockResolvedValue({
    version: "2026-09",
    pending: [
      { studentId: "s-guardian-child-1", fullName: "Ava Example" },
      { studentId: "s-guardian-child-2", fullName: "Leo Example" },
    ],
  });
  const user = userEvent.setup();
  render(<AcademyTermsAcceptance />);

  expect(await screen.findByRole("heading", { name: /accept the academy terms/i })).toBeVisible();
  const accept = screen.getByRole("button", { name: "Accept and continue" });
  await user.click(screen.getByRole("checkbox", { name: /Ava Example/ }));
  expect(accept).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /Leo Example/ }));
  await user.click(accept);

  expect(await screen.findByText(/Academy terms accepted/)).toBeVisible();
  expect(waiverApi.acceptEnrolmentWaiver).toHaveBeenCalledWith({
    version: "2026-09",
    studentIds: ["s-guardian-child-1", "s-guardian-child-2"],
  });
});

it("opens the calendar of a participant whose terms are accepted", async () => {
  statusApi.getMyDisclaimerStatus.mockResolvedValue({
    participants: [{ studentId: "s1", fullName: "Ava Example", terms: true, disclaimers: true }],
  });
  renderGate("s1");
  expect(await screen.findByText("Member calendar")).toBeVisible();
});

it("blocks only the participant without the terms", async () => {
  statusApi.getMyDisclaimerStatus.mockResolvedValue({
    participants: [{ studentId: "s1", fullName: "Ava Example", terms: false, disclaimers: true }],
  });
  renderGate("s1");
  expect(
    await screen.findByText("Ava Example needs to accept the academy terms before booking."),
  ).toBeVisible();
  expect(screen.queryByText("Member calendar")).not.toBeInTheDocument();
});

it("fails closed with Retry when the check itself fails (Q5)", async () => {
  statusApi.getMyDisclaimerStatus.mockRejectedValue(new Error("offline"));
  renderGate("s1");
  expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
  expect(screen.queryByText("Member calendar")).not.toBeInTheDocument();
});
