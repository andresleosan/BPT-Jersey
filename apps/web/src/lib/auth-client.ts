"use client";

import {
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  type Unsubscribe,
  type User,
  type UserCredential,
} from "firebase/auth";

import {
  beginTotpEnrollment as beginTotpEnrollmentFromFirebase,
  completeTotpEnrollment as completeTotpEnrollmentFromFirebase,
  getFirebaseAuth,
  hasTotpEnrollment as hasTotpEnrollmentFromFirebase,
  refreshAuthToken as refreshAuthTokenFromFirebase,
  resolveTotpChallenge as resolveTotpChallengeFromFirebase,
  signInWithGoogle as signInWithGoogleFromFirebase,
  signOutFromFirebase,
  type MfaEnrollment,
} from "./firebase-client";
import type { IdTokenResult, MultiFactorError } from "firebase/auth";

export type { MfaEnrollment } from "./firebase-client";

let pendingMfaError: MultiFactorError | undefined;

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

export function subscribeToIdTokenChanges(
  listener: (user: User | null) => void,
): Unsubscribe {
  return onIdTokenChanged(getFirebaseAuth(), listener);
}

export function signOutFromAuth(): Promise<void> {
  return signOutFromFirebase();
}

export function beginTotpEnrollment(user: User, accountName: string): Promise<MfaEnrollment> {
  return beginTotpEnrollmentFromFirebase(user, accountName);
}

export function completeTotpEnrollment(enrollment: MfaEnrollment, code: string): Promise<void> {
  return completeTotpEnrollmentFromFirebase(enrollment, code);
}

export function hasTotpEnrollment(user: User): boolean {
  return hasTotpEnrollmentFromFirebase(user);
}

export function refreshAuthToken(user: User): Promise<IdTokenResult> {
  return refreshAuthTokenFromFirebase(user);
}

export function resolveTotpChallenge(
  error: MultiFactorError,
  code: string,
): Promise<UserCredential> {
  return resolveTotpChallengeFromFirebase(error, code);
}

export function rememberMfaError(error: MultiFactorError): void {
  pendingMfaError = error;
}

export function getPendingMfaError(): MultiFactorError | undefined {
  return pendingMfaError;
}

export function clearPendingMfaError(): void {
  pendingMfaError = undefined;
}

export { signOutFromFirebase } from "./firebase-client";
