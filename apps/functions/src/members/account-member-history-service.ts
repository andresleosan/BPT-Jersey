import { createHash, randomUUID } from "node:crypto";
import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { accountMemberHistoryPageSchema, memberHistoryEntrySchema, projectConfirmedMemberHistory } from "@bpt-jersey/domain/members/history";
import { reviewIdentifierSchema } from "@bpt-jersey/domain/members/reconciliation";
import { parseStoredRegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
import { createMemberAccessService, memberAccessDependenciesInTransaction } from "./member-access-service.js";
import { createMemberDirectoryReadTransaction } from "./member-directory-firestore.js";
import { canonicalMemberIdentityIds } from "./member-identity-resolution.js";

const cursorSchema = z.strictObject({
  kind: z.literal("account-history-v1"), academyId: reviewIdentifierSchema, actorId: reviewIdentifierSchema,
  studentId: reviewIdentifierSchema, identityDigest: z.string().length(64), after: reviewIdentifierSchema,
  expiresAt: z.iso.datetime(),
});
const unavailable = () => new HttpsError("permission-denied", "Member history is unavailable");

/** History is a confirmed projection of this athlete's sources, never a raw archive export. */
export async function readAccountMemberHistory(db: Firestore, academyId: string, actorId: string,
  requestedStudentId?: string, cursor?: string) {
  reviewIdentifierSchema.parse(academyId); reviewIdentifierSchema.parse(actorId);
  if (requestedStudentId) reviewIdentifierSchema.parse(requestedStudentId);
  if (cursor) z.uuid().parse(cursor);
  return db.runTransaction(async (tx) => {
    const now = new Date();
    const base = `academies/${academyId}`;
    const access = createMemberAccessService(memberAccessDependenciesInTransaction(db, tx, () => now.toISOString()));
    let subject = requestedStudentId;
    if (!subject) {
      const profiles = await access.listProfiles(academyId, actorId);
      subject = profiles.find((profile) => profile.via === "self")?.studentId ?? (profiles.length === 1 ? profiles[0]!.studentId : undefined);
    }
    if (!subject || !(await access.authorise(academyId, actorId, subject)).allowed) throw unavailable();
    const ids = await canonicalMemberIdentityIds(createMemberDirectoryReadTransaction(db, tx), academyId, subject);
    const studentId = ids[0]!;
    const identityDigest = createHash("sha256").update(JSON.stringify([...ids].sort())).digest("hex");
    let after = "";
    if (cursor) {
      const page = cursorSchema.safeParse((await tx.get(db.doc(`${base}/memberDirectoryCursorStates/${cursor}`))).data());
      if (!page.success || page.data.academyId !== academyId || page.data.actorId !== actorId ||
          page.data.studentId !== studentId || page.data.identityDigest !== identityDigest || Date.parse(page.data.expiresAt) <= now.getTime()) {
        throw new HttpsError("failed-precondition", "This history page expired or changed. Refresh the history");
      }
      after = page.data.after;
    }
    const quotaId = createHash("sha256").update(`account-history:${actorId}`).digest("hex");
    const quotaRef = db.doc(`${base}/memberHistoryReadLimits/${quotaId}`);
    const quota = (await tx.get(quotaRef)).data();
    const fresh = quota?.actorId === actorId && quota.academyId === academyId && typeof quota.windowStart === "number" && now.getTime() - quota.windowStart < 300_000;
    const count = fresh && Number.isSafeInteger(quota?.count) ? Number(quota!.count) : 0;
    if (count >= 30) throw new HttpsError("resource-exhausted", "Please wait before loading more history");
    const documents = (await Promise.all(ids.map(async (id) => {
      let query = db.collection(`${base}/memberHistoryEntries`).where("studentId", "==", id).orderBy(FieldPath.documentId());
      if (after) query = query.startAfter(after);
      return (await tx.get(query.limit(51))).docs;
    }))).flat().sort((a, b) => a.id.localeCompare(b.id));
    const entries = [];
    const sources = new Map<string, string | undefined>();
    for (const doc of documents.slice(0, 50)) {
      const raw = doc.data();
      const entry = memberHistoryEntrySchema.safeParse(raw.entry);
      if (!entry.success || raw.academyId !== academyId || !ids.includes(String(raw.studentId)) ||
          entry.data.studentId !== raw.studentId || entry.data.entryId !== doc.id) throw unavailable();
      const recordId = entry.data.sourceRecordId;
      if (!sources.has(recordId)) {
        // Reject competing or absent source ownership, even if an old review once confirmed the row.
        const links = await Promise.all(["regyfitMemberLinks", "regyfitOfficeLinks", "memberRecoverySourceLinks"].map((name) =>
          tx.get(db.doc(`${base}/${name}/${recordId}`))));
        const existing = links.filter((link) => link.exists);
        if (!existing.length || existing.some((link) => link.data()?.academyId !== academyId ||
            link.data()?.recordId !== recordId || !ids.includes(String(link.data()?.studentId)))) throw unavailable();
        const source = await tx.get(db.doc(`${base}/regyfitMemberRecords/${recordId}`));
        const parsed = parseStoredRegyfitMemberRecord(source.data());
        if (!parsed.ok || parsed.value.recordId !== recordId || (source.data()?.academyId !== undefined && source.data()?.academyId !== academyId)) throw unavailable();
        sources.set(recordId, source.updateTime ? `${source.updateTime.seconds}:${source.updateTime.nanoseconds}` : undefined);
      }
      const projection = projectConfirmedMemberHistory(entry.data, sources.get(recordId));
      if (projection) entries.push(projection);
    }
    const nextCursor = documents.length > 50 ? randomUUID() : null;
    // All source and permission reads above participate in the same transaction as the cursor.
    if (nextCursor) tx.create(db.doc(`${base}/memberDirectoryCursorStates/${nextCursor}`), cursorSchema.parse({
      kind: "account-history-v1", academyId, actorId, studentId, identityDigest, after: documents[49]!.id,
      expiresAt: new Date(now.getTime() + 1_800_000).toISOString(),
    }));
    tx.set(quotaRef, { academyId, actorId, count: count + 1, windowStart: fresh ? quota!.windowStart : now.getTime() });
    return accountMemberHistoryPageSchema.parse({ studentId, entries, nextCursor, coverage: "confirmed-captured-records-only" });
  });
}
