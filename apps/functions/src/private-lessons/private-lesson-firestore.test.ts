import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createFirestorePrivateLessonStore } from "./private-lesson-firestore";

type ShippedIndex = Readonly<{
  collectionGroup: string;
  queryScope: string;
  fields: readonly Readonly<{ fieldPath: string; order?: string }>[];
}>;

function shippedIndexes(): readonly ShippedIndex[] {
  const file = new URL("../../../../firestore.indexes.json", import.meta.url);
  return (JSON.parse(readFileSync(file, "utf8")) as { indexes: readonly ShippedIndex[] }).indexes;
}

/** Records the query chain the adapter builds, in call order. */
function recordingFirestore() {
  const calls: unknown[][] = [];
  const query = {
    where: (...args: unknown[]) => (calls.push(["where", ...args]), query),
    orderBy: (...args: unknown[]) => (calls.push(["orderBy", ...args]), query),
    limit: (...args: unknown[]) => (calls.push(["limit", ...args]), query),
    get: async () => ({ docs: [] }),
  };
  return { calls, db: { collection: () => query } };
}

describe("createFirestorePrivateLessonStore.listByStatus", () => {
  it("orders by newest submission before capping the rows, backed by a shipped index", async () => {
    const { calls, db } = recordingFirestore();
    const store = createFirestorePrivateLessonStore(db as never, "academy-1", () => {
      throw new Error("storage is not used here");
    });

    await store.listByStatus("pending");

    expect(calls).toEqual([
      ["where", "status", "==", "pending"],
      ["orderBy", "submittedAt", "desc"],
      ["limit", 200],
    ]);
    expect(shippedIndexes()).toContainEqual({
      collectionGroup: "privateLessonPurchases",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "submittedAt", order: "DESCENDING" },
      ],
    });
  });
});
