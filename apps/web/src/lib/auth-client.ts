"use client";

import {
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  type Unsubscribe,
  type User,
  type UserCredential,
} from "firebase/auth";

import {
  getFirebaseAuth,
  prepareFirebaseAppCheck,
  requireFirebaseAppCheck,
  refreshAuthToken as refreshAuthTokenFromFirebase,
  signInWithGoogle as signInWithGoogleFromFirebase,
  signOutFromFirebase,
} from "./firebase-client";
import type { IdTokenResult } from "firebase/auth";

function requiredEmail(email: string): string {
  const trimmedEmail = email.trim();

  if (!trimmedEmail) {
    throw new Error("Email and password are required.");
  }

  return trimmedEmail;
}

function requiredCredentials(email: string, password: string): string {
  const trimmedEmail = requiredEmail(email);

  if (!password.trim()) {
    throw new Error("Email and password are required.");
  }

  return trimmedEmail;
}

export async function signInWithEmail(email: string, password: string): Promise<UserCredential> {
  const auth = getFirebaseAuth();
  return signInWithEmailAndPassword(auth, requiredCredentials(email, password), password);
}

export async function createClientWithEmail(
  email: string,
  password: string,
): Promise<UserCredential> {
  const auth = getFirebaseAuth();
  return createUserWithEmailAndPassword(auth, requiredCredentials(email, password), password);
}

export async function signInWithGoogle(): Promise<UserCredential> {
  return signInWithGoogleFromFirebase();
}

export async function sendPasswordReset(email: string): Promise<void> {
  return sendPasswordResetEmail(getFirebaseAuth(), requiredEmail(email));
}

/**
 * The email action page (/auth/action) answers the links in Firebase Auth emails. Its Auth calls
 * must carry App Check (Auth enforcement), so it starts here and refuses to go on without it.
 */
export function prepareAccountAction(): void {
  requireFirebaseAppCheck();
}

/**
 * What an email link's code really does (PASSWORD_RESET, VERIFY_EMAIL, VERIFY_AND_CHANGE_EMAIL,
 * RECOVER_EMAIL...) and the email it concerns, without spending it. The page trusts this, not the
 * link's own `mode`.
 */
export async function checkAccountLink(
  code: string,
): Promise<Readonly<{ operation: string; email: string | undefined }>> {
  const info = await checkActionCode(getFirebaseAuth(), code);
  return { operation: info.operation, email: info.data.email ?? undefined };
}

export async function confirmNewPassword(code: string, newPassword: string): Promise<void> {
  await confirmPasswordReset(getFirebaseAuth(), code, newPassword);
}

export async function applyEmailAction(code: string): Promise<void> {
  await applyActionCode(getFirebaseAuth(), code);
}

/** Safe text for an email action failure; a used, unknown or deleted account all read the same. */
export function actionErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  switch (code) {
    case "auth/expired-action-code":
      return "This link has expired. Ask for a new one from the sign-in page.";
    case "auth/invalid-action-code":
    case "auth/user-not-found":
      return "This link is not valid or has already been used. Ask for a new one from the sign-in page.";
    case "auth/user-disabled":
      return "This account is not active. Contact the academy.";
    case "auth/weak-password":
    case "auth/password-does-not-meet-requirements":
      return "Choose a new password of 12 to 128 characters.";
    case "auth/network-request-failed":
      return "We couldn't connect. Check your connection and try again.";
    case "auth/too-many-requests":
      return "There have been too many attempts. Wait a moment and try again.";
    default:
      return "We couldn't complete this step. Try again, or ask for a new link from the sign-in page.";
  }
}

/** Keep email ownership tied to the signed-in applicant, including after an account switch. */
function applicantForVerification(expectedUid: string): User {
  const user = getFirebaseAuth().currentUser;
  if (!user || user.uid !== expectedUid) throw new Error("Sign in to continue.");
  return user;
}

export function clientEmailVerified(expectedUid: string): boolean | undefined {
  const user = getFirebaseAuth().currentUser;
  return user?.uid === expectedUid ? user.emailVerified : undefined;
}

export async function sendClientEmailVerification(expectedUid: string): Promise<void> {
  await sendEmailVerification(applicantForVerification(expectedUid));
}

export async function refreshClientEmailVerification(expectedUid: string): Promise<boolean> {
  const user = applicantForVerification(expectedUid);
  await reload(user);
  if (getFirebaseAuth().currentUser?.uid !== expectedUid) throw new Error("Sign in to continue.");
  await user.getIdToken(true);
  return user.emailVerified;
}

export function subscribeToIdTokenChanges(
  listener: (user: User | null) => void,
): Unsubscribe {
  // Every screen that waits for a session calls App Check functions next.
  prepareFirebaseAppCheck();
  return onIdTokenChanged(getFirebaseAuth(), listener);
}

export function signOutFromAuth(): Promise<void> {
  return signOutFromFirebase();
}

export function refreshAuthToken(user: User): Promise<IdTokenResult> {
  return refreshAuthTokenFromFirebase(user);
}

export { signOutFromFirebase } from "./firebase-client";
