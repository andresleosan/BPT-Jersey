import { randomUUID } from "node:crypto";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { requireActiveOfficeActor } from "../auth/office-actor.js";
import { isWeakStaffPassword } from "./staff-password-policy.js";

export const directStaffInputSchema = z.strictObject({ displayName: z.string().trim().min(2).max(160), email: z.email().trim().toLowerCase().max(320), password: z.string().min(12).max(128), role: z.enum(["coach","administrator","owner"]) });
export async function createStaffWithPasswordService(auth: Auth, db: Firestore, actor: Awaited<ReturnType<typeof requireActiveOfficeActor>>, raw: unknown) {
  const input = directStaffInputSchema.safeParse(raw); if (!input.success) throw new HttpsError("invalid-argument", "Enter a name, email, role and password of 12 to 128 characters.");
  if (isWeakStaffPassword(input.data.password, input.data.email)) throw new HttpsError("invalid-argument", "Choose a password that does not contain the email and is not a repeated character.");
  if (actor.role !== "owner" && input.data.role !== "coach") throw new HttpsError("permission-denied", "Only an owner can create office access.");
  let uid: string | undefined;
  try {
    const user = await auth.createUser({ email: input.data.email, password: input.data.password, displayName: input.data.displayName, emailVerified: true, disabled: false }); uid = user.uid;
    await auth.setCustomUserClaims(uid, { academyId: actor.academyId, role: input.data.role, passwordChangeRequired: true });
    const now = new Date().toISOString(); const base = db.doc(`academies/${actor.academyId}`); const batch = db.batch();
    batch.create(base.collection("users").doc(uid), { userId: uid, academyId: actor.academyId, accountType: "staff", displayName: input.data.displayName, email: input.data.email, phoneNumber: "", active: true, status: "active", ...(input.data.role === "coach" ? {} : { adminRole: input.data.role }), schemaVersion: "1", createdAt: now, createdBy: actor.userId, updatedAt: now, updatedBy: actor.userId });
    if (input.data.role === "coach") batch.create(base.collection("staff").doc(uid), { staffId: uid, academyId: actor.academyId, userId: uid, role: "coach", active: true, status: "active", schemaVersion: "1", createdAt: now, createdBy: actor.userId, updatedAt: now, updatedBy: actor.userId });
    batch.create(base.collection("auditEvents").doc(), { eventId: randomUUID(), academyId: actor.academyId, actorId: actor.userId, action: "staff.created_with_initial_password", targetRef: `academies/${actor.academyId}/users/${uid}`, purpose: "direct staff provisioning", correlationId: uid, occurredAt: now, schemaVersion: "1" });
    await batch.commit(); return { userId: uid, email: input.data.email, role: input.data.role, passwordChangeRequired: true as const };
  } catch (error) { if (uid) await auth.deleteUser(uid).catch(() => undefined); if (error instanceof HttpsError) throw error; throw new HttpsError("failed-precondition", "The staff account could not be created. Check that the email is not already in use."); }
}
export const createStaffWithPassword = onCall(browserAdminCallableOptions, async (request) => createStaffWithPasswordService(getAuth(), getFirestore(), await requireActiveOfficeActor(request), request.data));
