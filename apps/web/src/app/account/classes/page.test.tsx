import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  session: {
    uid: "guardian-auth-1",
    email: "guardian@example.test",
    displayName: "Guardian",
  } as { uid: string; email: string; displayName: string } | undefined,
}));

const membershipApi = vi.hoisted(() => ({ listClientMemberships: vi.fn() }));
const scheduleApi = vi.hoisted(() => ({
  cancelBooking: vi.fn(),
  listSessions: vi.fn(),
  listStudentBookings: vi.fn(),
  requestBooking: vi.fn(),
}));

vi.mock("../../../lib/client-auth", () => ({
  ClientAuthGate: ({ children }: { children: React.ReactNode }) =>
    authState.session ? children : <a href="/login">Sign in</a>,
  ClientAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useClientSession: () => ({ session: authState.session }),
}));
vi.mock("../../../lib/waitlist-client", () => ({
  listClientMemberships: membershipApi.listClientMemberships,
}));
vi.mock("../../../lib/schedule-client", () => scheduleApi);

import AccountClassesPage from "./page";

const memberships = [
  {
    membershipId: "membership-authorized-1",
    familyId: "family-authorized-1",
    studentId: "student-authorized-1",
    planId: "town-adult",
    status: "active",
    startsAt: "2026-08-01T00:00:00.000Z",
    endsAt: null,
    nextBillingAt: "2026-10-01T00:00:00.000Z",
  },
  {
    membershipId: "membership-authorized-2",
    familyId: "family-authorized-1",
    studentId: "student-authorized-2",
    planId: "town-teens",
    status: "trial",
    startsAt: "2026-09-01T00:00:00.000Z",
    endsAt: null,
    nextBillingAt: null,
  },
] as const;

const sessions = [
  {
    sessionId: "session-available-1",
    academyId: "academy-1",
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
  },
  {
    sessionId: "session-full-1",
    academyId: "academy-1",
    classId: "class-2",
    programId: "program-2",
    locationId: "west",
    instructorId: "coach-2",
    title: "Competition Class",
    startAt: "2026-09-11T18:00:00.000Z",
    endAt: "2026-09-11T19:00:00.000Z",
    capacity: 1,
    minParticipants: 1,
    status: "scheduled",
    isSeminar: false,
    cancellationReason: null,
    schemaVersion: "1",
    createdAt: "2026-08-01T10:00:00.000Z",
    createdBy: "admin-1",
    updatedAt: "2026-08-01T10:00:00.000Z",
    updatedBy: "admin-1",
  },
] as const;

function booking(sessionId: string, status: "confirmed" | "cancelled") {
  return {
    bookingId: `booking-${sessionId}`,
    academyId: "academy-1",
    sessionId,
    studentId: memberships[0].studentId,
    membershipId: memberships[0].membershipId,
    status,
    requestedAt: "2026-09-03T12:00:00.000Z",
    cancelledAt: status === "cancelled" ? "2026-09-03T12:05:00.000Z" : null,
    cancellationReason: status === "cancelled" ? "Schedule changed" : null,
    schemaVersion: "1" as const,
    createdAt: "2026-09-03T12:00:00.000Z",
    createdBy: "guardian-auth-1",
    updatedAt: "2026-09-03T12:05:00.000Z",
    updatedBy: "guardian-auth-1",
  } as const;
}

describe("account classes", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-03T12:00:00.000Z"));
    membershipApi.listClientMemberships.mockResolvedValue(memberships);
    scheduleApi.listSessions.mockResolvedValue(sessions);
    scheduleApi.listStudentBookings.mockResolvedValue([]);
    scheduleApi.requestBooking.mockImplementation(async ({ sessionId }: { sessionId: string }) => {
      if (sessionId === sessions[1].sessionId) {
        throw Object.assign(new Error("private capacity internals"), {
          code: "functions/failed-precondition",
          details: { reason: "capacity" },
        });
      }
      return booking(sessionId, "confirmed");
    });
    scheduleApi.cancelBooking.mockImplementation(async ({ sessionId }: { sessionId: string }) =>
      booking(sessionId, "cancelled"),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("uses authorized membership bindings while leaving availability decisions to the backend", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AccountClassesPage />);

    expect(await screen.findByRole("heading", { name: "Choose your next session." })).toBeVisible();
    expect(screen.getAllByRole("option", { name: /Participant [12]/ })).toHaveLength(2);
    expect(
      screen.queryByText(/student-authorized|membership-authorized|academy-1/i),
    ).not.toBeInTheDocument();

    const availableClass = screen.getByRole("article", { name: "Adult Fundamentals" });
    const reserveAvailable = within(availableClass).getByRole("button", {
      name: "Reserve place",
    });
    await waitFor(() => expect(reserveAvailable).toBeEnabled());
    await user.click(reserveAvailable);
    await waitFor(() =>
      expect(scheduleApi.requestBooking).toHaveBeenCalledWith({
        sessionId: sessions[0].sessionId,
        studentId: memberships[0].studentId,
        membershipId: memberships[0].membershipId,
      }),
    );
    expect(within(availableClass).getByText("Confirmed")).toBeVisible();

    await user.click(within(availableClass).getByRole("button", { name: "Cancel booking" }));
    await user.type(screen.getByLabelText("Cancellation reason"), "Schedule changed");
    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    await waitFor(() =>
      expect(scheduleApi.cancelBooking).toHaveBeenCalledWith({
        sessionId: sessions[0].sessionId,
        studentId: memberships[0].studentId,
        reason: "Schedule changed",
      }),
    );
    expect(within(availableClass).getByText("Cancelled")).toBeVisible();

    const fullClass = screen.getByRole("article", { name: "Competition Class" });
    await user.click(within(fullClass).getByRole("button", { name: "Reserve place" }));
    expect(
      await within(fullClass).findByText("No booking was created because this class is full."),
    ).toBeVisible();
    expect(within(fullClass).getByRole("link", { name: "Join the waitlist" })).toHaveAttribute(
      "href",
      "/account/waitlist",
    );
    expect(screen.queryByText("private capacity internals")).not.toBeInTheDocument();
  });
});
