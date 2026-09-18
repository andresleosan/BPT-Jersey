"use client";
import { GoogleAuthProvider, browserPopupRedirectResolver, linkWithPopup, signInWithCustomToken } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { getFirebaseAuth, getFirebaseFunctions } from "./firebase-client";

export const isStaffNumber = (value: string) => /^[1-9]\d{5}$/u.test(value.trim());
export async function signInWithStaffId(staffNumber: string, password: string) {
  const call = httpsCallable<{ staffNumber: string; password: string }, { token: string }>(
    getFirebaseFunctions(), "signInStaffWithId",
  );
  const result = await call({ staffNumber: staffNumber.trim(), password });
  return signInWithCustomToken(getFirebaseAuth(), result.data.token);
}
export function currentStaffAccess() {
  const user = getFirebaseAuth().currentUser;
  return { googleLinked: !!user?.providerData.some((row) => row.providerId === "google.com") };
}
export async function linkStaffGoogle() {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("Sign in first.");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  // Linking preserves the authenticated UID and its coach profile.
  const result = await linkWithPopup(user, provider, browserPopupRedirectResolver);
  await result.user.getIdToken(true);
}
export async function changeStaffPassword(staffNumber: string, password: string, newPassword: string) {
  await httpsCallable(getFirebaseFunctions(), "changeStaffIdPassword")({ staffNumber, password, newPassword });
}
export function staffAccessError(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : "";
  if (code === "auth/credential-already-in-use" || code === "auth/email-already-in-use")
    return "This Google account is already linked to another profile. Ask the office for help; your coach profile has not changed.";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request")
    return "The Google window was closed. You can try again.";
  if (code === "auth/requires-recent-login") return "Sign out, sign in again, and retry.";
  if (code === "functions/resource-exhausted") return "Too many attempts. Try again in 15 minutes.";
  if (code === "functions/unauthenticated") return "Check your staff ID and current password.";
  return "We could not update your access. Please try again or contact the office.";
}
