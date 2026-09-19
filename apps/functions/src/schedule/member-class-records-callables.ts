import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { memberClassQuerySchema } from "@bpt-jersey/domain/schedule/member-class-records";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { createMemberClassFirestoreStore } from "./member-class-records-firestore.js";
import { listMemberClassRecordsPage } from "./member-class-records-service.js";
export const listMemberClassRecords = onCall(browserAdminCallableOptions, async (request) => {
  const actor = await requireActiveOfficeActor(request);
  const input = memberClassQuerySchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid class history query.");
  try {
    return await listMemberClassRecordsPage(
      createMemberClassFirestoreStore(getFirestore()),
      actor,
      input.data,
    );
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("unavailable", "Class history is unavailable. Refresh to try again.");
  }
});
