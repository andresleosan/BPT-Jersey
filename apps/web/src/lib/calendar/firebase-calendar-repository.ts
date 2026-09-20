import { courseApi } from "../courses/course-client";
import type { CalendarWeekData } from "./calendar-repository";
import type { ProgramRecord } from "@bpt-jersey/domain/schedule";
/** Firebase-backed member calendar. Access grants are refreshed with every week load. */
import { getStudentGroupAccess } from "../student-group-access-client";
import type { PlanDraft } from "@bpt-jersey/domain/memberships";
import { listAvailableMembershipPlans } from "../membership-client";

import { getFamily } from "../family-client";
import { participantBand } from "../participant-band";
import { listNoShowPenalties } from "../no-show-penalties-client";
import {
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
  const courseSessions = new Set<string>();
  return {
    async loadMember(): Promise<CalendarMember> {
      membershipStudents.clear();
      const [memberships, plans] = await Promise.all([
        ordinaryRole ? listClientMemberships() : Promise.resolve([]), ordinaryRole ? listAvailableMembershipPlans() : Promise.resolve([]),
      ]);
      const current = memberships.filter((m) => m.status === "active" || m.status === "trial");
      const names = new Map<string, string>();
      const births = new Map<string, string>();
      if (ordinaryRole && session.role === "guardian") {
        const family = await getFamily();
        for (const student of family?.students ?? []) {
          names.set(student.studentId, student.fullName);
          if (student.dateOfBirth !== undefined) births.set(student.studentId, student.dateOfBirth);
        }
      }
      const participants: CalendarParticipant[] = [];
      for (const membership of current) {
        if (participants.some((p) => p.studentId === membership.studentId)) continue;
        const plan = plans.find((candidate) => candidate.planId === membership.planId);
        if (!plan) continue;
        const participant = participantFromPlan(
          membership.studentId,
          membership.membershipId,
          plan,
          names.get(membership.studentId) ?? session.displayName,
          births.get(membership.studentId),
        );
        if (participant) {participants.push({ ...participant, membershipStartsAt: membership.startsAt, membershipEndsAt: membership.endsAt }); membershipStudents.add(participant.studentId);}
      }
      let cursor: string | undefined;
      do {
        const page = await courseApi.participants(cursor ? {cursor} : {});
        for (const participant of page.items) {
          if (!participant.studentId || participants.some(p => p.studentId === participant.studentId)) continue;
          participants.push({studentId: participant.studentId, firstName: firstName(participant.fullName), membershipId: null, planId: null, participantType: participantBand(participant.dateOfBirth) ?? "adult", planClassSites: [], planOpenMatSites: [], weeklyClassLimit: null});
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
        if (!membershipStudents.has(studentId)) return {sessions: [], programs: [], bookings: [], attendance: [], bookedCounts: {}};
        const [sessions, catalog, bookings, attendance, bookedCounts, groupAccess] = await Promise.all([
          listSessions({from: fromIso, to: toIso}), getScheduleCatalog(), listStudentBookings(studentId), listStudentAttendance(studentId), listSessionBookedCounts({from: fromIso, to: toIso}).catch(() => ({})), getStudentGroupAccess(studentId),
        ]);
        return {sessions: sessions.filter(s => !s.courseId), programs: catalog.programs, bookings: bookings.filter(b => b.schemaVersion !== "2"), attendance: attendance.filter(a => !a.courseId), bookedCounts, groupAccess};
      };
      const [ordinary] = await Promise.all([loadOrdinary(), loadCourses()]);
      const seminar: ProgramRecord = {programId: "seminar", academyId: courses.sessions[0]?.academyId ?? "", name: "Course / seminar", ageBand: "all", discipline: "self-defence", level: "all-levels", active: true, schemaVersion: "1"};
      return {...ordinary, sessions: [...ordinary.sessions, ...courses.sessions], bookings: [...ordinary.bookings, ...courses.bookings], attendance: [...ordinary.attendance, ...courses.attendance], programs: [...ordinary.programs.filter(p => p.programId !== "seminar"), seminar], courseSessionIds: courses.sessions.map(s => s.sessionId)};
    },
    async setCourseAbsence(sessionId, studentId, absent) {return courseApi.absence({sessionId, studentId, absent, requestId: crypto.randomUUID()});},
    book: requestBooking,
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
