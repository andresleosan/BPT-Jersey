import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
const client = vi.hoisted(() => ({ getMemberSubscriptions: vi.fn(), listManagedPlans: vi.fn() }));
vi.mock("../../../../lib/subscription-admin-client", () => client);
vi.mock("../../../../lib/membership-admin-client", () => client);
import { PlanTab } from "./plan-tab";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("renders a successful empty history, then refreshes without claiming an error is empty", async () => {
  client.getMemberSubscriptions
    .mockResolvedValueOnce({ studentId: "student-1", memberships: [] })
    .mockRejectedValueOnce(new Error("private"));
  client.listManagedPlans.mockResolvedValue([]);
  const update = vi.fn();
  render(<PlanTab onUnavailable={vi.fn()} studentId="student-1" onCurrentMembership={update} />);
  expect((await screen.findByText(/No membership recorded yet/)).textContent).toContain(
    "no membership history",
  );
  expect(update).toHaveBeenCalledWith(null);
  expect(screen.getByRole("link", { name: "Open Memberships" }).getAttribute("href")).toBe(
    "/admin/memberships?studentId=student-1",
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Unable to load membership history"),
  );
  expect(screen.queryByText(/No membership recorded yet/)).toBeNull();
  expect(screen.queryByText("private")).toBeNull();
});
it("keeps cancelled history and selects the newest current membership even when catalogue names fail", async () => {
  const membership = {
    membershipId: "older",
    studentId: "student-1",
    planId: "adult-unlimited",
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  client.getMemberSubscriptions.mockResolvedValue({
    studentId: "student-1",
    memberships: [
      membership,
      {
        ...membership,
        membershipId: "current",
        status: "paused",
        startsAt: "2026-08-01T00:00:00.000Z",
      },
      {
        ...membership,
        membershipId: "cancelled",
        status: "cancelled",
        startsAt: "2026-09-01T00:00:00.000Z",
      },
    ],
  });
  client.listManagedPlans.mockRejectedValue(new Error("catalogue failed"));
  const update = vi.fn();
  render(<PlanTab onUnavailable={vi.fn()} studentId="student-1" onCurrentMembership={update} />);
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith({
      membershipId: "current",
      planName: "Plan name unavailable (adult-unlimited)",
      status: "paused",
      validUntil: null,
    }),
  );
  expect(screen.getAllByText("No end date")).toHaveLength(3);
  expect(screen.getByText("Cancelled").textContent).toBe("Cancelled");
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
});
