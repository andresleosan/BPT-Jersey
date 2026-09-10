import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Firestore } from "firebase-admin/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RegyfitAccessRecord, UtcDateTime } from "@bpt-jersey/domain";

import {
  assertImportTargetIsSafe,
  importRegyfitAccessRecords,
  type ImportConfig,
} from "./access-import.js";

const timestamp = "2026-08-08T12:00:00.000Z" as UtcDateTime;
const sourceRoute = "/admin2/modulos/alunos/acessos_alunos.php";
const roots: string[] = [];

type StoredDocument = Record<string, unknown>;
type Transaction = Readonly<{
  get: (ref: {
    path: string;
  }) => Promise<{ exists: boolean; data: () => StoredDocument | undefined }>;
  create: (ref: { path: string }, data: StoredDocument) => Transaction;
  set: (ref: { path: string }, data: StoredDocument) => Transaction;
}>;

function createFirestore(options: { failCommit?: boolean } = {}) {
  const records = new Map<string, StoredDocument>();
  let writeCount = 0;
  let readCount = 0;

  const db = {
    doc(path: string) {
      return { id: path.split("/").at(-1) ?? "", path };
    },
    collection(path: string) {
      return { doc: (id = "synthetic-audit") => ({ id, path: `${path}/${id}` }) };
    },
    async runTransaction<T>(callback: (transaction: Transaction) => Promise<T>) {
      const staged = new Map<string, StoredDocument>();
      const transaction: Transaction = {
        get: async (ref) => {
          readCount += 1;
          return {
            exists: records.has(ref.path),
            data: () => staged.get(ref.path) ?? records.get(ref.path),
          };
        },
        create: (ref, data) => {
          if (records.has(ref.path) || staged.has(ref.path)) {
            throw new Error("synthetic firestore create collision");
          }
          staged.set(ref.path, { ...data });
          return transaction;
        },
        set: (ref, data) => {
          if (ref.path.includes("/auditEvents/")) {
            throw new Error("audit events must use transaction.create");
          }
          staged.set(ref.path, { ...data });
          return transaction;
        },
      };
      const result = await callback(transaction);
      if (options.failCommit) {
        throw new Error("synthetic transaction failure");
      }
      for (const [path, data] of staged) {
        writeCount += 1;
        records.set(path, data);
      }
      return result;
    },
  } as unknown as Firestore;

  return { db, records, getReadCount: () => readCount, getWriteCount: () => writeCount };
}

let previousEnvironment: Record<string, string | undefined> = {};

beforeEach(() => {
  previousEnvironment = {
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
    GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
    FIREBASE_CONFIG: process.env.FIREBASE_CONFIG,
    REGYFIT_OPERATOR_CONFIRMATION: process.env.REGYFIT_OPERATOR_CONFIRMATION,
  };
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  delete process.env.GCLOUD_PROJECT;
  delete process.env.FIREBASE_CONFIG;
  delete process.env.REGYFIT_OPERATOR_CONFIRMATION;
});

function config(privateStagingRoot: string, overrides: Partial<ImportConfig> = {}): ImportConfig {
  return {
    privateStagingRoot,
    runId: "synthetic-run-1",
    moduleKey: "alunos-acessos",
    sourceRoute,
    academyId: "42",
    target: "emulator",
    ...overrides,
  };
}

function sourceRow(sourceId: string) {
  return {
    sourceId,
    member: "Synthetic Member",
    memberNumber: "42",
    loginCount: 42,
    lastLogin: timestamp,
    ip: "203.0.113.10",
  };
}

function sourceEnvelope(sourceId: string) {
  return {
    runId: "synthetic-run-1",
    sourceSystem: "regyfit",
    sourceId,
    moduleKey: "alunos-acessos",
    capturedAtUtc: "2026-08-08T05:26:12.153Z",
    record: {
      member: "Synthetic Member",
      logins: "42",
      lastLogin: "Friday, 7 Aug 2026 - 17:23",
      ip: "203.0.113.10",
    },
  };
}

async function createChunk(
  options: {
    rows?: readonly unknown[];
    marker?: boolean;
    markerContents?: string;
    root?: string;
  } = {},
): Promise<string> {
  const root = options.root ?? (await mkdtemp(join(tmpdir(), "regyfit-import-")));
  if (!roots.includes(root)) {
    roots.push(root);
  }
  if (options.marker !== false) {
    await writeFile(
      join(root, ".regyfit-private-staging"),
      options.markerContents ?? '{"encryptionConfirmed":true}',
      "utf8",
    );
  }
  const run = "synthetic-run-1";
  const moduleSegment = "alunos-acessos";
  const directory = join(root, run, moduleSegment);
  await mkdir(directory, { recursive: true });
  const rows =
    options.rows ?? Array.from({ length: 10 }, (_, index) => sourceRow(`synthetic-${index + 1}`));
  await writeFile(
    join(directory, "chunk-000000.jsonl"),
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("Regyfit access importer", () => {
  it("accepts only the exact run, module and source route gates", async () => {
    const root = await createChunk();
    const db = createFirestore();

    for (const overrides of [
      { runId: "synthetic-other-run" },
      { moduleKey: "other-module" as ImportConfig["moduleKey"] },
      { sourceRoute: "/admin2/modulos/alunos/otro.php" },
    ]) {
      await expect(
        importRegyfitAccessRecords(config(root, overrides), db.db, timestamp),
      ).rejects.toThrow("Import configuration is not approved");
    }
    expect(db.getWriteCount()).toBe(0);
  });

  it("imports exactly ten validated rows with deterministic documents and hash", async () => {
    const root = await createChunk();
    const { db, records } = createFirestore();

    const receipt = await importRegyfitAccessRecords(config(root), db, timestamp);

    expect(receipt).toMatchObject({
      runId: "synthetic-run-1",
      moduleKey: "alunos-acessos",
      importedCount: 10,
      skippedCount: 0,
      contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      auditEventPath: "academies/42/auditEvents/regyfit-access-synthetic-run-1",
    });
    expect(
      [...records.keys()].filter((path) => path.includes("regyfitAccessRecords/")),
    ).toHaveLength(10);
    expect(records.get("academies/42/regyfitAccessRecords/synthetic-1")).toEqual(
      expect.objectContaining({ sourceId: "synthetic-1", memberDisplayName: "Synthetic Member" }),
    );
  });

  it("normalizes the captured envelope shape before writing", async () => {
    const root = await createChunk({
      rows: Array.from({ length: 10 }, (_, index) => sourceEnvelope(`synthetic-${index + 1}`)),
    });
    const { db, records } = createFirestore();

    const receipt = await importRegyfitAccessRecords(config(root), db, timestamp);

    expect(receipt.importedCount).toBe(10);
    expect(records.get("academies/42/regyfitAccessRecords/synthetic-1")).toEqual(
      expect.objectContaining({
        memberNumber: null,
        loginCount: 42,
        lastLoginAt: "2026-08-07T16:23:00.000Z",
      }),
    );
  });

  it("rejects malformed JSONL before any write and sanitizes the error", async () => {
    const rows = Array.from({ length: 10 }, (_, index) => sourceRow(`synthetic-${index + 1}`));
    const root = await createChunk();
    const chunkPath = join(root, "synthetic-run-1", "alunos-acessos", "chunk-000000.jsonl");
    const lines = rows.map((row) => JSON.stringify(row));
    lines[4] = `{"sourceId":"synthetic-5", invalid}`;
    await writeFile(chunkPath, `${lines.join("\n")}\n`, "utf8");
    const { db, records } = createFirestore();

    await expect(importRegyfitAccessRecords(config(root), db, timestamp)).rejects.toThrow(
      "Import chunk is invalid",
    );
    try {
      await importRegyfitAccessRecords(config(root), db, timestamp);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).not.toContain("synthetic-5");
      expect(message).not.toContain("Synthetic Member");
      expect(message).not.toContain("203.0.113.10");
      expect(message).not.toContain("Unexpected token");
    }
    expect(records).toEqual(new Map());
  });

  it("rejects wrong count and duplicate source IDs before any write", async () => {
    const nineRows = Array.from({ length: 9 }, (_, index) => sourceRow(`synthetic-${index + 1}`));
    const wrongCountRoot = await createChunk({ rows: nineRows });
    const wrongCountDb = createFirestore();
    await expect(
      importRegyfitAccessRecords(config(wrongCountRoot), wrongCountDb.db, timestamp),
    ).rejects.toThrow("Import requires exactly ten rows");
    expect(wrongCountDb.records).toEqual(new Map());

    const duplicateRows = Array.from({ length: 10 }, (_, index) =>
      sourceRow(`synthetic-${index + 1}`),
    );
    duplicateRows[9] = sourceRow("synthetic-1");
    const duplicateRoot = await createChunk({ rows: duplicateRows });
    const duplicateDb = createFirestore();
    await expect(
      importRegyfitAccessRecords(config(duplicateRoot), duplicateDb.db, timestamp),
    ).rejects.toThrow("Import rows are invalid");
    expect(duplicateDb.records).toEqual(new Map());
  });

  it("requires the private marker and rejects roots inside the repository", async () => {
    const missingMarkerRoot = await createChunk({ marker: false });
    const missingMarkerDb = createFirestore();
    await expect(
      importRegyfitAccessRecords(config(missingMarkerRoot), missingMarkerDb.db, timestamp),
    ).rejects.toThrow("Private staging is not approved");

    const repositoryRoot = join(process.cwd(), "synthetic-private-root");
    const repositoryDb = createFirestore();
    await expect(
      importRegyfitAccessRecords(config(repositoryRoot), repositoryDb.db, timestamp),
    ).rejects.toThrow("Private staging is not approved");
    expect(repositoryDb.records).toEqual(new Map());
  });

  it("accepts only the exact JSON metadata-only marker", async () => {
    for (const markerContents of [
      '{"encryptionConfirmed":false}',
      '{"encryptionConfirmed":true,"extra":false}',
      '{"encryptionConfirmed":true',
    ]) {
      const root = await createChunk({ markerContents });
      const db = createFirestore();

      await expect(importRegyfitAccessRecords(config(root), db.db, timestamp)).rejects.toThrow(
        "Private staging is not approved",
      );
      expect(db.getWriteCount()).toBe(0);
    }
  });

  it("rejects production targets and remote emulator hosts", () => {
    const previousHost = process.env.FIRESTORE_EMULATOR_HOST;
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    try {
      expect(() => assertImportTargetIsSafe(config("C:\\synthetic"), "production")).toThrow(
        "Import target is not safe",
      );
      process.env.FIRESTORE_EMULATOR_HOST = "192.0.2.10:8080";
      expect(() => assertImportTargetIsSafe(config("C:\\synthetic"), "demo-bpt-jersey")).toThrow(
        "Import target is not safe",
      );
    } finally {
      if (previousHost === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
      else process.env.FIRESTORE_EMULATOR_HOST = previousHost;
    }
  });

  it("rejects the known production project even with staging confirmation", () => {
    process.env.REGYFIT_OPERATOR_CONFIRMATION = "real-data-private-staging-v1";

    expect(() =>
      assertImportTargetIsSafe(config("C:\\synthetic", { target: "staging" }), "bptjersey-f5a25"),
    ).toThrow("Import target is not safe");

    process.env.GCLOUD_PROJECT = "bptjersey-f5a25";
    expect(() => assertImportTargetIsSafe(config("C:\\synthetic"), "demo-bpt-jersey")).toThrow(
      "Import target is not safe",
    );

    delete process.env.GCLOUD_PROJECT;
    process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: "bptjersey-f5a25" });
    expect(() => assertImportTargetIsSafe(config("C:\\synthetic"), "demo-bpt-jersey")).toThrow(
      "Import target is not safe",
    );
  });

  it("keeps staging disabled until a separate project is explicitly allowlisted", () => {
    process.env.REGYFIT_OPERATOR_CONFIRMATION = "real-data-private-staging-v1";

    expect(() =>
      assertImportTargetIsSafe(
        config("C:\\synthetic", { target: "staging" }),
        "bpt-jersey-staging",
      ),
    ).toThrow("Import target is not safe");
  });

  it("blocks the known production project before reading the root or Firestore", async () => {
    const root = join(tmpdir(), "synthetic-known-production-guard-root");
    const firestore = createFirestore();
    process.env.GCLOUD_PROJECT = "bptjersey-f5a25";
    process.env.REGYFIT_OPERATOR_CONFIRMATION = "real-data-private-staging-v1";

    await expect(
      importRegyfitAccessRecords(config(root, { target: "staging" }), firestore.db, timestamp),
    ).rejects.toThrow("Import target is not safe");
    expect(firestore.getReadCount()).toBe(0);
    expect(firestore.getWriteCount()).toBe(0);
  });

  it("blocks direct imports before touching the root or Firestore", async () => {
    const root = join(tmpdir(), "synthetic-direct-guard-root");
    const cases: readonly {
      config: ImportConfig;
      projectId: string;
      host?: string;
    }[] = [
      { config: config(root), projectId: "production" },
      { config: config(root), projectId: "demo-bpt-jersey", host: "192.0.2.10:8080" },
      { config: config(root, { target: "staging" }), projectId: "demo-bpt-jersey" },
    ];

    for (const testCase of cases) {
      const db = createFirestore();
      process.env.GCLOUD_PROJECT = testCase.projectId;
      if (testCase.host !== undefined) process.env.FIRESTORE_EMULATOR_HOST = testCase.host;
      if (testCase.config.target === "staging") delete process.env.REGYFIT_OPERATOR_CONFIRMATION;
      await expect(importRegyfitAccessRecords(testCase.config, db.db, timestamp)).rejects.toThrow(
        "Import target is not safe",
      );
      expect(db.getReadCount()).toBe(0);
      expect(db.getWriteCount()).toBe(0);
    }
  });

  it("rejects a symlinked private marker explicitly", async () => {
    const root = await createChunk();
    const markerPath = join(root, ".regyfit-private-staging");
    const markerTarget = join(root, "synthetic-marker-target");
    await rm(markerPath);
    await writeFile(markerTarget, '{"encryptionConfirmed":true}', "utf8");
    try {
      await symlink(markerTarget, markerPath, "file");
    } catch {
      throw new Error("Symlink test setup unavailable; refusing to skip marker-link coverage");
    }
    expect((await lstat(markerPath)).isSymbolicLink()).toBe(true);

    const db = createFirestore();
    await expect(importRegyfitAccessRecords(config(root), db.db, timestamp)).rejects.toThrow(
      "Private staging is not approved",
    );
    expect(db.getReadCount()).toBe(0);
    expect(db.getWriteCount()).toBe(0);
  });

  it("writes metadata-only audit once and makes a repeat skip all ten records", async () => {
    const root = await createChunk();
    const { db, records } = createFirestore();

    const first = await importRegyfitAccessRecords(config(root), db, timestamp);
    const second = await importRegyfitAccessRecords(config(root), db, timestamp);

    expect(first.importedCount).toBe(10);
    expect(second).toEqual({ ...first, importedCount: 0, skippedCount: 10 });
    expect(records.get("academies/42/regyfitAccessRecords/synthetic-1")?.capturedAt).toBe(
      timestamp,
    );
    const audits = [...records.entries()].filter(([path]) => path.includes("/auditEvents/"));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.[1]).toEqual(
      expect.objectContaining({
        auditEventId: "regyfit-access-synthetic-run-1",
        actorId: "system-regyfit-importer",
        purpose: "approved Regyfit access import",
        sourceRoute,
        importRunId: "synthetic-run-1",
        recordCount: 10,
        contentSha256: first.contentSha256,
        occurredAt: expect.anything(),
      }),
    );
    expect(audits[0]?.[1]).not.toHaveProperty("rawRecord");
    expect(audits[0]?.[1]).not.toHaveProperty("memberDisplayName");
    expect(audits[0]?.[1]).not.toHaveProperty("ip");
  });

  it("accepts an exact legacy audit replay without generated identity fields", async () => {
    const root = await createChunk();
    const { db, records } = createFirestore();
    const first = await importRegyfitAccessRecords(config(root), db, timestamp);
    const audit = records.get(first.auditEventPath);
    expect(audit).toBeDefined();
    const legacy = { ...(audit as StoredDocument) };
    delete legacy.auditEventId;
    delete legacy.occurredAt;
    records.set(first.auditEventPath, legacy);

    await expect(importRegyfitAccessRecords(config(root), db, timestamp)).resolves.toEqual({
      ...first,
      importedCount: 0,
      skippedCount: 10,
    });
    expect(records.get(first.auditEventPath)).toEqual(legacy);
  });

  it("rejects divergent or extended audit replays without overwriting them", async () => {
    const root = await createChunk();
    for (const mutate of [
      (audit: StoredDocument) => ({ ...audit, purpose: "changed purpose" }),
      (audit: StoredDocument) => ({ ...audit, contentSha256: "f".repeat(64) }),
      (audit: StoredDocument) => ({ ...audit, email: "person@example.test" }),
    ]) {
      const { db, records } = createFirestore();
      const first = await importRegyfitAccessRecords(config(root), db, timestamp);
      const changed = mutate(records.get(first.auditEventPath) as StoredDocument);
      records.set(first.auditEventPath, changed);

      await expect(importRegyfitAccessRecords(config(root), db, timestamp)).rejects.toThrow(
        "Import conflicts with existing audit data",
      );
      expect(records.get(first.auditEventPath)).toEqual(changed);
    }
  });

  it("aborts on a conflicting document without overwriting it or writing audit", async () => {
    const root = await createChunk();
    const { db, records } = createFirestore();
    const conflictPath = "academies/42/regyfitAccessRecords/synthetic-1";
    const conflict: RegyfitAccessRecord = {
      academyId: "42",
      sourceSystem: "regyfit",
      sourceId: "synthetic-1",
      memberDisplayName: "Synthetic Member",
      memberNumber: "42",
      loginCount: 42,
      lastLoginAt: timestamp,
      ip: "203.0.113.10",
      importRunId: "synthetic-conflict-run",
      capturedAt: timestamp,
      schemaVersion: "1",
    };
    records.set(conflictPath, conflict);

    await expect(importRegyfitAccessRecords(config(root), db, timestamp)).rejects.toThrow(
      "Import conflicts with existing data",
    );
    expect(records.get(conflictPath)).toEqual(conflict);
    expect([...records.keys()].some((path) => path.includes("/auditEvents/"))).toBe(false);
  });

  it("produces the same hash when rows and source keys are reordered", async () => {
    const firstRoot = await createChunk();
    const firstDb = createFirestore();
    const reorderedRows = Array.from({ length: 10 }, (_, index) => {
      const sourceId = `synthetic-${10 - index}`;
      return {
        ip: "203.0.113.10",
        lastLogin: timestamp,
        loginCount: 42,
        memberNumber: "42",
        member: "Synthetic Member",
        sourceId,
      };
    });
    const secondRoot = await createChunk({ rows: reorderedRows });
    const secondDb = createFirestore();
    const localeCompareSpy = vi.spyOn(String.prototype, "localeCompare").mockImplementation(() => {
      throw new Error("locale-dependent comparator used");
    });
    let first;
    let second;
    try {
      first = await importRegyfitAccessRecords(config(firstRoot), firstDb.db, timestamp);
      second = await importRegyfitAccessRecords(config(secondRoot), secondDb.db, timestamp);
    } finally {
      localeCompareSpy.mockRestore();
    }

    expect(second.contentSha256).toBe(first.contentSha256);
  });

  it("rolls back all staged writes and leaves no audit when the transaction fails", async () => {
    const root = await createChunk();
    const { db, records } = createFirestore({ failCommit: true });

    await expect(importRegyfitAccessRecords(config(root), db, timestamp)).rejects.toThrow(
      "Import could not be completed",
    );
    expect(records).toEqual(new Map());
  });
});
