import { describe, expect, it } from "vitest";

import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";

import { buildInitialMemberDirectoryControlPlane } from "../members/member-directory-state.js";
import {
  createProfileStore,
  type ProfileDocumentData,
  type ProfileFirestore,
  type SaveClientProfileInput,
} from "./profile-service.js";

type Ref = Readonly<{ id: string; path: string }>;

const identitySecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecret = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";

function canonicalSeed(): Record<string, ProfileDocumentData> {
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
    secretVersion: "identity-v1",
    identityKeyBaselineMac: "a".repeat(64),
    identityKeyBaselineArtifactId: "baseline-1",
    rollbackProtocolVersion: "legacy-projection-v1",
    rollbackCapacityLimit: 400,
    rollbackEligibleStudentCount: 0,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: "2026-08-19T10:00:00.000Z",
    createdBy: "system-1",
    updatedAt: "2026-08-19T10:00:00.000Z",
    updatedBy: "system-1",
  };
  const control = buildInitialMemberDirectoryControlPlane({
    projectId: "demo-bpt-jersey",
    state,
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    now: state.createdAt,
    actorId: "system-1",
  });
  return {
    "academies/academy-1/memberDirectoryStates/current": state,
    "memberDirectoryRestoreGuards/academy-1": control.guard,
    "memberDirectoryRestoreGuards/academy-1/events/0": control.event,
  };
}

function createFakeFirestore(initial: Record<string, ProfileDocumentData> = {}) {
  const records = new Map(Object.entries({ ...canonicalSeed(), ...initial }));
  let generatedId = 0;
  const ref = (path: string): Ref => ({ id: path.split("/").at(-1) ?? "", path });
  const fake: ProfileFirestore = {
    doc: ref,
    collection: (path) => ({
      doc: (id?: string) => ref(`${path}/${id ?? `student-${generatedId++}`}`),
      where: (field, _operator, value) => ({
        path,
        field,
        value,
        limit: () => ({ path, field, value }),
      }),
    }),
    runTransaction: async (callback) => {
      const transaction = {
        get: async (target: Ref | { path: string; field: string; value: unknown }) => {
          if ("field" in target) {
            const docs = [...records.entries()]
              .filter(
                ([path, data]) =>
                  path.startsWith(`${target.path}/`) && data[target.field] === target.value,
              )
              .map(([path, data]) => ({ ...ref(path), exists: true, data: () => data }));
            return { docs };
          }
          const data = records.get(target.path);
          return { ...ref(target.path), exists: data !== undefined, data: () => data };
        },
        create: (target: Ref, data: ProfileDocumentData) => {
          if (records.has(target.path)) throw new Error("already exists");
          records.set(target.path, data);
          return transaction;
        },
        set: (target: Ref, data: ProfileDocumentData) => {
          records.set(target.path, data);
          return transaction;
        },
      };
      return callback(transaction);
    },
  };
  return { firestore: fake, records };
}

const input = (overrides: Partial<SaveClientProfileInput> = {}): SaveClientProfileInput => ({
  academyId: "academy-1",
  userId: "user-1",
  email: "adult@example.test",
  displayName: "Synthetic Adult",
  requestId: "profile-request-1",
  fullName: "Synthetic Adult",
  dateOfBirth: "1990-08-19",
  phoneNumber: "+15550000001",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  now: "2026-08-19T12:00:00.000Z",
  ...overrides,
});

function profileStore(
  firestore: ProfileFirestore,
  generateStudentId: () => string = () => "student-1",
) {
  let auditId = 0;
  return createProfileStore({
    firestore,
    projectId: "demo-bpt-jersey",
    identitySecretMaterial: identitySecret,
    identitySecretVersion: "identity-v1",
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    generateStudentId,
    generateAuditId: () => `audit-profile-${++auditId}`,
  });
}

describe("profile Firestore store", () => {
  it("returns an empty lookup and atomically creates the adult user, family and student", async () => {
    const { firestore, records } = createFakeFirestore();
    const store = profileStore(firestore);

    await expect(store.getClientProfile("user-1", "academy-1")).resolves.toBeUndefined();
    const projection = await store.saveClientProfile(input());

    expect(projection.user.userId).toBe("user-1");
    expect(projection.student.studentId).toBe("student-1");
    expect(projection.student.familyId).toMatch(/^adult-[a-f0-9]{64}$/u);
    expect(records.has("academies/academy-1/users/user-1")).toBe(true);
    expect(records.has("academies/academy-1/students/student-1")).toBe(true);
    expect(
      [...records.entries()].some(
        ([path, record]) =>
          path.startsWith("academies/academy-1/families/adult-") &&
          record.primaryContactUserId === "user-1" &&
          record.billingContactUserId === "user-1",
      ),
    ).toBe(true);
  });

  it("updates the existing participant while preserving creation provenance", async () => {
    const { firestore } = createFakeFirestore();
    let sequence = 0;
    const store = profileStore(firestore, () => `student-${++sequence}`);

    const created = await store.saveClientProfile(input());
    const updated = await store.saveClientProfile(
      input({
        requestId: "profile-request-2",
        fullName: "Synthetic Adult Updated",
        trainingCenter: "West",
        now: "2026-08-20T12:00:00.000Z",
      }),
    );

    expect(updated.student.studentId).toBe(created.student.studentId);
    expect(updated.student.createdAt).toBe(created.student.createdAt);
    expect(updated.student.createdBy).toBe(created.student.createdBy);
    expect(updated.student.updatedAt).toBe("2026-08-20T12:00:00.000Z");
    expect(updated.student.trainingCenter).toBe("West");
  });

  it("fails closed when the transactional client profile is no longer active", async () => {
    const { firestore, records } = createFakeFirestore();
    const store = profileStore(firestore);
    await store.saveClientProfile(input());
    const userPath = "academies/academy-1/users/user-1";
    const currentUser = records.get(userPath);
    expect(currentUser).toBeDefined();
    records.set(userPath, { ...currentUser, active: false, status: "inactive" });

    await expect(store.getClientProfile("user-1", "academy-1")).rejects.toThrow(/active/i);
  });

  it("rejects a replay whose receipt identity and audit correlation were both forged", async () => {
    const { firestore, records } = createFakeFirestore();
    const store = profileStore(firestore);
    const command = input();
    await store.saveClientProfile(command);
    const receiptEntry = [...records.entries()].find(([path]) =>
      path.includes("/profileWriteReceipts/"),
    );
    const auditEntry = [...records.entries()].find(([path]) => path.includes("/auditEvents/"));
    expect(receiptEntry).toBeDefined();
    expect(auditEntry).toBeDefined();
    if (receiptEntry === undefined || auditEntry === undefined) return;
    const forgedReceiptId = `write-${"f".repeat(64)}`;
    records.set(receiptEntry[0], { ...receiptEntry[1], receiptId: forgedReceiptId });
    records.set(auditEntry[0], { ...auditEntry[1], correlationId: forgedReceiptId });

    await expect(
      store.saveClientProfile({ ...command, now: "2026-08-19T13:00:00.000Z" }),
    ).rejects.toMatchObject({ code: "replay" });
  });

  it("fails closed for tenant mismatches, duplicate identities, and forbidden fields", async () => {
    const duplicate = {
      "academies/academy-1/students/student-a": {
        userId: "user-1",
      },
      "academies/academy-1/students/student-b": {
        userId: "user-1",
      },
    };
    const { firestore } = createFakeFirestore(duplicate);
    const store = profileStore(firestore, () => "student-new");
    await expect(store.saveClientProfile(input())).rejects.toThrow(/duplicate/i);

    const mismatch = createFakeFirestore({
      "academies/academy-1/users/user-1": {
        userId: "user-1",
        academyId: "academy-2",
        accountType: "client",
        displayName: "Synthetic Adult",
        email: "adult@example.test",
        phoneNumber: "+15550000001",
        active: true,
        status: "active",
        schemaVersion: "1",
        createdAt: "2026-08-19T12:00:00.000Z",
        createdBy: "user-1",
        updatedAt: "2026-08-19T12:00:00.000Z",
        updatedBy: "user-1",
      },
    });
    await expect(profileStore(mismatch.firestore).saveClientProfile(input())).rejects.toThrow(
      /tenant/i,
    );

    const forbidden = createFakeFirestore({
      "academies/academy-1/users/user-1": { medicalConditions: "forbidden" },
    });
    await expect(profileStore(forbidden.firestore).saveClientProfile(input())).rejects.toThrow(
      /invalid/i,
    );
  });
});
