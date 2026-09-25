import { randomUUID } from "node:crypto";
import { getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { createMemberDirectoryActorActivityCheck, requireCanonicalMemberDirectoryActor } from "./canonical-actor.js";
import { createMemberDirectoryFirestoreAdapters } from "./member-directory-firestore.js";
import { mapMemberDirectoryError } from "./member-directory-callables.js";
import type { MemberReconciliationDependencies } from "./member-reconciliation-service.js";
import type { CanonicalMemberDirectoryActor } from "./canonical-member-directory-service.js";

const identitySecret = defineSecret("MEMBER_DIRECTORY_IDENTITY_KEY_SECRET");
const cursorSecret = defineSecret("MEMBER_DIRECTORY_CURSOR_SECRET");
const integritySecret = defineSecret("MEMBER_DIRECTORY_MIGRATION_INTEGRITY_SECRET");
const options = { ...browserAdminCallableOptions, secrets: [identitySecret, cursorSecret, integritySecret] };
export function memberReviewCallable<T>(schema: z.ZodType<T>, handler: (deps: MemberReconciliationDependencies, actor: CanonicalMemberDirectoryActor, input: T) => Promise<unknown>) {
  return onCall(options, async (request) => {
    const firestore = getFirestore();
    const actor = await requireCanonicalMemberDirectoryActor(request, createMemberDirectoryActorActivityCheck({
      getAuthUser: (uid) => getAuth().getUser(uid), getDocument: (path) => firestore.doc(path).get(),
    }));
    const parsed = schema.safeParse(request.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid member review request");
    const projectId = getApp().options.projectId;
    if (!projectId) throw new HttpsError("failed-precondition", "Firebase project binding is unavailable");
    const deps: MemberReconciliationDependencies = {
      store: createMemberDirectoryFirestoreAdapters(firestore).reader, projectId,
      identitySecretMaterial: identitySecret.value(), identitySecretVersion: "identity-v1",
      cursorSecretMaterial: cursorSecret.value(), cursorSecretVersion: "cursor-v1",
      integritySecretMaterial: integritySecret.value(), integritySecretVersion: "integrity-v1", generateAuditId: randomUUID,
    };
    try { return await handler(deps, actor, parsed.data); } catch (error) { return mapMemberDirectoryError(error); }
  });
}
