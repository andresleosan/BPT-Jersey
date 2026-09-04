import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

import type { FamilyStudentDraft, UserProfile } from "@bpt-jersey/domain";
import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";

import {
  FamilyStoreError,
  createFamilyStore,
  type FamilyAuthService,
  type FamilyDocumentData,
  type FamilyFirestore,
} from "./family-service.js";
import { buildInitialMemberDirectoryControlPlane } from "../members/member-directory-state.js";

const PROJECT_ID = "demo-bpt-jersey";
const IDENTITY_SECRET = Buffer.alloc(32, 17).toString("base64url");
const INTEGRITY_SECRET = Buffer.alloc(32, 29).toString("base64url");
const IDENTITY_SECRET_VERSION = "identity-v1";
const INTEGRITY_SECRET_VERSION = "integrity-v1";
const CONTROL_NOW = "2026-08-19T09:00:00.000Z";

type Ref = Readonly<{ id: string; path: string }>;
type Query = Readonly<{ path: string; field: string; value: unknown; limit: number }>;

function createFakeFirestore(initial: Record<string, FamilyDocumentData> = {}) {
  const records = new Map(Object.entries(initial));
  const writes: string[] = [];
  const ref = (path: string): Ref => ({ id: path.split("/").at(-1) ?? "", path });
  const fake: FamilyFirestore = {
    doc: (path) => ref(path),
    collection: (path) => ({
      doc: (id?: string) => ref(`${path}/${id ?? "generated"}`),
      where: (field, _operator, value) => ({
        path,
        field,
        value,
        limit: (count) => ({ path, field, value, limit: count }),
      }),
    }),
    runTransaction: async (callback) => {
      const snapshot = new Map(records);
      let hasWritten = false;
      const transaction = {
        get: async (target: Ref | Query) => {
          if (hasWritten) throw new Error("Firestore transaction read after write");
          if ("field" in target) {
            const docs = [...records.entries()]
              .filter(
                ([path, data]) =>
                  path.startsWith(`${target.path}/`) && data[target.field] === target.value,
              )
              .slice(0, target.limit)
              .map(([path, data]) => ({ ...ref(path), exists: true, data: () => data }));
            return { docs };
          }
          const data = records.get(target.path);
          return { ...ref(target.path), exists: data !== undefined, data: () => data };
        },
        create: (target: Ref, data: FamilyDocumentData) => {
          if (records.has(target.path)) throw new Error("already exists");
          hasWritten = true;
          writes.push(`create:${target.path}`);
          records.set(target.path, data);
          return transaction;
        },
        set: (target: Ref, data: FamilyDocumentData) => {
          hasWritten = true;
          writes.push(`set:${target.path}`);
          records.set(target.path, data);
          return transaction;
        },
      };
      try {
        return await callback(transaction);
      } catch (error) {
        records.clear();
        for (const [path, data] of snapshot) records.set(path, data);
        writes.length = 0;
        throw error;
      }
    },
  };
  return { firestore: fake, records, writes };
}

function tutorUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: "user-1",
    academyId: "academy-1",
    accountType: "client",
    displayName: "Synthetic Guardian",
    email: "guardian@example.test",
    phoneNumber: "+441234567890",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-08-19T10:00:00.000Z",
    createdBy: "admin-1",
    updatedAt: "2026-08-19T10:00:00.000Z",
    updatedBy: "admin-1",
    ...overrides,
  };
}

function adminUser(
  userId: string,
  adminRole: "owner" | "administrator" = "administrator",
): FamilyDocumentData {
  return {
    userId,
    academyId: "academy-1",
    accountType: "staff",
    displayName: `Synthetic ${userId}`,
    email: `${userId}@example.test`,
    authProvider: "google",
    adminRole,
    lastRoleChangeAuditId: `role-audit-${userId}`,
    active: true,
    status: "active",
    createdAt: Timestamp.fromMillis(Date.parse(CONTROL_NOW)),
    createdBy: "owner-1",
    updatedAt: Timestamp.fromMillis(Date.parse(CONTROL_NOW)),
    updatedBy: "owner-1",
    schemaVersion: 1,
  };
}

function draft(name: string): FamilyStudentDraft {
  return {
    fullName: name,
    dateOfBirth: "2015-08-19",
    trainingCenter: "Town",
    trainingTimePreferences: ["afternoon"],
  };
}

function controlPlane(
  overrides: Partial<MemberDirectoryState> = {},
): Record<string, FamilyDocumentData> {
  const state: MemberDirectoryState = {
    stateId: "current",
    academyId: "academy-1",
    readerVersion: "canonical-v1",
    directoryWriteMode: "canonical-v1",
    freezeStatus: "open",
    stateRevision: 0,
    globalLegacyReadEliminated: false,
    identityKeyCoverage: "complete",
    digestVersion: "hmac-sha256-v1",
    secretVersion: IDENTITY_SECRET_VERSION,
    identityKeyBaselineMac: "a".repeat(64),
    identityKeyBaselineArtifactId: "baseline-1",
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: 0,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: CONTROL_NOW,
    createdBy: "migration-1",
    updatedAt: CONTROL_NOW,
    updatedBy: "migration-1",
    ...overrides,
  };
  const { guard, event } = buildInitialMemberDirectoryControlPlane({
    projectId: PROJECT_ID,
    state,
    now: CONTROL_NOW,
    actorId: "migration-1",
    integritySecretMaterial: INTEGRITY_SECRET,
    integritySecretVersion: INTEGRITY_SECRET_VERSION,
  });
  return {
    "academies/academy-1/memberDirectoryStates/current": state,
    "memberDirectoryRestoreGuards/academy-1": guard,
    [`memberDirectoryRestoreGuards/academy-1/events/${event.eventId}`]: event,
  };
}

function createServices(
  initial: Record<string, FamilyDocumentData> = {},
  authUsers: UserProfile | readonly UserProfile[] | undefined = tutorUser(),
) {
  const fake = createFakeFirestore({
    ...controlPlane(),
    "academies/academy-1/users/admin-1": adminUser("admin-1"),
    "academies/academy-1/users/admin-2": adminUser("admin-2"),
    ...initial,
  });
  const availableAuthUsers =
    authUsers === undefined ? [] : Array.isArray(authUsers) ? authUsers : [authUsers];
  const auth: FamilyAuthService = {
    getUser: async (userId) => {
      const authUser = availableAuthUsers.find((user) => user.userId === userId);
      if (authUser === undefined) throw new Error("auth user missing");
      return {
        uid: authUser.userId,
        customClaims: { academyId: authUser.academyId, role: "guardian" },
      };
    },
  };
  let familyNumber = 0;
  let studentNumber = 0;
  const store = createFamilyStore({
    firestore: fake.firestore,
    auth,
    canonicalControl: {
      projectId: PROJECT_ID,
      identitySecretMaterial: IDENTITY_SECRET,
      identitySecretVersion: IDENTITY_SECRET_VERSION,
      integritySecretMaterial: INTEGRITY_SECRET,
      integritySecretVersion: INTEGRITY_SECRET_VERSION,
    },
    generateFamilyId: () => `family-${++familyNumber}`,
    generateStudentId: () => `student-${++studentNumber}`,
    generateAuditId: () => `audit-${familyNumber}-${studentNumber}`,
  });
  return { ...fake, store };
}

describe("family Firestore store", () => {
  it("atomically creates one family, two minors, and deterministic guardian relationships", async () => {
    const { store, records } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });

    const projection = await store.createFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      requestId: "request-create-1",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor One"), draft("Synthetic Minor Two")],
      now: "2026-08-19T10:00:00.000Z",
    });

    expect(projection.family.familyId).toBe("family-1");
    expect(projection.students).toHaveLength(2);
    expect(projection.students.every((student) => student.familyId === "family-1")).toBe(true);
    expect(projection.students.every((student) => student.participantType === "minor")).toBe(true);
    expect(projection.relationships.map((item) => item.relationshipId)).toEqual([
      "family-1--student-1",
      "family-1--student-2",
    ]);
    expect(projection.family.createdBy).toBe("admin-1");
    expect(records.has("academies/academy-1/families/family-1")).toBe(true);
    expect(records.has("academies/academy-1/relationships/family-1--student-2")).toBe(true);
    expect(records.get("academies/academy-1/memberDirectoryStates/current")).toMatchObject({
      stateRevision: 1,
      rollbackEligibleStudentCount: 2,
      updatedBy: "admin-1",
    });
    expect(records.get("memberDirectoryRestoreGuards/academy-1")).toMatchObject({
      highestStateRevision: 1,
      highestRollbackEligibleStudentCount: 2,
      lastEventId: "1",
    });
    expect(records.get("memberDirectoryRestoreGuards/academy-1/events/1")).toMatchObject({
      transitionKind: "family-minor-create",
      currentStateRevision: 1,
    });
    const receipt = [...records.entries()].find(([path]) =>
      path.includes("/familyWriteReceipts/"),
    )?.[1];
    const audit = [...records.entries()].find(([path]) => path.includes("/auditEvents/"))?.[1];
    expect(receipt).toMatchObject({
      academyId: "academy-1",
      actorId: "admin-1",
      operation: "family.create",
      familyId: "family-1",
      createdStudentIds: ["student-1", "student-2"],
      stateRevisionBefore: 0,
      stateRevisionAfter: 1,
      status: "completed",
    });
    expect(audit).toMatchObject({
      action: "family.created",
      targetRef: "academies/academy-1/families/family-1",
      result: "completed",
    });
    expect(JSON.stringify({ receipt, audit })).not.toMatch(
      /Synthetic Minor|guardian@example|dateOfBirth|phoneNumber/u,
    );
    expect(
      [...records.keys()].some((path) => path.includes("/memberDirectoryWriteReceipts/")),
    ).toBe(false);
    expect([...records.keys()].some((path) => /(?:^|\/)members(?:\/|$)/u.test(path))).toBe(false);
  });

  it("returns an empty guardian lookup and a same-tenant staff projection", async () => {
    const { store } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });

    await expect(store.getGuardianFamily("academy-1", "user-1")).resolves.toBeUndefined();
    await store.createFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      requestId: "request-create-lookup",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor")],
      now: "2026-08-19T10:00:00.000Z",
    });

    await expect(store.getStaffFamily("academy-1", "family-1")).resolves.toMatchObject({
      family: { familyId: "family-1", academyId: "academy-1" },
      students: [{ fullName: "Synthetic Minor" }],
    });
    await expect(store.getStaffFamily("academy-2", "family-1")).resolves.toBeUndefined();
  });

  it("revalidates the administrative profile and role lock in the family read transaction", async () => {
    const { store, records } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });
    await store.createFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      requestId: "request-create-authorized-lookup",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor")],
      now: "2026-08-19T10:00:00.000Z",
    });
    const query = {
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      familyId: "family-1",
    } as const;
    await expect(store.getStaffFamilyForActor(query)).resolves.toMatchObject({
      family: { familyId: "family-1" },
    });

    records.set("academies/academy-1/adminRoleLocks/admin-1", { active: true });
    await expect(store.getStaffFamilyForActor(query)).rejects.toMatchObject({
      code: "precondition",
    });
  });

  it("rejects duplicate tutor membership, invalid Auth, tenant mismatch, and linked student collisions", async () => {
    const first = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });
    const input = {
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      requestId: "request-create-duplicate",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor")],
      now: "2026-08-19T10:00:00.000Z",
    } as const;
    await first.store.createFamily(input);
    await expect(
      first.store.createFamily({ ...input, requestId: "request-create-duplicate-2" }),
    ).rejects.toMatchObject({ code: "duplicate" });

    await expect(createServices({}, undefined).store.createFamily(input)).rejects.toMatchObject({
      code: "precondition",
    });
    await expect(
      createServices(
        { "academies/academy-1/users/user-1": tutorUser({ academyId: "academy-2" }) },
        tutorUser({ academyId: "academy-2" }),
      ).store.createFamily(input),
    ).rejects.toMatchObject({ code: "tenant" });

    const collision = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
      "academies/academy-1/students/student-1": {
        studentId: "student-1",
        academyId: "academy-1",
        familyId: "family-existing",
      },
    });
    await expect(collision.store.createFamily(input)).rejects.toMatchObject({ code: "duplicate" });

    const familyCollision = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
      "academies/academy-1/families/family-1": {},
    });
    await expect(familyCollision.store.createFamily(input)).rejects.toMatchObject({
      code: "duplicate",
    });
  });

  it("propagates a replacement tutor to the family contacts and active relationships", async () => {
    const secondTutor = tutorUser({ userId: "user-2", email: "second@example.test" });
    const { store, records } = createServices(
      {
        "academies/academy-1/users/user-1": tutorUser(),
        "academies/academy-1/users/user-2": secondTutor,
      },
      [tutorUser(), secondTutor],
    );
    await store.createFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      requestId: "request-create-replace",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor")],
      now: "2026-08-19T10:00:00.000Z",
    });

    const projection = await store.updateFamily({
      academyId: "academy-1",
      actorId: "admin-2",
      actorRole: "administrator",
      familyId: "family-1",
      operation: { kind: "replaceTutor", tutorUserId: "user-2" },
      now: "2026-08-20T10:00:00.000Z",
    });

    expect(projection.family.primaryContactUserId).toBe("user-2");
    expect(projection.family.billingContactUserId).toBe("user-2");
    expect(projection.relationships[0]?.adultUserId).toBe("user-2");
    expect(records.get("academies/academy-1/families/family-1")).toMatchObject({
      createdAt: "2026-08-19T10:00:00.000Z",
      updatedBy: "admin-2",
    });
  });

  it("deactivates one relationship and then the family without deleting documents", async () => {
    const { store, records } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });
    await store.createFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      requestId: "request-create-deactivate",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor One"), draft("Synthetic Minor Two")],
      now: "2026-08-19T10:00:00.000Z",
    });

    await store.updateFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      familyId: "family-1",
      operation: { kind: "deactivateRelationship", studentId: "student-1" },
      now: "2026-08-20T10:00:00.000Z",
    });
    const guardian = await store.getGuardianFamily("academy-1", "user-1");
    expect(guardian?.students.map((student) => student.studentId)).toEqual(["student-2"]);

    await store.updateFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      familyId: "family-1",
      operation: { kind: "deactivateFamily" },
      now: "2026-08-21T10:00:00.000Z",
    });
    expect(records.has("academies/academy-1/families/family-1")).toBe(true);
    expect(records.has("academies/academy-1/relationships/family-1--student-2")).toBe(true);
    await expect(store.getGuardianFamily("academy-1", "user-1")).resolves.toBeUndefined();
  });

  it("returns a redacted guardian projection without relationships or internal fields", async () => {
    const { store } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });
    await store.createFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      requestId: "request-create-redacted",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor")],
      now: "2026-08-19T10:00:00.000Z",
    });

    const projection = await store.getGuardianFamily("academy-1", "user-1");
    expect(projection).toBeDefined();
    expect(projection).not.toHaveProperty("relationships");
    expect(projection).not.toHaveProperty("academyId");
    expect(projection?.tutor).toEqual({
      userId: "user-1",
      displayName: "Synthetic Guardian",
      email: "guardian@example.test",
      phoneNumber: "+441234567890",
    });
    expect(projection?.students[0]).not.toHaveProperty("createdBy");
    expect(projection?.students[0]).not.toHaveProperty("familyId");
  });

  it("fails closed when guardian relationships resolve to more than one family", async () => {
    const { store } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
      "academies/academy-1/relationships/family-a--student-a": {
        relationshipId: "family-a--student-a",
        academyId: "academy-1",
        adultUserId: "user-1",
        familyId: "family-a",
        studentId: "student-a",
        relationshipType: "guardian",
        permissions: ["readProfile"],
        validFrom: "2026-08-19T10:00:00.000Z",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: "2026-08-19T10:00:00.000Z",
        createdBy: "admin-1",
        updatedAt: "2026-08-19T10:00:00.000Z",
        updatedBy: "admin-1",
      },
      "academies/academy-1/relationships/family-b--student-b": {
        relationshipId: "family-b--student-b",
        academyId: "academy-1",
        adultUserId: "user-1",
        familyId: "family-b",
        studentId: "student-b",
        relationshipType: "guardian",
        permissions: ["readProfile"],
        validFrom: "2026-08-19T10:00:00.000Z",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: "2026-08-19T10:00:00.000Z",
        createdBy: "admin-1",
        updatedAt: "2026-08-19T10:00:00.000Z",
        updatedBy: "admin-1",
      },
    });

    await expect(store.getGuardianFamily("academy-1", "user-1")).rejects.toMatchObject({
      code: "duplicate",
    });
  });

  it("replays an identical create receipt and rejects a divergent request with the same requestId", async () => {
    const { store, records } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });
    const input = {
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      requestId: "request-create-replay",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor")],
      now: "2026-08-19T10:00:00.000Z",
    } as const;

    const created = await store.createFamily(input);
    await expect(store.createFamily(input)).resolves.toEqual(created);
    expect(records.get("academies/academy-1/memberDirectoryStates/current")).toMatchObject({
      stateRevision: 1,
      rollbackEligibleStudentCount: 1,
    });
    expect(
      [...records.keys()].filter((path) => path.includes("/familyWriteReceipts/")),
    ).toHaveLength(1);
    await expect(
      store.createFamily({
        ...input,
        students: [draft("Different Synthetic Minor")],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects a replay whose embedded receipt ID does not match its derived document ID", async () => {
    const { store, records } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });
    const input = {
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      requestId: "request-receipt-id-binding",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor")],
      now: "2026-08-19T10:00:00.000Z",
    } as const;
    await store.createFamily(input);

    const receiptEntry = [...records.entries()].find(([path]) =>
      /\/(?:memberDirectory|family)WriteReceipts\//u.test(path),
    );
    expect(receiptEntry).toBeDefined();
    const [receiptDocumentPath, receipt] = receiptEntry!;
    const forgedReceiptId = `family-write-${"f".repeat(64)}`;
    records.set(receiptDocumentPath, { ...receipt, receiptId: forgedReceiptId });
    const auditPath = `academies/academy-1/auditEvents/${String(receipt.auditEventId)}`;
    const audit = records.get(auditPath);
    expect(audit).toBeDefined();
    records.set(auditPath, { ...audit, correlationId: forgedReceiptId });

    await expect(store.createFamily(input)).rejects.toMatchObject({ code: "conflict" });
  });

  it("adds a minor through the same control transaction and replays only an identical command", async () => {
    const { store, records } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });
    await store.createFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      requestId: "request-create-before-add",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor One")],
      now: "2026-08-19T10:00:00.000Z",
    });
    const input = {
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      familyId: "family-1",
      operation: {
        kind: "addStudent",
        requestId: "request-add-1",
        student: draft("Synthetic Minor Two"),
      },
      now: "2026-08-20T10:00:00.000Z",
    } as const;

    const updated = await store.updateFamily(input);
    expect(updated.students.map((item) => item.studentId)).toEqual(["student-1", "student-2"]);
    expect(updated.relationships.at(-1)).toMatchObject({
      familyId: "family-1",
      studentId: "student-2",
      adultUserId: "user-1",
      active: true,
    });
    expect(records.get("academies/academy-1/memberDirectoryStates/current")).toMatchObject({
      stateRevision: 2,
      rollbackEligibleStudentCount: 2,
    });
    expect(records.get("memberDirectoryRestoreGuards/academy-1/events/2")).toMatchObject({
      transitionKind: "family-minor-create",
      previousStateRevision: 1,
      currentStateRevision: 2,
    });
    const addAudit = [...records.values()].find((value) => value.action === "family.student.added");
    expect(addAudit).toMatchObject({
      targetRef: "academies/academy-1/students/student-2",
      result: "completed",
    });
    expect(JSON.stringify(addAudit)).not.toMatch(/Synthetic Minor|dateOfBirth/u);

    await expect(store.updateFamily(input)).resolves.toEqual(updated);
    expect(records.get("academies/academy-1/memberDirectoryStates/current")).toMatchObject({
      stateRevision: 2,
      rollbackEligibleStudentCount: 2,
    });
    await expect(
      store.updateFamily({
        ...input,
        operation: {
          ...input.operation,
          student: draft("Divergent Synthetic Minor"),
        },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("fails atomically when the rollback window cannot fit every new minor", async () => {
    const { store, records } = createServices({
      ...controlPlane({ rollbackEligibleStudentCount: 399 }),
      "academies/academy-1/users/user-1": tutorUser(),
    });

    await expect(
      store.createFamily({
        academyId: "academy-1",
        actorId: "admin-1",
        actorRole: "administrator",
        requestId: "request-over-capacity",
        tutorUserId: "user-1",
        students: [draft("Synthetic Minor One"), draft("Synthetic Minor Two")],
        now: "2026-08-19T10:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "precondition" });
    expect(records.has("academies/academy-1/families/family-1")).toBe(false);
    expect(records.get("academies/academy-1/memberDirectoryStates/current")).toMatchObject({
      stateRevision: 0,
      rollbackEligibleStudentCount: 399,
    });
  });

  it("requires an active same-tenant tutor for each added minor", async () => {
    const { store, records } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });
    await store.createFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      requestId: "request-create-before-inactive",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor")],
      now: "2026-08-19T10:00:00.000Z",
    });
    records.set(
      "academies/academy-1/users/user-1",
      tutorUser({ active: false, status: "inactive" }),
    );

    await expect(
      store.updateFamily({
        academyId: "academy-1",
        actorId: "admin-1",
        actorRole: "administrator",
        familyId: "family-1",
        operation: {
          kind: "addStudent",
          requestId: "request-add-inactive-tutor",
          student: draft("Synthetic Minor Two"),
        },
        now: "2026-08-20T10:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "precondition" });
    expect(records.has("academies/academy-1/students/student-2")).toBe(false);
  });

  it("blocks every relationship-affecting update while the canonical directory is frozen", async () => {
    const secondTutor = tutorUser({ userId: "user-2", email: "second@example.test" });
    const { store, records } = createServices(
      {
        "academies/academy-1/users/user-1": tutorUser(),
        "academies/academy-1/users/user-2": secondTutor,
      },
      [tutorUser(), secondTutor],
    );
    await store.createFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      requestId: "request-create-before-freeze",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor")],
      now: "2026-08-19T10:00:00.000Z",
    });
    for (const [path, value] of Object.entries(
      controlPlane({
        readerVersion: "legacy-rollback-v1",
        directoryWriteMode: "blocked",
        freezeStatus: "frozen",
        operationPhase: "rollback-readonly",
      }),
    )) {
      records.set(path, value);
    }

    for (const operation of [
      { kind: "replaceTutor", tutorUserId: "user-2" },
      { kind: "deactivateRelationship", studentId: "student-1" },
      { kind: "deactivateFamily" },
    ] as const) {
      await expect(
        store.updateFamily({
          academyId: "academy-1",
          actorId: "admin-1",
          actorRole: "administrator",
          familyId: "family-1",
          operation,
          now: "2026-08-20T10:00:00.000Z",
        }),
      ).rejects.toMatchObject({ code: "precondition" });
    }
    expect(records.get("academies/academy-1/families/family-1")).toMatchObject({
      active: true,
      primaryContactUserId: "user-1",
    });
    expect(records.get("academies/academy-1/relationships/family-1--student-1")).toMatchObject({
      active: true,
      adultUserId: "user-1",
    });
  });

  it("fails closed when canonical writer secrets or project binding are absent or invalid", async () => {
    const { firestore } = createFakeFirestore();
    const auth: FamilyAuthService = { getUser: async (userId) => ({ uid: userId }) };
    const base = {
      firestore,
      auth,
      canonicalControl: {
        projectId: PROJECT_ID,
        identitySecretMaterial: IDENTITY_SECRET,
        identitySecretVersion: IDENTITY_SECRET_VERSION,
        integritySecretMaterial: INTEGRITY_SECRET,
        integritySecretVersion: INTEGRITY_SECRET_VERSION,
      },
    } as const;

    expect(() =>
      createFamilyStore({
        ...base,
        canonicalControl: { ...base.canonicalControl, projectId: "" },
      }),
    ).toThrow(FamilyStoreError);
    expect(() =>
      createFamilyStore({
        ...base,
        canonicalControl: {
          ...base.canonicalControl,
          integritySecretMaterial: IDENTITY_SECRET,
        },
      }),
    ).toThrow(FamilyStoreError);
    const unboundStore = createFamilyStore({ firestore, auth });
    await expect(
      unboundStore.createFamily({
        academyId: "academy-1",
        actorId: "admin-1",
        actorRole: "administrator",
        requestId: "request-unbound",
        tutorUserId: "user-1",
        students: [draft("Synthetic Minor")],
        now: "2026-08-19T10:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "precondition" });
  });

  it("rejects a stale transactional actor role or any role lock before family writes", async () => {
    for (const initial of [
      {
        "academies/academy-1/users/admin-1": adminUser("admin-1", "owner"),
      },
      {
        "academies/academy-1/adminRoleLocks/admin-1": {
          userId: "admin-1",
          academyId: "academy-1",
        },
      },
    ]) {
      const { store, records } = createServices({
        ...initial,
        "academies/academy-1/users/user-1": tutorUser(),
      });
      await expect(
        store.createFamily({
          academyId: "academy-1",
          actorId: "admin-1",
          actorRole: "administrator",
          requestId: "request-stale-actor",
          tutorUserId: "user-1",
          students: [draft("Synthetic Minor")],
          now: "2026-08-19T10:00:00.000Z",
        }),
      ).rejects.toMatchObject({ code: "precondition" });
      expect(records.has("academies/academy-1/families/family-1")).toBe(false);
      expect(records.get("academies/academy-1/memberDirectoryStates/current")).toMatchObject({
        stateRevision: 0,
      });
    }
  });

  it("does not write forbidden fields or paths", async () => {
    const { store, records, writes } = createServices({
      "academies/academy-1/users/user-1": tutorUser(),
    });
    await store.createFamily({
      academyId: "academy-1",
      actorId: "admin-1",
      actorRole: "administrator",
      requestId: "request-create-paths",
      tutorUserId: "user-1",
      students: [draft("Synthetic Minor")],
      now: "2026-08-19T10:00:00.000Z",
    });

    expect(writes.some((write) => /(?:^|\/)members(?:\/|$)/u.test(write))).toBe(false);
    expect(
      writes.every((write) =>
        /(?:academies\/academy-1\/(?:families|students|relationships|memberDirectoryStates|familyWriteReceipts|auditEvents)\/|memberDirectoryRestoreGuards\/academy-1(?:\/events\/)?)/u.test(
          write,
        ),
      ),
    ).toBe(true);
    for (const [path, data] of records) {
      if (
        !path.includes("/families/") &&
        !path.includes("/students/") &&
        !path.includes("/relationships/")
      )
        continue;
      expect(data).not.toHaveProperty("medicalConditions");
      expect(data).not.toHaveProperty("waiver");
      expect(data).not.toHaveProperty("membershipId");
      expect(data).not.toHaveProperty("belt");
      expect(data).not.toHaveProperty("stripe");
    }
  });
});

void FamilyStoreError;
