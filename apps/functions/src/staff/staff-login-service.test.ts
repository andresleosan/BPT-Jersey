import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createStaffLoginService, hashStaffPassword } from "./staff-login-service.js";

let hashed: Awaited<ReturnType<typeof hashStaffPassword>>;
beforeAll(async () => {
  hashed = await hashStaffPassword("initial-test-password");
});

function fixture() {
  const records = new Map<string, Record<string, unknown>>([
    [
      "staffLoginCredentials/100001",
      {
        ...hashed,
        userId: "coach-miro",
        staffId: "coach-miro",
        academyId: "academy",
        active: true,
      },
    ],
    [
      "academies/academy/users/coach-miro",
      {
        userId: "coach-miro",
        academyId: "academy",
        accountType: "staff",
        active: true,
        status: "active",
      },
    ],
    [
      "academies/academy/staff/coach-miro",
      {
        staffId: "coach-miro",
        userId: "coach-miro",
        academyId: "academy",
        role: "coach",
        active: true,
        status: "active",
      },
    ],
  ]);
  const doc = (path: string) => ({ path, get: async () => ({ data: () => records.get(path) }) });
  const db = {
    doc,
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: (ref: ReturnType<typeof doc>) => ref.get(),
        set: (ref: ReturnType<typeof doc>, data: Record<string, unknown>) =>
          records.set(ref.path, data),
        update: (ref: ReturnType<typeof doc>, data: Record<string, unknown>) =>
          records.set(ref.path, { ...records.get(ref.path), ...data }),
      }),
  };
  const user = {
    uid: "coach-miro",
    disabled: false,
    customClaims: { academyId: "academy", role: "coach" },
  };
  const auth = {
    getUser: vi.fn(async () => user),
    createCustomToken: vi.fn(async () => "test-custom-token"),
  };
  return {
    records,
    user,
    auth,
    service: createStaffLoginService(db as unknown as Firestore, auth as unknown as Auth),
  };
}
const input = { staffNumber: "100001", password: "initial-test-password" };

describe("staff numeric login", () => {
  it("issues a token for the existing UID with no additional authority claims", async () => {
    const { service, auth } = fixture();
    await expect(service.signIn(input, "test-ip")).resolves.toEqual({ token: "test-custom-token" });
    expect(auth.createCustomToken).toHaveBeenCalledWith("coach-miro");
  });
  it.each(["administrator", "owner"])(
    "keeps Staff ID sign-in working after promotion to %s",
    async (role) => {
      const { service, records, user, auth } = fixture();
      user.customClaims.role = role;
      records.get("academies/academy/users/coach-miro")!.adminRole = role;
      await service.signIn(input, "test-ip");
      expect(auth.createCustomToken).toHaveBeenCalledWith(user.uid);
      expect(records.get("academies/academy/staff/coach-miro")!.role).toBe("coach");
    },
  );
  it.each([
    "wrong password",
    "missing ID",
    "disabled auth",
    "inactive staff",
    "unconfirmed administrative role",
    "member role",
    "inactive canonical profile",
    "wrong academy",
    "invalid stored path",
  ])("rejects %s", async (reason) => {
    const { service, records, user, auth } = fixture();
    const attempt = { ...input };
    if (reason === "wrong password") attempt.password = "incorrect";
    if (reason === "missing ID") attempt.staffNumber = "100002";
    if (reason === "disabled auth") user.disabled = true;
    if (reason === "inactive staff")
      records.get("academies/academy/staff/coach-miro")!.active = false;
    if (reason === "unconfirmed administrative role") user.customClaims.role = "administrator";
    if (reason === "member role") user.customClaims.role = "adultStudent";
    if (reason === "inactive canonical profile")
      records.get("academies/academy/users/coach-miro")!.active = false;
    if (reason === "wrong academy") user.customClaims.academyId = "other";
    if (reason === "invalid stored path")
      records.get("staffLoginCredentials/100001")!.userId = "bad/path";
    await expect(service.signIn(attempt, "test-ip")).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(auth.createCustomToken).not.toHaveBeenCalled();
  });
  it("limits repeated attempts per ID even when the source IP changes", async () => {
    const { service } = fixture();
    for (let i = 0; i < 10; i++) await service.signIn(input, `ip-${i}`);
    await expect(service.signIn(input, "another-ip")).rejects.toMatchObject({
      code: "resource-exhausted",
    });
  });
  it("requires the authenticated owner to change the password", async () => {
    const { service } = fixture();
    await expect(
      service.changePassword({ ...input, newPassword: "replacement-password" }, "ip", "other-user"),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });
  it("replaces the salted hash, invalidates the old password and preserves the UID", async () => {
    const { service, records, auth } = fixture();
    await service.changePassword(
      { ...input, newPassword: "replacement-password" },
      "ip",
      "coach-miro",
    );
    const stored = records.get("staffLoginCredentials/100001")!;
    expect(stored.salt).not.toBe(hashed.salt);
    expect(JSON.stringify(stored)).not.toContain("replacement-password");
    await expect(service.signIn(input, "ip")).rejects.toMatchObject({ code: "unauthenticated" });
    await service.signIn({ ...input, password: "replacement-password" }, "ip");
    expect(auth.createCustomToken).toHaveBeenCalledWith("coach-miro");
  });
});
