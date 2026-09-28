// One-off: add the full details to admin notifications written before details existed.
// Dry run by default; pass "aplicar" to write. Only touches notifications without `details`.
//   node --experimental-strip-types scripts/backfill-notification-details.mjs [aplicar]
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import { createNotificationDescriber } from "../apps/functions/src/notifications/notification-details.ts";

const r = createRequire(new URL("../apps/functions/package.json", import.meta.url));
const { initializeApp } = r("firebase-admin/app");
const { getAuth } = r("firebase-admin/auth");
const { getFirestore } = r("firebase-admin/firestore");

initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? "bptjersey-f5a25" });
const academyId = process.env.ACADEMY_ID ?? "demo-academy";
const apply = process.argv[2] === "aplicar";
const db = getFirestore();
const base = db.doc(`academies/${academyId}`);
// Must match the `messages` table in admin-notification-triggers.ts.
const titles = {
  "enrolment.request.submitted": "New registration awaiting approval",
  "enrolment.request.approved": "Registration approved",
  "enrolment.request.approval.failed": "Registration approval needs attention",
  "enrolment.request.returned": "Registration returned for changes",
  "enrolment.request.withdrawn": "Registration withdrawn",
  "member.created": "Member added",
  "membership.created": "Subscription created",
  "membership.subscription.updated": "Subscription updated",
  "membership.status.changed": "Subscription status changed",
  "payment.recorded": "Payment recorded",
  "invoice.created": "Invoice created",
  "invoice.voided": "Invoice voided",
  "invoice.status.changed": "Invoice status changed",
  "session.quorum.cancelled": "Class cancelled: minimum attendance not reached",
};
const describer = createNotificationDescriber({
  get: async (path) => (await db.doc(path).get()).data(),
  userName: async (userId) => {
    const stored = (await base.collection("users").doc(userId).get()).get("displayName");
    if (typeof stored === "string" && stored.trim()) return stored.trim();
    return (await getAuth().getUser(userId).catch(() => null))?.displayName?.trim() || null;
  },
});

const events = await base.collection("auditEvents").where("action", "in", Object.keys(titles)).get();
let updated = 0;
let skipped = 0;
for (const event of events.docs) {
  const id = `event-${createHash("sha256").update(event.id).digest("hex")}`;
  const ref = base.collection("adminNotifications").doc(id);
  const notice = await ref.get();
  if (!notice.exists || notice.get("details")) {
    skipped += 1;
    continue;
  }
  const data = event.data();
  const described = await describer.describe(
    {
      action: data.action,
      actorId: typeof data.actorId === "string" ? data.actorId : "",
      targetRef: String(data.targetRef),
      amountMinor: data.amountMinor,
      method: data.method,
    },
    titles[data.action],
  );
  if (!described) {
    skipped += 1;
    continue;
  }
  console.log(`${data.action.padEnd(32)} ${described.message}`);
  if (apply) {
    await ref.update({
      message: described.message.slice(0, 500),
      details: described.details,
      studentId: notice.get("studentId") ?? described.studentId,
      membershipId: notice.get("membershipId") ?? described.membershipId,
    });
  }
  updated += 1;
}
console.log(`${apply ? "Actualizadas" : "Se actualizarían"}: ${updated} · sin cambios: ${skipped}`);
