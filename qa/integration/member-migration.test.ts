import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MemberRecord } from "@bpt-jersey/domain/members";
import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import { MEMBER_MIGRATION_ID } from "@bpt-jersey/domain/members/migration";
import type { RegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
import { createCanonicalMemberDirectoryService } from "../../apps/functions/src/members/canonical-member-directory-service.js";
import { createMemberDirectoryFirestoreAdapters } from "../../apps/functions/src/members/member-directory-firestore.js";
import { buildInitialMemberDirectoryControlPlane } from "../../apps/functions/src/members/member-directory-state.js";
import { createFirestoreMemberMigrationStore } from "../../apps/functions/src/members/member-migration-firestore.js";
import { createMemberMigrationService } from "../../apps/functions/src/members/member-migration-service.js";
import { revertPlan } from "../scripts/member-unification-s1-revert.mjs";

const enabled =
  process.env.BPT_TEST_INTEGRATION === "true" &&
  ["127.0.0.1:8080", "127.0.0.1:18080"].includes(process.env.FIRESTORE_EMULATOR_HOST ?? "");
const suite = enabled ? describe : describe.skip;
const projectId = "demo-bpt-jersey";
const identitySecretMaterial = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const now = "2026-09-19T10:00:00.000Z";

suite("member migration Firestore transaction integration", () => {
  const academyId = "migration-" + randomUUID();
  const root = `academies/${academyId}`;
  const actor = {
    actorId: "migration-owner",
    academyId,
    role: "owner" as const,
    active: true,
    appCheckVerified: true,
  };
  let app: ReturnType<typeof initializeApp>;
  let database: ReturnType<typeof getFirestore>;
  let service: ReturnType<typeof createMemberMigrationService>;

  const memberBase = {
    academyId,
    paymentStatus: "unknown",
    gender: "unknown",
    membershipStatus: "active",
    createdAt: now,
    createdBy: actor.actorId,
    updatedAt: now,
    updatedBy: actor.actorId,
    source: "integration",
    schemaVersion: "1",
  } as const;
  const members: MemberRecord[] = [
    {
      ...memberBase,
      memberId: "m1",
      fullName: "Synthetic Linked Adult",
      birthDate: "1990-01-01",
      membershipNumber: "42",
    },
    {
      ...memberBase,
      memberId: "m2",
      fullName: "Synthetic Unmatched Adult",
      birthDate: "1991-02-02",
    },
    { ...memberBase, memberId: "m3", fullName: "Synthetic Minor", birthDate: "2015-03-03" },
  ];
  const recordBase = {
    gender: "unknown",
    membershipState: "active",
    appAccess: {},
    graduation: { belt: "Synthetic historical belt" },
    plan: {},
    attendance: { records: [] },
    payments: [],
    capturedAt: now,
    source: "regyfit-admin-capture",
    schemaVersion: "1",
  } as const;
  const records: RegyfitMemberRecord[] = [
    {
      ...recordBase,
      recordId: "10",
      fullName: "Synthetic Linked Adult",
      birthDate: "1990-01-01",
      memberNumber: "42",
    },
    {
      ...recordBase,
      recordId: "11",
      fullName: "Synthetic Archive Only",
      birthDate: "1992-04-04",
      memberNumber: "99",
    },
  ];

  // Firestore map order is unspecified. Compare stable UTF-8 bytes for every field and document.
  function bytes(value: unknown): Buffer {
    return Buffer.from(
      JSON.stringify(value, (_key, item: unknown) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
        }
        return item;
      }),
    );
  }
  async function documents(
    collection: string,
  ): Promise<(Record<string, unknown> & { id: string })[]> {
    const snapshot = await database.collection(`${root}/${collection}`).get();
    return snapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
  }
  async function expectSourcesUnchanged() {
    expect(bytes(await documents("members"))).toEqual(
      bytes(members.map((member) => ({ ...member, id: member.memberId }))),
    );
    expect(bytes(await documents("regyfitMemberRecords"))).toEqual(
      bytes(records.map((record) => ({ ...record, id: record.recordId }))),
    );
  }

  beforeAll(async () => {
    if (!enabled) throw new Error("Loopback emulator binding is required");
    app = initializeApp({ projectId }, academyId);
    database = getFirestore(app);
    const state: MemberDirectoryState = {
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
      rollbackEligibleStudentCount: 0,
      operationPhase: "idle",
      lastCommittedChunkNo: 0,
      schemaVersion: "1",
      createdAt: now,
      createdBy: "system-1",
      updatedAt: now,
      updatedBy: "system-1",
    };
    const control = buildInitialMemberDirectoryControlPlane({
      projectId,
      state,
      integritySecretMaterial,
      integritySecretVersion: "integrity-v1",
      now,
      actorId: "system-1",
    });
    const batch = database.batch();
    batch.set(database.doc(`${root}/memberDirectoryStates/current`), state);
    batch.set(database.doc(`memberDirectoryRestoreGuards/${academyId}`), control.guard);
    batch.set(database.doc(`memberDirectoryRestoreGuards/${academyId}/events/0`), control.event);
    batch.set(database.doc(`${root}/users/${actor.actorId}`), {
      userId: actor.actorId,
      academyId,
      accountType: "staff",
      displayName: "Synthetic Owner",
      email: "owner@example.test",
      authProvider: "google",
      active: true,
      adminRole: "owner",
      lastRoleChangeAuditId: "audit-1",
      createdAt: Timestamp.fromDate(new Date(now)),
      createdBy: actor.actorId,
      updatedAt: Timestamp.fromDate(new Date(now)),
      updatedBy: actor.actorId,
      status: "active",
      schemaVersion: 1,
    });
    for (const member of members)
      batch.set(database.doc(`${root}/members/${member.memberId}`), member);
    for (const record of records)
      batch.set(database.doc(`${root}/regyfitMemberRecords/${record.recordId}`), record);
    await batch.commit();
    service = createMemberMigrationService({
      store: createFirestoreMemberMigrationStore(database),
      writer: createCanonicalMemberDirectoryService({
        firestore: createMemberDirectoryFirestoreAdapters(database).writer,
        projectId,
        identitySecretMaterial,
        integritySecretMaterial,
        identitySecretVersion: "identity-v1",
        integritySecretVersion: "integrity-v1",
      }),
      now: () => now,
    });
  });

  afterAll(async () => {
    if (database) {
      await database.recursiveDelete(database.doc(root));
      await database.recursiveDelete(database.doc(`memberDirectoryRestoreGuards/${academyId}`));
    }
    if (app) await deleteApp(app);
  });

  it("lists, applies, rejects replay and minors, preserves sources and reverts persisted migration records", async () => {
    const queue = await service.listQueue(actor);
    expect(queue.rows).toHaveLength(3);
    expect(queue.rows.find((row) => row.legacyMemberId === "m1")).toMatchObject({
      category: "strong",
      isMinor: false,
      candidates: [{ recordId: "10", reason: "member-number" }],
    });
    expect(queue.rows.find((row) => row.legacyMemberId === "m2")).toMatchObject({
      category: "none",
      isMinor: false,
      candidates: [],
    });
    expect(queue.rows.find((row) => row.legacyMemberId === "m3")).toMatchObject({ isMinor: true });
    expect(queue.archiveOnly).toBe(1);
    expect(queue.decided).toBe(0);

    const training = { trainingCenter: "Town", trainingTimePreferences: ["evening"] };
    const link = {
      kind: "link",
      legacyMemberId: "m1",
      recordId: "10",
      requestId: randomUUID(),
      ...training,
    };
    const applied = await service.decide(actor, {
      decisions: [
        link,
        { kind: "create-unlinked", legacyMemberId: "m2", requestId: randomUUID(), ...training },
      ],
    });
    expect(applied.results).toEqual([
      { legacyMemberId: "m1", status: "applied", studentId: expect.any(String) },
      { legacyMemberId: "m2", status: "applied", studentId: expect.any(String) },
    ]);
    expect(await documents("students")).toHaveLength(2);
    const keys = await documents("studentIdentityKeys");
    for (const result of applied.results) {
      if (result.status !== "applied" || !result.studentId)
        throw new Error("Expected a created student");
      const student = (await database.doc(`${root}/students/${result.studentId}`).get()).data();
      expect(student).toMatchObject({
        studentId: result.studentId,
        participantType: "adult",
        ...training,
      });
      // Migration provenance lives on the admin profile, not the student document.
      expect(
        (await database.doc(`${root}/studentAdminProfiles/${result.studentId}`).get()).data(),
      ).toMatchObject({
        studentId: result.studentId,
        source: "legacy-member-migration",
        migrationId: MEMBER_MIGRATION_ID,
        legacyMemberId: result.legacyMemberId.toUpperCase(),
      });
      expect(
        (
          await database.doc(`${root}/memberMigrationDecisions/${result.legacyMemberId}`).get()
        ).data(),
      ).toMatchObject({
        studentId: result.studentId,
        legacyMemberId: result.legacyMemberId,
        migrationId: MEMBER_MIGRATION_ID,
        decidedBy: actor.actorId,
        kind: result.legacyMemberId === "m1" ? "link" : "create-unlinked",
        ...training,
      });
      expect(
        keys.filter(
          (key) =>
            key.id.startsWith("legacy-member-id:") && key.ownerStudentId === result.studentId,
        ),
      ).toHaveLength(1);
      if (result.legacyMemberId === "m1") {
        expect((await database.doc(`${root}/regyfitOfficeLinks/10`).get()).data()).toMatchObject({
          recordId: "10",
          studentId: result.studentId,
        });
      }
    }
    expect(await documents("memberMigrationDecisions")).toHaveLength(2);
    expect(await documents("regyfitOfficeLinks")).toHaveLength(1);

    const persistedBeforeRejections = bytes(
      await Promise.all([
        documents("students"),
        documents("studentAdminProfiles"),
        documents("studentIdentityKeys"),
        documents("memberMigrationDecisions"),
        documents("regyfitOfficeLinks"),
      ]),
    );
    expect(
      await service.decide(actor, {
        decisions: [
          link,
          { kind: "create-unlinked", legacyMemberId: "m3", requestId: randomUUID(), ...training },
        ],
      }),
    ).toEqual({
      results: [
        { legacyMemberId: "m1", status: "rejected", code: "already-decided" },
        { legacyMemberId: "m3", status: "rejected", code: "minor-deferred" },
      ],
    });
    expect(
      bytes(
        await Promise.all([
          documents("students"),
          documents("studentAdminProfiles"),
          documents("studentIdentityKeys"),
          documents("memberMigrationDecisions"),
          documents("regyfitOfficeLinks"),
        ]),
      ),
    ).toEqual(persistedBeforeRejections);
    await expectSourcesUnchanged();

    const paths = revertPlan({
      decisions: await documents("memberMigrationDecisions"),
      identityKeys: await documents("studentIdentityKeys"),
      officeLinks: await documents("regyfitOfficeLinks"),
    });
    expect(paths.filter((path) => path.startsWith("students/"))).toHaveLength(2);
    expect(paths.filter((path) => path.startsWith("memberMigrationDecisions/"))).toHaveLength(2);
    const batch = database.batch();
    for (const path of paths) batch.delete(database.doc(`${root}/${path}`));
    await batch.commit();
    for (const collection of [
      "students",
      "studentAdminProfiles",
      "studentIdentityKeys",
      "families",
      "regyfitOfficeLinks",
      "memberMigrationDecisions",
    ]) {
      expect(await documents(collection), collection).toEqual([]);
    }
    await expectSourcesUnchanged();
  });
});
