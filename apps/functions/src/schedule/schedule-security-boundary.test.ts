import { describe, expect, it } from "vitest";

import {
  ScheduleAttendanceError,
  createTransactionalAttendanceService,
} from "./attendance-transaction-service";
import { createFirestoreScheduleStore } from "./schedule-service";

const now = "2026-09-03T18:05:00.000Z";
const academyId = "academy-1";

type Data = Record<string, unknown>;
type Reference = Readonly<{ id: string; path: string }>;
type Query = Readonly<{
  path: string;
  filters: readonly Readonly<{ field: string; value: unknown }>[];
  maximum: number;
  where: (field: string, operator: "==", value: unknown) => Query;
  limit: (count: number) => Query;
}>;

function query(
  path: string,
  filters: Query["filters"] = [],
  maximum = Number.MAX_SAFE_INTEGER,
): Query {
  return {
    path,
    filters,
    maximum,
    where: (field, _operator, value) => query(path, [...filters, { field, value }], maximum),
    limit: (count) => query(path, filters, count),
  };
}

function transactionalFirestore(seed: ReadonlyMap<string, Data>) {
  const documents = new Map(seed);
  return {
    documents,
    firestore: {
      doc: (path: string): Reference => ({
        id: path.split("/").at(-1) ?? "",
        path,
      }),
      collection: (path: string) => query(path),
      runTransaction: async <T>(callback: (transaction: unknown) => Promise<T>) => {
        const staged = new Map(documents);
        let writesStarted = false;
        const snapshot = (reference: Reference) => ({
          id: reference.id,
          exists: staged.has(reference.path),
          data: () => staged.get(reference.path),
        });
        const transaction = {
          get: async (target: Reference | Query) => {
            if (writesStarted) {
              throw new Error("Firestore transactions must read before writing");
            }
            if ("filters" in target) {
              const prefix = target.path + "/";
              const docs = [...staged.entries()]
                .filter(([path, data]) => {
                  const suffix = path.slice(prefix.length);
                  return (
                    path.startsWith(prefix) &&
                    !suffix.includes("/") &&
                    target.filters.every(({ field, value }) => data[field] === value)
                  );
                })
                .slice(0, target.maximum)
                .map(([path]) => snapshot({ id: path.split("/").at(-1) ?? "", path }));
              return { docs };
            }
            return snapshot(target);
          },
          create: (reference: Reference, data: Data) => {
            writesStarted = true;
            if (staged.has(reference.path)) throw new Error("already exists");
            staged.set(reference.path, data);
          },
          set: (reference: Reference, data: Data) => {
            writesStarted = true;
            staged.set(reference.path, data);
          },
          update: (reference: Reference, data: Data) => {
            writesStarted = true;
            const current = staged.get(reference.path);
            if (current === undefined) throw new Error("missing update target");
            staged.set(reference.path, { ...current, ...data });
          },
        };
        const result = await callback(transaction);
        documents.clear();
        for (const [path, data] of staged) documents.set(path, data);
        return result;
      },
    },
  };
}

function auditFields() {
  return {
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: now,
    createdBy: "owner-1",
    updatedAt: now,
    updatedBy: "owner-1",
  };
}

describe("transactional schedule security boundary", () => {
  it("keeps self check-in closed and atomically validates booking, minor release and audit evidence", async () => {
    const sessionId = "session-1";
    const studentId = "minor-1";
    const attendanceId = `${sessionId}__${studentId}`;
    const fixture = transactionalFirestore(
      new Map<string, Data>([
        [
          `academies/${academyId}/sessions/${sessionId}`,
          {
            sessionId,
            academyId,
            startAt: "2026-09-03T18:00:00.000Z",
            status: "active",
          },
        ],
        [
          `academies/${academyId}/students/${studentId}`,
          {
            studentId,
            academyId,
            familyId: "family-1",
            fullName: "Synthetic Minor",
            dateOfBirth: "2015-01-01",
            trainingCenter: "Town",
            trainingTimePreferences: ["afternoon"],
            participantType: "minor",
            ...auditFields(),
          },
        ],
        [
          `academies/${academyId}/bookings/v2:9:session-1:7:minor-1`,
          {
            bookingId: "v2:9:session-1:7:minor-1",
            academyId,
            sessionId,
            studentId,
            membershipId: "membership-1",
            status: "confirmed",
          },
        ],
        [
          `academies/${academyId}/families/family-1`,
          {
            familyId: "family-1",
            academyId,
            primaryContactUserId: "guardian-1",
            billingContactUserId: "guardian-1",
            ...auditFields(),
          },
        ],
        [
          `academies/${academyId}/relationships/relation-1`,
          {
            relationshipId: "relation-1",
            academyId,
            familyId: "family-1",
            studentId,
            adultUserId: "guardian-1",
            relationshipType: "guardian",
            permissions: ["readProfile"],
            validFrom: "2026-01-01T00:00:00.000Z",
            ...auditFields(),
          },
        ],
      ]),
    );
    const service = createTransactionalAttendanceService({
      firestore: fixture.firestore as never,
      now: () => now,
      correctionId: () => "corr-fixed-1",
    });

    await expect(
      service.recordCheckIn({
        academyId,
        input: { sessionId, studentId, method: "qr" },
        actorId: "guardian-1",
        actorRole: "guardian",
      }),
    ).rejects.toMatchObject({ code: "credential" });
    expect(fixture.documents.has(`academies/${academyId}/attendance/${attendanceId}`)).toBe(false);

    await expect(
      service.recordCheckIn({
        academyId,
        input: { sessionId, studentId, method: "manual", notes: "Front desk" },
        actorId: "coach-user-1",
        actorRole: "coach",
      }),
    ).resolves.toMatchObject({ attendanceId, studentId, method: "manual" });
    expect(
      fixture.documents.get(
        `academies/${academyId}/auditEvents/attendance-check-in-${attendanceId}`,
      ),
    ).toMatchObject({ action: "attendance.checked_in" });

    await expect(
      service.recordCheckout({
        academyId,
        input: {
          sessionId,
          studentId,
          method: "authorizedAdult",
          authorizedAdultId: "guardian-1",
          authorizedAdultName: "Synthetic Guardian",
        },
        actorId: "guardian-1",
        actorRole: "guardian",
      }),
    ).resolves.toMatchObject({ studentId, method: "authorizedAdult" });
    expect(
      fixture.documents.get(`academies/${academyId}/auditEvents/student-checkout-${attendanceId}`),
    ).toMatchObject({ action: "student.checked_out" });

    const before = fixture.documents.size;
    await expect(
      service.correctAttendance({
        academyId,
        input: {
          sessionId,
          studentId,
          newState: "late",
          reason: "Verified against the session register",
        },
        actorId: "coach-user-1",
        actorRole: "coach",
      }),
    ).resolves.toMatchObject({
      correction: { attendanceId: "corr-fixed-1", correctionOf: attendanceId },
      canonical: { state: "late" },
    });
    expect(fixture.documents.size).toBe(before + 2);
    expect(
      fixture.documents.get(
        `academies/${academyId}/auditEvents/attendance-correction-corr-fixed-1`,
      ),
    ).toMatchObject({ action: "attendance.corrected" });

    fixture.documents.delete(`academies/${academyId}/relationships/relation-1`);
    fixture.documents.delete(`academies/${academyId}/checkouts/${attendanceId}`);
    fixture.documents.delete(`academies/${academyId}/auditEvents/student-checkout-${attendanceId}`);
    const noRelationshipSize = fixture.documents.size;
    await expect(
      service.recordCheckout({
        academyId,
        input: {
          sessionId,
          studentId,
          method: "authorizedAdult",
          authorizedAdultId: "guardian-1",
        },
        actorId: "guardian-1",
        actorRole: "guardian",
      }),
    ).rejects.toBeInstanceOf(ScheduleAttendanceError);
    expect(fixture.documents.size).toBe(noRelationshipSize);
  });
});

describe("check-in proximity signal at the transaction boundary (T109)", () => {
  const sessionId = "session-2";
  const studentId = "adult-1";
  const attendanceId = `${sessionId}__${studentId}`;
  const attendancePath = `academies/${academyId}/attendance/${attendanceId}`;
  const overrideAuditPath = `academies/${academyId}/auditEvents/attendance-proximity-override-${attendanceId}`;

  function fixtureFor(geofence: Readonly<{ latitude: number; longitude: number }> | undefined) {
    const seed = new Map<string, Data>([
      [
        `academies/${academyId}/sessions/${sessionId}`,
        {
          sessionId,
          academyId,
          locationId: "town",
          startAt: "2026-09-03T18:00:00.000Z",
          status: "active",
        },
      ],
      [
        `academies/${academyId}/students/${studentId}`,
        {
          studentId,
          academyId,
          userId: "adult-user-1",
          fullName: "Synthetic Adult",
          dateOfBirth: "1993-01-01",
          trainingCenter: "Town",
          trainingTimePreferences: ["evening"],
          participantType: "adult",
          ...auditFields(),
        },
      ],
      [
        `academies/${academyId}/bookings/v2:9:session-2:7:adult-1`,
        {
          bookingId: "v2:9:session-2:7:adult-1",
          academyId,
          sessionId,
          studentId,
          membershipId: "membership-1",
          status: "confirmed",
        },
      ],
    ]);
    if (geofence !== undefined) {
      seed.set(`academies/${academyId}/locations/town`, {
        locationId: "town",
        academyId,
        name: "BPT Town",
        address: "St Helier, Jersey",
        timezone: "Europe/Jersey",
        active: true,
        geofence,
        schemaVersion: "1",
      });
    }
    const fixture = transactionalFirestore(seed);
    return {
      fixture,
      service: createTransactionalAttendanceService({
        firestore: fixture.firestore as never,
        now: () => now,
        correctionId: () => "corr-fixed-2",
      }),
    };
  }

  const measurement = (distanceMeters: number, accuracyMeters = 9) => ({
    distanceMeters,
    accuracyMeters,
    measuredAt: now,
  });

  it("records a measurement inside the radius without an override event", async () => {
    const { fixture, service } = fixtureFor({ latitude: 49.186, longitude: -2.106 });

    await expect(
      service.recordCheckIn({
        academyId,
        input: { sessionId, studentId, method: "manual", proximity: measurement(18) },
        actorId: "coach-user-1",
        actorRole: "coach",
      }),
    ).resolves.toMatchObject({
      proximity: {
        signal: "within",
        distanceMeters: 18,
        accuracyMeters: 9,
        overrideReason: null,
      },
    });
    expect(fixture.documents.has(overrideAuditPath)).toBe(false);
  });

  it("refuses a measurement outside the radius with no reason and writes nothing", async () => {
    const { fixture, service } = fixtureFor({ latitude: 49.186, longitude: -2.106 });

    await expect(
      service.recordCheckIn({
        academyId,
        input: { sessionId, studentId, method: "manual", proximity: measurement(320) },
        actorId: "coach-user-1",
        actorRole: "coach",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(fixture.documents.has(attendancePath)).toBe(false);
    expect(
      fixture.documents.has(
        `academies/${academyId}/auditEvents/attendance-check-in-${attendanceId}`,
      ),
    ).toBe(false);
  });

  it("records a reasoned override as its own audited event", async () => {
    const { fixture, service } = fixtureFor({ latitude: 49.186, longitude: -2.106 });
    const overrideReason = "Signal drifted indoors; the student is on the mat.";

    await expect(
      service.recordCheckIn({
        academyId,
        input: {
          sessionId,
          studentId,
          method: "manual",
          proximity: measurement(320),
          overrideReason,
        },
        actorId: "coach-user-1",
        actorRole: "coach",
      }),
    ).resolves.toMatchObject({
      proximity: { signal: "outside", distanceMeters: 320, overrideReason },
    });
    expect(fixture.documents.get(overrideAuditPath)).toMatchObject({
      action: "attendance.proximity_override",
      actorId: "coach-user-1",
    });
    expect(fixture.documents.get(attendancePath)).toMatchObject({
      proximity: { signal: "outside", overrideReason },
    });
  });

  it("is unavailable, and needs no reason, when the site has no coordinates", async () => {
    const { fixture, service } = fixtureFor(undefined);

    await expect(
      service.recordCheckIn({
        academyId,
        input: { sessionId, studentId, method: "manual", proximity: measurement(320) },
        actorId: "coach-user-1",
        actorRole: "coach",
      }),
    ).resolves.toMatchObject({
      proximity: {
        signal: "unavailable",
        distanceMeters: null,
        accuracyMeters: null,
        overrideReason: null,
      },
    });
    expect(fixture.documents.has(overrideAuditPath)).toBe(false);
  });

  it("replays an identical check-in even after the measurement has aged past ten minutes", async () => {
    const { fixture } = fixtureFor({ latitude: 49.186, longitude: -2.106 });
    let clock = now;
    const service = createTransactionalAttendanceService({
      firestore: fixture.firestore as never,
      now: () => clock,
      correctionId: () => "corr-fixed-3",
    });
    const input = { sessionId, studentId, method: "manual" as const, proximity: measurement(18) };
    const first = await service.recordCheckIn({
      academyId,
      input,
      actorId: "coach-user-1",
      actorRole: "coach",
    });
    expect(first.proximity?.signal).toBe("within");

    // Fifteen minutes later the same retry is judged at the original time, not at retry time.
    clock = "2026-09-03T18:20:00.000Z";
    await expect(
      service.recordCheckIn({ academyId, input, actorId: "coach-user-1", actorRole: "coach" }),
    ).resolves.toEqual(first);
  });

  it("replays a record written before the signal existed as an unavailable check-in", async () => {
    const { fixture, service } = fixtureFor({ latitude: 49.186, longitude: -2.106 });
    const input = { sessionId, studentId, method: "manual" as const };
    const first = await service.recordCheckIn({
      academyId,
      input,
      actorId: "coach-user-1",
      actorRole: "coach",
    });

    // A pre-T109 record has no proximity field at all; its audit event is unchanged.
    const stored = { ...(fixture.documents.get(attendancePath) as Data) };
    delete stored.proximity;
    fixture.documents.set(attendancePath, stored);

    await expect(
      service.recordCheckIn({ academyId, input, actorId: "coach-user-1", actorRole: "coach" }),
    ).resolves.toMatchObject({ attendanceId: first.attendanceId, method: "manual" });
  });

  it("replays a check-in only when the recorded signal matches", async () => {
    const { service } = fixtureFor({ latitude: 49.186, longitude: -2.106 });
    const input = {
      sessionId,
      studentId,
      method: "manual" as const,
      proximity: measurement(18),
    };
    const first = await service.recordCheckIn({
      academyId,
      input,
      actorId: "coach-user-1",
      actorRole: "coach",
    });

    await expect(
      service.recordCheckIn({ academyId, input, actorId: "coach-user-1", actorRole: "coach" }),
    ).resolves.toEqual(first);

    // A different measurement is a different fact, so the replay is refused instead of overwritten.
    await expect(
      service.recordCheckIn({
        academyId,
        input: { ...input, proximity: measurement(44) },
        actorId: "coach-user-1",
        actorRole: "coach",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("site geofence writer at the transaction boundary (T109)", () => {
  it("stores the site coordinates and its audit event together, then clears them", async () => {
    const fixture = transactionalFirestore(new Map<string, Data>());
    const store = createFirestoreScheduleStore({ firestore: fixture.firestore as never });

    const saved = await store.saveLocationGeofence(
      academyId,
      { locationId: "town", geofence: { latitude: 49.186, longitude: -2.106 } },
      "owner-1",
    );
    expect(saved).toMatchObject({
      locationId: "town",
      academyId,
      name: "BPT Town",
      geofence: { latitude: 49.186, longitude: -2.106 },
    });
    expect(fixture.documents.get(`academies/${academyId}/locations/town`)).toMatchObject({
      geofence: { latitude: 49.186, longitude: -2.106 },
    });
    const audits = [...fixture.documents.entries()].filter(([path]) =>
      path.startsWith(`academies/${academyId}/auditEvents/location-geofence-town-`),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.[1]).toMatchObject({
      action: "location.geofence.saved",
      actorId: "owner-1",
      targetRef: `academies/${academyId}/locations/town`,
    });

    const cleared = await store.saveLocationGeofence(
      academyId,
      { locationId: "town", geofence: null },
      "owner-1",
    );
    expect(cleared.geofence).toBeNull();
    expect(fixture.documents.get(`academies/${academyId}/locations/town`)).toMatchObject({
      geofence: null,
      name: "BPT Town",
    });
  });
});

describe("member self check-in at the transaction boundary (T032V2)", () => {
  const town = { latitude: 49.183954, longitude: -2.107142 };
  const near = { latitude: 49.184224, longitude: -2.107142, accuracyMeters: 12 };
  const far = { latitude: 49.185034, longitude: -2.107142, accuracyMeters: 12 };

  function selfCheckInFixture(extra: ReadonlyArray<readonly [string, Data]> = []) {
    const sessionId = "session-self";
    const studentId = "adult-self";
    return {
      sessionId,
      studentId,
      attendanceId: `${sessionId}__${studentId}`,
      fixture: transactionalFirestore(
        new Map<string, Data>([
          [
            `academies/${academyId}/sessions/${sessionId}`,
            {
              sessionId,
              academyId,
              programId: "adult-fundamentals",
              locationId: "town",
              startAt: "2026-09-03T18:00:00.000Z",
              endAt: "2026-09-03T19:00:00.000Z",
              status: "scheduled",
            },
          ],
          [
            `academies/${academyId}/students/${studentId}`,
            {
              studentId,
              academyId,
              userId: "adult-user-1",
              fullName: "Synthetic Adult",
              dateOfBirth: "1990-01-01",
              trainingCenter: "Town",
              trainingTimePreferences: ["evening"],
              participantType: "adult",
              ...auditFields(),
            },
          ],
          [
            `academies/${academyId}/bookings/v2:12:session-self:10:adult-self`,
            {
              bookingId: "v2:12:session-self:10:adult-self",
              academyId,
              sessionId,
              studentId,
              membershipId: "membership-1",
              status: "confirmed",
            },
          ],
          [
            `academies/${academyId}/locations/town`,
            { locationId: "town", academyId, geofence: town },
          ],
          [
            `academies/${academyId}/programs/adult-fundamentals`,
            { programId: "adult-fundamentals", academyId, discipline: "bjj" },
          ],
          ...extra,
        ]),
      ),
    };
  }

  it("records an inside member self check-in as late without coordinates and replays its audited fact", async () => {
    const { fixture, sessionId, studentId, attendanceId } = selfCheckInFixture();
    const service = createTransactionalAttendanceService({
      firestore: fixture.firestore as never,
      now: () => now,
    });
    const context = {
      academyId,
      input: { sessionId, studentId, position: near },
      actorId: "adult-user-1",
      actorRole: "adultStudent" as const,
    };
    const record = await service.recordSelfCheckIn(context);
    expect(record).toMatchObject({
      attendanceId,
      method: "self",
      state: "late",
      createdBy: "adult-user-1",
      proximity: { signal: "within", distanceMeters: 30, accuracyMeters: 12, overrideReason: null },
    });
    const stored = fixture.documents.get(`academies/${academyId}/attendance/${attendanceId}`);
    const audit = fixture.documents.get(
      `academies/${academyId}/auditEvents/attendance-check-in-${attendanceId}`,
    );
    expect(audit).toMatchObject({ action: "attendance.checked_in", actorId: "adult-user-1" });
    for (const written of [JSON.stringify(stored), JSON.stringify(audit)]) {
      expect(written).not.toContain("49.18");
      expect(written).not.toContain("-2.107");
      expect(written).not.toContain("latitude");
    }
    const beforeReplay = new Map(fixture.documents);
    await expect(service.recordSelfCheckIn(context)).resolves.toEqual(record);
    expect(fixture.documents).toEqual(beforeReplay);
  });

  it("refuses member replays whose audit evidence differs without writing", async () => {
    const { fixture, sessionId, studentId, attendanceId } = selfCheckInFixture();
    const service = createTransactionalAttendanceService({
      firestore: fixture.firestore as never,
      now: () => now,
    });
    const context = {
      academyId,
      input: { sessionId, studentId, position: near },
      actorId: "adult-user-1",
      actorRole: "adultStudent" as const,
    };
    await service.recordSelfCheckIn(context);
    const auditPath = `academies/${academyId}/auditEvents/attendance-check-in-${attendanceId}`;
    fixture.documents.set(auditPath, {
      ...(fixture.documents.get(auditPath) as Data),
      actorId: "other",
    });
    const beforeRefusal = new Map(fixture.documents);
    await expect(service.recordSelfCheckIn(context)).rejects.toMatchObject({
      reason: "already_checked_in",
    });
    expect(fixture.documents).toEqual(beforeRefusal);
  });

  it("refuses bad position or authority without coordinates or writes", async () => {
    const { fixture, sessionId, studentId } = selfCheckInFixture();
    const service = createTransactionalAttendanceService({
      firestore: fixture.firestore as never,
      now: () => now,
    });
    const attempt = (position: typeof near, actorRole: "adultStudent" | "coach" = "adultStudent") =>
      service.recordSelfCheckIn({
        academyId,
        input: { sessionId, studentId, position },
        actorId: "adult-user-1",
        actorRole,
      });

    const beforeRefusals = new Map(fixture.documents);
    await expect(attempt(far)).rejects.toMatchObject({
      name: "SelfCheckInRefusedError",
      reason: "outside",
      distanceMeters: 120,
    });
    await expect(attempt({ ...near, accuracyMeters: 101 })).rejects.toMatchObject({
      reason: "imprecise",
    });
    await expect(attempt(near, "coach")).rejects.toMatchObject({ code: "credential" });
    await expect(attempt(far)).rejects.not.toThrow(/49\.18|-2\.10/u);
    expect(fixture.documents).toEqual(beforeRefusals);
  });

  it("refuses a closed window, an unready site, an unbooked member, and a coach record", async () => {
    const closed = selfCheckInFixture();
    const closedService = createTransactionalAttendanceService({
      firestore: closed.fixture.firestore as never,
      now: () => "2026-09-03T18:21:00.000Z",
    });
    await expect(
      closedService.recordSelfCheckIn({
        academyId,
        input: { sessionId: closed.sessionId, studentId: closed.studentId, position: near },
        actorId: "adult-user-1",
        actorRole: "adultStudent",
      }),
    ).rejects.toMatchObject({ reason: "window_closed" });

    const noSite = selfCheckInFixture();
    noSite.fixture.documents.set(`academies/${academyId}/locations/town`, {
      locationId: "town",
      academyId,
      geofence: null,
    });
    const noSiteService = createTransactionalAttendanceService({
      firestore: noSite.fixture.firestore as never,
      now: () => now,
    });
    await expect(
      noSiteService.recordSelfCheckIn({
        academyId,
        input: { sessionId: noSite.sessionId, studentId: noSite.studentId, position: near },
        actorId: "adult-user-1",
        actorRole: "adultStudent",
      }),
    ).rejects.toMatchObject({ reason: "site_not_ready" });

    const unbooked = selfCheckInFixture();
    unbooked.fixture.documents.delete(
      `academies/${academyId}/bookings/v2:12:session-self:10:adult-self`,
    );
    const unbookedService = createTransactionalAttendanceService({
      firestore: unbooked.fixture.firestore as never,
      now: () => now,
    });
    await expect(
      unbookedService.recordSelfCheckIn({
        academyId,
        input: { sessionId: unbooked.sessionId, studentId: unbooked.studentId, position: near },
        actorId: "adult-user-1",
        actorRole: "adultStudent",
      }),
    ).rejects.toMatchObject({ reason: "not_booked" });

    const coachFirst = selfCheckInFixture();
    const coachService = createTransactionalAttendanceService({
      firestore: coachFirst.fixture.firestore as never,
      now: () => now,
    });
    await coachService.recordCheckIn({
      academyId,
      input: { sessionId: coachFirst.sessionId, studentId: coachFirst.studentId, method: "manual" },
      actorId: "coach-user-1",
      actorRole: "coach",
    });
    await expect(
      coachService.recordSelfCheckIn({
        academyId,
        input: { sessionId: coachFirst.sessionId, studentId: coachFirst.studentId, position: near },
        actorId: "adult-user-1",
        actorRole: "adultStudent",
      }),
    ).rejects.toMatchObject({ reason: "already_checked_in" });
  });
});
