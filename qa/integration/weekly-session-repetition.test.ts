import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";
import {
  newWeeklySeries,
  weeklyOccurrence,
} from "../../apps/functions/src/schedule/weekly-session-service.js";
import { createFirestoreScheduleStore } from "../../apps/functions/src/schedule/schedule-service.js";

// This test may never fall through to a real Firebase project.
if (!/^127\.0\.0\.1:\d+$/u.test(process.env.FIRESTORE_EMULATOR_HOST ?? ""))
  throw new Error("Local Firestore emulator required");
const academy = `weekly-test-${randomUUID()}`;
const app = initializeApp({ projectId: "demo-bpt-jersey" }, academy);
const firestore = getFirestore(app);
const store = createFirestoreScheduleStore({ firestore: firestore as never });
const seed = {
  programId: "adult-fundamentals",
  locationId: "town",
  title: "Synthetic weekly class",
  instructorId: "trainer",
  instructorIds: ["trainer", "trainer-two"],
  capacity: 15,
  minParticipants: 2,
  startAt: "2026-10-19T17:00:00.000Z",
  endAt: "2026-10-19T18:00:00.000Z",
  repeatWeekly: true,
  waitingList: "on" as const,
  bookingRules: "defined" as const,
};
const range = { from: "2026-10-01T00:00:00.000Z", to: "2026-11-30T23:59:59.000Z" };
afterAll(async () => {
  for (const collection of ["sessions", "sessionSeries", "bookings", "attendance"]) {
    await firestore.recursiveDelete(firestore.collection(`academies/${academy}/${collection}`));
  }
  await deleteApp(app);
});

describe("weekly recurrence against Firestore", () => {
  it("creates atomically, survives concurrent calendar reads, and keeps reservations when editing or stopping", async () => {
    const first = await store.createSession(academy, seed, "synthetic-owner");
    const [a, b] = await Promise.all([
      store.listSessions(academy, range),
      store.listSessions(academy, range),
    ]);
    expect(a.map((row) => row.sessionId)).toEqual(b.map((row) => row.sessionId));
    expect(a).toHaveLength(7);
    expect(a[0]!.sessionId).toBe(first.sessionId);
    expect(a[1]!.startAt).toBe("2026-10-26T18:00:00.000Z");
    const bookingRef = firestore.doc(`academies/${academy}/bookings/synthetic-booking`);
    const booking = {
      sessionId: a[2]!.sessionId,
      studentId: "synthetic-student",
      status: "confirmed",
    };
    await bookingRef.set(booking);
    await store.cancelSession(academy, a[4]!.sessionId, "Synthetic exception", "owner");
    await store.updateSession(academy, { sessionId: a[3]!.sessionId, capacity: 9 }, "owner");
    const [edited] = await Promise.all([
      store.updateSession(
        academy,
        {
          sessionId: a[1]!.sessionId,
          capacity: 20,
          repeatScope: "following",
          startAt: "2026-10-26T19:00:00.000Z",
          endAt: "2026-10-26T20:00:00.000Z",
        },
        "owner",
      ),
      store.listSessions(academy, {
        from: "2026-12-01T00:00:00.000Z",
        to: "2026-12-31T23:59:59.000Z",
      }),
    ]);
    expect(edited.capacity).toBe(20);
    const next = await store.listSessions(academy, range);
    expect(next.map((row) => row.sessionId)).toEqual(a.map((row) => row.sessionId));
    expect(next[0]!.capacity).toBe(15);
    expect(next[2]!.capacity).toBe(20);
    expect(next[3]!.capacity).toBe(9);
    expect(next[4]!.status).toBe("cancelled");
    expect((await bookingRef.get()).data()).toEqual(booking);
    const december = await store.listSessions(academy, {
      from: "2026-12-01T00:00:00.000Z",
      to: "2026-12-31T23:59:59.000Z",
    });
    expect(december.every((row) => row.capacity === 20 && row.startAt.includes("T19:00:"))).toBe(
      true,
    );
    await store.updateSession(
      academy,
      { sessionId: next[2]!.sessionId, repeatScope: "following", repeatWeekly: false },
      "owner",
    );
    expect((await store.getSession(academy, next[2]!.sessionId))!.status).toBe("scheduled");
    expect((await store.getSession(academy, next[3]!.sessionId))!.status).toBe("cancelled");
    expect((await bookingRef.get()).data()).toEqual(booking);
    expect(
      await store.listSessions(academy, {
        from: "2035-01-01T00:00:00.000Z",
        to: "2035-01-31T23:59:59.000Z",
      }),
    ).toEqual([]);
    expect(await store.listSessions(academy + "-other", range)).toEqual([]);
  });
});

it("atomically edits and stops 600 persisted occurrences without losing history", async () => {
  const first = await store.createSession(
    academy,
    { ...seed, title: "Large synthetic series" },
    "owner",
  );
  const series = newWeeklySeries(first, "Europe/Jersey");
  const batch = firestore.batch();
  for (let index = 1; index < 600; index++) {
    const row = weeklyOccurrence(series, index)!;
    batch.create(firestore.doc(`academies/${academy}/sessions/${row.sessionId}`), row);
  }
  await batch.commit();
  const last = weeklyOccurrence(series, 599)!;
  const booking = firestore.doc(`academies/${academy}/bookings/large-synthetic-booking`);
  const attendance = firestore.doc(`academies/${academy}/attendance/large-synthetic-attendance`);
  await attendance.set({
    sessionId: last.sessionId,
    status: "attended",
    studentId: "synthetic-large",
  });
  await booking.set({
    sessionId: last.sessionId,
    status: "confirmed",
    studentId: "synthetic-large",
  });
  await store.updateSession(
    academy,
    { sessionId: first.sessionId, capacity: 25, repeatScope: "following" },
    "administrator",
    true,
  );
  expect((await store.getSession(academy, last.sessionId))!.capacity).toBe(25);
  await store.updateSession(
    academy,
    { sessionId: first.sessionId, repeatWeekly: false, repeatScope: "following" },
    "administrator",
    true,
  );
  expect((await store.getSession(academy, last.sessionId))!.status).toBe("cancelled");
  await store.updateSession(
    academy,
    {
      sessionId: last.sessionId,
      title: "Corrected historical title",
      locationId: "west",
      programId: "nogi",
    },
    "administrator",
    true,
  );
  expect(await store.getSession(academy, last.sessionId)).toMatchObject({
    status: "cancelled",
    title: "Corrected historical title",
    locationId: "west",
    programId: "nogi",
  });
  expect((await attendance.get()).data()).toMatchObject({
    sessionId: last.sessionId,
    status: "attended",
  });
  expect((await booking.get()).data()).toMatchObject({
    sessionId: last.sessionId,
    status: "confirmed",
  });
});

it("turns a cancelled standalone date into a weekly series while preserving that date's history", async () => {
  const first = await store.createSession(academy, { ...seed, repeatWeekly: false }, "owner");
  await store.cancelSession(academy, first.sessionId, "Historical removal", "owner");
  const updated = await store.updateSession(
    academy,
    { sessionId: first.sessionId, repeatWeekly: true },
    "administrator",
    true,
  );
  expect(updated.status).toBe("cancelled");
  const rows = (await store.listSessions(academy, range)).filter(
    (row) => row.weeklySeriesId === first.sessionId,
  );
  expect(rows[0]!.status).toBe("cancelled");
  expect(
    rows.slice(1).every((row) => row.status === "scheduled" && row.cancellationReason === null),
  ).toBe(true);
});
