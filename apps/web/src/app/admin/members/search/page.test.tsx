import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  getMemberReport: vi.fn(),
  getMemberReportPdf: vi.fn(),
  getMemberReportSummary: vi.fn(),
  searchMembers: vi.fn(),
}));

vi.mock("../../../../lib/members-client", () => clientMocks);

import { SearchMembersPage } from "./page";

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
  source: "admin",
  schemaVersion: "1" as const,
};

describe("Search members page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    clientMocks.getMemberReport.mockReset();
    clientMocks.getMemberReportPdf.mockReset();
    clientMocks.getMemberReportSummary.mockReset();
    clientMocks.searchMembers.mockReset();
  });

  it("renders all eleven filters, order selection, and eight report counters", () => {
    render(<SearchMembersPage />);

    [
      "Membership number",
      "Name",
      "Email",
      "ID card number",
      "VAT number",
      "Mobile number",
      "Frequency",
      "Payment or status",
      "Gender",
      "Training center",
      "Order by",
    ].forEach((label) => expect(screen.getByLabelText(label)).toBeVisible());
    expect(screen.getByRole("button", { name: "SEARCH" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /Download .* report/ })).toHaveLength(8);
  });

  it("defers the search and sends the exact approved filters", async () => {
    const user = userEvent.setup();
    clientMocks.searchMembers.mockResolvedValue({ members: [member] });
    clientMocks.getMemberReportSummary.mockImplementation((report: string) =>
      Promise.resolve({ report, count: 0 }),
    );
    render(<SearchMembersPage />);

    expect(clientMocks.searchMembers).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Membership number"), "M-001");
    await user.type(screen.getByLabelText("Name"), "Alex");
    await user.type(screen.getByLabelText("Email"), "alex@example.test");
    await user.type(screen.getByLabelText("ID card number"), "ID-001");
    await user.type(screen.getByLabelText("VAT number"), "VAT-001");
    await user.type(screen.getByLabelText("Mobile number"), "+441234567890");
    await user.type(screen.getByLabelText("Frequency"), "twice-weekly");
    await user.selectOptions(screen.getByLabelText("Payment or status"), "active");
    await user.selectOptions(screen.getByLabelText("Gender"), "unknown");
    await user.type(screen.getByLabelText("Training center"), "Main Center");
    await user.selectOptions(screen.getByLabelText("Order by"), "registrationDate");
    await user.click(screen.getByRole("button", { name: "SEARCH" }));

    await waitFor(() => expect(clientMocks.searchMembers).toHaveBeenCalledOnce());
    expect(clientMocks.searchMembers).toHaveBeenCalledWith({
      membershipNumber: "M-001",
      name: "Alex",
      email: "alex@example.test",
      idCardNumber: "ID-001",
      vatNumber: "VAT-001",
      mobileNumber: "+441234567890",
      frequency: "twice-weekly",
      paymentOrStatus: "active",
      gender: "unknown",
      trainingCenter: "Main Center",
      orderBy: "registrationDate",
    });
    expect(await screen.findByRole("row", { name: /Alex Johnson/ })).toBeVisible();
    expect(clientMocks.getMemberReport).not.toHaveBeenCalled();
    expect(clientMocks.getMemberReportSummary).toHaveBeenCalledTimes(8);
  }, 15000);

  it("opens only the signed URL returned by the PDF callable", async () => {
    const user = userEvent.setup();
    const locationReplace = vi.fn();
    const reportWindow = { location: { replace: locationReplace }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(reportWindow as never);
    clientMocks.getMemberReportPdf.mockResolvedValue({
      downloadUrl: "https://signed.example/active.pdf",
      expiresAt: "2026-08-11T12:05:00.000Z",
    });
    render(<SearchMembersPage />);

    await user.click(screen.getByRole("button", { name: "Download active members report" }));

    expect(open).toHaveBeenCalledWith("", "_blank", "noopener,noreferrer");
    await waitFor(() => expect(clientMocks.getMemberReportPdf).toHaveBeenCalledWith("active"));
    expect(locationReplace).toHaveBeenCalledWith("https://signed.example/active.pdf");
  });

  it("renders empty state and supports continuation pagination", async () => {
    const user = userEvent.setup();
    clientMocks.searchMembers
      .mockResolvedValueOnce({ members: [], nextPageToken: "next-token" })
      .mockResolvedValueOnce({ members: [member] });
    clientMocks.getMemberReportSummary.mockImplementation((report: string) =>
      Promise.resolve({ report, count: 0 }),
    );
    render(<SearchMembersPage />);

    await user.click(screen.getByRole("button", { name: "SEARCH" }));
    expect(await screen.findByRole("status")).toHaveTextContent("No members match these filters.");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(clientMocks.searchMembers).toHaveBeenLastCalledWith({}, "next-token"),
    );
    expect(await screen.findByRole("row", { name: /Alex Johnson/ })).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Search results" })).getByText("Alex Johnson"),
    ).toBeVisible();
  });

  it("separates counter failures from the member table", async () => {
    const user = userEvent.setup();
    clientMocks.searchMembers.mockResolvedValue({ members: [member] });
    clientMocks.getMemberReportSummary.mockRejectedValue(new Error("private report detail"));
    render(<SearchMembersPage />);

    await user.click(screen.getByRole("button", { name: "SEARCH" }));

    expect(await screen.findByRole("row", { name: /Alex Johnson/ })).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load report counters. Please try again.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("private report detail");
  });

  it("announces a generic error without exposing callable details", async () => {
    const user = userEvent.setup();
    clientMocks.searchMembers.mockRejectedValue(new Error("private Firebase stack detail"));
    render(<SearchMembersPage />);

    await user.click(screen.getByRole("button", { name: "SEARCH" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Unable to load members. Please try again.");
    expect(error).not.toHaveTextContent("private Firebase stack detail");
  });
});
