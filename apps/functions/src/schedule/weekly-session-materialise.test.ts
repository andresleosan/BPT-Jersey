import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import type { SessionRecord } from "@bpt-jersey/domain/schedule";
import { createWeeklySessionStore, newWeeklySeries } from "./weekly-session-service";

const window = { from: "2026-10-19T00:00:00.000Z", to: "2026-11-01T23:59:59.000Z" };
const session = {
  sessionId: "series-1",
  academyId: "a",
  startAt: "2026-10-19T17:00:00.000Z",
  endAt: "2026-10-19T18:00:00.000Z",
  status: "scheduled",
} as unknown as SessionRecord;

/** Just enough Firestore for materialise: path-keyed docs and a transaction counter. */
function fakeFirestore(docs: Map<string, unknown>) {
  let transactions = 0;
  const ref = (path: string) => ({ path });
  const snapshot = (path: string) => ({
    exists: docs.has(path),
    ref: ref(path),
    data: () => docs.get(path),
  });
  const getAll = async (...refs: { path: string }[]) => refs.map((item) => snapshot(item.path));
  const firestore = {
    collection: (name: string) => ({
      doc: (id: string) => ref(`${name}/${id}`),
      get: async () => ({
        docs: [...docs.keys()].filter((path) => path.startsWith(`${name}/`)).map(snapshot),
      }),
    }),
    getAll,
    runTransaction: async (work: (tx: unknown) => Promise<void>) => {
      transactions += 1;
      await work({
        get: async (item: { path: string }) => snapshot(item.path),
        getAll,
        create: (item: { path: string }, value: unknown) => docs.set(item.path, value),
      });
    },
  };
  return { firestore: firestore as unknown as Firestore, transactions: () => transactions };
}

describe("weekly materialise", () => {
  it("creates missing occurrences once, then reads without any transaction", async () => {
    const docs = new Map<string, unknown>([
      ["academies/a/sessionSeries/series-1", newWeeklySeries(session, "Europe/Jersey")],
    ]);
    const fake = fakeFirestore(docs);
    const store = createWeeklySessionStore(fake.firestore);

    await store.materialise("a", window);
    expect(fake.transactions()).toBe(1);
    expect([...docs.keys()].filter((path) => path.includes("/sessions/")).sort()).toEqual([
      "academies/a/sessions/series-1",
      "academies/a/sessions/series-1__week_1",
    ]);

    await store.materialise("a", window);
    expect(fake.transactions()).toBe(1);
  });

  it("still reports a malformed series through onSeriesError", async () => {
    const docs = new Map<string, unknown>([["academies/a/sessionSeries/bad", { revisions: null }]]);
    const errors: unknown[] = [];
    await createWeeklySessionStore(fakeFirestore(docs).firestore).materialise(
      "a",
      window,
      (error) => errors.push(error),
    );
    expect(errors).toEqual([expect.objectContaining({ code: "malformed-series" })]);
  });
});
