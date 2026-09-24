import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import { HttpsError } from "firebase-functions/v2/https";
import { describe, expect, it } from "vitest";

import { buildInitialMemberDirectoryControlPlane } from "../members/member-directory-state.js";
import {
  createOwnEmergencyContactService,
  directoryBusyMessage,
  type OwnContactFirestore,
  type OwnContactQuery,
  type OwnContactReference,
} from "./own-emergency-contact";

const academyId = "demo-academy";
const base = `academies/${academyId}`;
const now = "2026-09-25T10:00:00.000Z";
const requestId = "8f14e45f-ceea-4e6b-9c1c-3a9d1e2b7c10";
const integritySecret = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const contact = { fullName: "Ana Silva", relationship: "Mother", phoneNumber: "+44 7700 900123" };
type Data = Record<string, unknown>;

const audit = {
  schemaVersion: "1",
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "office-1",
  updatedAt: "2026-01-01T00:00:00.000Z",
  updatedBy: "office-1",
};
const user = (userId: string): Data => ({
  userId,
  academyId,
  accountType: "client",
  displayName: userId,
  email: `${userId}@example.test`,
  phoneNumber: "+44 7700 900000",
  active: true,
  status: "active",
  ...audit,
});
const student = (studentId: string, extra: Data): Data => ({
  studentId,
  academyId,
  fullName: `Member ${studentId}`,
  trainingCenter: "Town",
  trainingTimePreferences: ["evening"],
  active: true,
  status: "active",
  ...audit,
  ...extra,
});
const relationship = (studentId: string, extra: Data = {}): Data => ({
  relationshipId: `family-1--${studentId}`,
  academyId,
  familyId: "family-1",
  studentId,
  adultUserId: "guardian-1",
  relationshipType: "guardian",
  permissions: ["readProfile"],
  validFrom: "2026-01-01T00:00:00.000Z",
  active: true,
  status: "active",
  ...audit,
  ...extra,
});
const directoryState = (overrides: Partial<MemberDirectoryState> = {}): MemberDirectoryState => ({
  stateId: "current",
  academyId,
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
  createdAt: "2026-09-01T10:00:00.000Z",
  createdBy: "system-1",
  updatedAt: "2026-09-01T10:00:00.000Z",
  updatedBy: "system-1",
  ...overrides,
});
function controlPlane(state: MemberDirectoryState): Record<string, Data> {
  const plane = buildInitialMemberDirectoryControlPlane({
    projectId: "demo-bpt-jersey",
    state,
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    now: state.createdAt,
    actorId: "system-1",
  });
  return {
    [`${base}/memberDirectoryStates/current`]: state,
    [`memberDirectoryRestoreGuards/${academyId}`]: plane.guard,
    [`memberDirectoryRestoreGuards/${academyId}/events/0`]: plane.event,
  };
}

function seed(overrides: Record<string, Data> = {}): Record<string, Data> {
  return {
    [`${base}/users/adult-1`]: user("adult-1"),
    [`${base}/users/guardian-1`]: user("guardian-1"),
    [`${base}/students/student-adult`]: student("student-adult", {
      userId: "adult-1",
      dateOfBirth: "1990-01-01",
      participantType: "adult",
    }),
    [`${base}/students/student-child-a`]: student("student-child-a", {
      familyId: "family-1",
      dateOfBirth: "2015-01-01",
      participantType: "minor",
    }),
    [`${base}/students/student-child-b`]: student("student-child-b", {
      familyId: "family-1",
      dateOfBirth: "2016-01-01",
      participantType: "minor",
    }),
    [`${base}/families/family-1`]: {
      familyId: "family-1",
      academyId,
      primaryContactUserId: "guardian-1",
      billingContactUserId: "guardian-1",
      active: true,
      status: "active",
      ...audit,
    },
    [`${base}/relationships/family-1--student-child-a`]: relationship("student-child-a"),
    [`${base}/relationships/family-1--student-child-b`]: relationship("student-child-b"),
    ...controlPlane(directoryState()),
    ...overrides,
  };
}

function fakeFirestore(initial: Record<string, Data>) {
  const docs = new Map(Object.entries(initial));
  const writes: string[] = [];
  const snapshot = (path: string) => ({
    id: path.split("/").at(-1) ?? "",
    exists: docs.has(path),
    data: () => docs.get(path),
  });
  const firestore: OwnContactFirestore = {
    doc: (path) => ({ id: path.split("/").at(-1) ?? "", path }),
    collection: (path) => ({
      where: (field, _operator, value) => ({
        limit: (limit) => ({ path, field, value, limit }),
      }),
    }),
    runTransaction: async (callback) => {
      const staged = new Map<string, Data>();
      const result = await callback({
        get: async (target: OwnContactReference | OwnContactQuery) => {
          if ("field" in target) {
            return {
              docs: [...docs.keys()]
                .filter(
                  (path) =>
                    path.startsWith(`${target.path}/`) &&
                    !path.slice(target.path.length + 1).includes("/") &&
                    docs.get(path)?.[target.field] === target.value,
                )
                .slice(0, target.limit)
                .map(snapshot),
            };
          }
          return snapshot(target.path);
        },
        set: (ref, data) => staged.set(ref.path, { ...data }),
        create: (ref, data) => {
          if (docs.has(ref.path) || staged.has(ref.path)) throw new Error(`exists: ${ref.path}`);
          staged.set(ref.path, { ...data });
        },
      });
      for (const [path, data] of staged) {
        docs.set(path, data);
        writes.push(path);
      }
      return result;
    },
  };
  return { firestore, docs, writes };
}

/** Reads authorise through this stub; saves use the real member access service on the seeded data. */
const links: Record<string, readonly string[]> = {
  "adult-1": ["student-adult"],
  "guardian-1": ["student-child-a", "student-child-b"],
};
async function resolveAccess(academy: string, userId: string, studentId: string) {
  if (academy === academyId && links[userId]?.includes(studentId)) return studentId;
  throw new HttpsError("permission-denied", "Member profile is unavailable");
}

function service(initial: Record<string, Data> = seed()) {
  const store = fakeFirestore(initial);
  let auditCount = 0;
  return {
    ...store,
    service: createOwnEmergencyContactService({
      firestore: store.firestore,
      projectId: "demo-bpt-jersey",
      identitySecretVersion: "identity-v1",
      integritySecretMaterial: integritySecret,
      integritySecretVersion: "integrity-v1",
      resolveAccess,
      readDocument: async (path) => store.docs.get(path),
      now: () => now,
      generateAuditId: () => `audit-${++auditCount}`,
    }),
  };
}

const profilePath = (studentId: string) => `${base}/studentAdminProfiles/${studentId}`;

describe("own emergency contact", () => {
  it("lets a member save their own emergency contact, advancing the directory once", async () => {
    const { service: s, docs } = service();
    const actor = { userId: "adult-1", academyId };

    await expect(
      s.save(actor, { studentId: "student-adult", contact, requestId }),
    ).resolves.toEqual({ saved: true });

    const stored = docs.get(profilePath("student-adult"));
    expect(stored?.emergencyContact).toEqual(contact);
    expect(stored?.updatedBy).toBe("adult-1");
    expect(stored?.gender).toBe("unknown");
    expect(docs.get(`${base}/memberDirectoryStates/current`)?.stateRevision).toBe(1);
    expect(docs.get(`memberDirectoryRestoreGuards/${academyId}`)?.lastEventId).toBe("1");
    expect(docs.get(`memberDirectoryRestoreGuards/${academyId}/events/1`)?.transitionKind).toBe(
      "canonical-identity-update",
    );
    const auditEvent = docs.get(`${base}/auditEvents/audit-1`);
    expect(auditEvent?.action).toBe("member.updated");
    expect(auditEvent?.targetRef).toBe(`${base}/students/student-adult`);

    await expect(s.get(actor, { studentId: "student-adult" })).resolves.toEqual({ contact });
  });

  it("lets a guardian save for their child and keeps the rest of the office profile", async () => {
    const existing = {
      studentId: "student-child-b",
      academyId,
      gender: "female",
      membershipNumber: "BPT-0042",
      source: "admin",
      ...audit,
    };
    const { service: s, docs } = service(seed({ [profilePath("student-child-b")]: existing }));

    await s.save(
      { userId: "guardian-1", academyId },
      { studentId: "student-child-b", contact, requestId },
    );

    expect(docs.get(profilePath("student-child-b"))).toMatchObject({
      gender: "female",
      membershipNumber: "BPT-0042",
      createdBy: "office-1",
      emergencyContact: contact,
      updatedAt: now,
      updatedBy: "guardian-1",
    });
  });

  it("refuses anyone who is neither the member nor their guardian, without writing", async () => {
    const { service: s, writes } = service();
    const stranger = { userId: "adult-1", academyId };

    await expect(
      s.save(stranger, { studentId: "student-child-a", contact, requestId }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(s.get(stranger, { studentId: "student-child-a" })).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(writes).toEqual([]);
  });

  it("refuses a guardian whose relationship has been revoked, checked inside the write", async () => {
    const { service: s, writes } = service(
      seed({
        [`${base}/relationships/family-1--student-child-a`]: relationship("student-child-a", {
          active: false,
          status: "inactive",
        }),
      }),
    );

    await expect(
      s.save(
        { userId: "guardian-1", academyId },
        { studentId: "student-child-a", contact, requestId },
      ),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(writes).toEqual([]);
  });

  it("is unavailable while the directory writer is not ready, and writes nothing", async () => {
    // A valid state the canonical writer must refuse: identity keys are still being covered.
    const notReady = Object.fromEntries(
      Object.entries(directoryState({ identityKeyCoverage: "incomplete" })).filter(
        ([key]) => !key.startsWith("identityKeyBaseline"),
      ),
    ) as MemberDirectoryState;
    const { service: s, writes } = service(seed(controlPlane(notReady)));

    await expect(
      s.save({ userId: "adult-1", academyId }, { studentId: "student-adult", contact, requestId }),
    ).rejects.toMatchObject({ code: "unavailable", message: directoryBusyMessage });
    expect(writes).toEqual([]);
  });

  it("is unavailable when the directory guard is missing", async () => {
    const records = seed();
    delete records[`memberDirectoryRestoreGuards/${academyId}`];
    const { service: s, writes } = service(records);

    await expect(
      s.save({ userId: "adult-1", academyId }, { studentId: "student-adult", contact, requestId }),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(writes).toEqual([]);
  });

  it.each([
    ["an empty phone number", { ...contact, phoneNumber: "" }],
    ["a relationship over 80 characters", { ...contact, relationship: "x".repeat(81) }],
    ["an untrimmed name", { ...contact, fullName: " Ana " }],
  ])("rejects %s as invalid-argument", async (_label, bad) => {
    const { service: s, writes } = service();

    await expect(
      s.save(
        { userId: "adult-1", academyId },
        { studentId: "student-adult", contact: bad, requestId },
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(writes).toEqual([]);
  });

  it("rejects a request id that is not a UUID", async () => {
    const { service: s } = service();

    await expect(
      s.save(
        { userId: "adult-1", academyId },
        { studentId: "student-adult", contact, requestId: "not-a-uuid" },
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("writes once when the same request is sent twice", async () => {
    const { service: s, writes, docs } = service();
    const actor = { userId: "adult-1", academyId };
    const input = { studentId: "student-adult", contact, requestId };

    await s.save(actor, input);
    const afterFirst = writes.length;
    await expect(s.save(actor, input)).resolves.toEqual({ saved: true });

    expect(afterFirst).toBe(6);
    expect(writes.length).toBe(afterFirst);
    expect(docs.get(`${base}/memberDirectoryStates/current`)?.stateRevision).toBe(1);
  });

  it("refuses a retry that reuses the request id with different details", async () => {
    const { service: s, writes } = service();
    const actor = { userId: "adult-1", academyId };

    await s.save(actor, { studentId: "student-adult", contact, requestId });
    const afterFirst = writes.length;
    await expect(
      s.save(actor, {
        studentId: "student-adult",
        contact: { ...contact, phoneNumber: "+44 7700 900999" },
        requestId,
      }),
    ).rejects.toMatchObject({ code: "failed-precondition" });
    expect(writes.length).toBe(afterFirst);
  });

  it("returns null when no emergency contact is stored", async () => {
    const { service: s } = service();

    await expect(
      s.get({ userId: "guardian-1", academyId }, { studentId: "student-child-a" }),
    ).resolves.toEqual({ contact: null });
  });
});
