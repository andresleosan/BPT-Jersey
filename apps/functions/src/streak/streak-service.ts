import type { Firestore } from "firebase-admin/firestore";
import { warn } from "firebase-functions/logger";
import type { AttendedSession } from "@bpt-jersey/domain/members/engagement";

import { countedAttendance } from "../levels/level-service.js";
import { readCanonicalMemberIdentityIds } from "../members/member-identity-firestore.js";

/** Same bound as the level store's safe read; the newest records are kept when it is reached. */
const maxAttendanceRecords = 400;
/** ponytail: a session document that is gone or has no usable times counts as one hour. */
const defaultDurationMinutes = 60;

/**
 * The student's counted attendance since `sinceIso`, with each session's length. "Counted" is exactly
 * what the level progress counts (`countedAttendance`), across the student's linked identities.
 */
export async function readAttendedSessions(
  db: Firestore,
  academyId: string,
  studentId: string,
  sinceIso: string,
): Promise<AttendedSession[]> {
  const identityIds = await readCanonicalMemberIdentityIds(db, academyId, studentId);
  // Reuses the (studentId ASC, occurredAt DESC) index; no new composite index is needed.
  const snapshot = await db
    .collection(`academies/${academyId}/attendance`)
    .where("studentId", "in", [...identityIds])
    .where("occurredAt", ">=", sinceIso)
    .orderBy("occurredAt", "desc")
    .limit(maxAttendanceRecords)
    .get();
  const records = countedAttendance(snapshot, academyId, studentId, identityIds);
  if (records.length === 0) return [];

  const sessionIds = [...new Set(records.map((record) => String(record.sessionId)))];
  const sessions = await db.getAll(
    ...sessionIds.map((id) => db.doc(`academies/${academyId}/sessions/${id}`)),
  );
  const minutesBySession = new Map<string, number>();
  for (const snapshot of sessions) {
    const value = snapshot.data();
    const minutes =
      snapshot.exists &&
      value?.academyId === academyId &&
      typeof value.startAt === "string" &&
      typeof value.endAt === "string"
        ? (Date.parse(value.endAt) - Date.parse(value.startAt)) / 60_000
        : Number.NaN;
    if (Number.isFinite(minutes) && minutes > 0) {
      minutesBySession.set(snapshot.id, minutes);
    } else {
      warn("Attended session has no usable duration; counting 60 minutes", {
        academyId,
        sessionId: snapshot.id,
      });
    }
  }
  return records.map((record) => ({
    occurredAt: String(record.occurredAt),
    durationMinutes: minutesBySession.get(String(record.sessionId)) ?? defaultDurationMinutes,
  }));
}
