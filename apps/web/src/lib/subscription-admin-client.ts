import { httpsCallable } from "firebase/functions";
import { z } from "zod";
import {
  adminInboxPageSchema,
  adminInboxQuerySchema,
  adminNotificationActionSchema,
  editableSubscriptionSchema,
  memberSubscriptionContextSchema,
  memberSubscriptionQuerySchema,
  subscriptionEditSchema,
  type AdminInboxQuery,
  type AdminNotificationAction,
  type SubscriptionEdit,
} from "@bpt-jersey/domain/memberships/admin";
import { getFirebaseFunctions } from "./firebase-client";

async function invoke<T>(name: string, input: unknown, schema: z.ZodType<T>): Promise<T> {
  try {
    const response = await httpsCallable<unknown, unknown>(getFirebaseFunctions(), name)(input);
    return schema.parse(response.data);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (code === "functions/aborted")
      throw new Error("This subscription has changed. Refresh before trying again.");
    if (code === "functions/failed-precondition")
      throw new Error(
        "Check that the member is active, the plan matches their age and centre, and the end date follows the start date.",
      );
    throw new Error("Unable to complete this request. Please try again.");
  }
}
export function getMemberSubscriptions(studentId: string) {
  return invoke(
    "listMemberSubscriptions",
    memberSubscriptionQuerySchema.parse({ studentId }),
    memberSubscriptionContextSchema,
  );
}
export function editSubscription(input: SubscriptionEdit) {
  return invoke(
    "updateMemberSubscription",
    subscriptionEditSchema.parse(input),
    editableSubscriptionSchema,
  );
}
export function getAdminNotifications(input: AdminInboxQuery) {
  return invoke("listAdminNotifications", adminInboxQuerySchema.parse(input), adminInboxPageSchema);
}
export function updateNotification(input: AdminNotificationAction) {
  return invoke(
    "updateAdminNotification",
    adminNotificationActionSchema.parse(input),
    z.strictObject({ ok: z.literal(true) }),
  );
}
