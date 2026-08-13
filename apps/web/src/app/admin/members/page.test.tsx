import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({ searchMembers: vi.fn() }));

vi.mock("../../../lib/members-client", () => clientMocks);

import { MembersPage } from "./page";

const member = {
  memberId: "member-1",
  membershipNumber: "M-001",
  fullName: "Alex Johnson",
  email: "alex@example.test",
  idCardNumber: "ID-001",
  vatNumber: "VAT-001",
  birthDate: "1990-01-02",
  mobileNumber: "+441234567890",
  frequency: "twice-weekly",
  paymentStatus: "regularized" as const,
  gender: "unknown" as const,
  trainingCenter: "Main Center",
  membershipStatus: "active" as const,
  createdAt: "2026-08-11T10:00:00.000Z",
  updatedAt: "2026-08-11T10:00:00.000Z",
  source: "staging-import",
  schemaVersion: "1" as const,
};

describe("members landing page", () => {
  afterEach(() => {
    cleanup();
    clientMocks.searchMembers.mockReset();
  });

  it("loads connected member data and renders the approved fields", async () => {
    let resolveSearch!: (value: { members: (typeof member)[] }) => void;
    clientMocks.searchMembers.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );

    render(<MembersPage />);

    expect(screen.getByRole("heading", { name: "Members" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Loading members...");
    await waitFor(() =>
      expect(clientMocks.searchMembers).toHaveBeenCalledWith({ orderBy: "name" }),
    );

    resolveSearch({ members: [member] });

    expect(await screen.findByRole("table", { name: "Member directory" })).toBeVisible();
    expect(screen.getByText("Membership number")).toBeVisible();
    expect(screen.getByText("Alex Johnson")).toBeVisible();
    expect(screen.getByText("Staging import")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add new member" })).toHaveAttribute(
      "href",
      "/admin/members/add",
    );
    expect(screen.getByRole("link", { name: "Search members" })).toHaveAttribute(
      "href",
      "/admin/members/search",
    );
  });

  it("renders an empty state when the callable returns no members", async () => {
    clientMocks.searchMembers.mockResolvedValue({ members: [] });

    render(<MembersPage />);

    expect(await screen.findByText("No members available.")).toBeVisible();
  });

  it("renders a safe error when the callable fails", async () => {
    clientMocks.searchMembers.mockRejectedValue(new Error("private Firebase detail"));

    render(<MembersPage />);

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Unable to load members. Please try again.");
    expect(error).not.toHaveTextContent("private Firebase detail");
  });

  it("requests the next page only when the signed page token exists", async () => {
    const user = userEvent.setup();
    clientMocks.searchMembers
      .mockResolvedValueOnce({ members: [], nextPageToken: "next-token" })
      .mockResolvedValueOnce({ members: [member] });

    render(<MembersPage />);

    const nextPage = await screen.findByRole("button", { name: "Next page" });
    await user.click(nextPage);

    await waitFor(() =>
      expect(clientMocks.searchMembers).toHaveBeenLastCalledWith({ orderBy: "name" }, "next-token"),
    );
    expect(await screen.findByText("Alex Johnson")).toBeVisible();
  });
});
