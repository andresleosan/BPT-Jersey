import { z } from "zod";

import { billingPeriods, planIds, siteValues } from "./plan-contracts";

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const instantSchema = z.iso.datetime();
const proofIdSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const reasonSchema = z.string().trim().min(2).max(500);

export const introConversionStatuses = Object.freeze([
  "ready",
  "application_pending",
  "converted",
] as const);

export const membershipApplicationStatuses = Object.freeze([
  "pending_review",
  "needs_correction",
  "approved",
  "rejected",
] as const);

export const introConversionStateSchema = z.strictObject({
  conversionId: identifierSchema,
  academyId: identifierSchema,
  studentId: identifierSchema,
  attendanceId: identifierSchema,
  sessionId: identifierSchema,
  recipientUid: identifierSchema.nullable(),
  status: z.enum(introConversionStatuses),
  createdAt: instantSchema,
  updatedAt: instantSchema,
  schemaVersion: z.literal("1"),
});
export type IntroConversionState = z.infer<typeof introConversionStateSchema>;

export const memberNotificationSchema = z.strictObject({
  notificationId: identifierSchema,
  academyId: identifierSchema,
  recipientUid: identifierSchema,
  kind: z.literal("intro_membership_ready"),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(500),
  href: z.enum(["/account/membership", "/account/membership?from=intro"]),
  readAt: instantSchema.nullable(),
  createdAt: instantSchema,
  schemaVersion: z.literal("1"),
});
export type MemberNotification = z.infer<typeof memberNotificationSchema>;

export const membershipApplicationSubmitSchema = z.strictObject({
  requestId: z.uuid(),
  conversionId: identifierSchema,
  studentId: identifierSchema,
  site: z.enum(siteValues),
  planId: z.enum(planIds),
  proofId: proofIdSchema.nullable(),
  bankReference: z.string().trim().min(2).max(120).nullable(),
});
export type MembershipApplicationSubmit = z.infer<typeof membershipApplicationSubmitSchema>;

export const membershipApplicationSchema = z.strictObject({
  applicationId: identifierSchema,
  requestId: z.uuid(),
  academyId: identifierSchema,
  applicantUid: identifierSchema,
  studentId: identifierSchema,
  conversionId: identifierSchema,
  site: z.enum(siteValues),
  planId: z.enum(planIds),
  planName: z.string().trim().min(1).max(160),
  priceMinor: z.number().int().positive().max(100_000_000),
  currency: z.literal("GBP"),
  billingPeriod: z.enum(billingPeriods),
  planUpdatedAt: instantSchema,
  proofId: proofIdSchema.nullable(),
  bankReference: z.string().trim().min(2).max(120).nullable(),
  status: z.enum(membershipApplicationStatuses),
  revision: z.number().int().nonnegative(),
  decisionReason: reasonSchema.nullable(),
  approvedMembershipId: identifierSchema.nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
  schemaVersion: z.literal("1"),
});
export type MembershipApplication = z.infer<typeof membershipApplicationSchema>;

const decisionBase = {
  applicationId: identifierSchema,
  expectedRevision: z.number().int().nonnegative(),
};

export const membershipApplicationDecisionSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    ...decisionBase,
    decision: z.literal("needs_correction"),
    reason: reasonSchema,
  }),
  z.strictObject({
    ...decisionBase,
    decision: z.literal("reject"),
    reason: reasonSchema,
  }),
  z.strictObject({
    ...decisionBase,
    decision: z.literal("approve"),
    occurredAt: instantSchema,
  }),
]);
export type MembershipApplicationDecision = z.infer<
  typeof membershipApplicationDecisionSchema
>;
