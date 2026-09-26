import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { email: "old@example.test" } as { email: string | null },
  credential: vi.fn((email: string, password: string) => ({ email, password })),
  reauthenticateWithCredential: vi.fn(),
  verifyBeforeUpdateEmail: vi.fn(),
  updatePassword: vi.fn(),
  callable: vi.fn(),
  httpsCallable: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  EmailAuthProvider: { credential: mocks.credential },
  reauthenticateWithCredential: mocks.reauthenticateWithCredential,
  verifyBeforeUpdateEmail: mocks.verifyBeforeUpdateEmail,
  updatePassword: mocks.updatePassword,
}));
vi.mock("./firebase-client", () => ({
  getFirebaseAuth: () => ({ currentUser: mocks.user }),
  getFirebaseFunctions: () => ({}),
}));
vi.mock("./callable", () => ({
  httpsCallable: (...args: unknown[]) => {
    mocks.httpsCallable(...args);
    return mocks.callable;
  },
}));

import {
  accountMessages,
  adultClaimMessages,
  changePassword,
  claimAdultAccount,
  createTeenAccess,
  getOwnEmergencyContact,
  requestEmailChange,
  saveOwnEmergencyContact,
  settingsMessages,
  syncOwnAccountEmail,
} from "./account-settings-client";

const authError = (code: string) => Object.assign(new Error(`Firebase: ${code}`), { code });
const contact = { fullName: "Ana Silva", relationship: "Mother", phoneNumber: "+44 7700 900123" };

describe("requestEmailChange", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.user = { email: "old@example.test" };
  });

  it("re-authenticates, then sends the verification link to the new address", async () => {
    await expect(
      requestEmailChange({ currentPassword: "current-pass", newEmail: "  New@Example.test " }),
    ).resolves.toEqual({ ok: true, sentTo: "new@example.test" });

    expect(mocks.credential).toHaveBeenCalledWith("old@example.test", "current-pass");
    expect(mocks.verifyBeforeUpdateEmail).toHaveBeenCalledWith(mocks.user, "new@example.test");
    expect(mocks.reauthenticateWithCredential.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.verifyBeforeUpdateEmail.mock.invocationCallOrder[0]!,
    );
  });

  it("shows a friendly message and never changes the email when the password is wrong", async () => {
    mocks.reauthenticateWithCredential.mockRejectedValueOnce(authError("auth/invalid-credential"));

    await expect(
      requestEmailChange({ currentPassword: "wrong", newEmail: "new@example.test" }),
    ).resolves.toEqual({ ok: false, message: "That password is not right." });
    expect(mocks.verifyBeforeUpdateEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["auth/wrong-password", "That password is not right."],
    ["auth/invalid-login-credentials", "That password is not right."],
    ["auth/too-many-requests", "Too many attempts. Wait a few minutes and try again."],
    ["auth/requires-recent-login", "Please sign in again, then retry."],
    ["auth/network-request-failed", "We couldn't update your account. Try again later."],
  ])("maps a %s sign-in failure", async (code, message) => {
    mocks.reauthenticateWithCredential.mockRejectedValueOnce(authError(code));

    await expect(
      requestEmailChange({ currentPassword: "pw", newEmail: "new@example.test" }),
    ).resolves.toEqual({ ok: false, message });
    expect(mocks.verifyBeforeUpdateEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["auth/email-already-in-use", "That email is already used by another account."],
    ["auth/requires-recent-login", "Please sign in again, then retry."],
    ["auth/invalid-email", "Enter a valid email address."],
  ])("maps a %s failure when sending the link", async (code, message) => {
    mocks.verifyBeforeUpdateEmail.mockRejectedValueOnce(authError(code));

    await expect(
      requestEmailChange({ currentPassword: "pw", newEmail: "new@example.test" }),
    ).resolves.toEqual({ ok: false, message });
  });

  it("refuses an invalid or unchanged address without calling Firebase", async () => {
    await expect(
      requestEmailChange({ currentPassword: "pw", newEmail: "not-an-email" }),
    ).resolves.toEqual({ ok: false, message: accountMessages.invalidEmail });
    await expect(
      requestEmailChange({ currentPassword: "pw", newEmail: "OLD@example.test" }),
    ).resolves.toEqual({ ok: false, message: accountMessages.sameEmail });
    expect(mocks.reauthenticateWithCredential).not.toHaveBeenCalled();
  });
});

describe("changePassword", () => {
  afterEach(() => vi.clearAllMocks());

  it("re-authenticates, updates the password and signs in again with the new one", async () => {
    await expect(
      changePassword({
        currentPassword: "current-password",
        newPassword: "a-new-long-password",
        confirmPassword: "a-new-long-password",
      }),
    ).resolves.toEqual({ ok: true });

    expect(mocks.updatePassword).toHaveBeenCalledWith(mocks.user, "a-new-long-password");
    expect(mocks.credential).toHaveBeenNthCalledWith(1, "old@example.test", "current-password");
    expect(mocks.credential).toHaveBeenNthCalledWith(2, "old@example.test", "a-new-long-password");
    expect(mocks.reauthenticateWithCredential).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "passwords that do not match",
      { newPassword: "a-new-long-password", confirmPassword: "another-long-password" },
      accountMessages.passwordMismatch,
    ],
    [
      "a password under 12 characters",
      { newPassword: "short-pass", confirmPassword: "short-pass" },
      accountMessages.shortPassword,
    ],
    [
      "the current password again",
      { newPassword: "current-password", confirmPassword: "current-password" },
      accountMessages.samePassword,
    ],
  ])("refuses %s without calling Firebase", async (_label, input, message) => {
    await expect(
      changePassword({ currentPassword: "current-password", ...input }),
    ).resolves.toEqual({ ok: false, message });
    expect(mocks.reauthenticateWithCredential).not.toHaveBeenCalled();
    expect(mocks.updatePassword).not.toHaveBeenCalled();
  });

  it("does not update the password when the current one is wrong", async () => {
    mocks.reauthenticateWithCredential.mockRejectedValueOnce(authError("auth/wrong-password"));

    await expect(
      changePassword({
        currentPassword: "wrong",
        newPassword: "a-new-long-password",
        confirmPassword: "a-new-long-password",
      }),
    ).resolves.toEqual({ ok: false, message: "That password is not right." });
    expect(mocks.updatePassword).not.toHaveBeenCalled();
  });

  it("maps requires-recent-login from the update", async () => {
    mocks.updatePassword.mockRejectedValueOnce(authError("auth/requires-recent-login"));

    await expect(
      changePassword({
        currentPassword: "current-password",
        newPassword: "a-new-long-password",
        confirmPassword: "a-new-long-password",
      }),
    ).resolves.toEqual({ ok: false, message: "Please sign in again, then retry." });
  });
});

describe("account callables", () => {
  afterEach(() => vi.clearAllMocks());

  it("stays silent when the email sync fails", async () => {
    mocks.callable.mockRejectedValueOnce(new Error("internal"));

    await expect(syncOwnAccountEmail()).resolves.toBeUndefined();
    expect(mocks.httpsCallable).toHaveBeenCalledWith(expect.anything(), "syncOwnAccountEmail");
  });

  it("reads the stored emergency contact, or null", async () => {
    mocks.callable.mockResolvedValueOnce({ data: { contact } });
    await expect(getOwnEmergencyContact("student-1")).resolves.toEqual(contact);
    expect(mocks.callable).toHaveBeenCalledWith({ studentId: "student-1" });

    mocks.callable.mockResolvedValueOnce({ data: { contact: null } });
    await expect(getOwnEmergencyContact("student-1")).resolves.toBeNull();
  });

  it("saves the emergency contact with a request id", async () => {
    mocks.callable.mockResolvedValueOnce({ data: { saved: true } });

    await expect(saveOwnEmergencyContact("student-1", contact)).resolves.toEqual({ ok: true });
    const sent = mocks.callable.mock.calls[0]?.[0] as { requestId: string };
    expect(sent).toMatchObject({ studentId: "student-1", contact });
    expect(sent.requestId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("never shows a raw Firebase error when saving fails", async () => {
    mocks.callable.mockRejectedValueOnce(authError("functions/internal"));

    await expect(saveOwnEmergencyContact("student-1", contact)).resolves.toEqual({
      ok: false,
      message: accountMessages.contactFailed,
    });
  });
});

describe("member password minimum", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refuses an 11-character own-access password before calling the server, and sends 12", async () => {
    await expect(
      createTeenAccess({ studentId: "student-1", email: "teen@example.test", password: "a".repeat(11) }),
    ).rejects.toThrow(settingsMessages.teenPassword);
    expect(settingsMessages.teenPassword).toBe("Choose a password of at least 12 characters.");
    expect(mocks.callable).not.toHaveBeenCalled();

    mocks.callable.mockResolvedValueOnce({ data: { email: "teen@example.test" } });
    await expect(
      createTeenAccess({ studentId: "student-1", email: "teen@example.test", password: "a".repeat(12) }),
    ).resolves.toEqual({ email: "teen@example.test" });
  });

  it("refuses an 11-character password when an adult takes over the account", async () => {
    await expect(
      claimAdultAccount({
        studentId: "student-1",
        currentPassword: "current-password",
        newPassword: "a".repeat(11),
      }),
    ).rejects.toThrow("Choose a new password of at least 12 characters.");
    expect(adultClaimMessages.shortPassword).toBe(
      "Choose a new password of at least 12 characters.",
    );
    expect(mocks.reauthenticateWithCredential).not.toHaveBeenCalled();
  });
});
