import { describe, expect, it } from "vitest";

import {
  createCancelSessionHandler,
  createGenerateSessionsHandler,
  createListClassesHandler,
  createListScheduleCatalogHandler,
  createListSessionsHandler,
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
});
