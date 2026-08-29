"use client";

import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  connectAuthEmulator,
  getIdTokenResult,
  getMultiFactorResolver,
  getAuth,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  multiFactor,
  onIdTokenChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type IdTokenResult,
  type MultiFactorError,
  type TotpSecret,
  type Unsubscribe,
  type User,
  type UserCredential,
  TotpMultiFactorGenerator,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  type Functions,
} from "firebase/functions";

import { isValidTotpCode } from "./mfa-flow";

const firestoreEmulatorHost = "127.0.0.1";

export function resolveLocalEmulatorPort(
  rawPort: string | undefined,
  defaultPort: number,
): number {
  if (rawPort === undefined) return defaultPort;
  if (!/^[1-9]\d{0,4}$/u.test(rawPort)) {
    throw new Error("Firebase emulator ports must be decimal integers.");
  }

  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("Firebase emulator ports must be between 1024 and 65535.");
  }

  return port;
}

const authEmulatorPort = resolveLocalEmulatorPort(
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT,
  9_099,
);
const functionsEmulatorPort = resolveLocalEmulatorPort(
  process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT,
  5_001,
);
const firestoreEmulatorPort = resolveLocalEmulatorPort(
  process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT,
  8_080,
);
const authEmulatorUrl = `http://${firestoreEmulatorHost}:${authEmulatorPort}`;

export type MfaEnrollment = Readonly<{
  qrCodeUrl: string;
  secret: TotpSecret;
}>;

let authEmulatorConnected = false;
let firestoreEmulatorConnected = false;
let functionsEmulatorConnected = false;
let firebaseAuth: Auth | undefined;
const enrollmentUsers = new WeakMap<object, User>();

function shouldUseFirebaseEmulators(): boolean {
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") {
    return false;
  }

  const firebaseEnvironment =
    process.env.NEXT_PUBLIC_FIREBASE_ENV ??
    (process.env.NODE_ENV === "development" ? "local" : "production");

  if (firebaseEnvironment !== "local") {
    throw new Error("Firebase emulators are local-only and cannot run in this environment.");
  }

  return true;
}

function requiredPublicValue(value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error("Firebase public configuration is incomplete.");
  }

  return value;
}

function publicFirebaseOptions(): FirebaseOptions {
  const options: FirebaseOptions = {
    apiKey: requiredPublicValue(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: requiredPublicValue(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: requiredPublicValue(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    storageBucket: requiredPublicValue(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: requiredPublicValue(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
    appId: requiredPublicValue(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
  };

  return options;
}

export function getFirebaseClient(): FirebaseApp {
  return getApps()[0] ?? initializeApp(publicFirebaseOptions());
}

export function getFirebaseAuth(): Auth {
  if (!firebaseAuth) {
    const app = getFirebaseClient();

    try {
      firebaseAuth = initializeAuth(app, {
        persistence: [
          indexedDBLocalPersistence,
          browserLocalPersistence,
          browserSessionPersistence,
        ],
      });
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "auth/already-initialized"
      ) {
        throw error;
      }

      firebaseAuth = getAuth(app);
    }
  }

  const auth = firebaseAuth;

  if (shouldUseFirebaseEmulators() && !authEmulatorConnected) {
    connectAuthEmulator(auth, authEmulatorUrl, { disableWarnings: true });
    authEmulatorConnected = true;
  }

  return auth;
}

export function getFirebaseFirestore(): Firestore {
  const firestore = getFirestore(getFirebaseClient());

  if (shouldUseFirebaseEmulators() && !firestoreEmulatorConnected) {
    connectFirestoreEmulator(firestore, firestoreEmulatorHost, firestoreEmulatorPort);
    firestoreEmulatorConnected = true;
  }

  return firestore;
}

export function getFirebaseFunctions(): Functions {
  const functions = getFunctions(getFirebaseClient());

  if (shouldUseFirebaseEmulators() && !functionsEmulatorConnected) {
    connectFunctionsEmulator(functions, firestoreEmulatorHost, functionsEmulatorPort);
    functionsEmulatorConnected = true;
  }

  return functions;
}

export function subscribeToIdTokenChanges(listener: (user: User | null) => void): Unsubscribe {
  return onIdTokenChanged(getFirebaseAuth(), listener);
}

export function signInWithGoogle(): Promise<UserCredential> {
  return signInWithPopup(
    getFirebaseAuth(),
    new GoogleAuthProvider(),
    browserPopupRedirectResolver,
  );
}

export function signOutFromFirebase(): Promise<void> {
  return signOut(getFirebaseAuth());
}

export async function beginTotpEnrollment(
  user: User,
  accountName: string,
): Promise<MfaEnrollment> {
  const normalizedAccountName = accountName.trim();
  if (!normalizedAccountName) {
    throw new Error("An account name is required to set up MFA.");
  }

  const userMfa = multiFactor(user);
  const session = await userMfa.getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  const enrollment = Object.freeze({
    qrCodeUrl: secret.generateQrCodeUrl(normalizedAccountName, "BPT Jersey"),
    secret,
  });

  enrollmentUsers.set(enrollment, user);
  return enrollment;
}

export async function completeTotpEnrollment(
  enrollment: MfaEnrollment,
  code: string,
): Promise<void> {
  if (!isValidTotpCode(code)) {
    throw new Error("A six-digit verification code is required.");
  }

  const user = enrollmentUsers.get(enrollment);
  if (!user) {
    throw new Error("The MFA enrollment session is no longer available.");
  }

  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(enrollment.secret, code);
  await multiFactor(user).enroll(assertion, "BPT Jersey authenticator");
  enrollmentUsers.delete(enrollment);
}

export async function resolveTotpChallenge(
  error: MultiFactorError,
  code: string,
): Promise<UserCredential> {
  if (!isValidTotpCode(code)) {
    throw new Error("A six-digit verification code is required.");
  }

  const resolver = getMultiFactorResolver(getFirebaseAuth(), error);
  const totpHint = resolver.hints.find((hint) => hint.factorId === "totp");
  if (!totpHint) {
    throw new Error("No TOTP factor is available for this sign-in.");
  }

  const assertion = TotpMultiFactorGenerator.assertionForSignIn(totpHint.uid, code);
  return resolver.resolveSignIn(assertion);
}

export function hasTotpEnrollment(user: User): boolean {
  return multiFactor(user).enrolledFactors.some((factor) => factor.factorId === "totp");
}

export function refreshAuthToken(user: User): Promise<IdTokenResult> {
  return getIdTokenResult(user, true);
}
