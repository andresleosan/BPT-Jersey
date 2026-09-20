import { createHash, randomUUID } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { parseStudentProfileAt } from "@bpt-jersey/domain/profiles";
import { parseStoredRegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
import {
  attendanceBaselineSchema, baselineFirstBptDate, capturedAmountMinor, capturedDate,
  memberHistoryEntrySchema, memberHistoryInputSchema, memberHistoryPageSchema,
  reviewHistoryEntryInputSchema, saveAttendanceBaselineInputSchema, historyReviewResultSchema,
  type MemberHistoryEntry,
} from "@bpt-jersey/domain/members/history";
import { reviewIdentifierSchema } from "@bpt-jersey/domain/members/reconciliation";
import { dateKeyInJersey } from "@bpt-jersey/domain/schedule/member-calendar";
import type { CanonicalMemberDirectoryActor } from "./canonical-member-directory-service.js";
import { runRestricted, type CanonicalDirectoryReadTransaction } from "./canonical-member-directory-read-service.js";
import { canonicalMemberIdentityIds, resolveCanonicalStudentIdInTransaction } from "./member-identity-resolution.js";
import { boundedMemberReferences, memberReviewDigest, type MemberReconciliationDependencies } from "./member-reconciliation-service.js";
import { prepareMemberReviewWrite } from "./member-review-transaction.js";
import { constantTimeMacEquals } from "./member-directory-crypto.js";

const cursorSchema = z.strictObject({
  kind: z.literal("member-history-v1"), academyId: reviewIdentifierSchema, actorId: reviewIdentifierSchema,
  studentId: reviewIdentifierSchema, manifest: z.string().length(64), phase: z.enum(["capture", "reviewed"]),
  after: z.string().max(128), expiresAt: z.iso.datetime(),
});
const stableId = (value: string) => createHash("sha256").update(value).digest("hex");
async function capturedEntries(tx: CanonicalDirectoryReadTransaction, deps: MemberReconciliationDependencies,
  academyId: string, studentId: string) {
  const ids = await canonicalMemberIdentityIds(tx, academyId, studentId);
  if (ids[0] !== studentId) throw new HttpsError("failed-precondition", "Open the canonical member before reviewing history");
  const studentDoc = await tx.get(`academies/${academyId}/students/${studentId}`);
  const student = parseStudentProfileAt(studentDoc.data, typeof studentDoc.data?.updatedAt === "string" ? studentDoc.data.updatedAt.slice(0, 10) : "invalid");
  if (!student.ok || student.value.studentId !== studentId || student.value.academyId !== academyId) throw new HttpsError("failed-precondition", "Member identity needs inventory review");
  const records = new Set<string>();
  for (const collection of ["regyfitOfficeLinks", "regyfitMemberLinks", "memberRecoverySourceLinks"]) for (const id of ids) {
    const links = await boundedMemberReferences(tx, academyId, collection, id);
    if (links.length > 20) throw new HttpsError("failed-precondition", "Source ownership needs a bounded review");
    for (const link of links) {
      if (link.data?.academyId !== academyId || link.data?.studentId !== id || typeof link.data?.recordId !== "string" ||
          !/^[0-9]{1,12}$/u.test(link.data.recordId)) throw new HttpsError("failed-precondition", "A historical source link is invalid");
      records.add(link.data.recordId);
    }
  }
  if (records.size > 20) throw new HttpsError("failed-precondition", "Historical source limit exceeded");
  const entries: MemberHistoryEntry[] = [];
  const sourceVersions: Record<string, string> = {};
  for (const recordId of [...records].sort()) {
    const doc = await tx.get(`academies/${academyId}/regyfitMemberRecords/${recordId}`);
    const parsed = parseStoredRegyfitMemberRecord(doc.data);
    if (!parsed.ok || !doc.version || parsed.value.recordId !== recordId || (doc.data?.academyId !== undefined && doc.data.academyId !== academyId)) {
      throw new HttpsError("failed-precondition", "Historical capture needs inventory review");
    }
    for (const collection of ["regyfitOfficeLinks", "regyfitMemberLinks"]) {
      const link = await tx.get(`academies/${academyId}/${collection}/${recordId}`);
      if (link.exists && (link.data?.academyId !== academyId || !ids.includes(String(link.data?.studentId)))) {
        throw new HttpsError("failed-precondition", "Historical source has competing owners");
      }
    }
    sourceVersions[recordId] = doc.version;
    const record = parsed.value;
    const add = (kind: MemberHistoryEntry["kind"], index: number, originalText: string, occurredAt: string | null, amountMinor: number | null) => {
      const sourceItemId = `${record.capturedAt}:${kind}:${index}`;
      entries.push(memberHistoryEntrySchema.parse({ entryId: `archive-${stableId(`${recordId}:${doc.version}:${sourceItemId}`)}`,
        studentId, kind, sourceRecordId: recordId, sourceItemId, sourceVersion: doc.version,
        capturedAt: record.capturedAt, occurredAt, amountMinor, originalText,
        confirmation: "unconfirmed", supersedesEntryId: null, equivalentToEntryId: null }));
    };
    record.payments.forEach((payment, index) => add("payment", index, JSON.stringify(payment), capturedDate(payment.date), capturedAmountMinor(payment.amount)));
    record.attendance.records.forEach((attendance, index) => add("attendance", index, JSON.stringify(attendance), capturedDate(attendance.date), null));
    if (Object.keys(record.graduation).length) add("level", 0, JSON.stringify(record.graduation), null, null);
  }
  entries.sort((a, b) => a.entryId.localeCompare(b.entryId));
  return { entries, ids, sourceVersions, manifest: memberReviewDigest(deps, "member-history-manifest-v1", { academyId, studentId, sourceVersions, ids }) };
}
function savedEntry(value: unknown, academyId: string, ids: readonly string[]): MemberHistoryEntry {
  const raw = value as Record<string, unknown> | undefined;
  const entry = memberHistoryEntrySchema.safeParse(raw?.entry);
  if (!entry.success || raw?.academyId !== academyId || !ids.includes(entry.data.studentId)) {
    throw new HttpsError("failed-precondition", "Historical entry is invalid");
  }
  return entry.data;
}
export function createMemberHistoryService(deps: MemberReconciliationDependencies, actor: CanonicalMemberDirectoryActor,
  now = () => new Date().toISOString()) {
  const run = <T>(input: unknown, operation: (tx: CanonicalDirectoryReadTransaction, time: string) => Promise<T>) => {
    const time = now();
    return runRestricted<T>({ dependencies: deps, command: { actor, value: input, now: time }, action: "member.detail.read",
      purpose: "member-record-maintenance", operation: async (tx) => ({ kind: "success", auditResult: "completed", value: await operation(tx, time) }) });
  };
  return {
    list(academyId: string, studentId: string, cursor?: string) {
      if (academyId !== actor.academyId) throw new HttpsError("permission-denied", "Academy mismatch");
      const input = memberHistoryInputSchema.parse({ studentId, ...(cursor ? { cursor } : {}) });
      return run(input, async (tx, time) => {
        const canonicalId = await resolveCanonicalStudentIdInTransaction(tx, academyId, studentId);
        const base = `academies/${academyId}`;
        const captures = await capturedEntries(tx, deps, academyId, canonicalId);
        let phase: "capture" | "reviewed" = "capture", after = "";
        if (cursor) {
          const doc = await tx.get(`${base}/memberDirectoryCursorStates/${cursor}`);
          const state = cursorSchema.safeParse(doc.data);
          if (!state.success || state.data.academyId !== academyId || state.data.actorId !== actor.actorId ||
              state.data.studentId !== canonicalId || state.data.manifest !== captures.manifest || Date.parse(state.data.expiresAt) <= Date.parse(time)) {
            throw new HttpsError("failed-precondition", "History changed or this page expired. Refresh the history");
          }
          phase = state.data.phase; after = state.data.after;
        }
        let entries: MemberHistoryEntry[] = [], next: { phase: "capture" | "reviewed"; after: string } | null = null;
        const revisions: Record<string, string> = {};
        if (phase === "capture") {
          const page = captures.entries.filter((entry) => entry.entryId > after).slice(0, 51);
          for (const entry of page.slice(0, 50)) {
            const stored = await tx.get(`${base}/memberHistoryEntries/${entry.entryId}`);
            const value = stored.exists ? savedEntry(stored.data, academyId, captures.ids) : entry;
            entries.push({ ...value, studentId: canonicalId });
            revisions[entry.entryId] = memberReviewDigest(deps, "member-history-entry-v1", { entry: value, version: stored.data?.reviewVersion ?? stored.version ?? "absent" });
          }
          next = page.length > 50 ? { phase, after: page[49]!.entryId } : { phase: "reviewed", after: "" };
        } else {
          if (!tx.listCollection) throw new HttpsError("failed-precondition", "History query is unavailable");
          const all = (await Promise.all(captures.ids.map((id) => tx.listCollection!({ academyId, collection: "memberHistoryEntries",
            equal: { field: "studentId", value: id }, ...(after ? { afterDocumentId: after } : {}), limit: 51 })))).flat()
            .sort((a, b) => a.id.localeCompare(b.id));
          const currentIds = new Set(captures.entries.map((entry) => entry.entryId));
          for (const doc of all.slice(0, 50)) {
            if (currentIds.has(doc.id)) continue;
            const entry = savedEntry(doc.data, academyId, captures.ids);
            entries.push({ ...entry, studentId: canonicalId });
            revisions[entry.entryId] = memberReviewDigest(deps, "member-history-entry-v1", { entry, version: doc.data?.reviewVersion ?? doc.version });
          }
          if (all.length > 50) next = { phase, after: all[49]!.id };
        }
        const [baselineDoc, levelDoc] = await Promise.all([tx.get(`${base}/memberAttendanceBaselines/${canonicalId}`), tx.get(`${base}/studentLevelProgress/${canonicalId}`)]);
        const baseline = baselineDoc.exists ? attendanceBaselineSchema.parse(baselineDoc.data?.baseline) : null;
        if (baseline && (baseline.studentId !== canonicalId || baselineDoc.data?.academyId !== academyId)) throw new HttpsError("failed-precondition", "Attendance baseline ownership is invalid");
        const nextCursor = next ? randomUUID() : null;
        if (next && nextCursor) tx.create(`${base}/memberDirectoryCursorStates/${nextCursor}`, {
          kind: "member-history-v1", academyId, actorId: actor.actorId, studentId: canonicalId, manifest: captures.manifest,
          phase: next.phase, after: next.after, expiresAt: new Date(Date.parse(time) + 30 * 60_000).toISOString(),
        });
        return memberHistoryPageSchema.parse({ entries, nextCursor, coverage: "captured-records-only", baseline, revisions,
          baselineAppliesToCurrentLevel: baseline !== null && levelDoc.data?.state === "initialized" &&
            levelDoc.data.currentDefinitionKey === baseline.levelDefinitionKey &&
            (levelDoc.data.importedBaseline as Record<string, unknown> | null)?.classes === baseline.confirmedCount &&
            (levelDoc.data.importedBaseline as Record<string, unknown> | null)?.cutoff === baselineFirstBptDate(baseline.throughDate),
          baselineVersion: baselineDoc.version ?? null, levelVersion: levelDoc.version ?? null, sourceVersions: captures.sourceVersions });
      });
    },
    review(input: unknown) {
      const value = reviewHistoryEntryInputSchema.parse(input);
      return run(value, async (tx, time) => {
        const base = `academies/${actor.academyId}`;
        const receiptPath = `${base}/memberHistoryDecisions/${value.requestId}`;
        const receipt = await tx.get(receiptPath);
        const bodyDigest = memberReviewDigest(deps, "member-history-decision-v1", { actorId: actor.actorId, value });
        if (receipt.exists) {
          if (typeof receipt.data?.bodyDigest !== "string" || !constantTimeMacEquals(receipt.data.bodyDigest, bodyDigest)) throw new HttpsError("already-exists", "This decision ID is already used");
          return historyReviewResultSchema.parse(receipt.data.result);
        }
        const captures = await capturedEntries(tx, deps, actor.academyId, value.studentId);
        const path = `${base}/memberHistoryEntries/${value.entryId}`;
        const stored = await tx.get(path);
        const before = stored.exists ? savedEntry(stored.data, actor.academyId, captures.ids) : captures.entries.find((entry) => entry.entryId === value.entryId);
        if (!before) throw new HttpsError("not-found", "Refresh the captured history before reviewing this entry");
        const revision = memberReviewDigest(deps, "member-history-entry-v1", { entry: before, version: stored.data?.reviewVersion ?? stored.version ?? "absent" });
        if (revision !== value.expectedRevision) throw new HttpsError("failed-precondition", "This historical entry changed. Refresh before reviewing");
        if ((before.kind !== "payment" && value.amountMinor !== null) ||
            (value.confirmation === "confirmed" && value.occurredAt && Date.parse(value.occurredAt) > Date.parse(time))) {
          throw new HttpsError("invalid-argument", "Check the movement type and confirmed date");
        }
        if (value.confirmation === "confirmed" && captures.sourceVersions[before.sourceRecordId] !== before.sourceVersion) {
          throw new HttpsError("failed-precondition", "This capture has changed. Review its current evidence before confirming");
        }
        if (value.equivalentToEntryId) {
          if (value.equivalentToEntryId === value.entryId) throw new HttpsError("invalid-argument", "An entry cannot be its own equivalent");
          const other = savedEntry((await tx.get(`${base}/memberHistoryEntries/${value.equivalentToEntryId}`)).data, actor.academyId, captures.ids);
          if (other.confirmation !== "confirmed" || captures.sourceVersions[other.sourceRecordId] !== other.sourceVersion || other.equivalentToEntryId || other.kind !== before.kind || other.amountMinor !== value.amountMinor || other.occurredAt !== value.occurredAt) {
            throw new HttpsError("failed-precondition", "Select a confirmed compatible entry and review the evidence of equivalence");
          }
        }
        const entry = memberHistoryEntrySchema.parse({ ...before, confirmation: value.confirmation,
          amountMinor: value.amountMinor, occurredAt: value.occurredAt, equivalentToEntryId: value.equivalentToEntryId });
        const commit = await prepareMemberReviewWrite(tx, deps, actor, value.requestId, value.studentId, time);
        const result = { entry, revision: memberReviewDigest(deps, "member-history-entry-v1", { entry, version: bodyDigest }) };
        if (stored.exists && before.confirmation === "confirmed") {
          const adjustmentId = `adjustment-${value.requestId}`;
          const adjustment = memberHistoryEntrySchema.parse({ ...entry, entryId: adjustmentId, kind: "adjustment",
            sourceItemId: `decision:${value.requestId}`, occurredAt: time, supersedesEntryId: before.entryId,
            equivalentToEntryId: null, originalText: "Historical entry corrected after review" });
          tx.create(`${base}/memberHistoryEntries/${adjustmentId}`, { academyId: actor.academyId, studentId: before.studentId,
            entry: adjustment, reviewVersion: bodyDigest, decisionId: value.requestId, reviewedAt: time, reviewedBy: actor.actorId });
        }
        tx.set(path, { academyId: actor.academyId, studentId: before.studentId, entry, reviewVersion: bodyDigest, decisionId: value.requestId, reviewedAt: time, reviewedBy: actor.actorId });
        tx.create(receiptPath, { academyId: actor.academyId, studentId: before.studentId, bodyDigest, before, result,
          input: value, actorId: actor.actorId, occurredAt: time, schemaVersion: "1" });
        commit(); return result;
      });
    },
    saveBaseline(input: unknown) {
      const value = saveAttendanceBaselineInputSchema.parse(input);
      return run(value, async (tx, time) => {
        const base = `academies/${actor.academyId}`;
        const receiptPath = `${base}/memberHistoryDecisions/${value.requestId}`;
        const receipt = await tx.get(receiptPath);
        const bodyDigest = memberReviewDigest(deps, "member-attendance-baseline-v1", { actorId: actor.actorId, value });
        if (receipt.exists) {
          if (typeof receipt.data?.bodyDigest !== "string" || !constantTimeMacEquals(receipt.data.bodyDigest, bodyDigest)) throw new HttpsError("already-exists", "This decision ID is already used");
          return attendanceBaselineSchema.parse(receipt.data.result);
        }
        if (value.throughDate > dateKeyInJersey(new Date(time))) throw new HttpsError("invalid-argument", "The baseline cannot include future attendance");
        const captures = await capturedEntries(tx, deps, actor.academyId, value.studentId);
        if (value.sourceIds.some((id) => !captures.sourceVersions[id] || value.sourceVersions[id] !== captures.sourceVersions[id])) {
          throw new HttpsError("failed-precondition", "The source capture changed. Review the baseline again");
        }
        const [previous, head] = await Promise.all([tx.get(`${base}/memberAttendanceBaselines/${value.studentId}`), tx.get(`${base}/studentLevelProgress/${value.studentId}`)]);
        if ((previous.version ?? null) !== value.expectedBaselineVersion || head.version !== value.expectedLevelVersion ||
            head.data?.academyId !== actor.academyId || head.data?.studentId !== value.studentId || head.data?.state !== "initialized" || head.data?.currentDefinitionKey !== value.levelDefinitionKey) {
          throw new HttpsError("failed-precondition", "The level or its baseline changed. Refresh before saving");
        }
        if (typeof head.data.currentLevelStartedAt === "string" && value.throughDate < head.data.currentLevelStartedAt.slice(0, 10)) {
          throw new HttpsError("failed-precondition", "The baseline must describe the current level period");
        }
        const baseline = attendanceBaselineSchema.parse({ studentId: value.studentId, throughDate: value.throughDate,
          confirmedCount: value.confirmedCount, sourceIds: value.sourceIds, decisionId: value.requestId, scope: value.scope, levelDefinitionKey: value.levelDefinitionKey });
        const commit = await prepareMemberReviewWrite(tx, deps, actor, value.requestId, value.studentId, time);
        tx.set(`${base}/memberAttendanceBaselines/${value.studentId}`, { academyId: actor.academyId, baseline, updatedAt: time, updatedBy: actor.actorId });
        // The existing level counter starts BPT attendance on cutoff, the first day AFTER this aggregate.
        tx.set(`${base}/studentLevelProgress/${value.studentId}`, { ...head.data, importedBaseline: {
          classes: baseline.confirmedCount, cutoff: baselineFirstBptDate(baseline.throughDate), source: "regyfit-import",
        }, updatedAt: time, updatedBy: actor.actorId });
        tx.create(receiptPath, { academyId: actor.academyId, studentId: value.studentId, bodyDigest,
          before: previous.data ?? null, previousProgress: head.data, result: baseline, input: value,
          actorId: actor.actorId, occurredAt: time, schemaVersion: "1" });
        commit(); return baseline;
      });
    },
  };
}
