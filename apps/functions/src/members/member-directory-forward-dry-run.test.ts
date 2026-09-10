import { describe, expect, it } from "vitest";

import {
  buildStudentIdentityKey,
  createMemberDirectoryOutputLeafMac,
  createMemberDirectoryPrivateManifestMac,
  createMemberDirectoryPrivatePlanMac,
} from "./member-directory-crypto.js";
import {
  classifyMemberDirectoryForwardRows,
  planMemberDirectoryForwardDryRun,
  type MemberDirectoryDryRunReviewedDecision,
  type MemberDirectoryForwardDryRunDependencies,
  type MemberDirectoryForwardDryRunInput,
} from "./member-directory-forward-dry-run.js";

const academyId = "academy-bpt-jersey";
const identitySecretMaterial = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const operationId = "op-forward-dry-1";
const actorId = "runner-a";
const effectiveDate = "2026-09-08T12:00:00.000Z";
const operationWriteTime = "2026-09-08T12:00:00.000Z";

function mintedIds(...ids: readonly string[]): () => string {
  const queue = [...ids];
  return () => {
    const next = queue.shift();
    if (next === undefined) throw new Error("the test ran out of minted student IDs");
    return next;
  };
}

function dependencies(
  overrides: Partial<MemberDirectoryForwardDryRunDependencies> = {},
): MemberDirectoryForwardDryRunDependencies {
  return {
    identitySecretMaterial,
    identitySecretVersion: "identity-v1",
    integritySecretMaterial,
    integritySecretVersion: "integrity-v1",
    mintTargetStudentId: mintedIds("student-minted-1", "student-minted-2", "student-minted-3"),
    ...overrides,
  };
}

function legacyMember(
  memberId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    memberId,
    academyId,
    membershipNumber: `BPT ${memberId.slice(-4)}`,
    fullName: "Synthetic Legacy Member",
    email: `${memberId.toLowerCase()}@example.test`,
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

function adminProfile(studentId: string): Readonly<Record<string, unknown>> {
  return {
    studentId,
    academyId,
    gender: "unknown",
    source: "legacy-member-migration",
    migrationId: "op-forward-older",
    legacyMemberId: "LEGACY-9999",
    schemaVersion: "1",
    createdAt: "2026-02-01T00:00:00.000Z",
    createdBy: "system",
    updatedAt: "2026-02-01T00:00:00.000Z",
    updatedBy: "system",
  };
}

function family(familyId: string): Readonly<Record<string, unknown>> {
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
  };
}

function relationship(
  relationshipId: string,
  studentId: string,
  familyId: string,
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
  };
}

const createDecision = (legacyMemberId: string): MemberDirectoryDryRunReviewedDecision =>
  Object.freeze({
    legacyMemberId,
    decision: "create" as const,
    trainingTimePreferences: ["evening"] as const,
  });

function input(
  overrides: Partial<MemberDirectoryForwardDryRunInput> = {},
): MemberDirectoryForwardDryRunInput {
  return {
    academyId,
    operationId,
    manifestId: "manifest-1",
    planId: "plan-1",
    targetProjectClassification: "emulator",
    codeVersion: "code-1",
    sourceRows: [{ legacyMemberId: "LEGACY-4001", document: legacyMember("LEGACY-4001") }],
    existingStudents: [],
    existingAdminProfiles: [],
    existingIdentityKeys: [],
    existingFamilies: [],
    existingRelationships: [],
    stateAdmittedStudentCount: 0,
    identityKeyBaselineMac: "a".repeat(64),
    maximumApprovedRows: 400,
    effectiveDate,
    expiresAt: "2026-09-09T12:00:00.000Z",
    operationWriteTime,
    createdAt: "2026-09-08T12:00:00.000Z",
    manifestPreparedAt: "2026-09-08T11:00:00.000Z",
    manifestExpiresAt: "2026-09-09T11:00:00.000Z",
    actorId,
    decisions: [createDecision("LEGACY-4001")],
    ...overrides,
  };
}

function classificationOf(
  report: ReturnType<typeof classifyMemberDirectoryForwardRows>,
  legacyMemberId: string,
): Readonly<{ classification: string; reasonCode: string }> {
  const row = report.rows.find((candidate) => candidate.legacyMemberId === legacyMemberId);
  if (row === undefined) throw new Error(`no classified row for ${legacyMemberId}`);
  return { classification: row.classification, reasonCode: row.reasonCode };
}

describe("member directory forward dry-run classification", () => {
  it("classifies a clean adult row as createable and writes nothing", () => {
    const report = classifyMemberDirectoryForwardRows(input(), dependencies());

    expect(classificationOf(report, "LEGACY-4001")).toEqual({
      classification: "createable-adult",
      reasonCode: "eligible",
    });
    expect(report.plannedNewStudentCount).toBe(1);
    expect(report.postCutoverAdmittedStudentCount).toBe(1);
    expect(report.awaitingDecision).toEqual([]);
  });

  it("reports an undecided eligible row instead of inventing a decision for it", () => {
    const report = classifyMemberDirectoryForwardRows(input({ decisions: [] }), dependencies());

    expect(report.awaitingDecision).toEqual(["LEGACY-4001"]);
    expect(() =>
      planMemberDirectoryForwardDryRun(input({ decisions: [] }), dependencies()),
    ).toThrow(/awaiting a reviewed decision/u);
  });

  it.each([
    ["unreadable", { memberId: 17 }, "invalid-record", "unparsable-record"],
    ["of another academy", { academyId: "academy-other" }, "cross-tenant", "foreign-academy"],
    [
      "born after the effective date",
      { birthDate: "2027-01-01" },
      "invalid-record",
      "date-of-birth-after-effective-date",
    ],
    [
      "with an unrecognised training center",
      { trainingCenter: "Harbour" },
      "missing-required-fields",
      "training-center-unrecognised",
    ],
  ])("refuses a row %s", (_label, overrides, classification, reasonCode) => {
    const report = classifyMemberDirectoryForwardRows(
      input({
        sourceRows: [
          { legacyMemberId: "LEGACY-4001", document: legacyMember("LEGACY-4001", overrides) },
        ],
        decisions: [],
      }),
      dependencies(),
    );

    expect(classificationOf(report, "LEGACY-4001")).toEqual({ classification, reasonCode });
    expect(report.plannedNewStudentCount).toBe(0);
  });

  it("classifies a row with no date of birth as missing required fields", () => {
    const withoutBirthDate = Object.fromEntries(
      Object.entries(legacyMember("LEGACY-4001")).filter(([key]) => key !== "birthDate"),
    );
    const report = classifyMemberDirectoryForwardRows(
      input({
        sourceRows: [{ legacyMemberId: "LEGACY-4001", document: withoutBirthDate }],
        decisions: [],
      }),
      dependencies(),
    );

    expect(classificationOf(report, "LEGACY-4001")).toEqual({
      classification: "missing-required-fields",
      reasonCode: "date-of-birth-absent",
    });
  });

  it("classifies a minor with no reviewed family as requiring one", () => {
    const report = classifyMemberDirectoryForwardRows(
      input({
        sourceRows: [
          {
            legacyMemberId: "LEGACY-4001",
            document: legacyMember("LEGACY-4001", { birthDate: "2015-01-01" }),
          },
        ],
        decisions: [],
      }),
      dependencies(),
    );

    expect(classificationOf(report, "LEGACY-4001")).toEqual({
      classification: "minor-requires-family-match",
      reasonCode: "minor-without-reviewed-family",
    });
  });

  it("separates a repeated membership number from a repeated ID card", () => {
    const report = classifyMemberDirectoryForwardRows(
      input({
        sourceRows: [
          {
            legacyMemberId: "LEGACY-4001",
            document: legacyMember("LEGACY-4001", {
              membershipNumber: "BPT 1",
              idCardNumber: "ID-A",
            }),
          },
          {
            legacyMemberId: "LEGACY-4002",
            document: legacyMember("LEGACY-4002", {
              membershipNumber: "BPT 1",
              idCardNumber: "ID-B",
            }),
          },
          {
            legacyMemberId: "LEGACY-4003",
            document: legacyMember("LEGACY-4003", {
              membershipNumber: "BPT 3",
              idCardNumber: "ID-B",
            }),
          },
        ],
        decisions: [],
      }),
      dependencies(),
    );

    expect(classificationOf(report, "LEGACY-4001").classification).toBe(
      "duplicate-membership-number",
    );
    expect(classificationOf(report, "LEGACY-4002").classification).toBe(
      "duplicate-membership-number",
    );
    expect(classificationOf(report, "LEGACY-4003")).toEqual({
      classification: "identity-conflict",
      reasonCode: "identifier-repeated-in-source",
    });
  });

  it("classifies a row whose identifier is already reserved as an identity conflict", () => {
    const reserved = buildStudentIdentityKey({
      academyId,
      kind: "membership-number",
      value: "BPT 4001",
      ownerStudentId: "student-existing-1",
      secretMaterial: identitySecretMaterial,
      secretVersion: "identity-v1",
      now: "2026-02-01T00:00:00.000Z",
      actorId: "system",
    });
    const report = classifyMemberDirectoryForwardRows(
      input({ existingIdentityKeys: [reserved], decisions: [] }),
      dependencies(),
    );

    expect(classificationOf(report, "LEGACY-4001")).toEqual({
      classification: "identity-conflict",
      reasonCode: "identifier-already-reserved",
    });
  });

  it("rejects the whole run on an unreviewed same-ID coincidence", () => {
    // The spec says an unreviewed same-ID coincidence rejects the whole manifest, and the receipt
    // contract requires the same: a `same-id-compatible` row counted but not listed would make the
    // receipt describe a plan the manifest does not.
    expect(() =>
      classifyMemberDirectoryForwardRows(
        input({
          existingStudents: [canonicalStudent("LEGACY-4001")],
          stateAdmittedStudentCount: 1,
          decisions: [],
        }),
        dependencies(),
      ),
    ).toThrow(/unreviewed same-ID coincidence/u);
  });

  it("refuses when the canonical scan disagrees with the state count", () => {
    expect(() =>
      classifyMemberDirectoryForwardRows(input({ stateAdmittedStudentCount: 3 }), dependencies()),
    ).toThrow(/disagrees with the state's admitted student count/u);
  });

  it("refuses a plan that would take the tenant past the rollback capacity limit", () => {
    const existing = Array.from({ length: 399 }, (_unused, index) =>
      canonicalStudent(`student-existing-${String(index)}`),
    );
    expect(() =>
      classifyMemberDirectoryForwardRows(
        input({
          existingStudents: existing,
          stateAdmittedStudentCount: 399,
          sourceRows: [
            { legacyMemberId: "LEGACY-4001", document: legacyMember("LEGACY-4001") },
            { legacyMemberId: "LEGACY-4002", document: legacyMember("LEGACY-4002") },
          ],
          decisions: [createDecision("LEGACY-4001"), createDecision("LEGACY-4002")],
        }),
        dependencies(),
      ),
    ).toThrow(/must not exceed 400/u);
  });

  it("refuses source rows that do not ascend by document ID", () => {
    expect(() =>
      classifyMemberDirectoryForwardRows(
        input({
          sourceRows: [
            { legacyMemberId: "LEGACY-4002", document: legacyMember("LEGACY-4002") },
            { legacyMemberId: "LEGACY-4001", document: legacyMember("LEGACY-4001") },
          ],
          decisions: [],
        }),
        dependencies(),
      ),
    ).toThrow(/ascend by document ID/u);
  });

  it("refuses a decision about a row the source does not hold", () => {
    expect(() =>
      classifyMemberDirectoryForwardRows(
        input({ decisions: [createDecision("LEGACY-4001"), createDecision("LEGACY-9999")] }),
        dependencies(),
      ),
    ).toThrow(/which the source does not hold/u);
  });
});

describe("member directory forward dry-run reviewed matches", () => {
  const matchDecision: MemberDirectoryDryRunReviewedDecision = Object.freeze({
    legacyMemberId: "LEGACY-4001",
    decision: "match" as const,
    targetStudentId: "student-existing-1",
    reviewedReason: "Same person, verified against the signed enrolment form",
  });

  const matchInput = (
    overrides: Partial<MemberDirectoryForwardDryRunInput> = {},
  ): MemberDirectoryForwardDryRunInput =>
    input({
      existingStudents: [canonicalStudent("student-existing-1")],
      stateAdmittedStudentCount: 1,
      decisions: [matchDecision],
      ...overrides,
    });

  it("accepts a reviewed match against an existing adult", () => {
    const report = classifyMemberDirectoryForwardRows(matchInput(), dependencies());

    expect(classificationOf(report, "LEGACY-4001")).toEqual({
      classification: "explicit-existing-student-match",
      reasonCode: "eligible",
    });
    // A match creates no student, so it must not move the capacity equation.
    expect(report.plannedNewStudentCount).toBe(0);
    expect(report.postCutoverAdmittedStudentCount).toBe(1);
  });

  it("calls a reviewed match on the row's own legacy ID a same-ID coincidence", () => {
    const report = classifyMemberDirectoryForwardRows(
      matchInput({
        existingStudents: [canonicalStudent("LEGACY-4001")],
        decisions: [{ ...matchDecision, targetStudentId: "LEGACY-4001" }],
      }),
      dependencies(),
    );

    expect(classificationOf(report, "LEGACY-4001").classification).toBe("same-id-compatible");
  });

  it("refuses a reviewed match against a student the directory does not hold", () => {
    expect(() =>
      classifyMemberDirectoryForwardRows(
        matchInput({ existingStudents: [], stateAdmittedStudentCount: 0 }),
        dependencies(),
      ),
    ).toThrow(/names a student the directory does not hold/u);
  });

  it("refuses a reviewed match against a student that already has an admin profile", () => {
    expect(() =>
      classifyMemberDirectoryForwardRows(
        matchInput({ existingAdminProfiles: [adminProfile("student-existing-1")] }),
        dependencies(),
      ),
    ).toThrow(/already-migrated student/u);
  });

  it("refuses a reviewed match that binds a family to an adult", () => {
    expect(() =>
      classifyMemberDirectoryForwardRows(
        matchInput({
          decisions: [{ ...matchDecision, familyId: "family-1", relationshipId: "rel-1" }],
        }),
        dependencies(),
      ),
    ).toThrow(/binds a family to an adult/u);
  });

  it("accepts a reviewed minor match covered by an active family and relationship", () => {
    const report = classifyMemberDirectoryForwardRows(
      matchInput({
        existingStudents: [
          canonicalStudent("student-existing-1", {
            dateOfBirth: "2015-01-01",
            participantType: "minor",
            familyId: "family-1",
          }),
        ],
        existingFamilies: [family("family-1")],
        existingRelationships: [relationship("rel-1", "student-existing-1", "family-1")],
        decisions: [{ ...matchDecision, familyId: "family-1", relationshipId: "rel-1" }],
      }),
      dependencies(),
    );

    expect(classificationOf(report, "LEGACY-4001")).toEqual({
      classification: "explicit-existing-student-match",
      reasonCode: "eligible",
    });
  });

  it("refuses a reviewed minor match whose relationship covers another student", () => {
    const report = classifyMemberDirectoryForwardRows(
      matchInput({
        existingStudents: [
          canonicalStudent("student-existing-1", {
            dateOfBirth: "2015-01-01",
            participantType: "minor",
            familyId: "family-1",
          }),
        ],
        existingFamilies: [family("family-1")],
        existingRelationships: [relationship("rel-1", "student-other", "family-1")],
        decisions: [{ ...matchDecision, familyId: "family-1", relationshipId: "rel-1" }],
      }),
      dependencies(),
    );

    expect(classificationOf(report, "LEGACY-4001")).toEqual({
      classification: "minor-requires-family-match",
      reasonCode: "reviewed-family-does-not-cover-the-minor",
    });
  });
});

describe("member directory forward dry-run artifacts", () => {
  it("emits a manifest, an output plan and a receipt that bind to each other", () => {
    const result = planMemberDirectoryForwardDryRun(input(), dependencies());

    expect(result.manifest.rows).toHaveLength(1);
    expect(result.manifest.rows[0]).toMatchObject({
      sourceLegacyId: "LEGACY-4001",
      classification: "createable-adult",
      targetStudentId: "student-minted-1",
      trainingTimePreferences: ["evening"],
    });
    expect(result.plan.privateManifestMac).toBe(
      createMemberDirectoryPrivateManifestMac({
        manifest: result.manifest,
        secretMaterial: integritySecretMaterial,
      }),
    );
    expect(result.receipt.planMac).toBe(
      createMemberDirectoryPrivatePlanMac({
        plan: result.plan,
        secretMaterial: integritySecretMaterial,
      }),
    );
    expect(result.receipt.phase).toBe("forward");
    expect(result.receipt.plannedNewStudentCount).toBe(1);
    expect(result.receipt.expectedOutputSetMacRoots).toEqual([
      result.plan.chunks[0]?.expectedOutputSetMac,
    ]);
  });

  it("carries no personal data in the receipt", () => {
    const result = planMemberDirectoryForwardDryRun(input(), dependencies());
    const serialized = JSON.stringify(result.receipt);

    for (const value of [
      "Synthetic Legacy Member",
      "legacy-4001@example.test",
      "1990-04-05",
      "BPT 4001",
      "+441534000401",
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("plans the exact documents the forward executor will write", () => {
    const result = planMemberDirectoryForwardDryRun(input(), dependencies());
    const chunk = result.plan.chunks[0];

    expect(chunk?.chunkNo).toBe(1);
    expect(chunk?.sourceLegacyIds).toEqual(["LEGACY-4001"]);
    // student + admin profile + membership-number and legacy-member-id reservations.
    expect(chunk?.targets.map((target) => target.path)).toEqual([
      `academies/${academyId}/studentAdminProfiles/student-minted-1`,
      expect.stringContaining(`academies/${academyId}/studentIdentityKeys/legacy-member-id:`),
      expect.stringContaining(`academies/${academyId}/studentIdentityKeys/membership-number:`),
      `academies/${academyId}/students/student-minted-1`,
    ]);
    expect(chunk?.targets.every((target) => target.priorAbsence === true)).toBe(true);
    expect(chunk?.targets.every((target) => /^[a-f0-9]{64}$/u.test(target.contentMac))).toBe(true);
  });

  it("binds the planned student document by its own content MAC", () => {
    const result = planMemberDirectoryForwardDryRun(input(), dependencies());
    const studentPath = `academies/${academyId}/students/student-minted-1`;
    const target = result.plan.chunks[0]?.targets.find((entry) => entry.path === studentPath);

    // The plan's content MAC is the MAC of the document the executor produces, which is what makes
    // it possible to reconcile a committed chunk without holding the document anywhere.
    expect(target?.contentMac).toBe(
      createMemberDirectoryOutputLeafMac({
        path: studentPath,
        data: {
          studentId: "student-minted-1",
          academyId,
          fullName: "Synthetic Legacy Member",
          dateOfBirth: "1990-04-05",
          phoneNumber: "+441534000401",
          email: "legacy-4001@example.test",
          trainingCenter: "Town",
          trainingTimePreferences: ["evening"],
          participantType: "adult",
          active: false,
          status: "inactive",
          schemaVersion: "1",
          createdAt: operationWriteTime,
          createdBy: actorId,
          updatedAt: operationWriteTime,
          updatedBy: actorId,
        },
        secretMaterial: integritySecretMaterial,
      }),
    );
  });

  it("slices more than one chunk of rows and numbers them without gaps", () => {
    const rows = Array.from({ length: 51 }, (_unused, index) => {
      const legacyMemberId = `LEGACY-${String(5000 + index)}`;
      return { legacyMemberId, document: legacyMember(legacyMemberId) };
    });
    const result = planMemberDirectoryForwardDryRun(
      input({
        sourceRows: rows,
        decisions: rows.map((row) => createDecision(row.legacyMemberId)),
      }),
      dependencies({
        mintTargetStudentId: mintedIds(
          ...rows.map((_unused, index) => `student-minted-${String(index)}`),
        ),
      }),
    );

    expect(result.plan.chunks.map((chunk) => chunk.chunkNo)).toEqual([1, 2]);
    expect(result.plan.chunks[0]?.sourceLegacyIds).toHaveLength(50);
    expect(result.plan.chunks[1]?.sourceLegacyIds).toHaveLength(1);
    expect(result.receipt.expectedOutputSetMacRoots).toHaveLength(2);
  });

  it("refuses a minted target student ID that reuses a legacy member ID", () => {
    expect(() =>
      planMemberDirectoryForwardDryRun(
        input(),
        dependencies({ mintTargetStudentId: mintedIds("LEGACY-4001") }),
      ),
    ).toThrow(/reuses a legacy member ID/u);
  });

  it("refuses a minted target student ID that is handed out twice", () => {
    const rows = [
      { legacyMemberId: "LEGACY-4001", document: legacyMember("LEGACY-4001") },
      { legacyMemberId: "LEGACY-4002", document: legacyMember("LEGACY-4002") },
    ];
    expect(() =>
      planMemberDirectoryForwardDryRun(
        input({
          sourceRows: rows,
          decisions: rows.map((row) => createDecision(row.legacyMemberId)),
        }),
        dependencies({ mintTargetStudentId: () => "student-minted-1" }),
      ),
    ).toThrow(/minted twice/u);
  });

  it("refuses to emit a plan with no eligible row", () => {
    expect(() =>
      planMemberDirectoryForwardDryRun(
        input({
          sourceRows: [
            {
              legacyMemberId: "LEGACY-4001",
              document: legacyMember("LEGACY-4001", { trainingCenter: "Harbour" }),
            },
          ],
          decisions: [],
        }),
        dependencies(),
      ),
    ).toThrow(/no legacy row is eligible/u);
  });

  it("refuses a plan with more eligible rows than the operation approved", () => {
    expect(() =>
      planMemberDirectoryForwardDryRun(input({ maximumApprovedRows: 0 }), dependencies()),
    ).toThrow(/more rows are eligible than the operation approved/u);
  });

  it("refuses to emit artifacts once the manifest window has closed", () => {
    expect(() =>
      planMemberDirectoryForwardDryRun(
        input({ manifestExpiresAt: "2026-09-08T12:00:00.000Z" }),
        dependencies(),
      ),
    ).toThrow(/expired/u);
  });

  it("counts every ineligible row in the receipt without listing it in the manifest", () => {
    const rows = [
      { legacyMemberId: "LEGACY-4001", document: legacyMember("LEGACY-4001") },
      {
        legacyMemberId: "LEGACY-4002",
        document: legacyMember("LEGACY-4002", { trainingCenter: "Harbour" }),
      },
      {
        legacyMemberId: "LEGACY-4003",
        document: legacyMember("LEGACY-4003", { birthDate: "2015-01-01" }),
      },
    ];
    const result = planMemberDirectoryForwardDryRun(
      input({ sourceRows: rows, decisions: [createDecision("LEGACY-4001")] }),
      dependencies(),
    );

    expect(result.manifest.rows.map((row) => row.sourceLegacyId)).toEqual(["LEGACY-4001"]);
    expect(result.receipt.classificationCounts).toMatchObject({
      "createable-adult": 1,
      "missing-required-fields": 1,
      "minor-requires-family-match": 1,
      "same-id-compatible": 0,
      "explicit-existing-student-match": 0,
    });
  });
});
