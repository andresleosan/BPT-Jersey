import {
  buildRetentionAlertIdentity,
  retentionAlertKinds,
  type RetentionAlert,
  type RetentionAlertEvidence,
  type RetentionAlertKind,
} from "@bpt-jersey/domain/retention";
import { parseAuditEventDraft, type AuditEventDraft } from "@bpt-jersey/domain/audit";
import { appendAuditEventInTransaction, matchesAuditEventReplay } from "../audit/audit-writer.js";

export class RetentionAlertStoreError extends Error {
  public readonly code: "conflict" | "invalid" | "tenant";

  public constructor(code: "conflict" | "invalid" | "tenant", message: string) {
    super(message);
    this.name = "RetentionAlertStoreError";
    this.code = code;
  }
}

export type RetentionAlertUpsertResult = Readonly<{
  created: number;
  unchanged: number;
}>;

export type RetentionProductionAudit = Extract<
  AuditEventDraft,
  { action: "retention.alerts.generated" }
>;

export type RetentionProductionCommitResult = RetentionAlertUpsertResult &
  Readonly<{ replayed: boolean }>;

export type RetentionAlertStore = Readonly<{
  upsertAlerts: (input: {
    academyId: string;
    alerts: readonly RetentionAlert[];
  }) => Promise<RetentionAlertUpsertResult>;
  commitProductionRun: (input: {
    academyId: string;
    alerts: readonly RetentionAlert[];
    audit: RetentionProductionAudit;
    auditEventId: string;
  }) => Promise<RetentionProductionCommitResult>;
  listAlerts: (academyId: string) => Promise<readonly RetentionAlert[]>;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const storageKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/u;
const alertKeys = Object.freeze([
  "academyId",
  "alertId",
  "createdAt",
  "deduplicationKey",
  "evidence",
  "kind",
  "reasonCode",
  "schemaVersion",
  "severity",
  "status",
  "studentId",
] as const);
const evidenceKeys = Object.freeze(["lastAttendedAt", "membershipEndsAt", "noShowCount"] as const);
const retentionInboxLimit = 200;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function isStorageKey(value: unknown): value is string {
  return typeof value === "string" && storageKeyPattern.test(value);
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

function isNullableDateTime(value: unknown): value is string | null {
  return value === null || isDateTime(value);
}

function isKind(value: unknown): value is RetentionAlertKind {
  return typeof value === "string" && retentionAlertKinds.includes(value as RetentionAlertKind);
}

function parseEvidence(value: unknown): RetentionAlertEvidence {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !exactKeys(value as Record<string, unknown>, evidenceKeys)
  ) {
    throw new RetentionAlertStoreError("invalid", "Retention alert evidence is invalid");
  }
  const evidence = value as Record<string, unknown>;
  if (
    !isNullableDateTime(evidence.lastAttendedAt) ||
    !isNullableDateTime(evidence.membershipEndsAt) ||
    !Number.isSafeInteger(evidence.noShowCount) ||
    (evidence.noShowCount as number) < 0
  ) {
    throw new RetentionAlertStoreError("invalid", "Retention alert evidence is invalid");
  }
  return Object.freeze({
    lastAttendedAt: evidence.lastAttendedAt,
    membershipEndsAt: evidence.membershipEndsAt,
    noShowCount: evidence.noShowCount as number,
  });
}

export function parseStoredRetentionAlert(value: unknown): RetentionAlert {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !exactKeys(value as Record<string, unknown>, alertKeys)
  ) {
    throw new RetentionAlertStoreError("invalid", "Stored retention alert is invalid");
  }
  const alert = value as Record<string, unknown>;
  if (
    !isIdentifier(alert.academyId) ||
    !isStorageKey(alert.alertId) ||
    !isIdentifier(alert.studentId) ||
    !isStorageKey(alert.deduplicationKey) ||
    !isKind(alert.kind) ||
    alert.reasonCode !== alert.kind ||
    alert.severity !== "warning" ||
    alert.status !== "open" ||
    alert.schemaVersion !== "1" ||
    !isDateTime(alert.createdAt)
  ) {
    throw new RetentionAlertStoreError("invalid", "Stored retention alert is invalid");
  }
  return Object.freeze({
    alertId: alert.alertId,
    academyId: alert.academyId,
    studentId: alert.studentId,
    kind: alert.kind,
    severity: "warning",
    status: "open",
    reasonCode: alert.kind,
    evidence: parseEvidence(alert.evidence),
    deduplicationKey: alert.deduplicationKey,
    createdAt: alert.createdAt,
    schemaVersion: "1",
  });
}

function assertAcademyId(academyId: string): void {
  if (!isIdentifier(academyId)) {
    throw new RetentionAlertStoreError("invalid", "academyId is invalid");
  }
}

function assertAlertScope(alert: RetentionAlert, academyId: string): void {
  if (alert.academyId !== academyId) {
    throw new RetentionAlertStoreError("tenant", "Retention alert tenant mismatch");
  }
  const runDate = alert.createdAt.slice(0, 10);
  const identity = buildRetentionAlertIdentity({
    academyId,
    studentId: alert.studentId,
    kind: alert.kind,
    runDate,
  });
  if (
    alert.createdAt !== runDate + "T00:00:00.000Z" ||
    alert.alertId !== identity.alertId ||
    alert.deduplicationKey !== identity.deduplicationKey
  ) {
    throw new RetentionAlertStoreError("conflict", "Retention alert identity mismatch");
  }
}

function sameAlert(left: RetentionAlert, right: RetentionAlert): boolean {
  return (
    left.alertId === right.alertId &&
    left.academyId === right.academyId &&
    left.studentId === right.studentId &&
    left.kind === right.kind &&
    left.severity === right.severity &&
    left.status === right.status &&
    left.reasonCode === right.reasonCode &&
    left.deduplicationKey === right.deduplicationKey &&
    left.createdAt === right.createdAt &&
    left.schemaVersion === right.schemaVersion &&
    left.evidence.lastAttendedAt === right.evidence.lastAttendedAt &&
    left.evidence.noShowCount === right.evidence.noShowCount &&
    left.evidence.membershipEndsAt === right.evidence.membershipEndsAt
  );
}

function validateAlerts(
  academyId: string,
  alerts: readonly RetentionAlert[],
): readonly RetentionAlert[] {
  assertAcademyId(academyId);
  if (!Array.isArray(alerts) || alerts.length > retentionInboxLimit) {
    throw new RetentionAlertStoreError("invalid", "Retention alert batch is invalid");
  }
  const ids = new Set<string>();
  return Object.freeze(
    alerts.map((candidate) => {
      const alert = parseStoredRetentionAlert(candidate);
      assertAlertScope(alert, academyId);
      if (ids.has(alert.alertId)) {
        throw new RetentionAlertStoreError("conflict", "Duplicate retention alert");
      }
      ids.add(alert.alertId);
      return alert;
    }),
  );
}

function sortAlerts(alerts: readonly RetentionAlert[]): readonly RetentionAlert[] {
  return Object.freeze(
    [...alerts].sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || left.alertId.localeCompare(right.alertId),
    ),
  );
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp = Date.parse(value + "T00:00:00.000Z");
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function buildRetentionProductionAuditEventId(academyId: string, runDate: string): string {
  assertAcademyId(academyId);
  if (!isCalendarDate(runDate)) {
    throw new RetentionAlertStoreError("invalid", "Retention production runDate is invalid");
  }
  return "retention-production-v1__" + academyId.length + "_" + academyId + "__" + runDate;
}

function validateProductionRun(input: {
  academyId: string;
  alerts: readonly RetentionAlert[];
  audit: RetentionProductionAudit;
  auditEventId: string;
}): Readonly<{
  alerts: readonly RetentionAlert[];
  audit: RetentionProductionAudit;
}> {
  const alerts = validateAlerts(input.academyId, input.alerts);
  const parsedAudit = parseAuditEventDraft(input.audit);
  if (!parsedAudit.ok || parsedAudit.value.action !== "retention.alerts.generated") {
    throw new RetentionAlertStoreError("invalid", "Retention production audit is invalid");
  }
  const audit = parsedAudit.value;
  if (audit.academyId !== input.academyId) {
    throw new RetentionAlertStoreError("tenant", "Retention production audit tenant mismatch");
  }
  if (
    input.auditEventId !== buildRetentionProductionAuditEventId(input.academyId, audit.runDate) ||
    audit.alertCount !== alerts.length ||
    alerts.some((alert) => alert.createdAt !== audit.runDate + "T00:00:00.000Z")
  ) {
    throw new RetentionAlertStoreError("conflict", "Retention production run mismatch");
  }
  return Object.freeze({ alerts, audit });
}

export function createInMemoryRetentionAlertStore(): RetentionAlertStore {
  const state = new Map<string, RetentionAlert>();
  const audits = new Map<string, Readonly<Record<string, unknown>>>();
  return {
    async upsertAlerts({ academyId, alerts }) {
      const parsed = validateAlerts(academyId, alerts);
      const missing: { key: string; alert: RetentionAlert }[] = [];
      let unchanged = 0;
      for (const alert of parsed) {
        const key = academyId + "/" + alert.alertId;
        const existing = state.get(key);
        if (existing === undefined) {
          missing.push({ key, alert });
        } else if (sameAlert(existing, alert)) {
          unchanged += 1;
        } else {
          throw new RetentionAlertStoreError("conflict", "Retention alert already differs");
        }
      }
      for (const { key, alert } of missing) state.set(key, alert);
      return Object.freeze({ created: missing.length, unchanged });
    },
    async commitProductionRun(input) {
      const parsed = validateProductionRun(input);
      const auditKey = input.academyId + "/" + input.auditEventId;
      const existingAudit = audits.get(auditKey);
      const entries = parsed.alerts.map((alert) => ({
        alert,
        key: input.academyId + "/" + alert.alertId,
        existing: state.get(input.academyId + "/" + alert.alertId),
      }));

      if (existingAudit !== undefined) {
        if (
          !matchesAuditEventReplay(existingAudit, input.auditEventId, parsed.audit) ||
          entries.some(
            ({ alert, existing }) => existing === undefined || !sameAlert(existing, alert),
          )
        ) {
          throw new RetentionAlertStoreError("conflict", "Retention production replay differs");
        }
        return Object.freeze({
          created: 0,
          unchanged: entries.length,
          replayed: true,
        });
      }

      for (const { alert, existing } of entries) {
        if (existing !== undefined && !sameAlert(existing, alert)) {
          throw new RetentionAlertStoreError("conflict", "Retention alert already differs");
        }
      }
      const missing = entries.filter(({ existing }) => existing === undefined);
      for (const { key, alert } of missing) state.set(key, alert);
      audits.set(
        auditKey,
        Object.freeze({
          ...parsed.audit,
          auditEventId: input.auditEventId,
          occurredAt: parsed.audit.runDate + "T00:00:00.000Z",
          result: "completed",
          schemaVersion: 1,
        }),
      );
      return Object.freeze({
        created: missing.length,
        unchanged: entries.length - missing.length,
        replayed: false,
      });
    },
    async listAlerts(academyId) {
      assertAcademyId(academyId);
      return Object.freeze(
        sortAlerts([...state.values()].filter((alert) => alert.academyId === academyId)).slice(
          0,
          retentionInboxLimit,
        ),
      );
    },
  };
}

type GenericDocumentSnapshot = Readonly<{
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}>;

type GenericDocumentReference = Readonly<{
  id: string;
  get: () => Promise<GenericDocumentSnapshot>;
}>;

type GenericRetentionQuery = Readonly<{
  orderBy: (field: "createdAt", direction: "desc") => GenericRetentionQuery;
  limit: (count: number) => GenericRetentionQuery;
  get: () => Promise<{
    docs: readonly { id: string; data: () => Record<string, unknown> }[];
  }>;
}>;

export type GenericRetentionFirestore = Readonly<{
  doc: (path: string) => GenericDocumentReference;
  collection: (path: string) => GenericRetentionQuery;
  runTransaction: <T>(
    update: (transaction: {
      get: (reference: GenericDocumentReference) => Promise<GenericDocumentSnapshot>;
      set: (reference: GenericDocumentReference, data: RetentionAlert) => void;
      create: (
        reference: GenericDocumentReference,
        data: Readonly<Record<string, unknown>>,
      ) => unknown;
    }) => Promise<T>,
  ) => Promise<T>;
}>;

export function createFirestoreRetentionAlertStore({
  firestore,
}: {
  firestore: GenericRetentionFirestore;
}): RetentionAlertStore {
  return {
    async upsertAlerts({ academyId, alerts }) {
      const parsed = validateAlerts(academyId, alerts);
      return firestore.runTransaction(async (transaction) => {
        const entries = await Promise.all(
          parsed.map(async (alert) => {
            const reference = firestore.doc(
              "academies/" + academyId + "/retentionAlerts/" + alert.alertId,
            );
            const snapshot = await transaction.get(reference);
            return { alert, reference, snapshot };
          }),
        );
        let created = 0;
        let unchanged = 0;
        for (const { alert, reference, snapshot } of entries) {
          if (!snapshot.exists) {
            transaction.set(reference, alert);
            created += 1;
            continue;
          }
          const existing = parseStoredRetentionAlert(snapshot.data());
          assertAlertScope(existing, academyId);
          if (!sameAlert(existing, alert)) {
            throw new RetentionAlertStoreError("conflict", "Retention alert already differs");
          }
          unchanged += 1;
        }
        return Object.freeze({ created, unchanged });
      });
    },
    async commitProductionRun(input) {
      const parsed = validateProductionRun(input);
      return firestore.runTransaction(async (transaction) => {
        const auditReference = firestore.doc(
          "academies/" + input.academyId + "/auditEvents/" + input.auditEventId,
        );
        const alertEntries = parsed.alerts.map((alert) => ({
          alert,
          reference: firestore.doc(
            "academies/" + input.academyId + "/retentionAlerts/" + alert.alertId,
          ),
        }));
        const [auditSnapshot, ...alertSnapshots] = await Promise.all([
          transaction.get(auditReference),
          ...alertEntries.map(({ reference }) => transaction.get(reference)),
        ]);

        if (auditSnapshot.exists) {
          if (!matchesAuditEventReplay(auditSnapshot.data(), input.auditEventId, parsed.audit)) {
            throw new RetentionAlertStoreError("conflict", "Retention production replay differs");
          }
          alertEntries.forEach(({ alert }, index) => {
            const snapshot = alertSnapshots[index];
            if (snapshot === undefined || !snapshot.exists) {
              throw new RetentionAlertStoreError(
                "conflict",
                "Retention production replay is incomplete",
              );
            }
            const existing = parseStoredRetentionAlert(snapshot.data());
            assertAlertScope(existing, input.academyId);
            if (!sameAlert(existing, alert)) {
              throw new RetentionAlertStoreError("conflict", "Retention production replay differs");
            }
          });
          return Object.freeze({
            created: 0,
            unchanged: alertEntries.length,
            replayed: true,
          });
        }

        const missing: typeof alertEntries = [];
        alertEntries.forEach((entry, index) => {
          const snapshot = alertSnapshots[index];
          if (snapshot === undefined || !snapshot.exists) {
            missing.push(entry);
            return;
          }
          const existing = parseStoredRetentionAlert(snapshot.data());
          assertAlertScope(existing, input.academyId);
          if (!sameAlert(existing, entry.alert)) {
            throw new RetentionAlertStoreError("conflict", "Retention alert already differs");
          }
        });

        for (const { alert, reference } of missing) {
          transaction.create(reference, alert);
        }
        appendAuditEventInTransaction(transaction, auditReference, parsed.audit);
        return Object.freeze({
          created: missing.length,
          unchanged: alertEntries.length - missing.length,
          replayed: false,
        });
      });
    },
    async listAlerts(academyId) {
      assertAcademyId(academyId);
      const snapshot = await firestore
        .collection("academies/" + academyId + "/retentionAlerts")
        .orderBy("createdAt", "desc")
        .limit(retentionInboxLimit)
        .get();
      return sortAlerts(
        snapshot.docs.map((document) => {
          const alert = parseStoredRetentionAlert(document.data());
          assertAlertScope(alert, academyId);
          if (document.id !== alert.alertId) {
            throw new RetentionAlertStoreError(
              "conflict",
              "Retention alert document identity mismatch",
            );
          }
          return alert;
        }),
      );
    },
  };
}
