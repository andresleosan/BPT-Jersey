import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import {
  createCanonicalMemberDirectoryService,
  type MemberDirectoryDocumentData,
  type MemberDirectoryFirestore,
} from "./canonical-member-directory-service.js";
import {
  buildStudentIdentityKey,
  createMemberDirectoryIntegrityMac,
  deriveStudentIdentityKeyId,
} from "./member-directory-crypto.js";
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
  let auditNumber = 0;
  return createCanonicalMemberDirectoryService({
    firestore,
    projectId: "demo-bpt-jersey",
    identitySecretMaterial: identitySecret,
    identitySecretVersion: "identity-v1",
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    generateStudentId: () => "student-new-1",
    generateAuditId: () => `audit-new-${++auditNumber}`,
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

describe("canonical member directory writer, linked to an account (T122)", () => {
  function service(store: ReturnType<typeof fakeFirestore>) {
    return createCanonicalMemberDirectoryService({
      firestore: store.firestore,
      projectId: "demo-bpt-jersey",
      identitySecretMaterial: identitySecret,
      identitySecretVersion: "identity-v1",
      integritySecretMaterial: integritySecret,
      integritySecretVersion: "integrity-v1",
      generateStudentId: () => "student-linked-1",
      generateAuditId: () => "audit-linked-1",
    });
  }

  const account = {
    userId: "member-uid-1",
    displayName: "Synthetic Adult",
    email: "Adult@Example.test",
  } as const;

  it("replays an enrolment across reviewers while checking the current reviewer's authority", async () => {
    const store = fakeFirestore();
    store.records.set(
      "academies/academy-1/users/owner-2",
      provisionedAdminDocument({ userId: "owner-2" }),
    );
    const command = {
      actor: actor(),
      value: input(),
      account,
      now,
      enrolmentRequestId: "enrolment-synthetic",
    };
    const result = await service(store).createAdminAdultForAccount(command);
    const count = store.records.size;
    const other = { ...command, actor: { ...actor(), actorId: "owner-2" } };
    expect(await service(store).createAdminAdultForAccount(other)).toEqual(result);
    expect(store.records.size).toBe(count);
    store.records.delete("academies/academy-1/users/owner-2");
    await expect(service(store).createAdminAdultForAccount(other)).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("writes the member and their account as one record", async () => {
    const store = fakeFirestore();

    const result = await service(store).createAdminAdultForAccount({
      actor: actor(),
      value: input(),
      account,
      now,
    });

    expect(result).toEqual({ memberId: "student-linked-1", studentId: "student-linked-1" });

    const student = store.records.get("academies/academy-1/students/student-linked-1");
    expect(student).toMatchObject({ userId: "member-uid-1" });
    const familyId = (student as { familyId: string }).familyId;
    expect(familyId.startsWith("adult-")).toBe(true);

    // The three documents the administrative create never wrote.
    expect(store.records.get(`academies/academy-1/families/${familyId}`)).toMatchObject({
      primaryContactUserId: "member-uid-1",
      billingContactUserId: "member-uid-1",
      status: "active",
    });
    expect(store.records.get("academies/academy-1/users/member-uid-1")).toMatchObject({
      accountType: "client",
      displayName: "Synthetic Adult",
      email: "adult@example.test",
      phoneNumber: "+441534000001",
    });

    // And the administrative half is still there.
    expect(
      store.records.get("academies/academy-1/studentAdminProfiles/student-linked-1"),
    ).toMatchObject({ source: "admin", gender: "unknown" });
  });

  it("reserves the identity the self-service profile looks for, which is the whole point", async () => {
    // Without this reservation the member signs in, /account/profile queries students by userId,
    // finds nothing, and mints a second student for the same person.
    const store = fakeFirestore();

    await service(store).createAdminAdultForAccount({
      actor: actor(),
      value: input(),
      account,
      now,
    });

    const keyId = deriveStudentIdentityKeyId({
      academyId: "academy-1",
      kind: "auth-user-id",
      value: "member-uid-1",
      secretMaterial: identitySecret,
    });
    expect(store.records.get(`academies/academy-1/studentIdentityKeys/${keyId}`)).toMatchObject({
      kind: "auth-user-id",
      ownerStudentId: "student-linked-1",
    });
  });

  it("advances the control plane as an account link, not as a plain create", async () => {
    const store = fakeFirestore();

    await service(store).createAdminAdultForAccount({
      actor: actor(),
      value: input(),
      account,
      now,
    });

    expect(store.records.get("memberDirectoryRestoreGuards/academy-1/events/1")).toMatchObject({
      transitionKind: "adult-auth-link",
    });
  });

  it("refuses to link an enrolment with no phone number", async () => {
    const store = fakeFirestore();
    const withoutPhone = Object.fromEntries(
      Object.entries(input()).filter(([key]) => key !== "phoneNumber"),
    );

    await expect(
      service(store).createAdminAdultForAccount({
        actor: actor(),
        value: withoutPhone,
        account,
        now,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(store.committedWritePaths).toHaveLength(0);
  });

  it("refuses an account that already holds part of a member record", async () => {
    // The family id is derived from the account, so the collision has to be tested against the
    // real derived id - seeding an arbitrary family proves nothing.
    const familyId =
      "adult-" +
      createMemberDirectoryIntegrityMac({
        domain: "bpt-adult-family-identity-v1",
        values: ["academy-1", "member-uid-1"],
        secretMaterial: integritySecret,
      });

    for (const seeded of [
      { "academies/academy-1/users/member-uid-1": { accountType: "client" } },
      { [`academies/academy-1/families/${familyId}`]: { familyId } },
    ]) {
      const store = fakeFirestore({ ...controlPlaneSeed(), ...seeded });

      await expect(
        service(store).createAdminAdultForAccount({
          actor: actor(),
          value: input(),
          account,
          now,
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(store.committedWritePaths).toHaveLength(0);
    }
  });

  it("leaves the unlinked administrative create exactly as it was", async () => {
    const store = fakeFirestore();

    await service(store).createAdminAdult({ actor: actor(), value: input(), now });

    const student = store.records.get("academies/academy-1/students/student-linked-1");
    expect(student).not.toHaveProperty("userId");
    expect(student).toHaveProperty("familyId", "office-student-linked-1");
    expect(store.records.get("academies/academy-1/families/office-student-linked-1")).toMatchObject(
      { primaryContactUserId: null, billingContactUserId: null, active: true },
    );
    expect(store.records.has("academies/academy-1/users/member-uid-1")).toBe(false);
    expect(store.records.get("memberDirectoryRestoreGuards/academy-1/events/1")).toMatchObject({
      transitionKind: "canonical-identity-create",
    });
  });
});

describe("DETAILS block on the canonical update (T051V2)", () => {
  // Three saves in a row need three audit ids; the shared helper mints a fixed one.
  function service(firestore: MemberDirectoryFirestore) {
    let auditSequence = 0;
    return createCanonicalMemberDirectoryService({
      firestore,
      projectId: "demo-bpt-jersey",
      identitySecretMaterial: identitySecret,
      identitySecretVersion: "identity-v1",
      integritySecretMaterial: integritySecret,
      integritySecretVersion: "integrity-v1",
      generateStudentId: () => "student-new-1",
      generateAuditId: () => `audit-details-${++auditSequence}`,
    });
  }

  const profilePath = "academies/academy-1/studentAdminProfiles/student-existing-1";
  const details = { profession: "Tester", heightCm: 175, howHeard: "Website" } as const;

  it("replaces the details block when sent and keeps it when omitted", async () => {
    const harness = fakeFirestore(existingMemberSeed());
    const writer = service(harness.firestore);

    await writer.updateAdminMember({
      actor: actor(),
      value: { ...updateInput("11111111-1111-4111-8111-111111111111"), details },
      now,
    });
    expect(harness.records.get(profilePath)).toEqual(expect.objectContaining({ details }));

    await writer.updateAdminMember({
      actor: actor(),
      value: updateInput("22222222-2222-4222-8222-222222222222"),
      now,
    });
    expect(harness.records.get(profilePath)).toEqual(expect.objectContaining({ details }));

    await writer.updateAdminMember({
      actor: actor(),
      value: { ...updateInput("33333333-3333-4333-8333-333333333333"), details: {} },
      now,
    });
    expect(Object.hasOwn(harness.records.get(profilePath) ?? {}, "details")).toBe(false);
  });

  it("replays a details save exactly once", async () => {
    const harness = fakeFirestore(existingMemberSeed());
    const writer = service(harness.firestore);
    const value = { ...updateInput("44444444-4444-4444-8444-444444444444"), details };
    await writer.updateAdminMember({ actor: actor(), value, now });
    const writes = harness.committedWritePaths.length;
    await expect(writer.updateAdminMember({ actor: actor(), value, now })).resolves.toEqual({
      memberId: "student-existing-1",
      studentId: "student-existing-1",
    });
    expect(harness.committedWritePaths).toHaveLength(writes);
  });

  it("refuses a member number reserved by another student and writes no details", async () => {
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
        value: { ...updateInput(), details },
        now,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(harness.committedWritePaths).toEqual([]);
    expect(Object.hasOwn(harness.records.get(profilePath) ?? {}, "details")).toBe(false);
  });

  it("creates an admin profile for a member who has none", async () => {
    const seeded = existingMemberSeed();
    delete seeded[profilePath];
    for (const path of Object.keys(seeded)) {
      if (path.includes("/studentIdentityKeys/")) delete seeded[path];
    }
    const harness = fakeFirestore(seeded);

    // An explicit payload without identifiers: spreading `updateInput()` and overriding with
    // `undefined` would leave keys whose value is undefined, which `isPlainData` refuses.
    await service(harness.firestore).updateAdminMember({
      actor: actor(),
      value: {
        studentId: "student-existing-1",
        requestId: "55555555-5555-4555-8555-555555555555",
        fullName: "Updated Synthetic Adult",
        dateOfBirth: "2000-01-02",
        trainingCenter: "West",
        trainingTimePreferences: ["morning"],
        gender: "female",
        details,
      },
      now,
    });

    expect(harness.records.get(profilePath)).toEqual({
      studentId: "student-existing-1",
      academyId: "academy-1",
      gender: "female",
      details,
      source: "admin",
      schemaVersion: "1",
      createdAt: now,
      createdBy: "owner-1",
      updatedAt: now,
      updatedBy: "owner-1",
    });
  });

  it("refuses a recommender that does not exist or belongs to another academy", async () => {
    // The domain can only refuse a self-recommendation, so proving the recommender is a real
    // student of this academy is the writer's job.
    const otherAcademyStudent = {
      ...(existingMemberSeed()["academies/academy-1/students/student-existing-1"] as Record<
        string,
        unknown
      >),
      studentId: "student-other-1",
      academyId: "academy-2",
    } as MemberDirectoryDocumentData;

    for (const seeded of [
      {},
      { "academies/academy-1/students/student-other-1": otherAcademyStudent },
    ]) {
      const harness = fakeFirestore(existingMemberSeed(seeded));

      await expect(
        service(harness.firestore).updateAdminMember({
          actor: actor(),
          value: {
            ...updateInput("66666666-6666-4666-8666-666666666666"),
            details: { ...details, recommendedByStudentId: "student-other-1" },
          },
          now,
        }),
      ).rejects.toMatchObject({ code: "invalid" });
      expect(harness.committedWritePaths).toEqual([]);
    }
  });

  it("keeps saving a member whose stored recommender has since left, unless details are sent", async () => {
    // The recommender check covers what is being written. Re-checking the kept block would break
    // unrelated saves (phone, gender) the day that recommender is deleted or moved academy.
    const seeded = existingMemberSeed();
    const storedProfilePath = profilePath;
    seeded[storedProfilePath] = {
      ...(seeded[storedProfilePath] as Record<string, unknown>),
      details: { recommendedByStudentId: "student-gone-1" },
    } as MemberDirectoryDocumentData;
    const harness = fakeFirestore(seeded);
    const writer = service(harness.firestore);

    await expect(
      writer.updateAdminMember({
        actor: actor(),
        value: updateInput("88888888-8888-4888-8888-888888888888"),
        now,
      }),
    ).resolves.toEqual({ memberId: "student-existing-1", studentId: "student-existing-1" });
    expect(harness.records.get(storedProfilePath)).toEqual(
      expect.objectContaining({ details: { recommendedByStudentId: "student-gone-1" } }),
    );

    await expect(
      writer.updateAdminMember({
        actor: actor(),
        value: {
          ...updateInput("99999999-9999-4999-8999-999999999999"),
          details: { recommendedByStudentId: "student-gone-1" },
        },
        now,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("stores notes typed in a browser textarea with their line breaks normalised", async () => {
    // A textarea submits CRLF, and a stored carriage return is a control character the profile
    // schema refuses - so the input schema normalises it instead of failing the whole save.
    const harness = fakeFirestore(existingMemberSeed());

    await service(harness.firestore).updateAdminMember({
      actor: actor(),
      value: {
        ...updateInput("77777777-7777-4777-8777-777777777777"),
        details: { internalNotes: "First line\r\nSecond line" },
      },
      now,
    });

    expect(harness.records.get(profilePath)).toEqual(
      expect.objectContaining({ details: { internalNotes: "First line\nSecond line" } }),
    );
  });
});

describe("legacy member migration", () => {
  const migrationNow = "2026-09-19T10:00:00.000Z";
  const decisionPath = "academies/academy-1/memberMigrationDecisions/legacyAbc1";
  const legacy = {
    legacyMemberId: "legacyAbc1",
    trainingCenter: "Town" as const,
    trainingTimePreferences: ["evening" as const],
  };

  it("creates the student with a legacy-member-migration profile, a legacy key and the decision", async () => {
    const harness = fakeFirestore(controlPlaneSeed());
    const result = await service(harness.firestore).registerLegacyMember({
      actor: actor(),
      value: input(),
      now: migrationNow,
      ...legacy,
    });
    expect(
      harness.records.get(`academies/academy-1/studentAdminProfiles/${result.studentId}`),
    ).toMatchObject({
      source: "legacy-member-migration",
      migrationId: "member-unification-s1-2026-09",
      legacyMemberId: "LEGACYABC1",
    });
    expect(harness.records.get(decisionPath)).toEqual({
      legacyMemberId: "legacyAbc1",
      academyId: "academy-1",
      kind: "create-unlinked",
      studentId: result.studentId,
      migrationId: "member-unification-s1-2026-09",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
      decidedAt: migrationNow,
      decidedBy: "owner-1",
      schemaVersion: "1",
    });
    const legacyKeys = [...harness.records.entries()].filter(([path]) =>
      path.includes("/studentIdentityKeys/legacy-member-id:"),
    );
    expect(legacyKeys).toHaveLength(1);
    expect(legacyKeys[0]?.[1]).toMatchObject({
      kind: "legacy-member-id",
      ownerStudentId: result.studentId,
    });
    expect(harness.records.get(`academies/academy-1/students/${result.studentId}`)).toMatchObject({
      participantType: "adult",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
    });
  });

  it("refuses receipt replay for a different legacy member", async () => {
    const harness = fakeFirestore(controlPlaneSeed());
    const writer = service(harness.firestore);
    const command = { actor: actor(), value: input("request-1"), now: migrationNow, ...legacy };
    await writer.registerLegacyMember(command);
    const before = new Map(harness.records);

    await expect(
      writer.registerLegacyMember({
        ...command,
        legacyMemberId: "legacyXyz",
        value: input("request-1"),
      }),
    ).rejects.toMatchObject({ code: "replay", message: "Divergent member write replay" });
    expect(harness.records.has("academies/academy-1/memberMigrationDecisions/legacyXyz")).toBe(
      false,
    );
    expect(harness.records).toEqual(before);
  });

  it("refuses a second decision for the same legacy member", async () => {
    const harness = fakeFirestore(controlPlaneSeed());
    const writer = service(harness.firestore);
    const command = { actor: actor(), value: input("request-1"), now: migrationNow, ...legacy };
    await writer.registerLegacyMember(command);
    const before = new Map(harness.records);
    await expect(
      writer.skipLegacyMember({
        actor: actor(),
        legacyMemberId: "legacyAbc1",
        reason: "Duplicate",
        now: "2026-09-19T10:01:00.000Z",
      }),
    ).rejects.toThrow("Legacy member already decided");
    await expect(writer.registerLegacyMember(command)).rejects.toThrow(
      "Legacy member already decided",
    );
    expect(harness.records).toEqual(before);
  });

  it.each(["2012-01-01", undefined])(
    "creates a reviewable student with DOB %s and no family",
    async (dateOfBirth) => {
      const harness = fakeFirestore(controlPlaneSeed());
      await service(harness.firestore).registerLegacyMember({
        actor: actor(),
        value: { ...input(), dateOfBirth },
        now: migrationNow,
        ...legacy,
      });
      const student = harness.records.get("academies/academy-1/students/student-new-1");
      expect(student).toMatchObject(
        dateOfBirth
          ? { guardianStatus: "pending", participantType: "minor", dateOfBirth }
          : { reviewReason: "date-of-birth-missing", participantType: "minor" },
      );
      expect(student).not.toHaveProperty("familyId");
      expect(student).not.toHaveProperty("userId");
      if (!dateOfBirth) expect(student).not.toHaveProperty("dateOfBirth");
      expect(
        [...harness.records.keys()].filter(
          (path) => path.includes("/families/") || path.includes("/relationships/"),
        ),
      ).toEqual([]);
    },
  );

  it("skips with a decision and an audit event, and writes no student", async () => {
    const harness = fakeFirestore(controlPlaneSeed());
    await service(harness.firestore).skipLegacyMember({
      actor: actor(),
      legacyMemberId: "legacyAbc1",
      reason: "  Left in 2024  ",
      now: migrationNow,
    });
    expect(harness.records.get(decisionPath)).toEqual({
      legacyMemberId: "legacyAbc1",
      academyId: "academy-1",
      migrationId: "member-unification-s1-2026-09",
      kind: "skip",
      reason: "Left in 2024",
      decidedAt: migrationNow,
      decidedBy: "owner-1",
      schemaVersion: "1",
    });
    const auditEvents = [...harness.records.entries()].filter(([path]) =>
      path.includes("/auditEvents/"),
    );
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]?.[1]).toMatchObject({
      academyId: "academy-1",
      actorId: "owner-1",
      action: "member.migration.skipped",
      targetRef: decisionPath,
      purpose: "member-record-maintenance",
      correlationId: "member-unification-s1-2026-09:legacyAbc1",
    });
    expect(harness.committedWritePaths).toHaveLength(2);
    expect([...harness.records.keys()].some((path) => path.includes("/students/"))).toBe(false);
  });
});

describe("office registration of imported members", () => {
  it.each(["2000-01-02", "2015-01-02"])(
    "registers birth date %s without inventing online access and replays by source",
    async (dateOfBirth) => {
      const h = fakeFirestore();
      const value = { ...input(), dateOfBirth };
      h.records.set("academies/academy-1/regyfitMemberRecords/161", {
        academyId: "academy-1",
        recordId: "161",
        memberNumber: value.membershipNumber,
        fullName: value.fullName,
        birthDate: dateOfBirth,
        gender: "unknown",
        membershipState: "active",
        appAccess: {},
        graduation: {},
        plan: {},
        attendance: { records: [] },
        payments: [],
        capturedAt: now,
        source: "regyfit-admin-capture",
        schemaVersion: "1",
      });
      const writer = service(h.firestore);
      const result = await writer.registerImportedMember({
        actor: actor(),
        value,
        now,
        recordId: "161",
      });
      expect(
        h.records.get("academies/academy-1/students/" + result.studentId)?.userId,
      ).toBeUndefined();
      expect(
        h.records.get("academies/academy-1/students/" + result.studentId)?.participantType,
      ).toBe(dateOfBirth.startsWith("2015") ? "minor" : "adult");
      expect(
        h.records.get("academies/academy-1/families/office-" + result.studentId)
          ?.primaryContactUserId,
      ).toBeNull();
      expect(h.records.get("academies/academy-1/regyfitOfficeLinks/161")?.studentId).toBe(
        result.studentId,
      );
      const before = h.records.size;
      expect(
        await writer.registerImportedMember({
          actor: actor(),
          value: { ...value, requestId: "different-retry" },
          now,
          recordId: "161",
        }),
      ).toEqual(result);
      expect(h.records.size).toBe(before);
    },
  );
  it("rejects tampered source identity before committing any writes", async () => {
    const h = fakeFirestore();
    const before = new Map(h.records);
    await expect(
      service(h.firestore).registerImportedMember({
        actor: actor(),
        value: input(),
        now,
        recordId: "161",
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(h.records).toEqual(before);
  });
});

describe("S1 admin review", () => {
  const studentPath = "academies/academy-1/students/student-new-1";
  const familyPath = "academies/academy-1/families/office-student-new-1";
  const guardian = { fullName: "Synthetic Guardian", email: "guardian@example.test" };
  const assign = {
    kind: "assign-guardian",
    studentId: "student-new-1",
    requestId: "71cbb1aa-7020-4bb5-88a4-dbc73c5f0123",
    guardianContact: guardian,
  };
  async function migrated(dateOfBirth: string | null = "2012-01-01") {
    const harness = fakeFirestore();
    const writer = service(harness.firestore);
    await writer.registerLegacyMember({
      actor: actor(),
      now,
      value: { ...input(), dateOfBirth: dateOfBirth ?? undefined },
      legacyMemberId: "legacy-1",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
    });
    return { harness, writer };
  }
  it.each(["1990-01-01", "2012-01-01"])(
    "journals the office family only in the receipt that creates it for DOB %s",
    async (dateOfBirth) => {
      const { harness, writer } = await migrated(dateOfBirth);
      const receipts = () =>
        [...harness.records.entries()]
          .filter(([path]) => path.includes("/memberDirectoryWriteReceipts/"))
          .map(([, record]) => record);
      if (dateOfBirth === "2012-01-01") {
        expect(receipts().every((receipt) => receipt.createdFamilyId === undefined)).toBe(true);
        await writer.reviewMember({ actor: actor(), now, value: assign });
      }
      expect(
        receipts().filter((receipt) => receipt.createdFamilyId === "office-student-new-1"),
      ).toHaveLength(1);
    },
  );
  it("assigns an office contact atomically and replays without duplicate writes or PII in audit", async () => {
    const { harness, writer } = await migrated();
    const command = { actor: actor(), now, value: assign };
    await expect(writer.reviewMember(command)).resolves.toEqual({ studentId: "student-new-1" });
    expect(harness.records.get(studentPath)).toMatchObject({
      guardianStatus: "assigned",
      familyId: "office-student-new-1",
    });
    expect(harness.records.get(familyPath)).toMatchObject({
      primaryContactUserId: null,
      billingContactUserId: null,
      guardianContact: guardian,
    });
    expect([...harness.records.keys()].some((path) => path.includes("/relationships/"))).toBe(
      false,
    );
    const before = new Map(harness.records);
    await writer.reviewMember(command);
    expect(harness.records).toEqual(before);
    const audits = [...harness.records.entries()].filter(([path]) =>
      path.includes("/auditEvents/"),
    );
    expect(audits.some(([, event]) => event.action === "member.guardian.assigned")).toBe(true);
    expect(JSON.stringify(audits)).not.toContain(guardian.email);
    await expect(
      writer.reviewMember({
        ...command,
        value: { ...assign, guardianContact: { ...guardian, fullName: "Different" } },
      }),
    ).rejects.toMatchObject({ code: "replay" });
    expect(harness.records).toEqual(before);
  });
  it.each(["owner", "administrator"] as const)("allows active %s", async (role) => {
    const { harness, writer } = await migrated();
    harness.records.set(
      "academies/academy-1/users/owner-1",
      provisionedAdminDocument({ adminRole: role }),
    );
    await expect(
      writer.reviewMember({ actor: { ...actor(), role }, now, value: assign }),
    ).resolves.toEqual({ studentId: "student-new-1" });
  });
  it.each(["coach", "headCoach", "guardian", "adultStudent"] as const)(
    "denies %s before writing",
    async (role) => {
      const { harness, writer } = await migrated();
      const before = new Map(harness.records);
      await expect(
        writer.reviewMember({ actor: { ...actor(), role }, now, value: assign }),
      ).rejects.toMatchObject({ code: "unauthorized" });
      expect(harness.records).toEqual(before);
    },
  );
  it.each([{ active: false }, { appCheckVerified: false }, { academyId: "other-academy" }])(
    "denies invalid actor %s",
    async (overrides) => {
      const { harness, writer } = await migrated();
      const before = new Map(harness.records);
      await expect(
        writer.reviewMember({ actor: { ...actor(), ...overrides }, now, value: assign }),
      ).rejects.toThrow();
      expect(harness.records).toEqual(before);
    },
  );
  it("refuses a pre-existing family and a second assignment request", async () => {
    const { harness, writer } = await migrated();
    harness.records.set(familyPath, { unrelated: true });
    await expect(writer.reviewMember({ actor: actor(), now, value: assign })).rejects.toMatchObject(
      { code: "conflict" },
    );
    harness.records.delete(familyPath);
    await writer.reviewMember({ actor: actor(), now, value: assign });
    await expect(
      writer.reviewMember({
        actor: actor(),
        now,
        value: { ...assign, requestId: "81cbb1aa-7020-4bb5-88a4-dbc73c5f0123" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it.each(["1990-01-01", "2012-01-01"])(
    "resolves unknown age to %s and replays",
    async (dateOfBirth) => {
      const { harness, writer } = await migrated(null);
      const command = {
        actor: actor(),
        now,
        value: {
          kind: "set-date-of-birth",
          studentId: "student-new-1",
          requestId: assign.requestId,
          dateOfBirth,
        },
      };
      await writer.reviewMember(command);
      const student = harness.records.get(studentPath);
      expect(student).toMatchObject({
        dateOfBirth,
        participantType: dateOfBirth.startsWith("1990") ? "adult" : "minor",
      });
      expect(student).not.toHaveProperty("reviewReason");
      if (dateOfBirth.startsWith("2012")) expect(student?.guardianStatus).toBe("pending");
      else expect(student).not.toHaveProperty("guardianStatus");
      const before = new Map(harness.records);
      await writer.reviewMember(command);
      expect(harness.records).toEqual(before);
    },
  );
  it.each(["review", "editor"] as const)(
    "marks adult-to-minor correction pending via %s and completes the existing office family",
    async (path) => {
      const { harness, writer } = await migrated("1990-01-01");
      const originalFamily = harness.records.get(familyPath);
      const value = {
        studentId: assign.studentId,
        requestId: "91cbb1aa-7020-4bb5-88a4-dbc73c5f0123",
        dateOfBirth: "2012-01-01",
      };
      if (path === "review") {
        await writer.reviewMember({
          actor: actor(),
          now,
          value: { ...value, kind: "set-date-of-birth" },
        });
      } else {
        await writer.updateAdminMember({
          actor: actor(),
          now,
          value: { ...updateInput(), ...value },
        });
      }
      expect(harness.records.get(studentPath)).toMatchObject({
        participantType: "minor",
        guardianStatus: "pending",
        familyId: "office-student-new-1",
      });
      const command = { actor: actor(), now, value: assign };
      await writer.reviewMember(command);
      expect(harness.records.get(familyPath)).toEqual({
        ...originalFamily,
        guardianContact: guardian,
      });
      expect(harness.records.get(studentPath)).toMatchObject({ guardianStatus: "assigned" });
      const before = new Map(harness.records);
      await writer.reviewMember(command);
      expect(harness.records).toEqual(before);
    },
  );

  it("rejects invalid contacts, tenant overrides and future dates", async () => {
    const { harness, writer } = await migrated();
    const before = new Map(harness.records);
    for (const value of [
      { ...assign, guardianContact: { fullName: "No contact" } },
      { ...assign, academyId: "other" },
      { ...assign, guardianContact: { fullName: "Test", email: "invalid" } },
      {
        kind: "set-date-of-birth",
        studentId: assign.studentId,
        requestId: assign.requestId,
        dateOfBirth: "2099-01-01",
      },
    ]) {
      await expect(writer.reviewMember({ actor: actor(), now, value })).rejects.toMatchObject({
        code: "invalid",
      });
    }
    expect(harness.records).toEqual(before);
  });
});
