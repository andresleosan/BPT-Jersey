import { beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => auth }));
import {
  onCallWithActiveOfficeActor,
  onCallWithActiveUserActor,
  requireActiveOfficeActor,
} from "./office-actor.js";
const request = (role = "administrator") =>
  ({
    auth: {
      uid: "office-1",
      token: { role, academyId: "academy-1", auth_time: 1_800_000_000 },
    },
  }) as never;
const currentUser = (user: Record<string, unknown>) => ({ uid: "office-1", ...user });
beforeEach(() => vi.resetAllMocks());
it.each(["owner", "administrator"])("accepts a current active %s", async (role) => {
  auth.getUser.mockResolvedValue(
    currentUser({
      disabled: false,
      customClaims: { role, academyId: "academy-1" },
    }),
  );
  await expect(requireActiveOfficeActor(request(role))).resolves.toMatchObject({
    userId: "office-1",
    role,
    academyId: "academy-1",
  });
  expect(auth.getUser).toHaveBeenCalledWith("office-1");
});
it.each([
  {
    user: { disabled: true, customClaims: { role: "administrator", academyId: "academy-1" } },
    code: "unauthenticated",
  },
  {
    user: { disabled: false, customClaims: { role: "coach", academyId: "academy-1" } },
    code: "permission-denied",
  },
  {
    user: {
      disabled: false,
      customClaims: { role: "administrator", academyId: "other-academy" },
    },
    code: "permission-denied",
  },
  { user: { disabled: false }, code: "permission-denied" },
])("rejects inactive, revoked or mismatched current authority", async ({ user, code }) => {
  auth.getUser.mockResolvedValue(currentUser(user));
  await expect(requireActiveOfficeActor(request())).rejects.toMatchObject({ code });
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

it("blocks the callable handler when current office authority no longer matches", async () => {
  const handler = vi.fn();
  const callable = onCallWithActiveOfficeActor({ enforceAppCheck: true }, handler);
  auth.getUser.mockResolvedValue(
    currentUser({
      disabled: false,
      customClaims: { role: "coach", academyId: "academy-1" },
    }),
  );
  await expect(callable.run(request())).rejects.toMatchObject({ code: "permission-denied" });
  expect(handler).not.toHaveBeenCalled();
});

it("allows an active non-office actor through the general live-session wrapper", async () => {
  const handler = vi.fn(() => "ok");
  const callable = onCallWithActiveUserActor({ enforceAppCheck: true }, handler);
  auth.getUser.mockResolvedValue(
    currentUser({
      disabled: false,
      customClaims: { role: "headCoach", academyId: "academy-1" },
    }),
  );
  await expect(callable.run(request("headCoach"))).resolves.toBe("ok");
  expect(handler).toHaveBeenCalledOnce();
});
