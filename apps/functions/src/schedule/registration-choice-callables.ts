import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import {
  registrationChoiceQuerySchema,
  type RegistrationChoice,
  type RegistrationChoiceQuery,
} from "@bpt-jersey/domain/memberships/admin";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import type { BookingFirestore, BookingTransaction } from "./booking-transaction-service.js";
import { readRegistrationChoice } from "./registration-choice-service.js";

/** Office only, as enrolment is (ADR-010); the payload is checked after the actor, as elsewhere. */
export async function getRegistrationChoiceHandler(
  request: CallableRequest<unknown>,
  read: (academyId: string, query: RegistrationChoiceQuery) => Promise<RegistrationChoice>,
): Promise<RegistrationChoice> {
  const actor = await requireActiveOfficeActor(request);
  const input = registrationChoiceQuerySchema.safeParse(request.data);
  if (!input.success) throw new HttpsError("invalid-argument", "Invalid registration query.");
  return read(actor.academyId, input.data);
}

export const getRegistrationChoice = onCall(browserAdminCallableOptions, (request) =>
  getRegistrationChoiceHandler(request, (academyId, query) => {
    const db = getFirestore();
    return db.runTransaction(
      (transaction) =>
        readRegistrationChoice({
          firestore: db as unknown as BookingFirestore,
          transaction: transaction as unknown as BookingTransaction,
          academyId,
          ...query,
          now: new Date().toISOString(),
        }),
      { readOnly: true },
    );
  }),
);
