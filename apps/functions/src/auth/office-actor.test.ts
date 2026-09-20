import { beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => auth }));
import { requireActiveOfficeActor } from "./office-actor.js";
const request = (role = "administrator") =>
  ({ auth: { uid: "office-1", token: { role, academyId: "academy-1" } } }) as never;
beforeEach(() => vi.resetAllMocks());
it.each(["owner", "administrator"])("accepts a current active %s", async (role) => {
  auth.getUser.mockResolvedValue({
    disabled: false,
    customClaims: { role, academyId: "academy-1" },
  });
  await expect(requireActiveOfficeActor(request(role))).resolves.toMatchObject({
    userId: "office-1",
    role,
    academyId: "academy-1",
  });
  expect(auth.getUser).toHaveBeenCalledWith("office-1");
});
it.each([
  { disabled: true, customClaims: { role: "administrator", academyId: "academy-1" } },
  { disabled: false, customClaims: { role: "coach", academyId: "academy-1" } },
  { disabled: false, customClaims: { role: "administrator", academyId: "other-academy" } },
  { disabled: false },
])("rejects inactive, revoked or mismatched current authority", async (user) => {
  auth.getUser.mockResolvedValue(user);
  await expect(requireActiveOfficeActor(request())).rejects.toMatchObject({
    code: "permission-denied",
  });
});
it.each(["coach", "guardian", "headCoach", "adultStudent"])(
  "rejects %s before querying current authority",
  async (role) => {
    await expect(requireActiveOfficeActor(request(role))).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(auth.getUser).not.toHaveBeenCalled();
  },
);
