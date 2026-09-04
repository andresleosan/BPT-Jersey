import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  getMemberDetail: vi.fn(),
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

describe("Exact canonical member lookup page", () => {
  afterEach(() => {
    cleanup();
    clientMocks.getMemberDetail.mockReset();
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

    const status = await screen.findByRole("status");
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

    const alert = await screen.findByRole("alert");
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
    expect(await screen.findByRole("status")).toHaveTextContent("Member updated.");
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

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to find member. Please try again.");
    expect(alert).not.toHaveTextContent("private Firebase stack detail");
  });
});
