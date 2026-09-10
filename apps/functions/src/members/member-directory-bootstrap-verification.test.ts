import { describe, expect, it } from "vitest";

import {
  createMemberDirectoryIdentityBaselineMac,
  buildStudentIdentityKey,
} from "./member-directory-crypto.js";
import {
  verifyMemberDirectoryBootstrapBaseline,
  type MemberDirectoryBootstrapChunkEvidence,
} from "./member-directory-bootstrap-verification.js";

const academyId = "academy-bpt-jersey";
const operationId = "op-bootstrap-1";
const secretVersion = "identity-v1";
const identitySecretMaterial = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const dependencies = { integritySecretMaterial };

function tuple(studentId: string, value: string): string {
  const key = buildStudentIdentityKey({
    academyId,
    kind: "membership-number",
    value,
    ownerStudentId: studentId,
    secretMaterial: identitySecretMaterial,
    secretVersion,
    now: "2026-09-07T10:00:00.000Z",
    actorId: "runner-a",
  });
  return [key.kind, key.keyId, key.ownerStudentId, key.digestVersion, key.secretVersion].join(",");
}

const firstTuple = tuple("student-1", "BPT 1");
const secondTuple = tuple("student-2", "BPT 2");

function receipt(chunkNo: number, writtenCount = 1): Readonly<Record<string, unknown>> {
  return {
    chunkId: `${operationId}:bootstrap:${String(chunkNo)}`,
    operationId,
    academyId,
    phase: "bootstrap",
    chunkNo,
    status: "committed",
    outputSetMac: "a".repeat(64),
    writtenCount,
    quarantinedCount: 0,
    integrityMacVersion: "hmac-sha256-v1",
    integritySecretVersion: "integrity-v1",
    schemaVersion: "1",
    createdAt: "2026-09-07T12:00:00.000Z",
    createdBy: "runner-a",
  };
}

function baselineMac(tuples: readonly string[]): string {
  return createMemberDirectoryIdentityBaselineMac({
    academyId,
    operationId,
    secretVersion,
    tuples,
    secretMaterial: integritySecretMaterial,
  });
}

const chunks: readonly MemberDirectoryBootstrapChunkEvidence[] = [
  { receipt: receipt(1), tuples: [firstTuple] },
  { receipt: receipt(2), tuples: [secondTuple] },
];

function verify(
  overrides: Partial<Parameters<typeof verifyMemberDirectoryBootstrapBaseline>[0]> = {},
) {
  return verifyMemberDirectoryBootstrapBaseline(
    {
      academyId,
      operationId,
      secretVersion,
      chunks,
      artifactBaselineMac: baselineMac([firstTuple, secondTuple]),
      ...overrides,
    },
    dependencies,
  );
}

describe("member directory bootstrap verification", () => {
  it("recomputes the baseline over every chunk and matches the artifact", () => {
    const verified = verify();

    expect(verified.chunkCount).toBe(2);
    expect(verified.identityCount).toBe(2);
    expect(verified.writtenCount).toBe(2);
    expect(verified.identityKeyBaselineMac).toMatch(/^[a-f0-9]{64}$/u);
  });

  /**
   * The baseline is a proof about a set, so the order the chunks discovered the identities in must
   * not change it. Without this, resuming a failed bootstrap in a different order could never
   * reproduce the artifact it is being checked against.
   */
  it("does not depend on the order identities were discovered in", () => {
    expect(baselineMac([firstTuple, secondTuple])).toBe(baselineMac([secondTuple, firstTuple]));
  });

  it("refuses a duplicated identity instead of folding it in twice", () => {
    expect(() => baselineMac([firstTuple, firstTuple])).toThrow(/same tuple twice/u);
  });

  /** A hole means a chunk was lost or replayed out of order; verifying the rest would bless it. */
  it("refuses a sequence with a hole", () => {
    expect(() =>
      verify({
        chunks: [
          { receipt: receipt(1), tuples: [firstTuple] },
          { receipt: receipt(3), tuples: [secondTuple] },
        ],
      }),
    ).toThrow(/advance without gaps/u);
  });

  it("refuses chunks presented out of order", () => {
    expect(() =>
      verify({
        chunks: [
          { receipt: receipt(2), tuples: [secondTuple] },
          { receipt: receipt(1), tuples: [firstTuple] },
        ],
      }),
    ).toThrow(/ascending order/u);
  });

  /**
   * The case the whole function exists for: an identity appeared, vanished or changed owner between
   * planning and verification. There is no safe repair, because the baseline is what every later
   * writer proves itself against.
   */
  it("refuses when an identity was added since the artifact was built", () => {
    expect(() =>
      verify({
        chunks: [
          { receipt: receipt(1), tuples: [firstTuple] },
          { receipt: receipt(2), tuples: [secondTuple, tuple("student-3", "BPT 3")] },
        ],
      }),
    ).toThrow(/does not match its artifact/u);
  });

  it("refuses when an identity is missing since the artifact was built", () => {
    expect(() => verify({ chunks: [{ receipt: receipt(1), tuples: [firstTuple] }] })).toThrow(
      /does not match its artifact/u,
    );
  });

  it("refuses a receipt from another operation or academy", () => {
    expect(() =>
      verify({
        chunks: [{ receipt: { ...receipt(1), academyId: "academy-other" }, tuples: [firstTuple] }],
      }),
    ).toThrow(/another operation or academy/u);
  });

  it("refuses a chunk of another phase", () => {
    expect(() =>
      verify({
        chunks: [
          {
            receipt: {
              ...receipt(1),
              phase: "forward",
              chunkId: `${operationId}:forward:1`,
            },
            tuples: [firstTuple],
          },
        ],
      }),
    ).toThrow(/cannot prove an identity-key baseline/u);
  });

  it("refuses an operation with no committed chunk", () => {
    expect(() => verify({ chunks: [] })).toThrow(/no committed chunk/u);
  });

  /** A baseline computed for one operation must not verify as another's. */
  it("binds the baseline to its own operation and secret version", () => {
    const other = createMemberDirectoryIdentityBaselineMac({
      academyId,
      operationId: "op-bootstrap-2",
      secretVersion,
      tuples: [firstTuple, secondTuple],
      secretMaterial: integritySecretMaterial,
    });
    const rotated = createMemberDirectoryIdentityBaselineMac({
      academyId,
      operationId,
      secretVersion: "identity-v2",
      tuples: [firstTuple, secondTuple],
      secretMaterial: integritySecretMaterial,
    });

    expect(other).not.toBe(baselineMac([firstTuple, secondTuple]));
    expect(rotated).not.toBe(baselineMac([firstTuple, secondTuple]));
  });
});
