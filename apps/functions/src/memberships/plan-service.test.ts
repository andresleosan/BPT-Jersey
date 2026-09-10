import { describe, expect, it } from "vitest";

import { PLAN_CATALOG, type PlanDraft, type PlanRecord } from "@bpt-jersey/domain/memberships";

import {
  PlanStoreError,
  createPlanStore,
  type PlanDocumentData,
  type PlanFirestore,
} from "./plan-service.js";

type Ref = Readonly<{ id: string; path: string }>;
type Query = Readonly<{ path: string; field: string; value: unknown; limit: number }>;

function createFakeFirestore(initial: Record<string, PlanDocumentData> = {}) {
  const records = new Map(Object.entries(initial));
  const writes: string[] = [];
  const queries: Query[] = [];
  const ref = (path: string): Ref => ({ id: path.split("/").at(-1) ?? "", path });
  const firestore: PlanFirestore = {
    doc: (path) => ref(path),
    collection: (path) => ({
      doc: (id?: string) => ref(`${path}/${id ?? "generated"}`),
      where: (field, _operator, value) => ({
        path,
        field,
        value,
        limit: (count) => {
          const query = { path, field, value, limit: count };
          queries.push(query);
          return query;
        },
      }),
    }),
    runTransaction: async (callback) => {
      const snapshot = new Map(records);
      const transaction = {
        get: async (target: Ref | Query) => {
          if ("field" in target) {
            const docs = [...records.entries()]
              .filter(
                ([path, data]) =>
                  path.startsWith(`${target.path}/`) && data[target.field] === target.value,
              )
              .slice(0, target.limit)
              .map(([path, data]) => ({ ...ref(path), exists: true, data: () => data }));
            return { docs };
          }
          const data = records.get(target.path);
          return { ...ref(target.path), exists: data !== undefined, data: () => data };
        },
        create: (target: Ref, data: PlanDocumentData) => {
          if (records.has(target.path)) throw new Error("already exists");
          writes.push(`create:${target.path}`);
          records.set(target.path, data);
          return transaction;
        },
        set: (target: Ref, data: PlanDocumentData) => {
          writes.push(`set:${target.path}`);
          records.set(target.path, data);
          return transaction;
        },
      };
      try {
        return await callback(transaction);
      } catch (error) {
        records.clear();
        for (const [path, data] of snapshot) records.set(path, data);
        writes.length = 0;
        throw error;
      }
    },
  };
  return { firestore, records, writes, queries };
}

function record(
  plan: PlanDraft = PLAN_CATALOG[0]!,
  overrides: Partial<PlanRecord> = {},
): PlanRecord {
  return {
    ...plan,
    academyId: "academy-1",
    active: true,
    schemaVersion: "1",
    createdAt: "2026-08-19T10:00:00.000Z",
    createdBy: "creator-1",
    updatedAt: "2026-08-19T10:00:00.000Z",
    updatedBy: "creator-1",
    ...overrides,
  };
}

function services(initial: Record<string, PlanDocumentData> = {}) {
  const fake = createFakeFirestore(initial);
  const store = createPlanStore({ firestore: fake.firestore });
  return { ...fake, store };
}

const baseInput = {
  academyId: "academy-1",
  actorId: "actor-1",
  now: "2026-08-19T10:00:00.000Z",
} as const;

describe("membership plan Firestore store", () => {
  it("lists active plans in catalog order through a real active query limited to ten", async () => {
    const westAdult = record(PLAN_CATALOG[4]);
    const payg = record(PLAN_CATALOG[0]!);
    const { store, queries } = services({
      "academies/academy-1/plans/west-adult": westAdult,
      "academies/academy-1/plans/payg": payg,
      "academies/academy-1/plans/west-kids-1x": record(PLAN_CATALOG[2], { active: false }),
    });

    await expect(store.listPlans("academy-1")).resolves.toEqual([payg, westAdult]);
    expect(queries).toContainEqual({
      path: "academies/academy-1/plans",
      field: "active",
      value: true,
      limit: 10,
    });
  });

  it("returns undefined for a missing plan", async () => {
    await expect(services().store.getPlan("academy-1", "payg")).resolves.toBeUndefined();
  });

  it("returns undefined for an inactive plan", async () => {
    const { store } = services({
      "academies/academy-1/plans/payg": record(PLAN_CATALOG[0]!, { active: false }),
    });

    await expect(store.getPlan("academy-1", "payg")).resolves.toBeUndefined();
  });

  it("creates a plan from only the approved draft and updates it without replacing its envelope", async () => {
    const { store, records, writes } = services();
    const created = await store.savePlan({
      ...baseInput,
      draft: PLAN_CATALOG[0]!,
    });
    expect(created).toMatchObject({
      ...record(),
      createdBy: "actor-1",
      updatedBy: "actor-1",
    });

    const updatedDraft = { ...PLAN_CATALOG[0]!, displayName: "Pay as you go updated" };
    const updated = await store.savePlan({
      ...baseInput,
      actorId: "actor-2",
      now: "2026-08-20T10:00:00.000Z",
      draft: updatedDraft,
    });
    expect(updated).toMatchObject({
      displayName: "Pay as you go updated",
      createdAt: created.createdAt,
      createdBy: created.createdBy,
      updatedAt: "2026-08-20T10:00:00.000Z",
      updatedBy: "actor-2",
    });
    expect(records.get("academies/academy-1/plans/payg")).toEqual(updated);
    expect(writes).toEqual([
      "create:academies/academy-1/plans/payg",
      "set:academies/academy-1/plans/payg",
    ]);
  });

  it("soft-deactivates a plan, keeps its document, and makes repeated calls safe", async () => {
    const initial = record();
    const { store, records } = services({ "academies/academy-1/plans/payg": initial });

    const deactivated = await store.deactivatePlan({
      ...baseInput,
      planId: "payg",
      now: "2026-08-20T10:00:00.000Z",
    });
    expect(deactivated).toMatchObject({
      active: false,
      createdAt: initial.createdAt,
      createdBy: initial.createdBy,
      updatedAt: "2026-08-20T10:00:00.000Z",
      updatedBy: "actor-1",
    });
    expect(records.has("academies/academy-1/plans/payg")).toBe(true);

    await expect(
      store.deactivatePlan({
        ...baseInput,
        planId: "payg",
        now: "2026-08-21T10:00:00.000Z",
      }),
    ).resolves.toMatchObject({ active: false, updatedAt: "2026-08-20T10:00:00.000Z" });
  });

  it("activates an inactive plan transactionally and preserves its envelope", async () => {
    const initial = record(PLAN_CATALOG[0]!, {
      active: false,
      createdAt: "2026-08-01T10:00:00.000Z",
      createdBy: "creator-1",
      updatedAt: "2026-08-10T10:00:00.000Z",
      updatedBy: "actor-0",
    });
    const { store, records, writes } = services({
      "academies/academy-1/plans/payg": initial,
    });

    const activated = await store.activatePlan({
      ...baseInput,
      planId: "payg",
      now: "2026-08-20T10:00:00.000Z",
    });

    expect(activated).toMatchObject({
      active: true,
      createdAt: initial.createdAt,
      createdBy: initial.createdBy,
      updatedAt: "2026-08-20T10:00:00.000Z",
      updatedBy: "actor-1",
    });
    expect(records.get("academies/academy-1/plans/payg")).toEqual(activated);
    expect(writes).toEqual(["set:academies/academy-1/plans/payg"]);
  });

  it("makes repeated activation safe without rewriting an already active plan", async () => {
    const initial = record(PLAN_CATALOG[0]!, { active: false });
    const { store, writes } = services({ "academies/academy-1/plans/payg": initial });

    await store.activatePlan({
      ...baseInput,
      planId: "payg",
      now: "2026-08-20T10:00:00.000Z",
    });
    const repeated = await store.activatePlan({
      ...baseInput,
      actorId: "actor-2",
      planId: "payg",
      now: "2026-08-21T10:00:00.000Z",
    });

    expect(repeated).toMatchObject({
      active: true,
      updatedAt: "2026-08-20T10:00:00.000Z",
      updatedBy: "actor-1",
    });
    expect(writes).toEqual(["set:academies/academy-1/plans/payg"]);
  });

  it("rejects missing, cross-tenant, and invalid activation requests safely", async () => {
    const { store } = services();

    await expect(store.activatePlan({ ...baseInput, planId: "payg" })).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(
      store.activatePlan({ ...baseInput, academyId: "academy/other", planId: "payg" }),
    ).rejects.toMatchObject({ code: "tenant" });
    await expect(
      store.activatePlan({
        ...baseInput,
        planId: "unknown" as "payg",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      store.activatePlan({
        ...baseInput,
        now: "2026-02-30T10:00:00Z",
        planId: "payg",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("seeds exactly ten catalog plans and preserves envelopes on repeat", async () => {
    const { store, records, writes } = services();
    const first = await store.seedPlanCatalog(baseInput);
    expect(first).toHaveLength(10);
    expect(first.map((plan) => plan.planId)).toEqual(PLAN_CATALOG.map((plan) => plan.planId));
    expect(writes).toHaveLength(10);

    const existing = records.get("academies/academy-1/plans/payg");
    expect(existing).toBeDefined();
    const second = await store.seedPlanCatalog({
      ...baseInput,
      actorId: "actor-2",
      now: "2026-08-21T10:00:00.000Z",
    });
    expect(second).toHaveLength(10);
    expect(writes).toHaveLength(20);
    expect(writes.slice(10).every((write) => write.startsWith("set:"))).toBe(true);
    expect(records.get("academies/academy-1/plans/payg")).toMatchObject({
      createdAt: (existing as PlanRecord).createdAt,
      createdBy: (existing as PlanRecord).createdBy,
      updatedAt: "2026-08-21T10:00:00.000Z",
      updatedBy: "actor-2",
    });
  });

  it("updates stale catalog fields during seed without changing the existing envelope", async () => {
    const stale = record(PLAN_CATALOG[0]!, {
      displayName: "Legacy Pay as you go",
      priceMinor: 999,
      createdAt: "2026-08-01T10:00:00.000Z",
      createdBy: "legacy-actor",
      updatedAt: "2026-08-01T10:00:00.000Z",
      updatedBy: "legacy-actor",
    });
    const { store, records, writes } = services({
      "academies/academy-1/plans/payg": stale,
    });

    const seeded = await store.seedPlanCatalog({
      ...baseInput,
      now: "2026-08-20T10:00:00.000Z",
    });
    const payg = seeded.find((plan) => plan.planId === "payg");

    expect(payg).toMatchObject({
      ...PLAN_CATALOG[0]!,
      academyId: "academy-1",
      active: true,
      createdAt: "2026-08-01T10:00:00.000Z",
      createdBy: "legacy-actor",
      updatedAt: "2026-08-20T10:00:00.000Z",
      updatedBy: "actor-1",
    });
    expect(records.get("academies/academy-1/plans/payg")).toEqual(payg);
    expect(writes.filter((write) => write === "set:academies/academy-1/plans/payg")).toHaveLength(
      1,
    );
  });

  it("fails closed for invalid stored records", async () => {
    const { store } = services({
      "academies/academy-1/plans/payg": { ...record(), updatedAt: "not-a-date" },
    });

    await expect(store.getPlan("academy-1", "payg")).rejects.toMatchObject({
      code: "invalid",
      message: "Stored plan is invalid",
    });
    await expect(store.listPlans("academy-1")).rejects.toMatchObject({ code: "invalid" });
  });

  it("fails closed when a stored document ID does not match its plan record", async () => {
    const { store } = services({
      "academies/academy-1/plans/payg": record(PLAN_CATALOG[1]!),
    });

    await expect(store.listPlans("academy-1")).rejects.toMatchObject({ code: "invalid" });
  });

  it("rejects invalid timestamps and unknown plan IDs with safe errors", async () => {
    const { store } = services();
    await expect(
      store.savePlan({ ...baseInput, now: "2026-02-30T10:00:00Z", draft: PLAN_CATALOG[0]! }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      store.savePlan({
        ...baseInput,
        draft: { ...PLAN_CATALOG[0]!, planId: "unknown" } as unknown as PlanDraft,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(store.getPlan("academy-1", "unknown" as "payg")).rejects.toMatchObject({
      code: "invalid",
    });
  });

  it("rejects cross-tenant and unsafe paths before Firestore access", async () => {
    const { store, queries } = services();
    await expect(store.listPlans("academy/other")).rejects.toMatchObject({ code: "tenant" });
    await expect(store.getPlan("academy-1", "../payg" as "payg")).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(
      store.savePlan({ ...baseInput, academyId: "academy/other", draft: PLAN_CATALOG[0]! }),
    ).rejects.toMatchObject({ code: "tenant" });
    expect(queries).toHaveLength(0);
  });

  it("maps Firestore failures to a safe PlanStoreError", async () => {
    const firestore: PlanFirestore = {
      doc: (path) => ({ id: path.split("/").at(-1) ?? "", path }),
      collection: () => ({
        doc: (id = "generated") => ({ id, path: id }),
        where: () => ({
          limit: () => ({ path: "plans", field: "active", value: true, limit: 10 }),
        }),
      }),
      runTransaction: async () => {
        throw new Error("private Firestore details");
      },
    };
    const store = createPlanStore({ firestore });

    await expect(store.getPlan("academy-1", "payg")).rejects.toEqual(
      expect.objectContaining({
        name: "PlanStoreError",
        code: "invalid",
        message: "Plan store operation failed",
      }),
    );
    await expect(store.getPlan("academy-1", "payg")).rejects.not.toThrow(
      "private Firestore details",
    );
  });
});

void PlanStoreError;
