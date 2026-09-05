import { describe, expect, it } from "vitest";

import {
  buildAttendanceId,
  buildDailyOperationsDashboard,
  buildBookingId,
  buildBookingIdCandidates,
  buildBookingIdV2,
  buildCheckoutId,
  buildCorrectionAttendanceId,
  buildLegacyBookingId,
  buildSessionOperationalView,
  determinePunctuality,
  evaluateBookingEligibility,
  generateSessionsFromClass,
  isWithinBookingCutoff,
  parseCancelBookingInput,
  parseCheckInInput,
  parseCheckInProximityMeasurement,
  parseCorrectAttendanceInput,
  parseCreateClassInput,
  parseCreateProgramInput,
  parseCreateSessionInput,
  parseListSessionsQuery,
  parseRecordCheckoutInput,
  parseRecurrenceRule,
  parseRequestBookingInput,
  parseSaveLocationGeofenceInput,
  decideQuorumSweep,
  quorumCancellationReason,
  resolveCheckInProximity,
  checkInProximityRadiusMeters,
  distanceInMetres,
  type ClassRecord,
  type SessionOperationalView,
} from "./schedule-contracts";

describe("Schedule Domain Contracts", () => {
  describe("parseRecurrenceRule", () => {
    it("accepts valid weekly recurrence rule", () => {
      const valid = {
        dayOfWeek: 1, // Monday
        startTime: "18:30",
        durationMinutes: 60,
      };

      const result = parseRecurrenceRule(valid);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.dayOfWeek).toBe(1);
        expect(result.value.startTime).toBe("18:30");
        expect(result.value.durationMinutes).toBe(60);
      }
    });

    it("rejects invalid dayOfWeek (< 1 or > 7)", () => {
      expect(
        parseRecurrenceRule({ dayOfWeek: 0, startTime: "18:00", durationMinutes: 60 }).ok,
      ).toBe(false);
      expect(
        parseRecurrenceRule({ dayOfWeek: 8, startTime: "18:00", durationMinutes: 60 }).ok,
      ).toBe(false);
    });

    it("rejects invalid time formats", () => {
      expect(
        parseRecurrenceRule({ dayOfWeek: 1, startTime: "24:00", durationMinutes: 60 }).ok,
      ).toBe(false);
      expect(
        parseRecurrenceRule({ dayOfWeek: 1, startTime: "6:00pm", durationMinutes: 60 }).ok,
      ).toBe(false);
      expect(
        parseRecurrenceRule({ dayOfWeek: 1, startTime: "18:60", durationMinutes: 60 }).ok,
      ).toBe(false);
    });

    it("rejects out of bounds durationMinutes", () => {
      expect(
        parseRecurrenceRule({ dayOfWeek: 1, startTime: "18:00", durationMinutes: 10 }).ok,
      ).toBe(false);
      expect(
        parseRecurrenceRule({ dayOfWeek: 1, startTime: "18:00", durationMinutes: 500 }).ok,
      ).toBe(false);
    });
  });

  describe("parseCreateClassInput", () => {
    it("accepts valid class template input", () => {
      const input = {
        programId: "adult-bjj",
        locationId: "town",
        name: "Adult Fundamentals Town",
        recurrenceRule: {
          dayOfWeek: 2,
          startTime: "19:00",
          durationMinutes: 60,
        },
        instructorIds: ["coach-1", "coach-2"],
        capacity: 25,
        minParticipants: 4,
      };

      const result = parseCreateClassInput(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("Adult Fundamentals Town");
        expect(result.value.locationId).toBe("town");
        expect(result.value.capacity).toBe(25);
        expect(result.value.minParticipants).toBe(4);
      }
    });

    it("rejects invalid location", () => {
      const input = {
        programId: "adult-bjj",
        locationId: "invalid-loc",
        name: "Adult Fundamentals",
        recurrenceRule: { dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 },
        instructorIds: ["coach-1"],
        capacity: 20,
      };
      expect(parseCreateClassInput(input).ok).toBe(false);
    });

    it("rejects empty instructor array", () => {
      const input = {
        programId: "adult-bjj",
        locationId: "west",
        name: "Adult Fundamentals",
        recurrenceRule: { dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 },
        instructorIds: [],
        capacity: 20,
      };
      expect(parseCreateClassInput(input).ok).toBe(false);
    });

    it("rejects capacity < 1 or minParticipants > capacity", () => {
      expect(
        parseCreateClassInput({
          programId: "adult-bjj",
          locationId: "town",
          name: "Adult Class",
          recurrenceRule: { dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 },
          instructorIds: ["coach-1"],
          capacity: 0,
        }).ok,
      ).toBe(false);

      expect(
        parseCreateClassInput({
          programId: "adult-bjj",
          locationId: "town",
          name: "Adult Class",
          recurrenceRule: { dayOfWeek: 1, startTime: "18:00", durationMinutes: 60 },
          instructorIds: ["coach-1"],
          capacity: 10,
          minParticipants: 15,
        }).ok,
      ).toBe(false);
    });
  });

  describe("parseCreateSessionInput", () => {
    it("accepts valid session input", () => {
      const input = {
        classId: "class-123",
        programId: "adult-bjj",
        locationId: "town",
        instructorId: "coach-1",
        title: "Adult Fundamentals Class",
        startAt: "2026-09-01T18:00:00Z",
        endAt: "2026-09-01T19:00:00Z",
        capacity: 20,
        minParticipants: 4,
        isSeminar: false,
      };

      const result = parseCreateSessionInput(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe("Adult Fundamentals Class");
        expect(result.value.startAt).toBe("2026-09-01T18:00:00Z");
        expect(result.value.endAt).toBe("2026-09-01T19:00:00Z");
      }
    });

    it("rejects endAt before or equal to startAt", () => {
      const input = {
        programId: "adult-bjj",
        locationId: "town",
        instructorId: "coach-1",
        title: "Session",
        startAt: "2026-09-01T19:00:00Z",
        endAt: "2026-09-01T18:00:00Z",
        capacity: 20,
      };
      expect(parseCreateSessionInput(input).ok).toBe(false);
    });

    it("rejects non-ISO date strings", () => {
      const input = {
        programId: "adult-bjj",
        locationId: "town",
        instructorId: "coach-1",
        title: "Session",
        startAt: "2026-09-01 18:00",
        endAt: "2026-09-01 19:00",
        capacity: 20,
      };
      expect(parseCreateSessionInput(input).ok).toBe(false);
    });
  });

  describe("parseListSessionsQuery", () => {
    it("accepts valid date range query", () => {
      const query = {
        from: "2026-09-01T00:00:00Z",
        to: "2026-09-07T23:59:59Z",
        locationId: "town",
      };

      const result = parseListSessionsQuery(query);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.locationId).toBe("town");
      }
    });

    it("rejects range > 90 days", () => {
      const query = {
        from: "2026-01-01T00:00:00Z",
        to: "2026-06-01T00:00:00Z",
      };
      expect(parseListSessionsQuery(query).ok).toBe(false);
    });

    it("rejects to < from", () => {
      const query = {
        from: "2026-09-07T00:00:00Z",
        to: "2026-09-01T00:00:00Z",
      };
      expect(parseListSessionsQuery(query).ok).toBe(false);
    });
  });

  describe("parseCreateProgramInput", () => {
    it("accepts valid program input with all fields", () => {
      const input = {
        name: "BJJ Fundamentals Adults",
        ageBand: "adult",
        discipline: "bjj",
        level: "fundamentals",
      };
      const result = parseCreateProgramInput(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("BJJ Fundamentals Adults");
        expect(result.value.ageBand).toBe("adult");
        expect(result.value.discipline).toBe("bjj");
        expect(result.value.level).toBe("fundamentals");
      }
    });

    it("rejects empty name", () => {
      const input = { name: "", ageBand: "adult", discipline: "bjj", level: "all-levels" };
      expect(parseCreateProgramInput(input).ok).toBe(false);
    });

    it("rejects invalid ageBand", () => {
      const input = { name: "Test", ageBand: "baby", discipline: "bjj", level: "all-levels" };
      expect(parseCreateProgramInput(input).ok).toBe(false);
    });

    it("rejects invalid discipline", () => {
      const input = { name: "Test", ageBand: "adult", discipline: "yoga", level: "all-levels" };
      expect(parseCreateProgramInput(input).ok).toBe(false);
    });

    it("rejects invalid level", () => {
      const input = { name: "Test", ageBand: "adult", discipline: "bjj", level: "pro" };
      expect(parseCreateProgramInput(input).ok).toBe(false);
    });

    it("trims and validates name length between 2 and 100", () => {
      const tooShort = { name: "A", ageBand: "adult", discipline: "bjj", level: "all-levels" };
      expect(parseCreateProgramInput(tooShort).ok).toBe(false);

      const trimmed = { name: "  OK  ", ageBand: "adult", discipline: "bjj", level: "all-levels" };
      const result = parseCreateProgramInput(trimmed);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("OK");
      }
    });
  });

  describe("generateSessionsFromClass", () => {
    const baseClass: ClassRecord = Object.freeze({
      classId: "cls-001",
      academyId: "academy-1",
      programId: "prog-adult-bjj",
      locationId: "town",
      name: "Adult Fundamentals",
      recurrenceRule: Object.freeze({
        dayOfWeek: 2, // Tuesday
        startTime: "19:00",
        durationMinutes: 60,
      }),
      instructorIds: Object.freeze(["coach-1"]),
      capacity: 25,
      minParticipants: 4,
      active: true,
      schemaVersion: "1",
      createdAt: "2026-08-01T00:00:00Z",
      createdBy: "admin-1",
      updatedAt: "2026-08-01T00:00:00Z",
      updatedBy: "admin-1",
    });

    it("generates sessions for each occurrence in a date range", () => {
      // 2026-09-01 (Tue) to 2026-09-30 (Wed) = 5 Tuesdays: 1, 8, 15, 22, 29
      const sessions = generateSessionsFromClass(
        baseClass,
        "2026-09-01",
        "2026-09-30",
        "Europe/Jersey",
      );
      expect(sessions).toHaveLength(5);
    });

    it("produces sessions with correct UTC startAt/endAt for BST (UTC+1)", () => {
      // September = BST (UTC+1), so 19:00 local = 18:00 UTC
      const sessions = generateSessionsFromClass(
        baseClass,
        "2026-09-01",
        "2026-09-08",
        "Europe/Jersey",
      );
      expect(sessions).toHaveLength(2); // Sep 1 and Sep 8
      expect(sessions[0]!.startAt).toBe("2026-09-01T18:00:00Z");
      expect(sessions[0]!.endAt).toBe("2026-09-01T19:00:00Z");
    });

    it("handles DST transition correctly (October last Sunday)", () => {
      // In 2026, DST ends on Oct 25 (last Sunday of October)
      // Before Oct 25: 19:00 BST = 18:00 UTC
      // After Oct 25: 19:00 GMT = 19:00 UTC
      const sessions = generateSessionsFromClass(
        baseClass,
        "2026-10-20",
        "2026-10-31",
        "Europe/Jersey",
      );
      expect(sessions).toHaveLength(2); // Oct 20 (Tue) and Oct 27 (Tue)
      // Oct 20 is still BST
      expect(sessions[0]!.startAt).toBe("2026-10-20T18:00:00Z");
      // Oct 27 is GMT (after DST ends Oct 25)
      expect(sessions[1]!.startAt).toBe("2026-10-27T19:00:00Z");
    });

    it("inherits capacity and minParticipants from class", () => {
      const sessions = generateSessionsFromClass(
        baseClass,
        "2026-09-01",
        "2026-09-02",
        "Europe/Jersey",
      );
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.capacity).toBe(25);
      expect(sessions[0]!.minParticipants).toBe(4);
    });

    it("generates deterministic sessionId from classId and date", () => {
      const sessions = generateSessionsFromClass(
        baseClass,
        "2026-09-01",
        "2026-09-02",
        "Europe/Jersey",
      );
      expect(sessions[0]!.sessionId).toBe("cls-001__2026-09-01");
    });

    it("returns empty array when no occurrences fall in range", () => {
      // Wednesday to Thursday — no Tuesday
      const sessions = generateSessionsFromClass(
        baseClass,
        "2026-09-03",
        "2026-09-04",
        "Europe/Jersey",
      );
      expect(sessions).toHaveLength(0);
    });

    it("marks generated sessions as scheduled with isSeminar false", () => {
      const sessions = generateSessionsFromClass(
        baseClass,
        "2026-09-01",
        "2026-09-02",
        "Europe/Jersey",
      );
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.status).toBe("scheduled");
      expect(sessions[0]!.isSeminar).toBe(false);
      expect(sessions[0]!.classId).toBe("cls-001");
    });
  });

  describe("buildBookingId", () => {
    it("creates the canonical injective v2 ID and keeps legacy lookup explicit", () => {
      const canonical = "v2:11:session-123:11:student-456";

      expect(buildBookingId(" session-123 ", " student-456 ")).toBe(canonical);
      expect(buildBookingIdV2(" session-123 ", " student-456 ")).toBe(canonical);
      expect(buildLegacyBookingId(" session-123 ", " student-456 ")).toBe(
        "session-123__student-456",
      );
      expect(buildBookingIdCandidates(" session-123 ", " student-456 ")).toEqual([
        canonical,
        "session-123__student-456",
      ]);
      expect(Object.isFrozen(buildBookingIdCandidates("session-123", "student-456"))).toBe(true);
    });

    it("does not collide when either component contains the legacy separator", () => {
      expect(buildLegacyBookingId("session__student", "one")).toBe(
        buildLegacyBookingId("session", "student__one"),
      );
      expect(buildBookingIdV2("session__student", "one")).not.toBe(
        buildBookingIdV2("session", "student__one"),
      );
      expect(buildBookingIdCandidates("session__student", "one")[1]).toBe(
        buildBookingIdCandidates("session", "student__one")[1],
      );
    });
  });

  describe("isWithinBookingCutoff (1-Hour Cutoff Rule)", () => {
    it("returns true when current time is more than 60 minutes before session start", () => {
      const sessionStart = "2026-09-01T18:00:00Z";
      const now = "2026-09-01T16:00:00Z"; // 2 hours before
      expect(isWithinBookingCutoff(sessionStart, now)).toBe(true);
    });

    it("returns true exactly 60 minutes before session start", () => {
      const sessionStart = "2026-09-01T18:00:00Z";
      const now = "2026-09-01T17:00:00Z"; // 60 minutes before
      expect(isWithinBookingCutoff(sessionStart, now)).toBe(true);
    });

    it("returns false when less than 60 minutes before session start", () => {
      const sessionStart = "2026-09-01T18:00:00Z";
      const now = "2026-09-01T17:01:00Z"; // 59 minutes before
      expect(isWithinBookingCutoff(sessionStart, now)).toBe(false);
    });

    it("returns false when session is in the past", () => {
      const sessionStart = "2026-09-01T18:00:00Z";
      const now = "2026-09-01T18:30:00Z"; // after start
      expect(isWithinBookingCutoff(sessionStart, now)).toBe(false);
    });
  });

  describe("parseRequestBookingInput & parseCancelBookingInput", () => {
    it("accepts valid request booking input", () => {
      const input = {
        sessionId: "sess-1",
        studentId: "stud-1",
        membershipId: "mem-1",
      };
      const result = parseRequestBookingInput(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sessionId).toBe("sess-1");
        expect(result.value.studentId).toBe("stud-1");
        expect(result.value.membershipId).toBe("mem-1");
      }
    });

    it("rejects missing fields in request booking input", () => {
      expect(parseRequestBookingInput({ sessionId: "sess-1", studentId: "" }).ok).toBe(false);
      expect(parseRequestBookingInput({ sessionId: "", studentId: "stud-1" }).ok).toBe(false);
    });

    it("accepts valid cancel booking input", () => {
      const input = {
        sessionId: "sess-1",
        studentId: "stud-1",
        reason: "Schedule conflict",
      };
      const result = parseCancelBookingInput(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.reason).toBe("Schedule conflict");
      }
    });

    it("rejects empty reason in cancel booking input", () => {
      expect(
        parseCancelBookingInput({
          sessionId: "sess-1",
          studentId: "stud-1",
          reason: "   ",
        }).ok,
      ).toBe(false);
    });
  });

  describe("evaluateBookingEligibility", () => {
    const baseEvaluationInput = {
      membershipStatus: "active" as const,
      planLocations: ["town", "west"] as const,
      weeklyClassesLimit: null as number | null,
      currentWeekBookingsCount: 0,
      isPayg: false,
      paygUnpaidSessionsCount: 0,
      sessionLocationId: "town" as const,
    };

    it("allows booking for active unlimited membership with matching location", () => {
      const result = evaluateBookingEligibility(baseEvaluationInput);
      expect(result.eligible).toBe(true);
    });

    it("denies booking if membership status is paused, overdue, or cancelled", () => {
      expect(
        evaluateBookingEligibility({ ...baseEvaluationInput, membershipStatus: "paused" }).eligible,
      ).toBe(false);
      expect(
        evaluateBookingEligibility({ ...baseEvaluationInput, membershipStatus: "overdue" })
          .eligible,
      ).toBe(false);
      expect(
        evaluateBookingEligibility({ ...baseEvaluationInput, membershipStatus: "cancelled" })
          .eligible,
      ).toBe(false);
    });

    it("allows booking for trial membership", () => {
      expect(
        evaluateBookingEligibility({ ...baseEvaluationInput, membershipStatus: "trial" }).eligible,
      ).toBe(true);
    });

    it("denies booking if session location is not included in plan locations", () => {
      const result = evaluateBookingEligibility({
        ...baseEvaluationInput,
        planLocations: ["west"],
        sessionLocationId: "town",
      });
      expect(result.eligible).toBe(false);
      if (!result.eligible) {
        expect(result.reason).toMatch(/Location not covered/);
      }
    });

    it("denies booking if weekly class limit reached", () => {
      const result = evaluateBookingEligibility({
        ...baseEvaluationInput,
        weeklyClassesLimit: 1,
        currentWeekBookingsCount: 1,
      });
      expect(result.eligible).toBe(false);
      if (!result.eligible) {
        expect(result.reason).toMatch(/Weekly class limit reached/);
      }
    });

    it("allows booking if under weekly class limit", () => {
      const result = evaluateBookingEligibility({
        ...baseEvaluationInput,
        weeklyClassesLimit: 2,
        currentWeekBookingsCount: 1,
      });
      expect(result.eligible).toBe(true);
    });

    it("denies PAYG student with more than 1 unpaid session", () => {
      const result = evaluateBookingEligibility({
        ...baseEvaluationInput,
        isPayg: true,
        paygUnpaidSessionsCount: 2,
      });
      expect(result.eligible).toBe(false);
      if (!result.eligible) {
        expect(result.reason).toMatch(/PAYG debt/);
      }
    });

    it("allows PAYG student with 0 or 1 unpaid session", () => {
      expect(
        evaluateBookingEligibility({
          ...baseEvaluationInput,
          isPayg: true,
          paygUnpaidSessionsCount: 0,
        }).eligible,
      ).toBe(true);

      expect(
        evaluateBookingEligibility({
          ...baseEvaluationInput,
          isPayg: true,
          paygUnpaidSessionsCount: 1,
        }).eligible,
      ).toBe(true);
    });
  });

  describe("buildAttendanceId", () => {
    it("creates deterministic canonical ID from sessionId and studentId", () => {
      expect(buildAttendanceId("session-123", "student-456")).toBe("session-123__student-456");
    });
  });

  describe("determinePunctuality", () => {
    const sessionStart = "2026-09-01T18:00:00Z";

    it("returns 'attended' when checking in before session start", () => {
      const checkIn = "2026-09-01T17:50:00Z";
      expect(determinePunctuality(sessionStart, checkIn)).toBe("attended");
    });

    it("returns 'attended' when checking in within 15 minutes after session start", () => {
      const checkIn = "2026-09-01T18:14:59Z";
      expect(determinePunctuality(sessionStart, checkIn)).toBe("attended");
    });

    it("returns 'late' when checking in more than 15 minutes after session start", () => {
      const checkIn = "2026-09-01T18:16:00Z";
      expect(determinePunctuality(sessionStart, checkIn)).toBe("late");
    });
  });

  describe("parseCheckInInput (4 Approved Methods)", () => {
    it("accepts valid QR check-in", () => {
      const result = parseCheckInInput({
        sessionId: "sess-1",
        studentId: "stud-1",
        method: "qr",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.method).toBe("qr");
      }
    });

    it("accepts valid PIN check-in with pin string", () => {
      const result = parseCheckInInput({
        sessionId: "sess-1",
        studentId: "stud-1",
        method: "pin",
        pin: "1234",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.method).toBe("pin");
        expect(result.value.pin).toBe("1234");
      }
    });

    it("accepts valid nameSearch check-in", () => {
      const result = parseCheckInInput({
        sessionId: "sess-1",
        studentId: "stud-1",
        method: "nameSearch",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.method).toBe("nameSearch");
      }
    });

    it("accepts valid manual check-in by coach/staff", () => {
      const result = parseCheckInInput({
        sessionId: "sess-1",
        studentId: "stud-1",
        method: "manual",
        notes: "Verified on mat",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.method).toBe("manual");
        expect(result.value.notes).toBe("Verified on mat");
      }
    });

    it("rejects invalid method", () => {
      expect(
        parseCheckInInput({
          sessionId: "sess-1",
          studentId: "stud-1",
          method: "bluetooth",
        }).ok,
      ).toBe(false);
    });

    it("rejects missing sessionId or studentId", () => {
      expect(parseCheckInInput({ sessionId: "", studentId: "s-1", method: "qr" }).ok).toBe(false);
      expect(parseCheckInInput({ sessionId: "s-1", studentId: "", method: "qr" }).ok).toBe(false);
    });
  });

  describe("buildCorrectionAttendanceId", () => {
    it("generates opaque correction ID prefixed with corr_", () => {
      const id = buildCorrectionAttendanceId();
      expect(id).toMatch(/^corr_[0-9a-z_-]+$/i);
    });
  });

  describe("parseCorrectAttendanceInput", () => {
    it("accepts valid correction input to attended", () => {
      const result = parseCorrectAttendanceInput({
        sessionId: "sess-1",
        studentId: "stud-1",
        newState: "attended",
        reason: "Scanner malfunction at front desk",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.newState).toBe("attended");
        expect(result.value.reason).toBe("Scanner malfunction at front desk");
      }
    });

    it("accepts valid correction input to no_show or absent", () => {
      expect(
        parseCorrectAttendanceInput({
          sessionId: "sess-1",
          studentId: "stud-1",
          newState: "no_show",
          reason: "Did not attend",
        }).ok,
      ).toBe(true);

      expect(
        parseCorrectAttendanceInput({
          sessionId: "sess-1",
          studentId: "stud-1",
          newState: "absent",
          reason: "Called in sick",
        }).ok,
      ).toBe(true);
    });

    it("rejects invalid state or empty reason", () => {
      expect(
        parseCorrectAttendanceInput({
          sessionId: "sess-1",
          studentId: "stud-1",
          newState: "unknown_state",
          reason: "Some reason",
        }).ok,
      ).toBe(false);

      expect(
        parseCorrectAttendanceInput({
          sessionId: "sess-1",
          studentId: "stud-1",
          newState: "attended",
          reason: "",
        }).ok,
      ).toBe(false);
    });
  });

  describe("buildCheckoutId", () => {
    it("creates deterministic checkout ID from sessionId and studentId", () => {
      expect(buildCheckoutId("session-1", "student-2")).toBe("session-1__student-2");
    });
  });

  describe("parseRecordCheckoutInput (3 Approved Methods)", () => {
    it("accepts valid authorizedAdult checkout with adult ID and name", () => {
      const result = parseRecordCheckoutInput({
        sessionId: "sess-1",
        studentId: "stud-1",
        method: "authorizedAdult",
        authorizedAdultId: "adult-1",
        authorizedAdultName: "Jane Doe (Mother)",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.method).toBe("authorizedAdult");
        expect(result.value.authorizedAdultId).toBe("adult-1");
        expect(result.value.authorizedAdultName).toBe("Jane Doe (Mother)");
      }
    });

    it("accepts valid independentRelease checkout", () => {
      const result = parseRecordCheckoutInput({
        sessionId: "sess-1",
        studentId: "stud-1",
        method: "independentRelease",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.method).toBe("independentRelease");
      }
    });

    it("accepts valid staffOverride checkout with mandatory notes", () => {
      const result = parseRecordCheckoutInput({
        sessionId: "sess-1",
        studentId: "stud-1",
        method: "staffOverride",
        notes: "Picked up by grandmother approved via direct phone call",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.method).toBe("staffOverride");
        expect(result.value.notes).toBe("Picked up by grandmother approved via direct phone call");
      }
    });

    it("rejects staffOverride without notes", () => {
      expect(
        parseRecordCheckoutInput({
          sessionId: "sess-1",
          studentId: "stud-1",
          method: "staffOverride",
        }).ok,
      ).toBe(false);
    });

    it("rejects invalid method or missing sessionId/studentId", () => {
      expect(
        parseRecordCheckoutInput({
          sessionId: "sess-1",
          studentId: "stud-1",
          method: "friend",
        }).ok,
      ).toBe(false);

      expect(
        parseRecordCheckoutInput({
          sessionId: "",
          studentId: "stud-1",
          method: "independentRelease",
        }).ok,
      ).toBe(false);
    });
  });

  describe("buildSessionOperationalView (Live Roster & Attendance Projection)", () => {
    it("aggregates session, bookings, attendance, and checkouts into a unified operational view", () => {
      const mockSession = {
        sessionId: "sess-1",
        academyId: "acad-1",
        classId: "class-1",
        programId: "kids-bjj",
        locationId: "town" as const,
        instructorId: "coach-1",
        title: "Kids BJJ",
        startAt: "2026-09-01T16:00:00Z",
        endAt: "2026-09-01T17:00:00Z",
        capacity: 10,
        minParticipants: 3,
        status: "scheduled" as const,
        cancellationReason: null,
        isSeminar: false,
        schemaVersion: "1" as const,
        createdAt: "2026-08-01T00:00:00Z",
        createdBy: "admin-1",
        updatedAt: "2026-08-01T00:00:00Z",
        updatedBy: "admin-1",
      };

      const bookings = [
        {
          bookingId: "sess-1__std-1",
          academyId: "acad-1",
          sessionId: "sess-1",
          studentId: "std-1",
          membershipId: "m-1",
          status: "confirmed" as const,
          requestedAt: "2026-08-10T00:00:00Z",
          cancelledAt: null,
          cancellationReason: null,
          schemaVersion: "1" as const,
          createdAt: "2026-08-10T00:00:00Z",
          createdBy: "std-1",
          updatedAt: "2026-08-10T00:00:00Z",
          updatedBy: "std-1",
        },
        {
          bookingId: "sess-1__std-2",
          academyId: "acad-1",
          sessionId: "sess-1",
          studentId: "std-2",
          membershipId: "m-2",
          status: "confirmed" as const,
          requestedAt: "2026-08-10T00:00:00Z",
          cancelledAt: null,
          cancellationReason: null,
          schemaVersion: "1" as const,
          createdAt: "2026-08-10T00:00:00Z",
          createdBy: "std-2",
          updatedAt: "2026-08-10T00:00:00Z",
          updatedBy: "std-2",
        },
        {
          bookingId: "sess-1__std-3",
          academyId: "acad-1",
          sessionId: "sess-1",
          studentId: "std-3",
          membershipId: "m-3",
          status: "confirmed" as const,
          requestedAt: "2026-08-10T00:00:00Z",
          cancelledAt: null,
          cancellationReason: null,
          schemaVersion: "1" as const,
          createdAt: "2026-08-10T00:00:00Z",
          createdBy: "std-3",
          updatedAt: "2026-08-10T00:00:00Z",
          updatedBy: "std-3",
        },
        {
          bookingId: "sess-1__std-4",
          academyId: "acad-1",
          sessionId: "sess-1",
          studentId: "std-4",
          membershipId: "m-4",
          status: "cancelled" as const,
          requestedAt: "2026-08-10T00:00:00Z",
          cancelledAt: "2026-08-15T00:00:00Z",
          cancellationReason: "Schedule conflict",
          schemaVersion: "1" as const,
          createdAt: "2026-08-10T00:00:00Z",
          createdBy: "std-4",
          updatedAt: "2026-08-10T00:00:00Z",
          updatedBy: "std-4",
        },
      ];

      const attendanceRecords = [
        // std-1 checked in and attended
        {
          attendanceId: "sess-1__std-1",
          academyId: "acad-1",
          sessionId: "sess-1",
          studentId: "std-1",
          method: "qr" as const,
          state: "attended" as const,
          occurredAt: "2026-09-01T15:55:00Z",
          notes: null,
          correctionOf: null,
          schemaVersion: "1" as const,
          createdAt: "2026-09-01T15:55:00Z",
          createdBy: "std-1",
          updatedAt: "2026-09-01T15:55:00Z",
          updatedBy: "std-1",
        },
        // std-2 checked in late
        {
          attendanceId: "sess-1__std-2",
          academyId: "acad-1",
          sessionId: "sess-1",
          studentId: "std-2",
          method: "pin" as const,
          state: "late" as const,
          occurredAt: "2026-09-01T16:20:00Z",
          notes: null,
          correctionOf: null,
          schemaVersion: "1" as const,
          createdAt: "2026-09-01T16:20:00Z",
          createdBy: "std-2",
          updatedAt: "2026-09-01T16:20:00Z",
          updatedBy: "std-2",
        },
        // Walk-in std-99 attended without prior booking
        {
          attendanceId: "sess-1__std-99",
          academyId: "acad-1",
          sessionId: "sess-1",
          studentId: "std-99",
          method: "manual" as const,
          state: "attended" as const,
          occurredAt: "2026-09-01T16:00:00Z",
          notes: "Walk-in trial",
          correctionOf: null,
          schemaVersion: "1" as const,
          createdAt: "2026-09-01T16:00:00Z",
          createdBy: "coach-1",
          updatedAt: "2026-09-01T16:00:00Z",
          updatedBy: "coach-1",
        },
      ];

      const checkoutRecords = [
        // std-1 checked out
        {
          checkoutId: "sess-1__std-1",
          academyId: "acad-1",
          sessionId: "sess-1",
          studentId: "std-1",
          method: "authorizedAdult" as const,
          authorizedAdultId: "guardian-1",
          authorizedAdultName: "Maria Silva",
          notes: null,
          checkedOutAt: "2026-09-01T17:05:00Z",
          schemaVersion: "1" as const,
          createdAt: "2026-09-01T17:05:00Z",
          createdBy: "guardian-1",
          updatedAt: "2026-09-01T17:05:00Z",
          updatedBy: "guardian-1",
        },
      ];

      const view = buildSessionOperationalView({
        session: mockSession,
        bookings,
        attendance: attendanceRecords,
        checkouts: checkoutRecords,
        now: "2026-09-01T17:15:00Z",
      });

      // Session & Quorum
      expect(view.session.sessionId).toBe("sess-1");
      expect(view.summary.totalBookings).toBe(3); // excludes cancelled std-4
      expect(view.summary.quorumMet).toBe(true); // 3 confirmed >= minParticipants 3
      expect(view.summary.totalCheckedIn).toBe(2); // std-1 (attended) + std-2 (late)
      expect(view.summary.totalCheckedOut).toBe(1); // std-1
      expect(view.summary.totalPendingArrival).toBe(1); // std-3 (booked, not arrived)

      // Roster items
      expect(view.roster).toHaveLength(3);
      const student1 = view.roster.find((r) => r.studentId === "std-1");
      expect(student1?.computedStatus).toBe("checked_out");
      expect(student1?.checkout?.method).toBe("authorizedAdult");

      const student2 = view.roster.find((r) => r.studentId === "std-2");
      expect(student2?.computedStatus).toBe("late");
      expect(student2?.checkout).toBeNull();

      const student3 = view.roster.find((r) => r.studentId === "std-3");
      expect(student3?.computedStatus).toBe("booked_not_arrived");
      expect(student3?.attendance).toBeNull();

      // Walk-ins
      expect(view.unbookedCheckIns).toHaveLength(1);
      expect(view.unbookedCheckIns[0]?.studentId).toBe("std-99");
    });
  });
  describe("buildDailyOperationsDashboard", () => {
    it("returns staff-safe sorted session snapshots without roster data", () => {
      const makeView = (sessionId: string, startAt: string): SessionOperationalView => ({
        session: {
          sessionId,
          academyId: "acad-1",
          classId: "class-1",
          programId: "kids-bjj",
          locationId: "town",
          instructorId: "coach-1",
          title: sessionId,
          startAt,
          endAt: startAt.replace("T18:00", "T19:00"),
          capacity: 20,
          minParticipants: 4,
          status: "scheduled",
          cancellationReason: null,
          isSeminar: false,
          schemaVersion: "1",
          createdAt: "2026-08-01T00:00:00Z",
          createdBy: "admin-1",
          updatedAt: "2026-08-01T00:00:00Z",
          updatedBy: "admin-1",
        },
        summary: {
          capacity: 20,
          minParticipants: 4,
          quorumMet: true,
          totalBookings: 3,
          totalCheckedIn: 2,
          totalCheckedOut: 1,
          totalNoShows: 0,
          totalPendingArrival: 1,
        },
        roster: [
          {
            studentId: "private-student-id",
            booking: {} as never,
            attendance: null,
            checkout: null,
            computedStatus: "booked_not_arrived",
          },
        ],
        unbookedCheckIns: [],
        refreshedAt: "2026-09-01T20:00:00Z",
      });

      const dashboard = buildDailyOperationsDashboard({
        query: { from: "2026-09-01T00:00:00Z", to: "2026-09-01T23:59:59Z" },
        views: [
          makeView("later", "2026-09-01T19:00:00Z"),
          makeView("earlier", "2026-09-01T18:00:00Z"),
        ],
        now: "2026-09-01T20:01:00Z",
      });

      expect(dashboard.sessions.map((snapshot) => snapshot.session.sessionId)).toEqual([
        "earlier",
        "later",
      ]);
      expect(dashboard.sessions[0]).not.toHaveProperty("roster");
      expect(dashboard.query.from).toBe("2026-09-01T00:00:00Z");
      expect(dashboard.refreshedAt).toBe("2026-09-01T20:01:00Z");
    });
  });
});

describe("check-in proximity signal (T109)", () => {
  const measuredAt = "2026-09-05T18:00:00.000Z";
  const nowMs = Date.parse(measuredAt);

  describe("parseSaveLocationGeofenceInput", () => {
    it("accepts a site coordinate pair and a null that clears it", () => {
      const saved = parseSaveLocationGeofenceInput({
        locationId: "town",
        geofence: { latitude: 49.186, longitude: -2.106 },
      });
      expect(saved.ok && saved.value.geofence).toEqual({ latitude: 49.186, longitude: -2.106 });

      const cleared = parseSaveLocationGeofenceInput({ locationId: "west", geofence: null });
      expect(cleared.ok && cleared.value).toEqual({ locationId: "west", geofence: null });
    });

    it("refuses unknown sites, extra keys, coarse precision and out-of-range coordinates", () => {
      expect(parseSaveLocationGeofenceInput({ locationId: "harbour", geofence: null }).ok).toBe(
        false,
      );
      expect(
        parseSaveLocationGeofenceInput({
          locationId: "town",
          geofence: { latitude: 49.1, longitude: -2.1 },
          radiusMeters: 500,
        }).ok,
      ).toBe(false);
      expect(
        parseSaveLocationGeofenceInput({
          locationId: "town",
          geofence: { latitude: 49.1234567, longitude: -2.1 },
        }).ok,
      ).toBe(false);
      expect(
        parseSaveLocationGeofenceInput({
          locationId: "town",
          geofence: { latitude: 91, longitude: -2.1 },
        }).ok,
      ).toBe(false);
      expect(
        parseSaveLocationGeofenceInput({
          locationId: "town",
          geofence: { latitude: 49.1, longitude: -2.1, altitude: 3 },
        }).ok,
      ).toBe(false);
    });
  });

  describe("distanceInMetres", () => {
    it("is zero for the same point and grows with separation", () => {
      const site = { latitude: 49.186, longitude: -2.106 };
      expect(Math.round(distanceInMetres(site, site))).toBe(0);
      // Roughly 0.0009 degrees of latitude is about 100 m.
      const hundredMetresNorth = { latitude: 49.186 + 0.0009, longitude: -2.106 };
      expect(Math.round(distanceInMetres(site, hundredMetresNorth))).toBeGreaterThan(90);
      expect(Math.round(distanceInMetres(site, hundredMetresNorth))).toBeLessThan(110);
    });
  });

  describe("parseCheckInProximityMeasurement", () => {
    it("accepts exactly a distance, an accuracy and a timestamp", () => {
      const parsed = parseCheckInProximityMeasurement({
        distanceMeters: 12.4,
        accuracyMeters: 8,
        measuredAt,
      });
      expect(parsed.ok && parsed.value).toEqual({
        distanceMeters: 12.4,
        accuracyMeters: 8,
        measuredAt,
      });
    });

    it("refuses coordinates, negative or non-finite values and a bad timestamp", () => {
      expect(
        parseCheckInProximityMeasurement({
          distanceMeters: 10,
          accuracyMeters: 5,
          measuredAt,
          latitude: 49.1,
        }).ok,
      ).toBe(false);
      expect(
        parseCheckInProximityMeasurement({ distanceMeters: -1, accuracyMeters: 5, measuredAt }).ok,
      ).toBe(false);
      expect(
        parseCheckInProximityMeasurement({
          distanceMeters: Number.POSITIVE_INFINITY,
          accuracyMeters: 5,
          measuredAt,
        }).ok,
      ).toBe(false);
      expect(
        parseCheckInProximityMeasurement({
          distanceMeters: 10,
          accuracyMeters: 5,
          measuredAt: "not-a-time",
        }).ok,
      ).toBe(false);
    });
  });

  describe("parseCheckInInput with a measurement", () => {
    it("keeps the measurement and the override reason", () => {
      const parsed = parseCheckInInput({
        sessionId: "session-1",
        studentId: "student-1",
        method: "manual",
        proximity: { distanceMeters: 400, accuracyMeters: 10, measuredAt },
        overrideReason: "Student trains at the other site today.",
      });
      expect(parsed.ok && parsed.value.proximity?.distanceMeters).toBe(400);
      expect(parsed.ok && parsed.value.overrideReason).toBe(
        "Student trains at the other site today.",
      );
    });

    it("still accepts a check-in with no measurement at all", () => {
      const parsed = parseCheckInInput({
        sessionId: "session-1",
        studentId: "student-1",
        method: "manual",
      });
      expect(parsed.ok && parsed.value.proximity).toBeUndefined();
      expect(parsed.ok && parsed.value.overrideReason).toBeUndefined();
    });

    it("refuses a too-short override reason and a malformed measurement", () => {
      expect(
        parseCheckInInput({
          sessionId: "session-1",
          studentId: "student-1",
          method: "manual",
          overrideReason: "late",
        }).ok,
      ).toBe(false);
      expect(
        parseCheckInInput({
          sessionId: "session-1",
          studentId: "student-1",
          method: "manual",
          proximity: { distanceMeters: 10 },
        }).ok,
      ).toBe(false);
    });
  });

  describe("resolveCheckInProximity", () => {
    const measurement = (distanceMeters: number, accuracyMeters = 8) => ({
      distanceMeters,
      accuracyMeters,
      measuredAt,
    });

    it("reports within the radius without asking for a reason", () => {
      const resolved = resolveCheckInProximity({
        measurement: measurement(checkInProximityRadiusMeters),
        siteHasGeofence: true,
        nowMs,
      });
      expect(resolved.ok && resolved.value).toEqual({
        signal: "within",
        distanceMeters: 50,
        accuracyMeters: 8,
        overrideReason: null,
      });
    });

    it("requires a staff reason outside the radius and records it", () => {
      const refused = resolveCheckInProximity({
        measurement: measurement(51),
        siteHasGeofence: true,
        nowMs,
      });
      expect(refused.ok).toBe(false);

      const resolved = resolveCheckInProximity({
        measurement: measurement(51),
        siteHasGeofence: true,
        overrideReason: "Signal drifted indoors; the student is on the mat.",
        nowMs,
      });
      expect(resolved.ok && resolved.value).toEqual({
        signal: "outside",
        distanceMeters: 51,
        accuracyMeters: 8,
        overrideReason: "Signal drifted indoors; the student is on the mat.",
      });
    });

    it("is unavailable, and needs no reason, when nothing can be judged", () => {
      const cases = [
        { siteHasGeofence: true, nowMs },
        { measurement: measurement(10), siteHasGeofence: false, nowMs },
        // Accuracy coarser than the radius cannot decide a 50 m question.
        { measurement: measurement(10, 120), siteHasGeofence: true, nowMs },
        // A reading from an hour ago says nothing about now.
        { measurement: measurement(10), siteHasGeofence: true, nowMs: nowMs + 3_600_000 },
      ];
      for (const input of cases) {
        const resolved = resolveCheckInProximity(input);
        expect(resolved.ok && resolved.value).toEqual({
          signal: "unavailable",
          distanceMeters: null,
          accuracyMeters: null,
          overrideReason: null,
        });
      }
    });

    it("ignores a reason when there is nothing to override, so the radius never blocks", () => {
      const reason = "Nothing to override here at all.";
      const inside = resolveCheckInProximity({
        measurement: measurement(10),
        siteHasGeofence: true,
        overrideReason: reason,
        nowMs,
      });
      expect(inside.ok && inside.value).toEqual({
        signal: "within",
        distanceMeters: 10,
        accuracyMeters: 8,
        overrideReason: null,
      });
      // An expired reading with a reason typed against it is unavailable, not an error.
      const expired = resolveCheckInProximity({
        measurement: measurement(320),
        siteHasGeofence: true,
        overrideReason: reason,
        nowMs: nowMs + 3_600_000,
      });
      expect(expired.ok && expired.value.signal).toBe("unavailable");
      expect(expired.ok && expired.value.overrideReason).toBeNull();
    });
  });
});

describe("quorum sweep decision (T110)", () => {
  const now = "2026-09-04T17:30:00.000Z";
  // Half an hour ahead: the one-hour booking cutoff has passed.
  const afterCutoff = "2026-09-04T18:00:00.000Z";
  // Three hours ahead: still open for booking.
  const beforeCutoff = "2026-09-04T20:30:00.000Z";

  function decide(
    session: Readonly<{
      startAt?: string;
      status?: string;
      minParticipants?: number;
      cancellationReason?: string | null;
    }>,
    confirmedCount: number,
  ) {
    return decideQuorumSweep({
      session: {
        startAt: session.startAt ?? afterCutoff,
        status: session.status ?? "scheduled",
        minParticipants: session.minParticipants ?? 4,
        ...(session.cancellationReason === undefined
          ? {}
          : { cancellationReason: session.cancellationReason }),
      },
      confirmedCount,
      now,
    });
  }

  it("cancels only after the cutoff and only below the minimum", () => {
    expect(decide({}, 3)).toEqual({
      outcome: "cancelled",
      confirmedCount: 3,
      minParticipants: 4,
      cancels: true,
    });
    expect(decide({}, 4).outcome).toBe("quorumMet");
    expect(decide({}, 9).outcome).toBe("quorumMet");
    expect(decide({ startAt: beforeCutoff }, 0).outcome).toBe("beforeCutoff");
  });

  it("respects a minimum raised by owner or head coach", () => {
    expect(decide({ minParticipants: 8 }, 6)).toMatchObject({
      outcome: "cancelled",
      minParticipants: 8,
    });
    expect(decide({ minParticipants: 0 }, 0).outcome).toBe("quorumMet");
  });

  it("distinguishes its own earlier cancellation from any other status", () => {
    expect(
      decide({ status: "cancelled", cancellationReason: quorumCancellationReason }, 0).outcome,
    ).toBe("alreadyCancelledForQuorum");
    expect(
      decide({ status: "cancelled", cancellationReason: "Instructor unavailable" }, 0).outcome,
    ).toBe("notScheduled");
    for (const status of ["active", "completed", "draft"]) {
      expect(decide({ status }, 0).outcome).toBe("notScheduled");
    }
  });

  it("never asks for a write on any outcome but cancellation", () => {
    const outcomes = [
      decide({}, 4),
      decide({ startAt: beforeCutoff }, 0),
      decide({ status: "completed" }, 0),
      decide({ status: "cancelled", cancellationReason: quorumCancellationReason }, 0),
    ];
    expect(outcomes.every((decision) => !decision.cancels)).toBe(true);
  });

  it("treats a malformed minimum or count as zero rather than trusting it", () => {
    expect(decide({ minParticipants: Number.NaN }, 0).minParticipants).toBe(0);
    expect(
      decideQuorumSweep({
        session: { startAt: afterCutoff, status: "scheduled", minParticipants: 4 },
        confirmedCount: -3,
        now,
      }),
    ).toMatchObject({ confirmedCount: 0, outcome: "cancelled" });
  });
});
