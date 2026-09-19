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
    auth: { uid: "u", token: { academyId: "a", role: "owner" } },
    data: { studentId: "s", kind: "bookings" },
  };
  mocks.getUser.mockResolvedValue({
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
  for (const user of [
    { disabled: true, customClaims: { academyId: "a", role: "owner" } },
    { disabled: false, customClaims: { academyId: "other", role: "owner" } },
    { disabled: false, customClaims: { academyId: "a", role: "coach" } },
  ]) {
    mocks.getUser.mockResolvedValue(user);
    await expect(listMemberClassRecords.run(request as never)).rejects.toMatchObject({
      code: "permission-denied",
    });
  }
  expect(mocks.read).not.toHaveBeenCalled();
});
