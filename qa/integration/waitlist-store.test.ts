import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createFirestoreWaitlistStore,
  WaitlistStoreError,
} from "../../apps/functions/src/schedule/advanced-booking-service.js";

const runId = "waitlist-" + process.pid + "-" + randomUUID();
const academyA = runId + "-academy-a";
const academyB = runId + "-academy-b";
const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const firestore = getFirestore(app);
const store = createFirestoreWaitlistStore({
  firestore: firestore as unknown as Parameters<
    typeof createFirestoreWaitlistStore
  >[0]["firestore"],
});
const collections = ["sessions", "memberships", "bookings", "waitlistEntries"] as const;

function membership(academyId: string, membershipId: string, studentId: string, status = "active") {
  return {
    membershipId,
    academyId,
    familyId: "family-1",
    studentId,
    planId: "bpt-jersey-adult",
    status,
    startsAt: "2026-08-01T00:00:00Z",
    endsAt: null,
    nextBillingAt: null,
    schemaVersion: "1",
    createdAt: "2026-08-01T00:00:00Z",
    createdBy: "owner-1",
    updatedAt: "2026-08-01T00:00:00Z",
    updatedBy: "owner-1",
  };
}

async function seedAcademy() {
  const session = {
    sessionId: "session-full",
    academyId: academyA,
    classId: null,
    programId: "adult-fundamentals",
    locationId: "town",
    instructorId: "coach-1",
    title: "Full class",
    startAt: "2026-09-08T19:00:00Z",
    endAt: "2026-09-08T20:00:00Z",
    capacity: 1,
    minParticipants: 1,
    status: "scheduled",
    isSeminar: false,
    cancellationReason: null,
    schemaVersion: "1",
    createdAt: "2026-08-01T00:00:00Z",
    createdBy: "owner-1",
    updatedAt: "2026-08-01T00:00:00Z",
    updatedBy: "owner-1",
  };
  await Promise.all([
    firestore.doc("academies/" + academyA + "/sessions/session-full").set(session),
    firestore
      .doc("academies/" + academyA + "/sessions/session-open")
      .set({ ...session, sessionId: "session-open", title: "Open class", capacity: 2 }),
    firestore
      .doc("academies/" + academyA + "/memberships/membership-1")
      .set(membership(academyA, "membership-1", "student-1")),
    firestore
      .doc("academies/" + academyA + "/memberships/membership-2")
      .set(membership(academyA, "membership-2", "student-2", "trial")),
    firestore
      .doc("academies/" + academyA + "/memberships/membership-paused")
      .set(membership(academyA, "membership-paused", "student-paused", "paused")),
    firestore.doc("academies/" + academyA + "/bookings/session-full__student-booked").set({
      bookingId: "session-full__student-booked",
      academyId: academyA,
      sessionId: "session-full",
      studentId: "student-booked",
      membershipId: "membership-booked",
      status: "confirmed",
      requestedAt: "2026-08-20T00:00:00Z",
      cancelledAt: null,
      cancellationReason: null,
      schemaVersion: "1",
      createdAt: "2026-08-20T00:00:00Z",
      createdBy: "student-booked",
      updatedAt: "2026-08-20T00:00:00Z",
      updatedBy: "student-booked",
    }),
  ]);
}

beforeAll(seedAcademy);

afterAll(async () => {
  for (const academyId of [academyA, academyB]) {
    for (const name of collections) {
      const snapshot = await firestore.collection("academies/" + academyId + "/" + name).get();
      await Promise.all(snapshot.docs.map((item) => item.ref.delete()));
    }
  }
  await deleteApp(app);
});

describe("waitlist store against the Firestore emulator", () => {
  it("joins idempotently, assigns positions, cancels, and isolates tenants", async () => {
    const first = await store.joinWaitlist({
      academyId: academyA,
      request: {
        sessionId: "session-full",
        studentId: "student-1",
        membershipId: "membership-1",
      },
      actorId: "student-1",
      now: "2026-08-28T12:00:00Z",
    });
    expect(first.position).toBe(1);

    const replay = await store.joinWaitlist({
      academyId: academyA,
      request: {
        sessionId: "session-full",
        studentId: "student-1",
        membershipId: "membership-1",
      },
      actorId: "student-1",
      now: "2026-08-28T13:00:00Z",
    });
    expect(replay).toEqual(first);

    const second = await store.joinWaitlist({
      academyId: academyA,
      request: {
        sessionId: "session-full",
        studentId: "student-2",
        membershipId: "membership-2",
      },
      actorId: "guardian-1",
      now: "2026-08-28T12:01:00Z",
    });
    expect(second.position).toBe(2);

    const cancelled = await store.cancelWaitlist({
      academyId: academyA,
      sessionId: "session-full",
      studentId: "student-1",
      actorId: "student-1",
      now: "2026-08-28T14:00:00Z",
    });
    expect(cancelled.status).toBe("cancelled");
    await expect(
      store.cancelWaitlist({
        academyId: academyA,
        sessionId: "session-full",
        studentId: "student-1",
        actorId: "student-1",
        now: "2026-08-28T15:00:00Z",
      }),
    ).resolves.toEqual(cancelled);

    const sessionEntries = await store.listSessionWaitlist(academyA, "session-full");
    expect(sessionEntries.map((item) => [item.studentId, item.position, item.status])).toEqual([
      ["student-1", 1, "cancelled"],
      ["student-2", 2, "waiting"],
    ]);
    expect(await store.listStudentWaitlist(academyB, "student-1")).toEqual([]);
  });

  it("fails closed for available capacity and paused memberships", async () => {
    await expect(
      store.joinWaitlist({
        academyId: academyA,
        request: {
          sessionId: "session-open",
          studentId: "student-1",
          membershipId: "membership-1",
        },
        actorId: "student-1",
        now: "2026-08-28T12:00:00Z",
      }),
    ).rejects.toMatchObject<Partial<WaitlistStoreError>>({ code: "ineligible" });

    await expect(
      store.joinWaitlist({
        academyId: academyA,
        request: {
          sessionId: "session-full",
          studentId: "student-paused",
          membershipId: "membership-paused",
        },
        actorId: "student-paused",
        now: "2026-08-28T12:00:00Z",
      }),
    ).rejects.toMatchObject<Partial<WaitlistStoreError>>({ code: "ineligible" });
  });
});
