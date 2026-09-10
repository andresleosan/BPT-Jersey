function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

export function bookingFailureMessage(error: unknown): string {
  const code = field(error, "code");
  const reason = field(field(error, "details"), "reason");
  if (code === "functions/failed-precondition" && reason === "capacity") {
    return "This class is full.";
  }
  if (code === "functions/failed-precondition" && reason === "financial") {
    return "Your account can't book right now. Contact the academy.";
  }
  if (code === "functions/failed-precondition" && reason === "ineligible") {
    return "Your membership doesn't cover this class.";
  }
  if (code === "functions/permission-denied" || code === "functions/unauthenticated") {
    return "You can't book for this member.";
  }
  if (code === "functions/not-found") return "This class is no longer available.";
  return "Couldn't book. Refresh and try again.";
}

export function cancellationFailureMessage(error: unknown): string {
  const code = field(error, "code");
  const reason = field(field(error, "details"), "reason");
  if (code === "functions/failed-precondition" && reason === "ineligible") {
    return "This booking can't be cancelled online any more. Contact the academy.";
  }
  if (code === "functions/permission-denied" || code === "functions/unauthenticated") {
    return "You can't cancel this booking.";
  }
  if (code === "functions/not-found") return "This booking is no longer available.";
  return "Couldn't cancel. Refresh and try again.";
}
