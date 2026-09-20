import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ beginMemberRecovery: vi.fn(), completeMemberRecovery: vi.fn() }));
const auth = vi.hoisted(() => ({
  recoverySignIn: vi.fn(),
  refreshRecoverySession: vi.fn(),
  sendRecoveryVerification: vi.fn(),
  subscribeRecoverySession: vi.fn(),
  signOutRecovery: vi.fn(),
  resetRecoveryPassword: vi.fn(),
}));
const navigation = vi.hoisted(() => ({ navigateTo: vi.fn() }));
const loader = vi.hoisted(() => ({ loadRecoveryClient: vi.fn() }));
vi.mock("../../../lib/member-recovery-loader", () => loader);
vi.mock("../../../lib/member-recovery-auth", () => auth);
vi.mock("../../../lib/login-flow", () => navigation);
import { RecoveryForm } from "./recovery-form";
const recoveryId = "a".repeat(64);
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  loader.loadRecoveryClient.mockResolvedValue(api);
  auth.subscribeRecoverySession.mockImplementation((callback) => {
    callback(null);
    return () => {};
  });
  api.beginMemberRecovery.mockResolvedValue({ recoveryId, expiresAt: "2026-09-20T00:00:00.000Z" });
  auth.recoverySignIn.mockResolvedValue({ uid: "member-a", email: "old@example.test" });
  auth.refreshRecoverySession.mockResolvedValue({ uid: "member-a", email: "old@example.test" });
});
afterEach(cleanup);
async function begin() {
  const user = userEvent.setup();
  render(<RecoveryForm />);
  await user.type(screen.getByLabelText("Full name"), "Alex Member");
  await user.type(screen.getByLabelText(/Previous email address/), "old@example.test");
  await user.click(screen.getByRole("button", { name: "Find my membership" }));
  await screen.findByRole("button", { name: "Continue with Google" });
  return user;
}
it("offers authentication without exposing a match or storing identity data", async () => {
  await begin();
  expect(api.beginMemberRecovery).toHaveBeenCalledWith({
    fullName: "Alex Member",
    email: "old@example.test",
  });
  expect(screen.queryByText(/member found|no member found/i)).not.toBeInTheDocument();
  expect(Object.values(sessionStorage)).toEqual([recoveryId]);
  expect(screen.getByLabelText("Email address")).toBeVisible();
  expect(screen.getByLabelText("New password")).toBeVisible();
});
it("continues with a name alone and offers a new email or Google account", async () => {
  const user = userEvent.setup();
  render(<RecoveryForm />);
  await user.type(screen.getByLabelText("Full name"), "Alex Member");
  await user.click(screen.getByRole("button", { name: "Find my membership" }));
  expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeVisible();
  expect(api.beginMemberRecovery).toHaveBeenCalledWith({ fullName: "Alex Member" });
  expect(screen.getByLabelText("Email address")).toBeRequired();
  expect(screen.getByLabelText("New password")).toBeVisible();
});
it("waits for email verification and refreshes before checking again", async () => {
  api.completeMemberRecovery
    .mockResolvedValueOnce({ status: "verify-email" })
    .mockResolvedValueOnce({ status: "linked" });
  const user = await begin();
  await user.type(screen.getByLabelText("Email address"), "old@example.test");
  await user.type(screen.getByLabelText("New password"), "a-good-password");
  await user.click(screen.getByRole("button", { name: "Create account and continue" }));
  expect(await screen.findByRole("button", { name: "I have verified my email" })).toBeVisible();
  expect(navigation.navigateTo).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "I have verified my email" }));
  await waitFor(() => expect(navigation.navigateTo).toHaveBeenCalledWith("/account"));
  expect(auth.refreshRecoverySession).toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
});
it("keeps changed-email requests waiting for review instead of navigating", async () => {
  api.completeMemberRecovery.mockResolvedValue({ status: "pending-review" });
  const user = await begin();
  await user.click(screen.getByRole("button", { name: "Continue with Google" }));
  expect(await screen.findByText(/administrator will verify your old membership/i)).toBeVisible();
  expect(navigation.navigateTo).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Check request status" })).toBeVisible();
});
it("resumes an opaque ticket after reload with an existing session", async () => {
  sessionStorage.setItem("bpt-member-recovery", recoveryId);
  auth.subscribeRecoverySession.mockImplementation((callback) => {
    callback({ uid: "member-a", email: "old@example.test" });
    return () => {};
  });
  api.completeMemberRecovery.mockResolvedValue({ status: "pending-review" });
  render(<RecoveryForm />);
  await screen.findByText(/administrator will verify your old membership/i);
  expect(api.completeMemberRecovery).toHaveBeenCalledWith({ recoveryId });
});
it("collects missing profile fields only after identity authorization", async () => {
  api.completeMemberRecovery
    .mockResolvedValueOnce({
      status: "profile-required",
      profile: { dateOfBirth: "1990-02-03", phoneNumber: "07700900123" },
    })
    .mockResolvedValueOnce({ status: "linked" });
  const user = await begin();
  expect(screen.queryByLabelText("Date of birth")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Continue with Google" }));
  expect(await screen.findByLabelText("Date of birth")).toHaveValue("1990-02-03");
  await user.selectOptions(screen.getByLabelText("Training centre"), "Town");
  await user.click(screen.getByLabelText("Evening"));
  await user.click(screen.getByRole("button", { name: "Save and recover access" }));
  await waitFor(() => expect(navigation.navigateTo).toHaveBeenCalledWith("/account"));
  expect(api.completeMemberRecovery).toHaveBeenLastCalledWith({
    recoveryId,
    profile: {
      dateOfBirth: "1990-02-03",
      phoneNumber: "07700900123",
      trainingCenter: "Town",
      trainingTimePreferences: ["evening"],
    },
  });
});
it("keeps infrastructure errors out of the page and allows retry", async () => {
  api.beginMemberRecovery.mockRejectedValue(new Error("backend-diagnostic-marker"));
  const user = userEvent.setup();
  render(<RecoveryForm />);
  await user.type(screen.getByLabelText("Full name"), "Alex Member");
  await user.type(screen.getByLabelText(/Previous email address/), "old@example.test");
  await user.click(screen.getByRole("button", { name: "Find my membership" }));
  expect(await screen.findByRole("alert")).not.toHaveTextContent("backend-diagnostic-marker");
  expect(screen.getByRole("button", { name: "Find my membership" })).toBeEnabled();
});
it("offers existing-account sign in when email is already registered", async () => {
  auth.recoverySignIn.mockRejectedValueOnce({ code: "auth/email-already-in-use" });
  const user = await begin();
  await user.type(screen.getByLabelText("Email address"), "old@example.test");
  await user.type(screen.getByLabelText("New password"), "a-good-password");
  await user.click(screen.getByRole("button", { name: "Create account and continue" }));
  expect(await screen.findByRole("button", { name: "Sign in and continue" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Forgot password?" })).toBeVisible();
  expect(navigation.navigateTo).not.toHaveBeenCalled();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function observeSession() {
  let listener!: (session: { uid: string; email: string } | null) => void;
  auth.subscribeRecoverySession.mockImplementation((callback) => {
    listener = callback;
    callback(null);
    return () => {};
  });
  return (session: { uid: string; email: string } | null) => act(() => listener(session));
}
it.each([null, { uid: "member-b", email: "other@example.test" }])(
  "clears authorized profile when the session changes to %s",
  async (next) => {
    const changeSession = observeSession();
    api.completeMemberRecovery.mockResolvedValue({
      status: "profile-required",
      profile: { phoneNumber: "07700900123" },
    });
    const user = await begin();
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByLabelText("Phone number")).toHaveValue("07700900123");
    changeSession(next);
    expect(screen.queryByLabelText("Phone number")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: next ? "Continue with this account" : "Continue with Google",
      }),
    ).toBeEnabled();
    expect(Object.values(sessionStorage)).toEqual([recoveryId]);
  },
);
it.each(["profile-required", "linked"])(
  "ignores a pending %s completion after switching accounts",
  async (status) => {
    const changeSession = observeSession();
    const pending = deferred<{ status: string; profile?: { phoneNumber: string } }>();
    api.completeMemberRecovery.mockReturnValue(pending.promise);
    const user = await begin();
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(api.completeMemberRecovery).toHaveBeenCalled());
    changeSession({ uid: "member-b", email: "other@example.test" });
    await act(async () => pending.resolve({ status, profile: { phoneNumber: "07700900123" } }));
    expect(screen.queryByLabelText("Phone number")).not.toBeInTheDocument();
    expect(navigation.navigateTo).not.toHaveBeenCalled();
    expect(auth.refreshRecoverySession).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Continue with this account" })).toBeEnabled();
  },
);
it("does not navigate or remove the ticket if identity changes during claim refresh", async () => {
  const changeSession = observeSession();
  const pending = deferred<{ uid: string; email: string }>();
  api.completeMemberRecovery.mockResolvedValue({ status: "linked" });
  auth.refreshRecoverySession.mockReturnValue(pending.promise);
  const user = await begin();
  await user.click(screen.getByRole("button", { name: "Continue with Google" }));
  await waitFor(() => expect(auth.refreshRecoverySession).toHaveBeenCalled());
  changeSession(null);
  await act(async () => pending.resolve({ uid: "member-a", email: "old@example.test" }));
  expect(navigation.navigateTo).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("bpt-member-recovery")).toBe(recoveryId);
  expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
});
it("automatically sends verification for a newly created password account", async () => {
  api.completeMemberRecovery.mockResolvedValue({ status: "verify-email" });
  const user = await begin();
  await user.type(screen.getByLabelText("Email address"), "old@example.test");
  await user.type(screen.getByLabelText("New password"), "synthetic-password");
  await user.click(screen.getByRole("button", { name: "Create account and continue" }));
  await screen.findByRole("button", { name: "Resend verification email" });
  expect(auth.sendRecoveryVerification).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent("Verification email sent");
});
it("retains the created account and ticket when initial verification delivery fails", async () => {
  api.completeMemberRecovery.mockResolvedValue({ status: "verify-email" });
  auth.sendRecoveryVerification.mockRejectedValueOnce(new Error("Synthetic delivery failure"));
  const user = await begin();
  await user.type(screen.getByLabelText("Email address"), "old@example.test");
  await user.type(screen.getByLabelText("New password"), "synthetic-password");
  await user.click(screen.getByRole("button", { name: "Create account and continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your account was created");
  expect(navigation.navigateTo).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("bpt-member-recovery")).toBe(recoveryId);
  await user.click(screen.getByRole("button", { name: "Resend verification email" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Verification email sent");
  expect(auth.recoverySignIn).toHaveBeenCalledTimes(1);
  expect(auth.sendRecoveryVerification).toHaveBeenCalledTimes(2);
});
it("retries a failed claim refresh using the linked ticket", async () => {
  api.completeMemberRecovery.mockResolvedValue({ status: "linked" });
  auth.refreshRecoverySession.mockRejectedValueOnce(new Error("Synthetic refresh failure"));
  const user = await begin();
  await user.click(screen.getByRole("button", { name: "Continue with Google" }));
  await screen.findByRole("alert");
  expect(screen.queryByText(/Opening your account/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry opening your account" }));
  await waitFor(() => expect(navigation.navigateTo).toHaveBeenCalledWith("/account"));
  expect(api.beginMemberRecovery).toHaveBeenCalledTimes(1);
  expect(api.completeMemberRecovery).toHaveBeenCalledTimes(1);
  expect(auth.refreshRecoverySession).toHaveBeenCalledTimes(2);
  expect(sessionStorage.length).toBe(0);
});
it("renders a safe error when Firebase subscription setup fails", () => {
  auth.subscribeRecoverySession.mockImplementation(() => {
    throw new Error("Synthetic missing Firebase configuration");
  });
  render(<RecoveryForm />);
  expect(screen.getByRole("heading", { name: "Recover your access" })).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent("Unable to continue");
  expect(screen.getByLabelText("Full name")).toBeVisible();
});

it("continues registration when Firebase observes the new account before sign-in resolves", async () => {
  const changeSession = observeSession();
  auth.recoverySignIn.mockImplementation(async () => {
    changeSession({ uid: "member-a", email: "old@example.test" });
    return { uid: "member-a", email: "old@example.test" };
  });
  api.completeMemberRecovery.mockResolvedValue({ status: "verify-email" });
  const user = await begin();
  await user.type(screen.getByLabelText("Email address"), "old@example.test");
  await user.type(screen.getByLabelText("New password"), "synthetic-password");
  await user.click(screen.getByRole("button", { name: "Create account and continue" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Verification email sent");
  expect(auth.sendRecoveryVerification).toHaveBeenCalledWith("member-a");
  expect(api.completeMemberRecovery).toHaveBeenCalledWith({ recoveryId });
});
it("ignores completion errors after logout", async () => {
  const changeSession = observeSession();
  const pending = deferred<void>();
  api.completeMemberRecovery.mockImplementation(async () => {
    await pending.promise;
    throw new Error("Synthetic obsolete request failure");
  });
  const user = await begin();
  await user.click(screen.getByRole("button", { name: "Continue with Google" }));
  changeSession(null);
  await act(async () => pending.resolve());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
});
it("does not send registration verification during existing-account sign-in", async () => {
  api.completeMemberRecovery.mockResolvedValue({ status: "pending-review" });
  const user = await begin();
  await user.click(screen.getByRole("button", { name: "I already have an account" }));
  await user.type(screen.getByLabelText("Email address"), "old@example.test");
  await user.type(screen.getByLabelText("Password"), "synthetic-password");
  await user.click(screen.getByRole("button", { name: "Sign in and continue" }));
  await screen.findByRole("heading", { name: "Request awaiting review" });
  expect(auth.sendRecoveryVerification).not.toHaveBeenCalled();
});
it("sends initial verification when registration resumes a stored signed-out ticket", async () => {
  sessionStorage.setItem("bpt-member-recovery", recoveryId);
  const changeSession = observeSession();
  auth.recoverySignIn.mockImplementation(async () => {
    changeSession({ uid: "member-a", email: "old@example.test" });
    return { uid: "member-a", email: "old@example.test" };
  });
  api.completeMemberRecovery.mockResolvedValue({ status: "verify-email" });
  const user = userEvent.setup();
  render(<RecoveryForm />);
  await user.type(await screen.findByLabelText("Email address"), "old@example.test");
  await user.type(screen.getByLabelText("New password"), "synthetic-password");
  await user.click(screen.getByRole("button", { name: "Create account and continue" }));
  await waitFor(() => expect(auth.sendRecoveryVerification).toHaveBeenCalledWith("member-a"));
  expect(api.completeMemberRecovery).toHaveBeenCalledTimes(1);
});

it("announces a pending search and prevents duplicate requests", async () => {
  const pending = deferred<{ recoveryId: string; expiresAt: string }>();
  api.beginMemberRecovery.mockReturnValue(pending.promise);
  const user = userEvent.setup();
  render(<RecoveryForm />);
  await user.type(screen.getByLabelText("Full name"), "Alex Member");
  await user.click(screen.getByRole("button", { name: "Find my membership" }));
  const searching = screen.getByRole("button", { name: "Finding your membership..." });
  expect(searching).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Finding your membership");
  await user.click(searching);
  expect(api.beginMemberRecovery).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ recoveryId, expiresAt: "2026-09-20T00:00:00.000Z" }));
  expect(await screen.findByRole("heading", { name: "Choose how to sign in" })).toHaveFocus();
});

it.each([
  ["functions/unavailable", "Check your connection"],
  ["auth/network-request-failed", "Check your connection"],
  ["auth/popup-blocked", "Allow pop-ups"],
  ["auth/popup-closed-by-user", "Google sign-in window was closed"],
])("gives actionable feedback for %s without losing the recovery ticket", async (code, message) => {
  auth.recoverySignIn.mockRejectedValueOnce({ code });
  const user = await begin();
  await user.click(screen.getByRole("button", { name: "Continue with Google" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(sessionStorage.getItem("bpt-member-recovery")).toBe(recoveryId);
  expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
});

it("warms the client on focus without searching or creating a request", async () => {
  const user = userEvent.setup();
  render(<RecoveryForm />);
  expect(loader.loadRecoveryClient).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText("Full name"));
  expect(loader.loadRecoveryClient).toHaveBeenCalled();
  expect(api.beginMemberRecovery).not.toHaveBeenCalled();
  expect(api.completeMemberRecovery).not.toHaveBeenCalled();
});

it("retries a failed client download and preserves the entered name", async () => {
  loader.loadRecoveryClient.mockRejectedValue(new Error("Synthetic chunk download failure"));
  const user = userEvent.setup();
  render(<RecoveryForm />);
  await user.type(screen.getByLabelText("Full name"), "Alex Member");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Find my membership" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to continue");
  expect(screen.getByLabelText("Full name")).toHaveValue("Alex Member");
  expect(api.beginMemberRecovery).not.toHaveBeenCalled();
  loader.loadRecoveryClient.mockResolvedValue(api);
  await user.click(screen.getByRole("button", { name: "Find my membership" }));
  expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeVisible();
  expect(api.beginMemberRecovery).toHaveBeenCalledTimes(1);
});
