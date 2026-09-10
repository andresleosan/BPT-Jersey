import { describe, expect, it } from "vitest";

import {
  BACKUP_V3_ARTIFACT_DISPOSITION_VERSION,
  BACKUP_V3_INTEGRITY_MAC_VERSION,
  BACKUP_V3_INVENTORY_VERSION,
  BACKUP_V3_LIMITS,
  BACKUP_V3_MATERIALIZABLE_PATH_CLASSES,
  BACKUP_V3_SCHEMA_VERSION,
  BackupV3ContractError,
  classifyBackupV3SourcePath,
  parseBackupV3ArtifactRow,
  parseBackupV3Manifest,
  validateBackupV3Plan,
} from "./backup-v3-contracts.js";

const academyId = "academy-1";
const mac = "a".repeat(64);

function makeManifest(overrides: Readonly<Record<string, unknown>> = {}) {
  const pathClassSummaries = BACKUP_V3_MATERIALIZABLE_PATH_CLASSES.map((pathClass) => ({
    pathClass,
    documentCount: pathClass === "students" ? 2 : 0,
    rootMac: mac,
  }));

  return {
    schemaVersion: BACKUP_V3_SCHEMA_VERSION,
    artifactDispositionVersion: BACKUP_V3_ARTIFACT_DISPOSITION_VERSION,
    inventoryVersion: BACKUP_V3_INVENTORY_VERSION,
    sourceProjectId: "demo-bpt-jersey",
    academyId,
    snapshotReadTime: "2026-09-03T12:00:00.000Z",
    sourceStatePath: `academies/${academyId}/memberDirectoryStates/current`,
    sourceStateDocumentCount: 1,
    sourceStateDisposition: "verify-only-authority",
    sourceStateTargetPlanSet: null,
    sourceStateRevision: 7,
    sourceGlobalLegacyReadEliminated: false,
    sourceReaderVersion: "canonical-v1",
    sourceDirectoryWriteMode: "canonical-v1",
    sourceFreezeStatus: "open",
    sourceOperationPhase: "idle",
    sourceRollbackProtocolVersion: "legacy-projection-v1",
    sourceRollbackEligibleStudentCount: 2,
    sourceGuardRevision: 7,
    sourceGuardGlobalLegacyReadEliminated: false,
    sourceGuardStudentCount: 2,
    sourceGuardRestoreEpoch: 0,
    sourceGuardEventMac: mac,
    codeVersion: "code-v1",
    dataSchemaVersion: "member-directory-v1",
    pathClassSummaries,
    backupDocumentCount: 3,
    backupRootMac: mac,
    payloadDocumentCount: 2,
    payloadDecodedBytes: 128,
    payloadRootMac: mac,
    identityKeyDigestVersion: BACKUP_V3_INTEGRITY_MAC_VERSION,
    identityKeySecretVersion: "identity-v1",
    identityKeyBaselineMac: mac,
    identityKeyBaselineArtifactId: "baseline-artifact-1",
    cursorMacVersion: BACKUP_V3_INTEGRITY_MAC_VERSION,
    cursorSecretVersion: "cursor-v1",
    integrityMacVersion: BACKUP_V3_INTEGRITY_MAC_VERSION,
    integritySecretVersion: "integrity-v1",
    privateManifestMac: mac,
    sourceStateEvidenceMac: mac,
    backupManifestMac: mac,
    ...overrides,
  };
}

function expectContractCode(action: () => unknown, code: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(BackupV3ContractError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected BackupV3ContractError ${code}`);
}

describe("backup v3 source path disposition", () => {
  it("classifies full direct and nested paths as materialize-exact without remapping", () => {
    for (const sourcePath of [
      `academies/${academyId}/members/member-1`,
      `academies/${academyId}/students/student-1`,
      `academies/${academyId}/studentAdminProfiles/student-1`,
      `academies/${academyId}/studentIdentityKeys/key-1`,
      `academies/${academyId}/medicalLeaves/leave-1`,
      `academies/${academyId}/students/student-1/evaluations/evaluation-1`,
      `academies/${academyId}/students/student-1/graduations/graduation-1`,
      `academies/${academyId}/students/student-1/medicalLeaves/leave-legacy-1`,
    ]) {
      expect(classifyBackupV3SourcePath({ academyId, sourcePath })).toEqual({
        sourcePath,
        disposition: "materialize-exact",
        targetPlanSet: "payload",
        targetPath: sourcePath,
      });
    }
  });

  it("keeps restricted-read rate state in the exact tenant payload", () => {
    const sourcePath = `academies/${academyId}/studentRestrictedReadLimits/actor-1`;
    expect(classifyBackupV3SourcePath({ academyId, sourcePath })).toEqual({
      sourcePath,
      disposition: "materialize-exact",
      targetPlanSet: "payload",
      targetPath: sourcePath,
    });
  });

  it("materializes canonical identity write receipts as tenant evidence", () => {
    for (const sourcePath of [
      `academies/${academyId}/memberDirectoryWriteReceipts/write-${"a".repeat(64)}`,
      `academies/${academyId}/profileWriteReceipts/write-${"b".repeat(64)}`,
      `academies/${academyId}/familyWriteReceipts/family-write-${"c".repeat(64)}`,
      `academies/${academyId}/memberDirectoryImportReceipts/import-${"d".repeat(64)}`,
    ]) {
      expect(classifyBackupV3SourcePath({ academyId, sourcePath })).toEqual({
        sourcePath,
        disposition: "materialize-exact",
        targetPlanSet: "payload",
        targetPath: sourcePath,
      });
    }
  });

  it.each(["retentionAlerts", "familyAchievementSnapshots"])(
    "materializes the runbook reference-closure collection %s",
    (collection) => {
      const sourcePath = `academies/${academyId}/${collection}/record-1`;
      expect(classifyBackupV3SourcePath({ academyId, sourcePath })).toEqual({
        sourcePath,
        disposition: "materialize-exact",
        targetPlanSet: "payload",
        targetPath: sourcePath,
      });
    },
  );

  it("classifies only the exact current source state as singleton authority evidence", () => {
    const sourcePath = `academies/${academyId}/memberDirectoryStates/current`;
    expect(classifyBackupV3SourcePath({ academyId, sourcePath })).toEqual({
      sourcePath,
      disposition: "verify-only-authority",
      targetPlanSet: null,
      targetPath: null,
    });

    expectContractCode(
      () =>
        classifyBackupV3SourcePath({
          academyId,
          sourcePath: `academies/${academyId}/memberDirectoryStates/not-current`,
        }),
      "unlisted-source-path",
    );
  });

  it("recognizes paths that must be excluded before backup", () => {
    for (const sourcePath of [
      `academies/${academyId}/memberDirectoryCursorStates/cursor-1`,
      `academies/${academyId}/memberDirectoryImportSessions/import-session-${"e".repeat(64)}`,
      `memberDirectoryRestoreGuards/${academyId}`,
      `memberDirectoryRestoreGuards/${academyId}/events/7`,
      "memberDirectoryRestoreAttestations/attestation-1",
      "memberDirectoryRestoreAttestationConsumptions/attestation-1",
    ]) {
      expect(classifyBackupV3SourcePath({ academyId, sourcePath })).toEqual({
        sourcePath,
        disposition: "exclude-before-backup",
        targetPlanSet: null,
        targetPath: null,
      });
    }
  });

  it("rejects tenant crossings, unlisted collections and malformed or wrong-depth paths", () => {
    expectContractCode(
      () =>
        classifyBackupV3SourcePath({
          academyId,
          sourcePath: "academies/academy-2/students/student-1",
        }),
      "academy-mismatch",
    );
    for (const sourcePath of [
      `academies/${academyId}/students`,
      `academies/${academyId}/unknown/doc-1`,
      `academies/${academyId}/students/student-1/secrets/secret-1`,
      `/academies/${academyId}/students/student-1`,
      `academies/${academyId}/students//student-1`,
    ]) {
      expectContractCode(
        () => classifyBackupV3SourcePath({ academyId, sourcePath }),
        "unlisted-source-path",
      );
    }
  });
});

describe("backup v3 artifact rows", () => {
  it("accepts only the computed exact disposition and destination", () => {
    const sourcePath = `academies/${academyId}/students/student-1`;
    expect(
      parseBackupV3ArtifactRow(
        {
          sourcePath,
          disposition: "materialize-exact",
          targetPlanSet: "payload",
          targetPath: sourcePath,
        },
        academyId,
      ),
    ).toEqual({
      sourcePath,
      disposition: "materialize-exact",
      targetPlanSet: "payload",
      targetPath: sourcePath,
    });

    const statePath = `academies/${academyId}/memberDirectoryStates/current`;
    expect(
      parseBackupV3ArtifactRow(
        {
          sourcePath: statePath,
          disposition: "verify-only-authority",
          targetPlanSet: null,
          targetPath: null,
        },
        academyId,
      ),
    ).toEqual({
      sourcePath: statePath,
      disposition: "verify-only-authority",
      targetPlanSet: null,
      targetPath: null,
    });
  });

  it("rejects state as payload, source-supplied target-control, remap and excluded rows", () => {
    const statePath = `academies/${academyId}/memberDirectoryStates/current`;
    expectContractCode(
      () =>
        parseBackupV3ArtifactRow(
          {
            sourcePath: statePath,
            disposition: "materialize-exact",
            targetPlanSet: "payload",
            targetPath: statePath,
          },
          academyId,
        ),
      "disposition-mismatch",
    );

    const studentPath = `academies/${academyId}/students/student-1`;
    expectContractCode(
      () =>
        parseBackupV3ArtifactRow(
          {
            sourcePath: studentPath,
            disposition: "materialize-exact",
            targetPlanSet: "target-control",
            targetPath: studentPath,
          },
          academyId,
        ),
      "source-target-control",
    );
    expectContractCode(
      () =>
        parseBackupV3ArtifactRow(
          {
            sourcePath: studentPath,
            disposition: "materialize-exact",
            targetPlanSet: "payload",
            targetPath: `academies/${academyId}/students/student-2`,
          },
          academyId,
        ),
      "remap-forbidden",
    );
    expectContractCode(
      () =>
        parseBackupV3ArtifactRow(
          {
            sourcePath: `academies/${academyId}/memberDirectoryCursorStates/cursor-1`,
            disposition: "exclude-before-backup",
            targetPlanSet: null,
            targetPath: null,
          },
          academyId,
        ),
      "excluded-source-path",
    );
  });

  it.each([
    "fullName",
    "email",
    "phoneNumber",
    "address",
    "dateOfBirth",
    "membershipNumber",
    "idCardNumber",
    "vatNumber",
    "legacyMemberId",
    "actorId",
    "rawDocument",
    "integritySecret",
  ])("rejects the PII/secret canary field %s from artifact metadata", (field) => {
    const sourcePath = `academies/${academyId}/students/student-1`;
    expectContractCode(
      () =>
        parseBackupV3ArtifactRow(
          {
            sourcePath,
            disposition: "materialize-exact",
            targetPlanSet: "payload",
            targetPath: sourcePath,
            [field]: "canary-value",
          },
          academyId,
        ),
      "invalid-artifact-row",
    );
  });
});

describe("backup v3 plan budgets", () => {
  const payloadPaths = Array.from(
    { length: BACKUP_V3_LIMITS.payload.maxDocumentCount },
    (_, index) => `academies/${academyId}/students/student-${index}`,
  );
  const targetControlPaths = Array.from(
    { length: BACKUP_V3_LIMITS.targetControl.maxDocumentCount },
    (_, index) => `academies/${academyId}/auditEvents/restore-audit-${index}`,
  );

  it("accepts the exact document, byte and visited-path boundaries", () => {
    expect(
      validateBackupV3Plan({
        academyId,
        payloadPaths,
        targetControlPaths,
        payloadDecodedBytes: BACKUP_V3_LIMITS.payload.maxDecodedBytes,
        targetControlDecodedBytes: BACKUP_V3_LIMITS.targetControl.maxDecodedBytes,
        visitedPathCount: BACKUP_V3_LIMITS.maxVisitedPathCount,
        missingStructuralAnchorPath: `academies/${academyId}`,
      }),
    ).toEqual({
      payloadDocumentCount: 10_000,
      payloadDecodedBytes: 256 * 1024 * 1024,
      targetControlDocumentCount: 2_048,
      targetControlDecodedBytes: 32 * 1024 * 1024,
      combinedDocumentCount: 12_048,
      combinedDecodedBytes: 288 * 1024 * 1024,
      visitedPathCount: 12_049,
    });
  });

  it("rejects every component limit plus one", () => {
    expectContractCode(
      () =>
        validateBackupV3Plan({
          academyId,
          payloadPaths: [...payloadPaths, `academies/${academyId}/students/overflow`],
          targetControlPaths: [],
          payloadDecodedBytes: 0,
          targetControlDecodedBytes: 0,
          visitedPathCount: 10_001,
        }),
      "payload-document-limit",
    );
    expectContractCode(
      () =>
        validateBackupV3Plan({
          academyId,
          payloadPaths: [],
          targetControlPaths,
          payloadDecodedBytes: 0,
          targetControlDecodedBytes: BACKUP_V3_LIMITS.targetControl.maxDecodedBytes + 1,
          visitedPathCount: targetControlPaths.length,
        }),
      "target-control-byte-limit",
    );
    expectContractCode(
      () =>
        validateBackupV3Plan({
          academyId,
          payloadPaths: [],
          targetControlPaths: [
            ...targetControlPaths,
            `academies/${academyId}/auditEvents/restore-audit-overflow`,
          ],
          payloadDecodedBytes: 0,
          targetControlDecodedBytes: 0,
          visitedPathCount: 2_049,
        }),
      "target-control-document-limit",
    );
    expectContractCode(
      () =>
        validateBackupV3Plan({
          academyId,
          payloadPaths: [],
          targetControlPaths: [],
          payloadDecodedBytes: BACKUP_V3_LIMITS.payload.maxDecodedBytes + 1,
          targetControlDecodedBytes: 0,
          visitedPathCount: 0,
        }),
      "payload-byte-limit",
    );
  });

  it("rejects the combined document, byte and visited-path hard caps plus one", () => {
    expectContractCode(
      () =>
        validateBackupV3Plan({
          academyId,
          payloadPaths,
          targetControlPaths: [
            ...targetControlPaths,
            `academies/${academyId}/auditEvents/combined-overflow`,
          ],
          payloadDecodedBytes: 0,
          targetControlDecodedBytes: 0,
          visitedPathCount: 12_049,
        }),
      "combined-document-limit",
    );
    expectContractCode(
      () =>
        validateBackupV3Plan({
          academyId,
          payloadPaths,
          targetControlPaths,
          payloadDecodedBytes: BACKUP_V3_LIMITS.payload.maxDecodedBytes,
          targetControlDecodedBytes: BACKUP_V3_LIMITS.targetControl.maxDecodedBytes + 1,
          visitedPathCount: 12_048,
        }),
      "combined-byte-limit",
    );
    expectContractCode(
      () =>
        validateBackupV3Plan({
          academyId,
          payloadPaths,
          targetControlPaths,
          payloadDecodedBytes: 0,
          targetControlDecodedBytes: 0,
          visitedPathCount: BACKUP_V3_LIMITS.maxVisitedPathCount + 1,
          missingStructuralAnchorPath: `academies/${academyId}`,
        }),
      "visited-path-limit",
    );
  });

  it("rejects overlap, duplicates, unclassified content and any non-exact missing anchor", () => {
    const sharedPath = `academies/${academyId}/auditEvents/shared`;
    expectContractCode(
      () =>
        validateBackupV3Plan({
          academyId,
          payloadPaths: [sharedPath],
          targetControlPaths: [sharedPath],
          payloadDecodedBytes: 0,
          targetControlDecodedBytes: 0,
          visitedPathCount: 1,
        }),
      "plan-set-overlap",
    );
    expectContractCode(
      () =>
        validateBackupV3Plan({
          academyId,
          payloadPaths: [
            `academies/${academyId}/students/student-1`,
            `academies/${academyId}/students/student-1`,
          ],
          targetControlPaths: [],
          payloadDecodedBytes: 0,
          targetControlDecodedBytes: 0,
          visitedPathCount: 2,
        }),
      "duplicate-plan-path",
    );
    expectContractCode(
      () =>
        validateBackupV3Plan({
          academyId,
          payloadPaths: [`academies/${academyId}/unknown/doc-1`],
          targetControlPaths: [],
          payloadDecodedBytes: 0,
          targetControlDecodedBytes: 0,
          visitedPathCount: 1,
        }),
      "unclassified-plan-path",
    );
    expectContractCode(
      () =>
        validateBackupV3Plan({
          academyId,
          payloadPaths: [`academies/${academyId}/students/student-1`],
          targetControlPaths: [],
          payloadDecodedBytes: 0,
          targetControlDecodedBytes: 0,
          visitedPathCount: 2,
          missingStructuralAnchorPath: `academies/${academyId}/students/missing-parent`,
        }),
      "invalid-missing-anchor",
    );
  });
});

describe("backup v3 manifest", () => {
  it("accepts the closed v3 manifest with exact disposition, inventory and MAC versions", () => {
    const parsed = parseBackupV3Manifest(makeManifest());
    expect(parsed).toMatchObject({
      schemaVersion: 3,
      artifactDispositionVersion: "member-directory-restore-v1",
      inventoryVersion: "firestore-namespace-inventory-v1",
      sourceStateDocumentCount: 1,
      sourceStateDisposition: "verify-only-authority",
      sourceStateTargetPlanSet: null,
      integrityMacVersion: "hmac-sha256-v1",
      identityKeyDigestVersion: "hmac-sha256-v1",
      cursorMacVersion: "hmac-sha256-v1",
      backupDocumentCount: 3,
      payloadDocumentCount: 2,
    });
    expect(parsed.backupManifestMac).toMatch(/^[a-f0-9]{64}$/u);
    expect(parsed.sourceStateEvidenceMac).toMatch(/^[a-f0-9]{64}$/u);
    expect(parsed.privateManifestMac).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects version drift, malformed MACs and state/payload count divergence", () => {
    for (const candidate of [
      makeManifest({ schemaVersion: 2 }),
      makeManifest({ artifactDispositionVersion: "member-directory-restore-v2" }),
      makeManifest({ inventoryVersion: "firestore-namespace-inventory-v2" }),
      makeManifest({ integrityMacVersion: "sha256" }),
      makeManifest({ backupManifestMac: "not-a-mac" }),
      makeManifest({ sourceStatePath: `academies/${academyId}/students/current` }),
      makeManifest({ sourceStateDisposition: "materialize-exact" }),
      makeManifest({ sourceStateTargetPlanSet: "payload" }),
      makeManifest({ sourceStateDocumentCount: 0 }),
      makeManifest({ backupDocumentCount: 2 }),
      makeManifest({ payloadDocumentCount: 3 }),
    ]) {
      expectContractCode(() => parseBackupV3Manifest(candidate), "invalid-manifest");
    }
  });

  it.each([
    {
      sourceReaderVersion: "legacy-v1",
      sourceDirectoryWriteMode: "legacy-v1",
      sourceFreezeStatus: "open",
      sourceOperationPhase: "idle",
    },
    {
      sourceReaderVersion: "legacy-rollback-v1",
      sourceDirectoryWriteMode: "blocked",
      sourceFreezeStatus: "frozen",
      sourceOperationPhase: "rollback-readonly",
    },
  ])("rejects a legacy reader after the global marker is true", (legacyTuple) => {
    expectContractCode(
      () =>
        parseBackupV3Manifest(
          makeManifest({
            ...legacyTuple,
            sourceGlobalLegacyReadEliminated: true,
            sourceGuardGlobalLegacyReadEliminated: true,
            sourceRollbackProtocolVersion: "disabled",
          }),
        ),
      "invalid-manifest",
    );
  });

  it("requires exactly one summary for every direct/nested materializable path class", () => {
    const summaries = makeManifest().pathClassSummaries as Array<Record<string, unknown>>;
    expectContractCode(
      () => parseBackupV3Manifest(makeManifest({ pathClassSummaries: summaries.slice(1) })),
      "invalid-manifest",
    );
    expectContractCode(
      () =>
        parseBackupV3Manifest(makeManifest({ pathClassSummaries: [...summaries, summaries[0]] })),
      "invalid-manifest",
    );
  });

  it.each([
    "fullName",
    "email",
    "phoneNumber",
    "address",
    "dateOfBirth",
    "membershipNumber",
    "idCardNumber",
    "vatNumber",
    "legacyMemberId",
    "actorId",
    "rawDocument",
    "rawSecret",
  ])("rejects the PII/secret canary field %s from the closed manifest", (field) => {
    expectContractCode(
      () => parseBackupV3Manifest(makeManifest({ [field]: "canary-value" })),
      "invalid-manifest",
    );
  });

  it("rejects PII-shaped unknown fields nested in path summaries", () => {
    const summaries = makeManifest().pathClassSummaries as Array<Record<string, unknown>>;
    const [first, ...rest] = summaries;
    expectContractCode(
      () =>
        parseBackupV3Manifest(
          makeManifest({
            pathClassSummaries: [{ ...first, sampleParticipantPath: "canary" }, ...rest],
          }),
        ),
      "invalid-manifest",
    );
  });
});
