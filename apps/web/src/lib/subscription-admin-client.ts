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
  importedSubscriptionQuerySchema,
  importedSubscriptionLinkSchema,
  officeMemberRegistrationSchema,
  manualSubscriptionSchema,
  subscriptionBillingSchema,
  type OfficeMemberRegistration,
  type ManualSubscriptionInput,
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
    if (code === "functions/permission-denied" || code === "functions/unauthenticated")
      throw new Error(
        "An active administrator session is required. Sign in again and reopen this member.",
      );
    if (code === "functions/already-exists")
      throw new Error(
        "This member or payment reference already exists. Refresh before trying again.",
      );
    if (code === "functions/failed-precondition")
      throw new Error(
        "Check the member, subscription dates and outstanding balance. Recorded payments cannot be replaced; use Renew for a new period.",
      );
    throw new Error("Unable to complete this request. Please try again.");
  }
}
export async function getMemberSubscriptions(studentId: string) {
  const result = await invoke(
    "listMemberSubscriptions",
    memberSubscriptionQuerySchema.parse({ studentId }),
    memberSubscriptionContextSchema,
  );
  if (
    result.studentId !== studentId ||
    result.memberships.some((membership) => membership.studentId !== studentId)
  )
    throw new Error("Unable to load membership history. Please try again.");
  return result;
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

export function resolveImportedSubscription(recordId: string) {
  return invoke(
    "resolveMemberSubscriptionProfile",
    importedSubscriptionQuerySchema.parse({ recordId }),
    importedSubscriptionLinkSchema,
  );
}
export function registerImportedMember(input: OfficeMemberRegistration) {
  return invoke(
    "registerImportedMemberForOffice",
    officeMemberRegistrationSchema.parse(input),
    z.strictObject({ memberId: z.string().min(1), studentId: z.string().min(1) }),
  );
}
export function manageManualSubscription(input: ManualSubscriptionInput) {
  return invoke(
    "manageMemberSubscription",
    manualSubscriptionSchema.parse(input),
    editableSubscriptionSchema,
  );
}
export function getMemberSubscriptionBilling(studentId: string) {
  return invoke(
    "listMemberSubscriptionBilling",
    memberSubscriptionQuerySchema.parse({ studentId }),
    z.array(subscriptionBillingSchema),
  );
}
