import type { CalendarRepository, CalendarRole } from "./calendar-repository";
import { createFirebaseCalendarRepository } from "./firebase-calendar-repository";
import { createFixtureCalendarRepository } from "./fixture-calendar-repository";

export type {
  CalendarMember,
  CalendarParticipant,
  CalendarRepository,
  CalendarRole,
  CalendarWeekData,
} from "./calendar-repository";

/**
 * NEXT_PUBLIC_CALENDAR_SOURCE=firebase switches /account to the real backend. Anything else
 * (including unset) keeps the fixtures, so a build without the flag can never hit Firebase.
 */
export function createCalendarRepository(session: {
  role: CalendarRole;
  displayName: string;
}): CalendarRepository {
  return process.env.NEXT_PUBLIC_CALENDAR_SOURCE === "firebase"
    ? createFirebaseCalendarRepository(session)
    : createFixtureCalendarRepository(session.role);
}
