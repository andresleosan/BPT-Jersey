import { expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { createMemberClassFirestoreStore } from "./member-class-records-firestore.js";
it("uses scoped ordered limit+1 queries and propagates missing-index errors without fallback", async () => {
  const query = { where: vi.fn(), orderBy: vi.fn(), startAfter: vi.fn(), limit: vi.fn() };
  for (const method of Object.values(query)) method.mockReturnValue(query);
  // Canonical identity ids are resolved first, in the same transaction: "s" has no alias
  // document and no approved historical ids, so only "s" is queried.
  const aliases = "academies/a/memberIdentityAliases";
  const aliasDoc = { path: `${aliases}/s` };
  const aliasQuery = { where: vi.fn(), orderBy: vi.fn(), limit: vi.fn() };
  for (const method of Object.values(aliasQuery)) method.mockReturnValue(aliasQuery);
  const get = vi.fn(async (target: unknown) => {
    if (target === aliasDoc) return { id: "s", exists: false, data: () => undefined };
    if (target === aliasQuery) return { docs: [] };
    throw new Error("missing index");
  });
  const collection = vi.fn(() => query);
  const runTransaction = vi.fn(async (work) => work({ get }));
  const db = {
    doc: vi.fn((path: string) => (path === aliasDoc.path ? aliasDoc : { collection })),
    collection: vi.fn((path: string) => (path === aliases ? aliasQuery : undefined)),
    runTransaction,
  } as unknown as Firestore;
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
  expect(get.mock.calls).toEqual([[aliasDoc], [aliasQuery], [query]]);
  expect(runTransaction).toHaveBeenCalledWith(expect.any(Function), { readOnly: true });
});
