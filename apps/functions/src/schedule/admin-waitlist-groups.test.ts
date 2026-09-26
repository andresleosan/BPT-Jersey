import { describe, expect, it } from "vitest";

import type { WaitlistEntryRecord } from "@bpt-jersey/domain/schedule/advanced-booking";
import {
  createFirestoreWaitlistGroupsReader,
  createListAdminWaitlistGroupsHandler,
  groupWaitlistEntries,
  type WaitlistGroupSession,
  type WaitlistGroupsReader,
} from "./admin-waitlist-groups";

const now = "2026-09-26T08:00:00.000Z";

function entry(
  sessionId: string,
  studentId: string,
  position: number,
  overrides: Partial<WaitlistEntryRecord> = {},
): WaitlistEntryRecord {
  return Object.freeze({
    waitlistId: sessionId + "__" + studentId,
    academyId: "academy-1",
    sessionId,
    studentId,
    membershipId: "membership-" + studentId,
    position,
    status: "waiting",
    requestedAt: "2026-09-20T09:00:00.000Z",
    offeredAt: null,
    offerExpiresAt: null,
    acceptedAt: null,
    cancelledAt: null,
    schemaVersion: "1",
    createdAt: "2026-09-20T09:00:00.000Z",
    createdBy: studentId,
    updatedAt: "2026-09-20T09:00:00.000Z",
    updatedBy: studentId,
    ...overrides,
  });
}

function session(
  sessionId: string,
  startAt: string,
  overrides: Partial<WaitlistGroupSession> = {},
): WaitlistGroupSession {
  return Object.freeze({
    sessionId,
    classId: "class-adult",
    title: "Adult Fundamentals",
    locationId: "town",
    startAt,
    status: "scheduled",
    ...overrides,
  });
}

const laterAdult = session("session-b", "2026-09-29T17:30:00.000Z");
const earlierAdult = session("session-a", "2026-09-27T17:30:00.000Z");
const kids = session("session-k", "2026-09-28T16:00:00.000Z", {
  classId: "class-kids",
  title: "Kids BJJ",
  locationId: "west",
});

describe("groupWaitlistEntries", () => {
  it("groups entries by recurring class with a waiting count and sessions ordered by date", () => {
    const groups = groupWaitlistEntries(
      [
        entry("session-b", "student-1", 1),
        entry("session-a", "student-2", 1),
        entry("session-a", "student-3", 2),
        entry("session-k", "student-4", 1),
      ],
      [laterAdult, earlierAdult, kids],
      now,
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      groupId: "class-adult",
      title: "Adult Fundamentals",
      location: "town",
      count: 3,
    });
    expect(groups[0]?.sessions.map((item) => item.sessionId)).toEqual(["session-a", "session-b"]);
    expect(groups[0]?.sessions[0]?.entries.map((item) => item.studentReference)).toEqual([
      "student-2",
      "student-3",
    ]);
    expect(groups[1]).toMatchObject({ groupId: "class-kids", title: "Kids BJJ", count: 1 });
  });

  it("groups a session without a recurring class under its own session key and title", () => {
    const oneOff = session("session-open", "2026-09-30T10:00:00.000Z", {
      classId: null,
      title: "Open Mat Special",
    });
    const groups = groupWaitlistEntries([entry("session-open", "student-1", 1)], [oneOff], now);

    expect(groups).toEqual([
      expect.objectContaining({
        groupId: "session:session-open",
        title: "Open Mat Special",
        count: 1,
      }),
    ]);
  });

  it("excludes accepted, expired and cancelled entries, lapsed offers and past sessions", () => {
    const past = session("session-past", "2026-09-25T17:30:00.000Z");
    const groups = groupWaitlistEntries(
      [
        entry("session-a", "student-1", 1, { status: "accepted" }),
        entry("session-a", "student-2", 2, { status: "expired" }),
        entry("session-a", "student-3", 3, { status: "cancelled" }),
        entry("session-a", "student-4", 4, {
          status: "offered",
          offeredAt: "2026-09-26T07:00:00.000Z",
          offerExpiresAt: "2026-09-26T07:30:00.000Z",
        }),
        entry("session-past", "student-5", 1),
        entry("session-missing", "student-6", 1),
      ],
      [earlierAdult, past],
      now,
    );

    expect(groups).toEqual([]);
  });

  it("keeps a live offer in its session without counting it as waiting", () => {
    const groups = groupWaitlistEntries(
      [
        entry("session-a", "student-1", 1, {
          status: "offered",
          offeredAt: "2026-09-26T07:50:00.000Z",
          offerExpiresAt: "2026-09-26T08:20:00.000Z",
        }),
        entry("session-a", "student-2", 2),
      ],
      [earlierAdult],
      now,
    );

    expect(groups[0]?.count).toBe(1);
    expect(groups[0]?.sessions[0]?.entries.map((item) => item.status)).toEqual([
      "offered",
      "waiting",
    ]);
  });
});

function reader(
  entries: readonly WaitlistEntryRecord[],
  sessions: readonly WaitlistGroupSession[],
  truncated: { sessions?: boolean; entries?: boolean } = {},
) {
  const calls: Array<{ academyId: string; sessionIds: readonly string[] }> = [];
  const ranges: Array<{ academyId: string; from: string; to: string }> = [];
  const value: WaitlistGroupsReader = {
    async listUpcomingSessions(academyId, from, to) {
      ranges.push({ academyId, from, to });
      return { sessions, truncated: truncated.sessions ?? false };
    },
    async listLiveEntries(academyId, sessionIds) {
      calls.push({ academyId, sessionIds });
      return {
        entries: entries.filter((item) => sessionIds.includes(item.sessionId)),
        truncated: truncated.entries ?? false,
      };
    },
  };
  return { value, calls, ranges };
}

function request(data: unknown, role: string, academyId = "academy-1") {
  return { auth: { uid: role + "-1", token: { role, academyId } }, data } as never;
}

describe("listAdminWaitlistGroups handler", () => {
  it("lets a coach read the grouped queues without membership or tenant fields", async () => {
    const { value, calls, ranges } = reader([entry("session-a", "student-1", 1)], [earlierAdult]);
    const response = await createListAdminWaitlistGroupsHandler({
      reader: value,
      now: () => now,
    })(request({}, "coach"));

    expect(ranges).toEqual([{ academyId: "academy-1", from: now, to: "2026-11-10T08:00:00.000Z" }]);
    expect(calls).toEqual([{ academyId: "academy-1", sessionIds: ["session-a"] }]);
    expect(response.truncated).toBe(false);
    expect(response.groups).toHaveLength(1);
    const listed = response.groups[0]?.sessions[0]?.entries[0];
    expect(listed).toMatchObject({ studentReference: "student-1", position: 1 });
    expect(listed).not.toHaveProperty("membershipId");
    expect(listed).not.toHaveProperty("academyId");
    expect(listed).not.toHaveProperty("studentId");
    expect(JSON.stringify(response)).not.toMatch(/membership|price|amount|pence/iu);
  });

  it("reports a truncated read when either cap is hit", async () => {
    for (const truncated of [{ sessions: true }, { entries: true }]) {
      const { value } = reader([entry("session-a", "student-1", 1)], [earlierAdult], truncated);
      const response = await createListAdminWaitlistGroupsHandler({
        reader: value,
        now: () => now,
      })(request({}, "owner"));
      expect(response.truncated).toBe(true);
      expect(response.groups).toHaveLength(1);
    }
  });

  it("reads no entries when no session is upcoming", async () => {
    const { value, calls } = reader([entry("session-a", "student-1", 1)], []);
    const response = await createListAdminWaitlistGroupsHandler({
      reader: value,
      now: () => now,
    })(request({}, "owner"));
    expect(calls).toEqual([]);
    expect(response).toEqual({ groups: [], truncated: false });
  });

  it.each(["guardian", "adultStudent", "teenStudent", "reception"])("rejects %s", async (role) => {
    const { value } = reader([], []);
    await expect(
      createListAdminWaitlistGroupsHandler({ reader: value, now: () => now })(request({}, role)),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("rejects an unexpected payload", async () => {
    const { value } = reader([], []);
    await expect(
      createListAdminWaitlistGroupsHandler({ reader: value, now: () => now })(
        request({ academyId: "academy-2" }, "owner"),
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});

describe("Firestore waitlist groups reader", () => {
  type Filter = { field: string; op: string; value: unknown };
  function fakeFirestore(rows: Record<string, Record<string, unknown>[]>) {
    const queries: Array<{ path: string; filters: Filter[]; limit: number }> = [];
    const query = (path: string, filters: Filter[], limit = Infinity) => ({
      where: (field: string, op: string, value: unknown) =>
        query(path, [...filters, { field, op, value }], limit),
      limit: (count: number) => query(path, filters, count),
      get: async () => {
        queries.push({ path, filters, limit });
        const matches = (rows[path] ?? []).filter((row) =>
          filters.every(({ field, op, value }) =>
            op === "in"
              ? (value as unknown[]).includes(row[field])
              : op === ">="
                ? String(row[field]) >= String(value)
                : op === "<="
                  ? String(row[field]) <= String(value)
                  : row[field] === value,
          ),
        );
        return {
          docs: matches
            .slice(0, limit)
            .map((row) => ({ id: String(row.waitlistId ?? row.sessionId), data: () => row })),
        };
      },
    });
    return {
      queries,
      firestore: { collection: (path: string) => query(path, []) } as never,
    };
  }

  const sessionRow = (index: number) => ({
    sessionId: `s-${String(index).padStart(3, "0")}`,
    classId: "class-adult",
    title: "Adult Fundamentals",
    locationId: "town",
    startAt: "2026-09-27T17:30:00.000Z",
    status: "scheduled",
  });

  it("reads scheduled sessions in the window, then live entries per chunk of sessions", async () => {
    const sessions = Array.from({ length: 20 }, (_, index) => sessionRow(index));
    const stale = Array.from({ length: 600 }, (_, index) =>
      entry("s-old", `old-${index}`, index + 1),
    );
    const live = [entry("s-019", "student-1", 1)];
    const fake = fakeFirestore({
      "academies/academy-1/sessions": sessions,
      "academies/academy-1/waitlistEntries": [...stale, ...live],
    });
    const reader = createFirestoreWaitlistGroupsReader(fake.firestore);

    const upcoming = await reader.listUpcomingSessions(
      "academy-1",
      now,
      "2026-11-10T08:00:00.000Z",
    );
    expect(upcoming.truncated).toBe(false);
    expect(upcoming.sessions).toHaveLength(20);
    expect(fake.queries[0]?.filters).toEqual([
      { field: "status", op: "==", value: "scheduled" },
      { field: "startAt", op: ">=", value: now },
      { field: "startAt", op: "<=", value: "2026-11-10T08:00:00.000Z" },
    ]);

    const result = await reader.listLiveEntries(
      "academy-1",
      upcoming.sessions.map((item) => item.sessionId),
    );
    expect(result).toEqual({ entries: live, truncated: false });
    const entryQueries = fake.queries.slice(1);
    expect(entryQueries).toHaveLength(2);
    for (const item of entryQueries) {
      const sessionFilter = item.filters.find((filter) => filter.field === "sessionId");
      expect(sessionFilter?.op).toBe("in");
      // Two statuses times the session ids must stay within Firestore's 30 disjunctions.
      expect((sessionFilter?.value as unknown[]).length * 2).toBeLessThanOrEqual(30);
      expect(item.filters).toContainEqual({
        field: "status",
        op: "in",
        value: ["waiting", "offered"],
      });
    }
  });

  it("flags truncation instead of silently dropping rows", async () => {
    const fake = fakeFirestore({
      "academies/academy-1/sessions": Array.from({ length: 501 }, (_, index) => sessionRow(index)),
      "academies/academy-1/waitlistEntries": Array.from({ length: 501 }, (_, index) =>
        entry("s-000", `student-${index}`, index + 1),
      ),
    });
    const reader = createFirestoreWaitlistGroupsReader(fake.firestore);
    const upcoming = await reader.listUpcomingSessions(
      "academy-1",
      now,
      "2026-11-10T08:00:00.000Z",
    );
    expect(upcoming).toMatchObject({ truncated: true });
    expect(upcoming.sessions).toHaveLength(500);
    const result = await reader.listLiveEntries("academy-1", ["s-000"]);
    expect(result.truncated).toBe(true);
    expect(result.entries).toHaveLength(500);
  });
});
