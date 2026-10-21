import { readFileSync } from "node:fs";

import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import { memberDirectoryStateSchema } from "@bpt-jersey/domain/members/directory";
import { MEMBER_MIGRATION_ID } from "@bpt-jersey/domain/members/migration";

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
        memberId: null,
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
          memberId: null,
          studentName: null,
          sessionId: "session-1",
          sessionStartAt: "2026-09-16T17:30:00.000Z",
          programId: "program-1",
          locationId: "location-1",
        },
      },
    ]);
  });

  it("keeps the class block of an imported row that names no session", async () => {
    const eventDoc = doc("event-import", {
      action: "booking.created",
      actorId: "regyfit-import",
      actorRole: "regyfit",
      actorGroup: "member",
      actorName: "Olivia Lewis",
      actorIp: null,
      source: "regyfit",
      occurredAt: Timestamp.fromDate(new Date("2026-03-10T09:00:00.000Z")),
      class: {
        studentId: null,
        memberId: null,
        studentName: "Olivia Lewis",
        sessionId: null,
        sessionStartAt: "2026-03-12T18:30:00.000Z",
        programId: null,
        locationId: null,
      },
    });
    const query = fakeQuery([eventDoc]);
    const store = createClassHistoryStore(fakeFirestore(query) as never, "demo-academy");

    const events = await store.queryEvents(baseQuery);

    expect(events[0]?.class).toEqual({
      studentId: null,
      memberId: null,
      studentName: "Olivia Lewis",
      sessionId: null,
      sessionStartAt: "2026-03-12T18:30:00.000Z",
      programId: null,
      locationId: null,
    });
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

/**
 * The "Logged by" filter adds a fourth equality to a query that already orders by time, and
 * Firestore answers an unindexed composite query with FAILED_PRECONDITION at runtime rather than
 * at deploy time. This test derives the index the query needs from the calls the adapter actually
 * makes and looks it up in the shipped `firestore.indexes.json`, so the two can never drift apart.
 */
type ShippedIndexField = Readonly<{ fieldPath: string; order?: string }>;
type ShippedIndex = Readonly<{
  collectionGroup: string;
  queryScope: string;
  fields: readonly ShippedIndexField[];
}>;

function shippedIndexes(): readonly ShippedIndex[] {
  const file = new URL("../../../../firestore.indexes.json", import.meta.url);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Readonly<{
    indexes: readonly ShippedIndex[];
  }>;
  return parsed.indexes;
}

describe("createClassHistoryStore.readMemberNames", () => {
  it("resolves a member uid to the student's own full name", async () => {
    const firestore = fakeStaffFirestore([
      [doc("student-ana", { userId: "uid-member-ana", fullName: "Ana Synthetic" })],
    ]);
    const store = createClassHistoryStore(firestore as never, "demo-academy");

    const members = await store.readMemberNames(["uid-member-ana"]);

    expect(firestore.collection).toHaveBeenCalledWith("academies/demo-academy/students");
    expect(firestore.whereCalls).toEqual([["userId", "in", ["uid-member-ana"]]]);
    expect(members.get("uid-member-ana")).toBe("Ana Synthetic");
  });

  it("never answers with the auth uid when no student holds that account", async () => {
    const firestore = fakeStaffFirestore([[]]);
    const store = createClassHistoryStore(firestore as never, "demo-academy");

    const members = await store.readMemberNames(["uid-guardian"]);

    expect(members.has("uid-guardian")).toBe(false);
    expect([...members.values()]).not.toContain("uid-guardian");
  });

  it("returns an empty map without querying when there are no uids", async () => {
    const firestore = fakeStaffFirestore([]);
    const store = createClassHistoryStore(firestore as never, "demo-academy");

    const members = await store.readMemberNames([]);

    expect(members.size).toBe(0);
    expect(firestore.collection).not.toHaveBeenCalled();
  });
});

const root = "academies/demo-academy";

function directoryState(overrides: Record<string, unknown> = {}) {
  return memberDirectoryStateSchema.parse({
    stateId: "current",
    academyId: "demo-academy",
    readerVersion: "canonical-v1",
    directoryWriteMode: "canonical-v1",
    freezeStatus: "open",
    stateRevision: 794,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "complete",
    identityKeyBaselineMac: "a".repeat(64),
    identityKeyBaselineArtifactId: "baseline-1",
    digestVersion: "hmac-sha256-v1",
    secretVersion: "2",
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: 400,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "system",
    updatedAt: "2026-10-20T00:00:00.000Z",
    updatedBy: "system",
    ...overrides,
  });
}

const eliminated = { globalLegacyReadEliminated: true, rollbackProtocolVersion: "disabled" };

function decision(memberId: string, studentId?: string, kind = "link") {
  return {
    legacyMemberId: memberId,
    academyId: "demo-academy",
    migrationId: MEMBER_MIGRATION_ID,
    kind,
    ...(studentId === undefined ? {} : { studentId }),
    decidedAt: "2026-09-20T10:00:00.000Z",
    decidedBy: "owner-1",
    schemaVersion: "1",
  };
}

function alias(studentId: string, canonicalStudentId: string) {
  return {
    academyId: "demo-academy",
    studentId,
    canonicalStudentId,
    requestId: "4d2c1b0a-9e8f-4a7b-8c6d-5e4f3a2b1c0d",
    evidence: "Same membership number",
    reason: "Duplicate record",
    previewRevision: "b".repeat(64),
    approvedBy: "owner-1",
    approvedAt: "2026-09-21T10:00:00.000Z",
    schemaVersion: "1",
  };
}

/**
 * Answers by document path and records every path read, so a test proves what was touched. With
 * `rerunAfter`, a transaction runs twice, as an optimistic engine reruns one whose reads went stale:
 * `rerunAfter` changes the store in between (the global marker landing).
 */
function directoryFirestore(
  documents: Readonly<Record<string, unknown>>,
  rerunAfter?: (set: (path: string, value: unknown) => void) => void,
) {
  const stored = new Map(Object.entries(documents));
  const reads: string[] = [];
  const snapshot = (path: string) => {
    reads.push(path);
    const data = stored.get(path) as Record<string, unknown> | undefined;
    return {
      id: path.slice(path.lastIndexOf("/") + 1),
      exists: data !== undefined,
      data: () => data,
    };
  };
  const getAll = async (...refs: readonly { path: string }[]) =>
    refs.map((ref) => snapshot(ref.path));
  const transaction = { get: async (ref: { path: string }) => snapshot(ref.path), getAll };
  const firestore = {
    doc: (path: string) => ({ path, get: async () => snapshot(path) }),
    getAll,
    runTransaction: async (callback: (current: typeof transaction) => Promise<unknown>) => {
      const result = await callback(transaction);
      if (rerunAfter === undefined) return result;
      rerunAfter((path, value) => stored.set(path, value));
      return callback(transaction);
    },
  };
  return { reads, store: createClassHistoryStore(firestore as never, "demo-academy") };
}

const legacyReads = (reads: readonly string[]) =>
  reads.filter((path) => path.startsWith(`${root}/members/`));

describe("createClassHistoryStore.readDirectoryMemberNames", () => {
  it("names a migrated member through its decision and approved alias, never the legacy copy", async () => {
    const { reads, store } = directoryFirestore({
      [`${root}/memberMigrationDecisions/member-7`]: decision("member-7", "student-old"),
      [`${root}/memberIdentityAliases/student-old`]: alias("student-old", "student-7"),
      [`${root}/students/student-7`]: { fullName: "Olivia Lewis" },
      [`${root}/students/student-old`]: { fullName: "Olivia Old Record" },
      [`${root}/members/member-7`]: { fullName: "Olivia Legacy" },
    });

    const names = await store.readDirectoryMemberNames(["member-7"]);

    expect(names).toEqual(new Map([["member-7", "Olivia Lewis"]]));
    expect(reads).toEqual([
      `${root}/memberMigrationDecisions/member-7`,
      `${root}/memberIdentityAliases/student-old`,
      `${root}/memberIdentityAliases/student-7`,
      `${root}/students/student-7`,
    ]);
  });

  it.each([
    ["a skipped member", decision("member-8", undefined, "skip")],
    ["another academy's decision", { ...decision("member-8", "student-8"), academyId: "other" }],
    ["a decision filed under another member", decision("member-9", "student-8")],
    ["an unreadable decision", { legacyMemberId: "member-8", studentId: "student-8" }],
  ])("guesses no link from %s", async (_label, stored) => {
    const { reads, store } = directoryFirestore({
      [`${root}/memberMigrationDecisions/member-8`]: stored,
      [`${root}/students/student-8`]: { fullName: "Somebody Else" },
      [`${root}/memberDirectoryStates/current`]: directoryState(eliminated),
    });

    const names = await store.readDirectoryMemberNames(["member-8"]);

    expect(names.size).toBe(0);
    expect(reads).not.toContain(`${root}/students/student-8`);
    expect(legacyReads(reads)).toEqual([]);
  });

  it.each([
    [
      "a cyclic alias chain",
      {
        [`${root}/memberIdentityAliases/student-a`]: alias("student-a", "student-b"),
        [`${root}/memberIdentityAliases/student-b`]: alias("student-b", "student-a"),
      },
    ],
    [
      "an alias that names another student",
      { [`${root}/memberIdentityAliases/student-a`]: alias("student-x", "student-b") },
    ],
    ["an erased student", {}],
  ])("leaves the member unnamed after %s", async (_label, aliases) => {
    const { reads, store } = directoryFirestore({
      [`${root}/memberMigrationDecisions/member-1`]: decision("member-1", "student-a"),
      [`${root}/students/student-b`]: { fullName: "Bea Wrong Person" },
      [`${root}/members/member-1`]: { fullName: "Legacy Copy" },
      ...aliases,
    });

    const names = await store.readDirectoryMemberNames(["member-1"]);

    expect(names.size).toBe(0);
    expect(legacyReads(reads)).toEqual([]);
  });

  it("reads the legacy directory only for an unlinked member, and only before the marker", async () => {
    const { reads, store } = directoryFirestore({
      [`${root}/memberMigrationDecisions/member-1`]: decision("member-1", "student-1"),
      [`${root}/students/student-1`]: { fullName: "Ana Canonical" },
      [`${root}/members/member-1`]: { fullName: "Ana Legacy" },
      [`${root}/members/member-2`]: { fullName: "Ben Not Migrated" },
      [`${root}/memberDirectoryStates/current`]: directoryState(),
    });

    const names = await store.readDirectoryMemberNames(["member-1", "member-2"]);

    expect(names).toEqual(
      new Map([
        ["member-1", "Ana Canonical"],
        ["member-2", "Ben Not Migrated"],
      ]),
    );
    expect(legacyReads(reads)).toEqual([`${root}/members/member-2`]);
  });

  it.each([
    ["after global elimination", directoryState(eliminated)],
    ["when the state is missing", undefined],
    ["when the state does not read", { stateId: "current", globalLegacyReadEliminated: false }],
  ])("never reads the legacy directory %s", async (_label, state) => {
    const { reads, store } = directoryFirestore({
      [`${root}/members/member-2`]: { fullName: "Ben Not Migrated" },
      ...(state === undefined ? {} : { [`${root}/memberDirectoryStates/current`]: state }),
    });

    const names = await store.readDirectoryMemberNames(["member-2"]);

    expect(names.size).toBe(0);
    expect(legacyReads(reads)).toEqual([]);
  });

  it("reads members only with the state that allowed it; a rerun after the marker reads none", async () => {
    let boundary = -1;
    const statePath = `${root}/memberDirectoryStates/current`;
    const { reads, store } = directoryFirestore(
      {
        [`${root}/members/member-2`]: { fullName: "Ben Not Migrated" },
        [statePath]: directoryState(),
      },
      (set) => {
        boundary = reads.length;
        set(statePath, directoryState(eliminated));
      },
    );

    const names = await store.readDirectoryMemberNames(["member-2"]);

    // The state and the members read share one transaction, and its rerun reads no member.
    expect(names.has("member-2")).toBe(false);
    expect(reads).toEqual([
      `${root}/memberMigrationDecisions/member-2`,
      statePath,
      `${root}/members/member-2`,
      statePath,
    ]);
    expect(legacyReads(reads.slice(boundary))).toEqual([]);
    // The blocker, stated rather than hidden: under an optimistic rerun the first attempt had
    // already read members. Physical zero after the cutover would need server-side locks to keep
    // the marker from committing meanwhile (documented, not verified here) or quiescence; neither
    // is shown.
    expect(legacyReads(reads.slice(0, boundary))).toEqual([`${root}/members/member-2`]);
  });

  it("reads nothing when no row names a member", async () => {
    const { reads, store } = directoryFirestore({});

    expect((await store.readDirectoryMemberNames([])).size).toBe(0);
    expect(reads).toEqual([]);
  });
});

describe("the class history query and the shipped composite indexes", () => {
  it("has a shipped auditEvents index for the Logged by filter", async () => {
    const query = fakeQuery([]);
    const store = createClassHistoryStore(fakeFirestore(query) as never, "demo-academy");

    await store.queryEvents({ ...baseQuery, actorId: "uid-member-ana" });

    const equalityFields = query.where.mock.calls
      .filter((call) => call[1] === "==" || call[1] === "in")
      .map((call) => call[0] as string);
    expect([...equalityFields].sort()).toEqual(["action", "actorGroup", "actorId"]);
    expect(query.orderBy).toHaveBeenCalledWith("occurredAt", "desc");

    const match = shippedIndexes().find(
      (index) =>
        index.collectionGroup === "auditEvents" &&
        index.queryScope === "COLLECTION" &&
        index.fields.length === equalityFields.length + 1 &&
        index.fields
          .slice(0, equalityFields.length)
          .every(
            (field) => equalityFields.includes(field.fieldPath) && field.order === "ASCENDING",
          ) &&
        index.fields.at(-1)?.fieldPath === "occurredAt" &&
        index.fields.at(-1)?.order === "DESCENDING",
    );

    expect(match?.fields.map((field) => `${field.fieldPath}:${field.order ?? ""}`)).toEqual([
      "actorId:ASCENDING",
      "action:ASCENDING",
      "actorGroup:ASCENDING",
      "occurredAt:DESCENDING",
    ]);
  });
});
