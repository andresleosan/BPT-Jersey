import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamDirectoryPerson } from "@bpt-jersey/domain/staff/team-access";

const staffApi = vi.hoisted(() => ({
  createStaffProfile: vi.fn(),
  listStaffProfiles: vi.fn(),
  replaceStaffAssignments: vi.fn(),
  replaceStaffAvailability: vi.fn(),
  setStaffActive: vi.fn(),
  updateStaffProfile: vi.fn(),
}));

const permissionsApi = vi.hoisted(() => ({
  listStaffPermissionGrants: vi.fn(),
  revokeStaffPermission: vi.fn(),
  permissionGrantLabel: (permission: string) =>
    permission === "reviewPenalties" ? "Review no-show penalties" : "Manage classes",
  permissionGrantStatusLabel: (grant: { status: string; expiresAt: string }) =>
    grant.status === "revoked"
      ? "Revoked"
      : grant.status === "expired"
        ? "Expired"
        : `Active until ${grant.expiresAt.slice(0, 10)}`,
}));

// The team directory has its own suite. Here it stands in for one directory row: its Manage
// button hands that person to the page, and it shows the refresh key the page passes down.
const directory = vi.hoisted(() => {
  const person: TeamDirectoryPerson = {
    userId: "coach-user-1",
    name: "Ana Coach",
    email: "ana.coach@example.test",
    role: "coach",
    coach: { staffKey: "staff-1", active: true, belt: null },
  };
  return { person };
});

vi.mock("./team-directory", () => ({
  TeamDirectory: ({
    onManage,
    refreshKey = 0,
  }: {
    onManage?: (person: TeamDirectoryPerson) => void;
    refreshKey?: number;
  }) => (
    <section aria-label="Team directory" data-refresh-key={refreshKey}>
      <button
        aria-label={`Manage ${directory.person.name}`}
        onClick={() => onManage?.(directory.person)}
        type="button"
      >
        Manage
      </button>
    </section>
  ),
}));
vi.mock("../../../lib/staff-client", () => staffApi);
vi.mock("../../../lib/staff-permissions-client", () => permissionsApi);
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/staff",
}));

import StaffAdminPage from "./page";
import { AdminGateSessionProvider } from "../admin-gate";
import { AdminShell } from "../admin-shell";

const coach = {
  staffKey: "staff-1",
  role: "coach" as const,
  active: true,
  status: "active" as const,
  self: false,
  schemaVersion: "1" as const,
};

const activeGrant = {
  grantId: "grant-1",
  academyId: "academy-1",
  subjectUserId: "coach-1",
  permission: "reviewPenalties" as const,
  reason: "Covers the office desk while Ana is away",
  grantedBy: "owner-1",
  grantedAt: "2026-09-05T12:00:00.000Z",
  expiresAt: "2026-10-05T12:00:00.000Z",
  revokedAt: null,
  revokedBy: null,
  revocationReason: null,
  schemaVersion: "1" as const,
  status: "active" as const,
};

function sessionFor(role: "owner" | "administrator") {
  return {
    uid: `synthetic-${role}`,
    email: `${role}@example.test`,
    displayName: `Synthetic ${role}`,
    academyId: "synthetic-academy",
    role,
  };
}

// The page reads the signed-in admin from the gate that wraps every /admin route.
function renderStaffPage() {
  return render(
    <AdminGateSessionProvider session={sessionFor("owner")}>
      <StaffAdminPage />
    </AdminGateSessionProvider>,
  );
}

describe("admin staff page", () => {
  beforeEach(() => {
    // jsdom has no scrollIntoView; the page scrolls the Manage panel into view when it opens.
    Element.prototype.scrollIntoView = vi.fn();
    // Every test renders the T116 panel, so the grant list must resolve to something.
    permissionsApi.listStaffPermissionGrants.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    Object.values(staffApi).forEach((mock) => mock.mockReset());
    permissionsApi.listStaffPermissionGrants.mockReset();
    permissionsApi.revokeStaffPermission.mockReset();
  });

  it("renders only the safe staff projection and reports generic errors", async () => {
    const user = userEvent.setup();
    staffApi.setStaffActive.mockRejectedValue(new Error("private backend details"));
    renderStaffPage();

    await user.click(screen.getByRole("button", { name: "Manage Ana Coach" }));
    const panel = screen.getByRole("region", { name: "Ana Coach" });
    expect(within(panel).getByText("Manage · Coach")).toBeVisible();
    expect(within(panel).getByText(/^Active: they can sign in to Coach\./)).toBeVisible();
    expect(screen.queryByText(/coach-user-1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Auth UID|claims|firestore|createdAt/i)).not.toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Deactivate coach access" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to update staff status. Please try again.",
    );
    expect(screen.queryByText("private backend details")).not.toBeInTheDocument();
  });

  it("removes the duplicate user-ID provisioning form", async () => {
    renderStaffPage();
    await screen.findByText("No permission has been delegated.");
    expect(screen.queryByLabelText("User ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Request ID")).not.toBeInTheDocument();
  });

  it("updates activation from the manage panel, which takes focus when it opens", async () => {
    const user = userEvent.setup();
    staffApi.setStaffActive.mockResolvedValue({ ...coach, active: false, status: "inactive" });
    renderStaffPage();

    await user.click(screen.getByRole("button", { name: "Manage Ana Coach" }));
    const title = screen.getByRole("heading", { name: "Ana Coach" });
    expect(title).toHaveFocus();
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts).toContain(title);

    await user.click(screen.getByRole("button", { name: "Deactivate coach access" }));
    await waitFor(() =>
      expect(staffApi.setStaffActive).toHaveBeenCalledWith({
        staffKey: "staff-1",
        active: false,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Staff profile deactivated.");
    expect(screen.getByText(/^Paused: they cannot sign in to Coach/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Reactivate coach access" })).toBeEnabled();
    expect(screen.getByRole("region", { name: "Team directory" })).toHaveAttribute(
      "data-refresh-key",
      "1",
    );
  });

  it("replaces availability and assignments with explicit fields", async () => {
    const user = userEvent.setup();
    staffApi.replaceStaffAvailability.mockResolvedValue([]);
    staffApi.replaceStaffAssignments.mockResolvedValue([]);
    renderStaffPage();

    await user.click(screen.getByRole("button", { name: "Manage Ana Coach" }));
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
    staffApi.replaceStaffAvailability
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("private backend details"));
    renderStaffPage();

    await user.click(screen.getByRole("button", { name: "Manage Ana Coach" }));
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
    let resolveUpdate!: (profile: typeof coach) => void;
    staffApi.setStaffActive.mockReturnValue(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    renderStaffPage();

    await user.click(screen.getByRole("button", { name: "Manage Ana Coach" }));
    await user.click(screen.getByRole("button", { name: "Deactivate coach access" }));
    expect(screen.getByRole("button", { name: "Deactivate coach access" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Replace availability" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Replace assignment" })).toBeDisabled();
    resolveUpdate(coach);
  });

  it.each(["owner", "administrator"] as const)(
    "keeps the staff workspace visible for %s",
    async (role) => {
      const session = sessionFor(role);
      render(
        <AdminGateSessionProvider session={session}>
          <AdminShell session={session}>
            <StaffAdminPage />
          </AdminShell>
        </AdminGateSessionProvider>,
      );

      expect(screen.getByRole("link", { name: "Staff" })).toHaveAttribute("href", "/admin/staff");
      expect(await screen.findByRole("heading", { name: "Staff management" })).toBeVisible();
    },
  );

  describe("delegated permissions (T116)", () => {
    it("no longer offers new grants and explains why", async () => {
      renderStaffPage();

      expect(
        await screen.findByRole("heading", { name: "Existing permission grants" }),
      ).toBeVisible();
      expect(screen.getByText(/new grants are no longer offered/i)).toBeVisible();
      expect(screen.getByText("No permission has been delegated.")).toBeVisible();
      expect(screen.queryByRole("button", { name: "Grant permission" })).toBeNull();
      expect(screen.queryByLabelText("Coach user ID")).toBeNull();
    });

    it("shows a live grant with who gave it and lets office take it away", async () => {
      permissionsApi.listStaffPermissionGrants.mockResolvedValue([activeGrant]);
      permissionsApi.revokeStaffPermission.mockResolvedValue({
        ...activeGrant,
        status: "revoked",
      });
      renderStaffPage();

      expect(await screen.findByText("Review no-show penalties · coach-1")).toBeVisible();
      expect(screen.getByText(/Active until 2026-10-05/)).toBeVisible();
      expect(screen.getByText(/granted by owner-1/)).toBeVisible();

      await userEvent.setup().click(screen.getByRole("button", { name: "Revoke" }));
      await waitFor(() =>
        expect(permissionsApi.revokeStaffPermission).toHaveBeenCalledWith(
          expect.objectContaining({ grantId: "grant-1" }),
        ),
      );
      expect(await screen.findByRole("status")).toHaveTextContent("stops applying immediately");
    });

    it("does not offer revoke on a grant that is already gone", async () => {
      permissionsApi.listStaffPermissionGrants.mockResolvedValue([
        { ...activeGrant, status: "expired" },
      ]);
      renderStaffPage();

      expect(await screen.findByText(/Expired/)).toBeVisible();
      expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
    });

    it("reports a generic error when the grant list cannot be read", async () => {
      permissionsApi.listStaffPermissionGrants.mockRejectedValue(
        new Error("Unable to load permission grants. Please try again."),
      );
      renderStaffPage();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Unable to load permission grants.",
      );
    });
  });
});
