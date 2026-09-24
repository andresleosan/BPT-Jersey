import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelBooking: vi.fn(),
  cancelSession: vi.fn(),
  copyWeek: vi.fn(),
  deleteWeek: vi.fn(),
  getScheduleCatalog: vi.fn(),
  listMemberNames: vi.fn(),
  listMemberships: vi.fn(),
  listSessionBookedCounts: vi.fn(),
  listSessionBookings: vi.fn(),
  listSessions: vi.fn(),
  listStaffProfiles: vi.fn(),
  previewWeek: vi.fn(),
  requestBooking: vi.fn(),
  saveSession: vi.fn(),
  updateSession: vi.fn(),
  useAdminOrStaffSession: vi.fn(),
}));

vi.mock("../../../../lib/schedule-client", () => ({
  cancelBooking: mocks.cancelBooking,
  cancelSession: mocks.cancelSession,
  copyWeek: mocks.copyWeek,
  deleteWeek: mocks.deleteWeek,
  getScheduleCatalog: mocks.getScheduleCatalog,
  listSessionBookedCounts: mocks.listSessionBookedCounts,
  listSessionBookings: mocks.listSessionBookings,
  listSessions: mocks.listSessions,
  previewWeek: mocks.previewWeek,
  requestBooking: mocks.requestBooking,
  saveSession: mocks.saveSession,
  updateSession: mocks.updateSession,
}));

vi.mock("../../../../lib/staff-client", () => ({ listStaffProfiles: mocks.listStaffProfiles }));
vi.mock("../../../../lib/members-client", () => ({ listMemberNames: mocks.listMemberNames }));
vi.mock("../../../../lib/membership-admin-client", () => ({
  listMemberships: mocks.listMemberships,
}));
vi.mock("../../admin-gate", () => ({ useAdminOrStaffSession: mocks.useAdminOrStaffSession }));

import { ClassesPage } from "./page";

const academyId = "academy-test";
const stamp = "2026-09-10T09:00:00.000Z";

const townSession = {
  sessionId: "s1",
  academyId,
  classId: null,
  programId: "p1",
  locationId: "town",
  instructorId: "coach-a",
  instructorIds: ["coach-a"],
  title: "GI All Levels Evenings",
  startAt: "2026-09-14T16:30:00.000Z",
  endAt: "2026-09-14T17:30:00.000Z",
  capacity: 40,
  minParticipants: 0,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  schemaVersion: "1",
  createdAt: stamp,
  createdBy: "admin",
  updatedAt: stamp,
  updatedBy: "admin",
} as const;

const westSession = {
  ...townSession,
  sessionId: "s2",
  locationId: "west",
  instructorId: "coach-b",
  instructorIds: ["coach-b"],
  title: "NO GI Morning",
  startAt: "2026-09-15T07:00:00.000Z",
  endAt: "2026-09-15T08:00:00.000Z",
  capacity: 20,
} as const;

// Sessions name trainers by staffKey, and a staffKey is a sha256, never the auth uid.
const ownerStaffKey = "7b1f0c4e9a2d5f8361c74b0e9d2a5f83c61e4b7d0a9f2c5e8b1d4a7f0c3e6b9d";

const mineSession = {
  ...townSession,
  sessionId: "s3",
  instructorId: ownerStaffKey,
  instructorIds: [ownerStaffKey],
  title: "Owner Drills",
  startAt: "2026-09-16T17:30:00.000Z",
  endAt: "2026-09-16T18:30:00.000Z",
} as const;

const weekSessions = [townSession, westSession];
// The year query answers the TOTAL counter only; a different length keeps every counter distinct.
const yearSessions = Array.from({ length: 5 }, (_, index) => ({
  ...townSession,
  sessionId: `y${index}`,
}));

const catalog = {
  locations: [
    {
      locationId: "town",
      academyId,
      name: "BPT Town",
      address: "Town address",
      timezone: "Europe/Jersey",
      active: true,
      schemaVersion: "1",
    },
    {
      locationId: "west",
      academyId,
      name: "BPT West",
      address: "West address",
      timezone: "Europe/Jersey",
      active: true,
      schemaVersion: "1",
    },
  ],
  programs: [
    {
      programId: "p1",
      academyId,
      name: "GI All Levels",
      ageBand: "adult",
      discipline: "bjj",
      level: "fundamentals",
      active: true,
      schemaVersion: "1",
      colour: "#F0EFFF",
      abbreviation: "GI",
    },
  ],
};

describe("Classes & Services 2.0 page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-16T10:00:00Z"));
    mocks.useAdminOrStaffSession.mockReturnValue({ role: "owner", uid: "owner-1" });
    mocks.getScheduleCatalog.mockResolvedValue(catalog);
    mocks.listStaffProfiles.mockResolvedValue([
      { staffKey: "coach-a", role: "coach", active: true, status: "active", self: false },
      { staffKey: "coach-b", role: "coach", active: true, status: "active", self: false },
      { staffKey: ownerStaffKey, role: "headCoach", active: true, status: "active", self: true },
    ]);
    mocks.listSessions.mockImplementation(async (query: { from: string }) =>
      query.from.startsWith("2026-01") ? yearSessions : weekSessions,
    );
    mocks.listSessionBookedCounts.mockResolvedValue({ s1: 3, s2: 1 });
    mocks.listSessionBookings.mockResolvedValue([]);
    mocks.listMemberNames.mockResolvedValue([]);
    mocks.listMemberships.mockResolvedValue([]);
    mocks.previewWeek.mockResolvedValue({ count: 2, sample: [] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows sessions while booking counts are pending, without inventing zero bookings", async () => {
    let releaseCounts!: (counts: Record<string, number>) => void;
    mocks.listSessionBookedCounts.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseCounts = resolve;
        }),
    );
    render(<ClassesPage />);
    const card = await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    expect(card).toHaveTextContent("— / 40");
    expect(screen.queryByText("Loading the schedule…")).not.toBeInTheDocument();
    expect(screen.getByText("Loading registrations…")).toBeInTheDocument();
    expect(mocks.listSessions).toHaveBeenCalledTimes(1);
    releaseCounts({ s1: 3, s2: 1 });
    await waitFor(() => expect(card).toHaveTextContent("3 / 40"));
  });

  it("keeps sessions usable when booking counts fail and retries the missing counts", async () => {
    mocks.listSessionBookedCounts.mockRejectedValueOnce(new Error("Synthetic unavailable"));
    render(<ClassesPage />);
    expect(await screen.findByRole("button", { name: /GI All Levels Evenings/ })).toHaveTextContent(
      "— / 40",
    );
    fireEvent.click(await screen.findByRole("button", { name: "Retry registrations" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /GI All Levels Evenings/ })).toHaveTextContent(
        "3 / 40",
      ),
    );
    expect(mocks.listSessions).toHaveBeenCalledTimes(1);
  });

  it("ignores late counts from a week the user has left", async () => {
    let releaseOld!: (counts: Record<string, number>) => void;
    mocks.listSessionBookedCounts.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseOld = resolve;
        }),
    );
    render(<ClassesPage />);
    await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /GI All Levels Evenings/ })).toHaveTextContent(
        "3 / 40",
      ),
    );
    await act(async () => {
      releaseOld({ s1: 99 });
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /GI All Levels Evenings/ })).not.toHaveTextContent(
        "99 / 40",
      ),
    );
  });

  it("keeps catalogue errors independent from successful session reads", async () => {
    mocks.getScheduleCatalog.mockRejectedValueOnce(new Error("Catalogue unavailable"));
    render(<ClassesPage />);
    await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    fireEvent.click(await screen.findByRole("button", { name: "Retry catalogue" }));
    await waitFor(() =>
      expect(screen.queryByText("Catalogue unavailable")).not.toBeInTheDocument(),
    );
    expect(mocks.listSessions).toHaveBeenCalledTimes(1);
  });

  it("folds App Check failures from all three reads into one notice with one retry", async () => {
    const appCheck = Object.assign(
      new Error(
        "AppCheck: 403 error. Attempts allowed again after 01d:00m:00s (appCheck/initial-throttle).",
      ),
      { code: "appCheck/initial-throttle" },
    );
    mocks.getScheduleCatalog.mockRejectedValueOnce(appCheck);
    mocks.listSessions.mockRejectedValueOnce(appCheck);
    mocks.listSessionBookedCounts.mockRejectedValueOnce(appCheck);
    render(<ClassesPage />);
    expect(
      await screen.findByText("We couldn't verify this device. Try again in a moment."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Loading registrations…")).not.toBeInTheDocument(),
    );
    expect(
      screen.getAllByText("We couldn't verify this device. Try again in a moment."),
    ).toHaveLength(1);
    expect(screen.queryByText(/appCheck\/initial-throttle/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Registration counts unavailable/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry catalogue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry registrations" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry schedule" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /GI All Levels Evenings/ })).toHaveTextContent(
        "3 / 40",
      ),
    );
    expect(mocks.getScheduleCatalog).toHaveBeenCalledTimes(2);
    expect(mocks.listSessions).toHaveBeenCalledTimes(2);
    expect(mocks.listSessionBookedCounts).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByText("We couldn't verify this device. Try again in a moment."),
    ).not.toBeInTheDocument();
  });

  it("keeps the separate notices for failures that are not App Check", async () => {
    mocks.getScheduleCatalog.mockRejectedValueOnce(new Error("Catalogue unavailable"));
    mocks.listSessionBookedCounts.mockRejectedValueOnce(new Error("Synthetic unavailable"));
    render(<ClassesPage />);
    expect(await screen.findByText("Catalogue unavailable")).toBeInTheDocument();
    expect(
      await screen.findByText("Registration counts unavailable. Classes are still available."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry catalogue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry registrations" })).toBeInTheDocument();
    expect(
      screen.queryByText("We couldn't verify this device. Try again in a moment."),
    ).not.toBeInTheDocument();
  });

  it("marks the course link as a full-width toolbar action", async () => {
    render(<ClassesPage />);
    await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    expect(screen.getByRole("link", { name: "Create course / seminar" })).toHaveClass(
      "cs-button",
      "cs-toolbar-action",
    );
  });

  it("reuses a recently visited week and ignores an empty date", async () => {
    render(<ClassesPage />);
    await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    fireEvent.change(screen.getByLabelText("Go to date"), { target: { value: "" } });
    expect(screen.getByText("14 – 20 SEP 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() =>
      expect(screen.queryByText("Loading the schedule…")).not.toBeInTheDocument(),
    );
    const before = mocks.listSessions.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    expect(mocks.listSessions).toHaveBeenCalledTimes(before);
  });

  it("allows retry after a failed range load without showing the previous week's sessions", async () => {
    render(<ClassesPage />);
    await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    mocks.listSessions.mockRejectedValueOnce(new Error("Unable to load the classes"));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await screen.findByRole("alert");
    expect(
      screen.queryByRole("button", { name: /GI All Levels Evenings/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry schedule" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("does not reuse a window across academies and refresh bypasses the cache", async () => {
    mocks.useAdminOrStaffSession.mockReturnValue({
      role: "owner",
      uid: "same-owner",
      academyId: "first",
    });
    const { rerender } = render(<ClassesPage />);
    await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    await waitFor(() => expect(mocks.listStaffProfiles).toHaveBeenCalled());
    const before = mocks.listSessionBookedCounts.mock.calls.length;
    mocks.useAdminOrStaffSession.mockReturnValue({
      role: "owner",
      uid: "same-owner",
      academyId: "second",
    });
    rerender(<ClassesPage />);
    await waitFor(() => expect(mocks.listSessionBookedCounts).toHaveBeenCalledTimes(before + 1));
    await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    fireEvent.click(screen.getByRole("button", { name: "Refresh schedule" }));
    await waitFor(() => expect(mocks.listSessionBookedCounts).toHaveBeenCalledTimes(before + 2));
  });

  it("loads the week and shows counters and one card per session", async () => {
    render(<ClassesPage />);
    expect(
      await screen.findByRole("button", { name: /GI All Levels Evenings/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // CLASSES
    expect(screen.getAllByText(/registrations/i).length).toBeGreaterThan(0);
    expect(mocks.listSessions).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.stringContaining("2026-09-13T23:00") }),
    );
    expect(mocks.listSessionBookedCounts).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.stringContaining("2026-09-13T23:00") }),
    );
    expect(screen.getByText("14 – 20 SEP 2026")).toBeInTheDocument();
  });

  it("opens on the academy week, not the UTC one, just after local midnight", async () => {
    // 23:30Z on Sunday 13 September is 00:30 BST on Monday 14 September: the academy is already in
    // the new week even though the UTC date still says Sunday.
    vi.setSystemTime(new Date("2026-09-13T23:30:00Z"));
    render(<ClassesPage />);
    await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    expect(screen.getByText("14 – 20 SEP 2026")).toBeInTheDocument();
  });

  it("shows past (completed) classes under Active like Regyfit, and cancelled ones only under Inactive", async () => {
    mocks.listSessions.mockImplementation(async (query: { from: string }) =>
      query.from.startsWith("2026-01")
        ? yearSessions
        : [
            { ...townSession, status: "completed" },
            { ...westSession, status: "cancelled", cancellationReason: "Coach away" },
          ],
    );
    render(<ClassesPage />);
    expect(
      await screen.findByRole("button", { name: /GI All Levels Evenings/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /NO GI Morning/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "inactive" },
    });
    expect(screen.getByRole("button", { name: /NO GI Morning/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /GI All Levels Evenings/ }),
    ).not.toBeInTheDocument();
  });

  it("asks for the week's counts alongside its sessions and the year total only when requested", async () => {
    let releaseWeek: (rows: readonly unknown[]) => void = () => undefined;
    mocks.listSessions.mockImplementation((query: { from: string }) =>
      query.from.startsWith("2026-01")
        ? Promise.resolve(yearSessions)
        : new Promise((resolve) => {
            releaseWeek = resolve;
          }),
    );
    render(<ClassesPage />);
    await waitFor(() => expect(mocks.listSessions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.listSessionBookedCounts).toHaveBeenCalledTimes(1));
    expect(mocks.listSessions.mock.calls.some(([q]) => q.from.startsWith("2026-01"))).toBe(false);
    releaseWeek(weekSessions);
    expect(
      await screen.findByRole("button", { name: /GI All Levels Evenings/ }),
    ).toBeInTheDocument();
    expect(mocks.listSessions).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Calculate year total" }));
    await waitFor(() =>
      expect(mocks.listSessions.mock.calls.some(([q]) => q.from.startsWith("2026-01"))).toBe(true),
    );
  });

  it("asks for the week without waiting for the catalogue, and for staff only once the week is on screen", async () => {
    let releaseCatalog: (value: typeof catalog) => void = () => undefined;
    mocks.getScheduleCatalog.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseCatalog = resolve;
        }),
    );
    render(<ClassesPage />);
    // Every callable waits for its own App Check token: the week goes first, staff is not needed to read it.
    await waitFor(() => expect(mocks.listSessions).toHaveBeenCalled());
    expect(mocks.listSessionBookedCounts).toHaveBeenCalled();
    expect(mocks.listStaffProfiles).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: /GI All Levels Evenings/ }),
    ).toBeInTheDocument();
    await waitFor(() => expect(mocks.listStaffProfiles).toHaveBeenCalledTimes(1));
    releaseCatalog(catalog);
    // The catalogue arriving later colours the cards but does not ask for the week again.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Calculate year total" })).toBeEnabled(),
    );
    expect(mocks.listSessions).toHaveBeenCalledTimes(1);
    expect(
      mocks.listSessions.mock.calls.filter(([q]) => q.from.startsWith("2026-09-13")).length,
    ).toBe(1);
  });

  it("filters by location and by mine", async () => {
    render(<ClassesPage />);
    await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    // Filters are compact dropdowns: a summary that opens a group of checkboxes.
    const locations = screen.getByRole("group", { name: "Locations" });
    fireEvent.click(within(locations).getByRole("checkbox", { name: "BPT West" }));
    expect(screen.getByText("Locations · 1")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /GI All Levels Evenings/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /NO GI Morning/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Mine" }));
    expect(screen.queryByRole("button", { name: /NO GI Morning/ })).not.toBeInTheDocument();
  });

  it("opens the session panel from a card and saves an edit", async () => {
    mocks.updateSession.mockImplementation(async (input: object) => ({
      ...townSession,
      ...input,
    }));
    render(<ClassesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /GI All Levels Evenings/ }));
    const dialog = await screen.findByRole("dialog", { name: /Edit session/i });
    fireEvent.change(within(dialog).getByLabelText("Maximum capacity"), {
      target: { value: "12" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mocks.updateSession).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "s1", capacity: 12 }),
      ),
    );
  });

  it("switches to the list view and exports CSV", async () => {
    render(<ClassesPage />);
    await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    fireEvent.click(screen.getByRole("tab", { name: "List" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excel" })).toBeInTheDocument();
  });

  it("keeps a coach read-only", async () => {
    mocks.useAdminOrStaffSession.mockReturnValue({ role: "coach", uid: "coach-1" });
    render(<ClassesPage />);
    await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    expect(screen.queryByRole("button", { name: "Copy week" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a class" })).not.toBeInTheDocument();
  });

  it("opens the panel in create mode from the header button", async () => {
    render(<ClassesPage />);
    await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    // Creation needs the trainer list, which is read right after the week.
    fireEvent.click(await screen.findByRole("button", { name: "Add a class" }));
    const dialog = await screen.findByRole("dialog", { name: /Create session/i });
    expect(within(dialog).getByLabelText("Date")).toHaveValue("2026-09-14");
    expect(within(dialog).getByLabelText("Start time")).toHaveValue("17:00");
  });

  it("keeps the actor's own classes when Mine is ticked", async () => {
    mocks.listSessions.mockImplementation(async (query: { from: string }) =>
      query.from.startsWith("2026-01") ? yearSessions : [...weekSessions, mineSession],
    );
    render(<ClassesPage />);
    await screen.findByRole("button", { name: /Owner Drills/ });
    fireEvent.click(screen.getByRole("checkbox", { name: "Mine" }));
    expect(await screen.findByRole("button", { name: /Owner Drills/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /GI All Levels Evenings/ }),
    ).not.toBeInTheDocument();
  });

  it("still shows the week when the year query behind TOTAL is refused", async () => {
    mocks.listSessions.mockImplementation(async (query: { from: string }) => {
      if (query.from.startsWith("2026-01")) throw new Error("Date range cannot exceed 90 days");
      return weekSessions;
    });
    render(<ClassesPage />);
    expect(
      await screen.findByRole("button", { name: /GI All Levels Evenings/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Calculate year total" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Calculate year total" })).toBeEnabled(),
    );
    expect(screen.getByRole("button", { name: /GI All Levels Evenings/ })).toBeInTheDocument();
  });

  it("asks for a range wider than 90 days in windows the callable accepts", async () => {
    render(<ClassesPage />);
    await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    fireEvent.click(screen.getByRole("tab", { name: "List" }));
    fireEvent.change(screen.getByLabelText("Date range"), { target: { value: "this-year" } });
    await waitFor(() =>
      expect(
        mocks.listSessions.mock.calls.filter(([query]) => query.from.startsWith("2026-01-01"))
          .length,
      ).toBe(1),
    );
    const spans = mocks.listSessions.mock.calls.map(
      ([query]) => Date.parse(query.to) - Date.parse(query.from),
    );
    expect(Math.max(...spans)).toBeLessThanOrEqual(90 * 86_400_000);
    expect(mocks.listSessions.mock.calls.some(([query]) => query.to.startsWith("2026-12-31"))).toBe(
      true,
    );
  });

  it("keeps academy trainers available when the staff directory is refused", async () => {
    mocks.listStaffProfiles.mockRejectedValue(new Error("permission-denied"));
    render(<ClassesPage />);
    expect(
      await screen.findByRole("button", { name: /GI All Levels Evenings/ }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Staff profiles unavailable. Academy trainers are still available."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a class" })).toBeInTheDocument();
    // Editing and the week actions do not need the trainer list.
    expect(screen.getByRole("button", { name: "Copy week" })).toBeInTheDocument();
  });
  it("creates a class with landing trainers when no staff profiles exist", async () => {
    mocks.listStaffProfiles.mockResolvedValue([]);
    mocks.saveSession.mockResolvedValue(townSession);
    render(<ClassesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a class" }));
    const dialog = within(await screen.findByRole("dialog"));
    for (const name of [
      'Professor Vladimiro "Miro" Afonso',
      "Charlie Tromans",
      "Amoné Mouton",
      "Connor Hoopes",
      "Catalina Bruma",
    ]) {
      expect(dialog.getByRole("checkbox", { name })).toBeInTheDocument();
    }
    fireEvent.click(dialog.getByRole("checkbox", { name: "Charlie Tromans" }));
    fireEvent.click(dialog.getByRole("checkbox", { name: "Catalina Bruma" }));
    fireEvent.change(dialog.getByLabelText("Maximum capacity"), { target: { value: "21" } });
    fireEvent.click(dialog.getByRole("button", { name: "Create session" }));
    await waitFor(() =>
      expect(mocks.saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          instructorId: "coach-charlie",
          instructorIds: ["coach-charlie", "coach-catalina"],
          capacity: 21,
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
