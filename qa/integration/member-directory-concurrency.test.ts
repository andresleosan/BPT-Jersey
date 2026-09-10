import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

import type { MemberDirectoryState } from "@bpt-jersey/domain/members/directory";

import {
  createCanonicalMemberDirectoryReadService,
  type CanonicalDirectoryReadStore,
  type ExactMemberLookupResult,
} from "../../apps/functions/src/members/canonical-member-directory-read-service.js";
import {
  createCanonicalMemberDirectoryService,
  type CanonicalMemberDirectoryActor,
} from "../../apps/functions/src/members/canonical-member-directory-service.js";
import { buildStudentIdentityKey } from "../../apps/functions/src/members/member-directory-crypto.js";
import { createMemberDirectoryFirestoreAdapters } from "../../apps/functions/src/members/member-directory-firestore.js";
import {
  advanceMemberDirectoryControlPlane,
  buildInitialMemberDirectoryControlPlane,
} from "../../apps/functions/src/members/member-directory-state.js";
import {
  createProfileStore,
  type ProfileFirestore,
} from "../../apps/functions/src/profiles/profile-service.js";

const projectId = "demo-bpt-jersey";
const runId = "member-directory-concurrency-" + process.pid + "-" + randomUUID().slice(0, 8);
const lookupAcademyId = runId + "-lookup";
const createAcademyId = runId + "-create";
const freezeAcademyId = runId + "-freeze";
const crossWriterAcademyId = runId + "-cross-writer";
const clientUserId = runId + "-client";
const actorId = runId + "-owner";
const lookupStudentId = runId + "-student";
const lookupRawValue = "BPT 99000001";
const now = "2026-09-03T20:01:00.000Z";
const identitySecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const integritySecret = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const cursorSecret = "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8";
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();

function isLocalEmulatorHost(host: string | undefined): boolean {
  if (host === undefined || host === "") return false;
  try {
    const url = new URL("http://" + host);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]") &&
      url.pathname === "/" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

const useLocalEmulator = isLocalEmulatorHost(firestoreEmulatorHost);
if (!useLocalEmulator) {
  console.warn(
    "SKIP member-directory concurrency integration: FIRESTORE_EMULATOR_HOST must be loopback",
  );
}

const app = useLocalEmulator
  ? initializeApp({ projectId }, "member-directory-concurrency-" + runId)
  : undefined;
const firestore = app === undefined ? undefined : getFirestore(app);
const describeLocal = useLocalEmulator ? describe : describe.skip;

const academyCollections = Object.freeze([
  "users",
  "adminRoleLocks",
  "memberDirectoryStates",
  "students",
  "studentAdminProfiles",
  "studentIdentityKeys",
  "studentRestrictedReadLimits",
  "memberDirectoryWriteReceipts",
  "families",
  "profileWriteReceipts",
  "auditEvents",
] as const);

const restrictedAuditFields = Object.freeze([
  "academyId",
  "actorId",
  "action",
  "targetRef",
  "purpose",
  "correlationId",
  "result",
  "auditEventId",
  "occurredAt",
  "schemaVersion",
] as const);

function requireFirestore(): Firestore {
  if (firestore === undefined) {
    throw new Error("Local Firestore emulator is unavailable");
  }
  return firestore;
}

function actor(academyId: string): CanonicalMemberDirectoryActor {
  return Object.freeze({
    actorId,
    academyId,
    role: "owner" as const,
    active: true,
    appCheckVerified: true,
  });
}

function canonicalState(
  academyId: string,
  rollbackEligibleStudentCount: number,
): MemberDirectoryState {
  return {
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
    rollbackEligibleStudentCount,
    operationPhase: "idle",
    lastCommittedChunkNo: 0,
    schemaVersion: "1",
    createdAt: "2026-09-03T20:00:00.000Z",
    createdBy: "system-1",
    updatedAt: "2026-09-03T20:00:00.000Z",
    updatedBy: "system-1",
  };
}

function provisionedAdminDocument(academyId: string): Readonly<Record<string, unknown>> {
  return {
    userId: actorId,
    academyId,
    accountType: "staff",
    displayName: "Synthetic Concurrency Owner",
    email: actorId + "@example.test",
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
  };
}

function lookupStudent(academyId: string): Readonly<Record<string, unknown>> {
  return {
    studentId: lookupStudentId,
    academyId,
    fullName: "Synthetic Lookup Student",
    dateOfBirth: "2000-01-02",
    phoneNumber: "+441534000001",
    email: "lookup-student@example.test",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    participantType: "adult",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-09-03T20:00:00.000Z",
    createdBy: actorId,
    updatedAt: "2026-09-03T20:00:00.000Z",
    updatedBy: actorId,
  };
}

function lookupProfile(academyId: string): Readonly<Record<string, unknown>> {
  return {
    studentId: lookupStudentId,
    academyId,
    membershipNumber: lookupRawValue,
    idCardNumber: "ID-CONCURRENT-1",
    vatNumber: "VAT-CONCURRENT-1",
    gender: "unknown",
    frequencyNote: "Synthetic",
    source: "admin",
    schemaVersion: "1",
    createdAt: "2026-09-03T20:00:00.000Z",
    createdBy: actorId,
    updatedAt: "2026-09-03T20:00:00.000Z",
    updatedBy: actorId,
  };
}

async function seedAcademy(
  academyId: string,
  rollbackEligibleStudentCount: number,
  includeLookupFixture: boolean,
): Promise<string | undefined> {
  const currentFirestore = requireFirestore();
  const state = canonicalState(academyId, rollbackEligibleStudentCount);
  const control = buildInitialMemberDirectoryControlPlane({
    projectId,
    state,
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    now: state.createdAt,
    actorId: "system-1",
  });
  const batch = currentFirestore.batch();
  batch.set(
    currentFirestore.doc("academies/" + academyId + "/users/" + actorId),
    provisionedAdminDocument(academyId),
  );
  batch.set(
    currentFirestore.doc("academies/" + academyId + "/memberDirectoryStates/current"),
    state,
  );
  batch.set(currentFirestore.doc("memberDirectoryRestoreGuards/" + academyId), control.guard);
  batch.set(
    currentFirestore.doc(
      "memberDirectoryRestoreGuards/" + academyId + "/events/" + control.event.eventId,
    ),
    control.event,
  );

  let lookupKeyId: string | undefined;
  if (includeLookupFixture) {
    const key = buildStudentIdentityKey({
      academyId,
      kind: "membership-number",
      value: lookupRawValue,
      ownerStudentId: lookupStudentId,
      secretMaterial: identitySecret,
      secretVersion: "identity-v1",
      now,
      actorId,
    });
    lookupKeyId = key.keyId;
    batch.set(
      currentFirestore.doc("academies/" + academyId + "/students/" + lookupStudentId),
      lookupStudent(academyId),
    );
    batch.set(
      currentFirestore.doc("academies/" + academyId + "/studentAdminProfiles/" + lookupStudentId),
      lookupProfile(academyId),
    );
    batch.set(
      currentFirestore.doc("academies/" + academyId + "/studentIdentityKeys/" + key.keyId),
      key,
    );
  }

  await batch.commit();
  return lookupKeyId;
}

function createReader(store?: CanonicalDirectoryReadStore) {
  const adapters = createMemberDirectoryFirestoreAdapters(requireFirestore());
  return createCanonicalMemberDirectoryReadService({
    store: store ?? adapters.reader,
    identitySecretMaterial: identitySecret,
    identitySecretVersion: "identity-v1",
    cursorSecretMaterial: cursorSecret,
    cursorSecretVersion: "cursor-v1",
    generateAuditId: () => "lookup-audit-" + randomUUID(),
  });
}

function createWriter() {
  const adapters = createMemberDirectoryFirestoreAdapters(requireFirestore());
  return createCanonicalMemberDirectoryService({
    firestore: adapters.writer,
    projectId,
    identitySecretMaterial: identitySecret,
    identitySecretVersion: "identity-v1",
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    generateStudentId: () => "student-" + randomUUID(),
    generateAuditId: () => "create-audit-" + randomUUID(),
  });
}

function lookupCommand(academyId: string) {
  return {
    actor: actor(academyId),
    value: {
      lookupKind: "membership-number" as const,
      value: lookupRawValue,
      purpose: "member-identity-lookup" as const,
    },
    now,
  };
}

function createInput(suffix: string) {
  return {
    requestId: runId + "-create-" + suffix,
    fullName: "Synthetic Concurrent Adult " + suffix,
    dateOfBirth: "2000-01-02",
    phoneNumber: "+44153400000" + suffix,
    email: "concurrent-" + suffix + "@example.test",
    trainingCenter: "Town",
    trainingTimePreferences: ["evening"],
    membershipNumber: "bpt 9900000" + suffix,
    idCardNumber: "id-concurrent-" + suffix,
    vatNumber: "vat-concurrent-" + suffix,
    frequencyNote: "Synthetic",
  } as const;
}

function safeErrorText(reason: unknown): string {
  if (reason instanceof Error) {
    const code =
      "code" in reason ? String((reason as Error & Readonly<{ code?: unknown }>).code) : "";
    return reason.name + " " + reason.message + " " + code;
  }
  return String(reason);
}

function assertSafeRestrictedAudit(
  data: Readonly<Record<string, unknown>>,
  lookupKeyId: string,
): void {
  expect(Object.keys(data).sort()).toEqual([...restrictedAuditFields].sort());
  const serialized = JSON.stringify(data);
  expect(serialized).not.toContain(lookupRawValue);
  expect(serialized).not.toContain(lookupKeyId);
  expect(data).not.toHaveProperty("value");
  expect(data).not.toHaveProperty("raw");
  expect(data).not.toHaveProperty("digest");
  expect(data).not.toHaveProperty("keyId");
  expect(data).not.toHaveProperty("membershipNumber");
  expect(data).not.toHaveProperty("idCardNumber");
  expect(data).not.toHaveProperty("vatNumber");
}

async function deleteCollection(path: string): Promise<void> {
  const currentFirestore = requireFirestore();
  const snapshot = await currentFirestore.collection(path).get();
  if (snapshot.empty) return;
  const batch = currentFirestore.batch();
  snapshot.docs.forEach((document) => batch.delete(document.ref));
  await batch.commit();
}

async function cleanupAcademy(academyId: string): Promise<void> {
  if (!academyId.startsWith(runId + "-")) {
    throw new Error("Refusing non-ephemeral academy cleanup");
  }
  const currentFirestore = requireFirestore();
  await Promise.all(
    academyCollections.map((collectionName) =>
      deleteCollection("academies/" + academyId + "/" + collectionName),
    ),
  );
  await currentFirestore.doc("academies/" + academyId).delete();
  await deleteCollection("memberDirectoryRestoreGuards/" + academyId + "/events");
  await currentFirestore.doc("memberDirectoryRestoreGuards/" + academyId).delete();
}

function clientAuthBinding(academyId: string): Readonly<Record<string, unknown>> {
  return {
    userId: clientUserId,
    academyId,
    accountType: "client",
    displayName: "Synthetic Cross Writer Adult",
    email: clientUserId + "@example.test",
    phoneNumber: "+441534000777",
    active: true,
    status: "active",
    schemaVersion: "1",
    createdAt: "2026-09-03T20:00:00.000Z",
    createdBy: clientUserId,
    updatedAt: "2026-09-03T20:00:00.000Z",
    updatedBy: clientUserId,
  };
}

function createProfileWriter(academyId: string) {
  let studentSequence = 0;
  let auditSequence = 0;
  return createProfileStore({
    firestore: requireFirestore() as unknown as ProfileFirestore,
    projectId,
    identitySecretMaterial: identitySecret,
    identitySecretVersion: "identity-v1",
    integritySecretMaterial: integritySecret,
    integritySecretVersion: "integrity-v1",
    generateStudentId: () => academyId + "-profile-student-" + ++studentSequence,
    generateAuditId: () => academyId + "-profile-audit-" + ++auditSequence,
  });
}

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((currentResolve) => {
    resolve = currentResolve;
  });
  return Object.freeze({ promise, resolve: () => resolve() });
}

afterAll(async () => {
  if (firestore === undefined || app === undefined) return;
  try {
    await Promise.all(
      [lookupAcademyId, createAcademyId, freezeAcademyId, crossWriterAcademyId].map((academyId) =>
        cleanupAcademy(academyId),
      ),
    );
  } finally {
    await deleteApp(app);
  }
});

describeLocal("canonical member-directory concurrency against Firestore Emulator", () => {
  it("accepts exactly 20 of 21 overlapping lookups and writes one bounded over-limit audit", async () => {
    const lookupKeyId = await seedAcademy(lookupAcademyId, 1, true);
    if (lookupKeyId === undefined) throw new Error("Lookup key fixture is missing");
    const reader = createReader();
    let inFlight = 0;
    let maxInFlight = 0;
    const firstWave: PromiseSettledResult<ExactMemberLookupResult>[] = [];
    for (let wave = 0; wave < 7; wave += 1) {
      // Each batch races three callers on the same quota record. Waiting for
      // the batch prevents Emulator-only lock backoff from accumulating across
      // later batches while all 21 attempts remain in one fixed server window.
      const outcomes = await Promise.allSettled(
        Array.from({ length: 3 }, async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            return await reader.lookup(lookupCommand(lookupAcademyId));
          } finally {
            inFlight -= 1;
          }
        }),
      );
      firstWave.push(...outcomes);
    }
    const accepted = firstWave.filter((result) => result.status === "fulfilled");
    const rejected = firstWave.filter((result) => result.status === "rejected");

    expect(maxInFlight).toBeGreaterThanOrEqual(3);
    expect(accepted).toHaveLength(20);
    expect(
      accepted.every(
        (result) => result.value.matched && result.value.row.studentId === lookupStudentId,
      ),
    ).toBe(true);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: "rate-limited" });
    const firstError = safeErrorText(rejected[0]?.reason);
    expect(firstError).not.toContain(lookupRawValue);
    expect(firstError).not.toContain(lookupKeyId);
    expect(firstError).not.toMatch(/digest|keyId/iu);

    const currentFirestore = requireFirestore();
    const ratePath = "academies/" + lookupAcademyId + "/studentRestrictedReadLimits/" + actorId;
    const rateBefore = await currentFirestore.doc(ratePath).get();
    expect(rateBefore.data()).toMatchObject({
      academyId: lookupAcademyId,
      actorId,
      attemptCount: 20,
      overLimitObserved: true,
    });
    const auditsBefore = await currentFirestore
      .collection("academies/" + lookupAcademyId + "/auditEvents")
      .get();
    expect(auditsBefore.docs).toHaveLength(21);
    const auditData = auditsBefore.docs.map((document) => document.data());
    const rateLimitedAudits = auditData.filter(
      (data) => data.action === "member.identity.lookup" && data.result === "rate-limited",
    );
    expect(rateLimitedAudits).toHaveLength(1);
    auditData.forEach((data) => assertSafeRestrictedAudit(data, lookupKeyId));
    const auditIdsBefore = auditsBefore.docs.map((document) => document.id).sort();

    // RED matrix R15: the over-limit path must stay O(1) in writes and perform no blind key or
    // profile read, no matter how many requests arrive inside the same window.
    const overLimitWave: PromiseSettledResult<ExactMemberLookupResult>[] = [];
    for (let batch = 0; batch < 20; batch += 1) {
      overLimitWave.push(
        ...(await Promise.allSettled(
          Array.from({ length: 100 }, () => reader.lookup(lookupCommand(lookupAcademyId))),
        )),
      );
    }
    expect(overLimitWave).toHaveLength(2_000);
    expect(overLimitWave.every((result) => result.status === "rejected")).toBe(true);
    for (const result of overLimitWave) {
      if (result.status !== "rejected") continue;
      expect(result.reason).toMatchObject({ code: "rate-limited" });
      const errorText = safeErrorText(result.reason);
      expect(errorText).not.toContain(lookupRawValue);
      expect(errorText).not.toContain(lookupKeyId);
      expect(errorText).not.toMatch(/digest|keyId/iu);
    }

    const rateAfter = await currentFirestore.doc(ratePath).get();
    expect(rateAfter.data()).toEqual(rateBefore.data());
    const auditsAfter = await currentFirestore
      .collection("academies/" + lookupAcademyId + "/auditEvents")
      .get();
    expect(auditsAfter.docs.map((document) => document.id).sort()).toEqual(auditIdsBefore);
    expect(
      auditsAfter.docs.filter((document) => document.data().result === "rate-limited"),
    ).toHaveLength(1);
  }, 60_000);

  it("allows exactly one of two capacity-edge creates without loser partials", async () => {
    await seedAcademy(createAcademyId, 399, false);
    const writer = createWriter();
    const inputs = [createInput("1"), createInput("2")] as const;
    const results = await Promise.allSettled(
      inputs.map((value) =>
        writer.createAdminAdult({
          actor: actor(createAcademyId),
          value,
          now,
        }),
      ),
    );
    const accepted = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: "unavailable" });

    const currentFirestore = requireFirestore();
    const [
      stateSnapshot,
      guardSnapshot,
      students,
      profiles,
      identityKeys,
      receipts,
      audits,
      guardEvents,
    ] = await Promise.all([
      currentFirestore.doc("academies/" + createAcademyId + "/memberDirectoryStates/current").get(),
      currentFirestore.doc("memberDirectoryRestoreGuards/" + createAcademyId).get(),
      currentFirestore.collection("academies/" + createAcademyId + "/students").get(),
      currentFirestore.collection("academies/" + createAcademyId + "/studentAdminProfiles").get(),
      currentFirestore.collection("academies/" + createAcademyId + "/studentIdentityKeys").get(),
      currentFirestore
        .collection("academies/" + createAcademyId + "/memberDirectoryWriteReceipts")
        .get(),
      currentFirestore.collection("academies/" + createAcademyId + "/auditEvents").get(),
      currentFirestore
        .collection("memberDirectoryRestoreGuards/" + createAcademyId + "/events")
        .get(),
    ]);

    expect(stateSnapshot.data()).toMatchObject({
      stateRevision: 1,
      rollbackEligibleStudentCount: 400,
    });
    expect(guardSnapshot.data()).toMatchObject({ highestStateRevision: 1, lastEventId: "1" });
    expect(students.docs).toHaveLength(1);
    expect(profiles.docs).toHaveLength(1);
    expect(identityKeys.docs).toHaveLength(3);
    expect(receipts.docs).toHaveLength(1);
    expect(audits.docs).toHaveLength(1);
    expect(guardEvents.docs.map((document) => document.id).sort()).toEqual(["0", "1"]);

    const winnerStudentId = students.docs[0]?.id;
    expect(winnerStudentId).toEqual(expect.any(String));
    expect(profiles.docs[0]?.id).toBe(winnerStudentId);
    expect(
      identityKeys.docs.every((document) => document.data().ownerStudentId === winnerStudentId),
    ).toBe(true);
    expect(receipts.docs[0]?.data()).toMatchObject({ studentId: winnerStudentId });
    expect(audits.docs[0]?.data()).toMatchObject({
      action: "member.created",
      targetRef: "academies/" + createAcademyId + "/students/" + String(winnerStudentId),
      result: "completed",
    });

    const losingIndex = results[0]?.status === "rejected" ? 0 : 1;
    const losingInput = inputs[losingIndex];
    const persistedDomain = JSON.stringify([
      ...students.docs.map((document) => document.data()),
      ...profiles.docs.map((document) => document.data()),
      ...identityKeys.docs.map((document) => document.data()),
      ...receipts.docs.map((document) => document.data()),
      ...audits.docs.map((document) => document.data()),
    ]);
    expect(persistedDomain).not.toContain(losingInput.fullName);
    expect(persistedDomain).not.toContain(losingInput.email);
    expect(persistedDomain).not.toContain(losingInput.membershipNumber.toUpperCase());
    expect(persistedDomain).not.toContain(losingInput.idCardNumber.toUpperCase());
    expect(persistedDomain).not.toContain(losingInput.vatNumber.toUpperCase());
  }, 60_000);

  it("fails closed when a freeze commits before the competing reader performs I/O", async () => {
    await seedAcademy(freezeAcademyId, 1, true);
    const currentFirestore = requireFirestore();
    const baseStore = createMemberDirectoryFirestoreAdapters(currentFirestore).reader;
    const statePath = "academies/" + freezeAcademyId + "/memberDirectoryStates/current";
    const freezeHasLock = deferred();
    const releaseFreeze = deferred();
    const readerTransactionStarted = deferred();
    const releaseReaderTransaction = deferred();
    let queryCount = 0;
    const gatedStore: CanonicalDirectoryReadStore = {
      runTransaction: (callback) =>
        baseStore.runTransaction(async (transaction) => {
          readerTransactionStarted.resolve();
          await releaseReaderTransaction.promise;
          return callback({
            get: async (path) => {
              return transaction.get(path);
            },
            listStudents: async (input) => {
              queryCount += 1;
              return transaction.listStudents(input);
            },
            create: (path, data) => transaction.create(path, data),
            set: (path, data) => transaction.set(path, data),
          });
        }),
    };
    const initialState = canonicalState(freezeAcademyId, 1);
    const initialControl = buildInitialMemberDirectoryControlPlane({
      projectId,
      state: initialState,
      integritySecretMaterial: integritySecret,
      integritySecretVersion: "integrity-v1",
      now: initialState.createdAt,
      actorId: "system-1",
    });
    const frozenState: MemberDirectoryState = {
      ...initialState,
      directoryWriteMode: "blocked",
      freezeStatus: "frozen",
      stateRevision: 1,
      operationPhase: "identity-reconcile",
      activeOperationId: "freeze-operation-1",
      leaseId: "freeze-lease-1",
      leaseOwner: "freeze-worker-1",
      leaseExpiresAt: "2026-09-03T20:10:00.000Z",
      operationDeadline: "2026-09-03T20:30:00.000Z",
      updatedAt: now,
      updatedBy: "freeze-worker-1",
    };
    const frozenControl = advanceMemberDirectoryControlPlane({
      projectId,
      state: initialState,
      guard: initialControl.guard,
      event: initialControl.event,
      nextState: frozenState,
      operationId: "freeze-operation-1",
      transitionKind: "identity-key-reconcile",
      now,
      actorId: "freeze-worker-1",
      integritySecretMaterial: integritySecret,
      integritySecretVersion: "integrity-v1",
    });
    const stateReference = currentFirestore.doc(statePath);
    const guardReference = currentFirestore.doc("memberDirectoryRestoreGuards/" + freezeAcademyId);
    const initialEventReference = currentFirestore.doc(
      "memberDirectoryRestoreGuards/" + freezeAcademyId + "/events/0",
    );
    const nextEventReference = currentFirestore.doc(
      "memberDirectoryRestoreGuards/" + freezeAcademyId + "/events/1",
    );
    const freezePromise = currentFirestore.runTransaction(async (transaction) => {
      await Promise.all([
        transaction.get(stateReference),
        transaction.get(guardReference),
        transaction.get(initialEventReference),
      ]);
      freezeHasLock.resolve();
      await releaseFreeze.promise;
      transaction.set(stateReference, frozenState);
      transaction.set(guardReference, frozenControl.guard);
      transaction.create(nextEventReference, frozenControl.event);
    });

    await freezeHasLock.promise;
    const readOutcome = createReader(gatedStore)
      .list({ actor: actor(freezeAcademyId), value: { pageSize: 10 }, now })
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
    await readerTransactionStarted.promise;
    try {
      releaseFreeze.resolve();
      await freezePromise;
    } finally {
      releaseReaderTransaction.resolve();
    }

    const outcome = await readOutcome;
    expect(outcome).toMatchObject({
      status: "rejected",
      reason: { code: "unavailable" },
    });
    expect(queryCount).toBe(0);
    expect((await stateReference.get()).data()).toMatchObject({
      stateRevision: 1,
      freezeStatus: "frozen",
    });
    expect((await guardReference.get()).data()).toMatchObject({
      highestStateRevision: 1,
      lastEventId: "1",
    });
    expect((await nextEventReference.get()).data()).toMatchObject({
      previousStateRevision: 0,
      currentStateRevision: 1,
      transitionKind: "identity-key-reconcile",
    });
  }, 60_000);

  /**
   * RED matrix R28 for T093: race two different writer kinds for one participant.
   *
   * Identity-key collision across writer kinds is impossible by construction - the kind is part of
   * both the HMAC input and the key ID - so the real contention is the shared control plane: the
   * directory state, its revision, the monotonic guard event and the rollback capacity counter.
   * Whatever interleaving Firestore picks, the committed result must be serializable: one revision
   * and one guard event per successful create, capacity matching the successes, and no partial
   * document from a writer that failed.
   */
  it("serializes the administrative and adult-profile writers over one control plane", async () => {
    await seedAcademy(crossWriterAcademyId, 0, false);
    const currentFirestore = requireFirestore();
    await currentFirestore
      .doc("academies/" + crossWriterAcademyId + "/users/" + clientUserId)
      .set(clientAuthBinding(crossWriterAcademyId));

    const adminInput = createInput("x");
    const administrative = createWriter();
    const profiles = createProfileWriter(crossWriterAcademyId);

    // The same raw value under two kinds must never resolve to the same reservation.
    const sharedRawValue = "BPT-99000042";
    expect(
      buildStudentIdentityKey({
        academyId: crossWriterAcademyId,
        kind: "membership-number",
        value: sharedRawValue,
        ownerStudentId: "student-a",
        secretMaterial: identitySecret,
        secretVersion: "identity-v1",
        now,
        actorId,
      }).keyId,
    ).not.toBe(
      buildStudentIdentityKey({
        academyId: crossWriterAcademyId,
        kind: "auth-user-id",
        value: sharedRawValue,
        ownerStudentId: "student-b",
        secretMaterial: identitySecret,
        secretVersion: "identity-v1",
        now,
        actorId,
      }).keyId,
    );

    const results = await Promise.allSettled([
      administrative.createAdminAdult({
        actor: actor(crossWriterAcademyId),
        value: adminInput,
        now,
      }),
      profiles.saveClientProfile({
        academyId: crossWriterAcademyId,
        userId: clientUserId,
        email: clientUserId + "@example.test",
        displayName: "Synthetic Cross Writer Adult",
        requestId: runId + "-cross-writer-request",
        fullName: "Synthetic Cross Writer Adult",
        dateOfBirth: "1990-03-14",
        phoneNumber: "+441534000777",
        trainingCenter: "Town",
        trainingTimePreferences: ["evening"],
        now,
      }),
    ]);

    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    expect(succeeded).toBeGreaterThanOrEqual(1);

    const [stateSnapshot, guardSnapshot, students, identityKeys, guardEvents] = await Promise.all([
      currentFirestore
        .doc("academies/" + crossWriterAcademyId + "/memberDirectoryStates/current")
        .get(),
      currentFirestore.doc("memberDirectoryRestoreGuards/" + crossWriterAcademyId).get(),
      currentFirestore.collection("academies/" + crossWriterAcademyId + "/students").get(),
      currentFirestore
        .collection("academies/" + crossWriterAcademyId + "/studentIdentityKeys")
        .get(),
      currentFirestore
        .collection("memberDirectoryRestoreGuards/" + crossWriterAcademyId + "/events")
        .get(),
    ]);

    // One revision and one create-only guard event per successful create, never a shared revision.
    expect(stateSnapshot.data()).toMatchObject({
      stateRevision: succeeded,
      rollbackEligibleStudentCount: succeeded,
    });
    expect(guardSnapshot.data()).toMatchObject({
      highestStateRevision: succeeded,
      lastEventId: String(succeeded),
    });
    expect(guardEvents.docs.map((document) => document.id).sort()).toEqual(
      Array.from({ length: succeeded + 1 }, (_unused, index) => String(index)).sort(),
    );
    expect(students.docs).toHaveLength(succeeded);

    // Each writer reserves its own kinds: three administrative keys, one auth-user-id key.
    const keyKinds = identityKeys.docs.map((document) => String(document.data().kind)).sort();
    const adminSucceeded = results[0]?.status === "fulfilled";
    const profileSucceeded = results[1]?.status === "fulfilled";
    const expectedKinds = [
      ...(adminSucceeded ? ["id-card-number", "membership-number", "vat-number"] : []),
      ...(profileSucceeded ? ["auth-user-id"] : []),
    ].sort();
    expect(keyKinds).toEqual(expectedKinds);

    // A writer that lost leaves nothing behind.
    const persisted = JSON.stringify([
      ...students.docs.map((document) => document.data()),
      ...identityKeys.docs.map((document) => document.data()),
    ]);
    if (!adminSucceeded) {
      expect(persisted).not.toContain(adminInput.fullName);
      expect(persisted).not.toContain(adminInput.email);
    }
    if (!profileSucceeded) {
      expect(persisted).not.toContain(clientUserId);
    }
  }, 60_000);
});
