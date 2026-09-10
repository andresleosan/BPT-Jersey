import {
  mkdir as makeDirectory,
  readFile as readLocalFile,
  rm as removeLocalFile,
  writeFile as writeLocalFile,
} from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";

import { z } from "zod";

import {
  memberDirectoryMaxArtifactBytes,
  openMemberDirectoryArtifact,
  sealMemberDirectoryArtifact,
  type MemberDirectoryArtifactAddress,
} from "./member-directory-artifact-codec.js";
import type {
  MemberDirectoryBootstrapArtifactStore,
  MemberDirectoryBootstrapBaselineArtifact,
} from "./member-directory-bootstrap-closure-runner.js";
import {
  assertDistinctMemberDirectorySecrets,
  decodeMemberDirectorySecret,
} from "./member-directory-crypto.js";
import type { MemberDirectoryFrozenPlanStore } from "./member-directory-frozen-plan.js";

/**
 * Where the frozen member directory artifacts live (T108).
 *
 * The operator's decision of 2026-09-08: **a file store under an approved input root, reachable
 * only from a loopback demo Emulator, and a remote path that fails closed.** The reasoning is in
 * the ledger and worth repeating here, because the shape of this file follows from it - the
 * isolated staging project was dropped on 2026-09-07 and production is not authorized by T092, so
 * the Emulator is the only environment in which T108 can be verified at all. A remote store built
 * now would have no authorized run to serve and would add a credential, a bucket and a retention
 * policy to guard in the meantime.
 *
 * So this closes both artifact ports - the frozen plan's and the bootstrap baseline's - for the one
 * environment that matters today, and leaves the remote adapter as an explicit absence rather than
 * a stub that might be mistaken for one. `createMemberDirectoryArtifactStore` returns the disabled
 * store everywhere else, and every operation on it throws.
 *
 * The bytes are sealed by `member-directory-artifact-codec.ts` before they reach any sink, so the
 * encryption path is exercised by the Emulator rehearsal rather than running for the first time
 * somewhere remote. The key is `MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET`, which already exists
 * as the secret that encrypts member directory artifacts at rest and is already required to be
 * distinct from the identity, integrity and cursor secrets. Its name says "baseline" because the
 * empty-baseline initializer of T093 was the first artifact to need it; minting a fifth secret for
 * the same purpose would be a second name for one thing, with a second provisioning and a second
 * rotation to keep in step. The two uses derive different content keys from it - that one through
 * HKDF, this one through a domain-separated HMAC per artifact kind - so nothing sealed by one opens
 * under the other.
 */

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const macPattern = /^[a-f0-9]{64}$/u;

export type MemberDirectoryArtifactStore = Readonly<{
  /** Writes a sealed artifact. Create-only: a frozen artifact is never rewritten in place. */
  put(input: MemberDirectoryArtifactAddress & Readonly<{ artifact: unknown }>): Promise<void>;
  open(address: MemberDirectoryArtifactAddress): Promise<unknown>;
  /** Removes one artifact. Local rehearsal fixtures are deleted when the rehearsal ends. */
  remove(address: MemberDirectoryArtifactAddress): Promise<void>;
}>;

export type MemberDirectoryArtifactFileIo = Readonly<{
  mkdir(path: string, options: Readonly<{ recursive: true }>): Promise<unknown>;
  writeFile(
    path: string,
    value: string,
    options: Readonly<{ encoding: "utf8"; flag: "wx"; mode: number }>,
  ): Promise<void>;
  readFile(path: string): Promise<string>;
  rm(path: string, options: Readonly<{ force: true }>): Promise<void>;
}>;

const defaultIo: MemberDirectoryArtifactFileIo = Object.freeze({
  mkdir: async (path, options) => makeDirectory(path, options),
  writeFile: async (path, value, options) => writeLocalFile(path, value, options),
  readFile: async (path) => readLocalFile(path, "utf8"),
  rm: async (path, options) => removeLocalFile(path, options),
});

function storeFailure(reason: string): never {
  throw new Error(`Member directory artifact store refused: ${reason}`);
}

function isLoopbackEmulatorHost(host: string | undefined): boolean {
  const prefix = "127.0.0.1:";
  if (host === undefined || !host.startsWith(prefix)) return false;
  const port = Number(host.slice(prefix.length));
  return Number.isInteger(port) && port >= 1_024 && port <= 65_535;
}

/**
 * The approved input root is only approved somewhere it cannot hold real data.
 *
 * Deliberately not the same predicate as private PDF storage: that one also requires the process to
 * be the Functions Emulator, and the migration rehearsal runs as a plain test process against a
 * loopback Firestore Emulator. What both share is the part that matters - a loopback emulator on a
 * demo project - plus, here, a root the operator configured on purpose. No root, no store.
 */
export function isLocalMemberDirectoryArtifactRootAllowed(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const projectId =
    environment.GCLOUD_PROJECT ?? environment.FIREBASE_PROJECT_ID ?? environment.GCP_PROJECT ?? "";
  const root = environment.MEMBER_DIRECTORY_ARTIFACT_ROOT?.trim() ?? "";
  return (
    root.length > 0 &&
    isAbsolute(root) &&
    isLoopbackEmulatorHost(environment.FIRESTORE_EMULATOR_HOST) &&
    projectId.startsWith("demo-") &&
    projectId.length > "demo-".length
  );
}

function artifactPath(root: string, address: MemberDirectoryArtifactAddress): string {
  if (
    !safeIdentifierPattern.test(address.academyId) ||
    !safeIdentifierPattern.test(address.operationId)
  ) {
    storeFailure("the artifact address is not a safe identifier pair");
  }
  const path = normalize(
    join(root, address.academyId, address.operationId, `${address.kind}.json`),
  );
  if (!path.startsWith(normalize(root))) {
    // Unreachable while the identifier pattern holds - it admits no separator and no dot run - but
    // a path that escapes its root is the one failure worth refusing twice.
    storeFailure("the artifact path escapes the approved root");
  }
  return path;
}

export type MemberDirectoryLocalArtifactStoreOptions = Readonly<{
  root: string;
  secretMaterial: string;
  io?: MemberDirectoryArtifactFileIo;
}>;

/**
 * The file-backed artifact store. Writes are create-only and reads are size-bounded, so a frozen
 * artifact behaves the same way here as it would behind an approved remote store.
 */
export function createLocalMemberDirectoryArtifactStore(
  options: MemberDirectoryLocalArtifactStoreOptions,
): MemberDirectoryArtifactStore {
  if (!isAbsolute(options.root)) {
    storeFailure("the approved artifact root must be an absolute path");
  }
  // Fails here rather than at the first write: a store built on an unusable key is a store that
  // looks configured and is not.
  decodeMemberDirectorySecret(options.secretMaterial, "artifact");
  const io = options.io ?? defaultIo;

  return Object.freeze({
    put: async (input) => {
      const path = artifactPath(options.root, input);
      const sealed = sealMemberDirectoryArtifact({
        kind: input.kind,
        academyId: input.academyId,
        operationId: input.operationId,
        artifact: input.artifact,
        secretMaterial: options.secretMaterial,
      });
      await io.mkdir(join(options.root, input.academyId, input.operationId), { recursive: true });
      // `wx` refuses an existing file. A frozen artifact that could be rewritten in place is the
      // drift the receipt MACs exist to catch, caught one layer earlier and for free.
      await io.writeFile(path, JSON.stringify(sealed), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    },
    open: async (address) => {
      const path = artifactPath(options.root, address);
      let raw: string;
      try {
        raw = await io.readFile(path);
      } catch {
        storeFailure("the artifact was not found under the approved root");
      }
      if (raw.length > memberDirectoryMaxArtifactBytes) {
        storeFailure("the stored artifact exceeds the maximum size");
      }
      let sealed: unknown;
      try {
        sealed = JSON.parse(raw) as unknown;
      } catch {
        storeFailure("the stored artifact is not valid JSON");
      }
      return openMemberDirectoryArtifact({
        kind: address.kind,
        academyId: address.academyId,
        operationId: address.operationId,
        sealed,
        secretMaterial: options.secretMaterial,
      });
    },
    remove: async (address) => {
      await io.rm(artifactPath(options.root, address), { force: true });
    },
  });
}

export function createDisabledMemberDirectoryArtifactStore(): MemberDirectoryArtifactStore {
  const disabled = async (): Promise<never> => {
    storeFailure("no approved artifact store is configured");
  };
  return Object.freeze({ put: disabled, open: disabled, remove: disabled });
}

/**
 * The single artifact-store seam. The local root wins where it is allowed; everywhere else the
 * store is disabled and says so. There is no remote branch on purpose: adding one would mean
 * choosing a bucket, a credential and a retention policy for runs that are not yet authorized.
 */
export function createMemberDirectoryArtifactStore(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): MemberDirectoryArtifactStore {
  if (!isLocalMemberDirectoryArtifactRootAllowed(environment)) {
    return createDisabledMemberDirectoryArtifactStore();
  }
  const secretMaterial = environment.MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET;
  if (secretMaterial === undefined || secretMaterial.length === 0) {
    return createDisabledMemberDirectoryArtifactStore();
  }
  const identity = environment.MEMBER_DIRECTORY_IDENTITY_KEY_SECRET;
  const integrity = environment.MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET;
  const cursor = environment.MEMBER_DIRECTORY_CURSOR_SECRET;
  if (identity !== undefined && integrity !== undefined && cursor !== undefined) {
    // Checked here rather than left to the seal: encrypting the artifact under the same key that
    // authenticates it would turn one compromise into two, and the failure has to happen while the
    // store is being built, not at the first artifact.
    assertDistinctMemberDirectorySecrets({ identity, integrity, cursor, artifact: secretMaterial });
  }
  return createLocalMemberDirectoryArtifactStore({
    root: (environment.MEMBER_DIRECTORY_ARTIFACT_ROOT ?? "").trim(),
    secretMaterial,
  });
}

const baselineArtifactSchema = z.strictObject({
  artifactId: z.string().regex(safeIdentifierPattern),
  academyId: z.string().regex(safeIdentifierPattern),
  operationId: z.string().regex(safeIdentifierPattern),
  secretVersion: z.string().regex(safeIdentifierPattern),
  identityKeyBaselineMac: z.string().regex(macPattern),
  chunks: z
    .array(
      z.strictObject({
        chunkNo: z.number().int().positive().safe(),
        expectedKeyTuples: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});

/**
 * The bootstrap closure's port, served from the artifact store.
 *
 * The artifact is re-parsed on the way out rather than cast. It has been through a cipher and a
 * file system since it was written, and the closure runner's whole argument is that the artifact
 * poses the question while Firestore answers it - a question that arrived malformed is not a
 * question.
 */
export function createMemberDirectoryBootstrapArtifactStore(
  artifacts: MemberDirectoryArtifactStore,
): MemberDirectoryBootstrapArtifactStore {
  return Object.freeze({
    open: async (input): Promise<MemberDirectoryBootstrapBaselineArtifact> => {
      const opened = await artifacts.open({
        kind: "identity-baseline",
        academyId: input.academyId,
        operationId: input.operationId,
      });
      const parsed = baselineArtifactSchema.safeParse(opened);
      if (!parsed.success) {
        storeFailure("the stored baseline artifact is not a valid record");
      }
      if (
        parsed.data.academyId !== input.academyId ||
        parsed.data.operationId !== input.operationId
      ) {
        storeFailure("the stored baseline artifact names another operation or academy");
      }
      return Object.freeze(parsed.data);
    },
  });
}

/**
 * The frozen plan's port, served from the artifact store.
 *
 * Both artifacts are fetched together because the proof needs both: `openMemberDirectoryFrozenPlan`
 * binds the manifest to the plan and each to the receipt, and a caller able to fetch one alone
 * could only ever prove half of that.
 */
export function createMemberDirectoryFrozenPlanStore(
  artifacts: MemberDirectoryArtifactStore,
): MemberDirectoryFrozenPlanStore {
  return Object.freeze({
    open: async (input) => {
      const [manifest, plan] = await Promise.all([
        artifacts.open({
          kind: "reviewed-manifest",
          academyId: input.academyId,
          operationId: input.operationId,
        }),
        artifacts.open({
          kind: "output-plan",
          academyId: input.academyId,
          operationId: input.operationId,
        }),
      ]);
      return Object.freeze({ manifest, plan });
    },
  });
}
