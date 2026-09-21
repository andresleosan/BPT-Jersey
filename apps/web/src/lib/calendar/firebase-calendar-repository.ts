import { courseApi } from "../courses/course-client";
import type { CalendarWeekData } from "./calendar-repository";
import { isIntroBooking, sessionAccessMode, type ProgramRecord } from "@bpt-jersey/domain/schedule";
/** Firebase-backed member calendar. Access grants are refreshed with every week load. */
import { getStudentGroupAccess } from "../student-group-access-client";
import type { PlanDraft } from "@bpt-jersey/domain/memberships";
import { listAvailableMembershipPlans } from "../membership-client";

import { getFamily } from "../family-client";
import { getClientProfile } from "../profile-client";
import { participantBand } from "../participant-band";
import { listNoShowPenalties } from "../no-show-penalties-client";
import {
  bulkBookEligibleSessions,
  cancelBooking,
  getScheduleCatalog,
  listSessionBookedCounts,
  listSessions,
  listStudentAttendance,
  listStudentBookings,
  requestBooking,
  selfCheckIn,
} from "../schedule-client";
import { listClientMemberships } from "../waitlist-client";
import type {
  CalendarMember,
  CalendarParticipant,
  CalendarRepository,
  CalendarRole,
} from "./calendar-repository";

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/u)[0] ?? fullName;
}

function participantFromPlan(
  studentId: string,
  membershipId: string,
  plan: PlanDraft,
  name: string,
  dateOfBirth: string | undefined,
): CalendarParticipant | undefined {
  // A plan open to several bands (Town Kids & Teens) needs the member's own band.
  const band = dateOfBirth === undefined ? undefined : participantBand(dateOfBirth);
  const participantType =
    band !== undefined && plan.eligibleParticipantTypes.includes(band)
      ? band
      : plan.eligibleParticipantTypes[0];
  if (!participantType) return undefined;
  return {
    studentId,
    firstName: firstName(name),
    membershipId,
    planId: plan.planId,
    participantType,
    planClassSites: plan.classSites,
    planOpenMatSites: plan.openMatSites,
    weeklyClassLimit: plan.weeklyClassLimit,
  };
}

export function createFirebaseCalendarRepository(session: {
  role: CalendarMember["role"];
  displayName: string;
  scope?: "all" | "courses";
}): CalendarRepository {
  const ordinaryRole = session.scope !== "courses" && ["guardian", "adultStudent", "teenStudent"].includes(session.role);
  const membershipStudents = new Set<string>();
  const canonicalStudents = new Set<string>();
  const introSites = new Map<string, "Town" | "West">();
  const courseSessions = new Set<string>();
  return {
    async loadMember(): Promise<CalendarMember> {
      membershipStudents.clear();
      canonicalStudents.clear();
      introSites.clear();
      const subjectsPromise = !ordinaryRole
        ? Promise.resolve([])
        : session.role === "guardian"
          ? getFamily().then((family) => family?.students ?? [])
          : getClientProfile().then((profile) => profile ? [profile.student] : []);
      const [memberships, plans, subjects] = await Promise.all([
        ordinaryRole ? listClientMemberships() : Promise.resolve([]),
        ordinaryRole ? listAvailableMembershipPlans() : Promise.resolve([]),
        subjectsPromise,
      ]);
      const current = memberships.filter((membership) =>
        membership.status === "active" || membership.status === "trial"
      );
      const introAttendance = new Map<string, boolean>();
      await Promise.all(subjects.map(async (subject) => {
        const [bookings, attendance] = await Promise.all([
          listStudentBookings(subject.studentId),
          listStudentAttendance(subject.studentId),
        ]);
        const attendedSessions = new Set(attendance
          .filter((record) => record.state === "attended" || record.state === "late")
          .map((record) => record.sessionId));
        introAttendance.set(subject.studentId, bookings.some((booking) =>
          isIntroBooking(booking) && attendedSessions.has(booking.sessionId)
        ));
      }));
      const participants: CalendarParticipant[] = [];
      for (const subject of subjects) {
        canonicalStudents.add(subject.studentId);
        introSites.set(subject.studentId, subject.trainingCenter);
        const membership = current.find((candidate) => candidate.studentId === subject.studentId);
        const plan = membership
          ? plans.find((candidate) => candidate.planId === membership.planId)
          : undefined;
        const fromPlan = membership && plan
          ? participantFromPlan(
              subject.studentId, membership.membershipId, plan, subject.fullName, subject.dateOfBirth,
            )
          : undefined;
        const participantType = subject.dateOfBirth
          ? participantBand(subject.dateOfBirth) ?? "adult"
          : "adult";
        participants.push(fromPlan ? {
          ...fromPlan,
          membershipStartsAt: membership!.startsAt,
          membershipEndsAt: membership!.endsAt,
          introSite: subject.trainingCenter,
          hasAttendedIntro: introAttendance.get(subject.studentId) ?? false,
          hasActiveMembership: true,
        } : {
          studentId: subject.studentId,
          firstName: firstName(subject.fullName),
          membershipId: null,
          planId: null,
          participantType,
          planClassSites: [],
          planOpenMatSites: [],
          weeklyClassLimit: null,
          introSite: subject.trainingCenter,
          hasAttendedIntro: introAttendance.get(subject.studentId) ?? false,
          hasActiveMembership: false,
        });
        if (membership) membershipStudents.add(subject.studentId);
      }
      let cursor: string | undefined;
      do {
        const page = await courseApi.participants(cursor ? {cursor} : {});
        for (const participant of page.items) {
          if (!participant.studentId || participants.some((row) => row.studentId === participant.studentId)) continue;
          participants.push({
            studentId: participant.studentId,
            firstName: firstName(participant.fullName),
            membershipId: null,
            planId: null,
            participantType: participantBand(participant.dateOfBirth) ?? "adult",
            planClassSites: [],
            planOpenMatSites: [],
            weeklyClassLimit: null,
            hasActiveMembership: false,
          });
        }
        cursor = page.cursor ?? undefined;
      } while (cursor);
      return { role: session.role, displayName: session.displayName, participants };
    },
    async loadWeek(studentId, fromIso, toIso) {
      courseSessions.clear();
      const courses: {sessions: CalendarWeekData["sessions"]; programs: CalendarWeekData["programs"]; bookings: CalendarWeekData["bookings"]; attendance: CalendarWeekData["attendance"]; bookedCounts: CalendarWeekData["bookedCounts"]; courseSessionIds: readonly string[]} = {sessions: [], programs: [], bookings: [], attendance: [], bookedCounts: {}, courseSessionIds: []};
      const loadCourses = async () => {
        let cursor: string | undefined;
        do {
          const page = await courseApi.calendar({studentId, from: fromIso, to: toIso, ...(cursor ? {cursor} : {})});
          courses.sessions = [...courses.sessions, ...page.sessions];
          courses.bookings = [...courses.bookings, ...page.bookings];
          courses.attendance = [...courses.attendance, ...page.attendance];
          page.sessions.forEach(s => courseSessions.add(s.sessionId));
          cursor = page.cursor ?? undefined;
        } while (cursor);
      };
      const loadOrdinary = async (): Promise<CalendarWeekData> => {
        if (!canonicalStudents.has(studentId)) {
          return {sessions: [], programs: [], bookings: [], attendance: [], bookedCounts: {}};
        }
        const hasMembership = membershipStudents.has(studentId);
        const [sessions, catalog, bookings, attendance, bookedCounts, groupAccess] = await Promise.all([
          listSessions({from: fromIso, to: toIso}),
          getScheduleCatalog(),
          listStudentBookings(studentId),
          listStudentAttendance(studentId),
          listSessionBookedCounts({from: fromIso, to: toIso}).catch(() => ({})),
          hasMembership ? getStudentGroupAccess(studentId) : Promise.resolve(undefined),
        ]);
        const introLocationId = introSites.get(studentId)?.toLowerCase();
        const visibleSessions = sessions.filter((record) =>
          !record.courseId && (hasMembership || (
            sessionAccessMode(record) === "intro" && record.locationId === introLocationId
          ))
        );
        return {
          sessions: visibleSessions,
          programs: catalog.programs,
          bookings: bookings.filter((booking) => booking.schemaVersion !== "2"),
          attendance: attendance.filter((record) => !record.courseId),
          bookedCounts,
          ...(groupAccess ? {groupAccess} : {}),
        };
      };
      const [ordinary] = await Promise.all([loadOrdinary(), loadCourses()]);
      const seminar: ProgramRecord = {programId: "seminar", academyId: courses.sessions[0]?.academyId ?? "", name: "Course / seminar", ageBand: "all", discipline: "self-defence", level: "all-levels", active: true, schemaVersion: "1"};
      return {...ordinary, sessions: [...ordinary.sessions, ...courses.sessions], bookings: [...ordinary.bookings, ...courses.bookings], attendance: [...ordinary.attendance, ...courses.attendance], programs: [...ordinary.programs.filter(p => p.programId !== "seminar"), seminar], courseSessionIds: courses.sessions.map(s => s.sessionId)};
    },
    async setCourseAbsence(sessionId, studentId, absent) {return courseApi.absence({sessionId, studentId, absent, requestId: crypto.randomUUID()});},
    book: requestBooking,
    bookEligible: bulkBookEligibleSessions,
    cancel: cancelBooking,
    async clockIn(input) {return courseSessions.has(input.sessionId) ? (await courseApi.checkIn(input)).attendance : selfCheckIn(input);},
    async loadPenalties(studentId) {
      if (session.scope === "courses") return [];
      // Penalties are an office-only ancillary display. A member denial must not prevent the
      // calendar's booking and attendance data from remaining usable.
      const penalties = await listNoShowPenalties().catch(() => []);
      return penalties.filter((p) => p.studentId === studentId);
    },
  };
}
