import { z } from "zod";
import { reviewIdentifierSchema, reviewRevisionSchema } from "./member-reconciliation-contracts";

export const memberHistoryEntrySchema = z.strictObject({
  entryId: reviewIdentifierSchema, studentId: reviewIdentifierSchema,
  kind: z.enum(["payment", "attendance", "level", "adjustment"]),
  sourceRecordId: reviewIdentifierSchema, sourceItemId: z.string().min(1).max(240),
  sourceVersion: z.string().min(1).max(160), capturedAt: z.iso.datetime().nullable(),
  occurredAt: z.iso.datetime().nullable(), amountMinor: z.number().int().min(0).max(100_000_000).nullable(),
  originalText: z.string().max(2000).nullable(),
  confirmation: z.enum(["unconfirmed", "confirmed", "disputed"]),
  supersedesEntryId: reviewIdentifierSchema.nullable(),
  equivalentToEntryId: reviewIdentifierSchema.nullable(),
});
export type MemberHistoryEntry = Readonly<z.infer<typeof memberHistoryEntrySchema>>;
export const attendanceBaselineSchema = z.strictObject({
  studentId: reviewIdentifierSchema, throughDate: z.iso.date(), confirmedCount: z.number().int().min(0).max(1_000_000),
  sourceIds: z.array(reviewIdentifierSchema).min(1).max(20), decisionId: z.uuid(),
  scope: z.literal("current-level"), levelDefinitionKey: reviewIdentifierSchema,
});
export type AttendanceBaseline = Readonly<z.infer<typeof attendanceBaselineSchema>>;
export const memberHistoryPageSchema = z.strictObject({
  entries: z.array(memberHistoryEntrySchema).max(50), nextCursor: z.uuid().nullable(),
  coverage: z.literal("captured-records-only"), baseline: attendanceBaselineSchema.nullable(),
  baselineAppliesToCurrentLevel: z.boolean(),
  revisions: z.record(reviewIdentifierSchema, reviewRevisionSchema),
  baselineVersion: z.string().nullable(), levelVersion: z.string().nullable(),
  sourceVersions: z.record(reviewIdentifierSchema, z.string().min(1).max(160)),
});
export const memberHistoryInputSchema = z.strictObject({ studentId: reviewIdentifierSchema, cursor: z.uuid().optional() });
export const reviewHistoryEntryInputSchema = z.strictObject({
  studentId: reviewIdentifierSchema, entryId: reviewIdentifierSchema, requestId: z.uuid(),
  expectedRevision: reviewRevisionSchema, confirmation: z.enum(["confirmed", "disputed"]),
  equivalentToEntryId: reviewIdentifierSchema.nullable(),
  occurredAt: z.iso.datetime().nullable(), amountMinor: z.number().int().min(0).max(100_000_000).nullable(),
  evidence: z.string().trim().min(3).max(1000), reason: z.string().trim().min(3).max(500),
});
export const saveAttendanceBaselineInputSchema = attendanceBaselineSchema.omit({ decisionId: true }).extend({
  requestId: z.uuid(), expectedLevelVersion: z.string().min(1).max(160),
  expectedBaselineVersion: z.string().min(1).max(160).nullable(),
  sourceVersions: z.record(reviewIdentifierSchema, z.string().min(1).max(160)),
  evidence: z.string().trim().min(3).max(1000), reason: z.string().trim().min(3).max(500),
  overlapReviewed: z.literal(true),
});
export const historyReviewResultSchema = z.strictObject({ entry: memberHistoryEntrySchema, revision: reviewRevisionSchema });

/** Only an unambiguous GBP amount is projected. Other text stays available as original evidence. */
export function capturedAmountMinor(text: string | undefined): number | null {
  if (text === undefined) return null;
  const match = /^(?:£\s*)?(\d{1,6})(?:\.(\d{2}))?$/u.exec(text.trim());
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number(match[2] ?? "0");
  return Number.isSafeInteger(amount) && amount <= 100_000_000 ? amount : null;
}
export function capturedDate(text: string | undefined): string | null {
  return text && z.iso.date().safeParse(text).success ? `${text}T00:00:00.000Z` : null;
}
export function baselineFirstBptDate(throughDate: string): string {
  const date = new Date(`${z.iso.date().parse(throughDate)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
/** This is an aggregate, never a fabricated list of dated visits. Unknown baseline remains null. */
export function countConfirmedHistory(
  baseline: AttendanceBaseline | null, entries: readonly MemberHistoryEntry[],
): Readonly<{ baseline: number | null; bptAfterCutoff: number; knownTotal: number }> {
  const unique = new Map(entries.filter((entry) => entry.kind === "attendance" && entry.confirmation === "confirmed" &&
    entry.sourceRecordId === "bpt" && entry.occurredAt && (!baseline || entry.occurredAt.slice(0, 10) > baseline.throughDate))
    .map((entry) => [entry.equivalentToEntryId ?? entry.entryId, entry]));
  return { baseline: baseline?.confirmedCount ?? null, bptAfterCutoff: unique.size, knownTotal: (baseline?.confirmedCount ?? 0) + unique.size };
}

/** Explicit member-facing projection: source evidence and office review notes never leave the server. */
export const confirmedMemberHistorySchema = memberHistoryEntrySchema.pick({
  entryId: true, kind: true, occurredAt: true, amountMinor: true, supersedesEntryId: true,
});
export function projectConfirmedMemberHistory(entry: MemberHistoryEntry, currentSourceVersion: string | undefined) {
  return entry.confirmation === "confirmed" && entry.sourceVersion === currentSourceVersion && !entry.equivalentToEntryId
    ? confirmedMemberHistorySchema.parse(entry) : null;
}
