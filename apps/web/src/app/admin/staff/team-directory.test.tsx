import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamDirectoryContent } from "./team-directory";
const api = vi.hoisted(() => ({
  listTeamDirectory: vi.fn(),
  changeTeamRole: vi.fn(),
  createStaffWithPassword: vi.fn(),
  listStaffInvitations: vi.fn(),
  cancelStaffInvitation: vi.fn(),
}));
vi.mock("../../../lib/team-access-client", () => api);
const session = {
  uid: "owner",
  academyId: "academy-1",
  email: "owner@example.test",
  displayName: "Academy owner",
  role: "owner" as const,
};
const people = [
  { userId: "owner", name: "Academy owner", email: "owner@example.test", role: "owner" },
  { userId: "coach", name: "Academy coach", email: "coach@example.test", role: "coach" },
];
beforeEach(() => {
  vi.resetAllMocks();
  api.listTeamDirectory.mockResolvedValue({ people, nextPageToken: null });
  api.listStaffInvitations.mockResolvedValue([]);
  api.changeTeamRole.mockResolvedValue({ changed: true });
});
afterEach(cleanup);
describe("team directory", () => {
  it("keeps an email-less coach unchanged when saving fails and allows retry", async () => {
    api.listTeamDirectory.mockResolvedValue({
      people: [{ ...people[1], email: null }],
      nextPageToken: null,
    });
    api.changeTeamRole.mockRejectedValueOnce(
      new Error("Unable to change this role. Please retry."),
    );
    const user = userEvent.setup();
    render(<TeamDirectoryContent session={session} />);
    await user.click(await screen.findByRole("button", { name: "Change role for Academy coach" }));
    await user.click(screen.getByRole("button", { name: "Review role change" }));
    await user.click(screen.getByRole("button", { name: "Confirm access" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to change this role");
    expect(within(screen.getByRole("table")).getByText("Coach")).toBeVisible();
    expect(screen.queryByText(/Role changed to/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Confirm access" }));
    expect(await screen.findByText(/Role changed to Administrator/)).toBeVisible();
  });

  it.each(["administrator", "owner"])("promotes a coach without email to %s", async (role) => {
    api.listTeamDirectory.mockResolvedValue({
      people: [{ ...people[1], email: null }],
      nextPageToken: null,
    });
    const user = userEvent.setup();
    render(<TeamDirectoryContent session={session} />);
    const change = await screen.findByRole("button", { name: "Change role for Academy coach" });
    expect(change).toBeEnabled();
    await user.click(change);
    await user.selectOptions(screen.getByLabelText("New role"), role);
    await user.click(screen.getByRole("button", { name: "Review role change" }));
    expect(screen.getByText(/will receive/)).toHaveTextContent("Academy coach");
    await user.click(screen.getByRole("button", { name: "Confirm access" }));
    await waitFor(() =>
      expect(api.changeTeamRole).toHaveBeenCalledWith({ userId: "coach", email: null, role }),
    );
    expect(await screen.findByText(/Role changed to/)).toBeVisible();
  });
  it("shows name, email and role, with no separate profile page", async () => {
    const user = userEvent.setup();
    render(
      <TeamDirectoryContent
        session={{ ...session, uid: "administrator", role: "administrator" }}
      />,
    );
    const table = await screen.findByRole("table", { name: "Team directory" });
    expect(within(table).getByText("Academy coach")).toBeVisible();
    expect(within(table).getByText("coach@example.test")).toBeVisible();
    expect(within(table).getByText("Coach")).toBeVisible();
    expect(screen.getByRole("button", { name: "Change role for Academy coach" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Change role for Academy owner" })).toBeNull();
    expect(within(table).getByText("Owner account")).toBeVisible();
    await user.click(screen.getByText("New staff account"));
    expect(screen.getByLabelText("Direct staff email")).toBeVisible();
    expect(screen.getByLabelText("Direct staff role")).toHaveValue("coach");
    expect(
      within(screen.getByLabelText("Direct staff role")).queryByRole("option", { name: "Owner" }),
    ).toBeNull();
    expect(api.listStaffInvitations).not.toHaveBeenCalled();
  });
  it("requires review before changing a role and never offers self-promotion", async () => {
    const user = userEvent.setup();
    render(<TeamDirectoryContent session={session} />);
    await user.click(await screen.findByRole("button", { name: "Change role for Academy coach" }));
    expect(screen.queryByRole("button", { name: "Change role for Academy owner" })).toBeNull();
    expect(screen.getByLabelText("New role")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Review role change" }));
    expect(api.changeTeamRole).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirm access" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Confirm access" }));
    await waitFor(() =>
      expect(api.changeTeamRole).toHaveBeenCalledWith({
        userId: "coach",
        email: "coach@example.test",
        role: "administrator",
      }),
    );
    expect(await screen.findByText(/Role changed to Administrator/)).toBeVisible();
  });
  it("creates staff access for an email and role only when the form is submitted", async () => {
    api.createStaffWithPassword.mockResolvedValue({
      userId: "new-owner",
      email: "new@example.test",
      role: "owner",
      passwordChangeRequired: true,
    });
    const user = userEvent.setup();
    render(<TeamDirectoryContent session={session} />);
    await screen.findByRole("table");
    await user.click(screen.getByText("New staff account"));
    await user.type(screen.getByLabelText("Full name"), "New owner");
    await user.type(screen.getByLabelText("Direct staff email"), "NEW@example.test");
    await user.type(screen.getByLabelText("Initial password"), "synthetic-password");
    await user.selectOptions(screen.getByLabelText("Direct staff role"), "owner");
    expect(api.createStaffWithPassword).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Create staff account" }));
    await waitFor(() =>
      expect(api.createStaffWithPassword).toHaveBeenCalledWith({
        displayName: "New owner",
        email: "new@example.test",
        password: "synthetic-password",
        role: "owner",
      }),
    );
    expect(await screen.findByText(/Staff account created/)).toBeVisible();
    expect(api.listTeamDirectory).toHaveBeenCalledTimes(2);
  });
  it("shows safe errors and permits retry after a failed directory read", async () => {
    api.listTeamDirectory.mockRejectedValueOnce(new Error("private internal message"));
    const user = userEvent.setup();
    render(<TeamDirectoryContent session={session} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load the team directory");
    expect(screen.queryByText("private internal message")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Refresh team" }));
    expect(await screen.findByRole("table", { name: "Team directory" })).toBeVisible();
  });
  it("distinguishes loading from an empty page and follows the continuation token", async () => {
    let finish!: (value: unknown) => void;
    api.listTeamDirectory.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<TeamDirectoryContent session={session} />);
    expect(screen.getByText("Loading team directory…")).toBeVisible();
    finish({ people: [], nextPageToken: "next" });
    await user.click(await screen.findByRole("button", { name: "Load more accounts" }));
    expect(api.listTeamDirectory).toHaveBeenLastCalledWith("next");
    expect(await screen.findByText("coach@example.test")).toBeVisible();
  });
});
