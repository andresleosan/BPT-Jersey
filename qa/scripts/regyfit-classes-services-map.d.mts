// Type surface of regyfit-classes-services-map.mjs for the qa unit tests. Keep it in step with
// the exports of the .mjs.

export type RegyfitType = {
  name: string;
  abbreviation: string;
  colour: string;
  active: boolean;
  type: string;
  dropIns: string;
  email: boolean;
  list: boolean;
  message: string;
  icon: string;
};

export type RegyfitRow = { week: string; id: string; cells: string[]; icon: string };

export type ProgramDocument = {
  programId: string;
  academyId: string;
  name: string;
  ageBand: "all";
  discipline: "bjj";
  level: "all-levels";
  abbreviation: string;
  colour: string;
  kind: "class-frequency" | "class-unlimited";
  dropInPolicy: "no" | "unlimited" | "automatic" | "1" | "2" | "3" | "4" | "5";
  notifyByEmail: boolean;
  showInList: boolean;
  message: string;
  active: boolean;
  schemaVersion: "1";
};

export type SessionDocument = {
  sessionId: string;
  academyId: string;
  classId: null;
  programId: string;
  locationId: "town" | "west";
  instructorId: string;
  instructorIds: string[];
  title: string;
  startAt: string;
  endAt: string;
  capacity: number | null;
  minParticipants: 0;
  status: "scheduled" | "completed";
  isSeminar: false;
  cancellationReason: null;
  schemaVersion: "1";
  createdAt: string;
  createdBy: "regyfit-import";
  updatedAt: string;
  updatedBy: "regyfit-import";
};

export const productionConfirmation: "classes-services-types-sessions-production-v1";

export function parseRegyfitDate(text: string): string;
export function zonedIso(date: string, time: string, timezone: string): string;
export function programIdFor(typeName: string): string;
export function trainerKeyFor(name: string): string;
export function mapType(type: RegyfitType, academyId: string): ProgramDocument;
export function mapSessionRow(
  row: RegyfitRow,
  options: {
    academyId: string;
    programIdsByName: ReadonlyMap<string, string>;
    now: string;
    timezone: string;
  },
): SessionDocument;
export function planImport(
  capture: { types: RegyfitType[]; rows: RegyfitRow[] },
  options: { academyId: string; now: string; timezone: string; from?: string; to?: string },
): {
  programs: ProgramDocument[];
  sessions: SessionDocument[];
  trainers: string[];
  outsideWindow: number;
  duplicates: number;
};
export function resolveTarget(env: Record<string, string | undefined>): {
  target: "emulator" | "production";
  projectId: string;
};
