import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import { PLAN_CATALOG } from "../../packages/domain/src/memberships/plan-contracts.js";
import { buildLegacyWaitlistId } from "../../packages/domain/src/schedule/advanced-booking-contracts.js";
import { buildBookingId } from "../../packages/domain/src/schedule/schedule-contracts.js";
import {
  createFirestoreWaitlistStore,
  WaitlistStoreError,
} from "../../apps/functions/src/schedule/advanced-booking-service.js";
import { createFirestoreScheduleStore } from "../../apps/functions/src/schedule/schedule-service.js";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();

function isLocalEmulatorHost(host: string | undefined): boolean {
  if (host === undefined || host === "") return false;
  try {
    const url = new URL("http://" + host);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]") &&
      url.pathname === "/" &&
      url.port !== ""
    );
  } catch {
    return false;
  }
}

const useLocalEmulator = isLocalEmulatorHost(emulatorHost);
if (!useLocalEmulator) {
  console.warn(
    "SKIP waitlist offer transaction integration: FIRESTORE_EMULATOR_HOST must be local",
  );
}

const runId = "waitlist-offer-" + process.pid + "-" + randomUUID();
const app = useLocalEmulator ? initializeApp({ projectId: "demo-bpt-jersey" }, runId) : undefined;
const firestore = app === undefined ? undefined : getFirestore(app);
const store =
  firestore === undefined
    ? undefined
    : createFirestoreWaitlistStore({
        firestore: firestore as unknown as Parameters<
          typeof createFirestoreWaitlistStore
        >[0]["firestore"],
      });
const academyIds = new Set<string>();
const collections = [
  "sessions",
  "programs",
  "plans",
  "students",
  "memberships",
  "bookings",
  "waitlistEntries",
  "waitlistPositionStates",
  "sessionCapacityStates",
  "bookingQuotaStates",
  "invoices",
  "payments",
  "auditEvents",
] as const;
const sessionId = "session-main";
const sessionStartAt = "2099-09-01T18:00:00.000Z";
const baseNow = "2099-09-01T12:00:00.000Z";

function db() {
  if (firestore === undefined) throw new Error("Firestore emulator is unavailable");
  return firestore;
}

function waitlistStore() {
  if (store === undefined) throw new Error("Waitlist store is unavailable");
  return store;
}

function studentRecord(academyId: string, studentId: string) {
  return {
    studentId,
    academyId,
    familyId: "family-" + studentId,
    userId: studentId,
    fullName: "Synthetic " + studentId,
    dateOfBirth: "1990-01-01",
    phoneNumber: "+441534000000",
    email: studentId + "@example.test",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "owner-1",
  };
}

function membershipRecord(academyId: string, studentId: string, membershipId: string) {
  return {
    membershipId,
    academyId,
    familyId: "family-" + studentId,
    studentId,
    planId: "bpt-jersey-adult",
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: null,
    nextBillingAt: null,
    schemaVersion: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "owner-1",
  };
}

function sessionRecord(academyId: string) {
  return {
    sessionId,
    academyId,
    classId: null,
    programId: "adult-fundamentals",
    locationId: "town",
    instructorId: "coach-1",
    title: "Synthetic waitlist class",
    startAt: sessionStartAt,
    endAt: "2099-09-01T19:00:00.000Z",
    capacity: 1,
    minParticipants: 1,
    status: "scheduled",
    isSeminar: false,
    cancellationReason: null,
    schemaVersion: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "owner-1",
  };
}

async function seedScenario(label: string, candidateCount = 3) {
  const academyId = runId + "-" + label;
  const seatHolderId = "seat-holder";
  const seatHolderBookingId = buildBookingId(sessionId, seatHolderId);
  academyIds.add(academyId);
  const plan = PLAN_CATALOG.find((item) => item.planId === "bpt-jersey-adult");
  if (plan === undefined) throw new Error("Synthetic plan is unavailable");

  await Promise.all([
    db()
      .doc("academies/" + academyId + "/sessions/" + sessionId)
      .set(sessionRecord(academyId)),
    db()
      .doc("academies/" + academyId + "/programs/adult-fundamentals")
      .set({
        programId: "adult-fundamentals",
        academyId,
        name: "Adult Fundamentals",
        ageBand: "adult",
        discipline: "bjj",
        level: "fundamentals",
        active: true,
        schemaVersion: "1",
      }),
    db()
      .doc("academies/" + academyId + "/plans/bpt-jersey-adult")
      .set({
        ...plan,
        academyId,
        active: true,
        schemaVersion: "1",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: "owner-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
        updatedBy: "owner-1",
      }),
    db()
      .doc("academies/" + academyId + "/bookings/" + seatHolderBookingId)
      .set({
        bookingId: seatHolderBookingId,
        academyId,
        sessionId,
        studentId: seatHolderId,
        membershipId: "membership-seat-holder",
        status: "confirmed",
        requestedAt: "2099-08-01T00:00:00.000Z",
        cancelledAt: null,
        cancellationReason: null,
        schemaVersion: "1",
        createdAt: "2099-08-01T00:00:00.000Z",
        createdBy: seatHolderId,
        updatedAt: "2099-08-01T00:00:00.000Z",
        updatedBy: seatHolderId,
      }),
    ...Array.from({ length: candidateCount }, (_, index) => {
      const studentId = "student-" + (index + 1);
      return [
        db()
          .doc("academies/" + academyId + "/students/" + studentId)
          .set(studentRecord(academyId, studentId)),
        db()
          .doc("academies/" + academyId + "/memberships/membership-" + (index + 1))
          .set(membershipRecord(academyId, studentId, "membership-" + (index + 1))),
      ];
    }).flat(),
  ]);

  return Object.freeze({ academyId, seatHolderBookingId });
}

async function joinCandidate(academyId: string, index: number, now: string) {
  const studentId = "student-" + index;
  return waitlistStore().joinWaitlist({
    academyId,
    request: {
      sessionId,
      studentId,
      membershipId: "membership-" + index,
    },
    actorId: studentId,
    now,
  });
}

async function setSeatStatus(
  academyId: string,
  bookingId: string,
  status: "confirmed" | "cancelled",
  now: string,
) {
  await db()
    .doc("academies/" + academyId + "/bookings/" + bookingId)
    .update({
      status,
      cancelledAt: status === "cancelled" ? now : null,
      cancellationReason: status === "cancelled" ? "Synthetic seat release" : null,
      updatedAt: now,
      updatedBy: "owner-1",
    });
}

async function auditRecords(academyId: string) {
  const snapshot = await db()
    .collection("academies/" + academyId + "/auditEvents")
    .get();
  return snapshot.docs.map((document) => document.data());
}

async function waitlistRecords(academyId: string) {
  const snapshot = await db()
    .collection("academies/" + academyId + "/waitlistEntries")
    .get();
  return snapshot.docs.map((document) => document.data());
}

afterAll(async () => {
  if (firestore !== undefined) {
    for (const academyId of academyIds) {
      for (const name of collections) {
        const snapshot = await firestore.collection("academies/" + academyId + "/" + name).get();
        await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
      }
    }
  }
  if (app !== undefined) await deleteApp(app);
});

const describeEmulator = useLocalEmulator ? describe : describe.skip;

describeEmulator("waitlist offer transactions against Firebase Emulator", () => {
  it("issues FIFO once, preserves TTL on replay, and reserves the only seat", async () => {
    const scenario = await seedScenario("fifo", 3);
    const first = await joinCandidate(scenario.academyId, 1, "2099-09-01T11:00:00.000Z");
    const second = await joinCandidate(scenario.academyId, 2, "2099-09-01T11:01:00.000Z");
    expect([first.position, second.position]).toEqual([1, 2]);

    await expect(
      waitlistStore().issueNextWaitlistOffer({
        academyId: scenario.academyId,
        sessionId,
        actorId: "owner-1",
        now: baseNow,
      }),
    ).rejects.toMatchObject<Partial<WaitlistStoreError>>({ code: "ineligible" });
    expect(await auditRecords(scenario.academyId)).toHaveLength(0);

    await setSeatStatus(
      scenario.academyId,
      scenario.seatHolderBookingId,
      "cancelled",
      "2099-09-01T11:30:00.000Z",
    );
    const issued = await waitlistStore().issueNextWaitlistOffer({
      academyId: scenario.academyId,
      sessionId,
      actorId: "owner-1",
      now: baseNow,
    });
    expect(issued).toMatchObject({
      waitlistId: first.waitlistId,
      studentId: "student-1",
      position: 1,
      status: "offered",
      offeredAt: baseNow,
      offerExpiresAt: "2099-09-01T12:30:00.000Z",
    });

    const replays = await Promise.all([
      waitlistStore().issueNextWaitlistOffer({
        academyId: scenario.academyId,
        sessionId,
        actorId: "administrator-1",
        now: "2099-09-01T12:10:00.000Z",
      }),
      waitlistStore().issueNextWaitlistOffer({
        academyId: scenario.academyId,
        sessionId,
        actorId: "owner-1",
        now: "2099-09-01T12:20:00.000Z",
      }),
    ]);
    expect(replays).toEqual([issued, issued]);

    const third = await joinCandidate(scenario.academyId, 3, "2099-09-01T12:21:00.000Z");
    expect(third.position).toBe(3);
    const entries = await waitlistRecords(scenario.academyId);
    expect(entries.filter((entry) => entry.status === "offered")).toHaveLength(1);
    expect(
      entries
        .filter((entry) => entry.status === "waiting")
        .map((entry) => entry.position)
        .sort((left, right) => left - right),
    ).toEqual([2, 3]);
    expect(
      (await auditRecords(scenario.academyId)).filter(
        (event) => event.action === "waitlist.offer.issued",
      ),
    ).toHaveLength(1);
  }, 60_000);

  it("breaks duplicate historical positions by absolute request instant", async () => {
    const scenario = await seedScenario("fifo-offset", 2);
    const first = await joinCandidate(scenario.academyId, 1, "2099-09-01T11:00:00.000Z");
    const second = await joinCandidate(scenario.academyId, 2, "2099-09-01T11:01:00.000Z");
    await Promise.all([
      db()
        .doc(`academies/${scenario.academyId}/waitlistEntries/${first.waitlistId}`)
        .update({ position: 1, requestedAt: "2099-09-01T11:00:00Z" }),
      db().doc(`academies/${scenario.academyId}/waitlistEntries/${second.waitlistId}`).update({
        position: 1,
        requestedAt: "2099-09-01T11:30:00+01:00",
        createdAt: "2099-09-01T11:30:00+01:00",
        updatedAt: "2099-09-01T11:30:00+01:00",
      }),
    ]);
    await setSeatStatus(
      scenario.academyId,
      scenario.seatHolderBookingId,
      "cancelled",
      "2099-09-01T11:30:00.000Z",
    );

    const issued = await waitlistStore().issueNextWaitlistOffer({
      academyId: scenario.academyId,
      sessionId,
      actorId: "owner-1",
      now: baseNow,
    });
    const listed = await waitlistStore().listSessionWaitlist(scenario.academyId, sessionId);

    expect(issued.studentId).toBe("student-2");
    expect(listed.map((entry) => entry.studentId)).toEqual(["student-2", "student-1"]);
  }, 60_000);

  it("fails closed for physical duals and a colliding legacy waitlist identity", async () => {
    const scenario = await seedScenario("legacy-collision", 1);
    const queued = await joinCandidate(scenario.academyId, 1, "2099-09-01T11:00:00.000Z");
    const legacyId = buildLegacyWaitlistId(sessionId, queued.studentId);
    await db()
      .doc(`academies/${scenario.academyId}/waitlistEntries/${legacyId}`)
      .set({ ...queued, waitlistId: legacyId });
    await setSeatStatus(
      scenario.academyId,
      scenario.seatHolderBookingId,
      "cancelled",
      "2099-09-01T11:30:00.000Z",
    );

    await expect(
      waitlistStore().issueNextWaitlistOffer({
        academyId: scenario.academyId,
        sessionId,
        actorId: "owner-1",
        now: baseNow,
      }),
    ).rejects.toMatchObject<Partial<WaitlistStoreError>>({ code: "conflict" });
    expect(
      (await waitlistRecords(scenario.academyId))
        .filter((entry) => [queued.waitlistId, legacyId].includes(entry.waitlistId as string))
        .every((entry) => entry.status === "waiting"),
    ).toBe(true);

    await db()
      .doc(`academies/${scenario.academyId}/waitlistEntries/${legacyId}`)
      .set({
        ...queued,
        waitlistId: legacyId,
        status: "cancelled",
        cancelledAt: baseNow,
        updatedAt: baseNow,
      });
    await expect(
      waitlistStore().issueNextWaitlistOffer({
        academyId: scenario.academyId,
        sessionId,
        actorId: "owner-1",
        now: baseNow,
      }),
    ).rejects.toMatchObject<Partial<WaitlistStoreError>>({ code: "conflict" });

    await db()
      .doc(`academies/${scenario.academyId}/waitlistEntries/${queued.waitlistId}`)
      .set({
        ...queued,
        status: "offered",
        offeredAt: baseNow,
        offerExpiresAt: "2099-09-01T12:30:00.000Z",
        updatedAt: baseNow,
      });
    await expect(
      waitlistStore().issueNextWaitlistOffer({
        academyId: scenario.academyId,
        sessionId,
        actorId: "owner-1",
        now: "2099-09-01T12:10:00.000Z",
      }),
    ).rejects.toMatchObject<Partial<WaitlistStoreError>>({ code: "conflict" });

    const collisionId = buildLegacyWaitlistId("session__student", "one");
    expect(collisionId).toBe(buildLegacyWaitlistId("session", "student__one"));
    await db()
      .doc(`academies/${scenario.academyId}/waitlistEntries/${collisionId}`)
      .set({
        ...queued,
        waitlistId: collisionId,
        sessionId: "session__student",
        studentId: "one",
      });
    await expect(
      waitlistStore().cancelWaitlist({
        academyId: scenario.academyId,
        sessionId: "session",
        studentId: "student__one",
        actorId: "student__one",
        now: baseNow,
      }),
    ).rejects.toMatchObject<Partial<WaitlistStoreError>>({ code: "conflict" });
    await expect(
      db().doc(`academies/${scenario.academyId}/waitlistEntries/${collisionId}`).get(),
    ).resolves.toMatchObject({ exists: true });
    expect(
      (
        await db().doc(`academies/${scenario.academyId}/waitlistEntries/${collisionId}`).get()
      ).data()?.status,
    ).toBe("waiting");
  }, 60_000);

  it("accepts atomically, rolls back a capacity failure, and replays after cutoff", async () => {
    const scenario = await seedScenario("accept", 1);
    const queued = await joinCandidate(scenario.academyId, 1, "2099-09-01T11:00:00.000Z");
    await setSeatStatus(
      scenario.academyId,
      scenario.seatHolderBookingId,
      "cancelled",
      "2099-09-01T11:30:00.000Z",
    );
    await waitlistStore().issueNextWaitlistOffer({
      academyId: scenario.academyId,
      sessionId,
      actorId: "owner-1",
      now: baseNow,
    });

    await setSeatStatus(
      scenario.academyId,
      scenario.seatHolderBookingId,
      "confirmed",
      "2099-09-01T12:04:00.000Z",
    );
    await expect(
      waitlistStore().respondToWaitlistOffer({
        academyId: scenario.academyId,
        sessionId,
        studentId: "student-1",
        response: "accept",
        actorId: "student-1",
        now: "2099-09-01T12:05:00.000Z",
      }),
    ).rejects.toMatchObject<Partial<WaitlistStoreError>>({ code: "ineligible" });

    const bookingRef = db().doc(
      "academies/" + scenario.academyId + "/bookings/" + buildBookingId(sessionId, "student-1"),
    );
    expect((await bookingRef.get()).exists).toBe(false);
    expect(
      (
        await db()
          .doc("academies/" + scenario.academyId + "/waitlistEntries/" + queued.waitlistId)
          .get()
      ).data(),
    ).toMatchObject({ status: "offered", acceptedAt: null });
    expect(
      (await auditRecords(scenario.academyId)).filter(
        (event) => event.action === "waitlist.offer.accepted",
      ),
    ).toHaveLength(0);

    await setSeatStatus(
      scenario.academyId,
      scenario.seatHolderBookingId,
      "cancelled",
      "2099-09-01T12:06:00.000Z",
    );
    const accepted = await waitlistStore().respondToWaitlistOffer({
      academyId: scenario.academyId,
      sessionId,
      studentId: "student-1",
      response: "accept",
      actorId: "student-1",
      now: "2099-09-01T12:10:00.000Z",
    });
    expect(accepted).toMatchObject({
      status: "accepted",
      acceptedAt: "2099-09-01T12:10:00.000Z",
      waitlistId: queued.waitlistId,
    });
    expect((await bookingRef.get()).data()).toMatchObject({
      academyId: scenario.academyId,
      sessionId,
      studentId: "student-1",
      membershipId: "membership-1",
      status: "confirmed",
    });

    const acceptedAudits = (await auditRecords(scenario.academyId)).filter(
      (event) => event.action === "waitlist.offer.accepted",
    );
    expect(acceptedAudits).toHaveLength(1);
    expect(acceptedAudits[0]).toMatchObject({
      actorId: "student-1",
      targetRef: "academies/" + scenario.academyId + "/waitlistEntries/" + queued.waitlistId,
    });

    await expect(
      waitlistStore().respondToWaitlistOffer({
        academyId: scenario.academyId,
        sessionId,
        studentId: "student-1",
        response: "accept",
        actorId: "student-1",
        now: "2099-09-01T17:30:00.000Z",
      }),
    ).resolves.toEqual(accepted);
    expect(
      (await auditRecords(scenario.academyId)).filter(
        (event) => event.action === "waitlist.offer.accepted",
      ),
    ).toHaveLength(1);
  }, 60_000);

  it("does not let a stale idempotent cancellation overwrite an accepted offer", async () => {
    const scenario = await seedScenario("accept-cancel-race", 1);
    const queued = await joinCandidate(scenario.academyId, 1, "2099-09-01T11:00:00.000Z");
    await setSeatStatus(
      scenario.academyId,
      scenario.seatHolderBookingId,
      "cancelled",
      "2099-09-01T11:30:00.000Z",
    );
    const candidateBookingId = buildBookingId(sessionId, "student-1");
    await db()
      .doc("academies/" + scenario.academyId + "/bookings/" + candidateBookingId)
      .set({
        bookingId: candidateBookingId,
        academyId: scenario.academyId,
        sessionId,
        studentId: "student-1",
        membershipId: "membership-1",
        status: "cancelled",
        requestedAt: "2099-08-01T00:00:00.000Z",
        cancelledAt: "2099-08-02T00:00:00.000Z",
        cancellationReason: "Earlier cancellation",
        schemaVersion: "1",
        createdAt: "2099-08-01T00:00:00.000Z",
        createdBy: "student-1",
        updatedAt: "2099-08-02T00:00:00.000Z",
        updatedBy: "student-1",
      });
    await waitlistStore().issueNextWaitlistOffer({
      academyId: scenario.academyId,
      sessionId,
      actorId: "owner-1",
      now: baseNow,
    });

    let releaseCancellation!: () => void;
    let signalStaleRead!: () => void;
    const cancellationRelease = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const staleRead = new Promise<void>((resolve) => {
      signalStaleRead = resolve;
    });
    let firstTransactionPass = true;
    const delayedFirestore = new Proxy(db(), {
      get(target, property) {
        if (property === "runTransaction") {
          return async (update: (transaction: unknown) => Promise<unknown>): Promise<unknown> =>
            target.runTransaction(async (transaction) => {
              const result = await update(transaction);
              if (firstTransactionPass) {
                firstTransactionPass = false;
                signalStaleRead();
                await cancellationRelease;
              }
              return result;
            });
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const delayedScheduleStore = createFirestoreScheduleStore({
      firestore: delayedFirestore as unknown as Parameters<
        typeof createFirestoreScheduleStore
      >[0]["firestore"],
    });
    const cancellation = delayedScheduleStore.cancelBooking(
      scenario.academyId,
      {
        sessionId,
        studentId: "student-1",
        reason: "Concurrent retry",
      },
      "student-1",
    );
    await staleRead;

    const acceptance = waitlistStore().respondToWaitlistOffer({
      academyId: scenario.academyId,
      sessionId,
      studentId: "student-1",
      response: "accept",
      actorId: "student-1",
      now: "2099-09-01T12:05:00.000Z",
    });
    releaseCancellation();
    await expect(cancellation).resolves.toMatchObject({ status: "cancelled" });
    await expect(acceptance).resolves.toMatchObject({
      waitlistId: queued.waitlistId,
      status: "accepted",
    });
    await expect(
      db()
        .doc("academies/" + scenario.academyId + "/bookings/" + candidateBookingId)
        .get(),
    ).resolves.toMatchObject({ exists: true });
    expect(
      (
        await db()
          .doc("academies/" + scenario.academyId + "/bookings/" + candidateBookingId)
          .get()
      ).data(),
    ).toMatchObject({
      status: "confirmed",
      cancellationReason: null,
    });
  }, 60_000);

  it("makes decline terminal and idempotent without creating a booking", async () => {
    const scenario = await seedScenario("decline", 1);
    await joinCandidate(scenario.academyId, 1, "2099-09-01T11:00:00.000Z");
    await setSeatStatus(
      scenario.academyId,
      scenario.seatHolderBookingId,
      "cancelled",
      "2099-09-01T11:30:00.000Z",
    );
    await waitlistStore().issueNextWaitlistOffer({
      academyId: scenario.academyId,
      sessionId,
      actorId: "owner-1",
      now: baseNow,
    });
    const declined = await waitlistStore().respondToWaitlistOffer({
      academyId: scenario.academyId,
      sessionId,
      studentId: "student-1",
      response: "decline",
      actorId: "guardian-1",
      now: "2099-09-01T12:05:00.000Z",
    });
    expect(declined).toMatchObject({
      status: "cancelled",
      cancelledAt: "2099-09-01T12:05:00.000Z",
    });
    await expect(
      waitlistStore().respondToWaitlistOffer({
        academyId: scenario.academyId,
        sessionId,
        studentId: "student-1",
        response: "decline",
        actorId: "guardian-1",
        now: "2099-09-01T13:00:00.000Z",
      }),
    ).resolves.toEqual(declined);
    await expect(
      waitlistStore().respondToWaitlistOffer({
        academyId: scenario.academyId,
        sessionId,
        studentId: "student-1",
        response: "accept",
        actorId: "student-1",
        now: "2099-09-01T13:01:00.000Z",
      }),
    ).rejects.toMatchObject<Partial<WaitlistStoreError>>({ code: "ineligible" });
    expect(
      (
        await db()
          .doc(
            "academies/" +
              scenario.academyId +
              "/bookings/" +
              buildBookingId(sessionId, "student-1"),
          )
          .get()
      ).exists,
    ).toBe(false);
    expect(
      (await auditRecords(scenario.academyId)).filter(
        (event) => event.action === "waitlist.offer.declined",
      ),
    ).toHaveLength(1);
  }, 60_000);

  it("materializes expiration at the exact boundary and audits it once", async () => {
    const scenario = await seedScenario("expiry", 1);
    const queued = await joinCandidate(scenario.academyId, 1, "2099-09-01T11:00:00.000Z");
    await setSeatStatus(
      scenario.academyId,
      scenario.seatHolderBookingId,
      "cancelled",
      "2099-09-01T11:30:00.000Z",
    );
    const offered = await waitlistStore().issueNextWaitlistOffer({
      academyId: scenario.academyId,
      sessionId,
      actorId: "owner-1",
      now: baseNow,
    });
    expect(offered.offerExpiresAt).toBe("2099-09-01T12:30:00.000Z");

    await expect(
      waitlistStore().respondToWaitlistOffer({
        academyId: scenario.academyId,
        sessionId,
        studentId: "student-1",
        response: "accept",
        actorId: "student-1",
        now: "2099-09-01T12:30:00.000Z",
      }),
    ).rejects.toMatchObject<Partial<WaitlistStoreError>>({ code: "ineligible" });
    const stored = await db()
      .doc("academies/" + scenario.academyId + "/waitlistEntries/" + queued.waitlistId)
      .get();
    expect(stored.data()).toMatchObject({
      status: "expired",
      offeredAt: baseNow,
      offerExpiresAt: "2099-09-01T12:30:00.000Z",
      acceptedAt: null,
      updatedAt: "2099-09-01T12:30:00.000Z",
    });

    await expect(
      waitlistStore().respondToWaitlistOffer({
        academyId: scenario.academyId,
        sessionId,
        studentId: "student-1",
        response: "accept",
        actorId: "student-1",
        now: "2099-09-01T12:31:00.000Z",
      }),
    ).rejects.toMatchObject<Partial<WaitlistStoreError>>({ code: "ineligible" });
    expect(
      (await auditRecords(scenario.academyId)).filter(
        (event) => event.action === "waitlist.offer.expired",
      ),
    ).toHaveLength(1);
    expect(
      (
        await db()
          .doc(
            "academies/" +
              scenario.academyId +
              "/bookings/" +
              buildBookingId(sessionId, "student-1"),
          )
          .get()
      ).exists,
    ).toBe(false);
  }, 60_000);
});
