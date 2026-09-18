// Type surface of regyfit-history-import.mjs for the qa unit tests. Keep it in step with the
// exports of the .mjs.

export type HistoryRow = readonly [string, string, string, string, string];

export type ParsedSentence = {
  family: string;
  action:
    | "booking.created"
    | "booking.cancelled"
    | "dropin.created"
    | "dropin.cancelled"
    | "attendance.checked_in";
  actorGroup: "member" | "staff";
  studentName: string | null;
  groupName: string | null;
  programName: string | null;
  classDate: string;
  classTime: string;
};

export type ResolvedSession = {
  sessionId: string;
  programId: string | null;
  locationId: string | null;
};

export type MapOptions = {
  academyId: string;
  /** "class-mismatch" when the class the sentence names picks out no single session at that time. */
  resolveSession: (
    sessionStartAt: string,
    programName: string | null,
  ) => ResolvedSession | "class-mismatch" | null;
  resolveStudent: (studentName: string) => string | "ambiguous" | null;
};

export type MappedEventClass = {
  studentId: string | null;
  studentName: string | null;
  sessionId: string | null;
  sessionStartAt: string;
  programId: string | null;
  locationId: string | null;
};

export type MappedEventDraft = {
  academyId: string;
  actorId: string;
  action: ParsedSentence["action"];
  targetRef: string;
  purpose: string;
  correlationId: string;
  class: MappedEventClass;
  actorIp: string | null;
  actorRole: "regyfit";
  actorGroup: "member" | "staff";
  actorName: string | null;
  source: "regyfit";
};

export type MappedEvent = {
  ok: true;
  family: string;
  eventId: string;
  occurredAt: string;
  draft: MappedEventDraft;
  notes: string[];
};

export type RejectedRow = {
  ok: false;
  reason: string;
  sentence: string;
  loggedAt: string | null;
};

export const importActorId: string;
export const importPurpose: string;
export const sentenceFamilyNames: readonly string[];

export function chooseSession(
  candidates: readonly ResolvedSession[],
  programName: string | null,
  programNameById: ReadonlyMap<string | null, string | undefined>,
): ResolvedSession | "class-mismatch" | null;
export function parseHistorySentence(sentence: string): ParsedSentence | null;
export function parseLogTimestamp(value: string): string | null;
export function normaliseName(value: string): string;
export function historyEventId(row: HistoryRow): string;
export function groupStudentName(groupName: string | null): string | null;
export function mapHistoryRow(row: HistoryRow, options: MapOptions): MappedEvent | RejectedRow;
export function historyEventDocument<Stamp>(
  mapped: MappedEvent,
  timestampFromIso: (iso: string) => Stamp,
): Omit<MappedEventDraft, never> & {
  auditEventId: string;
  occurredAt: Stamp;
  result: "completed";
  schemaVersion: 1;
};
