import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { computeLevelProgress } from "@bpt-jersey/domain/levels";
import { createLevelCatalogStore } from "./level-service";
import { normalizeLevelCatalogSource } from "./level-source";

const academyId = "academy-1";
const decidedAt = "2026-09-10T12:00:00.000Z";
const created = "2026-06-01T00:00:00.000Z";
const baseline = { classes: 9, cutoff: "2026-09-01", source: "regyfit-import" } as const;
const normalized = normalizeLevelCatalogSource(observedJson, businessCriteriaJson);

type Stored = Map<string, Record<string, unknown>>;
type Ref = { kind: "doc" | "collection"; path: string };

/** In-memory Firestore with transactional reads before buffered writes. */
function fakeFirestore(records: Stored) {
  const writes: { op: "create" | "set"; path: string; data: Record<string, unknown> }[] = [];
  const snapshotOf = (path: string) => ({
    id: path.split("/").at(-1) ?? "",
    exists: records.has(path),
    data: () => records.get(path),
  });
  const docRef = (path: string) => ({
    kind: "doc" as const,
    id: path.split("/").at(-1) ?? "",
    path,
    get: async () => snapshotOf(path),
    set: async (data: Record<string, unknown>) => void records.set(path, data),
    delete: async () => void records.delete(path),
  });
  const children = (path: string) =>
    [...records.entries()]
      .filter(
        ([candidate]) =>
          candidate.startsWith(`${path}/`) && !candidate.slice(path.length + 1).includes("/"),
      )
      .map(([candidate, data]) => ({
        id: candidate.split("/").at(-1) ?? "",
        data: () => data,
        ref: docRef(candidate),
      }));
  const firestore = {
    doc: docRef,
    collection: (path: string) => ({
      kind: "collection" as const,
      path,
      get: async () => ({ docs: children(path) }),
    }),
    batch: () => {
      throw new Error("level writes must use a transaction");
    },
    runTransaction: async <T>(update: (transaction: unknown) => Promise<T>): Promise<T> => {
      const pending: (() => void)[] = [];
      const result = await update({
        get: async (ref: Ref) =>
          ref.kind === "collection" ? { docs: children(ref.path) } : snapshotOf(ref.path),
        create: (ref: Ref, data: Record<string, unknown>) => {
          if (records.has(ref.path)) throw new Error(`create collision ${ref.path}`);
          pending.push(() => {
            records.set(ref.path, data);
            writes.push({ op: "create", path: ref.path, data });
          });
        },
        set: (ref: Ref, data: Record<string, unknown>) => {
          pending.push(() => {
            records.set(ref.path, data);
            writes.push({ op: "set", path: ref.path, data });
          });
        },
        delete: (ref: Ref) => pending.push(() => void records.delete(ref.path)),
      });
      for (const apply of pending) apply();
      return result;
    },
  };
  return { firestore, writes, records };
}

function head(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    academyId,
    studentId: "student-1",
    systemId: "ibjjf-v1",
    currentDefinitionKey: "white-belt",
    currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
    lastApprovedPromotionId: null,
    openedByStaffId: "staff-head-1",
    openingNotes: "Synthetic opening note.",
    openedDefinitionKey: "white-belt",
    openedOn: "2026-07-01",
    openedByRole: "headCoach",
    state: "initialized",
    schemaVersion: "1",
    createdAt: created,
    createdBy: "head-user-1",
    updatedAt: created,
    updatedBy: "head-user-1",
    ...overrides,
  };
}

function attendance(id: string, occurredAt: string): [string, Record<string, unknown>] {
  return [
    `academies/${academyId}/attendance/${id}`,
    {
      attendanceId: id,
      academyId,
      studentId: "student-1",
      sessionId: "session-1",
      state: "attended",
      correctionOf: null,
      occurredAt,
    },
  ];
}

async function seededStore(extra: [string, Record<string, unknown>][] = []) {
  const records: Stored = new Map<string, Record<string, unknown>>([
    [
      `academies/${academyId}/users/head-user-1`,
      { userId: "head-user-1", academyId, accountType: "staff", active: true, status: "active" },
    ],
    [
      `academies/${academyId}/staff/staff-head-1`,
      {
        staffId: "staff-head-1",
        academyId,
        userId: "head-user-1",
        role: "headCoach",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: created,
        createdBy: "owner-user-1",
        updatedAt: created,
        updatedBy: "owner-user-1",
      },
    ],
    [
      `academies/${academyId}/users/coach-user-1`,
      { userId: "coach-user-1", academyId, accountType: "staff", active: true, status: "active" },
    ],
    [
      `academies/${academyId}/staff/staff-coach-1`,
      {
        staffId: "staff-coach-1",
        academyId,
        userId: "coach-user-1",
        role: "coach",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: created,
        createdBy: "owner-user-1",
        updatedAt: created,
        updatedBy: "owner-user-1",
      },
    ],
    [
      `academies/${academyId}/users/owner-user-1`,
      {
        userId: "owner-user-1",
        academyId,
        accountType: "staff",
        displayName: "Synthetic Owner",
        email: "owner@example.test",
        authProvider: "google",
        active: true,
        adminRole: "owner",
        lastRoleChangeAuditId: "audit-owner-1",
        createdAt: Timestamp.fromMillis(0),
        createdBy: "system",
        updatedAt: Timestamp.fromMillis(0),
        updatedBy: "system",
        status: "active",
        schemaVersion: 1,
      },
    ],
    [
      `academies/${academyId}/students/student-1`,
      {
        studentId: "student-1",
        academyId,
        fullName: "Synthetic Adult",
        dateOfBirth: "1990-01-01",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
        participantType: "adult",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: created,
        createdBy: "owner-user-1",
        updatedAt: created,
        updatedBy: "owner-user-1",
      },
    ],
    [
      `academies/${academyId}/sessions/session-1`,
      {
        sessionId: "session-1",
        academyId,
        startAt: "2026-09-01T18:00:00.000Z",
        endAt: "2026-09-01T19:00:00.000Z",
      },
    ],
    ...extra,
  ]);
  const fake = fakeFirestore(records);
  const store = createLevelCatalogStore({ firestore: fake.firestore as never });
  await store.seed({ academyId, normalized });
  fake.writes.length = 0;
  return { store, ...fake };
}

const baselineAttendance = [
  attendance("att-1", "2026-08-20T18:00:00.000Z"),
  attendance("att-2", "2026-09-01T18:00:00.000Z"),
  attendance("att-3", "2026-09-05T18:00:00.000Z"),
];

describe("progress summary at the current level (T051V2)", () => {
  it("adds the imported baseline to BPT attendance from the cutoff and reports progressPercent", async () => {
    const { store } = await seededStore([
      [
        `academies/${academyId}/studentLevelProgress/student-1`,
        head({ importedBaseline: baseline }),
      ],
      ...baselineAttendance,
    ]);
    const progress = await store.getStudentProgressSummary(academyId, "student-1");
    if (progress.state !== "initialized") throw new Error("expected an initialized head");
    expect(progress.criteria.classes).toEqual({
      required: 25,
      completed: 11,
      imported: 9,
      met: false,
    });
    expect(progress.totalAttendedClasses).toBe(3);
    expect(progress.progressPercent).toBe(
      computeLevelProgress({
        classes: { done: 11, min: 25 },
        days: { done: progress.criteria.time.elapsedDays, min: 75 },
        skills: [],
      }),
    );
  });

  it("counts attendance since the level start when there is no baseline", async () => {
    const { store } = await seededStore([
      [
        `academies/${academyId}/studentLevelProgress/student-1`,
        head({ currentLevelStartedAt: "2026-08-25T00:00:00.000Z" }),
      ],
      ...baselineAttendance,
    ]);
    const progress = await store.getStudentProgressSummary(academyId, "student-1");
    if (progress.state !== "initialized") throw new Error("expected an initialized head");
    expect(progress.criteria.classes).toMatchObject({ completed: 2, imported: 0 });
  });

  it("fails closed on a malformed baseline", async () => {
    const { store } = await seededStore([
      [
        `academies/${academyId}/studentLevelProgress/student-1`,
        head({ importedBaseline: { classes: -1, cutoff: "yesterday" } }),
      ],
    ]);
    await expect(store.getStudentProgressSummary(academyId, "student-1")).rejects.toMatchObject({
      code: "tenant",
    });
  });

  it("refuses attendance whose occurredAt is not a real instant", async () => {
    const [path, record] = attendance("att-bad", "2026-09-05T18:00:00.000Z");
    const { store } = await seededStore([
      [`academies/${academyId}/studentLevelProgress/student-1`, head()],
      [path, { ...record, occurredAt: "not-a-date" }],
    ]);
    await expect(store.getStudentProgressSummary(academyId, "student-1")).rejects.toMatchObject({
      code: "conflict",
      message: "Attendance time is invalid",
    });
  });

  it("drops the baseline on approvePromotion and keeps it in the restore snapshot", async () => {
    const { store, records } = await seededStore([
      [
        `academies/${academyId}/studentLevelProgress/student-1`,
        head({ importedBaseline: baseline }),
      ],
    ]);
    const graduation = await store.approvePromotion({
      academyId,
      input: {
        studentId: "student-1",
        fromDefinitionKey: "white-belt",
        toDefinitionKey: "white-1st-stripe",
        decisionNotes: "Met in person.",
      },
      decidedBy: "head-user-1",
      decidedByStaffId: "staff-head-1",
      decidedByRole: "headCoach",
      decidedAt,
    });
    const stored = records.get(`academies/${academyId}/studentLevelProgress/student-1`)!;
    expect(stored.currentDefinitionKey).toBe("white-1st-stripe");
    expect(stored).not.toHaveProperty("importedBaseline");
    expect(
      records.get(`academies/${academyId}/levelPromotions/${graduation.graduationId}`)?.restore,
    ).toEqual({
      currentDefinitionKey: "white-belt",
      currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
      lastApprovedPromotionId: null,
      importedBaseline: baseline,
    });
  });
});
