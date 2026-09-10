import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PLAN_CATALOG } from "../../packages/domain/src/memberships/plan-contracts.js";
import {
  buildBookingId,
  buildLegacyBookingId,
} from "../../packages/domain/src/schedule/schedule-contracts.js";
import { BookingTransactionError } from "../../apps/functions/src/schedule/booking-transaction-service.js";
import { createFirestoreScheduleStore } from "../../apps/functions/src/schedule/schedule-service.js";

const runId = "booking-transaction-" + process.pid + "-" + randomUUID();
const academyId = runId + "-academy";
const app = initializeApp({ projectId: "demo-bpt-jersey" }, runId);
const firestore = getFirestore(app);
const store = createFirestoreScheduleStore({
  firestore: firestore as unknown as Parameters<
    typeof createFirestoreScheduleStore
  >[0]["firestore"],
});
const collections = [
  "sessions",
  "programs",
  "plans",
  "students",
  "memberships",
  "bookings",
  "waitlistEntries",
  "sessionCapacityStates",
  "bookingQuotaStates",
  "invoices",
  "payments",
] as const;

function membership(membershipId: string, studentId: string, familyId = "family-" + studentId) {
  return {
    membershipId,
    academyId,
    familyId,
    studentId,
    planId: "bpt-jersey-adult",
    status: "active",
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: null,
    nextBillingAt: null,
    schemaVersion: "1",
    createdAt: "2026-01-01T00:00:00Z",
    createdBy: "owner-1",
    updatedAt: "2026-01-01T00:00:00Z",
    updatedBy: "owner-1",
  };
}

function student(studentId: string, familyId = "family-" + studentId) {
  return {
    studentId,
    academyId,
    familyId,
    userId: studentId,
    fullName: "Synthetic " + studentId,
    dateOfBirth: "1990-01-01",
    phoneNumber: "+441534000000",
    email: studentId + "@example.test",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    schemaVersion: "1",
    createdAt: "2026-01-01T00:00:00Z",
    createdBy: "owner-1",
    updatedAt: "2026-01-01T00:00:00Z",
    updatedBy: "owner-1",
    status: "active",
  };
}

function session(sessionId: string, capacity: number, startAt = "2099-09-01T18:00:00Z") {
  return {
    sessionId,
    academyId,
    classId: null,
    programId: "adult-fundamentals",
    locationId: "town",
    instructorId: "coach-1",
    title: "Synthetic booking class",
    startAt,
    endAt: new Date(Date.parse(startAt) + 60 * 60 * 1000).toISOString(),
    capacity,
    minParticipants: 1,
    status: "scheduled",
    isSeminar: false,
    cancellationReason: null,
    schemaVersion: "1",
    createdAt: "2026-01-01T00:00:00Z",
    createdBy: "owner-1",
    updatedAt: "2026-01-01T00:00:00Z",
    updatedBy: "owner-1",
  };
}

function booking(input: {
  sessionId: string;
  studentId: string;
  membershipId: string;
  status: "confirmed" | "cancelled";
}) {
  const bookingId = buildBookingId(input.sessionId, input.studentId);
  const timestamp = "2026-01-02T00:00:00Z";
  return {
    bookingId,
    academyId,
    sessionId: input.sessionId,
    studentId: input.studentId,
    membershipId: input.membershipId,
    status: input.status,
    requestedAt: timestamp,
    cancelledAt: input.status === "cancelled" ? timestamp : null,
    cancellationReason: input.status === "cancelled" ? "Synthetic historical cancellation" : null,
    schemaVersion: "1",
    createdAt: timestamp,
    createdBy: "owner-1",
    updatedAt: timestamp,
    updatedBy: "owner-1",
  };
}

async function seedStudentMembership(input: {
  studentId: string;
  membershipId: string;
  studentFamilyId?: string;
  membershipFamilyId?: string;
  dateOfBirth?: string;
  participantType?: "adult" | "minor";
  planId?: string;
}) {
  const studentFamilyId = input.studentFamilyId ?? "family-" + input.studentId;
  const membershipFamilyId = input.membershipFamilyId ?? studentFamilyId;
  await Promise.all([
    firestore.doc("academies/" + academyId + "/students/" + input.studentId).set({
      ...student(input.studentId, studentFamilyId),
      ...(input.dateOfBirth === undefined ? {} : { dateOfBirth: input.dateOfBirth }),
      ...(input.participantType === undefined ? {} : { participantType: input.participantType }),
    }),
    firestore.doc("academies/" + academyId + "/memberships/" + input.membershipId).set({
      ...membership(input.membershipId, input.studentId, membershipFamilyId),
      ...(input.planId === undefined ? {} : { planId: input.planId }),
    }),
  ]);
}

beforeAll(async () => {
  const adultPlan = PLAN_CATALOG.find((item) => item.planId === "bpt-jersey-adult");
  const kidsPlan = PLAN_CATALOG.find((item) => item.planId === "town-kids-1x");
  if (adultPlan === undefined || kidsPlan === undefined) throw new Error("Synthetic plan missing");
  await Promise.all([
    firestore.doc("academies/" + academyId + "/programs/adult-fundamentals").set({
      programId: "adult-fundamentals",
      academyId,
      name: "Adult Fundamentals",
      ageBand: "adult",
      discipline: "bjj",
      level: "fundamentals",
      active: true,
      schemaVersion: "1",
    }),
    firestore.doc("academies/" + academyId + "/plans/bpt-jersey-adult").set({
      ...adultPlan,
      academyId,
      active: true,
      schemaVersion: "1",
      createdAt: "2026-01-01T00:00:00Z",
      createdBy: "owner-1",
      updatedAt: "2026-01-01T00:00:00Z",
      updatedBy: "owner-1",
    }),
    firestore.doc("academies/" + academyId + "/programs/kids-fundamentals").set({
      programId: "kids-fundamentals",
      academyId,
      name: "Kids Fundamentals",
      ageBand: "kids",
      discipline: "bjj",
      level: "fundamentals",
      active: true,
      schemaVersion: "1",
    }),
    firestore.doc("academies/" + academyId + "/plans/town-kids-1x").set({
      ...kidsPlan,
      academyId,
      active: true,
      schemaVersion: "1",
      createdAt: "2026-01-01T00:00:00Z",
      createdBy: "owner-1",
      updatedAt: "2026-01-01T00:00:00Z",
      updatedBy: "owner-1",
    }),
    ...["student-1", "student-2"].flatMap((studentId, index) => [
      firestore.doc("academies/" + academyId + "/students/" + studentId).set(student(studentId)),
      firestore
        .doc("academies/" + academyId + "/memberships/membership-" + (index + 1))
        .set(membership("membership-" + (index + 1), studentId)),
    ]),
  ]);
});

afterAll(async () => {
  for (const name of collections) {
    const snapshot = await firestore.collection("academies/" + academyId + "/" + name).get();
    await Promise.all(snapshot.docs.map((item) => item.ref.delete()));
  }
  await deleteApp(app);
});

describe("transactional booking against the Firestore emulator", () => {
  it("serializes repeated contenders for the last place without partial lock writes", async () => {
    const repetitions = 6;

    for (let index = 0; index < repetitions; index += 1) {
      const sessionId = "session-last-place-" + index;
      const contenders = ["a", "b"].map((suffix) => ({
        studentId: "race-student-" + index + "-" + suffix,
        membershipId: "race-membership-" + index + "-" + suffix,
      }));
      await Promise.all([
        firestore
          .doc("academies/" + academyId + "/sessions/" + sessionId)
          .set(session(sessionId, 1)),
        ...contenders.map((contender) => seedStudentMembership(contender)),
      ]);

      const results = await Promise.allSettled(
        contenders.map((contender) =>
          store.requestBooking(
            academyId,
            {
              sessionId,
              studentId: contender.studentId,
              membershipId: contender.membershipId,
            },
            contender.studentId,
          ),
        ),
      );

      const fulfilled = results.filter(
        (
          result,
        ): result is PromiseFulfilledResult<Awaited<ReturnType<typeof store.requestBooking>>> =>
          result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toBeInstanceOf(BookingTransactionError);
      expect(rejected[0]!.reason).toMatchObject({ code: "capacity" });

      const bookings = await firestore
        .collection("academies/" + academyId + "/bookings")
        .where("sessionId", "==", sessionId)
        .get();
      const confirmed = bookings.docs.filter((item) => item.data().status === "confirmed");
      expect(confirmed).toHaveLength(1);
      expect(confirmed[0]!.data().studentId).toBe(fulfilled[0]!.value.studentId);

      const capacityState = await firestore
        .doc("academies/" + academyId + "/sessionCapacityStates/" + sessionId)
        .get();
      expect(capacityState.exists).toBe(true);
      expect(capacityState.data()).toMatchObject({
        academyId,
        sessionId,
        revision: 1,
        schemaVersion: "1",
      });

      const winnerQuota = await firestore
        .collection("academies/" + academyId + "/bookingQuotaStates")
        .where("studentId", "==", fulfilled[0]!.value.studentId)
        .get();
      const loser = contenders.find(
        (contender) => contender.studentId !== fulfilled[0]!.value.studentId,
      )!;
      const loserQuota = await firestore
        .collection("academies/" + academyId + "/bookingQuotaStates")
        .where("studentId", "==", loser.studentId)
        .get();
      expect(winnerQuota.docs).toHaveLength(1);
      expect(winnerQuota.docs[0]!.data()).toMatchObject({
        academyId,
        studentId: fulfilled[0]!.value.studentId,
        revision: 1,
        schemaVersion: "1",
      });
      expect(loserQuota.docs).toHaveLength(0);
    }
  }, 60_000);

  it("ignores a confirmed booking whose historical session was cancelled in another week", async () => {
    const studentId = "student-cancelled-session";
    const membershipId = "membership-cancelled-session";
    const historicalSessionId = "session-cancelled-history";
    const targetSessionId = "session-after-cancelled-history";
    await seedStudentMembership({ studentId, membershipId });
    await Promise.all([
      firestore.doc("academies/" + academyId + "/sessions/" + historicalSessionId).set({
        ...session(historicalSessionId, 2, "2099-08-17T18:00:00Z"),
        status: "cancelled",
        cancellationReason: "Synthetic cancellation",
      }),
      firestore
        .doc("academies/" + academyId + "/sessions/" + targetSessionId)
        .set(session(targetSessionId, 2, "2099-09-01T18:00:00Z")),
      firestore
        .doc(
          "academies/" + academyId + "/bookings/" + buildBookingId(historicalSessionId, studentId),
        )
        .set(
          booking({
            sessionId: historicalSessionId,
            studentId,
            membershipId,
            status: "confirmed",
          }),
        ),
    ]);

    await expect(
      store.requestBooking(
        academyId,
        { sessionId: targetSessionId, studentId, membershipId },
        studentId,
      ),
    ).resolves.toMatchObject({
      sessionId: targetSessionId,
      studentId,
      status: "confirmed",
    });
  });

  it("does not permanently deny booking after more than 200 cancelled historical bookings", async () => {
    const studentId = "student-over-history-limit";
    const membershipId = "membership-over-history-limit";
    const targetSessionId = "session-after-history-limit";
    await seedStudentMembership({ studentId, membershipId });
    await firestore
      .doc("academies/" + academyId + "/sessions/" + targetSessionId)
      .set(session(targetSessionId, 2, "2099-10-01T18:00:00Z"));

    const batch = firestore.batch();
    for (let index = 0; index < 201; index += 1) {
      const historicalSessionId = "cancelled-history-" + index;
      const record = booking({
        sessionId: historicalSessionId,
        studentId,
        membershipId,
        status: "cancelled",
      });
      batch.set(firestore.doc("academies/" + academyId + "/bookings/" + record.bookingId), record);
    }
    await batch.commit();

    await expect(
      store.requestBooking(
        academyId,
        { sessionId: targetSessionId, studentId, membershipId },
        studentId,
      ),
    ).resolves.toMatchObject({
      sessionId: targetSessionId,
      studentId,
      status: "confirmed",
    });
  });

  it("fails closed when membership and student belong to different families", async () => {
    const studentId = "student-family-mismatch";
    const membershipId = "membership-family-mismatch";
    const sessionId = "session-family-mismatch";
    await seedStudentMembership({
      studentId,
      membershipId,
      studentFamilyId: "family-student-scope",
      membershipFamilyId: "family-membership-scope",
    });
    await firestore
      .doc("academies/" + academyId + "/sessions/" + sessionId)
      .set(session(sessionId, 2));

    await expect(
      store.requestBooking(academyId, { sessionId, studentId, membershipId }, studentId),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      firestore
        .doc("academies/" + academyId + "/bookings/" + buildBookingId(sessionId, studentId))
        .get(),
    ).resolves.toMatchObject({ exists: false });
  });

  it.each([
    {
      label: "minor in an adult program",
      studentId: "minor-adult-program",
      membershipId: "membership-minor-adult-program",
      dateOfBirth: "2017-01-01",
      participantType: "minor" as const,
      planId: "bpt-jersey-adult",
      programId: "adult-fundamentals",
    },
    {
      label: "adult in a kids program",
      studentId: "adult-kids-program",
      membershipId: "membership-adult-kids-program",
      dateOfBirth: "1990-01-01",
      participantType: "adult" as const,
      planId: "town-kids-1x",
      programId: "kids-fundamentals",
    },
  ])("rejects $label from the profile DOB rather than the program label", async (fixture) => {
    const sessionId = "session-age-band-" + fixture.studentId;
    await seedStudentMembership(fixture);
    await firestore.doc("academies/" + academyId + "/sessions/" + sessionId).set({
      ...session(sessionId, 2, "2027-06-01T18:00:00Z"),
      programId: fixture.programId,
    });

    await expect(
      store.requestBooking(
        academyId,
        {
          sessionId,
          studentId: fixture.studentId,
          membershipId: fixture.membershipId,
        },
        fixture.studentId,
      ),
    ).rejects.toMatchObject({ code: "ineligible" });
    await expect(
      firestore
        .doc("academies/" + academyId + "/bookings/" + buildBookingId(sessionId, fixture.studentId))
        .get(),
    ).resolves.toMatchObject({ exists: false });
  });

  it("blocks booking when T038 finds outstanding PAYG debt", async () => {
    const studentId = "student-payg-debt";
    const membershipId = "membership-payg-debt";
    const familyId = "family-payg-debt";
    const sessionId = "session-payg-debt";
    const invoiceId = "invoice-payg-debt";
    const timestamp = "2026-01-02T00:00:00Z";
    await seedStudentMembership({
      studentId,
      membershipId,
      studentFamilyId: familyId,
      membershipFamilyId: familyId,
    });
    await Promise.all([
      firestore.doc("academies/" + academyId + "/sessions/" + sessionId).set(session(sessionId, 2)),
      firestore.doc("academies/" + academyId + "/invoices/" + invoiceId).set({
        invoiceId,
        academyId,
        familyId,
        membershipId,
        status: "open",
        totalMinor: 1000,
        currency: "GBP",
        dueAt: timestamp,
        paidAt: null,
        schemaVersion: 1,
        createdAt: timestamp,
        createdBy: "owner-1",
        updatedAt: timestamp,
        updatedBy: "owner-1",
        chargeKind: "payg_session",
        sourceRef: "academies/" + academyId + "/sessions/" + sessionId,
        invoiceReference: "payg-debt-reference",
        description: "Synthetic outstanding PAYG session debt",
      }),
    ]);

    await expect(
      store.requestBooking(academyId, { sessionId, studentId, membershipId }, studentId),
    ).rejects.toMatchObject({ code: "financial" });
    await expect(
      firestore
        .doc("academies/" + academyId + "/bookings/" + buildBookingId(sessionId, studentId))
        .get(),
    ).resolves.toMatchObject({ exists: false });
    await expect(
      firestore.doc("academies/" + academyId + "/sessionCapacityStates/" + sessionId).get(),
    ).resolves.toMatchObject({ exists: false });
  });

  it("cancels a legacy booking in place without creating a v2 duplicate", async () => {
    const sessionId = "session-legacy-cancellation";
    const studentId = "student-legacy-cancellation";
    const membershipId = "membership-legacy-cancellation";
    const legacyBookingId = buildLegacyBookingId(sessionId, studentId);
    const canonicalBookingId = buildBookingId(sessionId, studentId);
    await Promise.all([
      firestore.doc("academies/" + academyId + "/sessions/" + sessionId).set(session(sessionId, 2)),
      firestore.doc("academies/" + academyId + "/bookings/" + legacyBookingId).set({
        ...booking({ sessionId, studentId, membershipId, status: "confirmed" }),
        bookingId: legacyBookingId,
      }),
    ]);

    const cancelled = await store.cancelBooking(
      academyId,
      { sessionId, studentId, reason: "Legacy cancellation regression" },
      "owner-1",
      true,
    );
    expect(cancelled).toMatchObject({
      bookingId: legacyBookingId,
      status: "cancelled",
      cancellationReason: "Legacy cancellation regression",
    });
    await expect(
      store.cancelBooking(
        academyId,
        { sessionId, studentId, reason: "Must not rewrite the terminal record" },
        "administrator-1",
        true,
      ),
    ).resolves.toEqual(cancelled);
    await expect(
      firestore.doc("academies/" + academyId + "/bookings/" + canonicalBookingId).get(),
    ).resolves.toMatchObject({ exists: false });
    await expect(
      firestore.doc("academies/" + academyId + "/sessionCapacityStates/" + sessionId).get(),
    ).resolves.toMatchObject({
      exists: true,
    });
    expect(
      (
        await firestore.doc("academies/" + academyId + "/sessionCapacityStates/" + sessionId).get()
      ).data(),
    ).toMatchObject({ revision: 1, updatedBy: "owner-1" });
  });

  it("fails closed before mutating identical canonical and legacy booking versions", async () => {
    const sessionId = "session-dual-booking";
    const studentId = "student-1";
    const membershipId = "membership-1";
    const canonicalBookingId = buildBookingId(sessionId, studentId);
    const legacyBookingId = buildLegacyBookingId(sessionId, studentId);
    const cancelled = booking({ sessionId, studentId, membershipId, status: "cancelled" });
    await Promise.all([
      firestore.doc("academies/" + academyId + "/sessions/" + sessionId).set(session(sessionId, 2)),
      firestore
        .doc("academies/" + academyId + "/bookings/" + canonicalBookingId)
        .set({ ...cancelled, bookingId: canonicalBookingId }),
      firestore
        .doc("academies/" + academyId + "/bookings/" + legacyBookingId)
        .set({ ...cancelled, bookingId: legacyBookingId }),
    ]);

    await expect(
      store.requestBooking(academyId, { sessionId, studentId, membershipId }, studentId),
    ).rejects.toMatchObject({ code: "conflict" });
    const [canonical, legacy, capacityState] = await Promise.all([
      firestore.doc("academies/" + academyId + "/bookings/" + canonicalBookingId).get(),
      firestore.doc("academies/" + academyId + "/bookings/" + legacyBookingId).get(),
      firestore.doc("academies/" + academyId + "/sessionCapacityStates/" + sessionId).get(),
    ]);
    expect([canonical.data()?.status, legacy.data()?.status]).toEqual(["cancelled", "cancelled"]);
    expect(capacityState.exists).toBe(false);
  });

  it("fails closed for a missing membership and the one-hour cutoff", async () => {
    await firestore
      .doc("academies/" + academyId + "/sessions/session-invalid-membership")
      .set(session("session-invalid-membership", 2));
    await expect(
      store.requestBooking(
        academyId,
        {
          sessionId: "session-invalid-membership",
          studentId: "student-1",
          membershipId: "membership-missing",
        },
        "student-1",
      ),
    ).rejects.toThrow();

    const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await firestore
      .doc("academies/" + academyId + "/sessions/session-cutoff")
      .set(session("session-cutoff", 2, soon));
    await expect(
      store.requestBooking(
        academyId,
        {
          sessionId: "session-cutoff",
          studentId: "student-1",
          membershipId: "membership-1",
        },
        "student-1",
      ),
    ).rejects.toThrow(/cutoff|hour|eligible/i);
  });
});
