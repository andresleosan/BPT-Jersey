/**
 * NOT RUN IN A BROWSER AGAINST FIREBASE — written against the client signatures in
 * ../schedule-client, ../waitlist-client, ../no-show-penalties-client and ../family-client.
 * What is verified (2026-09-15): the unit tests of this file, and the `selfCheckIn` callable
 * end-to-end in the Functions Emulator (qa/tests/schedule-auth-emulator.spec.ts, 3/3). What is
 * not: this adapter running in a browser session, because App Check is fail-closed outside
 * production. Before calling it verified: (1) run /account with NEXT_PUBLIC_CALENDAR_SOURCE=firebase
 * against a real session, (2) provide `bookedCounts` (today every session reads as not full),
 * (3) confirm how a teenStudent's studentId reaches loadMember.
 */
import { PLAN_CATALOG } from "@bpt-jersey/domain/memberships";

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
  planId: string,
  name: string,
  dateOfBirth: string | undefined,
): CalendarParticipant | undefined {
  const plan = PLAN_CATALOG.find((candidate) => candidate.planId === planId);
  if (!plan) return undefined;
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
  role: CalendarRole;
  displayName: string;
}): CalendarRepository {
  return {
    async loadMember(): Promise<CalendarMember> {
      const memberships = await listClientMemberships();
      const current = memberships.filter((m) => m.status === "active" || m.status === "trial");
      const names = new Map<string, string>();
      const births = new Map<string, string>();
      if (session.role === "guardian") {
        const family = await getFamily();
        for (const student of family?.students ?? []) {
          names.set(student.studentId, student.fullName);
          births.set(student.studentId, student.dateOfBirth);
        }
      }
      const participants: CalendarParticipant[] = [];
      for (const membership of current) {
        if (participants.some((p) => p.studentId === membership.studentId)) continue;
        const participant = participantFromPlan(
          membership.studentId,
          membership.membershipId,
          membership.planId,
          names.get(membership.studentId) ?? session.displayName,
          births.get(membership.studentId),
        );
        if (participant) participants.push(participant);
      }
      return { role: session.role, displayName: session.displayName, participants };
    },
    async loadWeek(studentId, fromIso, toIso) {
      const [sessions, catalog, bookings, attendance, bookedCounts] = await Promise.all([
        listSessions({ from: fromIso, to: toIso }),
        getScheduleCatalog(),
        listStudentBookings(studentId),
        listStudentAttendance(studentId),
        // Fail open: booked counts are a display nicety only; the server still enforces capacity
        // when booking, so losing this read must not blank the whole calendar.
        listSessionBookedCounts({ from: fromIso, to: toIso }).catch(() => ({})),
      ]);
      return { sessions, programs: catalog.programs, bookings, attendance, bookedCounts };
    },
    book: requestBooking,
    cancel: cancelBooking,
    clockIn: selfCheckIn,
    async loadPenalties(studentId) {
      // Penalties are an office-only ancillary display. A member denial must not prevent the
      // calendar's booking and attendance data from remaining usable.
      const penalties = await listNoShowPenalties().catch(() => []);
      return penalties.filter((p) => p.studentId === studentId);
    },
  };
}
