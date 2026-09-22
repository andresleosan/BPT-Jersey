import type { StudentGroupAccess } from "@bpt-jersey/domain/schedule/member-calendar";
import type {
  AttendanceRecord,
  BookingRecord,
  CancelBookingInput,
  ProgramRecord,
  RequestBookingInput,
  SessionRecord,
} from "@bpt-jersey/domain/schedule";
import type {
  ParticipantType,
  PlanId,
  Site,
  WeeklyClassLimit,
} from "@bpt-jersey/domain/memberships";
import type { NoShowPenaltyRecord } from "@bpt-jersey/domain/penalties";
import type { TrialAccessView } from "@bpt-jersey/domain/memberships/trial-access";
import type { SelfCheckInInput } from "@bpt-jersey/domain/schedule/self-check-in";

/**
 * The only seam between the member calendar UI and the backend. `fixture-calendar-repository`
 * runs today (workbench + tests); `firebase-calendar-repository` is written against the existing
 * callables and is what the connecting model has to verify. Pick one in `./index.ts`.
 */
export type CalendarRole = "guardian" | "adultStudent" | "teenStudent";

export type CalendarParticipant = Readonly<{
  studentId: string;
  firstName: string;
  membershipId: string | null;
  planId: PlanId | null;
  membershipStartsAt?: string;
  membershipEndsAt?: string | null;
  participantType: ParticipantType;
  planParticipantTypes?: readonly ParticipantType[];
  planClassSites: readonly Site[];
  planOpenMatSites: readonly Site[];
  weeklyClassLimit: WeeklyClassLimit;
  introSite?: Site;
  hasAttendedIntro?: boolean;
  hasActiveMembership?: boolean;
  /** The free trial a student without a membership is training on, when they have one. */
  trial?: TrialAccessView;
}>;

export type CalendarMember = Readonly<{
  role: CalendarRole | "owner" | "administrator" | "coach" | "headCoach" | "shopper";
  displayName: string;
  participants: readonly CalendarParticipant[];
}>;

export type CalendarWeekData = Readonly<{
  courseSessionIds?: readonly string[];
  groupAccess?: StudentGroupAccess;
  sessions: readonly SessionRecord[];
  programs: readonly ProgramRecord[];
  bookings: readonly BookingRecord[];
  attendance: readonly AttendanceRecord[];
  /** sessionId → confirmed bookings. `{}` when the backend cannot tell. */
  bookedCounts: Readonly<Record<string, number>>;
}>;

export interface CalendarRepository {
  setCourseAbsence?(sessionId: string, studentId: string, absent: boolean): Promise<BookingRecord>;
  loadMember(): Promise<CalendarMember>;
  loadWeek(studentId: string, fromIso: string, toIso: string): Promise<CalendarWeekData>;
  book(input: RequestBookingInput): Promise<BookingRecord>;
  cancel(input: CancelBookingInput): Promise<BookingRecord>;
  /** T040V2: member self check-in. Refusals preserve `code` and `details.reason`. */
  clockIn(input: SelfCheckInInput): Promise<AttendanceRecord>;
  loadPenalties(studentId: string): Promise<readonly NoShowPenaltyRecord[]>;
}
