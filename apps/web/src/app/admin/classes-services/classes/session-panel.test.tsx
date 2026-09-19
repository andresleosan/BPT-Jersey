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

import { parseCreateSessionInput, parseUpdateSessionInput } from "@bpt-jersey/domain/schedule";

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

  it("creates a session with several trainers, a capacity and custom rules", async () => {
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
    fireEvent.change(screen.getByLabelText("Maximum capacity"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Booking and cancellation"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText("Allow bookings until (minutes before)"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() =>
      expect(mocks.saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          programId: "p1",
          locationId: "town",
          instructorId: "coach-a",
          instructorIds: ["coach-a", "coach-b"],
          capacity: 20,
          minParticipants: 4,
          startAt: "2026-09-14T16:30:00.000Z",
          endAt: "2026-09-14T17:30:00.000Z",
          bookingRules: expect.objectContaining({ bookUntilMinutesBefore: 30 }),
        }),
      ),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  function renderCapacityPanel(mode: "create" | "edit", minimum = 4, maximum = 20) {
    return render(
      <SessionPanel
        mode={mode}
        session={
          mode === "edit"
            ? { ...sessionFixture, minParticipants: minimum, capacity: maximum }
            : undefined
        }
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
  }

  it("loads registrations only when requested and preserves them when switching views", async () => {
    renderCapacityPanel("edit");
    expect(mocks.listSessionBookings).not.toHaveBeenCalled();
    expect(mocks.listMemberNames).not.toHaveBeenCalled();
    expect(mocks.listMemberships).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Registrations" }));
    await waitFor(() => expect(mocks.listSessionBookings).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Session details" }));
    fireEvent.click(screen.getByRole("button", { name: "Registrations" }));
    expect(mocks.listSessionBookings).toHaveBeenCalledTimes(1);
  });

  it("prevents closing or changing fields while a save is pending", async () => {
    mocks.updateSession.mockReturnValue(new Promise(() => {}));
    renderCapacityPanel("edit");
    fireEvent.change(screen.getByLabelText("Maximum capacity"), { target: { value: "24" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close session" })).toBeDisabled();
    expect(screen.getByLabelText("Maximum capacity")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy session" })).toBeDisabled();
  });

  it("explains an empty date and restores saving after a valid date is entered", () => {
    renderCapacityPanel("edit");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByLabelText("Date")).toHaveAccessibleDescription(
      "Enter a date, start time and end time.",
    );
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-21" } });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  function renderRepeatingPanel(repeating = true) {
    render(
      <SessionPanel
        mode="edit"
        session={{
          ...sessionFixture,
          ...(repeating ? { weeklySeriesId: "s1", weeklyIndex: 0, repeatWeekly: true } : {}),
        }}
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
  }

  it("enables indefinite weekly repetition on an existing session", async () => {
    mocks.updateSession.mockResolvedValue(sessionFixture);
    renderRepeatingPanel(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Repeat every week" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mocks.updateSession).toHaveBeenCalledWith({ sessionId: "s1", repeatWeekly: true }),
    );
  });

  it("creates a weekly series only when repetition is selected", async () => {
    mocks.saveSession.mockResolvedValue(sessionFixture);
    renderCapacityPanel("create");
    fireEvent.change(screen.getByLabelText("Maximum capacity"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "coach-a" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Repeat every week" }));
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() =>
      expect(mocks.saveSession).toHaveBeenCalledWith(
        expect.objectContaining({ repeatWeekly: true, minParticipants: 4, capacity: 12 }),
      ),
    );
  });

  it("defaults to this date and requires following scope before stopping a series", async () => {
    mocks.updateSession.mockResolvedValue(sessionFixture);
    renderRepeatingPanel();
    expect(screen.getByLabelText("Apply changes to")).toHaveValue("single");
    expect(screen.getByRole("checkbox", { name: "Repeat every week" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Apply changes to"), { target: { value: "following" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Repeat every week" }));
    expect(screen.getByText(/Following sessions will be cancelled/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mocks.updateSession).toHaveBeenCalledWith({
        sessionId: "s1",
        repeatWeekly: false,
        repeatScope: "following",
      }),
    );
  });

  it("copies a recurring date as a one-off draft to avoid a second accidental series", () => {
    renderRepeatingPanel();
    fireEvent.click(screen.getByRole("button", { name: "Copy session" }));
    expect(screen.getByRole("checkbox", { name: "Repeat every week" })).not.toBeChecked();
    expect(screen.queryByLabelText("Apply changes to")).not.toBeInTheDocument();
  });

  it("blocks a maximum below the default minimum before sending a create request", () => {
    renderCapacityPanel("create");
    fireEvent.click(screen.getByRole("checkbox", { name: "coach-a" }));
    fireEvent.change(screen.getByLabelText("Maximum capacity"), { target: { value: "3" } });
    expect(screen.getByRole("button", { name: "Create session" })).toBeDisabled();
    expect(screen.getByLabelText("Minimum participants")).toHaveValue(4);
  });

  it("blocks reducing the maximum below an existing minimum", () => {
    renderCapacityPanel("edit", 8);
    fireEvent.change(screen.getByLabelText("Maximum capacity"), { target: { value: "6" } });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByLabelText("Minimum participants")).toHaveValue(8);
    expect(screen.getByLabelText("Minimum participants")).toHaveAccessibleDescription(
      /Minimum participants cannot exceed maximum capacity/,
    );
    fireEvent.change(screen.getByLabelText("Maximum capacity"), { target: { value: "8" } });
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    expect(screen.getByLabelText("Minimum participants")).toHaveAttribute("aria-invalid", "false");
  });

  it.each(["create", "edit"] as const)(
    "validates both capacity fields together in %s mode",
    (mode) => {
      renderCapacityPanel(mode);
      if (mode === "create") fireEvent.click(screen.getByRole("checkbox", { name: "coach-a" }));
      const minimum = screen.getByLabelText("Minimum participants");
      const maximum = screen.getByLabelText("Maximum capacity");
      const save = screen.getByRole("button", {
        name: mode === "edit" ? "Save changes" : "Create session",
      });
      for (const [min, max, valid] of [
        ["", "20", false],
        ["-1", "20", false],
        ["1.5", "20", false],
        ["301", "300", false],
        ["4", "", false],
        ["0", "0", false],
        ["4", "301", false],
        ["4", "20.5", false],
        ["5", "4", false],
        ["4", "4", true],
        ["0", "1", true],
        ["300", "300", true],
      ] as const) {
        fireEvent.change(minimum, { target: { value: min } });
        fireEvent.change(maximum, { target: { value: max } });
        if (valid) expect(save).toBeEnabled();
        else {
          expect(save).toBeDisabled();
          fireEvent.click(save);
        }
      }
      expect(mocks.saveSession).not.toHaveBeenCalled();
      expect(mocks.updateSession).not.toHaveBeenCalled();
    },
  );

  it("creates a small session with an explicit minimum accepted by the server contract", async () => {
    mocks.saveSession.mockResolvedValue({ ...sessionFixture, capacity: 2, minParticipants: 1 });
    renderCapacityPanel("create");
    fireEvent.click(screen.getByRole("checkbox", { name: "coach-a" }));
    fireEvent.change(screen.getByLabelText("Minimum participants"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Maximum capacity"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() => expect(mocks.saveSession).toHaveBeenCalledOnce());
    const input = mocks.saveSession.mock.calls[0]![0];
    expect(input).toMatchObject({ minParticipants: 1, capacity: 2 });
    expect(parseCreateSessionInput(input).ok).toBe(true);
  });

  it("updates both limits together and restores them when reopened", async () => {
    const saved = { ...sessionFixture, minParticipants: 2, capacity: 3 };
    mocks.updateSession.mockResolvedValue(saved);
    const view = renderCapacityPanel("edit", 8);
    fireEvent.change(screen.getByLabelText("Maximum capacity"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Minimum participants"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mocks.updateSession).toHaveBeenCalledOnce());
    const input = mocks.updateSession.mock.calls[0]![0];
    expect(input).toEqual({ sessionId: "s1", minParticipants: 2, capacity: 3 });
    expect(parseUpdateSessionInput(input).ok).toBe(true);
    view.unmount();
    renderCapacityPanel("edit", saved.minParticipants, saved.capacity);
    expect(screen.getByLabelText("Minimum participants")).toHaveValue(2);
    expect(screen.getByLabelText("Maximum capacity")).toHaveValue(3);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("saves a minimum of zero without changing the maximum", async () => {
    mocks.updateSession.mockResolvedValue({ ...sessionFixture, minParticipants: 0 });
    renderCapacityPanel("edit", 4);
    fireEvent.change(screen.getByLabelText("Minimum participants"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mocks.updateSession).toHaveBeenCalledWith({ sessionId: "s1", minParticipants: 0 }),
    );
  });

  it("preserves both limits when copying a session", async () => {
    mocks.saveSession.mockResolvedValue(sessionFixture);
    renderCapacityPanel("edit", 7, 15);
    fireEvent.click(screen.getByRole("button", { name: "Copy session" }));
    expect(screen.getByLabelText("Minimum participants")).toHaveValue(7);
    expect(screen.getByLabelText("Maximum capacity")).toHaveValue(15);
    fireEvent.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() =>
      expect(mocks.saveSession).toHaveBeenCalledWith(
        expect.objectContaining({ minParticipants: 7, capacity: 15 }),
      ),
    );
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
    fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Coach unavailable" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Copy session" }));
    expect(screen.getByRole("button", { name: "Create session" })).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel session" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Maximum capacity")).toBeDisabled();
    expect(screen.getByLabelText("Minimum participants")).toBeDisabled();
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
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
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
    expect(screen.getByRole("button", { name: "Create session" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "coach-a" }));
    fireEvent.change(screen.getByLabelText("Maximum capacity"), { target: { value: "10" } });
    expect(screen.getByRole("button", { name: "Create session" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "17:00" } });
    expect(screen.getByText("End time must be after the start time")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create session" })).toBeDisabled();
  });

  it("blocks creating a session until a capacity between 1 and 300 is entered", () => {
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
    fireEvent.click(screen.getByRole("checkbox", { name: "coach-a" }));
    const create = screen.getByRole("button", { name: "Create session" });
    const capacity = screen.getByLabelText("Maximum capacity");
    expect(capacity).toBeRequired();
    expect(screen.getByText("Enter a maximum capacity between 1 and 300")).toBeInTheDocument();
    expect(create).toBeDisabled();
    fireEvent.change(capacity, { target: { value: "301" } });
    expect(create).toBeDisabled();
    fireEvent.change(capacity, { target: { value: "12" } });
    expect(create).toBeEnabled();
    expect(
      screen.queryByText("Enter a maximum capacity between 1 and 300"),
    ).not.toBeInTheDocument();
  });

  it("keeps a legacy session without a capacity unsaveable until one is entered", async () => {
    mocks.updateSession.mockResolvedValue({ ...sessionFixture, capacity: 12 });
    render(
      <SessionPanel
        mode="edit"
        session={{ ...sessionFixture, capacity: null }}
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
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(screen.getByLabelText("Maximum capacity")).toHaveValue(null);
    expect(screen.getByText("Enter a maximum capacity between 1 and 300")).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Maximum capacity"), { target: { value: "12" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(mocks.updateSession).toHaveBeenCalledWith({ sessionId: "s1", capacity: 12 }),
    );
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
    expect(screen.getByRole("heading", { name: "Edit session" })).toHaveFocus();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalled();
    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
  it("preserves an existing trainer missing from the staff directory when adding another", async () => {
    mocks.updateSession.mockResolvedValue(sessionFixture);
    render(
      <SessionPanel
        mode="edit"
        session={{
          ...sessionFixture,
          instructorId: "legacy-coach",
          instructorIds: ["legacy-coach"],
        }}
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
    expect(screen.getByRole("checkbox", { name: "legacy-coach" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "coach-b" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mocks.updateSession).toHaveBeenCalledWith({
        sessionId: "s1",
        instructorIds: ["legacy-coach", "coach-b"],
      }),
    );
  });
  it("reopens saved academy trainers and allows replacing them by name", async () => {
    mocks.updateSession.mockResolvedValue(sessionFixture);
    render(
      <SessionPanel
        mode="edit"
        session={{
          ...sessionFixture,
          instructorId: "coach-charlie",
          instructorIds: ["coach-charlie", "coach-catalina"],
        }}
        catalog={catalog}
        staff={[]}
        timezone="Europe/Jersey"
        canEdit
        canReadMemberships
        onSaved={vi.fn()}
        onCancelled={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Charlie Tromans" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Catalina Bruma" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Charlie Tromans" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mocks.updateSession).toHaveBeenCalledWith({
        sessionId: "s1",
        instructorId: "coach-catalina",
        instructorIds: ["coach-catalina"],
      }),
    );
  });

  it("does not offer inactive staff for new assignments", () => {
    render(
      <SessionPanel
        mode="create"
        catalog={catalog}
        staff={[{ ...staff[0], active: false, status: "inactive" }]}
        timezone="Europe/Jersey"
        canEdit
        canReadMemberships
        onSaved={vi.fn()}
        onCancelled={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("checkbox", { name: "coach-a" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Charlie Tromans" })).toBeEnabled();
  });
});
