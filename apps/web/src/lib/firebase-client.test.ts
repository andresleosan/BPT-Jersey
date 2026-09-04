import { afterEach, describe, expect, it, vi } from "vitest";

const firebaseApp = { name: "firebase-app" };
const firebaseAppCheck = { name: "firebase-app-check" };
const firebaseAuth = { name: "firebase-auth" };
const firebaseFunctions = { name: "firebase-functions" };
const firebaseAppCheckSdk = vi.hoisted(() => {
  const initializeAppCheck = vi.fn(() => firebaseAppCheck);
  const ReCaptchaEnterpriseProvider = vi.fn(function ReCaptchaEnterpriseProvider(
    siteKey: string,
  ) {
    return { siteKey };
  });

  return {
    initializeAppCheck,
    ReCaptchaEnterpriseProvider,
  };
});
const firebaseFunctionsSdk = vi.hoisted(() => ({
  connectFunctionsEmulator: vi.fn(),
  getFunctions: vi.fn(() => firebaseFunctions),
}));
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

vi.mock("firebase/app-check", () => ({
  initializeAppCheck: firebaseAppCheckSdk.initializeAppCheck,
  ReCaptchaEnterpriseProvider: firebaseAppCheckSdk.ReCaptchaEnterpriseProvider,
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
  connectFunctionsEmulator: firebaseFunctionsSdk.connectFunctionsEmulator,
  getFunctions: firebaseFunctionsSdk.getFunctions,
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
  resolveLocalEmulatorPort,
  resolveTotpChallenge,
  signInWithGoogle,
} from "./firebase-client";

describe("firebase-client", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS;
    delete process.env.NEXT_PUBLIC_FIREBASE_ENV;
    delete process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN;
    delete process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY;
    delete (
      globalThis as typeof globalThis & {
        FIREBASE_APPCHECK_DEBUG_TOKEN?: string;
      }
    ).FIREBASE_APPCHECK_DEBUG_TOKEN;
    vi.unstubAllGlobals();
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

  it("accepts only explicit local emulator ports", () => {
    expect(resolveLocalEmulatorPort(undefined, 9_099)).toBe(9_099);
    expect(resolveLocalEmulatorPort("9199", 9_099)).toBe(9_199);
    expect(() => resolveLocalEmulatorPort("0", 9_099)).toThrow(/decimal integers/i);
    expect(() => resolveLocalEmulatorPort("443", 9_099)).toThrow(/between 1024 and 65535/i);
    expect(() => resolveLocalEmulatorPort("65536", 9_099)).toThrow(/between 1024 and 65535/i);
    expect(() => resolveLocalEmulatorPort("9199.example", 9_099)).toThrow(/decimal integers/i);
  });

  it("initializes one Enterprise App Check instance before returning Functions", async () => {
    process.env.NEXT_PUBLIC_FIREBASE_ENV = "staging";
    process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY = "enterprise-site-key";
    vi.resetModules();
    const { getFirebaseFunctions } = await import("./firebase-client");

    expect(getFirebaseFunctions()).toBe(firebaseFunctions);
    expect(getFirebaseFunctions()).toBe(firebaseFunctions);

    expect(firebaseAppCheckSdk.ReCaptchaEnterpriseProvider).toHaveBeenCalledOnce();
    expect(firebaseAppCheckSdk.ReCaptchaEnterpriseProvider).toHaveBeenCalledWith(
      "enterprise-site-key",
    );
    expect(firebaseAppCheckSdk.initializeAppCheck).toHaveBeenCalledOnce();
    expect(firebaseAppCheckSdk.initializeAppCheck).toHaveBeenCalledWith(firebaseApp, {
      provider: { siteKey: "enterprise-site-key" },
      isTokenAutoRefreshEnabled: true,
    });
    expect(firebaseFunctionsSdk.getFunctions).toHaveBeenCalledTimes(2);
    expect(
      firebaseAppCheckSdk.initializeAppCheck.mock.invocationCallOrder[0]!,
    ).toBeLessThan(firebaseFunctionsSdk.getFunctions.mock.invocationCallOrder[0]!);
  });

  it("fails closed before creating Functions when App Check has no site key", async () => {
    process.env.NEXT_PUBLIC_FIREBASE_ENV = "staging";
    vi.resetModules();
    const { getFirebaseFunctions } = await import("./firebase-client");

    expect(() => getFirebaseFunctions()).toThrow(/App Check site key/i);
    expect(firebaseAppCheckSdk.initializeAppCheck).not.toHaveBeenCalled();
    expect(firebaseFunctionsSdk.getFunctions).not.toHaveBeenCalled();
  });

  it("keeps local Emulator Functions available without an App Check site key", async () => {
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = "true";
    process.env.NEXT_PUBLIC_FIREBASE_ENV = "local";
    vi.resetModules();
    const { getFirebaseFunctions } = await import("./firebase-client");

    expect(getFirebaseFunctions()).toBe(firebaseFunctions);
    expect(firebaseAppCheckSdk.initializeAppCheck).not.toHaveBeenCalled();
  });

  it("passes an explicit local Emulator debug token to App Check before initialization", async () => {
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = "true";
    process.env.NEXT_PUBLIC_FIREBASE_ENV = "local";
    process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY = "local-enterprise-site-key";
    process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN = "synthetic-debug-token";
    let debugTokenDuringInitialization: string | undefined;
    firebaseAppCheckSdk.initializeAppCheck.mockImplementationOnce(() => {
      debugTokenDuringInitialization = (
        globalThis as typeof globalThis & {
          FIREBASE_APPCHECK_DEBUG_TOKEN?: string;
        }
      ).FIREBASE_APPCHECK_DEBUG_TOKEN;
      return firebaseAppCheck;
    });
    vi.resetModules();
    const { getFirebaseFunctions } = await import("./firebase-client");

    expect(getFirebaseFunctions()).toBe(firebaseFunctions);
    expect(debugTokenDuringInitialization).toBe("synthetic-debug-token");
  });

  it("rejects App Check debug tokens outside the local Emulator", async () => {
    process.env.NEXT_PUBLIC_FIREBASE_ENV = "staging";
    process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY = "enterprise-site-key";
    process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN = "synthetic-debug-token";
    vi.resetModules();
    const { getFirebaseFunctions } = await import("./firebase-client");

    expect(() => getFirebaseFunctions()).toThrow(/debug tokens are local Emulator-only/i);
    expect(firebaseAppCheckSdk.initializeAppCheck).not.toHaveBeenCalled();
    expect(firebaseFunctionsSdk.getFunctions).not.toHaveBeenCalled();
  });

  it("fails closed without touching browser-only App Check APIs during SSR", async () => {
    process.env.NEXT_PUBLIC_FIREBASE_ENV = "staging";
    process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY = "enterprise-site-key";
    vi.stubGlobal("window", undefined);
    vi.resetModules();
    const { getFirebaseFunctions } = await import("./firebase-client");

    expect(() => getFirebaseFunctions()).toThrow(/browser-only/i);
    expect(firebaseAppCheckSdk.ReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
    expect(firebaseAppCheckSdk.initializeAppCheck).not.toHaveBeenCalled();
    expect(firebaseFunctionsSdk.getFunctions).not.toHaveBeenCalled();
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
