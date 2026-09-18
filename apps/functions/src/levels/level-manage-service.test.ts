import { Timestamp } from "firebase-admin/firestore";
import { afterEach, describe, expect, it, vi } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import {
  computeLevelProgress,
  type AssignLevelResult,
  type StudentLevelHistory,
  type VoidPromotionResult,
} from "@bpt-jersey/domain/levels";
import { createInMemoryLevelStore, createLevelCatalogStore } from "./level-service";
import { normalizeLevelCatalogSource } from "./level-source";

const academyId = "academy-1";
const decidedAt = "2026-09-10T12:00:00.000Z";
const voidAt = "2026-09-11T09:00:00.000Z";
const assignmentNote = "Competition result justifies it.";
const voidReason = "Assigned to the wrong member by mistake.";
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

/** One approved promotion as it is STORED, for the history reads that seed records directly. */
const rawPromotion = (promotionId: string, toDefinitionKey: string, promotedOn: string) => [
  `academies/${academyId}/levelPromotions/${promotionId}`,
  {
    promotionId,
    academyId,
    studentId: "student-1",
    systemId: "ibjjf-v1",
    status: "approved",
    fromDefinitionKey: "white-belt",
    toDefinitionKey,
    promotedOn,
    decidedBy: "owner-user-1",
    decidedByRole: "owner",
    decidedAt: `${promotedOn}T12:00:00.000Z`,
    gaps: [],
  },
];

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
    // m1: the refusal has to name the record, or the operator cannot find it.
    await expect(store.getStudentProgressSummary(academyId, "student-1")).rejects.toMatchObject({
      code: "conflict",
      message: "Attendance time is invalid: att-bad",
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

/**
 * Task 7 review, Major-3: the two stores are one contract. Every expectation below runs against
 * BOTH, so a change to one that is not made to the other fails here rather than in Task 10 or 12,
 * where a green test over the in-memory store would be a lie about the production path.
 */
const levelStartedAt = "2026-07-01T00:00:00.000Z";

type ParitySummary = Readonly<{
  state: string;
  currentDefinitionKey: string | null;
  imported: number | null;
}>;

type ParityFixture = Readonly<{
  approve: (input: {
    studentId: string;
    fromDefinitionKey: string;
    toDefinitionKey: string;
  }) => Promise<string>;
  assign: (
    input?: Record<string, unknown>,
    overrides?: Record<string, unknown>,
  ) => Promise<AssignLevelResult>;
  reject: (targetDefinitionKey: string) => Promise<void>;
  progressOf: (studentId: string) => Promise<ParitySummary>;
  currentDefinitionKey: () => Promise<string | null>;
  levelStartedAt: () => Promise<string | null>;
  readRestore: (graduationId: string) => Promise<unknown>;
  readPromotion: (graduationId: string) => Promise<Record<string, unknown> | undefined>;
  voidPromotion: (
    promotionId: string,
    overrides?: Record<string, unknown>,
  ) => Promise<VoidPromotionResult>;
  history: (studentId?: string) => Promise<StudentLevelHistory>;
  graduationIds: () => Promise<readonly string[]>;
}>;

type AnyLevelStore = ReturnType<typeof createInMemoryLevelStore>;

async function paritySummary(store: AnyLevelStore, studentId: string): Promise<ParitySummary> {
  const summary = await store.getStudentProgressSummary(academyId, studentId);
  return summary.state === "initialized"
    ? {
        state: summary.state,
        currentDefinitionKey: summary.currentDefinition.definitionKey,
        imported: summary.criteria.classes.imported,
      }
    : { state: summary.state, currentDefinitionKey: null, imported: null };
}

/**
 * Task 9: the same assignment call against either store. The owner is the default actor because
 * the owner has no staff record, which is the path the Manage view uses.
 */
function assignThrough(store: AnyLevelStore): ParityFixture["assign"] {
  return async (input = {}, overrides = {}) =>
    store.assignLevel({
      academyId,
      input: {
        studentId: "student-1",
        fromDefinitionKey: "white-belt",
        toDefinitionKey: "white-2nd-stripe",
        promotedOn: "2026-09-10",
        ...input,
      } as never,
      decidedBy: "owner-user-1",
      decidedByStaffId: null,
      decidedByRole: "owner",
      decidedAt,
      ...overrides,
    });
}

function approveThrough(store: AnyLevelStore): ParityFixture["approve"] {
  return async (input) =>
    (
      await store.approvePromotion({
        academyId,
        input: { ...input, decisionNotes: "Met in person." },
        decidedBy: "head-user-1",
        decidedByStaffId: "staff-head-1",
        decidedByRole: "headCoach",
        decidedAt,
      })
    ).graduationId;
}

/**
 * A REJECTED promotion writes the promotion document `assignLevel` would create for the same level
 * and the same instant, and moves no head: the one way to reach the replay guard with every other
 * reference still current, in either store.
 */
function rejectThrough(store: AnyLevelStore): ParityFixture["reject"] {
  return async (targetDefinitionKey) => {
    await store.rejectPromotion({
      academyId,
      input: { studentId: "student-1", targetDefinitionKey, decisionNotes: "Not yet." },
      decidedBy: "head-user-1",
      decidedByStaffId: "staff-head-1",
      decidedByRole: "headCoach",
      decidedAt,
    });
  };
}

/**
 * Task 10: the same void call against either store. The head coach is the default actor here and
 * the owner is the default assigner above, so the parity block exercises both roles end to end.
 */
function voidThrough(store: AnyLevelStore): ParityFixture["voidPromotion"] {
  return async (promotionId, overrides = {}) =>
    store.voidPromotion({
      academyId,
      input: { studentId: "student-1", promotionId, reason: voidReason },
      decidedBy: "head-user-1",
      decidedByStaffId: "staff-head-1",
      decidedByRole: "headCoach",
      decidedAt: voidAt,
      ...overrides,
    } as never);
}

const parityFixtures: readonly [string, () => Promise<ParityFixture>][] = [
  [
    "Firestore store",
    async () => {
      const { store, records } = await seededStore([
        [`academies/${academyId}/studentLevelProgress/student-1`, head()],
        // A second real student with no level head: the Firestore store reads the canonical student
        // before the head, so "no head" has to be asked of a student that exists.
        [
          `academies/${academyId}/students/student-2`,
          {
            studentId: "student-2",
            academyId,
            fullName: "Synthetic Newcomer",
            dateOfBirth: "1992-02-02",
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
      ]);
      return {
        approve: approveThrough(store as unknown as AnyLevelStore),
        assign: assignThrough(store as unknown as AnyLevelStore),
        reject: rejectThrough(store as unknown as AnyLevelStore),
        progressOf: async (studentId) =>
          paritySummary(store as unknown as AnyLevelStore, studentId),
        currentDefinitionKey: async () =>
          (records.get(`academies/${academyId}/studentLevelProgress/student-1`)
            ?.currentDefinitionKey ?? null) as string | null,
        levelStartedAt: async () =>
          (records.get(`academies/${academyId}/studentLevelProgress/student-1`)
            ?.currentLevelStartedAt ?? null) as string | null,
        readRestore: async (graduationId) =>
          records.get(`academies/${academyId}/levelPromotions/${graduationId}`)?.restore,
        readPromotion: async (graduationId) =>
          records.get(`academies/${academyId}/levelPromotions/${graduationId}`),
        voidPromotion: voidThrough(store as unknown as AnyLevelStore),
        history: async (studentId = "student-1") =>
          (store as unknown as AnyLevelStore).getStudentLevelHistory(academyId, studentId),
        graduationIds: async () =>
          (await store.listGraduations(academyId, "student-1")).map(
            (record) => record.graduationId,
          ),
      };
    },
  ],
  [
    "in-memory store",
    async () => {
      const store = createInMemoryLevelStore();
      await store.seed({ academyId, normalized });
      await store.openStudentLevel({
        academyId,
        input: {
          studentId: "student-1",
          definitionKey: "white-belt",
          decisionNotes: "Synthetic opening note.",
        },
        openedBy: "head-user-1",
        openedByStaffId: "staff-head-1",
        openedByRole: "headCoach",
        openedAt: levelStartedAt,
      });
      const promotionOf = async (graduationId: string) =>
        (await store.listGraduations(academyId, "student-1")).find(
          (record) => record.graduationId === graduationId,
        ) as unknown as Record<string, unknown> | undefined;
      return {
        approve: approveThrough(store),
        assign: assignThrough(store),
        reject: rejectThrough(store),
        progressOf: async (studentId) => paritySummary(store, studentId),
        currentDefinitionKey: async () =>
          (await paritySummary(store, "student-1")).currentDefinitionKey,
        levelStartedAt: async () => {
          const summary = await store.getStudentProgressSummary(academyId, "student-1");
          return summary.state === "initialized" ? summary.currentLevelStartedAt : null;
        },
        readPromotion: promotionOf,
        voidPromotion: voidThrough(store),
        history: async (studentId = "student-1") =>
          store.getStudentLevelHistory(academyId, studentId),
        graduationIds: async () =>
          (await store.listGraduations(academyId, "student-1")).map(
            (record) => record.graduationId,
          ),
        readRestore: async (graduationId) =>
          (
            (await store.listGraduations(academyId, "student-1")).find(
              (record) => record.graduationId === graduationId,
            ) as unknown as { restore?: unknown } | undefined
          )?.restore,
      };
    },
  ],
];

describe.each(parityFixtures)("promotion parity — %s (T051V2)", (_label, makeFixture) => {
  it("moves the head, records the restore snapshot and leaves no imported baseline", async () => {
    const fixture = await makeFixture();
    const graduationId = await fixture.approve({
      studentId: "student-1",
      fromDefinitionKey: "white-belt",
      toDefinitionKey: "white-1st-stripe",
    });
    expect(await fixture.currentDefinitionKey()).toBe("white-1st-stripe");
    expect(await fixture.readRestore(graduationId)).toEqual({
      currentDefinitionKey: "white-belt",
      currentLevelStartedAt: levelStartedAt,
      lastApprovedPromotionId: null,
      importedBaseline: null,
    });
    expect(await fixture.progressOf("student-1")).toEqual({
      state: "initialized",
      currentDefinitionKey: "white-1st-stripe",
      imported: 0,
    });
  });

  it("reports an uninitialized summary for a student with no head", async () => {
    const fixture = await makeFixture();
    expect(await fixture.progressOf("student-2")).toEqual({
      state: "uninitialized",
      currentDefinitionKey: null,
      imported: null,
    });
  });

  it("refuses a promotion with no head, a stale `from`, a skipped sequence or a duplicate", async () => {
    const conflict = { code: "conflict", message: "Promotion references are not current" };
    for (const input of [
      {
        studentId: "student-2",
        fromDefinitionKey: "white-belt",
        toDefinitionKey: "white-1st-stripe",
      },
      {
        studentId: "student-1",
        fromDefinitionKey: "white-1st-stripe",
        toDefinitionKey: "white-2nd-stripe",
      },
      {
        studentId: "student-1",
        fromDefinitionKey: "white-belt",
        toDefinitionKey: "white-2nd-stripe",
      },
    ]) {
      const fixture = await makeFixture();
      await expect(fixture.approve(input)).rejects.toMatchObject(conflict);
    }
    const fixture = await makeFixture();
    const promotion = {
      studentId: "student-1",
      fromDefinitionKey: "white-belt",
      toDefinitionKey: "white-1st-stripe",
    };
    await fixture.approve(promotion);
    await expect(fixture.approve(promotion)).rejects.toMatchObject(conflict);
  });

  // Task 9. The in-memory store keeps no attendance and no student record, so its gap list can
  // carry MORE entries than the Firestore one (no date of birth means the age band reads as not
  // met): it fails closed, never open. The two class/day gaps below are identical in both.
  // Renamed in the Task 9 review: neither parity fixture's head carries an `importedBaseline` —
  // the in-memory store has no way to put one there — so this test never proved the drop. The drop
  // is asserted where a baseline actually exists, in the Firestore block below.
  it("assigns a skipped stripe with a note and moves the head to the promotion day", async () => {
    const fixture = await makeFixture();
    const result = await fixture.assign({ note: "Competition result justifies it." });
    expect(result).toMatchObject({
      promotionId: `grad_student-1_white-2nd-stripe_${decidedAt}`,
      toDefinitionKey: "white-2nd-stripe",
      promotedOn: "2026-09-10",
    });
    expect(result.gaps).toEqual(
      expect.arrayContaining(["Skips 1 stripe", "Classes 0/25 not met", "Days 71/75 not met"]),
    );
    expect(await fixture.currentDefinitionKey()).toBe("white-2nd-stripe");
    expect(await fixture.readRestore(result.promotionId)).toEqual({
      currentDefinitionKey: "white-belt",
      currentLevelStartedAt: levelStartedAt,
      lastApprovedPromotionId: null,
      importedBaseline: null,
    });
    expect(await fixture.progressOf("student-1")).toEqual({
      state: "initialized",
      currentDefinitionKey: "white-2nd-stripe",
      imported: 0,
    });
  });

  it("refuses an assignment below criteria with no note", async () => {
    const fixture = await makeFixture();
    await expect(fixture.assign()).rejects.toMatchObject({
      code: "invalid",
      message: "A note is required when criteria are not met",
    });
    expect(await fixture.currentDefinitionKey()).toBe("white-belt");
  });

  /**
   * Review of Task 9 (Major-1): the mandatory note used to be satisfied by `null`, `""`, a space,
   * `"ok"` and a note carrying a NUL byte — all stored verbatim on an irreversible audited write
   * whose note is the ONLY record of why somebody was promoted below criteria. The store now
   * applies the same rule the callable boundary will: absent (`undefined` or `null`) is refused as
   * missing, anything else is refused as invalid unless it is 10–500 real characters.
   */
  it.each([
    ["null", null, "A note is required when criteria are not met"],
    ["empty", "", "Promotion note is invalid"],
    ["whitespace only", "   \n\t  ", "Promotion note is invalid"],
    ["two characters", "ok", "Promotion note is invalid"],
    [
      "a NUL byte",
      `Competition result${String.fromCharCode(0)} justifies it.`,
      "Promotion note is invalid",
    ],
  ])("refuses a below-criteria assignment whose note is %s", async (_label, note, message) => {
    const fixture = await makeFixture();
    await expect(fixture.assign({ note })).rejects.toMatchObject({ code: "invalid", message });
    expect(await fixture.currentDefinitionKey()).toBe("white-belt");
  });

  it("stores the note trimmed, and starts the new level on the promotion day", async () => {
    const fixture = await makeFixture();
    const result = await fixture.assign({ note: "  Competition result justifies it.  \n" });
    expect(await fixture.readPromotion(result.promotionId)).toMatchObject({
      note: "Competition result justifies it.",
      decisionNotes: "Competition result justifies it.",
    });
    // The head starts at midnight on the promotion day, so the day the promotion names and the day
    // the new level counts from are one and the same.
    expect(await fixture.levelStartedAt()).toBe("2026-09-10T00:00:00.000Z");
  });

  // The replay guard: the promotion document for this student, level and instant already exists
  // (written by a rejection), and every other reference is still current.
  it("refuses an assignment whose promotion id is already taken, and moves no head", async () => {
    const fixture = await makeFixture();
    await fixture.reject("white-2nd-stripe");
    await expect(
      fixture.assign({ note: "Competition result justifies it." }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "Promotion references are not current",
    });
    expect(await fixture.currentDefinitionKey()).toBe("white-belt");
    expect(await fixture.levelStartedAt()).toBe(levelStartedAt);
  });

  // The bound is the ACADEMY's day (Europe/Jersey), exactly as `startedOn`: at 23:30Z on the 10th
  // it is already the 11th in Jersey, so the 11th is today and must be accepted. A UTC
  // implementation refuses it and fails here.
  it("bounds promotedOn by the Jersey day, not the UTC day", async () => {
    const lateEvening = "2026-09-10T23:30:00.000Z";
    const onJerseyToday = await makeFixture();
    const assigned = await onJerseyToday.assign(
      { note: "Competition result justifies it.", promotedOn: "2026-09-11" },
      { decidedAt: lateEvening },
    );
    expect(assigned.promotedOn).toBe("2026-09-11");

    const tomorrow = await makeFixture();
    await expect(
      tomorrow.assign(
        { note: "Competition result justifies it.", promotedOn: "2026-09-12" },
        { decidedAt: lateEvening },
      ),
    ).rejects.toMatchObject({ code: "invalid", message: "Promotion date is in the future" });
  });

  it("refuses a promotion date before the current level start", async () => {
    const fixture = await makeFixture();
    await expect(
      fixture.assign({ note: "Competition result justifies it.", promotedOn: "2026-06-30" }),
    ).rejects.toMatchObject({
      code: "invalid",
      message: "Promotion date is before the current level start",
    });
    expect(await fixture.currentDefinitionKey()).toBe("white-belt");
  });

  // The comparison is lexical, so a malformed value sorting below today would otherwise be
  // accepted and concatenated into the head's instant.
  it.each(["1026-13-45", "2026-13-45"])("refuses the malformed promotion date %s", async (date) => {
    const fixture = await makeFixture();
    await expect(
      fixture.assign({ note: "Competition result justifies it.", promotedOn: date }),
    ).rejects.toMatchObject({
      code: "invalid",
      message: "Promotion date is not a calendar date",
    });
  });

  // G12 narrows G6: an administrator sees the card and the history but never assigns a level. The
  // message is pinned because `assertTransactionalActor` also throws `tenant`, so a code-only
  // assertion would pass for the wrong reason.
  it.each(["coach", "administrator"])("refuses %s", async (role) => {
    const fixture = await makeFixture();
    await expect(
      fixture.assign(
        { note: "Competition result justifies it." },
        {
          decidedBy: "coach-user-1",
          decidedByStaffId: "staff-coach-1",
          decidedByRole: role,
        },
      ),
    ).rejects.toMatchObject({ code: "tenant", message: "Promotion decision role is invalid" });
    expect(await fixture.currentDefinitionKey()).toBe("white-belt");
  });

  // A self-promotion parses (`assignLevelInputSchema` does not compare the two keys), so the
  // server has to refuse it, along with every backwards move.
  it.each(["white-belt", "white-belt-kids-4-5-and-5-7-yo"])(
    "refuses an assignment to %s, which is not forwards",
    async (toDefinitionKey) => {
      const fixture = await makeFixture();
      await expect(
        fixture.assign({ note: "Competition result justifies it.", toDefinitionKey }),
      ).rejects.toMatchObject({
        code: "conflict",
        message: "Promotion references are not current",
      });
      expect(await fixture.currentDefinitionKey()).toBe("white-belt");
    },
  );

  // Task 10. Plan decision 2: a void restores the head from the promotion's OWN restore snapshot,
  // so it never has to reconstruct history, and it appends a record rather than mutating one.
  it("voids the latest assignment, restores the head and marks the history entry voided", async () => {
    const fixture = await makeFixture();
    const assigned = await fixture.assign({ note: assignmentNote });
    const result = await fixture.voidPromotion(assigned.promotionId);
    expect(result).toEqual({
      voidId: `void_${assigned.promotionId}`,
      voidsPromotionId: assigned.promotionId,
      restoredDefinitionKey: "white-belt",
    });
    expect(await fixture.currentDefinitionKey()).toBe("white-belt");
    expect(await fixture.levelStartedAt()).toBe(levelStartedAt);
    const history = await fixture.history();
    expect(history.currentDefinitionKey).toBe("white-belt");
    expect(history.entries.map((entry) => [entry.entryId, entry.kind])).toEqual([
      [assigned.promotionId, "promotion"],
      ["opening_student-1", "opening"],
    ]);
    expect(history.entries[0]).toMatchObject({
      definitionKey: "white-2nd-stripe",
      fromDefinitionKey: "white-belt",
      assignedOn: "2026-09-10",
      decidedByRole: "owner",
      source: "bpt",
      note: assignmentNote,
      voided: { reason: voidReason, voidedByRole: "headCoach", voidedOn: "2026-09-11" },
    });
    expect(history.entries[1]).toMatchObject({
      definitionKey: "white-belt",
      fromDefinitionKey: null,
      assignedOn: "2026-07-01",
      classes: null,
      days: null,
      decidedByRole: "headCoach",
      note: "Synthetic opening note.",
      gaps: [],
      voided: null,
    });
    // The void is a record of its own and is never a graduation.
    expect(await fixture.graduationIds()).toEqual([assigned.promotionId]);
  });

  // Plan decision 2: only the promotion `lastApprovedPromotionId` names may be voided, so a chain
  // is walked back ONE STEP AT A TIME. The earlier promotion below is a real, approved, restorable
  // promotion of this very student — the only fixture that can tell "not the latest" apart from
  // "no such promotion".
  it("voids only the promotion the head names, one step at a time, and only once", async () => {
    const fixture = await makeFixture();
    const first = await fixture.assign(
      { note: assignmentNote, toDefinitionKey: "white-1st-stripe", promotedOn: "2026-09-09" },
      { decidedAt: "2026-09-09T12:00:00.000Z" },
    );
    const second = await fixture.assign({
      note: assignmentNote,
      fromDefinitionKey: "white-1st-stripe",
    });
    await expect(fixture.voidPromotion(first.promotionId)).rejects.toMatchObject({
      code: "conflict",
      message: "Promotion cannot be voided",
    });
    await expect(
      fixture.voidPromotion("grad_student-1_white-1st-stripe_2026-08-01T00:00:00.000Z"),
    ).rejects.toMatchObject({ code: "conflict", message: "Promotion cannot be voided" });
    expect(await fixture.currentDefinitionKey()).toBe("white-2nd-stripe");

    await fixture.voidPromotion(second.promotionId);
    expect(await fixture.currentDefinitionKey()).toBe("white-1st-stripe");
    await expect(fixture.voidPromotion(second.promotionId)).rejects.toMatchObject({
      code: "conflict",
      message: "Promotion cannot be voided",
    });
    // Now, and only now, the earlier promotion is the one the head names.
    await fixture.voidPromotion(first.promotionId);
    expect(await fixture.currentDefinitionKey()).toBe("white-belt");
    expect(await fixture.levelStartedAt()).toBe(levelStartedAt);
  });

  /**
   * T051V2 re-review of Task 16 (m1). This test is NAMED for what it actually proves, because an
   * earlier name claimed more than it held. Through `assignLevel` alone the head and the row order
   * CANNOT be made to disagree: `assertPromotionNotBeforeLevelStart` refuses a date before the
   * current level start and the promotion then starts the new level on its own day, so
   * `assignedOn` never decreases along the standing chain; a void walks the head back one step and
   * marks every later promotion voided. So the standing promotions always come back in reverse
   * order of recording, and the first of them is always the head. Replacing
   * `lastApprovedPromotionId` with `entries.find((entry) => entry.kind === "promotion" &&
   * entry.voided === null)` leaves this test GREEN under both stores, by construction and not by
   * accident. The rule that the head beats the row order is pinned where the two can genuinely
   * disagree — seeded rows, which is the Plan D import shape — by "carries the id the head names
   * even when an older row is the one it names" below, and that test DOES die under that mutation.
   * What this one is worth: both stores agree, step for step, on which promotion the head names
   * while two promotions share a day and the dates can separate nothing.
   */
  it("agrees across both stores on the head it walks back, on a day two promotions share", async () => {
    const fixture = await makeFixture();
    const first = await fixture.assign(
      { note: assignmentNote, toDefinitionKey: "white-1st-stripe", promotedOn: "2026-09-09" },
      { decidedAt: "2026-09-09T12:00:00.000Z" },
    );
    const second = await fixture.assign({
      note: assignmentNote,
      fromDefinitionKey: "white-1st-stripe",
      promotedOn: "2026-09-09",
    });
    const history = await fixture.history();
    expect(history.lastApprovedPromotionId).toBe(second.promotionId);
    expect(
      history.entries
        .filter((entry) => entry.kind === "promotion" && entry.voided === null)
        .map((entry) => entry.assignedOn),
    ).toEqual(["2026-09-09", "2026-09-09"]);
    // And it follows the head one step at a time, exactly as `voidPromotion` does.
    await fixture.voidPromotion(second.promotionId);
    expect((await fixture.history()).lastApprovedPromotionId).toBe(first.promotionId);
    await fixture.voidPromotion(first.promotionId);
    expect((await fixture.history()).lastApprovedPromotionId).toBeNull();
  });

  // G12 narrows G6: an administrator sees the record and the history but never voids a promotion.
  // The message is pinned because `assertTransactionalActor` also throws `tenant`, so a code-only
  // assertion would pass for the wrong reason.
  it.each(["coach", "administrator"])("refuses a void by %s", async (role) => {
    const fixture = await makeFixture();
    const assigned = await fixture.assign({ note: assignmentNote });
    await expect(
      fixture.voidPromotion(assigned.promotionId, {
        decidedBy: "coach-user-1",
        decidedByStaffId: "staff-coach-1",
        decidedByRole: role,
      }),
    ).rejects.toMatchObject({ code: "tenant", message: "Promotion decision role is invalid" });
    expect(await fixture.currentDefinitionKey()).toBe("white-2nd-stripe");
  });

  /**
   * Review of Task 10 (Major-1): the reason is the ONLY record of why a real, audited promotion was
   * cancelled, so the store re-checks it with the same schema the boundary parses with. Every one
   * of these five used to be accepted and written verbatim, and each then made the promotion
   * disappear from the history at read time.
   */
  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["too short", "oops"],
    ["carrying a control character", `Wrong member${String.fromCharCode(0)} entirely.`],
    ["longer than 500 characters", "w".repeat(501)],
  ])("refuses a void reason that is %s, and voids nothing", async (_label, reason) => {
    const fixture = await makeFixture();
    const assigned = await fixture.assign({ note: assignmentNote });
    await expect(
      fixture.voidPromotion(assigned.promotionId, {
        input: { studentId: "student-1", promotionId: assigned.promotionId, reason },
      }),
    ).rejects.toMatchObject({ code: "invalid", message: "Void reason is invalid" });
    expect(await fixture.currentDefinitionKey()).toBe("white-2nd-stripe");
    expect((await fixture.history()).entries[0]?.voided).toBeNull();
  });

  it("stores the void reason trimmed, exactly as an assignment note is", async () => {
    const fixture = await makeFixture();
    const assigned = await fixture.assign({ note: assignmentNote });
    await fixture.voidPromotion(assigned.promotionId, {
      input: {
        studentId: "student-1",
        promotionId: assigned.promotionId,
        reason: `  ${voidReason}  `,
      },
    });
    expect((await fixture.history()).entries[0]?.voided).toMatchObject({ reason: voidReason });
  });

  it("lists the opening on its own before any promotion", async () => {
    const fixture = await makeFixture();
    expect(await fixture.history()).toEqual({
      studentId: "student-1",
      currentDefinitionKey: "white-belt",
      // No promotion has been approved, so there is nothing the server would accept a void for.
      lastApprovedPromotionId: null,
      entries: [
        {
          entryId: "opening_student-1",
          kind: "opening",
          definitionKey: "white-belt",
          fromDefinitionKey: null,
          assignedOn: "2026-07-01",
          classes: null,
          days: null,
          decidedByRole: "headCoach",
          source: "bpt",
          note: "Synthetic opening note.",
          gaps: [],
          voided: null,
        },
      ],
    });
  });

  it("returns an empty history for a student without a level", async () => {
    const fixture = await makeFixture();
    expect(await fixture.history("student-2")).toEqual({
      studentId: "student-2",
      currentDefinitionKey: null,
      lastApprovedPromotionId: null,
      entries: [],
    });
  });
});

/**
 * T051V2 Task 8: a level may now be opened at any definition (belt or stripe) with an explicit
 * start date, by the head coach or the owner. The audit and the single-head guarantee are
 * Firestore concerns, so they are asserted here; every behavioural rule is asserted against BOTH
 * stores in the parity block below.
 */
describe("openStudentLevel at any definition (T051V2)", () => {
  const open = (overrides: Record<string, unknown> = {}) => ({
    academyId,
    input: {
      studentId: "student-1",
      definitionKey: "white-2nd-stripe",
      decisionNotes: "Holds this stripe from Regyfit.",
      startedOn: "2026-07-01",
    },
    openedBy: "owner-user-1",
    openedByStaffId: null,
    openedByRole: "owner" as const,
    openedAt: decidedAt,
    ...overrides,
  });

  it("writes exactly the head and its audit event, in that order", async () => {
    const { store, writes } = await seededStore();
    await store.openStudentLevel(open());
    expect(writes.map((write) => write.path)).toEqual([
      `academies/${academyId}/studentLevelProgress/student-1`,
      expect.stringMatching(/^academies\/academy-1\/auditEvents\/audit-level-write-/u),
    ]);
    expect(writes[0]?.data).toMatchObject({
      currentDefinitionKey: "white-2nd-stripe",
      currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
      openedDefinitionKey: "white-2nd-stripe",
      openedOn: "2026-07-01",
      openedByRole: "owner",
      openedByStaffId: null,
    });
    expect(writes[1]?.data).toMatchObject({
      actorId: "owner-user-1",
      action: "level.opened",
      targetRef: `academies/${academyId}/studentLevelProgress/student-1`,
      purpose: "student-level-opening",
    });
  });

  // Minor-2: opening at 23:30Z in BST is already the 11th in Jersey. The level must start at the
  // 11th's midnight, so the class trained at 09:00 Jersey on the 10th — a whole Jersey day before
  // the recorded opening day — is NOT counted at the new level.
  it("counts no class from the Jersey day before the opening day", async () => {
    const { store } = await seededStore([
      attendance("att-prev-day", "2026-09-10T08:00:00.000Z"),
      attendance("att-same-day", "2026-09-11T08:00:00.000Z"),
    ]);
    const { head: opened } = await store.openStudentLevel(
      open({
        input: {
          studentId: "student-1",
          definitionKey: "white-belt",
          decisionNotes: "Holds this belt from Regyfit.",
        },
        openedAt: "2026-09-10T23:30:00.000Z",
      }),
    );
    expect(opened.openedOn).toBe("2026-09-11");
    expect(opened.currentLevelStartedAt).toBe("2026-09-11T00:00:00.000Z");
    const progress = await store.getStudentProgressSummary(academyId, "student-1");
    if (progress.state !== "initialized") throw new Error("expected an initialized head");
    expect(progress.criteria.classes).toMatchObject({ completed: 1, imported: 0 });
  });

  it("refuses an owner whose directory entry does not say owner, and writes nothing", async () => {
    const { store, writes } = await seededStore();
    await expect(store.openStudentLevel(open({ openedBy: "head-user-1" }))).rejects.toMatchObject({
      code: "tenant",
    });
    expect(writes).toHaveLength(0);
  });

  it("refuses a head coach with no staff scope, and writes nothing", async () => {
    const { store, writes } = await seededStore();
    await expect(
      store.openStudentLevel(
        open({ openedBy: "head-user-1", openedByStaffId: null, openedByRole: "headCoach" }),
      ),
    ).rejects.toMatchObject({ code: "tenant" });
    expect(writes).toHaveLength(0);
  });
});

const openParityStores: readonly [string, () => Promise<AnyLevelStore>][] = [
  ["Firestore store", async () => (await seededStore()).store as unknown as AnyLevelStore],
  [
    "in-memory store",
    async () => {
      const store = createInMemoryLevelStore();
      await store.seed({ academyId, normalized });
      return store;
    },
  ],
];

describe.each(openParityStores)("open-a-level parity — %s (T051V2)", (_label, makeStore) => {
  const open = (overrides: Record<string, unknown> = {}) => ({
    academyId,
    input: {
      studentId: "student-1",
      definitionKey: "white-2nd-stripe",
      decisionNotes: "Holds this stripe from Regyfit.",
      startedOn: "2026-07-01",
    },
    openedBy: "owner-user-1",
    openedByStaffId: null,
    openedByRole: "owner" as const,
    openedAt: decidedAt,
    ...overrides,
  });

  it("lets the owner open a stripe at a past start date", async () => {
    const store = await makeStore();
    const { head: opened } = await store.openStudentLevel(open());
    expect(opened).toMatchObject({
      studentId: "student-1",
      currentDefinitionKey: "white-2nd-stripe",
      currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
      openedDefinitionKey: "white-2nd-stripe",
      openedOn: "2026-07-01",
      openedByRole: "owner",
      openedByStaffId: null,
      state: "initialized",
    });
  });

  it("starts at midnight on the Jersey day without startedOn", async () => {
    const store = await makeStore();
    const { head: opened } = await store.openStudentLevel(
      open({
        input: {
          studentId: "student-1",
          definitionKey: "white-belt",
          decisionNotes: "Holds this belt from Regyfit.",
        },
        openedBy: "head-user-1",
        openedByStaffId: "staff-head-1",
        openedByRole: "headCoach",
      }),
    );
    expect(opened).toMatchObject({
      currentDefinitionKey: "white-belt",
      currentLevelStartedAt: "2026-09-10T00:00:00.000Z",
      openedDefinitionKey: "white-belt",
      openedOn: "2026-09-10",
      openedByRole: "headCoach",
      openedByStaffId: "staff-head-1",
    });
  });

  // The bound is the ACADEMY's day (Europe/Jersey), not UTC. At 23:30 UTC on 10 September it is
  // already the 11th in Jersey (BST), so the 11th is today and must be accepted while the 12th
  // must not. A UTC implementation refuses the 11th and fails here.
  it("bounds startedOn by the Jersey day, not the UTC day", async () => {
    const lateEvening = "2026-09-10T23:30:00.000Z";
    const onJerseyToday = await makeStore();
    const { head: opened } = await onJerseyToday.openStudentLevel(
      open({ input: { ...open().input, startedOn: "2026-09-11" }, openedAt: lateEvening }),
    );
    expect(opened.currentLevelStartedAt).toBe("2026-09-11T00:00:00.000Z");

    const defaulted = await makeStore();
    const { head: today } = await defaulted.openStudentLevel(
      open({
        input: {
          studentId: "student-1",
          definitionKey: "white-belt",
          decisionNotes: "Holds this belt from Regyfit.",
        },
        openedAt: lateEvening,
      }),
    );
    expect(today.openedOn).toBe("2026-09-11");
    // The two opening fields must name the SAME day: recording openedOn 2026-09-11 while counting
    // from 23:30Z on the 10th would include the whole previous Jersey day of classes.
    expect(today.currentLevelStartedAt).toBe("2026-09-11T00:00:00.000Z");

    const tomorrow = await makeStore();
    await expect(
      tomorrow.openStudentLevel(
        open({ input: { ...open().input, startedOn: "2026-09-12" }, openedAt: lateEvening }),
      ),
    ).rejects.toMatchObject({ code: "invalid", message: "Level start date is in the future" });
  });

  // Minor-4: the future check compares strings, so a malformed value could sort below today and
  // be concatenated into an instant. Both a low and a high malformed value are refused, and for
  // being malformed rather than for being in the future.
  it.each(["1026-13-45", "2026-13-45"])(
    "refuses the malformed start date %s",
    async (startedOn) => {
      const store = await makeStore();
      await expect(
        store.openStudentLevel(open({ input: { ...open().input, startedOn } })),
      ).rejects.toMatchObject({
        code: "invalid",
        message: "Level start date is not a calendar date",
      });
    },
  );

  it("refuses a start date after today", async () => {
    const store = await makeStore();
    await expect(
      store.openStudentLevel(open({ input: { ...open().input, startedOn: "2026-09-11" } })),
    ).rejects.toMatchObject({ code: "invalid", message: "Level start date is in the future" });
  });

  // G12 narrows G6: an administrator sees the card and the history but never opens a level. The
  // message is pinned so a refusal that happens for some other reason cannot pass for this guard.
  it.each(["coach", "administrator"])("refuses %s", async (role) => {
    const store = await makeStore();
    await expect(
      store.openStudentLevel(
        open({
          openedBy: "coach-user-1",
          openedByStaffId: "staff-coach-1",
          openedByRole: role as never,
        }),
      ),
    ).rejects.toMatchObject({ code: "tenant", message: "Level opening role is invalid" });
  });

  it("refuses an unknown definition and a second head", async () => {
    const store = await makeStore();
    await expect(
      store.openStudentLevel(open({ input: { ...open().input, definitionKey: "unknown-level" } })),
    ).rejects.toMatchObject({ code: "conflict" });
    await store.openStudentLevel(open());
    await expect(store.openStudentLevel(open())).rejects.toMatchObject({
      code: "conflict",
      message: "Student level is already open",
    });
  });
});

/**
 * T051V2 Task 9 (grill G7): the owner or head coach assigns a level at an explicit date, the
 * server computes the gaps, and a note is mandatory whenever there is one. The audit row, the
 * promotion document and the "no write at all" guarantees are Firestore concerns and are asserted
 * here; every behavioural rule is asserted against BOTH stores in the parity block above.
 */
describe("assignLevel (T051V2, grill G7)", () => {
  const assign = (
    input: Record<string, unknown> = {},
    overrides: Record<string, unknown> = {},
  ) => ({
    academyId,
    input: {
      studentId: "student-1",
      fromDefinitionKey: "white-belt",
      toDefinitionKey: "white-2nd-stripe",
      promotedOn: "2026-09-10",
      ...input,
    },
    decidedBy: "owner-user-1",
    decidedByStaffId: null,
    decidedByRole: "owner" as const,
    decidedAt,
    ...overrides,
  });
  const withHead = () =>
    seededStore([
      [
        `academies/${academyId}/studentLevelProgress/student-1`,
        head({ importedBaseline: baseline }),
      ],
      ...baselineAttendance,
    ]);

  it("requires a note when the server finds gaps, and writes nothing", async () => {
    const { store, writes } = await withHead();
    await expect(store.assignLevel(assign())).rejects.toMatchObject({
      code: "invalid",
      message: "A note is required when criteria are not met",
    });
    expect(writes).toHaveLength(0);
  });

  it("stores gaps, the note, the criteria at assignment and a restore snapshot", async () => {
    const { store, records, writes } = await withHead();
    const result = await store.assignLevel(assign({ note: "Competition result justifies it." }));
    expect(result).toEqual({
      promotionId: `grad_student-1_white-2nd-stripe_${decidedAt}`,
      toDefinitionKey: "white-2nd-stripe",
      promotedOn: "2026-09-10",
      gaps: ["Skips 1 stripe", "Classes 11/25 not met", "Days 71/75 not met"],
    });
    const promotion = records.get(`academies/${academyId}/levelPromotions/${result.promotionId}`)!;
    expect(promotion).toMatchObject({
      status: "approved",
      decisionStatus: "approved",
      fromDefinitionKey: "white-belt",
      toDefinitionKey: "white-2nd-stripe",
      decidedByRole: "owner",
      decidedByStaffId: null,
      promotedOn: "2026-09-10",
      note: "Competition result justifies it.",
      gaps: ["Skips 1 stripe", "Classes 11/25 not met", "Days 71/75 not met"],
      atAssignment: { classes: { done: 11, min: 25 }, days: { done: 71, min: 75 } },
      restore: {
        currentDefinitionKey: "white-belt",
        currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
        lastApprovedPromotionId: null,
        importedBaseline: baseline,
      },
    });
    const stored = records.get(`academies/${academyId}/studentLevelProgress/student-1`)!;
    expect(stored).toMatchObject({
      currentDefinitionKey: "white-2nd-stripe",
      currentLevelStartedAt: "2026-09-10T00:00:00.000Z",
      lastApprovedPromotionId: result.promotionId,
    });
    expect(stored).not.toHaveProperty("importedBaseline");
    // Task 8's surviving mutant: without this the STUDENT could be recorded as the author of
    // their own promotion and every other assertion here would still pass.
    expect(writes.find((write) => write.path.includes("/auditEvents/"))?.data).toMatchObject({
      actorId: "owner-user-1",
      action: "level.promotion.approved",
      targetRef: `academies/${academyId}/levelPromotions/${result.promotionId}`,
      purpose: "student-level-promotion",
    });
  });

  it("assigns the next level without a note when criteria are met", async () => {
    const { store } = await seededStore([
      [
        `academies/${academyId}/studentLevelProgress/student-1`,
        head({
          currentLevelStartedAt: "2026-06-01T00:00:00.000Z",
          importedBaseline: { ...baseline, classes: 30 },
        }),
      ],
    ]);
    const result = await store.assignLevel(
      assign({ toDefinitionKey: "white-1st-stripe", promotedOn: "2026-09-10" }),
    );
    expect(result.gaps).toEqual([]);
  });

  it("refuses a head coach with a foreign staff id, and writes nothing", async () => {
    const { store, writes } = await withHead();
    await expect(
      store.assignLevel(
        assign(
          { note: "Competition result justifies it." },
          { decidedBy: "head-user-1", decidedByStaffId: "staff-other", decidedByRole: "headCoach" },
        ),
      ),
    ).rejects.toMatchObject({ code: "tenant", message: "Staff scope is invalid" });
    expect(writes).toHaveLength(0);
  });

  // `listPromotionGaps` THROWS a plain Error on a key it cannot find, which would surface as an
  // internal error instead of a refusal. Both keys are resolved against the published catalogue
  // first, so an unknown one is a conflict long before the gap list is built.
  it("refuses an unknown level key as a conflict, never as a raw error", async () => {
    const { store, writes } = await withHead();
    for (const input of [
      { toDefinitionKey: "no-such-level" },
      { fromDefinitionKey: "no-such-level" },
    ]) {
      const rejection = await store
        .assignLevel(assign({ note: "Competition result justifies it.", ...input }))
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(rejection).toMatchObject({
        name: "LevelStoreError",
        code: "conflict",
        message: "Promotion references are not current",
      });
    }
    expect(writes).toHaveLength(0);
  });

  /**
   * Review of Task 9 (Major-3): `until: promotedOn` is what stops a BACKDATED promotion from
   * counting classes trained AFTER the day it names. Without it `atAssignment.classes.done`
   * inflates and a genuine "Classes D/M not met" gap disappears — a real gap going unlisted on the
   * head coach's dialog.
   */
  it("counts no class trained after the promotion day, so a backdated promotion cannot inflate", async () => {
    const beforeThePromotion = [
      attendance("att-early-1", "2026-07-10T18:00:00.000Z"),
      attendance("att-early-2", "2026-08-01T18:00:00.000Z"),
    ];
    // 25 classes trained between the promotion day and the day the head coach records it: enough
    // to close the 25-class minimum on their own if they were counted.
    const afterThePromotion = Array.from({ length: 25 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 7, 16 + index)).toISOString().slice(0, 10);
      return attendance(`att-late-${index}`, `${day}T18:00:00.000Z`);
    });
    const { store, records } = await seededStore([
      [`academies/${academyId}/studentLevelProgress/student-1`, head()],
      ...beforeThePromotion,
      ...afterThePromotion,
    ]);
    const result = await store.assignLevel(
      assign({
        toDefinitionKey: "white-1st-stripe",
        promotedOn: "2026-08-15",
        note: "Competition result justifies it.",
      }),
    );
    expect(result.gaps).toEqual(["Classes 2/25 not met", "Days 45/75 not met"]);
    expect(
      records.get(`academies/${academyId}/levelPromotions/${result.promotionId}`)?.atAssignment,
    ).toEqual({ classes: { done: 2, min: 25 }, days: { done: 45, min: 75 } });
  });

  // The head must belong to the catalogue that is published now: a head still on `ibjjf-v1` would
  // otherwise be promoted against a published `ibjjf-v2`, whose sequence means something else.
  it("refuses a head whose level system is not the published one, and writes nothing", async () => {
    const { store, writes } = await seededStore([
      [`academies/${academyId}/studentLevelProgress/student-1`, head({ systemId: "ibjjf-v2" })],
    ]);
    await expect(
      store.assignLevel(assign({ note: "Competition result justifies it." })),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "Promotion references are not current",
    });
    expect(writes).toHaveLength(0);
  });

  it("refuses a head that is not initialized, and writes nothing", async () => {
    const { store, writes } = await seededStore([
      [`academies/${academyId}/studentLevelProgress/student-1`, head({ state: "suspended" })],
    ]);
    await expect(
      store.assignLevel(assign({ note: "Competition result justifies it." })),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "Promotion references are not current",
    });
    expect(writes).toHaveLength(0);
  });

  it("refuses an inactive student, and writes nothing", async () => {
    const { store, writes, records } = await withHead();
    const path = `academies/${academyId}/students/student-1`;
    records.set(path, { ...records.get(path)!, active: false });
    await expect(
      store.assignLevel(assign({ note: "Competition result justifies it." })),
    ).rejects.toMatchObject({ code: "conflict", message: "Student is not active" });
    expect(writes).toHaveLength(0);
  });
});

/**
 * T051V2 Task 10 (plan decision 2): a void is append-only. The original promotion document is
 * never touched, the head goes back to the promotion's own `restore` snapshot, and only the
 * promotion the head names can be voided. The audit row, the untouched document and the "no write
 * at all" guarantees are Firestore concerns and are asserted here; the behavioural rules are
 * asserted against BOTH stores in the parity block above.
 */
describe("voidPromotion and getStudentLevelHistory (T051V2)", () => {
  const promotionPath = (promotionId: string) =>
    `academies/${academyId}/levelPromotions/${promotionId}`;
  const headPath = `academies/${academyId}/studentLevelProgress/student-1`;

  async function assigned() {
    const seeded = await seededStore([
      [headPath, head({ importedBaseline: baseline })],
      ...baselineAttendance,
    ]);
    const result = await seeded.store.assignLevel({
      academyId,
      input: {
        studentId: "student-1",
        fromDefinitionKey: "white-belt",
        toDefinitionKey: "white-2nd-stripe",
        promotedOn: "2026-09-10",
        note: assignmentNote,
      },
      decidedBy: "owner-user-1",
      decidedByStaffId: null,
      decidedByRole: "owner",
      decidedAt,
    });
    seeded.writes.length = 0;
    return { ...seeded, promotionId: result.promotionId };
  }

  const voidInput = (promotionId: string, overrides: Record<string, unknown> = {}) => ({
    academyId,
    input: { studentId: "student-1", promotionId, reason: voidReason },
    decidedBy: "head-user-1",
    decidedByStaffId: "staff-head-1",
    decidedByRole: "headCoach" as const,
    decidedAt: voidAt,
    ...overrides,
  });

  it("appends a void record, restores the previous head exactly and audits the actor", async () => {
    const { store, records, writes, promotionId } = await assigned();
    const promotionBefore = structuredClone(records.get(promotionPath(promotionId)));
    const result = await store.voidPromotion(voidInput(promotionId));
    expect(result).toEqual({
      voidId: `void_${promotionId}`,
      voidsPromotionId: promotionId,
      restoredDefinitionKey: "white-belt",
    });
    // Append-only: the promotion that was voided is byte-for-byte what it was.
    expect(records.get(promotionPath(promotionId))).toEqual(promotionBefore);
    expect(records.get(promotionPath(`void_${promotionId}`))).toMatchObject({
      promotionId: `void_${promotionId}`,
      kind: "void",
      academyId,
      studentId: "student-1",
      voidsPromotionId: promotionId,
      reason: voidReason,
      decidedBy: "head-user-1",
      decidedByRole: "headCoach",
      decidedByStaffId: "staff-head-1",
      decidedAt: voidAt,
    });
    // The head is the head the promotion replaced, including the baseline the promotion dropped.
    expect(records.get(headPath)).toEqual({
      ...head({ importedBaseline: baseline }),
      updatedAt: voidAt,
      updatedBy: "head-user-1",
    });
    const audit = writes.find((write) => write.path.includes("/auditEvents/"))?.data;
    expect(audit).toMatchObject({
      action: "level.promotion.voided",
      // Task 8's surviving mutant: without this the student could be recorded as the author of a
      // decision about their own belt while every other assertion still passed.
      actorId: "head-user-1",
      targetRef: promotionPath(`void_${promotionId}`),
      purpose: "student-level-promotion",
    });
  });

  /**
   * A promotion written before `5b67c1b` carries no `restore` key at all. Deliberate ruling: it is
   * NOT voidable. Restoring it would mean guessing the level the student came from, the instant
   * that level started and the imported baseline the promotion dropped — silent, wrong edits to a
   * real person's belt record. The operator is refused and the record stays as it is.
   */
  it("refuses to void a promotion written before restore snapshots existed, and writes nothing", async () => {
    const { store, records, writes, promotionId } = await assigned();
    const stored = { ...records.get(promotionPath(promotionId))! };
    delete stored.restore;
    records.set(promotionPath(promotionId), stored);
    await expect(store.voidPromotion(voidInput(promotionId))).rejects.toMatchObject({
      code: "conflict",
      message: "Promotion cannot be voided",
    });
    expect(writes).toHaveLength(0);
    expect(records.get(headPath)?.currentDefinitionKey).toBe("white-2nd-stripe");
  });

  // Grill G10, carried from Task 7's review (m2): a stored baseline that does not parse refuses
  // the operation itself, never silently restores a zero.
  it("refuses a void whose restored baseline is corrupt, and writes nothing", async () => {
    const { store, records, writes, promotionId } = await assigned();
    const stored = records.get(promotionPath(promotionId))!;
    records.set(promotionPath(promotionId), {
      ...stored,
      restore: {
        ...(stored.restore as Record<string, unknown>),
        importedBaseline: { classes: -1, cutoff: "yesterday" },
      },
    });
    await expect(store.voidPromotion(voidInput(promotionId))).rejects.toMatchObject({
      code: "tenant",
      message: "Imported baseline is invalid",
    });
    expect(writes).toHaveLength(0);
  });

  /**
   * Review Major-5: the four refusals are ONE user-facing string on purpose — a caller must not
   * learn which promotions exist — which left support with nothing when an operator reports "it
   * will not let me undo this". `console.error` is the logging facility this repo already uses
   * inside Cloud Functions (`schedule-callables.ts`). Nothing restricted (ADR-009 rule 14) is
   * named, and the reason the operator typed is NOT logged.
   */
  describe("refusal causes (T051V2)", () => {
    afterEach(() => void vi.restoreAllMocks());

    async function refusal(
      prepare: (records: Stored, promotionId: string) => void,
      promotionIdOf: (promotionId: string) => string = (promotionId) => promotionId,
    ) {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { store, records, writes, promotionId } = await assigned();
      prepare(records, promotionId);
      logged.mockClear();
      await expect(
        store.voidPromotion(voidInput(promotionIdOf(promotionId))),
      ).rejects.toMatchObject({ code: "conflict", message: "Promotion cannot be voided" });
      expect(writes).toHaveLength(0);
      expect(logged).toHaveBeenCalledTimes(1);
      return logged.mock.calls[0];
    }

    const line = (cause: string, promotionId: string) => [
      "level.promotion.void refused",
      { cause, academyId, studentId: "student-1", promotionId },
    ];

    it("logs no-such-promotion for a promotion this student does not have", async () => {
      const unknownId = "grad_student-1_white-1st-stripe_2026-08-01T00:00:00.000Z";
      expect(
        await refusal(
          () => undefined,
          () => unknownId,
        ),
      ).toEqual(line("no-such-promotion", unknownId));
    });

    /**
     * M21: a void is a record in the same collection, so "a void cannot itself be voided" is a
     * real clause. It is only reachable through a corrupted row — a void row carrying
     * `status: "approved"` that the head names — because a void this code writes has no status at
     * all and is refused one clause earlier.
     */
    it("logs no-such-promotion for a record that is itself a void", async () => {
      expect(
        await refusal((records, promotionId) => {
          records.set(promotionPath(promotionId), {
            ...records.get(promotionPath(promotionId))!,
            kind: "void",
          });
        }),
      ).toEqual(
        line("no-such-promotion", "grad_student-1_white-2nd-stripe_2026-09-10T12:00:00.000Z"),
      );
    });

    /**
     * The already-voided clause is unreachable by the normal path — once a void lands the head no
     * longer names that promotion — so it takes a head that still names an already-voided
     * promotion to reach it. Without the clause this would append a SECOND void over the first.
     */
    it("logs already-voided for a head that still names a voided promotion", async () => {
      expect(
        await refusal((records, promotionId) => {
          records.set(promotionPath(`void_${promotionId}`), storedVoid(promotionId));
        }),
      ).toEqual(line("already-voided", "grad_student-1_white-2nd-stripe_2026-09-10T12:00:00.000Z"));
    });

    it("logs not-latest for a promotion the head no longer names", async () => {
      expect(
        await refusal((records) => {
          records.set(headPath, {
            ...records.get(headPath)!,
            lastApprovedPromotionId: "some-later-promotion",
          });
        }),
      ).toEqual(line("not-latest", "grad_student-1_white-2nd-stripe_2026-09-10T12:00:00.000Z"));
    });

    /**
     * M3d and M22: every field of the restore snapshot is load-bearing. A promotion written before
     * `5b67c1b` carries no `restore` at all and is deliberately NOT voidable; so is one whose
     * snapshot cannot be read, because restoring it would mean GUESSING a real person's belt, the
     * instant that level started, or which promotion came before it.
     */
    it.each([
      ["with no restore snapshot at all", undefined],
      ["whose restored level key is not a string", { currentDefinitionKey: 7 }],
      ["whose restored level start is not a string", { currentLevelStartedAt: 7 }],
      ["whose restored previous promotion id is not a string", { lastApprovedPromotionId: 7 }],
    ])("logs no-restore for a promotion %s", async (_label, corruption) => {
      expect(
        await refusal((records, promotionId) => {
          const stored = { ...records.get(promotionPath(promotionId))! };
          if (corruption === undefined) delete stored.restore;
          else stored.restore = { ...(stored.restore as Record<string, unknown>), ...corruption };
          records.set(promotionPath(promotionId), stored);
        }),
      ).toEqual(line("no-restore", "grad_student-1_white-2nd-stripe_2026-09-10T12:00:00.000Z"));
    });
  });

  it("lists the promotion and the opening newest first, and hides voids from listGraduations", async () => {
    const { store, promotionId } = await assigned();
    await store.voidPromotion(voidInput(promotionId));
    expect(await store.getStudentLevelHistory(academyId, "student-1")).toEqual({
      studentId: "student-1",
      currentDefinitionKey: "white-belt",
      // The one promotion was voided, so the head names none and the reader offers no Void.
      lastApprovedPromotionId: null,
      entries: [
        {
          entryId: promotionId,
          kind: "promotion",
          definitionKey: "white-2nd-stripe",
          fromDefinitionKey: "white-belt",
          assignedOn: "2026-09-10",
          classes: { done: 11, min: 25 },
          days: { done: 71, min: 75 },
          decidedByRole: "owner",
          source: "bpt",
          note: assignmentNote,
          gaps: ["Skips 1 stripe", "Classes 11/25 not met", "Days 71/75 not met"],
          voided: { reason: voidReason, voidedByRole: "headCoach", voidedOn: "2026-09-11" },
        },
        {
          entryId: "opening_student-1",
          kind: "opening",
          definitionKey: "white-belt",
          fromDefinitionKey: null,
          assignedOn: "2026-07-01",
          classes: null,
          days: null,
          decidedByRole: "headCoach",
          source: "bpt",
          note: "Synthetic opening note.",
          gaps: [],
          voided: null,
        },
      ],
    });
    const graduations = await store.listGraduations(academyId, "student-1");
    expect(graduations.map((graduation) => graduation.graduationId)).toEqual([promotionId]);
  });

  /**
   * Carried from Task 6/9: an assignment with no note stores `decisionNotes: ""` and `note: null`,
   * and a stored note that is only whitespace must not render as a note that exists.
   */
  it.each([
    ["absent", {}],
    ["empty", { decisionNotes: "" }],
    ["whitespace only", { decisionNotes: "   \n\t  " }],
    // Major-2 again, on the note: a stored note the read schema cannot take degrades to "no
    // note"; it never deletes the promotion it belongs to.
    ["longer than the read schema takes", { decisionNotes: "w".repeat(1001) }],
  ])("reads a %s note as null", async (_label, overrides) => {
    const { store, records, promotionId } = await assigned();
    const stored = { ...records.get(promotionPath(promotionId))! };
    delete stored.note;
    delete stored.decisionNotes;
    records.set(promotionPath(promotionId), { ...stored, ...overrides });
    const history = await store.getStudentLevelHistory(academyId, "student-1");
    expect(history.entries[0]).toMatchObject({ entryId: promotionId, note: null });
  });

  /** A void row written straight into the store, so each of its fields can be corrupted on its own. */
  const storedVoid = (promotionId: string, overrides: Record<string, unknown> = {}) => ({
    promotionId: `void_${promotionId}`,
    kind: "void",
    academyId,
    studentId: "student-1",
    voidsPromotionId: promotionId,
    reason: voidReason,
    decidedBy: "head-user-1",
    decidedByRole: "headCoach",
    decidedByStaffId: "staff-head-1",
    decidedAt: voidAt,
    createdAt: voidAt,
    ...overrides,
  });

  /**
   * `levelHistoryEntrySchema` is a read schema over stored data. One unreadable row must not take
   * the whole history down, so a row that cannot be parsed is left out and everything else is
   * still shown.
   *
   * Review Major-3: these three fields used to be coerced with `String(...)` INSIDE the per-row
   * parse, so a promotion with no `toDefinitionKey` became the string `"undefined"` —
   * `identifierSchema` accepts it — and the member was shown promoted to a belt called `undefined`,
   * row present and standing. The row must fail instead.
   */
  it.each([["toDefinitionKey"], ["fromDefinitionKey"]])(
    "drops a promotion row with no %s instead of showing a belt called `undefined`",
    async (field) => {
      const { store, records, promotionId } = await assigned();
      const stored = { ...records.get(promotionPath(promotionId))! };
      delete stored[field];
      records.set(promotionPath(promotionId), stored);
      const history = await store.getStudentLevelHistory(academyId, "student-1");
      expect(history.entries.map((entry) => entry.entryId)).toEqual(["opening_student-1"]);
      expect(history.entries.map((entry) => entry.definitionKey)).not.toContain("undefined");
    },
  );

  /**
   * Review Major-2, RULING: a void record that EXISTS always marks its promotion voided.
   * Unreadable sub-fields of the void degrade to `null` — "not recorded" — and the row survives.
   * Every one of these five corruptions used to delete the promotion from the history: showing a
   * cancelled promotion as if it still stood is a lie the operator can see and challenge; omitting
   * it is a lie the operator cannot see at all, and it destroys the evidence the append-only
   * design exists to preserve. Nothing is ever fabricated to fill a gap.
   */
  it.each([
    ["an unreadable author role", { decidedByRole: "coach" }, { voidedByRole: null }],
    // A row written BEFORE Major-1's guard existed: shorter than the write-side minimum of 10.
    // The guard stops new ones; it cannot un-write the ones already stored, and those must render.
    ["a reason shorter than the write-side minimum", { reason: "oops" }, { reason: "oops" }],
    ["a reason that is not a string", { reason: 42 }, { reason: null }],
    ["a reason longer than the read schema takes", { reason: "w".repeat(1001) }, { reason: null }],
    [
      "a reason carrying a control character",
      { reason: `Wrong member${String.fromCharCode(7)} entirely.` },
      { reason: null },
    ],
    ["no readable decidedAt (falls back to createdAt)", { decidedAt: null }, {}],
    [
      "no readable decidedAt and no readable createdAt",
      { decidedAt: null, createdAt: null },
      { voidedOn: null },
    ],
  ])("still marks the promotion voided when the void has %s", async (_label, corruption, shown) => {
    const { store, records, promotionId } = await assigned();
    records.set(promotionPath(`void_${promotionId}`), storedVoid(promotionId, corruption));
    const history = await store.getStudentLevelHistory(academyId, "student-1");
    expect(history.entries.map((entry) => entry.entryId)).toEqual([
      promotionId,
      "opening_student-1",
    ]);
    expect(history.entries[0]?.voided).toEqual({
      reason: voidReason,
      voidedByRole: "headCoach",
      voidedOn: "2026-09-11",
      ...shown,
    });
  });

  /**
   * T051V2 Task 19, closing Task 13's Minor-1. The `kind !== "void"` half of the row filter
   * survived removal: the `void_<id>` document the shipped `voidPromotion` writes carries no
   * `status`, so `status === "approved"` already excluded it and the clause the code credited was
   * doing nothing. A void document that ALSO carries the voided promotion's own fields — the
   * shape a future writer that snapshots the promotion onto its void would produce, exactly as
   * `restore` already snapshots one — would otherwise parse cleanly and show the member standing
   * at the belt that was just cancelled, a second time.
   */
  it("keeps a void record out of the rows even when it looks like an approved promotion", async () => {
    const { store, records, promotionId } = await assigned();
    const promotion = records.get(promotionPath(promotionId))!;
    records.set(promotionPath(`void_${promotionId}`), {
      ...promotion,
      ...storedVoid(promotionId),
      status: "approved",
    });
    const history = await store.getStudentLevelHistory(academyId, "student-1");
    expect(history.entries.map((entry) => entry.entryId)).toEqual([
      promotionId,
      "opening_student-1",
    ]);
  });

  /**
   * Review Major-4: `rejectPromotion` writes `status: "rejected"` into this very collection. The
   * `status === "approved"` filter is what keeps a REFUSED promotion out of the member's history;
   * without it the member would be shown standing at a belt they were refused.
   */
  it("never shows a rejected promotion as a standing one", async () => {
    const { store, promotionId } = await assigned();
    await store.rejectPromotion({
      academyId,
      input: {
        studentId: "student-1",
        targetDefinitionKey: "white-3rd-stripe",
        decisionNotes: "Not ready for the third stripe yet.",
      },
      decidedBy: "head-user-1",
      decidedByStaffId: "staff-head-1",
      decidedByRole: "headCoach",
      decidedAt: "2026-09-12T12:00:00.000Z",
    });
    const history = await store.getStudentLevelHistory(academyId, "student-1");
    expect(history.entries.map((entry) => [entry.entryId, entry.definitionKey])).toEqual([
      [promotionId, "white-2nd-stripe"],
      ["opening_student-1", "white-belt"],
    ]);
  });

  /** M12: the sort itself, not only its direction — unsorted, these come back oldest first. */
  it("orders three entries newest first, the opening last on a shared day", async () => {
    const { store } = await seededStore([
      [headPath, head()],
      rawPromotion("older-promotion", "white-1st-stripe", "2026-07-01") as never,
      rawPromotion("newer-promotion", "white-2nd-stripe", "2026-09-10") as never,
    ]);
    const history = await store.getStudentLevelHistory(academyId, "student-1");
    expect(history.entries.map((entry) => entry.entryId)).toEqual([
      "newer-promotion",
      "older-promotion",
      "opening_student-1",
    ]);
  });

  /**
   * T051V2 review of Task 16 (Critical-1). The reader must carry the head's OWN id, never a guess
   * derived from the row order. Here the promotion the head names is the OLDER one by date, which
   * is the shape Plan D's Regyfit import leaves behind — it writes promotions straight into the
   * collection with whatever dates the source carries — and exactly the shape that put the Manage
   * view's Void button on a row the server refuses. It is reachable only by seeding rows, because
   * `assignLevel` keeps `assignedOn` non-decreasing along the standing chain; that is why this,
   * and not the parity test above, is the test that dies when the head is replaced by a guess.
   */
  it("carries the id the head names even when an older row is the one it names", async () => {
    const seed = (lastApprovedPromotionId: unknown) =>
      seededStore([
        [headPath, head({ lastApprovedPromotionId })],
        rawPromotion("older-promotion", "white-1st-stripe", "2026-07-01") as never,
        rawPromotion("newer-promotion", "white-2nd-stripe", "2026-09-10") as never,
      ]);
    const named = await (
      await seed("older-promotion")
    ).store.getStudentLevelHistory(academyId, "student-1");
    expect(named.entries.map((entry) => entry.entryId)).toEqual([
      "newer-promotion",
      "older-promotion",
      "opening_student-1",
    ]);
    expect(named.lastApprovedPromotionId).toBe("older-promotion");
    // A head naming a record that is not on screen, or naming nothing readable, can offer the
    // operator no action at all — and must not take the rest of the history down with it.
    for (const stored of ["no-such-promotion", 7, null, "not an id"]) {
      const history = await (
        await seed(stored)
      ).store.getStudentLevelHistory(academyId, "student-1");
      expect(history.lastApprovedPromotionId).toBeNull();
      expect(history.entries).toHaveLength(3);
    }
  });

  /** M29: an imported opening names no author and says where it came from. */
  it("reads an imported opening as imported, with no author role", async () => {
    const { store } = await seededStore([[headPath, head({ source: "regyfit-import" })]]);
    const history = await store.getStudentLevelHistory(academyId, "student-1");
    expect(history.entries[0]).toMatchObject({
      entryId: "opening_student-1",
      source: "regyfit-import",
      decidedByRole: null,
    });
  });

  it("returns an empty history for a student without a level", async () => {
    const { store } = await seededStore();
    expect(await store.getStudentLevelHistory(academyId, "student-1")).toEqual({
      studentId: "student-1",
      currentDefinitionKey: null,
      lastApprovedPromotionId: null,
      entries: [],
    });
  });

  it("refuses a history read for a student who does not exist", async () => {
    const { store } = await seededStore();
    await expect(store.getStudentLevelHistory(academyId, "student-9")).rejects.toMatchObject({
      code: "not-found",
      message: "Student is not available",
    });
  });
});

/**
 * T051V2 Task 11 (plan decision 3): the Manage view has no session, so a batch of ratings is
 * recorded through its own store method that writes one `assessments` document per rating with
 * `sessionId: null`, all inside ONE transaction. Coach, head coach and owner may rate (G6);
 * everybody else is refused, and every refusal here is pinned by MESSAGE because
 * `assertTransactionalActor` also throws `tenant` and a code-only assertion passes for the wrong
 * reason (Tasks 8, 9 and 10 each reproduced that).
 */
type RatingParams = Parameters<AnyLevelStore["recordSkillRatings"]>[0];

// The cast is deliberate and WIDENS THE WHOLE INPUT OBJECT, not just one field: half of these
// cases send ids, scores, notes and arrays the contract refuses on purpose, which is the point of
// the block. The price is that a new required field on `RecordSkillRatingsInput` would not break
// these tests — everything the cast permits is refused at runtime by design, and the store now
// parses the whole input with `recordSkillRatingsInputSchema`. Everything outside the input (the
// actor, the role, the instant) stays type-checked.
const ratingsInput = (input: Record<string, unknown> = {}) =>
  ({
    studentId: "student-1",
    definitionKey: "white-belt",
    ratings: [
      { skillKey: "tie-the-belt", score: 3 },
      { skillKey: "warm-up-2-bridges", score: 4 },
    ],
    ...input,
  }) as unknown as RatingParams["input"];

const rate = (overrides: Record<string, unknown> = {}, input: Record<string, unknown> = {}) => ({
  academyId,
  input: ratingsInput(input),
  evaluatorId: "coach-user-1",
  evaluatorStaffId: "staff-coach-1",
  evaluatorRole: "coach" as const,
  evaluatedAt: decidedAt,
  ...overrides,
});

const ownerRates = {
  evaluatorId: "owner-user-1",
  evaluatorStaffId: null,
  evaluatorRole: "owner" as const,
};
const headCoachRates = {
  evaluatorId: "head-user-1",
  evaluatorStaffId: "staff-head-1",
  evaluatorRole: "headCoach" as const,
};

/** Bad operator free text: empty, whitespace-only, a NUL byte, DEL, and one character too long. */
const invalidEvidenceNotes: readonly [string, unknown][] = [
  ["an empty note", ""],
  ["a whitespace-only note", "   \n  "],
  ["a note carrying a NUL byte", `Solid guard${String.fromCharCode(0)} work`],
  ["a note carrying DEL", `Solid guard${String.fromCharCode(127)} work`],
  ["a 1001-character note", "a".repeat(1001)],
  ["a non-string note", 42],
  ["a null note", null],
];

/** Bad rating arrays: the bounds and the distinctness rule the contract states. */
const invalidRatings: readonly [string, unknown][] = [
  ["no ratings at all", []],
  [
    "101 ratings",
    Array.from({ length: 101 }, (_, index) => ({ skillKey: `skill-${index}`, score: 3 })),
  ],
  [
    "the same skill twice",
    [
      { skillKey: "tie-the-belt", score: 3 },
      { skillKey: "tie-the-belt", score: 5 },
    ],
  ],
  ["a score of 6", [{ skillKey: "tie-the-belt", score: 6 }]],
  ["a score of 0", [{ skillKey: "tie-the-belt", score: 0 }]],
  ["a fractional score", [{ skillKey: "tie-the-belt", score: 2.5 }]],
  ["a missing score", [{ skillKey: "tie-the-belt" }]],
  ["ratings that are not an array", { skillKey: "tie-the-belt", score: 3 }],
];

describe("recordSkillRatings (T051V2)", () => {
  it("writes one assessment and one audit per rating without a session", async () => {
    const { store, writes } = await seededStore();
    expect(await store.recordSkillRatings(rate())).toEqual({ studentId: "student-1", recorded: 2 });

    const assessments = writes.filter((write) => write.path.includes("/assessments/"));
    expect(assessments.map((write) => write.data)).toEqual([
      expect.objectContaining({
        studentId: "student-1",
        definitionKey: "white-belt",
        skillKey: "tie-the-belt",
        score: 3,
        sessionId: null,
        evaluatorId: "coach-user-1",
        evaluatorRole: "coach",
        coachStaffId: "staff-coach-1",
        evidenceNotes: "",
        evaluatedAt: decidedAt,
        status: "recorded",
      }),
      expect.objectContaining({ skillKey: "warm-up-2-bridges", score: 4, sessionId: null }),
    ]);
    expect(assessments.every((write) => write.op === "create")).toBe(true);

    // Task 8's surviving mutant: without pinning `actorId` the STUDENT could be recorded as the
    // author of their own assessment and every other assertion here would still pass.
    const audits = writes.filter((write) => write.path.includes("/auditEvents/"));
    expect(audits).toHaveLength(2);
    expect(audits.map((write) => write.data)).toEqual([
      expect.objectContaining({
        actorId: "coach-user-1",
        action: "level.assessment.recorded",
        targetRef: `academies/${academyId}/assessments/eval_student-1_tie-the-belt_${decidedAt}`,
        purpose: "student-development-assessment",
      }),
      expect.objectContaining({
        actorId: "coach-user-1",
        action: "level.assessment.recorded",
        targetRef: `academies/${academyId}/assessments/eval_student-1_warm-up-2-bridges_${decidedAt}`,
        purpose: "student-development-assessment",
      }),
    ]);
    expect(audits.some((write) => write.data.actorId === "student-1")).toBe(false);

    const summary = await store.getStudentSkillSummary(academyId, "student-1");
    expect(summary["warm-up-2-bridges"]).toMatchObject({ latestScore: 4, maxScore: 4, count: 1 });
    expect(summary["tie-the-belt"]).toMatchObject({ latestScore: 3, maxScore: 3, count: 1 });
  });

  it("stores a trimmed evidence note against every rating in the batch", async () => {
    const { store, writes } = await seededStore();
    await store.recordSkillRatings(rate({}, { evidenceNotes: "  Graded in the Tuesday class.  " }));
    expect(
      writes
        .filter((write) => write.path.includes("/assessments/"))
        .map((write) => write.data.evidenceNotes),
    ).toEqual(["Graded in the Tuesday class.", "Graded in the Tuesday class."]);
  });

  it("lets the owner rate with no staff record and the head coach rate with one", async () => {
    const owner = await seededStore();
    expect(await owner.store.recordSkillRatings(rate(ownerRates))).toEqual({
      studentId: "student-1",
      recorded: 2,
    });
    expect(
      owner.writes
        .filter((write) => write.path.includes("/assessments/"))
        .map((write) => [
          write.data.evaluatorRole,
          write.data.coachStaffId,
          write.data.evaluatorId,
        ]),
    ).toEqual([
      ["owner", null, "owner-user-1"],
      ["owner", null, "owner-user-1"],
    ]);

    const headCoach = await seededStore();
    expect(await headCoach.store.recordSkillRatings(rate(headCoachRates))).toEqual({
      studentId: "student-1",
      recorded: 2,
    });
    expect(
      headCoach.writes
        .filter((write) => write.path.includes("/assessments/"))
        .map((write) => write.data.evaluatorRole),
    ).toEqual(["headCoach", "headCoach"]);
  });

  it.each(["administrator", "guardian", "student", "owner "])(
    "refuses the role %s by message and writes nothing",
    async (role) => {
      const { store, writes } = await seededStore();
      await expect(
        store.recordSkillRatings(rate({ evaluatorRole: role as never })),
      ).rejects.toMatchObject({ code: "tenant", message: "Assessment actor role is invalid" });
      expect(writes).toHaveLength(0);
    },
  );

  it("refuses a coach carrying somebody else's staff id, and the student themselves", async () => {
    const { store, writes } = await seededStore();
    await expect(
      store.recordSkillRatings(rate({ evaluatorStaffId: "staff-head-1" })),
    ).rejects.toMatchObject({ code: "tenant", message: "Staff scope is invalid" });
    await expect(
      store.recordSkillRatings(rate({ evaluatorId: "student-1", evaluatorStaffId: null })),
    ).rejects.toMatchObject({ code: "tenant", message: "Actor scope is invalid" });
    expect(writes).toHaveLength(0);
  });

  it.each(invalidEvidenceNotes)("refuses %s, and writes nothing", async (_label, evidenceNotes) => {
    const { store, writes } = await seededStore();
    await expect(store.recordSkillRatings(rate({}, { evidenceNotes }))).rejects.toMatchObject({
      code: "invalid",
      message: "Assessment evidence notes are invalid",
    });
    expect(writes).toHaveLength(0);
  });

  it.each(invalidRatings)("refuses %s, and writes nothing", async (_label, ratings) => {
    const { store, writes } = await seededStore();
    await expect(store.recordSkillRatings(rate({}, { ratings }))).rejects.toMatchObject({
      code: "invalid",
      message: "Skill ratings are invalid",
    });
    expect(writes).toHaveLength(0);
  });

  it("refuses a skill that is not in the published catalogue, and writes nothing", async () => {
    const { store, writes } = await seededStore();
    await expect(
      store.recordSkillRatings(
        rate(
          {},
          {
            ratings: [
              { skillKey: "tie-the-belt", score: 3 },
              { skillKey: "not-in-catalogue", score: 2 },
            ],
          },
        ),
      ),
    ).rejects.toMatchObject({ code: "conflict", message: "Assessment catalog is not current" });
    expect(writes).toHaveLength(0);
  });

  it("refuses an unknown definition key, and writes nothing", async () => {
    const { store, writes } = await seededStore();
    await expect(
      store.recordSkillRatings(rate({}, { definitionKey: "no-such-level" })),
    ).rejects.toMatchObject({ code: "conflict", message: "Assessment references are not current" });
    expect(writes).toHaveLength(0);
  });

  it("refuses a system that is no longer published, and writes nothing", async () => {
    const { store, writes, records } = await seededStore();
    const path = `academies/${academyId}/levelSystems/ibjjf-v1`;
    records.set(path, { ...records.get(path)!, status: "draft" });
    await expect(store.recordSkillRatings(rate())).rejects.toMatchObject({
      code: "conflict",
      message: "Assessment catalog is not current",
    });
    expect(writes).toHaveLength(0);
  });

  /**
   * Review of Task 11 (Major-1): four clauses of this method guarded a catalogue document whose
   * own stored scope disagrees with the path it was read from, and NO test killed any of them —
   * an intention, not a rule (LECCIONES §5). They are kept rather than deleted, because none of
   * them is unreachable: the path says which document is read, never that the document agrees
   * with it, and a corrupt or half-migrated catalogue record must fail closed instead of
   * recording a child's rating against another academy or another catalogue version. Each tamper
   * below is refused today and is ACCEPTED with its clause removed.
   */
  it("refuses a definition stamped with another academy, and writes nothing", async () => {
    const { store, writes, records } = await seededStore();
    const path = `academies/${academyId}/levelDefinitions/white-belt`;
    records.set(path, { ...records.get(path)!, academyId: "academy-2" });
    await expect(store.recordSkillRatings(rate())).rejects.toMatchObject({
      code: "conflict",
      message: "Assessment references are not current",
    });
    expect(writes).toHaveLength(0);
  });

  it("refuses a definition whose key does not match its own document, and writes nothing", async () => {
    const { store, writes, records } = await seededStore();
    const path = `academies/${academyId}/levelDefinitions/white-belt`;
    records.set(path, { ...records.get(path)!, definitionKey: "blue-belt" });
    await expect(store.recordSkillRatings(rate())).rejects.toMatchObject({
      code: "conflict",
      message: "Assessment references are not current",
    });
    expect(writes).toHaveLength(0);
  });

  it("refuses a system stamped with another academy, and writes nothing", async () => {
    const { store, writes, records } = await seededStore();
    const path = `academies/${academyId}/levelSystems/ibjjf-v1`;
    records.set(path, { ...records.get(path)!, academyId: "academy-2" });
    await expect(store.recordSkillRatings(rate())).rejects.toMatchObject({
      code: "conflict",
      message: "Assessment catalog is not current",
    });
    expect(writes).toHaveLength(0);
  });

  it("refuses a system whose id does not match the definition's, and writes nothing", async () => {
    const { store, writes, records } = await seededStore();
    const path = `academies/${academyId}/levelSystems/ibjjf-v1`;
    records.set(path, { ...records.get(path)!, systemId: "ibjjf-v2" });
    await expect(store.recordSkillRatings(rate())).rejects.toMatchObject({
      code: "conflict",
      message: "Assessment catalog is not current",
    });
    expect(writes).toHaveLength(0);
  });

  it("refuses an inactive student, and writes nothing", async () => {
    const { store, writes, records } = await seededStore();
    const path = `academies/${academyId}/students/student-1`;
    records.set(path, { ...records.get(path)!, active: false, status: "inactive" });
    await expect(store.recordSkillRatings(rate())).rejects.toMatchObject({
      code: "conflict",
      message: "Student is not active",
    });
    expect(writes).toHaveLength(0);
  });

  // The batch is atomic: the second rating already exists at this instant, so the FIRST one must
  // not be written either. Without one transaction the member would end up half assessed.
  it("writes nothing at all when one rating in the batch is a replay", async () => {
    const { store, writes } = await seededStore();
    await store.recordSkillRatings(
      rate({}, { ratings: [{ skillKey: "warm-up-2-bridges", score: 2 }] }),
    );
    writes.length = 0;
    await expect(store.recordSkillRatings(rate())).rejects.toMatchObject({
      code: "conflict",
      message: "Assessment catalog is not current",
    });
    expect(writes).toHaveLength(0);
    const summary = await store.getStudentSkillSummary(academyId, "student-1");
    expect(summary["tie-the-belt"]).toBeUndefined();
    expect(summary["warm-up-2-bridges"]).toMatchObject({ latestScore: 2, count: 1 });
  });
});

/**
 * Parity: both stores must refuse the same things for the same reasons. Identity, published-system
 * and head-state cases are NOT here — the in-memory store has no `assertTransactionalActor`, so
 * they would pass there for no reason at all (Task 8 carry 4, Task 9 carry 5).
 */
describe.each(openParityStores)("skill-ratings parity — %s (T051V2)", (_label, makeStore) => {
  it("records both ratings against a session-less assessment", async () => {
    const store = await makeStore();
    expect(await store.recordSkillRatings(rate())).toEqual({ studentId: "student-1", recorded: 2 });
    const evaluations = await store.listStudentEvaluations(academyId, "student-1");
    expect(
      [...evaluations]
        .sort((left, right) => left.skillKey.localeCompare(right.skillKey))
        .map((evaluation) => [evaluation.skillKey, evaluation.score, evaluation.sessionId]),
    ).toEqual([
      ["tie-the-belt", 3, null],
      ["warm-up-2-bridges", 4, null],
    ]);
    expect(evaluations.every((evaluation) => evaluation.evaluatorRole === "coach")).toBe(true);
    const summary = await store.getStudentSkillSummary(academyId, "student-1");
    expect(summary["tie-the-belt"]).toMatchObject({ latestScore: 3, maxScore: 3 });
  });

  it("stores the trimmed evidence note on every record", async () => {
    const store = await makeStore();
    await store.recordSkillRatings(rate({}, { evidenceNotes: "  Graded in the Tuesday class.  " }));
    const evaluations = await store.listStudentEvaluations(academyId, "student-1");
    expect(evaluations.map((evaluation) => evaluation.evidenceNotes)).toEqual([
      "Graded in the Tuesday class.",
      "Graded in the Tuesday class.",
    ]);
  });

  // A replayed batch is refused whole: the second call must not append a duplicate record, or the
  // same session-less assessment would count twice in the skill summary.
  it("refuses a replayed batch and leaves one record per skill", async () => {
    const store = await makeStore();
    await store.recordSkillRatings(rate());
    await expect(store.recordSkillRatings(rate())).rejects.toMatchObject({
      code: "conflict",
      message: "Assessment catalog is not current",
    });
    expect(await store.listStudentEvaluations(academyId, "student-1")).toHaveLength(2);
  });

  it("keeps the owner's own role on the record", async () => {
    const store = await makeStore();
    await store.recordSkillRatings(rate(ownerRates));
    const evaluations = await store.listStudentEvaluations(academyId, "student-1");
    expect(evaluations.every((evaluation) => evaluation.evaluatorRole === "owner")).toBe(true);
  });

  it("refuses the administrator by message", async () => {
    const store = await makeStore();
    await expect(
      store.recordSkillRatings(rate({ evaluatorRole: "administrator" as never })),
    ).rejects.toMatchObject({ code: "tenant", message: "Assessment actor role is invalid" });
    expect(await store.listStudentEvaluations(academyId, "student-1")).toHaveLength(0);
  });

  it.each(invalidRatings)("refuses %s", async (_ratingLabel, ratings) => {
    const store = await makeStore();
    await expect(store.recordSkillRatings(rate({}, { ratings }))).rejects.toMatchObject({
      code: "invalid",
      message: "Skill ratings are invalid",
    });
    expect(await store.listStudentEvaluations(academyId, "student-1")).toHaveLength(0);
  });

  it.each(invalidEvidenceNotes)("refuses %s", async (_noteLabel, evidenceNotes) => {
    const store = await makeStore();
    await expect(store.recordSkillRatings(rate({}, { evidenceNotes }))).rejects.toMatchObject({
      code: "invalid",
      message: "Assessment evidence notes are invalid",
    });
    expect(await store.listStudentEvaluations(academyId, "student-1")).toHaveLength(0);
  });

  it("refuses a skill that is not in the published catalogue", async () => {
    const store = await makeStore();
    await expect(
      store.recordSkillRatings(rate({}, { ratings: [{ skillKey: "not-in-catalogue", score: 2 }] })),
    ).rejects.toMatchObject({ code: "conflict", message: "Assessment catalog is not current" });
    expect(await store.listStudentEvaluations(academyId, "student-1")).toHaveLength(0);
  });

  it("refuses an unknown definition key", async () => {
    const store = await makeStore();
    await expect(
      store.recordSkillRatings(rate({}, { definitionKey: "no-such-level" })),
    ).rejects.toMatchObject({ code: "conflict", message: "Assessment references are not current" });
    expect(await store.listStudentEvaluations(academyId, "student-1")).toHaveLength(0);
  });

  /**
   * Review of Task 11 (Minor-1): `studentId` and `definitionKey` reach a Firestore document path
   * and the evaluation id. Before the whole input was parsed they were refused only downstream,
   * by accident, and with a message about something else ("Level audit scope is invalid" for the
   * first, a `conflict` for the second). Both now die at the same parse, in both stores.
   */
  it.each([
    ["a studentId that walks out of its collection", { studentId: "student-1/x/session-1" }],
    ["a definitionKey that walks out of its collection", { definitionKey: "white-belt/x" }],
  ])("refuses %s", async (_label, input) => {
    const store = await makeStore();
    await expect(store.recordSkillRatings(rate({}, input))).rejects.toMatchObject({
      code: "invalid",
      message: "Skill ratings input is invalid",
    });
    expect(await store.listStudentEvaluations(academyId, "student-1")).toHaveLength(0);
  });
});

/**
 * Operator DECISION 6 (2026-09-18): the LATEST rating for a skill is the one that counts, so a
 * coach's correction downward lowers readiness. Both halves are asserted here: the skill summary
 * the Manage view reads, and the skills gap `assignLevel` computes.
 */
describe.each(openParityStores)("latest rating wins — %s (T051V2)", (_label, makeStore) => {
  const kidsBelt = "white-belt-kids-4-5-and-5-7-yo";
  const kidsFirstStripe = "white-4-5-and-5-7yo-1st-stripe";
  const correctedAt = "2026-09-10T13:00:00.000Z";
  const kidsRequirements = normalized.requirements.filter(
    (requirement) => requirement.definitionKey === kidsFirstStripe,
  );

  it("replaces the earlier rating in the skill summary and keeps maxScore as history", async () => {
    const store = await makeStore();
    await store.recordSkillRatings(rate());
    await store.recordSkillRatings(
      rate({ evaluatedAt: correctedAt }, { ratings: [{ skillKey: "tie-the-belt", score: 1 }] }),
    );
    const summary = await store.getStudentSkillSummary(academyId, "student-1");
    expect(summary["tie-the-belt"]).toEqual({
      count: 2,
      latestScore: 1,
      maxScore: 3,
      lastEvaluatedAt: correctedAt,
    });
    expect(summary["warm-up-2-bridges"]).toMatchObject({ latestScore: 4, maxScore: 4, count: 1 });
  });

  async function assignedGaps(corrected: boolean): Promise<readonly string[]> {
    const store = await makeStore();
    await store.openStudentLevel({
      academyId,
      input: {
        studentId: "student-1",
        definitionKey: kidsBelt,
        decisionNotes: "Holds this belt from Regyfit.",
        startedOn: "2026-07-01",
      },
      openedBy: "owner-user-1",
      openedByStaffId: null,
      openedByRole: "owner" as const,
      openedAt: decidedAt,
    });
    await store.recordSkillRatings(
      rate(
        {},
        {
          definitionKey: kidsBelt,
          ratings: kidsRequirements.map((requirement) => ({
            skillKey: requirement.skillKey,
            score: 5,
          })),
        },
      ),
    );
    if (corrected) {
      await store.recordSkillRatings(
        rate(
          { evaluatedAt: correctedAt },
          { definitionKey: kidsBelt, ratings: [{ skillKey: "tie-the-belt", score: 1 }] },
        ),
      );
    }
    const result = await store.assignLevel({
      academyId,
      input: {
        studentId: "student-1",
        fromDefinitionKey: kidsBelt,
        toDefinitionKey: kidsFirstStripe,
        promotedOn: "2026-09-10",
        note: assignmentNote,
      },
      decidedBy: "owner-user-1",
      decidedByStaffId: null,
      decidedByRole: "owner" as const,
      decidedAt,
    });
    return result.gaps;
  }

  it("re-opens the skills gap on an assignment when a rating is corrected downward", async () => {
    expect(kidsRequirements).toHaveLength(11);
    const met = await assignedGaps(false);
    expect(met.some((gap) => gap.startsWith("Skills"))).toBe(false);
    const corrected = await assignedGaps(true);
    expect(corrected).toContain("Skills 10/11 at minimum not met");
  });
});
