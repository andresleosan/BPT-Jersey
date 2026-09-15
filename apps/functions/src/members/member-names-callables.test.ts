import { describe, expect, it, vi } from "vitest";

import { listMemberNamesHandler } from "./member-names-callables";

function fakeRequest(
  data: unknown,
  role = "owner",
  uid: string | null = "u1",
  academyId = "academy-1",
) {
  return { data, auth: uid ? { uid, token: { academyId, role } } : undefined } as never;
}
function store(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return {
    listActiveStudents: vi.fn(async (_academyId: string, limit: number) => docs.slice(0, limit)),
  };
}

describe("listMemberNames", () => {
  it("returns active students sorted by name with a nullable family", async () => {
    const result = await listMemberNamesHandler(fakeRequest(null), {
      store: store([
        { id: "s2", data: { fullName: "Zé Pinto", familyId: "f2", status: "active" } },
        { id: "s1", data: { fullName: "Ana Coelho", status: "active" } },
      ]),
    });
    expect(result).toEqual({
      members: [
        { studentId: "s1", fullName: "Ana Coelho", familyId: null },
        { studentId: "s2", fullName: "Zé Pinto", familyId: "f2" },
      ],
    });
  });

  it("refuses coaches, anonymous callers and payloads", async () => {
    const s = store([]);
    await expect(
      listMemberNamesHandler(fakeRequest(null, "coach"), { store: s }),
    ).rejects.toMatchObject({ code: "permission-denied" });
    await expect(
      listMemberNamesHandler(fakeRequest(null, "owner", null), { store: s }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(listMemberNamesHandler(fakeRequest({}), { store: s })).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("fails instead of returning a partial list above the limit", async () => {
    const docs = Array.from({ length: 2001 }, (_, i) => ({
      id: `s${i}`,
      data: { fullName: `Member ${i}`, status: "active" },
    }));
    await expect(
      listMemberNamesHandler(fakeRequest(null), { store: store(docs) }),
    ).rejects.toMatchObject({ code: "resource-exhausted" });
  });
});
