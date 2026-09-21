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
