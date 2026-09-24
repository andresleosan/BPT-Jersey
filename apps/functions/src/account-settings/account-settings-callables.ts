/**
 * Callables for account settings and teen access (T044V2). Reserved by phase 0 so that the three member
 * features register their callables in their own file; `src/index.ts` already re-exports it.
 * Add the callable here and its name to `deploy-runtime.ts`, nothing else touches `index.ts`.
 */
import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
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
import { createFirestoreMemberAccessService } from "../members/member-access-service.js";
import { createMemberDirectoryFirestoreAdapters } from "../members/member-directory-firestore.js";
import { createPrivateStorageR2Client } from "../storage/r2-client.js";
import {
  createAccountSettingsService,
  type StudentAccountLinker,
  type TeenAccessAuth,
} from "./account-settings-service.js";

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
