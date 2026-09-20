import { HttpsError } from "firebase-functions/v2/https";
import { memberIdentityAliasSchema, reviewIdentifierSchema } from "@bpt-jersey/domain/members/reconciliation";
import type { CanonicalDirectoryReadTransaction } from "./canonical-member-directory-read-service.js";

/** Read-only identity resolution. It never grants account or guardian access. */
export async function resolveCanonicalStudentIdInTransaction(
  tx: Pick<CanonicalDirectoryReadTransaction, "get">, academyId: string, studentId: string,
): Promise<string> {
  reviewIdentifierSchema.parse(academyId); reviewIdentifierSchema.parse(studentId);
  const seen = new Set<string>();
  let current = studentId;
  for (let depth = 0; depth < 16; depth++) {
    if (seen.has(current)) throw new HttpsError("failed-precondition", "Member identity aliases contain a cycle");
    seen.add(current);
    const doc = await tx.get(`academies/${academyId}/memberIdentityAliases/${current}`);
    if (!doc.exists) return current;
    const parsed = memberIdentityAliasSchema.safeParse(doc.data);
    if (!parsed.success || parsed.data.academyId !== academyId || parsed.data.studentId !== current) {
      throw new HttpsError("failed-precondition", "Member identity alias is invalid");
    }
    current = parsed.data.canonicalStudentId;
  }
  throw new HttpsError("failed-precondition", "Member identity alias chain requires review");
}

/** Canonical identity plus the bounded set of approved historical IDs; permissions stay per subject. */
export async function canonicalMemberIdentityIds(
  tx: CanonicalDirectoryReadTransaction, academyId: string, studentId: string,
): Promise<readonly string[]> {
  const canonicalId = await resolveCanonicalStudentIdInTransaction(tx, academyId, studentId);
  if (!tx.listCollection) throw new HttpsError("failed-precondition", "Member identity queries are unavailable");
  const aliases = await tx.listCollection({ academyId, collection: "memberIdentityAliases",
    equal: { field: "canonicalStudentId", value: canonicalId }, limit: 21 });
  if (aliases.length > 20) throw new HttpsError("failed-precondition", "Member identity needs a bounded migration review");
  for (const doc of aliases) {
    const parsed = memberIdentityAliasSchema.safeParse(doc.data);
    if (!parsed.success || parsed.data.academyId !== academyId || parsed.data.studentId !== doc.id || parsed.data.canonicalStudentId !== canonicalId) {
      throw new HttpsError("failed-precondition", "Historical identity ownership is invalid");
    }
  }
  return [canonicalId, ...aliases.map((doc) => doc.id)];
}
