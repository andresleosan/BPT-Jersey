import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
      { staffKey: "coach-a", role: "coach", active: true, status: "active" },
      { staffKey: "coach-b", role: "coach", active: true, status: "active" },
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

  it("filters by location and by mine", async () => {
    render(<ClassesPage />);
    await screen.findByRole("button", { name: /GI All Levels Evenings/ });
    fireEvent.change(screen.getByRole("listbox", { name: "Locations" }), {
      target: { value: "west" },
    });
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
    const dialog = await screen.findByRole("dialog", { name: /Create classes\/services/i });
    fireEvent.change(within(dialog).getByLabelText("Maximum capacity"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    await waitFor(() =>
      expect(mocks.updateSession).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "s1", capacity: null }),
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
    fireEvent.click(screen.getByRole("button", { name: "Add a class" }));
    const dialog = await screen.findByRole("dialog", { name: /Create classes\/services/i });
    expect(within(dialog).getByLabelText("Date")).toHaveValue("2026-09-14");
    expect(within(dialog).getByLabelText("Start time")).toHaveValue("17:00");
  });
});
