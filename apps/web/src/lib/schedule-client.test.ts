import { describe, expect, it, vi } from "vitest";

import {
  cancelBooking,
  cancelSession,
  correctAttendance,
  evaluateSessionMinimum,
  generateSessions,
  getScheduleCatalog,
  getStudentCheckout,
  listAttendanceHistory,
  listClasses,
  listSessionAttendance,
  listSessionBookings,
  listSessionCheckouts,
  listSessions,
  listStudentAttendance,
  listStudentBookings,
  reconcileSessionNoShows,
  recordCheckIn,
  recordCheckout,
  requestBooking,
  saveClass,
  saveProgram,
  saveSession,
} from "./schedule-client";

const mockCallable = vi.fn();

vi.mock("firebase/functions", () => ({
  httpsCallable: () => mockCallable,
}));

vi.mock("./firebase-client", () => ({
  getFirebaseFunctions: () => ({}),
}));

describe("Schedule Client", () => {
  it("fetches schedule catalog", async () => {
    mockCallable.mockResolvedValueOnce({
      data: {
        locations: [{ locationId: "town", name: "BPT Town" }],
        programs: [{ programId: "adult-bjj", name: "Adults BJJ" }],
      },
    });

    const catalog = await getScheduleCatalog();
    expect(catalog.locations).toHaveLength(1);
    expect(catalog.programs).toHaveLength(1);
  });

  it("lists classes", async () => {
    mockCallable.mockResolvedValueOnce({
      data: {
        classes: [{ classId: "c-1", name: "Adult Fundamentals" }],
      },
    });

    const classes = await listClasses();
    expect(classes).toHaveLength(1);
    expect(classes[0]?.name).toBe("Adult Fundamentals");
  });

  it("lists sessions with query", async () => {
    mockCallable.mockResolvedValueOnce({
      data: {
        sessions: [{ sessionId: "s-1", title: "Adult Session" }],
      },
    });

    const sessions = await listSessions({
      from: "2026-09-01T00:00:00Z",
      to: "2026-09-07T23:59:59Z",
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.title).toBe("Adult Session");
  });

  it("saves class and session", async () => {
    mockCallable.mockResolvedValueOnce({
      data: { class: { classId: "c-1", name: "New Class" } },
    });
    const cls = await saveClass({
      programId: "adult-bjj",
      locationId: "town",
      name: "New Class",
      recurrenceRule: { dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 },
      instructorIds: ["coach-1"],
      capacity: 20,
    });
    expect(cls.classId).toBe("c-1");

    mockCallable.mockResolvedValueOnce({
      data: { session: { sessionId: "s-1", title: "New Session" } },
    });
    const sess = await saveSession({
      programId: "adult-bjj",
      locationId: "town",
      instructorId: "coach-1",
      title: "New Session",
      startAt: "2026-09-01T18:00:00Z",
      endAt: "2026-09-01T19:00:00Z",
      capacity: 20,
    });
    expect(sess.sessionId).toBe("s-1");
  });

  it("cancels session", async () => {
    mockCallable.mockResolvedValueOnce({
      data: { session: { sessionId: "s-1", status: "cancelled" } },
    });
    const cancelled = await cancelSession("s-1", "Instructor unavailable");
    expect(cancelled.status).toBe("cancelled");
  });

  it("saves program", async () => {
    mockCallable.mockResolvedValueOnce({
      data: { program: { programId: "p-1", name: "Judo BJJ" } },
    });

    const prog = await saveProgram({
      name: "Judo BJJ",
      ageBand: "adult",
      discipline: "bjj",
      level: "all-levels",
    });

    expect(prog.programId).toBe("p-1");
    expect(prog.name).toBe("Judo BJJ");
  });

  it("generates sessions batch", async () => {
    mockCallable.mockResolvedValueOnce({
      data: { sessions: [{ sessionId: "s-1" }, { sessionId: "s-2" }] },
    });

    const sessions = await generateSessions({
      classId: "c-1",
      fromDate: "2026-09-01",
      toDate: "2026-09-30",
    });

    expect(sessions).toHaveLength(2);
  });

  it("manages bookings and evaluations", async () => {
    // Request booking
    mockCallable.mockResolvedValueOnce({
      data: { booking: { bookingId: "s-1__std-1", status: "confirmed" } },
    });
    const booking = await requestBooking({
      sessionId: "s-1",
      studentId: "std-1",
      membershipId: "m-1",
    });
    expect(booking.bookingId).toBe("s-1__std-1");
    expect(booking.status).toBe("confirmed");

    // Cancel booking
    mockCallable.mockResolvedValueOnce({
      data: { booking: { bookingId: "s-1__std-1", status: "cancelled" } },
    });
    const cancelled = await cancelBooking({
      sessionId: "s-1",
      studentId: "std-1",
      reason: "Sick",
    });
    expect(cancelled.status).toBe("cancelled");

    // List session bookings
    mockCallable.mockResolvedValueOnce({
      data: { bookings: [{ bookingId: "s-1__std-1" }] },
    });
    const roster = await listSessionBookings("s-1");
    expect(roster).toHaveLength(1);

    // List student bookings
    mockCallable.mockResolvedValueOnce({
      data: { bookings: [{ bookingId: "s-1__std-1" }] },
    });
    const studentBookings = await listStudentBookings("std-1");
    expect(studentBookings).toHaveLength(1);

    // Evaluate session minimum
    mockCallable.mockResolvedValueOnce({
      data: { result: { confirmedCount: 5, minParticipants: 4, quorumMet: true } },
    });
    const quorum = await evaluateSessionMinimum("s-1");
    expect(quorum.quorumMet).toBe(true);
    expect(quorum.confirmedCount).toBe(5);
  });

  it("records check-in and lists attendance", async () => {
    // Record check-in
    mockCallable.mockResolvedValueOnce({
      data: {
        attendance: {
          attendanceId: "s-1__std-1",
          method: "qr",
          state: "attended",
        },
      },
    });
    const att = await recordCheckIn({
      sessionId: "s-1",
      studentId: "std-1",
      method: "qr",
    });
    expect(att.attendanceId).toBe("s-1__std-1");
    expect(att.state).toBe("attended");

    // List session attendance
    mockCallable.mockResolvedValueOnce({
      data: {
        attendance: [
          { attendanceId: "s-1__std-1", state: "attended" },
          { attendanceId: "s-1__std-2", state: "late" },
        ],
      },
    });
    const sAtt = await listSessionAttendance("s-1");
    expect(sAtt).toHaveLength(2);

    // List student attendance
    mockCallable.mockResolvedValueOnce({
      data: {
        attendance: [{ attendanceId: "s-1__std-1", state: "attended" }],
      },
    });
    const myAtt = await listStudentAttendance("std-1");
    expect(myAtt).toHaveLength(1);

    // Correct attendance
    mockCallable.mockResolvedValueOnce({
      data: {
        correction: { attendanceId: "corr_123", state: "attended" },
        canonical: { attendanceId: "s-1__std-1", state: "attended" },
      },
    });
    const corrected = await correctAttendance({
      sessionId: "s-1",
      studentId: "std-1",
      newState: "attended",
      reason: "Corrected by coach",
    });
    expect(corrected.canonical.state).toBe("attended");
    expect(corrected.correction.attendanceId).toBe("corr_123");

    // Reconcile no-shows
    mockCallable.mockResolvedValueOnce({
      data: {
        noShowsMarked: 2,
        records: [
          { attendanceId: "s-1__std-2", state: "no_show" },
          { attendanceId: "s-1__std-3", state: "no_show" },
        ],
      },
    });
    const noShows = await reconcileSessionNoShows("s-1");
    expect(noShows.noShowsMarked).toBe(2);

    // List attendance history
    mockCallable.mockResolvedValueOnce({
      data: {
        history: [
          { attendanceId: "s-1__std-1", state: "late" },
          { attendanceId: "corr_123", state: "attended" },
        ],
      },
    });
    const history = await listAttendanceHistory("s-1", "std-1");
    expect(history).toHaveLength(2);
  });

  it("records child check-out and lists session checkouts", async () => {
    // Record checkout
    mockCallable.mockResolvedValueOnce({
      data: {
        checkout: {
          checkoutId: "s-1__minor-1",
          method: "authorizedAdult",
          authorizedAdultName: "Maria Silva",
        },
      },
    });
    const co = await recordCheckout({
      sessionId: "s-1",
      studentId: "minor-1",
      method: "authorizedAdult",
      authorizedAdultId: "adult-1",
      authorizedAdultName: "Maria Silva",
    });
    expect(co.checkoutId).toBe("s-1__minor-1");
    expect(co.method).toBe("authorizedAdult");

    // List session checkouts
    mockCallable.mockResolvedValueOnce({
      data: {
        checkouts: [{ checkoutId: "s-1__minor-1" }, { checkoutId: "s-1__minor-2" }],
      },
    });
    const checkouts = await listSessionCheckouts("s-1");
    expect(checkouts).toHaveLength(2);

    // Get student checkout
    mockCallable.mockResolvedValueOnce({
      data: {
        checkout: { checkoutId: "s-1__minor-1" },
      },
    });
    const studentCo = await getStudentCheckout("s-1", "minor-1");
    expect(studentCo?.checkoutId).toBe("s-1__minor-1");
  });
});





