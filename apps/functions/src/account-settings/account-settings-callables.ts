/**
 * Callables for account settings and teen access (T044V2). Reserved by phase 0 so that the three member
 * features register their callables in their own file; `src/index.ts` already re-exports it.
 * Add the callable here and its name to `deploy-runtime.ts`, nothing else touches `index.ts`.
 */
import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { parseUserProfile } from "@bpt-jersey/domain/profiles";
import { defineSecret } from "firebase-functions/params";
import {
  HttpsError,
  onCall,
  type CallableOptions,
  type CallableRequest,
} from "firebase-functions/v2/https";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { createCanonicalMemberDirectoryService } from "../members/canonical-member-directory-service.js";
import { enrolmentStorageSecrets } from "../members/enrolment-payment-proof.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import {
  createFirestoreMemberAccessService,
  requireMemberProfileAccess,
} from "../members/member-access-service.js";
import { createMemberDirectoryFirestoreAdapters } from "../members/member-directory-firestore.js";
import { createPrivateStorageR2Client } from "../storage/r2-client.js";
import {
  createAccountSettingsService,
  type StudentAccountLinker,
  type TeenAccessAuth,
} from "./account-settings-service.js";
import {
  createOwnEmergencyContactService,
  type OwnContactFirestore,
} from "./own-emergency-contact.js";

const identityKeySecret = defineSecret("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET");
const migrationIntegritySecret = defineSecret("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET");

const storageOptions = { ...browserAdminCallableOptions, secrets: enrolmentStorageSecrets };
/** sharp decodes up to 20 MP: give the upload room and one image at a time per instance. */
const uploadOptions = {
  ...storageOptions,
  memory: "512MiB" as const,
  concurrency: 1,
  timeoutSeconds: 30,
};

/** Teen access writes `students/{id}.userId`, so it carries the canonical directory writer secrets. */
const directoryOptions = {
  ...browserAdminCallableOptions,
  secrets: [identityKeySecret, migrationIntegritySecret],
};

type Service = ReturnType<typeof createAccountSettingsService>;

function teenAuth(): TeenAccessAuth {
  const auth = getAuth();
  return {
    createUser: async (input) => ({ uid: (await auth.createUser(input)).uid }),
    setCustomUserClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
    deleteUser: (uid) => auth.deleteUser(uid),
    updateUser: (uid, input) => auth.updateUser(uid, input),
    revokeRefreshTokens: (uid) => auth.revokeRefreshTokens(uid),
  };
}

function studentAccountLinker(): StudentAccountLinker {
  const projectId = getApp().options.projectId;
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new HttpsError("failed-precondition", "Firebase project binding is unavailable");
  }
  const directory = createCanonicalMemberDirectoryService({
    projectId,
    identitySecretMaterial: identityKeySecret.value(),
    identitySecretVersion: "identity-v1",
    integritySecretMaterial: migrationIntegritySecret.value(),
    integritySecretVersion: "integrity-v1",
    firestore: createMemberDirectoryFirestoreAdapters(getFirestore()).writer,
  });
  // requireMemberAccountActor has already required App Check and an active member account.
  return ({ actor, studentId, userId, expectedUserId, now }) =>
    directory.setStudentAccountLink({
      actor: {
        actorId: actor.userId,
        academyId: actor.academyId,
        role: "guardian",
        active: true,
        appCheckVerified: true,
      },
      studentId,
      userId,
      expectedUserId,
      now,
    });
}

function settingsCallable<T>(
  options: CallableOptions,
  run: (
    service: Service,
    actor: { userId: string; academyId: string },
    data: unknown,
    request: CallableRequest<unknown>,
  ) => Promise<T>,
  withTeen: "none" | "auth" | "directory" = "none",
) {
  return onCall(options, async (request: CallableRequest<unknown>) => {
    const actor = await requireMemberAccountActor(request);
    const firestore = getFirestore();
    try {
      const service = createAccountSettingsService({
        firestore,
        r2: createPrivateStorageR2Client(),
        access: createFirestoreMemberAccessService({ firestore }),
        ...(withTeen === "none"
          ? {}
          : {
              teen: {
                auth: teenAuth(),
                ...(withTeen === "directory" ? { linkStudentAccount: studentAccountLinker() } : {}),
              },
            }),
      });
      return await run(service, actor, request.data, request);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("unavailable", "Your settings could not be saved. Try again.");
    }
  });
}

export const uploadProfilePhoto = settingsCallable(uploadOptions, (s, actor, data) =>
  s.uploadProfilePhoto(actor, data),
);
export const removeProfilePhoto = settingsCallable(storageOptions, (s, actor, data) =>
  s.removeProfilePhoto(actor, data),
);
export const approveProposedPhoto = settingsCallable(storageOptions, (s, actor, data) =>
  s.approveProposedPhoto(actor, data),
);
export const getMySettings = settingsCallable(storageOptions, (s, actor, data) =>
  s.getMySettings(actor, data),
);
export const setMemberVisibility = settingsCallable(browserAdminCallableOptions, (s, actor, data) =>
  s.setMemberVisibility(actor, data),
);
export const createTeenAccess = settingsCallable(
  directoryOptions,
  (s, actor, data) => s.createTeenAccess(actor, data),
  "directory",
);
export const revokeTeenAccess = settingsCallable(
  directoryOptions,
  (s, actor, data) => s.revokeTeenAccess(actor, data),
  "directory",
);
export const getAdultClaimStatus = settingsCallable(browserAdminCallableOptions, (s, actor, data) =>
  s.getAdultClaimStatus(actor, data),
);
export const claimAdultAccount = settingsCallable(
  browserAdminCallableOptions,
  (s, actor, data, request) =>
    s.claimAdultAccount(actor, data, Number(request.auth?.token.auth_time) * 1000),
  "auth",
);

function ownEmergencyContactService() {
  const firestore = getFirestore();
  const projectId = getApp().options.projectId;
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new HttpsError("failed-precondition", "Firebase project binding is unavailable");
  }
  return createOwnEmergencyContactService({
    firestore: firestore as unknown as OwnContactFirestore,
    projectId,
    identitySecretVersion: "identity-v1",
    integritySecretMaterial: migrationIntegritySecret.value(),
    integritySecretVersion: "integrity-v1",
    resolveAccess: async (academyId, userId, studentId) =>
      (await requireMemberProfileAccess(academyId, userId, studentId, { firestore })).studentId,
    readDocument: async (path) => (await firestore.doc(path).get()).data(),
  });
}

function ownContactCallable<T>(
  run: (
    service: ReturnType<typeof createOwnEmergencyContactService>,
    actor: { userId: string; academyId: string },
    data: unknown,
  ) => Promise<T>,
) {
  // The save is a canonical directory write, so both carry the directory writer secrets.
  return onCall(directoryOptions, async (request: CallableRequest<unknown>) => {
    const actor = await requireMemberAccountActor(request);
    try {
      return await run(ownEmergencyContactService(), actor, request.data);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("unavailable", "The emergency contact could not be saved. Try again.");
    }
  });
}

export const getOwnEmergencyContact = ownContactCallable((s, actor, data) => s.get(actor, data));
export const saveOwnEmergencyContact = ownContactCallable((s, actor, data) => s.save(actor, data));

/** The Firestore reads and writes the email sync needs, so it can be exercised without Firebase. */
export type AccountEmailStore = Readonly<{
  /** Runs `update` on `users/{uid}` inside one transaction; writes only when it returns a document. */
  updateUser: (
    academyId: string,
    userId: string,
    update: (
      current: Readonly<Record<string, unknown>> | undefined,
    ) => Readonly<Record<string, unknown>> | undefined,
  ) => Promise<boolean>;
  listOwnStudents: (
    academyId: string,
    userId: string,
  ) => Promise<readonly Readonly<{ id: string; data: Readonly<Record<string, unknown>> }>[]>;
  updateStudentEmail: (
    academyId: string,
    studentId: string,
    fields: Readonly<{ email: string; updatedAt: string; updatedBy: string }>,
  ) => Promise<void>;
}>;

/**
 * After `verifyBeforeUpdateEmail`, Auth holds the new address; copy it to the profile documents that
 * repeat it. The Auth user record is the source of truth: only a verified email counts, and nothing
 * is written when the stored copy already matches.
 */
export async function syncAccountEmail(
  store: AccountEmailStore,
  actor: Readonly<{ userId: string; academyId: string }>,
  authUser: Readonly<{ email?: string | undefined; emailVerified: boolean }>,
  now: string,
): Promise<{ updated: boolean }> {
  if (!authUser.emailVerified || !authUser.email) return { updated: false };
  const email = authUser.email.trim().toLowerCase();
  let updated = await store.updateUser(actor.academyId, actor.userId, (current) => {
    const user = parseUserProfile(current);
    if (!user.ok || user.value.userId !== actor.userId || user.value.email === email)
      return undefined;
    const next = parseUserProfile({
      ...user.value,
      email,
      updatedAt: now,
      updatedBy: actor.userId,
    });
    return next.ok ? next.value : undefined;
  });
  for (const student of await store.listOwnStudents(actor.academyId, actor.userId)) {
    if (typeof student.data.email === "string" && student.data.email !== email) {
      await store.updateStudentEmail(actor.academyId, student.id, {
        email,
        updatedAt: now,
        updatedBy: actor.userId,
      });
      updated = true;
    }
  }
  return { updated };
}

function firestoreAccountEmailStore(): AccountEmailStore {
  const db = getFirestore();
  return {
    updateUser: (academyId, userId, update) =>
      db.runTransaction(async (tx) => {
        const ref = db.doc(`academies/${academyId}/users/${userId}`);
        const next = update((await tx.get(ref)).data());
        if (!next) return false;
        tx.set(ref, next);
        return true;
      }),
    listOwnStudents: async (academyId, userId) =>
      (
        await db
          .collection(`academies/${academyId}/students`)
          .where("userId", "==", userId)
          .limit(10)
          .get()
      ).docs.map((doc) => ({ id: doc.id, data: doc.data() })),
    updateStudentEmail: async (academyId, studentId, fields) => {
      await db.doc(`academies/${academyId}/students/${studentId}`).update({ ...fields });
    },
  };
}

/** The callable body with its Firebase edges injected; the ID token's email is never trusted here. */
export function createSyncOwnAccountEmailHandler(
  deps: Readonly<{
    requireActor: (
      request: CallableRequest<unknown>,
    ) => Promise<Readonly<{ userId: string; academyId: string }>>;
    getAuthUser: (
      uid: string,
    ) => Promise<Readonly<{ email?: string | undefined; emailVerified: boolean }>>;
    store: () => AccountEmailStore;
    now?: () => string;
  }>,
) {
  return async (request: CallableRequest<unknown>) => {
    const actor = await deps.requireActor(request);
    parseEmpty(request.data);
    try {
      const authUser = await deps.getAuthUser(actor.userId);
      return await syncAccountEmail(
        deps.store(),
        actor,
        { email: authUser.email, emailVerified: authUser.emailVerified },
        deps.now?.() ?? new Date().toISOString(),
      );
    } catch {
      throw new HttpsError("unavailable", "Your email could not be updated. Try again.");
    }
  };
}

export const syncOwnAccountEmail = onCall(
  browserAdminCallableOptions,
  createSyncOwnAccountEmailHandler({
    requireActor: requireMemberAccountActor,
    getAuthUser: (uid) => getAuth().getUser(uid),
    store: firestoreAccountEmailStore,
  }),
);

function parseEmpty(data: unknown): void {
  if (
    data !== null &&
    data !== undefined &&
    (typeof data !== "object" || Object.keys(data).length > 0)
  )
    throw new HttpsError("invalid-argument", "Check the request details.");
}
