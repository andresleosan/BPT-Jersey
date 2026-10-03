import { removeMemberFromGroups } from "../schedule/group-service.js";
import {
  deleteMemberAccountInputSchema,
  deleteMemberAccountResultSchema,
} from "@bpt-jersey/domain/members/overview";
import { createHash } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
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
];
const BY_ID = [
  "studentAdminProfiles", "studentLevelProgress", "memberIdentityAliases", "studentGroupAccess", "notificationPreferences",
  "trialAccess", "memberGuardianStates", "memberAttendanceBaselines", "memberReconciliationCases", "memberPublicSettings",
];
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
  if (actor.role !== "owner") throw new HttpsError("permission-denied", "Only the owner can delete a member account.");
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

  // The member's own office family goes with its billing, unless another record still bills through it.
  if (familyId) {
    const sharers = await firestore.collection(`${root}/students`).where("familyId", "==", familyId).limit(2).get();
    if (sharers.docs.every((document) => document.id === studentId)) {
      refs.push(firestore.doc(`${root}/families/${familyId}`));
      for (const name of ["invoices", "payments"])
        for (const document of (await firestore.collection(`${root}/${name}`).where("familyId", "==", familyId).get()).docs)
          refs.push(document.ref);
    }
  }

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
    if (deleteLogin) refs.push(firestore.doc(`${root}/users/${loginId}`));
  }

  const unique = [...new Map(refs.map((reference) => [reference.path, reference])).values()];
  const documents = (await firestore.getAll(...unique)).filter((document) => document.exists);
  const backupId = `${studentId}-${Date.now()}`;
  const expiresAt = Timestamp.fromMillis(Date.now() + BACKUP_DAYS * 86_400_000);
  const backups = firestore.bulkWriter();
  documents.forEach((document, index) =>
    backups.create(firestore.doc(`${root}/deletedMemberBackups/${backupId}-${index}`), {
      backupId, studentId, path: document.ref.path, data: document.data(), deletedBy: actor.userId,
      deletedAt: FieldValue.serverTimestamp(), expiresAt,
    }),
  );
  await backups.close();
  const deletes = firestore.bulkWriter();
  for (const document of documents) deletes.delete(document.ref);
  await deletes.close();
  if (deleteLogin && loginId) await getAuth().deleteUser(loginId).catch((error: { code?: string }) => {
    if (error.code !== "auth/user-not-found") throw error;
  });

  await firestore.runTransaction(async (transaction) => {
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
