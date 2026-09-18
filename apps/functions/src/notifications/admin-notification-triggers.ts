import { createHash } from "node:crypto";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  adminNotificationSchema,
  type AdminNotification,
} from "@bpt-jersey/domain/memberships/admin";
import { syncSubscriptionNotice } from "./admin-notification-service.js";

export const subscriptionExpiryNoticeWritten = onDocumentWritten(
  {
    document: "academies/{academyId}/memberships/{membershipId}",
    retry: true,
  },
  async (event) => {
    if (!event.data) return;
    const oldEnd: unknown = event.data.before.get("endsAt");
    await syncSubscriptionNotice(
      getFirestore(),
      event.data.after.ref,
      typeof oldEnd === "string" ? oldEnd : null,
    );
  },
);

export const subscriptionExpiryNoticesSchedule = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "UTC",
    maxInstances: 1,
    concurrency: 1,
    timeoutSeconds: 540,
    retryCount: 3,
  },
  async () => {
    const db = getFirestore();
    const now = Date.now();
    // The trailing day catches brief outages and end dates entered after the 24-hour threshold.
    const query = db
      .collectionGroup("memberships")
      .where("endsAt", ">", new Date(now - 86_400_000).toISOString())
      .where("endsAt", "<=", new Date(now + 86_400_000).toISOString())
      .orderBy("endsAt")
      .limit(200);
    let page = await query.get();
    while (!page.empty) {
      // Small batches keep each scheduled run bounded in memory and write concurrency.
      for (let offset = 0; offset < page.docs.length; offset += 10) {
        await Promise.all(
          page.docs.slice(offset, offset + 10).map((doc) => syncSubscriptionNotice(db, doc.ref)),
        );
      }
      const last = page.docs.at(-1);
      if (page.size < 200 || !last) break;
      page = await query.startAfter(last).get();
    }
  },
);

const messages: Record<string, { kind: AdminNotification["kind"]; title: string; href: string }> = {
  "enrolment.request.submitted": {
    kind: "registration",
    title: "New registration awaiting approval",
    href: "/admin/members/requests",
  },
  "enrolment.request.approved": {
    kind: "registration",
    title: "Registration approved",
    href: "/admin/members/requests",
  },
  "enrolment.request.approval.failed": {
    kind: "registration",
    title: "Registration approval needs attention",
    href: "/admin/members/requests",
  },
  "enrolment.request.returned": {
    kind: "registration",
    title: "Registration returned for changes",
    href: "/admin/members/requests",
  },
  "enrolment.request.withdrawn": {
    kind: "registration",
    title: "Registration withdrawn",
    href: "/admin/members/requests",
  },
  "member.created": { kind: "registration", title: "Member added", href: "/admin/members" },
  "membership.created": {
    kind: "membership",
    title: "Subscription created",
    href: "/admin/memberships",
  },
  "membership.subscription.updated": {
    kind: "membership",
    title: "Subscription updated",
    href: "/admin/memberships",
  },
  "membership.status.changed": {
    kind: "membership",
    title: "Subscription status changed",
    href: "/admin/memberships",
  },
  "payment.recorded": { kind: "payment", title: "Payment recorded", href: "/admin/finance" },
  "invoice.created": { kind: "payment", title: "Invoice created", href: "/admin/finance" },
  "invoice.voided": { kind: "payment", title: "Invoice voided", href: "/admin/finance" },
  "invoice.status.changed": {
    kind: "payment",
    title: "Invoice status changed",
    href: "/admin/finance",
  },
  "session.quorum.cancelled": {
    kind: "class",
    title: "Class cancelled: minimum attendance not reached",
    href: "/admin/classes",
  },
};

export const adminOperationalNotificationCreated = onDocumentCreated(
  {
    document: "academies/{academyId}/auditEvents/{auditEventId}",
    retry: true,
  },
  async (event) => {
    const data = event.data?.data();
    if (
      !data ||
      data.academyId !== event.params.academyId ||
      typeof data.action !== "string" ||
      typeof data.targetRef !== "string" ||
      !data.targetRef.startsWith(`academies/${event.params.academyId}/`)
    )
      return;
    const copy = Object.hasOwn(messages, data.action) ? messages[data.action] : undefined;
    if (!copy) return;
    const db = getFirestore();
    const id = `event-${createHash("sha256").update(event.params.auditEventId).digest("hex")}`;
    const ref = db.doc(`academies/${event.params.academyId}/adminNotifications/${id}`);
    const sourceId = data.targetRef.split("/").at(-1);
    const referenceLabel =
      typeof sourceId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(sourceId)
        ? `Reference: ${sourceId}. `
        : "";
    const value = adminNotificationSchema.parse({
      notificationId: id,
      ...copy,
      message: `${referenceLabel}Open the related section to review the details.`,
      createdAt:
        data.occurredAt instanceof Timestamp
          ? data.occurredAt.toDate().toISOString()
          : new Date(event.time).toISOString(),
      readAt: null,
      resolvedAt: null,
      membershipId: null,
      studentId: null,
      endsAt: null,
    });
    await db.runTransaction(async (transaction) => {
      if (!(await transaction.get(ref)).exists) transaction.create(ref, value);
    });
  },
);
