import { describe, expect, it } from "vitest";

import type { BookingFirestore, BookingTransaction } from "./booking-transaction-service.js";
import { readRegistrationChoice } from "./registration-choice-service.js";

type Data = Record<string, unknown>;
type Filter = readonly [string, unknown];
type Target = Readonly<{ path: string; id?: string; filters?: readonly Filter[]; max?: number }>;

const now = "2026-10-20T12:00:00.000Z";
const session = {
  sessionId: "s1",
  academyId: "a1",
  startAt: "2026-10-27T18:00:00.000Z",
  locationId: "town",
};

/** Equality filters and limits only, like the reads under test; every query is recorded. */
function fakeStore(records: Record<string, Data>) {
  const queries: string[] = [];
  const query = (path: string, filters: readonly Filter[] = [], max = Infinity) => ({
    path,
    filters,
    max,
    where: (field: string, _operator: string, value: unknown) =>
      query(path, [...filters, [field, value] as const], max),
    limit: (count: number) => query(path, filters, count),
  });
  const firestore = {
    doc: (path: string) => ({ id: path.split("/").at(-1)!, path }),
    collection: (path: string) => query(path),
  } as unknown as BookingFirestore;
  const transaction = {
    get: async (target: Target) => {
      if (target.filters) {
        const pairs = target.filters.map(([field, value]) => `${field}=${String(value)}`);
        queries.push(`${target.path}?${pairs.join("&")}`);
        const docs = Object.entries(records)
          .filter(
            ([path, data]) =>
              path.startsWith(`${target.path}/`) &&
              !path.slice(target.path.length + 1).includes("/") &&
              target.filters!.every(([field, value]) => data[field] === value),
          )
          .slice(0, target.max)
          .map(([path, data]) => ({ id: path.split("/").at(-1)!, exists: true, data: () => data }));
        return { docs };
      }
      const data = records[target.path];
      return { id: target.id, exists: data !== undefined, data: () => data };
    },
  } as unknown as BookingTransaction;
  const read = (studentId: string) =>
    readRegistrationChoice({
      firestore,
      transaction,
      academyId: "a1",
      sessionId: "s1",
      studentId,
      now,
    });
  return { read, queries };
}

function membership(membershipId: string, studentId: string, overrides: Data = {}): Data {
  return {
    membershipId,
    academyId: "a1",
    familyId: "f1",
    studentId,
    planId: "bpt-jersey-adult",
    status: "active",
    startsAt: "2026-10-01T00:00:00.000Z",
    endsAt: null,
    nextBillingAt: null,
    schemaVersion: "1",
    createdAt: "2026-10-01T00:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-10-01T00:00:00.000Z",
    updatedBy: "owner-1",
    ...overrides,
  };
}

function trial(overrides: Data = {}): Data {
  return {
    trialId: "st1",
    academyId: "a1",
    studentId: "st1",
    site: "Town",
    experience: "beginner",
    allowance: 2,
    countedAttendanceIds: [],
    status: "active",
    startsAt: "2026-10-10T00:00:00.000Z",
    expiresAt: "2026-11-09T00:00:00.000Z",
    enrolmentRequestId: "enrolment-1",
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
    schemaVersion: "1",
    ...overrides,
  };
}

const sessionRecord = { "academies/a1/sessions/s1": session };

describe("office registration choice", () => {
  it("finds a member's plan however many memberships the academy holds", async () => {
    const others = Object.fromEntries(
      Array.from({ length: 120 }, (_, index) => {
        const id = `m-${String(index).padStart(3, "0")}`;
        return [`academies/a1/memberships/${id}`, membership(id, `other-${index}`)];
      }),
    );
    const { read, queries } = fakeStore({
      ...sessionRecord,
      ...others,
      "academies/a1/memberships/zz-target": membership("zz-target", "st1"),
    });

    await expect(read("st1")).resolves.toEqual({
      studentId: "st1",
      choice: { kind: "membership", membershipId: "zz-target" },
      reason: null,
    });
    // Per student, never the academy-wide list the old panel stopped reading at 100.
    expect(queries).toContain("academies/a1/memberships?studentId=st1");
    expect(queries.some((query) => query.includes("academyId="))).toBe(false);
  });

  it("books a student who only has an active Free Trial as an intro", async () => {
    const { read } = fakeStore({ ...sessionRecord, "academies/a1/trialAccess/st1": trial() });

    await expect(read("st1")).resolves.toEqual({
      studentId: "st1",
      choice: { kind: "intro" },
      reason: null,
    });
  });

  it.each([
    { state: "used up", change: { countedAttendanceIds: ["a-1", "a-2"] } },
    { state: "expired", change: { expiresAt: "2026-10-19T00:00:00.000Z" } },
    { state: "for the other centre", change: { site: "West" } },
  ])("offers nothing for a trial that is $state", async ({ change }) => {
    const { read } = fakeStore({ ...sessionRecord, "academies/a1/trialAccess/st1": trial(change) });

    await expect(read("st1")).resolves.toEqual({
      studentId: "st1",
      choice: null,
      reason: "trial-unavailable",
    });
  });

  it("offers no intro to anyone with membership history, as the intro booking refuses it", async () => {
    const { read } = fakeStore({
      ...sessionRecord,
      "academies/a1/trialAccess/st1": trial(),
      "academies/a1/memberships/m-old": membership("m-old", "st1", { status: "cancelled" }),
    });

    await expect(read("st1")).resolves.toEqual({
      studentId: "st1",
      choice: null,
      reason: "no-plan",
    });
  });

  it("names the paid period for an expired plan and follows the booking's first-day rule", async () => {
    const expired = fakeStore({
      ...sessionRecord,
      "academies/a1/memberships/m-1": membership("m-1", "st1", {
        endsAt: "2026-10-27T18:00:00.000Z",
      }),
    });
    await expect(expired.read("st1")).resolves.toEqual({
      studentId: "st1",
      choice: null,
      reason: "plan-dates",
    });

    // E8: a plan starting later on the class's own Jersey day still covers it.
    const sameDay = fakeStore({
      ...sessionRecord,
      "academies/a1/memberships/m-2": membership("m-2", "st1", {
        startsAt: "2026-10-27T20:00:00.000Z",
      }),
    });
    await expect(sameDay.read("st1")).resolves.toMatchObject({
      choice: { kind: "membership", membershipId: "m-2" },
    });
  });

  it("finds a membership held under an earlier id of the same member", async () => {
    const { read } = fakeStore({
      ...sessionRecord,
      "academies/a1/memberIdentityAliases/old-1": {
        academyId: "a1",
        studentId: "old-1",
        canonicalStudentId: "st1",
        requestId: "6f1d2f66-6f4f-4a2e-9a0e-2b6f0a4a1c11",
        evidence: "Same person, two records",
        reason: "Merged after review",
        previewRevision: "a".repeat(64),
        approvedBy: "owner-1",
        approvedAt: "2026-10-01T00:00:00.000Z",
        schemaVersion: "1",
      },
      "academies/a1/memberships/m-old-id": membership("m-old-id", "old-1"),
    });

    for (const asked of ["st1", "old-1"]) {
      await expect(read(asked)).resolves.toEqual({
        studentId: "st1",
        choice: { kind: "membership", membershipId: "m-old-id" },
        reason: null,
      });
    }
  });

  it("refuses a class it cannot read without answering not-found", async () => {
    const { read } = fakeStore({
      "academies/a1/sessions/s1": { ...session, academyId: "a2" },
      "academies/a1/memberships/m-1": membership("m-1", "st1"),
    });

    await expect(read("st1")).rejects.toMatchObject({ code: "failed-precondition" });
  });
});
