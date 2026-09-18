import { cleanup, render, screen, within } from "@testing-library/react";
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

  it("asks for a capacity instead of showing an unlimited class today", async () => {
    api.getDailyOperationsDashboard.mockResolvedValue({
      sessions: [
        {
          session: {
            title: "Legacy class",
            classId: null,
            instructorId: "coach-a",
            startAt: "2026-09-17T17:30:00.000Z",
            endAt: "2026-09-17T18:30:00.000Z",
            status: "scheduled",
          },
          summary: { capacity: null, totalBookings: 3 },
        },
      ],
    } as never);
    render(<OverviewPage />);

    const table = await screen.findByRole("table", { name: "Today's classes" });
    expect(within(table).getByText("Set capacity")).toBeInTheDocument();
    expect(within(table).queryByText(/∞/u)).not.toBeInTheDocument();
  });

  it("lists at most the three nearest birthdays with their day, and never a year of birth", async () => {
    api.listUpcomingBirthdays.mockResolvedValue([
      {
        studentId: "s-1",
        displayName: "Ana Coelho",
        daysAway: 2,
        turningAge: 30,
        participantType: "adult",
        trainingCenter: "Town",
      },
      {
        studentId: "s-2",
        displayName: "Ben Kid",
        daysAway: 5,
        turningAge: 9,
        participantType: "minor",
        trainingCenter: "West",
      },
      {
        studentId: "s-3",
        displayName: "Cara Lima",
        daysAway: 40,
        turningAge: 41,
        participantType: "adult",
        trainingCenter: "Town",
      },
      {
        studentId: "s-4",
        displayName: "Dan Extra",
        daysAway: 90,
        turningAge: 22,
        participantType: "adult",
        trainingCenter: "Town",
      },
    ]);
    render(<OverviewPage />);

    const card = await screen.findByRole("region", { name: "Next birthdays" });
    expect(api.listUpcomingBirthdays).toHaveBeenCalledWith({ windowDays: 366 });
    const items = within(card).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/Ana Coelho/);
    expect(items[0]).toHaveTextContent(/turns 30/);
    expect(
      within(items[0] as HTMLElement).getByRole("link", { name: "Ana Coelho" }),
    ).toHaveAttribute("href", "/admin/members/profile?id=s-1");
    expect(items[0]).toHaveTextContent(/^\S+ \d{1,2} \S{3}/); // e.g. "Mon 14 Sep" before the name
    expect(card).not.toHaveTextContent("Dan Extra");
    expect(card).not.toHaveTextContent(/19\d\d|20\d\d/);
    expect(screen.queryByRole("status", { name: "Birthday today" })).not.toBeInTheDocument();
  });

  it("announces a birthday that is today", async () => {
    api.listUpcomingBirthdays.mockResolvedValue([
      {
        studentId: "s-1",
        displayName: "Ana Coelho",
        daysAway: 0,
        turningAge: 30,
        participantType: "adult",
        trainingCenter: "Town",
      },
    ]);
    render(<OverviewPage />);

    const band = await screen.findByRole("status", { name: "Birthday today" });
    expect(band).toHaveTextContent("Ana Coelho turns 30 today");
    expect(within(band).getByRole("link", { name: "Ana Coelho" })).toHaveAttribute(
      "href",
      "/admin/members/profile?id=s-1",
    );
  });

  it("links birthday names to the record for coaches too", async () => {
    gate.role = "coach";
    api.listUpcomingBirthdays.mockResolvedValue([
      {
        studentId: "s-1",
        displayName: "Test Member A",
        daysAway: 0,
        turningAge: 30,
        participantType: "adult",
        trainingCenter: "Town",
      },
    ]);
    render(<OverviewPage />);
    const band = await screen.findByRole("status", { name: "Birthday today" });
    expect(within(band).getByRole("link", { name: "Test Member A" })).toHaveAttribute(
      "href",
      "/admin/members/profile?id=s-1",
    );
  });

  it("keeps the rest of the overview when birthdays cannot be read", async () => {
    api.listUpcomingBirthdays.mockRejectedValue(new Error("unavailable"));
    render(<OverviewPage />);

    expect(await screen.findByRole("article", { name: "0 Classes today" })).toBeVisible();
    expect(screen.getByText("Birthdays are temporarily unavailable.")).toBeVisible();
  });

  it("hides finance-derived items and skips the report for a coach session", async () => {
    gate.role = "coach";
    render(<OverviewPage />);

    expect(await screen.findByRole("article", { name: "0 Classes today" })).toBeVisible();
    expect(screen.getByText("No arrivals pending for today's sessions")).toBeVisible();
    expect(await screen.findByRole("region", { name: "Next birthdays" })).toBeVisible();
    expect(screen.queryByRole("article", { name: /Overdue memberships/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review finance" })).not.toBeInTheDocument();
    expect(api.getOperationalReport).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("link", { name: "Manage classes and sessions" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the classes shortcut for a head coach", async () => {
    gate.role = "headCoach";
    render(<OverviewPage />);

    expect(await screen.findByRole("link", { name: "Manage classes and sessions" })).toBeVisible();
  });
});
