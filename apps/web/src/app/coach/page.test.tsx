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
vi.mock("../../lib/levels-client", () => ({
  getLevelCatalog: vi.fn(async () => ({ definitions: [] })),
  openStudentLevel: vi.fn(),
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
  getScheduleCatalog: vi.fn(),
  getPreClassView: vi.fn(),
}));

// T114: the pre-class list of the selected session.
function preClassView(
  attendees: readonly Record<string, unknown>[] = [],
  evidence: Record<string, unknown> = {},
) {
  return {
    session: mockTownSession,
    attendees,
    evidence: {
      open: true,
      windowDays: 56,
      minAttendances: 2,
      comparableSessionCount: 4,
      bookedCount: attendees.filter((entry) => entry.source === "booked").length,
      suggestedCount: attendees.filter((entry) => entry.source === "regular").length,
      ...evidence,
    },
    refreshedAt: "2026-09-04T17:00:00.000Z",
  };
}

vi.mock("../../lib/schedule-client", () => scheduleClientMock);

// The reduction from device position to distance has its own tests; here only the panel's use of
// the reading matters (T109).
const proximityMock = vi.hoisted(() => ({ measureCheckInProximity: vi.fn() }));

vi.mock("../../lib/check-in-proximity", () => proximityMock);

// T112: the upcoming birthdays now come from the canonical students, so the panel is driven by the
// callable client instead of a sample list.
const birthdaysMock = vi.hoisted(() => ({ listUpcomingBirthdays: vi.fn() }));

vi.mock("../../lib/birthdays-client", async () => {
  const actual = await vi.importActual<typeof import("../../lib/birthdays-client")>(
    "../../lib/birthdays-client",
  );
  return { ...actual, listUpcomingBirthdays: birthdaysMock.listUpcomingBirthdays };
});

function birthday(
  overrides: Partial<{
    studentId: string;
    displayName: string;
    daysAway: number;
    turningAge: number;
    participantType: "adult" | "minor";
    trainingCenter: "Town" | "West";
  }> = {},
) {
  return {
    studentId: "student-birthday-1",
    displayName: "Ana Coelho",
    daysAway: 2,
    turningAge: 30,
    participantType: "adult" as const,
    trainingCenter: "Town" as const,
    ...overrides,
  };
}

const townGeofence = { latitude: 49.186, longitude: -2.106 };

function townCatalog() {
  return {
    locations: [
      {
        locationId: "town" as const,
        academyId: "bpt-jersey",
        name: "BPT Town",
        address: "St Helier, Jersey",
        timezone: "Europe/Jersey",
        active: true,
        geofence: townGeofence,
        schemaVersion: "1" as const,
      },
    ],
    programs: [],
  };
}

import CoachDashboardPage from "./page";

describe("CoachDashboardPage", () => {
  beforeEach(() => {
    scheduleClientMock.listSessions.mockResolvedValue([mockTownSession, mockWestSession]);
    birthdaysMock.listUpcomingBirthdays.mockResolvedValue([]);
    scheduleClientMock.getPreClassView.mockResolvedValue(preClassView());
    // No site coordinates recorded by default, which is the honest starting state (T109).
    scheduleClientMock.getScheduleCatalog.mockResolvedValue({ locations: [], programs: [] });
    proximityMock.measureCheckInProximity.mockReset();
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

    // Birthdays widget: real members now, so with none seeded it says so (T112)
    expect(screen.getByText("🎂 Upcoming Birthdays")).toBeInTheDocument();
    expect(await screen.findByText("No birthdays at Town this week.")).toBeInTheDocument();
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
          "Manual check-in recorded for student student-walkin-99. Record the cash payment in Billing to issue the receipt.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("check-in location signal (T109)", () => {
    async function openRoster() {
      render(<CoachDashboardPage />);
      await waitFor(() => {
        expect(screen.getByRole("table", { name: "Class attendees roster" })).toBeInTheDocument();
      });
    }

    it("says so, and sends no signal, when the site has no coordinates", async () => {
      await openRoster();

      expect(screen.getByTestId("coach-proximity-status").textContent).toContain(
        "No coordinates are recorded for this site",
      );

      fireEvent.click(screen.getByRole("button", { name: "Check In" }));
      await waitFor(() => {
        expect(scheduleClientMock.recordCheckIn).toHaveBeenCalledWith({
          sessionId: "session-town-1",
          studentId: "student-1",
          method: "manual",
        });
      });
      expect(proximityMock.measureCheckInProximity).not.toHaveBeenCalled();
    });

    it("sends the measured distance when the device is inside the radius", async () => {
      scheduleClientMock.getScheduleCatalog.mockResolvedValue(townCatalog());
      const measurement = {
        distanceMeters: 18,
        accuracyMeters: 9,
        measuredAt: new Date().toISOString(),
      };
      proximityMock.measureCheckInProximity.mockResolvedValue({
        status: "measured",
        signal: "within",
        measurement,
      });
      await openRoster();

      fireEvent.click(screen.getByRole("button", { name: "Measure this device" }));
      await waitFor(() => {
        expect(screen.getByTestId("coach-proximity-status").textContent).toContain(
          "Measured 18 m from this site, inside the radius.",
        );
      });
      expect(proximityMock.measureCheckInProximity).toHaveBeenCalledWith({ site: townGeofence });
      expect(screen.queryByLabelText(/Why are you checking students in/u)).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Check In" }));
      await waitFor(() => {
        expect(scheduleClientMock.recordCheckIn).toHaveBeenCalledWith({
          sessionId: "session-town-1",
          studentId: "student-1",
          method: "manual",
          proximity: measurement,
        });
      });
    });

    it("requires a reason outside the radius before it will check anyone in", async () => {
      scheduleClientMock.getScheduleCatalog.mockResolvedValue(townCatalog());
      const measurement = {
        distanceMeters: 320,
        accuracyMeters: 11,
        measuredAt: new Date().toISOString(),
      };
      proximityMock.measureCheckInProximity.mockResolvedValue({
        status: "measured",
        signal: "outside",
        measurement,
      });
      await openRoster();

      fireEvent.click(screen.getByRole("button", { name: "Measure this device" }));
      await waitFor(() => {
        expect(screen.getByTestId("coach-proximity-status").textContent).toContain(
          "outside the 50 m radius",
        );
      });

      fireEvent.click(screen.getByRole("button", { name: "Check In" }));
      await waitFor(() => {
        expect(
          screen.getByText(/Record why you are checking this student in/u),
        ).toBeInTheDocument();
      });
      expect(scheduleClientMock.recordCheckIn).not.toHaveBeenCalled();

      const reason = "Signal drifted indoors; the student is on the mat.";
      fireEvent.change(screen.getByLabelText(/Why are you checking students in/u), {
        target: { value: reason },
      });
      fireEvent.click(screen.getByRole("button", { name: "Check In" }));
      await waitFor(() => {
        expect(scheduleClientMock.recordCheckIn).toHaveBeenCalledWith({
          sessionId: "session-town-1",
          studentId: "student-1",
          method: "manual",
          proximity: measurement,
          overrideReason: reason,
        });
      });
    });

    it("gates the cash PAYG check-in behind the same override reason", async () => {
      scheduleClientMock.getScheduleCatalog.mockResolvedValue(townCatalog());
      proximityMock.measureCheckInProximity.mockResolvedValue({
        status: "measured",
        signal: "outside",
        measurement: {
          distanceMeters: 320,
          accuracyMeters: 11,
          measuredAt: new Date().toISOString(),
        },
      });
      await openRoster();

      fireEvent.click(screen.getByRole("button", { name: "Measure this device" }));
      await waitFor(() => {
        expect(screen.getByLabelText(/Why are you checking students in/u)).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText("Student or Member ID (e.g. stu_walkin_01)"), {
        target: { value: "student-walkin-99" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Record Cash PAYG & Check In" }));
      await waitFor(() => {
        expect(
          screen.getByText(/Record why you are checking this student in/u),
        ).toBeInTheDocument();
      });
      expect(scheduleClientMock.recordCheckIn).not.toHaveBeenCalled();
    });

    it("stops using a measurement once it is older than ten minutes", async () => {
      scheduleClientMock.getScheduleCatalog.mockResolvedValue(townCatalog());
      proximityMock.measureCheckInProximity.mockResolvedValue({
        status: "measured",
        signal: "outside",
        measurement: {
          distanceMeters: 320,
          accuracyMeters: 11,
          // Measured a quarter of an hour ago: the server would call this unavailable.
          measuredAt: new Date(Date.now() - 15 * 60_000).toISOString(),
        },
      });
      await openRoster();

      fireEvent.click(screen.getByRole("button", { name: "Measure this device" }));
      await waitFor(() => {
        expect(screen.getByTestId("coach-proximity-status").textContent).toContain(
          "older than ten minutes",
        );
      });
      expect(screen.queryByLabelText(/Why are you checking students in/u)).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Check In" }));
      await waitFor(() => {
        expect(scheduleClientMock.recordCheckIn).toHaveBeenCalledWith({
          sessionId: "session-town-1",
          studentId: "student-1",
          method: "manual",
        });
      });
    });

    it("records the check-in without a signal when the device cannot be measured", async () => {
      scheduleClientMock.getScheduleCatalog.mockResolvedValue(townCatalog());
      proximityMock.measureCheckInProximity.mockResolvedValue({
        status: "unavailable",
        reason: "The device did not share a position.",
      });
      await openRoster();

      fireEvent.click(screen.getByRole("button", { name: "Measure this device" }));
      await waitFor(() => {
        expect(screen.getByTestId("coach-proximity-status").textContent).toContain(
          "The device did not share a position. The check-in is recorded without a location signal.",
        );
      });

      fireEvent.click(screen.getByRole("button", { name: "Check In" }));
      await waitFor(() => {
        expect(scheduleClientMock.recordCheckIn).toHaveBeenCalledWith({
          sessionId: "session-town-1",
          studentId: "student-1",
          method: "manual",
        });
      });
    });
  });

  describe("upcoming birthdays (T112)", () => {
    it("asks for the birthdays of the selected site and lists them", async () => {
      birthdaysMock.listUpcomingBirthdays.mockResolvedValue([
        birthday({ studentId: "s-today", displayName: "Today Member", daysAway: 0 }),
        birthday({
          studentId: "s-minor",
          displayName: "Bruno Le Sueur",
          daysAway: 1,
          participantType: "minor",
        }),
      ]);
      render(<CoachDashboardPage />);

      await waitFor(() => {
        expect(birthdaysMock.listUpcomingBirthdays).toHaveBeenCalledWith({
          trainingCenter: "Town",
          windowDays: 7,
        });
      });
      expect(await screen.findByText("Today Member")).toBeInTheDocument();
      expect(screen.getByText("Bruno Le Sueur")).toBeInTheDocument();
      // T112 (2026-09-06): the badge now also says the age reached, never the year.
      expect(screen.getByText(/^Today · turns 30$/)).toBeInTheDocument();
      expect(screen.getByText(/^Tomorrow · turns 30$/)).toBeInTheDocument();
      expect(screen.getByText("2 this week")).toBeInTheDocument();
    });

    it("never prints an age or a date of birth", async () => {
      birthdaysMock.listUpcomingBirthdays.mockResolvedValue([
        birthday({ participantType: "minor" }),
      ]);
      render(<CoachDashboardPage />);

      const name = await screen.findByText("Ana Coelho");
      expect(screen.getByText("Minor · Town")).toBeInTheDocument();
      const widget = name.closest(".coach-card")?.textContent ?? "";
      expect(widget).not.toMatch(/\byrs?\b/u);
      expect(widget).not.toMatch(/\b(19|20)\d{2}\b/u);
    });

    it("follows the premises selector", async () => {
      render(<CoachDashboardPage />);
      await waitFor(() => {
        expect(birthdaysMock.listUpcomingBirthdays).toHaveBeenCalledWith({
          trainingCenter: "Town",
          windowDays: 7,
        });
      });

      fireEvent.click(screen.getByRole("radio", { name: "West (St Peter)" }));

      await waitFor(() => {
        expect(birthdaysMock.listUpcomingBirthdays).toHaveBeenCalledWith({
          trainingCenter: "West",
          windowDays: 7,
        });
      });
    });

    it("says so when nobody has a birthday this week", async () => {
      render(<CoachDashboardPage />);
      expect(await screen.findByText("No birthdays at Town this week.")).toBeInTheDocument();
    });

    it("shows a safe message when the birthdays cannot be loaded", async () => {
      birthdaysMock.listUpcomingBirthdays.mockRejectedValue(
        new Error("Unable to load upcoming birthdays. Please try again."),
      );
      render(<CoachDashboardPage />);
      expect(
        await screen.findByText("Unable to load upcoming birthdays. Please try again."),
      ).toBeInTheDocument();
    });
  });

  describe("pre-class view (T114)", () => {
    it("asks for the selected session and lists booked members and regulars", async () => {
      scheduleClientMock.getPreClassView.mockResolvedValue(
        preClassView([
          {
            studentId: "student-1",
            displayName: "Ana Coelho",
            source: "booked",
            status: "booked_not_arrived",
            attendedCount: 3,
            comparableSessionCount: 4,
            lastAttendedAt: "2026-08-28T18:05:00.000Z",
          },
          {
            studentId: "student-9",
            displayName: "Bruno Le Sueur",
            source: "regular",
            status: null,
            attendedCount: 4,
            comparableSessionCount: 4,
            lastAttendedAt: "2026-08-28T18:05:00.000Z",
          },
        ]),
      );
      render(<CoachDashboardPage />);

      await waitFor(() => {
        expect(scheduleClientMock.getPreClassView).toHaveBeenCalledWith("session-town-1");
      });
      expect(await screen.findByText("Ana Coelho")).toBeInTheDocument();
      expect(screen.getByText("Bruno Le Sueur")).toBeInTheDocument();
      expect(screen.getByText("Regular · 4 of the last 4")).toBeInTheDocument();
      expect(screen.getByText("2 expected")).toBeInTheDocument();
      expect(screen.getByText(/Nobody is checked in until you record it/u)).toBeInTheDocument();
    });

    it("says so when nobody is booked and nobody trains the class yet", async () => {
      render(<CoachDashboardPage />);
      expect(
        await screen.findByText("Nobody is booked and nobody trains this class regularly yet."),
      ).toBeInTheDocument();
    });

    it("explains that a closed class only lists the booked members", async () => {
      scheduleClientMock.getPreClassView.mockResolvedValue(preClassView([], { open: false }));
      render(<CoachDashboardPage />);
      expect(
        await screen.findByText("This class is closed, so only the booked members are listed."),
      ).toBeInTheDocument();
    });

    it("shows a safe message when the class cannot be prepared", async () => {
      scheduleClientMock.getPreClassView.mockRejectedValue(
        new Error("Unable to prepare this class. Please try again."),
      );
      render(<CoachDashboardPage />);
      expect(
        await screen.findByText("Unable to prepare this class. Please try again."),
      ).toBeInTheDocument();
    });
  });
});
