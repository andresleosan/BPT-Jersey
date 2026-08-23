import { getFirestore } from "firebase-admin/firestore";
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
} from "@bpt-jersey/domain/schedule";

import { requireUserActor } from "../auth/user-authorization.js";
import { createFirestoreScheduleStore, type ScheduleStore } from "./schedule-service.js";

const staffRoles = Object.freeze(["owner", "administrator", "headCoach", "coach"] as const);
const managerRoles = Object.freeze(["owner", "administrator", "headCoach"] as const);
const adminRoles = Object.freeze(["owner", "administrator"] as const);

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

export function createRequestBookingHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const parsed = parseRequestBookingInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", parsed.error);
    }

    if (actor.role === "adultStudent" && actor.userId !== parsed.value.studentId) {
      throw new HttpsError("permission-denied", "Access denied: cannot book for another student");
    }

    const booking = await store.requestBooking(actor.academyId, parsed.value, actor.userId);
    return {
      booking,
    };
  };
}

export function createCancelBookingHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const parsed = parseCancelBookingInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", parsed.error);
    }

    const isStaff = staffRoles.includes(actor.role as (typeof staffRoles)[number]);

    if (!isStaff && actor.role === "adultStudent" && actor.userId !== parsed.value.studentId) {
      throw new HttpsError(
        "permission-denied",
        "Access denied: cannot cancel another student's booking",
      );
    }

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

export function createListStudentBookingsHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const data = request.data as { studentId?: unknown };
    const studentId =
      typeof data?.studentId === "string" && data.studentId.trim()
        ? data.studentId.trim()
        : actor.userId;

    const isStaff = staffRoles.includes(actor.role as (typeof staffRoles)[number]);
    if (!isStaff && actor.role === "adultStudent" && actor.userId !== studentId) {
      throw new HttpsError(
        "permission-denied",
        "Access denied: cannot view another student's bookings",
      );
    }

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

    if ((parsed.value.method === "manual" || parsed.value.method === "nameSearch") && !isStaff) {
      throw new HttpsError(
        "permission-denied",
        "Staff access required for manual or nameSearch check-in",
      );
    }

    if (!isStaff && actor.role === "adultStudent" && actor.userId !== parsed.value.studentId) {
      throw new HttpsError(
        "permission-denied",
        "Access denied: cannot check in for another student",
      );
    }

    const attendance = await store.recordCheckIn(actor.academyId, parsed.value, actor.userId);

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

export function createListStudentAttendanceHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const data = request.data as { studentId?: unknown };
    const studentId =
      typeof data?.studentId === "string" && data.studentId.trim()
        ? data.studentId.trim()
        : actor.userId;

    const isStaff = staffRoles.includes(actor.role as (typeof staffRoles)[number]);
    if (!isStaff && actor.role === "adultStudent" && actor.userId !== studentId) {
      throw new HttpsError(
        "permission-denied",
        "Access denied: cannot view another student's attendance",
      );
    }

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

    const result = await store.correctAttendance(actor.academyId, parsed.value, actor.userId);

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

export function createListAttendanceHistoryHandler(options: { store: ScheduleStore }) {
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

    const isStaff = staffRoles.includes(actor.role as (typeof staffRoles)[number]);
    if (!isStaff && actor.role === "adultStudent" && actor.userId !== studentId) {
      throw new HttpsError(
        "permission-denied",
        "Access denied: cannot view another student's attendance history",
      );
    }

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

export function createRecordCheckoutHandler(options: { store: ScheduleStore }) {
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

    const checkout = await store.recordCheckout(actor.academyId, parsed.value, actor.userId);

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

export function createGetStudentCheckoutHandler(options: { store: ScheduleStore }) {
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

export const listScheduleCatalog = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createListScheduleCatalogHandler({ store: getStore() })(request),
);

export const saveProgram = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createSaveProgramHandler({ store: getStore() })(request),
);

export const listClasses = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createListClassesHandler({ store: getStore() })(request),
);

export const listSessions = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createListSessionsHandler({ store: getStore() })(request),
);

export const saveClass = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createSaveClassHandler({ store: getStore() })(request),
);

export const generateSessions = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createGenerateSessionsHandler({ store: getStore() })(request),
);

export const saveSession = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createSaveSessionHandler({ store: getStore() })(request),
);

export const cancelSession = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createCancelSessionHandler({ store: getStore() })(request),
);

export const requestBooking = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createRequestBookingHandler({ store: getStore() })(request),
);

export const cancelBooking = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createCancelBookingHandler({ store: getStore() })(request),
);

export const listSessionBookings = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createListSessionBookingsHandler({ store: getStore() })(request),
);

export const listStudentBookings = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createListStudentBookingsHandler({ store: getStore() })(request),
);

export const evaluateSessionMinimum = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createEvaluateSessionMinimumHandler({ store: getStore() })(request),
);

export const checkIn = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createCheckInHandler({ store: getStore() })(request),
);

export const listSessionAttendance = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createListSessionAttendanceHandler({ store: getStore() })(request),
);

export const listStudentAttendance = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createListStudentAttendanceHandler({ store: getStore() })(request),
);

export const correctAttendance = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createCorrectAttendanceHandler({ store: getStore() })(request),
);

export const reconcileSessionNoShows = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createReconcileSessionNoShowsHandler({ store: getStore() })(request),
);

export const listAttendanceHistory = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createListAttendanceHistoryHandler({ store: getStore() })(request),
);

export const recordCheckout = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createRecordCheckoutHandler({ store: getStore() })(request),
);

export const listSessionCheckouts = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createListSessionCheckoutsHandler({ store: getStore() })(request),
);

export const getStudentCheckout = onCall(
  { enforceAppCheck: false, consumeAppCheckToken: false },
  async (request) => createGetStudentCheckoutHandler({ store: getStore() })(request),
);
