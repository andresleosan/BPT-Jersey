import { describe, expect, it } from "vitest";

import {
  memberDirectorySealedArtifactSchema,
  openMemberDirectoryArtifact,
  sealMemberDirectoryArtifact,
} from "./member-directory-artifact-codec.js";

const academyId = "academy-bpt-jersey";
const operationId = "op-forward-1";
const secretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const otherSecretMaterial = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

const artifact = {
  manifestId: "manifest-forward-1",
  rows: [{ sourceLegacyId: "LEGACY-8001", reviewedReason: "Confirmed against the enrolment form" }],
};

function sealed(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    ...sealMemberDirectoryArtifact({
      kind: "reviewed-manifest",
      academyId,
      operationId,
      artifact,
      secretMaterial,
    }),
    ...overrides,
  };
}

describe("member directory artifact codec", () => {
  it("seals an artifact and opens it back to the same value", () => {
    const envelope = sealed();
    expect(memberDirectorySealedArtifactSchema.parse(envelope).kind).toBe("reviewed-manifest");
    // The plaintext must not be recoverable from the envelope by reading it.
    expect(JSON.stringify(envelope)).not.toContain("enrolment form");

    const opened = openMemberDirectoryArtifact({
      kind: "reviewed-manifest",
      academyId,
      operationId,
      sealed: envelope,
      secretMaterial,
    });
    expect(opened).toEqual(artifact);
  });

  /** A fresh nonce per seal: two seals of one artifact must not produce the same ciphertext. */
  it("produces a different envelope every time it seals the same artifact", () => {
    expect(sealed().ciphertext).not.toBe(sealed().ciphertext);
  });

  /**
   * The kind, academy and operation are the AEAD's additional data, so opening under the wrong one
   * is a tag failure rather than a comparison a caller could forget to make.
   */
  it("refuses to open an artifact under another kind, academy or operation", () => {
    const envelope = sealed();
    for (const wrong of [
      { kind: "output-plan" as const, academyId, operationId },
      { kind: "reviewed-manifest" as const, academyId: "academy-other", operationId },
      { kind: "reviewed-manifest" as const, academyId, operationId: "op-other" },
    ]) {
      expect(() =>
        openMemberDirectoryArtifact({ ...wrong, sealed: envelope, secretMaterial }),
      ).toThrow(/not the artifact that was asked for/u);
    }
  });

  /**
   * Rewriting the header alone must not work either: it is bound into the tag, so a relabelled
   * envelope fails to open rather than opening as something else.
   */
  it("refuses an envelope whose header was relabelled to match", () => {
    const relabelled = sealed({ kind: "output-plan", academyId, operationId });
    expect(() =>
      openMemberDirectoryArtifact({
        kind: "output-plan",
        academyId,
        operationId,
        sealed: relabelled,
        secretMaterial,
      }),
    ).toThrow(/does not open under this key/u);
  });

  it("refuses an artifact sealed under another key", () => {
    expect(() =>
      openMemberDirectoryArtifact({
        kind: "reviewed-manifest",
        academyId,
        operationId,
        sealed: sealed(),
        secretMaterial: otherSecretMaterial,
      }),
    ).toThrow(/does not open under this key/u);
  });

  it("refuses a tampered ciphertext and a tampered tag", () => {
    const envelope = sealed();
    const flipped = Buffer.from(envelope.ciphertext, "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    expect(() =>
      openMemberDirectoryArtifact({
        kind: "reviewed-manifest",
        academyId,
        operationId,
        sealed: { ...envelope, ciphertext: flipped.toString("base64url") },
        secretMaterial,
      }),
    ).toThrow(/does not open under this key/u);

    expect(() =>
      openMemberDirectoryArtifact({
        kind: "reviewed-manifest",
        academyId,
        operationId,
        sealed: { ...envelope, authenticationTag: Buffer.alloc(16, 7).toString("base64url") },
        secretMaterial,
      }),
    ).toThrow(/does not open under this key/u);
  });

  it("refuses an envelope that is not a valid sealed artifact, or has a wrong-sized nonce", () => {
    expect(() =>
      openMemberDirectoryArtifact({
        kind: "reviewed-manifest",
        academyId,
        operationId,
        sealed: { envelopeVersion: "aes-256-gcm-v1" },
        secretMaterial,
      }),
    ).toThrow(/not a valid sealed artifact/u);

    expect(() =>
      openMemberDirectoryArtifact({
        kind: "reviewed-manifest",
        academyId,
        operationId,
        sealed: {
          ...sealed(),
          initializationVector: Buffer.alloc(8, 1).toString("base64url"),
        },
        secretMaterial,
      }),
    ).toThrow(/invalid nonce or tag/u);
  });

  it("refuses an unsafe address and an unusable key", () => {
    expect(() =>
      sealMemberDirectoryArtifact({
        kind: "reviewed-manifest",
        academyId: "../escape",
        operationId,
        artifact,
        secretMaterial,
      }),
    ).toThrow(/not a safe identifier/u);

    expect(() =>
      sealMemberDirectoryArtifact({
        kind: "reviewed-manifest",
        academyId,
        operationId,
        artifact,
        secretMaterial: "too-short",
      }),
    ).toThrow(/artifact secret/u);
  });
});
