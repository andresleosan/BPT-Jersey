import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertCanonicalUtcDateTime,
  assertImportTargetIsSafe,
  importRegyfitAccessRecords,
  type ImportConfig,
} from "../../apps/functions/src/regyfit/access-import.js";
import type { UtcDateTime } from "@bpt-jersey/domain";

const timestamp = "2026-08-08T12:00:00.000Z" as UtcDateTime;
const sourceRoute = "/admin2/modulos/alunos/acessos_alunos.php";
const roots: string[] = [];
let previousEmulatorHost: string | undefined;

beforeEach(() => {
  previousEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
});

function row(sourceId: string) {
  return {
    sourceId,
    member: "Synthetic Member",
    memberNumber: "42",
    loginCount: 42,
    lastLogin: timestamp,
    ip: "203.0.113.10",
  };
}

function config(root: string, overrides: Partial<ImportConfig> = {}): ImportConfig {
  return {
    privateStagingRoot: root,
    runId: "synthetic-qa-run-1",
    moduleKey: "alunos-acessos",
    sourceRoute,
    academyId: "42",
    target: "emulator",
    ...overrides,
  };
}

function db() {
  const records = new Map<string, Record<string, unknown>>();
  const firestore = {
    doc: (path: string) => ({ path, id: path.split("/").at(-1) ?? "" }),
    collection: (path: string) => ({
      doc: (id = "synthetic-audit") => ({ path: `${path}/${id}`, id }),
    }),
    runTransaction: async <T>(callback: (transaction: never) => Promise<T>) => {
      const staged = new Map<string, Record<string, unknown>>();
      const transaction = {
        get: async (ref: { path: string }) => ({
          exists: records.has(ref.path),
          data: () => staged.get(ref.path) ?? records.get(ref.path),
        }),
        create: (ref: { path: string }, data: Record<string, unknown>) => {
          if (records.has(ref.path) || staged.has(ref.path)) {
            throw new Error("synthetic create collision");
          }
          staged.set(ref.path, data);
          return transaction;
        },
        set: (ref: { path: string }, data: Record<string, unknown>) => {
          staged.set(ref.path, data);
          return transaction;
        },
      };
      const result = await callback(transaction as never);
      for (const [path, data] of staged) records.set(path, data);
      return result;
    },
  };
  return { firestore, records };
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "regyfit-qa-import-"));
  roots.push(root);
  await writeFile(join(root, ".regyfit-private-staging"), '{"encryptionConfirmed":true}', "utf8");
  const directory = join(root, "synthetic-qa-run-1", "alunos-acessos");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(directory, { recursive: true }));
  const rows = Array.from({ length: 10 }, (_, index) => row(`synthetic-qa-${index + 1}`));
  await writeFile(
    join(directory, "chunk-000000.jsonl"),
    `${rows.map((value) => JSON.stringify(value)).join("\n")}\n`,
    "utf8",
  );
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  if (previousEmulatorHost === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
  else process.env.FIRESTORE_EMULATOR_HOST = previousEmulatorHost;
});

describe("QA synthetic Regyfit importer boundary", () => {
  it("uses only the fixed chunk path and keeps the receipt sanitized", async () => {
    const root = await fixture();
    const result = await importRegyfitAccessRecords(
      config(root),
      db().firestore as never,
      timestamp,
    );

    expect(result.importedCount + result.skippedCount).toBe(10);
    expect(result.auditEventPath).toBe(
      "academies/42/auditEvents/regyfit-access-synthetic-qa-run-1",
    );
    expect(result).not.toHaveProperty("privateStagingRoot");
    expect(result).not.toHaveProperty("rawRecords");
  });

  it("fails closed for an unapproved project and staging without operator confirmation", () => {
    const previousConfirmation = process.env.REGYFIT_OPERATOR_CONFIRMATION;
    const previousHost = process.env.FIRESTORE_EMULATOR_HOST;
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    delete process.env.REGYFIT_OPERATOR_CONFIRMATION;
    try {
      expect(() =>
        assertImportTargetIsSafe(config("C:\\synthetic"), "bpt-jersey-production"),
      ).toThrow("Import target is not safe");
      process.env.REGYFIT_OPERATOR_CONFIRMATION = "real-data-private-staging-v1";
      expect(() =>
        assertImportTargetIsSafe(config("C:\\synthetic", { target: "staging" }), "bptjersey-f5a25"),
      ).toThrow("Import target is not safe");
      delete process.env.REGYFIT_OPERATOR_CONFIRMATION;
      expect(() =>
        assertImportTargetIsSafe(
          config("C:\\synthetic", { target: "staging" }),
          "bpt-jersey-staging",
        ),
      ).toThrow("Import target is not safe");
    } finally {
      if (previousConfirmation === undefined) delete process.env.REGYFIT_OPERATOR_CONFIRMATION;
      else process.env.REGYFIT_OPERATOR_CONFIRMATION = previousConfirmation;
      if (previousHost === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
      else process.env.FIRESTORE_EMULATOR_HOST = previousHost;
    }
  });

  it("requires explicit capturedAt and does not generate a variable timestamp in the runner", async () => {
    const runner = await readFile(
      new URL("../scripts/import-regyfit-access.mjs", import.meta.url),
      "utf8",
    );

    expect(runner).toContain('"REGYFIT_CAPTURED_AT"');
    expect(runner).not.toContain("new Date()");
  });

  it("accepts only canonical UTC capturedAt values", () => {
    expect(assertCanonicalUtcDateTime(timestamp)).toBe(timestamp);
    for (const invalid of ["2026-08-08T12:00:00Z", "2026-08-08T14:00:00.000+02:00"]) {
      expect(() => assertCanonicalUtcDateTime(invalid)).toThrow("Import timestamp is invalid");
    }
  });
});
