import { participantBandAt, type ParticipantType } from "@bpt-jersey/domain/memberships";

/** D6: one band everywhere. Kept as a wrapper so existing callers do not change. */
export function participantBand(dateOfBirth: string, today = new Date()): ParticipantType {
  return participantBandAt({ dateOfBirth, onIso: today.toISOString() });
}
