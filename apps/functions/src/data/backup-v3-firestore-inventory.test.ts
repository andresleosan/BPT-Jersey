import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  BackupV3FirestoreInventoryError,
  readBackupV3FirestoreNamespaceInventory,
  type BackupV3FirestoreInventoryClient,
  type BackupV3FirestoreInventoryLimits,
  type BackupV3FirestoreV1Document,
  type BackupV3FirestoreV1Timestamp,
} from "./backup-v3-firestore-inventory.js";

const projectId = "demo-bpt-jersey";
const academyId = "academy-inventory-1";
const database = `projects/${projectId}/databases/(default)/documents`;
const readTime: BackupV3FirestoreV1Timestamp = Object.freeze({
  seconds: String(Math.floor(Date.parse("2026-09-03T12:05:00.123Z") / 1_000)),
  nanos: 123_000_000,
});
const productionLikeLimits: BackupV3FirestoreInventoryLimits = Object.freeze({
  maxRealDocumentCount: 12_048,
  maxDecodedBytes: 288 * 1_024 * 1_024,
  maxVisitedPathCount: 12_049,
});

function resource(path: string): string {
  return `${database}/${path}`;
}

function encodedValue(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null) return { nullValue: 0 };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodedValue) } };
  }
  return {
    mapValue: {
      fields: Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          encodedValue(item),
        ]),
      ),
    },
  };
}

function document(
  path: string,
  data: Readonly<Record<string, unknown>>,
  name = resource(path),
): BackupV3FirestoreV1Document {
  return Object.freeze({
    name,
    fields: Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, encodedValue(value)]),
    ),
    createTime: readTime,
    updateTime: readTime,
  });
}

function missing(path: string, name = resource(path)): BackupV3FirestoreV1Document {
  return Object.freeze({ name });
}

type CollectionPage = Readonly<{
  collectionIds: readonly string[];
  nextPageToken?: string;
}>;
type DocumentPage = Readonly<{
  documents: readonly BackupV3FirestoreV1Document[];
  nextPageToken?: string;
}>;

function collectionKey(parent: string, pageToken = ""): string {
  return `${parent}\n${pageToken}`;
}

function documentKey(parent: string, collectionId: string, pageToken = ""): string {
  return `${parent}\n${collectionId}\n${pageToken}`;
}

function sourceScripts() {
  const collections = new Map<string, CollectionPage>([
    [collectionKey(database), { collectionIds: ["academies"], nextPageToken: "root-2" }],
    [collectionKey(database, "root-2"), { collectionIds: ["memberDirectoryRestoreGuards"] }],
    [
      collectionKey(resource(`academies/${academyId}`)),
      { collectionIds: ["memberDirectoryStates"], nextPageToken: "academy-2" },
    ],
    [
      collectionKey(resource(`academies/${academyId}`), "academy-2"),
      { collectionIds: ["students"] },
    ],
    [
      collectionKey(resource(`academies/${academyId}/students/student-1`)),
      { collectionIds: ["evaluations"] },
    ],
    [
      collectionKey(resource(`memberDirectoryRestoreGuards/${academyId}`)),
      { collectionIds: ["events"] },
    ],
  ]);
  const documents = new Map<string, DocumentPage>([
    [documentKey(database, "academies"), { documents: [missing(`academies/${academyId}`)] }],
    [
      documentKey(resource(`academies/${academyId}`), "memberDirectoryStates"),
      {
        documents: [document(`academies/${academyId}/memberDirectoryStates/current`, { value: 1 })],
      },
    ],
    [
      documentKey(resource(`academies/${academyId}`), "students"),
      {
        documents: [
          document(`academies/${academyId}/students/student-1`, {
            academyId,
            tags: ["synthetic"],
          }),
        ],
      },
    ],
    [
      documentKey(resource(`academies/${academyId}/students/student-1`), "evaluations"),
      {
        documents: [
          document(`academies/${academyId}/students/student-1/evaluations/evaluation-1`, {
            score: 1,
          }),
        ],
      },
    ],
    [
      documentKey(database, "memberDirectoryRestoreGuards"),
      { documents: [document(`memberDirectoryRestoreGuards/${academyId}`, { revision: 0 })] },
    ],
    [
      documentKey(resource(`memberDirectoryRestoreGuards/${academyId}`), "events"),
      {
        documents: [
          document(`memberDirectoryRestoreGuards/${academyId}/events/0`, { revision: 0 }),
        ],
      },
    ],
  ]);
  return { collections, documents };
}

function scriptedClient(
  input: Readonly<{
    collections?: Map<string, CollectionPage>;
    documents?: Map<string, DocumentPage>;
    batchResponses?: readonly (readonly Readonly<Record<string, unknown>>[])[];
    rejectShowMissing?: boolean;
  }> = {},
) {
  const scripts = sourceScripts();
  const collectionRequests: Record<string, unknown>[] = [];
  const documentRequests: Record<string, unknown>[] = [];
  const batchRequests: Record<string, unknown>[] = [];
  let batchIndex = 0;
  const client: BackupV3FirestoreInventoryClient = {
    batchGetDocuments: async (request) => {
      batchRequests.push(request);
      const scripted = input.batchResponses?.[batchIndex];
      batchIndex += 1;
      if (scripted !== undefined) return scripted;
      return request.documents.map((name) => ({
        found: document(
          name.endsWith("/memberDirectoryStates/current")
            ? `academies/${academyId}/memberDirectoryStates/current`
            : `memberDirectoryRestoreGuards/${academyId}`,
          { anchor: true },
          name,
        ),
        readTime,
      }));
    },
    listCollectionIds: async (request) => {
      collectionRequests.push(request);
      return (
        (input.collections ?? scripts.collections).get(
          collectionKey(request.parent, request.pageToken ?? ""),
        ) ?? { collectionIds: [] }
      );
    },
    listDocuments: async (request) => {
      documentRequests.push(request);
      if (input.rejectShowMissing && request.showMissing) {
        throw new Error("showMissing unsupported");
      }
      return (
        (input.documents ?? scripts.documents).get(
          documentKey(request.parent, request.collectionId, request.pageToken ?? ""),
        ) ?? { documents: [] }
      );
    },
  };
  return { client, collectionRequests, documentRequests, batchRequests };
}

function expectCode(error: unknown, code: string): boolean {
  expect(error).toBeInstanceOf(BackupV3FirestoreInventoryError);
  expect(error).toMatchObject({ code });
  return true;
}

async function readSource(client: BackupV3FirestoreInventoryClient, limits = productionLikeLimits) {
  return readBackupV3FirestoreNamespaceInventory({
    client,
    projectId,
    academyId,
    role: "source",
    limits,
  });
}

describe("backup v3 Firestore namespace inventory v1", () => {
  it("binds one batch-get readTime across explicit collection/document pagination", async () => {
    const fake = scriptedClient();

    const result = await readSource(fake.client);

    expect(result).toEqual({
      projectId,
      readTime: "2026-09-03T12:05:00.123Z",
      entries: [
        { path: `academies/${academyId}`, exists: false },
        {
          path: `academies/${academyId}/memberDirectoryStates/current`,
          exists: true,
          data: {
            codecVersion: "firestore-value-v1",
            fields: { value: { type: "integer", value: "1" } },
          },
        },
        {
          path: `academies/${academyId}/students/student-1`,
          exists: true,
          data: {
            codecVersion: "firestore-value-v1",
            fields: {
              academyId: { type: "string", value: academyId },
              tags: {
                type: "array",
                values: [{ type: "string", value: "synthetic" }],
              },
            },
          },
        },
        {
          path: `academies/${academyId}/students/student-1/evaluations/evaluation-1`,
          exists: true,
          data: {
            codecVersion: "firestore-value-v1",
            fields: { score: { type: "integer", value: "1" } },
          },
        },
        {
          path: `memberDirectoryRestoreGuards/${academyId}`,
          exists: true,
          data: {
            codecVersion: "firestore-value-v1",
            fields: { revision: { type: "integer", value: "0" } },
          },
        },
        {
          path: `memberDirectoryRestoreGuards/${academyId}/events/0`,
          exists: true,
          data: {
            codecVersion: "firestore-value-v1",
            fields: { revision: { type: "integer", value: "0" } },
          },
        },
      ],
    });
    expect(fake.batchRequests).toHaveLength(2);
    expect(fake.batchRequests[0]).not.toHaveProperty("readTime");
    expect(fake.batchRequests[1]).toMatchObject({ readTime });
    expect(fake.collectionRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ parent: database, pageToken: "root-2" }),
        expect.objectContaining({
          parent: resource(`academies/${academyId}`),
          pageToken: "academy-2",
        }),
      ]),
    );
    for (const request of fake.collectionRequests) {
      expect(request).toMatchObject({ pageSize: 200, readTime });
    }
    for (const request of fake.documentRequests) {
      expect(request).toMatchObject({ pageSize: 200, readTime, showMissing: true });
    }
  });

  it("rejects missing, changing or unsupported snapshot readTime behavior", async () => {
    for (const [fake, code] of [
      [
        scriptedClient({
          batchResponses: [
            [{ found: document(`academies/${academyId}/memberDirectoryStates/current`, {}) }],
          ],
        }),
        "invalid-read-time",
      ],
      [
        scriptedClient({
          batchResponses: [
            [
              {
                found: document(`academies/${academyId}/memberDirectoryStates/current`, {}),
                readTime,
              },
              {
                found: document(`memberDirectoryRestoreGuards/${academyId}`, {}),
                readTime: { ...readTime, nanos: 124_000_000 },
              },
            ],
          ],
        }),
        "invalid-read-time",
      ],
      [scriptedClient({ rejectShowMissing: true }), "snapshot-not-supported"],
    ] as const) {
      await expect(readSource(fake.client)).rejects.toSatisfy((error: unknown) =>
        expectCode(error, code),
      );
    }
  });

  it("rejects repeated tokens, duplicate documents and out-of-project resources", async () => {
    const repeatedScripts = sourceScripts();
    repeatedScripts.collections.set(collectionKey(database, "root-2"), {
      collectionIds: ["memberDirectoryRestoreGuards"],
      nextPageToken: "root-2",
    });

    const duplicateScripts = sourceScripts();
    duplicateScripts.documents.set(documentKey(resource(`academies/${academyId}`), "students"), {
      documents: [document(`academies/${academyId}/students/student-1`, {})],
      nextPageToken: "students-2",
    });
    duplicateScripts.documents.set(
      documentKey(resource(`academies/${academyId}`), "students", "students-2"),
      { documents: [document(`academies/${academyId}/students/student-1`, {})] },
    );

    const outsideScripts = sourceScripts();
    outsideScripts.documents.set(documentKey(resource(`academies/${academyId}`), "students"), {
      documents: [
        document(
          `academies/${academyId}/students/student-1`,
          {},
          `projects/other-project/databases/(default)/documents/academies/${academyId}/students/student-1`,
        ),
      ],
    });

    for (const [client, code] of [
      [scriptedClient({ collections: repeatedScripts.collections }).client, "pagination-cycle"],
      [scriptedClient({ documents: duplicateScripts.documents }).client, "duplicate-path"],
      [scriptedClient({ documents: outsideScripts.documents }).client, "out-of-scope-path"],
    ] as const) {
      await expect(readSource(client)).rejects.toSatisfy((error: unknown) =>
        expectCode(error, code),
      );
    }
  });

  it("rejects a collection one level too deep and an orphan delivered on page two", async () => {
    const deepScripts = sourceScripts();
    deepScripts.collections.set(
      collectionKey(resource(`academies/${academyId}/students/student-1/evaluations/evaluation-1`)),
      { collectionIds: ["secrets"] },
    );

    const orphanScripts = sourceScripts();
    orphanScripts.documents.set(documentKey(resource(`academies/${academyId}`), "students"), {
      documents: [document(`academies/${academyId}/students/student-1`, {})],
      nextPageToken: "students-2",
    });
    orphanScripts.documents.set(
      documentKey(resource(`academies/${academyId}`), "students", "students-2"),
      { documents: [missing(`academies/${academyId}/students/ghost`)] },
    );

    await expect(
      readSource(scriptedClient({ collections: deepScripts.collections }).client),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "invalid-depth"));
    await expect(
      readSource(scriptedClient({ documents: orphanScripts.documents }).client),
    ).rejects.toSatisfy((error: unknown) => expectCode(error, "orphan"));
  });

  it("enforces real-document, decoded-byte and visited-path budgets before returning", async () => {
    for (const [limits, code] of [
      [{ ...productionLikeLimits, maxRealDocumentCount: 1 }, "limit-exceeded"],
      [{ ...productionLikeLimits, maxDecodedBytes: 1 }, "limit-exceeded"],
      [{ ...productionLikeLimits, maxVisitedPathCount: 0 }, "limit-exceeded"],
    ] as const) {
      await expect(readSource(scriptedClient().client, limits)).rejects.toSatisfy(
        (error: unknown) => expectCode(error, code),
      );
    }
  });

  it("uses an exact missing sentinel to inventory an empty target", async () => {
    const fake = scriptedClient({
      collections: new Map(),
      documents: new Map(),
      batchResponses: [
        [
          {
            missing: resource(`backupV3InventorySentinels/${projectId}`),
            readTime,
          },
        ],
        [
          {
            missing: resource(`backupV3InventorySentinels/${projectId}`),
            readTime,
          },
        ],
      ],
    });

    const result = await readBackupV3FirestoreNamespaceInventory({
      client: fake.client,
      projectId,
      academyId,
      role: "target",
      limits: productionLikeLimits,
    });

    expect(result.entries).toEqual([]);
    expect(fake.batchRequests).toHaveLength(2);
    expect(JSON.stringify(fake.batchRequests)).not.toContain("googleapis.com");
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeGreaterThan(0);
  });
});
