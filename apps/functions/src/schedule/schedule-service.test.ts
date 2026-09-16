import { describe, expect, it } from "vitest";
import { buildBookingId } from "@bpt-jersey/domain/schedule";
import { shiftIso } from "@bpt-jersey/domain/schedule/classes-services";

import { createFirestoreScheduleStore, createInMemoryScheduleStore } from "./schedule-service";

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
        recurrenceRules: [
          {
            dayOfWeek: 1,
            startTime: "18:30",
            durationMinutes: 60,
          },
        ],
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
        recurrenceRules: [{ dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 }],
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
        recurrenceRules: [
          {
            dayOfWeek: 2, // Tuesday
            startTime: "19:00",
            durationMinutes: 60,
          },
        ],
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

      expect(booking1.bookingId).toBe(buildBookingId(session.sessionId, "student-1"));
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

    it("never reports capacity for an unlimited session", async () => {
      const store = createInMemoryScheduleStore();

      const session = await store.createSession(
        "academy-1",
        {
          programId: "adult-fundamentals",
          locationId: "town",
          instructorId: "coach-1",
          title: "Open Mat",
          startAt: "2099-09-01T18:00:00Z",
          endAt: "2099-09-01T19:00:00Z",
          capacity: null,
          minParticipants: 0,
        },
        "owner-1",
      );
      expect(session.capacity).toBeNull();

      for (let index = 1; index <= 400; index += 1) {
        const booking = await store.requestBooking(
          "academy-1",
          {
            sessionId: session.sessionId,
            studentId: `student-${index}`,
            membershipId: `mem-${index}`,
          },
          `student-${index}`,
        );
        expect(booking.status).toBe("confirmed");
      }

      const overflow = await store.requestBooking(
        "academy-1",
        { sessionId: session.sessionId, studentId: "student-401", membershipId: "mem-401" },
        "student-401",
      );
      expect(overflow.status).toBe("confirmed");
      expect(await store.listSessionBookings("academy-1", session.sessionId)).toHaveLength(401);
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
      await expect(
        store.cancelBooking(
          "academy-1",
          {
            sessionId: urgentSession.sessionId,
            studentId: "student-1",
            reason: "Must remain idempotent",
          },
          "owner-1",
          true,
        ),
      ).resolves.toEqual(staffCancelled);
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

      // Student 3: Name Search check-in by front desk (18:05 -> five minutes late)
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
      expect(checkIn3.state).toBe("late");
      expect(checkIn3.method).toBe("nameSearch");

      // Student 4: Manual check-in by coach (18:10 -> late, with notes)
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
      expect(checkIn4.state).toBe("late");
      expect(checkIn4.method).toBe("manual");
      expect(checkIn4.notes).toBe("Walk-in approved");

      // Verify listSessionAttendance
      const sessionAttendance = await store.listSessionAttendance("academy-1", session.sessionId);
      expect(sessionAttendance).toHaveLength(4);

      // Verify listStudentAttendance
      const studentHistory = await store.listStudentAttendance("academy-1", "student-1");
      expect(studentHistory).toHaveLength(1);
    });

    it("applies audited attendance correction preserving original canonical record and history", async () => {
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

      // Initial check-in (marked late)
      const initial = await store.recordCheckIn(
        "academy-1",
        {
          sessionId: session.sessionId,
          studentId: "student-1",
          method: "pin",
        },
        "student-1",
        "2026-09-01T18:25:00Z",
      );
      expect(initial.state).toBe("late");

      // Coach submits correction to 'attended'
      const { correction, canonical } = await store.correctAttendance(
        "academy-1",
        {
          sessionId: session.sessionId,
          studentId: "student-1",
          newState: "attended",
          reason: "Kiosk queue delay at front entrance",
        },
        "coach-1",
        "2026-09-01T18:30:00Z",
      );

      expect(correction.attendanceId).toMatch(/^corr_/);
      expect(correction.correctionOf).toBe(`${session.sessionId}__student-1`);
      expect(correction.state).toBe("attended");
      expect(correction.notes).toBe("Kiosk queue delay at front entrance");

      // Canonical state updated to attended
      expect(canonical.state).toBe("attended");
      expect(canonical.attendanceId).toBe(`${session.sessionId}__student-1`);

      // Verify history contains both canonical and correction
      const history = await store.listAttendanceHistory(
        "academy-1",
        session.sessionId,
        "student-1",
      );
      expect(history).toHaveLength(2);
      expect(history[0]!.attendanceId).toBe(`${session.sessionId}__student-1`);
      expect(history[1]!.correctionOf).toBe(`${session.sessionId}__student-1`);
    });

    it("reconciles no-shows for confirmed bookings without check-in after session ends", async () => {
      const store = createInMemoryScheduleStore();

      const session = await store.createSession(
        "academy-1",
        {
          programId: "adult-fundamentals",
          locationId: "town",
          instructorId: "coach-1",
          title: "Morning Class",
          startAt: "2026-09-01T08:00:00Z",
          endAt: "2026-09-01T09:00:00Z",
          capacity: 20,
        },
        "owner-1",
      );

      // Student 1 books and checks in
      await store.requestBooking(
        "academy-1",
        { sessionId: session.sessionId, studentId: "student-1", membershipId: "mem-1" },
        "student-1",
      );
      await store.recordCheckIn(
        "academy-1",
        { sessionId: session.sessionId, studentId: "student-1", method: "qr" },
        "student-1",
        "2026-09-01T07:55:00Z",
      );

      // Student 2 books but never checks in
      await store.requestBooking(
        "academy-1",
        { sessionId: session.sessionId, studentId: "student-2", membershipId: "mem-2" },
        "student-2",
      );

      // Student 3 books and cancels
      await store.requestBooking(
        "academy-1",
        { sessionId: session.sessionId, studentId: "student-3", membershipId: "mem-3" },
        "student-3",
      );
      await store.cancelBooking(
        "academy-1",
        { sessionId: session.sessionId, studentId: "student-3", reason: "Injury" },
        "student-3",
        true,
      );

      // Reconcile no-shows
      const result = await store.reconcileSessionNoShows("academy-1", session.sessionId, "admin-1");

      expect(result.noShowsMarked).toBe(1);
      expect(result.records).toHaveLength(1);
      expect(result.records[0]!.studentId).toBe("student-2");
      expect(result.records[0]!.state).toBe("no_show");
      expect(result.records[0]!.attendanceId).toBe(`${session.sessionId}__student-2`);

      // Idempotent re-run marks 0 additional no-shows
      const rerun = await store.reconcileSessionNoShows("academy-1", session.sessionId, "admin-1");
      expect(rerun.noShowsMarked).toBe(0);
    });
  });

  describe("Child Check-Out & Release Management", () => {
    it("handles child check-out via authorizedAdult, independentRelease, and staffOverride with attendance validation", async () => {
      const store = createInMemoryScheduleStore();

      const session = await store.createSession(
        "academy-1",
        {
          programId: "kids-gi",
          locationId: "town",
          instructorId: "coach-1",
          title: "Kids Gi Fundamentals",
          startAt: "2026-09-01T16:00:00Z",
          endAt: "2026-09-01T17:00:00Z",
          capacity: 20,
        },
        "owner-1",
      );

      // Student 1 checks in
      await store.recordCheckIn(
        "academy-1",
        { sessionId: session.sessionId, studentId: "minor-1", method: "pin" },
        "minor-1",
        "2026-09-01T15:55:00Z",
      );

      // Student 2 checks in
      await store.recordCheckIn(
        "academy-1",
        { sessionId: session.sessionId, studentId: "minor-2", method: "qr" },
        "minor-2",
        "2026-09-01T16:05:00Z",
      );

      // Student 3 did NOT attend
      await expect(
        store.recordCheckout(
          "academy-1",
          {
            sessionId: session.sessionId,
            studentId: "minor-3",
            method: "independentRelease",
          },
          "staff-1",
        ),
      ).rejects.toThrow(/did not attend this session/);

      // Minor 1: Authorized Adult Check-out
      const co1 = await store.recordCheckout(
        "academy-1",
        {
          sessionId: session.sessionId,
          studentId: "minor-1",
          method: "authorizedAdult",
          authorizedAdultId: "adult-mother-1",
          authorizedAdultName: "Maria Silva",
        },
        "adult-mother-1",
        "2026-09-01T17:05:00Z",
      );
      expect(co1.checkoutId).toBe(`${session.sessionId}__minor-1`);
      expect(co1.method).toBe("authorizedAdult");
      expect(co1.authorizedAdultName).toBe("Maria Silva");

      // Idempotent retry returns existing checkout
      const retryCo1 = await store.recordCheckout(
        "academy-1",
        {
          sessionId: session.sessionId,
          studentId: "minor-1",
          method: "authorizedAdult",
        },
        "adult-mother-1",
      );
      expect(retryCo1.checkoutId).toBe(co1.checkoutId);

      // Minor 2: Staff Override Check-out
      const co2 = await store.recordCheckout(
        "academy-1",
        {
          sessionId: session.sessionId,
          studentId: "minor-2",
          method: "staffOverride",
          notes: "Collected by uncle John verified via parent SMS",
        },
        "coach-1",
        "2026-09-01T17:10:00Z",
      );
      expect(co2.method).toBe("staffOverride");
      expect(co2.notes).toBe("Collected by uncle John verified via parent SMS");

      // List session checkouts
      const checkouts = await store.listSessionCheckouts("academy-1", session.sessionId);
      expect(checkouts).toHaveLength(2);

      // Get single student checkout
      const single = await store.getStudentCheckout("academy-1", session.sessionId, "minor-1");
      expect(single?.checkoutId).toBe(`${session.sessionId}__minor-1`);

      const missing = await store.getStudentCheckout("academy-1", session.sessionId, "minor-99");
      expect(missing).toBeNull();
    });
  });

  describe("Live Session Operational View Projection", () => {
    it("retrieves unified live session operational view without duplicating canonical data", async () => {
      const store = createInMemoryScheduleStore();

      const session = await store.createSession(
        "academy-1",
        {
          programId: "adult-bjj",
          locationId: "town",
          instructorId: "coach-1",
          title: "Adult Advanced BJJ",
          startAt: "2026-09-01T19:00:00Z",
          endAt: "2026-09-01T20:30:00Z",
          capacity: 15,
          minParticipants: 4,
        },
        "owner-1",
      );

      // Student 1 books and checks in early
      await store.requestBooking(
        "academy-1",
        { sessionId: session.sessionId, studentId: "std-1", membershipId: "m-1" },
        "std-1",
      );
      await store.recordCheckIn(
        "academy-1",
        { sessionId: session.sessionId, studentId: "std-1", method: "qr" },
        "std-1",
        "2026-09-01T18:50:00Z",
      );

      // Student 2 books, checks in late, and checks out
      await store.requestBooking(
        "academy-1",
        { sessionId: session.sessionId, studentId: "std-2", membershipId: "m-2" },
        "std-2",
      );
      await store.recordCheckIn(
        "academy-1",
        { sessionId: session.sessionId, studentId: "std-2", method: "nameSearch" },
        "std-2",
        "2026-09-01T19:20:00Z",
      );
      await store.recordCheckout(
        "academy-1",
        { sessionId: session.sessionId, studentId: "std-2", method: "independentRelease" },
        "std-2",
        "2026-09-01T20:35:00Z",
      );

      // Student 3 books and remains pending
      await store.requestBooking(
        "academy-1",
        { sessionId: session.sessionId, studentId: "std-3", membershipId: "m-3" },
        "std-3",
      );

      // Fetch live operational view
      const view = await store.getSessionOperationalView("academy-1", session.sessionId);

      expect(view.session.sessionId).toBe(session.sessionId);
      expect(view.summary.totalBookings).toBe(3);
      expect(view.summary.totalCheckedIn).toBe(2);
      expect(view.summary.totalCheckedOut).toBe(1);
      expect(view.summary.totalPendingArrival).toBe(1);
      expect(view.summary.quorumMet).toBe(false); // 3 confirmed < 4 minParticipants

      expect(view.roster).toHaveLength(3);
      const student1 = view.roster.find((r) => r.studentId === "std-1");
      expect(student1?.computedStatus).toBe("attended");

      const student2 = view.roster.find((r) => r.studentId === "std-2");
      expect(student2?.computedStatus).toBe("checked_out");

      const student3 = view.roster.find((r) => r.studentId === "std-3");
      expect(student3?.computedStatus).toBe("booked_not_arrived");
    });
  });
});

describe("Schedule Service (Firestore store) locations", () => {
  it("keeps every canonical site when only one has recorded coordinates (T109)", async () => {
    // Nothing seeds academies/{id}/locations; saveLocationGeofence writes the first document. The
    // catalog must still list both sites, with the stored one overriding its default.
    const townGeofence = { latitude: 49.186, longitude: -2.106 };
    const firestore = {
      collection: (path: string) => ({
        doc: () => {
          throw new Error(`unexpected doc() on ${path}`);
        },
        get: async () => ({
          docs:
            path === "academies/academy-1/locations"
              ? [
                  {
                    id: "town",
                    data: () => ({
                      locationId: "town",
                      academyId: "academy-1",
                      name: "BPT Town",
                      address: "St Helier, Jersey",
                      timezone: "Europe/Jersey",
                      active: true,
                      geofence: townGeofence,
                      schemaVersion: "1",
                    }),
                  },
                ]
              : [],
        }),
        where: () => {
          throw new Error(`unexpected where() on ${path}`);
        },
      }),
    };
    const store = createFirestoreScheduleStore({ firestore: firestore as never });

    const locations = await store.listLocations("academy-1");

    expect(locations.map((location) => location.locationId)).toEqual(["town", "west"]);
    expect(locations[0]?.geofence).toEqual(townGeofence);
    expect(locations[1]).toMatchObject({ locationId: "west", academyId: "academy-1" });
    expect(locations[1]?.geofence).toBeUndefined();
  });
});

describe("schedule store: v2 classes, session edits, class removal and booked counts", () => {
  const academyId = "demo-academy";
  const classInput = {
    programId: "program-1",
    locationId: "town" as const,
    name: "Kids BJJ",
    recurrenceRules: [
      { dayOfWeek: 1 as const, startTime: "17:00", durationMinutes: 60 },
      { dayOfWeek: 3 as const, startTime: "17:00", durationMinutes: 60 },
    ],
    instructorIds: ["coach-a"],
    capacity: 20,
    minParticipants: 4,
    description: "Bring a gi.",
    ageRange: { minAge: 8, maxAge: 11 },
    levelRange: null,
  };

  it("creates a v2 class and generates a session per rule", async () => {
    const store = createInMemoryScheduleStore();
    const created = await store.createClass(academyId, classInput, "owner-1");
    expect(created.schemaVersion).toBe("2");
    expect(created.recurrenceRules).toHaveLength(2);
    const sessions = await store.generateSessions(
      academyId,
      created.classId,
      "2026-09-14",
      "2026-09-20",
      "Europe/Jersey",
      "owner-1",
    );
    expect(sessions.map((s) => s.sessionId)).toEqual([
      `${created.classId}__2026-09-14__1700`,
      `${created.classId}__2026-09-16__1700`,
    ]);
    expect(sessions[0]?.description).toBe("Bring a gi.");
  });

  it("does not duplicate a session a v1 class already generated under the legacy id", async () => {
    const store = createInMemoryScheduleStore();
    const created = await store.createClass(academyId, classInput, "owner-1");
    await store.createSession(
      academyId,
      {
        programId: "program-1",
        locationId: "town",
        instructorId: "coach-a",
        title: "Kids BJJ",
        startAt: "2026-09-14T16:00:00Z",
        endAt: "2026-09-14T17:00:00Z",
        capacity: 20,
        classId: created.classId,
      },
      "owner-1",
    );
    // Plant the legacy id the way a v1 generation would have.
    const legacy = (
      await store.listSessions(academyId, {
        from: "2026-09-14T00:00:00.000Z",
        to: "2026-09-14T23:59:59.999Z",
      })
    )[0]!;
    await store.__seedSessionId?.(academyId, legacy, `${created.classId}__2026-09-14`);
    const sessions = await store.generateSessions(
      academyId,
      created.classId,
      "2026-09-14",
      "2026-09-14",
      "Europe/Jersey",
      "owner-1",
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe(`${created.classId}__2026-09-14`);
  });

  it("generates the second rule's session when two rules share a legacy session's weekday", async () => {
    const store = createInMemoryScheduleStore();
    const created = await store.createClass(
      academyId,
      {
        ...classInput,
        recurrenceRules: [{ dayOfWeek: 1 as const, startTime: "17:00", durationMinutes: 60 }],
      },
      "owner-1",
    );
    await store.createSession(
      academyId,
      {
        programId: "program-1",
        locationId: "town",
        instructorId: "coach-a",
        title: "Kids BJJ",
        startAt: "2099-01-05T16:00:00Z",
        endAt: "2099-01-05T17:00:00Z",
        capacity: 20,
        classId: created.classId,
      },
      "owner-1",
    );
    // Plant the legacy id the way a v1 generation would have.
    const legacy = (
      await store.listSessions(academyId, {
        from: "2099-01-05T00:00:00.000Z",
        to: "2099-01-05T23:59:59.999Z",
      })
    )[0]!;
    await store.__seedSessionId?.(academyId, legacy, `${created.classId}__2099-01-05`);

    // Now the class has two Monday rules.
    await store.updateClass(
      academyId,
      {
        classId: created.classId,
        recurrenceRules: [
          { dayOfWeek: 1 as const, startTime: "17:00", durationMinutes: 60 },
          { dayOfWeek: 1 as const, startTime: "18:30", durationMinutes: 60 },
        ],
      },
      "owner-1",
    );

    const sessions = await store.generateSessions(
      academyId,
      created.classId,
      "2099-01-05",
      "2099-01-05",
      "Europe/Jersey",
      "owner-1",
    );

    expect(sessions).toHaveLength(2);
    const ids = sessions.map((s) => s.sessionId);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(`${created.classId}__2099-01-05`);
    expect(ids).toContain(`${created.classId}__2099-01-05__1830`);
  });

  it("edits only scheduled sessions and keeps end after start", async () => {
    const store = createInMemoryScheduleStore();
    const session = await store.createSession(
      academyId,
      {
        programId: "program-1",
        locationId: "town",
        instructorId: "coach-a",
        title: "Open mat",
        startAt: "2026-09-20T10:00:00Z",
        endAt: "2026-09-20T11:00:00Z",
        capacity: 20,
      },
      "owner-1",
    );
    const updated = await store.updateSession(
      academyId,
      {
        sessionId: session.sessionId,
        title: "Open mat (Gi)",
        endAt: "2026-09-20T11:30:00Z",
        description: "All belts.",
      },
      "owner-1",
    );
    expect(updated).toMatchObject({
      title: "Open mat (Gi)",
      endAt: "2026-09-20T11:30:00Z",
      description: "All belts.",
      updatedBy: "owner-1",
    });
    await expect(
      store.updateSession(
        academyId,
        { sessionId: session.sessionId, startAt: "2026-09-20T12:00:00Z" },
        "owner-1",
      ),
    ).rejects.toThrow(/after/u);
    await store.cancelSession(academyId, session.sessionId, "Coach ill", "owner-1");
    await expect(
      store.updateSession(academyId, { sessionId: session.sessionId, title: "X" }, "owner-1"),
    ).rejects.toThrow(/scheduled/u);
  });

  it("removes a class: inactive, future sessions cancelled, past ones untouched", async () => {
    const store = createInMemoryScheduleStore();
    const created = await store.createClass(academyId, classInput, "owner-1");
    await store.generateSessions(
      academyId,
      created.classId,
      "2026-09-07",
      "2026-09-20",
      "Europe/Jersey",
      "owner-1",
    );
    const result = await store.removeClass(
      academyId,
      created.classId,
      "Coach left",
      "owner-1",
      "2026-09-13T12:00:00.000Z",
    );
    expect(result.class.active).toBe(false);
    expect(result.cancelledSessions.map((s) => s.sessionId).sort()).toEqual([
      `${created.classId}__2026-09-14__1700`,
      `${created.classId}__2026-09-16__1700`,
    ]);
    const all = await store.listSessions(academyId, {
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-30T00:00:00.000Z",
    });
    expect(all.find((s) => s.sessionId === `${created.classId}__2026-09-07__1700`)?.status).toBe(
      "scheduled",
    );
    expect(all.find((s) => s.sessionId === `${created.classId}__2026-09-14__1700`)).toMatchObject({
      status: "cancelled",
      cancellationReason: "Coach left",
    });
  });

  it("counts confirmed bookings per session", async () => {
    const store = createInMemoryScheduleStore();
    const session = await store.createSession(
      academyId,
      {
        programId: "program-1",
        locationId: "town",
        instructorId: "coach-a",
        title: "Adults",
        startAt: "2099-01-05T18:00:00Z",
        endAt: "2099-01-05T19:00:00Z",
        capacity: 20,
      },
      "owner-1",
    );
    await store.requestBooking(
      academyId,
      { sessionId: session.sessionId, studentId: "s-1", membershipId: "m-1" },
      "s-1",
    );
    const counts = await store.countConfirmedBookings(academyId, [session.sessionId, "missing"]);
    expect(counts).toEqual({ [session.sessionId]: 1, missing: 0 });
  });
});

describe("classes-services store", () => {
  const academyId = "demo-academy";

  it("creates a location with a slug id and updates it", async () => {
    const store = createInMemoryScheduleStore();
    const created = await store.createLocation(
      academyId,
      { name: "Salle Ouest", abbreviation: "ouest", kind: "presential" },
      "admin-1",
    );
    expect(created.locationId).toBe("salle-ouest");
    expect(created.active).toBe(true);
    const second = await store.createLocation(
      academyId,
      { name: "Salle Ouest", abbreviation: "oue2", kind: "zoom" },
      "admin-1",
    );
    expect(second.locationId).toBe("salle-ouest-2");
    const updated = await store.updateLocation(
      academyId,
      { locationId: "salle-ouest", active: false, kind: "jitsi" },
      "admin-1",
    );
    expect(updated.active).toBe(false);
    expect(updated.kind).toBe("jitsi");
    const listed = await store.listLocations(academyId);
    expect(listed.map((l) => l.locationId)).toEqual([
      "town",
      "west",
      "salle-ouest",
      "salle-ouest-2",
    ]);
  });

  it("materialises a default site before updating it", async () => {
    const store = createInMemoryScheduleStore();
    const updated = await store.updateLocation(
      academyId,
      { locationId: "west", abbreviation: "wes" },
      "admin-1",
    );
    expect(updated.name).toBe("BPT West");
    expect(updated.abbreviation).toBe("wes");
  });

  it("creates a v2 program with defaults and updates its colour", async () => {
    const store = createInMemoryScheduleStore();
    const program = await store.createProgramV2(academyId, {
      name: "GI Beginners Mornings",
      abbreviation: "BEG_MOR",
    });
    expect(program).toMatchObject({
      abbreviation: "BEG_MOR",
      colour: "#F0EFFF",
      kind: "class-frequency",
      dropInPolicy: "unlimited",
      active: true,
    });
    const updated = await store.updateProgramV2(academyId, {
      programId: program.programId,
      colour: "#D9D7FF",
      showInList: false,
    });
    expect(updated.colour).toBe("#D9D7FF");
    expect(updated.showInList).toBe(false);
  });

  it("previews, copies and deletes a week", async () => {
    const store = createInMemoryScheduleStore();
    const make = (startAt: string) =>
      store.createSession(
        academyId,
        {
          programId: "open-mat",
          locationId: "town",
          instructorId: "coach-1",
          title: "Open Mat",
          startAt,
          endAt: shiftIso(startAt, 0).replace("T17:00", "T18:00"),
          capacity: null,
        },
        "admin-1",
      );
    await make("2026-09-14T17:00:00.000Z");
    await make("2026-09-16T17:00:00.000Z");
    await make("2026-09-23T17:00:00.000Z"); // the next week: out of range
    const preview = await store.previewWeek(academyId, "2026-09-14", "Europe/Jersey");
    expect(preview.count).toBe(2);
    expect(preview.sample.map((s) => s.startAt)).toEqual([
      "2026-09-14T17:00:00.000Z",
      "2026-09-16T17:00:00.000Z",
    ]);

    const copied = await store.copyWeek(
      academyId,
      { fromWeekStart: "2026-09-14", toWeekStart: "2026-09-28", copyBookings: false },
      "Europe/Jersey",
      "admin-1",
    );
    expect(copied.map((s) => s.startAt)).toEqual([
      "2026-09-28T17:00:00.000Z",
      "2026-09-30T17:00:00.000Z",
    ]);
    expect(copied.every((s) => s.status === "scheduled" && s.classId === null)).toBe(true);

    const again = await store.copyWeek(
      academyId,
      { fromWeekStart: "2026-09-14", toWeekStart: "2026-09-28", copyBookings: false },
      "Europe/Jersey",
      "admin-1",
    );
    expect(again).toHaveLength(0); // idempotent

    const cancelled = await store.deleteWeek(
      academyId,
      { weekStart: "2026-09-28", reason: "Bank holiday" },
      "Europe/Jersey",
      "admin-1",
    );
    expect(cancelled).toHaveLength(2);
    expect(
      cancelled.every((s) => s.status === "cancelled" && s.cancellationReason === "Bank holiday"),
    ).toBe(true);
  });

  it("copies the confirmed bookings of a week when asked", async () => {
    const store = createInMemoryScheduleStore();
    const session = await store.createSession(
      academyId,
      {
        programId: "open-mat",
        locationId: "town",
        instructorId: "coach-1",
        title: "Open Mat",
        startAt: "2026-09-14T17:00:00.000Z",
        endAt: "2026-09-14T18:00:00.000Z",
        capacity: 10,
      },
      "admin-1",
    );
    await store.requestBooking(
      academyId,
      { sessionId: session.sessionId, studentId: "student-1", membershipId: "mem-1" },
      "admin-1",
    );
    await store.requestBooking(
      academyId,
      { sessionId: session.sessionId, studentId: "student-2", membershipId: "mem-2" },
      "admin-1",
    );
    await store.cancelBooking(
      academyId,
      { sessionId: session.sessionId, studentId: "student-2", reason: "Away" },
      "admin-1",
      true,
    );

    const [copy] = await store.copyWeek(
      academyId,
      { fromWeekStart: "2026-09-14", toWeekStart: "2026-09-21", copyBookings: true },
      "Europe/Jersey",
      "admin-1",
    );
    const bookings = await store.listSessionBookings(academyId, copy!.sessionId);
    expect(bookings.map((b) => b.studentId)).toEqual(["student-1"]);
    expect(bookings[0]).toMatchObject({
      bookingId: buildBookingId(copy!.sessionId, "student-1"),
      status: "confirmed",
      membershipId: "mem-1",
    });
  });
});
