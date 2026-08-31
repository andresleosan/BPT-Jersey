import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  session: {
    uid: "adult-1",
    email: "adult@example.test",
    displayName: "Ava Adult",
  } as { uid: string; email: string; displayName: string } | undefined,
}));

const waitlistState = vi.hoisted(() => ({
  listMemberships: vi.fn(),
  listWaitlist: vi.fn(),
  join: vi.fn(),
  cancel: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
}));

const scheduleState = vi.hoisted(() => ({ listSessions: vi.fn() }));
const profileState = vi.hoisted(() => ({ getProfile: vi.fn() }));
const familyState = vi.hoisted(() => ({ getFamily: vi.fn() }));

vi.mock("../../../lib/client-auth", () => ({
  ClientAuthGate: ({ children }: { children: React.ReactNode }) =>
    authState.session ? (
      children
    ) : (
      <a href="/login?role=client&returnTo=%2Faccount%2Fwaitlist">Sign in</a>
    ),
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useClientSession: () => authState,
}));

vi.mock("../../../lib/waitlist-client", () => ({
  listClientMemberships: waitlistState.listMemberships,
  listStudentWaitlist: waitlistState.listWaitlist,
  joinClientWaitlist: waitlistState.join,
  cancelClientWaitlist: waitlistState.cancel,
  acceptClientWaitlistOffer: waitlistState.accept,
  declineClientWaitlistOffer: waitlistState.decline,
}));

vi.mock("../../../lib/schedule-client", () => ({ listSessions: scheduleState.listSessions }));
vi.mock("../../../lib/profile-client", () => ({ getClientProfile: profileState.getProfile }));
vi.mock("../../../lib/family-client", () => ({ getFamily: familyState.getFamily }));

import WaitlistPage from "./page";

const membership = {
  membershipId: "membership-private-1",
  familyId: "family-private-1",
  studentId: "adult-1",
  planId: "adult-unlimited",
  status: "active",
  startsAt: "2026-01-01T00:00:00.000Z",
  endsAt: null,
  nextBillingAt: "2026-10-01T00:00:00.000Z",
} as const;

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
  position: 3,
  status: "waiting",
  requestedAt: "2026-09-01T10:00:00.000Z",
  offeredAt: null,
  offerExpiresAt: null,
  acceptedAt: null,
  cancelledAt: null,
} as const;

const offeredEntry = {
  ...waitingEntry,
  status: "offered",
  offeredAt: "2026-09-01T09:00:00.000Z",
  offerExpiresAt: "2026-09-01T09:30:00.000Z",
} as const;

const acceptedEntry = {
  ...offeredEntry,
  status: "accepted",
  acceptedAt: "2026-09-01T09:05:00.000Z",
} as const;

function configureBase(): void {
  waitlistState.listMemberships.mockResolvedValue([membership]);
  scheduleState.listSessions.mockResolvedValue([session]);

  familyState.getFamily.mockResolvedValue(undefined);
}

describe("account waitlist", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-01T09:00:00.000Z"));
    authState.session = {
      uid: "adult-1",
      email: "adult@example.test",
      displayName: "Ava Adult",
    };
    configureBase();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("keeps internal identifiers out of the visible self-service view", async () => {
    waitlistState.listWaitlist.mockResolvedValue([waitingEntry]);
    render(<WaitlistPage />);

    expect(
      await screen.findByRole("heading", { name: "Hold your place on the mat." }),
    ).toBeVisible();
    expect(screen.getByRole("option", { name: /Ava Adult/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Adult Fundamentals/ })).toBeVisible();
    expect(await screen.findByLabelText("Position 3")).toHaveTextContent("03");
    expect(screen.getByText("Waiting")).toBeVisible();
    expect(screen.queryByText(/private-1|academy-|membership-|session-/i)).not.toBeInTheDocument();
  });

  it("joins a queue and preserves success feedback after refreshing", async () => {
    waitlistState.listWaitlist.mockResolvedValueOnce([]).mockResolvedValueOnce([waitingEntry]);
    waitlistState.join.mockResolvedValue(waitingEntry);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<WaitlistPage />);

    await screen.findByText("No waitlist requests for this participant yet.");
    await user.click(screen.getByRole("button", { name: "Join waitlist" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Joined the waitlist at position 3.",
    );
    expect(await screen.findByLabelText("Position 3")).toBeVisible();
    expect(waitlistState.join).toHaveBeenCalledWith({
      sessionId: session.sessionId,
      studentId: membership.studentId,
      membershipId: membership.membershipId,
    });
    expect(waitlistState.listWaitlist).toHaveBeenCalledTimes(2);
  });

  it("requires an explicit second action to cancel and keeps the notice after refresh", async () => {
    const cancelledEntry = {
      ...waitingEntry,
      status: "cancelled",
      cancelledAt: "2026-09-01T11:00:00.000Z",
    } as const;
    waitlistState.listWaitlist
      .mockResolvedValueOnce([waitingEntry])
      .mockResolvedValueOnce([cancelledEntry]);
    waitlistState.cancel.mockResolvedValue(cancelledEntry);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<WaitlistPage />);

    await user.click(await screen.findByRole("button", { name: "Cancel place" }));
    expect(screen.getByText("Cancel this waitlist place?")).toBeVisible();
    expect(waitlistState.cancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Waitlist place cancelled.");
    await waitFor(() => expect(screen.getByText("Cancelled")).toBeVisible());
    expect(waitlistState.cancel).toHaveBeenCalledWith({
      sessionId: session.sessionId,
      studentId: membership.studentId,
    });
    expect(screen.getByRole("button", { name: "Request already recorded" })).toBeDisabled();
  });

  it("shows an absolute offer deadline, updates an informational minute countdown and accepts", async () => {
    waitlistState.listWaitlist
      .mockResolvedValueOnce([offeredEntry])
      .mockResolvedValueOnce([acceptedEntry]);
    waitlistState.accept.mockResolvedValue(acceptedEntry);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<WaitlistPage />);

    expect(await screen.findByText("30 min remaining")).toBeVisible();
    expect(document.querySelector("time")).toHaveAttribute("datetime", "2026-09-01T09:30:00.000Z");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_001);
    });
    expect(screen.getByText("29 min remaining")).toBeVisible();
    expect(waitlistState.accept).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Accept place" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Place accepted.");
    expect(await screen.findByText("Accepted")).toBeVisible();
    expect(waitlistState.accept).toHaveBeenCalledWith({
      sessionId: session.sessionId,
      studentId: membership.studentId,
    });
    expect(waitlistState.listWaitlist).toHaveBeenCalledTimes(2);
  });

  it("requires confirmation before declining an offer and preserves feedback after refresh", async () => {
    const declinedEntry = {
      ...offeredEntry,
      status: "cancelled",
      cancelledAt: "2026-09-01T09:06:00.000Z",
    } as const;
    waitlistState.listWaitlist
      .mockResolvedValueOnce([offeredEntry])
      .mockResolvedValueOnce([declinedEntry]);
    waitlistState.decline.mockResolvedValue(declinedEntry);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<WaitlistPage />);

    await user.click(await screen.findByRole("button", { name: "Decline offer" }));
    expect(screen.getByText("Decline this offered place?")).toBeVisible();
    expect(waitlistState.decline).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm decline" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Offer declined.");
    expect(await screen.findByText("Cancelled")).toBeVisible();
    expect(waitlistState.decline).toHaveBeenCalledWith({
      sessionId: session.sessionId,
      studentId: membership.studentId,
    });
  });

  it("ignores an offer response after the participant selection changes", async () => {
    let resolveAccept: ((value: typeof acceptedEntry) => void) | undefined;
    waitlistState.listMemberships.mockResolvedValue([
      membership,
      {
        ...membership,
        membershipId: "membership-private-2",
        studentId: "child-private-1",
      },
    ]);
    familyState.getFamily.mockResolvedValue({
      family: { familyId: "family-private-1" },
      students: [{ studentId: "child-private-1", fullName: "Charlie Child" }],
    });
    waitlistState.listWaitlist.mockImplementation((studentId: string) =>
      Promise.resolve(studentId === membership.studentId ? [offeredEntry] : []),
    );
    waitlistState.accept.mockReturnValue(
      new Promise((resolve) => {
        resolveAccept = resolve;
      }),
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<WaitlistPage />);

    await user.click(await screen.findByRole("button", { name: "Accept place" }));
    await user.selectOptions(screen.getByLabelText("Participant"), "child-private-1");
    expect(await screen.findByText("No waitlist requests for this participant yet.")).toBeVisible();

    await act(async () => {
      resolveAccept?.(acceptedEntry);
      await Promise.resolve();
    });

    expect(screen.queryByText("Place accepted.")).not.toBeInTheDocument();
    expect(screen.getByText("No waitlist requests for this participant yet.")).toBeVisible();
  });

  it("uses family names for guardian-scoped participants without exposing IDs", async () => {
    authState.session = {
      uid: "guardian-1",
      email: "guardian@example.test",
      displayName: "Grace Guardian",
    };
    waitlistState.listMemberships.mockResolvedValue([
      { ...membership, studentId: "child-private-1" },
    ]);
    familyState.getFamily.mockResolvedValue({
      family: { familyId: "family-private-1" },
      students: [{ studentId: "child-private-1", fullName: "Charlie Child" }],
    });
    waitlistState.listWaitlist.mockResolvedValue([]);
    render(<WaitlistPage />);

    expect(await screen.findByRole("option", { name: "Charlie Child" })).toBeVisible();
    expect(screen.queryByText("child-private-1")).not.toBeInTheDocument();
  });

  it("shows a safe empty state when no eligible membership exists", async () => {
    waitlistState.listMemberships.mockResolvedValue([]);
    waitlistState.listWaitlist.mockResolvedValue([]);
    render(<WaitlistPage />);

    expect(
      await screen.findByText("No active or trial membership is available for this account."),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Join waitlist" })).not.toBeInTheDocument();
  });
});
