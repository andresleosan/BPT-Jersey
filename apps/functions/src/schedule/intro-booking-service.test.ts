import { enrolmentWaiverTermsVersion } from "@bpt-jersey/domain/consents/enrolment-waiver";
import { describe, expect, it } from "vitest";

import { buildBookingId } from "@bpt-jersey/domain/schedule";
import { consentRecordId } from "../consents/consent-identifiers";
import type { BookingFirestore } from "./booking-transaction-service";
import { requestIntroBooking, type IntroBookingCommand } from "./intro-booking-service";

const academyId = "academy-1";
const now = "2026-09-21T10:00:00.000Z";
const startAt = "2026-09-22T18:00:00.000Z";
const waiverVersionId = "waiver-1";
type Document = Record<string, unknown>;
type Operator = "==" | ">=" | "<" | "array-contains";
type Filter = Readonly<{ field: string; operator: Operator; value: unknown }>;

function createFirestore() {
  const records = new Map<string, Document>();
  let generated = 0;
  let tail = Promise.resolve();
  const split = (path: string) => {
    const index = path.lastIndexOf("/");
    return { collection: path.slice(0, index), id: path.slice(index + 1) };
  };
  const query = (collectionPath: string, filters: readonly Filter[], maximum = Infinity) => ({
    collectionPath,
    filters,
    maximum,
    where(field: string, operator: Operator, value: unknown) {
      return query(collectionPath, [...filters, { field, operator, value }], maximum);
    },
    limit(count: number) {
      return query(collectionPath, filters, count);
    },
    doc(id?: string) {
      const documentId = id ?? `generated-${++generated}`;
      return { id: documentId, path: `${collectionPath}/${documentId}` };
    },
  });
  const firestore = {
    doc(path: string) {
      return { id: split(path).id, path };
    },
    collection(path: string) {
      return query(path, []);
    },
    runTransaction<T>(update: (transaction: never) => Promise<T>): Promise<T> {
      const run = tail.then(async () => {
        const writes: Readonly<{ path: string; value: Document; create: boolean }>[] = [];
        const transaction = {
          async get(target: { path?: string; collectionPath?: string; filters?: readonly Filter[]; maximum?: number }) {
            if (target.collectionPath) {
              const prefix = `${target.collectionPath}/`;
              const docs = [...records.entries()]
                .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
                .filter(([, value]) =>
                  (target.filters ?? []).every(({ field, operator, value: expected }) => {
                    const actual = value[field];
                    if (operator === "==") return actual === expected;
                    if (operator === "array-contains")
                      return Array.isArray(actual) && actual.includes(expected);
                    if (operator === ">=") return String(actual) >= String(expected);
                    return String(actual) < String(expected);
                  }),
                )
                .slice(0, target.maximum)
                .map(([path, value]) => ({ id: split(path).id, exists: true, data: () => value }));
              return { docs };
            }
            const value = records.get(target.path!);
            return { id: split(target.path!).id, exists: value !== undefined, data: () => value };
          },
          create(reference: { path: string }, value: Document) {
            if (records.has(reference.path)) throw new Error("Document already exists");
            (writes as { path: string; value: Document; create: boolean }[]).push({
              path: reference.path,
              value,
              create: true,
            });
          },
          set(reference: { path: string }, value: Document) {
            (writes as { path: string; value: Document; create: boolean }[]).push({
              path: reference.path,
              value,
              create: false,
            });
          },
        };
        const result = await update(transaction as never);
        for (const write of writes) records.set(write.path, write.value);
        return result;
      });
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return {
    db: firestore as unknown as BookingFirestore,
    records,
    seed(path: string, value: Document) {
      records.set(path, value);
    },
    documents(collection: string) {
      const prefix = `${collection}/`;
      return [...records.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .map(([, value]) => value);
    },
  };
}

const audit = {
  schemaVersion: "1",
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "seed",
  updatedAt: "2026-01-01T00:00:00.000Z",
  updatedBy: "seed",
};

function seedStudent(store: ReturnType<typeof createFirestore>, studentId = "student-1") {
  const actorId = `actor-${studentId}`;
  store.seed(`academies/${academyId}/users/${actorId}`, {
    userId: actorId,
    academyId,
    accountType: "client",
    displayName: "Synthetic Adult",
    email: `${actorId}@example.test`,
    phoneNumber: "+441534000000",
    active: true,
    status: "active",
    ...audit,
  });
  store.seed(`academies/${academyId}/students/${studentId}`, {
    studentId,
    academyId,
    userId: actorId,
    fullName: "Synthetic Adult",
    dateOfBirth: "1990-01-01",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    ...audit,
  });
  const consentId = consentRecordId(academyId, studentId, waiverVersionId);
  store.seed(`academies/${academyId}/consents/${consentId}`, {
    consentId,
    academyId,
    subjectType: "adult",
    subjectId: studentId,
    waiverVersionId,
    status: "accepted",
    revokedAt: null,
    signedAt: "2026-01-01T00:00:00.000Z",
    ...audit,
  });
  return actorId;
}

function seedTrial(
  store: ReturnType<typeof createFirestore>,
  studentId = "student-1",
  overrides: Partial<Document> = {},
) {
  store.seed(`academies/${academyId}/trialAccess/${studentId}`, {
    trialId: `trial-${studentId}`,
    academyId,
    studentId,
    site: "Town",
    experience: "beginner",
    allowance: 2,
    countedAttendanceIds: [],
    status: "active",
    startsAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-10-01T00:00:00.000Z",
    enrolmentRequestId: "enrolment-1",
    createdAt: audit.createdAt,
    updatedAt: audit.updatedAt,
    schemaVersion: "1",
    ...overrides,
  });
}

/** Mirrors the guardian/family/relationship seeding pattern used in
 * canonical-client-student-scope.test.ts and schedule-security-boundary.test.ts. */
function seedGuardianLink(
  store: ReturnType<typeof createFirestore>,
  studentId: string,
  guardianUserId: string,
  familyId: string,
) {
  store.seed(`academies/${academyId}/users/${guardianUserId}`, {
    userId: guardianUserId,
    academyId,
    accountType: "client",
    displayName: "Synthetic Guardian",
    email: `${guardianUserId}@example.test`,
    phoneNumber: "+441534000001",
    active: true,
    status: "active",
    ...audit,
  });
  store.seed(`academies/${academyId}/families/${familyId}`, {
    familyId,
    academyId,
    primaryContactUserId: guardianUserId,
    billingContactUserId: guardianUserId,
    active: true,
    status: "active",
    ...audit,
  });
  store.seed(`academies/${academyId}/relationships/relation-${studentId}`, {
    relationshipId: `relation-${studentId}`,
    academyId,
    familyId,
    studentId,
    adultUserId: guardianUserId,
    relationshipType: "guardian",
    permissions: ["readProfile"],
    validFrom: "2026-01-01T00:00:00.000Z",
    active: true,
    status: "active",
    ...audit,
  });
  const student = store.records.get(`academies/${academyId}/students/${studentId}`);
  store.seed(`academies/${academyId}/students/${studentId}`, {
    ...student,
    familyId,
  });
}

function seededIntroStore(state?: "missing-waiver" | "active-membership" | "prior-intro-attendance" | "future-intro-booking") {
  const store = createFirestore();
  const actorId = seedStudent(store);
  seedTrial(store);
  store.seed(`academies/${academyId}/sessions/session-1`, {
    sessionId: "session-1",
    academyId,
    classId: null,
    programId: "adult-fundamentals",
    locationId: "town",
    instructorId: "coach-1",
    title: "Intro Class",
    startAt,
    endAt: "2026-09-22T19:00:00.000Z",
    capacity: 2,
    minParticipants: 0,
    status: "scheduled",
    isSeminar: false,
    cancellationReason: null,
    accessMode: "intro",
    ...audit,
  });
  store.seed(`academies/${academyId}/waiverVersions/${waiverVersionId}`, {
    waiverVersionId,
    academyId,
    status: "published",
    effectiveAt: "2026-01-01T00:00:00.000Z",
    supersededAt: null,
    ...audit,
  });
  if (state === "missing-waiver") {
    store.records.delete(
      `academies/${academyId}/consents/${consentRecordId(academyId, "student-1", waiverVersionId)}`,
    );
  }
  if (state === "active-membership") {
    store.seed(`academies/${academyId}/memberships/membership-1`, {
      membershipId: "membership-1",
      academyId,
      studentId: "student-1",
      planId: "town-adult",
      status: "active",
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: null,
      ...audit,
    });
  }
  if (state === "prior-intro-attendance") {
    seedTrial(store, "student-1", { allowance: 1, countedAttendanceIds: ["attendance-old"] });
  }
  if (state === "future-intro-booking") {
    seedTrial(store, "student-1", { allowance: 1 });
    store.seed(`academies/${academyId}/sessions/session-other`, {
      ...(store.records.get(`academies/${academyId}/sessions/session-1`) ?? {}),
      sessionId: "session-other",
      startAt: "2026-09-23T18:00:00.000Z",
      endAt: "2026-09-23T19:00:00.000Z",
    });
    const bookingId = buildBookingId("session-other", "student-1");
    store.seed(`academies/${academyId}/bookings/${bookingId}`, {
      ...audit,
      bookingId,
      academyId,
      sessionId: "session-other",
      studentId: "student-1",
      membershipId: null,
      source: { kind: "intro" },
      status: "confirmed",
      requestedAt: now,
      cancelledAt: null,
      cancellationReason: null,
      schemaVersion: "3",
    });
  }
  const command: IntroBookingCommand = {
    academyId,
    actorId,
    actorRole: "adultStudent",
    actorIp: null,
    studentId: "student-1",
    sessionId: "session-1",
    now,
  };
  return { ...store, command };
}

describe("intro booking transaction", () => {
  it.each([
    "missing-waiver",
    "active-membership",
    "prior-intro-attendance",
    "future-intro-booking",
  ] as const)("rejects %s without writing a booking", async (state) => {
    const store = seededIntroStore(state);
    await expect(requestIntroBooking(store.db, store.command)).rejects.toMatchObject({
      code: "ineligible",
    });
    expect(store.documents(`academies/${academyId}/bookings`)).toHaveLength(
      state === "future-intro-booking" ? 1 : 0,
    );
  });

  it("books an intro for a trial member who accepted the enrolment waiver, with no legacy consent", async () => {
    // D12: the /enrol and /account waiver is the academy's waiver; the legacy registration is off.
    const store = seededIntroStore("missing-waiver");
    store.records.delete(`academies/${academyId}/waiverVersions/${waiverVersionId}`);
    store.seed(
      `academies/${academyId}/enrolmentWaiverAcceptances/student-1__${enrolmentWaiverTermsVersion}`,
      { academyId, studentId: "student-1", version: enrolmentWaiverTermsVersion },
    );

    await expect(requestIntroBooking(store.db, store.command)).resolves.toMatchObject({
      status: "confirmed",
    });
  });

  it("creates an idempotent versioned intro booking and audit record", async () => {
    const store = seededIntroStore();
    const first = await requestIntroBooking(store.db, store.command);
    const replay = await requestIntroBooking(store.db, store.command);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      bookingId: buildBookingId("session-1", "student-1"),
      membershipId: null,
      source: { kind: "intro" },
      status: "confirmed",
      schemaVersion: "3",
    });
    expect(store.documents(`academies/${academyId}/bookings`)).toHaveLength(1);
    expect(store.documents(`academies/${academyId}/auditEvents`)).toHaveLength(1);
  });

  it("lets only one caller take the final place", async () => {
    const store = seededIntroStore();
    const session = store.records.get(`academies/${academyId}/sessions/session-1`)!;
    store.seed(`academies/${academyId}/sessions/session-1`, { ...session, capacity: 1 });
    seedStudent(store, "student-2");
    seedTrial(store, "student-2");
    const results = await Promise.allSettled([
      requestIntroBooking(store.db, { ...store.command, actorRole: "owner" }),
      requestIntroBooking(store.db, {
        ...store.command,
        actorId: "owner-1",
        actorRole: "owner",
        studentId: "student-2",
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      store
        .documents(`academies/${academyId}/bookings`)
        .filter((booking) => booking.status === "confirmed"),
    ).toHaveLength(1);
  });

  it("refuses a booking without an active trial", async () => {
    const store = seededIntroStore();
    store.records.delete(`academies/${academyId}/trialAccess/student-1`);
    await expect(requestIntroBooking(store.db, store.command)).rejects.toMatchObject({
      code: "ineligible",
      message: "Your trial is not active",
    });
    expect(store.documents(`academies/${academyId}/bookings`)).toHaveLength(0);
  });

  it("lets a beginner hold two future intro bookings and no more", async () => {
    const store = seededIntroStore();
    const template = store.records.get(`academies/${academyId}/sessions/session-1`)!;
    store.seed(`academies/${academyId}/sessions/session-2`, {
      ...template,
      sessionId: "session-2",
      startAt: "2026-09-23T18:00:00.000Z",
      endAt: "2026-09-23T19:00:00.000Z",
    });
    store.seed(`academies/${academyId}/sessions/session-3`, {
      ...template,
      sessionId: "session-3",
      startAt: "2026-09-24T18:00:00.000Z",
      endAt: "2026-09-24T19:00:00.000Z",
    });
    await requestIntroBooking(store.db, { ...store.command, sessionId: "session-1" });
    await requestIntroBooking(store.db, { ...store.command, sessionId: "session-2" });
    await expect(
      requestIntroBooking(store.db, { ...store.command, sessionId: "session-3" }),
    ).rejects.toMatchObject({
      code: "ineligible",
      message: "Your free classes are used up",
    });
    expect(store.documents(`academies/${academyId}/bookings`)).toHaveLength(2);
  });

  it("counts attended classes against the allowance", async () => {
    const store = seededIntroStore();
    seedTrial(store, "student-1", { countedAttendanceIds: ["att-1"] });
    const template = store.records.get(`academies/${academyId}/sessions/session-1`)!;
    store.seed(`academies/${academyId}/sessions/session-2`, {
      ...template,
      sessionId: "session-2",
      startAt: "2026-09-23T18:00:00.000Z",
      endAt: "2026-09-23T19:00:00.000Z",
    });
    const bookingId = buildBookingId("session-2", "student-1");
    store.seed(`academies/${academyId}/bookings/${bookingId}`, {
      ...audit,
      bookingId,
      academyId,
      sessionId: "session-2",
      studentId: "student-1",
      membershipId: null,
      source: { kind: "intro" },
      status: "confirmed",
      requestedAt: now,
      cancelledAt: null,
      cancellationReason: null,
      schemaVersion: "3",
    });
    await expect(requestIntroBooking(store.db, store.command)).rejects.toMatchObject({
      code: "ineligible",
      message: "Your free classes are used up",
    });
    expect(store.documents(`academies/${academyId}/bookings`)).toHaveLength(1);
  });

  it("refuses an ordinary class for a 16+ trial member", async () => {
    const store = seededIntroStore();
    const template = store.records.get(`academies/${academyId}/sessions/session-1`)!;
    store.seed(`academies/${academyId}/sessions/session-1`, {
      ...template,
      accessMode: undefined,
    });
    await expect(requestIntroBooking(store.db, store.command)).rejects.toMatchObject({
      code: "ineligible",
      message: "During your trial you can book Introduction Classes only",
    });
    expect(store.documents(`academies/${academyId}/bookings`)).toHaveLength(0);
  });

  it("lets an under-16 trial member book a kids class at their site", async () => {
    const store = seededIntroStore();
    store.seed(`academies/${academyId}/students/student-1`, {
      ...store.records.get(`academies/${academyId}/students/student-1`),
      dateOfBirth: "2018-01-01",
    });
    const template = store.records.get(`academies/${academyId}/sessions/session-1`)!;
    store.seed(`academies/${academyId}/sessions/session-1`, {
      ...template,
      accessMode: undefined,
      programId: "kids-fundamentals",
    });
    store.seed(`academies/${academyId}/programs/kids-fundamentals`, {
      programId: "kids-fundamentals",
      academyId,
      name: "Kids Fundamentals",
      ageBand: "kids",
      discipline: "gi",
      level: "fundamentals",
      active: true,
      schemaVersion: "1",
    });
    const booking = await requestIntroBooking(store.db, { ...store.command, actorRole: "owner" });
    expect(booking).toMatchObject({
      status: "confirmed",
      source: { kind: "intro" },
    });
    expect(store.documents(`academies/${academyId}/bookings`)).toHaveLength(1);
  });

  it("lets a guardian book their under-16 trial member into a kids class", async () => {
    const store = seededIntroStore();
    store.seed(`academies/${academyId}/students/student-1`, {
      ...store.records.get(`academies/${academyId}/students/student-1`),
      dateOfBirth: "2018-01-01",
      participantType: "minor",
    });
    seedGuardianLink(store, "student-1", "guardian-1", "family-1");
    const template = store.records.get(`academies/${academyId}/sessions/session-1`)!;
    store.seed(`academies/${academyId}/sessions/session-1`, {
      ...template,
      accessMode: undefined,
      programId: "kids-fundamentals",
    });
    store.seed(`academies/${academyId}/programs/kids-fundamentals`, {
      programId: "kids-fundamentals",
      academyId,
      name: "Kids Fundamentals",
      ageBand: "kids",
      discipline: "gi",
      level: "fundamentals",
      active: true,
      schemaVersion: "1",
    });
    const booking = await requestIntroBooking(store.db, {
      ...store.command,
      actorId: "guardian-1",
      actorRole: "guardian",
    });
    expect(booking).toMatchObject({
      status: "confirmed",
      source: { kind: "intro" },
    });
    expect(store.documents(`academies/${academyId}/bookings`)).toHaveLength(1);
  });

  it("refuses an under-16 trial member outside their age band", async () => {
    const store = seededIntroStore();
    store.seed(`academies/${academyId}/students/student-1`, {
      ...store.records.get(`academies/${academyId}/students/student-1`),
      dateOfBirth: "2018-01-01",
    });
    const template = store.records.get(`academies/${academyId}/sessions/session-1`)!;
    store.seed(`academies/${academyId}/sessions/session-1`, {
      ...template,
      accessMode: undefined,
      programId: "adult-open",
    });
    store.seed(`academies/${academyId}/programs/adult-open`, {
      programId: "adult-open",
      academyId,
      name: "Adult Open Mat",
      ageBand: "all",
      discipline: "gi",
      level: "fundamentals",
      active: true,
      schemaVersion: "1",
    });
    await expect(
      requestIntroBooking(store.db, { ...store.command, actorRole: "owner" }),
    ).rejects.toMatchObject({
      code: "ineligible",
      message: "This class is for another age group",
    });
    expect(store.documents(`academies/${academyId}/bookings`)).toHaveLength(0);
  });

  it("refuses a session at the other site", async () => {
    const store = seededIntroStore();
    const template = store.records.get(`academies/${academyId}/sessions/session-1`)!;
    store.seed(`academies/${academyId}/sessions/session-1`, {
      ...template,
      locationId: "west",
    });
    await expect(requestIntroBooking(store.db, store.command)).rejects.toMatchObject({
      code: "ineligible",
    });
    expect(store.documents(`academies/${academyId}/bookings`)).toHaveLength(0);
  });

  it("refuses a session with a corrupted accessMode instead of throwing", async () => {
    const store = seededIntroStore();
    const template = store.records.get(`academies/${academyId}/sessions/session-1`)!;
    store.seed(`academies/${academyId}/sessions/session-1`, {
      ...template,
      accessMode: "not-a-real-mode",
    });
    await expect(requestIntroBooking(store.db, store.command)).rejects.toMatchObject({
      code: "ineligible",
      message: "Session access mode is invalid",
    });
    expect(store.documents(`academies/${academyId}/bookings`)).toHaveLength(0);
  });
});
