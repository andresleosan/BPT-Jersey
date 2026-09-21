import { describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { projectIntroAttendance } from "./intro-conversion-service";

type Doc = Record<string, unknown>;
type Filter = { field: string; value: unknown };
function fakeFirestore(initial: Record<string, Doc>) {
  const records = new Map(Object.entries(initial));
  const split = (path: string) => ({
    id: path.slice(path.lastIndexOf("/") + 1),
    parent: path.slice(0, path.lastIndexOf("/")),
  });
  const query = (path: string, filters: Filter[] = [], maximum = Infinity) => ({
    collectionPath: path,
    filters,
    maximum,
    where(field: string, _operator: string, value: unknown) {
      return query(path, [...filters, { field, value }], maximum);
    },
    orderBy() {
      return query(path, filters, maximum);
    },
    limit(count: number) {
      return query(path, filters, count);
    },
  });
  const db = {
    doc(path: string) {
      return { id: split(path).id, path };
    },
    collection(path: string) {
      return query(path);
    },
    async runTransaction<T>(callback: (transaction: never) => Promise<T>) {
      const writes: { path: string; value: Doc }[] = [];
      const transaction = {
        async get(target: {
          path?: string;
          collectionPath?: string;
          filters?: Filter[];
          maximum?: number;
        }) {
          if (target.collectionPath) {
            const docs = [...records.entries()]
              .filter(
                ([path, value]) =>
                  split(path).parent === target.collectionPath &&
                  (target.filters ?? []).every(
                    ({ field, value: expected }) => value[field] === expected,
                  ),
              )
              .slice(0, target.maximum)
              .map(([path, value]) => ({ id: split(path).id, exists: true, data: () => value }));
            return { docs, size: docs.length };
          }
          const value = records.get(target.path!);
          return { id: split(target.path!).id, exists: value !== undefined, data: () => value };
        },
        create(reference: { path: string }, value: Doc) {
          if (records.has(reference.path)) throw new Error("exists");
          writes.push({ path: reference.path, value });
        },
        set(reference: { path: string }, value: Doc) {
          writes.push({ path: reference.path, value });
        },
      };
      const result = await callback(transaction as never);
      writes.forEach(({ path, value }) => records.set(path, value));
      return result;
    },
  };
  return { db: db as unknown as Firestore, records };
}

const academyId = "academy-1";
const now = "2026-09-21T12:00:00.000Z";
const audit = {
  schemaVersion: "1",
  createdAt: now,
  createdBy: "seed",
  updatedAt: now,
  updatedBy: "seed",
};
function seeded(
  accessMode: "intro" | "membership" = "intro",
  state: "attended" | "no_show" = "attended",
) {
  return fakeFirestore({
    [`academies/${academyId}/attendance/attendance-1`]: {
      attendanceId: "attendance-1",
      academyId,
      sessionId: "session-1",
      studentId: "student-1",
      method: "manual",
      state,
      occurredAt: now,
      notes: null,
      correctionOf: null,
      ...audit,
    },
    [`academies/${academyId}/sessions/session-1`]: {
      sessionId: "session-1",
      academyId,
      accessMode,
      ...audit,
    },
    [`academies/${academyId}/students/student-1`]: {
      studentId: "student-1",
      academyId,
      userId: "user-1",
      fullName: "Synthetic Adult",
      dateOfBirth: "1990-01-01",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      participantType: "adult",
      active: true,
      status: "active",
      ...audit,
    },
    [`academies/${academyId}/users/user-1`]: {
      userId: "user-1",
      academyId,
      accountType: "client",
      displayName: "Synthetic Adult",
      email: "adult@example.test",
      phoneNumber: "+441534000000",
      active: true,
      status: "active",
      ...audit,
    },
    [`academies/${academyId}/bookings/booking-1`]: {
      bookingId: "booking-1",
      academyId,
      sessionId: "session-1",
      studentId: "student-1",
      membershipId: null,
      source: { kind: "intro" },
      status: "confirmed",
      requestedAt: now,
      cancelledAt: null,
      cancellationReason: null,
      ...audit,
      schemaVersion: "3",
    },
  });
}

describe("intro attendance projection", () => {
  it("creates one deterministic conversion and in-app notice", async () => {
    const store = seeded();
    await expect(
      projectIntroAttendance(store.db, { academyId, attendanceId: "attendance-1", now }),
    ).resolves.toBe("created");
    await expect(
      projectIntroAttendance(store.db, { academyId, attendanceId: "attendance-1", now }),
    ).resolves.toBe("existing");
    expect(
      [...store.records.keys()].filter((path) => path.includes("/introConversions/")),
    ).toHaveLength(1);
    const notices = [...store.records.entries()].filter(([path]) =>
      path.includes("/memberNotifications/"),
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]?.[1]).toMatchObject({
      recipientUid: "user-1",
      href: "/account/membership?from=intro",
      readAt: null,
    });
  });
  it.each([
    ["membership", "attended"],
    ["intro", "no_show"],
  ] as const)("ignores %s sessions with %s attendance", async (accessMode, state) => {
    const store = seeded(accessMode, state);
    await expect(
      projectIntroAttendance(store.db, { academyId, attendanceId: "attendance-1", now }),
    ).resolves.toBe("ignored");
    expect([...store.records.keys()].some((path) => path.includes("memberNotifications"))).toBe(
      false,
    );
  });
  it("fails closed when the recipient account is not active", async () => {
    const store = seeded();
    store.records.delete(`academies/${academyId}/users/user-1`);
    await expect(
      projectIntroAttendance(store.db, { academyId, attendanceId: "attendance-1", now }),
    ).resolves.toBe("unresolved");
    expect(
      store.records.get(`academies/${academyId}/introConversionIssues/intro-student-1`),
    ).toMatchObject({
      status: "unresolved",
      reason: "recipient_inactive",
      attendanceId: "attendance-1",
    });
  });
});
