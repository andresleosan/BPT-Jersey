import { describe, expect, it } from "vitest";

import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";

import {
  buildStudentIdentityKey,
  deriveStudentIdentityKeyId,
} from "../members/member-directory-crypto.js";
import { buildInitialMemberDirectoryControlPlane } from "../members/member-directory-state.js";
import {
  createProfileStore,
  ProfileStoreError,
  type ProfileCollectionReference,
  type ProfileDocumentData,
  type ProfileDocumentReference,
  type ProfileDocumentSnapshot,
  type ProfileFirestore,
  type ProfileQuery,
  type ProfileQuerySnapshot,
  type ProfileStoreDependencies,
  type ProfileTransaction,
  type SaveClientProfileInput,
} from "./profile-service.js";

const identitySecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecret = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";

const canonicalState = (overrides: Partial<MemberDirectoryState> = {}): MemberDirectoryState => ({
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
  createdAt: "2026-09-03T10:00:00.000Z",
  createdBy: "system-1",
  updatedAt: "2026-09-03T10:00:00.000Z",
  updatedBy: "system-1",
  ...overrides,
});

const querySnapshot = (docs: ReadonlyArray<ProfileDocumentSnapshot>): ProfileQuerySnapshot => ({
  docs,
});

class AtomicProfileFirestore implements ProfileFirestore {
  readonly records = new Map<string, ProfileDocumentData>();
  readonly readTargets: string[] = [];
  readonly committedWritePaths: string[] = [];
  failCommit = false;

  constructor(initial: Record<string, ProfileDocumentData> = {}) {
    for (const [path, data] of Object.entries(initial)) {
      this.records.set(path, structuredClone(data));
    }
  }

  collection(path: string): ProfileCollectionReference {
    return {
      doc: (id = "") => this.doc(`${path}/${id}`),
      where: (field, operator, value) => ({
        limit: () => this.query(path, field, operator, value),
      }),
    };
  }

  doc(path: string): ProfileDocumentReference {
    return { id: path.split("/").at(-1) ?? "", path };
  }

  async runTransaction<T>(
    updateFunction: (transaction: ProfileTransaction) => Promise<T>,
  ): Promise<T> {
    const staged = new Map<string, ProfileDocumentData>();
    const created = new Set<string>();
    const transaction: ProfileTransaction = {
      get: async (target) => {
        if (!("field" in target)) {
          this.readTargets.push(target.path);
          const data = this.records.get(target.path);
          return {
            exists: data !== undefined,
            id: target.id,
            ref: target,
            data: () => data && structuredClone(data),
          };
        }

        this.readTargets.push(`query:${target.path}:${target.field}:${String(target.value)}`);
        const docs = [...this.records.entries()]
          .filter(([path, data]) => {
            const segments = path.split("/");
            return (
              segments.length === target.path.split("/").length + 1 &&
              path.startsWith(`${target.path}/`) &&
              data[target.field] === target.value
            );
          })
          .map(([path, data]) => ({
            exists: true,
            id: path.split("/").at(-1) ?? "",
            ref: this.doc(path),
            data: () => structuredClone(data),
          }));
        return querySnapshot(docs);
      },
      create: (reference, data) => {
        if (this.records.has(reference.path) || created.has(reference.path)) {
          throw new Error(`already exists: ${reference.path}`);
        }
        created.add(reference.path);
        staged.set(reference.path, structuredClone(data));
        return transaction;
      },
      set: (reference, data) => {
        staged.set(reference.path, structuredClone(data));
        return transaction;
      },
    };

    const result = await updateFunction(transaction);
    if (this.failCommit) {
      throw new Error("synthetic commit failure");
    }
    for (const [path, data] of staged) {
      this.records.set(path, data);
      this.committedWritePaths.push(path);
    }
    return result;
  }

  private query(
    collectionPath: string,
    field: string,
    _operator: "==",
    value: unknown,
  ): ProfileQuery {
    return {
      path: collectionPath,
      field,
      value,
    };
  }
}

const canonicalControlPlane = (state = canonicalState()) => {
  const controlPlane = buildInitialMemberDirectoryControlPlane({
    projectId: "demo-bpt-jersey",
    state,
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    now: state.createdAt,
    actorId: "system-1",
  });
  return {
    [`academies/${state.academyId}/memberDirectoryStates/current`]: state,
    [`memberDirectoryRestoreGuards/${state.academyId}`]: controlPlane.guard,
    [`memberDirectoryRestoreGuards/${state.academyId}/events/0`]: controlPlane.event,
  };
};

const saveInput = (overrides: Partial<SaveClientProfileInput> = {}): SaveClientProfileInput => ({
  academyId: "academy-1",
  userId: "user-1",
  email: "adult@example.com",
  displayName: "Adult Account",
  requestId: "profile-request-1",
  fullName: "Adult Example",
  dateOfBirth: "1990-03-14",
  phoneNumber: "+1 201 555 0199",
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  now: "2026-09-03T12:00:00.000Z",
  ...overrides,
});

const createCanonicalStore = (
  firestore: AtomicProfileFirestore,
  overrides: Partial<Omit<ProfileStoreDependencies, "firestore">> = {},
) => {
  let studentSequence = 0;
  let auditSequence = 0;
  return createProfileStore({
    firestore,
    projectId: "demo-bpt-jersey",
    identitySecretMaterial: identitySecret,
    identitySecretVersion: "identity-v1",
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    generateStudentId: () => `student-${++studentSequence}`,
    generateAuditId: () => `audit-profile-${++auditSequence}`,
    ...overrides,
  });
};

describe("canonical adult profile directory linking", () => {
  it("creates the user, self family, student, HMAC reservation, control-plane transition, receipt and audits atomically", async () => {
    const firestore = new AtomicProfileFirestore(canonicalControlPlane());
    const store = createCanonicalStore(firestore);

    const result = await store.saveClientProfile(saveInput());

    expect(result.student.studentId).toBe("student-1");
    const familyId = result.student.familyId;
    expect(familyId).toMatch(/^adult-[a-f0-9]{64}$/u);
    if (familyId === undefined) throw new Error("Expected an adult self family");
    expect(firestore.records.get(`academies/academy-1/families/${familyId}`)).toMatchObject({
      familyId,
      academyId: "academy-1",
      primaryContactUserId: "user-1",
      billingContactUserId: "user-1",
      active: true,
      status: "active",
    });
    const keyId = deriveStudentIdentityKeyId({
      academyId: "academy-1",
      kind: "auth-user-id",
      value: "user-1",
      secretMaterial: identitySecret,
    });
    expect(firestore.records.get(`academies/academy-1/studentIdentityKeys/${keyId}`)).toMatchObject(
      {
        academyId: "academy-1",
        kind: "auth-user-id",
        ownerStudentId: "student-1",
        secretVersion: "identity-v1",
      },
    );
    expect(
      firestore.records.get("academies/academy-1/memberDirectoryStates/current"),
    ).toMatchObject({ stateRevision: 1, rollbackEligibleStudentCount: 3 });
    expect(firestore.records.get("memberDirectoryRestoreGuards/academy-1")).toMatchObject({
      highestStateRevision: 1,
    });
    expect(firestore.records.get("memberDirectoryRestoreGuards/academy-1/events/1")).toMatchObject({
      transitionKind: "adult-auth-link",
      previousStateRevision: 0,
      currentStateRevision: 1,
    });

    const receiptEntry = [...firestore.records.entries()].find(([path]) =>
      path.includes("/profileWriteReceipts/"),
    );
    expect(receiptEntry?.[1]).toMatchObject({
      academyId: "academy-1",
      status: "completed",
      studentId: "student-1",
      familyId,
      auditEventId: "audit-profile-1",
      stateRevisionBefore: 0,
      stateRevisionAfter: 1,
      createdStudent: true,
      createdFamily: true,
      familyAuditEventId: expect.any(String),
      schemaVersion: "1",
    });
    expect(firestore.records.get("academies/academy-1/auditEvents/audit-profile-1")).toMatchObject({
      action: "member.created",
      actorId: "user-1",
      targetRef: "academies/academy-1/students/student-1",
      correlationId: receiptEntry?.[1].receiptId,
      result: "completed",
      schemaVersion: 1,
      occurredAt: expect.anything(),
    });
    const familyAuditEntry = [...firestore.records.entries()].find(
      ([, value]) => value.action === "family.created",
    );
    expect(familyAuditEntry?.[0]).toMatch(/^academies\/academy-1\/auditEvents\/adult-family-/u);
    expect(familyAuditEntry?.[1]).toMatchObject({
      action: "family.created",
      actorId: "user-1",
      targetRef: `academies/academy-1/families/${familyId}`,
      result: "completed",
      schemaVersion: 1,
    });

    const operationalMetadata = JSON.stringify([
      receiptEntry?.[1],
      firestore.records.get("academies/academy-1/auditEvents/audit-profile-1"),
      familyAuditEntry?.[1],
    ]);
    expect(operationalMetadata).not.toContain("adult@example.com");
    expect(operationalMetadata).not.toContain("Adult Example");
    expect(operationalMetadata).not.toContain("+1 201 555 0199");
    expect(operationalMetadata).not.toContain("1990-03-14");
    expect(firestore.readTargets.some((path) => path.includes("/members"))).toBe(false);
    expect(firestore.committedWritePaths.some((path) => path.includes("/members"))).toBe(false);
  });

  it("converges an exact retry and rejects a divergent replay without any additional write", async () => {
    const firestore = new AtomicProfileFirestore(canonicalControlPlane());
    const store = createCanonicalStore(firestore);

    const first = await store.saveClientProfile(saveInput());
    const writeCount = firestore.committedWritePaths.length;
    const replay = await store.saveClientProfile(saveInput());

    expect(replay).toEqual(first);
    expect(firestore.committedWritePaths).toHaveLength(writeCount);
    expect(
      firestore.records.get("academies/academy-1/memberDirectoryStates/current"),
    ).toMatchObject({ stateRevision: 1, rollbackEligibleStudentCount: 3 });

    await expect(
      store.saveClientProfile(saveInput({ fullName: "Divergent Name" })),
    ).rejects.toMatchObject({ code: "replay" } satisfies Partial<ProfileStoreError>);
    expect(firestore.committedWritePaths).toHaveLength(writeCount);
  });

  it("advances the guard for an update without incrementing rollback capacity", async () => {
    const firestore = new AtomicProfileFirestore(canonicalControlPlane());
    const store = createCanonicalStore(firestore);
    await store.saveClientProfile(saveInput());

    const updateInput = saveInput({
      requestId: "profile-request-2",
      fullName: "Adult Updated",
      now: "2026-09-03T12:05:00.000Z",
    });
    const updated = await store.saveClientProfile(updateInput);
    const replayedUpdate = await store.saveClientProfile(updateInput);

    expect(replayedUpdate).toEqual(updated);
    expect(updated.student).toMatchObject({
      studentId: "student-1",
      fullName: "Adult Updated",
      createdAt: "2026-09-03T12:00:00.000Z",
      updatedAt: "2026-09-03T12:05:00.000Z",
    });
    expect(
      firestore.records.get("academies/academy-1/memberDirectoryStates/current"),
    ).toMatchObject({ stateRevision: 2, rollbackEligibleStudentCount: 3 });
    expect(firestore.records.get("memberDirectoryRestoreGuards/academy-1/events/2")).toMatchObject({
      transitionKind: "adult-auth-link",
    });
    expect(firestore.records.get("academies/academy-1/auditEvents/audit-profile-2")).toMatchObject({
      action: "member.updated",
    });
    expect(
      [...firestore.records.keys()].filter((path) => path.includes("/studentIdentityKeys/")),
    ).toHaveLength(1);
  });

  it("fails closed with zero writes for a conflicting reservation, exhausted rollback capacity, or failed commit", async () => {
    const conflictingKey = buildStudentIdentityKey({
      academyId: "academy-1",
      kind: "auth-user-id",
      value: "user-1",
      ownerStudentId: "other-student",
      secretMaterial: identitySecret,
      secretVersion: "identity-v1",
      now: "2026-09-03T10:00:00.000Z",
      actorId: "system-1",
    });
    const conflicting = new AtomicProfileFirestore({
      ...canonicalControlPlane(),
      [`academies/academy-1/studentIdentityKeys/${conflictingKey.keyId}`]: conflictingKey,
    });
    await expect(
      createCanonicalStore(conflicting).saveClientProfile(saveInput()),
    ).rejects.toMatchObject({ code: "conflict" } satisfies Partial<ProfileStoreError>);
    expect(conflicting.committedWritePaths).toHaveLength(0);

    const capacityState = canonicalState({ rollbackEligibleStudentCount: 400 });
    const atCapacity = new AtomicProfileFirestore(canonicalControlPlane(capacityState));
    await expect(
      createCanonicalStore(atCapacity).saveClientProfile(saveInput()),
    ).rejects.toMatchObject({ code: "capacity" } satisfies Partial<ProfileStoreError>);
    expect(atCapacity.committedWritePaths).toHaveLength(0);

    const failedCommit = new AtomicProfileFirestore(canonicalControlPlane());
    failedCommit.failCommit = true;
    await expect(createCanonicalStore(failedCommit).saveClientProfile(saveInput())).rejects.toThrow(
      "synthetic commit failure",
    );
    expect(failedCommit.records.has("academies/academy-1/users/user-1")).toBe(false);
    expect(failedCommit.records.has("academies/academy-1/students/student-1")).toBe(false);
    expect(failedCommit.committedWritePaths).toHaveLength(0);
  });

  it("fails closed for incomplete coverage, a secret-version mismatch, a tampered guard event, and invalid production binding", async () => {
    const incompleteRecord = {
      ...canonicalState(),
      identityKeyCoverage: "incomplete",
    } as Record<string, unknown>;
    delete incompleteRecord.identityKeyBaselineMac;
    delete incompleteRecord.identityKeyBaselineArtifactId;
    const incomplete = new AtomicProfileFirestore(
      canonicalControlPlane(incompleteRecord as unknown as MemberDirectoryState),
    );
    await expect(
      createCanonicalStore(incomplete).saveClientProfile(saveInput()),
    ).rejects.toMatchObject({ code: "unavailable" } satisfies Partial<ProfileStoreError>);
    expect(incomplete.committedWritePaths).toHaveLength(0);

    const mismatchedVersion = new AtomicProfileFirestore(
      canonicalControlPlane(canonicalState({ secretVersion: "identity-v2" })),
    );
    await expect(
      createCanonicalStore(mismatchedVersion).saveClientProfile(saveInput()),
    ).rejects.toMatchObject({ code: "unavailable" } satisfies Partial<ProfileStoreError>);
    expect(mismatchedVersion.committedWritePaths).toHaveLength(0);

    const validControl = canonicalControlPlane();
    const eventPath = "memberDirectoryRestoreGuards/academy-1/events/0";
    const tampered = new AtomicProfileFirestore({
      ...validControl,
      [eventPath]: {
        ...(validControl[eventPath] as ProfileDocumentData),
        eventMac: "b".repeat(64),
      },
    });
    await expect(
      createCanonicalStore(tampered).saveClientProfile(saveInput()),
    ).rejects.toMatchObject({ code: "unavailable" } satisfies Partial<ProfileStoreError>);
    expect(tampered.committedWritePaths).toHaveLength(0);

    const firestore = new AtomicProfileFirestore(canonicalControlPlane());
    expect(() => createCanonicalStore(firestore, { projectId: "" })).toThrow(ProfileStoreError);
    expect(() =>
      createCanonicalStore(firestore, {
        integritySecretMaterial: identitySecret,
      }),
    ).toThrow(ProfileStoreError);
  });
});
