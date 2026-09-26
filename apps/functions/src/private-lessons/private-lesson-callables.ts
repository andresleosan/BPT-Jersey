import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireMemberAccountActor } from "../members/member-access-callables.js";
import { enrolmentStorageSecrets } from "../members/enrolment-payment-proof.js";
import { createPrivateStorageR2Client } from "../storage/r2-client.js";
import { error as logError } from "firebase-functions/logger";
import { createFirestorePrivateLessonStore } from "./private-lesson-firestore.js";
import * as service from "./private-lesson-service.js";
import type { PrivateLessonActor, PrivateLessonStore } from "./private-lesson-service.js";

type Guard = (request: CallableRequest<unknown>) => Promise<PrivateLessonActor>;

export type PrivateLessonHandlerOptions = Readonly<{
  store: (academyId: string) => PrivateLessonStore;
  requireMember: Guard;
  requireOffice: Guard;
  now?: () => string;
}>;

async function safely<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logError("private-lesson-operation-failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new HttpsError("internal", "The private lesson request could not be completed.");
  }
}

export function createPrivateLessonHandlers(options: PrivateLessonHandlerOptions) {
  const now = options.now ?? (() => new Date().toISOString());
  return Object.freeze({
    submit: async (request: CallableRequest<unknown>) => {
      const actor = await options.requireMember(request);
      return safely(async () => ({
        purchase: await service.submitPrivateLessonPurchase(
          options.store(actor.academyId),
          actor,
          request.data,
          now(),
        ),
      }));
    },
    listMine: async (request: CallableRequest<unknown>) => {
      const actor = await options.requireMember(request);
      return safely(() =>
        service.listMyPrivateLessons(options.store(actor.academyId), actor, request.data, now()),
      );
    },
    list: async (request: CallableRequest<unknown>) => {
      const actor = await options.requireOffice(request);
      return safely(() =>
        service.listPrivateLessonPurchases(options.store(actor.academyId), actor, request.data),
      );
    },
    review: async (request: CallableRequest<unknown>) => {
      const actor = await options.requireOffice(request);
      return safely(async () => ({
        purchase: await service.reviewPrivateLessonPurchase(
          options.store(actor.academyId),
          actor,
          request.data,
          now(),
        ),
      }));
    },
    record: async (request: CallableRequest<unknown>) => {
      const actor = await options.requireOffice(request);
      return safely(async () => ({
        purchase: await service.recordPrivateLessonPurchase(
          options.store(actor.academyId),
          actor,
          request.data,
          now(),
        ),
      }));
    },
    proofUrl: async (request: CallableRequest<unknown>) => {
      const actor = await options.requireOffice(request);
      return safely(() =>
        service.getPrivateLessonProofUrl(options.store(actor.academyId), actor, request.data),
      );
    },
  });
}

const handlers = () =>
  createPrivateLessonHandlers({
    store: (academyId) =>
      createFirestorePrivateLessonStore(getFirestore(), academyId, () =>
        createPrivateStorageR2Client(),
      ),
    requireMember: requireMemberAccountActor,
    requireOffice: requireActiveOfficeActor,
  });

export const submitPrivateLessonPurchase = onCall(
  { ...browserAdminCallableOptions, secrets: enrolmentStorageSecrets },
  (request) => handlers().submit(request),
);
export const listMyPrivateLessons = onCall(browserAdminCallableOptions, (request) =>
  handlers().listMine(request),
);
export const listPrivateLessonPurchases = onCall(browserAdminCallableOptions, (request) =>
  handlers().list(request),
);
export const reviewPrivateLessonPurchase = onCall(browserAdminCallableOptions, (request) =>
  handlers().review(request),
);
export const recordPrivateLessonPurchase = onCall(browserAdminCallableOptions, (request) =>
  handlers().record(request),
);
export const getPrivateLessonProofUrl = onCall(
  { ...browserAdminCallableOptions, secrets: enrolmentStorageSecrets },
  (request) => handlers().proofUrl(request),
);
