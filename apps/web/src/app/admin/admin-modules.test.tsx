import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivitiesPage } from "./activities/page";
import { AttendancePage } from "./attendance/page";
import { CrmPage } from "./crm/page";
import { GroupsPage } from "./groups/page";
import { ReportsPage } from "./reports/page";

vi.mock("../../lib/schedule-client", () => ({
  listClasses: vi.fn().mockResolvedValue([]),
  listSessions: vi.fn().mockResolvedValue([]),
  getSessionOperationalView: vi.fn(),
  saveClass: vi.fn(),
  saveSession: vi.fn(),
}));

vi.mock("../../lib/crm-client", () => ({
  listCrmLeads: vi.fn().mockResolvedValue([]),
}));

describe("administrative connected modules", () => {
  afterEach(() => cleanup());

  it("does not render preview groups when the connected source is empty", async () => {
    render(<GroupsPage />);
    expect(await screen.findByText("No groups match these filters.")).toBeVisible();
    expect(screen.queryByText("Little Warriors")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Training center" })).toBeVisible();
  });

  it("does not render preview activities when the connected source is empty", async () => {
    render(<ActivitiesPage />);
    expect(await screen.findByText("No activities match these filters.")).toBeVisible();
    expect(screen.queryByText("Kids Gi Fundamentals")).not.toBeInTheDocument();
  });

  it("does not render preview attendance when the connected source is empty", async () => {
    render(<AttendancePage />);
    expect(
      await screen.findByText("No connected attendance records match these filters."),
    ).toBeVisible();
    expect(screen.queryByText("Taylor Morgan")).not.toBeInTheDocument();
  });

  it("does not render preview CRM leads when the connected source is empty", async () => {
    render(<CrmPage />);
    expect(await screen.findByText("No leads available.")).toBeVisible();
    expect(screen.queryByText("Morgan family")).not.toBeInTheDocument();
  });

  it("keeps the remaining CRM report explicitly marked as preview", async () => {
    const user = userEvent.setup();
    render(<ReportsPage />);
    const report = screen.getByRole("article", { name: "CRM follow-up report" });

    await user.click(within(report).getByRole("button", { name: /Prepare crm follow-up report/i }));

    expect(within(report).getByRole("status")).toHaveTextContent("Report ready for preview");
  });
});
