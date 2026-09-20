import { currentMembershipStatuses, parseMembershipRecord } from "@bpt-jersey/domain/memberships/lifecycle";
import { canonicalMemberIdentityIds, resolveCanonicalStudentIdInTransaction } from "./member-identity-resolution.js";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { parseMemberRecord } from "@bpt-jersey/domain/members";
import { studentAdminProfileSchema } from "@bpt-jersey/domain/members/directory";
import { parseStoredRegyfitMemberRecord } from "@bpt-jersey/domain/members/regyfit-records";
import { parseStudentProfileAt } from "@bpt-jersey/domain/profiles";
import {
  reconciliationCaseInputSchema, reconciliationCaseSchema, reconciliationDecisionInputSchema,
  closeReconciliationInputSchema, reconciliationDecisionSchema, reconciliationFieldNames,
  reconciliationFieldSchema, reconciliationWriterFor, reviewIdentifierSchema, reviewRevisionSchema,
  validReconciliationValue, type ReconciliationCase, type ReconciliationDecisionInput,
  type CloseReconciliationInput, type ReconciliationField, type ReconciliationFieldName, type ReviewValue,
} from "@bpt-jersey/domain/members/reconciliation";
import type { CanonicalMemberDirectoryActor } from "./canonical-member-directory-service.js";
import { runRestricted, type CanonicalDirectoryReadTransaction, type CanonicalMemberDirectoryReadDependencies,
  type DirectoryReadDocument } from "./canonical-member-directory-read-service.js";
import { canonicalizeMemberDirectoryValue, constantTimeMacEquals, createMemberDirectoryIntegrityMac } from "./member-directory-crypto.js";
import { prepareMemberReviewWrite, type MemberReviewIntegrity } from "./member-review-transaction.js";

export type MemberReconciliationDependencies = CanonicalMemberDirectoryReadDependencies & MemberReviewIntegrity;
type Values = Partial<Record<ReconciliationFieldName, ReviewValue>>;
type Source = { sourceId: string; version: string; capturedAt: string | null; values: Values };
const savedDecisionSchema = z.strictObject({
  decision: reconciliationDecisionSchema, sourceRevision: reviewRevisionSchema,
  before: reconciliationFieldSchema, actorId: reviewIdentifierSchema, decidedAt: z.iso.datetime(), requestId: z.uuid(),
});
const savedCaseSchema = z.strictObject({
  academyId: reviewIdentifierSchema, studentId: reviewIdentifierSchema,
  decisions: z.record(z.string(), savedDecisionSchema).refine((value) => Object.keys(value).length <= 30),
  closedRevision: reviewRevisionSchema.nullable(), updatedBy: reviewIdentifierSchema,
  updatedAt: z.iso.datetime(), schemaVersion: z.literal("1"),
});
type SavedCase = z.infer<typeof savedCaseSchema>;
const equal = (a: unknown, b: unknown) => canonicalizeMemberDirectoryValue(a) === canonicalizeMemberDirectoryValue(b);
const stringOrNull = (value: unknown): string | null => typeof value === "string" ? value : null;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
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
function requireSource(doc: DirectoryReadDocument, academyId: string): Record<string, unknown> {
  if (!doc.exists || !doc.version || !doc.data || (doc.data.academyId !== undefined && doc.data.academyId !== academyId)) {
    throw new HttpsError("failed-precondition", "A source needs inventory review before reconciliation");
  }
  return doc.data;
}
function emptyCase(academyId: string, studentId: string, actorId: string, now: string): SavedCase {
  return { academyId, studentId, decisions: {}, closedRevision: null, updatedBy: actorId, updatedAt: now, schemaVersion: "1" };
}

/** Fetch only explicitly linked source identities. Names and family emails never create links here. */
async function loadReview(
  tx: CanonicalDirectoryReadTransaction, deps: MemberReconciliationDependencies,
  actor: CanonicalMemberDirectoryActor, studentId: string, now: string,
) {
  const academyId = actor.academyId;
  const base = `academies/${academyId}`;
  const documents = new Map<string, DirectoryReadDocument>();
  const read = async (collection: string, id: string) => {
    reviewIdentifierSchema.parse(id);
    const key = `${collection}/${id}`;
    const doc = await tx.get(`${base}/${key}`); documents.set(key, doc); return doc;
  };
  const [studentDoc, profileDoc, progressDoc, caseDoc] = await Promise.all([
    read("students", studentId), read("studentAdminProfiles", studentId), read("studentLevelProgress", studentId),
    read("memberReconciliationCases", studentId),
  ]);
  if (!studentDoc.exists) throw new HttpsError("not-found", "Member record was not found");
  const studentRaw = requireSource(studentDoc, academyId);
  // Persisted classification is validated at its own write date; live permissions use the access policy.
  const student = parseStudentProfileAt(studentRaw, stringOrNull(studentRaw.updatedAt)?.slice(0, 10) ?? now.slice(0, 10));
  if (!student.ok || student.value.studentId !== studentId || student.value.academyId !== academyId) {
    throw new HttpsError("failed-precondition", "Canonical member needs inventory review");
  }
  const profile = profileDoc.exists ? studentAdminProfileSchema.parse(requireSource(profileDoc, academyId)) : undefined;
  if (profile && (profile.studentId !== studentId || profile.academyId !== academyId)) {
    throw new HttpsError("failed-precondition", "Administrative profile has a conflicting identity");
  }
  const stored = caseDoc.exists ? savedCaseSchema.parse(requireSource(caseDoc, academyId)) : emptyCase(academyId, studentId, actor.actorId, now);
  if (stored.studentId !== studentId || stored.academyId !== academyId) throw new HttpsError("failed-precondition", "Invalid member review");
  const sources = new Map<string, Source>();
  const identityIds = await canonicalMemberIdentityIds(tx, academyId, studentId);
  const groups = await Promise.all(["regyfitOfficeLinks", "regyfitMemberLinks", "memberRecoverySourceLinks", "memberMigrationDecisions"].map(async (collection) => {
    const docs = (await Promise.all(identityIds.map((id) => boundedMemberReferences(tx, academyId, collection, id)))).flat();
    if (docs.length > 20) throw new HttpsError("failed-precondition", "Too many source links. Review this identity in bounded migration chunks");
    docs.forEach((doc) => documents.set(`${collection}/${doc.id}`, doc));
    return { collection, docs };
  }));
  const legacyIds = new Set<string>();
  const regyfitIds = new Set<string>();
  if (profile?.source === "legacy-member-migration") legacyIds.add(profile.legacyMemberId);
  for (const { collection, docs } of groups) for (const doc of docs) {
    const raw = requireSource(doc, academyId);
    if (!identityIds.includes(String(raw.studentId)) || raw.academyId !== academyId || raw.schemaVersion !== "1") {
      throw new HttpsError("failed-precondition", "Source ownership needs review");
    }
    if (collection === "memberMigrationDecisions") {
      legacyIds.add(reviewIdentifierSchema.parse(raw.legacyMemberId));
      if (raw.recordId) regyfitIds.add(z.string().regex(/^[0-9]{1,12}$/u).parse(raw.recordId));
    } else regyfitIds.add(z.string().regex(/^[0-9]{1,12}$/u).parse(raw.recordId));
  }
  if (legacyIds.size + regyfitIds.size > 20) throw new HttpsError("failed-precondition", "Source review exceeds the case limit");
  for (const id of [...legacyIds].sort()) {
    const doc = await read("members", id); const parsed = parseMemberRecord(requireSource(doc, academyId));
    if (!parsed.ok || parsed.value.memberId !== id) throw new HttpsError("failed-precondition", "Legacy source is invalid");
    const value = parsed.value;
    sources.set(`legacy:${id}`, { sourceId: `legacy:${id}`, version: doc.version!, capturedAt: null, values: {
      fullName: value.fullName, dateOfBirth: value.birthDate ?? null, membershipNumber: value.membershipNumber ?? null,
      idCardNumber: value.idCardNumber ?? null, vatNumber: value.vatNumber ?? null,
      gender: value.gender, email: value.email ?? null, phoneNumber: value.mobileNumber ?? null,
      membershipState: value.membershipStatus, trainingCenter: value.trainingCenter ?? null, frequency: value.frequency ?? null,
    } });
  }
  for (const id of [...regyfitIds].sort()) {
    const doc = await read("regyfitMemberRecords", id); const parsed = parseStoredRegyfitMemberRecord(requireSource(doc, academyId));
    if (!parsed.ok || parsed.value.recordId !== id) throw new HttpsError("failed-precondition", "Regyfit source is invalid");
    // Validate competing direct links as part of the same read set; no source winner is inferred.
    for (const collection of ["regyfitOfficeLinks", "regyfitMemberLinks"]) {
      const link = await read(collection, id);
      if (link.exists && (!identityIds.includes(String(link.data?.studentId)) || link.data?.academyId !== academyId || link.data?.recordId !== id)) {
        throw new HttpsError("failed-precondition", "A Regyfit source belongs to competing member identities");
      }
    }
    const value = parsed.value;
    sources.set(`regyfit:${id}`, { sourceId: `regyfit:${id}`, version: doc.version!, capturedAt: value.capturedAt, values: {
      fullName: value.fullName, dateOfBirth: value.birthDate ?? null, email: value.email ?? null, phoneNumber: value.mobile ?? null,
      membershipNumber: value.memberNumber ?? null, idCardNumber: value.idCardNumber ?? null, vatNumber: value.vatNumber ?? null,
      gender: value.gender, address: value.address ?? null, emergencyContact: value.emergencyContact ?? null, nickname: value.nickname ?? null,
      membershipState: value.membershipState, frequency: value.plan.frequency ?? null, plan: value.plan.membershipPlan ?? null,
      paidPeriod: value.plan.validFrom || value.plan.validUntil ? `${value.plan.validFrom ?? "unknown"} / ${value.plan.validUntil ?? "unknown"}` : null,
      // Exact movements remain in the protected source. A missing captured movement is unknown, never £0.
      payments: value.payments.length ? value.payments.map((_, index) => `regyfit:${id}:payment:${index}`) : null,
      level: value.graduation.belt ?? null,
      progress: value.graduation.classesProgress || value.graduation.daysProgress ? [value.graduation.classesProgress, value.graduation.daysProgress].filter((v): v is string => v !== undefined) : null,
      attendance: value.attendance.records.length ? value.attendance.records.map((_, index) => `regyfit:${id}:attendance:${index}`) : null,
    } });
  }
  const memberships = await boundedMemberReferences(tx, academyId, "memberships", studentId);
  if (memberships.length > 20) throw new HttpsError("failed-precondition", "Review membership history in bounded pages first");
  memberships.forEach((doc) => {
    const parsed = parseMembershipRecord(requireSource(doc, academyId));
    if (!parsed.ok || parsed.value.membershipId !== doc.id || parsed.value.studentId !== studentId) throw new HttpsError("failed-precondition", "A membership needs inventory review");
    documents.set(`memberships/${doc.id}`, doc);
  });
  const active = memberships.filter((doc) => (currentMembershipStatuses as readonly string[]).includes(String(doc.data?.status)));
  const progress = progressDoc.exists ? requireSource(progressDoc, academyId) : {};
  const details = object(profile?.details);
  const current: Values = {
    fullName: student.value.fullName, dateOfBirth: student.value.dateOfBirth ?? null,
    email: student.value.email ?? null, phoneNumber: student.value.phoneNumber ?? null,
    trainingCenter: student.value.trainingCenter ?? null, frequency: profile?.frequencyNote ?? null, membershipNumber: profile?.membershipNumber ?? null,
    idCardNumber: profile?.idCardNumber ?? null, vatNumber: profile?.vatNumber ?? null, gender: profile?.gender ?? null,
    address: profile?.postalAddress?.line ?? null, emergencyContact: profile?.emergencyContact?.phoneNumber ?? null,
    nickname: stringOrNull(details.nickname), membershipState: active.length === 1 ? stringOrNull(active[0]?.data?.status) : null,
    plan: active.length === 1 ? stringOrNull(active[0]?.data?.planId) : null,
    paidPeriod: active.length === 1 ? `${active[0]?.data?.startsAt ?? "unknown"} / ${active[0]?.data?.endsAt ?? "unknown"}` : null,
    payments: null, level: stringOrNull(progress.currentDefinitionKey), progress: null, attendance: null, guardian: null,
  };
  const sourceList = [...sources.values()];
  const currentVersion = memberReviewDigest(deps, "member-review-current-v1", [...documents].filter(([key]) =>
    ["students", "studentAdminProfiles", "studentLevelProgress", "memberships"].includes(key.split("/")[0]!))
    .map(([key, doc]) => [key, doc.version ?? "absent"]).sort((a, b) => a[0]!.localeCompare(b[0]!)));
  const fields: ReconciliationField[] = reconciliationFieldNames.map((field) => {
    const currentValue = current[field] ?? null;
    const sourceValues = sourceList.flatMap((source) => source.values[field] === undefined || source.values[field] === null ? [] : [{
      sourceId: source.sourceId, version: source.version, capturedAt: source.capturedAt, value: source.values[field]!,
    }]);
    const sourceRevision = memberReviewDigest(deps, "member-review-sources-v1", sourceValues);
    const saved = stored.decisions[field];
    const decision = saved?.sourceRevision === sourceRevision ? saved.decision : null;
    const differs = sourceValues.some((source) => !equal(source.value, currentValue));
    let state: ReconciliationField["state"] = differs ? "needs-decision" : "consistent";
    if (decision) {
      if (decision.resolution === "historical-period") state = "resolved";
      else if (equal(decision.value, currentValue)) state = "resolved";
      else state = decision.resolution === "retain-current" ? "needs-decision" : "pending-application";
    }
    return { field, currentValue, currentVersion, sourceValues, decision, writer: reconciliationWriterFor(field), state };
  });
  const revision = memberReviewDigest(deps, "member-review-case-v1", { academyId, studentId,
    documents: [...documents].filter(([key]) => !key.startsWith("memberReconciliationCases/")).map(([key, doc]) => [key, doc.version ?? "absent"]).sort((a, b) => a[0]!.localeCompare(b[0]!)),
    decisions: stored.decisions, fields,
  });
  const unresolvedFields = fields.filter((field) => ["needs-decision", "pending-application"].includes(field.state)).map((field) => field.field);
  const view = reconciliationCaseSchema.parse({ studentId, revision, fields, unresolvedFields,
    status: stored.closedRevision === revision && unresolvedFields.length === 0 ? "closed" : "open", sourceCoverage: "captured-records-only" });
  return { view, stored };
}

export type MemberReconciliationService = Readonly<{
  getCase(academyId: string, studentId: string): Promise<ReconciliationCase>;
  decide(actor: CanonicalMemberDirectoryActor, input: ReconciliationDecisionInput): Promise<ReconciliationCase>;
  close(actor: CanonicalMemberDirectoryActor, input: CloseReconciliationInput): Promise<ReconciliationCase>;
  resolveCanonicalStudentId(academyId: string, studentId: string): Promise<string>;
}>;
export function createMemberReconciliationService(
  deps: MemberReconciliationDependencies, actor: CanonicalMemberDirectoryActor, now = () => new Date().toISOString(),
): MemberReconciliationService {
  const run = <T>(value: unknown, operation: (tx: CanonicalDirectoryReadTransaction, time: string) => Promise<T>) => {
    const time = now();
    return runRestricted<T>({ dependencies: deps, command: { actor, value, now: time },
      action: "member.detail.read", purpose: "member-record-maintenance", operation: async (tx) => ({
        kind: "success", value: await operation(tx, time), auditResult: "completed",
      }),
    });
  };
  const mutate = (acting: CanonicalMemberDirectoryActor, input: ReconciliationDecisionInput | CloseReconciliationInput, close: boolean) => {
    if (!equal(acting, actor)) throw new HttpsError("permission-denied", "Member review actor mismatch");
    return run(input, async (tx, time) => {
      const base = `academies/${actor.academyId}`;
      const receiptPath = `${base}/memberReconciliationDecisions/${input.requestId}`;
      const receipt = await tx.get(receiptPath);
      const bodyDigest = memberReviewDigest(deps, "member-review-request-v1", { actorId: actor.actorId, input, close });
      if (receipt.exists) {
        if (typeof receipt.data?.bodyDigest !== "string" || !constantTimeMacEquals(receipt.data.bodyDigest, bodyDigest)) {
          throw new HttpsError("failed-precondition", "This request ID was already used for another decision");
        }
        return reconciliationCaseSchema.parse(receipt.data.result);
      }
      const { view, stored } = await loadReview(tx, deps, actor, input.studentId, time);
      if (view.revision !== input.expectedRevision) throw new HttpsError("failed-precondition", "This review has changed. Refresh it before saving");
      const next: SavedCase = { ...stored, closedRevision: null, updatedAt: time, updatedBy: actor.actorId, decisions: { ...stored.decisions } };
      if (close) {
        if (view.unresolvedFields.length) throw new HttpsError("failed-precondition", "Resolve every discrepancy before closing this review");
        next.closedRevision = view.revision;
      } else {
        const { decision } = input as ReconciliationDecisionInput;
        const field = view.fields.find((candidate) => candidate.field === decision.field)!;
        if (decision.sourceIds.some((id) => !field.sourceValues.some((source) => source.sourceId === id))) {
          throw new HttpsError("invalid-argument", "Select evidence from this field's sources");
        }
        if (decision.resolution === "retain-current" && !equal(decision.value, field.currentValue)) {
          throw new HttpsError("invalid-argument", "Retaining the current value must keep it unchanged");
        }
        if (decision.resolution === "use-source" && !field.sourceValues.some((source) =>
          decision.sourceIds.includes(source.sourceId) && equal(source.value, decision.value))) {
          throw new HttpsError("invalid-argument", "Select the exact reviewed source value");
        }
        if (["use-source", "verified-correction"].includes(decision.resolution) && !validReconciliationValue(decision.field, decision.value)) {
          throw new HttpsError("invalid-argument", "This value cannot be applied by the field's editor");
        }
        if (decision.resolution === "historical-period" && (decision.sourceIds.length === 0 ||
          !["subscription", "progression", "history"].includes(field.writer))) {
          throw new HttpsError("invalid-argument", "Historical decisions require a payment, progress or attendance source");
        }
        next.decisions[decision.field] = { decision, before: field,
          sourceRevision: memberReviewDigest(deps, "member-review-sources-v1", field.sourceValues),
          requestId: input.requestId, actorId: actor.actorId, decidedAt: time };
      }
      const commit = await prepareMemberReviewWrite(tx, deps, actor, input.requestId, input.studentId, time);
      // Recompute against the same snapshots with an in-memory case: no read follows a write.
      const projectedTx: CanonicalDirectoryReadTransaction = { ...tx, get: async (path) => path === `${base}/memberReconciliationCases/${input.studentId}`
        ? { id: input.studentId, exists: true, version: "projected", data: next } : tx.get(path) };
      const result = (await loadReview(projectedTx, deps, actor, input.studentId, time)).view;
      tx.set(`${base}/memberReconciliationCases/${input.studentId}`, next);
      tx.create(receiptPath, { academyId: actor.academyId, studentId: input.studentId, actorId: actor.actorId,
        requestId: input.requestId, bodyDigest, before: view, result, input, kind: close ? "close" : "decision", occurredAt: time, schemaVersion: "1" });
      commit();
      return result;
    });
  };
  return {
    getCase(academyId, studentId) {
      if (academyId !== actor.academyId) throw new HttpsError("permission-denied", "Academy mismatch");
      const input = reconciliationCaseInputSchema.parse({ studentId });
      return run(input, async (tx, time) => (await loadReview(tx, deps, actor, await resolveCanonicalStudentIdInTransaction(tx, academyId, input.studentId), time)).view);
    },
    resolveCanonicalStudentId(academyId, studentId) {
      if (academyId !== actor.academyId) throw new HttpsError("permission-denied", "Academy mismatch");
      return run({ studentId }, (tx) => resolveCanonicalStudentIdInTransaction(tx, academyId, studentId));
    },
    decide(acting, input) { return mutate(acting, reconciliationDecisionInputSchema.parse(input), false); },
    close(acting, input) { return mutate(acting, closeReconciliationInputSchema.parse(input), true); },
  };
}
