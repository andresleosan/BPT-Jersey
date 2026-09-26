import { describe, expect, it } from "vitest";

import {
  applyLevelProgressMigration,
  decideProgressHeadMigration,
  expectedLevelCatalogActivationConfirmation,
  expectedLevelProgressMigrationConfirmation,
  planLevelProgressMigration,
  type LevelProgressMigrationStore,
} from "./level-progress-migration.js";

const academyId = "academy-1";
const studentId = "student-1";
const now = "2026-09-21T08:00:00.000Z";
const updatedAt = "2026-09-20T10:00:00.000Z";
const definitions = Object.freeze(["white-belt", "white-1st-stripe"]);

function head(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    academyId,
    studentId,
    systemId: "ibjjf-v2",
    currentDefinitionKey: "white-belt",
    currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
    lastApprovedPromotionId: "promotion-1",
    state: "initialized",
    schemaVersion: "1",
    createdAt: "2026-07-01T00:00:00.000Z",
    createdBy: "head-coach",
    updatedAt,
    updatedBy: "head-coach",
    ...overrides,
  };
}

type Stored = Readonly<{ data: Readonly<Record<string, unknown>> }>;

function fakeStore(initial: Readonly<Record<string, Stored>>) {
  const records = new Map(Object.entries(initial));
  const writes: string[] = [];
  const document = (path: string) => ({
    id: path.split("/").at(-1) ?? "",
    path,
    get: async () => {
      const stored = records.get(path);
      return { exists: stored !== undefined, data: () => stored?.data };
    },
    set: async (data: Record<string, unknown>) => {
      records.set(path, { data });
    },
    delete: async () => {
      records.delete(path);
    },
  });
  const firestore = {
    doc: document,
    collection: (path: string) => {
      const query = (filters: readonly (readonly [string, unknown])[]) => ({
        get: async () => ({
          docs: [...records.entries()]
            .filter(([recordPath]) => recordPath.startsWith(`${path}/`))
            .filter(([, stored]) => filters.every(([field, value]) => stored.data[field] === value))
            .map(([recordPath, stored]) => ({
              id: recordPath.slice(path.length + 1),
              data: () => ({ ...stored.data }),
              ref: document(recordPath),
            })),
        }),
        where: (field: string, _operator: "==", value: unknown) =>
          query([...filters, [field, value] as const]),
      });
      return query([]);
    },
    batch: () => ({ set() {}, delete() {}, commit: async () => undefined }),
    runTransaction: async <T>(callback: (transaction: any) => Promise<T>) => {
      const staged = new Map<string, Readonly<Record<string, unknown>>>();
      const creates = new Set<string>();
      const transaction = {
        get: async (reference: { path: string }) => {
          const stored = records.get(reference.path);
          return { exists: stored !== undefined, data: () => stored?.data };
        },
        create: (reference: { path: string }, data: Readonly<Record<string, unknown>>) => {
          if (records.has(reference.path) || staged.has(reference.path)) {
            throw new Error("already exists");
          }
          creates.add(reference.path);
          staged.set(reference.path, data);
        },
        set: (
          reference: { path: string },
          data: Readonly<Record<string, unknown>>,
          options?: Readonly<{ merge?: boolean }>,
        ) => {
          const existing = records.get(reference.path)?.data ?? {};
          staged.set(reference.path, options?.merge === true ? { ...existing, ...data } : data);
        },
        delete: () => undefined,
      };
      const result = await callback(transaction);
      for (const [path, data] of staged) {
        if (creates.has(path) && records.has(path)) throw new Error("already exists");
        records.set(path, { data });
        writes.push(path);
      }
      return result;
    },
  };
  const store: LevelProgressMigrationStore = {
    firestore,
    v3DefinitionKeys: definitions,
    async listHeads() {
      return [...records.entries()]
        .filter(([path]) => path.startsWith(`academies/${academyId}/studentLevelProgress/`))
        .map(([path, stored]) => ({ recordId: path.split("/").at(-1) ?? "", data: stored.data }));
    },
  };
  return { store, records, writes };
}

function fixtures() {
  return {
    [`academies/${academyId}/studentLevelProgress/${studentId}`]: { data: head() },
    [`academies/${academyId}/levelSystems/ibjjf-v3`]: {
      data: { academyId, systemId: "ibjjf-v3", status: "published" },
    },
    [`academies/${academyId}/levelDefinitions/ibjjf-v3--white-belt`]: {
      data: { academyId, systemId: "ibjjf-v3", definitionKey: "white-belt" },
    },
    [`academies/${academyId}/levelPromotions/promotion-1`]: {
      data: { academyId, studentId, systemId: "ibjjf-v2", immutable: "history" },
    },
  };
}

describe("level progress v3 migration", () => {
  it("decides migrate, already_v3 and manual_review without inventing a level", () => {
    expect(decideProgressHeadMigration(head(), definitions)).toMatchObject({
      status: "migrate",
      studentId,
      fromSystemId: "ibjjf-v2",
      toSystemId: "ibjjf-v3",
    });
    expect(decideProgressHeadMigration(head({ systemId: "ibjjf-v3" }), definitions)).toMatchObject({
      status: "already_v3",
      studentId,
    });
    expect(
      decideProgressHeadMigration(head({ currentDefinitionKey: "unknown" }), definitions),
    ).toMatchObject({ status: "manual_review", studentId });
    expect(decideProgressHeadMigration(undefined, definitions)).toEqual({
      status: "manual_review",
      studentId: null,
      reason: "invalid_head",
    });
  });

  it("plans without writes", async () => {
    const harness = fakeStore(fixtures());
    const plan = await planLevelProgressMigration(harness.store, {
      academyId,
      operationId: "progress-v3-1",
      generatedAt: now,
    });
    expect(plan.rows).toEqual([
      expect.objectContaining({ studentId, expectedUpdatedAt: updatedAt, status: "migrate" }),
    ]);
    expect(expectedLevelCatalogActivationConfirmation(plan)).toBe(
      `ACTIVATE LEVEL CATALOG V3 ${academyId} progress-v3-1 ${plan.contentHash}`,
    );
    expect(harness.writes).toEqual([]);
  });

  it("requires the exact frozen-plan confirmation before any write", async () => {
    const harness = fakeStore(fixtures());
    const plan = await planLevelProgressMigration(harness.store, {
      academyId,
      operationId: "progress-v3-1",
      generatedAt: now,
    });
    await expect(
      applyLevelProgressMigration(harness.store, plan, {
        academyId,
        operationId: plan.operationId,
        contentHash: plan.contentHash,
        actorId: "system-level-progress-migration",
        appliedAt: now,
        confirmation: "wrong",
      }),
    ).rejects.toThrow(/confirmation/i);
    expect(harness.writes).toEqual([]);
  });

  it("re-reads versions, migrates only the head and replays idempotently", async () => {
    const harness = fakeStore(fixtures());
    const promotionPath = `academies/${academyId}/levelPromotions/promotion-1`;
    const historyBefore = harness.records.get(promotionPath);
    const plan = await planLevelProgressMigration(harness.store, {
      academyId,
      operationId: "progress-v3-1",
      generatedAt: now,
    });
    const identity = { academyId, operationId: plan.operationId, contentHash: plan.contentHash };
    const confirmation = {
      ...identity,
      actorId: "system-level-progress-migration",
      appliedAt: now,
      confirmation: expectedLevelProgressMigrationConfirmation(identity),
    };

    const result = await applyLevelProgressMigration(harness.store, plan, confirmation);
    expect(result.rows).toEqual([{ studentId, status: "migrate" }]);
    expect(
      harness.records.get(`academies/${academyId}/studentLevelProgress/${studentId}`)?.data,
    ).toMatchObject({
      systemId: "ibjjf-v3",
      currentDefinitionKey: "white-belt",
      currentLevelStartedAt: "2026-07-01T00:00:00.000Z",
      updatedAt: now,
      updatedBy: "system-level-progress-migration",
    });
    expect(harness.records.get(promotionPath)).toEqual(historyBefore);
    const writesAfterFirst = harness.writes.length;
    const replay = await applyLevelProgressMigration(harness.store, plan, confirmation);
    expect(replay.rows).toEqual([{ studentId, status: "already_v3" }]);
    expect(harness.writes).toHaveLength(writesAfterFirst);
  });

  it("returns stale and writes nothing when updatedAt changed after planning", async () => {
    const harness = fakeStore(fixtures());
    const plan = await planLevelProgressMigration(harness.store, {
      academyId,
      operationId: "progress-v3-1",
      generatedAt: now,
    });
    const path = `academies/${academyId}/studentLevelProgress/${studentId}`;
    harness.records.set(path, {
      data: head({ updatedAt: "2026-09-21T07:00:00.000Z" }),
    });
    const identity = { academyId, operationId: plan.operationId, contentHash: plan.contentHash };
    const result = await applyLevelProgressMigration(harness.store, plan, {
      ...identity,
      actorId: "system-level-progress-migration",
      appliedAt: now,
      confirmation: expectedLevelProgressMigrationConfirmation(identity),
    });
    expect(result.rows).toEqual([{ studentId, status: "stale" }]);
    expect(harness.writes).toEqual([]);
  });

  it("requires the academy v3 catalogue to be published", async () => {
    const initial = fixtures();
    initial[`academies/${academyId}/levelSystems/ibjjf-v3`] = {
      data: { academyId, systemId: "ibjjf-v3", status: "draft" },
    };
    const harness = fakeStore(initial);
    const plan = await planLevelProgressMigration(harness.store, {
      academyId,
      operationId: "progress-v3-1",
      generatedAt: now,
    });
    const identity = { academyId, operationId: plan.operationId, contentHash: plan.contentHash };
    const result = await applyLevelProgressMigration(harness.store, plan, {
      ...identity,
      actorId: "system-level-progress-migration",
      appliedAt: now,
      confirmation: expectedLevelProgressMigrationConfirmation(identity),
    });

    expect(result.rows).toEqual([{ studentId, status: "manual_review" }]);
    expect(harness.writes).toEqual([]);
  });
});
