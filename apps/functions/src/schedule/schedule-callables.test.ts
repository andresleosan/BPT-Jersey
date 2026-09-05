import { describe, expect, it, vi } from "vitest";

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
  createSaveLocationGeofenceHandler,
  createSaveProgramHandler,
  createSaveSessionHandler,
} from "./schedule-callables";
import { BookingTransactionError } from "./booking-transaction-service";
import { scheduleCallableOptions } from "./schedule-callable-options";
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

const ownStudentScope = async ({
  actorUserId,
  requestedStudentId,
}: {
  actorUserId: string;
  requestedStudentId: string;
}) => actorUserId === requestedStudentId;

describe("Schedule Callables", () => {
  it("requires and consumes App Check for every shared schedule callable", () => {
    expect(scheduleCallableOptions).toEqual({
      cors: ["https://bptjersey.pages.dev"],
      invoker: "public",
      enforceAppCheck: true,
      consumeAppCheckToken: true,
    });
  });

  it.each([
    {
      error: new BookingTransactionError("capacity", "internal capacity detail"),
      expected: {
        code: "failed-precondition",
        message: "Session capacity is no longer available",
        details: { reason: "capacity" },
      },
    },
    {
      error: new BookingTransactionError("tenant", "internal tenant detail"),
      expected: { code: "permission-denied", message: "Booking access is not permitted" },
    },
    {
      error: new Error("database connection detail"),
      expected: { code: "internal", message: "Booking operation failed" },
    },
  ])(
    "maps transactional booking failures without leaking internals",
    async ({ error, expected }) => {
      const store = {
        ...createInMemoryScheduleStore(),
        requestBooking: async () => {
          throw error;
        },
      };
      const handler = createRequestBookingHandler({
        store,
        resolveClientStudentScope: ownStudentScope,
      });

      await expect(
        handler(
          fakeRequest(
            { sessionId: "session-1", studentId: "student-1", membershipId: "membership-1" },
            "adultStudent",
            "student-1",
            "demo-academy",
          ),
        ),
      ).rejects.toMatchObject(expected);
    },
  );

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
      const resolveClientStudentScope = vi.fn(
        async ({ actorUserId, requestedStudentId }) =>
          actorUserId === "adult-user-1" && requestedStudentId === "student-1",
      );
      const requestHandler = createRequestBookingHandler({
        store,
        resolveClientStudentScope,
      });
      const cancelHandler = createCancelBookingHandler({
        store,
        resolveClientStudentScope,
      });
      const listHandler = createListStudentBookingsHandler({
        store,
        resolveClientStudentScope,
      });

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
          "adult-user-1",
          "demo-academy",
        ),
      );

      expect(booked.booking.status).toBe("confirmed");
      expect(booked.booking.studentId).toBe("student-1");

      // Student 1 queries their bookings
      const myList = await listHandler(
        fakeRequest({ studentId: "student-1" }, "adultStudent", "adult-user-1", "demo-academy"),
      );
      expect(myList.bookings).toHaveLength(1);

      // Student 1 cannot query other students' bookings
      await expect(
        listHandler(
          fakeRequest({ studentId: "student-2" }, "adultStudent", "adult-user-1", "demo-academy"),
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
          "adult-user-1",
          "demo-academy",
        ),
      );
      expect(cancelled.booking.status).toBe("cancelled");
    });

    it("isolates guardian self-service to active linked minors", async () => {
      const store = createInMemoryScheduleStore();
      const allowLinkedMinor = async ({ requestedStudentId }: { requestedStudentId: string }) =>
        requestedStudentId === "minor-1";
      const denyUnlinkedStudent = async () => false;
      const requestHandler = createRequestBookingHandler({
        store,
        resolveClientStudentScope: allowLinkedMinor,
      });
      const deniedRequestHandler = createRequestBookingHandler({
        store,
        resolveClientStudentScope: denyUnlinkedStudent,
      });
      const deniedCancelHandler = createCancelBookingHandler({
        store,
        resolveClientStudentScope: denyUnlinkedStudent,
      });
      const deniedListHandler = createListStudentBookingsHandler({
        store,
        resolveClientStudentScope: denyUnlinkedStudent,
      });
      const deniedAttendanceHandler = createListStudentAttendanceHandler({
        store,
        resolveClientStudentScope: denyUnlinkedStudent,
      });
      const deniedHistoryHandler = createListAttendanceHistoryHandler({
        store,
        resolveClientStudentScope: denyUnlinkedStudent,
      });
      const deniedCheckoutHandler = createGetStudentCheckoutHandler({
        store,
        resolveClientStudentScope: denyUnlinkedStudent,
      });
      const deniedRecordCheckoutHandler = createRecordCheckoutHandler({
        store,
        resolveClientStudentScope: denyUnlinkedStudent,
      });
      const checkInHandler = createCheckInHandler({ store });

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

      await expect(
        requestHandler(
          fakeRequest(
            { sessionId: session.sessionId, studentId: "minor-1", membershipId: "mem-1" },
            "guardian",
            "guardian-1",
            "demo-academy",
          ),
        ),
      ).resolves.toMatchObject({ booking: { studentId: "minor-1" } });

      const guardianRequest = fakeRequest(
        { sessionId: session.sessionId, studentId: "minor-2", membershipId: "mem-2" },
        "guardian",
        "guardian-1",
        "demo-academy",
      );
      const guardianCancel = fakeRequest(
        { sessionId: session.sessionId, studentId: "minor-2", reason: "Not attending" },
        "guardian",
        "guardian-1",
        "demo-academy",
      );
      const guardianTarget = fakeRequest(
        { studentId: "minor-2" },
        "guardian",
        "guardian-1",
        "demo-academy",
      );

      await expect(deniedRequestHandler(guardianRequest)).rejects.toThrow(/Access denied/);
      await expect(deniedCancelHandler(guardianCancel)).rejects.toThrow(/Access denied/);
      await expect(deniedListHandler(guardianTarget)).rejects.toThrow(/Access denied/);
      await expect(deniedAttendanceHandler(guardianTarget)).rejects.toThrow(/Access denied/);
      await expect(
        deniedHistoryHandler(
          fakeRequest(
            { sessionId: session.sessionId, studentId: "minor-2" },
            "guardian",
            "guardian-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow(/Access denied/);
      await expect(
        deniedCheckoutHandler(
          fakeRequest(
            { sessionId: session.sessionId, studentId: "minor-2" },
            "guardian",
            "guardian-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow(/Access denied/);
      await expect(
        deniedRecordCheckoutHandler(
          fakeRequest(
            {
              sessionId: session.sessionId,
              studentId: "minor-2",
              method: "authorizedAdult",
              authorizedAdultId: "guardian-1",
              authorizedAdultName: "Carlos Silva",
            },
            "guardian",
            "guardian-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow(/Access denied/);
      await expect(
        checkInHandler(
          fakeRequest(
            { sessionId: session.sessionId, studentId: "minor-2", method: "pin" },
            "guardian",
            "guardian-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow(/Staff access is required for check-in/);
    });

    it("allows staff to view session roster and evaluate minimum quorum", async () => {
      const store = createInMemoryScheduleStore();
      const requestHandler = createRequestBookingHandler({
        store,
        resolveClientStudentScope: ownStudentScope,
      });
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
    it("keeps self-service credentials closed and allows manual staff check-in", async () => {
      const store = createInMemoryScheduleStore();
      const checkInHandler = createCheckInHandler({ store });
      const sessionAttendanceHandler = createListSessionAttendanceHandler({ store });
      const studentAttendanceHandler = createListStudentAttendanceHandler({
        store,
        resolveClientStudentScope: ownStudentScope,
      });

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

      // A QR label is not accepted without a verified academy credential.
      await expect(
        checkInHandler(
          fakeRequest(
            {
              sessionId: session.sessionId,
              studentId: "student-1",
              method: "qr",
            },
            "adultStudent",
            "auth-adult-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow(/Staff access is required for check-in/);

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
      ).rejects.toThrow(/Staff access is required for check-in/);

      // Coach performs manual check-in for student 1.
      const firstManualRes = await checkInHandler(
        fakeRequest(
          {
            sessionId: session.sessionId,
            studentId: "student-1",
            method: "manual",
          },
          "coach",
          "coach-1",
          "demo-academy",
        ),
      );
      expect(firstManualRes.attendance.method).toBe("manual");
      expect(firstManualRes.attendance.studentId).toBe("student-1");

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
      const historyHandler = createListAttendanceHistoryHandler({
        store,
        resolveClientStudentScope: ownStudentScope,
      });

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

      // Coach checks student 1 in manually; self-service QR remains closed.
      await checkInHandler(
        fakeRequest(
          {
            sessionId: session.sessionId,
            studentId: "student-1",
            method: "manual",
          },
          "coach",
          "coach-1",
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
    it("keeps adult self checkout fail-closed until the policy is approved", async () => {
      const store = createInMemoryScheduleStore();
      const recordCheckout = vi.spyOn(store, "recordCheckout");
      const handler = createRecordCheckoutHandler({
        store,
        resolveClientStudentScope: ownStudentScope,
      });

      await expect(
        handler(
          fakeRequest(
            {
              sessionId: "session-adult",
              studentId: "adult-1",
              method: "independentRelease",
            },
            "adultStudent",
            "adult-1",
            "demo-academy",
          ),
        ),
      ).rejects.toThrow(/Independent release requires verified policy evidence/);
      expect(recordCheckout).not.toHaveBeenCalled();
    });

    it("handles child check-out authorization, staff overrides, and queries", async () => {
      const store = createInMemoryScheduleStore();
      const checkInHandler = createCheckInHandler({ store });
      const guardianScope = async ({ requestedStudentId }: { requestedStudentId: string }) =>
        requestedStudentId === "minor-1";
      const recordCheckoutHandler = createRecordCheckoutHandler({
        store,
        resolveClientStudentScope: guardianScope,
      });
      const listCheckoutsHandler = createListSessionCheckoutsHandler({ store });
      const getCheckoutHandler = createGetStudentCheckoutHandler({
        store,
        resolveClientStudentScope: guardianScope,
      });

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

      // Coach checks the minor in manually.
      await checkInHandler(
        fakeRequest(
          {
            sessionId: session.sessionId,
            studentId: "minor-1",
            method: "manual",
          },
          "coach",
          "coach-1",
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

describe("saveLocationGeofence (T109)", () => {
  const geofence = { latitude: 49.186, longitude: -2.106 };

  it("records the coordinates of a site for administration only", async () => {
    const store = createInMemoryScheduleStore();
    const handler = createSaveLocationGeofenceHandler({ store });

    const saved = (await handler(fakeRequest({ locationId: "town", geofence }))) as {
      location: { locationId: string; geofence: unknown };
    };
    expect(saved.location).toMatchObject({ locationId: "town", geofence });

    const locations = await store.listLocations("demo-academy");
    expect(locations.find((location) => location.locationId === "town")?.geofence).toEqual(
      geofence,
    );
    // The other site is untouched, so one site can be configured before the other.
    expect(locations.find((location) => location.locationId === "west")?.geofence).toBeUndefined();
  });

  it("clears the coordinates when the geofence is null", async () => {
    const store = createInMemoryScheduleStore();
    const handler = createSaveLocationGeofenceHandler({ store });
    await handler(fakeRequest({ locationId: "west", geofence }));

    const cleared = (await handler(fakeRequest({ locationId: "west", geofence: null }))) as {
      location: { geofence: unknown };
    };
    expect(cleared.location.geofence).toBeNull();
  });

  it.each(["headCoach", "coach", "guardian", "adultStudent"])(
    "refuses %s, because site coordinates are an administrative setting",
    async (role) => {
      const handler = createSaveLocationGeofenceHandler({ store: createInMemoryScheduleStore() });
      await expect(
        handler(fakeRequest({ locationId: "town", geofence }, role)),
      ).rejects.toMatchObject({ code: "permission-denied" });
    },
  );

  it("refuses an unknown site, a coarse coordinate and an extra key", async () => {
    const handler = createSaveLocationGeofenceHandler({ store: createInMemoryScheduleStore() });
    for (const payload of [
      { locationId: "harbour", geofence },
      { locationId: "town", geofence: { latitude: 49.1234567, longitude: -2.1 } },
      { locationId: "town", geofence, radiusMeters: 500 },
      { locationId: "town" },
    ]) {
      await expect(handler(fakeRequest(payload))).rejects.toMatchObject({
        code: "invalid-argument",
      });
    }
  });
});

describe("check-in proximity signal through the callables (T109)", () => {
  const geofence = { latitude: 49.186, longitude: -2.106 };

  async function sessionAt(
    store: ReturnType<typeof createInMemoryScheduleStore>,
    locationId: "town" | "west",
  ) {
    const startAt = new Date(Date.now() + 3 * 3_600_000);
    const created = (await createSaveSessionHandler({ store })(
      fakeRequest({
        classId: null,
        programId: "adult-fundamentals",
        locationId,
        instructorId: "coach-1",
        title: `Proximity ${locationId}`,
        startAt: startAt.toISOString(),
        endAt: new Date(startAt.getTime() + 3_600_000).toISOString(),
        capacity: 10,
        minParticipants: 4,
      }),
    )) as { session: { sessionId: string } };
    return created.session.sessionId;
  }

  function measurement(distanceMeters: number) {
    return { distanceMeters, accuracyMeters: 9, measuredAt: new Date().toISOString() };
  }

  it("refuses an outside measurement without a reason and records one with it", async () => {
    const store = createInMemoryScheduleStore();
    await createSaveLocationGeofenceHandler({ store })(
      fakeRequest({ locationId: "town", geofence }),
    );
    const sessionId = await sessionAt(store, "town");
    const checkIn = createCheckInHandler({ store });

    await expect(
      checkIn(
        fakeRequest(
          { sessionId, studentId: "student-1", method: "manual", proximity: measurement(320) },
          "coach",
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });

    const recorded = (await checkIn(
      fakeRequest(
        {
          sessionId,
          studentId: "student-1",
          method: "manual",
          proximity: measurement(320),
          overrideReason: "Signal drifted indoors; the student is on the mat.",
        },
        "coach",
      ),
    )) as { attendance: { proximity?: { signal: string; overrideReason: string | null } } };
    expect(recorded.attendance.proximity).toMatchObject({
      signal: "outside",
      overrideReason: "Signal drifted indoors; the student is on the mat.",
    });
  });

  it("records an unavailable signal at a site without coordinates and asks for no reason", async () => {
    const store = createInMemoryScheduleStore();
    const sessionId = await sessionAt(store, "west");

    const recorded = (await createCheckInHandler({ store })(
      fakeRequest(
        { sessionId, studentId: "student-1", method: "manual", proximity: measurement(320) },
        "coach",
      ),
    )) as { attendance: { proximity?: { signal: string } } };
    expect(recorded.attendance.proximity).toEqual({
      signal: "unavailable",
      distanceMeters: null,
      accuracyMeters: null,
      overrideReason: null,
    });
  });

  it("hides the staff-device signal and override reason from members and guardians", async () => {
    const store = createInMemoryScheduleStore();
    await createSaveLocationGeofenceHandler({ store })(
      fakeRequest({ locationId: "town", geofence }),
    );
    const sessionId = await sessionAt(store, "town");
    await createCheckInHandler({ store })(
      fakeRequest(
        {
          sessionId,
          studentId: "student-1",
          method: "manual",
          proximity: measurement(320),
          overrideReason: "Signal drifted indoors; the student is on the mat.",
        },
        "coach",
      ),
    );
    const scope = { store, resolveClientStudentScope: ownStudentScope };

    const own = (await createListStudentAttendanceHandler(scope)(
      fakeRequest({}, "adultStudent", "student-1"),
    )) as { attendance: readonly Record<string, unknown>[] };
    expect(own.attendance).toHaveLength(1);
    expect(own.attendance[0]).not.toHaveProperty("proximity");
    expect(JSON.stringify(own.attendance)).not.toContain("drifted");

    const history = (await createListAttendanceHistoryHandler(scope)(
      fakeRequest({ sessionId }, "adultStudent", "student-1"),
    )) as { history: readonly Record<string, unknown>[] };
    expect(history.history.every((record) => !("proximity" in record))).toBe(true);

    // Staff keep the full record, including the audited reason.
    const staff = (await createListStudentAttendanceHandler(scope)(
      fakeRequest({ studentId: "student-1" }, "coach", "coach-1"),
    )) as { attendance: readonly { proximity?: { signal: string } }[] };
    expect(staff.attendance[0]?.proximity?.signal).toBe("outside");
  });

  it("never attaches a proximity signal to corrections or no-shows", async () => {
    const store = createInMemoryScheduleStore();
    await createSaveLocationGeofenceHandler({ store })(
      fakeRequest({ locationId: "town", geofence }),
    );
    const sessionId = await sessionAt(store, "town");
    await createCheckInHandler({ store })(
      fakeRequest(
        { sessionId, studentId: "student-1", method: "manual", proximity: measurement(18) },
        "coach",
      ),
    );

    const corrected = (await createCorrectAttendanceHandler({ store })(
      fakeRequest(
        { sessionId, studentId: "student-1", newState: "late", reason: "Arrived late" },
        "coach",
      ),
    )) as { correction: Record<string, unknown>; canonical: Record<string, unknown> };
    expect(corrected.correction).not.toHaveProperty("proximity");

    const reconciled = (await createReconcileSessionNoShowsHandler({ store })(
      fakeRequest({ sessionId }, "owner"),
    )) as { records: readonly Record<string, unknown>[] };
    expect(reconciled.records.every((record) => !("proximity" in record))).toBe(true);
  });
});
