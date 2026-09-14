function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

const fallback = "Couldn't check you in. Try again or ask a coach.";
const genericOutsideMessage = "You're too far from the gym. Get to the gym and try again.";

/** Decision 12: one sentence per refusal code from selfCheckIn; all other errors use the fallback. */
export function selfCheckInFailureMessage(error: unknown): string {
  if (field(error, "code") !== "functions/failed-precondition") return fallback;

  const details = field(error, "details");
  const reason = field(details, "reason");
  const distance = field(details, "distanceMeters");

  switch (reason) {
    case "outside":
      return typeof distance === "number" && Number.isFinite(distance) && distance >= 0 && Number.isInteger(distance)
        ? "You're " + distance + " m away. Get to the gym and try again."
        : genericOutsideMessage;
    case "imprecise":
      return "Your location isn't precise enough yet. Turn on Precise Location, step near the entrance and try again.";
    case "site_not_ready":
      return "This gym can't take self check-ins yet. Ask a coach to check you in.";
    case "window_closed":
      return "Check-in for this class has closed.";
    case "not_booked":
      return "You need a confirmed booking for this class.";
    case "already_checked_in":
      return "You're already checked in.";
    default:
      return fallback;
  }
}

export function positionFailureMessage(status: "denied" | "unavailable"): string {
  return status === "denied"
    ? "Location is off. Allow it for this site, or ask a coach to check you in."
    : "Couldn't read your location. Try again outside, or ask a coach to check you in.";
}
