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
});
