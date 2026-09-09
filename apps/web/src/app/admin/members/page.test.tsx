import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  listMembers: vi.fn(),
  initializeMemberDirectory: vi.fn(),
  // Declared in here because the mock factory runs before the module body: a class declared
  // outside would still be in its temporal dead zone when the factory asks for it.
  MemberDirectoryUninitializedError: class extends Error {
    constructor() {
      super("The member directory of this academy has not been initialized.");
      this.name = "MemberDirectoryUninitializedError";
    }
  },
  MemberDirectoryNotProvisionedError: class extends Error {
    constructor() {
      super("Your administrator account is not fully provisioned.");
      this.name = "MemberDirectoryNotProvisionedError";
    }
  },
}));

vi.mock("../../../lib/members-client", () => clientMocks);

import { MembersPage } from "./page";

const member = {
  studentId: "student-1",
  membershipReference: "****1234",
  fullName: "Alex Johnson",
  trainingCenter: "Town" as const,
  participantType: "adult" as const,
  active: true,
  status: "active" as const,
  email: "alex.private@example.test",
  idCardNumber: "ID-PRIVATE-001",
  vatNumber: "VAT-PRIVATE-001",
  dateOfBirth: "1990-01-02",
  phoneNumber: "+441234567890",
  paymentStatus: "GBP 99 overdue",
  reportSummary: "Private progress report",
};

describe("members landing page", () => {
  afterEach(() => {
    cleanup();
    clientMocks.listMembers.mockReset();
    clientMocks.initializeMemberDirectory.mockReset();
  });

  it("loads only the minimized canonical directory columns", async () => {
    let resolveList!: (value: { rows: (typeof member)[] }) => void;
    clientMocks.listMembers.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );

    render(<MembersPage />);

    expect(screen.getByRole("heading", { name: "Members" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Loading members...");
    await waitFor(() => expect(clientMocks.listMembers).toHaveBeenCalledWith(50));

    resolveList({ rows: [member] });

    expect(await screen.findByRole("table", { name: "Member directory" })).toBeVisible();
    expect(
      screen
        .getAllByRole("button", { name: /^Sort by/u })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Sort by Membership reference ascending",
      "Sort by Name ascending",
      "Sort by Training center ascending",
      "Sort by Participant type ascending",
      "Sort by Active ascending",
      "Sort by Status ascending",
    ]);
    expect(screen.getByText("****1234")).toBeVisible();
    expect(screen.getByText("Alex Johnson")).toBeVisible();
    expect(screen.getByText("Town")).toBeVisible();
    expect(screen.getByText("adult")).toBeVisible();
    expect(screen.getByText("Yes")).toBeVisible();
    expect(screen.getByText("active")).toBeVisible();
    expect(screen.queryByText("student-1")).not.toBeInTheDocument();
    expect(screen.queryByText("alex.private@example.test")).not.toBeInTheDocument();
    expect(screen.queryByText("ID-PRIVATE-001")).not.toBeInTheDocument();
    expect(screen.queryByText("VAT-PRIVATE-001")).not.toBeInTheDocument();
    expect(screen.queryByText("1990-01-02")).not.toBeInTheDocument();
    expect(screen.queryByText("+441234567890")).not.toBeInTheDocument();
    expect(screen.queryByText("GBP 99 overdue")).not.toBeInTheDocument();
    expect(screen.queryByText("Private progress report")).not.toBeInTheDocument();
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

  it("renders an empty state when the callable returns no rows", async () => {
    clientMocks.listMembers.mockResolvedValue({ rows: [] });

    render(<MembersPage />);

    expect(await screen.findByText("No members available.")).toBeVisible();
  });

  it("renders a safe error when the callable fails", async () => {
    clientMocks.listMembers.mockRejectedValue(new Error("private Firebase detail"));

    render(<MembersPage />);

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Unable to load members. Please try again.");
    expect(error).not.toHaveTextContent("private Firebase detail");
    expect(
      screen.queryByRole("button", { name: "Initialize the member directory" }),
    ).not.toBeInTheDocument();
  });

  it("offers to initialize the directory only when that is the actual cause", async () => {
    clientMocks.listMembers.mockRejectedValue(new clientMocks.MemberDirectoryUninitializedError());

    render(<MembersPage />);

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("has not been initialized");
    expect(
      screen.getByRole("button", { name: "Initialize the member directory" }),
    ).toBeInTheDocument();
  });

  it("reloads the directory after initializing it", async () => {
    const user = userEvent.setup();
    clientMocks.listMembers.mockRejectedValueOnce(
      new clientMocks.MemberDirectoryUninitializedError(),
    );
    clientMocks.initializeMemberDirectory.mockResolvedValue({
      academyId: "demo-academy",
      alreadyInitialized: false,
    });
    clientMocks.listMembers.mockResolvedValue({ rows: [member] });

    render(<MembersPage />);
    await user.click(
      await screen.findByRole("button", { name: "Initialize the member directory" }),
    );

    expect(await screen.findByText("Alex Johnson")).toBeInTheDocument();
    expect(clientMocks.initializeMemberDirectory).toHaveBeenCalledTimes(1);
  });

  it("shows why initializing was refused instead of failing silently", async () => {
    const user = userEvent.setup();
    clientMocks.listMembers.mockRejectedValue(new clientMocks.MemberDirectoryUninitializedError());
    clientMocks.initializeMemberDirectory.mockRejectedValue(
      new Error("Member directory is not empty: students"),
    );

    render(<MembersPage />);
    await user.click(
      await screen.findByRole("button", { name: "Initialize the member directory" }),
    );

    expect(await screen.findByText("Member directory is not empty: students")).toBeInTheDocument();
  });

  it("names an unprovisioned account without offering a button that would not help", async () => {
    clientMocks.listMembers.mockRejectedValue(new clientMocks.MemberDirectoryNotProvisionedError());

    render(<MembersPage />);

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("not fully provisioned");
    expect(
      screen.queryByRole("button", { name: "Initialize the member directory" }),
    ).not.toBeInTheDocument();
  });

  it("requests the next page using only the opaque next cursor", async () => {
    const user = userEvent.setup();
    const nextMember = {
      ...member,
      studentId: "student-2",
      membershipReference: "****5678",
      fullName: "Bea Smith",
    };
    clientMocks.listMembers
      .mockResolvedValueOnce({ rows: [member], nextCursor: "signed-next-cursor" })
      .mockResolvedValueOnce({ rows: [nextMember] });

    render(<MembersPage />);

    const nextPage = await screen.findByRole("button", { name: "Next page" });
    await user.click(nextPage);

    await waitFor(() =>
      expect(clientMocks.listMembers).toHaveBeenLastCalledWith(50, "signed-next-cursor"),
    );
    expect(await screen.findByText("Bea Smith")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
  });
});
