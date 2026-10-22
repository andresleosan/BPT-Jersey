import { removeMemberFromGroups } from "../schedule/group-service.js";
import {
  deleteMemberAccountInputSchema,
  deleteMemberAccountResultSchema,
} from "@bpt-jersey/domain/members/overview";
import { createHash } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { coachMemberAccessPath } from "@bpt-jersey/domain/staff/team-access";
import { appendAuditEventInTransaction } from "../audit/audit-writer.js";
import { clientIpFromRequest } from "../audit/client-ip.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { createFirestoreScheduleStore } from "../schedule/schedule-service.js";

const BY_STUDENT = [
  "bookings", "memberships", "relationships", "attendance", "memberHistoryEntries", "privateLessonPurchases",
  "privateLessonCreditUses", "enrolmentRequests", "membershipApplications", "memberNotifications", "introConversions",
  "enrolmentWaiverAcceptances", "disclaimerAcceptances", "studentGroupAccessEvents", "groupBookingOrigins",
  "regyfitMemberLinks", "regyfitOfficeLinks", "memberRecoverySourceLinks", "graduationReviews",
  // 2026-10-22: per-member records the list missed; every writer stores `studentId`.
  "adminNotifications", "groupSessionExclusions", "groupRegistrationResults", "bookingQuotaStates",
  "waitlistEntries", "waitlistClassInvitations", "waitlistInvitationHistory", "assessments", "medicalLeaves",
  "levelPromotions", "levelHistoryEdits", "attendanceVoids", "introConversionIssues", "memberPlanRequests",
  "healthProfileChangeRequests", "retentionAlerts",
];
const BY_ID = [
  "studentAdminProfiles", "studentLevelProgress", "memberIdentityAliases", "studentGroupAccess", "notificationPreferences",
  "trialAccess", "memberGuardianStates", "memberAttendanceBaselines", "memberReconciliationCases", "memberPublicSettings",
  "teenAccess", "healthProfiles",
];
/** Records sent to or by the member's login: they go only with the login. */
const BY_LOGIN = [["memberNotifications", "recipientUid"], ["memberPlanRequests", "requestedBy"]] as const;
// Kept although they name the member: auditEvents, and progressChanges, the office's log of progress
// changes that stands in for them; memberManualAttendance, the hand-added dates that the Delete
// account dialog says stay and leaves out of its count; the directory's integrity and control plane
// (memberDirectoryStates, -RestoreGuards, -CursorStates, -WriteReceipts), every *Receipts
// collection, levelProgressMigrationAudits, memberMigrationDecisions and membershipChanges, which
// prove a write or a migration happened once; memberGuardianDecisions, the office's decision written
// with a control-plane event; what other members share (memberGroups, which only lose the member;
// sessionCapacityStates; leaderboards); and login-keyed rate limits and holds, with no personal data.
// Evidence whose retention T011 decides stays until the operator rules on it: checkouts, the only
// record of who collected a child, and the signed waiver (consents and documents; this delete cannot
// reach its PDF in R2).
const BACKUP_DAYS = 30;

/**
 * Hard delete of one member, for the owner only, whatever its status or history. Every record that
 * belongs to the member goes: bookings, memberships, attendance, history, identifiers, its own office
 * family with that family's invoices and payments, and its app login when nobody else uses it.
 * Future confirmed bookings are cancelled first so session capacity stays right.
 *
 * Each deleted document is first copied to `deletedMemberBackups` with `expiresAt` 30 days out; a
 * Firestore TTL policy on that field removes the copies. Audit events are kept.
 *
 * ponytail: not one transaction (a member can own more than 500 documents); backups are written
 * before any delete, so a failure half-way loses nothing and a retry finishes the job.
 */
export async function deleteMemberAccountHandler(
  actor: { academyId: string; userId: string; role: string },
  data: unknown,
  clientIp: string | null,
) {
  if (actor.role !== "owner" && actor.role !== "administrator") throw new HttpsError("permission-denied", "Only the office can delete a member account.");
  const parsed = deleteMemberAccountInputSchema.safeParse(data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Check the member and try again.");
  const { studentId, requestId } = parsed.data;
  const firestore = getFirestore();
  const root = `academies/${actor.academyId}`;
  const studentRef = firestore.doc(`${root}/students/${studentId}`);
  const student = (await studentRef.get()).data();
  if (!student || student.academyId !== actor.academyId) throw new HttpsError("not-found", "This member no longer exists.");
  const familyId = typeof student.familyId === "string" ? student.familyId : undefined;
  const loginId = typeof student.userId === "string" ? student.userId : undefined;

  // The login goes too, unless it is also another member's login or a guardian of someone else.
  let deleteLogin = false;
  if (loginId) {
    const [otherStudents, guardianOf] = await Promise.all([
      firestore.collection(`${root}/students`).where("userId", "==", loginId).limit(2).get(),
      firestore.collection(`${root}/relationships`).where("adultUserId", "==", loginId).get(),
    ]);
    deleteLogin =
      otherStudents.docs.every((document) => document.id === studentId) &&
      guardianOf.docs.every((document) => document.get("studentId") === studentId);
  }
  // Checked before any booking is cancelled: a member who is also a coach keeps everything.
  if (deleteLogin && loginId && (await firestore.doc(coachMemberAccessPath(actor.academyId, loginId)).get()).exists)
    throw new HttpsError("failed-precondition", "This member is also a coach. Remove coach access first in Staff.");
  // 2026-10-15: an administrator has the owner's powers except over owner accounts.
  if (deleteLogin && loginId && actor.role !== "owner") {
    const login = await getAuth().getUser(loginId).catch(() => null);
    if (login?.customClaims?.role === "owner")
      throw new HttpsError("permission-denied", "Only an owner can delete an owner's login.");
  }

  const byStudent = (name: string) => firestore.collection(`${root}/${name}`).where("studentId", "==", studentId).get();
  const bookings = await byStudent("bookings");
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
      // A past session cannot be cancelled: its booking is simply deleted below.
    }
  }
  await firestore.runTransaction((transaction) => removeMemberFromGroups(firestore, transaction, actor.academyId, studentId));

  const refs: DocumentReference[] = [studentRef, ...BY_ID.map((name) => firestore.doc(`${root}/${name}/${studentId}`))];
  const snapshots = await Promise.all([
    ...BY_STUDENT.map(byStudent),
    firestore.collection(`${root}/studentIdentityKeys`).where("ownerStudentId", "==", studentId).get(),
  ]);
  const memberships = snapshots[BY_STUDENT.indexOf("memberships")];
  for (const snapshot of snapshots) for (const document of snapshot.docs) refs.push(document.ref);
  // The office's settlement record of each of those subscriptions shares its membership id.
  for (const membership of memberships?.docs ?? []) refs.push(firestore.doc(`${root}/membershipAdministration/${membership.id}`));

  // The member's own office family goes with its billing, unless another record still bills through it.
  if (familyId) {
    const sharers = await firestore.collection(`${root}/students`).where("familyId", "==", familyId).limit(2).get();
    if (sharers.docs.every((document) => document.id === studentId)) {
      refs.push(firestore.doc(`${root}/families/${familyId}`));
      for (const name of ["invoices", "payments"])
        for (const document of (await firestore.collection(`${root}/${name}`).where("familyId", "==", familyId).get()).docs)
          refs.push(document.ref);
      // A voided payment keeps its copy of the payment, family included.
      for (const document of (await firestore.collection(`${root}/voidedPayments`).where("payment.familyId", "==", familyId).get()).docs)
        refs.push(document.ref);
    }
  }

  if (deleteLogin && loginId) {
    refs.push(firestore.doc(`${root}/users/${loginId}`));
    // What the login received or sent goes with it, unless it names another member.
    for (const [name, field] of BY_LOGIN)
      for (const document of (await firestore.collection(`${root}/${name}`).where(field, "==", loginId).get()).docs)
        if ([undefined, null, studentId].includes(document.get("studentId"))) refs.push(document.ref);
  }

  const unique = [...new Map(refs.map((reference) => [reference.path, reference])).values()];
  const documents = (await firestore.getAll(...unique)).filter((document) => document.exists);
  const backupId = `${studentId}-${Date.now()}`;
  const expiresAt = Timestamp.fromMillis(Date.now() + BACKUP_DAYS * 86_400_000);
  const backups = firestore.bulkWriter();
  // close() never fails: a write that failed shows only in its own promise.
  const copies = Promise.allSettled(documents.map((document, index) =>
    backups.create(firestore.doc(`${root}/deletedMemberBackups/${backupId}-${index}`), {
      backupId, studentId, path: document.ref.path, data: document.data(), deletedBy: actor.userId,
      deletedAt: FieldValue.serverTimestamp(), expiresAt,
    }),
  ));
  await backups.close();
  if ((await copies).some((copy) => copy.status === "rejected")) throw new HttpsError("unavailable", "The 30-day copy failed, so nothing was deleted.");
  // The member's own record goes last, with its audit event, so a run that stops half-way can run again.
  const deletes = firestore.bulkWriter();
  const removals = Promise.allSettled(documents.filter((document) => document.ref.path !== studentRef.path).map((document) => deletes.delete(document.ref)));
  await deletes.close();
  if ((await removals).some((removal) => removal.status === "rejected")) throw new HttpsError("unavailable", "Some records were not deleted. Try again.");
  if (deleteLogin && loginId) await getAuth().deleteUser(loginId).catch((error: { code?: string }) => {
    if (error.code !== "auth/user-not-found") throw error;
  });

  await firestore.runTransaction(async (transaction) => {
    transaction.delete(studentRef);
    appendAuditEventInTransaction(transaction, firestore.collection(`${root}/auditEvents`).doc(), {
      academyId: actor.academyId,
      actorId: actor.userId,
      action: "member.account.deleted",
      targetRef: studentRef.path,
      purpose: "member-record-maintenance",
      // Member actions correlate on a write digest, like every other directory mutation.
      correlationId: `write-${createHash("sha256").update(`${actor.academyId}:${studentId}:${requestId}`).digest("hex")}`,
    } as Parameters<typeof appendAuditEventInTransaction>[2]);
  });
  return deleteMemberAccountResultSchema.parse({ studentId, cancelledBookings, removedMemberships: memberships?.size ?? 0 });
}

export const deleteMemberAccount = onCall({ ...browserAdminCallableOptions, region: "europe-west9" }, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  return deleteMemberAccountHandler(actor, request.data, clientIpFromRequest(request));
});
