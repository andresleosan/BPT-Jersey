import { z } from "zod";
import { childGuardianChangeSchema } from "../families/family-contracts";
import { accountMemberHistoryPageSchema } from "./member-history-contracts";
import { trainingCenters, trainingTimePreferences } from "../profiles/profile-contracts";

const opaqueId = z.string().regex(/^[a-f0-9]{64}$/u);
const boundedText = z.string().trim().min(1).max(160);
export const memberRecoveryProfileSchema = z.strictObject({
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u)
    .optional(),
  phoneNumber: z.string().trim().min(7).max(40).optional(),
  trainingCenter: z.enum(trainingCenters).optional(),
  trainingTimePreferences: z
    .array(z.enum(trainingTimePreferences))
    .min(1)
    .max(3)
    .refine((values) => new Set(values).size === values.length)
    .optional(),
});
export type MemberRecoveryProfile = z.infer<typeof memberRecoveryProfileSchema>;
export const beginMemberRecoveryInputSchema = z.strictObject({
  fullName: boundedText,
  email: z
    .string()
    .trim()
    .max(320)
    .transform((value) => value || undefined)
    .pipe(z.email().optional())
    .optional(),
});
export const beginMemberRecoveryResultSchema = z.strictObject({
  recoveryId: opaqueId,
  expiresAt: z.iso.datetime(),
});
export const completeMemberRecoveryInputSchema = z.strictObject({
  recoveryId: opaqueId,
  profile: memberRecoveryProfileSchema.optional(),
});
export const memberRecoveryStatusSchema = z.enum([
  "verify-email",
  "pending-review",
  "profile-required",
  "linked",
  "rejected",
]);
export const completeMemberRecoveryResultSchema = z.strictObject({
  status: memberRecoveryStatusSchema,
  profile: memberRecoveryProfileSchema.optional(),
});
export type CompleteMemberRecoveryResult = z.infer<typeof completeMemberRecoveryResultSchema>;
export const memberRecoveryRequestRowSchema = z.strictObject({
  requestId: opaqueId,
  fullName: boundedText,
  status: memberRecoveryStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  accountVerified: z.boolean().optional(),
});
export const listMemberRecoveryRequestsResultSchema = z.strictObject({
  requests: z.array(memberRecoveryRequestRowSchema).max(50),
  truncated: z.boolean(),
});
export const memberRecoveryCandidateSchema = z.strictObject({
  candidateId: opaqueId,
  fullName: boundedText,
  email: z.string().max(320).optional(),
  dateOfBirth: z.string().optional(),
  membershipState: z.enum(["active", "inactive"]),
  source: z.enum(["regyfit", "member", "student"]).optional(),
  archiveRecordId: z
    .string()
    .regex(/^[0-9]{1,12}$/u)
    .optional(),
});
export const getMemberRecoveryDetailInputSchema = z.strictObject({
  requestId: opaqueId,
  search: z.string().trim().min(2).max(160).optional(),
});
export const getMemberRecoveryDetailResultSchema = z.strictObject({
  request: memberRecoveryRequestRowSchema.extend({
    previousEmail: z.string().max(320),
    accountEmail: z.string().max(320).optional(),
  }),
  candidates: z.array(memberRecoveryCandidateSchema).max(20),
});
export const reviewMemberRecoveryInputSchema = z
  .strictObject({
    requestId: opaqueId,
    decision: z.enum(["approve", "reject"]),
    candidateId: opaqueId.optional(),
    identityConfirmed: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.decision === "reject" ||
      (value.candidateId !== undefined && value.identityConfirmed === true),
  );
export const reviewMemberRecoveryResultSchema = z.strictObject({
  status: memberRecoveryStatusSchema,
});
export type MemberRecoveryRequestRow = z.infer<typeof memberRecoveryRequestRowSchema>;
export type MemberRecoveryDetail = z.infer<typeof getMemberRecoveryDetailResultSchema>;
export const memberRecoveryHistorySchema = accountMemberHistoryPageSchema;
export type MemberRecoveryHistory = z.infer<typeof memberRecoveryHistorySchema>;


const recoveryDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}, "Enter a valid date of birth");
const recoverySubjectFields = {
  fullName: boundedText,
  dateOfBirth: recoveryDateSchema.optional(),
  previousEmail: z.email().max(320).optional(),
};
export const recoverySubjectInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("self"), ...recoverySubjectFields }),
  z.strictObject({ kind: z.literal("child"), ...recoverySubjectFields, dateOfBirth: recoveryDateSchema }),
]);
export const recoverySubjectStatusSchema = z.enum(["pending-review", "more-information", "approved", "rejected"]);
export const recoverySubjectSchema = z.strictObject({
  subjectId: opaqueId,
  kind: z.enum(["self", "child"]),
  ...recoverySubjectFields,
  status: recoverySubjectStatusSchema,
}).refine((subject) => subject.kind !== "child" || subject.dateOfBirth !== undefined);
export type RecoverySubject = Readonly<z.infer<typeof recoverySubjectSchema>>;
export const beginMemberRecoveryV2InputSchema = z.strictObject({
  version: z.literal("2"),
  mode: z.enum(["athlete", "guardian"]),
  subjects: z.array(recoverySubjectInputSchema).min(1).max(11),
}).superRefine((value, ctx) => {
  const own = value.subjects.filter((subject) => subject.kind === "self").length;
  const children = value.subjects.length - own;
  if (own > 1 || children > 10 || (value.mode === "athlete" && (own !== 1 || children !== 0)) ||
      (value.mode === "guardian" && children === 0)) {
    ctx.addIssue({ code: "custom", message: "Select one athlete, or up to ten children and your own profile", path: ["subjects"] });
  }
  const keys = value.subjects.map((subject) => `${subject.kind}:${subject.fullName.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ")}:${subject.dateOfBirth ?? ""}`);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "Include each person once", path: ["subjects"] });
});
export const recoverySubjectDecisionSchema = z.strictObject({
  requestId: opaqueId,
  subjectId: opaqueId,
  expectedRevision: opaqueId,
  decision: z.enum(["approve", "reject", "more-information"]),
  candidateId: opaqueId.optional(),
  identityEvidence: z.string().trim().min(3).max(1000),
  guardianEvidence: z.string().trim().min(3).max(1000).optional(),
  guardianChange: childGuardianChangeSchema.optional(),
}).refine((value) => value.decision !== "approve" || value.candidateId !== undefined);
export type RecoverySubjectDecision = Readonly<z.infer<typeof recoverySubjectDecisionSchema>>;
export const memberRecoveryV2StatusSchema = z.enum([
  "verify-email", "pending-review", "more-information", "partially-linked", "linked", "rejected",
]);
export const memberRecoveryV2ResultSchema = z.strictObject({
  version: z.literal("2"), recoveryId: opaqueId, revision: opaqueId,
  expiresAt: z.iso.datetime(), status: memberRecoveryV2StatusSchema,
  subjects: z.array(recoverySubjectSchema).min(1).max(11),
  accountRefreshRequired: z.boolean(),
});
export type MemberRecoveryV2Result = Readonly<z.infer<typeof memberRecoveryV2ResultSchema>>;
export function recoveryRequestStatus(subjects: readonly RecoverySubject[], accountVerified: boolean): z.infer<typeof memberRecoveryV2StatusSchema> {
  if (!accountVerified) return "verify-email";
  const approved = subjects.filter((subject) => subject.status === "approved").length;
  const pending = subjects.some((subject) => subject.status === "pending-review" || subject.status === "more-information");
  if (approved > 0) return pending ? "partially-linked" : "linked";
  if (subjects.every((subject) => subject.status === "rejected")) return "rejected";
  return subjects.some((subject) => subject.status === "more-information") ? "more-information" : "pending-review";
}
