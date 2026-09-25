import { courseApi } from "../courses/course-client";
import type { CalendarWeekData } from "./calendar-repository";
import { isIntroBooking, type ProgramRecord } from "@bpt-jersey/domain/schedule";
/** Firebase-backed member calendar. Access grants are refreshed with every week load. */
import { studentGroupAccessSchema } from "@bpt-jersey/domain/schedule/member-calendar";
import type { PlanDraft } from "@bpt-jersey/domain/memberships";
import { listAvailableMembershipPlans } from "../membership-client";

import { getFamily } from "../family-client";
import { getClientProfile } from "../profile-client";
import { participantBand } from "../participant-band";
import {
  cancelBooking,
  getMemberCalendarWeek,
  getTrialAccess,
  listStudentAttendance,
  listStudentBookings,
  requestBooking,
  selfCheckIn,
  warmMemberCalendarWeek,
} from "../schedule-client";
import type { TrialAccessView } from "@bpt-jersey/domain/memberships/trial-access";
import { listClientMemberships } from "../waitlist-client";
import type {
  CalendarMember,
  CalendarParticipant,
  CalendarRepository,
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
    planParticipantTypes: plan.eligibleParticipantTypes,
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
  const membershipIds = new Map<string, string>();
  const canonicalStudents = new Set<string>();
  const courseSessions = new Set<string>();
  let memberLoad: Promise<unknown> | undefined;
  async function loadMember(): Promise<CalendarMember> {
    membershipIds.clear();
    canonicalStudents.clear();
    const subjectsPromise = !ordinaryRole
      ? Promise.resolve([])
      : session.role === "guardian"
        ? getFamily().then((family) => family?.students ?? [])
        : getClientProfile().then((profile) => profile ? [profile.student] : []);
    const loadCourseParticipants = async () => {
      const rows: Awaited<ReturnType<typeof courseApi.participants>>["items"][number][] = [];
      let cursor: string | undefined;
      do {
        const page = await courseApi.participants(cursor ? {cursor} : {});
        rows.push(...page.items);
        cursor = page.cursor ?? undefined;
      } while (cursor);
      return rows;
    };
    const courseParticipantsPromise = loadCourseParticipants();
    const [memberships, plans, subjects] = await Promise.all([
      ordinaryRole ? listClientMemberships() : Promise.resolve([]),
      ordinaryRole
        ? listAvailableMembershipPlans({ includeAdministrative: true })
        : Promise.resolve([]),
      subjectsPromise,
    ]);
    const current = memberships.filter((membership) =>
      membership.status === "active" || membership.status === "trial"
    );
    const introAttendance = new Map<string, boolean>();
    const trials = new Map<string, TrialAccessView>();
    // Only a member without a membership can still be offered an Intro Class — or be on a trial,
    // which already counts their free classes for them and makes the intro scan pointless.
    await Promise.all(subjects.filter((subject) =>
      !current.some((membership) => membership.studentId === subject.studentId)
    ).map(async (subject) => {
      const trial = await getTrialAccess(subject.studentId).catch(() => null);
      if (trial) {
        trials.set(subject.studentId, trial);
        return;
      }
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
        ...(trials.has(subject.studentId) ? { trial: trials.get(subject.studentId)! } : {}),
      });
      if (fromPlan) membershipIds.set(subject.studentId, fromPlan.membershipId!);
    }
    for (const participant of await courseParticipantsPromise) {
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
    return { role: session.role, displayName: session.displayName, participants };
  }
  return {
    loadMember() {
      if (ordinaryRole) {
        // Boot the week function now: its cold start (about 3 s) overlaps the member load instead
        // of following it.
        void warmMemberCalendarWeek().catch(() => undefined);
        // Same for the course calendar read beside it; the empty query is refused after sign-in checks.
        void courseApi.calendar({ studentId: "", from: "", to: "" }).catch(() => undefined);
      }
      const load = loadMember();
      memberLoad = load;
      return load;
    },
    async loadWeek(studentId, fromIso, toIso) {
      // A cached member can ask for its week first; the ids below come from the live member load.
      await memberLoad?.catch(() => undefined);
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
        // The server narrows the week to the plan and group access; nothing else is downloaded.
        const week = await getMemberCalendarWeek({
          studentId, membershipId: membershipIds.get(studentId) ?? null, from: fromIso, to: toIso,
        });
        return {
          sessions: week.sessions,
          programs: week.programs,
          bookings: week.bookings.filter((booking) => booking.schemaVersion !== "2"),
          attendance: week.attendance.filter((record) => !record.courseId),
          bookedCounts: week.bookedCounts,
          ...(week.groupAccess ? {groupAccess: studentGroupAccessSchema.parse(week.groupAccess)} : {}),
        };
      };
      const [ordinary] = await Promise.all([loadOrdinary(), loadCourses()]);
      const seminar: ProgramRecord = {programId: "seminar", academyId: courses.sessions[0]?.academyId ?? "", name: "Course / seminar", ageBand: "all", discipline: "self-defence", level: "all-levels", active: true, schemaVersion: "1"};
      return {...ordinary, sessions: [...ordinary.sessions, ...courses.sessions], bookings: [...ordinary.bookings, ...courses.bookings], attendance: [...ordinary.attendance, ...courses.attendance], programs: [...ordinary.programs.filter(p => p.programId !== "seminar"), seminar], courseSessionIds: courses.sessions.map(s => s.sessionId)};
    },
    async setCourseAbsence(sessionId, studentId, absent) {return courseApi.absence({sessionId, studentId, absent, requestId: crypto.randomUUID()});},
    book: requestBooking,
    cancel: cancelBooking,
    async clockIn(input) {return courseSessions.has(input.sessionId) ? (await courseApi.checkIn(input)).attendance : selfCheckIn(input);},
  };
}
