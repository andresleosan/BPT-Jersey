import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useInsertionEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  getMemberDetail: vi.fn(),
  lookupMemberIdentity: vi.fn(),
  updateMember: vi.fn(),
}));

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

vi.mock("../../../../lib/members-client", () => clientMocks);

const profileClientMocks = vi.hoisted(() => ({ searchMemberNames: vi.fn() }));
const gate = vi.hoisted(() => ({
  role: "owner" as "owner" | "administrator" | "headCoach" | "coach",
}));

vi.mock("../../../../lib/member-profile-client", () => profileClientMocks);
vi.mock("../../admin-gate", () => ({
  useAdminOrStaffSession: () => ({
    uid: "u-1",
    email: "u@example.test",
    displayName: "Test Staff",
    academyId: "academy-1",
    role: gate.role,
  }),
}));

import { SearchMembersPage } from "./page";

const row = {
  studentId: "student-1",
  fullName: "Synthetic Adult",
  trainingCenter: "Town" as const,
  participantType: "adult" as const,
  active: true,
  status: "active" as const,
  membershipReference: "****0001",
};

describe("Exact canonical member lookup page", () => {
  // The office reaches this lookup with `?archive`; without it the page sends the office to
  // /admin/members (469825b).
  beforeEach(() => {
    window.history.replaceState(null, "", "/admin/members/search?archive");
  });
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
    clientMocks.getMemberDetail.mockReset();
    clientMocks.lookupMemberIdentity.mockReset();
    clientMocks.updateMember.mockReset();
    router.replace.mockReset();
  });

  it("sends the office to Members when the address has no ?archive", () => {
    window.history.replaceState(null, "", "/admin/members/search");
    render(<SearchMembersPage />);

    expect(router.replace).toHaveBeenCalledWith("/admin/members");
  });

  // Next's router writes a link's new address in an insertion effect, after the page rendered
  // (HistoryUpdater in next/dist/client/components/app-router.js). This stands in for the
  // Migration tools link on /admin/members.
  it("keeps the office on the lookup when a link adds ?archive after the page rendered", () => {
    window.history.replaceState(null, "", "/admin/members");
    function LinkNavigation() {
      useInsertionEffect(() => {
        window.history.pushState(null, "", "/admin/members/search?archive");
      }, []);
      return null;
    }
    render(
      <>
        <SearchMembersPage />
        <LinkNavigation />
      </>,
    );

    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Exact identifier")).toBeVisible();
  });

  it("offers only the three approved exact identifiers and no legacy filters or reports", () => {
    render(<SearchMembersPage />);

    expect(screen.getByLabelText("Identifier type")).toBeVisible();
    expect(screen.getByRole("option", { name: "Membership number" })).toBeVisible();
    expect(screen.getByRole("option", { name: "ID card number" })).toBeVisible();
    expect(screen.getByRole("option", { name: "VAT number" })).toBeVisible();
    expect(screen.getByLabelText("Exact identifier")).toBeVisible();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Payment or status")).not.toBeInTheDocument();
    expect(screen.queryByText(/Download .* report/i)).not.toBeInTheDocument();
  });

  it("sends an exact purpose-bound lookup and renders only the minimized row", async () => {
    const user = userEvent.setup();
    clientMocks.lookupMemberIdentity.mockResolvedValue({ matched: true, row });
    render(<SearchMembersPage />);

    await user.type(screen.getByLabelText("Exact identifier"), "BPT 00000001");
    await user.click(screen.getByRole("button", { name: "Search exact identifier" }));

    await waitFor(() =>
      expect(clientMocks.lookupMemberIdentity).toHaveBeenCalledWith(
        "membership-number",
        "BPT 00000001",
      ),
    );
    const results = screen.getByRole("region", { name: "Member lookup result" });
    expect(within(results).getByText("Synthetic Adult")).toBeVisible();
    expect(within(results).getByText("****0001")).toBeVisible();
    expect(
      within(results).getByRole("link", { name: "Open record for Synthetic Adult" }),
    ).toHaveAttribute("href", "/admin/members/profile?id=student-1");
    expect(within(results).queryByRole("button", { name: "View restricted details" })).toBeNull();
    expect(results).not.toHaveTextContent("BPT 00000001");
    expect(results).not.toHaveTextContent(/email|vat|date of birth/i);
  });

  it("uses the selected lookup kind and announces a non-match without echoing the value", async () => {
    const user = userEvent.setup();
    clientMocks.lookupMemberIdentity.mockResolvedValue({ matched: false });
    render(<SearchMembersPage />);
    await user.selectOptions(screen.getByLabelText("Identifier type"), "vat-number");
    await user.type(screen.getByLabelText("Exact identifier"), "VAT-0001");
    await user.click(screen.getByRole("button", { name: "Search exact identifier" }));

    const status = await screen.findByRole("status", { name: "" });
    expect(status).toHaveTextContent("No matching student was found.");
    expect(status).not.toHaveTextContent("VAT-0001");
    expect(clientMocks.lookupMemberIdentity).toHaveBeenCalledWith("vat-number", "VAT-0001");
  });

  it("sanitizes lookup and detail failures", async () => {
    const user = userEvent.setup();
    clientMocks.lookupMemberIdentity.mockRejectedValue(new Error("private Firebase stack detail"));
    render(<SearchMembersPage />);
    await user.type(screen.getByLabelText("Exact identifier"), "BPT 00000001");
    await user.click(screen.getByRole("button", { name: "Search exact identifier" }));

    const alert = await screen.findByText("Unable to find member. Please try again.");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).not.toHaveTextContent("private Firebase stack detail");
  });
});

describe("canonical name search (T051V2)", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
    gate.role = "owner";
    profileClientMocks.searchMemberNames.mockReset();
    clientMocks.lookupMemberIdentity.mockReset();
  });

  it("leaves the name search to the mat: the office gets only the exact lookup, with no inline styles", () => {
    window.history.replaceState(null, "", "/admin/members/search?archive");
    const { container } = render(<SearchMembersPage />);
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).not.toContain("Find a member");
    expect(screen.queryByLabelText("Member name")).toBeNull();
    expect(headings).toEqual(["Find by identifier"]);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    expect(container.querySelectorAll(".admin-status-badge")).toHaveLength(0);
  });

  it("lists matching members with an inline Open record link", async () => {
    gate.role = "coach";
    const user = userEvent.setup();
    profileClientMocks.searchMemberNames.mockResolvedValue([
      { studentId: "student-2", fullName: "Test Member B" },
    ]);
    render(<SearchMembersPage />);
    await user.type(screen.getByLabelText("Member name"), "test");
    await user.click(screen.getByRole("button", { name: "Search" }));

    const results = await screen.findByRole("region", { name: "Member search results" });
    expect(await within(results).findByText("Test Member B")).toBeVisible();
    expect(
      within(results).getByRole("link", { name: "Open record for Test Member B" }),
    ).toHaveAttribute("href", "/admin/members/profile?id=student-2");
    expect(profileClientMocks.searchMemberNames).toHaveBeenCalledWith("test");
  });

  // The reused record skeleton is far taller than a one-line name list (DESIGN.md §4:
  // a skeleton matches the real dimensions of what it stands in for).
  it("reserves a one-line row while searching, not a record panel", async () => {
    gate.role = "coach";
    const user = userEvent.setup();
    profileClientMocks.searchMemberNames.mockReturnValue(new Promise(() => {}));
    render(<SearchMembersPage />);

    await user.type(screen.getByLabelText("Member name"), "test");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect((await screen.findByRole("status", { name: "Searching members" })).className).toBe(
      "member-record-skeleton member-search-skeleton",
    );
  });

  it("asks for two letters and explains an empty or failed search", async () => {
    gate.role = "coach";
    const user = userEvent.setup();
    profileClientMocks.searchMemberNames
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("raw backend detail"));
    render(<SearchMembersPage />);

    await user.type(screen.getByLabelText("Member name"), "t");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Type at least two letters of a name.");
    expect(profileClientMocks.searchMemberNames).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Member name"), "e");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("heading", { name: "No member found" })).toBeVisible();
    // DESIGN.md §4: one primary button closes an empty state.
    expect(screen.getByRole("button", { name: "Clear search" }).className).toBe(
      "member-record-button",
    );

    await user.click(screen.getByRole("button", { name: "Search" }));
    const alert = await screen.findByText("Unable to search members. Please try again.");
    expect(alert).not.toHaveTextContent("raw backend detail");
  });

  it("gives coaches the name search only and never calls office reads", async () => {
    for (const role of ["headCoach", "coach"] as const) {
      gate.role = role;
      render(<SearchMembersPage />);
      expect(screen.getByLabelText("Member name")).toBeVisible();
      expect(screen.queryByLabelText("Exact identifier")).toBeNull();
      expect(screen.queryByText("Previous member records")).toBeNull();
      expect(clientMocks.lookupMemberIdentity).not.toHaveBeenCalled();
      cleanup();
    }
  });
});
