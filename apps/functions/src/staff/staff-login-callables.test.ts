import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(async () => undefined),
  setCustomUserClaims: vi.fn(async () => undefined),
}));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => auth }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({}) }));

import { completeInitialStaffAccess } from "./staff-login-callables";

const request = (data: unknown) =>
  ({
    app: {},
    data,
    auth: {
      uid: "coach-1",
      token: { auth_time: Date.now() / 1000, firebase: { sign_in_provider: "password" } },
    },
  }) as never;

describe("completeInitialStaffAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getUser.mockResolvedValue({
      uid: "coach-1",
      providerData: [],
      customClaims: { academyId: "academy-1", role: "coach", passwordChangeRequired: true },
    });
  });

  it("never clears the flag without setting a replacement password on the server", async () => {
    await expect(
      completeInitialStaffAccess.run(request({ method: "password" })),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it("refuses a replacement password built from the email", async () => {
    auth.getUser.mockResolvedValue({
      uid: "coach-1",
      email: "miro.coach@example.test",
      providerData: [],
      customClaims: { academyId: "academy-1", role: "coach", passwordChangeRequired: true },
    });
    await expect(
      completeInitialStaffAccess.run(
        request({ method: "password", newPassword: "Miro.Coach-2026!" }),
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(
      completeInitialStaffAccess.run(
        request({ method: "password", newPassword: "aaaaaaaaaaaaaa" }),
      ),
    ).rejects.toMatchObject({ code: "invalid-argument" });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("sets the new password, then removes the flag and keeps the authority claims", async () => {
    await completeInitialStaffAccess.run(
      request({ method: "password", newPassword: "a-replacement-phrase" }),
    );
    expect(auth.updateUser).toHaveBeenCalledWith("coach-1", { password: "a-replacement-phrase" });
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith("coach-1", {
      academyId: "academy-1",
      role: "coach",
    });
  });
});
