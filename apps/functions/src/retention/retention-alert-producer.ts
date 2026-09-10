import { createHash } from "node:crypto";

import { parseAuditEventDraft } from "@bpt-jersey/domain/audit";
import {
  buildRetentionAlerts,
  type RetentionAttendanceEntry,
  type RetentionPolicy,
  type RetentionStudentSnapshot,
} from "@bpt-jersey/domain/retention";
import { buildAttendanceId } from "@bpt-jersey/domain/schedule";
import {
  buildRetentionProductionAuditEventId,
  type RetentionAlertStore,
  type RetentionProductionAudit,
} from "./retention-alert-service.js";

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const storageKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const studentLimit = 200;
const attendanceLimit = 5_000;
const alertLimit = 200;
const dayMs = 24 * 60 * 60 * 1_000;
const snapshotKeys = Object.freeze([
  "academyId",
  "studentId",
  "active",
  "hasActiveMembership",
  "membershipStartsAt",
  "membershipEndsAt",
  "attendance",
] as const);
const attendanceKeys = Object.freeze(["state", "occurredAt"] as const);
const membershipProjectionFields = Object.freeze([
  "membershipId",
  "academyId",
  "studentId",
  "status",
  "startsAt",
  "endsAt",
] as const);
const studentProjectionFields = Object.freeze([
  "studentId",
  "academyId",
  "active",
  "status",
] as const);
const attendanceProjectionFields = Object.freeze([
  "attendanceId",
  "academyId",
  "sessionId",
  "studentId",
  "state",
  "occurredAt",
  "correctionOf",
  "schemaVersion",
] as const);
const projectedAttendanceStates = new Set<RetentionAttendanceEntry["state"]>([
  "attended",
  "late",
  "absent",
  "no_show",
]);
const sourceAttendanceStates = new Set([...projectedAttendanceStates, "excused"]);

export class RetentionAlertProducerError extends Error {
  public readonly code: "invalid" | "tenant" | "limit" | "source";

  public constructor(code: "invalid" | "tenant" | "limit" | "source", message: string) {
    super(message);
    this.name = "RetentionAlertProducerError";
    this.code = code;
  }
}

export type RetentionSnapshotSource = Readonly<{
  loadSnapshots: (input: {
    academyId: string;
    effectiveAt: string;
    lookbackDays: number;
  }) => Promise<unknown>;
}>;

export type RetentionAlertProducer = Readonly<{
  produce: (input: { academyId: string; runDate: string; policy: RetentionPolicy }) => Promise<
    Readonly<{
      runId: string;
      runDate: string;
      effectiveAt: string;
      sourceHash: string;
      evaluatedStudents: number;
      alertCount: number;
      created: number;
      unchanged: number;
      replayed: boolean;
    }>
  >;
}>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === "string" && keys.includes(key))
  );
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isStorageKey(value: unknown): value is string {
  return typeof value === "string" && storageKeyPattern.test(value);
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp = Date.parse(value + "T00:00:00.000Z");
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function isDateTime(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !dateTimePattern.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (match === null) return false;
  const date = new Date(0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function canonicalizeSnapshots(
  raw: unknown,
  academyId: string,
  effectiveAt: string,
  lookbackDays: number,
): readonly RetentionStudentSnapshot[] {
  if (!Array.isArray(raw)) {
    throw new RetentionAlertProducerError("source", "Retention source result is invalid");
  }
  if (raw.length > studentLimit) {
    throw new RetentionAlertProducerError("limit", "Retention student limit exceeded");
  }
  const effectiveMs = Date.parse(effectiveAt);
  const lookbackCutoff = effectiveMs - lookbackDays * dayMs;
  const seen = new Set<string>();
  let attendanceCount = 0;
  const snapshots = raw.map((candidate) => {
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, snapshotKeys)) {
      throw new RetentionAlertProducerError("invalid", "Retention snapshot is not minimal");
    }
    if (candidate.academyId !== academyId) {
      throw new RetentionAlertProducerError("tenant", "Retention snapshot tenant mismatch");
    }
    if (
      !isIdentifier(candidate.studentId) ||
      candidate.active !== true ||
      candidate.hasActiveMembership !== true ||
      !isDateTime(candidate.membershipStartsAt) ||
      (candidate.membershipEndsAt !== null && !isDateTime(candidate.membershipEndsAt)) ||
      !Array.isArray(candidate.attendance)
    ) {
      throw new RetentionAlertProducerError("invalid", "Retention snapshot is invalid");
    }
    attendanceCount += candidate.attendance.length;
    if (attendanceCount > attendanceLimit) {
      throw new RetentionAlertProducerError("limit", "Retention attendance limit exceeded");
    }
    if (
      Date.parse(candidate.membershipStartsAt) > effectiveMs ||
      (candidate.membershipEndsAt !== null && Date.parse(candidate.membershipEndsAt) <= effectiveMs)
    ) {
      throw new RetentionAlertProducerError("source", "Retention membership is not current");
    }
    if (seen.has(candidate.studentId)) {
      throw new RetentionAlertProducerError("source", "Retention student is duplicated");
    }
    seen.add(candidate.studentId);
    const attendance = candidate.attendance
      .map((entry) => {
        if (
          !isPlainRecord(entry) ||
          !hasExactKeys(entry, attendanceKeys) ||
          !projectedAttendanceStates.has(entry.state as RetentionAttendanceEntry["state"]) ||
          !isDateTime(entry.occurredAt)
        ) {
          throw new RetentionAlertProducerError(
            "invalid",
            "Retention attendance projection is invalid",
          );
        }
        return Object.freeze({
          state: entry.state as RetentionAttendanceEntry["state"],
          occurredAt: entry.occurredAt,
        });
      })
      .filter((entry) => {
        const occurredAt = Date.parse(entry.occurredAt);
        return occurredAt >= lookbackCutoff && occurredAt <= effectiveMs;
      })
      .sort(
        (left, right) =>
          left.occurredAt.localeCompare(right.occurredAt) || left.state.localeCompare(right.state),
      );
    return Object.freeze({
      academyId,
      studentId: candidate.studentId,
      active: true,
      hasActiveMembership: true,
      membershipStartsAt: candidate.membershipStartsAt,
      membershipEndsAt: candidate.membershipEndsAt,
      attendance: Object.freeze(attendance),
    });
  });
  snapshots.sort((left, right) => left.studentId.localeCompare(right.studentId));
  return Object.freeze(snapshots);
}

function sourceHash(input: {
  academyId: string;
  runDate: string;
  effectiveAt: string;
  policy: RetentionPolicy;
  students: readonly RetentionStudentSnapshot[];
}): string {
  const canonical = JSON.stringify({
    schemaVersion: "1",
    academyId: input.academyId,
    runDate: input.runDate,
    effectiveAt: input.effectiveAt,
    policy: {
      inactivityDays: input.policy.inactivityDays,
      lookbackDays: input.policy.lookbackDays,
      noShowThreshold: input.policy.noShowThreshold,
      membershipExpiryDays: input.policy.membershipExpiryDays,
    },
    students: input.students,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function createRetentionAlertProducer({
  source,
  store,
}: {
  source: RetentionSnapshotSource;
  store: Pick<RetentionAlertStore, "commitProductionRun">;
}): RetentionAlertProducer {
  return {
    async produce(input) {
      if (!isCalendarDate(input.runDate)) {
        throw new RetentionAlertProducerError("invalid", "Retention runDate is invalid");
      }
      const effectiveAt = input.runDate + "T00:00:00.000Z";
      const inputValidation = buildRetentionAlerts({
        academyId: input.academyId,
        now: effectiveAt,
        policy: input.policy,
        students: [],
      });
      if (!inputValidation.ok) {
        throw new RetentionAlertProducerError("invalid", "Retention producer input is invalid");
      }

      let rawSnapshots: unknown;
      try {
        rawSnapshots = await source.loadSnapshots({
          academyId: input.academyId,
          effectiveAt,
          lookbackDays: input.policy.lookbackDays,
        });
      } catch (error) {
        if (error instanceof RetentionAlertProducerError) throw error;
        throw new RetentionAlertProducerError("source", "Retention source read failed");
      }
      const students = canonicalizeSnapshots(
        rawSnapshots,
        input.academyId,
        effectiveAt,
        input.policy.lookbackDays,
      );
      const built = buildRetentionAlerts({
        academyId: input.academyId,
        now: effectiveAt,
        policy: input.policy,
        students,
      });
      if (!built.ok) {
        throw new RetentionAlertProducerError("source", "Retention source projection is invalid");
      }
      if (built.value.length > alertLimit) {
        throw new RetentionAlertProducerError("limit", "Retention alert limit exceeded");
      }

      const hash = sourceHash({
        academyId: input.academyId,
        runDate: input.runDate,
        effectiveAt,
        policy: input.policy,
        students,
      });
      const parsedAudit = parseAuditEventDraft({
        academyId: input.academyId,
        actorId: "system-retention-producer",
        action: "retention.alerts.generated",
        targetRef: "academies/" + input.academyId + "/retentionAlerts",
        purpose: "daily retention alert production",
        correlationId: "retention-alerts:" + input.academyId + ":" + input.runDate,
        runDate: input.runDate,
        policyVersion: "1",
        evaluatedStudents: students.length,
        alertCount: built.value.length,
        inactivityDays: input.policy.inactivityDays,
        lookbackDays: input.policy.lookbackDays,
        noShowThreshold: input.policy.noShowThreshold,
        membershipExpiryDays: input.policy.membershipExpiryDays,
        sourceHash: hash,
      });
      if (!parsedAudit.ok || parsedAudit.value.action !== "retention.alerts.generated") {
        throw new RetentionAlertProducerError("invalid", "Retention audit construction failed");
      }
      const audit: RetentionProductionAudit = parsedAudit.value;
      const runId = buildRetentionProductionAuditEventId(input.academyId, input.runDate);
      const committed = await store.commitProductionRun({
        academyId: input.academyId,
        alerts: built.value,
        audit,
        auditEventId: runId,
      });
      return Object.freeze({
        runId,
        runDate: input.runDate,
        effectiveAt,
        sourceHash: hash,
        evaluatedStudents: students.length,
        alertCount: built.value.length,
        ...committed,
      });
    },
  };
}

type SourceDocument = Readonly<{
  id: string;
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}>;

type SourceDocumentReference = Readonly<{ id: string; path?: string }>;

type SourceQuery = Readonly<{
  where: (field: string, operator: string, value: unknown) => SourceQuery;
  orderBy: (field: string, direction: "desc") => SourceQuery;
  limit: (count: number) => SourceQuery;
  select: (...fields: string[]) => SourceQuery;
  get: () => Promise<Readonly<{ docs: readonly SourceDocument[] }>>;
}>;

export type RetentionSourceFirestore = Readonly<{
  collection: (path: string) => SourceQuery;
  doc: (path: string) => SourceDocumentReference;
  getAll: (
    ...referencesAndOptions: (
      SourceDocumentReference | Readonly<{ fieldMask: readonly string[] }>
    )[]
  ) => Promise<readonly SourceDocument[]>;
}>;

function projectionData(
  document: SourceDocument,
  fields: readonly string[],
): Record<string, unknown> {
  const data = document.exists ? document.data() : undefined;
  if (!isPlainRecord(data) || !hasExactKeys(data, fields)) {
    throw new RetentionAlertProducerError("source", "Retention source document is invalid");
  }
  return data;
}

type MembershipProjection = Readonly<{
  membershipId: string;
  academyId: string;
  studentId: string;
  status: "trial" | "active";
  startsAt: string;
  endsAt: string | null;
}>;

function parseMembershipProjection(
  document: SourceDocument,
  academyId: string,
  effectiveAt: string,
): MembershipProjection {
  const data = projectionData(document, membershipProjectionFields);
  if (data.academyId !== academyId) {
    throw new RetentionAlertProducerError("tenant", "Retention membership tenant mismatch");
  }
  if (
    !isIdentifier(data.membershipId) ||
    data.membershipId !== document.id ||
    !isIdentifier(data.studentId) ||
    (data.status !== "trial" && data.status !== "active") ||
    !isDateTime(data.startsAt) ||
    (data.endsAt !== null && !isDateTime(data.endsAt))
  ) {
    throw new RetentionAlertProducerError("source", "Retention membership is invalid");
  }
  const effectiveMs = Date.parse(effectiveAt);
  if (
    Date.parse(data.startsAt) > effectiveMs ||
    (data.endsAt !== null && Date.parse(data.endsAt) <= effectiveMs)
  ) {
    throw new RetentionAlertProducerError("source", "Retention membership is not current");
  }
  return Object.freeze({
    membershipId: data.membershipId,
    academyId,
    studentId: data.studentId,
    status: data.status,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
  });
}

type StudentProjection = Readonly<{
  studentId: string;
  academyId: string;
  active: boolean;
  status: "active" | "inactive" | "suspended";
}>;

function parseStudentProjection(document: SourceDocument, academyId: string): StudentProjection {
  const data = projectionData(document, studentProjectionFields);
  if (data.academyId !== academyId) {
    throw new RetentionAlertProducerError("tenant", "Retention student tenant mismatch");
  }
  if (
    !isIdentifier(data.studentId) ||
    data.studentId !== document.id ||
    typeof data.active !== "boolean" ||
    !["active", "inactive", "suspended"].includes(data.status as string)
  ) {
    throw new RetentionAlertProducerError("source", "Retention student is invalid");
  }
  return Object.freeze({
    studentId: data.studentId,
    academyId,
    active: data.active,
    status: data.status as StudentProjection["status"],
  });
}

type AttendanceProjection = Readonly<{
  attendanceId: string;
  academyId: string;
  sessionId: string;
  studentId: string;
  state: RetentionAttendanceEntry["state"] | "excused";
  occurredAt: string;
  correctionOf: string | null;
  schemaVersion: "1";
}>;

function parseAttendanceProjection(
  document: SourceDocument,
  academyId: string,
  cutoff: string,
): AttendanceProjection {
  const data = projectionData(document, attendanceProjectionFields);
  if (data.academyId !== academyId) {
    throw new RetentionAlertProducerError("tenant", "Retention attendance tenant mismatch");
  }
  const canonicalAttendanceId =
    isIdentifier(data.sessionId) && isIdentifier(data.studentId)
      ? buildAttendanceId(data.sessionId, data.studentId)
      : null;
  if (
    !isStorageKey(data.attendanceId) ||
    data.attendanceId !== document.id ||
    !isIdentifier(data.sessionId) ||
    !isIdentifier(data.studentId) ||
    !sourceAttendanceStates.has(data.state as string) ||
    !isDateTime(data.occurredAt) ||
    Date.parse(data.occurredAt) < Date.parse(cutoff) ||
    data.schemaVersion !== "1" ||
    (data.correctionOf !== null && !isStorageKey(data.correctionOf)) ||
    (data.correctionOf === null && data.attendanceId !== canonicalAttendanceId) ||
    (data.correctionOf !== null && data.correctionOf !== canonicalAttendanceId)
  ) {
    throw new RetentionAlertProducerError("source", "Retention attendance is invalid");
  }
  return Object.freeze({
    attendanceId: data.attendanceId,
    academyId,
    sessionId: data.sessionId,
    studentId: data.studentId,
    state: data.state as AttendanceProjection["state"],
    occurredAt: data.occurredAt,
    correctionOf: data.correctionOf as string | null,
    schemaVersion: "1",
  });
}

export function createFirestoreRetentionSnapshotSource({
  firestore,
}: {
  firestore: RetentionSourceFirestore;
}): RetentionSnapshotSource {
  return {
    async loadSnapshots(input) {
      if (
        !isIdentifier(input.academyId) ||
        !isDateTime(input.effectiveAt) ||
        input.effectiveAt !== input.effectiveAt.slice(0, 10) + "T00:00:00.000Z" ||
        !Number.isSafeInteger(input.lookbackDays) ||
        input.lookbackDays < 1 ||
        input.lookbackDays > 365
      ) {
        throw new RetentionAlertProducerError("invalid", "Retention source input is invalid");
      }
      const membershipSnapshot = await firestore
        .collection("academies/" + input.academyId + "/memberships")
        .where("status", "in", ["trial", "active"])
        .limit(studentLimit + 1)
        .select(...membershipProjectionFields)
        .get();
      if (membershipSnapshot.docs.length > studentLimit) {
        throw new RetentionAlertProducerError("limit", "Retention membership limit exceeded");
      }
      const memberships = membershipSnapshot.docs.map((document) =>
        parseMembershipProjection(document, input.academyId, input.effectiveAt),
      );
      const membershipByStudent = new Map<string, MembershipProjection>();
      for (const membership of memberships) {
        if (membershipByStudent.has(membership.studentId)) {
          throw new RetentionAlertProducerError(
            "source",
            "Retention student has multiple current memberships",
          );
        }
        membershipByStudent.set(membership.studentId, membership);
      }
      if (memberships.length === 0) return Object.freeze([]);

      const studentReferences = memberships.map((membership) =>
        firestore.doc("academies/" + input.academyId + "/students/" + membership.studentId),
      );
      const studentDocuments = await firestore.getAll(...studentReferences, {
        fieldMask: studentProjectionFields,
      });
      if (studentDocuments.length !== studentReferences.length) {
        throw new RetentionAlertProducerError("source", "Retention student reference is missing");
      }
      const expectedStudentIds = new Set(memberships.map(({ studentId }) => studentId));
      const students = new Map<string, StudentProjection>();
      for (const document of studentDocuments) {
        const student = parseStudentProjection(document, input.academyId);
        if (!expectedStudentIds.has(student.studentId) || students.has(student.studentId)) {
          throw new RetentionAlertProducerError("source", "Retention student reference is invalid");
        }
        students.set(student.studentId, student);
      }
      if (students.size !== expectedStudentIds.size) {
        throw new RetentionAlertProducerError("source", "Retention student reference is missing");
      }

      const eligibleStudentIds = new Set(
        [...students.values()]
          .filter((student) => student.active && student.status === "active")
          .map((student) => student.studentId),
      );
      if (eligibleStudentIds.size === 0) return Object.freeze([]);

      const cutoff = new Date(
        Date.parse(input.effectiveAt) - input.lookbackDays * dayMs,
      ).toISOString();
      const attendanceSnapshot = await firestore
        .collection("academies/" + input.academyId + "/attendance")
        .where("occurredAt", ">=", cutoff)
        .orderBy("occurredAt", "desc")
        .limit(attendanceLimit + 1)
        .select(...attendanceProjectionFields)
        .get();
      if (attendanceSnapshot.docs.length > attendanceLimit) {
        throw new RetentionAlertProducerError("limit", "Retention attendance limit exceeded");
      }
      const seenAttendance = new Set<string>();
      const attendanceByStudent = new Map<string, RetentionAttendanceEntry[]>();
      for (const document of attendanceSnapshot.docs) {
        const attendance = parseAttendanceProjection(document, input.academyId, cutoff);
        if (seenAttendance.has(attendance.attendanceId)) {
          throw new RetentionAlertProducerError("source", "Retention attendance is duplicated");
        }
        seenAttendance.add(attendance.attendanceId);
        if (
          !eligibleStudentIds.has(attendance.studentId) ||
          attendance.correctionOf !== null ||
          attendance.state === "excused" ||
          Date.parse(attendance.occurredAt) > Date.parse(input.effectiveAt)
        ) {
          continue;
        }
        const entries = attendanceByStudent.get(attendance.studentId) ?? [];
        entries.push(
          Object.freeze({
            state: attendance.state,
            occurredAt: attendance.occurredAt,
          }),
        );
        attendanceByStudent.set(attendance.studentId, entries);
      }

      const snapshots = [...eligibleStudentIds]
        .sort((left, right) => left.localeCompare(right))
        .map((studentId) => {
          const membership = membershipByStudent.get(studentId);
          if (membership === undefined) {
            throw new RetentionAlertProducerError(
              "source",
              "Retention membership reference is missing",
            );
          }
          const attendance = attendanceByStudent.get(studentId) ?? [];
          attendance.sort(
            (left, right) =>
              left.occurredAt.localeCompare(right.occurredAt) ||
              left.state.localeCompare(right.state),
          );
          return Object.freeze({
            academyId: input.academyId,
            studentId,
            active: true,
            hasActiveMembership: true,
            membershipStartsAt: membership.startsAt,
            membershipEndsAt: membership.endsAt,
            attendance: Object.freeze(attendance),
          });
        });
      return Object.freeze(snapshots);
    },
  };
}
