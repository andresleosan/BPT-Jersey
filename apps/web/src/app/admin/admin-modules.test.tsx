import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ActivitiesPage } from "./activities/page";
import { AttendancePage } from "./attendance/page";
import { CrmPage } from "./crm/page";
import { FinancePage } from "./finance/page";
import { GroupsPage } from "./groups/page";
import { ReportsPage } from "./reports/page";

describe("administrative preview modules", () => {
  afterEach(() => cleanup());

  it("filters groups and exposes the training center", async () => {
    const user = userEvent.setup();
    render(<GroupsPage />);

    expect(screen.getByRole("columnheader", { name: "Training center" })).toBeVisible();
    await user.selectOptions(screen.getByRole("combobox", { name: "Coach" }), "Coach Alex");

    expect(screen.getByRole("row", { name: /Little Warriors/ })).toBeVisible();
    expect(screen.queryByRole("row", { name: /Adult No-Gi/ })).not.toBeInTheDocument();
  });

  it("combines archived group status with the other filters", async () => {
    const user = userEvent.setup();
    render(<GroupsPage />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Program" }), "MMA");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Group status" }),
      "Archived groups",
    );

    expect(screen.getByText("No groups match these filters.")).toBeVisible();
  });

  it("filters activities by status", async () => {
    const user = userEvent.setup();
    render(<ActivitiesPage />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Activity status" }),
      "Completed",
    );

    expect(screen.getByText("No activities match these filters.")).toBeVisible();
  });

  it("filters attendance by group and coach", async () => {
    const user = userEvent.setup();
    render(<AttendancePage />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Attendance group" }),
      "Little Warriors",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Attendance coach" }),
      "Coach Alex",
    );

    expect(screen.getByRole("row", { name: /Taylor Morgan/ })).toBeVisible();
    expect(screen.queryByRole("row", { name: /Jordan Blake/ })).not.toBeInTheDocument();
  });

  it("applies the attendance date filter", async () => {
    render(<AttendancePage />);

    fireEvent.change(screen.getByLabelText("Attendance date"), { target: { value: "2026-08-13" } });

    expect(screen.getByText("No attendance records match these filters.")).toBeVisible();
  });

  it("filters payments by status", async () => {
    const user = userEvent.setup();
    render(<FinancePage />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Payment status" }), "Overdue");

    expect(screen.getByRole("row", { name: /Taylor Morgan/ })).toBeVisible();
    expect(screen.queryByRole("row", { name: /Jordan Blake/ })).not.toBeInTheDocument();
  });

  it("applies the finance period filter", async () => {
    const user = userEvent.setup();
    render(<FinancePage />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Finance period" }),
      "Last month",
    );

    expect(screen.getByText("No payments match these filters.")).toBeVisible();
  });

  it("filters CRM leads by stage and owner", async () => {
    const user = userEvent.setup();
    render(<CrmPage />);

    await user.selectOptions(screen.getByRole("combobox", { name: "CRM stage" }), "New enquiry");
    await user.selectOptions(screen.getByRole("combobox", { name: "CRM owner" }), "Admin team");

    expect(screen.getByRole("article", { name: /Jamie Carter/ })).toBeVisible();
    expect(screen.queryByRole("article", { name: /Morgan family/ })).not.toBeInTheDocument();
  });

  it("prepares a report and exposes the resulting state", async () => {
    const user = userEvent.setup();
    render(<ReportsPage />);
    const report = screen.getByRole("article", { name: "Member directory report" });

    await user.click(
      within(report).getByRole("button", { name: /Prepare member directory report/i }),
    );

    expect(within(report).getByRole("status")).toHaveTextContent("Report ready for preview");
  });
});
