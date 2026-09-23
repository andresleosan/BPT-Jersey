"use client";

import {
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
  return onIdTokenChanged(getFirebaseAuth(), listener);
}

export function signOutFromAuth(): Promise<void> {
  return signOutFromFirebase();
}

export function refreshAuthToken(user: User): Promise<IdTokenResult> {
  return refreshAuthTokenFromFirebase(user);
}

export { signOutFromFirebase } from "./firebase-client";
