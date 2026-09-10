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
