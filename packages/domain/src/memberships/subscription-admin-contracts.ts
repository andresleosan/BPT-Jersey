import { z } from "zod";
import { planIds } from "./plan-contracts";
import { membershipStatuses } from "./membership-contracts";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const instant = z.iso.datetime();
export const memberSubscriptionQuerySchema = z.strictObject({ studentId: id });
const editBase = {
  membershipId: id,
  requestId: z.uuid(),
  expectedUpdatedAt: instant,
};
export const subscriptionEditSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    ...editBase,
    operation: z.literal("save"),
    planId: z.enum(planIds),
    endsAt: instant.nullable(),
  }),
  z.strictObject({
    ...editBase,
    operation: z.literal("extend-month"),
    notificationId: id.optional(),
  }),
]);
export type SubscriptionEdit = z.infer<typeof subscriptionEditSchema>;
export const editableSubscriptionSchema = z.strictObject({
  membershipId: id,
  studentId: id,
  planId: z.enum(planIds),
  status: z.enum(membershipStatuses),
  startsAt: instant,
  endsAt: instant.nullable(),
  updatedAt: instant,
});
export type EditableSubscription = z.infer<typeof editableSubscriptionSchema>;
export const memberSubscriptionContextSchema = z.strictObject({
  studentId: id,
  fullName: z.string().min(1).max(160),
  eligiblePlanIds: z.array(z.enum(planIds)),
  memberships: z.array(editableSubscriptionSchema),
});
export type MemberSubscriptionContext = z.infer<typeof memberSubscriptionContextSchema>;

export const adminNotificationSchema = z.strictObject({
  notificationId: id,
  kind: z.enum(["subscription-expiring", "membership", "registration", "payment", "class"]),
  title: z.string().min(1).max(220),
  message: z.string().max(500),
  href: z.string().startsWith("/admin/"),
  createdAt: instant,
  readAt: instant.nullable(),
  resolvedAt: instant.nullable(),
  membershipId: id.nullable(),
  studentId: id.nullable(),
  endsAt: instant.nullable(),
});
export type AdminNotification = z.infer<typeof adminNotificationSchema>;
const cursorSchema = z.strictObject({ createdAt: instant, notificationId: id });
export const adminInboxQuerySchema = z.strictObject({
  filter: z.enum(["all", "unread"]),
  cursor: cursorSchema.nullable(),
});
export type AdminInboxQuery = z.infer<typeof adminInboxQuerySchema>;
export const adminInboxPageSchema = z.strictObject({
  notifications: z.array(adminNotificationSchema),
  nextCursor: cursorSchema.nullable(),
  unreadCount: z.number().int().nonnegative(),
});
export type AdminInboxPage = z.infer<typeof adminInboxPageSchema>;
export const adminNotificationActionSchema = z.strictObject({
  notificationId: id,
  action: z.enum(["read", "leave"]),
});
export type AdminNotificationAction = z.infer<typeof adminNotificationActionSchema>;

/** UTC calendar month, keeping the time and clamping e.g. January 31 to February 28/29. */
export function addSubscriptionMonth(value: string): string {
  const date = new Date(instant.parse(value));
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

const manualSettlementSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("previously-paid"),
    recordId: z.string().regex(/^[0-9]{1,12}$/u),
    paymentConfirmed: z.literal(true),
  }),
  z.strictObject({ kind: z.literal("unchanged") }),
  z.strictObject({ kind: z.literal("pay-as-you-go") }),
  z.strictObject({ kind: z.literal("complimentary"), reason: z.string().trim().min(1).max(240) }),
  z.strictObject({
    kind: z.literal("unpaid"),
    amountMinor: z.number().int().positive().max(100_000_000),
  }),
  z.strictObject({
    kind: z.literal("paid"),
    amountMinor: z.number().int().positive().max(100_000_000),
    method: z.enum(["cash", "bank_transfer", "other"]),
    reference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u),
    occurredAt: instant,
  }),
]);

export const manualSubscriptionSchema = z
  .strictObject({
    studentId: id,
    membershipId: id.nullable(),
    expectedUpdatedAt: instant.nullable(),
    requestId: z.uuid(),
    operation: z.enum(["assign", "update", "renew"]),
    planId: z.enum(planIds),
    startsAt: instant,
    endsAt: instant.nullable(),
    settlement: manualSettlementSchema,
  })
  .superRefine((value, context) => {
    if (
      (value.operation === "assign") !==
      (value.membershipId === null && value.expectedUpdatedAt === null)
    )
      context.addIssue({
        code: "custom",
        path: ["membershipId"],
        message: "Existing subscriptions require a version.",
      });
    if (value.operation !== "assign" && (!value.membershipId || !value.expectedUpdatedAt))
      context.addIssue({
        code: "custom",
        path: ["expectedUpdatedAt"],
        message: "Refresh the subscription.",
      });
    if (value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt))
      context.addIssue({ code: "custom", path: ["endsAt"], message: "End must follow start." });
    if (
      value.settlement.kind === "previously-paid" &&
      (value.operation !== "assign" || !value.endsAt)
    )
      context.addIssue({
        code: "custom",
        path: ["settlement"],
        message: "Previous payments require a new subscription with a confirmed end date.",
      });
    if (value.operation !== "update" && value.settlement.kind === "unchanged")
      context.addIssue({
        code: "custom",
        path: ["settlement"],
        message: "Choose paid, unpaid or complimentary.",
      });
  });
export type ManualSubscriptionInput = z.infer<typeof manualSubscriptionSchema>;

export const importedSubscriptionQuerySchema = z.strictObject({
  recordId: z.string().regex(/^[0-9]{1,12}$/u),
});
export const importedSubscriptionLinkSchema = z.strictObject({ studentId: id.nullable() });
export const officeMemberRegistrationSchema = z.strictObject({
  recordId: z.string().regex(/^[0-9]{1,12}$/u),
  requestId: z.uuid(),
  dateOfBirth: z.iso.date(),
  trainingCenter: z.enum(["Town", "West"]),
  trainingTimePreferences: z
    .array(z.enum(["morning", "afternoon", "evening"]))
    .min(1)
    .max(3)
    .refine((values) => new Set(values).size === values.length),
});
export type OfficeMemberRegistration = z.infer<typeof officeMemberRegistrationSchema>;
export const subscriptionBillingSchema = z.strictObject({
  membershipId: id,
  complimentary: z.boolean(),
  previousPaymentRecordId: z.string().optional(),
  currentInvoiceId: id.nullable(),
  reason: z.string().nullable(),
  invoices: z.array(
    z.strictObject({
      invoiceId: id,
      status: z.enum(["open", "partially_paid", "paid", "void"]),
      totalMinor: z.number().int().positive(),
      paidAt: instant.nullable(),
      dueAt: instant,
      description: z.string(),
      payments: z.array(
        z.strictObject({
          paymentId: id,
          amountMinor: z.number().int().positive(),
          method: z.enum(["cash", "bank_transfer", "other"]),
          reference: z.string(),
          occurredAt: instant,
        }),
      ),
    }),
  ),
});
export type SubscriptionBilling = z.infer<typeof subscriptionBillingSchema>;
