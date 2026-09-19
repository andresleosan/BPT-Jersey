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
