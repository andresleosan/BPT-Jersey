import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const staffApi = vi.hoisted(() => ({
  createStaffProfile: vi.fn(),
  listStaffProfiles: vi.fn(),
  replaceStaffAssignments: vi.fn(),
  replaceStaffAvailability: vi.fn(),
  setStaffActive: vi.fn(),
  updateStaffProfile: vi.fn(),
}));

vi.mock("../../../lib/staff-client", () => staffApi);
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/staff",
}));

import StaffAdminPage from "./page";
import { AdminShell } from "../admin-shell";

const coach = {
  staffKey: "staff-1",
  role: "coach" as const,
  active: true,
  status: "active" as const,
  schemaVersion: "1" as const,
};

const headCoach = { ...coach, role: "headCoach" as const };
const inactiveHeadCoach = { ...headCoach, active: false, status: "inactive" as const };

describe("admin staff page", () => {
  afterEach(() => {
    cleanup();
    Object.values(staffApi).forEach((mock) => mock.mockReset());
  });

  it("announces loading and then the empty state", async () => {
    let resolveList!: (profiles: readonly (typeof coach)[]) => void;
    staffApi.listStaffProfiles.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    render(<StaffAdminPage />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading staff profiles");
    resolveList([]);
    expect(await screen.findByText("No staff profiles found.")).toBeVisible();
  });

  it("renders only the safe staff projection and reports generic load errors", async () => {
    staffApi.listStaffProfiles.mockResolvedValue([
      { ...coach, userId: "private-user", auditId: "private-audit", createdAt: "private-time" },
    ]);
    render(<StaffAdminPage />);

    const table = await screen.findByRole("table", { name: "Staff profiles" });
    expect(within(table).getByText("staff-1")).toBeVisible();
    expect(within(table).getByText("Coach")).toBeVisible();
    expect(within(table).getByText("Active")).toBeVisible();
    expect(screen.queryByText(/private-user|private-audit|private-time/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Auth UID|claims|firestore|createdAt/i)).not.toBeInTheDocument();

    cleanup();
    staffApi.listStaffProfiles.mockRejectedValue(new Error("private backend details"));
    render(<StaffAdminPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load staff profiles. Please try again.",
    );
    expect(screen.queryByText("private backend details")).not.toBeInTheDocument();
  });

  it("creates a profile with the exact editable fields", async () => {
    const user = userEvent.setup();
    staffApi.listStaffProfiles.mockResolvedValue([]);
    staffApi.createStaffProfile.mockResolvedValue(coach);
    render(<StaffAdminPage />);

    await screen.findByText("No staff profiles found.");
    await user.type(screen.getByLabelText("User ID"), "user-1");
    await user.selectOptions(screen.getByLabelText("Role"), "coach");
    await user.type(screen.getByLabelText("Request ID"), "request-1");
    await user.click(screen.getByRole("button", { name: "Create staff profile" }));

    await waitFor(() => expect(staffApi.createStaffProfile).toHaveBeenCalledOnce());
    expect(staffApi.createStaffProfile).toHaveBeenCalledWith({
      userId: "user-1",
      role: "coach",
      requestId: "request-1",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Staff profile created.");
  });

  it("updates role and activation while restoring focus to the selected row action", async () => {
    const user = userEvent.setup();
    staffApi.listStaffProfiles.mockResolvedValue([coach]);
    staffApi.updateStaffProfile.mockResolvedValue(headCoach);
    staffApi.setStaffActive.mockResolvedValue(inactiveHeadCoach);
    render(<StaffAdminPage />);

    await screen.findByRole("table", { name: "Staff profiles" });
    const rowAction = screen.getByRole("button", { name: "Select staff staff-1" });
    await user.click(rowAction);
    await user.selectOptions(screen.getByLabelText("Selected staff role"), "headCoach");
    await user.click(screen.getByRole("button", { name: "Update role" }));
    await waitFor(() =>
      expect(staffApi.updateStaffProfile).toHaveBeenCalledWith({
        staffKey: "staff-1",
        role: "headCoach",
      }),
    );
    expect(rowAction).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Deactivate staff profile" }));
    await waitFor(() =>
      expect(staffApi.setStaffActive).toHaveBeenCalledWith({
        staffKey: "staff-1",
        active: false,
      }),
    );
    expect(rowAction).toHaveFocus();
    expect(screen.getByRole("row", { name: /staff-1.*Head coach.*Inactive/i })).toBeVisible();
  });

  it("replaces availability and assignments with explicit fields", async () => {
    const user = userEvent.setup();
    staffApi.listStaffProfiles.mockResolvedValue([coach]);
    staffApi.replaceStaffAvailability.mockResolvedValue([]);
    staffApi.replaceStaffAssignments.mockResolvedValue([]);
    render(<StaffAdminPage />);

    await screen.findByRole("table", { name: "Staff profiles" });
    await user.click(screen.getByRole("button", { name: "Select staff staff-1" }));
    await user.selectOptions(screen.getByLabelText("Weekday"), "1");
    await user.type(screen.getByLabelText("Start local time"), "17:00");
    await user.type(screen.getByLabelText("End local time"), "19:00");
    await user.type(screen.getByLabelText("IANA timezone"), "Europe/London");
    await user.click(screen.getByRole("button", { name: "Replace availability" }));
    await waitFor(() =>
      expect(staffApi.replaceStaffAvailability).toHaveBeenCalledWith({
        staffKey: "staff-1",
        windows: [
          { weekday: 1, startLocal: "17:00", endLocal: "19:00", timezone: "Europe/London" },
        ],
      }),
    );

    await user.selectOptions(screen.getByLabelText("Target type"), "location");
    await user.type(screen.getByLabelText("Target ID"), "location-town");
    await user.click(screen.getByRole("button", { name: "Replace assignment" }));
    await waitFor(() =>
      expect(staffApi.replaceStaffAssignments).toHaveBeenCalledWith({
        staffKey: "staff-1",
        assignments: [{ targetType: "location", targetId: "location-town" }],
      }),
    );
  });

  it("clears stale success state and describes invalid availability fields", async () => {
    const user = userEvent.setup();
    staffApi.listStaffProfiles.mockResolvedValue([coach]);
    staffApi.replaceStaffAvailability
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("private backend details"));
    render(<StaffAdminPage />);

    await screen.findByRole("table", { name: "Staff profiles" });
    await user.click(screen.getByRole("button", { name: "Select staff staff-1" }));
    await user.type(screen.getByLabelText("Start local time"), "17:00");
    await user.type(screen.getByLabelText("End local time"), "19:00");
    await user.type(screen.getByLabelText("IANA timezone"), "Europe/London");
    await user.click(screen.getByRole("button", { name: "Replace availability" }));
    expect(await screen.findByText("Staff availability replaced.")).toBeVisible();

    await user.clear(screen.getByLabelText("End local time"));
    await user.click(screen.getByRole("button", { name: "Replace availability" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a valid weekday, local time range, and IANA timezone.",
    );
    expect(screen.queryByText("Staff availability replaced.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("End local time")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("End local time")).toHaveAttribute(
      "aria-describedby",
      "staff-error-message",
    );
    expect(screen.getByLabelText("End local time")).toHaveFocus();

    await user.type(screen.getByLabelText("End local time"), "19:00");
    await user.click(screen.getByRole("button", { name: "Replace availability" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to replace staff availability. Please try again.",
    );
    expect(screen.queryByText("Staff availability replaced.")).not.toBeInTheDocument();
  });

  it("disables selected-row actions while a mutation is pending", async () => {
    const user = userEvent.setup();
    let resolveUpdate!: (profile: typeof headCoach) => void;
    staffApi.listStaffProfiles.mockResolvedValue([coach]);
    staffApi.updateStaffProfile.mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    render(<StaffAdminPage />);

    await screen.findByRole("table", { name: "Staff profiles" });
    await user.click(screen.getByRole("button", { name: "Select staff staff-1" }));
    await user.selectOptions(screen.getByLabelText("Selected staff role"), "headCoach");
    await user.click(screen.getByRole("button", { name: "Update role" }));
    expect(screen.getByRole("button", { name: "Update role" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deactivate staff profile" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Replace availability" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Replace assignment" })).toBeDisabled();
    resolveUpdate(headCoach);
  });

  it.each(["owner", "administrator"] as const)(
    "keeps the staff workspace visible for %s",
    async (role) => {
      staffApi.listStaffProfiles.mockResolvedValue([]);
      render(
        <AdminShell
          session={{
            uid: `synthetic-${role}`,
            email: `${role}@example.test`,
            displayName: `Synthetic ${role}`,
            academyId: "synthetic-academy",
            role,
          }}
        >
          <StaffAdminPage />
        </AdminShell>,
      );

      expect(screen.getByRole("link", { name: "Staff" })).toHaveAttribute("href", "/admin/staff");
      expect(await screen.findByRole("heading", { name: "Staff management" })).toBeVisible();
    },
  );
});
