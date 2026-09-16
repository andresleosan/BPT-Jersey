import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelBooking: vi.fn(),
  cancelSession: vi.fn(),
  listMemberNames: vi.fn(),
  listMemberships: vi.fn(),
  listSessionBookings: vi.fn(),
  requestBooking: vi.fn(),
  saveSession: vi.fn(),
  updateSession: vi.fn(),
}));

vi.mock("../../../../lib/schedule-client", () => ({
  cancelBooking: mocks.cancelBooking,
  cancelSession: mocks.cancelSession,
  listSessionBookings: mocks.listSessionBookings,
  requestBooking: mocks.requestBooking,
  saveSession: mocks.saveSession,
  updateSession: mocks.updateSession,
}));
vi.mock("../../../../lib/members-client", () => ({ listMemberNames: mocks.listMemberNames }));
vi.mock("../../../../lib/membership-admin-client", () => ({
  listMemberships: mocks.listMemberships,
}));

import { SessionPanel } from "./session-panel";

const academyId = "academy-test";
const stamp = "2026-09-10T09:00:00.000Z";

const sessionFixture = {
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
      programId: "p0",
      academyId,
      name: "NO GI All Levels",
      ageBand: "adult",
      discipline: "bjj",
      level: "fundamentals",
      active: true,
      schemaVersion: "1",
    },
    {
      programId: "p1",
      academyId,
      name: "GI All Levels",
      ageBand: "adult",
      discipline: "bjj",
      level: "fundamentals",
      active: true,
      schemaVersion: "1",
    },
  ],
} as const;

const staff = [
  { staffKey: "coach-a", role: "coach", active: true, status: "active", self: false },
  { staffKey: "coach-b", role: "coach", active: true, status: "active", self: false },
] as const;

describe("SessionPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSessionBookings.mockResolvedValue([]);
    mocks.listMemberNames.mockResolvedValue([]);
    mocks.listMemberships.mockResolvedValue([]);
  });

  afterEach(cleanup);

  it("creates a session with several trainers, unlimited capacity and custom rules", async () => {
    mocks.saveSession.mockResolvedValue(sessionFixture);
    const onSaved = vi.fn();
    render(
      <SessionPanel
        mode="create"
        catalog={catalog}
        staff={staff}
        timezone="Europe/Jersey"
        defaults={{ date: "2026-09-14", startTime: "17:30" }}
        canEdit
        canReadMemberships
        onSaved={onSaved}
        onCancelled={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Class/service type"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "coach-a" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "coach-b" }));
    fireEvent.change(screen.getByLabelText("Booking and cancellation"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText("Allow bookings until (minutes before)"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(mocks.saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          programId: "p1",
          locationId: "town",
          instructorId: "coach-a",
          instructorIds: ["coach-a", "coach-b"],
          capacity: null,
          startAt: "2026-09-14T16:30:00.000Z",
          endAt: "2026-09-14T17:30:00.000Z",
          bookingRules: expect.objectContaining({ bookUntilMinutesBefore: 30 }),
        }),
      ),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("cancels a session with a reason", async () => {
    mocks.cancelSession.mockResolvedValue({ ...sessionFixture, status: "cancelled" });
    render(
      <SessionPanel
        mode="edit"
        session={sessionFixture}
        catalog={catalog}
        staff={staff}
        timezone="Europe/Jersey"
        canEdit
        canReadMemberships
        onSaved={vi.fn()}
        onCancelled={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Coach unavailable" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(mocks.cancelSession).toHaveBeenCalledWith("s1", "Coach unavailable"),
    );
  });

  it("copies a session into a new draft", () => {
    render(
      <SessionPanel
        mode="edit"
        session={sessionFixture}
        catalog={catalog}
        staff={staff}
        timezone="Europe/Jersey"
        canEdit
        canReadMemberships
        onSaved={vi.fn()}
        onCancelled={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveValue("2026-09-14");
  });

  it("keeps the type and the location locked while editing", () => {
    render(
      <SessionPanel
        mode="edit"
        session={sessionFixture}
        catalog={catalog}
        staff={staff}
        timezone="Europe/Jersey"
        canEdit
        canReadMemberships
        onSaved={vi.fn()}
        onCancelled={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const type = screen.getByLabelText("Class/service type");
    expect(type).toBeDisabled();
    expect(type).toHaveAttribute("title", "Copy the class to change it");
    expect(screen.getByLabelText("Class/service location")).toBeDisabled();
  });

  it("hides every write control from a coach", () => {
    render(
      <SessionPanel
        mode="edit"
        session={sessionFixture}
        catalog={catalog}
        staff={staff}
        timezone="Europe/Jersey"
        canEdit={false}
        canReadMemberships={false}
        onSaved={vi.fn()}
        onCancelled={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Maximum capacity")).toBeDisabled();
  });

  it("lets a coach leave a read-only panel with Escape", () => {
    const onClose = vi.fn();
    render(
      <SessionPanel
        mode="edit"
        session={sessionFixture}
        catalog={catalog}
        staff={staff}
        timezone="Europe/Jersey"
        canEdit={false}
        canReadMemberships={false}
        onSaved={vi.fn()}
        onCancelled={vi.fn()}
        onClose={onClose}
      />,
    );
    // Every field is disabled, so the dialog itself holds the focus and the key reaches it.
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement === dialog || dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("refuses an end time at or before the start and a class with no trainer", () => {
    render(
      <SessionPanel
        mode="create"
        catalog={catalog}
        staff={staff}
        timezone="Europe/Jersey"
        defaults={{ date: "2026-09-14", startTime: "17:30" }}
        canEdit
        canReadMemberships
        onSaved={vi.fn()}
        onCancelled={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Choose at least one trainer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "coach-a" }));
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "17:00" } });
    expect(screen.getByText("End time must be after the start time")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("bounds the capacity to what the callable accepts", () => {
    render(
      <SessionPanel
        mode="edit"
        session={sessionFixture}
        catalog={catalog}
        staff={staff}
        timezone="Europe/Jersey"
        canEdit
        canReadMemberships
        onSaved={vi.fn()}
        onCancelled={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const capacity = screen.getByLabelText("Maximum capacity");
    expect(capacity).toHaveAttribute("min", "1");
    expect(capacity).toHaveAttribute("max", "300");
  });

  it("closes on Escape and hands the focus back to the opener", () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const view = render(
      <SessionPanel
        mode="edit"
        session={sessionFixture}
        catalog={catalog}
        staff={staff}
        timezone="Europe/Jersey"
        canEdit
        canReadMemberships
        onSaved={vi.fn()}
        onCancelled={vi.fn()}
        onClose={onClose}
      />,
    );
    expect(screen.getByLabelText("Date")).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
