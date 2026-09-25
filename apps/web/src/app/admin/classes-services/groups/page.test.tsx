import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useAdminOrStaffSession: vi.fn(),
  getMemberOverview: vi.fn(),
  listMemberGroups: vi.fn(),
  saveMemberGroup: vi.fn(),
  deleteMemberGroup: vi.fn(),
}));

vi.mock("../../admin-gate", () => ({ useAdminOrStaffSession: mocks.useAdminOrStaffSession }));
vi.mock("../../../../lib/member-overview-client", () => ({
  getMemberOverview: mocks.getMemberOverview,
}));
vi.mock("../../../../lib/groups-client", () => ({
  listMemberGroups: mocks.listMemberGroups,
  saveMemberGroup: mocks.saveMemberGroup,
  deleteMemberGroup: mocks.deleteMemberGroup,
}));

import GroupsPage from "./page";

const stamp = "2026-09-25T09:00:00.000Z";
function row(studentId: string, fullName: string, extra: Record<string, unknown> = {}) {
  return {
    studentId,
    rowKind: "member",
    fullName,
    trainingCenter: "Town",
    centreConfirmed: true,
    active: true,
    recordActive: true,
    source: "bpt",
    planState: "current",
    ownAccount: true,
    flags: [],
    ...extra,
  };
}
function group(groupId: string, name: string, site?: "Town" | "West") {
  return {
    groupId,
    name,
    ...(site ? { site } : {}),
    studentIds: [],
    revision: 1,
    active: true,
    updatedAt: stamp,
    members: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAdminOrStaffSession.mockReturnValue({ role: "owner" });
  mocks.getMemberOverview.mockResolvedValue({
    rows: [
      row("s1", "Ana Coelho"),
      row("g1", "Pat Parent", { rowKind: "guardian" }),
      row("s2", "Idle Member", { active: false, recordActive: false }),
      row("s3", "Lapsed Member", { active: false, planState: "expired" }),
    ],
    counters: { total: 4, active: 1, expiring: 0, review: 0, inactive: 2, guardians: 1 },
    generatedAt: stamp,
  });
  mocks.listMemberGroups.mockResolvedValue([
    group("t1", "Town Kids", "Town"),
    group("w1", "West Adults", "West"),
    group("o1", "Old Squad"),
  ]);
  mocks.saveMemberGroup.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("groups page", () => {
  it("lists groups under Town, West and Unassigned site", async () => {
    render(<GroupsPage />);
    const town = await screen.findByRole("region", { name: "Town" });
    expect(within(town).getByRole("heading", { name: "Town Kids" })).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "West" })).getByRole("heading", {
        name: "West Adults",
      }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Unassigned site" })).getByRole("heading", {
        name: "Old Squad",
      }),
    ).toBeTruthy();
  });

  it("filters the list by site", async () => {
    render(<GroupsPage />);
    await screen.findByRole("heading", { name: "Town Kids" });
    fireEvent.change(screen.getByLabelText("Show site"), { target: { value: "West" } });
    expect(screen.queryByRole("heading", { name: "Town Kids" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Old Squad" })).toBeNull();
    expect(screen.getByRole("heading", { name: "West Adults" })).toBeTruthy();
  });

  it("offers only active members, never guardians, when building a group", async () => {
    render(<GroupsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Create group" }));
    expect(screen.getByRole("button", { name: "Add Ana Coelho to group" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Pat Parent to group" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Idle Member to group" })).toBeNull();
  });

  it("offers an active member whose plan has lapsed", async () => {
    render(<GroupsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Create group" }));
    expect(screen.getByRole("button", { name: "Add Lapsed Member to group" })).toBeTruthy();
  });

  it("explains that members on a free trial register as Missing Payment", async () => {
    render(<GroupsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Create group" }));
    expect(
      screen.getByText(
        "Members on a free trial are listed but register as Missing Payment until they have a paid plan.",
      ),
    ).toBeTruthy();
  });

  it("requires a site before saving and sends the chosen one", async () => {
    render(<GroupsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Create group" }));
    const site = screen.getByRole("radiogroup", { name: "Site" });
    fireEvent.change(screen.getByLabelText("Group name"), {
      target: { value: "Competition team" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save group" }));
    expect(await screen.findByText("Choose Town or West.")).toBeTruthy();
    expect(mocks.saveMemberGroup).not.toHaveBeenCalled();

    fireEvent.click(within(site).getByLabelText("West"));
    fireEvent.click(screen.getByRole("button", { name: "Save group" }));
    await waitFor(() =>
      expect(mocks.saveMemberGroup).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Competition team", site: "West" }),
      ),
    );
  });

  it("asks for a site when editing a group saved before sites existed", async () => {
    render(<GroupsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Old Squad" }));
    const site = screen.getByRole("radiogroup", { name: "Site" });
    expect(within(site).getByLabelText("Town")).toHaveProperty("checked", false);
    expect(within(site).getByLabelText("West")).toHaveProperty("checked", false);
    fireEvent.click(screen.getByRole("button", { name: "Save group" }));
    expect(await screen.findByText("Choose Town or West.")).toBeTruthy();
  });

  it("flags a member the office can no longer keep in an older group", async () => {
    mocks.listMemberGroups.mockResolvedValue([
      { ...group("o1", "Old Squad"), studentIds: ["s2", "g1", "s1", "s3"] },
    ]);
    render(<GroupsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Old Squad" }));
    expect(screen.getAllByText("Inactive. Remove before saving.")).toHaveLength(1);
    expect(screen.getByText("Guardian. Remove before saving.")).toBeTruthy();
  });

  it("still lists groups when the member list cannot load, and says so in the picker", async () => {
    mocks.getMemberOverview.mockRejectedValue(
      new Error("Unable to load the member directory. Please try again."),
    );
    render(<GroupsPage />);
    expect(await screen.findByRole("heading", { name: "Town Kids" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create group" }));
    const alert = screen.getByText("Unable to load members. Use Try again to reload them.");
    expect(alert.getAttribute("role")).toBe("alert");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocks.getMemberOverview).toHaveBeenCalledTimes(2));
  });

  it("shows the office's refusal of a guardian in the red band", async () => {
    mocks.saveMemberGroup.mockRejectedValue(
      new Error("Guardians can't be added to a group: Pat Parent"),
    );
    render(<GroupsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Town Kids" }));
    fireEvent.click(screen.getByRole("button", { name: "Save group" }));
    const alert = await screen.findByText("Guardians can't be added to a group: Pat Parent");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.getAttribute("data-error")).toBe("true");
  });
});
