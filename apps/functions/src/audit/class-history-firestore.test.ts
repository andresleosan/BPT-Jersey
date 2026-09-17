import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import { createClassHistoryStore } from "./class-history-firestore.js";
import type { ClassHistoryQuery } from "./class-history-service.js";

type FakeDoc = Readonly<{
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}>;

function doc(id: string, data: Record<string, unknown>): FakeDoc {
  return { id, exists: true, data: () => data };
}

function fakeQuery(docs: readonly FakeDoc[]) {
  const query = {
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    get: vi.fn().mockResolvedValue({ docs }),
  };
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.startAfter.mockReturnValue(query);
  return query;
}

function fakeFirestore(query: ReturnType<typeof fakeQuery>, batchDocs: readonly FakeDoc[] = []) {
  return {
    collection: vi.fn().mockReturnValue(query),
    doc: vi.fn((path: string) => ({ id: path.slice(path.lastIndexOf("/") + 1), path })),
    getAll: vi.fn().mockResolvedValue(batchDocs),
  };
}

const baseQuery: ClassHistoryQuery = {
  academyId: "demo-academy",
  actions: ["booking.created"],
  groups: ["member"],
  actorId: null,
  since: "2026-09-01T00:00:00.000Z",
  limit: 100,
  cursor: null,
};

describe("createClassHistoryStore.queryEvents", () => {
  it("queries auditEvents by action, actor group and time, newest first", async () => {
    const eventDoc = doc("event-1", {
      action: "booking.created",
      actorId: "s1",
      actorRole: "adultStudent",
      actorGroup: "member",
      actorName: null,
      actorIp: "82.112.144.10",
      source: "bpt",
      occurredAt: Timestamp.fromDate(new Date("2026-09-16T10:00:00.000Z")),
      class: {
        studentId: "s1",
        studentName: null,
        sessionId: "session-1",
        sessionStartAt: "2026-09-16T17:30:00.000Z",
        programId: "program-1",
        locationId: "location-1",
      },
    });
    const query = fakeQuery([eventDoc]);
    const firestore = fakeFirestore(query);
    const store = createClassHistoryStore(firestore as never, "demo-academy");

    const events = await store.queryEvents(baseQuery);

    expect(firestore.collection).toHaveBeenCalledWith("academies/demo-academy/auditEvents");
    expect(query.where).toHaveBeenNthCalledWith(1, "action", "in", ["booking.created"]);
    expect(query.where).toHaveBeenNthCalledWith(2, "actorGroup", "in", ["member"]);

    // occurredAt is stored as a Firestore server timestamp, not an ISO string, so the query must
    // compare against a Timestamp - a raw ISO string would never match a Timestamp field.
    const sinceCall = query.where.mock.calls[2];
    expect(sinceCall?.[0]).toBe("occurredAt");
    expect(sinceCall?.[1]).toBe(">=");
    expect(sinceCall?.[2]).toBeInstanceOf(Timestamp);
    expect((sinceCall?.[2] as Timestamp).toDate().toISOString()).toBe("2026-09-01T00:00:00.000Z");

    expect(query.orderBy).toHaveBeenCalledWith("occurredAt", "desc");
    expect(query.limit).toHaveBeenCalledWith(100);
    expect(query.startAfter).not.toHaveBeenCalled();

    expect(events).toEqual([
      {
        id: "event-1",
        occurredAt: "2026-09-16T10:00:00.000Z",
        action: "booking.created",
        actorId: "s1",
        actorRole: "adultStudent",
        actorGroup: "member",
        actorName: null,
        actorIp: "82.112.144.10",
        source: "bpt",
        class: {
          studentId: "s1",
          studentName: null,
          sessionId: "session-1",
          sessionStartAt: "2026-09-16T17:30:00.000Z",
          programId: "program-1",
          locationId: "location-1",
        },
      },
    ]);
  });

  it("filters by actor id and pages from the cursor when they are given", async () => {
    const query = fakeQuery([]);
    const firestore = fakeFirestore(query);
    const store = createClassHistoryStore(firestore as never, "demo-academy");

    await store.queryEvents({
      ...baseQuery,
      actorId: "coach-9",
      cursor: "2026-09-16T11:00:00.000Z",
    });

    expect(query.where).toHaveBeenNthCalledWith(4, "actorId", "==", "coach-9");
    expect(query.startAfter).toHaveBeenCalledTimes(1);
    const cursorArgument = query.startAfter.mock.calls[0]?.[0] as Timestamp;
    expect(cursorArgument).toBeInstanceOf(Timestamp);
    expect(cursorArgument.toDate().toISOString()).toBe("2026-09-16T11:00:00.000Z");
  });

  it("defaults the class-shape fields for a row written before they existed", async () => {
    const legacyDoc = doc("event-legacy", {
      action: "attendance.checked_in",
      actorId: "coach-9",
      occurredAt: Timestamp.fromDate(new Date("2026-05-02T08:00:00.000Z")),
    });
    const query = fakeQuery([legacyDoc]);
    const firestore = fakeFirestore(query);
    const store = createClassHistoryStore(firestore as never, "demo-academy");

    const [event] = await store.queryEvents(baseQuery);

    expect(event).toEqual({
      id: "event-legacy",
      occurredAt: "2026-05-02T08:00:00.000Z",
      action: "attendance.checked_in",
      actorId: "coach-9",
      actorRole: "system",
      actorGroup: "system",
      actorName: null,
      actorIp: null,
      source: "bpt",
      class: null,
    });
  });
});

describe("createClassHistoryStore batch reads", () => {
  it("reads students in one batch and tolerates missing ones", async () => {
    const query = fakeQuery([]);
    const firestore = fakeFirestore(query, [
      doc("s1", { fullName: "Olivia Lewis" }),
      { id: "gone", exists: false, data: () => undefined },
    ]);
    const store = createClassHistoryStore(firestore as never, "demo-academy");

    const students = await store.readStudents(["s1", "gone"]);

    expect(firestore.getAll).toHaveBeenCalledWith(
      { id: "s1", path: "academies/demo-academy/students/s1" },
      { id: "gone", path: "academies/demo-academy/students/gone" },
    );
    expect(students.get("s1")).toBe("Olivia Lewis");
    expect(students.has("gone")).toBe(false);
  });

  it("returns an empty map without calling Firestore when there are no ids", async () => {
    const query = fakeQuery([]);
    const firestore = fakeFirestore(query);
    const store = createClassHistoryStore(firestore as never, "demo-academy");

    const staff = await store.readStaffNames([]);

    expect(staff.size).toBe(0);
    expect(firestore.getAll).not.toHaveBeenCalled();
  });

  it("resolves each session's program name and tolerates a missing session", async () => {
    const query = fakeQuery([]);
    const firestore = fakeFirestore(query);
    firestore.getAll
      .mockResolvedValueOnce([
        doc("session-1", { startAt: "2026-09-16T17:30:00.000Z", programId: "program-1" }),
      ])
      .mockResolvedValueOnce([doc("program-1", { name: "Adults Gi" })]);
    const store = createClassHistoryStore(firestore as never, "demo-academy");

    const sessions = await store.readSessions(["session-1", "gone"]);

    expect(firestore.getAll).toHaveBeenNthCalledWith(
      1,
      { id: "session-1", path: "academies/demo-academy/sessions/session-1" },
      { id: "gone", path: "academies/demo-academy/sessions/gone" },
    );
    expect(firestore.getAll).toHaveBeenNthCalledWith(2, {
      id: "program-1",
      path: "academies/demo-academy/programs/program-1",
    });
    expect(sessions.get("session-1")).toEqual({
      startAt: "2026-09-16T17:30:00.000Z",
      programId: "program-1",
      programName: "Adults Gi",
    });
    expect(sessions.has("gone")).toBe(false);
  });

  it("still returns a session missing its program's name", async () => {
    const query = fakeQuery([]);
    const firestore = fakeFirestore(query);
    firestore.getAll
      .mockResolvedValueOnce([
        doc("session-1", { startAt: "2026-09-16T17:30:00.000Z", programId: "gone-program" }),
      ])
      .mockResolvedValueOnce([{ id: "gone-program", exists: false, data: () => undefined }]);
    const store = createClassHistoryStore(firestore as never, "demo-academy");

    const sessions = await store.readSessions(["session-1"]);

    expect(sessions.get("session-1")).toEqual({
      startAt: "2026-09-16T17:30:00.000Z",
      programId: "gone-program",
      programName: null,
    });
  });
});

/**
 * `readStaffNames` resolves the Firebase Auth uid an audit event's `actorId` carries to the
 * `staffKey` (the staff document's own id) by querying `staff` where `userId` matches - `getAll`
 * cannot do this because the collection is keyed by staffId, not by uid. Each `where("userId",
 * "in", ...)` call is a fresh `collection()` call in this fake, one per chunk of at most 30 uids.
 */
function fakeStaffFirestore(chunkResults: readonly (readonly FakeDoc[])[]) {
  const whereCalls: unknown[][] = [];
  let chunkIndex = 0;
  const collection = vi.fn(() => {
    const docs = chunkResults[chunkIndex] ?? [];
    chunkIndex += 1;
    const query = {
      where: vi.fn((...args: unknown[]) => {
        whereCalls.push(args);
        return query;
      }),
      get: vi.fn().mockResolvedValue({ docs }),
    };
    return query;
  });
  return {
    collection,
    doc: vi.fn((path: string) => ({ id: path.slice(path.lastIndexOf("/") + 1), path })),
    getAll: vi.fn(),
    whereCalls,
  };
}

describe("createClassHistoryStore.readStaffNames", () => {
  it("resolves a staff uid to its staffKey", async () => {
    const firestore = fakeStaffFirestore([[doc("staff-42", { userId: "uid-coach-9" })]]);
    const store = createClassHistoryStore(firestore as never, "demo-academy");

    const staff = await store.readStaffNames(["uid-coach-9"]);

    expect(firestore.collection).toHaveBeenCalledWith("academies/demo-academy/staff");
    expect(firestore.whereCalls).toEqual([["userId", "in", ["uid-coach-9"]]]);
    expect(staff.get("uid-coach-9")).toBe("staff-42");
  });

  it("leaves an unknown uid absent from the map", async () => {
    const firestore = fakeStaffFirestore([[]]);
    const store = createClassHistoryStore(firestore as never, "demo-academy");

    const staff = await store.readStaffNames(["uid-nobody"]);

    expect(staff.has("uid-nobody")).toBe(false);
  });

  it("never returns the auth uid itself as a resolved value", async () => {
    const firestore = fakeStaffFirestore([[doc("staff-42", { userId: "uid-coach-9" })]]);
    const store = createClassHistoryStore(firestore as never, "demo-academy");

    const staff = await store.readStaffNames(["uid-coach-9"]);

    expect([...staff.values()]).not.toContain("uid-coach-9");
    expect(staff.get("uid-coach-9")).toBe("staff-42");
  });

  it("chunks more than 30 uids into more than one query and merges the results", async () => {
    const uids = Array.from({ length: 35 }, (_, index) => `uid-${index}`);
    const firstChunkDocs = uids
      .slice(0, 30)
      .map((uid, index) => doc(`staff-${index}`, { userId: uid }));
    const secondChunkDocs = uids
      .slice(30)
      .map((uid, index) => doc(`staff-${index + 30}`, { userId: uid }));
    const firestore = fakeStaffFirestore([firstChunkDocs, secondChunkDocs]);
    const store = createClassHistoryStore(firestore as never, "demo-academy");

    const staff = await store.readStaffNames(uids);

    expect(firestore.collection).toHaveBeenCalledTimes(2);
    expect(firestore.whereCalls[0]?.[2]).toHaveLength(30);
    expect(firestore.whereCalls[1]?.[2]).toHaveLength(5);
    expect(staff.get("uid-0")).toBe("staff-0");
    expect(staff.get("uid-34")).toBe("staff-34");
    expect(staff.size).toBe(35);
  });
});
