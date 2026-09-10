import { describe, expect, it } from "vitest";

import {
  createDisabledMemberDirectoryArtifactStore,
  createLocalMemberDirectoryArtifactStore,
  createMemberDirectoryArtifactStore,
  createMemberDirectoryBootstrapArtifactStore,
  createMemberDirectoryFrozenPlanStore,
  isLocalMemberDirectoryArtifactRootAllowed,
  type MemberDirectoryArtifactFileIo,
} from "./member-directory-artifact-store.js";

const academyId = "academy-bpt-jersey";
const operationId = "op-forward-1";
const secretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const root = process.platform === "win32" ? "C:\\rehearsal\\artifacts" : "/rehearsal/artifacts";
const mac = "f".repeat(64);

/** An in-memory file system with the same create-only semantics as `wx` on disk. */
function memoryIo(files: Map<string, string> = new Map()): {
  io: MemberDirectoryArtifactFileIo;
  files: Map<string, string>;
} {
  return {
    files,
    io: {
      mkdir: async () => undefined,
      writeFile: async (path, value) => {
        if (files.has(path)) {
          const error = new Error("EEXIST: file already exists");
          throw error;
        }
        files.set(path, value);
      },
      readFile: async (path) => {
        const stored = files.get(path);
        if (stored === undefined) throw new Error("ENOENT: no such file");
        return stored;
      },
      rm: async (path) => {
        files.delete(path);
      },
    },
  };
}

function localStore(io?: MemberDirectoryArtifactFileIo) {
  return createLocalMemberDirectoryArtifactStore({
    root,
    secretMaterial,
    ...(io === undefined ? {} : { io }),
  });
}

const manifest = { manifestId: "manifest-forward-1", rows: [{ sourceLegacyId: "LEGACY-8001" }] };
const plan = { planId: "plan-forward-1", chunks: [{ chunkNo: 1 }] };
const baseline = {
  artifactId: "artifact-bootstrap-1",
  academyId,
  operationId,
  secretVersion: "identity-v1",
  identityKeyBaselineMac: mac,
  chunks: [{ chunkNo: 1, expectedKeyTuples: ["membership-number:aa,owner,x,y"] }],
};

describe("member directory artifact store gating", () => {
  const allowed = {
    MEMBER_DIRECTORY_ARTIFACT_ROOT: root,
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    GCLOUD_PROJECT: "demo-bpt-jersey",
    MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET: secretMaterial,
  };

  it("allows the local root only on a loopback demo emulator with a root configured", () => {
    expect(isLocalMemberDirectoryArtifactRootAllowed(allowed)).toBe(true);
    // No approved root means no store, however local the rest of the environment looks.
    expect(
      isLocalMemberDirectoryArtifactRootAllowed({
        ...allowed,
        MEMBER_DIRECTORY_ARTIFACT_ROOT: "",
      }),
    ).toBe(false);
    expect(
      isLocalMemberDirectoryArtifactRootAllowed({
        ...allowed,
        MEMBER_DIRECTORY_ARTIFACT_ROOT: "relative/path",
      }),
    ).toBe(false);
    // A real project, or a Firestore that is not a loopback emulator, is never a rehearsal.
    expect(
      isLocalMemberDirectoryArtifactRootAllowed({ ...allowed, GCLOUD_PROJECT: "bptjersey-f5a25" }),
    ).toBe(false);
    expect(
      isLocalMemberDirectoryArtifactRootAllowed({
        ...allowed,
        FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443",
      }),
    ).toBe(false);
  });

  /**
   * There is no remote branch on purpose: outside the approved local root the store is disabled and
   * says so, rather than silently doing nothing or reaching for a bucket nobody approved.
   */
  it("returns a store that fails closed wherever the local root is not allowed", async () => {
    const disabled = createMemberDirectoryArtifactStore({ GCLOUD_PROJECT: "bptjersey-f5a25" });
    await expect(
      disabled.open({ kind: "reviewed-manifest", academyId, operationId }),
    ).rejects.toThrow(/no approved artifact store is configured/u);

    // Allowed environment, but no key: still disabled rather than half-configured.
    const keyless = createMemberDirectoryArtifactStore({
      ...allowed,
      MEMBER_DIRECTORY_BASELINE_ENCRYPTION_SECRET: undefined,
    });
    await expect(
      keyless.put({ kind: "reviewed-manifest", academyId, operationId, artifact: manifest }),
    ).rejects.toThrow(/no approved artifact store is configured/u);

    await expect(
      createDisabledMemberDirectoryArtifactStore().remove({
        kind: "output-plan",
        academyId,
        operationId,
      }),
    ).rejects.toThrow(/no approved artifact store is configured/u);
  });

  /**
   * Encrypting the artifact under the same key that authenticates it would turn one compromise into
   * two, and the store has to refuse while it is being built rather than at the first artifact.
   */
  it("refuses an artifact key that is one of the other purpose secrets", () => {
    expect(() =>
      createMemberDirectoryArtifactStore({
        ...allowed,
        MEMBER_DIRECTORY_IDENTITY_KEY_SECRET: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
        MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET: secretMaterial,
        MEMBER_DIRECTORY_CURSOR_SECRET: "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8",
      }),
    ).toThrow(/must be distinct/u);
  });
});

describe("member directory local artifact store", () => {
  it("writes a sealed artifact and reads it back", async () => {
    const { io, files } = memoryIo();
    const store = localStore(io);
    await store.put({ kind: "reviewed-manifest", academyId, operationId, artifact: manifest });

    const [stored] = [...files.values()];
    expect(stored).toBeDefined();
    // What lands on disk is the envelope, never the artifact.
    expect(stored).not.toContain("LEGACY-8001");
    expect(stored).toContain("aes-256-gcm-v1");

    await expect(
      store.open({ kind: "reviewed-manifest", academyId, operationId }),
    ).resolves.toEqual(manifest);
  });

  /**
   * A frozen artifact that could be rewritten in place is exactly the drift the receipt MACs exist
   * to catch, so the store refuses the rewrite one layer earlier.
   */
  it("refuses to overwrite an artifact that already exists", async () => {
    const store = localStore(memoryIo().io);
    await store.put({ kind: "output-plan", academyId, operationId, artifact: plan });
    await expect(
      store.put({ kind: "output-plan", academyId, operationId, artifact: plan }),
    ).rejects.toThrow(/EEXIST/u);
  });

  it("removes a rehearsal artifact and then reports it missing", async () => {
    const store = localStore(memoryIo().io);
    await store.put({ kind: "output-plan", academyId, operationId, artifact: plan });
    await store.remove({ kind: "output-plan", academyId, operationId });
    await expect(store.open({ kind: "output-plan", academyId, operationId })).rejects.toThrow(
      /was not found under the approved root/u,
    );
  });

  it("keeps the three kinds of one operation apart", async () => {
    const store = localStore(memoryIo().io);
    await store.put({ kind: "reviewed-manifest", academyId, operationId, artifact: manifest });
    await store.put({ kind: "output-plan", academyId, operationId, artifact: plan });
    await expect(store.open({ kind: "output-plan", academyId, operationId })).resolves.toEqual(
      plan,
    );
    await expect(store.open({ kind: "identity-baseline", academyId, operationId })).rejects.toThrow(
      /was not found under the approved root/u,
    );
  });

  it("refuses an unsafe address and a relative root", async () => {
    const store = localStore(memoryIo().io);
    await expect(
      store.open({ kind: "output-plan", academyId: "../escape", operationId }),
    ).rejects.toThrow(/not a safe identifier pair/u);

    expect(() =>
      createLocalMemberDirectoryArtifactStore({ root: "artifacts", secretMaterial }),
    ).toThrow(/must be an absolute path/u);
  });

  it("refuses stored bytes that are not valid JSON", async () => {
    const { io, files } = memoryIo();
    const store = localStore(io);
    await store.put({ kind: "output-plan", academyId, operationId, artifact: plan });
    const [path] = [...files.keys()];
    files.set(path ?? "", "{not json");
    await expect(store.open({ kind: "output-plan", academyId, operationId })).rejects.toThrow(
      /not valid JSON/u,
    );
  });
});

describe("member directory artifact ports", () => {
  it("serves the frozen plan port with both artifacts at once", async () => {
    const store = localStore(memoryIo().io);
    await store.put({ kind: "reviewed-manifest", academyId, operationId, artifact: manifest });
    await store.put({ kind: "output-plan", academyId, operationId, artifact: plan });

    const frozen = createMemberDirectoryFrozenPlanStore(store);
    await expect(frozen.open({ academyId, operationId })).resolves.toEqual({ manifest, plan });
  });

  it("fails the frozen plan port when only one of the two artifacts exists", async () => {
    const store = localStore(memoryIo().io);
    await store.put({ kind: "reviewed-manifest", academyId, operationId, artifact: manifest });
    await expect(
      createMemberDirectoryFrozenPlanStore(store).open({ academyId, operationId }),
    ).rejects.toThrow(/was not found under the approved root/u);
  });

  /**
   * The baseline is re-parsed on the way out rather than cast: it has been through a cipher and a
   * file system, and the closure runner's argument is that the artifact poses the question.
   */
  it("re-parses the baseline artifact and refuses a malformed or misfiled one", async () => {
    const store = localStore(memoryIo().io);
    await store.put({ kind: "identity-baseline", academyId, operationId, artifact: baseline });
    const port = createMemberDirectoryBootstrapArtifactStore(store);
    await expect(port.open({ academyId, operationId })).resolves.toEqual(baseline);

    const malformed = localStore(memoryIo().io);
    await malformed.put({
      kind: "identity-baseline",
      academyId,
      operationId,
      artifact: { ...baseline, chunks: [] },
    });
    await expect(
      createMemberDirectoryBootstrapArtifactStore(malformed).open({ academyId, operationId }),
    ).rejects.toThrow(/not a valid record/u);

    const misfiled = localStore(memoryIo().io);
    await misfiled.put({
      kind: "identity-baseline",
      academyId,
      operationId,
      artifact: { ...baseline, academyId: "academy-other" },
    });
    await expect(
      createMemberDirectoryBootstrapArtifactStore(misfiled).open({ academyId, operationId }),
    ).rejects.toThrow(/names another operation or academy/u);
  });
});
