/**
 * Callables for account settings and teen access (T044V2). Reserved by phase 0 so that the three member
 * features register their callables in their own file; `src/index.ts` already re-exports it.
 * Add the callable here and its name to `deploy-runtime.ts`, nothing else touches `index.ts`.
 */
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableOptions, type CallableRequest } from "firebase-functions/v2/https";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { enrolmentStorageSecrets } from "../members/enrolment-payment-proof.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { createFirestoreMemberAccessService } from "../members/member-access-service.js";
import { createPrivateStorageR2Client } from "../storage/r2-client.js";
import { createAccountSettingsService } from "./account-settings-service.js";

const storageOptions = { ...browserAdminCallableOptions, secrets: enrolmentStorageSecrets };
/** sharp decodes up to 20 MP: give the upload room and one image at a time per instance. */
const uploadOptions = { ...storageOptions, memory: "512MiB" as const, concurrency: 1, timeoutSeconds: 30 };

type Service = ReturnType<typeof createAccountSettingsService>;

function settingsCallable<T>(options: CallableOptions, run: (service: Service, actor: { userId: string; academyId: string }, data: unknown) => Promise<T>) {
  return onCall(options, async (request: CallableRequest<unknown>) => {
    const actor = await requireMemberAccountActor(request);
    const firestore = getFirestore();
    const service = createAccountSettingsService({
      firestore,
      r2: createPrivateStorageR2Client(),
      access: createFirestoreMemberAccessService({ firestore }),
    });
    try {
      return await run(service, actor, request.data);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("unavailable", "Your settings could not be saved. Try again.");
    }
  });
}

export const uploadProfilePhoto = settingsCallable(uploadOptions, (s, actor, data) => s.uploadProfilePhoto(actor, data));
export const removeProfilePhoto = settingsCallable(storageOptions, (s, actor, data) => s.removeProfilePhoto(actor, data));
export const approveProposedPhoto = settingsCallable(storageOptions, (s, actor, data) => s.approveProposedPhoto(actor, data));
export const getMySettings = settingsCallable(storageOptions, (s, actor, data) => s.getMySettings(actor, data));
export const setMemberVisibility = settingsCallable(browserAdminCallableOptions, (s, actor, data) => s.setMemberVisibility(actor, data));
