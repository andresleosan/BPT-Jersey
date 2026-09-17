import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

import {
  classAuditActions,
  parseAuditEventDraft,
  type AuditEventDraft,
  type ClassAuditAction,
} from "@bpt-jersey/domain/audit";

/** The fields a class event adds to the common ones; a pre-class-block row has none of them. */
const classShapeFields = Object.freeze([
  "class",
  "actorIp",
  "actorRole",
  "actorGroup",
  "actorName",
  "source",
] as const);

export type AuditDocumentReference = Readonly<{ id: string }>;
export type AuditCreateTransaction<Reference> = Readonly<{
  create: (ref: Reference, data: Readonly<Record<string, unknown>>) => unknown;
}>;

type ReplayOptions = Readonly<{ allowLegacyMissingGeneratedFields?: boolean }>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => typeof key === "string" && expected.includes(key))
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((value, index) => sameValue(value, right[index]))
    );
  }
  // A block such as the class one is a record, not a scalar: comparing references would call every
  // replay a mismatch, so the same fields with the same values count as the same fact.
  if (isPlainRecord(left) && isPlainRecord(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) && sameValue(left[key], right[key]),
      )
    );
  }
  return left === right;
}

/**
 * Only a restricted read reports an outcome; every other action is recorded because it happened.
 * A restricted action missing from this list would be written as "completed" whatever it did,
 * which is worse than not auditing it at all - the ledger would state something untrue.
 */
function storedResult(draft: AuditEventDraft): string {
  if (
    draft.action === "member.detail.read" ||
    draft.action === "member.identity.lookup" ||
    draft.action === "enrolment.request.detail.read"
  ) {
    return draft.result;
  }
  return "completed";
}

export function appendAuditEventInTransaction<Reference extends AuditDocumentReference>(
  transaction: AuditCreateTransaction<Reference>,
  ref: Reference,
  draft: AuditEventDraft,
): void {
  const parsed = parseAuditEventDraft(draft);
  if (!parsed.ok) {
    throw new HttpsError("invalid-argument", "Invalid audit event draft");
  }

  transaction.create(ref, {
    ...parsed.value,
    auditEventId: ref.id,
    occurredAt: FieldValue.serverTimestamp(),
    result: storedResult(parsed.value),
    schemaVersion: 1,
  });
}

export function matchesAuditEventReplay(
  stored: unknown,
  eventId: string,
  draft: AuditEventDraft,
  options: ReplayOptions = {},
): boolean {
  const parsedDraft = parseAuditEventDraft(draft);
  if (!parsedDraft.ok || !isPlainRecord(stored)) return false;
  if (stored.result !== storedResult(parsedDraft.value) || stored.schemaVersion !== 1) return false;

  const hasAuditEventId = Object.prototype.hasOwnProperty.call(stored, "auditEventId");
  const hasOccurredAt = Object.prototype.hasOwnProperty.call(stored, "occurredAt");
  if (hasAuditEventId !== hasOccurredAt) return false;
  if (hasAuditEventId) {
    if (stored.auditEventId !== eventId || stored.occurredAt == null) return false;
  } else if (options.allowLegacyMissingGeneratedFields !== true) {
    return false;
  }

  // A class row written before the class block existed carries only the common fields. It states
  // the same fact as today's draft, so a repeat check-in replays instead of being read as evidence
  // of tampering - the same allowance the generated fields already get.
  const legacyClassRow =
    classAuditActions.includes(parsedDraft.value.action as ClassAuditAction) &&
    classShapeFields.every((key) => !Object.prototype.hasOwnProperty.call(stored, key));
  const draftKeys = Object.keys(parsedDraft.value).filter(
    (key) =>
      !legacyClassRow || !classShapeFields.includes(key as (typeof classShapeFields)[number]),
  );
  const stableKeys = draftKeys.filter((key) => key !== "result");
  const generatedKeys = hasAuditEventId ? ["auditEventId", "occurredAt"] : [];
  if (!hasExactKeys(stored, [...stableKeys, "result", "schemaVersion", ...generatedKeys])) {
    return false;
  }
  // The caller's address is provenance of the first write, not part of the fact: the same person
  // retrying from another network still replays, and the stored address is never rewritten.
  const comparedKeys = stableKeys.filter((key) => key !== "actorIp");
  const draftValue = parsedDraft.value as unknown as Record<string, unknown>;
  if (legacyClassRow) {
    return comparedKeys.every((key) => sameValue(stored[key], draftValue[key]));
  }
  const stableStored = Object.fromEntries(draftKeys.map((key) => [key, stored[key]]));
  const parsedStored = parseAuditEventDraft(stableStored);
  return (
    parsedStored.ok &&
    comparedKeys.every((key) =>
      sameValue((parsedStored.value as unknown as Record<string, unknown>)[key], draftValue[key]),
    )
  );
}
