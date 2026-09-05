import { describe, expect, it } from "vitest";

import { quorumCancellationReason } from "@bpt-jersey/domain/schedule";

import { SessionQuorumSweepError, createQuorumSweepService } from "./quorum-sweep-service";

const academyId = "academy-1";
const sessionId = "session-1";
const now = "2026-09-04T17:30:00.000Z";
/** Half an hour after `now`, so the one-hour booking cutoff has passed. */
const startAt = "2026-09-04T18:00:00.000Z";

type Data = Record<string, unknown>;
type Reference = Readonly<{ id: string; path: string }>;
type Query = Readonly<{
  path: string;
  filters: readonly Readonly<{ field: string; value: unknown }>[];
  where: (field: string, operator: "==", value: unknown) => Query;
  limit: (count: number) => Query;
}>;

function query(path: string, filters: Query["filters"] = []): Query {
  return {
    path,
    filters,
    where: (field, _operator, value) => query(path, [...filters, { field, value }]),
    limit: () => query(path, filters),
  };
}

function transactionalFirestore(seed: ReadonlyMap<string, Data>) {
  const documents = new Map(seed);
  return {
    documents,
    firestore: {
      doc: (path: string): Reference => ({ id: path.split("/").at(-1) ?? "", path }),
      collection: (path: string) => query(path),
      runTransaction: async <T>(callback: (transaction: unknown) => Promise<T>) => {
        const staged = new Map(documents);
        const snapshot = (reference: Reference) => ({
          id: reference.id,
          exists: staged.has(reference.path),
          data: () => staged.get(reference.path),
        });
        const transaction = {
          get: async (target: Reference | Query) => {
            if ("filters" in target) {
              const prefix = target.path + "/";
              const docs = [...staged.entries()]
                .filter(
                  ([path, data]) =>
                    path.startsWith(prefix) &&
                    !path.slice(prefix.length).includes("/") &&
                    target.filters.every(({ field, value }) => data[field] === value),
                )
                .map(([path]) => snapshot({ id: path.split("/").at(-1) ?? "", path }));
              return { docs };
            }
            return snapshot(target);
          },
          create: (reference: Reference, data: Data) => {
            if (staged.has(reference.path)) throw new Error("already exists");
            staged.set(reference.path, data);
          },
          set: (reference: Reference, data: Data) => staged.set(reference.path, data),
        };
        const result = await callback(transaction);
        documents.clear();
        for (const [path, data] of staged) documents.set(path, data);
        return result;
      },
    },
  };
}

function session(overrides: Data = {}): Data {
  return {
    sessionId,
    academyId,
    classId: null,
    programId: "adult-fundamentals",
    locationId: "town",
    instructorId: "coach-1",
    title: "Adults Gi - Town",
    startAt,
    endAt: "2026-09-04T19:00:00.000Z",
    capacity: 20,
    minParticipants: 4,
    status: "scheduled",
    isSeminar: false,
    cancellationReason: null,
    schemaVersion: "1",
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-09-01T00:00:00.000Z",
    updatedBy: "owner-1",
    ...overrides,
  };
}

function booking(studentId: string, status = "confirmed"): Data {
  const bookingId = `v2:9:${sessionId}:${studentId.length}:${studentId}`;
  return {
    bookingId,
    academyId,
    sessionId,
    studentId,
    membershipId: "membership-1",
    status,
    requestedAt: "2026-09-02T00:00:00.000Z",
    cancelledAt: null,
    cancellationReason: null,
    schemaVersion: "1",
    createdAt: "2026-09-02T00:00:00.000Z",
    createdBy: studentId,
    updatedAt: "2026-09-02T00:00:00.000Z",
    updatedBy: studentId,
  };
}

function bookingPath(studentId: string): string {
  return `academies/${academyId}/bookings/v2:9:${sessionId}:${studentId.length}:${studentId}`;
}

function fixtureWith(seed: readonly (readonly [string, Data])[]) {
  const fixture = transactionalFirestore(new Map(seed));
  return {
    fixture,
    service: createQuorumSweepService({
      firestore: fixture.firestore as never,
      now: () => now,
    }),
  };
}

const sessionPath = `academies/${academyId}/sessions/${sessionId}`;
const auditPath = `academies/${academyId}/auditEvents/session-quorum-cancelled-${sessionId}`;
const capacityPath = `academies/${academyId}/sessionCapacityStates/${sessionId}`;

describe("session quorum sweep (T110)", () => {
  it("cancels the session, releases its bookings and audits it once", async () => {
    const { fixture, service } = fixtureWith([
      [sessionPath, session()],
      [bookingPath("student-1"), booking("student-1")],
      [bookingPath("student-2"), booking("student-2")],
      [bookingPath("student-3"), booking("student-3", "cancelled")],
    ]);

    const result = await service.reconcileSessionQuorum({
      academyId,
      sessionId,
      actorId: "owner-1",
    });

    expect(result).toMatchObject({
      sessionId,
      outcome: "cancelled",
      confirmedCount: 2,
      minParticipants: 4,
      cancels: true,
      releasedBookings: 2,
    });
    expect(fixture.documents.get(sessionPath)).toMatchObject({
      status: "cancelled",
      cancellationReason: quorumCancellationReason,
      updatedBy: "owner-1",
      updatedAt: now,
    });
    for (const studentId of ["student-1", "student-2"]) {
      expect(fixture.documents.get(bookingPath(studentId))).toMatchObject({
        status: "cancelled",
        cancelledAt: now,
        cancellationReason: quorumCancellationReason,
      });
    }
    // An already-cancelled booking is left exactly as it was.
    expect(fixture.documents.get(bookingPath("student-3"))).toMatchObject({
      status: "cancelled",
      cancelledAt: null,
    });
    expect(fixture.documents.get(auditPath)).toMatchObject({
      action: "session.quorum.cancelled",
      actorId: "owner-1",
      targetRef: sessionPath,
    });
    expect(fixture.documents.get(capacityPath)).toMatchObject({ revision: 1 });
  });

  it("is a no-op when repeated, and reports the earlier cancellation", async () => {
    const { fixture, service } = fixtureWith([
      [sessionPath, session()],
      [bookingPath("student-1"), booking("student-1")],
    ]);
    await service.reconcileSessionQuorum({ academyId, sessionId, actorId: "owner-1" });
    const afterFirst = new Map(fixture.documents);

    const repeat = await service.reconcileSessionQuorum({
      academyId,
      sessionId,
      actorId: "owner-1",
    });

    expect(repeat).toMatchObject({
      outcome: "alreadyCancelledForQuorum",
      cancels: false,
      releasedBookings: 0,
    });
    expect([...fixture.documents.entries()]).toEqual([...afterFirst.entries()]);
  });

  it("leaves a session that reached its minimum untouched", async () => {
    const { fixture, service } = fixtureWith([
      [sessionPath, session({ minParticipants: 2 })],
      [bookingPath("student-1"), booking("student-1")],
      [bookingPath("student-2"), booking("student-2")],
    ]);

    const result = await service.reconcileSessionQuorum({
      academyId,
      sessionId,
      actorId: "owner-1",
    });

    expect(result).toMatchObject({ outcome: "quorumMet", confirmedCount: 2, minParticipants: 2 });
    expect(fixture.documents.get(sessionPath)).toMatchObject({ status: "scheduled" });
    expect(fixture.documents.has(auditPath)).toBe(false);
  });

  it("waits until the one-hour cutoff has passed", async () => {
    const { fixture, service } = fixtureWith([
      // Three hours ahead: still open for booking, so nothing is decided yet.
      [sessionPath, session({ startAt: "2026-09-04T20:30:00.000Z" })],
    ]);

    const result = await service.reconcileSessionQuorum({
      academyId,
      sessionId,
      actorId: "owner-1",
    });

    expect(result).toMatchObject({ outcome: "beforeCutoff", cancels: false });
    expect(fixture.documents.get(sessionPath)).toMatchObject({ status: "scheduled" });
    expect(fixture.documents.has(auditPath)).toBe(false);
  });

  it("respects a minimum raised above the default", async () => {
    const { service } = fixtureWith([
      [sessionPath, session({ minParticipants: 8 })],
      ...["a", "b", "c", "d", "e"].map(
        (suffix) => [bookingPath(`student-${suffix}`), booking(`student-${suffix}`)] as const,
      ),
    ]);

    const result = await service.reconcileSessionQuorum({
      academyId,
      sessionId,
      actorId: "owner-1",
    });

    expect(result).toMatchObject({ outcome: "cancelled", confirmedCount: 5, minParticipants: 8 });
  });

  it("never touches a session cancelled for another reason", async () => {
    const { fixture, service } = fixtureWith([
      [sessionPath, session({ status: "cancelled", cancellationReason: "Instructor unavailable" })],
      [bookingPath("student-1"), booking("student-1")],
    ]);

    const result = await service.reconcileSessionQuorum({
      academyId,
      sessionId,
      actorId: "owner-1",
    });

    expect(result).toMatchObject({ outcome: "notScheduled", cancels: false });
    expect(fixture.documents.get(sessionPath)).toMatchObject({
      cancellationReason: "Instructor unavailable",
    });
    expect(fixture.documents.get(bookingPath("student-1"))).toMatchObject({ status: "confirmed" });
  });

  it("refuses a session from another tenant and one that does not exist", async () => {
    const { service } = fixtureWith([[sessionPath, session({ academyId: "other-academy" })]]);
    await expect(
      service.reconcileSessionQuorum({ academyId, sessionId, actorId: "owner-1" }),
    ).rejects.toBeInstanceOf(SessionQuorumSweepError);

    const missing = fixtureWith([]);
    await expect(
      missing.service.reconcileSessionQuorum({ academyId, sessionId, actorId: "owner-1" }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("refuses to cancel when a stale audit event already exists", async () => {
    const { fixture, service } = fixtureWith([
      [sessionPath, session()],
      [auditPath, { auditEventId: "session-quorum-cancelled-session-1", stale: true }],
    ]);

    await expect(
      service.reconcileSessionQuorum({ academyId, sessionId, actorId: "owner-1" }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(fixture.documents.get(sessionPath)).toMatchObject({ status: "scheduled" });
  });
});
