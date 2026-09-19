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

  it("sends the chosen filters, reading the date on a Jersey clock", async () => {
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
        // 1 Sep is BST, so Jersey midnight is 23:00 UTC the evening before.
        since: "2026-08-31T23:00:00Z",
        actorId: null,
        registrationType: "coach-bookings",
        limit: 250,
        cursor: null,
      }),
    );
  });

  it("reads the time box together with the date, in Jersey summer time", async () => {
    render(<HistoryPage />);
    fireEvent.change(screen.getByLabelText("Since"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Since time"), { target: { value: "07:30" } });
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    await waitFor(() =>
      expect(mocks.fetchClassHistory).toHaveBeenCalledWith(
        expect.objectContaining({ since: "2026-09-01T06:30:00Z" }),
      ),
    );
  });

  it("reads a winter date on the same clock, when Jersey is on GMT", async () => {
    render(<HistoryPage />);
    fireEvent.change(screen.getByLabelText("Since"), { target: { value: "2026-01-15" } });
    fireEvent.change(screen.getByLabelText("Since time"), { target: { value: "07:30" } });
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    await waitFor(() =>
      expect(mocks.fetchClassHistory).toHaveBeenCalledWith(
        expect.objectContaining({ since: "2026-01-15T07:30:00Z" }),
      ),
    );
  });

  it("asks the log nothing when the date box does not name a real day", async () => {
    render(<HistoryPage />);
    fireEvent.change(screen.getByLabelText("Since"), { target: { value: "01/09/2026" } });
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    await waitFor(() => expect(screen.queryByRole("table")).toBeNull());
    expect(mocks.fetchClassHistory).not.toHaveBeenCalled();
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

  it("never offers an auth uid as a Logged by option", async () => {
    // Production writes no actorName for a system row, and the uid must not become its label.
    const namelessRow = {
      ...memberRow,
      id: "evt-3",
      actorId: "uid-quorum-sweep",
      actorRole: "system",
      actorGroup: "system",
      actorName: null,
    };
    mocks.fetchClassHistory.mockResolvedValue({
      rows: [memberRow, staffRow, namelessRow],
      total: 3,
    });
    render(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    await screen.findByText("RECORDS (3)");

    const labels = within(screen.getByLabelText("Logged by"))
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(labels).toEqual(["Anyone", "Office", "Olivia Lewis"]);
    for (const uid of [memberRow.actorId, staffRow.actorId, namelessRow.actorId]) {
      expect(labels).not.toContain(uid);
    }
  });

  it("offers the whole import as one Regyfit option, never a person's name", async () => {
    // Every imported row carries the same actorId, so one option is all the filter can honour: a
    // person's name there would promise a narrower selection than the log can run.
    const importedByAdmin = {
      ...memberRow,
      id: "evt-i1",
      actorId: "regyfit-import",
      actorRole: "regyfit",
      actorGroup: "staff",
      actorName: "ADMIN",
      source: "regyfit",
    };
    const importedByTrainer = {
      ...importedByAdmin,
      id: "evt-i2",
      actorName: "Prof. Charles Tromans",
    };
    mocks.fetchClassHistory.mockResolvedValue({
      rows: [memberRow, importedByAdmin, importedByTrainer],
      total: 3,
    });
    render(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    await screen.findByText("RECORDS (3)");

    const labels = within(screen.getByLabelText("Logged by"))
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(labels).toEqual(["Anyone", "Imported history", "Olivia Lewis"]);
    expect(labels).not.toContain("ADMIN");
    expect(labels).not.toContain("Prof. Charles Tromans");
    // The row itself still says who did it; only the filter option is collapsed.
    expect(screen.getAllByText("Prof. Charles Tromans").length).toBeGreaterThan(0);
  });

  it("still labels a BPT staff option with the name the server resolved", async () => {
    render(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    await screen.findByText("RECORDS (2)");

    const labels = within(screen.getByLabelText("Logged by"))
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(labels).toEqual(["Anyone", "Office", "Olivia Lewis"]);
  });

  it("offers every record count the spec lists, 750 included", () => {
    render(<HistoryPage />);
    const labels = within(screen.getByLabelText("No. of records"))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(labels).toEqual(["100", "250", "500", "750", "1000"]);
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

  it("releases the object URL even when the save itself throws", async () => {
    const blob = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    mocks.downloadClassHistoryPdf.mockResolvedValue({
      blob,
      fileName: "class-history-2026-09-17.pdf",
    });
    const createObjectURL = vi.fn(() => "blob:history");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      throw new Error("Not implemented: HTMLAnchorElement.prototype.click");
    });

    render(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "LIST" }));
    await screen.findByText("RECORDS (2)");
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));

    expect(
      await screen.findByText("The PDF could not be prepared. Please try again."),
    ).toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:history");
    // The raw DOM failure never reaches the operator.
    expect(screen.queryByText(/Not implemented/u)).toBeNull();
    expect(screen.getByRole("table")).toBeInTheDocument();
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
