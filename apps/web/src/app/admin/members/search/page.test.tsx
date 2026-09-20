import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";

const clientMocks = vi.hoisted(() => ({
  getMemberDetail: vi.fn(),
  getRegyfitMemberRecord: vi.fn(),
  listRegyfitMemberRecords: vi.fn(),
  lookupMemberIdentity: vi.fn(),
  revealRegyfitRecordField: vi.fn(),
  updateMember: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("../../../../lib/members-client", () => clientMocks);
vi.mock("../../../../lib/subscription-admin-client", () => ({
  resolveImportedSubscription: vi.fn(async () => ({ studentId: null })),
}));

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

const regyfitRecord: RegyfitMemberRecord = {
  recordId: "152",
  memberNumber: "1",
  fullName: "Synthetic Child",
  email: "guardian@example.test",
  mobile: "00447700000000",
  country: "Jersey",
  idCardNumber: "•••789",
  gender: "unknown",
  birthDate: "2019-06-12",
  age: 7,
  registrationDate: "2026-02-01",
  membershipState: "inactive",
  accountManager: "Synthetic Guardian",
  appAccess: { login: "a1", logins: 0, lastLogin: "----" },
  graduation: {
    modality: "JIU-JITSU - IBJJF",
    belt: "Grey 4-5 and 5-7yo - 5th Stripe",
    nextGraduationDate: "24 Apr 2026",
    progressPercent: 50,
    classesProgress: "0/4",
    daysProgress: "132/30",
  },
  plan: { paymentMode: "Inactive", amount: "95.00", validUntil: "2026-07-25" },
  attendance: {
    registrations: 18,
    attended: 10,
    absences: 7,
    thisMonth: 0,
    last30Days: 0,
    lastAttendance: "134 days ago",
    records: [
      { date: "26 May 2026", time: "17:30 - 18:15", className: "Strive Kids", status: "absent" },
      { date: "21 Apr 2026", time: "17:30 - 18:15", className: "Strive Kids", status: "present" },
    ],
  },
  payments: [{ date: "05 May 2026", description: "Fees", amount: "£ 95.00" }],
  capturedAt: "2026-09-04T18:04:32.000Z",
  source: "regyfit-admin-capture",
  schemaVersion: "1",
};

const directoryPage = {
  rows: [
    {
      recordId: "152",
      memberNumber: "1",
      fullName: "Synthetic Child",
      email: "guardian@example.test",
      birthDate: "2019-06-12",
      membershipState: "inactive" as const,
      paymentMode: "Inactive",
      belt: "Grey 4-5 and 5-7yo - 5th Stripe",
    },
    {
      recordId: "300",
      fullName: "Unnumbered Adult",
      membershipState: "active" as const,
      paymentMode: "Livre-trânsito",
    },
  ],
  total: 2,
  capturedAt: "2026-09-04T18:04:32.000Z",
};

describe("Exact canonical member lookup page", () => {
  afterEach(() => {
    cleanup();
    clientMocks.getMemberDetail.mockReset();
    clientMocks.getRegyfitMemberRecord.mockReset();
    clientMocks.listRegyfitMemberRecords.mockReset();
    clientMocks.lookupMemberIdentity.mockReset();
    clientMocks.revealRegyfitRecordField.mockReset();
    clientMocks.updateMember.mockReset();
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

describe("Regyfit academy member directory", () => {
  afterEach(() => {
    cleanup();
    clientMocks.getMemberDetail.mockReset();
    clientMocks.getRegyfitMemberRecord.mockReset();
    clientMocks.listRegyfitMemberRecords.mockReset();
    clientMocks.lookupMemberIdentity.mockReset();
    clientMocks.updateMember.mockReset();
  });

  it("loads the directory from the authenticated callable and never ships records in the page", async () => {
    clientMocks.listRegyfitMemberRecords.mockResolvedValue(directoryPage);
    render(<SearchMembersPage />);

    expect(screen.getByText("Loading academy directory...")).toBeVisible();
    expect(await screen.findByText("Synthetic Child")).toBeVisible();
    expect(clientMocks.listRegyfitMemberRecords).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Total: 2")).toBeVisible();
    expect(screen.getByText("Active: 1")).toBeVisible();
    expect(screen.getByText("No number: 1")).toBeVisible();
    expect(screen.getByText(/Records imported on 2026-09-04/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Open full record for Unnumbered Adult" }),
    ).toHaveTextContent("#300");
    expect(document.body).not.toHaveTextContent("104569");
  });

  it("filters by text, state and payment mode", async () => {
    const user = userEvent.setup();
    clientMocks.listRegyfitMemberRecords.mockResolvedValue(directoryPage);
    render(<SearchMembersPage />);
    await screen.findByText("Synthetic Child");

    await user.type(screen.getByLabelText("Search members"), "guardian@");
    expect(screen.queryByText("Unnumbered Adult")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search members"));
    await user.selectOptions(screen.getByLabelText("Status filter"), "active");
    expect(screen.queryByText("Synthetic Child")).not.toBeInTheDocument();
    expect(screen.getByText("Unnumbered Adult")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("Payment"), "Inactive");
    expect(screen.getByText("No members match your search criteria.")).toBeVisible();
  });

  it("surfaces a sanitized directory failure with a retry", async () => {
    const user = userEvent.setup();
    clientMocks.listRegyfitMemberRecords
      .mockRejectedValueOnce(new Error("private callable failure"))
      .mockResolvedValueOnce(directoryPage);
    render(<SearchMembersPage />);

    const alert = await screen.findByText(
      "Unable to load the academy directory. Please try again.",
    );
    expect(alert).not.toHaveTextContent("private callable failure");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Synthetic Child")).toBeVisible();
  });

  it("opens the full Regyfit record when a member number is clicked", async () => {
    const user = userEvent.setup();
    clientMocks.listRegyfitMemberRecords.mockResolvedValue(directoryPage);
    clientMocks.getRegyfitMemberRecord.mockResolvedValue(regyfitRecord);
    render(<SearchMembersPage />);
    await screen.findByText("Synthetic Child");

    await user.click(screen.getByRole("button", { name: "Open full record for Synthetic Child" }));

    await waitFor(() => expect(clientMocks.getRegyfitMemberRecord).toHaveBeenCalledWith("152"));
    const profile = await screen.findByRole("region", { name: "Synthetic Child" });
    expect(within(profile).getByRole("tab", { name: "Profile" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(profile).getByText("134 days ago")).toBeVisible();
    expect(within(profile).queryByText("Password")).not.toBeInTheDocument();
    expect(within(profile).getByText("Grey 4-5 and 5-7yo - 5th Stripe")).toBeVisible();
    expect(within(profile).getByText("Synthetic Guardian")).toBeVisible();
    expect(screen.getByLabelText("Exact identifier")).toHaveValue("1");

    await user.click(within(profile).getByRole("tab", { name: "Details" }));
    expect(within(profile).getByText("guardian@example.test")).toBeVisible();
    await user.click(within(profile).getByRole("tab", { name: "Payments" }));
    expect(within(profile).getByText("£ 95.00")).toBeVisible();
    await user.click(within(profile).getByRole("tab", { name: "Classes" }));
    expect(within(profile).getAllByText("Strive Kids", { selector: "td" })).toHaveLength(2);
    await user.click(within(profile).getByRole("tab", { name: "Communication" }));
    expect(within(profile).getByText(/not part of the imported record/)).toBeVisible();
  });

  it("runs the canonical lookup from the record and closes it", async () => {
    const user = userEvent.setup();
    clientMocks.listRegyfitMemberRecords.mockResolvedValue(directoryPage);
    clientMocks.getRegyfitMemberRecord.mockResolvedValue(regyfitRecord);
    clientMocks.lookupMemberIdentity.mockResolvedValue({ matched: true, row });
    render(<SearchMembersPage />);
    await screen.findByText("Synthetic Child");
    await user.click(screen.getByRole("button", { name: "Open full record for Synthetic Child" }));
    const profile = await screen.findByRole("region", { name: "Synthetic Child" });

    await user.click(within(profile).getByRole("button", { name: "Load canonical record" }));
    await waitFor(() =>
      expect(clientMocks.lookupMemberIdentity).toHaveBeenCalledWith("membership-number", "1"),
    );

    await user.click(within(profile).getByRole("button", { name: "Close profile" }));
    expect(screen.queryByRole("region", { name: "Synthetic Child" })).not.toBeInTheDocument();
  });

  it("sanitizes a record load failure", async () => {
    const user = userEvent.setup();
    clientMocks.listRegyfitMemberRecords.mockResolvedValue(directoryPage);
    clientMocks.getRegyfitMemberRecord.mockRejectedValue(new Error("private record failure"));
    render(<SearchMembersPage />);
    await screen.findByText("Synthetic Child");

    await user.click(screen.getByRole("button", { name: "Open full record for Synthetic Child" }));

    const alert = await screen.findByText("Unable to load the member record. Please try again.");
    expect(alert).not.toHaveTextContent("private record failure");
  });

  it("shows restricted identifiers masked and reveals one on an explicit action", async () => {
    const user = userEvent.setup();
    clientMocks.listRegyfitMemberRecords.mockResolvedValue(directoryPage);
    clientMocks.getRegyfitMemberRecord.mockResolvedValue(regyfitRecord);
    clientMocks.revealRegyfitRecordField.mockResolvedValue("ID-000789");
    render(<SearchMembersPage />);
    await screen.findByText("Synthetic Child");
    await user.click(screen.getByRole("button", { name: "Open full record for Synthetic Child" }));
    const profile = await screen.findByRole("region", { name: "Synthetic Child" });

    await user.click(within(profile).getByRole("tab", { name: "Details" }));
    expect(within(profile).getByText("•••789")).toBeVisible();
    expect(clientMocks.revealRegyfitRecordField).not.toHaveBeenCalled();
    expect(
      within(profile).queryByRole("button", { name: "Reveal VAT number" }),
    ).not.toBeInTheDocument();

    await user.click(within(profile).getByRole("button", { name: "Reveal ID card Nº" }));

    expect(clientMocks.revealRegyfitRecordField).toHaveBeenCalledWith("152", "idCardNumber");
    expect(await within(profile).findByText("ID-000789")).toBeVisible();
    expect(
      within(profile).queryByRole("button", { name: "Reveal ID card Nº" }),
    ).not.toBeInTheDocument();
    expect(window.location.href).not.toContain("ID-000789");
  });

  it("sanitizes a reveal failure next to the field", async () => {
    const user = userEvent.setup();
    clientMocks.listRegyfitMemberRecords.mockResolvedValue(directoryPage);
    clientMocks.getRegyfitMemberRecord.mockResolvedValue(regyfitRecord);
    clientMocks.revealRegyfitRecordField.mockRejectedValue(
      new Error("Too many restricted reads. Wait five minutes and try again."),
    );
    render(<SearchMembersPage />);
    await screen.findByText("Synthetic Child");
    await user.click(screen.getByRole("button", { name: "Open full record for Synthetic Child" }));
    const profile = await screen.findByRole("region", { name: "Synthetic Child" });
    await user.click(within(profile).getByRole("tab", { name: "Details" }));

    await user.click(within(profile).getByRole("button", { name: "Reveal ID card Nº" }));

    expect(await within(profile).findByRole("alert")).toHaveTextContent(
      "Too many restricted reads. Wait five minutes and try again.",
    );
    expect(within(profile).getByText("•••789")).toBeVisible();
  });
});

describe("canonical name search (T051V2)", () => {
  afterEach(() => {
    cleanup();
    gate.role = "owner";
    profileClientMocks.searchMemberNames.mockReset();
    clientMocks.listRegyfitMemberRecords.mockReset();
    clientMocks.lookupMemberIdentity.mockReset();
  });

  it("leaves the name search to the mat: the office gets the read-only archive last, with no inline styles", async () => {
    clientMocks.listRegyfitMemberRecords.mockResolvedValue(directoryPage);
    const { container } = render(<SearchMembersPage />);
    await screen.findByText("Synthetic Child");
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).not.toContain("Find a member");
    expect(screen.queryByLabelText("Member name")).toBeNull();
    expect(headings.indexOf("Previous member records")).toBe(headings.length - 1);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    expect(container.querySelectorAll(".admin-status-badge")).toHaveLength(0);
  });

  it("lists matching members with an inline Open record link", async () => {
    gate.role = "coach";
    const user = userEvent.setup();
    profileClientMocks.searchMemberNames.mockResolvedValue([
      { studentId: "student-2", fullName: "Test Member B" },
    ]);
    clientMocks.listRegyfitMemberRecords.mockResolvedValue(directoryPage);
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
    clientMocks.listRegyfitMemberRecords.mockResolvedValue(directoryPage);
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
    clientMocks.listRegyfitMemberRecords.mockResolvedValue(directoryPage);
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
      expect(clientMocks.listRegyfitMemberRecords).not.toHaveBeenCalled();
      cleanup();
    }
  });
});
