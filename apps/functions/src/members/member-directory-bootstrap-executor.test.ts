import { describe, expect, it } from "vitest";

import {
  planMemberDirectoryBootstrapChunk,
  type MemberDirectoryBootstrapChunkInput,
  type MemberDirectoryBootstrapObservedRow,
} from "./member-directory-bootstrap-executor.js";
import { buildStudentIdentityKey } from "./member-directory-crypto.js";

const academyId = "academy-bpt-jersey";
const identitySecretMaterial = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const identitySecretVersion = "identity-v1";
const now = "2026-09-07T12:01:00.000Z";
const actorId = "runner-a";

const dependencies = {
  identitySecretMaterial,
  identitySecretVersion,
  integritySecretMaterial,
};

function student(
  studentId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    studentId,
    academyId,
    fullName: "Synthetic Bootstrap Student",
    dateOfBirth: "2000-01-02",
    phoneNumber: "+441534000001",
    email: `${studentId}@example.test`,
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "system",
    updatedAt: "2026-09-01T00:00:00.000Z",
    updatedBy: "system",
    ...overrides,
  };
}

function profile(
  studentId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    studentId,
    academyId,
    membershipNumber: `BPT ${studentId.slice(-4)}`,
    gender: "unknown",
    source: "admin",
    schemaVersion: "1",
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "system",
    updatedAt: "2026-09-01T00:00:00.000Z",
    updatedBy: "system",
    ...overrides,
  };
}

function row(
  studentId: string,
  overrides: Partial<MemberDirectoryBootstrapObservedRow> = {},
): MemberDirectoryBootstrapObservedRow {
  return {
    studentId,
    student: student(studentId),
    profile: profile(studentId),
    ...overrides,
  };
}

function input(
  overrides: Partial<MemberDirectoryBootstrapChunkInput> = {},
): MemberDirectoryBootstrapChunkInput {
  return {
    academyId,
    operationId: "op-bootstrap-1",
    chunkNo: 1,
    plannedStudentIds: ["student-1001"],
    observed: [row("student-1001")],
    existingKeys: [],
    now,
    actorId,
    ...overrides,
  };
}

function existingKeyFor(
  studentId: string,
  kind: "membership-number" | "id-card-number",
  value: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    ...buildStudentIdentityKey({
      academyId,
      kind,
      value,
      ownerStudentId: studentId,
      secretMaterial: identitySecretMaterial,
      secretVersion: identitySecretVersion,
      now: "2026-09-01T00:00:00.000Z",
      actorId: "system",
    }),
    ...overrides,
  };
}

describe("member directory bootstrap chunk executor", () => {
  it("creates one reservation per current identifier of a planned student", () => {
    const plan = planMemberDirectoryBootstrapChunk(
      input({
        observed: [
          row("student-1001", {
            student: student("student-1001", { userId: "auth-user-1" }),
            profile: profile("student-1001", {
              idCardNumber: "ID-1001",
              vatNumber: "VAT-1001",
              source: "legacy-member-migration",
              migrationId: "migration-1",
              legacyMemberId: "LEGACY-1001",
            }),
          }),
        ],
      }),
      dependencies,
    );

    expect(plan.chunkId).toBe("op-bootstrap-1:bootstrap:1");
    expect(plan.rowCount).toBe(1);
    expect(plan.quarantinedCount).toBe(0);
    // membership-number, id-card-number, vat-number, legacy-member-id and auth-user-id: leaving any
    // of the five out would free that identifier for a second student.
    expect(plan.createdKeyCount).toBe(5);
    expect(plan.preservedKeyCount).toBe(0);
    expect(plan.expectedKeyTuples).toHaveLength(5);
    expect(plan.domainWrites).toHaveLength(5);
    expect(plan.domainWrites.every((write) => write.operation === "create")).toBe(true);
    expect(plan.domainWrites[0]?.path).toMatch(
      /^academies\/academy-bpt-jersey\/studentIdentityKeys\//u,
    );
    expect(plan.outputSetMac).toMatch(/^[a-f0-9]{64}$/u);
  });

  /**
   * The property that makes a failed bootstrap resumable and abandonable: an existing compatible
   * key is preserved, never rewritten, so nothing is lost by running the chunk again.
   */
  it("preserves a compatible existing key instead of writing it again", () => {
    const plan = planMemberDirectoryBootstrapChunk(
      input({
        observed: [
          row("student-1001", {
            profile: profile("student-1001", { idCardNumber: "ID-1001" }),
          }),
        ],
        existingKeys: [existingKeyFor("student-1001", "membership-number", "BPT 1001")],
      }),
      dependencies,
    );

    expect(plan.preservedKeyCount).toBe(1);
    expect(plan.createdKeyCount).toBe(1);
    expect(plan.expectedKeyTuples).toHaveLength(2);
    expect(plan.domainWrites).toHaveLength(1);
  });

  it("refuses a key already owned by another student", () => {
    expect(() =>
      planMemberDirectoryBootstrapChunk(
        input({
          existingKeys: [existingKeyFor("student-9999", "membership-number", "BPT 1001")],
        }),
        dependencies,
      ),
    ).toThrow(/owned by another student/u);
  });

  /**
   * Rotation is outside v1, so a key minted under another secret version cannot be proven to cover
   * this identifier. Adopting it would record a baseline over reservations nothing can re-derive.
   */
  it("refuses an existing key minted under another secret version", () => {
    expect(() =>
      planMemberDirectoryBootstrapChunk(
        input({
          existingKeys: [
            existingKeyFor("student-1001", "membership-number", "BPT 1001", {
              secretVersion: "identity-v2",
            }),
          ],
        }),
        dependencies,
      ),
    ).toThrow(/not compatible/u);
  });

  it("refuses a malformed existing key rather than treating it as absent", () => {
    expect(() =>
      planMemberDirectoryBootstrapChunk(
        input({ existingKeys: [{ keyId: "membership-number:not-a-digest" }] }),
        dependencies,
      ),
    ).toThrow(/not a valid record/u);
  });

  it("refuses two planned students claiming the same identifier", () => {
    expect(() =>
      planMemberDirectoryBootstrapChunk(
        input({
          plannedStudentIds: ["student-1001", "student-1002"],
          observed: [
            row("student-1001", {
              profile: profile("student-1001", { membershipNumber: "BPT 1" }),
            }),
            row("student-1002", {
              profile: profile("student-1002", { membershipNumber: "BPT 1" }),
            }),
          ],
        }),
        dependencies,
      ),
    ).toThrow(/same current identifier/u);
  });

  it("refuses a planned student whose admin profile is gone", () => {
    expect(() =>
      planMemberDirectoryBootstrapChunk(
        input({ observed: [row("student-1001", { profile: undefined })] }),
        dependencies,
      ),
    ).toThrow(/has no admin profile/u);
  });

  it("refuses a planned student whose document is gone", () => {
    expect(() =>
      planMemberDirectoryBootstrapChunk(
        input({ observed: [row("student-1001", { student: undefined })] }),
        dependencies,
      ),
    ).toThrow(/no longer exists/u);
  });

  it("refuses a document that belongs to another academy", () => {
    expect(() =>
      planMemberDirectoryBootstrapChunk(
        input({
          observed: [
            row("student-1001", {
              profile: profile("student-1001", { academyId: "academy-other" }),
            }),
          ],
        }),
        dependencies,
      ),
    ).toThrow(/another academy/u);
  });

  it("refuses a profile filed under a different student", () => {
    expect(() =>
      planMemberDirectoryBootstrapChunk(
        input({ observed: [row("student-1001", { profile: profile("student-2002") })] }),
        dependencies,
      ),
    ).toThrow(/does not own the documents read/u);
  });

  it("refuses documents that are not in the planned order", () => {
    expect(() =>
      planMemberDirectoryBootstrapChunk(
        input({
          plannedStudentIds: ["student-1001", "student-1002"],
          observed: [row("student-1002"), row("student-1001")],
        }),
        dependencies,
      ),
    ).toThrow(/not in the planned order/u);
  });

  it("refuses a plan that repeats or unsorts its student IDs", () => {
    expect(() =>
      planMemberDirectoryBootstrapChunk(
        input({
          plannedStudentIds: ["student-1001", "student-1001"],
          observed: [row("student-1001"), row("student-1001")],
        }),
        dependencies,
      ),
    ).toThrow(/ascend by document ID without repeats/u);
  });

  it("refuses an empty chunk, which is the parent's transition and not a chunk", () => {
    expect(() =>
      planMemberDirectoryBootstrapChunk(
        input({ plannedStudentIds: [], observed: [] }),
        dependencies,
      ),
    ).toThrow(/at least one planned student/u);
  });

  it("refuses more than fifty planned students in one chunk", () => {
    const ids = Array.from({ length: 51 }, (_, index) => `student-${String(2000 + index)}`);
    expect(() =>
      planMemberDirectoryBootstrapChunk(
        input({ plannedStudentIds: ids, observed: ids.map((id) => row(id)) }),
        dependencies,
      ),
    ).toThrow(/at most 50 planned students/u);
  });

  /**
   * The MAC has to describe *this* chunk, not just its documents: an identical write set planned
   * under another chunk number must not produce a receipt that verifies here.
   */
  it("binds the output MAC to the chunk that produced it", () => {
    const first = planMemberDirectoryBootstrapChunk(input(), dependencies);
    const second = planMemberDirectoryBootstrapChunk(input({ chunkNo: 2 }), dependencies);

    expect(second.domainWrites).toEqual(first.domainWrites);
    expect(second.outputSetMac).not.toBe(first.outputSetMac);
  });

  it("changes the output MAC when the documents written change", () => {
    const first = planMemberDirectoryBootstrapChunk(input(), dependencies);
    const second = planMemberDirectoryBootstrapChunk(
      input({
        observed: [
          row("student-1001", { profile: profile("student-1001", { idCardNumber: "ID-1001" }) }),
        ],
      }),
      dependencies,
    );

    expect(second.outputSetMac).not.toBe(first.outputSetMac);
  });
});
