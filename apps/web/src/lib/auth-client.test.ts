import { afterEach, describe, expect, it, vi } from "vitest";

const firebaseAuth = vi.hoisted(() => ({
  auth: { name: "auth" },
  createUserWithEmailAndPassword: vi.fn(),
  onIdTokenChanged: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOutFromFirebase: vi.fn(),
  beginTotpEnrollment: vi.fn(),
  completeTotpEnrollment: vi.fn(),
  hasTotpEnrollment: vi.fn(),
  refreshAuthToken: vi.fn(),
  resolveTotpChallenge: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: firebaseAuth.createUserWithEmailAndPassword,
  onIdTokenChanged: firebaseAuth.onIdTokenChanged,
  sendPasswordResetEmail: firebaseAuth.sendPasswordResetEmail,
  signInWithEmailAndPassword: firebaseAuth.signInWithEmailAndPassword,
}));

vi.mock("./firebase-client", () => ({
  getFirebaseAuth: () => firebaseAuth.auth,
  signInWithGoogle: firebaseAuth.signInWithGoogle,
  signOutFromFirebase: firebaseAuth.signOutFromFirebase,
  beginTotpEnrollment: firebaseAuth.beginTotpEnrollment,
  completeTotpEnrollment: firebaseAuth.completeTotpEnrollment,
  hasTotpEnrollment: firebaseAuth.hasTotpEnrollment,
  refreshAuthToken: firebaseAuth.refreshAuthToken,
  resolveTotpChallenge: firebaseAuth.resolveTotpChallenge,
}));

import {
  createClientWithEmail,
  beginTotpEnrollment,
  completeTotpEnrollment,
  hasTotpEnrollment,
  refreshAuthToken,
  resolveTotpChallenge,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signOutFromAuth,
  subscribeToIdTokenChanges,
} from "./auth-client";

describe("auth-client", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("trims the email before delegating email sign-in", async () => {
    await signInWithEmail("  person@example.test  ", "password");

    expect(firebaseAuth.signInWithEmailAndPassword).toHaveBeenCalledWith(
      firebaseAuth.auth,
      "person@example.test",
      "password",
    );
  });

  it("rejects blank credentials before calling Firebase", async () => {
    await expect(signInWithEmail("  ", "  ")).rejects.toThrow("Email and password are required");
    expect(firebaseAuth.signInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it("delegates client registration with a trimmed email", async () => {
    await createClientWithEmail(" client@example.test ", "password");

    expect(firebaseAuth.createUserWithEmailAndPassword).toHaveBeenCalledWith(
      firebaseAuth.auth,
      "client@example.test",
      "password",
    );
  });

  it("delegates Google sign-in through the shared Firebase boundary", async () => {
    await signInWithGoogle();

    expect(firebaseAuth.signInWithGoogle).toHaveBeenCalledOnce();
  });

  it("trims the email before requesting a password reset", async () => {
    await sendPasswordReset(" person@example.test ");

    expect(firebaseAuth.sendPasswordResetEmail).toHaveBeenCalledWith(
      firebaseAuth.auth,
      "person@example.test",
    );
  });

  it("subscribes to ID token changes and maps sign-out to the existing boundary", async () => {
    const listener = vi.fn();

    subscribeToIdTokenChanges(listener);
    await signOutFromAuth();

    expect(firebaseAuth.onIdTokenChanged).toHaveBeenCalledWith(firebaseAuth.auth, listener);
    expect(firebaseAuth.signOutFromFirebase).toHaveBeenCalledOnce();
  });

  it("exposes typed MFA operations without adding a persistence boundary", async () => {
    const user = {} as never;
    const enrollment = {} as never;
    const error = {} as never;

    await beginTotpEnrollment(user, "admin@example.test");
    await completeTotpEnrollment(enrollment, "123456");
    hasTotpEnrollment(user);
    await refreshAuthToken(user);
    await resolveTotpChallenge(error, "654321");

    expect(firebaseAuth.beginTotpEnrollment).toHaveBeenCalledWith(user, "admin@example.test");
    expect(firebaseAuth.completeTotpEnrollment).toHaveBeenCalledWith(enrollment, "123456");
    expect(firebaseAuth.hasTotpEnrollment).toHaveBeenCalledWith(user);
    expect(firebaseAuth.refreshAuthToken).toHaveBeenCalledWith(user);
    expect(firebaseAuth.resolveTotpChallenge).toHaveBeenCalledWith(error, "654321");
  });
});
