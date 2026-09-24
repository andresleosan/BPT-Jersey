import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { promotionMilestone, promotionOutlookSchema } from "@bpt-jersey/domain/members/engagement";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { createLevelCatalogStore } from "../levels/level-service.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { createFirestoreMemberAccessService } from "../members/member-access-service.js";

const memberStudentRequestSchema = z.strictObject({ studentId: z.string().min(1).max(128) });

/** The next rank, how far along the member is and the milestone to celebrate; `null` when there is none. */
export const getPromotionOutlook = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireMemberAccountActor(request);
  const input = memberStudentRequestSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid promotion request");
  const { studentId } = input.data;
  const access = await createFirestoreMemberAccessService().authorise(
    actor.academyId,
    actor.userId,
    studentId,
  );
  if (!access.allowed)
    throw new HttpsError("permission-denied", "This member is not available to your account.");
  let summary;
  try {
    summary = await createLevelCatalogStore({
      firestore: getFirestore() as never,
    }).getStudentProgressSummary(actor.academyId, studentId);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", "Promotion outlook is unavailable");
  }
  if (
    summary.state !== "initialized" ||
    summary.targetDefinition === null ||
    summary.progressPercent === null
  ) {
    return promotionOutlookSchema.parse(null);
  }
  const { required, completed } = summary.criteria.classes;
  const classesToGo = required === null ? null : Math.max(0, required - completed);
  return promotionOutlookSchema.parse({
    nextName: summary.targetDefinition.name,
    percent: summary.progressPercent,
    classesToGo,
    milestone: promotionMilestone({ percent: summary.progressPercent, classesToGo }),
    levelKey: summary.currentDefinition.definitionKey,
  });
});
