import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  adminInboxQuerySchema,
  adminNotificationActionSchema,
} from "@bpt-jersey/domain/memberships/admin";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { actOnAdminNotification, getAdminInbox } from "./admin-notification-service.js";

export const listAdminNotifications = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const input = adminInboxQuerySchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid notification query.");
  return getAdminInbox(getFirestore(), actor.academyId, input.data);
});
export const updateAdminNotification = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const input = adminNotificationActionSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid notification action.");
  await actOnAdminNotification(getFirestore(), actor.academyId, input.data);
  return { ok: true };
});
