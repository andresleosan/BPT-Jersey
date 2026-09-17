import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchClassHistory: vi.fn(),
  downloadClassHistoryPdf: vi.fn(),
  useAdminOrStaffSession: vi.fn(),
}));
vi.mock("../../../../lib/class-history-client", () => ({
  fetchClassHistory: mocks.fetchClassHistory,
  downloadClassHistoryPdf: mocks.downloadClassHistoryPdf,
}));
vi.mock("../../admin-gate", () => ({ useAdminOrStaffSession: mocks.useAdminOrStaffSession }));

import { HistoryPage } from "./page";

const memberRow = {
  id: "evt-1",
  occurredAt: "2026-09-16T17:21:00Z",
  action: "booking.created",
  actorId: "uid-olivia",
  actorRole: "adultStudent",
  actorGroup: "member",
  actorName: "Olivia Lewis",
  actorIp: "82.112.144.10",
  studentId: "st-olivia",
  studentName: "Olivia Lewis",
  sessionId: "se-1",
  sessionStartAt: "2026-09-16T16:30:00Z",
  programId: "p1",
  programName: "GI All Levels",
  locationId: "town",
  source: "web",
  sentence: "Olivia Lewis booked the class of 16 Sep 2026 at 17:30",
};

const staffRow = {
  ...memberRow,
  id: "evt-2",
  occurredAt: "2026-09-15T16:36:00Z",
  actorId: "uid-office",
  actorRole: "administrator",
  actorGroup: "staff",
  actorName: "Office",
  actorIp: null,
  sentence: "Andy Smith was booked by Office into GI Beginners on 15 Sep 2026 at 12:00",
};

beforeEach(() => {
  mocks.useAdminOrStaffSession.mockReturnValue({
    role: "administrator",
    academyId: "bpt-jersey",
    uid: "uid-office",
  });
  mocks.fetchClassHistory.mockResolvedValue({ rows: [memberRow, staffRow], total: 2 });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Class registrations log", () => {
  it("does not query anything until LIST is pressed", () => {
    render(<HistoryPage />);
    expect(mocks.fetchClassHistory).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists the records and shows the count", async () => {
    render(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    expect(await screen.findByText("RECORDS (2)")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveAccessibleName(/class registrations log/i);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    const [, first] = screen.getAllByRole("row");
    expect(within(first!).getByText("Olivia Lewis")).toBeInTheDocument();
    expect(within(first!).getByText("82.112.144.10")).toBeInTheDocument();
    expect(
      within(first!).getByText("Olivia Lewis booked the class of 16 Sep 2026 at 17:30"),
    ).toBeInTheDocument();
  });

  it("says the count is what came back, not a total of matches", async () => {
    render(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    expect(
      await screen.findByText(
        "The most recent 2 records written for these filters. The log does not count how many more there are.",
      ),
    ).toBeInTheDocument();
  });

  it("sends the chosen filters", async () => {
    render(<HistoryPage />);
    fireEvent.change(screen.getByLabelText("Since"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Registration type"), {
      target: { value: "coach-bookings" },
    });
    fireEvent.change(screen.getByLabelText("No. of records"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    await waitFor(() =>
      expect(mocks.fetchClassHistory).toHaveBeenCalledWith({
        academyId: "bpt-jersey",
        since: "2026-09-01T00:00:00Z",
        actorId: null,
        registrationType: "coach-bookings",
        limit: 250,
        cursor: null,
      }),
    );
  });

  it("reads the time box together with the date", async () => {
    render(<HistoryPage />);
    fireEvent.change(screen.getByLabelText("Since"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Since time"), { target: { value: "07:30" } });
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    await waitFor(() =>
      expect(mocks.fetchClassHistory).toHaveBeenCalledWith(
        expect.objectContaining({ since: "2026-09-01T07:30:00Z" }),
      ),
    );
  });

  it("filters by an actor it has actually seen, sending that actor's id", async () => {
    render(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    await screen.findByText("RECORDS (2)");
    fireEvent.change(screen.getByLabelText("Logged by"), { target: { value: "uid-office" } });
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    await waitFor(() =>
      expect(mocks.fetchClassHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ actorId: "uid-office" }),
      ),
    );
  });

  it("renders an em dash for a record with no address", async () => {
    render(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    await screen.findByText("RECORDS (2)");
    const [, , second] = screen.getAllByRole("row");
    expect(within(second!).getByText("—")).toBeInTheDocument();
    expect(within(second!).getByText("Office")).toBeInTheDocument();
  });

  it("drops the IP column when no record carries an address", async () => {
    mocks.fetchClassHistory.mockResolvedValue({ rows: [staffRow], total: 1 });
    render(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    await screen.findByText("RECORDS (1)");
    expect(screen.queryByRole("columnheader", { name: "IP" })).toBeNull();
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Date/time",
      "User",
      "Task",
    ]);
  });

  it("shows an honest message when the log fails", async () => {
    mocks.fetchClassHistory.mockRejectedValue(new Error("The log is temporarily unavailable."));
    render(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    expect(await screen.findByText("The log is temporarily unavailable.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the empty state with no rows", async () => {
    mocks.fetchClassHistory.mockResolvedValue({ rows: [], total: 0 });
    render(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    expect(await screen.findByText("No records for these filters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled();
  });

  it("saves the PDF the client prepared, under the name the server chose", async () => {
    const blob = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    mocks.downloadClassHistoryPdf.mockResolvedValue({
      blob,
      fileName: "class-history-2026-09-17.pdf",
    });
    const createObjectURL = vi.fn(() => "blob:history");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    let saved: { href: string; download: string } | null = null;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved = { href: this.href, download: this.download };
    });

    render(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    await screen.findByText("RECORDS (2)");
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));

    await waitFor(() => expect(saved).not.toBeNull());
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(saved).toEqual({ href: "blob:history", download: "class-history-2026-09-17.pdf" });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:history");
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it("shows the PDF failure without losing the records on screen", async () => {
    mocks.downloadClassHistoryPdf.mockRejectedValue(
      new Error("The PDF could not be prepared. Please try again."),
    );
    render(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    await screen.findByText("RECORDS (2)");
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    expect(
      await screen.findByText("The PDF could not be prepared. Please try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
