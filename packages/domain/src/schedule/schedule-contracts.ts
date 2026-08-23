import { err, ok, type Result } from "../result";

export const locationIds = Object.freeze(["town", "west"] as const);
export type LocationId = (typeof locationIds)[number];

export const ageBands = Object.freeze(["kids", "teens", "adult", "all"] as const);
export type AgeBand = (typeof ageBands)[number];

export const disciplines = Object.freeze(["bjj", "mma", "self-defence", "open-mat"] as const);
export type Discipline = (typeof disciplines)[number];

export const classLevels = Object.freeze(["all-levels", "fundamentals", "advanced"] as const);
export type ClassLevel = (typeof classLevels)[number];

export const sessionStatuses = Object.freeze([
  "scheduled",
  "active",
  "cancelled",
  "completed",
] as const);
export type SessionStatus = (typeof sessionStatuses)[number];

export const daysOfWeek = Object.freeze([1, 2, 3, 4, 5, 6, 7] as const);
export type DayOfWeek = (typeof daysOfWeek)[number];

export type LocationRecord = Readonly<{
  locationId: LocationId;
  academyId: string;
  name: string;
  address: string;
  timezone: string;
  active: boolean;
  schemaVersion: "1";
}>;

export type ProgramRecord = Readonly<{
  programId: string;
  academyId: string;
  name: string;
  ageBand: AgeBand;
  discipline: Discipline;
  level: ClassLevel;
  active: boolean;
  schemaVersion: "1";
}>;

export type ClassRecurrenceRule = Readonly<{
  dayOfWeek: DayOfWeek;
  startTime: string; // HH:mm format
  durationMinutes: number; // e.g. 45, 60, 90
}>;

export type ClassRecord = Readonly<{
  classId: string;
  academyId: string;
  programId: string;
  locationId: LocationId;
  name: string;
  recurrenceRule: ClassRecurrenceRule;
  instructorIds: readonly string[];
  capacity: number;
  minParticipants: number;
  active: boolean;
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

export type SessionRecord = Readonly<{
  sessionId: string;
  academyId: string;
  classId: string | null;
  programId: string;
  locationId: LocationId;
  instructorId: string;
  title: string;
  startAt: string;
  endAt: string;
  capacity: number;
  minParticipants: number;
  status: SessionStatus;
  isSeminar: boolean;
  cancellationReason: string | null;
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

export type CreateClassInput = Readonly<{
  programId: string;
  locationId: LocationId;
  name: string;
  recurrenceRule: ClassRecurrenceRule;
  instructorIds: readonly string[];
  capacity: number;
  minParticipants?: number;
}>;

export type UpdateClassInput = Readonly<{
  classId: string;
  name?: string;
  instructorIds?: readonly string[];
  capacity?: number;
  minParticipants?: number;
  active?: boolean;
}>;

export type CreateSessionInput = Readonly<{
  classId?: string | null;
  programId: string;
  locationId: LocationId;
  instructorId: string;
  title: string;
  startAt: string;
  endAt: string;
  capacity: number;
  minParticipants?: number;
  isSeminar?: boolean;
}>;

export type CancelSessionInput = Readonly<{
  sessionId: string;
  reason: string;
}>;

export type ListSessionsQuery = Readonly<{
  from: string; // ISO 8601 UTC
  to: string; // ISO 8601 UTC
  locationId?: LocationId;
  programId?: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value)
  ) {
    return false;
  }
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp);
}

function isValidTimeFormat(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

export function parseRecurrenceRule(input: unknown): Result<ClassRecurrenceRule, string> {
  if (!isRecord(input)) {
    return err("Recurrence rule must be an object");
  }

  const { dayOfWeek, startTime, durationMinutes } = input;

  if (typeof dayOfWeek !== "number" || !daysOfWeek.includes(dayOfWeek as DayOfWeek)) {
    return err("Invalid dayOfWeek (must be an integer 1..7)");
  }

  if (!isValidTimeFormat(startTime)) {
    return err("Invalid startTime (must be HH:mm 24h format)");
  }

  if (
    typeof durationMinutes !== "number" ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 15 ||
    durationMinutes > 480
  ) {
    return err("Invalid durationMinutes (must be between 15 and 480 minutes)");
  }

  return ok(
    Object.freeze({
      dayOfWeek: dayOfWeek as DayOfWeek,
      startTime,
      durationMinutes,
    }),
  );
}

export function parseCreateClassInput(input: unknown): Result<CreateClassInput, string> {
  if (!isRecord(input)) {
    return err("Class input must be an object");
  }

  const {
    programId,
    locationId,
    name,
    recurrenceRule,
    instructorIds,
    capacity,
    minParticipants = 4,
  } = input;

  if (typeof programId !== "string" || programId.trim().length === 0) {
    return err("programId is required");
  }

  if (typeof locationId !== "string" || !locationIds.includes(locationId as LocationId)) {
    return err("Invalid locationId (must be 'town' or 'west')");
  }

  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100) {
    return err("name must be between 2 and 100 characters");
  }

  const recurrenceResult = parseRecurrenceRule(recurrenceRule);
  if (!recurrenceResult.ok) {
    return err(recurrenceResult.error);
  }

  if (
    !Array.isArray(instructorIds) ||
    instructorIds.length === 0 ||
    instructorIds.some((id) => typeof id !== "string" || id.trim().length === 0)
  ) {
    return err("instructorIds must be a non-empty array of strings");
  }

  if (
    typeof capacity !== "number" ||
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 200
  ) {
    return err("capacity must be an integer between 1 and 200");
  }

  if (
    typeof minParticipants !== "number" ||
    !Number.isInteger(minParticipants) ||
    minParticipants < 0 ||
    minParticipants > capacity
  ) {
    return err("minParticipants must be an integer between 0 and capacity");
  }

  return ok(
    Object.freeze({
      programId: programId.trim(),
      locationId: locationId as LocationId,
      name: name.trim(),
      recurrenceRule: recurrenceResult.value,
      instructorIds: Object.freeze([...new Set(instructorIds.map((id: string) => id.trim()))]),
      capacity,
      minParticipants,
    }),
  );
}

export function parseCreateSessionInput(input: unknown): Result<CreateSessionInput, string> {
  if (!isRecord(input)) {
    return err("Session input must be an object");
  }

  const {
    classId = null,
    programId,
    locationId,
    instructorId,
    title,
    startAt,
    endAt,
    capacity,
    minParticipants = 4,
    isSeminar = false,
  } = input;

  if (
    classId !== null &&
    classId !== undefined &&
    (typeof classId !== "string" || classId.trim().length === 0)
  ) {
    return err("classId must be a non-empty string or null");
  }

  if (typeof programId !== "string" || programId.trim().length === 0) {
    return err("programId is required");
  }

  if (typeof locationId !== "string" || !locationIds.includes(locationId as LocationId)) {
    return err("Invalid locationId (must be 'town' or 'west')");
  }

  if (typeof instructorId !== "string" || instructorId.trim().length === 0) {
    return err("instructorId is required");
  }

  if (typeof title !== "string" || title.trim().length < 2 || title.trim().length > 120) {
    return err("title must be between 2 and 120 characters");
  }

  if (!isIsoDate(startAt) || !isIsoDate(endAt)) {
    return err("startAt and endAt must be valid ISO 8601 UTC date strings");
  }

  const startTimestamp = Date.parse(startAt);
  const endTimestamp = Date.parse(endAt);

  if (endTimestamp <= startTimestamp) {
    return err("endAt must be strictly after startAt");
  }

  if (
    typeof capacity !== "number" ||
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 300
  ) {
    return err("capacity must be an integer between 1 and 300");
  }

  if (
    typeof minParticipants !== "number" ||
    !Number.isInteger(minParticipants) ||
    minParticipants < 0 ||
    minParticipants > capacity
  ) {
    return err("minParticipants must be an integer between 0 and capacity");
  }

  return ok(
    Object.freeze({
      classId: typeof classId === "string" ? classId.trim() : null,
      programId: programId.trim(),
      locationId: locationId as LocationId,
      instructorId: instructorId.trim(),
      title: title.trim(),
      startAt,
      endAt,
      capacity,
      minParticipants,
      isSeminar: Boolean(isSeminar),
    }),
  );
}

export function parseListSessionsQuery(input: unknown): Result<ListSessionsQuery, string> {
  if (!isRecord(input)) {
    return err("Query must be an object");
  }

  const { from, to, locationId, programId } = input;

  if (!isIsoDate(from) || !isIsoDate(to)) {
    return err("from and to must be valid ISO 8601 UTC date strings");
  }

  const fromTime = Date.parse(from);
  const toTime = Date.parse(to);

  if (toTime < fromTime) {
    return err("to must be after or equal to from");
  }

  // Max query range: 90 days
  const maxRangeMs = 90 * 24 * 60 * 60 * 1000;
  if (toTime - fromTime > maxRangeMs) {
    return err("Date range cannot exceed 90 days");
  }

  if (
    locationId !== undefined &&
    (typeof locationId !== "string" || !locationIds.includes(locationId as LocationId))
  ) {
    return err("Invalid locationId");
  }

  if (programId !== undefined && (typeof programId !== "string" || programId.trim().length === 0)) {
    return err("Invalid programId");
  }

  const query: {
    from: string;
    to: string;
    locationId?: LocationId;
    programId?: string;
  } = { from, to };

  if (locationId !== undefined) {
    query.locationId = locationId as LocationId;
  }

  if (typeof programId === "string" && programId.trim().length > 0) {
    query.programId = programId.trim();
  }

  return ok(Object.freeze(query));
}

// ── Program input parser ──

export type CreateProgramInput = Readonly<{
  name: string;
  ageBand: AgeBand;
  discipline: Discipline;
  level: ClassLevel;
}>;

export function parseCreateProgramInput(input: unknown): Result<CreateProgramInput, string> {
  if (!isRecord(input)) {
    return err("Program input must be an object");
  }

  const { name, ageBand, discipline, level } = input;

  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100) {
    return err("name must be between 2 and 100 characters");
  }

  if (typeof ageBand !== "string" || !ageBands.includes(ageBand as AgeBand)) {
    return err("Invalid ageBand (must be 'kids', 'teens', 'adult', or 'all')");
  }

  if (typeof discipline !== "string" || !disciplines.includes(discipline as Discipline)) {
    return err("Invalid discipline (must be 'bjj', 'mma', 'self-defence', or 'open-mat')");
  }

  if (typeof level !== "string" || !classLevels.includes(level as ClassLevel)) {
    return err("Invalid level (must be 'all-levels', 'fundamentals', or 'advanced')");
  }

  return ok(
    Object.freeze({
      name: name.trim(),
      ageBand: ageBand as AgeBand,
      discipline: discipline as Discipline,
      level: level as ClassLevel,
    }),
  );
}

// ── Session generation from class recurrence ──

/**
 * Pure function: generates `SessionRecord` drafts for each occurrence of a
 * recurring class within a date range, converting local start times to UTC
 * using the supplied IANA timezone.
 *
 * Session IDs are deterministic: `{classId}__{YYYY-MM-DD}` to allow
 * idempotent batch generation (the store can skip existing IDs).
 */
export function generateSessionsFromClass(
  classRecord: ClassRecord,
  fromDate: string, // YYYY-MM-DD inclusive
  toDate: string, // YYYY-MM-DD inclusive
  timezone: string,
): Omit<SessionRecord, "createdAt" | "createdBy" | "updatedAt" | "updatedBy">[] {
  const {
    recurrenceRule,
    classId,
    academyId,
    programId,
    locationId,
    instructorIds,
    capacity,
    minParticipants,
    name,
  } = classRecord;
  const { dayOfWeek, startTime, durationMinutes } = recurrenceRule;

  const timeParts = startTime.split(":").map(Number);
  const startHour = timeParts[0] ?? 0;
  const startMinute = timeParts[1] ?? 0;
  const sessions: Omit<SessionRecord, "createdAt" | "createdBy" | "updatedAt" | "updatedBy">[] = [];

  // Walk each day in the range
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T23:59:59Z`);

  const current = new Date(from);
  while (current <= to) {
    // ISO dayOfWeek: 1=Mon...7=Sun; JS getUTCDay: 0=Sun...6=Sat
    const jsDay = current.getUTCDay();
    const isoDay = jsDay === 0 ? 7 : jsDay;

    if (isoDay === dayOfWeek) {
      const localDateStr = current.toISOString().slice(0, 10); // YYYY-MM-DD

      // Build a local datetime string and convert to UTC using timezone offset
      const startUtc = localToUtc(localDateStr, startHour, startMinute, timezone);
      const endUtc = new Date(startUtc.getTime() + durationMinutes * 60 * 1000);

      sessions.push(
        Object.freeze({
          sessionId: `${classId}__${localDateStr}`,
          academyId,
          classId,
          programId,
          locationId,
          instructorId: instructorIds[0] ?? "",
          title: name,
          startAt: endWithZ(startUtc),
          endAt: endWithZ(endUtc),
          capacity,
          minParticipants,
          status: "scheduled" as const,
          isSeminar: false,
          cancellationReason: null,
          schemaVersion: "1" as const,
        }),
      );
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return sessions;
}

/**
 * Converts a local date+time in the given IANA timezone to a UTC Date.
 * Uses the ECMAScript Intl API to resolve the timezone offset, which
 * correctly handles DST transitions without external dependencies.
 */
function localToUtc(dateStr: string, hour: number, minute: number, timezone: string): Date {
  // Create a date in UTC, then use Intl to find the offset in the target timezone
  const tentativeUtc = new Date(`${dateStr}T${pad(hour)}:${pad(minute)}:00Z`);

  // Get the offset of the target timezone at this UTC instant
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(tentativeUtc);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");

  const localAtUtc = new Date(
    Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") === 24 ? 0 : get("hour"),
      get("minute"),
      get("second"),
    ),
  );

  // The offset is: localAtUtc - tentativeUtc (in ms)
  const offsetMs = localAtUtc.getTime() - tentativeUtc.getTime();

  // We want the UTC time such that when converted to the timezone, it reads hour:minute on dateStr
  // So: utcResult + offset = local => utcResult = local - offset
  // "local" as UTC = Date.UTC(year, month-1, day, hour, minute, 0)
  const dateParts = dateStr.split("-").map(Number);
  const y = dateParts[0] ?? 0;
  const m = dateParts[1] ?? 1;
  const d = dateParts[2] ?? 1;
  const localAsUtcMs = Date.UTC(y, m - 1, d, hour, minute, 0);

  return new Date(localAsUtcMs - offsetMs);
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function endWithZ(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/u, "Z");
}

// ── Booking Contracts & Types ──

export const bookingStatuses = Object.freeze(["requested", "confirmed", "cancelled"] as const);
export type BookingStatus = (typeof bookingStatuses)[number];

export type BookingRecord = Readonly<{
  bookingId: string; // deterministic: `${sessionId}__${studentId}`
  academyId: string;
  sessionId: string;
  studentId: string;
  membershipId: string;
  status: BookingStatus;
  requestedAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

export type RequestBookingInput = Readonly<{
  sessionId: string;
  studentId: string;
  membershipId: string;
}>;

export type CancelBookingInput = Readonly<{
  sessionId: string;
  studentId: string;
  reason: string;
}>;

/**
 * Builds the deterministic identifier for a booking: `${sessionId}__${studentId}`.
 */
export function buildBookingId(sessionId: string, studentId: string): string {
  return `${sessionId.trim()}__${studentId.trim()}`;
}

/**
 * Validates the 1-hour cutoff rule for bookings and student cancellations.
 * Returns true if the session start is at least `cutoffMinutes` in the future.
 */
export function isWithinBookingCutoff(
  sessionStartAtIso: string,
  nowIso?: string,
  cutoffMinutes = 60,
): boolean {
  const startMs = Date.parse(sessionStartAtIso);
  const nowMs = nowIso ? Date.parse(nowIso) : Date.now();

  if (Number.isNaN(startMs) || Number.isNaN(nowMs)) {
    return false;
  }

  const diffMs = startMs - nowMs;
  const cutoffMs = cutoffMinutes * 60 * 1000;

  return diffMs >= cutoffMs;
}

export function parseRequestBookingInput(input: unknown): Result<RequestBookingInput, string> {
  if (!isRecord(input)) {
    return err("Booking request input must be an object");
  }

  const { sessionId, studentId, membershipId } = input;

  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return err("sessionId is required");
  }

  if (typeof studentId !== "string" || studentId.trim().length === 0) {
    return err("studentId is required");
  }

  if (typeof membershipId !== "string" || membershipId.trim().length === 0) {
    return err("membershipId is required");
  }

  return ok(
    Object.freeze({
      sessionId: sessionId.trim(),
      studentId: studentId.trim(),
      membershipId: membershipId.trim(),
    }),
  );
}

export function parseCancelBookingInput(input: unknown): Result<CancelBookingInput, string> {
  if (!isRecord(input)) {
    return err("Cancel booking input must be an object");
  }

  const { sessionId, studentId, reason } = input;

  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return err("sessionId is required");
  }

  if (typeof studentId !== "string" || studentId.trim().length === 0) {
    return err("studentId is required");
  }

  if (typeof reason !== "string" || reason.trim().length < 2 || reason.trim().length > 200) {
    return err("reason must be between 2 and 200 characters");
  }

  return ok(
    Object.freeze({
      sessionId: sessionId.trim(),
      studentId: studentId.trim(),
      reason: reason.trim(),
    }),
  );
}

// ── Multi-criteria Booking Eligibility Evaluation ──

export type BookingEligibilityInput = Readonly<{
  membershipStatus: "draft" | "trial" | "active" | "paused" | "overdue" | "cancelled";
  planLocations: readonly LocationId[];
  weeklyClassesLimit: number | null; // null = unlimited
  currentWeekBookingsCount: number;
  isPayg: boolean;
  paygUnpaidSessionsCount: number;
  sessionLocationId: LocationId;
}>;

export type BookingEligibilityResult = { eligible: true } | { eligible: false; reason: string };

/**
 * Pure function: Evaluates whether a student is eligible to book a session based on:
 * 1. Membership status (must be active or trial)
 * 2. Plan location coverage (must include the session's location)
 * 3. Weekly class quota (if limited by plan, e.g. 1x/wk or 2x/wk)
 * 4. PAYG debt policy (max 1 unpaid session allowed before booking is blocked)
 */
export function evaluateBookingEligibility(
  input: BookingEligibilityInput,
): BookingEligibilityResult {
  const {
    membershipStatus,
    planLocations,
    weeklyClassesLimit,
    currentWeekBookingsCount,
    isPayg,
    paygUnpaidSessionsCount,
    sessionLocationId,
  } = input;

  if (membershipStatus !== "active" && membershipStatus !== "trial") {
    return {
      eligible: false,
      reason: `Membership is in '${membershipStatus}' status; active or trial required to book.`,
    };
  }

  if (!planLocations.includes(sessionLocationId)) {
    return {
      eligible: false,
      reason: `Location not covered: plan only grants access to [${planLocations.join(", ")}], but session is in '${sessionLocationId}'.`,
    };
  }

  if (weeklyClassesLimit !== null && currentWeekBookingsCount >= weeklyClassesLimit) {
    return {
      eligible: false,
      reason: `Weekly class limit reached: plan allows ${weeklyClassesLimit} classes per week (${currentWeekBookingsCount} already booked).`,
    };
  }

  if (isPayg && paygUnpaidSessionsCount > 1) {
    return {
      eligible: false,
      reason: `PAYG debt: student has ${paygUnpaidSessionsCount} unpaid sessions; maximum 1 allowed before new bookings are blocked.`,
    };
  }

  return { eligible: true };
}

// ── Attendance & Check-In Contracts ──

export const checkInMethods = Object.freeze(["qr", "pin", "nameSearch", "manual"] as const);
export type CheckInMethod = (typeof checkInMethods)[number];

export const attendanceStates = Object.freeze([
  "attended",
  "late",
  "absent",
  "no_show",
  "excused",
] as const);
export type AttendanceState = (typeof attendanceStates)[number];

export type AttendanceRecord = Readonly<{
  attendanceId: string; // deterministic: `${sessionId}__${studentId}` or correction `corr_...`
  academyId: string;
  sessionId: string;
  studentId: string;
  method: CheckInMethod;
  state: AttendanceState;
  occurredAt: string;
  notes: string | null;
  correctionOf: string | null;
  schemaVersion: "1";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}>;

export type CheckInInput = Readonly<{
  sessionId: string;
  studentId: string;
  method: CheckInMethod;
  pin?: string;
  notes?: string;
}>;

export type CorrectAttendanceInput = Readonly<{
  sessionId: string;
  studentId: string;
  newState: AttendanceState;
  reason: string;
}>;

/**
 * Builds the deterministic canonical identifier for attendance: `${sessionId}__${studentId}`.
 */
export function buildAttendanceId(sessionId: string, studentId: string): string {
  return `${sessionId.trim()}__${studentId.trim()}`;
}

/**
 * Generates an opaque backend ID for an attendance correction: `corr_${timestamp}_${rand}`.
 */
export function buildCorrectionAttendanceId(suffix?: string): string {
  const ts = Date.now().toString(36);
  const rand = suffix ?? Math.random().toString(36).slice(2, 8);
  return `corr_${ts}_${rand}`;
}

/**
 * Determines punctuality state based on check-in timestamp relative to session start.
 * If check-in occurs within `lateThresholdMinutes` (default 15m) of startAt, returns 'attended', else 'late'.
 */
export function determinePunctuality(
  sessionStartAtIso: string,
  checkInAtIso?: string,
  lateThresholdMinutes = 15,
): AttendanceState {
  const startMs = Date.parse(sessionStartAtIso);
  const checkInMs = checkInAtIso ? Date.parse(checkInAtIso) : Date.now();

  if (Number.isNaN(startMs) || Number.isNaN(checkInMs)) {
    return "attended";
  }

  const lateCutoffMs = startMs + lateThresholdMinutes * 60 * 1000;
  return checkInMs > lateCutoffMs ? "late" : "attended";
}

export function parseCheckInInput(input: unknown): Result<CheckInInput, string> {
  if (!isRecord(input)) {
    return err("Check-in input must be an object");
  }

  const { sessionId, studentId, method, pin, notes } = input;

  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return err("sessionId is required");
  }

  if (typeof studentId !== "string" || studentId.trim().length === 0) {
    return err("studentId is required");
  }

  if (typeof method !== "string" || !checkInMethods.includes(method as CheckInMethod)) {
    return err(`Invalid check-in method. Expected one of: ${checkInMethods.join(", ")}`);
  }

  const result: {
    sessionId: string;
    studentId: string;
    method: CheckInMethod;
    pin?: string;
    notes?: string;
  } = {
    sessionId: sessionId.trim(),
    studentId: studentId.trim(),
    method: method as CheckInMethod,
  };

  if (typeof pin === "string" && pin.trim().length > 0) {
    result.pin = pin.trim();
  }

  if (typeof notes === "string" && notes.trim().length > 0) {
    result.notes = notes.trim();
  }

  return ok(Object.freeze(result));
}

export function parseCorrectAttendanceInput(
  input: unknown,
): Result<CorrectAttendanceInput, string> {
  if (!isRecord(input)) {
    return err("Correct attendance input must be an object");
  }

  const { sessionId, studentId, newState, reason } = input;

  if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
    return err("sessionId is required");
  }

  if (typeof studentId !== "string" || studentId.trim().length === 0) {
    return err("studentId is required");
  }

  if (typeof newState !== "string" || !attendanceStates.includes(newState as AttendanceState)) {
    return err(`Invalid attendance state. Expected one of: ${attendanceStates.join(", ")}`);
  }

  if (typeof reason !== "string" || reason.trim().length === 0) {
    return err("reason is required for attendance correction");
  }

  return ok(
    Object.freeze({
      sessionId: sessionId.trim(),
      studentId: studentId.trim(),
      newState: newState as AttendanceState,
      reason: reason.trim(),
    }),
  );
}
