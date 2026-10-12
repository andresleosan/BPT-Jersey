import { afterEach, describe, expect, it, vi } from "vitest";

const firebaseAuth = vi.hoisted(() => ({
  auth: { name: "auth" },
  applyActionCode: vi.fn(),
  checkActionCode: vi.fn(),
  confirmPasswordReset: vi.fn(),
  requireFirebaseAppCheck: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  onIdTokenChanged: vi.fn(),
  prepareFirebaseAppCheck: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOutFromFirebase: vi.fn(),
  refreshAuthToken: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  applyActionCode: firebaseAuth.applyActionCode,
  checkActionCode: firebaseAuth.checkActionCode,
  confirmPasswordReset: firebaseAuth.confirmPasswordReset,
  createUserWithEmailAndPassword: firebaseAuth.createUserWithEmailAndPassword,
  onIdTokenChanged: firebaseAuth.onIdTokenChanged,
  sendPasswordResetEmail: firebaseAuth.sendPasswordResetEmail,
  signInWithEmailAndPassword: firebaseAuth.signInWithEmailAndPassword,
}));

vi.mock("./firebase-client", () => ({
  getFirebaseAuth: () => firebaseAuth.auth,
  prepareFirebaseAppCheck: firebaseAuth.prepareFirebaseAppCheck,
  requireFirebaseAppCheck: firebaseAuth.requireFirebaseAppCheck,
  signInWithGoogle: firebaseAuth.signInWithGoogle,
  signOutFromFirebase: firebaseAuth.signOutFromFirebase,
  refreshAuthToken: firebaseAuth.refreshAuthToken,
}));

import {
  actionErrorMessage,
  applyEmailAction,
  checkAccountLink,
  confirmNewPassword,
  createClientWithEmail,
  prepareAccountAction,
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

  it("lets the email action page stop when App Check cannot start", () => {
    firebaseAuth.requireFirebaseAppCheck.mockImplementationOnce(() => {
      throw new Error("A Firebase App Check site key is required.");
    });
    expect(() => prepareAccountAction()).toThrow(/App Check site key/);
    expect(() => prepareAccountAction()).not.toThrow();
    expect(firebaseAuth.requireFirebaseAppCheck).toHaveBeenCalledTimes(2);
  });

  it("checks, confirms and applies email action codes on the app's own Auth instance", async () => {
    firebaseAuth.checkActionCode.mockResolvedValueOnce({
      operation: "RECOVER_EMAIL",
      data: { email: "old@example.test", previousEmail: "new@example.test" },
    });
    await expect(checkAccountLink("code-654321")).resolves.toEqual({
      operation: "RECOVER_EMAIL",
      email: "old@example.test",
    });
    await confirmNewPassword("code-123456", "a-long-new-password");
    await applyEmailAction("code-654321");
    expect(firebaseAuth.confirmPasswordReset).toHaveBeenCalledWith(
      firebaseAuth.auth,
      "code-123456",
      "a-long-new-password",
    );
    expect(firebaseAuth.checkActionCode).toHaveBeenCalledWith(firebaseAuth.auth, "code-654321");
    expect(firebaseAuth.applyActionCode).toHaveBeenCalledWith(firebaseAuth.auth, "code-654321");
  });

  it("explains email action failures without raw Firebase text or account enumeration", () => {
    expect(actionErrorMessage({ code: "auth/expired-action-code" })).toMatch(/expired/);
    expect(actionErrorMessage({ code: "auth/user-not-found" })).toBe(
      actionErrorMessage({ code: "auth/invalid-action-code" }),
    );
    expect(actionErrorMessage({ code: "auth/password-does-not-meet-requirements" })).toBe(
      "Choose a new password of 12 to 128 characters.",
    );
    const raw = new Error("Firebase: Error (auth/internal-error) at identitytoolkit");
    expect(actionErrorMessage(raw)).not.toMatch(/Firebase|identitytoolkit/);
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
    // App Check starts with the session listener, not at the first function call.
    expect(firebaseAuth.prepareFirebaseAppCheck).toHaveBeenCalledOnce();
  });

  it("delegates claim refreshes to the Firebase boundary", async () => {
    const user = {} as never;

    await refreshAuthToken(user);

    expect(firebaseAuth.refreshAuthToken).toHaveBeenCalledWith(user);
  });
});
