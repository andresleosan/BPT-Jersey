import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { memberNotificationSchema } from "@bpt-jersey/domain";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";

const markReadSchema = z.strictObject({ notificationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u) });

export type MemberNotificationStore = Readonly<{
  list: (academyId: string, recipientUid: string) => Promise<readonly unknown[]>;
  markRead: (academyId: string, recipientUid: string, notificationId: string) => Promise<void>;
}>;

export function createListMemberNotificationsHandler(store: MemberNotificationStore) {
  return async (request: CallableRequest<unknown>) => {
    const actor = await requireMemberAccountActor(request);
    if (!z.null().safeParse(request.data).success) throw new HttpsError("invalid-argument", "Invalid notification request");
    const notifications = z.array(memberNotificationSchema).max(100).parse(await store.list(actor.academyId, actor.userId));
    return { notifications };
  };
}

export function createMarkMemberNotificationReadHandler(store: MemberNotificationStore) {
  return async (request: CallableRequest<unknown>) => {
    const actor = await requireMemberAccountActor(request);
    const input = markReadSchema.safeParse(request.data);
    if (!input.success) throw new HttpsError("invalid-argument", "Invalid notification request");
    await store.markRead(actor.academyId, actor.userId, input.data.notificationId);
    return { ok: true };
  };
}

function firestoreStore(): MemberNotificationStore {
  const db = getFirestore();
  return {
    async list(academyId, recipientUid) {
      const snapshot = await db.collection(`academies/${academyId}/memberNotifications`)
        .where("recipientUid", "==", recipientUid).limit(100).get();
      return snapshot.docs.map((doc) => doc.data()).sort((left, right) => String((right as { createdAt?: unknown }).createdAt).localeCompare(String((left as { createdAt?: unknown }).createdAt)));
    },
    async markRead(academyId, recipientUid, notificationId) {
      const ref = db.doc(`academies/${academyId}/memberNotifications/${notificationId}`);
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const parsed = memberNotificationSchema.safeParse(snapshot.data());
        if (!snapshot.exists || !parsed.success || parsed.data.academyId !== academyId || parsed.data.recipientUid !== recipientUid)
          throw new HttpsError("not-found", "Notification is unavailable");
        if (parsed.data.readAt === null) transaction.update(ref, { readAt: new Date().toISOString() });
      });
    },
  };
}

export const listMemberNotifications = onCall(browserAdminCallableOptions, (request) =>
  createListMemberNotificationsHandler(firestoreStore())(request));
export const markMemberNotificationRead = onCall(browserAdminCallableOptions, (request) =>
  createMarkMemberNotificationReadHandler(firestoreStore())(request));

import { defineSecret } from "firebase-functions/params";
import { membershipApplicationSubmitSchema } from "@bpt-jersey/domain";
import { createPrivateStorageR2Client } from "../storage/r2-client.js";
import { getIntroMembershipContext as loadIntroMembershipContext, submitIntroMembershipApplication as submitApplication } from "./intro-application-service.js";
import { uploadIntroProof } from "./intro-payment-proof.js";

const introStorageSecrets = ["R2_ACCOUNT_ID", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_JURISDICTION"].map((name) => defineSecret(name));
const proofUploadSchema = z.strictObject({ requestId: z.uuid(), contentType: z.enum(["image/png", "image/jpeg"]), base64: z.string().min(4).max(Math.ceil((2 * 1024 * 1024) / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/u) });

export const getIntroMembershipContext = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireMemberAccountActor(request);
  if (request.data !== null) throw new HttpsError("invalid-argument", "Invalid membership request");
  return loadIntroMembershipContext(getFirestore(), actor);
});

export const uploadIntroMembershipProof = onCall({ ...browserAdminCallableOptions, secrets: introStorageSecrets }, async (request) => {
  const actor = await requireMemberAccountActor(request);
  const input = proofUploadSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Choose a PNG or JPEG screenshot up to 2 MB.");
  return uploadIntroProof({ academyId: actor.academyId, userId: actor.userId, ...input.data }, createPrivateStorageR2Client());
});

export const submitIntroMembershipApplication = onCall({ ...browserAdminCallableOptions, secrets: introStorageSecrets }, async (request) => {
  const actor = await requireMemberAccountActor(request);
  const input = membershipApplicationSubmitSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid membership application");
  return submitApplication(getFirestore(), actor, input.data, createPrivateStorageR2Client());
});

import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { membershipApplicationDecisionSchema } from "@bpt-jersey/domain";
import { getIntroProofUrl, listIntroApplications, reviewIntroApplication } from "./intro-application-admin-service.js";
const applicationIdSchema = z.strictObject({ applicationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u) });
export const listIntroMembershipApplications = onCall(browserAdminCallableOptions, async (request) => { const actor = await requireActiveOfficeActor(request); if (request.data !== null) throw new HttpsError("invalid-argument", "Invalid application query"); return { applications: await listIntroApplications(getFirestore(), actor) }; });
export const getIntroMembershipProofUrl = onCall({ ...browserAdminCallableOptions, secrets: introStorageSecrets }, async (request) => { const actor = await requireActiveOfficeActor(request); const input = applicationIdSchema.safeParse(request.data); if (!input.success) throw new HttpsError("invalid-argument", "Invalid application request"); return getIntroProofUrl(getFirestore(), actor, input.data.applicationId, createPrivateStorageR2Client()); });
export const reviewIntroMembershipApplication = onCall(browserAdminCallableOptions, async (request) => { const actor = await requireActiveOfficeActor(request); const input = membershipApplicationDecisionSchema.safeParse(request.data); if (!input.success) throw new HttpsError("invalid-argument", "Invalid review decision"); return reviewIntroApplication(getFirestore(), actor, input.data); });
