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
export type RecoverySession = { uid: string; email: string | null };
export function subscribeRecoverySession(listener: (session: RecoverySession | null) => void) {
  return onAuthStateChanged(getFirebaseAuth(), (user) =>
    listener(user ? { uid: user.uid, email: user.email } : null),
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
  return { uid: user.uid, email: user.email };
}
export async function refreshRecoverySession(expectedUid?: string): Promise<RecoverySession> {
  const user = getFirebaseAuth().currentUser;
  if (!user || (expectedUid && user.uid !== expectedUid)) throw new Error("Sign in to continue.");
  await reload(user);
  if (getFirebaseAuth().currentUser?.uid !== user.uid) throw new Error("Sign in to continue.");
  await user.getIdToken(true);
  if (getFirebaseAuth().currentUser?.uid !== user.uid) throw new Error("Sign in to continue.");
  return { uid: user.uid, email: user.email };
}
export async function sendRecoveryVerification(expectedUid?: string): Promise<void> {
  const user = getFirebaseAuth().currentUser;
  if (!user || (expectedUid && user.uid !== expectedUid)) throw new Error("Sign in to continue.");
  await sendEmailVerification(user);
}
export const signOutRecovery = signOutFromAuth;
export const resetRecoveryPassword = sendPasswordReset;
