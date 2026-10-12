import { beforeEach, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
const firestore = vi.hoisted(() => ({ doc: vi.fn() }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => auth }));
vi.mock("firebase-admin/firestore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase-admin/firestore")>()),
  getFirestore: () => firestore,
}));

import { requireCourseActor } from "./course-authorization.js";

const request = (role: string) =>
  ({
    app: { appId: "web-app-1" },
    auth: { uid: "user-1", token: { role, academyId: "academy-1", auth_time: 1_800_000_000 } },
  }) as never;
const liveUser = (role: string, tokensValidAfterTime?: string) => ({
  uid: "user-1",
  disabled: false,
  customClaims: { role, academyId: "academy-1" },
  ...(tokensValidAfterTime === undefined ? {} : { tokensValidAfterTime }),
});

beforeEach(() => {
  vi.resetAllMocks();
  firestore.doc.mockReturnValue({ get: async () => ({ exists: true, data: () => ({}) }) });
});

it.each(["guardian", "coach"])("accepts a current %s session", async (role) => {
  auth.getUser.mockResolvedValue(liveUser(role));
  await expect(requireCourseActor(request(role))).resolves.toEqual({
    uid: "user-1",
    academyId: "academy-1",
    role,
  });
});

it("accepts a token signed in again in the revocation's own second", async () => {
  auth.getUser.mockResolvedValue(liveUser("coach", new Date(1_800_000_000_000).toUTCString()));
  await expect(requireCourseActor(request("coach"))).resolves.toMatchObject({ role: "coach" });
});

it.each(["guardian", "coach"])(
  "refuses a %s token signed in before the account's sessions were revoked",
  async (role) => {
    auth.getUser.mockResolvedValue(liveUser(role, new Date(1_800_000_001_000).toUTCString()));
    await expect(requireCourseActor(request(role))).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(firestore.doc).not.toHaveBeenCalled();
  },
);
