import { describe, expect, it, vi } from "vitest";

import {
  cancelBooking,
  cancelSession,
  evaluateSessionMinimum,
  generateSessions,
  getScheduleCatalog,
  listClasses,
  listSessionBookings,
  listSessions,
  listStudentBookings,
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
});


