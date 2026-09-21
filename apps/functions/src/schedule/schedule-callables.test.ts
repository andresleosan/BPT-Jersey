import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syntheticAuthUsers = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    getUser: async (uid: string) => syntheticAuthUsers.get(uid),
  }),
}));

import { browserOrigins } from "../auth/callable-options.js";

import {
  createBulkBookEligibleSessionsHandler,
  createCancelBookingHandler,
  createCancelSessionHandler,
  createCheckInHandler,
  createCopyWeekHandler,
  createCorrectAttendanceHandler,
  createDeleteWeekHandler,
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
  createListSessionBookedCountsHandler,
  createListSessionCheckoutsHandler,
  createListSessionsHandler,
  createListStudentAttendanceHandler,
  createListStudentBookingsHandler,
  createPreviewWeekHandler,
  createReconcileSessionNoShowsHandler,
  createReconcileSessionQuorumHandler,
  createRecordCheckoutHandler,
  createRemoveClassHandler,
  createRequestBookingHandler,
  createSaveClassHandler,
  createSaveLocationGeofenceHandler,
  createSaveLocationHandler,
  createSaveProgramHandler,
  createSaveSessionHandler,
  createSelfCheckInHandler,
  createUpdateLocationHandler,
  createUpdateProgramHandler,
  createUpdateSessionHandler,
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
  if (uid) {
    syntheticAuthUsers.set(uid, {
      uid,
      disabled: false,
      emailVerified: true,
      customClaims: { academyId, role },
      tokensValidAfterTime: "2020-01-01T00:00:00.000Z",
    });
  }
  return {
    app: { appId: "synthetic-app" },
    auth: uid ? { uid, token: { academyId, role, auth_time: 1_700_000_000 } } : undefined,
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
      cors: browserOrigins,
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
          recurrenceRules: [{ dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 }],
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
            recurrenceRules: [{ dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 }],
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
    ).rejects.toThrow(/Manager access required/);
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
          recurrenceRules: [{ dayOfWeek: 2, startTime: "19:00", durationMinutes: 60 }],
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
    it("routes Intro Class bookings through the dedicated transaction", async () => {
      const store = createInMemoryScheduleStore();
      const requestIntroBooking = vi.fn(async (command) => ({
        bookingId: "intro-booking-1",
        academyId: command.academyId,
        sessionId: command.sessionId,
        studentId: command.studentId,
        membershipId: null,
        source: { kind: "intro" as const },
        status: "confirmed" as const,
        requestedAt: command.now,
        cancelledAt: null,
        cancellationReason: null,
        schemaVersion: "3" as const,
        createdAt: command.now,
        createdBy: command.actorId,
        updatedAt: command.now,
        updatedBy: command.actorId,
      }));
      const handler = createRequestBookingHandler({
        store,
        resolveClientStudentScope: ownStudentScope,
        requestIntroBooking,
      });

      const result = await handler(
        fakeRequest(
          { kind: "intro", sessionId: "intro-1", studentId: "student-1" },
          "adultStudent",
          "student-1",
          "demo-academy",
        ),
      );

      expect(result.booking).toMatchObject({ membershipId: null, source: { kind: "intro" } });
      expect(requestIntroBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          academyId: "demo-academy",
          actorId: "student-1",
          studentId: "student-1",
          sessionId: "intro-1",
        }),
      );
    });

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

describe("Self check-in callable", () => {
  const town = { latitude: 49.183954, longitude: -2.107142 };
  const near = { latitude: 49.184224, longitude: -2.107142, accuracyMeters: 12 };
  const far = { latitude: 49.185034, longitude: -2.107142, accuracyMeters: 12 };

  async function seeded() {
    const store = createInMemoryScheduleStore();
    await store.saveLocationGeofence(
      "demo-academy",
      { locationId: "town", geofence: town },
      "owner-1",
    );
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
    await store.requestBooking(
      "demo-academy",
      { sessionId: session.sessionId, studentId: "student-1", membershipId: "mem-1" },
      "student-1",
    );
    return { store, session };
  }

  beforeEach(() => vi.useFakeTimers({ now: new Date("2099-09-01T17:30:00Z") }));
  afterEach(() => vi.useRealTimers());

  it.each(["adultStudent", "teenStudent", "guardian"] as const)(
    "checks in an in-scope %s member with server time and no coordinates",
    async (role) => {
      const { store, session } = await seeded();
      const recorded = vi.fn(store.recordSelfCheckIn);
      const handler = createSelfCheckInHandler({
        store: { ...store, recordSelfCheckIn: recorded },
        resolveClientStudentScope: ownStudentScope,
      });

      const result = await handler(
        fakeRequest(
          { sessionId: session.sessionId, studentId: "student-1", position: near },
          role,
          "student-1",
        ),
      );

      expect(result.attendance).toMatchObject({
        method: "self",
        state: "attended",
        studentId: "student-1",
        occurredAt: "2099-09-01T17:30:00.000Z",
      });
      expect(recorded).toHaveBeenCalledWith(
        "demo-academy",
        expect.any(Object),
        "student-1",
        undefined,
        role,
        null,
      );
      expect(JSON.stringify(result)).not.toMatch(/49\.18|-2\.107|latitude|longitude/u);
    },
  );

  it.each(["adultStudent", "teenStudent", "guardian"] as const)(
    "refuses a foreign student scope for a %s member without echoing coordinates",
    async (role) => {
      const { store, session } = await seeded();
      const handler = createSelfCheckInHandler({
        store,
        resolveClientStudentScope: ownStudentScope,
      });

      await expect(
        handler(
          fakeRequest(
            { sessionId: session.sessionId, studentId: "student-1", position: near },
            role,
            "other-student",
          ),
        ),
      ).rejects.toMatchObject({
        code: "permission-denied",
        message: expect.not.stringMatching(/49\.18|-2\.107/u),
      });
    },
  );

  it("requires authentication and refuses every staff role", async () => {
    const { store, session } = await seeded();
    const handler = createSelfCheckInHandler({ store, resolveClientStudentScope: ownStudentScope });
    const input = { sessionId: session.sessionId, studentId: "student-1", position: near };

    await expect(handler(fakeRequest(input, "adultStudent", null))).rejects.toMatchObject({
      code: "unauthenticated",
      message: expect.not.stringMatching(/49\.18|-2\.107/u),
    });
    for (const role of ["owner", "administrator", "headCoach", "coach"]) {
      await expect(handler(fakeRequest(input, role, "staff-1"))).rejects.toMatchObject({
        code: "permission-denied",
      });
    }
  });

  it("rejects malformed and extra input before the store, then maps raw 100.4 m accuracy", async () => {
    const { store, session } = await seeded();
    const recordSelfCheckIn = vi.fn(store.recordSelfCheckIn);
    const handler = createSelfCheckInHandler({
      store: { ...store, recordSelfCheckIn },
      resolveClientStudentScope: ownStudentScope,
    });
    const input = { sessionId: session.sessionId, studentId: "student-1", position: near };

    for (const invalid of [
      { ...input, extra: true },
      { ...input, position: { ...near, latitude: "49" } },
    ]) {
      await expect(
        handler(fakeRequest(invalid, "adultStudent", "student-1")),
      ).rejects.toMatchObject({
        code: "invalid-argument",
        message: expect.not.stringMatching(/49\.18|-2\.107/u),
      });
    }
    expect(recordSelfCheckIn).not.toHaveBeenCalled();
    await expect(
      handler(
        fakeRequest(
          { ...input, position: { ...near, accuracyMeters: 100.4 } },
          "adultStudent",
          "student-1",
        ),
      ),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      details: { reason: "imprecise" },
    });
    expect(recordSelfCheckIn).toHaveBeenCalledOnce();
  });

  it("maps every domain refusal to safe failed-precondition details", async () => {
    const { store, session } = await seeded();
    const handler = createSelfCheckInHandler({ store, resolveClientStudentScope: ownStudentScope });
    const attempt = (sessionId = session.sessionId, position = near) =>
      handler(
        fakeRequest({ sessionId, studentId: "student-1", position }, "adultStudent", "student-1"),
      );

    await expect(attempt(session.sessionId, far)).rejects.toMatchObject({
      code: "failed-precondition",
      details: { reason: "outside", distanceMeters: 120 },
    });
    await expect(
      attempt(session.sessionId, { ...near, accuracyMeters: 101 }),
    ).rejects.toMatchObject({
      details: { reason: "imprecise" },
    });
    await store.saveLocationGeofence(
      "demo-academy",
      { locationId: "town", geofence: null },
      "owner-1",
    );
    await expect(attempt()).rejects.toMatchObject({ details: { reason: "site_not_ready" } });
    await store.saveLocationGeofence(
      "demo-academy",
      { locationId: "town", geofence: town },
      "owner-1",
    );
    const unbooked = await store.createSession(
      "demo-academy",
      {
        programId: "adult-fundamentals",
        locationId: "town",
        instructorId: "coach-1",
        title: "Unbooked Class",
        startAt: "2099-09-01T18:05:00Z",
        endAt: "2099-09-01T19:05:00Z",
        capacity: 25,
      },
      "owner-1",
    );
    await expect(attempt(unbooked.sessionId)).rejects.toMatchObject({
      details: { reason: "not_booked" },
    });
    vi.setSystemTime(new Date("2099-09-01T18:21:00Z"));
    await expect(attempt()).rejects.toMatchObject({ details: { reason: "window_closed" } });
    vi.setSystemTime(new Date("2099-09-01T17:30:00Z"));
    await store.recordCheckIn(
      "demo-academy",
      { sessionId: session.sessionId, studentId: "student-1", method: "manual" },
      "coach-1",
      undefined,
      "coach",
    );
    await expect(attempt()).rejects.toMatchObject({ details: { reason: "already_checked_in" } });
    await expect(attempt(session.sessionId, far)).rejects.not.toThrow(/49\.18|-2\.107/u);
  });

  it("logs only a constant safe message for an unexpected coordinate-bearing error", async () => {
    const { store, session } = await seeded();
    const handler = createSelfCheckInHandler({
      store: {
        ...store,
        recordSelfCheckIn: async () => {
          throw new Error("database failed at 49.184224,-2.107142");
        },
      },
      resolveClientStudentScope: ownStudentScope,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      handler(
        fakeRequest(
          { sessionId: session.sessionId, studentId: "student-1", position: near },
          "adultStudent",
          "student-1",
        ),
      ),
    ).rejects.toMatchObject({
      code: "internal",
      message: expect.not.stringMatching(/49\.18|-2\.107/u),
    });
    expect(errorSpy).toHaveBeenCalledExactlyOnceWith("self check-in failed");
    errorSpy.mockRestore();
  });

  it("exports selfCheckIn with the shared App Check options", async () => {
    const callables = await import("./schedule-callables");
    expect(typeof callables.selfCheckIn).toBe("function");
    expect(scheduleCallableOptions).toMatchObject({
      enforceAppCheck: true,
      consumeAppCheckToken: true,
    });
  });
});

describe("saveLocationGeofence (T109)", () => {
  const geofence = { latitude: 49.186, longitude: -2.106 };

  it("accepts the reported town geofence through its dedicated callable, not updateLocation", async () => {
    const store = createInMemoryScheduleStore();
    const payload = {
      locationId: "town",
      geofence: { latitude: 49.183998, longitude: -2.107137 },
    };
    await expect(
      createSaveLocationGeofenceHandler({ store })(fakeRequest(payload)),
    ).resolves.toMatchObject({
      location: payload,
    });
    await expect(
      createUpdateLocationHandler({ store })(fakeRequest(payload)),
    ).rejects.toMatchObject({
      code: "invalid-argument",
      message: "Location update accepts locationId, name, abbreviation, kind and active",
    });
  });

  it.each(["", "T", "T!", "A".repeat(13)])(
    "rejects invalid location abbreviation %j independently of coordinates",
    async (abbreviation) => {
      const handler = createUpdateLocationHandler({ store: createInMemoryScheduleStore() });
      await expect(
        handler(fakeRequest({ locationId: "town", name: "BPT Town", abbreviation })),
      ).rejects.toMatchObject({
        code: "invalid-argument",
        message: "abbreviation must be 2–12 letters, digits, '_' or '-'",
      });
    },
  );

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

  it("refuses a blank site, a coarse coordinate and an extra key", async () => {
    const handler = createSaveLocationGeofenceHandler({ store: createInMemoryScheduleStore() });
    for (const payload of [
      { locationId: "", geofence },
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
      fakeRequest({ studentId: "student-1" }, "adultStudent", "student-1"),
    )) as { attendance: readonly Record<string, unknown>[] };
    expect(own.attendance).toHaveLength(1);
    expect(own.attendance[0]).not.toHaveProperty("proximity");
    expect(JSON.stringify(own.attendance)).not.toContain("drifted");

    const history = (await createListAttendanceHistoryHandler(scope)(
      fakeRequest({ sessionId, studentId: "student-1" }, "adultStudent", "student-1"),
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

describe("reconcileSessionQuorum (T110)", () => {
  async function sessionStartingIn(
    store: ReturnType<typeof createInMemoryScheduleStore>,
    milliseconds: number,
    minParticipants = 4,
  ) {
    const startAt = new Date(Date.now() + milliseconds);
    const created = (await createSaveSessionHandler({ store })(
      fakeRequest({
        classId: null,
        programId: "adult-fundamentals",
        locationId: "town",
        instructorId: "coach-1",
        title: "Quorum Town",
        startAt: startAt.toISOString(),
        endAt: new Date(startAt.getTime() + 3_600_000).toISOString(),
        capacity: 10,
        minParticipants,
      }),
    )) as { session: { sessionId: string } };
    return created.session.sessionId;
  }

  it("cancels a session below its minimum once the cutoff has passed, and repeats safely", async () => {
    const store = createInMemoryScheduleStore();
    // Thirty minutes ahead: inside the one-hour cutoff.
    const sessionId = await sessionStartingIn(store, 30 * 60_000);
    const handler = createReconcileSessionQuorumHandler({ store });

    const first = (await handler(fakeRequest({ sessionId }))) as {
      result: { outcome: string; releasedBookings: number };
    };
    expect(first.result).toMatchObject({ outcome: "cancelled", releasedBookings: 0 });

    const repeat = (await handler(fakeRequest({ sessionId }))) as { result: { outcome: string } };
    expect(repeat.result.outcome).toBe("alreadyCancelledForQuorum");
  });

  it("leaves a session alone while it is still open for booking", async () => {
    const store = createInMemoryScheduleStore();
    const sessionId = await sessionStartingIn(store, 3 * 3_600_000);

    const result = (await handlerFor(store)(fakeRequest({ sessionId }))) as {
      result: { outcome: string };
    };
    expect(result.result.outcome).toBe("beforeCutoff");
  });

  it("leaves a session alone when its minimum is zero", async () => {
    const store = createInMemoryScheduleStore();
    const sessionId = await sessionStartingIn(store, 30 * 60_000, 0);

    const result = (await handlerFor(store)(fakeRequest({ sessionId }))) as {
      result: { outcome: string };
    };
    expect(result.result.outcome).toBe("quorumMet");
  });

  it.each(["guardian", "adultStudent"])("refuses %s", async (role) => {
    const store = createInMemoryScheduleStore();
    const sessionId = await sessionStartingIn(store, 30 * 60_000);
    await expect(handlerFor(store)(fakeRequest({ sessionId }, role))).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("refuses a malformed payload and an unknown session", async () => {
    const store = createInMemoryScheduleStore();
    for (const payload of [null, {}, { sessionId: "" }, { sessionId: "s-1", extra: true }]) {
      await expect(handlerFor(store)(fakeRequest(payload))).rejects.toMatchObject({
        code: "invalid-argument",
      });
    }
    await expect(
      handlerFor(store)(fakeRequest({ sessionId: "session-absent" })),
    ).rejects.toMatchObject({ code: "not-found" });
  });
});

function handlerFor(store: ReturnType<typeof createInMemoryScheduleStore>) {
  return createReconcileSessionQuorumHandler({ store });
}

describe("session update, class removal and booked counts callables", () => {
  const classInput = {
    programId: "program-1" as const,
    locationId: "town" as const,
    name: "Kids BJJ",
    recurrenceRules: [{ dayOfWeek: 1 as const, startTime: "17:00", durationMinutes: 60 }],
    instructorIds: ["coach-a"],
    capacity: 20,
  };

  it("lets a head coach edit a scheduled session and refuses a coach", async () => {
    const store = createInMemoryScheduleStore();
    const session = await store.createSession(
      "demo-academy",
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
    const handler = createUpdateSessionHandler({ store });
    const result = await handler(
      fakeRequest({ sessionId: session.sessionId, title: "Adults Gi" }, "headCoach"),
    );
    expect(result.session.title).toBe("Adults Gi");
    await expect(
      handler(fakeRequest({ sessionId: session.sessionId, title: "X" }, "coach")),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      handler(fakeRequest({ sessionId: session.sessionId }, "owner")),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("removes a class for a manager and reports the cancelled sessions", async () => {
    const store = createInMemoryScheduleStore();
    const created = await store.createClass("demo-academy", classInput, "owner-1");
    await store.generateSessions(
      "demo-academy",
      created.classId,
      "2099-01-04",
      "2099-01-10",
      "Europe/Jersey",
      "owner-1",
    );
    const handler = createRemoveClassHandler({ store, now: () => "2099-01-01T00:00:00.000Z" });
    const result = await handler(
      fakeRequest({ classId: created.classId, reason: "Coach left" }, "administrator"),
    );
    expect(result.class.active).toBe(false);
    expect(result.cancelledSessions).toHaveLength(1);
    await expect(
      handler(fakeRequest({ classId: created.classId, reason: "Coach left" }, "coach")),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("returns booked counts for any signed-in user and rejects anonymous calls", async () => {
    const store = createInMemoryScheduleStore();
    const session = await store.createSession(
      "demo-academy",
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
      "demo-academy",
      { sessionId: session.sessionId, studentId: "s-1", membershipId: "m-1" },
      "s-1",
    );
    const handler = createListSessionBookedCountsHandler({ store });
    const result = await handler(
      fakeRequest(
        { from: "2099-01-01T00:00:00.000Z", to: "2099-01-31T00:00:00.000Z" },
        "adultStudent",
        "s-1",
      ),
    );
    expect(result.counts).toEqual({ [session.sessionId]: 1 });
    await expect(
      handler(
        fakeRequest(
          { from: "2099-01-01T00:00:00.000Z", to: "2099-01-31T00:00:00.000Z" },
          "owner",
          null,
        ),
      ),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("keeps historical session editing restricted for legacy head coaches", async () => {
    const store = createInMemoryScheduleStore();
    const session = await store.createSession(
      "demo-academy",
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
    await store.cancelSession("demo-academy", session.sessionId, "Test cancellation", "owner-1");
    const handler = createUpdateSessionHandler({ store });
    await expect(
      handler(fakeRequest({ sessionId: session.sessionId, title: "New Title" }, "headCoach")),
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });

  it("rejects updateSession on unknown session with not-found", async () => {
    const store = createInMemoryScheduleStore();
    const handler = createUpdateSessionHandler({ store });
    await expect(
      handler(fakeRequest({ sessionId: "unknown-session", title: "New Title" }, "owner")),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("rejects removeClass on unknown class with not-found", async () => {
    const store = createInMemoryScheduleStore();
    const handler = createRemoveClassHandler({ store });
    await expect(
      handler(fakeRequest({ classId: "unknown-class", reason: "Coach left" }, "administrator")),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("maps unexpected store failures to internal with console.error logged", async () => {
    const store = {
      ...createInMemoryScheduleStore(),
      removeClass: async () => {
        throw new Error("socket hang up");
      },
    };
    const handler = createRemoveClassHandler({ store });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      handler(fakeRequest({ classId: "c-1", reason: "Coach left" }, "administrator")),
    ).rejects.toMatchObject({ code: "internal" });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe("classes-services callables", () => {
  it("creates and updates a location for managers only", async () => {
    const store = createInMemoryScheduleStore();
    const save = createSaveLocationHandler({ store });
    const created = await save(
      fakeRequest({ name: "Salle Ouest", abbreviation: "ouest", kind: "presential" }, "headCoach"),
    );
    expect(created.location.locationId).toBe("salle-ouest");
    await expect(
      save(fakeRequest({ name: "X Y", abbreviation: "xy", kind: "zoom" }, "coach")),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(save(fakeRequest({ name: "X" }, "owner"))).rejects.toMatchObject({
      code: "invalid-argument",
    });
    const updated = await createUpdateLocationHandler({ store })(
      fakeRequest({ locationId: "salle-ouest", active: false }, "administrator"),
    );
    expect(updated.location.active).toBe(false);
    await expect(
      createUpdateLocationHandler({ store })(
        fakeRequest({ locationId: "salle-ouest", active: false }, "coach"),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      createUpdateLocationHandler({ store })(
        fakeRequest({ locationId: "nope", active: false }, "owner"),
      ),
    ).rejects.toMatchObject({ code: "not-found", message: "Location not found" });
  });

  it("saves a v2 program from name and abbreviation and updates its fields", async () => {
    const store = createInMemoryScheduleStore();
    const saved = await createSaveProgramHandler({ store })(
      fakeRequest({ name: "GI Beginners Mornings", abbreviation: "BEG_MOR" }, "owner"),
    );
    expect(saved.program.abbreviation).toBe("BEG_MOR");
    const updated = await createUpdateProgramHandler({ store })(
      fakeRequest({ programId: saved.program.programId, colour: "#D9D7FF" }, "owner"),
    );
    expect(updated.program.colour).toBe("#D9D7FF");
    await expect(
      createUpdateProgramHandler({ store })(
        fakeRequest({ programId: "nope", colour: "#D9D7FF" }, "owner"),
      ),
    ).rejects.toMatchObject({ code: "not-found", message: "Program not found" });
    await expect(
      createUpdateProgramHandler({ store })(
        fakeRequest({ programId: saved.program.programId, colour: "#D9D7FF" }, "coach"),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      createSaveProgramHandler({ store })(
        fakeRequest({ name: "Bad Abbreviation", abbreviation: "" }, "owner"),
      ),
    ).rejects.toMatchObject({
      code: "invalid-argument",
      message: expect.stringMatching(/abbreviation/),
    });
  });

  it("previews, copies and deletes a week", async () => {
    const store = createInMemoryScheduleStore();
    await createSaveSessionHandler({ store })(
      fakeRequest(
        {
          programId: "open-mat",
          locationId: "town",
          instructorId: "coach-1",
          title: "Open Mat",
          startAt: "2026-09-14T17:00:00.000Z",
          endAt: "2026-09-14T18:00:00.000Z",
          capacity: 20,
          minParticipants: 0,
        },
        "owner",
      ),
    );
    const preview = await createPreviewWeekHandler({ store })(
      fakeRequest({ weekStart: "2026-09-14" }, "owner"),
    );
    expect(preview.preview.count).toBe(1);
    await expect(
      createPreviewWeekHandler({ store })(fakeRequest({ weekStart: "2026-09-14" }, "coach")),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      createPreviewWeekHandler({ store })(fakeRequest({ weekStart: "2026-09-16" }, "owner")),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    const copied = await createCopyWeekHandler({ store })(
      fakeRequest(
        { fromWeekStart: "2026-09-14", toWeekStart: "2026-09-21", copyBookings: false },
        "owner",
      ),
    );
    expect(copied.sessions).toHaveLength(1);
    const deleted = await createDeleteWeekHandler({ store })(
      fakeRequest({ weekStart: "2026-09-21", reason: "Closed" }, "owner"),
    );
    expect(deleted.sessions[0]?.status).toBe("cancelled");
    await expect(
      createCopyWeekHandler({ store })(
        fakeRequest(
          { fromWeekStart: "2026-09-14", toWeekStart: "2026-09-21", copyBookings: false },
          "coach",
        ),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      createDeleteWeekHandler({ store })(
        fakeRequest({ weekStart: "2026-09-16", reason: "Closed" }, "owner"),
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      createDeleteWeekHandler({ store })(
        fakeRequest({ weekStart: "2026-09-21", reason: "Closed" }, "coach"),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("answers failed-precondition when the source week holds a session without capacity", async () => {
    const store = createInMemoryScheduleStore();
    vi.spyOn(store, "copyWeek").mockRejectedValue(
      new Error("Every session in the source week needs a capacity before it can be copied"),
    );
    await expect(
      createCopyWeekHandler({ store })(
        fakeRequest(
          { fromWeekStart: "2026-09-14", toWeekStart: "2026-09-21", copyBookings: false },
          "owner",
        ),
      ),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      message: "Every session in the source week needs a capacity before it can be copied",
      details: { reason: "capacity-not-set" },
    });
  });
  it("hands the caller address to the store for a check-in, a booking and a cancellation", async () => {
    const store = createInMemoryScheduleStore();
    const checkIn = vi.spyOn(store, "recordCheckIn").mockResolvedValue({} as never);
    const book = vi.spyOn(store, "requestBooking").mockResolvedValue({} as never);
    const cancel = vi.spyOn(store, "cancelBooking").mockResolvedValue({} as never);
    const forwarded = (data: unknown, role: string, uid: string) => {
      const request = fakeRequest(data, role, uid) as unknown as Record<string, unknown>;
      request.rawRequest = { headers: { "x-forwarded-for": "82.112.144.10, 10.0.0.1" } };
      return request as never;
    };

    await createCheckInHandler({ store })(
      forwarded(
        { sessionId: "session-1", studentId: "student-1", method: "manual" },
        "coach",
        "coach-1",
      ),
    );
    await createRequestBookingHandler({ store, resolveClientStudentScope: ownStudentScope })(
      forwarded(
        { sessionId: "session-1", studentId: "student-1", membershipId: "membership-1" },
        "adultStudent",
        "student-1",
      ),
    );
    await createCancelBookingHandler({ store, resolveClientStudentScope: ownStudentScope })(
      forwarded(
        { sessionId: "session-1", studentId: "student-1", reason: "Cannot make it" },
        "adultStudent",
        "student-1",
      ),
    );

    expect(checkIn.mock.calls[0]).toEqual([
      "demo-academy",
      { sessionId: "session-1", studentId: "student-1", method: "manual" },
      "coach-1",
      undefined,
      "coach",
      "82.112.144.10",
    ]);
    expect(book.mock.calls[0]?.[3]).toEqual({ ip: "82.112.144.10", role: "adultStudent" });
    expect(cancel.mock.calls[0]?.[4]).toEqual({ ip: "82.112.144.10", role: "adultStudent" });
  });
});

describe("weekly repetition callable boundaries", () => {
  const input = {
    programId: "adult-fundamentals",
    locationId: "town",
    instructorId: "coach-1",
    title: "Weekly class",
    startAt: "2026-10-19T17:00:00.000Z",
    endAt: "2026-10-19T18:00:00.000Z",
    capacity: 12,
    minParticipants: 2,
    repeatWeekly: true,
  };
  it("persists the requested recurrence and scope through the existing callables", async () => {
    const store = createInMemoryScheduleStore();
    const { session } = await createSaveSessionHandler({ store })(fakeRequest(input));
    expect(session.repeatWeekly).toBe(true);
    const { session: stopped } = await createUpdateSessionHandler({ store })(
      fakeRequest({ sessionId: session.sessionId, repeatWeekly: false, repeatScope: "following" }),
    );
    expect(stopped.repeatWeekly).toBe(false);
    expect(stopped.status).toBe("scheduled");
  });
  it("keeps recurrence writes manager-only and rejects invalid scope", async () => {
    const store = createInMemoryScheduleStore();
    await expect(
      createSaveSessionHandler({ store })(fakeRequest(input, "member")),
    ).rejects.toMatchObject({ code: "permission-denied" });
    const { session } = await createSaveSessionHandler({ store })(fakeRequest(input));
    await expect(
      createUpdateSessionHandler({ store })(
        fakeRequest(
          { sessionId: session.sessionId, repeatWeekly: false, repeatScope: "following" },
          "coach",
        ),
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      createUpdateSessionHandler({ store })(
        fakeRequest({ sessionId: session.sessionId, repeatWeekly: false, repeatScope: "all" }),
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      createUpdateSessionHandler({ store })(
        fakeRequest({ sessionId: session.sessionId, repeatWeekly: false }),
      ),
    ).rejects.toMatchObject({ code: "failed-precondition" });
  });
});

describe("unrestricted office session management", () => {
  it("keeps office fields protected from legacy head coaches", async () => {
    const store = createInMemoryScheduleStore();
    const handler = createUpdateSessionHandler({ store });
    for (const field of ["locationId", "programId"]) {
      await expect(
        handler(fakeRequest({ sessionId: "session", [field]: "new-value" }, "headCoach")),
      ).rejects.toMatchObject({ code: "permission-denied" });
    }
  });
  it.each(["active", "completed"] as const)(
    "allows office correction of a %s session without changing status or academy",
    async (status) => {
      const store = createInMemoryScheduleStore();
      const record = await store.createSession(
        "demo-academy",
        {
          programId: "gi",
          locationId: "town",
          instructorId: "coach",
          title: "Synthetic class",
          startAt: "2020-01-01T10:00:00.000Z",
          endAt: "2020-01-01T11:00:00.000Z",
          capacity: 20,
        },
        "owner",
      );
      await store.__seedSessionId!("demo-academy", { ...record, status }, record.sessionId);
      const update = createUpdateSessionHandler({ store });
      for (const role of ["owner", "administrator"]) {
        const result = await update(
          fakeRequest({ sessionId: record.sessionId, title: `Corrected by ${role}` }, role),
        );
        expect(result.session).toMatchObject({ status, updatedBy: "user-1" });
      }
      await expect(
        update(
          fakeRequest(
            { sessionId: record.sessionId, title: "Spoofed", allowHistorical: true },
            "headCoach",
          ),
        ),
      ).rejects.toMatchObject({ code: "failed-precondition" });
      await expect(
        update(
          fakeRequest(
            { sessionId: record.sessionId, title: "Foreign" },
            "owner",
            "other-owner",
            "other-academy",
          ),
        ),
      ).rejects.toMatchObject({ code: "not-found" });
    },
  );
  it.each(["owner", "administrator"])(
    "allows %s repeated creation, historical editing and cancellation with history intact",
    async (role) => {
      const store = createInMemoryScheduleStore();
      const create = createSaveSessionHandler({ store });
      const update = createUpdateSessionHandler({ store });
      const cancel = createCancelSessionHandler({ store });
      const ids = new Set<string>();
      for (let i = 0; i < 450; i++) {
        const { session } = await create(
          fakeRequest(
            {
              programId: "gi",
              locationId: "town",
              instructorId: "coach",
              title: "Synthetic class",
              startAt: "2020-01-01T10:00:00.000Z",
              endAt: "2020-01-01T11:00:00.000Z",
              capacity: 20,
            },
            role,
          ),
        );
        ids.add(session.sessionId);
        await cancel(
          fakeRequest({ sessionId: session.sessionId, reason: "Removed by office" }, role),
        );
        const result = await update(
          fakeRequest(
            {
              sessionId: session.sessionId,
              title: "Corrected history",
              programId: "nogi",
              locationId: "west",
            },
            role,
          ),
        );
        expect(result.session).toMatchObject({
          status: "cancelled",
          title: "Corrected history",
          programId: "nogi",
          locationId: "west",
          cancellationReason: "Removed by office",
        });
        expect(await store.getSession("demo-academy", session.sessionId)).not.toBeNull();
      }
      expect(ids.size).toBe(450);
    },
  );
});

describe("bulk eligible booking", () => {
  it("books uncovered membership sessions and skips confirmed sessions", async () => {
    const base = createInMemoryScheduleStore();
    const session = (sessionId: string) =>
      ({
        sessionId,
        academyId: "demo-academy",
        classId: null,
        programId: "adult-bjj",
        locationId: "town",
        instructorId: "coach-1",
        title: "Adults BJJ",
        startAt: "2099-09-10T18:00:00.000Z",
        endAt: "2099-09-10T19:00:00.000Z",
        capacity: 20,
        minParticipants: 0,
        status: "scheduled",
        isSeminar: false,
        cancellationReason: null,
        accessMode: "membership",
        schemaVersion: "1",
        createdAt: "2099-01-01T00:00:00.000Z",
        createdBy: "owner-1",
        updatedAt: "2099-01-01T00:00:00.000Z",
        updatedBy: "owner-1",
      }) as const;
    const requestBooking = vi.fn().mockImplementation(async (_academyId, input) => ({
      bookingId: `booking-${input.sessionId}`,
      academyId: "demo-academy",
      sessionId: input.sessionId,
      studentId: input.studentId,
      membershipId: input.membershipId,
      status: "confirmed",
      requestedAt: "2099-09-01T00:00:00.000Z",
      cancelledAt: null,
      cancellationReason: null,
      schemaVersion: "1",
      createdAt: "2099-09-01T00:00:00.000Z",
      createdBy: "owner-1",
      updatedAt: "2099-09-01T00:00:00.000Z",
      updatedBy: "owner-1",
    }));
    const store = {
      ...base,
      listSessions: vi.fn().mockResolvedValue([session("session-1"), session("session-2")]),
      listStudentBookings: vi.fn().mockResolvedValue([
        {
          sessionId: "session-1",
          status: "confirmed",
        },
      ]),
      requestBooking,
    };
    const result = await createBulkBookEligibleSessionsHandler({ store })(
      fakeRequest(
        {
          studentId: "student-1",
          membershipId: "membership-1",
          from: "2099-09-01T00:00:00.000Z",
          to: "2099-09-30T00:00:00.000Z",
        },
        "owner",
        "owner-1",
      ),
    );
    expect(result).toMatchObject({
      bookedCount: 1,
      alreadyBookedCount: 1,
      skippedCount: 0,
      limited: false,
    });
    expect(requestBooking).toHaveBeenCalledTimes(1);
    expect(requestBooking.mock.calls[0]?.[1]).toMatchObject({
      kind: "membership",
      sessionId: "session-2",
      studentId: "student-1",
      membershipId: "membership-1",
    });
  });
});
