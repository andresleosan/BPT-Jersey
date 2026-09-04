import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

import { parseAuditEventDraft, type AuditEventDraft } from "@bpt-jersey/domain/audit";

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
  return left === right;
}

function storedResult(draft: AuditEventDraft): string {
  if (draft.action === "member.detail.read" || draft.action === "member.identity.lookup") {
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

  const draftKeys = Object.keys(parsedDraft.value);
  const stableKeys = draftKeys.filter((key) => key !== "result");
  const generatedKeys = hasAuditEventId ? ["auditEventId", "occurredAt"] : [];
  if (!hasExactKeys(stored, [...stableKeys, "result", "schemaVersion", ...generatedKeys])) {
    return false;
  }
  const stableStored = Object.fromEntries(draftKeys.map((key) => [key, stored[key]]));
  const parsedStored = parseAuditEventDraft(stableStored);
  return (
    parsedStored.ok &&
    stableKeys.every((key) =>
      sameValue(
        (parsedStored.value as unknown as Record<string, unknown>)[key],
        (parsedDraft.value as unknown as Record<string, unknown>)[key],
      ),
    )
  );
}
