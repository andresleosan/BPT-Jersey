import { beforeEach, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  reload: vi.fn(),
  sendEmailVerification: vi.fn(),
}));
const login = vi.hoisted(() => ({
  createClientWithEmail: vi.fn(),
  signInWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOutFromAuth: vi.fn(),
  sendPasswordReset: vi.fn(),
}));
const firebase = vi.hoisted(() => ({ getFirebaseAuth: vi.fn() }));
vi.mock("firebase/auth", () => sdk);
vi.mock("./auth-client", () => login);
vi.mock("./firebase-client", () => firebase);
import {
  recoverySignIn,
  refreshRecoverySession,
  sendRecoveryVerification,
  subscribeRecoverySession,
} from "./member-recovery-auth";
const user = { uid: "synthetic-a", email: "alex@example.test", getIdToken: vi.fn() };
const instance: { currentUser: typeof user | null } = { currentUser: user };
beforeEach(() => {
  vi.resetAllMocks();
  instance.currentUser = user;
  firebase.getFirebaseAuth.mockReturnValue(instance);
  login.createClientWithEmail.mockResolvedValue({ user });
  login.signInWithEmail.mockResolvedValue({ user });
  login.signInWithGoogle.mockResolvedValue({ user });
});
it("exposes UID and email through the Firebase observer and preserves unsubscribe", () => {
  const unsubscribe = vi.fn(),
    listener = vi.fn();
  sdk.onAuthStateChanged.mockReturnValue(unsubscribe);
  expect(subscribeRecoverySession(listener)).toBe(unsubscribe);
  const callback = sdk.onAuthStateChanged.mock.calls[0]![1];
  callback(user);
  expect(listener).toHaveBeenLastCalledWith({ uid: user.uid, email: user.email });
  callback(null);
  expect(listener).toHaveBeenLastCalledWith(null);
});
it.each(["google", "create", "sign-in"] as const)(
  "returns the SDK identity for %s",
  async (mode) => {
    expect(await recoverySignIn(mode, user.email, "synthetic-password")).toEqual({
      uid: user.uid,
      email: user.email,
    });
  },
);
it("sends verification through the SDK only for the expected identity", async () => {
  await sendRecoveryVerification(user.uid);
  expect(sdk.sendEmailVerification).toHaveBeenCalledWith(user);
  await expect(sendRecoveryVerification("synthetic-b")).rejects.toThrow("Sign in to continue");
  expect(sdk.sendEmailVerification).toHaveBeenCalledTimes(1);
});
it("propagates delivery failures so the form can retain and resend", async () => {
  sdk.sendEmailVerification.mockRejectedValue(new Error("Synthetic mail failure"));
  await expect(sendRecoveryVerification(user.uid)).rejects.toThrow("Synthetic mail failure");
  expect(instance.currentUser).toBe(user);
});
it("reloads then forces a token refresh for the expected identity", async () => {
  expect(await refreshRecoverySession(user.uid)).toEqual({ uid: user.uid, email: user.email });
  expect(sdk.reload).toHaveBeenCalledWith(user);
  expect(user.getIdToken).toHaveBeenCalledWith(true);
  expect(sdk.reload.mock.invocationCallOrder[0]).toBeLessThan(
    user.getIdToken.mock.invocationCallOrder[0]!,
  );
});
it("rejects a changed identity before forcing its token refresh", async () => {
  sdk.reload.mockImplementation(async () => {
    instance.currentUser = null;
  });
  await expect(refreshRecoverySession(user.uid)).rejects.toThrow("Sign in to continue");
  expect(user.getIdToken).not.toHaveBeenCalled();
});
it("rejects an identity change while token refresh is pending", async () => {
  user.getIdToken.mockImplementation(async () => {
    instance.currentUser = null;
  });
  await expect(refreshRecoverySession(user.uid)).rejects.toThrow("Sign in to continue");
});
