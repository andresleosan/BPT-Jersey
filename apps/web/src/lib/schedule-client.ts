import { httpsCallable } from "firebase/functions";
import type {
  ClassRecord,
  CreateClassInput,
  CreateProgramInput,
  CreateSessionInput,
  ListSessionsQuery,
  LocationRecord,
  ProgramRecord,
  SessionRecord,
} from "@bpt-jersey/domain/schedule";

import { getFirebaseFunctions } from "./firebase-client";

export type ScheduleCatalogResponse = Readonly<{
  locations: readonly LocationRecord[];
  programs: readonly ProgramRecord[];
}>;

export async function getScheduleCatalog(): Promise<ScheduleCatalogResponse> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<null, { locations: LocationRecord[]; programs: ProgramRecord[] }>(
    functions,
    "listScheduleCatalog",
  );

  const result = await callable(null);
  return {
    locations: result.data.locations,
    programs: result.data.programs,
  };
}

export async function listClasses(): Promise<readonly ClassRecord[]> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<null, { classes: ClassRecord[] }>(functions, "listClasses");

  const result = await callable(null);
  return result.data.classes;
}

export async function listSessions(
  query: ListSessionsQuery,
): Promise<readonly SessionRecord[]> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<ListSessionsQuery, { sessions: SessionRecord[] }>(
    functions,
    "listSessions",
  );

  const result = await callable(query);
  return result.data.sessions;
}

export async function saveClass(input: CreateClassInput): Promise<ClassRecord> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<CreateClassInput, { class: ClassRecord }>(
    functions,
    "saveClass",
  );

  const result = await callable(input);
  return result.data.class;
}

export async function saveSession(input: CreateSessionInput): Promise<SessionRecord> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<CreateSessionInput, { session: SessionRecord }>(
    functions,
    "saveSession",
  );

  const result = await callable(input);
  return result.data.session;
}

export async function saveProgram(input: CreateProgramInput): Promise<ProgramRecord> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<CreateProgramInput, { program: ProgramRecord }>(
    functions,
    "saveProgram",
  );

  const result = await callable(input);
  return result.data.program;
}

export async function generateSessions(input: {
  classId: string;
  fromDate: string;
  toDate: string;
  timezone?: string;
}): Promise<readonly SessionRecord[]> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    { classId: string; fromDate: string; toDate: string; timezone?: string },
    { sessions: SessionRecord[] }
  >(functions, "generateSessions");

  const result = await callable(input);
  return result.data.sessions;
}

export async function cancelSession(
  sessionId: string,
  reason: string,
): Promise<SessionRecord> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<{ sessionId: string; reason: string }, { session: SessionRecord }>(
    functions,
    "cancelSession",
  );

  const result = await callable({ sessionId, reason });
  return result.data.session;
}

