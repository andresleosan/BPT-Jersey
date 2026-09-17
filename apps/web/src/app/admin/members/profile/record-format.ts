const recordDateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-01-15" → "15 Jan 2026". Date-only values are formatted in UTC so the day never shifts. */
export function formatRecordDate(date: string): string {
  return recordDateFormat.format(new Date(`${date}T00:00:00.000Z`));
}

export function participantTypeLabel(value: "adult" | "minor"): string {
  return value === "adult" ? "Adult" : "Minor";
}

export function statusLabel(value: "active" | "inactive" | "suspended"): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
