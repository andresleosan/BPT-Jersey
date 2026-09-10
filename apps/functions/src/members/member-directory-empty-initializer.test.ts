import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  EMPTY_CANONICAL_INITIALIZER_CONFIRMATION,
  runEmptyCanonicalMemberDirectoryInitializer,
  type EmptyCanonicalDirectoryStore,
  type VerifiedPrivateEmptyIdentityBaseline,
} from "./member-directory-empty-initializer.js";
import {
  createEmptyCanonicalMemberDirectoryFirestoreStore,
  type EmptyCanonicalFirestoreLike,
} from "./member-directory-empty-initializer-firestore.js";
import {
  createLocalEmptyIdentityBaselineAdapter,
  loadEmptyCanonicalInitializerSecrets,
  type EmptyBaselineFileIo,
} from "./member-directory-empty-baseline-local.js";

const projectId = "demo-bpt-jersey";
const academyId = "academy-empty-1";
const now = "2026-09-03T20:00:00.000Z";
const integritySecret = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const identitySecret = "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8";
const encryptionSecret = "YGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn8";
const secondIdentitySecret = Buffer.from(
  Array.from({ length: 32 }, (_, index) => 0x80 + index),
).toString("base64url");
const secondIntegritySecret = Buffer.from(
  Array.from({ length: 32 }, (_, index) => 0xa0 + index),
).toString("base64url");
const baselineRootUrl = new URL("file:///C:/synthetic-repo/.tmp/member-directory-baselines/");

const safeEnvironment = Object.freeze({
  GCLOUD_PROJECT: projectId,
  GOOGLE_CLOUD_PROJECT: projectId,
  FIREBASE_CONFIG: JSON.stringify({ projectId }),
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
});

const verifiedBaseline: VerifiedPrivateEmptyIdentityBaseline = Object.freeze({
  artifactKind: "member-directory-empty-identity-baseline-v1",
  artifactId: "empty-baseline-academy-empty-1",
  projectId,
  academyId,
  identityKeyCount: 0,
  digestVersion: "hmac-sha256-v1",
  identitySecretVersion: "identity-v1",
  baselineMac: "a".repeat(64),
  integrityMacVersion: "hmac-sha256-v1",
  integritySecretVersion: "integrity-v1",
  schemaVersion: "1",
  artifactMac: "b".repeat(64),
});

const integrityBinding = Object.freeze({
  material: integritySecret,
  version: "integrity-v1" as const,
});

function validRequest() {
  return {
    arguments: [
      `--academy-id=${academyId}`,
      `--confirmation=${EMPTY_CANONICAL_INITIALIZER_CONFIRMATION}`,
    ],
    environment: safeEnvironment,
    now: () => now,
  } as const;
}

describe("empty canonical member-directory initializer", () => {
  it("fails closed before baseline or Firebase for every unsafe preflight", async () => {
    const reopen = vi.fn(async () => verifiedBaseline);
    const createStore = vi.fn<() => EmptyCanonicalDirectoryStore>();
    const dependencies = {
      reopenAndVerifyPrivateEmptyBaseline: reopen,
      getIntegritySecret: () => integrityBinding,
      createStore,
    };

    await expect(
      runEmptyCanonicalMemberDirectoryInitializer(
        {
          ...validRequest(),
          arguments: [`--academy-id=${academyId}`, "--confirmation=wrong"],
        },
        dependencies,
      ),
    ).rejects.toThrow(/arguments|confirmation/i);
    await expect(
      runEmptyCanonicalMemberDirectoryInitializer(
        {
          ...validRequest(),
          environment: { ...safeEnvironment, GCLOUD_PROJECT: "other-project" },
        },
        dependencies,
      ),
    ).rejects.toThrow(/environment/i);
    await expect(
      runEmptyCanonicalMemberDirectoryInitializer(validRequest(), {
        getIntegritySecret: () => integrityBinding,
        createStore,
      }),
    ).rejects.toThrow(/private.*baseline.*disabled/i);

    expect(reopen).not.toHaveBeenCalled();
    expect(createStore).not.toHaveBeenCalled();
  });

  it("binds an explicitly verified empty baseline and creates the revision-zero tuple", async () => {
    let written: Parameters<EmptyCanonicalDirectoryStore["initializeAtomically"]>[0] | undefined;
    const store: EmptyCanonicalDirectoryStore = {
      projectId,
      initializeAtomically: vi.fn(async (documents) => {
        written = documents;
      }),
    };

    const result = await runEmptyCanonicalMemberDirectoryInitializer(validRequest(), {
      reopenAndVerifyPrivateEmptyBaseline: async () => verifiedBaseline,
      getIntegritySecret: () => integrityBinding,
      createStore: () => store,
    });

    expect(result).toEqual({
      academyId,
      stateRevision: 0,
      baselineArtifactId: verifiedBaseline.artifactId,
    });
    expect(written?.state).toMatchObject({
      stateId: "current",
      academyId,
      readerVersion: "canonical-v1",
      directoryWriteMode: "canonical-v1",
      freezeStatus: "open",
      stateRevision: 0,
      globalLegacyReadEliminated: false,
      identityKeyCoverage: "complete",
      digestVersion: "hmac-sha256-v1",
      secretVersion: "identity-v1",
      identityKeyBaselineMac: verifiedBaseline.baselineMac,
      identityKeyBaselineArtifactId: verifiedBaseline.artifactId,
      rollbackEligibleStudentCount: 0,
      operationPhase: "idle",
      lastCommittedChunkNo: 0,
    });
    expect(written?.guard).toMatchObject({
      projectId,
      academyId,
      highestStateRevision: 0,
      lastEventId: "0",
    });
    expect(written?.event).toMatchObject({
      projectId,
      academyId,
      eventId: "0",
      previousStateRevision: -1,
      currentStateRevision: 0,
      transitionKind: "initialize",
    });
  });

  it("uses one transaction, reads every required boundary first and creates nothing when any is non-empty", async () => {
    const documents = await initializedDocuments();
    const empty = fakeFirestore();
    const store = createEmptyCanonicalMemberDirectoryFirestoreStore(empty.firestore);

    await store.initializeAtomically(documents);

    expect(empty.transactionCount()).toBe(1);
    expect(empty.readPaths()).toEqual([
      `academies/${academyId}/memberDirectoryStates/current`,
      `memberDirectoryRestoreGuards/${academyId}`,
      `memberDirectoryRestoreGuards/${academyId}/events`,
      `academies/${academyId}/members`,
      `academies/${academyId}/students`,
      `academies/${academyId}/studentAdminProfiles`,
      `academies/${academyId}/studentIdentityKeys`,
      `academies/${academyId}/studentRestrictedReadLimits`,
      `academies/${academyId}/memberDirectoryCursorStates`,
      `academies/${academyId}/memberDirectoryStates`,
      `academies/${academyId}/memberDirectoryMigrations`,
      `academies/${academyId}/memberDirectoryMigrationChunks`,
      `academies/${academyId}/memberDirectoryApprovals`,
      `academies/${academyId}/memberDirectoryApprovalConsumptions`,
      `academies/${academyId}/memberDirectoryWriteReceipts`,
      `academies/${academyId}/familyWriteReceipts`,
      `academies/${academyId}/profileWriteReceipts`,
      `academies/${academyId}/memberDirectoryImportReceipts`,
      `academies/${academyId}/memberDirectoryImportSessions`,
      `academies/${academyId}/auditEvents`,
    ]);
    expect(empty.createdPaths()).toEqual([
      `academies/${academyId}/memberDirectoryStates/current`,
      `memberDirectoryRestoreGuards/${academyId}`,
      `memberDirectoryRestoreGuards/${academyId}/events/0`,
    ]);

    for (const occupiedPath of empty.readPaths()) {
      const occupied = fakeFirestore(occupiedPath);
      const occupiedStore = createEmptyCanonicalMemberDirectoryFirestoreStore(occupied.firestore);
      await expect(occupiedStore.initializeAtomically(documents)).rejects.toThrow(
        /not completely empty/i,
      );
      expect(occupied.transactionCount()).toBe(1);
      expect(occupied.createdPaths()).toEqual([]);
    }
  });

  it("creates wx and reopens an encrypted, secret-free baseline while rejecting tampering", async () => {
    const file = memoryBaselineFile();
    const secrets = loadEmptyCanonicalInitializerSecrets({
      MEMBER_DIRECTORY_IDENTITY_KEY_SECRET: identitySecret,
      MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET: integritySecret,
      MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET: encryptionSecret,
    });
    const adapter = createLocalEmptyIdentityBaselineAdapter({
      secrets,
      artifactRootUrl: baselineRootUrl,
      io: file.io,
    });

    const first = await adapter.ensureAndReopen({ projectId, academyId });
    const replay = await adapter.ensureAndReopen({ projectId, academyId });

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      artifactKind: "member-directory-empty-identity-baseline-v1",
      projectId,
      academyId,
      identityKeyCount: 0,
      identitySecretVersion: "identity-v1",
      integritySecretVersion: "integrity-v1",
    });
    expect(file.writeOptions()).toEqual({ encoding: "utf8", flag: "wx", mode: 0o600 });
    expect(file.writeAttempts()).toBe(2);
    const expectedRoot = fileURLToPath(baselineRootUrl).replace(/[\\/]+$/u, "");
    expect(file.directoryPath().replace(/[\\/]+$/u, "")).toBe(expectedRoot);
    expect(dirname(file.artifactPath())).toBe(expectedRoot);
    const serialized = file.serialized();
    expect(serialized).not.toContain(identitySecret);
    expect(serialized).not.toContain(integritySecret);
    expect(serialized).not.toContain(encryptionSecret);
    expect(Object.keys(JSON.parse(serialized)).sort()).toEqual(
      [
        "academyId",
        "algorithm",
        "artifactId",
        "authTag",
        "ciphertext",
        "encryptionSecretVersion",
        "envelopeKind",
        "identitySecretVersion",
        "integritySecretVersion",
        "iv",
        "projectId",
        "schemaVersion",
      ].sort(),
    );

    file.tamperCiphertext();
    await expect(adapter.ensureAndReopen({ projectId, academyId })).rejects.toThrow(
      /invalid private empty baseline/i,
    );
  });

  it("MACs the empty baseline with integrity material while identity contributes only its version", async () => {
    async function createBaseline(materials: Readonly<{ identity: string; integrity: string }>) {
      const file = memoryBaselineFile();
      const secrets = loadEmptyCanonicalInitializerSecrets({
        MEMBER_DIRECTORY_IDENTITY_KEY_SECRET: materials.identity,
        MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET: materials.integrity,
        MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET: encryptionSecret,
      });
      return createLocalEmptyIdentityBaselineAdapter({
        secrets,
        artifactRootUrl: baselineRootUrl,
        io: file.io,
      }).ensureAndReopen({ projectId, academyId });
    }

    const first = await createBaseline({ identity: identitySecret, integrity: integritySecret });
    const changedIdentity = await createBaseline({
      identity: secondIdentitySecret,
      integrity: integritySecret,
    });
    const changedIntegrity = await createBaseline({
      identity: identitySecret,
      integrity: secondIntegritySecret,
    });

    expect(changedIdentity.baselineMac).toBe(first.baselineMac);
    expect(changedIdentity.artifactMac).toBe(first.artifactMac);
    expect(changedIntegrity.baselineMac).not.toBe(first.baselineMac);
    expect(changedIntegrity.artifactMac).not.toBe(first.artifactMac);
  });

  it("rejects missing, placeholder, repeated-byte and equal-purpose secrets", () => {
    const valid = {
      MEMBER_DIRECTORY_IDENTITY_KEY_SECRET: identitySecret,
      MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET: integritySecret,
      MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET: encryptionSecret,
    } as const;
    expect(() => loadEmptyCanonicalInitializerSecrets({ ...valid })).not.toThrow();
    expect(() =>
      loadEmptyCanonicalInitializerSecrets({
        ...valid,
        MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET: identitySecret,
      }),
    ).toThrow(/distinct/i);
    expect(() =>
      loadEmptyCanonicalInitializerSecrets({
        ...valid,
        MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET: Buffer.from(
          "change-me-placeholder-secret-value!",
          "utf8",
        ).toString("base64url"),
      }),
    ).toThrow(/invalid/i);
    expect(() =>
      loadEmptyCanonicalInitializerSecrets({
        ...valid,
        MEMBER_DIRECTORY_IDENTITY_KEY_SECRET: Buffer.alloc(32, 7).toString("base64url"),
      }),
    ).toThrow(/invalid/i);
    expect(() =>
      loadEmptyCanonicalInitializerSecrets({
        MEMBER_DIRECTORY_IDENTITY_KEY_SECRET: identitySecret,
        MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET: integritySecret,
      }),
    ).toThrow(/invalid/i);
  });
});

async function initializedDocuments() {
  let documents: Parameters<EmptyCanonicalDirectoryStore["initializeAtomically"]>[0] | undefined;
  await runEmptyCanonicalMemberDirectoryInitializer(validRequest(), {
    reopenAndVerifyPrivateEmptyBaseline: async () => verifiedBaseline,
    getIntegritySecret: () => integrityBinding,
    createStore: () => ({
      projectId,
      initializeAtomically: async (value) => {
        documents = value;
      },
    }),
  });
  if (documents === undefined) throw new Error("Expected initialization documents");
  return documents;
}

function fakeFirestore(occupiedPath?: string) {
  const reads: string[] = [];
  const creates: string[] = [];
  let transactions = 0;
  const reference = (path: string, kind: "document" | "query") => ({ path, kind });
  const firestore = {
    projectId,
    doc: (path: string) => reference(path, "document"),
    collection: (path: string) => ({
      limit: (value: number) => {
        expect(value).toBe(1);
        return reference(path, "query");
      },
    }),
    runTransaction: async (
      callback: (transaction: {
        get: (target: { path: string; kind: string }) => Promise<unknown>;
        create: (target: { path: string }, value: unknown) => void;
      }) => Promise<void>,
    ) => {
      transactions += 1;
      await callback({
        get: async (target) => {
          reads.push(target.path);
          if (target.kind === "document") {
            return { exists: target.path === occupiedPath };
          }
          return { empty: target.path !== occupiedPath };
        },
        create: (target) => {
          creates.push(target.path);
        },
      });
    },
  } as unknown as EmptyCanonicalFirestoreLike;
  return {
    firestore,
    transactionCount: () => transactions,
    readPaths: () => reads,
    createdPaths: () => creates,
  };
}

function memoryBaselineFile() {
  let contents: string | undefined;
  let attempts = 0;
  let options: Readonly<{ encoding: "utf8"; flag: "wx"; mode: number }> | undefined;
  let directoryPath: string | undefined;
  let artifactPath: string | undefined;
  const io: EmptyBaselineFileIo = {
    mkdir: async (path, received) => {
      directoryPath = path;
      expect(received).toEqual({ recursive: true });
    },
    writeFile: async (path, value, received) => {
      artifactPath = path;
      attempts += 1;
      options = received;
      if (contents !== undefined) {
        throw Object.assign(new Error("already exists"), { code: "EEXIST" });
      }
      contents = value;
    },
    readFile: async (path) => {
      artifactPath = path;
      if (contents === undefined) throw new Error("missing synthetic file");
      return contents;
    },
  };
  return {
    io,
    serialized: () => {
      if (contents === undefined) throw new Error("missing synthetic file");
      return contents;
    },
    writeAttempts: () => attempts,
    writeOptions: () => options,
    directoryPath: () => {
      if (directoryPath === undefined) throw new Error("missing synthetic directory path");
      return directoryPath;
    },
    artifactPath: () => {
      if (artifactPath === undefined) throw new Error("missing synthetic artifact path");
      return artifactPath;
    },
    tamperCiphertext: () => {
      if (contents === undefined) throw new Error("missing synthetic file");
      const envelope = JSON.parse(contents) as Record<string, unknown>;
      const ciphertext = envelope.ciphertext;
      if (typeof ciphertext !== "string" || ciphertext.length === 0) {
        throw new Error("missing synthetic ciphertext");
      }
      envelope.ciphertext = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
      contents = JSON.stringify(envelope);
    },
  };
}
