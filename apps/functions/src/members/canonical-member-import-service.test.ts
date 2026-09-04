import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";

import type {
  MemberDirectoryDocumentData,
  MemberDirectoryDocumentReference,
  MemberDirectoryDocumentSnapshot,
  MemberDirectoryFirestore,
  MemberDirectoryTransaction,
} from "./canonical-member-directory-service.js";
import {
  MAX_CANONICAL_MEMBER_IMPORT_ROWS,
  createCanonicalMemberImportService,
  type CanonicalMemberImportExistingStudent,
} from "./canonical-member-import-service.js";
import { buildStudentIdentityKey } from "./member-directory-crypto.js";
import { buildInitialMemberDirectoryControlPlane } from "./member-directory-state.js";
import type { ParsedMemberRow } from "./member-pdf-import.js";

const identitySecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecret = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const operationWriteTime = "2026-09-03T20:10:00.000Z";
const expiresAt = "2026-09-03T20:40:00.000Z";
const actor = Object.freeze({
  actorId: "owner-1",
  academyId: "academy-1",
  role: "owner" as const,
  active: true,
  appCheckVerified: true,
});

type Ref = MemberDirectoryDocumentReference;

type ParsedMemberRowOverrides = {
  [Key in keyof ParsedMemberRow]?: ParsedMemberRow[Key] | undefined;
};

function adultRow(sourceRowNumber = 1, overrides: ParsedMemberRowOverrides = {}): ParsedMemberRow {
  return Object.freeze(
    Object.fromEntries(
      Object.entries({
        sourceReport: "total",
        sourceRowNumber,
        membershipNumber: `BPT-${String(sourceRowNumber).padStart(4, "0")}`,
        fullName: `Synthetic Adult ${sourceRowNumber}`,
        email: `adult-${sourceRowNumber}@example.test`,
        idCardNumber: `ID-${sourceRowNumber}`,
        birthDate: "1990-01-02",
        vatNumber: `VAT-${sourceRowNumber}`,
        mobileNumber: `+441534${String(sourceRowNumber).padStart(6, "0")}`,
        membershipStatus: "active",
        ...overrides,
      }).filter(([, value]) => value !== undefined),
    ),
  ) as ParsedMemberRow;
}

function student(
  studentId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): MemberDirectoryDocumentData {
  return Object.freeze({
    studentId,
    academyId: "academy-1",
    fullName: `Existing ${studentId}`,
    dateOfBirth: "1990-01-02",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-09-03T19:00:00.000Z",
    createdBy: "system-1",
    updatedAt: "2026-09-03T19:00:00.000Z",
    updatedBy: "system-1",
    ...overrides,
  });
}

function existingStudent(
  studentId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): CanonicalMemberImportExistingStudent {
  return Object.freeze({ studentId, student: student(studentId, overrides) });
}

function existingAdminProfile(studentId: string): MemberDirectoryDocumentData {
  return Object.freeze({
    studentId,
    academyId: "academy-1",
    gender: "unknown",
    source: "admin",
    schemaVersion: "1",
    createdAt: "2026-09-03T19:00:00.000Z",
    createdBy: "system-1",
    updatedAt: "2026-09-03T19:00:00.000Z",
    updatedBy: "system-1",
  });
}

function canonicalState(count: number): MemberDirectoryState {
  return {
    stateId: "current",
    academyId: "academy-1",
    readerVersion: "canonical-v1",
    directoryWriteMode: "canonical-v1",
    freezeStatus: "open",
    stateRevision: 0,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "complete",
    digestVersion: "hmac-sha256-v1",
    secretVersion: "identity-v1",
    identityKeyBaselineMac: "a".repeat(64),
    identityKeyBaselineArtifactId: "baseline-1",
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: count,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: "2026-09-03T19:00:00.000Z",
    createdBy: "system-1",
    updatedAt: "2026-09-03T19:00:00.000Z",
    updatedBy: "system-1",
  };
}

function provisionedAdmin(): MemberDirectoryDocumentData {
  return {
    userId: "owner-1",
    academyId: "academy-1",
    accountType: "staff",
    displayName: "Synthetic Owner",
    email: "owner@example.test",
    authProvider: "google",
    active: true,
    adminRole: "owner",
    lastRoleChangeAuditId: "audit-role-1",
    createdAt: Timestamp.fromMillis(1_700_000_000_000),
    createdBy: "bootstrap-owner",
    updatedAt: Timestamp.fromMillis(1_700_000_001_000),
    updatedBy: "bootstrap-owner",
    status: "active",
    schemaVersion: 1,
  };
}

function controlRecords(count: number): Record<string, MemberDirectoryDocumentData> {
  const state = canonicalState(count);
  const control = buildInitialMemberDirectoryControlPlane({
    projectId: "demo-bpt-jersey",
    state,
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    now: state.createdAt,
    actorId: "system-1",
  });
  return {
    "academies/academy-1/users/owner-1": provisionedAdmin(),
    "academies/academy-1/memberDirectoryStates/current": state,
    "memberDirectoryRestoreGuards/academy-1": control.guard,
    "memberDirectoryRestoreGuards/academy-1/events/0": control.event,
  };
}

function harness(
  options: Readonly<{
    existing?: readonly CanonicalMemberImportExistingStudent[];
    stateCount?: number;
    records?: Readonly<Record<string, MemberDirectoryDocumentData>>;
    failCommit?: boolean;
  }> = {},
) {
  const existing = options.existing ?? [];
  const records = new Map<string, MemberDirectoryDocumentData>(
    Object.entries({
      ...controlRecords(options.stateCount ?? existing.length),
      ...Object.fromEntries(
        existing.flatMap((bundle) => [
          [`academies/academy-1/students/${bundle.studentId}`, bundle.student],
          ...(bundle.adminProfile === undefined
            ? []
            : [
                [
                  `academies/academy-1/studentAdminProfiles/${bundle.profileId ?? bundle.studentId}`,
                  bundle.adminProfile as MemberDirectoryDocumentData,
                ],
              ]),
        ]),
      ),
      ...options.records,
    }) as [string, MemberDirectoryDocumentData][],
  );
  const readPaths: string[] = [];
  const scanLimits: number[] = [];
  const committedWritePaths: string[] = [];
  const ref = (path: string): Ref => ({ id: path.split("/").at(-1) ?? "", path });
  const firestore: MemberDirectoryFirestore = {
    doc: ref,
    runTransaction: async (callback) => {
      const staged = new Map<string, MemberDirectoryDocumentData>();
      const creates = new Set<string>();
      let hasWritten = false;
      const transaction: MemberDirectoryTransaction = {
        get: async (target: Ref): Promise<MemberDirectoryDocumentSnapshot> => {
          if (hasWritten) throw new Error("Firestore transaction read after write");
          readPaths.push(target.path);
          const data = records.get(target.path);
          return { id: target.id, exists: data !== undefined, data: () => data };
        },
        create: (target: Ref, data: MemberDirectoryDocumentData) => {
          hasWritten = true;
          if (records.has(target.path) || staged.has(target.path))
            throw new Error("already exists");
          creates.add(target.path);
          staged.set(target.path, data);
          return transaction;
        },
        set: (target: Ref, data: MemberDirectoryDocumentData) => {
          hasWritten = true;
          staged.set(target.path, data);
          return transaction;
        },
      };
      const result = await callback(transaction);
      if (options.failCommit && staged.size > 0) throw new Error("synthetic atomic commit failure");
      for (const [path, data] of staged) {
        if (creates.has(path) && records.has(path)) throw new Error("already exists");
        records.set(path, data);
        committedWritePaths.push(path);
      }
      return result;
    },
  };
  const service = createCanonicalMemberImportService({
    firestore,
    scanExistingStudents: async (_transaction, _academyId, limit) => {
      scanLimits.push(limit);
      return existing.slice(0, limit);
    },
    projectId: "demo-bpt-jersey",
    targetProjectClassification: "emulator",
    identitySecretMaterial: identitySecret,
    identitySecretVersion: "identity-v1",
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
  });
  return { service, records, readPaths, scanLimits, committedWritePaths };
}

type ManifestEntry = Readonly<Record<string, unknown>>;

function entry(
  row: ParsedMemberRow,
  classification: string,
  overrides: Readonly<Record<string, unknown>> = {},
): ManifestEntry {
  return Object.freeze({
    sourceReport: row.sourceReport,
    sourceRowNumber: row.sourceRowNumber,
    targetAcademyId: "academy-1",
    classification,
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    ...overrides,
  });
}

function manifest(operationId: string, rows: readonly ManifestEntry[]): unknown {
  return Object.freeze({
    operationId,
    academyId: "academy-1",
    operationWriteTime,
    expiresAt,
    rows: Object.freeze([...rows]),
    schemaVersion: "1",
  });
}

function command(
  rows: readonly ParsedMemberRow[],
  entries: readonly ManifestEntry[],
  operationId = "import-operation-1",
) {
  return Object.freeze({
    actor,
    operationId,
    rows: Object.freeze([...rows]),
    manifest: manifest(operationId, entries),
    now: operationWriteTime,
  });
}

describe("canonical member PDF import core", () => {
  it("classifies createable adults and explicitly reviewed existing matches exactly once without writes", async () => {
    const newRow = adultRow(1);
    const newHarness = harness();
    const newPreview = await newHarness.service.dryRun(
      command([newRow], [entry(newRow, "createable-adult", { sourceLegacyId: "legacy-member-1" })]),
    );
    expect(newPreview.classifications).toEqual([
      { rowMac: expect.stringMatching(/^[a-f0-9]{64}$/u), classification: "createable-adult" },
    ]);
    expect(newPreview.confirmable).toBe(true);
    expect(newHarness.committedWritePaths).toEqual([]);

    const sameId = "legacy-student-2";
    const sameRow = adultRow(2, {
      membershipNumber: undefined,
      email: undefined,
      idCardNumber: undefined,
      vatNumber: undefined,
      mobileNumber: undefined,
      fullName: `Existing ${sameId}`,
    });
    const sameHarness = harness({ existing: [existingStudent(sameId)] });
    const samePreview = await sameHarness.service.dryRun(
      command(
        [sameRow],
        [
          entry(sameRow, "same-id-compatible", {
            sourceLegacyId: sameId,
            existingStudentId: sameId,
            adminProfileDisposition: "create",
            reviewedReason: "Reviewed exact historical identifier",
          }),
        ],
        "import-operation-2",
      ),
    );
    expect(samePreview.classifications.map((item) => item.classification)).toEqual([
      "same-id-compatible",
    ]);
    expect(samePreview.confirmable).toBe(true);
    expect(sameHarness.committedWritePaths).toEqual([]);

    const explicitId = "existing-student-3";
    const explicitRow = adultRow(3, {
      membershipNumber: undefined,
      email: undefined,
      idCardNumber: undefined,
      vatNumber: undefined,
      mobileNumber: undefined,
      fullName: `Existing ${explicitId}`,
    });
    const explicitHarness = harness({ existing: [existingStudent(explicitId)] });
    const explicitPreview = await explicitHarness.service.dryRun(
      command(
        [explicitRow],
        [
          entry(explicitRow, "explicit-existing-student-match", {
            existingStudentId: explicitId,
            adminProfileDisposition: "create",
            reviewedReason: "Reviewed against the canonical record",
          }),
        ],
        "import-operation-3",
      ),
    );
    expect(explicitPreview.classifications.map((item) => item.classification)).toEqual([
      "explicit-existing-student-match",
    ]);
    expect(explicitPreview.confirmable).toBe(true);
    expect(explicitHarness.committedWritePaths).toEqual([]);
  });

  it("requires an explicit active same-tenant family and relationship before a minor is eligible", async () => {
    const minorId = "minor-student-1";
    const minorRow = adultRow(10, {
      membershipNumber: undefined,
      email: undefined,
      idCardNumber: undefined,
      vatNumber: undefined,
      mobileNumber: undefined,
      fullName: `Existing ${minorId}`,
      birthDate: "2015-05-06",
    });
    const minor = existingStudent(minorId, {
      dateOfBirth: "2015-05-06",
      participantType: "minor",
      familyId: "family-1",
    });
    const records = {
      "academies/academy-1/families/family-1": {
        familyId: "family-1",
        academyId: "academy-1",
        primaryContactUserId: "guardian-1",
        billingContactUserId: "guardian-1",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: operationWriteTime,
        createdBy: "owner-1",
        updatedAt: operationWriteTime,
        updatedBy: "owner-1",
      },
      "academies/academy-1/relationships/relationship-1": {
        relationshipId: "relationship-1",
        academyId: "academy-1",
        familyId: "family-1",
        studentId: minorId,
        adultUserId: "guardian-1",
        relationshipType: "guardian",
        permissions: ["readProfile"],
        validFrom: operationWriteTime,
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: operationWriteTime,
        createdBy: "owner-1",
        updatedAt: operationWriteTime,
        updatedBy: "owner-1",
      },
    };
    const noMapping = harness({ existing: [minor], records });
    const blocked = await noMapping.service.dryRun(
      command([minorRow], [entry(minorRow, "minor-requires-family-match")]),
    );
    expect(blocked.classifications.map((item) => item.classification)).toEqual([
      "minor-requires-family-match",
    ]);
    expect(blocked.confirmable).toBe(false);
    expect(noMapping.committedWritePaths).toEqual([]);

    const mapped = harness({ existing: [minor], records });
    const eligible = await mapped.service.dryRun(
      command(
        [minorRow],
        [
          entry(minorRow, "explicit-existing-student-match", {
            existingStudentId: minorId,
            familyId: "family-1",
            relationshipId: "relationship-1",
            adminProfileDisposition: "create",
            reviewedReason: "Reviewed guardian linkage",
          }),
        ],
      ),
    );
    expect(eligible.classifications.map((item) => item.classification)).toEqual([
      "explicit-existing-student-match",
    ]);
    expect(eligible.confirmable).toBe(true);
    expect(mapped.committedWritePaths).toEqual([]);
  });

  it("rejects an unreviewed same-ID coincidence instead of creating a second student", async () => {
    const legacyStudentId = "legacy-coincidence-1";
    const row = adultRow(11);
    const current = harness({ existing: [existingStudent(legacyStudentId)] });

    const preview = await current.service.dryRun(
      command(
        [row],
        [entry(row, "identity-conflict", { sourceLegacyId: legacyStudentId })],
        "import-unreviewed-same-id-1",
      ),
    );

    expect(preview.classifications).toEqual([
      { rowMac: expect.stringMatching(/^[a-f0-9]{64}$/u), classification: "identity-conflict" },
    ]);
    expect(preview.confirmable).toBe(false);
    expect(current.committedWritePaths).toEqual([]);
  });

  it("emits every closed ineligible classification without ambiguous double-classification", async () => {
    const missing = adultRow(20, { birthDate: undefined });
    const missingResult = await harness().service.dryRun(
      command([missing], [entry(missing, "missing-required-fields")]),
    );
    expect(missingResult.classifications.map((item) => item.classification)).toEqual([
      "missing-required-fields",
    ]);

    const invalid = { ...adultRow(21), fullName: " invalid " } as ParsedMemberRow;
    const invalidResult = await harness().service.dryRun(
      command([invalid], [entry(invalid, "invalid-record")]),
    );
    expect(invalidResult.classifications.map((item) => item.classification)).toEqual([
      "invalid-record",
    ]);

    const conflictId = "identity-owner-1";
    const conflictRow = adultRow(22);
    const conflictKey = buildStudentIdentityKey({
      academyId: "academy-1",
      kind: "membership-number",
      value: conflictRow.membershipNumber ?? "",
      ownerStudentId: conflictId,
      secretMaterial: identitySecret,
      secretVersion: "identity-v1",
      now: operationWriteTime,
      actorId: "owner-1",
    });
    const conflictResult = await harness({
      existing: [existingStudent(conflictId)],
      records: {
        [`academies/academy-1/studentIdentityKeys/${conflictKey.keyId}`]: conflictKey,
      },
    }).service.dryRun(command([conflictRow], [entry(conflictRow, "identity-conflict")]));
    expect(conflictResult.classifications.map((item) => item.classification)).toEqual([
      "identity-conflict",
    ]);

    const crossId = "cross-student-1";
    const crossRow = adultRow(23, {
      membershipNumber: undefined,
      email: undefined,
      idCardNumber: undefined,
      vatNumber: undefined,
      mobileNumber: undefined,
      fullName: `Existing ${crossId}`,
    });
    const crossResult = await harness({
      existing: [existingStudent(crossId, { academyId: "academy-2" })],
    }).service.dryRun(
      command(
        [crossRow],
        [
          entry(crossRow, "cross-tenant", {
            targetAcademyId: "academy-2",
            existingStudentId: crossId,
            adminProfileDisposition: "create",
            reviewedReason: "Invalid synthetic cross-tenant mapping",
          }),
        ],
      ),
    );
    expect(crossResult.classifications.map((item) => item.classification)).toEqual([
      "cross-tenant",
    ]);

    const duplicateA = adultRow(24, { membershipNumber: "BPT-DUPLICATE" });
    const duplicateB = adultRow(25, { membershipNumber: "bpt-duplicate" });
    const duplicateResult = await harness().service.dryRun(
      command(
        [duplicateA, duplicateB],
        [
          entry(duplicateA, "duplicate-membership-number"),
          entry(duplicateB, "duplicate-membership-number"),
        ],
      ),
    );
    expect(duplicateResult.classifications.map((item) => item.classification)).toEqual([
      "duplicate-membership-number",
      "duplicate-membership-number",
    ]);
    expect(
      [missingResult, invalidResult, conflictResult, crossResult, duplicateResult].every(
        (result) => result.classifications.length > 0 && result.confirmable === false,
      ),
    ).toBe(true);
  });

  it("classifies a future birth date as invalid-record instead of throwing", async () => {
    const row = adultRow(29, { birthDate: "2030-01-01" });
    const current = harness();

    await expect(
      current.service.dryRun(
        command([row], [entry(row, "invalid-record")], "import-future-date-1"),
      ),
    ).resolves.toMatchObject({
      classifications: [{ classification: "invalid-record" }],
      confirmable: false,
    });
    expect(current.committedWritePaths).toEqual([]);
  });

  it("reads at most 401 existing students, accepts 400, and rejects row 401 with zero writes", async () => {
    const fourHundred = Array.from({ length: 400 }, (_, index) =>
      existingStudent(`existing-${index + 1}`),
    );
    const matched = adultRow(30, {
      membershipNumber: undefined,
      email: undefined,
      idCardNumber: undefined,
      vatNumber: undefined,
      mobileNumber: undefined,
      fullName: "Existing existing-1",
    });
    const accepted = harness({ existing: fourHundred });
    const preview = await accepted.service.dryRun(
      command(
        [matched],
        [
          entry(matched, "explicit-existing-student-match", {
            existingStudentId: "existing-1",
            adminProfileDisposition: "create",
            reviewedReason: "Reviewed bounded existing record",
          }),
        ],
      ),
    );
    expect(preview.confirmable).toBe(true);
    expect(accepted.scanLimits).toEqual([401]);
    expect(accepted.committedWritePaths).toEqual([]);

    const overLimit = harness({
      existing: [...fourHundred, existingStudent("existing-401")],
      stateCount: 400,
    });
    await expect(
      overLimit.service.dryRun(
        command(
          [matched],
          [
            entry(matched, "explicit-existing-student-match", {
              existingStudentId: "existing-1",
              adminProfileDisposition: "create",
              reviewedReason: "Reviewed bounded existing record",
            }),
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: "limit" });
    expect(overLimit.scanLimits).toEqual([401]);
    expect(overLimit.committedWritePaths).toEqual([]);
  });

  it.each([
    { existingCount: 399, newRows: 2 },
    { existingCount: 400, newRows: 1 },
  ])(
    "rejects capacity $existingCount + $newRows before any write",
    async ({ existingCount, newRows }) => {
      const existing = Array.from({ length: existingCount }, (_, index) =>
        existingStudent(`capacity-${index + 1}`),
      );
      const rows = Array.from({ length: newRows }, (_, index) => adultRow(40 + index));
      const current = harness({ existing });
      await expect(
        current.service.dryRun(
          command(
            rows,
            rows.map((row) => entry(row, "createable-adult")),
          ),
        ),
      ).rejects.toMatchObject({ code: "capacity" });
      expect(current.committedWritePaths).toEqual([]);
    },
  );

  it("returns a metadata-only receipt containing counts, MACs and versions but no source PII", async () => {
    const row = adultRow(50, {
      fullName: "PII Canary Name",
      email: "pii-canary@example.test",
      birthDate: "1985-09-17",
      mobileNumber: "+441534999999",
      membershipNumber: "SECRET-MEMBER-50",
      idCardNumber: "SECRET-ID-50",
      vatNumber: "SECRET-VAT-50",
    });
    const current = harness();
    const preview = await current.service.dryRun(
      command([row], [entry(row, "createable-adult", { sourceLegacyId: "legacy-private-50" })]),
    );
    const serialized = JSON.stringify(preview.receipt);
    expect(preview.receipt).toEqual(
      expect.objectContaining({
        classificationCounts: expect.objectContaining({ "createable-adult": 1 }),
        sourceMac: expect.stringMatching(/^[a-f0-9]{64}$/u),
        privateManifestMac: expect.stringMatching(/^[a-f0-9]{64}$/u),
        planMac: expect.stringMatching(/^[a-f0-9]{64}$/u),
        outputSetMac: expect.stringMatching(/^[a-f0-9]{64}$/u),
        identitySecretVersion: "identity-v1",
        integritySecretVersion: "integrity-v1",
      }),
    );
    expect(serialized).not.toMatch(
      /PII Canary|pii-canary|1985-09-17|441534999999|SECRET-|legacy-private/u,
    );
    expect(current.committedWritePaths).toEqual([]);
  });

  it("confirms one conservative batch atomically using opaque IDs and never writes members", async () => {
    const rows = [adultRow(60), adultRow(61)];
    const entries = [
      entry(rows[0] as ParsedMemberRow, "createable-adult", {
        sourceLegacyId: "legacy-member-60",
      }),
      entry(rows[1] as ParsedMemberRow, "createable-adult"),
    ];
    const current = harness();
    const input = command(rows, entries, "import-confirm-1");
    const preview = await current.service.dryRun(input);
    const result = await current.service.confirm({ ...input, receipt: preview.receipt });

    expect(result).toEqual({
      receiptId: expect.stringMatching(/^import-[a-f0-9]{64}$/u),
      created: 2,
      matched: 0,
    });
    const createdStudents = [...current.records.entries()].filter(([path]) =>
      /academies\/academy-1\/students\/student-[a-f0-9]{64}$/u.test(path),
    );
    expect(createdStudents).toHaveLength(2);
    expect(createdStudents.map(([, value]) => value)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ active: false, status: "inactive", participantType: "adult" }),
      ]),
    );
    expect(createdStudents.map(([path]) => path).join("\n")).not.toMatch(/legacy-member/u);
    expect(
      [...current.records.keys()].filter((path) => path.includes("/studentAdminProfiles/student-")),
    ).toHaveLength(2);
    expect(
      [...current.records.keys()].filter((path) => path.includes("/studentIdentityKeys/")),
    ).toHaveLength(7);
    expect(current.records.get("academies/academy-1/memberDirectoryStates/current")).toEqual(
      expect.objectContaining({ stateRevision: 1, rollbackEligibleStudentCount: 2 }),
    );
    expect(current.records.get("memberDirectoryRestoreGuards/academy-1")).toEqual(
      expect.objectContaining({ highestStateRevision: 1 }),
    );
    expect(current.records.has("memberDirectoryRestoreGuards/academy-1/events/1")).toBe(true);
    expect(
      [...current.records.keys()].filter((path) =>
        path.includes("/memberDirectoryImportReceipts/"),
      ),
    ).toHaveLength(1);
    expect(
      [...current.records.keys()].filter((path) => path.includes("/auditEvents/")),
    ).toHaveLength(1);
    expect([...current.records.keys()].some((path) => /\/members(?:\/|$)/u.test(path))).toBe(false);
  });

  it("replays only the exact receipt and verifies its outputs without additional writes", async () => {
    const row = adultRow(70);
    const entries = [entry(row, "createable-adult")];
    const current = harness();
    const input = command([row], entries, "import-replay-1");
    const preview = await current.service.dryRun(input);
    const first = await current.service.confirm({ ...input, receipt: preview.receipt });
    const writesAfterFirst = current.committedWritePaths.length;

    await expect(current.service.confirm({ ...input, receipt: preview.receipt })).resolves.toEqual(
      first,
    );
    expect(current.committedWritePaths).toHaveLength(writesAfterFirst);

    const divergentRow = adultRow(70, { fullName: "Divergent Synthetic Adult" });
    await expect(
      current.service.confirm({
        ...command([divergentRow], entries, "import-replay-1"),
        receipt: preview.receipt,
      }),
    ).rejects.toMatchObject({ code: "replay" });
    expect(current.committedWritePaths).toHaveLength(writesAfterFirst);
  });

  it("rejects replay when an explicitly matched canonical target is no longer compatible", async () => {
    const studentId = "existing-replay-target-1";
    const row = adultRow(71, {
      membershipNumber: undefined,
      email: undefined,
      idCardNumber: undefined,
      vatNumber: undefined,
      mobileNumber: undefined,
      fullName: `Existing ${studentId}`,
    });
    const profile = existingAdminProfile(studentId);
    const current = harness({
      existing: [
        Object.freeze({
          studentId,
          student: student(studentId),
          profileId: studentId,
          adminProfile: profile,
        }),
      ],
    });
    const input = command(
      [row],
      [
        entry(row, "explicit-existing-student-match", {
          existingStudentId: studentId,
          adminProfileDisposition: "existing-compatible",
          reviewedReason: "Reviewed exact canonical target",
        }),
      ],
      "import-replay-match-1",
    );
    const preview = await current.service.dryRun(input);
    const first = await current.service.confirm({ ...input, receipt: preview.receipt });
    expect(first).toEqual(expect.objectContaining({ created: 0, matched: 1 }));
    const writesAfterFirst = current.committedWritePaths.length;

    current.records.delete(`academies/academy-1/studentAdminProfiles/${studentId}`);

    await expect(
      current.service.confirm({ ...input, receipt: preview.receipt }),
    ).rejects.toMatchObject({ code: "replay" });
    expect(current.committedWritePaths).toHaveLength(writesAfterFirst);
  });

  it("blocks every conflicted plan and leaves no partial records on a commit failure", async () => {
    const blockedRow = adultRow(80, { birthDate: undefined });
    const blocked = harness();
    const blockedInput = command(
      [blockedRow],
      [entry(blockedRow, "missing-required-fields")],
      "import-blocked-1",
    );
    const blockedPreview = await blocked.service.dryRun(blockedInput);
    await expect(
      blocked.service.confirm({ ...blockedInput, receipt: blockedPreview.receipt }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(blocked.committedWritePaths).toEqual([]);

    const row = adultRow(81);
    const failing = harness({ failCommit: true });
    const failingInput = command(
      [row],
      [entry(row, "createable-adult")],
      "import-atomic-failure-1",
    );
    const failingPreview = await failing.service.dryRun(failingInput);
    const pathsBefore = [...failing.records.keys()];
    await expect(
      failing.service.confirm({ ...failingInput, receipt: failingPreview.receipt }),
    ).rejects.toThrow(/synthetic atomic commit failure/u);
    expect([...failing.records.keys()]).toEqual(pathsBefore);
    expect(failing.committedWritePaths).toEqual([]);
  });

  it("rejects 51 rows and unauthorized actors before scans or writes", async () => {
    expect(MAX_CANONICAL_MEMBER_IMPORT_ROWS).toBe(50);
    const rows = Array.from({ length: 51 }, (_, index) => adultRow(100 + index));
    const overLimit = harness();
    await expect(
      overLimit.service.dryRun(
        command(
          rows,
          rows.map((row) => entry(row, "createable-adult")),
        ),
      ),
    ).rejects.toMatchObject({ code: "limit" });
    expect(overLimit.scanLimits).toEqual([]);
    expect(overLimit.committedWritePaths).toEqual([]);

    const one = adultRow(200);
    const unauthorized = harness();
    await expect(
      unauthorized.service.dryRun({
        ...command([one], [entry(one, "createable-adult")]),
        actor: { ...actor, appCheckVerified: false },
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    expect(unauthorized.readPaths).toEqual([]);
    expect(unauthorized.scanLimits).toEqual([]);
    expect(unauthorized.committedWritePaths).toEqual([]);
  });
});
