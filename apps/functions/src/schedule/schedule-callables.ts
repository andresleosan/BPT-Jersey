import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import {
  parseCancelBookingInput,
  parseCheckInInput,
  parseCorrectAttendanceInput,
  parseCreateClassInput,
  parseCreateProgramInput,
  parseCreateSessionInput,
  parseListSessionsQuery,
  parseRecordCheckoutInput,
  parseRequestBookingInput,
  parseUpdateClassInput,
} from "@bpt-jersey/domain/schedule";

import { requireUserActor } from "../auth/user-authorization.js";
import { BookingTransactionError } from "./booking-transaction-service.js";
import {
  ScheduleAttendanceError,
  type ScheduleMutationActorRole,
} from "./attendance-transaction-service.js";
import {
  createFirestoreCanonicalClientStudentScopeResolver,
  type CanonicalClientStudentScopeResolver,
} from "./canonical-client-student-scope.js";
import { scheduleCallableOptions } from "./schedule-callable-options.js";
import { createFirestoreScheduleStore, type ScheduleStore } from "./schedule-service.js";

const staffRoles = Object.freeze(["owner", "administrator", "headCoach", "coach"] as const);
const managerRoles = Object.freeze(["owner", "administrator", "headCoach"] as const);
const adminRoles = Object.freeze(["owner", "administrator"] as const);
export type GuardianStudentScopeInput = Readonly<{
  academyId: string;
  guardianUserId: string;
  studentId: string;
}>;

export type GuardianStudentScopeResolver = (input: GuardianStudentScopeInput) => Promise<boolean>;

type StudentScopeOptions = Readonly<{
  store: ScheduleStore;
  resolveClientStudentScope?: CanonicalClientStudentScopeResolver;
}>;

export function createFirestoreGuardianStudentScopeResolver(
  options: Readonly<{ firestore?: Firestore; now?: () => Date }> = {},
): GuardianStudentScopeResolver {
  const resolver = createFirestoreCanonicalClientStudentScopeResolver({
    ...(options.firestore === undefined ? {} : { firestore: options.firestore }),
    ...(options.now === undefined ? {} : { now: () => options.now!().toISOString() }),
  });
  return (input) =>
    resolver({
      academyId: input.academyId,
      actorUserId: input.guardianUserId,
      actorRole: "guardian",
      requestedStudentId: input.studentId,
    });
}

const resolveCanonicalClientStudent = createFirestoreCanonicalClientStudentScopeResolver();
async function requireStudentScope(
  request: CallableRequest<unknown>,
  studentId: string,
  options: StudentScopeOptions,
): Promise<void> {
  const actor = requireUserActor(request);
  if (staffRoles.includes(actor.role as (typeof staffRoles)[number])) return;
  if (
    (actor.role === "guardian" || actor.role === "adultStudent") &&
    (await (options.resolveClientStudentScope ?? resolveCanonicalClientStudent)({
      academyId: actor.academyId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      requestedStudentId: studentId,
    }))
  ) {
    return;
  }
  throw new HttpsError("permission-denied", "Access denied for this student");
}

function mapBookingError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof BookingTransactionError) {
    if (error.code === "invalid") {
      throw new HttpsError("invalid-argument", "Booking request is invalid");
    }
    if (error.code === "tenant") {
      throw new HttpsError("permission-denied", "Booking access is not permitted");
    }
    if (error.code === "not-found") {
      throw new HttpsError("not-found", "Booking resource is not available");
    }
    if (error.code === "capacity") {
      throw new HttpsError("failed-precondition", "Session capacity is no longer available", {
        reason: error.code,
      });
    }
    if (error.code === "financial") {
      throw new HttpsError("failed-precondition", "Booking is not available for this account", {
        reason: error.code,
      });
    }
    throw new HttpsError("failed-precondition", "Booking is not available", {
      reason: error.code,
    });
  }
  throw new HttpsError("internal", "Booking operation failed");
}

function mapAttendanceError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof ScheduleAttendanceError) {
    if (error.code === "invalid") {
      throw new HttpsError("invalid-argument", "Attendance request is invalid");
    }
    if (error.code === "credential" || error.code === "tenant") {
      throw new HttpsError("permission-denied", "Attendance operation is not permitted");
    }
    if (error.code === "not-found") {
      throw new HttpsError("not-found", "Attendance resource is not available");
    }
    throw new HttpsError("failed-precondition", "Attendance operation is not available", {
      reason: error.code,
    });
  }
  throw new HttpsError("internal", "Attendance operation failed");
}

export function createListScheduleCatalogHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const [locations, programs] = await Promise.all([
      store.listLocations(actor.academyId),
      store.listPrograms(actor.academyId),
    ]);

    return {
      locations,
      programs,
    };
  };
}

export function createSaveProgramHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!adminRoles.includes(actor.role as (typeof adminRoles)[number])) {
      throw new HttpsError("permission-denied", "Administrator access required to manage programs");
    }

    const parsed = parseCreateProgramInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", parsed.error);
    }

    const created = await store.createProgram(actor.academyId, parsed.value);
    return {
      program: created,
    };
  };
}

export function createListClassesHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError("permission-denied", "Staff access required");
    }

    const classes = await store.listClasses(actor.academyId);
    return {
      classes,
    };
  };
}

export function createListSessionsHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const parsedQuery = parseListSessionsQuery(request.data);
    if (!parsedQuery.ok) {
      throw new HttpsError("invalid-argument", parsedQuery.error);
    }

    const sessions = await store.listSessions(actor.academyId, parsedQuery.value);
    return {
      sessions,
    };
  };
}

export function createGetDailyOperationsDashboardHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Staff access required to view the daily operations dashboard",
      );
    }

    const parsedQuery = parseListSessionsQuery(request.data);
    if (!parsedQuery.ok) {
      throw new HttpsError("invalid-argument", parsedQuery.error);
    }

    const requestedRangeMs = Date.parse(parsedQuery.value.to) - Date.parse(parsedQuery.value.from);
    if (requestedRangeMs > 24 * 60 * 60 * 1000) {
      throw new HttpsError(
        "invalid-argument",
        "Daily operations dashboard range cannot exceed 24 hours",
      );
    }

    const dashboard = await store.getDailyOperationsDashboard(actor.academyId, parsedQuery.value);
    return { dashboard };
  };
}

export function createSaveClassHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!managerRoles.includes(actor.role as (typeof managerRoles)[number])) {
      throw new HttpsError("permission-denied", "Manager access required to configure classes");
    }

    const parsed = parseCreateClassInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", parsed.error);
    }

    const created = await store.createClass(actor.academyId, parsed.value, actor.userId);
    return {
      class: created,
    };
  };
}

export function createUpdateClassHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!managerRoles.includes(actor.role as (typeof managerRoles)[number])) {
      throw new HttpsError("permission-denied", "Manager access required to configure classes");
    }

    const parsed = parseUpdateClassInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", parsed.error);
    }

    const updated = await store.updateClass(actor.academyId, parsed.value, actor.userId);
    return { class: updated };
  };
}

export function createGenerateSessionsHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!managerRoles.includes(actor.role as (typeof managerRoles)[number])) {
      throw new HttpsError("permission-denied", "Manager access required to generate sessions");
    }

    const data = request.data as {
      classId?: unknown;
      fromDate?: unknown;
      toDate?: unknown;
      timezone?: unknown;
    };

    if (!data || typeof data.classId !== "string" || !data.classId.trim()) {
      throw new HttpsError("invalid-argument", "classId is required");
    }
    if (typeof data.fromDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(data.fromDate)) {
      throw new HttpsError("invalid-argument", "fromDate must be YYYY-MM-DD");
    }
    if (typeof data.toDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(data.toDate)) {
      throw new HttpsError("invalid-argument", "toDate must be YYYY-MM-DD");
    }

    const timezone =
      typeof data.timezone === "string" && data.timezone.trim()
        ? data.timezone.trim()
        : "Europe/Jersey";

    const sessions = await store.generateSessions(
      actor.academyId,
      data.classId.trim(),
      data.fromDate,
      data.toDate,
      timezone,
      actor.userId,
    );

    return {
      sessions,
    };
  };
}

export function createSaveSessionHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!managerRoles.includes(actor.role as (typeof managerRoles)[number])) {
      throw new HttpsError("permission-denied", "Manager access required to schedule sessions");
    }

    const parsed = parseCreateSessionInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", parsed.error);
    }

    const created = await store.createSession(actor.academyId, parsed.value, actor.userId);
    return {
      session: created,
    };
  };
}

export function createCancelSessionHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError("permission-denied", "Staff access required to cancel sessions");
    }

    const data = request.data as { sessionId?: unknown; reason?: unknown };
    if (!data || typeof data.sessionId !== "string" || !data.sessionId.trim()) {
      throw new HttpsError("invalid-argument", "sessionId is required");
    }

    const reason =
      typeof data.reason === "string" && data.reason.trim()
        ? data.reason.trim()
        : "Cancelled by staff";
    const cancelled = await store.cancelSession(
      actor.academyId,
      data.sessionId.trim(),
      reason,
      actor.userId,
    );

    return {
      session: cancelled,
    };
  };
}

export function createRequestBookingHandler(options: StudentScopeOptions) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const parsed = parseRequestBookingInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", parsed.error);
    }

    await requireStudentScope(request, parsed.value.studentId, options);

    try {
      const booking = await store.requestBooking(actor.academyId, parsed.value, actor.userId);
      return {
        booking,
      };
    } catch (error) {
      return mapBookingError(error);
    }
  };
}

export function createCancelBookingHandler(options: StudentScopeOptions) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const parsed = parseCancelBookingInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", parsed.error);
    }

    const isStaff = staffRoles.includes(actor.role as (typeof staffRoles)[number]);

    await requireStudentScope(request, parsed.value.studentId, options);

    const booking = await store.cancelBooking(actor.academyId, parsed.value, actor.userId, isStaff);

    return {
      booking,
    };
  };
}

export function createListSessionBookingsHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError("permission-denied", "Staff access required to view session roster");
    }

    const data = request.data as { sessionId?: unknown };
    if (!data || typeof data.sessionId !== "string" || !data.sessionId.trim()) {
      throw new HttpsError("invalid-argument", "sessionId is required");
    }

    const bookings = await store.listSessionBookings(actor.academyId, data.sessionId.trim());
    return {
      bookings,
    };
  };
}

export function createListStudentBookingsHandler(options: StudentScopeOptions) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const data = request.data as { studentId?: unknown };
    const studentId =
      typeof data?.studentId === "string" && data.studentId.trim()
        ? data.studentId.trim()
        : actor.userId;

    await requireStudentScope(request, studentId, options);

    const bookings = await store.listStudentBookings(actor.academyId, studentId);
    return {
      bookings,
    };
  };
}

export function createEvaluateSessionMinimumHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError("permission-denied", "Staff access required");
    }

    const data = request.data as { sessionId?: unknown };
    if (!data || typeof data.sessionId !== "string" || !data.sessionId.trim()) {
      throw new HttpsError("invalid-argument", "sessionId is required");
    }

    const result = await store.evaluateSessionMinimum(actor.academyId, data.sessionId.trim());
    return {
      result,
    };
  };
}

export function createCheckInHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const parsed = parseCheckInInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", parsed.error);
    }

    const isStaff = staffRoles.includes(actor.role as (typeof staffRoles)[number]);
    if (!isStaff) {
      throw new HttpsError("permission-denied", "Staff access is required for check-in");
    }
    if (parsed.value.method !== "manual") {
      throw new HttpsError(
        "failed-precondition",
        "QR, PIN, and name-search check-in require a verified academy credential",
      );
    }

    let attendance: Awaited<ReturnType<ScheduleStore["recordCheckIn"]>>;
    try {
      attendance = await store.recordCheckIn(
        actor.academyId,
        parsed.value,
        actor.userId,
        undefined,
        actor.role as ScheduleMutationActorRole,
      );
    } catch (error) {
      return mapAttendanceError(error);
    }

    return {
      attendance,
    };
  };
}

export function createListSessionAttendanceHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError("permission-denied", "Staff access required to view session attendance");
    }

    const data = request.data as { sessionId?: unknown };
    if (!data || typeof data.sessionId !== "string" || !data.sessionId.trim()) {
      throw new HttpsError("invalid-argument", "sessionId is required");
    }

    const attendance = await store.listSessionAttendance(actor.academyId, data.sessionId.trim());
    return {
      attendance,
    };
  };
}

export function createListStudentAttendanceHandler(options: StudentScopeOptions) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const data = request.data as { studentId?: unknown };
    const studentId =
      typeof data?.studentId === "string" && data.studentId.trim()
        ? data.studentId.trim()
        : actor.userId;

    await requireStudentScope(request, studentId, options);

    const attendance = await store.listStudentAttendance(actor.academyId, studentId);
    return {
      attendance,
    };
  };
}

export function createCorrectAttendanceHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError("permission-denied", "Staff access required to correct attendance");
    }

    const parsed = parseCorrectAttendanceInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", parsed.error);
    }

    let result: Awaited<ReturnType<ScheduleStore["correctAttendance"]>>;
    try {
      result = await store.correctAttendance(
        actor.academyId,
        parsed.value,
        actor.userId,
        undefined,
        actor.role as ScheduleMutationActorRole,
      );
    } catch (error) {
      return mapAttendanceError(error);
    }

    return result;
  };
}

export function createReconcileSessionNoShowsHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Staff access required to reconcile session no-shows",
      );
    }

    const data = request.data as { sessionId?: unknown };
    if (!data || typeof data.sessionId !== "string" || !data.sessionId.trim()) {
      throw new HttpsError("invalid-argument", "sessionId is required");
    }

    const result = await store.reconcileSessionNoShows(
      actor.academyId,
      data.sessionId.trim(),
      actor.userId,
    );

    return result;
  };
}

export function createListAttendanceHistoryHandler(options: StudentScopeOptions) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const data = request.data as { sessionId?: unknown; studentId?: unknown };

    if (!data || typeof data.sessionId !== "string" || !data.sessionId.trim()) {
      throw new HttpsError("invalid-argument", "sessionId is required");
    }

    const studentId =
      typeof data.studentId === "string" && data.studentId.trim()
        ? data.studentId.trim()
        : actor.userId;

    await requireStudentScope(request, studentId, options);

    const history = await store.listAttendanceHistory(
      actor.academyId,
      data.sessionId.trim(),
      studentId,
    );

    return {
      history,
    };
  };
}

export function createRecordCheckoutHandler(options: StudentScopeOptions) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const parsed = parseRecordCheckoutInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", parsed.error);
    }

    const isStaff = staffRoles.includes(actor.role as (typeof staffRoles)[number]);

    if (parsed.value.method === "staffOverride" && !isStaff) {
      throw new HttpsError("permission-denied", "Staff access required for staffOverride checkout");
    }
    if (
      parsed.value.method === "staffOverride" &&
      (parsed.value.notes === undefined ||
        parsed.value.notes.length < 2 ||
        parsed.value.notes.length > 200)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "A staff override reason between 2 and 200 characters is required",
      );
    }
    if (parsed.value.method === "independentRelease") {
      throw new HttpsError(
        "failed-precondition",
        "Independent release requires verified policy evidence",
      );
    }
    if (actor.role === "adultStudent") {
      throw new HttpsError(
        "permission-denied",
        "Adult student checkout is not enabled until the policy is approved",
      );
    }
    if (!isStaff) await requireStudentScope(request, parsed.value.studentId, options);

    let checkout: Awaited<ReturnType<ScheduleStore["recordCheckout"]>>;
    try {
      checkout = await store.recordCheckout(
        actor.academyId,
        parsed.value,
        actor.userId,
        undefined,
        actor.role as ScheduleMutationActorRole,
      );
    } catch (error) {
      return mapAttendanceError(error);
    }

    return {
      checkout,
    };
  };
}

export function createListSessionCheckoutsHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError("permission-denied", "Staff access required to list session checkouts");
    }

    const data = request.data as { sessionId?: unknown };
    if (!data || typeof data.sessionId !== "string" || !data.sessionId.trim()) {
      throw new HttpsError("invalid-argument", "sessionId is required");
    }

    const checkouts = await store.listSessionCheckouts(actor.academyId, data.sessionId.trim());
    return {
      checkouts,
    };
  };
}

export function createGetStudentCheckoutHandler(options: StudentScopeOptions) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const data = request.data as { sessionId?: unknown; studentId?: unknown };

    if (!data || typeof data.sessionId !== "string" || !data.sessionId.trim()) {
      throw new HttpsError("invalid-argument", "sessionId is required");
    }

    const studentId =
      typeof data.studentId === "string" && data.studentId.trim()
        ? data.studentId.trim()
        : actor.userId;

    await requireStudentScope(request, studentId, options);

    const checkout = await store.getStudentCheckout(
      actor.academyId,
      data.sessionId.trim(),
      studentId,
    );
    return {
      checkout,
    };
  };
}

export function createGetSessionOperationalViewHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Staff access required to view live operational roster",
      );
    }

    const data = request.data as { sessionId?: unknown };
    if (!data || typeof data.sessionId !== "string" || !data.sessionId.trim()) {
      throw new HttpsError("invalid-argument", "sessionId is required");
    }

    const view = await store.getSessionOperationalView(actor.academyId, data.sessionId.trim());
    return {
      view,
    };
  };
}

let defaultStore: ScheduleStore | undefined;

function getStore(): ScheduleStore {
  if (!defaultStore) {
    const firestore = getFirestore();
    defaultStore = createFirestoreScheduleStore({
      firestore: firestore as unknown as Parameters<
        typeof createFirestoreScheduleStore
      >[0]["firestore"],
    });
  }
  return defaultStore;
}

function getStudentScopeOptions(): StudentScopeOptions {
  return {
    store: getStore(),
    resolveClientStudentScope: resolveCanonicalClientStudent,
  };
}

export const listScheduleCatalog = onCall(scheduleCallableOptions, async (request) =>
  createListScheduleCatalogHandler({ store: getStore() })(request),
);

export const saveProgram = onCall(scheduleCallableOptions, async (request) =>
  createSaveProgramHandler({ store: getStore() })(request),
);

export const listClasses = onCall(scheduleCallableOptions, async (request) =>
  createListClassesHandler({ store: getStore() })(request),
);

export const listSessions = onCall(scheduleCallableOptions, async (request) =>
  createListSessionsHandler({ store: getStore() })(request),
);

export const getDailyOperationsDashboard = onCall(scheduleCallableOptions, async (request) =>
  createGetDailyOperationsDashboardHandler({ store: getStore() })(request),
);

export const saveClass = onCall(scheduleCallableOptions, async (request) =>
  createSaveClassHandler({ store: getStore() })(request),
);

export const updateClass = onCall(scheduleCallableOptions, async (request) =>
  createUpdateClassHandler({ store: getStore() })(request),
);

export const generateSessions = onCall(scheduleCallableOptions, async (request) =>
  createGenerateSessionsHandler({ store: getStore() })(request),
);

export const saveSession = onCall(scheduleCallableOptions, async (request) =>
  createSaveSessionHandler({ store: getStore() })(request),
);

export const cancelSession = onCall(scheduleCallableOptions, async (request) =>
  createCancelSessionHandler({ store: getStore() })(request),
);

export const requestBooking = onCall(scheduleCallableOptions, async (request) =>
  createRequestBookingHandler(getStudentScopeOptions())(request),
);

export const cancelBooking = onCall(scheduleCallableOptions, async (request) =>
  createCancelBookingHandler(getStudentScopeOptions())(request),
);

export const listSessionBookings = onCall(scheduleCallableOptions, async (request) =>
  createListSessionBookingsHandler({ store: getStore() })(request),
);

export const listStudentBookings = onCall(scheduleCallableOptions, async (request) =>
  createListStudentBookingsHandler(getStudentScopeOptions())(request),
);

export const evaluateSessionMinimum = onCall(scheduleCallableOptions, async (request) =>
  createEvaluateSessionMinimumHandler({ store: getStore() })(request),
);

export const checkIn = onCall(scheduleCallableOptions, async (request) =>
  createCheckInHandler({ store: getStore() })(request),
);

export const listSessionAttendance = onCall(scheduleCallableOptions, async (request) =>
  createListSessionAttendanceHandler({ store: getStore() })(request),
);

export const listStudentAttendance = onCall(scheduleCallableOptions, async (request) =>
  createListStudentAttendanceHandler(getStudentScopeOptions())(request),
);

export const correctAttendance = onCall(scheduleCallableOptions, async (request) =>
  createCorrectAttendanceHandler({ store: getStore() })(request),
);

export const reconcileSessionNoShows = onCall(scheduleCallableOptions, async (request) =>
  createReconcileSessionNoShowsHandler({ store: getStore() })(request),
);

export const listAttendanceHistory = onCall(scheduleCallableOptions, async (request) =>
  createListAttendanceHistoryHandler(getStudentScopeOptions())(request),
);

export const recordCheckout = onCall(scheduleCallableOptions, async (request) =>
  createRecordCheckoutHandler(getStudentScopeOptions())(request),
);

export const listSessionCheckouts = onCall(scheduleCallableOptions, async (request) =>
  createListSessionCheckoutsHandler({ store: getStore() })(request),
);

export const getStudentCheckout = onCall(scheduleCallableOptions, async (request) =>
  createGetStudentCheckoutHandler(getStudentScopeOptions())(request),
);

export const getSessionOperationalView = onCall(scheduleCallableOptions, async (request) =>
  createGetSessionOperationalViewHandler({ store: getStore() })(request),
);
