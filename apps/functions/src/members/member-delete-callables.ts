import { removeMemberFromGroups } from "../schedule/group-service.js";
import {
  deleteMemberAccountInputSchema,
  deleteMemberAccountResultSchema,
} from "@bpt-jersey/domain/members/overview";
import { createHash } from "node:crypto";
import { getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { clientIpFromRequest } from "../audit/client-ip.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { createFirestoreScheduleStore } from "../schedule/schedule-service.js";

/**
 * Hard delete of one member record, for the owner only. Built for the duplicates the bulk
 * migration created next to an existing member: those carry no login and no billing history.
 *
 * Refuses when the member has an app login or any invoice, because both reach beyond the record.
 * Future confirmed bookings are cancelled through the booking transaction (capacity stays right
 * and each cancellation is audited); memberships, identity reservations, archive links, family
 * relationships and the member's own office family are removed; audit events are never deleted.
 *
 * ponytail: the directory's rollback counter is not decremented, so it may over-count by the
 * number of deleted records; adjust it through the directory service if that limit ever bites.
 */
export async function deleteMemberAccountHandler(
  actor: { academyId: string; userId: string; role: string },
  data: unknown,
  clientIp: string | null,
) {
  if (actor.role !== "owner") throw new HttpsError("permission-denied", "Only the owner can delete a member account.");
  const parsed = deleteMemberAccountInputSchema.safeParse(data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Check the member and try again.");
  const { studentId, requestId } = parsed.data;
  const firestore = getFirestore();
  const root = `academies/${actor.academyId}`;
  const studentRef = firestore.doc(`${root}/students/${studentId}`);
  const student = (await studentRef.get()).data();
  if (!student || student.academyId !== actor.academyId) throw new HttpsError("not-found", "This member no longer exists.");
  if (typeof student.userId === "string")
    throw new HttpsError("failed-precondition", "This member has an app login. Unlink the login before deleting the account.");
  const familyId = typeof student.familyId === "string" ? student.familyId : undefined;
  if (familyId && !(await firestore.collection(`${root}/invoices`).where("familyId", "==", familyId).limit(1).get()).empty)
    throw new HttpsError("failed-precondition", "This member has billing history. Deactivate the account instead of deleting it.");

  const byStudent = (name: string) => firestore.collection(`${root}/${name}`).where("studentId", "==", studentId).get();
  const [bookings, memberships, keys, relationships, ...links] = await Promise.all([
    byStudent("bookings"),
    byStudent("memberships"),
    firestore.collection(`${root}/studentIdentityKeys`).where("ownerStudentId", "==", studentId).get(),
    byStudent("relationships"),
    byStudent("regyfitMemberLinks"),
    byStudent("regyfitOfficeLinks"),
    byStudent("memberRecoverySourceLinks"),
  ]);

  const store = createFirestoreScheduleStore({
    firestore: firestore as unknown as Parameters<typeof createFirestoreScheduleStore>[0]["firestore"],
  });
  let cancelledBookings = 0;
  for (const booking of bookings.docs) {
    if (booking.get("status") !== "confirmed" || typeof booking.get("sessionId") !== "string") continue;
    try {
      await store.cancelBooking(
        actor.academyId,
        { sessionId: booking.get("sessionId"), studentId, reason: "Member account deleted" },
        actor.userId,
        true,
        { ip: clientIp, role: actor.role },
      );
      cancelledBookings += 1;
    } catch {
      // A past session cannot be cancelled: the booking stays as history of a deleted record.
    }
  }

  // The member's own office family goes with it, unless another record still bills through it.
  let familyRef: DocumentReference | undefined;
  if (familyId === `office-${studentId}`) {
    const sharers = await firestore.collection(`${root}/students`).where("familyId", "==", familyId).limit(2).get();
    if (sharers.docs.every((document) => document.id === studentId)) familyRef = firestore.doc(`${root}/families/${familyId}`);
  }
  const singles = ["studentAdminProfiles", "studentLevelProgress", "memberIdentityAliases", "studentGroupAccess", "notificationPreferences"].map(
    (name) => firestore.doc(`${root}/${name}/${studentId}`),
  );
  const auditRef = firestore.collection(`${root}/auditEvents`).doc();
  await firestore.runTransaction(async (transaction) => {
    if (!(await transaction.get(studentRef)).exists) throw new HttpsError("not-found", "This member no longer exists.");
    await removeMemberFromGroups(firestore, transaction, actor.academyId, studentId);
    for (const snapshot of [memberships, keys, relationships, ...links]) for (const document of snapshot.docs) transaction.delete(document.ref);
    for (const reference of singles) transaction.delete(reference);
    if (familyRef) transaction.delete(familyRef);
    transaction.delete(studentRef);
    appendAuditEventInTransaction(transaction, auditRef, {
      academyId: actor.academyId,
      actorId: actor.userId,
      action: "member.account.deleted",
      targetRef: studentRef.path,
      purpose: "member-record-maintenance",
      // Member actions correlate on a write digest, like every other directory mutation.
      correlationId: `write-${createHash("sha256").update(`${actor.academyId}:${studentId}:${requestId}`).digest("hex")}`,
    } as Parameters<typeof appendAuditEventInTransaction>[2]);
  });
  return deleteMemberAccountResultSchema.parse({ studentId, cancelledBookings, removedMemberships: memberships.size });
}

export const deleteMemberAccount = onCall({ ...browserAdminCallableOptions, region: "europe-west9" }, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  return deleteMemberAccountHandler(actor, request.data, clientIpFromRequest(request));
});
