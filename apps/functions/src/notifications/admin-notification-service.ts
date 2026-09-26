import {
  FieldPath,
  type DocumentReference,
  type Firestore,
  type Query,
} from "firebase-admin/firestore";
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

const pageSize = 30;
const readScanPages = 10;

function parseNotice(doc: { id: string; data: () => unknown }): AdminNotification {
  const result = adminNotificationSchema.parse(doc.data());
  if (result.notificationId !== doc.id)
    throw new HttpsError("internal", "Notifications unavailable.");
  return result;
}

const positionOf = (notice: AdminNotification) => ({
  createdAt: notice.createdAt,
  notificationId: notice.notificationId,
});

export async function getAdminInbox(
  db: Firestore,
  academyId: string,
  input: AdminInboxQuery,
): Promise<AdminInboxPage> {
  const collection = db.collection(`academies/${academyId}/adminNotifications`);
  let base: Query = collection;
  if (input.kind) base = base.where("kind", "==", input.kind);
  if (input.readState === "unread") base = base.where("readAt", "==", null);
  // Stored timestamps are toISOString(); normalise so string ranges compare correctly.
  if (input.from) base = base.where("createdAt", ">=", new Date(input.from).toISOString());
  if (input.to) base = base.where("createdAt", "<=", new Date(input.to).toISOString());
  base = base.orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc");
  const unread = () => collection.where("readAt", "==", null).count().get();

  if (input.readState !== "read") {
    const query = input.cursor
      ? base.startAfter(input.cursor.createdAt, input.cursor.notificationId)
      : base;
    const [page, count] = await Promise.all([query.limit(pageSize + 1).get(), unread()]);
    const notifications = page.docs.slice(0, pageSize).map(parseNotice);
    const last = notifications.at(-1);
    return {
      notifications,
      unreadCount: count.data().count,
      nextCursor: page.size > pageSize && last ? positionOf(last) : null,
    };
  }

  // ponytail: bounded scan; add a readState field if read-filter gets slow
  const notifications: AdminNotification[] = [];
  let cursor = input.cursor;
  let nextCursor: AdminInboxPage["nextCursor"] = null;
  for (let scanned = 0; scanned < readScanPages; scanned += 1) {
    const query = cursor ? base.startAfter(cursor.createdAt, cursor.notificationId) : base;
    const page = await query.limit(pageSize + 1).get();
    for (const doc of page.docs) {
      const notice = parseNotice(doc);
      if (notice.readAt === null) {
        cursor = positionOf(notice);
        continue;
      }
      if (notifications.length === pageSize) {
        nextCursor = positionOf(notifications.at(-1)!);
        break;
      }
      notifications.push(notice);
      cursor = positionOf(notice);
    }
    if (nextCursor || page.size <= pageSize) break;
    if (scanned === readScanPages - 1) nextCursor = cursor;
  }
  return { notifications, unreadCount: (await unread()).data().count, nextCursor };
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
