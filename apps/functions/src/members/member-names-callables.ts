import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import {
  memberNameRowSchema,
  memberNamesLimit,
  type MemberNameRow,
} from "@bpt-jersey/domain/members/directory";

import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireAdminActor } from "../auth/admin-authorization.js";

export type MemberNamesStore = Readonly<{
  listActiveStudents: (
    academyId: string,
    limit: number,
  ) => Promise<readonly Readonly<{ id: string; data: Record<string, unknown> }>[]>;
}>;

export async function listMemberNamesHandler(
  request: CallableRequest<unknown>,
  services: { store: MemberNamesStore },
): Promise<{ members: readonly MemberNameRow[] }> {
  const actor = requireAdminActor(request);
  if (request.data !== null)
    throw new HttpsError("invalid-argument", "Member names payload must be null");
  const documents = await services.store.listActiveStudents(actor.academyId, memberNamesLimit + 1);
  if (documents.length > memberNamesLimit) {
    throw new HttpsError("resource-exhausted", "Too many members to list at once");
  }
  const members: MemberNameRow[] = [];
  for (const document of documents) {
    const parsed = memberNameRowSchema.safeParse({
      studentId: document.id,
      fullName: typeof document.data.fullName === "string" ? document.data.fullName.trim() : "",
      familyId: typeof document.data.familyId === "string" ? document.data.familyId : null,
    });
    if (parsed.success) members.push(parsed.data);
  }
  members.sort((left, right) => left.fullName.localeCompare(right.fullName));
  return { members: Object.freeze(members) };
}

function firestoreStore(): MemberNamesStore {
  return {
    async listActiveStudents(academyId, limit) {
      const snapshot = await getFirestore()
        .collection(`academies/${academyId}/students`)
        .where("status", "==", "active")
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        data: doc.data() as Record<string, unknown>,
      }));
    },
  };
}

export const listMemberNames = onCall(
  { ...browserAdminCallableOptions, enforceAppCheck: true, consumeAppCheckToken: false },
  (request) => listMemberNamesHandler(request, { store: firestoreStore() }),
);
