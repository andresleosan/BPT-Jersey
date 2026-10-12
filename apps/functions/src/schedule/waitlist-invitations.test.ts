import { describe, expect, it, vi } from "vitest";

const syntheticAuthUsers = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    getUser: async (uid: string) => syntheticAuthUsers.get(uid),
  }),
}));
vi.mock("firebase-admin/firestore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase-admin/firestore")>()),
  getFirestore: () => {
    throw new Error("Firestore must not be read");
  },
}));

import {
  createWaitlistClass,
  getWaitlistClassSource,
  listWaitlistClassHistory,
} from "./waitlist-invitations";

function request(data: unknown, role: string, uid = role + "-1", academyId = "academy-1") {
  syntheticAuthUsers.set(uid, {
    uid,
    disabled: false,
    emailVerified: true,
    customClaims: { academyId, role },
    tokensValidAfterTime: "2020-01-01T00:00:00.000Z",
  });
  return {
    app: { appId: "synthetic-app" },
    auth: { uid, token: { role, academyId, auth_time: 1_700_000_000 } },
    data,
  } as never;
}

function changeLiveUser(uid: string, changes: Record<string, unknown>) {
  syntheticAuthUsers.set(uid, { ...syntheticAuthUsers.get(uid), ...changes });
}

describe("waitlist class owner callables", () => {
  it.each([
    {
      name: "getWaitlistClassSource",
      callable: getWaitlistClassSource,
      data: { sessionId: "s-1" },
    },
    {
      name: "createWaitlistClass",
      callable: createWaitlistClass,
      data: { sourceSessionId: "s-1", operationId: "op-1" },
    },
    { name: "listWaitlistClassHistory", callable: listWaitlistClassHistory, data: {} },
  ])(
    "$name refuses an owner token issued before a demotion or a session revocation (N-03)",
    async ({ callable, data }) => {
      const demoted = request(data, "owner");
      changeLiveUser("owner-1", { customClaims: { academyId: "academy-1", role: "coach" } });
      await expect(callable.run(demoted)).rejects.toMatchObject({ code: "permission-denied" });
      const revoked = request(data, "owner");
      changeLiveUser("owner-1", { tokensValidAfterTime: "2030-01-01T00:00:00.000Z" });
      await expect(callable.run(revoked)).rejects.toMatchObject({ code: "unauthenticated" });
    },
  );

  it.each([getWaitlistClassSource, createWaitlistClass, listWaitlistClassHistory])(
    "keeps the owner-only token gate",
    async (callable) => {
      await expect(callable.run(request({}, "administrator"))).rejects.toMatchObject({
        code: "permission-denied",
      });
    },
  );
});
