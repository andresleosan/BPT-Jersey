import { FieldPath, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  adminNotificationSchema,
  type AdminInboxQuery,
  type AdminInboxPage,
  type AdminNotificationAction,
  type AdminNotification,
} from "@bpt-jersey/domain/memberships/admin";
import { parseMembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import { parseStudentProfile } from "@bpt-jersey/domain/profiles";
import { expiryNotificationId } from "./notification-identifiers.js";

const dayMs = 24 * 60 * 60 * 1000;

/** Re-read in a transaction: a scheduler snapshot may predate an extension or cancellation. */
export async function syncSubscriptionNotice(
  db: Firestore,
  reference: DocumentReference,
  previousEnd?: string | null,
): Promise<void> {
  const match = /^academies\/([^/]+)\/memberships\/([^/]+)$/u.exec(reference.path);
  if (!match) return;
  const academyId = match[1]!;
  const membershipId = match[2]!;
  const base = db.doc(`academies/${academyId}`);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const parsed = parseMembershipRecord(snapshot.data());
    const current =
      parsed.ok &&
      parsed.value.academyId === academyId &&
      parsed.value.membershipId === membershipId
        ? parsed.value
        : null;
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const oldRef = previousEnd
      ? base.collection("adminNotifications").doc(expiryNotificationId(membershipId, previousEnd))
      : null;
    const old = oldRef ? await transaction.get(oldRef) : null;
    const end = current?.endsAt;
    const due =
      current &&
      current.status !== "cancelled" &&
      end &&
      Date.parse(end) <= nowMs + dayMs &&
      Date.parse(end) > nowMs - dayMs;
    const noticeRef = due
      ? base.collection("adminNotifications").doc(expiryNotificationId(membershipId, end))
      : null;
    const notice = noticeRef ? await transaction.get(noticeRef) : null;
    const student = due
      ? parseStudentProfile(
          (await transaction.get(base.collection("students").doc(current.studentId))).data(),
        )
      : null;
    if (
      oldRef &&
      old?.exists &&
      (!current || current.status === "cancelled" || current.endsAt !== previousEnd)
    ) {
      transaction.update(oldRef, { resolvedAt: now, readAt: now });
    }
    if (
      noticeRef &&
      !notice?.exists &&
      current &&
      end &&
      student?.ok &&
      student.value.academyId === academyId &&
      student.value.studentId === current.studentId
    ) {
      const value: AdminNotification = {
        notificationId: noticeRef.id,
        kind: "subscription-expiring",
        title: "Subscription ending",
        message: `${student.value.fullName}'s subscription is ending. Extend it by one month or keep the current end date.`,
        href: "/admin/members",
        createdAt: now,
        readAt: null,
        resolvedAt: null,
        membershipId,
        studentId: current.studentId,
        endsAt: new Date(end).toISOString(),
      };
      transaction.create(noticeRef, adminNotificationSchema.parse(value));
    }
  });
}

export async function getAdminInbox(
  db: Firestore,
  academyId: string,
  input: AdminInboxQuery,
): Promise<AdminInboxPage> {
  const collection = db.collection(`academies/${academyId}/adminNotifications`);
  let query = (input.filter === "unread" ? collection.where("readAt", "==", null) : collection)
    .orderBy("createdAt", "desc")
    .orderBy(FieldPath.documentId(), "desc");
  if (input.cursor) query = query.startAfter(input.cursor.createdAt, input.cursor.notificationId);
  const [page, unread] = await Promise.all([
    query.limit(31).get(),
    collection.where("readAt", "==", null).count().get(),
  ]);
  const notifications = page.docs.slice(0, 30).map((doc) => {
    const result = adminNotificationSchema.parse(doc.data());
    if (result.notificationId !== doc.id)
      throw new HttpsError("internal", "Notifications unavailable.");
    return result;
  });
  const last = notifications.at(-1);
  return {
    notifications,
    unreadCount: unread.data().count,
    nextCursor:
      page.size > 30 && last
        ? { createdAt: last.createdAt, notificationId: last.notificationId }
        : null,
  };
}

export async function actOnAdminNotification(
  db: Firestore,
  academyId: string,
  input: AdminNotificationAction,
): Promise<void> {
  const base = db.doc(`academies/${academyId}`);
  const ref = base.collection("adminNotifications").doc(input.notificationId);
  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(ref);
    if (!doc.exists) throw new HttpsError("not-found", "Notification no longer exists.");
    const notice = adminNotificationSchema.parse(doc.data());
    const now = new Date().toISOString();
    if (input.action === "leave" && !notice.resolvedAt) {
      if (notice.kind !== "subscription-expiring" || !notice.membershipId)
        throw new HttpsError("invalid-argument", "This notification has no expiry action.");
      const membership = parseMembershipRecord(
        (await transaction.get(base.collection("memberships").doc(notice.membershipId))).data(),
      );
      if (
        !membership.ok ||
        membership.value.academyId !== academyId ||
        membership.value.membershipId !== notice.membershipId ||
        membership.value.status === "cancelled" ||
        !membership.value.endsAt ||
        new Date(membership.value.endsAt).toISOString() !== notice.endsAt
      ) {
        throw new HttpsError("aborted", "Subscription changed. Refresh the notifications.");
      }
    }
    transaction.update(ref, {
      readAt: notice.readAt ?? now,
      ...(input.action === "leave" ? { resolvedAt: notice.resolvedAt ?? now } : {}),
    });
  });
}
