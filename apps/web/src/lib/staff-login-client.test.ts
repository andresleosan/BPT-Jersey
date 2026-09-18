import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: "coach-miro", providerData: [] as { providerId: string }[] } },
  call: vi.fn(), token: vi.fn(), link: vi.fn(), refresh: vi.fn(), params: vi.fn(),
}));
vi.mock("./firebase-client", () => ({ getFirebaseAuth: () => mocks.auth, getFirebaseFunctions: () => ({}) }));
vi.mock("firebase/functions", () => ({ httpsCallable: () => mocks.call }));
vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class { setCustomParameters = mocks.params; },
  linkWithPopup: mocks.link, signInWithCustomToken: mocks.token,
}));
import { currentStaffAccess, linkStaffGoogle, signInWithStaffId, staffAccessError } from "./staff-login-client";

describe("coach sign-in client", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.currentUser.providerData = []; });
  it("exchanges numeric credentials for a Firebase session", async () => {
    mocks.call.mockResolvedValue({ data: { token: "synthetic-custom-token" } });
    await signInWithStaffId(" 100001 ", "test-password");
    expect(mocks.call).toHaveBeenCalledWith({ staffNumber: "100001", password: "test-password" });
    expect(mocks.token).toHaveBeenCalledWith(mocks.auth, "synthetic-custom-token");
  });
  it("links Google to the current user and refreshes that user's token", async () => {
    mocks.link.mockResolvedValue({ user: { getIdToken: mocks.refresh } });
    await linkStaffGoogle();
    expect(mocks.link).toHaveBeenCalledWith(mocks.auth.currentUser, expect.anything());
    expect(mocks.params).toHaveBeenCalledWith({ prompt: "select_account" });
    expect(mocks.refresh).toHaveBeenCalledWith(true);
  });
  it("recognizes an existing Google link", () => {
    mocks.auth.currentUser.providerData = [{ providerId: "google.com" }];
    expect(currentStaffAccess().googleLinked).toBe(true);
  });
  it("does not merge profiles when Google belongs to another account", async () => {
    const error = { code: "auth/credential-already-in-use" };
    mocks.link.mockRejectedValue(error);
    await expect(linkStaffGoogle()).rejects.toBe(error);
    expect(staffAccessError(error)).toContain("already linked to another profile");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
