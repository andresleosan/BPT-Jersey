import { getFirestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { cancelBookingInTransaction, type BookingFirestore, type BookingTransaction } from "./booking-transaction-service.js";
import { createGroupService, removeMemberFromGroups } from "./group-service.js";
import { createWeeklySessionStore } from "./weekly-session-service.js";

export const groupSessionWritten = onDocumentWritten({ document: "academies/{academyId}/sessions/{sessionId}", retry: true, timeoutSeconds: 540 }, async (event) => {
  if (!event.data?.after.exists) return;
  await createGroupService(getFirestore(), event.params.academyId).syncSession(event.params.sessionId);
});
export const groupAssignmentWritten = onDocumentWritten({ document: "academies/{academyId}/groupAssignments/{assignmentId}", retry: true, timeoutSeconds: 540 }, async (event) => {
  const groupId = event.data?.after.get("groupId");
  if (typeof groupId === "string") await createGroupService(getFirestore(), event.params.academyId).syncUpcoming(groupId);
});
export const memberGroupWritten = onDocumentWritten({ document: "academies/{academyId}/memberGroups/{groupId}", retry: true, timeoutSeconds: 540 }, async (event) => {
  if (event.data?.after.get("active") === true) await createGroupService(getFirestore(), event.params.academyId).syncUpcoming(event.params.groupId);
});
export const groupMembershipWritten = onDocumentWritten({ document: "academies/{academyId}/memberships/{membershipId}", retry: true, timeoutSeconds: 540 }, async (event) => {
  const ids = new Set([event.data?.before.get("studentId"), event.data?.after.get("studentId")].filter((id): id is string => typeof id === "string"));
  const db = getFirestore();
  const service = createGroupService(db, event.params.academyId);
  for (const studentId of ids) {
    const groups = await db.collection(`academies/${event.params.academyId}/memberGroups`).where("studentIds", "array-contains", studentId).get();
    for (const group of groups.docs) if (group.get("active")) await service.syncUpcoming(group.id);
  }
});

/** A rolling window creates real future bookings even if nobody opens the calendar.
 * The series rule has no end date; session-write events cover dates outside this window. */
export const reconcileGroupRegistrations = onSchedule({ schedule: "every 60 minutes", timeZone: "Europe/Jersey", timeoutSeconds: 540, maxInstances: 1, retryCount: 3 }, async () => {
  const db = getFirestore();
  const academies = await db.collection("academies").get();
  for (const academy of academies.docs) {
    const assignments = await academy.ref.collection("groupAssignments").where("active", "==", true).limit(1).get();
    if (assignments.empty) continue;
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 35 * 86_400_000).toISOString();
    await createWeeklySessionStore(db).materialise(academy.id, { from, to });
    await createGroupService(db, academy.id).syncUpcoming();
  }
});

/** Directory deletion can race with a group booking already in flight. Re-read current state and
 * cancel remaining group-owned future reservations after the deletion has committed. */
export const groupStudentWritten = onDocumentWritten({ document: "academies/{academyId}/students/{studentId}", retry: true, timeoutSeconds: 540 }, async (event) => {
  const db = getFirestore();
  const { academyId, studentId } = event.params;
  const root = `academies/${academyId}`;
  const current = await db.doc(`${root}/students/${studentId}`).get();
  const groups = await db.collection(`${root}/memberGroups`).where("studentIds", "array-contains", studentId).get();
  const service = createGroupService(db, academyId);
  if (current.exists) {
    for (const group of groups.docs) if (group.get("active")) await service.syncUpcoming(group.id);
    return;
  }
  await db.runTransaction(async (tx) => {
    if ((await tx.get(db.doc(`${root}/students/${studentId}`))).exists) return;
    await removeMemberFromGroups(db, tx, academyId, studentId);
  });
  const origins = await db.collection(`${root}/groupBookingOrigins`).where("studentId", "==", studentId).get();
  for (const origin of origins.docs) {
    if (origin.get("owned") !== true) continue;
    await db.runTransaction(async (tx) => {
      const member = await tx.get(db.doc(`${root}/students/${studentId}`));
      const liveOrigin = await tx.get(origin.ref);
      if (member.exists || liveOrigin.get("owned") !== true) return;
      const sessionId = String(liveOrigin.get("sessionId"));
      const session = await tx.get(db.doc(`${root}/sessions/${sessionId}`));
      const booking = await tx.get(db.doc(`${root}/bookings/${String(liveOrigin.get("bookingId"))}`));
      if (!session.exists || Date.parse(String(session.get("startAt"))) <= Date.now() || booking.get("status") !== "confirmed") return;
      await cancelBookingInTransaction({ firestore: db as unknown as BookingFirestore, transaction: tx as unknown as BookingTransaction,
        academyId, request: { sessionId, studentId, reason: "Member account deleted" }, actorId: "group-registration", actorRole: "system", actorIp: null, now: new Date().toISOString(), isStaffOverride: true });
    });
  }
});
