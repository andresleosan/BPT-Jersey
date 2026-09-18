"use client";
import { onAuthStateChanged, reload, sendEmailVerification } from "firebase/auth";
import {
  createClientWithEmail,
  signInWithEmail,
  signInWithGoogle,
  signOutFromAuth,
  sendPasswordReset,
} from "./auth-client";
import { getFirebaseAuth } from "./firebase-client";
export type RecoverySession = { email: string | null };
export function subscribeRecoverySession(listener: (session: RecoverySession | null) => void) {
  return onAuthStateChanged(getFirebaseAuth(), (user) =>
    listener(user ? { email: user.email } : null),
  );
}
export async function recoverySignIn(
  mode: "google" | "create" | "sign-in",
  email = "",
  password = "",
): Promise<RecoverySession> {
  const { user } =
    mode === "google"
      ? await signInWithGoogle()
      : mode === "create"
        ? await createClientWithEmail(email, password)
        : await signInWithEmail(email, password);
  return { email: user.email };
}
export async function refreshRecoverySession(): Promise<RecoverySession> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("Sign in to continue.");
  await reload(user);
  await user.getIdToken(true);
  return { email: user.email };
}
export async function sendRecoveryVerification(): Promise<void> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("Sign in to continue.");
  await sendEmailVerification(user);
}
export const signOutRecovery = signOutFromAuth;
export const resetRecoveryPassword = sendPasswordReset;
