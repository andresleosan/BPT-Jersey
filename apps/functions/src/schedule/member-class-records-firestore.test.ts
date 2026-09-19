import { expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { createMemberClassFirestoreStore } from "./member-class-records-firestore.js";
it("uses scoped ordered limit+1 queries and propagates missing-index errors without fallback", async () => {
  const query = { where: vi.fn(), orderBy: vi.fn(), startAfter: vi.fn(), limit: vi.fn() };
  for (const method of Object.values(query)) method.mockReturnValue(query);
  const get = vi.fn().mockRejectedValue(new Error("missing index"));
  const collection = vi.fn(() => query);
  const runTransaction = vi.fn(async (work) => work({ get }));
  const db = { doc: vi.fn(() => ({ collection })), runTransaction } as unknown as Firestore;
  const store = createMemberClassFirestoreStore(db);
  await expect(
    store.read("a", (reader) =>
      reader.queryRecords(
        {
          studentId: "s",
          kind: "attendance",
          cursor: { at: "2026-09-20T10:00:00.000Z", recordId: "r" },
        },
        26,
      ),
    ),
  ).rejects.toThrow("missing index");
  expect(collection).toHaveBeenCalledWith("attendance");
  expect(query.where.mock.calls).toEqual([
    ["studentId", "==", "s"],
    ["correctionOf", "==", null],
  ]);
  expect(query.orderBy.mock.calls[0]).toEqual(["occurredAt", "desc"]);
  expect(query.orderBy.mock.calls[1]![1]).toBe("desc");
  expect(query.limit).toHaveBeenCalledWith(26);
  expect(query.startAfter).toHaveBeenCalledWith("2026-09-20T10:00:00.000Z", "r");
  expect(get).toHaveBeenCalledTimes(1);
  expect(runTransaction.mock.calls[0]![1]).toEqual({ readOnly: true });
});
