import { describe, expect, it, vi } from "vitest";

import {
  assertCanonicalMemberDirectoryWriterReady,
  selectAdminDirectoryReader,
} from "./member-directory-state.js";
import {
  buildCanonicalDirectoryDocuments,
  canonicalDirectoryRequiredEmptyCollections,
  CanonicalDirectoryInitializationError,
  createCanonicalDirectoryInitializationService,
  type CanonicalDirectoryInitializationStore,
} from "./canonical-directory-initialization.js";

const integritySecretMaterial = Buffer.from(
  "6d656d6265722d6469726563746f72792d696e7465677269747921212121212121",
  "hex",
).toString("base64url");

const input = Object.freeze({
  academyId: "demo-academy",
  projectId: "bptjersey-f5a25",
  actorId: "Y1feAnOwnerUid",
  now: "2026-09-09T12:00:00.000Z",
  identitySecretVersion: "identity-v1",
  integritySecretMaterial,
  integritySecretVersion: "integrity-v1",
});

describe("buildCanonicalDirectoryDocuments", () => {
  it("builds a state the deployed reader and writer both accept", () => {
    // The whole point of the row: a directory that is initialized but that the gates still refuse
    // would leave production exactly as broken, and the failure would look identical.
    const documents = buildCanonicalDirectoryDocuments(input);

    expect(selectAdminDirectoryReader(documents.state)).toBe("canonical");
    expect(() =>
      assertCanonicalMemberDirectoryWriterReady(documents.state, {
        academyId: "demo-academy",
        digestVersion: "hmac-sha256-v1",
        secretVersion: "identity-v1",
      }),
    ).not.toThrow();
  });

  it("declares the identity secret version the callables compare against", () => {
    const documents = buildCanonicalDirectoryDocuments(input);

    expect(documents.state.secretVersion).toBe("identity-v1");
    expect(documents.state.digestVersion).toBe("hmac-sha256-v1");
  });

  it("carries the identity baseline that complete coverage requires", () => {
    // The state schema refuses `identityKeyCoverage: "complete"` without both fields, and coverage
    // has to be complete or neither the reader nor the writer accepts the state. So the baseline is
    // structural here, not decoration.
    const documents = buildCanonicalDirectoryDocuments(input);

    expect(documents.state.identityKeyBaselineMac).toMatch(/^[a-f0-9]{64}$/u);
    expect(documents.state.identityKeyBaselineArtifactId).toMatch(/^empty-baseline-[a-f0-9]{40}$/u);
  });

  it("binds the baseline to the project, the academy and the secret", () => {
    const base = buildCanonicalDirectoryDocuments(input);

    expect(
      buildCanonicalDirectoryDocuments({ ...input, academyId: "other-academy" }).state
        .identityKeyBaselineArtifactId,
    ).not.toBe(base.state.identityKeyBaselineArtifactId);
    expect(
      buildCanonicalDirectoryDocuments({ ...input, projectId: "other-project" }).state
        .identityKeyBaselineMac,
    ).not.toBe(base.state.identityKeyBaselineMac);
    expect(
      buildCanonicalDirectoryDocuments({
        ...input,
        integritySecretMaterial: Buffer.from(
          "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
          "hex",
        ).toString("base64url"),
      }).state.identityKeyBaselineMac,
    ).not.toBe(base.state.identityKeyBaselineMac);
  });

  it("derives the same baseline twice for the same binding", () => {
    expect(buildCanonicalDirectoryDocuments(input).state.identityKeyBaselineMac).toBe(
      buildCanonicalDirectoryDocuments(input).state.identityKeyBaselineMac,
    );
  });

  it("chains the guard to its genesis event at revision zero", () => {
    const documents = buildCanonicalDirectoryDocuments(input);

    expect(documents.state.stateRevision).toBe(0);
    expect(documents.event.eventId).toBe("0");
    expect(documents.event.previousStateRevision).toBe(-1);
    expect(documents.guard.lastEventMac).toBe(documents.event.eventMac);
    expect(documents.guard.projectId).toBe("bptjersey-f5a25");
  });

  it("binds the documents to the project it was given, not to the emulator", () => {
    // The emulator initializer pins demo-bpt-jersey in four places. This path exists precisely so
    // that a real project can be initialized without weakening that tool.
    const documents = buildCanonicalDirectoryDocuments({ ...input, projectId: "another-project" });

    expect(documents.guard.projectId).toBe("another-project");
    expect(documents.event.projectId).toBe("another-project");
  });

  it("refuses a secret that carries no entropy", () => {
    expect(() =>
      buildCanonicalDirectoryDocuments({
        ...input,
        integritySecretMaterial: Buffer.alloc(32, 0).toString("base64url"),
      }),
    ).toThrow(CanonicalDirectoryInitializationError);
  });

  it("refuses an academy identifier the state schema rejects", () => {
    expect(() => buildCanonicalDirectoryDocuments({ ...input, academyId: "" })).toThrow(
      CanonicalDirectoryInitializationError,
    );
  });
});

describe("canonicalDirectoryRequiredEmptyCollections", () => {
  it("checks the collections that would make an empty directory a lie", () => {
    expect(canonicalDirectoryRequiredEmptyCollections).toContain("students");
    expect(canonicalDirectoryRequiredEmptyCollections).toContain("studentAdminProfiles");
    expect(canonicalDirectoryRequiredEmptyCollections).toContain("studentIdentityKeys");
    expect(canonicalDirectoryRequiredEmptyCollections).toContain("memberDirectoryMigrations");
  });

  it("does not require an empty audit log", () => {
    // This is the difference that makes the fix possible at all. The emulator initializer demands
    // an empty `auditEvents`, and production has one the moment anybody tries anything - so that
    // rule would block the repair forever while protecting nothing: the log is append-only and
    // records attempts, never directory state.
    expect(canonicalDirectoryRequiredEmptyCollections).not.toContain("auditEvents");
  });
});

describe("createCanonicalDirectoryInitializationService", () => {
  function service(
    initializeAtomically: CanonicalDirectoryInitializationStore["initializeAtomically"],
  ) {
    return createCanonicalDirectoryInitializationService({
      store: Object.freeze({ initializeAtomically }),
      projectId: "bptjersey-f5a25",
      identitySecretVersion: "identity-v1",
      integritySecretMaterial,
      integritySecretVersion: "integrity-v1",
    });
  }

  it("hands the store the three documents and the acting uid", async () => {
    const initializeAtomically = vi.fn().mockResolvedValue({ alreadyInitialized: false });

    const outcome = await service(initializeAtomically).initialize({
      academyId: "demo-academy",
      actorId: "Y1feAnOwnerUid",
      now: "2026-09-09T12:00:00.000Z",
    });

    expect(outcome.alreadyInitialized).toBe(false);
    const call = initializeAtomically.mock.calls[0]?.[0];
    expect(call.actorId).toBe("Y1feAnOwnerUid");
    expect(call.auditAction).toBe("member.directory.initialized");
    expect(call.documents.state.academyId).toBe("demo-academy");
    expect(call.documents.guard.academyId).toBe("demo-academy");
    expect(call.documents.event.academyId).toBe("demo-academy");
  });

  it("reports an already initialized directory instead of failing", async () => {
    // A second click must not read as an incident: if the state is there, the directory works.
    const initializeAtomically = vi.fn().mockResolvedValue({ alreadyInitialized: true });

    const outcome = await service(initializeAtomically).initialize({
      academyId: "demo-academy",
      actorId: "Y1feAnOwnerUid",
      now: "2026-09-09T12:00:00.000Z",
    });

    expect(outcome.alreadyInitialized).toBe(true);
  });

  it("never reaches the store when the documents cannot be built", async () => {
    const initializeAtomically = vi.fn();

    await expect(
      service(initializeAtomically).initialize({
        academyId: "demo-academy",
        actorId: "Y1feAnOwnerUid",
        now: "not a timestamp",
      }),
    ).rejects.toThrow(CanonicalDirectoryInitializationError);
    expect(initializeAtomically).not.toHaveBeenCalled();
  });
});
