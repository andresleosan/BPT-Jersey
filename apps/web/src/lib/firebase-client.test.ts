import { afterEach, describe, expect, it, vi } from "vitest";

const firebaseApp = { name: "firebase-app" };
const firebaseAuth = { name: "firebase-auth" };
const firebaseSdk = vi.hoisted(() => {
  const googleProvider = { providerId: "google.com" };
  const browserLocalPersistence = { type: "LOCAL" };
  const browserPopupRedirectResolver = { type: "POPUP" };
  const browserSessionPersistence = { type: "SESSION" };
  const indexedDBLocalPersistence = { type: "INDEXED_DB" };

  return {
    browserLocalPersistence,
    browserPopupRedirectResolver,
    browserSessionPersistence,
    connectAuthEmulator: vi.fn(),
    getAuth: vi.fn(() => firebaseAuth),
    getIdTokenResult: vi.fn(),
    getMultiFactorResolver: vi.fn(),
    googleProvider,
    GoogleAuthProvider: vi.fn(function GoogleAuthProvider() {
      return googleProvider;
    }),
    indexedDBLocalPersistence,
    initializeAuth: vi.fn(() => firebaseAuth),
    multiFactor: vi.fn(),
    onIdTokenChanged: vi.fn(),
    signInWithPopup: vi.fn(),
    signOut: vi.fn(),
    TotpMultiFactorGenerator: {
      assertionForEnrollment: vi.fn(),
      assertionForSignIn: vi.fn(),
      generateSecret: vi.fn(),
    },
  };
});

vi.mock("firebase/app", () => ({
  getApps: vi.fn(() => [firebaseApp]),
  initializeApp: vi.fn(() => firebaseApp),
}));

vi.mock("firebase/auth", () => ({
  browserLocalPersistence: firebaseSdk.browserLocalPersistence,
  browserPopupRedirectResolver: firebaseSdk.browserPopupRedirectResolver,
  browserSessionPersistence: firebaseSdk.browserSessionPersistence,
  connectAuthEmulator: firebaseSdk.connectAuthEmulator,
  getAuth: firebaseSdk.getAuth,
  GoogleAuthProvider: firebaseSdk.GoogleAuthProvider,
  indexedDBLocalPersistence: firebaseSdk.indexedDBLocalPersistence,
  initializeAuth: firebaseSdk.initializeAuth,
  getIdTokenResult: firebaseSdk.getIdTokenResult,
  getMultiFactorResolver: firebaseSdk.getMultiFactorResolver,
  multiFactor: firebaseSdk.multiFactor,
  onIdTokenChanged: firebaseSdk.onIdTokenChanged,
  signInWithPopup: firebaseSdk.signInWithPopup,
  signOut: firebaseSdk.signOut,
  TotpMultiFactorGenerator: firebaseSdk.TotpMultiFactorGenerator,
}));

vi.mock("firebase/firestore", () => ({
  connectFirestoreEmulator: vi.fn(),
  getFirestore: vi.fn(),
}));

vi.mock("firebase/functions", () => ({
  connectFunctionsEmulator: vi.fn(),
  getFunctions: vi.fn(),
}));

process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "test-api-key";
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = "test.firebaseapp.com";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "demo-test";
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = "test.appspot.com";
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = "test-sender";
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = "test-app";

import {
  beginTotpEnrollment,
  completeTotpEnrollment,
  getFirebaseAuth,
  hasTotpEnrollment,
  refreshAuthToken,
  resolveTotpChallenge,
  signInWithGoogle,
} from "./firebase-client";

describe("firebase-client", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS;
    delete process.env.NEXT_PUBLIC_FIREBASE_ENV;
    vi.clearAllMocks();
  });

  it("initializes session auth without loading the Google popup resolver", () => {
    expect(getFirebaseAuth()).toBe(firebaseAuth);
    expect(firebaseSdk.initializeAuth).toHaveBeenCalledWith(firebaseApp, {
      persistence: [
        firebaseSdk.indexedDBLocalPersistence,
        firebaseSdk.browserLocalPersistence,
        firebaseSdk.browserSessionPersistence,
      ],
    });
  });

  it("rejects emulator use outside the local environment", () => {
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = "true";
    process.env.NEXT_PUBLIC_FIREBASE_ENV = "staging";

    expect(() => getFirebaseAuth()).toThrow(/local-only/i);
  });

  it("uses the Firebase popup flow after connecting the local Auth emulator", async () => {
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = "true";
    process.env.NEXT_PUBLIC_FIREBASE_ENV = "local";

    await signInWithGoogle();

    expect(firebaseSdk.connectAuthEmulator).toHaveBeenCalledWith(
      firebaseAuth,
      "http://127.0.0.1:9099",
      { disableWarnings: true },
    );
    expect(firebaseSdk.signInWithPopup).toHaveBeenCalledWith(
      firebaseAuth,
      firebaseSdk.googleProvider,
      firebaseSdk.browserPopupRedirectResolver,
    );
  });

  it("keeps TOTP enrollment and challenge operations inside the Auth boundary", async () => {
    const user = { uid: "admin-1", email: "admin@example.test" };
    const session = { session: "synthetic-session" };
    const secret = {
      generateQrCodeUrl: vi.fn(() => "otpauth://synthetic-uri"),
    };
    const enrollmentUser = {
      getSession: vi.fn().mockResolvedValue(session),
      enrolledFactors: [],
      enroll: vi.fn().mockResolvedValue(undefined),
    };
    const enrollmentAssertion = { factorId: "totp" };
    const resolver = {
      hints: [{ uid: "factor-1", factorId: "totp" }],
      resolveSignIn: vi.fn().mockResolvedValue({ user }),
    };

    firebaseSdk.multiFactor.mockReturnValue(enrollmentUser);
    firebaseSdk.TotpMultiFactorGenerator.generateSecret.mockResolvedValue(secret);
    firebaseSdk.TotpMultiFactorGenerator.assertionForEnrollment.mockReturnValue(
      enrollmentAssertion,
    );
    firebaseSdk.getMultiFactorResolver.mockReturnValue(resolver);
    firebaseSdk.TotpMultiFactorGenerator.assertionForSignIn.mockReturnValue({ factorId: "totp" });
    firebaseSdk.getIdTokenResult.mockResolvedValue({ claims: { firebase: { sign_in_second_factor: "totp" } } });

    const enrollment = await beginTotpEnrollment(user as never, "admin@example.test");
    await completeTotpEnrollment(enrollment, "123456");
    const credential = await resolveTotpChallenge(
      { code: "auth/multi-factor-auth-required" } as never,
      "654321",
    );
    const tokenResult = await refreshAuthToken(user as never);

    expect(enrollment.qrCodeUrl).toBe("otpauth://synthetic-uri");
    expect(secret.generateQrCodeUrl).toHaveBeenCalledWith("admin@example.test", "BPT Jersey");
    expect(firebaseSdk.TotpMultiFactorGenerator.assertionForEnrollment).toHaveBeenCalledWith(
      secret,
      "123456",
    );
    expect(enrollmentUser.enroll).toHaveBeenCalledWith(enrollmentAssertion, "BPT Jersey authenticator");
    expect(firebaseSdk.TotpMultiFactorGenerator.assertionForSignIn).toHaveBeenCalledWith(
      "factor-1",
      "654321",
    );
    expect(resolver.resolveSignIn).toHaveBeenCalledWith({ factorId: "totp" });
    expect(credential).toEqual({ user });
    expect(tokenResult.claims).toEqual({ firebase: { sign_in_second_factor: "totp" } });
    expect(firebaseSdk.getIdTokenResult).toHaveBeenCalledWith(user, true);
    expect(window.localStorage.length).toBe(0);
  });

  it("recognizes only TOTP enrolled factors", () => {
    firebaseSdk.multiFactor.mockReturnValue({
      enrolledFactors: [
        { factorId: "phone" },
        { factorId: "totp" },
      ],
    });

    expect(hasTotpEnrollment({} as never)).toBe(true);
    firebaseSdk.multiFactor.mockReturnValue({ enrolledFactors: [{ factorId: "phone" }] });
    expect(hasTotpEnrollment({} as never)).toBe(false);
  });
});
