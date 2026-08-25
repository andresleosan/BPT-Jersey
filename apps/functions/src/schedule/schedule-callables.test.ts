import { describe, expect, it } from "vitest";

import {
  createCancelBookingHandler,
  createCancelSessionHandler,
  createCheckInHandler,
  createCorrectAttendanceHandler,
  createEvaluateSessionMinimumHandler,
  createGenerateSessionsHandler,
  createGetDailyOperationsDashboardHandler,
  createGetSessionOperationalViewHandler,
  createGetStudentCheckoutHandler,
  createListAttendanceHistoryHandler,
  createListClassesHandler,
  createListScheduleCatalogHandler,
  createListSessionAttendanceHandler,
  createListSessionBookingsHandler,
  createListSessionCheckoutsHandler,
  createListSessionsHandler,
  createListStudentAttendanceHandler,
  createListStudentBookingsHandler,
  createReconcileSessionNoShowsHandler,
  createRecordCheckoutHandler,
  createRequestBookingHandler,
  createSaveClassHandler,
  createSaveProgramHandler,
  createSaveSessionHandler,
} from "./schedule-callables";
import { createInMemoryScheduleStore } from "./schedule-service";

function fakeRequest(
  data: unknown,
  role = "owner",
  uid: string | null = "user-1",
  academyId = "demo-academy",
) {
  return {
    auth: uid ? { uid, token: { academyId, role } } : undefined,
    data,
  } as never;
}

describe("Schedule Callables", () => {
  it("allows any authenticated role to list locations and programs", async () => {
    const store = createInMemoryScheduleStore();
    const handler = createListScheduleCatalogHandler({ store });

    const response = await handler(fakeRequest(null, "adultStudent", "student-1", "demo-academy"));
    expect(response.locations).toHaveLength(2);
    expect(response.programs.length).toBeGreaterThan(0);
  });

  it("restricts listClasses to staff roles", async () => {
    const store = createInMemoryScheduleStore();
    const handler = createListClassesHandler({ store });

    // Coach allowed
    const coachResponse = await handler(fakeRequest(null, "coach", "coach-1", "demo-academy"));
    expect(coachResponse.classes).toEqual([]);

    // Student denied
    await expect(
      handler(fakeRequest(null, "adultStudent", "student-1", "demo-academy")),
    ).rejects.toThrow(/Staff access required/);
  });

  it("creates classes for manager roles and validates input", async () => {
    const store = createInMemoryScheduleStore();
    const handler = createSaveClassHandler({ store });

    // Valid class creation by owner
    const response = await handler(
      fakeRequest(
        {
          programId: "adult-fundamentals",
          locationId: "town",
          name: "Adult BJJ Town",
          recurrenceRule: { dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 },
          instructorIds: ["coach-1"],
          capacity: 20,
          minParticipants: 4,
        },
        "owner",
        "owner-1",
        "demo-academy",
      ),
    );

    expect(response.class.classId).toBeDefined();
    expect(response.class.name).toBe("Adult BJJ Town");

    // Denied for coach
    await expect(
      handler(
        fakeRequest(
          {
            programId: "adult-fundamentals",
            locationId: "town",
            name: "Class",
            recurrenceRule: { dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 },
            instructorIds: ["coach-1"],
            capacity: 20,
          },
          "coach",
          "coach-1",
          "demo-academy",
        ),
      ),
    ).rejects.toThrow(/Manager access required/);
  });

  it("creates, queries, and cancels sessions", async () => {
    const store = createInMemoryScheduleStore();
    const saveHandler = createSaveSessionHandler({ store });
    const listHandler = createListSessionsHandler({ store });
    const cancelHandler = createCancelSessionHandler({ store });

    const created = await saveHandler(
      fakeRequest(
        {
          programId: "adult-fundamentals",
          locationId: "town",
          instructorId: "coach-1",
          title: "Adult Fundamentals Session",
          startAt: "2026-09-01T18:00:00Z",
          endAt: "2026-09-01T19:00:00Z",
          capacity: 20,
        },
        "owner",
        "owner-1",
        "demo-academy",
      ),
    );

    expect(created.session.sessionId).toBeDefined();

    const queried = await listHandler(
      fakeRequest(
        {
          from: "2026-09-01T00:00:00Z",
          to: "2026-09-02T00:00:00Z",
        },
        "adultStudent",
        "student-1",
        "demo-academy",
      ),
    );

    expect(queried.sessions).toHaveLength(1);
    expect(queried.sessions[0]?.sessionId).toBe(created.session.sessionId);

    const cancelled = await cancelHandler(
      fakeRequest(
        {
          sessionId: created.session.sessionId,
          reason: "Instructor ill",
        },
        "coach",
        "coach-1",
        "demo-academy",
      ),
    );

    expect(cancelled.session.status).toBe("cancelled");
    expect(cancelled.session.cancellationReason).toBe("Instructor ill");
  });

  it("creates programs with admin role and rejects unauthorized roles", async () => {
    const store = createInMemoryScheduleStore();
    const handler = createSaveProgramHandler({ store });

    const created = await handler(
      fakeRequest(
        {
          name: "Kids Judo",
          ageBand: "kids",
          discipline: "bjj",
          level: "all-levels",
        },
        "administrator",
        "admin-1",
        "demo-academy",
      ),
    );

    expect(created.program.programId).toBeDefined();
    expect(created.program.name).toBe("Kids Judo");

    // Denied for coach
    await expect(
      handler(
        fakeRequest(
          {
            name: "Kids Judo",
            ageBand: "kids",
            discipline: "bjj",
            level: "all-levels",
          },
          "coach",
          "coach-1",
          "demo-academy",
        ),
      ),
    ).rejects.toThrow(/Administrator access required/);
  });

  it("generates sessions for a class with headCoach or higher", async () => {
    const store = createInMemoryScheduleStore();
    const classHandler = createSaveClassHandler({ store });
    const generateHandler = createGenerateSessionsHandler({ store });

    const cls = await classHandler(
      fakeRequest(
        {
          programId: "adult-fundamentals",
          locationId: "town",
          name: "Tuesday Adult BJJ",
          recurrenceRule: { dayOfWeek: 2, startTime: "19:00", durationMinutes: 60 },
          instructorIds: ["coach-1"],
          capacity: 25,
          minParticipants: 4,
        },
        "headCoach",
        "headcoach-1",
        "demo-academy",
      ),
    );

    const generated = await generateHandler(
      fakeRequest(
        {
          classId: cls.class.classId,
          fromDate: "2026-09-01",
          toDate: "2026-09-30",
          timezone: "Europe/Jersey",
        },
        "headCoach",
        "headcoach-1",
        "demo-academy",
      ),
    );

    expect(generated.sessions).toHaveLength(5);

    // Denied for adultStudent
    await expect(
      generateHandler(
        fakeRequest(
          {
            classId: cls.class.classId,
            fromDate: "2026-09-01",
            toDate: "2026-09-30",
          },
          "adultStudent",
          "student-1",
          "demo-academy",
        ),
      ),
    ).rejects.toThrow(/Manager access required/);
  });

  describe("Booking & Roster Callables", () => {
    it("allows student to request and cancel their own booking", async () => {
      const store = createInMemoryScheduleStore();
      const requestHandler = createRequestBookingHandler({ store });
      const cancelHandler = createCancelBookingHandler({ store });
      const listHandler = createListStudentBookingsHandler({ store });

      const session = await store.createSession(
        "demo-academy",
        {
          programId: "adult-fundamentals",
          locationId: "town",
          instructorId: "coach-1",
          title: "Evening BJJ",
          startAt: "2099-09-01T18:00:00Z",
          endAt: "2099-09-01T19:00:00Z",
          capacity: 20,
        },
        "owner-1",
      );

      // Student 1 requests booking
      const booked = await requestHandler(
        fakeRequest(
          {
            sessionId: session.sessionId,
            studentId: "student-1",
            membershipId: "mem-1",
          },
          "adultStudent",
          "student-1",
          "demo-academy",
        ),
      );

      expect(booked.booking.status).toBe("confirmed");
      expect(booked.booking.studentId).toBe("student-1");

      // Student 1 queries their bookings
      const myList = await listHandler(
        fakeRequest({ studentId: "student-1" }, "adultStudent", "student-1", "demo-academy"),
      );
      expect(myList.bookings).toHaveLength(1);

      // Student 1 cannot query other students' bookings
      await expect(
        listHandler(
          fakeRequest({ studentId: "student-2" }, "adultStudent", "student-1", "demo-academy"),
        ),
      ).rejects.toThrow(/Access denied/);

      // Student 1 cancels their booking
      const cancelled = await cancelHandler(
        fakeRequest(
          {
            sessionId: session.sessionId,
            studentId: "student-1",
            reason: "Personal conflict",
          },
          "adultStudent",
          "student-1",
          "demo-academy",
        ),
      );
      expect(cancelled.booking.status).toBe("cancelled");
    });

    it("allows staff to view session roster and evaluate minimum quorum", async () => {
      const store = createInMemoryScheduleStore();
      const requestHandler = createRequestBookingHandler({ store });
      const rosterHandler = createListSessionBookingsHandler({ store });
      const quorumHandler = createEvaluateSessionMinimumHandler({ store });

      const session = await store.createSession(
        "demo-academy",
        {
          programId: "adult-fundamentals",
          locationId: "town",
          instructorId: "coach-1",
          title: "Morning Class",
          startAt: "2099-09-01T10:00:00Z",
          endAt: "2099-09-01T11:00:00Z",
          capacity: 15,
          minParticipants: 4,
        },
        "owner-1",
      );

      // Student books
      await requestHandler(
        fakeRequest(
          {
            sessionId: session.sessionId,
            studentId: "student-1",
            membershipId: "mem-1",
          },
          "adultStudent",
          "student-1",
          "demo-academy",
        ),
      );

      // Coach checks roster
      const roster = await rosterHandler(
        fakeRequest({ sessionId: session.sessionId }, "coach", "coach-1", "demo-academy"),
      );
      expect(roster.bookings).toHaveLength(1);

      // Student denied access to full session roster
      await expect(
        rosterHandler(
          fakeRequest(
            { sessionId: session.sessionId },
            "adultStudent",
            "student-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow(/Staff access required/);

      // Evaluate minimum
      const quorum = await quorumHandler(
        fakeRequest({ sessionId: session.sessionId }, "coach", "coach-1", "demo-academy"),
      );
      expect(quorum.result.quorumMet).toBe(false);
      expect(quorum.result.confirmedCount).toBe(1);
    });
  });

  describe("Check-In Callables", () => {
    it("handles QR check-in for student and manual check-in for staff", async () => {
      const store = createInMemoryScheduleStore();
      const checkInHandler = createCheckInHandler({ store });
      const sessionAttendanceHandler = createListSessionAttendanceHandler({ store });
      const studentAttendanceHandler = createListStudentAttendanceHandler({ store });

      const session = await store.createSession(
        "demo-academy",
        {
          programId: "adult-fundamentals",
          locationId: "town",
          instructorId: "coach-1",
          title: "Evening Class",
          startAt: "2099-09-01T18:00:00Z",
          endAt: "2099-09-01T19:00:00Z",
          capacity: 25,
        },
        "owner-1",
      );

      // Student checks in via QR
      const qrRes = await checkInHandler(
        fakeRequest(
          {
            sessionId: session.sessionId,
            studentId: "student-1",
            method: "qr",
          },
          "adultStudent",
          "student-1",
          "demo-academy",
        ),
      );
      expect(qrRes.attendance.method).toBe("qr");
      expect(qrRes.attendance.studentId).toBe("student-1");

      // Student cannot do manual check-in
      await expect(
        checkInHandler(
          fakeRequest(
            {
              sessionId: session.sessionId,
              studentId: "student-2",
              method: "manual",
            },
            "adultStudent",
            "student-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow(/Staff access required for manual or nameSearch check-in/);

      // Coach performs manual check-in for student 2
      const manualRes = await checkInHandler(
        fakeRequest(
          {
            sessionId: session.sessionId,
            studentId: "student-2",
            method: "manual",
            notes: "Approved by Head Coach",
          },
          "coach",
          "coach-1",
          "demo-academy",
        ),
      );
      expect(manualRes.attendance.method).toBe("manual");
      expect(manualRes.attendance.notes).toBe("Approved by Head Coach");

      // Coach lists session attendance
      const sList = await sessionAttendanceHandler(
        fakeRequest({ sessionId: session.sessionId }, "coach", "coach-1", "demo-academy"),
      );
      expect(sList.attendance).toHaveLength(2);

      // Student lists own attendance
      const myAtt = await studentAttendanceHandler(
        fakeRequest({ studentId: "student-1" }, "adultStudent", "student-1", "demo-academy"),
      );
      expect(myAtt.attendance).toHaveLength(1);
    });
  });

  describe("Attendance Corrections & No-Shows Callables", () => {
    it("allows staff to correct attendance, reconcile no-shows, and view history", async () => {
      const store = createInMemoryScheduleStore();
      const checkInHandler = createCheckInHandler({ store });
      const correctHandler = createCorrectAttendanceHandler({ store });
      const reconcileHandler = createReconcileSessionNoShowsHandler({ store });
      const historyHandler = createListAttendanceHistoryHandler({ store });

      const session = await store.createSession(
        "demo-academy",
        {
          programId: "adult-fundamentals",
          locationId: "town",
          instructorId: "coach-1",
          title: "Evening Class",
          startAt: "2099-09-01T18:00:00Z",
          endAt: "2099-09-01T19:00:00Z",
          capacity: 25,
        },
        "owner-1",
      );

      // Student 1 checks in
      await checkInHandler(
        fakeRequest(
          { sessionId: session.sessionId, studentId: "student-1", method: "qr" },
          "adultStudent",
          "student-1",
          "demo-academy",
        ),
      );

      // Student cannot correct attendance
      await expect(
        correctHandler(
          fakeRequest(
            {
              sessionId: session.sessionId,
              studentId: "student-1",
              newState: "attended",
              reason: "I was actually on time",
            },
            "adultStudent",
            "student-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow(/Staff access required to correct attendance/);

      // Coach corrects attendance
      const corrRes = await correctHandler(
        fakeRequest(
          {
            sessionId: session.sessionId,
            studentId: "student-1",
            newState: "attended",
            reason: "Coach verified presence at mat before start",
          },
          "coach",
          "coach-1",
          "demo-academy",
        ),
      );
      expect(corrRes.canonical.state).toBe("attended");
      expect(corrRes.correction.correctionOf).toBe(`${session.sessionId}__student-1`);

      // Student 2 booked but no check-in
      await store.requestBooking(
        "demo-academy",
        { sessionId: session.sessionId, studentId: "student-2", membershipId: "mem-2" },
        "student-2",
      );

      // Coach reconciles no-shows
      const noShowRes = await reconcileHandler(
        fakeRequest({ sessionId: session.sessionId }, "coach", "coach-1", "demo-academy"),
      );
      expect(noShowRes.noShowsMarked).toBe(1);

      // History query
      const histRes = await historyHandler(
        fakeRequest(
          { sessionId: session.sessionId, studentId: "student-1" },
          "coach",
          "coach-1",
          "demo-academy",
        ),
      );
      expect(histRes.history).toHaveLength(2);
    });
  });

  describe("Child Check-Out & Release Callables", () => {
    it("handles child check-out authorization, staff overrides, and queries", async () => {
      const store = createInMemoryScheduleStore();
      const checkInHandler = createCheckInHandler({ store });
      const recordCheckoutHandler = createRecordCheckoutHandler({ store });
      const listCheckoutsHandler = createListSessionCheckoutsHandler({ store });
      const getCheckoutHandler = createGetStudentCheckoutHandler({ store });

      const session = await store.createSession(
        "demo-academy",
        {
          programId: "kids-gi",
          locationId: "town",
          instructorId: "coach-1",
          title: "Kids Gi Class",
          startAt: "2099-09-01T16:00:00Z",
          endAt: "2099-09-01T17:00:00Z",
          capacity: 20,
        },
        "owner-1",
      );

      // Minor checks in
      await checkInHandler(
        fakeRequest(
          { sessionId: session.sessionId, studentId: "minor-1", method: "pin" },
          "adultStudent",
          "minor-1",
          "demo-academy",
        ),
      );

      // Non-staff cannot execute staffOverride
      await expect(
        recordCheckoutHandler(
          fakeRequest(
            {
              sessionId: session.sessionId,
              studentId: "minor-1",
              method: "staffOverride",
              notes: "Emergency",
            },
            "adultStudent",
            "minor-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow(/Staff access required for staffOverride checkout/);

      // Guardian checks out minor
      const coRes = await recordCheckoutHandler(
        fakeRequest(
          {
            sessionId: session.sessionId,
            studentId: "minor-1",
            method: "authorizedAdult",
            authorizedAdultId: "guardian-1",
            authorizedAdultName: "Carlos Silva",
          },
          "guardian",
          "guardian-1",
          "demo-academy",
        ),
      );
      expect(coRes.checkout.method).toBe("authorizedAdult");
      expect(coRes.checkout.authorizedAdultName).toBe("Carlos Silva");

      // Staff lists session checkouts
      const sCheckouts = await listCheckoutsHandler(
        fakeRequest({ sessionId: session.sessionId }, "coach", "coach-1", "demo-academy"),
      );
      expect(sCheckouts.checkouts).toHaveLength(1);

      // Guardian gets student checkout
      const single = await getCheckoutHandler(
        fakeRequest(
          { sessionId: session.sessionId, studentId: "minor-1" },
          "guardian",
          "guardian-1",
          "demo-academy",
        ),
      );
      expect(single.checkout?.checkoutId).toBe(`${session.sessionId}__minor-1`);
    });
  });

  describe("Live Session Operational View Callable", () => {
    it("enforces staff access and returns unified operational view", async () => {
      const store = createInMemoryScheduleStore();
      const operationalViewHandler = createGetSessionOperationalViewHandler({ store });

      const session = await store.createSession(
        "demo-academy",
        {
          programId: "kids-gi",
          locationId: "town",
          instructorId: "coach-1",
          title: "Kids Gi Class",
          startAt: "2099-09-01T16:00:00Z",
          endAt: "2099-09-01T17:00:00Z",
          capacity: 20,
        },
        "owner-1",
      );

      // Non-staff is denied
      await expect(
        operationalViewHandler(
          fakeRequest(
            { sessionId: session.sessionId },
            "adultStudent",
            "student-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow(/Staff access required to view live operational roster/);

      // Staff receives full operational view
      const result = await operationalViewHandler(
        fakeRequest({ sessionId: session.sessionId }, "coach", "coach-1", "demo-academy"),
      );

      expect(result.view.session.sessionId).toBe(session.sessionId);
      expect(result.view.summary.capacity).toBe(20);
      expect(result.view.roster).toHaveLength(0);
    });
  });
  describe("Daily Operations Dashboard Callable", () => {
    it("returns sorted session snapshots for staff and denies non-staff", async () => {
      const store = createInMemoryScheduleStore();
      const handler = createGetDailyOperationsDashboardHandler({ store });
      const later = await store.createSession(
        "demo-academy",
        {
          programId: "adult-fundamentals",
          locationId: "town",
          instructorId: "coach-1",
          title: "Later Class",
          startAt: "2026-09-01T19:00:00Z",
          endAt: "2026-09-01T20:00:00Z",
          capacity: 20,
        },
        "owner-1",
      );
      const earlier = await store.createSession(
        "demo-academy",
        {
          programId: "adult-fundamentals",
          locationId: "town",
          instructorId: "coach-1",
          title: "Earlier Class",
          startAt: "2026-09-01T18:00:00Z",
          endAt: "2026-09-01T19:00:00Z",
          capacity: 20,
        },
        "owner-1",
      );
      await store.requestBooking(
        "demo-academy",
        { sessionId: earlier.sessionId, studentId: "student-1", membershipId: "membership-1" },
        "student-1",
      );
      await store.recordCheckIn(
        "demo-academy",
        { sessionId: earlier.sessionId, studentId: "student-1", method: "qr" },
        "student-1",
        "2026-09-01T18:05:00Z",
      );

      const response = await handler(
        fakeRequest(
          { from: "2026-09-01T00:00:00Z", to: "2026-09-01T23:59:59Z" },
          "coach",
          "coach-1",
          "demo-academy",
        ),
      );

      expect(response.dashboard.sessions.map((item) => item.session.sessionId)).toEqual([
        earlier.sessionId,
        later.sessionId,
      ]);
      expect(response.dashboard.sessions[0]?.summary.totalBookings).toBe(1);
      expect(response.dashboard.sessions[0]?.summary.totalCheckedIn).toBe(1);
      expect(response.dashboard.sessions[0]).not.toHaveProperty("roster");

      await expect(
        handler(
          fakeRequest(
            { from: "2026-09-01T00:00:00Z", to: "2026-09-01T23:59:59Z" },
            "guardian",
            "guardian-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow(/Staff access required/);

      await expect(
        handler(fakeRequest({ from: "not-a-date", to: "2026-09-01T23:59:59Z" }, "coach")),
      ).rejects.toThrow(/valid ISO 8601/);

      await expect(
        handler(fakeRequest({ from: "2026-09-01T00:00:00Z", to: "2026-09-03T00:00:00Z" }, "coach")),
      ).rejects.toThrow(/cannot exceed 24 hours/);
    });
  });
});
