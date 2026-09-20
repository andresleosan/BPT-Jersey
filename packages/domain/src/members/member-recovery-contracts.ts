import { z } from "zod";
import {
  regyfitGraduationSchema,
  regyfitPlanSchema,
  regyfitAttendanceSchema,
  regyfitPaymentSchema,
} from "./regyfit-member-record-contracts";
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
export const memberRecoveryHistorySchema = z.strictObject({
  records: z
    .array(
      z.strictObject({
        recordId: z.string(),
        fullName: boundedText,
        capturedAt: z.iso.datetime(),
        graduation: regyfitGraduationSchema,
        plan: regyfitPlanSchema,
        attendance: regyfitAttendanceSchema,
        payments: z.array(regyfitPaymentSchema).max(50),
      }),
    )
    .max(20),
});
export type MemberRecoveryHistory = z.infer<typeof memberRecoveryHistorySchema>;
