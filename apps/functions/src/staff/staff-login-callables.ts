import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { browserAdminCallableOptions } from "../auth/callable-options.js";
import { createStaffLoginService } from "./staff-login-service.js";

const options = {
  ...browserAdminCallableOptions,
  maxInstances: 3,
  concurrency: 4,
  memory: "512MiB" as const,
};
export const signInStaffWithId = onCall(options, async (request) => {
  if (!request.app) throw new HttpsError("unauthenticated", "Verified application required.");
  return createStaffLoginService(getFirestore(), getAuth()).signIn(
    request.data,
    request.rawRequest.ip ?? "unknown",
  );
});
export const changeStaffIdPassword = onCall(options, async (request) => {
  if (!request.app || !request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return createStaffLoginService(getFirestore(), getAuth()).changePassword(
    request.data,
    request.rawRequest.ip ?? "unknown",
    request.auth.uid,
  );
});

export const completeInitialStaffAccess = onCall(options, async (request) => {
  if (!request.app || !request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const method = typeof request.data === "object" && request.data !== null ? (request.data as { method?: unknown }).method : undefined;
  if (method !== "password" && method !== "google") throw new HttpsError("invalid-argument", "Invalid access completion.");
  const user = await getAuth().getUser(request.auth.uid);
  const claims = user.customClaims ?? {};
  if (typeof claims.academyId !== "string" || !["coach","administrator","owner"].includes(String(claims.role))) throw new HttpsError("permission-denied", "Staff access is unavailable.");
  if (claims.passwordChangeRequired !== true) return { completed: true };
  const provider = String(request.auth.token.firebase?.sign_in_provider ?? "");
  const authTime = Number(request.auth.token.auth_time) * 1000;
  if (!Number.isFinite(authTime) || Date.now() - authTime > 5 * 60_000 || (method === "google" ? provider !== "google.com" || !user.providerData.some((item) => item.providerId === "google.com") : provider !== "password")) throw new HttpsError("permission-denied", "Sign in again before completing initial access.");
  await getAuth().setCustomUserClaims(user.uid, { ...claims, passwordChangeRequired: false });
  return { completed: true };
});
