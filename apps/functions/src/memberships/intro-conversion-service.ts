import { createHash } from "node:crypto";

import { FieldPath, type Firestore } from "firebase-admin/firestore";
import {
  introConversionStateSchema,
  memberNotificationSchema,
} from "@bpt-jersey/domain/memberships/intro-conversion";
import {
  isIntroBooking,
  type AttendanceRecord,
  type BookingRecord,
} from "@bpt-jersey/domain/schedule";
import { parseEffectiveStudentProfileAt } from "@bpt-jersey/domain/profiles";
import { parseFamilyRelationship, type FamilyRelationship } from "@bpt-jersey/domain/families";
import { memberAgeOn } from "@bpt-jersey/domain/members/access";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import {
  trialAccessSchema,
  type TrialAccessRecord,
  type TrialAccessStatus,
} from "@bpt-jersey/domain/memberships/trial-access";
import { parseMembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";

import { readTrialAccess } from "./trial-access-service.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_RELATIONSHIPS = 101;
/** `trialAccessSchema` caps the list; an allowance of 1 or 2 can never reach it legitimately. */
const MAX_COUNTED_ATTENDANCE = 10;
const PAYG_MINIMUM_AGE = 12;
const ADULT_AGE = 18;

export type IntroProjectionResult = "created" | "ignored" | "existing" | "unresolved";

function validId(value: string): boolean {
  return identifierPattern.test(value);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Idempotent per attendance id: a retried trigger never counts the same class twice. */
function countAttendance(trial: TrialAccessRecord, attendanceId: string): readonly string[] {
  return trial.countedAttendanceIds.includes(attendanceId) ||
    trial.countedAttendanceIds.length >= MAX_COUNTED_ATTENDANCE
    ? trial.countedAttendanceIds
    : [...trial.countedAttendanceIds, attendanceId];
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
      // A correction that marks the member present counts too (absent recorded by mistake); the
      // deterministic conversion id below keeps any repeat idempotent.
      (attendance.correctionOf !== null && !validId(String(attendance.correctionOf))) ||
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
    // The confirmed intro booking below is the only gate: age-band classes carry no intro
    // access mode, and a trial class booked against one still counts.
    if (
      !sessionSnap.exists ||
      session?.academyId !== input.academyId ||
      session?.sessionId !== sessionId
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
    const issueRef = db.doc(`${base}/introConversionIssues/${conversionId}`);

    const trialRef = db.doc(`${base}/trialAccess/${studentId}`);
    const trial = await readTrialAccess(
      { get: (path) => transaction.get(db.doc(path)) },
      input.academyId,
      studentId,
    );
    const countedAttendanceIds =
      trial === undefined ? [] : countAttendance(trial, input.attendanceId);
    const countsThisClass =
      trial !== undefined && countedAttendanceIds.length > trial.countedAttendanceIds.length;
    const allowanceUsed = trial !== undefined && countedAttendanceIds.length >= trial.allowance;

    const age = memberAgeOn(studentParsed.value.dateOfBirth, dateKeyInJersey(new Date(now)));
    let unresolvedReason: "guardian_ambiguous" | "recipient_missing" | "recipient_inactive" | null =
      null;
    let recipientUid: string | null =
      age !== null &&
      age >= ADULT_AGE &&
      studentParsed.value.userId &&
      validId(studentParsed.value.userId)
        ? studentParsed.value.userId
        : null;
    let conversionUnreadable = false;
    if (existing.exists) {
      // The conversion already resolved the recipient once; reuse it instead of resolving again.
      const state = introConversionStateSchema.safeParse(existing.data());
      recipientUid = state.success ? state.data.recipientUid : null;
      conversionUnreadable = !state.success;
    } else if (age !== null && age < ADULT_AGE) {
      const relationships = await transaction.get(
        db
          .collection(`${base}/relationships`)
          .where("studentId", "==", studentId)
          .orderBy(FieldPath.documentId())
          .limit(MAX_RELATIONSHIPS),
      );
      const guardians =
        relationships.size >= MAX_RELATIONSHIPS
          ? []
          : relationships.docs.flatMap((doc) => {
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
    if (!existing.exists) {
      if (!recipientUid) {
        unresolvedReason =
          age !== null && age < ADULT_AGE ? "guardian_ambiguous" : "recipient_missing";
      } else {
        const userSnap = await transaction.get(db.doc(`${base}/users/${recipientUid}`));
        const user = userSnap.data();
        if (
          !userSnap.exists ||
          user?.academyId !== input.academyId ||
          user?.userId !== recipientUid ||
          user?.active !== true ||
          user?.status !== "active"
        ) {
          unresolvedReason = "recipient_inactive";
          recipientUid = null;
        }
      }
    }

    // A West trial turns into Pay as you go the moment its allowance is used. The membership is
    // about the trial, not about who gets told, so it is created even when no recipient resolves;
    // only the notice needs one. Both writes are guarded by a read, so a retried attendance cannot
    // fail the transaction on a document that already exists.
    const paygDue =
      trial !== undefined &&
      allowanceUsed &&
      trial.site === "West" &&
      age !== null &&
      age >= PAYG_MINIMUM_AGE;
    const membershipRef = db.doc(`${base}/memberships/payg-trial-${studentId}`);
    const paygNoticeRef =
      paygDue && recipientUid !== null
        ? db.doc(`${base}/memberNotifications/payg-${digest(`${conversionId}:${recipientUid}`)}`)
        : null;
    const paygMembershipExists = paygDue ? (await transaction.get(membershipRef)).exists : false;
    const paygNoticeExists =
      paygNoticeRef === null ? false : (await transaction.get(paygNoticeRef)).exists;

    // ---- reads are done; writes start here ----
    let trialStatus: TrialAccessStatus | undefined =
      trial !== undefined && allowanceUsed && trial.status !== "converted"
        ? "exhausted"
        : trial?.status;
    // A conversion that was owed but could not be completed leaves a trail for staff instead of
    // failing silently. Recipient problems below take precedence; a missing billing account wins
    // over an unreadable conversion document because it is what stops the membership.
    let conversionIssue: "billing_account_missing" | "conversion_unreadable" | null =
      conversionUnreadable ? "conversion_unreadable" : null;
    let convertedNow = false;
    if (paygDue) {
      const membership = paygMembershipExists
        ? undefined
        : parseMembershipRecord({
            membershipId: `payg-trial-${studentId}`,
            academyId: input.academyId,
            familyId: studentParsed.value.familyId,
            studentId,
            planId: age !== null && age >= ADULT_AGE ? "payg" : "west-teens-payg",
            status: "active",
            startsAt: now,
            endsAt: null,
            nextBillingAt: null,
            createdAt: now,
            createdBy: "system",
            updatedAt: now,
            updatedBy: "system",
            schemaVersion: "1",
          });
      if (membership?.ok === true) transaction.create(membershipRef, membership.value);
      if (membership !== undefined && !membership.ok) conversionIssue = "billing_account_missing";
      if (paygMembershipExists || membership?.ok === true) {
        trialStatus = "converted";
        convertedNow = true;
        if (paygNoticeRef !== null && recipientUid !== null && !paygNoticeExists) {
          transaction.create(
            paygNoticeRef,
            memberNotificationSchema.parse({
              notificationId: paygNoticeRef.id,
              academyId: input.academyId,
              recipientUid,
              kind: "intro_membership_ready",
              title: "You're now on Pay as you go",
              body: "Book classes at West and pay online or at the academy.",
              href: "/account/membership",
              readAt: null,
              createdAt: now,
              schemaVersion: "1",
            }),
          );
        }
      }
    }
    if (trial !== undefined && (countsThisClass || trialStatus !== trial.status)) {
      transaction.set(
        trialRef,
        trialAccessSchema.parse({
          ...trial,
          countedAttendanceIds,
          status: trialStatus,
          updatedAt: now,
        }),
      );
    }
    const issueReason = unresolvedReason ?? conversionIssue;
    if (issueReason !== null) {
      transaction.set(issueRef, {
        issueId: conversionId,
        academyId: input.academyId,
        studentId,
        attendanceId: input.attendanceId,
        sessionId,
        status: "unresolved",
        reason: issueReason,
        updatedAt: now,
        schemaVersion: "1",
      });
    }
    if (unresolvedReason !== null) return "unresolved";
    if (existing.exists) return "existing";

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
    transaction.create(conversionRef, conversion);
    if (issueReason === null) {
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
    }
    // A class that both uses the allowance and creates the Pay as you go membership must not also
    // nudge for a membership: the notice it just sent links to the same page.
    if (!convertedNow) {
      const notificationId = `intro-${digest(`${conversionId}:${recipientUid}`)}`;
      transaction.create(
        db.doc(`${base}/memberNotifications/${notificationId}`),
        memberNotificationSchema.parse({
          notificationId,
          academyId: input.academyId,
          recipientUid,
          kind: "intro_membership_ready",
          title: "Did you enjoy training with us?",
          body: "Tap here to get a membership and keep training with us.",
          href: "/account/membership?from=intro",
          readAt: null,
          createdAt: now,
          schemaVersion: "1",
        }),
      );
    }
    return "created";
  });
}
