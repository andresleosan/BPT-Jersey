import { createHash } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  adminNotificationSchema,
  type AdminNotification,
} from "@bpt-jersey/domain/memberships/admin";
import { syncSubscriptionNotice } from "./admin-notification-service.js";
import {
  PRIVATE_LESSON_MINUTES,
  PRIVATE_LESSON_OPTIONS,
  type PrivateLessonOptionId,
} from "@bpt-jersey/domain/private-lessons";
import { createNotificationDescriber, money } from "./notification-details.js";

/** Profile name first, then the sign-in name: the same order finance uses for "Recorded by". */
function describer(db: Firestore, academyId: string) {
  return createNotificationDescriber({
    get: async (path) => (await db.doc(path).get()).data(),
    userName: async (userId) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(userId)) return null;
      const stored: unknown = (await db.doc(`academies/${academyId}/users/${userId}`).get()).get(
        "displayName",
      );
      if (typeof stored === "string" && stored.trim()) return stored.trim();
      return (
        (
          await getAuth()
            .getUser(userId)
            .catch(() => null)
        )?.displayName?.trim() || null
      );
    },
  });
}

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
  // H-09: a change to the bank details members transfer to must reach the owner.
  "academy.payment_instructions.saved": {
    kind: "payment",
    title: "Bank transfer details changed",
    href: "/admin/finance",
  },
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
    if ((await ref.get()).exists) return;
    const described = await describer(db, event.params.academyId).describe(
      {
        action: data.action,
        actorId: typeof data.actorId === "string" ? data.actorId : "",
        targetRef: data.targetRef,
        amountMinor: data.amountMinor,
        method: data.method,
      },
      copy.title,
    );
    const value = adminNotificationSchema.parse({
      notificationId: id,
      ...copy,
      message: (described?.message ?? "Open the related section to review the details.").slice(
        0,
        500,
      ),
      createdAt:
        data.occurredAt instanceof Timestamp
          ? data.occurredAt.toDate().toISOString()
          : new Date(event.time).toISOString(),
      readAt: null,
      resolvedAt: null,
      membershipId: described?.membershipId ?? null,
      studentId: described?.studentId ?? null,
      endsAt: null,
      ...(described ? { details: described.details } : {}),
    });
    await db.runTransaction(async (transaction) => {
      if (!(await transaction.get(ref)).exists) transaction.create(ref, value);
    });
  },
);

/** A member paying by bank transfer from My plan writes an application, not an audit event. */
export const adminPlanPaymentNotificationCreated = onDocumentCreated(
  {
    document: "academies/{academyId}/membershipApplications/{applicationId}",
    retry: true,
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.academyId !== event.params.academyId) return;
    const db = getFirestore();
    const id = `application-${createHash("sha256").update(event.params.applicationId).digest("hex")}`;
    const ref = db.doc(`academies/${event.params.academyId}/adminNotifications/${id}`);
    if ((await ref.get()).exists) return;
    const described = await describer(db, event.params.academyId).describeApplication(data);
    const value = adminNotificationSchema.parse({
      notificationId: id,
      kind: "payment",
      title: described.details.amount ? "Payment sent for approval" : "Plan chosen for approval",
      href: "/admin/members/requests",
      message: described.message.slice(0, 500),
      createdAt:
        typeof data.createdAt === "string" && !Number.isNaN(Date.parse(data.createdAt))
          ? new Date(data.createdAt).toISOString()
          : new Date(event.time).toISOString(),
      readAt: null,
      resolvedAt: null,
      membershipId: null,
      studentId: described.studentId,
      endsAt: null,
      details: described.details,
    });
    await db.runTransaction(async (transaction) => {
      if (!(await transaction.get(ref)).exists) transaction.create(ref, value);
    });
  },
);

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null;
}

/**
 * A member paying for private lessons: the office calls them to agree the day and time, so the
 * notice carries the phone number next to the purchase.
 */
export const adminPrivateLessonPurchaseNotificationCreated = onDocumentCreated(
  {
    document: "academies/{academyId}/privateLessonPurchases/{purchaseId}",
    retry: true,
  },
  async (event) => {
    const data = event.data?.data();
    if (
      !data ||
      data.academyId !== event.params.academyId ||
      data.source !== "member" ||
      typeof data.studentId !== "string" ||
      typeof data.optionId !== "string" ||
      !Object.hasOwn(PRIVATE_LESSON_OPTIONS, data.optionId)
    )
      return;
    const db = getFirestore();
    const base = db.doc(`academies/${event.params.academyId}`);
    const id = `private-lesson-${createHash("sha256").update(event.params.purchaseId).digest("hex")}`;
    const ref = base.collection("adminNotifications").doc(id);
    if ((await ref.get()).exists) return;
    const [student, account] = await Promise.all([
      base.collection("students").doc(data.studentId).get(),
      typeof data.accountUid === "string"
        ? base.collection("users").doc(data.accountUid).get()
        : Promise.resolve(null),
    ]);
    const option = PRIVATE_LESSON_OPTIONS[data.optionId as PrivateLessonOptionId];
    const name = textOf(student.get("fullName")) ?? "A member";
    const phone = textOf(student.get("phoneNumber")) ?? textOf(account?.get("phoneNumber"));
    const amount = money(typeof data.priceMinor === "number" ? data.priceMinor : null);
    const sessions =
      data.optionId === "monthly"
        ? `${option.credits} x ${PRIVATE_LESSON_MINUTES} min, one a week`
        : `${option.credits} x ${PRIVATE_LESSON_MINUTES} min within ${option.validityMonths} months`;
    const value = adminNotificationSchema.parse({
      notificationId: id,
      kind: "payment",
      title: "Private lessons paid: call to arrange the sessions",
      href: "/admin/billing",
      message: `${name} paid for ${option.displayName}. ${
        phone ? `Call ${phone}` : "Contact them"
      } to agree the day and time, approve the payment, then create the sessions in Classes.`.slice(
        0,
        500,
      ),
      createdAt:
        typeof data.submittedAt === "string" && !Number.isNaN(Date.parse(data.submittedAt))
          ? new Date(data.submittedAt).toISOString()
          : new Date(event.time).toISOString(),
      readAt: null,
      resolvedAt: null,
      membershipId: null,
      studentId: data.studentId,
      endsAt: null,
      details: {
        from: name.slice(0, 160),
        amount,
        facts: [
          { label: "Member", value: name },
          { label: "Phone", value: phone ?? "Not on file" },
          { label: "Service", value: option.displayName },
          { label: "Sessions", value: sessions },
          ...(textOf(data.bankReference)
            ? [{ label: "Bank reference", value: textOf(data.bankReference)! }]
            : []),
          { label: "Status", value: "Awaiting approval" },
        ],
      },
    });
    await db.runTransaction(async (transaction) => {
      if (!(await transaction.get(ref)).exists) transaction.create(ref, value);
    });
  },
);
