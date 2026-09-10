import { describe, expect, expectTypeOf, it } from "vitest";

import {
  adminUpdateStudentInputSchema,
  adminDirectoryReadPurposes,
  adminCreateStudentInputSchema,
  memberDirectoryStateSchema,
  memberDirectoryOperationPhases,
  maskMembershipReference,
  memberRecordMaintenanceDetailSchema,
  publicAdminIdentifierLookupKinds,
  parseAdminCreateStudentInput,
  parseAdminUpdateStudentInput,
  studentAdminProfileSchema,
  toAdminDirectoryRow,
  toMemberRecordMaintenanceDetail,
} from "./member-directory-contracts";
import type {
  AdminDirectoryRow,
  AdminCreateStudentInput,
  MemberRecordMaintenanceDetail,
  StudentAdminProfile,
  MemberDirectoryState,
} from "./member-directory-contracts";

const student = {
  studentId: "student-1",
  academyId: "academy-1",
  fullName: "Synthetic Student",
  dateOfBirth: "2000-01-02",
  phoneNumber: "+441534000001",
  email: "student@example.test",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  participantType: "adult",
  active: true,
  status: "active",
} as const;

const adminProfile = {
  studentId: "student-1",
  academyId: "academy-1",
  membershipNumber: "BPT 00001234",
  idCardNumber: "ID-1234",
  vatNumber: "VAT-1234",
  gender: "unknown",
  frequencyNote: "Twice weekly",
  source: "admin",
  schemaVersion: "1",
  createdAt: "2026-09-03T20:00:00.000Z",
  createdBy: "owner-1",
  updatedAt: "2026-09-03T20:00:00.000Z",
  updatedBy: "owner-1",
} as const;

describe("canonical member directory contracts", () => {
  it("accepts only the closed admin provenance combinations", () => {
    expect(studentAdminProfileSchema.safeParse(adminProfile).success).toBe(true);
    expect(
      studentAdminProfileSchema.safeParse({
        ...adminProfile,
        source: "member-pdf-import",
        importRunId: "import-1",
      }).success,
    ).toBe(true);
    expect(
      studentAdminProfileSchema.safeParse({
        ...adminProfile,
        source: "legacy-member-migration",
        migrationId: "migration-1",
        legacyMemberId: "LEGACY-1",
      }).success,
    ).toBe(true);
    expect(
      studentAdminProfileSchema.safeParse({
        ...adminProfile,
        source: "legacy-member-migration",
        migrationId: "migration-1",
        legacyMemberId: "LEGACY-1",
        importRunId: "import-1",
      }).success,
    ).toBe(true);

    const forbidden = [
      { ...adminProfile, importRunId: "import-1" },
      { ...adminProfile, source: "member-pdf-import" },
      { ...adminProfile, source: "member-pdf-import", migrationId: "migration-1" },
      { ...adminProfile, source: "legacy-member-migration", migrationId: "migration-1" },
      { ...adminProfile, active: true },
      { ...adminProfile, status: "active" },
      { ...adminProfile, unknown: "nope" },
    ];

    for (const candidate of forbidden) {
      expect(studentAdminProfileSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("rejects non-canonical identifiers and unsafe text", () => {
    for (const membershipNumber of [" lower", "lower", "A".repeat(65), "A\u0000B", "A_B"]) {
      expect(
        studentAdminProfileSchema.safeParse({ ...adminProfile, membershipNumber }).success,
      ).toBe(false);
    }

    expect(
      studentAdminProfileSchema.safeParse({ ...adminProfile, frequencyNote: " note " }).success,
    ).toBe(false);
    expect(
      studentAdminProfileSchema.safeParse({
        ...adminProfile,
        updatedAt: "2026-02-30T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("publishes only the approved general directory fields", () => {
    expect(maskMembershipReference(" BPT 00001234 ")).toBe("****1234");
    expect(maskMembershipReference("M-1234")).toBeUndefined();

    const row = toAdminDirectoryRow(student, adminProfile);

    expect(row).toEqual({
      studentId: "student-1",
      fullName: "Synthetic Student",
      trainingCenter: "Town",
      participantType: "adult",
      active: true,
      status: "active",
      membershipReference: "****1234",
    });
    expect(Object.keys(row).sort()).toEqual(
      [
        "active",
        "fullName",
        "membershipReference",
        "participantType",
        "status",
        "studentId",
        "trainingCenter",
      ].sort(),
    );
    expect(JSON.stringify(row)).not.toMatch(
      /academyId|dateOfBirth|email|phone|gender|idCard|vatNumber|frequency|source|createdBy/u,
    );
  });

  it("builds the purpose-bound maintenance detail without provenance", () => {
    const detail = toMemberRecordMaintenanceDetail(student, adminProfile);

    expect(memberRecordMaintenanceDetailSchema.safeParse(detail).success).toBe(true);
    expect(detail).toEqual({
      studentId: "student-1",
      fullName: "Synthetic Student",
      dateOfBirth: "2000-01-02",
      phoneNumber: "+441534000001",
      email: "student@example.test",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      participantType: "adult",
      active: true,
      status: "active",
      membershipNumber: "BPT 00001234",
      idCardNumber: "ID-1234",
      vatNumber: "VAT-1234",
      gender: "unknown",
      frequencyNote: "Twice weekly",
    });
    expect(JSON.stringify(detail)).not.toMatch(
      /academyId|legacyMemberId|source|importRunId|migrationId|createdAt|createdBy|updatedAt|updatedBy/u,
    );
  });

  it("keeps the waiver contact and address out of general rows and inside the detail", () => {
    const profileWithWaiverBlocks = {
      ...adminProfile,
      emergencyContact: {
        fullName: "Synthetic Contact",
        relationship: "Parent",
        phoneNumber: "+441534000002",
        alternatePhoneNumber: "+441534000003",
      },
      postalAddress: { line: "1 Synthetic Street, St Helier", postCode: "JE2 3AB" },
    } as const;
    expect(studentAdminProfileSchema.safeParse(profileWithWaiverBlocks).success).toBe(true);
    expect(
      studentAdminProfileSchema.safeParse({
        ...profileWithWaiverBlocks,
        emergencyContact: { ...profileWithWaiverBlocks.emergencyContact, email: "x@example.test" },
      }).success,
    ).toBe(false);
    expect(
      studentAdminProfileSchema.safeParse({
        ...profileWithWaiverBlocks,
        postalAddress: { line: "1 Synthetic Street" },
      }).success,
    ).toBe(false);

    const row = toAdminDirectoryRow(student, profileWithWaiverBlocks);
    expect(JSON.stringify(row)).not.toMatch(/emergency|postalAddress|postCode|Synthetic Contact/u);

    const detail = toMemberRecordMaintenanceDetail(student, profileWithWaiverBlocks);
    expect(memberRecordMaintenanceDetailSchema.safeParse(detail).success).toBe(true);
    expect(detail.emergencyContact).toEqual(profileWithWaiverBlocks.emergencyContact);
    expect(detail.postalAddress).toEqual(profileWithWaiverBlocks.postalAddress);
    expect(Object.isFrozen(detail.emergencyContact)).toBe(true);
    expect(Object.isFrozen(detail.postalAddress)).toBe(true);
  });

  it("parses optional complete waiver blocks in admin create and rejects partial ones", () => {
    const base = {
      requestId: "request-3",
      fullName: "Synthetic Adult",
      dateOfBirth: "2000-01-02",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
    } as const;
    const complete = parseAdminCreateStudentInput(
      {
        ...base,
        emergencyContact: {
          fullName: "Synthetic Contact",
          relationship: "Spouse",
          phoneNumber: "+441534000002",
        },
        postalAddress: { line: "1 Synthetic Street", postCode: "JE2 3AB" },
      },
      "2026-09-04",
    );
    expect(complete.ok).toBe(true);
    if (!complete.ok) return;
    expect(complete.value.emergencyContact).toEqual({
      fullName: "Synthetic Contact",
      relationship: "Spouse",
      phoneNumber: "+441534000002",
    });
    expect(complete.value.postalAddress).toEqual({
      line: "1 Synthetic Street",
      postCode: "JE2 3AB",
    });

    const invalid = [
      { ...base, emergencyContact: { fullName: "Synthetic Contact", relationship: "Spouse" } },
      {
        ...base,
        emergencyContact: { fullName: " padded ", relationship: "Spouse", phoneNumber: "1" },
      },
      {
        ...base,
        emergencyContact: {
          fullName: "Synthetic Contact",
          relationship: "Spouse",
          phoneNumber: "+441534000002",
          email: "contact@example.test",
        },
      },
      { ...base, postalAddress: { line: "1 Synthetic Street" } },
      {
        ...base,
        postalAddress: { line: "1 Synthetic Street", postCode: "JE2 3AB", country: "JE" },
      },
      { ...base, emergencyContactName: "Synthetic Contact" },
      { ...base, address: "1 Synthetic Street" },
    ];
    for (const candidate of invalid) {
      expect(parseAdminCreateStudentInput(candidate, "2026-09-04").ok).toBe(false);
    }
  });

  it("keeps purposes and public lookup kinds closed", () => {
    expect(adminDirectoryReadPurposes).toEqual([
      "member-identity-lookup",
      "member-record-maintenance",
    ]);
    expect(publicAdminIdentifierLookupKinds).toEqual([
      "membership-number",
      "id-card-number",
      "vat-number",
    ]);
  });

  it("accepts every closed coordination-state tuple", () => {
    const stable = {
      stateId: "current",
      academyId: "academy-1",
      stateRevision: 7,
      identityKeyCoverage: "complete",
      digestVersion: "hmac-sha256-v1",
      secretVersion: "identity-v1",
      identityKeyBaselineMac: "a".repeat(64),
      identityKeyBaselineArtifactId: "baseline-1",
      rollbackCapacityLimit: 400,
      rollbackEligibleStudentCount: 2,
      lastCommittedChunkNo: 0,
      schemaVersion: "1",
      createdAt: "2026-09-03T20:00:00.000Z",
      createdBy: "system-1",
      updatedAt: "2026-09-03T20:00:00.000Z",
      updatedBy: "system-1",
    } as const;
    const active = {
      activeOperationId: "operation-1",
      leaseId: "lease-1",
      leaseOwner: "worker-1",
      leaseExpiresAt: "2026-09-03T20:02:00.000Z",
      operationDeadline: "2026-09-03T20:30:00.000Z",
    } as const;
    const tuple = (
      readerVersion: string,
      directoryWriteMode: string,
      freezeStatus: string,
      operationPhase: string,
      globalLegacyReadEliminated: boolean,
    ) => ({
      ...stable,
      readerVersion,
      directoryWriteMode,
      freezeStatus,
      operationPhase,
      globalLegacyReadEliminated,
      rollbackProtocolVersion: globalLegacyReadEliminated ? "disabled" : "legacy-projection-v1",
      ...(operationPhase === "restore-prepared"
        ? { preparedOperationId: "prepared-1" }
        : [
              "bootstrap",
              "identity-reconcile",
              "forward",
              "compensation",
              "rollback-projection",
              "canonical-recovery",
              "restore-recovery",
            ].includes(operationPhase)
          ? active
          : {}),
    });

    const validTuples = [
      tuple("legacy-v1", "legacy-v1", "open", "idle", false),
      tuple("legacy-v1", "blocked", "frozen", "bootstrap", false),
      tuple("legacy-v1", "blocked", "frozen", "forward", false),
      tuple("legacy-v1", "blocked", "frozen", "compensation", false),
      tuple("canonical-v1", "canonical-v1", "open", "idle", false),
      tuple("canonical-v1", "canonical-v1", "open", "idle", true),
      tuple("canonical-v1", "blocked", "frozen", "identity-reconcile", false),
      tuple("canonical-v1", "blocked", "frozen", "identity-reconcile", true),
      tuple("canonical-v1", "blocked", "frozen", "rollback-projection", false),
      tuple("legacy-rollback-v1", "blocked", "frozen", "rollback-readonly", false),
      tuple("legacy-rollback-v1", "blocked", "frozen", "canonical-recovery", false),
      tuple("canonical-v1", "blocked", "frozen", "restore-prepared", false),
      tuple("canonical-v1", "blocked", "frozen", "restore-prepared", true),
      tuple("canonical-v1", "blocked", "frozen", "restore-recovery", false),
      tuple("canonical-v1", "blocked", "frozen", "restore-recovery", true),
      tuple("canonical-v1", "blocked", "frozen", "restore-rehearsal-complete", false),
      tuple("canonical-v1", "blocked", "frozen", "restore-rehearsal-complete", true),
    ];

    for (const candidate of validTuples) {
      expect(memberDirectoryStateSchema.safeParse(candidate).success).toBe(true);
    }
    expect(memberDirectoryOperationPhases).toHaveLength(11);
  });

  it("rejects invalid state tuples and partial coordination envelopes", () => {
    const canonical = {
      stateId: "current",
      academyId: "academy-1",
      readerVersion: "canonical-v1",
      directoryWriteMode: "canonical-v1",
      freezeStatus: "open",
      stateRevision: 7,
      globalLegacyReadEliminated: false,
      identityKeyCoverage: "complete",
      digestVersion: "hmac-sha256-v1",
      secretVersion: "identity-v1",
      identityKeyBaselineMac: "a".repeat(64),
      identityKeyBaselineArtifactId: "baseline-1",
      rollbackProtocolVersion: "legacy-projection-v1",
      rollbackCapacityLimit: 400,
      rollbackEligibleStudentCount: 2,
      operationPhase: "idle",
      lastCommittedChunkNo: 0,
      schemaVersion: "1",
      createdAt: "2026-09-03T20:00:00.000Z",
      createdBy: "system-1",
      updatedAt: "2026-09-03T20:00:00.000Z",
      updatedBy: "system-1",
    } as const;

    const invalid = [
      { ...canonical, readerVersion: "legacy-v1" },
      { ...canonical, globalLegacyReadEliminated: true },
      {
        ...canonical,
        globalLegacyReadEliminated: true,
        rollbackProtocolVersion: "disabled",
        readerVersion: "legacy-v1",
      },
      { ...canonical, lastCommittedChunkNo: 1 },
      { ...canonical, stateRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...canonical, rollbackEligibleStudentCount: 401 },
      { ...canonical, activeOperationId: "operation-1" },
      { ...canonical, preparedOperationId: "prepared-1" },
      { ...canonical, extra: "nope" },
      {
        ...canonical,
        identityKeyCoverage: "incomplete",
        identityKeyBaselineArtifactId: undefined,
      },
      {
        ...canonical,
        directoryWriteMode: "blocked",
        freezeStatus: "frozen",
        operationPhase: "forward",
        activeOperationId: "operation-1",
      },
    ];

    for (const candidate of invalid) {
      expect(memberDirectoryStateSchema.safeParse(candidate).success).toBe(false);
    }

    const incompleteBaseline = {
      stateId: "current",
      academyId: "academy-1",
      readerVersion: "legacy-v1",
      directoryWriteMode: "legacy-v1",
      freezeStatus: "open",
      stateRevision: 0,
      globalLegacyReadEliminated: false,
      identityKeyCoverage: "incomplete",
      digestVersion: "hmac-sha256-v1",
      secretVersion: "identity-v1",
      rollbackProtocolVersion: "legacy-projection-v1",
      rollbackCapacityLimit: 400,
      rollbackEligibleStudentCount: 0,
      operationPhase: "idle",
      lastCommittedChunkNo: 0,
      schemaVersion: "1",
      createdAt: "2026-09-03T20:00:00.000Z",
      createdBy: "system-1",
      updatedAt: "2026-09-03T20:00:00.000Z",
      updatedBy: "system-1",
    } as const;
    expect(memberDirectoryStateSchema.safeParse(incompleteBaseline).success).toBe(true);
  });

  it("parses an adult admin create command with canonical participant fields", () => {
    const parsed = parseAdminCreateStudentInput(
      {
        requestId: "request-1",
        fullName: "Synthetic Adult",
        dateOfBirth: "2000-01-02",
        phoneNumber: "+441534000001",
        email: "adult@example.test",
        trainingCenter: "West",
        trainingTimePreferences: ["morning", "evening"],
        membershipNumber: "bpt 00001234",
        idCardNumber: "id-1234",
        vatNumber: "vat-1234",
        gender: "unknown",
        frequencyNote: "Twice weekly",
      },
      "2026-09-03",
    );

    expect(parsed).toEqual({
      ok: true,
      value: {
        requestId: "request-1",
        fullName: "Synthetic Adult",
        dateOfBirth: "2000-01-02",
        phoneNumber: "+441534000001",
        email: "adult@example.test",
        trainingCenter: "West",
        trainingTimePreferences: ["morning", "evening"],
        membershipNumber: "BPT 00001234",
        idCardNumber: "ID-1234",
        vatNumber: "VAT-1234",
        gender: "unknown",
        frequencyNote: "Twice weekly",
      },
    });
    if (!parsed.ok) return;
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.trainingTimePreferences)).toBe(true);
    expect(adminCreateStudentInputSchema.safeParse(parsed.value).success).toBe(true);
  });

  it("parses a closed full-replacement admin update with a UUID request ID", () => {
    const parsed = parseAdminUpdateStudentInput(
      {
        studentId: "student-1",
        requestId: "41cbb1aa-7020-4bb5-88a4-dbc73c5f0123",
        fullName: "Updated Adult",
        dateOfBirth: "2000-01-02",
        trainingCenter: "West",
        trainingTimePreferences: ["morning"],
        membershipNumber: " new 0001 ",
        gender: "female",
      },
      "2026-09-03",
    );

    expect(parsed).toEqual({
      ok: true,
      value: {
        studentId: "student-1",
        requestId: "41cbb1aa-7020-4bb5-88a4-dbc73c5f0123",
        fullName: "Updated Adult",
        dateOfBirth: "2000-01-02",
        trainingCenter: "West",
        trainingTimePreferences: ["morning"],
        membershipNumber: "NEW 0001",
        gender: "female",
      },
    });
    if (!parsed.ok) return;
    expect(adminUpdateStudentInputSchema.safeParse(parsed.value).success).toBe(true);
    expect(
      parseAdminUpdateStudentInput(
        { ...parsed.value, requestId: "not-a-uuid", participantType: "adult" },
        "2026-09-03",
      ).ok,
    ).toBe(false);
  });

  it("uses the server effective date for the adult/minor boundary", () => {
    const input = {
      requestId: "request-boundary",
      fullName: "Boundary Student",
      dateOfBirth: "2008-09-03",
      trainingCenter: "Town",
      trainingTimePreferences: ["afternoon"],
    } as const;

    expect(parseAdminCreateStudentInput(input, "2026-09-03").ok).toBe(true);
    const minor = parseAdminCreateStudentInput(input, "2026-09-02");
    expect(minor).toEqual({
      ok: false,
      error: [{ path: ["dateOfBirth"], code: "minor_requires_family_flow" }],
    });
  });

  it("rejects legacy aliases, server-owned fields and malformed admin create input", () => {
    const valid = {
      requestId: "request-2",
      fullName: "Synthetic Adult",
      dateOfBirth: "2000-01-02",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
    } as const;
    const invalid = [
      {
        fullName: valid.fullName,
        dateOfBirth: valid.dateOfBirth,
        trainingCenter: valid.trainingCenter,
        trainingTimePreferences: valid.trainingTimePreferences,
      },
      { ...valid, birthDate: "2000-01-02" },
      { ...valid, mobileNumber: "+441534000001" },
      { ...valid, frequency: "weekly" },
      { ...valid, participantType: "adult" },
      { ...valid, familyId: "family-1" },
      { ...valid, userId: "user-1" },
      { ...valid, studentId: "student-1" },
      { ...valid, academyId: "academy-1" },
      { ...valid, source: "admin" },
      { ...valid, active: true },
      { ...valid, status: "active" },
      { ...valid, legacyMemberId: "LEGACY-1" },
      { ...valid, trainingCenter: "Main" },
      { ...valid, trainingTimePreferences: [] },
      { ...valid, trainingTimePreferences: ["evening", "evening"] },
      { ...valid, dateOfBirth: "2030-01-01" },
    ];

    for (const candidate of invalid) {
      expect(parseAdminCreateStudentInput(candidate, "2026-09-03").ok).toBe(false);
    }
    expect(parseAdminCreateStudentInput(valid, "not-a-date")).toEqual({
      ok: false,
      error: [{ path: ["effectiveDate"], code: "invalid_effective_date" }],
    });
  });
});

expectTypeOf<StudentAdminProfile>().toMatchTypeOf<Readonly<Record<string, unknown>>>();
expectTypeOf<AdminDirectoryRow>().toMatchTypeOf<Readonly<Record<string, unknown>>>();
expectTypeOf<MemberRecordMaintenanceDetail>().toMatchTypeOf<Readonly<Record<string, unknown>>>();
expectTypeOf<MemberDirectoryState>().toMatchTypeOf<Readonly<Record<string, unknown>>>();
expectTypeOf<AdminCreateStudentInput>().toMatchTypeOf<Readonly<Record<string, unknown>>>();
