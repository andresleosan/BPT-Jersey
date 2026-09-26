import { beforeEach, describe, expect, it } from "vitest";

import { saveLevelCatalogDraftInputSchema } from "@bpt-jersey/domain/levels/editor";

import {
  createLevelEditorService,
  LevelEditorError,
  reconcileDraftLevels,
} from "./level-editor-service";
import { loadApprovedLevelCatalog } from "./level-seed";
import { createLevelCatalogStore, type GenericFirestore } from "./level-service";

type StoredRecord = Record<string, unknown>;
type Reference = Readonly<{ path?: string; filter?: Readonly<{ field: string; value: unknown }> }>;

function isDocumentPath(path: string): boolean {
  return path.split("/").length % 2 === 0;
}

/**
 * Transactional Firestore double shared by the catalogue store and the editor: writes inside a
 * transaction are staged and applied only when the callback resolves, so a refusal leaves every
 * record untouched. Collections support a single equality `where`, like the editor's queries.
 */
function createFirestore() {
  const records = new Map<string, StoredRecord>();
  const forbidden = (): never => {
    throw new Error("Write outside of a transaction is forbidden.");
  };
  const docRef = (path: string) => ({
    id: path.split("/").at(-1) ?? "",
    path,
    get: async () => {
      const data = records.get(path);
      return { exists: data !== undefined, data: () => data && structuredClone(data) };
    },
    set: forbidden,
    delete: forbidden,
  });
  const collectionDocs = (path: string, filter?: Reference["filter"]) =>
    [...records.entries()]
      .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/"))
      .filter(([, value]) => filter === undefined || value[filter.field] === filter.value)
      .map(([key, value]) => ({
        id: key.split("/").at(-1) ?? "",
        data: () => structuredClone(value),
        ref: docRef(key),
      }));
  const collection = (path: string) => ({
    path,
    get: async () => ({ docs: collectionDocs(path) }),
    where: (field: string, _operator: "==", value: unknown) => ({
      path,
      filter: { field, value },
      get: async () => ({ docs: collectionDocs(path, { field, value }) }),
    }),
  });
  const firestore = {
    doc: docRef,
    collection,
    batch: () => ({ set: forbidden, delete: forbidden, commit: forbidden }),
    runTransaction: async <T>(callback: (transaction: never) => Promise<T>): Promise<T> => {
      const staged: (() => void)[] = [];
      const transaction = {
        get: async (reference: Reference) => {
          const path = reference.path!;
          if (isDocumentPath(path)) {
            const data = records.get(path);
            return { exists: data !== undefined, data: () => data && structuredClone(data) };
          }
          return { docs: collectionDocs(path, reference.filter) };
        },
        create: (reference: Reference, data: unknown) => {
          if (records.has(reference.path!)) throw new Error(`Exists: ${reference.path}`);
          staged.push(() => records.set(reference.path!, structuredClone(data as StoredRecord)));
        },
        set: (reference: Reference, data: unknown, options?: { merge?: boolean }) => {
          staged.push(() =>
            records.set(reference.path!, {
              ...(options?.merge ? records.get(reference.path!) : {}),
              ...structuredClone(data as StoredRecord),
            }),
          );
        },
        delete: (reference: Reference) => {
          staged.push(() => records.delete(reference.path!));
        },
      };
      const result = await callback(transaction as never);
      for (const apply of staged) apply();
      return result;
    },
  };
  return { firestore, records };
}

const academyId = "demo-academy";
const prefix = `academies/${academyId}`;
const v3 = loadApprovedLevelCatalog({ systemId: "ibjjf-v3" } as never);
const firstBelt = v3.definitions.find((definition) => definition.kind === "belt")!;
const firstBeltStripes = v3.definitions.filter(
  (definition) => definition.parentDefinitionKey === firstBelt.definitionKey,
);
const heldStripe = firstBeltStripes[1]!.definitionKey; // the 2nd stripe of the first kids belt

let fake: ReturnType<typeof createFirestore>;
let clock: string;
let operation = 0;

function service() {
  return createLevelEditorService({
    firestore: fake.firestore as never,
    now: () => clock,
    newOperationId: () => `op-${(operation += 1)}`,
  });
}

function addHead(studentId: string, definitionKey: string) {
  fake.records.set(`${prefix}/studentLevelProgress/${studentId}`, {
    academyId,
    studentId,
    systemId: "ibjjf-v3",
    currentDefinitionKey: definitionKey,
    currentLevelStartedAt: "2026-03-01T00:00:00.000Z",
    schemaVersion: "1",
  });
}

beforeEach(async () => {
  fake = createFirestore();
  clock = "2026-09-26T10:00:00.000Z";
  operation = 0;
  await createLevelCatalogStore({ firestore: fake.firestore as unknown as GenericFirestore }).seed({
    academyId,
    normalized: v3,
    operationId: "seed-v3",
  });
});

describe("createLevelCatalogDraft", () => {
  it("copies the source into bpt-<yyyymmdd>-1 as a custom draft", async () => {
    const draft = await service().createDraft({
      academyId,
      fromSystemId: "ibjjf-v3",
      actorId: "owner-1",
    });
    expect(draft.systemId).toBe("bpt-20260926-1");
    expect(draft).toMatchObject({ origin: "custom", status: "draft" });
    const system = fake.records.get(`${prefix}/levelSystems/bpt-20260926-1`)!;
    expect(system).toMatchObject({
      origin: "custom",
      status: "draft",
      copiedFromSystemId: "ibjjf-v3",
    });
    expect(draft.levels.map((level) => level.definitionKey)).toEqual(
      v3.definitions.map((definition) => definition.definitionKey),
    );
    expect(draft.requirements).toHaveLength(v3.requirements.length);
    expect(
      fake.records.get(`${prefix}/levelDefinitions/bpt-20260926-1--${firstBelt.definitionKey}`),
    ).toMatchObject({ systemId: "bpt-20260926-1", name: firstBelt.name });
    // ibjjf-v3 is untouched and still the active version.
    expect(fake.records.get(`${prefix}/levelCatalogState/active`)?.activeSystemId).toBe("ibjjf-v3");
  });

  it("numbers a second draft on the same day -2", async () => {
    await service().createDraft({ academyId, fromSystemId: "ibjjf-v3", actorId: "owner-1" });
    const second = await service().createDraft({
      academyId,
      fromSystemId: "ibjjf-v3",
      actorId: "owner-1",
    });
    expect(second.systemId).toBe("bpt-20260926-2");
  });

  it("produces content the save contract accepts unchanged", async () => {
    const draft = await service().createDraft({
      academyId,
      fromSystemId: "ibjjf-v3",
      actorId: "owner-1",
    });
    const result = saveLevelCatalogDraftInputSchema.safeParse({
      systemId: draft.systemId,
      displayName: draft.displayName,
      levels: draft.levels,
      skills: draft.skills,
      requirements: draft.requirements,
    });
    expect(result.error?.issues.slice(0, 3)).toBeUndefined();
  });
});

async function draftFromV3() {
  return service().createDraft({ academyId, fromSystemId: "ibjjf-v3", actorId: "owner-1" });
}

function saveInput(draft: Awaited<ReturnType<typeof draftFromV3>>) {
  return saveLevelCatalogDraftInputSchema.parse({
    systemId: draft.systemId,
    displayName: draft.displayName,
    levels: draft.levels,
    skills: draft.skills,
    requirements: draft.requirements,
  });
}

describe("saveLevelCatalogDraft", () => {
  it("renames, recolours and trims stripes on a draft", async () => {
    const draft = await draftFromV3();
    const input = saveInput(draft);
    const levels = input.levels.map((level) =>
      level.definitionKey === firstBelt.definitionKey
        ? {
            ...level,
            name: "White belt",
            visual: { colors: ["#FAFAFA"], stripeColor: "#111111", stripeCount: 1 },
          }
        : level,
    );
    const saved = await service().saveDraft({
      academyId,
      draft: { ...input, displayName: "BPT 2026", levels },
      actorId: "owner-1",
    });
    expect(saved.displayName).toBe("BPT 2026");
    const keys = new Set(saved.levels.map((level) => level.definitionKey));
    expect(keys.has(firstBeltStripes[0]!.definitionKey)).toBe(true);
    expect(keys.has(heldStripe)).toBe(false);
    expect(fake.records.has(`${prefix}/levelDefinitions/${draft.systemId}--${heldStripe}`)).toBe(
      false,
    );
    expect(
      fake.records.get(
        `${prefix}/levelDefinitions/${draft.systemId}--${firstBeltStripes[0]!.definitionKey}`,
      )?.visual,
    ).toMatchObject({ colors: ["#FAFAFA"], stripeColor: "#111111" });
    expect(saved.requirements.some((requirement) => requirement.definitionKey === heldStripe)).toBe(
      false,
    );
    // ibjjf-v3 keeps its own copy of the stripe.
    expect(fake.records.has(`${prefix}/levelDefinitions/ibjjf-v3--${heldStripe}`)).toBe(true);
  });

  it("refuses a published version", async () => {
    const draft = await draftFromV3();
    await service().publishDraft({ academyId, systemId: draft.systemId, actorId: "owner-1" });
    await expect(
      service().saveDraft({ academyId, draft: saveInput(draft), actorId: "owner-1" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("reconcileDraftLevels", () => {
  it("generates <beltKey>-stripe-<n> for new stripes", () => {
    const belt = {
      definitionKey: "white",
      kind: "belt" as const,
      parentDefinitionKey: null,
      name: "White belt",
      sequence: 1,
      stripeNumber: null,
      criteria: { minAge: 4, maxAge: null, minClasses: 0, minimumTime: null },
      visual: { colors: ["#FFFFFF"], stripeColor: "#111111", stripeCount: 2 },
    };
    expect(
      reconcileDraftLevels([belt]).map((level) => [level.definitionKey, level.sequence]),
    ).toEqual([
      ["white", 1],
      ["white-stripe-1", 2],
      ["white-stripe-2", 3],
    ]);
  });
});

describe("publishLevelCatalogDraft", () => {
  it("seals the draft with a sha256 content hash", async () => {
    const draft = await draftFromV3();
    const published = await service().publishDraft({
      academyId,
      systemId: draft.systemId,
      actorId: "owner-1",
    });
    expect(published.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(fake.records.get(`${prefix}/levelSystems/${draft.systemId}`)).toMatchObject({
      status: "published",
      contentHash: published.contentHash,
    });
    expect(fake.records.get(`${prefix}/levelCatalogManifests/${draft.systemId}`)).toMatchObject({
      origin: "custom",
      contentHash: published.contentHash,
    });
    await expect(
      service().publishDraft({ academyId, systemId: draft.systemId, actorId: "owner-1" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("activateLevelCatalog", () => {
  async function publishedDraftWithoutHeldStripe() {
    const draft = await draftFromV3();
    const input = saveInput(draft);
    const levels = input.levels.map((level) =>
      level.definitionKey === firstBelt.definitionKey
        ? { ...level, visual: { ...level.visual, stripeCount: 1 } }
        : level,
    );
    await service().saveDraft({ academyId, draft: { ...input, levels }, actorId: "owner-1" });
    await service().publishDraft({ academyId, systemId: draft.systemId, actorId: "owner-1" });
    return draft.systemId;
  }

  it("refuses a version that drops a level students hold, and leaves the pointer alone (Review Focus 3)", async () => {
    const systemId = await publishedDraftWithoutHeldStripe();
    addHead("student-a", heldStripe);
    addHead("student-b", heldStripe);
    addHead("student-c", firstBelt.definitionKey);
    const before = new Map(fake.records);

    const refusal = await service()
      .activate({ academyId, systemId, actorId: "owner-1" })
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(LevelEditorError);
    expect(refusal).toMatchObject({
      code: "missing-levels",
      missing: [{ definitionKey: heldStripe, students: 2 }],
    });
    expect(fake.records.get(`${prefix}/levelCatalogState/active`)?.activeSystemId).toBe("ibjjf-v3");
    expect(fake.records).toEqual(before);
  });

  it("moves the pointer and every progress head, keeping the held level and its start", async () => {
    const draft = await draftFromV3();
    await service().publishDraft({ academyId, systemId: draft.systemId, actorId: "owner-1" });
    addHead("student-a", heldStripe);
    addHead("student-b", firstBelt.definitionKey);

    const result = await service().activate({
      academyId,
      systemId: draft.systemId,
      actorId: "owner-1",
    });

    expect(result).toEqual({
      activeSystemId: draft.systemId,
      previousSystemId: "ibjjf-v3",
      movedStudents: 2,
    });
    expect(fake.records.get(`${prefix}/levelCatalogState/active`)).toMatchObject({
      activeSystemId: draft.systemId,
      previousSystemId: "ibjjf-v3",
    });
    expect(fake.records.get(`${prefix}/studentLevelProgress/student-a`)).toMatchObject({
      systemId: draft.systemId,
      currentDefinitionKey: heldStripe,
      currentLevelStartedAt: "2026-03-01T00:00:00.000Z",
    });
    expect(fake.records.get(`${prefix}/levelCatalogActivations/op-2`)).toMatchObject({
      fromSystemId: "ibjjf-v3",
      toSystemId: draft.systemId,
      actorId: "owner-1",
    });
    const audits = [...fake.records.entries()].filter(
      ([key, value]) =>
        key.startsWith(`${prefix}/auditEvents/`) && value.action === "level.catalog.activated",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]![1]).toMatchObject({
      fromSystemId: "ibjjf-v3",
      toSystemId: draft.systemId,
      actorId: "owner-1",
    });

    // listLevelCatalog now serves the custom version.
    const catalog = await createLevelCatalogStore({
      firestore: fake.firestore as unknown as GenericFirestore,
    }).listPublished(academyId);
    expect(catalog.system.systemId).toBe(draft.systemId);
    expect(catalog.definitions).toHaveLength(v3.definitions.length);
    expect(catalog.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rolls back to ibjjf-v3 through the same check", async () => {
    const draft = await draftFromV3();
    const input = saveInput(draft);
    const extra = {
      ...input.levels[0]!,
      definitionKey: "bpt-only-belt",
      name: "BPT only",
      sequence: 999,
      visual: { ...input.levels[0]!.visual, stripeCount: 0 },
    };
    await service().saveDraft({
      academyId,
      draft: { ...input, levels: [...input.levels, extra] },
      actorId: "owner-1",
    });
    await service().publishDraft({ academyId, systemId: draft.systemId, actorId: "owner-1" });
    addHead("student-a", firstBelt.definitionKey);
    await service().activate({ academyId, systemId: draft.systemId, actorId: "owner-1" });
    addHead("student-b", "bpt-only-belt");
    fake.records.set(`${prefix}/studentLevelProgress/student-b`, {
      ...fake.records.get(`${prefix}/studentLevelProgress/student-b`),
      systemId: draft.systemId,
    });

    await expect(
      service().activate({ academyId, systemId: "ibjjf-v3", actorId: "owner-1" }),
    ).rejects.toMatchObject({
      code: "missing-levels",
      missing: [{ definitionKey: "bpt-only-belt", students: 1 }],
    });

    fake.records.delete(`${prefix}/studentLevelProgress/student-b`);
    await expect(
      service().activate({ academyId, systemId: "ibjjf-v3", actorId: "owner-1" }),
    ).resolves.toMatchObject({ activeSystemId: "ibjjf-v3", previousSystemId: draft.systemId });
    expect(fake.records.get(`${prefix}/studentLevelProgress/student-a`)?.systemId).toBe("ibjjf-v3");
    const catalog = await createLevelCatalogStore({
      firestore: fake.firestore as unknown as GenericFirestore,
    }).listPublished(academyId);
    expect(catalog.system.systemId).toBe("ibjjf-v3");
  });

  it("refuses a draft and the version already active", async () => {
    const draft = await draftFromV3();
    await expect(
      service().activate({ academyId, systemId: draft.systemId, actorId: "owner-1" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service().activate({ academyId, systemId: "ibjjf-v3", actorId: "owner-1" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("listLevelCatalogVersions", () => {
  it("lists code and custom versions with the active flag", async () => {
    const draft = await draftFromV3();
    const { versions } = await service().listVersions(academyId);
    expect(versions).toEqual([
      {
        systemId: draft.systemId,
        displayName: draft.displayName,
        origin: "custom",
        status: "draft",
        active: false,
        publishedAt: null,
      },
      expect.objectContaining({ systemId: "ibjjf-v3", origin: "code", active: true }),
    ]);
  });
});
