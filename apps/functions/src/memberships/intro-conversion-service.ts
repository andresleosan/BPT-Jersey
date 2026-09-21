import { createHash } from "node:crypto";

import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { introConversionStateSchema, memberNotificationSchema } from "@bpt-jersey/domain";
import {
  isIntroBooking,
  sessionAccessMode,
  type AttendanceRecord,
  type BookingRecord,
} from "@bpt-jersey/domain/schedule";
import { parseEffectiveStudentProfileAt } from "@bpt-jersey/domain/profiles";
import { parseFamilyRelationship, type FamilyRelationship } from "@bpt-jersey/domain/families";
import { memberAgeOn } from "@bpt-jersey/domain/members/access";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_RELATIONSHIPS = 101;

export type IntroProjectionResult = "created" | "ignored" | "existing" | "unresolved";

function validId(value: string): boolean {
  return identifierPattern.test(value);
}

function currentGuardian(value: FamilyRelationship, now: string): boolean {
  return (
    value.relationshipType === "guardian" &&
    value.active &&
    value.status === "active" &&
    Date.parse(value.validFrom) <= Date.parse(now) &&
    (value.validTo === undefined || Date.parse(now) < Date.parse(value.validTo))
  );
}

export async function projectIntroAttendance(
  db: Firestore,
  input: Readonly<{ academyId: string; attendanceId: string; now?: string }>,
): Promise<IntroProjectionResult> {
  if (!validId(input.academyId) || !validId(input.attendanceId)) return "ignored";
  const now = input.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) return "ignored";
  const base = `academies/${input.academyId}`;
  return db.runTransaction(async (transaction) => {
    const attendanceRef = db.doc(`${base}/attendance/${input.attendanceId}`);
    const attendanceSnap = await transaction.get(attendanceRef);
    const attendance = attendanceSnap.data() as Partial<AttendanceRecord> | undefined;
    if (
      !attendanceSnap.exists ||
      attendance?.attendanceId !== input.attendanceId ||
      attendance.academyId !== input.academyId ||
      attendance.correctionOf !== null ||
      !["attended", "late"].includes(String(attendance.state)) ||
      !validId(String(attendance.sessionId)) ||
      !validId(String(attendance.studentId))
    )
      return "ignored";

    const sessionId = String(attendance.sessionId);
    const studentId = String(attendance.studentId);
    const [sessionSnap, studentSnap, bookingsSnap] = await Promise.all([
      transaction.get(db.doc(`${base}/sessions/${sessionId}`)),
      transaction.get(db.doc(`${base}/students/${studentId}`)),
      transaction.get(
        db
          .collection(`${base}/bookings`)
          .where("studentId", "==", studentId)
          .where("sessionId", "==", sessionId)
          .limit(2),
      ),
    ]);
    const session = sessionSnap.data();
    if (
      !sessionSnap.exists ||
      session?.academyId !== input.academyId ||
      session?.sessionId !== sessionId ||
      sessionAccessMode(session) !== "intro"
    )
      return "ignored";
    const introBookings = bookingsSnap.docs.filter((doc) => {
      const booking = doc.data() as BookingRecord;
      return (
        booking.academyId === input.academyId &&
        booking.studentId === studentId &&
        booking.sessionId === sessionId &&
        booking.status === "confirmed" &&
        isIntroBooking(booking)
      );
    });
    if (bookingsSnap.size > 1 || introBookings.length !== 1) return "ignored";
    const studentParsed = parseEffectiveStudentProfileAt(
      studentSnap.data(),
      dateKeyInJersey(new Date(now)),
    );
    if (
      !studentSnap.exists ||
      !studentParsed.ok ||
      studentParsed.value.academyId !== input.academyId ||
      studentParsed.value.studentId !== studentId ||
      !studentParsed.value.active ||
      studentParsed.value.status !== "active"
    )
      return "ignored";

    const conversionId = `intro-${studentId}`;
    const conversionRef = db.doc(`${base}/introConversions/${conversionId}`);
    const existing = await transaction.get(conversionRef);
    if (existing.exists) return "existing";
    const issueRef = db.doc(`${base}/introConversionIssues/${conversionId}`);
    const unresolved = (
      reason: "guardian_ambiguous" | "recipient_missing" | "recipient_inactive",
    ) => {
      transaction.set(issueRef, {
        issueId: conversionId,
        academyId: input.academyId,
        studentId,
        attendanceId: input.attendanceId,
        sessionId,
        status: "unresolved",
        reason,
        updatedAt: now,
        schemaVersion: "1",
      });
      return "unresolved" as const;
    };

    const age = memberAgeOn(studentParsed.value.dateOfBirth, dateKeyInJersey(new Date(now)));
    let recipientUid: string | null =
      age !== null && age >= 18 && studentParsed.value.userId && validId(studentParsed.value.userId)
        ? studentParsed.value.userId
        : null;
    if (age !== null && age < 18) {
      const relationships = await transaction.get(
        db
          .collection(`${base}/relationships`)
          .where("studentId", "==", studentId)
          .orderBy(FieldPath.documentId())
          .limit(MAX_RELATIONSHIPS),
      );
      if (relationships.size >= MAX_RELATIONSHIPS) return unresolved("guardian_ambiguous");
      const guardians = relationships.docs.flatMap((doc) => {
        const parsed = parseFamilyRelationship(doc.data());
        return parsed.ok &&
          parsed.value.relationshipId === doc.id &&
          parsed.value.academyId === input.academyId &&
          parsed.value.studentId === studentId &&
          currentGuardian(parsed.value, now) &&
          parsed.value.familyId === studentParsed.value.familyId &&
          parsed.value.permissions.includes("readProfile")
          ? [parsed.value.adultUserId]
          : [];
      });
      recipientUid = guardians.length === 1 && validId(guardians[0] ?? "") ? guardians[0]! : null;
    }
    if (!recipientUid)
      return unresolved(age !== null && age < 18 ? "guardian_ambiguous" : "recipient_missing");
    const userSnap = await transaction.get(db.doc(`${base}/users/${recipientUid}`));
    const user = userSnap.data();
    if (
      !userSnap.exists ||
      user?.academyId !== input.academyId ||
      user?.userId !== recipientUid ||
      user?.active !== true ||
      user?.status !== "active"
    )
      return unresolved("recipient_inactive");

    const notificationId = `intro-${createHash("sha256").update(`${conversionId}:${recipientUid}`).digest("hex")}`;
    const notificationRef = db.doc(`${base}/memberNotifications/${notificationId}`);
    const conversion = introConversionStateSchema.parse({
      conversionId,
      academyId: input.academyId,
      studentId,
      attendanceId: input.attendanceId,
      sessionId,
      recipientUid,
      status: "ready",
      createdAt: now,
      updatedAt: now,
      schemaVersion: "1",
    });
    const notification = memberNotificationSchema.parse({
      notificationId,
      academyId: input.academyId,
      recipientUid,
      kind: "intro_membership_ready",
      title: "Choose your membership",
      body: "Your Intro Class is complete. Choose a plan and upload your payment receipt for review.",
      href: "/account/membership?from=intro",
      readAt: null,
      createdAt: now,
      schemaVersion: "1",
    });
    transaction.create(conversionRef, conversion);
    transaction.set(issueRef, {
      issueId: conversionId,
      academyId: input.academyId,
      studentId,
      attendanceId: input.attendanceId,
      sessionId,
      status: "resolved",
      reason: null,
      updatedAt: now,
      schemaVersion: "1",
    });
    transaction.create(notificationRef, notification);
    return "created";
  });
}
