import { describe, expect, it } from "vitest";

import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";
import { buildBookingId } from "@bpt-jersey/domain/schedule";
import { enrolmentWaiverTermsVersion } from "@bpt-jersey/domain/consents/enrolment-waiver";

import {
  createBookingTransactionService,
  type BookingFirestore,
} from "./booking-transaction-service";

const academyId = "demo-academy";
const now = "2026-09-17T10:00:00.000Z";
const sessionStartAt = "2026-09-18T18:00:00.000Z";
const auditEventsPath = `academies/${academyId}/auditEvents`;
const bookingsPath = `academies/${academyId}/bookings`;

type Document = Record<string, unknown>;

/**
 * The slice of Firestore the booking transaction touches: documents read and written inside one
 * transaction, which only commits when the body finished without throwing.
 */
function createFirestore() {
  const collections = new Map<string, Map<string, Document>>();
  const refusedCreates = new Set<string>();
  let generated = 0;

  const documentsIn = (path: string): Map<string, Document> => {
    const existing = collections.get(path);
    if (existing !== undefined) return existing;
    const created = new Map<string, Document>();
    collections.set(path, created);
    return created;
  };
  const split = (path: string) => {
    const index = path.lastIndexOf("/");
    return { collection: path.slice(0, index), id: path.slice(index + 1) };
  };
  type Operator = "==" | ">=" | "<" | "array-contains";
  type Filter = Readonly<{ field: string; operator: Operator; value: unknown }>;
  const query = (path: string, filters: readonly Filter[]) =>
    Object.freeze({
      where: (field: string, operator: Operator, value: unknown) =>
        query(path, [...filters, { field, operator, value }]),
      limit: () => query(path, filters),
      doc: (id?: string) => {
        generated += 1;
        const documentId = id ?? `generated-${generated}`;
        return Object.freeze({ id: documentId, path: `${path}/${documentId}` });
      },
      matches: (value: Document): boolean =>
        filters.every((filter) => {
          const field = value[filter.field];
          if (filter.operator === "==") return field === filter.value;
          if (filter.operator === "array-contains")
            return Array.isArray(field) && field.includes(filter.value);
          if (filter.operator === ">=") return String(field) >= String(filter.value);
          return String(field) < String(filter.value);
        }),
      collectionPath: path,
    });

  const firestore = {
    doc: (path: string) => Object.freeze({ id: split(path).id, path }),
    collection: (path: string) => query(path, []),
    runTransaction: async <T>(update: (transaction: never) => Promise<T>): Promise<T> => {
      // Buffered like a real transaction: nothing is visible, or durable, until the body returns.
      const writes: { path: string; value: Document }[] = [];
      const transaction = {
        get: async (target: { path?: string; collectionPath?: string; matches?: unknown }) => {
          if (typeof target.collectionPath === "string") {
            const matches = target.matches as (value: Document) => boolean;
            return {
              docs: [...documentsIn(target.collectionPath).entries()]
                .filter(([, value]) => matches(value))
                .map(([id, value]) => ({ id, exists: true, data: () => value })),
            };
          }
          const path = target.path!;
          const { collection, id } = split(path);
          const value = documentsIn(collection).get(id);
          return { id, exists: value !== undefined, data: () => value };
        },
        create: (reference: { path: string }, value: Document) => {
          const { collection, id } = split(reference.path);
          if (refusedCreates.has(collection)) {
            throw new Error(`Refused create in ${collection}`);
          }
          if (documentsIn(collection).has(id)) throw new Error(`${id} already exists`);
          writes.push({ path: reference.path, value });
        },
        set: (reference: { path: string }, value: Document) => {
          writes.push({ path: reference.path, value });
        },
      };
      const result = await update(transaction as never);
      for (const write of writes) {
        const { collection, id } = split(write.path);
        documentsIn(collection).set(id, write.value);
      }
      return result;
    },
  };

  return {
    firestore: firestore as unknown as BookingFirestore,
    seed(path: string, value: Document) {
      const { collection, id } = split(path);
      documentsIn(collection).set(id, value);
    },
    documents(path: string): readonly Document[] {
      return [...documentsIn(path).values()];
    },
    failCreatesIn(path: string) {
      refusedCreates.add(path);
    },
  };
}

function seedAcademy(
  store: ReturnType<typeof createFirestore>,
  session: Partial<Document> = {},
  options: Readonly<{ waiverAccepted?: boolean }> = {},
): void {
  if (options.waiverAccepted !== false)
    store.seed(
      `academies/${academyId}/enrolmentWaiverAcceptances/s1__${enrolmentWaiverTermsVersion}`,
      { academyId, studentId: "s1", version: enrolmentWaiverTermsVersion },
    );
  store.seed(`academies/${academyId}/users/s1`, {
    userId: "s1",
    academyId,
    accountType: "client",
    displayName: "Synthetic Student",
    email: "s1@example.test",
    phoneNumber: "+441534000000",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "owner-1",
  });
  store.seed(`academies/${academyId}/sessions/sess1`, {
    sessionId: "sess1",
    academyId,
    classId: null,
    programId: "adult-fundamentals",
    locationId: "town",
    instructorId: "coach-1",
    title: "Adult Fundamentals",
    startAt: sessionStartAt,
    endAt: "2026-09-18T19:00:00.000Z",
    capacity: 10,
    minParticipants: 1,
    status: "scheduled",
    cancellationReason: null,
    schemaVersion: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "owner-1",
    ...session,
  });
  store.seed(`academies/${academyId}/programs/adult-fundamentals`, {
    programId: "adult-fundamentals",
    academyId,
    name: "Adult Fundamentals",
    ageBand: "adult",
    discipline: "bjj",
    level: "fundamentals",
    active: true,
    schemaVersion: "1",
  });
  store.seed(`academies/${academyId}/plans/bpt-jersey-adult`, {
    ...PLAN_CATALOG.find((plan) => plan.planId === "bpt-jersey-adult")!,
    academyId,
    active: true,
    schemaVersion: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "owner-1",
  });
  store.seed(`academies/${academyId}/students/s1`, {
    studentId: "s1",
    academyId,
    familyId: "family-1",
    userId: "s1",
    fullName: "Synthetic Student",
    dateOfBirth: "1990-01-01",
    phoneNumber: "+441534000000",
    email: "s1@example.test",
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
  });
  store.seed(`academies/${academyId}/memberships/m1`, {
    membershipId: "m1",
    academyId,
    familyId: "family-1",
    studentId: "s1",
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
  });
}

const bookingRequest = { sessionId: "sess1", studentId: "s1", membershipId: "m1" };
const cancelRequest = { sessionId: "sess1", studentId: "s1", reason: "Cannot make it" };

function createService(store: ReturnType<typeof createFirestore>) {
  return createBookingTransactionService({ firestore: store.firestore, now: () => now });
}

describe("academy terms before a member's own booking (D12)", () => {
  it("refuses a member's own booking until the academy terms are accepted", async () => {
    const store = createFirestore();
    seedAcademy(store, {}, { waiverAccepted: false });

    await expect(
      createService(store).requestBooking(academyId, bookingRequest, "s1", {
        ip: null,
        role: "adultStudent",
      }),
    ).rejects.toThrow("Accept the academy terms first");
    expect(store.documents(bookingsPath)).toHaveLength(0);
  });

  it("counts an approved enrolment that carried the current waiver as accepted", async () => {
    const store = createFirestore();
    seedAcademy(store, {}, { waiverAccepted: false });
    store.seed(`academies/${academyId}/enrolmentRequests/enrolment-1`, {
      academyId,
      status: "approved",
      approvedStudentIds: ["s1"],
      waiverAcceptance: { version: enrolmentWaiverTermsVersion },
    });

    const booking = await createService(store).requestBooking(academyId, bookingRequest, "s1", {
      ip: null,
      role: "adultStudent",
    });
    expect(booking.status).toBe("confirmed");
  });

  it("lets the office book a member who has not accepted the terms yet", async () => {
    const store = createFirestore();
    seedAcademy(store, {}, { waiverAccepted: false });

    const booking = await createService(store).requestBooking(academyId, bookingRequest, "owner-1", {
      ip: null,
      role: "owner",
    });
    expect(booking.status).toBe("confirmed");
  });
});

describe("booking transaction audit trail", () => {
  it("writes one audit event with the booking", async () => {
    const store = createFirestore();
    seedAcademy(store);
    const service = createService(store);

    const booking = await service.requestBooking(academyId, bookingRequest, "s1", {
      ip: "82.112.144.10",
      role: "adultStudent",
    });

    expect(booking.status).toBe("confirmed");
    const events = store.documents(auditEventsPath);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "booking.created",
      actorId: "s1",
      actorIp: "82.112.144.10",
      actorRole: "adultStudent",
      actorGroup: "member",
      actorName: null,
      source: "bpt",
      purpose: "class-booking-log",
      correlationId: buildBookingId("sess1", "s1"),
      targetRef: `${bookingsPath}/${buildBookingId("sess1", "s1")}`,
      class: {
        studentId: "s1",
        studentName: null,
        sessionId: "sess1",
        sessionStartAt,
        programId: "adult-fundamentals",
        locationId: "town",
      },
    });
    expect(events[0]).toMatchObject({ auditEventId: "generated-1", result: "completed" });
  });

  it("logs a cancellation of a session stored without a programme or a site with empty fields", async () => {
    const store = createFirestore();
    seedAcademy(store);
    const service = createService(store);
    await service.requestBooking(academyId, bookingRequest, "s1", {
      ip: null,
      role: "adultStudent",
    });
    store.seed(`academies/${academyId}/sessions/sess1`, {
      sessionId: "sess1",
      academyId,
      startAt: sessionStartAt,
      status: "scheduled",
    });

    await service.cancelBooking(academyId, cancelRequest, "s1", false, {
      ip: null,
      role: "adultStudent",
    });

    expect(store.documents(auditEventsPath).at(-1)).toMatchObject({
      action: "booking.cancelled",
      actorIp: null,
      class: { programId: null, locationId: null, sessionStartAt },
    });
  });

  it("does not create the booking when the audit event cannot be written", async () => {
    const store = createFirestore();
    seedAcademy(store);
    const service = createService(store);
    store.failCreatesIn(auditEventsPath);

    await expect(
      service.requestBooking(academyId, bookingRequest, "s1", {
        ip: null,
        role: "adultStudent",
      }),
    ).rejects.toThrow(/Refused create/u);
    expect(store.documents(bookingsPath)).toHaveLength(0);
    expect(store.documents(auditEventsPath)).toHaveLength(0);
    expect(store.documents(`academies/${academyId}/sessionCapacityStates`)).toHaveLength(0);
  });

  it("logs a second booking of the same class after a cancellation", async () => {
    const store = createFirestore();
    seedAcademy(store);
    const service = createService(store);
    const member = { ip: null, role: "adultStudent" } as const;

    await service.requestBooking(academyId, bookingRequest, "s1", member);
    await service.cancelBooking(academyId, cancelRequest, "s1", false, member);
    await service.requestBooking(academyId, bookingRequest, "s1", member);

    const events = store.documents(auditEventsPath);
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.action)).toEqual([
      "booking.created",
      "booking.cancelled",
      "booking.created",
    ]);
    expect(new Set(events.map((event) => event.auditEventId)).size).toBe(3);
  });

  it("cancels a confirmed Intro booking without requiring a membership", async () => {
    const store = createFirestore();
    seedAcademy(store, { accessMode: "intro" });
    const bookingId = buildBookingId("sess1", "s1");
    store.seed(`${bookingsPath}/${bookingId}`, {
      bookingId,
      academyId,
      sessionId: "sess1",
      studentId: "s1",
      membershipId: null,
      source: { kind: "intro" },
      status: "confirmed",
      requestedAt: now,
      cancelledAt: null,
      cancellationReason: null,
      schemaVersion: "3",
      createdAt: now,
      createdBy: "s1",
      updatedAt: now,
      updatedBy: "s1",
    });

    const cancelled = await createService(store).cancelBooking(
      academyId,
      cancelRequest,
      "s1",
      false,
      { ip: null, role: "adultStudent" },
    );

    expect(cancelled).toMatchObject({
      bookingId,
      schemaVersion: "3",
      membershipId: null,
      source: { kind: "intro" },
      status: "cancelled",
    });
  });

  it("writes the cancellation with the staff group when staff cancels", async () => {
    const store = createFirestore();
    seedAcademy(store);
    const service = createService(store);
    await service.requestBooking(academyId, bookingRequest, "s1", {
      ip: null,
      role: "adultStudent",
    });

    await service.cancelBooking(academyId, cancelRequest, "admin-1", true, {
      ip: "82.112.144.11",
      role: "administrator",
    });

    expect(store.documents(auditEventsPath).at(-1)).toMatchObject({
      action: "booking.cancelled",
      actorId: "admin-1",
      actorIp: "82.112.144.11",
      actorRole: "administrator",
      actorGroup: "staff",
    });
  });

  it("records a booking made without a request as a system event", async () => {
    const store = createFirestore();
    seedAcademy(store);
    const service = createService(store);

    await service.requestBooking(academyId, bookingRequest, "owner-1");

    expect(store.documents(auditEventsPath)[0]).toMatchObject({
      actorIp: null,
      actorRole: "system",
      actorGroup: "system",
    });
  });
});

describe("paid period at the time of the class", () => {
  it.each([
    ["2026-09-19T00:00:00.000Z", null, false],
    ["2026-01-01T00:00:00.000Z", sessionStartAt, false],
    ["2026-01-01T00:00:00.000Z", "2026-09-18T17:00:00.000Z", false],
    [sessionStartAt, "2026-09-19T00:00:00.000Z", true],
  ])("uses paid dates %s to %s for the class, eligible=%s", async (startsAt, endsAt, eligible) => {
    const store = createFirestore();
    seedAcademy(store);
    const membershipPath = `academies/${academyId}/memberships`;
    store.seed(membershipPath + "/m1", { ...store.documents(membershipPath)[0], startsAt, endsAt });
    const attempt = createService(store).requestBooking(academyId, bookingRequest, "s1", {
      ip: null,
      role: "adultStudent",
    });
    if (eligible) await expect(attempt).resolves.toMatchObject({ status: "confirmed" });
    else {
      await expect(attempt).rejects.toMatchObject({ code: "ineligible" });
      expect(store.documents(bookingsPath)).toEqual([]);
    }
  });
});
