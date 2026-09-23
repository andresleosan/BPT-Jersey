import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { createFamilyStore } from "../families/family-service.js";
import {
  createMemberDirectoryActorActivityCheck,
  requireCanonicalMemberDirectoryActor,
} from "../members/canonical-actor.js";
import { createCanonicalMemberDirectoryService } from "../members/canonical-member-directory-service.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { createFirestoreMemberAccessService } from "../members/member-access-service.js";
import { createMemberDirectoryFirestoreAdapters } from "../members/member-directory-firestore.js";
import { createFamilyPlanService } from "./family-plan-service.js";

const identityKeySecret = defineSecret("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET");
const migrationIntegritySecret = defineSecret("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET");
const identitySecretVersion = "identity-v1";
const integritySecretVersion = "integrity-v1";

/** The office door carries the writer secrets; the member-facing callable never needs them. */
const officeCallableOptions = {
  ...browserAdminCallableOptions,
  secrets: [identityKeySecret, migrationIntegritySecret],
};

function requiredProjectId(): string {
  const projectId = getApp().options.projectId;
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new HttpsError("failed-precondition", "Firebase project binding is unavailable");
  }
  return projectId;
}

function officeActivity() {
  const firestore = getFirestore();
  return createMemberDirectoryActorActivityCheck({
    getAuthUser: (uid) => getAuth().getUser(uid),
    getDocument: (path) => firestore.doc(path).get(),
  });
}

function officeService() {
  const firestore = getFirestore();
  const auth = getAuth();
  const control = {
    projectId: requiredProjectId(),
    identitySecretMaterial: identityKeySecret.value(),
    identitySecretVersion,
    integritySecretMaterial: migrationIntegritySecret.value(),
    integritySecretVersion,
  };
  return createFamilyPlanService({
    firestore,
    access: createFirestoreMemberAccessService({ firestore }),
    directory: createCanonicalMemberDirectoryService({
      ...control,
      firestore: createMemberDirectoryFirestoreAdapters(firestore).writer,
    }),
    families: createFamilyStore({
      firestore: firestore as unknown as Parameters<typeof createFamilyStore>[0]["firestore"],
      canonicalControl: control,
      auth: {
        getUser: async (uid) => {
          const user = await auth.getUser(uid);
          return {
            uid: user.uid,
            emailVerified: user.emailVerified,
            disabled: user.disabled,
            ...(user.customClaims ? { customClaims: user.customClaims as Readonly<Record<string, unknown>> } : {}),
          };
        },
      },
    }),
    auth: {
      getUser: async (uid) => {
        const user = await auth.getUser(uid);
        return {
          uid: user.uid,
          disabled: user.disabled,
          ...(user.customClaims ? { customClaims: user.customClaims as Readonly<Record<string, unknown>> } : {}),
        };
      },
      setCustomUserClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
    },
  });
}

export const requestMemberPlanPerson = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireMemberAccountActor(request);
  const firestore = getFirestore();
  return createFamilyPlanService({
    firestore,
    access: createFirestoreMemberAccessService({ firestore }),
  }).requestPerson(actor, request.data);
});

export const listMemberPlanRequests = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireCanonicalMemberDirectoryActor(request, officeActivity());
  const firestore = getFirestore();
  return createFamilyPlanService({
    firestore,
    access: createFirestoreMemberAccessService({ firestore }),
  }).listRequests(actor, request.data);
});

export const decideMemberPlanRequest = onCall(officeCallableOptions, async (request) => {
  const actor = await requireCanonicalMemberDirectoryActor(request, officeActivity());
  return officeService().decide(actor, request.data);
});
