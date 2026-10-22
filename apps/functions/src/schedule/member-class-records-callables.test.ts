import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), read: vi.fn(), firestore: vi.fn(() => ({})) }));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ getUser: mocks.getUser }) }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: mocks.firestore }));
vi.mock("./member-class-records-firestore.js", () => ({
  createMemberClassFirestoreStore: () => ({}),
}));
vi.mock("./member-class-records-service.js", () => ({ listMemberClassRecordsPage: mocks.read }));
import { listMemberClassRecords } from "./member-class-records-callables.js";
it("rechecks active office claims and uses only the verified academy", async () => {
  const request = {
    auth: { uid: "u", token: { academyId: "a", role: "owner", auth_time: 1_800_000_000 } },
    data: { studentId: "s", kind: "bookings" },
  };
  mocks.getUser.mockResolvedValue({
    uid: "u",
    disabled: false,
    customClaims: { academyId: "a", role: "owner" },
  });
  mocks.read.mockResolvedValue({ studentId: "s", kind: "bookings", rows: [], nextCursor: null });
  expect(await listMemberClassRecords.run(request as never)).toEqual({
    studentId: "s",
    kind: "bookings",
    rows: [],
    nextCursor: null,
  });
  expect(mocks.read).toHaveBeenCalledWith(
    {},
    expect.objectContaining({ academyId: "a", role: "owner" }),
    request.data,
  );
  mocks.read.mockClear();
  // A disabled account fails the live session check before the claims recheck (office-actor.ts).
  for (const { user, code } of [
    {
      user: { disabled: true, customClaims: { academyId: "a", role: "owner" } },
      code: "unauthenticated",
    },
    {
      user: { disabled: false, customClaims: { academyId: "other", role: "owner" } },
      code: "permission-denied",
    },
    {
      user: { disabled: false, customClaims: { academyId: "a", role: "coach" } },
      code: "permission-denied",
    },
  ]) {
    mocks.getUser.mockResolvedValue({ uid: "u", ...user });
    await expect(listMemberClassRecords.run(request as never)).rejects.toMatchObject({ code });
  }
  expect(mocks.read).not.toHaveBeenCalled();
});
