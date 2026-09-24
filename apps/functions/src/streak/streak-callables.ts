/**
 * Callables for the streak panel (T042V2). Reserved by phase 0 so that the three member
 * features register their callables in their own file; `src/index.ts` already re-exports it.
 * Add the callable here and its name to `deploy-runtime.ts`, nothing else touches `index.ts`.
 */
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  buildMemberStreakSummary,
  memberStreakSummarySchema,
} from "@bpt-jersey/domain/members/engagement";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { createFirestoreMemberAccessService } from "../members/member-access-service.js";
import { readAttendedSessions } from "./streak-service.js";

const streakWindowMs = 400 * 86_400_000;
const memberStudentRequestSchema = z.strictObject({ studentId: z.string().min(1).max(128) });

export const getMemberStreak = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireMemberAccountActor(request);
  const input = memberStudentRequestSchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid streak request");
  const { studentId } = input.data;
  const access = await createFirestoreMemberAccessService().authorise(
    actor.academyId,
    actor.userId,
    studentId,
  );
  if (!access.allowed)
    throw new HttpsError("permission-denied", "This member is not available to your account.");
  const now = new Date().toISOString();
  try {
    const attendances = await readAttendedSessions(
      getFirestore(),
      actor.academyId,
      studentId,
      new Date(Date.parse(now) - streakWindowMs).toISOString(),
    );
    return memberStreakSummarySchema.parse(buildMemberStreakSummary({ attendances, now }));
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("failed-precondition", "Streak is unavailable");
  }
});
