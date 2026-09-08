import { describe, expect, it } from "vitest";

import {
  buildStudentIdentityKey,
  createMemberDirectorySourceRowMac,
} from "./member-directory-crypto.js";
import {
  planMemberDirectoryForwardChunk,
  type MemberDirectoryForwardChunkInput,
  type MemberDirectoryForwardObservedRow,
  type MemberDirectoryForwardPlannedRow,
} from "./member-directory-forward-executor.js";

const academyId = "academy-bpt-jersey";
const identitySecretMaterial = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const identitySecretVersion = "identity-v1";
const operationId = "op-forward-1";
const operationWriteTime = "2026-09-08T12:00:00.000Z";
const effectiveDate = "2026-09-08";
const actorId = "runner-a";

const dependencies = {
  identitySecretMaterial,
  identitySecretVersion,
  integritySecretMaterial,
};

function legacyMember(
  memberId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    memberId,
    academyId,
    membershipNumber: "BPT 4001",
    fullName: "Synthetic Forward Member",
    email: "forward-4001@example.test",
    birthDate: "1990-04-05",
    mobileNumber: "+441534000401",
    frequency: "Twice a week",
    paymentStatus: "regularized",
    gender: "unknown",
    trainingCenter: "Town",
    membershipStatus: "active",
    createdAt: "2026-01-02T00:00:00.000Z",
    createdBy: "system",
    updatedAt: "2026-01-02T00:00:00.000Z",
    updatedBy: "system",
    source: "member-pdf-import",
    schemaVersion: "1",
    ...overrides,
  };
}

function canonicalStudent(
  studentId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    studentId,
    academyId,
    fullName: "Existing Canonical Student",
    dateOfBirth: "1988-03-04",
    trainingCenter: "West",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-02-01T00:00:00.000Z",
    createdBy: "system",
    updatedAt: "2026-02-01T00:00:00.000Z",
    updatedBy: "system",
    ...overrides,
  };
}

function family(
  familyId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    familyId,
    academyId,
    primaryContactUserId: "guardian-user-1",
    billingContactUserId: "guardian-user-1",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-02-01T00:00:00.000Z",
    createdBy: "system",
    updatedAt: "2026-02-01T00:00:00.000Z",
    updatedBy: "system",
    ...overrides,
  };
}

function relationship(
  relationshipId: string,
  studentId: string,
  familyId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    relationshipId,
    academyId,
    familyId,
    studentId,
    adultUserId: "guardian-user-1",
    relationshipType: "guardian",
    permissions: ["readProfile"],
    validFrom: "2026-02-01T00:00:00.000Z",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-02-01T00:00:00.000Z",
    createdBy: "system",
    updatedAt: "2026-02-01T00:00:00.000Z",
    updatedBy: "system",
    ...overrides,
  };
}

/** The default legacy row minus one field, for the cases where the source lost a required value. */
function legacyMemberWithout(field: string): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(legacyMember("LEGACY-4001")).filter(([key]) => key !== field),
  );
}

function sourceMacOf(member: Readonly<Record<string, unknown>>): string {
  return createMemberDirectorySourceRowMac({
    academyId,
    sourceCollection: "members",
    sourceId: member.memberId as string,
    document: member,
    secretMaterial: integritySecretMaterial,
  });
}

function plannedRow(
  overrides: Partial<MemberDirectoryForwardPlannedRow> = {},
): MemberDirectoryForwardPlannedRow {
  return {
    legacyMemberId: "LEGACY-4001",
    classification: "createable-adult",
    explicitlyReviewed: false,
    targetStudentId: "student-new-4001",
    sourceRowMac: sourceMacOf(legacyMember("LEGACY-4001")),
    trainingTimePreferences: ["evening"],
    ...overrides,
  };
}

function observedRow(
  overrides: Partial<MemberDirectoryForwardObservedRow> = {},
): MemberDirectoryForwardObservedRow {
  return {
    legacyMemberId: "LEGACY-4001",
    member: legacyMember("LEGACY-4001"),
    student: undefined,
    profile: undefined,
    ...overrides,
  };
}

function input(
  overrides: Partial<MemberDirectoryForwardChunkInput> = {},
): MemberDirectoryForwardChunkInput {
  return {
    academyId,
    operationId,
    chunkNo: 1,
    plannedRows: [plannedRow()],
    observed: [observedRow()],
    existingKeys: [],
    operationWriteTime,
    effectiveDate,
    actorId,
    ...overrides,
  };
}

function writeAt(
  plan: ReturnType<typeof planMemberDirectoryForwardChunk>,
  path: string,
): Readonly<Record<string, unknown>> | undefined {
  return plan.domainWrites.find((write) => write.path === path)?.data;
}

describe("member directory forward chunk executor", () => {
  it("creates an inactive student, its admin profile and one reservation per identifier", () => {
    const member = legacyMember("LEGACY-4001", {
      idCardNumber: "id-4001",
      vatNumber: "VAT-4001",
    });
    const plan = planMemberDirectoryForwardChunk(
      input({
        plannedRows: [plannedRow({ sourceRowMac: sourceMacOf(member) })],
        observed: [observedRow({ member })],
      }),
      dependencies,
    );

    expect(plan.chunkId).toBe("op-forward-1:forward:1");
    expect(plan.rowCount).toBe(1);
    expect(plan.quarantinedCount).toBe(0);
    expect(plan.createdStudentCount).toBe(1);
    expect(plan.createdProfileCount).toBe(1);
    // membership-number, id-card-number, vat-number and legacy-member-id. Never auth-user-id:
    // migration invents no Auth user, and an existing link was reserved by the bootstrap.
    expect(plan.createdKeyCount).toBe(4);
    expect(plan.domainWrites).toHaveLength(6);
    expect(plan.domainWrites.every((write) => write.operation === "create")).toBe(true);
    expect(plan.outputSetMac).toMatch(/^[a-f0-9]{64}$/u);

    const student = writeAt(plan, `academies/${academyId}/students/student-new-4001`);
    // Invariant 23: the legacy active/regularized labels never activate anybody.
    expect(student).toMatchObject({
      studentId: "student-new-4001",
      dateOfBirth: "1990-04-05",
      participantType: "adult",
      trainingCenter: "Town",
      active: false,
      status: "inactive",
      createdAt: operationWriteTime,
    });
    expect(student).not.toHaveProperty("familyId");
    expect(student).not.toHaveProperty("userId");

    const profile = writeAt(plan, `academies/${academyId}/studentAdminProfiles/student-new-4001`);
    expect(profile).toMatchObject({
      source: "legacy-member-migration",
      migrationId: operationId,
      legacyMemberId: "LEGACY-4001",
      membershipNumber: "BPT 4001",
      // Normalized on the way in, because the exact-lookup recheck recomputes the digest from the
      // value stored here; storing "id-4001" would make its own reservation unresolvable.
      idCardNumber: "ID-4001",
      frequencyNote: "Twice a week",
    });
    // The legacy import run belongs to the import, not to this migration.
    expect(profile).not.toHaveProperty("importRunId");
  });

  /**
   * The fingerprint is what makes "reject the whole plan if any input changed" real. Without it the
   * chunk would migrate whatever the source says at commit time rather than what a human reviewed.
   */
  it("refuses a legacy row that changed since it was reviewed", () => {
    expect(() =>
      planMemberDirectoryForwardChunk(
        input({
          observed: [
            observedRow({ member: legacyMember("LEGACY-4001", { fullName: "Renamed Member" }) }),
          ],
        }),
        dependencies,
      ),
    ).toThrow(/changed since it was reviewed/u);
  });

  it("refuses a row whose classification is not write eligible", () => {
    expect(() =>
      planMemberDirectoryForwardChunk(
        input({ plannedRows: [plannedRow({ classification: "identity-conflict" })] }),
        dependencies,
      ),
    ).toThrow(/not write eligible/u);
  });

  /**
   * `same-id-compatible` is eligible only after an explicit review, and the review flag is the only
   * thing that separates the two cases - so the executor must not treat the classification alone as
   * permission.
   */
  it("refuses an unreviewed same-ID coincidence and accepts a reviewed one", () => {
    const student = canonicalStudent("LEGACY-4001");
    const unreviewed = input({
      plannedRows: [
        plannedRow({ classification: "same-id-compatible", targetStudentId: "LEGACY-4001" }),
      ],
      observed: [observedRow({ student })],
    });
    expect(() => planMemberDirectoryForwardChunk(unreviewed, dependencies)).toThrow(
      /not write eligible/u,
    );

    const plan = planMemberDirectoryForwardChunk(
      input({
        plannedRows: [
          plannedRow({
            classification: "same-id-compatible",
            explicitlyReviewed: true,
            targetStudentId: "LEGACY-4001",
          }),
        ],
        observed: [observedRow({ student })],
      }),
      dependencies,
    );
    // A match creates no student: the profile and the reservations are the whole write.
    expect(plan.createdStudentCount).toBe(0);
    expect(plan.createdProfileCount).toBe(1);
    expect(plan.createdKeyCount).toBe(2);
  });

  /**
   * An explicit match whose target ID equals the legacy ID is the same-ID coincidence wearing
   * another label, and letting it through would be the way around the review the manifest demands.
   */
  it("refuses an explicit match that is really a same-ID coincidence", () => {
    expect(() =>
      planMemberDirectoryForwardChunk(
        input({
          plannedRows: [
            plannedRow({
              classification: "explicit-existing-student-match",
              targetStudentId: "LEGACY-4001",
            }),
          ],
          observed: [observedRow({ student: canonicalStudent("LEGACY-4001") })],
        }),
        dependencies,
      ),
    ).toThrow(/same-ID coincidence in another name/u);
  });

  /** Invariant 28: a new student ID is backend-generated and opaque, never the legacy one. */
  it("refuses a create that reuses the legacy ID as the new student ID", () => {
    expect(() =>
      planMemberDirectoryForwardChunk(
        input({ plannedRows: [plannedRow({ targetStudentId: "LEGACY-4001" })] }),
        dependencies,
      ),
    ).toThrow(/reuses its legacy ID/u);
  });

  it("refuses a create whose target student already exists", () => {
    expect(() =>
      planMemberDirectoryForwardChunk(
        input({ observed: [observedRow({ student: canonicalStudent("student-new-4001") })] }),
        dependencies,
      ),
    ).toThrow(/already exists/u);
  });

  /**
   * Step 6 creates an admin profile only when absent, and nothing overwrites one. A profile that
   * exists now is a changed input, not a row to skip - and it has nowhere to record the legacy ID,
   * so the reservation this row would write could never be rechecked against it.
   */
  it("refuses a row whose target already has an admin profile", () => {
    expect(() =>
      planMemberDirectoryForwardChunk(
        input({
          observed: [
            observedRow({
              profile: {
                studentId: "student-new-4001",
                academyId,
                gender: "unknown",
                source: "admin",
                schemaVersion: "1",
                createdAt: "2026-02-01T00:00:00.000Z",
                createdBy: "system",
                updatedAt: "2026-02-01T00:00:00.000Z",
                updatedBy: "system",
              },
            }),
          ],
        }),
        dependencies,
      ),
    ).toThrow(/already has an admin profile/u);
  });

  /** Invariant 10 and 11: no date of birth and no recognised training center means no conversion. */
  it("refuses a create whose legacy row lost a required field", () => {
    const noCenter = legacyMemberWithout("trainingCenter");
    expect(() =>
      planMemberDirectoryForwardChunk(
        input({
          plannedRows: [plannedRow({ sourceRowMac: sourceMacOf(noCenter) })],
          observed: [observedRow({ member: noCenter })],
        }),
        dependencies,
      ),
    ).toThrow(/no recognised training center/u);

    const withoutBirthDate = legacyMemberWithout("birthDate");
    expect(() =>
      planMemberDirectoryForwardChunk(
        input({
          plannedRows: [plannedRow({ sourceRowMac: sourceMacOf(withoutBirthDate) })],
          observed: [observedRow({ member: withoutBirthDate })],
        }),
        dependencies,
      ),
    ).toThrow(/no date of birth/u);
  });

  /**
   * A legacy timestamp would need a time zone nobody chose, and truncating it can move somebody
   * across the adult boundary by a day.
   */
  it("refuses a date of birth that is not a plain date", () => {
    const member = legacyMember("LEGACY-4001", { birthDate: "1990-04-05T23:30:00.000Z" });
    expect(() =>
      planMemberDirectoryForwardChunk(
        input({
          plannedRows: [plannedRow({ sourceRowMac: sourceMacOf(member) })],
          observed: [observedRow({ member })],
        }),
        dependencies,
      ),
    ).toThrow(/not a plain date/u);
  });

  /** `minor-requires-family-match` is never eligible, so a create that reads minor fails closed. */
  it("refuses a createable-adult row that is a minor at the effective date", () => {
    const member = legacyMember("LEGACY-4001", { birthDate: "2015-04-05" });
    expect(() =>
      planMemberDirectoryForwardChunk(
        input({
          plannedRows: [plannedRow({ sourceRowMac: sourceMacOf(member) })],
          observed: [observedRow({ member })],
        }),
        dependencies,
      ),
    ).toThrow(/not an adult at the effective date/u);
  });

  /** Invariant 8: a minor needs an active family and relationship in the same academy. */
  it("matches an existing minor only under the reviewed active family and relationship", () => {
    const minor = canonicalStudent("student-minor-1", {
      dateOfBirth: "2015-06-07",
      participantType: "minor",
      familyId: "family-1",
    });
    const minorRow = plannedRow({
      classification: "explicit-existing-student-match",
      targetStudentId: "student-minor-1",
      familyId: "family-1",
      relationshipId: "relationship-1",
    });
    const observedMinor = observedRow({
      student: minor,
      family: family("family-1"),
      relationship: relationship("relationship-1", "student-minor-1", "family-1"),
    });

    const plan = planMemberDirectoryForwardChunk(
      input({ plannedRows: [minorRow], observed: [observedMinor] }),
      dependencies,
    );
    expect(plan.createdStudentCount).toBe(0);
    expect(plan.createdProfileCount).toBe(1);

    expect(() =>
      planMemberDirectoryForwardChunk(
        input({
          plannedRows: [minorRow],
          observed: [
            observedRow({
              student: minor,
              family: family("family-1", { active: false, status: "inactive" }),
              relationship: relationship("relationship-1", "student-minor-1", "family-1"),
            }),
          ],
        }),
        dependencies,
      ),
    ).toThrow(/not active in this academy/u);

    expect(() =>
      planMemberDirectoryForwardChunk(
        input({
          plannedRows: [minorRow],
          observed: [
            observedRow({
              student: minor,
              family: family("family-1"),
              relationship: relationship("relationship-1", "student-other-1", "family-1"),
            }),
          ],
        }),
        dependencies,
      ),
    ).toThrow(/does not cover this student/u);

    expect(() =>
      planMemberDirectoryForwardChunk(
        input({
          plannedRows: [
            plannedRow({
              classification: "explicit-existing-student-match",
              targetStudentId: "student-minor-1",
            }),
          ],
          observed: [observedRow({ student: minor })],
        }),
        dependencies,
      ),
    ).toThrow(/matches a minor without a reviewed family/u);
  });

  it("refuses a matched student from another academy", () => {
    expect(() =>
      planMemberDirectoryForwardChunk(
        input({
          plannedRows: [
            plannedRow({
              classification: "explicit-existing-student-match",
              targetStudentId: "student-other-academy",
            }),
          ],
          observed: [
            observedRow({
              student: canonicalStudent("student-other-academy", { academyId: "academy-other" }),
            }),
          ],
        }),
        dependencies,
      ),
    ).toThrow(/belongs to another academy/u);
  });

  /**
   * `identity-conflict` is never write-eligible. A reservation that already exists means somebody
   * already holds the identifier this row migrates, even when the owner is this same student.
   */
  it("refuses a row whose identifier is already reserved", () => {
    const existing = buildStudentIdentityKey({
      academyId,
      kind: "membership-number",
      value: "BPT 4001",
      ownerStudentId: "student-new-4001",
      secretMaterial: identitySecretMaterial,
      secretVersion: identitySecretVersion,
      now: "2026-09-01T00:00:00.000Z",
      actorId: "system",
    });
    expect(() =>
      planMemberDirectoryForwardChunk(input({ existingKeys: [existing] }), dependencies),
    ).toThrow(/already reserved/u);
  });

  it("refuses two rows of one chunk that claim the same identifier", () => {
    const first = legacyMember("LEGACY-4001");
    const second = legacyMember("LEGACY-4002");
    expect(() =>
      planMemberDirectoryForwardChunk(
        input({
          plannedRows: [
            plannedRow({ sourceRowMac: sourceMacOf(first) }),
            plannedRow({
              legacyMemberId: "LEGACY-4002",
              targetStudentId: "student-new-4002",
              sourceRowMac: sourceMacOf(second),
            }),
          ],
          observed: [
            observedRow({ member: first }),
            observedRow({ legacyMemberId: "LEGACY-4002", member: second }),
          ],
        }),
        dependencies,
      ),
    ).toThrow(/claim the same identifier/u);
  });

  it("refuses two rows of one chunk that target the same student", () => {
    const second = legacyMember("LEGACY-4002", { membershipNumber: "BPT 4002" });
    expect(() =>
      planMemberDirectoryForwardChunk(
        input({
          plannedRows: [
            plannedRow(),
            plannedRow({
              legacyMemberId: "LEGACY-4002",
              sourceRowMac: sourceMacOf(second),
            }),
          ],
          observed: [observedRow(), observedRow({ legacyMemberId: "LEGACY-4002", member: second })],
        }),
        dependencies,
      ),
    ).toThrow(/target the same student/u);
  });

  it("refuses rows that do not ascend by legacy member ID and reads out of planned order", () => {
    const second = legacyMember("LEGACY-4002", { membershipNumber: "BPT 4002" });
    const secondRow = plannedRow({
      legacyMemberId: "LEGACY-4002",
      targetStudentId: "student-new-4002",
      sourceRowMac: sourceMacOf(second),
    });
    expect(() =>
      planMemberDirectoryForwardChunk(
        input({
          plannedRows: [secondRow, plannedRow()],
          observed: [observedRow({ legacyMemberId: "LEGACY-4002", member: second }), observedRow()],
        }),
        dependencies,
      ),
    ).toThrow(/ascend by legacy member ID/u);

    expect(() =>
      planMemberDirectoryForwardChunk(
        input({
          plannedRows: [plannedRow(), secondRow],
          observed: [observedRow({ legacyMemberId: "LEGACY-4002", member: second }), observedRow()],
        }),
        dependencies,
      ),
    ).toThrow(/not in the planned order/u);
  });

  it("refuses an empty chunk and one over the row budget", () => {
    expect(() =>
      planMemberDirectoryForwardChunk(input({ plannedRows: [], observed: [] }), dependencies),
    ).toThrow(/at least one planned row/u);

    const rows = Array.from({ length: 51 }, (_unused, index) => {
      const legacyMemberId = `LEGACY-${String(5000 + index)}`;
      return plannedRow({
        legacyMemberId,
        targetStudentId: `student-new-${String(5000 + index)}`,
        sourceRowMac: sourceMacOf(legacyMember(legacyMemberId)),
      });
    });
    expect(() =>
      planMemberDirectoryForwardChunk(
        input({
          plannedRows: rows,
          observed: rows.map((row) =>
            observedRow({
              legacyMemberId: row.legacyMemberId,
              member: legacyMember(row.legacyMemberId),
            }),
          ),
        }),
        dependencies,
      ),
    ).toThrow(/at most 50 planned rows/u);
  });

  /**
   * The whole chunk is one set of documents, so the same plan must produce the same MAC however the
   * rows were ordered on the way in - and a different set must produce a different one.
   */
  it("produces a stable output MAC over the set it writes", () => {
    const first = planMemberDirectoryForwardChunk(input(), dependencies);
    const second = planMemberDirectoryForwardChunk(input(), dependencies);
    expect(second.outputSetMac).toBe(first.outputSetMac);

    const otherChunk = planMemberDirectoryForwardChunk(input({ chunkNo: 2 }), dependencies);
    expect(otherChunk.outputSetMac).not.toBe(first.outputSetMac);
  });

  it("refuses an effective date that is not a plain date", () => {
    expect(() =>
      planMemberDirectoryForwardChunk(
        input({ effectiveDate: "2026-09-08T00:00:00.000Z" }),
        dependencies,
      ),
    ).toThrow(/effective date is not a plain date/u);
  });
});
