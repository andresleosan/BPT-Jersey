import type { Site } from "@bpt-jersey/domain/memberships";
import { enrolmentTrialAllowance } from "@bpt-jersey/domain/members/enrolment-requests";
import {
  trialAccessSchema,
  trialAttendedCount,
  trialExpiresAt,
  trialStatusAt,
  type TrialAccessRecord,
  type TrialAccessView,
} from "@bpt-jersey/domain/memberships/trial-access";
import { isIntroBooking, type BookingRecord } from "@bpt-jersey/domain/schedule";

export type TrialReader = { get(path: string): Promise<{ exists: boolean; data(): unknown }> };

export async function readTrialAccess(
  reader: TrialReader,
  academyId: string,
  studentId: string,
): Promise<TrialAccessRecord | undefined> {
  const doc = await reader.get(`academies/${academyId}/trialAccess/${studentId}`);
  if (!doc.exists) return undefined;
  const parsed = trialAccessSchema.safeParse(doc.data());
  if (!parsed.success) return undefined;
  if (parsed.data.academyId !== academyId || parsed.data.studentId !== studentId) return undefined;
  return parsed.data;
}

/** The `trialAccess/{studentId}` document an approved student starts their free trial with. */
export function newTrialAccessRecord(input: {
  academyId: string;
  studentId: string;
  site: Site;
  experience: "beginner" | "experienced";
  startsAt: string;
  enrolmentRequestId: string;
}): TrialAccessRecord {
  return trialAccessSchema.parse({
    trialId: input.studentId,
    academyId: input.academyId,
    studentId: input.studentId,
    site: input.site,
    experience: input.experience,
    allowance: enrolmentTrialAllowance(input.experience),
    countedAttendanceIds: [],
    status: "active",
    startsAt: input.startsAt,
    expiresAt: trialExpiresAt(input.startsAt),
    enrolmentRequestId: input.enrolmentRequestId,
    createdAt: input.startsAt,
    updatedAt: input.startsAt,
    schemaVersion: "1",
  });
}

export function trialView(
  trial: TrialAccessRecord,
  futureBookings: number,
  nowIso: string,
): TrialAccessView {
  return {
    site: trial.site,
    experience: trial.experience,
    allowance: trial.allowance,
    attendedCount: trialAttendedCount(trial),
    futureBookings,
    expiresAt: trial.expiresAt,
    status: trialStatusAt(trial, nowIso),
  };
}

export function futureIntroBookingCount(
  bookings: readonly BookingRecord[],
  sessions: ReadonlyMap<string, { startAt: string }>,
  attendedSessionIds: ReadonlySet<string>,
  nowIso: string,
): number {
  return bookings.filter((b) => {
    if (!isIntroBooking(b) || b.status !== "confirmed" || attendedSessionIds.has(b.sessionId)) {
      return false;
    }
    const session = sessions.get(b.sessionId);
    if (!session) return false;
    return Date.parse(session.startAt) > Date.parse(nowIso);
  }).length;
}
