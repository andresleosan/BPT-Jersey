import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
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
  const queueAcademyId = academyId + "-queue";
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
      await database.recursiveDelete(database.doc(`academies/${queueAcademyId}`));
      await database.recursiveDelete(database.doc(`memberDirectoryRestoreGuards/${academyId}`));
    }
    if (app) await deleteApp(app);
  });
  it("persists a name-only ticket without an automatic account link", async () => {
    const ticket = await service.begin({ fullName: "Synthetic Member" }, "192.0.2.3");
    expect(await service.complete({ recoveryId: ticket.recoveryId }, "name-only-account")).toEqual({
      status: "pending-review",
    });
    const saved = (
      await database.doc(root + "memberRecoveryRequests/" + ticket.recoveryId).get()
    ).data();
    expect(saved).toMatchObject({
      previousEmail: "",
      accountVerified: true,
      status: "pending-review",
    });
    expect(saved?.candidates).toHaveLength(1);
    expect(
      (
        await database
          .collection(root + "regyfitMemberLinks")
          .where("userId", "==", "name-only-account")
          .get()
      ).size,
    ).toBe(0);
    expect(claims.has("name-only-account")).toBe(false);
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
    const pending = await Promise.all([
      service.complete({ recoveryId: a.recoveryId, profile }, "account-a"),
      service.complete({ recoveryId: b.recoveryId, profile }, "account-b"),
    ]);
    expect(pending).toEqual([{ status: "pending-review" }, { status: "pending-review" }]);
    const actor = {
      actorId: "recovery-office",
      academyId,
      role: "owner" as const,
      active: true,
      appCheckVerified: true,
    };
    await database.doc(root + "users/recovery-office").set({
      userId: actor.actorId,
      academyId,
      accountType: "staff",
      displayName: "Office",
      email: "office@example.test",
      authProvider: "google",
      active: true,
      adminRole: "owner",
      lastRoleChangeAuditId: "audit-1",
      createdAt: Timestamp.now(),
      createdBy: actor.actorId,
      updatedAt: Timestamp.now(),
      updatedBy: actor.actorId,
      status: "active",
      schemaVersion: 1,
    });
    const detail = await service.detail({ requestId: a.recoveryId }, actor);
    const approved = await service.review(
      {
        requestId: a.recoveryId,
        decision: "approve",
        candidateId: detail.candidates[0]!.candidateId,
        identityConfirmed: true,
      },
      actor,
    );
    expect(approved.status).toBe("linked");
    const outcomes = [
      approved,
      await service.complete({ recoveryId: b.recoveryId, profile }, "account-b"),
    ];
    expect(outcomes.map((value) => value.status)).toEqual(["linked", "pending-review"]);
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
  it("queries actionable verified work before its limit and reaches all 65 requests after resolutions", async () => {
    const queueRoot = `academies/${queueAcademyId}/`;
    const actor = {
      actorId: "queue-office",
      academyId: queueAcademyId,
      role: "owner" as const,
      active: true,
      appCheckVerified: true,
    };
    let queueTime = now;
    const queue = createMemberRecoveryService({
      firestore: database,
      academyId: queueAcademyId,
      projectId,
      identitySecretMaterial,
      integritySecretMaterial,
      identitySecretVersion: "identity-v1",
      integritySecretVersion: "integrity-v1",
      now: () => queueTime,
      auth: {
        getUser: async (uid) => ({
          uid,
          disabled: false,
          emailVerified: true,
          email: "member@example.test",
        }),
        setCustomUserClaims: async () => {},
      },
    });
    const batch = database.batch();
    batch.set(database.doc(queueRoot + "users/queue-office"), {
      userId: actor.actorId,
      academyId: queueAcademyId,
      accountType: "staff",
      displayName: "Office",
      email: "office@example.test",
      authProvider: "google",
      active: true,
      adminRole: "owner",
      lastRoleChangeAuditId: "audit-1",
      createdAt: Timestamp.now(),
      createdBy: actor.actorId,
      updatedAt: Timestamp.now(),
      updatedBy: actor.actorId,
      status: "active",
      schemaVersion: 1,
    });
    function seed(
      count: number,
      offset: number,
      patch: Record<string, unknown> = {},
      unbound = false,
    ) {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const recoveryId = (offset + i).toString(16).padStart(64, "0");
        ids.push(recoveryId);
        const record: Record<string, unknown> = {
          recoveryId,
          academyId: queueAcademyId,
          fullName: "Synthetic Queue Member",
          previousEmail: "previous@example.test",
          createdAt: new Date(Date.parse("2026-09-17T10:00:00.000Z") + i * 1000).toISOString(),
          updatedAt: now,
          expiresAt: new Date(Date.parse("2026-10-17T10:00:00.000Z") + i * 1000).toISOString(),
          candidates: [],
          userId: "member-" + i,
          accountEmail: "current@example.test",
          accountVerified: true,
          status: "pending-review",
          ...patch,
        };
        if (unbound) {
          delete record.userId;
          delete record.accountEmail;
        }
        batch.set(database.doc(queueRoot + "memberRecoveryRequests/" + recoveryId), record);
      }
      return ids;
    }
    const actionable = seed(65, 1000);
    seed(60, 2000, { status: "rejected" });
    seed(60, 3000, { status: "linked" });
    seed(60, 4000, { expiresAt: "2026-09-18T09:00:00.000Z" });
    seed(60, 5000, { accountVerified: false }, true);
    seed(60, 6000, { accountVerified: false });
    seed(60, 7000, { status: "profile-required", expiresAt: now });
    await batch.commit();
    const first = await queue.list(actor);
    expect(first.truncated).toBe(true);
    expect(first.requests.map((request) => request.requestId)).toEqual(actionable.slice(0, 50));
    for (let i = 0; i < 50; i++) {
      if (i % 20 === 0)
        queueTime = new Date(Date.parse(now) + Math.floor(i / 20) * 16 * 60000).toISOString();
      await queue.review({ requestId: actionable[i], decision: "reject" }, actor);
    }
    const remaining = await queue.list(actor);
    expect(remaining.truncated).toBe(false);
    expect(remaining.requests.map((request) => request.requestId)).toEqual(actionable.slice(50));
    await database
      .doc(queueRoot + "memberRecoveryRequests/" + actionable[50])
      .update({ expiresAt: now });
    expect((await queue.list(actor)).requests.map((request) => request.requestId)).toEqual(
      actionable.slice(51),
    );
  });
});
