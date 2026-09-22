import { sessionRegistrations } from "./session-registrations.js";
import { createFirestoreMemberAccessService } from "../members/member-access-service.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { requireCourseActor } from "../courses/course-authorization.js";
import { requireCourseRosterAccess } from "../courses/course-roster.js";
import { courseRecordIdSchema } from "@bpt-jersey/domain/courses";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import {
  parseBulkBookEligibleSessionsInput,
  parseCancelBookingInput,
  parseCheckInInput,
  parseCorrectAttendanceInput,
  parseCreateClassInput,
  parseCreateProgramInput,
  parseCreateSessionInput,
  parseListSessionsQuery,
  parseRecordCheckoutInput,
  parseRemoveClassInput,
  parseRequestBookingInput,
  parseSaveLocationGeofenceInput,
  parseUpdateClassInput,
  parseUpdateSessionInput,
  sessionAccessMode,
  type AttendanceRecord,
  type BulkBookEligibleSessionsResult,
} from "@bpt-jersey/domain/schedule";
import { parseSelfCheckInInput } from "@bpt-jersey/domain/schedule/self-check-in";
import {
  parseCopyWeekInput,
  parseCreateLocationInput,
  parseCreateProgramInputV2,
  parseDeleteWeekInput,
  parseDeleteProgramInput,
  parseUpdateLocationInput,
  parseUpdateProgramInput,
  weekRangeFor,
} from "@bpt-jersey/domain/schedule/classes-services";

import { clientIpFromRequest } from "../audit/client-ip.js";
import { requireUserActor } from "../auth/user-authorization.js";
import { BookingTransactionError, type BookingFirestore } from "./booking-transaction-service.js";
import {
  requestIntroBooking as requestIntroBookingTransaction,
  type IntroBookingCommand,
} from "./intro-booking-service.js";
import { SessionQuorumSweepError } from "./quorum-sweep-service.js";
import {
  ScheduleAttendanceError,
  SelfCheckInRefusedError,
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
  requestIntroBooking?: (
    command: IntroBookingCommand,
  ) => ReturnType<typeof requestIntroBookingTransaction>;
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
async function requestedMemberStudentId(
  request: CallableRequest<unknown>,
  value: unknown,
): Promise<string> {
  if (typeof value === "string" && value.trim()) return value.trim();
  const actor = await requireMemberAccountActor(request);
  const own = (
    await createFirestoreMemberAccessService().listProfiles(actor.academyId, actor.userId)
  ).find((profile) => profile.via === "self");
  if (!own) throw new HttpsError("invalid-argument", "Select a member profile");
  return own.studentId;
}

export async function requireStudentScope(
  request: CallableRequest<unknown>,
  studentId: string,
  options: StudentScopeOptions,
): Promise<void> {
  const actor = requireUserActor(request);
  if (staffRoles.includes(actor.role as (typeof staffRoles)[number])) return;
  await requireMemberAccountActor(request);
  if (
    (actor.role === "guardian" || actor.role === "adultStudent" || actor.role === "teenStudent") &&
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

function mapQuorumSweepError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof SessionQuorumSweepError) {
    if (error.code === "invalid") {
      throw new HttpsError("invalid-argument", "Quorum sweep request is invalid");
    }
    if (error.code === "tenant") {
      throw new HttpsError("permission-denied", "Quorum sweep is not permitted");
    }
    if (error.code === "not-found") {
      throw new HttpsError("not-found", "Session is not available");
    }
    throw new HttpsError("failed-precondition", "Quorum sweep is not available", {
      reason: error.code,
    });
  }
  throw new HttpsError("internal", "Quorum sweep failed");
}

function mapAttendanceError(error: unknown): never {
  if (error instanceof HttpsError) throw error;
  if (error instanceof ScheduleAttendanceError) {
    if (error.code === "payment") throw new HttpsError("failed-precondition", "Confirm payment for this class before recording attendance.", { reason: "payment" });
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

function mapSelfCheckInError(error: unknown): never {
  if (error instanceof SelfCheckInRefusedError) {
    throw new HttpsError("failed-precondition", "Self check-in is not available right now", {
      reason: error.reason,
      ...(error.distanceMeters === undefined ? {} : { distanceMeters: error.distanceMeters }),
    });
  }
  if (!(error instanceof HttpsError) && !(error instanceof ScheduleAttendanceError)) {
    console.error("self check-in failed");
  }
  return mapAttendanceError(error);
}

function mapScheduleMutationError(
  error: unknown,
  resource: "Session" | "Class" | "Location" | "Program",
): never {
  if (error instanceof HttpsError) throw error;
  const message = error instanceof Error ? error.message : "";
  if (/does not exist/u.test(message)) {
    throw new HttpsError("not-found", `${resource} not found`);
  }
  if (
    /Only scheduled sessions|must end after|cannot exceed capacity|Choose this and following sessions/u.test(
      message,
    )
  ) {
    throw new HttpsError("failed-precondition", message);
  }
  console.error(`schedule ${resource.toLowerCase()} mutation failed`, error);
  throw new HttpsError("internal", `Unable to update the ${resource.toLowerCase()}`);
}

function requireManager(request: CallableRequest<unknown>, purpose: string) {
  const actor = requireUserActor(request);
  if (!managerRoles.includes(actor.role as (typeof managerRoles)[number])) {
    throw new HttpsError("permission-denied", `Manager access required to ${purpose}`);
  }
  return actor;
}

async function academyTimezone(store: ScheduleStore, academyId: string): Promise<string> {
  const locations = await store.listLocations(academyId);
  return locations.find((l) => l.active)?.timezone ?? "Europe/Jersey";
}

function mapWeekError(
  error: unknown,
  fallbackMessage = "Unable to complete the week operation",
): never {
  if (error instanceof HttpsError) throw error;
  const message = error instanceof Error ? error.message : "";
  if (/must be a Monday|YYYY-MM-DD|not a valid date/u.test(message)) {
    throw new HttpsError("invalid-argument", message);
  }
  if (/needs a capacity/u.test(message)) {
    throw new HttpsError("failed-precondition", message, { reason: "capacity-not-set" });
  }
  console.error("week operation failed", error);
  throw new HttpsError("internal", fallbackMessage);
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

/**
 * Records or clears the coordinates of one academy site. Administration only: these coordinates are
 * what makes the 50 m check-in eligibility signal answerable, and no member coordinate is involved
 * at any point (T109, BRIEF decision 5).
 */
export function createSaveLocationGeofenceHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!adminRoles.includes(actor.role as (typeof adminRoles)[number])) {
      throw new HttpsError(
        "permission-denied",
        "Administrator access required to manage site coordinates",
      );
    }
    const parsed = parseSaveLocationGeofenceInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", parsed.error);
    }
    return {
      location: await store.saveLocationGeofence(actor.academyId, parsed.value, actor.userId),
    };
  };
}

export function createSaveProgramHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!managerRoles.includes(actor.role as (typeof managerRoles)[number])) {
      throw new HttpsError("permission-denied", "Manager access required to manage programs");
    }

    const data = request.data;
    const isV2Shape =
      typeof data === "object" && data !== null && "abbreviation" in data && !("ageBand" in data);
    if (isV2Shape) {
      const parsedV2 = parseCreateProgramInputV2(data);
      if (!parsedV2.ok) throw new HttpsError("invalid-argument", parsedV2.error);
      const created = await store.createProgramV2(actor.academyId, parsedV2.value);
      return { program: created };
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

export function createSaveLocationHandler(options: { store: ScheduleStore }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireManager(request, "manage locations");
    const parsed = parseCreateLocationInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    return {
      location: await options.store.createLocation(actor.academyId, parsed.value, actor.userId),
    };
  };
}

export function createUpdateLocationHandler(options: { store: ScheduleStore }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireManager(request, "manage locations");
    const parsed = parseUpdateLocationInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    try {
      return {
        location: await options.store.updateLocation(actor.academyId, parsed.value, actor.userId),
      };
    } catch (error) {
      mapScheduleMutationError(error, "Location");
    }
  };
}

export function createUpdateProgramHandler(options: { store: ScheduleStore }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireManager(request, "manage class types");
    const parsed = parseUpdateProgramInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    try {
      return { program: await options.store.updateProgramV2(actor.academyId, parsed.value) };
    } catch (error) {
      mapScheduleMutationError(error, "Program");
    }
  };
}

export function createDeleteProgramHandler(options: { store: ScheduleStore }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!adminRoles.includes(actor.role as (typeof adminRoles)[number])) {
      throw new HttpsError("permission-denied", "Office access required to delete class types");
    }
    const parsed = parseDeleteProgramInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    try {
      return {
        program: await options.store.deleteProgram(
          actor.academyId,
          parsed.value.programId,
          actor.userId,
        ),
      };
    } catch (error) {
      mapScheduleMutationError(error, "Program");
    }
  };
}

export function createPreviewWeekHandler(options: { store: ScheduleStore }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireManager(request, "preview a week");
    const data = request.data;
    const weekStart =
      typeof data === "object" && data !== null
        ? (data as { weekStart?: unknown }).weekStart
        : undefined;
    if (typeof weekStart !== "string") {
      throw new HttpsError("invalid-argument", "weekStart must be YYYY-MM-DD");
    }
    const timezone = await academyTimezone(options.store, actor.academyId);
    const range = weekRangeFor(weekStart, timezone);
    if (!range.ok) throw new HttpsError("invalid-argument", range.error);
    try {
      return { preview: await options.store.previewWeek(actor.academyId, weekStart, timezone) };
    } catch (error) {
      mapWeekError(error);
    }
  };
}

export function createCopyWeekHandler(options: { store: ScheduleStore }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireManager(request, "copy a week");
    const parsed = parseCopyWeekInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    try {
      const timezone = await academyTimezone(options.store, actor.academyId);
      return {
        sessions: await options.store.copyWeek(
          actor.academyId,
          parsed.value,
          timezone,
          actor.userId,
        ),
      };
    } catch (error) {
      // A non-refusal error mid-copy (capacity/financial refusals are already swallowed by the
      // store) leaves the sessions created so far in place; the idempotence guard skips them on
      // a re-run, so the operator can simply try again.
      mapWeekError(error, "Copying the week stopped part-way; run it again to finish.");
    }
  };
}

export function createDeleteWeekHandler(options: { store: ScheduleStore }) {
  return async (request: CallableRequest<unknown>) => {
    const actor = requireManager(request, "delete a week");
    const parsed = parseDeleteWeekInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    try {
      const timezone = await academyTimezone(options.store, actor.academyId);
      return {
        sessions: await options.store.deleteWeek(
          actor.academyId,
          parsed.value,
          timezone,
          actor.userId,
        ),
      };
    } catch (error) {
      mapWeekError(error);
    }
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
    if (
      parsed.value.curriculum !== undefined &&
      actor.role !== "owner" &&
      actor.role !== "administrator"
    )
      throw new HttpsError("permission-denied", "Office access required to edit the curriculum");

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

export function createUpdateSessionHandler(options: { store: ScheduleStore }) {
  const { store } = options;
  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!managerRoles.includes(actor.role as (typeof managerRoles)[number])) {
      throw new HttpsError("permission-denied", "Manager access required to edit sessions");
    }
    const parsed = parseUpdateSessionInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    if (
      (parsed.value.locationId !== undefined || parsed.value.programId !== undefined) &&
      actor.role !== "owner" &&
      actor.role !== "administrator"
    )
      throw new HttpsError(
        "permission-denied",
        "Office access required to change session type or site",
      );
    if (
      parsed.value.curriculum !== undefined &&
      actor.role !== "owner" &&
      actor.role !== "administrator"
    )
      throw new HttpsError("permission-denied", "Office access required to edit the curriculum");
    try {
      return {
        session: await store.updateSession(
          actor.academyId,
          parsed.value,
          actor.userId,
          actor.role === "owner" || actor.role === "administrator",
        ),
      };
    } catch (error) {
      return mapScheduleMutationError(error, "Session");
    }
  };
}

export function createRemoveClassHandler(options: { store: ScheduleStore; now?: () => string }) {
  const { store } = options;
  const now = options.now ?? (() => new Date().toISOString());
  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!managerRoles.includes(actor.role as (typeof managerRoles)[number])) {
      throw new HttpsError("permission-denied", "Manager access required to remove classes");
    }
    const parsed = parseRemoveClassInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    try {
      return await store.removeClass(
        actor.academyId,
        parsed.value.classId,
        parsed.value.reason,
        actor.userId,
        now(),
      );
    } catch (error) {
      return mapScheduleMutationError(error, "Class");
    }
  };
}

export function createListSessionBookedCountsHandler(options: { store: ScheduleStore }) {
  const { store } = options;
  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const parsed = parseListSessionsQuery(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    const sessions = await store.listSessions(actor.academyId, parsed.value);
    const counts = await store.countConfirmedBookings(
      actor.academyId,
      sessions.map((session) => session.sessionId),
    );
    return { counts };
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
      const booking =
        parsed.value.kind === "intro"
          ? await (
              options.requestIntroBooking ??
              ((command) =>
                requestIntroBookingTransaction(
                  getFirestore() as unknown as BookingFirestore,
                  command,
                ))
            )({
              academyId: actor.academyId,
              actorId: actor.userId,
              actorRole: actor.role,
              actorIp: clientIpFromRequest(request),
              studentId: parsed.value.studentId,
              sessionId: parsed.value.sessionId,
              now: new Date().toISOString(),
            })
          : await store.requestBooking(actor.academyId, parsed.value, actor.userId, {
              ip: clientIpFromRequest(request),
              role: actor.role,
            });
      return {
        booking,
      };
    } catch (error) {
      return mapBookingError(error);
    }
  };
}

const bulkBookingCandidateLimit = 200;
const skippableBulkBookingCodes = new Set([
  "capacity",
  "capacity-not-set",
  "conflict",
  "financial",
  "ineligible",
  "not-found",
  "weekly-limit",
]);

export function createBulkBookEligibleSessionsHandler(options: StudentScopeOptions) {
  const { store } = options;
  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const parsed = parseBulkBookEligibleSessionsInput(request.data);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.error);
    await requireStudentScope(request, parsed.value.studentId, options);

    const [sessions, existing] = await Promise.all([
      store.listSessions(actor.academyId, { from: parsed.value.from, to: parsed.value.to }),
      store.listStudentBookings(actor.academyId, parsed.value.studentId),
    ]);
    const confirmed = new Set(
      existing
        .filter((booking) => booking.status === "confirmed")
        .map((booking) => booking.sessionId),
    );
    const candidates = sessions
      .filter(
        (session) =>
          !session.courseId &&
          sessionAccessMode(session) === "membership" &&
          (session.status === "scheduled" || session.status === "active") &&
          Date.parse(session.startAt) >= Date.parse(parsed.value.from),
      )
      .sort((left, right) => left.startAt.localeCompare(right.startAt));
    const selected = candidates.slice(0, bulkBookingCandidateLimit);
    const booked = [];
    let alreadyBookedCount = 0;
    let skippedCount = 0;

    for (const session of selected) {
      if (confirmed.has(session.sessionId)) {
        alreadyBookedCount += 1;
        continue;
      }
      try {
        booked.push(
          await store.requestBooking(
            actor.academyId,
            {
              kind: "membership",
              sessionId: session.sessionId,
              studentId: parsed.value.studentId,
              membershipId: parsed.value.membershipId,
            },
            actor.userId,
            { ip: clientIpFromRequest(request), role: actor.role },
          ),
        );
      } catch (error) {
        if (error instanceof BookingTransactionError && skippableBulkBookingCodes.has(error.code)) {
          skippedCount += 1;
          continue;
        }
        return mapBookingError(error);
      }
    }

    return {
      booked: Object.freeze(booked),
      bookedCount: booked.length,
      alreadyBookedCount,
      skippedCount,
      limited: candidates.length > bulkBookingCandidateLimit,
    } satisfies BulkBookEligibleSessionsResult;
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

    const booking = await store.cancelBooking(
      actor.academyId,
      parsed.value,
      actor.userId,
      isStaff,
      { ip: clientIpFromRequest(request), role: actor.role },
    );

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
    const studentId = await requestedMemberStudentId(request, data?.studentId);

    await requireStudentScope(request, studentId, options);

    const bookings = await store.listStudentBookings(actor.academyId, studentId);
    await requireStudentScope(request, studentId, options);
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
        clientIpFromRequest(request),
      );
    } catch (error) {
      return mapAttendanceError(error);
    }

    return {
      attendance,
    };
  };
}

/**
 * T040V2: members record their own attendance. The store judges the booking, server-time window,
 * and 50 m eligibility gate; this callable never stores, logs, audits, or echoes coordinates.
 */
export function createSelfCheckInHandler(options: StudentScopeOptions) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError("permission-denied", "Staff check in members from the coach screen");
    }
    const parsed = parseSelfCheckInInput(request.data);
    if (!parsed.ok) {
      throw new HttpsError("invalid-argument", "Self check-in request is invalid");
    }
    await requireStudentScope(request, parsed.value.studentId, options);

    try {
      const attendance = await store.recordSelfCheckIn(
        actor.academyId,
        parsed.value,
        actor.userId,
        undefined,
        actor.role as ScheduleMutationActorRole,
        clientIpFromRequest(request),
      );
      return { attendance };
    } catch (error) {
      return mapSelfCheckInError(error);
    }
  };
}

/**
 * T110: applies the quorum rule to one session. Staff only, and safe to repeat: the sweep writes only
 * while the session is still `scheduled`, so a second call reports the earlier cancellation instead
 * of touching anything (BRIEF decision 3).
 */
export function createReconcileSessionQuorumHandler(options: { store: ScheduleStore }) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    if (!staffRoles.includes(actor.role as (typeof staffRoles)[number])) {
      throw new HttpsError("permission-denied", "Staff access required to reconcile quorum");
    }
    const data = request.data as { sessionId?: unknown } | null;
    if (
      data === null ||
      typeof data !== "object" ||
      Object.keys(data).length !== 1 ||
      typeof data.sessionId !== "string" ||
      data.sessionId.trim().length === 0
    ) {
      throw new HttpsError("invalid-argument", "sessionId is required");
    }

    try {
      return {
        result: await store.reconcileSessionQuorum(
          actor.academyId,
          data.sessionId.trim(),
          actor.userId,
        ),
      };
    } catch (error) {
      return mapQuorumSweepError(error);
    }
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

/**
 * The proximity signal describes the staff device that recorded the check-in and may carry the
 * coach's free-text override reason. Members and guardians see the attendance, never the signal.
 */
export function attendanceForActor(
  actor: Readonly<{ role: string }>,
  records: readonly AttendanceRecord[],
): readonly AttendanceRecord[] {
  if (staffRoles.includes(actor.role as (typeof staffRoles)[number])) return records;
  return records.map((record) =>
    Object.freeze(
      Object.fromEntries(
        Object.entries(record).filter(([key]) => key !== "proximity"),
      ) as AttendanceRecord,
    ),
  );
}

export function createListStudentAttendanceHandler(options: StudentScopeOptions) {
  const { store } = options;

  return async (request: CallableRequest<unknown>) => {
    const actor = requireUserActor(request);
    const data = request.data as { studentId?: unknown };
    const studentId = await requestedMemberStudentId(request, data?.studentId);

    await requireStudentScope(request, studentId, options);

    const attendance = await store.listStudentAttendance(actor.academyId, studentId);
    await requireStudentScope(request, studentId, options);
    return {
      attendance: attendanceForActor(actor, attendance),
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
        clientIpFromRequest(request),
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

    const studentId = await requestedMemberStudentId(request, data.studentId);

    await requireStudentScope(request, studentId, options);

    const history = await store.listAttendanceHistory(
      actor.academyId,
      data.sessionId.trim(),
      studentId,
    );

    await requireStudentScope(request, studentId, options);
    return {
      history: attendanceForActor(actor, history),
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
    if (!isStaff) await requireStudentScope(request, parsed.value.studentId, options);

    let checkout: Awaited<ReturnType<ScheduleStore["recordCheckout"]>>;
    try {
      checkout = await store.recordCheckout(
        actor.academyId,
        parsed.value,
        actor.userId,
        undefined,
        actor.role as ScheduleMutationActorRole,
        clientIpFromRequest(request),
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

    const studentId = await requestedMemberStudentId(request, data.studentId);

    await requireStudentScope(request, studentId, options);

    const checkout = await store.getStudentCheckout(
      actor.academyId,
      data.sessionId.trim(),
      studentId,
    );
    await requireStudentScope(request, studentId, options);
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

export function getStudentScopeOptions(): StudentScopeOptions {
  return {
    store: getStore(),
    resolveClientStudentScope: resolveCanonicalClientStudent,
  };
}

export const listScheduleCatalog = onCall(scheduleCallableOptions, async (request) =>
  createListScheduleCatalogHandler({ store: getStore() })(request),
);

export const saveLocationGeofence = onCall(scheduleCallableOptions, async (request) =>
  createSaveLocationGeofenceHandler({ store: getStore() })(request),
);

export const saveProgram = onCall(scheduleCallableOptions, async (request) =>
  createSaveProgramHandler({ store: getStore() })(request),
);

export const listClasses = onCall(scheduleCallableOptions, async (request) =>
  createListClassesHandler({ store: getStore() })(request),
);

async function guardCourseStaffSession(request: CallableRequest<unknown>): Promise<void> {
  const actor = requireUserActor(request);
  if (!["owner", "administrator", "coach", "headCoach"].includes(actor.role)) return;
  const id = (request.data as { sessionId?: unknown } | null)?.sessionId;
  if (!courseRecordIdSchema.safeParse(id).success) return;
  const session = await getFirestore().doc(`academies/${actor.academyId}/sessions/${id}`).get();
  if (session.data()?.courseId)
    await requireCourseRosterAccess(getFirestore(), await requireCourseActor(request), String(id));
}
export const listSessions = onCall(scheduleCallableOptions, async (request) => {
  const result = await createListSessionsHandler({ store: getStore() })(request);
  const actor = requireUserActor(request);
  if (!["coach", "headCoach"].includes(actor.role)) return result;
  const courseActor = await requireCourseActor(request);
  // Course sessions are checked concurrently; a denied roster hides that session, order is kept.
  const allowed = await Promise.all(
    result.sessions.map(async (session) => {
      if (!session.courseId) return true;
      try {
        await requireCourseRosterAccess(getFirestore(), courseActor, session.sessionId);
        return true;
      } catch (error) {
        if (!(error instanceof HttpsError) || error.code !== "permission-denied") throw error;
        return false;
      }
    }),
  );
  return { sessions: result.sessions.filter((_, index) => allowed[index]) };
});

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

export const updateSession = onCall(scheduleCallableOptions, async (request) =>
  createUpdateSessionHandler({ store: getStore() })(request),
);

export const removeClass = onCall(scheduleCallableOptions, async (request) =>
  createRemoveClassHandler({ store: getStore() })(request),
);

export const listSessionBookedCounts = onCall(scheduleCallableOptions, async (request) =>
  createListSessionBookedCountsHandler({ store: getStore() })(request),
);

export const requestBooking = onCall(scheduleCallableOptions, async (request) =>
  createRequestBookingHandler(getStudentScopeOptions())(request),
);

export const bulkBookEligibleSessions = onCall(scheduleCallableOptions, async (request) =>
  createBulkBookEligibleSessionsHandler(getStudentScopeOptions())(request),
);

export const cancelBooking = onCall(scheduleCallableOptions, async (request) =>
  createCancelBookingHandler(getStudentScopeOptions())(request),
);

export const listSessionBookings = onCall(scheduleCallableOptions, async (request) => {
  await guardCourseStaffSession(request);
  const response = await createListSessionBookingsHandler({ store: getStore() })(request);
  const actor = requireUserActor(request);
  return { bookings: await sessionRegistrations(getFirestore(), actor.academyId, response.bookings) };
});

export const listStudentBookings = onCall(scheduleCallableOptions, async (request) =>
  createListStudentBookingsHandler(getStudentScopeOptions())(request),
);

export const evaluateSessionMinimum = onCall(scheduleCallableOptions, async (request) =>
  createEvaluateSessionMinimumHandler({ store: getStore() })(request),
);

export const checkIn = onCall(scheduleCallableOptions, async (request) => {
  await guardCourseStaffSession(request);
  return createCheckInHandler({ store: getStore() })(request);
});

export const selfCheckIn = onCall(scheduleCallableOptions, async (request) =>
  createSelfCheckInHandler({ store: getStore() })(request),
);

export const reconcileSessionQuorum = onCall(scheduleCallableOptions, async (request) =>
  createReconcileSessionQuorumHandler({ store: getStore() })(request),
);

export const listSessionAttendance = onCall(scheduleCallableOptions, async (request) => {
  await guardCourseStaffSession(request);
  return createListSessionAttendanceHandler({ store: getStore() })(request);
});

export const listStudentAttendance = onCall(scheduleCallableOptions, async (request) =>
  createListStudentAttendanceHandler(getStudentScopeOptions())(request),
);

export const correctAttendance = onCall(scheduleCallableOptions, async (request) => {
  await guardCourseStaffSession(request);
  return createCorrectAttendanceHandler({ store: getStore() })(request);
});

export const reconcileSessionNoShows = onCall(scheduleCallableOptions, async (request) => {
  await guardCourseStaffSession(request);
  return createReconcileSessionNoShowsHandler({ store: getStore() })(request);
});

export const listAttendanceHistory = onCall(scheduleCallableOptions, async (request) =>
  createListAttendanceHistoryHandler(getStudentScopeOptions())(request),
);

export const recordCheckout = onCall(scheduleCallableOptions, async (request) => {
  await guardCourseStaffSession(request);
  return createRecordCheckoutHandler(getStudentScopeOptions())(request);
});

export const listSessionCheckouts = onCall(scheduleCallableOptions, async (request) => {
  await guardCourseStaffSession(request);
  return createListSessionCheckoutsHandler({ store: getStore() })(request);
});

export const getStudentCheckout = onCall(scheduleCallableOptions, async (request) =>
  createGetStudentCheckoutHandler(getStudentScopeOptions())(request),
);

export const getSessionOperationalView = onCall(scheduleCallableOptions, async (request) => {
  await guardCourseStaffSession(request);
  return createGetSessionOperationalViewHandler({ store: getStore() })(request);
});

export const saveLocation = onCall(scheduleCallableOptions, async (request) =>
  createSaveLocationHandler({ store: getStore() })(request),
);

export const updateLocation = onCall(scheduleCallableOptions, async (request) =>
  createUpdateLocationHandler({ store: getStore() })(request),
);

export const updateProgram = onCall(scheduleCallableOptions, async (request) =>
  createUpdateProgramHandler({ store: getStore() })(request),
);

export const previewWeek = onCall(scheduleCallableOptions, async (request) =>
  createPreviewWeekHandler({ store: getStore() })(request),
);

export const copyWeek = onCall(scheduleCallableOptions, async (request) =>
  createCopyWeekHandler({ store: getStore() })(request),
);

export const deleteWeek = onCall(scheduleCallableOptions, async (request) =>
  createDeleteWeekHandler({ store: getStore() })(request),
);

export const deleteProgram = onCall(scheduleCallableOptions, async (request) =>
  createDeleteProgramHandler({ store: getStore() })(request),
);
