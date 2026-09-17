import type { ParticipantType } from "@bpt-jersey/domain/memberships";

/** Age band on `today` from a YYYY-MM-DD birth date: under 12 kids, 12–17 teens, else adult. */
export function participantBand(dateOfBirth: string, today = new Date()): ParticipantType {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateOfBirth);
  if (!parts) return "adult";
  let age = today.getUTCFullYear() - Number(parts[1]);
  const month = Number(parts[2]) - 1;
  const day = Number(parts[3]);
  if (today.getUTCMonth() < month || (today.getUTCMonth() === month && today.getUTCDate() < day)) {
    age -= 1;
  }
  if (age >= 18) return "adult";
  return age >= 12 ? "teens" : "kids";
}
