import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const waitlistState = vi.hoisted(() => ({
  list: vi.fn(),
  issue: vi.fn(),
}));
const scheduleState = vi.hoisted(() => ({ listSessions: vi.fn() }));

vi.mock("../../../lib/admin-waitlist-client", () => ({
  listAdminSessionWaitlist: waitlistState.list,
  issueNextAdminWaitlistOffer: waitlistState.issue,
}));
vi.mock("../../../lib/schedule-client", () => ({
  listSessions: scheduleState.listSessions,
}));

import { AdminWaitlistsPage } from "./page";

const session = {
  sessionId: "session-private-1",
  academyId: "academy-private-1",
  classId: "class-1",
  programId: "program-1",
  locationId: "town",
  instructorId: "coach-1",
  title: "Adult Fundamentals",
  startAt: "2026-09-10T17:30:00.000Z",
  endAt: "2026-09-10T18:30:00.000Z",
  capacity: 12,
  minParticipants: 2,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  schemaVersion: "1",
  createdAt: "2026-08-01T10:00:00.000Z",
  createdBy: "admin-1",
  updatedAt: "2026-08-01T10:00:00.000Z",
  updatedBy: "admin-1",
} as const;

const waitingEntry = {
  sessionId: session.sessionId,
  studentReference: "student-private-1",
  position: 1,
  status: "waiting",
  requestedAt: "2026-09-01T09:00:00.000Z",
  offeredAt: null,
  offerExpiresAt: null,
  acceptedAt: null,
  cancelledAt: null,
} as const;

const offeredEntry = {
  ...waitingEntry,
  status: "offered",
  offeredAt: "2026-09-01T09:10:00.000Z",
  offerExpiresAt: "2026-09-01T09:40:00.000Z",
} as const;

describe("admin class waitlists", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-01T08:00:00.000Z"));
    scheduleState.listSessions.mockResolvedValue([session]);
    waitlistState.list.mockResolvedValue([waitingEntry]);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("offers one FIFO action without a student selector or visible internal identifiers", async () => {
    render(<AdminWaitlistsPage />);

    expect(await screen.findByRole("heading", { name: "Class waitlists" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Class" })).toHaveTextContent("Adult Fundamentals");
    expect(screen.queryByRole("combobox", { name: /student|participant/i })).toBeNull();
    expect(await screen.findByLabelText("Queue position 1")).toHaveTextContent("01");
    expect(screen.getByRole("button", { name: "Offer next place" })).toBeEnabled();
    expect(screen.getByText("Waiting")).toBeVisible();
    expect(document.body).not.toHaveTextContent(
      /student-private|session-private|academy-private|class-1|program-1/i,
    );
  });

  it("shows the queue read-only without exposing the offer action", async () => {
    render(<AdminWaitlistsPage canIssue={false} />);

    expect(await screen.findByLabelText("Queue position 1")).toHaveTextContent("01");
    expect(screen.getByRole("combobox", { name: "Class" })).toHaveTextContent("Adult Fundamentals");
    expect(screen.getByText("Read-only staff access.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Offer next place" })).not.toBeInTheDocument();
    expect(waitlistState.issue).not.toHaveBeenCalled();
  });

  it("keeps the in-flight queue result when the selected class is chosen again", async () => {
    let resolveQueue: ((entries: readonly [typeof waitingEntry]) => void) | undefined;
    waitlistState.list.mockReturnValue(
      new Promise((resolve) => {
        resolveQueue = resolve;
      }),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AdminWaitlistsPage />);

    const selector = await screen.findByRole("combobox", { name: "Class" });
    await user.selectOptions(selector, session.sessionId);
    resolveQueue?.([waitingEntry]);

    expect(await screen.findByLabelText("Queue position 1")).toHaveTextContent("01");
    expect(waitlistState.list).toHaveBeenCalledOnce();
  });

  it("issues the next offer once and preserves feedback after refreshing", async () => {
    waitlistState.list.mockResolvedValueOnce([waitingEntry]).mockResolvedValueOnce([offeredEntry]);
    waitlistState.issue.mockResolvedValue(offeredEntry);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AdminWaitlistsPage />);

    const action = await screen.findByRole("button", { name: "Offer next place" });
    await waitFor(() => expect(action).toBeEnabled());
    await user.click(action);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Offer sent to the next eligible participant.",
    );
    expect(await screen.findByText("Offered")).toBeVisible();
    expect(waitlistState.issue).toHaveBeenCalledOnce();
    expect(waitlistState.issue).toHaveBeenCalledWith(session.sessionId);
    expect(waitlistState.list).toHaveBeenCalledTimes(2);
  });

  it("shows a safe empty state and disables the only action when nobody is waiting", async () => {
    waitlistState.list.mockResolvedValue([]);
    render(<AdminWaitlistsPage />);

    expect(await screen.findByText("Nobody is waiting for this class.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Offer next place" })).toBeDisabled();
  });

  it("does not offer another place while the class already has an active offer", async () => {
    waitlistState.list.mockResolvedValue([
      offeredEntry,
      { ...waitingEntry, studentReference: "student-private-2", position: 2 },
    ]);
    render(<AdminWaitlistsPage />);

    expect(await screen.findByText("An offer is already active for this class.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Offer next place" })).toBeDisabled();
  });
});
