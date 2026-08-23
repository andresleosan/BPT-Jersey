import { describe, expect, it } from "vitest";

import {
  parseCreateClassInput,
  parseCreateProgramInput,
  parseCreateSessionInput,
  parseListSessionsQuery,
  parseRecurrenceRule,
  generateSessionsFromClass,
  type ClassRecord,
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
});
