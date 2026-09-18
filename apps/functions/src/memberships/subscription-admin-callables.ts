import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  memberSubscriptionQuerySchema,
  subscriptionEditSchema,
} from "@bpt-jersey/domain/memberships/admin";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import {
  editMemberSubscription,
  listMemberSubscriptionRecords,
} from "./subscription-admin-service.js";

export const listMemberSubscriptions = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const input = memberSubscriptionQuerySchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid member query.");
  return listMemberSubscriptionRecords(getFirestore(), actor.academyId, input.data.studentId);
});
export const updateMemberSubscription = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const input = subscriptionEditSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid subscription edit.");
  return editMemberSubscription(getFirestore(), actor, input.data);
});
