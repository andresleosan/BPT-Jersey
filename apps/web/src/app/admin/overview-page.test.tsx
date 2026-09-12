import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getOperationalReport: vi.fn(),
  getDailyOperationsDashboard: vi.fn(),
  listUpcomingBirthdays: vi.fn(),
}));

const gate = vi.hoisted(() => ({
  role: "owner" as "owner" | "administrator" | "headCoach" | "coach",
}));

vi.mock("./admin-gate", () => ({
  useAdminOrStaffSession: () => ({
    uid: "u-1",
    email: "u@example.test",
    displayName: "Synthetic",
    academyId: "academy-1",
    role: gate.role,
  }),
}));

vi.mock("../../lib/reports-client", () => ({ getOperationalReport: api.getOperationalReport }));
vi.mock("../../lib/schedule-client", () => ({
  getDailyOperationsDashboard: api.getDailyOperationsDashboard,
}));
vi.mock("../../lib/birthdays-client", async () => {
  const actual = await vi.importActual<typeof import("../../lib/birthdays-client")>(
    "../../lib/birthdays-client",
  );
  return { ...actual, listUpcomingBirthdays: api.listUpcomingBirthdays };
});

import { OverviewPage } from "./overview-page";

const report = {
  students: { activeStudents: 126 },
  memberships: { overdue: 2 },
  attendance: { noShow: 0 },
} as never;
const dashboard = { sessions: [] } as never;

beforeEach(() => {
  gate.role = "owner";
  api.getOperationalReport.mockResolvedValue(report);
  api.getDailyOperationsDashboard.mockResolvedValue(dashboard);
  api.listUpcomingBirthdays.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("admin overview", () => {
  it("does not render synthetic metrics when connected sources are unavailable", async () => {
    api.getOperationalReport.mockRejectedValue(new Error("unavailable"));
    api.getDailyOperationsDashboard.mockRejectedValue(new Error("unavailable"));
    render(<OverviewPage />);

    expect(screen.getByRole("heading", { name: "Today's academy view" })).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load today's connected dashboard",
    );
    expect(screen.queryByText("126")).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Today's classes" })).not.toBeInTheDocument();
  });

  it("shows the three operational counts without the shortcut bar or the member count", async () => {
    render(<OverviewPage />);

    expect(await screen.findByRole("article", { name: "0 Classes today" })).toBeVisible();
    expect(screen.getByRole("article", { name: "0 Attendance pending" })).toBeVisible();
    expect(screen.getByRole("article", { name: "2 Overdue memberships" })).toBeVisible();
    expect(screen.queryByRole("article", { name: /Members$/ })).not.toBeInTheDocument();
    expect(screen.queryByText("126")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add new member" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Quick actions")).not.toBeInTheDocument();
  });
});
