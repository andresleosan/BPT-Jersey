import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createFirestoreQuorumSweepStore } from "../../apps/functions/src/schedule/quorum-sweep-firestore";
import { sweepSessionQuorums } from "../../apps/functions/src/schedule/quorum-sweep-job";

const enabled = /^127\.0\.0\.1:\d+$/u.test(process.env.FIRESTORE_EMULATOR_HOST ?? "");
const academyId = `quorum-integration-${Date.now()}`;
const app = enabled ? initializeApp({ projectId: "demo-bpt-jersey" }, academyId) : undefined;
const db = app ? getFirestore(app) : undefined;
const now = "2036-09-19T17:00:01.000Z";
const window = { from: "2036-09-18T17:00:00.000Z", to: "2036-09-19T18:00:00.000Z" };
const root = `academies/${academyId}`;

beforeEach(async () => {
  if (db) await db.recursiveDelete(db.doc(root));
});

afterAll(async () => {
  if (db && app) {
    await db.recursiveDelete(db.doc(root));
    await deleteApp(app);
  }
});

async function seed(sessionId: string, overrides: Record<string, unknown> = {}) {
  await db!.doc(`${root}/sessions/${sessionId}`).set({
    academyId,
    sessionId,
    startAt: window.to,
    minParticipants: 4,
    status: "scheduled",
    ...overrides,
  });
}

describe.skipIf(!enabled)("scheduled quorum Firestore adapter", () => {
  it("isolates malformed series while sweeping healthy series and existing sessions across academies", async () => {
    const otherRoot = `academies/${academyId}-other`;
    try {
      await db!.doc(`${root}/sessionSeries/a-malformed`).set({ revisions: null });
      for (const [seriesId, timezone] of [
        ["b-invalid-zone", "Invalid/Zone"],
        ["c-healthy", "UTC"],
      ]) {
        await db!.doc(`${root}/sessionSeries/${seriesId}`).set({
          seriesId,
          academyId,
          timezone,
          revisions: [
            {
              fromIndex: 0,
              enabled: true,
              template: {
                academyId,
                sessionId: seriesId,
                startAt: window.to,
                endAt: "2036-09-19T19:00:00.000Z",
                minParticipants: 4,
                status: "scheduled",
              },
            },
          ],
        });
      }
      await seed("existing");
      await db!.doc(`${otherRoot}/sessions/under-quorum`).set({
        academyId: `${academyId}-other`,
        sessionId: "under-quorum",
        startAt: window.to,
        minParticipants: 4,
        status: "scheduled",
      });
      const report = await sweepSessionQuorums(createFirestoreQuorumSweepStore(db!), now);
      expect(report).toMatchObject({
        cancelledSessions: 3,
        failedSessions: 0,
        failedMaterialisations: 2,
      });
      expect(report.failures).toEqual([
        { stage: "materialise-series", code: "malformed-series", retryable: false },
        { stage: "materialise-series", code: "malformed-series", retryable: false },
      ]);
      for (const path of [
        `${root}/sessions/existing`,
        `${root}/sessions/c-healthy`,
        `${otherRoot}/sessions/under-quorum`,
      ]) {
        expect((await db!.doc(path).get()).get("status")).toBe("cancelled");
      }
      expect((await db!.collection(`${otherRoot}/auditEvents`).get()).size).toBe(1);
    } finally {
      await db!.recursiveDelete(db!.doc(otherRoot));
    }
  });

  it("materialises an unseen weekly occurrence and cancels it without changing its series", async () => {
    const series = {
      academyId,
      seriesId: "weekly",
      timezone: "Europe/London",
      revisions: [
        {
          fromIndex: 0,
          enabled: true,
          template: {
            academyId,
            sessionId: "weekly",
            startAt: "2036-09-12T18:00:00.000Z",
            endAt: "2036-09-12T19:00:00.000Z",
            minParticipants: 4,
            status: "scheduled",
          },
        },
      ],
    };
    await db!.doc(`${root}/sessionSeries/weekly`).set(series);
    const store = createFirestoreQuorumSweepStore(db!);
    expect(await sweepSessionQuorums(store, now)).toMatchObject({
      cancelledSessions: 1,
      failedSessions: 0,
    });
    expect((await db!.doc(`${root}/sessions/weekly__week_1`).get()).get("status")).toBe(
      "cancelled",
    );
    expect((await db!.doc(`${root}/sessionSeries/weekly`).get()).data()).toEqual(series);
    expect(await sweepSessionQuorums(store, now)).toMatchObject({
      cancelledSessions: 0,
      failedSessions: 0,
    });
    expect((await db!.collection(`${root}/auditEvents`).get()).size).toBe(1);
  });

  it("preserves the existing inclusive booking cutoff, then cancels just after it", async () => {
    await seed("boundary");
    const store = createFirestoreQuorumSweepStore(db!);
    expect(await sweepSessionQuorums(store, "2036-09-19T17:00:00.000Z")).toMatchObject({
      cancelledSessions: 0,
      failedSessions: 0,
    });
    expect(await sweepSessionQuorums(store, now)).toMatchObject({
      cancelledSessions: 1,
      failedSessions: 0,
    });
  });
  it("paginates ties, filters states and paths, and includes the exact cutoff with or without milliseconds", async () => {
    await seed("page-a");
    await seed("page-b", { status: "cancelled" });
    await seed("page-c", { startAt: "2036-09-19T18:00:00Z" });
    await seed("future", { startAt: "2036-09-19T18:00:01.000Z" });
    await seed("old", { startAt: "2036-09-18T16:59:59.999Z" });
    await db!
      .doc(`${root}/archive/snapshot/sessions/nested`)
      .set({ startAt: window.to, status: "scheduled" });
    const store = createFirestoreQuorumSweepStore(db!);
    let cursor: unknown = null;
    const found: string[] = [];
    do {
      const page = await store.listPage({ ...window, limit: 1, cursor });
      found.push(...page.sessions.map((session) => session.sessionId));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(found.sort()).toEqual(["page-a", "page-c"]);
    await db!.recursiveDelete(db!.doc(root));
  });

  it("cancels and releases once under concurrent sweeps, leaving a single audit and capacity revision", async () => {
    await seed("under-quorum");
    await db!.doc(`${root}/bookings/booking-1`).set({
      academyId,
      sessionId: "under-quorum",
      bookingId: "booking-1",
      studentId: "synthetic-student",
      status: "confirmed",
    });
    const store = createFirestoreQuorumSweepStore(db!);
    const reports = await Promise.all([
      sweepSessionQuorums(store, now),
      sweepSessionQuorums(store, now),
    ]);
    expect(reports.reduce((n, report) => n + report.cancelledSessions, 0)).toBe(1);
    expect(reports.reduce((n, report) => n + report.releasedBookings, 0)).toBe(1);
    expect(reports.every((report) => report.failedSessions === 0)).toBe(true);
    expect((await db!.doc(`${root}/sessions/under-quorum`).get()).get("status")).toBe("cancelled");
    expect((await db!.doc(`${root}/bookings/booking-1`).get()).get("status")).toBe("cancelled");
    expect(
      (await db!.doc(`${root}/sessionCapacityStates/under-quorum`).get()).get("revision"),
    ).toBe(1);
    const audits = await db!.collection(`${root}/auditEvents`).get();
    expect(audits.size).toBe(1);
    expect(audits.docs[0]!.data()).toMatchObject({
      action: "session.quorum.cancelled",
      actorId: "system:quorum-sweep",
      result: "completed",
    });
    expect(await sweepSessionQuorums(store, now)).toMatchObject({
      cancelledSessions: 0,
      releasedBookings: 0,
      failedSessions: 0,
    });
    await db!.recursiveDelete(db!.doc(root));
  });

  it("isolates tenant mismatches while processing other sessions and preserves a positive minimum met by confirmed bookings", async () => {
    await seed("bad-tenant", { academyId: "other-academy" });
    await seed("healthy");
    await seed("met", { minParticipants: 2 });
    for (const bookingId of ["met-1", "met-2"]) {
      await db!.doc(`${root}/bookings/${bookingId}`).set({
        academyId,
        sessionId: "met",
        bookingId,
        studentId: `synthetic-${bookingId}`,
        status: "confirmed",
      });
    }
    const report = await sweepSessionQuorums(createFirestoreQuorumSweepStore(db!), now);
    expect(report).toMatchObject({ evaluatedSessions: 3, cancelledSessions: 1, failedSessions: 1 });
    expect((await db!.doc(`${root}/sessions/bad-tenant`).get()).get("status")).toBe("scheduled");
    expect((await db!.doc(`${root}/sessions/met`).get()).get("status")).toBe("scheduled");
    expect((await db!.doc(`${root}/auditEvents/session-quorum-cancelled-met`).get()).exists).toBe(
      false,
    );
    expect(
      (
        await db!
          .collection(`${root}/auditEvents`)
          .where("targetRef", "==", `${root}/sessions/met`)
          .get()
      ).empty,
    ).toBe(true);
    for (const bookingId of ["met-1", "met-2"]) {
      expect((await db!.doc(`${root}/bookings/${bookingId}`).get()).get("status")).toBe(
        "confirmed",
      );
    }
    expect((await db!.collection(`${root}/auditEvents`).get()).size).toBe(1);
  });
});
