import { describe, expect, it } from "vitest";

import {
  memberDirectoryDryRunClassifications,
  memberDirectoryOperationReceiptSchema,
} from "./member-directory-migration-contracts";
import {
  assertMemberDirectoryManifestUnexpired,
  assertMemberDirectoryPlanCoversManifest,
  assertMemberDirectoryReceiptMatchesManifest,
  countMemberDirectoryManifestClassifications,
  memberDirectoryPrivateManifestSchema,
  memberDirectoryPrivateOutputPlanSchema,
  type MemberDirectoryPrivateManifest,
  type MemberDirectoryPrivateOutputPlan,
} from "./member-directory-private-plan-contracts";

const academyId = "academy-bpt-jersey";
const operationId = "op-forward-1";
const manifestId = "manifest-forward-1";
const mac = (seed: string) => seed.repeat(64).slice(0, 64);

function createRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    sourceLegacyId: "LEGACY-8001",
    sourceUpdatedAt: "2026-09-01T00:00:00.000Z",
    sourceRowMac: mac("a"),
    classification: "createable-adult",
    targetStudentId: "student-new-8001",
    ...overrides,
  };
}

function matchRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    sourceLegacyId: "LEGACY-8002",
    sourceUpdatedAt: "2026-09-01T00:00:00.000Z",
    sourceRowMac: mac("b"),
    classification: "explicit-existing-student-match",
    targetStudentId: "student-existing-8002",
    reviewedReason: "Same person, confirmed against the enrolment record",
    ...overrides,
  };
}

function manifestValue(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    schemaVersion: "1",
    manifestId,
    operationId,
    academyId,
    targetProjectClassification: "emulator",
    codeVersion: "885c701",
    preparedAt: "2026-09-08T10:00:00.000Z",
    expiresAt: "2026-09-08T13:00:00.000Z",
    rows: [createRow(), matchRow()],
    ...overrides,
  };
}

function manifest(
  overrides: Readonly<Record<string, unknown>> = {},
): MemberDirectoryPrivateManifest {
  return memberDirectoryPrivateManifestSchema.parse(manifestValue(overrides));
}

function planValue(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    schemaVersion: "1",
    planId: "plan-forward-1",
    operationId,
    academyId,
    manifestId,
    privateManifestMac: mac("c"),
    chunks: [
      {
        chunkNo: 1,
        sourceLegacyIds: ["LEGACY-8001", "LEGACY-8002"],
        targets: [
          {
            path: `academies/${academyId}/students/student-new-8001`,
            priorAbsence: true,
            contentMac: mac("d"),
          },
          {
            path: `academies/${academyId}/studentAdminProfiles/student-new-8001`,
            priorAbsence: true,
            contentMac: mac("e"),
          },
        ],
        expectedOutputSetMac: mac("f"),
      },
    ],
    ...overrides,
  };
}

function plan(overrides: Readonly<Record<string, unknown>> = {}): MemberDirectoryPrivateOutputPlan {
  return memberDirectoryPrivateOutputPlanSchema.parse(planValue(overrides));
}

function receipt(overrides: Readonly<Record<string, unknown>> = {}) {
  const counts = Object.fromEntries(
    memberDirectoryDryRunClassifications.map((classification) => [classification, 0]),
  );
  return memberDirectoryOperationReceiptSchema.parse({
    operationId,
    academyId,
    phase: "forward",
    targetProjectClassification: "emulator",
    codeVersion: "885c701",
    schemaVersion: "1",
    effectiveDate: "2026-09-08T10:00:00.000Z",
    expiresAt: "2026-09-08T13:00:00.000Z",
    sourceMac: mac("1"),
    privateManifestMac: mac("c"),
    planMac: mac("2"),
    digestVersion: "hmac-sha256-v1",
    secretVersion: "identity-v1",
    identityKeyBaselineMac: mac("3"),
    expectedOutputSetMacRoots: [mac("f")],
    classificationCounts: {
      ...counts,
      "createable-adult": 1,
      "explicit-existing-student-match": 1,
      "missing-required-fields": 4,
    },
    preExistingAdmittedStudentCount: 10,
    plannedNewStudentCount: 1,
    postCutoverAdmittedStudentCount: 11,
    maximumApprovedRows: 400,
    integrityMacVersion: "hmac-sha256-v1",
    integritySecretVersion: "integrity-v1",
    operationWriteTime: "2026-09-08T10:00:00.000Z",
    createdAt: "2026-09-08T10:00:00.000Z",
    createdBy: "reviewer-1",
    ...overrides,
  });
}

describe("member directory private manifest", () => {
  it("accepts a reviewed one-to-one mapping and counts only its eligible classifications", () => {
    const parsed = manifest();
    expect(parsed.rows).toHaveLength(2);
    const counts = countMemberDirectoryManifestClassifications(parsed);
    expect(counts["createable-adult"]).toBe(1);
    expect(counts["explicit-existing-student-match"]).toBe(1);
    // Ineligible classifications never reach the manifest, so they count zero here by construction.
    expect(counts["identity-conflict"]).toBe(0);
  });

  it("rejects a source mapped twice and two sources mapped to one student", () => {
    expect(() =>
      memberDirectoryPrivateManifestSchema.parse(
        manifestValue({ rows: [createRow(), createRow({ targetStudentId: "student-new-8003" })] }),
      ),
    ).toThrow(/mapped only once/u);

    expect(() =>
      memberDirectoryPrivateManifestSchema.parse(
        manifestValue({
          rows: [createRow(), createRow({ sourceLegacyId: "LEGACY-8003" })],
        }),
      ),
    ).toThrow(/may not map to one student/u);
  });

  /**
   * `same-id-compatible` means one thing only: a student document that already carried that ID.
   * Any other target under that label, or that target under any other label, is the coincidence
   * getting around the review the manifest rule demands for it.
   */
  it("binds the same-ID coincidence to its own student and refuses it under another label", () => {
    const sameId = manifest({
      rows: [
        {
          sourceLegacyId: "student-8004",
          sourceUpdatedAt: "2026-09-01T00:00:00.000Z",
          sourceRowMac: mac("a"),
          classification: "same-id-compatible",
          targetStudentId: "student-8004",
          reviewedReason: "Reviewed: the student already had this ID before the operation",
        },
      ],
    });
    expect(sameId.rows[0]?.classification).toBe("same-id-compatible");

    expect(() =>
      memberDirectoryPrivateManifestSchema.parse(
        manifestValue({
          rows: [
            {
              sourceLegacyId: "student-8004",
              sourceUpdatedAt: "2026-09-01T00:00:00.000Z",
              sourceRowMac: mac("a"),
              classification: "same-id-compatible",
              targetStudentId: "student-other",
              reviewedReason: "Reviewed",
            },
          ],
        }),
      ),
    ).toThrow(/must target the student that already had that ID/u);

    expect(() =>
      memberDirectoryPrivateManifestSchema.parse(
        manifestValue({
          rows: [matchRow({ sourceLegacyId: "student-8004", targetStudentId: "student-8004" })],
        }),
      ),
    ).toThrow(/is a same-ID coincidence/u);
  });

  it("requires a reviewed reason for a match and refuses one on a create", () => {
    expect(() =>
      memberDirectoryPrivateManifestSchema.parse(
        manifestValue({ rows: [matchRow({ reviewedReason: undefined })] }),
      ),
    ).toThrow(/reviewed reason/u);

    expect(() =>
      memberDirectoryPrivateManifestSchema.parse(
        manifestValue({ rows: [createRow({ reviewedReason: "Looks fine" })] }),
      ),
    ).toThrow(/no reviewed match to explain/u);
  });

  /** Invariant 9: a minor match references an existing family; a create never binds one. */
  it("allows a family binding only on a match", () => {
    const withFamily = manifest({
      rows: [matchRow({ family: { familyId: "family-1", relationshipId: "relationship-1" } })],
    });
    expect(withFamily.rows[0]?.family?.familyId).toBe("family-1");

    expect(() =>
      memberDirectoryPrivateManifestSchema.parse(
        manifestValue({
          rows: [createRow({ family: { familyId: "family-1", relationshipId: "relationship-1" } })],
        }),
      ),
    ).toThrow(/binds no family/u);
  });

  it("refuses an ineligible classification outright", () => {
    expect(() =>
      memberDirectoryPrivateManifestSchema.parse(
        manifestValue({ rows: [createRow({ classification: "minor-requires-family-match" })] }),
      ),
    ).toThrow();
  });

  /**
   * The expiry instant already counts as expired, for the same reason a lease does: a window still
   * open at its own end is the off-by-one that lets a run start that it cannot finish.
   */
  it("rejects a manifest outside its own window, at the instant of expiry included", () => {
    const parsed = manifest();
    expect(() =>
      assertMemberDirectoryManifestUnexpired(parsed, "2026-09-08T12:00:00.000Z"),
    ).not.toThrow();
    expect(() =>
      assertMemberDirectoryManifestUnexpired(parsed, "2026-09-08T13:00:00.000Z"),
    ).toThrow(/has expired/u);
    expect(() =>
      assertMemberDirectoryManifestUnexpired(parsed, "2026-09-08T09:59:59.999Z"),
    ).toThrow(/before it was prepared/u);
  });

  it("rejects an expiry that is not after preparation", () => {
    expect(() =>
      memberDirectoryPrivateManifestSchema.parse(
        manifestValue({ expiresAt: "2026-09-08T10:00:00.000Z" }),
      ),
    ).toThrow(/after it was prepared/u);
  });
});

describe("member directory private output plan", () => {
  it("accepts a chunked plan whose targets and rows are each planned once", () => {
    expect(plan().chunks).toHaveLength(1);
  });

  it("rejects one document planned twice and one row planned into two chunks", () => {
    expect(() =>
      memberDirectoryPrivateOutputPlanSchema.parse(
        planValue({
          chunks: [
            {
              chunkNo: 1,
              sourceLegacyIds: ["LEGACY-8001"],
              targets: [
                {
                  path: `academies/${academyId}/students/student-new-8001`,
                  priorAbsence: true,
                  contentMac: mac("d"),
                },
                {
                  path: `academies/${academyId}/students/student-new-8001`,
                  priorAbsence: true,
                  contentMac: mac("e"),
                },
              ],
              expectedOutputSetMac: mac("f"),
            },
          ],
        }),
      ),
    ).toThrow(/planned only once/u);

    expect(() =>
      memberDirectoryPrivateOutputPlanSchema.parse(
        planValue({
          chunks: [
            {
              chunkNo: 1,
              sourceLegacyIds: ["LEGACY-8001"],
              targets: [
                {
                  path: `academies/${academyId}/students/student-new-8001`,
                  priorAbsence: true,
                  contentMac: mac("d"),
                },
              ],
              expectedOutputSetMac: mac("f"),
            },
            {
              chunkNo: 2,
              sourceLegacyIds: ["LEGACY-8001"],
              targets: [
                {
                  path: `academies/${academyId}/students/student-new-8002`,
                  priorAbsence: true,
                  contentMac: mac("e"),
                },
              ],
              expectedOutputSetMac: mac("0"),
            },
          ],
        }),
      ),
    ).toThrow(/into only one chunk/u);
  });

  it("rejects a chunk sequence with a gap", () => {
    expect(() =>
      memberDirectoryPrivateOutputPlanSchema.parse(
        planValue({
          chunks: [
            {
              chunkNo: 2,
              sourceLegacyIds: ["LEGACY-8001"],
              targets: [
                {
                  path: `academies/${academyId}/students/student-new-8001`,
                  priorAbsence: true,
                  contentMac: mac("d"),
                },
              ],
              expectedOutputSetMac: mac("f"),
            },
          ],
        }),
      ),
    ).toThrow(/start at 1 and advance without gaps/u);
  });

  /** v1 has no target that may already exist, so a plan cannot even express an overwrite. */
  it("rejects a target that does not assert prior absence", () => {
    expect(() =>
      memberDirectoryPrivateOutputPlanSchema.parse(
        planValue({
          chunks: [
            {
              chunkNo: 1,
              sourceLegacyIds: ["LEGACY-8001"],
              targets: [
                {
                  path: `academies/${academyId}/students/student-new-8001`,
                  priorAbsence: false,
                  contentMac: mac("d"),
                },
              ],
              expectedOutputSetMac: mac("f"),
            },
          ],
        }),
      ),
    ).toThrow();
  });
});

describe("member directory frozen pair consistency", () => {
  it("requires the plan to cover exactly the manifest rows", () => {
    expect(() => assertMemberDirectoryPlanCoversManifest(manifest(), plan())).not.toThrow();

    expect(() =>
      assertMemberDirectoryPlanCoversManifest(
        manifest(),
        plan({
          chunks: [
            {
              chunkNo: 1,
              sourceLegacyIds: ["LEGACY-8001"],
              targets: [
                {
                  path: `academies/${academyId}/students/student-new-8001`,
                  priorAbsence: true,
                  contentMac: mac("d"),
                },
              ],
              expectedOutputSetMac: mac("f"),
            },
          ],
        }),
      ),
    ).toThrow(/different number of rows/u);

    expect(() =>
      assertMemberDirectoryPlanCoversManifest(manifest(), plan({ manifestId: "manifest-other" })),
    ).toThrow(/derived from another manifest/u);
  });

  /**
   * `plannedNewStudentCount` is the createable rows alone. Counting matches there would make the
   * capacity equation admit more students than the tenant ends up holding, which is the single
   * number the rollback limit is built on.
   */
  it("recomputes the receipt counts from the rows instead of trusting them", () => {
    expect(() => assertMemberDirectoryReceiptMatchesManifest(receipt(), manifest())).not.toThrow();

    expect(() =>
      assertMemberDirectoryReceiptMatchesManifest(
        receipt({ plannedNewStudentCount: 2, postCutoverAdmittedStudentCount: 12 }),
        manifest(),
      ),
    ).toThrow(/exactly the createable-adult rows/u);

    expect(() =>
      assertMemberDirectoryReceiptMatchesManifest(
        receipt({
          classificationCounts: {
            ...Object.fromEntries(
              memberDirectoryDryRunClassifications.map((classification) => [classification, 0]),
            ),
            "createable-adult": 1,
            "explicit-existing-student-match": 3,
          },
        }),
        manifest(),
      ),
    ).toThrow(/miscounts explicit-existing-student-match/u);
  });

  it("refuses a receipt from another operation, project class or code version", () => {
    expect(() =>
      assertMemberDirectoryReceiptMatchesManifest(receipt(), manifest({ operationId: "op-other" })),
    ).toThrow(/another operation or academy/u);

    expect(() =>
      assertMemberDirectoryReceiptMatchesManifest(
        receipt({ targetProjectClassification: "production" }),
        manifest(),
      ),
    ).toThrow(/different project classifications/u);

    expect(() =>
      assertMemberDirectoryReceiptMatchesManifest(receipt({ codeVersion: "deadbee" }), manifest()),
    ).toThrow(/different code versions/u);
  });

  it("refuses a manifest that maps more rows than the receipt approved", () => {
    expect(() =>
      assertMemberDirectoryReceiptMatchesManifest(receipt({ maximumApprovedRows: 1 }), manifest()),
    ).toThrow(/more rows than the receipt approved/u);
  });
});
