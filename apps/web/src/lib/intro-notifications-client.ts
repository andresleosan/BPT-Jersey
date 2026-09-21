import { httpsCallable } from "firebase/functions";
import { z } from "zod";
import { memberNotificationSchema, type MemberNotification } from "@bpt-jersey/domain";
import { getFirebaseFunctions } from "./firebase-client";

const listResponseSchema = z.strictObject({ notifications: z.array(memberNotificationSchema).max(100) });
const markResponseSchema = z.strictObject({ ok: z.literal(true) });
const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const safeError = "Unable to load membership notices. Please try again.";

export async function listMemberNotifications(): Promise<readonly MemberNotification[]> {
  try {
    const response = await httpsCallable<null, unknown>(getFirebaseFunctions(), "listMemberNotifications")(null);
    return Object.freeze([...listResponseSchema.parse(response.data).notifications]);
  } catch {
    throw new Error(safeError);
  }
}

export async function markMemberNotificationRead(notificationId: string): Promise<void> {
  const id = identifierSchema.safeParse(notificationId);
  if (!id.success) throw new Error("Unable to update this notice.");
  try {
    const response = await httpsCallable<{ notificationId: string }, unknown>(getFirebaseFunctions(), "markMemberNotificationRead")({ notificationId: id.data });
    markResponseSchema.parse(response.data);
  } catch {
    throw new Error("Unable to update this notice.");
  }
}
