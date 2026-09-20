import { z } from "zod";

export const reviewIdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
export const reviewRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const reviewValueSchema = z.union([
  z.null(), z.boolean(), z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER), z.string().max(2000),
  z.array(z.string().max(320)).max(50).readonly(),
]);
export type ReviewValue = z.infer<typeof reviewValueSchema>;
export const reconciliationFieldNames = [
  "fullName", "dateOfBirth", "email", "phoneNumber", "membershipNumber", "idCardNumber",
  "vatNumber", "gender", "trainingCenter", "frequency", "address", "emergencyContact", "nickname",
  "membershipState", "plan", "paidPeriod", "payments", "level", "progress", "attendance", "guardian",
] as const;
export const reconciliationFieldNameSchema = z.enum(reconciliationFieldNames);
export type ReconciliationFieldName = z.infer<typeof reconciliationFieldNameSchema>;
export const reconciliationWriterSchema = z.enum(["personal", "subscription", "progression", "guardian", "history"]);
export type ReconciliationWriter = z.infer<typeof reconciliationWriterSchema>;

const sourceId = z.string().regex(/^(?:legacy|regyfit|history):[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
export const reconciliationDecisionSchema = z.strictObject({
  field: reconciliationFieldNameSchema,
  resolution: z.enum(["retain-current", "use-source", "verified-correction", "historical-period"]),
  value: reviewValueSchema,
  sourceIds: z.array(sourceId).max(20).refine((ids) => new Set(ids).size === ids.length),
  evidence: z.string().trim().min(3).max(1000),
  reason: z.string().trim().min(3).max(500),
});
export type ReconciliationDecision = Readonly<z.infer<typeof reconciliationDecisionSchema>>;
export const reconciliationSourceValueSchema = z.strictObject({
  sourceId, version: z.string().min(1).max(160), capturedAt: z.iso.datetime().nullable(), value: reviewValueSchema,
});
export const reconciliationFieldSchema = z.strictObject({
  field: reconciliationFieldNameSchema, currentValue: reviewValueSchema, currentVersion: reviewRevisionSchema,
  sourceValues: z.array(reconciliationSourceValueSchema).max(20),
  decision: reconciliationDecisionSchema.nullable(), writer: reconciliationWriterSchema,
  state: z.enum(["consistent", "needs-decision", "pending-application", "resolved"]),
});
export type ReconciliationField = Readonly<z.infer<typeof reconciliationFieldSchema>>;
export const reconciliationCaseSchema = z.strictObject({
  studentId: reviewIdentifierSchema, revision: reviewRevisionSchema,
  fields: z.array(reconciliationFieldSchema).max(30),
  unresolvedFields: z.array(reconciliationFieldNameSchema).max(30), status: z.enum(["open", "closed"]),
  sourceCoverage: z.literal("captured-records-only"),
});
export type ReconciliationCase = Readonly<z.infer<typeof reconciliationCaseSchema>>;
export const reconciliationCaseInputSchema = z.strictObject({ studentId: reviewIdentifierSchema });
const mutation = { requestId: z.uuid(), studentId: reviewIdentifierSchema, expectedRevision: reviewRevisionSchema };
export const reconciliationDecisionInputSchema = z.strictObject({ ...mutation, decision: reconciliationDecisionSchema });
export type ReconciliationDecisionInput = Readonly<z.infer<typeof reconciliationDecisionInputSchema>>;
export const closeReconciliationInputSchema = z.strictObject(mutation);
export type CloseReconciliationInput = Readonly<z.infer<typeof closeReconciliationInputSchema>>;

export const memberIdentityAliasSchema = z.strictObject({
  academyId: reviewIdentifierSchema, studentId: reviewIdentifierSchema, canonicalStudentId: reviewIdentifierSchema,
  requestId: z.uuid(), evidence: z.string().min(3).max(1000), reason: z.string().min(3).max(500),
  previewRevision: reviewRevisionSchema, approvedBy: reviewIdentifierSchema, approvedAt: z.iso.datetime(),
  schemaVersion: z.literal("1"),
}).refine((alias) => alias.studentId !== alias.canonicalStudentId);
export const aliasPreviewInputSchema = z.strictObject({
  studentId: reviewIdentifierSchema, canonicalStudentId: reviewIdentifierSchema,
}).refine((input) => input.studentId !== input.canonicalStudentId);
export const approveAliasInputSchema = z.strictObject({
  studentId: reviewIdentifierSchema, canonicalStudentId: reviewIdentifierSchema,
  requestId: z.uuid(), expectedRevision: reviewRevisionSchema,
  evidence: z.string().trim().min(3).max(1000), reason: z.string().trim().min(3).max(500),
}).refine((input) => input.studentId !== input.canonicalStudentId);
export const aliasPreviewSchema = z.strictObject({
  studentId: reviewIdentifierSchema, canonicalStudentId: reviewIdentifierSchema, revision: reviewRevisionSchema,
  identityEvidence: z.array(z.enum(["membership-number", "id-card-number"])).max(2),
  blockers: z.array(z.string().max(160)).max(20),
  references: z.array(z.strictObject({ collection: z.string(), studentId: reviewIdentifierSchema,
    ids: z.array(z.string().max(1500)).max(100), complete: z.boolean() })).max(30),
});
export type AliasPreview = Readonly<z.infer<typeof aliasPreviewSchema>>;

/** Only values supported by the destination's typed editor can be proposed for application. */
export function validReconciliationValue(field: ReconciliationFieldName, value: ReviewValue): boolean {
  if (value === null) return !["fullName", "gender"].includes(field);
  switch (field) {
    case "fullName": return z.string().trim().min(1).max(160).safeParse(value).success;
    case "dateOfBirth": return z.iso.date().safeParse(value).success;
    case "email": return z.email().max(320).safeParse(value).success;
    case "phoneNumber": return z.string().trim().min(1).max(64).safeParse(value).success;
    case "membershipNumber": case "idCardNumber": case "vatNumber":
      return z.string().regex(/^[A-Z0-9][A-Z0-9 ./-]{0,63}$/u).safeParse(value).success;
    case "gender": return z.enum(["male", "female", "unknown"]).safeParse(value).success;
    case "trainingCenter": return z.enum(["Town", "West"]).safeParse(value).success;
    case "membershipState": return z.enum(["trial", "active", "inactive", "suspended", "paused", "overdue", "cancelled", "unknown"]).safeParse(value).success;
    case "guardian": return reviewIdentifierSchema.safeParse(value).success;
    default: return typeof value === "string" || Array.isArray(value);
  }
}
export function reconciliationWriterFor(field: ReconciliationFieldName): ReconciliationWriter {
  if (["membershipState", "plan", "paidPeriod", "payments"].includes(field)) return "subscription";
  if (["level", "progress"].includes(field)) return "progression";
  if (field === "guardian") return "guardian";
  if (field === "attendance") return "history";
  return "personal";
}
