import { describe, expect, it } from "vitest";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import {
  createCanonicalMemberDirectoryReadService,
  type CanonicalDirectoryReadStore,
  type DirectoryReadDocument,
} from "./canonical-member-directory-read-service.js";
import {
  buildStudentIdentityKey,
  canonicalizeMemberDirectoryValue,
  createMemberDirectoryIntegrityMac,
} from "./member-directory-crypto.js";

const identitySecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const cursorSecret = "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8";
const now = "2026-09-03T20:01:00.000Z";

function state(): MemberDirectoryState {
  return {
    stateId: "current",
    academyId: "academy-1",
    readerVersion: "canonical-v1",
    directoryWriteMode: "canonical-v1",
    freezeStatus: "open",
    stateRevision: 4,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "complete",
    digestVersion: "hmac-sha256-v1",
    secretVersion: "identity-v1",
    identityKeyBaselineMac: "a".repeat(64),
    identityKeyBaselineArtifactId: "baseline-1",
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: 3,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: "2026-09-03T20:00:00.000Z",
    createdBy: "system-1",
    updatedAt: "2026-09-03T20:00:00.000Z",
    updatedBy: "system-1",
  };
}

function student(studentId: string, fullName: string) {
  return {
    studentId,
    academyId: "academy-1",
    fullName,
    dateOfBirth: "2000-01-02",
    phoneNumber: "+441534000001",
    email: `${studentId}@example.test`,
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-09-03T20:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-09-03T20:00:00.000Z",
    updatedBy: "owner-1",
  } as const;
}

function profile(studentId: string, membershipNumber: string) {
  return {
    studentId,
    academyId: "academy-1",
    membershipNumber,
    idCardNumber: `ID-${studentId.toUpperCase()}`,
    vatNumber: `VAT-${studentId.toUpperCase()}`,
    gender: "unknown",
    frequencyNote: "Twice weekly",
    source: "admin",
    schemaVersion: "1",
    createdAt: "2026-09-03T20:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-09-03T20:00:00.000Z",
    updatedBy: "owner-1",
  } as const;
}

function provisionedAdminDocument(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
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

function seed(): Record<string, Readonly<Record<string, unknown>>> {
  return {
    "academies/academy-1/memberDirectoryStates/current": state(),
    "academies/academy-1/users/owner-1": provisionedAdminDocument(),
    "academies/academy-1/students/student-1": student("student-1", "Alpha Student"),
    "academies/academy-1/students/student-2": student("student-2", "Beta Student"),
    "academies/academy-1/students/student-3": student("student-3", "Gamma Student"),
    "academies/academy-1/studentAdminProfiles/student-1": profile("student-1", "BPT 00000001"),
    "academies/academy-1/studentAdminProfiles/student-2": profile("student-2", "BPT 00000002"),
    "academies/academy-1/studentAdminProfiles/student-3": profile("student-3", "BPT 00000003"),
  };
}

function fakeStore(initial = seed()) {
  const records = new Map(Object.entries(initial));
  const readPaths: string[] = [];
  const listCalls: Array<{ afterDocumentId?: string; limit: number }> = [];
  const writePaths: string[] = [];
  const createPaths: string[] = [];
  const setPaths: string[] = [];
  let transactions = 0;
  const store: CanonicalDirectoryReadStore = {
    runTransaction: async (callback) => {
      transactions += 1;
      const staged = new Map<string, Readonly<Record<string, unknown>>>();
      const creates = new Set<string>();
      const transaction = {
        get: async (path: string): Promise<DirectoryReadDocument> => {
          readPaths.push(path);
          const data = records.get(path);
          return { id: path.split("/").at(-1) ?? "", exists: data !== undefined, data };
        },
        listStudents: async (input: {
          academyId: string;
          afterDocumentId?: string;
          limit: number;
        }): Promise<readonly DirectoryReadDocument[]> => {
          listCalls.push(
            input.afterDocumentId === undefined
              ? { limit: input.limit }
              : { afterDocumentId: input.afterDocumentId, limit: input.limit },
          );
          const prefix = `academies/${input.academyId}/students/`;
          return [...records.entries()]
            .filter(([path]) => path.startsWith(prefix))
            .map(([path, data]) => ({ id: path.slice(prefix.length), exists: true, data }))
            .filter((document) =>
              input.afterDocumentId === undefined ? true : document.id > input.afterDocumentId,
            )
            .sort((left, right) => left.id.localeCompare(right.id))
            .slice(0, input.limit);
        },
        create: (path: string, data: Readonly<Record<string, unknown>>) => {
          if (records.has(path) || staged.has(path)) throw new Error("already exists");
          creates.add(path);
          staged.set(path, data);
        },
        set: (path: string, data: Readonly<Record<string, unknown>>) => {
          staged.set(path, data);
        },
      };
      const result = await callback(transaction);
      for (const [path, data] of staged) {
        if (creates.has(path) && records.has(path)) throw new Error("already exists");
        records.set(path, data);
        writePaths.push(path);
        (creates.has(path) ? createPaths : setPaths).push(path);
      }
      return result;
    },
  };
  return {
    store,
    records,
    readPaths,
    listCalls,
    writePaths,
    createPaths,
    setPaths,
    get transactions() {
      return transactions;
    },
  };
}

function actor(actorId = "owner-1") {
  return {
    actorId,
    academyId: "academy-1",
    role: "owner" as const,
    active: true,
    appCheckVerified: true,
  };
}

function service(store: CanonicalDirectoryReadStore) {
  let auditId = 0;
  return createCanonicalMemberDirectoryReadService({
    store,
    identitySecretMaterial: identitySecret,
    identitySecretVersion: "identity-v1",
    cursorSecretMaterial: cursorSecret,
    cursorSecretVersion: "cursor-v1",
    generateAuditId: () => `restricted-audit-${++auditId}`,
  });
}

function resignCursor(
  cursor: string,
  mutate: (payload: Record<string, unknown>) => Record<string, unknown>,
): string {
  const [payloadSegment] = cursor.split(".");
  if (payloadSegment === undefined) throw new Error("Missing cursor payload");
  const decoded = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
  const nextSegment = Buffer.from(
    canonicalizeMemberDirectoryValue(mutate(decoded)),
    "utf8",
  ).toString("base64url");
  const mac = createMemberDirectoryIntegrityMac({
    domain: "bpt-member-directory-cursor-v1",
    values: [nextSegment],
    secretMaterial: cursorSecret,
  });
  return `${nextSegment}.${mac}`;
}

describe("canonical administrative directory reads", () => {
  it("pages students with limit+1 and returns only the minimized projection", async () => {
    const harness = fakeStore();
    const reader = service(harness.store);
    const first = await reader.list({ actor: actor(), value: { pageSize: 2 }, now });

    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(harness.listCalls).toEqual([{ limit: 3 }]);
    expect(first.rows[0]).toEqual({
      studentId: "student-1",
      fullName: "Alpha Student",
      trainingCenter: "Town",
      participantType: "adult",
      active: true,
      status: "active",
      membershipReference: "****0001",
    });
    expect(JSON.stringify(first)).not.toMatch(/dateOfBirth|email|phone|idCard|vatNumber|gender/u);

    const second = await reader.list({
      actor: actor(),
      value: { pageSize: 2, cursor: first.nextCursor },
      now,
    });
    expect(second.rows.map((row) => row.studentId)).toEqual(["student-3"]);
    expect(second.nextCursor).toBeUndefined();
    expect(harness.listCalls[1]).toEqual({ afterDocumentId: "student-2", limit: 3 });
  });

  it("returns at most 50 rows and rejects client-owned query controls before a transaction", async () => {
    const seeded: Record<string, Readonly<Record<string, unknown>>> = {
      "academies/academy-1/memberDirectoryStates/current": state(),
      "academies/academy-1/users/owner-1": provisionedAdminDocument(),
    };
    for (let index = 0; index < 51; index += 1) {
      const studentId = `student-${String(index).padStart(3, "0")}`;
      seeded[`academies/academy-1/students/${studentId}`] = student(studentId, `Student ${index}`);
      seeded[`academies/academy-1/studentAdminProfiles/${studentId}`] = profile(
        studentId,
        `BPT ${String(index).padStart(8, "0")}`,
      );
    }
    const harness = fakeStore(seeded);
    const reader = service(harness.store);

    const page = await reader.list({ actor: actor(), value: { pageSize: 50 }, now });
    expect(page.rows).toHaveLength(50);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(harness.listCalls).toEqual([{ limit: 51 }]);
    expect(
      harness.readPaths.filter((path) => path.includes("/studentAdminProfiles/")),
    ).toHaveLength(50);

    const transactionsBeforeInvalidInput = harness.transactions;
    const listCallsBeforeInvalidInput = harness.listCalls.length;
    for (const value of [
      { pageSize: 51 },
      { pageSize: 0 },
      { pageSize: 1.5 },
      { pageSize: 10, academyId: "academy-2" },
      { pageSize: 10, filters: {} },
      { pageSize: 10, order: "fullName" },
    ]) {
      await expect(reader.list({ actor: actor(), value, now })).rejects.toMatchObject({
        code: "invalid",
      });
    }
    expect(harness.transactions).toBe(transactionsBeforeInvalidInput);
    expect(harness.listCalls).toHaveLength(listCallsBeforeInvalidInput);
  });

  it("binds cursors to expiry, actor, tenant, role, projection and fixed order before queries", async () => {
    const harness = fakeStore();
    const reader = service(harness.store);
    const first = await reader.list({ actor: actor(), value: { pageSize: 1 }, now });
    const cursor = first.nextCursor;
    if (cursor === undefined) throw new Error("Expected a cursor");
    const transactionsAfterFirstPage = harness.transactions;
    const listCallsAfterFirstPage = harness.listCalls.length;

    const invalidCommands = [
      {
        actor: actor(),
        value: { pageSize: 1, cursor },
        now: "2026-09-03T20:06:00.000Z",
      },
      {
        actor: { ...actor(), actorId: "owner-2" },
        value: { pageSize: 1, cursor },
        now,
      },
      {
        actor: { ...actor(), academyId: "academy-2" },
        value: { pageSize: 1, cursor },
        now,
      },
      {
        actor: { ...actor(), role: "administrator" as const },
        value: { pageSize: 1, cursor },
        now,
      },
      {
        actor: actor(),
        value: {
          pageSize: 1,
          cursor: resignCursor(cursor, (payload) => ({
            ...payload,
            projectionVersion: "admin-directory-v2",
          })),
        },
        now,
      },
      {
        actor: actor(),
        value: {
          pageSize: 1,
          cursor: resignCursor(cursor, (payload) => ({ ...payload, order: "fullName:asc" })),
        },
        now,
      },
      {
        actor: actor(),
        value: {
          pageSize: 1,
          cursor: resignCursor(cursor, (payload) => ({ ...payload, privateLegacyId: "member-1" })),
        },
        now,
      },
    ] as const;

    for (const command of invalidCommands) {
      await expect(reader.list(command)).rejects.toMatchObject({ code: "invalid" });
    }
    expect(harness.transactions).toBe(transactionsAfterFirstPage);
    expect(harness.listCalls).toHaveLength(listCallsAfterFirstPage);
  });

  it("rejects a revoked or cross-tenant provisioned actor inside the list transaction", async () => {
    for (const mutation of [{ active: false }, { academyId: "academy-2" }] as const) {
      const seeded = seed();
      seeded["academies/academy-1/users/owner-1"] = provisionedAdminDocument(mutation);
      const harness = fakeStore(seeded);

      await expect(
        service(harness.store).list({ actor: actor(), value: { pageSize: 2 }, now }),
      ).rejects.toMatchObject({ code: "unauthorized" });
      expect(harness.transactions).toBe(1);
      expect(harness.readPaths).toContain("academies/academy-1/users/owner-1");
      expect(harness.readPaths).toContain("academies/academy-1/adminRoleLocks/owner-1");
      expect(harness.listCalls).toEqual([]);
      expect(harness.writePaths).toEqual([]);
    }
  });

  it("rejects a changed provisioned role inside the detail transaction before domain reads", async () => {
    const seeded = seed();
    seeded["academies/academy-1/users/owner-1"] = provisionedAdminDocument({
      adminRole: "administrator",
    });
    const harness = fakeStore(seeded);

    await expect(
      service(harness.store).detail({
        actor: actor(),
        value: { studentId: "student-1", purpose: "member-record-maintenance" },
        now,
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    expect(harness.transactions).toBe(1);
    expect(harness.readPaths).toContain("academies/academy-1/users/owner-1");
    expect(harness.readPaths).toContain("academies/academy-1/adminRoleLocks/owner-1");
    expect(
      harness.readPaths.some(
        (path) =>
          path.includes("/students/") ||
          path.includes("/studentAdminProfiles/") ||
          path.includes("/studentRestrictedReadLimits/"),
      ),
    ).toBe(false);
    expect(harness.writePaths).toEqual([]);
  });

  it("rejects an in-flight role lock inside the lookup transaction before private reads", async () => {
    const seeded = seed();
    seeded["academies/academy-1/adminRoleLocks/owner-1"] = {
      operationId: "role-change-1",
    };
    const harness = fakeStore(seeded);

    await expect(
      service(harness.store).lookup({
        actor: actor(),
        value: {
          lookupKind: "membership-number",
          value: "BPT 00000001",
          purpose: "member-identity-lookup",
        },
        now,
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    expect(harness.transactions).toBe(1);
    expect(harness.readPaths).toContain("academies/academy-1/users/owner-1");
    expect(harness.readPaths).toContain("academies/academy-1/adminRoleLocks/owner-1");
    expect(
      harness.readPaths.some(
        (path) =>
          path.includes("/studentIdentityKeys/") ||
          path.includes("/studentAdminProfiles/") ||
          path.includes("/studentRestrictedReadLimits/"),
      ),
    ).toBe(false);
    expect(harness.writePaths).toEqual([]);
  });

  it("rejects blocked state and forged/cross-actor cursors before a student query", async () => {
    const harness = fakeStore();
    const reader = service(harness.store);
    const page = await reader.list({ actor: actor(), value: { pageSize: 1 }, now });
    const calls = harness.listCalls.length;

    await expect(
      reader.list({
        actor: actor("owner-2"),
        value: { pageSize: 1, cursor: page.nextCursor },
        now,
      }),
    ).rejects.toThrow(/cursor/i);
    await expect(
      reader.list({
        actor: actor(),
        value: { pageSize: 1, cursor: `${page.nextCursor}tampered` },
        now,
      }),
    ).rejects.toThrow(/cursor/i);
    expect(harness.listCalls).toHaveLength(calls);

    const blockedSeed = seed();
    blockedSeed["academies/academy-1/memberDirectoryStates/current"] = {
      ...state(),
      directoryWriteMode: "blocked",
      freezeStatus: "frozen",
      operationPhase: "identity-reconcile",
      activeOperationId: "operation-1",
      leaseId: "lease-1",
      leaseOwner: "worker-1",
      leaseExpiresAt: "2026-09-03T20:02:00.000Z",
      operationDeadline: "2026-09-03T20:30:00.000Z",
    };
    const blocked = fakeStore(blockedSeed);
    await expect(
      service(blocked.store).list({ actor: actor(), value: { pageSize: 10 }, now }),
    ).rejects.toThrow(/unavailable/i);
    expect(blocked.listCalls).toHaveLength(0);
  });

  it("returns purpose-bound detail and exact lookup with one shared audited quota", async () => {
    const seeded = seed();
    const key = buildStudentIdentityKey({
      academyId: "academy-1",
      kind: "membership-number",
      value: "BPT 00000001",
      ownerStudentId: "student-1",
      secretMaterial: identitySecret,
      secretVersion: "identity-v1",
      now: "2026-09-03T20:00:00.000Z",
      actorId: "owner-1",
    });
    seeded[`academies/academy-1/studentIdentityKeys/${key.keyId}`] = key;
    const harness = fakeStore(seeded);
    const reader = service(harness.store);

    const detail = await reader.detail({
      actor: actor(),
      value: { studentId: "student-1", purpose: "member-record-maintenance" },
      now,
    });
    expect(detail).toEqual(
      expect.objectContaining({
        studentId: "student-1",
        dateOfBirth: "2000-01-02",
        membershipNumber: "BPT 00000001",
        idCardNumber: "ID-STUDENT-1",
        vatNumber: "VAT-STUDENT-1",
        gender: "unknown",
      }),
    );
    expect(JSON.stringify(detail)).not.toMatch(/source|createdBy|updatedBy|academyId/u);

    const found = await reader.lookup({
      actor: actor(),
      value: {
        lookupKind: "membership-number",
        value: " bpt 00000001 ",
        purpose: "member-identity-lookup",
      },
      now,
    });
    expect(found).toEqual({
      matched: true,
      row: expect.objectContaining({ studentId: "student-1", membershipReference: "****0001" }),
    });
    expect(JSON.stringify(found)).not.toContain("BPT 00000001");
    expect(harness.records.get("academies/academy-1/studentRestrictedReadLimits/owner-1")).toEqual(
      expect.objectContaining({ attemptCount: 2, overLimitObserved: false }),
    );
    const detailAuditPath = "academies/academy-1/auditEvents/restricted-audit-1";
    const lookupAuditPath = "academies/academy-1/auditEvents/restricted-audit-2";
    expect(harness.records.get(detailAuditPath)).toEqual({
      academyId: "academy-1",
      actorId: "owner-1",
      action: "member.detail.read",
      targetRef: "academies/academy-1/studentRestrictedReadLimits/owner-1",
      purpose: "member-record-maintenance",
      correlationId: "restricted-audit-1",
      result: "completed",
      auditEventId: "restricted-audit-1",
      occurredAt: expect.any(FieldValue),
      schemaVersion: 1,
    });
    expect(harness.records.get(lookupAuditPath)).toEqual({
      academyId: "academy-1",
      actorId: "owner-1",
      action: "member.identity.lookup",
      targetRef: "academies/academy-1/studentRestrictedReadLimits/owner-1",
      purpose: "member-identity-lookup",
      correlationId: "restricted-audit-2",
      result: "completed",
      auditEventId: "restricted-audit-2",
      occurredAt: expect.any(FieldValue),
      schemaVersion: 1,
    });
    expect(harness.createPaths.filter((path) => path.includes("/auditEvents/"))).toEqual([
      detailAuditPath,
      lookupAuditPath,
    ]);
    expect(harness.setPaths.filter((path) => path.includes("/auditEvents/"))).toEqual([]);
  });

  it("rejects unapproved lookup kinds, purposes, fields and roles before private reads", async () => {
    const harness = fakeStore();
    const reader = service(harness.store);
    for (const value of [
      {
        lookupKind: "legacy-member-id",
        value: "member-1",
        purpose: "member-identity-lookup",
      },
      {
        lookupKind: "auth-user-id",
        value: "user-1",
        purpose: "member-identity-lookup",
      },
      { lookupKind: "membership-number", value: "BPT 1" },
      {
        lookupKind: "membership-number",
        value: "BPT 1",
        purpose: "member-record-maintenance",
      },
      {
        lookupKind: "membership-number",
        value: "BPT 1",
        purpose: "member-identity-lookup",
        academyId: "academy-2",
      },
    ]) {
      await expect(reader.lookup({ actor: actor(), value, now })).rejects.toMatchObject({
        code: "invalid",
      });
    }
    for (const unauthorizedActor of [
      { ...actor(), role: "coach" as const },
      { ...actor(), role: "guardian" as const },
      { ...actor(), appCheckVerified: false },
      { ...actor(), active: false },
    ]) {
      await expect(
        reader.lookup({
          actor: unauthorizedActor,
          value: {
            lookupKind: "membership-number",
            value: "BPT 1",
            purpose: "member-identity-lookup",
          },
          now,
        }),
      ).rejects.toMatchObject({ code: "unauthorized" });
    }
    expect(harness.transactions).toBe(0);
    expect(harness.readPaths).toEqual([]);
    expect(harness.writePaths).toEqual([]);
  });

  it("treats a stale preserved admin identity key as no-match after authoritative recheck", async () => {
    const seeded = seed();
    const staleKey = buildStudentIdentityKey({
      academyId: "academy-1",
      kind: "membership-number",
      value: "BPT 00000099",
      ownerStudentId: "student-1",
      secretMaterial: identitySecret,
      secretVersion: "identity-v1",
      now: "2026-09-03T20:00:00.000Z",
      actorId: "owner-1",
    });
    seeded[`academies/academy-1/studentIdentityKeys/${staleKey.keyId}`] = staleKey;
    const harness = fakeStore(seeded);
    const result = await service(harness.store).lookup({
      actor: actor(),
      value: {
        lookupKind: "membership-number",
        value: "BPT 00000099",
        purpose: "member-identity-lookup",
      },
      now,
    });

    expect(result).toEqual({ matched: false });
    expect(JSON.stringify(result)).not.toContain("00000099");
    expect(harness.records.get("academies/academy-1/auditEvents/restricted-audit-1")).toMatchObject(
      { action: "member.identity.lookup", result: "no-match" },
    );
  });

  it("blocks attempt 21 before identity/domain reads and writes one over-limit audit only", async () => {
    const seeded = seed();
    seeded["academies/academy-1/studentRestrictedReadLimits/owner-1"] = {
      actorId: "owner-1",
      academyId: "academy-1",
      windowStartedAt: "2026-09-03T20:00:00.000Z",
      attemptCount: 20,
      overLimitObserved: false,
      schemaVersion: "1",
      updatedAt: "2026-09-03T20:00:00.000Z",
    };
    const harness = fakeStore(seeded);
    const reader = service(harness.store);
    const command = {
      actor: actor(),
      value: {
        lookupKind: "membership-number",
        value: "BPT 00000001",
        purpose: "member-identity-lookup",
      },
      now,
    } as const;

    await expect(reader.lookup(command)).rejects.toThrow(/rate limit/i);
    const firstWriteCount = harness.writePaths.length;
    const overLimitAuditId = "restricted-read-limit-v1:7:owner-1:1788465600";
    const overLimitAuditPath = `academies/academy-1/auditEvents/${overLimitAuditId}`;
    expect(
      harness.readPaths.some(
        (path) => path.includes("studentIdentityKeys") || path.includes("studentAdminProfiles"),
      ),
    ).toBe(false);
    expect(firstWriteCount).toBe(2);
    expect(harness.records.get(overLimitAuditPath)).toEqual({
      academyId: "academy-1",
      actorId: "owner-1",
      action: "member.identity.lookup",
      targetRef: "academies/academy-1/studentRestrictedReadLimits/owner-1",
      purpose: "member-identity-lookup",
      correlationId: overLimitAuditId,
      result: "rate-limited",
      auditEventId: overLimitAuditId,
      occurredAt: expect.any(FieldValue),
      schemaVersion: 1,
    });
    expect(harness.createPaths).toContain(overLimitAuditPath);
    expect(harness.setPaths).not.toContain(overLimitAuditPath);

    harness.readPaths.length = 0;
    await expect(reader.lookup(command)).rejects.toThrow(/rate limit/i);
    expect(harness.writePaths).toHaveLength(firstWriteCount);
    expect(
      harness.readPaths.some(
        (path) => path.includes("studentIdentityKeys") || path.includes("studentAdminProfiles"),
      ),
    ).toBe(false);
  });
});
