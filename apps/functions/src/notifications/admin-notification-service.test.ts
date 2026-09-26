import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { AdminInboxQuery, AdminNotification } from "@bpt-jersey/domain/memberships/admin";
import { getAdminInbox } from "./admin-notification-service.js";

type Filter = { field: string; op: string; value: unknown };
type Doc = AdminNotification;

function fakeDb(docs: Doc[]) {
  const stats = { pageReads: 0, docsRead: 0 };
  const sorted = [...docs].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.notificationId.localeCompare(a.notificationId),
  );
  function matches(doc: Doc, filter: Filter): boolean {
    const value = (doc as Record<string, unknown>)[filter.field];
    if (filter.op === "==") return value === filter.value;
    if (filter.op === ">=") return String(value) >= String(filter.value);
    if (filter.op === "<=") return String(value) <= String(filter.value);
    throw new Error(`Unsupported operator ${filter.op}`);
  }
  function query(filters: Filter[], after: [string, string] | null, limit: number | null) {
    const rows = () =>
      sorted
        .filter((doc) => filters.every((filter) => matches(doc, filter)))
        .filter(
          (doc) =>
            !after ||
            doc.createdAt < after[0] ||
            (doc.createdAt === after[0] && doc.notificationId < after[1]),
        );
    return {
      where: (field: string, op: string, value: unknown) =>
        query([...filters, { field, op, value }], after, limit),
      orderBy: () => query(filters, after, limit),
      startAfter: (createdAt: string, id: string) => query(filters, [createdAt, id], limit),
      limit: (value: number) => query(filters, after, value),
      count: () => ({ get: async () => ({ data: () => ({ count: rows().length }) }) }),
      get: async () => {
        const result = rows().slice(0, limit ?? undefined);
        stats.pageReads += 1;
        stats.docsRead += result.length;
        return {
          size: result.length,
          docs: result.map((doc) => ({ id: doc.notificationId, data: () => doc })),
        };
      },
    };
  }
  return { db: { collection: () => query([], null, null) } as unknown as Firestore, stats };
}

let seq = 0;
function notice(overrides: Partial<Doc> & Pick<Doc, "createdAt">): Doc {
  seq += 1;
  return {
    notificationId: `n-${String(seq).padStart(4, "0")}`,
    kind: "membership",
    title: "Notice",
    message: "",
    href: "/admin/members",
    readAt: null,
    resolvedAt: null,
    membershipId: null,
    studentId: null,
    endsAt: null,
    ...overrides,
  };
}
function minute(index: number): string {
  return new Date(Date.UTC(2026, 8, 1) + index * 60_000).toISOString();
}
const query = (overrides: Partial<AdminInboxQuery>): AdminInboxQuery => ({
  kind: null,
  readState: "all",
  from: null,
  to: null,
  cursor: null,
  ...overrides,
});
const readAt = "2026-09-20T10:00:00.000Z";

describe("getAdminInbox", () => {
  it("filters by kind, newest first", async () => {
    const { db } = fakeDb([
      notice({ kind: "payment", createdAt: minute(1) }),
      notice({ kind: "class", createdAt: minute(2) }),
      notice({ kind: "payment", createdAt: minute(3) }),
    ]);
    const page = await getAdminInbox(db, "academy-1", query({ kind: "payment" }));
    expect(page.notifications.map((item) => item.createdAt)).toEqual([minute(3), minute(1)]);
    expect(page.notifications.every((item) => item.kind === "payment")).toBe(true);
    expect(page.nextCursor).toBeNull();
  });

  it("returns only unread notifications inside the date range", async () => {
    const { db } = fakeDb([
      notice({ createdAt: minute(1) }),
      notice({ createdAt: minute(5) }),
      notice({ createdAt: minute(6), readAt }),
      notice({ createdAt: minute(10) }),
    ]);
    const page = await getAdminInbox(
      db,
      "academy-1",
      query({ readState: "unread", from: minute(2), to: minute(8) }),
    );
    expect(page.notifications.map((item) => item.createdAt)).toEqual([minute(5)]);
  });

  it("treats a range without milliseconds like the stored timestamps", async () => {
    const { db } = fakeDb([notice({ createdAt: "2026-09-01T00:00:00.000Z" })]);
    const page = await getAdminInbox(
      db,
      "academy-1",
      query({ from: "2026-09-01T00:00:00Z", to: "2026-09-01T00:00:00Z" }),
    );
    expect(page.notifications).toHaveLength(1);
  });

  it("pages read notifications mixed with unread ones", async () => {
    const docs: Doc[] = [];
    for (let index = 0; index < 70; index += 1)
      docs.push(notice({ createdAt: minute(index), readAt: index % 2 === 0 ? readAt : null }));
    const { db } = fakeDb(docs);
    const readDocs = docs.filter((doc) => doc.readAt !== null);
    expect(readDocs).toHaveLength(35);
    const first = await getAdminInbox(db, "academy-1", query({ readState: "read" }));
    expect(first.notifications).toHaveLength(30);
    expect(first.notifications.every((item) => item.readAt !== null)).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    const second = await getAdminInbox(
      db,
      "academy-1",
      query({ readState: "read", cursor: first.nextCursor }),
    );
    expect(second.notifications).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const seen = [...first.notifications, ...second.notifications].map((n) => n.notificationId);
    expect(new Set(seen).size).toBe(35);
  });

  it("bounds the read scan and hands back a cursor instead of looping", async () => {
    const docs: Doc[] = [];
    for (let index = 0; index < 5; index += 1)
      docs.push(notice({ createdAt: minute(index), readAt }));
    for (let index = 5; index < 405; index += 1) docs.push(notice({ createdAt: minute(index) }));
    const { db, stats } = fakeDb(docs);
    const page = await getAdminInbox(db, "academy-1", query({ readState: "read" }));
    expect(page.notifications).toEqual([]);
    expect(page.nextCursor).not.toBeNull();
    expect(stats.pageReads).toBe(10);
    expect(stats.docsRead).toBeLessThanOrEqual(310);
    expect(page.unreadCount).toBe(400);

    const rest = await getAdminInbox(
      db,
      "academy-1",
      query({ readState: "read", cursor: page.nextCursor }),
    );
    expect(rest.notifications).toHaveLength(5);
    expect(rest.nextCursor).toBeNull();
  });

  it("counts every unread notification whatever the filters", async () => {
    const { db } = fakeDb([
      notice({ kind: "payment", createdAt: minute(1) }),
      notice({ kind: "class", createdAt: minute(2) }),
      notice({ kind: "class", createdAt: minute(3), readAt }),
    ]);
    const page = await getAdminInbox(
      db,
      "academy-1",
      query({ kind: "payment", readState: "read", from: minute(3), to: minute(3) }),
    );
    expect(page.notifications).toEqual([]);
    expect(page.unreadCount).toBe(2);
  });
});
