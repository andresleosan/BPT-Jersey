import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTeamInvitationStore } from "./team-invitations-firestore.js";
import type { StaffInvitation } from "@bpt-jersey/domain/staff/team-access";

const email = "team@example.test";
const id = createHash("sha256").update(email).digest("hex");
const invite: StaffInvitation = {
  id,
  version: "v1",
  academyId: "academy-1",
  email,
  role: "administrator",
  invitedBy: "owner-1",
  createdAt: "2026-09-20T10:00:00.000Z",
  expiresAt: "2026-09-27T10:00:00.000Z",
  status: "pending",
  claimedBy: null,
};
function fixture() {
  const records = new Map<string, Record<string, unknown>>();
  let sequence = 0;
  const ref = (path: string) => ({ path, id: path.split("/").at(-1)! });
  const db = {
    collection: (path: string) => ({
      doc: (key = `audit-${++sequence}`) => ref(`${path}/${key}`),
      limit: () => ({
        get: async () => {
          const docs = [...records]
            .filter(([key]) => key.startsWith(path + "/"))
            .map(([, data]) => ({ data: () => data }));
          return { docs, size: docs.length };
        },
      }),
    }),
    runTransaction: async <T>(operation: (tx: unknown) => Promise<T>) => {
      const pending = new Map<string, Record<string, unknown>>();
      const tx = {
        get: async (r: { path: string }) => ({
          exists: records.has(r.path),
          data: () => records.get(r.path),
        }),
        set: (r: { path: string }, data: Record<string, unknown>) => pending.set(r.path, data),
        create: (r: { path: string }, data: Record<string, unknown>) => pending.set(r.path, data),
      };
      const result = await operation(tx);
      for (const [path, data] of pending) records.set(path, data);
      return result;
    },
  };
  return { records, store: createTeamInvitationStore(db as never, "owner-1") };
}
describe("transactional invitations", () => {
  it("stores pending access and its audit, then claims and consumes it exactly once", async () => {
    const { store, records } = fixture();
    await store.save(invite);
    expect(records.get(`staffInvitationEmailIndex/${id}`)).toEqual({ academyId: "academy-1" });
    expect([...records.values()].some((row) => row.action === "staff.invitation.created")).toBe(
      true,
    );
    expect(await store.claim(email, "new-user", "2026-09-21T10:00:00.000Z")).toEqual(invite);
    await expect(
      store.claim(email, "other-user", "2026-09-21T10:00:00.000Z"),
    ).rejects.toMatchObject({ code: "aborted" });
    await expect(store.cancel("academy-1", id, "v1")).rejects.toMatchObject({
      code: "failed-precondition",
    });
    await store.finish(invite, "new-user", "accepted");
    expect(await store.claim(email, "new-user", "2026-09-21T10:00:00.000Z")).toBeNull();
    expect(await store.list("academy-1")).toEqual([]);
    expect([...records.values()].some((row) => row.action === "staff.invitation.accepted")).toBe(
      true,
    );
  });
  it("refuses expired, cancelled, foreign and stale invitations", async () => {
    const { store } = fixture();
    await store.save(invite);
    expect(await store.claim(email, "user", invite.expiresAt)).toBeNull();
    await expect(store.cancel("academy-2", id, "v1")).rejects.toMatchObject({ code: "not-found" });
    await expect(store.save({ ...invite, academyId: "academy-2" })).rejects.toMatchObject({
      code: "failed-precondition",
    });
    await store.save({ ...invite, version: "v2" });
    await expect(store.cancel("academy-1", id, "v1")).rejects.toMatchObject({
      code: "failed-precondition",
    });
    await store.cancel("academy-1", id, "v2");
    expect(await store.claim(email, "user", "2026-09-21T10:00:00.000Z")).toBeNull();
  });
  it("only the claimant can complete the version being processed", async () => {
    const { store } = fixture();
    await store.save(invite);
    await store.claim(email, "user", "2026-09-21T10:00:00.000Z");
    await expect(store.finish(invite, "other", "accepted")).rejects.toMatchObject({
      code: "aborted",
    });
    await expect(store.save({ ...invite, version: "v2" })).rejects.toMatchObject({
      code: "failed-precondition",
    });
    await store.finish(invite, "user", "failed");
    expect(await store.claim(email, "user", "2026-09-21T10:00:00.000Z")).toBeNull();
    expect(await store.list("academy-1")).toEqual([
      { ...invite, status: "failed", claimedBy: "user" },
    ]);
  });
});
