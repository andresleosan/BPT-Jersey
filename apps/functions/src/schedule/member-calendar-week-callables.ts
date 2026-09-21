import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { parsePlanRecord } from "@bpt-jersey/domain/memberships";
import { parseMembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import {
  isIntroBooking,
  parseListSessionsQuery,
  sessionAccessMode,
} from "@bpt-jersey/domain/schedule";
import {
  canViewMemberSession,
  studentGroupAccessQuerySchema,
  type CalendarMemberContext,
} from "@bpt-jersey/domain/schedule/member-calendar";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireUserActor } from "../auth/user-authorization.js";
import { createMemberDirectoryReadTransaction } from "../members/member-directory-firestore.js";
import { resolveCanonicalStudentIdInTransaction } from "../members/member-identity-resolution.js";
import { scheduleCallableOptions } from "./schedule-callable-options.js";
import {
  attendanceForActor,
  createCancelBookingHandler,
  createRequestBookingHandler,
  getStudentScopeOptions,
  requireStudentScope,
} from "./schedule-callables.js";
import { memberView, readAccess, readStudent } from "./student-group-access-callables.js";

/**
 * Firestore lives in europe-west9 and the members are in Jersey. The original callables run in
 * us-central1, so every one of their reads crosses the Atlantic twice; a booking makes about
 * twenty of them in sequence. The member calendar's hot path runs next to the data instead.
 * The us-central1 originals stay deployed for the office screens and for cached member bundles.
 */
const memberRegion = "europe-west9";

/**
 * One call for the member's week, already narrowed to what the plan and group access allow.
 * A read for an authenticated, scoped member: App Check is enforced but the token is not
 * consumed, so the browser reuses its cached token instead of minting one per call.
 */
export const getMemberCalendarWeek = onCall(
  { ...browserAdminCallableOptions, region: memberRegion },
  async (request) => {
    const actor = requireUserActor(request);
    const data = (request.data ?? {}) as Record<string, unknown>;
    const ids = studentGroupAccessQuerySchema.safeParse({ studentId: data.studentId });
    const membershipIdInput =
      data.membershipId === null || data.membershipId === undefined
        ? null
        : studentGroupAccessQuerySchema.safeParse({ studentId: data.membershipId });
    const range = parseListSessionsQuery({ from: data.from, to: data.to });
    if (!ids.success || membershipIdInput?.success === false || !range.ok) {
      throw new HttpsError("invalid-argument", "Select a member and a week.");
    }
    const options = getStudentScopeOptions();
    await requireStudentScope(request, ids.data.studentId, options);

    const db = getFirestore();
    const base = `academies/${actor.academyId}`;
    const membershipId = membershipIdInput?.data.studentId ?? null;
    const { store } = options;
    const [sessions, programs, bookings, attendance, records] = await Promise.all([
      store.listSessions(actor.academyId, range.value),
      store.listPrograms(actor.academyId),
      store.listStudentBookings(actor.academyId, ids.data.studentId),
      store.listStudentAttendance(actor.academyId, ids.data.studentId),
      db.runTransaction(
        async (tx) => {
          const studentId = await resolveCanonicalStudentIdInTransaction(
            createMemberDirectoryReadTransaction(db, tx),
            actor.academyId,
            ids.data.studentId,
          );
          const [student, access, membership] = await tx.getAll(
            db.doc(`${base}/students/${studentId}`),
            db.doc(`${base}/studentGroupAccess/${studentId}`),
            // A placeholder keeps getAll's shape; "-" is never a membership id.
            db.doc(`${base}/memberships/${membershipId ?? "-"}`),
          );
          return { studentId, student: student!, access: access!, membership: membership! };
        },
        { readOnly: true },
      ),
    ]);

    const profile = readStudent(records.student.data(), actor.academyId, records.studentId);
    const groupAccess = memberView(
      readAccess(records.access.data(), actor.academyId, profile.studentId, profile.dateOfBirth),
    );
    const parsedMembership = records.membership.exists
      ? parseMembershipRecord(records.membership.data())
      : undefined;
    const membership =
      parsedMembership?.ok &&
      parsedMembership.value.academyId === actor.academyId &&
      [records.studentId, ids.data.studentId].includes(parsedMembership.value.studentId) &&
      (parsedMembership.value.status === "active" || parsedMembership.value.status === "trial")
        ? parsedMembership.value
        : undefined;
    const planSnapshot = membership
      ? await db.doc(`${base}/plans/${membership.planId}`).get()
      : undefined;
    const parsedPlan = planSnapshot?.exists ? parsePlanRecord(planSnapshot.data()) : undefined;
    const plan = parsedPlan?.ok ? parsedPlan.value : undefined;

    const attended = new Set(
      attendance
        .filter((record) => record.state === "attended" || record.state === "late")
        .map((record) => record.sessionId),
    );
    const member: CalendarMemberContext = {
      studentId: ids.data.studentId,
      membershipId: membership && plan ? membership.membershipId : null,
      participantType: "adult", // unused: dateOfBirth below decides the band per session date
      planParticipantTypes: plan?.eligibleParticipantTypes ?? [],
      planClassSites: plan?.classSites ?? [],
      planOpenMatSites: plan?.openMatSites ?? [],
      weeklyClassLimit: plan?.weeklyClassLimit ?? null,
      additionalProgramIds: groupAccess.programIds,
      dateOfBirth: groupAccess.dateOfBirth,
      introSite: profile.trainingCenter,
      hasActiveMembership: membership !== undefined && plan !== undefined,
      hasAttendedIntro: bookings.some(
        (booking) => isIntroBooking(booking) && attended.has(booking.sessionId),
      ),
    };
    const programById = new Map(programs.map((program) => [program.programId, program]));
    const held = new Set(
      bookings.filter((booking) => booking.status !== "cancelled").map((b) => b.sessionId),
    );
    // Course sessions reach the calendar through the course API. A session the member already
    // holds stays visible even if the plan changed since, so it can still be cancelled.
    const visible = sessions.filter((session) => {
      if (session.courseId) return false;
      if (held.has(session.sessionId)) return true;
      const program = programById.get(session.programId);
      if (!program) return false;
      if (!member.hasActiveMembership && sessionAccessMode(session) !== "intro") return false;
      return canViewMemberSession(session, program, member);
    });
    const bookedCounts = await store
      .countConfirmedBookings(
        actor.academyId,
        visible.map((session) => session.sessionId),
      )
      .catch(() => ({}));

    return {
      sessions: visible,
      programs,
      bookings,
      attendance: attendanceForActor(actor, attendance),
      bookedCounts,
      ...(member.hasActiveMembership ? { groupAccess } : {}),
    };
  },
);

const memberBookingOptions = { ...scheduleCallableOptions, region: memberRegion };

export const requestBookingEu = onCall(memberBookingOptions, async (request) =>
  createRequestBookingHandler(getStudentScopeOptions())(request),
);

export const cancelBookingEu = onCall(memberBookingOptions, async (request) =>
  createCancelBookingHandler(getStudentScopeOptions())(request),
);
