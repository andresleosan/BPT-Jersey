import { randomUUID } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { inventoryPageInputSchema } from "@bpt-jersey/domain/members/inventory";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { createMemberDirectoryActorActivityCheck, requireCanonicalMemberDirectoryActor } from "./canonical-actor.js";
import { createMemberDirectoryFirestoreAdapters } from "./member-directory-firestore.js";
import { mapMemberDirectoryError } from "./member-directory-callables.js";
import { createMemberInventoryService } from "./member-inventory-service.js";

const identitySecret = defineSecret("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET");
const cursorSecret = defineSecret("MEMBER_DIRECTORY_CURSOR_SECRET");
export const getMemberInventoryPage = onCall({ ...browserAdminCallableOptions,
  secrets: [identitySecret, cursorSecret],
}, async (request) => {
  const firestore = getFirestore();
  const actor = await requireCanonicalMemberDirectoryActor(request, createMemberDirectoryActorActivityCheck({
    getAuthUser: (uid) => getAuth().getUser(uid), getDocument: (path) => firestore.doc(path).get(),
  }));
  const parsed = inventoryPageInputSchema.safeParse(request.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid inventory request");
  try {
    return await createMemberInventoryService({
      store: createMemberDirectoryFirestoreAdapters(firestore).reader,
      identitySecretMaterial: identitySecret.value(), identitySecretVersion: "identity-v1",
      cursorSecretMaterial: cursorSecret.value(), cursorSecretVersion: "cursor-v1", generateAuditId: randomUUID,
    }, actor).page(actor.academyId, parsed.data.collection, parsed.data.cursor);
  } catch (error) { return mapMemberDirectoryError(error); }
});
