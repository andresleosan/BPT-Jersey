import { describe, expect, it } from "vitest";

import businessCriteriaJson from "../../../../docs/data/ibjjf-levels-business-criteria.sanitized.json";
import observedJson from "../../../../docs/data/ibjjf-levels-observed.sanitized.json";
import { LEVEL_CATALOG_DOCUMENT_COUNT } from "./level-catalog-integrity";
import { createLevelCatalogStore, type GenericFirestore } from "./level-service";
import { normalizeLevelCatalogSource } from "./level-source";

type StoredRecord = Record<string, unknown>;

/**
 * Minimal transactional Firestore double. Writes issued inside `runTransaction` are staged and
 * applied only when the callback resolves, so a thrown error leaves the records untouched, just
 * like a real Firestore transaction. Any write outside a transaction fails loudly: the catalog
 * publication must never fall back to sequential writes.
 */
type Reference = Readonly<{ path?: string }>;
type FakeTransaction = Parameters<Parameters<GenericFirestore["runTransaction"]>[0]>[0];

function pathOf(reference: Reference): string {
  if (reference.path === undefined) throw new Error("Reference path is required.");
  return reference.path;
}

function isDocumentPath(path: string): boolean {
  return path.split("/").length % 2 === 0;
}

function createTransactionalFirestore(initial: Record<string, StoredRecord> = {}) {
  const records = new Map<string, StoredRecord>(
    Object.entries(initial).map(([path, data]) => [path, structuredClone(data)]),
  );
  let transactions = 0;
  const forbiddenWrite = (): never => {
    throw new Error("Write outside of a transaction is forbidden.");
  };
  const docRef = (path: string) => ({
    id: path.split("/").at(-1) ?? "",
    path,
    get: async () => {
      const data = records.get(path);
      return { id: path.split("/").at(-1) ?? "", exists: data !== undefined, data: () => data };
    },
    set: forbiddenWrite,
    delete: forbiddenWrite,
  });
  const collectionDocs = (path: string) =>
    [...records.entries()]
      .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/"))
      .map(([key, value]) => ({
        id: key.split("/").at(-1) ?? "",
        data: () => structuredClone(value),
        ref: docRef(key),
      }));
  const firestore: GenericFirestore = {
    doc: docRef,
    collection: (path) => ({
      path,
      get: async () => ({ docs: collectionDocs(path) }),
    }),
    batch: () => ({ set: forbiddenWrite, delete: forbiddenWrite, commit: forbiddenWrite }),
    runTransaction: async (callback) => {
      transactions += 1;
      const staged: (() => void)[] = [];
      const transaction = {
        get: async (reference: Reference) => {
          const path = pathOf(reference);
          if (isDocumentPath(path)) {
            const data = records.get(path);
            return {
              id: path.split("/").at(-1) ?? "",
              exists: data !== undefined,
              data: () => (data === undefined ? undefined : structuredClone(data)),
            };
          }
          return { docs: collectionDocs(path) };
        },
        create: (reference: Reference, data: unknown) => {
          const path = pathOf(reference);
          if (records.has(path)) throw new Error(`Document already exists: ${path}`);
          staged.push(() => records.set(path, structuredClone(data as StoredRecord)));
        },
        set: (reference: Reference, data: unknown) => {
          const path = pathOf(reference);
          staged.push(() => records.set(path, structuredClone(data as StoredRecord)));
        },
        delete: (reference: Reference) => {
          const path = pathOf(reference);
          staged.push(() => records.delete(path));
        },
      } as unknown as FakeTransaction;
      const result = await callback(transaction);
      for (const apply of staged) apply();
      return result;
    },
  };
  return {
    firestore,
    records,
    transactionCount: () => transactions,
    snapshot: () => new Map([...records.entries()].map(([k, v]) => [k, JSON.stringify(v)])),
  };
}

const academyId = "demo-academy";
const normalized = normalizeLevelCatalogSource(observedJson, businessCriteriaJson);
const prefix = `academies/${academyId}`;

async function publishedFixture() {
  const fake = createTransactionalFirestore();
  const store = createLevelCatalogStore({ firestore: fake.firestore });
  const result = await store.seed({ academyId, normalized, operationId: "seed-op-1" });
  return { fake, store, result };
}

function pathsUnder(records: Map<string, StoredRecord>, collection: string): string[] {
  return [...records.keys()].filter((key) => key.startsWith(`${prefix}/${collection}/`));
}

describe("Level catalog publication integrity (T101)", () => {
  it("publishes the 337 catalog documents, the manifest and the audit in one transaction", async () => {
    const { fake, result } = await publishedFixture();

    expect(result.idempotent).toBe(false);
    expect(fake.transactionCount()).toBe(1);
    expect(pathsUnder(fake.records, "levelSystems")).toHaveLength(1);
    expect(pathsUnder(fake.records, "levelDefinitions")).toHaveLength(171);
    expect(pathsUnder(fake.records, "levelRequirements")).toHaveLength(165);
    expect(pathsUnder(fake.records, "levelCatalogManifests")).toHaveLength(1);
    expect(pathsUnder(fake.records, "auditEvents")).toHaveLength(1);
    expect(fake.records.size).toBe(LEVEL_CATALOG_DOCUMENT_COUNT + 2);

    const manifest = fake.records.get(`${prefix}/levelCatalogManifests/ibjjf-v1`);
    expect(manifest).toMatchObject({
      status: "published",
      catalogDocumentCount: 337,
      definitionCount: 171,
      requirementCount: 165,
      observedSourceHash: normalized.sourceHashes.observed,
      businessCriteriaSourceHash: normalized.sourceHashes.businessCriteria,
      publishedOperationId: "seed-op-1",
    });
    const audit = fake.records.get(
      `${prefix}/auditEvents/${String(manifest?.publishedAuditEventId)}`,
    );
    expect(audit).toMatchObject({ action: "level.catalog.published", academyId });
  });

  it("leaves zero documents behind when a write fails inside the publication transaction", async () => {
    const fake = createTransactionalFirestore({
      // A pre-existing definition makes the transactional `create` fail for that document.
      [`${prefix}/levelDefinitions/${normalized.definitions[0]?.definitionKey ?? ""}`]: {
        systemId: "other-system",
        academyId,
      },
    });
    const before = fake.snapshot();
    const store = createLevelCatalogStore({ firestore: fake.firestore });

    await expect(store.seed({ academyId, normalized })).rejects.toThrow(/already exists/);
    expect(fake.snapshot()).toEqual(before);
  });

  it("returns idempotent only after the complete publication verifies", async () => {
    const { fake, store } = await publishedFixture();
    const before = fake.snapshot();

    const replay = await store.seed({ academyId, normalized, operationId: "unused-op" });

    expect(replay.idempotent).toBe(true);
    expect(fake.snapshot()).toEqual(before);
  });

  it("rejects a replay when a child document is missing instead of treating it as idempotent", async () => {
    const { fake, store } = await publishedFixture();
    const [missing] = pathsUnder(fake.records, "levelDefinitions");
    fake.records.delete(missing ?? "");
    const before = fake.snapshot();

    await expect(store.seed({ academyId, normalized })).rejects.toThrow(
      /count does not match the manifest/,
    );
    expect(fake.snapshot()).toEqual(before);
  });

  it("rejects a replay when a child document was altered after publication", async () => {
    const { fake, store } = await publishedFixture();
    const [alteredPath] = pathsUnder(fake.records, "levelRequirements");
    const altered = fake.records.get(alteredPath ?? "");
    fake.records.set(alteredPath ?? "", { ...altered, skillKey: "tampered" });
    const before = fake.snapshot();

    await expect(store.seed({ academyId, normalized })).rejects.toThrow(
      /do not match the approved catalog/,
    );
    expect(fake.snapshot()).toEqual(before);
  });

  it("rejects a replay when the manifest or the publication audit is missing", async () => {
    const withoutManifest = await publishedFixture();
    withoutManifest.fake.records.delete(`${prefix}/levelCatalogManifests/ibjjf-v1`);
    await expect(withoutManifest.store.seed({ academyId, normalized })).rejects.toThrow(
      /publication is incomplete/,
    );

    const withoutAudit = await publishedFixture();
    const [auditPath] = pathsUnder(withoutAudit.fake.records, "auditEvents");
    withoutAudit.fake.records.delete(auditPath ?? "");
    await expect(withoutAudit.store.seed({ academyId, normalized })).rejects.toThrow(
      /publication audit is invalid/,
    );
  });

  it("rejects publishing over partial catalog documents that have no manifest", async () => {
    const { fake, store } = await publishedFixture();
    fake.records.delete(`${prefix}/levelSystems/ibjjf-v1`);
    fake.records.delete(`${prefix}/levelCatalogManifests/ibjjf-v1`);
    const before = fake.snapshot();

    await expect(store.seed({ academyId, normalized })).rejects.toThrow(
      /Partial level catalog documents already exist/,
    );
    expect(fake.snapshot()).toEqual(before);
  });

  it("blocks rollback while any canonical document references the catalog", async () => {
    const { fake, store } = await publishedFixture();
    const definitionKey = normalized.definitions[0]?.definitionKey ?? "";
    fake.records.set(`${prefix}/studentLevelProgress/student-1`, {
      academyId,
      studentId: "student-1",
      currentDefinitionKey: definitionKey,
    });
    const before = fake.snapshot();

    await expect(
      store.rollback({ academyId, systemId: "ibjjf-v1", normalized, operationId: "rb-1" }),
    ).rejects.toThrow(/blocked by active references/);
    expect(fake.snapshot()).toEqual(before);
  });

  it("refuses to roll back a catalog whose stored manifest no longer verifies", async () => {
    const { fake, store } = await publishedFixture();
    const [missing] = pathsUnder(fake.records, "levelDefinitions");
    fake.records.delete(missing ?? "");
    const before = fake.snapshot();

    await expect(
      store.rollback({ academyId, systemId: "ibjjf-v1", normalized, operationId: "rb-2" }),
    ).rejects.toThrow(/count does not match the manifest/);
    expect(fake.snapshot()).toEqual(before);
  });

  it("rolls back with zero references in one transaction and appends the rollback audit", async () => {
    const { fake, store } = await publishedFixture();
    const seedTransactions = fake.transactionCount();

    const result = await store.rollback({
      academyId,
      systemId: "ibjjf-v1",
      normalized,
      operationId: "rb-3",
    });

    expect(result).toEqual({
      systemId: "ibjjf-v1",
      deletedDefinitions: 171,
      deletedRequirements: 165,
      deletedSystems: 1,
    });
    expect(fake.transactionCount()).toBe(seedTransactions + 1);
    expect(pathsUnder(fake.records, "levelSystems")).toHaveLength(0);
    expect(pathsUnder(fake.records, "levelDefinitions")).toHaveLength(0);
    expect(pathsUnder(fake.records, "levelRequirements")).toHaveLength(0);
    expect(pathsUnder(fake.records, "levelCatalogManifests")).toHaveLength(0);
    const audits = pathsUnder(fake.records, "auditEvents").map((path) => fake.records.get(path));
    expect(audits.map((audit) => audit?.action).sort()).toEqual([
      "level.catalog.published",
      "level.catalog.rolled_back",
    ]);
  });
});
