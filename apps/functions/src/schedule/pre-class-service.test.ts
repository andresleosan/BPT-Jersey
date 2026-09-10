import { describe, expect, it } from "vitest";

import { PreClassError, createPreClassService, type PreClassFirestore } from "./pre-class-service";

const academyId = "academy-1";
const now = "2026-09-08T17:00:00.000Z";

type Data = Record<string, unknown>;

function sessionDoc(overrides: Partial<Data> & { sessionId: string }): Data {
  return {
    academyId,
    classId: null,
    programId: "adults-bjj",
    locationId: "town",
    instructorId: "coach-1",
    title: "Adults Gi",
    startAt: "2026-09-08T18:00:00.000Z",
    endAt: "2026-09-08T19:00:00.000Z",
    capacity: 20,
    minParticipants: 4,
    status: "scheduled",
    isSeminar: false,
    cancellationReason: null,
    schemaVersion: "1",
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-08-01T00:00:00.000Z",
    updatedBy: "owner-1",
    ...overrides,
  };
}

function attendanceDoc(studentId: string, sessionId: string, occurredAt: string): Data {
  return {
    attendanceId: `${sessionId}__${studentId}`,
    academyId,
    sessionId,
    studentId,
    method: "manual",
    state: "attended",
    occurredAt,
    correctionOf: null,
  };
}

function studentDoc(studentId: string, fullName: string): Data {
  return { studentId, academyId, fullName, active: true, status: "active" };
}

type Read = Readonly<{ path: string; filters: readonly (readonly [string, string, unknown])[] }>;

function firestoreFixture(documents: Map<string, Data>) {
  const reads: Read[] = [];
  function query(
    path: string,
    filters: readonly (readonly [string, string, unknown])[],
  ): ReturnType<PreClassFirestore["collection"]> {
    const self = {
      where: (field: string, operator: string, value: unknown) =>
        query(path, [...filters, [field, operator, value] as const]),
      limit: () => self,
      get: async () => {
        reads.push({ path, filters });
        const prefix = `${path}/`;
        return {
          docs: [...documents.entries()]
            .filter(
              ([documentPath, data]) =>
                documentPath.startsWith(prefix) &&
                !documentPath.slice(prefix.length).includes("/") &&
                filters.every(([field, operator, value]) => {
                  const current = data[field];
                  if (operator === "==") return current === value;
                  if (operator === ">=") return String(current) >= String(value);
                  return String(current) < String(value);
                }),
            )
            .map(([documentPath, data]) => ({
              id: documentPath.split("/").at(-1) ?? "",
              data: () => data,
            })),
        };
      },
    };
    return self as unknown as ReturnType<PreClassFirestore["collection"]>;
  }
  return {
    reads,
    firestore: {
      doc: (path: string) => ({
        get: async () => {
          reads.push({ path, filters: [] });
          return {
            exists: documents.has(path),
            id: path.split("/").at(-1) ?? "",
            data: () => documents.get(path),
          };
        },
      }),
      collection: (path: string) => query(path, []),
    } as PreClassFirestore,
  };
}

function baseDocuments(): Map<string, Data> {
  return new Map<string, Data>([
    [`academies/${academyId}/sessions/target`, sessionDoc({ sessionId: "target" })],
    [
      `academies/${academyId}/sessions/past-1`,
      sessionDoc({
        sessionId: "past-1",
        startAt: "2026-09-01T18:00:00.000Z",
        endAt: "2026-09-01T19:00:00.000Z",
      }),
    ],
    [
      `academies/${academyId}/sessions/past-2`,
      sessionDoc({
        sessionId: "past-2",
        startAt: "2026-08-25T18:00:00.000Z",
        endAt: "2026-08-25T19:00:00.000Z",
      }),
    ],
    [
      `academies/${academyId}/attendance/past-1__s-regular`,
      attendanceDoc("s-regular", "past-1", "2026-09-01T18:05:00.000Z"),
    ],
    [
      `academies/${academyId}/attendance/past-2__s-regular`,
      attendanceDoc("s-regular", "past-2", "2026-08-25T18:05:00.000Z"),
    ],
    [`academies/${academyId}/students/s-regular`, studentDoc("s-regular", "Bruno Le Sueur")],
  ]);
}

function serviceWith(documents: Map<string, Data>) {
  const fixture = firestoreFixture(documents);
  return {
    ...fixture,
    service: createPreClassService({ firestore: fixture.firestore, now: () => now }),
  };
}

describe("createPreClassService (T114)", () => {
  it("suggests the regular of the same class from canonical attendance", async () => {
    const { service } = serviceWith(baseDocuments());
    const view = await service.getPreClassView({ academyId, sessionId: "target" });
    expect(view.attendees).toEqual([
      {
        studentId: "s-regular",
        displayName: "Bruno Le Sueur",
        source: "regular",
        status: null,
        attendedCount: 2,
        comparableSessionCount: 2,
        lastAttendedAt: "2026-09-01T18:05:00.000Z",
      },
    ]);
    expect(view.evidence).toMatchObject({ open: true, comparableSessionCount: 2 });
  });

  it("asks Firestore only for the session's own records, its programme and the window", async () => {
    const { service, reads } = serviceWith(baseDocuments());
    await service.getPreClassView({ academyId, sessionId: "target" });
    expect(reads.map((read) => read.path)).toEqual([
      `academies/${academyId}/sessions/target`,
      `academies/${academyId}/bookings`,
      `academies/${academyId}/attendance`,
      `academies/${academyId}/sessions`,
      `academies/${academyId}/students`,
      `academies/${academyId}/attendance`,
    ]);
    const sessions = reads.find(
      (read) => read.path.endsWith("/sessions") && read.filters.length > 0,
    );
    expect(sessions?.filters).toEqual([
      ["programId", "==", "adults-bjj"],
      ["startAt", ">=", "2026-07-14T17:00:00.000Z"],
    ]);
    expect(reads.find((read) => read.path.endsWith("/students"))?.filters).toEqual([
      ["active", "==", true],
    ]);
  });

  it("never reads a session of another tenant", async () => {
    const documents = baseDocuments();
    documents.set(
      `academies/${academyId}/sessions/foreign`,
      sessionDoc({ sessionId: "foreign", academyId: "academy-2" }),
    );
    const { service } = serviceWith(documents);
    await expect(service.getPreClassView({ academyId, sessionId: "foreign" })).rejects.toThrow(
      PreClassError,
    );
  });

  it("refuses an unknown session and an invalid identifier", async () => {
    const { service } = serviceWith(baseDocuments());
    await expect(service.getPreClassView({ academyId, sessionId: "absent" })).rejects.toThrow(
      PreClassError,
    );
    await expect(
      service.getPreClassView({ academyId: "../escape", sessionId: "target" }),
    ).rejects.toThrow(PreClassError);
    await expect(
      service.getPreClassView({ academyId, sessionId: "target", now: "not-a-time" }),
    ).rejects.toThrow(PreClassError);
  });

  it("returns an honest empty list for a class nobody has trained", async () => {
    const documents = new Map<string, Data>([
      [`academies/${academyId}/sessions/target`, sessionDoc({ sessionId: "target" })],
    ]);
    const { service } = serviceWith(documents);
    const view = await service.getPreClassView({ academyId, sessionId: "target" });
    expect(view.attendees).toEqual([]);
    expect(view.evidence).toMatchObject({ bookedCount: 0, suggestedCount: 0 });
  });

  it("stops suggesting once the class is cancelled", async () => {
    const documents = baseDocuments();
    documents.set(
      `academies/${academyId}/sessions/target`,
      sessionDoc({ sessionId: "target", status: "cancelled" }),
    );
    const { service } = serviceWith(documents);
    const view = await service.getPreClassView({ academyId, sessionId: "target" });
    expect(view.evidence).toMatchObject({ open: false, suggestedCount: 0 });
    expect(view.attendees).toEqual([]);
  });
});
