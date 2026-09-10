import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";

const clientMocks = vi.hoisted(() => ({
  getMemberDetail: vi.fn(),
  getRegyfitMemberRecord: vi.fn(),
  listRegyfitMemberRecords: vi.fn(),
  lookupMemberIdentity: vi.fn(),
  updateMember: vi.fn(),
}));

vi.mock("../../../../lib/members-client", () => clientMocks);

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
  gender: "unknown",
  birthDate: "2019-06-12",
  age: 7,
  registrationDate: "2026-02-01",
  membershipState: "inactive",
  accountManager: "Synthetic Guardian",
  appAccess: { login: "a1", password: "104569", logins: 0, lastLogin: "----" },
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

  it("loads restricted detail only after an explicit action", async () => {
    const user = userEvent.setup();
    clientMocks.lookupMemberIdentity.mockResolvedValue({ matched: true, row });
    clientMocks.getMemberDetail.mockResolvedValue({
      studentId: "student-1",
      fullName: "Synthetic Adult",
      dateOfBirth: "1990-01-02",
      phoneNumber: "+44 7000 000000",
      email: "adult@example.test",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      participantType: "adult",
      active: true,
      status: "active",
      membershipNumber: "BPT 00000001",
      idCardNumber: "ID-0001",
      vatNumber: "VAT-0001",
      gender: "unknown",
      frequencyNote: "Twice weekly",
    });
    render(<SearchMembersPage />);
    await user.type(screen.getByLabelText("Exact identifier"), "BPT 00000001");
    await user.click(screen.getByRole("button", { name: "Search exact identifier" }));

    expect(await screen.findByText("Synthetic Adult")).toBeVisible();
    expect(clientMocks.getMemberDetail).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "View restricted details" }));

    await waitFor(() => expect(clientMocks.getMemberDetail).toHaveBeenCalledWith("student-1"));
    expect(await screen.findByText("adult@example.test")).toBeVisible();
    expect(screen.queryByText("admin")).not.toBeInTheDocument();
  });

  it("edits only a loaded detail and keeps the UUID stable for an exact retry", async () => {
    const user = userEvent.setup();
    clientMocks.lookupMemberIdentity.mockResolvedValue({ matched: true, row });
    clientMocks.getMemberDetail.mockResolvedValue({
      studentId: "student-1",
      fullName: "Synthetic Adult",
      dateOfBirth: "1990-01-02",
      phoneNumber: "+44 7000 000000",
      email: "adult@example.test",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      participantType: "adult",
      active: true,
      status: "active",
      membershipNumber: "BPT 00000001",
      gender: "unknown",
    });
    clientMocks.updateMember
      .mockRejectedValueOnce(new Error("private update failure"))
      .mockResolvedValueOnce({ memberId: "student-1", studentId: "student-1" });
    render(<SearchMembersPage />);

    await user.type(screen.getByLabelText("Exact identifier"), "BPT 00000001");
    await user.click(screen.getByRole("button", { name: "Search exact identifier" }));
    expect(await screen.findByText("Synthetic Adult")).toBeVisible();
    expect(screen.queryByRole("form", { name: "Edit member" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View restricted details" }));
    await user.click(await screen.findByRole("button", { name: "Edit member" }));

    const form = screen.getByRole("form", { name: "Edit member" });
    await user.clear(within(form).getByLabelText("Full name"));
    await user.type(within(form).getByLabelText("Full name"), "Updated Adult");
    await user.clear(within(form).getByLabelText("Email"));
    await user.type(within(form).getByLabelText("Email"), "updated@example.test");
    await user.click(within(form).getByRole("button", { name: "Save changes" }));

    const alert = await within(form.parentElement as HTMLElement).findByRole("alert");
    expect(alert).toHaveTextContent("Unable to update member. Please try again.");
    expect(alert).not.toHaveTextContent("private update failure");
    const firstRequest = clientMocks.updateMember.mock.calls[0]?.[0];
    expect(firstRequest).toEqual(
      expect.objectContaining({
        studentId: "student-1",
        requestId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
        ),
        fullName: "Updated Adult",
        email: "updated@example.test",
      }),
    );

    await user.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Member updated.")).toBeVisible();
    expect(clientMocks.updateMember.mock.calls[1]?.[0]?.requestId).toBe(firstRequest.requestId);
    expect(screen.queryByRole("form", { name: "Edit member" })).not.toBeInTheDocument();
    expect(screen.getByText("Updated Adult")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Edit member" }));
    await user.click(
      within(screen.getByRole("form", { name: "Edit member" })).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(screen.queryByRole("form", { name: "Edit member" })).not.toBeInTheDocument();
    expect(clientMocks.updateMember).toHaveBeenCalledTimes(2);
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
    expect(screen.getByText(/captured from Regyfit on 2026-09-04/)).toBeVisible();
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
    expect(within(profile).getByText("104569")).toBeVisible();
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
    expect(within(profile).getByText(/not part of the captured Regyfit record/)).toBeVisible();
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
});
