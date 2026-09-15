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

function browserFixtureStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * NEXT_PUBLIC_CALENDAR_SOURCE=firebase switches /account to the real backend. Anything else
 * (including unset) keeps the fixtures, so a build without the flag can never hit Firebase.
 */
export function createCalendarRepository(session: {
  role: CalendarRole;
  displayName: string;
}): CalendarRepository {
  if (process.env.NEXT_PUBLIC_CALENDAR_SOURCE === "firebase") {
    return createFirebaseCalendarRepository(session);
  }
  const storage = browserFixtureStorage();
  return storage
    ? createFixtureCalendarRepository(session.role, { selfCheckInStorage: storage })
    : createFixtureCalendarRepository(session.role);
}
