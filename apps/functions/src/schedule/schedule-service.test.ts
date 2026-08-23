import { describe, expect, it } from "vitest";

import { createInMemoryScheduleStore } from "./schedule-service";

describe("Schedule Service (In-Memory Store)", () => {
  it("returns default locations and programs when none seeded", async () => {
    const store = createInMemoryScheduleStore();
    const locations = await store.listLocations("academy-1");
    const programs = await store.listPrograms("academy-1");

    expect(locations).toHaveLength(2);
    expect(locations.map((l) => l.locationId)).toEqual(["town", "west"]);

    expect(programs.length).toBeGreaterThanOrEqual(6);
    expect(programs.some((p) => p.programId === "kids-bjj-4-7")).toBe(true);
    expect(programs.some((p) => p.programId === "adult-fundamentals")).toBe(true);
  });

  it("creates, reads, and updates recurring classes", async () => {
    const store = createInMemoryScheduleStore();

    const created = await store.createClass(
      "academy-1",
      {
        programId: "adult-fundamentals",
        locationId: "town",
        name: "Mon Adults Fundamentals",
        recurrenceRule: {
          dayOfWeek: 1,
          startTime: "18:30",
          durationMinutes: 60,
        },
        instructorIds: ["coach-1"],
        capacity: 25,
        minParticipants: 4,
      },
      "owner-1",
    );

    expect(created.classId).toBeDefined();
    expect(created.name).toBe("Mon Adults Fundamentals");

    const fetched = await store.getClass("academy-1", created.classId);
    expect(fetched).toEqual(created);

    const updated = await store.updateClass(
      "academy-1",
      {
        classId: created.classId,
        capacity: 30,
        name: "Mon Adults Fundamentals (Updated)",
      },
      "owner-1",
    );

    expect(updated.capacity).toBe(30);
    expect(updated.name).toBe("Mon Adults Fundamentals (Updated)");

    const all = await store.listClasses("academy-1");
    expect(all).toHaveLength(1);
    expect(all[0]?.capacity).toBe(30);
  });

  it("creates, queries, and cancels sessions", async () => {
    const store = createInMemoryScheduleStore();

    const session1 = await store.createSession(
      "academy-1",
      {
        classId: "class-1",
        programId: "adult-fundamentals",
        locationId: "town",
        instructorId: "coach-1",
        title: "Adult Fundamentals",
        startAt: "2026-09-01T18:30:00Z",
        endAt: "2026-09-01T19:30:00Z",
        capacity: 25,
      },
      "owner-1",
    );

    const session2 = await store.createSession(
      "academy-1",
      {
        classId: null,
        programId: "seminar",
        locationId: "west",
        instructorId: "coach-2",
        title: "Guest Master Seminar",
        startAt: "2026-09-05T10:00:00Z",
        endAt: "2026-09-05T13:00:00Z",
        capacity: 50,
        isSeminar: true,
      },
      "owner-1",
    );

    expect(session1.status).toBe("scheduled");
    expect(session2.isSeminar).toBe(true);

    const listAll = await store.listSessions("academy-1", {
      from: "2026-09-01T00:00:00Z",
      to: "2026-09-30T23:59:59Z",
    });
    expect(listAll).toHaveLength(2);

    const listTown = await store.listSessions("academy-1", {
      from: "2026-09-01T00:00:00Z",
      to: "2026-09-30T23:59:59Z",
      locationId: "town",
    });
    expect(listTown).toHaveLength(1);
    expect(listTown[0]?.sessionId).toBe(session1.sessionId);

    const cancelled = await store.cancelSession(
      "academy-1",
      session1.sessionId,
      "Coach unavailable",
      "owner-1",
    );
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancellationReason).toBe("Coach unavailable");
  });

  it("enforces tenant boundary between academies", async () => {
    const store = createInMemoryScheduleStore();

    await store.createClass(
      "academy-1",
      {
        programId: "adult-fundamentals",
        locationId: "town",
        name: "Class A1",
        recurrenceRule: { dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 },
        instructorIds: ["coach-1"],
        capacity: 20,
      },
      "owner-1",
    );

    const classesA2 = await store.listClasses("academy-2");
    expect(classesA2).toHaveLength(0);

    const sessionsA2 = await store.listSessions("academy-2", {
      from: "2026-09-01T00:00:00Z",
      to: "2026-09-30T23:59:59Z",
    });
    expect(sessionsA2).toHaveLength(0);
  });

  it("creates, reads, and updates programs", async () => {
    const store = createInMemoryScheduleStore();

    const created = await store.createProgram("academy-1", {
      name: "Judo for BJJ",
      ageBand: "adult",
      discipline: "bjj",
      level: "all-levels",
    });

    expect(created.programId).toBeDefined();
    expect(created.name).toBe("Judo for BJJ");
    expect(created.active).toBe(true);

    const programs = await store.listPrograms("academy-1");
    expect(programs.some((p) => p.programId === created.programId)).toBe(true);

    const updated = await store.updateProgram("academy-1", created.programId, {
      name: "Judo for BJJ (Intermediate)",
      level: "advanced",
    });

    expect(updated.name).toBe("Judo for BJJ (Intermediate)");
    expect(updated.level).toBe("advanced");
  });

  it("generates sessions from class idempotently without duplicating", async () => {
    const store = createInMemoryScheduleStore();

    const cls = await store.createClass(
      "academy-1",
      {
        programId: "adult-fundamentals",
        locationId: "town",
        name: "Tuesday Night BJJ",
        recurrenceRule: {
          dayOfWeek: 2, // Tuesday
          startTime: "19:00",
          durationMinutes: 60,
        },
        instructorIds: ["coach-1"],
        capacity: 25,
        minParticipants: 4,
      },
      "owner-1",
    );

    // Generate for September 2026 (5 Tuesdays: 1, 8, 15, 22, 29)
    const generated = await store.generateSessions(
      "academy-1",
      cls.classId,
      "2026-09-01",
      "2026-09-30",
      "Europe/Jersey",
      "owner-1",
    );

    expect(generated).toHaveLength(5);
    expect(generated[0]?.status).toBe("scheduled");
    expect(generated[0]?.title).toBe("Tuesday Night BJJ");

    // Re-running generation for the same range must be idempotent (not create duplicates)
    const reGenerated = await store.generateSessions(
      "academy-1",
      cls.classId,
      "2026-09-01",
      "2026-09-30",
      "Europe/Jersey",
      "owner-1",
    );

    expect(reGenerated).toHaveLength(5);

    const allSessions = await store.listSessions("academy-1", {
      from: "2026-09-01T00:00:00Z",
      to: "2026-09-30T23:59:59Z",
    });
    expect(allSessions).toHaveLength(5);
  });

  describe("Bookings & Roster Management", () => {
    it("requests booking and enforces deterministic ID and capacity limit", async () => {
      const store = createInMemoryScheduleStore();

      // Create session with capacity 2
      const session = await store.createSession(
        "academy-1",
        {
          programId: "adult-fundamentals",
          locationId: "town",
          instructorId: "coach-1",
          title: "Intimate Seminar",
          startAt: "2099-09-01T18:00:00Z",
          endAt: "2099-09-01T19:00:00Z",
          capacity: 2,
          minParticipants: 2,
        },
        "owner-1",
      );

      // First student books
      const booking1 = await store.requestBooking(
        "academy-1",
        {
          sessionId: session.sessionId,
          studentId: "student-1",
          membershipId: "mem-1",
        },
        "student-1",
      );

      expect(booking1.bookingId).toBe(`${session.sessionId}__student-1`);
      expect(booking1.status).toBe("confirmed");

      // Idempotent retry by student 1
      const retry1 = await store.requestBooking(
        "academy-1",
        {
          sessionId: session.sessionId,
          studentId: "student-1",
          membershipId: "mem-1",
        },
        "student-1",
      );
      expect(retry1.bookingId).toBe(booking1.bookingId);

      // Second student books (capacity = 2/2)
      const booking2 = await store.requestBooking(
        "academy-1",
        {
          sessionId: session.sessionId,
          studentId: "student-2",
          membershipId: "mem-2",
        },
        "student-2",
      );
      expect(booking2.status).toBe("confirmed");

      // Third student tries to book -> rejected due to capacity limit
      await expect(
        store.requestBooking(
          "academy-1",
          {
            sessionId: session.sessionId,
            studentId: "student-3",
            membershipId: "mem-3",
          },
          "student-3",
        ),
      ).rejects.toThrow(/capacity reached/i);

      // Check roster
      const roster = await store.listSessionBookings("academy-1", session.sessionId);
      expect(roster).toHaveLength(2);
    });

    it("cancels booking with 1-hour cutoff check for student and override for staff", async () => {
      const store = createInMemoryScheduleStore();

      // Session in 30 minutes (within 1-hour cutoff)
      const in30Min = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const in90Min = new Date(Date.now() + 90 * 60 * 1000).toISOString();

      const urgentSession = await store.createSession(
        "academy-1",
        {
          programId: "adult-fundamentals",
          locationId: "town",
          instructorId: "coach-1",
          title: "Starting Soon",
          startAt: in30Min,
          endAt: in90Min,
          capacity: 10,
        },
        "owner-1",
      );

      // Book session
      await store.requestBooking(
        "academy-1",
        {
          sessionId: urgentSession.sessionId,
          studentId: "student-1",
          membershipId: "mem-1",
        },
        "student-1",
      );

      // Student tries to cancel within 1-hour cutoff -> rejected
      await expect(
        store.cancelBooking(
          "academy-1",
          {
            sessionId: urgentSession.sessionId,
            studentId: "student-1",
            reason: "Can't make it",
          },
          "student-1",
          false, // not staff override
        ),
      ).rejects.toThrow(/1 hour/i);

      // Staff overrides cancellation -> allowed
      const staffCancelled = await store.cancelBooking(
        "academy-1",
        {
          sessionId: urgentSession.sessionId,
          studentId: "student-1",
          reason: "Emergency exception",
        },
        "coach-1",
        true, // staff override
      );

      expect(staffCancelled.status).toBe("cancelled");
      expect(staffCancelled.cancellationReason).toBe("Emergency exception");
    });

    it("evaluates session minimum quorum (4 participants default)", async () => {
      const store = createInMemoryScheduleStore();

      const session = await store.createSession(
        "academy-1",
        {
          programId: "adult-fundamentals",
          locationId: "town",
          instructorId: "coach-1",
          title: "Morning Class",
          startAt: "2099-09-01T10:00:00Z",
          endAt: "2099-09-01T11:00:00Z",
          capacity: 20,
          minParticipants: 4,
        },
        "owner-1",
      );

      // 0 bookings -> quorum not met
      const quorum0 = await store.evaluateSessionMinimum("academy-1", session.sessionId);
      expect(quorum0.quorumMet).toBe(false);
      expect(quorum0.confirmedCount).toBe(0);

      // 4 bookings -> quorum met
      for (let i = 1; i <= 4; i++) {
        await store.requestBooking(
          "academy-1",
          {
            sessionId: session.sessionId,
            studentId: `student-${i}`,
            membershipId: `mem-${i}`,
          },
          `student-${i}`,
        );
      }

      const quorum4 = await store.evaluateSessionMinimum("academy-1", session.sessionId);
      expect(quorum4.quorumMet).toBe(true);
      expect(quorum4.confirmedCount).toBe(4);
    });
  });

  describe("Attendance & Check-In Management", () => {
    it("records check-in via 4 methods with automatic punctuality and idempotency", async () => {
      const store = createInMemoryScheduleStore();

      const session = await store.createSession(
        "academy-1",
        {
          programId: "adult-fundamentals",
          locationId: "town",
          instructorId: "coach-1",
          title: "Evening Class",
          startAt: "2026-09-01T18:00:00Z",
          endAt: "2026-09-01T19:00:00Z",
          capacity: 30,
        },
        "owner-1",
      );

      // Student 1: on-time QR check-in (17:55)
      const checkIn1 = await store.recordCheckIn(
        "academy-1",
        {
          sessionId: session.sessionId,
          studentId: "student-1",
          method: "qr",
        },
        "student-1",
        "2026-09-01T17:55:00Z",
      );

      expect(checkIn1.attendanceId).toBe(`${session.sessionId}__student-1`);
      expect(checkIn1.state).toBe("attended");
      expect(checkIn1.method).toBe("qr");

      // Idempotent check-in retry returns existing record
      const retry1 = await store.recordCheckIn(
        "academy-1",
        {
          sessionId: session.sessionId,
          studentId: "student-1",
          method: "qr",
        },
        "student-1",
        "2026-09-01T17:56:00Z",
      );
      expect(retry1.attendanceId).toBe(checkIn1.attendanceId);
      expect(retry1.occurredAt).toBe("2026-09-01T17:55:00Z");

      // Student 2: late PIN check-in (18:20 -> 20 min after start)
      const checkIn2 = await store.recordCheckIn(
        "academy-1",
        {
          sessionId: session.sessionId,
          studentId: "student-2",
          method: "pin",
          pin: "4321",
        },
        "student-2",
        "2026-09-01T18:20:00Z",
      );
      expect(checkIn2.state).toBe("late");
      expect(checkIn2.method).toBe("pin");

      // Student 3: Name Search check-in by front desk (18:05 -> on-time)
      const checkIn3 = await store.recordCheckIn(
        "academy-1",
        {
          sessionId: session.sessionId,
          studentId: "student-3",
          method: "nameSearch",
        },
        "staff-1",
        "2026-09-01T18:05:00Z",
      );
      expect(checkIn3.state).toBe("attended");
      expect(checkIn3.method).toBe("nameSearch");

      // Student 4: Manual check-in by coach (18:10 -> on-time with notes)
      const checkIn4 = await store.recordCheckIn(
        "academy-1",
        {
          sessionId: session.sessionId,
          studentId: "student-4",
          method: "manual",
          notes: "Walk-in approved",
        },
        "coach-1",
        "2026-09-01T18:10:00Z",
      );
      expect(checkIn4.state).toBe("attended");
      expect(checkIn4.method).toBe("manual");
      expect(checkIn4.notes).toBe("Walk-in approved");

      // Verify listSessionAttendance
      const sessionAttendance = await store.listSessionAttendance("academy-1", session.sessionId);
      expect(sessionAttendance).toHaveLength(4);

      // Verify listStudentAttendance
      const studentHistory = await store.listStudentAttendance("academy-1", "student-1");
      expect(studentHistory).toHaveLength(1);
    });
  });
});
