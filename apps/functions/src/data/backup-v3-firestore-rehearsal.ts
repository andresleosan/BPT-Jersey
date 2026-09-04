import { getApps, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, v1, type DocumentData, type Firestore } from "firebase-admin/firestore";

import { canonicalizeMemberDirectoryValue } from "../members/member-directory-crypto.js";
import { assertMemberDirectoryRestoreAdminApps } from "../members/member-directory-environment.js";
import { BACKUP_V3_LIMITS } from "./backup-v3-contracts.js";
import {
  writeBackupV3FirestorePayloadExact,
  type BackupV3FirestoreCommitClient,
} from "./backup-v3-firestore-exact-writer.js";
import {
  readBackupV3FirestoreNamespaceInventory,
  type BackupV3FirestoreInventoryClient,
  type BackupV3FirestoreV1Document,
} from "./backup-v3-firestore-inventory.js";
import type {
  BackupV3RehearsalEndpoint,
  BackupV3TargetCheckpointWrite,
  BackupV3WriteDocument,
} from "./backup-v3-rehearsal.js";

type RehearsalRole = "source" | "target";

const roleBindings = Object.freeze({
  source: Object.freeze({
    appName: "member-directory-restore-source",
    projectId: "demo-bpt-jersey",
  }),
  target: Object.freeze({
    appName: "member-directory-restore-target",
    projectId: "demo-bpt-jersey-restore",
  }),
});
const attestationPathPattern = /^memberDirectoryRestoreAttestations\/restore-v3-[a-f0-9]{48}$/u;
const academyIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const restoreOperationIdPattern = /^restore-op-[a-f0-9]{24}$/u;
const restoreAuditIdPattern = /^restore-audit-[a-f0-9]{48}$/u;

function unsafe(message: string): never {
  throw new Error(`Unsafe backup v3 Firestore rehearsal: ${message}`);
}

function assertAdapterEnvironment(app: App, role: RehearsalRole): string {
  const expected = roleBindings[role];
  if (
    process.env["FIRESTORE_EMULATOR_HOST"] !== "127.0.0.1:8080" ||
    process.env["FIREBASE_AUTH_EMULATOR_HOST"] !== "127.0.0.1:9099" ||
    app.name !== expected.appName ||
    app.options.projectId !== expected.projectId
  ) {
    return unsafe("the exact loopback project/app binding is required");
  }
  assertMemberDirectoryRestoreAdminApps(
    "after-initialization",
    getApps().map((candidate) =>
      candidate.options.projectId === undefined
        ? { name: candidate.name }
        : { name: candidate.name, projectId: candidate.options.projectId },
    ),
  );
  return expected.projectId;
}

function canonicalDocumentData(data: DocumentData | undefined): Readonly<Record<string, unknown>> {
  if (data === undefined || typeof data !== "object" || data === null || Array.isArray(data)) {
    return unsafe("Firestore returned invalid document data");
  }
  try {
    const parsed: unknown = JSON.parse(canonicalizeMemberDirectoryValue(data));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    return Object.freeze(parsed as Record<string, unknown>);
  } catch {
    return unsafe("only canonical JSON-safe Firestore values are supported");
  }
}

const inventoryLimits = Object.freeze({
  maxRealDocumentCount: BACKUP_V3_LIMITS.combined.maxDocumentCount,
  maxDecodedBytes: BACKUP_V3_LIMITS.combined.maxDecodedBytes,
  maxVisitedPathCount: BACKUP_V3_LIMITS.maxVisitedPathCount,
});

function emulatorV1Client(projectId: string): InstanceType<typeof v1.FirestoreClient> {
  if (process.env["FIRESTORE_EMULATOR_HOST"] !== "127.0.0.1:8080") {
    return unsafe("v1 REST access requires the literal loopback Emulator endpoint");
  }
  const localTransport = {
    fetch: async (url: string, init: unknown) => {
      const parsed = new URL(url);
      if (
        parsed.protocol !== "http:" ||
        parsed.hostname !== "127.0.0.1" ||
        parsed.port !== "8080"
      ) {
        return unsafe("v1 REST transport attempted a non-Emulator endpoint");
      }
      return fetch(parsed, init as RequestInit);
    },
  };
  const localAuth = {
    useJWTAccessWithScope: false,
    defaultServicePath: "",
    defaultScopes: [] as string[],
    getProjectId: async () => projectId,
    getClient: async () => localTransport,
  };
  return new v1.FirestoreClient({
    projectId,
    servicePath: "127.0.0.1",
    port: 8080,
    fallback: true,
    protocol: "http",
    auth: localAuth as never,
  });
}

function emulatorInventoryClient(
  raw: InstanceType<typeof v1.FirestoreClient>,
): BackupV3FirestoreInventoryClient {
  return Object.freeze({
    batchGetDocuments: async (request) =>
      new Promise<readonly Readonly<Record<string, unknown>>[]>((resolve, reject) => {
        const responses: Readonly<Record<string, unknown>>[] = [];
        const stream = raw.batchGetDocuments({
          database: request.database,
          documents: [...request.documents],
          ...(request.readTime === undefined ? {} : { readTime: request.readTime as never }),
        });
        stream.on("data", (response: unknown) => {
          if (typeof response !== "object" || response === null || Array.isArray(response)) {
            reject(new Error("invalid batch-get response"));
            return;
          }
          responses.push(response as Readonly<Record<string, unknown>>);
        });
        stream.on("error", reject);
        stream.on("end", () => resolve(Object.freeze(responses)));
      }),
    listCollectionIds: async (request) => {
      const [collectionIds, , response] = await raw.listCollectionIds(
        {
          parent: request.parent,
          pageSize: request.pageSize,
          ...(request.pageToken === undefined ? {} : { pageToken: request.pageToken }),
          readTime: request.readTime as never,
        },
        { autoPaginate: false },
      );
      const token = response.nextPageToken;
      return Object.freeze({
        collectionIds: Object.freeze(collectionIds),
        ...(typeof token === "string" && token.length > 0 ? { nextPageToken: token } : {}),
      });
    },
    listDocuments: async (request) => {
      const [documents, , response] = await raw.listDocuments(
        {
          parent: request.parent,
          collectionId: request.collectionId,
          pageSize: request.pageSize,
          ...(request.pageToken === undefined ? {} : { pageToken: request.pageToken }),
          readTime: request.readTime as never,
          showMissing: request.showMissing,
        },
        { autoPaginate: false },
      );
      const token = response.nextPageToken;
      return Object.freeze({
        documents: Object.freeze(documents as readonly BackupV3FirestoreV1Document[]),
        ...(typeof token === "string" && token.length > 0 ? { nextPageToken: token } : {}),
      });
    },
  });
}

function emulatorCommitClient(
  raw: InstanceType<typeof v1.FirestoreClient>,
): BackupV3FirestoreCommitClient {
  return Object.freeze({
    commit: async (request, options) => {
      const [response] = await raw.commit(
        {
          database: request.database,
          writes: [...request.writes] as never,
        },
        { timeout: options.timeoutMs },
      );
      return response;
    },
  });
}

function canonicalTargetCheckpointDocuments(
  input: BackupV3TargetCheckpointWrite,
): readonly BackupV3WriteDocument[] {
  if (
    !academyIdPattern.test(input.academyId) ||
    !restoreOperationIdPattern.test(input.targetOperationId) ||
    input.documents.length !== 5
  ) {
    return unsafe("target I1 checkpoint identity is invalid");
  }
  const statePath = `academies/${input.academyId}/memberDirectoryStates/current`;
  const guardPath = `memberDirectoryRestoreGuards/${input.academyId}`;
  const eventPath = `${guardPath}/events/0`;
  const migrationPath = `academies/${input.academyId}/memberDirectoryMigrations/${input.targetOperationId}`;
  const fixedPaths = new Set([statePath, guardPath, eventPath, migrationPath]);
  const seen = new Set<string>();
  let auditCount = 0;
  const documents = input.documents.map((document) => {
    if (seen.has(document.path)) return unsafe("target I1 checkpoint path is duplicated");
    seen.add(document.path);
    if (!fixedPaths.has(document.path)) {
      const prefix = `academies/${input.academyId}/auditEvents/`;
      const auditId = document.path.startsWith(prefix) ? document.path.slice(prefix.length) : "";
      if (!restoreAuditIdPattern.test(auditId)) {
        return unsafe("target I1 checkpoint path is not allowlisted");
      }
      auditCount += 1;
    }
    return Object.freeze({ path: document.path, data: canonicalDocumentData(document.data) });
  });
  if (auditCount !== 1 || fixedPaths.size + auditCount !== documents.length) {
    return unsafe("target I1 checkpoint path set is incomplete");
  }
  documents.sort((left, right) => left.path.localeCompare(right.path));
  return Object.freeze(documents);
}

async function prepareTargetCheckpoint(
  firestore: Firestore,
  input: BackupV3TargetCheckpointWrite,
): Promise<"created" | "existing"> {
  const documents = canonicalTargetCheckpointDocuments(input);
  return firestore.runTransaction(async (transaction) => {
    const references = documents.map((document) => firestore.doc(document.path));
    const snapshots = await transaction.getAll(...references);
    const existingCount = snapshots.filter((snapshot) => snapshot.exists).length;
    if (existingCount !== 0 && existingCount !== documents.length) {
      return unsafe("target I1 checkpoint is partial");
    }
    if (existingCount === documents.length) {
      for (let index = 0; index < documents.length; index += 1) {
        if (
          canonicalizeMemberDirectoryValue(canonicalDocumentData(snapshots[index]!.data())) !==
          canonicalizeMemberDirectoryValue(documents[index]!.data)
        ) {
          return unsafe("target I1 checkpoint already diverged");
        }
      }
      return "existing" as const;
    }
    for (let index = 0; index < documents.length; index += 1) {
      transaction.create(references[index]!, documents[index]!.data);
    }
    return "created" as const;
  });
}

async function putMetadata(
  firestore: Firestore,
  path: string,
  data: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (!attestationPathPattern.test(path)) unsafe("attestation path is invalid");
  const expected = canonicalDocumentData(data);
  await firestore.runTransaction(async (transaction) => {
    const reference = firestore.doc(path);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) {
      transaction.create(reference, expected);
      return;
    }
    if (
      canonicalizeMemberDirectoryValue(canonicalDocumentData(snapshot.data())) !==
      canonicalizeMemberDirectoryValue(expected)
    ) {
      unsafe("attestation already exists with divergent metadata");
    }
  });
}

export function createBackupV3FirestoreRehearsalEndpoint(
  input: Readonly<{
    app: App;
    role: RehearsalRole;
    inventoryClient?: BackupV3FirestoreInventoryClient;
    commitClient?: BackupV3FirestoreCommitClient;
  }>,
): BackupV3RehearsalEndpoint {
  const projectId = assertAdapterEnvironment(input.app, input.role);
  const firestore = getFirestore(input.app);
  const auth = getAuth(input.app);
  const rawClient =
    input.inventoryClient === undefined || input.commitClient === undefined
      ? emulatorV1Client(projectId)
      : undefined;
  const inventoryClient = input.inventoryClient ?? emulatorInventoryClient(rawClient!);
  const commitClient = input.commitClient ?? emulatorCommitClient(rawClient!);
  return Object.freeze({
    projectId,
    readSourceInventory: async (academyId: string) => {
      if (input.role !== "source") unsafe("only the source app may snapshot an academy");
      return readBackupV3FirestoreNamespaceInventory({
        client: inventoryClient,
        projectId,
        academyId,
        role: "source",
        limits: inventoryLimits,
      });
    },
    readNamespaceInventory: async (academyId: string) => {
      if (input.role !== "target") unsafe("only the target app may inventory the target");
      return readBackupV3FirestoreNamespaceInventory({
        client: inventoryClient,
        projectId,
        academyId,
        role: "target",
        limits: inventoryLimits,
      });
    },
    hasAnyAuthUser: async () => (await auth.listUsers(1)).users.length !== 0,
    prepareTargetCheckpoint: async (checkpoint: BackupV3TargetCheckpointWrite) => {
      if (input.role !== "target") unsafe("only the target app may prepare I1");
      return prepareTargetCheckpoint(firestore, checkpoint);
    },
    createPayloadDocuments: async (request) => {
      if (input.role !== "target") unsafe("only the target app may materialize payload");
      await writeBackupV3FirestorePayloadExact({ client: commitClient, ...request });
    },
    putMetadataDocument: async (path: string, data: Readonly<Record<string, unknown>>) => {
      if (input.role !== "source") unsafe("only the source app may attest");
      await putMetadata(firestore, path, data);
    },
  });
}
