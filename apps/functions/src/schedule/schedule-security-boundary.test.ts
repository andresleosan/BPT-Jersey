import { describe, expect, it } from "vitest";

import {
  ScheduleAttendanceError,
  createTransactionalAttendanceService,
} from "./attendance-transaction-service";

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
            if (staged.has(reference.path)) throw new Error("already exists");
            staged.set(reference.path, data);
          },
          set: (reference: Reference, data: Data) => staged.set(reference.path, data),
          update: (reference: Reference, data: Data) => {
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
