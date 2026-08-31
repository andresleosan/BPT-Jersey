import { describe, expect, it, vi } from "vitest";

import type { RetentionStudentSnapshot } from "@bpt-jersey/domain/retention";
import { createInMemoryRetentionAlertStore } from "./retention-alert-service";
import {
  createFirestoreRetentionSnapshotSource,
  createRetentionAlertProducer,
} from "./retention-alert-producer";

const policy = {
  inactivityDays: 14,
  lookbackDays: 30,
  noShowThreshold: 2,
  membershipExpiryDays: 14,
} as const;

function student(
  studentId: string,
  overrides: Partial<RetentionStudentSnapshot> = {},
): RetentionStudentSnapshot {
  return {
    academyId: "academy-a",
    studentId,
    active: true,
    hasActiveMembership: true,
    membershipStartsAt: "2026-01-01T00:00:00Z",
    membershipEndsAt: null,
    attendance: [],
    ...overrides,
  };
}

describe("retention alert producer", () => {
  it("produces a stable hash and converges reordered daily replay", async () => {
    const studentA = student("student-a", {
      attendance: [
        { state: "no_show", occurredAt: "2026-08-21T10:00:00Z" },
        { state: "attended", occurredAt: "2026-08-01T10:00:00Z" },
        { state: "no_show", occurredAt: "2026-08-20T10:00:00Z" },
      ],
    });
    const studentB = student("student-b", {
      membershipEndsAt: "2026-09-05T00:00:00Z",
      attendance: [{ state: "attended", occurredAt: "2026-08-29T10:00:00Z" }],
    });
    const loadSnapshots = vi
      .fn()
      .mockResolvedValueOnce([studentB, studentA])
      .mockResolvedValueOnce([
        { ...studentA, attendance: [...studentA.attendance].reverse() },
        studentB,
      ]);
    const store = createInMemoryRetentionAlertStore();
    const producer = createRetentionAlertProducer({
      source: { loadSnapshots },
      store,
    });

    const first = await producer.produce({
      academyId: "academy-a",
      runDate: "2026-08-31",
      policy,
    });
    const replay = await producer.produce({
      academyId: "academy-a",
      runDate: "2026-08-31",
      policy,
    });

    expect(first).toMatchObject({
      runDate: "2026-08-31",
      effectiveAt: "2026-08-31T00:00:00.000Z",
      evaluatedStudents: 2,
      alertCount: 3,
      created: 3,
      unchanged: 0,
      replayed: false,
    });
    expect(first.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(replay).toEqual({
      ...first,
      created: 0,
      unchanged: 3,
      replayed: true,
    });
    await expect(store.listAlerts("academy-a")).resolves.toHaveLength(3);
  });

  it("rejects invalid inputs before reading a source", async () => {
    const loadSnapshots = vi.fn();
    const producer = createRetentionAlertProducer({
      source: { loadSnapshots },
      store: createInMemoryRetentionAlertStore(),
    });

    for (const input of [
      { academyId: "../academy", runDate: "2026-08-31", policy },
      { academyId: "academy-a", runDate: "2026-02-30", policy },
      {
        academyId: "academy-a",
        runDate: "2026-08-31",
        policy: { ...policy, inactivityDays: 31 },
      },
    ]) {
      await expect(producer.produce(input)).rejects.toMatchObject({ code: "invalid" });
    }
    expect(loadSnapshots).not.toHaveBeenCalled();
  });

  it("fails closed on cross-tenant, non-minimal, and over-limit snapshots", async () => {
    for (const snapshots of [
      [student("student-a", { academyId: "academy-b" })],
      [{ ...student("student-a"), email: "private@example.test" }],
      Array.from({ length: 201 }, (_, index) => student("student-" + index)),
    ]) {
      const store = createInMemoryRetentionAlertStore();
      const producer = createRetentionAlertProducer({
        source: { loadSnapshots: vi.fn().mockResolvedValue(snapshots) },
        store,
      });
      await expect(
        producer.produce({
          academyId: "academy-a",
          runDate: "2026-08-31",
          policy,
        }),
      ).rejects.toMatchObject({
        code:
          snapshots.length > 200
            ? "limit"
            : snapshots[0]?.academyId === "academy-b"
              ? "tenant"
              : "invalid",
      });
      await expect(store.listAlerts("academy-a")).resolves.toEqual([]);
    }
  });

  it("enforces the global attendance limit for an injected source", async () => {
    const snapshots = [
      student("student-a", {
        attendance: Array.from({ length: 5001 }, () => ({
          state: "attended" as const,
          occurredAt: "2026-08-20T10:00:00Z",
        })),
      }),
    ];
    const store = createInMemoryRetentionAlertStore();
    const producer = createRetentionAlertProducer({
      source: { loadSnapshots: vi.fn().mockResolvedValue(snapshots) },
      store,
    });

    await expect(
      producer.produce({ academyId: "academy-a", runDate: "2026-08-31", policy }),
    ).rejects.toMatchObject({ code: "limit" });
    await expect(store.listAlerts("academy-a")).resolves.toEqual([]);
  });

  it("rejects more than 200 derived alerts without a partial commit", async () => {
    const snapshots = Array.from({ length: 67 }, (_, index) =>
      student("student-" + index, {
        membershipEndsAt: "2026-09-05T00:00:00Z",
        attendance: [
          { state: "attended", occurredAt: "2026-08-01T10:00:00Z" },
          { state: "no_show", occurredAt: "2026-08-20T10:00:00Z" },
          { state: "no_show", occurredAt: "2026-08-21T10:00:00Z" },
        ],
      }),
    );
    const store = createInMemoryRetentionAlertStore();
    const producer = createRetentionAlertProducer({
      source: { loadSnapshots: vi.fn().mockResolvedValue(snapshots) },
      store,
    });

    await expect(
      producer.produce({ academyId: "academy-a", runDate: "2026-08-31", policy }),
    ).rejects.toMatchObject({ code: "limit" });
    await expect(store.listAlerts("academy-a")).resolves.toEqual([]);
  });

  it("audits a zero-alert run and replays it unchanged", async () => {
    const snapshots = [
      student("recent-member", {
        membershipStartsAt: "2026-08-25T00:00:00Z",
      }),
    ];
    const store = createInMemoryRetentionAlertStore();
    const producer = createRetentionAlertProducer({
      source: { loadSnapshots: vi.fn().mockResolvedValue(snapshots) },
      store,
    });

    const first = await producer.produce({
      academyId: "academy-a",
      runDate: "2026-08-31",
      policy,
    });
    const replay = await producer.produce({
      academyId: "academy-a",
      runDate: "2026-08-31",
      policy,
    });

    expect(first).toMatchObject({ alertCount: 0, created: 0, replayed: false });
    expect(replay).toMatchObject({ alertCount: 0, unchanged: 0, replayed: true });
  });
});

type FakeDocument = Readonly<{
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}>;

function document(id: string, data: Record<string, unknown>): FakeDocument {
  return { id, exists: true, data: () => data };
}

function query(docs: readonly FakeDocument[]) {
  const value = {
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    select: vi.fn(),
    get: vi.fn().mockResolvedValue({ docs }),
  };
  value.where.mockReturnValue(value);
  value.orderBy.mockReturnValue(value);
  value.limit.mockReturnValue(value);
  value.select.mockReturnValue(value);
  return value;
}

function firestoreSourceFixture({
  memberships,
  students,
  attendance,
}: {
  memberships: readonly FakeDocument[];
  students: readonly FakeDocument[];
  attendance: readonly FakeDocument[];
}) {
  const membershipQuery = query(memberships);
  const attendanceQuery = query(attendance);
  const firestore = {
    collection: vi.fn((path: string) =>
      path.endsWith("/memberships") ? membershipQuery : attendanceQuery,
    ),
    doc: vi.fn((path: string) => ({
      id: path.slice(path.lastIndexOf("/") + 1),
      path,
    })),
    getAll: vi.fn().mockResolvedValue(students),
  };
  return {
    source: createFirestoreRetentionSnapshotSource({ firestore: firestore as never }),
    firestore,
    membershipQuery,
    attendanceQuery,
  };
}

const membership = document("membership-1", {
  membershipId: "membership-1",
  academyId: "academy-a",
  studentId: "student-a",
  status: "active",
  startsAt: "2026-01-01T00:00:00Z",
  endsAt: "2026-09-05T00:00:00Z",
});
const activeStudent = document("student-a", {
  studentId: "student-a",
  academyId: "academy-a",
  active: true,
  status: "active",
});

describe("Firestore retention snapshot source", () => {
  it("reads bounded minimal projections and keeps only canonical relevant attendance", async () => {
    const longSessionId = "s".repeat(120);
    const canonical = document("session-1__student-a", {
      attendanceId: "session-1__student-a",
      academyId: "academy-a",
      sessionId: "session-1",
      studentId: "student-a",
      state: "no_show",
      occurredAt: "2026-08-20T10:00:00Z",
      correctionOf: null,
      schemaVersion: "1",
    });
    const correction = document("correction-1", {
      attendanceId: "correction-1",
      academyId: "academy-a",
      sessionId: longSessionId,
      studentId: "student-a",
      state: "no_show",
      occurredAt: "2026-08-21T10:00:00Z",
      correctionOf: longSessionId + "__student-a",
      schemaVersion: "1",
    });
    const excused = document("session-2__student-a", {
      attendanceId: "session-2__student-a",
      academyId: "academy-a",
      sessionId: "session-2",
      studentId: "student-a",
      state: "excused",
      occurredAt: "2026-08-22T10:00:00Z",
      correctionOf: null,
      schemaVersion: "1",
    });
    const future = document("session-3__student-a", {
      attendanceId: "session-3__student-a",
      academyId: "academy-a",
      sessionId: "session-3",
      studentId: "student-a",
      state: "attended",
      occurredAt: "2026-09-01T10:00:00Z",
      correctionOf: null,
      schemaVersion: "1",
    });
    const fixture = firestoreSourceFixture({
      memberships: [membership],
      students: [activeStudent],
      attendance: [future, excused, correction, canonical],
    });

    await expect(
      fixture.source.loadSnapshots({
        academyId: "academy-a",
        effectiveAt: "2026-08-31T00:00:00.000Z",
        lookbackDays: 30,
      }),
    ).resolves.toEqual([
      {
        academyId: "academy-a",
        studentId: "student-a",
        active: true,
        hasActiveMembership: true,
        membershipStartsAt: "2026-01-01T00:00:00Z",
        membershipEndsAt: "2026-09-05T00:00:00Z",
        attendance: [{ state: "no_show", occurredAt: "2026-08-20T10:00:00Z" }],
      },
    ]);
    expect(fixture.membershipQuery.where).toHaveBeenCalledWith("status", "in", ["trial", "active"]);
    expect(fixture.membershipQuery.limit).toHaveBeenCalledWith(201);
    expect(fixture.membershipQuery.select).toHaveBeenCalledWith(
      "membershipId",
      "academyId",
      "studentId",
      "status",
      "startsAt",
      "endsAt",
    );
    expect(fixture.firestore.getAll).toHaveBeenCalledWith(
      {
        id: "student-a",
        path: "academies/academy-a/students/student-a",
      },
      {
        fieldMask: ["studentId", "academyId", "active", "status"],
      },
    );
    expect(fixture.attendanceQuery.orderBy).toHaveBeenCalledWith("occurredAt", "desc");
    expect(fixture.attendanceQuery.limit).toHaveBeenCalledWith(5001);
    expect(fixture.attendanceQuery.select).toHaveBeenCalledWith(
      "attendanceId",
      "academyId",
      "sessionId",
      "studentId",
      "state",
      "occurredAt",
      "correctionOf",
      "schemaVersion",
    );
  });

  it("includes a current trial membership in the evaluated snapshots", async () => {
    const trialFixture = firestoreSourceFixture({
      memberships: [
        document("membership-1", {
          ...membership.data(),
          status: "trial",
        }),
      ],
      students: [activeStudent],
      attendance: [],
    });
    await expect(
      trialFixture.source.loadSnapshots({
        academyId: "academy-a",
        effectiveAt: "2026-08-31T00:00:00.000Z",
        lookbackDays: 30,
      }),
    ).resolves.toEqual([
      {
        academyId: "academy-a",
        studentId: "student-a",
        active: true,
        hasActiveMembership: true,
        membershipStartsAt: "2026-01-01T00:00:00Z",
        membershipEndsAt: "2026-09-05T00:00:00Z",
        attendance: [],
      },
    ]);
  });

  it("rejects malformed canonical attendance", async () => {
    const malformedAttendanceFixture = firestoreSourceFixture({
      memberships: [membership],
      students: [activeStudent],
      attendance: [
        document("opaque-attendance", {
          attendanceId: "opaque-attendance",
          academyId: "academy-a",
          sessionId: "session-1",
          studentId: "student-a",
          state: "no_show",
          occurredAt: "2026-08-20T10:00:00Z",
          correctionOf: null,
          schemaVersion: "1",
        }),
      ],
    });
    await expect(
      malformedAttendanceFixture.source.loadSnapshots({
        academyId: "academy-a",
        effectiveAt: "2026-08-31T00:00:00.000Z",
        lookbackDays: 30,
      }),
    ).rejects.toMatchObject({ code: "source" });
  });

  it("fails closed on query overflow and source scope contradictions", async () => {
    const overflowMemberships = Array.from({ length: 201 }, (_, index) =>
      document("membership-" + index, {
        ...membership.data(),
        membershipId: "membership-" + index,
        studentId: "student-" + index,
      }),
    );
    const membershipOverflow = firestoreSourceFixture({
      memberships: overflowMemberships,
      students: [],
      attendance: [],
    });
    await expect(
      membershipOverflow.source.loadSnapshots({
        academyId: "academy-a",
        effectiveAt: "2026-08-31T00:00:00.000Z",
        lookbackDays: 30,
      }),
    ).rejects.toMatchObject({ code: "limit" });

    const crossTenant = firestoreSourceFixture({
      memberships: [
        document("membership-1", {
          ...membership.data(),
          academyId: "academy-b",
        }),
      ],
      students: [activeStudent],
      attendance: [],
    });
    await expect(
      crossTenant.source.loadSnapshots({
        academyId: "academy-a",
        effectiveAt: "2026-08-31T00:00:00.000Z",
        lookbackDays: 30,
      }),
    ).rejects.toMatchObject({ code: "tenant" });

    const attendanceOverflow = firestoreSourceFixture({
      memberships: [membership],
      students: [activeStudent],
      attendance: Array.from({ length: 5001 }, (_, index) =>
        document("attendance-" + index, {
          attendanceId: "attendance-" + index,
          academyId: "academy-a",
          studentId: "student-a",
          state: "attended",
          occurredAt: "2026-08-20T10:00:00Z",
          correctionOf: null,
        }),
      ),
    });
    await expect(
      attendanceOverflow.source.loadSnapshots({
        academyId: "academy-a",
        effectiveAt: "2026-08-31T00:00:00.000Z",
        lookbackDays: 30,
      }),
    ).rejects.toMatchObject({ code: "limit" });
  });
});
