import { afterEach, describe, expect, it, vi } from "vitest";

const firebaseAuth = vi.hoisted(() => ({
  auth: { name: "auth" },
  createUserWithEmailAndPassword: vi.fn(),
  onIdTokenChanged: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOutFromFirebase: vi.fn(),
  refreshAuthToken: vi.fn(),
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
  refreshAuthToken: firebaseAuth.refreshAuthToken,
}));

import {
  createClientWithEmail,
  refreshAuthToken,
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

  it("delegates claim refreshes to the Firebase boundary", async () => {
    const user = {} as never;

    await refreshAuthToken(user);

    expect(firebaseAuth.refreshAuthToken).toHaveBeenCalledWith(user);
  });
});
