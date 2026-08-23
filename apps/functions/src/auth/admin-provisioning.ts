import { randomUUID } from "node:crypto";

import { getAuth } from "firebase-admin/auth";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { z } from "zod";

import {
  parseAdminClaims,
  type AdminClaims,
  type AdminRole,
} from "@bpt-jersey/domain/auth/admin-contracts";
import type { AuditEventDraft } from "@bpt-jersey/domain/audit";

import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { assertAcademyScope, requireAdminActor } from "./admin-authorization.js";
import type { AdminActor } from "./admin-authorization.js";

export type FirestoreDocumentData = Record<string, unknown>;

type SyntheticDocumentReference = Readonly<{
  id: string;
  path: string;
}>;

type SyntheticDocumentSnapshot = Readonly<{
  exists: boolean;
  data: () => FirestoreDocumentData | undefined;
}>;

type SyntheticTransaction = Readonly<{
  get: (ref: SyntheticDocumentReference) => Promise<SyntheticDocumentSnapshot>;
  create: (ref: SyntheticDocumentReference, data: FirestoreDocumentData) => SyntheticTransaction;
  set: (ref: SyntheticDocumentReference, data: FirestoreDocumentData) => SyntheticTransaction;
  delete: (ref: SyntheticDocumentReference) => SyntheticTransaction;
}>;

export type SyntheticFirestore = {
  collection: (path: string) => {
    doc: (id?: string) => SyntheticDocumentReference & {
      set: (data: FirestoreDocumentData) => Promise<void>;
    };
  };
  doc: (path: string) => SyntheticDocumentReference & {
    set: (data: FirestoreDocumentData) => Promise<void>;
  };
  runTransaction: <T>(
    updateFunction: (transaction: SyntheticTransaction) => Promise<T>,
  ) => Promise<T>;
  records: Map<string, FirestoreDocumentData>;
};

type AdminUserRecord = {
  uid: string;
  email: string;
  displayName: string | null;
  disabled: boolean;
  providerData: ReadonlyArray<{ providerId: string }>;
  customClaims: Record<string, unknown>;
};

export type AdminProvisioningServices = Readonly<{
  auth: Readonly<{
    getUser: (uid: string) => Promise<AdminUserRecord>;
    setCustomUserClaims: (uid: string, claims: Record<string, unknown>) => Promise<void>;
  }>;
  firestore: SyntheticFirestore;
}>;

const adminRoleSchema = z.enum(["owner", "administrator"]);
const targetSchema = z.strictObject({
  uid: z.string().trim().min(1).max(128),
  email: z.string().email().max(320),
  role: adminRoleSchema,
});
const actionSchema = z.enum(["grant", "revoke"]);
const provisioningRequestSchema = z.strictObject({ action: actionSchema });
const roleLockLeaseMs = 30_000;
const roleLockMaxLifetimeMs = roleLockLeaseMs * 5;
const roleLockRenewalIntervalMs = Math.floor(roleLockLeaseMs / 3);
const roleLockFieldsSchema = z
  .object({
    lockId: z.string().trim().min(1),
    expiresAt: z.number().finite().positive(),
    leaseDeadline: z.number().finite().positive(),
    phase: z.enum(["active", "mutating", "compensating", "recovered"]),
  })
  .passthrough()
  .refine(({ expiresAt, leaseDeadline }) => expiresAt <= leaseDeadline);
const roleLockSchema = roleLockFieldsSchema.refine(
  ({ leaseDeadline }) => leaseDeadline > Date.now(),
);

function parseOrThrow<T>(result: z.ZodSafeParseResult<T>, message: string): T {
  if (!result.success) {
    throw new HttpsError("invalid-argument", message);
  }
  return result.data;
}

function canonicalClaimValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalClaimValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, canonicalClaimValue(nestedValue)]),
    );
  }
  return value;
}

function haveSameClaims(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(canonicalClaimValue(left)) === JSON.stringify(canonicalClaimValue(right));
}

function currentAction(request: CallableRequest): "grant" | "revoke" {
  if (request.data === undefined) {
    return "grant";
  }

  const value = parseOrThrow(
    provisioningRequestSchema.safeParse(request.data),
    "A valid provisioning action is required",
  );
  return value.action;
}

function requireOwner(actor: AdminActor): void {
  if (actor.role !== "owner") {
    throw new HttpsError("permission-denied", "Only an owner can manage administrative roles");
  }
}

function requireGoogleUser(user: AdminUserRecord, email: string): void {
  if (!user.providerData.some((provider) => provider.providerId === "google.com")) {
    throw new HttpsError("failed-precondition", "The target must have a Google provider");
  }
  if (user.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
    throw new HttpsError("invalid-argument", "Target email does not match the Firebase user");
  }
}

function requireTargetAdminClaims(
  user: AdminUserRecord,
  actor: AdminActor,
): AdminClaims | undefined {
  const hasAcademyId = Object.prototype.hasOwnProperty.call(user.customClaims, "academyId");
  const hasRole = Object.prototype.hasOwnProperty.call(user.customClaims, "role");
  if (!hasAcademyId && !hasRole) {
    return undefined;
  }

  const currentClaims = parseAdminClaims({
    academyId: user.customClaims.academyId,
    role: user.customClaims.role,
  });
  if (!currentClaims.ok || currentClaims.value.academyId !== actor.academyId) {
    throw new HttpsError("permission-denied", "Target belongs to another academy");
  }
  return currentClaims.value;
}

type RoleLockPhase = "active" | "mutating" | "compensating" | "recovered";

type RoleLockDocument = Readonly<{
  lockId: string;
  expiresAt: number;
  leaseDeadline: number;
  phase: RoleLockPhase;
}>;

type RoleLock = Readonly<{
  ref: SyntheticDocumentReference;
  lockId: string;
}>;

function roleLockPath(academyId: string, uid: string): string {
  return `academies/${academyId}/adminRoleLocks/${encodeURIComponent(uid)}`;
}

function parseRoleLock(value: FirestoreDocumentData | undefined): RoleLockDocument | undefined {
  const result = roleLockSchema.safeParse(value);
  if (!result.success) {
    return undefined;
  }
  return {
    lockId: result.data.lockId,
    expiresAt: result.data.expiresAt,
    leaseDeadline: result.data.leaseDeadline,
    phase: result.data.phase,
  };
}

function parseExpiredRoleLock(
  value: FirestoreDocumentData | undefined,
): RoleLockDocument | undefined {
  const result = roleLockFieldsSchema.safeParse(value);
  if (!result.success) {
    return undefined;
  }
  return {
    lockId: result.data.lockId,
    expiresAt: result.data.expiresAt,
    leaseDeadline: result.data.leaseDeadline,
    phase: result.data.phase,
  };
}

function isOwnedFencedRoleLock(
  value: FirestoreDocumentData | undefined,
  lock: RoleLock,
  phase: Exclude<RoleLockPhase, "active">,
): boolean {
  const current = parseRoleLock(value);
  return (
    current?.lockId === lock.lockId && current.phase === phase && current.expiresAt > Date.now()
  );
}

async function acquireRoleLock(
  services: Pick<AdminProvisioningServices, "firestore">,
  actor: AdminActor,
  uid: string,
): Promise<RoleLock> {
  const ref = services.firestore.doc(roleLockPath(actor.academyId, uid));
  const lockId = randomUUID();
  const acquiredAt = Date.now();
  const leaseDeadline = acquiredAt + roleLockMaxLifetimeMs;
  const expiresAt = Math.min(acquiredAt + roleLockLeaseMs, leaseDeadline);

  await services.firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      const existing = parseRoleLock(snapshot.data()) ?? parseExpiredRoleLock(snapshot.data());
      if (!existing || existing.expiresAt > acquiredAt) {
        throw new HttpsError("aborted", "An administrative role lock is invalid or active");
      }
    }

    transaction.set(ref, {
      academyId: actor.academyId,
      targetUid: uid,
      actorId: actor.uid,
      lockId,
      acquiredAt,
      expiresAt,
      leaseDeadline,
      phase: "active",
      schemaVersion: 1,
    });
  });

  return { ref, lockId };
}

export async function withSharedRoleLock<T>(
  firestore: SyntheticFirestore,
  academyId: string,
  actorId: string,
  uid: string,
  operation: (control: Readonly<{ retain: () => void }>) => Promise<T>,
): Promise<T> {
  const actor = { uid: actorId, academyId, role: "owner" as const };
  const lock = await acquireRoleLock({ firestore }, actor, uid);
  const leaseRenewal = maintainRoleLockLease({ firestore }, lock);
  let retain = false;
  try {
    leaseRenewal.assertHealthy();
    const result = await operation({
      retain: () => {
        retain = true;
      },
    });
    leaseRenewal.assertHealthy();
    return result;
  } finally {
    if (retain) {
      try {
        await markSharedRoleLockCompensating({ firestore }, lock);
      } catch {
        // The lease still expires automatically; retain the fail-closed behavior.
      }
    }
    await leaseRenewal.stop();
    if (!retain) {
      try {
        await releaseRoleLock({ firestore }, lock);
      } catch {
        // The lease expires automatically; do not mask the operation result.
      }
    }
  }
}

async function markSharedRoleLockCompensating(
  services: Pick<AdminProvisioningServices, "firestore">,
  lock: RoleLock,
): Promise<void> {
  await services.firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lock.ref);
    const current = parseRoleLock(snapshot.data());
    const now = Date.now();
    if (
      !snapshot.exists ||
      !current ||
      current.lockId !== lock.lockId ||
      current.expiresAt <= now
    ) {
      throw new HttpsError("aborted", "The shared role lock is no longer owned");
    }
    transaction.set(lock.ref, {
      ...snapshot.data(),
      phase: "compensating",
      expiresAt: Math.min(now + roleLockLeaseMs, current.leaseDeadline),
      compensationStartedAt: now,
    });
  });
}

export async function renewRoleLock(
  services: Pick<AdminProvisioningServices, "firestore">,
  lock: RoleLock,
): Promise<void> {
  await services.firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lock.ref);
    const current = parseRoleLock(snapshot.data());
    const renewedAt = Date.now();
    if (
      !snapshot.exists ||
      !current ||
      current.lockId !== lock.lockId ||
      current.expiresAt <= renewedAt ||
      current.leaseDeadline <= renewedAt
    ) {
      throw new HttpsError("aborted", "The administrative role lock is no longer renewable");
    }

    transaction.set(lock.ref, {
      ...snapshot.data(),
      expiresAt: Math.min(renewedAt + roleLockLeaseMs, current.leaseDeadline),
      renewedAt,
    });
  });
}

type RoleLockLeaseRenewal = Readonly<{
  assertHealthy: () => void;
  stop: () => Promise<void>;
}>;

function maintainRoleLockLease(
  services: Pick<AdminProvisioningServices, "firestore">,
  lock: RoleLock,
): RoleLockLeaseRenewal {
  let failure: unknown;
  let renewalInFlight: Promise<void> | undefined;
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped || failure !== undefined || renewalInFlight !== undefined) {
      return;
    }

    renewalInFlight = renewRoleLock(services, lock)
      .catch((error: unknown) => {
        failure = error;
      })
      .finally(() => {
        renewalInFlight = undefined;
      });
  }, roleLockRenewalIntervalMs);
  timer.unref?.();

  return {
    assertHealthy: () => {
      if (failure !== undefined) {
        throw failure;
      }
    },
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await renewalInFlight;
    },
  };
}

async function releaseRoleLock(
  services: Pick<AdminProvisioningServices, "firestore">,
  lock: RoleLock,
): Promise<void> {
  await services.firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lock.ref);
    const current = parseRoleLock(snapshot.data());
    if (current?.lockId === lock.lockId && current.phase === "active") {
      transaction.delete(lock.ref);
    }
  });
}

async function beginRoleLockMutation(
  services: AdminProvisioningServices,
  lock: RoleLock,
): Promise<void> {
  await services.firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lock.ref);
    const current = parseRoleLock(snapshot.data());
    if (
      !snapshot.exists ||
      current?.lockId !== lock.lockId ||
      current.phase !== "active" ||
      current.expiresAt <= Date.now()
    ) {
      throw new HttpsError("aborted", "The administrative role lock is no longer active");
    }

    transaction.set(lock.ref, {
      ...snapshot.data(),
      phase: "mutating",
      expiresAt: Math.min(Date.now() + roleLockLeaseMs, current.leaseDeadline),
      mutationStartedAt: Date.now(),
    });
  });
}

async function beginRoleLockCompensation(
  services: AdminProvisioningServices,
  lock: RoleLock,
): Promise<void> {
  await services.firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lock.ref);
    const current = parseRoleLock(snapshot.data());
    if (
      !snapshot.exists ||
      !current ||
      current.lockId !== lock.lockId ||
      current.phase !== "mutating" ||
      current.expiresAt <= Date.now()
    ) {
      throw new HttpsError("aborted", "The mutating administrative role lock is no longer owned");
    }

    const compensationStartedAt = Date.now();
    transaction.set(lock.ref, {
      ...snapshot.data(),
      phase: "compensating",
      expiresAt: Math.min(compensationStartedAt + roleLockLeaseMs, current!.leaseDeadline),
      compensationStartedAt,
    });
  });
}

async function markRoleLockRecovered(
  services: AdminProvisioningServices,
  lock: RoleLock,
): Promise<void> {
  await services.firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lock.ref);
    const current = parseRoleLock(snapshot.data());
    if (
      !snapshot.exists ||
      !current ||
      current.lockId !== lock.lockId ||
      current.phase !== "compensating" ||
      current.expiresAt <= Date.now()
    ) {
      throw new HttpsError("aborted", "The compensating role lock is no longer owned");
    }

    const recoveredAt = Date.now();
    transaction.set(lock.ref, {
      ...snapshot.data(),
      phase: "recovered",
      expiresAt: Math.min(recoveredAt + roleLockLeaseMs, current!.leaseDeadline),
      recoveredAt,
    });
  });
}

async function releaseRecoveredRoleLock(
  services: AdminProvisioningServices,
  lock: RoleLock,
): Promise<void> {
  await services.firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lock.ref);
    if (!snapshot.exists || !isOwnedFencedRoleLock(snapshot.data(), lock, "recovered")) {
      throw new HttpsError("aborted", "The recovered role lock is no longer owned");
    }

    transaction.delete(lock.ref);
  });
}

async function persistUserAndAudit(
  services: AdminProvisioningServices,
  actor: AdminActor,
  target: { uid: string; email: string; role: AdminRole; displayName: string },
  user: AdminUserRecord,
  lock: RoleLock,
  action: "grant" | "revoke",
): Promise<void> {
  const auditRef = services.firestore.collection(`academies/${actor.academyId}/auditEvents`).doc();
  const userRef = services.firestore.doc(`academies/${actor.academyId}/users/${target.uid}`);

  await services.firestore.runTransaction(async (transaction) => {
    const lockSnapshot = await transaction.get(lock.ref);
    const lockData = lockSnapshot.data();
    if (!lockSnapshot.exists || !isOwnedFencedRoleLock(lockData, lock, "mutating")) {
      throw new HttpsError("aborted", "The mutating administrative role lock is no longer held");
    }

    const existingSnapshot = await transaction.get(userRef);
    const existing = existingSnapshot.data();
    const active = !user.disabled;
    const status =
      typeof existing?.status === "string" ? existing.status : active ? "active" : "inactive";

    appendAuditEventInTransaction(transaction, auditRef, {
      academyId: actor.academyId,
      actorId: actor.uid,
      action: action === "grant" ? "admin.role.granted" : "admin.role.revoked",
      targetRef: `academies/${actor.academyId}/users/${target.uid}`,
      purpose: "administrative role management",
      correlationId: `${actor.uid}:${target.uid}:${auditRef.id}`,
    } as unknown as AuditEventDraft);
    transaction.set(userRef, {
      userId: target.uid,
      academyId: actor.academyId,
      accountType: "staff",
      displayName: target.displayName,
      email: target.email,
      authProvider: "google",
      active,
      adminRole: action === "grant" ? target.role : null,
      lastRoleChangeAuditId: auditRef.id,
      createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(),
      createdBy: typeof existing?.createdBy === "string" ? existing.createdBy : actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
      status,
      schemaVersion: 1,
    });
    transaction.delete(lock.ref);
  });
}

async function setClaimsAndPersist(
  services: AdminProvisioningServices,
  uid: string,
  previousClaims: Record<string, unknown>,
  nextClaims: Record<string, unknown>,
  actor: AdminActor,
  target: { uid: string; email: string; role: AdminRole; displayName: string },
  user: AdminUserRecord,
  lock: RoleLock,
  action: "grant" | "revoke",
): Promise<void> {
  try {
    await services.auth.setCustomUserClaims(uid, nextClaims);
    await persistUserAndAudit(services, actor, target, user, lock, action);
  } catch (error) {
    try {
      await beginRoleLockCompensation(services, lock);
      const currentUser = await services.auth.getUser(uid);
      if (!haveSameClaims(currentUser.customClaims, nextClaims)) {
        throw new HttpsError("aborted", "Auth claims changed during the role update");
      }
      await services.auth.setCustomUserClaims(uid, previousClaims);
      await markRoleLockRecovered(services, lock);
      await releaseRecoveredRoleLock(services, lock);
    } catch (compensationError) {
      if (compensationError instanceof HttpsError) {
        throw compensationError;
      }
      throw new HttpsError("internal", "Administrative role update could not be rolled back");
    }
    throw error;
  }
}

export async function provisionAdminRoleWithServices(
  request: CallableRequest,
  targetInput: { uid: string; email: string; role: AdminRole },
  services: AdminProvisioningServices,
): Promise<void> {
  const actor = requireAdminActor(request);
  requireOwner(actor);
  const target = parseOrThrow(targetSchema.safeParse(targetInput), "Invalid administrative target");
  const action = currentAction(request);
  const lock = await acquireRoleLock(services, actor, target.uid);
  const leaseRenewal = maintainRoleLockLease(services, lock);
  let authMutationStarted = false;
  try {
    const user = await services.auth.getUser(target.uid);
    requireGoogleUser(user, target.email);
    const existingAdminClaims = requireTargetAdminClaims(user, actor);

    const previousClaims = { ...user.customClaims };
    const nextClaims = { ...previousClaims };
    if (action === "revoke") {
      if (!existingAdminClaims) {
        throw new HttpsError("permission-denied", "Target has no matching administrative role");
      }
      assertAcademyScope(actor, existingAdminClaims.academyId);
      if (existingAdminClaims.role !== target.role) {
        throw new HttpsError(
          "failed-precondition",
          "Target role does not match the role being revoked",
        );
      }
      delete nextClaims.academyId;
      delete nextClaims.role;
    } else {
      nextClaims.academyId = actor.academyId;
      nextClaims.role = target.role;
    }

    leaseRenewal.assertHealthy();
    await beginRoleLockMutation(services, lock);
    await renewRoleLock(services, lock);
    authMutationStarted = true;
    await setClaimsAndPersist(
      services,
      target.uid,
      previousClaims,
      nextClaims,
      actor,
      { ...target, displayName: user.displayName ?? "" },
      user,
      lock,
      action,
    );
  } catch (error) {
    if (!authMutationStarted) {
      try {
        await releaseRoleLock(services, lock);
      } catch {
        // The lease expires automatically; do not mask the operation failure.
      }
    }
    throw error;
  } finally {
    await leaseRenewal.stop();
  }
}

function defaultServices(): AdminProvisioningServices {
  const app = getApps()[0] ?? initializeApp();
  const auth = getAuth(app);
  const firestore = getFirestore(app);

  return {
    auth: {
      getUser: async (uid) => {
        const user = await auth.getUser(uid);
        if (!user.email) {
          throw new HttpsError("failed-precondition", "The Firebase user must have an email");
        }
        return {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName ?? null,
          disabled: user.disabled,
          providerData: user.providerData,
          customClaims: user.customClaims ?? {},
        };
      },
      setCustomUserClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
    },
    firestore: firestore as unknown as SyntheticFirestore,
  };
}

export async function provisionAdminRole(
  request: CallableRequest,
  target: { uid: string; email: string; role: AdminRole },
): Promise<void> {
  return provisionAdminRoleWithServices(request, target, defaultServices());
}

function isLoopbackEmulatorHost(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const hostMatch = /^(?:localhost|127\.0\.0\.1)(?::([0-9]+))?$/.exec(value);
  const ipv6Match = /^(?:\[::1\]|::1)(?::([0-9]+))?$/.exec(value);
  const port = hostMatch?.[1] ?? ipv6Match?.[1];
  if (!hostMatch && !ipv6Match) {
    return false;
  }
  if (port === undefined) {
    return true;
  }

  const numericPort = Number(port);
  return numericPort >= 1 && numericPort <= 65_535;
}

function assertEmulatorTarget(): void {
  const authEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (!isLoopbackEmulatorHost(authEmulator) || !isLoopbackEmulatorHost(firestoreEmulator)) {
    throw new HttpsError("failed-precondition", "Owner bootstrap is emulator-only");
  }
}

const bootstrapInputSchema = z.strictObject({
  uid: z.string().trim().min(1).max(128),
  email: z.string().email().max(320),
  academyId: z.string().trim().min(1).max(128),
});

export async function bootstrapEmulatorOwner(input: {
  uid: string;
  email: string;
  academyId: string;
}): Promise<void> {
  assertEmulatorTarget();
  const value = parseOrThrow(bootstrapInputSchema.safeParse(input), "Invalid emulator owner input");
  const services = defaultServices();
  const actor = Object.freeze({
    uid: value.uid,
    academyId: value.academyId,
    role: "owner" as const,
  });

  const lock = await acquireRoleLock(services, actor, value.uid);
  const leaseRenewal = maintainRoleLockLease(services, lock);
  let authMutationStarted = false;
  try {
    const user = await services.auth.getUser(value.uid);
    requireGoogleUser(user, value.email);
    requireTargetAdminClaims(user, actor);
    const previousClaims = { ...user.customClaims };
    const nextClaims = {
      ...previousClaims,
      academyId: value.academyId,
      role: "owner",
    };

    leaseRenewal.assertHealthy();
    await beginRoleLockMutation(services, lock);
    await renewRoleLock(services, lock);
    authMutationStarted = true;
    await setClaimsAndPersist(
      services,
      value.uid,
      previousClaims,
      nextClaims,
      actor,
      {
        uid: value.uid,
        email: value.email,
        role: "owner",
        displayName: user.displayName ?? "",
      },
      user,
      lock,
      "grant",
    );
  } catch (error) {
    if (!authMutationStarted) {
      try {
        await releaseRoleLock(services, lock);
      } catch {
        // The lease expires automatically; do not mask the operation failure.
      }
    }
    throw error;
  } finally {
    await leaseRenewal.stop();
  }
}
