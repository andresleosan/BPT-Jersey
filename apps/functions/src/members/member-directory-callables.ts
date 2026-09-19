import { randomUUID } from "node:crypto";

import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { warn } from "firebase-functions/logger";
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
  type OfficeMemberDirectoryService,
} from "./canonical-member-directory-service.js";
import { createMemberDirectoryFirestoreAdapters } from "./member-directory-firestore.js";

import {
  importedSubscriptionQuerySchema,
  officeMemberRegistrationSchema,
} from "@bpt-jersey/domain/memberships/admin";
import { parseRegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
import { browserAdminCallableOptions } from "../auth/callable-options.js";

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

export function mapMemberDirectoryError(error: unknown): never {
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
    if (error.code === "unauthorized")
      warn("member-directory-access-denied", { stage: "directory-read" });
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
    return mapMemberDirectoryError(error);
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
    return mapMemberDirectoryError(error);
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
    return mapMemberDirectoryError(error);
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
    return mapMemberDirectoryError(error);
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
    return mapMemberDirectoryError(error);
  }
}

export async function revealRegyfitRecordFieldHandler(
  request: CallableRequest<unknown>,
  services: MemberDirectoryCallableServices,
) {
  const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
  try {
    return await services.reader.regyfitRecordFieldReveal({
      actor,
      value: request.data,
      now: services.now(),
    });
  } catch (error) {
    return mapMemberDirectoryError(error);
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

export function defaultMemberDirectoryCallableServices(): MemberDirectoryCallableServices {
  const firestore = getFirestore();
  const auth = getAuth();
  const adapters = createMemberDirectoryFirestoreAdapters(firestore);
  const isActorActive = createMemberDirectoryActorActivityCheck({
    onDenied: (reason) =>
      warn("member-directory-access-denied", { stage: "actor-activity", reason }),
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

export const memberDirectoryCallableOptions = {
  enforceAppCheck: true,
  secrets: [identityKeySecret, migrationIntegritySecret, directoryCursorSecret],
};

export const createCanonicalMember = onCall(memberDirectoryCallableOptions, async (request) =>
  createMemberDirectoryHandler(request, defaultMemberDirectoryCallableServices()),
);

export const updateCanonicalMember = onCall(memberDirectoryCallableOptions, async (request) =>
  updateMemberDirectoryHandler(request, defaultMemberDirectoryCallableServices()),
);

export const listMembers = onCall(memberDirectoryCallableOptions, async (request) =>
  listMembersHandler(request, defaultMemberDirectoryCallableServices()),
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
  getMemberDetailHandler(request, defaultMemberDirectoryCallableServices()),
);

export const lookupMemberIdentity = onCall(memberDirectoryCallableOptions, async (request) =>
  lookupMemberIdentityHandler(request, defaultMemberDirectoryCallableServices()),
);

export const revealRegyfitRecordField = onCall(memberDirectoryCallableOptions, async (request) =>
  revealRegyfitRecordFieldHandler(request, defaultMemberDirectoryCallableServices()),
);

async function importedMemberRecord(academyId: string, recordId: string) {
  const snapshot = await getFirestore()
    .doc(`academies/${academyId}/regyfitMemberRecords/${recordId}`)
    .get();
  const data = snapshot.data();
  const parsed = parseRegyfitMemberRecord(
    Object.fromEntries(Object.entries(data ?? {}).filter(([key]) => key !== "academyId")),
  );
  if (
    !parsed.ok ||
    parsed.value.recordId !== recordId ||
    (data?.academyId !== undefined && data.academyId !== academyId)
  )
    throw new HttpsError("not-found", "Imported member is unavailable.");
  return parsed.value;
}

export const resolveMemberSubscriptionProfile = onCall(
  {
    ...browserAdminCallableOptions,
    secrets: [identityKeySecret, migrationIntegritySecret, directoryCursorSecret],
  },
  async (request) => {
    const services = defaultMemberDirectoryCallableServices();
    const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
    const input = importedSubscriptionQuerySchema.safeParse(request.data);
    if (!input.success) throw new HttpsError("invalid-argument", "Invalid member profile.");
    try {
      const source = await importedMemberRecord(actor.academyId, input.data.recordId);
      const links = await Promise.all(
        ["regyfitMemberLinks", "regyfitOfficeLinks"].map((collection) =>
          getFirestore().doc(`academies/${actor.academyId}/${collection}/${source.recordId}`).get(),
        ),
      );
      const targets = new Set<string>();
      for (const snapshot of links) {
        if (!snapshot.exists) continue;
        const link = snapshot.data()!;
        if (
          link.academyId !== actor.academyId ||
          link.recordId !== source.recordId ||
          typeof link.studentId !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(link.studentId)
        )
          throw new HttpsError("failed-precondition", "Invalid member link.");
        targets.add(link.studentId);
      }
      if (targets.size > 1)
        throw new HttpsError(
          "failed-precondition",
          "Conflicting member links require office review.",
        );
      const linked = [...targets][0];
      if (linked) {
        await services.reader.detail({
          actor,
          value: { studentId: linked, purpose: "member-record-maintenance" },
          now: services.now(),
        });
        return { studentId: linked };
      }
      if (!source.memberNumber) return { studentId: null };
      const result = await services.reader.lookup({
        actor,
        value: {
          lookupKind: "membership-number",
          value: source.memberNumber,
          purpose: "member-identity-lookup",
        },
        now: services.now(),
      });
      return { studentId: result.matched ? result.row.studentId : null };
    } catch (error) {
      return mapMemberDirectoryError(error);
    }
  },
);

export const registerImportedMemberForOffice = onCall(
  {
    ...browserAdminCallableOptions,
    secrets: [identityKeySecret, migrationIntegritySecret, directoryCursorSecret],
  },
  async (request) => {
    const services = defaultMemberDirectoryCallableServices();
    const actor = await requireCanonicalMemberDirectoryActor(request, services.isActorActive);
    const input = officeMemberRegistrationSchema.safeParse(request.data);
    if (!input.success)
      throw new HttpsError("invalid-argument", "Choose the member's date of birth and centre.");
    try {
      const source = await importedMemberRecord(actor.academyId, input.data.recordId);
      const value = {
        requestId: input.data.requestId,
        fullName: source.fullName,
        dateOfBirth: source.birthDate ?? input.data.dateOfBirth,
        trainingCenter: input.data.trainingCenter,
        trainingTimePreferences: input.data.trainingTimePreferences,
        ...(source.memberNumber ? { membershipNumber: source.memberNumber } : {}),
        ...(source.mobile ? { phoneNumber: source.mobile } : {}),
        gender: source.gender,
      };
      return (services.writer as OfficeMemberDirectoryService).registerImportedMember({
        actor,
        value,
        recordId: source.recordId,
        now: services.now(),
      });
    } catch (error) {
      return mapMemberDirectoryError(error);
    }
  },
);
