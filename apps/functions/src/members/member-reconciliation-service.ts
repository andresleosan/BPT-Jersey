import { HttpsError } from "firebase-functions/v2/https";
import type { CanonicalDirectoryReadTransaction, CanonicalMemberDirectoryReadDependencies,
  DirectoryReadDocument } from "./canonical-member-directory-read-service.js";
import { canonicalizeMemberDirectoryValue, createMemberDirectoryIntegrityMac } from "./member-directory-crypto.js";
import type { MemberReviewIntegrity } from "./member-review-transaction.js";

export type MemberReconciliationDependencies = CanonicalMemberDirectoryReadDependencies & MemberReviewIntegrity;
export function memberReviewDigest(deps: MemberReviewIntegrity, domain: string, value: unknown): string {
  return createMemberDirectoryIntegrityMac({ domain, secretMaterial: deps.integritySecretMaterial,
    values: [deps.projectId, canonicalizeMemberDirectoryValue(value)] });
}
export async function boundedMemberReferences(
  tx: CanonicalDirectoryReadTransaction, academyId: string, collection: string, studentId: string, limit = 21,
): Promise<readonly DirectoryReadDocument[]> {
  if (!tx.listCollection) throw new HttpsError("failed-precondition", "Member review queries are unavailable");
  return tx.listCollection({ academyId, collection, equal: { field: "studentId", value: studentId }, limit });
}
