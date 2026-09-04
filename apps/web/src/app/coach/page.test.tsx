import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionOperationalView, SessionRecord } from "@bpt-jersey/domain/schedule";

const mockStaffSession = {
  session: {
    uid: "coach-user-1",
    email: "coach@bptjersey.com",
    displayName: "Coach Thiago",
    academyId: "bpt-jersey",
    role: "coach" as const,
  },
  status: "signed-in" as const,
  signOut: vi.fn(),
};

vi.mock("../../lib/staff-auth", () => ({
  useStaffSession: () => mockStaffSession,
}));

const mockTownSession: SessionRecord = {
  sessionId: "session-town-1",
  academyId: "bpt-jersey",
  classId: "class-1",
  locationId: "town",
  programId: "bjj-adults",
  instructorId: "coach-1",
  title: "Adults Gi Fundamental - Town",
  startAt: "2026-09-04T18:00:00.000Z",
  endAt: "2026-09-04T19:30:00.000Z",
  capacity: 20,
  minParticipants: 4,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  schemaVersion: "1",
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: "admin-1",
  updatedAt: "2026-09-01T00:00:00.000Z",
  updatedBy: "admin-1",
};

const mockWestSession: SessionRecord = {
  sessionId: "session-west-1",
  academyId: "bpt-jersey",
  classId: "class-2",
  locationId: "west",
  programId: "bjj-kids",
  instructorId: "coach-2",
  title: "Kids BJJ - West",
  startAt: "2026-09-04T16:30:00.000Z",
  endAt: "2026-09-04T17:30:00.000Z",
  capacity: 15,
  minParticipants: 4,
  status: "scheduled",
  isSeminar: false,
  cancellationReason: null,
  schemaVersion: "1",
  createdAt: "2026-09-01T00:00:00.000Z",
  createdBy: "admin-1",
  updatedAt: "2026-09-01T00:00:00.000Z",
  updatedBy: "admin-1",
};

const mockOperationalView: SessionOperationalView = {
  session: mockTownSession,
  summary: {
    capacity: 20,
    minParticipants: 4,
    quorumMet: true,
    totalBookings: 5,
    totalCheckedIn: 1,
    totalCheckedOut: 0,
    totalNoShows: 0,
    totalPendingArrival: 4,
  },
  roster: [
    {
      studentId: "student-1",
      booking: {
        bookingId: "book-1",
        academyId: "bpt-jersey",
        sessionId: "session-town-1",
        studentId: "student-1",
        membershipId: "mem-1",
        status: "confirmed",
        requestedAt: "2026-09-02T10:00:00.000Z",
        cancelledAt: null,
        cancellationReason: null,
        schemaVersion: "1",
        createdAt: "2026-09-02T10:00:00.000Z",
        createdBy: "student-1",
        updatedAt: "2026-09-02T10:00:00.000Z",
        updatedBy: "student-1",
      },
      attendance: null,
      checkout: null,
      computedStatus: "booked_not_arrived",
    },
    {
      studentId: "student-2",
      booking: {
        bookingId: "book-2",
        academyId: "bpt-jersey",
        sessionId: "session-town-1",
        studentId: "student-2",
        membershipId: "mem-2",
        status: "confirmed",
        requestedAt: "2026-09-02T11:00:00.000Z",
        cancelledAt: null,
        cancellationReason: null,
        schemaVersion: "1",
        createdAt: "2026-09-02T11:00:00.000Z",
        createdBy: "student-2",
        updatedAt: "2026-09-02T11:00:00.000Z",
        updatedBy: "student-2",
      },
      attendance: {
        attendanceId: "att-2",
        academyId: "bpt-jersey",
        sessionId: "session-town-1",
        studentId: "student-2",
        state: "attended",
        method: "manual",
        occurredAt: "2026-09-04T17:55:00.000Z",
        correctionOf: null,
        notes: null,
        schemaVersion: "1",
        createdAt: "2026-09-04T17:55:00.000Z",
        createdBy: "coach-user-1",
        updatedAt: "2026-09-04T17:55:00.000Z",
        updatedBy: "coach-user-1",
      },
      checkout: null,
      computedStatus: "attended",
    },
  ],
  unbookedCheckIns: [],
  refreshedAt: "2026-09-04T18:00:00.000Z",
};

const scheduleClientMock = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getSessionOperationalView: vi.fn(),
  recordCheckIn: vi.fn(),
}));

vi.mock("../../lib/schedule-client", () => scheduleClientMock);

import CoachDashboardPage from "./page";

describe("CoachDashboardPage", () => {
  beforeEach(() => {
    scheduleClientMock.listSessions.mockResolvedValue([mockTownSession, mockWestSession]);
    scheduleClientMock.getSessionOperationalView.mockImplementation(async (sessionId: string) => {
      if (sessionId === "session-west-1") {
        return {
          session: mockWestSession,
          summary: {
            capacity: 15,
            minParticipants: 4,
            quorumMet: false,
            totalBookings: 2,
            totalCheckedIn: 0,
            totalCheckedOut: 0,
            totalNoShows: 0,
            totalPendingArrival: 2,
          },
          roster: [],
          unbookedCheckIns: [],
          refreshedAt: "2026-09-04T16:30:00.000Z",
        };
      }
      return mockOperationalView;
    });
    scheduleClientMock.recordCheckIn.mockResolvedValue({
      attendanceId: "att-new",
      academyId: "bpt-jersey",
      sessionId: "session-town-1",
      studentId: "student-1",
      state: "attended",
      method: "manual",
      occurredAt: "2026-09-04T18:01:00.000Z",
      correctionOf: null,
      notes: null,
      schemaVersion: "1",
      createdAt: "2026-09-04T18:01:00.000Z",
      createdBy: "coach-user-1",
      updatedAt: "2026-09-04T18:01:00.000Z",
      updatedBy: "coach-user-1",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders the coach dashboard with town premises selected by default", async () => {
    render(<CoachDashboardPage />);

    expect(screen.getByText("Coach Operations Dashboard")).toBeInTheDocument();
    expect(screen.getByText(/Coach Thiago/)).toBeInTheDocument();

    // Verify premises radio buttons
    const townBtn = screen.getByRole("radio", { name: "Town (St Helier)" });
    const westBtn = screen.getByRole("radio", { name: "West (St Peter)" });
    expect(townBtn).toBeInTheDocument();
    expect(westBtn).toBeInTheDocument();
    expect(townBtn).toHaveAttribute("aria-checked", "true");

    // Expect Town session to be loaded and shown
    await waitFor(() => {
      expect(screen.getByText("Adults Gi Fundamental - Town")).toBeInTheDocument();
    });

    // West session should NOT be shown while Town is selected
    expect(screen.queryByText("Kids BJJ - West")).not.toBeInTheDocument();

    // Quorum status
    await waitFor(() => {
      expect(screen.getByText("✓ Quorum Met (>=4)")).toBeInTheDocument();
    });

    // Birthdays widget
    expect(screen.getByText("🎂 Upcoming Birthdays")).toBeInTheDocument();
    expect(screen.getByText("Lucas Silva")).toBeInTheDocument();
  });

  it("filters classes when switching to West premises", async () => {
    render(<CoachDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Adults Gi Fundamental - Town")).toBeInTheDocument();
    });

    const westBtn = screen.getByRole("radio", { name: "West (St Peter)" });
    fireEvent.click(westBtn);

    expect(westBtn).toHaveAttribute("aria-checked", "true");

    await waitFor(() => {
      expect(screen.getByText("Kids BJJ - West")).toBeInTheDocument();
    });
    expect(screen.queryByText("Adults Gi Fundamental - Town")).not.toBeInTheDocument();

    // Quorum warning for West class (only 2 booked)
    await waitFor(() => {
      expect(screen.getByText("⚠ Quorum Warning (2/4)")).toBeInTheDocument();
    });
  });

  it("loads and displays the pre-class roster with check-in buttons", async () => {
    render(<CoachDashboardPage />);

    await waitFor(() => {
      expect(screen.getByRole("table", { name: "Class attendees roster" })).toBeInTheDocument();
    });

    // Student-1 is pending arrival and has a Check In button
    expect(screen.getByText("student-1")).toBeInTheDocument();
    const checkInBtn = screen.getByRole("button", { name: "Check In" });
    expect(checkInBtn).toBeInTheDocument();

    // Student-2 is already checked in
    expect(screen.getByText("student-2")).toBeInTheDocument();
    expect(screen.getByText("✓ Checked In")).toBeInTheDocument();

    // Perform check-in on student-1
    fireEvent.click(checkInBtn);

    await waitFor(() => {
      expect(scheduleClientMock.recordCheckIn).toHaveBeenCalledWith({
        sessionId: "session-town-1",
        studentId: "student-1",
        method: "manual",
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText("Manual check-in confirmed for student student-1."),
      ).toBeInTheDocument();
    });
  });

  it("submits cash PAYG check-in with receipt confirmation", async () => {
    render(<CoachDashboardPage />);

    await waitFor(() => {
      expect(screen.getByRole("table", { name: "Class attendees roster" })).toBeInTheDocument();
    });

    const paygInput = screen.getByPlaceholderText("Student or Member ID (e.g. stu_walkin_01)");
    fireEvent.change(paygInput, { target: { value: "student-walkin-99" } });

    const paygSubmitBtn = screen.getByRole("button", {
      name: "Record Cash PAYG & Check In",
    });
    fireEvent.click(paygSubmitBtn);

    await waitFor(() => {
      expect(scheduleClientMock.recordCheckIn).toHaveBeenCalledWith({
        sessionId: "session-town-1",
        studentId: "student-1".length > 0 ? "student-walkin-99" : expect.any(String),
        method: "manual",
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "Cash PAYG attendance recorded for student student-walkin-99 (£10 received). Receipt generated.",
        ),
      ).toBeInTheDocument();
    });
  });
});
