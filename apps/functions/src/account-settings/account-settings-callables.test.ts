import { describe, expect, it } from "vitest";

import {
  createSyncOwnAccountEmailHandler,
  syncAccountEmail,
  type AccountEmailStore,
} from "./account-settings-callables";

const academyId = "demo-academy";
const now = "2026-09-25T10:00:00.000Z";
const actor = { userId: "user-1", academyId };

const user = {
  userId: "user-1",
  academyId,
  accountType: "client",
  displayName: "Ana Silva",
  email: "old@example.test",
  phoneNumber: "+44 7700 900123",
  active: true,
  status: "active",
  schemaVersion: "1",
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "user-1",
  updatedAt: "2026-01-01T00:00:00.000Z",
  updatedBy: "user-1",
};

function fakeStore(students: Record<string, Record<string, unknown>> = {}) {
  const users = new Map<string, Record<string, unknown>>([["user-1", { ...user }]]);
  const studentDocs = new Map(Object.entries(students));
  const writes: string[] = [];
  const store: AccountEmailStore = {
    updateUser: async (_academy, userId, update) => {
      const next = update(users.get(userId));
      if (!next) return false;
      users.set(userId, { ...next });
      writes.push(`users/${userId}`);
      return true;
    },
    listOwnStudents: async (_academy, userId) =>
      [...studentDocs.entries()]
        .filter(([, data]) => data.userId === userId)
        .map(([id, data]) => ({ id, data })),
    updateStudentEmail: async (_academy, studentId, fields) => {
      studentDocs.set(studentId, { ...studentDocs.get(studentId), ...fields });
      writes.push(`students/${studentId}`);
    },
  };
  return { store, users, studentDocs, writes };
}

describe("syncAccountEmail", () => {
  it("copies a verified new sign-in email to the user profile and the linked student", async () => {
    const { store, users, studentDocs } = fakeStore({
      "student-1": { userId: "user-1", email: "old@example.test" },
      "student-2": { userId: "user-1" },
    });

    await expect(
      syncAccountEmail(store, actor, { email: "New@Example.test", emailVerified: true }, now),
    ).resolves.toEqual({ updated: true });

    expect(users.get("user-1")).toMatchObject({
      email: "new@example.test",
      updatedAt: now,
      updatedBy: "user-1",
    });
    expect(studentDocs.get("student-1")).toMatchObject({
      email: "new@example.test",
      updatedAt: now,
      updatedBy: "user-1",
    });
    expect(studentDocs.get("student-2")?.email).toBeUndefined();
  });

  it("writes nothing when the stored email already matches", async () => {
    const { store, writes } = fakeStore({
      "student-1": { userId: "user-1", email: "old@example.test" },
    });

    await expect(
      syncAccountEmail(store, actor, { email: "old@example.test", emailVerified: true }, now),
    ).resolves.toEqual({ updated: false });
    expect(writes).toEqual([]);
  });

  it("writes nothing when the account has no user profile", async () => {
    const { store, users, writes } = fakeStore();
    users.clear();

    await expect(
      syncAccountEmail(store, actor, { email: "new@example.test", emailVerified: true }, now),
    ).resolves.toEqual({ updated: false });
    expect(writes).toEqual([]);
  });
});

describe("syncOwnAccountEmail handler", () => {
  const request = (tokenEmail: string) =>
    ({
      data: {},
      auth: { uid: "user-1", token: { email: tokenEmail, email_verified: true } },
    }) as never;

  function handler(authUser: { email?: string; emailVerified: boolean }) {
    const fake = fakeStore();
    return {
      ...fake,
      run: createSyncOwnAccountEmailHandler({
        requireActor: async () => actor,
        getAuthUser: async () => authUser,
        store: () => fake.store,
        now: () => now,
      }),
    };
  }

  it("trusts the Auth user record over a stale ID token", async () => {
    const { run, users } = handler({ email: "new@example.test", emailVerified: true });

    await expect(run(request("old@example.test"))).resolves.toEqual({ updated: true });
    expect(users.get("user-1")?.email).toBe("new@example.test");
  });

  it("ignores an Auth email that is not verified, whatever the token says", async () => {
    const { run, writes } = handler({ email: "new@example.test", emailVerified: false });

    await expect(run(request("new@example.test"))).resolves.toEqual({ updated: false });
    expect(writes).toEqual([]);
  });

  it("rejects a request with data", async () => {
    const { run } = handler({ email: "new@example.test", emailVerified: true });

    await expect(
      run({ data: { email: "x@example.test" }, auth: { uid: "user-1", token: {} } } as never),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });
});
