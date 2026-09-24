import { memberAgeOn } from "../members/member-access-contracts";
import type { ParticipantType } from "./plan-contracts";

const jerseyDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Jersey",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * D6 (Luis, 23-sep): one band for price, tables and bookings in both centres. Under 12 kids,
 * 12–15 teens, 16+ adult. A 16–17 year old is still a minor for consent (D10): never decide
 * consent from this. No date of birth → adult (23-sep rule).
 */
export function bandForAge(age: number | null): ParticipantType {
  if (age === null || age >= 16) return "adult";
  return age >= 12 ? "teens" : "kids";
}
export function participantBandAt(
  input: Readonly<{ dateOfBirth?: string | null; onIso: string }>,
): ParticipantType {
  return bandForAge(
    memberAgeOn(input.dateOfBirth ?? undefined, jerseyDay.format(new Date(input.onIso))),
  );
}
/**
 * D9: a live teens plan keeps working until renewal. A 16–17 year old whose current plan covers
 * teens but not adults books and sees classes as a teen. Only for booking eligibility and calendar
 * locking of an existing membership; plan choice and membership creation use `participantBandAt`.
 */
export function bookingBandAt(
  input: Readonly<{
    dateOfBirth?: string | null;
    onIso: string;
    livePlanTypes?: readonly ParticipantType[] | null;
  }>,
): ParticipantType {
  const band = participantBandAt(input);
  if (
    band !== "adult" ||
    !input.livePlanTypes?.includes("teens") ||
    input.livePlanTypes.includes("adult")
  )
    return band;
  const age = memberAgeOn(input.dateOfBirth ?? undefined, jerseyDay.format(new Date(input.onIso)));
  return age === 16 || age === 17 ? "teens" : band;
}
