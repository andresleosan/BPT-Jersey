import { randomUUID } from "node:crypto";

import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  createMemberDirectoryActorActivityCheck,
  requireCanonicalMemberDirectoryActor,
  requireCanonicalMemberDirectoryOwner,
  type MemberDirectoryActorActivityCheck,
} from "./canonical-actor.js";
import {
  CanonicalDirectoryInitializationError,
  createCanonicalDirectoryInitializationService,
  type CanonicalDirectoryInitializationService,
} from "./canonical-directory-initialization.js";
import { createCanonicalDirectoryInitializationFirestoreStore } from "./canonical-directory-initialization-firestore.js";
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

export type CanonicalDirectoryInitializationCallableServices = Readonly<{
  initializer: CanonicalDirectoryInitializationService;
  isActorActive: MemberDirectoryActorActivityCheck;
  now: () => string;
}>;

/**
 * Initializes the canonical member directory of the caller's own academy.
 *
 * The academy is taken from the verified claim and never from the payload, so this cannot be
 * pointed at somebody else's tenant, and the payload is required to be empty for the same reason:
 * there is nothing here for a caller to choose.
 */
export async function initializeCanonicalMemberDirectoryHandler(
  request: CallableRequest<unknown>,
  services: CanonicalDirectoryInitializationCallableServices,
) {
  const actor = await requireCanonicalMemberDirectoryOwner(request, services.isActorActive);
  const data = request.data;
  if (data !== undefined && data !== null && Object.keys(data as object).length !== 0) {
    throw new HttpsError("invalid-argument", "Initialization takes no arguments");
  }
  try {
    const outcome = await services.initializer.initialize({
      academyId: actor.academyId,
      actorId: actor.actorId,
      now: services.now(),
    });
    return Object.freeze({
      academyId: actor.academyId,
      alreadyInitialized: outcome.alreadyInitialized,
    });
  } catch (error) {
    if (error instanceof CanonicalDirectoryInitializationError) {
      switch (error.code) {
        case "not-empty":
          // The message names the collections that stopped it, and that detail is the point: a
          // directory with members in it needs a migration, not an initialization.
          throw new HttpsError("failed-precondition", error.message);
        case "invalid":
          throw new HttpsError("internal", "Member directory documents could not be built");
        default:
          throw new HttpsError("failed-precondition", "Member directory is unavailable");
      }
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Member directory initialization failed");
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

function defaultInitializationServices(): CanonicalDirectoryInitializationCallableServices {
  const firestore = getFirestore();
  const auth = getAuth();
  return Object.freeze({
    initializer: createCanonicalDirectoryInitializationService({
      store: createCanonicalDirectoryInitializationFirestoreStore(firestore),
      projectId: requiredProjectId(),
      // The same constants the readers and the writer compare against, so an initialized directory
      // is readable by construction instead of by coincidence.
      identitySecretVersion,
      integritySecretMaterial: migrationIntegritySecret.value(),
      integritySecretVersion,
    }),
    isActorActive: createMemberDirectoryActorActivityCheck({
      getAuthUser: (uid) => auth.getUser(uid),
      getDocument: (path) => firestore.doc(path).get(),
    }),
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

/**
 * Owner-only, and it only needs the integrity secret: the state it writes declares the identity
 * secret *version*, never the material, so the identity and cursor secrets stay out of this path.
 */
export const initializeCanonicalMemberDirectory = onCall(
  { enforceAppCheck: true, secrets: [migrationIntegritySecret] },
  async (request) =>
    initializeCanonicalMemberDirectoryHandler(request, defaultInitializationServices()),
);

export const getMemberDetail = onCall(memberDirectoryCallableOptions, async (request) =>
  getMemberDetailHandler(request, defaultServices()),
);

export const lookupMemberIdentity = onCall(memberDirectoryCallableOptions, async (request) =>
  lookupMemberIdentityHandler(request, defaultServices()),
);
