import { httpsCallable } from "firebase/functions";
import type {
  AttendanceRecord,
  BookingRecord,
  CancelBookingInput,
  CheckInInput,
  CheckoutRecord,
  ClassRecord,
  CorrectAttendanceInput,
  CreateClassInput,
  CreateProgramInput,
  CreateSessionInput,
  ListSessionsQuery,
  LocationRecord,
  ProgramRecord,
  RecordCheckoutInput,
  RequestBookingInput,
  SessionOperationalView,
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

export async function requestBooking(input: RequestBookingInput): Promise<BookingRecord> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<RequestBookingInput, { booking: BookingRecord }>(
    functions,
    "requestBooking",
  );

  const result = await callable(input);
  return result.data.booking;
}

export async function cancelBooking(input: CancelBookingInput): Promise<BookingRecord> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<CancelBookingInput, { booking: BookingRecord }>(
    functions,
    "cancelBooking",
  );

  const result = await callable(input);
  return result.data.booking;
}

export async function listSessionBookings(
  sessionId: string,
): Promise<readonly BookingRecord[]> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<{ sessionId: string }, { bookings: BookingRecord[] }>(
    functions,
    "listSessionBookings",
  );

  const result = await callable({ sessionId });
  return result.data.bookings;
}

export async function listStudentBookings(
  studentId?: string,
): Promise<readonly BookingRecord[]> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<{ studentId?: string }, { bookings: BookingRecord[] }>(
    functions,
    "listStudentBookings",
  );

  const result = await callable(studentId ? { studentId } : {});
  return result.data.bookings;
}

export async function evaluateSessionMinimum(
  sessionId: string,
): Promise<{ confirmedCount: number; minParticipants: number; quorumMet: boolean }> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    { sessionId: string },
    { result: { confirmedCount: number; minParticipants: number; quorumMet: boolean } }
  >(functions, "evaluateSessionMinimum");

  const result = await callable({ sessionId });
  return result.data.result;
}

export async function recordCheckIn(input: CheckInInput): Promise<AttendanceRecord> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<CheckInInput, { attendance: AttendanceRecord }>(
    functions,
    "checkIn",
  );

  const result = await callable(input);
  return result.data.attendance;
}

export async function listSessionAttendance(
  sessionId: string,
): Promise<readonly AttendanceRecord[]> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<{ sessionId: string }, { attendance: AttendanceRecord[] }>(
    functions,
    "listSessionAttendance",
  );

  const result = await callable({ sessionId });
  return result.data.attendance;
}

export async function listStudentAttendance(
  studentId?: string,
): Promise<readonly AttendanceRecord[]> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<{ studentId?: string }, { attendance: AttendanceRecord[] }>(
    functions,
    "listStudentAttendance",
  );

  const result = await callable(studentId ? { studentId } : {});
  return result.data.attendance;
}

export async function correctAttendance(
  input: CorrectAttendanceInput,
): Promise<{ correction: AttendanceRecord; canonical: AttendanceRecord }> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    CorrectAttendanceInput,
    { correction: AttendanceRecord; canonical: AttendanceRecord }
  >(functions, "correctAttendance");

  const result = await callable(input);
  return result.data;
}

export async function reconcileSessionNoShows(
  sessionId: string,
): Promise<{ noShowsMarked: number; records: readonly AttendanceRecord[] }> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    { sessionId: string },
    { noShowsMarked: number; records: AttendanceRecord[] }
  >(functions, "reconcileSessionNoShows");

  const result = await callable({ sessionId });
  return result.data;
}

export async function listAttendanceHistory(
  sessionId: string,
  studentId?: string,
): Promise<readonly AttendanceRecord[]> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    { sessionId: string; studentId?: string },
    { history: AttendanceRecord[] }
  >(functions, "listAttendanceHistory");

  const result = await callable(studentId ? { sessionId, studentId } : { sessionId });
  return result.data.history;
}

export async function recordCheckout(
  input: RecordCheckoutInput,
): Promise<CheckoutRecord> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<RecordCheckoutInput, { checkout: CheckoutRecord }>(
    functions,
    "recordCheckout",
  );

  const result = await callable(input);
  return result.data.checkout;
}

export async function listSessionCheckouts(
  sessionId: string,
): Promise<readonly CheckoutRecord[]> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<{ sessionId: string }, { checkouts: CheckoutRecord[] }>(
    functions,
    "listSessionCheckouts",
  );

  const result = await callable({ sessionId });
  return result.data.checkouts;
}

export async function getStudentCheckout(
  sessionId: string,
  studentId?: string,
): Promise<CheckoutRecord | null> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<
    { sessionId: string; studentId?: string },
    { checkout: CheckoutRecord | null }
  >(functions, "getStudentCheckout");

  const result = await callable(studentId ? { sessionId, studentId } : { sessionId });
  return result.data.checkout;
}

export async function getSessionOperationalView(
  sessionId: string,
): Promise<SessionOperationalView> {
  const functions = getFirebaseFunctions();
  const callable = httpsCallable<{ sessionId: string }, { view: SessionOperationalView }>(
    functions,
    "getSessionOperationalView",
  );

  const result = await callable({ sessionId });
  return result.data.view;
}






