import { randomUUID } from "node:crypto";

import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import { requireAdminActor } from "../auth/admin-authorization.js";
import {
  CanonicalMemberDirectoryReadError,
  createCanonicalMemberDirectoryReadService,
  type CanonicalMemberDirectoryReadService,
} from "./canonical-member-directory-read-service.js";
import {
  CanonicalMemberDirectoryError,
  createCanonicalMemberDirectoryService,
  type CanonicalMemberDirectoryActor,
  type CanonicalMemberDirectoryService,
} from "./canonical-member-directory-service.js";
import { matchesProvisionedMemberDirectoryActor } from "./member-directory-actor-authorization.js";
import { createMemberDirectoryFirestoreAdapters } from "./member-directory-firestore.js";

const identityKeySecret = defineSecret("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET");
const migrationIntegritySecret = defineSecret("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET");
const directoryCursorSecret = defineSecret("MEMBER_DIRECTORY_CURSOR_SECRET");

const identitySecretVersion = "identity-v1";
const integritySecretVersion = "integrity-v1";
const cursorSecretVersion = "cursor-v1";

type MemberDirectoryActorStatusInput = Readonly<{
  uid: string;
  academyId: string;
  role: "owner" | "administrator";
}>;

type MemberDirectoryActivityAuthUser = Readonly<{
  uid: string;
  disabled: boolean;
  customClaims?: Readonly<Record<string, unknown>>;
}>;

type MemberDirectoryActivityDocument = Readonly<{
  exists: boolean;
  data: () => unknown;
}>;

export type MemberDirectoryActorActivityDependencies = Readonly<{
  getAuthUser: (uid: string) => Promise<MemberDirectoryActivityAuthUser>;
  getDocument: (path: string) => Promise<MemberDirectoryActivityDocument>;
}>;

export type MemberDirectoryCallableServices = Readonly<{
  writer: CanonicalMemberDirectoryService;
  reader: CanonicalMemberDirectoryReadService;
  isActorActive: (input: MemberDirectoryActorStatusInput) => Promise<boolean>;
  now: () => string;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createMemberDirectoryActorActivityCheck(
  dependencies: MemberDirectoryActorActivityDependencies,
): MemberDirectoryCallableServices["isActorActive"] {
  return async ({ uid, academyId, role }) => {
    try {
      const [authUser, adminDocument, roleLock] = await Promise.all([
        dependencies.getAuthUser(uid),
        dependencies.getDocument(`academies/${academyId}/users/${uid}`),
        dependencies.getDocument(`academies/${academyId}/adminRoleLocks/${uid}`),
      ]);
      if (authUser.uid !== uid || authUser.disabled || !adminDocument.exists || roleLock.exists) {
        return false;
      }
      const claims = authUser.customClaims;
      return (
        matchesProvisionedMemberDirectoryActor(adminDocument.data(), {
          actorId: uid,
          academyId,
          role,
        }) &&
        isRecord(claims) &&
        claims.academyId === academyId &&
        claims.role === role
      );
    } catch {
      return false;
    }
  };
}

function serverTimestamp(): string {
  return new Date().toISOString();
}

async function canonicalActor(
  request: CallableRequest<unknown>,
  services: MemberDirectoryCallableServices,
): Promise<CanonicalMemberDirectoryActor> {
  const actor = requireAdminActor(request);
  if (request.app === undefined) {
    throw new HttpsError("unauthenticated", "Verified App Check is required");
  }
  if (actor.role !== "owner" && actor.role !== "administrator") {
    throw new HttpsError("permission-denied", "Owner or administrator access is required");
  }
  let active: boolean;
  try {
    active = await services.isActorActive({
      uid: actor.uid,
      academyId: actor.academyId,
      role: actor.role,
    });
  } catch {
    throw new HttpsError("failed-precondition", "Administrative account status is unavailable");
  }
  if (!active) {
    throw new HttpsError("permission-denied", "An active administrative account is required");
  }
  return Object.freeze({
    actorId: actor.uid,
    academyId: actor.academyId,
    role: actor.role,
    active: true,
    appCheckVerified: true,
  });
}

function mapDirectoryError(error: unknown): never {
  if (error instanceof CanonicalMemberDirectoryError) {
    switch (error.code) {
      case "unauthorized":
        throw new HttpsError("permission-denied", "Member operation is not permitted");
      case "invalid":
        throw new HttpsError("invalid-argument", "Invalid member request");
      case "unavailable":
        throw new HttpsError("failed-precondition", "Member directory is unavailable");
      case "conflict":
        throw new HttpsError("already-exists", "Administrative identifier already exists");
      case "replay":
        throw new HttpsError("failed-precondition", "Member request replay was rejected");
    }
  }
  if (error instanceof CanonicalMemberDirectoryReadError) {
    switch (error.code) {
      case "unauthorized":
        throw new HttpsError("permission-denied", "Member read is not permitted");
      case "invalid":
        throw new HttpsError("invalid-argument", "Invalid member directory request");
      case "unavailable":
        throw new HttpsError("failed-precondition", "Member directory is unavailable");
      case "not-found":
        throw new HttpsError("not-found", "Member record was not found");
      case "rate-limited":
        throw new HttpsError("resource-exhausted", "Restricted member read rate limit exceeded");
    }
  }
  if (error instanceof HttpsError) throw error;
  throw new HttpsError("internal", "Member directory operation failed");
}

export async function createMemberDirectoryHandler(
  request: CallableRequest<unknown>,
  services: MemberDirectoryCallableServices,
) {
  const actor = await canonicalActor(request, services);
  try {
    return await services.writer.createAdminAdult({
      actor,
      value: request.data,
      now: services.now(),
    });
  } catch (error) {
    return mapDirectoryError(error);
  }
}

export async function updateMemberDirectoryHandler(
  request: CallableRequest<unknown>,
  services: MemberDirectoryCallableServices,
) {
  const actor = await canonicalActor(request, services);
  try {
    return await services.writer.updateAdminMember({
      actor,
      value: request.data,
      now: services.now(),
    });
  } catch (error) {
    return mapDirectoryError(error);
  }
}

export async function listMembersHandler(
  request: CallableRequest<unknown>,
  services: MemberDirectoryCallableServices,
) {
  const actor = await canonicalActor(request, services);
  try {
    return await services.reader.list({
      actor,
      value: request.data,
      now: services.now(),
    });
  } catch (error) {
    return mapDirectoryError(error);
  }
}

export async function getMemberDetailHandler(
  request: CallableRequest<unknown>,
  services: MemberDirectoryCallableServices,
) {
  const actor = await canonicalActor(request, services);
  try {
    return await services.reader.detail({
      actor,
      value: request.data,
      now: services.now(),
    });
  } catch (error) {
    return mapDirectoryError(error);
  }
}

export async function lookupMemberIdentityHandler(
  request: CallableRequest<unknown>,
  services: MemberDirectoryCallableServices,
) {
  const actor = await canonicalActor(request, services);
  try {
    return await services.reader.lookup({
      actor,
      value: request.data,
      now: services.now(),
    });
  } catch (error) {
    return mapDirectoryError(error);
  }
}

function requiredProjectId(): string {
  const projectId = getApp().options.projectId;
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new HttpsError("failed-precondition", "Firebase project binding is unavailable");
  }
  return projectId;
}

function defaultServices(): MemberDirectoryCallableServices {
  const firestore = getFirestore();
  const auth = getAuth();
  const adapters = createMemberDirectoryFirestoreAdapters(firestore);
  const isActorActive = createMemberDirectoryActorActivityCheck({
    getAuthUser: (uid) => auth.getUser(uid),
    getDocument: (path) => firestore.doc(path).get(),
  });
  return Object.freeze({
    writer: createCanonicalMemberDirectoryService({
      firestore: adapters.writer,
      projectId: requiredProjectId(),
      identitySecretMaterial: identityKeySecret.value(),
      identitySecretVersion,
      integritySecretMaterial: migrationIntegritySecret.value(),
      integritySecretVersion,
    }),
    reader: createCanonicalMemberDirectoryReadService({
      store: adapters.reader,
      identitySecretMaterial: identityKeySecret.value(),
      identitySecretVersion,
      cursorSecretMaterial: directoryCursorSecret.value(),
      cursorSecretVersion,
      generateAuditId: randomUUID,
    }),
    isActorActive,
    now: serverTimestamp,
  });
}

const memberDirectoryCallableOptions = {
  enforceAppCheck: true,
  secrets: [identityKeySecret, migrationIntegritySecret, directoryCursorSecret],
};

export const createCanonicalMember = onCall(memberDirectoryCallableOptions, async (request) =>
  createMemberDirectoryHandler(request, defaultServices()),
);

export const updateCanonicalMember = onCall(memberDirectoryCallableOptions, async (request) =>
  updateMemberDirectoryHandler(request, defaultServices()),
);

export const listMembers = onCall(memberDirectoryCallableOptions, async (request) =>
  listMembersHandler(request, defaultServices()),
);

export const getMemberDetail = onCall(memberDirectoryCallableOptions, async (request) =>
  getMemberDetailHandler(request, defaultServices()),
);

export const lookupMemberIdentity = onCall(memberDirectoryCallableOptions, async (request) =>
  lookupMemberIdentityHandler(request, defaultServices()),
);
