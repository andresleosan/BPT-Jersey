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
