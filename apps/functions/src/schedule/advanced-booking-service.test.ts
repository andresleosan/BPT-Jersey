import { describe, expect, it } from "vitest";

import {
  createFirestoreWaitlistStore,
  parseStoredWaitlist,
  WaitlistStoreError,
} from "./advanced-booking-service";

const record = (overrides: Record<string, unknown> = {}) => ({
  waitlistId: "session-1__student-1",
  academyId: "academy-1",
  sessionId: "session-1",
  studentId: "student-1",
  membershipId: "membership-1",
  position: 1,
  status: "waiting",
  requestedAt: "2026-08-28T12:00:00Z",
  offeredAt: null,
  offerExpiresAt: null,
  acceptedAt: null,
  cancelledAt: null,
  schemaVersion: "1",
  createdAt: "2026-08-28T12:00:00Z",
  createdBy: "actor-1",
  updatedAt: "2026-08-28T12:00:00Z",
  updatedBy: "actor-1",
  ...overrides,
});

describe("advanced booking waitlist store boundary", () => {
  it("accepts an exact deterministic tenant-scoped record", () => {
    const parsed = parseStoredWaitlist(record(), "academy-1", "session-1__student-1");
    expect(parsed.status).toBe("waiting");
    expect(parsed.position).toBe(1);
  });

  it("rejects cross-tenant and altered document identities", () => {
    expect(() => parseStoredWaitlist(record(), "academy-2")).toThrowError(
      expect.objectContaining<Partial<WaitlistStoreError>>({ code: "tenant" }),
    );
    expect(() => parseStoredWaitlist(record(), "academy-1", "other-id")).toThrowError(
      expect.objectContaining<Partial<WaitlistStoreError>>({ code: "conflict" }),
    );
  });

  it("rejects unknown fields and impossible calendar dates", () => {
    expect(() =>
      parseStoredWaitlist({ ...record(), email: "hidden@example.test" }, "academy-1"),
    ).toThrowError(expect.objectContaining<Partial<WaitlistStoreError>>({ code: "invalid" }));
    expect(() =>
      parseStoredWaitlist(
        record({
          requestedAt: "2026-02-30T12:00:00Z",
          createdAt: "2026-02-30T12:00:00Z",
          updatedAt: "2026-02-30T12:00:00Z",
        }),
        "academy-1",
      ),
    ).toThrowError(expect.objectContaining<Partial<WaitlistStoreError>>({ code: "invalid" }));
  });
});

describe("joinWaitlist on a private lesson", () => {
  it("refuses: private lessons are arranged by the office", async () => {
    const writes: string[] = [];
    const documents = new Map<string, Record<string, unknown>>([
      [
        "academies/academy-1/sessions/session-1",
        {
          sessionId: "session-1",
          academyId: "academy-1",
          accessMode: "private-lesson",
          capacity: 1,
          status: "scheduled",
          startAt: "2099-01-05T18:00:00.000Z",
        },
      ],
      ["academies/academy-1/memberships/membership-1", { membershipId: "membership-1" }],
    ]);
    const doc = (path: string) => ({ id: path.split("/").at(-1) ?? "", path });
    const emptyQuery = { where: () => emptyQuery, limit: () => emptyQuery, kind: "query" };
    const firestore = {
      doc,
      collection: () => emptyQuery,
      runTransaction: async <T>(callback: (transaction: unknown) => Promise<T>) =>
        callback({
          get: async (target: { path?: string; kind?: string }) =>
            target.kind === "query"
              ? { docs: [], size: 0, empty: true }
              : {
                  id: target.path!.split("/").at(-1),
                  exists: documents.has(target.path!),
                  data: () => documents.get(target.path!),
                },
          set: (reference: { path: string }) => writes.push(reference.path),
          create: (reference: { path: string }) => writes.push(reference.path),
          update: (reference: { path: string }) => writes.push(reference.path),
        }),
    };
    const store = createFirestoreWaitlistStore({ firestore: firestore as never });
    await expect(
      store.joinWaitlist({
        academyId: "academy-1",
        actorId: "office-1",
        request: { sessionId: "session-1", studentId: "student-1", membershipId: "membership-1" },
        now: "2099-01-01T00:00:00.000Z",
      } as never),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      message: "Private lessons are arranged by the office.",
    });
    expect(writes).toEqual([]);
  });
});
