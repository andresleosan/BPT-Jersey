import { describe, expect, it } from "vitest";

import {
  assertDistinctMemberDirectorySecrets,
  buildStudentIdentityKey,
  canonicalizeMemberDirectoryValue,
  constantTimeMacEquals,
  createMemberDirectoryIntegrityMac,
  decodeMemberDirectorySecret,
  encodeLengthPrefixedUtf8,
} from "./member-directory-crypto.js";

const identitySecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecret = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const cursorSecret = "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8";

describe("member directory cryptographic boundaries", () => {
  it("publishes the approved length-prefixed HMAC golden vector", () => {
    const encoded = encodeLengthPrefixedUtf8([
      "bpt-student-identity-v1",
      "academy-1",
      "membership-number",
      "BPT 00001234",
    ]);
    expect(encoded.subarray(0, 4).toString("hex")).toBe("00000017");

    const key = buildStudentIdentityKey({
      academyId: "academy-1",
      kind: "membership-number",
      value: " bpt 00001234 ",
      ownerStudentId: "student-1",
      secretMaterial: identitySecret,
      secretVersion: "identity-v1",
      now: "2026-09-03T20:00:00.000Z",
      actorId: "owner-1",
    });

    expect(key.keyId).toBe(
      "membership-number:011dd3ddb0ad0164c572fba224ae7f38363097785bb3308a26110420918ccb08",
    );
    expect(key).toEqual({
      keyId: expect.stringMatching(/^membership-number:[a-f0-9]{64}$/u),
      academyId: "academy-1",
      kind: "membership-number",
      digestVersion: "hmac-sha256-v1",
      secretVersion: "identity-v1",
      ownerStudentId: "student-1",
      schemaVersion: "1",
      createdAt: "2026-09-03T20:00:00.000Z",
      createdBy: "owner-1",
      updatedAt: "2026-09-03T20:00:00.000Z",
      updatedBy: "owner-1",
    });
    expect(JSON.stringify(key)).not.toContain("BPT 00001234");
  });

  it("normalizes administrative values but compares Auth UIDs exactly", () => {
    const common = {
      academyId: "academy-1",
      ownerStudentId: "student-1",
      secretMaterial: identitySecret,
      secretVersion: "identity-v1",
      now: "2026-09-03T20:00:00.000Z",
      actorId: "owner-1",
    } as const;
    const normalized = buildStudentIdentityKey({
      ...common,
      kind: "id-card-number",
      value: " id-\uFF11\uFF12\uFF13 ",
    });
    const canonical = buildStudentIdentityKey({
      ...common,
      kind: "id-card-number",
      value: "ID-123",
    });
    const authLower = buildStudentIdentityKey({ ...common, kind: "auth-user-id", value: "Uid-1" });
    const authUpper = buildStudentIdentityKey({ ...common, kind: "auth-user-id", value: "UID-1" });

    expect(normalized.keyId).toBe(canonical.keyId);
    expect(authLower.keyId).not.toBe(authUpper.keyId);
  });

  it("rejects unsafe identifiers and malformed secret material", () => {
    const common = {
      academyId: "academy-1",
      ownerStudentId: "student-1",
      secretMaterial: identitySecret,
      secretVersion: "identity-v1",
      now: "2026-09-03T20:00:00.000Z",
      actorId: "owner-1",
    } as const;
    for (const candidate of [
      { ...common, kind: "vat-number" as const, value: "_VAT" },
      { ...common, kind: "auth-user-id" as const, value: "uid/1" },
      { ...common, kind: "legacy-member-id" as const, value: "A".repeat(65) },
      { ...common, kind: "membership-number" as const, value: "A\u0000B" },
    ]) {
      expect(() => buildStudentIdentityKey(candidate)).toThrow(/invalid/i);
    }

    for (const secret of ["", "abc=", "not+base64url", "c2hvcnQ"]) {
      expect(() => decodeMemberDirectorySecret(secret, "identity")).toThrow(/secret/i);
    }
  });

  it("requires distinct purpose secrets and compares MACs without coercion", () => {
    expect(() =>
      assertDistinctMemberDirectorySecrets({
        identity: identitySecret,
        integrity: identitySecret,
        cursor: cursorSecret,
      }),
    ).toThrow(/distinct/i);
    expect(() =>
      assertDistinctMemberDirectorySecrets({
        identity: identitySecret,
        integrity: integritySecret,
        cursor: cursorSecret,
      }),
    ).not.toThrow();

    const mac = "a".repeat(64);
    expect(constantTimeMacEquals(mac, mac)).toBe(true);
    expect(constantTimeMacEquals(mac, "b".repeat(64))).toBe(false);
    expect(constantTimeMacEquals(mac, "short")).toBe(false);
    expect(constantTimeMacEquals(mac, "A".repeat(64))).toBe(false);
  });

  it("canonicalizes integrity input independently of object insertion order", () => {
    const left = canonicalizeMemberDirectoryValue({
      revision: 8,
      academyId: "academy-1",
      nested: { enabled: true, values: ["a", "b"] },
    });
    const right = canonicalizeMemberDirectoryValue({
      nested: { values: ["a", "b"], enabled: true },
      academyId: "academy-1",
      revision: 8,
    });

    expect(left).toBe(
      '{"academyId":"academy-1","nested":{"enabled":true,"values":["a","b"]},"revision":8}',
    );
    expect(right).toBe(left);
    expect(
      createMemberDirectoryIntegrityMac({
        domain: "bpt-member-directory-test-v1",
        values: [left],
        secretMaterial: integritySecret,
      }),
    ).toMatch(/^[a-f0-9]{64}$/u);
    for (const value of [undefined, Number.NaN, 1.5, new Date(), { value: undefined }]) {
      expect(() => canonicalizeMemberDirectoryValue(value)).toThrow(/canonical/i);
    }
  });
});
