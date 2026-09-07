import { randomUUID } from "node:crypto";

import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  createMemberDirectoryActorActivityCheck,
  requireCanonicalMemberDirectoryActor,
  type MemberDirectoryActorActivityCheck,
} from "./canonical-actor.js";
import {
  CanonicalMemberDirectoryReadError,
  createCanonicalMemberDirectoryReadService,
  type CanonicalMemberDirectoryReadService,
} from "./canonical-member-directory-read-service.js";
import {
  CanonicalMemberDirectoryError,
  createCanonicalMemberDirectoryService,
  type CanonicalMemberDirectoryService,
} from "./canonical-member-directory-service.js";
import { createMemberDirectoryFirestoreAdapters } from "./member-directory-firestore.js";

const identityKeySecret = defineSecret("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET");
const migrationIntegritySecret = defineSecret("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET");
const directoryCursorSecret = defineSecret("MEMBER_DIRECTORY_CURSOR_SECRET");

const identitySecretVersion = "identity-v1";
const integritySecretVersion = "integrity-v1";
const cursorSecretVersion = "cursor-v1";

export type MemberDirectoryCallableServices = Readonly<{
  writer: CanonicalMemberDirectoryService;
  reader: CanonicalMemberDirectoryReadService;
  isActorActive: MemberDirectoryActorActivityCheck;
  now: () => string;
}>;

function serverTimestamp(): string {
  return new Date().toISOString();
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
  const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
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
  const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
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
  const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
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
  const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
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
  const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
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

export { createMemberDirectoryActorActivityCheck };

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
