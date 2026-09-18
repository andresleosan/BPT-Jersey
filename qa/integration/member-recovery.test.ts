import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";
import { buildInitialMemberDirectoryControlPlane } from "../../apps/functions/src/members/member-directory-state.js";
import { createMemberRecoveryService } from "../../apps/functions/src/members/member-recovery-service.js";

const enabled =
  process.env.BPT_TEST_INTEGRATION === "true" &&
  ["127.0.0.1:8080", "127.0.0.1:18080"].includes(process.env.FIRESTORE_EMULATOR_HOST ?? "");
const suite = enabled ? describe : describe.skip;
const projectId = "demo-bpt-jersey";
const identitySecretMaterial = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecretMaterial = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const now = "2026-09-18T10:00:00.000Z";
suite("member recovery Firestore transaction integration", () => {
  const academyId = "recovery-" + randomUUID();
  const root = `academies/${academyId}/`;
  let app: ReturnType<typeof initializeApp>;
  let database: ReturnType<typeof getFirestore>;
  let service: ReturnType<typeof createMemberRecoveryService>;
  const claims = new Map<string, Record<string, unknown>>();
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
    await Promise.all([
      database.doc(root + "memberDirectoryStates/current").set(state),
      database.doc(`memberDirectoryRestoreGuards/${academyId}`).set(control.guard),
      database.doc(`memberDirectoryRestoreGuards/${academyId}/events/0`).set(control.event),
      database.doc(root + "regyfitMemberRecords/123").set({
        recordId: "123",
        memberNumber: "MEM-123",
        fullName: "Synthetic Member",
        email: "member@example.test",
        mobile: "+15550000001",
        birthDate: "1990-01-01",
        gender: "male",
        membershipState: "active",
        appAccess: {},
        graduation: { belt: "Historical belt" },
        plan: {},
        attendance: { records: [] },
        payments: [],
        capturedAt: now,
        source: "regyfit-admin-capture",
        schemaVersion: "1",
      }),
    ]);
    service = createMemberRecoveryService({
      firestore: database,
      academyId,
      projectId,
      identitySecretMaterial,
      integritySecretMaterial,
      identitySecretVersion: "identity-v1",
      integritySecretVersion: "integrity-v1",
      now: () => now,
      auth: {
        getUser: async (uid) => ({
          uid,
          disabled: false,
          emailVerified: true,
          email: "member@example.test",
          displayName: "Synthetic Member",
          customClaims: claims.get(uid) ?? {},
        }),
        setCustomUserClaims: async (uid, next) => {
          claims.set(uid, next);
        },
      },
    });
  });
  afterAll(async () => {
    if (database) {
      await database.recursiveDelete(database.doc(`academies/${academyId}`));
      await database.recursiveDelete(database.doc(`memberDirectoryRestoreGuards/${academyId}`));
    }
    if (app) await deleteApp(app);
  });
  it("serializes two competing identities, persists exactly one canonical student and permits replay", async () => {
    const a = await service.begin(
      { fullName: "Synthetic Member", email: "member@example.test" },
      "192.0.2.1",
    );
    const b = await service.begin(
      { fullName: "Synthetic Member", email: "member@example.test" },
      "192.0.2.2",
    );
    const profile = { trainingCenter: "Town", trainingTimePreferences: ["evening"] };
    const outcomes = await Promise.all([
      service.complete({ recoveryId: a.recoveryId, profile }, "account-a"),
      service.complete({ recoveryId: b.recoveryId, profile }, "account-b"),
    ]);
    expect(outcomes.map((value) => value.status).sort()).toEqual(["linked", "pending-review"]);
    const students = await database.collection(root + "students").get();
    expect(students.size).toBe(1);
    const winner =
      outcomes[0]!.status === "linked"
        ? { ticket: a, uid: "account-a" }
        : { ticket: b, uid: "account-b" };
    expect(await service.complete({ recoveryId: winner.ticket.recoveryId }, winner.uid)).toEqual({
      status: "linked",
    });
    expect((await database.collection(root + "students").get()).size).toBe(1);
    expect((await database.collection(root + "regyfitMemberLinks").get()).size).toBe(1);
    expect((await database.collection(root + "memberRecoveryWriteReceipts").get()).size).toBe(1);
    expect(
      (await database.doc(root + "memberDirectoryStates/current").get()).data()?.stateRevision,
    ).toBe(1);
    expect(
      (await database.doc(root + "regyfitMemberRecords/123").get()).data()?.graduation,
    ).toEqual({ belt: "Historical belt" });
    expect(claims.get(winner.uid)).toMatchObject({ academyId, role: "adultStudent" });
  });
});
