import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import { createFirestoreScheduleStore } from "../../apps/functions/src/schedule/schedule-service";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const useLocalEmulator =
  typeof emulatorHost === "string" &&
  (emulatorHost.startsWith("127.0.0.1:") || emulatorHost.startsWith("localhost:"));

const runId = `schedule-integration-${Date.now()}`;
const academyId = `academy-${runId}`;

const app = useLocalEmulator ? initializeApp({ projectId: "demo-bpt-jersey" }, runId) : undefined;
const firestore = app ? getFirestore(app) : undefined;
const store = firestore
  ? createFirestoreScheduleStore({
      firestore: firestore as unknown as Parameters<
        typeof createFirestoreScheduleStore
      >[0]["firestore"],
    })
  : undefined;

afterAll(async () => {
  if (app && firestore) {
    try {
      const classes = await firestore.collection(`academies/${academyId}/classes`).get();
      for (const doc of classes.docs) {
        await doc.ref.delete();
      }
      const sessions = await firestore.collection(`academies/${academyId}/sessions`).get();
      for (const doc of sessions.docs) {
        await doc.ref.delete();
      }
    } catch {
      // Best-effort cleanup
    }
  }
});

describe("Schedule Firestore Adapters Integration", () => {
  it("runs full lifecycle of locations, programs, classes and sessions on emulator", async () => {
    if (!store) {
      return;
    }

    // Default locations and programs
    const locations = await store.listLocations(academyId);
    expect(locations).toHaveLength(2);

    const programs = await store.listPrograms(academyId);
    expect(programs.length).toBeGreaterThanOrEqual(6);

    // Create Class
    const createdClass = await store.createClass(
      academyId,
      {
        programId: "adult-fundamentals",
        locationId: "town",
        name: "Tue Night Adults Fundamentals",
        recurrenceRule: {
          dayOfWeek: 2,
          startTime: "19:00",
          durationMinutes: 60,
        },
        instructorIds: ["coach-1"],
        capacity: 25,
        minParticipants: 4,
      },
      "owner-1",
    );

    expect(createdClass.classId).toBeDefined();
    expect(createdClass.name).toBe("Tue Night Adults Fundamentals");

    const fetchedClass = await store.getClass(academyId, createdClass.classId);
    expect(fetchedClass?.name).toBe("Tue Night Adults Fundamentals");

    // Update Class
    const updatedClass = await store.updateClass(
      academyId,
      {
        classId: createdClass.classId,
        capacity: 30,
      },
      "owner-1",
    );
    expect(updatedClass.capacity).toBe(30);

    // Create Session
    const createdSession = await store.createSession(
      academyId,
      {
        classId: createdClass.classId,
        programId: "adult-fundamentals",
        locationId: "town",
        instructorId: "coach-1",
        title: "Tue Night Adults Fundamentals",
        startAt: "2026-09-08T19:00:00Z",
        endAt: "2026-09-08T20:00:00Z",
        capacity: 30,
        minParticipants: 4,
      },
      "owner-1",
    );

    expect(createdSession.sessionId).toBeDefined();
    expect(createdSession.status).toBe("scheduled");

    // List Sessions
    const sessions = await store.listSessions(academyId, {
      from: "2026-09-01T00:00:00Z",
      to: "2026-09-30T23:59:59Z",
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe(createdSession.sessionId);

    // Cancel Session
    const cancelled = await store.cancelSession(
      academyId,
      createdSession.sessionId,
      "Facility maintenance",
      "owner-1",
    );
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancellationReason).toBe("Facility maintenance");
  });
});
