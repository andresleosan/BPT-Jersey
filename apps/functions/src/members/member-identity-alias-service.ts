import { HttpsError } from "firebase-functions/v2/https";
import {
  aliasPreviewInputSchema, aliasPreviewSchema, approveAliasInputSchema, memberIdentityAliasSchema,
  type AliasPreview,
} from "@bpt-jersey/domain/members/reconciliation";
import { normalizeAdministrativeIdentifier, studentAdminProfileSchema } from "@bpt-jersey/domain/members/directory";
import { parseStudentProfileAt } from "@bpt-jersey/domain/profiles";
import type { CanonicalMemberDirectoryActor } from "./canonical-member-directory-service.js";
import { runRestricted, type CanonicalDirectoryReadTransaction } from "./canonical-member-directory-read-service.js";
import { boundedMemberReferences, memberReviewDigest, type MemberReconciliationDependencies } from "./member-reconciliation-service.js";
import { prepareMemberReviewWrite } from "./member-review-transaction.js";
import { deriveStudentIdentityKeyId, studentIdentityKeySchema, constantTimeMacEquals } from "./member-directory-crypto.js";

import { resolveCanonicalStudentIdInTransaction } from "./member-identity-resolution.js";

const referenceCollections = ["memberships", "bookings", "attendance", "relationships",
  "regyfitOfficeLinks", "regyfitMemberLinks", "memberRecoverySourceLinks", "memberMigrationDecisions"] as const;
async function preview(
  tx: CanonicalDirectoryReadTransaction, deps: MemberReconciliationDependencies,
  actor: CanonicalMemberDirectoryActor, studentId: string, canonicalStudentId: string,
): Promise<AliasPreview> {
  const base = `academies/${actor.academyId}`;
  const blockers = new Set<string>();
  const versions: unknown[] = [];
  const profiles = [];
  const students = [];
  for (const id of [studentId, canonicalStudentId]) {
    const [studentDoc, profileDoc, aliasDoc] = await Promise.all([tx.get(`${base}/students/${id}`),
      tx.get(`${base}/studentAdminProfiles/${id}`), tx.get(`${base}/memberIdentityAliases/${id}`)]);
    const student = parseStudentProfileAt(studentDoc.data, typeof studentDoc.data?.updatedAt === "string" ? studentDoc.data.updatedAt.slice(0, 10) : "invalid");
    const profile = studentAdminProfileSchema.safeParse(profileDoc.data);
    if (!student.ok || !profile.success || student.value.studentId !== id || profile.data.studentId !== id ||
        student.value.academyId !== actor.academyId || profile.data.academyId !== actor.academyId || !studentDoc.version || !profileDoc.version) {
      throw new HttpsError("failed-precondition", "Both member identities must pass inventory review");
    }
    students.push(student.value); profiles.push(profile.data);
    if (aliasDoc.exists) blockers.add("An identity already has an alias. Refresh its canonical record");
    versions.push([id, studentDoc.version, profileDoc.version, aliasDoc.version ?? "absent"]);
  }
  const source = students[0]!; const target = students[1]!;
  if (profiles[0]!.vatNumber && profiles[1]!.vatNumber && profiles[0]!.vatNumber !== profiles[1]!.vatNumber) blockers.add("Tax identifiers conflict");
  if (source.userId || source.familyId) blockers.add("Review and release the source account or guardian link before combining identities");
  if (source.dateOfBirth && target.dateOfBirth && source.dateOfBirth !== target.dateOfBirth) blockers.add("Dates of birth conflict");
  const identityEvidence: Array<"membership-number" | "id-card-number"> = [];
  for (const [field, evidence] of [["membershipNumber", "membership-number"], ["idCardNumber", "id-card-number"]] as const) {
    const left = profiles[0]![field]; const right = profiles[1]![field];
    if (left && right) {
      if (normalizeAdministrativeIdentifier(left) === normalizeAdministrativeIdentifier(right)) identityEvidence.push(evidence);
      else blockers.add(`Conflicting ${field}`);
    }
  }
  if (!identityEvidence.length) blockers.add("A compatible unique identifier is required; names and email addresses are insufficient");
  for (const profile of profiles) for (const [field, kind] of [["membershipNumber", "membership-number"], ["idCardNumber", "id-card-number"], ["vatNumber", "vat-number"]] as const) {
    const value = profile[field];
    if (!value) continue;
    const keyId = deriveStudentIdentityKeyId({ academyId: actor.academyId, kind, value, secretMaterial: deps.identitySecretMaterial });
    const keyDoc = await tx.get(`${base}/studentIdentityKeys/${keyId}`);
    const key = studentIdentityKeySchema.safeParse(keyDoc.data);
    if (!key.success || key.data.academyId !== actor.academyId || key.data.keyId !== keyId ||
        ![studentId, canonicalStudentId].includes(key.data.ownerStudentId)) blockers.add("An identity reservation has conflicting ownership");
    versions.push(["identity-key", keyId, keyDoc.version ?? "absent"]);
  }
  const references: AliasPreview["references"] = [];
  let totalReferences = 0;
  const activePlans = new Map<string, number>();
  const bookingSessions = new Map<string, string>();
  for (const collection of referenceCollections) for (const id of [studentId, canonicalStudentId]) {
    const docs = await boundedMemberReferences(tx, actor.academyId, collection, id, 51);
    const complete = docs.length <= 50;
    if (!complete) blockers.add("The reference union needs a bounded migration operation");
    totalReferences += docs.length;
    references.push({ collection, studentId: id, ids: docs.slice(0, 50).map((doc) => doc.id), complete });
    for (const doc of docs) {
      if (!doc.version || doc.data?.academyId !== actor.academyId || doc.data?.studentId !== id) blockers.add("A referenced record needs inventory review");
      versions.push([collection, id, doc.id, doc.version ?? "unavailable"]);
      if (collection === "bookings") {
        const sessionId = doc.data?.sessionId;
        if (typeof sessionId !== "string") blockers.add("A booking needs inventory review");
        else {
          const previous = bookingSessions.get(sessionId);
          if (previous && previous !== doc.id) blockers.add("Duplicate session bookings require reconciliation before combining identities");
          bookingSessions.set(sessionId, doc.id);
        }
      }
      if (collection === "relationships" && id === studentId && doc.data?.status === "active") blockers.add("An active source relationship needs a separate link decision");
      if (collection === "memberships" && ["trial", "active", "paused", "overdue"].includes(String(doc.data?.status))) activePlans.set(id, (activePlans.get(id) ?? 0) + 1);
    }
  }
  // Billing ownership follows membership -> invoice -> payment, never payer family alone.
  if (!tx.listCollection) throw new HttpsError("failed-precondition", "Billing queries are unavailable");
  for (const id of [studentId, canonicalStudentId]) {
    const membershipIds = references.find((row) => row.collection === "memberships" && row.studentId === id)!.ids;
    const invoiceIds = new Set<string>(), paymentIds = new Set<string>();
    let complete = true;
    for (const membershipId of membershipIds) {
      if (totalReferences > 250) { complete = false; break; }
      const invoices = await tx.listCollection({ academyId: actor.academyId, collection: "invoices",
        equal: { field: "membershipId", value: membershipId }, limit: 51 });
      if (invoices.length > 50) complete = false;
      totalReferences += invoices.length;
      for (const invoice of invoices.slice(0, 50)) {
        invoiceIds.add(invoice.id);
        versions.push(["invoices", id, invoice.id, invoice.version ?? "unavailable"]);
        if (!invoice.version || invoice.data?.academyId !== actor.academyId || invoice.data?.membershipId !== membershipId) blockers.add("Billing ownership needs inventory review");
        if (totalReferences > 250) { complete = false; break; }
        const payments = await tx.listCollection({ academyId: actor.academyId, collection: "payments",
          equal: { field: "invoiceId", value: invoice.id }, limit: 51 });
        if (payments.length > 50) complete = false;
        totalReferences += payments.length;
        for (const payment of payments.slice(0, 50)) {
          paymentIds.add(payment.id);
          versions.push(["payments", id, payment.id, payment.version ?? "unavailable"]);
          if (!payment.version || payment.data?.academyId !== actor.academyId || payment.data?.invoiceId !== invoice.id) blockers.add("Billing ownership needs inventory review");
        }
      }
    }
    if (!complete || invoiceIds.size > 100 || paymentIds.size > 100) blockers.add("The billing union needs a bounded migration operation");
    references.push({ collection: "invoices", studentId: id, ids: [...invoiceIds].slice(0, 100), complete: complete && invoiceIds.size <= 100 },
      { collection: "payments", studentId: id, ids: [...paymentIds].slice(0, 100), complete: complete && paymentIds.size <= 100 });
  }
  if (totalReferences > 250) blockers.add("The reference union needs a bounded migration operation");
  if ((activePlans.get(studentId) ?? 0) + (activePlans.get(canonicalStudentId) ?? 0) > 1) {
    blockers.add("Multiple active subscriptions require financial reconciliation first");
  }
  if (!tx.listCollection) throw new HttpsError("failed-precondition", "Alias queries are unavailable");
  // A source with incoming aliases cannot become an alias itself. This also prevents concurrent cycles.
  for (const id of [studentId, canonicalStudentId]) {
    const incoming = await tx.listCollection({ academyId: actor.academyId, collection: "memberIdentityAliases",
      equal: { field: "canonicalStudentId", value: id }, limit: 21 });
    if ((id === studentId && incoming.length) || incoming.length >= 20) blockers.add("Existing alias ownership requires a separate migration review");
    versions.push(["incoming-aliases", id, incoming.map((doc) => [doc.id, doc.version ?? "unavailable"])]);
  }
  const revision = memberReviewDigest(deps, "member-alias-preview-v1", { academyId: actor.academyId, studentId, canonicalStudentId, versions });
  return aliasPreviewSchema.parse({ studentId, canonicalStudentId, revision, identityEvidence, blockers: [...blockers], references });
}
export function createMemberIdentityAliasService(
  deps: MemberReconciliationDependencies, actor: CanonicalMemberDirectoryActor, now = () => new Date().toISOString(),
) {
  const run = <T>(input: unknown, operation: (tx: CanonicalDirectoryReadTransaction, time: string) => Promise<T>) => {
    const time = now();
    return runRestricted<T>({ dependencies: deps, command: { actor, value: input, now: time },
      action: "member.detail.read", purpose: "member-record-maintenance",
      operation: async (tx) => ({ kind: "success", auditResult: "completed", value: await operation(tx, time) }),
    });
  };
  return {
    preview(input: unknown) {
      const value = aliasPreviewInputSchema.parse(input);
      return run(value, (tx) => preview(tx, deps, actor, value.studentId, value.canonicalStudentId));
    },
    approve(input: unknown) {
      const value = approveAliasInputSchema.parse(input);
      return run(value, async (tx, time) => {
        const base = `academies/${actor.academyId}`;
        const path = `${base}/memberReconciliationDecisions/${value.requestId}`;
        const receipt = await tx.get(path);
        const bodyDigest = memberReviewDigest(deps, "member-alias-request-v1", { actorId: actor.actorId, value });
        if (receipt.exists) {
          if (typeof receipt.data?.bodyDigest !== "string" || !constantTimeMacEquals(receipt.data.bodyDigest, bodyDigest)) {
            throw new HttpsError("failed-precondition", "This request ID was already used for another decision");
          }
          return memberIdentityAliasSchema.parse(receipt.data.result);
        }
        const current = await preview(tx, deps, actor, value.studentId, value.canonicalStudentId);
        if (current.revision !== value.expectedRevision) throw new HttpsError("failed-precondition", "This identity preview has changed. Refresh before approving");
        if (current.blockers.length) throw new HttpsError("failed-precondition", "Resolve identity and relationship conflicts before approving this alias");
        const commit = await prepareMemberReviewWrite(tx, deps, actor, value.requestId, value.canonicalStudentId, time, "member-identity-alias");
        const result = memberIdentityAliasSchema.parse({ academyId: actor.academyId, studentId: value.studentId,
          canonicalStudentId: value.canonicalStudentId, requestId: value.requestId, evidence: value.evidence, reason: value.reason,
          previewRevision: current.revision, approvedBy: actor.actorId, approvedAt: time, schemaVersion: "1" });
        tx.create(`${base}/memberIdentityAliases/${value.studentId}`, result);
        tx.create(path, { academyId: actor.academyId, actorId: actor.actorId, requestId: value.requestId,
          bodyDigest, before: current, result, occurredAt: time, kind: "identity-alias", schemaVersion: "1" });
        commit();
        return result;
      });
    },
    resolveCanonicalStudentId(academyId: string, studentId: string) {
      if (academyId !== actor.academyId) throw new HttpsError("permission-denied", "Academy mismatch");
      return run({ studentId }, (tx) => resolveCanonicalStudentIdInTransaction(tx, academyId, studentId));
    },
  };
}
