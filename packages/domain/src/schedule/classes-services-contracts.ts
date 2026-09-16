import { err, ok, type Result } from "../result";

// ── Locations ──
export const locationKinds = Object.freeze(["presential", "zoom", "jitsi"] as const);
export type LocationKind = (typeof locationKinds)[number];

export type CreateLocationInput = Readonly<{
  name: string;
  abbreviation: string;
  kind: LocationKind;
}>;
export type UpdateLocationInput = Readonly<{
  locationId: string;
  name?: string;
  abbreviation?: string;
  kind?: LocationKind;
  active?: boolean;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(input: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(input).every((key) => allowed.includes(key));
}

function parseName(
  value: unknown,
  min: number,
  max: number,
  label: string,
): Result<string, string> {
  if (typeof value !== "string") return err(`${label} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max)
    return err(`${label} must be between ${min} and ${max} characters`);
  return ok(trimmed);
}

const abbreviationPattern = /^[A-Za-z0-9_-]{2,12}$/u;

function parseAbbreviation(value: unknown): Result<string, string> {
  if (typeof value !== "string" || !abbreviationPattern.test(value.trim())) {
    return err("abbreviation must be 2–12 letters, digits, '_' or '-'");
  }
  return ok(value.trim());
}

export function slugifyLocationId(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40);
  return slug.length >= 2 ? slug : `site-${slug}`.slice(0, 40);
}

export function parseCreateLocationInput(input: unknown): Result<CreateLocationInput, string> {
  if (!isRecord(input) || !onlyKeys(input, ["name", "abbreviation", "kind"])) {
    return err("Location input accepts exactly name, abbreviation and kind");
  }
  const name = parseName(input.name, 2, 80, "name");
  if (!name.ok) return name;
  const abbreviation = parseAbbreviation(input.abbreviation);
  if (!abbreviation.ok) return abbreviation;
  if (typeof input.kind !== "string" || !locationKinds.includes(input.kind as LocationKind)) {
    return err("kind must be presential, zoom or jitsi");
  }
  return ok(
    Object.freeze({
      name: name.value,
      abbreviation: abbreviation.value,
      kind: input.kind as LocationKind,
    }),
  );
}

export function parseUpdateLocationInput(input: unknown): Result<UpdateLocationInput, string> {
  if (
    !isRecord(input) ||
    !onlyKeys(input, ["locationId", "name", "abbreviation", "kind", "active"])
  ) {
    return err("Location update accepts locationId, name, abbreviation, kind and active");
  }
  if (typeof input.locationId !== "string" || input.locationId.trim().length === 0) {
    return err("locationId is required");
  }
  const result: { -readonly [K in keyof UpdateLocationInput]: UpdateLocationInput[K] } = {
    locationId: input.locationId.trim(),
  };
  if (input.name !== undefined) {
    const name = parseName(input.name, 2, 80, "name");
    if (!name.ok) return name;
    result.name = name.value;
  }
  if (input.abbreviation !== undefined) {
    const abbreviation = parseAbbreviation(input.abbreviation);
    if (!abbreviation.ok) return abbreviation;
    result.abbreviation = abbreviation.value;
  }
  if (input.kind !== undefined) {
    if (typeof input.kind !== "string" || !locationKinds.includes(input.kind as LocationKind)) {
      return err("kind must be presential, zoom or jitsi");
    }
    result.kind = input.kind as LocationKind;
  }
  if (input.active !== undefined) {
    if (typeof input.active !== "boolean") return err("active must be a boolean");
    result.active = input.active;
  }
  if (Object.keys(result).length === 1) return err("Nothing to update");
  return ok(Object.freeze(result));
}

// ── Programs (class / service types) v2 ──
export const programKinds = Object.freeze([
  "class-frequency",
  "class-unlimited",
  "room-frequency",
  "room-unlimited",
  "service",
] as const);
export type ProgramKind = (typeof programKinds)[number];

export const dropInPolicies = Object.freeze([
  "no",
  "unlimited",
  "automatic",
  "1",
  "2",
  "3",
  "4",
  "5",
] as const);
export type DropInPolicy = (typeof dropInPolicies)[number];

export type ProgramV2Fields = Readonly<{
  abbreviation: string;
  colour: string;
  kind: ProgramKind;
  dropInPolicy: DropInPolicy;
  notifyByEmail: boolean;
  showInList: boolean;
  message: string;
}>;

export const programDefaultsV2: ProgramV2Fields = Object.freeze({
  abbreviation: "",
  colour: "#F0EFFF",
  kind: "class-frequency",
  dropInPolicy: "unlimited",
  notifyByEmail: false,
  showInList: true,
  message: "",
});

export type CreateProgramInputV2 = Readonly<{ name: string; abbreviation: string }>;
export type UpdateProgramInput = Readonly<{ programId: string }> &
  Partial<ProgramV2Fields & Readonly<{ name: string; active: boolean }>>;

const colourPattern = /^#[0-9a-fA-F]{6}$/u;
export const programMessageMaxLength = 200;

export function parseCreateProgramInputV2(input: unknown): Result<CreateProgramInputV2, string> {
  if (!isRecord(input) || !onlyKeys(input, ["name", "abbreviation"])) {
    return err("Program input accepts exactly name and abbreviation");
  }
  const name = parseName(input.name, 2, 100, "name");
  if (!name.ok) return name;
  const abbreviation = parseAbbreviation(input.abbreviation);
  if (!abbreviation.ok) return abbreviation;
  return ok(Object.freeze({ name: name.value, abbreviation: abbreviation.value }));
}

export function parseUpdateProgramInput(input: unknown): Result<UpdateProgramInput, string> {
  const allowed = [
    "programId",
    "name",
    "active",
    "abbreviation",
    "colour",
    "kind",
    "dropInPolicy",
    "notifyByEmail",
    "showInList",
    "message",
  ];
  if (!isRecord(input) || !onlyKeys(input, allowed)) return err("Program update has unknown keys");
  if (typeof input.programId !== "string" || input.programId.trim().length === 0)
    return err("programId is required");
  const result: Record<string, unknown> = { programId: input.programId.trim() };
  if (input.name !== undefined) {
    const name = parseName(input.name, 2, 100, "name");
    if (!name.ok) return name;
    result.name = name.value;
  }
  if (input.abbreviation !== undefined) {
    const abbreviation = parseAbbreviation(input.abbreviation);
    if (!abbreviation.ok) return abbreviation;
    result.abbreviation = abbreviation.value;
  }
  if (input.colour !== undefined) {
    if (typeof input.colour !== "string" || !colourPattern.test(input.colour))
      return err("colour must be a #RRGGBB hex value");
    result.colour = input.colour.toUpperCase();
  }
  if (input.kind !== undefined) {
    if (typeof input.kind !== "string" || !programKinds.includes(input.kind as ProgramKind))
      return err("Invalid kind");
    result.kind = input.kind;
  }
  if (input.dropInPolicy !== undefined) {
    if (
      typeof input.dropInPolicy !== "string" ||
      !dropInPolicies.includes(input.dropInPolicy as DropInPolicy)
    ) {
      return err("Invalid dropInPolicy");
    }
    result.dropInPolicy = input.dropInPolicy;
  }
  for (const flag of ["notifyByEmail", "showInList", "active"] as const) {
    if (input[flag] !== undefined) {
      if (typeof input[flag] !== "boolean") return err(`${flag} must be a boolean`);
      result[flag] = input[flag];
    }
  }
  if (input.message !== undefined) {
    if (typeof input.message !== "string" || input.message.length > programMessageMaxLength) {
      return err(`message must be at most ${programMessageMaxLength} characters`);
    }
    result.message = input.message.trim();
  }
  if (Object.keys(result).length === 1) return err("Nothing to update");
  return ok(Object.freeze(result) as UpdateProgramInput);
}

// ── Session booking rules and waiting list ──
export type SessionBookingRules =
  | "defined"
  | Readonly<{
      bookUntilMinutesBefore: number;
      cancelUntil: "start" | "end" | Readonly<{ minutesBefore: number }>;
      advanceMinutes: number;
    }>;

export const waitingListModes = Object.freeze(["general", "on", "off"] as const);
export type WaitingListMode = (typeof waitingListModes)[number];

function isMinutes(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

export function parseSessionBookingRules(input: unknown): Result<SessionBookingRules, string> {
  if (input === "defined") return ok("defined");
  if (
    !isRecord(input) ||
    !onlyKeys(input, ["bookUntilMinutesBefore", "cancelUntil", "advanceMinutes"])
  ) {
    return err(
      "bookingRules must be 'defined' or an object with bookUntilMinutesBefore, cancelUntil and advanceMinutes",
    );
  }
  const { bookUntilMinutesBefore, cancelUntil, advanceMinutes } = input;
  if (!isMinutes(bookUntilMinutesBefore, 60 * 24 * 30))
    return err("bookUntilMinutesBefore must be 0–43200");
  if (!isMinutes(advanceMinutes, 60 * 24 * 365)) return err("advanceMinutes must be 0–525600");
  let parsedCancel: "start" | "end" | Readonly<{ minutesBefore: number }>;
  if (cancelUntil === "start" || cancelUntil === "end") {
    parsedCancel = cancelUntil;
  } else if (
    isRecord(cancelUntil) &&
    onlyKeys(cancelUntil, ["minutesBefore"]) &&
    isMinutes(cancelUntil.minutesBefore, 60 * 24 * 30)
  ) {
    parsedCancel = Object.freeze({ minutesBefore: cancelUntil.minutesBefore });
  } else {
    return err("cancelUntil must be 'start', 'end' or { minutesBefore }");
  }
  return ok(Object.freeze({ bookUntilMinutesBefore, cancelUntil: parsedCancel, advanceMinutes }));
}

// ── Weeks (copy / delete) ──
export type WeekRange = Readonly<{ from: string; to: string }>;
export type CopyWeekInput = Readonly<{
  fromWeekStart: string;
  toWeekStart: string;
  copyBookings: boolean;
}>;
export type DeleteWeekInput = Readonly<{ weekStart: string; reason: string }>;
export type WeekPreview = Readonly<{
  count: number;
  sample: readonly Readonly<{ sessionId: string; title: string; startAt: string }>[];
}>;

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

function zonedOffsetMinutes(utcMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - utcMs) / 60000);
}

/** Midnight of a local calendar date in `timezone`, as a UTC instant. */
export function localMidnightUtc(date: string, timezone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const guess = Date.UTC(year!, month! - 1, day!);
  return guess - zonedOffsetMinutes(guess, timezone) * 60000;
}

export function weekRangeFor(weekStart: string, timezone: string): Result<WeekRange, string> {
  if (typeof weekStart !== "string" || !isoDatePattern.test(weekStart))
    return err("weekStart must be YYYY-MM-DD");
  const startMs = localMidnightUtc(weekStart, timezone);
  if (Number.isNaN(startMs)) return err("weekStart is not a valid date");
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short" }).format(
    new Date(startMs),
  );
  if (weekday !== "Mon") return err("weekStart must be a Monday");
  const [ny, nm, nd] = weekStart.split("-").map(Number);
  const nextMonday = new Date(Date.UTC(ny!, nm! - 1, nd! + 7)).toISOString().slice(0, 10);
  const endMs = localMidnightUtc(nextMonday, timezone) - 1;
  return ok(
    Object.freeze({ from: new Date(startMs).toISOString(), to: new Date(endMs).toISOString() }),
  );
}

/**
 * Moves an instant by whole days *in local wall-clock time*: a class at 18:00 stays a class at
 * 18:00 even when the week it lands in is on the other side of a clock change. Adding
 * `days × 86 400 000 ms` would silently move it to 17:00, which is not what copying a week means.
 */
export function shiftIsoInZone(iso: string, days: number, timezone: string): string {
  const startMs = Date.parse(iso);
  if (Number.isNaN(startMs)) throw new Error(`${iso} is not an instant`);
  const naiveMs = startMs + days * 86_400_000;
  // Same wall-clock reading, one clock change later, is a different instant by the offset change.
  const driftMinutes =
    zonedOffsetMinutes(startMs, timezone) - zonedOffsetMinutes(naiveMs, timezone);
  return new Date(naiveMs + driftMinutes * 60000).toISOString();
}

export const weekReasonMinLength = 2;
export const weekReasonMaxLength = 200;

export function parseCopyWeekInput(input: unknown): Result<CopyWeekInput, string> {
  if (!isRecord(input) || !onlyKeys(input, ["fromWeekStart", "toWeekStart", "copyBookings"])) {
    return err("Copy week accepts fromWeekStart, toWeekStart and copyBookings");
  }
  const { fromWeekStart, toWeekStart, copyBookings } = input;
  if (typeof fromWeekStart !== "string" || !isoDatePattern.test(fromWeekStart))
    return err("fromWeekStart must be YYYY-MM-DD");
  if (typeof toWeekStart !== "string" || !isoDatePattern.test(toWeekStart))
    return err("toWeekStart must be YYYY-MM-DD");
  if (fromWeekStart === toWeekStart) return err("Target week must differ from the source week");
  if (typeof copyBookings !== "boolean") return err("copyBookings must be a boolean");
  return ok(Object.freeze({ fromWeekStart, toWeekStart, copyBookings }));
}

export function parseDeleteWeekInput(input: unknown): Result<DeleteWeekInput, string> {
  if (!isRecord(input) || !onlyKeys(input, ["weekStart", "reason"]))
    return err("Delete week accepts weekStart and reason");
  const { weekStart, reason } = input;
  if (typeof weekStart !== "string" || !isoDatePattern.test(weekStart))
    return err("weekStart must be YYYY-MM-DD");
  if (
    typeof reason !== "string" ||
    reason.trim().length < weekReasonMinLength ||
    reason.trim().length > weekReasonMaxLength
  ) {
    return err(
      `reason must be between ${weekReasonMinLength} and ${weekReasonMaxLength} characters`,
    );
  }
  return ok(Object.freeze({ weekStart, reason: reason.trim() }));
}
