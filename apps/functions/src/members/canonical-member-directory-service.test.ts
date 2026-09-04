import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import {
  createCanonicalMemberDirectoryService,
  type MemberDirectoryDocumentData,
  type MemberDirectoryFirestore,
} from "./canonical-member-directory-service.js";
import { buildStudentIdentityKey } from "./member-directory-crypto.js";
import { buildInitialMemberDirectoryControlPlane } from "./member-directory-state.js";

const identitySecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecret = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const now = "2026-09-03T20:01:00.000Z";

type Ref = Readonly<{ id: string; path: string }>;

function canonicalState(): MemberDirectoryState {
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
    rollbackEligibleStudentCount: 2,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: "2026-09-03T20:00:00.000Z",
    createdBy: "system-1",
    updatedAt: "2026-09-03T20:00:00.000Z",
    updatedBy: "system-1",
  };
}

function provisionedAdminDocument(
  overrides: Readonly<Record<string, unknown>> = {},
): MemberDirectoryDocumentData {
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
    ...overrides,
  };
}

function controlPlaneSeed(): Record<string, MemberDirectoryDocumentData> {
  const state = canonicalState();
  const control = buildInitialMemberDirectoryControlPlane({
    projectId: "demo-bpt-jersey",
    state,
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    now: state.createdAt,
    actorId: "system-1",
  });
  return {
    "academies/academy-1/users/owner-1": provisionedAdminDocument(),
    "academies/academy-1/memberDirectoryStates/current": state,
    "memberDirectoryRestoreGuards/academy-1": control.guard,
    "memberDirectoryRestoreGuards/academy-1/events/0": control.event,
  };
}

function fakeFirestore(
  initial: Record<string, MemberDirectoryDocumentData> = controlPlaneSeed(),
  failCommitWhen?: (paths: readonly string[]) => boolean,
) {
  const records = new Map(Object.entries(initial));
  const readPaths: string[] = [];
  const committedWritePaths: string[] = [];
  const ref = (path: string): Ref => ({ id: path.split("/").at(-1) ?? "", path });
  const firestore: MemberDirectoryFirestore = {
    doc: ref,
    runTransaction: async (callback) => {
      const staged = new Map<string, MemberDirectoryDocumentData>();
      const creates = new Set<string>();
      const transaction = {
        get: async (target: Ref) => {
          readPaths.push(target.path);
          const data = records.get(target.path);
          return { id: target.id, exists: data !== undefined, data: () => data };
        },
        create: (target: Ref, data: MemberDirectoryDocumentData) => {
          if (records.has(target.path) || staged.has(target.path))
            throw new Error("already exists");
          creates.add(target.path);
          staged.set(target.path, data);
          return transaction;
        },
        set: (target: Ref, data: MemberDirectoryDocumentData) => {
          staged.set(target.path, data);
          return transaction;
        },
      };
      const result = await callback(transaction);
      const paths = [...staged.keys()];
      if (failCommitWhen?.(paths)) throw new Error("synthetic commit failure");
      for (const [path, data] of staged) {
        if (creates.has(path) && records.has(path)) throw new Error("already exists");
        records.set(path, data);
        committedWritePaths.push(path);
      }
      return result;
    },
  };
  return { firestore, records, readPaths, committedWritePaths };
}

function input(requestId = "request-1") {
  return {
    requestId,
    fullName: "Synthetic Adult",
    dateOfBirth: "2000-01-02",
    phoneNumber: "+441534000001",
    email: "adult@example.test",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    membershipNumber: "bpt 00001234",
    idCardNumber: "id-1234",
    vatNumber: "vat-1234",
    frequencyNote: "Twice weekly",
    emergencyContact: {
      fullName: "Synthetic Contact",
      relationship: "Spouse",
      phoneNumber: "+441534000002",
    },
    postalAddress: { line: "1 Synthetic Street, St Helier", postCode: "JE2 3AB" },
  } as const;
}

function actor() {
  return {
    actorId: "owner-1",
    academyId: "academy-1",
    role: "owner" as const,
    active: true,
    appCheckVerified: true,
  };
}

function updateInput(requestId = "41cbb1aa-7020-4bb5-88a4-dbc73c5f0123") {
  return {
    studentId: "student-existing-1",
    requestId,
    fullName: "Updated Synthetic Adult",
    dateOfBirth: "2000-01-02",
    trainingCenter: "West",
    trainingTimePreferences: ["morning"],
    membershipNumber: "new 0001",
    idCardNumber: "new-id-1",
    gender: "female",
  } as const;
}

function existingMemberSeed(
  additions: Record<string, MemberDirectoryDocumentData> = {},
): Record<string, MemberDirectoryDocumentData> {
  const seeded = controlPlaneSeed();
  seeded["academies/academy-1/students/student-existing-1"] = {
    studentId: "student-existing-1",
    academyId: "academy-1",
    userId: "adult-user-1",
    fullName: "Original Synthetic Adult",
    dateOfBirth: "2000-01-02",
    phoneNumber: "+441534000099",
    email: "original@example.test",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-09-03T20:00:00.000Z",
    createdBy: "import-system",
    updatedAt: "2026-09-03T20:00:00.000Z",
    updatedBy: "import-system",
  };
  seeded["academies/academy-1/studentAdminProfiles/student-existing-1"] = {
    studentId: "student-existing-1",
    academyId: "academy-1",
    membershipNumber: "OLD 0001",
    vatNumber: "OLD-VAT-1",
    gender: "unknown",
    frequencyNote: "Original note",
    source: "member-pdf-import",
    importRunId: "import-run-1",
    schemaVersion: "1",
    createdAt: "2026-09-03T20:00:00.000Z",
    createdBy: "import-system",
    updatedAt: "2026-09-03T20:00:00.000Z",
    updatedBy: "import-system",
  };
  for (const [kind, value] of [
    ["membership-number", "OLD 0001"],
    ["vat-number", "OLD-VAT-1"],
  ] as const) {
    const key = buildStudentIdentityKey({
      academyId: "academy-1",
      kind,
      value,
      ownerStudentId: "student-existing-1",
      secretMaterial: identitySecret,
      secretVersion: "identity-v1",
      now: "2026-09-03T20:00:00.000Z",
      actorId: "import-system",
    });
    seeded[`academies/academy-1/studentIdentityKeys/${key.keyId}`] = key;
  }
  return { ...seeded, ...additions };
}

function service(firestore: MemberDirectoryFirestore) {
  return createCanonicalMemberDirectoryService({
    firestore,
    projectId: "demo-bpt-jersey",
    identitySecretMaterial: identitySecret,
    identitySecretVersion: "identity-v1",
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    generateStudentId: () => "student-new-1",
    generateAuditId: () => "audit-new-1",
  });
}

describe("canonical administrative member writer", () => {
  it("atomically replaces editable fields while preserving identity history and provenance", async () => {
    const harness = fakeFirestore(existingMemberSeed());
    const writer = service(harness.firestore);

    await expect(
      writer.updateAdminMember({ actor: actor(), value: updateInput(), now }),
    ).resolves.toEqual({ memberId: "student-existing-1", studentId: "student-existing-1" });

    expect(harness.records.get("academies/academy-1/students/student-existing-1")).toEqual({
      studentId: "student-existing-1",
      academyId: "academy-1",
      userId: "adult-user-1",
      fullName: "Updated Synthetic Adult",
      dateOfBirth: "2000-01-02",
      trainingCenter: "West",
      trainingTimePreferences: ["morning"],
      participantType: "adult",
      active: true,
      status: "active",
      schemaVersion: "1",
      createdAt: "2026-09-03T20:00:00.000Z",
      createdBy: "import-system",
      updatedAt: now,
      updatedBy: "owner-1",
    });
    expect(
      harness.records.get("academies/academy-1/studentAdminProfiles/student-existing-1"),
    ).toEqual({
      studentId: "student-existing-1",
      academyId: "academy-1",
      membershipNumber: "NEW 0001",
      idCardNumber: "NEW-ID-1",
      gender: "female",
      source: "member-pdf-import",
      importRunId: "import-run-1",
      schemaVersion: "1",
      createdAt: "2026-09-03T20:00:00.000Z",
      createdBy: "import-system",
      updatedAt: now,
      updatedBy: "owner-1",
    });
    const identityKeys = [...harness.records.entries()].filter(([path]) =>
      path.includes("/studentIdentityKeys/"),
    );
    expect(identityKeys).toHaveLength(4);
    expect(identityKeys.every(([, value]) => value.ownerStudentId === "student-existing-1")).toBe(
      true,
    );
    expect(harness.records.get("academies/academy-1/memberDirectoryStates/current")).toEqual(
      expect.objectContaining({ stateRevision: 1, rollbackEligibleStudentCount: 2 }),
    );
    expect(harness.records.get("memberDirectoryRestoreGuards/academy-1/events/1")).toEqual(
      expect.objectContaining({ transitionKind: "canonical-identity-update" }),
    );
    expect(harness.records.get("academies/academy-1/auditEvents/audit-new-1")).toEqual(
      expect.objectContaining({
        action: "member.updated",
        targetRef: "academies/academy-1/students/student-existing-1",
        purpose: "member-record-maintenance",
      }),
    );
    expect(
      [...harness.records.keys()].filter((path) => path.includes("/memberDirectoryWriteReceipts/")),
    ).toHaveLength(1);
    expect(harness.readPaths).toEqual(
      expect.arrayContaining([
        "academies/academy-1/users/owner-1",
        "academies/academy-1/adminRoleLocks/owner-1",
        "academies/academy-1/memberDirectoryStates/current",
        "memberDirectoryRestoreGuards/academy-1",
        "memberDirectoryRestoreGuards/academy-1/events/0",
      ]),
    );
    expect([...harness.records.keys()].some((path) => /\/members(?:\/|$)/u.test(path))).toBe(false);

    const writesAfterFirst = harness.committedWritePaths.length;
    await expect(
      writer.updateAdminMember({ actor: actor(), value: updateInput(), now }),
    ).resolves.toEqual({ memberId: "student-existing-1", studentId: "student-existing-1" });
    expect(harness.committedWritePaths).toHaveLength(writesAfterFirst);
    await expect(
      writer.updateAdminMember({
        actor: actor(),
        value: { ...updateInput(), fullName: "Divergent retry" },
        now,
      }),
    ).rejects.toMatchObject({ code: "replay" });
    expect(harness.committedWritePaths).toHaveLength(writesAfterFirst);
  });

  it("rejects an identifier owned by another student without partial writes", async () => {
    const conflictKey = buildStudentIdentityKey({
      academyId: "academy-1",
      kind: "membership-number",
      value: "NEW 0001",
      ownerStudentId: "student-other",
      secretMaterial: identitySecret,
      secretVersion: "identity-v1",
      now: "2026-09-03T20:00:00.000Z",
      actorId: "system-1",
    });
    const harness = fakeFirestore(
      existingMemberSeed({
        [`academies/academy-1/studentIdentityKeys/${conflictKey.keyId}`]: conflictKey,
      }),
    );

    await expect(
      service(harness.firestore).updateAdminMember({
        actor: actor(),
        value: updateInput(),
        now,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(harness.committedWritePaths).toEqual([]);
    expect(harness.records.get("academies/academy-1/students/student-existing-1")).toEqual(
      expect.objectContaining({ fullName: "Original Synthetic Adult" }),
    );
  });

  it("rejects revoked, moved or role-mutated actors and an in-flight role lock in the write transaction", async () => {
    const cases = [
      { actorDocument: provisionedAdminDocument({ active: false }) },
      { actorDocument: provisionedAdminDocument({ academyId: "academy-2" }) },
      { actorDocument: provisionedAdminDocument({ adminRole: "administrator" }) },
      {
        actorDocument: provisionedAdminDocument(),
        roleLock: { operationId: "role-change-1" },
      },
    ];

    for (const currentCase of cases) {
      const seeded = controlPlaneSeed();
      seeded["academies/academy-1/users/owner-1"] = currentCase.actorDocument;
      if (currentCase.roleLock !== undefined) {
        seeded["academies/academy-1/adminRoleLocks/owner-1"] = currentCase.roleLock;
      }
      const harness = fakeFirestore(seeded);

      await expect(
        service(harness.firestore).createAdminAdult({
          actor: actor(),
          value: input(),
          now,
        }),
      ).rejects.toMatchObject({ code: "unauthorized" });
      expect(harness.readPaths).toContain("academies/academy-1/users/owner-1");
      expect(harness.readPaths).toContain("academies/academy-1/adminRoleLocks/owner-1");
      expect(
        harness.readPaths.some(
          (path) =>
            path.includes("/students/") ||
            path.includes("/studentAdminProfiles/") ||
            path.includes("/studentIdentityKeys/"),
        ),
      ).toBe(false);
      expect(harness.committedWritePaths).toEqual([]);
    }
  });

  it("rechecks revocation before returning an exact create replay", async () => {
    const harness = fakeFirestore();
    const writer = service(harness.firestore);
    await writer.createAdminAdult({ actor: actor(), value: input(), now });
    const writesAfterFirst = harness.committedWritePaths.length;
    harness.records.set(
      "academies/academy-1/users/owner-1",
      provisionedAdminDocument({ active: false }),
    );

    await expect(
      writer.createAdminAdult({ actor: actor(), value: input(), now }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    expect(harness.committedWritePaths).toHaveLength(writesAfterFirst);
  });

  it("atomically creates the student, profile, reservations, audit and control revision", async () => {
    const harness = fakeFirestore();
    const result = await service(harness.firestore).createAdminAdult({
      actor: actor(),
      value: input(),
      now,
    });

    expect(result).toEqual({ memberId: "student-new-1", studentId: "student-new-1" });
    expect(harness.records.get("academies/academy-1/students/student-new-1")).toEqual(
      expect.objectContaining({
        studentId: "student-new-1",
        academyId: "academy-1",
        dateOfBirth: "2000-01-02",
        phoneNumber: "+441534000001",
        participantType: "adult",
        active: true,
        status: "active",
      }),
    );
    expect(harness.records.get("academies/academy-1/studentAdminProfiles/student-new-1")).toEqual(
      expect.objectContaining({
        studentId: "student-new-1",
        membershipNumber: "BPT 00001234",
        idCardNumber: "ID-1234",
        vatNumber: "VAT-1234",
        gender: "unknown",
        frequencyNote: "Twice weekly",
        emergencyContact: {
          fullName: "Synthetic Contact",
          relationship: "Spouse",
          phoneNumber: "+441534000002",
        },
        postalAddress: { line: "1 Synthetic Street, St Helier", postCode: "JE2 3AB" },
        source: "admin",
      }),
    );
    const keyPaths = [...harness.records.keys()].filter((path) =>
      path.includes("/studentIdentityKeys/"),
    );
    expect(keyPaths).toHaveLength(3);
    expect(keyPaths.join("\n")).not.toMatch(/BPT 00001234|ID-1234|VAT-1234/u);
    expect(harness.records.get("academies/academy-1/memberDirectoryStates/current")).toEqual(
      expect.objectContaining({ stateRevision: 1, rollbackEligibleStudentCount: 3 }),
    );
    expect(harness.records.get("memberDirectoryRestoreGuards/academy-1")).toEqual(
      expect.objectContaining({ highestStateRevision: 1 }),
    );
    expect(harness.records.has("memberDirectoryRestoreGuards/academy-1/events/1")).toBe(true);
    expect(
      [...harness.records.keys()].filter((path) => path.includes("/auditEvents/")),
    ).toHaveLength(1);
    const auditEvent = harness.records.get("academies/academy-1/auditEvents/audit-new-1");
    expect(auditEvent).toEqual({
      academyId: "academy-1",
      actorId: "owner-1",
      action: "member.created",
      targetRef: "academies/academy-1/students/student-new-1",
      purpose: "member-record-maintenance",
      correlationId: expect.stringMatching(/^write-[a-f0-9]{64}$/u),
      auditEventId: "audit-new-1",
      occurredAt: expect.anything(),
      result: "completed",
      schemaVersion: 1,
    });
    expect(auditEvent?.occurredAt).not.toBe(now);
    expect(
      [...harness.records.keys()].filter((path) => path.includes("/memberDirectoryWriteReceipts/")),
    ).toHaveLength(1);
    expect([...harness.records.keys()].some((path) => /\/members(?:\/|$)/u.test(path))).toBe(false);
  });

  it("returns an exact replay and rejects a divergent replay without new writes", async () => {
    const harness = fakeFirestore();
    const writer = service(harness.firestore);
    const first = await writer.createAdminAdult({ actor: actor(), value: input(), now });
    const writesAfterFirst = harness.committedWritePaths.length;

    await expect(writer.createAdminAdult({ actor: actor(), value: input(), now })).resolves.toEqual(
      first,
    );
    expect(harness.committedWritePaths).toHaveLength(writesAfterFirst);
    await expect(
      writer.createAdminAdult({
        actor: actor(),
        value: { ...input(), fullName: "Divergent Adult" },
        now,
      }),
    ).rejects.toThrow(/replay/i);
    expect(harness.committedWritePaths).toHaveLength(writesAfterFirst);
  });

  it("rejects a replay when the stored receipt actor binding is corrupted", async () => {
    const harness = fakeFirestore();
    const writer = service(harness.firestore);
    await writer.createAdminAdult({ actor: actor(), value: input(), now });
    const writesAfterFirst = harness.committedWritePaths.length;
    const receiptEntry = [...harness.records.entries()].find(([path]) =>
      path.includes("/memberDirectoryWriteReceipts/"),
    );
    expect(receiptEntry).toBeDefined();
    const [receiptPath, receipt] = receiptEntry!;
    harness.records.set(receiptPath, { ...receipt, actorId: "administrator-2" });

    await expect(
      writer.createAdminAdult({ actor: actor(), value: input(), now }),
    ).rejects.toMatchObject({ code: "replay" });
    expect(harness.committedWritePaths).toHaveLength(writesAfterFirst);
  });

  it("rejects a completed replay when one of its identity reservations is missing", async () => {
    const harness = fakeFirestore();
    const writer = service(harness.firestore);
    await writer.createAdminAdult({ actor: actor(), value: input(), now });
    const writesAfterFirst = harness.committedWritePaths.length;
    const keyPath = [...harness.records.keys()].find((path) =>
      path.includes("/studentIdentityKeys/"),
    );
    expect(keyPath).toBeDefined();
    harness.records.delete(keyPath!);

    await expect(
      writer.createAdminAdult({ actor: actor(), value: input(), now }),
    ).rejects.toMatchObject({ code: "replay" });
    expect(harness.committedWritePaths).toHaveLength(writesAfterFirst);
  });

  it("rejects a completed replay when its append-only audit binding diverges", async () => {
    const harness = fakeFirestore();
    const writer = service(harness.firestore);
    await writer.createAdminAdult({ actor: actor(), value: input(), now });
    const writesAfterFirst = harness.committedWritePaths.length;
    const auditPath = [...harness.records.keys()].find((path) => path.includes("/auditEvents/"));
    expect(auditPath).toBeDefined();
    const audit = harness.records.get(auditPath!);
    expect(audit).toBeDefined();
    harness.records.set(auditPath!, { ...audit, action: "member.updated" });

    await expect(
      writer.createAdminAdult({ actor: actor(), value: input(), now }),
    ).rejects.toMatchObject({ code: "replay" });
    expect(harness.committedWritePaths).toHaveLength(writesAfterFirst);
  });

  it("fails closed before domain writes when state, auth or App Check is invalid", async () => {
    const noStateSeed = controlPlaneSeed();
    delete noStateSeed["academies/academy-1/memberDirectoryStates/current"];
    const noState = fakeFirestore(noStateSeed);
    await expect(
      service(noState.firestore).createAdminAdult({ actor: actor(), value: input(), now }),
    ).rejects.toThrow(/state/i);
    expect(noState.committedWritePaths).toHaveLength(0);

    const unauthorized = fakeFirestore();
    await expect(
      service(unauthorized.firestore).createAdminAdult({
        actor: { ...actor(), role: "coach", appCheckVerified: false },
        value: input(),
        now,
      }),
    ).rejects.toThrow(/authorized|app check/i);
    expect(unauthorized.readPaths).toHaveLength(0);
    expect(unauthorized.committedWritePaths).toHaveLength(0);
  });

  it("allows exactly one owner for a reserved identifier and leaves no partial commit", async () => {
    const conflictKey = buildStudentIdentityKey({
      academyId: "academy-1",
      kind: "membership-number",
      value: "BPT 00001234",
      ownerStudentId: "student-existing",
      secretMaterial: identitySecret,
      secretVersion: "identity-v1",
      now: "2026-09-03T20:00:00.000Z",
      actorId: "system-1",
    });
    const seeded = controlPlaneSeed();
    seeded[`academies/academy-1/studentIdentityKeys/${conflictKey.keyId}`] = conflictKey;
    const conflict = fakeFirestore(seeded);
    await expect(
      service(conflict.firestore).createAdminAdult({ actor: actor(), value: input(), now }),
    ).rejects.toThrow(/reserved|conflict/i);
    expect(conflict.committedWritePaths).toHaveLength(0);
    expect(conflict.records.has("academies/academy-1/students/student-new-1")).toBe(false);

    const failedCommit = fakeFirestore(controlPlaneSeed(), (paths) =>
      paths.some((path) => path.includes("/studentAdminProfiles/")),
    );
    await expect(
      service(failedCommit.firestore).createAdminAdult({ actor: actor(), value: input(), now }),
    ).rejects.toThrow(/synthetic commit failure/i);
    expect(failedCommit.committedWritePaths).toHaveLength(0);
    expect(failedCommit.records).toEqual(new Map(Object.entries(controlPlaneSeed())));
  });
});
