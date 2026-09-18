import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("../../../lib/member-recovery-client", () => api);
vi.mock("../../../lib/member-recovery-auth", () => auth);
vi.mock("../../../lib/login-flow", () => navigation);
import { RecoveryForm } from "./recovery-form";
const recoveryId = "a".repeat(64);
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  auth.subscribeRecoverySession.mockImplementation((callback) => {
    callback(null);
    return () => {};
  });
  api.beginMemberRecovery.mockResolvedValue({ recoveryId, expiresAt: "2026-09-20T00:00:00.000Z" });
  auth.recoverySignIn.mockResolvedValue({ email: "old@example.test" });
  auth.refreshRecoverySession.mockResolvedValue({ email: "old@example.test" });
});
afterEach(cleanup);
async function begin() {
  const user = userEvent.setup();
  render(<RecoveryForm />);
  await user.type(screen.getByLabelText("Full name"), "Alex Member");
  await user.type(screen.getByLabelText("Previous email address"), "old@example.test");
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
  expect(await screen.findByText(/office will check your identity/i)).toBeVisible();
  expect(navigation.navigateTo).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Check request status" })).toBeVisible();
});
it("resumes an opaque ticket after reload with an existing session", async () => {
  sessionStorage.setItem("bpt-member-recovery", recoveryId);
  auth.subscribeRecoverySession.mockImplementation((callback) => {
    callback({ email: "old@example.test" });
    return () => {};
  });
  api.completeMemberRecovery.mockResolvedValue({ status: "pending-review" });
  render(<RecoveryForm />);
  await screen.findByText(/office will check your identity/i);
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
  api.beginMemberRecovery.mockRejectedValue(new Error("secret=private-token"));
  const user = userEvent.setup();
  render(<RecoveryForm />);
  await user.type(screen.getByLabelText("Full name"), "Alex Member");
  await user.type(screen.getByLabelText("Previous email address"), "old@example.test");
  await user.click(screen.getByRole("button", { name: "Find my membership" }));
  expect(await screen.findByRole("alert")).not.toHaveTextContent("private-token");
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
